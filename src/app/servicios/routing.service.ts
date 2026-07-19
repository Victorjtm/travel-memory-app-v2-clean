import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface RoutingResult {
  points: { lat: number; lng: number }[];
  distanceMeters: number;
  durationSeconds: number;
  profile: string;
}

/**
 * Servicio de routing agnóstico al proveedor.
 * Proveedor inicial: OSRM público (prototipo/prueba).
 *
 * Reglas operativas:
 * - Una sola petición activa por vez (mutex).
 * - La respuesta siempre fuerza A y B exactos en los extremos.
 * - Rechaza respuestas vacías, degeneradas o con < 2 puntos.
 */
@Injectable({ providedIn: 'root' })
export class RoutingService {

  private readonly OSRM_BASE = 'https://router.project-osrm.org/route/v1';

  private readonly SUPPORTED_PROFILES = ['driving', 'walking', 'cycling'];

  /** Mutex: true mientras hay una petición en vuelo. */
  private _requestInFlight = false;
  get isRequestInFlight(): boolean { return this._requestInFlight; }

  constructor(private http: HttpClient) {}

  /**
   * Calcula una ruta entre A y B usando OSRM.
   *
   * @param startLat  Latitud del ancla A.
   * @param startLng  Longitud del ancla A.
   * @param endLat    Latitud del ancla B.
   * @param endLng    Longitud del ancla B.
   * @param profile   Perfil de routing: 'driving' | 'walking' | 'cycling'.
   * @returns         Promesa con el resultado o null si falla.
   */
  async getRoute(
    startLat: number, startLng: number,
    endLat: number, endLng: number,
    profile: string = 'driving'
  ): Promise<RoutingResult | null> {

    // ── Validaciones previas ──────────────────────────────────
    if (this._requestInFlight) {
      console.warn('[RoutingService] Petición ya en curso. Ignorando solicitud duplicada.');
      return null;
    }

    if (!this.SUPPORTED_PROFILES.includes(profile)) {
      console.error(`[RoutingService] Perfil no soportado: "${profile}". Perfiles válidos: ${this.SUPPORTED_PROFILES.join(', ')}`);
      return null;
    }

    // ── Construir URL ─────────────────────────────────────────
    // OSRM espera coordenadas en formato lng,lat (GeoJSON order).
    const url = `${this.OSRM_BASE}/${profile}/${startLng},${startLat};${endLng},${endLat}`
      + `?overview=full&geometries=geojson`;

    this._requestInFlight = true;

    try {
      const response: any = await this.http.get(url).toPromise();

      // ── Validar respuesta ─────────────────────────────────
      if (!response || response.code !== 'Ok' || !response.routes || response.routes.length === 0) {
        console.error('[RoutingService] OSRM devolvió respuesta inválida:', response);
        return null;
      }

      const route = response.routes[0];
      const coordinates: number[][] = route.geometry?.coordinates;

      if (!coordinates || coordinates.length < 2) {
        console.error('[RoutingService] Respuesta OSRM con coordenadas insuficientes:', coordinates?.length ?? 0);
        return null;
      }

      // ── Convertir [lng, lat] → { lat, lng } ──────────────
      const points: { lat: number; lng: number }[] = coordinates.map(
        (coord: number[]) => ({ lat: coord[1], lng: coord[0] })
      );

      // ── Forzar extremos exactos (A y B del usuario) ──────
      points[0] = { lat: startLat, lng: startLng };
      points[points.length - 1] = { lat: endLat, lng: endLng };

      // ── Validación final ──────────────────────────────────
      if (points.length < 2) {
        console.error('[RoutingService] Ruta resultante degenerada (< 2 puntos).');
        return null;
      }

      return {
        points,
        distanceMeters: route.distance ?? 0,
        durationSeconds: route.duration ?? 0,
        profile
      };

    } catch (err) {
      console.error('[RoutingService] Error de red al consultar OSRM:', err);
      return null;

    } finally {
      this._requestInFlight = false;
    }
  }
}
