import { AfterViewInit, Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import * as L from 'leaflet';
import { GeolocalizacionViajesService, UbicacionViaje } from '../../../servicios/geolocalizacion-viajes.service';

@Component({
  selector: 'app-viajes-mapa',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './viajes-mapa.component.html',
  styleUrls: ['./viajes-mapa.component.scss']
})
export class ViajesMapaComponent implements AfterViewInit, OnDestroy {
  viajes: UbicacionViaje[] = [];
  cargando = false;
  mensaje = '';
  private mapa?: L.Map;
  private markersLayer?: L.LayerGroup;

  constructor(
    private geoService: GeolocalizacionViajesService,
    private router: Router
  ) { }

  ngAfterViewInit(): void {
    this.inicializarMapa();
    this.cargarViajes();
  }

  ngOnDestroy(): void {
    this.mapa?.remove();
  }

  volver(): void {
    this.router.navigate(['/viajes-previstos']);
  }

  cargarViajes(): void {
    this.cargando = true;
    this.mensaje = '';

    this.geoService.obtenerViajesConUbicacion().subscribe({
      next: (viajes) => {
        this.viajes = viajes;
        this.pintarMarcadores();
        this.cargando = false;
        if (!viajes.length) {
          this.mensaje = 'No hay ubicaciones calculadas. Usa "Migrar ubicaciones".';
        }
      },
      error: (error) => {
        console.error('❌ Error cargando viajes con ubicación:', error);
        this.cargando = false;
        this.mensaje = 'No se pudieron cargar las ubicaciones.';
      }
    });
  }

  migrarUbicaciones(): void {
    this.cargando = true;
    this.mensaje = 'Calculando ubicaciones de viajes...';

    this.geoService.migrarUbicacionesViajes().subscribe({
      next: (res) => {
        this.mensaje = `Ubicaciones actualizadas: ${res?.actualizados ?? 0}/${res?.total ?? 0}`;
        this.cargarViajes();
      },
      error: (error) => {
        console.error('❌ Error migrando ubicaciones:', error);
        this.cargando = false;
        this.mensaje = 'Error al migrar ubicaciones.';
      }
    });
  }

  private inicializarMapa(): void {
    if (this.mapa) return;

    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png'
    });

    this.mapa = L.map('mapa-viajes-previstos').setView([40.4168, -3.7038], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.mapa);

    this.markersLayer = L.layerGroup().addTo(this.mapa);
  }

  private pintarMarcadores(): void {
    if (!this.mapa || !this.markersLayer) return;

    this.markersLayer.clearLayers();
    if (!this.viajes.length) return;

    const bounds = L.latLngBounds([]);

    this.viajes.forEach((viaje) => {
      const lat = viaje.lat_representativa as number;
      const lng = viaje.lng_representativa as number;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const marker = L.marker([lat, lng]).bindPopup(`
        <strong>${viaje.nombre || viaje.destino || `Viaje #${viaje.id}`}</strong><br/>
        Destino: ${viaje.destino || 'Sin destino'}<br/>
        Método: ${viaje.metodo_calculo || 'n/d'}
      `);

      marker.addTo(this.markersLayer!);
      bounds.extend([lat, lng]);
    });

    if (bounds.isValid()) {
      this.mapa.fitBounds(bounds.pad(0.25));
    }
  }
}
