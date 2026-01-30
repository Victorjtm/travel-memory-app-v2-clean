// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIGURACIÓN DE PERPLEXITY API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

module.exports = {

    /**
     * Obtiene la API Key de Perplexity
     * Prioridad: Variable de entorno > null
     * @returns {string|null} API Key o null si no está configurada
     */
    getApiKey: () => {
        return process.env.PERPLEXITY_API_KEY || null;
    },

    /**
     * Obtiene el modelo de IA a usar
     * @returns {string} Nombre del modelo
     */
    getModel: () => {
        return process.env.PERPLEXITY_MODEL || 'sonar-pro';
    },


    /**
     * URL base de la API de Perplexity
     * @returns {string} URL base
     */
    getBaseUrl: () => {
        return 'https://api.perplexity.ai';
    },

    /**
     * Máximo de tokens por respuesta
     * @returns {number} Límite de tokens
     */
    getMaxTokens: () => {
        return parseInt(process.env.PERPLEXITY_MAX_TOKENS) || 4000;
    },

    /**
     * Temperatura para la generación (0-1)
     * Mayor = más creativo, Menor = más preciso
     * @returns {number} Valor de temperatura
     */
    getTemperature: () => {
        return parseFloat(process.env.PERPLEXITY_TEMPERATURE) || 0.7;
    },

    /**
     * Top P para la generación (0-1)
     * @returns {number} Valor de top_p
     */
    getTopP: () => {
        return parseFloat(process.env.PERPLEXITY_TOP_P) || 0.9;
    },

    /**
     * Timeout para las peticiones HTTP (milisegundos)
     * @returns {number} Timeout en ms
     */
    getTimeout: () => {
        return parseInt(process.env.PERPLEXITY_TIMEOUT) || 60000;  // 60 segundos
    }
};
