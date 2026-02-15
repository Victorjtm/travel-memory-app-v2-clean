// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MÓDULO 3: SERVICIO VIAJES FUTUROS
// Fecha: 2026-02-01
// Descripción: Servicio para gestionar viajes futuros (planificación con IA)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INTERFACES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ViajeFuturo {
    id?: number;
    nombre: string;
    destino: string;
    fecha_inicio: string;
    fecha_fin: string;
    imagen?: string | null;
    audio?: string | null;
    descripcion?: string | null;
    estado?: 'planificado' | 'migrado';
    sessionId?: string | null;
    fecha_creacion?: string;
    fecha_migracion?: string | null;
    viaje_real_id?: number | null;
    itinerarios?: any[]; // Se llenará cuando se obtenga el viaje completo
}

export interface ViajeCreado {
    id: number;
    nombre: string;
    destino: string;
    fecha_inicio: string;
    fecha_fin: string;
    estado: string;
    sessionId: string | null;
}

export interface ItinerarioFuturo {
    id: number;
    viajeFuturoId: number;
    fechaInicio: string;
    fechaFin: string;
    duracionDias: number;
    destinosPorDia: string;
    descripcionGeneral?: string;
    horaInicio?: string;
    horaFin?: string;
    climaGeneral?: string;
    tipoDeViaje?: 'costa' | 'naturaleza' | 'rural' | 'urbana' | 'cultural' | 'trabajo';
    itinerario_real_id?: number;
}

export interface ActividadFutura {
    id: number;
    viajeFuturoId: number;
    itinerarioFuturoId: number;
    tipoActividadId: number;
    actividadDisponibleId?: number;
    nombre: string;
    descripcion?: string;
    horaInicio: string;
    horaFin: string;
    ubicacion_planeada?: string;

    // Campos estadísticas (vacíos en planificación)
    distanciaKm?: number;
    duracionSegundos?: number;
    calorias?: number;

    fechaCreacion: string;
    fechaActualizacion: string;
    actividad_real_id?: number;

    // Datos extras al hacer JOIN
    tipoActividad?: string;
}

export interface ViajeFuturoCompleto {
    viaje: ViajeFuturo;
    itinerarios: ItinerarioFuturo[];
    actividades: ActividadFutura[];
    estadisticas: {
        total_dias: number;
        total_actividades: number;
        actividades_por_dia: number;
    };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SERVICIO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@Injectable({
    providedIn: 'root'
})
export class ViajesFuturosService {

    private apiUrl = `${environment.apiUrl}/viajes-futuros`;



    constructor(private http: HttpClient) { }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // LISTAR VIAJES FUTUROS
    // GET /api/viajes-futuros?estado=planificado
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    obtenerViajesFuturos(estado?: 'planificado' | 'migrado'): Observable<ViajeFuturo[]> {
        let params = new HttpParams();
        if (estado) {
            params = params.set('estado', estado);
        }
        return this.http.get<ViajeFuturo[]>(this.apiUrl, { params });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // OBTENER VIAJE FUTURO POR ID (con itinerarios y actividades anidados)
    // GET /api/viajes-futuros/:id
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    obtenerViajeFuturo(id: number): Observable<ViajeFuturoCompleto> {
        return this.http.get<ViajeFuturoCompleto>(`${this.apiUrl}/${id}`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CREAR VIAJE FUTURO
    // POST /api/viajes-futuros
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    crearViajeFuturo(viaje: Partial<ViajeFuturo>): Observable<ViajeCreado> {
        return this.http.post<ViajeCreado>(this.apiUrl, viaje);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ACTUALIZAR VIAJE FUTURO
    // PUT /api/viajes-futuros/:id
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    actualizarViajeFuturo(id: number, viaje: Partial<ViajeFuturo>): Observable<{ message: string; id: number }> {
        return this.http.put<{ message: string; id: number }>(`${this.apiUrl}/${id}`, viaje);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ELIMINAR VIAJE FUTURO
    // DELETE /api/viajes-futuros/:id
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    eliminarViajeFuturo(id: number): Observable<{ message: string; id: number }> {
        return this.http.delete<{ message: string; id: number }>(`${this.apiUrl}/${id}`);
    }
}
