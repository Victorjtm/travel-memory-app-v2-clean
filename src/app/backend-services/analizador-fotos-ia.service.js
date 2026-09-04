/**
 * ==============================================================================
 * SERVICIO DE ANÁLISIS VISUAL CON GEMINI Y CLUSTERING GEO-TEMPORAL
 * ==============================================================================
 * - Downscaling express en memoria con Sharp a 768px (WebP ~55 KB).
 * - Clustering geo-temporal (<35m, <5min) con selección de foto testigo.
 * - Inferencia en lote con variaciones secuenciales para Álbum 3D.
 * - Job controller en background con streaming vía Server-Sent Events (SSE).
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');

class AnalizadorFotosIAService {
  constructor() {
    this.jobs = new Map(); // jobId -> JobState
    this.cacheGeocoding = new Map(); // "lat,lng" -> "Ciudad / Lugar"
  }

  /**
   * Optimiza una imagen a WebP de 768px máx en memoria sin tocar disco
   */
  async optimizarParaVision(rutaArchivo) {
    try {
      if (!fs.existsSync(rutaArchivo)) {
        throw new Error(`Archivo no encontrado: ${rutaArchivo}`);
      }

      const buffer = await sharp(rutaArchivo)
        .rotate() // Respeta orientación EXIF
        .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      return {
        buffer,
        base64: buffer.toString('base64'),
        mimeType: 'image/webp'
      };
    } catch (error) {
      console.error(`[Sharp] Error optimizando ${rutaArchivo}:`, error.message);
      throw error;
    }
  }

  /**
   * Distancia Haversine en metros entre dos coordenadas
   */
  calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 999999;
    const R = 6371e3; // Radio de la Tierra en metros
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Geocodificación inversa ligera con OSM Nominatim y caché en memoria
   */
  async geocodificarCoordenada(lat, lng) {
    if (!lat || !lng) return null;
    const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (this.cacheGeocoding.has(cacheKey)) {
      return this.cacheGeocoding.get(cacheKey);
    }

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'TravelMemoryApp/2.0 (analisis-fotos)' },
        timeout: 4000
      });

      if (res.data && res.data.address) {
        const addr = res.data.address;
        const hito =
          res.data.name ||
          addr.tourism ||
          addr.historic ||
          addr.amenity ||
          addr.road ||
          addr.pedestrian ||
          addr.suburb ||
          addr.city ||
          addr.town ||
          '';

        const ciudad = addr.city || addr.town || addr.municipality || addr.state || '';
        const contexto = hito && ciudad && hito !== ciudad ? `${hito}, ${ciudad}` : hito || ciudad;

        if (contexto) {
          this.cacheGeocoding.set(cacheKey, contexto);
          return contexto;
        }
      }
    } catch (err) {
      // Ignorar timeout o límite de Nominatim de forma transparente
    }
    return null;
  }

  /**
   * Agrupa fotos ordenadas en clústeres geo-temporales (<35m, <5min)
   */
  agruparFotosEnClusters(fotos, radioMetros = 35, ventanaMinutos = 5) {
    const clusters = [];
    let clusterActual = [];

    for (let i = 0; i < fotos.length; i++) {
      const foto = fotos[i];
      if (clusterActual.length === 0) {
        clusterActual.push(foto);
        continue;
      }

      const anterior = clusterActual[clusterActual.length - 1];
      const dist = this.calcularDistanciaMetros(foto.latitud, foto.longitud, anterior.latitud, anterior.longitud);

      // Calcular diferencia temporal en minutos
      const tFoto = new Date(foto.timestamp).getTime();
      const tAnt = new Date(anterior.timestamp).getTime();
      const difMinutos = Math.abs(tFoto - tAnt) / 60000;

      // Si están próximas en espacio y tiempo, agrupar
      if (dist <= radioMetros && difMinutos <= ventanaMinutos) {
        clusterActual.push(foto);
      } else {
        clusters.push(clusterActual);
        clusterActual = [foto];
      }
    }

    if (clusterActual.length > 0) {
      clusters.push(clusterActual);
    }

    return clusters;
  }

  /**
   * Inferencia con Gemini Vision API (Google AI Studio)
   */
  async llamarGeminiVision(imagenBase64, mimeType, cantidadVariaciones, contextoGeo, apiKey) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('No se ha configurado GEMINI_API_KEY. Introduce tu clave en la modal de análisis.');
    }

    // Cambiar los modelos antiguos por el modelo activo recomendado por Google (2026)
    const modelos = ['gemini-3.6-flash'];

    const promptText = `Analiza detalladamente esta foto de viaje y describe lo que se ve físicamente en ella (objetos, personas, entorno). 
Devuelve la respuesta estrictamente como un array de texto en JSON, donde cada elemento sea una descripción corta siguiendo el formato: [Lugar o Elemento principal] / [Perspectiva o Acción de lo que ocurre]. 
Contexto geográfico para ayudarte: ${contextoGeo || 'Ruta de viaje'}.`;

    const base64Limpio = (imagenBase64 || '').replace(/^data:image\/[a-z0-9+.-]+;base64,/i, '').trim();

    const payload = {
      contents: [
        {
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType: 'image/webp', // Forzar siempre webp ya que sharp entrega este formato
                data: base64Limpio
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1000,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Lista de descripciones secuenciales para las fotos del clúster.'
        }
      }
    };

    let ultimoError = null;
    for (const modelo of modelos) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${key}`;
      try {
        const res = await axios.post(url, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 25000
        });

        const texto = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        const descripciones = this.parsearRespuestaGemini(texto, modelo);
        if (descripciones && descripciones.length > 0) {
          return descripciones;
        }

        throw new Error(`El texto recibido no contiene un array válido: ${texto}`);
      } catch (error) {
        const errorData = error.response?.data || error.message;
        const errorStr = typeof errorData === 'object' ? JSON.stringify(errorData, null, 2) : errorData;
        ultimoError = errorStr;
        console.error(`[Gemini API Error] (${modelo}) Detalles del fallo:`, errorStr);

        // Registrar en archivo de log para diagnóstico directo
        try {
          fs.appendFileSync(
            path.join(process.cwd(), 'gemini_debug.log'),
            `\n[${new Date().toISOString()}] MODELO: ${modelo}\nFALLO:\n${errorStr}\n`
          );
        } catch (e) {}

        // Si falló por incompatibilidad de responseSchema (error 400), reintentar sin responseSchema
        if (error.response?.status === 400 && payload.generationConfig?.responseSchema) {
          try {
            console.log(`[Gemini Vision] Reintentando ${modelo} sin responseSchema estricto...`);
            const payloadSimple = {
              ...payload,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 1000,
                responseMimeType: 'application/json'
              }
            };
            const res2 = await axios.post(url, payloadSimple, {
              headers: { 'Content-Type': 'application/json' },
              timeout: 25000
            });
            const texto2 = res2.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
            const desc2 = this.parsearRespuestaGemini(texto2, modelo);
            if (desc2 && desc2.length > 0) {
              return desc2;
            }
          } catch (retryErr) {
            console.error(`[Gemini API Error] Reintento sin schema también falló:`, retryErr.response?.data || retryErr.message);
          }
        }
      }
    }

    throw new Error(`Error en llamada a Gemini Vision: ${typeof ultimoError === 'object' ? JSON.stringify(ultimoError) : ultimoError}`);
  }

  /**
   * Helper para extraer un array de descripciones desde la respuesta JSON de Gemini
   */
  parsearRespuestaGemini(texto, modelo) {
    if (!texto) return null;
    const limpio = texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let arrayDesc = null;

    try {
      arrayDesc = JSON.parse(limpio);
    } catch (parseErr) {
      const match = limpio.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          arrayDesc = JSON.parse(match[0]);
        } catch (e) {}
      }
    }

    if (Array.isArray(arrayDesc)) {
      const validas = arrayDesc
        .map(item => (typeof item === 'string' ? item.trim() : (item?.descripcion || item?.text || '')))
        .filter(item => Boolean(item && item.length > 0 && item.toLowerCase() !== 'recuerdo de viaje'));

      if (validas.length > 0) {
        console.log(`[Gemini Vision] ${modelo} generó ${validas.length} descripciones exitosamente:`, validas);
        return validas;
      }
    } else if (typeof arrayDesc === 'object' && arrayDesc !== null) {
      const primerArray = Object.values(arrayDesc).find(v => Array.isArray(v));
      if (Array.isArray(primerArray) && primerArray.length > 0) {
        return primerArray.map(v => String(v).trim()).filter(Boolean);
      }
    }

    return null;
  }

  /**
   * Inicia el Job asíncrono y devuelve el jobId
   */
  iniciarJob({ actividadId, archivos, uploadsDir, apiKey }) {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const job = {
      id: jobId,
      actividadId,
      estado: 'INICIADO', // INICIADO, PROCESANDO, COMPLETADO, ERROR, CANCELADO
      progreso: 0,
      clusterActual: 0,
      totalClusters: 0,
      totalArchivos: archivos.length,
      itemsGenerados: [],
      error: null,
      suscriptoresSSE: new Set()
    };

    this.jobs.set(jobId, job);

    // Arrancar procesamiento en segundo plano
    this.procesarJobEnBackground(job, archivos, uploadsDir, apiKey);

    return job;
  }

  /**
   * Bucle de ejecución del Job en segundo plano con emisión SSE
   */
  async procesarJobEnBackground(job, archivos, uploadsDir, apiKey) {
    try {
      job.estado = 'PROCESANDO';
      this.emitirEvento(job, 'estado', { estado: 'PROCESANDO', totalArchivos: archivos.length });

      // 1. Preparar lista ordenada cronológicamente con resolución de ruta física real en disco
      const fotosOrdenadas = archivos
        .filter(a => a.tipo === 'imagen' || a.tipo === 'foto' || /\.(jpe?g|png|webp|avif)$/i.test(a.nombreArchivo || ''))
        .map(a => {
          // Resolver ruta en disco: a.rutaArchivo guarda la ruta relativa dentro de uploads (ej. "255/414/fotos/IMG_...jpg")
          let rutaLocal = a.rutaArchivo ? path.join(uploadsDir, a.rutaArchivo) : path.join(uploadsDir, a.nombreArchivo);
          if (!fs.existsSync(rutaLocal) && a.nombreArchivo) {
            const rutaDirecta = path.join(uploadsDir, a.nombreArchivo);
            if (fs.existsSync(rutaDirecta)) {
              rutaLocal = rutaDirecta;
            }
          }

          let timestamp = Date.now();
          if (a.fechaCreacion && a.horaCaptura) {
            timestamp = new Date(`${a.fechaCreacion.split('T')[0]}T${a.horaCaptura}`).getTime();
          } else if (a.fechaCreacion) {
            timestamp = new Date(a.fechaCreacion).getTime();
          }

          let lat = a.latitud || null;
          let lng = a.longitud || null;
          if ((!lat || !lng) && a.geolocalizacion) {
            try {
              const geo = typeof a.geolocalizacion === 'string' ? JSON.parse(a.geolocalizacion) : a.geolocalizacion;
              lat = geo?.latitud || geo?.latitude || geo?.lat || null;
              lng = geo?.longitud || geo?.longitude || geo?.lng || null;
            } catch (e) {}
          }

          return {
            id: a.id,
            nombreArchivo: a.nombreArchivo,
            rutaArchivo: a.rutaArchivo,
            rutaLocal,
            latitud: lat,
            longitud: lng,
            timestamp
          };
        })
        .sort((a, b) => a.timestamp - b.timestamp);

      if (fotosOrdenadas.length === 0) {
        throw new Error('No hay imágenes válidas para analizar en esta actividad.');
      }

      // 2. Clustering Geo-Temporal
      const clusters = this.agruparFotosEnClusters(fotosOrdenadas, 35, 5);
      job.totalClusters = clusters.length;

      this.emitirEvento(job, 'clusters_identificados', {
        totalClusters: clusters.length,
        totalFotos: fotosOrdenadas.length
      });

      const resultadosFinales = [];

      // 3. Procesar cada clúster
      for (let i = 0; i < clusters.length; i++) {
        if (job.estado === 'CANCELADO') break;

        job.clusterActual = i + 1;
        const grupo = clusters[i];

        // Foto testigo: foto central del grupo
        const idxCentral = Math.floor(grupo.length / 2);
        const fotoTestigo = grupo[idxCentral];

        // Obtener contexto de ubicación por GPS si está disponible
        let contextoGeo = null;
        if (fotoTestigo.latitud && fotoTestigo.longitud) {
          contextoGeo = await this.geocodificarCoordenada(fotoTestigo.latitud, fotoTestigo.longitud);
        }

        // Inferencia visual con Gemini Vision
        let descripcionesDesdeGemini = [];
        try {
          // Optimizar foto testigo a WebP 768px (<60 KB)
          const { base64, mimeType } = await this.optimizarParaVision(fotoTestigo.rutaLocal);

          // Llamada a Gemini Vision solicitando grupo.length variaciones estructuradas
          descripcionesDesdeGemini = await this.llamarGeminiVision(
            base64,
            mimeType,
            grupo.length,
            contextoGeo,
            apiKey
          );
          console.log(`[Job ${job.id}] Clúster ${i + 1}/${clusters.length} analizado por Gemini:`, descripcionesDesdeGemini);
        } catch (visionErr) {
          console.warn(`[Job ${job.id}] Fallo visión en clúster ${i + 1}: ${visionErr.message}. Aplicando fallback contextual.`);
          descripcionesDesdeGemini = [];
        }

        // Asegurar que las descripciones obtenidas tengan contenido real y no vacío
        const descripcionesValidas = (Array.isArray(descripcionesDesdeGemini) ? descripcionesDesdeGemini : [])
          .map(d => (typeof d === 'string' ? d.trim() : ''))
          .filter(d => Boolean(d && d.length > 0 && d.toLowerCase() !== 'recuerdo de viaje'));

        // Asignar descripciones al grupo garantizando contenido real
        const itemsCluster = [];
        grupo.forEach((foto, idx) => {
          let desc = '';

          // 1. Asignar la descripción directa devuelta por Gemini para esta foto
          if (descripcionesValidas[idx] && descripcionesValidas[idx].trim().length > 0) {
            desc = descripcionesValidas[idx].trim();
          }
          // 2. Si hay menos variaciones que fotos en el clúster, derivar de la primera descripción real
          else if (descripcionesValidas.length > 0 && descripcionesValidas[0].trim().length > 0) {
            const baseGemini = descripcionesValidas[0].trim();
            const lugar = baseGemini.includes(' / ') ? baseGemini.split(' / ')[0].trim() : baseGemini;
            desc = `${lugar} / Perspectiva ${idx + 1}`;
          }
          // 3. Fallback con geocodificación si Gemini no respondió
          else if (contextoGeo && contextoGeo.trim().length > 0) {
            desc = grupo.length > 1 ? `${contextoGeo.trim()} / Vista ${idx + 1}` : contextoGeo.trim();
          }
          // 4. Último recurso contextual basado en el nombre del archivo
          else {
            const nombreLimpio = (foto.nombreArchivo || '')
              .replace(/\.[^/.]+$/, '')
              .replace(/[-_]/g, ' ')
              .replace(/IMG|DSC|PANO|PHOTO|\d{4,}/gi, '')
              .trim();
            desc = nombreLimpio.length > 2
              ? `${nombreLimpio} / Vista ${idx + 1}`
              : `Punto de interés / Vista ${idx + 1}`;
          }

          const item = {
            id: foto.id,
            nombreArchivo: foto.nombreArchivo,
            descripcion: desc
          };
          resultadosFinales.push(item);
          itemsCluster.push(item);
        });

        // Actualizar progreso
        job.progreso = Math.round(((i + 1) / clusters.length) * 100);
        job.itemsGenerados = resultadosFinales;

        // Notificar por SSE el clúster completado
        this.emitirEvento(job, 'progreso', {
          progreso: job.progreso,
          clusterActual: i + 1,
          totalClusters: clusters.length,
          itemsRecientes: itemsCluster,
          totalGenerados: resultadosFinales.length
        });

        // Pausa de 300ms entre llamadas para cortesía de API
        await new Promise(r => setTimeout(r, 300));
      }

      if (job.estado !== 'CANCELADO') {
        job.estado = 'COMPLETADO';
        job.progreso = 100;
        this.emitirEvento(job, 'completado', {
          estado: 'COMPLETADO',
          jsonFinal: resultadosFinales
        });
      }
    } catch (err) {
      console.error(`[Job ${job.id}] Error general:`, err);
      job.estado = 'ERROR';
      job.error = err.message;
      this.emitirEvento(job, 'error', { error: err.message });
    }
  }

  /**
   * Conecta una respuesta HTTP Express al canal de eventos SSE
   */
  suscribirStream(jobId, res) {
    const job = this.jobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job no encontrado o expirado' });
      return;
    }

    // Cabeceras obligatorias para Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    job.suscriptoresSSE.add(res);

    // Enviar estado actual inmediatamente
    res.write(`event: conexion\ndata: ${JSON.stringify({
      jobId: job.id,
      estado: job.estado,
      progreso: job.progreso,
      clusterActual: job.clusterActual,
      totalClusters: job.totalClusters,
      itemsGenerados: job.itemsGenerados
    })}\n\n`);

    // Limpiar al desconectar el cliente
    res.on('close', () => {
      job.suscriptoresSSE.delete(res);
      res.end();
    });
  }

  /**
   * Emite un evento SSE con nombre a todos los clientes suscritos
   */
  emitirEvento(job, nombreEvento, datos) {
    if (!job || !job.suscriptoresSSE) return;
    const mensaje = `event: ${nombreEvento}\ndata: ${JSON.stringify(datos)}\n\n`;
    for (const res of job.suscriptoresSSE) {
      try {
        res.write(mensaje);
      } catch (e) {
        job.suscriptoresSSE.delete(res);
      }
    }
  }

  cancelarJob(jobId) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.estado = 'CANCELADO';
      this.emitirEvento(job, 'cancelado', { estado: 'CANCELADO' });
      return true;
    }
    return false;
  }
}

module.exports = new AnalizadorFotosIAService();
