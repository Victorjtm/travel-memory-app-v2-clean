import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { BaseHttpService } from './base-http.service';

export interface UbicacionViaje {
  id: number;
  nombre?: string;
  destino?: string;
  lat_representativa: number | null;
  lng_representativa: number | null;
  metodo_calculo?: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class GeolocalizacionViajesService extends BaseHttpService {
  private viajesUrl = `${environment.apiUrl}/viajes`;
  private adminUrl = `${environment.apiUrl}/api/admin`;

  calcularUbicacionViaje(viajeId: number): Observable<any> {
    return this.post<any>(`${this.viajesUrl}/${viajeId}/calcular-ubicacion`, {});
  }

  migrarUbicacionesViajes(): Observable<any> {
    return this.post<any>(`${this.adminUrl}/migrar-viajes-ubicaciones`, {});
  }

  obtenerViajesConUbicacion(): Observable<UbicacionViaje[]> {
    return this.get<UbicacionViaje[]>(this.viajesUrl).pipe(
      map(viajes =>
        (viajes || []).filter(v =>
          Number.isFinite(v?.lat_representativa as number) &&
          Number.isFinite(v?.lng_representativa as number)
        )
      )
    );
  }

  obtenerCentro(viajes: UbicacionViaje[]): { lat: number; lng: number } {
    if (!viajes.length) {
      return { lat: 40.4168, lng: -3.7038 };
    }

    const acumulado = viajes.reduce(
      (acc, viaje) => ({
        lat: acc.lat + (viaje.lat_representativa ?? 0),
        lng: acc.lng + (viaje.lng_representativa ?? 0)
      }),
      { lat: 0, lng: 0 }
    );

    return {
      lat: acumulado.lat / viajes.length,
      lng: acumulado.lng / viajes.length
    };
  }
}
