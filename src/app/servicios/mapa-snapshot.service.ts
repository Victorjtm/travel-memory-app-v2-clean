import { Injectable } from '@angular/core';
import { GpxAnimationService, GpxPoint } from './gpx-animation.service';
import html2canvas from 'html2canvas';

export interface SnapshotProgress {
  actual: number;
  total: number;
  porcentaje: number;
  mensaje: string;
}

@Injectable({
  providedIn: 'root'
})
export class MapaSnapshotService {
  private cacheMemoria = new Map<string, string>();
  private L: any = null;

  constructor(private gpxService: GpxAnimationService) {}

  /**
   * Genera un hash simple a partir del texto GPX y sus parámetros para la caché
   */
  private generarHash(gpxText: string, ancho: number, alto: number): string {
    let hash = 0;
    const str = `${gpxText.substring(0, 300)}_${gpxText.length}_${ancho}x${alto}`;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return `map_snapshot_${Math.abs(hash)}`;
  }

  /**
   * Obtiene la imagen de la caché o la genera de forma asíncrona
   */
  async obtenerSnapshotRuta(
    gpxText: string,
    distanciaKm?: number,
    tipoTransporte: string = 'driving',
    ancho: number = 720,
    alto: number = 520
  ): Promise<string> {
    if (!gpxText) return '';

    const cacheKey = this.generarHash(gpxText, ancho, alto);

    // 1. Comprobar caché en memoria
    if (this.cacheMemoria.has(cacheKey)) {
      return this.cacheMemoria.get(cacheKey)!;
    }

    // 2. Comprobar caché en localStorage
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached && cached.startsWith('data:image')) {
        this.cacheMemoria.set(cacheKey, cached);
        return cached;
      }
    } catch {
      // Ignorar si localStorage falla por cuota
    }

    // 3. Generar nuevo snapshot
    const dataUrl = await this.renderizarSnapshotOffscreen(gpxText, distanciaKm, tipoTransporte, ancho, alto);
    
    if (dataUrl) {
      this.cacheMemoria.set(cacheKey, dataUrl);
      try {
        localStorage.setItem(cacheKey, dataUrl);
      } catch {
        // Cuota excedida en localStorage, mantener en memoria
      }
    }

    return dataUrl;
  }

  private async renderizarSnapshotOffscreen(
    gpxText: string,
    distanciaKm?: number,
    tipoTransporte: string = 'driving',
    ancho: number = 720,
    alto: number = 520
  ): Promise<string> {
    if (!this.L) {
      this.L = await import('leaflet');
    }

    const points: GpxPoint[] = this.gpxService.parseGpx(gpxText);
    if (!points || points.length === 0) return '';

    const latlngs = points.map(p => [p.lat, p.lng]);

    // Crear contenedor temporal fuera de la pantalla
    const offscreenDiv = document.createElement('div');
    offscreenDiv.style.position = 'fixed';
    offscreenDiv.style.left = '-9999px';
    offscreenDiv.style.top = '-9999px';
    offscreenDiv.style.width = `${ancho}px`;
    offscreenDiv.style.height = `${alto}px`;
    offscreenDiv.style.zIndex = '-1000';
    offscreenDiv.style.overflow = 'hidden';
    offscreenDiv.style.borderRadius = '4px';
    offscreenDiv.style.background = '#f4ebd8';
    document.body.appendChild(offscreenDiv);

    try {
      const map = this.L.map(offscreenDiv, {
        zoomControl: false,
        attributionControl: false,
        fadeAnimation: false,
        zoomAnimation: false,
        markerZoomAnimation: false,
        dragging: false,
        touchZoom: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false
      });

      // Cartografía estándar OSM con CORS habilitado
      const tileLayer = this.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        crossOrigin: true
      }).addTo(map);

      // Dibujar Sombra blanca de la ruta
      this.L.polyline(latlngs, {
        color: '#ffffff',
        weight: 7,
        opacity: 0.95
      }).addTo(map);

      // Dibujar Línea principal roja
      const polyline = this.L.polyline(latlngs, {
        color: '#dc2626',
        weight: 4.2,
        opacity: 0.98
      }).addTo(map);

      // Puntos inicio (verde) y fin (rojo)
      const startPt = latlngs[0];
      const endPt = latlngs[latlngs.length - 1];

      this.L.circleMarker(startPt, {
        radius: 8,
        fillColor: '#16a34a',
        color: '#ffffff',
        weight: 3,
        fillOpacity: 1
      }).addTo(map);

      this.L.circleMarker(endPt, {
        radius: 8,
        fillColor: '#dc2626',
        color: '#ffffff',
        weight: 3,
        fillOpacity: 1
      }).addTo(map);

      map.fitBounds(polyline.getBounds(), {
        padding: [35, 35],
        animate: false
      });

      // Esperar a que las teselas carguen completamente
      await new Promise<void>((resolve) => {
        let terminado = false;
        const finalizar = () => {
          if (!terminado) {
            terminado = true;
            resolve();
          }
        };

        tileLayer.on('load', finalizar);
        setTimeout(finalizar, 1500); // Timeout de seguridad máximo 1.5s
      });

      // Forzar ajuste de dimensiones
      map.invalidateSize();
      await new Promise(r => setTimeout(r, 100));

      // Captura con html2canvas
      const canvas = await html2canvas(offscreenDiv, {
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#f4ebd8',
        logging: false,
        scale: 1
      });

      // Dibujar badge elegante en el canvas final
      const ctx = canvas.getContext('2d');
      if (ctx && distanciaKm) {
        this.dibujarBadgeEnCanvas(ctx, distanciaKm, tipoTransporte, canvas.width, canvas.height);
      }

      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);

      map.remove();
      return dataUrl;

    } catch (e) {
      console.warn('⚠️ [MapaSnapshotService] Error al capturar snapshot de mapa:', e);
      return '';
    } finally {
      if (offscreenDiv && offscreenDiv.parentNode) {
        offscreenDiv.parentNode.removeChild(offscreenDiv);
      }
    }
  }

  private dibujarBadgeEnCanvas(
    ctx: CanvasRenderingContext2D,
    distanciaKm: number,
    tipoTransporte: string,
    anchoCanvas: number,
    altoCanvas: number
  ): void {
    const texto = `${this.getTransportIcon(tipoTransporte)} ${distanciaKm.toFixed(1)} km`;
    ctx.save();
    ctx.font = 'bold 16px "Cinzel", "Georgia", serif';
    const textWidth = ctx.measureText(texto).width;
    const badgeW = textWidth + 28;
    const badgeH = 34;
    const x = anchoCanvas - badgeW - 16;
    const y = altoCanvas - badgeH - 16;
    const radio = 17;

    // Fondo del badge con sombra
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.strokeStyle = '#bfa15f';
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.roundRect(x, y, badgeW, badgeH, radio);
    ctx.fill();
    ctx.stroke();

    // Texto
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#2b1810';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(texto, x + (badgeW / 2), y + (badgeH / 2));

    ctx.restore();
  }

  private getTransportIcon(mode: string): string {
    const m = (mode || '').toLowerCase();
    if (m.includes('walk') || m.includes('andando') || m.includes('pie') || m.includes('caminar')) return '🚶';
    if (m.includes('boat') || m.includes('barco') || m.includes('ferry')) return '🚢';
    if (m.includes('plane') || m.includes('avion') || m.includes('vuelo')) return '✈️';
    if (m.includes('train') || m.includes('tren')) return '🚆';
    if (m.includes('bicycle') || m.includes('bici') || m.includes('bike')) return '🚴';
    return '🚗';
  }
}
