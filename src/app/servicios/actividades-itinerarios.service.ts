import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { BaseHttpService } from './base-http.service';

@Injectable({
  providedIn: 'root'
})
export class ActividadesItinerariosService extends BaseHttpService {
  private apiUrl = `${environment.apiUrl}/actividades`;

  constructor(protected override http: HttpClient) {
    super(http);
  }

  create(actividad: any): Observable<any> {
    return this.post(this.apiUrl, actividad);
  }

  update(id: number, actividad: any): Observable<any> {
    return this.put(`${this.apiUrl}/${id}`, actividad);
  }

  getActividades(): Observable<any[]> {
    return this.get<any[]>(this.apiUrl);
  }

  getById(id: number): Observable<any> {
    return this.get(`${this.apiUrl}/${id}`);
  }

  getByItinerario(itinerarioId: number): Observable<any[]> {
    return this.get<any[]>(`${this.apiUrl}?itinerarioId=${itinerarioId}`);
  }

  getByViajeYItinerario(viajePrevistoId: number, itinerarioId: number): Observable<any[]> {
    return this.get<any[]>(`${this.apiUrl}?viajePrevistoId=${viajePrevistoId}&itinerarioId=${itinerarioId}`);
  }

  eliminar(id: number): Observable<any> {
    return this.delete(`${this.apiUrl}/${id}`);
  }

  // ✨ NUEVOS MÉTODOS
  obtenerGPX(id: number): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${id}/gpx`, { responseType: 'blob' });
  }

  obtenerMapa(id: number): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${id}/mapa`, { responseType: 'blob' });
  }

  obtenerEstadisticas(id: number): Observable<any> {
    return this.get(`${this.apiUrl}/${id}/estadisticas`);
  }
}
