/**
 * ==============================================================================
 * SERVICIO DE EXTRACCIÓN DE SALUD Y RENDIMIENTO FÍSICO CON GOOGLE AI STUDIO (GEMINI)
 * ==============================================================================
 * Módulo 100% aislado para procesamiento visual de capturas de Xiaomi Mi Fitness
 * y Báscula Inteligente mediante Gemini 1.5 Pro / Flash con retorno estricto JSON.
 */

const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs');

class GeminiHealthService {
  constructor(apiKey = null) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || null;
    this.model = process.env.GEMINI_HEALTH_MODEL || 'gemini-3.6-flash';
  }

  obtenerApiKey(customKey = null) {
    return customKey || this.apiKey || process.env.GEMINI_API_KEY || null;
  }

  /**
   * Optimiza una imagen para OCR/visión computacional manteniendo alta fidelidad de texto.
   * @param {Buffer|string} input Buffer de imagen o ruta en disco.
   * @returns {Promise<{base64: string, mimeType: string}>}
   */
  async optimizarImagen(input) {
    try {
      let buffer = typeof input === 'string' ? fs.readFileSync(input) : input;

      const optimized = await sharp(buffer)
        .rotate() // orientacion EXIF
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .toFormat('jpeg', { quality: 85 })
        .toBuffer();

      return {
        base64: optimized.toString('base64'),
        mimeType: 'image/jpeg'
      };
    } catch (err) {
      console.warn('⚠️ Error optimizando imagen para salud con Sharp, usando buffer directo:', err.message);
      const buffer = typeof input === 'string' ? fs.readFileSync(input) : input;
      return {
        base64: buffer.toString('base64'),
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
    return JSON.parse(clean);
  }

  /**
   * Envía las partes a la API de Gemini (Google Generative Language API)
   */
  async llamarGeminiVision(parts, customKey = null) {
    const key = this.obtenerApiKey(customKey);
    if (!key) {
      throw new Error('API Key de Gemini no configurada. Define GEMINI_API_KEY en .env o pásala en la petición.');
    }

    const payload = {
      contents: [
        {
          parts: parts
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1
      }
    };

    const modelsToTry = Array.from(new Set([
      this.model,
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-flash-latest',
      'gemini-1.5-pro',
      'gemini-3.6-flash'
    ])).filter(Boolean);

    let lastError = null;

    for (const model of modelsToTry) {
      try {
        const modelClean = model.replace(/^models\//, '');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelClean}:generateContent?key=${key}`;
        const response = await axios.post(url, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 45000
        });

        const candidates = response.data?.candidates;
        if (candidates && candidates.length > 0) {
          const rawText = candidates[0].content?.parts?.[0]?.text;
          const parsed = this.sanitizarJSON(rawText);
          if (parsed) return parsed;
        }
      } catch (err) {
        lastError = err;
        console.warn(`⚠️ [GeminiHealth] Falló modelo ${model}: ${err.response?.data?.error?.message || err.message}. Intentando fallback...`);
      }
    }

    // Si los modelos por defecto fallaron, consultar dinámicamente a ModelService.ListModels
    try {
      console.log('🔍 [GeminiHealth] Consultando modelos disponibles en Google AI Studio...');
      const listResp = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      const availableModels = listResp.data?.models || [];
      const flashOrVisionModel = availableModels.find(m => 
        m.supportedGenerationMethods?.includes('generateContent') && 
        (m.name.includes('flash') || m.name.includes('pro'))
      ) || availableModels.find(m => m.supportedGenerationMethods?.includes('generateContent'));

      if (flashOrVisionModel) {
        const dynamicModel = flashOrVisionModel.name.replace(/^models\//, '');
        console.log(`🤖 [GeminiHealth] Reintentando con modelo detectado: ${dynamicModel}`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${dynamicModel}:generateContent?key=${key}`;
        const response = await axios.post(url, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 45000
        });

        const candidates = response.data?.candidates;
        if (candidates && candidates.length > 0) {
          const rawText = candidates[0].content?.parts?.[0]?.text;
          const parsed = this.sanitizarJSON(rawText);
          if (parsed) return parsed;
        }
      }
    } catch (listErr) {
      console.warn('⚠️ [GeminiHealth] Error listando modelos disponibles:', listErr.message);
    }

    throw new Error(`Error en inferencia de Gemini Vision: ${lastError?.response?.data?.error?.message || lastError?.message}`);
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

    const parts = [{ text: systemPrompt }];

    for (const input of imageInputs) {
      const opt = await this.optimizarImagen(input);
      parts.push({
        inlineData: {
          mimeType: opt.mimeType,
          data: opt.base64
        }
      });
    }

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
    const parts = [{ text: systemPrompt }];

    for (const input of inputs) {
      const opt = await this.optimizarImagen(input);
      parts.push({
        inlineData: {
          mimeType: opt.mimeType,
          data: opt.base64
        }
      });
    }

    return await this.llamarGeminiVision(parts, customKey);
  }
}

module.exports = GeminiHealthService;
