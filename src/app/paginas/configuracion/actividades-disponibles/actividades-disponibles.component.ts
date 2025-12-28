import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { ActividadesDisponibles } from '../../../modelos/actividades-disponibles.model';
import { ActividadesDisponiblesService } from '../../../servicios/actividades-disponibles.service';

@Component({
  selector: 'app-actividades-disponibles',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './actividades-disponibles.component.html',
  styleUrls: ['./actividades-disponibles.component.scss']
})
export class ActividadesDisponiblesComponent implements OnInit {
  actividades: ActividadesDisponibles[] = [];
  todasLasActividades: ActividadesDisponibles[] = [];
  loading = false;

  // Gestión de alertas y confirmaciones
  showDeleteConfirm = false;
  actividadToDelete: number | null = null;
  alertMessage = '';
  alertType: 'success' | 'error' = 'success';
  showAlert = false;

  constructor(
    private actividadesService: ActividadesDisponiblesService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      const tipoActividadId = params['tipo'];
      this.cargarActividades(tipoActividadId);
    });
  }

  /**
   * Carga todas las actividades y filtra por tipo si se indica
   */
  cargarActividades(tipoActividadId?: number): void {
    this.loading = true;
    this.actividadesService.obtenerTodos().subscribe({
      next: (data) => {
        this.todasLasActividades = data;
        if (tipoActividadId) {
          this.actividades = data.filter(act => act.tipoActividadId === +tipoActividadId);
        } else {
          this.actividades = data;
        }
        this.loading = false;
      },
      error: (error) => {
        console.error('Error cargando actividades disponibles', error);
        this.mostrarAlerta('No se pudieron cargar las actividades disponibles.', 'error');
        this.loading = false;
      }
    });
  }

  /**
   * Muestra la ventana de confirmación para eliminar una actividad
   */
  confirmarEliminacion(id: number): void {
    this.actividadToDelete = id;
    this.showDeleteConfirm = true;
  }

  /**
   * Elimina la actividad seleccionada
   */
  eliminarActividad(): void {
    if (this.actividadToDelete == null) return;

    this.actividadesService.eliminar(this.actividadToDelete).subscribe({
      next: () => {
        this.mostrarAlerta('Actividad eliminada correctamente.', 'success');
        // Recargar actividades con el mismo filtro
        this.route.queryParams.subscribe(params => {
          const tipoActividadId = params['tipo'];
          this.cargarActividades(tipoActividadId);
        });
      },
      error: (error) => {
        console.error('Error eliminando actividad', error);
        this.mostrarAlerta('No se pudo eliminar la actividad.', 'error');
      },
      complete: () => {
        this.resetEliminarEstado();
      }
    });
  }

  /**
   * Cancela el proceso de eliminación
   */
  cancelarEliminacion(): void {
    this.resetEliminarEstado();
  }

  /**
   * Muestra una alerta temporal al usuario
   */
  private mostrarAlerta(mensaje: string, tipo: 'success' | 'error'): void {
    this.alertMessage = mensaje;
    this.alertType = tipo;
    this.showAlert = true;
    setTimeout(() => this.showAlert = false, 3000);
  }

  /**
   * Limpia los estados relacionados con la eliminación
   */
  private resetEliminarEstado(): void {
    this.showDeleteConfirm = false;
    this.actividadToDelete = null;
  }
}
