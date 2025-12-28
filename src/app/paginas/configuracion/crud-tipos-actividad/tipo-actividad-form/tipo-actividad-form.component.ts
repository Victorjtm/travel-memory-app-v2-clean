import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router'; // <-- Añadido RouterModule
import { TipoActividad } from '../../../../modelos/tipo-actividad.model';
import { TiposActividadService } from '../../../../servicios/tipos-actividad.service';

@Component({
  selector: 'app-tipo-actividad-form',
  standalone: true, // <-- Asumiendo que es standalone
  imports: [
    CommonModule,
    FormsModule,
    RouterModule // <-- Añadido aquí
  ],
  templateUrl: './tipo-actividad-form.component.html',
  styleUrls: ['./tipo-actividad-form.component.scss']
})
export class TipoActividadFormComponent implements OnInit {
  tipoActividad: TipoActividad = {
    id: 0,
    nombre: '',
    descripcion: ''
  };
  editMode = false;
  loading = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private tiposActividadService: TiposActividadService
  ) { }

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      if (params['id']) {
        this.editMode = true;
        this.loadTipoActividad(params['id']);
      }
    });
  }

  loadTipoActividad(id: number): void {
    this.loading = true;
    this.tiposActividadService.obtenerPorId(id).subscribe({
      next: (data) => {
        this.tipoActividad = data;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error cargando tipo de actividad', err);
        this.loading = false;
      }
    });
  }

  onSubmit(): void {
    if (this.editMode) {
      this.tiposActividadService.actualizar(this.tipoActividad.id, this.tipoActividad).subscribe({
        next: () => this.router.navigate(['/configuracion/tipos-actividad']),
        error: (err) => console.error('Error actualizando tipo de actividad', err)
      });
    } else {
      this.tiposActividadService.crear(this.tipoActividad).subscribe({
        next: () => this.router.navigate(['/configuracion/tipos-actividad']),
        error: (err) => console.error('Error creando tipo de actividad', err)
      });
    }
  }

  onCancel(): void {
    this.router.navigate(['/configuracion/tipos-actividad']);
  }
}