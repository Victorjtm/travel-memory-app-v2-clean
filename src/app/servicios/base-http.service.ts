import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class BaseHttpService {

  constructor(protected http: HttpClient) {}

  // Método para obtener headers con ngrok-skip-browser-warning para JSON
  protected getJsonOptions() {
    let headers = new HttpHeaders({
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    });

    if (environment.apiUrl.includes('ngrok')) {
      console.log('[BaseHttpService] Agregando header ngrok-skip-browser-warning');
      headers = headers.set('ngrok-skip-browser-warning', '1');
    }

    return { headers };
  }

  // Método para obtener headers para FormData (sin Content-Type)
  protected getFormDataOptions() {
    let headers = new HttpHeaders();

    if (environment.apiUrl.includes('ngrok')) {
      console.log('[BaseHttpService] Agregando header ngrok-skip-browser-warning para FormData');
      headers = headers.set('ngrok-skip-browser-warning', '1');
    }

    return { headers };
  }

  // Método para obtener headers básicos (solo Accept)
  protected getBasicOptions() {
    let headers = new HttpHeaders({
      'Accept': 'application/json'
    });

    if (environment.apiUrl.includes('ngrok')) {
      headers = headers.set('ngrok-skip-browser-warning', '1');
    }

    return { headers };
  }

  // Método para obtener headers para descargas de archivos
  protected getBlobOptions() {
    let headers = new HttpHeaders({
      'Accept': 'application/octet-stream'
    });

    if (environment.apiUrl.includes('ngrok')) {
      console.log('[BaseHttpService] Agregando header ngrok-skip-browser-warning para descarga');
      headers = headers.set('ngrok-skip-browser-warning', '1');
    }

    return {
      headers,
      responseType: 'blob' as 'json'  // Truco de tipado para TypeScript
    };
  }

  // Métodos HTTP genéricos que puedes usar en cualquier servicio
  protected get<T>(url: string): Observable<T> {
    return this.http.get<T>(url, this.getBasicOptions());
  }

  protected post<T>(url: string, body: any): Observable<T> {
    return this.http.post<T>(url, body, this.getJsonOptions());
  }

  protected put<T>(url: string, body: any): Observable<T> {
    return this.http.put<T>(url, body, this.getJsonOptions());
  }

  protected delete<T>(url: string): Observable<T> {
    return this.http.delete<T>(url, this.getBasicOptions());
  }

  protected postFormData<T>(url: string, formData: FormData): Observable<T> {
    return this.http.post<T>(url, formData, this.getFormDataOptions());
  }

  protected putFormData<T>(url: string, formData: FormData): Observable<T> {
    return this.http.put<T>(url, formData, this.getFormDataOptions());
  }

  // Método especializado para descargar archivos como Blob
  protected downloadBlob(url: string): Observable<Blob> {
    return this.http.get<Blob>(url, this.getBlobOptions());
  }
}