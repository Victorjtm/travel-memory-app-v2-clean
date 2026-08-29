import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Itinerario } from '../modelos/viaje-previsto.model';
import { environment } from '../../environments/environment';
import { BaseHttpService } from './base-http.service';

@Injectable({
  providedIn: 'root'
})
export class ItinerarioService extends BaseHttpService {

  private apiUrl = `${environment.apiUrl}/itinerarios`;



  // Obtener todos los itinerarios
  getItinerarios(viajePrevistoId?: number): Observable<Itinerario[]> {
    const url = viajePrevistoId ? `${this.apiUrl}?viajePrevistoId=${viajePrevistoId}` : this.apiUrl;
    return this.get<Itinerario[]>(url);

  }

  // Crear un nuevo itinerario
  crearItinerario(itinerario: Omit<Itinerario, 'id'>, audio?: File): Observable<Itinerario> {
    if (audio) {
      const formData = new FormData();
      Object.keys(itinerario).forEach(key => {
        const value = (itinerario as any)[key];
        if (value !== undefined && value !== null) {
          formData.append(key, typeof value === 'object' ? JSON.stringify(value) : value);
        }
      });
      formData.append('audio', audio);
      return this.postFormData<Itinerario>(this.apiUrl, formData);
    }
    return this.post<Itinerario>(this.apiUrl, itinerario);
  }

  // Actualizar un itinerario
  actualizarItinerario(id: number, itinerario: Itinerario, audio?: File): Observable<any> {
    if (audio) {
      const formData = new FormData();
      Object.keys(itinerario).forEach(key => {
        const value = (itinerario as any)[key];
        if (value !== undefined && value !== null) {
          formData.append(key, typeof value === 'object' ? JSON.stringify(value) : value);
        }
      });
      formData.append('audio_actual', itinerario.audio || '');
      formData.append('audio', audio);
      return this.putFormData(`${this.apiUrl}/${id}`, formData);
    }
    return this.put(`${this.apiUrl}/${id}`, itinerario);
  }

  // Eliminar un itinerario
  eliminarItinerario(id: number): Observable<any> {
    return this.delete(`${this.apiUrl}/${id}`);
  }

  // Obtener itinerario por ID
  getById(id: number): Observable<Itinerario> {
    return this.get<Itinerario>(`${this.apiUrl}/${id}`);
  }

  // Obtener datos del ItinerarioGeneral (descripcionGeneral, etc.)
  obtenerItinerarioGeneral(itinerarioId: number): Observable<any> {
    return this.getById(itinerarioId); // Usa el método que ya tienes
  }

  // Unificar itinerarios del mismo día
  unificarItinerarios(viajeId: number, opcion: 'A' | 'B'): Observable<any> {
    return this.post(`${environment.apiUrl}/viajes/${viajeId}/unificar-itinerarios`, { opcion });
  }
}