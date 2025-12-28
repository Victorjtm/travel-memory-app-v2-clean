import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ActividadesDisponibles as ActividadDisponible } from "../../../../modelos/actividades-disponibles.model";
import { ActividadesDisponiblesService } from '../../../../servicios/actividades-disponibles.service';
import { TipoActividad } from '../../../../modelos/tipo-actividad.model';
import { TiposActividadService } from '../../../../servicios/tipos-actividad.service';

@Component({
  selector: 'app-formulario-actividad',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule
  ],
  templateUrl: './formulario-actividad.component.html',
  styleUrls: ['./formulario-actividad.component.scss']
})
export class FormularioActividadComponent implements OnInit {
  actividad: ActividadDisponible = {
    id: 0,
    descripcion: '',
    tipoActividadId: 0
  };
  tiposActividad: TipoActividad[] = [];
  editMode = false;
  loading = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private actividadesDisponiblesService: ActividadesDisponiblesService,
    private tiposActividadService: TiposActividadService
  ) { }

  ngOnInit(): void {
    this.cargarTiposActividad();

    this.route.params.subscribe(params => {
      if (params['id']) {
        this.editMode = true;
        this.loadActividad(params['id']);
      }
    });
  }

  cargarTiposActividad(): void {
    this.tiposActividadService.obtenerTodos().subscribe({
      next: (data) => this.tiposActividad = data,
      error: (err) => console.error('Error cargando tipos de actividad', err)
    });
  }

  loadActividad(id: number): void {
    this.loading = true;
    this.actividadesDisponiblesService.obtenerPorId(id).subscribe({
      next: (data) => {
        this.actividad = data;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error cargando actividad disponible', err);
        this.loading = false;
      }
    });
  }

  onSubmit(): void {
    if (this.editMode) {
      this.actividadesDisponiblesService.actualizar(this.actividad.id, this.actividad).subscribe({
        next: () => this.router.navigate(['/configuracion/actividades-disponibles']),
        error: (err) => console.error('Error actualizando actividad', err)
      });
    } else {
      this.actividadesDisponiblesService.crear(this.actividad).subscribe({
        next: () => this.router.navigate(['/configuracion/actividades-disponibles']),
        error: (err) => console.error('Error creando actividad', err)
      });
    }
  }

  onCancel(): void {
    this.router.navigate(['/configuracion/actividades-disponibles']);
  }
}
