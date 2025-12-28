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
      console.log('[VIAJES ORDENADOS]', this.viajesPrevistos);
    });
  }

  eliminarViaje(id: number) {
    console.log('[ELIMINAR] Enviando petición para eliminar viaje con id:', id);
    this.viajesPrevistosService.eliminarViaje(id).subscribe(() => {
      console.log('[ELIMINAR] Eliminado en servidor, actualizando lista local...');
      this.viajesPrevistos = this.viajesPrevistos.filter((viaje) => viaje.id !== id);
      console.log('[ELIMINAR] Lista actualizada:', this.viajesPrevistos);
    });
  }

  actualizarViaje(id: number, viaje: any) {
    console.log('[ACTUALIZAR] Enviando datos al servidor. ID:', id, 'Datos:', viaje);
    this.viajesPrevistosService.actualizarViaje(id, viaje).subscribe((respuesta) => {
      console.log('[ACTUALIZAR] Respuesta del servidor:', respuesta);
      const index = this.viajesPrevistos.findIndex((v) => v.id === id);
      if (index !== -1) {
        this.viajesPrevistos[index] = viaje;
        // Reordenar después de actualizar
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
      // Reordenar después de añadir
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

  ejecutarUnificacion() {
    if (!confirm('¿Estás seguro de que quieres unificar los viajes con el mismo destino? Esta acción fusionará itinerarios y eliminará los viajes duplicados.')) {
      return;
    }

    console.log('[UNIFICAR] Iniciando proceso...');
    // Mostrar feedback visual simple si no hay spinner global
    // idealmente usaríamos un loading state, pero alert funciona como bloqueo sync-like para el usuario

    this.viajesPrevistosService.unificarViajes().subscribe({
      next: (res) => {
        console.log('[UNIFICAR] Respuesta:', res);
        if (res.success) {
          let msg = res.message;
          if (res.errores && res.errores.length > 0) {
            msg += '\n\n⚠️ Conflictos no resueltos:\n' + res.errores.map((e: any) => `- ${e.destino}: ${e.error}`).join('\n');
          }
          alert(msg);
          // Recargar lista
          this.ngOnInit();
        } else {
          alert('Error: ' + res.message);
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
}
