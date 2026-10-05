import { Component, OnInit, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ViajesPrevistosService } from '../../servicios/viajes-previstos.service';
import { ViajesRescateService } from '../../servicios/viajes-rescate.service';
import { HttpClient, HttpClientModule, HttpEventType } from '@angular/common/http';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialogModule } from '@angular/material/dialog';
import { timeout, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-viajes-previstos',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    RouterModule,
    MatMenuModule,
    MatDialogModule
  ],
  templateUrl: './viajes-previstos.component.html',
  styleUrls: ['./viajes-previstos.component.scss']
})
export class ViajesPrevistosComponent implements OnInit {
  viajesPrevistos: any[] = [];
  rangosFechasPorViaje: { [viajeId: number]: any } = {};
  desplegablesAbiertos: { [viajeId: number]: boolean } = {};
  desgloseAbiertoId: number | null = null;

  // ✨ Gestión de vistas (Airbnb Layout: Grid / Lineal + Modo fechas)
  vistaModo: 'viajes' | 'fechas' = 'viajes';
  disposicionVista: 'grid' | 'lineal' = (localStorage.getItem('viajes_disposicion_vista') as any) || 'grid';
  viajeActivoId: number | null = null;
  itinerariosCombinados: any[] = [];
  ultimaUnificacion: any = null;

  // 🚀 Flujo de Importación desde Móvil (Directo al pulsar +)
  private readonly API_URL = environment.apiUrl;
  mostrarModalImport = false;
  viajesExistentesCoincidentes: any[] = [];
  viajeExistenteSeleccionadoId: number | null = null;
  modoImportacion: 'anadir_actividad' | 'crear_viaje' = 'crear_viaje';

  importando = false;
  progresoSubida = 0;
  mensajeProgreso = '';

  destinoViaje = '';
  tipoActividadId: number | null = null;
  tiposActividad: any[] = [];

  archivosSeleccionados: File[] = [];
  manifestData: any = null;

  videosRequeridos = false;
  videosSeleccionados = false;
  ignorarVideos = false;
  archivosVideo: File[] = [];

  videosExtraidosMtp: any[] = [];
  buscandoVideosMtp = false;
  mensajeMtp = '';
  origenVideos = '';

  // Inyección de servicios
  private viajesRescateService = inject(ViajesRescateService);
  private http = inject(HttpClient);

  constructor(
    private viajesPrevistosService: ViajesPrevistosService,
    private router: Router
  ) { }

  ngOnInit(): void {
    console.log('[INIT] Cargando viajes previstos...');
    this.cargarTiposActividad();
    this.cargarViajes();
    this.cargarUltimaUnificacion();
  }

  cargarViajes(): void {
    this.viajesPrevistosService.obtenerViajes().subscribe((viajes) => {
      console.log('[GET viajes] Respuesta del servidor:', viajes);

      // Ordenar por fecha de inicio (más reciente primero)
      this.viajesPrevistos = viajes.sort((a, b) => {
        const tB = new Date(b.fecha_inicio).getTime() || 0;
        const tA = new Date(a.fecha_inicio).getTime() || 0;
        return tB - tA;
      });

      // Cargar rangos de fechas para cada viaje
      this.viajesPrevistos.forEach(viaje => {
        this.cargarRangosFechas(viaje.id);
      });

      console.log('[VIAJES ORDENADOS]', this.viajesPrevistos);
    });
  }

  cargarUltimaUnificacion(): void {
    this.viajesPrevistosService.obtenerUltimaUnificacion().subscribe({
      next: (res) => {
        this.ultimaUnificacion = res.historial || null;
      },
      error: (err) => {
        console.error('Error obteniendo última unificación:', err);
        this.ultimaUnificacion = null;
      }
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
      const tB = new Date(b.inicio).getTime() || 0;
      const tA = new Date(a.inicio).getTime() || 0;
      return tB - tA;
    });
  }

  toggleVista(): void {
    this.vistaModo = this.vistaModo === 'viajes' ? 'fechas' : 'viajes';
    console.log('[VIEW] Modo de vista cambiado a:', this.vistaModo);
  }

  toggleDesplegable(viajeId: number): void {
    this.desplegablesAbiertos[viajeId] = !this.desplegablesAbiertos[viajeId];
  }

  // 🏡 Alternancia de Vistas (Línea / Cuadrícula) estilo Airbnb
  cambiarDisposicion(modo: 'grid' | 'lineal'): void {
    this.disposicionVista = modo;
    localStorage.setItem('viajes_disposicion_vista', modo);
    console.log('[VIEW] Disposición cambiada a:', modo);
  }

  // 🎯 Comportamiento Interactivo: Revelar / ocultar acciones al pulsar
  toggleAccionesViaje(viajeId: number, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.viajeActivoId = this.viajeActivoId === viajeId ? null : viajeId;
  }

  cerrarAcciones(): void {
    this.viajeActivoId = null;
  }

  // 🚗 Desglose interactivo de transporte y actividades por viaje
  popoverTabPorViaje: { [viajeId: number]: 'transporte' | 'actividades' } = {};

  toggleDesgloseTransporte(viajeId: number, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.desgloseAbiertoId = this.desgloseAbiertoId === viajeId ? null : viajeId;
  }

  cerrarDesglose(): void {
    this.desgloseAbiertoId = null;
  }

  tieneDesgloseTransporte(viaje: any): boolean {
    const tieneTransportes = Array.isArray(viaje.desglose_transporte) && viaje.desglose_transporte.length > 0;
    const tieneActividades = Array.isArray(viaje.desglose_actividades) && viaje.desglose_actividades.length > 1;
    return tieneTransportes || tieneActividades;
  }

  getPopoverTab(viaje: any): 'transporte' | 'actividades' {
    if (this.popoverTabPorViaje[viaje.id]) {
      return this.popoverTabPorViaje[viaje.id];
    }
    // Si tiene múltiples actividades y pocos o un solo medio de transporte, priorizar actividades
    if (viaje.desglose_actividades && viaje.desglose_actividades.length > 1) {
      if (!viaje.desglose_transporte || viaje.desglose_transporte.length <= 1) {
        return 'actividades';
      }
    }
    return 'transporte';
  }

  setPopoverTab(viajeId: number, tab: 'transporte' | 'actividades', event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.popoverTabPorViaje[viajeId] = tab;
  }

  formatearKm(val: number): string {
    if (val === undefined || val === null || isNaN(val)) return '0,00';
    return Number(val).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(): void {
    if (this.desgloseAbiertoId !== null) {
      this.desgloseAbiertoId = null;
    }
  }

  // 🖼️ Plan B: Fallback de imagen si no carga o no tiene foto
  onImageError(viaje: any): void {
    if (viaje.foto_fallback_url && viaje.imagen_url !== viaje.foto_fallback_url) {
      console.log(`🖼️ [Plan B] Usando foto aleatoria de itinerario para viaje ${viaje.id}`);
      viaje.imagen_url = viaje.foto_fallback_url;
    } else {
      viaje._sinFoto = true;
    }
  }

  // 📊 Métricas de rendimiento consolidadas
  getDiasViaje(viaje: any): number {
    if (this.rangosFechasPorViaje[viaje.id]?.total) {
      return this.rangosFechasPorViaje[viaje.id].total;
    }
    if (viaje.total_itinerarios && viaje.total_itinerarios > 0) {
      return viaje.total_itinerarios;
    }
    if (viaje.fecha_inicio && viaje.fecha_fin) {
      const d1 = new Date(viaje.fecha_inicio).getTime();
      const d2 = new Date(viaje.fecha_fin).getTime();
      const diff = Math.round(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
      return isNaN(diff) || diff < 1 ? 1 : diff;
    }
    return 1;
  }

  getDistanciaKm(viaje: any): string {
    if (viaje.total_km && viaje.total_km > 0) {
      return Number(viaje.total_km).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (viaje.descripcion) {
      const match = viaje.descripcion.match(/(\d+(?:[\.,]\d+)?)\s*km/i);
      if (match) return match[1];
    }
    return '0,00';
  }

  getDuracionViaje(viaje: any): string {
    // Horas activas exclusivamente a pie
    const segs = (viaje.total_segundos_caminando !== undefined && viaje.total_segundos_caminando !== null && viaje.total_segundos_caminando > 0)
      ? viaje.total_segundos_caminando
      : (viaje.total_segundos && viaje.total_segundos > 0 ? viaje.total_segundos : 0);

    if (segs > 0) {
      const h = Math.floor(segs / 3600);
      const m = Math.floor((segs % 3600) / 60);
      const s = segs % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    if (viaje.descripcion) {
      const match = viaje.descripcion.match(/(\d{2}:\d{2}:\d{2})/);
      if (match) return match[1];
    }
    return '--:--';
  }

  getPasosViaje(viaje: any): string {
    // Pasos registrados exclusivamente caminando
    if (viaje.total_pasos_caminando !== undefined && viaje.total_pasos_caminando !== null && viaje.total_pasos_caminando > 0) {
      return viaje.total_pasos_caminando.toLocaleString('es-ES');
    }
    if (viaje.total_pasos && viaje.total_pasos > 0) {
      return viaje.total_pasos.toLocaleString('es-ES');
    }
    if (viaje.descripcion) {
      const match = viaje.descripcion.match(/([\d\.]+)\s*pasos/i);
      if (match) return match[1];
    }
    return '0';
  }

  formatearRangoViaje(viaje: any): string {
    const rangosInfo = this.rangosFechasPorViaje[viaje.id];
    if (rangosInfo && rangosInfo.rangos && rangosInfo.rangos.length > 0) {
      const primero = rangosInfo.rangos[0];
      const ultimo = rangosInfo.rangos[rangosInfo.rangos.length - 1];
      const inicio = primero.inicio || viaje.fecha_inicio;
      const fin = ultimo.fin || primero.fin || viaje.fecha_fin;
      if (inicio === fin) {
        return this.formatearFecha(inicio);
      }
      return `${this.formatearFecha(inicio)} - ${this.formatearFecha(fin)}`;
    }
    if (viaje.fecha_inicio && viaje.fecha_fin && viaje.fecha_inicio !== viaje.fecha_fin) {
      return `${this.formatearFecha(viaje.fecha_inicio)} - ${this.formatearFecha(viaje.fecha_fin)}`;
    }
    return this.formatearFecha(viaje.fecha_inicio);
  }

  getMotivoIcon(motivo?: string): string {
    if (!motivo) return '🏖️';
    const clean = motivo.trim().toLowerCase();
    if (clean.includes('vacaciones')) return '🏖️';
    if (clean.includes('trabajo')) return '💼';
    if (clean.includes('negocio')) return '🤝';
    if (clean.includes('escapada')) return '🚗';
    if (clean.includes('excursión') || clean.includes('excursion')) return '🥾';
    if (clean.includes('evento')) return '🎟️';
    if (clean.includes('entrenamiento')) return '🏃‍♂️';
    return '🏖️';
  }

  // ✨ NUEVO: Limpiar comillas de los destinos
  limpiarDestinos(texto: string | null): string {
    if (!texto) return 'Sin destinos';
    // Eliminar comillas escapadas y normales al inicio y final
    return texto.replace(/^["\\]+|["\\]+$/g, '').replace(/\\"/g, '"');
  }

  formatearFecha(fecha: string): string {
    if (!fecha) return 'Sin fecha';
    const date = new Date(fecha);
    if (isNaN(date.getTime())) {
      return fecha;
    }
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

  crearViajeRapido(): void {
    console.log('[RESCATE] Iniciando creación de viaje rápido por defecto...');
    this.viajesRescateService.crearViajeRapidoConConfirmacion((nuevoViaje) => {
      // Si el usuario decide editar más tarde, insertamos el viaje en la lista visual
      this.viajesPrevistos = [nuevoViaje, ...this.viajesPrevistos].sort((a, b) => {
        return new Date(b.fecha_inicio).getTime() - new Date(a.fecha_inicio).getTime();
      });
      this.cargarRangosFechas(nuevoViaje.id);
    });
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

  deshacerUnificacion(): void {
    if (!this.ultimaUnificacion) return;

    const msg = `¿Estás seguro de deshacer la unificación del destino "${this.ultimaUnificacion.destino}"?\n\nSe restaurarán los viajes, itinerarios, actividades y archivos a su estado previo.`;

    if (confirm(msg)) {
      this.viajesPrevistosService.deshacerUltimaUnificacion(this.ultimaUnificacion.id).subscribe({
        next: (res) => {
          alert('✅ ' + (res.message || 'Unificación deshecha correctamente.'));
          this.ultimaUnificacion = null;
          this.ngOnInit();
        },
        error: (err) => {
          console.error('[DESHACER] Error:', err);
          alert('❌ Ocurrió un error al deshacer la unificación.\n' + (err.error?.error || err.message));
        }
      });
    }
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

  irAMapaViaje(viajeId: number): void {
    console.log('[NAVIGATE] Ir a mapa GPX de viaje completo:', viajeId);
    this.router.navigate(['/viajes-previstos', viajeId, 'mapa-gpx']);
  }

  // ====================================================================
  // CARGAR TIPOS DE ACTIVIDAD PARA IMPORTACIÓN
  // ====================================================================
  cargarTiposActividad(): void {
    const url = `${this.API_URL}/tipos-actividad`;
    this.http.get<any[]>(url).subscribe({
      next: (tipos) => {
        this.tiposActividad = tipos;
      },
      error: (error) => {
        console.error('❌ Error cargando tipos de actividad:', error);
        this.tiposActividad = [
          { id: 1, nombre: 'Senderismo' },
          { id: 2, nombre: 'Conducir' },
          { id: 3, nombre: 'Ciclismo' }
        ];
      }
    });
  }

  esModoDynamics(): boolean {
    if (!this.manifestData) return false;
    return this.manifestData.metadatos_maestros?.origen === 'AudioPhotoApp_Dynamics' ||
           this.manifestData.estadisticas?.fuente === 'AudioPhotoApp_Dynamics' ||
           (typeof this.manifestData.nombre === 'string' && this.manifestData.nombre.startsWith('Recorrido_Dynamics_')) ||
           (typeof this.manifestData.viaje_id === 'string' && this.manifestData.viaje_id.startsWith('Recorrido_Dynamics_'));
  }

  obtenerFechaTracking(): string | null {
    if (!this.manifestData) return null;
    const matchNombre = this.manifestData.nombre?.match(/(\d{8})/);
    if (matchNombre) return matchNombre[1];

    const matchViaje = this.manifestData.viaje_id?.match(/(\d{8})/);
    if (matchViaje) return matchViaje[1];

    const fStr = this.manifestData.fecha || this.manifestData.metadatos_maestros?.fecha_inicio || this.manifestData.estadisticas?.fecha;
    if (fStr) {
      const matchYMD = fStr.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
      if (matchYMD) return `${matchYMD[1]}${matchYMD[2]}${matchYMD[3]}`;
      const matchDMY = fStr.match(/(\d{2})[-/](\d{2})[-/](\d{4})/);
      if (matchDMY) return `${matchDMY[3]}${matchDMY[2]}${matchDMY[1]}`;
    }
    return null;
  }

  async extraerVideosMtpDynamics(): Promise<boolean> {
    this.buscandoVideosMtp = true;
    this.mensajeMtp = 'Buscando vídeos en el dispositivo móvil (DCIM/AudioPhotoApp/videos)...';

    const fechaTracking = this.obtenerFechaTracking();
    const videosEnManifest = this.manifestData?.multimedia
      ?.filter((m: any) => m.tipo === 'video')
      .map((m: any) => m.nombre.toLowerCase()) || [];

    try {
      const url = `${this.API_URL}/mtp/extraer-videos-dynamics`;
      const res: any = await this.http.post(url, {
        fecha: fechaTracking,
        nombresManifest: videosEnManifest
      }).toPromise();

      this.buscandoVideosMtp = false;

      if (res && res.success && res.videos && res.videos.length > 0) {
        this.videosExtraidosMtp = res.videos;
        this.videosSeleccionados = true;
        this.origenVideos = res.videos[0]?.origen || 'DCIM/AudioPhotoApp/videos';
        this.mensajeMtp = `✅ Se extrajeron automáticamente ${res.videos.length} vídeos desde ${this.origenVideos}`;
        return true;
      } else {
        this.mensajeMtp = res?.mensaje || 'No se pudieron extraer vídeos automáticamente desde el móvil.';
        return false;
      }
    } catch (err: any) {
      this.buscandoVideosMtp = false;
      this.mensajeMtp = 'No se pudo comunicar con el servicio MTP.';
      return false;
    }
  }

  // ====================================================================
  // 1. EL HUMANO PULSA EL ICONO + (Add) -> Abre directamente explorador
  // ====================================================================
  async importarDesdeMovil(): Promise<void> {
    console.log('📂 [Mi Memoria de Viajes] Iniciando importación directa desde móvil...');

    try {
      const input = document.createElement('input');
      input.type = 'file';
      (input as any).webkitdirectory = true;
      input.multiple = true;

      const filesPromise = new Promise<FileList | null>((resolve) => {
        input.onchange = () => resolve(input.files);
        input.oncancel = () => resolve(null);
      });

      input.click();
      const files = await filesPromise;

      if (!files || files.length === 0) {
        return;
      }

      this.archivosSeleccionados = Array.from(files);
      const manifestFile = this.archivosSeleccionados.find(f => f.name === 'manifest.json');

      if (!manifestFile) {
        alert('❌ La carpeta seleccionada no contiene manifest.json\n\nAsegúrate de seleccionar una carpeta exportada desde AudioPhotoApp.');
        return;
      }

      const manifestText = await manifestFile.text();
      this.manifestData = JSON.parse(manifestText);

      this.videosExtraidosMtp = [];
      this.archivosVideo = [];
      this.mensajeMtp = '';
      this.origenVideos = '';

      const hayVideos = (this.manifestData.multimedia && this.manifestData.multimedia.some((m: any) => m.tipo === 'video')) ||
                        (this.manifestData.estadisticas?.num_videos > 0) ||
                        (this.manifestData.estadisticas?.numeroVideos > 0) ||
                        (this.manifestData.estadisticas?.videos > 0) ||
                        (this.manifestData.metadatos_maestros?.total_videos > 0);

      if (hayVideos) {
        this.videosRequeridos = true;
        this.videosSeleccionados = false;
        if (this.esModoDynamics()) {
          await this.extraerVideosMtpDynamics();
        } else {
          const videosEnCarpeta = this.archivosSeleccionados.filter(f => f.name.toLowerCase().endsWith('.mp4'));
          if (videosEnCarpeta.length > 0) {
            this.archivosVideo = videosEnCarpeta;
            this.videosSeleccionados = true;
            this.origenVideos = 'Carpeta de la ruta (sistema clásico)';
          }
        }
      } else {
        this.videosRequeridos = false;
      }

      const primeraFoto = this.manifestData.multimedia?.find((m: any) => m.tipo === 'foto');
      if (primeraFoto?.gps) {
        this.destinoViaje = this.manifestData.destino || 'España';
      }

      this.viajesExistentesCoincidentes = [];
      this.viajeExistenteSeleccionadoId = null;
      this.modoImportacion = 'crear_viaje';

      try {
        const fechaStr = this.obtenerFechaTracking();
        const fechaIso = fechaStr && fechaStr.length === 8 ? `${fechaStr.slice(0, 4)}-${fechaStr.slice(4, 6)}-${fechaStr.slice(6, 8)}` : null;

        if (fechaIso) {
          const todosViajes: any = await this.http.get(`${this.API_URL}/viajes`).toPromise();
          if (Array.isArray(todosViajes) && todosViajes.length > 0) {
            this.viajesExistentesCoincidentes = todosViajes.filter((v: any) => {
              const fIni = v.fecha_inicio ? v.fecha_inicio.split('T')[0] : '';
              const fFin = v.fecha_fin ? v.fecha_fin.split('T')[0] : '';
              return (fIni && fFin && fIni <= fechaIso && fechaIso <= fFin) || fIni === fechaIso || fFin === fechaIso;
            });

            if (this.viajesExistentesCoincidentes.length > 0) {
              this.modoImportacion = 'anadir_actividad';
              this.viajeExistenteSeleccionadoId = this.viajesExistentesCoincidentes[0].id;
              if (this.viajesExistentesCoincidentes[0].destino) {
                this.destinoViaje = this.viajesExistentesCoincidentes[0].destino;
              }
            }
          }
        }
      } catch (errViajes) {
        console.warn('⚠️ No se pudieron consultar viajes coincidentes:', errViajes);
      }

      this.mostrarModalImport = true;

    } catch (error: any) {
      console.error('❌ Error seleccionando carpeta:', error);
      alert(`Error al acceder a la carpeta: ${error.message}`);
    }
  }

  async seleccionarCarpetaVideos(): Promise<void> {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      (input as any).webkitdirectory = true;
      input.multiple = true;

      const filesPromise = new Promise<FileList | null>((resolve) => {
        input.onchange = () => resolve(input.files);
        input.oncancel = () => resolve(null);
      });

      input.click();
      const files = await filesPromise;
      if (!files || files.length === 0) return;

      const allMp4 = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.mp4'));
      this.archivosVideo = allMp4;
      this.videosSeleccionados = true;
    } catch (error: any) {
      console.error('❌ Error seleccionando carpeta de videos:', error);
    }
  }

  cancelarImportacion(): void {
    this.mostrarModalImport = false;
    this.archivosSeleccionados = [];
    this.manifestData = null;
    this.destinoViaje = '';
    this.tipoActividadId = null;
    this.videosRequeridos = false;
    this.videosSeleccionados = false;
    this.ignorarVideos = false;
    this.archivosVideo = [];
    this.videosExtraidosMtp = [];
    this.buscandoVideosMtp = false;
    this.mensajeMtp = '';
    this.origenVideos = '';
    this.viajesExistentesCoincidentes = [];
    this.viajeExistenteSeleccionadoId = null;
    this.modoImportacion = 'crear_viaje';
  }

  async confirmarImportacion(): Promise<void> {
    if (!this.destinoViaje.trim()) {
      alert('Por favor, ingresa el destino del viaje');
      return;
    }

    if (!this.tipoActividadId) {
      alert('Por favor, selecciona el tipo de actividad');
      return;
    }

    this.importando = true;
    this.progresoSubida = 0;
    this.mensajeProgreso = 'Preparando archivos...';

    try {
      const formData = new FormData();
      formData.append('destino', this.destinoViaje);
      formData.append('tipoActividadId', this.tipoActividadId.toString());

      if (this.modoImportacion === 'anadir_actividad' && this.viajeExistenteSeleccionadoId) {
        formData.append('viajeId', this.viajeExistenteSeleccionadoId.toString());
      }

      if (this.videosExtraidosMtp && this.videosExtraidosMtp.length > 0) {
        formData.append('videosMtpExtraidos', JSON.stringify(this.videosExtraidosMtp));
      }

      const todosLosArchivos = [...this.archivosSeleccionados, ...this.archivosVideo];
      const totalBytes = todosLosArchivos.reduce((sum, f) => sum + f.size, 0);

      todosLosArchivos.forEach((file, index) => {
        const relativePath = (file as any).webkitRelativePath || file.name;
        formData.append('archivos', file, relativePath);
        const progreso = Math.round((index / todosLosArchivos.length) * 30);
        this.progresoSubida = progreso;
        this.mensajeProgreso = `Preparando archivos... ${index + 1}/${todosLosArchivos.length}`;
      });

      const uploadUrl = `${this.API_URL}/import-tracking`;
      this.mensajeProgreso = 'Iniciando subida...';
      this.progresoSubida = 0;

      await new Promise<any>((resolve, reject) => {
        this.http.post(uploadUrl, formData, {
          reportProgress: true,
          observe: 'events'
        }).pipe(
          timeout(1800000),
          catchError(err => {
            if (err.name === 'TimeoutError') {
              return throwError(() => new Error('La subida ha superado el tiempo máximo (30 min).'));
            }
            return throwError(() => err);
          })
        ).subscribe({
          next: (event: any) => {
            if (event.type === HttpEventType.UploadProgress) {
              const total = event.total || totalBytes;
              this.progresoSubida = Math.round((event.loaded / total) * 100);
              const mbSubidos = (event.loaded / 1024 / 1024).toFixed(2);
              const mbTotal = (total / 1024 / 1024).toFixed(2);
              this.mensajeProgreso = `Subiendo archivos... ${this.progresoSubida}% (${mbSubidos} / ${mbTotal} MB)`;
            } else if (event.type === HttpEventType.Response) {
              this.mensajeProgreso = 'Procesando en servidor...';
              this.progresoSubida = 100;
              resolve(event.body);
            }
          },
          error: (err) => {
            console.error('❌ Error en subida:', err);
            reject(err);
          }
        });
      });

      alert(`✅ Importación completada con éxito en «Mi memoria de viajes»:\n\n• Viaje: "${this.manifestData?.nombre || this.destinoViaje}"\n• Fotos: ${this.manifestData?.estadisticas?.num_fotos || 0}\n• Vídeos: ${this.manifestData?.estadisticas?.num_videos || 0}\n• Audios: ${this.manifestData?.estadisticas?.num_audios || 0}`);

      this.mostrarModalImport = false;
      this.importando = false;

      // Recargar la lista automáticamente para que aparezca arriba de inmediato
      this.ngOnInit();

    } catch (error: any) {
      console.error('❌ Error en importación:', error);
      this.importando = false;
      alert(`❌ Error al importar:\n\n${error.error?.error || error.message || 'Error desconocido'}`);
    }
  }

  getTamanoTotal(): string {
    const totalBytes = this.archivosSeleccionados.reduce((sum, f) => sum + f.size, 0);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
    return `${totalMB} MB`;
  }
}