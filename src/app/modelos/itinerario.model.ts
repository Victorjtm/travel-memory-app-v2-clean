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
  }
  
