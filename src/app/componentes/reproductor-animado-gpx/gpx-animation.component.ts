import { Component, Input, OnInit, OnDestroy, Output, EventEmitter, ChangeDetectorRef, NgZone, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { trigger, transition, style, animate } from '@angular/animations';
import { GpxAnimationService, GpxPoint, AnimationStats } from '../../servicios/gpx-animation.service';
import { ArchivoService } from '../../servicios/archivo.service';
import { VideoGeneratorService, ProgresoVideo, ConfiguracionVideo } from '../../servicios/video-generator.service';
import { firstValueFrom } from 'rxjs';
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
  @Input() actividadActual: any;
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
  currentPointTime: Date | null = null; // ✨ NUEVA PROPIEDAD
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
    private archivoService: ArchivoService,
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
      this.currentPointTime = this.points[0].time || null; // ✨ INICIALIZAR TIEMPO
      
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
    if (!this.lastTimestamp) {
      this.lastTimestamp = timestamp;
      return;
    }

    const dt = (timestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestamp;
    const safeDt = Math.max(0, Math.min(dt, 0.1));
    const frames = safeDt / (1/60);

    // Motor: El índice avanza por frames (Fluidez Total)
    const currentSpeed = Number(this.speed) || 2;
    const speedFactor = this.getSpeedFactor(this.currentMode);
    
    // ~0.5 puntos por frame at 60fps
    const indexProgress = 0.5 * currentSpeed * speedFactor * frames;
    
    const prevIdx = Math.floor(this.currentIndex);
    this.currentIndex += indexProgress;
    const newIdx = Math.floor(Math.min(this.currentIndex, this.points.length - 1));

    // Si cruzamos puntos reales, gestionar modos y estadísticas
    if (newIdx > prevIdx) {
      for (let i = prevIdx + 1; i <= newIdx; i++) {
        const p = this.points[i];
        const prevP = this.points[i - 1] || this.points[0];

        if (p.mode !== this.currentMode) {
          this.currentMode = p.mode || 'walking';
          this.createNewPolyline(this.currentMode, [p.lat, p.lng]);
          this.updateMarkerIcon(this.currentMode);
          
          if (!this.modeStats[this.currentMode]) {
            this.modeStats[this.currentMode] = { dist: 0, time: 0, steps: 0 };
            this.modeList.push(this.currentMode);
          }
        } else if (this.currentPolyline) {
          // Añadimos solo puntos reales a la polilínea
          this.currentPolyline.addLatLng([p.lat, p.lng]);
        }

        // Stats acumuladas (Síncronas con los puntos)
        const d = (p.distAcum - prevP.distAcum) / 1000;
        const t = p.timeAcum - prevP.timeAcum;
        if (this.currentMode && this.modeStats[this.currentMode]) {
          const s = this.modeStats[this.currentMode];
          s.dist += d;
          s.time += t;
          if (this.isWalkingMode(this.currentMode)) s.steps += d * 1400;
        }

        if (p.event) {
          this.pauseForEvent(p.event);
          this.currentIndex = i; 
          this.renderCurrentFrame();
          return;
        }
      }
    }

    if (this.currentIndex >= this.points.length - 1) {
      this.isPlaying = false;
      this.currentIndex = this.points.length - 1;
    }

    this.renderCurrentFrame();
  }

  private renderCurrentFrame() {
    if (!this.map || !this.marker || !this.points.length) return;

    const floorIdx = Math.floor(this.currentIndex);
    const ceilIdx = Math.min(floorIdx + 1, this.points.length - 1);
    
    const p1 = this.points[floorIdx];
    const p2 = this.points[ceilIdx];

    if (p1 && p2) {
      const alpha = this.currentIndex - floorIdx;

      // 1. Posición Física (Interpolación Fluida)
      const lat = p1.lat + (p2.lat - p1.lat) * alpha;
      const lng = p1.lng + (p2.lng - p1.lng) * alpha;
      const latlng = [lat, lng];

      this.marker.setLatLng(latlng);
      this.map.panTo(latlng, { animate: false }); 

      // 2. Tiempo (Slave Clock) - El reloj "sigue" al muñeco
      this.currentTimeSeg = p1.timeAcum + (p2.timeAcum - p1.timeAcum) * alpha;

      // 3. Métricas Globales
      const interpDist = p1.distAcum + (p2.distAcum - p1.distAcum) * alpha;
      this.currentDistKm = interpDist / 1000;
      
      if (this.isWalkingMode(this.currentMode)) {
        this.currentSteps = (interpDist / 1000) * 1400;
      }

      // Reloj absoluto (Safe Check)
      if (p1.time && p2.time) {
        const t1 = p1.time.getTime();
        const t2 = p2.time.getTime();
        this.currentPointTime = new Date(t1 + (t2 - t1) * alpha);
      } else {
        this.currentPointTime = p1.time || null;
      }

      this.progress = (interpDist / ((this.stats?.distanciaTotalKm || 1) * 1000)) * 100;
    }

    this.cdr.detectChanges();
  }

  // Helper para mostrar estadísticas fluidas en el HUD
  getDisplayTime(mode: string): number {
    const stats = this.modeStats[mode];
    if (!stats) return 0;
    
    if (mode === this.currentMode) {
      const p1 = this.points[Math.floor(this.currentIndex)];
      const deltaT = Math.max(0, this.currentTimeSeg - p1.timeAcum);
      return stats.time + deltaT;
    }
    return stats.time;
  }

  getDisplayDist(mode: string): number {
    const stats = this.modeStats[mode];
    if (!stats) return 0;
    
    if (mode === this.currentMode) {
      const p1 = this.points[Math.floor(this.currentIndex)];
      const p2 = this.points[Math.min(Math.floor(this.currentIndex) + 1, this.points.length - 1)];
      const timeDiff = p2.timeAcum - p1.timeAcum;
      const alpha = timeDiff > 0 ? (this.currentTimeSeg - p1.timeAcum) / timeDiff : 0;
      const safeAlpha = Math.max(0, Math.min(1, alpha));
      
      const deltaD = ((p2.distAcum - p1.distAcum) / 1000) * safeAlpha;
      return stats.dist + deltaD;
    }
    return stats.dist;
  }

  getDisplaySteps(mode: string): number {
    if (!this.isWalkingMode(mode)) return 0;
    return this.getDisplayDist(mode) * 1400;
  }

  private async pauseForEvent(event: any) {
    this.isPlaying = false;
    this.stopAnimation();
    
    // ✨ Buscar audios asociados para cada foto/video en el evento
    if (event.archivos && event.archivos.length > 0) {
      for (const archivo of event.archivos) {
        if (archivo.tipo === 'foto' || archivo.tipo === 'imagen') {
          try {
            const asociados = await this.archivoService.getArchivosAsociados(archivo.id).toPromise();
            const audioAsociado = asociados?.find((a: any) => a.tipo === 'audio');
            if (audioAsociado) {
              archivo.audioUrl = this.archivoService.getUrlArchivoAsociado(audioAsociado);
              console.log(`🎵 Audio asociado encontrado para ${archivo.nombreArchivo}:`, archivo.audioUrl);
            }
          } catch (error) {
            console.error('Error buscando archivos asociados:', error);
          }
        }
      }
    }

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

  abrirVisorFoto(archivo: any) {
    const urlArchivo = this.getMediaUrl(archivo.rutaArchivo);
    let fullUrl = `${window.location.origin}/visualizador-foto?url=${encodeURIComponent(urlArchivo)}&descripcion=${encodeURIComponent(archivo.descripcion || archivo.nombreArchivo)}`;
    
    if (archivo.audioUrl) {
      fullUrl += `&audioUrl=${encodeURIComponent(archivo.audioUrl)}`;
    }
    
    window.open(fullUrl, '_blank', 'noopener,noreferrer');
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
    if (m.includes('car') || m.includes('coch') || m.includes('driv')) return 1.5; // Reducido de 3.5 a 1.5
    if (m.includes('bus')) return 2.0;
    return 1;
  }
}


