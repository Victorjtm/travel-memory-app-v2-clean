// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CLIENTE HTTP PARA PERPLEXITY API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const axios = require('axios');
const perplexityConfig = require('../config/perplexity.config');

class PerplexityClient {

    constructor(apiKey = null) {
        this.apiKey = apiKey || perplexityConfig.getApiKey();
        this.baseUrl = perplexityConfig.getBaseUrl();
        this.model = perplexityConfig.getModel();
        this.maxTokens = perplexityConfig.getMaxTokens();
        this.temperature = perplexityConfig.getTemperature();
        this.topP = perplexityConfig.getTopP();
        this.timeout = perplexityConfig.getTimeout();

        if (!this.apiKey) {
            console.warn('⚠️  No hay API Key de Perplexity configurada');
            console.warn('   Configura PERPLEXITY_API_KEY en .env o pasa apiKey al constructor');
        }
    }

    /**
     * Envía un mensaje a Perplexity con contexto de historial
     * @param {Array} messages - Array de {role, content}
     * @param {String} customApiKey - API Key opcional del usuario
     * @returns {Promise<Object>} - {contenido, tokens, tiempo_ms, modelo, citations}
     */
    async chat(messages, customApiKey = null) {
        const startTime = Date.now();
        const apiKey = customApiKey || this.apiKey;

        if (!apiKey) {
            throw new Error('API Key de Perplexity no configurada');
        }

        try {
            console.log(`🤖 Llamando a Perplexity (${messages.length} mensajes en contexto)`);
            console.log(`📊 Modelo: ${this.model}`);

            const response = await axios.post(
                `${this.baseUrl}/chat/completions`,
                {
                    model: this.model,
                    messages: messages,
                    max_tokens: this.maxTokens,
                    temperature: this.temperature,
                    top_p: this.topP,
                    return_citations: true,
                    return_images: false,
                    return_related_questions: false,
                    search_recency_filter: "month",
                    stream: false
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: this.timeout
                }
            );

            const endTime = Date.now();
            const tiempo_ms = endTime - startTime;

            const resultado = {
                contenido: response.data.choices[0].message.content,
                tokens: response.data.usage?.total_tokens || 0,
                tiempo_ms: tiempo_ms,
                modelo: response.data.model,
                citations: response.data.citations || []
            };

            console.log(`✅ Respuesta recibida (${resultado.tokens} tokens, ${tiempo_ms}ms)`);

            return resultado;

        } catch (error) {
            const tiempo_ms = Date.now() - startTime;

            console.error('❌ Error llamando a Perplexity:', error.response?.data || error.message);

            // Extraer mensaje de error legible
            let errorMessage = 'Error desconocido al comunicarse con Perplexity';

            if (error.response) {
                // Error de la API de Perplexity
                errorMessage = error.response.data?.error?.message ||
                    error.response.data?.message ||
                    `Error HTTP ${error.response.status}`;
            } else if (error.code === 'ECONNABORTED') {
                errorMessage = 'Timeout: La IA tardó demasiado en responder';
            } else if (error.message) {
                errorMessage = error.message;
            }

            throw {
                message: errorMessage,
                status: error.response?.status || 500,
                tiempo_ms: tiempo_ms
            };
        }
    }

    /**
     * Validar que la API Key funciona
     * @param {String} apiKey - API Key a validar
     * @returns {Promise<Object>} - {valida: boolean, error?: string}
     */
    async validarApiKey(apiKey) {
        try {
            console.log('🔑 Validando API Key de Perplexity...');

            await this.chat([
                { role: 'user', content: 'Test' }
            ], apiKey);

            console.log('✅ API Key válida');
            return { valida: true };

        } catch (error) {
            console.error('❌ API Key inválida:', error.message);
            return {
                valida: false,
                error: error.message
            };
        }
    }
}

module.exports = PerplexityClient;
