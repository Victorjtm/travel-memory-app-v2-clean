// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MODELOS TYPESCRIPT PARA CONVERSACIONES CON IA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


/**
 * Actividad dentro de un itinerario
 */
export interface ActividadIA {
    nombre: string;
    descripcion?: string;
    hora_inicio: string;  // HH:MM
    hora_fin: string;     // HH:MM
    tipo_actividad?: string;
    ubicacion?: string;
    notas?: string;
}


/**
 * Itinerario de un día específico
 */
export interface ItinerarioIA {
    fecha: string;  // YYYY-MM-DD
    descripcion?: string;
    tipo_viaje?: 'costa' | 'naturaleza' | 'rural' | 'urbana' | 'cultural' | 'trabajo';
    actividades: ActividadIA[];
}


/**
 * Información general del viaje
 */
export interface ViajeIA {
    nombre: string;
    destino: string;
    fecha_inicio: string;  // YYYY-MM-DD
    fecha_fin: string;     // YYYY-MM-DD
    descripcion?: string;
}


/**
 * Plan de viaje estructurado generado por la IA
 */
export interface PlanEstructurado {
    plan_completo: boolean;
    viaje: ViajeIA;
    itinerarios: ItinerarioIA[];
}


/**
 * Representa un mensaje individual en la conversación
 */
export interface MensajeIA {
    id?: number;
    sessionId: string;
    rol: 'user' | 'assistant' | 'system';
    mensaje: string;
    timestamp?: string;
    tokens_usados?: number;
    modelo?: string;
    tiempo_respuesta?: number;
    datos_estructurados?: PlanEstructurado | null;
    tipo_interaccion?: 'planificacion' | 'refinamiento' | 'pregunta';
}


/**
 * Respuesta completa del endpoint /api/ia/chat
 */
export interface RespuestaChat {
    id: number;
    mensaje: string;
    tokens: number;
    tiempo_ms: number;
    plan_detectado: boolean;
    datos_estructurados: PlanEstructurado | null;
    citations?: any[];
    // ✨ NUEVO: Información de límites de seguridad
    limite_tokens?: {
        consumidos: number;
        maximo: number;
        restantes: number;
        porcentaje_usado: number;
    };
}


/**
 * Historial completo de una sesión
 */
export interface HistorialSesion {
    sessionId: string;
    total: number;
    mensajes: MensajeIA[];
}


/**
 * Resumen de sesiones activas
 */
export interface ResumenSesion {
    sessionId: string;
    num_mensajes: number;
    inicio: string;
    ultimo_mensaje: string;
    mensajes_usuario: number;
    respuestas_ia: number;
    tokens_totales: number;
    tiene_plan: number;  // 0 o 1
}
