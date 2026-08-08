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
    // 1. Resolución Temporal Precisa (Prioridad #1)
    if (anchor.time) {
      const anchorTimeMs = new Date(anchor.time).getTime();
      const idx = points.findIndex(p => p.time && Math.abs(p.time.getTime() - anchorTimeMs) < 2000); // 2 segundos de tolerancia
      if (idx !== -1) return idx;
    }

    // 2. Resolución por Índice con Verificación Espacial (Fallback si hay pequeñas mutaciones)
    if (anchor.index !== undefined && anchor.index >= 0 && anchor.index < points.length) {
      const pointAtIndex = points[anchor.index];
      const dist = this.getDistance(anchor.lat, anchor.lng, pointAtIndex.lat, pointAtIndex.lng);
      if (dist < 15) { // Tolerancia espacial
        return anchor.index;
      }
    }

    // 3. Resolución Espacial de Emergencia (Desempate por índice si hay múltiples muy cerca)
    let closestIdx = -1;
    let minDistance = Infinity;

    // Si hay ancla index, lo usamos para desempatar, si no, 0
    const expectedLogicalIndex = anchor.index !== undefined ? anchor.index : 0;
    let bestScore = Infinity;

    for (let i = 0; i < points.length; i++) {
      const dist = this.getDistance(anchor.lat, anchor.lng, points[i].lat, points[i].lng);

      if (dist < 50) { // Candidato viable
        // Puntuación: la distancia espacial + castigo por distancia lógica
        const score = dist + Math.abs(i - expectedLogicalIndex) * 0.1; // El index lógico desempataría

        if (score < bestScore) {
          bestScore = score;
          minDistance = dist;
          closestIdx = i;
        }
      }
    }

    if (closestIdx !== -1) {
      return closestIdx;
    }

    // 4. Conflicto Crítico
    console.warn('⚠️ [TrackEditor] Conflicto resolviendo anchor. Edit ignorado para proteger integridad.', anchor);
    return -1;
  }

  /**
   * Recalcula la distancia acumulada y el tiempo acumulado (desde cero) 
   * del array final para asegurar coherencia en el HUD del reproductor.
   */
  private recalculateAccumulators(points: GpxPoint[]): GpxPoint[] {
    if (!points || points.length === 0) return points;

    let distAcum = 0;
    let timeAcum = 0;
    let prevPoint: GpxPoint | null = null;
    let startTimeMs: number | null = null;

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const currentTimeMs = p.time ? p.time.getTime() : null;

      if (i === 0) {
        startTimeMs = currentTimeMs;
        p.distAcum = 0;
        p.timeAcum = 0;
      } else {
        // Recalcular Distancia
        const d = this.getDistance(prevPoint!.lat, prevPoint!.lng, p.lat, p.lng);
        distAcum += d;
        p.distAcum = distAcum;

        // Recalcular Tiempo
        if (startTimeMs !== null && currentTimeMs !== null) {
          // El tiempo sigue el flujo original absoluto. Un salto espacial por "delete" no comprime el tiempo del viaje.
          timeAcum = (currentTimeMs - startTimeMs) / 1000;
        } else if (prevPoint) {
          // Fallback a velocidad media (5km/h = 1.38m/s) si el GPX original carecía de tags <time>
          timeAcum += (d / (5 / 3.6));
        }
        p.timeAcum = timeAcum;
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
      xml += '    <trkseg>\n';
      for (const p of seg) {
        xml += `      <trkpt lat="${p.lat}" lon="${p.lng}">\n`;
        if (p.ele !== undefined) {
          xml += `        <ele>${p.ele}</ele>\n`;
        }
        if (p.time) {
          const timeStr = p.time instanceof Date ? p.time.toISOString() : p.time;
          xml += `        <time>${timeStr}</time>\n`;
        }
        const mode = p.mode || p.hfMode;
        if (mode) {
          xml += `        <extensions>\n`;
          xml += `          <transportMode>${mode}</transportMode>\n`;
          xml += `        </extensions>\n`;
        }
        xml += '      </trkpt>\n';
      }
      xml += '    </trkseg>\n';
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
        const anchorA = segPoints[0];
        const anchorB = segPoints[segPoints.length - 1];

        const idxA = accumulatedPoints.findIndex(p => isMatch(p, anchorA));
        const idxB = accumulatedPoints.findIndex(p => isMatch(p, anchorB));

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

        // Fase 2.1.b / Fase 2.2: Splicing inyectando el tramo intermedio
        accumulatedPoints.splice(actualA, (actualB - actualA) + 1, ...segPoints);
        // user-override mantiene los timestamps originales.
        if (seg.source === 'user-insert') {
          this.interpolateTimeBetweenAnchors(anchorA, anchorB, segPoints);
        }
      } else if (seg.source === 'user-delete') {
        const anchorA = segPoints[0];
        const anchorB = segPoints[1];

        const idxA = accumulatedPoints.findIndex(p => isMatch(p, anchorA));
        const idxB = accumulatedPoints.findIndex(p => isMatch(p, anchorB));

        if (idxA === -1 || idxB === -1) {
          console.warn(`[TrackEditor] Anclas no encontradas para user-delete (A: ${idxA}, B: ${idxB}). Saltando.`);
          continue;
        }

        // Semántica: eliminamos el segmento completo (inclusivo A y B), igual que delete_segment antiguo
        let actualA = idxA;
        let actualB = idxB;
        if (idxB < idxA) {
          actualA = idxB;
          actualB = idxA;
        }

        const deleteLength = (actualB - actualA) + 1;
        if (deleteLength > 0) {
          accumulatedPoints.splice(actualA, deleteLength);
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
