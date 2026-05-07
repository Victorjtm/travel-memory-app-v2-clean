import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ViajesPrevistosService } from './viajes-previstos.service';
import { ViajePrevisto } from '../modelos/viaje-previsto.model';

@Injectable({
  providedIn: 'root'
})
export class GeolocalizacionViajesService {

  constructor(private viajesService: ViajesPrevistosService) { }

  /**
   * Obtiene todos los viajes que tienen coordenadas asignadas
   */
  getViajesMapeables(): Observable<ViajePrevisto[]> {
    console.log('[GeolocService] Obteniendo viajes mapeables...');
    return this.viajesService.obtenerViajes().pipe(
      map(viajes => viajes.filter(v => v.lat_representativa !== null && v.lat_representativa !== undefined))
    );
  }

  /**
   * Obtiene los viajes que no tienen coordenadas
   */
  getViajesSinUbicacion(): Observable<ViajePrevisto[]> {
    return this.viajesService.obtenerViajes().pipe(
      map(viajes => viajes.filter(v => v.lat_representativa === null || v.lat_representativa === undefined))
    );
  }

  /**
   * Dispara el cálculo de ubicación representativa para un viaje (Fase 2)
   */
  calcularUbicacionRepresentativa(viajeId: number): Observable<any> {
    console.log(`[GeolocService] Pendiente: Calcular ubicación para viaje ${viajeId}`);
    // Esto se conectará con el endpoint de server.js en la Fase 2
    return new Observable(subscriber => {
      subscriber.next({ success: true, message: 'Simulación de inicio de cálculo' });
      subscriber.complete();
    });
  }
}
