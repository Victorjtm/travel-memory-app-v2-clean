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

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ PROPIEDADES PARA MODALES
  mostrarModalGPX = false;
  mostrarModalMapa = false;
  mostrarModalEstadisticas = false;
  mostrarModalGPXMapa = false;
  mostrarReproductorAnimado = false; // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ NUEVA PROPIEDAD

  urlMapaDataURL: string | null = null;
  fotosActividad: any[] = [];
  gruposEditor: any[] = []; // NUEVO: Grupos de medios para pasar al editor
  estadisticasActuales: any = null;
  actividadSeleccionada: number | null = null;

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ ESTADOS PARA CONFIGURACION DE VIDEO GPX
  generandoVideo = false;
  progresoVideo: ProgresoVideo | null = null;
  mostrarConfiguracionVideo = false;
  configuracionVideo: ConfiguracionVideo | null = null;
  actividadVideoSeleccionada: any = null;

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ PROPIEDADES PARA MAPA GPX
  mapaGPX: any = null;
  coordenadasGPX: any[] = [];

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NUEVAS PROPIEDADES: Panel de estadÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­sticas
  showSidePanel = true;
  activeSideTab: 'fotos' | 'estadisticas' = 'fotos';
  panelExpanded = false;
  trackSegments: any[] = [];
  turningPoint: any = null;

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NUEVAS PROPIEDAD: EstadÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­sticas completas para el panel
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

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ NUEVAS PROPIEDADES PARA ANIMACIÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œN
  gpxTextAnimacion: string = '';
  multimediaAnimacion: any[] = [];
  desgloseTransporteAnimacion: any[] = [];
  actividadAnimacion: any = null; // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ NUEVA PROPIEDAD

  // ? ESTADOS PARA TRACK EDITOR (Fase 1 y 2)
  mostrarEditorTrack = false;
  gpxPointsEditor: GpxPoint[] = [];
  editsEditor: TrackEdit[] = [];
  actividadEditorId: number | null = null;

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ MODO ALTA FIDELIDAD (visual_session.json)
  visualSessionData: any = null;
  isHighFidelityMode = false;
  private visualSessionGroup: any = null;

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ COLORES POR MODO DE TRANSPORTE (Fallback GPX)
  private readonly MODE_COLORS = {
    walking: { outbound: '#059669', return: '#6EE7B7' },
    running: { outbound: '#2563EB', return: '#93C5FD' },
    cycling: { outbound: '#D97706', return: '#FCD34D' },
    driving: { outbound: '#DC2626', return: '#FCA5A5' }
  };

  // Paleta de colores directa por nombre de modo (idÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©ntica a GpxAnimationComponent)
  private readonly MODE_COLORS_DIRECT: { [key: string]: string } = {
    walking: '#4CAF50', walk: '#4CAF50', caminar: '#4CAF50', andando: '#4CAF50',
    driving: '#F44336', car: '#F44336', coche: '#F44336',
    cycling: '#FF9800', bicycle: '#FF9800', bici: '#FF9800',
    running: '#2196F3', correr: '#2196F3',
    bus: '#9C27B0', autobus: '#9C27B0',
    transport: '#9E9E9E', transporte: '#9E9E9E'
  };

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ CACHÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â° DE DIRECCIONES PARA LEAFLET (Fase 4 - Bloque C)
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
          console.log('NÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âºmero de actividades:', this.actividades.length);
        },
        error: err => console.error('Error cargando actividades:', err)
      });
  }

  // ==========================================
  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ CONFIGURACIÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œN Y GENERACIÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œN DE VÃƒÆ’Ã†â€™Ãƒâ€šÃ‚ÂDEO GPX
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
        mensaje: 'Preparando datos para el vÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­deo...'
      };

      // 1. Obtener GPX y parsear (usando pipeline canÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³nico con flatten)
      this.progresoVideo.mensaje = 'Resolviendo ruta GPX canÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³nica...';
      const gpxContent = await firstValueFrom(
        this.trackEditorService.resolveCanonicalGpxXml(this.actividadVideoSeleccionada.id, { flattenSegments: true })
      );

      if (!gpxContent) throw new Error('No se pudo encontrar o resolver la ruta GPX asociada a esta actividad.');

      let points = this.gpxAnimationService.parseGpx(gpxContent);
      
      // 2. Asociar multimedia y audios perdidos
      this.progresoVideo.mensaje = 'Sincronizando fotos, vÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­deos y audios...';
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
      console.error('Error generando vÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­deo:', error);
      alert('Error al generar el vÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­deo: ' + (error instanceof Error ? error.message : 'Error desconocido'));
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
    console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ Navegando al formulario de ediciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n para actividad:', actividad.id);

    // Navegar al formulario de ediciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n con todos los parÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡metros necesarios
    this.router.navigate([
      '/formulario-actividad',
      this.viajePrevistoId,
      this.itinerarioId,
      'editar',
      actividad.id
    ]).then(success => {
      if (success) {
        console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NavegaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n exitosa');
      } else {
        console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error en la navegaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n');
      }
    }).catch(err => {
      console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error navegando:', err);
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
      console.error('Error en navegaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n:', err);
    });
  }

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ MEJORADO: Ver GPX con Alta Fidelidad si existe visual_session.json
  verGPX(actividadId: number): void {
    console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â Iniciando Ver GPX para actividad:', actividadId);

    // Resetear estado de alta fidelidad para esta apertura
    this.visualSessionData = null;
    this.isHighFidelityMode = false;
    this.visualSessionGroup = null;
    this.actividadSeleccionada = actividadId;

    // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ PASO 1: Cargar estadÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­sticas (paralelo con los demÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡s pasos)
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
        console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ EstadÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­sticas mapeadas:', this.estadisticasGPX);
      },
      error: err => console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Error cargando estadÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­sticas:', err)
    });

    // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ PASO 2: Intentar cargar visual_session.json (Alta Fidelidad)
    //   ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ Independientemente del resultado, despuÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©s cargamos el GPX como base de coordenadas.
    //   NOTA: las capas estÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡n en la raÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­z del JSON (sessionData.layers), NO en sessionData.mapState.layers
    this.actividadService.obtenerVisualSession(actividadId).subscribe({
      next: (sessionData) => {
        // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ FIX: leer layers desde la raÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­z del JSON, no desde mapState
        const layers = sessionData?.layers || sessionData?.mapState?.layers;
        if (layers && layers.length > 0) {
          // Normalizar: garantizar que siempre accedemos con sessionData.layers
          sessionData.layers = layers;
          this.visualSessionData = sessionData;
          this.isHighFidelityMode = true;
          console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â¨ [Alta Fidelidad] visual_session.json cargado. Capas: ${layers.length}`);
        } else {
          console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â [Alta Fidelidad] JSON sin capas vÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lidas. Activando modo Legacy.');
        }
        this.cargarGPXYAbrirModal(actividadId);
      },
      error: (err) => {
        // 404 es esperado si la actividad no tiene sesiÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n visual ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ fallback limpio
        const statusCode = err?.status;
        if (statusCode === 404) {
          console.log('ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â [Legacy] No hay visual_session.json para esta actividad. Usando GPX.');
        } else {
          console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â [Legacy] Error descargando visual_session.json:', err?.message);
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
      error: err => console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error obteniendo GPX:', err)
    });
  }

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NUEVO: Animar GPX con multimedia (MEJORADO: Carga estadÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­sticas primero)
  animarGPX(actividadId: number): void {
    console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â¬ Iniciando proceso de animaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n para actividad:', actividadId);

    // 1. PASO 1: Asegurar que tengamos las estadÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­sticas para los segmentos de transporte
    this.actividadService.obtenerEstadisticas(actividadId).subscribe({
      next: (stats) => {
        console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€¦Ã‚Â  EstadÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­sticas cargadas para animaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n:', stats);
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

        // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NUEVO: Intentar cargar visual_session.json antes de lanzar la animaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n
        this.actividadService.obtenerVisualSession(actividadId).subscribe({
          next: (sessionData) => {
            const layers = sessionData?.layers || sessionData?.mapState?.layers;
            if (layers && layers.length > 0) {
              sessionData.layers = layers;
              this.visualSessionData = sessionData;
              this.isHighFidelityMode = true;
              console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â¨ [AnimaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n] Modo Alta Fidelidad activado.');
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
        console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error cargando estadÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­sticas para animaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n:', err);
        this.desgloseTransporteAnimacion = [];
        this.continuarCargaAnimacion(actividadId);
      }
    });
  }

  /** Paso 2 y 3 de la animaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n: Multimedia y GPX */
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
            
            console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â¬ Lanzando reproductor animado con', this.desgloseTransporteAnimacion.length, 'segmentos');
            this.mostrarReproductorAnimado = true;
            this.cdr.detectChanges();
          },
          error: err => console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error obteniendo GPX para animaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n:', err)
        });
      },
      error: err => console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error obteniendo multimedia para animaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n:', err)
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

      console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ GPX parseado. Coordenadas vÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lidas extraÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­das:', this.coordenadasGPX.length);

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
          console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ Punto de giro detectado en GPX:', this.turningPoint);
          break;
        }
      }
    } catch (e) {
      console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ ExcepciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n atrapada en parseGPX:', e);
      this.coordenadasGPX = [];
    }
  }

  // Inicializar mapa Leaflet con satÃƒÆ’Ã‚Â©lite y fotos
  inicializarMapaGPX(): void {
    if (this.coordenadasGPX.length === 0) {
      console.warn('ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No hay coordenadas para mostrar');
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
        console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Contenedor del mapa no encontrado');
        return;
      }
      container.innerHTML = '';

      try {
        this.mapaGPX = L.map(container, {
          attributionControl: true,
          zoomControl: true,
          preferCanvas: true
        }).setView([this.coordenadasGPX[0][0], this.coordenadasGPX[0][1]], 13);

        // --- CAPAS BASE (SATÃƒâ€°LITE Y MAPA) ---
        const satellite = L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          { attribution: 'Tiles &copy; Esri', maxZoom: 18 }
        );
        const streets = L.tileLayer(
          'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
          { attribution: '&copy; OpenStreetMap', maxZoom: 19 }
        );
        
        satellite.addTo(this.mapaGPX); // Capa por defecto

        // Control de capas
        const layersControl = L.control.layers(
          { 'SatÃƒÂ©lite': satellite, 'Mapa': streets },
          {},
          { position: 'topleft' }
        ).addTo(this.mapaGPX);

        // Mover el control de capas a la mitad izquierda de la pantalla
        const layersContainer = layersControl.getContainer();
        if (layersContainer) {
          layersContainer.classList.add('capas-medio-izq');
        }

        // Dibujar ruta con polyline roja robusta
        L.polyline(this.coordenadasGPX, {
          color: '#FF0000',
          weight: 4,
          opacity: 0.85,
          smoothFactor: 1
        }).addTo(this.mapaGPX);

        this.addDirectionArrows(L, this.coordenadasGPX);

        // Marcador de INICIO (verde)
        const inicioIcon = L.divIcon({
          className: 'custom-div-icon',
          html: `<div style="background-color: #4CAF50; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7]
        });
        L.marker(this.coordenadasGPX[0], { icon: inicioIcon }).bindPopup('ÃƒÂ°Ã…Â¸Ã‚ÂÃ‚Â Inicio').addTo(this.mapaGPX);

        // Marcador de FIN (rojo)
        const finIcon = L.divIcon({
          className: 'custom-div-icon',
          html: `<div style="background-color: #F44336; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7]
        });
        L.marker(this.coordenadasGPX[this.coordenadasGPX.length - 1], { icon: finIcon }).bindPopup('ÃƒÂ°Ã…Â¸Ã‚ÂÃ‚Â Fin').addTo(this.mapaGPX);

        // Marcadores de fotos/vÃƒÆ’Ã‚Â­deos (Popups enriquecidos desde Phase 2.6)
        this.cargarYAnadirFotos();

        const bounds = L.latLngBounds(this.coordenadasGPX);
        this.mapaGPX.fitBounds(bounds, { padding: [50, 50] });

        setTimeout(() => { if (this.mapaGPX) this.mapaGPX.invalidateSize(); }, 120);

      } catch (error) {
        console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error inicializando Leaflet:', error);
      }
    });
  }

  // Helper para el contenido del popup contextual enriquecido (Fase 4 - Bloque C)
  private crearPopupContent(archivos: any[], numeroSecuencial: number, cantidadArchivos: number, tieneMultiples: boolean): string {
    const primerArchivo = archivos[0].archivo;
    
    let popupContent = `
        <div class="photo-popup-custom" style="width: 320px; min-width: 250px; max-width: 600px; resize: horizontal; overflow: hidden; font-family: sans-serif; display: flex; flex-direction: column;">
          <div class="photo-popup-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="background: #3b82f6; color: white; border-radius: 4px; padding: 2px 6px; font-size: 12px; font-weight: bold;">#${numeroSecuencial}</span>
              <strong style="font-size: 14px; color: #334155;">${tieneMultiples ? `${cantidadArchivos} archivos` : 'Vista Previa'}</strong>
            </div>
            <span style="font-size: 10px; color: #64748b;">(Clic en miniatura para ver)</span>
          </div>
          <div class="photo-popup-body" style="display: flex; flex-direction: column; gap: 12px; max-height: 45vh; overflow-y: auto; overflow-x: hidden; padding-right: 5px;">
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
          locationTag = `<div id="lugar-popup-${archivo.id}" style="font-size: 11px; color: #64748b; margin-top: 4px;"><i class="fa fa-map-marker"></i> <span class="lugar-texto">ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â Cargando ubicaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n...</span></div>`;
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

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ NUEVO: Cargar fotos y videos desde backend y aÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â±adirlas al mapa con agrupaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n
  private cargarYAnadirFotos(): void {
    if (!this.mapaGPX || !this.actividadSeleccionada) {
      console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Mapa o ID de actividad no disponible');
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
            console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Error al cargar archivos asociados, continuando sin audios', err);
            this.procesarArchivosYMarcadores(archivos, []);
          }
        });
      },
      error: err => {
        console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error cargando archivos:', err);
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
      
      // 2. Extraer Lugar (Parseo conservador de la ubicaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n texto)
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
        console.warn(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Error parseando ${archivo.nombreArchivo}:`, err);
      }
      return null;
    }).filter(Boolean);

    archivosConCoordenadas.sort((a, b) => {
      const timeA = new Date(a!.timestamp).getTime() || 0;
      const timeB = new Date(b!.timestamp).getTime() || 0;
      return timeA - timeB;
    });

    const grupos = this.agruparArchivosPorUbicacion(archivosConCoordenadas);
    this.gruposEditor = grupos; // Almacenar para pasar al editor

    // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ FASE 2: Sincronizar array lineal con los grupos del mapa
    this.fotosActividad = [];

    grupos.forEach((grupo, index) => {
      const numeroSecuencial = index + 1;
      
      this.anadirMarcadorGrupo(
        grupo.lat,
        grupo.lng,
        grupo.archivos,
        numeroSecuencial
      );

      // Alimentar la galerÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­a lateral con el orden y nÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âºmero exacto del mapa
      grupo.archivos.forEach((item: any) => {
        item.archivo.numeroSecuencial = numeroSecuencial;
        this.fotosActividad.push(item.archivo);
      });
    });
  }

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NUEVO: Agrupar archivos por coordenadas cercanas
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

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NUEVO: AÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â±adir marcador de grupo con contador y nÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âºmero secuencial
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
          <!-- Pin clÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡sico mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³vil -->
          <svg width="44" height="44" viewBox="0 0 44 44" style="filter: drop-shadow(0px 3px 3px rgba(0,0,0,0.4)); z-index: 5;">
            <path d="M22 2 C14 2 8 8 8 16 C8 26 22 42 22 42 C22 42 36 26 36 16 C36 8 30 2 22 2 Z" fill="#E53935" />
            <circle cx="22" cy="16" r="6" fill="white" />
          </svg>
          <!-- Badge numÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©rico mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³vil -->
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
      
      // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NUEVO: Guardar referencia del marcador en cada archivo para sincronizaciÃƒÆ’Ã‚Â³n
      archivos.forEach(a => {
        a.archivo.marcadorRef = marker;
      });

      // Crear el contenido del Popup
      const popupHTML = this.crearPopupContent(archivos, numeroSecuencial, cantidadArchivos, tieneMultiples);
      const popupDiv = document.createElement('div');
      popupDiv.innerHTML = popupHTML;

      // LÃƒÂ³gica de Zoom (redimensiÃƒÂ³n) con rueda del ratÃƒÂ³n (Requiere clic previo para activar)
      const customPopup = popupDiv.querySelector('.photo-popup-custom') as HTMLElement;
      if (customPopup) {
        let currentWidth = parseInt(customPopup.style.width || '320', 10);
        let isFocused = false;

        // Detectar clic en el fondo para activar el modo zoom
        customPopup.addEventListener('click', (event: MouseEvent) => {
          const target = event.target as HTMLElement;
          // Si no han hecho clic en una miniatura ni en la cabecera
          if (!target.closest('.clickable-media') && !target.closest('.leaflet-popup-close-button')) {
            isFocused = true;
            // Feedback visual de que el popup estÃƒÂ¡ activo
            customPopup.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.5)';
            customPopup.style.transition = 'box-shadow 0.3s ease';
          }
        });

        customPopup.addEventListener('wheel', (event: WheelEvent) => {
          // Solo hacemos zoom si el popup ha sido "enfocado" y no presionan Shift
          if (isFocused && !event.shiftKey) {
            event.preventDefault(); // Evitar scroll vertical
            const zoomIn = event.deltaY < 0;
            currentWidth += zoomIn ? 60 : -60;
            currentWidth = Math.max(250, Math.min(800, currentWidth));
            customPopup.style.width = currentWidth + 'px';
            
            // TambiÃƒÂ©n forzamos el ancho del contenedor padre de Leaflet
            const leafletContent = customPopup.closest('.leaflet-popup-content') as HTMLElement;
            if (leafletContent) {
              leafletContent.style.width = currentWidth + 'px';
            }
            
            // Forzar a Leaflet a recalcular la posiciÃƒÂ³n
            const popup = marker.getPopup();
            if (popup) setTimeout(() => popup.update(), 10);
          }
        }, { passive: false });
      }

      const clickables = popupDiv.querySelectorAll('.clickable-media');
      clickables.forEach((el: any) => {
        el.addEventListener('click', (event: MouseEvent) => {
          const index = parseInt(el.getAttribute('data-index') || '0', 10);
          
          if (event.shiftKey || !tieneMultiples) {
            // Si presionan SHIFT o solo hay una foto, abrir directamente
            const item = archivos[index].archivo;
            this.ngZone.run(() => this.abrirModalMultimedia(item.rutaArchivo, item.nombreArchivo, item.tipo));
          } else {
            // Comportamiento normal: modal de grupo
            this.ngZone.run(() => this.abrirModalGrupo(archivos, numeroSecuencial));
          }
        });
      });

      marker.bindPopup(popupDiv, {
          autoPan: false,
          className: 'photo-popup-leaflet',
          minWidth: 250,
          maxWidth: 600
        });

      // Guardar referencia de los archivos
      (marker as any).archivosGrupo = archivos;
      (marker as any).numeroSecuencial = numeroSecuencial;

      marker.on('popupopen', (e: any) => {

        // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ NUEVO: Disparar la geocodificaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n inversa de Nominatim bajo demanda
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
            }).catch(err => console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€š  Error obteniendo direccion para popup', err));
          }
        });
      });

      console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Marcador #${numeroSecuencial} aÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â±adido: ${cantidadArchivos} archivo(s) en [${lat}, ${lng}]`);
    });
  }

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ NUEVO: Abrir modal con foto o video
  private abrirModalMultimedia(rutaArchivo: string, nombre: string, tipo: string): void {
    console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š  Abriendo archivo:', nombre, 'Tipo:', tipo);
    console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€š  rutaArchivo:', rutaArchivo);

    const backendUrl = environment.apiUrl;
    const urlArchivo = `${backendUrl}/uploads/${rutaArchivo}`;

    console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¼ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€š  URL final del archivo:', urlArchivo);

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
    const emoji = esFoto ? 'ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â·' : 'ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â¬';
    const etiqueta = esFoto ? 'Foto' : 'Video';

    const titulo = document.createElement('h3');
    titulo.textContent = `${emoji} ${etiqueta}`;
    titulo.style.cssText = 'margin: 0 0 10px 0; color: #333;';

    // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ CREAR ELEMENTO SEGÃƒÆ’Ã†â€™Ãƒâ€¦Ã‚Â¡N EL TIPO
    let mediaElement: HTMLImageElement | HTMLVideoElement;

    if (esFoto) {
      // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ MEJORADO: Usar el visualizador avanzado en nueva ventana
      const backendUrl = environment.apiUrl;
      const urlArchivo = `${backendUrl}/uploads/${rutaArchivo}`;
      const fullUrl = `${window.location.origin}/visualizador-foto?url=${encodeURIComponent(urlArchivo)}&descripcion=${encodeURIComponent(nombre)}`;

      window.open(fullUrl, '_blank', 'noopener,noreferrer');
      return;

      // CÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³digo antiguo para fallback o por si falla la ventana
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
        console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€š Ãƒâ€¦Ã¢â‚¬â„¢ Error cargando imagen desde:', urlArchivo);
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
        console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€š Ãƒâ€¦Ã¢â‚¬â„¢ Error cargando video desde:', urlArchivo);
        video.style.background = '#ff6b6b';
      };

      mediaElement = video;
    }

    const nombreEl = document.createElement('p');
    nombreEl.textContent = nombre;
    nombreEl.style.cssText = 'font-size: 12px; color: #999; margin: 10px 0;';

    // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ CONTENEDOR DE BOTONES
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

    // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ NUEVO BOTÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œN: VER EN LISTA DE ARCHIVOS
    const btnVerArchivo = document.createElement('button');
    btnVerArchivo.textContent = 'ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€š  Ver en Archivos';
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
      console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬ ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Navegando a archivos...');
      modal.remove();

      // Navegar a la pÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡gina de archivos
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

    console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Modal de ${etiqueta} abierto`);
  }

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NUEVO: Abrir modal con grupo de archivos (carrusel)
  private abrirModalGrupo(archivos: any[], numeroSecuencial: number): void {
    console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š  Abriendo grupo #${numeroSecuencial} con ${archivos.length} archivo(s)`);

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

    // FunciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n para actualizar el contenido del modal
    const actualizarContenido = () => {
      const item = archivos[indiceActual];
      const archivo = item.archivo;
      const esFoto = archivo.tipo === 'foto';
      const emoji = esFoto ? 'ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â·' : 'ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â¬';
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
          ">ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Cerrar</button>
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
            ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â Ãƒâ€š  Anterior
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
            Siguiente ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢
          </button>
        </div>
        ` : ''}
      `;

      // AÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â±adir event listeners
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

      // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ NUEVO: Click en la imagen para abrir visualizador avanzado
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

    console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Modal de grupo abierto`);
  }

  // Ver Mapa PNG - Muestra en modal
  verMapa(actividadId: number): void {
    console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬ÂÃƒâ€šÃ‚ÂºÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€š  Obteniendo mapa para actividad:', actividadId);
    this.actividadSeleccionada = actividadId;
    this.actividadService.obtenerMapa(actividadId).subscribe({
      next: (blob) => {
        const reader = new FileReader();
        reader.onload = (e: any) => {
          this.urlMapaDataURL = e.target.result;
          this.mostrarModalMapa = true;
          console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Mapa cargado en modal');
        };
        reader.readAsDataURL(blob);
      },
      error: err => console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€š Ãƒâ€¦Ã¢â‚¬â„¢ Error obteniendo mapa:', err)
    });
  }

  // Ver EstadÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­sticas - Muestra en modal
  verEstadisticas(actividadId: number): void {
    console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€¦Ã‚Â  Obteniendo estadÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­sticas para actividad:', actividadId);
    this.actividadSeleccionada = actividadId;
    this.actividadService.obtenerEstadisticas(actividadId).subscribe({
      next: (datos) => {
        this.estadisticasActuales = datos;
        this.mostrarModalEstadisticas = true;
        console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ EstadÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­sticas cargadas:', datos);
      },
      error: err => console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€š Ãƒâ€¦Ã¢â‚¬â„¢ Error obteniendo estadÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­sticas:', err)
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

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NUEVO: Toggle panel de estadÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­sticas
  toggleSidePanel(): void {
    this.showSidePanel = !this.showSidePanel;
    console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬ÂÃƒâ€šÃ‚ÂºÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€š  Panel lateral: ${this.showSidePanel ? 'VISIBLE' : 'OCULTO'}`);
    
    // Invalida el tamaÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â±o del mapa poco despuÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©s para que se adapte al contenedor redimensionado
    if (this.mapaGPX) {
      setTimeout(() => {
        this.mapaGPX.invalidateSize(true);
      }, 300);
    }
  }

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NUEVO: Expandir/contraer panel
  togglePanelExpanded(): void {
    this.panelExpanded = !this.panelExpanded;
    console.log(`ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€¦Ã‚Â  Panel: ${this.panelExpanded ? 'EXPANDIDO' : 'CONTRAÃƒÆ’Ã†â€™Ãƒâ€š DO'}`);
  }

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NUEVO: Ajustar vista del mapa al track completo
  fitMapToTrack(): void {
    if (!this.mapaGPX || this.coordenadasGPX.length === 0) {
      console.warn('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€š  No hay mapa o coordenadas disponibles');
      return;
    }

    import('leaflet').then(L => {
      const bounds = L.latLngBounds(this.coordenadasGPX);
      this.mapaGPX.fitBounds(bounds, { padding: [50, 50], maxZoom: 16, animate: true });
      console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Vista ajustada al track completo');
    });
  }

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NUEVO: Obtener emoji de transporte
  getTransportEmoji(iconName: string): string {
    const emojiMap: { [key: string]: string } = {
      'walk': 'ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â¶',
      'fitness': 'ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€š Ãƒâ€ Ã¢â‚¬â„¢',
      'bicycle': 'ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â´',
      'car': 'ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â'
    };
    return emojiMap[iconName] || 'ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€š ';
  }

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NUEVO: Formatear distancia
  formatDistance(meters: number): string {
    if (meters < 1000) {
      return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(2)} km`;
  }

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NUEVO: Formatear duraciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n
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

  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ MEJOR OPCIÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œN: Flechas SVG (escalables sin pixelar)
  private addDirectionArrows(L: any, coordinates: any[], color: string = '#FF0000', opacity: number = 1): void {
    if (!this.mapaGPX || coordinates.length < 2) return;

    const totalPoints = coordinates.length;
    // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ FASE 1 (IteraciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n 3): Chevron minimalista, muy sutil
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
          <!-- LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­nea de color semÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡ntico -->
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

    console.log(`ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ ${Math.floor(totalPoints / interval)} flechas SVG aÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â±adidas`);
  }


  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ NUEVO: Calcular ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡ngulo entre dos puntos
  private calculateAngle(pointA: number[], pointB: number[]): number {
    const lat1 = pointA[0];
    const lng1 = pointA[1];
    const lat2 = pointB[0];
    const lng2 = pointB[1];

    // Convertir a radianes
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;

    // Calcular ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡ngulo
    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
      Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

    const bearing = Math.atan2(y, x) * 180 / Math.PI;

    // Normalizar a 0-360
    return (bearing + 360) % 360;
  }

  // ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ NUEVO: Funciones trackBy para rendimiento
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

  // ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ NUEVO: FunciÃƒÆ’Ã‚Â³n para determinar si el archivo es un vÃƒÆ’Ã‚Â­deo
  esVideo(foto: any): boolean {
    if (foto.tipo === 'video') return true;
    if (!foto.rutaArchivo) return false;
    const extension = foto.rutaArchivo.split('.').pop()?.toLowerCase();
    return ['mp4', 'mov', 'avi', 'webm'].includes(extension);
  }

  centrarEnFoto(foto: any): void {
    if (foto.marcadorRef && this.mapaGPX) {
      if (this.coordenadasGPX && this.coordenadasGPX.length > 0) {
        import('leaflet').then(L => {
          // Aseguramos que la ruta completa estÃƒÂ© visible y centrada
          const bounds = L.latLngBounds(this.coordenadasGPX);
          this.mapaGPX.fitBounds(bounds, { padding: [50, 50] });

          // Desactivamos el auto-pan del popup para que no mueva el mapa al abrirse
          const popup = foto.marcadorRef.getPopup();
          if (popup) {
            popup.options.autoPan = false;
          }
          foto.marcadorRef.openPopup();
        });
      } else {
        const popup = foto.marcadorRef.getPopup();
        if (popup) popup.options.autoPan = false;
        foto.marcadorRef.openPopup();
      }
      
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
  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¨ NUEVO: Convertir coordenadas a direcciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n legible bajo demanda usando Nominatim (Fase 4 - Bloque C)
  private async obtenerDireccion(geolocalizacion: string): Promise<string> {
    if (!geolocalizacion || geolocalizacion === 'No disponible') {
      return 'UbicaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n no disponible';
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
        return 'Formato invÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lido';
      }

      if (isNaN(lat) || isNaN(lon)) return 'Coordenadas invÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lidas';

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
        const fallback = `${lat.toFixed(5)}ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°, ${lon.toFixed(5)}ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°`;
        this.direccionesCache[geolocalizacion] = fallback;
        return fallback;
      }

      if (!res.ok) {
        const fallback = `${lat.toFixed(5)}ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°, ${lon.toFixed(5)}ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°`;
        this.direccionesCache[geolocalizacion] = fallback;
        return fallback;
      }

      const data = await res.json();
      if (!data || data.error) {
        const fallback = `${lat.toFixed(5)}ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°, ${lon.toFixed(5)}ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°`;
        this.direccionesCache[geolocalizacion] = fallback;
        return fallback;
      }

      const addr = data.address || {};
      let direccion =
        [addr.road, addr.house_number, addr.suburb, addr.city || addr.town || addr.village, addr.state, addr.country]
          .filter(Boolean)
          .join(', ');

      if (!direccion && data.display_name) direccion = data.display_name;
      if (!direccion) direccion = `${lat.toFixed(5)}ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°, ${lon.toFixed(5)}ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°`;

      this.direccionesCache[geolocalizacion] = direccion;
      return direccion;
    } catch (e: any) {
      console.error('Error obteniendo direcciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n:', e);
      try {
        const coords = JSON.parse(geolocalizacion);
        const fallback = `${coords.latitud.toFixed(5)}ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°, ${coords.longitud.toFixed(5)}ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°`;
        this.direccionesCache[geolocalizacion] = fallback;
        return fallback;
      } catch {
        return 'UbicaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n no disponible';
      }
    }
  }

  // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š 
  // ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€š ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€š  EDITOR DE RECORRIDO GPX (Fase 1 y 2.1)
  // ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬ Ãƒâ€š 

  abrirEditorTrack(actividadId: number): void {
    console.log('Abriendo editor de recorrido para actividad:', actividadId);
    this.actividadEditorId = actividadId;

    // IMPORTANTE: No cargar TrackEdits antiguos. Ver GPX es la verdad absoluta.
    // El editor arranca limpio con los segmentos puros.
    this.editsEditor = [];

    // Cargar Segmentos
    this.trackEditorService.getSegments(actividadId).subscribe({
      next: (segments) => {
        if (segments && segments.length > 0) {
          this.gpxPointsEditor = this.trackEditorService.replaySegments(segments);
          this.mostrarEditorTrack = true;
          this.cdr.detectChanges();
        } else {
          this.actividadService.obtenerGPX(actividadId).subscribe({
            next: (blob) => {
              const reader = new FileReader();
              reader.onload = (e: any) => {
                this.gpxPointsEditor = this.gpxAnimationService.parseGpx(e.target.result);
                this.trackEditorService.createSegment(actividadId, this.gpxPointsEditor, 'original').subscribe({
                  next: () => console.log('GPX base migrado exitosamente a segments'),
                  error: err => console.error('Error migrando GPX base a segments:', err)
                });
                this.mostrarEditorTrack = true;
                this.cdr.detectChanges();
              };
              reader.readAsText(blob);
            },
            error: err => console.error('Error cargando GPX para editor:', err)
          });
        }
      },
      error: err => console.error('Error cargando segments para editor:', err)
    });
  }

  cerrarEditorTrack(): void {
    this.mostrarEditorTrack = false;
    this.gpxPointsEditor = [];
    this.editsEditor = [];
    this.actividadEditorId = null;
    this.cdr.detectChanges();
  }

  async onSaveAllEdits(pendingEdits: any[]): Promise<void> {
    if (!this.actividadEditorId || !pendingEdits || pendingEdits.length === 0) return;

    console.log('Guardando todos los cambios pendientes:', pendingEdits);
    try {
      for (const edit of pendingEdits) {
        if (edit.type === 'delete_segment') {
          // Extraer los puntos en formato simple {lat, lng, time}
          const points = [
            {
              lat: edit.data.startAnchor.lat,
              lng: edit.data.startAnchor.lng,
              time: edit.data.startAnchor.time ? new Date(edit.data.startAnchor.time).toISOString() : undefined
            },
            {
              lat: edit.data.endAnchor.lat,
              lng: edit.data.endAnchor.lng,
              time: edit.data.endAnchor.time ? new Date(edit.data.endAnchor.time).toISOString() : undefined
            }
          ];
          
          await firstValueFrom(this.trackEditorService.createSegment(
            this.actividadEditorId, 
            points, 
            'user-delete'
          ));
        }
      }
      
      console.log('✅ Todos los cambios guardados correctamente.');
      
      const segments = await firstValueFrom(this.trackEditorService.getSegments(this.actividadEditorId));
      this.gpxPointsEditor = this.trackEditorService.replaySegments(segments);
      
      alert('Cambios guardados con éxito.');
      this.cerrarEditorTrack();
      
    } catch (err) {
      console.error('❌ Error guardando cambios:', err);
      alert('Error guardando los cambios. Revisa la consola.');
    }
  }
  onTrackEditRequest(event: any): void {
    if (!this.actividadEditorId) return;

    console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Guardando ediciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n:', event);

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
        console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ EdiciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n guardada con ID:', savedEdit.id);
        this.editsEditor = [...this.editsEditor, savedEdit];
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error guardando ediciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n:', err);
        alert('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error guardando la ediciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n. Revisa la consola.');
      }
    });
  }

  onAppendRequest(event: { points: { lat: number; lng: number }[] }): void {
    if (!this.actividadEditorId || !event.points || event.points.length === 0) return;

    console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Guardando Append:', event.points.length, 'puntos');

    this.trackEditorService.createSegment(this.actividadEditorId, event.points, 'user-append').subscribe({
      next: (resp) => {
        console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Segment append guardado con id:', resp.id, 'order:', resp.segmentOrder);

        // Calcular timestamps monotÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³nicos y concatenar al array local
        const appendedGpxPoints = this.trackEditorService.applyAppendWithTimestamps(
          this.gpxPointsEditor,
          event.points
        );

        this.gpxPointsEditor = [...this.gpxPointsEditor, ...appendedGpxPoints];
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error guardando segment append:', err);
        alert('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error guardando el tramo. Revisa la consola.');
      }
    });
  }

  onInsertRequest(event: { points: { lat: number; lng: number; time?: string }[] }): void {
    if (!this.actividadEditorId || !event.points || event.points.length < 2) return;

    console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â Guardando Insert:', event.points.length, 'puntos');

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
        console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Segment insert guardado con id:', resp.id, 'order:', resp.segmentOrder);

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
        console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error guardando segment insert:', err);
        alert('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error guardando el tramo insertado. Revisa la consola.');
      }
    });
  }

  onOverrideModeRequest(event: { points: { lat: number; lng: number; time?: string; mode?: string }[] }): void {
    if (!this.actividadEditorId || !event.points || event.points.length < 2) return;

    console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ Guardando Override de Modo de Transporte:', event.points.length, 'puntos');

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
        console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Segment override guardado con id:', resp.id, 'order:', resp.segmentOrder);

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
        console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error guardando segment override:', err);
        alert('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error guardando el cambio de transporte. Revisa la consola.');
      }
    });
  }

  onDeleteRequest(event: { anchorA: any; anchorB: any }): void {
    if (!this.actividadEditorId || !event.anchorA || !event.anchorB) return;

    console.log('ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ Guardando Delete de Tramo:', event.anchorA, event.anchorB);

    // Mapear al formato de persistencia plano: sÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³lo guardamos las dos anclas
    const payload = [
      { lat: event.anchorA.lat, lng: event.anchorA.lng, time: event.anchorA.time },
      { lat: event.anchorB.lat, lng: event.anchorB.lng, time: event.anchorB.time }
    ];

    // Guardar como 'user-delete'
    this.trackEditorService.createSegment(this.actividadEditorId, payload, 'user-delete').subscribe({
      next: (resp) => {
        console.log('ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Segment delete guardado con id:', resp.id, 'order:', resp.segmentOrder);

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
        console.error('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error guardando segment delete:', err);
        alert('ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Error guardando el borrado del tramo. Revisa la consola.');
      }
    });
  }

}


