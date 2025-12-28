import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router'; // <-- Añadir esto
import { TipoActividad } from '../../../modelos/tipo-actividad.model';
import { TiposActividadService } from '../../../servicios/tipos-actividad.service';

@Component({
  selector: 'app-crud-tipos-actividad',
  standalone: true, // <-- Si usas standalone
  imports: [
    CommonModule,
    RouterModule // <-- Añadir esto
  ],
  templateUrl: './crud-tipos-actividad.component.html',
  styleUrls: ['./crud-tipos-actividad.component.scss']
})
export class CrudTiposActividadComponent implements OnInit {
  tiposActividad: TipoActividad[] = [];
  loading = true;
  showDeleteConfirm = false;
  tipoToDelete: number | null = null;
  alertMessage = '';
  showAlert = false;
  alertType: 'success' | 'error' = 'success';

  constructor(
    private tiposActividadService: TiposActividadService
  ) { }

  ngOnInit(): void {
    this.cargarTiposActividad();
  }

  cargarTiposActividad(): void {
    this.loading = true;
    this.tiposActividadService.obtenerTodos().subscribe({
      next: (data) => {
        this.tiposActividad = data;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error cargando tipos de actividad', err);
        this.mostrarAlerta('No se pudieron cargar los tipos de actividad', 'error');
        this.loading = false;
      }
    });
  }

  confirmarEliminacion(id: number): void {
    this.tipoToDelete = id;
    this.showDeleteConfirm = true;
  }

  eliminarTipoActividad(): void {
    if (!this.tipoToDelete) return;

    this.tiposActividadService.eliminar(this.tipoToDelete).subscribe({
      next: () => {
        this.mostrarAlerta('Tipo de actividad eliminado', 'success');
        this.cargarTiposActividad();
      },
      error: (err) => {
        console.error('Error eliminando tipo de actividad', err);
        this.mostrarAlerta('No se pudo eliminar el tipo de actividad', 'error');
      },
      complete: () => {
        this.showDeleteConfirm = false;
        this.tipoToDelete = null;
      }
    });
  }

  cancelarEliminacion(): void {
    this.showDeleteConfirm = false;
    this.tipoToDelete = null;
  }

  private mostrarAlerta(mensaje: string, tipo: 'success' | 'error'): void {
    this.alertMessage = mensaje;
    this.alertType = tipo;
    this.showAlert = true;
    setTimeout(() => this.showAlert = false, 3000);
  }
}