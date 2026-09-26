import { Archivo } from './archivo';

export type TipoEscena = 'imagen' | 'video' | 'carta' | 'titulo' | 'mapa_resumen' | 'intro_3d' | 'audio';

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
  viajeId?: number;
  cargado?: boolean;
  claseMarco?: string;
  badgeOrden?: string;
  esIntro3D?: boolean;
  esOutro3D?: boolean;
  esMapaAnimado?: boolean;
  trackGpx?: string;
  distanciaKm?: number;
}

export interface ConfiguracionExportacion {
  incluirAudio: boolean;
  incluirTexto: boolean;
  incluirDescripcion: boolean;
  calidad: 'whatsapp' | 'alta';
  mantenerEstiloAlbum: boolean;
}
