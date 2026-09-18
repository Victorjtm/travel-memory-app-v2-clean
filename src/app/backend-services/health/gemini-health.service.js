/**
 * ==============================================================================
 * SERVICIO DE EXTRACCIÓN DE SALUD Y RENDIMIENTO FÍSICO CON GOOGLE AI STUDIO (GEMINI)
 * ==============================================================================
 * Módulo 100% aislado para procesamiento visual de capturas de Xiaomi Mi Fitness
 * y Báscula Inteligente mediante Gemini Vision con retorno estricto JSON.
 */

const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Cache en memoria para la lista de modelos disponibles por API Key (TTL: 15 min)
const modelCache = new Map();

class GeminiHealthService {
  constructor(apiKey = null) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || null;
    this.defaultModel = process.env.GEMINI_HEALTH_MODEL || 'gemini-3.6-flash';
  }

  obtenerApiKey(customKey = null) {
    return customKey || this.apiKey || process.env.GEMINI_API_KEY || null;
  }

  /**
   * Registra eventos de depuración en gemini_debug.log
   */
  logDebug(mensaje) {
    try {
      const logPath = path.join(process.cwd(), 'gemini_debug.log');
      fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] [GeminiHealth] ${mensaje}\n`);
    } catch (e) {}
  }

  /**
   * Optimiza una imagen para OCR/visión computacional manteniendo alta fidelidad de texto.
   * Utiliza formato WebP a resolución máxima de 1200x1200px para maximizar nitidez y velocidad.
   * @param {Buffer|string} input Buffer de imagen o ruta en disco.
   * @returns {Promise<{base64: string, mimeType: string}>}
   */
  async optimizarImagen(input) {
    try {
      const buffer = typeof input === 'string' ? fs.readFileSync(input) : input;

      const optimized = await sharp(buffer)
        .rotate() // Orientación EXIF automática
        .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();

      const base64 = optimized.toString('base64').replace(/^data:image\/[a-z0-9+.-]+;base64,/i, '').trim();

      return {
        base64,
        mimeType: 'image/webp'
      };
    } catch (err) {
      this.logDebug(`⚠️ Error optimizando imagen con Sharp (${err.message}). Usando buffer original.`);
      const buffer = typeof input === 'string' ? fs.readFileSync(input) : input;
      const base64 = buffer.toString('base64').replace(/^data:image\/[a-z0-9+.-]+;base64,/i, '').trim();
      return {
        base64,
        mimeType: 'image/jpeg'
      };
    }
  }

  /**
   * Limpia y parsea la respuesta JSON de Gemini asegurando que no queden fences de markdown.
   */
  sanitizarJSON(rawText) {
    if (!rawText) return null;
    let clean = rawText.trim();
    if (clean.startsWith('```json')) {
      clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    try {
      return JSON.parse(clean);
    } catch (e) {
      // Intentar extraer primer bloque {...}
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e2) {}
      }
      return null;
    }
  }

  /**
   * Consulta dinámicamente a Google AI Studio qué modelos están disponibles y soportan generateContent.
   */
  async resolverModelosDisponibles(key) {
    const cached = modelCache.get(key);
    if (cached && Date.now() - cached.timestamp < 15 * 60 * 1000) {
      return cached.models;
    }

    const fallbackPriorities = [
      this.defaultModel,
      'gemini-3.6-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash-002',
      'gemini-1.5-flash',
      'gemini-1.5-flash-latest'
    ].filter(Boolean);

    try {
      this.logDebug('Consultando ListModels en https://generativelanguage.googleapis.com/v1beta/models...');
      const listResp = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
        timeout: 10000
      });

      const allModels = listResp.data?.models || [];
      const contentModels = allModels
        .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''));

      this.logDebug(`ListModels devolvió ${contentModels.length} modelos compatibles: ${contentModels.slice(0, 8).join(', ')}`);

      if (contentModels.length > 0) {
        const sorted = [];
        // 1. Modelos flash preferentes
        const preferred = ['gemini-3.6-flash', 'gemini-2.0-flash', 'gemini-1.5-flash-002', 'gemini-1.5-flash', 'gemini-1.5-flash-latest'];
        for (const p of preferred) {
          if (contentModels.includes(p) && !sorted.includes(p)) sorted.push(p);
        }
        // 2. Cualquier otro flash disponible
        contentModels.filter(m => m.includes('flash') && !sorted.includes(m)).forEach(m => sorted.push(m));
        // 3. Pro y resto
        contentModels.filter(m => !sorted.includes(m)).forEach(m => sorted.push(m));

        modelCache.set(key, { timestamp: Date.now(), models: sorted });
        return sorted;
      }
    } catch (listErr) {
      this.logDebug(`⚠️ ListModels no accesible (${listErr.response?.status || listErr.message}). Usando lista de respaldo.`);
    }

    return fallbackPriorities;
  }

  /**
   * Envía las partes a la API de Gemini (Google Generative Language API) con backoff y fallback
   */
  async llamarGeminiVision(parts, customKey = null) {
    const key = this.obtenerApiKey(customKey);
    if (!key) {
      throw new Error('API Key de Gemini no configurada. Por favor introduce tu API Key de Google AI Studio en el campo inferior.');
    }

    this.logDebug(`Iniciando inferencia visual de salud. Key prefix: ${key.substring(0, 6)}...`);

    const modelsToTry = await this.resolverModelosDisponibles(key);
    this.logDebug(`Modelos a probar en orden: ${modelsToTry.join(', ')}`);

    const payload = {
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1
      }
    };

    let ultimoErrorMensaje = '';
    let ultimoStatus = null;

    for (const model of modelsToTry) {
      const modelClean = model.replace(/^models\//, '');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelClean}:generateContent?key=${key}`;
      const maxIntentos = 3;

      for (let intento = 1; intento <= maxIntentos; intento++) {
        try {
          this.logDebug(`Probando ${modelClean} (intento ${intento}/${maxIntentos})...`);
          const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 45000
          });

          const candidates = response.data?.candidates;
          if (candidates && candidates.length > 0) {
            const rawText = candidates[0].content?.parts?.[0]?.text;
            const parsed = this.sanitizarJSON(rawText);
            if (parsed) {
              this.logDebug(`✅ ¡Éxito en inferencia con modelo ${modelClean}!`);
              return parsed;
            }
          }
          throw new Error('La respuesta de Gemini no devolvió un JSON estructurado válido.');
        } catch (err) {
          const status = err.response?.status;
          ultimoStatus = status;
          const errData = err.response?.data?.error || {};
          const msg = errData.message || err.message;
          ultimoErrorMensaje = msg;

          this.logDebug(`❌ Falló modelo ${modelClean} (Status: ${status || 'sin-status'}): ${msg}`);

          // Si es 404 (modelo inexistente o no disponible en este endpoint), no reintentar este modelo
          if (status === 404) {
            this.logDebug(`Modelo ${modelClean} no encontrado (404). Pasando al siguiente modelo...`);
            break;
          }

          // Si es 400 (Bad Request), intentar fallback sin responseMimeType estricto
          if (status === 400 && intento === 1) {
            try {
              this.logDebug(`Reintentando ${modelClean} sin responseMimeType estricto...`);
              const payloadSinSchema = {
                contents: [{ parts }],
                generationConfig: { temperature: 0.1 }
              };
              const res2 = await axios.post(url, payloadSinSchema, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 45000
              });
              const rawText2 = res2.data?.candidates?.[0]?.content?.parts?.[0]?.text;
              const parsed2 = this.sanitizarJSON(rawText2);
              if (parsed2) {
                this.logDebug(`✅ ¡Éxito sin schema estricto con ${modelClean}!`);
                return parsed2;
              }
            } catch (retry400Err) {
              this.logDebug(`Reintento sin schema también falló: ${retry400Err.message}`);
            }
            break; // Pasar al siguiente modelo
          }

          // Manejo de Rate Limit (429) o Spikes temporales (503)
          if (status === 429 || status === 503) {
            // Verificar si es cuota diaria agotada (PerDay)
            const esCuotaDiaria = msg.includes('PerDay') || 
              JSON.stringify(errData.details || []).includes('PerDay') ||
              msg.includes('GenerateRequestsPerDay');

            if (esCuotaDiaria) {
              this.logDebug(`⚠️ Cuota diaria de ${modelClean} agotada. Probando otro modelo disponible...`);
              break; // Probar siguiente modelo de la lista
            }

            // Límite por segundo/minuto: calcular espera recomendada por Google
            let segundosEspera = 3;
            const details = errData.details || [];
            for (const d of details) {
              if (d.retryDelay) {
                const s = parseInt(String(d.retryDelay).replace('s', ''), 10);
                if (!isNaN(s) && s > 0) segundosEspera = s + 1;
              }
            }

            if (intento < maxIntentos) {
              this.logDebug(`⏳ Esperando ${segundosEspera}s por límite de tasa (intento ${intento}/${maxIntentos})...`);
              await new Promise(r => setTimeout(r, segundosEspera * 1000));
              continue; // Reintentar mismo modelo
            }
          }

          // Para cualquier otro error, pasar al siguiente modelo
          break;
        }
      }
    }

    // Si todos los modelos fallaron, generar mensaje pedagógico y transparente
    if (ultimoStatus === 429 || ultimoErrorMensaje.includes('Quota exceeded') || ultimoErrorMensaje.includes('RESOURCE_EXHAUSTED')) {
      throw new Error(`Has alcanzado el límite de cuota de Google Gemini (429 RESOURCE_EXHAUSTED). Por favor espera unos minutos o introduce una nueva API Key de Google AI Studio en el campo inferior.`);
    }

    if (ultimoStatus === 403 || ultimoErrorMensaje.includes('API_KEY_INVALID') || ultimoErrorMensaje.includes('API key not valid')) {
      throw new Error(`La API Key de Google AI Studio configurada no es válida. Introduce tu clave en el campo inferior.`);
    }

    throw new Error(`Error en inferencia de Gemini Vision: ${ultimoErrorMensaje}`);
  }

  /**
   * 🏃‍♂️ Analiza capturas de Xiaomi Mi Fitness
   * @param {Array<Buffer|string>} imageInputs Lista de hasta 4 capturas
   * @param {string} customKey
   */
  async procesarCapturasReloj(imageInputs, customKey = null) {
    const systemPrompt = `Eres un extractor de datos clínicos y deportivos de alta precisión. Analiza el conjunto de imágenes de la app Xiaomi Mi Fitness. Convierte los tiempos de ritmo (ej: 14'25") y duraciones a formato estándar SQL 'HH:MM:SS'. Devuelve única y exclusivamente este formato JSON:
{
  "user": string,
  "date": "YYYY-MM-DD HH:MM:SS",
  "distance_km": float,
  "duration_total": "HH:MM:SS",
  "calories_active": int,
  "calories_total": int,
  "steps": int,
  "pace_avg": "HH:MM:SS",
  "pace_max": "HH:MM:SS",
  "cadence_avg_steps_min": int,
  "cadence_max_bpm": int,
  "stride_avg_cm": int,
  "stride_max_cm": int,
  "vitality_score": int,
  "heart_rate": {
    "avg_lpm": int,
    "max_lpm": int,
    "zones": {
      "light": "HH:MM:SS",
      "intensive": "HH:MM:SS",
      "aerobic": "HH:MM:SS",
      "anaerobic": "HH:MM:SS",
      "vo2max": "HH:MM:SS"
    }
  },
  "splits": [
    {
      "km": int,
      "pace": "HH:MM:SS"
    }
  ]
}`;

    const parts = [];
    const inputs = Array.isArray(imageInputs) ? imageInputs : [imageInputs];

    for (let i = 0; i < inputs.length; i++) {
      const opt = await this.optimizarImagen(inputs[i]);
      parts.push({ text: `Captura #${i + 1} de la actividad:` });
      parts.push({
        inlineData: {
          mimeType: opt.mimeType,
          data: opt.base64
        }
      });
    }

    parts.push({ text: systemPrompt });

    return await this.llamarGeminiVision(parts, customKey);
  }

  /**
   * ⚖️ Analiza captura de pantalla de la Báscula Inteligente
   * @param {Array<Buffer|string>|Buffer|string} imageInputs 1 o varias capturas de la báscula
   * @param {string} customKey
   */
  async procesarCapturasBascula(imageInputs, customKey = null) {
    const systemPrompt = `Analiza la captura de pantalla de la aplicación de la báscula inteligente. Extrae todas las constantes corporales. Devuelve única y exclusivamente este formato JSON:
{
  "measurement_date": "YYYY-MM-DD HH:MM:SS",
  "weight_kg": float,
  "bmi": float,
  "body_fat_pct": float,
  "fat_mass_kg": float,
  "skeletal_muscle_pct": float,
  "muscle_pct": float,
  "muscle_mass_kg": float,
  "water_pct": float,
  "water_mass_kg": float,
  "visceral_fat": float,
  "bone_mass_kg": float,
  "bmr_kcal": int,
  "protein_pct": float,
  "obesity_degree_pct": float,
  "metabolic_age": int,
  "fat_free_weight_kg": float,
  "real_age": int,
  "height_cm": int
}`;

    const inputs = Array.isArray(imageInputs) ? imageInputs : [imageInputs];
    const parts = [];

    for (let i = 0; i < inputs.length; i++) {
      const opt = await this.optimizarImagen(inputs[i]);
      parts.push({ text: `Captura #${i + 1} de la báscula inteligente:` });
      parts.push({
        inlineData: {
          mimeType: opt.mimeType,
          data: opt.base64
        }
      });
    }

    parts.push({ text: systemPrompt });

    return await this.llamarGeminiVision(parts, customKey);
  }
}

module.exports = GeminiHealthService;
