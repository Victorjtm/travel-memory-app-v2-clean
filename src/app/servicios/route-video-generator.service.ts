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
      const resp = await firstValueFrom(this.actividadesService.subirVideoRuta(actividadId, videoBlob));

      onProgress?.({ fase: 'completado', porcentaje: 100, mensaje: '¡Vídeo listo!' });
      return resp.url;
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
    const duracionSeg = options.duracionSegundos || 7;
    const totalFrames = fps * duracionSeg;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    // 1. Calcular Bounding Box y Proyección
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }

    // Margen del 15% para que la ruta respire
    const latSpan = Math.max(maxLat - minLat, 0.005);
    const lngSpan = Math.max(maxLng - minLng, 0.005);
    const padLat = latSpan * 0.18;
    const padLng = lngSpan * 0.18;

    const bounds = {
      minLat: minLat - padLat,
      maxLat: maxLat + padLat,
      minLng: minLng - padLng,
      maxLng: maxLng + padLng
    };

    // Pre-calcular coordenadas XY en el canvas
    const proyectar = (lat: number, lng: number) => {
      const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * (width - 120) + 60;
      // Invertir Y (latitud mayor arriba)
      const y = ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat)) * (height - 120) + 60;
      return { x, y };
    };

    const canvasPoints = points.map(p => ({
      ...proyectar(p.lat, p.lng),
      time: p.time,
      ele: p.ele
    }));

    // 2. Pre-cargar tiles de mapa de fondo
    await this.cargarTilesFondo(ctx, bounds, width, height);

    // Guardar imagen de fondo estática para redibujado instantáneo
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

      // Dibujar fotograma
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
   * Dibuja un fotograma completo: fondo, ruta base, ruta animada, marcador y HUD vintage.
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
    // 1. Fondo de mapa
    ctx.drawImage(fondoCanvas, 0, 0);

    // 2. Ruta completa punteada sutil
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(74, 85, 104, 0.4)';
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
      // Sombra exterior
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      currentPoints.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();

      // Línea viva de color
      ctx.beginPath();
      ctx.strokeStyle = colorRuta;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      currentPoints.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }

    // 4. Marcador de inicio (verde)
    const pInicio = points[0];
    ctx.beginPath();
    ctx.arc(pInicio.x, pInicio.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#16a34a';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // 5. Marcador de destino (rojo/meta)
    const pFin = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(pFin.x, pFin.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#dc2626';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // 6. Vehículo / Marcador animado con pulso
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;

    // Halo blanco
    ctx.beginPath();
    ctx.arc(currentPos.x, currentPos.y, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = colorRuta;
    ctx.stroke();

    // Icono emoji centrado
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(transportIcon, currentPos.x, currentPos.y + 1);
    ctx.restore();

    // 7. HUD Vintage superpuesto (esquina superior izquierda)
    const totalKm = options.distanciaKm || 0;
    const kmActual = totalKm * progress;

    ctx.save();
    ctx.fillStyle = 'rgba(253, 250, 243, 0.92)';
    ctx.strokeStyle = 'rgba(139, 107, 70, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(24, 24, 300, 72, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#2b1810';
    ctx.font = 'bold 15px "Cinzel", "Georgia", serif';
    ctx.textAlign = 'left';
    ctx.fillText(options.titulo || 'Recorrido del viaje', 40, 50);

    ctx.fillStyle = '#78350f';
    ctx.font = '13px sans-serif';
    ctx.fillText(`${transportIcon}  ${kmActual.toFixed(1)} km / ${totalKm.toFixed(1)} km (${Math.round(progress * 100)}%)`, 40, 75);
    ctx.restore();
  }

  /**
   * Descarga y compone los tiles cartográficos para el fondo del canvas.
   */
  private async cargarTilesFondo(
    ctx: CanvasRenderingContext2D,
    bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
    width: number,
    height: number
  ): Promise<void> {
    // Fondo de pergamino de seguridad
    ctx.fillStyle = '#f7efe0';
    ctx.fillRect(0, 0, width, height);

    try {
      // Calcular zoom óptimo
      const latDiff = bounds.maxLat - bounds.minLat;
      const lngDiff = bounds.maxLng - bounds.minLng;
      const maxDiff = Math.max(latDiff, lngDiff);
      let zoom = Math.floor(Math.log2(360 / maxDiff)) - 1;
      zoom = Math.max(2, Math.min(15, zoom));

      const latLngToTile = (lat: number, lng: number, z: number) => {
        const x = Math.floor(((lng + 180) / 360) * Math.pow(2, z));
        const latRad = (lat * Math.PI) / 180;
        const y = Math.floor(
          ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, z)
        );
        return { x, y };
      };

      const minTile = latLngToTile(bounds.maxLat, bounds.minLng, zoom);
      const maxTile = latLngToTile(bounds.minLat, bounds.maxLng, zoom);

      const tilePromises: Promise<void>[] = [];
      const numTiles = Math.pow(2, zToNum(zoom));

      for (let tx = minTile.x; tx <= maxTile.x; tx++) {
        for (let ty = minTile.y; ty <= maxTile.y; ty++) {
          const tileX = ((tx % numTiles) + numTiles) % numTiles;
          const tileY = ty;
          const tileUrl = `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`;

          tilePromises.push(
            this.cargarTileImagen(tileUrl).then((img) => {
              // Calcular posición proyectada del tile
              const nwLng = (tx / numTiles) * 360 - 180;
              const nLatRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / numTiles)));
              const nwLat = (nLatRad * 180) / Math.PI;

              const seLng = ((tx + 1) / numTiles) * 360 - 180;
              const sLatRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + 1)) / numTiles)));
              const seLat = (sLatRad * 180) / Math.PI;

              const p1 = {
                x: ((nwLng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * (width - 120) + 60,
                y: ((bounds.maxLat - nwLat) / (bounds.maxLat - bounds.minLat)) * (height - 120) + 60
              };
              const p2 = {
                x: ((seLng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * (width - 120) + 60,
                y: ((bounds.maxLat - seLat) / (bounds.maxLat - bounds.minLat)) * (height - 120) + 60
              };

              ctx.drawImage(img, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
            }).catch(() => {
              // Si falla un tile, se mantiene el tono pergamino
            })
          );
        }
      }

      await Promise.all(tilePromises);

      // Tinte pergamino sutil sobre los tiles para mantener la estética vintage
      ctx.fillStyle = 'rgba(247, 239, 224, 0.22)';
      ctx.fillRect(0, 0, width, height);

    } catch (e) {
      console.warn('⚠️ [RouteVideoGenerator] Fallo cargando tiles, usando pergamino base:', e);
    }
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

function zToNum(z: number): number {
  return z;
}
