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
  crearItinerario(itinerario: Omit<Itinerario, 'id'>): Observable<Itinerario> {
    return this.post<Itinerario>(this.apiUrl, itinerario);
  }

  // Actualizar un itinerario
  actualizarItinerario(id: number, itinerario: Itinerario): Observable<any> {
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
}