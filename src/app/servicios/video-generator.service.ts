  import { Injectable } from '@angular/core';
  import { Archivo } from '../modelos/archivo';
  import { environment } from '../../environments/environment';

  export interface ConfiguracionVideo {
    duracionPorFoto: number;
    tipoTransicion: 'fade' | 'slide' | 'zoom';
    duracionTransicion: number;
    incluirTexto: boolean;
    calidad: 'alta' | 'media' | 'baja';
    mostrarDescripciones: boolean;
    resolucion: '1080p' | '720p' | '480p';
    transicionesAleatorias: boolean; // 👈 AÑADIR ESTA LÍNEA
    modoAjuste?: 'contain' | 'cover'; // ✨ NUEVO: modo de ajuste de imágenes
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

this.mediaRecorder = new MediaRecorder(this.stream, {
  mimeType: mimeType,
  videoBitsPerSecond: this.obtenerBitrate(configuracion.calidad)
});
        
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
  // Lista de códecs en orden de preferencia (más compatible primero)
  const codecsPreferidos = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
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

    private cargarImagen(archivo: Archivo): Promise<HTMLImageElement> {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Error cargando ${archivo.nombreArchivo}`));
        img.src = this.obtenerUrlArchivo(archivo);
      });
    }

    private obtenerUrlArchivo(archivo: Archivo): string {
      if (!archivo?.rutaArchivo) return '/assets/images/no-image.jpg';
      if (archivo.rutaArchivo.startsWith('http')) return archivo.rutaArchivo;
      
      const nombreArchivo = archivo.rutaArchivo.split(/[\\/]/).pop();
      return `${environment.apiUrl}/uploads/${nombreArchivo}`;
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

  private async esperarFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
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
  } // ← AGREGAR ESTA LLAVE

  // Métodos auxiliares

    private esImagen(nombreArchivo: string): boolean {
      const extensiones = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
      const extension = nombreArchivo.toLowerCase().substring(nombreArchivo.lastIndexOf('.'));
      return extensiones.includes(extension);
    }
  }
