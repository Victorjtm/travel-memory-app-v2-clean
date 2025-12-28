import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { BaseHttpService } from './base-http.service';

@Injectable({
  providedIn: 'root'
})
export class ViajesPrevistosService extends BaseHttpService {
  private apiUrl = `${environment.apiUrl}/viajes`;

  // Obtener un viaje por id
  obtenerViaje(id: number): Observable<any> {
    console.log('[ViajesService] GET viaje por ID:', id);
    return this.get<any>(`${this.apiUrl}/${id}`);
  }

  // Obtener todos los viajes previstos
  obtenerViajes(): Observable<any[]> {
    console.log('[ViajesService] GET todos los viajes desde:', this.apiUrl);
    return this.get<any[]>(this.apiUrl);
  }

  // Crear un nuevo viaje previsto CON IMAGEN Y AUDIO
  crearViaje(viaje: any, imagen?: File, audio?: File): Observable<any> {
    const formData = new FormData();

    // Agregar todos los campos del viaje al FormData
    formData.append('nombre', viaje.nombre);
    formData.append('destino', viaje.destino);
    formData.append('fecha_inicio', viaje.fecha_inicio);
    formData.append('fecha_fin', viaje.fecha_fin);
    formData.append('descripcion', viaje.descripcion || '');

    // Si hay imagen, agregarla
    if (imagen) {
      formData.append('imagen', imagen);
    }

    // Si hay audio, agregarlo
    if (audio) {
      formData.append('audio', audio);
    }

    console.log('[ViajesService] POST nuevo viaje');
    return this.postFormData<any>(this.apiUrl, formData);
  }

  // Actualizar un viaje previsto CON IMAGEN Y AUDIO
  actualizarViaje(id: number, viaje: any, imagen?: File, audio?: File): Observable<any> {
    const formData = new FormData();

    // Agregar todos los campos del viaje al FormData
    formData.append('nombre', viaje.nombre);
    formData.append('destino', viaje.destino);
    formData.append('fecha_inicio', viaje.fecha_inicio);
    formData.append('fecha_fin', viaje.fecha_fin);
    formData.append('descripcion', viaje.descripcion || '');
    formData.append('imagen_actual', viaje.imagen || ''); // Para mantener imagen actual si no se cambia
    formData.append('audio_actual', viaje.audio || ''); // Para mantener audio actual si no se cambia

    // Si hay nueva imagen, agregarla
    if (imagen) {
      formData.append('imagen', imagen);
    }

    // Si hay nuevo audio, agregarlo
    if (audio) {
      formData.append('audio', audio);
    }

    console.log('[ViajesService] PUT actualizar viaje ID:', id);
    return this.putFormData<any>(`${this.apiUrl}/${id}`, formData);
  }

  // Eliminar un viaje previsto
  eliminarViaje(id: number): Observable<any> {
    console.log('[ViajesService] DELETE viaje ID:', id);
    return this.delete<any>(`${this.apiUrl}/${id}`);
  }

  // Unificar viajes con el mismo destino
  unificarViajes(): Observable<any> {
    console.log('[ViajesService] POST unificar viajes');
    return this.post<any>(`${this.apiUrl}/unificar`, {});
  }

}