import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef, NgZone, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ViajesPrevistosService } from '../../../servicios/viajes-previstos.service';
import { ItinerarioService } from '../../../servicios/itinerario.service';
import { ActividadesItinerariosService } from '../../../servicios/actividades-itinerarios.service';
import { TrackEditorService } from '../../../servicios/track-editor.service';
import { GpxAnimationService } from '../../../servicios/gpx-animation.service';
import { ArchivoService } from '../../../servicios/archivo.service';

export interface PuntoGPXConModo {
  lat: number;
  lng: number;
  mode: string;
  isGap?: boolean;
  actividadId?: number;
}

@Component({
  selector: 'app-mapa-viaje-gpx',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './mapa-viaje-gpx.component.html',
  styleUrls: ['./mapa-viaje-gpx.component.scss']
})
export class MapaViajeGpxComponent implements OnInit, AfterViewInit, OnDestroy {
  viajeId!: number;
  viaje: any = null;

  // Estados de interfaz
  cargando = true;
  mensajeProgreso = 'Iniciando carga del viaje completo...';
  showSidePanel = true;
  activeSideTab: 'fotos' | 'estadisticas' = 'fotos';

  // Mapa Leaflet
  private mapaGPX: L.Map | null = null;
  private markersLayerGroup: L.LayerGroup | null = null;
  private polylinesLayerGroup: L.LayerGroup | null = null;

  // Datos de ruta y puntos
  coordenadasGPX: [number, number][] = [];
  puntosGPXConModo: PuntoGPXConModo[] = [];
  fotosViaje: any[] = [];

  // Cache y cola de geocodificación
  private direccionesCache: { [key: string]: string } = {};
  private nominatimQueue: Promise<void> = Promise.resolve();
  private readonly NOMINATIM_DELAY = 1100;

  // Estadísticas acumuladas del viaje
  estadisticasGPX: {
    distanciaKm: string;
    distanciaMetros: number;
    duracion: { formateada: string; segundos: number };
    velocidad: { media: string; maxima: string };
    energia: { calorias: number; pasos: number };
    tracking: { puntosGPS: number; totalActividades: number; totalItinerarios: number };
    desgloseTransporte: Array<{
      nombre: string;
      distanciaKm: string;
      distanciaMetros: number;
      duracionFormateada: string;
      duracionSegundos: number;
    }>;
    multimedia: { fotos: number; videos: number };
    tiempos: { enMarcha: string; parado: string; pausado: string };
  } = {
    distanciaKm: '0.00',
    distanciaMetros: 0,
    duracion: { formateada: '00:00:00', segundos: 0 },
    velocidad: { media: '0.0', maxima: '0.0' },
    energia: { calorias: 0, pasos: 0 },
    tracking: { puntosGPS: 0, totalActividades: 0, totalItinerarios: 0 },
    desgloseTransporte: [],
    multimedia: { fotos: 0, videos: 0 },
    tiempos: { enMarcha: '00:00:00', parado: '00:00:00', pausado: '00:00:00' }
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private viajesPrevistosService: ViajesPrevistosService,
    private itinerarioService: ItinerarioService,
    private actividadesService: ActividadesItinerariosService,
    private trackEditorService: TrackEditorService,
    private gpxAnimationService: GpxAnimationService,
    private archivoService: ArchivoService,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('viajeId');
    if (idParam) {
      this.viajeId = Number(idParam);
      this.cargarInfoViaje();
    } else {
      console.warn('⚠️ No se proporcionó viajeId en la ruta');
      this.volver();
    }
  }

  ngAfterViewInit(): void {
    if (this.viajeId) {
      this.cargarDatosCompletosViaje();
    }
  }

  ngOnDestroy(): void {
    this.limpiarMapa();
  }

  @HostListener('document:keydown.escape')
  onEscapePress(): void {
    this.volver();
  }

  volver(): void {
    this.limpiarMapa();
    this.router.navigate(['/viajes-previstos']);
  }

  private limpiarMapa(): void {
    if (this.mapaGPX) {
      this.mapaGPX.remove();
      this.mapaGPX = null;
    }
  }

  private async cargarInfoViaje(): Promise<void> {
    try {
      this.viaje = await firstValueFrom(this.viajesPrevistosService.obtenerViaje(this.viajeId));
    } catch (e) {
      console.warn('Error cargando info del viaje:', e);
    }
  }

  // ==========================================
  // CARGA Y AGREGACIÓN DE DATOS DEL VIAJE
  // ==========================================

  private async cargarDatosCompletosViaje(): Promise<void> {
    const viajeId = this.viajeId;
    try {
      this.cargando = true;
      this.mensajeProgreso = 'Cargando itinerarios del viaje...';
      this.cdr.detectChanges();

      // 1. Obtener todos los itinerarios del viaje
      const itinerarios = await firstValueFrom(this.itinerarioService.getItinerarios(viajeId));
      this.estadisticasGPX.tracking.totalItinerarios = itinerarios?.length || 0;

      // 2. Obtener todas las actividades de cada itinerario
      this.mensajeProgreso = 'Cargando actividades y rutas...';
      this.cdr.detectChanges();

      const todasActividades: any[] = [];
      if (itinerarios && itinerarios.length > 0) {
        for (const iti of itinerarios) {
          try {
            const acts = await firstValueFrom(this.actividadesService.getByItinerario(iti.id));
            if (acts && acts.length > 0) {
              todasActividades.push(...acts);
            }
          } catch (e) {
            console.warn(`Error al cargar actividades del itinerario ${iti.id}:`, e);
          }
        }
      }
      this.estadisticasGPX.tracking.totalActividades = todasActividades.length;

      // 3. Cargar archivos y asociados de todo el viaje
      this.mensajeProgreso = 'Sincronizando fotos y archivos del viaje...';
      this.cdr.detectChanges();

      let archivosViaje: any[] = [];
      try {
        archivosViaje = await firstValueFrom(this.archivoService.getArchivosPorViaje(viajeId));
      } catch (e) {
        console.warn('Error al cargar archivos por viaje:', e);
      }

      let archivosAsociados: any[] = [];
      try {
        archivosAsociados = await firstValueFrom(this.http.get<any[]>(`${environment.apiUrl}/archivos-asociados`));
      } catch (e) {
        console.warn('Error al cargar archivos asociados:', e);
      }

      // 4. Procesar GPX de cada actividad y concatenar con isGap entre actividades
      this.coordenadasGPX = [];
      this.puntosGPXConModo = [];

      let totalDistanciaMetros = 0;
      let totalSegundosEnMarcha = 0;
      let totalSegundosParado = 0;
      let totalSegundosPausado = 0;
      let maxVelocidadGlobal = 0;
      let totalCalorias = 0;
      let totalPasos = 0;
      const desgloseMap: { [modo: string]: { distanciaMetros: number; duracionSegundos: number } } = {};

      for (let idx = 0; idx < todasActividades.length; idx++) {
        const act = todasActividades[idx];
        this.mensajeProgreso = `Procesando ruta ${idx + 1} de ${todasActividades.length}: ${act.nombre || 'Actividad'}...`;
        this.cdr.detectChanges();

        // Obtener estadísticas de la actividad
        let actStats: any = null;
        try {
          actStats = await firstValueFrom(this.actividadesService.obtenerEstadisticas(act.id));
        } catch {
          // Continuar
        }

        if (actStats) {
          totalDistanciaMetros += (actStats.distancia?.metros || 0);
          totalCalorias += (actStats.energia?.calorias || 0);
          totalPasos += (actStats.energia?.pasos || 0);

          const velMax = parseFloat(actStats.velocidad?.maxima || '0');
          if (velMax > maxVelocidadGlobal) maxVelocidadGlobal = velMax;

          if (actStats.tiempos?.segundosEnMarcha) totalSegundosEnMarcha += actStats.tiempos.segundosEnMarcha;
          if (actStats.tiempos?.segundosParado) totalSegundosParado += actStats.tiempos.segundosParado;
          if (actStats.tiempos?.segundosPausado) totalSegundosPausado += actStats.tiempos.segundosPausado;
          if (actStats.duracion?.segundos && !actStats.tiempos?.segundosEnMarcha) {
            totalSegundosEnMarcha += actStats.duracion.segundos;
          }

          if (actStats.desgloseTransporte && Array.isArray(actStats.desgloseTransporte)) {
            for (const seg of actStats.desgloseTransporte) {
              const nombre = seg.nombre || 'Desconocido';
              const distM = (seg.distanciaKm ? parseFloat(seg.distanciaKm) * 1000 : (seg.distanciaMetros || 0));
              const durSec = this.parseDurationToSeconds(seg.duracionFormateada || seg.tiempoEmpleado || '00:00:00');

              if (!desgloseMap[nombre]) {
                desgloseMap[nombre] = { distanciaMetros: 0, duracionSegundos: 0 };
              }
              desgloseMap[nombre].distanciaMetros += distM;
              desgloseMap[nombre].duracionSegundos += durSec;
            }
          }
        }

        // Obtener GPX canónico de la actividad
        let gpxXml: string | null = null;
        try {
          gpxXml = await firstValueFrom(
            this.trackEditorService.resolveCanonicalGpxXml(act.id, { flattenSegments: true })
          );
        } catch {
          try {
            const blob = await firstValueFrom(this.actividadesService.obtenerGPX(act.id));
            gpxXml = await blob.text();
          } catch {
            gpxXml = null;
          }
        }

        if (gpxXml) {
          const puntosAct = this.parseGpxXml(gpxXml, act, actStats);
          if (puntosAct.length > 0) {
            if (this.puntosGPXConModo.length > 0) {
              puntosAct[0].isGap = true;
            }
            this.puntosGPXConModo.push(...puntosAct);
            for (const p of puntosAct) {
              this.coordenadasGPX.push([p.lat, p.lng]);
            }
          }
        }
      }

      // 5. Finalizar cálculo de estadísticas agregadas
      const totalSegundosGlobal = totalSegundosEnMarcha + totalSegundosParado;
      const totalKmGlobal = (totalDistanciaMetros / 1000);
      const horasGlobal = totalSegundosEnMarcha > 0 ? (totalSegundosEnMarcha / 3600) : (totalSegundosGlobal / 3600);
      const velMediaGlobal = horasGlobal > 0 ? (totalKmGlobal / horasGlobal).toFixed(1) : '0.0';

      const desgloseArray = Object.keys(desgloseMap).map(nombre => ({
        nombre,
        distanciaMetros: desgloseMap[nombre].distanciaMetros,
        distanciaKm: (desgloseMap[nombre].distanciaMetros / 1000).toFixed(2),
        duracionSegundos: desgloseMap[nombre].duracionSegundos,
        duracionFormateada: this.formatSecondsToDuration(desgloseMap[nombre].duracionSegundos)
      }));

      const multimediaFotos = (archivosViaje || []).filter(f => f.tipo === 'foto' || f.tipo === 'imagen').length;
      const multimediaVideos = (archivosViaje || []).filter(f => f.tipo === 'video').length;

      this.estadisticasGPX = {
        distanciaKm: totalKmGlobal.toFixed(2),
        distanciaMetros: Math.round(totalDistanciaMetros),
        duracion: {
          formateada: this.formatSecondsToDuration(totalSegundosGlobal),
          segundos: totalSegundosGlobal
        },
        velocidad: {
          media: velMediaGlobal,
          maxima: maxVelocidadGlobal > 0 ? maxVelocidadGlobal.toFixed(1) : '0.0'
        },
        energia: {
          calorias: totalCalorias,
          pasos: totalPasos
        },
        tracking: {
          puntosGPS: this.puntosGPXConModo.length,
          totalActividades: todasActividades.length,
          totalItinerarios: itinerarios?.length || 0
        },
        desgloseTransporte: desgloseArray,
        multimedia: {
          fotos: multimediaFotos,
          videos: multimediaVideos
        },
        tiempos: {
          enMarcha: this.formatSecondsToDuration(totalSegundosEnMarcha),
          parado: this.formatSecondsToDuration(totalSegundosParado),
          pausado: this.formatSecondsToDuration(totalSegundosPausado)
        }
      };

      // 6. Procesar fotos y marcadores
      this.procesarArchivosYMarcadores(archivosViaje, archivosAsociados);

      this.cargando = false;
      this.cdr.detectChanges();

      // 7. Inicializar mapa Leaflet
      setTimeout(() => {
        this.inicializarMapaLeaflet();
      }, 100);

    } catch (error) {
      console.error('❌ Error al cargar datos completos del viaje:', error);
      this.cargando = false;
      this.cdr.detectChanges();
    }
  }

  // ==========================================
  // PARSEO DE GPX Y TRANSPORTE
  // ==========================================

  private parseGpxXml(gpxText: string, actividad: any, estadisticas: any): PuntoGPXConModo[] {
    const puntos: PuntoGPXConModo[] = [];
    try {
      const parser = new DOMParser();
      const gpxDoc = parser.parseFromString(gpxText, 'text/xml');
      const trkpts = gpxDoc.getElementsByTagName('trkpt');

      let lastKnownMode = 'walking';
      let hasXmlTransportModes = false;

      for (let i = 0; i < trkpts.length; i++) {
        const lat = parseFloat(trkpts[i].getAttribute('lat') || '0');
        const lon = parseFloat(trkpts[i].getAttribute('lon') || '0');

        if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
          const modeEl = trkpts[i].getElementsByTagName('transportMode')[0] ||
            trkpts[i].getElementsByTagName('profileId')[0] ||
            trkpts[i].getElementsByTagName('mode')[0] ||
            trkpts[i].getElementsByTagName('profileName')[0];

          if (modeEl && modeEl.textContent) {
            lastKnownMode = modeEl.textContent.toLowerCase();
            hasXmlTransportModes = true;
          }

          const isGapEl = trkpts[i].getElementsByTagName('isGap')[0];
          const isGapExplicit = isGapEl ? isGapEl.textContent === 'true' : false;
          const parentSeg = trkpts[i].parentElement;
          const isFirstInTrkseg = parentSeg && parentSeg.tagName === 'trkseg' && parentSeg.firstElementChild === trkpts[i];
          const isGap = (i > 0 && isFirstInTrkseg) || isGapExplicit;

          puntos.push({
            lat,
            lng: lon,
            mode: lastKnownMode,
            isGap: isGap || undefined,
            actividadId: actividad.id
          });
        }
      }

      const desglose = estadisticas?.desgloseTransporte;
      if (desglose && Array.isArray(desglose) && desglose.length > 0) {
        const parsedPoints = this.gpxAnimationService.parseGpx(gpxText);
        if (parsedPoints && parsedPoints.length > 0) {
          const mappedPoints = this.gpxAnimationService.applyTransportSegments(parsedPoints, desglose);
          return mappedPoints.map((p, idx) => ({
            lat: p.lat,
            lng: p.lng,
            mode: p.mode || 'walking',
            isGap: p.isGap || (idx === 0 ? puntos[0]?.isGap : undefined),
            actividadId: actividad.id
          }));
        }
      } else if (!hasXmlTransportModes && puntos.length > 0) {
        const perfil = (estadisticas?.tracking?.perfilTransporte || actividad?.perfilTransporte || actividad?.nombre || '').toLowerCase();
        let modeNorm = 'walking';
        if (perfil.includes('coche') || perfil.includes('car') || perfil.includes('auto') || perfil.includes('moto') || perfil.includes('taxi')) {
          modeNorm = 'driving';
        } else if (perfil.includes('barco') || perfil.includes('boat') || perfil.includes('ship') || perfil.includes('ferry') || perfil.includes('crucero')) {
          modeNorm = 'boat';
        } else if (perfil.includes('bici') || perfil.includes('cycl') || perfil.includes('bicycle')) {
          modeNorm = 'cycling';
        } else if (perfil.includes('bus') || perfil.includes('autobus') || perfil.includes('tren') || perfil.includes('metro')) {
          modeNorm = 'bus';
        } else if (perfil.includes('run') || perfil.includes('corr')) {
          modeNorm = 'running';
        }

        if (modeNorm !== 'walking') {
          puntos.forEach(p => p.mode = modeNorm);
        }
      }

    } catch (e) {
      console.error('Error al parsear GPX de actividad:', e);
    }
    return puntos;
  }

  // ==========================================
  // INICIALIZACIÓN DEL MAPA LEAFLET
  // ==========================================

  private inicializarMapaLeaflet(): void {
    const container = document.getElementById('mapa-viaje-gpx-fullscreen');
    if (!container) return;

    if (this.mapaGPX) {
      this.mapaGPX.remove();
      this.mapaGPX = null;
    }
    container.innerHTML = '';

    const initialCenter: [number, number] = this.coordenadasGPX.length > 0
      ? this.coordenadasGPX[0]
      : [40.4168, -3.7038];

    this.mapaGPX = L.map(container, {
      attributionControl: true,
      zoomControl: true,
      preferCanvas: true
    }).setView(initialCenter, 12);

    // Capas Base
    const satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles &copy; Esri', maxZoom: 18 }
    );
    const streets = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '&copy; OpenStreetMap', maxZoom: 19 }
    );

    satellite.addTo(this.mapaGPX);

    const layersControl = L.control.layers(
      { 'Satélite': satellite, 'Mapa': streets },
      {},
      { position: 'topleft' }
    ).addTo(this.mapaGPX);

    const layersContainer = layersControl.getContainer();
    if (layersContainer) {
      layersContainer.classList.add('capas-medio-izq');
    }

    this.polylinesLayerGroup = L.layerGroup().addTo(this.mapaGPX);
    this.markersLayerGroup = L.layerGroup().addTo(this.mapaGPX);

    this.dibujarRutaPorTransporte();
    this.addDirectionArrows(this.coordenadasGPX);
    this.pintarMarcadoresFotos();

    if (this.coordenadasGPX.length > 0) {
      const bounds = L.latLngBounds(this.coordenadasGPX);
      this.mapaGPX.fitBounds(bounds, { padding: [50, 50] });
    }

    setTimeout(() => {
      if (this.mapaGPX) this.mapaGPX.invalidateSize();
    }, 200);
  }

  private dibujarRutaPorTransporte(): void {
    if (!this.mapaGPX || !this.polylinesLayerGroup || this.puntosGPXConModo.length === 0) return;

    const modeColors: { [key: string]: string } = {
      walking: '#059669', walk: '#059669', caminar: '#059669', andando: '#059669',
      driving: '#DC2626', car: '#DC2626', coche: '#DC2626', auto: '#DC2626', vehiculo: '#DC2626', moto: '#DC2626', taxi: '#DC2626',
      cycling: '#FF9800', bici: '#FF9800', bicycle: '#FF9800', bicicleta: '#FF9800',
      running: '#2196F3', correr: '#2196F3',
      bus: '#9C27B0', autobus: '#9C27B0', autocar: '#9C27B0', tren: '#9C27B0', metro: '#9C27B0',
      boat: '#0284C7', barco: '#0284C7', ship: '#0284C7', ferry: '#0284C7', crucero: '#0284C7', kayak: '#0284C7', canoa: '#0284C7',
      transport: '#9E9E9E'
    };

    const getModeColor = (rawMode: string): string => {
      const m = (rawMode || '').toLowerCase();
      if (m.includes('walk') || m.includes('camin') || m.includes('andan') || m.includes('pie') || m.includes('hiking')) return modeColors['walking'];
      if (m.includes('car') || m.includes('coch') || m.includes('driv') || m.includes('auto') || m.includes('vehic') || m.includes('moto') || m.includes('taxi')) return modeColors['driving'];
      if (m.includes('bic') || m.includes('cycl')) return modeColors['cycling'];
      if (m.includes('run') || m.includes('corr')) return modeColors['running'];
      if (m.includes('bus') || m.includes('autobus') || m.includes('tren') || m.includes('metro') || m.includes('train')) return modeColors['bus'];
      if (m.includes('boat') || m.includes('barco') || m.includes('ship') || m.includes('ferry') || m.includes('crucero') || m.includes('kayak') || m.includes('canoa')) return modeColors['boat'];
      return modeColors['transport'];
    };

    let currentSegment: [number, number][] = [];
    let currentMode = this.puntosGPXConModo[0].mode;

    const drawSegment = (coords: [number, number][], mode: string) => {
      if (coords.length < 2) return;
      const color = getModeColor(mode);

      L.polyline(coords, {
        color: '#FFFFFF',
        weight: 7,
        opacity: 0.7,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(this.polylinesLayerGroup!);

      L.polyline(coords, {
        color,
        weight: 4,
        opacity: 0.9,
        smoothFactor: 1,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(this.polylinesLayerGroup!);
    };

    for (let i = 0; i < this.puntosGPXConModo.length; i++) {
      const pt = this.puntosGPXConModo[i];
      const ptCoords: [number, number] = [pt.lat, pt.lng];

      if (pt.isGap || pt.mode !== currentMode) {
        if (pt.isGap) {
          drawSegment(currentSegment, currentMode);
          currentMode = pt.mode;
          currentSegment = [ptCoords];
        } else {
          currentSegment.push(ptCoords);
          drawSegment(currentSegment, currentMode);
          currentMode = pt.mode;
          currentSegment = [ptCoords];
        }
      } else {
        currentSegment.push(ptCoords);
      }
    }

    if (currentSegment.length > 0) {
      drawSegment(currentSegment, currentMode);
    }

    // Marcadores de Inicio y Fin
    if (this.coordenadasGPX.length > 0) {
      const inicioIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color: #4CAF50; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });
      L.marker(this.coordenadasGPX[0], { icon: inicioIcon }).bindPopup('🚩 Inicio del Viaje').addTo(this.polylinesLayerGroup);

      const finIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color: #F44336; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });
      L.marker(this.coordenadasGPX[this.coordenadasGPX.length - 1], { icon: finIcon }).bindPopup('🏁 Fin del Viaje').addTo(this.polylinesLayerGroup);
    }
  }

  private addDirectionArrows(coordinates: [number, number][], color: string = '#FF0000', opacity: number = 1): void {
    if (!this.mapaGPX || !this.polylinesLayerGroup || coordinates.length < 2) return;

    const totalPoints = coordinates.length;
    const interval = Math.max(Math.floor(totalPoints / 8), 60);

    for (let i = interval; i < coordinates.length; i += interval) {
      const prevPoint = coordinates[i - 1];
      const currentPoint = coordinates[i];
      const angle = this.calculateAngle(prevPoint, currentPoint);

      const arrowIcon = L.divIcon({
        className: 'direction-arrow-svg',
        html: `
          <svg width="16" height="16" viewBox="0 0 32 32" style="transform: rotate(${angle}deg); filter: drop-shadow(0 1px 1px rgba(0,0,0,0.3)); opacity: ${opacity * 0.5};">
            <path d="M 6 24 L 16 8 L 26 24" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M 6 24 L 16 8 L 26 24" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        `,
        iconSize: [16, 16],
        iconAnchor: [8, 12]
      });

      L.marker(currentPoint, {
        icon: arrowIcon,
        interactive: false,
        keyboard: false,
        zIndexOffset: 1000
      }).addTo(this.polylinesLayerGroup);
    }
  }

  private calculateAngle(pointA: number[], pointB: number[]): number {
    const lat1 = pointA[0] * Math.PI / 180;
    const lng1 = pointA[1] * Math.PI / 180;
    const lat2 = pointB[0] * Math.PI / 180;
    const lng2 = pointB[1] * Math.PI / 180;
    const dLng = lng2 - lng1;

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
  }

  // ==========================================
  // MULTIMEDIA Y MARCADORES EN EL MAPA
  // ==========================================

  private procesarArchivosYMarcadores(archivos: any[], asociados: any[]): void {
    const multimedia = (archivos || []).filter(f =>
      (f.tipo === 'foto' || f.tipo === 'video' || f.tipo === 'imagen') && f.geolocalizacion
    );

    multimedia.sort((a, b) => {
      const timeA = new Date(a.timestampReal || a.fechaCaptura || a.fechaCreacion || 0).getTime();
      const timeB = new Date(b.timestampReal || b.fechaCaptura || b.fechaCreacion || 0).getTime();
      return timeA - timeB;
    });

    const audiosPorArchivo: { [archivoId: number]: string } = {};
    (asociados || []).forEach(asoc => {
      if (asoc.tipo === 'audio' && asoc.archivoId) {
        audiosPorArchivo[asoc.archivoId] = asoc.rutaArchivo;
      }
    });

    multimedia.forEach((item, index) => {
      item.numeroSecuencial = index + 1;
      if (audiosPorArchivo[item.id]) {
        item.audioAsociado = audiosPorArchivo[item.id];
      }
    });

    this.fotosViaje = multimedia;
  }

  private pintarMarcadoresFotos(): void {
    if (!this.mapaGPX || !this.markersLayerGroup || !this.fotosViaje.length) return;

    this.markersLayerGroup.clearLayers();

    const grupos: { [key: string]: any[] } = {};
    const UMBRAL = 0.0001; // ~10 metros

    this.fotosViaje.forEach(foto => {
      let lat = 0;
      let lng = 0;

      if (typeof foto.geolocalizacion === 'string') {
        try {
          if (foto.geolocalizacion.includes('{')) {
            const parsed = JSON.parse(foto.geolocalizacion);
            lat = parsed.latitud ?? parsed.latitude;
            lng = parsed.longitud ?? parsed.longitude;
          } else if (foto.geolocalizacion.includes(',')) {
            const parts = foto.geolocalizacion.split(',');
            lat = parseFloat(parts[0]);
            lng = parseFloat(parts[1]);
          }
        } catch {
          return;
        }
      } else if (typeof foto.geolocalizacion === 'object' && foto.geolocalizacion !== null) {
        lat = foto.geolocalizacion.latitud ?? foto.geolocalizacion.latitude;
        lng = foto.geolocalizacion.longitud ?? foto.geolocalizacion.longitude;
      }

      if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
        let grupoEncontrado = false;
        for (const clave in grupos) {
          const [gLat, gLng] = clave.split(',').map(parseFloat);
          if (Math.abs(gLat - lat) < UMBRAL && Math.abs(gLng - lng) < UMBRAL) {
            grupos[clave].push({ archivo: foto, lat, lng });
            grupoEncontrado = true;
            break;
          }
        }
        if (!grupoEncontrado) {
          const clave = `${lat},${lng}`;
          grupos[clave] = [{ archivo: foto, lat, lng }];
        }
      }
    });

    for (const clave in grupos) {
      const items = grupos[clave];
      const primerItem = items[0];
      const primerArchivo = primerItem.archivo;
      const tieneMultiples = items.length > 1;
      const numeroSecuencial = primerArchivo.numeroSecuencial || 1;
      const thumbUrl = this.getThumbnailUrl(primerArchivo);

      const htmlBadge = `
        <div class="photo-marker-pin" style="position: relative; width: 44px; height: 44px; cursor: pointer; transition: transform 0.2s;">
          <img src="${thumbUrl}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.4);" />
          <span style="position: absolute; top: -4px; right: -4px; background: #3b82f6; color: white; border-radius: 10px; padding: 1px 5px; font-size: 10px; font-weight: bold; border: 1px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3);">
            #${numeroSecuencial}${tieneMultiples ? ` (${items.length})` : ''}
          </span>
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'custom-photo-marker-div',
        html: htmlBadge,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      });

      const marker = L.marker([primerItem.lat, primerItem.lng], { icon: customIcon });
      const popupHtml = this.crearPopupContent(items, numeroSecuencial, items.length, tieneMultiples);

      marker.bindPopup(popupHtml, {
        maxWidth: 420,
        className: 'custom-leaflet-popup'
      });

      marker.on('popupopen', () => {
        items.forEach(it => {
          this.resolverDireccionParaPopup(it.archivo);
        });
      });

      marker.addTo(this.markersLayerGroup);

      items.forEach(it => {
        it.archivo.marcadorRef = marker;
      });
    }
  }

  private crearPopupContent(archivos: any[], numeroSecuencial: number, cantidadArchivos: number, tieneMultiples: boolean): string {
    let popupContent = `
      <div class="photo-popup-custom" style="width: 320px; min-width: 250px; max-width: 500px; font-family: sans-serif; display: flex; flex-direction: column;">
        <div class="photo-popup-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="background: #3b82f6; color: white; border-radius: 4px; padding: 2px 6px; font-size: 12px; font-weight: bold;">#${numeroSecuencial}</span>
            <strong style="font-size: 14px; color: #334155;">${tieneMultiples ? `${cantidadArchivos} archivos` : 'Vista previa'}</strong>
          </div>
        </div>
        <div class="photo-popup-body" style="display: flex; flex-direction: column; gap: 12px; max-height: 45vh; overflow-y: auto; padding-right: 5px;">
    `;

    archivos.forEach(item => {
      const archivo = item.archivo;
      const esVid = this.esVideo(archivo);
      const thumbUrl = this.getThumbnailUrl(archivo);

      const audioTag = archivo.audioAsociado ? `
        <div style="margin-top: 6px; width: 100%;">
          <audio controls src="${environment.apiUrl}/uploads/${archivo.audioAsociado}" style="height: 24px; width: 100%;"></audio>
        </div>
      ` : '';

      const locationTag = `<div id="lugar-popup-${archivo.id}" style="font-size: 11px; color: #64748b; margin-top: 4px;"><i class="fa fa-map-marker"></i> <span class="lugar-texto">Cargando ubicación...</span></div>`;
      const dateTag = archivo.fechaCreacion ? `<div style="font-size: 11px; color: #94a3b8; margin-top: 2px;"><i class="fa fa-clock-o"></i> ${new Date(archivo.timestampReal || archivo.fechaCreacion).toLocaleString()}</div>` : '';
      const descTag = archivo.descripcion ? `<div style="font-size: 12px; color: #475569; margin-top: 6px; font-style: italic;">"${archivo.descripcion}"</div>` : '';

      const mediaTag = esVid
        ? `<video src="${thumbUrl}#t=0.1" preload="metadata" muted playsinline style="width: 100px; height: 75px; object-fit: cover; border-radius: 6px; border: 2px solid #e2e8f0;"></video>`
        : `<img src="${thumbUrl}" style="width: 100px; height: 75px; object-fit: cover; border-radius: 6px; border: 2px solid #e2e8f0;" />`;

      popupContent += `
        <div class="archivo-item-popup" style="display: flex; gap: 10px; padding: 6px; background: #f8fafc; border-radius: 8px;">
          <div style="position: relative; flex-shrink: 0;">
            ${mediaTag}
          </div>
          <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; overflow: hidden;">
            <strong style="font-size: 12px; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${archivo.nombreArchivo}">${archivo.nombreArchivo}</strong>
            ${locationTag}
            ${dateTag}
            ${descTag}
          </div>
        </div>
        ${audioTag}
      `;
    });

    popupContent += `
        </div>
      </div>
    `;
    return popupContent;
  }

  private async resolverDireccionParaPopup(archivo: any): Promise<void> {
    if (!archivo || !archivo.geolocalizacion) return;
    const direccion = await this.obtenerDireccion(archivo.geolocalizacion);
    const elem = document.getElementById(`lugar-popup-${archivo.id}`);
    if (elem) {
      const span = elem.querySelector('.lugar-texto');
      if (span) span.textContent = direccion;
    }
  }

  private async obtenerDireccion(geolocalizacion: string | any): Promise<string> {
    const geoStr = typeof geolocalizacion === 'string' ? geolocalizacion : JSON.stringify(geolocalizacion);
    if (!geoStr || geoStr === 'No disponible') return 'Ubicación no disponible';
    if (this.direccionesCache[geoStr]) return this.direccionesCache[geoStr];

    try {
      let lat: number, lon: number;
      if (geoStr.includes('{')) {
        const coords = JSON.parse(geoStr);
        lat = coords.latitud ?? coords.latitude;
        lon = coords.longitud ?? coords.longitude;
      } else if (geoStr.includes(',')) {
        [lat, lon] = geoStr.split(',').map(parseFloat);
      } else {
        return 'Formato inválido';
      }

      if (isNaN(lat) || isNaN(lon)) return 'Coordenadas inválidas';

      this.nominatimQueue = this.nominatimQueue.then(() =>
        new Promise(resolve => setTimeout(resolve, this.NOMINATIM_DELAY))
      );
      await this.nominatimQueue;

      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'TravelMemoryApp/1.0', 'Accept-Language': 'es' }
      });
      if (!res.ok) {
        const fallback = `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;
        this.direccionesCache[geoStr] = fallback;
        return fallback;
      }

      const data = await res.json();
      const addr = data.address || {};
      let direccion = [addr.road, addr.house_number, addr.suburb, addr.city || addr.town || addr.village, addr.state, addr.country]
        .filter(Boolean)
        .join(', ');

      if (!direccion && data.display_name) direccion = data.display_name;
      if (!direccion) direccion = `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;

      this.direccionesCache[geoStr] = direccion;
      return direccion;
    } catch {
      return 'Ubicación no disponible';
    }
  }

  // ==========================================
  // MÉTODOS PÚBLICOS DE INTERACCIÓN UI
  // ==========================================

  centrarEnFoto(foto: any): void {
    if (foto.marcadorRef && this.mapaGPX) {
      if (this.coordenadasGPX && this.coordenadasGPX.length > 0) {
        const bounds = L.latLngBounds(this.coordenadasGPX);
        this.mapaGPX.fitBounds(bounds, { padding: [50, 50] });
      }
      const popup = foto.marcadorRef.getPopup();
      if (popup) {
        popup.options.autoPan = false;
      }
      foto.marcadorRef.openPopup();
    }
  }

  fitMapToTrack(): void {
    if (!this.mapaGPX || this.coordenadasGPX.length === 0) return;
    const bounds = L.latLngBounds(this.coordenadasGPX);
    this.mapaGPX.fitBounds(bounds, { padding: [50, 50], animate: true });
  }

  toggleSidePanel(): void {
    this.showSidePanel = !this.showSidePanel;
    if (this.mapaGPX) {
      setTimeout(() => {
        this.mapaGPX?.invalidateSize(true);
      }, 300);
    }
  }

  getThumbnailUrl(foto: any): string {
    return `${environment.apiUrl}/uploads/${foto.rutaArchivo}`;
  }

  esVideo(foto: any): boolean {
    if (foto.tipo === 'video') return true;
    if (!foto.rutaArchivo) return false;
    const ext = foto.rutaArchivo.split('.').pop()?.toLowerCase();
    return ['mp4', 'mov', 'avi', 'webm'].includes(ext);
  }

  formatDistance(meters: number): string {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  }

  formatSecondsToDuration(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = Math.floor(totalSeconds % 60);
    if (hours > 0) {
      return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  private parseDurationToSeconds(durationStr: string): number {
    if (!durationStr) return 0;
    const parts = durationStr.split(':').map(p => parseFloat(p) || 0);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }
}
