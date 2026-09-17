import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SaludService, HealthActivity, BodyMetric } from '../../servicios/salud.service';
import { SaludUploadModalComponent } from '../../componentes/salud-upload-modal/salud-upload-modal.component';

@Component({
  selector: 'app-mi-salud',
  standalone: true,
  imports: [CommonModule, FormsModule, SaludUploadModalComponent],
  templateUrl: './mi-salud.component.html',
  styleUrls: ['./mi-salud.component.scss']
})
export class MiSaludComponent implements OnInit {
  tabActiva: 'bascula' | 'reloj' = 'bascula';
  cargando: boolean = true;
  errorMensaje: string = '';

  actividades: HealthActivity[] = [];
  metricasCorporales: BodyMetric[] = [];

  // Modal
  mostrarModalSalud: boolean = false;
  modalItineraryId: number = 0;
  modalActivityId: number | null = null;

  // Actividad seleccionada para ver splits en detalle
  actividadSeleccionada: HealthActivity | null = null;

  constructor(private saludService: SaludService) {}

  ngOnInit(): void {
    this.cargarDatos();
  }

  cargarDatos(): void {
    this.cargando = true;
    this.errorMensaje = '';

    this.saludService.getBodyMetrics().subscribe({
      next: (metricas) => {
        this.metricasCorporales = metricas || [];
        this.saludService.getActivities().subscribe({
          next: (acts) => {
            this.actividades = acts || [];
            if (this.metricasCorporales.length === 0 && this.actividades.length > 0) {
              this.tabActiva = 'reloj';
            }
            this.cargando = false;
          },
          error: (err) => {
            console.error('Error cargando actividades:', err);
            this.cargando = false;
          }
        });
      },
      error: (err) => {
        console.error('Error cargando métricas:', err);
        this.cargando = false;
        this.errorMensaje = 'No se pudieron cargar los datos de salud.';
      }
    });
  }

  // Getters para resumen clínico
  get ultimoPesaje(): BodyMetric | null {
    if (!this.metricasCorporales || this.metricasCorporales.length === 0) return null;
    return this.metricasCorporales[this.metricasCorporales.length - 1];
  }

  get pesajeAnterior(): BodyMetric | null {
    if (!this.metricasCorporales || this.metricasCorporales.length < 2) return null;
    return this.metricasCorporales[this.metricasCorporales.length - 2];
  }

  get diferenciaPeso(): number | null {
    if (!this.ultimoPesaje || !this.pesajeAnterior) return null;
    return +(this.ultimoPesaje.weight_kg - this.pesajeAnterior.weight_kg).toFixed(2);
  }

  get totalKmCaminados(): number {
    return +this.actividades.reduce((acc, a) => acc + (Number(a.distance_km) || 0), 0).toFixed(2);
  }

  get totalPasos(): number {
    return this.actividades.reduce((acc, a) => acc + (Number(a.steps) || 0), 0);
  }

  get totalCaloriasActivas(): number {
    return this.actividades.reduce((acc, a) => acc + (Number(a.calories_active) || 0), 0);
  }

  getEstadoIMC(bmi: number): { label: string; color: string } {
    if (!bmi) return { label: 'Sin datos', color: '#94a3b8' };
    if (bmi < 18.5) return { label: 'Bajo peso', color: '#38bdf8' };
    if (bmi < 25) return { label: 'Normal / Saludable', color: '#34d399' };
    if (bmi < 30) return { label: 'Sobrepeso', color: '#fbbf24' };
    return { label: 'Obesidad', color: '#f87171' };
  }

  seleccionarActividad(act: HealthActivity): void {
    if (this.actividadSeleccionada?.id === act.id) {
      this.actividadSeleccionada = null;
      return;
    }
    this.saludService.getActivityDetails(act.id).subscribe({
      next: (details) => {
        this.actividadSeleccionada = details;
      },
      error: () => {
        this.actividadSeleccionada = act;
      }
    });
  }

  abrirModal(): void {
    this.modalItineraryId = this.actividades.length > 0 ? this.actividades[0].itinerary_id : 1;
    this.mostrarModalSalud = true;
  }

  cerrarModal(): void {
    this.mostrarModalSalud = false;
  }

  onUploadCompletado(): void {
    this.cargarDatos();
  }

  eliminarActividad(id: number, event: Event): void {
    event.stopPropagation();
    if (confirm('¿Deseas eliminar este registro de caminata?')) {
      this.saludService.deleteActivity(id).subscribe(() => {
        if (this.actividadSeleccionada?.id === id) this.actividadSeleccionada = null;
        this.cargarDatos();
      });
    }
  }

  eliminarMetrica(id: number, event: Event): void {
    event.stopPropagation();
    if (confirm('¿Deseas eliminar este pesaje?')) {
      this.saludService.deleteBodyMetric(id).subscribe(() => {
        this.cargarDatos();
      });
    }
  }
}
