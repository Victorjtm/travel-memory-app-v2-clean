import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ActividadesDisponibles } from '../modelos/actividades-disponibles.model';
import { environment } from '../../environments/environment';
import { BaseHttpService } from './base-http.service';

@Injectable({
  providedIn: 'root'
})
export class ActividadesDisponiblesService extends BaseHttpService {
  private apiUrl = `${environment.apiUrl}/actividades-disponibles`;

  // Obtener todas las actividades disponibles
  obtenerTodos(): Observable<ActividadesDisponibles[]> {
    return this.get<ActividadesDisponibles[]>(this.apiUrl);
  }

  // Obtener actividad disponible por ID
  obtenerPorId(id: number): Observable<ActividadesDisponibles> {
    return this.get<ActividadesDisponibles>(`${this.apiUrl}/${id}`);
  }

  // Crear nueva actividad disponible
  crear(actividad: ActividadesDisponibles): Observable<ActividadesDisponibles> {
    return this.post<ActividadesDisponibles>(this.apiUrl, actividad);
  }

  // Actualizar actividad disponible existente
  actualizar(id: number, actividad: ActividadesDisponibles): Observable<any> {
    return this.put(`${this.apiUrl}/${id}`, actividad);
  }

  // Eliminar actividad disponible
  eliminar(id: number): Observable<any> {
    return this.delete(`${this.apiUrl}/${id}`);
  }

  // Obtener actividades disponibles por tipo de actividad
  getActividadesDisponibles(tipoActividadId: number): Observable<ActividadesDisponibles[]> {
    return this.get<ActividadesDisponibles[]>(`${this.apiUrl}?tipoActividadId=${tipoActividadId}`);
  }
}