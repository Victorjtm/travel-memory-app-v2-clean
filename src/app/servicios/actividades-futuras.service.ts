// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MÓDULO 3: SERVICIO ACTIVIDADES FUTURAS
// Fecha: 2026-02-01
// Descripción: Servicio para gestionar actividades de itinerarios futuros
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INTERFACES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ActividadFutura {
    id?: number;
    viajeFuturoId: number;
    itinerarioFuturoId: number;
    tipoActividadId: number;
    actividadDisponibleId?: number | null;
    nombre?: string | null;
    descripcion?: string | null;
    horaInicio: string;
    horaFin: string;
    ubicacion_planeada?: string | null; // JSON string: {"lat": 41.89, "lon": 12.49, "nombre": "Coliseo"}

    // Campos de estadísticas (vacíos en planificación)
    distanciaKm?: number;
    distanciaMetros?: number;
    duracionSegundos?: number;
    duracionFormateada?: string | null;
    velocidadMediaKmh?: number;
    velocidadMaximaKmh?: number;
    velocidadMinimaKmh?: number;
    calorias?: number;
    pasosEstimados?: number;
    puntosGPS?: number;
    perfilTransporte?: string | null;
    rutaGpxCompleto?: string | null;
    rutaMapaCompleto?: string | null;
    rutaManifest?: string | null;
    rutaEstadisticas?: string | null;

    fechaCreacion?: string;
    fechaActualizacion?: string;
    actividad_real_id?: number | null;
}

export interface ActividadCreada {
    id: number;
    itinerarioFuturoId: number;
}

@Injectable({
    providedIn: 'root'
})
export class ActividadesFuturasService {

    private apiUrl = `${environment.apiUrl}`;

    constructor(private http: HttpClient) { }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // LISTAR ACTIVIDADES DE UN ITINERARIO FUTURO
    // GET /api/itinerarios-futuros/:id/actividades
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    obtenerActividades(itinerarioFuturoId: number): Observable<ActividadFutura[]> {
        return this.http.get<ActividadFutura[]>(`${this.apiUrl}/itinerarios-futuros/${itinerarioFuturoId}/actividades`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CREAR ACTIVIDAD
    // POST /api/itinerarios-futuros/:id/actividades
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    crearActividad(itinerarioFuturoId: number, actividad: Partial<ActividadFutura>): Observable<ActividadCreada> {
        return this.http.post<ActividadCreada>(`${this.apiUrl}/itinerarios-futuros/${itinerarioFuturoId}/actividades`, actividad);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ACTUALIZAR ACTIVIDAD
    // PUT /api/actividades-futuras/:id
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    actualizarActividad(id: number, actividad: Partial<ActividadFutura>): Observable<{ message: string; id: number }> {
        return this.http.put<{ message: string; id: number }>(`${this.apiUrl}/actividades-futuras/${id}`, actividad);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ELIMINAR ACTIVIDAD
    // DELETE /api/actividades-futuras/:id
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    eliminarActividad(id: number): Observable<{ message: string; id: number }> {
        return this.http.delete<{ message: string; id: number }>(`${this.apiUrl}/actividades-futuras/${id}`);
    }
}