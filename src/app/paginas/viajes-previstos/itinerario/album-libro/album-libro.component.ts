import { Component, OnInit, OnDestroy, HostListener, ChangeDetectorRef, NgZone } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ArchivoService } from '../../../../servicios/archivo.service';
import { ViajesPrevistosService } from '../../../../servicios/viajes-previstos.service';
import { ItinerarioService } from '../../../../servicios/itinerario.service';
import { ActividadesItinerariosService } from '../../../../servicios/actividades-itinerarios.service';
import { CommonModule } from '@angular/common';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../../../environments/environment';
import { Archivo } from '../../../../modelos/archivo';
import { Subject, takeUntil, take } from 'rxjs';  // ✅ AGREGAR 'take'
import { firstValueFrom } from 'rxjs';

import { GeocodificacionService, UbicacionReversa } from '../../../../servicios/geocodificacion.service';
import { VideoGeneratorService, ProgresoVideo } from '../../../../servicios/video-generator.service';
import { EscenaMultimedia, ConfiguracionExportacion } from '../../../../modelos/escena-multimedia';

import { GpxAnimationComponent } from '../../../../componentes/reproductor-animado-gpx/gpx-animation.component';
import { GpxAnimationService } from '../../../../servicios/gpx-animation.service';
import { TrackEditorService } from '../../../../servicios/track-editor.service';

// ==========================================
// TIPOS E INTERFACES
// ==========================================

// Tipos de archivos multimedia soportados
export type TipoMedia = 'imagen' | 'video' | 'audio' | 'documento' | 'pdf' | 'texto' | 'carta-manuscrita' | 'mapa-animado' | 'desconocido';

interface PaginaMedia {
  archivo: Archivo;
  url: string;
  titulo: string;
  descripcion: string;
  fecha: string;
  fechaOriginal?: string;
  tipoMedia: TipoMedia;
  mimeType: string;
  tamano?: number;
  duracion?: string;
  dimensiones?: string;
  cargado?: boolean;
  esIndice?: boolean;
  esCartaManuscrita?: boolean;
  esMapaAnimado?: boolean;
  trackGpx?: string;
  distanciaTramoKm?: number;
  transportSegments?: any[];
  actividadId?: number;
  coordenadas?: {
    latitud: number;
    longitud: number;
    altitud?: number;
  };
  archivosAsociados?: any[];
}

interface ContextoViaje {
  viajeId: number;
  itinerarioId?: number;
  actividadId?: number;
}

interface InfoViaje {
  nombre: string;
  fechaInicio?: string;
  fechaFin?: string;
  imagen?: string;
  audio?: string;
}

interface CoordenadaDMS {
  grados: number;
  minutos: number;
  segundos: number;
  direccion: 'N' | 'S' | 'E' | 'W';
}

interface CoordenadasDMS {
  latitud: CoordenadaDMS;
  longitud: CoordenadaDMS;
  altitud?: number;
}

@Component({
  selector: 'app-album-libro',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule, FormsModule, GpxAnimationComponent],
  templateUrl: './album-libro.component.html',
  styleUrls: ['./album-libro.component.scss']
})
export class AlbumLibroComponent implements OnInit, OnDestroy {

  // ==========================================
  // PROPIEDADES DE ESTADO DEL ÁLBUM
  // ==========================================

  paginas: PaginaMedia[] = [];
  paginaActual = 0;
  estado: 'portada' | 'abierto' | 'contraportada' = 'portada';

  // ==========================================
  // PROPIEDADES PARA AUDIO DEL VIAJE
  // ==========================================

  audioViaje: HTMLAudioElement | null = null;
  audioReproduciendo = false;
  audioDisponible = false;
  volumenOriginal = 1;

  // ==========================================
  // PROPIEDADES DE CONTEXTO Y DATOS
  // ==========================================

  infoViaje: InfoViaje | null = null;
  contextoViaje: ContextoViaje | null = null;
  listaItinerarios: any[] = [];

  // ==========================================
  // PROPIEDADES DE FULLSCREEN
  // ==========================================

  mediaFullscreen = '';
  tipoFullscreen: TipoMedia = 'imagen';
  mostrarFullscreen = false;
  // Nuevas propiedades para carta-manuscrita en fullscreen
  fullscreenTitulo = '';
  fullscreenDescripcion = '';
  mostrarInfo = false;
  mostrarInfoFullscreen = false;

  // ✅ NUEVAS PROPIEDADES PARA ARCHIVOS ASOCIADOS
  mostrarModalGPXIndividual = false;
  mapaGPXIndividual: any = null;
  coordenadasGPXIndividual: any[] = [];


  toggleFileInfoFullscreen() {
    this.mostrarInfoFullscreen = !this.mostrarInfoFullscreen;
  }

  toggleFileInfo() {
    this.mostrarInfo = !this.mostrarInfo;
  }

  // ==========================================
  // PROPIEDADES PARA LA INFORMACIÓN DEL ARCHIVO
  // ==========================================

  // Controla si se muestra el tooltip/modal de información
  mostrarInfoDetalle: boolean = false;
  timeoutOcultarInfo: any = null;

  // ==========================================
  // PROPIEDADES PARA SLIDESHOW (PASE DE DIAPOSITIVAS)
  // ==========================================
  reproduciendoSlideshow: boolean = false;
  private timerSlideshow: any = null;
  transicionActual: string = 'fade'; // fade, slide-left, slide-right, zoom-in, zoom-out
  private readonly INTERVALO_SLIDESHOW = 5000; // 5 segundos
  private readonly TRANSICIONES = ['fade', 'slide-left', 'slide-right', 'zoom-in', 'zoom-out'];


  // Determina si debe mostrarse como modal (móviles) o tooltip (desktop)
  get infoDetalleEsModal(): boolean {
    return window.innerWidth <= 768;  // ✅ CORREGIDO: Solo detección de ancho de pantalla
  }


  private infoTimeout?: number;

  // ==========================================
  // PROPIEDADES DE ESTADO DE CARGA Y ERRORES
  // ==========================================

  isLoading = false;
  error: string | null = null;
  noArchivosEncontrados = false;
  imagenViajeError = false;
  isMobile = false;

  // ==========================================
  // PROPIEDADES PRIVADAS Y CACHÉ
  // ==========================================

  private imagenViajeUrlCache: string | null = null;
  private destroy$ = new Subject<void>();
  private ubicacionesCache = new Map<string, string>();


  // ==========================================
  // CONFIGURACIÓN DE MAPAS ANIMADOS POR TRAMOS
  // ==========================================
  incluirAnimacionesMapa: boolean = false;
  distanciaMinimaAnimacionKm: number = 2.0;
  paginasBase: PaginaMedia[] = [];

  // Extensiones de archivo por tipo
  private readonly EXTENSIONES_IMAGEN = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.tiff'];
  private readonly EXTENSIONES_VIDEO = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v'];
  private readonly EXTENSIONES_AUDIO = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.wma'];
  private readonly EXTENSIONES_PDF = ['.pdf'];
  private readonly EXTENSIONES_DOCUMENTO = ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf'];

  // ==========================================
  // CONSTRUCTOR
  // ==========================================

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private archivoService: ArchivoService,
    private viajesPrevistosService: ViajesPrevistosService,
    private itinerarioService: ItinerarioService,
    private actividadesItinerariosService: ActividadesItinerariosService,
    private geocodificacionService: GeocodificacionService,
    public videoGeneratorService: VideoGeneratorService,
    private gpxAnimationService: GpxAnimationService,
    private trackEditorService: TrackEditorService,
    private cdr: ChangeDetectorRef,  // ✅ NUEVO
    private ngZone: NgZone  // ✅ NUEVO
  ) { }


  // ==========================================
  // MÉTODOS DEL CICLO DE VIDA DEL COMPONENTE
  // ==========================================

  async ngOnInit(): Promise<void> {
    console.log('🔄 ngOnInit() ejecutado');
    await this.inicializarComponente();
    this.inicializarAudioViaje();

    // ✅ NUEVO: Cargar archivos asociados después de cargar páginas
    setTimeout(() => {
      this.cargarArchivosAsociados();
    }, 500);
  }


  ngOnDestroy(): void {
    console.log('🧹 ngOnDestroy() ejecutado');
    this.destroy$.next();
    this.destroy$.complete();

    // Limpiar timeouts y estilos
    if (this.infoTimeout) {
      clearTimeout(this.infoTimeout);
    }
    document.body.style.overflow = '';

    // Limpiar audio
    this.limpiarAudioViaje();

    // Limpiar slideshow
    this.detenerSlideshow();
  }

  // ============================================
  // ✅ MÉTODOS PARA ARCHIVOS ASOCIADOS
  // ============================================

  private cargarArchivosAsociados(): void {
    console.log('📥 Iniciando carga de archivos asociados...');

    let pendientes = 0;

    this.paginas.forEach((pagina: any) => {  // ✅ CAMBIO: usa 'any'
      if (pagina.archivo?.id && (pagina.tipoMedia === 'imagen' || pagina.tipoMedia === 'video' || pagina.tipoMedia === 'audio')) {
        pendientes++;
        this.archivoService.getArchivosAsociados(pagina.archivo.id).subscribe({
          next: asociados => {
            pagina.archivosAsociados = asociados;  // ✅ Ya no hay error de tipo
            console.log(`✅ Archivo ${pagina.archivo.id} - Asociados:`, asociados);
            pendientes--;
            if (pendientes === 0) {
              console.log('🎉 Todos los archivos asociados cargados');
              this.cdr.detectChanges();
            }
          },
          error: err => {
            console.error(`Error cargando asociados para ${pagina.archivo?.id}:`, err);
            pagina.archivosAsociados = [];
            pendientes--;
            if (pendientes === 0) {
              this.cdr.detectChanges();
            }
          }
        });
      }
    });

    if (pendientes === 0) {
      console.log('ℹ️ No hay archivos multimedia para cargar asociados');
    }
  }


  tieneArchivoAsociado(
    archivo: any,
    tipo: 'audio' | 'texto' | 'mapa_ubicacion' | 'gpx' | 'manifest' | 'estadisticas' | 'video' | 'pdf'
  ): boolean {
    return !!archivo?.archivosAsociados?.some((a: any) => a.tipo === tipo);  // ✅ Tipado con 'any'
  }


  abrirArchivoAsociado(
    archivo: any,
    tipo: 'audio' | 'texto' | 'mapa_ubicacion' | 'gpx' | 'manifest' | 'estadisticas' | 'video' | 'pdf'
  ): void {
    const asociado = archivo?.archivosAsociados?.find((a: any) => a.tipo === tipo);  // ✅ Tipado
    if (!asociado) return;

    switch (tipo) {
      case 'audio':
        this.reproducirAudio(asociado);
        break;
      case 'texto':
        this.mostrarTexto(asociado);
        break;
      case 'mapa_ubicacion':
        this.mostrarImagen(asociado);
        break;
      case 'gpx':
        this.mostrarMapaGPXIndividual(asociado);
        break;
      case 'manifest':
        this.mostrarJSON(asociado);
        break;
      case 'estadisticas':
        this.mostrarJSON(asociado);
        break;
      case 'video':
        this.mostrarVideo(asociado);
        break;
      case 'pdf':
        this.mostrarPDF(asociado);
        break;
    }
  }

  /**
   * Obtiene la URL del mapa asociado (PNG) para un archivo multimedia
   */
  getUrlMapaAsociado(pagina: any): string | null {
    const asociado = pagina?.archivosAsociados?.find((a: any) => a.tipo === 'mapa_ubicacion');
    if (!asociado) return null;
    return this.archivoService.getUrlArchivoAsociado(asociado);
  }


  private reproducirAudio(asociado: any): void {
    console.log('🔊 Reproducir audio asociado:', asociado);

    if (!asociado || !asociado.id || !asociado.rutaArchivo) {
      console.error('Audio asociado inválido');
      alert('Audio asociado inválido o incompleto.');
      return;
    }

    const url = this.archivoService.getUrlArchivoAsociado(asociado);
    if (!url) {
      alert('No se pudo obtener la URL del audio asociado.');
      return;
    }

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '20px';
    container.style.left = '50%';
    container.style.transform = 'translateX(-50%)';
    container.style.backgroundColor = 'rgba(0,0,0,0.8)';
    container.style.padding = '10px 20px';
    container.style.borderRadius = '5px';
    container.style.zIndex = '10001';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '10px';

    const audioElement = document.createElement('audio');
    audioElement.controls = true;
    audioElement.src = url;
    audioElement.volume = 1.0;

    const btnCerrar = document.createElement('button');
    btnCerrar.textContent = 'Cerrar';
    btnCerrar.style.cursor = 'pointer';
    btnCerrar.style.background = '#f44336';
    btnCerrar.style.color = 'white';
    btnCerrar.style.border = 'none';
    btnCerrar.style.borderRadius = '3px';
    btnCerrar.style.padding = '5px 10px';
    btnCerrar.onclick = () => {
      audioElement.pause();
      container.remove();
    };

    container.appendChild(audioElement);
    container.appendChild(btnCerrar);
    document.body.appendChild(container);

    audioElement.play().catch(err => {
      console.error('Error reproduciendo audio:', err);
    });
  }

  private mostrarTexto(asociado: any): void {
    if (!asociado.id) {
      console.error('Archivo asociado sin ID');
      alert('No se pudo cargar el texto');
      return;
    }

    this.archivoService.descargarArchivoAsociado(asociado.id).subscribe({
      next: blob => {
        blob.text().then(contenido => {
          alert(`Contenido del texto:\n\n${contenido.substring(0, 1000)}`);
        });
      },
      error: err => {
        console.error('Error mostrando texto:', err);
        alert('No se pudo cargar el texto');
      }
    });
  }

  private mostrarImagen(asociado: any): void {
    console.log('🖼️ Mostrar imagen asociada:', asociado);

    if (!asociado || !asociado.id || !asociado.rutaArchivo) {
      alert('Imagen asociada inválida');
      return;
    }

    const url = this.archivoService.getUrlArchivoAsociado(asociado);
    if (!url) {
      alert('No se pudo obtener la URL de la imagen');
      return;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.95);
    z-index: 10001;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  `;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
    width: 100%;
    height: 85%;
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

    const img = document.createElement('img');
    img.src = url;
    img.style.cssText = `
    display: block;
    width: 100%;
    height: auto;
  `;

    const btnCerrar = document.createElement('button');
    btnCerrar.textContent = 'Cerrar';
    btnCerrar.style.cssText = `
    margin-top: 15px;
    padding: 12px 30px;
    background: #f44336;
    color: white;
    border: none;
    border-radius: 5px;
    font-size: 16px;
    cursor: pointer;
    z-index: 10002;
  `;

    const cerrar = () => {
      document.body.removeChild(overlay);
      document.body.style.overflow = 'auto';
    };

    btnCerrar.onclick = cerrar;

    wrapper.appendChild(img);
    overlay.appendChild(wrapper);
    overlay.appendChild(btnCerrar);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    img.onerror = () => {
      alert('No se pudo cargar la imagen');
      cerrar();
    };
  }

  private mostrarVideo(asociado: any): void {
    if (!asociado || !asociado.id || !asociado.rutaArchivo) {
      alert('Video asociado inválido');
      return;
    }

    const url = this.archivoService.getUrlArchivoAsociado(asociado);
    if (!url) {
      alert('No se pudo obtener la URL del video');
      return;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.95);
    z-index: 10001;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  `;

    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.autoplay = true;
    video.style.cssText = `
    max-width: 90%;
    max-height: 80%;
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  `;

    const btnCerrar = document.createElement('button');
    btnCerrar.textContent = 'Cerrar';
    btnCerrar.style.cssText = `
    margin-top: 20px;
    padding: 12px 30px;
    background: #f44336;
    color: white;
    border: none;
    border-radius: 5px;
    font-size: 16px;
    cursor: pointer;
    z-index: 10002;
  `;

    btnCerrar.onclick = () => {
      video.pause();
      document.body.removeChild(overlay);
      document.body.style.overflow = '';
    };

    overlay.appendChild(video);
    overlay.appendChild(btnCerrar);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
  }

  private mostrarPDF(asociado: any): void {
    if (!asociado || !asociado.id) {
      alert('PDF asociado inválido');
      return;
    }

    const url = this.archivoService.getUrlArchivoAsociado(asociado);
    if (!url) {
      alert('No se pudo obtener la URL del PDF');
      return;
    }

    window.open(url, '_blank');
  }

  private mostrarJSON(asociado: any): void {
    if (!asociado.id) {
      alert('No se pudo cargar el archivo JSON');
      return;
    }

    this.archivoService.descargarArchivoAsociado(asociado.id).subscribe({
      next: blob => {
        blob.text().then(contenido => {
          try {
            const json = JSON.parse(contenido);
            const formateado = JSON.stringify(json, null, 2);

            const overlay = document.createElement('div');
            overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.95);
            z-index: 10001;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 20px;
          `;

            const pre = document.createElement('pre');
            pre.textContent = formateado;
            pre.style.cssText = `
            background: #1e1e1e;
            color: #d4d4d4;
            padding: 20px;
            border-radius: 8px;
            overflow: auto;
            max-width: 90%;
            max-height: 80%;
            font-family: 'Courier New', monospace;
            font-size: 12px;
          `;

            const btnCerrar = document.createElement('button');
            btnCerrar.textContent = 'Cerrar';
            btnCerrar.style.cssText = `
            margin-top: 15px;
            padding: 12px 30px;
            background: #f44336;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
          `;

            const cerrar = () => {
              document.body.removeChild(overlay);
              document.body.style.overflow = 'auto';
            };

            btnCerrar.onclick = cerrar;

            overlay.appendChild(pre);
            overlay.appendChild(btnCerrar);
            document.body.appendChild(overlay);
            document.body.style.overflow = 'hidden';
          } catch (e) {
            alert('Error parseando JSON');
          }
        });
      },
      error: err => {
        console.error('Error mostrando JSON:', err);
        alert('No se pudo cargar el archivo JSON');
      }
    });
  }

  private mostrarMapaGPXIndividual(asociado: any): void {
    if (!asociado || !asociado.id || !asociado.rutaArchivo) {
      alert('Archivo GPX inválido');
      return;
    }

    console.log('📍 Obteniendo GPX individual:', asociado.nombreArchivo);

    this.archivoService.descargarArchivoAsociado(asociado.id).subscribe({
      next: (blob) => {
        const reader = new FileReader();
        reader.onload = async (e: any) => {
          const gpxText = e.target.result;
          this.parseGPXIndividual(gpxText);

          // 1. Mostrar modal
          this.mostrarModalGPXIndividual = true;
          this.cdr.detectChanges();

          // 2. Esperar a que el DOM se actualice y el contenedor sea visible
          await new Promise(resolve => setTimeout(resolve, 100));

          // 3. Inicializar mapa
          this.inicializarMapaGPXIndividual();
        };
        reader.readAsText(blob);
      },
      error: err => {
        console.error('Error obteniendo GPX:', err);
        alert('Error al cargar el GPX');
      }
    });
  }

  private parseGPXIndividual(gpxText: string): void {
    const parser = new DOMParser();
    const gpxDoc = parser.parseFromString(gpxText, 'text/xml');
    const trkpts = gpxDoc.getElementsByTagName('trkpt');
    this.coordenadasGPXIndividual = [];

    for (let i = 0; i < trkpts.length; i++) {
      const lat = parseFloat(trkpts[i].getAttribute('lat') || '0');
      const lon = parseFloat(trkpts[i].getAttribute('lon') || '0');
      if (lat !== 0 && lon !== 0) {
        this.coordenadasGPXIndividual.push([lat, lon]);
      }
    }
    console.log('✅ GPX parseado. Puntos:', this.coordenadasGPXIndividual.length);
  }

  private inicializarMapaGPXIndividual(): void {
    if (this.coordenadasGPXIndividual.length === 0) {
      console.warn('No hay coordenadas');
      return;
    }

    import('leaflet').then(L => {
      // ✅ Destruir mapa anterior si existe para evitar fugas y errores
      if (this.mapaGPXIndividual) {
        this.mapaGPXIndividual.remove();
        this.mapaGPXIndividual = null;
        console.log('🗑️ Mapa anterior destruido');
      }

      const container = document.getElementById('mapa-gpx-individual');
      if (!container) {
        console.error('❌ Contenedor no encontrado (mapa-gpx-individual)');
        return;
      }

      // Asegurar que el contenedor tenga dimensiones
      if (container.clientHeight === 0) {
        console.warn('⚠️ Contenedor sin altura, forzando estilo...');
        container.style.height = '400px';
        container.style.width = '100%';
      }

      container.innerHTML = '';

      try {
        console.log('🗺️ Inicializando mapa Leaflet...');
        this.mapaGPXIndividual = L.map('mapa-gpx-individual').setView(
          [this.coordenadasGPXIndividual[0][0], this.coordenadasGPXIndividual[0][1]],
          13
        );

        // ✅ DEFINIR CAPAS BASE
        const capaMapa = L.tileLayer(
          'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
          {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19
          }
        );

        const capaSatelite = L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: 'Tiles © Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP',
            maxZoom: 18
          }
        );

        const capaHibrida = L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: 'Tiles © Esri',
            maxZoom: 18
          }
        );

        // Capa de etiquetas para el modo híbrido
        const capaEtiquetas = L.tileLayer(
          'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png',
          {
            attribution: '© OpenStreetMap, © CartoDB',
            maxZoom: 19,
            subdomains: 'abcd',
            pane: 'overlayPane'
          }
        );

        // ✅ AGREGAR CAPA POR DEFECTO (Satélite, como tenías antes)
        capaSatelite.addTo(this.mapaGPXIndividual);

        // ✅ CREAR CONTROL DE CAPAS
        const capasBase = {
          '🗺️ Mapa': capaMapa,
          '🛰️ Satélite': capaSatelite,
          '🌍 Híbrido': capaHibrida
        };

        L.control.layers(capasBase, {}, {
          position: 'topright',
          collapsed: true
        }).addTo(this.mapaGPXIndividual);

        // ✅ LISTENER PARA MODO HÍBRIDO
        this.mapaGPXIndividual.on('baselayerchange', (e: any) => {
          if (e.name === '🌍 Híbrido') {
            // Agregar etiquetas cuando se selecciona Híbrido
            if (!this.mapaGPXIndividual!.hasLayer(capaEtiquetas)) {
              capaEtiquetas.addTo(this.mapaGPXIndividual!);
            }
          } else {
            // Quitar etiquetas cuando se selecciona otra capa
            if (this.mapaGPXIndividual!.hasLayer(capaEtiquetas)) {
              this.mapaGPXIndividual!.removeLayer(capaEtiquetas);
            }
          }
        });

        // ✅ DIBUJAR TRACK GPX
        const polyline = L.polyline(this.coordenadasGPXIndividual, {
          color: '#FF0000',
          weight: 3,
          opacity: 0.8
        }).addTo(this.mapaGPXIndividual);

        // ✅ MARCADORES DE INICIO Y FIN
        L.circleMarker(this.coordenadasGPXIndividual[0], {
          radius: 8,
          fillColor: '#00FF00',
          color: '#000',
          weight: 2,
          fillOpacity: 1
        }).bindPopup('🟢 Inicio').addTo(this.mapaGPXIndividual);

        L.circleMarker(this.coordenadasGPXIndividual[this.coordenadasGPXIndividual.length - 1], {
          radius: 8,
          fillColor: '#FF0000',
          color: '#000',
          weight: 2,
          fillOpacity: 1
        }).bindPopup('🔴 Fin').addTo(this.mapaGPXIndividual);

        // ✅ AJUSTAR VISTA AL TRACK
        const bounds = L.latLngBounds(this.coordenadasGPXIndividual);
        this.mapaGPXIndividual.fitBounds(bounds, { padding: [50, 50] });

        // ✅ FORZAR REDIBUJADO DEL MAPA
        this.ngZone.run(() => {
          setTimeout(() => {
            if (this.mapaGPXIndividual) {
              this.mapaGPXIndividual.invalidateSize();
              console.log('🔄 Mapa redibujado (100ms)');
            }
          }, 100);

          setTimeout(() => {
            if (this.mapaGPXIndividual) {
              this.mapaGPXIndividual.invalidateSize();
              console.log('🔄 Mapa redibujado (300ms)');
            }
          }, 300);

          setTimeout(() => {
            if (this.mapaGPXIndividual) {
              this.mapaGPXIndividual.invalidateSize();
              // Marcar contenedor como cargado
              const mapContainer = document.querySelector('.mapa-gpx-container');
              if (mapContainer) {
                mapContainer.classList.add('mapa-cargado');
              }
              console.log('🔄 Mapa redibujado (500ms) - ✅ COMPLETO');
            }
          }, 500);
        });

        console.log('✅ Mapa GPX inicializado correctamente con selector de capas');

      } catch (error) {
        console.error('❌ Error inicializando Leaflet:', error);
      }
    });
  }

  cerrarModalGPXIndividual(): void {
    this.mostrarModalGPXIndividual = false;
    if (this.mapaGPXIndividual) {
      this.mapaGPXIndividual.remove();
      this.mapaGPXIndividual = null;
    }
  }

  // ==========================================
  // MÉTODOS PARA GESTIÓN DEL AUDIO DEL VIAJE
  // ==========================================

  private inicializarAudioViaje(): void {
    if (!this.infoViaje?.audio) {
      console.log('ℹ️ No hay audio asociado al viaje');
      this.audioDisponible = false;
      return;
    }

    const audioUrl = this.getAudioViajeUrl();
    if (!audioUrl) {
      console.log('⚠️ No se pudo generar URL del audio');
      this.audioDisponible = false;
      return;
    }

    try {
      this.audioViaje = new Audio(audioUrl);
      this.audioViaje.loop = true;
      this.volumenOriginal = this.audioViaje.volume; // 👈 AÑADIDO

      // Eventos del audio
      this.audioViaje.addEventListener('play', () => {
        console.log('▶️ Audio del viaje reproduciendo');
        this.audioReproduciendo = true;
      });

      this.audioViaje.addEventListener('pause', () => {
        console.log('⏸️ Audio del viaje pausado');
        this.audioReproduciendo = false;
      });

      this.audioViaje.addEventListener('error', (e) => {
        console.error('❌ Error al cargar audio del viaje:', e);
        this.audioDisponible = false;
      });

      this.audioViaje.addEventListener('loadedmetadata', () => {
        console.log('✅ Audio del viaje cargado correctamente');
        this.audioDisponible = true;
      });

    } catch (error) {
      console.error('❌ Error al inicializar audio del viaje:', error);
      this.audioDisponible = false;
    }
  }

  private getAudioViajeUrl(): string | null {
    if (!this.infoViaje?.audio) {
      return null;
    }

    // Si la URL ya es completa
    if (this.infoViaje.audio.startsWith('http')) {
      return this.infoViaje.audio;
    }

    // Construir URL relativa
    const nombreArchivo = this.infoViaje.audio.split(/[\\/]/).pop();
    return `${environment.apiUrl}/uploads/${nombreArchivo}`;
  }

  toggleAudioViaje(): void {
    if (!this.audioViaje || !this.audioDisponible) {
      console.warn('⚠️ Audio no disponible');
      return;
    }

    if (this.audioReproduciendo) {
      this.audioViaje.pause();
    } else {
      this.audioViaje.play().catch(error => {
        console.error('❌ Error al reproducir audio:', error);
      });
    }
  }

  private limpiarAudioViaje(): void {
    if (this.audioViaje) {
      this.audioViaje.pause();
      this.audioViaje.src = '';
      this.audioViaje = null;
    }
    this.audioReproduciendo = false;
    this.audioDisponible = false;
  }

  private bajarVolumenAudioViaje(): void {
    if (this.audioViaje && this.audioDisponible) {
      this.audioViaje.volume = 0.05; // Casi silencio
      console.log('🔉 Volumen del audio del viaje reducido');
    }
  }

  private restaurarVolumenAudioViaje(): void {
    if (this.audioViaje && this.audioDisponible) {
      this.audioViaje.volume = this.volumenOriginal;
      console.log('🔊 Volumen del audio del viaje restaurado');
    }
  }

  // ==========================================
  // HOST LISTENERS (EVENTOS DE TECLADO Y TÁCTILES)
  // ==========================================

  @HostListener('document:keydown.escape', ['$event'])
  handleKeyboardEvent(event: Event) {  // <-- Cambiar a Event
    if (this.mostrarFullscreen) {
      this.cerrarFullscreen();
    } else if (this.mostrarInfoDetalle) {
      this.cerrarInfoDetalle();
    }
  }

  /**
   * Maneja el evento de resize para cambiar entre tooltip y modal
   */
  @HostListener('window:resize')  // <-- Remover ['$event']
  onResize(): void {
    const esMovil = window.innerWidth <= 768;
    if (this.mostrarInfoDetalle && esMovil !== this.infoDetalleEsModal) {
      this.cerrarInfoDetalle();
    }
  }


  /**
   * Cierra la información si se hace click fuera (solo en modal)
   */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (this.mostrarInfoDetalle && this.infoDetalleEsModal) {
      const target = event.target as HTMLElement;
      const infoElement = target.closest('.info-detalle, .info-trigger');

      if (!infoElement) {
        this.cerrarInfoDetalle();
      }
    }
  }

  // ==========================================
  // MÉTODOS DE INICIALIZACIÓN
  // ==========================================

  private async inicializarComponente(): Promise<void> {
    console.log('🚀 Inicializando componente...');
    const params = this.route.snapshot.paramMap;
    const viajeId = Number(params.get('viajeId'));
    const itinerarioId = params.get('itinerarioId') ? Number(params.get('itinerarioId')) : undefined;
    const actividadId = params.get('actividadId') ? Number(params.get('actividadId')) : undefined;

    console.log('📋 Parámetros de ruta:', { viajeId, itinerarioId, actividadId });

    if (!this.validarParametros(viajeId, itinerarioId, actividadId)) {
      console.error('❌ Parámetros inválidos');
      this.manejarErrorParametros();
      return;
    }

    this.contextoViaje = { viajeId, itinerarioId, actividadId };
    console.log('✅ Contexto viaje establecido:', this.contextoViaje);

    await this.cargarInfoViaje(viajeId);

    if (!itinerarioId && !actividadId) {
      console.log('📋 Nivel de Viaje - Cargando itinerarios para índice');
      await this.cargarItinerariosDelViaje(viajeId);
    } else {
      console.log('📋 Nivel de Itinerario/Actividad - No se cargan itinerarios para índice');
    }

    await this.cargarDatosAlbum();
  }

  // ==========================================
  // MÉTODOS PARA MANEJAR LA INFORMACIÓN DEL ARCHIVO
  // ==========================================

  /**
   * Alterna la visibilidad de la información detallada (para click/touch)
   */
  toggleInfoDetalle(): void {
    this.mostrarInfoDetalle = !this.mostrarInfoDetalle;  // ✅ Toggle
    this.cancelarOcultarInfo();  // ✅ Cancelar timeout de ocultamiento

    if (this.infoDetalleEsModal) {
      if (this.mostrarInfoDetalle) {
        document.body.style.overflow = 'hidden';  // Bloquear scroll en móvil
      } else {
        document.body.style.overflow = '';  // Restaurar scroll
      }
    }
  }


  /**
   * Cierra la información detallada
   */
  cerrarInfoDetalle(): void {
    this.mostrarInfoDetalle = false;
    this.cancelarOcultarInfo();  // ✅ Limpiar timeout

    if (this.infoDetalleEsModal) {
      document.body.style.overflow = '';
    }
  }


  /**
   * Oculta la información con delay para permitir hover sobre el tooltip
   */
  ocultarInfoDetalle(): void {
    // ✅ SIMPLIFICADO: Solo ocultar si NO es modal
    if (!this.infoDetalleEsModal) {
      this.timeoutOcultarInfo = setTimeout(() => {
        this.mostrarInfoDetalle = false;
      }, 500);  // ✅ Aumentado a 500ms para dar tiempo
    }
  }


  /**
   * Cancela el timeout si el usuario vuelve a hacer hover
   */
  cancelarOcultarInfo(): void {
    if (this.timeoutOcultarInfo) {
      clearTimeout(this.timeoutOcultarInfo);
      this.timeoutOcultarInfo = null;  // ✅ Cambiar a null en lugar de undefined
    }
  }

  // ==========================================
  // MÉTODOS DE CARGA DE DATOS
  // ==========================================

  private async cargarInfoViaje(viajeId: number): Promise<void> {
    console.log(`📦 Cargando información del viaje ID: ${viajeId}`);
    try {
      const viaje = await firstValueFrom(
        this.viajesPrevistosService.obtenerViaje(viajeId).pipe(takeUntil(this.destroy$))
      );

      console.log('✅ Información del viaje recibida:', viaje);

      this.infoViaje = {
        nombre: viaje.nombre || `Viaje #${viajeId}`,
        fechaInicio: viaje.fechaInicio || '',
        fechaFin: viaje.fechaFin || '',
        imagen: viaje.imagen || '',
        audio: viaje.audio || '' // 👈 AÑADIR ESTA LÍNEA
      };
      console.log('📋 InfoViaje establecida:', this.infoViaje);

    } catch (error) {
      console.error('❌ Error al cargar información del viaje:', error);
      this.infoViaje = {
        nombre: `Viaje #${viajeId}`,
        fechaInicio: '',
        fechaFin: '',
        imagen: '',
        audio: '' // 👈 AÑADIR ESTA LÍNEA
      };
    }
  }

  private async cargarItinerariosDelViaje(viajeId: number): Promise<void> {
    console.log(`📋 Cargando itinerarios para viaje ID: ${viajeId}`);
    try {
      const itinerarios = await firstValueFrom(
        this.itinerarioService.getItinerarios(viajeId)
          .pipe(takeUntil(this.destroy$))
      );

      console.log('✅ Itinerarios recibidos:', itinerarios);
      this.listaItinerarios = itinerarios || [];
      console.log('📋 Lista de itinerarios establecida:', this.listaItinerarios);

    } catch (error) {
      console.error('❌ Error al cargar los itinerarios para el índice:', error);
      this.listaItinerarios = [];
    }
  }

  private async cargarDescripcionItinerario(): Promise<void> {
    if (!this.contextoViaje?.itinerarioId) return;

    console.log(`📝 Cargando descripción del itinerario ID: ${this.contextoViaje.itinerarioId}`);

    try {
      const itinerarioGeneral = await firstValueFrom(
        this.itinerarioService.obtenerItinerarioGeneral(this.contextoViaje.itinerarioId)
          .pipe(takeUntil(this.destroy$))
      );

      // Buscar la página de descripción de itinerario (no asumir que es la primera)
      const paginaDescripcion = this.paginas.find(p => p.esCartaManuscrita);

      if (itinerarioGeneral && paginaDescripcion) {
        paginaDescripcion.descripcion = itinerarioGeneral.descripcionGeneral || 'Sin descripción disponible';
        paginaDescripcion.fecha = itinerarioGeneral.fechaInicio || '';
        paginaDescripcion.titulo = `Itinerario: ${itinerarioGeneral.destinosPorDia?.split(',')[0] || 'Destino'} (${itinerarioGeneral.duracionDias} días)`;

        console.log('✅ Descripción del itinerario cargada:', paginaDescripcion.descripcion);
      } else {
        console.warn('⚠️ No se encontró página de descripción o datos del itinerario');
      }
    } catch (error) {
      console.error('❌ Error al cargar descripción del itinerario:', error);
      const paginaDescripcion = this.paginas.find(p => p.esCartaManuscrita);
      if (paginaDescripcion) {
        paginaDescripcion.descripcion = 'No se pudo cargar la descripción del itinerario';
      }
    }
  }

  async cargarDatosAlbum(): Promise<void> {
    console.log('=== 🎯 DATOS PARA FILTRO ===');
    console.log('contextoViaje:', this.contextoViaje);
    console.log('============================');

    this.isLoading = true;
    this.error = null;
    this.noArchivosEncontrados = false;

    try {
      if (!this.archivoService) {
        console.error('❌ ArchivoService no disponible');
        throw new Error('ArchivoService no disponible');
      }

      let archivos: Archivo[] = [];

      if (this.contextoViaje?.actividadId) {
        console.log('🎯 Llamando getArchivosPorActividad con:', this.contextoViaje.actividadId);
        archivos = await firstValueFrom(
          this.archivoService
            .getArchivosPorActividad(this.contextoViaje.actividadId)
            .pipe(takeUntil(this.destroy$))
        );
      } else if (this.contextoViaje?.itinerarioId) {
        console.log('🎯 Llamando getArchivosPorItinerario con:', this.contextoViaje.itinerarioId);
        archivos = await firstValueFrom(
          this.archivoService
            .getArchivosPorItinerario(this.contextoViaje.itinerarioId)
            .pipe(takeUntil(this.destroy$))
        );
      } else {
        console.log('🎯 Llamando getArchivosPorViaje con:', this.contextoViaje!.viajeId);
        archivos = await firstValueFrom(
          this.archivoService
            .getArchivosPorViaje(this.contextoViaje!.viajeId)
            .pipe(takeUntil(this.destroy$))
        );
      }

      console.log('📁 Archivos recibidos:', archivos);
      console.log('📊 Total archivos:', archivos?.length || 0);

      if (!archivos || archivos.length === 0) {
        console.warn('⚠️ No se encontraron archivos');
        this.noArchivosEncontrados = true;
        return;
      }

      // DEBUG: Ver estructura de archivos recibidos
      console.log('=== DEBUG ARCHIVOS RECIBIDOS ===');
      archivos.forEach((archivo, index) => {
        console.log(`Archivo ${index}:`, {
          id: archivo.id,
          nombreArchivo: archivo.nombreArchivo,
          itinerarioId: archivo.itinerarioId,
          actividadId: archivo.actividadId,
          fechaCreacion: archivo.fechaCreacion,
          horaCaptura: archivo.horaCaptura
        });
      });
      console.log('===============================');

      await this.procesarArchivos(archivos);
    } catch (error) {
      console.error('❌ Error al cargar datos del álbum:', error);
      this.manejarErrorCarga(error);
    } finally {
      this.isLoading = false;
      console.log('✅ Carga de datos completada');
    }
  }

  // ==========================================
  // MÉTODOS DE PROCESAMIENTO DE ARCHIVOS MULTIMEDIA
  // ==========================================

  private async procesarArchivos(archivos: Archivo[]): Promise<void> {
    console.log('🔄 Procesando archivos multimedia...');

    if (archivos.length === 0) {
      console.warn('⚠️ No hay archivos para procesar');
      this.noArchivosEncontrados = true;
      return;
    }

    // Procesar archivos normales
    const paginasNormales: PaginaMedia[] = archivos.map(archivo => {
      const tipoMedia = this.determinarTipoMedia(archivo);
      const url = this.getFileUrl(archivo);

      // ... código de procesamiento de coordenadas (mantener igual) ...
      let coordenadas: { latitud: number, longitud: number, altitud?: number } | undefined;

      if (archivo.geolocalizacion) {
        try {
          let geoData;

          if (typeof archivo.geolocalizacion === 'string') {
            geoData = JSON.parse(archivo.geolocalizacion);
          } else {
            geoData = archivo.geolocalizacion;
          }

          if (geoData &&
            typeof geoData.latitud === 'number' &&
            typeof geoData.longitud === 'number' &&
            !isNaN(geoData.latitud) &&
            !isNaN(geoData.longitud)) {

            const latitudOriginal = geoData.latitud;
            const longitudOriginal = geoData.longitud;

            const longitudCorregida = this.corregirLongitudEspana(longitudOriginal, latitudOriginal);

            coordenadas = {
              latitud: latitudOriginal,
              longitud: longitudCorregida,
              altitud: geoData.altitud || undefined
            };

            if (longitudOriginal !== longitudCorregida) {
              console.log(`🔧 ${archivo.nombreArchivo}: Longitud corregida ${longitudOriginal} → ${longitudCorregida}`);
            }

            console.log(`📍 Coordenadas procesadas para ${archivo.nombreArchivo}:`, coordenadas);
          } else {
            console.warn(`⚠️ Coordenadas inválidas para ${archivo.nombreArchivo}:`, geoData);
          }
        } catch (error) {
          console.error(`❌ Error al parsear geolocalización de ${archivo.nombreArchivo}:`, error);
        }
      }

      return {
        archivo,
        url,
        titulo: archivo.descripcion || archivo.nombreArchivo || 'Sin título',
        descripcion: archivo.descripcion || '',
        fecha: archivo.fechaCreacion || '',
        fechaOriginal: archivo.fechaCreacion || '',
        tipoMedia,
        mimeType: archivo.tipoMime || this.inferirMimeType(archivo.nombreArchivo || ''),
        tamano: archivo.tamano,
        cargado: false,
        coordenadas,
        archivosAsociados: archivo.archivosAsociados // ✅ Asegurar que se pasan los archivos asociados
      };
    });

    // NO ordenar globalmente aquí - se ordenará específicamente para cada contexto

    let paginasFinales: PaginaMedia[] = [];

    if (this.contextoViaje?.itinerarioId && !this.contextoViaje?.actividadId) {
      // NIVEL ITINERARIO: Solo descripción del itinerario actual
      // Ordenar fotos por fecha y hora (más antiguas primero)
      paginasNormales.sort((a, b) => {
        const fechaA = new Date(a.fecha || 0);
        const fechaB = new Date(b.fecha || 0);
        if (fechaA.getTime() !== fechaB.getTime()) {
          return fechaA.getTime() - fechaB.getTime();
        }
        const horaA = a.archivo.horaCaptura || '';
        const horaB = b.archivo.horaCaptura || '';
        if (horaA && horaB) {
          return horaA.localeCompare(horaB);
        }
        return 0;
      });
      const paginaDescripcion: PaginaMedia = {
        archivo: {} as Archivo,
        url: '',
        titulo: 'Descripción del Itinerario',
        descripcion: '',
        fecha: '',
        tipoMedia: 'carta-manuscrita',
        mimeType: '',
        esCartaManuscrita: true
      };
      paginasFinales = [paginaDescripcion, ...paginasNormales];
    } else if (!this.contextoViaje?.itinerarioId && !this.contextoViaje?.actividadId) {
      // NIVEL VIAJE: Agrupar fotos por itinerario e intercalar descripciones
      paginasFinales = await this.crearPaginasConDescripcionesItinerarios(paginasNormales);

    } else {
      // NIVEL ACTIVIDAD: Solo página de índice normal
      // Ordenar fotos por fecha y hora (más antiguas primero)
      paginasNormales.sort((a, b) => {
        const fechaA = new Date(a.fecha || 0);
        const fechaB = new Date(b.fecha || 0);

        // Si tienen fecha diferente, ordenar por fecha
        if (fechaA.getTime() !== fechaB.getTime()) {
          return fechaA.getTime() - fechaB.getTime(); // Más antiguas primero
        }

        // Si tienen la misma fecha, ordenar por hora de captura
        const horaA = a.archivo.horaCaptura || '';
        const horaB = b.archivo.horaCaptura || '';

        if (horaA && horaB) {
          return horaA.localeCompare(horaB);
        }

        return 0;
      });

      const paginaIndice: PaginaMedia = {
        archivo: {} as Archivo,
        url: '',
        titulo: 'Índice del álbum',
        descripcion: '',
        fecha: '',
        tipoMedia: 'desconocido',
        mimeType: '',
        esIndice: true
      };

      paginasFinales = [paginaIndice, ...paginasNormales];
    }

    // Guardar paginas base y generar mapas animados según configuración
    this.paginasBase = paginasFinales;
    this.paginas = await this.generarPaginasConAnimaciones(this.paginasBase);

    console.log('📖 Páginas multimedia creadas:', this.paginas.length);
    console.log('📊 Tipos de archivos:', this.obtenerEstadisticasTipos());

    // Cargar la descripción del itinerario DESPUÉS de asignar esta.paginas
    if (this.contextoViaje?.itinerarioId && !this.contextoViaje?.actividadId) {
      await this.cargarDescripcionItinerario();
    }

    // Precargar contenido y ubicaciones en paralelo
    await Promise.all([
      this.precargarContenido(),
      this.precargarUbicaciones()
    ]);
  }

  // ==========================================
  // MÉTODOS PARA MAPAS ANIMADOS POR TRAMOS
  // ==========================================

  async toggleAnimacionesMapa(): Promise<void> {
    this.incluirAnimacionesMapa = !this.incluirAnimacionesMapa;
    await this.actualizarConfiguracionAnimaciones();
  }

  async actualizarConfiguracionAnimaciones(): Promise<void> {
    console.log('🔄 Recalculando páginas del álbum según filtro de animaciones:', {
      incluir: this.incluirAnimacionesMapa,
      distanciaMinimaKm: this.distanciaMinimaAnimacionKm
    });
    this.isLoading = true;
    try {
      this.paginas = await this.generarPaginasConAnimaciones(this.paginasBase);
      if (this.paginaActual >= this.paginas.length) {
        this.paginaActual = Math.max(0, this.paginas.length - 1);
      }
      this.cdr.detectChanges();
    } catch (e) {
      console.error('❌ Error recalculando animaciones del mapa:', e);
    } finally {
      this.isLoading = false;
    }
  }

  private async generarPaginasConAnimaciones(paginasInput: PaginaMedia[]): Promise<PaginaMedia[]> {
    if (!this.incluirAnimacionesMapa) {
      return paginasInput.filter(p => !p.esMapaAnimado);
    }

    const resultado: PaginaMedia[] = [];
    const actividadesProcesadas = new Set<number>();

    for (let i = 0; i < paginasInput.length; i++) {
      const pag = paginasInput[i];
      if (pag.esMapaAnimado) continue;

      const actId = pag.archivo?.actividadId;

      if (actId && !actividadesProcesadas.has(actId)) {
        actividadesProcesadas.add(actId);
        try {
          const gpxXml = await firstValueFrom(this.trackEditorService.resolveCanonicalGpxXml(actId));
          if (gpxXml && gpxXml.trim().length > 0) {
            const points = this.gpxAnimationService.parseGpx(gpxXml);
            const distMetros = points.length > 0 ? (points[points.length - 1].distAcum || 0) : 0;
            const distKm = distMetros / 1000;

            console.log(`🗺️ Evaluando tramo actividad #${actId}: ${distKm.toFixed(2)} km (Mínimo: ${this.distanciaMinimaAnimacionKm} km)`);

            if (distKm >= this.distanciaMinimaAnimacionKm) {
              const paginaMapa: PaginaMedia = {
                archivo: {} as Archivo,
                url: '',
                titulo: `Recorrido de ${distKm.toFixed(1)} km`,
                descripcion: `Mapa animado del tramo (${distKm.toFixed(1)} km)`,
                fecha: pag.fecha || '',
                tipoMedia: 'mapa-animado',
                mimeType: '',
                cargado: true,
                esMapaAnimado: true,
                trackGpx: gpxXml,
                distanciaTramoKm: distKm,
                actividadId: actId
              };

              console.log(`✅ Añadiendo página de mapa animado para actividad #${actId} (${distKm.toFixed(1)} km)`);
              resultado.push(paginaMapa);
            } else {
              console.log(`⏩ Tramo corto omitido para mapa animado: ${distKm.toFixed(2)} km < ${this.distanciaMinimaAnimacionKm} km`);
            }
          }
        } catch (error) {
          console.warn(`⚠️ No se pudo obtener GPX para actividad #${actId}:`, error);
        }
      }

      resultado.push(pag);
    }

    return resultado;
  }

  onFinAnimacionMapa(): void {
    console.log('🏁 Animación del mapa completada');
    if (this.reproduciendoSlideshow) {
      setTimeout(() => {
        if (this.reproduciendoSlideshow) {
          this.avanzarSlideshow();
        }
      }, 1000);
    }
  }

  private async crearPaginasConDescripcionesItinerarios(archivos: PaginaMedia[]): Promise<PaginaMedia[]> {
    console.log('📋 Creando páginas con descripciones de itinerarios...');

    // DEBUG: Ver qué itinerarioId tienen los archivos
    console.log('=== DEBUG ARCHIVOS ===');
    archivos.forEach((archivo, index) => {
      console.log(`Archivo ${index}: ${archivo.archivo.nombreArchivo} - itinerarioId: ${archivo.archivo.itinerarioId}`);
    });
    console.log('======================');

    const paginasFinales: PaginaMedia[] = [];

    // Página de índice general del viaje
    const paginaIndice: PaginaMedia = {
      archivo: {} as Archivo,
      url: '',
      titulo: 'Índice del álbum',
      descripcion: '',
      fecha: '',
      tipoMedia: 'desconocido',
      mimeType: '',
      esIndice: true
    };
    paginasFinales.push(paginaIndice);

    // Agrupar archivos por itinerario usando actividadId
    const archivosPorItinerario = new Map<number, PaginaMedia[]>();
    const archivosSinItinerario: PaginaMedia[] = [];

    // Necesitamos cargar las actividades para saber a qué itinerario pertenece cada archivo
    const actividadesPorItinerario = await this.cargarActividadesPorItinerario();

    archivos.forEach(archivo => {
      const actividadId = archivo.archivo.actividadId;
      let itinerarioId: number | undefined;

      // Buscar a qué itinerario pertenece esta actividad
      for (const [itId, actividades] of actividadesPorItinerario.entries()) {
        if (actividades.some((act: any) => act.id === actividadId)) {
          itinerarioId = itId;
          break;
        }
      }

      if (itinerarioId) {
        if (!archivosPorItinerario.has(itinerarioId)) {
          archivosPorItinerario.set(itinerarioId, []);
        }
        archivosPorItinerario.get(itinerarioId)!.push(archivo);
      } else {
        archivosSinItinerario.push(archivo);
      }
    });

    console.log(`📊 Archivos agrupados: ${archivosPorItinerario.size} itinerarios con fotos, ${archivosSinItinerario.length} fotos sin itinerario`);

    // Ordenar las fotos de cada itinerario por fecha y hora (más antiguas primero)
    archivosPorItinerario.forEach((fotos, itinerarioId) => {
      fotos.sort((a, b) => {
        const fechaA = new Date(a.fecha || 0);
        const fechaB = new Date(b.fecha || 0);

        // Si tienen fecha, ordenar por fecha
        if (fechaA.getTime() !== fechaB.getTime()) {
          return fechaA.getTime() - fechaB.getTime(); // Más antiguas primero
        }

        // Si tienen la misma fecha, ordenar por hora de captura si está disponible
        const horaA = a.archivo.horaCaptura || '';
        const horaB = b.archivo.horaCaptura || '';

        if (horaA && horaB) {
          return horaA.localeCompare(horaB);
        }

        return 0;
      });

      console.log(`📅 Ordenadas ${fotos.length} fotos del itinerario ${itinerarioId} por fecha y hora`);
    });

    // Ordenar itinerarios por fecha de inicio (más antiguos primero)
    const itinerariosOrdenados = this.listaItinerarios.sort((a, b) => {
      const fechaA = new Date(a.fechaInicio || 0);
      const fechaB = new Date(b.fechaInicio || 0);
      return fechaA.getTime() - fechaB.getTime();
    });

    // Para cada itinerario, añadir descripción + fotos ordenadas
    for (const itinerario of itinerariosOrdenados) {
      const fotosItinerario = archivosPorItinerario.get(itinerario.id) || [];

      // Solo procesar itinerarios que tienen fotos
      if (fotosItinerario.length > 0) {
        try {
          const itinerarioCompleto = await firstValueFrom(
            this.itinerarioService.obtenerItinerarioGeneral(itinerario.id)
              .pipe(takeUntil(this.destroy$))
          );

          // Crear página de descripción del itinerario
          const paginaDescripcion: PaginaMedia = {
            archivo: {} as Archivo,
            url: '',
            titulo: `Itinerario: ${itinerarioCompleto.destinosPorDia?.split(',')[0] || 'Destino'} (${itinerarioCompleto.duracionDias} días)`,
            descripcion: itinerarioCompleto.descripcionGeneral || 'Sin descripción disponible',
            fecha: itinerarioCompleto.fechaInicio || '',
            tipoMedia: 'carta-manuscrita',
            mimeType: '',
            esCartaManuscrita: true
          };

          // Añadir descripción seguida de las fotos ordenadas
          paginasFinales.push(paginaDescripcion);
          paginasFinales.push(...fotosItinerario);

          console.log(`✅ Procesado itinerario ${itinerario.id}: descripción + ${fotosItinerario.length} fotos ordenadas`);

        } catch (error) {
          console.error(`❌ Error al cargar itinerario ${itinerario.id}:`, error);

          // Crear página de descripción básica aunque falle la carga
          const paginaDescripcionError: PaginaMedia = {
            archivo: {} as Archivo,
            url: '',
            titulo: `Itinerario #${itinerario.id}`,
            descripcion: 'No se pudo cargar la descripción del itinerario',
            fecha: itinerario.fechaInicio || '',
            tipoMedia: 'carta-manuscrita',
            mimeType: '',
            esCartaManuscrita: true
          };

          // Añadir descripción seguida de las fotos ordenadas
          paginasFinales.push(paginaDescripcionError);
          paginasFinales.push(...fotosItinerario);

          console.log(`⚠️ Procesado itinerario ${itinerario.id} con error: descripción + ${fotosItinerario.length} fotos ordenadas`);
        }
      } else {
        console.log(`ℹ️ Itinerario ${itinerario.id} sin fotos, se omite`);
      }
    }

    // Añadir fotos sin itinerario al final (también ordenadas)
    if (archivosSinItinerario.length > 0) {
      // Ordenar fotos sin itinerario
      archivosSinItinerario.sort((a, b) => {
        const fechaA = new Date(a.fecha || 0);
        const fechaB = new Date(b.fecha || 0);
        return fechaA.getTime() - fechaB.getTime();
      });

      const paginaSinItinerario: PaginaMedia = {
        archivo: {} as Archivo,
        url: '',
        titulo: 'Archivos sin itinerario asignado',
        descripcion: 'Estos archivos no están asociados a ningún itinerario específico',
        fecha: '',
        tipoMedia: 'carta-manuscrita',
        mimeType: '',
        esCartaManuscrita: true
      };

      paginasFinales.push(paginaSinItinerario);
      paginasFinales.push(...archivosSinItinerario);

      console.log(`📎 Añadidas ${archivosSinItinerario.length} fotos sin itinerario (ordenadas)`);
    }

    console.log(`📖 Creadas ${paginasFinales.length} páginas con descripciones e itinerarios correctamente ordenados`);
    return paginasFinales;
  }

  private async cargarActividadesPorItinerario(): Promise<Map<number, any[]>> {
    const actividadesPorItinerario = new Map<number, any[]>();

    try {
      // Cargar actividades para cada itinerario
      for (const itinerario of this.listaItinerarios) {
        const actividades = await firstValueFrom(
          this.actividadesItinerariosService.getByItinerario(itinerario.id)
            .pipe(takeUntil(this.destroy$))
        );

        if (actividades && actividades.length > 0) {
          actividadesPorItinerario.set(itinerario.id, actividades);
          console.log(`📋 Cargadas ${actividades.length} actividades para itinerario ${itinerario.id}`);
        }
      }

      console.log('📋 Actividades cargadas por itinerario:', actividadesPorItinerario.size);
      return actividadesPorItinerario;

    } catch (error) {
      console.error('❌ Error al cargar actividades por itinerario:', error);
      return actividadesPorItinerario;
    }
  }

  private determinarTipoMedia(archivo: Archivo): TipoMedia {
    if (archivo.tipo === 'foto' || archivo.tipo === 'imagen') {
      return 'imagen';
    }

    const extension = this.obtenerExtension(archivo.nombreArchivo || '').toLowerCase();

    if (this.EXTENSIONES_IMAGEN.includes(extension)) {
      return 'imagen';
    } else if (this.EXTENSIONES_VIDEO.includes(extension)) {
      return 'video';
    } else if (this.EXTENSIONES_AUDIO.includes(extension)) {
      return 'audio';
    } else if (this.EXTENSIONES_PDF.includes(extension)) {
      return 'pdf';
    } else if (this.EXTENSIONES_DOCUMENTO.includes(extension)) {
      return 'documento';
    }

    return 'desconocido';
  }

  private obtenerExtension(nombreArchivo: string): string {
    const ultimoPunto = nombreArchivo.lastIndexOf('.');
    return ultimoPunto > -1 ? nombreArchivo.substring(ultimoPunto) : '';
  }

  private inferirMimeType(nombreArchivo: string): string {
    const extension = this.obtenerExtension(nombreArchivo).toLowerCase();

    const mimeTypes: { [key: string]: string } = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4', '.aac': 'audio/aac',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.txt': 'text/plain'
    };

    return mimeTypes[extension] || 'application/octet-stream';
  }

  private obtenerEstadisticasTipos(): { [key: string]: number } {
    const stats: { [key: string]: number } = {};
    this.paginas.forEach(pagina => {
      if (!pagina.esIndice) {
        stats[pagina.tipoMedia] = (stats[pagina.tipoMedia] || 0) + 1;
      }
    });
    return stats;
  }

  getFileUrl(archivo: Archivo): string {
    if (!archivo?.rutaArchivo) {
      console.warn('⚠️ Archivo sin ruta, usando imagen por defecto');
      return '/assets/images/no-image.jpg';
    }

    let ruta = archivo.rutaArchivo;

    // Limpiar 'uploads/' si ya está ahí
    if (ruta.startsWith('uploads/') || ruta.startsWith('uploads\\')) {
      ruta = ruta.substring(8);
    }

    // ✅ CASO 1: Ruta antigua (Windows absoluta)
    if (ruta.includes('\\')) {
      const nombreArchivo = ruta.substring(ruta.lastIndexOf('\\') + 1);
      return `${environment.apiUrl}/uploads/${nombreArchivo}`;
    }

    // ✅ CASO 2: URL ya completa
    if (ruta.startsWith('http')) {
      return ruta;
    }

    // 🔧 Por defecto / Nueva ruta
    return `${environment.apiUrl}/uploads/${ruta}`;
  }


  // ==========================================
  // MÉTODOS DE PRECARGA Y GESTIÓN DE CONTENIDO
  // ==========================================

  private async precargarContenido(): Promise<void> {
    console.log('🔄 Precargando contenido multimedia...');

    const promesasCarga = this.paginas.map((pagina, index) => {
      if (pagina.tipoMedia === 'imagen') {
        return this.precargarImagen(pagina.url, index);
      }
      return Promise.resolve();
    });

    await Promise.allSettled(promesasCarga);
    console.log('✅ Precarga de contenido completada');
  }

  private precargarImagen(url: string, index: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        console.log(`✅ Imagen precargada: ${url}`);
        if (this.paginas[index]) this.paginas[index].cargado = true;
        resolve();
      };
      img.onerror = () => {
        console.error(`❌ Error al precargar imagen: ${url}`);
        reject(`Error al cargar imagen: ${url}`);
      };
      img.src = url;
    });
  }

  getImagenViajeUrl(): string | null {
    if (this.imagenViajeUrlCache !== null) {
      return this.imagenViajeUrlCache;
    }

    if (!this.infoViaje?.imagen || this.imagenViajeError) {
      this.imagenViajeUrlCache = null;
      return null;
    }

    if (this.infoViaje.imagen.startsWith('http')) {
      this.imagenViajeUrlCache = this.infoViaje.imagen;
      return this.imagenViajeUrlCache;
    }

    const nombreArchivo = this.infoViaje.imagen.split(/[\\/]/).pop();
    const url = `${environment.apiUrl}/uploads/${nombreArchivo}`;

    this.imagenViajeUrlCache = url;
    return this.imagenViajeUrlCache;
  }

  // ==========================================
  // MÉTODOS DE NAVEGACIÓN DEL ÁLBUM
  // ==========================================

  abrirLibro(): void {
    console.log('📖 Abriendo libro...');
    if (this.paginas.length === 0) return;

    this.estado = 'abierto';

    // Siempre abrir en la página de índice (página 0)
    this.paginaActual = 0;
    console.log('✅ Libro abierto en el índice, página actual:', this.paginaActual);
  }

  cambiarPagina(direccion: number): void {
    console.log(`🔄 Cambiando página, dirección: ${direccion}`);
    const nuevaPagina = this.paginaActual + direccion;

    if (nuevaPagina >= 0 && nuevaPagina < this.paginas.length) {
      this.paginaActual = nuevaPagina;
      console.log('✅ Nueva página:', this.paginaActual);

      // 👇 AÑADIR ESTO
      const pagina = this.paginas[this.paginaActual];
      if (pagina?.tipoMedia === 'video') {
        this.bajarVolumenAudioViaje();
      } else {
        this.restaurarVolumenAudioViaje();
      }
    } else if (nuevaPagina >= this.paginas.length && this.contextoViaje?.itinerarioId && !this.contextoViaje.actividadId) {
      console.log('📈 Fin del itinerario, cambiando a nivel viaje...');
      this.cambiarANivelViaje();
    } else if (nuevaPagina < 0 && this.contextoViaje?.itinerarioId && !this.contextoViaje.actividadId) {
      console.log('📈 Inicio del itinerario, cambiando a nivel viaje...');
      this.cambiarANivelViaje();
    } else {
      console.log('❌ No se puede cambiar de página, límite alcanzado');
    }
  }

  private async cambiarANivelViaje(): Promise<void> {
    console.log('📈 Cambiando a nivel de viaje completo...');

    const nuevoContexto = {
      viajeId: this.contextoViaje!.viajeId
    };

    this.contextoViaje = nuevoContexto;
    await this.cargarItinerariosDelViaje(nuevoContexto.viajeId);
    await this.cargarDatosAlbum();

    this.estado = 'abierto';
    this.paginaActual = 0;

    console.log('✅ Cambiado a nivel viaje completo');
  }

  cerrarLibro(): void {
    console.log('📕 Cerrando libro...');
    this.estado = 'portada';
    this.paginaActual = 0;
  }

  irAPagina(index: number): void {
    if (index >= 0 && index < this.paginas.length) {
      this.paginaActual = index;
    }
  }

  async verAlbumItinerario(itinerarioId: number): Promise<void> {
    console.log(`🖱️ Clic en itinerario ID: ${itinerarioId}`);

    const itinerario = this.listaItinerarios.find(it => it.id === itinerarioId);
    if (itinerario) {
      console.log(`📋 Itinerario seleccionado:`, itinerario);
    }

    if (this.contextoViaje?.viajeId) {
      this.contextoViaje = {
        viajeId: this.contextoViaje.viajeId,
        itinerarioId: itinerarioId
      };

      await this.cargarDatosAlbum();

      if (this.paginas.length > 1) {
        this.estado = 'abierto';
        this.paginaActual = 0; // ← Cambiar a 0 para mostrar la carta manuscrita
        console.log('📖 Álbum abierto directamente en la carta manuscrita del itinerario');
      } else if (this.paginas.length === 1) {
        this.estado = 'abierto';
        this.paginaActual = 0;
        console.log('📋 Solo hay página de índice para este itinerario');
      }
    }
  }

  // ==========================================
  // MÉTODOS DE FULLSCREEN
  // ==========================================

  abrirFullscreen(url: string, tipo: TipoMedia, contenidoAdicional?: { titulo?: string; descripcion?: string }): void {
    console.log('🖼️ Abriendo contenido en pantalla completa:', { url, tipo, contenidoAdicional });

    this.tipoFullscreen = tipo;

    // Si es carta-manuscrita, manejamos el contenido de forma especial
    if (tipo === 'carta-manuscrita') {
      this.mediaFullscreen = ''; // No necesitamos URL para carta manuscrita
      this.fullscreenTitulo = contenidoAdicional?.titulo || '';
      this.fullscreenDescripcion = contenidoAdicional?.descripcion || '';

      console.log('📜 Datos de carta manuscrita:', {
        titulo: this.fullscreenTitulo,
        descripcion: this.fullscreenDescripcion
      });
    } else {
      // Para otros tipos de media, usar la URL normalmente
      this.mediaFullscreen = url;
      this.fullscreenTitulo = '';
      this.fullscreenDescripcion = '';
    }

    this.mostrarFullscreen = true;
    document.body.style.overflow = 'hidden';

    // 👇 AÑADIR ESTO
    if (tipo === 'video') {
      this.bajarVolumenAudioViaje();
    } else {
      this.restaurarVolumenAudioViaje();
    }
  }

  // ==========================================
  // MÉTODOS DE SLIDESHOW
  // ==========================================

  toggleSlideshow(event?: Event): void {
    if (event) {
      event.stopPropagation();
    }

    if (this.reproduciendoSlideshow) {
      this.detenerSlideshow();
    } else {
      this.iniciarSlideshow();
    }
  }

  private iniciarSlideshow(): void {
    console.log('▶️ Iniciando slideshow...');
    this.reproduciendoSlideshow = true;

    // Primer avance opcional o esperar al intervalo
    this.timerSlideshow = setInterval(() => {
      this.ngZone.run(() => {
        this.avanzarSlideshow();
      });
    }, this.INTERVALO_SLIDESHOW);
  }

  private detenerSlideshow(): void {
    console.log('⏸️ Deteniendo slideshow...');
    this.reproduciendoSlideshow = false;
    if (this.timerSlideshow) {
      clearInterval(this.timerSlideshow);
      this.timerSlideshow = null;
    }
  }

  private avanzarSlideshow(): void {
    if (!this.mostrarFullscreen || !this.reproduciendoSlideshow) {
      this.detenerSlideshow();
      return;
    }

    const SIGUIENTE_PAGINA = this.paginaActual + 1;

    if (SIGUIENTE_PAGINA < this.paginas.length) {
      // Elegir transición aleatoria
      this.transicionActual = this.TRANSICIONES[Math.floor(Math.random() * this.TRANSICIONES.length)];

      // Cambiar de página
      this.navegarEnFullscreen(1);
      this.cdr.detectChanges();
    } else {
      console.log('🏁 Fin del álbum alcanzado en slideshow');
      this.detenerSlideshow();
    }
  }

  cerrarFullscreen(): void {
    console.log('❌ Cerrando pantalla completa');
    this.detenerSlideshow(); // Detener si estaba activo
    this.mostrarFullscreen = false;
    this.tipoFullscreen = 'imagen';
    this.fullscreenTitulo = '';
    this.fullscreenDescripcion = '';
    document.body.style.overflow = '';
  }

  navegarEnFullscreen(direccion: number): void {
    console.log(`🖼️ Navegando en fullscreen, dirección: ${direccion}`);
    const nuevaPagina = this.paginaActual + direccion;
    if (nuevaPagina >= 0 && nuevaPagina < this.paginas.length && !this.paginas[nuevaPagina].esIndice) {
      this.paginaActual = nuevaPagina;
      const paginaActual = this.paginas[this.paginaActual];

      // 👇 AÑADIR ESTO
      if (paginaActual?.tipoMedia === 'video') {
        this.bajarVolumenAudioViaje();
      } else {
        this.restaurarVolumenAudioViaje();
      }

      if (paginaActual.esCartaManuscrita) {
        this.abrirFullscreen('', 'carta-manuscrita', {
          titulo: paginaActual.titulo,
          descripcion: paginaActual.descripcion
        });
      } else if (paginaActual.esMapaAnimado) {
        this.abrirFullscreen('', 'mapa-animado', {
          titulo: paginaActual.titulo,
          descripcion: paginaActual.descripcion
        });
      } else {
        this.mediaFullscreen = paginaActual.url;
        this.tipoFullscreen = paginaActual.tipoMedia;
      }
    }
  }

  // ==========================================
  // MÉTODOS DE NAVEGACIÓN GENERAL
  // ==========================================

  // ==========================================
  // MÉTODOS DE NAVEGACIÓN GENERAL
  // ==========================================

  async volver(): Promise<void> {
    console.log('🔙 Volviendo...');

    if (this.estado === 'abierto') {
      // Si estamos viendo un itinerario específico, volver al contexto del viaje completo
      if (this.contextoViaje?.itinerarioId && !this.contextoViaje.actividadId) {
        console.log('🔄 Restaurando contexto del viaje completo desde itinerario...');

        // Cambiar el contexto al viaje completo
        this.contextoViaje = {
          viajeId: this.contextoViaje.viajeId
        };

        // Recargar los datos del viaje completo
        await this.cargarItinerariosDelViaje(this.contextoViaje.viajeId);
        await this.cargarDatosAlbum();

        // Mantener el libro abierto en el índice con todos los itinerarios
        this.estado = 'abierto';
        this.paginaActual = 0;

        console.log('✅ Contexto restaurado al viaje completo');
        return;
      } else {
        // Comportamiento normal: cerrar libro y ir a portada
        this.cerrarLibro();
      }
    } else if (this.contextoViaje) {
      if (this.contextoViaje.actividadId) {
        this.router.navigate(['/viajes-previstos', this.contextoViaje.viajeId, 'itinerario', this.contextoViaje.itinerarioId, 'actividad', this.contextoViaje.actividadId]);
      } else if (this.contextoViaje.itinerarioId) {
        this.router.navigate(['/viajes-previstos', this.contextoViaje.viajeId, 'itinerario', this.contextoViaje.itinerarioId]);
      } else {
        this.router.navigate(['/viajes-previstos', this.contextoViaje.viajeId]);
      }
    } else {
      this.router.navigate(['/viajes-previstos']);
    }
  }

  // ==========================================
  // MÉTODOS DE VALIDACIÓN Y GESTIÓN DE ERRORES
  // ==========================================

  private validarParametros(viajeId: number, itinerarioId?: number, actividadId?: number): boolean {
    console.log('🔍 Validando parámetros...');

    if (!viajeId || viajeId <= 0 || isNaN(viajeId)) {
      console.error('❌ ViajeId inválido:', viajeId);
      return false;
    }

    if (itinerarioId !== undefined && (itinerarioId <= 0 || isNaN(itinerarioId))) {
      console.error('❌ ItinerarioId inválido:', itinerarioId);
      return false;
    }

    if (actividadId !== undefined) {
      if (actividadId <= 0 || isNaN(actividadId) || itinerarioId === undefined) {
        console.error('❌ ActividadId inválido o falta itinerarioId:', { actividadId, itinerarioId });
        return false;
      }
    }

    console.log('✅ Parámetros válidos');
    return true;
  }

  private manejarErrorParametros(): void {
    console.error('❌ Error en parámetros de navegación');
    this.error = 'Parámetros de navegación inválidos';
    setTimeout(() => this.router.navigate(['/viajes-previstos']), 2000);
  }

  private manejarErrorCarga(error: any): void {
    console.error('❌ Error en carga:', error);
    if (error?.status === 404) {
      this.error = 'No se encontraron archivos para este viaje';
    } else if (error?.status === 0) {
      this.error = 'Error de conexión. Verifica tu conexión a internet';
    } else {
      this.error = 'Error al cargar el álbum. Inténtalo de nuevo';
    }
  }

  reintentar(): void {
    console.log('🔄 Reintentando carga...');
    this.error = null;
    this.noArchivosEncontrados = false;
    this.cargarDatosAlbum();
  }

  obtenerFechaFormateada(pagina: PaginaMedia): string {
    if (pagina.esIndice) return 'Índice';
    if (pagina.esCartaManuscrita) return 'Descripción del Viaje';

    const fecha = pagina.fecha || pagina.fechaOriginal;
    if (!fecha) return 'Sin fecha';

    try {
      const fechaObj = new Date(fecha);
      const fechaFormateada = fechaObj.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });

      // Si hay horaCaptura específica, usarla, sino extraer de fechaCreacion
      let horaFormateada;
      if (pagina.archivo.horaCaptura) {
        horaFormateada = pagina.archivo.horaCaptura;
      } else {
        horaFormateada = fechaObj.toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
      }

      return `${fechaFormateada} ${horaFormateada}`;
    } catch (error) {
      return 'Fecha inválida';
    }
  }

  // ==========================================
  // EVENTOS DE CARGA DE MULTIMEDIA
  // ==========================================

  onMediaLoad(index: number): void {
    if (this.paginas[index]) {
      this.paginas[index].cargado = true;
    }
  }

  onMediaError(event: Event): void {
    const element = event.target as HTMLElement;
    console.error('❌ Error cargando contenido multimedia:', element);

    if (this.isMobile) {
      // En móvil, mostrar mensaje específico de error
      const elementType = element.tagName.toLowerCase();
      if (elementType === 'video') {
        console.log('📱 Error de video en móvil - posible problema de formato o conectividad');
      }
    }

    this.imagenViajeError = true;
    this.imagenViajeUrlCache = null;
  }

  // Método para reintentar reproducción de video en móviles
  reintentarReproduccionVideo(videoElement: HTMLVideoElement): void {
    if (this.isMobile) {
      setTimeout(() => {
        videoElement.load();
        videoElement.play().catch(error => {
          console.error('Error al reintentar reproducción:', error);
        });
      }, 1000);
    }
  }

  // ==========================================
  // GETTERS Y MÉTODOS DE INFORMACIÓN CONTEXTUAL
  // ==========================================

  get hayPaginaAnterior(): boolean {
    return this.paginaActual > 0;
  }

  get hayPaginaSiguiente(): boolean {
    return this.paginaActual < this.paginas.length - 1;
  }

  get paginaActualData(): PaginaMedia | null {
    return this.paginas[this.paginaActual] || null;
  }

  get numeroPaginaDisplay(): string {
    return `${this.paginaActual + 1} / ${this.paginas.length}`;
  }

  getTituloContextual(): string {
    if (!this.contextoViaje) return 'Álbum Multimedia';

    if (this.contextoViaje.actividadId) {
      return `Álbum de la Actividad #${this.contextoViaje.actividadId}`;
    } else if (this.contextoViaje.itinerarioId) {
      return `Álbum del Itinerario #${this.contextoViaje.itinerarioId}`;
    } else {
      return `Álbum del Viaje: ${this.infoViaje?.nombre || `#${this.contextoViaje.viajeId}`}`;
    }
  }

  getDescripcionContextual(): string {
    const totalArchivos = this.paginas.length > 0 ? this.paginas.length - 1 : 0;
    const stats = this.obtenerEstadisticasTipos();
    const tipos = Object.keys(stats).map(tipo => `${stats[tipo]} ${tipo}s`).join(', ');

    if (!this.contextoViaje) return `${totalArchivos} archivos (${tipos})`;

    if (this.contextoViaje.actividadId) {
      return `${totalArchivos} archivos de la actividad (${tipos})`;
    } else if (this.contextoViaje.itinerarioId) {
      return `${totalArchivos} archivos del itinerario (${tipos}) - navega para ver todos los del viaje`;
    } else {
      return `${totalArchivos} archivos del viaje completo (${tipos})`;
    }
  }

  //método getNivelContexto()
  getNivelContexto(): string {
    if (!this.contextoViaje) return 'Desconocido';

    // Si estamos viendo un archivo específico, intentar mostrar su geolocalización
    const paginaActual = this.paginas[this.paginaActual];
    if (paginaActual && !paginaActual.esIndice && paginaActual.coordenadas) {
      // Crear clave única para la cache usando las coordenadas
      const coordKey = `${paginaActual.coordenadas.latitud},${paginaActual.coordenadas.longitud}`;
      const ubicacionCacheada = this.ubicacionesCache.get(coordKey);

      if (ubicacionCacheada && ubicacionCacheada !== 'Cargando...') {
        return ubicacionCacheada;
      }

      // Cargar ubicación de forma asíncrona si no está en cache
      if (!ubicacionCacheada) {
        this.cargarUbicacionPorCoordenadas(paginaActual.coordenadas, coordKey);
      }
    }

    // Fallback a los contextos habituales
    if (this.contextoViaje.actividadId) {
      return 'Actividad';
    } else if (this.contextoViaje.itinerarioId) {
      return 'Itinerario';
    } else {
      return 'Viaje';
    }
  }

  // Método personalizado para obtener ubicación más detallada
  // Método personalizado para obtener ubicación más detallada
  private obtenerUbicacionDetallada(ubicacion: UbicacionReversa): string {
    if (!ubicacion) return 'Ubicación';

    // Intentar construir dirección desde datos estructurados primero
    if (ubicacion.ciudad || ubicacion.region || ubicacion.pais) {
      const partes = [];

      // Si tenemos dirección completa, intentar extraer la calle
      if (ubicacion.direccion) {
        const direccionPartes = ubicacion.direccion.split(',').map(p => p.trim());

        // Buscar la primera parte que parezca una calle
        const calle = direccionPartes.find(parte => {
          const parteMin = parte.toLowerCase();
          return !parteMin.includes(ubicacion.ciudad?.toLowerCase() || '') &&
            !parteMin.includes(ubicacion.region?.toLowerCase() || '') &&
            !parteMin.includes(ubicacion.pais?.toLowerCase() || '') &&
            !parteMin.includes('españa') &&
            !parteMin.includes('spain') &&
            !parte.match(/^\d{5}$/) && // No código postal
            parte.length > 3;
        });

        if (calle) partes.push(calle);
      }

      // Añadir ciudad si existe
      if (ubicacion.ciudad) partes.push(ubicacion.ciudad);

      // Añadir región/provincia si existe y es diferente a la ciudad
      if (ubicacion.region && ubicacion.region !== ubicacion.ciudad) {
        partes.push(ubicacion.region);
      }

      // Añadir país si existe
      if (ubicacion.pais) partes.push(ubicacion.pais);

      if (partes.length > 0) {
        return partes.join(', ');
      }
    }

    // Fallback: usar dirección completa pero limitada
    if (ubicacion.direccion) {
      const direccionPartes = ubicacion.direccion.split(',').map(p => p.trim());

      // Filtrar y tomar máximo 5 partes útiles (incluyendo país)
      const partesUtiles = direccionPartes.filter(parte => {
        const parteMinuscula = parte.toLowerCase();
        return !parte.match(/^\d{5}$/) && // No códigos postales
          parte.length > 2;
      });

      if (partesUtiles.length > 0) {
        return partesUtiles.slice(0, 5).join(', ');
      }
    }

    // Último fallback
    return this.geocodificacionService.obtenerNombreCorto(ubicacion);
  }

  private cargarUbicacionPorCoordenadas(coordenadas: { latitud: number, longitud: number, altitud?: number }, cacheKey: string): void {
    console.log(`🌍 Cargando ubicación para coordenadas:`, coordenadas);

    this.ubicacionesCache.set(cacheKey, 'Cargando...');

    this.geocodificacionService.obtenerUbicacionPorCoordenadas(`${coordenadas.latitud},${coordenadas.longitud}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (ubicacion) => {
          if (ubicacion && ubicacion.nombreCompleto) {
            // CAMBIAR ESTA LÍNEA:
            const nombreDetallado = this.obtenerUbicacionDetallada(ubicacion);
            this.ubicacionesCache.set(cacheKey, nombreDetallado);
            console.log(`✅ Ubicación cargada para ${cacheKey}: ${nombreDetallado}`);
          } else {
            console.warn(`⚠️ No se pudo geocodificar ${cacheKey}`);
            this.ubicacionesCache.set(cacheKey, 'Ubicación');
          }
        },
        error: (error) => {
          console.error(`❌ Error al geocodificar ${cacheKey}:`, error);
          this.ubicacionesCache.set(cacheKey, 'Ubicación');
        }
      });
  }

  //método para cargar ubicación
  private cargarUbicacionArchivo(coordenadas: string): void {
    // Evitar múltiples llamadas para las mismas coordenadas
    if (this.ubicacionesCache.has(coordenadas)) {
      return;
    }

    // Marcar como "cargando" para evitar llamadas duplicadas
    this.ubicacionesCache.set(coordenadas, 'Cargando...');

    this.geocodificacionService.obtenerUbicacionPorCoordenadas(coordenadas)
      .pipe(takeUntil(this.destroy$))
      .subscribe(ubicacion => {
        if (ubicacion && ubicacion.nombreCompleto) {
          // Usar nombre corto para la UI
          const nombreCorto = this.geocodificacionService.obtenerNombreCorto(ubicacion);
          this.ubicacionesCache.set(coordenadas, nombreCorto);
        } else {
          // Si no se puede geocodificar, usar "Ubicación"
          this.ubicacionesCache.set(coordenadas, 'Ubicación');
        }
      });
  }

  //Método para precargar todas las ubicaciones al abrir el álbum
  private async precargarUbicaciones(): Promise<void> {
    console.log('🌍 Precargando ubicaciones...');

    const coordenadasUnicas = new Map<string, { latitud: number, longitud: number, altitud?: number }>();

    // Recopilar coordenadas únicas de las páginas
    this.paginas.forEach(pagina => {
      if (!pagina.esIndice && pagina.coordenadas) {
        const key = `${pagina.coordenadas.latitud},${pagina.coordenadas.longitud}`;
        coordenadasUnicas.set(key, pagina.coordenadas);
      }
    });

    if (coordenadasUnicas.size === 0) {
      console.log('📍 No hay coordenadas para precargar');
      return;
    }

    console.log(`📍 Precargando ${coordenadasUnicas.size} ubicaciones únicas`);

    // Cargar todas las ubicaciones en lotes
    const coordenadasArray = Array.from(coordenadasUnicas.entries());
    const lotes = this.dividirEnLotes(coordenadasArray, 5);

    for (const lote of lotes) {
      const promesas = lote.map(([key, coords]) =>
        this.geocodificacionService.obtenerUbicacionPorCoordenadas(`${coords.latitud},${coords.longitud}`)
          .pipe(takeUntil(this.destroy$))
          .toPromise()
          .then(ubicacion => {
            if (ubicacion && ubicacion.nombreCompleto) {
              const nombreDetallado = this.obtenerUbicacionDetallada(ubicacion); // CAMBIAR ESTA LÍNEA
              this.ubicacionesCache.set(key, nombreDetallado);
              console.log(`✅ Ubicación precargada para ${key}: ${nombreDetallado}`);
            } else {
              console.warn(`⚠️ No se pudo precargar ubicación para ${key}`);
              this.ubicacionesCache.set(key, 'Ubicación');
            }
          })
          .catch(error => {
            console.error(`❌ Error al precargar ubicación para ${key}:`, error);
            this.ubicacionesCache.set(key, 'Ubicación');
          })
      );

      await Promise.all(promesas);
      // Pequeña pausa entre lotes para ser respetuosos con la API
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('✅ Precarga de ubicaciones completada');
  }

  // MÉTODO DE DEBUG para verificar las coordenadas
  debugCoordenadas(): void {
    console.log('=== DEBUG COORDENADAS ===');
    this.paginas.forEach((pagina, index) => {
      if (!pagina.esIndice) {
        console.log(`Página ${index}:`, {
          archivo: pagina.archivo.nombreArchivo,
          geolocalizacionOriginal: pagina.archivo.geolocalizacion,
          coordenadasProcesadas: pagina.coordenadas,
          tieneUbicacion: !!pagina.coordenadas
        });
      }
    });
    console.log('========================');

    console.log('=== CACHE UBICACIONES ===');
    this.ubicacionesCache.forEach((valor, clave) => {
      console.log(`${clave}: ${valor}`);
    });
    console.log('=========================');
  }

  // MÉTODO PARA OBTENER INFORMACIÓN DE COORDENADAS (para mostrar en UI)
  obtenerInfoCoordenadas(pagina: PaginaMedia): string {
    if (!pagina.coordenadas) return '';

    const { latitud, longitud, altitud } = pagina.coordenadas;
    let info = `${latitud.toFixed(6)}, ${longitud.toFixed(6)}`;

    if (altitud !== undefined) {
      info += ` (${altitud}m)`;
    }

    return info;
  }

  //MÉTODO AUXILIAR para dividir arrays en lotes
  private dividirEnLotes<T>(array: T[], tamanoLote: number): T[][] {
    const lotes: T[][] = [];
    for (let i = 0; i < array.length; i += tamanoLote) {
      lotes.push(array.slice(i, i + tamanoLote));
    }
    return lotes;
  }

  private dmsToDecimal(grados: number, minutos: number, segundos: number, direccion: 'N' | 'S' | 'E' | 'W'): number {
    let decimal = grados + (minutos / 60) + (segundos / 3600);

    if (direccion === 'S' || direccion === 'W') {
      decimal = -decimal;
    }

    return decimal;
  }

  private corregirLongitudEspana(longitud: number, latitud: number): number {
    // Solo aplicamos corrección si estamos en la franja de latitud española
    if (latitud >= 36 && latitud <= 43.8) {
      // Rango válido aproximado de longitudes en España
      const minLong = -9.5;
      const maxLong = 4.5;

      if (longitud < minLong || longitud > maxLong) {
        const corregida = -longitud;
        // Solo corregimos si la longitud corregida está en el rango válido
        if (corregida >= minLong && corregida <= maxLong) {
          console.log(`🔧 Corrigiendo longitud española: ${longitud} → ${corregida}`);
          return corregida;
        }
      }
    }

    // Si ya es válida, devolver tal cual
    return longitud;
  }


  // Añadir este método nuevo
  private procesarGeolocalizacion(geolocalizacion: string): { latitud: number, longitud: number, altitud?: number } | null {
    try {
      console.log('📍 Procesando geolocalización:', geolocalizacion);

      // Intentar parsear como JSON primero
      try {
        const parsed = JSON.parse(geolocalizacion);

        if (typeof parsed.latitud === 'number' && typeof parsed.longitud === 'number') {
          const latitudOriginal = parsed.latitud;
          const longitudOriginal = parsed.longitud;
          const longitudCorregida = this.corregirLongitudEspana(longitudOriginal, latitudOriginal);

          if (longitudOriginal !== longitudCorregida) {
            console.log(`🔧 Coordenadas corregidas: ${latitudOriginal},${longitudOriginal} → ${latitudOriginal},${longitudCorregida}`);
          }

          return {
            latitud: latitudOriginal,
            longitud: longitudCorregida,
            altitud: parsed.altitud
          };
        }
      } catch {
        // No es JSON válido, continuar con otros formatos
      }

      // Formato decimal simple separado por comas
      if (geolocalizacion.includes(',')) {
        const partes = geolocalizacion.split(',').map(s => s.trim());
        if (partes.length >= 2) {
          const latitud = parseFloat(partes[0]);
          const longitud = parseFloat(partes[1]);
          const altitud = partes.length > 2 ? parseFloat(partes[2]) : undefined;

          if (!isNaN(latitud) && !isNaN(longitud)) {
            return {
              latitud,
              longitud: this.corregirLongitudEspana(longitud, latitud),
              altitud: isNaN(altitud!) ? undefined : altitud
            };
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Error al procesar geolocalización:', error);
      return null;
    }
  }


  // ==========================================
  // MÉTODOS AUXILIARES Y DE UTILIDAD
  // ==========================================

  isArray(value: any): boolean {
    return Array.isArray(value);
  }

  esArchivoVisualizableEnNavegador(tipo: TipoMedia): boolean {
    return ['imagen', 'video', 'audio', 'pdf'].includes(tipo);
  }

  obtenerIconoTipo(tipo: TipoMedia): string {
    const iconos = {
      imagen: 'fas fa-image',
      video: 'fas fa-video',
      audio: 'fas fa-music',
      pdf: 'fas fa-file-pdf',
      documento: 'fas fa-file-alt',
      texto: 'fas fa-file-text',
      'carta-manuscrita': 'fas fa-envelope',
      'mapa-animado': 'fas fa-route',
      desconocido: 'fas fa-file'
    };
    return iconos[tipo] || iconos['desconocido'];
  }

  formatearTamano(bytes?: number): string {
    if (!bytes) return '';

    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${Math.round(size * 10) / 10} ${units[unitIndex]}`;
  }

  formatearFecha(fecha: string): string {
    if (!fecha) return '';

    try {
      const fechaObj = new Date(fecha);
      return fechaObj.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch (error) {
      return fecha;
    }
  }

  // ==========================================
  // MÉTODOS ESPECÍFICOS PARA TIPOS DE ARCHIVO
  // ==========================================

  esImagen(tipo: TipoMedia): boolean {
    return tipo === 'imagen';
  }

  esVideo(tipo: TipoMedia): boolean {
    return tipo === 'video';
  }

  esAudio(tipo: TipoMedia): boolean {
    return tipo === 'audio';
  }

  esPDF(tipo: TipoMedia): boolean {
    return tipo === 'pdf';
  }

  esDocumento(tipo: TipoMedia): boolean {
    return tipo === 'documento';
  }

  // ==========================================
  // MÉTODOS DE NAVEGACIÓN INTELIGENTE
  // ==========================================

  puedeNavegar(direccion: 'anterior' | 'siguiente'): boolean {
    if (direccion === 'anterior') {
      return this.hayPaginaAnterior;
    } else {
      return this.hayPaginaSiguiente || (
        !!this.contextoViaje?.itinerarioId &&
        !this.contextoViaje.actividadId &&
        this.paginaActual === this.paginas.length - 1
      );
    }
  }

  obtenerMensajeNavegacion(): string {
    if (!this.contextoViaje) return '';

    if (this.contextoViaje.itinerarioId && !this.contextoViaje.actividadId) {
      if (this.paginaActual === 0) {
        return 'Navega hacia atrás para ver todas las fotos del viaje';
      } else if (this.paginaActual === this.paginas.length - 1) {
        return 'Navega hacia adelante para ver todas las fotos del viaje';
      }
    }

    return '';
  }

  // ==========================================
  // MÉTODOS DE DEBUG Y LOGGING
  // ==========================================

  logEstadoActual(): void {
    console.log('=== ESTADO ACTUAL DEL ÁLBUM ===');
    console.log('Contexto:', this.contextoViaje);
    console.log('Estado:', this.estado);
    console.log('Página actual:', this.paginaActual);
    console.log('Total páginas:', this.paginas.length);
    console.log('Página actual data:', this.paginaActualData);
    console.log('Info viaje:', this.infoViaje);
    console.log('Lista itinerarios:', this.listaItinerarios.length);
    console.log('===============================');
  }

  // ==========================================
  // MÉTODOS DE GESTIÓN DE MEMORIA
  // ==========================================

  limpiarCache(): void {
    console.log('🧹 Limpiando cache...');
    this.imagenViajeUrlCache = null;
    this.paginas.forEach(pagina => {
      pagina.cargado = false;
    });
  }

  // ==========================================
  // MÉTODOS DE ACCESIBILIDAD
  // ==========================================

  obtenerDescripcionAccesibilidad(pagina: PaginaMedia): string {
    if (pagina.esIndice) {
      return 'Página de índice del álbum multimedia';
    }

    const tipo = pagina.tipoMedia;
    const titulo = pagina.titulo || 'Sin título';
    const fecha = this.formatearFecha(pagina.fecha);
    const tamano = this.formatearTamano(pagina.tamano);

    let descripcion = `${tipo} titulada ${titulo}`;
    if (fecha) descripcion += ` del ${fecha}`;
    if (tamano) descripcion += ` con tamaño ${tamano}`;

    return descripcion;
  }

  obtenerTextoAlternativo(pagina: PaginaMedia): string {
    if (pagina.esIndice) {
      return 'Índice del álbum multimedia';
    }

    return pagina.descripcion || pagina.titulo || `${pagina.tipoMedia} sin descripción`;
  }
  // ==========================================
  // PROPIEDADES PARA GENERACIÓN DE VIDEO
  // ==========================================

  generandoVideo = false;
  progresoVideo: ProgresoVideo | null = null;
  mostrarConfiguracionVideo = false;
  mostrarOpcionesAvanzadas = false;

  // Nueva configuración simplificada (Progressive Disclosure)
  configuracionExportacion: ConfiguracionExportacion = {
    incluirAudio: true,
    incluirTexto: true,
    incluirDescripcion: true,
    calidad: 'whatsapp',
    mantenerEstiloAlbum: true
  };

  // Mantener por compatibilidad temporal con el servicio actual si fuera necesario
  // pero usaremos la nueva lógica
  configuracionVideo = {
    duracionPorFoto: 3,
    tipoTransicion: 'fade',
    duracionTransicion: 1,
    incluirTexto: true,
    calidad: 'media',
    mostrarDescripciones: true,
    resolucion: '720p',
    transicionesAleatorias: false
  };

  // ==========================================
  // MÉTODOS PARA GENERACIÓN DE VIDEO
  // ==========================================

  mostrarDialogoVideo(): void {
    this.mostrarConfiguracionVideo = true;
    document.body.style.overflow = 'hidden';
  }

  cerrarDialogoVideo(): void {
    this.mostrarConfiguracionVideo = false;
    document.body.style.overflow = '';
  }

  async generarVideoViaje(): Promise<void> {
    if (this.generandoVideo) return;

    try {
      this.generandoVideo = true;
      this.progresoVideo = {
        fase: 'cargando',
        porcentaje: 0,
        mensaje: 'Preparando secuencia del viaje...'
      };

      // 1. Construir la secuencia única de escenas basada en el estado actual del álbum
      const secuencia = this.construirSecuenciaEscenas();
      
      if (secuencia.length === 0) {
        throw new Error('No hay contenido para generar el vídeo');
      }

      console.log('🎬 Secuencia de vídeo construida:', secuencia.length, 'escenas');

      // 2. Ejecutar la generación en el servicio
      // ✅ Decisión EXPLÍCITA del usuario: usar el checkbox del modal, no el estado paused del audio
      const incluirMusica = !!(this.configuracionExportacion.incluirAudio && this.audioViaje);
      const audioParaExportacion = incluirMusica ? this.audioViaje! : null;
      console.log('🎵 Opción de exportación: incluir música =', incluirMusica);
      if (incluirMusica) {
        console.log('🎵 Audio del viaje enviado al generador');
      } else {
        console.log('🎵 Exportación sin música por decisión del usuario');
      }

      const videoBlob = await this.videoGeneratorService.generarVideoDesdeSecuencia(
        secuencia,
        this.infoViaje,
        this.configuracionExportacion,
        audioParaExportacion,
        (progreso) => {
          this.progresoVideo = progreso;
        }
      );

      // 3. Gestionar la descarga según el formato real obtenido
      const extension = this.videoGeneratorService.getExtensionVideo();
      const url = URL.createObjectURL(videoBlob);
      const a = document.createElement('a');
      a.href = url;

      const nombreBase = this.contextoViaje?.itinerarioId
        ? `itinerario-${this.contextoViaje.itinerarioId}`
        : this.sanitizarNombreArchivo(this.infoViaje?.nombre || 'viaje');

      a.download = `viaje-${nombreBase}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => URL.revokeObjectURL(url), 1000);
      
      // Feedback final
      this.progresoVideo = {
        fase: 'completado',
        porcentaje: 100,
        mensaje: '¡Vídeo listo para compartir!'
      };

      setTimeout(() => this.cerrarDialogoVideo(), 2000);

    } catch (error) {
      console.error('❌ Error generando vídeo:', error);
      this.progresoVideo = {
        fase: 'error',
        porcentaje: 0,
        mensaje: `Error: ${error instanceof Error ? error.message : 'Error desconocido'}`
      };
      this.generandoVideo = false;
    }
  }

  /**
   * Construye la secuencia de escenas para el vídeo basándose EXACTAMENTE 
   * en lo que el usuario ve en las páginas del álbum.
   */
  private construirSecuenciaEscenas(): EscenaMultimedia[] {
    // Filtramos el índice si existe al principio
    return this.paginas
      .filter(p => !p.esIndice)
      .map((p, index) => {
        const fechaHora = this.obtenerFechaHoraSeparadas(p);
        
        return {
          id: p.archivo?.id || `escena-${index}`,
          tipo: p.esCartaManuscrita ? 'carta' : (p.tipoMedia === 'video' ? 'video' : 'imagen'),
          url: p.url,
          duracion: p.tipoMedia === 'video' ? 0 : 4, // 0 para videos (usarán su duración real), 4s para fotos
          archivo: p.archivo,
          titulo: p.titulo,
          descripcion: p.descripcion,
          fecha: fechaHora.fecha,
          hora: fechaHora.hora,
          itinerarioId: p.archivo?.itinerarioId
        };
      });
  }

  private obtenerFechaHoraSeparadas(p: PaginaMedia): { fecha: string, hora: string } {
    const fechaStr = p.fecha || p.fechaOriginal;
    if (!fechaStr) return { fecha: '', hora: '' };

    try {
      const fechaObj = new Date(fechaStr);
      const fecha = fechaObj.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });

      let hora = '';
      if (p.archivo?.horaCaptura) {
        hora = p.archivo.horaCaptura;
      } else {
        hora = fechaObj.toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
      }

      return { fecha, hora };
    } catch {
      return { fecha: '', hora: '' };
    }
  }

  // ==========================================
  // MÉTODOS AUXILIARES PARA GENERACIÓN DE VIDEO POR CONTEXTO
  // ==========================================

  /**
   * Determina el contexto actual para la generación del video
   * @returns 'paginaPrincipal' | 'itinerarioDetalle'
   */
  private determinarContextoVideo(): 'paginaPrincipal' | 'itinerarioDetalle' {
    if (this.contextoViaje?.itinerarioId && !this.contextoViaje.actividadId) {
      return 'itinerarioDetalle';
    } else {
      return 'paginaPrincipal';
    }
  }

  /**
   * Obtiene las imágenes según el contexto
   */
  private obtenerImagenesPorContexto(contexto: 'paginaPrincipal' | 'itinerarioDetalle'): Archivo[] {
    if (contexto === 'itinerarioDetalle') {
      // Solo imágenes del itinerario actual
      return this.paginas
        .filter(p => !p.esIndice && !p.esCartaManuscrita && p.tipoMedia === 'imagen')
        .map(p => p.archivo);
    } else {
      // Todas las imágenes de todos los itinerarios
      return this.obtenerSoloImagenes();
    }
  }

  /**
   * Obtiene todos los archivos multimedia (imágenes y videos) según el contexto
   */
  private obtenerArchivosMultimediaPorContexto(contexto: 'paginaPrincipal' | 'itinerarioDetalle'): Archivo[] {
    if (contexto === 'itinerarioDetalle') {
      // Solo archivos del itinerario actual
      return this.paginas
        .filter(p => !p.esIndice && !p.esCartaManuscrita && (p.tipoMedia === 'imagen' || p.tipoMedia === 'video'))
        .map(p => p.archivo);
    } else {
      // Todos los archivos multimedia de todos los itinerarios
      return this.paginas
        .filter(p => !p.esIndice && !p.esCartaManuscrita && (p.tipoMedia === 'imagen' || p.tipoMedia === 'video'))
        .map(p => p.archivo);
    }
  }

  /**
   * Obtiene las cartas manuscritas según el contexto
   */
  private obtenerCartasManuscritasPorContexto(contexto: 'paginaPrincipal' | 'itinerarioDetalle'): any[] {
    if (contexto === 'itinerarioDetalle') {
      // Solo la carta del itinerario actual
      return this.paginas
        .filter(p => p.esCartaManuscrita)
        .map(p => ({
          titulo: p.titulo,
          descripcion: p.descripcion,
          fecha: p.fecha,
          itinerarioId: this.contextoViaje!.itinerarioId
        }));
    } else {
      // Todas las cartas de todos los itinerarios
      return this.paginas
        .filter(p => p.esCartaManuscrita && !p.esIndice)
        .map(p => {
          const itinerario = this.listaItinerarios.find(it => {
            if (!it.destinosPorDia) return false;
            const destinoLimpio = it.destinosPorDia
              .replace(/["'\\]/g, '')
              .split(',')[0]
              .trim();
            return p.titulo.toLowerCase().includes(destinoLimpio.toLowerCase());
          });

          return {
            titulo: p.titulo,
            descripcion: p.descripcion,
            fecha: p.fecha,
            itinerarioId: itinerario?.id
          };
        });
    }
  }

  /**
   * Obtiene los itinerarios según el contexto
   */
  private obtenerItinerariosPorContexto(contexto: 'paginaPrincipal' | 'itinerarioDetalle'): any[] {
    if (contexto === 'itinerarioDetalle') {
      // Solo el itinerario actual
      return this.listaItinerarios.filter(
        it => it.id === this.contextoViaje!.itinerarioId
      );
    } else {
      // Todos los itinerarios del viaje
      return [...this.listaItinerarios];
    }
  }

  toggleOpcionesAvanzadas(): void {
    this.mostrarOpcionesAvanzadas = !this.mostrarOpcionesAvanzadas;
  }

  public obtenerSoloImagenes(): Archivo[] {
    // Mantener el orden exacto de visualización en pantalla
    return this.paginas
      .filter(p => !p.esIndice && !p.esCartaManuscrita && p.tipoMedia === 'imagen')
      .map(p => p.archivo);
  }

  private sanitizarNombreArchivo(nombre: string): string {
    return nombre
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  // MÉTODO TEMPORAL DE DEBUG
  debugPaginaActual(): void {
    console.log('=== DEBUG PÁGINA ACTUAL ===');
    console.log('paginaActual index:', this.paginaActual);
    console.log('paginaActualData:', this.paginaActualData);
    console.log('esCartaManuscrita:', this.paginaActualData?.esCartaManuscrita);
    console.log('titulo:', this.paginaActualData?.titulo);
    console.log('descripcion:', this.paginaActualData?.descripcion);
    console.log('tipoMedia:', this.paginaActualData?.tipoMedia);
    console.log('todas las páginas:', this.paginas.map(p => ({
      esIndice: p.esIndice,
      esCartaManuscrita: p.esCartaManuscrita,
      titulo: p.titulo,
      tipoMedia: p.tipoMedia
    })));
    console.log('==========================');
  }
  onVideoPlay(): void {
    this.bajarVolumenAudioViaje();
  }

  onVideoPause(): void {
    this.restaurarVolumenAudioViaje();
  }

  onVideoEnded(): void {
    this.restaurarVolumenAudioViaje();
  }

}