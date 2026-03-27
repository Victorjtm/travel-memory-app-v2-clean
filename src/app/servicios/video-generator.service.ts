  import { Injectable } from '@angular/core';
  import { Archivo } from '../modelos/archivo';
  import { environment } from '../../environments/environment';
  import html2canvas from 'html2canvas';

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
    incluirAudiosSinImagen?: boolean; // ✨ NUEVO
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

    constructor() {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d')!;
    }

  async generarVideoViaje(
    archivos: Archivo[], 
    itinerarios: any[], 
    infoViaje: any,
    configuracion: ConfiguracionVideo,
    paginasCartasManuscritas: any[],
    audioViaje?: HTMLAudioElement | null,
    onProgress?: (progreso: ProgresoVideo) => void
  ): Promise<Blob> {
      
      try {
        // Configurar resolución
        this.configurarResolucion(configuracion.resolucion);
        
// ✨ NUEVO: Diagnóstico de compatibilidad
console.log('🔍 Diagnóstico del sistema:');
console.log('  - Navegador:', navigator.userAgent.includes('Chrome') ? 'Chrome' : navigator.userAgent.includes('Firefox') ? 'Firefox' : 'Otro');
console.log('  - Soporte MediaRecorder:', typeof MediaRecorder !== 'undefined');
console.log('  - Soporte WebM VP8:', MediaRecorder.isTypeSupported('video/webm;codecs=vp8'));
console.log('  - Soporte WebM VP9:', MediaRecorder.isTypeSupported('video/webm;codecs=vp9'));
console.log('  - Resolución canvas:', `${this.canvas.width}x${this.canvas.height}`);

        // Inicializar progreso
        onProgress?.({
          fase: 'cargando',
          porcentaje: 0,
          mensaje: 'Iniciando generación de video...'
        });

        // Filtrar imágenes y videos por separado
        const imagenesArchivos = archivos.filter(a => 
          a.tipo === 'foto' || a.tipo === 'imagen' || this.esImagen(a.nombreArchivo || '')
        );
        
        const videosArchivos = archivos.filter(a => 
          a.tipo === 'video' || this.esVideo(a.nombreArchivo || '')
        );

        if (imagenesArchivos.length === 0 && videosArchivos.length === 0) {
          throw new Error('No hay archivos multimedia para procesar');
        }

        onProgress?.({
          fase: 'cargando',
          porcentaje: 5,
          mensaje: `Procesando ${imagenesArchivos.length} imágenes y ${videosArchivos.length} videos...`
        });

        // Cargar todas las imágenes
        const imagenesProcessadas = await this.cargarImagenes(imagenesArchivos, (progresoCarga) => {
          onProgress?.({
            fase: 'cargando',
            porcentaje: 5 + (progresoCarga * 0.35),
            mensaje: `Cargando imágenes... ${Math.round(progresoCarga)}%`
          });
        });

        // Crear elementos de video para los archivos de video
        const videoElements = await this.crearElementosVideo(videosArchivos, (progresoCarga) => {
          onProgress?.({
            fase: 'cargando',
            porcentaje: 40 + (progresoCarga * 0.25),
            mensaje: `Procesando videos... ${Math.round(progresoCarga)}%`
          });
        });

  onProgress?.({
    fase: 'procesando',
    porcentaje: 65,
    mensaje: 'Organizando contenido multimedia por itinerarios...'
  });

  // Combinar imágenes y videos en un solo array ordenado por fecha
  const contenidoMultimedia = this.combinarContenidoPorFecha(imagenesProcessadas, videoElements);

  console.log('🎬 Iniciando secuencia de video');
  console.log(`📊 Total imágenes: ${imagenesProcessadas.length}`);
  console.log(`🎥 Total videos: ${videoElements.length}`);
  console.log(`📜 Total cartas: ${paginasCartasManuscritas.length}`);
  console.log(`🗺️ Total itinerarios: ${itinerarios.length}`);
  console.log(`📋 Total elementos multimedia: ${contenidoMultimedia.length}`);

        // Preparar audio si existe
        let audioBlob: Blob | null = null;
        let duracionVideoSegundos = 0;
        
if (audioViaje && audioViaje.src) {
  try {
    console.log('🎵 Intentando cargar audio del viaje...');
    console.log('🔗 URL del audio:', audioViaje.src);
    const response = await fetch(audioViaje.src);
    audioBlob = await response.blob();
    console.log('✅ Audio del viaje cargado correctamente');
    console.log('📦 Tamaño del audio:', (audioBlob.size / 1024 / 1024).toFixed(2), 'MB');
  } catch (error) {
    console.error('❌ Error cargando audio del viaje:', error);
    console.warn('⚠️ El video se generará sin audio de fondo');
  }
}

// ✨ NUEVO: Usar método centralizado para calcular duración exacta
duracionVideoSegundos = this.calcularDuracionTotalVideo(
  imagenesProcessadas,
  videoElements,
  paginasCartasManuscritas,
  configuracion
);

console.log(`⏱️ Duración total calculada del video: ${duracionVideoSegundos.toFixed(2)}s`);
        // Configurar stream SOLO de video (sin audio)
        this.stream = this.canvas.captureStream(30);

// ✨ NUEVO: Detectar el mejor códec soportado
let mimeType = this.detectarMejorCodec();
console.log('🎬 Códec seleccionado:', mimeType);

try {
  this.mediaRecorder = new MediaRecorder(this.stream, {
    mimeType: mimeType,
    videoBitsPerSecond: this.obtenerBitrate(configuracion.calidad)
  });
} catch (e) {
  console.error('❌ Error fatal al crear MediaRecorder:', e);
  throw new Error(`MediaRecorder no soportado para ${mimeType}: ${e instanceof Error ? e.message : 'Error desconocido'}`);
}
        
        this.chunks = [];
        this.mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            this.chunks.push(event.data);
          }
        };

        this.mediaRecorder.start(100);
        
        onProgress?.({
          fase: 'generando',
          porcentaje: 60,
          mensaje: 'Generando secuencia de video...'
        });

  await this.generarSecuencia(imagenesProcessadas, videoElements, itinerarios, infoViaje, configuracion, paginasCartasManuscritas, (progresoGen) => {
    onProgress?.({
      fase: 'generando',
      porcentaje: 65 + (progresoGen * 0.3),
      mensaje: `Generando video... ${Math.round(progresoGen)}%`
    });
  });

        this.mediaRecorder.stop();
        this.stream?.getTracks().forEach(track => track.stop());

        // Esperar video sin audio
        const videoSinAudio = await new Promise<Blob>((resolve, reject) => {
          this.mediaRecorder!.onstop = () => {
            try {
              if (this.chunks.length === 0) {
                console.error('❌ Error: No se recibieron datos (chunks vacíos) de MediaRecorder');
                reject(new Error('El video generado está vacío (0 chunks)'));
                return;
              }
              
              const totalSize = this.chunks.reduce((acc, chunk) => acc + chunk.size, 0);
              console.log(`🎬 Video generado: ${this.chunks.length} chunks, total ${ (totalSize / 1024).toFixed(2) } KB`);
              
              const blob = new Blob(this.chunks, { type: 'video/webm' });
              resolve(blob);
            } catch (error) {
              reject(error);
            }
          };
          
          this.mediaRecorder!.onerror = () => {
            reject(new Error('Error en MediaRecorder'));
          };
        });

// Diagnóstico de audio antes de mezclar
if (audioBlob) {
  console.log('🎵 Audio disponible para mezclar:');
  console.log(`  - Tamaño: ${(audioBlob.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  - Duración video: ${duracionVideoSegundos.toFixed(2)}s`);
  console.log('  - Estrategia: loop si audio < video, trim si audio > video');
}

        // Si hay audio, mezclarlo
        if (audioBlob) {
          onProgress?.({
            fase: 'procesando',
            porcentaje: 90,
            mensaje: 'Mezclando audio con video...'
          });

          try {
            const videoConAudio = await this.mezclarAudioYVideo(
              videoSinAudio, 
              audioBlob, 
              duracionVideoSegundos
            );
            
console.log('✅ Video final generado correctamente con audio del viaje');
console.log('📊 Duración total del video:', duracionVideoSegundos.toFixed(2), 'segundos');

onProgress?.({
  fase: 'completado',
  porcentaje: 100,
  mensaje: 'Video con audio generado correctamente!'
});

return videoConAudio;
          } catch (error) {
            console.error('❌ Error mezclando audio:', error);
            console.warn('⚠️ Devolviendo video sin audio');
            
            onProgress?.({
              fase: 'completado',
              porcentaje: 100,
              mensaje: 'Video generado (sin audio por error técnico)'
            });

            return videoSinAudio;
          }
        }

        onProgress?.({
          fase: 'completado',
          porcentaje: 100,
          mensaje: 'Video generado correctamente!'
        });

        return videoSinAudio;

      } catch (error) {
        onProgress?.({
          fase: 'error',
          porcentaje: 0,
          mensaje: `Error: ${error instanceof Error ? error.message : 'Error desconocido'}`
        });
        throw error;
      }
    }

    // NUEVO MÉTODO para mezclar audio y video
private async mezclarAudioYVideo(
  videoBlob: Blob,
  audioBlob: Blob,
  duracionVideo: number
): Promise<Blob> {
  
  return new Promise(async (resolve, reject) => {
    try {
      console.log('🎵 Iniciando mezcla de audio con video...');
      console.log(`⏱️ Duración del video: ${duracionVideo.toFixed(2)}s`);
      
      const audioContext = new AudioContext();
      
      // Decodificar audio
      const audioArrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(audioArrayBuffer);
      
      const duracionAudio = audioBuffer.duration;
      console.log(`🎼 Duración del audio original: ${duracionAudio.toFixed(2)}s`);
      
      // Crear source de audio con ajuste automático
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      
      // ✨ NUEVO: Determinar si necesitamos loop o trim
      if (duracionAudio < duracionVideo) {
        // Audio más corto que video → activar loop
        source.loop = true;
        console.log('🔁 Audio en loop (más corto que el video)');
      } else if (duracionAudio > duracionVideo) {
        // Audio más largo que video → se cortará automáticamente con el timeout
        source.loop = false;
        console.log('✂️ Audio se recortará (más largo que el video)');
      } else {
        source.loop = false;
        console.log('✅ Audio y video tienen la misma duración');
      }
      
      // Crear destination
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
      
      // Obtener stream de audio
      const audioStream = destination.stream;
      
      // Crear video element
      const videoElement = document.createElement('video');
      videoElement.src = URL.createObjectURL(videoBlob);
      videoElement.muted = true;
      
      await videoElement.play();
      
      // Combinar streams
      const videoStream = (videoElement as any).captureStream();
      const combinedStream = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioStream.getAudioTracks()
      ]);
      
      // Usar códec compatible para la mezcla
      const codecMezcla = this.detectarMejorCodec();
      console.log('🎬 Códec para mezcla:', codecMezcla);

      const recorder = new MediaRecorder(combinedStream, {
        mimeType: codecMezcla,
        videoBitsPerSecond: 2500000,
        audioBitsPerSecond: 128000
      });
      
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      
      recorder.onstop = () => {
        source.stop();
        audioContext.close();
        videoElement.pause();
        URL.revokeObjectURL(videoElement.src);
        
        const finalBlob = new Blob(chunks, { type: 'video/webm' });
        console.log('✅ Mezcla completada');
        console.log(`📦 Tamaño del video final: ${(finalBlob.size / 1024 / 1024).toFixed(2)} MB`);
        resolve(finalBlob);
      };
      
      // Iniciar grabación
      source.start(0);
      recorder.start();
      
      // ✨ NUEVO: Detener exactamente cuando termina el video
      setTimeout(() => {
        console.log('⏹️ Finalizando grabación...');
        recorder.stop();
        videoElement.pause();
      }, duracionVideo * 1000 + 500); // +500ms de margen
      
    } catch (error) {
      console.error('❌ Error en mezcla de audio:', error);
      reject(error);
    }
  });
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
  const codecsPreferidos = [
    'video/mp4;codecs=avc1',
    'video/mp4;codecs=h264',
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

private calcularDuracionTotalVideo(
  imagenes: Array<{archivo: Archivo, imagen: HTMLImageElement}>,
  videos: Array<{archivo: Archivo, video: HTMLVideoElement, duracion: number}>,
  paginasCartas: any[],
  configuracion: ConfiguracionVideo
): number {
  const fps = 30;
  
  // Frames por foto (según configuración del usuario)
  const framesPorFoto = configuracion.duracionPorFoto * fps;
  const framesTransicion = configuracion.duracionTransicion * fps;
  
  // Frames por carta
  const framesPorCarta = 5 * fps;
  
  // Frames de videos (duración completa)
  const totalFramesVideos = videos.reduce((total, vid) => total + (vid.duracion * fps), 0);
  
  // Frames de imágenes (con transiciones)
  const totalFramesImagenes = imagenes.length * (framesPorFoto + framesTransicion);
  
  // Frames de cartas (con transiciones)
  const totalFramesCartas = paginasCartas.length * (framesPorCarta + framesTransicion);
  
  // Frames del título inicial (3 segundos)
  const framesTitulo = 3 * fps;
  
  // Total de frames
  const totalFrames = totalFramesImagenes + totalFramesVideos + totalFramesCartas + framesTitulo;
  
  // Convertir a segundos
  const duracionSegundos = totalFrames / fps;
  
  console.log('📊 Cálculo de duración total del video:');
  console.log(`  - Frames de imágenes: ${totalFramesImagenes} (${imagenes.length} fotos × ${configuracion.duracionPorFoto}s)`);
  console.log(`  - Frames de videos: ${totalFramesVideos}`);
  console.log(`  - Frames de cartas: ${totalFramesCartas}`);
  console.log(`  - Frames de título: ${framesTitulo}`);
  console.log(`  - TOTAL: ${totalFrames} frames = ${duracionSegundos.toFixed(2)} segundos`);
  
  return duracionSegundos;
}


    private async cargarImagenes(
      archivos: Archivo[], 
      onProgress?: (progreso: number) => void
    ): Promise<Array<{archivo: Archivo, imagen: HTMLImageElement}>> {
      const imagenesProcessadas: Array<{archivo: Archivo, imagen: HTMLImageElement}> = [];
      
      for (let i = 0; i < archivos.length; i++) {
        const archivo = archivos[i];
        
        try {
          const imagen = await this.cargarImagen(archivo);
          imagenesProcessadas.push({ archivo, imagen });
          
          if (onProgress) {
            onProgress(((i + 1) / archivos.length) * 100);
          }
        } catch (error) {
          console.warn(`Error cargando imagen ${archivo.nombreArchivo}:`, error);
        }
      }
      
      return imagenesProcessadas;
    }

  private async crearElementosVideo(
    archivos: Archivo[], 
    onProgress?: (progreso: number) => void
  ): Promise<Array<{archivo: Archivo, video: HTMLVideoElement, duracion: number}>> {
    const videoElements: Array<{archivo: Archivo, video: HTMLVideoElement, duracion: number}> = [];
    
    for (let i = 0; i < archivos.length; i++) {
      const archivo = archivos[i];
      
      try {
        const videoData = await this.procesarVideo(archivo);
        videoElements.push(videoData);
        
        if (onProgress) {
          onProgress(((i + 1) / archivos.length) * 100);
        }
      } catch (error) {
        console.warn(`Error procesando video ${archivo.nombreArchivo}:`, error);
      }
    }
    
    return videoElements;
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
    console.log(`🎥 Cargando video desde:`, url);
    video.src = url;
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

  private async generarSecuencia(
    imagenes: Array<{archivo: Archivo, imagen: HTMLImageElement}>,
    videos: Array<{archivo: Archivo, video: HTMLVideoElement, duracion: number}>,
    itinerarios: any[],
    infoViaje: any,
    configuracion: ConfiguracionVideo,
    paginasCartasManuscritas: any[],
    onProgress?: (progreso: number) => void
  ): Promise<void> {
    
    const fps = 30;
    const framesPorFoto = configuracion.duracionPorFoto * fps;
    const framesTransicion = configuracion.duracionTransicion * fps;
    const framesPorCarta = 5 * fps; // 5 segundos para cartas manuscritas
    let frameActual = 0;
    let totalFramesEstimados = 0;

console.log('🎬 Iniciando secuencia de video');
console.log(`📊 Total imágenes: ${imagenes.length}`);
console.log(`🖼️ Duración por foto definida por usuario: ${configuracion.duracionPorFoto}s`);
console.log(`🎥 Total videos: ${videos.length}`);
console.log(`🎞️ Videos conservarán su duración original completa`);
console.log(`📜 Total cartas: ${paginasCartasManuscritas.length}`);
console.log(`🗺️ Total itinerarios: ${itinerarios.length}`);

    // Combinar imágenes y videos por fecha
    const contenidoMultimedia = this.combinarContenidoPorFecha(imagenes, videos);
    console.log(`📋 Total elementos multimedia: ${contenidoMultimedia.length}`);

    // ✨ NUEVO: Calcular total de frames con duración completa de videos
const totalFramesVideos = videos.reduce((total, vid) => total + (vid.duracion * fps), 0);
console.log(`📊 Total frames de videos (duración completa): ${totalFramesVideos}`);
    totalFramesEstimados = 
      imagenes.length * (framesPorFoto + framesTransicion) + 
      totalFramesVideos +
      paginasCartasManuscritas.length * (framesPorCarta + framesTransicion) +
      (3 * fps); // título inicial

    // Título inicial del viaje
    await this.dibujarTitulo(infoViaje.nombre || 'Mi Viaje', 3 * fps, () => {
      frameActual += 1;
      onProgress?.((frameActual / totalFramesEstimados) * 100);
    });

  // Si estamos en contexto de itinerario específico, procesar solo ese itinerario
  if (itinerarios.length === 1) {
    const itinerario = itinerarios[0];
    const contenidoItinerario = contenidoMultimedia; // El contenido ya viene filtrado por itinerario
    
    console.log(`📍 Procesando itinerario único: ${itinerario.id}`);
    console.log(`📋 Contenido del itinerario: ${contenidoItinerario.length} elementos`);

    // Mostrar carta manuscrita del itinerario
    const carta = paginasCartasManuscritas[0]; // Solo debería haber una
    if (carta) {
      console.log(`📝 Mostrando carta: "${carta.titulo}"`);
      await this.dibujarCartaManuscrita(carta, framesPorCarta, () => {
        frameActual += 1;
        onProgress?.((frameActual / totalFramesEstimados) * 100);
      });
    }
    
    // Procesar contenido multimedia (imágenes y videos) en orden
    for (let i = 0; i < contenidoItinerario.length; i++) {
      const elemento = contenidoItinerario[i];
      const siguienteElemento = contenidoItinerario[i + 1];
      
      if (elemento.tipo === 'imagen') {
        const { archivo, imagen } = elemento.data;
        console.log(`📸 Foto ${i + 1}/${contenidoItinerario.length}: ${archivo.nombreArchivo}`);
        
        await this.mostrarFoto(imagen, archivo, configuracion, framesPorFoto, () => {
          frameActual += 1;
          onProgress?.((frameActual / totalFramesEstimados) * 100);
        });
        
        if (siguienteElemento && siguienteElemento.tipo === 'imagen') {
          const tipoTransicion = configuracion.transicionesAleatorias 
            ? this.obtenerTransicionAleatoria() 
            : configuracion.tipoTransicion;
          
          await this.aplicarTransicion(
            imagen, 
            siguienteElemento.data.imagen, 
            tipoTransicion,
            framesTransicion,
            () => {
              frameActual += 1;
              onProgress?.((frameActual / totalFramesEstimados) * 100);
            }
          );
        }
} else if (elemento.tipo === 'video') {
  const { archivo, video, duracion } = elemento.data;
  console.log(`🎥 Video ${i + 1}/${contenidoItinerario.length}: ${archivo.nombreArchivo} (${duracion}s)`);
  
  // ✨ NUEVO: Videos con duración completa sin límite
  const duracionVideoFrames = duracion * fps;
  console.log(`🎞️ Manteniendo duración original del video: ${duracion}s`);
  
  await this.mostrarVideo(video, archivo, configuracion, duracionVideoFrames, () => {
    frameActual += 1;
    onProgress?.((frameActual / totalFramesEstimados) * 100);
  });
}
    }
      
      return; // Terminar aquí para itinerario único
    }

  // Si estamos en contexto de página principal, procesar todos los itinerarios
  // Agrupar contenido multimedia por itinerario
  const contenidoPorItinerario = this.agruparContenidoPorItinerario(contenidoMultimedia, itinerarios);

  // Procesar cada itinerario con su carta manuscrita + contenido multimedia
  for (const itinerario of itinerarios) {
    const contenidoItinerario = contenidoPorItinerario.get(itinerario.id) || [];
    
    console.log(`🔍 Itinerario ${itinerario.id} tiene ${contenidoItinerario.length} elementos multimedia`);
    
    // Si no hay contenido, saltar este itinerario
    if (contenidoItinerario.length === 0) {
      console.log(`⏭️ Saltando itinerario ${itinerario.id} - sin contenido`);
      continue;
    }
    
    // Buscar carta manuscrita de este itinerario
    const carta = paginasCartasManuscritas.find(c => {
      // Si tenemos itinerarioId, comparar directamente
      if (c.itinerarioId !== undefined && c.itinerarioId !== null) {
        const match = c.itinerarioId === itinerario.id;
        if (match) {
          console.log(`✅ Carta encontrada por ID para itinerario ${itinerario.id}: "${c.titulo}"`);
        }
        return match;
      }
      
      // Fallback: buscar por texto limpiando caracteres problemáticos
      if (!c.titulo || !itinerario.destinosPorDia) return false;
      
      const destinoLimpio = itinerario.destinosPorDia
        .replace(/["'\\]/g, '') // Quitar todas las comillas y barras
        .split(',')[0]
        .trim()
        .toLowerCase();
      
      const tituloLimpio = c.titulo.toLowerCase();
      const match = tituloLimpio.includes(destinoLimpio);
      
      if (match) {
        console.log(`✅ Carta encontrada por texto para itinerario ${itinerario.id}: "${destinoLimpio}" en "${c.titulo}"`);
      }
      
      return match;
    });

  if (!carta) {
      console.warn(`⚠️ No se encontró carta para itinerario ${itinerario.id} ("${itinerario.destinosPorDia}")`);
    } else {
      console.log(`📋 Carta encontrada para itinerario ${itinerario.id}, preparando para mostrar...`);
    }
    
    // 1. Mostrar carta manuscrita del itinerario
    if (carta) {
      console.log(`🎬 MOSTRANDO carta manuscrita: "${carta.titulo}"`);
        await this.dibujarCartaManuscrita(carta, framesPorCarta, () => {
          frameActual += 1;
          onProgress?.((frameActual / totalFramesEstimados) * 100);
        });
        
  // Transición de carta a primer elemento de contenido
  if (contenidoItinerario.length > 0) {
    const primerElemento = contenidoItinerario[0];
    const tipoTransicion = configuracion.transicionesAleatorias 
      ? this.obtenerTransicionAleatoria() 
      : configuracion.tipoTransicion;
    
    if (primerElemento.tipo === 'imagen') {
      await this.transicionDesdeCartaAFoto(
        carta,
        primerElemento.data.imagen,
        tipoTransicion,
        framesTransicion,
        () => {
          frameActual += 1;
          onProgress?.((frameActual / totalFramesEstimados) * 100);
        }
      );
    } else {
      // Si el primer elemento es un video, hacer fade simple
      await this.transicionDesdeCartaAFoto(
        carta,
        primerElemento.data.video,
        'fade',
        framesTransicion,
        () => {
          frameActual += 1;
          onProgress?.((frameActual / totalFramesEstimados) * 100);
        }
      );
    }
  }
    }
    
  // 2. Mostrar contenido multimedia del itinerario (imágenes y videos)
    for (let i = 0; i < contenidoItinerario.length; i++) {
      const elemento = contenidoItinerario[i];
      const siguienteElemento = contenidoItinerario[i + 1];
      
      if (elemento.tipo === 'imagen') {
        const { archivo, imagen } = elemento.data;
        console.log(`📸 Foto ${i + 1}/${contenidoItinerario.length}: ${archivo.nombreArchivo}`);
        
        await this.mostrarFoto(imagen, archivo, configuracion, framesPorFoto, () => {
          frameActual += 1;
          onProgress?.((frameActual / totalFramesEstimados) * 100);
        });
        
        if (siguienteElemento && siguienteElemento.tipo === 'imagen') {
          const tipoTransicion = configuracion.transicionesAleatorias 
            ? this.obtenerTransicionAleatoria() 
            : configuracion.tipoTransicion;
          
          await this.aplicarTransicion(
            imagen, 
            siguienteElemento.data.imagen, 
            tipoTransicion,
            framesTransicion,
            () => {
              frameActual += 1;
              onProgress?.((frameActual / totalFramesEstimados) * 100);
            }
          );
        }
} else if (elemento.tipo === 'video') {
      const { archivo, video, duracion } = elemento.data;
      console.log(`🎥 Video ${i + 1}/${contenidoItinerario.length}: ${archivo.nombreArchivo} (${duracion}s)`);
      
      // ✨ NUEVO: Los videos mantienen su duración completa original
      const duracionVideoFrames = duracion * fps; // Sin límite de tiempo
      console.log(`🎞️ Manteniendo duración original del video: ${duracion}s`);
      
      await this.mostrarVideo(video, archivo, configuracion, duracionVideoFrames, () => {
        frameActual += 1;
        onProgress?.((frameActual / totalFramesEstimados) * 100);
      });
    }
    }
    }
  }

  private agruparContenidoPorItinerario(
    contenido: Array<{tipo: 'imagen' | 'video', data: any, fecha: Date}>,
    itinerarios: any[]
  ): Map<number, Array<{tipo: 'imagen' | 'video', data: any, fecha: Date}>> {
    
    const map = new Map<number, Array<{tipo: 'imagen' | 'video', data: any, fecha: Date}>>();
    
    console.log('🔍 DEBUG agruparContenidoPorItinerario:');
    console.log(`  Total contenido a procesar: ${contenido.length}`);
    console.log(`  Total itinerarios: ${itinerarios.length}`);
    
    for (const elemento of contenido) {
      let itinerarioId: number | undefined;
      
      if (elemento.tipo === 'imagen') {
        itinerarioId = elemento.data.archivo.itinerarioId;
      } else if (elemento.tipo === 'video') {
        itinerarioId = elemento.data.archivo.itinerarioId;
      }
      
      // Primero intentar por itinerarioId directo (si existe)
      if (itinerarioId) {
        if (!map.has(itinerarioId)) {
          map.set(itinerarioId, []);
        }
        map.get(itinerarioId)!.push(elemento);
        console.log(`  ✅ Contenido asignado al itinerario ${itinerarioId} (por itinerarioId directo)`);
        continue;
      }
      
      // Si no tiene itinerarioId, buscar por fecha en los itinerarios
      if (elemento.fecha) {
        const itinerarioEncontrado = itinerarios.find(it => {
          const fechaInicio = new Date(it.fechaInicio);
          const fechaFin = new Date(it.fechaFin || it.fechaInicio);
          return elemento.fecha >= fechaInicio && elemento.fecha <= fechaFin;
        });
        
        if (itinerarioEncontrado) {
          if (!map.has(itinerarioEncontrado.id)) {
            map.set(itinerarioEncontrado.id, []);
          }
          map.get(itinerarioEncontrado.id)!.push(elemento);
          console.log(`  ✅ Contenido asignado al itinerario ${itinerarioEncontrado.id} (por fecha)`);
        } else {
          console.warn(`  ⚠️ No se pudo asignar contenido a ningún itinerario`);
        }
      }
    }
    
    // Log del resultado final
    console.log('📊 Resultado de agrupación de contenido:');
    map.forEach((contenido, itinerarioId) => {
      console.log(`  Itinerario ${itinerarioId}: ${contenido.length} elementos`);
    });
    
    return map;
  }

  private combinarContenidoPorFecha(
    imagenes: Array<{archivo: Archivo, imagen: HTMLImageElement}>,
    videos: Array<{archivo: Archivo, video: HTMLVideoElement, duracion: number}>
  ): Array<{tipo: 'imagen' | 'video', data: any, fecha: Date}> {
    const contenido: Array<{tipo: 'imagen' | 'video', data: any, fecha: Date}> = [];
    
    // Añadir imágenes
    imagenes.forEach(img => {
      const fecha = new Date(img.archivo.fechaCreacion || 0);
      contenido.push({
        tipo: 'imagen',
        data: img,
        fecha
      });
    });
    
    // Añadir videos
    videos.forEach(vid => {
      const fecha = new Date(vid.archivo.fechaCreacion || 0);
      contenido.push({
        tipo: 'video',
        data: vid,
        fecha
      });
    });
    
    // Ordenar por fecha (más antiguos primero)
    contenido.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
    
    console.log(`📊 Contenido combinado: ${contenido.length} elementos (${imagenes.length} imágenes, ${videos.length} videos)`);
    return contenido;
  }

  private obtenerTransicionAleatoria(): 'fade' | 'slide' | 'zoom' {
    const transiciones: ('fade' | 'slide' | 'zoom')[] = ['fade', 'slide', 'zoom'];
    return transiciones[Math.floor(Math.random() * transiciones.length)];
  }

    private async mostrarFoto(
      imagen: HTMLImageElement, 
      archivo: Archivo, 
      configuracion: ConfiguracionVideo, 
      frames: number,
      onFrame?: () => void
    ): Promise<void> {
      
      for (let frame = 0; frame < frames; frame++) {
        // Limpiar canvas
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Dibujar imagen centrada y escalada
        this.dibujarImagenCentrada(imagen);
        
        // Añadir texto si está habilitado
        if (configuracion.incluirTexto) {
          this.dibujarTextoImagen(archivo);
        }
        
        onFrame?.();
        await this.esperarFrame();
      }
    }

    private async mostrarVideo(
    video: HTMLVideoElement, 
    archivo: Archivo, 
    configuracion: ConfiguracionVideo, 
    frames: number,
    onFrame?: () => void
  ): Promise<void> {
    
    // Reiniciar el video para asegurar que empiece desde el principio
    video.currentTime = 0;
    
    // Esperar a que el video esté listo para reproducir
    await new Promise<void>((resolve) => {
      if (video.readyState >= 2) { // HAVE_CURRENT_DATA
        resolve();
      } else {
        video.oncanplay = () => resolve();
      }
    });
    
    // Iniciar reproducción
    try {
      await video.play();
    } catch (error) {
      console.warn('Error al reproducir video:', error);
    }
    
    for (let frame = 0; frame < frames; frame++) {
      // Limpiar canvas
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      
      // Dibujar el frame actual del video centrado y escalado
      this.dibujarVideoCentrado(video);
      
      // Añadir texto si está habilitado
      if (configuracion.incluirTexto) {
        this.dibujarTextoImagen(archivo);
      }
      
      onFrame?.();
      await this.esperarFrame();
    }
    
    // Pausar el video después de mostrarlo
    video.pause();
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

      const padding = 20;
      const maxWidth = this.canvas.width - (padding * 2);
      
      // Configurar estilo del texto
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      this.ctx.fillRect(0, this.canvas.height - 100, this.canvas.width, 100);
      
      this.ctx.fillStyle = '#fff';
      this.ctx.font = 'bold 24px Arial';
      this.ctx.textAlign = 'left';
      
      let y = this.canvas.height - 70;
      
      if (archivo.descripcion) {
        const textoTruncado = this.truncarTexto(archivo.descripcion, maxWidth, '24px Arial');
        this.ctx.fillText(textoTruncado, padding, y);
        y += 30;
      }
      
      if (archivo.fechaCreacion) {
        this.ctx.font = '18px Arial';
        const fecha = new Date(archivo.fechaCreacion).toLocaleDateString('es-ES');
        this.ctx.fillText(fecha, padding, y);
      }
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

    private async aplicarTransicion(
      imagenActual: HTMLImageElement,
      imagenSiguiente: HTMLImageElement,
      tipo: 'fade' | 'slide' | 'zoom',
      frames: number,
      onFrame?: () => void
    ): Promise<void> {
      
      for (let frame = 0; frame < frames; frame++) {
        const progreso = frame / frames;
        
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        switch (tipo) {
          case 'fade':
            this.transicionFade(imagenActual, imagenSiguiente, progreso);
            break;
          case 'slide':
            this.transicionSlide(imagenActual, imagenSiguiente, progreso);
            break;
          case 'zoom':
            this.transicionZoom(imagenActual, imagenSiguiente, progreso);
            break;
        }
        
        onFrame?.();
        await this.esperarFrame();
      }
    }

    private transicionFade(img1: HTMLImageElement, img2: HTMLImageElement, progreso: number): void {
      this.ctx.globalAlpha = 1 - progreso;
      this.dibujarImagenCentrada(img1);
      
      this.ctx.globalAlpha = progreso;
      this.dibujarImagenCentrada(img2);
      
      this.ctx.globalAlpha = 1;
    }

    private transicionSlide(img1: HTMLImageElement, img2: HTMLImageElement, progreso: number): void {
      const offset = this.canvas.width * progreso;
      
      // Guardar contexto
      this.ctx.save();
      
      // Imagen actual saliendo por la izquierda
      this.ctx.translate(-offset, 0);
      this.dibujarImagenCentrada(img1);
      
      // Restaurar y configurar para la siguiente imagen
      this.ctx.restore();
      this.ctx.save();
      this.ctx.translate(this.canvas.width - offset, 0);
      this.dibujarImagenCentrada(img2);
      
      this.ctx.restore();
    }

    private transicionZoom(img1: HTMLImageElement, img2: HTMLImageElement, progreso: number): void {
      // Imagen actual con zoom out
      this.ctx.save();
      const scale1 = 1 + progreso * 0.5;
      this.ctx.scale(scale1, scale1);
      this.ctx.translate(-this.canvas.width * progreso * 0.25, -this.canvas.height * progreso * 0.25);
      this.ctx.globalAlpha = 1 - progreso;
      this.dibujarImagenCentrada(img1);
      this.ctx.restore();
      
      // Imagen siguiente con zoom in
      this.ctx.save();
      const scale2 = 1.5 - progreso * 0.5;
      this.ctx.scale(scale2, scale2);
      this.ctx.translate(-this.canvas.width * (1 - progreso) * 0.25, -this.canvas.height * (1 - progreso) * 0.25);
      this.ctx.globalAlpha = progreso;
      this.dibujarImagenCentrada(img2);
      this.ctx.restore();
    }

  private async esperarFrame(ms?: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms || 33));
  }

    private async dibujarTitulo(titulo: string, frames: number, onFrame?: () => void): Promise<void> {
      for (let frame = 0; frame < frames; frame++) {
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Efecto fade in/out
        let alpha = 1;
        if (frame < 30) alpha = frame / 30; // Fade in
        else if (frame > frames - 30) alpha = (frames - frame) / 30; // Fade out
        
        this.ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        this.ctx.font = 'bold 72px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(titulo, this.canvas.width / 2, this.canvas.height / 2);
        
        onFrame?.();
        await this.esperarFrame();
      }
    }

    private async dibujarCartaManuscrita(
    carta: any, 
    frames: number, 
    onFrame?: () => void
  ): Promise<void> {
    
    for (let frame = 0; frame < frames; frame++) {
      // Fondo con textura de papel viejo
      this.ctx.fillStyle = '#f4f1e8';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      
      // Efecto fade in/out
      let alpha = 1;
      if (frame < 30) alpha = frame / 30;
      else if (frame > frames - 30) alpha = (frames - frame) / 30;
      
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
        for (const linea of lineas.slice(0, 15)) { // Máximo 15 líneas
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
      
      onFrame?.();
      await this.esperarFrame();
    }
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

  private async transicionDesdeCartaAFoto(
    carta: any,
    mediaSiguiente: HTMLImageElement | HTMLVideoElement,
    tipo: 'fade' | 'slide' | 'zoom',
    frames: number,
    onFrame?: () => void
  ): Promise<void> {
    
    for (let frame = 0; frame < frames; frame++) {
      const progreso = frame / frames;
      
      // Dibujar carta con fade out
      this.ctx.globalAlpha = 1 - progreso;
      this.ctx.fillStyle = '#f4f1e8';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      
      // Dibujar media (imagen o video) con fade in
      this.ctx.globalAlpha = progreso;
      if (mediaSiguiente instanceof HTMLImageElement) {
        this.dibujarImagenCentrada(mediaSiguiente);
      } else if (mediaSiguiente instanceof HTMLVideoElement) {
        this.dibujarVideoCentrado(mediaSiguiente);
      }
      
      this.ctx.globalAlpha = 1;
      
      onFrame?.();
      await this.esperarFrame();
    }
  }

  // Métodos auxiliares

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
        if (f % 15 === 0) await new Promise(r => setTimeout(r, 0));
      }

      // == 3. Animación de Ruta ==
      const numPuntos = points.length;
      const totalFramesAnimacion = 300;
      
      const rutaBuffer = document.createElement('canvas');
      rutaBuffer.width = W;
      rutaBuffer.height = H;
      const rutaCtx = rutaBuffer.getContext('2d')!;
      let ultimoIdx = -1;

      const puntosMedia: { idx: number; archivos: any[] }[] = [];
      for (let i = 0; i < numPuntos; i++) {
        if (points[i].event?.archivos?.length > 0) {
          puntosMedia.push({ idx: i, archivos: points[i].event.archivos });
        }
      }
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
        capturarFrame();

        // Multimedia
        while (nextMedia < puntosMedia.length && puntosMedia[nextMedia].idx <= idxPunto) {
          const m = puntosMedia[nextMedia];
          for (const archivo of m.archivos) {
            onProgress?.({ fase: 'procesando', porcentaje: pct, mensaje: `Mostrando: ${archivo.nombreArchivo}` });
            if (this.esImagen(archivo.nombreArchivo)) {
              try {
                const img = await this.cargarImagen(archivo);
                const durSec = configuracion.duracionPorFoto || 3;
                const numF = Math.floor(durSec * fps);
                for (let mf = 0; mf < numF; mf++) {
                  this.ctx.fillStyle = '#000';
                  this.ctx.fillRect(0, 0, W, H);
                  this.dibujarImagenCentrada(img, 'contain');
                  this.dibujarTextoImagen(archivo);
                  capturarFrame();
                  if (mf % 10 === 0) await new Promise(r => setTimeout(r, 0));
                }
              } catch (e) {
                console.warn('⚠️ Error cargando imagen:', e);
              }
            }
            this.ctx.drawImage(mapaFondo, 0, 0, W, H);
            this.ctx.drawImage(rutaBuffer, 0, 0);
            this.dibujarMarker(punto, proyeccion);
            capturarFrame();
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

      // == 4. Ensamblar WebM desde frames WebP ==
      onProgress?.({ fase: 'generando', porcentaje: 92, mensaje: `Ensamblando ${webpFrames.length} frames en vídeo...` });
      console.log(`🎬 Total frames capturados: ${webpFrames.length}. Ensamblando WebM...`);
      
      await new Promise(r => setTimeout(r, 50)); // yield antes del ensamblado pesado
      const blob = this.ensamblarWebM(webpFrames, fps, W, H);
      
      console.log(`✅ Vídeo generado: ${(blob.size / 1024 / 1024).toFixed(2)} MB, ${webpFrames.length} frames`);
      onProgress?.({ fase: 'completado', porcentaje: 100, mensaje: 'Vídeo generado con éxito' });
      
      return blob;

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
    this.ctx.fillStyle = '#f44336';
    this.ctx.beginPath();
    this.ctx.arc(x, y, 14, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.strokeStyle = 'white';
    this.ctx.lineWidth = 4;
    this.ctx.stroke();
  }

  private async procesarMediaGpx(
    archivo: any, 
    configuracion: any, 
    audioCtx: AudioContext, 
    audioDest: MediaStreamAudioDestinationNode
  ) {
    if (this.esImagen(archivo.nombreArchivo)) {
      const img = await this.cargarImagen(archivo);
      let durationSec = configuracion.duracionPorFoto || 4;
      
      let audioSource: AudioBufferSourceNode | null = null;
      if (archivo.audioAsociadoUrl) {
        try {
          const resp = await fetch(archivo.audioAsociadoUrl);
          const arrayBuffer = await resp.arrayBuffer();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          durationSec = Math.max(durationSec, audioBuffer.duration);
          audioSource = audioCtx.createBufferSource();
          audioSource.buffer = audioBuffer;
          audioSource.connect(audioDest);
          audioSource.start();
        } catch (e) {
          console.warn('⚠️ No se pudo cargar audio asociado:', e);
        }
      }

      const numFrames = Math.floor(durationSec * 30);
      for (let f = 0; f < numFrames; f++) {
        this.ctx.fillStyle = 'black';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.dibujarImagenCentrada(img, 'contain');
        this.dibujarTextoImagen(archivo);
        await this.esperarFrame();
      }
      if (audioSource) audioSource.stop();

    } else if (this.esVideo(archivo.nombreArchivo)) {
      const videoData = await this.procesarVideo(archivo);
      const { video, duracion } = videoData;
      let source: MediaElementAudioSourceNode | null = null;
      try {
        source = audioCtx.createMediaElementSource(video);
        source.connect(audioDest);
        video.muted = false;
      } catch (e) {
        console.warn('⚠️ No se pudo capturar audio del video:', e);
      }
      await video.play();
      const numFrames = Math.floor(duracion * 30);
      for (let f = 0; f < numFrames; f++) {
        this.ctx.fillStyle = 'black';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.dibujarVideoCentrado(video);
        this.dibujarTextoImagen(archivo);
        await this.esperarFrame();
      }
      video.pause();
      if (source) source.disconnect();

    } else if (archivo.tipo === 'audio' && configuracion.incluirAudiosSinImagen) {
      // 🎼 Manejo de Audio Solitario (sin imagen)
      try {
        const resp = await fetch(this.getMediaUrl(archivo.rutaArchivo));
        const arrayBuffer = await resp.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
        const durationSec = audioBuffer.duration;
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioDest);
        source.start();

        const numFrames = Math.floor(durationSec * 30);
        for (let f = 0; f < numFrames; f++) {
          // Mantener el fondo (mapa) mientras suena el audio
          // No limpiamos el canvas aquí para que se vea por donde íbamos
          this.dibujarTextoImagen(archivo); // Mostrar nombre del audio
          await this.esperarFrame();
        }
        source.stop();
      } catch (e) {
        console.warn('⚠️ No se pudo procesar audio solitario:', e);
      }
    }
  }

  private getMediaUrl(ruta: string): string {
    const rutaStr = ruta ? ruta.replace(/\\/g, '/') : '';
    return `${environment.apiUrl}/uploads/${rutaStr}`;
  }
}
