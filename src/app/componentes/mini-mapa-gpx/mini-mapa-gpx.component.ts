import { Component, Input, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GpxAnimationService, GpxPoint } from '../../servicios/gpx-animation.service';

@Component({
  selector: 'app-mini-mapa-gpx',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mini-mapa-gpx-container" [class.full-page-mode]="fullPage">
      <!-- MODO INSTANTÁNEO: Imagen pre-renderizada por Canvas (0ms de latencia, cero parpadeo de tiles) -->
      <img *ngIf="imagenInstantanea" [src]="imagenInstantanea" class="mini-mapa-img-instantanea" alt="Mapa de Ruta" />

      <!-- MODO DINÁMICO: Contenedor Canvas/Leaflet -->
      <div #miniMapElement *ngIf="!imagenInstantanea" class="mini-mapa-canvas" [class.mapa-listo]="mapaListo"></div>
      
      <!-- Overlay con badge de transporte y distancia -->
      <div class="mini-mapa-info-badge" *ngIf="mapaListo && distanciaKm">
        <span class="badge-transporte-icono">{{ getTransportIcon() }}</span>
        <span class="badge-distancia-texto">{{ distanciaKm | number:'1.1-2' }} km</span>
      </div>

      <div class="mini-mapa-spinner" *ngIf="!mapaListo && !imagenInstantanea">
        <div class="spinner-mini"></div>
      </div>
    </div>
  `,
  styles: [`
    .mini-mapa-gpx-container {
      position: relative;
      width: 100%;
      min-width: 260px;
      height: 100%;
      min-height: 200px;
      max-height: 295px;
      border-radius: 2px;
      overflow: hidden;
      background: #f4ebd8;
      display: flex;
      align-items: center;
      justify-content: center;

      &.full-page-mode {
        min-width: 280px;
        min-height: 260px;
        max-height: 100%;
      }
    }

    .mini-mapa-img-instantanea {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      border-radius: 2px;
      pointer-events: none;
      z-index: 1;
    }

    .mini-mapa-canvas {
      width: 100%;
      height: 100%;
      min-height: 200px;
      opacity: 0;
      transition: opacity 0.35s ease;
      pointer-events: none;

      &.mapa-listo {
        opacity: 1;
      }
    }

    .mini-mapa-info-badge {
      position: absolute;
      bottom: 10px;
      right: 10px;
      background: rgba(255, 255, 255, 0.94);
      backdrop-filter: blur(4px);
      border: 1px solid rgba(191, 161, 95, 0.8);
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.22);
      border-radius: 20px;
      padding: 4px 10px;
      display: flex;
      align-items: center;
      gap: 6px;
      z-index: 10;
      pointer-events: none;

      .badge-transporte-icono {
        font-size: 0.95rem;
      }

      .badge-distancia-texto {
        font-family: 'Cinzel', 'Georgia', serif;
        font-size: 0.82rem;
        font-weight: 700;
        color: #2b1810;
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
        width: 34px;
        height: 34px;
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
  @Input() fullPage: boolean = false;
  @Input() transportMode: string = 'driving';
  @Input() distanciaKm?: number;

  mapaListo: boolean = false;
  imagenInstantanea: string | null = null;
  private static cacheMiniMapas = new Map<string, string>();
  private map: any = null;
  private L: any = null;
  private polylineRef: any = null;

  constructor(private gpxService: GpxAnimationService) {}

  ngOnInit(): void {
    this.intentarCargaInstantanea();
  }

  ngAfterViewInit(): void {
    if (!this.imagenInstantanea && this.trackGpx) {
      this.intentarCargaInstantanea();
      if (!this.imagenInstantanea) {
        setTimeout(() => this.renderMiniMapa(), 50);
      }
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['trackGpx'] || changes['fullPage'] || changes['transportMode']) {
      this.intentarCargaInstantanea();
      if (!this.imagenInstantanea && this.trackGpx) {
        setTimeout(() => this.renderMiniMapa(), 50);
      }
    }
  }

  private intentarCargaInstantanea(): void {
    if (!this.trackGpx) return;
    const cacheKey = `${this.trackGpx.length}_${this.trackGpx.slice(0, 100)}_${this.transportMode}_${this.fullPage}`;
    if (MiniMapaGpxComponent.cacheMiniMapas.has(cacheKey)) {
      this.imagenInstantanea = MiniMapaGpxComponent.cacheMiniMapas.get(cacheKey)!;
      this.mapaListo = true;
      return;
    }

    try {
      const points = this.gpxService.parseGpx(this.trackGpx);
      if (points && points.length > 1) {
        const w = this.fullPage ? 420 : 320;
        const h = this.fullPage ? 320 : 220;
        const dataUrl = this.generarSnapshotCanvas(points, w, h);
        if (dataUrl) {
          MiniMapaGpxComponent.cacheMiniMapas.set(cacheKey, dataUrl);
          this.imagenInstantanea = dataUrl;
          this.mapaListo = true;
        }
      }
    } catch (e) {
      console.warn('⚠️ Error generando snapshot canvas de mini mapa:', e);
    }
  }

  private obtenerColorTransporte(): string {
    const m = (this.transportMode || '').toLowerCase();
    if (m.includes('walk') || m.includes('andando') || m.includes('pie') || m.includes('caminar')) return '#10b981';
    if (m.includes('boat') || m.includes('barco') || m.includes('ferry')) return '#06b6d4';
    if (m.includes('plane') || m.includes('avion') || m.includes('vuelo')) return '#a855f7';
    if (m.includes('train') || m.includes('tren')) return '#f59e0b';
    if (m.includes('bicycle') || m.includes('bici') || m.includes('bike')) return '#84cc16';
    return '#dc2626';
  }

  private generarSnapshotCanvas(points: GpxPoint[], width: number, height: number): string {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(300, width * 2);
    canvas.height = Math.max(200, height * 2);
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.scale(2, 2);

    const w = canvas.width / 2;
    const h = canvas.height / 2;

    // Fondo pergamino vintage elegante
    ctx.fillStyle = '#f4ebd8';
    ctx.fillRect(0, 0, w, h);

    // Bounding box
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }

    const pad = 24;
    const availW = w - 2 * pad;
    const availH = h - 2 * pad;

    const spanLat = Math.max(0.0001, maxLat - minLat);
    const spanLng = Math.max(0.0001, maxLng - minLng);
    const scale = Math.min(availW / spanLng, availH / spanLat);

    const midLat = (minLat + maxLat) / 2;
    const midLng = (minLng + maxLng) / 2;

    const proyectar = (lat: number, lng: number) => ({
      x: w / 2 + (lng - midLng) * scale,
      y: h / 2 - (lat - midLat) * scale
    });

    // Sombra blanca de contraste de la ruta
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    points.forEach((p, idx) => {
      const pt = proyectar(p.lat, p.lng);
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();

    // Línea de ruta coloreada según transporte
    ctx.beginPath();
    ctx.strokeStyle = this.obtenerColorTransporte();
    ctx.lineWidth = 3.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    points.forEach((p, idx) => {
      const pt = proyectar(p.lat, p.lng);
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();

    // Marcador Inicio (Verde)
    const ptIni = proyectar(points[0].lat, points[0].lng);
    ctx.beginPath();
    ctx.arc(ptIni.x, ptIni.y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = '#16a34a';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Marcador Fin (Rojo)
    const ptFin = proyectar(points[points.length - 1].lat, points[points.length - 1].lng);
    ctx.beginPath();
    ctx.arc(ptFin.x, ptFin.y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = '#dc2626';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    return canvas.toDataURL('image/jpeg', 0.88);
  }

  getTransportIcon(): string {
    const m = (this.transportMode || '').toLowerCase();
    if (m.includes('walk') || m.includes('andando') || m.includes('pie') || m.includes('caminar')) return '🚶';
    if (m.includes('boat') || m.includes('barco') || m.includes('ferry')) return '🚢';
    if (m.includes('plane') || m.includes('avion') || m.includes('vuelo')) return '✈️';
    if (m.includes('train') || m.includes('tren')) return '🚆';
    if (m.includes('bicycle') || m.includes('bici') || m.includes('bike')) return '🚴';
    return '🚗';
  }

  private static cachedLeafletModule: any = null;

  private async renderMiniMapa(): Promise<void> {
    if (this.imagenInstantanea) return;
    if (!this.trackGpx || !this.miniMapElement?.nativeElement) return;

    try {
      if (!this.L) {
        if (!MiniMapaGpxComponent.cachedLeafletModule) {
          MiniMapaGpxComponent.cachedLeafletModule = await import('leaflet');
        }
        this.L = MiniMapaGpxComponent.cachedLeafletModule;
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

      // Sombra exterior blanca de la ruta
      this.L.polyline(latlngs, {
        color: '#ffffff',
        weight: 6,
        opacity: 0.9
      }).addTo(this.map);

      // Línea principal de la ruta (rojo vivo)
      this.polylineRef = this.L.polyline(latlngs, {
        color: '#dc2626',
        weight: 3.8,
        opacity: 0.95
      }).addTo(this.map);

      // Marcadores inicio (verde) y fin (rojo)
      const startPoint = latlngs[0];
      const endPoint = latlngs[latlngs.length - 1];

      this.L.circleMarker(startPoint, {
        radius: 6,
        fillColor: '#16a34a',
        color: '#ffffff',
        weight: 2.5,
        fillOpacity: 1
      }).addTo(this.map);

      this.L.circleMarker(endPoint, {
        radius: 6,
        fillColor: '#dc2626',
        color: '#ffffff',
        weight: 2.5,
        fillOpacity: 1
      }).addTo(this.map);

      const reajustarLimites = () => {
        if (this.map && this.polylineRef) {
          this.map.invalidateSize();
          this.map.fitBounds(this.polylineRef.getBounds(), {
            padding: [18, 18],
            animate: false
          });
        }
      };

      reajustarLimites();

      tileLayer.on('load', () => {
        this.mapaListo = true;
        reajustarLimites();
      });

      setTimeout(() => {
        this.mapaListo = true;
        reajustarLimites();
      }, 200);

      setTimeout(() => {
        reajustarLimites();
      }, 600);

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
