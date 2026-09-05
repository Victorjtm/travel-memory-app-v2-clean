// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SERVICIO DE PLANIFICACIÓN DE VIAJES FUTUROS CON GEMINI 3.6 FLASH
// Google AI Studio - Gratuito y Optimizado
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const axios = require('axios');
const fs = require('fs');
const path = require('path');

class PlanificadorViajesIAService {

  constructor(apiKey = null) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || null;
    this.model = 'gemini-3.6-flash';
    this.timeout = 45000; // 45 segundos
  }

  /**
   * Obtiene la clave efectiva
   */
  obtenerApiKey(customApiKey = null) {
    return customApiKey || this.apiKey || process.env.GEMINI_API_KEY || null;
  }

  /**
   * Registra mensajes de diagnóstico en gemini_debug.log
   */
  registrarLog(mensaje, detalles = '') {
    try {
      const logPath = path.join(process.cwd(), 'gemini_debug.log');
      const entrada = `\n[${new Date().toISOString()}] [PlanificadorViajesIA - ${this.model}] ${mensaje}\n${detalles ? (typeof detalles === 'object' ? JSON.stringify(detalles, null, 2) : detalles) + '\n' : ''}`;
      fs.appendFileSync(logPath, entrada);
    } catch (e) {
      console.warn('No se pudo escribir en gemini_debug.log:', e.message);
    }
  }

  /**
   * Procesa una conversación de planificación de viaje con Gemini 3.6 Flash
   * @param {Array} historial - Array de mensajes previos { rol, mensaje }
   * @param {String} nuevoMensaje - Mensaje actual del usuario
   * @param {String} customApiKey - API Key opcional de Google AI Studio
   * @returns {Promise<Object>} { mensaje, plan_completo, datos_estructurados, tokens, tiempo_ms, modelo }
   */
  async chat(historial = [], nuevoMensaje = '', customApiKey = null) {
    const startTime = Date.now();
    const apiKey = this.obtenerApiKey(customApiKey);

    if (!apiKey) {
      throw new Error('No se ha configurado la API Key de Gemini (Google AI Studio). Por favor configúrala en la interfaz.');
    }

    const systemPrompt = `Eres un asistente experto en planificación y organización de viajes futuros.
Tu misión es conversar con el viajero para crear un itinerario estructurado, completo y realista.
Debes tomar en cuenta siempre los datos clave: Destino, número de días o fechas previstas, presupuesto estimado y gustos o intereses personales (naturaleza, gastronomía, museos, relax, etc.).

REGLAS OBLIGATORIAS:
1. Responde SIEMPRE con un objeto JSON válido (sin formato markdown alrededor) con la siguiente estructura:
{
  "mensaje": "Texto conversacional empático y amigable explicando el plan propuesto o haciendo preguntas si faltan datos esenciales.",
  "plan_completo": boolean, // TRUE solo si ya se conocen destino y duración y se ha creado un itinerario día por día con actividades. FALSE si aún faltan datos o es solo una charla previa.
  "viaje": {
    "nombre": "Nombre atractivo del viaje (ej: Escapada Cultural a Roma)",
    "destino": "Destino principal (ej: Roma, Italia)",
    "fecha_inicio": "YYYY-MM-DD",
    "fecha_fin": "YYYY-MM-DD",
    "descripcion": "Descripción detallada del viaje y estilo"
  },
  "itinerarios": [
    {
      "fecha": "YYYY-MM-DD",
      "descripcion": "Resumen de lo que se hace este día",
      "tipo_viaje": "urbana", // Opciones: "costa" | "naturaleza" | "rural" | "urbana" | "cultural" | "trabajo"
      "actividades": [
        {
          "nombre": "Nombre claro de la actividad",
          "descripcion": "Descripción concisa y recomendaciones",
          "hora_inicio": "HH:MM",
          "hora_fin": "HH:MM",
          "tipo_actividad": "turismo", // Opciones: "turismo" | "comida" | "alojamiento" | "ocio" | "compras" | "transporte"
          "ubicacion": "Nombre del lugar, monumento o zona"
        }
      ]
    }
  ]
}

2. Si faltan datos clave (por ejemplo el usuario solo dice "Hola" o una frase genérica), pon "plan_completo": false, responde amablemente en "mensaje" pidiendo los datos necesarios y puedes dejar "viaje": null y "itinerarios": [].
3. Cuando "plan_completo" sea true:
   - "viaje" no puede ser nulo y debe tener fechas válidas en formato YYYY-MM-DD. Si el usuario no especificó fechas reales, usa fechas futuras coherentes calculadas a partir de la fecha actual.
   - "itinerarios" debe tener exactamente tantos elementos como días tenga el viaje.
   - Cada día debe tener entre 2 y 6 actividades con horas realistas ordenadas cronológicamente (HH:MM).
   - Los tipos de viaje válidos son: costa, naturaleza, rural, urbana, cultural, trabajo.
   - Los tipos de actividad válidos son: turismo, comida, alojamiento, ocio, compras, transporte.`;

    // Formatear contenidos respetando el flujo de Gemini (rol 'user' y 'model')
    const contents = [];

    // Añadir historial previo si existe
    if (Array.isArray(historial) && historial.length > 0) {
      for (const m of historial) {
        if (!m.mensaje || !m.mensaje.trim()) continue;
        const role = m.rol === 'user' ? 'user' : 'model';
        contents.push({
          role: role,
          parts: [{ text: m.mensaje }]
        });
      }
    }

    // Asegurar que el último mensaje sea el nuevo mensaje del usuario
    if (nuevoMensaje && nuevoMensaje.trim()) {
      contents.push({
        role: 'user',
        parts: [{ text: nuevoMensaje.trim() }]
      });
    }

    // Si contents está vacío por alguna razón, agregar uno de inicio
    if (contents.length === 0) {
      contents.push({
        role: 'user',
        parts: [{ text: 'Hola, ayúdame a planificar mi próximo viaje.' }]
      });
    }

    // Configuración de la llamada a Gemini
    const payload = {
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: contents,
      generationConfig: {
        temperature: 0.4,
        responseMimeType: 'application/json'
      }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${apiKey}`;

    console.log(`🤖 [PlanificadorViajesIA] Llamando a Gemini 3.6 Flash con ${contents.length} turnos de conversación`);

    try {
      const res = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: this.timeout
      });

      const tiempo_ms = Date.now() - startTime;
      const rawText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
      const tokensUsados = res.data?.usageMetadata?.totalTokenCount || 0;

      let parsedData;
      try {
        parsedData = JSON.parse(rawText);
      } catch (parseErr) {
        // En caso de que el modelo haya envuelto en backticks a pesar de responseMimeType
        const match = rawText.match(/```json\s*([\s\S]*?)\s*```/) || rawText.match(/```\s*([\s\S]*?)\s*```/);
        if (match) {
          parsedData = JSON.parse(match[1]);
        } else {
          throw parseErr;
        }
      }

      console.log(`✅ [PlanificadorViajesIA] Respuesta generada con éxito (${tokensUsados} tokens, ${tiempo_ms}ms)`);

      const planCompleto = !!(parsedData && parsedData.plan_completo === true && parsedData.viaje && parsedData.itinerarios?.length > 0);

      const resultado = {
        mensaje: parsedData.mensaje || 'He preparado el plan de viaje para ti.',
        plan_detectado: planCompleto,
        datos_estructurados: planCompleto ? {
          plan_completo: true,
          viaje: parsedData.viaje,
          itinerarios: parsedData.itinerarios
        } : (parsedData.viaje ? parsedData : null),
        tokens: tokensUsados,
        tiempo_ms: tiempo_ms,
        modelo: this.model
      };

      return resultado;

    } catch (error) {
      const tiempo_ms = Date.now() - startTime;
      const errorData = error.response?.data || error.message;
      const errorStr = typeof errorData === 'object' ? JSON.stringify(errorData, null, 2) : errorData;

      console.error(`❌ [PlanificadorViajesIA] Error llamando a Gemini (${this.model}):`, errorStr);
      this.registrarLog(`Error en chat`, errorStr);

      let mensajeUsuario = 'Error al comunicarse con el motor de Gemini de Google AI Studio.';
      if (error.response?.status === 400 && errorStr.includes('API_KEY_INVALID')) {
        mensajeUsuario = 'La API Key de Google AI Studio no es válida. Por favor, revísala.';
      } else if (error.code === 'ECONNABORTED') {
        mensajeUsuario = 'Tiempo de espera agotado al conectar con Gemini. Inténtalo de nuevo.';
      } else if (error.response?.data?.error?.message) {
        mensajeUsuario = error.response.data.error.message;
      }

      throw {
        message: mensajeUsuario,
        status: error.response?.status || 500,
        tiempo_ms: tiempo_ms
      };
    }
  }

  /**
   * Valida si una API Key de Google AI Studio es válida
   */
  async validarApiKey(apiKey) {
    if (!apiKey || !apiKey.trim()) {
      return { valida: false, error: 'API Key no proporcionada' };
    }

    const key = apiKey.trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${key}`;

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hola' }]
        }
      ],
      generationConfig: {
        maxOutputTokens: 5
      }
    };

    try {
      console.log(`🔑 [PlanificadorViajesIA] Validando clave Gemini con modelo ${this.model}...`);
      await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });

      console.log('✅ [PlanificadorViajesIA] API Key válida');
      return { valida: true };
    } catch (error) {
      const errorData = error.response?.data || error.message;
      const errorStr = typeof errorData === 'object' ? JSON.stringify(errorData) : errorData;
      console.warn('❌ [PlanificadorViajesIA] API Key inválida:', errorStr);

      let msg = 'API Key inválida o sin acceso a Google AI Studio';
      if (error.response?.data?.error?.message) {
        msg = error.response.data.error.message;
      }

      return {
        valida: false,
        error: msg
      };
    }
  }
}

module.exports = PlanificadorViajesIAService;
