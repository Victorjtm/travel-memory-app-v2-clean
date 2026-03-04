// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPONENTE: DETALLE DE VIAJE FUTURO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ViajesFuturosService,
  ViajeFuturoCompleto,
  ActividadFutura
} from '../../servicios/viajes-futuros.service';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { FormularioActividadFuturaComponent } from '../formulario-actividad-futura/formulario-actividad-futura.component';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-viaje-futuro-detalle',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatIconModule, MatButtonModule],
  templateUrl: './viaje-futuro-detalle.component.html',
  styleUrls: ['./viaje-futuro-detalle.component.scss']
})

export class ViajeFuturoDetalleComponent implements OnInit {

  // ══════════════════════════════════════════════════════════════════════
  // PROPIEDADES
  // ══════════════════════════════════════════════════════════════════════

  viaje: ViajeFuturoCompleto | null = null;
  cargando: boolean = true;
  error: string | null = null;
  viajeId: number = 0;

  // ══════════════════════════════════════════════════════════════════════
  // CONSTRUCTOR
  // ══════════════════════════════════════════════════════════════════════

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private viajesService: ViajesFuturosService,
    private dialog: MatDialog
  ) { }

  // ══════════════════════════════════════════════════════════════════════
  // CICLO DE VIDA
  // ══════════════════════════════════════════════════════════════════════

  ngOnInit(): void {
    // Obtener ID de la ruta
    this.route.params.subscribe(params => {
      this.viajeId = +params['id'];
      if (this.viajeId) {
        this.cargarViaje();
      } else {
        this.error = 'ID de viaje no válido';
        this.cargando = false;
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // MÉTODOS PRINCIPALES
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Cargar datos del viaje
   */
  cargarViaje(): void {
    this.cargando = true;
    this.error = null;

    console.log(`📖 Cargando viaje futuro ID: ${this.viajeId}`);

    this.viajesService.obtenerViajeFuturo(this.viajeId).subscribe({
      next: (data) => {
        this.viaje = data;
        this.cargando = false;
        console.log('✅ Viaje cargado:', data);
      },
      error: (error) => {
        console.error('❌ Error cargando viaje:', error);
        this.error = error.error?.error || 'Error al cargar el viaje';
        this.cargando = false;
      }
    });
  }

  /**
   * Abrir editor de actividad
   */
  abrirEditorActividad(actividad: ActividadFutura): void {
    if (!actividad.id) return;

    console.log(`✏️ Editando actividad: ${actividad.nombre} (ID: ${actividad.id})`);

    const dialogRef = this.dialog.open(FormularioActividadFuturaComponent, {
      width: '550px',
      maxHeight: '90vh',
      data: {
        actividadId: actividad.id,
        itinerarioId: actividad.itinerarioFuturoId
      },
      disableClose: true
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === 'guardado' || result === 'eliminado') {
        this.cargarViaje();
      }
    });
  }

  /**
   * Abrir nueva actividad
   */
  abrirNuevaActividad(itinerarioId: number): void {
    const dialogRef = this.dialog.open(FormularioActividadFuturaComponent, {
      width: '550px',
      data: {
        actividadId: 0,
        itinerarioId: itinerarioId
      },
      disableClose: true
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === 'guardado') {
        this.cargarViaje();
      }
    });
  }

  /**
   * Volver atrás
   */
  volver(): void {
    this.router.navigate(['/']);
  }

  /**
   * Eliminar viaje
   */
  eliminarViaje(): void {
    if (!this.viaje) return;

    const confirmar = confirm(
      `¿Estás seguro de eliminar el viaje "${this.viaje.viaje.nombre}"?\n\n` +
      `Se eliminarán también:\n` +
      `- ${this.viaje.itinerarios.length} itinerario(s)\n` +
      `- ${this.viaje.actividades.length} actividad(es)\n\n` +
      `Esta acción no se puede deshacer.`
    );

    if (!confirmar) return;

    console.log(`🗑️ Eliminando viaje ID: ${this.viajeId}`);

    this.viajesService.eliminarViajeFuturo(this.viajeId).subscribe({
      next: () => {
        console.log('✅ Viaje eliminado');
        alert('Viaje eliminado correctamente');
        this.router.navigate(['/']);
      },
      error: (error) => {
        console.error('❌ Error eliminando viaje:', error);
        alert('Error al eliminar el viaje: ' + (error.error?.error || error.message));
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // MÉTODOS AUXILIARES
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Formatear fecha (YYYY-MM-DD → DD/MM/YYYY)
   */
  formatearFecha(fecha: string): string {
    if (!fecha) return '';
    const [year, month, day] = fecha.split('-');
    return `${day}/${month}/${year}`;
  }

  /**
   * Obtener icono según tipo de viaje
   */
  getIconoTipoViaje(tipo?: string): string {
    const iconos: { [key: string]: string } = {
      'costa': '🏖️',
      'naturaleza': '🌲',
      'rural': '🏡',
      'urbana': '🏙️',
      'cultural': '🎭',
      'trabajo': '💼'
    };
    return iconos[tipo || 'urbana'] || '✈️';
  }

  /**
   * Calcular duración de actividad en minutos
   */
  calcularDuracion(horaInicio: string, horaFin: string): number {
    const [h1, m1] = horaInicio.split(':').map(Number);
    const [h2, m2] = horaFin.split(':').map(Number);
    return (h2 * 60 + m2) - (h1 * 60 + m1);
  }

  /**
   * Formatear duración (minutos → "2h 30min")
   */
  formatearDuracion(minutos: number): string {
    const horas = Math.floor(minutos / 60);
    const mins = minutos % 60;
    if (horas > 0 && mins > 0) return `${horas}h ${mins}min`;
    if (horas > 0) return `${horas}h`;
    return `${mins}min`;
  }

  /**
 * Limpiar nombre de actividad (eliminar fecha del paréntesis)
 */
  limpiarNombreActividad(nombre: string): string {
    return nombre.replace(/\s*\(\d{4}-\d{2}-\d{2}\)/, '');
  }


  /**
   * Agrupar actividades por día (extraer fecha del nombre)
   */
  agruparActividadesPorDia(): { [fecha: string]: ActividadFutura[] } {
    if (!this.viaje) return {};

    const grupos: { [fecha: string]: ActividadFutura[] } = {};

    this.viaje.actividades.forEach(act => {
      // Extraer fecha del nombre: "Nombre (2026-03-06)"
      const match = act.nombre.match(/\((\d{4}-\d{2}-\d{2})\)/);
      const fecha = match ? match[1] : 'Sin fecha';

      if (!grupos[fecha]) {
        grupos[fecha] = [];
      }
      grupos[fecha].push(act);
    });

    return grupos;
  }

  /**
   * Obtener fechas ordenadas
   */
  getFechasOrdenadas(): string[] {
    const grupos = this.agruparActividadesPorDia();
    return Object.keys(grupos).sort();
  }
}

