import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit, OnChanges, SimpleChanges, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { GpxPoint } from '../../servicios/gpx-animation.service';
import { TrackAnchor, EditAction, TrackEdit } from '../../modelos/track-edit.model';
import { TrackEditorService } from '../../servicios/track-editor.service';
import { RoutingService, RoutingResult } from '../../servicios/routing.service';

export interface TramoEditor {
  id: string;
  nombre: string;
  origenNombre: string;
  destinoNombre: string;
  startIdx: number;
  endIdx: number;
  distanciaKm: number;
  horaInicio?: string;
  horaFin?: string;
  modo: string;
  iconoModo: string;
}

@Component({
  selector: 'app-track-editor-map',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './track-editor-map.component.html',
  styleUrls: ['./track-editor-map.component.scss']
})
export class TrackEditorMapComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef;

  @Input() actividadId?: number;
  @Input() gpxPoints: GpxPoint[] = [];
  @Input() trackEdits: TrackEdit[] = [];
  @Input() mediaGroups: { lat: number, lng: number; nombre?: string; titulo?: string }[] = [];
  @Output() editRequest = new EventEmitter<{
    action: EditAction, 
    startAnchor: TrackAnchor, 
    endAnchor: TrackAnchor, 
    newMode?: string,
    injectedGeometry?: { lat: number, lng: number }[]
  }>();
  @Output() insertRequest = new EventEmitter<{
    points: { lat: number; lng: number; time?: string; mode?: string }[]
  }>();
  @Output() overrideModeRequest = new EventEmitter<{
    points: { lat: number; lng: number; time?: string; mode?: string }[]
  }>();
  @Output() deleteRequest = new EventEmitter<{
    anchorA: TrackAnchor;
    anchorB: TrackAnchor;
  }>();
  @Output() appendRequest = new EventEmitter<{
    points: { lat: number; lng: number }[]
  }>();
  @Output() saveAllEdits = new EventEmitter<any[]>(); // Emits pendingEdits
  @Output() rutaOriginalGuardada = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  @Input() archivosMedia: any[] = []; // Fotos de la actividad para calibración de anclas

  // 🔄 Modo Previsualización de Ruta Original con Retroceso
  modoPrevisualizandoOriginal: boolean = false;
  puntosGpxAntesDeOriginal: GpxPoint[] = [];
  guardandoOriginal: boolean = false;

  // 🗺️ Modo Previsualización de Ruta Probable con Retroceso
  modoPrevisualizandoProbable: boolean = false;
  puntosGpxAntesDeProbable: GpxPoint[] = [];
  generandoProbable: boolean = false;
  guardandoProbable: boolean = false;
  progresoGeneracionProbable: string = '';
  calculandoRutaReal: boolean = false;

  // In-memory edits tracking
  pendingEdits: any[] = [];
  previewingEditId: string | null = null;

  // Selector inteligente de tramos A-B
  tramosDisponibles: TramoEditor[] = [];
  selectedTramoId: string = '';

  // Herramienta de Asignación de Tiempos
  showCustomTimeInputs: boolean = false;
  customStartDate: string = '';
  customStartTime: string = '10:00:00';
  customEndDate: string = '';
  customEndTime: string = '10:30:00';

  // Visualizador de marcas de tiempo GPX
  mostrarTiempos: boolean = false;
  private timeMarkersGroup: L.FeatureGroup | null = null;

  // 📏 Visualizador y modificación de marcas de distancia GPX (Kilómetros / Metros)
  mostrarDistancias: boolean = false;
  private distanceMarkersGroup: L.FeatureGroup | null = null;
  showCustomDistInputs: boolean = false;
  customDistValue: number = 0;
  customDistUnit: 'km' | 'm' = 'km';
  customDistTimeSyncMode: 'keep_time' | 'update_time' = 'keep_time';
  currentSegmentDistMeters: number = 0;

  private map: L.Map | null = null;
  private polylinesGroup: L.FeatureGroup | null = null;
  private highlightPolyline: L.Polyline | null = null;
  
  private markerA: L.CircleMarker | null = null;
  private markerB: L.CircleMarker | null = null;

  anchorA: TrackAnchor | null = null;
  anchorB: TrackAnchor | null = null;

  editorState: 'SELECTING' | 'EDITING_GEOMETRY' | 'APPENDING' | 'APPEND_SELECTING_B' | 'PREPEND_SELECTING_A' | 'IDLE' | 'SELECTING_A' | 'SELECTING_B' | 'SELECTING_MODE' | 'DRAWING_INSERT' | 'PREVIEW_INSERT' | 'CALCULATING_ROUTE' | 'PREVIEW_ROUTE' | 'GET_LOCATION' = 'SELECTING';
  activeFlow: 'INSERT' | 'APPEND' | 'PREPEND' | null = null;

  // --- Routing asistido (Fase 2.2) ---
  routingProfile: string = 'driving';
  routingResult: RoutingResult | null = null;
  routingError: string | null = null;
  private routePreviewLine: L.Polyline | null = null;
  
  private syntheticLine: L.Polyline | null = null;
  private syntheticVertices: L.Marker[] = [];

  // --- Append mode (Fase 2.1.a) ---
  private appendLine: L.Polyline | null = null;
  private appendVertices: L.Marker[] = [];
  appendPoints: { lat: number; lng: number }[] = [];

  selectedMode: string = 'driving';

  // Opciones de vehículos disponibles para Override Mode
  vehicleModes = [
    { id: 'driving', name: 'Coche', icon: '🚗' },
    { id: 'walking', name: 'Andando', icon: '🚶' },
    { id: 'cycling', name: 'Bicicleta', icon: '🚲' },
    { id: 'boat', name: 'Barco', icon: '🚢' },
    { id: 'plane', name: 'Avión', icon: '✈️' },
    { id: 'train', name: 'Tren', icon: '🚂' },
    { id: 'bus', name: 'Autobús', icon: '🚌' }
  ];

  // Paleta de colores para override_mode
  private readonly MODE_COLORS: { [key: string]: string } = {
    walking: '#059669', // Emerald
    driving: '#DC2626', // Red
    cycling: '#FF9800', // Orange
    boat: '#0284C7',    // Light Blue
    plane: '#7C3AED',   // Violet
    train: '#D97706',   // Amber dark
    bus: '#9C27B0',     // Purple
    original: '#FF0000' // Red (igual que ver-gpx)
  };

  constructor(
    private trackEditorService: TrackEditorService,
    private routingService: RoutingService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {}

  ngOnChanges(changes: SimpleChanges) {
    if ((changes['gpxPoints'] || changes['trackEdits'] || changes['mediaGroups']) && this.map) {
      this.drawBaseAndEdits();
    }
  }

  ngAfterViewInit() {
    this.initMap();
  }

  ngOnDestroy() {
    if (this.map) {
      this.map.remove();
    }
  }

  private initMap() {
    if (!this.mapContainer || !this.gpxPoints || this.gpxPoints.length === 0) return;

    this.map = L.map(this.mapContainer.nativeElement, {
      attributionControl: true,
      zoomControl: true,
      preferCanvas: true
    }).setView([this.gpxPoints[0].lat, this.gpxPoints[0].lng], 13);

    // --- CAPAS BASE (SATÉLITE Y MAPA) ---
    const satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles © Esri', maxZoom: 18 }
    );
    const streets = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '© OpenStreetMap', maxZoom: 19 }
    );
    
    satellite.addTo(this.map); // Capa por defecto

    // Control de capas
    const layersControl = L.control.layers(
      { 'Satélite': satellite, 'Mapa': streets },
      {},
      { position: 'topleft' }
    ).addTo(this.map);

    // Mover el control de capas a la mitad izquierda de la pantalla
    const layersContainer = layersControl.getContainer();
    if (layersContainer) {
      layersContainer.classList.add('capas-medio-izq');
    }

    this.polylinesGroup = L.featureGroup().addTo(this.map);
    this.timeMarkersGroup = L.featureGroup().addTo(this.map);
    this.distanceMarkersGroup = L.featureGroup().addTo(this.map);

    this.drawBaseAndEdits();

    if (this.polylinesGroup.getLayers().length > 0) {
      this.map.fitBounds(this.polylinesGroup.getBounds());
    }

    // Evento de clic en el mapa para snap
    this.map.on('click', (e: L.LeafletMouseEvent) => this.handleMapClick(e));

    // Escuchador de zoom y movimiento para actualizar marcadores de tiempo y distancia adaptativamente
    this.map.on('zoomend moveend', () => {
      if (this.mostrarTiempos) {
        this.updateTimeMarkers();
      }
      if (this.mostrarDistancias) {
        this.updateDistanceMarkers();
      }
    });
  }

  // Paleta y mapeo de colores por modo de transporte (idéntico a ver-gpx y reproductor animado)
  public getModeColor(rawMode: string): string {
    const m = (rawMode || '').toLowerCase();
    if (m.includes('walk') || m.includes('camin') || m.includes('andan') || m.includes('pie')) return '#059669';
    if (m.includes('car') || m.includes('coch') || m.includes('driv')) return '#DC2626';
    if (m.includes('bic') || m.includes('cycl')) return '#FF9800';
    if (m.includes('run') || m.includes('corr')) return '#2196F3';
    if (m.includes('bus') || m.includes('autobus')) return '#9C27B0';
    if (m.includes('boat') || m.includes('barco') || m.includes('ship') || m.includes('ferry') || m.includes('crucero')) return '#0284C7';
    if (m.includes('plane') || m.includes('avion')) return '#7C3AED';
    if (m.includes('train') || m.includes('tren')) return '#D97706';
    return '#9E9E9E';
  }

  private drawBaseAndEdits() {
    if (!this.map || !this.gpxPoints || this.gpxPoints.length === 0 || !this.polylinesGroup) return;

    this.polylinesGroup.clearLayers();

    // 1. Determinar el estado visual de cada punto leyendo su modo real
    const visualPoints = this.gpxPoints.map(p => ({ 
      lat: p.lat, 
      lng: p.lng, 
      visualMode: p.mode || p.hfMode || 'walking', 
      isDeleted: false,
      isHidden: false,
      isPreviewing: false,
      isGap: !!p.isGap
    }));

    // 2. Aplicar Edits EN MEMORIA para marcar el estado visual
    const deletes = this.pendingEdits.filter(e => e.type === 'delete_segment');
    const overrides = this.pendingEdits.filter(e => e.type === 'override_mode');
    const recalculates = this.pendingEdits.filter(e => e.type === 'recalculate_route' || e.type === 'insert_segment');

    const applyEditToVisuals = (edit: any) => {
      const startIdx = this.trackEditorService.resolveAnchor(edit.data.startAnchor, this.gpxPoints);
      const endIdx = this.trackEditorService.resolveAnchor(edit.data.endAnchor, this.gpxPoints);
      
      if (startIdx !== -1 && endIdx !== -1) {
        const min = Math.min(startIdx, endIdx);
        const max = Math.max(startIdx, endIdx);
        
        for (let i = min; i <= max; i++) {
          if (edit.type === 'delete_segment') {
             visualPoints[i].isDeleted = true;
             visualPoints[i].isHidden = true; // Por defecto no se dibujará
             if (this.previewingEditId === edit.id) {
               visualPoints[i].isHidden = false; // Se dibujará si está en preview
               visualPoints[i].isPreviewing = true;
             }
          } else if (edit.type === 'override_mode' && edit.data.newMode) {
             visualPoints[i].visualMode = edit.data.newMode;
          } else if (edit.type === 'recalculate_route' || edit.type === 'insert_segment') {
             visualPoints[i].isHidden = true; // La geometría anterior se oculta para dar paso a la nueva
          }
        }
      }
    };

    deletes.forEach(applyEditToVisuals);
    overrides.forEach(applyEditToVisuals);
    recalculates.forEach(applyEditToVisuals);

    // Aplicar asignaciones de tiempo pendientes en memoria sobre gpxPoints
    const timeOverrides = this.pendingEdits.filter(e => e.type === 'assign_timestamps');
    timeOverrides.forEach(edit => {
      const startIdx = this.trackEditorService.resolveAnchor(edit.data.startAnchor, this.gpxPoints);
      const endIdx = this.trackEditorService.resolveAnchor(edit.data.endAnchor, this.gpxPoints);
      if (startIdx !== -1 && endIdx !== -1 && edit.data.points) {
        const min = Math.min(startIdx, endIdx);
        edit.data.points.forEach((p: any, idx: number) => {
          if (this.gpxPoints[min + idx]) {
            this.gpxPoints[min + idx].time = p.time ? new Date(p.time) : undefined;
          }
        });
      }
    });

    // 3. Agrupar puntos contiguos que comparten el mismo estado visual
    let currentSegment: any[] = [];
    let currentMode = visualPoints[0].visualMode;
    let currentIsDeleted = visualPoints[0].isDeleted;
    let currentIsHidden = visualPoints[0].isHidden;
    let currentIsPreviewing = visualPoints[0].isPreviewing;

    const flushSegment = () => {
      if (currentSegment.length > 1 && !currentIsHidden) {
        const latlngs = currentSegment.map(p => [p.lat, p.lng] as L.LatLngExpression);
        
        let color = this.getModeColor(currentMode);
        let weight = 4;
        let opacity = 0.9;
        let dashArray = '';
        let smoothFactor = 1;
        let className = '';

        if (currentIsDeleted && currentIsPreviewing) {
          color = '#ff4444'; // Rojo fuerte para preview de borrado
          weight = 5;
          className = 'preview-blink';
        }

        // Sombra blanca inferior para contraste en satélite (idéntico a ver-gpx)
        L.polyline(latlngs, {
          color: '#FFFFFF',
          weight: weight + 3,
          opacity: 0.7,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(this.polylinesGroup!);

        // Línea principal con el color del transporte
        L.polyline(latlngs, {
          color, weight, opacity, dashArray, smoothFactor, className, lineCap: 'round', lineJoin: 'round'
        }).addTo(this.polylinesGroup!);

        // Solo pintar flechas si no es un tramo borrado
        if (!currentIsDeleted) {
          this.addDirectionArrows(L, latlngs, color, opacity);
        }
      }
    };

    for (let i = 0; i < visualPoints.length; i++) {
      const p = visualPoints[i];
      
      if (p.isGap || p.visualMode !== currentMode || p.isDeleted !== currentIsDeleted || p.isHidden !== currentIsHidden || p.isPreviewing !== currentIsPreviewing) {
        if (p.isGap && currentSegment.length > 0) {
          flushSegment();
          currentSegment = [p];
        } else {
          currentSegment.push(p); 
          flushSegment();
          currentSegment = [p];
        }
        currentMode = p.visualMode;
        currentIsDeleted = p.isDeleted;
        currentIsHidden = p.isHidden;
        currentIsPreviewing = p.isPreviewing;
      } else {
        currentSegment.push(p);
      }
    }
    flushSegment(); // Último segmento

    // 4. Dibujar Prolongaciones (Appends) si están en previsualización
    const appends = this.pendingEdits.filter(e => e.type === 'append_segment');
    const finalLat = this.gpxPoints[this.gpxPoints.length - 1].lat;
    const finalLng = this.gpxPoints[this.gpxPoints.length - 1].lng;
    appends.forEach((appendEdit) => {
      const isPreviewing = this.previewingEditId === appendEdit.id;
      if (!isPreviewing) return;
      const points = appendEdit.data.points;
      if (!points || points.length === 0) return;

      const latlngs = points.map((p: any) => [p.lat, p.lng] as L.LatLngExpression);
      const mode = points[0].mode || 'driving';
      const color = this.getModeColor(mode);

      L.polyline(latlngs, {
        color, weight: 6, opacity: 1, className: 'preview-blink', lineCap: 'round', lineJoin: 'round'
      }).addTo(this.polylinesGroup!);
    });

    // 4.b. Dibujar Rutas Reales Recalculadas o Insertadas (recalculate_route / insert_segment)
    const recalculatedRoutes = this.pendingEdits.filter(e => e.type === 'recalculate_route' || e.type === 'insert_segment');
    recalculatedRoutes.forEach((recEdit) => {
      const isPreviewing = this.previewingEditId === recEdit.id;
      const points = recEdit.data.points;
      if (!points || points.length === 0) return;

      const latlngs = points.map((p: any) => [p.lat, p.lng] as L.LatLngExpression);
      const mode = recEdit.data.mode || points[0].mode || 'driving';
      const color = this.getModeColor(mode);
      const weight = 5;
      const opacity = 1;
      const className = isPreviewing ? 'preview-blink' : '';

      // Sombra blanca inferior
      L.polyline(latlngs, {
        color: '#FFFFFF',
        weight: weight + 3,
        opacity: 0.7,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(this.polylinesGroup!);

      L.polyline(latlngs, {
        color,
        weight,
        opacity,
        className,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(this.polylinesGroup!);

      this.addDirectionArrows(L, latlngs, color, opacity);
    });

    // Marcador de INICIO (verde)
    const inicioIcon = L.divIcon({
      className: 'inicio-marker-custom',
      html: `
        <svg width="24" height="34" viewBox="0 0 24 34" style="filter: drop-shadow(0px 3px 3px rgba(0,0,0,0.4));">
          <path d="M12 2C6.48 2 2 6.48 2 12c0 7.5 10 20 10 20s10-12.5 10-20c0-5.52-4.48-10-10-10z" fill="#4CAF50"/>
          <circle cx="12" cy="12" r="4" fill="white"/>
        </svg>
      `,
      iconSize: [24, 34],
      iconAnchor: [12, 34],
      popupAnchor: [0, -34]
    });
    L.marker([this.gpxPoints[0].lat, this.gpxPoints[0].lng], { icon: inicioIcon, interactive: false }).addTo(this.polylinesGroup!);

    // Marcador de FIN (rojo)
    const finIcon = L.divIcon({
      className: 'fin-marker-custom',
      html: `
        <svg width="24" height="34" viewBox="0 0 24 34" style="filter: drop-shadow(0px 3px 3px rgba(0,0,0,0.4));">
          <path d="M12 2C6.48 2 2 6.48 2 12c0 7.5 10 20 10 20s10-12.5 10-20c0-5.52-4.48-10-10-10z" fill="#F44336"/>
          <circle cx="12" cy="12" r="4" fill="white"/>
        </svg>
      `,
      iconSize: [24, 34],
      iconAnchor: [12, 34],
      popupAnchor: [0, -34]
    });
    L.marker([finalLat, finalLng], { icon: finIcon, interactive: false }).addTo(this.polylinesGroup!);

    // Marcadores de Fotos (solo visuales, idénticos a ver-gpx)
    if (this.mediaGroups && this.mediaGroups.length > 0) {
      this.mediaGroups.forEach((grupo, index) => {
        const numeroSecuencial = index + 1;
        const grupoIcon = L.divIcon({
          className: 'photo-marker-custom',
          html: `
          <div style="display: flex; flex-direction: column; align-items: center;">
            <svg width="44" height="44" viewBox="0 0 44 44" style="filter: drop-shadow(0px 3px 3px rgba(0,0,0,0.4)); z-index: 5;">
              <path d="M22 2 C14 2 8 8 8 16 C8 26 22 42 22 42 C22 42 36 26 36 16 C36 8 30 2 22 2 Z" fill="#E53935" />
              <circle cx="22" cy="16" r="6" fill="white" />
            </svg>
            <div style="margin-top: -8px; background: #1E88E5; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4); z-index: 10; position: relative;">
              #${numeroSecuencial}
            </div>
          </div>
          `,
          iconSize: [44, 60],
          iconAnchor: [22, 60]
        });
        L.marker([grupo.lat, grupo.lng], { icon: grupoIcon, interactive: false, keyboard: false }).addTo(this.polylinesGroup!);
      });
    }

    // 4. Actualizar lista de tramos disponibles para el selector
    this.actualizarTramosDisponibles();
  }

  private handleMapClick(e: L.LeafletMouseEvent) {
    if (!this.map) return;

    if (this.editorState === 'EDITING_GEOMETRY') {
      this.addSyntheticVertex(e.latlng);
      return;
    }

    if (this.editorState === 'APPENDING') {
      this.addAppendVertex(e.latlng);
      return;
    }

    if (this.editorState === 'DRAWING_INSERT') {
      this.addInsertVertex(e.latlng);
      return;
    }

    if (this.editorState === 'GET_LOCATION') {
      const lat = parseFloat(e.latlng.lat.toFixed(6));
      const lng = parseFloat(e.latlng.lng.toFixed(6));
      const coordObj = {
        latitud: lat,
        longitud: lng,
        altitud: 0
      };
      const coordStr = JSON.stringify(coordObj, null, 2);
      
      const copyFallback = (text: string) => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
          textArea.remove();
          return Promise.resolve();
        } catch (err) {
          textArea.remove();
          return Promise.reject(err);
        }
      };

      const copyPromise = (navigator.clipboard && window.isSecureContext) 
        ? navigator.clipboard.writeText(coordStr)
        : copyFallback(coordStr);

      copyPromise.then(() => {
        alert(`¡Coordenada copiada!\n\n${coordStr}\n\nPuedes pegarla directamente en la ficha de la foto o actividad.`);
        this.editorState = 'SELECTING';
      }).catch(err => {
        console.error('Error al copiar:', err);
        alert(`Coordenada: ${coordStr}\n(Cópiala manualmente, el navegador bloqueó el portapapeles)`);
        this.editorState = 'SELECTING';
      });
      return;
    }

    if (this.editorState === 'IDLE' || this.editorState === 'PREVIEW_INSERT') return;

    if (this.editorState === 'APPEND_SELECTING_B') {
      // Para prolongar, permitimos pinchar en cualquier parte del mapa, no hace falta que sea un punto existente
      this.setInsertAnchorBVirtual(e.latlng);
      return;
    }

    if (this.editorState === 'PREPEND_SELECTING_A') {
      // Para anteponer, permitimos pinchar en cualquier parte del mapa para fijar el nuevo inicio
      this.setInsertAnchorAVirtual(e.latlng);
      return;
    }

    const clickLayerPoint = this.map.latLngToLayerPoint(e.latlng);
    let closestIdx = -1;
    let minPixelDist = Infinity;

    for (let i = 0; i < this.gpxPoints.length; i++) {
      const p = this.gpxPoints[i];
      const pLatLng = L.latLng(p.lat, p.lng);
      
      const pLayerPoint = this.map.latLngToLayerPoint(pLatLng);
      const dist = clickLayerPoint.distanceTo(pLayerPoint);

      if (dist < minPixelDist) {
        minPixelDist = dist;
        closestIdx = i;
      }
    }

    // Eliminamos la limitación SNAP_TOLERANCE_PX para permitir seleccionar vértices de tramos largos
    if (closestIdx !== -1) {
      if (this.editorState === 'SELECTING_A') {
        this.setInsertAnchorA(closestIdx);
      } else if (this.editorState === 'SELECTING_B') {
        this.setInsertAnchorB(closestIdx);
      } else if (this.editorState === 'SELECTING') {
        this.setAnchor(closestIdx);
      }
    }
  }

  private setAnchor(index: number) {
    if (!this.map) return;

    const p = this.gpxPoints[index];
    const anchor: TrackAnchor = {
      index: index,
      time: p.time ? (p.time instanceof Date ? p.time.toISOString() : new Date(p.time as any).toISOString()) : undefined,
      lat: p.lat,
      lng: p.lng
    };

    if (!this.anchorA) {
      this.anchorA = anchor;
      this.markerA = L.circleMarker([p.lat, p.lng], {
        color: 'white', fillColor: '#22c55e', fillOpacity: 1, radius: 8, weight: 2
      }).addTo(this.map).bindTooltip('Inicio (A)', { permanent: true, direction: 'right' }).openTooltip();
    } else if (!this.anchorB) {
      this.anchorB = anchor;
      this.markerB = L.circleMarker([p.lat, p.lng], {
        color: 'white', fillColor: '#ef4444', fillOpacity: 1, radius: 8, weight: 2
      }).addTo(this.map).bindTooltip('Fin (B)', { permanent: true, direction: 'right' }).openTooltip();
      
      this.updateHighlight();
      this.initCustomTimeFields();
      this.initCustomDistFields();
    } else {
      // Si ya hay A y B, reiniciar selección
      this.clearSelection();
      this.setAnchor(index);
    }
  }

  private updateHighlight() {
    if (!this.map || !this.anchorA || !this.anchorB) return;

    if (this.highlightPolyline) {
      this.highlightPolyline.remove();
    }

    const startIdx = this.anchorA.index!;
    const endIdx = this.anchorB.index!;
    const min = Math.min(startIdx, endIdx);
    const max = Math.max(startIdx, endIdx);

    const highlightLatLngs = [];
    for (let i = min; i <= max; i++) {
      highlightLatLngs.push([this.gpxPoints[i].lat, this.gpxPoints[i].lng] as L.LatLngExpression);
    }

    this.highlightPolyline = L.polyline(highlightLatLngs, {
      color: '#f59e0b', // Amber (Resalte)
      weight: 6,
      opacity: 1
    }).addTo(this.map);
  }

  clearSelection() {
    this.anchorA = null;
    this.anchorB = null;
    this.selectedTramoId = '';
    this.showCustomTimeInputs = false;
    this.showCustomDistInputs = false;
    if (this.markerA) { this.markerA.remove(); this.markerA = null; }
    if (this.markerB) { this.markerB.remove(); this.markerB = null; }
    if (this.highlightPolyline) { this.highlightPolyline.remove(); this.highlightPolyline = null; }
    if (this.mostrarTiempos) {
      this.updateTimeMarkers();
    }
    if (this.mostrarDistancias) {
      this.updateDistanceMarkers();
    }
  }

  public actualizarTramosDisponibles(): void {
    if (!this.gpxPoints || this.gpxPoints.length < 2) {
      this.tramosDisponibles = [];
      return;
    }

    // 1. Recopilar puntos clave (Índice 0, Fotos / MediaGroups, Cambios de Modo, Índice N-1)
    interface PuntoClave {
      gpxIdx: number;
      nombre: string;
      tipo: 'inicio' | 'foto' | 'modo' | 'fin';
    }

    const puntosClave: PuntoClave[] = [
      { gpxIdx: 0, nombre: 'Inicio (#0)', tipo: 'inicio' }
    ];

    // Mapear cada mediaGroup a su gpxIdx más cercano
    if (this.mediaGroups && this.mediaGroups.length > 0) {
      this.mediaGroups.forEach((grupo, index) => {
        const num = index + 1;
        let closestIdx = 0;
        let minDist = Infinity;
        for (let i = 0; i < this.gpxPoints.length; i++) {
          const d = this.trackEditorService.getDistance(grupo.lat, grupo.lng, this.gpxPoints[i].lat, this.gpxPoints[i].lng);
          if (d < minDist) {
            minDist = d;
            closestIdx = i;
          }
        }
        const label = grupo.nombre || grupo.titulo || `Foto #${num}`;
        puntosClave.push({
          gpxIdx: closestIdx,
          nombre: `#${num} ${label}`,
          tipo: 'foto'
        });
      });
    }

    // Detectar cambios de modo de transporte
    for (let i = 1; i < this.gpxPoints.length; i++) {
      const prevMode = this.gpxPoints[i - 1].mode || this.gpxPoints[i - 1].hfMode || 'walking';
      const currMode = this.gpxPoints[i].mode || this.gpxPoints[i].hfMode || 'walking';
      if (currMode !== prevMode) {
        puntosClave.push({
          gpxIdx: i,
          nombre: `Cambio a ${this.getModeName(currMode)}`,
          tipo: 'modo'
        });
      }
    }

    // Puntos de inicio de prolongaciones (appends) pendientes
    const pendingAppends = this.pendingEdits.filter(e => e.type === 'append_segment');
    pendingAppends.forEach((appEdit, idx) => {
      const sIdx = appEdit.data?.startAnchor?.index;
      if (sIdx !== undefined && sIdx >= 0 && sIdx < this.gpxPoints.length) {
        puntosClave.push({
          gpxIdx: sIdx,
          nombre: `Prolongación #${idx + 1} (Inicio)`,
          tipo: 'modo'
        });
      }
    });

    // Punto final
    puntosClave.push({
      gpxIdx: this.gpxPoints.length - 1,
      nombre: 'Fin del recorrido',
      tipo: 'fin'
    });

    // Ordenar y eliminar duplicados
    puntosClave.sort((a, b) => a.gpxIdx - b.gpxIdx);
    const puntosClaveUnicos: PuntoClave[] = [];
    for (const p of puntosClave) {
      const last = puntosClaveUnicos[puntosClaveUnicos.length - 1];
      if (!last || p.gpxIdx > last.gpxIdx) {
        puntosClaveUnicos.push(p);
      }
    }

    // 2. Construir los tramos consecutivos entre puntos clave
    const tramos: TramoEditor[] = [];
    for (let i = 0; i < puntosClaveUnicos.length - 1; i++) {
      const pA = puntosClaveUnicos[i];
      const pB = puntosClaveUnicos[i + 1];

      const startPt = this.gpxPoints[pA.gpxIdx];
      const endPt = this.gpxPoints[pB.gpxIdx];

      // Calcular distancia acumulada entre ambos puntos
      let distMetros = 0;
      for (let j = pA.gpxIdx; j < pB.gpxIdx; j++) {
        distMetros += this.trackEditorService.getDistance(
          this.gpxPoints[j].lat, this.gpxPoints[j].lng,
          this.gpxPoints[j + 1].lat, this.gpxPoints[j + 1].lng
        );
      }

      // Si hay un cambio de distancia asignado en pendingEdits para este tramo, usarlo
      const distEdit = this.pendingEdits.find(e => e.type === 'assign_distance' && e.data?.distMeters !== undefined &&
        ((e.data.startAnchor?.index === pA.gpxIdx && e.data.endAnchor?.index === pB.gpxIdx) ||
         (e.data.startAnchor?.index === pB.gpxIdx && e.data.endAnchor?.index === pA.gpxIdx)));
      if (distEdit && distEdit.data?.distMeters) {
        distMetros = distEdit.data.distMeters;
      }

      const distKm = distMetros / 1000;

      // Extraer horas si existen
      let horaInicio = '';
      let horaFin = '';
      if (startPt && startPt.time) {
        const dt = new Date(startPt.time as any);
        if (!isNaN(dt.getTime())) {
          horaInicio = dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        }
      }
      if (endPt && endPt.time) {
        const dt = new Date(endPt.time as any);
        if (!isNaN(dt.getTime())) {
          horaFin = dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        }
      }

      const modo = (startPt && (startPt.mode || startPt.hfMode)) || 'walking';
      const iconoModo = this.getModeIcon(modo);

      tramos.push({
        id: `tramo-${i}`,
        nombre: `Tramo ${i + 1}: ${pA.nombre} ➔ ${pB.nombre}`,
        origenNombre: pA.nombre,
        destinoNombre: pB.nombre,
        startIdx: pA.gpxIdx,
        endIdx: pB.gpxIdx,
        distanciaKm: distKm,
        horaInicio: horaInicio,
        horaFin: horaFin,
        modo: modo,
        iconoModo: iconoModo
      });
    }

    this.tramosDisponibles = tramos;
  }

  public onSelectTramoFromDropdown(tramoId: string): void {
    this.selectedTramoId = tramoId;
    if (!tramoId) {
      this.clearSelection();
      return;
    }

    const tramo = this.tramosDisponibles.find(t => t.id === tramoId);
    if (!tramo) return;

    this.clearSelection();
    this.selectedTramoId = tramoId;

    // Establecer ancla A y ancla B
    this.setAnchor(tramo.startIdx);
    this.setAnchor(tramo.endIdx);

    if (this.mostrarTiempos) {
      this.updateTimeMarkers();
    }
    if (this.mostrarDistancias) {
      this.updateDistanceMarkers();
    }

    // Ajustar zoom y vista del mapa para encuadrar el tramo
    if (this.map && this.gpxPoints) {
      const pA = this.gpxPoints[tramo.startIdx];
      const pB = this.gpxPoints[tramo.endIdx];
      if (pA && pB) {
        const bounds = L.latLngBounds([
          [pA.lat, pA.lng],
          [pB.lat, pB.lng]
        ]);
        this.map.fitBounds(bounds.pad(0.2), {
          maxZoom: 16,
          animate: true,
          duration: 0.6
        });
      }
    }
  }

  public getModeIcon(mode: string): string {
    const m = (mode || '').toLowerCase();
    if (m.includes('boat') || m.includes('barco') || m.includes('crucero') || m.includes('ship') || m.includes('ferry')) return '🚢';
    if (m.includes('car') || m.includes('coche') || m.includes('driving') || m.includes('auto') || m.includes('taxi')) return '🚗';
    if (m.includes('bus') || m.includes('autobus')) return '🚌';
    if (m.includes('train') || m.includes('tren')) return '🚂';
    if (m.includes('plane') || m.includes('avion') || m.includes('flight')) return '✈️';
    if (m.includes('bic') || m.includes('cycl')) return '🚲';
    if (m.includes('run') || m.includes('corr')) return '🏃';
    return '🚶';
  }

  onDeleteSegment() {
    if (!this.anchorA || !this.anchorB) return;
    
    // Generar un ID único simple para tracking local
    const editId = Math.random().toString(36).substring(2, 9);
    
    this.pendingEdits.push({
      id: editId,
      type: 'delete_segment',
      description: `${this.pendingEdits.length + 1} - Eliminación tramo`,
      data: {
        startAnchor: this.anchorA,
        endAnchor: this.anchorB
      },
      isHidden: true
    });

    this.clearSelection();
    this.drawBaseAndEdits();
  }

  // Interacciones en el panel lateral de historial
  previewEdit(editId: string): void {
    this.previewingEditId = editId;
    this.drawBaseAndEdits();
    
    // Zoom al tramo afectado
    const edit = this.pendingEdits.find(e => e.id === editId);
    if (edit && this.map) {
      const startIdx = this.trackEditorService.resolveAnchor(edit.data.startAnchor, this.gpxPoints);
      const endIdx = this.trackEditorService.resolveAnchor(edit.data.endAnchor, this.gpxPoints);
      if (startIdx !== -1 && endIdx !== -1) {
        const p1 = this.gpxPoints[startIdx];
        const p2 = this.gpxPoints[endIdx];
        const bounds = L.latLngBounds([p1.lat, p1.lng], [p2.lat, p2.lng]);
        this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      }
    }
  }

  cancelPreview(): void {
    this.previewingEditId = null;
    this.drawBaseAndEdits();
  }

  revertEdit(editId: string): void {
    const edit = this.pendingEdits.find(e => e.id === editId);
    if (edit) {
      if (edit.type === 'append_segment') {
        const count = edit.data?.addedPointsCount || (edit.data?.points ? edit.data.points.length - 1 : 0);
        if (count > 0 && this.gpxPoints.length >= count) {
          this.gpxPoints.splice(this.gpxPoints.length - count, count);
        }
      } else if (edit.type === 'prepend_segment') {
        const count = edit.data?.addedPointsCount || (edit.data?.points ? edit.data.points.length - 1 : 0);
        if (count > 0 && this.gpxPoints.length >= count) {
          this.gpxPoints.splice(0, count);
        }
      }
    }

    this.pendingEdits = this.pendingEdits.filter(e => e.id !== editId);
    if (this.previewingEditId === editId) {
      this.previewingEditId = null;
    }
    this.clearSelection();
    this.actualizarTramosDisponibles();
    this.drawBaseAndEdits();
    if (this.mostrarTiempos) {
      this.updateTimeMarkers();
    }
    if (this.mostrarDistancias) {
      this.updateDistanceMarkers();
    }
  }

  emitSaveAllEdits(): void {
    this.saveAllEdits.emit(this.pendingEdits);
  }

  onOverrideMode() {
    if (!this.anchorA || !this.anchorB) return;

    const editId = Math.random().toString(36).substring(2, 9);
    const modeName = this.vehicleModes.find(v => v.id === this.selectedMode)?.name || this.selectedMode;

    this.pendingEdits.push({
      id: editId,
      type: 'override_mode',
      description: `${this.pendingEdits.length + 1} - Cambio a ${modeName}`,
      data: {
        startAnchor: this.anchorA,
        endAnchor: this.anchorB,
        newMode: this.selectedMode
      }
    });

    this.clearSelection();
    this.drawBaseAndEdits();
  }

  async onRecalculateRealRoute(): Promise<void> {
    if (!this.anchorA || !this.anchorB || !this.gpxPoints || this.gpxPoints.length === 0) return;

    let startIdx = this.trackEditorService.resolveAnchor(this.anchorA, this.gpxPoints);
    let endIdx = this.trackEditorService.resolveAnchor(this.anchorB, this.gpxPoints);

    if (startIdx === -1 && this.anchorA.index !== undefined && this.anchorA.index >= 0 && this.anchorA.index < this.gpxPoints.length) {
      startIdx = this.anchorA.index;
    }
    if (endIdx === -1 && this.anchorB.index !== undefined && this.anchorB.index >= 0 && this.anchorB.index < this.gpxPoints.length) {
      endIdx = this.anchorB.index;
    }

    if (startIdx === -1 || endIdx === -1) {
      console.warn('⚠️ [TrackEditor] No se pudieron resolver los puntos ancla seleccionados:', this.anchorA, this.anchorB);
      alert('No se pudieron resolver los puntos seleccionados en el recorrido.');
      return;
    }

    const min = Math.min(startIdx, endIdx);
    const max = Math.max(startIdx, endIdx);

    const ptStart = this.gpxPoints[min];
    const ptEnd = this.gpxPoints[max];

    // Extraer marcas de tiempo originales del tramo
    const timeA = ptStart.time ? (ptStart.time instanceof Date ? ptStart.time.getTime() : new Date(ptStart.time).getTime()) : (this.anchorA.time ? new Date(this.anchorA.time).getTime() : null);
    const timeB = ptEnd.time ? (ptEnd.time instanceof Date ? ptEnd.time.getTime() : new Date(ptEnd.time).getTime()) : (this.anchorB.time ? new Date(this.anchorB.time).getTime() : null);

    this.calculandoRutaReal = true;
    this.cdr.detectChanges();

    try {
      console.log(`🛣️ [TrackEditor] Calculando ruta real (${this.selectedMode}) entre [${ptStart.lat}, ${ptStart.lng}] y [${ptEnd.lat}, ${ptEnd.lng}]`);

      const routeResult = await this.routingService.getRoute(
        ptStart.lat, ptStart.lng,
        ptEnd.lat, ptEnd.lng,
        this.selectedMode
      );

      if (!routeResult || !routeResult.points || routeResult.points.length < 2) {
        throw new Error('No se pudo obtener un trazado válido para el modo seleccionado.');
      }

      console.log(`✅ [TrackEditor] Ruta real obtenida: ${routeResult.points.length} puntos, ${(routeResult.distanceMeters / 1000).toFixed(2)} km`);

      // Calcular distancias acumuladas a lo largo de la ruta calculada
      const distAcum: number[] = [0];
      let totalDist = 0;
      for (let i = 1; i < routeResult.points.length; i++) {
        const p1 = routeResult.points[i - 1];
        const p2 = routeResult.points[i];
        const d = this.trackEditorService.getDistance(p1.lat, p1.lng, p2.lat, p2.lng);
        totalDist += d;
        distAcum.push(totalDist);
      }

      // Interpolar marcas de tiempo manteniendo exactamente las horas de salida (timeA) y llegada (timeB)
      const newPointsWithTimes: GpxPoint[] = routeResult.points.map((p, idx) => {
        const fraction = totalDist > 0 ? (distAcum[idx] / totalDist) : (idx / (routeResult.points.length - 1));
        let pTime: Date | undefined = undefined;

        if (timeA !== null && timeB !== null && timeB >= timeA && !isNaN(timeA) && !isNaN(timeB)) {
          const interpolatedMs = Math.round(timeA + fraction * (timeB - timeA));
          pTime = new Date(interpolatedMs);
        } else if (timeA !== null && !isNaN(timeA)) {
          let speedKmh = 50;
          if (this.selectedMode === 'walking') speedKmh = 5;
          else if (this.selectedMode === 'cycling') speedKmh = 18;
          else if (this.selectedMode === 'boat') speedKmh = 25;
          else if (this.selectedMode === 'plane') speedKmh = 700;
          else if (this.selectedMode === 'train') speedKmh = 100;
          else speedKmh = 70; // driving / bus

          const speedMs = speedKmh / 3.6;
          const elapsedSec = distAcum[idx] / speedMs;
          pTime = new Date(timeA + Math.round(elapsedSec * 1000));
        }

        return {
          lat: p.lat,
          lng: p.lng,
          time: pTime,
          distAcum: distAcum[idx] || 0,
          timeAcum: pTime && timeA ? Math.max(0, Math.round((pTime.getTime() - timeA) / 1000)) : 0,
          mode: this.selectedMode,
          hfMode: this.selectedMode
        };
      });

      // Asegurar coincidencia exacta en los extremos con los puntos seleccionados
      newPointsWithTimes[0].lat = ptStart.lat;
      newPointsWithTimes[0].lng = ptStart.lng;
      if (ptStart.time) newPointsWithTimes[0].time = ptStart.time;

      newPointsWithTimes[newPointsWithTimes.length - 1].lat = ptEnd.lat;
      newPointsWithTimes[newPointsWithTimes.length - 1].lng = ptEnd.lng;
      if (ptEnd.time) newPointsWithTimes[newPointsWithTimes.length - 1].time = ptEnd.time;

      const editId = Math.random().toString(36).substring(2, 9);
      const modeName = this.vehicleModes.find(v => v.id === this.selectedMode)?.name || this.selectedMode;

      this.pendingEdits.push({
        id: editId,
        type: 'recalculate_route',
        description: `${this.pendingEdits.length + 1} - Ruta real ${modeName} (${(totalDist / 1000).toFixed(1)} km)`,
        data: {
          startAnchor: {
            lat: ptStart.lat,
            lng: ptStart.lng,
            time: ptStart.time instanceof Date ? ptStart.time.toISOString() : (ptStart.time || undefined),
            index: min
          },
          endAnchor: {
            lat: ptEnd.lat,
            lng: ptEnd.lng,
            time: ptEnd.time instanceof Date ? ptEnd.time.toISOString() : (ptEnd.time || undefined),
            index: max
          },
          mode: this.selectedMode,
          points: newPointsWithTimes
        }
      });

      this.clearSelection();
      this.drawBaseAndEdits();

    } catch (err: any) {
      console.error('❌ [TrackEditor] Error calculando ruta real:', err);
      alert('Error calculando la ruta real: ' + (err.message || err));
    } finally {
      this.calculandoRutaReal = false;
      this.cdr.detectChanges();
    }
  }

  onAssignTimestamps(mode: 'auto' | 'manual'): void {
    if (!this.anchorA || !this.anchorB || !this.gpxPoints || this.gpxPoints.length === 0) return;

    let startIdx = this.trackEditorService.resolveAnchor(this.anchorA, this.gpxPoints);
    let endIdx = this.trackEditorService.resolveAnchor(this.anchorB, this.gpxPoints);

    if (startIdx === -1 && this.anchorA.index !== undefined && this.anchorA.index >= 0 && this.anchorA.index < this.gpxPoints.length) {
      startIdx = this.anchorA.index;
    }
    if (endIdx === -1 && this.anchorB.index !== undefined && this.anchorB.index >= 0 && this.anchorB.index < this.gpxPoints.length) {
      endIdx = this.anchorB.index;
    }

    if (startIdx === -1 || endIdx === -1) {
      console.warn('⚠️ [TrackEditor] No se pudieron resolver los puntos ancla seleccionados:', this.anchorA, this.anchorB);
      return;
    }

    const min = Math.min(startIdx, endIdx);
    const max = Math.max(startIdx, endIdx);

    // Clonar y densificar los puntos del tramo A-B (crea puntos intermedios cada ~300m si es una línea larga en el mar)
    let rawSegment = this.gpxPoints.slice(min, max + 1).map(p => ({ ...p }));
    let targetSegment = this.trackEditorService.densifyPoints(rawSegment, 300);

    if (mode === 'auto') {
      // 1. Intentar calibrar con fotos del viaje
      let calibratedWithPhotos = false;
      if (this.archivosMedia && this.archivosMedia.length > 0) {
        const prevTimes = targetSegment.map(p => p.time ? new Date(p.time as any).getTime() : NaN);
        this.trackEditorService.calibratePointsWithMedia(targetSegment, this.archivosMedia);
        const newTimes = targetSegment.map(p => p.time ? new Date(p.time as any).getTime() : NaN);
        calibratedWithPhotos = newTimes.some((t, i) => !isNaN(t) && t !== prevTimes[i]);
      }

      // 2. Si no se calibró con fotos (o no había fotos en el tramo), calcular por velocidad del medio de transporte
      if (!calibratedWithPhotos) {
        // Obtener la hora inicial: primero probar el propio primer punto del tramo o su ancla
        let startTimeMs: number | null = null;
        const ptStart = targetSegment[0] || this.gpxPoints[min];
        if (ptStart?.time) {
          const tMs = ptStart.time instanceof Date ? ptStart.time.getTime() : new Date(ptStart.time as any).getTime();
          if (!isNaN(tMs)) {
            startTimeMs = tMs;
          }
        }

        // Si no hay hora en el punto 0, buscar hacia atrás el último punto con hora
        if (!startTimeMs) {
          for (let i = min - 1; i >= 0; i--) {
            const t = this.gpxPoints[i]?.time;
            if (t) {
              const tMs = t instanceof Date ? t.getTime() : new Date(t).getTime();
              if (!isNaN(tMs)) {
                let extraDist = 0;
                let pPrev = this.gpxPoints[i];
                for (let j = i + 1; j <= min; j++) {
                  extraDist += this.trackEditorService.getDistance(pPrev.lat, pPrev.lng, this.gpxPoints[j].lat, this.gpxPoints[j].lng);
                  pPrev = this.gpxPoints[j];
                }
                const speedMps = this.trackEditorService.getModeSpeedMps(this.gpxPoints[i].mode || this.gpxPoints[i].hfMode || targetSegment[0]?.mode);
                startTimeMs = tMs + (extraDist / speedMps) * 1000;
                break;
              }
            }
          }
        }

        // Fallback a archivosMedia o Date.now()
        if (!startTimeMs && this.archivosMedia && this.archivosMedia.length > 0) {
          for (const a of this.archivosMedia) {
            const raw = a.timestampReal || a.horaCaptura || a.fechaCreacion || a.fecha;
            const parsed = (this.trackEditorService as any)['parseFlexibleDate']?.(raw, a.nombreArchivo);
            if (parsed) {
              startTimeMs = parsed;
              break;
            }
          }
        }

        if (!startTimeMs) {
          startTimeMs = Date.now();
        }

        const baseMode = targetSegment[0]?.mode || targetSegment[0]?.hfMode || (this.gpxPoints[min]?.mode) || 'walking';
        const speedMps = this.trackEditorService.getModeSpeedMps(baseMode);

        targetSegment[0].time = new Date(startTimeMs);
        let prevPt = targetSegment[0];

        for (let i = 1; i < targetSegment.length; i++) {
          const curr = targetSegment[i];
          const dist = this.trackEditorService.getDistance(prevPt.lat, prevPt.lng, curr.lat, curr.lng);
          const dtSec = Math.max(1, dist / speedMps);
          const prevTimeMs = prevPt.time ? (prevPt.time instanceof Date ? prevPt.time.getTime() : new Date(prevPt.time as any).getTime()) : startTimeMs;
          curr.time = new Date(prevTimeMs + dtSec * 1000);
          prevPt = curr;
        }
      }
    } else {
      // Modo manual por fecha y rango HH:mm:ss
      const startMs = this.obtenerTimestampManual(this.customStartDate, this.customStartTime);
      const endMs = this.obtenerTimestampManual(this.customEndDate, this.customEndTime);

      if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
        alert('⚠️ La fecha/hora de fin debe ser posterior a la fecha/hora de inicio.');
        return;
      }

      this.trackEditorService.ensureAccumulators(targetSegment);
      const totalDist = targetSegment[targetSegment.length - 1]?.distAcum || 1;

      let currentDist = 0;
      targetSegment.forEach((pt, idx) => {
        if (idx === 0) {
          pt.time = new Date(startMs);
        } else if (idx === targetSegment.length - 1) {
          pt.time = new Date(endMs);
        } else {
          const d = this.trackEditorService.getDistance(targetSegment[idx - 1].lat, targetSegment[idx - 1].lng, pt.lat, pt.lng);
          currentDist += d;
          const ratio = totalDist > 0 ? Math.min(1, currentDist / totalDist) : (idx / (targetSegment.length - 1));
          pt.time = new Date(startMs + (endMs - startMs) * ratio);
        }
      });
    }

    // Inyectar los puntos densificados y con tiempos directamente en this.gpxPoints
    this.gpxPoints.splice(min, (max - min) + 1, ...targetSegment);

    // Sincronizar los puntos de cualquier append_segment pendiente que coincida con este tramo
    const appends = this.pendingEdits.filter(e => e.type === 'append_segment');
    appends.forEach(appEdit => {
      if (appEdit.data?.points && appEdit.data.points.length > 0) {
        const appPts = appEdit.data.points;
        const lastAppPt = appPts[appPts.length - 1];
        const lastGpxPt = this.gpxPoints[this.gpxPoints.length - 1];
        if (lastGpxPt && lastAppPt && Math.abs(lastGpxPt.lat - lastAppPt.lat) < 0.0001 && Math.abs(lastGpxPt.lng - lastAppPt.lng) < 0.0001) {
          const count = appEdit.data.addedPointsCount || (appPts.length - 1);
          const startSlice = Math.max(0, this.gpxPoints.length - count - 1);
          appEdit.data.points = this.gpxPoints.slice(startSlice).map(p => ({ ...p }));
        }
      }
    });

    const editId = Math.random().toString(36).substring(2, 9);
    const descTime = mode === 'manual'
      ? `Horario (${this.customStartTime} - ${this.customEndTime})`
      : `Sincro Tiempos (${targetSegment[0]?.mode || 'Auto'})`;

    this.pendingEdits.push({
      id: editId,
      type: 'assign_timestamps',
      description: `${this.pendingEdits.length + 1} - ${descTime}`,
      data: {
        startAnchor: this.anchorA,
        endAnchor: this.anchorB,
        points: targetSegment
      }
    });

    this.showCustomTimeInputs = false;
    this.mostrarTiempos = true;
    this.clearSelection();
    this.actualizarTramosDisponibles();
    this.drawBaseAndEdits();
    this.updateTimeMarkers();
  }

  public initCustomTimeFields(): void {
    if (!this.anchorA || !this.anchorB || !this.gpxPoints) return;

    const startIdx = this.anchorA.index ?? this.trackEditorService.resolveAnchor(this.anchorA, this.gpxPoints);
    const endIdx = this.anchorB.index ?? this.trackEditorService.resolveAnchor(this.anchorB, this.gpxPoints);

    if (startIdx === -1 || endIdx === -1) return;

    const min = Math.min(startIdx, endIdx);
    const max = Math.max(startIdx, endIdx);

    const ptA = this.gpxPoints[min];
    const ptB = this.gpxPoints[max];

    const todayStr = new Date().toISOString().split('T')[0];

    if (ptA?.time) {
      const dtA = new Date(ptA.time as any);
      if (!isNaN(dtA.getTime())) {
        this.customStartDate = dtA.toISOString().split('T')[0];
        const hh = dtA.getHours().toString().padStart(2, '0');
        const mm = dtA.getMinutes().toString().padStart(2, '0');
        const ss = dtA.getSeconds().toString().padStart(2, '0');
        this.customStartTime = `${hh}:${mm}:${ss}`;
      }
    }
    if (!this.customStartDate) {
      this.customStartDate = todayStr;
    }

    if (ptB?.time) {
      const dtB = new Date(ptB.time as any);
      if (!isNaN(dtB.getTime())) {
        this.customEndDate = dtB.toISOString().split('T')[0];
        const hh = dtB.getHours().toString().padStart(2, '0');
        const mm = dtB.getMinutes().toString().padStart(2, '0');
        const ss = dtB.getSeconds().toString().padStart(2, '0');
        this.customEndTime = `${hh}:${mm}:${ss}`;
      }
    }
    if (!this.customEndDate) {
      this.customEndDate = this.customStartDate;
    }
  }

  public getDuracionManualTexto(): string {
    const startMs = this.obtenerTimestampManual(this.customStartDate, this.customStartTime);
    const endMs = this.obtenerTimestampManual(this.customEndDate, this.customEndTime);

    if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
      return 'Hora fin debe ser posterior a inicio';
    }

    const diffSeg = Math.floor((endMs - startMs) / 1000);
    const h = Math.floor(diffSeg / 3600);
    const m = Math.floor((diffSeg % 3600) / 60);
    const s = diffSeg % 60;

    if (h > 0) {
      return `${h}h ${m}m ${s > 0 ? s + 's' : ''}`;
    }
    return `${m}m ${s}s`;
  }

  public obtenerTimestampManual(fechaStr: string, horaStr: string): number {
    if (!fechaStr || !horaStr) return NaN;
    const partesHora = horaStr.split(':');
    const hh = (partesHora[0] || '00').padStart(2, '0');
    const mm = (partesHora[1] || '00').padStart(2, '0');
    const ss = (partesHora[2] || '00').padStart(2, '0');
    const isoString = `${fechaStr}T${hh}:${mm}:${ss}`;
    return new Date(isoString).getTime();
  }

  // ====================================================================
  // 📏 HERRAMIENTAS DE EDICIÓN Y ASIGNACIÓN DE DISTANCIA (KM / METROS)
  // ====================================================================

  toggleCustomDistInputs(): void {
    this.showCustomDistInputs = !this.showCustomDistInputs;
    if (this.showCustomDistInputs) {
      this.initCustomDistFields();
    }
  }

  public initCustomDistFields(): void {
    if (!this.anchorA || !this.anchorB || !this.gpxPoints) return;

    let startIdx = this.anchorA.index ?? this.trackEditorService.resolveAnchor(this.anchorA, this.gpxPoints);
    let endIdx = this.anchorB.index ?? this.trackEditorService.resolveAnchor(this.anchorB, this.gpxPoints);

    if (startIdx === -1 && this.anchorA.index !== undefined && this.anchorA.index >= 0) startIdx = this.anchorA.index;
    if (endIdx === -1 && this.anchorB.index !== undefined && this.anchorB.index >= 0) endIdx = this.anchorB.index;

    if (startIdx === -1 || endIdx === -1) return;

    const min = Math.min(startIdx, endIdx);
    const max = Math.max(startIdx, endIdx);

    let totalDistMetros = 0;
    for (let i = min; i < max; i++) {
      totalDistMetros += this.trackEditorService.getDistance(
        this.gpxPoints[i].lat, this.gpxPoints[i].lng,
        this.gpxPoints[i + 1].lat, this.gpxPoints[i + 1].lng
      );
    }

    this.currentSegmentDistMeters = totalDistMetros;

    // Si ya había una distancia personalizada en pendingEdits para este tramo, inicializar con ella
    const distEdit = this.pendingEdits.find(e => e.type === 'assign_distance' && e.data?.distMeters !== undefined &&
      ((e.data.startAnchor?.index === min && e.data.endAnchor?.index === max) ||
       (e.data.startAnchor?.index === max && e.data.endAnchor?.index === min)));

    const distToUse = (distEdit && distEdit.data?.distMeters) ? distEdit.data.distMeters : totalDistMetros;

    if (distToUse >= 1000) {
      this.customDistValue = parseFloat((distToUse / 1000).toFixed(2));
      this.customDistUnit = 'km';
    } else {
      this.customDistValue = Math.round(distToUse);
      this.customDistUnit = 'm';
    }
  }

  public getTramoDistanciaActualTexto(): string {
    if (!this.anchorA || !this.anchorB || !this.gpxPoints) return '0 m';
    let startIdx = this.anchorA.index ?? this.trackEditorService.resolveAnchor(this.anchorA, this.gpxPoints);
    let endIdx = this.anchorB.index ?? this.trackEditorService.resolveAnchor(this.anchorB, this.gpxPoints);
    if (startIdx === -1 && this.anchorA.index !== undefined && this.anchorA.index >= 0) startIdx = this.anchorA.index;
    if (endIdx === -1 && this.anchorB.index !== undefined && this.anchorB.index >= 0) endIdx = this.anchorB.index;
    if (startIdx === -1 || endIdx === -1) return '0 m';

    const min = Math.min(startIdx, endIdx);
    const max = Math.max(startIdx, endIdx);

    let d = 0;
    for (let i = min; i < max; i++) {
      d += this.trackEditorService.getDistance(
        this.gpxPoints[i].lat, this.gpxPoints[i].lng,
        this.gpxPoints[i + 1].lat, this.gpxPoints[i + 1].lng
      );
    }
    return d >= 1000 ? `${(d / 1000).toFixed(2)} km (${Math.round(d)} m)` : `${Math.round(d)} m`;
  }

  public getCustomDistPreviewTexto(): string {
    const val = Number(this.customDistValue);
    if (isNaN(val) || val <= 0) return '0 m';
    if (this.customDistUnit === 'km') {
      const m = Math.round(val * 1000);
      return `${val.toFixed(2)} km (${m} m)`;
    } else {
      const km = (val / 1000).toFixed(2);
      return `${Math.round(val)} m (${km} km)`;
    }
  }

  public onCustomDistChange(): void {
    // Método para refrescar el binding de la vista
  }

  public getVelocidadResultanteTexto(): string {
    if (!this.anchorA || !this.anchorB || !this.gpxPoints) return 'N/A';
    let startIdx = this.anchorA.index ?? this.trackEditorService.resolveAnchor(this.anchorA, this.gpxPoints);
    let endIdx = this.anchorB.index ?? this.trackEditorService.resolveAnchor(this.anchorB, this.gpxPoints);
    if (startIdx === -1 && this.anchorA.index !== undefined && this.anchorA.index >= 0) startIdx = this.anchorA.index;
    if (endIdx === -1 && this.anchorB.index !== undefined && this.anchorB.index >= 0) endIdx = this.anchorB.index;
    if (startIdx === -1 || endIdx === -1) return 'N/A';

    const min = Math.min(startIdx, endIdx);
    const max = Math.max(startIdx, endIdx);

    const ptA = this.gpxPoints[min];
    const ptB = this.gpxPoints[max];

    if (!ptA?.time || !ptB?.time) return 'N/A (sin horas)';

    const tA = new Date(ptA.time as any).getTime();
    const tB = new Date(ptB.time as any).getTime();
    const durSec = Math.abs(tB - tA) / 1000;

    if (durSec <= 0) return 'N/A';

    const desiredMeters = this.customDistUnit === 'km' ? (this.customDistValue * 1000) : this.customDistValue;
    if (!desiredMeters || desiredMeters <= 0) return 'N/A';

    const speedKmh = (desiredMeters / 1000) / (durSec / 3600);
    return `${speedKmh.toFixed(1)} km/h`;
  }

  public getHoraLlegadaRecalculadaTexto(): string {
    if (!this.anchorA || !this.anchorB || !this.gpxPoints) return 'N/A';
    let startIdx = this.anchorA.index ?? this.trackEditorService.resolveAnchor(this.anchorA, this.gpxPoints);
    let endIdx = this.anchorB.index ?? this.trackEditorService.resolveAnchor(this.anchorB, this.gpxPoints);
    if (startIdx === -1 && this.anchorA.index !== undefined && this.anchorA.index >= 0) startIdx = this.anchorA.index;
    if (endIdx === -1 && this.anchorB.index !== undefined && this.anchorB.index >= 0) endIdx = this.anchorB.index;
    if (startIdx === -1 || endIdx === -1) return 'N/A';

    const min = Math.min(startIdx, endIdx);
    const ptA = this.gpxPoints[min];
    if (!ptA?.time) return 'N/A (sin hora de salida)';

    const startMs = new Date(ptA.time as any).getTime();
    if (isNaN(startMs)) return 'N/A';

    const desiredMeters = this.customDistUnit === 'km' ? (this.customDistValue * 1000) : this.customDistValue;
    if (!desiredMeters || desiredMeters <= 0) return 'N/A';

    const mode = this.selectedMode || this.gpxPoints[min]?.mode || 'walking';
    const speedMps = this.trackEditorService.getModeSpeedMps(mode);
    const durSec = Math.max(1, desiredMeters / speedMps);
    const endMs = startMs + (durSec * 1000);

    const dtEnd = new Date(endMs);
    return dtEnd.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  public onAssignDistance(mode: 'auto' | 'manual' = 'auto'): void {
    if (!this.anchorA || !this.anchorB || !this.gpxPoints || this.gpxPoints.length === 0) return;

    let startIdx = this.anchorA.index ?? this.trackEditorService.resolveAnchor(this.anchorA, this.gpxPoints);
    let endIdx = this.anchorB.index ?? this.trackEditorService.resolveAnchor(this.anchorB, this.gpxPoints);

    if (startIdx === -1 && this.anchorA.index !== undefined && this.anchorA.index >= 0 && this.anchorA.index < this.gpxPoints.length) {
      startIdx = this.anchorA.index;
    }
    if (endIdx === -1 && this.anchorB.index !== undefined && this.anchorB.index >= 0 && this.anchorB.index < this.gpxPoints.length) {
      endIdx = this.anchorB.index;
    }

    if (startIdx === -1 || endIdx === -1) {
      console.warn('⚠️ [TrackEditor] No se pudieron resolver los puntos ancla para distancia:', this.anchorA, this.anchorB);
      return;
    }

    const min = Math.min(startIdx, endIdx);
    const max = Math.max(startIdx, endIdx);

    // Calcular distancia GPS acumulada real del tramo punto a punto
    let realDistMeters = 0;
    const partialDistances: number[] = [0];
    for (let i = min; i < max; i++) {
      const d = this.trackEditorService.getDistance(
        this.gpxPoints[i].lat, this.gpxPoints[i].lng,
        this.gpxPoints[i + 1].lat, this.gpxPoints[i + 1].lng
      );
      realDistMeters += d;
      partialDistances.push(realDistMeters);
    }

    let targetDistMeters = realDistMeters;

    if (mode === 'manual') {
      const inputVal = Number(this.customDistValue);
      if (isNaN(inputVal) || inputVal <= 0) {
        alert('⚠️ Por favor introduce una distancia válida mayor que 0.');
        return;
      }
      targetDistMeters = this.customDistUnit === 'km' ? inputVal * 1000 : inputVal;

      // Si se seleccionó "update_time", recalcular los timestamps en base a la velocidad del medio de transporte
      if (this.customDistTimeSyncMode === 'update_time') {
        const ptStart = this.gpxPoints[min];
        let startMs = ptStart?.time ? new Date(ptStart.time as any).getTime() : NaN;
        if (isNaN(startMs)) {
          startMs = Date.now();
          ptStart.time = new Date(startMs);
        }

        const modeVehicle = this.selectedMode || ptStart.mode || 'walking';
        const speedMps = this.trackEditorService.getModeSpeedMps(modeVehicle);
        const newDurationSec = Math.max(1, targetDistMeters / speedMps);
        const endMs = startMs + (newDurationSec * 1000);

        for (let i = min; i <= max; i++) {
          const ratio = realDistMeters > 0 ? partialDistances[i - min] / realDistMeters : (i - min) / (max - min || 1);
          this.gpxPoints[i].time = new Date(startMs + (endMs - startMs) * ratio);
        }
      } else {
        // "keep_time": Si hay hora de inicio y fin, redistribuir los puntos intermedios según la nueva distancia
        const ptA = this.gpxPoints[min];
        const ptB = this.gpxPoints[max];
        if (ptA?.time && ptB?.time) {
          const tA = new Date(ptA.time as any).getTime();
          const tB = new Date(ptB.time as any).getTime();
          if (!isNaN(tA) && !isNaN(tB) && tB > tA) {
            for (let i = min; i <= max; i++) {
              const ratio = realDistMeters > 0 ? partialDistances[i - min] / realDistMeters : (i - min) / (max - min || 1);
              this.gpxPoints[i].time = new Date(tA + (tB - tA) * ratio);
            }
          }
        }
      }
    }

    // Actualizar distAcum en this.gpxPoints
    const startDistAcum = min > 0 ? (this.gpxPoints[min - 1].distAcum || 0) : 0;
    for (let i = min; i <= max; i++) {
      const ratio = realDistMeters > 0 ? partialDistances[i - min] / realDistMeters : (i - min) / (max - min || 1);
      this.gpxPoints[i].distAcum = startDistAcum + (ratio * targetDistMeters);
    }

    // Propagar distAcum a los puntos posteriores en this.gpxPoints
    let curDist = this.gpxPoints[max].distAcum;
    for (let i = max + 1; i < this.gpxPoints.length; i++) {
      const stepD = this.trackEditorService.getDistance(
        this.gpxPoints[i - 1].lat, this.gpxPoints[i - 1].lng,
        this.gpxPoints[i].lat, this.gpxPoints[i].lng
      );
      curDist += stepD;
      this.gpxPoints[i].distAcum = curDist;
    }

    // Sincronizar con cualquier append_segment pendiente
    const appends = this.pendingEdits.filter(e => e.type === 'append_segment');
    appends.forEach(appEdit => {
      if (appEdit.data?.points && appEdit.data.points.length > 0) {
        const appPts = appEdit.data.points;
        const lastAppPt = appPts[appPts.length - 1];
        const lastGpxPt = this.gpxPoints[this.gpxPoints.length - 1];
        if (lastGpxPt && lastAppPt && Math.abs(lastGpxPt.lat - lastAppPt.lat) < 0.0001 && Math.abs(lastGpxPt.lng - lastAppPt.lng) < 0.0001) {
          const count = appEdit.data.addedPointsCount || (appPts.length - 1);
          const startSlice = Math.max(0, this.gpxPoints.length - count - 1);
          appEdit.data.points = this.gpxPoints.slice(startSlice).map(p => ({ ...p }));
        }
      }
    });

    const editId = Math.random().toString(36).substring(2, 9);
    const distLabel = targetDistMeters >= 1000 ? `${(targetDistMeters / 1000).toFixed(2)} km` : `${Math.round(targetDistMeters)} m`;
    const desc = mode === 'manual'
      ? `Distancia manual (${distLabel})`
      : `Distancia GPS real (${distLabel})`;

    this.pendingEdits.push({
      id: editId,
      type: 'assign_distance',
      description: `${this.pendingEdits.length + 1} - ${desc}`,
      data: {
        startAnchor: this.anchorA,
        endAnchor: this.anchorB,
        distMeters: targetDistMeters,
        points: this.gpxPoints.slice(min, max + 1).map(p => ({ ...p }))
      }
    });

    this.showCustomDistInputs = false;
    this.mostrarDistancias = true;
    this.clearSelection();
    this.actualizarTramosDisponibles();
    this.drawBaseAndEdits();
    this.updateDistanceMarkers();
    if (this.mostrarTiempos) {
      this.updateTimeMarkers();
    }
  }

  // --- MODO GEOMETRÍA SINTÉTICA ---

  startReplaceGeometry() {
    if (!this.anchorA || !this.anchorB || !this.map) return;
    this.editorState = 'EDITING_GEOMETRY';

    // Ocultar la línea de selección (resalte original)
    if (this.highlightPolyline) {
      this.highlightPolyline.setStyle({ color: '#9ca3af', dashArray: '5, 10', opacity: 0.5 });
    }

    // Inicializar la línea sintética uniendo A y B directamente
    const ptA = L.latLng(this.anchorA.lat, this.anchorA.lng);
    const ptB = L.latLng(this.anchorB.lat, this.anchorB.lng);

    this.syntheticLine = L.polyline([ptA, ptB], {
      color: '#ec4899', // Fucsia brillante (Pink-500)
      weight: 5,
      dashArray: '10, 10'
    }).addTo(this.map);
  }

  private addSyntheticVertex(latlng: L.LatLng) {
    if (!this.map || !this.syntheticLine) return;

    // Crear un marcador draggable para el vértice intermedio
    const marker = L.marker(latlng, { 
      draggable: true,
      icon: L.divIcon({
        className: 'synthetic-vertex-icon',
        html: '<div style="width: 12px; height: 12px; background: #ec4899; border: 2px solid white; border-radius: 50%;"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      })
    }).addTo(this.map);

    // Actualizar la línea al arrastrar
    marker.on('drag', () => this.updateSyntheticLine());
    
    // Click derecho para eliminar vértice
    marker.on('contextmenu', () => this.removeSyntheticVertex(marker));

    this.syntheticVertices.push(marker);
    this.updateSyntheticLine();
  }

  private removeSyntheticVertex(marker: L.Marker) {
    if (!this.map) return;
    marker.remove();
    this.syntheticVertices = this.syntheticVertices.filter((m: L.Marker) => m !== marker);
    this.updateSyntheticLine();
  }

  private updateSyntheticLine() {
    if (!this.syntheticLine || !this.anchorA || !this.anchorB) return;
    
    const ptA = L.latLng(this.anchorA.lat, this.anchorA.lng);
    const ptB = L.latLng(this.anchorB.lat, this.anchorB.lng);
    
    const intermediateLatLngs = this.syntheticVertices.map((m: L.Marker) => m.getLatLng());
    this.syntheticLine.setLatLngs([ptA, ...intermediateLatLngs, ptB]);
  }

  saveGeometry() {
    if (!this.anchorA || !this.anchorB) return;

    const manualPoints = this.syntheticVertices.map((m: L.Marker) => ({
      lat: m.getLatLng().lat,
      lng: m.getLatLng().lng
    }));

    const pointsToInsert = [
      { lat: this.anchorA.lat, lng: this.anchorA.lng, time: (this.anchorA as any).time?.toISOString?.() || (this.anchorA as any).time },
      ...manualPoints,
      { lat: this.anchorB.lat, lng: this.anchorB.lng, time: (this.anchorB as any).time?.toISOString?.() || (this.anchorB as any).time }
    ];

    this.insertRequest.emit({ points: pointsToInsert });

    this.cleanupGeometryMode();
  }

  cancelGeometry() {
    this.cleanupGeometryMode();
    // Restaurar el color del highlight
    if (this.highlightPolyline) {
      this.highlightPolyline.setStyle({ color: '#f59e0b', dashArray: '', opacity: 1 });
    }
  }

  private cleanupGeometryMode() {
    this.editorState = 'SELECTING';
    if (this.syntheticLine) {
      this.syntheticLine.remove();
      this.syntheticLine = null;
    }
    this.syntheticVertices.forEach((m: L.Marker) => m.remove());
    this.syntheticVertices = [];
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // MODO INSERT (Fase 2.1.b)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  insertAnchorA: TrackAnchor | null = null;
  insertAnchorB: TrackAnchor | null = null;
  private insertMarkerA: L.CircleMarker | null = null;
  private insertMarkerB: L.CircleMarker | null = null;
  private insertLine: L.Polyline | null = null;
  private insertVertices: L.Marker[] = [];
  insertPoints: { lat: number; lng: number }[] = [];

  startGetLocationMode() {
    this.editorState = 'GET_LOCATION';
  }

  startInsertMode() {
    if (!this.map || this.gpxPoints.length === 0) return;
    this.clearSelection();
    this.cleanupAppendMode();
    this.cleanupGeometryMode();
    this.cleanupInsertMode();
    this.activeFlow = 'INSERT';
    this.editorState = 'SELECTING_A';
  }

  cancelInsertMode() {
    this.cleanupInsertMode();
    this.editorState = 'SELECTING';
  }

  private cleanupInsertMode() {
    this.insertAnchorA = null;
    this.insertAnchorB = null;
    if (this.insertMarkerA) { this.insertMarkerA.remove(); this.insertMarkerA = null; }
    if (this.insertMarkerB) { this.insertMarkerB.remove(); this.insertMarkerB = null; }
    if (this.insertLine) { this.insertLine.remove(); this.insertLine = null; }
    this.insertVertices.forEach(m => m.remove());
    this.insertVertices = [];
    this.insertPoints = [];
    
    // Limpiar estado de routing asistido
    this.clearRoutePreview();
    this.routingResult = null;
    this.routingError = null;
    this.activeFlow = null;

    if (this.polylinesGroup) {
      this.polylinesGroup.setStyle({ opacity: 1 });
    }
  }

  private setInsertAnchorA(index: number) {
    if (!this.map) return;
    const p = this.gpxPoints[index];
    this.insertAnchorA = { index, time: p.time ? new Date(p.time).toISOString() : undefined, lat: p.lat, lng: p.lng };
    
    this.insertMarkerA = L.circleMarker([p.lat, p.lng], {
      color: 'white', fillColor: '#22c55e', fillOpacity: 1, radius: 8, weight: 2
    }).addTo(this.map).bindTooltip('Inicio Insert (A)', { permanent: true, direction: 'right' }).openTooltip();

    this.editorState = 'SELECTING_B';
  }

  private setInsertAnchorB(index: number) {
    if (!this.map || !this.insertAnchorA) return;
    
    if (index <= this.insertAnchorA.index!) {
      console.warn('El ancla B debe ser posterior al ancla A.');
      return; 
    }

    const p = this.gpxPoints[index];
    this.insertAnchorB = { index, time: p.time ? new Date(p.time).toISOString() : undefined, lat: p.lat, lng: p.lng };
    
    this.insertMarkerB = L.circleMarker([p.lat, p.lng], {
      color: 'white', fillColor: '#ef4444', fillOpacity: 1, radius: 8, weight: 2
    }).addTo(this.map).bindTooltip('Fin Insert (B)', { permanent: true, direction: 'right' }).openTooltip();

    this.editorState = 'SELECTING_MODE';
  }

  private setInsertAnchorBVirtual(latlng: L.LatLng) {
    if (!this.map || !this.insertAnchorA) return;
    
    // Asignar punto arbitrario seleccionado por el usuario para prolongación
    this.insertAnchorB = { index: -1, time: undefined, lat: latlng.lat, lng: latlng.lng };
    
    this.insertMarkerB = L.circleMarker([latlng.lat, latlng.lng], {
      color: 'white', fillColor: '#ef4444', fillOpacity: 1, radius: 8, weight: 2
    }).addTo(this.map).bindTooltip('Fin Prolongación (B)', { permanent: true, direction: 'right' }).openTooltip();

    this.editorState = 'SELECTING_MODE';
  }

  private setInsertAnchorAVirtual(latlng: L.LatLng) {
    if (!this.map || !this.insertAnchorB) return;
    
    // Asignar punto arbitrario seleccionado por el usuario para el nuevo origen (Prepend)
    this.insertAnchorA = { index: -1, time: undefined, lat: latlng.lat, lng: latlng.lng };
    
    this.insertMarkerA = L.circleMarker([latlng.lat, latlng.lng], {
      color: 'white', fillColor: '#22c55e', fillOpacity: 1, radius: 8, weight: 2
    }).addTo(this.map).bindTooltip('Nuevo Origen (A)', { permanent: true, direction: 'right' }).openTooltip();

    this.editorState = 'SELECTING_MODE';
  }

  private transitionToDrawingInsert() {
    if (!this.map || !this.insertAnchorA || !this.insertAnchorB) return;
    
    this.editorState = 'DRAWING_INSERT';

    if (this.polylinesGroup) {
      // Atenuamos temporalmente las líneas base para enfocar en el tramo insertado
      this.polylinesGroup.setStyle({ opacity: 0.3 });
    }

    const ptA = L.latLng(this.insertAnchorA.lat, this.insertAnchorA.lng);
    const ptB = L.latLng(this.insertAnchorB.lat, this.insertAnchorB.lng);

    this.insertLine = L.polyline([ptA, ptB], {
      color: '#8b5cf6', // Violeta
      weight: 5,
      dashArray: '10, 10'
    }).addTo(this.map);
  }

  private addInsertVertex(latlng: L.LatLng) {
    if (!this.map || !this.insertLine) return;

    this.insertPoints.push({ lat: latlng.lat, lng: latlng.lng });

    const marker = L.marker(latlng, {
      draggable: true,
      icon: L.divIcon({
        className: 'insert-vertex-icon',
        html: '<div style="width: 12px; height: 12px; background: #8b5cf6; border: 2px solid white; border-radius: 50%;"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      })
    }).addTo(this.map);

    marker.on('drag', () => this.updateInsertLine());
    marker.on('contextmenu', () => this.removeInsertVertex(marker));

    this.insertVertices.push(marker);
    this.updateInsertLine();
  }

  private removeInsertVertex(marker: L.Marker) {
    if (!this.map) return;
    const idx = this.insertVertices.indexOf(marker);
    if (idx !== -1) {
      this.insertVertices.splice(idx, 1);
      this.insertPoints.splice(idx, 1);
    }
    marker.remove();
    this.updateInsertLine();
  }

  private updateInsertLine() {
    if (!this.insertLine || !this.insertAnchorA || !this.insertAnchorB) return;
    const ptA = L.latLng(this.insertAnchorA.lat, this.insertAnchorA.lng);
    const ptB = L.latLng(this.insertAnchorB.lat, this.insertAnchorB.lng);
    const intermediateLatLngs = this.insertVertices.map(m => m.getLatLng());
    this.insertLine.setLatLngs([ptA, ...intermediateLatLngs, ptB]);
  }

  saveInsert(mode?: string) {
    if (!this.insertAnchorA || !this.insertAnchorB) return;
    if (this.editorState === 'DRAWING_INSERT' && this.insertPoints.length === 0) return;

    const appliedMode = mode || this.selectedMode;

    let fullPointsArray: any[] = [
      { lat: this.insertAnchorA.lat, lng: this.insertAnchorA.lng, time: this.insertAnchorA.time, mode: appliedMode, distAcum: 0, timeAcum: 0 },
      ...this.insertPoints.map(p => ({ ...p, mode: appliedMode, distAcum: 0, timeAcum: 0 })),
      { lat: this.insertAnchorB.lat, lng: this.insertAnchorB.lng, time: this.insertAnchorB.time, mode: appliedMode, distAcum: 0, timeAcum: 0 }
    ];

    // Densificar automáticamente tramos largos (ej. en el mar o vuelos) para tener puntos cada ~300m
    fullPointsArray = this.trackEditorService.densifyPoints(fullPointsArray, 300);

    if (this.activeFlow === 'APPEND') {
      // 1. Obtener timestamp de inicio válido
      let startMs = this.insertAnchorA.time ? new Date(this.insertAnchorA.time).getTime() : NaN;
      if (isNaN(startMs)) {
        for (let i = this.gpxPoints.length - 1; i >= 0; i--) {
          const t = this.gpxPoints[i]?.time;
          if (t) {
            const dt = t instanceof Date ? t : new Date(t);
            if (!isNaN(dt.getTime())) {
              startMs = dt.getTime();
              break;
            }
          }
        }
      }
      if (isNaN(startMs) && this.archivosMedia && this.archivosMedia.length > 0) {
        for (const a of this.archivosMedia) {
          const raw = a.timestampReal || a.horaCaptura || a.fechaCreacion || a.fecha;
          const parsed = (this.trackEditorService as any)['parseFlexibleDate']?.(raw, a.nombreArchivo);
          if (parsed) {
            startMs = parsed;
            break;
          }
        }
      }
      if (isNaN(startMs)) {
        startMs = Date.now();
      }

      const speedMps = this.trackEditorService.getModeSpeedMps(appliedMode);
      let totalDistMetros = 0;
      for (let i = 0; i < fullPointsArray.length - 1; i++) {
        totalDistMetros += this.trackEditorService.getDistance(
          fullPointsArray[i].lat, fullPointsArray[i].lng,
          fullPointsArray[i + 1].lat, fullPointsArray[i + 1].lng
        );
      }
      const duracionSeg = Math.max(1, totalDistMetros / speedMps);
      const endMs = startMs + (duracionSeg * 1000);

      let currentDist = 0;
      fullPointsArray.forEach((pt, idx) => {
        if (idx === 0) {
          pt.time = new Date(startMs);
        } else if (idx === fullPointsArray.length - 1) {
          pt.time = new Date(endMs);
        } else {
          const d = this.trackEditorService.getDistance(
            fullPointsArray[idx - 1].lat, fullPointsArray[idx - 1].lng,
            pt.lat, pt.lng
          );
          currentDist += d;
          const ratio = totalDistMetros > 0 ? currentDist / totalDistMetros : (idx / (fullPointsArray.length - 1));
          pt.time = new Date(startMs + (endMs - startMs) * ratio);
        }
      });

      // Insertar los nuevos puntos al final de this.gpxPoints (omitiendo el primero que ya coincide con insertAnchorA)
      const pointsToAppend = fullPointsArray.slice(1).map(pt => ({
        lat: pt.lat,
        lng: pt.lng,
        time: pt.time instanceof Date ? pt.time : new Date(pt.time),
        mode: appliedMode,
        distAcum: 0,
        timeAcum: 0
      }));

      const oldLastIdx = this.gpxPoints.length - 1;
      this.gpxPoints.push(...pointsToAppend);
      const newLastIdx = this.gpxPoints.length - 1;

      const editId = Math.random().toString(36).substring(2, 9);
      this.pendingEdits.push({
        id: editId,
        type: 'append_segment',
        description: `${this.pendingEdits.length + 1} - Prolongación final (${appliedMode})`,
        data: {
          points: fullPointsArray,
          addedPointsCount: pointsToAppend.length,
          startAnchor: {
            index: oldLastIdx,
            lat: this.insertAnchorA.lat,
            lng: this.insertAnchorA.lng,
            time: new Date(startMs).toISOString()
          },
          endAnchor: {
            index: newLastIdx,
            lat: fullPointsArray[fullPointsArray.length - 1].lat,
            lng: fullPointsArray[fullPointsArray.length - 1].lng,
            time: new Date(endMs).toISOString()
          }
        },
        isHidden: false
      });

      this.cleanupInsertMode();
      this.editorState = 'SELECTING';
      this.actualizarTramosDisponibles();
      this.drawBaseAndEdits();
      if (this.mostrarTiempos) {
        this.updateTimeMarkers();
      }

      // Auto-seleccionar el nuevo tramo prolongado para edición inmediata de tiempos y modo
      const newTramo = this.tramosDisponibles.find(t => t.endIdx === newLastIdx);
      if (newTramo) {
        this.onSelectTramoFromDropdown(newTramo.id);
      } else {
        this.setAnchor(oldLastIdx);
        this.setAnchor(newLastIdx);
      }
      return;
    } else if (this.activeFlow === 'PREPEND') {
      // Calcular tiempos hacia atrás si insertAnchorB tiene tiempo
      let endMs = this.insertAnchorB.time ? new Date(this.insertAnchorB.time).getTime() : NaN;
      if (isNaN(endMs) && this.gpxPoints[0]?.time) {
        const t = this.gpxPoints[0].time;
        endMs = t instanceof Date ? t.getTime() : new Date(t as any).getTime();
      }
      if (isNaN(endMs)) {
        endMs = Date.now();
      }

      const speedMps = this.trackEditorService.getModeSpeedMps(appliedMode);
      let totalDistMetros = 0;
      for (let i = 0; i < fullPointsArray.length - 1; i++) {
        totalDistMetros += this.trackEditorService.getDistance(
          fullPointsArray[i].lat, fullPointsArray[i].lng,
          fullPointsArray[i + 1].lat, fullPointsArray[i + 1].lng
        );
      }
      const duracionSeg = Math.max(1, totalDistMetros / speedMps);
      const startMs = endMs - (duracionSeg * 1000);

      let currentDist = 0;
      fullPointsArray.forEach((pt, idx) => {
        if (idx === 0) {
          pt.time = new Date(startMs);
        } else if (idx === fullPointsArray.length - 1) {
          pt.time = new Date(endMs);
        } else {
          const d = this.trackEditorService.getDistance(
            fullPointsArray[idx - 1].lat, fullPointsArray[idx - 1].lng,
            pt.lat, pt.lng
          );
          currentDist += d;
          const ratio = totalDistMetros > 0 ? currentDist / totalDistMetros : (idx / (fullPointsArray.length - 1));
          pt.time = new Date(startMs + (endMs - startMs) * ratio);
        }
      });

      // Insertar los puntos al principio de this.gpxPoints (omitiendo el último punto que coincide con insertAnchorB)
      const pointsToPrepend = fullPointsArray.slice(0, -1).map(pt => ({
        lat: pt.lat,
        lng: pt.lng,
        time: pt.time instanceof Date ? pt.time : new Date(pt.time),
        mode: appliedMode,
        distAcum: 0,
        timeAcum: 0
      }));
      this.gpxPoints.unshift(...pointsToPrepend);

      const editId = Math.random().toString(36).substring(2, 9);
      this.pendingEdits.push({
        id: editId,
        type: 'prepend_segment',
        description: `${this.pendingEdits.length + 1} - Prolongación inicio (${appliedMode})`,
        data: {
          points: fullPointsArray,
          addedPointsCount: pointsToPrepend.length,
          startAnchor: {
            index: 0,
            lat: fullPointsArray[0].lat,
            lng: fullPointsArray[0].lng,
            time: new Date(startMs).toISOString()
          },
          endAnchor: {
            index: pointsToPrepend.length,
            lat: this.insertAnchorB.lat,
            lng: this.insertAnchorB.lng,
            time: new Date(endMs).toISOString()
          }
        },
        isHidden: false
      });

      this.cleanupInsertMode();
      this.editorState = 'SELECTING';
      this.actualizarTramosDisponibles();
      this.drawBaseAndEdits();
      if (this.mostrarTiempos) {
        this.updateTimeMarkers();
      }
      return;
    } else {
      const editId = Math.random().toString(36).substring(2, 9);
      this.pendingEdits.push({
        id: editId,
        type: 'insert_segment',
        description: `${this.pendingEdits.length + 1} - Inserción tramo (${appliedMode})`,
        data: {
          startAnchor: this.insertAnchorA,
          endAnchor: this.insertAnchorB,
          mode: appliedMode,
          points: fullPointsArray
        },
        isHidden: false
      });
      this.drawBaseAndEdits();
    }

    this.cleanupInsertMode();
    this.editorState = 'SELECTING';
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ROUTING ASISTIDO (Fase 2.2)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /** Perfiles de routing soportados (OSRM o Directos) */
  routingProfiles = [
    { id: 'driving', name: 'Coche', icon: '🚗', isOsrm: true },
    { id: 'walking', name: 'A pie', icon: '🚶', isOsrm: true },
    { id: 'cycling', name: 'Bici', icon: '🚲', isOsrm: true },
    { id: 'bus', name: 'Autobús', icon: '🚌', isOsrm: true },
    { id: 'train', name: 'Tren', icon: '🚂', isOsrm: false },
    { id: 'boat', name: 'Barco', icon: '🚢', isOsrm: false },
    { id: 'plane', name: 'Avión', icon: '✈️', isOsrm: false }
  ];

  /** Transición desde el Panel de Decisión al dibujo manual */
  chooseManualDraw() {
    this.transitionToDrawingInsert();
  }

  /** Solicita ruta asistida al servicio (OSRM, SeaRoute, etc.) */
  async requestAssistedRoute(profile: string) {
    if (!this.insertAnchorA || !this.insertAnchorB) return;
    if (this.routingService.isRequestInFlight) return; // mutex

    this.routingProfile = profile;
    this.selectedMode = profile; // Asegurar que el modo coincide para el guardado
    this.routingError = null;
    this.routingResult = null;
    this.editorState = 'CALCULATING_ROUTE';

    const result = await this.routingService.getRoute(
      this.insertAnchorA.lat, this.insertAnchorA.lng,
      this.insertAnchorB.lat, this.insertAnchorB.lng,
      profile
    );

    if (!result || result.points.length < 2) {
      this.routingError = 'No se pudo calcular la ruta. Puedes intentarlo de nuevo o dibujar manualmente.';
      this.editorState = 'SELECTING_MODE';
      return;
    }

    this.routingResult = result;
    this.showRoutePreview(result.points);
    this.editorState = 'PREVIEW_ROUTE';
  }

  /** Muestra la ruta propuesta en el mapa */
  private showRoutePreview(points: { lat: number; lng: number }[]) {
    if (!this.map) return;
    this.clearRoutePreview();

    if (this.polylinesGroup) {
      this.polylinesGroup.setStyle({ opacity: 0.3 });
    }

    const latLngs = points.map(p => L.latLng(p.lat, p.lng));
    this.routePreviewLine = L.polyline(latLngs, {
      color: '#f59e0b', // Amarillo para distinguir de manual (violeta)
      weight: 5,
      opacity: 0.9
    }).addTo(this.map);
  }

  /** Limpia la preview de ruta del mapa */
  private clearRoutePreview() {
    if (this.routePreviewLine) {
      this.routePreviewLine.remove();
      this.routePreviewLine = null;
    }
  }

  /** El usuario acepta la ruta propuesta: delega al pipeline de insert */
  acceptAssistedRoute() {
    if (!this.routingResult) return;
    
    const profile = this.routingProfile!;

    // Convertir el resultado a puntos de inserción internos
    // Omitimos el primero y el último si hay intermedios porque saveInsert() ya reinyecta insertAnchorA y insertAnchorB
    const pts = this.routingResult.points;
    const innerPoints = pts && pts.length > 2 ? pts.slice(1, -1).map(p => ({
      lat: p.lat,
      lng: p.lng
    })) : [];

    this.insertPoints = innerPoints;
    
    // Pasamos el mode global al saveInsert
    this.saveInsert(profile);
    this.clearRoutePreview();
  }

  /** El usuario rechaza la ruta propuesta: vuelve al Panel de Decisión */
  rejectAssistedRoute() {
    this.clearRoutePreview();
    this.routingResult = null;
    this.routingError = null;

    if (this.polylinesGroup) {
      this.polylinesGroup.setStyle({ opacity: 1 });
    }

    this.editorState = 'SELECTING_MODE';
  }

  /** Formatea distancia para la UI */
  formatDistance(meters: number): string {
    return meters >= 1000
      ? (meters / 1000).toFixed(1) + ' km'
      : Math.round(meters) + ' m';
  }

  /** Formatea duración para la UI */
  formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}min`;
    return `${m} min`;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // MODO PREPEND (Prolongación Inicio)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  startPrependMode() {
    if (!this.map || this.gpxPoints.length === 0) return;

    this.clearSelection();
    this.cleanupInsertMode();
    this.cleanupGeometryMode();

    this.activeFlow = 'PREPEND';
    this.editorState = 'PREPEND_SELECTING_A';

    // Para Prepend, el ancla B es el primer punto de la ruta (real o virtual)
    const firstPt = this.getVirtualFirstPoint();

    this.insertAnchorB = {
      index: 0,
      time: (firstPt as any).time ? new Date((firstPt as any).time).toISOString() : undefined,
      lat: firstPt.lat,
      lng: firstPt.lng
    };

    // Pintar marcador visual en el punto inicial existente
    this.insertMarkerB = L.circleMarker([firstPt.lat, firstPt.lng], {
      color: 'white', fillColor: '#ef4444', fillOpacity: 1, radius: 8, weight: 2
    }).addTo(this.map).bindTooltip('Inicio Grabado (B)', { permanent: true, direction: 'right' }).openTooltip();
  }

  getVirtualFirstPoint(): { lat: number, lng: number, time?: any } {
    let firstPt = this.gpxPoints[0];
    const prepends = this.pendingEdits.filter(e => e.type === 'prepend_segment');
    if (prepends.length > 0) {
      const firstPrepend = prepends[0];
      const pts = firstPrepend.data.points;
      if (pts && pts.length > 0) {
        firstPt = pts[0];
      }
    }
    return firstPt;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // MODO APPEND (Fase 2.1.a) — Aislado de los modos previos
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  startAppendMode() {
    if (!this.map || this.gpxPoints.length === 0) return;

    this.clearSelection();
    this.cleanupInsertMode();
    this.cleanupGeometryMode();

    this.activeFlow = 'APPEND';
    this.editorState = 'APPEND_SELECTING_B';

    // Para Append, partimos del último punto existente
    const lastPt = this.getVirtualLastPoint();
    let isoTime: string | undefined = undefined;
    if (lastPt.time) {
      const dt = lastPt.time instanceof Date ? lastPt.time : new Date(lastPt.time);
      if (!isNaN(dt.getTime())) {
        isoTime = dt.toISOString();
      }
    }
    
    // Setear insertAnchorA al índice del punto final
    this.insertAnchorA = { 
      index: lastPt.index, 
      time: isoTime, 
      lat: lastPt.lat, 
      lng: lastPt.lng 
    };

    // Pintar marcador visual
    this.insertMarkerA = L.circleMarker([lastPt.lat, lastPt.lng], {
      color: 'white', fillColor: '#0d9488', fillOpacity: 1, radius: 8, weight: 2
    }).addTo(this.map).bindTooltip('Inicio Prolongación', { permanent: true, direction: 'right' }).openTooltip();
  }

  getVirtualLastPoint(): { lat: number, lng: number, time?: any, index: number } {
    const lastIdx = this.gpxPoints.length - 1;
    let lastPt = this.gpxPoints[lastIdx];
    
    // Si el último punto no tiene hora válida, buscar hacia atrás el último punto con hora
    let time = (lastPt as any)?.time;
    if (!time || isNaN(new Date(time).getTime())) {
      for (let i = lastIdx; i >= 0; i--) {
        const t = this.gpxPoints[i]?.time;
        if (t && !isNaN(new Date(t as any).getTime())) {
          time = t;
          break;
        }
      }
    }
    return { lat: lastPt.lat, lng: lastPt.lng, time, index: lastIdx };
  }

  private addAppendVertex(latlng: L.LatLng) {
    if (!this.map || !this.appendLine) return;

    this.appendPoints.push({ lat: latlng.lat, lng: latlng.lng });

    // Marcador draggable
    const marker = L.marker(latlng, {
      draggable: true,
      icon: L.divIcon({
        className: 'append-vertex-icon',
        html: '<div style="width: 12px; height: 12px; background: #0d9488; border: 2px solid white; border-radius: 50%;"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      })
    }).addTo(this.map);

    marker.on('drag', () => this.updateAppendLine());
    marker.on('contextmenu', () => this.removeAppendVertex(marker));

    this.appendVertices.push(marker);
    this.updateAppendLine();
  }

  private removeAppendVertex(marker: L.Marker) {
    if (!this.map) return;
    const idx = this.appendVertices.indexOf(marker);
    if (idx !== -1) {
      this.appendVertices.splice(idx, 1);
      this.appendPoints.splice(idx, 1);
    }
    marker.remove();
    this.updateAppendLine();
  }

  private updateAppendLine() {
    if (!this.appendLine || this.gpxPoints.length === 0) return;

    const lastPt = this.gpxPoints[this.gpxPoints.length - 1];
    const startLatLng = L.latLng(lastPt.lat, lastPt.lng);
    const intermediateLatLngs = this.appendVertices.map((m: L.Marker) => m.getLatLng());

    this.appendLine.setLatLngs([startLatLng, ...intermediateLatLngs]);

    // Sincronizar appendPoints con las posiciones actuales de los marcadores
    this.appendPoints = this.appendVertices.map((m: L.Marker) => ({
      lat: m.getLatLng().lat,
      lng: m.getLatLng().lng
    }));
  }

  saveAppend() {
    if (this.appendPoints.length === 0) return;

    this.appendRequest.emit({
      points: [...this.appendPoints]
    });

    this.cleanupAppendMode();
  }

  cancelAppend() {
    this.cleanupAppendMode();
  }

  private cleanupAppendMode() {
    this.editorState = 'SELECTING';
    if (this.appendLine) {
      this.appendLine.remove();
      this.appendLine = null;
    }
    this.appendVertices.forEach((m: L.Marker) => m.remove());
    this.appendVertices = [];
    this.appendPoints = [];
  }

  // Métodos de Flechas Direccionales
  private calculateAngle(p1: any, p2: any): number {
    const p1Lat = Array.isArray(p1) ? p1[0] : (p1.lat || 0);
    const p1Lng = Array.isArray(p1) ? p1[1] : (p1.lng || 0);
    const p2Lat = Array.isArray(p2) ? p2[0] : (p2.lat || 0);
    const p2Lng = Array.isArray(p2) ? p2[1] : (p2.lng || 0);

    const dy = p2Lat - p1Lat;
    const dx = Math.cos((Math.PI / 180) * p1Lat) * (p2Lng - p1Lng);
    const angle = Math.atan2(dy, dx);
    let degrees = angle * (180 / Math.PI);
    degrees = (90 - degrees + 360) % 360;
    return Math.round(degrees);
  }

  private addDirectionArrows(L: any, coordinates: any[], color: string = '#FF0000', opacity: number = 1): void {
    if (!this.polylinesGroup || coordinates.length < 2) return;

    const totalPoints = coordinates.length;
    const interval = Math.max(Math.floor(totalPoints / 4), 60);

    for (let i = interval; i < coordinates.length; i += interval) {
      const prevPoint = coordinates[i - 1];
      const currentPoint = coordinates[i];

      const angle = this.calculateAngle(prevPoint, currentPoint);

      const arrowIcon = L.divIcon({
        className: 'direction-arrow-svg',
        html: `
        <svg width="16" height="16" viewBox="0 0 32 32" 
             style="transform: rotate(${angle}deg); filter: drop-shadow(0 1px 1px rgba(0,0,0,0.3)); opacity: ${opacity * 0.5};">
          <!-- Fondo/Borde blanco para contraste -->
          <path d="M 6 24 L 16 8 L 26 24" 
                fill="none" 
                stroke="white" 
                stroke-width="6"
                stroke-linecap="round"
                stroke-linejoin="round"/>
          <!-- Línea de color semántico -->
          <path d="M 6 24 L 16 8 L 26 24" 
                fill="none" 
                stroke="${color}" 
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"/>
        </svg>
      `,
        iconSize: [16, 16],
        iconAnchor: [8, 12]
      });

      L.marker(currentPoint, {
        icon: arrowIcon,
        interactive: false,
        keyboard: false,
        alt: ''
      }).addTo(this.polylinesGroup);
    }
  }

  // ==========================================
  // ⏱️ VISUALIZADOR DE MARCAS DE TIEMPO GPX
  // ==========================================

  toggleMostrarTiempos(): void {
    this.mostrarTiempos = !this.mostrarTiempos;
    if (this.mostrarTiempos) {
      this.updateTimeMarkers();
    } else {
      this.clearTimeMarkers();
    }
    if (this.mostrarDistancias) {
      this.updateDistanceMarkers();
    }
  }

  private clearTimeMarkers(): void {
    if (this.timeMarkersGroup) {
      this.timeMarkersGroup.clearLayers();
    }
  }

  private updateTimeMarkers(): void {
    if (!this.map || !this.gpxPoints || this.gpxPoints.length === 0 || !this.timeMarkersGroup) return;

    this.clearTimeMarkers();
    if (!this.mostrarTiempos) return;

    const bounds = this.map.getBounds().pad(0.1); // Margen del área visible actual del mapa

    // Determinar rango de puntos si hay un tramo seleccionado en el desplegable o anclas activas
    let minIdx = 0;
    let maxIdx = this.gpxPoints.length - 1;

    if (this.selectedTramoId) {
      const tramo = this.tramosDisponibles.find(t => t.id === this.selectedTramoId);
      if (tramo) {
        minIdx = Math.min(tramo.startIdx, tramo.endIdx);
        maxIdx = Math.max(tramo.startIdx, tramo.endIdx);
      }
    } else if (this.anchorA && this.anchorB && this.anchorA.index !== undefined && this.anchorB.index !== undefined) {
      minIdx = Math.min(this.anchorA.index, this.anchorB.index);
      maxIdx = Math.max(this.anchorA.index, this.anchorB.index);
    }

    // 1. Filtrar únicamente los puntos que pertenezcan al tramo seleccionado, tengan tiempo Y estén dentro del área visible en pantalla
    const visiblePointsWithTime: { pt: GpxPoint; originalIdx: number }[] = [];
    this.gpxPoints.forEach((pt, originalIdx) => {
      if (originalIdx >= minIdx && originalIdx <= maxIdx) {
        if (pt.time || (pt.timeAcum !== undefined && pt.timeAcum !== null && pt.timeAcum > 0)) {
          if (bounds.contains([pt.lat, pt.lng])) {
            visiblePointsWithTime.push({ pt, originalIdx });
          }
        }
      }
    });

    if (visiblePointsWithTime.length === 0) return;

    // 2. Limitar estrictamente el número máximo de marcadores a renderizar (máx. 60) para garantizar 0 cuelgues
    const MAX_VISUAL_MARKERS = 60;
    const step = Math.max(1, Math.ceil(visiblePointsWithTime.length / MAX_VISUAL_MARKERS));
    const bothActive = this.mostrarTiempos && this.mostrarDistancias;

    for (let i = 0; i < visiblePointsWithTime.length; i += step) {
      const { pt, originalIdx } = visiblePointsWithTime[i];

      // Formatear texto de hora
      let horaText = '';
      let fechaFull = '';
      if (pt.time) {
        const dateObj = new Date(pt.time);
        const hh = dateObj.getHours().toString().padStart(2, '0');
        const mm = dateObj.getMinutes().toString().padStart(2, '0');
        const ss = dateObj.getSeconds().toString().padStart(2, '0');
        horaText = `${hh}:${mm}:${ss}`;
        fechaFull = dateObj.toLocaleString();
      } else if (pt.timeAcum !== undefined) {
        const totalSec = Math.floor(pt.timeAcum);
        const hh = Math.floor(totalSec / 3600).toString().padStart(2, '0');
        const mm = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0');
        const ss = (totalSec % 60).toString().padStart(2, '0');
        horaText = `+${hh}:${mm}:${ss}`;
        fechaFull = `Tiempo acumulado: +${hh}:${mm}:${ss}`;
      }

      if (!horaText) continue;

      const icon = L.divIcon({
        className: 'gpx-time-badge-container',
        html: `<div class="gpx-time-badge">⏱️ ${horaText}</div>`,
        iconSize: [115, 30],
        iconAnchor: [57, bothActive ? 32 : 15]
      });

      const marker = L.marker([pt.lat, pt.lng], { icon });

      const distKm = pt.distAcum !== undefined ? (pt.distAcum / 1000).toFixed(2) : '0.00';
      const modoNorm = pt.mode || pt.hfMode || 'walking';

      const popupContent = `
        <div style="font-family: sans-serif; font-size: 13px; line-height: 1.4; color: #1e293b; padding: 4px;">
          <div style="font-weight: 700; color: #0284c7; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 6px;">
            ⏱️ Punto GPX #${originalIdx + 1}
          </div>
          <div><strong>Hora:</strong> ${fechaFull || horaText}</div>
          <div><strong>Distancia:</strong> ${distKm} km</div>
          <div><strong>Modo:</strong> ${this.getModeName(modoNorm)}</div>
        </div>
      `;

      marker.bindPopup(popupContent);
      this.timeMarkersGroup.addLayer(marker);
    }
  }

  // ==========================================
  // 📏 VISUALIZADOR DE MARCAS DE DISTANCIA GPX
  // ==========================================

  toggleMostrarDistancias(): void {
    this.mostrarDistancias = !this.mostrarDistancias;
    if (this.mostrarDistancias) {
      this.updateDistanceMarkers();
    } else {
      this.clearDistanceMarkers();
    }
    if (this.mostrarTiempos) {
      this.updateTimeMarkers();
    }
  }

  private clearDistanceMarkers(): void {
    if (this.distanceMarkersGroup) {
      this.distanceMarkersGroup.clearLayers();
    }
  }

  private updateDistanceMarkers(): void {
    if (!this.map || !this.gpxPoints || this.gpxPoints.length === 0 || !this.distanceMarkersGroup) return;

    this.clearDistanceMarkers();
    if (!this.mostrarDistancias) return;

    const bounds = this.map.getBounds().pad(0.1); // Margen del área visible actual del mapa

    // Determinar rango de puntos si hay un tramo seleccionado en el desplegable o anclas activas
    let minIdx = 0;
    let maxIdx = this.gpxPoints.length - 1;

    if (this.selectedTramoId) {
      const tramo = this.tramosDisponibles.find(t => t.id === this.selectedTramoId);
      if (tramo) {
        minIdx = Math.min(tramo.startIdx, tramo.endIdx);
        maxIdx = Math.max(tramo.startIdx, tramo.endIdx);
      }
    } else if (this.anchorA && this.anchorB && this.anchorA.index !== undefined && this.anchorB.index !== undefined) {
      minIdx = Math.min(this.anchorA.index, this.anchorB.index);
      maxIdx = Math.max(this.anchorA.index, this.anchorB.index);
    }

    // 1. Filtrar únicamente los puntos que pertenezcan al tramo seleccionado y estén dentro del área visible en pantalla
    const visiblePoints: { pt: GpxPoint; originalIdx: number }[] = [];
    this.gpxPoints.forEach((pt, originalIdx) => {
      if (originalIdx >= minIdx && originalIdx <= maxIdx) {
        if (bounds.contains([pt.lat, pt.lng])) {
          visiblePoints.push({ pt, originalIdx });
        }
      }
    });

    if (visiblePoints.length === 0) return;

    // 2. Limitar estrictamente el número máximo de marcadores a renderizar (máx. 60)
    const MAX_VISUAL_MARKERS = 60;
    const step = Math.max(1, Math.ceil(visiblePoints.length / MAX_VISUAL_MARKERS));
    const bothActive = this.mostrarTiempos && this.mostrarDistancias;

    for (let i = 0; i < visiblePoints.length; i += step) {
      const { pt, originalIdx } = visiblePoints[i];

      let distText = '';
      const distM = pt.distAcum !== undefined ? pt.distAcum : 0;
      if (distM >= 1000) {
        distText = `${(distM / 1000).toFixed(2)} km`;
      } else {
        distText = `${Math.round(distM)} m`;
      }

      const icon = L.divIcon({
        className: 'gpx-dist-badge-container',
        html: `<div class="gpx-dist-badge">📏 ${distText}</div>`,
        iconSize: [115, 30],
        iconAnchor: [57, bothActive ? -2 : 15]
      });

      const marker = L.marker([pt.lat, pt.lng], { icon });

      let horaFull = 'N/A';
      if (pt.time) {
        horaFull = new Date(pt.time).toLocaleString();
      } else if (pt.timeAcum !== undefined) {
        const totalSec = Math.floor(pt.timeAcum);
        const hh = Math.floor(totalSec / 3600).toString().padStart(2, '0');
        const mm = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0');
        const ss = (totalSec % 60).toString().padStart(2, '0');
        horaFull = `+${hh}:${mm}:${ss}`;
      }

      const popupContent = `
        <div style="font-family: sans-serif; font-size: 13px; line-height: 1.4; color: #1e293b; padding: 4px;">
          <div style="font-weight: 700; color: #0d9488; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 6px;">
            📏 Punto GPX #${originalIdx + 1}
          </div>
          <div><strong>Distancia acum.:</strong> ${distText}</div>
          <div><strong>Hora:</strong> ${horaFull}</div>
          <div><strong>Modo:</strong> ${this.getModeName(pt.mode || pt.hfMode || 'walking')}</div>
        </div>
      `;

      marker.bindPopup(popupContent);
      this.distanceMarkersGroup.addLayer(marker);
    }
  }

  public getModeName(mode: string | null | undefined): string {
    if (!mode) return 'Andando';
    const m = mode.toLowerCase();
    if (m.includes('walk') || m.includes('camin') || m.includes('andan')) return 'Andando';
    if (m.includes('car') || m.includes('coch') || m.includes('driv')) return 'Coche';
    if (m.includes('bic') || m.includes('cycl')) return 'Bicicleta';
    if (m.includes('run') || m.includes('corr')) return 'Corriendo';
    if (m.includes('bus')) return 'Autobús';
    if (m.includes('boat') || m.includes('barco') || m.includes('ship') || m.includes('ferry') || m.includes('crucero')) return 'Barco';
    if (m.includes('plane') || m.includes('avion')) return 'Avión';
    if (m.includes('train') || m.includes('tren')) return 'Tren';
    return mode;
  }

  // ====================================================================
  // 🔄 MÉTODOS: RUTA ORIGINAL (PREVISUALIZACIÓN, GUARDADO Y RETROCESO)
  // ====================================================================

  /**
   * Activa el modo previsualización de la ruta original.
   * Guarda el estado actual en memoria para permitir retroceder.
   */
  activarModoRutaOriginal(): void {
    if (!this.actividadId) {
      alert('⚠️ No se identificó la actividad para buscar la ruta original.');
      return;
    }

    // 1. Guardar copia exacta del trazado actual para rollback
    this.puntosGpxAntesDeOriginal = [...this.gpxPoints];

    // 2. Limpiar selección de anclas si las hubiera
    this.clearSelection();

    // 3. Consultar los puntos originales
    this.trackEditorService.getOriginalGpxPoints(this.actividadId).subscribe({
      next: (originalPoints) => {
        if (!originalPoints || originalPoints.length === 0) {
          alert('⚠️ No se encontraron puntos para la ruta original de esta actividad.');
          return;
        }

        // 4. Asignar puntos originales a la vista
        this.gpxPoints = originalPoints;
        this.modoPrevisualizandoOriginal = true;
        this.drawBaseAndEdits();

        if (this.polylinesGroup && this.map && this.polylinesGroup.getLayers().length > 0) {
          this.map.fitBounds(this.polylinesGroup.getBounds());
        }

        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('❌ Error obteniendo ruta original:', err);
        alert('❌ Error al consultar la ruta original del recorrido.');
      }
    });
  }

  /**
   * Retrocede al estado exacto previo a pulsar "Ruta Original"
   */
  descartarModoRutaOriginal(): void {
    if (this.puntosGpxAntesDeOriginal && this.puntosGpxAntesDeOriginal.length > 0) {
      this.gpxPoints = [...this.puntosGpxAntesDeOriginal];
    }
    this.modoPrevisualizandoOriginal = false;
    this.puntosGpxAntesDeOriginal = [];
    this.drawBaseAndEdits();

    if (this.polylinesGroup && this.map && this.polylinesGroup.getLayers().length > 0) {
      this.map.fitBounds(this.polylinesGroup.getBounds());
    }

    this.cdr.detectChanges();
  }

  /**
   * Confirma y guarda la ruta original de forma permanente en la base de datos
   */
  confirmarGuardarRutaOriginal(): void {
    if (!this.actividadId) return;

    this.guardandoOriginal = true;
    this.cdr.detectChanges();

    this.trackEditorService.restaurarRutaOriginal(this.actividadId).subscribe({
      next: (resp) => {
        this.guardandoOriginal = false;
        this.modoPrevisualizandoOriginal = false;
        this.puntosGpxAntesDeOriginal = [];
        this.pendingEdits = [];

        alert('✅ Ruta original guardada y sincronizada con éxito en todos los módulos.');
        this.rutaOriginalGuardada.emit();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.guardandoOriginal = false;
        console.error('❌ Error guardando ruta original:', err);
        alert('❌ Error al guardar la ruta original: ' + (err.error?.detalle || err.message || err));
        this.cdr.detectChanges();
      }
    });
  }

  // ====================================================================
  // 🗺️ MÉTODOS: RUTA PROBABLE (GENERACIÓN BASADA EN FOTOS, ENRUTAMIENTO, ROLLBACK)
  // ====================================================================

  /**
   * Determina si una foto fue tomada en el mar (durante la navegación del barco)
   * para no incluirla en el cálculo de la ruta terrestre.
   */
  private esFotoEnMar(f: { lat: number; lng: number; timeMs: number }): boolean {
    if (!this.gpxPoints || this.gpxPoints.length === 0) return false;

    const isSeaPoint = (p: GpxPoint) => {
      const m = (p.mode || p.hfMode || '').toLowerCase();
      return m.includes('boat') || m.includes('barco') || m.includes('ship') || m.includes('ferry') || m.includes('crucero');
    };

    const hasSeaPoints = this.gpxPoints.some(p => isSeaPoint(p));
    if (!hasSeaPoints) return false;

    // Encontrar el punto del track más cercano espacialmente
    let closestPt: GpxPoint | null = null;
    let minDist = Infinity;
    let closestIsSea = false;

    for (const p of this.gpxPoints) {
      const d = this.trackEditorService.getDistance(p.lat, p.lng, f.lat, f.lng);
      if (d < minDist) {
        minDist = d;
        closestPt = p;
        closestIsSea = isSeaPoint(p);
      }
    }

    if (!closestPt) return false;

    // Si el punto más cercano es marítimo:
    if (closestIsSea) {
      // Si la foto está a más de 300 metros de cualquier punto terrestre, es indudablemente una foto en el mar
      let minDistToLand = Infinity;
      for (const p of this.gpxPoints) {
        if (!isSeaPoint(p)) {
          const dLand = this.trackEditorService.getDistance(p.lat, p.lng, f.lat, f.lng);
          if (dLand < minDistToLand) minDistToLand = dLand;
        }
      }

      if (minDistToLand > 300) {
        return true;
      }

      // Si hay marcas temporales en el track, comprobar si coincide con el tramo de navegación
      if (f.timeMs && closestPt.time instanceof Date && !isNaN(closestPt.time.getTime())) {
        return true;
      }
    }

    return false;
  }

  /**
   * Genera la ruta probable conectando las fotos de la actividad
   * ordenadas cronológicamente, usando walking (< 2.5 km) y driving (>= 2.5 km)
   */
  async generarRutaProbable(): Promise<void> {
    if (!this.archivosMedia || this.archivosMedia.length === 0) {
      alert('⚠️ No hay fotos cargadas en esta actividad para generar la ruta.');
      return;
    }

    // 1. Extraer fotos con coordenadas válidas exclusivamente en tierra
    const candidatos: { lat: number; lng: number; timeMs: number; nombre: string }[] = [];

    for (const item of this.archivosMedia) {
      let lat: number | null = item.latitud ?? item.lat ?? null;
      let lng: number | null = item.longitud ?? item.lng ?? item.lon ?? null;
      let horaRaw = item.timestampReal || item.horaCaptura || item.fechaCreacion || item.fecha || item.time || item.timestamp;

      if ((!lat || !lng || !horaRaw) && item.geolocalizacion) {
        try {
          const geoData = typeof item.geolocalizacion === 'string'
            ? JSON.parse(item.geolocalizacion)
            : item.geolocalizacion;
          lat = lat ?? (geoData?.latitud ?? geoData?.latitude ?? geoData?.lat ?? null);
          lng = lng ?? (geoData?.longitud ?? geoData?.longitude ?? geoData?.lng ?? geoData?.lon ?? null);
          horaRaw = horaRaw || geoData?.timestampReal || geoData?.timestamp || geoData?.time || geoData?.fecha;
        } catch (e) {
          if (typeof item.geolocalizacion === 'string' && item.geolocalizacion.includes(',')) {
            const parts = item.geolocalizacion.split(',').map((s: string) => parseFloat(s.trim()));
            if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
              lat = lat ?? parts[0];
              lng = lng ?? parts[1];
            }
          }
        }
      }

      if ((!lat || !lng || !horaRaw) && item.metadatos) {
        try {
          const metaData = typeof item.metadatos === 'string'
            ? JSON.parse(item.metadatos)
            : item.metadatos;
          lat = lat ?? (metaData?.latitud ?? metaData?.latitude ?? metaData?.lat ?? null);
          lng = lng ?? (metaData?.longitud ?? metaData?.longitude ?? metaData?.lng ?? null);
          horaRaw = horaRaw || metaData?.timestampReal || metaData?.timestamp || metaData?.dateTimeOriginal;
        } catch (e) {}
      }

      const filename = item.nombreArchivo || item.rutaArchivo || '';
      let timeMs: number | null = null;
      if (horaRaw) {
        const d = new Date(horaRaw);
        if (!isNaN(d.getTime())) timeMs = d.getTime();
      }
      if (!timeMs && filename) {
        const nameMatch = String(filename).match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
        if (nameMatch) {
          const d = new Date(
            parseInt(nameMatch[1], 10),
            parseInt(nameMatch[2], 10) - 1,
            parseInt(nameMatch[3], 10),
            parseInt(nameMatch[4], 10),
            parseInt(nameMatch[5], 10),
            parseInt(nameMatch[6], 10)
          );
          if (!isNaN(d.getTime())) timeMs = d.getTime();
        }
      }
      if (!timeMs) timeMs = Date.now();

      if (lat !== null && lng !== null && !isNaN(Number(lat)) && !isNaN(Number(lng)) && Number(lat) !== 0 && Number(lng) !== 0) {
        candidatos.push({
          lat: Number(lat),
          lng: Number(lng),
          timeMs,
          nombre: filename
        });
      }
    }

    // Mostrar overlay de progreso ANTES de filtrar (para que el usuario vea feedback inmediato)
    this.generandoProbable = true;
    this.progresoGeneracionProbable = `Analizando ${candidatos.length} fotos (detectando tierra/mar)...`;
    this.cdr.detectChanges();

    // Filtrar fotos que se encuentren en tierra firme (descartando fotos tomadas mar adentro)
    // Usa coordenadas deduplicadas y peticiones secuenciales para evitar rate-limiting
    const fotosValidas = await this.routingService.filterLandPoints(candidatos);

    for (const c of candidatos) {
      if (!fotosValidas.includes(c)) {
        console.log(`🌊 Foto descartada (mar adentro): ${c.nombre} (${c.lat}, ${c.lng})`);
      }
    }

    console.log(`📊 Fotos en tierra: ${fotosValidas.length} de ${candidatos.length} candidatos`);

    if (fotosValidas.length < 2) {
      this.generandoProbable = false;
      this.progresoGeneracionProbable = '';
      this.cdr.detectChanges();
      alert('⚠️ Se requieren al menos 2 fotos con coordenadas GPS en tierra firme para trazar una ruta probable.');
      return;
    }

    // 2. Ordenar cronológicamente
    fotosValidas.sort((a, b) => a.timeMs - b.timeMs);

    // 3. Agrupar waypoints consecutivos cercanos (< 25 metros)
    const waypoints: { lat: number; lng: number; startTimeMs: number; endTimeMs: number }[] = [];
    for (const f of fotosValidas) {
      if (waypoints.length === 0) {
        waypoints.push({ lat: f.lat, lng: f.lng, startTimeMs: f.timeMs, endTimeMs: f.timeMs });
      } else {
        const lastW = waypoints[waypoints.length - 1];
        const dist = this.trackEditorService.getDistance(lastW.lat, lastW.lng, f.lat, f.lng);
        if (dist < 25) {
          lastW.endTimeMs = Math.max(lastW.endTimeMs, f.timeMs);
        } else {
          waypoints.push({ lat: f.lat, lng: f.lng, startTimeMs: f.timeMs, endTimeMs: f.timeMs });
        }
      }
    }

    if (waypoints.length < 2) {
      this.generandoProbable = false;
      this.progresoGeneracionProbable = '';
      this.cdr.detectChanges();
      alert('⚠️ Todas las fotos se encuentran en el mismo punto (menos de 25m de distancia). No se puede trazar una ruta entre diferentes puntos.');
      return;
    }

    this.progresoGeneracionProbable = `Calculando 0 de ${waypoints.length - 1} tramos...`;
    this.cdr.detectChanges();

    // 4. Guardar copia del estado previo
    this.puntosGpxAntesDeProbable = [...this.gpxPoints];
    this.clearSelection();

    const allRoutePoints: GpxPoint[] = [];

    try {
      const UMBRAL_DISTANCIA_COCHE = 2500; // 2.5 km (Opción B)

      for (let i = 0; i < waypoints.length - 1; i++) {
        const wStart = waypoints[i];
        const wEnd = waypoints[i + 1];
        const distDirect = this.trackEditorService.getDistance(wStart.lat, wStart.lng, wEnd.lat, wEnd.lng);
        const profile = distDirect >= UMBRAL_DISTANCIA_COCHE ? 'driving' : 'walking';

        this.progresoGeneracionProbable = `Calculando tramo ${i + 1} de ${waypoints.length - 1} (${profile === 'driving' ? '🚗 Coche' : '🚶 A pie'})...`;
        this.cdr.detectChanges();

        // Solicitar trazado a RoutingService
        let legPoints: { lat: number; lng: number }[] = [];
        try {
          const routeResult = await this.routingService.getRoute(wStart.lat, wStart.lng, wEnd.lat, wEnd.lng, profile);
          if (routeResult && routeResult.points && routeResult.points.length >= 2) {
            legPoints = routeResult.points;
          }
        } catch (routeErr) {
          console.warn(`[Ruta Probable] Fallo enrutamiento para tramo ${i}, usando interpolación directa:`, routeErr);
        }

        // Fallback si no hubo puntos de ruta
        if (legPoints.length < 2) {
          const steps = Math.max(2, Math.min(100, Math.floor(distDirect / 30)));
          legPoints = [];
          for (let s = 0; s <= steps; s++) {
            const ratio = s / steps;
            legPoints.push({
              lat: wStart.lat + (wEnd.lat - wStart.lat) * ratio,
              lng: wStart.lng + (wEnd.lng - wStart.lng) * ratio
            });
          }
        }

        // Asignar timestamps y modo de transporte a los puntos del tramo
        const startTime = wStart.endTimeMs || wStart.startTimeMs;
        const endTime = wEnd.startTimeMs;
        const totalTimeDiff = endTime > startTime ? endTime - startTime : (distDirect / (profile === 'driving' ? 12.5 : 1.39)) * 1000;

        // Calcular distancia total del subtramo para interpolación temporal proporcional
        let legDistances: number[] = [0];
        let legDistTotal = 0;
        for (let j = 1; j < legPoints.length; j++) {
          const d = this.trackEditorService.getDistance(legPoints[j - 1].lat, legPoints[j - 1].lng, legPoints[j].lat, legPoints[j].lng);
          legDistTotal += d;
          legDistances.push(legDistTotal);
        }

        // Evitar duplicar el primer punto si ya tenemos puntos acumulados
        const startIndex = allRoutePoints.length > 0 ? 1 : 0;

        for (let j = startIndex; j < legPoints.length; j++) {
          const pt = legPoints[j];
          const distRatio = legDistTotal > 0 ? legDistances[j] / legDistTotal : j / legPoints.length;
          const ptTimeMs = startTime + totalTimeDiff * distRatio;

          allRoutePoints.push({
            lat: pt.lat,
            lng: pt.lng,
            time: new Date(ptTimeMs),
            mode: profile,
            hfMode: profile,
            distAcum: 0,
            timeAcum: 0
          });
        }
      }

      // 5. Preservar tramos marítimos (Barco / Mar) existentes y combinar con la ruta calculada en tierra
      let finalPoints: GpxPoint[] = [];

      const isSeaPoint = (p: GpxPoint) => {
        const m = (p.mode || p.hfMode || '').toLowerCase();
        return m.includes('boat') || m.includes('barco') || m.includes('ship') || m.includes('ferry') || m.includes('crucero');
      };

      const hasSeaPoints = this.puntosGpxAntesDeProbable.some(p => isSeaPoint(p));

      if (hasSeaPoints && this.puntosGpxAntesDeProbable.length > 0 && waypoints.length > 0) {
        const firstLandW = waypoints[0];
        const lastLandW = waypoints[waypoints.length - 1];

        // Encontrar índice del punto marítimo de atraque más cercano a la primera foto en tierra
        let arrivalIdx = -1;
        let minArrivalDist = Infinity;
        for (let idx = 0; idx < this.puntosGpxAntesDeProbable.length; idx++) {
          const pt = this.puntosGpxAntesDeProbable[idx];
          if (isSeaPoint(pt)) {
            const d = this.trackEditorService.getDistance(pt.lat, pt.lng, firstLandW.lat, firstLandW.lng);
            if (d < minArrivalDist) {
              minArrivalDist = d;
              arrivalIdx = idx;
            }
          }
        }

        // Encontrar índice del punto marítimo de zarpe más cercano a la última foto en tierra (si es posterior a arrivalIdx)
        let departureIdx = -1;
        let minDepDist = Infinity;
        const searchStart = arrivalIdx >= 0 ? arrivalIdx : 0;
        for (let idx = searchStart; idx < this.puntosGpxAntesDeProbable.length; idx++) {
          const pt = this.puntosGpxAntesDeProbable[idx];
          if (isSeaPoint(pt)) {
            const d = this.trackEditorService.getDistance(pt.lat, pt.lng, lastLandW.lat, lastLandW.lng);
            if (d < minDepDist) {
              minDepDist = d;
              departureIdx = idx;
            }
          }
        }

        const seaBefore = arrivalIdx >= 0
          ? this.puntosGpxAntesDeProbable.slice(0, arrivalIdx + 1).filter(p => isSeaPoint(p))
          : [];

        const seaAfter = departureIdx > arrivalIdx
          ? this.puntosGpxAntesDeProbable.slice(departureIdx).filter(p => isSeaPoint(p))
          : [];

        finalPoints = [...seaBefore, ...allRoutePoints, ...seaAfter];
      } else {
        finalPoints = allRoutePoints;
      }

      // 6. Asignar ruta generada en memoria con acumuladores recalculados
      this.gpxPoints = this.trackEditorService.recalculateAccumulators(finalPoints);
      this.modoPrevisualizandoProbable = true;
      this.drawBaseAndEdits();

      if (this.polylinesGroup && this.map && this.polylinesGroup.getLayers().length > 0) {
        this.map.fitBounds(this.polylinesGroup.getBounds());
      }

    } catch (err: any) {
      console.error('❌ Error generando ruta probable:', err);
      alert('❌ Error al generar la ruta probable: ' + (err.message || err));
      if (this.puntosGpxAntesDeProbable && this.puntosGpxAntesDeProbable.length > 0) {
        this.gpxPoints = [...this.puntosGpxAntesDeProbable];
      }
    } finally {
      this.generandoProbable = false;
      this.progresoGeneracionProbable = '';
      this.cdr.detectChanges();
    }
  }

  /**
   * Descarta la previsualización de la ruta probable y restaura el trazado anterior
   */
  descartarModoRutaProbable(): void {
    if (this.puntosGpxAntesDeProbable && this.puntosGpxAntesDeProbable.length > 0) {
      this.gpxPoints = [...this.puntosGpxAntesDeProbable];
    }
    this.modoPrevisualizandoProbable = false;
    this.puntosGpxAntesDeProbable = [];
    this.drawBaseAndEdits();

    if (this.polylinesGroup && this.map && this.polylinesGroup.getLayers().length > 0) {
      this.map.fitBounds(this.polylinesGroup.getBounds());
    }

    this.cdr.detectChanges();
  }

  /**
   * Guarda de forma permanente en base de datos la ruta probable generada
   */
  confirmarGuardarRutaProbable(): void {
    if (!this.actividadId) return;

    this.guardandoProbable = true;
    this.cdr.detectChanges();

    this.trackEditorService.guardarRutaGenerada(this.actividadId, this.gpxPoints).subscribe({
      next: (resp) => {
        this.guardandoProbable = false;
        this.modoPrevisualizandoProbable = false;
        this.puntosGpxAntesDeProbable = [];
        this.pendingEdits = [];

        alert('✅ Ruta probable guardada y sincronizada con éxito en todos los módulos.');
        this.rutaOriginalGuardada.emit();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.guardandoProbable = false;
        console.error('❌ Error guardando ruta probable:', err);
        alert('❌ Error al guardar la ruta probable: ' + (err.error?.detalle || err.message || err));
        this.cdr.detectChanges();
      }
    });
  }
}


