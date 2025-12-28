import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { ArchivoAsociado, CrearArchivoAsociado, ActualizarArchivoAsociado } from '../modelos/archivo-asociado.model';

@Injectable({
  providedIn: 'root'
})
export class ArchivosAsociadosService {
  private readonly baseUrl = 'http://localhost:3000/archivos-asociados';
  
  private archivosAsociadosSubject = new BehaviorSubject<ArchivoAsociado[]>([]);
  public archivosAsociados$ = this.archivosAsociadosSubject.asObservable();

  constructor(private http: HttpClient) {}

  // ═══════════════════════════════════════════════════════════════
  // MÉTODOS DE CONSULTA
  // ═══════════════════════════════════════════════════════════════

  /**
   * Obtener todos los archivos asociados
   */
  obtenerTodos(): Observable<ArchivoAsociado[]> {
    console.log('[📡 GET] Obteniendo todos los archivos asociados');
    
    return this.http.get<ArchivoAsociado[]>(this.baseUrl).pipe(
      tap(archivos => {
        console.log('[✅ GET] Archivos asociados obtenidos:', archivos.length);
        this.archivosAsociadosSubject.next(archivos);
      }),
      catchError(error => {
        console.error('[❌ GET] Error obteniendo archivos asociados:', error);
        return this.manejarError(error);
      })
    );
  }

  /**
   * Obtener archivos asociados por ID del archivo principal
   */
  obtenerPorArchivoPrincipal(archivoPrincipalId: number): Observable<ArchivoAsociado[]> {
    console.log('[📡 GET] Obteniendo archivos asociados para archivo principal:', archivoPrincipalId);
    
    const params = { archivoPrincipalId: archivoPrincipalId.toString() };
    
    return this.http.get<ArchivoAsociado[]>(this.baseUrl, { params }).pipe(
      tap(archivos => {
        console.log('[✅ GET] Archivos asociados obtenidos:', archivos.length);
        this.archivosAsociadosSubject.next(archivos);
      }),
      catchError(error => {
        console.error('[❌ GET] Error obteniendo archivos asociados por archivo principal:', error);
        return this.manejarError(error);
      })
    );
  }

  /**
   * Obtener un archivo asociado por ID
   */
  obtenerPorId(id: number): Observable<ArchivoAsociado> {
    console.log('[📡 GET] Obteniendo archivo asociado por ID:', id);
    
    return this.http.get<ArchivoAsociado>(`${this.baseUrl}/${id}`).pipe(
      tap(archivo => {
        console.log('[✅ GET] Archivo asociado obtenido:', archivo.nombreArchivo);
      }),
      catchError(error => {
        console.error('[❌ GET] Error obteniendo archivo asociado por ID:', error);
        return this.manejarError(error);
      })
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // MÉTODOS DE CREACIÓN
  // ═══════════════════════════════════════════════════════════════

  /**
   * Crear archivo asociado solo con metadatos (sin archivo físico)
   */
  crear(nuevoArchivo: CrearArchivoAsociado): Observable<ArchivoAsociado> {
    console.log('[📡 POST] Creando archivo asociado (solo metadatos):', nuevoArchivo);
    
    const headers = new HttpHeaders({
      'Content-Type': 'application/json'
    });

    return this.http.post<ArchivoAsociado>(this.baseUrl, nuevoArchivo, { headers }).pipe(
tap(archivoCreado => {
  console.log('[✅ POST] Archivo asociado creado:', archivoCreado);
}),
      catchError(error => {
        console.error('[❌ POST] Error creando archivo asociado:', error);
        return this.manejarError(error);
      })
    );
  }

  /**
   * Subir archivo asociado (archivo físico + metadatos)
   */
subirArchivo(archivo: File, datosArchivo: CrearArchivoAsociado): Observable<ArchivoAsociado> {
  console.log('[📡 POST] Subiendo archivo asociado:', {
    archivo: archivo.name,
    datos: datosArchivo
  });

  if (datosArchivo.archivoPrincipalId === undefined) {
    return throwError(() => new Error('El campo archivoPrincipalId es obligatorio'));
  }
  if (datosArchivo.tipo === undefined) {
    return throwError(() => new Error('El campo tipo es obligatorio'));
  }

  const formData = new FormData();
  formData.append('archivo', archivo);
  formData.append('archivoPrincipalId', datosArchivo.archivoPrincipalId.toString());
  formData.append('tipo', datosArchivo.tipo);

  if (datosArchivo.descripcion) {
    formData.append('descripcion', datosArchivo.descripcion);
  }

  return this.http.post<ArchivoAsociado>(`${this.baseUrl}/subir`, formData).pipe(
    tap(archivoCreado => {
      console.log('[✅ POST] Archivo asociado subido:', archivoCreado);
    }),
    catchError(error => {
      console.error('[❌ POST] Error subiendo archivo asociado:', error);
      return this.manejarError(error);
    })
  );
}


  // ═══════════════════════════════════════════════════════════════
  // MÉTODOS DE ACTUALIZACIÓN
  // ═══════════════════════════════════════════════════════════════

  /**
   * Actualizar archivo asociado (solo metadatos)
   */
  actualizar(id: number, datosActualizacion: ActualizarArchivoAsociado): Observable<ArchivoAsociado> {
    console.log('[📡 PUT] Actualizando archivo asociado (metadatos):', id, datosActualizacion);
    
    const headers = new HttpHeaders({
      'Content-Type': 'application/json'
    });

    return this.http.put<ArchivoAsociado>(`${this.baseUrl}/${id}`, datosActualizacion, { headers }).pipe(
      tap(archivoActualizado => {
        console.log('[✅ PUT] Archivo asociado actualizado:', archivoActualizado);
        this.refrescarLista();
      }),
      catchError(error => {
        console.error('[❌ PUT] Error actualizando archivo asociado:', error);
        return this.manejarError(error);
      })
    );
  }

  /**
   * Actualizar archivo asociado (archivo físico + metadatos)
   */
  actualizarConArchivo(id: number, archivo: File, datosActualizacion?: Partial<ActualizarArchivoAsociado>): Observable<ArchivoAsociado> {
    console.log('[📡 PUT] Actualizando archivo asociado con archivo:', id, {
      archivo: archivo.name,
      datos: datosActualizacion
    });

    const formData = new FormData();
    formData.append('archivo', archivo);
    
    if (datosActualizacion?.tipo) {
      formData.append('tipo', datosActualizacion.tipo);
    }
    
    if (datosActualizacion?.descripcion) {
      formData.append('descripcion', datosActualizacion.descripcion);
    }

    return this.http.put<ArchivoAsociado>(`${this.baseUrl}/${id}/archivo`, formData).pipe(
      tap(archivoActualizado => {
        console.log('[✅ PUT] Archivo asociado actualizado con archivo:', archivoActualizado);
        this.refrescarLista();
      }),
      catchError(error => {
        console.error('[❌ PUT] Error actualizando archivo asociado con archivo:', error);
        return this.manejarError(error);
      })
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // MÉTODOS DE ELIMINACIÓN
  // ═══════════════════════════════════════════════════════════════

  /**
   * Eliminar archivo asociado
   */
  eliminar(id: number): Observable<any> {
    console.log('[📡 DELETE] Eliminando archivo asociado:', id);
    
    return this.http.delete(`${this.baseUrl}/${id}`).pipe(
      tap(resultado => {
        console.log('[✅ DELETE] Archivo asociado eliminado:', resultado);
        this.refrescarLista();
      }),
      catchError(error => {
        console.error('[❌ DELETE] Error eliminando archivo asociado:', error);
        return this.manejarError(error);
      })
    );
  }

  /**
   * Eliminar todos los archivos asociados a un archivo principal
   */
  eliminarPorArchivoPrincipal(archivoPrincipalId: number): Observable<any> {
    console.log('[📡 DELETE] Eliminando archivos asociados del archivo principal:', archivoPrincipalId);
    
    const params = { archivoPrincipalId: archivoPrincipalId.toString() };
    
    return this.http.delete(this.baseUrl, { params }).pipe(
      tap(resultado => {
        console.log('[✅ DELETE] Archivos asociados eliminados:', resultado);
        this.refrescarLista();
      }),
      catchError(error => {
        console.error('[❌ DELETE] Error eliminando archivos asociados por archivo principal:', error);
        return this.manejarError(error);
      })
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // MÉTODOS DE DESCARGA
  // ═══════════════════════════════════════════════════════════════

  /**
   * Descargar archivo asociado
   */
  descargar(id: number): Observable<Blob> {
    console.log('[📡 GET] Descargando archivo asociado:', id);
    
    return this.http.get(`${this.baseUrl}/${id}/descargar`, { 
      responseType: 'blob' 
    }).pipe(
      tap(() => {
        console.log('[✅ GET] Archivo asociado descargado:', id);
      }),
      catchError(error => {
        console.error('[❌ GET] Error descargando archivo asociado:', error);
        return this.manejarError(error);
      })
    );
  }

  /**
   * Obtener URL de descarga temporal para un archivo asociado
   */
  obtenerUrlDescarga(id: number): Observable<{ url: string; expiraEn: number }> {
    console.log('[📡 GET] Obteniendo URL de descarga para archivo asociado:', id);
    
    return this.http.get<{ url: string; expiraEn: number }>(`${this.baseUrl}/${id}/url-descarga`).pipe(
      tap(respuesta => {
        console.log('[✅ GET] URL de descarga obtenida, expira en:', respuesta.expiraEn);
      }),
      catchError(error => {
        console.error('[❌ GET] Error obteniendo URL de descarga:', error);
        return this.manejarError(error);
      })
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // MÉTODOS DE UTILIDAD
  // ═══════════════════════════════════════════════════════════════

  /**
   * Refrescar la lista de archivos asociados
   */
  private refrescarLista(): void {
    this.obtenerTodos().subscribe();
  }

  /**
   * Limpiar el BehaviorSubject
   */
  limpiarDatos(): void {
    console.log('[🧹] Limpiando datos de archivos asociados');
    this.archivosAsociadosSubject.next([]);
  }

  /**
   * Obtener el estado actual de archivos asociados
   */
  obtenerEstadoActual(): ArchivoAsociado[] {
    return this.archivosAsociadosSubject.value;
  }

  /**
   * Verificar si existe un archivo asociado
   */
  existeArchivo(id: number): boolean {
    return this.archivosAsociadosSubject.value.some(archivo => archivo.id === id);
  }

  /**
   * Filtrar archivos asociados por tipo
   */
  filtrarPorTipo(tipo: string): ArchivoAsociado[] {
    return this.archivosAsociadosSubject.value.filter(archivo => archivo.tipo === tipo);
  }

  /**
   * Contar archivos asociados por archivo principal
   */
  contarPorArchivoPrincipal(archivoPrincipalId: number): number {
    return this.archivosAsociadosSubject.value.filter(
      archivo => archivo.archivoPrincipalId === archivoPrincipalId
    ).length;
  }

  /**
   * Obtener información del archivo (sin descargarlo)
   */
  obtenerInformacionArchivo(id: number): Observable<{ 
    nombre: string; 
    tamaño: number; 
    tipo: string; 
    fechaCreacion: Date;
    checksum?: string;
  }> {
    console.log('[📡 GET] Obteniendo información del archivo asociado:', id);
    
    return this.http.get<{
      nombre: string; 
      tamaño: number; 
      tipo: string; 
      fechaCreacion: Date;
      checksum?: string;
    }>(`${this.baseUrl}/${id}/info`).pipe(
      tap(info => {
        console.log('[✅ GET] Información del archivo obtenida:', info.nombre);
      }),
      catchError(error => {
        console.error('[❌ GET] Error obteniendo información del archivo:', error);
        return this.manejarError(error);
      })
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // MANEJO DE ERRORES
  // ═══════════════════════════════════════════════════════════════

  /**
   * Manejar errores HTTP
   */
  private manejarError(error: any): Observable<never> {
    let mensajeError = 'Error desconocido en el servicio de archivos asociados';
    
    if (error.error instanceof ErrorEvent) {
      // Error del lado del cliente
      mensajeError = `Error del cliente: ${error.error.message}`;
    } else {
      // Error del servidor
      switch (error.status) {
        case 400:
          mensajeError = 'Solicitud inválida - Datos incorrectos';
          break;
        case 401:
          mensajeError = 'No autorizado - Credenciales inválidas';
          break;
        case 403:
          mensajeError = 'Prohibido - Sin permisos suficientes';
          break;
        case 404:
          mensajeError = 'Archivo asociado no encontrado';
          break;
        case 409:
          mensajeError = 'Conflicto - El archivo ya existe';
          break;
        case 413:
          mensajeError = 'Archivo demasiado grande';
          break;
        case 415:
          mensajeError = 'Tipo de archivo no soportado';
          break;
        case 422:
          mensajeError = 'Datos de entrada no válidos';
          break;
        case 500:
          mensajeError = 'Error interno del servidor';
          break;
        case 503:
          mensajeError = 'Servicio no disponible temporalmente';
          break;
        default:
          mensajeError = `Error ${error.status}: ${error.message}`;
      }
    }
    
    console.error('[💥] Error procesado:', mensajeError);
    return throwError(() => new Error(mensajeError));
  }
}