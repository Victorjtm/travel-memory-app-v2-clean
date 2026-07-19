import { Component, OnInit, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { take } from 'rxjs/operators';
import { GpxAnimationComponent } from '../../../componentes/reproductor-animado-gpx/gpx-animation.component';
import { TrackEditorMapComponent } from '../../../componentes/track-editor-map/track-editor-map.component';
import { TrackEditorService } from '../../../servicios/track-editor.service';
import { TrackEdit } from '../../../modelos/track-edit.model';

import { Actividad } from '../../../modelos/actividad.model';
import { ActividadesItinerariosService } from '../../../servicios/actividades-itinerarios.service';
import { environment } from '../../../../environments/environment';
import { GpxAnimationService, GpxPoint } from '../../../servicios/gpx-animation.service';
import { VideoGeneratorService, ConfiguracionVideo, ProgresoVideo } from '../../../servicios/video-generator.service';
import { ArchivoService } from '../../../servicios/archivo.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-actividades-itinerarios',
  standalone: true,
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    RouterModule,
    GpxAnimationComponent,
    TrackEditorMapComponent
  ],
  templateUrl: './actividades-itinerarios.component.html',
  styleUrls: ['./actividades-itinerarios.component.scss']
})
export class ActividadesItinerariosComponent implements OnInit {

  actividades: Actividad[] = [];
  viajePrevistoId!: number;
  itinerarioId!: number;

  // ✨ PROPIEDADES PARA MODALES
  mostrarModalGPX = false;
  mostrarModalMapa = false;
  mostrarModalEstadisticas = false;
  mostrarModalGPXMapa = false;
  mostrarReproductorAnimado = false; // ✨ NUEVA PROPIEDAD

  urlMapaDataURL: string | null = null;
  fotosActividad: any[] = [];
  estadisticasActuales: any = null;
  actividadSeleccionada: number | null = null;

  // ✨ ESTADOS PARA CONFIGURACION DE VIDEO GPX
  generandoVideo = false;
  progresoVideo: ProgresoVideo | null = null;
  mostrarConfiguracionVideo = false;
  configuracionVideo: ConfiguracionVideo | null = null;
  actividadVideoSeleccionada: any = null;

  // ✨ PROPIEDADES PARA MAPA GPX
  mapaGPX: any = null;
  coordenadasGPX: any[] = [];

  // ✅ NUEVAS PROPIEDADES: Panel de estadísticas
  showSidePanel = true;
  activeSideTab: 'fotos' | 'estadisticas' = 'fotos';
  panelExpanded = false;
  trackSegments: any[] = [];
  turningPoint: any = null;

  // ✅ NUEVAS PROPIEDAD: Estadísticas completas para el panel
  estadisticasGPX: {
    distanciaKm?: string;
    distanciaMetros?: number;
    duracion?: { formateada?: string; segundos?: number };
    velocidad?: { media?: string; maxima?: string; minima?: string };
    energia?: { calorias?: number; pasos?: number };
    tracking?: { puntosGPS?: number; perfilTransporte?: string };
    transportePrincipal?: { icono?: string; nombre?: string };
    desgloseTransporte?: Array<{
      nombre?: string;
      distanciaKm?: string;
      duracionFormateada?: string;
    }>;
    fecha?: string;
    horario?: { inicio?: string; fin?: string };
    tiempoPausaSegundos?: number;
    tieneIdaVuelta?: boolean;
    distanciaIdaMetros?: number;
    distanciaVueltaMetros?: number;
    tiempoIdaFormateado?: string;
    tiempoVueltaFormateado?: string;
    altitud?: { min?: number, max?: number, ganancia?: number, perdida?: number };
    cadencia?: number;
    zancada?: number;
    multimedia?: { fotos?: number, videos?: number };
    tiempos?: { enMarcha?: string, parado?: string, pausado?: string };
  } = {
      distanciaKm: '0.00',
      distanciaMetros: 0,
      duracion: { formateada: '00:00:00', segundos: 0 },
      velocidad: { media: '0.0', maxima: '0.0', minima: '0.0' },
      energia: { calorias: 0, pasos: 0 },
      tracking: { puntosGPS: 0, perfilTransporte: '' },
      desgloseTransporte: [],
      horario: { inicio: '', fin: '' },
      tiempoPausaSegundos: 0,
      tieneIdaVuelta: false,
      distanciaIdaMetros: 0,
      distanciaVueltaMetros: 0,
      tiempoIdaFormateado: '00:00:00',
      tiempoVueltaFormateado: '00:00:00',
      altitud: { min: 0, max: 0, ganancia: 0, perdida: 0 },
      cadencia: 0,
      zancada: 0,
      multimedia: { fotos: 0, videos: 0 },
      tiempos: { enMarcha: '00:00:00', parado: '00:00:00', pausado: '00:00:00' }
    };

  // ✨ NUEVAS PROPIEDADES PARA ANIMACIÓN
  gpxTextAnimacion: string = '';
  multimediaAnimacion: any[] = [];
  desgloseTransporteAnimacion: any[] = [];
  actividadAnimacion: any = null; // ✨ NUEVA PROPIEDAD

  // ? ESTADOS PARA TRACK EDITOR (Fase 1 y 2)
  mostrarEditorTrack = false;
  gpxPointsEditor: GpxPoint[] = [];
  editsEditor: TrackEdit[] = [];
  actividadEditorId: number | null = null;

  // ✨ MODO ALTA FIDELIDAD (visual_session.json)
  visualSessionData: any = null;
  isHighFidelityMode = false;
  private visualSessionGroup: any = null;

  // ✅ COLORES POR MODO DE TRANSPORTE (Fallback GPX)
  private readonly MODE_COLORS = {
    walking: { outbound: '#059669', return: '#6EE7B7' },
    running: { outbound: '#2563EB', return: '#93C5FD' },
    cycling: { outbound: '#D97706', return: '#FCD34D' },
    driving: { outbound: '#DC2626', return: '#FCA5A5' }
  };

  // Paleta de colores directa por nombre de modo (idéntica a GpxAnimationComponent)
  private readonly MODE_COLORS_DIRECT: { [key: string]: string } = {
    walking: '#4CAF50', walk: '#4CAF50', caminar: '#4CAF50', andando: '#4CAF50',
    driving: '#F44336', car: '#F44336', coche: '#F44336',
    cycling: '#FF9800', bicycle: '#FF9800', bici: '#FF9800',
    running: '#2196F3', correr: '#2196F3',
    bus: '#9C27B0', autobus: '#9C27B0',
    transport: '#9E9E9E', transporte: '#9E9E9E'
  };

  // ✨ CACHÉ DE DIRECCIONES PARA LEAFLET (Fase 4 - Bloque C)
  private direccionesCache: { [key: string]: string } = {};
  private nominatimQueue: Promise<any> = Promise.resolve();
  private readonly NOMINATIM_DELAY = 2000;

  constructor(
    private actividadService: ActividadesItinerariosService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    private http: HttpClient,
    private gpxAnimationService: GpxAnimationService,
    private videoGeneratorService: VideoGeneratorService,
    private archivoService: ArchivoService,
    private trackEditorService: TrackEditorService
  ) { }

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const viajeId = params.get('viajePrevistoId');
      const itinId = params.get('itinerarioId');
      if (viajeId && itinId) {
        this.viajePrevistoId = +viajeId;
        this.itinerarioId = +itinId;
        this.cargarActividades();
      }
    });
  }

  cargarActividades(): void {
    if (!this.viajePrevistoId || !this.itinerarioId) return;

    this.actividadService.getByViajeYItinerario(this.viajePrevistoId, this.itinerarioId)
      .subscribe({
        next: actividades => {
          console.log('Actividades cargadas:', actividades);
          this.actividades = actividades;
          console.log('Número de actividades:', this.actividades.length);
        },
        error: err => console.error('Error cargando actividades:', err)
      });
  }

  // ==========================================
  // ✨ CONFIGURACIÓN Y GENERACIÓN DE VÍDEO GPX
  // ==========================================

  abrirConfiguracionVideo(actividad: any): void {
    this.actividadVideoSeleccionada = actividad;
    this.configuracionVideo = {
      duracionPorFoto: 3,
      tipoTransicion: 'fade',
      duracionTransicion: 1,
      incluirTexto: true,
      calidad: 'media',
      mostrarDescripciones: true,
      resolucion: '720p',
      transicionesAleatorias: false,
      incluirAudiosSinImagen: true
    };
    this.mostrarConfiguracionVideo = true;
  }

  cerrarConfiguracionVideo(): void {
    if (this.generandoVideo) return;
    this.mostrarConfiguracionVideo = false;
    this.actividadVideoSeleccionada = null;
  }

  async generarVideo(): Promise<void> {
    if (this.generandoVideo || !this.actividadVideoSeleccionada || !this.configuracionVideo) return;

    try {
      this.generandoVideo = true;
      this.progresoVideo = {
        fase: 'cargando',
        porcentaje: 0,
        mensaje: 'Preparando datos para el vídeo...'
      };

      // 1. Obtener GPX y parsear (usando pipeline canónico con flatten)
      this.progresoVideo.mensaje = 'Resolviendo ruta GPX canónica...';
      const gpxContent = await firstValueFrom(
        this.trackEditorService.resolveCanonicalGpxXml(this.actividadVideoSeleccionada.id, { flattenSegments: true })
      );

      if (!gpxContent) throw new Error('No se pudo encontrar o resolver la ruta GPX asociada a esta actividad.');

      let points = this.gpxAnimationService.parseGpx(gpxContent);
      
      // 2. Asociar multimedia y audios perdidos
      this.progresoVideo.mensaje = 'Sincronizando fotos, vídeos y audios...';
      const archivoUrl = `${environment.apiUrl}/archivos?actividadId=${this.actividadVideoSeleccionada.id}`;
      const archivosAsociados = await firstValueFrom(this.http.get<any[]>(archivoUrl));
      
      points = this.gpxAnimationService.syncMultimedia(points, archivosAsociados);
      points = this.gpxAnimationService.applyTransportSegments(points, []);

      const itemsConAudio = [...points.filter(p => p.event).map(p => p.event)];
      for (const event of itemsConAudio) {
        if (event.archivos && event.archivos.length > 0) {
          for (const archivo of event.archivos) {
            if (!archivo.audioUrl && (archivo.tipo === 'foto' || archivo.tipo === 'imagen')) {
              try {
                const asociados = await firstValueFrom(this.archivoService.getArchivosAsociados(archivo.id));
                const audio = asociados.find((a: any) => a.tipo === 'audio');
                if (audio) {
                  archivo.audioUrl = this.archivoService.getUrlArchivoAsociado(audio);
                }
              } catch (e) {
                console.warn(`No se pudo cargar audio asociadio para archivo ${archivo.id}`, e);
              }
            }
          }
        }
      }

      this.progresoVideo.porcentaje = 5;

      // 3. Ejecutar generador de Video
      const videoBlob = await this.videoGeneratorService.generarVideoGpx(
        points,
        this.actividadVideoSeleccionada,
        this.configuracionVideo,
        (progreso) => {
          this.progresoVideo = progreso;
          this.cdr.detectChanges();
        }
      );

      // 4. Descargar
      const url = URL.createObjectURL(videoBlob);
      const a = document.createElement('a');
      a.href = url;
      const nombreArchivo = (this.actividadVideoSeleccionada.nombre || 'recorrido').replace(/[^a-z0-9]/gi, '_').toLowerCase();
      a.download = `animacion_gpx_${nombreArchivo}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      this.cerrarConfiguracionVideo();
      
    } catch (error) {
      console.error('Error generando vídeo:', error);
      alert('Error al generar el vídeo: ' + (error instanceof Error ? error.message : 'Error desconocido'));
    } finally {
      this.generandoVideo = false;
      this.progresoVideo = null;
      this.cdr.detectChanges();
    }
  }

  eliminarActividad(id: number): void {
    this.actividadService.eliminar(id)
      .subscribe({
        next: () => {
          this.actividades = this.actividades.filter(a => a.id !== id);
        },
        error: err => console.error('Error eliminando actividad:', err)
      });
  }

  actualizarActividad(actividad: Actividad): void {
    console.log('🔄 Navegando al formulario de edición para actividad:', actividad.id);

    // Navegar al formulario de edición con todos los parámetros necesarios
    this.router.navigate([
      '/formulario-actividad',
      this.viajePrevistoId,
      this.itinerarioId,
      'editar',
      actividad.id
    ]).then(success => {
      if (success) {
        console.log('✅ Navegación exitosa');
      } else {
        console.error('❌ Error en la navegación');
      }
    }).catch(err => {
      console.error('❌ Error navegando:', err);
    });
  }

  volverAItinerarios(): void {
    console.log('Volver a itinerarios:', this.viajePrevistoId);
    this.router.navigate(['/itinerarios', this.viajePrevistoId]);
  }

  verArchivos(actividadId: number, event: Event): void {
    console.log('CLICK detectado - ID:', actividadId);

    if (!actividadId) return;

    event.stopPropagation();

    const { viajePrevistoId, itinerarioId } = this.route.snapshot.params;

    const url = [
      'viajes-previstos',
      viajePrevistoId,
      'itinerarios',
      itinerarioId,
      'actividades',
      actividadId,
      'archivos'
    ];

    console.log('Navegando a URL:', url.join('/'));

    this.router.navigate(url).catch(err => {
      console.error('Error en navegación:', err);
    });
  }

  // ✅ MEJORADO: Ver GPX con Alta Fidelidad si existe visual_session.json
  verGPX(actividadId: number): void {
    console.log('📍 Iniciando Ver GPX para actividad:', actividadId);

    // Resetear estado de alta fidelidad para esta apertura
    this.visualSessionData = null;
    this.isHighFidelityMode = false;
    this.visualSessionGroup = null;
    this.actividadSeleccionada = actividadId;

    // ✅ PASO 1: Cargar estadísticas (paralelo con los demás pasos)
    this.actividadService.obtenerEstadisticas(actividadId).subscribe({
      next: (stats) => {
        this.estadisticasGPX = {
          distanciaKm: stats.distancia?.km || '0.00',
          distanciaMetros: stats.distancia?.metros || 0,
          duracion: stats.duracion || { formateada: '00:00:00', segundos: 0 },
          velocidad: stats.velocidad || { media: '0.0', maxima: '0.0', minima: '0.0' },
          energia: stats.energia || { calorias: 0, pasos: 0 },
          tracking: stats.tracking || { puntosGPS: 0, perfilTransporte: '' },
          transportePrincipal: stats.transportePrincipal || null,
          desgloseTransporte: stats.desgloseTransporte || [],
          fecha: stats.fecha || '',
          horario: stats.horario || { inicio: '', fin: '' },
          tiempoPausaSegundos: stats.tiempos?.pausadoSegundos || 0,
          tieneIdaVuelta: !!stats.idaVuelta,
          distanciaIdaMetros: stats.idaVuelta?.ida?.metros || 0,
          distanciaVueltaMetros: stats.idaVuelta?.vuelta?.metros || 0,
          tiempoIdaFormateado: stats.idaVuelta?.ida?.tiempo || '00:00:00',
          tiempoVueltaFormateado: stats.idaVuelta?.vuelta?.tiempo || '00:00:00',
          altitud: stats.altitud || { min: null, max: null, ganancia: null, perdida: null },
          cadencia: stats.cadencia || 0,
          zancada: stats.zancada || 0,
          multimedia: stats.multimedia || { fotos: 0, videos: 0 },
          tiempos: stats.tiempos || { enMarcha: '00:00:00', parado: '00:00:00', pausado: '00:00:00' }
        };
        console.log('✅ Estadísticas mapeadas:', this.estadisticasGPX);
      },
      error: err => console.warn('⚠️ Error cargando estadísticas:', err)
    });

    // ✅ PASO 2: Intentar cargar visual_session.json (Alta Fidelidad)
    //   → Independientemente del resultado, después cargamos el GPX como base de coordenadas.
    //   NOTA: las capas están en la raíz del JSON (sessionData.layers), NO en sessionData.mapState.layers
    this.actividadService.obtenerVisualSession(actividadId).subscribe({
      next: (sessionData) => {
        // ✅ FIX: leer layers desde la raíz del JSON, no desde mapState
        const layers = sessionData?.layers || sessionData?.mapState?.layers;
        if (layers && layers.length > 0) {
          // Normalizar: garantizar que siempre accedemos con sessionData.layers
          sessionData.layers = layers;
          this.visualSessionData = sessionData;
          this.isHighFidelityMode = true;
          console.log(`🎨 [Alta Fidelidad] visual_session.json cargado. Capas: ${layers.length}`);
        } else {
          console.warn('⚠️ [Alta Fidelidad] JSON sin capas válidas. Activando modo Legacy.');
        }
        this.cargarGPXYAbrirModal(actividadId);
      },
      error: (err) => {
        // 404 es esperado si la actividad no tiene sesión visual → fallback limpio
        const statusCode = err?.status;
        if (statusCode === 404) {
          console.log('ℹ️ [Legacy] No hay visual_session.json para esta actividad. Usando GPX.');
        } else {
          console.warn('⚠️ [Legacy] Error descargando visual_session.json:', err?.message);
        }
        this.isHighFidelityMode = false;
        this.cargarGPXYAbrirModal(actividadId);
      }
    });
  }

  /** Paso final: leer el GPX, extraer coordenadas de fallback y abrir el modal */
  private cargarGPXYAbrirModal(actividadId: number): void {
    this.trackEditorService.resolveCanonicalGpxXml(actividadId, { flattenSegments: true }).subscribe({
      next: (gpxText) => {
        this.parseGPX(gpxText);
        this.mostrarModalGPXMapa = true;
        this.cdr.detectChanges();
        this.ngZone.onStable.pipe(take(1)).subscribe(() => {
          this.inicializarMapaGPX();
        });
      },
      error: err => console.error('❌ Error obteniendo GPX:', err)
    });
  }

  // ✅ NUEVO: Animar GPX con multimedia (MEJORADO: Carga estadísticas primero)
  animarGPX(actividadId: number): void {
    console.log('🎬 Iniciando proceso de animación para actividad:', actividadId);

    // 1. PASO 1: Asegurar que tengamos las estadísticas para los segmentos de transporte
    this.actividadService.obtenerEstadisticas(actividadId).subscribe({
      next: (stats) => {
        console.log('📊 Estadísticas cargadas para animación:', stats);
        this.estadisticasGPX = {
          distanciaKm: stats.distancia?.km || '0.00',
          distanciaMetros: stats.distancia?.metros || 0,
          duracion: stats.duracion || { formateada: '00:00:00', segundos: 0 },
          velocidad: stats.velocidad || { media: '0.0', maxima: '0.0', minima: '0.0' },
          energia: stats.energia || { calorias: 0, pasos: 0 },
          tracking: stats.tracking || { puntosGPS: 0, perfilTransporte: '' },
          transportePrincipal: stats.transportePrincipal || null,
          desgloseTransporte: stats.desgloseTransporte || [],
          fecha: stats.fecha || '',
          horario: stats.horario || { inicio: '', fin: '' },
          cadencia: stats.cadencia || 0,
          zancada: stats.zancada || 0,
          multimedia: stats.multimedia || { fotos: 0, videos: 0 },
          tiempos: stats.tiempos || { enMarcha: '00:00:00', parado: '00:00:00', pausado: '00:00:00' }
        };

        // ✅ NUEVO: Intentar cargar visual_session.json antes de lanzar la animación
        this.actividadService.obtenerVisualSession(actividadId).subscribe({
          next: (sessionData) => {
            const layers = sessionData?.layers || sessionData?.mapState?.layers;
            if (layers && layers.length > 0) {
              sessionData.layers = layers;
              this.visualSessionData = sessionData;
              this.isHighFidelityMode = true;
              console.log('🎨 [Animación] Modo Alta Fidelidad activado.');
            }
            this.continuarCargaAnimacion(actividadId);
          },
          error: () => {
            this.isHighFidelityMode = false;
            this.visualSessionData = null;
            this.continuarCargaAnimacion(actividadId);
          }
        });
      },
      error: (err) => {
        console.error('❌ Error cargando estadísticas para animación:', err);
        this.desgloseTransporteAnimacion = [];
        this.continuarCargaAnimacion(actividadId);
      }
    });
  }

  /** Paso 2 y 3 de la animación: Multimedia y GPX */
  private continuarCargaAnimacion(actividadId: number): void {
    const backendUrl = environment.apiUrl;
    const urlFiles = `${backendUrl}/archivos?actividadId=${actividadId}`;

    this.http.get<any[]>(urlFiles).subscribe({
      next: (archivos: any[]) => {
        this.multimediaAnimacion = archivos.filter((f: any) =>
          (f.tipo === 'foto' || f.tipo === 'video' || f.tipo === 'audio') && f.geolocalizacion
        );

        this.trackEditorService.resolveCanonicalGpxXml(actividadId, { flattenSegments: true }).subscribe({
          next: (gpxText) => {
            this.gpxTextAnimacion = gpxText;
            this.desgloseTransporteAnimacion = this.estadisticasGPX?.desgloseTransporte || [];
            this.actividadAnimacion = this.actividades.find(a => a.id === actividadId);
            
            console.log('🎬 Lanzando reproductor animado con', this.desgloseTransporteAnimacion.length, 'segmentos');
            this.mostrarReproductorAnimado = true;
            this.cdr.detectChanges();
          },
          error: err => console.error('❌ Error obteniendo GPX para animación:', err)
        });
      },
      error: err => console.error('❌ Error obteniendo multimedia para animación:', err)
    });
  }

  cerrarAnimacion(): void {
    this.mostrarReproductorAnimado = false;
    this.gpxTextAnimacion = '';
    this.multimediaAnimacion = [];
    this.cdr.detectChanges();
  }

  // Parsear GPX y extraer coordenadas
  parseGPX(gpxText: string): void {
    try {
      const parser = new DOMParser();
      const gpxDoc = parser.parseFromString(gpxText, 'text/xml');

      // Extraer puntos de ruta (trkpt)
      const trkpts = gpxDoc.getElementsByTagName('trkpt');
      this.coordenadasGPX = [];

      for (let i = 0; i < trkpts.length; i++) {
        const lat = parseFloat(trkpts[i].getAttribute('lat') || '0');
        const lon = parseFloat(trkpts[i].getAttribute('lon') || '0');

        if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
          this.coordenadasGPX.push([lat, lon]);
        }
      }

      console.log('✅ GPX parseado. Coordenadas válidas extraídas:', this.coordenadasGPX.length);

      // Extraer Waypoints (Punto de Giro / Save Point)
      const wpts = gpxDoc.getElementsByTagName('wpt');
      this.turningPoint = null;
      for (let i = 0; i < wpts.length; i++) {
        const name = wpts[i].getElementsByTagName('name')[0]?.textContent;
        // Solo si coincide con el nombre esperado
        if (name === 'Punto de Giro' || name === 'Punto de Guardado' || name === 'Turn Around') {
          const lat = parseFloat(wpts[i].getAttribute('lat') || '0');
          const lon = parseFloat(wpts[i].getAttribute('lon') || '0');
          this.turningPoint = { lat, lon, name };
          console.log('🔄 Punto de giro detectado en GPX:', this.turningPoint);
          break;
        }
      }
    } catch (e) {
      console.error('❌ Excepción atrapada en parseGPX:', e);
      this.coordenadasGPX = [];
    }
  }

  // Inicializar mapa Leaflet — soporta Alta Fidelidad (visual_session.json) y Legacy (GPX)
  inicializarMapaGPX(): void {
    if (this.coordenadasGPX.length === 0) {
      console.warn('⚠️ No hay coordenadas para mostrar');
      return;
    }

    import('leaflet').then(L => {
      // Destruir mapa anterior si existe
      if (this.mapaGPX) {
        this.mapaGPX.remove();
        this.mapaGPX = null;
      }

      const container = document.getElementById('mapa-gpx-container');
      if (!container) {
        console.error('❌ Contenedor del mapa no encontrado');
        return;
      }
      container.innerHTML = '';

      try {
        this.mapaGPX = L.map(container, {
          attributionControl: true,
          zoomControl: true,
          preferCanvas: true
        }).setView([this.coordenadasGPX[0][0], this.coordenadasGPX[0][1]], 13);

        // --- CAPAS DE TILES ---
        const satellite = L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          { attribution: 'Tiles &copy; Esri', maxZoom: 18 }
        );
        const streets = L.tileLayer(
          'https://{s}.tile.openstreetmap.org/{z}/{y}/{x}.png',
          { attribution: '&copy; OpenStreetMap', maxZoom: 19 }
        );
        satellite.addTo(this.mapaGPX);
        L.control.layers({ 'Satélite': satellite, 'Callejero': streets }).addTo(this.mapaGPX);

        // ================================================================
        // MODO ALTA FIDELIDAD: Reconstruir capas desde visual_session.json
        // ================================================================
        // ✅ FIX: leer layers desde la raíz normalizada (sessionData.layers)
        if (this.isHighFidelityMode && this.visualSessionData?.layers) {
          console.log('🎨 [Alta Fidelidad] Renderizando capas del visual_session.json...');
          this.visualSessionGroup = L.layerGroup().addTo(this.mapaGPX);

          capasOrdenadas.forEach((layer: any) => {
            try {
                const modeKey = (layer.mode || '').toLowerCase();
                const layerTitle = (layer.options?.title || layer.name || layer.popup || '').toLowerCase();

                // Interceptar Punto de Giro
                if (modeKey === 'turning_point' || modeKey === 'turning' || layerTitle.includes('giro') || layerTitle.includes('turn')) {
                  const turningIcon = L.divIcon({
                    className: 'turning-marker',
                    html: '🔄',
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                  });
                  L.marker(layer.latLng, { icon: turningIcon }).bindPopup(`<strong>Punto de Giro</strong>`).addTo(this.visualSessionGroup);
                  return;
                }

                // Renderizar marcadores de foto (con icono HTML personalizado si está disponible)
                if (layer.icon?.html) {
                  const customIcon = L.divIcon({
                    className: layer.icon.className || 'custom-session-marker',
                    html: layer.icon.html,
                    iconSize: layer.icon.iconSize || [30, 49],
                    iconAnchor: layer.icon.iconAnchor || [15, 49],
                    popupAnchor: layer.icon.popupAnchor || [1, -40]
                  });
                  const m = L.marker(layer.latLng, { icon: customIcon }).addTo(this.visualSessionGroup);
                  if (layer.popup) m.bindPopup(layer.popup, { maxWidth: 260 });
                } else if (layer.icon?.iconUrl) {
                  const leafletIcon = L.icon(layer.icon);
                  const m = L.marker(layer.latLng, { icon: leafletIcon }).addTo(this.visualSessionGroup);
                  if (layer.popup) m.bindPopup(layer.popup);
                } else {
                  const color = this.MODE_COLORS_DIRECT[modeKey] || '#4CAF50';
                  const icon = L.divIcon({
                    className: 'transport-phase-marker',
                    html: `<div style="background:${color};color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);">${layer.icon?.html || '📍'}</div>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                  });
                  const m = L.marker(layer.latLng, { icon }).addTo(this.visualSessionGroup);
                  if (layer.popup) m.bindPopup(layer.popup);
                }
              }
            } catch (layerErr) {
              console.warn('⚠️ Error renderizando capa:', layerErr);
            }
          });

          const capasMarker = this.visualSessionData.layers.filter((l: any) => l.type === 'marker');
          console.log(`✅ [Alta Fidelidad] ${capasMarker.length} marcadores estáticos renderizados.`);

        }

        // ================================================================
        // RENDERIZADO CANÓNICO DE RUTA (Común a Alta Fidelidad y Legacy)
        // ================================================================
        console.log('🗺️ Renderizando polyline canónica desde gpxPoints (' + this.gpxPoints.length + ' pts).');
        
        let currentSegment: any[] = [];
        let currentMode = this.gpxPoints[0]?.mode || 'Urbana';

        const flushSegment = () => {
          if (currentSegment.length > 1) {
            const latlngs = currentSegment.map(p => [p.lat, p.lng] as L.LatLngExpression);
            let color = '#3b82f6'; // default
            if (this.MODE_COLORS_DIRECT[currentMode.toLowerCase()]) {
              color = this.MODE_COLORS_DIRECT[currentMode.toLowerCase()];
            } else {
              // fallback map
              const normalized = currentMode.toLowerCase();
              if (normalized === 'urbana' || normalized === 'walking') color = '#3b82f6';
              else if (normalized === 'sendero' || normalized === 'hiking') color = '#10b981';
              else if (normalized === 'ciclismo' || normalized === 'cycling') color = '#f59e0b';
              else if (normalized === 'conducción' || normalized === 'driving') color = '#ef4444';
            }

            // Trazado de fondo (stroke blanco)
            L.polyline(latlngs, {
              color: '#FFFFFF', weight: 8, opacity: 0.8, smoothFactor: 1
            }).addTo(this.mapaGPX);

            // Trazado principal
            L.polyline(latlngs, {
              color, weight: 5, opacity: 0.9, smoothFactor: 1
            }).addTo(this.mapaGPX);
            
            this.addDirectionArrows(L, latlngs, color, 0.8);
          }
        };

        for (let i = 0; i < this.gpxPoints.length; i++) {
          const p = this.gpxPoints[i];
          const ptMode = p.mode || 'Urbana';
          
          if (ptMode !== currentMode) {
            currentSegment.push(p); // Conectar
            flushSegment();
            currentSegment = [p];
            currentMode = ptMode;
          } else {
            currentSegment.push(p);
          }
        }
        flushSegment();


        // ================================================================
        // CAPAS FIJAS (presentes en AMBOS modos)
        // ================================================================

        // Marcador de INICIO
        L.circleMarker(this.coordenadasGPX[0], {
          radius: 9,
          fillColor: '#00C853',
          color: '#fff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.95
        }).bindPopup('🟢 <strong>Inicio</strong>').addTo(this.mapaGPX);

        // Marcador de FIN
        L.circleMarker(this.coordenadasGPX[this.coordenadasGPX.length - 1], {
          radius: 9,
          fillColor: '#D50000',
          color: '#fff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.95
        }).bindPopup('🔴 <strong>Fin</strong>').addTo(this.mapaGPX);

        // Marcador de Punto de Giro (si existe en el GPX)
        if (this.turningPoint) {
          L.marker([this.turningPoint.lat, this.turningPoint.lon], {
            icon: L.divIcon({
              className: 'turning-marker',
              html: '🔄',
              iconSize: [30, 30],
              iconAnchor: [15, 15]
            })
          }).bindPopup(`<strong>${this.turningPoint.name}</strong>`).addTo(this.mapaGPX);
        }

        // Marcadores de fotos/vídeos del backend
        this.cargarYAnadirFotos();

        // Ajustar vista al track completo
        this.mapaGPX.fitBounds(L.latLngBounds(this.coordenadasGPX), { padding: [50, 50] });

        const modo = this.isHighFidelityMode ? 'Alta Fidelidad' : 'Legacy';
        console.log(`✅ Mapa GPX [${modo}] inicializado. Puntos GPX: ${this.coordenadasGPX.length}`);

        setTimeout(() => { if (this.mapaGPX) this.mapaGPX.invalidateSize(); }, 120);

      } catch (error) {
        console.error('❌ Error inicializando Leaflet:', error);
      }
    });
  }

  // Helper para el contenido del popup contextual enriquecido (Fase 4 - Bloque C)
  private crearPopupContent(archivos: any[], numeroSecuencial: number, cantidadArchivos: number, tieneMultiples: boolean): string {
    const primerArchivo = archivos[0].archivo;
    
    let popupContent = `
        <div class="photo-popup-custom" style="max-width: 320px; font-family: sans-serif;">
          <div class="photo-popup-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="background: #3b82f6; color: white; border-radius: 4px; padding: 2px 6px; font-size: 12px; font-weight: bold;">#${numeroSecuencial}</span>
              <strong style="font-size: 14px; color: #334155;">${tieneMultiples ? `${cantidadArchivos} archivos` : 'Vista Previa'}</strong>
            </div>
            <span style="font-size: 10px; color: #64748b;">(Clic en miniatura para ver)</span>
          </div>
          <div class="photo-popup-body" style="display: flex; flex-direction: column; gap: 12px;">
      `;

    archivos.forEach((item, index) => {
      const archivo = item.archivo;
      const esVideo = this.esVideo(archivo);
      const thumbUrl = this.getThumbnailUrl(archivo);
      
      const audioTag = archivo.audioAsociado ? `
        <div style="margin-top: 6px; width: 100%;">
          <audio controls src="${environment.apiUrl}/uploads/${archivo.audioAsociado}" style="height: 24px; width: 100%;"></audio>
        </div>
      ` : '';

      let locationTag = '';
      if (archivo.geolocalizacion) {
        if (this.direccionesCache[archivo.geolocalizacion]) {
          locationTag = `<div style="font-size: 11px; color: #64748b; margin-top: 4px;"><i class="fa fa-map-marker"></i> ${this.direccionesCache[archivo.geolocalizacion]}</div>`;
        } else {
          locationTag = `<div id="lugar-popup-${archivo.id}" style="font-size: 11px; color: #64748b; margin-top: 4px;"><i class="fa fa-map-marker"></i> <span class="lugar-texto">📍 Cargando ubicación...</span></div>`;
        }
      }

      const dateTag = archivo.fechaCreacion ? `<div style="font-size: 11px; color: #94a3b8; margin-top: 2px;"><i class="fa fa-clock-o"></i> ${new Date(archivo.fechaCreacion).toLocaleString()}</div>` : '';
      const descTag = archivo.descripcion ? `<div style="font-size: 12px; color: #475569; margin-top: 6px; font-style: italic;">"${archivo.descripcion}"</div>` : '';

      const mediaTag = esVideo 
        ? `<video src="${thumbUrl}#t=0.1" preload="metadata" muted playsinline style="width: 100px; height: 75px; object-fit: cover; border-radius: 6px; border: 2px solid #e2e8f0; cursor: pointer;" class="clickable-media" data-index="${index}"></video>`
        : `<img src="${thumbUrl}" style="width: 100px; height: 75px; object-fit: cover; border-radius: 6px; border: 2px solid #e2e8f0; cursor: pointer;" class="clickable-media" data-index="${index}" />`;

      popupContent += `
          <div class="archivo-item-popup" style="display: flex; gap: 10px; padding: 6px; background: #f8fafc; border-radius: 8px;">
            <div style="position: relative; flex-shrink: 0;">
              ${mediaTag}
              ${esVideo ? '<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 20px; text-shadow: 0 1px 3px rgba(0,0,0,0.8); pointer-events: none;"><i class="fa fa-play-circle"></i></div>' : ''}
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

  // ✨ NUEVO: Cargar fotos y videos desde backend y añadirlas al mapa con agrupación
  private cargarYAnadirFotos(): void {
    if (!this.mapaGPX || !this.actividadSeleccionada) {
      console.warn('⚠️ Mapa o ID de actividad no disponible');
      return;
    }

    const backendUrl = environment.apiUrl;
    const urlArchivos = `${backendUrl}/archivos?actividadId=${this.actividadSeleccionada}`;
    const urlAsociados = `${backendUrl}/archivos-asociados`;

    this.http.get<any[]>(urlArchivos).subscribe({
      next: (archivos: any[]) => {
        // Obtenemos los archivos asociados para extraer el audio (Bloque C)
        this.http.get<any[]>(urlAsociados).subscribe({
          next: (asociados: any[]) => {
            this.procesarArchivosYMarcadores(archivos, asociados);
          },
          error: (err) => {
            console.warn('⚠️ Error al cargar archivos asociados, continuando sin audios', err);
            this.procesarArchivosYMarcadores(archivos, []);
          }
        });
      },
      error: err => {
        console.error('❌ Error cargando archivos:', err);
      }
    });
  }

  // Helper para procesar archivos, extraer metadatos anidados y crear marcadores
  private procesarArchivosYMarcadores(archivos: any[], asociados: any[]): void {
    const multimedia = archivos.filter((f: any) =>
      (f.tipo === 'foto' || f.tipo === 'video') && f.geolocalizacion
    );

    // Mapear audio asociado y raspar lugar del JSON de geolocalizacion (Bloque C)
    multimedia.forEach(archivo => {
      // 1. Vincular Audio (Asegurarnos de que sea el de este archivo y de tipo audio)
      const audioRelacionado = asociados.find(a => a.archivoPrincipalId === archivo.id && a.tipo === 'audio');
      if (audioRelacionado) {
        archivo.audioAsociado = audioRelacionado.rutaArchivo;
      }
      
      // 2. Extraer Lugar (Parseo conservador de la ubicación texto)
      try {
        const geoData = typeof archivo.geolocalizacion === 'string'
          ? JSON.parse(archivo.geolocalizacion)
          : archivo.geolocalizacion;
          
        if (!archivo.lugar) {
          archivo.lugar = geoData.lugar || geoData.direccion || geoData.ubicacion_texto || geoData.locality || null;
        }
      } catch (e) { }
    });

    const archivosConCoordenadas = multimedia.map((archivo: any) => {
      try {
        const geoData = typeof archivo.geolocalizacion === 'string'
          ? JSON.parse(archivo.geolocalizacion)
          : archivo.geolocalizacion;

        const lat = geoData.latitud ?? geoData.latitude;
        const lng = geoData.longitud ?? geoData.longitude;
        const timestamp = geoData.timestamp || archivo.fechaCreacion;

        if (lat && lng) {
          return { archivo, lat, lng, timestamp };
        }
      } catch (err) {
        console.warn(`⚠️ Error parseando ${archivo.nombreArchivo}:`, err);
      }
      return null;
    }).filter(Boolean);

    archivosConCoordenadas.sort((a, b) => {
      const timeA = new Date(a!.timestamp).getTime() || 0;
      const timeB = new Date(b!.timestamp).getTime() || 0;
      return timeA - timeB;
    });

    const grupos = this.agruparArchivosPorUbicacion(archivosConCoordenadas);

    // ✨ FASE 2: Sincronizar array lineal con los grupos del mapa
    this.fotosActividad = [];

    grupos.forEach((grupo, index) => {
      const numeroSecuencial = index + 1;
      
      this.anadirMarcadorGrupo(
        grupo.lat,
        grupo.lng,
        grupo.archivos,
        numeroSecuencial
      );

      // Alimentar la galería lateral con el orden y número exacto del mapa
      grupo.archivos.forEach((item: any) => {
        item.archivo.numeroSecuencial = numeroSecuencial;
        this.fotosActividad.push(item.archivo);
      });
    });
  }

  // ✅ NUEVO: Agrupar archivos por coordenadas cercanas
  private agruparArchivosPorUbicacion(archivosConCoordenadas: any[]): any[] {
    const TOLERANCIA_GPS = 0.0001; // ~10 metros
    const grupos: any[] = [];

    archivosConCoordenadas.forEach(item => {
      const grupoExistente = grupos.find(g =>
        Math.abs(g.lat - item.lat) < TOLERANCIA_GPS &&
        Math.abs(g.lng - item.lng) < TOLERANCIA_GPS
      );

      if (grupoExistente) {
        grupoExistente.archivos.push(item);
      } else {
        grupos.push({
          lat: item.lat,
          lng: item.lng,
          archivos: [item]
        });
      }
    });

    return grupos;
  }

  // ✅ NUEVO: Añadir marcador de grupo con contador y número secuencial
  private anadirMarcadorGrupo(lat: number, lng: number, archivos: any[], numeroSecuencial: number): void {
    if (!this.mapaGPX) return;

    import('leaflet').then(L => {
      const cantidadArchivos = archivos.length;
      const tieneMultiples = cantidadArchivos > 1;

      const primerArchivo = archivos[0].archivo;
      const esFoto = primerArchivo.tipo === 'foto';
      const colorPrincipal = esFoto ? '#FF4444' : '#2196F3';

      const grupoIcon = L.divIcon({
        className: 'photo-marker-custom',
        html: `
        <div style="display: flex; flex-direction: column; align-items: center;">
          <!-- Pin clásico móvil -->
          <svg width="44" height="44" viewBox="0 0 44 44" style="filter: drop-shadow(0px 3px 3px rgba(0,0,0,0.4)); z-index: 5;">
            <path d="M22 2 C14 2 8 8 8 16 C8 26 22 42 22 42 C22 42 36 26 36 16 C36 8 30 2 22 2 Z" fill="#E53935" />
            <circle cx="22" cy="16" r="6" fill="white" />
          </svg>
          <!-- Badge numérico móvil -->
          <div style="margin-top: -8px; background: #1E88E5; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4); z-index: 10; position: relative;">
            #${numeroSecuencial}
          </div>
        </div>
        `,
        iconSize: [44, 60],
        iconAnchor: [22, 60],
        popupAnchor: [0, -60]
      });


      const marker = L.marker([lat, lng], { icon: grupoIcon }).addTo(this.mapaGPX!);
      
      // ✅ NUEVO: Guardar referencia del marcador en cada archivo para sincronización
      archivos.forEach(a => {
        a.archivo.marcadorRef = marker;
      });

      // Crear el contenido del Popup
      const popupContent = this.crearPopupContent(archivos, numeroSecuencial, cantidadArchivos, tieneMultiples);

      marker.bindPopup(popupContent, {
          className: 'photo-popup-leaflet',
          maxWidth: 320
        });

      // Guardar referencia de los archivos
      (marker as any).archivosGrupo = archivos;
      (marker as any).numeroSecuencial = numeroSecuencial;

      // ✨ NUEVO: Interacción de Dos Pasos (Bloque D)
      // Eliminamos el evento click sobre el marcador que forzaba la apertura directa del visor.
      // Ahora Leaflet abrirá naturalmente el popup enriquecido.
      // Escuchamos cuando el popup se abre para inyectar el evento click en la miniatura.
      marker.on('popupopen', (e: any) => {
        const popupNode = e.popup._contentNode;
        if (!popupNode) return;
        
        const clickables = popupNode.querySelectorAll('.clickable-media');
        clickables.forEach((el: any) => {
          el.addEventListener('click', () => {
            const index = parseInt(el.getAttribute('data-index') || '0', 10);
            if (tieneMultiples) {
              // Si hay varios, pasamos al modal de grupo
              this.ngZone.run(() => this.abrirModalGrupo(archivos, numeroSecuencial));
            } else {
              // Si es individual, pasamos al visor individual avanzado
              const item = archivos[index].archivo;
              this.ngZone.run(() => this.abrirModalMultimedia(item.rutaArchivo, item.nombreArchivo, item.tipo));
            }
          });
        });

        // ✨ NUEVO: Disparar la geocodificación inversa de Nominatim bajo demanda
        archivos.forEach((item: any) => {
          const arch = item.archivo;
          if (arch.geolocalizacion && !this.direccionesCache[arch.geolocalizacion]) {
            this.obtenerDireccion(arch.geolocalizacion).then(direccion => {
              const el = document.getElementById(`lugar-popup-${arch.id}`);
              if (el) {
                const textSpan = el.querySelector('.lugar-texto');
                if (textSpan) {
                  textSpan.textContent = direccion;
                } else {
                  el.innerHTML = `<i class="fa fa-map-marker"></i> ${direccion}`;
                }
              }
            }).catch(err => console.warn('⚠️ Error obteniendo direccion para popup', err));
          }
        });
      });

      console.log(`✅ Marcador #${numeroSecuencial} añadido: ${cantidadArchivos} archivo(s) en [${lat}, ${lng}]`);
    });
  }

  // ✨ NUEVO: Abrir modal con foto o video
  private abrirModalMultimedia(rutaArchivo: string, nombre: string, tipo: string): void {
    console.log('🔍 Abriendo archivo:', nombre, 'Tipo:', tipo);
    console.log('📁 rutaArchivo:', rutaArchivo);

    const backendUrl = environment.apiUrl;
    const urlArchivo = `${backendUrl}/uploads/${rutaArchivo}`;

    console.log('🖼️ URL final del archivo:', urlArchivo);

    const modal = document.createElement('div');
    modal.className = 'modal-foto-individual';
    modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

    const contenido = document.createElement('div');
    contenido.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 20px;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  `;

    const esFoto = tipo === 'foto';
    const emoji = esFoto ? '📷' : '🎬';
    const etiqueta = esFoto ? 'Foto' : 'Video';

    const titulo = document.createElement('h3');
    titulo.textContent = `${emoji} ${etiqueta}`;
    titulo.style.cssText = 'margin: 0 0 10px 0; color: #333;';

    // ✅ CREAR ELEMENTO SEGÚN EL TIPO
    let mediaElement: HTMLImageElement | HTMLVideoElement;

    if (esFoto) {
      // ✨ MEJORADO: Usar el visualizador avanzado en nueva ventana
      const backendUrl = environment.apiUrl;
      const urlArchivo = `${backendUrl}/uploads/${rutaArchivo}`;
      const fullUrl = `${window.location.origin}/visualizador-foto?url=${encodeURIComponent(urlArchivo)}&descripcion=${encodeURIComponent(nombre)}`;

      window.open(fullUrl, '_blank', 'noopener,noreferrer');
      return;

      // Código antiguo para fallback o por si falla la ventana
      const imagen = document.createElement('img');
      imagen.src = urlArchivo;
      imagen.style.cssText = `
        width: 100%;
        height: auto;
        border-radius: 8px;
        margin: 10px 0;
        background: #f0f0f0;
        cursor: pointer;
      `;

      imagen.onerror = () => {
        console.error('❌ Error cargando imagen desde:', urlArchivo);
        imagen.alt = 'Error al cargar la imagen';
        imagen.style.background = '#ff6b6b';
      };

      mediaElement = imagen;
    } else {
      // Crear elemento de video
      const video = document.createElement('video');
      video.src = urlArchivo;
      video.controls = true;
      video.style.cssText = `
        width: 100%;
        height: auto;
        border-radius: 8px;
        margin: 10px 0;
        background: #000;
        max-height: 400px;
      `;

      video.onerror = () => {
        console.error('❌ Error cargando video desde:', urlArchivo);
        video.style.background = '#ff6b6b';
      };

      mediaElement = video;
    }

    const nombreEl = document.createElement('p');
    nombreEl.textContent = nombre;
    nombreEl.style.cssText = 'font-size: 12px; color: #999; margin: 10px 0;';

    // ✨ CONTENEDOR DE BOTONES
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = `
    display: flex;
    gap: 10px;
    margin-top: 15px;
  `;

    const btnCerrar = document.createElement('button');
    btnCerrar.textContent = 'Cerrar';
    btnCerrar.style.cssText = `
    background: #f44336;
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 6px;
    cursor: pointer;
    flex: 1;
    font-size: 14px;
  `;

    btnCerrar.addEventListener('click', () => {
      modal.remove();
    });

    // ✨ NUEVO BOTÓN: VER EN LISTA DE ARCHIVOS
    const btnVerArchivo = document.createElement('button');
    btnVerArchivo.textContent = '📁 Ver en Archivos';
    btnVerArchivo.style.cssText = `
    background: #2196F3;
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 6px;
    cursor: pointer;
    flex: 1;
    font-size: 14px;
  `;

    btnVerArchivo.addEventListener('click', () => {
      console.log('🔗 Navegando a archivos...');
      modal.remove();

      // Navegar a la página de archivos
      this.router.navigate([
        '/viajes-previstos',
        this.viajePrevistoId,
        'itinerarios',
        this.itinerarioId,
        'actividades',
        this.actividadSeleccionada,
        'archivos'
      ]);
    });

    btnContainer.appendChild(btnVerArchivo);
    btnContainer.appendChild(btnCerrar);

    contenido.appendChild(titulo);
    contenido.appendChild(mediaElement);
    contenido.appendChild(nombreEl);
    contenido.appendChild(btnContainer);

    modal.appendChild(contenido);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);

    console.log(`✅ Modal de ${etiqueta} abierto`);
  }

  // ✅ NUEVO: Abrir modal con grupo de archivos (carrusel)
  private abrirModalGrupo(archivos: any[], numeroSecuencial: number): void {
    console.log(`🔍 Abriendo grupo #${numeroSecuencial} con ${archivos.length} archivo(s)`);

    const backendUrl = environment.apiUrl;
    let indiceActual = 0;

    const modal = document.createElement('div');
    modal.className = 'modal-grupo-archivos';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.9);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;

    const contenido = document.createElement('div');
    contenido.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 20px;
      max-width: 700px;
      max-height: 85vh;
      overflow: hidden;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
      position: relative;
    `;

    // Función para actualizar el contenido del modal
    const actualizarContenido = () => {
      const item = archivos[indiceActual];
      const archivo = item.archivo;
      const esFoto = archivo.tipo === 'foto';
      const emoji = esFoto ? '📷' : '🎬';
      const urlArchivo = `${backendUrl}/uploads/${archivo.rutaArchivo}`;

      contenido.innerHTML = `
        <div style="margin-bottom: 15px; display: flex; align-items: center; justify-content: space-between;">
          <h3 style="margin: 0; color: #333;">
            ${emoji} Grupo #${numeroSecuencial} 
            <span style="font-size: 14px; color: #666;">(${indiceActual + 1}/${archivos.length})</span>
          </h3>
          <button id="btn-cerrar-grupo" style="
            background: #f44336;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
          ">✕ Cerrar</button>
        </div>

        <div style="position: relative; margin: 15px 0;">
          ${esFoto
          ? `<img id="img-carrusel" src="${urlArchivo}" style="
                width: 100%;
                height: auto;
                max-height: 450px;
                object-fit: contain;
                border-radius: 8px;
                background: #f0f0f0;
                cursor: pointer;
              " title="Clic para ampliar y rotar" />`
          : `<video src="${urlArchivo}" controls style="
                width: 100%;
                height: auto;
                max-height: 450px;
                border-radius: 8px;
                background: #000;
              "></video>`
        }
        </div>

        <p style="font-size: 12px; color: #999; margin: 10px 0; text-align: center;">
          ${archivo.nombreArchivo}
        </p>

        ${archivos.length > 1 ? `
        <div style="display: flex; gap: 10px; margin-top: 15px; align-items: center;">
          <button id="btn-anterior" style="
            background: #2196F3;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            flex: 1;
            font-size: 14px;
            ${indiceActual === 0 ? 'opacity: 0.5; cursor: not-allowed;' : ''}
          " ${indiceActual === 0 ? 'disabled' : ''}>
            ← Anterior
          </button>
          
          <span style="color: #666; font-size: 14px; white-space: nowrap;">
            ${indiceActual + 1} / ${archivos.length}
          </span>
          
          <button id="btn-siguiente" style="
            background: #2196F3;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            flex: 1;
            font-size: 14px;
            ${indiceActual === archivos.length - 1 ? 'opacity: 0.5; cursor: not-allowed;' : ''}
          " ${indiceActual === archivos.length - 1 ? 'disabled' : ''}>
            Siguiente →
          </button>
        </div>
        ` : ''}
      `;

      // Añadir event listeners
      const btnCerrar = contenido.querySelector('#btn-cerrar-grupo');
      btnCerrar?.addEventListener('click', () => modal.remove());

      if (archivos.length > 1) {
        const btnAnterior = contenido.querySelector('#btn-anterior');
        const btnSiguiente = contenido.querySelector('#btn-siguiente');

        btnAnterior?.addEventListener('click', () => {
          if (indiceActual > 0) {
            indiceActual--;
            actualizarContenido();
          }
        });

        btnSiguiente?.addEventListener('click', () => {
          if (indiceActual < archivos.length - 1) {
            indiceActual++;
            actualizarContenido();
          }
        });
      }

      // ✨ NUEVO: Click en la imagen para abrir visualizador avanzado
      if (esFoto) {
        const imgCarrusel = contenido.querySelector('#img-carrusel');
        imgCarrusel?.addEventListener('click', () => {
          const fullUrl = `${window.location.origin}/visualizador-foto?url=${encodeURIComponent(urlArchivo)}&descripcion=${encodeURIComponent(archivo.descripcion || archivo.nombreArchivo)}`;
          window.open(fullUrl, '_blank', 'noopener,noreferrer');
        });
      }
    };

    // Inicializar contenido
    actualizarContenido();

    modal.appendChild(contenido);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);

    console.log(`✅ Modal de grupo abierto`);
  }

  // Ver Mapa PNG - Muestra en modal
  verMapa(actividadId: number): void {
    console.log('🗺️ Obteniendo mapa para actividad:', actividadId);
    this.actividadSeleccionada = actividadId;
    this.actividadService.obtenerMapa(actividadId).subscribe({
      next: (blob) => {
        const reader = new FileReader();
        reader.onload = (e: any) => {
          this.urlMapaDataURL = e.target.result;
          this.mostrarModalMapa = true;
          console.log('✅ Mapa cargado en modal');
        };
        reader.readAsDataURL(blob);
      },
      error: err => console.error('❌ Error obteniendo mapa:', err)
    });
  }

  // Ver Estadísticas - Muestra en modal
  verEstadisticas(actividadId: number): void {
    console.log('📊 Obteniendo estadísticas para actividad:', actividadId);
    this.actividadSeleccionada = actividadId;
    this.actividadService.obtenerEstadisticas(actividadId).subscribe({
      next: (datos) => {
        this.estadisticasActuales = datos;
        this.mostrarModalEstadisticas = true;
        console.log('✅ Estadísticas cargadas:', datos);
      },
      error: err => console.error('❌ Error obteniendo estadísticas:', err)
    });
  }

  // Cerrar modales
  cerrarModalMapa(): void {
    this.mostrarModalMapa = false;
    this.urlMapaDataURL = null;
  }

  cerrarModalEstadisticas(): void {
    this.mostrarModalEstadisticas = false;
    this.estadisticasActuales = null;
  }

  cerrarModalGPXMapa(): void {
    this.mostrarModalGPXMapa = false;
    if (this.mapaGPX) {
      this.mapaGPX.remove();
      this.mapaGPX = null;
    }
  }

  // ✅ NUEVO: Toggle panel de estadísticas
  toggleSidePanel(): void {
    this.showSidePanel = !this.showSidePanel;
    console.log(`🗺️ Panel lateral: ${this.showSidePanel ? 'VISIBLE' : 'OCULTO'}`);
    
    // Invalida el tamaño del mapa poco después para que se adapte al contenedor redimensionado
    if (this.mapaGPX) {
      setTimeout(() => {
        this.mapaGPX.invalidateSize(true);
      }, 300);
    }
  }

  // ✅ NUEVO: Expandir/contraer panel
  togglePanelExpanded(): void {
    this.panelExpanded = !this.panelExpanded;
    console.log(`📊 Panel: ${this.panelExpanded ? 'EXPANDIDO' : 'CONTRAÍDO'}`);
  }

  // ✅ NUEVO: Ajustar vista del mapa al track completo
  fitMapToTrack(): void {
    if (!this.mapaGPX || this.coordenadasGPX.length === 0) {
      console.warn('⚠️ No hay mapa o coordenadas disponibles');
      return;
    }

    import('leaflet').then(L => {
      const bounds = L.latLngBounds(this.coordenadasGPX);
      this.mapaGPX.fitBounds(bounds, { padding: [50, 50], maxZoom: 16, animate: true });
      console.log('✅ Vista ajustada al track completo');
    });
  }

  // ✅ NUEVO: Obtener emoji de transporte
  getTransportEmoji(iconName: string): string {
    const emojiMap: { [key: string]: string } = {
      'walk': '🚶',
      'fitness': '🏃',
      'bicycle': '🚴',
      'car': '🚗'
    };
    return emojiMap[iconName] || '📍';
  }

  // ✅ NUEVO: Formatear distancia
  formatDistance(meters: number): string {
    if (meters < 1000) {
      return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(2)} km`;
  }

  // ✅ NUEVO: Formatear duración
  formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  // ✅ MEJOR OPCIÓN: Flechas SVG (escalables sin pixelar)
  private addDirectionArrows(L: any, coordinates: any[], color: string = '#FF0000', opacity: number = 1): void {
    if (!this.mapaGPX || coordinates.length < 2) return;

    const totalPoints = coordinates.length;
    // ✨ FASE 1 (Iteración 3): Chevron minimalista, muy sutil
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
        zIndexOffset: 1000
      }).addTo(this.mapaGPX);
    }

    console.log(`✅ ${Math.floor(totalPoints / interval)} flechas SVG añadidas`);
  }


  // ✅ NUEVO: Calcular ángulo entre dos puntos
  private calculateAngle(pointA: number[], pointB: number[]): number {
    const lat1 = pointA[0];
    const lng1 = pointA[1];
    const lat2 = pointB[0];
    const lng2 = pointB[1];

    // Convertir a radianes
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;

    // Calcular ángulo
    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
      Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

    const bearing = Math.atan2(y, x) * 180 / Math.PI;

    // Normalizar a 0-360
    return (bearing + 360) % 360;
  }

  // ✅ NUEVO: Funciones trackBy para rendimiento
  trackByActividad(index: number, item: Actividad): number {
    return item.id;
  }

  trackByTransporte(index: number, item: any): string {
    return item.nombre || index.toString();
  }

  trackBySegmento(index: number, item: any): number {
    return index;
  }

  getThumbnailUrl(foto: any): string {
    const backendUrl = environment.apiUrl;
    return `${backendUrl}/uploads/${foto.rutaArchivo}`;
  }

  // ✅ NUEVO: Función para determinar si el archivo es un vídeo
  esVideo(foto: any): boolean {
    if (foto.tipo === 'video') return true;
    if (!foto.rutaArchivo) return false;
    const extension = foto.rutaArchivo.split('.').pop()?.toLowerCase();
    return ['mp4', 'mov', 'avi', 'webm'].includes(extension);
  }

  centrarEnFoto(foto: any): void {
    if (foto.marcadorRef && this.mapaGPX) {
      // 1. Centrar el mapa
      this.mapaGPX.setView(foto.marcadorRef.getLatLng(), 17);
      
      // 2. Abrir el popup contextual enriquecido (No abrir visor completo aquí)
      foto.marcadorRef.openPopup();
      
      // Ajustar panel si es necesario
      if (this.panelExpanded) {
        this.togglePanelExpanded();
      }
    }
  }

  getNombreActividad(id: number | null): string {
    if (!id) return 'Recorrido GPX';
    const actividad = this.actividades.find(a => a.id === id);
    return actividad?.nombre || 'Recorrido GPX';
  }
  // ✨ NUEVO: Convertir coordenadas a dirección legible bajo demanda usando Nominatim (Fase 4 - Bloque C)
  private async obtenerDireccion(geolocalizacion: string): Promise<string> {
    if (!geolocalizacion || geolocalizacion === 'No disponible') {
      return 'Ubicación no disponible';
    }

    if (this.direccionesCache[geolocalizacion]) {
      return this.direccionesCache[geolocalizacion];
    }

    try {
      let lat: number, lon: number;

      if (geolocalizacion.includes('{')) {
        const coords = JSON.parse(geolocalizacion);
        lat = coords.latitud ?? coords.latitude;
        lon = coords.longitud ?? coords.longitude;
      } else if (geolocalizacion.includes(',')) {
        [lat, lon] = geolocalizacion.split(',').map(parseFloat);
      } else {
        return 'Formato inválido';
      }

      if (isNaN(lat) || isNaN(lon)) return 'Coordenadas inválidas';

      this.nominatimQueue = this.nominatimQueue.then(() =>
        new Promise(resolve => setTimeout(resolve, this.NOMINATIM_DELAY))
      );

      await this.nominatimQueue;

      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      let res;
      try {
        res = await fetch(url, {
          headers: {
            'User-Agent': 'TravelMemoryApp/1.0',
            'Accept-Language': 'es'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        const fallback = `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;
        this.direccionesCache[geolocalizacion] = fallback;
        return fallback;
      }

      if (!res.ok) {
        const fallback = `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;
        this.direccionesCache[geolocalizacion] = fallback;
        return fallback;
      }

      const data = await res.json();
      if (!data || data.error) {
        const fallback = `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;
        this.direccionesCache[geolocalizacion] = fallback;
        return fallback;
      }

      const addr = data.address || {};
      let direccion =
        [addr.road, addr.house_number, addr.suburb, addr.city || addr.town || addr.village, addr.state, addr.country]
          .filter(Boolean)
          .join(', ');

      if (!direccion && data.display_name) direccion = data.display_name;
      if (!direccion) direccion = `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;

      this.direccionesCache[geolocalizacion] = direccion;
      return direccion;
    } catch (e: any) {
      console.error('Error obteniendo dirección:', e);
      try {
        const coords = JSON.parse(geolocalizacion);
        const fallback = `${coords.latitud.toFixed(5)}°, ${coords.longitud.toFixed(5)}°`;
        this.direccionesCache[geolocalizacion] = fallback;
        return fallback;
      } catch {
        return 'Ubicación no disponible';
      }
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ✏️ EDITOR DE RECORRIDO GPX (Fase 1 y 2.1)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  abrirEditorTrack(actividadId: number): void {
    console.log('✏️ Abriendo editor de recorrido para actividad:', actividadId);
    this.actividadEditorId = actividadId;

    // 1. Cargar edits existentes
    this.trackEditorService.getTrackEdits(actividadId).subscribe({
      next: (edits) => {
        this.editsEditor = edits || [];
        
        // 2. Cargar Segmentos (Fase 2.1.a)
        this.trackEditorService.getSegments(actividadId).subscribe({
          next: (segments) => {
            if (segments && segments.length > 0) {
              // Ya existe migración, construir track componiendo segmentos con Event Sourcing
              this.gpxPointsEditor = this.trackEditorService.replaySegments(segments);
              this.mostrarEditorTrack = true;
              this.cdr.detectChanges();
            } else {
              // No hay segmentos, migrar desde GPX legacy
              this.actividadService.obtenerGPX(actividadId).subscribe({
                next: (blob) => {
                  const reader = new FileReader();
                  reader.onload = (e: any) => {
                    this.gpxPointsEditor = this.gpxAnimationService.parseGpx(e.target.result);
                    
                    // Guardar el track base como el segmento original idempotentemente
                    this.trackEditorService.createSegment(actividadId, this.gpxPointsEditor, 'original').subscribe({
                      next: () => console.log('✅ GPX base migrado exitosamente a segments (source: original)'),
                      error: err => console.error('❌ Error migrando GPX base a segments:', err)
                    });

                    this.mostrarEditorTrack = true;
                    this.cdr.detectChanges();
                  };
                  reader.readAsText(blob);
                },
                error: err => console.error('❌ Error cargando GPX para editor:', err)
              });
            }
          },
          error: err => console.error('❌ Error cargando segments para editor:', err)
        });
      },
      error: err => {
        console.error('❌ Error cargando TrackEdits para editor:', err);
        this.editsEditor = [];
      }
    });
  }

  cerrarEditorTrack(): void {
    this.mostrarEditorTrack = false;
    this.gpxPointsEditor = [];
    this.editsEditor = [];
    this.actividadEditorId = null;
    this.cdr.detectChanges();
  }

  onTrackEditRequest(event: any): void {
    if (!this.actividadEditorId) return;

    console.log('✏️ Guardando edición:', event);

    const edit: TrackEdit = {
      actividadId: this.actividadEditorId,
      action: event.action,
      startAnchor: event.startAnchor,
      endAnchor: event.endAnchor,
      newMode: event.newMode,
      injectedGeometry: event.injectedGeometry
    };

    this.trackEditorService.createTrackEdit(edit).subscribe({
      next: (savedEdit) => {
        console.log('✅ Edición guardada con ID:', savedEdit.id);
        this.editsEditor = [...this.editsEditor, savedEdit];
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('❌ Error guardando edición:', err);
        alert('❌ Error guardando la edición. Revisa la consola.');
      }
    });
  }

  onAppendRequest(event: { points: { lat: number; lng: number }[] }): void {
    if (!this.actividadEditorId || !event.points || event.points.length === 0) return;

    console.log('➕ Guardando Append:', event.points.length, 'puntos');

    this.trackEditorService.createSegment(this.actividadEditorId, event.points, 'user-append').subscribe({
      next: (resp) => {
        console.log('✅ Segment append guardado con id:', resp.id, 'order:', resp.segmentOrder);

        // Calcular timestamps monotónicos y concatenar al array local
        const appendedGpxPoints = this.trackEditorService.applyAppendWithTimestamps(
          this.gpxPointsEditor,
          event.points
        );

        this.gpxPointsEditor = [...this.gpxPointsEditor, ...appendedGpxPoints];
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('❌ Error guardando segment append:', err);
        alert('❌ Error guardando el tramo. Revisa la consola.');
      }
    });
  }

  onInsertRequest(event: { points: { lat: number; lng: number; time?: string }[] }): void {
    if (!this.actividadEditorId || !event.points || event.points.length < 2) return;

    console.log('📍 Guardando Insert:', event.points.length, 'puntos');

    // 1. Convertir a formato GpxPoint para interpolar en cliente antes de persistir
    const gpxPoints = event.points.map(p => ({
      ...p,
      time: p.time ? new Date(p.time) : undefined
    })) as any[];

    // 2. Interpolar
    const anchorA = gpxPoints[0];
    const anchorB = gpxPoints[gpxPoints.length - 1];
    
    // Asegurarnos de que A y B tengan fechas validas
    if (anchorA.time && anchorB.time) {
      this.trackEditorService.interpolateTimeBetweenAnchors(anchorA, anchorB, gpxPoints);
    }

    // 3. Volver a serializar a formato plano JSON con los timestamps ISO
    const payload = gpxPoints.map(p => ({
      lat: p.lat,
      lng: p.lng,
      time: p.time ? p.time.toISOString() : undefined
    }));

    // 4. Guardar
    this.trackEditorService.createSegment(this.actividadEditorId, payload, 'user-insert').subscribe({
      next: (resp) => {
        console.log('✅ Segment insert guardado con id:', resp.id, 'order:', resp.segmentOrder);

        // 5. Refrescar track desde backend para re-aplicar el replay completo
        this.trackEditorService.getSegments(this.actividadEditorId!).subscribe({
          next: (segments) => {
            if (segments && segments.length > 0) {
              this.gpxPointsEditor = this.trackEditorService.replaySegments(segments);
              this.cdr.detectChanges();
            }
          }
        });
      },
      error: (err) => {
        console.error('❌ Error guardando segment insert:', err);
        alert('❌ Error guardando el tramo insertado. Revisa la consola.');
      }
    });
  }

  onOverrideModeRequest(event: { points: { lat: number; lng: number; time?: string; mode?: string }[] }): void {
    if (!this.actividadEditorId || !event.points || event.points.length < 2) return;

    console.log('🔄 Guardando Override de Modo de Transporte:', event.points.length, 'puntos');

    // Mapear al formato de persistencia plano
    const payload = event.points.map(p => ({
      lat: p.lat,
      lng: p.lng,
      time: p.time, // Ya viene en ISO string desde el componente hijo
      mode: p.mode
    }));

    // Guardar como 'user-override' para que replaySegments lo procese como un reemplazo de atributos
    this.trackEditorService.createSegment(this.actividadEditorId, payload, 'user-override').subscribe({
      next: (resp) => {
        console.log('✅ Segment override guardado con id:', resp.id, 'order:', resp.segmentOrder);

        // Refrescar track desde backend para aplicar
        this.trackEditorService.getSegments(this.actividadEditorId!).subscribe({
          next: (segments) => {
            if (segments && segments.length > 0) {
              this.gpxPointsEditor = this.trackEditorService.replaySegments(segments);
              this.cdr.detectChanges();
            }
          }
        });
      },
      error: (err) => {
        console.error('❌ Error guardando segment override:', err);
        alert('❌ Error guardando el cambio de transporte. Revisa la consola.');
      }
    });
  }

  onDeleteRequest(event: { anchorA: any; anchorB: any }): void {
    if (!this.actividadEditorId || !event.anchorA || !event.anchorB) return;

    console.log('🔄 Guardando Delete de Tramo:', event.anchorA, event.anchorB);

    // Mapear al formato de persistencia plano: sólo guardamos las dos anclas
    const payload = [
      { lat: event.anchorA.lat, lng: event.anchorA.lng, time: event.anchorA.time },
      { lat: event.anchorB.lat, lng: event.anchorB.lng, time: event.anchorB.time }
    ];

    // Guardar como 'user-delete'
    this.trackEditorService.createSegment(this.actividadEditorId, payload, 'user-delete').subscribe({
      next: (resp) => {
        console.log('✅ Segment delete guardado con id:', resp.id, 'order:', resp.segmentOrder);

        // Refrescar track desde backend para aplicar
        this.trackEditorService.getSegments(this.actividadEditorId!).subscribe({
          next: (segments) => {
            if (segments && segments.length > 0) {
              this.gpxPointsEditor = this.trackEditorService.replaySegments(segments);
              this.cdr.detectChanges();
            }
          }
        });
      },
      error: (err) => {
        console.error('❌ Error guardando segment delete:', err);
        alert('❌ Error guardando el borrado del tramo. Revisa la consola.');
      }
    });
  }

}
