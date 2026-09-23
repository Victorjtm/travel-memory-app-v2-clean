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
   * En rutas con múltiples itinerarios, realiza una mezcla intercalada (round-robin)
   * extrayendo fotos representativas de cada itinerario.
   */
  async prepararRafagaRecuerdos(
    archivos: any[],
    totalFrames: number = 16
  ): Promise<MemoryFrame[]> {
    if (this.precargando) {
      console.log('⏳ [IntroPreloader] Precarga ya en curso...');
      return this.memoriaRafaga;
    }

    this.precargando = true;
    this.liberarMemoria();

    try {
      // 1. Extraer elementos válidos rastreando pertenencia a itinerarios
      const itemsConItinerario = this.extraerElementosConItinerario(archivos);

      console.log(`📸 [IntroPreloader] Total de fotos disponibles: ${itemsConItinerario.length}. Solicitadas para ráfaga: ${totalFrames}`);

      if (itemsConItinerario.length === 0) {
        await this.generarFallbacksVintage(totalFrames);
        return this.memoriaRafaga;
      }

      // 2. Muestreo equilibrado e intercalado entre itinerarios (round-robin)
      const seleccion = this.muestrearRecuerdosIntercalados(itemsConItinerario, totalFrames);

      // 3. Decodificación paralela con decodificación progresiva (inmediata)
      const promesas = seleccion.map((it, idx) => this.decodificarElementoOffscreen(it.item, idx));
      await Promise.all(promesas);

      // Si por falta de archivos o lentitud de red no alcanzamos un mínimo, generamos frames estéticos fallback
      if (this.memoriaRafaga.length < 5) {
        console.warn('⚠️ [IntroPreloader] Generando frames fallback dorados vintage para completar ráfaga');
        await this.generarFallbacksVintage(Math.max(5, totalFrames - this.memoriaRafaga.length));
      }

      console.log(`✅ [IntroPreloader] Ráfaga precargada en VRAM: ${this.memoriaRafaga.length} fotogramas listos a 60 FPS.`);
      return this.memoriaRafaga;
    } catch (error) {
      console.error('❌ [IntroPreloader] Error precargando ráfaga:', error);
      if (this.memoriaRafaga.length === 0) {
        await this.generarFallbacksVintage(6);
      }
      return this.memoriaRafaga;
    } finally {
      this.precargando = false;
    }
  }

  /**
   * 🗺️ Extrae elementos multimedia detectando automáticamente el itinerario al que pertenecen
   */
  private extraerElementosConItinerario(archivos: any[]): { item: any; itinerarioId: string | number }[] {
    let itinerarioActual: string | number = 'general';
    let contadorItin = 0;
    const resultado: { item: any; itinerarioId: string | number }[] = [];

    for (const item of archivos || []) {
      if (!item) continue;

      // Si es una página de separación / carta manuscrita / portada de itinerario, actualizamos el itinerario activo
      if (item.esCartaManuscrita || item.tipoMedia === 'carta-manuscrita') {
        contadorItin++;
        const match = (item.titulo || '').match(/itinerario\s*[:#]?\s*(\d+|[a-zA-ZáéíóúÁÉÍÓÚñÑ]+)/i);
        if (match) {
          itinerarioActual = match[1];
        } else if (item.itinerarioId) {
          itinerarioActual = item.itinerarioId;
        } else {
          itinerarioActual = `itin_${contadorItin}`;
        }
        continue;
      }

      const tipo = (item.tipoMedia || item.tipo || '').toLowerCase();
      const url = item.url || item.ruta || item.src || item.thumbnailUrl;
      const esValido = url && (tipo === 'imagen' || tipo === 'video' || tipo === 'foto' || !tipo);
      if (!esValido) continue;

      // Priorizar itinerario explícito del archivo si existe
      const itId = item.itinerarioId ?? 
                   item.archivo?.itinerarioId ?? 
                   item.idItinerario ?? 
                   item.archivo?.actividadId ?? 
                   itinerarioActual;

      resultado.push({
        item,
        itinerarioId: itId
      });
    }

    return resultado;
  }

  /**
   * 🎯 Muestreo equilibrado e intercalado entre itinerarios:
   * Toma una cuota representativa de cada itinerario y las mezcla en orden alterno
   * para que el usuario disfrute de fotos de todos los itinerarios del viaje.
   */
  private muestrearRecuerdosIntercalados(
    items: { item: any; itinerarioId: string | number }[],
    totalDeseado: number
  ): { item: any; itinerarioId: string | number }[] {
    if (items.length <= totalDeseado) {
      return [...items];
    }

    // Agrupar fotos por itinerario
    const porItinerario = new Map<string | number, { item: any; itinerarioId: string | number }[]>();
    for (const entrada of items) {
      const itId = entrada.itinerarioId;
      if (!porItinerario.has(itId)) {
        porItinerario.set(itId, []);
      }
      porItinerario.get(itId)!.push(entrada);
    }

    // Si hay más de un itinerario con fotos: mezcla intercalada round-robin
    if (porItinerario.size > 1) {
      const grupos = Array.from(porItinerario.values()).filter(g => g.length > 0);
      const numGrupos = grupos.length;
      const cuotaPorGrupo = Math.max(1, Math.ceil(totalDeseado / numGrupos));

      // Muestrear temporalmente dentro de cada itinerario
      const muestrasPorGrupo = grupos.map(grupo => {
        if (grupo.length <= cuotaPorGrupo) return [...grupo];
        const paso = (grupo.length - 1) / (cuotaPorGrupo - 1);
        const sub: { item: any; itinerarioId: string | number }[] = [];
        for (let i = 0; i < cuotaPorGrupo; i++) {
          const idx = Math.min(Math.round(i * paso), grupo.length - 1);
          sub.push(grupo[idx]);
        }
        return sub;
      });

      // Intercalar alternativamente: [Itin1_Foto0, Itin2_Foto0, Itin3_Foto0, Itin1_Foto1, Itin2_Foto1, ...]
      const resultadoIntercalado: { item: any; itinerarioId: string | number }[] = [];
      let idxFoto = 0;
      while (resultadoIntercalado.length < totalDeseado) {
        let anadidaAlguna = false;
        for (let g = 0; g < numGrupos; g++) {
          if (idxFoto < muestrasPorGrupo[g].length) {
            resultadoIntercalado.push(muestrasPorGrupo[g][idxFoto]);
            anadidaAlguna = true;
            if (resultadoIntercalado.length >= totalDeseado) break;
          }
        }
        if (!anadidaAlguna) break;
        idxFoto++;
      }
      return resultadoIntercalado;
    }

    // Si sólo hay un itinerario: muestreo temporal estratificado directo
    const resultado: { item: any; itinerarioId: string | number }[] = [];
    const paso = (items.length - 1) / (totalDeseado - 1);
    for (let i = 0; i < totalDeseado; i++) {
      const index = Math.min(Math.round(i * paso), items.length - 1);
      resultado.push(items[index]);
    }
    return resultado;
  }

  /**
   * 🖼️ Decodifica el archivo como ImageBitmap off-the-main-thread con timeout y push inmediato
   */
  private async decodificarElementoOffscreen(item: any, indice: number): Promise<MemoryFrame | null> {
    try {
      const url = item.url || item.ruta;
      const esVideo = (item.tipoMedia === 'video' || item.tipo === 'video');
      const urlCarga = (esVideo && item.urlMiniatura) ? item.urlMiniatura : url;
      if (!urlCarga) return null;

      // AbortController con timeout de 2.2 segundos para que peticiones lentas no retrasen la ráfaga
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2200);

      try {
        const respuesta = await fetch(urlCarga, { mode: 'cors', signal: controller.signal });
        clearTimeout(timer);
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

        const blob = await respuesta.blob();

        // Decodificación directa preservando la relación de aspecto original
        let bitmap = await createImageBitmap(blob);
        const maxDim = 1280;
        if (bitmap.width > maxDim || bitmap.height > maxDim) {
          const scale = Math.min(maxDim / bitmap.width, maxDim / bitmap.height);
          const w = Math.max(1, Math.round(bitmap.width * scale));
          const h = Math.max(1, Math.round(bitmap.height * scale));
          const resized = await createImageBitmap(bitmap, {
            resizeWidth: w,
            resizeHeight: h,
            resizeQuality: 'medium'
          });
          bitmap.close();
          bitmap = resized;
        }

        const frame: MemoryFrame = {
          bitmap,
          titulo: item.titulo || item.nombre || `Recuerdo #${indice + 1}`,
          esVideo,
          fecha: item.fecha || item.fechaOriginal
        };

        // 🚀 Push progresivo inmediato: disponible para vuelo sin esperar al lote completo
        this.memoriaRafaga.push(frame);
        return frame;
      } catch {
        clearTimeout(timer);
        // Fallback vía tag <img> si fetch con CORS falla
        const frameImg = await this.cargarViaImageTag(item, indice);
        if (frameImg) {
          this.memoriaRafaga.push(frameImg);
        }
        return frameImg;
      }
    } catch {
      return null;
    }
  }

  /**
   * 🌐 Fallback mediante Image() y canvas con timeout de seguridad
   */
  private cargarViaImageTag(item: any, indice: number): Promise<MemoryFrame | null> {
    return new Promise((resolve) => {
      const url = item.url || item.ruta;
      if (!url) {
        resolve(null);
        return;
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';

      let terminado = false;
      const timeoutId = setTimeout(() => {
        if (!terminado) {
          terminado = true;
          resolve(null);
        }
      }, 2000);

      img.onload = async () => {
        if (terminado) return;
        terminado = true;
        clearTimeout(timeoutId);
        try {
          let bitmap = await createImageBitmap(img);
          const maxDim = 1280;
          if (bitmap.width > maxDim || bitmap.height > maxDim) {
            const scale = Math.min(maxDim / bitmap.width, maxDim / bitmap.height);
            const w = Math.max(1, Math.round(bitmap.width * scale));
            const h = Math.max(1, Math.round(bitmap.height * scale));
            const resized = await createImageBitmap(bitmap, {
              resizeWidth: w,
              resizeHeight: h,
              resizeQuality: 'medium'
            });
            bitmap.close();
            bitmap = resized;
          }
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

      img.onerror = () => {
        if (terminado) return;
        terminado = true;
        clearTimeout(timeoutId);
        resolve(null);
      };

      img.src = url;
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
      ctx.fillText('ÁLBUM DE VIAJES & RECUERDOS', 640, 360);

      try {
        const bitmap = await createImageBitmap(canvas);
        this.memoriaRafaga.push({
          bitmap,
          titulo: 'Memoria Dorada',
          esVideo: false
        });
      } catch {}
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
