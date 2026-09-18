/**
 * ==============================================================================
 * CONTROLADOR DE SALUD Y RENDIMIENTO FÍSICO (100% AISLADO)
 * ==============================================================================
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const GeminiHealthService = require('./gemini-health.service');

const dbPath = path.resolve(__dirname, '../../../../viajes.db');
const geminiService = new GeminiHealthService();

let _sharedDb = null;
function getDbConnection() {
  if (!_sharedDb) {
    _sharedDb = new sqlite3.Database(dbPath, (err) => {
      if (err) console.error('❌ Error conectando a viajes.db en HealthController:', err.message);
      else console.log('✅ HealthController conectado a viajes.db');
    });
  }
  return _sharedDb;
}

class HealthController {
  /**
   * 🏃‍♂️ Procesa capturas de reloj Xiaomi y guarda actividad + splits
   */
  static async uploadWatch(req, res) {
    const files = req.files;
    const { itinerary_id, activity_id, custom_api_key } = req.body;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'Debes enviar al menos una captura de pantalla del reloj (máx 4).' });
    }

    if (!itinerary_id) {
      return res.status(400).json({ error: 'El campo itinerary_id es obligatorio.' });
    }

    try {
      console.log(`🏃‍♂️ [HealthController] Procesando ${files.length} capturas de reloj con Gemini...`);
      const buffers = files.map(f => f.buffer);
      const data = await geminiService.procesarCapturasReloj(buffers, custom_api_key);

      if (!data) {
        throw new Error('No se pudo extraer información válida de las capturas.');
      }

      console.log('✅ [HealthController] Datos extraídos de Xiaomi Mi Fitness:', {
        user: data.user,
        date: data.date,
        distance_km: data.distance_km,
        steps: data.steps,
        splits: data.splits?.length
      });

      const db = getDbConnection();

      // Transacción en SQLite
      db.serialize(() => {
        const queryActivity = `
          INSERT INTO travel_health_activity (
            itinerary_id, activity_id, date_walk, user_name, distance_km, duration_total,
            calories_active, calories_total, steps, pace_avg, pace_max,
            cadence_avg, cadence_max, stride_avg_cm, stride_max_cm,
            hr_avg, hr_max, zone_light, zone_intensive, zone_aerobic, zone_anaerobic, zone_vo2max,
            vitality_score
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const paramsActivity = [
          itinerary_id,
          activity_id || null,
          data.date || new Date().toISOString().slice(0, 19).replace('T', ' '),
          data.user || 'Usuario',
          data.distance_km || 0,
          data.duration_total || '00:00:00',
          data.calories_active || 0,
          data.calories_total || 0,
          data.steps || 0,
          data.pace_avg || null,
          data.pace_max || null,
          data.cadence_avg_steps_min || null,
          data.cadence_max_bpm || null,
          data.stride_avg_cm || null,
          data.stride_max_cm || null,
          data.heart_rate?.avg_lpm || null,
          data.heart_rate?.max_lpm || null,
          data.heart_rate?.zones?.light || null,
          data.heart_rate?.zones?.intensive || null,
          data.heart_rate?.zones?.aerobic || null,
          data.heart_rate?.zones?.anaerobic || null,
          data.heart_rate?.zones?.vo2max || null,
          data.vitality_score || null
        ];

        db.run(queryActivity, paramsActivity, function (err) {
          if (err) {
            console.error('❌ Error guardando travel_health_activity:', err.message);
            return res.status(500).json({ error: 'Error al persistir la actividad en base de datos: ' + err.message });
          }

          const healthActivityId = this.lastID;
          console.log(`✅ Actividad de salud insertada con ID: ${healthActivityId}`);

          const splits = data.splits || [];
          if (splits.length === 0) {
            return res.status(201).json({
              message: 'Actividad de reloj registrada correctamente (sin splits).',
              health_activity_id: healthActivityId,
              data
            });
          }

          const querySplit = `INSERT INTO travel_health_splits (health_activity_id, km_number, pace) VALUES (?, ?, ?)`;
          let completed = 0;
          let hasSplitError = false;

          splits.forEach(s => {
            db.run(querySplit, [healthActivityId, s.km, s.pace], (splitErr) => {
              completed++;
              if (splitErr) hasSplitError = true;

              if (completed === splits.length) {
                if (hasSplitError) {
                  console.warn('⚠️ Hubo advertencias al insertar algunos splits');
                }
                return res.status(201).json({
                  message: 'Actividad de reloj y desglose de ritmos registrados con éxito.',
                  health_activity_id: healthActivityId,
                  total_splits: splits.length,
                  data
                });
              }
            });
          });
        });
      });
    } catch (error) {
      console.error('❌ [HealthController] Error en uploadWatch:', error.message);
      res.status(500).json({ error: error.message || 'Error procesando capturas del reloj' });
    }
  }

  /**
   * ⚖️ Procesa captura de Báscula y guarda métricas corporales
   */
  static async uploadScale(req, res) {
    const files = req.files;
    const { user_id, custom_api_key } = req.body;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'Debes enviar al menos una captura de pantalla de la báscula.' });
    }

    const userId = Number(user_id) || 1;

    try {
      console.log(`⚖️ [HealthController] Procesando ${files.length} capturas de báscula con Gemini...`);
      const buffers = files.map(f => f.buffer);
      const data = await geminiService.procesarCapturasBascula(buffers, custom_api_key);

      if (!data) {
        throw new Error('No se pudo extraer información válida de la báscula.');
      }

      console.log('✅ [HealthController] Métricas de báscula extraídas:', {
        date: data.measurement_date,
        weight: data.weight_kg,
        bmi: data.bmi,
        body_fat: data.body_fat_pct
      });

      const db = getDbConnection();
      const queryScale = `
        INSERT INTO user_body_metrics (
          user_id, measurement_date, weight_kg, bmi, body_fat_pct, fat_mass_kg,
          skeletal_muscle_pct, muscle_pct, muscle_mass_kg, water_pct, water_mass_kg,
          visceral_fat, bone_mass_kg, bmr_kcal, protein_pct, obesity_degree_pct,
          metabolic_age, fat_free_weight_kg, real_age, height_cm
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const paramsScale = [
        userId,
        data.measurement_date || new Date().toISOString().slice(0, 19).replace('T', ' '),
        data.weight_kg || null,
        data.bmi || null,
        data.body_fat_pct || null,
        data.fat_mass_kg || null,
        data.skeletal_muscle_pct || null,
        data.muscle_pct || null,
        data.muscle_mass_kg || null,
        data.water_pct || null,
        data.water_mass_kg || null,
        data.visceral_fat || null,
        data.bone_mass_kg || null,
        data.bmr_kcal || null,
        data.protein_pct || null,
        data.obesity_degree_pct || null,
        data.metabolic_age || null,
        data.fat_free_weight_kg || null,
        data.real_age || null,
        data.height_cm || null
      ];

      db.run(queryScale, paramsScale, function (err) {
        if (err) {
          console.error('❌ Error guardando user_body_metrics:', err.message);
          return res.status(500).json({ error: 'Error al persistir métricas corporales: ' + err.message });
        }

        console.log(`✅ Registro de báscula insertado con ID: ${this.lastID}`);
        return res.status(201).json({
          message: 'Métricas corporales de la báscula registradas con éxito.',
          body_metric_id: this.lastID,
          data
        });
      });
    } catch (error) {
      console.error('❌ [HealthController] Error en uploadScale:', error.message);
      res.status(500).json({ error: error.message || 'Error procesando capturas de la báscula' });
    }
  }

  /**
   * 📋 Listado de actividades de salud (opcionalmente filtradas por itinerario)
   */
  static async getActivities(req, res) {
    const { itinerary_id } = req.query;
    const db = getDbConnection();

    let query = `
      SELECT h.*, v.nombre as viaje_nombre, a.nombre as actividad_nombre
      FROM travel_health_activity h
      LEFT JOIN viajes v ON h.itinerary_id = v.id
      LEFT JOIN actividades a ON h.activity_id = a.id
    `;
    const params = [];

    if (itinerary_id) {
      query += ` WHERE h.itinerary_id = ?`;
      params.push(itinerary_id);
    }

    query += ` ORDER BY h.date_walk DESC`;

    db.all(query, params, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows || []);
    });
  }

  /**
   * 🔍 Detalle de una actividad con sus splits
   */
  
  /**
   * 🩺 Obtiene la actividad de salud asociada directamente a un activity_id específico (con sus splits)
   */
  static async getActivityByActivityId(req, res) {
    const { activityId } = req.params;
    const db = getDbConnection();

    const queryAct = `
      SELECT h.*, v.nombre as viaje_nombre, a.nombre as actividad_nombre, a.distanciaKm as actividad_distancia_gps
      FROM travel_health_activity h
      LEFT JOIN viajes v ON h.itinerary_id = v.id
      LEFT JOIN actividades a ON h.activity_id = a.id
      WHERE h.activity_id = ?
      ORDER BY h.id DESC LIMIT 1
    `;

    db.get(queryAct, [activityId], (err, activity) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!activity) {
        return res.json({ hasData: false, data: null });
      }

      const querySplits = `SELECT * FROM travel_health_splits WHERE health_activity_id = ? ORDER BY km_number ASC`;
      db.all(querySplits, [activity.id], (splitErr, splits) => {
        if (splitErr) {
          return res.status(500).json({ error: splitErr.message });
        }
        activity.splits = splits || [];
        res.json({ hasData: true, data: activity });
      });
    });
  }

  static async getActivityDetails(req, res) {
    const { id } = req.params;
    const db = getDbConnection();

    const queryAct = `
      SELECT h.*, v.nombre as viaje_nombre, a.nombre as actividad_nombre
      FROM travel_health_activity h
      LEFT JOIN viajes v ON h.itinerary_id = v.id
      LEFT JOIN actividades a ON h.activity_id = a.id
      WHERE h.id = ?
    `;

    db.get(queryAct, [id], (err, activity) => {
      if (err || !activity) {
        return res.status(404).json({ error: 'Actividad de salud no encontrada.' });
      }

      const querySplits = `SELECT * FROM travel_health_splits WHERE health_activity_id = ? ORDER BY km_number ASC`;
      db.all(querySplits, [id], (splitErr, splits) => {
        if (splitErr) {
          return res.status(500).json({ error: splitErr.message });
        }
        activity.splits = splits || [];
        res.json(activity);
      });
    });
  }

  /**
   * 📊 Listado de métricas corporales para gráficos
   */
  static async getBodyMetrics(req, res) {
    const { user_id } = req.query;
    const db = getDbConnection();

    let query = `SELECT * FROM user_body_metrics`;
    const params = [];

    if (user_id) {
      query += ` WHERE user_id = ?`;
      params.push(user_id);
    }

    query += ` ORDER BY measurement_date ASC`;

    db.all(query, params, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows || []);
    });
  }

  /**
   * 🗑️ Eliminar actividad de salud
   */
  static async deleteActivity(req, res) {
    const { id } = req.params;
    const db = getDbConnection();
    db.run(`DELETE FROM travel_health_activity WHERE id = ?`, [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Actividad eliminada con éxito', deletedId: id });
    });
  }

  /**
   * 🗑️ Eliminar pesaje de báscula
   */
  static async deleteBodyMetric(req, res) {
    const { id } = req.params;
    const db = getDbConnection();
    db.run(`DELETE FROM user_body_metrics WHERE id = ?`, [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Métrica corporal eliminada con éxito', deletedId: id });
    });
  }
}

module.exports = HealthController;
