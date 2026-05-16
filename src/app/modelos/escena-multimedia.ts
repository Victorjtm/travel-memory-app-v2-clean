import { Archivo } from './archivo';

export type TipoEscena = 'imagen' | 'video' | 'carta' | 'titulo';

export interface EscenaMultimedia {
  id: string | number;
  tipo: TipoEscena;
  url: string;
  duracion: number; // en segundos
  archivo?: Archivo;
  titulo?: string;
  descripcion?: string;
  fecha?: string;
  hora?: string;
  itinerarioId?: number;
  cargado?: boolean;
}

export interface ConfiguracionExportacion {
  incluirAudio: boolean;
  incluirTexto: boolean;
  incluirDescripcion: boolean;
  calidad: 'whatsapp' | 'alta';
  mantenerEstiloAlbum: boolean;
}
