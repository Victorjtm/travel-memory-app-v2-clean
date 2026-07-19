import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { GpxPoint } from '../../servicios/gpx-animation.service';
import { TrackAnchor, EditAction, TrackEdit } from '../../modelos/track-edit.model';
import { TrackEditorService } from '../../servicios/track-editor.service';
import { RoutingService, RoutingResult } from '../../servicios/routing.service';

@Component({
  selector: 'app-track-editor-map',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './track-editor-map.component.html',
  styleUrls: ['./track-editor-map.component.scss']
})
export class TrackEditorMapComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef;

  @Input() gpxPoints: GpxPoint[] = [];
  @Input() trackEdits: TrackEdit[] = [];
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
  @Output() close = new EventEmitter<void>();

  private map: L.Map | null = null;
  private polylinesGroup: L.FeatureGroup | null = null;
  private highlightPolyline: L.Polyline | null = null;
  
  private markerA: L.CircleMarker | null = null;
  private markerB: L.CircleMarker | null = null;

  anchorA: TrackAnchor | null = null;
  anchorB: TrackAnchor | null = null;

  editorState: 'SELECTING' | 'EDITING_GEOMETRY' | 'APPENDING' | 'IDLE' | 'SELECTING_A' | 'SELECTING_B' | 'SELECTING_MODE' | 'DRAWING_INSERT' | 'PREVIEW_INSERT' | 'CALCULATING_ROUTE' | 'PREVIEW_ROUTE' = 'SELECTING';

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
    original: '#4f46e5' // Indigo
  };

  constructor(private trackEditorService: TrackEditorService, private routingService: RoutingService) {}

  ngOnInit() {}

  ngOnChanges(changes: SimpleChanges) {
    if ((changes['gpxPoints'] || changes['trackEdits']) && this.map) {
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

    this.map = L.map(this.mapContainer.nativeElement).setView([this.gpxPoints[0].lat, this.gpxPoints[0].lng], 13);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors © CARTO',
      maxZoom: 19
    }).addTo(this.map);

    this.polylinesGroup = L.featureGroup().addTo(this.map);

    this.drawBaseAndEdits();

    if (this.polylinesGroup.getLayers().length > 0) {
      this.map.fitBounds(this.polylinesGroup.getBounds());
    }

    // Evento de clic en el mapa para snap
    this.map.on('click', (e: L.LeafletMouseEvent) => this.handleMapClick(e));
  }

  private drawBaseAndEdits() {
    if (!this.map || !this.gpxPoints || this.gpxPoints.length === 0 || !this.polylinesGroup) return;

    this.polylinesGroup.clearLayers();

    // 1. Determinar el estado visual de cada punto
    // Clonamos información necesaria para saber cómo pintar cada punto
    const visualPoints = this.gpxPoints.map(p => ({ 
      lat: p.lat, 
      lng: p.lng, 
      visualMode: 'original', 
      isDeleted: false 
    }));

    // 2. Aplicar Edits para marcar el estado (Priority: delete > override)
    // Aplicamos overrides primero para que si hay un solapamiento con delete,
    // el isDeleted se mantenga y prevalezca visualmente.
    const overrides = this.trackEdits.filter(e => e.action === 'override_mode');
    const deletes = this.trackEdits.filter(e => e.action === 'delete_segment');

    const applyEditToVisuals = (edit: TrackEdit) => {
      const startIdx = this.trackEditorService.resolveAnchor(edit.startAnchor, this.gpxPoints);
      const endIdx = this.trackEditorService.resolveAnchor(edit.endAnchor, this.gpxPoints);
      
      if (startIdx !== -1 && endIdx !== -1) {
        const min = Math.min(startIdx, endIdx);
        const max = Math.max(startIdx, endIdx);
        
        for (let i = min; i <= max; i++) {
          if (edit.action === 'override_mode' && edit.newMode) {
             visualPoints[i].visualMode = edit.newMode;
          } else if (edit.action === 'delete_segment') {
             visualPoints[i].isDeleted = true;
          }
        }
      }
    };

    overrides.forEach(applyEditToVisuals);
    deletes.forEach(applyEditToVisuals);

    // 3. Agrupar puntos contiguos que comparten el mismo estado visual
    let currentSegment: any[] = [];
    let currentMode = visualPoints[0].visualMode;
    let currentIsDeleted = visualPoints[0].isDeleted;

    const flushSegment = () => {
      if (currentSegment.length > 1) {
        // Añadir el último punto al nuevo segmento para que no haya huecos
        const latlngs = currentSegment.map(p => [p.lat, p.lng] as L.LatLngExpression);
        
        let color = this.MODE_COLORS[currentMode] || this.MODE_COLORS['original'];
        let weight = 4;
        let opacity = 0.8;
        let dashArray = '';

        if (currentIsDeleted) {
          color = '#9ca3af'; // Gris fantasma
          dashArray = '5, 10';
          opacity = 0.4;
          weight = 3;
        } else if (currentMode !== 'original') {
          weight = 5; // Un poco más grueso para destacar que ha sido cambiado
          opacity = 1;
        }

        L.polyline(latlngs, {
          color, weight, opacity, dashArray
        }).addTo(this.polylinesGroup!);
      }
    };

    for (let i = 0; i < visualPoints.length; i++) {
      const p = visualPoints[i];
      
      if (p.visualMode !== currentMode || p.isDeleted !== currentIsDeleted) {
        // Para que las líneas conecten, el segmento anterior debe terminar en el punto actual
        currentSegment.push(p); 
        flushSegment();
        currentSegment = [p];
        currentMode = p.visualMode;
        currentIsDeleted = p.isDeleted;
      } else {
        currentSegment.push(p);
      }
    }
    flushSegment(); // Último segmento

    // 4. Se ha eliminado el pintado manual heredado de replaces
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

    if (this.editorState === 'IDLE' || this.editorState === 'PREVIEW_INSERT') return;

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

    const SNAP_TOLERANCE_PX = 30;

    if (minPixelDist <= SNAP_TOLERANCE_PX) {
      if (this.editorState === 'SELECTING_A') {
        this.setInsertAnchorA(closestIdx);
      } else if (this.editorState === 'SELECTING_B') {
        this.setInsertAnchorB(closestIdx);
      } else if (this.editorState === 'SELECTING') {
        this.setAnchor(closestIdx);
      }
    } else {
      console.log('Clic demasiado lejos del trazado GPX.');
    }
  }

  private setAnchor(index: number) {
    if (!this.map) return;

    const p = this.gpxPoints[index];
    const anchor: TrackAnchor = {
      index: index,
      time: p.time ? p.time.toISOString() : undefined,
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
    if (this.markerA) { this.markerA.remove(); this.markerA = null; }
    if (this.markerB) { this.markerB.remove(); this.markerB = null; }
    if (this.highlightPolyline) { this.highlightPolyline.remove(); this.highlightPolyline = null; }
  }

  onDeleteSegment() {
    if (!this.anchorA || !this.anchorB) return;
    this.deleteRequest.emit({
      anchorA: this.anchorA,
      anchorB: this.anchorB
    });
    this.cleanupGeometryMode(); // Limpiar la selección de la interfaz visual
  }

  onOverrideMode() {
    if (!this.anchorA || !this.anchorB) return;

    // Extraer los puntos del track original entre A y B inclusive
    const startIndex = this.anchorA.index!;
    const endIndex = this.anchorB.index!;
    
    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
      console.warn('Índices inválidos para override mode');
      return;
    }

    const overriddenPoints = this.gpxPoints.slice(startIndex, endIndex + 1).map(p => ({
      lat: p.lat,
      lng: p.lng,
      time: p.time ? new Date(p.time).toISOString() : undefined,
      mode: this.selectedMode
    }));

    this.overrideModeRequest.emit({ points: overriddenPoints });

    // Limpiar selección
    this.cleanupGeometryMode();
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

  startInsertMode() {
    if (!this.map || this.gpxPoints.length === 0) return;
    this.clearSelection();
    this.cleanupAppendMode();
    this.cleanupGeometryMode();
    this.cleanupInsertMode();
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
    if (!this.insertAnchorA || !this.insertAnchorB || this.insertPoints.length === 0) return;

    const appliedMode = mode || this.selectedMode;

    const fullPointsArray = [
      { lat: this.insertAnchorA.lat, lng: this.insertAnchorA.lng, time: this.insertAnchorA.time, mode: appliedMode },
      ...this.insertPoints.map(p => ({ ...p, mode: appliedMode })),
      { lat: this.insertAnchorB.lat, lng: this.insertAnchorB.lng, time: this.insertAnchorB.time, mode: appliedMode }
    ];

    this.insertRequest.emit({
      points: fullPointsArray as any
    });

    this.cleanupInsertMode();
    this.editorState = 'SELECTING';
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ROUTING ASISTIDO (Fase 2.2)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /** Perfiles de routing soportados por OSRM */
  routingProfiles = [
    { id: 'driving', name: 'Coche', icon: '🚗' },
    { id: 'walking', name: 'A pie', icon: '🚶' },
    { id: 'cycling', name: 'Bici', icon: '🚲' }
  ];

  /** Transición desde el Panel de Decisión al dibujo manual */
  chooseManualDraw() {
    this.transitionToDrawingInsert();
  }

  /** Solicita ruta asistida al servicio OSRM */
  async requestAssistedRoute(profile: string) {
    if (!this.insertAnchorA || !this.insertAnchorB) return;
    if (this.routingService.isRequestInFlight) return; // mutex

    this.routingProfile = profile;
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
    // Omitimos el primero y el último porque saveInsert() ya reinyecta insertAnchorA y insertAnchorB
    const innerPoints = this.routingResult.points.slice(1, -1).map(p => ({
      lat: p.lat,
      lng: p.lng
    }));

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
  // MODO APPEND (Fase 2.1.a) — Aislado de los modos previos
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  startAppendMode() {
    if (!this.map || this.gpxPoints.length === 0) return;

    // Limpiar selección previa para evitar interferencia
    this.clearSelection();
    this.editorState = 'APPENDING';
    this.appendPoints = [];

    // Dibujar línea de append desde el último punto
    const lastPt = this.gpxPoints[this.gpxPoints.length - 1];
    this.appendLine = L.polyline(
      [[lastPt.lat, lastPt.lng]],
      {
        color: '#0d9488', // Teal-600 — diferenciado del rosa de replace y del indigo original
        weight: 5,
        dashArray: '12, 8',
        opacity: 0.9
      }
    ).addTo(this.map);

    // Marcador del punto de partida del append (para referencia visual)
    L.circleMarker([lastPt.lat, lastPt.lng], {
      color: '#0d9488',
      fillColor: '#0d9488',
      fillOpacity: 1,
      radius: 6,
      weight: 2
    }).addTo(this.map).bindTooltip('Inicio Append', { permanent: false, direction: 'right' });
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
}
