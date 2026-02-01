// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MÓDULO 5: COMPONENTE DE PRUEBA - VIAJES FUTUROS
// Fecha: 2026-02-01
// Descripción: Componente para probar los servicios de viajes futuros
// VERSIÓN INLINE (sin dependencias externas de servicios)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';

interface ViajeFuturo {
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
  itinerarios?: any[];
}

interface ViajeCreado {
  id: number;
  nombre: string;
  destino: string;
  fecha_inicio: string;
  fecha_fin: string;
  estado: string;
  sessionId: string | null;
}

interface ItinerarioFuturo {
  id?: number;
  viajeFuturoId: number;
  fechaInicio: string;
  fechaFin: string;
  duracionDias: number;
  destinosPorDia: string;
  descripcionGeneral?: string | null;
  tipoDeViaje?: 'costa' | 'naturaleza' | 'rural' | 'urbana' | 'cultural' | 'trabajo' | null;
  actividades?: any[];
}

interface ItinerarioCreado {
  id: number;
  viajeFuturoId: number;
}

interface ActividadFutura {
  id?: number;
  viajeFuturoId: number;
  itinerarioFuturoId: number;
  tipoActividadId: number;
  nombre?: string | null;
  descripcion?: string | null;
  horaInicio: string;
  horaFin: string;
}

interface ActividadCreada {
  id: number;
  itinerarioFuturoId: number;
}

@Component({
  selector: 'app-test-viajes-futuros',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './test-viajes-futuros.component.html',
  styleUrls: ['./test-viajes-futuros.component.scss']
})
export class TestViajesFuturosComponent implements OnInit {

  viajes: ViajeFuturo[] = [];
  viajeSeleccionado: ViajeFuturo | null = null;
  itinerarios: ItinerarioFuturo[] = [];
  actividades: ActividadFutura[] = [];

  nuevoViajeId: number | null = null;
  nuevoItinerarioId: number | null = null;
  nuevoActividadId: number | null = null;

  logs: string[] = [];

  private apiUrl = 'http://localhost:3000/api';

  constructor(private http: HttpClient) { }

  ngOnInit(): void {
    this.addLog('✅ Componente de prueba inicializado');
    this.addLog(`🔗 API URL: ${this.apiUrl}`);
    this.listarViajes();
  }

  listarViajes() {
    this.addLog('📋 Listando viajes futuros...');

    let params = new HttpParams().set('estado', 'planificado');

    this.http.get<ViajeFuturo[]>(`${this.apiUrl}/viajes-futuros`, { params }).subscribe({
      next: (viajes) => {
        this.viajes = viajes;
        this.addLog(`✅ ${viajes.length} viajes encontrados`);
        console.log('Viajes:', viajes);
      },
      error: (err) => {
        this.addLog(`❌ Error: ${err.message}`);
        console.error(err);
      }
    });
  }

  crearViajeEjemplo() {
    this.addLog('➕ Creando viaje de ejemplo...');

    const nuevoViaje: Partial<ViajeFuturo> = {
      nombre: 'Viaje a Barcelona',
      destino: 'Barcelona, España',
      fecha_inicio: '2026-09-01',
      fecha_fin: '2026-09-05',
      descripcion: 'Viaje cultural a Barcelona',
      sessionId: 'test-session-' + Date.now()
    };

    this.http.post<ViajeCreado>(`${this.apiUrl}/viajes-futuros`, nuevoViaje).subscribe({
      next: (resultado) => {
        this.nuevoViajeId = resultado.id;
        this.addLog(`✅ Viaje creado con ID: ${resultado.id}`);
        console.log('Viaje creado:', resultado);
        this.listarViajes();
      },
      error: (err) => {
        this.addLog(`❌ Error: ${err.message}`);
        console.error(err);
      }
    });
  }

  obtenerViajeCompleto(id: number) {
    this.addLog(`🔍 Obteniendo viaje completo ID: ${id}...`);

    this.http.get<ViajeFuturo>(`${this.apiUrl}/viajes-futuros/${id}`).subscribe({
      next: (viaje) => {
        this.viajeSeleccionado = viaje;
        this.addLog(`✅ Viaje obtenido: ${viaje.nombre}`);
        this.addLog(`   - Itinerarios: ${viaje.itinerarios?.length || 0}`);
        console.log('Viaje completo:', viaje);
      },
      error: (err) => {
        this.addLog(`❌ Error: ${err.message}`);
        console.error(err);
      }
    });
  }

  actualizarViaje(id: number) {
    this.addLog(`✏️ Actualizando viaje ID: ${id}...`);

    const datosActualizados: Partial<ViajeFuturo> = {
      nombre: 'Viaje a Barcelona - ACTUALIZADO',
      destino: 'Barcelona y alrededores',
      fecha_inicio: '2026-09-01',
      fecha_fin: '2026-09-06',
      descripcion: 'Actualizado desde componente de prueba'
    };

    this.http.put<{ message: string; id: number }>(`${this.apiUrl}/viajes-futuros/${id}`, datosActualizados).subscribe({
      next: (resultado) => {
        this.addLog(`✅ ${resultado.message}`);
        this.listarViajes();
      },
      error: (err) => {
        this.addLog(`❌ Error: ${err.message}`);
        console.error(err);
      }
    });
  }

  eliminarViaje(id: number) {
    if (!confirm('¿Seguro que deseas eliminar este viaje?')) return;

    this.addLog(`🗑️ Eliminando viaje ID: ${id}...`);

    this.http.delete<{ message: string; id: number }>(`${this.apiUrl}/viajes-futuros/${id}`).subscribe({
      next: (resultado) => {
        this.addLog(`✅ ${resultado.message}`);
        this.listarViajes();
        this.viajeSeleccionado = null;
      },
      error: (err) => {
        this.addLog(`❌ Error: ${err.message}`);
        console.error(err);
      }
    });
  }

  crearItinerarioEjemplo(viajeId: number) {
    this.addLog(`➕ Creando itinerario para viaje ${viajeId}...`);

    const nuevoItinerario: Partial<ItinerarioFuturo> = {
      viajeFuturoId: viajeId,
      fechaInicio: '2026-09-01',
      fechaFin: '2026-09-01',
      duracionDias: 1,
      destinosPorDia: 'Sagrada Familia, Park Güell, Casa Batlló',
      descripcionGeneral: 'Día 1: Obras de Gaudí',
      tipoDeViaje: 'cultural'
    };

    this.http.post<ItinerarioCreado>(`${this.apiUrl}/viajes-futuros/${viajeId}/itinerarios`, nuevoItinerario).subscribe({
      next: (resultado) => {
        this.nuevoItinerarioId = resultado.id;
        this.addLog(`✅ Itinerario creado con ID: ${resultado.id}`);
        console.log('Itinerario creado:', resultado);
        this.obtenerViajeCompleto(viajeId);
      },
      error: (err) => {
        this.addLog(`❌ Error: ${err.message}`);
        console.error(err);
      }
    });
  }

  crearActividadEjemplo(itinerarioId: number, viajeId: number) {
    this.addLog(`➕ Creando actividad para itinerario ${itinerarioId}...`);

    const nuevaActividad: Partial<ActividadFutura> = {
      viajeFuturoId: viajeId,
      itinerarioFuturoId: itinerarioId,
      tipoActividadId: 1,
      nombre: 'Visita a la Sagrada Familia',
      descripcion: 'Tour guiado por la Sagrada Familia',
      horaInicio: '10:00',
      horaFin: '12:30'
    };

    this.http.post<ActividadCreada>(`${this.apiUrl}/itinerarios-futuros/${itinerarioId}/actividades`, nuevaActividad).subscribe({
      next: (resultado) => {
        this.nuevoActividadId = resultado.id;
        this.addLog(`✅ Actividad creada con ID: ${resultado.id}`);
        console.log('Actividad creada:', resultado);
        this.obtenerViajeCompleto(viajeId);
      },
      error: (err) => {
        this.addLog(`❌ Error: ${err.message}`);
        console.error(err);
      }
    });
  }

  addLog(mensaje: string) {
    const timestamp = new Date().toLocaleTimeString();
    this.logs.unshift(`[${timestamp}] ${mensaje}`);
    if (this.logs.length > 20) this.logs.pop();
  }

  limpiarLogs() {
    this.logs = [];
  }
}
