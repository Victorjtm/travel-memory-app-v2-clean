import { Injectable } from '@angular/core';
import { GpxAnimationService, GpxPoint } from './gpx-animation.service';
import { ActividadesItinerariosService } from './actividades-itinerarios.service';
import { firstValueFrom } from 'rxjs';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export interface RouteVideoOptions {
  trackGpx: string;
  transportMode?: string;
  distanciaKm?: number;
  titulo?: string;
  duracionSegundos?: number;
  fps?: number;
  width?: number;
  height?: number;
  idParadaOrigen?: number;
  idParadaDestino?: number;
}

export interface ProgresoRenderizadoRuta {
  fase: 'preparando' | 'descargando_tiles' | 'renderizando' | 'codificando' | 'subiendo' | 'completado' | 'error';
  porcentaje: number;
  mensaje: string;
}

@Injectable({
  providedIn: 'root'
})
export class RouteVideoGeneratorService {
  private tileCache = new Map<string, HTMLImageElement>();

  constructor(
    private gpxService: GpxAnimationService,
    private actividadesService: ActividadesItinerariosService
  ) {}

  /**
   * Calcula la duración dinámica adaptativa según la distancia del subtramo:
   * Regla logística/logarítmica:
   * - Mínimo 4.5s para tramos cortos (< 500m) para apreciar el HUD y el movimiento del icono.
   * - Progresión suave para tramos medios (2 km -> ~7-8s).
   * - Tope de 12-14s para tramos largos para no aburrir al lector.
   */
  calcularDuracionDinamica(distanciaKm: number): number {
    const dist = Math.max(0.05, distanciaKm || 0.1);
    const dur = 4.5 + Math.min(9.0, Math.log2(Math.max(1, dist * 2.5)) * 1.8);
    return Math.round(dur * 10) / 10;
  }

  /**
   * Genera el vídeo MP4 de un subtramo GPX y lo sube al backend asociado a (origen, destino).
   * Devuelve la URL pública del vídeo generado.
   */
  async generarYSubirVideoSubtramo(
    actividadId: number,
    origen: number,
    destino: number,
    options: RouteVideoOptions,
    onProgress?: (p: ProgresoRenderizadoRuta) => void
  ): Promise<string> {
    try {
      onProgress?.({ fase: 'preparando', porcentaje: 5, mensaje: `Analizando subtramo #${origen} ➔ #${destino}...` });

      const points = this.gpxService.parseGpx(options.trackGpx);
      if (!points || points.length < 2) {
        throw new Error('El track GPX no contiene suficientes puntos');
      }

      onProgress?.({ fase: 'descargando_tiles', porcentaje: 15, mensaje: 'Cargando cartografía base...' });
      const videoBlob = await this.renderizarVideoRuta(points, options, onProgress);

      onProgress?.({ fase: 'subiendo', porcentaje: 85, mensaje: 'Guardando vídeo de subtramo en servidor...' });
      const resp = await firstValueFrom(this.actividadesService.subirVideoSubtramo(actividadId, origen, destino, videoBlob));

      onProgress?.({ fase: 'completado', porcentaje: 100, mensaje: '¡Vídeo de subtramo listo!' });
      return resp.url;
    } catch (err: any) {
      console.error(`❌ [RouteVideoGenerator] Error generando vídeo subtramo #${origen}->#${destino}:`, err);
      onProgress?.({ fase: 'error', porcentaje: 0, mensaje: err.message || 'Error generando vídeo' });
      throw err;
    }
  }

  /**
   * Genera el vídeo MP4 de un tramo GPX y lo sube al backend de forma transparente.
   * Devuelve la URL pública del vídeo generado.
   */
  async generarYSubirVideo(
    actividadId: number,
    options: RouteVideoOptions,
    onProgress?: (p: ProgresoRenderizadoRuta) => void
  ): Promise<string> {
    try {
      onProgress?.({ fase: 'preparando', porcentaje: 5, mensaje: 'Analizando recorrido GPX...' });

      const points = this.gpxService.parseGpx(options.trackGpx);
      if (!points || points.length < 2) {
        throw new Error('El track GPX no contiene suficientes puntos');
      }

      onProgress?.({ fase: 'descargando_tiles', porcentaje: 15, mensaje: 'Cargando cartografía base...' });
      const videoBlob = await this.renderizarVideoRuta(points, options, onProgress);

      onProgress?.({ fase: 'subiendo', porcentaje: 85, mensaje: 'Guardando vídeo en servidor...' });
      const resp = await firstValueFrom(
        this.actividadesService.subirVideoSubtramo(
          actividadId,
          options.idParadaOrigen || 0,
          options.idParadaDestino || 1,
          videoBlob
        )
      );

      onProgress?.({ fase: 'completado', porcentaje: 100, mensaje: '¡Vídeo listo!' });
      return (resp as any).url;
    } catch (err: any) {
      console.error('❌ [RouteVideoGenerator] Error generando vídeo:', err);
      onProgress?.({ fase: 'error', porcentaje: 0, mensaje: err.message || 'Error generando vídeo' });
      throw err;
    }
  }

  /**
   * Renderiza los fotogramas del recorrido sobre Canvas y los codifica en MP4/WebM.
   */
  async renderizarVideoRuta(
    points: GpxPoint[],
    options: RouteVideoOptions,
    onProgress?: (p: ProgresoRenderizadoRuta) => void
  ): Promise<Blob> {
    const width = options.width || 1280;
    const height = options.height || 720;
    const fps = options.fps || 30;
    const duracionSeg = options.duracionSegundos || this.calcularDuracionDinamica(options.distanciaKm || 0);
    const totalFrames = Math.max(fps * 3, Math.round(fps * duracionSeg));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    // 1. Calcular Bounding Box Geográfico
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }

    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;

    // Márgenes seguros en pantalla (en píxeles) para que la ruta respire y no tape el HUD
    const padX = 140;
    const padY = 120;
    const availW = width - 2 * padX;
    const availH = height - 2 * padY;

    // Proyección Web Mercator EPSG:3857 estándar (isométrica, idéntica a Leaflet)
    const latLngToWorld = (lat: number, lng: number, z: number) => {
      const scale = 256 * Math.pow(2, z);
      const x = ((lng + 180) / 360) * scale;
      const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
      const latRad = (safeLat * Math.PI) / 180;
      const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) * 0.5 * scale;
      return { x, y };
    };

    // Determinar nivel de zoom óptimo (de 18 a 4) donde toda la ruta encaja dentro del área disponible
    let bestZoom = 18;
    for (let z = 18; z >= 4; z--) {
      const pMin = latLngToWorld(minLat, minLng, z);
      const pMax = latLngToWorld(maxLat, maxLng, z);
      const spanW = Math.abs(pMax.x - pMin.x);
      const spanH = Math.abs(pMax.y - pMin.y);
      if (spanW <= availW && spanH <= availH) {
        bestZoom = z;
        break;
      }
    }

    const centerWorld = latLngToWorld(centerLat, centerLng, bestZoom);

    // Proyección de puntos GPS a coordenadas de píxeles del Canvas centradas en (width/2, height/2)
    const proyectar = (lat: number, lng: number) => {
      const w = latLngToWorld(lat, lng, bestZoom);
      return {
        x: Math.round(width / 2 + (w.x - centerWorld.x)),
        y: Math.round(height / 2 + (w.y - centerWorld.y))
      };
    };

    const canvasPoints = points.map(p => ({
      ...proyectar(p.lat, p.lng),
      time: p.time,
      ele: p.ele
    }));

    // 2. Pre-cargar tiles cartográficos de fondo centrados en la ruta
    await this.cargarTilesFondo(ctx, centerWorld, bestZoom, width, height);

    // Guardar imagen de fondo estática para redibujado instantáneo de cada frame
    const fondoCanvas = document.createElement('canvas');
    fondoCanvas.width = width;
    fondoCanvas.height = height;
    const fondoCtx = fondoCanvas.getContext('2d')!;
    fondoCtx.drawImage(canvas, 0, 0);

    const transportIcon = this.obtenerIconoTransporte(options.transportMode || 'driving');
    const colorRuta = this.obtenerColorTransporte(options.transportMode || 'driving');

    // 3. Comprobar si podemos usar WebCodecs + mp4-muxer (Hiper rápido en Chrome/Edge)
    if (typeof (window as any).VideoEncoder === 'function') {
      return await this.codificarConWebCodecs(
        canvas,
        ctx,
        fondoCanvas,
        canvasPoints,
        totalFrames,
        fps,
        width,
        height,
        colorRuta,
        transportIcon,
        options,
        onProgress
      );
    } else {
      // Fallback estándar con MediaRecorder
      return await this.codificarConMediaRecorder(
        canvas,
        ctx,
        fondoCanvas,
        canvasPoints,
        totalFrames,
        fps,
        width,
        height,
        colorRuta,
        transportIcon,
        options,
        onProgress
      );
    }
  }

  /**
   * Codificación ultra rápida a MP4 mediante WebCodecs API + mp4-muxer.
   */
  private async codificarConWebCodecs(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    fondoCanvas: HTMLCanvasElement,
    points: Array<{ x: number; y: number }>,
    totalFrames: number,
    fps: number,
    width: number,
    height: number,
    colorRuta: string,
    transportIcon: string,
    options: RouteVideoOptions,
    onProgress?: (p: ProgresoRenderizadoRuta) => void
  ): Promise<Blob> {
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width: width,
        height: height
      },
      fastStart: 'in-memory'
    });

    const encoder = new (window as any).VideoEncoder({
      output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
      error: (e: any) => console.error('❌ [WebCodecs] Error:', e)
    });

    encoder.configure({
      codec: 'avc1.42001f', // H.264 Baseline Profile level 3.1
      width: width,
      height: height,
      bitrate: 3_000_000,
      framerate: fps
    });

    const frameDurationMicros = Math.round(1_000_000 / fps);

    for (let frame = 0; frame < totalFrames; frame++) {
      const progress = frame / (totalFrames - 1);

      // Dibujar fotograma completo
      this.dibujarFotograma(
        ctx,
        fondoCanvas,
        points,
        progress,
        width,
        height,
        colorRuta,
        transportIcon,
        options
      );

      // Crear VideoFrame nativo desde canvas
      const videoFrame = new (window as any).VideoFrame(canvas, {
        timestamp: frame * frameDurationMicros
      });

      const keyFrame = frame % 30 === 0;
      encoder.encode(videoFrame, { keyFrame });
      videoFrame.close();

      if (frame % 15 === 0) {
        const pct = 25 + Math.round((frame / totalFrames) * 55);
        onProgress?.({
          fase: 'renderizando',
          porcentaje: pct,
          mensaje: `Generando animación 60fps (${Math.round((frame / totalFrames) * 100)}%)...`
        });
      }
    }

    await encoder.flush();
    muxer.finalize();

    const buffer = muxer.target.buffer;
    return new Blob([buffer], { type: 'video/mp4' });
  }

  /**
   * Fallback con MediaRecorder para navegadores sin WebCodecs.
   */
  private async codificarConMediaRecorder(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    fondoCanvas: HTMLCanvasElement,
    points: Array<{ x: number; y: number }>,
    totalFrames: number,
    fps: number,
    width: number,
    height: number,
    colorRuta: string,
    transportIcon: string,
    options: RouteVideoOptions,
    onProgress?: (p: ProgresoRenderizadoRuta) => void
  ): Promise<Blob> {
    const stream = canvas.captureStream(fps);
    const mimeType = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_000_000 });
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    return new Promise((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      recorder.onerror = (e) => reject(e);

      recorder.start();

      let frame = 0;
      const frameInterval = 1000 / fps;

      const renderStep = () => {
        if (frame >= totalFrames) {
          recorder.stop();
          return;
        }

        const progress = frame / (totalFrames - 1);
        this.dibujarFotograma(
          ctx,
          fondoCanvas,
          points,
          progress,
          width,
          height,
          colorRuta,
          transportIcon,
          options
        );

        frame++;
        if (frame % 20 === 0) {
          const pct = 25 + Math.round((frame / totalFrames) * 55);
          onProgress?.({
            fase: 'renderizando',
            porcentaje: pct,
            mensaje: `Generando vídeo en tiempo real (${Math.round((frame / totalFrames) * 100)}%)...`
          });
        }

        setTimeout(renderStep, frameInterval);
      };

      renderStep();
    });
  }

  /**
   * Dibuja un fotograma completo: fondo cartográfico, trazado sutil completo,
   * ruta animada con halo, marcadores de parada con números, vehículo emoji móvil y HUD vintage.
   */
  private dibujarFotograma(
    ctx: CanvasRenderingContext2D,
    fondoCanvas: HTMLCanvasElement,
    points: Array<{ x: number; y: number }>,
    progress: number,
    width: number,
    height: number,
    colorRuta: string,
    transportIcon: string,
    options: RouteVideoOptions
  ): void {
    // 1. Fondo de mapa renderizado
    ctx.drawImage(fondoCanvas, 0, 0);

    // 2. Ruta completa punteada sutil (estilo mapa de ruta antiguo)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(74, 55, 35, 0.35)';
    ctx.lineWidth = 4;
    ctx.setLineDash([6, 8]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    points.forEach((p, idx) => {
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // 3. Trazado animado hasta el progreso actual
    const targetIdxFloat = progress * (points.length - 1);
    const targetIdx = Math.floor(targetIdxFloat);
    const remainder = targetIdxFloat - targetIdx;

    const currentPoints = points.slice(0, targetIdx + 1);
    let currentPos = points[0];

    if (targetIdx < points.length - 1) {
      const p1 = points[targetIdx];
      const p2 = points[targetIdx + 1];
      currentPos = {
        x: p1.x + (p2.x - p1.x) * remainder,
        y: p1.y + (p2.y - p1.y) * remainder
      };
      currentPoints.push(currentPos);
    } else if (points.length > 0) {
      currentPos = points[points.length - 1];
    }

    if (currentPoints.length > 1) {
      // Halo exterior brillante de contraste
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      currentPoints.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();

      // Línea viva de color de la ruta
      ctx.beginPath();
      ctx.strokeStyle = colorRuta;
      ctx.lineWidth = 5.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      currentPoints.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }

    // 4. Marcador de inicio (Parada de Origen: Verde Esmeralda con sombra)
    const pInicio = points[0];
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.arc(pInicio.x, pInicio.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#15803d';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    // Punto central blanco
    ctx.beginPath();
    ctx.arc(pInicio.x, pInicio.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    // 5. Marcador de destino (Parada de Fin: Rojo Carmesí con sombra)
    const pFin = points[points.length - 1];
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.arc(pFin.x, pFin.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#dc2626';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    // Punto central blanco
    ctx.beginPath();
    ctx.arc(pFin.x, pFin.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    // 6. Vehículo móvil con pulso sutil y sombra
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;

    // Disco circular blanco con borde de color
    ctx.beginPath();
    ctx.arc(currentPos.x, currentPos.y, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = colorRuta;
    ctx.stroke();

    // Icono emoji del medio de transporte centrado
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(transportIcon, currentPos.x, currentPos.y + 1);
    ctx.restore();

    // 7. HUD Vintage superpuesto (caja de instrumentos en esquina superior izquierda)
    const totalKm = options.distanciaKm || 0;
    const kmActual = totalKm * progress;

    ctx.save();
    // Tarjeta pergamino del HUD
    ctx.fillStyle = 'rgba(253, 250, 243, 0.95)';
    ctx.strokeStyle = '#8b6b46';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(43, 24, 16, 0.22)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.roundRect(28, 24, 320, 84, 10);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Marco interior sutil
    ctx.save();
    ctx.strokeStyle = 'rgba(139, 107, 70, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(33, 29, 310, 74);

    // Título del tramo
    ctx.fillStyle = '#2b1810';
    ctx.font = 'bold 15px "Cinzel", "Georgia", serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const titleText = options.titulo || 'Recorrido del viaje';
    ctx.fillText(titleText, 44, 39);

    // Kilometraje y progreso en tiempo real
    const kmStr = totalKm < 5 ? kmActual.toFixed(2) : kmActual.toFixed(1);
    const totStr = totalKm < 5 ? totalKm.toFixed(2) : totalKm.toFixed(1);
    ctx.fillStyle = '#78350f';
    ctx.font = '600 13px sans-serif';
    ctx.fillText(`${transportIcon}  ${kmStr} km / ${totStr} km (${Math.round(progress * 100)}%)`, 44, 63);

    // Mini barra de progreso estilizada dentro del HUD
    ctx.fillStyle = 'rgba(120, 53, 15, 0.15)';
    ctx.fillRect(44, 85, 288, 5);
    ctx.fillStyle = colorRuta;
    ctx.fillRect(44, 85, Math.max(5, 288 * progress), 5);
    ctx.restore();
  }

  /**
   * Descarga y compone los tiles cartográficos para el fondo del canvas usando proyección Mercator 1:1.
   */
  private async cargarTilesFondo(
    ctx: CanvasRenderingContext2D,
    centerWorld: { x: number; y: number },
    zoom: number,
    width: number,
    height: number
  ): Promise<void> {
    // Fondo de pergamino de seguridad
    ctx.fillStyle = '#f7efe0';
    ctx.fillRect(0, 0, width, height);

    try {
      const numTiles = Math.pow(2, zoom);
      const minTileX = Math.floor((centerWorld.x - width / 2) / 256);
      const maxTileX = Math.floor((centerWorld.x + width / 2) / 256);
      const minTileY = Math.floor((centerWorld.y - height / 2) / 256);
      const maxTileY = Math.floor((centerWorld.y + height / 2) / 256);

      const tilePromises: Promise<void>[] = [];
      const subdomains = ['a', 'b', 'c', 'd'];

      for (let tx = minTileX; tx <= maxTileX; tx++) {
        for (let ty = minTileY; ty <= maxTileY; ty++) {
          if (ty < 0 || ty >= numTiles) continue;
          const wrappedX = ((tx % numTiles) + numTiles) % numTiles;
          const sub = subdomains[Math.abs(wrappedX + ty) % subdomains.length];

          // CartoDB Voyager: cartografía vintage suave y cabeceras CORS libres (Access-Control-Allow-Origin: *)
          const primaryUrl = `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${wrappedX}/${ty}.png`;
          const fallbackUrl = `https://${sub}.basemaps.cartocdn.com/light_all/${zoom}/${wrappedX}/${ty}.png`;

          const tileScreenX = Math.round(width / 2 + (tx * 256 - centerWorld.x));
          const tileScreenY = Math.round(height / 2 + (ty * 256 - centerWorld.y));

          tilePromises.push(
            this.cargarTileImagenConFallback(primaryUrl, fallbackUrl).then((img) => {
              ctx.drawImage(img, tileScreenX, tileScreenY, 256, 256);
            }).catch(() => {
              // Si falla un tile individual, el tono pergamino base cubre la zona limpiamente
            })
          );
        }
      }

      await Promise.all(tilePromises);

      // Tinte pergamino sutil sobre los tiles para unificar la estética vintage del fotolibro
      ctx.save();
      ctx.fillStyle = 'rgba(247, 239, 224, 0.26)';
      ctx.fillRect(0, 0, width, height);

      // Sutil viñeta en los bordes para dar aspecto de lámina cartográfica antigua
      const grad = ctx.createRadialGradient(
        width / 2, height / 2, Math.min(width, height) * 0.45,
        width / 2, height / 2, Math.max(width, height) * 0.75
      );
      grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      grad.addColorStop(1, 'rgba(80, 50, 20, 0.16)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

    } catch (e) {
      console.warn('⚠️ [RouteVideoGenerator] Fallo cargando tiles, usando pergamino base:', e);
    }
  }

  private cargarTileImagenConFallback(primaryUrl: string, fallbackUrl: string): Promise<HTMLImageElement> {
    return this.cargarTileImagen(primaryUrl).catch(() => this.cargarTileImagen(fallbackUrl));
  }

  private cargarTileImagen(url: string): Promise<HTMLImageElement> {
    if (this.tileCache.has(url)) {
      return Promise.resolve(this.tileCache.get(url)!);
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.tileCache.set(url, img);
        resolve(img);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  private obtenerIconoTransporte(modo: string): string {
    const m = (modo || '').toLowerCase();
    if (m.includes('walk') || m.includes('andando') || m.includes('caminar') || m.includes('pie')) return '🚶';
    if (m.includes('boat') || m.includes('barco') || m.includes('crucero') || m.includes('ferry')) return '🚢';
    if (m.includes('plane') || m.includes('avion') || m.includes('vuelo')) return '✈️';
    if (m.includes('train') || m.includes('tren') || m.includes('metro')) return '🚆';
    if (m.includes('bici') || m.includes('cycling') || m.includes('bike')) return '🚴';
    return '🚗';
  }

  private obtenerColorTransporte(modo: string): string {
    const m = (modo || '').toLowerCase();
    if (m.includes('walk') || m.includes('andando') || m.includes('caminar')) return '#059669';
    if (m.includes('boat') || m.includes('barco') || m.includes('crucero')) return '#0284c7';
    if (m.includes('plane') || m.includes('avion')) return '#7c3aed';
    if (m.includes('train') || m.includes('tren')) return '#d97706';
    if (m.includes('bici') || m.includes('cycling')) return '#ea580c';
    return '#dc2626'; // Coche / default
  }
}
