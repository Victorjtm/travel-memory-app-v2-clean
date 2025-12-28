export interface ActividadesDisponibles {
  id: number;
  tipoActividadId: number;  // Clave foránea a TiposActividad (ej: 1 = "Cultura", 2 = "Deporte")
  descripcion: string;      // Descripción detallada de la actividad (ej: "Visita al museo local")
}
  
