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
  @Input() mediaGroups: { lat: number, lng: number }[] = [];
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
  @Output() close = new EventEmitter<void>();

  // In-memory edits tracking
  pendingEdits: any[] = [];
  previewingEditId: string | null = null;

  private map: L.Map | null = null;
  private polylinesGroup: L.FeatureGroup | null = null;
  private highlightPolyline: L.Polyline | null = null;
  
  private markerA: L.CircleMarker | null = null;
  private markerB: L.CircleMarker | null = null;

  anchorA: TrackAnchor | null = null;
  anchorB: TrackAnchor | null = null;

  editorState: 'SELECTING' | 'EDITING_GEOMETRY' | 'APPENDING' | 'APPEND_SELECTING_B' | 'IDLE' | 'SELECTING_A' | 'SELECTING_B' | 'SELECTING_MODE' | 'DRAWING_INSERT' | 'PREVIEW_INSERT' | 'CALCULATING_ROUTE' | 'PREVIEW_ROUTE' | 'GET_LOCATION' = 'SELECTING';
  activeFlow: 'INSERT' | 'APPEND' | null = null;

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
      isDeleted: false,
      isHidden: false,
      isPreviewing: false
    }));

    // 2. Aplicar Edits EN MEMORIA para marcar el estado
    // Recorremos los pendingEdits locales en lugar de this.trackEdits
    const deletes = this.pendingEdits.filter(e => e.type === 'delete_segment');

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
          }
        }
      }
    };

    deletes.forEach(applyEditToVisuals);

    // 3. Agrupar puntos contiguos que comparten el mismo estado visual
    let currentSegment: any[] = [];
    let currentMode = visualPoints[0].visualMode;
    let currentIsDeleted = visualPoints[0].isDeleted;
    let currentIsHidden = visualPoints[0].isHidden;
    let currentIsPreviewing = visualPoints[0].isPreviewing;

    const flushSegment = () => {
      if (currentSegment.length > 1 && !currentIsHidden) {
        // Añadir el último punto al nuevo segmento para que no haya huecos
        const latlngs = currentSegment.map(p => [p.lat, p.lng] as L.LatLngExpression);
        
        let color = this.MODE_COLORS[currentMode] || this.MODE_COLORS['original'];
        let weight = 4;
        let opacity = 0.85;
        let dashArray = '';
        let smoothFactor = 1;
        let className = '';

        if (currentIsDeleted && currentIsPreviewing) {
          color = '#ff4444'; // Rojo fuerte para preview de borrado
          weight = 5;
          className = 'preview-blink';
        } else if (currentMode !== 'original') {
          weight = 5; // Un poco más grueso para destacar que ha sido cambiado
          opacity = 1;
        }

        L.polyline(latlngs, {
          color, weight, opacity, dashArray, smoothFactor, className
        }).addTo(this.polylinesGroup!);

        // Solo pintar flechas si no es un tramo fantasma
        if (!currentIsDeleted) {
          this.addDirectionArrows(L, latlngs, color, opacity);
        }
      }
    };

    for (let i = 0; i < visualPoints.length; i++) {
      const p = visualPoints[i];
      
      if (p.visualMode !== currentMode || p.isDeleted !== currentIsDeleted || p.isHidden !== currentIsHidden || p.isPreviewing !== currentIsPreviewing) {
        // Para que las líneas conecten, el segmento anterior debe terminar en el punto actual
        currentSegment.push(p); 
        flushSegment();
        currentSegment = [p];
        currentMode = p.visualMode;
        currentIsDeleted = p.isDeleted;
        currentIsHidden = p.isHidden;
        currentIsPreviewing = p.isPreviewing;
      } else {
        currentSegment.push(p);
      }
    }
    flushSegment(); // Último segmento

    // 4. Dibujar Prolongaciones (Appends) virtuales
    const appends = this.pendingEdits.filter(e => e.type === 'append_segment');
    let finalLat = this.gpxPoints[this.gpxPoints.length - 1].lat;
    let finalLng = this.gpxPoints[this.gpxPoints.length - 1].lng;

    appends.forEach((appendEdit, index) => {
      const isPreviewing = this.previewingEditId === appendEdit.id;
      const points = appendEdit.data.points;
      if (!points || points.length === 0) return;

      const latlngs = points.map((p: any) => [p.lat, p.lng] as L.LatLngExpression);
      
      const mode = points[0].mode || 'driving';
      let color = this.MODE_COLORS[mode] || '#0d9488';
      let weight = 5;
      let opacity = 1;
      let className = isPreviewing ? 'preview-blink' : '';

      L.polyline(latlngs, {
        color, weight, opacity, className, dashArray: '5, 5' // Línea punteada para indicar prolongación no guardada
      }).addTo(this.polylinesGroup!);
      
      this.addDirectionArrows(L, latlngs, color, opacity);

      const lastP = points[points.length - 1];
      finalLat = lastP.lat;
      finalLng = lastP.lng;
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

    if (this.editorState === 'GET_LOCATION') {
      const lat = e.latlng.lat.toFixed(6);
      const lng = e.latlng.lng.toFixed(6);
      const coordStr = `${lat}, ${lng}`;
      
      navigator.clipboard.writeText(coordStr).then(() => {
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
    this.pendingEdits = this.pendingEdits.filter(e => e.id !== editId);
    if (this.previewingEditId === editId) {
      this.previewingEditId = null;
    }
    this.drawBaseAndEdits();
  }

  emitSaveAllEdits(): void {
    this.saveAllEdits.emit(this.pendingEdits);
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

    if (this.activeFlow === 'APPEND') {
      const editId = Math.random().toString(36).substring(2, 9);
      this.pendingEdits.push({
        id: editId,
        type: 'append_segment',
        description: `${this.pendingEdits.length + 1} - Prolongación`,
        data: {
          points: fullPointsArray
        },
        isHidden: false // Los puntos añadidos sí se dibujan
      });
      this.drawBaseAndEdits();
    } else {
      this.insertRequest.emit({
        points: fullPointsArray as any
      });
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

    this.clearSelection();
    this.cleanupInsertMode();
    this.cleanupGeometryMode();

    this.activeFlow = 'APPEND';
    this.editorState = 'APPEND_SELECTING_B';

    // Para Append, siempre partimos del último punto (real o virtual de pendingEdits)
    const lastPt = this.getVirtualLastPoint();
    
    // Setear insertAnchorA al final (usamos un índice virtual -1 para indicar que es el final dinámico)
    this.insertAnchorA = { 
      index: -1, 
      time: undefined, 
      lat: lastPt.lat, 
      lng: lastPt.lng 
    };

    // Pintar marcador visual
    this.insertMarkerA = L.circleMarker([lastPt.lat, lastPt.lng], {
      color: 'white', fillColor: '#0d9488', fillOpacity: 1, radius: 8, weight: 2
    }).addTo(this.map).bindTooltip('Inicio Prolongación', { permanent: true, direction: 'right' }).openTooltip();
  }

  getVirtualLastPoint(): { lat: number, lng: number } {
    let lastPt = this.gpxPoints[this.gpxPoints.length - 1];
    
    // Si hay appends en memoria, cogemos el último punto de la última prolongación
    const appends = this.pendingEdits.filter(e => e.type === 'append_segment');
    if (appends.length > 0) {
      const lastAppend = appends[appends.length - 1];
      const pts = lastAppend.data.points;
      if (pts && pts.length > 0) {
        lastPt = pts[pts.length - 1];
      }
    }
    return { lat: lastPt.lat, lng: lastPt.lng };
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
}
