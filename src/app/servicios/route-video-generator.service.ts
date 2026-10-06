import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { GpxAnimationService, GpxPoint } from './gpx-animation.service';
import { ActividadesItinerariosService } from './actividades-itinerarios.service';
import { GeocodificacionService, InfoUbicacionRuta } from './geocodificacion.service';
import { firstValueFrom } from 'rxjs';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { environment } from '../../environments/environment';

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
  /** Dirección completa del punto de inicio (calle, localidad, provincia) */
  origenDireccion?: string;
  /** Dirección completa del punto de destino (calle, localidad, provincia) */
  destinoDireccion?: string;
  /** Información estructurada de ubicación del punto de inicio (calle, pueblo, provincia) */
  origenInfo?: InfoUbicacionRuta;
  /** Información estructurada de ubicación del punto de destino (calle, pueblo, provincia) */
  destinoInfo?: InfoUbicacionRuta;
  /** Fecha del tramo en formato YYYY-MM-DD para el HUD */
  fecha?: string;
  horaSalida?: string;
  horaLlegada?: string;
}

export interface ProgresoRenderizadoRuta {
  fase: 'preparando' | 'descargando_tiles' | 'renderizando' | 'codificando' | 'subiendo' | 'completado' | 'error';
  porcentaje: number;
  mensaje: string;
}

export interface PuntoClaveMapa {
  numero?: number;
  nombre: string;
  lat: number;
  lng: number;
  subtexto?: string;
  color?: string;
}

@Injectable({
  providedIn: 'root'
})
export class RouteVideoGeneratorService {
  private tileCache = new Map<string, HTMLImageElement>();

  constructor(
    private http: HttpClient,
    private gpxService: GpxAnimationService,
    private actividadesService: ActividadesItinerariosService,
    private geocodificacionService: GeocodificacionService
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
      const dur = 5.0 + Math.min(2.0, Math.log10(dist / 50) * 1.5);
      return Math.round(dur * 10) / 10;
    }
    // Progresión ágil, rápida y dinámica para mayor velocidad del avatar:
    // - Tramos cortos (< 1 km): ~2.8s a 3.8s
    // - Tramos medios (2 a 5 km): ~4.8s a 5.9s
    // - Tramos largos (10 a 50 km): ~6.5s a 7.0s
    const dur = 2.8 + Math.min(4.2, Math.log2(Math.max(1, dist * 2.0)) * 1.05);
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

    // ✨ Recalcular distAcum estrictamente continuo y monotónico desde 0
    let distAcum = 0;
    points[0].distAcum = 0;
    for (let i = 1; i < points.length; i++) {
      const d = this.gpxService.getDistance(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
      distAcum += d;
      points[i].distAcum = distAcum;
    }

    // Resolución panorámica 2.22:1 optimizada para cubrir el pliego completo de ambas páginas del libro (1600x720)
    const width = options.width || 1600;
    const height = options.height || 720;
    const fps = options.fps || 30;
    const duracionSeg = options.duracionSegundos || this.calcularDuracionDinamica(options.distanciaKm || (distAcum / 1000));

    // 🛡️ REGLA CRÍTICA: El avatar DEBE llegar desde el punto A de inicio hasta el punto B de destino
    // y mantenerse firmemente allí descansando al 100% durante 1.4s para contemplar la llegada.
    const holdEndSeconds = 1.4;
    const holdFrames = Math.round(fps * holdEndSeconds);
    const travelFrames = Math.max(Math.round(fps * 2.5), Math.round(fps * duracionSeg));
    const totalFrames = travelFrames + holdFrames;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    // 0. Asegurar información estructurada de Salida (Punto A) y Llegada (Punto B)
    let infoOrigen = options.origenInfo;
    let infoDestino = options.destinoInfo;

    if (!infoOrigen && points.length > 0) {
      if (options.origenDireccion) {
        infoOrigen = this.geocodificacionService.parsearDireccionTexto(options.origenDireccion);
      } else {
        try {
          infoOrigen = await this.geocodificacionService.obtenerInfoUbicacionPunto(points[0].lat, points[0].lng);
        } catch (e) {
          console.warn('⚠️ No se pudo geocodificar punto A:', e);
        }
      }
    }

    if (!infoDestino && points.length > 0) {
      const pUltimo = points[points.length - 1];
      if (options.destinoDireccion) {
        infoDestino = this.geocodificacionService.parsearDireccionTexto(options.destinoDireccion);
      } else {
        try {
          infoDestino = await this.geocodificacionService.obtenerInfoUbicacionPunto(pUltimo.lat, pUltimo.lng);
        } catch (e) {
          console.warn('⚠️ No se pudo geocodificar punto B:', e);
        }
      }
    }

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

    // Márgenes optimizados para móvil: reducimos el margen cartográfico vacío
    // para que la ruta y los puntos se vean más cercanos y destacados.
    const padX = 65;       // Espacio lateral compacto
    const padTop = 100;    // Espacio vertical superior para tarjeta de Salida/Llegada y HUD
    const padBottom = 65;  // Espacio vertical inferior
    const availW = width - 2 * padX;
    const availH = height - (padTop + padBottom);

    // Proyección Web Mercator EPSG:3857 estándar (isométrica, idéntica a Leaflet)
    const latLngToWorld = (lat: number, lng: number, z: number) => {
      const scale = 256 * Math.pow(2, z);
      const x = ((lng + 180) / 360) * scale;
      const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
      const latRad = (safeLat * Math.PI) / 180;
      const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) * 0.5 * scale;
      return { x, y };
    };

    // Determinar nivel de zoom óptimo con mayor proximidad (zoom hasta 17 para máxima visibilidad en móvil)
    let bestZoom = 17;
    for (let z = 17; z >= 4; z--) {
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

    // Proyección de puntos GPS a coordenadas de píxeles del Canvas con compensación vertical
    const offsetYCentro = (padTop - padBottom) / 2;
    const proyectar = (lat: number, lng: number) => {
      const w = latLngToWorld(lat, lng, bestZoom);
      return {
        x: Math.round(width / 2 + (w.x - centerWorld.x)),
        y: Math.round((height / 2 + offsetYCentro) + (w.y - centerWorld.y))
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
        travelFrames,
        totalFrames,
        fps,
        width,
        height,
        colorRuta,
        transportIcon,
        options,
        infoOrigen,
        infoDestino,
        onProgress
      );
    } else {
      // Fallback estándar con MediaRecorder
      return await this.codificarConMediaRecorder(
        canvas,
        ctx,
        fondoCanvas,
        canvasPoints,
        travelFrames,
        totalFrames,
        fps,
        width,
        height,
        colorRuta,
        transportIcon,
        options,
        infoOrigen,
        infoDestino,
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
    travelFrames: number,
    totalFrames: number,
    fps: number,
    width: number,
    height: number,
    colorRuta: string,
    transportIcon: string,
    options: RouteVideoOptions,
    infoOrigen?: InfoUbicacionRuta,
    infoDestino?: InfoUbicacionRuta,
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
      // De 0 a travelFrames - 1: progreso de 0 a 1.0. A partir de travelFrames: se mantiene en 1.0 (en destino B)
      const progress = frame < travelFrames
        ? frame / Math.max(1, travelFrames - 1)
        : 1.0;

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
        options,
        infoOrigen,
        infoDestino
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
    travelFrames: number,
    totalFrames: number,
    fps: number,
    width: number,
    height: number,
    colorRuta: string,
    transportIcon: string,
    options: RouteVideoOptions,
    infoOrigen?: InfoUbicacionRuta,
    infoDestino?: InfoUbicacionRuta,
    onProgress?: (p: ProgresoRenderizadoRuta) => void
  ): Promise<Blob> {
    const stream = (canvas as any).captureStream ? (canvas as any).captureStream(0) : canvas.captureStream(fps);
    const videoTrack = stream.getVideoTracks()[0];
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

    return new Promise((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      recorder.onerror = (e) => reject(e);

      recorder.start();

      let frame = 0;
      const frameInterval = 1000 / fps;

      const renderStep = () => {
        if (frame >= totalFrames) {
          setTimeout(() => {
            try {
              recorder.stop();
            } catch {
              resolve(new Blob(chunks, { type: mimeType }));
            }
          }, 150);
          return;
        }

        const progress = frame < travelFrames
          ? frame / Math.max(1, travelFrames - 1)
          : 1.0;
        this.dibujarFotograma(
          ctx,
          fondoCanvas,
          points,
          progress,
          width,
          height,
          colorRuta,
          transportIcon,
          options,
          infoOrigen,
          infoDestino
        );

        if (videoTrack && (videoTrack as any).requestFrame) {
          (videoTrack as any).requestFrame();
        }

        frame++;
        if (frame % 15 === 0) {
          const pct = 25 + Math.round((frame / totalFrames) * 55);
          onProgress?.({
            fase: 'renderizando',
            porcentaje: pct,
            mensaje: `Generando vídeo (${Math.round((frame / totalFrames) * 100)}%)...`
          });
        }

        setTimeout(renderStep, frameInterval);
      };

      renderStep();
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
    options: RouteVideoOptions,
    infoOrigen?: InfoUbicacionRuta,
    infoDestino?: InfoUbicacionRuta
  ): void {
    // 1. Fondo de mapa renderizado
    ctx.drawImage(fondoCanvas, 0, 0);

    // 2. Ruta completa punteada sutil (estilo mapa de ruta antiguo)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(74, 55, 35, 0.40)';
    ctx.lineWidth = 7;
    ctx.setLineDash([10, 12]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    points.forEach((p, idx) => {
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // 3. Trazado animado hasta el progreso actual
    const hasDistAcum = points.length > 1 &&
      points[points.length - 1].distAcum != null &&
      (points[points.length - 1].distAcum as number) > 0;

    let targetIdx: number;
    let remainder: number;

    if (hasDistAcum) {
      const startDist = (points[0].distAcum as number) || 0;
      const endDist = points[points.length - 1].distAcum as number;
      const totalDist = Math.max(1, endDist - startDist);
      const safeProgress = Math.max(0, Math.min(1, progress));
      const targetDist = startDist + safeProgress * totalDist;

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
      remainder = segLen > 0 ? Math.max(0, Math.min(1, (targetDist - d0) / segLen)) : 0;
    } else {
      const safeProgress = Math.max(0, Math.min(1, progress));
      const targetIdxFloat = safeProgress * (points.length - 1);
      targetIdx = Math.floor(targetIdxFloat);
      remainder = targetIdxFloat - targetIdx;
    }

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

    // Modo de transporte e icono dinámicos para este fotograma exacto
    const currentPt = points[Math.min(targetIdx, points.length - 1)];
    const activeMode = currentPt?.mode || options.transportMode || 'driving';
    const activeIcon = this.obtenerIconoTransporte(activeMode);
    const activeColor = this.obtenerColorTransporte(activeMode);

    if (currentPoints.length > 1) {
      // Halo exterior brillante de contraste (más grueso para máxima legibilidad en pantallas de móvil)
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.98)';
      ctx.lineWidth = 22;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      currentPoints.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();

      // Línea viva de color de la ruta segmentada por modo de transporte (grosor 15px de alto impacto)
      let segStartIdx = 0;
      let segMode = currentPoints[0].mode || activeMode;
      for (let i = 1; i < currentPoints.length; i++) {
        const ptMode = currentPoints[i].mode || activeMode;
        if (ptMode !== segMode) {
          ctx.beginPath();
          ctx.strokeStyle = this.obtenerColorTransporte(segMode);
          ctx.lineWidth = 15;
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
      ctx.beginPath();
      ctx.strokeStyle = this.obtenerColorTransporte(segMode);
      ctx.lineWidth = 15;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let j = segStartIdx; j < currentPoints.length; j++) {
        if (j === segStartIdx) ctx.moveTo(currentPoints[j].x, currentPoints[j].y);
        else ctx.lineTo(currentPoints[j].x, currentPoints[j].y);
      }
      ctx.stroke();
    }

    // ── Helper: dibuja una tarjeta de dirección destacada y perfectamente encuadrada sobre el canvas ──
    const dibujarTarjetaPunto = (
      cx: number, cy: number,
      tipo: 'origen' | 'destino',
      info?: InfoUbicacionRuta | null,
      direccionPlana?: string,
      colorTema: string = '#15803d',
      radioMarcador: number = 32,
      forzarAbajo: boolean = false
    ) => {
      const datos: InfoUbicacionRuta = info && (info.linea1 || info.nombreCompleto)
        ? info
        : this.geocodificacionService.parsearDireccionTexto(direccionPlana || '');

      let linea1 = datos?.linea1 || datos?.nombreCompleto || '';
      let linea2 = datos?.linea2 || '';

      // Si linea1 contiene solo coordenadas numéricas, sustituir por descripción limpia
      if (/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(linea1.trim()) || !linea1) {
        linea1 = tipo === 'origen' ? 'Inicio del trayecto' : 'Destino del trayecto';
        linea2 = '';
      }

      const hora = tipo === 'origen' ? options.horaSalida : options.horaLlegada;
      const horaStr = hora ? ` · ${hora} h` : '';
      const badgeTexto = tipo === 'origen'
        ? `🟢 PUNTO A · SALIDA${horaStr}`
        : `🏁 PUNTO B · LLEGADA${horaStr}`;

      ctx.save();
      // Tipografía de alta escala optimizada para pantallas pequeñas de smartphones
      ctx.font = 'bold 15px sans-serif';
      const badgeW = ctx.measureText(badgeTexto).width + 28;

      ctx.font = 'bold 24px sans-serif';
      const l1W = ctx.measureText(linea1).width;

      ctx.font = '600 18.5px sans-serif';
      const l2W = linea2 ? ctx.measureText(linea2).width : 0;

      const contentW = Math.max(badgeW, l1W, l2W);
      const cardW = Math.max(340, Math.min(540, contentW + 48));
      const cardH = linea2 ? 112 : 84;

      // Determinación de posición vertical:
      let colocarArriba = !forzarAbajo;
      let by = cy - radioMarcador - 16 - cardH;

      // Si se saldría por arriba del marco o colisionaría con el HUD superior izquierdo:
      const solapaHUD = cx < 490 && by < 135;
      if (forzarAbajo || by < 16 || solapaHUD) {
        by = cy + radioMarcador + 16;
        colocarArriba = false;
      }

      // Asegurar que no se sale por el borde inferior
      if (by + cardH > height - 12) {
        by = Math.max(12, height - cardH - 12);
      }

      // Encuadre horizontal dentro del canvas
      let bx = cx - cardW / 2;
      bx = Math.max(16, Math.min(width - cardW - 16, bx));

      // Sombra flotante tipo tarjeta moderna de alto contraste
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 8;

      // Fondo de la tarjeta (blanco cálido satinado)
      ctx.beginPath();
      ctx.roundRect(bx, by, cardW, cardH, 12);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.99)';
      ctx.fill();

      // Borde temático distintivo grueso (verde salida / rojo llegada)
      ctx.lineWidth = 4;
      ctx.strokeStyle = colorTema;
      ctx.stroke();

      // Triángulo puntero hacia el centro del marcador
      ctx.beginPath();
      const tSize = 12;
      const tApexX = Math.max(bx + 28, Math.min(bx + cardW - 28, cx));

      if (colocarArriba) {
        ctx.moveTo(tApexX - tSize, by + cardH);
        ctx.lineTo(tApexX + tSize, by + cardH);
        ctx.lineTo(tApexX, by + cardH + tSize);
      } else {
        ctx.moveTo(tApexX - tSize, by);
        ctx.lineTo(tApexX + tSize, by);
        ctx.lineTo(tApexX, by - tSize);
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.99)';
      ctx.fill();
      ctx.stroke();

      ctx.restore();
      ctx.save();

      // 1. Badge cabecera (Pill coloreado grande)
      const badgeX = bx + 16;
      const badgeY = by + 10;
      const badgeH = 26;
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 7);
      ctx.fillStyle = colorTema;
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeTexto, badgeX + badgeW / 2, badgeY + badgeH / 2 + 0.5);

      // 2. Línea 1: Dirección / Calle o PDI (negrita, alto contraste, 23px)
      const textX = bx + 16;
      const maxTextW = cardW - 32;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 23px sans-serif';

      let l1Cortada = linea1;
      while (ctx.measureText(l1Cortada).width > maxTextW && l1Cortada.length > 4) {
        l1Cortada = l1Cortada.slice(0, -2) + '…';
      }
      ctx.fillText(l1Cortada, textX, by + 52);

      // 3. Línea 2: Pueblo y Provincia (gris pizarra semi-bold, 18px)
      if (linea2) {
        ctx.fillStyle = '#475569';
        ctx.font = '600 18px sans-serif';
        let l2Cortada = linea2;
        while (ctx.measureText(l2Cortada).width > maxTextW && l2Cortada.length > 4) {
          l2Cortada = l2Cortada.slice(0, -2) + '…';
        }
        ctx.fillText(l2Cortada, textX, by + 86);
      }

      ctx.restore();
    };

    // 4. Marcador de Inicio (Parada de Origen: Verde Esmeralda con halo)
    const pInicio = points[0];
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 5;
    // Disco blanco exterior (32px radio)
    ctx.beginPath();
    ctx.arc(pInicio.x, pInicio.y, 32, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.stroke();
    // Círculo interior verde
    ctx.beginPath();
    ctx.arc(pInicio.x, pInicio.y, 24, 0, Math.PI * 2);
    ctx.fillStyle = '#15803d';
    ctx.fill();
    ctx.restore();
    // Letra A identificadora grande
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('A', pInicio.x, pInicio.y + 0.5);
    ctx.restore();

    // 5. Marcador de Fin (Punto B: Rojo Carmesí)
    const pFin = points[points.length - 1];
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 5;
    // Disco blanco exterior
    ctx.beginPath();
    ctx.arc(pFin.x, pFin.y, 32, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.stroke();
    // Círculo interior rojo
    ctx.beginPath();
    ctx.arc(pFin.x, pFin.y, 24, 0, Math.PI * 2);
    ctx.fillStyle = '#dc2626';
    ctx.fill();
    ctx.restore();
    // Letra B identificadora grande
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('B', pFin.x, pFin.y + 0.5);
    ctx.restore();

    // Proximidad geométrica entre Punto A y Punto B
    const puntosMuyCercanos = Math.abs(pInicio.x - pFin.x) < 320 && Math.abs(pInicio.y - pFin.y) < 180;

    // Renderizado de las tarjetas destacadas sobre el Punto A y el Punto B
    dibujarTarjetaPunto(
      pInicio.x, pInicio.y,
      'origen',
      infoOrigen,
      options.origenDireccion,
      '#15803d',
      32,
      false
    );

    dibujarTarjetaPunto(
      pFin.x, pFin.y,
      'destino',
      infoDestino,
      options.destinoDireccion,
      '#dc2626',
      32,
      puntosMuyCercanos
    );

    // 6. Vehículo móvil con pulso y sombra 3D (escala aumentada para pantallas de móvil)
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.50)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 7;

    // Pulso exterior animado
    const pulsePct = (progress * 12) % 1;
    const pulseR = 44 + pulsePct * 20;
    ctx.beginPath();
    ctx.arc(currentPos.x, currentPos.y, pulseR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${activeColor.startsWith('#') ? this.hexToRgb(activeColor) : '220,38,38'}, ${0.5 * (1 - pulsePct)})`;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Disco circular blanco con borde de color dinámico del modo actual
    ctx.beginPath();
    ctx.arc(currentPos.x, currentPos.y, 42, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = activeColor;
    ctx.stroke();
    ctx.restore();

    // Emoji o icono vectorial de transporte aumentado
    ctx.save();
    ctx.font = '40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(activeIcon, currentPos.x, currentPos.y + 1);
    ctx.restore();

    // 7. HUD Vintage mejorado (panel superior izquierdo con telemetría)
    const totalKm = options.distanciaKm || 0;
    const kmActual = totalKm * progress;
    const duracionSeg = options.duracionSegundos || this.calcularDuracionDinamica(totalKm);
    const elapsedSeg = duracionSeg * progress;
    const velocidadKmh = duracionSeg > 0 ? (totalKm / duracionSeg) * 3600 : 0;
    const modoEtiqueta = this.obtenerNombreModoTransporte(activeMode);

    // Formatear cronómetro HH:MM:SS
    const hh = Math.floor(elapsedSeg / 3600);
    const mm = Math.floor((elapsedSeg % 3600) / 60);
    const ss = Math.floor(elapsedSeg % 60);
    const cronoStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

    // Formatear fecha del tramo (si disponible)
    let fechaStr = '';
    if (options.fecha) {
      const parts = options.fecha.split('-');
      if (parts.length === 3) {
        fechaStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
    }

    const kmStr = totalKm < 5 ? kmActual.toFixed(2) : kmActual.toFixed(1);
    const totStr = totalKm < 5 ? totalKm.toFixed(2) : totalKm.toFixed(1);
    const kmhStr = velocidadKmh < 10 ? velocidadKmh.toFixed(1) : Math.round(velocidadKmh).toString();

    ctx.save();
    // Panel HUD ampliado (2 filas de datos)
    ctx.fillStyle = 'rgba(15, 12, 8, 0.82)'; // fondo oscuro semiopaco tipo dashcam
    ctx.strokeStyle = activeColor;
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    ctx.roundRect(20, 16, 420, 96, 10);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.save();

    // ── Fila 1: Icono + Modo + Fecha + Cronómetro ─────────────────────────────
    const f1y = 38;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // Icono de transporte (emoji)
    ctx.font = '18px sans-serif';
    ctx.fillText(activeIcon, 34, f1y);

    // Nombre del modo
    ctx.fillStyle = '#f0e8d8';
    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.fillText(modoEtiqueta.toUpperCase(), 60, f1y);

    // Separador
    ctx.fillStyle = 'rgba(240,232,216,0.4)';
    ctx.fillRect(185, f1y - 9, 1, 18);

    // Fecha
    if (fechaStr) {
      ctx.fillStyle = '#c9b88a';
      ctx.font = '12px "Courier New", monospace';
      ctx.fillText(`📅 ${fechaStr}`, 194, f1y);
    }

    // Separador
    ctx.fillStyle = 'rgba(240,232,216,0.4)';
    ctx.fillRect(300, f1y - 9, 1, 18);

    // Cronómetro
    ctx.fillStyle = '#7dffb0';
    ctx.font = 'bold 15px "Courier New", monospace';
    ctx.fillText(`⏱ ${cronoStr}`, 310, f1y);

    // ── Fila 2: Velocidad + Distancia + Barra de progreso ─────────────────────
    const f2y = 68;

    // Velocidad instantánea
    ctx.fillStyle = '#ffd060';
    ctx.font = 'bold 18px "Courier New", monospace';
    ctx.fillText(`${kmhStr}`, 34, f2y);
    ctx.fillStyle = '#c9b88a';
    ctx.font = '11px "Courier New", monospace';
    ctx.fillText('km/h', 34 + ctx.measureText(kmhStr).width + 3, f2y + 1);

    // Separador
    ctx.fillStyle = 'rgba(240,232,216,0.4)';
    ctx.fillRect(120, f2y - 10, 1, 20);

    // Distancia
    ctx.fillStyle = '#f0e8d8';
    ctx.font = '13px "Courier New", monospace';
    ctx.fillText(`📍 ${kmStr} / ${totStr} km`, 128, f2y);

    // Separador
    ctx.fillStyle = 'rgba(240,232,216,0.4)';
    ctx.fillRect(310, f2y - 10, 1, 20);

    // Porcentaje
    ctx.fillStyle = '#c9b88a';
    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.fillText(`${Math.round(progress * 100)}%`, 318, f2y);

    // ── Barra de progreso inferior ─────────────────────────────────────────────
    const barY = 92;
    const barX = 20;
    const barW = 420;
    const barH = 6;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(barX, barY, barW, barH);
    // Gradiente de progreso
    const grad = ctx.createLinearGradient(barX, 0, barX + barW * progress, 0);
    grad.addColorStop(0, activeColor);
    grad.addColorStop(1, '#ffffff');
    ctx.fillStyle = grad;
    ctx.fillRect(barX, barY, Math.max(barH, barW * progress), barH);

    ctx.restore();
  }

  /** Convierte un color hex #rrggbb a string "r,g,b" para rgba() */
  private hexToRgb(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r},${g},${b}`;
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

          // Satélite Esri (CORS abierto, nítido y de alta definición) con fallback a OpenStreetMap
          const primaryUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${wrappedX}`;
          const fallbackUrl = `https://${sub}.tile.openstreetmap.org/${zoom}/${wrappedX}/${ty}.png`;

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
  /**
   * Genera una imagen estática ultra nítida de un mapa general o itinerario
   * con la cartografía satélite/calles, el recorrido completo en dorado/carmesí,
   * y una cabecera con el título del viaje o itinerario.
   */
  public async generarSnapshotMapa(
    trackGpx: string,
    titulo: string,
    subtitulo: string = '',
    distanciaKm?: number,
    width: number = 1920,
    height: number = 1080,
    puntosClave?: PuntoClaveMapa[]
  ): Promise<HTMLImageElement> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    await this.renderizarSnapshotMapaEnCanvas(canvas, ctx, trackGpx, titulo, subtitulo, distanciaKm, width, height, puntosClave);
    return await this.canvasAImagen(canvas);
  }

  /**
   * Genera el snapshot visual panorámico en 1080p del mapa (general o de itinerario)
   * y lo sube al backend para que forme parte de la película completa y del álbum.
   */
  public async generarYSubirSnapshotMapa(
    viajeId: number,
    trackGpx: string,
    titulo: string,
    subtitulo: string = '',
    distanciaKm?: number,
    tipo: 'general' | 'itinerario' = 'general',
    itinerarioId?: number,
    puntosClave?: PuntoClaveMapa[]
  ): Promise<string> {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d')!;

    await this.renderizarSnapshotMapaEnCanvas(canvas, ctx, trackGpx, titulo, subtitulo, distanciaKm, 1920, 1080, puntosClave);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('Error generando blob del snapshot de mapa'));
      }, 'image/jpeg', 0.92);
    });

    const fileName = tipo === 'itinerario' && itinerarioId
      ? `mapa_itinerario_${itinerarioId}.jpg`
      : `mapa_general_${viajeId}.jpg`;

    const formData = new FormData();
    formData.append('imagen', blob, fileName);
    formData.append('tipo', tipo);
    if (itinerarioId) formData.append('itinerarioId', String(itinerarioId));

    const backendUrl = environment.apiUrl || 'http://localhost:3000';
    const resp = await firstValueFrom(
      this.http.post<{ success: boolean; url: string }>(`${backendUrl}/api/viajes/${viajeId}/mapa-snapshot`, formData)
    );

    return resp.url;
  }

  /**
   * Consulta al backend si ya existe un snapshot pre-renderizado para el viaje o itinerario
   */
  public async verificarSnapshotExiste(
    viajeId: number,
    tipo: 'general' | 'itinerario' = 'general',
    itinerarioId?: number
  ): Promise<{ exists: boolean; url: string | null }> {
    const backendUrl = environment.apiUrl || 'http://localhost:3000';
    let url = `${backendUrl}/api/viajes/${viajeId}/mapa-snapshot?tipo=${tipo}`;
    if (itinerarioId) url += `&itinerarioId=${itinerarioId}`;
    try {
      return await firstValueFrom(this.http.get<{ exists: boolean; url: string | null }>(url));
    } catch {
      return { exists: false, url: null };
    }
  }

  public async renderizarSnapshotMapaEnCanvas(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    trackGpx: string,
    titulo: string,
    subtitulo: string = '',
    distanciaKm?: number,
    width: number = 1920,
    height: number = 1080,
    puntosClave?: PuntoClaveMapa[]
  ): Promise<void> {
    // Fondo pergamino inicial
    ctx.fillStyle = '#0a1128';
    ctx.fillRect(0, 0, width, height);

    if (!trackGpx || trackGpx.trim() === '') {
      ctx.fillStyle = '#1c120c';
      ctx.fillRect(80, 80, width - 160, height - 160);
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 4;
      ctx.strokeRect(100, 100, width - 200, height - 200);
      ctx.fillStyle = '#f3e5ab';
      ctx.font = 'bold 56px "Cinzel", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(titulo.toUpperCase(), width / 2, height / 2 - 20);
      if (subtitulo) {
        ctx.font = 'italic 32px "Cinzel", Georgia, serif';
        ctx.fillText(subtitulo, width / 2, height / 2 + 50);
      }
      return;
    }

    try {
      const rawPoints = this.gpxService.parseGpx(trackGpx);
      if (!rawPoints || rawPoints.length === 0) {
        return;
      }

      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      for (const p of rawPoints) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
      }

      // Si se especifican puntos clave (destinos del crucero/viaje), asegurar que queden incluidos en el encuadre
      if (puntosClave && puntosClave.length > 0) {
        for (const pt of puntosClave) {
          if (pt.lat < minLat) minLat = pt.lat;
          if (pt.lat > maxLat) maxLat = pt.lat;
          if (pt.lng < minLng) minLng = pt.lng;
          if (pt.lng > maxLng) maxLng = pt.lng;
        }
      }

      const centerLat = (minLat + maxLat) / 2;
      const centerLng = (minLng + maxLng) / 2;

      const padX = 220;
      const padY = 220;
      const availW = width - 2 * padX;
      const availH = height - 2 * padY;

      const latLngToWorld = (lat: number, lng: number, z: number) => {
        const scale = 256 * Math.pow(2, z);
        const x = ((lng + 180) / 360) * scale;
        const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
        const latRad = (safeLat * Math.PI) / 180;
        const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) * 0.5 * scale;
        return { x, y };
      };

      let bestZoom = 15;
      for (let z = 15; z >= 3; z--) {
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
      const proyectar = (lat: number, lng: number) => {
        const w = latLngToWorld(lat, lng, bestZoom);
        return {
          x: Math.round(width / 2 + (w.x - centerWorld.x)),
          y: Math.round(height / 2 + (w.y - centerWorld.y))
        };
      };

      await this.cargarTilesFondo(ctx, centerWorld, bestZoom, width, height);

      if (rawPoints.length > 1) {
        ctx.save();
        ctx.beginPath();
        const startPt = proyectar(rawPoints[0].lat, rawPoints[0].lng);
        ctx.moveTo(startPt.x, startPt.y);
        for (let i = 1; i < rawPoints.length; i++) {
          const pt = proyectar(rawPoints[i].lat, rawPoints[i].lng);
          ctx.lineTo(pt.x, pt.y);
        }

        // Trazo exterior blanco de contraste
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 9;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Trazo interior azul eléctrico / cian vibrante (estilo satélite de la aplicación)
        ctx.strokeStyle = '#00D2FF';
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.restore();

        // Si tenemos puntos clave destacados (ej: paradas de crucero), los dibujamos con cartelas grandes y legibles
        if (puntosClave && puntosClave.length > 0) {
          puntosClave.forEach((p, idx) => {
            const pt = proyectar(p.lat, p.lng);
            if (pt.x < -100 || pt.x > width + 100 || pt.y < -100 || pt.y > height + 100) return;

            const num = p.numero || (idx + 1);
            const esInicio = idx === 0;
            const esFin = idx === puntosClave.length - 1;
            const colorPin = p.color || (esInicio ? '#10b981' : (esFin ? '#ef4444' : '#00d2ff'));

            ctx.save();

            // 1. Halo / Resplandor circular suave
            const gradHalo = ctx.createRadialGradient(pt.x, pt.y, 8, pt.x, pt.y, 36);
            gradHalo.addColorStop(0, 'rgba(0, 210, 255, 0.45)');
            gradHalo.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = gradHalo;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 36, 0, Math.PI * 2);
            ctx.fill();

            // 2. Pin circular numerado
            ctx.fillStyle = '#0f172a';
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 20, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = colorPin;
            ctx.lineWidth = 3.5;
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 16px "Cinzel", "Outfit", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(num), pt.x, pt.y + 1);

            // 3. Cartela grande y destacada con el nombre de la ciudad
            const nombreUpper = p.nombre.toUpperCase();
            ctx.font = 'bold 20px "Cinzel", "Outfit", "Segoe UI", sans-serif';
            const textMetrics = ctx.measureText(nombreUpper);
            const tagPadX = 22;
            const tagW = Math.max(textMetrics.width + tagPadX * 2, 130);
            const tagH = 44;

            let tagY = pt.y - 66; // Por defecto arriba del pin
            let flechaApuntaAbajo = true;
            if (pt.y < 230) {
              tagY = pt.y + 32; // Si está muy cerca del borde superior, colocar abajo
              flechaApuntaAbajo = false;
            }

            let tagX = pt.x - tagW / 2;
            if (tagX < 30) tagX = 30;
            if (tagX + tagW > width - 30) tagX = width - 30 - tagW;

            // Sombra envolvente
            ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
            ctx.shadowBlur = 18;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 6;

            // Fondo cartela
            ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
            this.dibujarRectanguloRedondeado(ctx, tagX, tagY, tagW, tagH, 10);
            ctx.fill();

            ctx.shadowColor = 'transparent';

            // Borde cartela
            ctx.strokeStyle = colorPin;
            ctx.lineWidth = 2.5;
            this.dibujarRectanguloRedondeado(ctx, tagX, tagY, tagW, tagH, 10);
            ctx.stroke();

            // Puntero triangular hacia el pin
            ctx.fillStyle = colorPin;
            ctx.beginPath();
            if (flechaApuntaAbajo) {
              ctx.moveTo(pt.x, pt.y - 22);
              ctx.lineTo(pt.x - 7, tagY + tagH);
              ctx.lineTo(pt.x + 7, tagY + tagH);
            } else {
              ctx.moveTo(pt.x, pt.y + 22);
              ctx.lineTo(pt.x - 7, tagY);
              ctx.lineTo(pt.x + 7, tagY);
            }
            ctx.closePath();
            ctx.fill();

            // Nombre de la ciudad en grande
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 18px "Cinzel", "Outfit", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(nombreUpper, tagX + tagW / 2, tagY + tagH / 2);

            ctx.restore();
          });
        } else {
          // Fallback a marcadores clásicos A y B si no hay lista de destinos
          const pInicio = proyectar(rawPoints[0].lat, rawPoints[0].lng);
          const pFin = proyectar(rawPoints[rawPoints.length - 1].lat, rawPoints[rawPoints.length - 1].lng);

          const dibujarPin = (p: { x: number; y: number }, color: string, label: string) => {
            ctx.save();
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, p.x, p.y);
            ctx.restore();
          };

          dibujarPin(pInicio, '#10b981', 'A');
          dibujarPin(pFin, '#ef4444', 'B');
        }
      }

      // La cabecera visual y badges de telemetría son gestionados de forma dinámica
      // y responsiva por la barra HTML del componente, por lo que no se queman textos estáticos en la imagen.

    } catch (err) {
      console.warn('⚠️ Error generando snapshot mapa:', err);
    }
  }

  private dibujarRectanguloRedondeado(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private canvasAImagen(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = canvas.toDataURL('image/jpeg', 0.92);
    });
  }
}
