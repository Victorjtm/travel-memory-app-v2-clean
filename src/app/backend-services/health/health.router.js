/**
 * ==============================================================================
 * ROUTER DE SALUD Y RENDIMIENTO FÍSICO (/api/health)
 * ==============================================================================
 */

const express = require('express');
const multer = require('multer');
const HealthController = require('./health.controller');

const router = express.Router();

// Configuración de multer en memoria (máximo 4 archivos de hasta 15MB cada uno)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 4
  }
});

// 🏃‍♂️ Subida de capturas de reloj Xiaomi
router.post('/upload-watch', upload.array('images', 4), HealthController.uploadWatch);

// ⚖️ Subida de capturas de báscula inteligente
router.post('/upload-scale', upload.array('images', 4), HealthController.uploadScale);

// 📋 Consultas
router.get('/activities', HealthController.getActivities);
router.get('/activities/:id', HealthController.getActivityDetails);
router.get('/by-activity/:activityId', HealthController.getActivityByActivityId);
router.get('/body-metrics', HealthController.getBodyMetrics);

// 🗑️ Eliminaciones
router.delete('/activities/:id', HealthController.deleteActivity);
router.delete('/body-metrics/:id', HealthController.deleteBodyMetric);

module.exports = router;
