import { Component, OnInit, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ItinerarioService } from '../../../servicios/itinerario.service';
import { ViajesPrevistosService } from '../../../servicios/viajes-previstos.service';
import { Itinerario } from '../../../modelos/viaje-previsto.model';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { TiposDeActividadComponent } from './tipos-de-actividad/tipos-de-actividad.component';

@Component({
  selector: 'app-itinerarios',
  standalone: true,
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    RouterModule,
    TiposDeActividadComponent
  ],
  templateUrl: './itinerario.component.html',
  styleUrls: ['./itinerario.component.scss']
})
export class ItinerariosComponent implements OnInit {

  itinerarios: Itinerario[] = [];
  viajePrevistoId!: number;
  viaje: any = null;
  cargando: boolean = false;
  filtroInicio: string | null = null;
  filtroFin: string | null = null;
  itinerariosCompletos: Itinerario[] = [];

  // 🔲 Modo de visualización: Cuadrícula (grid) o Lista (lineal)
  disposicionVista: 'grid' | 'lineal' = 'grid';

  // 🗂️ Estados de interacción estilo Airbnb
  itinerarioActivoId: number | null = null;
  desgloseAbiertoId: number | null = null;
  popoverTabs: { [itinerarioId: number]: 'transporte' | 'actividades' } = {};
  mostrarModalActualizar: boolean = false;

  // Formulario de actualización
  itinerarioActualizado: Itinerario = {
    id: 0,
    viajePrevistoId: 0,
    fechaInicio: '',
    fechaFin: '',
    duracionDias: 0,
    destinosPorDia: '',
    descripcionGeneral: '',
    horaInicio: '',
    horaFin: '',
    climaGeneral: '',
    tipoDeViaje: 'costa'
  };

  archivoAudioSeleccionado: File | null = null;
  hayDuplicados: boolean = false;

  constructor(
    private itinerarioService: ItinerarioService,
    private viajesPrevistosService: ViajesPrevistosService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const idParam = params.get('viajePrevistoId');
      if (idParam) {
        this.viajePrevistoId = +idParam;
        this.cargarViaje();

        this.route.queryParamMap.subscribe(queryParams => {
          this.filtroInicio = queryParams.get('inicio');
          let fFin = queryParams.get('fin');
          
          if (this.filtroInicio && fFin && (this.filtroInicio === fFin || fFin.endsWith('00:00:00'))) {
              fFin = fFin.substring(0, 10) + ' 23:59:59';
          }
          
          this.filtroFin = fFin;
          this.cargarItinerarios();
        });
      }
    });
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.itinerarioActivoId = null;
    this.desgloseAbiertoId = null;
  }

  cargarViaje(): void {
    if (!this.viajePrevistoId) return;
    this.viajesPrevistosService.obtenerViaje(this.viajePrevistoId).subscribe({
      next: (v) => {
        this.viaje = v;
        this.cdr.detectChanges();
      },
      error: (e) => console.warn('No se pudo cargar datos del viaje:', e)
    });
  }

  cargarItinerarios(): void {
    this.cargando = true;
    this.itinerarioService.getItinerarios(this.viajePrevistoId).subscribe({
      next: (itinerarios) => {
        this.itinerariosCompletos = itinerarios;
        this.aplicarFiltro();
        this.checkDuplicados();
        this.cargando = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error al cargar itinerarios:', err);
        this.cargando = false;
        this.cdr.detectChanges();
      }
    });
  }

  aplicarFiltro(): void {
    if (this.filtroInicio && this.filtroFin) {
      this.itinerarios = this.itinerariosCompletos.filter(it => {
        const itInicio = it.fechaInicio ? it.fechaInicio.substring(0, 10) : '';
        const itFin = it.fechaFin ? it.fechaFin.substring(0, 10) : '';
        const filtroI = this.filtroInicio!.substring(0, 10);
        const filtroF = this.filtroFin!.substring(0, 10);
        return itInicio >= filtroI && itFin <= filtroF;
      });
    } else {
      this.itinerarios = [...this.itinerariosCompletos];
    }
  }

  limpiarFiltro(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { inicio: null, fin: null },
      queryParamsHandling: 'merge'
    });
  }

  cambiarDisposicion(modo: 'grid' | 'lineal'): void {
    this.disposicionVista = modo;
  }

  // 🎯 Título descriptivo del itinerario (evita el ID numérico)
  getTituloItinerario(itinerario: Itinerario, index: number): string {
    const limpio = this.limpiarDestinos(itinerario.destinosPorDia);
    if (limpio) return limpio;

    if (itinerario.descripcionGeneral) {
      const sinRecorrido = itinerario.descripcionGeneral.replace(/Recorrido de [^\n\r]+(\n|\r|$)/gi, '').trim();
      if (sinRecorrido && !sinRecorrido.toLowerCase().includes('tracking importado')) {
        const primeraFrase = sinRecorrido.split(/[\.\n]/)[0].trim();
        if (primeraFrase.length > 3 && primeraFrase.length <= 60) {
          return primeraFrase;
        }
      }
    }

    return `Día ${index + 1} · ${this.formatearFecha(itinerario.fechaInicio)}`;
  }

  limpiarDestinos(destinos: string | null | undefined): string {
    if (!destinos) return '';
    let str = destinos.trim();
    if (str.startsWith('[') && str.endsWith(']')) {
      try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed)) {
          str = parsed.join(', ');
        }
      } catch {
        str = str.replace(/[\[\]"']/g, '').trim();
      }
    }
    if (str.toLowerCase().includes('destino por asignar')) {
      return '';
    }
    return str;
  }

  getDescripcionLimpia(itinerario: Itinerario): string {
    if (!itinerario.descripcionGeneral) return '';
    const partes = itinerario.descripcionGeneral.split('\n').map(p => p.trim()).filter(Boolean);
    const narracion = partes.filter(p => !p.toLowerCase().startsWith('recorrido de ')).join(' ');
    if (narracion) return narracion;
    return itinerario.descripcionGeneral;
  }

  formatearFecha(fecha: string | null | undefined): string {
    if (!fecha) return '';
    const limpia = fecha.split('T')[0].split(' ')[0];
    const partes = limpia.split('-');
    if (partes.length === 3) {
      const d = parseInt(partes[2], 10);
      const m = parseInt(partes[1], 10) - 1;
      const y = parseInt(partes[0], 10);
      const date = new Date(y, m, d);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    }
    return fecha;
  }

  formatearFechaCorta(fecha: string | null | undefined): string {
    if (!fecha) return '';
    const limpia = fecha.split('T')[0].split(' ')[0];
    const partes = limpia.split('-');
    if (partes.length === 3) {
      const d = parseInt(partes[2], 10);
      const m = parseInt(partes[1], 10) - 1;
      const y = parseInt(partes[0], 10);
      const date = new Date(y, m, d);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
      }
    }
    return fecha;
  }

  formatearRangoFechas(inicio: string | null | undefined, fin: string | null | undefined): string {
    if (!inicio) return '';
    const fIni = this.formatearFecha(inicio);
    if (!fin || inicio.substring(0, 10) === fin.substring(0, 10)) {
      return fIni;
    }
    const fFin = this.formatearFecha(fin);
    return `${fIni} - ${fFin}`;
  }

  formatearRangoItinerario(itinerario: any): string {
    if (!itinerario) return '';
    return this.formatearRangoFechas(itinerario.fechaInicio, itinerario.fechaFin);
  }

  // 📊 Métricas de rendimiento
  getDistanciaKm(itinerario: any): string {
    if (itinerario.total_km && itinerario.total_km > 0) {
      return Number(itinerario.total_km).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (itinerario.descripcionGeneral) {
      const match = itinerario.descripcionGeneral.match(/(\d+(?:[\.,]\d+)?)\s*km/i);
      if (match) return match[1];
    }
    return '0,00';
  }

  getDuracionItinerario(itinerario: any): string {
    const segs = (itinerario.total_segundos_caminando !== undefined && itinerario.total_segundos_caminando !== null && itinerario.total_segundos_caminando > 0)
      ? itinerario.total_segundos_caminando
      : (itinerario.total_segundos && itinerario.total_segundos > 0 ? itinerario.total_segundos : 0);

    if (segs > 0) {
      const h = Math.floor(segs / 3600);
      const m = Math.floor((segs % 3600) / 60);
      const s = segs % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    if (itinerario.descripcionGeneral) {
      const match = itinerario.descripcionGeneral.match(/(\d{2}:\d{2}:\d{2})/);
      if (match) return match[1];
    }
    return '--:--';
  }

  getPasosItinerario(itinerario: any): string {
    if (itinerario.total_pasos_caminando !== undefined && itinerario.total_pasos_caminando !== null && itinerario.total_pasos_caminando > 0) {
      return itinerario.total_pasos_caminando.toLocaleString('es-ES');
    }
    if (itinerario.total_pasos && itinerario.total_pasos > 0) {
      return itinerario.total_pasos.toLocaleString('es-ES');
    }
    if (itinerario.descripcionGeneral) {
      const match = itinerario.descripcionGeneral.match(/([\d\.]+)\s*pasos/i);
      if (match) return match[1];
    }
    return '0';
  }

  formatearKm(val: number | undefined | null): string {
    if (val === undefined || val === null) return '0,00';
    return Number(val).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  getTipoIcon(tipo: string | undefined): string {
    if (!tipo) return '🗺️';
    const t = tipo.toLowerCase();
    if (t.includes('naturaleza') || t.includes('rural') || t.includes('senderismo')) return '🌿';
    if (t.includes('cultural') || t.includes('monumento') || t.includes('museo')) return '🏛️';
    if (t.includes('costa') || t.includes('playa') || t.includes('mar')) return '🏖️';
    if (t.includes('montaña') || t.includes('montana')) return '🏔️';
    if (t.includes('urbana') || t.includes('ciudad')) return '🏙️';
    if (t.includes('gastro') || t.includes('restaurante')) return '🍽️';
    if (t.includes('deporte') || t.includes('aventura')) return '🚴';
    return '📍';
  }

  getTipoEtiqueta(tipo: string | undefined): string {
    const icon = this.getTipoIcon(tipo);
    const nombre = tipo ? (tipo.charAt(0).toUpperCase() + tipo.slice(1)) : 'General';
    return `${icon} ${nombre}`;
  }

  onImageError(itinerario: any): void {
    if (itinerario.imagen_url !== itinerario.mapa_url && itinerario.mapa_url) {
      itinerario.imagen_url = itinerario.mapa_url;
    } else {
      itinerario._sinFoto = true;
    }
  }

  // 🎛️ Desplegables de acciones e información
  toggleAccionesItinerario(id: number, event: MouseEvent): void {
    event.stopPropagation();
    this.itinerarioActivoId = this.itinerarioActivoId === id ? null : id;
    this.desgloseAbiertoId = null;
  }

  cerrarAcciones(): void {
    this.itinerarioActivoId = null;
  }

  toggleDesgloseTransporte(id: number, event: MouseEvent): void {
    event.stopPropagation();
    this.desgloseAbiertoId = this.desgloseAbiertoId === id ? null : id;
    if (!this.popoverTabs[id]) {
      this.popoverTabs[id] = 'transporte';
    }
  }

  cerrarDesglose(): void {
    this.desgloseAbiertoId = null;
  }

  tieneDesgloseTransporte(itinerario: any): boolean {
    return (itinerario?.desglose_transporte && itinerario.desglose_transporte.length > 0) ||
           (itinerario?.desglose_actividades && itinerario.desglose_actividades.length > 1);
  }

  getPopoverTab(itinerario: any): 'transporte' | 'actividades' {
    return this.popoverTabs[itinerario.id] || 'transporte';
  }

  setPopoverTab(id: number, tab: 'transporte' | 'actividades', event: MouseEvent): void {
    event.stopPropagation();
    this.popoverTabs[id] = tab;
  }

  // 🚀 Navegación y acciones
  verActividades(itinerario: any): void {
    if (itinerario && itinerario.id != null) {
      this.router.navigate(['/viajes-previstos', this.viajePrevistoId, 'itinerarios', itinerario.id, 'actividades']);
    }
  }

  agregarActividad(itinerario: any): void {
    this.router.navigate([
      '/formulario-actividad',
      this.viajePrevistoId,
      itinerario.id,
      'nuevo'
    ]);
  }

  verAlbumEnLibro(): void {
    this.router.navigate(['/viajes-previstos', this.viajePrevistoId, 'itinerarios', 'album', 'libro']);
  }

  irAMapaViaje(): void {
    this.router.navigate(['/viajes-previstos', this.viajePrevistoId, 'mapa-gpx']);
  }

  volverAViajes(): void {
    this.router.navigate(['/viajes-previstos']);
  }

  // ✏️ Actualización y creación
  actualizarItinerario(itinerario: Itinerario): void {
    this.itinerarioActualizado = { ...itinerario };
    this.archivoAudioSeleccionado = null;
    this.mostrarModalActualizar = true;
    this.itinerarioActivoId = null;
  }

  guardarActualizacion(): void {
    this.cargando = true;
    this.itinerarioService.actualizarItinerario(
      this.itinerarioActualizado.id,
      this.itinerarioActualizado,
      this.archivoAudioSeleccionado || undefined
    ).subscribe({
      next: () => {
        this.archivoAudioSeleccionado = null;
        this.mostrarModalActualizar = false;
        this.cargarItinerarios();
        this.resetearFormulario();
        this.cargando = false;
      },
      error: (err) => {
        console.error('Error al actualizar itinerario:', err);
        alert('Error al guardar los cambios del itinerario');
        this.cargando = false;
      }
    });
  }

  cancelarActualizacion(): void {
    this.mostrarModalActualizar = false;
    this.archivoAudioSeleccionado = null;
    this.resetearFormulario();
  }

  eliminarItinerario(id: number): void {
    if (confirm('¿Estás seguro de que deseas eliminar este itinerario y todas sus actividades asociadas?')) {
      this.itinerarioService.eliminarItinerario(id).subscribe(() => {
        this.itinerarios = this.itinerarios.filter(it => it.id !== id);
        this.cargarItinerarios();
      });
    }
  }

  onAudioSelected(event: any): void {
    const file = event.target.files?.[0];
    if (file) {
      this.archivoAudioSeleccionado = file;
    }
  }

  checkDuplicados(): void {
    if (!this.itinerarios || this.itinerarios.length === 0) {
      this.hayDuplicados = false;
      return;
    }

    const fechas = this.itinerarios.map(it => {
      if (!it.fechaInicio) return '';
      return it.fechaInicio.split('T')[0].split(' ')[0].trim();
    });

    const counts: { [key: string]: number } = {};
    fechas.forEach(f => {
      if (f) counts[f] = (counts[f] || 0) + 1;
    });

    const duplicados = Object.keys(counts).filter(f => counts[f] > 1);
    this.hayDuplicados = duplicados.length > 0;
    this.cdr.detectChanges();
  }

  unificarMismoDia(): void {
    const mensaje = `Se han detectado itinerarios duplicados.\n\n` +
      `Elija la opción de unificación:\n` +
      `A) Mantener actividades separadas por hora (Clustering > 30min).\n` +
      `B) Una sola actividad genérica para todo el día (00:00-23:59).`;

    const eleccion = window.prompt(mensaje, 'A');
    if (eleccion === null) return;

    const opcion = eleccion.toUpperCase() as 'A' | 'B';
    if (opcion !== 'A' && opcion !== 'B') {
      alert("Opción no válida. Use 'A' o 'B'.");
      return;
    }

    this.itinerarioService.unificarItinerarios(this.viajePrevistoId, opcion).subscribe({
      next: (res: any) => {
        let msg = `🧹 ¡Unificación completada!\n\n` +
                 `• Itinerarios eliminados: ${res.itinerariosEliminados}\n` +
                 `• Actividades creadas: ${res.actividadesCreadas}\n`;
        
        if (res.archivosOmitidosCount > 0) {
          msg += `• Archivos omitidos (duplicados): ${res.archivosOmitidosCount}\n\n` +
                 `LISTA DE ARCHIVOS OMITIDOS:\n` +
                 `--------------------------------------------------\n` +
                 res.listaOmitidos.join('\n') +
                 `\n--------------------------------------------------`;
          try {
            navigator.clipboard.writeText(res.listaOmitidos.join('\n'));
            msg += `\n\n(Copiado al portapapeles)`;
          } catch(e) {}
        }

        alert(msg);
        this.cargarItinerarios();
      },
      error: (err) => {
        console.error('Error al unificar:', err);
        alert('Hubo un error al unificar los itinerarios.');
      }
    });
  }

  private resetearFormulario(): void {
    this.itinerarioActualizado = {
      id: 0,
      viajePrevistoId: this.viajePrevistoId,
      fechaInicio: '',
      fechaFin: '',
      duracionDias: 0,
      destinosPorDia: '',
      descripcionGeneral: '',
      horaInicio: '',
      horaFin: '',
      climaGeneral: '',
      tipoDeViaje: 'costa'
    };
  }
}
