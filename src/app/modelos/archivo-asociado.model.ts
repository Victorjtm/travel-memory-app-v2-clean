export interface ArchivoAsociado {
  id?: number;
  archivoPrincipalId: number;
  tipo: 'audio' | 'texto' | 'mapa_ubicacion' | 'gpx' | 'manifest' | 'estadisticas';
  nombreArchivo: string;
  rutaArchivo: string;
  descripcion?: string;
  fechaCreacion?: string;
  fechaActualizacion?: string;
  version?: number;
}


export interface CrearArchivoAsociado {
  archivoPrincipalId?: number;
  tipo?: 'audio' | 'texto' | 'mapa_ubicacion' | 'gpx' | 'manifest' | 'estadisticas';
  nombreArchivo?: string;
  rutaArchivo?: string;
  descripcion?: string;
}


export interface ActualizarArchivoAsociado {
  tipo?: 'audio' | 'texto' | 'mapa_ubicacion' | 'gpx' | 'manifest' | 'estadisticas';
  nombreArchivo?: string;
  rutaArchivo?: string;
  descripcion?: string;
}

// Interfaz para archivos encontrados en búsqueda AudioPhotoApp
export interface ArchivoEncontrado {
  nombre: string;
  rutaRelativa: string;
  tipo: 'audio' | 'gpx' | 'mapa_ubicacion';
  file: File;
  tamaño: number;
  seleccionado: boolean;
}
