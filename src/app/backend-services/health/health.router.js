/**
 * ==============================================================================
 * ROUTER DE SALUD Y RENDIMIENTO FÍSICO (/api/health)
 * ==============================================================================
 */

const express = require('express');
const multer = require('multer');
const HealthController = require('./health.controller');

const router = express.Router();

// Configuración de multer en memoria (máximo 24 archivos de hasta 30MB cada uno para soportar múltiples tramos)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024,
    files: 24
  }
});

// Middleware seguro para capturar errores de multer y evitar caídas de socket/ERR_CONNECTION_RESET
function safeUpload(req, res, next) {
  upload.array('images', 24)(req, res, (err) => {
    if (err) {
      console.error('❌ [HealthRouter] Error en multer upload:', err.message);
      return res.status(400).json({ error: `Error en la subida de capturas: ${err.message}` });
    }
    next();
  });
}

// 🏃‍♂️ Subida de capturas de reloj Xiaomi
router.post('/upload-watch', safeUpload, HealthController.uploadWatch);

// ⚖️ Subida de capturas de báscula inteligente
router.post('/upload-scale', safeUpload, HealthController.uploadScale);

// 📋 Consultas
router.get('/activities', HealthController.getActivities);
router.get('/activities/:id', HealthController.getActivityDetails);
router.get('/by-activity/:activityId', HealthController.getActivityByActivityId);
router.get('/body-metrics', HealthController.getBodyMetrics);

// 🔄 Sincronización de métricas del reloj con la actividad y el viaje
router.post('/sync-activity/:activityId', HealthController.syncActivityWithHealth);

// 🗑️ Eliminaciones
router.delete('/activities/:id', HealthController.deleteActivity);
router.delete('/body-metrics/:id', HealthController.deleteBodyMetric);

module.exports = router;
