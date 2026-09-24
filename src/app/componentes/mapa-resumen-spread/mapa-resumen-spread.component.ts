import {
  Component,
  Input,
  OnInit,
  AfterViewInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  ViewChild,
  ElementRef,
  NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as L from 'leaflet';
import { GpxAnimationService, GpxPoint } from '../../servicios/gpx-animation.service';

@Component({
  selector: 'app-mapa-resumen-spread',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './mapa-resumen-spread.component.html',
  styleUrls: ['./mapa-resumen-spread.component.scss']
})
export class MapaResumenSpreadComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('mapContainer', { static: false }) mapContainer!: ElementRef<HTMLDivElement>;

  @Input() trackGpx: string = '';
  @Input() titulo: string = 'Recorrido del Viaje';
  @Input() subtitulo: string = 'Recorrido unificado y panorámica completa';
  @Input() distanciaKm: number = 0;
  @Input() fechaInicio?: string;
  @Input() fechaFin?: string;
  @Input() duracionDias?: number;
  @Input() itinerariosCount?: number = 1;
  @Input() itinerariosLista?: any[] = [];
  @Input() esMapaGeneral: boolean = false;
  @Input() esMapaItinerario: boolean = false;

  mapaListo: boolean = false;
  capaActual: 'satelite' | 'calles' = 'satelite';

  private map: L.Map | null = null;
  private polylineGroup: L.LayerGroup | null = null;
  private layerSatelite: L.TileLayer | null = null;
  private layerCalles: L.TileLayer | null = null;
  private coordenadas: [number, number][] = [];
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private gpxService: GpxAnimationService,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    if (this.trackGpx) {
      setTimeout(() => this.inicializarMapa(), 60);
    }

    if (this.mapContainer?.nativeElement) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.map) {
          this.map.invalidateSize();
        }
      });
      this.resizeObserver.observe(this.mapContainer.nativeElement);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['trackGpx'] && !changes['trackGpx'].isFirstChange()) {
      setTimeout(() => this.inicializarMapa(), 60);
    }
  }

  ngOnDestroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  private inicializarMapa(): void {
    if (!this.mapContainer?.nativeElement || !this.trackGpx) return;

    try {
      // 1. Parsear puntos GPX
      const puntos: GpxPoint[] = this.gpxService.parseGpx(this.trackGpx);
      if (!puntos || puntos.length === 0) {
        this.mapaListo = true;
        return;
      }

      this.coordenadas = puntos.map(p => [p.lat, p.lng] as [number, number]);

      // 2. Limpiar instancia anterior si existe
      if (this.map) {
        this.map.remove();
        this.map = null;
      }

      const container = this.mapContainer.nativeElement;

      // 3. Crear mapa Leaflet
      this.map = L.map(container, {
        zoomControl: false,
        attributionControl: false,
        maxZoom: 19
      });

      // 4. Capas base: Satélite Esri (por defecto como en la captura 1) y OpenStreetMap
      this.layerSatelite = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri', maxZoom: 18 }
      );

      this.layerCalles = L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { attribution: '&copy; OpenStreetMap', maxZoom: 19 }
      );

      if (this.capaActual === 'satelite') {
        this.layerSatelite.addTo(this.map);
      } else {
        this.layerCalles.addTo(this.map);
      }

      // 5. Grupo de capas para la ruta y marcadores de inicio/fin
      this.polylineGroup = L.layerGroup().addTo(this.map);

      // Trazo exterior de contraste blanco
      L.polyline(this.coordenadas, {
        color: '#FFFFFF',
        weight: 6,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(this.polylineGroup);

      // Trazo interior cian / azul eléctrico vibrante (idéntico a la captura 1)
      L.polyline(this.coordenadas, {
        color: '#00D2FF',
        weight: 4,
        opacity: 1.0,
        smoothFactor: 1,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(this.polylineGroup);

      // 6. Flechas sutiles de sentido de viaje
      this.agregarFlechasDireccion(this.coordenadas, '#00D2FF');

      // 7. Marcador sutil de Inicio (Verde) y Fin (Rojo) - ¡SIN NÚMEROS DE FOTOS!
      const primerPunto = this.coordenadas[0];
      const ultimoPunto = this.coordenadas[this.coordenadas.length - 1];

      const inicioIcon = L.divIcon({
        className: 'marker-punto-inicio',
        html: `<div style="background-color: #10B981; width: 14px; height: 14px; border-radius: 50%; border: 2.5px solid white; box-shadow: 0 0 8px rgba(0,0,0,0.6);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });
      L.marker(primerPunto, { icon: inicioIcon }).bindPopup('<b>Inicio del Recorrido</b>').addTo(this.polylineGroup);

      const finIcon = L.divIcon({
        className: 'marker-punto-fin',
        html: `<div style="background-color: #EF4444; width: 14px; height: 14px; border-radius: 50%; border: 2.5px solid white; box-shadow: 0 0 8px rgba(0,0,0,0.6);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });
      L.marker(ultimoPunto, { icon: finIcon }).bindPopup('<b>Fin del Recorrido</b>').addTo(this.polylineGroup);

      // 8. Ajustar encuadre exacto (fitBounds) con buen margen
      const bounds = L.latLngBounds(this.coordenadas);
      this.map.fitBounds(bounds, {
        padding: [60, 60],
        maxZoom: 15,
        animate: false
      });

      this.mapaListo = true;

      setTimeout(() => {
        if (this.map) {
          this.map.invalidateSize();
          this.map.fitBounds(bounds, { padding: [60, 60] });
        }
      }, 150);
    } catch (e) {
      console.error('❌ Error al inicializar MapaResumenSpread:', e);
      this.mapaListo = true;
    }
  }

  private agregarFlechasDireccion(coords: [number, number][], color: string): void {
    if (!this.map || !this.polylineGroup || coords.length < 2) return;

    const total = coords.length;
    const intervalo = Math.max(Math.floor(total / 10), 40);

    for (let i = intervalo; i < total; i += intervalo) {
      const prev = coords[i - 1];
      const curr = coords[i];

      const lat1 = (prev[0] * Math.PI) / 180;
      const lon1 = (prev[1] * Math.PI) / 180;
      const lat2 = (curr[0] * Math.PI) / 180;
      const lon2 = (curr[1] * Math.PI) / 180;
      const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
      const angulo = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

      const arrowIcon = L.divIcon({
        className: 'flecha-direccion-svg',
        html: `<svg width="14" height="14" viewBox="0 0 32 32" style="transform: rotate(${angulo}deg); filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));">
          <path d="M 6 24 L 16 8 L 26 24" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M 6 24 L 16 8 L 26 24" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });

      L.marker(curr, { icon: arrowIcon, interactive: false, keyboard: false }).addTo(this.polylineGroup);
    }
  }

  zoomIn(): void {
    if (this.map) this.map.zoomIn();
  }

  zoomOut(): void {
    if (this.map) this.map.zoomOut();
  }

  recentrar(): void {
    if (this.map && this.coordenadas.length > 0) {
      const bounds = L.latLngBounds(this.coordenadas);
      this.map.fitBounds(bounds, { padding: [60, 60], animate: true });
    }
  }

  toggleCapa(): void {
    if (!this.map || !this.layerSatelite || !this.layerCalles) return;

    if (this.capaActual === 'satelite') {
      this.map.removeLayer(this.layerSatelite);
      this.layerCalles.addTo(this.map);
      this.capaActual = 'calles';
    } else {
      this.map.removeLayer(this.layerCalles);
      this.layerSatelite.addTo(this.map);
      this.capaActual = 'satelite';
    }
  }
}
