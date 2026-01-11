import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Actividad } from '../modelos/actividad.model';
import { environment } from '../../environments/environment';
import { BaseHttpService } from './base-http.service';

@Injectable({
  providedIn: 'root'
})
export class ActividadService extends BaseHttpService {

  private apiUrl = `${environment.apiUrl}/actividades`;

  // Obtener todas las actividades (opcionalmente filtradas por viaje o itinerario)
  getActividades(params?: { viajePrevistoId?: number; itinerarioId?: number }): Observable<Actividad[]> {
    let url = this.apiUrl;

    if (params?.itinerarioId) {
      url += `?itinerarioId=${params.itinerarioId}`;
    } else if (params?.viajePrevistoId) {
      url += `?viajePrevistoId=${params.viajePrevistoId}`;
    }

    return this.get<Actividad[]>(url);
  }

  // Obtener actividad por ID
  getActividadPorId(id: number): Observable<Actividad> {
    return this.get<Actividad>(`${this.apiUrl}/${id}`);
  }

  // Crear nueva actividad
  crearActividad(actividad: Omit<Actividad, 'id'>): Observable<{ id: number }> {
    return this.post<{ id: number }>(this.apiUrl, actividad);
  }

  // Actualizar actividad
  actualizarActividad(id: number, actividad: Partial<Actividad>): Observable<any> {
    return this.put(`${this.apiUrl}/${id}`, actividad);
  }

  // Eliminar actividad
  eliminarActividad(id: number): Observable<any> {
    return this.delete(`${this.apiUrl}/${id}`);
  }
}