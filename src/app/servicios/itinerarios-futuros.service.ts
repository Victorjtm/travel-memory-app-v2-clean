// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MÓDULO 3: SERVICIO ITINERARIOS FUTUROS
// Fecha: 2026-02-01
// Descripción: Servicio para gestionar itinerarios de viajes futuros
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INTERFACES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ItinerarioFuturo {
    id?: number;
    viajeFuturoId: number;
    fechaInicio: string;
    fechaFin: string;
    duracionDias: number;
    destinosPorDia: string;
    descripcionGeneral?: string | null;
    horaInicio?: string | null;
    horaFin?: string | null;
    climaGeneral?: string | null;
    tipoDeViaje?: 'costa' | 'naturaleza' | 'rural' | 'urbana' | 'cultural' | 'trabajo' | null;
    itinerario_real_id?: number | null;
    actividades?: any[]; // Se llenará cuando se obtenga el viaje completo
}

export interface ItinerarioCreado {
    id: number;
    viajeFuturoId: number;
}

@Injectable({
    providedIn: 'root'
})
export class ItinerariosFuturosService {

    private apiUrl = `${environment.apiUrl}`;

    constructor(private http: HttpClient) { }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // LISTAR ITINERARIOS DE UN VIAJE FUTURO
    // GET /api/viajes-futuros/:id/itinerarios
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    obtenerItinerarios(viajeFuturoId: number): Observable<ItinerarioFuturo[]> {
        return this.http.get<ItinerarioFuturo[]>(`${this.apiUrl}/viajes-futuros/${viajeFuturoId}/itinerarios`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CREAR ITINERARIO
    // POST /api/viajes-futuros/:id/itinerarios
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    crearItinerario(viajeFuturoId: number, itinerario: Partial<ItinerarioFuturo>): Observable<ItinerarioCreado> {
        return this.http.post<ItinerarioCreado>(`${this.apiUrl}/viajes-futuros/${viajeFuturoId}/itinerarios`, itinerario);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ACTUALIZAR ITINERARIO
    // PUT /api/itinerarios-futuros/:id
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    actualizarItinerario(id: number, itinerario: Partial<ItinerarioFuturo>): Observable<{ message: string; id: number }> {
        return this.http.put<{ message: string; id: number }>(`${this.apiUrl}/itinerarios-futuros/${id}`, itinerario);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ELIMINAR ITINERARIO
    // DELETE /api/itinerarios-futuros/:id
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    eliminarItinerario(id: number): Observable<{ message: string; id: number }> {
        return this.http.delete<{ message: string; id: number }>(`${this.apiUrl}/itinerarios-futuros/${id}`);
    }
}
