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
      throw new Error('No se ha configurado GEMINI_API_KEY.');
    }

    // Modelos a intentar en orden de preferencia (rápido y multimodal)
    const modelos = ['gemini-2.0-flash', 'gemini-1.5-flash'];

    let promptText = '';
    if (cantidadVariaciones <= 1) {
      promptText = `Eres un redactor de cuadernos de viaje vintage. Analiza esta fotografía turística.
${contextoGeo ? `Contexto de ubicación aproximada: ${contextoGeo}.` : ''}
Instrucciones:
- Genera exactamente UNA descripción breve y evocadora con el formato: [Lugar o Monumento] / [Perspectiva o Acción o Vistas].
- Máximo 10-12 palabras.
- Responde ÚNICAMENTE con el texto de la descripción, sin introducciones ni comillas.`;
    } else {
      promptText = `Eres un redactor de cuadernos de viaje vintage. Esta foto es representativa de un grupo de ${cantidadVariaciones} fotos tomadas en el mismo lugar turístico.
${contextoGeo ? `Contexto de ubicación aproximada: ${contextoGeo}.` : ''}
Instrucciones:
- Genera exactamente ${cantidadVariaciones} descripciones distintas y secuenciales para este hito (ej. toma general o panorámica, perspectiva arquitectónica, detalle, ambiente).
- Todas deben seguir el formato: [Lugar o Monumento] / [Perspectiva o Detalle].
- Responde ÚNICAMENTE con un array JSON válido de strings, por ejemplo:
["Catedral de Cagliari / Fachada principal y escalinatas", "Catedral de Cagliari / Detalle del campanario histórico", "Catedral de Cagliari / Vista lateral desde la plaza"]
- Sin bloques de código markdown, solo el array JSON puro.`;
    }

    const payload = {
      contents: [
        {
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType: mimeType || 'image/webp',
                data: imagenBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 300
      }
    };

    let ultimoError = null;
    for (const modelo of modelos) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${key}`;
        const res = await axios.post(url, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 20000
        });

        const texto = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        if (texto) {
          if (cantidadVariaciones <= 1) {
            return [texto.replace(/^["'`]|["'`]$/g, '').trim()];
          } else {
            // Intentar parsear array JSON
            try {
              const limpio = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
              const arrayDesc = JSON.parse(limpio);
              if (Array.isArray(arrayDesc) && arrayDesc.length > 0) {
                return arrayDesc;
              }
            } catch (e) {
              // Si no devuelve JSON válido, partir por líneas o generar variaciones
              const lineas = texto.split('\n').map(l => l.replace(/^[-*\d.)\s"]+|["\s]+$/g, '').trim()).filter(Boolean);
              if (lineas.length >= cantidadVariaciones) {
                return lineas.slice(0, cantidadVariaciones);
              }
              // Rellenar si faltan
              const base = lineas[0] || contextoGeo || 'Recuerdo de viaje';
              return Array.from({ length: cantidadVariaciones }, (_, i) => `${base} (Vista ${i + 1})`);
            }
          }
        }
      } catch (err) {
        ultimoError = err.response?.data?.error?.message || err.message;
        console.warn(`[Gemini Vision] Modelo ${modelo} falló: ${ultimoError}, probando siguiente...`);
      }
    }

    throw new Error(`Error en llamada a Gemini Vision: ${ultimoError || 'Sin respuesta'}`);
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

      // 1. Preparar lista ordenada cronológicamente
      const fotosOrdenadas = archivos
        .filter(a => a.tipo === 'imagen' || a.tipo === 'foto' || /\.(jpe?g|png|webp|avif)$/i.test(a.nombreArchivo || ''))
        .map(a => {
          const rutaLocal = path.join(uploadsDir, a.nombreArchivo);
          let timestamp = Date.now();
          if (a.fechaCreacion && a.horaCaptura) {
            timestamp = new Date(`${a.fechaCreacion.split('T')[0]}T${a.horaCaptura}`).getTime();
          } else if (a.fechaCreacion) {
            timestamp = new Date(a.fechaCreacion).getTime();
          }
          return {
            id: a.id,
            nombreArchivo: a.nombreArchivo,
            rutaLocal,
            latitud: a.latitud || (a.geolocalizacion ? a.geolocalizacion.lat : null),
            longitud: a.longitud || (a.geolocalizacion ? a.geolocalizacion.lng : null),
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

        let descripcionesGrupo = [];
        try {
          // Optimizar foto testigo a WebP 768px (<60 KB)
          const { base64, mimeType } = await this.optimizarParaVision(fotoTestigo.rutaLocal);

          // Llamada a Gemini Vision solicitando grupo.length variaciones
          descripcionesGrupo = await this.llamarGeminiVision(
            base64,
            mimeType,
            grupo.length,
            contextoGeo,
            apiKey
          );
        } catch (visionErr) {
          console.warn(`[Job ${job.id}] Fallo visión en cluster ${i + 1}: ${visionErr.message}. Usando fallback geoespacial.`);
          // Fallback en caso de error de API o cuota: usar geocodificación
          const base = contextoGeo || 'Recuerdo de viaje';
          descripcionesGrupo = grupo.map((_, idx) =>
            grupo.length > 1 ? `${base} / Perspectiva ${idx + 1}` : base
          );
        }

        // Asignar descripciones al grupo
        const itemsCluster = [];
        grupo.forEach((foto, idx) => {
          const desc = descripcionesGrupo[idx] || descripcionesGrupo[0] || 'Recuerdo de viaje';
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
