import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, catchError } from 'rxjs';
import { map } from 'rxjs/operators';

export interface UbicacionReversa {
  ciudad?: string;
  region?: string;
  pais?: string;
  direccion?: string;
  nombreCompleto?: string;
}

@Injectable({
  providedIn: 'root'
})
export class GeocodificacionService {
  
  private readonly CACHE_KEY = 'geocoding_cache';
  private cache = new Map<string, UbicacionReversa>();
  
  constructor(private http: HttpClient) {
    this.cargarCacheDelStorage();
  }

  /**
   * Convierte coordenadas a información de ubicación
   */
  obtenerUbicacionPorCoordenadas(coordenadas: string): Observable<UbicacionReversa | null> {
    const coords = this.parsearCoordenadas(coordenadas);
    if (!coords) {
      return of(null);
    }

    const cacheKey = `${coords.lat},${coords.lon}`;
    
    // Verificar cache primero
    if (this.cache.has(cacheKey)) {
      return of(this.cache.get(cacheKey)!);
    }

    // Llamar a la API de OpenStreetMap (Nominatim)
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.lat}&lon=${coords.lon}&addressdetails=1`;
    
    return this.http.get<any>(url).pipe(
      map(response => {
        const ubicacion = this.procesarRespuestaNominatim(response);
        if (ubicacion) {
          this.cache.set(cacheKey, ubicacion);
          this.guardarCacheEnStorage();
        }
        return ubicacion;
      }),
      catchError(error => {
        console.error('Error en geocodificación:', error);
        return of(null);
      })
    );
  }

  /**
   * Parsea coordenadas desde string
   */
  private parsearCoordenadas(coordenadas: string): { lat: number, lon: number } | null {
    try {
      // Formatos soportados: "lat,lon" o "lat, lon"
      const partes = coordenadas.split(',').map(s => s.trim());
      if (partes.length !== 2) return null;
      
      const lat = parseFloat(partes[0]);
      const lon = parseFloat(partes[1]);
      
      if (isNaN(lat) || isNaN(lon)) return null;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
      
      return { lat, lon };
    } catch {
      return null;
    }
  }

  /**
   * Procesa la respuesta de la API de Nominatim
   */
  private procesarRespuestaNominatim(response: any): UbicacionReversa | null {
    if (!response || !response.address) return null;
    
    const address = response.address;
    const ubicacion: UbicacionReversa = {};
    
    // Extraer información relevante
    ubicacion.ciudad = address.city || address.town || address.village || address.municipality;
    ubicacion.region = address.state || address.province || address.region;
    ubicacion.pais = address.country;
    ubicacion.direccion = response.display_name;
    
    // Crear nombre completo simplificado
    const partes = [];
    if (ubicacion.ciudad) partes.push(ubicacion.ciudad);
    if (ubicacion.region && ubicacion.region !== ubicacion.ciudad) partes.push(ubicacion.region);
    if (ubicacion.pais) partes.push(ubicacion.pais);
    
    ubicacion.nombreCompleto = partes.join(', ');
    
    return ubicacion.nombreCompleto ? ubicacion : null;
  }
/**
 * Obtiene un nombre corto para mostrar en la UI
 */
obtenerNombreCorto(ubicacion: UbicacionReversa): string {
  // Priorizar ciudad y región para mayor especificidad
  const partes = [];
  
  if (ubicacion.ciudad) {
    partes.push(ubicacion.ciudad);
  }
  
  // Solo añadir región si es diferente a la ciudad
  if (ubicacion.region && ubicacion.region !== ubicacion.ciudad) {
    partes.push(ubicacion.region);
  }
  
  // Fallback si no hay ciudad ni región
  if (partes.length === 0) {
    if (ubicacion.pais) return ubicacion.pais;
    return 'Ubicación';
  }
  
  return partes.join(', ');
} 

  /**
   * Cache management
   */
  private cargarCacheDelStorage(): void {
    try {
      const cacheData = localStorage.getItem(this.CACHE_KEY);
      if (cacheData) {
        const parsedCache = JSON.parse(cacheData);
        this.cache = new Map(Object.entries(parsedCache));
      }
    } catch (error) {
      console.warn('Error al cargar cache de geocodificación:', error);
    }
  }

  private guardarCacheEnStorage(): void {
    try {
      const cacheObj = Object.fromEntries(this.cache);
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(cacheObj));
    } catch (error) {
      console.warn('Error al guardar cache de geocodificación:', error);
    }
  }

  /**
   * Limpia el cache (útil para desarrollo)
   */
  limpiarCache(): void {
    this.cache.clear();
    localStorage.removeItem(this.CACHE_KEY);
  }
}