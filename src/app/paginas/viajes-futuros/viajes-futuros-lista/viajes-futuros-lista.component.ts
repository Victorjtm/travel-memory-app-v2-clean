import { Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Router } from '@angular/router';
import { ViajesFuturosService, ViajeFuturo } from '../../../servicios/viajes-futuros.service';

@Component({
  selector: 'app-viajes-futuros-lista',
  standalone: true,
  imports: [RouterModule],  // Solo RouterModule
  templateUrl: './viajes-futuros-lista.component.html',
  styleUrls: ['./viajes-futuros-lista.component.scss']
})
export class ViajesFuturosListaComponent implements OnInit {

  viajes: ViajeFuturo[] = [];
  cargando = false;
  error: string | null = null;

  constructor(
    private viajesFuturosService: ViajesFuturosService,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.cargarViajes();
  }

  cargarViajes(): void {
    this.cargando = true;
    this.error = null;

    this.viajesFuturosService.obtenerViajesFuturos('planificado').subscribe({
      next: (data) => {
        this.viajes = data;
        this.cargando = false;
      },
      error: (err) => {
        console.error('Error cargando viajes futuros:', err);
        this.error = err.message || 'Error al cargar viajes futuros';
        this.cargando = false;
      }
    });
  }

  abrirDetalle(viaje: ViajeFuturo): void {
    if (!viaje.id) { return; }
    this.router.navigate(['/viaje-futuro', viaje.id]);
  }
}
