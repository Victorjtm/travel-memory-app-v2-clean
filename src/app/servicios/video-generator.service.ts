import { Injectable } from '@angular/core';
import { Archivo } from '../modelos/archivo';
import { environment } from '../../environments/environment';
import { EscenaMultimedia, ConfiguracionExportacion } from '../modelos/escena-multimedia';
import html2canvas from 'html2canvas';

// ── Tipos para requestVideoFrameCallback (aún no en todas las versiones de lib.dom.d.ts) ──
interface VideoFrameCallbackMetadata {
  expectedDisplayTime: DOMHighResTimeStamp;
  height: number;
  mediaTime: number;
  presentationTime: DOMHighResTimeStamp;
  presentedFrames: number;
  processingDuration?: number;
  width: number;
}
interface HTMLVideoElementWithRVFC extends HTMLVideoElement {
  requestVideoFrameCallback(callback: (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => void): number;
  cancelVideoFrameCallback(handle: number): void;
}

export interface ConfiguracionVideo {
  duracionPorFoto: number;
  tipoTransicion: 'fade' | 'slide' | 'zoom';
  duracionTransicion: number;
  incluirTexto: boolean;
  calidad: 'alta' | 'media' | 'baja';
  mostrarDescripciones: boolean;
  resolucion: '1080p' | '720p' | '480p';
  transicionesAleatorias: boolean;
  modoAjuste?: 'contain' | 'cover';
  incluirAudiosSinImagen?: boolean;
}

export interface ProgresoVideo {
  fase: 'cargando' | 'procesando' | 'generando' | 'completado' | 'error';
  porcentaje: number;
  mensaje: string;
}

  @Injectable({
    providedIn: 'root'
  })
  export class VideoGeneratorService {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private mediaRecorder: MediaRecorder | null = null;
    private chunks: Blob[] = [];
    private stream: MediaStream | null = null;
    private readonly MAX_VIDEO_DURATION_SECONDS = 8; // ✨ NUEVO: Límite de duración para clips de vídeo

    constructor() {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d')!;
    }

  /**
   * ✨ NUEVO: Genera un vídeo basado en la secuencia única proporcionada.
   * Este es el nuevo estándar de la aplicación.
   */
  async generarVideoDesdeSecuencia(
    secuencia: EscenaMultimedia[],
    infoViaje: any,
    configuracion: ConfiguracionExportacion,
    audioViaje?: HTMLAudioElement | null,
    onProgress?: (progreso: ProgresoVideo) => void
  ): Promise<Blob> {
    try {
      // 1. Configuración inicial
      this.configurarResolucion(configuracion.calidad === 'alta' ? '1080p' : '720p');
      
      onProgress?.({ fase: 'cargando', porcentaje: 0, mensaje: 'Cargando recursos multimedia...' });

      // 2. PREPARAR AUDIO MIXER MAESTRO (Movido antes de cargar recursos)
      let audioCtx: AudioContext | null = null;
      let masterDest: MediaStreamAudioDestinationNode | null = null;
      let localSilencer: GainNode | null = null;
      let audioViajeExportacion: HTMLAudioElement | null = null;

      try {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        console.log('🎵 [Mixer] Estado inicial de audioCtx:', audioCtx.state);
        
        // Asegurar que el contexto no esté suspendido
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
          console.log('🎵 [Mixer] Estado tras resume():', audioCtx.state);
        }
        
        masterDest = audioCtx.createMediaStreamDestination();
        
        // Silenciar los altavoces locales para que el usuario no oiga el ruido mientras exporta
        localSilencer = audioCtx.createGain();
        localSilencer.gain.value = 0;
        localSilencer.connect(audioCtx.destination);
      } catch (e) {
        console.error('❌ [Mixer] Fallo creando AudioContext maestro:', e);
      }

      // 3. Cargar recursos (imágenes y metadatos de video)
      const escenasCargadas = await this.cargarRecursosSecuencia(secuencia, (progreso) => {
        onProgress?.({
          fase: 'cargando',
          porcentaje: progreso * 0.4,
          mensaje: `Cargando multimedia... ${Math.round(progreso)}%`
        });
      });

      // 4. PREPARAR GRABACIÓN Y CONECTAR FUENTES AL MIXER
      const fps = 30;
      const mimeType = this.detectarMejorCodec();
      console.log('🎬 Iniciando grabación con codec:', mimeType);

      // 4.a Conectar Audio del Viaje
      if (configuracion.incluirAudio && audioViaje && audioViaje.src && audioCtx && masterDest && localSilencer) {
        try {
          audioViajeExportacion = new Audio(audioViaje.src);
          audioViajeExportacion.crossOrigin = 'anonymous';
          audioViajeExportacion.loop = true;

          const source = audioCtx.createMediaElementSource(audioViajeExportacion);
          
          // Silenciador local
          source.connect(localSilencer);

          // Mixer maestro
          const viajeGain = audioCtx.createGain();
          viajeGain.gain.value = 1.0;
          source.connect(viajeGain);
          viajeGain.connect(masterDest);

          console.log(`🎵 [Mixer] Audio de viaje conectado al masterDest.`);
        } catch (e) {
          console.error('❌ [Mixer] Error inicializando audio de viaje:', e);
        }
      } else {
        console.log('🎵 [Mixer] Exportación sin música de viaje por decisión del usuario o faltan recursos.');
      }

      // 4.b Conectar Audio de Clips de Vídeo
      if (audioCtx && masterDest && localSilencer) {
        const videosConectados = new Set<HTMLVideoElement>();
        
        escenasCargadas.forEach(escena => {
          if (escena.tipo === 'video' && escena.data?.video) {
            const video = escena.data.video as HTMLVideoElement;
            if (!videosConectados.has(video)) {
              try {
                // IMPORTANTE: Quitar el muted para que fluya la señal de audio real a la Web Audio API
                video.muted = false;
                
                const source = audioCtx.createMediaElementSource(video);
                
                // Conectar al mixer maestro
                const clipGain = audioCtx.createGain();
                clipGain.gain.value = 1.0; // Mantiene el volumen original del clip
                source.connect(clipGain);
                clipGain.connect(masterDest);
                
                // Silenciar para el usuario local
                source.connect(localSilencer);
                
                videosConectados.add(video);
                console.log(`🎵 [Clip Audio] Fuente de audio creada y conectada al masterDest para el vídeo: ${escena.archivo?.nombreArchivo}`);
              } catch (e) {
                console.error(`❌ [Clip Audio] Error conectando video ${escena.archivo?.nombreArchivo}:`, e);
              }
            }
          }
        });
      }

      // 5. CONSTRUIR STREAM FINAL
      const canvasStream = this.canvas.captureStream(fps);
      const combinedTracks = [...canvasStream.getVideoTracks()];
      if (masterDest) {
        combinedTracks.push(...masterDest.stream.getAudioTracks());
      }

      this.stream = new MediaStream(combinedTracks);
      console.log('🎬 [Stream Final] Tracks en final stream:', this.stream.getTracks().map(t => `${t.kind} - readyState: ${t.readyState}`));

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: mimeType,
        videoBitsPerSecond: configuracion.calidad === 'alta' ? 5000000 : 2500000
      });

      this.chunks = [];
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };

      // 4. Generar Timeline y Loop de Render
      const timeline = this.construirTimeline(escenasCargadas, infoViaje);
      const totalDuration = timeline.length > 0 ? timeline[timeline.length - 1].end : 0;

      this.mediaRecorder.start(100);
      const conAudio = combinedTracks.some(t => t.kind === 'audio');
      console.log(conAudio ? '🎵 [MediaRecorder] iniciado CON audio track' : '🎵 [MediaRecorder] iniciado SIN audio track');

      // Iniciar música en el elemento clonado justo después del recorder para que fluya hacia el Master Dest
      if (audioViajeExportacion) {
        try {
          await audioViajeExportacion.play();
          console.log('🎵 [Mixer] audioViajeExportacion.play() ejecutado con éxito');
        } catch (e) {
          console.error('❌ [Mixer] No se pudo iniciar el audio clonado automáticamente:', e);
        }
      }

      await this.ejecutarLoopRender(timeline, totalDuration, configuracion, (pct) => {
        onProgress?.({
          fase: 'generando',
          porcentaje: 40 + (pct * 0.5),
          mensaje: `Generando vídeo... ${Math.round(pct)}%`
        });
      });

      this.mediaRecorder.stop();
      if (audioViajeExportacion) {
        audioViajeExportacion.pause();
        audioViajeExportacion.src = "";
      }
      if (audioCtx) audioCtx.close();
      this.stream.getTracks().forEach(t => t.stop());

      // ✨ LIMPIEZA DE RECURSOS (Crucial para evitar que sigan cargando en segundo plano)
      escenasCargadas.forEach(escena => {
        if (escena.data?.video) {
          const v = escena.data.video;
          v.pause();
          v.src = "";
          v.load();
          v.remove();
        }
      });

      // 5. Esperar el blob final
      return await new Promise<Blob>((resolve) => {
        this.mediaRecorder!.onstop = () => {
          const type = mimeType.includes('mp4') ? 'video/mp4' : 'video/webm';
          resolve(new Blob(this.chunks, { type }));
        };
      });

    } catch (error) {
      console.error('❌ Error en generación de vídeo:', error);
      throw error;
    }
  }

  private async cargarRecursosSecuencia(secuencia: EscenaMultimedia[], onProgress: (p: number) => void): Promise<any[]> {
    const total = secuencia.length;
    const resultado = [];
    // ✨ CACHE LOCAL: Evita cargar el mismo vídeo 100 veces si se repite en el álbum
    const cacheRecursos = new Map<string, any>();

    for (let i = 0; i < total; i++) {
      const escena = secuencia[i];
      if (!escena.archivo) {
        resultado.push(escena);
        continue;
      }

      const cacheKey = `${escena.tipo}_${escena.archivo.id || escena.archivo.rutaArchivo}`;

      try {
        if (cacheRecursos.has(cacheKey)) {
          // Reutilizar recurso ya cargado
          resultado.push({ ...escena, data: cacheRecursos.get(cacheKey) });
        } else {
          let data;
          if (escena.tipo === 'imagen') {
            const img = await this.cargarImagen(escena.archivo);
            data = { imagen: img };
          } else if (escena.tipo === 'video') {
            const vidData = await this.procesarVideo(escena.archivo);
            data = vidData;
          } else {
            resultado.push(escena);
            continue;
          }
          cacheRecursos.set(cacheKey, data);
          resultado.push({ ...escena, data });
        }
      } catch (e) {
        console.warn(`⚠️ Error cargando recurso de escena ${i} (${escena.tipo}):`, e);
        resultado.push(escena);
      }
      onProgress(((i + 1) / total) * 100);
    }
    return resultado;
  }

  private construirTimeline(escenas: any[], infoViaje: any): any[] {
    const timeline = [];
    let currentTime = 0;

    // Título inicial (3s)
    timeline.push({ 
      tipo: 'titulo', 
      start: currentTime, 
      end: currentTime + 3, 
      duracion: 3,
      data: infoViaje.nombre || 'Mi Viaje' 
    });
    currentTime += 3;

    for (const escena of escenas) {
      // ✨ NUEVO: Limitar duración de vídeos a MAX_VIDEO_DURATION_SECONDS
      let duracion = 4; // Default para imágenes
      
      if (escena.tipo === 'video') {
        const duracionReal = escena.data.duracion || 5;
        duracion = Math.min(duracionReal, this.MAX_VIDEO_DURATION_SECONDS);
        console.log(`🎥 Limitando video ${escena.archivo?.nombreArchivo || ''} a ${duracion}s (Original: ${duracionReal}s)`);
      } else if (escena.tipo === 'carta') {
        duracion = 5;
      }
      
      timeline.push({ 
        ...escena, 
        start: currentTime, 
        end: currentTime + duracion,
        duracion: duracion
      });
      currentTime += duracion;
    }

    return timeline;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LOOP DE RENDER — FASE 1-4: completamente síncrono, sin seeks correctivos,
  // con protección de readyState y soporte opcional de rVFC.
  // ─────────────────────────────────────────────────────────────────────────
  private ejecutarLoopRender(
    timeline: any[],
    totalDuration: number,
    config: ConfiguracionExportacion,
    onProgress: (pct: number) => void
  ): Promise<void> {
    const startTime = performance.now();
    let ultimoEscenaIndex = -1;

    // ── Flags de estado para vídeos (permiten quitar await del loop) ──
    let videoArranacando = false;   // play() disparado, esperando datos
    let ultimoFrameValido: ImageData | null = null; // fallback visual
    // rVFC: ID de cancelación cuando se usa requestVideoFrameCallback
    let rVFCHandle: number | null = null;

    console.log('🎬 renderFrame síncrono activo');

    return new Promise((resolve) => {
      // ── Función de pintado de vídeo, llamada desde rAF O desde rVFC ──
      const dibujarFrameVideo = (video: HTMLVideoElement, escena: any, config: ConfiguracionExportacion): void => {
        // FASE 3 — Protección por readyState antes de cualquier drawImage
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          // No hay frame decodificado listo. Mantener frame válido anterior si existe.
          if (ultimoFrameValido) {
            this.ctx.putImageData(ultimoFrameValido, 0, 0);
          }
          // Si no hay ninguno, dejar el fondo negro ya pintado por el bucle.
          return;
        }
        console.log(`🎬 Frame de vídeo dibujado, readyState=${video.readyState}`);
        this.dibujarVideoCentrado(video);
        if (config.incluirTexto) this.dibujarTextoImagen(escena.archivo);
        // Guardar snapshot del frame válido para el fallback
        try {
          ultimoFrameValido = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        } catch { /* CORS u otro error — ignorar el snapshot */ }
      };

      // ── Loop principal — FASE 1: sin ningún await ──
      const renderFrame = () => {              // ← ya NO es async
        const now = performance.now();
        const elapsed = (now - startTime) / 1000;

        if (elapsed >= totalDuration) {
          // Detener vídeo activo si lo hay
          const escenaFinal = timeline[ultimoEscenaIndex];
          if (escenaFinal?.tipo === 'video') escenaFinal.data?.video?.pause();
          // Cancelar rVFC si estaba activo
          if (rVFCHandle !== null) {
            const videoActivo = timeline[ultimoEscenaIndex]?.data?.video as HTMLVideoElement | undefined;
            videoActivo?.cancelVideoFrameCallback?.(rVFCHandle);
            rVFCHandle = null;
          }
          resolve();
          return;
        }

        // 1. Limpiar canvas
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // 2. Buscar escena actual por tiempo
        const escenaIndex = timeline.findIndex(e => elapsed >= e.start && elapsed < e.end);

        // 3. Cambio de escena ── FASE 2: play() fire-and-forget, sin await ──
        if (escenaIndex !== ultimoEscenaIndex) {
          // Cancelar rVFC de la escena anterior
          if (rVFCHandle !== null) {
            const videoAnterior = timeline[ultimoEscenaIndex]?.data?.video as HTMLVideoElement | undefined;
            videoAnterior?.cancelVideoFrameCallback?.(rVFCHandle);
            rVFCHandle = null;
          }

          // Pausar vídeo anterior
          const escenaAnterior = timeline[ultimoEscenaIndex];
          if (escenaAnterior?.tipo === 'video') {
            escenaAnterior.data?.video?.pause();
            console.log(`🎵 [Clip Audio] Audio del clip finalizado: ${escenaAnterior.archivo?.nombreArchivo || 'desconocido'}`);
          }

          ultimoEscenaIndex = escenaIndex;
          videoArranacando = false;
          ultimoFrameValido = null; // resetear fallback visual para esta escena

          const escenaActual = timeline[escenaIndex];
          if (escenaActual?.tipo === 'video' && escenaActual.data?.video) {
            const video = escenaActual.data.video as HTMLVideoElement;
            video.currentTime = 0;
            video.playbackRate = 1;
            videoArranacando = true;

            console.log(`🎬 Escena de vídeo iniciada sin bloquear loop: ${escenaActual.archivo?.nombreArchivo || ''}`);

            // ── FASE 5 opcional: requestVideoFrameCallback ──
            if (typeof video.requestVideoFrameCallback === 'function') {
              console.log('🎬 requestVideoFrameCallback activo');
              const rVFCLoop = (_now: DOMHighResTimeStamp, _meta: VideoFrameCallbackMetadata) => {
                // Dibujar frame real del vídeo cuando el decodificador lo tiene listo
                this.ctx.fillStyle = '#000';
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                dibujarFrameVideo(video, escenaActual, config);
                // Continuar solo si la escena sigue activa
                const nowSec = (performance.now() - startTime) / 1000;
                if (nowSec < escenaActual.end) {
                  rVFCHandle = video.requestVideoFrameCallback!(rVFCLoop);
                } else {
                  rVFCHandle = null;
                }
              };
              rVFCHandle = video.requestVideoFrameCallback(rVFCLoop);
            }

            // play() fire-and-forget — no bloquea el loop bajo ninguna circunstancia
            video.play().then(() => {
              console.log(`🎵 [Clip Audio] Audio del clip iniciado: ${escenaActual.archivo?.nombreArchivo || 'desconocido'}`);
              videoArranacando = false;
            }).catch((e) => {
              console.warn(`⚠️ video.play() rechazado para clip ${escenaActual.archivo?.nombreArchivo}:`, e);
              videoArranacando = false;
            });
          }
        }

        // 4. Renderizar frame actual
        const escena = timeline[escenaIndex];
        if (escena) {
          const elapsedInScene = elapsed - escena.start;
          // Pintar síncronamente — FASE 1: sin await
          this.renderizarFrameEscenaSync(escena, elapsedInScene, config, dibujarFrameVideo);

          // Transición cross-fade de 0.5s al final (solo para imágenes/títulos, no vídeo)
          const transTime = 0.5;
          const timeLeft = escena.end - elapsed;
          if (timeLeft < transTime && escenaIndex < timeline.length - 1) {
            const nextEscena = timeline[escenaIndex + 1];
            // No hacer cross-fade si la siguiente escena es vídeo (evita artefactos)
            if (nextEscena?.tipo !== 'video') {
              const alpha = (transTime - timeLeft) / transTime;
              this.ctx.save();
              this.ctx.globalAlpha = alpha;
              this.renderizarFrameEscenaSync(nextEscena, 0, config, dibujarFrameVideo);
              this.ctx.restore();
            }
          }
        }

        onProgress((elapsed / totalDuration) * 100);
        requestAnimationFrame(renderFrame); // siguiente tick — siempre síncrono
      };

      requestAnimationFrame(renderFrame);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render de un frame concreto — FASE 1: síncrono (no async, sin await)
  // ─────────────────────────────────────────────────────────────────────────
  private renderizarFrameEscenaSync(
    escena: any,
    elapsed: number,
    config: ConfiguracionExportacion,
    dibujarFrameVideo: (v: HTMLVideoElement, e: any, c: ConfiguracionExportacion) => void
  ): void {
    const progreso = Math.min(elapsed / escena.duracion, 1);

    if (escena.tipo === 'titulo') {
      this.renderizarTituloFrame(escena.data, progreso);

    } else if (escena.tipo === 'carta') {
      this.renderizarCartaFrame(escena, progreso);

    } else if (escena.tipo === 'video') {
      const video = escena.data?.video as HTMLVideoElement | undefined;
      if (video) {
        // FASE 2: sin video.currentTime = elapsed (no seeks correctivos)
        // El vídeo avanza solo con play() + playbackRate=1
        // FASE 4: rVFC pinta directamente; rAF solo pinta si rVFC no está activo
        // Si rVFC está activo, el pintado ya lo hace el callback de rVFC — aquí no pintamos
        // (el flag rVFCHandle no es accesible aquí por diseño; dibujarFrameVideo hace la guarda)
        dibujarFrameVideo(video, escena, config);
      }

    } else if (escena.tipo === 'imagen') {
      this.dibujarImagenCentrada(escena.data.imagen);
      if (config.incluirTexto) this.dibujarTextoImagen(escena.archivo);
    }
  }

  // Mantener método async original como deprecated-wrapper para compatibilidad
  // con cualquier llamada externa pendiente (no se usa en el loop principal).
  /** @deprecated Usar renderizarFrameEscenaSync */
  private async renderizarFrameEscena(escena: any, elapsed: number, config: ConfiguracionExportacion): Promise<void> {
    this.renderizarFrameEscenaSync(escena, elapsed, config, (video, esc, cfg) => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        this.dibujarVideoCentrado(video);
        if (cfg.incluirTexto) this.dibujarTextoImagen(esc.archivo);
      }
    });
  }

  private renderizarTituloFrame(titulo: string, progreso: number): void {
    let alpha = 1;
    if (progreso < 0.2) alpha = progreso / 0.2;
    else if (progreso > 0.8) alpha = (1 - progreso) / 0.2;

    this.ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    this.ctx.font = 'bold 72px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(titulo, this.canvas.width / 2, this.canvas.height / 2);
  }




    private configurarResolucion(resolucion: '1080p' | '720p' | '480p'): void {
      switch (resolucion) {
        case '1080p':
          this.canvas.width = 1920;
          this.canvas.height = 1080;
          break;
        case '720p':
          this.canvas.width = 1280;
          this.canvas.height = 720;
          break;
        case '480p':
          this.canvas.width = 854;
          this.canvas.height = 480;
          break;
      }
    }

    private obtenerBitrate(calidad: 'alta' | 'media' | 'baja'): number {
      switch (calidad) {
        case 'alta': return 5000000; // 5 Mbps
        case 'media': return 2500000; // 2.5 Mbps
        case 'baja': return 1000000; // 1 Mbps
        default: return 2500000;
      }
    }

  private detectarMejorCodec(): string {
    // Priorizar MP4/H264 para mayor compatibilidad con Windows y WhatsApp
    // Usamos perfiles específicos (Main Profile) si están disponibles
    const codecsPreferidos = [
      'video/mp4;codecs="avc1.4D401E,mp4a.40.2"', // H.264 Main Profile + AAC
      'video/mp4;codecs="avc1.424028,mp4a.40.2"', // H.264 Baseline + AAC
      'video/mp4',
      'video/webm;codecs=h264,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    
    for (const codec of codecsPreferidos) {
      if (MediaRecorder.isTypeSupported(codec)) {
        console.log('✅ Códec compatible encontrado:', codec);
        return codec;
      }
    }
    
    console.warn('⚠️ No se encontró códec ideal, usando WebM básico');
    return 'video/webm';
  }

  public getExtensionVideo(): string {
    const codec = this.detectarMejorCodec();
    return codec.includes('mp4') ? 'mp4' : 'webm';
  }


private procesarVideo(archivo: Archivo): Promise<{archivo: Archivo, video: HTMLVideoElement, duracion: number}> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata'; // ✨ NUEVO: Precargar metadatos
    
    video.onloadedmetadata = () => {
      // ✨ NUEVO: Validar que el video tiene duración válida
      const duracion = video.duration;
      if (!duracion || duracion === Infinity || isNaN(duracion)) {
        console.warn(`⚠️ Video ${archivo.nombreArchivo} tiene duración inválida, usando 5s por defecto`);
        resolve({
          archivo,
          video,
          duracion: 5
        });
      } else {
        console.log(`✅ Video ${archivo.nombreArchivo} cargado: ${duracion.toFixed(2)}s`);
        resolve({
          archivo,
          video,
          duracion
        });
      }
    };
    
    video.onerror = (e) => {
      console.error(`❌ Error cargando video ${archivo.nombreArchivo}:`, e);
      reject(new Error(`Error cargando video ${archivo.nombreArchivo}`));
    };
    
    const url = this.obtenerUrlArchivo(archivo);
    
    // ✨ RECORTE TEMPORAL REAL (Media Fragments)
    // Añadimos el fragmento de tiempo al src para que el navegador sepa que solo nos interesan los primeros N segundos.
    // Esto evita que el pipeline de red intente descargar los 198s completos del vídeo original.
    const urlConTrim = `${url}#t=0,${this.MAX_VIDEO_DURATION_SECONDS}`;
    
    console.log(`🎥 Cargando segmento de video (0-${this.MAX_VIDEO_DURATION_SECONDS}s) desde:`, urlConTrim);
    video.src = urlConTrim;
  });
}

  private esVideo(nombreArchivo: string): boolean {
    const extensiones = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v'];
    const extension = nombreArchivo.toLowerCase().substring(nombreArchivo.lastIndexOf('.'));
    return extensiones.includes(extension);
  }

    private async cargarImagen(archivo: Archivo): Promise<HTMLImageElement> {
      try {
        const url = this.obtenerUrlArchivo(archivo);
        console.log(`🖼️ Cargando imagen mediante fetch: ${url}`);
        
        // ✨ USAR FETCH PARA EVITAR CANVA TAINTED (CORS)
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        return new Promise((resolve, reject) => {
          const img = new Image();
          // NO usar crossOrigin con Blob URLs para evitar problemas de seguridad
          img.onload = () => {
            URL.revokeObjectURL(blobUrl);
            resolve(img);
          };
          img.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            reject(new Error(`Error cargando imagen blob de ${archivo.nombreArchivo}`));
          };
          img.src = blobUrl;
        });
      } catch (error) {
        console.error(`❌ Error en fetch de imagen ${archivo.nombreArchivo}:`, error);
        throw error;
      }
    }

    private obtenerUrlArchivo(archivo: Archivo): string {
      if (!archivo?.rutaArchivo) return '/assets/images/no-image.jpg';
      if (archivo.rutaArchivo.startsWith('http')) return archivo.rutaArchivo;
      
      const rutaLimpia = archivo.rutaArchivo.replace(/\\/g, '/');
      return `${environment.apiUrl}/uploads/${rutaLimpia}`;
    }



private dibujarVideoCentrado(video: HTMLVideoElement): void {
  const canvasAspect = this.canvas.width / this.canvas.height;
  const videoAspect = video.videoWidth / video.videoHeight;
  
  let drawWidth, drawHeight, drawX, drawY;
  
  // ✨ NUEVO: Comportamiento "contain" - mostrar video completo sin recortar
  if (videoAspect > canvasAspect) {
    // Video más ancho que el canvas → ajustar al ancho
    drawWidth = this.canvas.width;
    drawHeight = drawWidth / videoAspect;
    drawX = 0;
    drawY = (this.canvas.height - drawHeight) / 2; // Centrar verticalmente
  } else {
    // Video más alto que el canvas → ajustar a la altura
    drawHeight = this.canvas.height;
    drawWidth = drawHeight * videoAspect;
    drawX = (this.canvas.width - drawWidth) / 2; // Centrar horizontalmente
    drawY = 0;
  }
  
  this.ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
}

private dibujarImagenCentrada(imagen: HTMLImageElement, modo: 'contain' | 'cover' = 'contain'): void {
  const canvasAspect = this.canvas.width / this.canvas.height;
  const imageAspect = imagen.width / imagen.height;
  
  let drawWidth, drawHeight, drawX, drawY;
  
  if (modo === 'contain') {
    // Mostrar imagen completa (con barras negras si es necesario)
    if (imageAspect > canvasAspect) {
      drawWidth = this.canvas.width;
      drawHeight = drawWidth / imageAspect;
      drawX = 0;
      drawY = (this.canvas.height - drawHeight) / 2;
    } else {
      drawHeight = this.canvas.height;
      drawWidth = drawHeight * imageAspect;
      drawX = (this.canvas.width - drawWidth) / 2;
      drawY = 0;
    }
  } else {
    // Llenar canvas (recortando si es necesario)
    if (imageAspect > canvasAspect) {
      drawHeight = this.canvas.height;
      drawWidth = drawHeight * imageAspect;
      drawX = (this.canvas.width - drawWidth) / 2;
      drawY = 0;
    } else {
      drawWidth = this.canvas.width;
      drawHeight = drawWidth / imageAspect;
      drawX = 0;
      drawY = (this.canvas.height - drawHeight) / 2;
    }
  }
  
  this.ctx.drawImage(imagen, drawX, drawY, drawWidth, drawHeight);
}

    private dibujarTextoImagen(archivo: Archivo): void {
      if (!archivo.descripcion && !archivo.fechaCreacion) return;

      const padding = this.canvas.width * 0.05; // 5% de margen
      const maxWidth = this.canvas.width - (padding * 2);
      
      // ✨ NUEVO: Overlay Elegante (Sin bloque negro opaco)
      // Dibujar un degradado sutil en la parte inferior para legibilidad
      const gradHeight = 150;
      const gradient = this.ctx.createLinearGradient(0, this.canvas.height - gradHeight, 0, this.canvas.height);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
      
      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(0, this.canvas.height - gradHeight, this.canvas.width, gradHeight);
      
      // Sombra para el texto (asegura legibilidad sobre cualquier fondo)
      this.ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      this.ctx.shadowBlur = 4;
      this.ctx.shadowOffsetX = 2;
      this.ctx.shadowOffsetY = 2;
      
      this.ctx.fillStyle = '#fff';
      this.ctx.textAlign = 'left';
      
      let y = this.canvas.height - padding;
      
      // Línea secundaria: Descripción (si existe)
      if (archivo.descripcion) {
        this.ctx.font = 'italic 24px Georgia, serif';
        const textoTruncado = this.truncarTexto(archivo.descripcion, maxWidth, 'italic 24px Georgia');
        this.ctx.fillText(textoTruncado, padding, y);
        y -= 35; // Subir para la siguiente línea
      }
      
      // Línea principal: Fecha + Hora
      this.ctx.font = 'bold 28px Arial';
      let infoText = '';
      if (archivo.fechaCreacion) {
        infoText = new Date(archivo.fechaCreacion).toLocaleDateString('es-ES', {
          day: '2-digit', month: '2-digit', year: 'numeric'
        });
      }
      
      if (archivo.horaCaptura) {
        infoText += (infoText ? ' · ' : '') + archivo.horaCaptura;
      }
      
      if (infoText) {
        this.ctx.fillText(infoText, padding, y);
      }
      
      // Resetear sombras
      this.ctx.shadowColor = 'transparent';
      this.ctx.shadowBlur = 0;
      this.ctx.shadowOffsetX = 0;
      this.ctx.shadowOffsetY = 0;
    }

    private truncarTexto(texto: string, maxWidth: number, font: string): string {
      this.ctx.font = font;
      if (this.ctx.measureText(texto).width <= maxWidth) return texto;
      
      let truncado = texto;
      while (this.ctx.measureText(truncado + '...').width > maxWidth && truncado.length > 0) {
        truncado = truncado.slice(0, -1);
      }
      return truncado + '...';
    }

  private renderizarCartaFrame(escena: any, progreso: number): void {
    const carta = escena.data;
    if (!carta) return;

    // Fondo de papel
    this.ctx.fillStyle = '#f4f1e8';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Efecto fade in/out interno de la escena
    let alpha = 1;
    if (progreso < 0.1) alpha = progreso / 0.1;
    else if (progreso > 0.9) alpha = (1 - progreso) / 0.1;
    this.ctx.globalAlpha = alpha;
    
    // Título en estilo manuscrito
    this.ctx.fillStyle = '#2c1810';
    this.ctx.font = 'italic bold 48px Georgia, serif';
    this.ctx.textAlign = 'center';
    
    const titulo = carta.titulo || 'Itinerario';
    this.ctx.fillText(titulo, this.canvas.width / 2, 150);
    
    // Descripción
    if (carta.descripcion) {
      this.ctx.font = '28px Georgia, serif';
      this.ctx.textAlign = 'left';
      
      const lineas = this.dividirTextoEnLineas(
        carta.descripcion, 
        this.canvas.width - 200,
        '28px Georgia'
      );
      
      let y = 250;
      for (const linea of lineas.slice(0, 15)) {
        this.ctx.fillText(linea, 100, y);
        y += 40;
      }
    }
    
    // Fecha
    if (carta.fecha) {
      this.ctx.font = 'italic 24px Georgia, serif';
      this.ctx.textAlign = 'right';
      const fecha = new Date(carta.fecha).toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      this.ctx.fillText(fecha, this.canvas.width - 100, this.canvas.height - 50);
    }
    
    this.ctx.globalAlpha = 1;
  }

  private dividirTextoEnLineas(texto: string, maxWidth: number, font: string): string[] {
    this.ctx.font = font;
    const palabras = texto.split(' ');
    const lineas: string[] = [];
    let lineaActual = '';
    
    for (const palabra of palabras) {
      const prueba = lineaActual + (lineaActual ? ' ' : '') + palabra;
      if (this.ctx.measureText(prueba).width > maxWidth) {
        if (lineaActual) lineas.push(lineaActual);
        lineaActual = palabra;
      } else {
        lineaActual = prueba;
      }
    }
    
    if (lineaActual) lineas.push(lineaActual);
    return lineas;
  }

  private esImagen(nombreArchivo: string): boolean {
    if (!nombreArchivo) return false;
    const extensiones = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
    const lastDotIndex = nombreArchivo.lastIndexOf('.');
    if (lastDotIndex === -1) return false;
    const extension = nombreArchivo.toLowerCase().substring(lastDotIndex);
    return extensiones.includes(extension);
  }

  /**
   * ✨ NUEVO: Genera un vídeo a partir de una ruta GPX animada con multimedia sincronizada.
   */
  async generarVideoGpx(
    points: any[], 
    actividad: any,
    configuracion: any,
    onProgress?: (progreso: ProgresoVideo) => void
  ): Promise<Blob> {
    console.log('🎬 [WebP→WebM] Iniciando generación de vídeo GPX...');

    try {
      this.configurarResolucion(configuracion.resolucion || '720p');
      const W = this.canvas.width;
      const H = this.canvas.height;
      const fps = 30;
      const webpFrames: string[] = [];
      
      onProgress?.({ fase: 'cargando', porcentaje: 5, mensaje: 'Preparando captura de frames...' });

      // Helper: capturar frame del canvas como WebP
      const capturarFrame = () => {
        webpFrames.push(this.canvas.toDataURL('image/webp', 0.85));
      };

      // == 1. Mapa Headless ==
      onProgress?.({ fase: 'cargando', porcentaje: 8, mensaje: 'Creando mapa satélite...' });
      
      const mapDiv = document.createElement('div');
      mapDiv.style.width = `${W}px`;
      mapDiv.style.height = `${H}px`;
      mapDiv.style.position = 'fixed';
      mapDiv.style.top = '-9999px';
      mapDiv.style.left = '-9999px';
      document.body.appendChild(mapDiv);

      const L = await import('leaflet');
      const map = L.map(mapDiv, {
        zoomControl: false, attributionControl: false,
        fadeAnimation: false, zoomAnimation: false, markerZoomAnimation: false
      });
      
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18, crossOrigin: true
      }).addTo(map);

      const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [50, 50], animate: false });

      onProgress?.({ fase: 'cargando', porcentaje: 10, mensaje: 'Descargando cartografía satélite...' });
      await new Promise(r => setTimeout(r, 3000));

      const mapaFondo = await html2canvas(mapDiv, {
        useCORS: true, allowTaint: false, backgroundColor: '#000'
      });

      const proyeccion = (lat: number, lng: number) => {
        const pt = map.latLngToContainerPoint([lat, lng]);
        return { x: pt.x, y: pt.y };
      };

      onProgress?.({ fase: 'cargando', porcentaje: 20, mensaje: 'Mapa capturado. Capturando frames...' });
      
      const puntosMedia: { idx: number; archivos: any[] }[] = [];
      const numPuntos = points.length;
      for (let i = 0; i < numPuntos; i++) {
        if (points[i].event?.archivos?.length > 0) {
          puntosMedia.push({ idx: i, archivos: points[i].event.archivos });
        }
      }

      // == 1.5. Configuración de Audio ==
      const sampleRate = 44100;
      // Estimamos la duración total para el OfflineAudioContext
      // Título (2.5s) + Animación (10s aprox) + Multimedia (X*3s)
      let duracionEstimada = 2.5 + 10 + (puntosMedia.length * (configuracion.duracionPorFoto || 3));
      const offlineCtx = new OfflineAudioContext(2, sampleRate * Math.ceil(duracionEstimada + 30), sampleRate);
      
      const mainGain = offlineCtx.createGain();
      mainGain.connect(offlineCtx.destination);
      mainGain.gain.setValueAtTime(1, 0);

      // Cargar Música de Fondo si existe
      if (actividad.audioFondoUrl || actividad.audioUrl) {
        const bgAudioBuffer = await this.cargarAudioBuffer({ audioUrl: actividad.audioFondoUrl || actividad.audioUrl }, offlineCtx);
        if (bgAudioBuffer) {
          const bgSource = offlineCtx.createBufferSource();
          bgSource.buffer = bgAudioBuffer;
          bgSource.loop = true;
          bgSource.connect(mainGain);
          bgSource.start(0);
        }
      }

      let currentTimeAudio = 0;

      // == 2. Fase Título (2.5 segundos = 75 frames) ==
      const tituloFrames = Math.floor(2.5 * fps);
      for (let f = 0; f < tituloFrames; f++) {
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, W, H);
        let alpha = 1;
        if (f < 20) alpha = f / 20;
        else if (f > tituloFrames - 20) alpha = (tituloFrames - f) / 20;
        this.ctx.globalAlpha = alpha;
        this.ctx.fillStyle = '#fff';
        this.ctx.font = `bold ${Math.floor(H / 15)}px Arial`;
        this.ctx.textAlign = 'center';
        this.ctx.fillText(actividad.nombre || 'Mi Ruta', W / 2, H / 2);
        this.ctx.globalAlpha = 1;
        capturarFrame();
        currentTimeAudio += (1 / fps);
        if (f % 15 === 0) await new Promise(r => setTimeout(r, 0));
      }

      // == 3. Animación de Ruta ==
      const totalFramesAnimacion = 300;
      
      const rutaBuffer = document.createElement('canvas');
      rutaBuffer.width = W;
      rutaBuffer.height = H;
      const rutaCtx = rutaBuffer.getContext('2d')!;
      let ultimoIdx = -1;
      let nextMedia = 0;

      console.log(`🎬 ${numPuntos} puntos GPS → ${totalFramesAnimacion} frames de animación`);

      for (let frame = 0; frame < totalFramesAnimacion; frame++) {
        const progreso = frame / totalFramesAnimacion;
        const idxPunto = Math.min(Math.floor(progreso * numPuntos), numPuntos - 1);
        const punto = points[idxPunto];
        const pct = 20 + progreso * 70;

        if (idxPunto > ultimoIdx) {
          rutaCtx.lineWidth = 10;
          rutaCtx.lineCap = 'round';
          rutaCtx.lineJoin = 'round';
          rutaCtx.strokeStyle = '#2196F3';
          rutaCtx.beginPath();
          const si = Math.max(0, ultimoIdx);
          const sp = proyeccion(points[si].lat, points[si].lng);
          rutaCtx.moveTo(sp.x, sp.y);
          for (let k = si + 1; k <= idxPunto; k++) {
            const p = proyeccion(points[k].lat, points[k].lng);
            rutaCtx.lineTo(p.x, p.y);
          }
          rutaCtx.stroke();
          ultimoIdx = idxPunto;
        }

        this.ctx.drawImage(mapaFondo, 0, 0, W, H);
        this.ctx.drawImage(rutaBuffer, 0, 0);
        this.dibujarMarker(punto, proyeccion);
        this.dibujarDashboard(punto, actividad, configuracion);
        capturarFrame();
        currentTimeAudio += (1 / fps);

        // Multimedia
        while (nextMedia < puntosMedia.length && puntosMedia[nextMedia].idx <= idxPunto) {
          const m = puntosMedia[nextMedia];
          for (const archivo of m.archivos) {
            onProgress?.({ fase: 'procesando', porcentaje: pct, mensaje: `Mostrando: ${archivo.nombreArchivo}` });
            
            if (this.esImagen(archivo.nombreArchivo)) {
              try {
                const img = await this.cargarImagen(archivo);
                let durSec = configuracion.duracionPorFoto || 3;
                
                // Programar audio si existe (Ducking)
                const audioBuffer = await this.cargarAudioBuffer(archivo, offlineCtx);
                if (audioBuffer) {
                  durSec = Math.max(durSec, audioBuffer.duration);
                  // Ducking: bajar volumen fondo
                  mainGain.gain.linearRampToValueAtTime(0.2, currentTimeAudio);
                  const source = offlineCtx.createBufferSource();
                  source.buffer = audioBuffer;
                  source.connect(offlineCtx.destination);
                  source.start(currentTimeAudio);
                  // Subir volumen fondo al terminar
                  mainGain.gain.linearRampToValueAtTime(1.0, currentTimeAudio + durSec);
                }

                const numF = Math.floor(durSec * fps);
                for (let mf = 0; mf < numF; mf++) {
                  this.ctx.fillStyle = '#000';
                  this.ctx.fillRect(0, 0, W, H);
                  this.dibujarImagenCentrada(img, 'contain');
                  this.dibujarTextoImagen(archivo);
                  capturarFrame();
                  currentTimeAudio += (1 / fps);
                  if (mf % 10 === 0) await new Promise(r => setTimeout(r, 0));
                }
              } catch (e) {
                console.warn('⚠️ Error cargando imagen:', e);
              }
            } else if (this.esVideo(archivo.nombreArchivo)) {
               // TODO: Manejo de audio de video en OfflineContext es más complejo
               // Por ahora mostramos el video visualmente sin audio en el mux final
            }

            this.ctx.drawImage(mapaFondo, 0, 0, W, H);
            this.ctx.drawImage(rutaBuffer, 0, 0);
            this.dibujarMarker(punto, proyeccion);
            this.dibujarDashboard(punto, actividad, configuracion);
            capturarFrame();
            currentTimeAudio += (1 / fps);
          }
          nextMedia++;
        }

        if (frame % 10 === 0) {
          await new Promise(r => setTimeout(r, 0));
          onProgress?.({ fase: 'procesando', porcentaje: pct, mensaje: `Capturando frames... (${webpFrames.length})` });
        }
      }

      // Cleanup mapa
      if (mapDiv.parentElement) {
        document.body.removeChild(mapDiv);
        map.remove();
      }

      // == 4. Renderizar Audio y Muxing Final ==
      onProgress?.({ fase: 'generando', porcentaje: 90, mensaje: 'Mezclando pistas de audio...' });
      const renderedAudioBuffer = await offlineCtx.startRendering();
      
      onProgress?.({ fase: 'generando', porcentaje: 95, mensaje: 'Sincronizando audio y vídeo...' });
      
      // Muxing final usando MediaRecorder sobre replay
      const finalBlob = await this.muxerVideoAudio(webpFrames, renderedAudioBuffer, fps, W, H);
      
      console.log(`✅ Vídeo generado con Audio: ${(finalBlob.size / 1024 / 1024).toFixed(2)} MB`);
      onProgress?.({ fase: 'completado', porcentaje: 100, mensaje: 'Vídeo generado con éxito' });
      
      return finalBlob;

    } catch (error: any) {
      try {
        const md = document.querySelector('div[style*="-9999px"]');
        if (md?.parentElement) document.body.removeChild(md);
      } catch(e) {}
      console.error('❌ Error generando vídeo GPX:', error);
      onProgress?.({ fase: 'error', porcentaje: 0, mensaje: error.message });
      throw error;
    }
  }

  /**
   * Ensambla frames WebP en un contenedor WebM usando EBML binario.
   * Basado en el algoritmo Whammy.js — funciona en cualquier Chrome/Edge sin WebCodecs.
   */
  private ensamblarWebM(frames: string[], fps: number, width: number, height: number): Blob {
    const durationMs = (frames.length / fps) * 1000;
    
    // Convertir data URLs a ArrayBuffers
    const clusters: ArrayBuffer[] = [];
    for (const dataUrl of frames) {
      const webpData = this.dataUrlToArrayBuffer(dataUrl);
      clusters.push(webpData);
    }

    // Construir estructura EBML/WebM
    const EBML: any[] = [
      { id: 0x1a45dfa3, data: [ // EBML Header
        { id: 0x4286, data: 1 },         // EBMLVersion
        { id: 0x42f7, data: 1 },         // EBMLReadVersion
        { id: 0x42f2, data: 4 },         // EBMLMaxIDLength
        { id: 0x42f3, data: 8 },         // EBMLMaxSizeLength
        { id: 0x4282, data: 'webm' },    // DocType
        { id: 0x4287, data: 2 },         // DocTypeVersion
        { id: 0x4285, data: 2 }          // DocTypeReadVersion
      ]},
      { id: 0x18538067, data: [ // Segment
        { id: 0x1549a966, data: [ // Info
          { id: 0x2ad7b1, data: 1000000 },  // TimecodeScale (ns)
          { id: 0x4d80, data: 'TravelMemory' }, // MuxingApp
          { id: 0x5741, data: 'TravelMemory' }, // WritingApp
          { id: 0x4489, data: durationMs }   // Duration (float)
        ]},
        { id: 0x1654ae6b, data: [ // Tracks
          { id: 0xae, data: [ // TrackEntry
            { id: 0xd7, data: 1 },        // TrackNumber
            { id: 0x73c5, data: 1 },      // TrackUID  
            { id: 0x83, data: 1 },        // TrackType (video)
            { id: 0x86, data: 'V_VP8' },  // CodecID
            { id: 0xe0, data: [ // Video
              { id: 0xb0, data: width },   // PixelWidth
              { id: 0xba, data: height }   // PixelHeight
            ]}
          ]}
        ]},
        // Clusters (frames agrupados)
        ...this.crearClusters(clusters, fps)
      ]}
    ];

    const buffer = this.generarEBML(EBML);
    return new Blob([buffer], { type: 'video/webm' });
  }

  private crearClusters(frames: ArrayBuffer[], fps: number): any[] {
    const clusterSize = 30; // 1 cluster por segundo
    const result: any[] = [];
    const frameDuration = 1000 / fps;
    
    for (let i = 0; i < frames.length; i += clusterSize) {
      const clusterFrames: any[] = [];
      const clusterTimecode = Math.round(i * frameDuration);
      
      for (let j = 0; j < clusterSize && (i + j) < frames.length; j++) {
        const relativeTimecode = Math.round(j * frameDuration);
        // SimpleBlock: trackNum=1, timecode(2 bytes), flags(keyframe)
        const block = this.crearSimpleBlock(frames[i + j], relativeTimecode, j === 0);
        clusterFrames.push({ id: 0xa3, data: block }); // SimpleBlock
      }
      
      result.push({
        id: 0x1f43b675, // Cluster
        data: [
          { id: 0xe7, data: clusterTimecode }, // Timecode
          ...clusterFrames
        ]
      });
    }
    return result;
  }

  private crearSimpleBlock(frameData: ArrayBuffer, timecode: number, keyframe: boolean): ArrayBuffer {
    // Track number (EBML coded: 0x81 = track 1)
    // Timecode (2 bytes, signed int16)
    // Flags: 0x80 = keyframe, 0x00 = not keyframe
    const header = new ArrayBuffer(4);
    const view = new DataView(header);
    view.setUint8(0, 0x81); // Track 1
    view.setInt16(1, timecode); // Relative timecode
    view.setUint8(3, keyframe ? 0x80 : 0x00); // Flags
    
    const result = new Uint8Array(header.byteLength + frameData.byteLength);
    result.set(new Uint8Array(header), 0);
    result.set(new Uint8Array(frameData), header.byteLength);
    return result.buffer;
  }

  private dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
    const base64 = dataUrl.split(',')[1];
    // Extraer solo el frame VP8 del WebP (strip RIFF/WebP header de 12 bytes)
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    // El contenedor WebP tiene: RIFF(4) + size(4) + WEBP(4) + VP8_chunk_header(8) = 20 bytes header
    // Buscamos el chunk VP8 
    let offset = 12; // Skip RIFF header
    while (offset < bytes.length - 8) {
      const chunkId = String.fromCharCode(bytes[offset], bytes[offset+1], bytes[offset+2], bytes[offset+3]);
      const chunkSize = bytes[offset+4] | (bytes[offset+5] << 8) | (bytes[offset+6] << 16) | (bytes[offset+7] << 24);
      if (chunkId === 'VP8 ' || chunkId === 'VP8L') {
        return bytes.slice(offset + 8, offset + 8 + chunkSize).buffer;
      }
      offset += 8 + chunkSize + (chunkSize % 2); // padding
    }
    // Fallback: return everything after RIFF header
    return bytes.slice(12).buffer;
  }

  private generarEBML(elements: any[]): ArrayBuffer {
    const buffers: ArrayBuffer[] = [];
    for (const el of elements) {
      buffers.push(this.codificarElementoEBML(el));
    }
    return this.concatenarBuffers(buffers);
  }

  private codificarElementoEBML(element: any): ArrayBuffer {
    const idBytes = this.codificarEBMLId(element.id);
    let dataBuffer: ArrayBuffer;

    if (Array.isArray(element.data)) {
      dataBuffer = this.generarEBML(element.data);
    } else if (typeof element.data === 'string') {
      const enc = new TextEncoder();
      dataBuffer = enc.encode(element.data).buffer;
    } else if (typeof element.data === 'number') {
      if (element.id === 0x4489) { 
        // Duration: encode as float64
        const buf = new ArrayBuffer(8);
        new DataView(buf).setFloat64(0, element.data);
        dataBuffer = buf;
      } else {
        dataBuffer = this.codificarEBMLUint(element.data);
      }
    } else if (element.data instanceof ArrayBuffer) {
      dataBuffer = element.data;
    } else {
      dataBuffer = new ArrayBuffer(0);
    }

    const sizeBytes = this.codificarEBMLSize(dataBuffer.byteLength);
    return this.concatenarBuffers([idBytes, sizeBytes, dataBuffer]);
  }

  private codificarEBMLId(id: number): ArrayBuffer {
    const bytes: number[] = [];
    while (id > 0) {
      bytes.unshift(id & 0xff);
      id >>= 8;
    }
    return new Uint8Array(bytes).buffer;
  }

  private codificarEBMLSize(size: number): ArrayBuffer {
    if (size < 0x7f) {
      return new Uint8Array([0x80 | size]).buffer;
    } else if (size < 0x3fff) {
      return new Uint8Array([0x40 | (size >> 8), size & 0xff]).buffer;
    } else if (size < 0x1fffff) {
      return new Uint8Array([0x20 | (size >> 16), (size >> 8) & 0xff, size & 0xff]).buffer;
    } else {
      return new Uint8Array([
        0x10 | ((size >> 24) & 0x0f), (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff
      ]).buffer;
    }
  }

  private codificarEBMLUint(value: number): ArrayBuffer {
    const bytes: number[] = [];
    if (value === 0) return new Uint8Array([0]).buffer;
    let v = value;
    while (v > 0) {
      bytes.unshift(v & 0xff);
      v >>= 8;
    }
    return new Uint8Array(bytes).buffer;
  }

  private concatenarBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
    let totalLength = 0;
    for (const buf of buffers) totalLength += buf.byteLength;
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of buffers) {
      result.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }
    return result.buffer;
  }

  private async cargarMapaActividad(actividadId: number): Promise<HTMLImageElement> {
    const url = `${environment.apiUrl}/actividades/${actividadId}/mapa`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('No se pudo descargar el mapa de la actividad');
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(blobUrl); resolve(img); };
      img.onerror = () => reject(new Error('Error al decodificar imagen del mapa'));
      img.src = blobUrl;
    });
  }

  private calcularBBox(points: any[]) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    points.forEach(p => {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    });
    const latMargin = (maxLat - minLat) * 0.05;
    const lngMargin = (maxLng - minLng) * 0.05;
    return { 
      minLat: minLat - latMargin, 
      maxLat: maxLat + latMargin, 
      minLng: minLng - lngMargin, 
      maxLng: maxLng + lngMargin 
    };
  }

  private crearProyeccion(bbox: any, width: number, height: number, padding: number) {
    const w = width - (padding * 2);
    const h = height - (padding * 2);
    const latRange = bbox.maxLat - bbox.minLat;
    const lngRange = bbox.maxLng - bbox.minLng;
    const aspect = (lngRange || 1) / (latRange || 1);
    const canvasAspect = w / h;
    
    let drawW = w;
    let drawH = h;
    let offsetX = padding;
    let offsetY = padding;

    if (aspect > canvasAspect) {
      drawH = drawW / aspect;
      offsetY += (h - drawH) / 2;
    } else {
      drawW = drawH * aspect;
      offsetX += (w - drawW) / 2;
    }

    return (lat: number, lng: number) => {
      const x = offsetX + ((lng - bbox.minLng) / (lngRange || 1)) * drawW;
      const y = offsetY + (drawH - ((lat - bbox.minLat) / (latRange || 1)) * drawH);
      return { x, y };
    };
  }

  // NOTA: dibujarRutaProgresiva ya no se usa en generarVideoGpx (reemplazada por buffer incremental)
  // Se mantiene por compatibilidad con otros flujos que puedan usarla.
  private dibujarRutaProgresiva(points: any[], index: number, proyeccion: any) {
    this.ctx.beginPath();
    this.ctx.lineWidth = 10;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = '#2196F3';
    
    for (let i = 0; i <= index; i++) {
      const { x, y } = proyeccion(points[i].lat, points[i].lng);
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.stroke();
  }

  private dibujarMarker(punto: any, proyeccion: any) {
    const { x, y } = proyeccion(punto.lat, punto.lng);
    const mode = punto.mode || 'walking';
    
    // Si tenemos icono para el modo, lo dibujamos
    const iconBase64: { [key: string]: string } = {
      walking: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2Y0NDMzNiI+PHBhdGggZD0iTTEzLjUsNmMxLjEsMCwyLTIsMi0ycy0yLDItMiwyUzEyLjQsNiwxMy41LDZNMTMsMTUuNWgtMS41TDEwLDE0LjJsMC4xLTNMMTAuNSw5TDksMTEuNUw4LDEzLjVMMTYuNSwyMEwxOCwyMEwxNiwxNS41TDEzLDE1LjVaIi8+PC9zdmc+',
      cycling: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzI1NjNFQiI+PHBhdGggZD0iTTE1LjUsNi41YzEuMSwwLDItLjksMi0ycy0uOS0yLTItMnMtMiwuOS0yLDJzLjksMiwyLDJNNSwxNmMwLTIuMiwxLjgtNCw0LTRjMi4yLDAsNCwxLjgsNCw0czEuOCw0LTQsNFM1LDE4LjIsNSwxNk05LDIwYTIuNSwyLjUsMCwwLDEsMC01YTIuNSwyLjUsMCwwLDEsMCw1TTIuNSwxNi41TDQuNCwxOS41TDgsMTYuNUw1LDEzLjVaTTE1LjUsMThhMi41LDIuNSwwLDAsMSwwLTVhMi41LDIuNSwwLDAsMSwwLDVNMTEuNSwxNmgtMi4yTDcuNSwxNEwxMiw4LjVMMTYuNSwxNUwxOCwxNUwxNiwxMC41TDEyLDcuNUw5LDExLjVMMiwxOC41TDIuNSwyMEgxNVoiLz48L3N2Zz4=',
      driving: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI0RDMTYxNiI+PHBhdGggZD0iWjE4LDE4LjVBMi41LDIuNSwwLDAsMSwxNS41LDIxYTIuNSwyLjUsMCwwLDEtMC01YTIuNSwyLjUsMCwwLDEsMCw1TTE5LDE1TDIwLDE1TDE5LDEwdjVMNCwxNVYzTDIwLDE1Wk00LDExTDUuNSw2SDE4LjVMOSw2TDQsMTFaTTQuNSw2YTIuNSwyLjUsMCwwLDEsMi41LDIuNUEyLjUsMi41LDAsMCwxLDQuNSw2TTE4LjUsNkEyLjUsMi41LDAsMCwxLDE2LDguNUEyLjUsMi41LDAsMCwxLDE4LjUsNloiLz48L3N2Zz4='
    };

    const size = 40;
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    this.ctx.beginPath();
    this.ctx.arc(x, y, size/2 + 4, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.strokeStyle = this.getModeColor(mode);
    this.ctx.lineWidth = 3;
    this.ctx.stroke();

    // Dibujar punto central por ahora si no hay icono real cargado aún
    this.ctx.fillStyle = this.getModeColor(mode);
    this.ctx.beginPath();
    this.ctx.arc(x, y, 8, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private getModeColor(mode: string): string {
    switch (mode) {
      case 'walking': return '#059669';
      case 'cycling': return '#D97706';
      case 'driving': return '#DC2626';
      default: return '#2196F3';
    }
  }

  private dibujarDashboard(punto: any, actividad: any, configuracion: any) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const padding = 20;
    const boxW = 220;
    const boxH = 110;
    const x = padding;
    const y = H - boxH - padding;

    // Fondo semi-transparente
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, boxW, boxH, 15);
    this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // Texto de métricas
    this.ctx.fillStyle = 'white';
    this.ctx.textAlign = 'left';
    this.ctx.font = 'bold 16px Arial';
    
    const km = (punto.distAcum / 1000).toFixed(2);
    const tiempo = this.formatearSegundos(punto.timeAcum);
    const pasos = Math.floor(punto.distAcum / 0.75);

    this.ctx.fillText(`📏 ${km} km`, x + 15, y + 30);
    this.ctx.fillText(`⏱️ ${tiempo}`, x + 15, y + 60);
    this.ctx.fillText(`👣 ${pasos} pasos`, x + 15, y + 90);

    // Fecha en la parte superior derecha
    if (actividad.fecha) {
      const fechaTxt = new Date(actividad.fecha).toLocaleDateString();
      this.ctx.textAlign = 'right';
      this.ctx.font = 'bold 20px Arial';
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      this.ctx.fillText(fechaTxt, W - padding, padding + 30);
    }
    this.ctx.restore();
  }

  private formatearSegundos(seg: number): string {
    const h = Math.floor(seg / 3600);
    const m = Math.floor((seg % 3600) / 60);
    const s = Math.floor(seg % 60);
    return [h, m, s]
      .map(v => v < 10 ? '0' + v : v)
      .filter((v, i) => v !== '00' || i > 0)
      .join(':');
  }





  private async muxerVideoAudio(frames: string[], audioBuffer: AudioBuffer, fps: number, width: number, height: number): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    
    const stream = canvas.captureStream(fps);
    const audioCtx = new AudioContext();
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(dest);
    
    const combinedStream = new MediaStream([
      stream.getVideoTracks()[0],
      dest.stream.getAudioTracks()[0]
    ]);

    const recorder = new MediaRecorder(combinedStream, {
      mimeType: 'video/webm;codecs=vp8,opus',
      videoBitsPerSecond: 5000000 // 5Mbps
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);

    return new Promise(async (resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      
      recorder.start();
      source.start(0);

      const frameDuration = 1000 / fps;
      for (let i = 0; i < frames.length; i++) {
        const img = await this.cargarDataUrlAsImage(frames[i]);
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0);
        // Esperar al siguiente frame para mantener el ritmo del MediaRecorder
        await new Promise(r => setTimeout(r, frameDuration));
      }

      recorder.stop();
      audioCtx.close();
    });
  }

  private cargarDataUrlAsImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = dataUrl;
    });
  }

  private getMediaUrl(ruta: string): string {
    const rutaStr = ruta ? ruta.replace(/\\/g, '/') : '';
    return `${environment.apiUrl}/uploads/${rutaStr}`;
  }

  private async cargarAudioBuffer(archivo: any, context: BaseAudioContext): Promise<AudioBuffer | null> {
    const url = archivo.audioUrl || (archivo.rutaArchivo ? this.getMediaUrl(archivo.rutaArchivo) : null);
    if (!url) return null;

    try {
      const resp = await fetch(url);
      const arrayBuffer = await resp.arrayBuffer();
      return await context.decodeAudioData(arrayBuffer);
    } catch (e) {
      console.warn('⚠️ Error cargando buffer de audio:', e);
      return null;
    }
  }
}
