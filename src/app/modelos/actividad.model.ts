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
} 
