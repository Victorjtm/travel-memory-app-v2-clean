// travel-memory-app/src/app/modelos/archivo.model.ts
import { ArchivoAsociado } from './archivo-asociado.model';  // ⬅️ NUEVO

export interface Archivo {
    id: number;
    actividadId: number;
    itinerarioId?: number;
    tipo: 'foto' | 'video' | 'audio' | 'texto' | 'imagen';
    nombreArchivo: string;
    rutaArchivo: string;
    descripcion?: string;
    fechaCreacion?: string;
    fechaActualizacion?: string;
    horaCaptura?: string;
    version?: number;
    geolocalizacion?: string;
    metadatos?: string;    
    tipoMime?: string;  
    tamano?: number;
    archivosAsociados?: ArchivoAsociado[];  // ⬅️ NUEVO
  }