import { Component, Input, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GpxAnimationService, GpxPoint } from '../../servicios/gpx-animation.service';

@Component({
  selector: 'app-mini-mapa-gpx',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mini-mapa-gpx-container">
      <div #miniMapElement class="mini-mapa-canvas" [class.mapa-listo]="mapaListo"></div>
      <div class="mini-mapa-spinner" *ngIf="!mapaListo">
        <div class="spinner-mini"></div>
      </div>
    </div>
  `,
  styles: [`
    .mini-mapa-gpx-container {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 200px;
      max-height: 295px;
      border-radius: 2px;
      overflow: hidden;
      background: #f4ebd8;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .mini-mapa-canvas {
      width: 100%;
      height: 100%;
      opacity: 0;
      transition: opacity 0.35s ease;
      pointer-events: none;

      &.mapa-listo {
        opacity: 1;
      }
    }

    .mini-mapa-spinner {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(244, 235, 216, 0.7);
      z-index: 5;

      .spinner-mini {
        width: 32px;
        height: 32px;
        border: 3px solid rgba(139, 90, 43, 0.2);
        border-top-color: #8b5a2b;
        border-radius: 50%;
        animation: spinMini 0.75s linear infinite;
      }
    }

    @keyframes spinMini {
      to { transform: rotate(360deg); }
    }
  `]
})
export class MiniMapaGpxComponent implements OnInit, AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('miniMapElement', { static: false }) miniMapElement!: ElementRef<HTMLDivElement>;
  @Input() trackGpx: string = '';

  mapaListo: boolean = false;
  private map: any = null;
  private L: any = null;

  constructor(private gpxService: GpxAnimationService) {}

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    if (this.trackGpx) {
      setTimeout(() => this.renderMiniMapa(), 50);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['trackGpx'] && !changes['trackGpx'].isFirstChange()) {
      setTimeout(() => this.renderMiniMapa(), 50);
    }
  }

  private async renderMiniMapa(): Promise<void> {
    if (!this.trackGpx || !this.miniMapElement?.nativeElement) return;

    try {
      if (!this.L) {
        this.L = await import('leaflet');
      }

      if (this.map) {
        this.map.remove();
        this.map = null;
      }

      const points: GpxPoint[] = this.gpxService.parseGpx(this.trackGpx);
      if (!points || points.length === 0) {
        this.mapaListo = true;
        return;
      }

      const latlngs = points.map(p => [p.lat, p.lng]);

      const container = this.miniMapElement.nativeElement;
      this.map = this.L.map(container, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        touchZoom: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false
      });

      const tileLayer = this.L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom: 18 }
      );
      tileLayer.addTo(this.map);

      // Sombra exterior de la ruta
      this.L.polyline(latlngs, {
        color: '#ffffff',
        weight: 6,
        opacity: 0.85
      }).addTo(this.map);

      // Línea principal de la ruta
      const polyline = this.L.polyline(latlngs, {
        color: '#dc2626',
        weight: 3.5,
        opacity: 0.95
      }).addTo(this.map);

      // Marcadores inicio y fin
      const startPoint = latlngs[0];
      const endPoint = latlngs[latlngs.length - 1];

      this.L.circleMarker(startPoint, {
        radius: 5,
        fillColor: '#16a34a',
        color: '#ffffff',
        weight: 2,
        fillOpacity: 1
      }).addTo(this.map);

      this.L.circleMarker(endPoint, {
        radius: 5,
        fillColor: '#dc2626',
        color: '#ffffff',
        weight: 2,
        fillOpacity: 1
      }).addTo(this.map);

      this.map.fitBounds(polyline.getBounds(), {
        padding: [14, 14],
        animate: false
      });

      tileLayer.on('load', () => {
        this.mapaListo = true;
        if (this.map) this.map.invalidateSize();
      });

      setTimeout(() => {
        this.mapaListo = true;
        if (this.map) this.map.invalidateSize();
      }, 700);

    } catch (e) {
      console.warn('⚠️ [MiniMapaGpxComponent] Error al renderizar mini mapa:', e);
      this.mapaListo = true;
    }
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}
