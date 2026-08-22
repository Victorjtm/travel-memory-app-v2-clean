import { Injectable } from '@angular/core';

export interface GpxPoint {
  lat: number;
  lng: number;
  ele?: number;
  time?: Date;
  distAcum: number; // Distancia acumulada en metros
  timeAcum: number; // Tiempo acumulado en segundos
  mode?: string;    // Modo de transporte en este punto (e.g., 'walking', 'driving')
  event?: any;      // Evento multimedia asociado (opcional)
  isGap?: boolean;  // Indica que este punto abre un salto/ruptura sin línea continua

  // Propiedades de Alta Fidelidad (hf)
  hfColor?: string;
  hfOpacity?: number;
  hfDashArray?: string | null;
  hfMode?: string;
  hfPhase?: string;
}

export interface AnimationStats {
  distanciaTotalKm: number;
  pasosTotales: number;
  tiempoTotalSeg: number;
}

@Injectable({
  providedIn: 'root'
})
export class GpxAnimationService {

  constructor() { }

  /**
   * Parsea el XML de un GPX y retorna una lista de puntos con métricas precalculadas.
   */
  parseGpx(gpxText: string): GpxPoint[] {
    const parser = new DOMParser();
    const gpxDoc = parser.parseFromString(gpxText, 'text/xml');
    const trkpts = gpxDoc.getElementsByTagName('trkpt');
    const points: GpxPoint[] = [];

    let distAcum = 0;
    let timeAcum = 0;
    let prevPoint: L.LatLng | null = null;
    let startTime: number | null = null;
    let lastKnownMode: string | undefined = undefined; // Propagar modo entre puntos contiguos

    for (let i = 0; i < trkpts.length; i++) {
      const lat = parseFloat(trkpts[i].getAttribute('lat') || '0');
      const lng = parseFloat(trkpts[i].getAttribute('lon') || '0');
      const eleEl = trkpts[i].getElementsByTagName('ele')[0];
      const timeEl = trkpts[i].getElementsByTagName('time')[0];

      if (lat === 0 || lng === 0) continue;

      const currentLatLng = { lat, lng };
      const currentTime = timeEl ? new Date(timeEl.textContent || '').getTime() : null;

      if (i === 0) {
        startTime = currentTime;
      }

      const isGapEl = trkpts[i].getElementsByTagName('isGap')[0];
      const isGapExplicit = isGapEl ? isGapEl.textContent === 'true' : false;

      const parentSeg = trkpts[i].parentElement;
      const isFirstInTrkseg = parentSeg && parentSeg.tagName === 'trkseg' && parentSeg.firstElementChild === trkpts[i];
      const isGap = (i > 0 && isFirstInTrkseg) || isGapExplicit;

      if (prevPoint && !isGap) {
        // Cálculo de distancia (fórmula Haversine simplificada)
        const d = this.getDistance(prevPoint.lat, prevPoint.lng, lat, lng);
        distAcum += d;
      }

      if (startTime !== null && currentTime !== null) {
        timeAcum = (currentTime - startTime) / 1000;
      } else if (prevPoint && !isGap) {
        // Si no hay timestamps, simulamos un tiempo basado en una velocidad media (5 km/h)
        const d = this.getDistance(prevPoint.lat, prevPoint.lng, lat, lng);
        timeAcum += (d / (5 / 3.6)); // v = d/t => t = d/v (5 km/h = 1.38 m/s)
      }

      const modeEl = trkpts[i].getElementsByTagName('transportMode')[0] ||
        trkpts[i].getElementsByTagName('profileId')[0] ||
        trkpts[i].getElementsByTagName('mode')[0] ||
        trkpts[i].getElementsByTagName('profileName')[0];

      // Si hay etiqueta de modo, actualizamos lastKnownMode; si no, propagamos el anterior
      if (modeEl && modeEl.textContent) {
        lastKnownMode = modeEl.textContent || undefined;
      }
      const transportMode = lastKnownMode;

      points.push({
        lat,
        lng,
        ele: eleEl ? parseFloat(eleEl.textContent || '0') : undefined,
        time: timeEl ? new Date(timeEl.textContent || '') : undefined,
        distAcum,
        timeAcum,
        mode: transportMode,
        hfMode: transportMode,
        isGap: isGap || undefined
      });

      prevPoint = currentLatLng as any;
    }


    return points;
  }

  /**
   * Sincroniza archivos multimedia con los puntos GPX.
   * Asocia cada archivo al punto más cercano por coordenadas o tiempo.
   */
  syncMultimedia(points: GpxPoint[], multimedia: any[]): GpxPoint[] {
    if (!multimedia || multimedia.length === 0 || !points || points.length === 0) return points;

    // Helper robusto para calcular el timestamp real (ms) de un archivo
    const getMediaTimestamp = (item: any): number => {
      let datePart = '';
      if (item.fechaCreacion) {
        datePart = item.fechaCreacion.split('T')[0];
      } else if (item.fecha) {
        datePart = item.fecha.split('T')[0];
      }
      if (!datePart) datePart = '1970-01-01';

      let timePart = item.horaCaptura;
      if (!timePart && item.fechaCreacion && item.fechaCreacion.includes('T')) {
        timePart = item.fechaCreacion.split('T')[1].split('.')[0];
      }
      if (!timePart && item.timestampReal) {
        timePart = item.timestampReal;
      }
      if (!timePart) timePart = '12:00:00';

      const fullIso = `${datePart}T${timePart}Z`;
      const dt = new Date(fullIso);
      return !isNaN(dt.getTime()) ? dt.getTime() : 0;
    };

    // 1. Asegurar que los puntos del track tengan timestamps coherentes
    let lastKnownTime = points[0]?.time ? points[0].time.getTime() : 0;
    for (let i = 0; i < points.length; i++) {
      const pTime = points[i]?.time;
      if (pTime && !isNaN(pTime.getTime())) {
        lastKnownTime = pTime.getTime();
      } else if (lastKnownTime > 0) {
        const prevPt = i > 0 ? points[i - 1] : null;
        const stepDist = (prevPt && points[i].distAcum !== undefined && prevPt.distAcum !== undefined)
          ? Math.max(0, points[i].distAcum - prevPt.distAcum)
          : 0;
        lastKnownTime += (stepDist / 14) * 1000;
        points[i].time = new Date(lastKnownTime);
      }
    }

    // 2. Ordenar archivos multimedia estrictamente por su timestamp real
    const sortedMedia = [...multimedia].sort((a, b) => getMediaTimestamp(a) - getMediaTimestamp(b));

    let lastMatchedTrackIdx = 0;

    sortedMedia.forEach(item => {
      let geoData: any;
      try {
        geoData = typeof item.geolocalizacion === 'string'
          ? JSON.parse(item.geolocalizacion)
          : item.geolocalizacion;
      } catch (e) {
        return;
      }

      const mLat = geoData?.latitud ?? geoData?.latitude;
      const mLng = geoData?.longitud ?? geoData?.longitude;
      const mTime = getMediaTimestamp(item);

      if (!mLat || !mLng || isNaN(mLat) || isNaN(mLng)) return;

      let bestIdx = -1;
      let minScore = Infinity;

      // Evaluar todos los puntos del track
      points.forEach((p, idx) => {
        const d = this.getDistance(p.lat, p.lng, mLat, mLng);

        let timeDiffMinutes = 0;
        if (mTime > 0 && p.time) {
          const ptTime = p.time.getTime();
          const diffMs = Math.min(
            Math.abs(ptTime - mTime),
            Math.abs(ptTime - (mTime + 3600000)),
            Math.abs(ptTime - (mTime - 3600000))
          );
          timeDiffMinutes = diffMs / 60000;
        }

        // Ponderar distancia + diferencia de tiempo + avance cronológico coherente
        const backwardPenalty = idx < lastMatchedTrackIdx ? (lastMatchedTrackIdx - idx) * 1.5 : 0;
        const timePenalty = (mTime > 0 && p.time) ? timeDiffMinutes * 20.0 : 0;
        const score = d + timePenalty + backwardPenalty;

        if (score < minScore) {
          minScore = score;
          bestIdx = idx;
        }
      });

      // Fallback: Si no encajó por score, asignar al punto más cercano puro
      if (bestIdx === -1) {
        let minD = Infinity;
        points.forEach((p, idx) => {
          const d = this.getDistance(p.lat, p.lng, mLat, mLng);
          if (d < minD) {
            minD = d;
            bestIdx = idx;
          }
        });
      }

      // Asociar evento al punto ganador
      if (bestIdx !== -1) {
        lastMatchedTrackIdx = Math.max(lastMatchedTrackIdx, bestIdx);
        if (!points[bestIdx].event) points[bestIdx].event = { archivos: [] };
        points[bestIdx].event.archivos.push(item);
        const orden = item.ordenVisita !== undefined ? item.ordenVisita : (item.orden !== undefined ? item.orden : null);
        if (orden !== null) {
          points[bestIdx].event.ordenVisita = orden;
        }
      }
    });

    return points;
  }

  /**
   * Asigna un modo de transporte a cada punto basado en la distancia acumulada.
   */
  applyTransportSegments(points: GpxPoint[], segments: any[]): GpxPoint[] {
    console.log('🔍 [GpxAnimationService] Procesando segmentos:', segments?.length || 0);

    if (points.length === 0) return points;

    // ✨ Asegurar que todos los puntos tengan distAcum calculada si falta
    let accumulatedDistance = 0;
    for (let i = 0; i < points.length; i++) {
      if (points[i].distAcum === undefined || points[i].distAcum === null) {
        if (i > 0) {
          accumulatedDistance += this.getDistance(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
        }
        points[i].distAcum = accumulatedDistance;
      } else {
        accumulatedDistance = points[i].distAcum!;
      }
    }

    // ✨ Preservar modos específicos ya existentes (como boat, walking, driving asignados por replaySegments)
    const hasSpecificModes = points.some(p => p.mode && p.mode !== 'walking');

    if (!segments || segments.length === 0) {
      if (!hasSpecificModes) {
        console.warn('⚠️ No hay segmentos de transporte definidos. Usando modo por defecto: walking');
        points.forEach(p => p.mode = 'walking');
      }
      return points;
    }

    // Si solo hay 1 segmento o acumulado = 0, y los puntos ya tienen modos específicos, respetarlos
    let totalDist = 0;
    segments.forEach(s => totalDist += (s.distanciaMetros || s.distance || 0));
    if (hasSpecificModes && (segments.length <= 1 || totalDist === 0)) {
      console.log('✨ Preservando modos de transporte específicos existentes en los puntos');
      return points;
    }

    let currentSegmentIdx = 0;
    let accumulatedSegmentDist = 0;

    // Preparar distancias de segmentos en metros con parseo robusto
    const segmentThresholds = segments.map((seg, idx) => {
      let rawDist = seg.distanciaMetros || seg.distance || 0;

      // Si no hay metros, intentar con km (que puede ser string "5.68" o "5,68")
      if (!rawDist && seg.distanciaKm) {
        const cleanKm = String(seg.distanciaKm).replace(',', '.');
        rawDist = parseFloat(cleanKm) * 1000;
      } else if (!rawDist && seg.distancia_metros) {
        rawDist = seg.distancia_metros;
      }

      accumulatedSegmentDist += Number(rawDist);

      // Normalizar el nombre del modo para facilitar el mapeo posterior
      let rawMode = (seg.tipo || seg.profileName || seg.nombre || seg.mode || 'walking').toLowerCase();
      const fullSegText = `${seg.nombre || ''} ${seg.profileName || ''} ${seg.tipo || ''} ${seg.mode || ''}`.toLowerCase();

      if (fullSegText.includes('coche') || fullSegText.includes('driving') || fullSegText.includes('car') || fullSegText.includes('auto')) {
        rawMode = 'driving';
      } else if (fullSegText.includes('boat') || fullSegText.includes('barco') || fullSegText.includes('ship') || fullSegText.includes('ferry') || fullSegText.includes('crucero')) {
        rawMode = 'boat';
      } else if (fullSegText.includes('bici') || fullSegText.includes('cycling') || fullSegText.includes('bicycle')) {
        rawMode = 'cycling';
      } else if (fullSegText.includes('bus') || fullSegText.includes('autobus')) {
        rawMode = 'bus';
      } else if (fullSegText.includes('run') || fullSegText.includes('correr')) {
        rawMode = 'running';
      } else if (fullSegText.includes('andando') || fullSegText.includes('walking') || fullSegText.includes('caminar')) {
        rawMode = 'walking';
      }

      console.log(`📏 Segmento ${idx}: ${rawMode} - Acumulado: ${accumulatedSegmentDist}m`);

      return {
        mode: rawMode,
        threshold: accumulatedSegmentDist
      };
    });

    points.forEach(p => {
      let assignedMode = segmentThresholds[0].mode;

      if (segmentThresholds.length === 2 && segmentThresholds[0].mode !== segmentThresholds[1].mode) {
        // Caso Ida en vehículo/transporte principal, caminata intermedia, y vuelta en vehículo/transporte principal
        const t0 = segmentThresholds[0].threshold; // Fin tramo 1 (Ida)
        const t1 = segmentThresholds[1].threshold; // Fin tramo 2 (Caminata/Intermedio)

        if (p.distAcum <= t0) {
          assignedMode = segmentThresholds[0].mode;
        } else if (p.distAcum > t0 && p.distAcum <= t1) {
          assignedMode = segmentThresholds[1].mode;
        } else {
          // Vuelta: se regresa en el transporte inicial (ej. Coche)
          assignedMode = segmentThresholds[0].mode;
        }
      } else {
        let segIdx = 0;
        while (segIdx < segmentThresholds.length - 1 && p.distAcum > segmentThresholds[segIdx].threshold) {
          segIdx++;
        }
        assignedMode = segmentThresholds[segIdx].mode;
      }

      p.mode = assignedMode;
      p.hfMode = assignedMode;
    });

    console.log(`✅ ${points.length} puntos GPX etiquetados con modos de transporte (Segmentos totales: ${segmentThresholds.length}).`);
    return points;
  }

  /**
   * Calcula distancia en metros entre dos puntos (Fórmula Haversine).
   */
  public getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Radio de la Tierra en metros
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
   * Retorna estadísticas finales.
   */
  getStats(points: GpxPoint[]): AnimationStats {
    if (points.length === 0) return { distanciaTotalKm: 0, pasosTotales: 0, tiempoTotalSeg: 0 };
    const last = points[points.length - 1];
    return {
      distanciaTotalKm: parseFloat((last.distAcum / 1000).toFixed(2)),
      pasosTotales: Math.round((last.distAcum / 1000) * 1400),
      tiempoTotalSeg: last.timeAcum
    };
  }

  /**
   * Decodifica Polyline de Google (Usado por OSRM)
   */
  public decodePolyline(str: string, precision: number = 5): [number, number][] {
    let index = 0, lat = 0, lng = 0;
    const coordinates: [number, number][] = [];
    let shift = 0, result = 0, byte = null, latitude_change, longitude_change;
    const factor = Math.pow(10, precision);

    while (index < str.length) {
      byte = null; shift = 0; result = 0;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
      shift = result = 0;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));

      lat += latitude_change;
      lng += longitude_change;
      coordinates.push([lat / factor, lng / factor]);
    }
    return coordinates;
  }

  /**
   * Interpola el tiempo y distancia cronológicamente para los puntos inyectados por OSRM
   */
  private interpolateTimesForOsrm(p1: GpxPoint, p2: GpxPoint, coords: [number, number][], targetNumPoints?: number): GpxPoint[] {
    if (!p1.time || !p2.time || coords.length === 0) return [];

    // ✨ DOWNSAMPLING: Reducir (o mantener) la cantidad de puntos de OSRM para que coincida con la densidad original
    let sampledCoords = coords;
    if (targetNumPoints && targetNumPoints > 0 && coords.length > targetNumPoints) {
      sampledCoords = [];
      const step = coords.length / targetNumPoints;
      for (let i = 0; i < targetNumPoints; i++) {
        sampledCoords.push(coords[Math.floor(i * step)]);
      }
    }

    const t1 = p1.time.getTime();
    const t2 = p2.time.getTime();
    const timeSpan = t2 - t1;

    // Calcular distancia total del tramo OSRM para interpolación proporcional
    const totalDist = sampledCoords.reduce((acc, curr, i) => {
      if (i === 0) return 0;
      return acc + this.getDistance(sampledCoords[i - 1][0], sampledCoords[i - 1][1], curr[0], curr[1]);
    }, 0);

    let distSum = 0;
    const newPoints: GpxPoint[] = [];

    // Omitimos el primero y último (son casi exactos a p1 y p2)
    for (let i = 1; i < sampledCoords.length - 1; i++) {
      const d = this.getDistance(sampledCoords[i - 1][0], sampledCoords[i - 1][1], sampledCoords[i][0], sampledCoords[i][1]);
      distSum += d;
      const ratio = totalDist > 0 ? (distSum / totalDist) : 0;

      const newTime = new Date(t1 + timeSpan * ratio);

      // ✨ INTERPOLACIÓN PURA DE MÉTRICAS (Basado en P1 y P2 originales, sin recalcular geográficamente los globales)
      const newDistAcum = p1.distAcum !== undefined && p2.distAcum !== undefined
        ? p1.distAcum + (p2.distAcum - p1.distAcum) * ratio
        : 0;

      const newTimeAcum = p1.timeAcum !== undefined && p2.timeAcum !== undefined
        ? p1.timeAcum + (p2.timeAcum - p1.timeAcum) * ratio
        : 0;

      newPoints.push({
        lat: sampledCoords[i][0],
        lng: sampledCoords[i][1],
        ele: p1.ele, // aproximado del anterior
        time: newTime,
        mode: p1.mode || 'driving',
        distAcum: newDistAcum, // ✨ Interpolado
        timeAcum: newTimeAcum, // ✨ Interpolado
        // ✨ HERENCIA DE ALTA FIDELIDAD
        hfColor: (p1 as any)?.hfColor,
        hfMode: (p1 as any)?.hfMode,
        hfPhase: (p1 as any)?.hfPhase,
        hfOpacity: (p1 as any)?.hfOpacity,
        hfDashArray: (p1 as any)?.hfDashArray
      });
    }
    return newPoints;
  }

  /**
   * Recupera la ruta desde OSRM o Caché Local
   */
  async getOsrmRoute(p1: GpxPoint, p2: GpxPoint, targetNumPoints?: number): Promise<GpxPoint[]> {
    const cacheKey = 'osrm_' + p1.lat + '_' + p1.lng + '_' + p2.lat + '_' + p2.lng;
    const cached = localStorage.getItem(cacheKey);

    if (cached) {
      console.log('⚡ [OSRM] Cache HIT para hueco ' + p1.lat.toFixed(3) + ',' + p1.lng.toFixed(3) + ' -> ' + p2.lat.toFixed(3) + ',' + p2.lng.toFixed(3));
      const parsed = JSON.parse(cached);
      return this.interpolateTimesForOsrm(p1, p2, parsed, targetNumPoints);
    }

    const t0 = performance.now();
    try {
      const url = 'https://router.project-osrm.org/route/v1/driving/' + p1.lng + ',' + p1.lat + ';' + p2.lng + ',' + p2.lat + '?overview=full';
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);

      const data = await res.json();
      const t1 = performance.now();
      console.log('🌐 [OSRM] Response ' + Math.round(t1 - t0) + 'ms -> Cache MISS');

      if (data.routes && data.routes.length > 0) {
        const poly = data.routes[0].geometry;
        const coords = this.decodePolyline(poly, 5);
        localStorage.setItem(cacheKey, JSON.stringify(coords));
        return this.interpolateTimesForOsrm(p1, p2, coords, targetNumPoints);
      }
    } catch (e) {
      console.warn('⚠️ [OSRM] Fallback activado (error red/API). Trazado recto matemático.', e);
    }
    return [];
  }

  /**
   * Recalcula distAcum y timeAcum para toda la lista después del Auto-Relleno.
   */
  recalculateAccumulators(points: GpxPoint[]): GpxPoint[] {
    if (points.length === 0) return points;

    let distAcum = 0;
    let startTime = points[0].time ? points[0].time.getTime() : null;
    let prev = points[0];
    prev.distAcum = 0;
    prev.timeAcum = 0;

    for (let i = 1; i < points.length; i++) {
      const curr = points[i];
      distAcum += this.getDistance(prev.lat, prev.lng, curr.lat, curr.lng);
      curr.distAcum = distAcum;
      if (startTime !== null && curr.time) {
        curr.timeAcum = (curr.time.getTime() - startTime) / 1000;
      } else {
        curr.timeAcum = prev.timeAcum + 1; // Fallback extremo
      }
      prev = curr;
    }
    return points;
  }
}
