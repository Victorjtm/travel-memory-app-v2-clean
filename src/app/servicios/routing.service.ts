import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { seaRoute } from 'searoute-ts';
import greatCircle from '@turf/great-circle';

export interface RoutingResult {
  points: { lat: number; lng: number }[];
  distanceMeters: number;
  durationSeconds: number;
  profile: string;
}

/**
 * Servicio de routing agnóstico al proveedor.
 */
@Injectable({ providedIn: 'root' })
export class RoutingService {

  private readonly OSRM_BASE = 'https://router.project-osrm.org/route/v1';

  private readonly SUPPORTED_PROFILES = ['driving', 'walking', 'cycling', 'bus', 'boat', 'plane', 'train'];

  private _requestInFlight = false;
  get isRequestInFlight(): boolean { return this._requestInFlight; }

  constructor(private http: HttpClient) {}

  // Calcula la distancia Haversine en metros
  private getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Radio de la Tierra en metros
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async getRoute(
    startLat: number, startLng: number,
    endLat: number, endLng: number,
    profile: string = 'driving'
  ): Promise<RoutingResult | null> {

    if (this._requestInFlight) {
      console.warn('[RoutingService] Petición ya en curso. Ignorando solicitud duplicada.');
      return null;
    }

    if (!this.SUPPORTED_PROFILES.includes(profile)) {
      console.error(`[RoutingService] Perfil no soportado: "${profile}". Perfiles válidos: ${this.SUPPORTED_PROFILES.join(', ')}`);
      return null;
    }

    this._requestInFlight = true;

    try {
      // ── BARCO (searoute-ts) ──────────────────────────────────
      if (profile === 'boat') {
        const origin = [startLng, startLat];
        const destination = [endLng, endLat];
        
        // seaRoute devuelve un GeoJSON Feature (LineString)
        const result = seaRoute(origin, destination);
        
        if (!result || !result.geometry || !result.geometry.coordinates || result.geometry.coordinates.length < 2) {
          throw new Error('No se pudo calcular la ruta marítima.');
        }

        const points = result.geometry.coordinates.map((coord: any) => ({
          lat: coord[1], lng: coord[0]
        }));
        
        // Asegurar que conectan exactamente con los anclajes del usuario
        points[0] = { lat: startLat, lng: startLng };
        points[points.length - 1] = { lat: endLat, lng: endLng };

        // length devuelve longitud en km
        const distanceMeters = (result.properties?.length || 0) * 1000;

        return {
          points,
          distanceMeters,
          durationSeconds: 0,
          profile
        };
      }

      // ── AVIÓN (turf great-circle) ────────────────────────────
      if (profile === 'plane') {
        const origin = [startLng, startLat];
        const destination = [endLng, endLat];
        
        const gc = greatCircle(origin, destination);
        const points = gc.geometry.coordinates.map((coord: any) => ({
          lat: coord[1], lng: coord[0]
        }));

        points[0] = { lat: startLat, lng: startLng };
        points[points.length - 1] = { lat: endLat, lng: endLng };

        const distanceMeters = this.getDistance(startLat, startLng, endLat, endLng);

        return {
          points,
          distanceMeters,
          durationSeconds: 0, // Podría estimarse a 900km/h
          profile
        };
      }

      // ── TREN (Línea recta) ───────────────────────────────────
      if (profile === 'train') {
        const points = [
          { lat: startLat, lng: startLng },
          { lat: endLat, lng: endLng }
        ];
        return {
          points,
          distanceMeters: this.getDistance(startLat, startLng, endLat, endLng),
          durationSeconds: 0,
          profile
        };
      }

      // ── OSRM (driving, walking, cycling, bus) ────────────────
      const osrmProfile = profile === 'bus' ? 'driving' : profile;
      const url = `${this.OSRM_BASE}/${osrmProfile}/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;

      const response: any = await this.http.get(url).toPromise();

      if (!response || response.code !== 'Ok' || !response.routes || response.routes.length === 0) {
        throw new Error('OSRM devolvió respuesta inválida');
      }

      const route = response.routes[0];
      const coordinates: number[][] = route.geometry?.coordinates;

      if (!coordinates || coordinates.length < 2) {
        throw new Error('Respuesta OSRM con coordenadas insuficientes');
      }

      const points = coordinates.map((coord: number[]) => ({ lat: coord[1], lng: coord[0] }));
      points[0] = { lat: startLat, lng: startLng };
      points[points.length - 1] = { lat: endLat, lng: endLng };

      return {
        points,
        distanceMeters: route.distance ?? 0,
        durationSeconds: route.duration ?? 0,
        profile
      };

    } catch (err) {
      console.error(`[RoutingService] Error calculando ruta para ${profile}:`, err);
      return null;
    } finally {
      this._requestInFlight = false;
    }
  }
}
