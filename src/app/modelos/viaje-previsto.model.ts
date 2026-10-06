export interface ViajePrevisto {
  id: number;
  nombre: string;
  destino: string;
  fechaInicio: string;  // Sigue siendo string tipo ISO
  fechaFin: string;
  lat_representativa?: number | null;
  lng_representativa?: number | null;
  metodo_calculo?: string | null;
}

export interface Itinerario {
  id: number;
  viajePrevistoId: number; // Clave foránea al viaje
  fechaInicio: string;
  fechaFin: string;
  duracionDias: number;
  destinosPorDia: string; // Ojo: es un string que guarda destinos (puede ser JSON)
  descripcionGeneral?: string;
  horaInicio?: string;
  horaFin?: string;
  climaGeneral?: string;
  tipoDeViaje?: string; // Permitir valores dinámicos
  audio?: string;
  imagen_url?: string | null;
  foto_fallback_url?: string | null;
  mapa_url?: string | null;
  audio_url?: string | null;
  total_km?: number;
  total_segundos?: number;
  total_pasos?: number;
  total_pasos_caminando?: number;
  total_segundos_caminando?: number;
  total_km_caminando?: number;
  total_actividades?: number;
  total_fotos?: number;
  total_videos?: number;
  desglose_transporte?: any[];
  desglose_actividades?: any[];
  _sinFoto?: boolean;
}
