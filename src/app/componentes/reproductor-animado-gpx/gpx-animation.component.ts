import { Component, Input, OnInit, OnDestroy, Output, EventEmitter, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { trigger, transition, style, animate } from '@angular/animations';
import { GpxAnimationService, GpxPoint, AnimationStats } from '../../servicios/gpx-animation.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-gpx-animation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './gpx-animation.component.html',
  styleUrls: ['./gpx-animation.component.scss'],
  animations: [
    trigger('fadeInOut', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.9)' }),
        animate('300ms ease-out', style({ opacity: 1, transform: 'scale(1)' }))
      ]),
      transition(':leave', [
        animate('200ms ease-in', style({ opacity: 0, transform: 'scale(0.9)' }))
      ])
    ])
  ]
})
export class GpxAnimationComponent implements OnInit, OnDestroy {
  @Input() gpxText!: string;
  @Input() multimedia: any[] = [];
  @Input() transportSegments: any[] = [];
  @Output() onCerrar = new EventEmitter<void>();

  // Leaflet
  private map: any;
  private polylines: any[] = []; // Soporte para múltiples colores
  private currentPolyline: any;
  private marker: any;
  private L: any;

  readonly MODE_COLORS: { [key: string]: string } = {
    walking: '#4CAF50',
    walk: '#4CAF50',
    caminar: '#4CAF50',
    andando: '#4CAF50',
    driving: '#F44336',
    car: '#F44336',
    coche: '#F44336',
    cycling: '#FF9800',
    bicycle: '#FF9800',
    bici: '#FF9800',
    running: '#2196F3',
    correr: '#2196F3',
    bus: '#9C27B0',
    autobus: '#9C27B0',
    transport: '#9E9E9E',
    transporte: '#9E9E9E'
  };

  readonly MODE_ICONS: { [key: string]: string } = {
    walking: '🚶',
    walk: '🚶',
    caminar: '🚶',
    andando: '🚶',
    driving: '🚗',
    car: '🚗',
    coche: '🚗',
    cycling: '🚲',
    bicycle: '🚲',
    bici: '🚲',
    running: '🏃',
    correr: '🏃',
    bus: '🚌',
    autobus: '🚌',
    transport: '🚀',
    transporte: '🚀'
  };

  // Animation State
  points: GpxPoint[] = [];
  currentIndex = 0;
  isPlaying = false;
  speed = 2; // Multiplicador de velocidad
  progress = 0;
  
  // Real-time Metrics
  currentDistKm = 0;
  currentSteps = 0;
  currentTimeSeg = 0;
  currentMode: string | null = null;
  
  // Estadísticas por modo
  modeStats: { [key: string]: { dist: number, time: number, steps: number } } = {};
  modeList: string[] = []; // Para mantener el orden de aparición

  stats: AnimationStats | null = null;
  
  // Multimedia Events
  activeEvent: any = null;

  private animationFrameId: number | null = null;
  private lastTimestamp = 0;

  constructor(
    private animationService: GpxAnimationService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) { }

  async ngOnInit() {
    console.log('🎬 [GpxAnimationComponent] Iniciando animación...');
    console.log('📊 [GpxAnimationComponent] Datos de transporte recibidos:', this.transportSegments);

    this.points = this.animationService.parseGpx(this.gpxText);
    this.points = this.animationService.syncMultimedia(this.points, this.multimedia);
    this.points = this.animationService.applyTransportSegments(this.points, this.transportSegments);
    this.stats = this.animationService.getStats(this.points);

    // Inicializar primer modo para el HUD y crear la primera polilínea
    if (this.points.length > 0) {
      this.currentMode = this.points[0].mode || 'walking';
      this.modeStats[this.currentMode] = { dist: 0, time: 0, steps: 0 };
      this.modeList.push(this.currentMode);
      
      // Creamos la primera polilínea para que se vea desde el inicio
      await this.initMap(); // Aseguramos que el mapa esté listo
      this.createNewPolyline(this.currentMode, [this.points[0].lat, this.points[0].lng]);
    } else {
      await this.initMap();
    }
    this.togglePlay(); // Empezar automáticamente
  }

  ngOnDestroy() {
    this.stopAnimation();
    if (this.map) this.map.remove();
  }

  private async initMap() {
    this.L = await import('leaflet');
    
    this.map = this.L.map('map-animation', {
      zoomControl: false,
      attributionControl: false
    }).setView([this.points[0].lat, this.points[0].lng], 16);

    this.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18
    }).addTo(this.map);

    // Ya no creamos una polyline global fija aquí, se creará bajo demanda en update()
    this.currentPolyline = null;

    // Marcador de posición (Icono dinámico de transporte)
    const initialMode = this.currentMode || 'walking';
    const iconHtml = `<div class="transport-icon-wrapper">${this.getModeIcon(initialMode)}</div>`;
    
    this.marker = this.L.marker([this.points[0].lat, this.points[0].lng], {
      icon: this.L.divIcon({
        className: 'custom-transport-marker',
        html: iconHtml,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      })
    }).addTo(this.map);
  }

  togglePlay() {
    this.isPlaying = !this.isPlaying;
    if (this.isPlaying) {
      this.lastTimestamp = performance.now();
      this.animate();
    } else {
      this.stopAnimation();
    }
  }

  private animate() {
    if (!this.isPlaying) return;

    this.animationFrameId = requestAnimationFrame((timestamp) => {
      this.update(timestamp);
      this.animate();
    });
  }

  private update(timestamp: number) {
    if (this.currentIndex >= this.points.length - 1) {
      this.isPlaying = false;
      return;
    }

    // El avance depende del tiempo transcurrido y la velocidad seleccionada
    // Pero para simplificar y asegurar que pasamos por todos los puntos,
    // avanzamos N puntos por frame dependiendo de la velocidad.
    // Una opción más fluida es interpolar, pero aquí avanzaremos índices proporcionalmente.
    
    // Factor de velocidad dinámico según el modo
    const speedFactor = this.getSpeedFactor(this.currentMode);
    const factor = 0.5 * this.speed * speedFactor;
    
    const prevIndexFloor = Math.floor(this.currentIndex);
    this.currentIndex += factor;
    const nextIndexFloor = Math.floor(this.currentIndex);
    
    if (nextIndexFloor > prevIndexFloor) {
      for (let i = prevIndexFloor + 1; i <= nextIndexFloor && i < this.points.length; i++) {
        const point = this.points[i];
        const prevPoint = this.points[i - 1] || this.points[0];
        
        // Actualizar Modo y Color de Ruta
        if (point.mode !== this.currentMode) {
          this.currentMode = point.mode || 'walking';
          this.createNewPolyline(this.currentMode, [point.lat, point.lng]);
          this.updateMarkerIcon(this.currentMode);
          
          if (!this.modeStats[this.currentMode]) {
            this.modeStats[this.currentMode] = { dist: 0, time: 0, steps: 0 };
            this.modeList.push(this.currentMode);
          }
        }

        // Calcular incrementos
        const d = (point.distAcum - prevPoint.distAcum) / 1000; // en km
        const t = point.timeAcum - prevPoint.timeAcum; // en seg
        
        // Acumular en modo actual
        if (this.currentMode) {
          const ms = this.modeStats[this.currentMode];
          ms.dist += d;
          ms.time += t;
          if (this.isWalkingMode(this.currentMode)) {
            ms.steps += d * 1400;
          }
        }

        // Actualizar UI Global
        this.currentDistKm = point.distAcum / 1000;
        if (this.isWalkingMode(this.currentMode)) {
           this.currentSteps = (point.distAcum / 1000) * 1400; 
        }

        this.currentTimeSeg = point.timeAcum;
        this.progress = (point.distAcum / (this.stats?.distanciaTotalKm || 1) / 1000) * 100;

        // Actualizar Mapa
        const latlng = [point.lat, point.lng];
        if (this.currentPolyline) {
          this.currentPolyline.addLatLng(latlng);
        }
        this.marker.setLatLng(latlng);
        this.map.panTo(latlng, { animate: true, duration: 0.1 });

        // Detección de Eventos
        if (point.event) {
          this.pauseForEvent(point.event);
          this.currentIndex = i;
          return;
        }
      }
    }
    
    this.cdr.detectChanges();
  }

  private pauseForEvent(event: any) {
    this.isPlaying = false;
    this.stopAnimation();
    this.activeEvent = event;
    this.cdr.detectChanges();
  }

  resumeFromEvent() {
    this.activeEvent = null;
    this.isPlaying = true;
    this.lastTimestamp = performance.now();
    this.animate();
    this.cdr.detectChanges();
  }

  private createNewPolyline(mode: string, startLatLng: any) {
    const color = this.MODE_COLORS[mode] || this.MODE_COLORS['walking'];
    this.currentPolyline = this.L.polyline([startLatLng], {
      color: color,
      weight: 6,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.map);
    this.polylines.push(this.currentPolyline);
  }

  private stopAnimation() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  cerrar() {
    this.stopAnimation();
    this.onCerrar.emit();
  }

  formatSeconds(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  getMediaUrl(ruta: string): string {
    return `${environment.apiUrl}/uploads/${ruta}`;
  }

  getModeName(mode: string | null | undefined): string {
    if (!mode) return 'Andando';
    const m = mode.toLowerCase();
    
    // Mapeo flexible
    if (m.includes('walk') || m.includes('camin') || m.includes('andan')) return 'Andando';
    if (m.includes('car') || m.includes('coch') || m.includes('driv')) return 'En Coche';
    if (m.includes('bic') || m.includes('cycl')) return 'En Bici';
    if (m.includes('run') || m.includes('corr')) return 'Corriendo';
    if (m.includes('bus')) return 'En Bus';
    if (m.includes('transp')) return 'Transporte';

    return mode.charAt(0).toUpperCase() + mode.slice(1);
  }

  public isWalkingMode(mode: string | null): boolean {
    if (!mode) return true;
    const m = mode.toLowerCase();
    return m.includes('walk') || m.includes('camin') || m.includes('andan') || m.includes('run') || m.includes('corr');
  }

  private getModeIcon(mode: string | null): string {
    if (!mode) return '📍';
    const m = mode.toLowerCase();
    
    // Mapeo flexible
    if (m.includes('walk') || m.includes('camin') || m.includes('andan')) return '🚶';
    if (m.includes('car') || m.includes('coch') || m.includes('driv')) return '🚗';
    if (m.includes('bic') || m.includes('cycl')) return '🚲';
    if (m.includes('run') || m.includes('corr')) return '🏃';
    if (m.includes('bus')) return '🚌';
    
    return this.MODE_ICONS[m] || '📍';
  }

  private updateMarkerIcon(mode: string) {
    if (!this.marker) return;
    const iconHtml = `<div class="transport-icon-wrapper">${this.getModeIcon(mode)}</div>`;
    this.marker.setIcon(this.L.divIcon({
      className: 'custom-transport-marker',
      html: iconHtml,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    }));
  }

  private getSpeedFactor(mode: string | null): number {
    if (!mode) return 1;
    const m = mode.toLowerCase();
    if (m.includes('walk') || m.includes('andan') || m.includes('camin')) return 0.4;
    if (m.includes('run') || m.includes('corr')) return 0.8;
    if (m.includes('bic') || m.includes('cycl')) return 1.5;
    if (m.includes('car') || m.includes('coch') || m.includes('driv')) return 3.5;
    if (m.includes('bus')) return 2.5;
    return 1;
  }
}
