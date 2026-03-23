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

      const mLat = geoData.latitud ?? geoData.latitude;
      const mLng = geoData.longitud ?? geoData.longitude;
      const mTime = geoData.timestamp ? new Date(geoData.timestamp).getTime() : null;

      if (!mLat || !mLng) return;

      // Buscar el punto más cercano
      let minIdx = -1;
      let minVal = Infinity;

      points.forEach((p, idx) => {
        // Prioridad 1: Tiempo (si ambos tienen)
        if (mTime && p.time) {
          const diff = Math.abs(p.time.getTime() - mTime);
          if (diff < minVal) {
            minVal = diff;
            minIdx = idx;
          }
        } else {
          // Prioridad 2: Distancia GPS
          const d = this.getDistance(p.lat, p.lng, mLat, mLng);
          if (d < minVal) {
            minVal = d;
            minIdx = idx;
          }
        }
      });

      // Si el punto más cercano está a menos de 50 metros o el tiempo es muy cercano (10s)
      const isCloseEnough = (mTime && points[minIdx].time) ? minVal < 10000 : minVal < 50;

      if (minIdx !== -1 && isCloseEnough) {
        if (!points[minIdx].event) points[minIdx].event = { archivos: [] };
        points[minIdx].event.archivos.push(item);
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
      p.mode = segmentThresholds[currentSegmentIdx].mode;
    });

    console.log(`✅ ${points.length} puntos GPX etiquetados con modos de transporte.`);
    return points;
  }

  /**
   * Calcula distancia en metros entre dos puntos (Fórmula Haversine).
   */
  private getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
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
}
