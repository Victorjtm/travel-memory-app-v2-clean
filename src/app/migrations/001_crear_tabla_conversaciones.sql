-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRACIÓN 001: Crear tabla de conversaciones con IA
-- Fecha: 2026-01-30
-- Descripción: Tabla aislada para guardar historial de chat con Perplexity
--              NO tiene foreign keys a otras tablas (por diseño)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ============================================================================
-- TABLA PRINCIPAL: conversaciones_ia
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversaciones_ia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- ✨ Identificador de sesión (UUID generado en frontend)
  -- Permite múltiples conversaciones independientes
  sessionId TEXT NOT NULL,
  
  -- Rol del mensaje: 'user' (usuario), 'assistant' (IA), 'system' (contexto)
  rol TEXT CHECK(rol IN ('user', 'assistant', 'system')) NOT NULL,
  
  -- Contenido del mensaje
  mensaje TEXT NOT NULL,
  
  -- Timestamp automático
  timestamp TEXT DEFAULT (datetime('now')),
  
  -- ══════════════════════════════════════════════════════════════════════
  -- Metadatos de la respuesta de IA
  -- ══════════════════════════════════════════════════════════════════════
  tokens_usados INTEGER DEFAULT 0,
  modelo TEXT,
  tiempo_respuesta INTEGER,  -- Milisegundos
  
  -- ══════════════════════════════════════════════════════════════════════
  -- Datos estructurados (JSON del plan generado)
  -- Solo se llena cuando la IA termina de planificar
  -- ══════════════════════════════════════════════════════════════════════
  datos_estructurados TEXT,
  
  -- Tipo de interacción
  tipo_interaccion TEXT CHECK(tipo_interaccion IN ('planificacion', 'refinamiento', 'pregunta')) DEFAULT 'planificacion'
);

-- ============================================================================
-- ÍNDICES para mejorar performance
-- ============================================================================

-- Búsqueda rápida por sesión
CREATE INDEX IF NOT EXISTS idx_conversaciones_session 
ON conversaciones_ia(sessionId);

-- Búsqueda por timestamp (conversaciones recientes)
CREATE INDEX IF NOT EXISTS idx_conversaciones_timestamp 
ON conversaciones_ia(timestamp);

-- Búsqueda por tipo de interacción
CREATE INDEX IF NOT EXISTS idx_conversaciones_tipo 
ON conversaciones_ia(tipo_interaccion);

-- ============================================================================
-- VISTA: Resumen de conversaciones
-- ============================================================================
CREATE VIEW IF NOT EXISTS v_conversaciones_recientes AS
SELECT 
  sessionId,
  COUNT(*) as num_mensajes,
  MIN(timestamp) as inicio,
  MAX(timestamp) as ultimo_mensaje,
  SUM(CASE WHEN rol = 'user' THEN 1 ELSE 0 END) as mensajes_usuario,
  SUM(CASE WHEN rol = 'assistant' THEN 1 ELSE 0 END) as respuestas_ia,
  SUM(tokens_usados) as tokens_totales,
  MAX(CASE WHEN datos_estructurados IS NOT NULL THEN 1 ELSE 0 END) as tiene_plan
FROM conversaciones_ia
GROUP BY sessionId
ORDER BY ultimo_mensaje DESC;

-- ============================================================================
-- ✅ FIN DE LA MIGRACIÓN
-- ============================================================================
