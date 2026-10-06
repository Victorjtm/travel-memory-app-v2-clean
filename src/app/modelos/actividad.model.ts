export interface Actividad {
  id: number;
  viajePrevistoId: number;         // FK a Viajes
  itinerarioId: number;            // FK a ItinerarioGeneral
  tipoActividadId: number;         // FK a TiposActividad
  actividadDisponibleId?: number;  // FK a ActividadesDisponibles (opcional)
  nombre?: string;                // Opcional (ej: "Tour personalizado")
  descripcion?: string;           // Opcional
  horaInicio: string;             // Formato: "HH:MM" (ej: "09:00")
  horaFin: string;                // Formato: "HH:MM" (ej: "12:00")
  perfilTransporte?: string;
  tipoActividadNombre?: string;
  distanciaKm?: number;
  distanciaMetros?: number;
  duracionSegundos?: number;
  duracionFormateada?: string;
  velocidadMediaKmh?: number;
  velocidadMaximaKmh?: number;
  velocidadMinimaKmh?: number;
  calorias?: number;
  pasosEstimados?: number;
  puntosGPS?: number;
  rutaGpxCompleto?: string;
  rutaMapaCompleto?: string;
  imagen_url?: string | null;
  foto_fallback_url?: string | null;
  mapa_url?: string | null;
  total_fotos?: number;
  total_videos?: number;
  total_archivos?: number;
  _sinFoto?: boolean;
}
