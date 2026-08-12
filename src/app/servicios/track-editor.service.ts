import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TrackEdit, TrackAnchor, AnyTrackEdit, AppendEdit } from '../modelos/track-edit.model';
import { GpxPoint } from './gpx-animation.service';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class TrackEditorService {
  // Ajustar baseUrl según entorno. Asumimos la misma ruta en la que sirve Angular en local o build
  private baseUrl = environment.apiUrl || '';

  constructor(private http: HttpClient) { }

  /**
   * Obtiene la lista de ediciones no destructivas para una actividad
   */
  getTrackEdits(actividadId: number): Observable<TrackEdit[]> {
    return this.http.get<TrackEdit[]>(`${this.baseUrl}/api/actividades/${actividadId}/track-edits`);
  }

  /**
   * Crea una nueva edición no destructiva
   */
  createTrackEdit(edit: TrackEdit): Observable<any> {
    return this.http.post(`${this.baseUrl}/api/track-edits`, edit);
  }

  /**
   * Elimina una edición no destructiva por ID
   */
  deleteTrackEdit(id: number): Observable<any> {
    return this.http.delete(`${this.baseUrl}/api/track-edits/${id}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SEGMENTS API (Fase 2.1.a)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Obtiene los segmentos de una actividad, ordenados por segmentOrder.
   */
  getSegments(actividadId: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/api/actividades/${actividadId}/segments?t=${Date.now()}`);
  }

  /**
   * Crea un segmento en el backend.
   * @param actividadId ID de la actividad
   * @param points Array de {lat, lng} o GpxPoint
   * @param source Origen del segmento ('original' o 'user-append')
   */
  createSegment(actividadId: number, points: any[], source: string = 'user-append'): Observable<any> {
    return this.http.post(`${this.baseUrl}/api/actividades/${actividadId}/segments`, {
      source,
      points
    });
  }

  /**
   * Elimina un segmento por ID.
   */
  deleteSegment(id: number): Observable<any> {
    return this.http.delete(`${this.baseUrl}/api/segments/${id}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // APPEND CON TIMESTAMPS MONOTÓNICOS (Fase 2.1.a)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Calcula timestamps monotónicos para los puntos append usando
   * velocidad local suavizada del último tramo (N=5, α=0.3).
   * Los parámetros N y alpha son fijos internamente en esta fase.
   */
  applyAppendWithTimestamps(existingPoints: GpxPoint[], appendPoints: { lat: number; lng: number }[]): GpxPoint[] {
    if (!appendPoints || appendPoints.length === 0) return [];

    const N = 5;     // Ventana de puntos para cálculo de velocidad local
    const ALPHA = 0.3; // Factor de suavizado exponencial

    // 1. Calcular velocidad de referencia desde los últimos N puntos
    let refSpeedMps = 1.389; // Fallback: 5 km/h en m/s

    if (existingPoints.length >= 2) {
      const windowStart = Math.max(0, existingPoints.length - N);
      const windowPoints = existingPoints.slice(windowStart);

      const speeds: number[] = [];
      for (let i = 1; i < windowPoints.length; i++) {
        const prev = windowPoints[i - 1];
        const curr = windowPoints[i];
        const dist = this.getDistance(prev.lat, prev.lng, curr.lat, curr.lng);
        const dt = (prev.time && curr.time)
          ? Math.abs(curr.time.getTime() - prev.time.getTime()) / 1000
          : 0;
        if (dt > 0 && dist > 0) {
          speeds.push(dist / dt);
        }
      }

      if (speeds.length > 0) {
        // Suavizado exponencial
        let smoothed = speeds[0];
        for (let i = 1; i < speeds.length; i++) {
          smoothed = ALPHA * speeds[i] + (1 - ALPHA) * smoothed;
        }
        refSpeedMps = Math.max(0.5, smoothed); // Mínimo 0.5 m/s para evitar infinitos
      }
    }

    // 2. Determinar timestamp base
    const lastExisting = existingPoints.length > 0
      ? existingPoints[existingPoints.length - 1]
      : null;
    let currentTimeMs = lastExisting?.time
      ? lastExisting.time.getTime()
      : Date.now();
    const baseMode = lastExisting?.mode || 'original';
    const baseHfMode = lastExisting?.hfMode || 'original';

    // 3. Generar puntos con timestamps monotónicos
    const result: GpxPoint[] = [];
    let prevLat = lastExisting?.lat ?? appendPoints[0].lat;
    let prevLng = lastExisting?.lng ?? appendPoints[0].lng;

    for (const pt of appendPoints) {
      const dist = this.getDistance(prevLat, prevLng, pt.lat, pt.lng);
      const dtMs = (dist / refSpeedMps) * 1000;
      currentTimeMs += Math.max(dtMs, 1000); // Mínimo 1 segundo entre puntos

      result.push({
        lat: pt.lat,
        lng: pt.lng,
        ele: undefined,
        time: new Date(currentTimeMs),
        mode: baseMode,
        hfMode: baseHfMode,
        distAcum: 0,
        timeAcum: 0
      });

      prevLat = pt.lat;
      prevLng = pt.lng;
    }

    return result;
  }

  /**
   * Pipeline de Composición Pre-Animación.
   * Aplica la colección de TrackEdits al array de GpxPoints originales y devuelve un array limpio.
   * ORDEN DE APLICACIÓN: 1. Delete, 2. Override (Replace e Insert en Fase 2)
   */
  applyEdits(originalPoints: GpxPoint[], edits: AnyTrackEdit[]): GpxPoint[] {
    if (!edits || edits.length === 0 || !originalPoints || originalPoints.length === 0) {
      return [...originalPoints];
    }

    // Ordenar cronológicamente para que edits más recientes apliquen sus mutaciones al final (solapamientos)
    const sortedEdits = [...edits].sort((a, b) => {
      const tA = (a as TrackEdit).createdAt ? new Date((a as TrackEdit).createdAt!).getTime() : 0;
      const tB = (b as TrackEdit).createdAt ? new Date((b as TrackEdit).createdAt!).getTime() : 0;
      return tA - tB;
    });

    // Aplicación estricta y secuencial sobre el estado S_(n-1)
    let currentPoints = [...originalPoints];

    sortedEdits.forEach(edit => {
      // ---- Append handling ----
      if (edit.action === 'append') {
        const appendEdit = edit as any; // AppendEdit
        if (appendEdit.newPoints && appendEdit.newPoints.length > 0) {
          const lastPoint = currentPoints.length ? currentPoints[currentPoints.length - 1] : undefined;
          const defaultMode = lastPoint?.mode || 'original';
          const defaultHfMode = lastPoint?.hfMode || 'original';
          const appended: GpxPoint[] = appendEdit.newPoints.map((pt: any) => ({
            lat: pt.lat,
            lng: pt.lng,
            ele: undefined,
            time: undefined,
            mode: defaultMode,
            hfMode: defaultHfMode,
            distAcum: 0,
            timeAcum: 0,
            _isSynthetic: true,
            _sourceEditId: edit.id
          } as unknown as GpxPoint));
          currentPoints = currentPoints.concat(appended);
        }
        return; // skip further processing for this edit
      }
      const idxStart = this.resolveAnchor(edit.startAnchor, currentPoints);
      const idxEnd = this.resolveAnchor(edit.endAnchor, currentPoints);

      if (idxStart !== -1 && idxEnd !== -1) {
        const min = Math.min(idxStart, idxEnd);
        const max = Math.max(idxStart, idxEnd);

        if (edit.action === 'delete_segment') {
          // Eliminamos el segmento completo (inclusivo A y B)
          currentPoints.splice(min, max - min + 1);
        }
        else if (edit.action === 'override_mode') {
          for (let i = min; i <= max; i++) {
            if (edit.newMode) {
              currentPoints[i].mode = edit.newMode;
              currentPoints[i].hfMode = edit.newMode;
            }
          }
        }

      }
    });

    // 4. Recálculo absoluto de métricas espaciales y temporales
    return this.recalculateAccumulators(currentPoints);
  }

  /**
   * Resolución determinista de Anchors.
   * Regla de cascada: 1. Time -> 2. Index verificado -> 3. Búsqueda Espacial -> 4. Conflicto
   */
  public resolveAnchor(anchor: TrackAnchor, points: GpxPoint[]): number {
    if (!points || points.length === 0) return -1;

    // 1. Resolución Temporal Precisa: Buscar el punto con la diferencia de tiempo mínima absoluta (< 2s)
    if (anchor.time) {
      const anchorTimeMs = new Date(anchor.time).getTime();
      let bestIdx = -1;
      let minDiff = Infinity;

      for (let i = 0; i < points.length; i++) {
        const ptTime = points[i].time;
        if (ptTime) {
          const diff = Math.abs(ptTime.getTime() - anchorTimeMs);
          if (diff < minDiff) {
            minDiff = diff;
            bestIdx = i;
          }
        }
      }

      if (bestIdx !== -1 && minDiff < 2000) {
        return bestIdx;
      }
    }

    // 2. Resolución por Índice con Verificación Espacial (Fallback si el índice original es válido)
    if (anchor.index !== undefined && anchor.index >= 0 && anchor.index < points.length) {
      const pointAtIndex = points[anchor.index];
      const dist = this.getDistance(anchor.lat, anchor.lng, pointAtIndex.lat, pointAtIndex.lng);
      if (dist < 20) { // Tolerancia espacial de 20m
        return anchor.index;
      }
    }

    // 3. Inferir expectedLogicalIndex usando el tiempo más cercano si el índice es indefinido (para históricos)
    let expectedLogicalIndex = anchor.index;
    if (expectedLogicalIndex === undefined && anchor.time) {
      const anchorTimeMs = new Date(anchor.time).getTime();
      let closestTimeIdx = 0;
      let minTimeDiff = Infinity;

      for (let i = 0; i < points.length; i++) {
        const ptTime = points[i].time;
        if (ptTime) {
          const diff = Math.abs(ptTime.getTime() - anchorTimeMs);
          if (diff < minTimeDiff) {
            minTimeDiff = diff;
            closestTimeIdx = i;
          }
        }
      }
      expectedLogicalIndex = closestTimeIdx;
    }
    if (expectedLogicalIndex === undefined) {
      expectedLogicalIndex = 0;
    }

    // 4. Resolución Espacial de Precisión con Penalización de Índice Lógico (Evita saltar entre ida y vuelta)
    let closestIdx = -1;
    let minScore = Infinity;

    for (let i = 0; i < points.length; i++) {
      const dist = this.getDistance(anchor.lat, anchor.lng, points[i].lat, points[i].lng);
      const score = dist + Math.abs(i - expectedLogicalIndex) * 5.0; // Multiplicador de 5.0 para penalizar saltos grandes
      if (score < minScore) {
        minScore = score;
        closestIdx = i;
      }
    }

    if (closestIdx !== -1) {
      return closestIdx;
    }

    console.warn('⚠️ [TrackEditor] Conflicto resolviendo anchor. Edit ignorado para proteger integridad.', anchor);
    return -1;
  }

  /**
   * Recalcula la distancia acumulada y el tiempo acumulado (desde cero) 
   * del array final para asegurar coherencia en el HUD del reproductor.
   */
  /**
   * Devuelve la velocidad esperada en metros por segundo según el modo de transporte.
   */
  public getModeSpeedMps(mode: string | null | undefined): number {
    if (!mode) return 1.39; // 5 km/h por defecto
    const m = mode.toLowerCase();
    if (m.includes('boat') || m.includes('barco') || m.includes('ship') || m.includes('ferry') || m.includes('crucero')) return 5.55; // 20 km/h
    if (m.includes('car') || m.includes('coch') || m.includes('driv')) return 16.67; // 60 km/h
    if (m.includes('bus') || m.includes('autobus')) return 12.5; // 45 km/h
    if (m.includes('train') || m.includes('tren')) return 19.44; // 70 km/h
    if (m.includes('plane') || m.includes('avion')) return 83.33; // 300 km/h
    if (m.includes('bic') || m.includes('cycl')) return 4.17; // 15 km/h
    if (m.includes('run') || m.includes('corr')) return 2.78; // 10 km/h
    if (m.includes('walk') || m.includes('camin') || m.includes('andan')) return 1.39; // 5 km/h
    return 1.39;
  }

  /**
   * Calibra los timestamps de los puntos GPX (incluyendo tramos prolongados)
   * utilizando los timestamps reales de las fotos asociadas como anclas maestras.
   */
  private parseFlexibleDate(raw: any, filename?: string): number | null {
    if (!raw && !filename) return null;

    if (raw) {
      if (typeof raw === 'number' && !isNaN(raw)) return raw;
      if (raw instanceof Date && !isNaN(raw.getTime())) return raw.getTime();

      const str = String(raw).trim();
      let d = new Date(str);
      if (!isNaN(d.getTime())) return d.getTime();

      // Formato europeo: DD/MM/YYYY HH:mm:ss o DD-MM-YYYY HH:mm:ss
      const euroMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+|,?\s*)(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
      if (euroMatch) {
        const day = parseInt(euroMatch[1], 10);
        const month = parseInt(euroMatch[2], 10) - 1;
        const year = parseInt(euroMatch[3], 10);
        const hours = parseInt(euroMatch[4] || '0', 10);
        const minutes = parseInt(euroMatch[5] || '0', 10);
        const seconds = parseInt(euroMatch[6] || '0', 10);
        d = new Date(year, month, day, hours, minutes, seconds);
        if (!isNaN(d.getTime())) return d.getTime();
      }
    }

    // Fallback: extraer timestamp del nombre de archivo (ej: JPEG_20260628_115836_17826...)
    if (filename) {
      const nameMatch = String(filename).match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
      if (nameMatch) {
        const year = parseInt(nameMatch[1], 10);
        const month = parseInt(nameMatch[2], 10) - 1;
        const day = parseInt(nameMatch[3], 10);
        const hours = parseInt(nameMatch[4], 10);
        const minutes = parseInt(nameMatch[5], 10);
        const seconds = parseInt(nameMatch[6], 10);
        const d = new Date(year, month, day, hours, minutes, seconds);
        if (!isNaN(d.getTime())) return d.getTime();
      }
    }

    return null;
  }

  private ensureAccumulators(points: GpxPoint[]): void {
    if (!points || points.length === 0) return;
    let accum = 0;
    for (let i = 0; i < points.length; i++) {
      if (i === 0) {
        if (points[i].distAcum === undefined) points[i].distAcum = 0;
      } else {
        const d = this.getDistance(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
        accum += d;
        if (points[i].distAcum === undefined || points[i].distAcum === 0) {
          points[i].distAcum = (points[i - 1].distAcum || 0) + d;
        }
      }
    }
  }

  /**
   * Calibra las marcas de tiempo (time / timeAcum) de una lista de puntos GPX 
   * utilizando las coordenadas y fechas de captura de los archivos multimedia disponibles.
   */
  public calibratePointsWithMedia(points: GpxPoint[], mediaList: any[]): GpxPoint[] {
    if (!points || points.length === 0 || !mediaList || mediaList.length === 0) {
      return points;
    }

    // 1. Extraer anclas válidas de fotos con coordenadas y hora de captura
    const photoAnchors: { lat: number; lng: number; timeMs: number }[] = [];
    for (const item of mediaList) {
      let lat: number | null = item.latitud || item.lat || null;
      let lng: number | null = item.longitud || item.lng || item.lon || null;
      let horaRaw = item.timestampReal || item.horaCaptura || item.fechaCreacion || item.fecha || item.time || item.timestamp;

      if ((!lat || !lng || !horaRaw) && item.geolocalizacion) {
        try {
          const geoData = typeof item.geolocalizacion === 'string'
            ? JSON.parse(item.geolocalizacion)
            : item.geolocalizacion;
          lat = lat ?? (geoData?.latitud ?? geoData?.latitude ?? geoData?.lat ?? null);
          lng = lng ?? (geoData?.longitud ?? geoData?.longitude ?? geoData?.lng ?? geoData?.lon ?? null);
          horaRaw = horaRaw || geoData?.timestampReal || geoData?.timestamp || geoData?.time || geoData?.fecha;
        } catch (e) {
          if (typeof item.geolocalizacion === 'string' && item.geolocalizacion.includes(',')) {
            const parts = item.geolocalizacion.split(',').map((s: string) => parseFloat(s.trim()));
            if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
              lat = lat ?? parts[0];
              lng = lng ?? parts[1];
            }
          }
        }
      }

      if ((!lat || !lng || !horaRaw) && item.metadatos) {
        try {
          const metaData = typeof item.metadatos === 'string'
            ? JSON.parse(item.metadatos)
            : item.metadatos;
          lat = lat ?? (metaData?.latitud ?? metaData?.latitude ?? metaData?.lat ?? null);
          lng = lng ?? (metaData?.longitud ?? metaData?.longitude ?? metaData?.lng ?? null);
          horaRaw = horaRaw || metaData?.timestampReal || metaData?.timestamp || metaData?.dateTimeOriginal;
        } catch (e) {}
      }

      const filename = item.nombreArchivo || item.rutaArchivo;
      const timeMs = this.parseFlexibleDate(horaRaw, filename);

      if (lat !== null && lng !== null && timeMs !== null && !isNaN(lat) && !isNaN(lng)) {
        photoAnchors.push({ lat: Number(lat), lng: Number(lng), timeMs });
      }
    }

    if (photoAnchors.length === 0) return points;

    // Asegurar que distAcum está bien calculada en el tramo
    this.ensureAccumulators(points);

    // 2. Mapear cada foto a su punto GPX espacialmente más cercano (MÁXIMO 80 Metros)
    const MAX_PHOTO_DISTANCE_METERS = 80;
    const rawGpxAnchors: { gpxIdx: number; timeMs: number; distAcum: number; distMeters: number }[] = [];

    for (const photo of photoAnchors) {
      let closestIdx = -1;
      let minDistance = Infinity;

      for (let i = 0; i < points.length; i++) {
        const d = this.getDistance(photo.lat, photo.lng, points[i].lat, points[i].lng);
        if (d < minDistance) {
          minDistance = d;
          closestIdx = i;
        }
      }

      // Requerir que la foto esté a menos de 80 metros del punto del recorrido
      if (closestIdx !== -1 && minDistance <= MAX_PHOTO_DISTANCE_METERS) {
        rawGpxAnchors.push({
          gpxIdx: closestIdx,
          timeMs: photo.timeMs,
          distAcum: points[closestIdx].distAcum || 0,
          distMeters: minDistance
        });
      }
    }

    if (rawGpxAnchors.length === 0) {
      this.recalculateAccumulators(points);
      return points;
    }

    // Ordenar anclas por índice GPX
    rawGpxAnchors.sort((a, b) => a.gpxIdx - b.gpxIdx);

    // Desduplicar anclas que caen en el mismo punto GPX (mantener la más cercana en distancia)
    const deduplicatedAnchors: typeof rawGpxAnchors = [];
    for (const anchor of rawGpxAnchors) {
      const existing = deduplicatedAnchors.find(a => a.gpxIdx === anchor.gpxIdx);
      if (existing) {
        if (anchor.distMeters < existing.distMeters) {
          existing.timeMs = anchor.timeMs;
          existing.distMeters = anchor.distMeters;
        }
      } else {
        deduplicatedAnchors.push(anchor);
      }
    }

    // Filtrar anclas para asegurar estricta monotonicidad temporal (timeMs creciente)
    const validAnchors: { gpxIdx: number; timeMs: number; distAcum: number }[] = [];
    for (const a of deduplicatedAnchors) {
      if (validAnchors.length === 0 || a.timeMs > validAnchors[validAnchors.length - 1].timeMs) {
        validAnchors.push({ gpxIdx: a.gpxIdx, timeMs: a.timeMs, distAcum: a.distAcum });
      }
    }

    if (validAnchors.length === 0) {
      this.recalculateAccumulators(points);
      return points;
    }

    // 3. Extrapolar ancla inicial (punto 0) si el primer ancla no es el punto 0
    const firstA = validAnchors[0];
    if (firstA.gpxIdx > 0) {
      const p0 = points[0];
      const speedMps = this.getModeSpeedMps(p0.mode || p0.hfMode);
      const distDiff = firstA.distAcum - (p0.distAcum || 0);
      const dtSec = distDiff > 0 ? distDiff / speedMps : 0;
      const p0TimeMs = firstA.timeMs - dtSec * 1000;
      validAnchors.unshift({ gpxIdx: 0, timeMs: p0TimeMs, distAcum: p0.distAcum || 0 });
    }

    // Extrapolar ancla final (último punto) si el último ancla no es el punto final
    const lastA = validAnchors[validAnchors.length - 1];
    const lastPt = points[points.length - 1];
    const totalDist = lastPt.distAcum || 0;
    if (lastA.gpxIdx < points.length - 1) {
      const speedMps = this.getModeSpeedMps(lastPt.mode || lastPt.hfMode);
      const distDiff = totalDist - lastA.distAcum;
      const dtSec = distDiff > 0 ? distDiff / speedMps : 0;
      const pLastTimeMs = lastA.timeMs + dtSec * 1000;
      validAnchors.push({ gpxIdx: points.length - 1, timeMs: pLastTimeMs, distAcum: totalDist });
    }

    // 4. Interpolación lineal a tramos entre anclas
    const startTimeMs = validAnchors[0].timeMs;

    for (let k = 0; k < validAnchors.length - 1; k++) {
      const aStart = validAnchors[k];
      const aEnd = validAnchors[k + 1];
      const distDiff = aEnd.distAcum - aStart.distAcum;
      const timeDiffMs = aEnd.timeMs - aStart.timeMs;

      for (let i = aStart.gpxIdx; i <= aEnd.gpxIdx; i++) {
        const pt = points[i];
        const ptDist = (pt.distAcum || 0) - aStart.distAcum;
        const ratio = distDiff > 0 ? ptDist / distDiff : 0;
        const currentMs = aStart.timeMs + timeDiffMs * ratio;

        pt.time = new Date(currentMs);
        pt.timeAcum = Math.max(0, (currentMs - startTimeMs) / 1000);
      }
    }

    return points;
  }

  /**
   * Recalcula la distancia acumulada y el tiempo acumulado (desde cero) 
   * del array final para asegurar coherencia en el HUD del reproductor y editor.
   */
  public recalculateAccumulators(points: GpxPoint[]): GpxPoint[] {
    if (!points || points.length === 0) return points;

    let distAcum = 0;
    let prevPoint: GpxPoint | null = null;
    let startTimeMs: number | null = null;

    // Buscar primer punto con fecha para fijar el instante inicial
    const firstPointWithTime = points.find(p => p.time !== undefined && p.time !== null);
    if (firstPointWithTime && firstPointWithTime.time) {
      startTimeMs = firstPointWithTime.time.getTime();
    } else {
      startTimeMs = Date.now();
    }

    for (let i = 0; i < points.length; i++) {
      const p = points[i];

      if (i === 0) {
        p.distAcum = 0;
        p.timeAcum = 0;
        if (!p.time) {
          p.time = new Date(startTimeMs);
        }
      } else {
        // Recalcular Distancia
        const d = this.getDistance(prevPoint!.lat, prevPoint!.lng, p.lat, p.lng);
        distAcum += d;
        p.distAcum = distAcum;

        // Recalcular Tiempo: si no tiene time, lo extrapolamos del anterior según velocidad del modo
        if (!p.time) {
          if (prevPoint!.time) {
            const speedMps = this.getModeSpeedMps(p.mode || p.hfMode || prevPoint!.mode);
            const dtSec = Math.max(1, d / speedMps);
            p.time = new Date(prevPoint!.time.getTime() + dtSec * 1000);
          } else {
            p.time = new Date(startTimeMs + (i * 1000));
          }
        }

        if (startTimeMs !== null && p.time) {
          p.timeAcum = Math.max(0, (p.time.getTime() - startTimeMs) / 1000);
        } else {
          p.timeAcum = prevPoint!.timeAcum + 1;
        }
      }

      prevPoint = p;
    }

    return points;
  }

  /**
   * Calcula distancia en metros entre dos coordenadas (Fórmula Haversine)
   */
  public getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Radio Tierra
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const dPhi = (lat2 - lat1) * Math.PI / 180;
    const dLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) *
      Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Re-serializa un array de GpxPoint[] a GPX XML.
   * Soporta multi-segment (un <trkseg> por cada segmento) y single-segment (todo junto).
   * Esto permite pasar puntos editados al GpxAnimationComponent
   * sin tocar su código (sigue recibiendo gpxText: string).
   *
   * @param pointsOrSegments Array plano de puntos, o array de arrays (segmentos)
   * @param options.multiSegment Si true y se pasan segmentos, genera un <trkseg> por segmento
   */
  pointsToGpxXml(
    pointsOrSegments: GpxPoint[] | GpxPoint[][],
    options?: { multiSegment?: boolean }
  ): string {
    const multiSeg = options?.multiSegment ?? false;

    // Normalizar entrada a array de segmentos
    let segments: GpxPoint[][];
    if (pointsOrSegments.length === 0) {
      segments = [[]];
    } else if (Array.isArray(pointsOrSegments[0])) {
      // Ya es GpxPoint[][]
      segments = pointsOrSegments as GpxPoint[][];
    } else {
      // Es GpxPoint[], lo envolvemos en un segmento
      segments = [pointsOrSegments as GpxPoint[]];
    }

    // Si NO queremos multi-segment, forzamos el flatten aquí por seguridad, 
    // por si llegó un array de arrays y multiSeg es false.
    if (!multiSeg && segments.length > 1) {
      const flattened = segments.reduce((acc, curr) => acc.concat(curr), []);
      segments = [flattened];
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<gpx version="1.1" creator="TrackEditorService" xmlns="http://www.topografix.com/GPX/1/1">\n';
    xml += '  <metadata>\n';
    xml += '    <name>Track_Generado</name>\n';
    xml += '  </metadata>\n';
    xml += '  <trk>\n';

    for (const seg of segments) {
      let inSubSeg = false;
      for (const p of seg) {
        if (p.isGap || !inSubSeg) {
          if (inSubSeg) xml += '    </trkseg>\n';
          xml += '    <trkseg>\n';
          inSubSeg = true;
        }
        xml += `      <trkpt lat="${p.lat}" lon="${p.lng}">\n`;
        if (p.ele !== undefined) {
          xml += `        <ele>${p.ele}</ele>\n`;
        }
        if (p.time) {
          const timeStr = p.time instanceof Date ? p.time.toISOString() : p.time;
          xml += `        <time>${timeStr}</time>\n`;
        }
        const mode = p.mode || p.hfMode;
        if (mode || p.isGap) {
          xml += `        <extensions>\n`;
          if (mode) xml += `          <transportMode>${mode}</transportMode>\n`;
          if (p.isGap) xml += `          <isGap>true</isGap>\n`;
          xml += `        </extensions>\n`;
        }
        xml += '      </trkpt>\n';
      }
      if (inSubSeg) xml += '    </trkseg>\n';
    }

    xml += '  </trk>\n</gpx>';
    return xml;
  }

  /**
   * Pipeline ÚNICO CANÓNICO (Fase 2.1.a)
   * Devuelve el texto XML GPX definitivo, listo para ser consumido
   * por la animación o exportación.
   * - Si hay segmentos, los reconstruye y serializa a GPX multitramo.
   * - Si no hay segmentos, descarga y devuelve el GPX original intacto.
   */
  resolveCanonicalGpxXml(actividadId: number, options?: { flattenSegments?: boolean }): Observable<string> {
    const flatten = options?.flattenSegments ?? false;

    return new Observable<string>(subscriber => {
      this.getSegments(actividadId).subscribe({
        next: (segments) => {
          if (segments && segments.length > 0) {
            // Ejecutar el motor de replay en memoria
            const accumulatedPoints = this.replaySegments(segments);

            // Ya tenemos el track totalmente resuelto
            // Para asegurar la robustez, el acumulado es inherentemente continuo
            const resolvedSegments: GpxPoint[][] = [accumulatedPoints];

            // Generar XML
            const gpxXml = this.pointsToGpxXml(resolvedSegments, { multiSegment: !flatten });
            subscriber.next(gpxXml);
            subscriber.complete();
          } else {
            // Fallback: descargar GPX base
            this.http.get(`${this.baseUrl}/api/actividades/${actividadId}/gpx`, { responseType: 'blob' }).subscribe({
              next: (blob) => {
                const reader = new FileReader();
                reader.onload = (e: any) => {
                  subscriber.next(e.target.result);
                  subscriber.complete();
                };
                reader.onerror = (err) => subscriber.error(err);
                reader.readAsText(blob);
              },
              error: err => subscriber.error(err)
            });
          }
        },
        error: err => subscriber.error(err)
      });
    });
  }

  /**
   * Motor puro de Event Sourcing (Replay).
   * Procesa secuencialmente los segmentos aplicando appends e inserts
   * de forma inmutable sobre un estado acumulado.
   */
  public replaySegments(segments: any[]): GpxPoint[] {
    let accumulatedPoints: GpxPoint[] = [];

    // Invariante de Replay: procesamos secuencialmente
    for (const seg of segments) {
      const segPoints: GpxPoint[] = seg.points.map((p: any) => ({
        ...p,
        time: p.time ? new Date(p.time) : undefined
      }));

      if (!segPoints || segPoints.length === 0) continue;

      // Firma de ancla: time + lat + lng
      // Firma de ancla: time + lat + lng con tolerancia para evitar problemas de precisión en BBDD o punto flotante
      const isMatch = (p1: GpxPoint, p2: GpxPoint) => {
        if (p1.time && p2.time && Math.abs(p1.time.getTime() - p2.time.getTime()) < 2000) {
          return true;
        }
        return Math.abs(p1.lat - p2.lat) < 0.00005 && Math.abs(p1.lng - p2.lng) < 0.00005;
      };

      if (seg.source === 'original' || seg.source === 'user-append') {
        accumulatedPoints.push(...segPoints);
      } else if (seg.source === 'user-insert' || seg.source === 'user-override') {
        const pFirst = segPoints[0];
        const pLast = segPoints[segPoints.length - 1];

        const getAnchorObject = (anchorProp: any, ptFallback: GpxPoint): TrackAnchor => {
          if (anchorProp) {
            return {
              lat: anchorProp.lat ?? ptFallback.lat,
              lng: anchorProp.lng ?? ptFallback.lng,
              time: anchorProp.time ? (typeof anchorProp.time === 'string' ? anchorProp.time : anchorProp.time.toISOString()) : (ptFallback.time ? ptFallback.time.toISOString() : undefined),
              index: anchorProp.index
            };
          }
          return {
            lat: ptFallback.lat,
            lng: ptFallback.lng,
            time: ptFallback.time ? ptFallback.time.toISOString() : undefined
          };
        };

        const anchorA = getAnchorObject(seg.startAnchor, pFirst);
        const anchorB = getAnchorObject(seg.endAnchor, pLast);

        const idxA = this.resolveAnchor(anchorA, accumulatedPoints);
        const idxB = this.resolveAnchor(anchorB, accumulatedPoints);

        if (idxA === -1 || idxB === -1) {
          console.warn(`[TrackEditor] Anclas no encontradas para ${seg.source} (A: ${idxA}, B: ${idxB}). Saltando.`);
          continue;
        }

        let actualA = idxA;
        let actualB = idxB;
        if (idxB < idxA) {
          actualA = idxB;
          actualB = idxA;
        }

        // Splicing inyectando el tramo intermedio
        accumulatedPoints.splice(actualA, (actualB - actualA) + 1, ...segPoints);

        if (seg.source === 'user-insert') {
          this.interpolateTimeBetweenAnchors(pFirst, pLast, segPoints);
        }
      } else if (seg.source === 'user-delete') {
        const pFirst = segPoints[0];
        const pLast = segPoints[1] || segPoints[segPoints.length - 1];

        const getAnchorObject = (anchorProp: any, ptFallback: GpxPoint): TrackAnchor => {
          if (anchorProp) {
            return {
              lat: anchorProp.lat ?? ptFallback.lat,
              lng: anchorProp.lng ?? ptFallback.lng,
              time: anchorProp.time ? (typeof anchorProp.time === 'string' ? anchorProp.time : anchorProp.time.toISOString()) : (ptFallback.time ? ptFallback.time.toISOString() : undefined),
              index: anchorProp.index ?? (ptFallback as any).index
            };
          }
          return {
            lat: ptFallback.lat,
            lng: ptFallback.lng,
            time: ptFallback.time ? ptFallback.time.toISOString() : undefined,
            index: (ptFallback as any).index
          };
        };

        const anchorA = getAnchorObject(seg.startAnchor, pFirst);
        const anchorB = getAnchorObject(seg.endAnchor, pLast);

        const idxA = this.resolveAnchor(anchorA, accumulatedPoints);
        const idxB = this.resolveAnchor(anchorB, accumulatedPoints);

        if (idxA === -1 || idxB === -1) {
          console.warn(`[TrackEditor] Anclas no encontradas para user-delete (A: ${idxA}, B: ${idxB}). Saltando.`);
          continue;
        }

        let actualA = idxA;
        let actualB = idxB;
        if (idxB < idxA) {
          actualA = idxB;
          actualB = idxA;
        }

        // Si el borrado deja 4 o menos puntos residuales al principio, extender al inicio
        if (actualA <= 4) {
          actualA = 0;
        }

        // Si el borrado deja 4 o menos puntos residuales al final, extender hasta el final
        if (accumulatedPoints.length - 1 - actualB <= 4) {
          actualB = accumulatedPoints.length - 1;
        }

        const deleteLength = (actualB - actualA) + 1;
        if (deleteLength > 0) {
          accumulatedPoints.splice(actualA, deleteLength);
          if (actualA > 0 && actualA < accumulatedPoints.length) {
            accumulatedPoints[actualA].isGap = true;
          }
        }
      }
    }

    // Paso final: propagar el modo entre puntos contiguos.
    // Si un punto no tiene 'mode', hereda el del punto anterior.
    // Esto asegura que los tramos prolongados (user-append) y los puntos
    // intermedios del track original se muestren con el color correcto en el editor,
    // igual que en "ver GPX".
    let lastMode: string | undefined = undefined;
    for (const pt of accumulatedPoints) {
      if (pt.mode) {
        lastMode = pt.mode;
      } else if (lastMode) {
        pt.mode = lastMode;
        pt.hfMode = lastMode;
      }
    }

    return accumulatedPoints;
  }

  /**
   * Interpola el tiempo de los puntos intermedios proporcionalmente a la distancia recorrida.
   * Modifica el array newPoints in-place.
   */
  public interpolateTimeBetweenAnchors(anchorA: GpxPoint, anchorB: GpxPoint, newPoints: GpxPoint[]): void {
    if (!anchorA.time || !anchorB.time) {
      console.warn('[TrackEditor] Anclas sin tiempo. No se puede interpolar temporalmente.');
      return;
    }

    const tA = (anchorA.time instanceof Date ? anchorA.time : new Date(anchorA.time)).getTime();
    const tB = (anchorB.time instanceof Date ? anchorB.time : new Date(anchorB.time)).getTime();

    if (tB <= tA) {
      console.warn('[TrackEditor] Tiempo B <= Tiempo A. Interpolación inválida.');
      return;
    }

    const totalTimeDelta = tB - tA;
    let totalDistance = 0;
    const distances: number[] = [0];

    for (let i = 1; i < newPoints.length; i++) {
      const d = this.getDistance(newPoints[i - 1].lat, newPoints[i - 1].lng, newPoints[i].lat, newPoints[i].lng);
      totalDistance += d;
      distances.push(totalDistance);
    }

    for (let i = 1; i < newPoints.length - 1; i++) {
      const ratio = totalDistance > 0 ? distances[i] / totalDistance : i / (newPoints.length - 1);
      const interpolatedTime = new Date(tA + totalTimeDelta * ratio);
      newPoints[i].time = interpolatedTime;
    }
  }
}
