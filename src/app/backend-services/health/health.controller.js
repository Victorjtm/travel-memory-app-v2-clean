/**
 * ==============================================================================
 * CONTROLADOR DE SALUD Y RENDIMIENTO FÍSICO (100% AISLADO)
 * ==============================================================================
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const GeminiHealthService = require('./gemini-health.service');

const dbPath = path.resolve(__dirname, '../../../../viajes.db');
const geminiService = new GeminiHealthService();

let _sharedDb = null;
function getDbConnection() {
  if (!_sharedDb) {
    _sharedDb = new sqlite3.Database(dbPath, (err) => {
      if (err) console.error('❌ Error conectando a viajes.db en HealthController:', err.message);
      else {
        console.log('✅ HealthController conectado a viajes.db');
        _sharedDb.run("ALTER TABLE travel_health_activity ADD COLUMN tramos_data TEXT", () => {});
        _sharedDb.run("ALTER TABLE travel_health_splits ADD COLUMN tramo INTEGER DEFAULT 1", () => {});
      }
    });
  }
  return _sharedDb;
}

class HealthController {
  /**
   * 🔍 Detecta si el archivo GPX del reloj (o de la actividad) contiene múltiples tramos (<trkseg> o <trk>)
   */
  static detectWatchSegments(activityId) {
    return new Promise((resolve) => {
      if (!activityId) return resolve({ count: 1, segments: [{ index: 1, label: 'Tramo 1' }] });
      const db = getDbConnection();
      db.get('SELECT id, rutaGpxCompleto FROM actividades WHERE id = ?', [activityId], (err, act) => {
        if (err || !act || !act.rutaGpxCompleto) {
          return resolve({ count: 1, segments: [{ index: 1, label: 'Tramo 1' }] });
        }

        const uploadsPath = path.resolve(__dirname, '../../../../uploads');
        const watchRelative = act.rutaGpxCompleto.replace('recorrido.gpx', 'recorrido_reloj.gpx');
        const watchPath = path.join(uploadsPath, watchRelative);
        const targetFile = fs.existsSync(watchPath) ? watchPath : path.join(uploadsPath, act.rutaGpxCompleto);

        if (!fs.existsSync(targetFile)) {
          return resolve({ count: 1, segments: [{ index: 1, label: 'Tramo 1' }] });
        }

        try {
          const content = fs.readFileSync(targetFile, 'utf8');
          const trksegs = content.match(/<trkseg[\s>]/gi);
          let count = trksegs ? trksegs.length : 1;
          if (count <= 1) {
            const trks = content.match(/<trk[\s>]/gi);
            if (trks && trks.length > 1) {
              count = trks.length;
            }
          }
          const segments = Array.from({ length: Math.max(1, count) }, (_, i) => ({
            index: i + 1,
            label: `Tramo ${i + 1}`
          }));
          console.log(`⌚ [HealthController] Actividad #${activityId} contiene ${count} tramo(s) de reloj`);
          resolve({ count: Math.max(1, count), segments });
        } catch (e) {
          resolve({ count: 1, segments: [{ index: 1, label: 'Tramo 1' }] });
        }
      });
    });
  }

  /**
   * 📊 Consolida matemáticamente los datos de múltiples tramos analizados por Gemini
   */
  static consolidarDatosTramos(tramosResults) {
    if (!tramosResults || tramosResults.length === 0) return null;
    if (tramosResults.length === 1) return { ...tramosResults[0].data, tramos: tramosResults };

    const parseDurationSecs = (dur) => {
      if (!dur || typeof dur !== 'string') return 0;
      const p = dur.split(':').map(Number);
      if (p.length === 3) return (p[0] * 3600) + (p[1] * 60) + (p[2] || 0);
      if (p.length === 2) return (p[0] * 60) + (p[1] || 0);
      return 0;
    };

    const formatSecsToHms = (totalSecs) => {
      const h = Math.floor(totalSecs / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      const s = Math.floor(totalSecs % 60);
      return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
    };

    let totalDistKm = 0;
    let totalSecs = 0;
    let totalCaloriesActive = 0;
    let totalCalories = 0;
    let totalSteps = 0;
    let maxHr = 0;
    let weightedHrSum = 0;
    let weightedHrDuration = 0;
    let maxCadence = 0;
    let weightedCadenceSum = 0;
    let strideSum = 0;
    let strideCount = 0;
    let bestPaceSecs = Infinity;
    let consolidatedSplits = [];
    let zonesSecs = { light: 0, intensive: 0, aerobic: 0, anaerobic: 0, vo2max: 0 };

    tramosResults.forEach((tr) => {
      const d = tr.data || {};
      const dist = Number(d.distance_km) || 0;
      totalDistKm += dist;

      const durSecs = parseDurationSecs(d.duration_total);
      totalSecs += durSecs;

      totalCaloriesActive += Number(d.calories_active) || 0;
      totalCalories += Number(d.calories_total) || 0;
      totalSteps += Number(d.steps) || 0;

      if (d.heart_rate?.max_lpm) {
        maxHr = Math.max(maxHr, Number(d.heart_rate.max_lpm) || 0);
      }
      if (d.heart_rate?.avg_lpm && durSecs > 0) {
        weightedHrSum += (Number(d.heart_rate.avg_lpm) * durSecs);
        weightedHrDuration += durSecs;
      }

      if (d.heart_rate?.zones) {
        Object.keys(zonesSecs).forEach(k => {
          zonesSecs[k] += parseDurationSecs(d.heart_rate.zones[k]);
        });
      }

      if (d.cadence_max_bpm) maxCadence = Math.max(maxCadence, Number(d.cadence_max_bpm));
      if (d.cadence_avg_steps_min && durSecs > 0) {
        weightedCadenceSum += (Number(d.cadence_avg_steps_min) * durSecs);
      }

      if (d.stride_avg_cm) {
        strideSum += Number(d.stride_avg_cm);
        strideCount++;
      }

      if (d.pace_max) {
        const pSecs = parseDurationSecs(d.pace_max);
        if (pSecs > 0 && pSecs < bestPaceSecs) bestPaceSecs = pSecs;
      }

      if (Array.isArray(d.splits)) {
        d.splits.forEach(s => {
          consolidatedSplits.push({
            km: consolidatedSplits.length + 1,
            pace: s.pace,
            tramo: tr.tramo
          });
        });
      }
    });

    const avgPaceSecsPerKm = totalDistKm > 0 ? Math.round(totalSecs / totalDistKm) : 0;
    const avgPaceStr = avgPaceSecsPerKm > 0
      ? `${String(Math.floor(avgPaceSecsPerKm / 60)).padStart(2, '0')}:${String(avgPaceSecsPerKm % 60).padStart(2, '0')}`
      : null;

    const paceMaxStr = bestPaceSecs < Infinity
      ? `${String(Math.floor(bestPaceSecs / 60)).padStart(2, '0')}:${String(bestPaceSecs % 60).padStart(2, '0')}`
      : null;

    const avgHr = weightedHrDuration > 0 ? Math.round(weightedHrSum / weightedHrDuration) : null;
    const avgCadence = weightedHrDuration > 0 ? Math.round(weightedCadenceSum / weightedHrDuration) : null;
    const avgStride = strideCount > 0 ? Math.round(strideSum / strideCount) : null;

    return {
      user: tramosResults[0].data?.user || 'Usuario',
      date: tramosResults[0].data?.date || new Date().toISOString().slice(0, 19).replace('T', ' '),
      distance_km: Math.round(totalDistKm * 100) / 100,
      duration_total: formatSecsToHms(totalSecs),
      calories_active: totalCaloriesActive,
      calories_total: totalCalories,
      steps: totalSteps,
      pace_avg: avgPaceStr,
      pace_max: paceMaxStr,
      cadence_avg_steps_min: avgCadence,
      cadence_max_bpm: maxCadence || null,
      stride_avg_cm: avgStride,
      heart_rate: {
        avg_lpm: avgHr,
        max_lpm: maxHr || null,
        zones: {
          light: formatSecsToHms(zonesSecs.light),
          intensive: formatSecsToHms(zonesSecs.intensive),
          aerobic: formatSecsToHms(zonesSecs.aerobic),
          anaerobic: formatSecsToHms(zonesSecs.anaerobic),
          vo2max: formatSecsToHms(zonesSecs.vo2max)
        }
      },
      splits: consolidatedSplits,
      tramos: tramosResults
    };
  }

  /**
   * 🏃‍♂️ Procesa capturas de reloj Xiaomi y guarda actividad + splits (soporta múltiples tramos)
   */
  static async uploadWatch(req, res) {
    const files = req.files;
    const { itinerary_id, activity_id, custom_api_key, tramos_meta } = req.body;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'Debes enviar al menos una captura de pantalla del reloj.' });
    }

    if (!itinerary_id) {
      return res.status(400).json({ error: 'El campo itinerary_id es obligatorio.' });
    }

    try {
      console.log(`🏃‍♂️ [HealthController] Procesando ${files.length} capturas de reloj...`);

      // Deducir o parsear grupos de archivos por tramo
      let tramosFiles = [];
      if (tramos_meta) {
        try {
          const meta = typeof tramos_meta === 'string' ? JSON.parse(tramos_meta) : tramos_meta;
          let offset = 0;
          for (const m of meta) {
            const count = m.count || 0;
            if (count > 0) {
              tramosFiles.push({ tramo: m.tramo || (tramosFiles.length + 1), files: files.slice(offset, offset + count) });
              offset += count;
            }
          }
        } catch (eMeta) {
          console.warn('⚠️ Error parseando tramos_meta:', eMeta);
        }
      }

      if (tramosFiles.length === 0) {
        let detected = { count: 1 };
        if (activity_id) {
          detected = await HealthController.detectWatchSegments(activity_id);
        }
        if (detected.count > 1 && files.length > 4) {
          const perTramo = Math.ceil(files.length / detected.count);
          for (let i = 0; i < detected.count; i++) {
            const slice = files.slice(i * perTramo, (i + 1) * perTramo);
            if (slice.length > 0) tramosFiles.push({ tramo: i + 1, files: slice });
          }
        } else {
          tramosFiles.push({ tramo: 1, files });
        }
      }

      console.log(`🏃‍♂️ [HealthController] ${tramosFiles.length} tramo(s) detectado(s) para procesar con Gemini.`);
      const tramosResults = [];

      for (let i = 0; i < tramosFiles.length; i++) {
        const tr = tramosFiles[i];
        console.log(`🔍 [HealthController] Analizando Tramo ${tr.tramo} (${tr.files.length} capturas)...`);
        const buffers = tr.files.map(f => f.buffer);
        const resTramo = await geminiService.procesarCapturasReloj(buffers, custom_api_key);
        if (resTramo) {
          tramosResults.push({
            tramo: tr.tramo,
            data: resTramo
          });
        }
      }

      if (tramosResults.length === 0) {
        throw new Error('No se pudo extraer información válida de las capturas.');
      }

      const data = HealthController.consolidarDatosTramos(tramosResults);

      console.log('✅ [HealthController] Datos consolidados de Xiaomi Mi Fitness:', {
        user: data.user,
        date: data.date,
        distance_km: data.distance_km,
        steps: data.steps,
        splits: data.splits?.length,
        tramos: tramosResults.length
      });

      const db = getDbConnection();

      // Transacción en SQLite
      db.serialize(() => {
        // Eliminar registro previo de salud para esta actividad si ya existía (para evitar duplicados)
        if (activity_id) {
          db.run(`DELETE FROM travel_health_activity WHERE activity_id = ?`, [activity_id]);
        }

        const queryActivity = `
          INSERT INTO travel_health_activity (
            itinerary_id, activity_id, date_walk, user_name, distance_km, duration_total,
            calories_active, calories_total, steps, pace_avg, pace_max,
            cadence_avg, cadence_max, stride_avg_cm, stride_max_cm,
            hr_avg, hr_max, zone_light, zone_intensive, zone_aerobic, zone_anaerobic, zone_vo2max,
            vitality_score, tramos_data
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          data.vitality_score || null,
          tramosResults.length > 1 ? JSON.stringify(tramosResults) : null
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
              message: `Actividad de reloj registrada correctamente (${tramosResults.length} tramo/s, sin splits).`,
              health_activity_id: healthActivityId,
              tramos_count: tramosResults.length,
              data
            });
          }

          const querySplit = `INSERT INTO travel_health_splits (health_activity_id, km_number, pace, tramo) VALUES (?, ?, ?, ?)`;
          let completed = 0;
          let hasSplitError = false;

          splits.forEach(s => {
            db.run(querySplit, [healthActivityId, s.km, s.pace, s.tramo || 1], (splitErr) => {
              completed++;
              if (splitErr) hasSplitError = true;

              if (completed === splits.length) {
                if (hasSplitError) {
                  console.warn('⚠️ Hubo advertencias al insertar algunos splits');
                }
                return res.status(201).json({
                  message: `Actividad de reloj y desglose de ritmos registrados con éxito (${tramosResults.length} tramo/s).`,
                  health_activity_id: healthActivityId,
                  total_splits: splits.length,
                  tramos_count: tramosResults.length,
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

      console.log('✅ [HealthController] Métricas de báscula extraídas (JSON completo):', JSON.stringify(data, null, 2));

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
   * 🩺 Obtiene la actividad de salud asociada directamente a un activity_id específico (con sus splits y tramos)
   */
  static async getActivityByActivityId(req, res) {
    const { activityId } = req.params;
    const db = getDbConnection();
    const segInfo = await HealthController.detectWatchSegments(activityId);

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
        return res.json({
          hasData: false,
          data: null,
          watch_segments_count: segInfo.count,
          expected_photos_count: segInfo.count * 4,
          segments: segInfo.segments
        });
      }

      if (activity.tramos_data) {
        try {
          activity.tramos = JSON.parse(activity.tramos_data);
        } catch {}
      }

      const querySplits = `SELECT * FROM travel_health_splits WHERE health_activity_id = ? ORDER BY km_number ASC`;
      db.all(querySplits, [activity.id], (splitErr, splits) => {
        if (splitErr) {
          return res.status(500).json({ error: splitErr.message });
        }
        activity.splits = splits || [];
        const count = (activity.tramos && activity.tramos.length > 0) ? activity.tramos.length : segInfo.count;
        res.json({
          hasData: true,
          data: activity,
          watch_segments_count: count,
          expected_photos_count: count * 4,
          segments: segInfo.segments
        });
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

      if (activity.tramos_data) {
        try {
          activity.tramos = JSON.parse(activity.tramos_data);
        } catch {}
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
