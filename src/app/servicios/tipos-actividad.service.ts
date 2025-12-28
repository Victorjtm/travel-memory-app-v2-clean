import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { TipoActividad } from '../modelos/tipo-actividad.model';
import { environment } from '../../environments/environment';
import { BaseHttpService } from './base-http.service';

@Injectable({
  providedIn: 'root'
})
export class TiposActividadService extends BaseHttpService {
  private apiUrl = `${environment.apiUrl}/tipos-actividad`;

  // Obtener todos los tipos de actividad
  obtenerTodos(): Observable<TipoActividad[]> {
    return this.get<TipoActividad[]>(this.apiUrl);
  }

  // Crear nuevo tipo de actividad
  crear(tipo: TipoActividad): Observable<TipoActividad> {
    return this.post<TipoActividad>(this.apiUrl, tipo);
  }

  // Actualizar tipo de actividad existente
  actualizar(id: number, tipo: TipoActividad): Observable<any> {
    return this.put(`${this.apiUrl}/${id}`, tipo);
  }

  // Eliminar tipo de actividad
  eliminar(id: number): Observable<any> {
    return this.delete(`${this.apiUrl}/${id}`);
  }

  // Obtener tipo de actividad por ID
  obtenerPorId(id: number): Observable<TipoActividad> {
    return this.get<TipoActividad>(`${this.apiUrl}/${id}`);
  }

  // Método duplicado - mismo que obtenerTodos()
  // Mantenido por compatibilidad, pero podrías considerar eliminarlo
  getTiposActividad(): Observable<TipoActividad[]> {
    return this.get<TipoActividad[]>(this.apiUrl);
  }
}