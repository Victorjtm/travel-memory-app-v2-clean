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

  // Obtener todos los archivos
  getArchivos(): Observable<Archivo[]> {
    return this.get<Archivo[]>(this.apiUrl);
  }

  // Obtener archivos por actividad
  getArchivosPorActividad(actividadId: number): Observable<Archivo[]> {
    return this.get<Archivo[]>(`${this.apiUrl}?actividadId=${actividadId}`);
  }

  // Obtener archivos por viaje
  getArchivosPorViaje(viajeId: number): Observable<Archivo[]> {
    const url = `${this.apiUrl}/viaje/${viajeId}`;
    console.log('🌐 Endpoint llamado:', url);
    return this.get<Archivo[]>(url);
  }

  // Obtener archivos por itinerario
  getArchivosPorItinerario(itinerarioId: number): Observable<Archivo[]> {
    return this.get<Archivo[]>(`${this.apiUrl}/itinerario/${itinerarioId}`);
  }

  // Obtener archivo individual
  getArchivo(id: number): Observable<Archivo> {
    return this.get<Archivo>(`${this.apiUrl}/${id}`);
  }

  // Crear archivo
  crearArchivo(archivo: Omit<Archivo, 'id'>): Observable<Archivo> {
    return this.post<Archivo>(this.apiUrl, archivo);
  }

  // Subir múltiples archivos (usando postFormData del servicio base)
  subirArchivos(formData: FormData): Observable<Archivo[]> {
    return this.postFormData<Archivo[]>(`${this.apiUrl}/subir`, formData);
  }

  // Asignar archivo a actividad
  asignarArchivoAActividad(archivoId: number, actividadId: number): Observable<any> {
    return this.put(`${this.apiUrl}/${archivoId}`, { actividadId });
  }

  // Actualizar archivo
  actualizarArchivo(id: number, archivo: Partial<Archivo>): Observable<{ updated: number }> {
    return this.put<{ updated: number }>(`${this.apiUrl}/${id}`, archivo);
  }

  // Actualizar metadatos y archivo físico (usando putFormData del servicio base)
  actualizarArchivoConArchivo(id: number, formData: FormData): Observable<{ updated: number }> {
    return this.putFormData<{ updated: number }>(`${this.apiUrl}/${id}/archivo`, formData);
  }

  actualizarGeolocalizacionFotosPorActividad(actividadId: number, geolocalizacion: string): Observable<{ actualizados: number }> {
    return this.put<{ actualizados: number }>(`${this.apiUrl}/actividad/${actividadId}/geolocalizacion`, {
      geolocalizacion
    });
  }

  /**
   * Procesa masivamente todos los archivos para extraer geolocalización EXIF
   */
  procesarGeolocalizacionMasiva(): Observable<any> {
    // ✅ NO agregar /archivos/ porque apiUrl ya lo incluye
    return this.http.post(`${this.apiUrl}/procesar-geolocalizacion-masiva`, {});
  }

  // Eliminar archivo
  eliminarArchivo(id: number): Observable<{ deleted: number }> {
    return this.delete<{ deleted: number }>(`${this.apiUrl}/${id}`);
  }

  // Descargar archivo (usando downloadBlob del servicio base)
  descargarArchivo(id: number): Observable<Blob> {
    return this.downloadBlob(`${this.apiUrl}/${id}/descargar`);
  }

  // Buscar coincidencias con archivo físico
  buscarCoincidencias(
    file: File,
    viajePrevistoId: number,
    actividadId?: number
  ): Observable<{
    metadata: { fecha: string; hora: string };
    actividadesCoincidentes: any[];
    actividadActual: any | null;
  }> {
    const formData = new FormData();
    formData.append('archivo', file);
    formData.append('viajePrevistoId', viajePrevistoId.toString());
    if (actividadId) formData.append('actividadId', actividadId.toString());

    return this.postFormData<{
      metadata: { fecha: string; hora: string };
      actividadesCoincidentes: any[];
      actividadActual: any | null;
    }>(`${this.apiUrl}/buscar-coincidencias`, formData);
  }

  // Buscar coincidencias por metadatos (sin archivo físico)
  buscarCoincidenciasPorMetadatos(datos: {
    viajePrevistoId: number;
    actividadId?: number;
    nombreArchivo: string;
    fechaArchivo?: string;
    horaArchivo?: string;
  }): Observable<{
    metadata: { fecha: string; hora: string };
    actividadesCoincidentes: any[];
    actividadActual: any | null;
  }> {
    return this.post<{
      metadata: { fecha: string; hora: string };
      actividadesCoincidentes: any[];
      actividadActual: any | null;
    }>(`${this.apiUrl}/buscar-coincidencias-metadatos`, datos);
  }

  // Obtener URL segura para mostrar archivos multimedia
  getUrlSegura(archivo: Archivo): string {
    const baseUrl = `${this.apiUrl}/${archivo.id}/mostrar`;

    // Si es ngrok, agregar el parámetro para evitar warning con un timestamp estático
    if (environment.apiUrl.includes('ngrok')) {
      return `${baseUrl}?ngrok-skip-browser-warning=1&_t=${archivo.id}`;
    }

    return baseUrl;
  }

  // Método mejorado: obtener el archivo como Blob y crear una URL local
  obtenerArchivoComoBlob(id: number): Observable<string> {
    return new Observable<string>(observer => {
      const url = environment.apiUrl.includes('ngrok')
        ? `${this.apiUrl}/${id}/mostrar?ngrok-skip-browser-warning=1`
        : `${this.apiUrl}/${id}/mostrar`;

      this.downloadBlob(url).subscribe({
        next: (blob) => {
          const objectUrl = URL.createObjectURL(blob);
          observer.next(objectUrl);
          observer.complete();
        },
        error: (error) => observer.error(error)
      });
    });
  }

  // Método mejorado: obtener archivo con headers apropiados para ngrok
  async obtenerArchivoConHeaders(archivo: Archivo): Promise<string> {
    try {
      const url = `${this.apiUrl}/${archivo.id}/mostrar`;
      let headers: HeadersInit = {};

      // Para ngrok, agregar el header para evitar el warning del navegador
      if (environment.apiUrl.includes('ngrok')) {
        headers = {
          'ngrok-skip-browser-warning': '1',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        };
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: headers,
        mode: 'cors', // Importante para CORS
        credentials: 'omit' // No enviar credenciales para evitar problemas con ngrok
      });

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }

      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (error) {
      console.error('Error al obtener archivo con headers:', error);

      // Fallback: intentar con un método más simple
      try {
        return await this.obtenerArchivoFallback(archivo);
      } catch (fallbackError) {
        console.error('Error en fallback:', fallbackError);
        throw error;
      }
    }
  }

  // Método de fallback para casos donde fetch falla
  private async obtenerArchivoFallback(archivo: Archivo): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = this.getUrlSegura(archivo);

      // Crear una imagen temporal para verificar si el archivo es accesible
      const testImg = new Image();
      testImg.crossOrigin = 'anonymous';

      testImg.onload = () => {
        resolve(url);
      };

      testImg.onerror = () => {
        // Si falla, intentar crear un blob URL
        this.obtenerArchivoComoBlob(archivo.id).subscribe({
          next: (blobUrl) => resolve(blobUrl),
          error: (error) => reject(error)
        });
      };

      testImg.src = url;

      // Timeout después de 5 segundos
      setTimeout(() => {
        reject(new Error('Timeout al cargar archivo'));
      }, 5000);
    });
  }

  // Subir archivos con progreso mejorado para ngrok
  subirArchivosConProgreso(formData: FormData, onProgress?: (porcentaje: number) => void): Promise<any> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // Configurar headers para ngrok
      if (environment.apiUrl.includes('ngrok')) {
        xhr.setRequestHeader('ngrok-skip-browser-warning', '1');
      }

      // Evento de progreso
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          const porcentaje = Math.round((event.loaded / event.total) * 100);
          onProgress(porcentaje);
        }
      });

      // Cuando termina exitosamente
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch (e) {
            resolve(xhr.responseText);
          }
        } else {
          reject(new Error(`Error HTTP: ${xhr.status} - ${xhr.statusText}`));
        }
      });

      // Si hay error de red
      xhr.addEventListener('error', () => {
        reject(new Error('Error de conexión de red'));
      });

      // Timeout
      xhr.addEventListener('timeout', () => {
        reject(new Error('Timeout en la subida del archivo'));
      });

      // Configurar timeout (30 segundos)
      xhr.timeout = 30000;

      // Configurar y enviar
      xhr.open('POST', `${this.apiUrl}/subir`);
      xhr.send(formData);
    });
  }

  // Método auxiliar para verificar si una URL es accesible
  async verificarUrlAccesible(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: environment.apiUrl.includes('ngrok') ?
          { 'ngrok-skip-browser-warning': '1' } : {}
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ============================================
  // MÉTODOS PARA ARCHIVOS ASOCIADOS (NUEVOS)
  // ============================================

  // Obtener archivos asociados de un archivo principal
  getArchivosAsociados(archivoPrincipalId: number): Observable<any[]> {
    const url = `${environment.apiUrl}/archivos-asociados?archivoPrincipalId=${archivoPrincipalId}`;
    return this.get<any[]>(url);
  }

  // Obtener archivo asociado individual
  getArchivoAsociado(archivoAsociadoId: number): Observable<any> {
    return this.get<any>(`${environment.apiUrl}/archivos-asociados/${archivoAsociadoId}`);
  }

  // Obtener URL segura para archivo asociado (para mostrar en navegador)
  getUrlArchivoAsociado(archivoAsociado: any): string {
    if (!archivoAsociado.rutaArchivo) return '';

    // Determinar si es ruta relativa o absoluta
    let rutaFinal: string;

    if (!archivoAsociado.rutaArchivo.includes('C:\\') && !archivoAsociado.rutaArchivo.startsWith('/')) {
      // Ruta relativa tipo: "10/40/audios/audio.wav"
      rutaFinal = archivoAsociado.rutaArchivo;
    } else {
      // Ruta absoluta antigua (legacy): extraer solo el nombre del archivo
      rutaFinal = archivoAsociado.rutaArchivo.split(/[\\/]/).pop() || '';
    }

    if (environment.production) {
      return `/uploads/${rutaFinal}`;
    } else {
      const baseUrl = `${environment.apiUrl}/uploads/${rutaFinal}`;

      if (environment.apiUrl.includes('ngrok')) {
        return `${baseUrl}?ngrok-skip-browser-warning=1&_t=${archivoAsociado.id}`;
      }

      return baseUrl;
    }
  }


  // Descargar archivo asociado
  descargarArchivoAsociado(archivoAsociadoId: number): Observable<Blob> {
    return this.downloadBlob(`${environment.apiUrl}/archivos-asociados/${archivoAsociadoId}/descargar`);
  }

  // Subir nuevo archivo asociado
  subirArchivoAsociado(formData: FormData): Observable<any> {
    return this.postFormData<any>(`${environment.apiUrl}/archivos-asociados/subir`, formData);
  }

  // Eliminar archivo asociado
  eliminarArchivoAsociado(archivoAsociadoId: number): Observable<{ deleted: number }> {
    return this.delete<{ deleted: number }>(`${environment.apiUrl}/archivos-asociados/${archivoAsociadoId}`);
  }

  // Corregir fechas automáticamente desde nombres de archivo
  corregirFechasNombre(actividadId: number): Observable<any> {
    return this.post(`${environment.apiUrl}/actividades/${actividadId}/corregir-fechas-nombre`, {});
  }

}