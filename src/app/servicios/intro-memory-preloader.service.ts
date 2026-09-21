import { Injectable } from '@angular/core';

export interface MemoryFrame {
  bitmap: ImageBitmap;
  titulo?: string;
  esVideo: boolean;
  fecha?: string;
}

@Injectable({
  providedIn: 'root'
})
export class IntroMemoryPreloaderService {
  private memoriaRafaga: MemoryFrame[] = [];
  private precargando: boolean = false;

  constructor() {}

  /**
   * ⚡ Prepara y precalienta en memoria gráfica (VRAM) una selección equilibrada de recuerdos.
   * Utiliza createImageBitmap() off-thread para decodificar JPEG/PNG sin congelar el hilo principal.
   */
  async prepararRafagaRecuerdos(
    archivos: any[],
    totalFrames: number = 30
  ): Promise<MemoryFrame[]> {
    if (this.precargando) {
      console.log('⏳ [IntroPreloader] Precarga ya en curso...');
      return this.memoriaRafaga;
    }

    this.precargando = true;
    this.liberarMemoria();

    try {
      const itemsValidos = (archivos || []).filter(item => {
        if (!item) return false;
        const tipo = (item.tipoMedia || item.tipo || '').toLowerCase();
        const url = item.url || item.ruta;
        return url && (tipo === 'imagen' || tipo === 'video' || tipo === 'foto' || !tipo);
      });

      console.log(`📸 [IntroPreloader] Total de elementos disponibles: ${itemsValidos.length}. Solicitados para ráfaga: ${totalFrames}`);

      // Muestreo equilibrado temporal a lo largo de todo el viaje
      const seleccion = this.muestrearRecuerdos(itemsValidos, totalFrames);

      // Decodificación paralela mediante createImageBitmap con resolución exacta 1280x720
      const promesas = seleccion.map((item, idx) => this.decodificarElementoOffscreen(item, idx));
      const resultados = await Promise.all(promesas);

      this.memoriaRafaga = resultados.filter((f): f is MemoryFrame => f !== null);

      // Si por falta de archivos o errores de red no alcanzamos un mínimo, generamos frames estéticos fallback
      if (this.memoriaRafaga.length < 10) {
        console.warn('⚠️ [IntroPreloader] Generando frames fallback dorados vintage para completar ráfaga');
        await this.generarFallbacksVintage(15 - this.memoriaRafaga.length);
      }

      console.log(`✅ [IntroPreloader] Ráfaga precargada en VRAM: ${this.memoriaRafaga.length} fotogramas listos a 60 FPS.`);
      return this.memoriaRafaga;
    } catch (error) {
      console.error('❌ [IntroPreloader] Error precargando ráfaga:', error);
      return this.memoriaRafaga;
    } finally {
      this.precargando = false;
    }
  }

  /**
   * 🎯 Muestreo estratificado para cubrir principio, nudo y desenlace del viaje
   */
  private muestrearRecuerdos(items: any[], totalDeseado: number): any[] {
    if (items.length <= totalDeseado) {
      return [...items];
    }

    const resultado: any[] = [];
    const paso = (items.length - 1) / (totalDeseado - 1);

    for (let i = 0; i < totalDeseado; i++) {
      const index = Math.min(Math.round(i * paso), items.length - 1);
      resultado.push(items[index]);
    }

    // Aleatorizar sutilmente el orden de la ráfaga estroboscópica para dinamismo
    return this.mezclarArray(resultado);
  }

  private mezclarArray(arr: any[]): any[] {
    const copia = [...arr];
    for (let i = copia.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
  }

  /**
   * 🖼️ Decodifica el archivo como ImageBitmap off-the-main-thread
   */
  private async decodificarElementoOffscreen(item: any, indice: number): Promise<MemoryFrame | null> {
    try {
      const url = item.url || item.ruta;
      const esVideo = (item.tipoMedia === 'video' || item.tipo === 'video');

      // Si es vídeo, usamos su miniatura o póster si existe
      const urlCarga = (esVideo && item.urlMiniatura) ? item.urlMiniatura : url;

      const respuesta = await fetch(urlCarga, { mode: 'cors' });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

      const blob = await respuesta.blob();

      // Decodificación directa en hilo secundario del navegador a la GPU
      const bitmap = await createImageBitmap(blob, {
        resizeWidth: 1280,
        resizeHeight: 720,
        resizeQuality: 'medium'
      });

      return {
        bitmap,
        titulo: item.titulo || item.nombre || `Recuerdo #${indice + 1}`,
        esVideo,
        fecha: item.fecha || item.fechaOriginal
      };
    } catch (e) {
      // Fallback si fetch con CORS falla (ejemplo: elemento <img> con crossOrigin)
      return await this.cargarViaImageTag(item, indice);
    }
  }

  /**
   * 🌐 Fallback mediante Image() y canvas en caso de que fetch directo esté restringido
   */
  private cargarViaImageTag(item: any, indice: number): Promise<MemoryFrame | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        try {
          const bitmap = await createImageBitmap(img, {
            resizeWidth: 1280,
            resizeHeight: 720,
            resizeQuality: 'medium'
          });
          resolve({
            bitmap,
            titulo: item.titulo || item.nombre || `Recuerdo #${indice + 1}`,
            esVideo: (item.tipoMedia === 'video' || item.tipo === 'video'),
            fecha: item.fecha
          });
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = item.url || item.ruta;
    });
  }

  /**
   * 🎨 Generador de fotogramas artísticos vintage si el viaje tiene pocos medios
   */
  private async generarFallbacksVintage(cantidad: number): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const temas = ['#1a120b', '#2c1810', '#1f2421', '#1e1b18', '#2b2118'];

    for (let i = 0; i < cantidad; i++) {
      ctx.fillStyle = temas[i % temas.length];
      ctx.fillRect(0, 0, 1280, 720);

      // Marco dorado y filigrana
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 4;
      ctx.strokeRect(40, 40, 1200, 640);

      ctx.strokeStyle = 'rgba(212, 175, 55, 0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(52, 52, 1176, 616);

      // Texto evocador
      ctx.fillStyle = '#f3e5ab';
      ctx.font = 'italic 36px "Cinzel", "Georgia", serif';
      ctx.textAlign = 'center';
      ctx.fillText('CRUCERO & RECUERDOS', 640, 360);

      const bitmap = await createImageBitmap(canvas);
      this.memoriaRafaga.push({
        bitmap,
        titulo: 'Memoria Dorada',
        esVideo: false
      });
    }
  }

  /**
   * 📦 Obtiene el frame precalculado por índice o por porcentaje de tiempo
   */
  obtenerFrameEnTiempo(tiempoNormalizado0a1: number): MemoryFrame | null {
    if (this.memoriaRafaga.length === 0) return null;
    const idx = Math.floor(tiempoNormalizado0a1 * this.memoriaRafaga.length) % this.memoriaRafaga.length;
    return this.memoriaRafaga[idx];
  }

  obtenerTodosLosFrames(): MemoryFrame[] {
    return this.memoriaRafaga;
  }

  /**
   * 🧹 Liberación forzosa inmediata de VRAM para no saturar memoria móvil o de escritorio
   */
  liberarMemoria(): void {
    if (this.memoriaRafaga.length > 0) {
      console.log(`🧹 [IntroPreloader] Liberando ${this.memoriaRafaga.length} bitmaps de VRAM`);
      for (const frame of this.memoriaRafaga) {
        try {
          frame.bitmap.close();
        } catch {}
      }
      this.memoriaRafaga = [];
    }
  }
}
