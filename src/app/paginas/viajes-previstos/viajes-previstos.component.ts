import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ViajesPrevistosService } from '../../servicios/viajes-previstos.service';
import { HttpClientModule } from '@angular/common/http';

@Component({
  selector: 'app-viajes-previstos',
  standalone: true,
  imports: [
    CommonModule,
    HttpClientModule,
    RouterModule
  ],
  templateUrl: './viajes-previstos.component.html',
  styleUrls: ['./viajes-previstos.component.scss']
})
export class ViajesPrevistosComponent implements OnInit {
  viajesPrevistos: any[] = [];
  rangosFechasPorViaje: { [viajeId: number]: any } = {};
  desplegablesAbiertos: { [viajeId: number]: boolean } = {};

  // ✨ NUEVO: Gestión de vistas
  vistaModo: 'viajes' | 'fechas' = 'viajes';
  itinerariosCombinados: any[] = [];

  constructor(
    private viajesPrevistosService: ViajesPrevistosService,
    private router: Router
  ) { }

  ngOnInit(): void {
    console.log('[INIT] Cargando viajes previstos...');
    this.viajesPrevistosService.obtenerViajes().subscribe((viajes) => {
      console.log('[GET viajes] Respuesta del servidor:', viajes);

      // Ordenar por fecha de inicio (más reciente primero)
      this.viajesPrevistos = viajes.sort((a, b) => {
        return new Date(b.fecha_inicio).getTime() - new Date(a.fecha_inicio).getTime();
      });

      // Cargar rangos de fechas para cada viaje
      this.viajesPrevistos.forEach(viaje => {
        this.cargarRangosFechas(viaje.id);
      });

      console.log('[VIAJES ORDENADOS]', this.viajesPrevistos);
    });
  }

  cargarRangosFechas(viajeId: number): void {
    this.viajesPrevistosService.obtenerRangosFechas(viajeId).subscribe({
      next: (resultado) => {
        this.rangosFechasPorViaje[viajeId] = resultado;
        console.log(`[RANGOS] Viaje ${viajeId}:`, resultado);
        this.actualizarItinerariosCombinados();
      },
      error: (error) => {
        console.error(`[RANGOS] Error viaje ${viajeId}:`, error);
      }
    });
  }

  // ✨ NUEVO: Lógica para la vista por fechas
  actualizarItinerariosCombinados(): void {
    const todos: any[] = [];
    this.viajesPrevistos.forEach(viaje => {
      const infoRanges = this.rangosFechasPorViaje[viaje.id];
      if (infoRanges && infoRanges.rangos) {
        infoRanges.rangos.forEach((rango: any) => {
          todos.push({
            ...rango,
            viajeId: viaje.id,
            nombreViaje: viaje.nombre || viaje.destino,
            destino: viaje.destino,
            destinos: rango.destinos // ✨ Asegurar que se pasa la propiedad destinos
          });
        });
      }
    });

    // Ordenar por fecha de inicio descendente
    this.itinerariosCombinados = todos.sort((a, b) => {
      return new Date(b.inicio).getTime() - new Date(a.inicio).getTime();
    });
  }

  toggleVista(): void {
    this.vistaModo = this.vistaModo === 'viajes' ? 'fechas' : 'viajes';
    console.log('[VIEW] Modo de vista cambiado a:', this.vistaModo);
  }

  toggleDesplegable(viajeId: number): void {
    this.desplegablesAbiertos[viajeId] = !this.desplegablesAbiertos[viajeId];
  }

  // ✨ NUEVO: Limpiar comillas de los destinos
  limpiarDestinos(texto: string | null): string {
    if (!texto) return 'Sin destinos';
    // Eliminar comillas escapadas y normales al inicio y final
    return texto.replace(/^["\\]+|["\\]+$/g, '').replace(/\\"/g, '"');
  }

  formatearFecha(fecha: string): string {
    const date = new Date(fecha);
    const dia = date.getDate().toString().padStart(2, '0');
    const mes = (date.getMonth() + 1).toString().padStart(2, '0');
    const año = date.getFullYear();
    return `${dia}-${mes}-${año}`;
  }

  formatearRango(rango: any): string {
    if (rango.dias === 1) {
      return this.formatearFecha(rango.inicio);
    }
    return `${this.formatearFecha(rango.inicio)} al ${this.formatearFecha(rango.fin)}`;
  }

  eliminarViaje(id: number) {
    const viaje = this.viajesPrevistos.find(v => v.id === id);
    const nombreViaje = viaje?.nombre || `Viaje #${id}`;

    if (!confirm(`⚠️ ¿Estás seguro de eliminar "${nombreViaje}"?\n\nEsto eliminará:\n• El viaje\n• Todos sus itinerarios\n• Todas las actividades\n• Todos los archivos (fotos, videos, audios)\n\nEsta acción NO se puede deshacer.`)) {
      return;
    }

    console.log('[ELIMINAR] Enviando petición para eliminar viaje con id:', id);

    this.viajesPrevistosService.eliminarViaje(id).subscribe({
      next: (respuesta) => {
        console.log('[ELIMINAR] ✅ Respuesta del servidor:', respuesta);

        this.viajesPrevistos = this.viajesPrevistos.filter((viaje) => viaje.id !== id);
        console.log('[ELIMINAR] Lista actualizada:', this.viajesPrevistos);

        if (respuesta?.archivosEliminados || respuesta?.itinerariosEliminados) {
          alert(`✅ Viaje eliminado correctamente\n\n📊 Resumen:\n• Itinerarios eliminados: ${respuesta.itinerariosEliminados || 0}\n• Archivos eliminados: ${respuesta.archivosEliminados || 0}`);
        } else {
          alert('✅ Viaje eliminado correctamente');
        }
      },
      error: (error) => {
        console.error('[ELIMINAR] ❌ Error:', error);
        alert(`❌ Error al eliminar el viaje:\n\n${error.error?.error || error.message}`);
      }
    });
  }

  actualizarViaje(id: number, viaje: any) {
    console.log('[ACTUALIZAR] Enviando datos al servidor. ID:', id, 'Datos:', viaje);
    this.viajesPrevistosService.actualizarViaje(id, viaje).subscribe((respuesta) => {
      console.log('[ACTUALIZAR] Respuesta del servidor:', respuesta);
      const index = this.viajesPrevistos.findIndex((v) => v.id === id);
      if (index !== -1) {
        this.viajesPrevistos[index] = viaje;
        this.viajesPrevistos = this.viajesPrevistos.sort((a, b) => {
          return new Date(b.fecha_inicio).getTime() - new Date(a.fecha_inicio).getTime();
        });
        console.log('[ACTUALIZAR] Lista actualizada y ordenada:', this.viajesPrevistos);
      }
    });
  }

  agregarViaje(viaje: any) {
    console.log('[AGREGAR] Enviando nuevo viaje al servidor:', viaje);
    this.viajesPrevistosService.crearViaje(viaje).subscribe((nuevoViaje) => {
      console.log('[AGREGAR] Respuesta del servidor:', nuevoViaje);
      this.viajesPrevistos.push(nuevoViaje);
      this.viajesPrevistos = this.viajesPrevistos.sort((a, b) => {
        return new Date(b.fecha_inicio).getTime() - new Date(a.fecha_inicio).getTime();
      });
      console.log('[AGREGAR] Lista actualizada y ordenada:', this.viajesPrevistos);
    });
  }

  irAlFormulario() {
    console.log('[NAVIGATE] Ir a formulario de nuevo viaje');
    this.router.navigate(['/formulario-viaje-previsto', 'nuevo']);
  }

  irAEditarViaje(id: number) {
    console.log('[NAVIGATE] Editar viaje con ID:', id);
    this.router.navigate(['/formulario-viaje-previsto', id]);
  }

  irAMapaViajes(): void {
    this.router.navigate(['/viajes-previstos/mapa']);
  }

  ejecutarUnificacion(resoluciones: any[] = []) {
    if (resoluciones.length === 0) {
      if (!confirm('¿Estás seguro de que quieres unificar los viajes con el mismo destino? Esta acción reagrupará o fusionará itinerarios.')) {
        return;
      }
    }

    console.log('[UNIFICAR] Iniciando proceso...', resoluciones.length > 0 ? '(Con resoluciones)' : '');

    this.viajesPrevistosService.unificarViajes(resoluciones).subscribe({
      next: async (res) => {
        console.log('[UNIFICAR] Respuesta:', res);
        
        if (res.errores && res.errores.length > 0) {
          alert('⚠️ Errores no resueltos:\n' + res.errores.map((e: any) => `- ${e.destino}: ${e.error}`).join('\n'));
        }

        // Manejar conflictos con opciones de resolución
        if (res.conflictos && res.conflictos.length > 0) {
          const nuevasResoluciones = [...resoluciones];

          for (const conflicto of res.conflictos) {
            const puedeFusionar = conflicto.opcionesPermitidas.includes('fusionar_dia_completo');
            let decisionModo = null;
             
            if (puedeFusionar) {
               const msg = `Conflicto en ${conflicto.destino} (${conflicto.fecha}).\nMotivo: ${conflicto.motivo}\n\n¿Deseas MANTENER ITINERARIOS SEPARADOS dentro del mismo viaje (Recomendado)?\n\n[Aceptar] para mantener independientes\n[Cancelar] para ver más opciones`;
               if (confirm(msg)) {
                  decisionModo = 'mismo_viaje_itinerarios_separados';
               } else {
                  if (confirm(`¿Deseas FUSIONAR agresivamente en un Día Completo?\n(Se absorberán los parciales en el día completo)\n\n[Aceptar] para Fusionar\n[Cancelar] para Omitir destino`)) {
                     decisionModo = 'fusionar_dia_completo';
                  }
               }
            } else {
               const msg = `Conflicto en ${conflicto.destino} (${conflicto.fecha}).\nMotivo: ${conflicto.motivo}\n\nSolo se permite MANTENER ITINERARIOS SEPARADOS dentro del mismo viaje.\n\n[Aceptar] para mantener independientes\n[Cancelar] para Omitir destino`;
               if (confirm(msg)) {
                  decisionModo = 'mismo_viaje_itinerarios_separados';
               }
            }
             
            if (decisionModo) {
               nuevasResoluciones.push({ idResolucion: conflicto.idResolucion, modoUnificacion: decisionModo });
            } else {
               nuevasResoluciones.push({ idResolucion: conflicto.idResolucion, modoUnificacion: 'omitir' });
               alert(`Has omitido la unificación de ${conflicto.destino} (${conflicto.fecha}).`);
            }
          }

          // Si el usuario aportó nuevas resoluciones, lanzar la segunda fase
          if (nuevasResoluciones.length > resoluciones.length) {
            this.ejecutarUnificacion(nuevasResoluciones);
            return; // Esperar a la segunda llamada
          }
        }

        // Si llegamos aquí y hubo éxito general (y ya no hay conflictos pendientes)
        if (res.success && res.unificados > 0) {
          alert(res.message);
          this.ngOnInit();
        } else if (res.unificados === 0 && (!res.conflictos || res.conflictos.length === 0)) {
           if (!res.errores || res.errores.length === 0) {
              alert(res.message);
           }
        }
      },
      error: (err) => {
        console.error('[UNIFICAR] Error:', err);
        alert('Ocurrió un error al unificar los viajes.\n' + (err.error?.error || err.message));
      }
    });
  }

  verAlbumEnLibro(viajeId: number): void {
    console.log('[NAVIGATE] Ver álbum en libro. ID viaje:', viajeId);
    this.router.navigate(
      ['/viajes-previstos', viajeId, 'itinerarios', 'album', 'libro'],
      { queryParams: { origen: 'viaje' } }
    );
  }

  irAItinerarios(viajeId: number, rango?: any): void {
    if (rango) {
      console.log(`[NAVIGATE] Ir a itinerarios de viaje ${viajeId} con filtro:`, rango);
      this.router.navigate(['/itinerarios', viajeId], {
        queryParams: {
          inicio: rango.inicio,
          fin: rango.fin
        }
      });
    } else {
      console.log(`[NAVIGATE] Ir a todos los itinerarios de viaje ${viajeId}`);
      this.router.navigate(['/itinerarios', viajeId]);
    }
  }
}