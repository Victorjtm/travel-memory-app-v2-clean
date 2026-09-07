import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { ConfirmacionRutaDialogComponent } from '../componentes/confirmacion-ruta-dialog/confirmacion-ruta-dialog.component';

export interface ViajeBorrador {
  id: number;
  nombre: string;
  destino: string;
  fecha_inicio: string;
  fecha_fin: string;
  descripcion?: string;
  estado: 'borrador' | 'planificado' | 'migrado';
  itinerarioId?: number;
  actividadId?: number;
}

@Injectable({
  providedIn: 'root'
})
export class ViajesRescateService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  private get apiUrl(): string {
    return environment.apiUrl || '';
  }

  // Signals reactivas de estado
  creandoBorrador = signal<boolean>(false);
  ultimoBorradorCreado = signal<ViajeBorrador | null>(null);

  /**
   * Genera los datos semilla por defecto para el viaje y su Día 1
   */
  private generarDatosSemilla() {
    const hoy = new Date();
    const fechaIso = hoy.toISOString().split('T')[0];
    const fechaFormateada = hoy.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

    return {
      nombre: `Ruta Manual Rescate - ${fechaFormateada}`,
      destino: 'Destino por Asignar',
      fecha_inicio: fechaIso,
      fecha_fin: fechaIso,
      descripcion: 'Borrador rápido para diseño de ruta GPX en mapa',
      estado: 'borrador'
    };
  }

  /**
   * Ejecuta el flujo completo: creación silenciosa + diálogo modal interactivo + bifurcación condicional
   * @param onCreado Callback invocado al crear el viaje en SQLite con éxito (útil para refrescar listas)
   */
  crearViajeRapidoConConfirmacion(onCreado?: (viaje: ViajeBorrador) => void): void {
    this.creandoBorrador.set(true);
    const datosSemilla = this.generarDatosSemilla();

    this.http.post<ViajeBorrador>(`${this.apiUrl}/viajes/crear-borrador`, datosSemilla)
      .pipe(
        tap(viajeCreado => {
          this.creandoBorrador.set(false);
          this.ultimoBorradorCreado.set(viajeCreado);
          if (onCreado) {
            onCreado(viajeCreado);
          }
        })
      )
      .subscribe({
        next: (viajeCreado) => {
          this.abrirModalConfirmacion(viajeCreado);
        },
        error: (err) => {
          this.creandoBorrador.set(false);
          console.error('❌ Error al crear viaje rápido borrador:', err);
          alert('No se pudo inicializar el viaje rápido. Revisa que el backend esté en ejecución.');
        }
      });
  }

  /**
   * Abre el diálogo de confirmación interactivo
   */
  private abrirModalConfirmacion(viaje: ViajeBorrador): void {
    const dialogRef = this.dialog.open(ConfirmacionRutaDialogComponent, {
      width: '460px',
      disableClose: true,
      data: {
        titulo: 'Viaje rápido inicializado',
        nombreViaje: viaje.nombre
      }
    });

    dialogRef.afterClosed().subscribe((quiereEditarAhora: boolean) => {
      if (quiereEditarAhora) {
        console.log(`🗺️ [RESCATE] Redirigiendo al editor de mapas para el viaje #${viaje.id}`);
        // Redirigir a actividades del itinerario con flags para abrir automáticamente el track-editor-map
        this.router.navigate(
          ['/viajes-previstos', viaje.id, 'itinerarios', viaje.itinerarioId, 'actividades'],
          {
            queryParams: {
              abrirEditor: 'true',
              actividadId: viaje.actividadId
            }
          }
        );
      } else {
        console.log(`⏸️ [RESCATE] Viaje borrador #${viaje.id} conservado en SQLite. El usuario permanece en la pantalla.`);
      }
    });
  }
}
