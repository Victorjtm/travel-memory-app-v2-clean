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
  
  // OSRM Gap Fill (Prototipo V2)
  autoFillGaps = false;
  isFillingGaps = false;

  // Zoom Cinematográfico Dinámico (V4)
  private zoomStrategyInterval: any = null;
  private smoothedKmh: number = 0; // EMA virtual
  private targetZoom: number = 16;
  private currentActualZoom: number = 16;
  private autoZoomPaused: boolean = false;
  private lastInteractionTime: number = 0;

  // Estadísticas por modo
  modeStats: { [key: string]: { dist: number, time: number, steps: number } } = {};
  modeList: string[] = []; // Para mantener el orden de aparición

  stats: AnimationStats | null = null;
  
  // Multimedia Events
  activeEvent: any = null;
  pendingEvent: any = null; // ✨ NUEVA PROPIEDAD para paso pre-multimedia

  // ✨ NUEVO: Master Visual Session
  visualSessionData: any = null;
  isHighFidelityMode = false;
  visualSessionGroup: any = null;

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

    // ✨ NUEVO: Intentar descargar estadisticas.json (Fase 3 - Sincronización Canónica)
    if (this.actividadActual && this.actividadActual.rutaEstadisticas) {
      try {
        const url = `${environment.apiUrl}/uploads/${this.actividadActual.rutaEstadisticas}`;
        console.log(`📊 [GpxAnimationComponent] Descargando estadisticas.json desde: ${url}`);
        const resp = await fetch(url);
        if (resp.ok) {
          const statsData = await resp.json();
          if (statsData.v === "1.0" && statsData.desglose_transporte) {
            console.log('✅ [Fase 3] Estadísticas Canónicas detectadas. Pre-poblando HUD.');
            this.modeList = [];
            this.modeStats = {};
            statsData.desglose_transporte.forEach((d: any) => {
              const modeId = d.tipo || 'walking';
              this.modeList.push(modeId);
              this.modeStats[modeId] = {
                dist: parseFloat(d.distancia_km || 0),
                time: 0, // El tiempo se sincronizará con la animación
                steps: Math.round(parseFloat(d.distancia_m || 0) * 1.25)
              };
            });
            // Marcar que tenemos estadísticas reales para evitar incrementos duplicados
            (this as any).hasCanonicalStats = true;
          }
        }
      } catch (e) {
        console.warn('⚠️ Error cargando estadisticas.json', e);
      }
    }

    // ✨ NUEVO: Intentar descargar visual_session.json si está disponible
    if (this.actividadActual && this.actividadActual.rutaVisualSession) {
      try {
        const url = `${environment.apiUrl}/uploads/${this.actividadActual.rutaVisualSession}`;
        console.log(`🎨 [GpxAnimationComponent] Descargando visual_session.json desde: ${url}`);
        const resp = await fetch(url);
        if (resp.ok) {
          this.visualSessionData = await resp.json();
          this.isHighFidelityMode = true;
          console.log('✅ Modo Alta Fidelidad activado.');
        } else {
          console.warn('⚠️ No se pudo descargar visual_session.json. Fallback a Modo Legacy.');
        }
      } catch (e) {
        console.warn('⚠️ Error en fetch de visual_session.json. Fallback a Modo Legacy.', e);
      }
    }

    // Inicializar primer modo para el HUD y crear la primera polilínea
    if (this.points.length > 0) {
      this.currentMode = this.points[0].mode || 'walking';
      this.modeStats[this.currentMode] = { dist: 0, time: 0, steps: 0 };
      this.modeList.push(this.currentMode);
      this.currentPointTime = this.points[0].time || null; // ✨ INICIALIZAR TIEMPO
      
      // Creamos la primera polilínea para que se vea desde el inicio (Solo si NO estamos en alta fidelidad)
      await this.initMap(); // Aseguramos que el mapa esté listo
      if (!this.isHighFidelityMode) {
        this.createNewPolyline(this.currentMode, [this.points[0].lat, this.points[0].lng]);
      }
    } else {
      await this.initMap();
    }
    // this.togglePlay(); // Desactivamos el auto-arranque para permitir configurar OSRM antes
  }

  ngOnDestroy() {
    this.stopAnimation();
    if (this.zoomStrategyInterval) clearInterval(this.zoomStrategyInterval);
    if (this.map) this.map.remove();
    // Limpieza de evento global
    document.removeEventListener('click', this.globalPopupClickHandler);
  }

  private async initMap() {
    this.L = await import('leaflet');
    
    this.map = this.L.map('map-animation', {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      zoomSnap: 0.1, // ✨ V4: Zoom fraccional para suavidad extrema
      zoomAnimation: true // Se preserva opción nativa
    }).setView([this.points[0].lat, this.points[0].lng], this.currentActualZoom);

    this.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      keepBuffer: 8,
      updateWhenIdle: false,
      updateWhenZooming: false
    }).addTo(this.map);

    // Eventos de Usuario para Auto-Zoom Cooldown
    this.map.on('zoomstart', (e: any) => this.handleUserMapInteraction(e));
    this.map.on('dragstart', (e: any) => this.handleUserMapInteraction(e));

    this.startZoomStrategyEngine();

    // ✨ NUEVO: Renderizar Lienzo Estático si estamos en Modo Alta Fidelidad
    if (this.isHighFidelityMode && this.visualSessionData?.mapState?.layers) {
      this.visualSessionGroup = this.L.layerGroup().addTo(this.map);
      this.visualSessionData.mapState.layers.forEach((layer: any) => {
        if (layer.type === 'polyline') {
          this.L.polyline(layer.latLngs, layer.options).addTo(this.visualSessionGroup);
        } else if (layer.type === 'marker') {
          let icon;
          if (layer.icon) {
            icon = this.L.icon(layer.icon);
          } else if (layer.options?.icon) {
            icon = this.L.icon(layer.options.icon);
          }
          const m = this.L.marker(layer.latLng, { icon: icon || new this.L.Icon.Default() }).addTo(this.visualSessionGroup);
          if (layer.popup) {
            m.bindPopup(layer.popup);
          }
        }
      });
      console.log('✅ Lienzo estático reconstruido desde visual_session.json');
    }

    // Ya no creamos una polyline global fija aquí, se creará bajo demanda en update()
    this.currentPolyline = null;

    // Registrar evento global de popups
    document.addEventListener('click', this.globalPopupClickHandler);

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

  private handleUserMapInteraction(e: any) {
    if (e.originalEvent || (e.sourceTarget && e.sourceTarget === this.map)) {
       this.autoZoomPaused = true;
       this.lastInteractionTime = Date.now();
    }
  }

  private startZoomStrategyEngine() {
    if (this.zoomStrategyInterval) clearInterval(this.zoomStrategyInterval);
    
    // Sensor matemático a 4Hz (250ms) para proteger requestAnimationFrame
    this.zoomStrategyInterval = setInterval(() => {
        if (!this.isPlaying || !this.map || this.points.length === 0) return;

        // 1. Control de Cooldown Humano (15s)
        if (this.autoZoomPaused) {
            if (Date.now() - this.lastInteractionTime > 15000) {
                this.autoZoomPaused = false;
                console.log('✅ [Zoom V4] Cooldown de 15s superado. Reactivando seguimiento cinemático.');
            } else {
                return;
            }
        }

        // 2. Extraer velocidad cruda del tramo (Raw Speed)
        const currentIdx = Math.floor(this.currentIndex);
        const nextIdx = Math.min(currentIdx + 1, this.points.length - 1);
        const p1 = this.points[currentIdx];
        const p2 = this.points[nextIdx];
        
        let rawKmh = 0;
        if (p1 && p2) {
             const dKm = (p2.distAcum - p1.distAcum) / 1000;
             const tSec = p2.timeAcum - p1.timeAcum;
             if (tSec > 0) {
                 rawKmh = dKm / (tSec / 3600);
             } else if (dKm > 0) {
                 rawKmh = (this.currentMode === 'driving' || this.currentMode === 'car') ? 100 : 5;
             }
        }

        // 3. Filtro de Estabilidad Urbana (EMA ~ 2s Inercia)
        this.smoothedKmh = rawKmh * 0.15 + this.smoothedKmh * 0.85;

        // 4. Ecuación Continua de Mapeo por Contexto
        let rawTargetZoom = this.targetZoom;
        
        if (this.isWalkingMode(this.currentMode)) {
             // Peatón: [16.5 - 17.5]
             const t = Math.min(this.smoothedKmh / 10, 1); // 0 a 10 km/h
             rawTargetZoom = 17.5 - (17.5 - 16.5) * t;
        } else {
             // Vehículo
             if (this.smoothedKmh < 60) {
                 // Ciudad: [14.0 - 16.5]
                 const t = this.smoothedKmh / 60; // 0 a 60 km/h -> 0 a 1
                 rawTargetZoom = 16.5 - (16.5 - 14.0) * t;
             } else {
                 // Autovía: [11.5 - 14.0]
                 const t = Math.min((this.smoothedKmh - 60) / 60, 1); // 60 a 120 km/h -> 0 a 1
                 rawTargetZoom = 14.0 - (14.0 - 11.5) * t;
             }
        }

        // 5. Anti-Oscilación (Micro-Banda Muerta Delta 0.15)
        if (Math.abs(rawTargetZoom - this.targetZoom) > 0.15) {
            this.targetZoom = rawTargetZoom;
        }
    }, 250);
  }

  async toggleOsrmFill() {
    this.autoFillGaps = !this.autoFillGaps;
    if (this.autoFillGaps && !this.isFillingGaps) {
      await this.applyOsrmGapFill();
    }
  }

  async applyOsrmGapFill() {
    this.isFillingGaps = true;
    let filledPoints: GpxPoint[] = [];
    let gapCount = 0;

    for (let i = 0; i < this.points.length - 1; i++) {
        const p1 = this.points[i];
        const p2 = this.points[i+1];
        filledPoints.push(p1);

        const distKm = this.animationService.getDistance(p1.lat, p1.lng, p2.lat, p2.lng) / 1000;
        if (distKm > 5) {
            console.log(`🚧 GAP detectado: ${distKm.toFixed(2)}km → Consultando OSRM...`);
            const subPoints = await this.animationService.getOsrmRoute(p1, p2);
            filledPoints.push(...subPoints);
            if (subPoints.length > 0) gapCount++;
        }
    }
    if (this.points.length > 0) {
        filledPoints.push(this.points[this.points.length - 1]);
    }

    if (gapCount > 0) {
        this.points = this.animationService.recalculateAccumulators(filledPoints);
        this.stats = this.animationService.getStats(this.points);
        
        this.currentIndex = 0;
        this.progress = 0;
        
        if (this.map) {
             const wasPlaying = this.isPlaying;
             if (wasPlaying) this.togglePlay(); // pause
             
             this.map.eachLayer((layer: any) => {
               if (layer.options && (layer.options.color || layer.options.icon)) {
                 this.map.removeLayer(layer);
               }
             });
             this.polylines = [];
             this.currentPolyline = null;
             
             this.currentMode = this.points[0].mode || 'walking';
             const iconHtml = `<div class="transport-icon-wrapper">${this.getModeIcon(this.currentMode)}</div>`;
             this.marker = this.L.marker([this.points[0].lat, this.points[0].lng], {
               icon: this.L.divIcon({
                 className: 'custom-transport-marker',
                 html: iconHtml,
                 iconSize: [40, 40],
                 iconAnchor: [20, 20]
               })
             }).addTo(this.map);
             this.createNewPolyline(this.currentMode, [this.points[0].lat, this.points[0].lng]);
             
             if (wasPlaying) this.togglePlay();
        }
        console.log(`✅ OSRM completado. Gaps rellenados: ${gapCount}. Nuevos puntos totales: ${this.points.length}`);
    }
    
    this.isFillingGaps = false;
    this.cdr.detectChanges();
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

    // Motor Zoom V4 Cinemático: Easing LERP constante hacia targetZoom
    if (this.currentActualZoom !== this.targetZoom && !this.autoZoomPaused) {
       // Transición fluida (Lerp). Ej: un factor bajo para que parezca un dron cayendo o elevándose suavemente
       const lerpFactor = 1.2 * safeDt; 
       this.currentActualZoom += (this.targetZoom - this.currentActualZoom) * lerpFactor;
       
       // Corrección final anti-cálculo infinito microscópico
       if (Math.abs(this.targetZoom - this.currentActualZoom) < 0.01) {
           this.currentActualZoom = this.targetZoom;
       }
    }

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
          
          if (!this.isHighFidelityMode) {
            this.createNewPolyline(this.currentMode, [p.lat, p.lng]);
          }
          
          this.updateMarkerIcon(this.currentMode);
          
          if (!this.modeStats[this.currentMode]) {
            this.modeStats[this.currentMode] = { dist: 0, time: 0, steps: 0 };
            this.modeList.push(this.currentMode);
          }
        } else if (this.currentPolyline && !this.isHighFidelityMode) {
          // Añadimos solo puntos reales a la polilínea si estamos en modo legacy
          this.currentPolyline.addLatLng([p.lat, p.lng]);
        }

        // Stats acumuladas (Síncronas con los puntos)
        const d = (p.distAcum - prevP.distAcum) / 1000;
        const t = p.timeAcum - prevP.timeAcum;
        if (this.currentMode && this.modeStats[this.currentMode]) {
          const s = this.modeStats[this.currentMode];

          // 🛡️ Fase 3: Solo incrementamos si NO tenemos estadísticas reales del móvil
          if (!(this as any).hasCanonicalStats) {
            s.dist += d;
            if (this.isWalkingMode(this.currentMode)) s.steps += d * 1400;
          }

          s.time += t;
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
         // El setView con {animate: false} une Pan y Zoom Dinámicos en un solo cuadro renderizado sin pelearse
         this.map.setView(latlng, this.currentActualZoom, { animate: false }); 
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

  // ====================================================================
  // ✅ FASE 3: INTERACTIVIDAD DE POPUPS Y NAVEGACIÓN INTRAGRUPO
  // ====================================================================

  private globalPopupClickHandler = (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    // 1. Clic en el área de contenido (abrir medio)
    const contentArea = target.closest('.popup-content-area') as HTMLElement;
    if (contentArea) {
      const photoName = contentArea.getAttribute('data-photo-name');
      if (photoName && this.multimedia) {
        const archivo = this.multimedia.find((m: any) => {
          const nombre = m.nombreArchivo || m.nombre || '';
          return nombre.includes(photoName) || photoName.includes(nombre);
        });
        if (archivo) {
          console.log('👆 Click interceptado en medio estático:', photoName);
          e.preventDefault();
          e.stopPropagation();
          this.abrirVisorFoto(archivo);
        } else {
          console.warn('⚠️ No se encontró el medio en la lista local:', photoName);
        }
      }
      return;
    }

    // 2. Clic en botones de navegación (prev/next)
    const actionBtn = target.closest('[data-action]') as HTMLElement;
    if (actionBtn) {
      const container = target.closest('[data-group-lat]') as HTMLElement;
      if (container) {
        e.preventDefault();
        e.stopPropagation();

        const lat = parseFloat(container.getAttribute('data-group-lat') || '0');
        const lng = parseFloat(container.getAttribute('data-group-lng') || '0');
        const currentIndex = parseInt(container.getAttribute('data-current-index') || '0', 10);

        // Agrupar medios por proximidad
        const groupItems = this.multimedia.filter((m: any) => {
          let mLat = m.latitud;
          let mLng = m.longitud;
          if ((!mLat || !mLng) && m.geolocalizacion) {
            try {
              const geo = typeof m.geolocalizacion === 'string' ? JSON.parse(m.geolocalizacion) : m.geolocalizacion;
              mLat = geo.latitud || geo.latitude;
              mLng = geo.longitud || geo.longitude;
            } catch(err) {}
          }
          return mLat && mLng && Math.abs(mLat - lat) < 0.0001 && Math.abs(mLng - lng) < 0.0001;
        });

        const action = actionBtn.getAttribute('data-action');
        if (action && groupItems.length > 1) {
          let newIndex = currentIndex;
          if (action === 'prev') {
            newIndex = (currentIndex - 1 + groupItems.length) % groupItems.length;
          } else if (action === 'next') {
            newIndex = (currentIndex + 1) % groupItems.length;
          }

          const newHtml = this.createPopupContent(groupItems, newIndex, lat, lng);
          const leafletPopupContent = target.closest('.leaflet-popup-content') as HTMLElement;
          if (leafletPopupContent) {
            leafletPopupContent.innerHTML = newHtml;
          }
        }
      }
    }
  };

  private createPopupContent(groupItems: any[], index: number, lat: number, lng: number): string {
    const item = groupItems[index];
    const total = groupItems.length;
    const tipo = item.tipo || 'foto';
    const photoName = item.nombreArchivo || item.nombre || 'Desconocido';
    const emoji = tipo === 'video' ? '🎥' : tipo === 'audio' ? '🎵' : '📸';
    const tipoTexto = tipo.toUpperCase();

    const navControls = total > 1 ? `
      <div style="display: flex; justify-content: space-between; margin-top: 15px; align-items: center; gap: 10px;">
        <button class="popup-prev" data-action="prev" style="
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border: none; border-radius: 8px; padding: 10px 20px; font-size: 18px; cursor: pointer; color: white;
          box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3); font-weight: bold;
        ">◀</button>
        <span style="font-size: 14px; font-weight: bold; color: #333; background: #f5f5f5; padding: 8px 16px; border-radius: 20px;">
          ${index + 1} / ${total}
        </span>
        <button class="popup-next" data-action="next" style="
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border: none; border-radius: 8px; padding: 10px 20px; font-size: 18px; cursor: pointer; color: white;
          box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3); font-weight: bold;
        ">▶</button>
      </div>
    ` : '';

    return `
      <div style="text-align: center; padding: 8px;" data-group-lat="${lat}" data-group-lng="${lng}" data-current-index="${index}">
        <div class="popup-content-area" data-photo-name="${photoName}" data-photo-type="${tipo}" style="
          cursor: pointer; padding: 15px; background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
          border-radius: 12px; transition: all 0.2s; border: 2px solid transparent;
        ">
          <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold; color: #333;">${emoji} ${tipoTexto}</p>
          <p style="margin: 8px 0; font-size: 10px; word-break: break-all; color: #999; background: white; padding: 6px; border-radius: 6px;">
            ${photoName}
          </p>
          <p style="margin: 12px 0 0 0; font-size: 14px; color: #667eea; font-weight: bold; background: white; padding: 10px; border-radius: 8px;">
            👆 Toca aquí para ver
          </p>
        </div>
        ${navControls}
      </div>
    `;
  }
}


