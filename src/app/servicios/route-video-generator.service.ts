import { Injectable } from '@angular/core';
import { GpxAnimationService, GpxPoint } from './gpx-animation.service';
import { ActividadesItinerariosService } from './actividades-itinerarios.service';
import { firstValueFrom } from 'rxjs';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export interface RouteVideoOptions {
  trackGpx: string;
  transportMode?: string;
  transportSegments?: any[];
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
  /**
   * Calcula la duración dinámica adaptativa según la distancia del subtramo:
   * - Tramos cortos (< 500m): ~4.5s - 5.0s para apreciar el HUD y el movimiento del icono.
   * - Tramos medios (2 km -> ~7-8s).
   * - Tramos largos (> 50 km, ej. cruceros marítimos de 103 km o vuelos): Speed Multiplier automático (x4 - x8),
   *   acotando la duración del clip a un intervalo ágil de 7.0s a 9.0s para evitar esperas excesivas.
   */
  calcularDuracionDinamica(distanciaKm: number): number {
    const dist = Math.max(0.05, distanciaKm || 0.1);
    if (dist > 50) {
      const dur = 7.0 + Math.min(2.0, Math.log10(dist / 50) * 2.0);
      return Math.round(dur * 10) / 10;
    }
    const dur = 4.5 + Math.min(6.5, Math.log2(Math.max(1, dist * 2.5)) * 1.5);
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

      let points = this.gpxService.parseGpx(options.trackGpx);
      if (!points || points.length < 2) {
        throw new Error('El track GPX no contiene suficientes puntos');
      }
      if (options.transportSegments && options.transportSegments.length > 0) {
        points = this.gpxService.applyTransportSegments(points, options.transportSegments);
      }

      onProgress?.({ fase: 'descargando_tiles', porcentaje: 15, mensaje: 'Cargando cartografía base...' });
      const videoBlob = await this.renderizarVideoRuta(points, options, onProgress);

      const duracionSeg = options.duracionSegundos || this.calcularDuracionDinamica(options.distanciaKm || 0);
      const fps = options.fps || 30;

      onProgress?.({ fase: 'subiendo', porcentaje: 85, mensaje: 'Guardando vídeo de subtramo en servidor...' });
      const resp = await firstValueFrom(
        this.actividadesService.subirVideoSubtramo(actividadId, origen, destino, videoBlob, duracionSeg, fps)
      );

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

      let points = this.gpxService.parseGpx(options.trackGpx);
      if (!points || points.length < 2) {
        throw new Error('El track GPX no contiene suficientes puntos');
      }
      if (options.transportSegments && options.transportSegments.length > 0) {
        points = this.gpxService.applyTransportSegments(points, options.transportSegments);
      }

      onProgress?.({ fase: 'descargando_tiles', porcentaje: 15, mensaje: 'Cargando cartografía base...' });
      const videoBlob = await this.renderizarVideoRuta(points, options, onProgress);

      const duracionSeg = options.duracionSegundos || this.calcularDuracionDinamica(options.distanciaKm || 0);
      const fps = options.fps || 30;

      onProgress?.({ fase: 'subiendo', porcentaje: 85, mensaje: 'Guardando vídeo en servidor...' });
      const resp = await firstValueFrom(
        this.actividadesService.subirVideoSubtramo(
          actividadId,
          options.idParadaOrigen || 0,
          options.idParadaDestino || 1,
          videoBlob,
          duracionSeg,
          fps
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
   * Densifica segmentos entre puntos GPS contiguos que tengan un salto anómalo
   * superior a maxGapMeters (p.ej. pérdidas de cobertura o tramos unificados sin puntos intermedios),
   * garantizando una interpolación geométrica y temporal suave y sin parones en el vídeo.
   */
  private densificarSaltosGps(points: GpxPoint[], maxGapMeters: number = 80): GpxPoint[] {
    if (!points || points.length < 2) return points;
    const result: GpxPoint[] = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const dist = this.gpxService.getDistance(p1.lat, p1.lng, p2.lat, p2.lng);
      if (dist > maxGapMeters) {
        const steps = Math.ceil(dist / maxGapMeters);
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const lat = p1.lat + (p2.lat - p1.lat) * t;
          const lng = p1.lng + (p2.lng - p1.lng) * t;
          const distAcum = (p1.distAcum || 0) + dist * t;
          result.push({
            lat,
            lng,
            ele: p1.ele != null && p2.ele != null ? p1.ele + (p2.ele - p1.ele) * t : p1.ele,
            distAcum,
            timeAcum: (p1.timeAcum || 0) + ((p2.timeAcum || 0) - (p1.timeAcum || 0)) * t,
            mode: p1.mode || p2.mode
          });
        }
      }
      result.push(p2);
    }
    return result;
  }

  /**
   * Renderiza los fotogramas del recorrido sobre Canvas y los codifica en MP4/WebM.
   */
  async renderizarVideoRuta(
    rawPoints: GpxPoint[],
    options: RouteVideoOptions,
    onProgress?: (p: ProgresoRenderizadoRuta) => void
  ): Promise<Blob> {
    let points = rawPoints;
    if (options.transportSegments && options.transportSegments.length > 0) {
      points = this.gpxService.applyTransportSegments(points, options.transportSegments);
    }
    // Densificar cualquier salto anómalo superior a 80m para interpolación fluida y sin teletransportes
    points = this.densificarSaltosGps(points, 80);
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

    // Márgenes seguros en pantalla (en píxeles) para que la ruta respire y muestre el contexto urbano
    const padX = 220; // Espacio a los lados y para el HUD vintage
    const padY = 160; // Espacio arriba y abajo para ver el entorno geográfico
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

    // Determinar nivel de zoom óptimo (tope máximo de zoom 16 para evitar calles gigantes o zoom excesivo)
    let bestZoom = 16;
    for (let z = 16; z >= 4; z--) {
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
      ele: p.ele,
      mode: p.mode || p.hfMode || options.transportMode || 'driving',
      distAcum: p.distAcum
    }));

    // 2. Pre-cargar tiles cartográficos OpenStreetMap nativos centrados en la ruta
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
    points: Array<{ x: number; y: number; mode?: string; distAcum?: number }>,
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
      bitrate: 900_000, // ⚡ Ultra-compresión optimizada (900 kbps) para mapa vectorial estático
      bitrateMode: 'variable',
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
    points: Array<{ x: number; y: number; mode?: string; distAcum?: number }>,
    totalFrames: number,
    fps: number,
    width: number,
    height: number,
    colorRuta: string,
    transportIcon: string,
    options: RouteVideoOptions,
    onProgress?: (p: ProgresoRenderizadoRuta) => void
  ): Promise<Blob> {
    const supportsCaptureStream = typeof (canvas as any).captureStream === 'function';
    if (!supportsCaptureStream) {
      throw new Error('El navegador no soporta captureStream en Canvas');
    }

    let stream: MediaStream;
    let videoTrack: any = null;
    let usaManualFrame = false;

    try {
      stream = (canvas as any).captureStream(0);
      videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && typeof videoTrack.requestFrame === 'function') {
        usaManualFrame = true;
      } else {
        stream = (canvas as any).captureStream(fps);
      }
    } catch {
      stream = (canvas as any).captureStream(fps);
    }

    const mimeType = MediaRecorder.isTypeSupported('video/mp4')
      ? 'video/mp4'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_200_000 });
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    return new Promise(async (resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      recorder.onerror = (e) => reject(e);

      recorder.start();

      for (let frame = 0; frame < totalFrames; frame++) {
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

        if (usaManualFrame && videoTrack) {
          videoTrack.requestFrame();
        }

        if (frame % 15 === 0) {
          const pct = 25 + Math.round((frame / totalFrames) * 55);
          onProgress?.({
            fase: 'renderizando',
            porcentaje: pct,
            mensaje: `Generando animación (${Math.round((frame / totalFrames) * 100)}%)...`
          });
        }

        await new Promise(r => {
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(r);
          } else {
            setTimeout(r, 0);
          }
        });
      }

      setTimeout(() => {
        try {
          recorder.stop();
        } catch {
          resolve(new Blob(chunks, { type: mimeType }));
        }
      }, 120);
    });
  }

  /**
   * Dibuja un fotograma completo: fondo cartográfico nativo, trazado sutil,
   * ruta animada con halo, marcadores de parada con números, vehículo emoji móvil y HUD vintage.
   */
  private dibujarFotograma(
    ctx: CanvasRenderingContext2D,
    fondoCanvas: HTMLCanvasElement,
    points: Array<{ x: number; y: number; mode?: string; distAcum?: number }>,
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
    //
    // ✅ INTERPOLACIÓN POR DISTANCIA ACUMULADA (velocidad constante)
    // Si los puntos tienen distAcum, usamos la distancia total recorrida como
    // eje temporal → el avatar avanza a velocidad constante independientemente
    // de la densidad de puntos GPS.
    // Fallback: si no hay distAcum (puntos sin metadatos), se usa índice (comportamiento anterior).

    const hasDistAcum = points.length > 1 &&
      points[points.length - 1].distAcum != null &&
      (points[points.length - 1].distAcum as number) > 0;

    let targetIdx: number;
    let remainder: number;

    if (hasDistAcum) {
      // Distancia objetivo en las mismas unidades que distAcum (km)
      const totalDist = points[points.length - 1].distAcum as number;
      const targetDist = progress * totalDist;

      // Búsqueda binaria del segmento donde cae targetDist
      let lo = 0, hi = points.length - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((points[mid].distAcum as number) <= targetDist) lo = mid;
        else hi = mid - 1;
      }
      targetIdx = lo;

      const d0 = points[lo].distAcum as number;
      const d1 = (points[lo + 1]?.distAcum as number) ?? d0;
      const segLen = d1 - d0;
      remainder = segLen > 0 ? (targetDist - d0) / segLen : 0;
    } else {
      // Fallback: avance por índice (rutas sin distAcum)
      const targetIdxFloat = progress * (points.length - 1);
      targetIdx = Math.floor(targetIdxFloat);
      remainder = targetIdxFloat - targetIdx;
    }

    // Posición interpolada del vehículo y puntos ya recorridos para el trazo animado
    const currentPoints = points.slice(0, targetIdx + 1);
    let currentPos = points[0];

    if (targetIdx < points.length - 1) {
      const p1 = points[targetIdx];
      const p2 = points[targetIdx + 1];
      currentPos = {
        x: p1.x + (p2.x - p1.x) * remainder,
        y: p1.y + (p2.y - p1.y) * remainder,
        mode: p1.mode,
        distAcum: p1.distAcum
      };
      currentPoints.push(currentPos);
    } else if (points.length > 0) {
      currentPos = points[points.length - 1];
    }

    // 🌟 Modo de transporte e icono dinámicos para este fotograma exacto
    const currentPt = points[Math.min(targetIdx, points.length - 1)];
    const activeMode = currentPt?.mode || options.transportMode || 'driving';
    const activeIcon = this.obtenerIconoTransporte(activeMode);
    const activeColor = this.obtenerColorTransporte(activeMode);

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

      // Línea viva de color de la ruta segmentada por modo de transporte
      let segStartIdx = 0;
      let segMode = currentPoints[0].mode || activeMode;
      for (let i = 1; i < currentPoints.length; i++) {
        const ptMode = currentPoints[i].mode || segMode;
        if (ptMode !== segMode) {
          ctx.beginPath();
          ctx.strokeStyle = this.obtenerColorTransporte(segMode);
          ctx.lineWidth = 5.5;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (let j = segStartIdx; j <= i; j++) {
            if (j === segStartIdx) ctx.moveTo(currentPoints[j].x, currentPoints[j].y);
            else ctx.lineTo(currentPoints[j].x, currentPoints[j].y);
          }
          ctx.stroke();

          segStartIdx = i;
          segMode = ptMode;
        }
      }
      // Último tramo de la línea
      ctx.beginPath();
      ctx.strokeStyle = this.obtenerColorTransporte(segMode);
      ctx.lineWidth = 5.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let j = segStartIdx; j < currentPoints.length; j++) {
        if (j === segStartIdx) ctx.moveTo(currentPoints[j].x, currentPoints[j].y);
        else ctx.lineTo(currentPoints[j].x, currentPoints[j].y);
      }
      ctx.stroke();
    }

    // 4. Marcador de Inicio (Parada de Origen: Verde Esmeralda con número y halo)
    const pInicio = points[0];
    const numOrigen = options.idParadaOrigen != null && options.idParadaOrigen > 0 ? options.idParadaOrigen : '1';
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    // Disco blanco exterior
    ctx.beginPath();
    ctx.arc(pInicio.x, pInicio.y, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.stroke();
    // Círculo interior verde
    ctx.beginPath();
    ctx.arc(pInicio.x, pInicio.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#15803d';
    ctx.fill();
    // Número o símbolo
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${numOrigen}`, pInicio.x, pInicio.y + 0.5);
    ctx.restore();

    // 5. Marcador de Fin (Parada de Destino: Rojo Carmesí con número y halo)
    const pFin = points[points.length - 1];
    const numDestino = options.idParadaDestino != null && options.idParadaDestino > 0 ? options.idParadaDestino : '2';
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    // Disco blanco exterior
    ctx.beginPath();
    ctx.arc(pFin.x, pFin.y, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.stroke();
    // Círculo interior rojo
    ctx.beginPath();
    ctx.arc(pFin.x, pFin.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#dc2626';
    ctx.fill();
    // Número o símbolo
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${numDestino}`, pFin.x, pFin.y + 0.5);
    ctx.restore();

    // 6. Vehículo móvil con pulso y sombra 3D
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;

    // Disco circular blanco con borde de color dinámico del modo actual
    ctx.beginPath();
    ctx.arc(currentPos.x, currentPos.y, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = activeColor;
    ctx.stroke();

    // Icono emoji del medio de transporte centrado (actualizado en tiempo real por frame)
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(activeIcon, currentPos.x, currentPos.y + 1);
    ctx.restore();

    // 7. HUD Vintage (Caja de instrumentos en esquina superior izquierda)
    const totalKm = options.distanciaKm || 0;
    const kmActual = totalKm * progress;

    ctx.save();
    // Tarjeta pergamino del HUD con sombra
    ctx.fillStyle = 'rgba(253, 250, 243, 0.96)';
    ctx.strokeStyle = '#8b6b46';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(43, 24, 16, 0.25)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.roundRect(28, 24, 330, 84, 10);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Marco interior sutil
    ctx.save();
    ctx.strokeStyle = 'rgba(191, 161, 95, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(33, 29, 320, 74);

    // Título del tramo
    ctx.fillStyle = '#2b1810';
    ctx.font = 'bold 14px "Cinzel", "Georgia", serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const titleText = options.titulo || `RECORRIDO: PARADA #${numOrigen} ➔ PARADA #${numDestino}`;
    ctx.fillText(titleText, 44, 38);

    // Kilometraje y progreso en tiempo real con etiqueta de medio de transporte
    const kmStr = totalKm < 5 ? kmActual.toFixed(2) : kmActual.toFixed(1);
    const totStr = totalKm < 5 ? totalKm.toFixed(2) : totalKm.toFixed(1);
    const modoEtiqueta = this.obtenerNombreModoTransporte(activeMode);
    ctx.fillStyle = '#78350f';
    ctx.font = '600 13px sans-serif';
    ctx.fillText(`${activeIcon}  ${modoEtiqueta} · ${kmStr} km / ${totStr} km (${Math.round(progress * 100)}%)`, 44, 61);

    // Barra de progreso estilizada dentro del HUD
    ctx.fillStyle = 'rgba(120, 53, 15, 0.15)';
    ctx.fillRect(44, 83, 298, 6);
    ctx.fillStyle = activeColor;
    ctx.fillRect(44, 83, Math.max(6, 298 * progress), 6);
    ctx.restore();
  }

  /**
   * Descarga y compone los tiles cartográficos para el fondo del canvas usando OpenStreetMap nativo 1:1.
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
      const subdomains = ['a', 'b', 'c'];

      for (let tx = minTileX; tx <= maxTileX; tx++) {
        for (let ty = minTileY; ty <= maxTileY; ty++) {
          if (ty < 0 || ty >= numTiles) continue;
          const wrappedX = ((tx % numTiles) + numTiles) % numTiles;
          const sub = subdomains[Math.abs(wrappedX + ty) % subdomains.length];

          // OpenStreetMap oficial (CORS abierto, nítido a 256x256, sin marcas de agua de CartoDB)
          const primaryUrl = `https://${sub}.tile.openstreetmap.org/${zoom}/${wrappedX}/${ty}.png`;
          const fallbackUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${zoom}/${ty}/${wrappedX}`;

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

      // Tinte pergamino sutil sobre los tiles para integrar con el estilo vintage del fotolibro
      ctx.save();
      ctx.fillStyle = 'rgba(247, 239, 224, 0.16)';
      ctx.fillRect(0, 0, width, height);

      // Sutil viñeta en los bordes para dar aspecto de mapa antiguo
      const grad = ctx.createRadialGradient(
        width / 2, height / 2, Math.min(width, height) * 0.45,
        width / 2, height / 2, Math.max(width, height) * 0.75
      );
      grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      grad.addColorStop(1, 'rgba(80, 50, 20, 0.12)');
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
    if (m.includes('boat') || m.includes('barco') || m.includes('crucero') || m.includes('ship') || m.includes('ferry') || m.includes('mar') || m.includes('embarc') || m.includes('kayak')) return '🚢';
    if (m.includes('plane') || m.includes('avion') || m.includes('vuelo') || m.includes('flight')) return '✈️';
    if (m.includes('train') || m.includes('tren') || m.includes('metro') || m.includes('ferrocarril')) return '🚆';
    if (m.includes('bici') || m.includes('cycling') || m.includes('bike') || m.includes('bicycle')) return '🚴';
    if (m.includes('bus') || m.includes('autobus') || m.includes('autocar')) return '🚌';
    if (m.includes('walk') || m.includes('andando') || m.includes('caminar') || m.includes('pie')) return '🚶';
    if (m.includes('coche') || m.includes('car') || m.includes('driving') || m.includes('auto') || m.includes('taxi')) return '🚗';
    return '🚗';
  }

  private obtenerColorTransporte(modo: string): string {
    const m = (modo || '').toLowerCase();
    if (m.includes('boat') || m.includes('barco') || m.includes('crucero') || m.includes('ship') || m.includes('ferry') || m.includes('mar') || m.includes('embarc')) return '#0284c7';
    if (m.includes('plane') || m.includes('avion') || m.includes('vuelo') || m.includes('flight')) return '#7c3aed';
    if (m.includes('train') || m.includes('tren') || m.includes('metro') || m.includes('ferrocarril')) return '#d97706';
    if (m.includes('bici') || m.includes('cycling') || m.includes('bike') || m.includes('bicycle')) return '#ea580c';
    if (m.includes('bus') || m.includes('autobus') || m.includes('autocar')) return '#a855f7';
    if (m.includes('walk') || m.includes('andando') || m.includes('caminar') || m.includes('pie')) return '#059669';
    return '#dc2626'; // Coche / default
  }

  private obtenerNombreModoTransporte(modo: string): string {
    const m = (modo || '').toLowerCase();
    if (m.includes('boat') || m.includes('barco') || m.includes('crucero') || m.includes('ship') || m.includes('ferry') || m.includes('mar')) return 'En Barco';
    if (m.includes('plane') || m.includes('avion') || m.includes('vuelo') || m.includes('flight')) return 'En Vuelo';
    if (m.includes('train') || m.includes('tren') || m.includes('metro')) return 'En Tren';
    if (m.includes('bici') || m.includes('cycling') || m.includes('bike')) return 'En Bicicleta';
    if (m.includes('bus') || m.includes('autobus') || m.includes('autocar')) return 'En Autobús';
    if (m.includes('walk') || m.includes('andando') || m.includes('caminar') || m.includes('pie')) return 'A pie';
    return 'En Ruta';
  }
}
