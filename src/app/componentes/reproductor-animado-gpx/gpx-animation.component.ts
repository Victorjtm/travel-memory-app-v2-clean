import { Component, Input, OnInit, OnDestroy, Output, EventEmitter, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { trigger, transition, style, animate } from '@angular/animations';
import { GpxAnimationService, GpxPoint, AnimationStats } from '../../servicios/gpx-animation.service';
import { ArchivoService } from '../../servicios/archivo.service';
import { VideoGeneratorService, ProgresoVideo, ConfiguracionVideo } from '../../servicios/video-generator.service';
import { GeocodificacionService } from '../../servicios/geocodificacion.service';
import { AnimacionNarrativaService } from '../../servicios/animacion-narrativa.service';
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
  private currentBackgroundPolyline: any;
  private marker: any;
  private L: any;

  readonly MODE_COLORS: { [key: string]: string } = {
    walking: '#059669',
    driving: '#DC2626',
    cycling: '#FF9800',
    running: '#2196F3',
    bus: '#9C27B0',
    transport: '#9E9E9E'
  };

  readonly RETURN_COLORS: { [key: string]: string } = {
    walking: '#6EE7B7',
    driving: '#FCA5A5',
    cycling: '#FFB74D',
    running: '#64B5F6',
    bus: '#E1BEE7',
    transport: '#E0E0E0'
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
  
  public cameraMode: 'TRACKING' | 'FREE' = 'TRACKING';
  private lastCameraUpdateTime = 0;
  private lastZoomUpdateTime = 0;
  private readonly CAMERA_THROTTLE_MS = 150;  // 150ms para paneo
  private readonly ZOOM_THROTTLE_MS = 1000;   // 1 segundo para zoom
  private userSelectedZoom = 16;              // Almacena el zoom manual seleccionado
  private lastUiUpdateTime = 0;
  private readonly UI_THROTTLE_MS = 100;      // 100ms para refresco de UI (10Hz)
  // Snapshot del estado de cámara guardado justo antes de entrar en un evento multimedia
  private preEventSnapshot: {
    zoom: number;
    center: [number, number];
    cameraMode: 'TRACKING' | 'FREE';
    targetZoom: number;
    userSelectedZoom: number;
  } | null = null;

  // Estadísticas por modo
  modeStats: { [key: string]: { dist: number, time: number, steps: number } } = {};
  modeList: string[] = []; // Para mantener el orden de aparición

  stats: AnimationStats | null = null;
  
  // Multimedia Events
  activeEvent: any = null;
  pendingEvent: any = null; // ✨ NUEVA PROPIEDAD para paso pre-multimedia

  // ✨ NUEVO: Master Visual Session
  @Input() visualSessionData: any = null;
  @Input() isHighFidelityMode = false;
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

  // Rastreo de fases para animación dinámica
  private modeOccurrences: Record<string, number> = {};
  private pendingVisualMarkers: any[] = [];
  private revealedMarkersCount = 0;
  
  private currentHfColor: string = '';
  private currentHfPhase: string = '';
  private currentHfMode: string = '';
  private hfSegments: any[] = []; // ✨ NUEVA ESTRUCTURA DE SEGMENTOS
  
  public hasCanonicalStats: boolean = false;

  constructor(
    private animationService: GpxAnimationService,
    private archivoService: ArchivoService,
    private geocodificacionService: GeocodificacionService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    public narrativeService: AnimacionNarrativaService // INYECTADO AQUI
  ) { }

  async ngOnInit() {
    console.log('🎬 [GpxAnimationComponent] Iniciando animación...');
    console.log('📊 [GpxAnimationComponent] Datos de transporte recibidos:', this.transportSegments);

    this.points = this.animationService.parseGpx(this.gpxText);
    this.points = this.animationService.syncMultimedia(this.points, this.multimedia);
    
    // ✅ CORRECCIÓN ROBUSTA: Asegurar que el tipo de transporte sea el correcto basado en el nombre
    if (this.transportSegments) {
      this.transportSegments.forEach((s: any) => {
        const nombre = (s.nombre || '').toLowerCase();
        const tipo = (s.tipo || '').toLowerCase();
        
        if ((nombre.includes('coche') || nombre.includes('driving') || nombre.includes('car')) && tipo === 'walking') {
          console.log(`🚗 [Fijando Modo] Corrigiendo segmento ${s.nombre}: walking -> driving`);
          s.tipo = 'driving';
        }
        if (nombre.includes('andando') || nombre.includes('walking') || nombre.includes('caminar')) {
          s.tipo = 'walking';
        }
      });
    }

    this.points = this.animationService.applyTransportSegments(this.points, this.transportSegments);
    
    // ✨ NUEVO: Sincronización de Alta Fidelidad (Prioridad sobre estadísticas legacy)
    if (this.isHighFidelityMode && this.visualSessionData) {
      this.syncHighFidelityMetadata();
    }

    this.stats = this.animationService.getStats(this.points);

    // Inicializar primer modo para el HUD y crear la primera polilínea
    if (this.points.length > 0) {
      const p0 = this.points[0];
      
      // ✨ PRIORIDAD: Usar el primer segmento HF para el estado inicial si existe
      const firstSeg = (this.isHighFidelityMode && this.hfSegments.length > 0) ? this.hfSegments[0] : null;
      
      if (firstSeg && firstSeg.startIndex <= 5) { // Si el primer segmento empieza cerca del inicio
        this.currentMode = firstSeg.mode;
        this.currentHfColor = firstSeg.color;
        this.currentHfPhase = firstSeg.phase;
      } else {
        this.currentMode = p0.hfMode || p0.mode || 'walking';
        this.currentHfColor = p0.hfColor || '';
        this.currentHfPhase = p0.hfPhase || '';
      }

      if (this.currentMode) {
        this.modeStats[this.currentMode] = { dist: 0, time: 0, steps: 0 };
        this.modeList.push(this.currentMode);
      }
      this.currentPointTime = p0.time || null; 
      
      await this.initMap(); 
      
      const pointContext = (this.isHighFidelityMode && this.hfSegments.length > 0 && this.hfSegments[0].startIndex <= 10) ? {
        hfColor: this.hfSegments[0].color,
        hfMode: this.hfSegments[0].mode,
        hfPhase: this.hfSegments[0].phase,
        hfOpacity: this.hfSegments[0].opacity,
        hfDashArray: this.hfSegments[0].dashArray
      } : p0;

      // Asegurar que las variables de estado coincidan con el contexto inicial
      if (pointContext.hfColor) {
        this.currentMode = pointContext.hfMode || this.currentMode;
        this.currentHfColor = pointContext.hfColor;
        this.currentHfPhase = pointContext.hfPhase || '';
      }

      this.createNewPolyline(this.currentMode || 'walking', [p0.lat, p0.lng], pointContext);
      
      // NUEVO: Mostrar todos los POIs de inmediato
      this.displayAllPois();
      console.log(`🛣️ Primera polilínea (HF) creada. Color: ${this.currentHfColor || 'default'}`);
    } else {
      await this.initMap();
    }
    // this.togglePlay(); // Desactivamos el auto-arranque para permitir configurar OSRM antes
  }

  // NUEVO: Función para mostrar todos los pines numerados en el mapa al iniciar y ajustar encuadre
  private displayAllPois() {
    if (!this.map || !this.multimedia || this.multimedia.length === 0) return;
    
    // Si no existe el grupo, crearlo
    if (!this.visualSessionGroup) {
      this.visualSessionGroup = this.L.layerGroup().addTo(this.map);
    }
    
    const boundsPoints: any[] = [];

    this.multimedia.forEach((archivo: any) => {
      if (archivo.geolocalizacion) {
        try {
          const loc = typeof archivo.geolocalizacion === 'string' ? JSON.parse(archivo.geolocalizacion) : archivo.geolocalizacion;
          if (loc.latitud && loc.longitud) {
             const icon = this.L.divIcon({
                className: 'custom-session-marker',
                html: `<div style="background-color: #3b82f6; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); font-weight: bold;">
                         ${archivo.ordenVisita !== undefined ? archivo.ordenVisita : '*'}
                       </div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
             });
             this.L.marker([loc.latitud, loc.longitud], { icon: icon }).addTo(this.visualSessionGroup);
             boundsPoints.push([loc.latitud, loc.longitud]);
          }
        } catch(e) {}
      }
    });

    if (boundsPoints.length > 0) {
      this.map.fitBounds(this.L.latLngBounds(boundsPoints), { padding: [50, 50] });
    }
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
    
    const initialLat = this.points.length > 0 ? this.points[0].lat : 0;
    const initialLng = this.points.length > 0 ? this.points[0].lng : 0;

    this.map = this.L.map('map-animation', {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      zoomSnap: 0.1, // ✨ V4: Zoom fraccional para suavidad extrema
      zoomAnimation: true // Se preserva opción nativa
    }).setView([initialLat, initialLng], this.currentActualZoom);

    this.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      keepBuffer: 8,
      updateWhenIdle: false,
      updateWhenZooming: false
    }).addTo(this.map);

    // Eventos de Usuario para Auto-Zoom Cooldown y Modo de Cámara
    this.map.on('zoomstart', (e: any) => {
      this.handleUserMapInteraction(e);
      this.setCameraModeFree();
    });
    this.map.on('dragstart', (e: any) => {
      this.handleUserMapInteraction(e);
      this.setCameraModeFree();
    });
    this.map.on('zoomend', () => {
      if (this.map) {
        const zoom = this.map.getZoom();
        this.userSelectedZoom = zoom;
        this.currentActualZoom = zoom;
        this.targetZoom = zoom;
        this.cdr.detectChanges();
      }
    });

    // ✨ MODIFICADO: Almacenar marcadores para revelarlos progresivamente
    if (this.isHighFidelityMode && this.visualSessionData?.layers) {
      this.visualSessionGroup = this.L.layerGroup().addTo(this.map);
      this.pendingVisualMarkers = [];
      
      this.visualSessionData.layers.forEach((layer: any) => {
        try {
          if (layer.type === 'marker' && layer.latLng) {
            // ❌ FILTRO: No añadir flechas de dirección a la animación
            const isArrow = layer.icon?.className === 'direction-arrow-svg' || 
                           (layer.icon?.html && (layer.icon.html.includes('direction-arrow-svg') || layer.icon.html.includes('rotate(')));
            
            if (!isArrow) {
              this.pendingVisualMarkers.push(layer);
            }
          }
        } catch (e) {
          console.warn('⚠️ Error preparando marcador:', e);
        }
      });
      console.log(`📦 ${this.pendingVisualMarkers.length} marcadores de Alta Fidelidad preparados (flechas filtradas).`);
    }

    // Ya no creamos una polyline global fija aquí, se creará bajo demanda en update()
    this.currentPolyline = null;

    // Registrar evento global de popups
    document.addEventListener('click', this.globalPopupClickHandler);

    // Marcador de posición (Icono dinámico de transporte)
    const initialMode = this.currentMode || 'walking';
    const iconHtml = `<div class="transport-icon-wrapper">${this.getModeIcon(initialMode)}</div>`;
    
    if (this.points.length > 0) {
      this.marker = this.L.marker([this.points[0].lat, this.points[0].lng], {
        icon: this.L.divIcon({
          className: 'custom-transport-marker',
          html: iconHtml,
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        })
      }).addTo(this.map);
    }
  }

  togglePlay() {
    if (this.isFramingSegment) return; // Prevenir interrupciones durante el encuadre
    
    this.isPlaying = !this.isPlaying;
    if (this.isPlaying) {
      // SIEMPRE encuadrar el tramo antes de arrancar la animación
      this.calculateSegmentBoundsAndSpeed();
    } else {
      this.stopAnimation();
    }
  }

  onManualSpeedChange() {
    this.narrativeService.setManualSpeed(this.speed);
  }

  private handleUserMapInteraction(e: any) {
    if (e.originalEvent || (e.sourceTarget && e.sourceTarget === this.map)) {
       this.autoZoomPaused = true;
       this.lastInteractionTime = Date.now();
       this.narrativeService.setManualZoom();
    }
  }

  private isFramingSegment = false;

  private calculateSegmentBoundsAndSpeed() {
    if (!this.map || this.points.length === 0) return;

    let currentPiIdx = Math.floor(this.currentIndex);
    let nextPiIdx = -1;

    for (let i = currentPiIdx + 1; i < this.points.length; i++) {
        if (this.points[i].event) {
            nextPiIdx = i;
            break;
        }
    }

    if (nextPiIdx === -1) {
        nextPiIdx = this.points.length - 1;
    }
    
    if (currentPiIdx === nextPiIdx) {
        this.lastTimestamp = performance.now();
        this.animate();
        return;
    }

    const p1 = this.points[currentPiIdx];
    const p2 = this.points[nextPiIdx];

    // Detenemos la animación mientras se hace el encuadre
    this.isFramingSegment = true;
    this.isPlaying = false;
    this.stopAnimation();

    const bounds = this.L.latLngBounds([
        [p1.lat, p1.lng],
        [p2.lat, p2.lng]
    ]);
    
    const onFrameComplete = () => {
        if (!this.isFramingSegment) return; // Evitar doble ejecución

        // VENTANA DE DEPURACIÓN TEMPORAL (tal como pidió el usuario para ir paso a paso)
        const ok = window.confirm('¿Es correcto el encuadre de los dos puntos en pantalla? (Punto inicial y próximo PI)');
        if (!ok) {
            this.isFramingSegment = false;
            return;
        }

        // Calcular distancia visual en pantalla
        const point1 = this.map.latLngToContainerPoint([p1.lat, p1.lng]);
        const point2 = this.map.latLngToContainerPoint([p2.lat, p2.lng]);
        const visualDistPx = Math.sqrt(Math.pow(point2.x - point1.x, 2) + Math.pow(point2.y - point1.y, 2));
        
        // Velocidad visual deseada (ej: 150 píxeles por segundo)
        const targetPxPerSec = 150;
        const targetDurationSeconds = Math.max(0.5, visualDistPx / targetPxPerSec);
        
        const indexDelta = nextPiIdx - currentPiIdx;
        const speedFactor = this.getSpeedFactor(this.currentMode);
        
        // Fórmua: 30 * speed * speedFactor = indexDelta / targetDurationSeconds
        let calculatedSpeed = indexDelta / (30 * speedFactor * targetDurationSeconds);
        calculatedSpeed = Math.max(1, Math.min(1000, Math.floor(calculatedSpeed)));

        if (this.narrativeService.speedState$.value.autoSpeedEnabled) {
            this.speed = calculatedSpeed;
            this.onManualSpeedChange();
        }

        // Reanudar viaje
        this.isFramingSegment = false;
        this.isPlaying = true;
        this.lastTimestamp = performance.now();
        this.animate();
        this.cdr.detectChanges();
    };

    // Encuadrar la cámara
    this.map.once('moveend', onFrameComplete);
    this.map.fitBounds(bounds, { padding: [50, 50], animate: true, duration: 1.5 });
    
    // Fallback de seguridad por si moveend no se dispara (ej. si ya estaba encuadrado)
    setTimeout(() => {
        if (this.isFramingSegment) {
            this.map.off('moveend', onFrameComplete);
            onFrameComplete();
        }
    }, 1600);
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

    let segmentPointsCount = 0;
    let segmentDistanceSum = 0;

    for (let i = 0; i < this.points.length - 1; i++) {
        const p1 = this.points[i];
        const p2 = this.points[i+1];
        filledPoints.push(p1);

        // Si es un evento, reseteamos el segmento de conteo de densidad
        if (p1.event && i > 0) {
            segmentPointsCount = 0;
            segmentDistanceSum = 0;
        }

        const distKm = this.animationService.getDistance(p1.lat, p1.lng, p2.lat, p2.lng) / 1000;
        
        if (distKm > 5) {
            console.log(`🚧 GAP detectado: ${distKm.toFixed(2)}km → Consultando OSRM...`);
            // ✨ DENSIDAD RELATIVA: Promedio del tramo anterior (segmentPointsCount)
            const avgDistanceMeters = segmentPointsCount > 0 
                ? (segmentDistanceSum * 1000) / segmentPointsCount 
                : 15; // fallback
            
            const targetNumPoints = Math.max(1, Math.floor((distKm * 1000) / avgDistanceMeters));
            const subPoints = await this.animationService.getOsrmRoute(p1, p2, targetNumPoints);
            filledPoints.push(...subPoints);
            if (subPoints.length > 0) gapCount++;
            
            // Reset for the next segment if needed
            segmentPointsCount = 0;
            segmentDistanceSum = 0;
        } else {
            segmentPointsCount++;
            segmentDistanceSum += distKm;
        }
    }
    if (this.points.length > 0) {
        filledPoints.push(this.points[this.points.length - 1]);
    }

    if (gapCount > 0) {
        // ✨ 3. Ya NO recalculamos accumulators globales. Los subPoints ya vienen con su distAcum interpolado.
        this.points = filledPoints;
        
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
             
             // ✨ RE-SINCRONIZAR ALTA FIDELIDAD TRAS OSRM
             if (this.isHighFidelityMode) {
               this.syncHighFidelityMetadata();
             }

             this.createNewPolyline(this.currentMode, [this.points[0].lat, this.points[0].lng], this.points[0]);
             
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

    // Fase 3: El zoom ya no se interpola frame a frame (LERP eliminado).
    // El zoom discreto se gestiona en updateCameraTracking() con throttle de 1000ms.

    // El auto-zoom discreto ahora se hace por tramos en calculateSegmentBoundsAndSpeed, 
    // pero respetamos autoSpeed si el usuario restaura
    let currentSpeed = Number(this.speed) || 2;
    
    // Si la UI llama a restaurar autoSpeed, se delega al tramo si estuviera corriendo. 
    // Mantenemos el override si se pulsó auto y no hubo cambio de tramo.
    if (this.narrativeService.speedState$.value.autoSpeedEnabled) {
       // La velocidad está fijada por el inicio del tramo
       currentSpeed = Number(this.speed) || 2;
    }

    const speedFactor = this.getSpeedFactor(this.currentMode);
    
    // ~0.5 puntos por frame at 60fps
    const indexProgress = 0.5 * currentSpeed * speedFactor * frames;
    
    const prevIdx = Math.floor(this.currentIndex);
    this.currentIndex += indexProgress;
    const newIdx = Math.floor(Math.min(this.currentIndex, this.points.length - 1));

    // Si cruzamos puntos reales, gestionar modos y estadísticas
    if (newIdx > prevIdx) {
      const startTime = performance.now();
      const coordsBatch: [number, number][] = [];

      for (let i = prevIdx + 1; i <= newIdx; i++) {
        const p = this.points[i];
        const prevP = this.points[i - 1] || this.points[0];

        // Determinamos el metadato del punto (Prioridad: Segmento HF > Propiedades del punto > Fallback)
        let newMode = p.hfMode || p.mode || 'walking';
        let newColor = p.hfColor || '';
        let newPhase = p.hfPhase || '';
        let newOpacity = p.hfOpacity ?? 0.9;
        let newDashArray = p.hfDashArray ?? null;

        // Buscar en hfSegments si estamos en modo alta fidelidad
        if (this.isHighFidelityMode && this.hfSegments.length > 0) {
          const seg = this.hfSegments.find(s => i >= s.startIndex && i <= s.endIndex);
          if (seg) {
            newMode = seg.mode;
            newColor = seg.color;
            newPhase = seg.phase;
            newOpacity = seg.opacity;
            newDashArray = seg.dashArray;
          }
        }

        if (newMode !== this.currentMode || newColor !== this.currentHfColor || newPhase !== this.currentHfPhase) {
          // Volcar puntos acumulados en la polilínea actual antes de cambiar de modo
          if (coordsBatch.length > 0) {
            this.addLatLngsToCurrentPolylines(coordsBatch);
            coordsBatch.length = 0; // Limpiar array
          }

          console.log(`🎨 [Animación Segmentada] Nuevo tramo: ${newMode} | Color: ${newColor} | Fase: ${newPhase}`);
          this.currentMode = newMode;
          this.currentHfColor = newColor;
          this.currentHfPhase = newPhase;
          
          const pointContext = {
            hfColor: newColor,
            hfMode: newMode,
            hfPhase: newPhase,
            hfOpacity: newOpacity,
            hfDashArray: newDashArray
          };
          
          this.createNewPolyline(this.currentMode, [p.lat, p.lng], pointContext);
          this.updateMarkerIcon(this.currentMode);
          
          if (!this.modeStats[this.currentMode]) {
            this.modeStats[this.currentMode] = { dist: 0, time: 0, steps: 0 };
            this.modeList.push(this.currentMode);
          }
        } else {
          // Acumular coordenadas para inyección en batch
          coordsBatch.push([p.lat, p.lng]);
        }

        // Stats acumuladas
        const d = (p.distAcum - prevP.distAcum) / 1000;
        const t = p.timeAcum - prevP.timeAcum;
        if (this.currentMode && this.modeStats[this.currentMode]) {
          const s = this.modeStats[this.currentMode];
          if (!this.hasCanonicalStats) {
            s.dist += d;
            if (this.isWalkingMode(this.currentMode)) s.steps += d * 1400;
          }
          s.time += t;
        }

        if (p.event) {
          // Si hay puntos pendientes antes del evento, inyectarlos
          if (coordsBatch.length > 0) {
            this.addLatLngsToCurrentPolylines(coordsBatch);
            coordsBatch.length = 0;
          }
          this.currentIndex = i; 
          this.renderCurrentFrame();
          this.pauseForEvent(p.event);
          return;
        }

        // ✨ NUEVO: Revelar marcadores visuales cercanos
        if (this.isHighFidelityMode && this.pendingVisualMarkers.length > 0) {
           this.revealNearbyMarkers(p.lat, p.lng);
        }
      }

      // Volcar puntos restantes al finalizar el frame
      if (coordsBatch.length > 0) {
        this.addLatLngsToCurrentPolylines(coordsBatch);
      }

      // Telemetría de rendimiento
      const frameDuration = performance.now() - startTime;
      if (frameDuration > 10) {
        console.warn(`⚠️ [Rendimiento GPX] Procesamiento lento: ${frameDuration.toFixed(1)}ms | Puntos: ${newIdx - prevIdx} | Zoom: ${this.map?.getZoom()}`);
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
      
      // Fase 2: Seguimiento de cámara throttled con Safe Zone - ya no se llama setView cada frame
      if (!this.pendingEvent && !this.activeEvent && this.cameraMode === 'TRACKING') {
        this.updateCameraTracking(latlng as [number, number]);
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

    // Optimización de Angular: refrescar UI con throttle (10Hz) o inmediatamente si la simulación está pausada
    const uiNow = performance.now();
    if (uiNow - this.lastUiUpdateTime > this.UI_THROTTLE_MS || !this.isPlaying) {
      this.lastUiUpdateTime = uiNow;
      this.cdr.detectChanges();
    }
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
    this.narrativeService.pauseAtPoi();

    // Guardar snapshot completa del estado de cámara ANTES del flyTo al evento
    if (this.map) {
      const center = this.map.getCenter();
      this.preEventSnapshot = {
        zoom: this.currentActualZoom,
        center: [center.lat, center.lng],
        cameraMode: this.cameraMode,
        targetZoom: this.targetZoom,
        userSelectedZoom: this.userSelectedZoom,
      };
    }

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

    if (this.map && this.preEventSnapshot) {
      const snap = this.preEventSnapshot;
      this.preEventSnapshot = null; // Limpiar antes del setView para que la guarda funcione

      // 1. Restaurar variables internas ANTES de tocar el mapa
      //    (evita que zoomend/moveend del setView las sobreescriba con valores del evento)
      this.currentActualZoom = snap.zoom;
      this.targetZoom = snap.targetZoom;
      this.userSelectedZoom = snap.userSelectedZoom;
      this.cameraMode = snap.cameraMode;
      this.autoZoomPaused = snap.cameraMode === 'FREE';

      // 2. Función de reanudación con guarda anti-doble-disparo
      const resumePlayback = () => {
        if (!this.isPlaying) {
          this.isPlaying = true;
          this.narrativeService.startSegment(Math.floor(this.currentIndex), this.currentDistKm, this.currentMode || 'walking');
          // SIEMPRE encuadrar el siguiente tramo antes de arrancar
          this.calculateSegmentBoundsAndSpeed();
        }
      };

      // 3. Mecanismo principal: reanudar al terminar la animación del mapa (evento real)
      (this.map as any).once('moveend', resumePlayback);

      // 4. Fallback de seguridad: si moveend no llega en 1500ms, cancelar listener y reanudar
      setTimeout(() => {
        this.map.off('moveend', resumePlayback);
        resumePlayback();
      }, 1500);

      // 5. Disparar setView — esto provocará el moveend cuando termine la animación
      this.map.setView(snap.center, snap.zoom, { animate: true, duration: 0.8 });

    } else if (this.map) {
      // Fallback defensivo: no hay snapshot (no debería ocurrir en condiciones normales)
      const currentPoint = this.points[Math.floor(this.currentIndex)];
      if (currentPoint) {
        this.map.setView(
          [currentPoint.lat, currentPoint.lng],
          this.userSelectedZoom || 16,
          { animate: true, duration: 0.8 }
        );
      }
      setTimeout(() => {
        this.isPlaying = true;
        this.lastTimestamp = performance.now();
        this.animate();
        this.cdr.detectChanges();
      }, 900);
    }
  }

  private revealNearbyMarkers(lat: number, lng: number) {
    const markersToReveal = this.pendingVisualMarkers.filter(m => {
      const dist = this.getDistance(lat, lng, m.latLng.lat, m.latLng.lng);
      return dist < 30; // 30 metros de umbral para aparecer
    });

    markersToReveal.forEach(layer => {
      try {
        let icon;
        if (layer.icon?.html) {
          icon = this.L.divIcon({
            className: layer.icon.className || 'custom-session-marker',
            html: layer.icon.html,
            iconSize: layer.icon.iconSize || [30, 49],
            iconAnchor: layer.icon.iconAnchor || [15, 49],
            popupAnchor: layer.icon.popupAnchor || [1, -40]
          });
        } else if (layer.icon?.iconUrl) {
          icon = this.L.icon(layer.icon);
        } else if (layer.options?.icon) {
          icon = this.L.icon(layer.options.icon);
        }

        const m = this.L.marker(layer.latLng, { icon: icon || new this.L.Icon.Default() }).addTo(this.visualSessionGroup);
        if (layer.popup) m.bindPopup(layer.popup);
        
        // Animación de entrada
        const el = m.getElement();
        if (el) {
          el.style.opacity = '0';
          el.style.transition = 'opacity 0.5s ease-out';
          setTimeout(() => el.style.opacity = '1', 10);
        }

        // Eliminar de pendientes
        this.pendingVisualMarkers = this.pendingVisualMarkers.filter(pm => pm !== layer);
      } catch (e) {
        console.warn('⚠️ Error revelando marcador:', e);
      }
    });
  }

  private getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371e3; // metros
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  private syncHighFidelityMetadata() {
    if (!this.visualSessionData?.layers || this.points.length === 0) return;

    const polyLayers = this.visualSessionData.layers.filter((l: any) => 
      l.type === 'polyline' && l.latLngs?.length > 0
    );
    
    console.log(`🔄 [Alta Fidelidad] Alineando ${polyLayers.length} capas visuales con el GPX...`);
    
    this.hfSegments = [];
    let lastEndIdx = 0;

    polyLayers.forEach((layer: any, layerIdx: number) => {
      const vStart = layer.latLngs[0];
      const vEnd = layer.latLngs[layer.latLngs.length - 1];
      const expectedLen = layer.latLngs.length;

      // 1. Buscar inicio del tramo (Desde el último final, con margen amplio)
      let startIndex = -1;
      let minStartDist = 100; // Margen generoso de 100m
      
      for (let i = lastEndIdx; i < Math.min(lastEndIdx + 2000, this.points.length); i++) {
        const d = this.getDistance(vStart.lat, vStart.lng, this.points[i].lat, this.points[i].lng);
        if (d < minStartDist) {
          minStartDist = d;
          startIndex = i;
        }
      }

      if (startIndex === -1) {
        console.warn(`  ⚠️ Layer ${layerIdx}: Inicio no detectado cerca de idx ${lastEndIdx}.`);
        return;
      }

      // 2. Buscar fin del tramo (Desde startIndex hasta el final de la ruta)
      let endIndex = -1;
      let minEndDist = 100;
      
      for (let i = startIndex; i < this.points.length; i++) {
        const d = this.getDistance(vEnd.lat, vEnd.lng, this.points[i].lat, this.points[i].lng);
        if (d < minEndDist) {
          minEndDist = d;
          endIndex = i;
        }
      }

      if (endIndex === -1 || endIndex < startIndex) {
        console.warn(`  ⚠️ Layer ${layerIdx}: Fin no detectado después de idx ${startIndex}.`);
        return;
      }

      // 3. Extracción de Metadatos y Creación de Segmento
      let mode = (layer.mode || layer.options?.mode || layer.profileId || '').toLowerCase();
      const phase = (layer.routePhase || layer.options?.routePhase || '').toLowerCase();
      
      if (!mode) {
        const color = layer.options?.color;
        if (color === '#059669' || color === '#6EE7B7') mode = 'walking';
        else if (color === '#DC2626' || color === '#FCA5A5') mode = 'driving';
        else mode = 'walking';
      }
      
      if (mode.includes('walk')) mode = 'walking';
      else if (mode.includes('car') || mode.includes('drive')) mode = 'driving';

      const seg = {
        startIndex,
        endIndex,
        color: layer.options?.color,
        opacity: layer.options?.opacity ?? 0.9,
        dashArray: layer.options?.dashArray ?? null,
        mode,
        phase
      };

      // 4. Decorar puntos del rango
      for (let i = startIndex; i <= endIndex; i++) {
        const p = this.points[i] as any;
        p.hfColor = seg.color;
        p.hfMode = seg.mode;
        p.hfPhase = seg.phase;
        p.hfOpacity = seg.opacity;
        p.hfDashArray = seg.dashArray;
      }

      this.hfSegments.push(seg);
      lastEndIdx = endIndex;

      const foundLen = endIndex - startIndex + 1;
      console.log(`  ✅ Layer ${layerIdx} vinculada: ${foundLen} pts GPX (JSON: ${expectedLen} pts) | Color: ${seg.color} | Modo: ${seg.mode}`);
    });

    console.log(`🏁 [HF Mapeo] Completado: ${this.hfSegments.length}/${polyLayers.length} capas restauradas.`);
  }

  private createNewPolyline(mode: string, startLatLng: any, pointContext?: any) {
    if (!this.map) return;

    // 1. Prioridad: Metadatos de Alta Fidelidad (HF)
    let color = pointContext?.hfColor;
    let opacity = pointContext?.hfOpacity;
    let dashArray = pointContext?.hfDashArray;
    const isReturn = pointContext?.hfPhase === 'return' || pointContext?.hfPhase === 'vuelta';

    // 2. Fallback: Colores por modo (Legacy)
    if (!color) {
      const colorSet = isReturn ? this.RETURN_COLORS : this.MODE_COLORS;
      color = colorSet[mode] || colorSet['transport'] || '#FF0000';
    }
    
    if (opacity === undefined || opacity === null) {
      opacity = isReturn ? 0.45 : 0.9;
    }
    
    if (dashArray === undefined || dashArray === null) {
      dashArray = isReturn ? '10, 8' : null;
    }

    this.currentBackgroundPolyline = this.L.polyline([startLatLng], {
      color: '#FFFFFF',
      weight: 9,
      opacity: isReturn ? 0.3 : 0.8,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.map);
    this.polylines.push(this.currentBackgroundPolyline);

    this.currentPolyline = this.L.polyline([startLatLng], {
      color: color,
      weight: 6,
      opacity: opacity,
      dashArray: dashArray,
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

  private setCameraModeFree() {
    if (this.cameraMode !== 'FREE') {
      this.cameraMode = 'FREE';
      this.autoZoomPaused = true;
      this.cdr.detectChanges(); // Renderiza el botón flotante
    }
  }

  public recenterCamera() {
    if (!this.map || !this.marker) return;
    
    this.cameraMode = 'TRACKING';
    this.autoZoomPaused = false;
    
    const markerLatLng = this.marker.getLatLng();
    
    // Retorno suave y controlado
    this.map.flyTo(markerLatLng, this.userSelectedZoom, {
      animate: true,
      duration: 0.8
    });
    
    this.cdr.detectChanges();
  }

  private updateCameraTracking(markerLatLng: [number, number]) {
    if (this.cameraMode !== 'TRACKING' || !this.map) return;
    
    // En Fase 4, si autoCamera está activado y no pausado, el `fitBounds` del tramo
    // ya se encarga de que todo esté en pantalla, por lo que NO necesitamos hacer pan ni zoom continuo,
    // permitiendo que el marcador recorra la ruta libremente por la pantalla de PI a PI.
    if (this.narrativeService.cameraState$.value.autoCameraEnabled && !this.autoZoomPaused) {
       return;
    }

    // Si el usuario intervino (autoZoomPaused = true), hacemos PAN suave para que no se pierda el marcador
    const now = performance.now();
    if (now - this.lastCameraUpdateTime < this.CAMERA_THROTTLE_MS) return;

    const container = this.map.getContainer();
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const SAFE_ZONE_RATIO = 0.25;
    const marginX = containerWidth * SAFE_ZONE_RATIO;
    const marginY = containerHeight * SAFE_ZONE_RATIO;

    const markerPoint = this.map.latLngToContainerPoint(markerLatLng);

    const outOfSafeZone =
      markerPoint.x < marginX ||
      markerPoint.x > containerWidth - marginX ||
      markerPoint.y < marginY ||
      markerPoint.y > containerHeight - marginY;

    if (outOfSafeZone) {
      this.map.panTo(markerLatLng, { animate: true, duration: 0.3, easeLinearity: 1 });
      this.lastCameraUpdateTime = now;
    }
  }

  private addLatLngsToCurrentPolylines(coords: [number, number][]) {
    if (!this.map || coords.length === 0) return;
    
    if (this.currentPolyline) {
      const latlngs = this.currentPolyline.getLatLngs() as any[];
      coords.forEach(c => latlngs.push(this.L.latLng(c[0], c[1])));
      this.currentPolyline.redraw();
    }
    
    if (this.currentBackgroundPolyline) {
      const bgLatLngs = this.currentBackgroundPolyline.getLatLngs() as any[];
      coords.forEach(c => bgLatLngs.push(this.L.latLng(c[0], c[1])));
      this.currentBackgroundPolyline.redraw();
    }
  }
  
  get displayZoom(): string {
     return this.map ? this.map.getZoom().toFixed(1) : '16.0';
  }
}


