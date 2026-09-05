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
   * Genera un hash de diferencia dHash (64 bits) para deduplicar ráfagas idénticas
   */
  async calcularDHash(rutaLocal) {
    try {
      if (!fs.existsSync(rutaLocal)) return null;
      const { data } = await sharp(rutaLocal)
        .rotate()
        .resize(9, 8, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      let hash = '';
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const left = data[y * 9 + x];
          const right = data[y * 9 + (x + 1)];
          hash += left > right ? '1' : '0';
        }
      }
      return hash;
    } catch (err) {
      console.warn(`[dHash] Error calculando hash para ${rutaLocal}:`, err.message);
      return null;
    }
  }

  /**
   * Distancia de Hamming entre dos hashes binarios
   */
  distanciaHamming(hash1, hash2) {
    if (!hash1 || !hash2 || hash1.length !== hash2.length) return 999;
    let dist = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) dist++;
    }
    return dist;
  }

  /**
   * Inferencia Multimodal en Lote (5 fotos por petición) con Gemini Vision
   * - Payload entrelazado (texto con ID + imagen WebP)
   * - Schema estricto { id, descripcion }
   * - Backoff exponencial con Jitter ante error 429 / 503
   */
  async llamarGeminiLoteMultimodal(loteFotos, contextoGeo, apiKey, job, contextoViajeros) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      const msg = 'No se ha configurado GEMINI_API_KEY. Introduce tu clave en la modal de análisis antes de iniciar.';
      try {
        fs.appendFileSync(
          path.join(process.cwd(), 'gemini_debug.log'),
          `\n[${new Date().toISOString()}] ERROR CRÍTICO: ${msg}\n`
        );
      } catch (e) {}
      throw new Error(msg);
    }

    const modelo = 'gemini-3.6-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${key}`;

    try {
      fs.appendFileSync(
        path.join(process.cwd(), 'gemini_debug.log'),
        `\n[${new Date().toISOString()}] >>> INICIANDO LOTE: Modelo=${modelo}, ${loteFotos.length} fotos, Key=${key.substring(0, 6)}... (Contexto viajeros: "${contextoViajeros || 'ninguno'}")\n`
      );
    } catch (e) {}

    // Construcción entrelazada de Parts (Texto con ID + WebP 768px inlineData)
    const parts = [];
    for (let idx = 0; idx < loteFotos.length; idx++) {
      const foto = loteFotos[idx];
      try {
        const { base64 } = await this.optimizarParaVision(foto.rutaLocal);
        const base64Limpio = String(base64 || '').replace(/^data:image\/[a-z0-9+.-]+;base64,/i, '').trim();
        parts.push({ text: `Foto con ID "${foto.id}" (Archivo: ${foto.nombreArchivo}):` });
        parts.push({
          inlineData: {
            mimeType: 'image/webp',
            data: base64Limpio
          }
        });
      } catch (optErr) {
        console.warn(`[Gemini Batch] No se pudo optimizar foto ${foto.nombreArchivo}:`, optErr.message);
      }
    }

    // Prompt Maestro al final del lote con personalización de viajeros
    const promptMaestro = `INDICACIONES DE IDENTIDAD Y ESTILO NARRATIVO:
- Contexto personalizado del viaje y sus integrantes: ${contextoViajeros || 'Una pareja de viajeros realizando turismo.'}. 
- Si identificas visualmente a las personas descritas en el contexto anterior dentro de una imagen, utiliza sus nombres propios reales (ej: Víctor, Belén) en lugar de términos genéricos como "un hombre", "una mujer" o "una pareja".

Analiza individualmente cada una de las imágenes presentadas arriba. 
Genera para cada una de ellas una descripción corta basándote estrictamente en lo que se observa físicamente.
Sigue el formato estricto: [Lugar o Elemento predominante] / [Perspectiva o Acción visual concreta donde participen los viajeros si aparecen]. Max 12 palabras por foto.
Contexto geográfico de apoyo: ${contextoGeo || 'Ruta de viaje'}.
Devuelve la respuesta mapeando el array JSON respetando los IDs proporcionados.`;

    parts.push({ text: promptMaestro });

    const payloadConSchema = {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING' },
              descripcion: { type: 'STRING' }
            },
            required: ['id', 'descripcion']
          }
        }
      }
    };

    const maxIntentos = 4;
    let ultimoError = null;

    for (let intento = 1; intento <= maxIntentos; intento++) {
      try {
        const res = await axios.post(url, payloadConSchema, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 45000
        });

        const texto = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        const parseado = this.parsearRespuestaLote(texto);
        if (parseado && parseado.length > 0) {
          try {
            fs.appendFileSync(
              path.join(process.cwd(), 'gemini_debug.log'),
              `\n[${new Date().toISOString()}] BATCH ÉXITO: ${parseado.length} descripciones devueltas por ${modelo}.\n`
            );
          } catch (e) {}
          return parseado;
        }

        throw new Error(`Respuesta no contiene array JSON válido: ${texto.substring(0, 120)}`);
      } catch (error) {
        const status = error.response?.status;
        const errorData = error.response?.data || error.message;
        const errorStr = typeof errorData === 'object' ? JSON.stringify(errorData, null, 2) : errorData;
        ultimoError = errorStr;

        console.error(`[Gemini Batch Error] Intento ${intento}/${maxIntentos} (Status: ${status}):`, errorStr.substring(0, 200));

        // Registro en log de debug
        try {
          fs.appendFileSync(
            path.join(process.cwd(), 'gemini_debug.log'),
            `\n[${new Date().toISOString()}] BATCH INTENTO ${intento} (Status: ${status}):\n${errorStr}\n`
          );
        } catch (e) {}

        // Si falló por 400 (incompatibilidad con responseSchema), intentar sin schema
        if (status === 400 && intento === 1) {
          try {
            console.log('[Gemini Batch] Reintentando sin responseSchema estricto...');
            const payloadSinSchema = {
              ...payloadConSchema,
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 2048,
                responseMimeType: 'application/json'
              }
            };
            const res2 = await axios.post(url, payloadSinSchema, {
              headers: { 'Content-Type': 'application/json' },
              timeout: 45000
            });
            const texto2 = res2.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
            const parseado2 = this.parsearRespuestaLote(texto2);
            if (parseado2 && parseado2.length > 0) {
              return parseado2;
            }
          } catch (retry400Err) {
            console.error('[Gemini Batch] Reintento sin schema también falló:', retry400Err.message);
          }
        }

        // Manejo de Rate Limit (429) o Spikes temporales (503) con Backoff Exponencial + Jitter
        if (status === 429 || status === 503) {
          let segundosEspera = 0;

          // Verificar si Google envía retryDelay
          const violations = error.response?.data?.error?.details || [];
          for (const d of violations) {
            if (d.retryDelay) {
              const segs = parseInt(String(d.retryDelay).replace('s', ''), 10);
              if (!isNaN(segs) && segs > 0) {
                segundosEspera = segs + 2; // margen de seguridad
                break;
              }
            }
          }

          if (segundosEspera <= 0) {
            // Backoff exponencial: 4s, 8s, 16s... con jitter aleatorio
            segundosEspera = Math.min(45, Math.pow(2, intento + 1) + Math.floor(Math.random() * 3) + 2);
          }

          console.warn(`[Gemini Batch 429/503] Saturación de cuota. Esperando ${segundosEspera}s antes de reintentar (intento ${intento}/${maxIntentos})...`);
          this.emitirEvento(job, 'esperando_cuota', {
            intento,
            segundosEspera,
            mensaje: `Esperando cuota de API (${segundosEspera}s) para continuar...`
          });

          await new Promise(r => setTimeout(r, segundosEspera * 1000));
          continue; // Reintentar siguiente iteración del bucle
        }

        // Si es otro error y quedan intentos, pausa corta
        if (intento < maxIntentos) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    throw new Error(`Error en lote tras ${maxIntentos} intentos: ${typeof ultimoError === 'object' ? JSON.stringify(ultimoError) : ultimoError}`);
  }

  /**
   * Helper para parsear la respuesta estructurada de un lote
   */
  parsearRespuestaLote(texto) {
    if (!texto) return null;
    const limpio = texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let array = null;

    try {
      array = JSON.parse(limpio);
    } catch (err) {
      const match = limpio.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          array = JSON.parse(match[0]);
        } catch (e) {}
      }
    }

    if (Array.isArray(array)) {
      return array
        .map(item => ({
          id: String(item?.id || '').trim(),
          descripcion: String(item?.descripcion || item?.description || '').trim()
        }))
        .filter(item => item.id && item.descripcion && item.descripcion.toLowerCase() !== 'recuerdo de viaje');
    } else if (typeof array === 'object' && array !== null) {
      const arr = Object.values(array).find(v => Array.isArray(v));
      if (Array.isArray(arr)) {
        return arr
          .map(item => ({
            id: String(item?.id || '').trim(),
            descripcion: String(item?.descripcion || item?.description || '').trim()
          }))
          .filter(item => item.id && item.descripcion && item.descripcion.toLowerCase() !== 'recuerdo de viaje');
      }
    }

    return null;
  }

  /**
   * Inicia el Job asíncrono y devuelve el jobId
   */
  iniciarJob({ actividadId, archivos, uploadsDir, apiKey, modo = 'testigo', contextoViajeros = null }) {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const job = {
      id: jobId,
      actividadId,
      modo, // 'testigo' o 'batch_total'
      contextoViajeros: contextoViajeros || null,
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

    // Derivar al pipeline seleccionado
    if (modo === 'batch_total') {
      this.procesarJobVisionTotal(job, archivos, uploadsDir, apiKey, contextoViajeros);
    } else {
      this.procesarJobEnBackground(job, archivos, uploadsDir, apiKey);
    }

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
   * Pipeline de Visión Total (Multi-Image Batching)
   * - Deduplicación dHash express en memoria para detectar ráfagas idénticas
   * - Lotes de 5 imágenes enviadas entrelazadas directamente a Gemini
   * - Respuesta estructurada 100% fidedigna para cada imagen real
   * - Streaming reactivo por SSE
   */
  async procesarJobVisionTotal(job, archivos, uploadsDir, apiKey, contextoViajeros) {
    try {
      job.estado = 'PROCESANDO';
      this.emitirEvento(job, 'estado', { estado: 'PROCESANDO', totalArchivos: archivos.length, modo: 'batch_total' });

      // 1. Filtrar imágenes válidas y ordenar cronológicamente
      const fotosOrdenadas = archivos
        .filter(a => a.tipo === 'imagen' || a.tipo === 'foto' || /\.(jpe?g|png|webp|avif)$/i.test(a.nombreArchivo || ''))
        .map(a => {
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

      // 2. Deduplicación local en memoria con dHash (detectar ráfagas idénticas consecutivas)
      const fotosParaVision = [];
      const rafagasAsociadas = new Map(); // idFotoPrincipal -> [fotosDeRafaga]
      let anteriorHash = null;
      let anteriorFoto = null;

      for (const foto of fotosOrdenadas) {
        const hash = await this.calcularDHash(foto.rutaLocal);
        foto.dHash = hash;

        let esRafaga = false;
        if (anteriorHash && hash && anteriorFoto) {
          const distH = this.distanciaHamming(hash, anteriorHash);
          const difSeg = Math.abs(foto.timestamp - anteriorFoto.timestamp) / 1000;

          // Si la diferencia visual es mínima (<= 4 bits) o si fue en menos de 10s con <= 6 bits
          if (distH <= 4 || (distH <= 6 && difSeg <= 10)) {
            esRafaga = true;
            foto.esRafagaDe = anteriorFoto.id;
            if (!rafagasAsociadas.has(anteriorFoto.id)) {
              rafagasAsociadas.set(anteriorFoto.id, []);
            }
            rafagasAsociadas.get(anteriorFoto.id).push(foto);
          }
        }

        if (!esRafaga) {
          fotosParaVision.push(foto);
          if (!rafagasAsociadas.has(foto.id)) {
            rafagasAsociadas.set(foto.id, []);
          }
          anteriorFoto = foto;
          anteriorHash = hash;
        }
      }

      // 3. Fragmentación en Lotes Multimodales (5 fotos por lote)
      const tamanoLote = 5;
      const lotes = [];
      for (let i = 0; i < fotosParaVision.length; i += tamanoLote) {
        lotes.push(fotosParaVision.slice(i, i + tamanoLote));
      }

      job.totalClusters = lotes.length;
      const totalRafagas = fotosOrdenadas.length - fotosParaVision.length;

      this.emitirEvento(job, 'clusters_identificados', {
        totalClusters: lotes.length,
        totalFotos: fotosOrdenadas.length,
        fotosParaVision: fotosParaVision.length,
        rafagasDetectadas: totalRafagas,
        modo: 'batch_total'
      });

      console.log(`[Job ${job.id}] Visión Total: ${fotosOrdenadas.length} fotos (${fotosParaVision.length} para análisis visual en ${lotes.length} lotes, ${totalRafagas} ráfagas detectadas).`);

      const resultadosFinales = [];

      // 4. Procesar cada lote multimodal con Gemini Vision
      for (let i = 0; i < lotes.length; i++) {
        if (job.estado === 'CANCELADO') break;

        job.clusterActual = i + 1;
        const lote = lotes[i];

        // Obtener contexto geográfico de la primera foto del lote que tenga GPS
        let contextoGeo = null;
        const fotoConGPS = lote.find(f => f.latitud && f.longitud);
        if (fotoConGPS) {
          contextoGeo = await this.geocodificarCoordenada(fotoConGPS.latitud, fotoConGPS.longitud);
        }

        let descripcionesLote = [];
        try {
          descripcionesLote = await this.llamarGeminiLoteMultimodal(lote, contextoGeo, apiKey, job, contextoViajeros);
        } catch (loteErr) {
          console.warn(`[Job ${job.id}] Fallo completo en lote ${i + 1}:`, loteErr.message);
          try {
            fs.appendFileSync(
              path.join(process.cwd(), 'gemini_debug.log'),
              `\n[${new Date().toISOString()}] [Job ${job.id}] Fallo en lote ${i + 1}: ${loteErr.message}\n`
            );
          } catch (e) {}

          // Si falta la API Key o es inválida, abortar el job de inmediato con error visible en UI
          if (loteErr.message && (loteErr.message.includes('GEMINI_API_KEY') || loteErr.message.includes('API_KEY_INVALID') || loteErr.message.includes('API key not valid'))) {
            job.estado = 'ERROR';
            job.error = loteErr.message;
            this.emitirEvento(job, 'error', { error: loteErr.message });
            return;
          }

          descripcionesLote = [];
        }

        // Mapear descripciones obtenidas por ID
        const mapaDesc = new Map();
        if (Array.isArray(descripcionesLote)) {
          descripcionesLote.forEach(item => {
            if (item && item.id) {
              mapaDesc.set(String(item.id).trim(), String(item.descripcion || '').trim());
            }
          });
        }

        const itemsRecientesLote = [];

        // Asignar descripción a cada foto del lote
        lote.forEach((foto, idx) => {
          let desc = mapaDesc.get(String(foto.id));

          // Si no vino mapeado por ID pero coincide la posición
          if (!desc && descripcionesLote && descripcionesLote[idx]?.descripcion) {
            desc = descripcionesLote[idx].descripcion.trim();
          }

          // Fallback con geocodificación si la IA no devolvió esta foto
          if (!desc || desc.length === 0) {
            if (contextoGeo) {
              desc = `${contextoGeo} / Punto de interés`;
            } else {
              const nombreLimpio = (foto.nombreArchivo || '')
                .replace(/\.[^/.]+$/, '')
                .replace(/[-_]/g, ' ')
                .replace(/IMG|DSC|PANO|PHOTO|\d{4,}/gi, '')
                .trim();
              desc = nombreLimpio.length > 2 ? `${nombreLimpio} / Vista` : 'Recuerdo de viaje / Vista';
            }
          }

          const item = {
            id: foto.id,
            nombreArchivo: foto.nombreArchivo,
            descripcion: desc
          };
          resultadosFinales.push(item);
          itemsRecientesLote.push(item);

          // Asignar misma descripción a las ráfagas deduplicadas asociadas a esta foto
          const rList = rafagasAsociadas.get(foto.id) || [];
          rList.forEach((rFoto, rIdx) => {
            const descRafaga = `${desc} / Toma continua`;
            const itemR = {
              id: rFoto.id,
              nombreArchivo: rFoto.nombreArchivo,
              descripcion: descRafaga
            };
            resultadosFinales.push(itemR);
            itemsRecientesLote.push(itemR);
          });
        });

        // Actualizar progreso
        job.progreso = Math.round(((i + 1) / lotes.length) * 100);
        job.itemsGenerados = resultadosFinales;

        // Notificar por SSE el progreso del lote procesado
        this.emitirEvento(job, 'progreso', {
          progreso: job.progreso,
          clusterActual: i + 1,
          totalClusters: lotes.length,
          itemsRecientes: itemsRecientesLote,
          totalGenerados: resultadosFinales.length,
          modo: 'batch_total'
        });

        // Pausa de cortesía de 800ms entre lotes para respetar cuota RPM de Google AI Studio
        await new Promise(r => setTimeout(r, 800));
      }

      if (job.estado !== 'CANCELADO') {
        job.estado = 'COMPLETADO';
        job.progreso = 100;

        // Reordenar resultados para asegurar que coincidan con el orden de entrada
        const mapaResultados = new Map(resultadosFinales.map(r => [r.id, r]));
        const resultadosOrdenados = fotosOrdenadas
          .map(f => mapaResultados.get(f.id))
          .filter(Boolean);

        this.emitirEvento(job, 'completado', {
          estado: 'COMPLETADO',
          jsonFinal: resultadosOrdenados.length > 0 ? resultadosOrdenados : resultadosFinales
        });
      }
    } catch (err) {
      console.error(`[Job ${job.id}] Error en Vision Total:`, err);
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
