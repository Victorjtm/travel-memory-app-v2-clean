export interface ViajePrevisto {
    id: number;
    nombre: string;
    destino: string;
    fechaInicio: string;  // Sigue siendo string tipo ISO
    fechaFin: string;
    lat_representativa?: number;
    lng_representativa?: number;
    metodo_calculo?: 'gps_direct' | 'centroid' | 'first_point' | 'geocoding' | 'none';
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
    tipoDeViaje?: 'costa' | 'naturaleza' | 'rural' | 'urbana' | 'cultural' | 'trabajo'; // Solo esos valores permitidos
  }
  