import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Archivo } from '../modelos/archivo';
import { environment } from '../../environments/environment';
import { BaseHttpService } from './base-http.service';

@Injectable({
  providedIn: 'root'
})
export class ArchivoService extends BaseHttpService {

  private apiUrl = `${environment.apiUrl}/archivos`;

  // Obtener archivo individual
  getArchivo(id: number): Observable<Archivo> {
    return this.get<Archivo>(`${this.apiUrl}/${id}`);
  }

  // Obtener archivos por actividad
  getArchivosPorActividad(actividadId: number): Observable<Archivo[]> {
    return this.get<Archivo[]>(`${this.apiUrl}?actividadId=${actividadId}`);
  }

  // Subir múltiples archivos (usando postFormData del servicio base)
  subirArchivos(formData: FormData): Observable<Archivo[]> {
    return this.postFormData<Archivo[]>(`${this.apiUrl}/subir`, formData);
  }

  // Actualizar metadatos y archivo físico (usando putFormData del servicio base)
  actualizarArchivoConArchivo(id: number, formData: FormData): Observable<any> {
    return this.putFormData(`${this.apiUrl}/${id}/archivo`, formData);
  }

  // Actualizar solo metadatos (usando put del servicio base para JSON)
  actualizarArchivo(id: number, datos: Partial<Archivo>): Observable<any> {
    return this.put(`${this.apiUrl}/${id}`, datos);
  }

  // Descargar archivo (usando downloadBlob del servicio base)
  descargarArchivo(id: number): Observable<Blob> {
    return this.downloadBlob(`${this.apiUrl}/${id}/descargar`);
  }

  // Eliminar archivo
  eliminarArchivo(id: number): Observable<any> {
    return this.delete(`${this.apiUrl}/${id}`);
  }
}