import { Component, Input, OnInit, OnDestroy, Output, EventEmitter, ChangeDetectorRef, NgZone, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { trigger, transition, style, animate } from '@angular/animations';
import { GpxAnimationService, GpxPoint, AnimationStats } from '../../servicios/gpx-animation.service';
import { ArchivoService } from '../../servicios/archivo.service';
import { VideoGeneratorService, ProgresoVideo, ConfiguracionVideo } from '../../servicios/video-generator.service';
import { GeocodificacionService } from '../../servicios/geocodificacion.service';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-gpx-animation',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule],
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
  pendingEvent: any = null; // ✨ NUEVA PROPIEDAD para paso pre-multimedia

  private animationFrameId: number | null = null;
  private lastTimestamp = 0;

  // Smoothing State (Shadow Clock v3)
  private smoothTimeSegInternal = 0;
  private smoothPointTimeMsInternal = 0;
  private lastKnownIndex = 0;

  private readonly CLOCK_CONFIG = {
    snapThresholdSec: 1.5,      // Salto instantáneo si el error es masivo
    smallDriftSec: 0.2,         // Umbral para suavizado máximo
    mediumDriftSec: 1.0,        // Umbral para seguimiento agresivo
    kSmall: 0.12,               // Factor para errores pequeños
    kMedium: 0.25,              // Factor para errores medios
    kFast: 0.4,                 // Factor para caza rápida
    freezeEpsilon: 0.0001       // Umbral de detección de movimiento del marcador
  };

  constructor(
    private animationService: GpxAnimationService,
    private archivoService: ArchivoService,
    private geocodificacionService: GeocodificacionService,
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
          this.currentIndex = i; 
          this.renderCurrentFrame(); // Mueve el marcador e interpola al frame exacto
          this.pauseForEvent(p.event); // Ejecuta el flyTo sin que sea pisado
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

      // 1. Posición Física (Interpolación Fluida) - NO TOCAR
      const lat = p1.lat + (p2.lat - p1.lat) * alpha;
      const lng = p1.lng + (p2.lng - p1.lng) * alpha;
      const latlng = [lat, lng];

      this.marker.setLatLng(latlng);
      
      // Permitimos libertad a flyTo si estamos en un evento multimedia
      if (!this.pendingEvent && !this.activeEvent) {
        this.map.panTo(latlng, { animate: false }); 
      } 

      // 2. Tiempo Objetivo (Teórico del GPX)
      const targetTimeSeg = p1.timeAcum + (p2.timeAcum - p1.timeAcum) * alpha;
      
      let targetPointTimeMs = 0;
      if (p1.time && p2.time) {
        const t1 = p1.time.getTime();
        const t2 = p2.time.getTime();
        targetPointTimeMs = t1 + (t2 - t1) * alpha;
      } else {
        targetPointTimeMs = (p1.time || new Date()).getTime();
      }

      // 3. Lógica de Suavizado Fiel (Shadow Clock v3)
      // Inicialización en el primer frame
      if (this.smoothTimeSegInternal === 0) {
        this.smoothTimeSegInternal = targetTimeSeg;
        this.smoothPointTimeMsInternal = targetPointTimeMs;
      }

      // Aplicar seguimiento adaptativo a ambas métricas temporales
      this.smoothTimeSegInternal = this.getAdaptiveFollowValue(this.smoothTimeSegInternal, targetTimeSeg);
      this.smoothPointTimeMsInternal = this.getAdaptiveFollowValue(this.smoothPointTimeMsInternal, targetPointTimeMs);

      // Asignación a variables de UI (Fidelidad Máxima)
      this.currentTimeSeg = this.smoothTimeSegInternal;
      this.currentPointTime = new Date(this.smoothPointTimeMsInternal);

      // 4. Métricas Globales (InterpDist para coherencia absoluta con el marcador)
      const interpDist = p1.distAcum + (p2.distAcum - p1.distAcum) * alpha;
      this.currentDistKm = interpDist / 1000;
      
      if (this.isWalkingMode(this.currentMode)) {
        this.currentSteps = (interpDist / 1000) * 1400;
      }

      this.progress = (interpDist / ((this.stats?.distanciaTotalKm || 1) * 1000)) * 100;
      
      // Actualizar estado para detección de movimiento en el siguiente frame
      this.lastKnownIndex = this.currentIndex;
    }

    this.cdr.detectChanges();
  }

  /**
   * Helper de Seguimiento Adaptativo (Shadow Clock v3)
   * Sincroniza el valor mostrado con el target real basándose en el desplazamiento del marcador.
   */
  private getAdaptiveFollowValue(current: number, target: number): number {
    const drift = target - current;
    const absDrift = Math.abs(drift);
    
    // Heurística para detectar si estamos en MS (Hora Absoluta) o Segundos
    const isMs = absDrift > 10000; 
    const driftSec = isMs ? absDrift / 1000 : absDrift;

    const markerMoved = Math.abs(this.currentIndex - this.lastKnownIndex) > this.CLOCK_CONFIG.freezeEpsilon;

    // 1. Sincronía instantánea en parada o seek masivo
    if (!markerMoved || driftSec > this.CLOCK_CONFIG.snapThresholdSec) {
      return target;
    }

    // 2. Cálculo de K adaptable según el error detectado (Drift)
    let k = this.CLOCK_CONFIG.kSmall;
    if (driftSec > this.CLOCK_CONFIG.mediumDriftSec) {
      k = this.CLOCK_CONFIG.kFast;
    } else if (driftSec > this.CLOCK_CONFIG.smallDriftSec) {
      k = this.CLOCK_CONFIG.kMedium;
    }

    // DEBUG LOG (Descomentar para depuración intensiva)
    /*
    if (k > 0.12) {
      console.log(`🕒 [Clock] Drift: ${driftSec.toFixed(3)}s, K: ${k}, Target: ${target.toFixed(1)}, Moved: ${markerMoved}`);
    }
    */

    return current + (drift * k);
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
    
    // Zoom máximo interactivo (nivel 18) - Acercarse a la ubicación
    const currentPoint = this.points[Math.floor(this.currentIndex)];
    if (currentPoint && this.map) {
      this.map.flyTo([currentPoint.lat, currentPoint.lng], 18, { animate: true, duration: 1.5 });
    }

    // Preparar metadatos base para la foto (Fecha y Hora) y Dirección pre-cargada si existe
    if (event.archivos && event.archivos.length > 0) {
      for (const archivo of event.archivos) {
        if (!archivo.direccion && currentPoint) {
           // Si no tiene dirección interna, la obtenemos dinámicamente con Geocoding Inverso
           try {
             // Fallback al GPS
             const locationStr = `${currentPoint.lat},${currentPoint.lng}`;
             const locationData = await firstValueFrom(this.geocodificacionService.obtenerUbicacionPorCoordenadas(locationStr));
             if (locationData && locationData.direccion) {
               archivo.direccionDeducida = locationData.direccion;
             }
           } catch (error) {
             console.error('Error buscando dirección inversa:', error);
           }
        }
        
        // Adjuntar timestamp explícito para lectura directa en caso de usarse en UI
        if (!archivo.fechaCalculada) {
          archivo.fechaCalculada = archivo.fecha ? new Date(archivo.fecha) : (currentPoint.time || new Date());
        }
      }
    }

    this.pendingEvent = event;
    this.cdr.detectChanges();
  }

  async confirmMediaSelection(choice: boolean) {
    if (choice && this.pendingEvent) {
      // ✅ USUARIO EXPRESA "SÍ"
      const event = this.pendingEvent;
      this.pendingEvent = null;

      // Realizar las cargas multimedia asincrónicas costosas ahora que aceptó
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
    } else {
      // ❌ USUARIO EXPRESA "NO" (o hubo un problema)
      this.pendingEvent = null;
      this.resumeFromEvent(); // Llama a revertir zoom y continuar
    }
  }

  resumeFromEvent() {
    this.activeEvent = null;
    
    // Retornamos la perspectiva del mapa al zoom "Tracking" habitual (usualmente 16, mismo de initMap)
    if (this.map) {
      const currentPoint = this.points[Math.floor(this.currentIndex)];
      if (currentPoint) {
         this.map.flyTo([currentPoint.lat, currentPoint.lng], 16, { animate: true, duration: 1.0 });
      }
    }
    
    // Devolvemos el control transcurridos unos milisegundos para que asimile el zoomOut
    setTimeout(() => {
      this.isPlaying = true;
      this.lastTimestamp = performance.now();
      this.animate();
      this.cdr.detectChanges();
    }, 1000);
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


