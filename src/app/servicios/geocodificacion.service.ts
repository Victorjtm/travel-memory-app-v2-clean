import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, catchError } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface UbicacionReversa {
  ciudad?: string;
  region?: string;
  pais?: string;
  direccion?: string;
  nombreCompleto?: string;
}

export interface InfoUbicacionRuta {
  calle?: string;
  pueblo?: string;
  provincia?: string;
  pais?: string;
  linea1: string;          // Dirección / Calle / Lugar (o Pueblo si no hay calle)
  linea2: string;          // "Pueblo (Provincia)" o "Provincia"
  nombreCompleto: string;  // Texto en 1 línea para metadatos
}

@Injectable({
  providedIn: 'root'
})
export class GeocodificacionService {
  
  private readonly CACHE_KEY = 'geocoding_cache';
  private readonly CACHE_INFO_KEY = 'geocoding_info_ruta_cache_v2';
  private cache = new Map<string, UbicacionReversa>();
  private cacheInfoRuta = new Map<string, InfoUbicacionRuta>();
  private nominatimCola: Promise<any> = Promise.resolve();
  
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

    // Llamar al endpoint proxy con caché en backend (evita CORS y 429 de OSM)
    const url = `${environment.apiUrl}/api/geocodificacion/reverse?lat=${coords.lat}&lon=${coords.lon}&addressdetails=1`;
    
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
    
    ubicacion.ciudad = address.city || address.town || address.village || address.municipality || address.hamlet;
    ubicacion.region = address.province || address.state_district || address.state || address.region;
    ubicacion.pais = address.country;
    ubicacion.direccion = response.display_name;
    
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
    const partes = [];
    if (ubicacion.ciudad) partes.push(ubicacion.ciudad);
    if (ubicacion.region && ubicacion.region !== ubicacion.ciudad) partes.push(ubicacion.region);
    if (partes.length === 0) {
      if (ubicacion.pais) return ubicacion.pais;
      return 'Ubicación';
    }
    return partes.join(', ');
  } 

  /**
   * Extrae la información estructurada de ubicación (Calle/Vía, Pueblo/Localidad y Provincia)
   * optimizada para las tarjetas de Salida (Punto A) y Llegada (Punto B) del vídeo animado de ruta.
   */
  async obtenerInfoUbicacionPunto(lat: number, lng: number): Promise<InfoUbicacionRuta> {
    const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (this.cacheInfoRuta.has(cacheKey)) {
      return this.cacheInfoRuta.get(cacheKey)!;
    }

    const fallbackInfo: InfoUbicacionRuta = {
      linea1: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      linea2: '',
      nombreCompleto: `${lat.toFixed(4)}, ${lng.toFixed(4)}`
    };

    try {
      // Consulta al backend con caché SQLite/RAM y proxy a Nominatim
      const resp = await new Promise<any>((resolve, reject) => {
        this.nominatimCola = this.nominatimCola
          .then(() => new Promise(r => setTimeout(r, 60)))
          .then(async () => {
            const url = `${environment.apiUrl}/api/geocodificacion/reverse?lat=${lat}&lon=${lng}&addressdetails=1&accept-language=es`;
            const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          })
          .then(resolve)
          .catch(reject);
      });

      if (resp && resp.address) {
        const info = this.extraerInfoRutaDesdeNominatim(resp);
        this.cacheInfoRuta.set(cacheKey, info);
        this.guardarCacheEnStorage();
        return info;
      }
    } catch (e) {
      console.warn(`⚠️ [Geocodificacion] Error al resolver (${lat}, ${lng}):`, e);
    }

    return fallbackInfo;
  }

  /**
   * Procesa la respuesta de Nominatim aislando calle, pueblo y provincia.
   */
  private extraerInfoRutaDesdeNominatim(resp: any): InfoUbicacionRuta {
    const addr = resp.address || {};

    // 1. Calle / Vía o PDI relevante
    const via = addr.road || addr.pedestrian || addr.path || addr.footway || addr.street ||
                addr.amenity || addr.shop || addr.tourism || addr.building || addr.leisure || '';
    const num = addr.house_number ? `, ${addr.house_number}` : '';
    const calle = via ? `${via}${num}` : '';

    // 2. Pueblo / Localidad / Ciudad
    const pueblo = addr.village || addr.town || addr.city || addr.municipality ||
                   addr.hamlet || addr.suburb || addr.neighbourhood || addr.parish || '';

    // 3. Provincia (en España: province / state_district es la provincia ej. Castellón, Madrid, Burgos;
    // state suele ser la Comunidad Autónoma ej. Comunidad Valenciana)
    const provincia = addr.province || addr.state_district || addr.county || addr.state || '';
    const pais = addr.country || '';

    // Formatear líneas para la tarjeta del mapa:
    // Línea 1: Vía/Calle (o Pueblo si no hay calle registrada)
    // Línea 2: Pueblo y Provincia
    let linea1 = '';
    let linea2 = '';

    if (calle && pueblo) {
      linea1 = calle;
      linea2 = (provincia && provincia.toLowerCase() !== pueblo.toLowerCase())
        ? `${pueblo} (${provincia})`
        : pueblo;
    } else if (calle && !pueblo) {
      linea1 = calle;
      linea2 = provincia || pais || '';
    } else if (!calle && pueblo) {
      linea1 = pueblo;
      linea2 = (provincia && provincia.toLowerCase() !== pueblo.toLowerCase())
        ? provincia
        : (pais || '');
    } else if (provincia) {
      linea1 = provincia;
      linea2 = pais || '';
    } else {
      linea1 = resp.display_name ? resp.display_name.split(',')[0] : 'Ubicación';
      linea2 = '';
    }

    const partesTotales = [calle, pueblo, provincia].filter(Boolean);
    const nombreCompleto = partesTotales.join(', ') || linea1;

    return {
      calle,
      pueblo,
      provincia,
      pais,
      linea1,
      linea2,
      nombreCompleto
    };
  }

  /**
   * Parsea un texto plano de dirección ya disponible en `linea1` y `linea2`
   */
  parsearDireccionTexto(texto: string): InfoUbicacionRuta {
    if (!texto) {
      return { linea1: '', linea2: '', nombreCompleto: '' };
    }
    const partes = texto.split(',').map(s => s.trim()).filter(Boolean);
    if (partes.length === 0) {
      return { linea1: texto, linea2: '', nombreCompleto: texto };
    }
    if (partes.length === 1) {
      return { linea1: partes[0], linea2: '', nombreCompleto: partes[0] };
    }
    if (partes.length === 2) {
      return { linea1: partes[0], linea2: partes[1], nombreCompleto: texto };
    }
    // 3 o más partes: ej. "Calle Mayor 10", "Alcossebre (Castellón)"
    const linea1 = partes[0];
    const linea2 = `${partes[1]} (${partes.slice(2).join(', ')})`;
    return {
      calle: partes[0],
      pueblo: partes[1],
      provincia: partes.slice(2).join(', '),
      linea1,
      linea2,
      nombreCompleto: texto
    };
  }

  /**
   * Geocodificación inversa directa por lat/lng (versión compatible hacia atrás).
   * Devuelve string completo formateado.
   */
  async geocodificarLatLng(lat: number, lng: number): Promise<string> {
    const info = await this.obtenerInfoUbicacionPunto(lat, lng);
    return info?.nombreCompleto || '';
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
      const cacheInfoData = localStorage.getItem(this.CACHE_INFO_KEY);
      if (cacheInfoData) {
        const parsedInfo = JSON.parse(cacheInfoData);
        this.cacheInfoRuta = new Map(Object.entries(parsedInfo));
      }
    } catch (error) {
      console.warn('Error al cargar cache de geocodificación:', error);
    }
  }

  private guardarCacheEnStorage(): void {
    try {
      const cacheObj = Object.fromEntries(this.cache);
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(cacheObj));
      const cacheInfoObj = Object.fromEntries(this.cacheInfoRuta);
      localStorage.setItem(this.CACHE_INFO_KEY, JSON.stringify(cacheInfoObj));
    } catch (error) {
      console.warn('Error al guardar cache de geocodificación:', error);
    }
  }

  /**
   * Limpia el cache (útil para desarrollo)
   */
  limpiarCache(): void {
    this.cache.clear();
    this.cacheInfoRuta.clear();
    localStorage.removeItem(this.CACHE_KEY);
    localStorage.removeItem(this.CACHE_INFO_KEY);
  }
}