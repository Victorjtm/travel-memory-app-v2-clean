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

      if (prevPoint) {
        // Cálculo de distancia (fórmula Haversine simplificada o delegar en Leaflet si es posible)
        const d = this.getDistance(prevPoint.lat, prevPoint.lng, lat, lng);
        distAcum += d;
      }

      if (startTime !== null && currentTime !== null) {
        timeAcum = (currentTime - startTime) / 1000;
      } else if (prevPoint) {
        // Si no hay timestamps, simulamos un tiempo basado en una velocidad media (5 km/h)
        const d = this.getDistance(prevPoint.lat, prevPoint.lng, lat, lng);
        timeAcum += (d / (5 / 3.6)); // v = d/t => t = d/v (5 km/h = 1.38 m/s)
      }

      points.push({
        lat,
        lng,
        ele: eleEl ? parseFloat(eleEl.textContent || '0') : undefined,
        time: timeEl ? new Date(timeEl.textContent || '') : undefined,
        distAcum,
        timeAcum
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
    if (!multimedia || multimedia.length === 0) return points;

    multimedia.forEach(item => {
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
      const mTimeString = geoData?.timestamp || item.fechaCreacion;
      const mTime = mTimeString ? new Date(mTimeString).getTime() : null;

      let bestIdx = -1;
      let minDistance = Infinity;
      let minTimeDiff = Infinity;

      // Usar lógica de "Sincronización Inteligente"
      points.forEach((p, idx) => {
        // 1. Prioridad: Coincidencia Espacial (Si hay geolocalización)
        if (mLat && mLng) {
          const d = this.getDistance(p.lat, p.lng, mLat, mLng);
          
          if (d < 25) {
            // Caso A: No hay candidato previo o este es claramente mejor (>0.5m de margen)
            if (bestIdx === -1 || d < minDistance - 0.5) {
              bestIdx = idx;
              minDistance = d;
            } 
            // Caso B: Empate espacial (dentro de un margen de 2m) -> Desempate por tiempo
            else if (Math.abs(d - minDistance) < 2 && mTime && p.time) {
              const currentPtTime = p.time.getTime();
              const bestPtTime = points[bestIdx].time?.getTime() || 0;
              const currentDiff = Math.abs(currentPtTime - mTime);
              const bestDiff = Math.abs(bestPtTime - mTime);
              
              if (currentDiff < bestDiff) {
                bestIdx = idx;
                // No actualizamos minDistance aquí porque d es similar
              }
            }
          }
          
          // Actualizar minDistance global para el Fallback (Prioridad 3)
          if (d < minDistance) minDistance = d;
        }

        // 2. Prioridad: Coincidencia de Tiempo con OFFSET (Si aún no hay éxito espacial)
        // NOTA: Solo se evalúa si no se encontró un punto en el radio de 25m
        if (bestIdx === -1 && mTime && p.time) {
          const pt = p.time.getTime();
          const offsets = [0, 3600000, -3600000, 7200000, -7200000];
          offsets.forEach(off => {
            const diff = Math.abs(pt - (mTime + off));
            if (diff < minTimeDiff) minTimeDiff = diff;
            // Tolerancia de 1 minuto tras ajustar la hora
            if (diff < 60000 && (bestIdx === -1 || diff < minTimeDiff)) {
              bestIdx = idx;
            }
          });
        }
      });

      // 3. Fallback Espacial Grueso: Si nada encajó bien pero estamos a < 50m (margen máximo de error)
      if (bestIdx === -1 && minDistance < 50) {
        let fallbackIdx = -1;
        let dMin = Infinity;
        points.forEach((p, idx) => {
          if (mLat && mLng) {
            const d = this.getDistance(p.lat, p.lng, mLat, mLng);
            if (d < dMin) { dMin = d; fallbackIdx = idx; }
          }
        });
        bestIdx = fallbackIdx;
      }

      // Asociar evento al punto ganador
      if (bestIdx !== -1) {
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
    
    if (!segments || segments.length === 0) {
      console.warn('⚠️ No hay segmentos de transporte definidos. Usando modo por defecto: walking');
      points.forEach(p => p.mode = 'walking');
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
      const rawMode = (seg.tipo || seg.profileName || seg.nombre || 'walking').toLowerCase();
      
      console.log(`📏 Segmento ${idx}: ${rawMode} - Acumulado: ${accumulatedSegmentDist}m`);

      return {
        mode: rawMode,
        threshold: accumulatedSegmentDist
      };
    });

    points.forEach(p => {
      while (currentSegmentIdx < segmentThresholds.length - 1 && p.distAcum > segmentThresholds[currentSegmentIdx].threshold) {
        currentSegmentIdx++;
      }
      const mode = segmentThresholds[currentSegmentIdx].mode;
      p.mode = mode;
      
      // ✨ Si no tiene modo de alta fidelidad, asignamos este como base
      if (!p.hfMode) {
        p.hfMode = mode;
      }
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
        hfColor: p1.hfColor,
        hfMode: p1.hfMode,
        hfPhase: p1.hfPhase,
        hfOpacity: p1.hfOpacity,
        hfDashArray: p1.hfDashArray
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
