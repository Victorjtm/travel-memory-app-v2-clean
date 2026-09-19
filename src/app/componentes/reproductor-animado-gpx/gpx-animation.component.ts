import { Component, Input, OnInit, OnChanges, SimpleChanges, AfterViewInit, OnDestroy, Output, EventEmitter, ChangeDetectorRef, NgZone, ViewEncapsulation, ViewChild, ElementRef, HostListener } from '@angular/core';
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
  encapsulation: ViewEncapsulation.None,
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
export class GpxAnimationComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  @ViewChild('mapElement', { static: false }) mapElement!: ElementRef<HTMLDivElement>;

  @Input() gpxText!: string;
  @Input() multimedia: any[] = [];
  @Input() transportSegments: any[] = [];
  @Input() actividadActual: any;
  @Input() autoPlay: boolean = false;
  @Output() onCerrar = new EventEmitter<void>();
  @Output() onAnimacionCompletada = new EventEmitter<void>();

  // Leaflet
  private map: any;
  private polylines: any[] = []; // Soporte para múltiples colores
  private currentPolyline: any;
  private currentBackgroundPolyline: any;
  private currentPolylinePoints: any[] = [];
  private marker: any;
  private L: any;
  private baseRoutePolyline: any = null;

  readonly MODE_COLORS: { [key: string]: string } = {
    walking: '#059669',
    walk: '#059669',
    andando: '#059669',
    caminar: '#059669',
    driving: '#DC2626',
    car: '#DC2626',
    coche: '#DC2626',
    cycling: '#FF9800',
    bici: '#FF9800',
    bicycle: '#FF9800',
    running: '#2196F3',
    correr: '#2196F3',
    bus: '#9C27B0',
    autobus: '#9C27B0',
    train: '#D97706',
    tren: '#D97706',
    metro: '#D97706',
    plane: '#7C3AED',
    avion: '#7C3AED',
    flight: '#7C3AED',
    boat: '#0284C7',
    barco: '#0284C7',
    ship: '#0284C7',
    ferry: '#0284C7',
    crucero: '#0284C7',
    transport: '#9E9E9E'
  };

  readonly RETURN_COLORS: { [key: string]: string } = {
    walking: '#6EE7B7',
    walk: '#6EE7B7',
    andando: '#6EE7B7',
    caminar: '#6EE7B7',
    driving: '#FCA5A5',
    car: '#FCA5A5',
    coche: '#FCA5A5',
    cycling: '#FFB74D',
    bici: '#FFB74D',
    bicycle: '#FFB74D',
    running: '#64B5F6',
    correr: '#64B5F6',
    bus: '#E1BEE7',
    autobus: '#E1BEE7',
    train: '#FDE68A',
    tren: '#FDE68A',
    metro: '#FDE68A',
    plane: '#DDD6FE',
    avion: '#DDD6FE',
    flight: '#DDD6FE',
    boat: '#7DD3FC',
    barco: '#7DD3FC',
    ship: '#7DD3FC',
    ferry: '#7DD3FC',
    crucero: '#7DD3FC',
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
    train: '🚆',
    tren: '🚆',
    metro: '🚆',
    plane: '✈️',
    avion: '✈️',
    flight: '✈️',
    boat: '🚢',
    barco: '🚢',
    ship: '🚢',
    ferry: '🚢',
    crucero: '🚢',
    transport: '🚀',
    transporte: '🚀'
  };

  // Animation State
  points: GpxPoint[] = [];
  currentIndex = 0;
  isPlaying = false;
  speed = 2; // Multiplicador de velocidad
  progress = 0;
  animationStarted = false;
  isFinished = false;
  cargandoMapa: boolean = true;

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
  @Input() modoRecorridoGuiado = false;
  @Input() interactiveMode: boolean = true;
  visualSessionGroup: any = null;
  private poiLayerGroup: any = null; // ✨ Grupo independiente para POIs (no colisiona con HF)
  private lastTrackMarkerLatLng: [number, number] | null = null;
  private markerAnimFrameId: number | null = null;

  // 📐 Observador reactivo de redimensionamiento físico del contenedor (Full Screen <-> Pantalla Reducida)
  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceTimer: any = null;

  @HostListener('window:resize')
  onWindowResize(): void {
    this.programarReajusteMapa();
  }

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

  // ✨ Modo Dynamics: Halo circular dinámico y carrusel/galería para micro-paradas agrupadas
  private clusterHaloCircle: any = null;
  public clusterSelectedMediaIndex: number = 0;

  private removerHaloCluster(): void {
    if (this.clusterHaloCircle && this.map) {
      try {
        this.map.removeLayer(this.clusterHaloCircle);
      } catch (e) { }
      this.clusterHaloCircle = null;
    }
  }

  selectClusterMedia(index: number): void {
    if (this.activeEvent && this.activeEvent.archivos && index >= 0 && index < this.activeEvent.archivos.length) {
      this.clusterSelectedMediaIndex = index;
    }
  }

  nextClusterMedia(): void {
    if (this.activeEvent && this.activeEvent.archivos && this.clusterSelectedMediaIndex < this.activeEvent.archivos.length - 1) {
      this.clusterSelectedMediaIndex++;
    }
  }

  prevClusterMedia(): void {
    if (this.activeEvent && this.activeEvent.archivos && this.clusterSelectedMediaIndex > 0) {
      this.clusterSelectedMediaIndex--;
    }
  }

  resetAnimationState(): void {
    console.log('🔄 [GPX Reset] Restableciendo estado completo de animación (progress=0, animationStarted=false, isFinished=false)');
    this.removerHaloCluster();
    this.stopAnimation();
    this.progress = 0;
    this.currentIndex = 0;
    this.animationStarted = false;
    this.isFinished = false;
    this.isPlaying = false;
    this.lastTimestamp = 0;
    this.currentDistKm = 0;
    this.currentSteps = 0;
    this.currentTimeSeg = 0;
    this.smoothedKmh = 0;
    this.currentPolylinePoints = [];
    this.autoZoomPaused = false;
    if (this.points && this.points.length > 0) {
      this.points.forEach(p => {
        if (p.event) (p.event as any)._mostrado = false;
      });
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['gpxText'] && !changes['gpxText'].firstChange) ||
        (changes['transportSegments'] && !changes['transportSegments'].firstChange)) {
      console.log('🔄 [GpxAnimationComponent] Cambio en gpxText/transportSegments detectado.');
      if (this.map && this.L) {
        this.updateTrackInPlace();
      } else {
        this.resetAnimationState();
        this.ngOnInit();
      }
    }
  }

  private drawBaseRoutePolyline(): void {
    if (!this.map || !this.L || !this.points || this.points.length < 2) return;
    if (this.baseRoutePolyline) {
      try { this.map.removeLayer(this.baseRoutePolyline); } catch (e) {}
      this.baseRoutePolyline = null;
    }

    const latlngs = this.points.map(p => [p.lat, p.lng]);
    this.baseRoutePolyline = this.L.polyline(latlngs, {
      color: '#94a3b8',
      weight: 5,
      opacity: 0.5,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: '4, 8'
    }).addTo(this.map);
  }

  private updateTrackInPlace(): void {
    console.log('⚡ [GpxAnimationComponent] Actualizando tramo in-situ preservando la instancia del mapa');
    this.stopAnimation();
    this.resetAnimationState();

    if (this.polylines && this.polylines.length > 0) {
      this.polylines.forEach(p => {
        try { this.map.removeLayer(p); } catch (e) {}
      });
      this.polylines = [];
    }
    this.currentPolyline = null;
    this.currentBackgroundPolyline = null;
    this.currentPolylinePoints = [];

    if (this.baseRoutePolyline) {
      try { this.map.removeLayer(this.baseRoutePolyline); } catch (e) {}
      this.baseRoutePolyline = null;
    }

    if (this.poiLayerGroup) {
      this.poiLayerGroup.clearLayers();
    }

    if (this.visualSessionGroup) {
      this.visualSessionGroup.clearLayers();
    }

    this.points = this.animationService.parseGpx(this.gpxText);
    this.stats = this.animationService.getStats(this.points);

    if (this.modoRecorridoGuiado) {
      this.sincronizarEventosGuiados();
    } else {
      this.points = this.animationService.syncMultimedia(this.points, this.multimedia);
    }

    if (this.points.length > 0) {
      const p0 = this.points[0];
      const pointContext = (this.isHighFidelityMode && this.hfSegments?.length > 0) ? this.hfSegments[0] : p0;

      if (pointContext?.color) {
        this.currentMode = pointContext.mode || this.currentMode;
        this.currentHfColor = pointContext.color;
        this.currentHfPhase = pointContext.phase || '';
      }

      this.drawBaseRoutePolyline();

      if (this.marker) {
        this.marker.setLatLng([p0.lat, p0.lng]);
        this.updateMarkerIcon(this.currentMode || 'walking');
      } else {
        const initialMode = this.currentMode || 'walking';
        const iconHtml = `<div class="transport-icon-wrapper">${this.getModeIcon(initialMode)}</div>`;
        this.marker = this.L.marker([p0.lat, p0.lng], {
          icon: this.L.divIcon({
            className: 'custom-transport-marker',
            html: iconHtml,
            iconSize: [48, 48],
            iconAnchor: [24, 24]
          })
        }).addTo(this.map);
      }

      this.createNewPolyline(this.currentMode || 'walking', [p0.lat, p0.lng], pointContext);
      this.displayAllPois();
    }

    this.cargandoMapa = false;
    this.cdr.detectChanges();

    if (this.autoPlay) {
      setTimeout(() => {
        if (!this.isPlaying && !this.animationStarted) {
          this.togglePlay();
        }
      }, 350);
    }
  }

  private sincronizarEventosGuiados(): void {
    if (!this.points || this.points.length === 0) return;
    this.points.forEach(p => p.event = null);
    const pis = this.obtenerGruposPIs();
    console.log(`🎬 [Recorrido Guiado] Sincronizando ${pis.length} Puntos de Interés a lo largo del trazado`);

    let lastMatchedIdx = -1;
    pis.forEach((pi, idx) => {
      let bestIdx = (pi as any).trackIdx ?? -1;

      if (bestIdx === -1 || bestIdx === undefined) {
        let minDist = Infinity;
        for (let i = 0; i < this.points.length; i++) {
          const pt = this.points[i];
          const dist = this.getDistance(pt.lat, pt.lng, pi.lat, pi.lng);
          if (dist < minDist) {
            minDist = dist;
            bestIdx = i;
          }
        }
      }

      // Garantizar progresión monótona estricta sin sobreescribir paradas
      if (idx > 0 && bestIdx <= lastMatchedIdx) {
        if (lastMatchedIdx + 1 < this.points.length) {
          bestIdx = lastMatchedIdx + 1;
        } else {
          // 🛡️ DIVERSIFICACIÓN VIRTUAL EN PROLONGACIONES/FINAL:
          // Si llegamos al final de la traza física y aún quedan paradas por asignar (ej. tramos editados a mano),
          // inyectamos un nuevo vértice virtual en memoria para alojar esta parada sin sobreescribir la anterior.
          const lastPt = this.points[this.points.length - 1];
          const nuevoPunto: GpxPoint = {
            lat: pi.lat,
            lng: pi.lng,
            ele: lastPt.ele,
            time: new Date((lastPt.time ? new Date(lastPt.time).getTime() : Date.now()) + 2000),
            distAcum: (lastPt.distAcum || 0) + Math.max(1, this.getDistance(lastPt.lat, lastPt.lng, pi.lat, pi.lng)),
            timeAcum: (lastPt.timeAcum || 0) + 2,
            mode: lastPt.mode || 'walking',
            hfMode: lastPt.hfMode || 'walking'
          };
          this.points.push(nuevoPunto);
          bestIdx = this.points.length - 1;
        }
      }

      // Si por alguna razón el punto seleccionado ya tiene un evento asignado, insertar un punto intermedio
      if (this.points[bestIdx] && this.points[bestIdx].event) {
        const pRef = this.points[bestIdx];
        const nuevoPunto: GpxPoint = {
          lat: pi.lat,
          lng: pi.lng,
          ele: pRef.ele,
          time: new Date((pRef.time ? new Date(pRef.time).getTime() : Date.now()) + 1000),
          distAcum: (pRef.distAcum || 0) + Math.max(1, this.getDistance(pRef.lat, pRef.lng, pi.lat, pi.lng)),
          timeAcum: (pRef.timeAcum || 0) + 1,
          mode: pRef.mode || 'walking',
          hfMode: pRef.hfMode || 'walking'
        };
        this.points.splice(bestIdx + 1, 0, nuevoPunto);
        bestIdx = bestIdx + 1;
      }

      if (bestIdx !== -1 && bestIdx < this.points.length) {
        this.points[bestIdx].event = {
          archivos: pi.archivos,
          piNumero: (pi as any).numeroSecuencial || (idx + 1),
          piTotal: pis.length,
          lat: pi.lat,
          lng: pi.lng,
          clusterRadio: (pi as any).clusterRadio,
          esPuntoInteres: true
        };
        lastMatchedIdx = bestIdx;
      }
    });
  }

  constructor(
    private animationService: GpxAnimationService,
    private archivoService: ArchivoService,
    private geocodificacionService: GeocodificacionService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    public narrativeService: AnimacionNarrativaService // INYECTADO AQUI
  ) { }

  async ngOnInit() {
    this.resetAnimationState();
    console.log(`🎬 [GpxAnimationComponent] Iniciando animación... (Modo Recorrido Guiado: ${this.modoRecorridoGuiado})`);
    console.log('📊 [GpxAnimationComponent] Datos de transporte recibidos:', this.transportSegments);

    this.points = this.animationService.parseGpx(this.gpxText);

    if (this.modoRecorridoGuiado) {
      this.sincronizarEventosGuiados();
    } else {
      this.points = this.animationService.syncMultimedia(this.points, this.multimedia);
    }

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
    }
  }

  async ngAfterViewInit() {
    await this.initMap();

    if (this.points.length > 0) {
      const p0 = this.points[0];
      const firstSeg = (this.isHighFidelityMode && this.hfSegments.length > 0) ? this.hfSegments[0] : null;
      const pointContext = (this.isHighFidelityMode && this.hfSegments.length > 0 && this.hfSegments[0].startIndex <= 10) ? {
        hfColor: this.hfSegments[0].color,
        hfMode: this.hfSegments[0].mode,
        hfPhase: this.hfSegments[0].phase,
        hfOpacity: this.hfSegments[0].opacity,
        hfDashArray: this.hfSegments[0].dashArray
      } : p0;

      if (pointContext.hfColor) {
        this.currentMode = pointContext.hfMode || this.currentMode;
        this.currentHfColor = pointContext.hfColor;
        this.currentHfPhase = pointContext.hfPhase || '';
      }

      this.drawBaseRoutePolyline();
      this.createNewPolyline(this.currentMode || 'walking', [p0.lat, p0.lng], pointContext);
      this.displayAllPois();
      console.log(`🛣️ Primera polilínea (HF) y POIs creados en ngAfterViewInit. Color: ${this.currentHfColor || 'default'}`);
    }

    // 📐 Iniciar observador de redimensionamiento del contenedor físico
    if (typeof ResizeObserver !== 'undefined' && this.mapElement?.nativeElement) {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            this.programarReajusteMapa();
          }
        }
      });
      this.resizeObserver.observe(this.mapElement.nativeElement);
    }
  }

  /**
   * 🛡️ Determina con máxima precisión si la actividad actual proviene de una sesión Dynamics (AudioPhotoApp_Dynamics).
   */
  private esActividadDynamics(): boolean {
    if (this.actividadActual) {
      const nombre = (this.actividadActual.nombre || '').toLowerCase();
      const origen = (this.actividadActual.origen || this.actividadActual.fuente || '').toLowerCase();
      if (nombre.includes('dynamics') || origen.includes('dynamics') || (this.actividadActual as any).esDynamics) {
        return true;
      }
    }
    if (this.visualSessionData?.metadata?.origen?.toLowerCase?.().includes('dynamics') ||
        this.visualSessionData?.origen?.toLowerCase?.().includes('dynamics')) {
      return true;
    }
    if (this.gpxText && (this.gpxText.includes('Recorrido_Dynamics') || this.gpxText.toLowerCase().includes('dynamics'))) {
      return true;
    }
    if (this.multimedia && this.multimedia.length > 0) {
      return this.multimedia.some((m: any) => {
        const n = m.nombreArchivo || m.nombre || '';
        return /^(?:recording|JPEG|VID)-\d{13}|^(?:recording|JPEG|VID)_\d{13}/.test(n) ||
               (m.fuente && m.fuente.toLowerCase().includes('dynamics')) ||
               (m.origen && m.origen.toLowerCase().includes('dynamics'));
      });
    }
    return false;
  }

  /**
   * 🕒 Extrae el timestamp cronológico exacto de archivos generados por Dynamics.
   * Maneja el epoch de 13 dígitos en el nombre del archivo (evitando overflow de 32 dígitos),
   * o fallbacks a metadatos/fechas válidas (> año 2000).
   */
  private getDynamicsTimestamp(item: any): number {
    if (!item) return 0;
    const name = item.nombreArchivo || item.nombre || '';
    if (name) {
      const m = name.match(/(\d{13})/);
      if (m) {
        const val = Number(m[1]);
        if (val > 1577836800000 && val < 2051222400000) return val;
      }
      // Regex YYYYMMDD_HHMMSS en nombre de archivo (ej. IMG_20260630_065921.jpg o audio_20260115_202743.wav)
      const mDate = name.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
      if (mDate) {
        const dt = new Date(`${mDate[1]}-${mDate[2]}-${mDate[3]}T${mDate[4]}:${mDate[5]}:${mDate[6]}Z`);
        if (!isNaN(dt.getTime())) return dt.getTime();
      }
    }
    // Si tiene horaCaptura válida combinada con fecha
    const hc = item.horaCaptura;
    let timePart = '';
    if (hc && typeof hc === 'string' && hc !== '00:00:00' && hc.toLowerCase() !== 'desconocido' && hc.trim() !== '') {
      timePart = hc.trim();
      if (timePart.length === 5) timePart += ':00';
    }
    let datePart = '';
    if (item.fechaCreacion) datePart = item.fechaCreacion.split('T')[0];
    else if (item.fechaTomada) datePart = item.fechaTomada.split('T')[0];
    else if (item.fecha) datePart = item.fecha.split('T')[0];

    if (!timePart && item.fechaCreacion && typeof item.fechaCreacion === 'string') {
      const matchIso = item.fechaCreacion.match(/T(\d{2}:\d{2}:\d{2})/);
      if (matchIso && matchIso[1] !== '00:00:00') timePart = matchIso[1];
    }
    if (datePart && !datePart.startsWith('1970') && !datePart.startsWith('1792') && timePart) {
      const dt = new Date(`${datePart}T${timePart}Z`);
      if (!isNaN(dt.getTime())) return dt.getTime();
    }
    if (item.metadatos) {
      try {
        const meta = typeof item.metadatos === 'string' ? JSON.parse(item.metadatos) : item.metadatos;
        if (meta?.timestamp) {
          const t = new Date(meta.timestamp).getTime();
          if (!isNaN(t) && new Date(t).getFullYear() >= 2000) return t;
        }
      } catch (e) { }
    }
    if (item.fechaTomada || item.fechaHora || item.fecha) {
      const t = new Date(item.fechaTomada || item.fechaHora || item.fecha).getTime();
      if (!isNaN(t) && new Date(t).getFullYear() >= 2000) return t;
    }
    if (item.fechaCreacion) {
      const t = new Date(item.fechaCreacion).getTime();
      if (!isNaN(t) && new Date(t).getFullYear() >= 2000) return t;
    }
    if (item.created_at) {
      const t = new Date(item.created_at).getTime();
      if (!isNaN(t) && new Date(t).getFullYear() >= 2000) return t;
    }
    return 0;
  }

  /**
   * 🧲 Proyección ortogonal punto-segmento sobre la traza GPX.
   * Si el punto dista menos de maxDistanceMeters de la línea, devuelve la coordenada proyectada
   * exactamente sobre el asfalto/calzada de la polilínea.
   */
  private proyectarPuntoSobreTraza(lat: number, lng: number, maxDistanceMeters: number = 25): { lat: number; lng: number } {
    if (!this.points || this.points.length < 2) return { lat, lng };

    let bestPoint = { lat, lng };
    let minDistance = Infinity;

    for (let i = 0; i < this.points.length - 1; i++) {
      const p1 = this.points[i];
      const p2 = this.points[i + 1];

      const dx = p2.lng - p1.lng;
      const dy = p2.lat - p1.lat;
      const lenSq = dx * dx + dy * dy;

      if (lenSq === 0) continue;

      let t = ((lng - p1.lng) * dx + (lat - p1.lat) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t)); // Acotar al segmento

      const projLat = p1.lat + t * dy;
      const projLng = p1.lng + t * dx;

      const d = this.getDistance(lat, lng, projLat, projLng);
      if (d < minDistance) {
        minDistance = d;
        bestPoint = { lat: projLat, lng: projLng };
      }
    }

    if (minDistance <= maxDistanceMeters) {
      return bestPoint;
    }
    return { lat, lng };
  }

  /**
   * 🚀 LÓGICA LINEAL CRONOLÓGICA EXCLUSIVA PARA MODO DYNAMICS:
   * 1. Ordenamiento Lineal Absoluto: Junta todas las fotos, vídeos y audios ordenados por Fecha + Hora + Segundo exactos.
   * 2. Eliminación de Algoritmos de Bloques: Cada archivo físico independiente recibe su propio pin correlativo del 1 al N.
   * 3. Sin clustering espacial ni temporal.
   */
  private obtenerGruposPIsDynamics(): { lat: number; lng: number; trackIdx?: number; timestamp?: number; numeroSecuencial?: number; archivos: any[] }[] {
    const archivosConCoordenadas: { lat: number; lng: number; archivo: any; timestamp: number; trackIdx: number }[] = [];

    if (this.multimedia && this.multimedia.length > 0) {
      this.multimedia.forEach((archivo: any) => {
        const tipo = (archivo.tipo || '').toLowerCase();
        if (tipo !== 'foto' && tipo !== 'video' && tipo !== 'imagen' && tipo !== 'audio') return;

        let lat: number | null = null;
        let lng: number | null = null;

        if (archivo.geolocalizacion) {
          try {
            const loc = typeof archivo.geolocalizacion === 'string' ? JSON.parse(archivo.geolocalizacion) : archivo.geolocalizacion;
            lat = Number(loc.latitud || loc.latitude || loc.lat || 0);
            lng = Number(loc.longitud || loc.longitude || loc.lng || 0);
          } catch (e) { }
        }
        if ((!lat || !lng) && archivo.latitud && archivo.longitud) {
          lat = Number(archivo.latitud);
          lng = Number(archivo.longitud);
        }
        if ((!lat || !lng) && archivo.lat && archivo.lng) {
          lat = Number(archivo.lat);
          lng = Number(archivo.lng);
        }

        if (lat && lng && Math.abs(lat) > 0.01 && Math.abs(lng) > 0.01) {
          const ts = this.getDynamicsTimestamp(archivo);
          if (ts > 0) {
            archivo.fechaCalculada = new Date(ts);
          }
          archivosConCoordenadas.push({ lat, lng, archivo, timestamp: ts, trackIdx: 0 });
        }
      });
    }

    // Ordenar estrictamente por timestamp cronológico real (Fecha + Hora + Segundo)
    archivosConCoordenadas.sort((a, b) => a.timestamp - b.timestamp);

    // Emparejar al track GPX de forma monótona ascendente con validación espacio-temporal
    let lastTrackIdx = 0;
    archivosConCoordenadas.forEach(item => {
      let bestIdx = -1;

      if (this.points && this.points.length > 0) {
        // 1. Si tenemos timestamp válido, buscar candidato cronológico a partir de lastTrackIdx
        let candidateTimeIdx = -1;
        let minTimeDiff = Infinity;

        if (item.timestamp > 0) {
          for (let i = lastTrackIdx; i < this.points.length; i++) {
            const pt = this.points[i];
            const ptTime = pt?.time ? new Date(pt.time).getTime() : 0;
            if (ptTime > 0) {
              const diff = Math.abs(ptTime - item.timestamp);
              if (diff < minTimeDiff) {
                minTimeDiff = diff;
                candidateTimeIdx = i;
              }
            }
          }
        }

        // 2. Comprobar si el candidato temporal tiene coherencia física en el espacio (< 150m)
        let timeCandidateIsPhysicallyClose = false;
        if (candidateTimeIdx !== -1 && item.lat && item.lng) {
          const ptCandidate = this.points[candidateTimeIdx];
          const distToCandidate = this.getDistance(item.lat, item.lng, ptCandidate.lat, ptCandidate.lng);
          // Si el punto temporal está a menos de 150 metros, es verosímil y se acepta
          if (distToCandidate <= 150) {
            timeCandidateIsPhysicallyClose = true;
            bestIdx = candidateTimeIdx;
          }
        }

        // 3. Si no hay candidato temporal coherente (ej. corte de señal GPS o tramo prolongado/editado),
        // encontrar el punto físicamente más cercano en la traza a partir de lastTrackIdx
        if (!timeCandidateIsPhysicallyClose && item.lat && item.lng) {
          let minSpatialDist = Infinity;
          for (let i = lastTrackIdx; i < this.points.length; i++) {
            const pt = this.points[i];
            if (pt) {
              const d = this.getDistance(item.lat, item.lng, pt.lat, pt.lng);
              if (d < minSpatialDist) {
                minSpatialDist = d;
                bestIdx = i;
                if (d < 10) break; // Coincidencia óptima sobre la calzada
              }
            }
          }

          // Fallback de seguridad: si buscando hacia adelante no hay nada a menos de 300m,
          // evaluar toda la traza para no perder la posición
          if (bestIdx === -1 || minSpatialDist > 300) {
            for (let i = 0; i < this.points.length; i++) {
              const pt = this.points[i];
              if (pt) {
                const d = this.getDistance(item.lat, item.lng, pt.lat, pt.lng);
                if (d < minSpatialDist) {
                  minSpatialDist = d;
                  bestIdx = i;
                }
              }
            }
          }
        }

        // Fallback final si no se encontró por distancia ni tiempo
        if (bestIdx === -1) {
          bestIdx = candidateTimeIdx !== -1 ? candidateTimeIdx : lastTrackIdx;
        }
      }

      bestIdx = Math.max(lastTrackIdx, bestIdx);
      lastTrackIdx = bestIdx;
      item.trackIdx = bestIdx;
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Agrupación Espacio-Temporal para Rutas Dynamics (10m / 5min)
    // Agrupa micro-paradas contiguas en un solo pin evitando el efecto "yo-yo"
    // ═══════════════════════════════════════════════════════════════════════
    const CLUSTER_DIST_MAX_M = 10;
    const CLUSTER_TIME_MAX_MS = 5 * 60 * 1000; // 5 minutos

    interface ClusterGroupData {
      items: typeof archivosConCoordenadas;
      lat: number;
      lng: number;
      trackIdx: number;
      timestamp: number;
      clusterRadio: number;
    }

    const clusterGroups: ClusterGroupData[] = [];
    let currentCluster: ClusterGroupData | null = null;

    for (const item of archivosConCoordenadas) {
      if (!currentCluster) {
        currentCluster = {
          items: [item],
          lat: item.lat,
          lng: item.lng,
          trackIdx: item.trackIdx,
          timestamp: item.timestamp,
          clusterRadio: 10
        };
        continue;
      }

      // Distancia física al centroide actual del cluster
      const distMeters = this.getDistance(currentCluster.lat, currentCluster.lng, item.lat, item.lng);

      // Diferencia temporal respecto al último ítem del cluster
      const lastItem = currentCluster.items[currentCluster.items.length - 1];
      const timeDiffMs = (item.timestamp > 0 && lastItem.timestamp > 0)
        ? Math.abs(item.timestamp - lastItem.timestamp)
        : 0;

      // Criterio de pertenencia: <= 10 metros Y <= 5 minutos
      const withinDistance = distMeters <= CLUSTER_DIST_MAX_M;
      const withinTime = timeDiffMs <= CLUSTER_TIME_MAX_MS;

      if (withinDistance && withinTime) {
        currentCluster.items.push(item);
        // Recalcular centroide físico del cluster
        const n = currentCluster.items.length;
        currentCluster.lat = currentCluster.items.reduce((acc, it) => acc + it.lat, 0) / n;
        currentCluster.lng = currentCluster.items.reduce((acc, it) => acc + it.lng, 0) / n;
        // Calcular radio envolvente del halo circular (mínimo 10m para visualización nítida)
        let maxDist = 0;
        for (const it of currentCluster.items) {
          const d = this.getDistance(currentCluster.lat, currentCluster.lng, it.lat, it.lng);
          if (d > maxDist) maxDist = d;
        }
        currentCluster.clusterRadio = Math.max(Math.ceil(maxDist + 3), 10);
      } else {
        clusterGroups.push(currentCluster);
        currentCluster = {
          items: [item],
          lat: item.lat,
          lng: item.lng,
          trackIdx: item.trackIdx,
          timestamp: item.timestamp,
          clusterRadio: 10
        };
      }
    }

    if (currentCluster) {
      clusterGroups.push(currentCluster);
    }

    // Generar grupos consolidados con numeración correlativa única (1 a N)
    const grupos: { lat: number; lng: number; trackIdx: number; timestamp: number; numeroSecuencial: number; clusterRadio?: number; archivos: any[] }[] = [];

    clusterGroups.forEach((cg, index) => {
      const numeroSecuencial = index + 1;
      const archivosDelGrupo: any[] = [];

      cg.items.forEach(it => {
        it.archivo.numeroSecuencial = numeroSecuencial;
        archivosDelGrupo.push(it.archivo);
      });

      // 🧲 Snapping magnético: Proyectar centroide sobre la traza GPX si está cerca (<= 25m) para alinear al asfalto
      const snapped = this.proyectarPuntoSobreTraza(cg.lat, cg.lng, 25);

      grupos.push({
        lat: snapped.lat,
        lng: snapped.lng,
        trackIdx: cg.trackIdx,
        timestamp: cg.timestamp,
        numeroSecuencial,
        clusterRadio: cg.items.length > 1 ? cg.clusterRadio : undefined,
        archivos: archivosDelGrupo
      });
    });

    return grupos;
  }

  /**
   * Extrae y genera los Puntos de Interés (PIs) ordenados cronológicamente del 1 al N.
   * En Modo Tradicional: Si un audio está asociado a una foto/vídeo, no consume número ni marcador independiente.
   */
  private obtenerGruposPIs(): { lat: number; lng: number; trackIdx?: number; timestamp?: number; numeroSecuencial?: number; archivos: any[] }[] {
    // 🛡️ REGLA DE ORO: Si es una actividad Modo Dynamics, ejecutar lógica lineal pura
    if (this.esActividadDynamics()) {
      return this.obtenerGruposPIsDynamics();
    }

    // --- MODO TRADICIONAL (ORDEN LINEAL ABSOLUTO CON ARCHIVOS ASOCIADOS) ---
    const archivosConCoordenadas: { lat: number; lng: number; archivo: any; timestamp: number; trackIdx: number }[] = [];

    if (this.multimedia && this.multimedia.length > 0) {
      // 1. Identificar nombres base de fotos y audios asociados a fotos padre para no duplicar marcadores
      const audiosAsociadosIds = new Set<number>();
      const fotosNombresBase = new Set<string>();

      this.multimedia.forEach((archivo: any) => {
        const tipo = (archivo.tipo || '').toLowerCase();
        if ((tipo === 'foto' || tipo === 'imagen') && archivo.nombreArchivo) {
          const dotIdx = archivo.nombreArchivo.lastIndexOf('.');
          const base = dotIdx !== -1 ? archivo.nombreArchivo.substring(0, dotIdx) : archivo.nombreArchivo;
          fotosNombresBase.add(base.toLowerCase());
        }
        if (archivo.archivosAsociados && Array.isArray(archivo.archivosAsociados)) {
          archivo.archivosAsociados.forEach((asoc: any) => {
            if (asoc.tipo === 'audio') {
              audiosAsociadosIds.add(asoc.id);
              if (!archivo.audioUrl && asoc.rutaArchivo) {
                archivo.audioUrl = `${environment.apiUrl}/uploads/${asoc.rutaArchivo}`;
              }
            }
          });
        }
      });

      this.multimedia.forEach((archivo: any) => {
        const tipo = (archivo.tipo || '').toLowerCase();
        if (tipo !== 'foto' && tipo !== 'video' && tipo !== 'imagen' && tipo !== 'audio') return;

        // Excluir archivos auxiliares y mapas de ubicación estáticos
        if (tipo === 'mapa_ubicacion' || tipo === 'mapa' || tipo === 'gpx' || tipo === 'manifest' || tipo === 'estadisticas') return;
        if (archivo.nombreArchivo && (
          archivo.nombreArchivo.toLowerCase().includes('_mapa.') ||
          archivo.nombreArchivo.toLowerCase().includes('_location_map.') ||
          archivo.nombreArchivo.toLowerCase().endsWith('_mapa.png')
        )) return;

        // Ocultar audio asociado de la secuencia principal independiente
        let esAudioAsociado = tipo === 'audio' && (
          archivo.archivoPrincipalId ||
          archivo.esAsociado ||
          audiosAsociadosIds.has(archivo.id)
        );
        if (!esAudioAsociado && tipo === 'audio' && archivo.nombreArchivo) {
          const dotIdx = archivo.nombreArchivo.lastIndexOf('.');
          const base = dotIdx !== -1 ? archivo.nombreArchivo.substring(0, dotIdx) : archivo.nombreArchivo;
          if (fotosNombresBase.has(base.toLowerCase())) {
            esAudioAsociado = true;
          }
        }
        if (esAudioAsociado) return;

        let lat: number | null = null;
        let lng: number | null = null;

        if (archivo.geolocalizacion) {
          try {
            const loc = typeof archivo.geolocalizacion === 'string' ? JSON.parse(archivo.geolocalizacion) : archivo.geolocalizacion;
            lat = Number(loc.latitud || loc.latitude || loc.lat || 0);
            lng = Number(loc.longitud || loc.longitude || loc.lng || 0);
          } catch (e) { }
        }
        if ((!lat || !lng) && archivo.latitud && archivo.longitud) {
          lat = Number(archivo.latitud);
          lng = Number(archivo.longitud);
        }
        if ((!lat || !lng) && archivo.lat && archivo.lng) {
          lat = Number(archivo.lat);
          lng = Number(archivo.lng);
        }

        if (lat && lng && Math.abs(lat) > 0.01 && Math.abs(lng) > 0.01) {
          const ts = this.getDynamicsTimestamp(archivo);
          archivosConCoordenadas.push({ lat, lng, archivo, timestamp: ts, trackIdx: 0 });
        }
      });
    }

    // Ordenamiento Lineal Absoluto: por timestamp cronológico ascendente (Día + Hora + Segundo)
    archivosConCoordenadas.sort((a, b) => a.timestamp - b.timestamp);

    // Mapear cada elemento al track GPX de forma monótona con restricción estricta de ventana temporal
    const hasGpxTimes = this.points && this.points.some(p => p.time && !isNaN(new Date(p.time).getTime()));
    let lastTrackIdx = 0;

    archivosConCoordenadas.forEach(item => {
      let bestIdx = -1;

      if (hasGpxTimes && item.timestamp > 0 && this.points && this.points.length > 0) {
        const WINDOWS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];
        for (const winMs of WINDOWS_MS) {
          let minDist = Infinity;
          let chosenIdx = -1;
          for (let i = lastTrackIdx; i < this.points.length; i++) {
            const pt = this.points[i];
            const ptTime = pt?.time ? new Date(pt.time).getTime() : 0;
            if (ptTime > 0 && Math.abs(ptTime - item.timestamp) <= winMs) {
              const d = this.getDistance(item.lat, item.lng, pt.lat, pt.lng);
              if (d < minDist) {
                minDist = d;
                chosenIdx = i;
              }
            }
          }
          if (chosenIdx !== -1) {
            bestIdx = chosenIdx;
            break;
          }
        }

        if (bestIdx === -1) {
          let minDist = Infinity;
          for (let i = 0; i < this.points.length; i++) {
            const pt = this.points[i];
            const ptTime = pt?.time ? new Date(pt.time).getTime() : 0;
            if (ptTime > 0 && Math.abs(ptTime - item.timestamp) <= 15 * 60 * 1000) {
              const d = this.getDistance(item.lat, item.lng, pt.lat, pt.lng);
              if (d < minDist) {
                minDist = d;
                bestIdx = i;
              }
            }
          }
        }
      }

      // Fallback espacial si no hay tiempos GPX o fuera de ventana
      if (bestIdx === -1 && this.points && this.points.length > 0) {
        let minDist = Infinity;
        for (let i = lastTrackIdx; i < this.points.length; i++) {
          const pt = this.points[i];
          const d = this.getDistance(item.lat, item.lng, pt.lat, pt.lng);
          if (d < minDist) {
            minDist = d;
            bestIdx = i;
            if (d < 10) break;
          }
        }
      }

      bestIdx = Math.max(lastTrackIdx, bestIdx !== -1 ? bestIdx : lastTrackIdx);
      lastTrackIdx = bestIdx;
      item.trackIdx = bestIdx;
    });

    // Agrupación canónica idéntica a Álbum Libro y Ver GPX (<15m / 8 puntos track / 1 hora)
    const TOLERANCIA_GPS = 0.00015; // ~15 metros
    const MAX_TIME_GAP_MS = 60 * 60 * 1000; // 1 hora
    const grupos: { lat: number; lng: number; trackIdx: number; timestamp: number; numeroSecuencial?: number; archivos: any[] }[] = [];

    archivosConCoordenadas.forEach(item => {
      const ultimoGrupo = grupos.length > 0 ? grupos[grupos.length - 1] : null;
      const coincideUbicacion = ultimoGrupo &&
        Math.abs(ultimoGrupo.lat - item.lat) < TOLERANCIA_GPS &&
        Math.abs(ultimoGrupo.lng - item.lng) < TOLERANCIA_GPS;
      const trackMuyCercano = ultimoGrupo && Math.abs(ultimoGrupo.trackIdx - item.trackIdx) < 8;
      const ultimoItem = ultimoGrupo ? ultimoGrupo.archivos[ultimoGrupo.archivos.length - 1] : null;
      const tsUltimo = ultimoItem ? this.getDynamicsTimestamp(ultimoItem) : 0;
      const tiempoCercano = !item.timestamp || !tsUltimo || Math.abs(item.timestamp - tsUltimo) < MAX_TIME_GAP_MS;

      if ((coincideUbicacion || trackMuyCercano) && tiempoCercano) {
        ultimoGrupo!.archivos.push(item.archivo);
      } else {
        const snapped = this.modoRecorridoGuiado ? this.proyectarPuntoSobreTraza(item.lat, item.lng, 25) : { lat: item.lat, lng: item.lng };
        grupos.push({
          lat: snapped.lat,
          lng: snapped.lng,
          trackIdx: item.trackIdx,
          timestamp: item.timestamp,
          archivos: [item.archivo]
        });
      }
    });

    // Asignar numeroSecuencial canónico
    grupos.forEach((g, idx) => {
      const num = idx + 1;
      g.numeroSecuencial = num;
      g.archivos.forEach(a => { a.numeroSecuencial = num; });
    });

    return grupos;
  }

  // NUEVO: Función para mostrar todos los pines numerados en el mapa al iniciar y ajustar encuadre
  // ✨ Replica la MISMA lógica lineal y estilo visual que "ver GPX" (actividades-itinerarios)
  private displayAllPois() {
    if (!this.map) { console.warn('⚠️ [displayAllPois] No hay mapa'); return; }

    // ✨ USAR GRUPO DEDICADO para POIs (separado de visualSessionGroup de HF)
    if (!this.poiLayerGroup) {
      this.poiLayerGroup = this.L.layerGroup().addTo(this.map);
    } else {
      this.poiLayerGroup.clearLayers();
      if (!this.map.hasLayer(this.poiLayerGroup)) {
        this.poiLayerGroup.addTo(this.map);
      }
    }

    // ❌ Evitar que se revelen marcadores dinámicos extra durante la animación (ya están todos mostrados)
    this.pendingVisualMarkers = [];

    const grupos = this.obtenerGruposPIs();
    console.log(`📌 [displayAllPois] Grupos (PIs) creados en orden temporal estricto: ${grupos.length}`);

    // ═══════════════════════════════════════════════════════════════════
    // PASO 4: Crear marcadores con el MISMO estilo visual que "ver GPX"
    // (Pin SVG rojo + badge azul con #N)
    // ═══════════════════════════════════════════════════════════════════
    const boundsPoints: any[] = [];

    grupos.forEach((grupo, index) => {
      const { lat, lng } = grupo;

      const primerArchivo = (grupo.archivos && grupo.archivos.length > 0) ? (grupo.archivos[0].archivo || grupo.archivos[0]) : null;
      const numeroSecuencial = (grupo as any).numeroSecuencial || primerArchivo?.numeroSecuencial || (index + 1);
      const totalArchivos = grupo.archivos ? grupo.archivos.length : 1;
      const tieneMultiples = totalArchivos > 1;
      const tipo = (primerArchivo?.tipo || '').toLowerCase();
      const esAudio = tipo === 'audio';
      const esFoto = tipo === 'foto' || tipo === 'imagen';
      const colorPrincipal = esAudio ? '#F59E0B' : (esFoto ? '#E53935' : '#2196F3');
      const badgeColor = esAudio ? '#D97706' : '#1E88E5';

      // Badge flotante para clusters (ej: 📷 x4)
      const clusterBadgeHtml = tieneMultiples ? `
        <div style="position:absolute;top:-6px;right:-12px;background:#6366F1;color:white;padding:2px 6px;border-radius:12px;font-size:11px;font-weight:800;border:2px solid white;box-shadow:0 2px 5px rgba(0,0,0,0.4);z-index:20;white-space:nowrap;display:flex;align-items:center;gap:2px;">
          <span>📷</span><span>x${totalArchivos}</span>
        </div>
      ` : '';

      const icon = this.L.divIcon({
        className: '',
        html: `
        <div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;cursor:pointer;position:relative;">
          ${clusterBadgeHtml}
          <svg width="44" height="44" viewBox="0 0 44 44" style="filter:drop-shadow(0px 3px 3px rgba(0,0,0,0.4));z-index:5;">
            <path d="M22 2 C14 2 8 8 8 16 C8 26 22 42 22 42 C22 42 36 26 36 16 C36 8 30 2 22 2 Z" fill="${colorPrincipal}" />
            <circle cx="22" cy="16" r="6" fill="white" />
            ${esAudio ? '<text x="22" y="19" font-size="9" text-anchor="middle">🎤</text>' : ''}
          </svg>
          <div style="margin-top:-8px;background:${badgeColor};color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:bold;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.4);z-index:10;position:relative;">
            #${numeroSecuencial}
          </div>
        </div>
        `,
        iconSize: [44, 60],
        iconAnchor: [22, 60]
      });

      const poiMarker = this.L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(this.poiLayerGroup);
      poiMarker.on('click', () => {
        console.log(`📍 [POI Click] Clic en Parada #${numeroSecuencial} (${totalArchivos} elementos)`);
        const eventData = {
          archivos: grupo.archivos,
          piNumero: numeroSecuencial,
          piTotal: grupos.length,
          lat,
          lng,
          clusterRadio: (grupo as any).clusterRadio,
          esPuntoInteres: true
        };
        this.pauseForEvent(eventData, [lat, lng]);
      });
      boundsPoints.push([lat, lng]);

      console.log(`📌 PI #${numeroSecuencial} (${esAudio ? 'Audio' : 'Foto/Video'}) → lat=${lat.toFixed(5)}, lng=${lng.toFixed(5)}, archivos=${grupo.archivos.length}`);
    });

    console.log(`📌 [displayAllPois] TOTAL PIs: ${grupos.length}, boundsPoints: ${boundsPoints.length}`);

    // Encuadrar la totalidad de la ruta GPX Y los puntos de interés con encuadre perfectamente centrado
    const allCoords: [number, number][] = [];
    if (this.points && this.points.length > 0) {
      this.points.forEach(p => allCoords.push([p.lat, p.lng]));
    }
    boundsPoints.forEach(pt => allCoords.push(pt));

    if (allCoords.length > 0 && this.map) {
      this.map.invalidateSize();
      const fullBounds = this.L.latLngBounds(allCoords);
      this.map.fitBounds(fullBounds, {
        padding: [60, 60],
        maxZoom: 15
      });
      console.log(`🗺️ [displayAllPois] Ruta completa encuadrada de forma equilibrada con ${allCoords.length} puntos`);
    }
  }

  ngOnDestroy() {
    this.removerHaloCluster();
    this.stopAnimation();
    if (this.zoomStrategyInterval) clearInterval(this.zoomStrategyInterval);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = null;
    }
    if (this.map) this.map.remove();
    // Limpieza de evento global
    document.removeEventListener('click', this.globalPopupClickHandler);
  }

  private static cachedLeafletModule: any = null;

  private async initMap() {
    if (!GpxAnimationComponent.cachedLeafletModule) {
      GpxAnimationComponent.cachedLeafletModule = await import('leaflet');
    }
    this.L = GpxAnimationComponent.cachedLeafletModule;

    const initialLat = this.points.length > 0 ? this.points[0].lat : 0;
    const initialLng = this.points.length > 0 ? this.points[0].lng : 0;

    let container = this.mapElement?.nativeElement || document.getElementById('map-animation');
    if (!container) {
      await new Promise(r => setTimeout(r, 60));
      container = this.mapElement?.nativeElement || document.getElementById('map-animation');
    }
    if (!container) {
      console.warn('⚠️ [GpxAnimationComponent] mapElement no encontrado tras espera');
      this.cargandoMapa = false;
      this.cdr.detectChanges();
      return;
    }

    if (this.map) {
      try { this.map.remove(); } catch (e) {}
      this.map = null;
    }

    this.map = this.L.map(container, {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      zoomSnap: 0.1, // ✨ V4: Zoom fraccional para suavidad extrema
      zoomAnimation: true // Se preserva opción nativa
    }).setView([initialLat, initialLng], this.currentActualZoom);

    setTimeout(() => {
      if (this.map) {
        this.map.invalidateSize();
      }
    }, 120);

    // --- CAPAS BASE (MAPA Y SATÉLITE) ---
    const satellite = this.L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles © Esri',
        maxZoom: 18,
        keepBuffer: 8,
        updateWhenIdle: false,
        updateWhenZooming: false
      }
    );

    const streets = this.L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
        keepBuffer: 8,
        updateWhenIdle: false,
        updateWhenZooming: false
      }
    );

    // Preferencia persistente de capa (por defecto 'streets' / 'Mapa')
    const preferredLayer = localStorage.getItem('gpx_animation_preferred_layer') || 'streets';
    const activeTileLayer = preferredLayer === 'satellite' ? satellite : streets;
    activeTileLayer.addTo(this.map);

    let tilesReady = false;
    const onMapTilesReady = () => {
      if (tilesReady) return;
      tilesReady = true;
      this.cargandoMapa = false;
      if (this.map) {
        this.map.invalidateSize();
      }
      this.cdr.detectChanges();
      if (this.autoPlay && !this.isPlaying && !this.animationStarted) {
        // Breve pausa técnica para que la cámara se asiente y arrancar fluidamente
        setTimeout(() => {
          if (!this.isPlaying && !this.animationStarted) {
            this.togglePlay();
          }
        }, 350);
      }
    };

    activeTileLayer.on('load', onMapTilesReady);
    setTimeout(onMapTilesReady, 400);

    // Control de selección de capas
    const layersControl = this.L.control.layers(
      { 'Mapa': streets, 'Satélite': satellite },
      {},
      { position: 'topright' }
    ).addTo(this.map);

    this.map.on('baselayerchange', (e: any) => {
      const layerName = e.name;
      const key = layerName === 'Satélite' ? 'satellite' : 'streets';
      localStorage.setItem('gpx_animation_preferred_layer', key);
      console.log('🗺️ [Capa persistente cambiada]:', key);
    });

    const layersContainer = layersControl.getContainer();
    if (layersContainer) {
      layersContainer.classList.add('capas-animacion-flotante');
      layersContainer.classList.add('capas-animacion');
    }

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
          iconSize: [48, 48],
          iconAnchor: [24, 24]
        })
      }).addTo(this.map);
    }
  }

  togglePlay() {
    if (this.isFramingSegment) return; // Prevenir interrupciones durante el encuadre

    this.isPlaying = !this.isPlaying;
    if (this.isPlaying) {
      // 📍 Si estamos al inicio y el punto 0 tiene evento (Parada #1), detenerse en él antes de avanzar
      if (Math.floor(this.currentIndex) === 0 && this.points && this.points[0]?.event && !(this.points[0].event as any)._mostrado && this.interactiveMode !== false) {
        console.log('📍 [Parada Inicial] Deteniendo en Parada #1 (índice 0)');
        (this.points[0].event as any)._mostrado = true;
        const ev = this.points[0].event;
        const targetCoords: [number, number] | undefined = (ev.lat !== undefined && ev.lng !== undefined) ? [ev.lat, ev.lng] : undefined;
        this.pauseForEvent(ev, targetCoords);
        return;
      }

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

    // 🛡️ BIFURCACIÓN DE SEGURIDAD EXCLUSIVA PARA ÁLBUM-LIBRO (interactiveMode === false)
    if (this.interactiveMode === false) {
      // En Álbum-Libro: ignorar eventos intermedios y abarcar toda la ruta completa del itinerario
      currentPiIdx = 0;
      nextPiIdx = this.points.length - 1;
    } else {
      for (let i = currentPiIdx + 1; i < this.points.length; i++) {
        if (this.points[i].event) {
          nextPiIdx = i;
          break;
        }
      }

      if (nextPiIdx === -1) {
        nextPiIdx = this.points.length - 1;
      }
    }

    if (currentPiIdx === nextPiIdx) {
      this.lastTimestamp = performance.now();
      this.animate();
      return;
    }

    const p1 = this.points[currentPiIdx];
    const p2 = this.points[nextPiIdx];

    // Actualizar modo de transporte e icono del marcador para el nuevo tramo
    const segMode = p1.hfMode || p1.mode || 'walking';
    this.currentMode = segMode;
    this.updateMarkerIcon(segMode);

    // Detenemos la animación mientras se hace el encuadre
    this.isFramingSegment = true;
    this.isPlaying = false;
    this.stopAnimation();

    let bounds: any;
    const isBoat = this.isBoatMode(segMode);

    if (this.interactiveMode === false) {
      // 📖 Vista Panorámica Estática en Álbum-Libro: Toda la ruta completa
      const allCoords = this.points.map(p => [p.lat, p.lng] as [number, number]);
      bounds = this.L.latLngBounds(allCoords.length > 0 ? allCoords : [[p1.lat, p1.lng], [p2.lat, p2.lng]]);
      console.log(`📖 [Álbum-Libro] Encuadrando ruta GPX completa con vista aérea global (${allCoords.length} puntos)`);
    } else if (isBoat) {
      // 🚢 EN EL MAR: Encuadre panorámico completo (desde puerto de salida hasta puerto de llegada)
      let boatStart = currentPiIdx;
      while (boatStart > 0 && this.isBoatMode(this.points[boatStart - 1]?.mode || this.points[boatStart - 1]?.hfMode)) {
        boatStart--;
      }
      let boatEnd = nextPiIdx;
      while (boatEnd < this.points.length - 1 && this.isBoatMode(this.points[boatEnd + 1]?.mode || this.points[boatEnd + 1]?.hfMode)) {
        boatEnd++;
      }

      const boatPoints = this.points.slice(boatStart, boatEnd + 1).map(p => [p.lat, p.lng] as [number, number]);
      bounds = this.L.latLngBounds(boatPoints.length > 0 ? boatPoints : [[p1.lat, p1.lng], [p2.lat, p2.lng]]);
      console.log(`🚢 [Panorámica Mar] Encuadrando travesía completa (${boatPoints.length} puntos de navegación)`);
    } else {
      const segCoords = this.points.slice(currentPiIdx, nextPiIdx + 1).map(p => [p.lat, p.lng] as [number, number]);
      bounds = this.L.latLngBounds(segCoords.length > 0 ? segCoords : [
        [p1.lat, p1.lng],
        [p2.lat, p2.lng]
      ]);
    }

    const onFrameComplete = () => {
      if (!this.isFramingSegment) return; // Evitar doble ejecución
      this.isFramingSegment = false; // Marcar como completado para evitar que el fallback lo llame otra vez

      // Dar tiempo al navegador para renderizar el mapa con los dos puntos visibles
      setTimeout(() => {
        // Calcular distancia visual en pantalla
        const point1 = this.map.latLngToContainerPoint([p1.lat, p1.lng]);
        const point2 = this.map.latLngToContainerPoint([p2.lat, p2.lng]);
        const visualDistPx = Math.sqrt(Math.pow(point2.x - point1.x, 2) + Math.pow(point2.y - point1.y, 2));

        // Distancia geográfica real del tramo (en metros)
        const segmentDistM = Math.abs((p2.distAcum - p1.distAcum)) || 1;

        // Velocidad visual deseada (ej: 150 píxeles por segundo)
        const targetPxPerSec = isBoat ? 100 : 150;
        let safeVisualDistPx = visualDistPx;
        if (this.interactiveMode === false && segmentDistM > 1000 && safeVisualDistPx < 100) {
          const cont = this.map.getContainer();
          safeVisualDistPx = Math.max(cont?.clientWidth || 600, cont?.clientHeight || 400) * 0.6;
        }

        const speedFactor = this.getSpeedFactor(this.currentMode);
        let calculatedSpeed: number;
        let effectiveTargetSec: number;

        if (this.modoRecorridoGuiado) {
          // 🎬 Modo Recorrido Guiado: Pacing visual controlado y dinámico entre paradas
          let minDurationSec = 2.0;
          if (segmentDistM > 1500) {
            minDurationSec = 3.5; // Entre 3.5s y 4.5s para tramos largos/medios
          } else if (segmentDistM > 500) {
            minDurationSec = 2.8;
          } else {
            minDurationSec = 2.0; // 2.0s para paradas muy próximas (evita saltos instantáneos)
          }

          const targetDurationSeconds = Math.max(minDurationSec, safeVisualDistPx / targetPxPerSec);
          effectiveTargetSec = targetDurationSeconds;

          // 🚀 Si el tramo es largo (> 2 km), acelerar dinámicamente para no aburrir al usuario
          if (segmentDistM > 2000) {
            const distKm = segmentDistM / 1000;
            const distanceSpeedBoost = Math.min(isBoat ? 3.5 : 2.5, 1 + 0.4 * Math.log10(distKm));
            effectiveTargetSec = targetDurationSeconds / distanceSpeedBoost;
          }

          // ⚡ Speed Multiplier inteligente para rutas ultra-largas (> 50 km, ej. Cruceros marítimos de 100 km o vuelos)
          if (segmentDistM > 50000) {
            const longDistMultiplier = Math.min(8.0, 4.0 + (segmentDistM - 50000) / 25000);
            effectiveTargetSec = Math.max(3.5, Math.min(5.5, effectiveTargetSec / longDistMultiplier));
          } else {
            // Cota temporal óptima en Recorrido Guiado estándar: entre minDurationSec y 4.5s como máximo
            effectiveTargetSec = Math.max(minDurationSec, Math.min(4.5, effectiveTargetSec));
          }

          calculatedSpeed = segmentDistM / (7.5 * speedFactor * effectiveTargetSec);
          // Permitir aceleración hasta 5000 para rutas muy largas
          calculatedSpeed = Math.max(1, Math.min(5000, Math.round(calculatedSpeed)));
        } else {
          // 🚀 Animación Estándar (Otros Recorridos): Comportamiento ágil original
          const targetDurationSeconds = Math.max(0.5, safeVisualDistPx / targetPxPerSec);
          effectiveTargetSec = targetDurationSeconds;
          if (segmentDistM > 2000) {
            const distKm = segmentDistM / 1000;
            const distanceSpeedBoost = Math.min(isBoat ? 3.5 : 2.2, 1 + 0.35 * Math.log10(distKm));
            effectiveTargetSec = targetDurationSeconds / distanceSpeedBoost;
          }
          // ⚡ Speed Multiplier inteligente para rutas ultra-largas (> 50 km)
          if (segmentDistM > 50000) {
            const longDistMultiplier = Math.min(8.0, 4.0 + (segmentDistM - 50000) / 25000);
            effectiveTargetSec = Math.max(3.5, Math.min(5.5, effectiveTargetSec / longDistMultiplier));
          }
          calculatedSpeed = segmentDistM / (7.5 * speedFactor * effectiveTargetSec);
          calculatedSpeed = Math.max(1, Math.min(5000, Math.round(calculatedSpeed)));
        }

        console.log(`🎯 [Tramo] pixels=${safeVisualDistPx.toFixed(0)}px, distM=${segmentDistM.toFixed(0)}m, speedFactor=${speedFactor}, targetSec=${effectiveTargetSec.toFixed(1)}s, speed=${calculatedSpeed}, mode=${this.currentMode}`);

        // Aplicar velocidad calculada respetando si el usuario fijó una velocidad manual explícita
        const speedState = this.narrativeService?.speedState$?.value;
        if (speedState && !speedState.autoSpeedEnabled && speedState.userSpeedValue) {
          this.speed = speedState.userSpeedValue;
          console.log(`⚡ [Velocidad Manual Respetada]: x${this.speed}`);
        } else {
          this.speed = calculatedSpeed;
        }

        // Reanudar viaje
        this.isPlaying = true;
        this.lastTimestamp = performance.now();
        this.animate();
        this.cdr.detectChanges();
      }, 300);
    };

    // Detener cualquier animación previa para evitar que un moveend residual dispare prematuramente
    this.map.stop();

    let moveEndFired = false;
    const handleMoveEnd = () => {
      if (moveEndFired) return;
      moveEndFired = true;
      this.map.off('moveend', handleMoveEnd);
      onFrameComplete();
    };

    this.map.once('moveend', handleMoveEnd);

    // Cota de seguridad de maxZoom: límite rígido para Álbum-Libro (interactiveMode === false)
    const safeMaxZoom = this.interactiveMode === false
      ? (isBoat ? 11 : 14)
      : (isBoat ? 11 : 15);

    // Usar flyToBounds para un zoom fluido y cinematográfico desde la vista general hacia el tramo específico
    this.map.flyToBounds(bounds, {
      padding: isBoat ? [70, 70] : (this.interactiveMode === false ? [40, 40] : [60, 60]),
      maxZoom: safeMaxZoom,
      duration: 1.2
    });

    // Fallback de seguridad por si moveend no se dispara (ej. si ya estaba encuadrado)
    setTimeout(() => {
      if (!moveEndFired && this.isFramingSegment) {
        handleMoveEnd();
      }
    }, 2200);
  }

  /**
   * Programa la ejecución del reajuste del mapa con un retardo asíncrono controlado
   * para permitir que las transiciones CSS y el reflow del DOM se asienten por completo.
   */
  public programarReajusteMapa(delayMs?: number): void {
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
    }
    // 🛡️ En Álbum-Libro (interactiveMode === false), dar 250ms de cortesía para el reflow del DOM
    const delayEfectivo = delayMs ?? (this.interactiveMode === false ? 250 : 80);
    this.resizeDebounceTimer = setTimeout(() => {
      this.reajustarDimensionesYLimites();
      // Segundo pulso de confirmación en Álbum-Libro por si hay transiciones 3D de larga duración
      if (this.interactiveMode === false) {
        setTimeout(() => this.reajustarDimensionesYLimites(), 200);
      }
    }, delayEfectivo);
  }

  /**
   * Ejecuta en cascada invalidateSize() y fitBounds() para reescalar
   * el trazado dentro del nuevo contenedor físico (especialmente al volver a pantalla reducida).
   */
  public reajustarDimensionesYLimites(customPadding?: [number, number]): void {
    if (!this.map) return;

    // 1. Forzar a Leaflet a recalcular de inmediato los píxeles reales del nuevo contenedor físico
    this.map.invalidateSize({ animate: false });

    // 🛡️ Si la animación está activa, en proceso de encuadre o ya iniciada, NO resetear el encuadre al mapa global
    if (this.isFramingSegment || this.isPlaying || this.animationStarted) {
      return;
    }

    // 2. Obtener los límites geográficos exactos del recorrido
    let bounds: any = null;

    if (this.interactiveMode === false) {
      // 📖 Álbum-Libro: Abarcar la totalidad de las coordenadas de la ruta GPX completa
      if (this.points && this.points.length > 0) {
        const allCoords = this.points.map(p => [p.lat, p.lng] as [number, number]);
        bounds = this.L.latLngBounds(allCoords);
      }
    } else if (this.currentPolyline && this.currentPolyline.getLatLngs()?.length > 1) {
      // Modo interactivo / estándar: límites de la polilínea activa
      bounds = this.currentPolyline.getBounds();
    } else if (this.points && this.points.length > 0) {
      const allCoords = this.points.map(p => [p.lat, p.lng] as [number, number]);
      bounds = this.L.latLngBounds(allCoords);
    }

    // 3. Reencuadrar y reescalar de forma estricta con padding y cota de seguridad
    if (bounds && bounds.isValid()) {
      const paddingFinal = customPadding ?? (this.interactiveMode === false ? [40, 40] : [20, 20]);
      const safeMaxZoom = (this.interactiveMode === false) ? 14 : undefined;
      this.map.fitBounds(bounds, {
        padding: paddingFinal,
        maxZoom: safeMaxZoom,
        animate: true,
        duration: 0.3
      });
      console.log(`📐 [GpxAnimation] Mapa reescalado a contenedor reducido con éxito (${paddingFinal[0]}px padding, maxZoom=${safeMaxZoom})`);
    }
  }

  isBoatMode(mode?: string): boolean {
    if (!mode) return false;
    const m = mode.toLowerCase();
    return m.includes('boat') || m.includes('barco') || m.includes('ship') || m.includes('ferry') || m.includes('crucero') || m.includes('embarc') || m.includes('kayak') || m.includes('canoa');
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
      const p2 = this.points[i + 1];
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
            iconSize: [60, 60],
            iconAnchor: [30, 30]
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
    this.animationStarted = true;

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
    const frames = safeDt / (1 / 60);

    // Fase 3: El zoom ya no se interpola frame a frame (LERP eliminado).
    // El zoom discreto se gestiona en updateCameraTracking() con throttle de 1000ms.

    // El auto-zoom discreto ahora se hace por tramos en calculateSegmentBoundsAndSpeed, 
    // pero respetamos autoSpeed si el usuario restaura
    let currentSpeed = Number(this.speed) || 2;

    const speedFactor = this.getSpeedFactor(this.currentMode);

    // ✨ AVANCE POR DISTANCIA MÉTRICA ACUMULADA CONTINUA (velocidad física y visual constante)
    // En lugar de dividir metersThisFrame por la distancia de un único par de puntos
    // (lo cual causaba aceleraciones desmedidas en zonas densas y frenazos bruscos en rectas),
    // calculamos la distancia geográfica exacta recorrida en metros y encontramos el segmento
    // real correspondiente, logrando una fluidez perfecta de 60fps idéntica en cualquier tipo de ruta.
    const prevIdx = Math.floor(this.currentIndex);
    const p_cur = this.points[prevIdx];
    const p_next = this.points[Math.min(prevIdx + 1, this.points.length - 1)];
    const alphaCurr = this.currentIndex - prevIdx;
    const currentDistM = (p_cur.distAcum || 0) + alphaCurr * ((p_next.distAcum || 0) - (p_cur.distAcum || 0));

    // Velocidad deseada en metros/segundo: base ~7.5 m/s * speed * speedFactor
    const metersPerSecond = 7.5 * currentSpeed * speedFactor;
    const metersThisFrame = metersPerSecond * safeDt;

    // Distancia métrica objetivo a alcanzar en este frame
    const targetDistM = currentDistM + metersThisFrame;

    let targetAdvanceIndex: number;
    const totalTrackDistM = this.points[this.points.length - 1].distAcum || 0;

    if (targetDistM >= totalTrackDistM) {
      targetAdvanceIndex = this.points.length - 1;
    } else {
      // Búsqueda del segmento que contiene targetDistM empezando desde prevIdx
      let scanIdx = prevIdx;
      while (scanIdx < this.points.length - 1 && (this.points[scanIdx + 1].distAcum || 0) < targetDistM) {
        scanIdx++;
      }
      const pA = this.points[scanIdx];
      const pB = this.points[Math.min(scanIdx + 1, this.points.length - 1)];
      const segLen = (pB.distAcum || 0) - (pA.distAcum || 0);
      const frac = segLen > 0.001 ? (targetDistM - (pA.distAcum || 0)) / segLen : 0;
      targetAdvanceIndex = scanIdx + Math.max(0, Math.min(frac, 1));
    }

    // 🛡️ EVENT-CLAMPING: En Modo Guiado / Interactivo, impedir rebasar el próximo evento pendiente en este frame
    if (this.interactiveMode) {
      for (let k = prevIdx + 1; k < this.points.length; k++) {
        if (this.points[k]?.event) {
          if (targetAdvanceIndex >= k) {
            targetAdvanceIndex = k;
          }
          break;
        }
      }
    }

    this.currentIndex = targetAdvanceIndex;
    const newIdx = Math.floor(Math.min(this.currentIndex, this.points.length - 1));

    // Si cruzamos puntos reales, gestionar modos y estadísticas
    if (newIdx > prevIdx) {
      const startTime = performance.now();
      const coordsBatch: [number, number][] = [];

      for (let i = prevIdx + 1; i <= newIdx; i++) {
        const p = this.points[i];
        const prevP = this.points[i - 1] || this.points[0];

        // Determinamos el metadato del punto (Prioridad: Modo del punto en BD > Segmento HF > Fallback)
        let newMode = p.mode || p.hfMode || 'walking';
        let newColor = p.hfColor || '';
        let newPhase = p.hfPhase || '';
        let newOpacity = p.hfOpacity ?? 0.9;
        let newDashArray = p.hfDashArray ?? null;

        // Buscar en hfSegments si estamos en modo alta fidelidad
        if (this.isHighFidelityMode && this.hfSegments.length > 0) {
          const seg = this.hfSegments.find(s => i >= s.startIndex && i <= s.endIndex);
          if (seg) {
            // Si el punto no tiene un modo propio de BD (como boat o walking), usar seg.mode
            if (!p.mode || (seg.mode && seg.mode !== 'driving')) {
              newMode = seg.mode;
            }
            newColor = seg.color;
            newPhase = seg.phase;
            newOpacity = seg.opacity;
            newDashArray = seg.dashArray;
          }
        }

        if (p.isGap || newMode !== this.currentMode || newColor !== this.currentHfColor || newPhase !== this.currentHfPhase) {
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

        if (p.event && this.interactiveMode) {
          // Si hay puntos pendientes antes del evento, inyectarlos
          if (coordsBatch.length > 0) {
            this.addLatLngsToCurrentPolylines(coordsBatch);
            coordsBatch.length = 0;
          }
          this.currentIndex = i;
          this.renderCurrentFrame();
          const targetCoords: [number, number] | undefined = (p.event.lat !== undefined && p.event.lng !== undefined) ? [p.event.lat, p.event.lng] : undefined;
          this.pauseForEvent(p.event, targetCoords);
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
      this.progress = 100;
      if (!this.isFinished && this.animationStarted) {
        this.isFinished = true;
        console.log('🏁 [GPX Completado] Trayecto terminado. Emitiendo onAnimacionCompletada');
        this.onAnimacionCompletada.emit();
      }
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

      // ✨ Sincronización sub-píxel continua: la punta de la polilínea sigue exactamente al vehículo
      if (this.currentPolyline && this.currentPolylinePoints && this.currentPolylinePoints.length > 0) {
        const tipPt = this.L.latLng(lat, lng);
        this.currentPolyline.setLatLngs([...this.currentPolylinePoints, tipPt]);
      }
      if (this.currentBackgroundPolyline && this.currentPolylinePoints && this.currentPolylinePoints.length > 0) {
        const tipPt = this.L.latLng(lat, lng);
        this.currentBackgroundPolyline.setLatLngs([...this.currentPolylinePoints, tipPt]);
      }

      // Fase 2: Seguimiento de cámara throttled con Safe Zone (desactivado en Álbum-Libro)
      if (!this.pendingEvent && !this.activeEvent && this.cameraMode === 'TRACKING' && this.interactiveMode !== false) {
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

  private async pauseForEvent(event: any, coords?: [number, number]) {
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
    const targetLat = coords ? coords[0] : (event.lat !== undefined ? event.lat : (currentPoint ? currentPoint.lat : null));
    const targetLng = coords ? coords[1] : (event.lng !== undefined ? event.lng : (currentPoint ? currentPoint.lng : null));

    // Guardar posición exacta del track para regresar de forma fluida al reanudar
    if (currentPoint) {
      this.lastTrackMarkerLatLng = [currentPoint.lat, currentPoint.lng];
    } else if (this.marker) {
      const cur = this.marker.getLatLng();
      this.lastTrackMarkerLatLng = [cur.lat, cur.lng];
    }

    // ✨ Desplazar el avatar exactamente hasta la posición del archivo multimedia / parada
    if (targetLat !== null && targetLng !== null && this.marker) {
      this.animateMarkerTo([targetLat, targetLng], 400);
    }

    if (targetLat !== null && targetLng !== null && this.map) {
      this.map.flyTo([targetLat, targetLng], 18, { animate: true, duration: 1.2 });
    }

    // ✨ Modo Dynamics: Resetear carrusel al primer elemento
    this.clusterSelectedMediaIndex = 0;

    // ✨ Modo Dynamics: Dibujar halo circular dinámico si es un grupo con múltiples archivos
    this.removerHaloCluster();
    if (this.map && event.archivos && event.archivos.length > 1 && targetLat !== null && targetLng !== null) {
      const radius = event.clusterRadio || 12;
      this.clusterHaloCircle = this.L.circle([targetLat, targetLng], {
        radius,
        color: '#6366F1',
        weight: 2.5,
        dashArray: '6, 6',
        fillColor: '#818CF8',
        fillOpacity: 0.18,
        className: 'cluster-halo-dynamic'
      }).addTo(this.map);
    }

    // Preparar metadatos base para la foto (Fecha y Hora) y Dirección pre-cargada si existe
    if (event.archivos && event.archivos.length > 0) {
      for (const archivo of event.archivos) {
        if (!archivo.direccion && targetLat !== null && targetLng !== null) {
          // Si no tiene dirección interna, la obtenemos dinámicamente con Geocoding Inverso
          try {
            // Fallback al GPS
            const locationStr = `${targetLat},${targetLng}`;
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
          archivo.fechaCalculada = archivo.fecha ? new Date(archivo.fecha) : (currentPoint?.time || new Date());
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
    this.removerHaloCluster();
    this.activeEvent = null;
    this.pendingEvent = null;

    const doResume = () => {
      if (this.map) {
        if (this.preEventSnapshot) {
          const snap = this.preEventSnapshot;
          this.preEventSnapshot = null; // Limpiar para que la guarda funcione
          this.cameraMode = snap.cameraMode;
          this.autoZoomPaused = snap.cameraMode === 'FREE';
        }

        // Reanudar directamente hacia el siguiente tramo sin el rebote brusco al zoom general lejano
        if (!this.isPlaying) {
          this.isPlaying = true;
          this.narrativeService.startSegment(Math.floor(this.currentIndex), this.currentDistKm, this.currentMode || 'walking');
          this.calculateSegmentBoundsAndSpeed();
        }
      }
    };

    if (this.lastTrackMarkerLatLng && this.marker) {
      const returnCoord = this.lastTrackMarkerLatLng;
      this.lastTrackMarkerLatLng = null;
      this.animateMarkerTo(returnCoord, 300).then(() => {
        doResume();
      });
    } else {
      doResume();
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

  private normalizeModeKey(mode: string | null | undefined): string {
    if (!mode) return 'walking';
    const m = mode.toLowerCase();
    if (m.includes('walk') || m.includes('camin') || m.includes('andan')) return 'walking';
    if (m.includes('car') || m.includes('coch') || m.includes('driv')) return 'driving';
    if (m.includes('bic') || m.includes('cycl')) return 'cycling';
    if (m.includes('run') || m.includes('corr')) return 'running';
    if (m.includes('bus') || m.includes('autobus')) return 'bus';
    if (m.includes('boat') || m.includes('barco') || m.includes('ship') || m.includes('ferry') || m.includes('crucero')) return 'boat';
    return 'transport';
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
      const normKey = this.normalizeModeKey(mode);
      color = colorSet[normKey] || colorSet[mode] || colorSet['transport'] || '#FF0000';
    }

    if (opacity === undefined || opacity === null) {
      opacity = isReturn ? 0.45 : 0.9;
    }

    if (dashArray === undefined || dashArray === null) {
      dashArray = isReturn ? '10, 8' : null;
    }

    const startPt = this.L.latLng(startLatLng[0], startLatLng[1]);
    this.currentPolylinePoints = [startPt];

    this.currentBackgroundPolyline = this.L.polyline([startPt], {
      color: '#FFFFFF',
      weight: 9,
      opacity: isReturn ? 0.3 : 0.8,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.map);
    this.polylines.push(this.currentBackgroundPolyline);

    this.currentPolyline = this.L.polyline([startPt], {
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
    if (this.markerAnimFrameId) {
      cancelAnimationFrame(this.markerAnimFrameId);
      this.markerAnimFrameId = null;
    }
  }

  private animateMarkerTo(targetLatLng: [number, number], durationMs: number = 400): Promise<void> {
    if (this.markerAnimFrameId) {
      cancelAnimationFrame(this.markerAnimFrameId);
      this.markerAnimFrameId = null;
    }

    return new Promise(resolve => {
      if (!this.marker) { resolve(); return; }
      const startLatLng = this.marker.getLatLng();
      const startLat = startLatLng.lat;
      const startLng = startLatLng.lng;
      const endLat = targetLatLng[0];
      const endLng = targetLatLng[1];

      if (Math.abs(startLat - endLat) < 0.000005 && Math.abs(startLng - endLng) < 0.000005) {
        this.marker.setLatLng(targetLatLng);
        resolve();
        return;
      }

      const startTime = performance.now();

      const step = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        const curLat = startLat + (endLat - startLat) * ease;
        const curLng = startLng + (endLng - startLng) * ease;
        if (this.marker) {
          this.marker.setLatLng([curLat, curLng]);
        }
        if (progress < 1) {
          this.markerAnimFrameId = requestAnimationFrame(step);
        } else {
          this.markerAnimFrameId = null;
          resolve();
        }
      };
      this.markerAnimFrameId = requestAnimationFrame(step);
    });
  }

  esSoloAudio(event: any): boolean {
    if (!event || !event.archivos || event.archivos.length === 0) return false;
    return event.archivos.every((a: any) => (a.tipo || '').toLowerCase() === 'audio');
  }

  cerrar() {
    this.removerHaloCluster();
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
    if (!ruta) return '';
    let rutaLimpia = ruta;
    if (rutaLimpia.startsWith('uploads/') || rutaLimpia.startsWith('uploads\\')) {
      rutaLimpia = rutaLimpia.substring(8);
    }
    if (rutaLimpia.startsWith('http://') || rutaLimpia.startsWith('https://')) {
      return rutaLimpia;
    }
    if (rutaLimpia.includes('\\')) {
      rutaLimpia = rutaLimpia.substring(rutaLimpia.lastIndexOf('\\') + 1);
    }
    return `${environment.apiUrl}/uploads/${rutaLimpia}`;
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
    if (m.includes('boat') || m.includes('barco') || m.includes('ship') || m.includes('ferry') || m.includes('crucero')) return 'En Barco';
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
    if (m.includes('car') || m.includes('coch') || m.includes('driv') || m.includes('auto') || m.includes('taxi')) return '🚗';
    if (m.includes('bic') || m.includes('cycl')) return '🚲';
    if (m.includes('run') || m.includes('corr')) return '🏃';
    if (m.includes('bus') || m.includes('autobus')) return '🚌';
    if (m.includes('tren') || m.includes('train') || m.includes('metro') || m.includes('ferrocarril')) return '🚆';
    if (m.includes('avion') || m.includes('plane') || m.includes('flight') || m.includes('vuelo')) return '✈️';
    if (m.includes('boat') || m.includes('barco') || m.includes('ship') || m.includes('ferry') || m.includes('crucero')) return '🚢';

    return this.MODE_ICONS[m] || '📍';
  }

  private updateMarkerIcon(mode: string) {
    if (!this.marker || !this.L) return;
    const iconHtml = `<div class="transport-icon-wrapper">${this.getModeIcon(mode)}</div>`;
    this.marker.setIcon(this.L.divIcon({
      className: 'custom-transport-marker',
      html: iconHtml,
      iconSize: [48, 48],
      iconAnchor: [24, 24]
    }));
  }

  private getSpeedFactor(mode: string | null): number {
    if (!mode) return 1;
    const m = mode.toLowerCase();
    if (m.includes('walk') || m.includes('andan') || m.includes('camin')) return 1.2;
    if (m.includes('run') || m.includes('corr')) return 1.5;
    if (m.includes('bic') || m.includes('cycl')) return 1.5;
    if (m.includes('car') || m.includes('coch') || m.includes('driv')) return 1.6;
    if (m.includes('bus')) return 1.3;
    if (m.includes('boat') || m.includes('barco') || m.includes('ship') || m.includes('ferry') || m.includes('crucero')) return 1.8;
    if (m.includes('plane') || m.includes('avion')) return 3.0;
    if (m.includes('train') || m.includes('tren')) return 2.0;
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
            } catch (err) { }
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
    // 🛡️ En Álbum-Libro (interactiveMode === false), la cámara permanece estática en su encuadre aéreo
    if (this.interactiveMode === false || this.cameraMode !== 'TRACKING' || !this.map) return;

    const now = performance.now();
    if (now - this.lastCameraUpdateTime < this.CAMERA_THROTTLE_MS) return;

    const container = this.map.getContainer();
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const SAFE_ZONE_RATIO = 0.20;
    const marginX = containerWidth * SAFE_ZONE_RATIO;
    const marginY = containerHeight * SAFE_ZONE_RATIO;

    const markerPoint = this.map.latLngToContainerPoint(markerLatLng);

    const outOfSafeZone =
      markerPoint.x < marginX ||
      markerPoint.x > containerWidth - marginX ||
      markerPoint.y < marginY ||
      markerPoint.y > containerHeight - marginY;

    if (outOfSafeZone) {
      this.map.panTo(markerLatLng, { animate: false });
      this.lastCameraUpdateTime = now;
    }
  }

  private addLatLngsToCurrentPolylines(coords: [number, number][]) {
    if (!this.map || coords.length === 0) return;

    // En rutas largas o con alta densidad de puntos, descartar puntos visualmente redundantes
    // para no sobrecargar el árbol DOM de SVG de Leaflet en cada frame (previniendo congelación del navegador)
    const isDenseRoute = this.points.length > 500 || (this.points[this.points.length - 1]?.distAcum || 0) > 40000;
    let lastPt = this.currentPolylinePoints.length > 0 ? this.currentPolylinePoints[this.currentPolylinePoints.length - 1] : null;

    for (const c of coords) {
      if (isDenseRoute && lastPt) {
        const dLat = Math.abs(c[0] - lastPt.lat);
        const dLng = Math.abs(c[1] - lastPt.lng);
        if (dLat < 0.00015 && dLng < 0.00015) {
          continue; // Omitir sub-puntos menores a ~12 metros para no colapsar la polilínea
        }
      }
      const newPt = this.L.latLng(c[0], c[1]);
      this.currentPolylinePoints.push(newPt);
      lastPt = newPt;
    }

    if (this.currentPolyline) {
      this.currentPolyline.setLatLngs(this.currentPolylinePoints);
    }
    if (this.currentBackgroundPolyline) {
      this.currentBackgroundPolyline.setLatLngs(this.currentPolylinePoints);
    }
  }

  get displayZoom(): string {
    return this.map ? this.map.getZoom().toFixed(1) : '16.0';
  }
}


