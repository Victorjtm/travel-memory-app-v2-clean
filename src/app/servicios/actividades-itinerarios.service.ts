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

  obtenerVisualSession(id: number): Observable<any> {
    return this.get(`${this.apiUrl}/${id}/visual-session`);
  }

  // 🎬 MÉTODOS VÍDEO POR SUBTRAMOS (TRAVEL MEMORY)
  obtenerVideoSubtramo(id: number, origen: number, destino: number): Observable<{ existe: boolean; url: string | null; rutaRelativa?: string }> {
    return this.get(`${this.apiUrl}/${id}/subtramos/video?origen=${origen}&destino=${destino}`);
  }

  obtenerVideosSubtramos(id: number): Observable<{ success: boolean; videos: Array<{ id_parada_origen: number; id_parada_destino: number; url: string }> }> {
    return this.get(`${this.apiUrl}/${id}/subtramos/videos`);
  }

  subirVideoSubtramo(
    id: number,
    origen: number,
    destino: number,
    videoBlob: Blob,
    duracionSegundos?: number,
    fps?: number
  ): Observable<{ success: boolean; url: string; rutaRelativa?: string }> {
    const formData = new FormData();
    formData.append('video', videoBlob, `ruta_${id}_origen_${origen}_destino_${destino}.mp4`);
    formData.append('idParadaOrigen', origen.toString());
    formData.append('idParadaDestino', destino.toString());
    if (duracionSegundos && duracionSegundos > 0) {
      formData.append('duracionSegundos', duracionSegundos.toString());
    }
    if (fps && fps > 0) {
      formData.append('fps', fps.toString());
    }
    return this.http.post<{ success: boolean; url: string; rutaRelativa?: string }>(`${this.apiUrl}/${id}/subtramos/video`, formData);
  }

  eliminarVideoSubtramo(id: number, origen: number, destino: number): Observable<any> {
    return this.delete(`${this.apiUrl}/${id}/subtramos/video?origen=${origen}&destino=${destino}`);
  }

  eliminarVideosSubtramosItinerario(itinerarioId: number): Observable<{ success: boolean; eliminados: number; message: string }> {
    return this.delete(`${environment.apiUrl}/itinerarios/${itinerarioId}/subtramos/videos`);
  }

  eliminarVideosSubtramosViaje(viajeId: number): Observable<{ success: boolean; eliminados: number; message: string }> {
    return this.delete(`${environment.apiUrl}/viajes/${viajeId}/subtramos/videos`);
  }
}



