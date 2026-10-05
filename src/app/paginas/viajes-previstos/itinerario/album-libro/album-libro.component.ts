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
import { MiniMapaGpxComponent } from '../../../../componentes/mini-mapa-gpx/mini-mapa-gpx.component';
import { MapaResumenSpreadComponent } from '../../../../componentes/mapa-resumen-spread/mapa-resumen-spread.component';
import { GpxAnimationService, GpxPoint } from '../../../../servicios/gpx-animation.service';
import { TrackEditorService } from '../../../../servicios/track-editor.service';
import { RouteVideoGeneratorService, ProgresoRenderizadoRuta, PuntoClaveMapa } from '../../../../servicios/route-video-generator.service';
import { IntroCinematicaDynamicsComponent } from '../../../../componentes/intro-cinematica-dynamics/intro-cinematica-dynamics.component';
import { IntroMemoryPreloaderService } from '../../../../servicios/intro-memory-preloader.service';
import { IntroVideoGeneratorService } from '../../../../servicios/intro-video-generator.service';

// ==========================================
// TIPOS E INTERFACES
// ==========================================

// Tipos de archivos multimedia soportados
export type TipoMedia = 'imagen' | 'video' | 'audio' | 'documento' | 'pdf' | 'texto' | 'carta-manuscrita' | 'mapa-animado' | 'desconocido';

interface PaginaMedia {
  archivo: Archivo;
  url: string;
  urlMapaRenderizado?: string;
  urlVideoAnimacion?: string;
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
  esMapaGeneral?: boolean;
  esMapaItinerario?: boolean;
  duracionDias?: number;
  idParadaOrigen?: number;
  idParadaDestino?: number;
  trackGpx?: string;
  distanciaTramoKm?: number;
  distanciaInicioTramo?: number;
  distanciaFinTramo?: number;
  distanciaAcumuladaKm?: number;
  horaFormateada?: string;
  transportSegments?: any[];
  puntosClave?: PuntoClaveMapa[];
  visualSessionData?: any;
  isHighFidelityMode?: boolean;
  actividadId?: number;
  horaInicioTramo?: string;
  horaFinTramo?: string;
  tipoTransporteTramo?: string;
  coordenadas?: {
    latitud: number;
    longitud: number;
    altitud?: number;
  };
  archivosAsociados?: any[];
  multimedia?: any[];
  timestampReal?: number;
  itinerarioId?: number;
  /** Etiqueta de dirección (calle, ciudad, región) del punto de inicio del tramo */
  origenDireccion?: string;
  /** Etiqueta de dirección (calle, ciudad, región) del punto de destino del tramo */
  destinoDireccion?: string;
  /** Coordenadas GPS del primer punto del tramo (para geocodificación lazy) */
  coordenadasOrigen?: { lat: number; lng: number };
  /** Coordenadas GPS del último punto del tramo (para geocodificación lazy) */
  coordenadasDestino?: { lat: number; lng: number };
  /** Información estructurada de salida (calle, pueblo, provincia) */
  origenInfo?: any;
  /** Información estructurada de destino (calle, pueblo, provincia) */
  destinoInfo?: any;
}

export interface SpreadLibro {
  tipo: 'intro' | 'mapa' | 'fotos';
  indices: number[];
  paginaIzquierda: PaginaMedia | null;
  paginaDerecha: PaginaMedia | null;
  paginaMapa?: PaginaMedia | null;
}

interface ContextoViaje {
  viajeId: number;
  itinerarioId?: number;
  actividadId?: number;
}

interface InfoViaje {
  id?: number;
  nombre: string;
  destino?: string;
  descripcion?: string;
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
  imports: [CommonModule, FontAwesomeModule, FormsModule, GpxAnimationComponent, MiniMapaGpxComponent, IntroCinematicaDynamicsComponent, MapaResumenSpreadComponent],
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

  // 🎬 INTRODUCCIÓN DEL ÁLBUM: VÍDEO CINEMÁTICO MP4 O 3D DYNAMICS
  tipoIntro: 'video-mp4' | '3d-interactiva' = 'video-mp4';
  mostrarModalIntro: boolean = false;
  mostrarIntroDynamics: boolean = false;
  introDynamicsReproducida: boolean = false;

  // 🎬 SELECCIÓN PERSONALIZADA DE ARCHIVOS MULTIMEDIA PARA VÍDEO Y RECORRIDO
  totalFotosAlbum: number = 0;
  totalFotosSeleccionadas: number = 0;
  totalArchivosAlbum: number = 0;
  totalArchivosSeleccionados: number = 0;
  haySeleccionVideoPersonalizada: boolean = false;

  // ==========================================
  // PROPIEDADES PARA AUDIO DEL VIAJE
  // ==========================================

  audioViaje: HTMLAudioElement | null = null;
  audioReproduciendo = false;
  audioDisponible = false;
  volumenOriginal = 1;
  modoRecuerdoActivo = false;
  modoGuiadoActivo = false;
  audioAutoplayBloqueado = false;
  private audioCrossfadeInterval: any = null;
  private audioUrlActual: string | null = null;
  private itinerarioActualAudioId: number | null = null;

  // ==========================================
  // PROPIEDADES DE CONTEXTO Y DATOS
  // ==========================================

  infoViaje: InfoViaje | null = null;
  contextoViaje: ContextoViaje | null = null;
  listaItinerarios: any[] = [];

  // ==========================================
  // 📏⏱️ TELEMETRÍA DE RECORRIDO (ODÓMETRO Y HORARIOS)
  // ==========================================
  mostrarTelemetriaHud: boolean = true;
  itinerarioHoraInicio: string = '';
  itinerarioHoraFin: string = '';
  itinerarioOrigenNombre: string = '';
  itinerarioDestinoNombre: string = '';

  // ==========================================
  // PROPIEDADES DE FULLSCREEN
  // ==========================================

  mediaFullscreen = '';
  tipoFullscreen: TipoMedia = 'imagen';
  mostrarFullscreen = false;
  fullscreenSinglePageMode = false;
  paginaSinglePageActual: PaginaMedia | null = null;
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

  // Controla si se muestra la información del archivo y si está anclada por clic
  mostrarInfoDetalle: boolean = false;
  infoDetalleFijado: boolean = false;
  timeoutOcultarInfo: any = null;

  // ==========================================
  // PROPIEDADES PARA SLIDESHOW (PASE DE DIAPOSITIVAS)
  // ==========================================
  reproduciendoSlideshow: boolean = false;
  private timerSlideshow: any = null;
  private timerFallbackMapa: any = null;
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
  // CONFIGURACIÓN MODO ÁLBUM VINTAGE 3D Y FULLSCREEN
  // ==========================================
  modoAlbumVintage: boolean = localStorage.getItem('album_modo_vintage') !== 'false';
  reproducirEnFullscreen: boolean = localStorage.getItem('album_reproducir_fullscreen') !== 'false';
  modoRutaImagen: boolean = localStorage.getItem('album_modo_ruta_imagen') === 'true';

  // ==========================================
  // CONFIGURACIÓN MODO ZOOM CINEMÁTICO & DESACOPLE MULTIMEDIA
  // ==========================================
  modoZoomCinematico: boolean = localStorage.getItem('album_modo_zoom_cinematico') === 'true';
  secuenciaCinematicaEnCurso: boolean = false;
  private abortControllerCinematico: AbortController | null = null;
  private timerCinematicoHold: any = null;

  elementoMaximizado: {
    pagina: PaginaMedia;
    tipo: 'imagen' | 'video' | 'audio';
    lado: 'izq' | 'der';
    zoom: number;
    rotacion: number;
    panX: number;
    panY: number;
    isDragging?: boolean;
    startX?: number;
    startY?: number;
    startPanX?: number;
    startPanY?: number;
    animandoEntrada?: boolean;
    animandoSalida?: boolean;
    esCinematico?: boolean;
  } | null = null;

  mostrarModalOutro: boolean = false;

  hojaVolteando3D: boolean = false;
  abriendoPortada3D: boolean = false;
  direccionVolteo3D: 'adelante' | 'atras' = 'adelante';
  paginaVolteoSaliente: PaginaMedia | null = null;
  paginaVolteoEntrante: PaginaMedia | null = null;
  paginaDebajoIzquierda: PaginaMedia | null = null;
  paginaDebajoDerecha: PaginaMedia | null = null;
  private pendienteAbrirLibro: { activarModoRecuerdo: boolean; modoGuiado: boolean } | null = null;

  spreadActual: number = 0;
  videoMuted: boolean = false; // Por defecto el volumen de los vídeos está abierto (se oyen)
  videoActualSecuencia: 'izq' | 'der' | 'single' | null = null;
  private timerVideoPreview: any = null;
  mapaRenderKey: string = 'map_active';
  forzarMapaInteractivo: boolean = false;
  cargandoMapaInteractivo: boolean = false;
  private colaPrecachingSubtramos: PaginaMedia[] = [];
  private procesandoPrecaching: boolean = false;
  generandoVideoRutaEnCurso: boolean = false;
  progresoRenderVideoRuta: string = '';

  // 🎬 Generación en lote de vídeos de animaciones (subtramos)
  generandoLoteVideos: boolean = false;
  loteVideoActual: number = 0;
  loteVideoTotal: number = 0;
  loteVideoTitulo: string = '';
  loteVideoProgresoTramo: number = 0;
  loteVideoProgresoGlobal: number = 0;
  loteVideoMensajeProgreso: string = '';
  private cancelarLoteVideos: boolean = false;

  reiniciarInstanciaMapa(): void {
    if (!this.mapaRenderKey) {
      this.mapaRenderKey = 'map_active';
    }
    this.cdr.detectChanges();
  }

  get distanciaTotalKm(): number {
    if (!this.paginas || this.paginas.length === 0) return 29.8;
    const mapaGeneral = this.paginas.find(p => p.esMapaGeneral && p.distanciaTramoKm && p.distanciaTramoKm > 0);
    if (mapaGeneral && mapaGeneral.distanciaTramoKm) {
      return parseFloat(mapaGeneral.distanciaTramoKm.toFixed(2));
    }
    const sumaSubtramos = this.paginas
      .filter(p => !p.esMapaGeneral && !p.esMapaItinerario && p.distanciaTramoKm && p.distanciaTramoKm > 0)
      .reduce((acc, p) => acc + (p.distanciaTramoKm || 0), 0);

    let gpxSumKm = 0;
    if (this.cacheDatosActividadGpx && this.cacheDatosActividadGpx.size > 0) {
      this.cacheDatosActividadGpx.forEach(d => {
        if (d.points && d.points.length > 0) {
          const lastPt = d.points[d.points.length - 1];
          gpxSumKm += (lastPt.distAcum || 0) / 1000;
        }
      });
    }

    const total = Math.max(sumaSubtramos, gpxSumKm);
    return total > 0 ? parseFloat(total.toFixed(2)) : 29.8;
  }

  /**
   * 📏⏱️ Getter reactivo con la telemetría actual según la página/spread activo
   */
  get telemetriaActual(): {
    kmActual: number;
    kmTotal: number;
    fechaActual?: string;
    fechaFormateadaLarga?: string;
    horaActual: string;
    horaIzquierda?: string;
    horaDerecha?: string;
    esDobleHora: boolean;
    horaInicio: string;
    horaFin: string;
    porcentaje: number;
    origen: string;
    destino: string;
    tituloHito?: string;
  } {
    let pag: PaginaMedia | null = null;
    let pagIzq: PaginaMedia | null = null;
    let pagDer: PaginaMedia | null = null;
    let esDobleFoto = false;

    if (this.mostrarFullscreen) {
      if (this.fullscreenSinglePageMode && this.paginaSinglePageActual) {
        pag = this.paginaSinglePageActual;
      } else if (!this.modoAlbumVintage) {
        pag = this.paginas[this.paginaActual] || this.paginaActualData;
      } else {
        // En modo Vintage Fullscreen (2 páginas abiertas)
        if (this.spreadActualData?.tipo === 'mapa') {
          pag = this.spreadActualData.paginaMapa || this.paginas[this.paginaActual] || this.paginaActualData;
        } else {
          pagIzq = this.paginaSpreadIzquierda;
          pagDer = this.paginaSpreadDerecha;
          pag = pagDer || pagIzq || this.paginas[this.paginaActual] || this.paginaActualData;
          if (this.spreadActualData?.tipo === 'fotos' && pagIzq && pagDer) {
            esDobleFoto = true;
          }
        }
      }
    } else {
      if (this.modoAlbumVintage) {
        if (this.spreadActualData?.tipo === 'mapa') {
          pag = this.spreadActualData.paginaMapa || this.paginas[this.paginaActual] || this.paginaActualData;
        } else {
          pagIzq = this.paginaSpreadIzquierda;
          pagDer = this.paginaSpreadDerecha;
          pag = pagDer || pagIzq || this.paginaActualData;
          if (this.spreadActualData?.tipo === 'fotos' && pagIzq && pagDer) {
            esDobleFoto = true;
          }
        }
      } else {
        pag = this.paginaActualData;
      }
    }

    const kmTotal = this.distanciaTotalKm;
    let kmActual = pag?.distanciaAcumuladaKm ?? 0;

    // Si estamos en la portada o página inicial
    if (this.estado === 'portada' || (this.modoAlbumVintage && this.spreadActual === 0) || this.paginaActual === 0) {
      kmActual = 0.0;
    } else if (this.paginaActual >= this.paginas.length - 1 && kmTotal > 0) {
      kmActual = kmTotal;
    } else if (kmActual === 0 && this.paginaActual > 0 && kmTotal > 0) {
      const pObj = this.paginas[this.paginaActual];
      kmActual = pObj?.distanciaAcumuladaKm ?? parseFloat(((this.paginaActual / Math.max(1, this.paginas.length - 1)) * kmTotal).toFixed(1));
    }

    let horaActual = pag?.horaFormateada || this.paginas[this.paginaActual]?.horaFormateada || '';
    if (this.estado === 'portada' || this.paginaActual === 0) {
      horaActual = this.itinerarioHoraInicio || '09:00';
    } else if (!horaActual) {
      if (this.paginaActual >= this.paginas.length - 1) {
        horaActual = this.itinerarioHoraFin || '20:00';
      } else {
        horaActual = this.itinerarioHoraInicio || '09:00';
      }
    }

    let fechaRaw = pagDer?.fecha || pagIzq?.fecha || pag?.fecha || '';
    if (!fechaRaw && this.paginas[this.paginaActual]?.fecha) {
      fechaRaw = this.paginas[this.paginaActual].fecha;
    }
    if (!fechaRaw && this.infoViaje?.fechaInicio) {
      fechaRaw = this.infoViaje.fechaInicio;
    }

    let fechaActual = '';
    let fechaFormateadaLarga = '';

    if (esDobleFoto && pagIzq && pagDer) {
      const fIzq = pagIzq.fecha || pagIzq.archivo?.fechaCreacion || '';
      const fDer = pagDer.fecha || pagDer.archivo?.fechaCreacion || '';
      const cIzq = this.formatearFechaCorta(fIzq);
      const cDer = this.formatearFechaCorta(fDer);
      if (cIzq && cDer && cIzq !== cDer) {
        fechaActual = `${cIzq} ➔ ${cDer}`;
      } else {
        fechaActual = cDer || cIzq || this.formatearFechaCorta(fechaRaw);
      }
      fechaFormateadaLarga = this.formatearFecha(fDer || fIzq || fechaRaw);
    } else {
      fechaActual = this.formatearFechaCorta(fechaRaw);
      fechaFormateadaLarga = this.formatearFecha(fechaRaw);
    }

    let horaIzquierda = '';
    let horaDerecha = '';
    let esDobleHora = false;

    if (esDobleFoto && pagIzq && pagDer) {
      horaIzquierda = pagIzq.horaFormateada || this.formatearHoraDePagina(pagIzq, this.itinerarioHoraInicio || '09:00');
      horaDerecha = pagDer.horaFormateada || this.formatearHoraDePagina(pagDer, this.itinerarioHoraFin || '20:00');
      if (horaIzquierda && horaDerecha) {
        esDobleHora = true;
        horaActual = horaIzquierda !== horaDerecha ? `${horaIzquierda} ➔ ${horaDerecha}` : horaIzquierda;
      }
    }

    const pct = kmTotal > 0 ? Math.min(100, Math.max(0, Math.round((kmActual / kmTotal) * 100))) : 0;

    return {
      kmActual: parseFloat(kmActual.toFixed(1)),
      kmTotal: parseFloat(kmTotal.toFixed(1)),
      fechaActual,
      fechaFormateadaLarga,
      horaActual,
      horaIzquierda,
      horaDerecha,
      esDobleHora,
      horaInicio: this.itinerarioHoraInicio || '09:00',
      horaFin: this.itinerarioHoraFin || '20:00',
      porcentaje: pct,
      origen: this.itinerarioOrigenNombre || 'Inicio',
      destino: this.itinerarioDestinoNombre || 'Destino final',
      tituloHito: pag?.titulo || ''
    };
  }

  formatearFechaCorta(fechaStr?: string): string {
    if (!fechaStr) return '';
    try {
      const d = new Date(fechaStr);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    } catch (e) { }
    return fechaStr;
  }

  obtenerTituloIntroLimpio(): string {
    const rawNombre = this.infoViaje?.nombre || this.infoViaje?.destino || 'ESPAÑA';
    const destinoLimpio = rawNombre
      .replace(/\s*-\s*\d{2}\/\d{2}\/\d{4}.*$/i, '')
      .replace(/\s*-\s*[\d.,]+\s*km$/i, '')
      .trim()
      .toUpperCase();

    let fecha = '';
    if (this.infoViaje?.fechaInicio) {
      try {
        const d = new Date(this.infoViaje.fechaInicio);
        if (!isNaN(d.getTime())) {
          const dia = String(d.getDate()).padStart(2, '0');
          const mes = String(d.getMonth() + 1).padStart(2, '0');
          const anio = d.getFullYear();
          fecha = `${dia}/${mes}/${anio}`;
        }
      } catch (e) {}
    }
    const dist = this.distanciaTotalKm > 0 ? `${this.distanciaTotalKm.toFixed(2)} KM` : '';

    const partes = [destinoLimpio];
    if (fecha) partes.push(fecha);
    if (dist) partes.push(dist);

    return partes.join(' - ');
  }

  esTextoDuplicado(titulo?: string, desc?: string): boolean {
    if (!titulo || !desc) return false;
    const normT = titulo.trim().toLowerCase();
    const normD = desc.trim().toLowerCase();
    return normT === normD || normT.startsWith(normD) || normD.startsWith(normT);
  }

  toggleTelemetriaHud(): void {
    this.mostrarTelemetriaHud = !this.mostrarTelemetriaHud;
  }

  private formatearHoraDePagina(p: PaginaMedia, fallback: string): string {
    if (p.archivo?.horaCaptura && p.archivo.horaCaptura !== '00:00:00') {
      return p.archivo.horaCaptura.substring(0, 5);
    }
    const ts = this.obtenerTimestampReal(p);
    if (ts && ts > 0) {
      const dt = new Date(ts);
      if (dt.getUTCHours() !== 0 || dt.getUTCMinutes() !== 0 || dt.getUTCSeconds() !== 0) {
        return dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      }
    }
    return fallback;
  }

  private interpolarHora(hInicio: string, hFin: string, ratio: number): string {
    const parseMins = (hStr: string, fallback: number) => {
      if (!hStr) return fallback;
      const parts = hStr.split(':').map(n => parseInt(n, 10));
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return parts[0] * 60 + parts[1];
      }
      return fallback;
    };
    const m1 = parseMins(hInicio, 9 * 60);
    let m2 = parseMins(hFin, 20 * 60);
    if (m2 <= m1) m2 = m1 + 120;
    const mInter = Math.round(m1 + Math.max(0, Math.min(1, ratio)) * (m2 - m1));
    const hh = String(Math.floor(mInter / 60) % 24).padStart(2, '0');
    const mm = String(mInter % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  /**
   * 📏⏱️ Sincroniza y compagina la telemetría del itinerario:
   * Asigna distancia acumulada (km) desde 0.0 hasta el total, y horarios
   * de inicio, fotos intermedias y hora final para cada página del álbum
   * mediante interpolación continua por anclas GPX.
   */
  public calcularTelemetriaItinerario(): void {
    if (!this.paginas || this.paginas.length === 0) return;

    // 1. Extraer nombres de origen y destino, y horarios configurados del itinerario
    let origen = '';
    let destino = '';
    let itHoraInicio = '';
    let itHoraFin = '';

    if (this.contextoViaje?.itinerarioId && this.listaItinerarios?.length > 0) {
      const it = this.listaItinerarios.find(i => i.id === this.contextoViaje?.itinerarioId);
      if (it) {
        if (it.horaInicio) itHoraInicio = it.horaInicio.trim().substring(0, 5);
        if (it.horaFin) itHoraFin = it.horaFin.trim().substring(0, 5);
        if (it.destinosPorDia) {
          const dests = (typeof it.destinosPorDia === 'string' ? it.destinosPorDia.split(',') : it.destinosPorDia)
            .map((d: any) => String(d).replace(/["'\[\]]/g, '').trim())
            .filter(Boolean);
          if (dests.length > 0) {
            origen = dests[0];
            destino = dests[dests.length - 1];
          }
        }
      }
    }

    if (!itHoraInicio && (this.infoViaje as any)?.horaInicio) {
      itHoraInicio = String((this.infoViaje as any).horaInicio).trim().substring(0, 5);
    }
    if (!itHoraFin && (this.infoViaje as any)?.horaFin) {
      itHoraFin = String((this.infoViaje as any).horaFin).trim().substring(0, 5);
    }

    this.itinerarioOrigenNombre = origen || (this.infoViaje?.nombre ? `${this.infoViaje.nombre} (Salida)` : 'Inicio');
    this.itinerarioDestinoNombre = destino || (this.infoViaje?.nombre ? `${this.infoViaje.nombre} (Fin)` : 'Destino final');

    const totalKm = this.distanciaTotalKm;

    // 2. Mapear fotos a puntos GPX reales respetando baseKm acumulado entre actividades
    const fotoGpxMap = new Map<number, { distKm: number; horaStr: string; timestamp: number }>();
    let primerHoraGpx = '';
    let ultimaHoraGpx = '';
    let minTimestamp = Infinity;
    let maxTimestamp = -Infinity;

    // Ordenar actividades según su aparición en las páginas del álbum
    const actIdsOrdenados: number[] = [];
    this.paginas.forEach(p => {
      const actId = p.actividadId || p.archivo?.actividadId;
      if (actId && !actIdsOrdenados.includes(actId) && this.cacheDatosActividadGpx.has(actId)) {
        actIdsOrdenados.push(actId);
      }
    });
    this.cacheDatosActividadGpx.forEach((_, actId) => {
      if (!actIdsOrdenados.includes(actId)) {
        actIdsOrdenados.push(actId);
      }
    });

    let runningBaseKm = 0.0;
    const actInfoMap = new Map<number, { baseKm: number; totalKm: number; horaInicio: string; horaFin: string; tsInicio: number; tsFin: number }>();

    actIdsOrdenados.forEach(actId => {
      const datos = this.cacheDatosActividadGpx.get(actId);
      if (!datos) return;
      const pts: GpxPoint[] = datos.points || [];
      const actBaseKm = runningBaseKm;
      let actDist = 0;
      let hIni = '';
      let hFin = '';
      let tsIni = 0;
      let tsFin = 0;

      if (pts.length > 0) {
        const lastPt = pts[pts.length - 1];
        actDist = (lastPt.distAcum || 0) / 1000;
        if (pts[0].time) {
          const dt0 = new Date(pts[0].time);
          if (dt0.getUTCHours() !== 0 || dt0.getUTCMinutes() !== 0 || dt0.getUTCSeconds() !== 0) {
            hIni = dt0.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            tsIni = dt0.getTime();
          }
        }
        if (lastPt?.time) {
          const dtLast = new Date(lastPt.time);
          if (dtLast.getUTCHours() !== 0 || dtLast.getUTCMinutes() !== 0 || dtLast.getUTCSeconds() !== 0) {
            hFin = dtLast.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            tsFin = dtLast.getTime();
          }
        }
      }

      const actTotalKm = actBaseKm + actDist;
      runningBaseKm += actDist;
      actInfoMap.set(actId, { baseKm: actBaseKm, totalKm: actTotalKm, horaInicio: hIni, horaFin: hFin, tsInicio: tsIni, tsFin: tsFin });

      if (hIni && !primerHoraGpx) primerHoraGpx = hIni;
      if (hFin) ultimaHoraGpx = hFin;
      if (tsIni > 0 && tsIni < minTimestamp) minTimestamp = tsIni;
      if (tsFin > 0 && tsFin > maxTimestamp) maxTimestamp = tsFin;

      (datos.gruposPIs || []).forEach((pi: any) => {
        if (pi.trackIdx !== undefined && pi.trackIdx >= 0 && pi.trackIdx < pts.length) {
          const pt = pts[pi.trackIdx];
          const dKm = actBaseKm + ((pt.distAcum || 0) / 1000);
          let hStr = '';
          let ts = 0;
          if (pt.time) {
            const dt = new Date(pt.time);
            ts = dt.getTime();
            if (dt.getUTCHours() !== 0 || dt.getUTCMinutes() !== 0 || dt.getUTCSeconds() !== 0) {
              hStr = dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            }
            if (ts < minTimestamp) minTimestamp = ts;
            if (ts > maxTimestamp) maxTimestamp = ts;
          }
          (pi.archivos || []).forEach((arch: any) => {
            if (arch?.id) {
              fotoGpxMap.set(arch.id, { distKm: dKm, horaStr: hStr, timestamp: ts });
            }
          });
        }
      });
    });

    // 3. Vincular fotos con coordenadas que no entraron en gruposPIs al punto del GPX más próximo
    this.paginas.forEach(p => {
      if (p.archivo?.id && !fotoGpxMap.has(p.archivo.id) && p.archivo.actividadId) {
        const datos = this.cacheDatosActividadGpx.get(p.archivo.actividadId);
        const actInfo = actInfoMap.get(p.archivo.actividadId);
        const baseKm = actInfo?.baseKm || 0;
        if (datos && datos.points && datos.points.length > 0) {
          const lat = p.coordenadas?.latitud || (p.archivo as any)?.latitud;
          const lng = p.coordenadas?.longitud || (p.archivo as any)?.longitud;
          if (lat && lng) {
            let bestIdx = -1;
            let bestDist = Infinity;
            for (let i = 0; i < datos.points.length; i++) {
              const d = this.getDistanceMetros(datos.points[i].lat, datos.points[i].lng, Number(lat), Number(lng));
              if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
              }
            }
            if (bestIdx >= 0 && bestDist < 1000) {
              const pt = datos.points[bestIdx];
              const dKm = baseKm + ((pt.distAcum || 0) / 1000);
              let hStr = '';
              let ts = 0;
              if (pt.time) {
                const dt = new Date(pt.time);
                ts = dt.getTime();
                if (dt.getUTCHours() !== 0 || dt.getUTCMinutes() !== 0 || dt.getUTCSeconds() !== 0) {
                  hStr = dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                }
              }
              fotoGpxMap.set(p.archivo.id, { distKm: dKm, horaStr: hStr, timestamp: ts });
            }
          }
        }
      }
    });

    // 3.5. CORRECCIÓN DEL KILOMETRAJE TOTAL DEL TRAYECTO:
    // Distribuir e interpolar los kilómetros del tramo final entre el último PI y la meta/fin del itinerario
    actIdsOrdenados.forEach(actId => {
      const datos = this.cacheDatosActividadGpx.get(actId);
      const actInfo = actInfoMap.get(actId);
      if (!datos || !actInfo) return;

      const pts: GpxPoint[] = datos.points || [];
      if (pts.length === 0) return;

      const lastPI = datos.gruposPIs && datos.gruposPIs.length > 0 ? datos.gruposPIs[datos.gruposPIs.length - 1] : null;
      const lastPiDistKm = lastPI && lastPI.trackIdx !== undefined
        ? actInfo.baseKm + ((pts[lastPI.trackIdx].distAcum || 0) / 1000)
        : actInfo.baseKm;

      const deltaFinKm = actInfo.totalKm - lastPiDistKm;

      // Buscar todas las páginas de esta actividad en this.paginas (excluyendo portadas/cartas manuscritas)
      const pagsActividad = this.paginas
        .map((p, idx) => ({ p, idx }))
        .filter(item => !item.p.esCartaManuscrita && (item.p.actividadId === actId || item.p.archivo?.actividadId === actId));

      if (pagsActividad.length === 0) return;

      if (deltaFinKm > 0.05) {
        const lastPiArchIds = new Set((lastPI?.archivos || []).map((a: any) => a.id));
        let tramoFinal = pagsActividad.filter(item =>
          (item.p.archivo?.id && lastPiArchIds.has(item.p.archivo.id)) ||
          (item.p.archivo?.id && (fotoGpxMap.get(item.p.archivo.id)?.distKm ?? 0) >= lastPiDistKm - 0.05) ||
          item.p.esMapaAnimado
        );

        if (tramoFinal.length === 0) {
          tramoFinal = [pagsActividad[pagsActividad.length - 1]];
        }

        if (tramoFinal.length > 1) {
          const count = tramoFinal.length;
          tramoFinal.forEach((item, k) => {
            const ratio = k / (count - 1);
            const distInter = lastPiDistKm + ratio * deltaFinKm;
            const distVal = parseFloat(distInter.toFixed(1));

            if (item.p.esMapaAnimado) {
              item.p.distanciaFinTramo = distVal;
              item.p.distanciaAcumuladaKm = distVal;
            } else if (item.p.archivo?.id) {
              const prev = fotoGpxMap.get(item.p.archivo.id);
              const hora = (ratio > 0.5 && actInfo.horaFin) ? actInfo.horaFin : (prev?.horaStr || '');
              fotoGpxMap.set(item.p.archivo.id, {
                distKm: distVal,
                horaStr: hora,
                timestamp: prev?.timestamp || (ratio > 0.5 ? actInfo.tsFin : 0)
              });
            }
          });
        } else {
          const item = tramoFinal[0];
          const distVal = parseFloat(actInfo.totalKm.toFixed(1));
          if (item.p.esMapaAnimado) {
            item.p.distanciaFinTramo = distVal;
            item.p.distanciaAcumuladaKm = distVal;
          } else if (item.p.archivo?.id) {
            const prev = fotoGpxMap.get(item.p.archivo.id);
            fotoGpxMap.set(item.p.archivo.id, {
              distKm: distVal,
              horaStr: actInfo.horaFin || prev?.horaStr || '',
              timestamp: actInfo.tsFin || prev?.timestamp || 0
            });
          }
        }
      }

      // Asegurar que la última página de la actividad culmine en la distancia total real
      const lastItem = pagsActividad[pagsActividad.length - 1];
      if (lastItem) {
        const distFin = parseFloat(actInfo.totalKm.toFixed(1));
        if (lastItem.p.esMapaAnimado) {
          lastItem.p.distanciaFinTramo = distFin;
          lastItem.p.distanciaAcumuladaKm = distFin;
        } else if (lastItem.p.archivo?.id) {
          const prev = fotoGpxMap.get(lastItem.p.archivo.id);
          fotoGpxMap.set(lastItem.p.archivo.id, {
            distKm: distFin,
            horaStr: actInfo.horaFin || prev?.horaStr || '',
            timestamp: actInfo.tsFin || prev?.timestamp || 0
          });
        }
      }
    });

    // 4. Revisar fotos para extraer horaCaptura y rango temporal
    let primerHoraFoto = '';
    let ultimaHoraFoto = '';
    this.paginas.forEach(p => {
      if (p.archivo?.horaCaptura && p.archivo.horaCaptura !== '00:00:00') {
        const hc = p.archivo.horaCaptura.substring(0, 5);
        if (!primerHoraFoto) primerHoraFoto = hc;
        ultimaHoraFoto = hc;
      }
      const ts = this.obtenerTimestampReal(p);
      if (ts && ts > 0) {
        if (ts < minTimestamp) minTimestamp = ts;
        if (ts > maxTimestamp) maxTimestamp = ts;
      }
    });

    // Establecer hora de inicio real (sin caer en 02:00 UTC)
    if (itHoraInicio) {
      this.itinerarioHoraInicio = itHoraInicio;
    } else if (primerHoraFoto) {
      this.itinerarioHoraInicio = primerHoraFoto;
    } else if (primerHoraGpx) {
      this.itinerarioHoraInicio = primerHoraGpx;
    } else {
      this.itinerarioHoraInicio = '09:00';
    }

    // Establecer hora de fin real
    if (itHoraFin) {
      this.itinerarioHoraFin = itHoraFin;
    } else if (ultimaHoraFoto) {
      this.itinerarioHoraFin = ultimaHoraFoto;
    } else if (ultimaHoraGpx) {
      this.itinerarioHoraFin = ultimaHoraGpx;
    } else {
      this.itinerarioHoraFin = '20:00';
    }

    // 5. Asignar distancias acumuladas a los mapas por tramos
    let runningTramoKm = 0.0;
    this.paginas.forEach(p => {
      if (p.esMapaGeneral) {
        // El mapa general muestra la visión panorámica del viaje completo desde el inicio
        p.distanciaInicioTramo = 0.0;
        p.distanciaFinTramo = parseFloat((p.distanciaTramoKm || totalKm).toFixed(1));
        p.distanciaAcumuladaKm = 0.0;
      } else if (p.esMapaAnimado) {
        const d = p.distanciaTramoKm || 0;
        p.distanciaInicioTramo = parseFloat(runningTramoKm.toFixed(1));
        runningTramoKm += d;
        p.distanciaFinTramo = parseFloat(runningTramoKm.toFixed(1));
        p.distanciaAcumuladaKm = p.distanciaFinTramo;
      }
    });

    // 6. PASO 1: Identificar puntos de anclaje fijos conocidos (Página 0, PIs del GPX, Mapas, Fin)
    const totalPags = this.paginas.length;
    interface AnclaTelemetria {
      index: number;
      distKm: number;
      ts: number;
      hora: string;
    }

    const anclas: AnclaTelemetria[] = [];
    anclas.push({ index: 0, distKm: 0.0, ts: minTimestamp < Infinity ? minTimestamp : 0, hora: this.itinerarioHoraInicio });

    for (let i = 1; i < totalPags - 1; i++) {
      const p = this.paginas[i];
      if (p.archivo?.id && fotoGpxMap.has(p.archivo.id)) {
        const info = fotoGpxMap.get(p.archivo.id)!;
        anclas.push({
          index: i,
          distKm: info.distKm,
          ts: info.timestamp || this.obtenerTimestampReal(p),
          hora: info.horaStr || (p.archivo?.horaCaptura ? p.archivo.horaCaptura.substring(0, 5) : '')
        });
      } else if (p.esMapaGeneral) {
        anclas.push({
          index: i,
          distKm: 0.0,
          ts: minTimestamp < Infinity ? minTimestamp : 0,
          hora: this.itinerarioHoraInicio
        });
      } else if (p.esMapaAnimado) {
        anclas.push({
          index: i,
          distKm: p.distanciaFinTramo ?? p.distanciaInicioTramo ?? 0,
          ts: this.obtenerTimestampReal(p),
          hora: p.horaFinTramo ? p.horaFinTramo.substring(0, 5) : (p.horaInicioTramo ? p.horaInicioTramo.substring(0, 5) : this.itinerarioHoraInicio)
        });
      }
    }

    anclas.push({
      index: totalPags - 1,
      distKm: totalKm > 0 ? totalKm : 29.8,
      ts: maxTimestamp > -Infinity ? maxTimestamp : 0,
      hora: this.itinerarioHoraFin
    });

    // Asegurar orden estrictamente monótono en las anclas
    for (let a = 1; a < anclas.length; a++) {
      if (anclas[a].distKm < anclas[a - 1].distKm) {
        anclas[a].distKm = anclas[a - 1].distKm;
      }
    }

    // 7. PASO 2: Asignar anclas e interpolar linealmente fotos intermedias por tramo
    for (let a = 0; a < anclas.length - 1; a++) {
      const anclaA = anclas[a];
      const anclaB = anclas[a + 1];

      // Asignar ancla A
      const pagA = this.paginas[anclaA.index];
      if (pagA.distanciaAcumuladaKm === undefined) {
        pagA.distanciaAcumuladaKm = parseFloat(anclaA.distKm.toFixed(1));
      }
      if (!pagA.horaFormateada) {
        pagA.horaFormateada = anclaA.hora || this.formatearHoraDePagina(pagA, this.itinerarioHoraInicio);
      }

      const countIntermedios = anclaB.index - anclaA.index;
      if (countIntermedios > 1) {
        let deltaDist = anclaB.distKm - anclaA.distKm;
        // Si no hay diferencia de km entre anclas pero aún no llegamos al final, distribuir suavemente
        if (deltaDist <= 0 && anclaB.index === totalPags - 1 && anclaB.distKm > anclaA.distKm) {
          deltaDist = anclaB.distKm - anclaA.distKm;
        }

        const deltaTs = (anclaB.ts > anclaA.ts && anclaA.ts > 0) ? (anclaB.ts - anclaA.ts) : 0;

        for (let j = anclaA.index + 1; j < anclaB.index; j++) {
          const p = this.paginas[j];
          const pTs = this.obtenerTimestampReal(p);

          let ratio = (j - anclaA.index) / countIntermedios;
          if (deltaTs > 0 && pTs >= anclaA.ts && pTs <= anclaB.ts) {
            ratio = (pTs - anclaA.ts) / deltaTs;
          }

          const distInter = anclaA.distKm + ratio * Math.max(0, deltaDist);
          p.distanciaAcumuladaKm = parseFloat(distInter.toFixed(1));

          // Determinación precisa de la hora de cada foto:
          if (p.archivo?.horaCaptura && p.archivo.horaCaptura !== '00:00:00') {
            p.horaFormateada = p.archivo.horaCaptura.substring(0, 5);
          } else if (pTs > 0) {
            const dt = new Date(pTs);
            if (dt.getUTCHours() !== 0 || dt.getUTCMinutes() !== 0 || dt.getUTCSeconds() !== 0) {
              p.horaFormateada = dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            }
          }

          if (!p.horaFormateada) {
            p.horaFormateada = this.interpolarHora(
              anclaA.hora || this.itinerarioHoraInicio,
              anclaB.hora || this.itinerarioHoraFin,
              ratio
            );
          }
        }
      }
    }

    // Asignar última ancla
    const ultimaAncla = anclas[anclas.length - 1];
    const pagFin = this.paginas[ultimaAncla.index];
    pagFin.distanciaAcumuladaKm = parseFloat(ultimaAncla.distKm.toFixed(1));
    pagFin.horaFormateada = ultimaAncla.hora || this.itinerarioHoraFin;

    // Garantizar que la página 0 (Portada/Carta) siempre tenga 0.0 km y hora de salida real
    if (this.paginas[0]) {
      this.paginas[0].distanciaAcumuladaKm = 0.0;
      this.paginas[0].horaFormateada = this.itinerarioHoraInicio;
    }

    console.log(`📏⏱️ [Telemetría Álbum] Interpolada para ${totalPags} páginas en ${anclas.length} anclas: 0.0 km ➔ ${totalKm} km (${this.itinerarioHoraInicio} - ${this.itinerarioHoraFin})`);
  }

  spreads: SpreadLibro[] = [];

  construirSpreads(): void {
    if (!this.paginas || this.paginas.length === 0) {
      this.spreads = [];
      return;
    }

    const nuevosSpreads: SpreadLibro[] = [];

    // Spread 0: Siempre la carta introductoria (paginas[0])
    nuevosSpreads.push({
      tipo: 'intro',
      indices: [0],
      paginaIzquierda: null,
      paginaDerecha: this.paginas[0] || null
    });

    let i = 1;
    while (i < this.paginas.length) {
      const pag = this.paginas[i];

      if (pag.esMapaAnimado) {
        // REGLA 1: MODO ITINERARIO (MAPAS ANIMADOS)
        // Bloque único de pantalla completa que CUBRE AMBAS PÁGINAS (Izquierda y Derecha como un solo lienzo).
        // Durante un itinerario, NO se renderiza ninguna foto complementaria al lado.
        // Al pasar de página, avanza limpiamente al siguiente elemento disponible (+1).
        nuevosSpreads.push({
          tipo: 'mapa',
          indices: [i],
          paginaIzquierda: null,
          paginaDerecha: null,
          paginaMapa: pag
        });
        i++;
      } else {
        // REGLA 2: MODO FOTO (FOTOS Y VÍDEOS)
        // Maquetación de doble página estándar: Elemento N a la izquierda, Elemento N+1 a la derecha.
        const pagIzq = pag;
        let pagDer: PaginaMedia | null = null;
        const indices = [i];

        if (i + 1 < this.paginas.length && !this.paginas[i + 1].esMapaAnimado) {
          pagDer = this.paginas[i + 1];
          indices.push(i + 1);
          i += 2; // Avanza estrictamente de dos en dos (+2)
        } else {
          // Si el siguiente elemento es un mapa animado o el fin del array, este pliego muestra solo esta foto
          i += 1;
        }

        nuevosSpreads.push({
          tipo: 'fotos',
          indices,
          paginaIzquierda: pagIzq,
          paginaDerecha: pagDer
        });
      }
    }

    this.spreads = nuevosSpreads;
    console.log(`📚 [Spreads Dinámicos] Generados ${this.spreads.length} pliegos para ${this.paginas.length} páginas`);
  }

  get totalSpreads(): number {
    return this.spreads.length > 0 ? this.spreads.length : 1;
  }

  get spreadActualData(): SpreadLibro | null {
    if (this.spreads.length === 0 && this.paginas && this.paginas.length > 0) {
      this.construirSpreads();
    }
    if (this.spreadActual >= 0 && this.spreadActual < this.spreads.length) {
      return this.spreads[this.spreadActual];
    }
    return null;
  }

  get paginaSpreadIzquierda(): PaginaMedia | null {
    return this.spreadActualData?.paginaIzquierda || null;
  }

  get paginaSpreadDerecha(): PaginaMedia | null {
    if (this.spreadActualData?.tipo === 'intro') {
      return this.paginas[0] || null;
    }
    return this.spreadActualData?.paginaDerecha || null;
  }

  get paginaMostradaIzquierda(): PaginaMedia | null {
    if (this.hojaVolteando3D && this.paginaDebajoIzquierda) {
      return this.paginaDebajoIzquierda;
    }
    return this.paginaSpreadIzquierda;
  }

  get paginaMostradaDerecha(): PaginaMedia | null {
    if (this.hojaVolteando3D && this.paginaDebajoDerecha) {
      return this.paginaDebajoDerecha;
    }
    return this.paginaSpreadDerecha;
  }

  estaMiniaturaActiva(index: number): boolean {
    const spread = this.spreadActualData;
    if (!spread) return index === this.paginaActual;
    return spread.indices.includes(index);
  }

  toggleModoVintage(): void {
    this.modoAlbumVintage = !this.modoAlbumVintage;
    localStorage.setItem('album_modo_vintage', String(this.modoAlbumVintage));
    console.log('📖 Modo Álbum Vintage:', this.modoAlbumVintage);
    this.cdr.detectChanges();
  }

  toggleModoRutaImagen(valorEspecifico?: boolean | Event, event?: Event): void {
    if (event) {
      event.stopPropagation();
    } else if (valorEspecifico instanceof Event) {
      valorEspecifico.stopPropagation();
    }

    if (typeof valorEspecifico === 'boolean') {
      this.modoRutaImagen = valorEspecifico;
    } else {
      this.modoRutaImagen = !this.modoRutaImagen;
    }

    localStorage.setItem('album_modo_ruta_imagen', String(this.modoRutaImagen));
    console.log('🗺️ Modo Ruta en Imagen:', this.modoRutaImagen);
    this.cdr.detectChanges();
  }

  toggleReproducirFullscreen(): void {
    this.reproducirEnFullscreen = !this.reproducirEnFullscreen;
    localStorage.setItem('album_reproducir_fullscreen', String(this.reproducirEnFullscreen));
    console.log('🖥️ Reproducir en Fullscreen:', this.reproducirEnFullscreen);
    this.cdr.detectChanges();
  }

  toggleModoAlbumVintage(event?: Event): void {
    event?.stopPropagation();
    this.modoAlbumVintage = !this.modoAlbumVintage;
    localStorage.setItem('album_modo_vintage', String(this.modoAlbumVintage));
    console.log('📖 Modo Álbum Vintage 3D:', this.modoAlbumVintage ? 'ACTIVADO' : 'DESACTIVADO');
    this.cdr.detectChanges();
  }

  toggleTipoIntro(tipo?: 'video-mp4' | '3d-interactiva', event?: Event): void {
    event?.stopPropagation();
    if (tipo) {
      this.tipoIntro = tipo;
    } else {
      this.tipoIntro = this.tipoIntro === 'video-mp4' ? '3d-interactiva' : 'video-mp4';
    }
    localStorage.setItem('album_tipo_intro', this.tipoIntro);
    console.log('🎬 Tipo de Intro seleccionado:', this.tipoIntro);
    this.cdr.detectChanges();
  }

  toggleReproducirEnFullscreen(event?: Event): void {
    event?.stopPropagation();
    this.reproducirEnFullscreen = !this.reproducirEnFullscreen;
    localStorage.setItem('album_reproducir_fullscreen', String(this.reproducirEnFullscreen));
    console.log('🖥️ Reproducción en Pantalla Completa:', this.reproducirEnFullscreen ? 'ACTIVADA' : 'DESACTIVADA (Pantalla Reducida)');
    this.cdr.detectChanges();
  }

  // ==========================================
  // CONFIGURACIÓN DE MAPAS ANIMADOS Y VÍDEOS
  // ==========================================
  incluirAnimacionesMapa: boolean = false;
  distanciaMinimaAnimacionKm: number = 2.0;
  distanciaMinimaMetros: number = 2000;
  modoDistanciaPersonalizada: boolean = false;
  reproducirVideosCompletos: boolean = false;
  limpiandoVideosAnimacion: boolean = false;
  paginasBase: PaginaMedia[] = [];

  toggleVideosCompletos(event?: Event): void {
    event?.stopPropagation();
    this.reproducirVideosCompletos = !this.reproducirVideosCompletos;
    console.log('🎬 Reproducción de vídeos completos:', this.reproducirVideosCompletos ? 'ACTIVADO (Duración completa)' : 'DESACTIVADO (Placeholder estándar)');
    this.iniciarSecuenciaVideosSpread();
    this.cdr.detectChanges();
  }

  onCambioSelectDistancia(val: any): void {
    if (val === 'custom' || val === 'personalizado') {
      this.modoDistanciaPersonalizada = true;
    } else {
      this.modoDistanciaPersonalizada = false;
      const numKm = Number(val);
      this.distanciaMinimaAnimacionKm = numKm;
      this.distanciaMinimaMetros = Math.round(numKm * 1000);
      // Activar modo animado automáticamente al escoger distancia
      this.modoRutaImagen = false;
      localStorage.setItem('album_modo_ruta_imagen', 'false');
      this.actualizarConfiguracionAnimaciones();
    }
  }

  onCambioDistanciaMetrosInput(): void {
    if (this.distanciaMinimaMetros !== null && this.distanciaMinimaMetros !== undefined && this.distanciaMinimaMetros >= 0) {
      this.distanciaMinimaAnimacionKm = this.distanciaMinimaMetros / 1000;
      // Activar modo animado automáticamente al configurar distancia personalizada
      this.modoRutaImagen = false;
      localStorage.setItem('album_modo_ruta_imagen', 'false');
      this.actualizarConfiguracionAnimaciones();
    }
  }

  // Extensiones de archivo por tipo
  private readonly EXTENSIONES_IMAGEN = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.tiff'];
  private readonly EXTENSIONES_VIDEO = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v'];
  private readonly EXTENSIONES_AUDIO = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.wma'];
  private readonly EXTENSIONES_PDF = ['.pdf'];
  private readonly EXTENSIONES_DOCUMENTO = ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf'];

  siguienteVideoUrl?: string;

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
    public routeVideoGeneratorService: RouteVideoGeneratorService,
    public introVideoGeneratorService: IntroVideoGeneratorService,
    private gpxAnimationService: GpxAnimationService,
    private trackEditorService: TrackEditorService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) { }

  precargarSiguienteVideo(): void {
    const nextPag = this.paginas[this.paginaActual + 1];
    if (nextPag && nextPag.tipoMedia === 'video' && nextPag.url) {
      this.siguienteVideoUrl = nextPag.url;
    } else {
      this.siguienteVideoUrl = undefined;
    }
  }


  // ==========================================
  // MÉTODOS DEL CICLO DE VIDA DEL COMPONENTE
  // ==========================================

  async ngOnInit(): Promise<void> {
    console.log('🔄 ngOnInit() ejecutado');
    const introGuardada = localStorage.getItem('album_tipo_intro');
    if (introGuardada === '3d-interactiva' || introGuardada === 'video-mp4') {
      this.tipoIntro = introGuardada;
    }
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

  private getAudioUrlParaItinerario(itinerarioId?: number): string | null {
    if (itinerarioId && this.listaItinerarios && this.listaItinerarios.length > 0) {
      const itin = this.listaItinerarios.find(it => it.id === itinerarioId);
      if (itin?.audio) {
        if (itin.audio.startsWith('http')) return itin.audio;
        const nombreArchivo = itin.audio.split(/[\\/]/).pop();
        return `${environment.apiUrl}/uploads/${nombreArchivo}`;
      }
    }

    if (this.infoViaje?.audio) {
      if (this.infoViaje.audio.startsWith('http')) return this.infoViaje.audio;
      const nombreArchivo = this.infoViaje.audio.split(/[\\/]/).pop();
      return `${environment.apiUrl}/uploads/${nombreArchivo}`;
    }

    return null;
  }

  private inicializarAudioViaje(): void {
    const pag = this.paginas[this.paginaActual];
    const itinId = pag?.itinerarioId || pag?.archivo?.itinerarioId || this.contextoViaje?.itinerarioId;
    const audioUrl = this.getAudioUrlParaItinerario(itinId);

    if (!audioUrl) {
      console.log('ℹ️ No hay audio asociado al itinerario ni al viaje');
      this.audioDisponible = false;
      return;
    }

    try {
      this.audioUrlActual = audioUrl;
      this.itinerarioActualAudioId = itinId || null;

      this.audioViaje = new Audio(audioUrl);
      this.audioViaje.loop = true;
      this.volumenOriginal = this.audioViaje.volume || 0.72;

      this.audioViaje.addEventListener('play', () => {
        console.log('▶️ Audio reproduciendo');
        this.audioReproduciendo = true;
        this.cdr.detectChanges();
      });

      this.audioViaje.addEventListener('pause', () => {
        console.log('⏸️ Audio pausado');
        this.audioReproduciendo = false;
        this.cdr.detectChanges();
      });

      this.audioViaje.addEventListener('error', (e) => {
        console.error('❌ Error al cargar audio:', e);
        this.audioDisponible = false;
        this.cdr.detectChanges();
      });

      this.audioViaje.addEventListener('loadedmetadata', () => {
        console.log('✅ Audio cargado correctamente');
        this.audioDisponible = true;
        this.cdr.detectChanges();
      });

    } catch (error) {
      console.error('❌ Error al inicializar audio:', error);
      this.audioDisponible = false;
    }
  }

  verificarSincronizacionAudioItinerario(): void {
    const pag = this.paginas[this.paginaActual];
    const itinId = pag?.itinerarioId || pag?.archivo?.itinerarioId || this.contextoViaje?.itinerarioId;
    const targetUrl = this.getAudioUrlParaItinerario(itinId);

    if (targetUrl === this.audioUrlActual) {
      return; // Misma pista musical, continúa en bucle sin interrupción
    }

    console.log(`🎵 [Audio] Cambio de pista de itinerario detectado (Itin #${itinId}): ${this.audioUrlActual} ➔ ${targetUrl}`);

    const oldAudio = this.audioViaje;
    const eraReproduciendo = this.audioReproduciendo || this.reproduciendoSlideshow;
    this.audioUrlActual = targetUrl;
    this.itinerarioActualAudioId = itinId || null;

    if (targetUrl) {
      const newAudio = new Audio(targetUrl);
      newAudio.loop = true;
      newAudio.volume = eraReproduciendo ? 0 : (this.volumenOriginal || 0.72);

      newAudio.addEventListener('play', () => {
        this.audioReproduciendo = true;
        this.cdr.detectChanges();
      });
      newAudio.addEventListener('pause', () => {
        this.audioReproduciendo = false;
        this.cdr.detectChanges();
      });
      newAudio.addEventListener('loadedmetadata', () => {
        this.audioDisponible = true;
        this.cdr.detectChanges();
      });

      this.audioViaje = newAudio;
      this.audioDisponible = true;

      if (eraReproduciendo) {
        this.ejecutarCrossfade(oldAudio, newAudio);
      } else {
        if (oldAudio) {
          oldAudio.pause();
          oldAudio.src = '';
        }
      }
    } else {
      if (oldAudio && eraReproduciendo) {
        this.ejecutarCrossfade(oldAudio, null);
      } else if (oldAudio) {
        oldAudio.pause();
        oldAudio.src = '';
        this.audioViaje = null;
        this.audioDisponible = false;
      }
    }
  }

  private ejecutarCrossfade(audioSaliente: HTMLAudioElement | null, audioEntrante: HTMLAudioElement | null): void {
    if (this.audioCrossfadeInterval) {
      clearInterval(this.audioCrossfadeInterval);
      this.audioCrossfadeInterval = null;
    }

    const targetVolume = this.volumenOriginal || 0.72;
    const duracionMs = 2000; // 2 segundos de fundido cruzado (crossfade)
    const intervaloMs = 50;
    const pasos = Math.max(1, Math.round(duracionMs / intervaloMs));
    const deltaVolumen = targetVolume / pasos;

    if (audioEntrante) {
      audioEntrante.volume = 0;
      audioEntrante.play().catch(err => {
        console.warn('⚠️ [Audio] Autoplay prevenido al iniciar crossfade:', err);
      });
    }

    let pasoActual = 0;
    this.audioCrossfadeInterval = setInterval(() => {
      pasoActual++;

      // Fade out de la pista saliente
      if (audioSaliente && !audioSaliente.paused) {
        audioSaliente.volume = Math.max(0, audioSaliente.volume - deltaVolumen);
      }

      // Fade in de la pista entrante
      if (audioEntrante && !audioEntrante.paused) {
        audioEntrante.volume = Math.min(targetVolume, audioEntrante.volume + deltaVolumen);
      }

      if (pasoActual >= pasos) {
        clearInterval(this.audioCrossfadeInterval);
        this.audioCrossfadeInterval = null;

        if (audioSaliente) {
          audioSaliente.pause();
          audioSaliente.src = '';
        }
        if (audioEntrante) {
          audioEntrante.volume = targetVolume;
        }
      }
    }, intervaloMs);
  }

  musicaActivada = true;

  toggleAudioViaje(event?: Event): void {
    event?.stopPropagation();
    this.musicaActivada = !this.musicaActivada;
    console.log('🎵 Preferencia de música:', this.musicaActivada ? 'Activada' : 'Desactivada');

    const estaReproduciendo = this.modoRecuerdoActivo || this.reproduciendoSlideshow;

    if (estaReproduciendo) {
      if (this.musicaActivada) {
        if (!this.audioViaje) {
          this.inicializarAudioViaje();
        }
        this.intentarReproducirAudioViaje();
      } else {
        if (this.audioViaje) {
          this.audioViaje.pause();
        }
        this.audioReproduciendo = false;
      }
    } else {
      // En modo estático (sin reproducir), no reproducimos sonido inmediatamente
      if (!this.musicaActivada && this.audioViaje) {
        this.audioViaje.pause();
        this.audioReproduciendo = false;
      }
    }
    this.cdr.detectChanges();
  }

  private intentarReproducirAudioViaje(): void {
    if (!this.musicaActivada) {
      if (this.audioViaje) this.audioViaje.pause();
      this.audioReproduciendo = false;
      return;
    }

    if (!this.audioViaje) {
      this.inicializarAudioViaje();
      if (!this.audioViaje) return;
    }

    this.audioAutoplayBloqueado = false;
    this.audioViaje.volume = this.volumenOriginal || 0.72;

    this.audioViaje.play().catch(error => {
      console.warn('El navegador bloqueo el inicio automatico del audio:', error);
      this.audioAutoplayBloqueado = true;
      this.audioReproduciendo = false;
      this.cdr.detectChanges();
    });
  }

  private limpiarAudioViaje(): void {
    if (this.audioCrossfadeInterval) {
      clearInterval(this.audioCrossfadeInterval);
      this.audioCrossfadeInterval = null;
    }
    if (this.audioViaje) {
      this.audioViaje.pause();
      this.audioViaje.src = '';
      this.audioViaje = null;
    }
    this.audioReproduciendo = false;
    this.audioDisponible = false;
    this.audioUrlActual = null;
    this.itinerarioActualAudioId = null;
  }

  bajarVolumenAudioViaje(forzar: boolean = false): void {
    if (!forzar && this.videoMuted) return; // Si los vídeos están silenciados, mantener volumen normal de la música
    if (this.audioViaje && this.audioDisponible) {
      this.audioViaje.volume = 0.08; // Atenuación suave para escuchar el vídeo con total claridad
      console.log('🔉 Música atenuada (audio ducking activo para vídeo/audio)');
    }
  }

  restaurarVolumenAudioViaje(): void {
    if (this.audioViaje && this.audioDisponible) {
      this.audioViaje.volume = this.volumenOriginal || 0.72;
      console.log('🔊 Música ambiental restaurada al volumen original');
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

  @HostListener('document:keydown.arrowright', ['$event'])
  handleArrowRight(event: Event): void {
    if (this.estado === 'abierto') {
      if (this.mostrarFullscreen && this.fullscreenSinglePageMode) {
        if (this.hayPaginaSiguiente) {
          event.preventDefault();
          this.navegarSinglePage(1);
        }
        return;
      }
      if (this.hayPaginaSiguiente) {
        event.preventDefault();
        this.cambiarPagina(1);
      }
    }
  }

  @HostListener('document:keydown.arrowleft', ['$event'])
  handleArrowLeft(event: Event): void {
    if (this.estado === 'abierto') {
      if (this.mostrarFullscreen && this.fullscreenSinglePageMode) {
        if (this.hayPaginaAnterior) {
          event.preventDefault();
          this.navegarSinglePage(-1);
        }
        return;
      }
      if (this.hayPaginaAnterior) {
        event.preventDefault();
        this.cambiarPagina(-1);
      }
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
   * Alterna la fijación (pin) de la información detallada al hacer clic
   */
  toggleInfoDetalle(): void {
    this.infoDetalleFijado = !this.infoDetalleFijado;
    this.mostrarInfoDetalle = this.infoDetalleFijado;
    this.cancelarOcultarInfo();

    if (this.infoDetalleEsModal) {
      if (this.mostrarInfoDetalle) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
      }
    }
    this.cdr.detectChanges();
  }

  /**
   * Maneja el paso del cursor (hover) sobre el botón de información
   */
  onHoverInfoTrigger(hovering: boolean): void {
    if (this.infoDetalleFijado) return; // Si está fijado por click, no alterar estado

    if (hovering) {
      this.cancelarOcultarInfo();
      this.mostrarInfoDetalle = true;
    } else {
      this.ocultarInfoDetalle();
    }
    this.cdr.detectChanges();
  }

  /**
   * Cierra y desancla la información detallada
   */
  cerrarInfoDetalle(): void {
    this.infoDetalleFijado = false;
    this.mostrarInfoDetalle = false;
    this.cancelarOcultarInfo();

    if (this.infoDetalleEsModal) {
      document.body.style.overflow = '';
    }
    this.cdr.detectChanges();
  }

  /**
   * Oculta la información con delay para permitir hover fluido si no está anclada
   */
  ocultarInfoDetalle(): void {
    if (this.infoDetalleFijado) return; // No ocultar si está anclado por clic
    if (!this.infoDetalleEsModal) {
      this.cancelarOcultarInfo();
      this.timeoutOcultarInfo = setTimeout(() => {
        if (!this.infoDetalleFijado) {
          this.mostrarInfoDetalle = false;
          this.cdr.detectChanges();
        }
      }, 400);
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
        id: viajeId,
        nombre: viaje.nombre || `Viaje #${viajeId}`,
        destino: viaje.destino || '',
        descripcion: viaje.descripcion || '',
        fechaInicio: viaje.fecha_inicio || viaje.fechaInicio || '',
        fechaFin: viaje.fecha_fin || viaje.fechaFin || '',
        imagen: viaje.imagen || '',
        audio: viaje.audio || '' // 👈 AÑADIR ESTA LÍNEA
      };
      console.log('📋 InfoViaje establecida:', this.infoViaje);

    } catch (error) {
      console.error('❌ Error al cargar información del viaje:', error);
      this.infoViaje = {
        id: viajeId,
        nombre: `Viaje #${viajeId}`,
        destino: '',
        descripcion: '',
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
    this.cachePaginasPorFiltro.clear();
    this.cacheDatosActividadGpx.clear();

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

      // 🎬 Disparar intro cinemática Dynamics si corresponde y estamos en la portada
      // 🛡️ REGLA: Al entrar desde el menú, la portada interactiva se muestra directamente sin animación.
      // La cinemática 3D se dispara única y exclusivamente cuando el usuario pulsa "Generar Recorrido".
      this.mostrarIntroDynamics = false;
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

    // 🎬 COMPROBACIÓN DE ARCHIVOS MULTIMEDIA SELECCIONADOS PARA VÍDEO Y RECORRIDO (FOTOS, VÍDEOS Y AUDIOS)
    const multimediaCandidatos = archivos.filter(a => this.esArchivoMultimedia(a));
    this.totalArchivosAlbum = multimediaCandidatos.length;
    this.totalFotosAlbum = multimediaCandidatos.length;
    this.totalArchivosSeleccionados = multimediaCandidatos.filter(a =>
      Number(a.seleccionado_video) === 1 || (a as any).seleccionado_video === true
    ).length;
    this.totalFotosSeleccionadas = this.totalArchivosSeleccionados;
    this.haySeleccionVideoPersonalizada = this.totalArchivosSeleccionados > 0;

    console.log(`🎬 [Álbum Libro] Selección multimedia: ${this.totalArchivosSeleccionados} de ${this.totalArchivosAlbum} marcados. Filtro personalizado activo = ${this.haySeleccionVideoPersonalizada}`);

    // Filtrar archivos que NO deben generar páginas independientes:
    // 1. Archivos auxiliares del sistema: mapas de ubicación estáticos, gpx, metadata
    // 2. Audios asociados a fotos padre (que ya se reproducen desde el botón de la foto)
    const fotosNombresBase = new Set<string>();
    archivos.forEach(a => {
      const tipo = (a.tipo || '').toLowerCase();
      if ((tipo === 'foto' || tipo === 'imagen') && a.nombreArchivo) {
        const dotIdx = a.nombreArchivo.lastIndexOf('.');
        const base = dotIdx !== -1 ? a.nombreArchivo.substring(0, dotIdx) : a.nombreArchivo;
        fotosNombresBase.add(base.toLowerCase());
      }
    });

    const archivosFiltrados = archivos.filter(archivo => {
      const tipo = (archivo.tipo || '').toLowerCase();
      if (tipo === 'mapa_ubicacion' || tipo === 'mapa' || tipo === 'gpx' || tipo === 'manifest' || tipo === 'estadisticas') {
        return false;
      }
      if ((archivo as any).archivoPrincipalId) {
        return false;
      }
      if (archivo.nombreArchivo && (
        archivo.nombreArchivo.toLowerCase().includes('_mapa.') ||
        archivo.nombreArchivo.toLowerCase().includes('_location_map.') ||
        archivo.nombreArchivo.toLowerCase().endsWith('_mapa.png')
      )) {
        return false;
      }
      // Si es audio, verificar si está asociado a una foto con el mismo nombre base en la actividad
      if (tipo === 'audio' && archivo.nombreArchivo) {
        const dotIdx = archivo.nombreArchivo.lastIndexOf('.');
        const base = dotIdx !== -1 ? archivo.nombreArchivo.substring(0, dotIdx) : archivo.nombreArchivo;
        if (fotosNombresBase.has(base.toLowerCase())) {
          console.log(`ℹ️ [Álbum Libro] Omitiendo audio asociado ${archivo.nombreArchivo} como página independiente (vinculado a foto)`);
          return false;
        }
      }

      // 🎬 REGLA: Si el usuario seleccionó archivos multimedia específicos (fotos, vídeos o audios) con tick para el vídeo/recorrido,
      // incluir ÚNICAMENTE los archivos seleccionados en el recorrido y vídeo final.
      // Si no ha seleccionado ninguno (0 seleccionados en total), se muestran todos los archivos multimedia (fallback intacto).
      if (this.haySeleccionVideoPersonalizada && this.esArchivoMultimedia(archivo)) {
        const estaSel = Number(archivo.seleccionado_video) === 1 || (archivo as any).seleccionado_video === true;
        if (!estaSel) {
          return false;
        }
      }

      return true;
    });

    // Procesar archivos normales (fotos, vídeos y audios sueltos independientes)
    const paginasNormales: PaginaMedia[] = archivosFiltrados.map(archivo => {
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

      // Sanitización de fecha si falta o es inválida y el nombre contiene timestamp epoch (ej. recording-1789463199479...)
      let fechaSaneada = archivo.fechaCreacion || '';
      if (!fechaSaneada || fechaSaneada.startsWith('1970') || fechaSaneada.startsWith('1792')) {
        const matchTsNombre = archivo.nombreArchivo?.match(/(\d{13})/);
        if (matchTsNombre) {
          const epochMs = Number(matchTsNombre[1]);
          if (epochMs > 1577836800000 && epochMs < 2051222400000) {
            fechaSaneada = new Date(epochMs).toISOString();
            archivo.fechaCreacion = fechaSaneada;
          }
        }
      }

      let tituloItem = archivo.descripcion || archivo.nombreArchivo || 'Sin título';
      if (tipoMedia === 'audio' && (!archivo.descripcion || archivo.descripcion.trim() === '')) {
        const hora = archivo.horaCaptura && archivo.horaCaptura !== '00:00:00' && archivo.horaCaptura.toLowerCase() !== 'desconocido' ? ` (${archivo.horaCaptura.substring(0, 5)})` : '';
        tituloItem = `Nota de voz${hora}`;
      }

      return {
        archivo,
        url,
        titulo: tituloItem,
        descripcion: archivo.descripcion || '',
        fecha: fechaSaneada,
        fechaOriginal: fechaSaneada,
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
      // Ordenar fotos por fecha y hora reales (más antiguas primero)
      paginasNormales.sort((a, b) => this.obtenerTimestampReal(a) - this.obtenerTimestampReal(b));
      const nombreItin = (this.infoViaje?.nombre || 'ESPAÑA').toUpperCase();
      const tituloItin = nombreItin.startsWith('ITINERARIO') ? nombreItin : `ITINERARIO: ${nombreItin}`;
      const descItin = this.infoViaje?.descripcion || 'Diario de viaje, memorias y recorrido detallado del itinerario.';
      const paginaDescripcion: PaginaMedia = {
        archivo: {} as Archivo,
        url: '',
        titulo: tituloItin,
        descripcion: descItin,
        fecha: this.infoViaje?.fechaInicio || '',
        tipoMedia: 'carta-manuscrita',
        mimeType: '',
        esCartaManuscrita: true
      };
      paginasFinales = [paginaDescripcion, ...paginasNormales];
    } else if (!this.contextoViaje?.itinerarioId && !this.contextoViaje?.actividadId) {
      // NIVEL VIAJE: Agrupar fotos por itinerario e intercalar descripciones
      paginasFinales = await this.crearPaginasConDescripcionesItinerarios(paginasNormales);

    } else {
      // NIVEL ACTIVIDAD: Carta manuscrita inicial y fotos ordenadas
      paginasNormales.sort((a, b) => this.obtenerTimestampReal(a) - this.obtenerTimestampReal(b));

      const nombreAct = (this.infoViaje?.nombre || 'ESPAÑA').toUpperCase();
      const tituloAct = nombreAct.startsWith('ITINERARIO') ? nombreAct : `ITINERARIO: ${nombreAct}`;
      const paginaIntroAct: PaginaMedia = {
        archivo: {} as Archivo,
        url: '',
        titulo: tituloAct,
        descripcion: this.infoViaje?.descripcion || 'Diario de viaje, memorias y recorrido detallado.',
        fecha: this.infoViaje?.fechaInicio || '',
        tipoMedia: 'carta-manuscrita',
        mimeType: '',
        esCartaManuscrita: true
      };

      paginasFinales = [paginaIntroAct, ...paginasNormales];
    }

    // Guardar paginas base y generar mapas animados según configuración
    this.paginasBase = paginasFinales;
    this.paginas = await this.generarPaginasConAnimaciones(this.paginasBase);
    this.imagenViajeUrlCache = null; // Invalidar cache para re-evaluar con las paginas cargadas
    this.calcularTelemetriaItinerario();
    this.construirSpreads();

    console.log('📖 Páginas multimedia creadas:', this.paginas.length);
    console.log('📊 Tipos de archivos:', this.obtenerEstadisticasTipos());

    // Cargar la descripción del itinerario DESPUÉS de asignar esta.paginas
    if (this.contextoViaje?.itinerarioId && !this.contextoViaje?.actividadId) {
      await this.cargarDescripcionItinerario();
    }

    // Precargar contenido inicial (ventana deslizante) y ubicaciones en segundo plano sin bloquear
    this.precargarContenidoVentana(0);
    this.precargarUbicaciones().catch(err => console.warn('Precarga de ubicaciones en segundo plano:', err));

    // Si el usuario intentó abrir el libro durante la carga, abrirlo automáticamente
    if (this.pendienteAbrirLibro) {
      const { activarModoRecuerdo, modoGuiado } = this.pendienteAbrirLibro;
      this.pendienteAbrirLibro = null;
      setTimeout(() => this.abrirLibro(activarModoRecuerdo, modoGuiado), 60);
    }
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
    this.cachePaginasPorFiltro.clear();
    this.isLoading = true;
    try {
      this.paginas = await this.generarPaginasConAnimaciones(this.paginasBase);
      this.calcularTelemetriaItinerario();
      this.construirSpreads();
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

  /**
   * Limpia los vídeos MP4 generados para las animaciones de ruta del itinerario actual
   * tanto del servidor como de la memoria local, forzando su regeneración desde cero con el nuevo algoritmo.
   */
  async confirmarLimpiarVideosAnimacion(): Promise<void> {
    const itinerarioId = this.contextoViaje?.itinerarioId || (this.paginas?.[0]?.itinerarioId);
    const viajeId = this.contextoViaje?.viajeId;

    if (!itinerarioId && !viajeId) {
      alert('No se pudo identificar el itinerario o viaje para limpiar los vídeos.');
      return;
    }

    const confirmar = window.confirm(
      '¿Deseas eliminar las animaciones en vídeo MP4 de este itinerario?\n\n' +
      '• Se borrarán del servidor los archivos ya grabados para este itinerario.\n' +
      '• Se reiniciará la caché en memoria.\n' +
      '• El sistema volverá a generar los vídeos limpios desde cero según la configuración y el nuevo algoritmo.'
    );

    if (!confirmar) return;

    this.limpiandoVideosAnimacion = true;
    this.cdr.detectChanges();

    try {
      if (itinerarioId) {
        const resp = await firstValueFrom(this.actividadesItinerariosService.eliminarVideosSubtramosItinerario(itinerarioId));
        console.log('🧹 [Limpieza Vídeos] Respuesta backend:', resp);
      } else if (viajeId) {
        const resp = await firstValueFrom(this.actividadesItinerariosService.eliminarVideosSubtramosViaje(viajeId));
        console.log('🧹 [Limpieza Vídeos] Respuesta backend viaje:', resp);
      }

      // 1. Limpiar caches en memoria
      this.cachePaginasPorFiltro.clear();
      this.cacheDatosActividadGpx.clear();
      this.colaPrecachingSubtramos = [];

      // 2. Limpiar referencias a vídeos en paginasBase y paginas
      const limpiarUrlsVideo = (lista: PaginaMedia[]) => {
        if (!lista) return;
        for (const p of lista) {
          if (p.urlVideoAnimacion) {
            delete p.urlVideoAnimacion;
            if (p.tipoMedia === 'video' && p.trackGpx) {
              p.url = '';
              p.tipoMedia = 'mapa-animado';
            }
          }
        }
      };

      limpiarUrlsVideo(this.paginasBase);
      limpiarUrlsVideo(this.paginas);

      // 3. Forzar mapa activo y reconstruir páginas
      this.forzarMapaInteractivo = true;
      await this.actualizarConfiguracionAnimaciones();

      console.log('✅ ¡Vídeos de animación de ruta eliminados y páginas reiniciadas!');
    } catch (err: any) {
      console.error('❌ Error al eliminar vídeos de animaciones:', err);
      alert('Ocurrió un error al limpiar los vídeos: ' + (err?.message || 'Error desconocido'));
    } finally {
      this.limpiandoVideosAnimacion = false;
      this.cdr.detectChanges();
    }
  }

  /**
   * Genera en lote todas las animaciones de subtramos del itinerario en vídeos MP4 pre-renderizados
   * mostrando progreso en tiempo real y permitiendo cancelación.
   */
  async iniciarGeneracionLoteVideos(): Promise<void> {
    if (this.generandoLoteVideos) return;

    // 1. Recolectar todos los subtramos únicos del álbum
    const fuentes = [...(this.paginasBase || []), ...(this.paginas || [])];
    const mapaUnico = new Map<string, PaginaMedia>();

    for (const p of fuentes) {
      if (p.trackGpx && p.actividadId && p.idParadaOrigen !== undefined && p.idParadaDestino !== undefined) {
        const k = `${p.actividadId}_${p.idParadaOrigen}_${p.idParadaDestino}`;
        if (!mapaUnico.has(k)) {
          mapaUnico.set(k, p);
        }
      }
    }

    const subtramosTotales = Array.from(mapaUnico.values());

    if (subtramosTotales.length === 0) {
      alert('No se encontraron subtramos de ruta con track GPX en este álbum para generar vídeos.');
      return;
    }

    const pendientes = subtramosTotales.filter(p => !p.urlVideoAnimacion);
    let listaAProcesar: PaginaMedia[] = [];

    if (pendientes.length === 0) {
      const confirmar = window.confirm(
        `Todos los subtramos de este itinerario (${subtramosTotales.length}) ya tienen vídeo MP4 generado.\n\n¿Deseas volver a generarlos todos desde cero para actualizarlos con el nuevo motor fluido?`
      );
      if (!confirmar) return;
      listaAProcesar = subtramosTotales;
    } else if (pendientes.length < subtramosTotales.length) {
      const resp = window.confirm(
        `Se han detectado ${pendientes.length} subtramos pendientes de un total de ${subtramosTotales.length}.\n\n` +
        `• Pulsa ACEPTAR para generar los ${pendientes.length} vídeos pendientes.\n` +
        `• Pulsa CANCELAR si prefieres no iniciar la generación ahora.`
      );
      if (!resp) return;
      listaAProcesar = pendientes;
    } else {
      const confirmar = window.confirm(
        `Se van a generar las animaciones en vídeo MP4 de los ${subtramosTotales.length} subtramos de este itinerario.\n\n` +
        `Durante el proceso podrás seguir el avance fotograma a fotograma en pantalla.\n\n¿Deseas comenzar?`
      );
      if (!confirmar) return;
      listaAProcesar = subtramosTotales;
    }

    this.generandoLoteVideos = true;
    this.cancelarLoteVideos = false;
    this.loteVideoTotal = listaAProcesar.length;
    this.loteVideoActual = 0;
    this.loteVideoProgresoGlobal = 0;
    this.loteVideoProgresoTramo = 0;
    this.cdr.detectChanges();

    let completados = 0;
    let fallidos = 0;

    try {
      for (let i = 0; i < listaAProcesar.length; i++) {
        if (this.cancelarLoteVideos) {
          console.log('🛑 [Generación Lote] Proceso cancelado por el usuario.');
          break;
        }

        const pag = listaAProcesar[i];
        this.loteVideoActual = i + 1;
        this.loteVideoTitulo = pag.titulo || `Parada #${pag.idParadaOrigen} ➔ Parada #${pag.idParadaDestino}`;
        this.loteVideoProgresoTramo = 5;
        this.loteVideoMensajeProgreso = 'Analizando track y cartografía...';
        this.loteVideoProgresoGlobal = Math.round((i / listaAProcesar.length) * 100);
        this.cdr.detectChanges();

        try {
          const url = await this.routeVideoGeneratorService.generarYSubirVideoSubtramo(
            pag.actividadId!,
            pag.idParadaOrigen!,
            pag.idParadaDestino!,
            {
              trackGpx: pag.trackGpx!,
              transportMode: pag.tipoTransporteTramo || 'driving',
              transportSegments: pag.transportSegments || [],
              distanciaKm: pag.distanciaTramoKm || 0,
              titulo: pag.titulo || `Recorrido Parada #${pag.idParadaOrigen} ➔ #${pag.idParadaDestino}`,
              idParadaOrigen: pag.idParadaOrigen,
              idParadaDestino: pag.idParadaDestino,
              fecha: pag.fecha,
              horaSalida: pag.horaInicioTramo || undefined,
              horaLlegada: pag.horaFinTramo || undefined,
              origenDireccion: (pag.origenDireccion || (pag.coordenadasOrigen ? this.obtenerUbicacionCercana(pag.coordenadasOrigen.lat, pag.coordenadasOrigen.lng) : undefined)) || undefined,
              destinoDireccion: (pag.destinoDireccion || (pag.coordenadasDestino ? this.obtenerUbicacionCercana(pag.coordenadasDestino.lat, pag.coordenadasDestino.lng) : undefined)) || undefined,
              origenInfo: pag.origenInfo,
              destinoInfo: pag.destinoInfo
            },
            (progreso) => {
              this.loteVideoProgresoTramo = progreso.porcentaje;
              this.loteVideoMensajeProgreso = progreso.mensaje;
              this.cdr.detectChanges();
            }
          );

          const urlCompleta = `${environment.apiUrl}/${url.replace(/^\//, '')}`;
          pag.urlVideoAnimacion = urlCompleta;
          pag.url = urlCompleta;
          pag.tipoMedia = 'video';
          pag.mimeType = 'video/mp4';

          // Actualizar en todas las colecciones en memoria
          const actualizarEnLista = (lista: PaginaMedia[]) => {
            if (!lista) return;
            for (const item of lista) {
              if (item.actividadId === pag.actividadId &&
                  item.idParadaOrigen === pag.idParadaOrigen &&
                  item.idParadaDestino === pag.idParadaDestino) {
                item.urlVideoAnimacion = urlCompleta;
                item.url = urlCompleta;
                item.tipoMedia = 'video';
                item.mimeType = 'video/mp4';
              }
            }
          };

          actualizarEnLista(this.paginasBase);
          actualizarEnLista(this.paginas);

          // Actualizar caché de la actividad
          const datos = this.cacheDatosActividadGpx.get(pag.actividadId!);
          if (datos) {
            if (!datos.videosSubtramos) datos.videosSubtramos = [];
            const idxExistente = datos.videosSubtramos.findIndex(
              (v: any) => v.id_parada_origen === pag.idParadaOrigen && v.id_parada_destino === pag.idParadaDestino
            );
            if (idxExistente >= 0) {
              datos.videosSubtramos[idxExistente].url = url;
            } else {
              datos.videosSubtramos.push({
                id_parada_origen: pag.idParadaOrigen!,
                id_parada_destino: pag.idParadaDestino!,
                url: url
              });
            }
          }

          completados++;
        } catch (subErr) {
          console.error(`❌ [Generación Lote] Error en subtramo #${pag.idParadaOrigen} ➔ #${pag.idParadaDestino}:`, subErr);
          fallidos++;
        }

        this.loteVideoProgresoGlobal = Math.round(((i + 1) / listaAProcesar.length) * 100);
        this.cdr.detectChanges();
      }
    } finally {
      this.generandoLoteVideos = false;
      this.forzarMapaInteractivo = false;
      this.cdr.detectChanges();

      if (this.cancelarLoteVideos) {
        alert(`Generación detenida. Se completaron ${completados} vídeos antes de cancelar.`);
      } else if (fallidos === 0 && completados > 0) {
        alert(`¡Éxito! Se han generado ${completados} animaciones en vídeo MP4.`);
      } else if (completados > 0) {
        alert(`Generación finalizada: ${completados} vídeos completados con éxito, ${fallidos} con error.`);
      }
    }
  }

  detenerGeneracionLoteVideos(): void {
    if (this.generandoLoteVideos) {
      this.cancelarLoteVideos = true;
      this.loteVideoMensajeProgreso = 'Cancelando generación de vídeos...';
      this.cdr.detectChanges();
    }
  }

  private async obtenerInformacionTransporteActividad(actId: number): Promise<{
    desglose: any[];
    transportePrincipal: string;
    visualSessionData: any;
    rutaVideoAnimado?: string | null;
  }> {
    try {
      let desglose: any[] = [];
      let transportePrincipal: string = '';
      let visualSessionData: any = null;

      // 1. Obtener estadísticas de la actividad (donde está desgloseTransporte real)
      try {
        const stats = await firstValueFrom(this.actividadesItinerariosService.obtenerEstadisticas(actId));
        if (stats?.desgloseTransporte && Array.isArray(stats.desgloseTransporte) && stats.desgloseTransporte.length > 0) {
          desglose = stats.desgloseTransporte;
        }
        if (stats?.transportePrincipal) {
          transportePrincipal = typeof stats.transportePrincipal === 'string'
            ? stats.transportePrincipal
            : (stats.transportePrincipal?.nombre || stats.transportePrincipal?.tipo || '');
        }
      } catch (e) {
        console.warn(`⚠️ No se pudieron obtener estadísticas para actividad #${actId}`, e);
      }

      // 2. Intentar obtener visual session data de Alta Fidelidad
      try {
        const sessionData = await firstValueFrom(this.actividadesItinerariosService.obtenerVisualSession(actId));
        const layers = sessionData?.layers || sessionData?.mapState?.layers;
        if (layers && layers.length > 0) {
          sessionData.layers = layers;
          visualSessionData = sessionData;
        }
      } catch (e) {
        // Silencioso si no hay visual session
      }

      // 3. Si falta transportePrincipal o desglose, consultar los datos de la actividad
      const act = await firstValueFrom(this.actividadesItinerariosService.getById(actId));
      if (desglose.length === 0) {
        if (act?.desgloseTransporte && Array.isArray(act.desgloseTransporte) && act.desgloseTransporte.length > 0) {
          desglose = act.desgloseTransporte;
        } else if (act?.tramos && Array.isArray(act.tramos) && act.tramos.length > 0) {
          desglose = act.tramos;
        }
      }

      if (!transportePrincipal) {
        transportePrincipal = act?.transportePrincipal ||
          act?.perfilTransporte ||
          act?.tipoActividadNombre ||
          act?.nombre ||
          (act?.tramos?.[0]?.tipo) ||
          'walking';
      }

      const rutaVideoAnimado = act?.rutaVideoAnimado || null;

      return { desglose, transportePrincipal, visualSessionData, rutaVideoAnimado };
    } catch (err) {
      console.warn(`⚠️ No se pudo obtener info de transporte para actividad #${actId}`, err);
      return { desglose: [], transportePrincipal: 'walking', visualSessionData: null, rutaVideoAnimado: null };
    }
  }

  private normalizarModoTransporte(nombreModo: string): string {
    if (!nombreModo) return 'walking';
    const norm = nombreModo.toLowerCase();
    if (norm.includes('coche') || norm.includes('driving') || norm.includes('car') || norm.includes('auto') || norm.includes('vehic') || norm.includes('moto') || norm.includes('taxi')) {
      return 'driving';
    }
    if (norm.includes('barco') || norm.includes('boat') || norm.includes('ship') || norm.includes('ferry') || norm.includes('crucero') || norm.includes('embarc') || norm.includes('kayak') || norm.includes('canoa')) {
      return 'boat';
    }
    if (norm.includes('bici') || norm.includes('cycling') || norm.includes('bicycle')) {
      return 'cycling';
    }
    if (norm.includes('bus') || norm.includes('autobus') || norm.includes('autocar')) {
      return 'bus';
    }
    if (norm.includes('tren') || norm.includes('train') || norm.includes('metro') || norm.includes('ferrocarril')) {
      return 'train';
    }
    if (norm.includes('avion') || norm.includes('plane') || norm.includes('flight') || norm.includes('vuelo')) {
      return 'plane';
    }
    if (norm.includes('run') || norm.includes('correr')) {
      return 'running';
    }
    if (norm.includes('andando') || norm.includes('walking') || norm.includes('caminar') || norm.includes('pie')) {
      return 'walking';
    }
    return 'walking';
  }

  private getDistanceMetros(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

  private cachePaginasPorFiltro = new Map<string, PaginaMedia[]>();
  private cacheDatosActividadGpx = new Map<number, {
    points: GpxPoint[];
    gruposPIs: { lat: number; lng: number; archivos: any[]; trackIdx?: number; numeroSecuencial?: number }[];
    piIndices: number[];
    modoBaseNorm: string;
    visualSessionData: any;
    archivosGeo: any[];
    videosSubtramos?: Array<{ id_parada_origen: number; id_parada_destino: number; url: string }>;
  }>();

  private async precargarDatosGpxActividades(paginasInput: PaginaMedia[]): Promise<void> {
    if (!paginasInput || paginasInput.length === 0) return;

    const actIds = Array.from(new Set(
      paginasInput
        .filter(p => !p.esMapaAnimado && p.archivo?.actividadId)
        .map(p => p.archivo!.actividadId)
    ));

    const actIdsParaCargar = actIds.filter(actId => !this.cacheDatosActividadGpx.has(actId));
    if (actIdsParaCargar.length === 0) return;

    console.log(`⚡ [Telemetría GPX] Precargando datos GPX para ${actIdsParaCargar.length} actividades...`);
    await Promise.all(actIdsParaCargar.map(async (actId) => {
      try {
        const [gpxXml, infoTransporte, archivosActividad, subtramosResp] = await Promise.all([
          firstValueFrom(this.trackEditorService.resolveCanonicalGpxXml(actId, { flattenSegments: true })).catch(() => null),
          this.obtenerInformacionTransporteActividad(actId).catch(() => ({ desglose: [], transportePrincipal: '', visualSessionData: null, rutaVideoAnimado: null })),
          firstValueFrom(this.archivoService.getArchivosPorActividad(actId)).catch(() => []),
          firstValueFrom(this.actividadesItinerariosService.obtenerVideosSubtramos(actId)).catch(() => ({ success: false, videos: [] }))
        ]);

        if (gpxXml && gpxXml.trim().length > 0) {
          await new Promise(r => setTimeout(r, 0));
          let points = this.gpxAnimationService.parseGpx(gpxXml);
          const { desglose, transportePrincipal, visualSessionData } = infoTransporte;
          const modoBaseNorm = this.normalizarModoTransporte(transportePrincipal);

          const hasSpecificModes = points.some(p => p.mode && !['walking', 'walk', 'andando', 'caminar', 'pie', 'transport'].includes(p.mode.toLowerCase()));

          if (!hasSpecificModes && desglose && Array.isArray(desglose) && desglose.length > 0) {
            points = this.gpxAnimationService.applyTransportSegments(points, desglose);
          } else {
            points.forEach(p => {
              if (!p.mode || p.mode === 'transport') {
                p.mode = modoBaseNorm;
                p.hfMode = modoBaseNorm;
              }
            });
          }

          const fotosNombresBase1 = new Set<string>();
          (archivosActividad || []).forEach((a: any) => {
            const tipo = (a.tipo || '').toLowerCase();
            if ((tipo === 'foto' || tipo === 'imagen') && a.nombreArchivo) {
              const dotIdx = a.nombreArchivo.lastIndexOf('.');
              const base = dotIdx !== -1 ? a.nombreArchivo.substring(0, dotIdx) : a.nombreArchivo;
              fotosNombresBase1.add(base.toLowerCase());
            }
          });

          const archivosGeo = (archivosActividad || []).filter((a: any) => {
            const tipo = (a.tipo || '').toLowerCase();
            if (tipo === 'mapa_ubicacion' || tipo === 'mapa' || tipo === 'gpx' || tipo === 'manifest' || tipo === 'estadisticas') return false;
            if (a.archivoPrincipalId) return false;
            if (a.nombreArchivo && (
              a.nombreArchivo.toLowerCase().includes('_mapa.') ||
              a.nombreArchivo.toLowerCase().includes('_location_map.') ||
              a.nombreArchivo.toLowerCase().endsWith('_mapa.png')
            )) return false;
            if (tipo === 'audio' && a.nombreArchivo) {
              const dotIdx = a.nombreArchivo.lastIndexOf('.');
              const base = dotIdx !== -1 ? a.nombreArchivo.substring(0, dotIdx) : a.nombreArchivo;
              if (fotosNombresBase1.has(base.toLowerCase())) return false;
            }
            return (tipo === 'foto' || tipo === 'video' || tipo === 'audio' || tipo === 'imagen') &&
              (a.geolocalizacion || (a.latitud && a.longitud) || (a.lat && a.lng));
          });

          // Extraer y agrupar fotos geolocalizadas en PIs (< 10m)
          const validMedia = (archivosGeo || []).map((archivo: any) => {
            let lat: number | null = null;
            let lng: number | null = null;
            if (archivo.geolocalizacion) {
              try {
                const loc = typeof archivo.geolocalizacion === 'string' ? JSON.parse(archivo.geolocalizacion) : archivo.geolocalizacion;
                lat = Number(loc.latitud ?? loc.latitude ?? loc.lat ?? 0);
                lng = Number(loc.longitud ?? loc.longitude ?? loc.lng ?? 0);
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
              const ts = this.obtenerTimestampReal(archivo);
              return { lat, lng, archivo, timestamp: ts };
            }
            return null;
          }).filter(Boolean) as { lat: number; lng: number; archivo: any; timestamp: number }[];

          validMedia.sort((a, b) => a.timestamp - b.timestamp);

          // 1. Mapear cada elemento de validMedia al punto más cercano del track
          // Restringiendo de forma estricta la ventana temporal con desempate espacial
          const hasGpxTimes1 = points.some(p => p.time && !isNaN(new Date(p.time).getTime()));
          let lastTrackIdx1 = 0;

          validMedia.forEach(item => {
            let bestIdx = -1;

            if (hasGpxTimes1 && item.timestamp > 0) {
              // Ventanas temporales progresivas (5 min, 15 min, 30 min hacia adelante)
              const WINDOWS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];
              for (const winMs of WINDOWS_MS) {
                let minDist = Infinity;
                let chosenIdx = -1;
                for (let i = lastTrackIdx1; i < points.length; i++) {
                  const pt = points[i];
                  const ptTime = pt?.time ? new Date(pt.time).getTime() : 0;
                  if (ptTime > 0 && Math.abs(ptTime - item.timestamp) <= winMs) {
                    const d = this.getDistanceMetros(item.lat, item.lng, pt.lat, pt.lng);
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

              // Si buscando hacia adelante no se encontró, evaluar toda la traza dentro de la ventana
              if (bestIdx === -1) {
                let minDist = Infinity;
                for (let i = 0; i < points.length; i++) {
                  const pt = points[i];
                  const ptTime = pt?.time ? new Date(pt.time).getTime() : 0;
                  if (ptTime > 0 && Math.abs(ptTime - item.timestamp) <= 15 * 60 * 1000) {
                    const d = this.getDistanceMetros(item.lat, item.lng, pt.lat, pt.lng);
                    if (d < minDist) {
                      minDist = d;
                      bestIdx = i;
                    }
                  }
                }
              }
            }

            // Fallback espacial si no hay tiempos GPX o fuera de ventana temporal
            if (bestIdx === -1) {
              let minDist = Infinity;
              for (let i = lastTrackIdx1; i < points.length; i++) {
                const d = this.getDistanceMetros(item.lat, item.lng, points[i].lat, points[i].lng);
                if (d < minDist) {
                  minDist = d;
                  bestIdx = i;
                  if (d < 10) break;
                }
              }
            }

            bestIdx = Math.max(lastTrackIdx1, bestIdx !== -1 ? bestIdx : lastTrackIdx1);
            lastTrackIdx1 = bestIdx;
            (item as any).trackIdx = bestIdx;
          });

          // 2. Agrupación canónica idéntica a actividades-itinerarios (Ver GPX)
          const TOLERANCIA_GPS = 0.00015; // ~15 metros
          const MAX_TIME_GAP_MS = 60 * 60 * 1000; // 1 hora
          const gruposPIs: { lat: number; lng: number; trackIdx: number; archivos: any[]; numeroSecuencial?: number }[] = [];

          validMedia.forEach(item => {
            const ultimoGrupo = gruposPIs.length > 0 ? gruposPIs[gruposPIs.length - 1] : null;
            const coincideUbicacion = ultimoGrupo &&
              Math.abs(ultimoGrupo.lat - item.lat) < TOLERANCIA_GPS &&
              Math.abs(ultimoGrupo.lng - item.lng) < TOLERANCIA_GPS;
            const trackMuyCercano = ultimoGrupo && Math.abs(ultimoGrupo.trackIdx - (item as any).trackIdx) < 8;
            const ultimoItem = ultimoGrupo ? ultimoGrupo.archivos[ultimoGrupo.archivos.length - 1] : null;
            const tsUltimo = ultimoItem ? this.obtenerTimestampReal(ultimoItem) : 0;
            const tiempoCercano = !item.timestamp || !tsUltimo || Math.abs(item.timestamp - tsUltimo) < MAX_TIME_GAP_MS;

            if ((coincideUbicacion || trackMuyCercano) && tiempoCercano) {
              ultimoGrupo!.archivos.push(item.archivo);
            } else {
              gruposPIs.push({
                lat: item.lat,
                lng: item.lng,
                trackIdx: (item as any).trackIdx,
                archivos: [item.archivo]
              });
            }
          });

          // 3. Asignar numeroSecuencial canónico coincidente con Ver GPX a cada grupo y a sus archivos
          gruposPIs.forEach((grupo, index) => {
            const num = index + 1;
            grupo.numeroSecuencial = num;
            grupo.archivos.forEach((arch: any) => {
              arch.numeroSecuencial = num;
            });
          });

          // 4. Mapear índices del track para segmentación de rutas
          const piMatchedIndicesSet = new Set<number>([0]);
          gruposPIs.forEach(g => piMatchedIndicesSet.add(g.trackIdx));
          piMatchedIndicesSet.add(points.length - 1);
          const piIndices = Array.from(piMatchedIndicesSet).sort((a, b) => a - b);

          this.cacheDatosActividadGpx.set(actId, {
            points,
            gruposPIs,
            piIndices,
            modoBaseNorm,
            visualSessionData,
            archivosGeo,
            videosSubtramos: (subtramosResp as any)?.videos || []
          });
        }
      } catch (error) {
        console.warn(`⚠️ No se pudo procesar GPX para actividad #${actId}:`, error);
      }
    }));
  }

  private async generarPaginasConAnimaciones(paginasInput: PaginaMedia[]): Promise<PaginaMedia[]> {
    await this.precargarDatosGpxActividades(paginasInput);

    if (!this.incluirAnimacionesMapa) {
      return paginasInput.filter(p => !p.esMapaAnimado || p.esMapaGeneral || p.esMapaItinerario);
    }

    const cacheKey = `${this.contextoViaje?.viajeId || 0}_${this.contextoViaje?.itinerarioId || 0}_${this.distanciaMinimaAnimacionKm}_${paginasInput.length}`;
    if (this.cachePaginasPorFiltro.has(cacheKey)) {
      console.log('⚡ [Caché Álbum] Páginas con animaciones cargadas instantáneamente desde caché:', cacheKey);
      return this.cachePaginasPorFiltro.get(cacheKey)!;
    }

    const mapasPorActividad = new Map<number, PaginaMedia[]>();

    // 1. Extraer actividades únicas del conjunto de páginas
    const actIds = Array.from(new Set(
      paginasInput
        .filter(p => !p.esMapaAnimado && p.archivo?.actividadId)
        .map(p => p.archivo!.actividadId)
    ));

    // 2. Cargar en PARALELO solo las actividades que no estén en caché
    const actIdsParaCargar = actIds.filter(actId => !this.cacheDatosActividadGpx.has(actId));
    if (actIdsParaCargar.length > 0) {
      console.log(`⚡ [Optimización Álbum] Procesando ${actIdsParaCargar.length} actividades en paralelo...`);
      await Promise.all(actIdsParaCargar.map(async (actId) => {
        try {
          const [gpxXml, infoTransporte, archivosActividad, subtramosResp] = await Promise.all([
            firstValueFrom(this.trackEditorService.resolveCanonicalGpxXml(actId, { flattenSegments: true })).catch(() => null),
            this.obtenerInformacionTransporteActividad(actId).catch(() => ({ desglose: [], transportePrincipal: '', visualSessionData: null, rutaVideoAnimado: null })),
            firstValueFrom(this.archivoService.getArchivosPorActividad(actId)).catch(() => []),
            firstValueFrom(this.actividadesItinerariosService.obtenerVideosSubtramos(actId)).catch(() => ({ success: false, videos: [] }))
          ]);

          if (gpxXml && gpxXml.trim().length > 0) {
            await new Promise(r => setTimeout(r, 0));
            let points = this.gpxAnimationService.parseGpx(gpxXml);
            const { desglose, transportePrincipal, visualSessionData } = infoTransporte;
            const modoBaseNorm = this.normalizarModoTransporte(transportePrincipal);

            const hasSpecificModes = points.some(p => p.mode && !['walking', 'walk', 'andando', 'caminar', 'pie', 'transport'].includes(p.mode.toLowerCase()));

            if (!hasSpecificModes && desglose && Array.isArray(desglose) && desglose.length > 0) {
              points = this.gpxAnimationService.applyTransportSegments(points, desglose);
            } else {
              points.forEach(p => {
                if (!p.mode || p.mode === 'transport') {
                  p.mode = modoBaseNorm;
                  p.hfMode = modoBaseNorm;
                }
              });
            }

            const fotosNombresBase2 = new Set<string>();
            (archivosActividad || []).forEach((a: any) => {
              const tipo = (a.tipo || '').toLowerCase();
              if ((tipo === 'foto' || tipo === 'imagen') && a.nombreArchivo) {
                const dotIdx = a.nombreArchivo.lastIndexOf('.');
                const base = dotIdx !== -1 ? a.nombreArchivo.substring(0, dotIdx) : a.nombreArchivo;
                fotosNombresBase2.add(base.toLowerCase());
              }
            });

            const archivosGeo = (archivosActividad || []).filter((a: any) => {
              const tipo = (a.tipo || '').toLowerCase();
              if (tipo === 'mapa_ubicacion' || tipo === 'mapa' || tipo === 'gpx' || tipo === 'manifest' || tipo === 'estadisticas') return false;
              if (a.archivoPrincipalId) return false;
              if (a.nombreArchivo && (
                a.nombreArchivo.toLowerCase().includes('_mapa.') ||
                a.nombreArchivo.toLowerCase().includes('_location_map.') ||
                a.nombreArchivo.toLowerCase().endsWith('_mapa.png')
              )) return false;
              if (tipo === 'audio' && a.nombreArchivo) {
                const dotIdx = a.nombreArchivo.lastIndexOf('.');
                const base = dotIdx !== -1 ? a.nombreArchivo.substring(0, dotIdx) : a.nombreArchivo;
                if (fotosNombresBase2.has(base.toLowerCase())) return false;
              }
              return (tipo === 'foto' || tipo === 'video' || tipo === 'audio' || tipo === 'imagen') &&
                (a.geolocalizacion || (a.latitud && a.longitud) || (a.lat && a.lng));
            });

            // Extraer y agrupar fotos geolocalizadas en PIs (< 10m)
            const validMedia = (archivosGeo || []).map((archivo: any) => {
              let lat: number | null = null;
              let lng: number | null = null;
              if (archivo.geolocalizacion) {
                try {
                  const loc = typeof archivo.geolocalizacion === 'string' ? JSON.parse(archivo.geolocalizacion) : archivo.geolocalizacion;
                  lat = Number(loc.latitud ?? loc.latitude ?? loc.lat ?? 0);
                  lng = Number(loc.longitud ?? loc.longitude ?? loc.lng ?? 0);
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
                const ts = this.obtenerTimestampReal(archivo);
                return { lat, lng, archivo, timestamp: ts };
              }
              return null;
            }).filter(Boolean) as { lat: number; lng: number; archivo: any; timestamp: number }[];

            validMedia.sort((a, b) => a.timestamp - b.timestamp);

            // 1. Mapear cada elemento de validMedia al punto más cercano del track
            // Restringiendo de forma estricta la ventana temporal con desempate espacial
            const hasGpxTimes2 = points.some(p => p.time && !isNaN(new Date(p.time).getTime()));
            let lastTrackIdx2 = 0;

            validMedia.forEach(item => {
              let bestIdx = -1;

              if (hasGpxTimes2 && item.timestamp > 0) {
                // Ventanas temporales progresivas (5 min, 15 min, 30 min hacia adelante)
                const WINDOWS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];
                for (const winMs of WINDOWS_MS) {
                  let minDist = Infinity;
                  let chosenIdx = -1;
                  for (let i = lastTrackIdx2; i < points.length; i++) {
                    const pt = points[i];
                    const ptTime = pt?.time ? new Date(pt.time).getTime() : 0;
                    if (ptTime > 0 && Math.abs(ptTime - item.timestamp) <= winMs) {
                      const d = this.getDistanceMetros(item.lat, item.lng, pt.lat, pt.lng);
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

                // Si buscando hacia adelante no se encontró, evaluar toda la traza dentro de la ventana
                if (bestIdx === -1) {
                  let minDist = Infinity;
                  for (let i = 0; i < points.length; i++) {
                    const pt = points[i];
                    const ptTime = pt?.time ? new Date(pt.time).getTime() : 0;
                    if (ptTime > 0 && Math.abs(ptTime - item.timestamp) <= 15 * 60 * 1000) {
                      const d = this.getDistanceMetros(item.lat, item.lng, pt.lat, pt.lng);
                      if (d < minDist) {
                        minDist = d;
                        bestIdx = i;
                      }
                    }
                  }
                }
              }

              // Fallback espacial si no hay tiempos GPX o fuera de ventana temporal
              if (bestIdx === -1) {
                let minDist = Infinity;
                for (let i = lastTrackIdx2; i < points.length; i++) {
                  const d = this.getDistanceMetros(item.lat, item.lng, points[i].lat, points[i].lng);
                  if (d < minDist) {
                    minDist = d;
                    bestIdx = i;
                    if (d < 10) break;
                  }
                }
              }

              bestIdx = Math.max(lastTrackIdx2, bestIdx !== -1 ? bestIdx : lastTrackIdx2);
              lastTrackIdx2 = bestIdx;
              (item as any).trackIdx = bestIdx;
            });

            // 2. Agrupación canónica idéntica a actividades-itinerarios (Ver GPX)
            const TOLERANCIA_GPS = 0.00015; // ~15 metros
            const MAX_TIME_GAP_MS = 60 * 60 * 1000; // 1 hora
            const gruposPIs: { lat: number; lng: number; trackIdx: number; archivos: any[]; numeroSecuencial?: number }[] = [];

            validMedia.forEach(item => {
              const ultimoGrupo = gruposPIs.length > 0 ? gruposPIs[gruposPIs.length - 1] : null;
              const coincideUbicacion = ultimoGrupo &&
                Math.abs(ultimoGrupo.lat - item.lat) < TOLERANCIA_GPS &&
                Math.abs(ultimoGrupo.lng - item.lng) < TOLERANCIA_GPS;
              const trackMuyCercano = ultimoGrupo && Math.abs(ultimoGrupo.trackIdx - (item as any).trackIdx) < 8;
              const ultimoItem = ultimoGrupo ? ultimoGrupo.archivos[ultimoGrupo.archivos.length - 1] : null;
              const tsUltimo = ultimoItem ? this.obtenerTimestampReal(ultimoItem) : 0;
              const tiempoCercano = !item.timestamp || !tsUltimo || Math.abs(item.timestamp - tsUltimo) < MAX_TIME_GAP_MS;

              if ((coincideUbicacion || trackMuyCercano) && tiempoCercano) {
                ultimoGrupo!.archivos.push(item.archivo);
              } else {
                gruposPIs.push({
                  lat: item.lat,
                  lng: item.lng,
                  trackIdx: (item as any).trackIdx,
                  archivos: [item.archivo]
                });
              }
            });

            // 3. Asignar numeroSecuencial canónico coincidente con Ver GPX a cada grupo y a sus archivos
            gruposPIs.forEach((grupo, index) => {
              const num = index + 1;
              grupo.numeroSecuencial = num;
              grupo.archivos.forEach((arch: any) => {
                arch.numeroSecuencial = num;
                // Sincronizar también con los archivos de las páginas del libro
                if (arch.id) {
                  const pag = paginasInput.find(p => p.archivo?.id === arch.id);
                  if (pag && pag.archivo) {
                    pag.archivo.numeroSecuencial = num;
                  }
                }
              });
            });

            // 4. Mapear índices del track para segmentación de rutas
            const piMatchedIndicesSet = new Set<number>([0]);
            gruposPIs.forEach(g => piMatchedIndicesSet.add(g.trackIdx));
            piMatchedIndicesSet.add(points.length - 1);
            const piIndices = Array.from(piMatchedIndicesSet).sort((a, b) => a - b);

            this.cacheDatosActividadGpx.set(actId, {
              points,
              gruposPIs,
              piIndices,
              modoBaseNorm,
              visualSessionData,
              archivosGeo,
              videosSubtramos: (subtramosResp as any)?.videos || []
            });
          }
        } catch (error) {
          console.warn(`⚠️ No se pudo procesar GPX para actividad #${actId}:`, error);
        }
      }));
    }

    // 3. Generar mapas por tramos válidos a partir de los datos en memoria
    for (const actId of actIds) {
      const datos = this.cacheDatosActividadGpx.get(actId);
      if (!datos) continue;

      const { points, gruposPIs, piIndices, modoBaseNorm, visualSessionData, archivosGeo } = datos;
      const pagRef = paginasInput.find(p => p.archivo?.actividadId === actId);

      // Sincronizar numeroSecuencial canónico de cada parada con las páginas del libro
      gruposPIs.forEach(grupo => {
        grupo.archivos.forEach((arch: any) => {
          const archId = arch.id || arch.archivo?.id;
          if (archId) {
            const pags = paginasInput.filter(p => p.archivo?.id === archId);
            pags.forEach(pag => {
              if (pag.archivo) {
                pag.archivo.numeroSecuencial = grupo.numeroSecuencial;
              }
            });
          }
        });
      });

      // -- Accumulation Buffer Algorithm --
      // Sub-segments accumulate until distanciaMinimaAnimacionKm is reached;
      // then a single fused animation is fired. The last sub-segment always
      // fires regardless of distance (orphan final segment guard).

      interface SubTramoBuffer {
        sInicio: number; sFin: number;
        startIdx: number; endIdx: number;
        allPoints: any[];
        distAcumKm: number; distAcumMetros: number;
      }

      let bufferActual: SubTramoBuffer | null = null;

      const dispararAnimacionBuffer = (buf: SubTramoBuffer) => {
        if (buf.allPoints.length < 2 || buf.distAcumKm <= 0) return;

        const bufStartIdx = buf.startIdx;
        const bufEndIdx   = buf.endIdx;
        const bufSInicio  = buf.sInicio;
        const subSegmentPoints = buf.allPoints;
        const distKm = buf.distAcumKm;
        const distMetros = buf.distAcumMetros;

        const baseDistAcum = subSegmentPoints[0].distAcum || 0;
        const baseTimeAcum = subSegmentPoints[0].timeAcum || 0;
        const subPointsRelativos = subSegmentPoints.map((p: any) => ({
          ...p,
          distAcum: (p.distAcum || 0) - baseDistAcum,
          timeAcum: (p.timeAcum || 0) - baseTimeAcum,
          mode: p.mode || modoBaseNorm,
          hfMode: p.hfMode || p.mode || modoBaseNorm,
          event: undefined
        }));

        const subTransportSegments: any[] = [];
        let currentMode: string | null = null;
        let currentModeDist = 0;
        for (let pIdx = 0; pIdx < subSegmentPoints.length; pIdx++) {
          const pt = subSegmentPoints[pIdx];
          const pMode = pt.mode || pt.hfMode || modoBaseNorm;
          const prevPt = pIdx > 0 ? subSegmentPoints[pIdx - 1] : null;
          const stepDist = prevPt ? Math.max(0, (pt.distAcum - prevPt.distAcum)) : 0;
          if (currentMode === null) {
            currentMode = pMode; currentModeDist = stepDist;
          } else if (pMode === currentMode) {
            currentModeDist += stepDist;
          } else {
            subTransportSegments.push({ tipo: currentMode, nombre: currentMode, distanciaMetros: currentModeDist, distanciaKm: (currentModeDist / 1000).toFixed(2) });
            currentMode = pMode; currentModeDist = stepDist;
          }
        }
        if (currentMode && (currentModeDist > 0 || subTransportSegments.length === 0)) {
          subTransportSegments.push({ tipo: currentMode, nombre: currentMode, distanciaMetros: currentModeDist, distanciaKm: (currentModeDist / 1000).toFixed(2) });
        }
        if (subTransportSegments.length === 0) {
          subTransportSegments.push({ tipo: modoBaseNorm, nombre: modoBaseNorm, distanciaMetros: distMetros, distanciaKm: distKm.toFixed(2) });
        }

        let gpxParcial = '';
        try {
          gpxParcial = this.trackEditorService ? this.trackEditorService.pointsToGpxXml(subPointsRelativos || []) : '';
        } catch (e) { console.warn('[Dynamics Acum] Error generando gpxParcial:', e); }

        const ptInicio = subSegmentPoints[0];
        const ptFin = subSegmentPoints[subSegmentPoints.length - 1];

        // 🌟 NUEVA REGLA DE INTERCALADO DYNAMICS:
        // El mapa unificado (paginaMapa) generado por el buffer debe recibir un timestamp
        // equivalente al del ÚLTIMO elemento multimedia procesado DENTRO de ese mismo buffer (antes del destino) + 1 ms.
        // Esto garantiza que el usuario contemple primero secuencialmente todo el multimedia de las paradas
        // previas e intermedias y justo después se dispare la animación hacia el siguiente destino.
        const pisEnBufferAntesDeDestino = gruposPIs.filter((g: any) => g.trackIdx >= bufStartIdx && g.trackIdx < bufEndIdx);
        let lastFileEnBuffer: any = null;
        for (const pi of pisEnBufferAntesDeDestino) {
          if (pi.archivos && pi.archivos.length > 0) {
            for (const f of pi.archivos) {
              const ts = this.obtenerTimestampReal(f);
              if (!lastFileEnBuffer || ts > this.obtenerTimestampReal(lastFileEnBuffer)) {
                lastFileEnBuffer = f;
              }
            }
          }
        }

        // Fallback si no había fotos en paradas intermedias: comprobar la parada origen
        if (!lastFileEnBuffer) {
          const pisOrigenBuf = gruposPIs.filter((g: any) => g.trackIdx === bufStartIdx);
          for (const pi of pisOrigenBuf) {
            if (pi.archivos && pi.archivos.length > 0) {
              for (const f of pi.archivos) {
                const ts = this.obtenerTimestampReal(f);
                if (!lastFileEnBuffer || ts > this.obtenerTimestampReal(lastFileEnBuffer)) {
                  lastFileEnBuffer = f;
                }
              }
            }
          }
        }

        let timestampInicio = 0;
        let horaInicioTramo = '';
        let horaFinTramo = '';

        const dp2 = pagRef?.fecha ? pagRef.fecha.split('T')[0] : (pagRef?.archivo?.fechaCreacion ? pagRef.archivo.fechaCreacion.split('T')[0] : '1970-01-01');

        if (lastFileEnBuffer) {
          timestampInicio = this.obtenerTimestampReal(lastFileEnBuffer) + 1;
          horaInicioTramo = lastFileEnBuffer.horaCaptura || '';
        }
        if (!timestampInicio && ptInicio?.time instanceof Date && !isNaN(ptInicio.time.getTime())) {
          const h = String(ptInicio.time.getUTCHours()).padStart(2, '0');
          const m = String(ptInicio.time.getUTCMinutes()).padStart(2, '0');
          const s = String(ptInicio.time.getUTCSeconds()).padStart(2, '0');
          const dtLocal = new Date(`${dp2}T${h}:${m}:${s}`);
          if (!isNaN(dtLocal.getTime())) {
            timestampInicio = dtLocal.getTime();
          } else {
            timestampInicio = ptInicio.time.getTime();
          }
        }
        if (ptInicio?.time instanceof Date && !isNaN(ptInicio.time.getTime()) && !horaInicioTramo) {
          horaInicioTramo = ptInicio.time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        }
        if (ptFin?.time instanceof Date && !isNaN(ptFin.time.getTime())) {
          horaFinTramo = ptFin.time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        }
        if (!timestampInicio) {
          let tp = horaInicioTramo || '00:00:00';
          if (tp.length === 5 && tp.includes(':')) tp = `${tp}:00`;
          const dt = new Date(`${dp2}T${tp}`);
          timestampInicio = !isNaN(dt.getTime()) ? dt.getTime() : 0;
        }

        const datePart = dp2;
        const tiposUnicos = Array.from(new Set(subTransportSegments.map((t: any) => t.tipo || t.nombre).filter(Boolean)));
        const tipoTransporteTramo = tiposUnicos.length > 0 ? tiposUnicos.join(', ') : modoBaseNorm;

        const originPI = gruposPIs.find((g: any) => g.trackIdx === bufStartIdx);
        const destPI   = gruposPIs.find((g: any) => g.trackIdx === bufEndIdx);

        // Si es el primer tramo sin archivos previos en el buffer, asegurar que va justo antes de las fotos del destino
        if (!lastFileEnBuffer && destPI && destPI.archivos && destPI.archivos.length > 0) {
          const firstFileDest = destPI.archivos[0];
          const tsDest = this.obtenerTimestampReal(firstFileDest);
          if (tsDest > 0) {
            timestampInicio = Math.min(timestampInicio || (tsDest - 1), tsDest - 1);
          }
        }

        let idParadaOrigen = originPI?.numeroSecuencial;
        if (idParadaOrigen === undefined) { idParadaOrigen = bufSInicio === 0 ? 0 : bufSInicio; }

        let idParadaDestino = destPI?.numeroSecuencial;
        if (idParadaDestino === undefined) {
          idParadaDestino = buf.sFin === piIndices.length - 2
            ? (gruposPIs.length > 0 && typeof gruposPIs[gruposPIs.length - 1].numeroSecuencial === 'number' ? gruposPIs[gruposPIs.length - 1].numeroSecuencial! + 1 : buf.sFin + 1)
            : buf.sFin + 1;
        }

        const tituloTramo = `Recorrido: Parada #${idParadaOrigen} a Parada #${idParadaDestino}`;
        const descTramo   = `Tramo entre Parada #${idParadaOrigen} y Parada #${idParadaDestino} (${distKm.toFixed(1)} km)`;

        const multimediaTramo = archivosGeo.filter((a: any) => {
          if (!a) return false;
          if (originPI && a.numeroSecuencial === originPI.numeroSecuencial) return true;
          if (destPI   && a.numeroSecuencial === destPI.numeroSecuencial)   return true;
          return false;
        });

        const matchVideo = (datos.videosSubtramos || []).find(
          (v: any) => v.id_parada_origen === idParadaOrigen && v.id_parada_destino === idParadaDestino
        );
        let urlVideoRuta: string | undefined = undefined;
        if (matchVideo && matchVideo.url) {
          urlVideoRuta = `${environment.apiUrl}/${matchVideo.url.replace(/^\//, '')}`;
        }

        const paginaMapa: PaginaMedia = {
          archivo: {} as Archivo,
          url: urlVideoRuta || '',
          urlVideoAnimacion: urlVideoRuta,
          titulo: tituloTramo,
          descripcion: descTramo,
          fecha: datePart,
          tipoMedia: urlVideoRuta ? 'video' : 'mapa-animado',
          mimeType: urlVideoRuta ? 'video/mp4' : '',
          cargado: true,
          esMapaAnimado: true,
          idParadaOrigen: idParadaOrigen,
          idParadaDestino: idParadaDestino,
          trackGpx: gpxParcial,
          distanciaTramoKm: distKm,
          actividadId: actId,
          transportSegments: subTransportSegments,
          visualSessionData: visualSessionData,
          isHighFidelityMode: !!visualSessionData,
          horaInicioTramo: horaInicioTramo,
          horaFinTramo: horaFinTramo,
          tipoTransporteTramo: tipoTransporteTramo,
          timestampReal: timestampInicio,
          multimedia: multimediaTramo.length > 0 ? multimediaTramo : archivosGeo,
          // Guardar coordenadas para geocodificación lazy de etiquetas A/B del vídeo
          coordenadasOrigen: ptInicio?.lat != null ? { lat: ptInicio.lat, lng: ptInicio.lng } : undefined,
          coordenadasDestino: ptFin?.lat != null ? { lat: ptFin.lat, lng: ptFin.lng } : undefined
        };

        // Asignar direcciones inmediatas desde la caché de ubicaciones precargadas
        const locOrigen = ptInicio?.lat != null ? this.obtenerUbicacionCercana(ptInicio.lat, ptInicio.lng) : null;
        const locDestino = ptFin?.lat != null ? this.obtenerUbicacionCercana(ptFin.lat, ptFin.lng) : null;

        if (locOrigen) paginaMapa.origenDireccion = locOrigen;
        if (locDestino) paginaMapa.destinoDireccion = locDestino;

        // Geocodificar en segundo plano si no estaba en caché
        if ((!paginaMapa.origenDireccion || !paginaMapa.destinoDireccion) && ptInicio?.lat != null && ptFin?.lat != null && this.geocodificacionService) {
          if (!paginaMapa.origenDireccion) {
            this.geocodificacionService.obtenerInfoUbicacionPunto(ptInicio.lat, ptInicio.lng)
              .then(info => {
                if (info && !/^-?\d+\.\d+/.test(info.nombreCompleto)) {
                  paginaMapa.origenInfo = info;
                  paginaMapa.origenDireccion = info.nombreCompleto;
                }
              }).catch(() => {});
          }
          if (!paginaMapa.destinoDireccion) {
            this.geocodificacionService.obtenerInfoUbicacionPunto(ptFin.lat, ptFin.lng)
              .then(info => {
                if (info && !/^-?\d+\.\d+/.test(info.nombreCompleto)) {
                  paginaMapa.destinoInfo = info;
                  paginaMapa.destinoDireccion = info.nombreCompleto;
                }
              }).catch(() => {});
          }
        }

        if (!urlVideoRuta) { this.encolarPrecacheSubtramo(paginaMapa); }
        if (!mapasPorActividad.has(actId)) { mapasPorActividad.set(actId, []); }
        mapasPorActividad.get(actId)!.push(paginaMapa);
        console.log('[Dynamics Acum] Parada #' + idParadaOrigen + ' a #' + idParadaDestino + ' | ' + distKm.toFixed(2) + 'km (' + (buf.sFin - buf.sInicio + 1) + ' sub-tramos)');
      };

            for (let s = 0; s < piIndices.length - 1; s++) {
        const startIdx = piIndices[s];
        const endIdx = piIndices[s + 1];
        const subSegmentPoints = points.slice(startIdx, endIdx + 1);

        if (subSegmentPoints.length < 2) continue;

        const distMetros = (subSegmentPoints[subSegmentPoints.length - 1].distAcum || 0)
          - (subSegmentPoints[0].distAcum || 0);
        const distKm = distMetros / 1000;

        const esUltimoTramo = (s === piIndices.length - 2);

        if (bufferActual === null) {
          bufferActual = {
            sInicio: s, sFin: s,
            startIdx: startIdx, endIdx: endIdx,
            allPoints: [...subSegmentPoints],
            distAcumKm: distKm, distAcumMetros: distMetros
          };
        } else {
          bufferActual.sFin = s;
          bufferActual.endIdx = endIdx;
          bufferActual.distAcumKm += distKm;
          bufferActual.distAcumMetros += distMetros;
          bufferActual.allPoints.push(...subSegmentPoints.slice(1));
        }

        if (bufferActual.distAcumKm >= this.distanciaMinimaAnimacionKm || esUltimoTramo) {
          dispararAnimacionBuffer(bufferActual);
          bufferActual = null;
        }
      }

      if (bufferActual && bufferActual.distAcumKm > 0) {
        dispararAnimacionBuffer(bufferActual);
      }
    }

    // 2. Dividir paginasInput en bloques de itinerario (cada bloque empieza con Diario/Índice)
    interface BloqueItinerario {
      cabecera?: PaginaMedia;
      mapaEstructural?: PaginaMedia;
      fotos: PaginaMedia[];
      actividadIds: Set<number>;
    }

    const bloques: BloqueItinerario[] = [];
    let bloqueActual: BloqueItinerario = { fotos: [], actividadIds: new Set<number>() };

    for (const pag of paginasInput) {
      if (pag.esMapaGeneral || pag.esMapaItinerario) {
        bloqueActual.mapaEstructural = pag;
        continue;
      }
      if (pag.esMapaAnimado) continue;

      if (pag.esCartaManuscrita || pag.esIndice) {
        if (bloqueActual.cabecera || bloqueActual.fotos.length > 0 || bloqueActual.mapaEstructural) {
          bloques.push(bloqueActual);
        }
        bloqueActual = {
          cabecera: pag,
          fotos: [],
          actividadIds: new Set<number>()
        };
      } else {
        bloqueActual.fotos.push(pag);
        if (pag.archivo?.actividadId) {
          bloqueActual.actividadIds.add(pag.archivo.actividadId);
        }
      }
    }

    if (bloqueActual.cabecera || bloqueActual.fotos.length > 0 || bloqueActual.mapaEstructural) {
      bloques.push(bloqueActual);
    }

    // 3. Para cada bloque: ordenar fotos e intercalar las animaciones en la posición cronológica exacta
    const resultado: PaginaMedia[] = [];

    for (const bloque of bloques) {
      // Recopilar todos los mapas correspondientes a las actividades de este bloque
      const mapasDelBloque: PaginaMedia[] = [];
      for (const actId of bloque.actividadIds) {
        const mapasAct = mapasPorActividad.get(actId) || [];
        mapasDelBloque.push(...mapasAct);
      }

      // Combinar fotos y animaciones del bloque en orden cronológico estricto
      const contenidoDelBloque: PaginaMedia[] = [...bloque.fotos, ...mapasDelBloque];
      contenidoDelBloque.sort((a, b) => {
        const tA = this.obtenerTimestampReal(a);
        const tB = this.obtenerTimestampReal(b);
        if (tA !== tB) {
          return tA - tB;
        }
        // "fotos con misma hora de inicio va primero la foto":
        // Si coinciden exactamente en timestamp, la foto va antes de la animación
        if (!a.esMapaAnimado && b.esMapaAnimado) return -1;
        if (a.esMapaAnimado && !b.esMapaAnimado) return 1;
        return 0;
      });

      // Ensamblar bloque: [Diario/Índice, ...contenidoDelBloque]
      if (bloque.cabecera) {
        resultado.push(bloque.cabecera);
      }
      if (bloque.mapaEstructural) {
        resultado.push(bloque.mapaEstructural);
      }
      resultado.push(...contenidoDelBloque);
    }

    this.cachePaginasPorFiltro.set(cacheKey, resultado);
    return resultado;
  }

  onFinAnimacionMapa(): void {
    // 🛡️ REGLA CRÍTICA: El avatar DEBE llegar hasta el destino final B.
    // Si hay un elemento <video> de mapa reproduciéndose y NO ha finalizado, ABORTAR cualquier avance prematuro.
    const vEl = (document.getElementById('video-mapa-animado') as HTMLVideoElement)
      || (document.getElementById('video-mapa-single') as HTMLVideoElement)
      || (document.getElementById('video-mapa-der') as HTMLVideoElement)
      || (document.querySelector('.video-mapa-vintage') as HTMLVideoElement);

    if (vEl && !this.forzarMapaInteractivo) {
      const dur = vEl.duration;
      const cur = vEl.currentTime;
      if (!vEl.ended && isFinite(dur) && dur > 0.5 && cur < (dur - 0.3)) {
        console.warn(`🛑 [onFinAnimacionMapa] Bloqueado avance prematuro: vídeo en ${cur.toFixed(1)}s de ${dur.toFixed(1)}s (no ha terminado)`);
        return;
      }
    }

    console.log('🏁 [onFinAnimacionMapa] Animación/vídeo de ruta completado al 100% y avatar en destino B');

    if (this.timerFallbackMapa) {
      clearTimeout(this.timerFallbackMapa);
      this.timerFallbackMapa = null;
    }

    // Pausa deliberada de 1.2s tras la llegada para contemplar el mapa con el avatar en destino B
    const pausaLecturaMs = 1200;

    if (this.mostrarFullscreen) {
      if (this.reproduciendoSlideshow || this.modoGuiadoActivo) {
        setTimeout(() => {
          if ((this.reproduciendoSlideshow || this.modoGuiadoActivo) && this.mostrarFullscreen) {
            this.avanzarSlideshow();
          }
        }, pausaLecturaMs);
      } else {
        setTimeout(() => {
          if (this.mostrarFullscreen && this.hayPaginaSiguiente) {
            console.log('➡️ Avanzando automáticamente del mapa animado a la foto en pantalla completa');
            this.navegarEnFullscreen(1);
          }
        }, pausaLecturaMs);
      }
    } else {
      if (this.reproduciendoSlideshow || this.modoGuiadoActivo) {
        setTimeout(() => {
          if (this.reproduciendoSlideshow || this.modoGuiadoActivo) {
            console.log('➡️ [Modo Guiado / Slideshow] Avanzando automáticamente del mapa al siguiente pliego');
            this.avanzarSlideshow();
          }
        }, pausaLecturaMs);
      } else {
        setTimeout(() => {
          if (this.hayPaginaSiguiente) {
            console.log('➡️ Avanzando automáticamente del mapa animado al siguiente pliego');
            this.cambiarPagina(1);
          }
        }, pausaLecturaMs);
      }
    }
  }


  /**
   * Alterna entre la reproducción de vídeo y el mapa interactivo clásico de Leaflet.
   */
  toggleMapaInteractivo(pagina?: PaginaMedia, event?: Event): void {
    if (event) event.stopPropagation();
    this.forzarMapaInteractivo = !this.forzarMapaInteractivo;
    if (this.forzarMapaInteractivo) {
      this.cargandoMapaInteractivo = true;
      setTimeout(() => {
        this.cargandoMapaInteractivo = false;
        this.cdr.detectChanges();
      }, 300);
    }
    this.cdr.detectChanges();
  }

  /**
   * Encola un subtramo para auto pre-caching silencioso en segundo plano sin interrumpir la interfaz.
   */
  encolarPrecacheSubtramo(pag: PaginaMedia): void {
    if (pag.urlVideoAnimacion) return;
    if (!pag.trackGpx || !pag.actividadId) return;
    if (pag.idParadaOrigen === undefined || pag.idParadaDestino === undefined) return;

    const key = `${pag.actividadId}_${pag.idParadaOrigen}_${pag.idParadaDestino}`;
    const yaEnCola = this.colaPrecachingSubtramos.some(
      p => `${p.actividadId}_${p.idParadaOrigen}_${p.idParadaDestino}` === key
    );
    if (!yaEnCola) {
      this.colaPrecachingSubtramos.push(pag);
      this.procesarColaPrecaching();
    }
  }

  /**
   * Procesa la cola de pre-caching de subtramos uno a uno mediante Offscreen Canvas + WebCodecs.
   */
  private async procesarColaPrecaching(): Promise<void> {
    if (this.procesandoPrecaching || this.colaPrecachingSubtramos.length === 0) return;

    // ⚡ Solo auto pre-cachear si el navegador soporta WebCodecs acelerado por hardware (evita saturar el hilo principal con MediaRecorder en orígenes HTTP)
    const tieneWebCodecs = typeof (window as any).VideoEncoder === 'function';
    if (!tieneWebCodecs) {
      console.log('ℹ️ [Auto Pre-cache] WebCodecs no disponible (origen HTTP no seguro). Usando animación nativa GPX fluida para no saturar la CPU.');
      this.colaPrecachingSubtramos = [];
      return;
    }

    this.procesandoPrecaching = true;

    while (this.colaPrecachingSubtramos.length > 0) {
      // 🛑 Pausar si el usuario está reproduciendo el libro, slideshow o viendo un mapa en directo
      if (this.reproduciendoSlideshow) {
        console.log('⏸️ [Auto Pre-cache] Pausado temporalmente durante reproducción activa.');
        break;
      }

      const pag = this.colaPrecachingSubtramos.shift()!;
      if (pag.urlVideoAnimacion) continue;

      try {
        console.log(`🔄 [Auto Pre-cache] Generando vídeo silencioso Parada #${pag.idParadaOrigen} ➔ #${pag.idParadaDestino}...`);
        const url = await this.routeVideoGeneratorService.generarYSubirVideoSubtramo(
          pag.actividadId!,
          pag.idParadaOrigen!,
          pag.idParadaDestino!,
          {
            trackGpx: pag.trackGpx!,
            transportMode: pag.tipoTransporteTramo || 'driving',
            transportSegments: pag.transportSegments || [],
            distanciaKm: pag.distanciaTramoKm || 0,
            titulo: pag.titulo || `Recorrido Parada #${pag.idParadaOrigen} ➞ #${pag.idParadaDestino}`,
            idParadaOrigen: pag.idParadaOrigen,
            idParadaDestino: pag.idParadaDestino,
            fecha: pag.fecha,
            horaSalida: pag.horaInicioTramo || undefined,
            horaLlegada: pag.horaFinTramo || undefined,
            origenDireccion: (pag.origenDireccion || (pag.coordenadasOrigen ? this.obtenerUbicacionCercana(pag.coordenadasOrigen.lat, pag.coordenadasOrigen.lng) : undefined)) || undefined,
            destinoDireccion: (pag.destinoDireccion || (pag.coordenadasDestino ? this.obtenerUbicacionCercana(pag.coordenadasDestino.lat, pag.coordenadasDestino.lng) : undefined)) || undefined,
            origenInfo: pag.origenInfo,
            destinoInfo: pag.destinoInfo
          }
        );

        const urlCompleta = `${environment.apiUrl}/${url.replace(/^\//, '')}`;
        pag.urlVideoAnimacion = urlCompleta;
        pag.url = urlCompleta;
        pag.tipoMedia = 'video';
        pag.mimeType = 'video/mp4';

        // Actualizar en la caché de datos de la actividad
        const datos = this.cacheDatosActividadGpx.get(pag.actividadId!);
        if (datos) {
          if (!datos.videosSubtramos) datos.videosSubtramos = [];
          datos.videosSubtramos.push({
            id_parada_origen: pag.idParadaOrigen!,
            id_parada_destino: pag.idParadaDestino!,
            url: url
          });
        }

        console.log(`🎬 [Auto Pre-cache] Vídeo subtramo #${pag.idParadaOrigen}➔#${pag.idParadaDestino} listo:`, urlCompleta);
        this.cdr.detectChanges();
      } catch (e) {
        console.warn(`⚠️ [Auto Pre-cache] Error pre-renderizando subtramo #${pag.idParadaOrigen}➔#${pag.idParadaDestino}:`, e);
      }
    }

    this.procesandoPrecaching = false;
  }

  async generarVideoRutaActual(pagMapa?: PaginaMedia): Promise<void> {
    const mapa = pagMapa || this.spreadActualData?.paginaMapa || this.paginas[this.paginaActual];
    if (!mapa || !mapa.trackGpx || !mapa.actividadId) {
      console.warn('⚠️ No se puede generar vídeo: faltan datos del track o actividadId');
      return;
    }

    try {
      this.generandoVideoRutaEnCurso = true;
      this.progresoRenderVideoRuta = 'Iniciando generación 60fps...';
      this.cdr.detectChanges();

      const esSubtramo = mapa.idParadaOrigen != null && mapa.idParadaDestino != null;
      const opts = {
        trackGpx: mapa.trackGpx,
        transportMode: mapa.tipoTransporteTramo || 'driving',
        transportSegments: mapa.transportSegments || [],
        distanciaKm: mapa.distanciaTramoKm || 0,
        titulo: mapa.titulo || (esSubtramo ? `Recorrido Parada #${mapa.idParadaOrigen} ➔ #${mapa.idParadaDestino}` : 'Recorrido'),
        idParadaOrigen: mapa.idParadaOrigen,
        idParadaDestino: mapa.idParadaDestino,
        fecha: mapa.fecha,
        horaSalida: mapa.horaInicioTramo || undefined,
        horaLlegada: mapa.horaFinTramo || undefined,
        origenDireccion: (mapa.origenDireccion || (mapa.coordenadasOrigen ? this.obtenerUbicacionCercana(mapa.coordenadasOrigen.lat, mapa.coordenadasOrigen.lng) : undefined)) || undefined,
        destinoDireccion: (mapa.destinoDireccion || (mapa.coordenadasDestino ? this.obtenerUbicacionCercana(mapa.coordenadasDestino.lat, mapa.coordenadasDestino.lng) : undefined)) || undefined,
        origenInfo: mapa.origenInfo,
        destinoInfo: mapa.destinoInfo
      };

      const url = esSubtramo
        ? await this.routeVideoGeneratorService.generarYSubirVideoSubtramo(
            mapa.actividadId,
            mapa.idParadaOrigen!,
            mapa.idParadaDestino!,
            opts,
            (progreso) => {
              this.progresoRenderVideoRuta = progreso.mensaje;
              this.cdr.detectChanges();
            }
          )
        : await this.routeVideoGeneratorService.generarYSubirVideo(
            mapa.actividadId,
            opts,
            (progreso) => {
              this.progresoRenderVideoRuta = progreso.mensaje;
              this.cdr.detectChanges();
            }
          );

      const urlCompleta = `${environment.apiUrl}/${url.replace(/^\//, '')}`;
      mapa.urlVideoAnimacion = urlCompleta;
      mapa.url = urlCompleta;
      mapa.tipoMedia = 'video';
      this.forzarMapaInteractivo = false;
      this.generandoVideoRutaEnCurso = false;
      this.progresoRenderVideoRuta = '';

      if (esSubtramo) {
        const datos = this.cacheDatosActividadGpx.get(mapa.actividadId);
        if (datos) {
          if (!datos.videosSubtramos) datos.videosSubtramos = [];
          const idx = datos.videosSubtramos.findIndex(
            v => v.id_parada_origen === mapa.idParadaOrigen && v.id_parada_destino === mapa.idParadaDestino
          );
          if (idx >= 0) {
            datos.videosSubtramos[idx].url = url;
          } else {
            datos.videosSubtramos.push({
              id_parada_origen: mapa.idParadaOrigen!,
              id_parada_destino: mapa.idParadaDestino!,
              url: url
            });
          }
        }
      }

      console.log('🎬 ¡Vídeo de ruta generado con éxito!', mapa.urlVideoAnimacion);
      this.cdr.detectChanges();
    } catch (err: any) {
      console.error('❌ Error generando vídeo de ruta:', err);
      this.generandoVideoRutaEnCurso = false;
      this.progresoRenderVideoRuta = 'Error al generar vídeo';
      this.cdr.detectChanges();
    }
  }

  calcularDiasEntreFechas(inicio?: string, fin?: string): number {
    if (!inicio) return 1;
    const fIni = new Date(inicio);
    const fFin = fin ? new Date(fin) : fIni;
    if (isNaN(fIni.getTime())) return 1;
    const diff = Math.abs(fFin.getTime() - fIni.getTime());
    return Math.max(1, Math.round(diff / (1000 * 60 * 60 * 24)) + 1);
  }

  private async resolverGpxItinerario(actsItin: any[], fotosItin: PaginaMedia[]): Promise<{ gpx: string; distanciaKm: number; puntos: GpxPoint[] }> {
    const puntosItin: GpxPoint[] = [];
    let distanciaTotalKm = 0;

    for (const act of actsItin) {
      try {
        let gpxXml: string | null = null;

        // 1. Intentar resolver segmento canónico en memoria
        if (this.gpxAnimationService && typeof (this.gpxAnimationService as any).resolveCanonicalGpxXml === 'function') {
          gpxXml = (this.gpxAnimationService as any).resolveCanonicalGpxXml(act.id);
        }

        // 2. Fallback directo al servicio de actividades si no estaba en caché
        if (!gpxXml && this.actividadesItinerariosService) {
          try {
            const blob = await firstValueFrom(this.actividadesItinerariosService.obtenerGPX(act.id).pipe(takeUntil(this.destroy$)));
            if (blob && blob.size > 0) {
              gpxXml = await blob.text();
            }
          } catch {}
        }

        let distActRawKm = 0;
        if (gpxXml && gpxXml.trim().length > 0) {
          const pts = this.gpxAnimationService.parseGpx(gpxXml);
          if (pts && pts.length > 0) {
            if (puntosItin.length > 0) {
              pts[0].isGap = true;
            }
            puntosItin.push(...pts);
            for (let i = 1; i < pts.length; i++) {
              distActRawKm += this.getDistanceMetros(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng) / 1000;
            }
          }
        }

        // Si la actividad tiene distancia oficial calibrada (por ejemplo los 11.34 km del podómetro/reloj):
        const distOficialAct = (act && act.distanciaKm && Number(act.distanciaKm) > 0)
          ? Number(act.distanciaKm)
          : distActRawKm;

        distanciaTotalKm += distOficialAct;
      } catch (err) {
        console.warn(`⚠️ Error al resolver GPX de actividad ${act.id}: ${err}`);
      }
    }

    let gpxFinal = '';
    if (puntosItin.length > 0 && this.trackEditorService) {
      try {
        gpxFinal = this.trackEditorService.pointsToGpxXml(puntosItin);
      } catch (err) {
        console.warn('⚠️ Error al generar GPX XML para itinerario:', err);
      }
    }

    return {
      gpx: gpxFinal,
      distanciaKm: distanciaTotalKm,
      puntos: puntosItin
    };
  }

  private async crearPaginasConDescripcionesItinerarios(archivos: PaginaMedia[]): Promise<PaginaMedia[]> {
    console.log('📖 Creando páginas con descripciones de itinerarios y mapas de doble página...');

    const paginasFinales: PaginaMedia[] = [];

    // Página 1 inicial: Carta manuscrita de Introducción del Viaje ("ITINERARIO: ESPAÑA")
    const tituloIntroViaje = `ITINERARIO: ${this.obtenerTituloIntroLimpio()}`;
    const descIntroViaje = this.infoViaje?.descripcion || 'Diario de viaje, memorias fotográficas y recorrido detallado del itinerario.';
    const paginaIntroViaje: PaginaMedia = {
      archivo: {} as Archivo,
      url: '',
      titulo: tituloIntroViaje,
      descripcion: descIntroViaje,
      fecha: this.infoViaje?.fechaInicio || '',
      tipoMedia: 'carta-manuscrita',
      mimeType: '',
      esCartaManuscrita: true
    };
    paginasFinales.push(paginaIntroViaje);

    // Agrupar archivos por itinerario
    const archivosPorItinerario = new Map<number, PaginaMedia[]>();
    const archivosSinItinerario: PaginaMedia[] = [];
    const actividadesPorItinerario = await this.cargarActividadesPorItinerario();

    archivos.forEach(archivo => {
      let itinerarioId: number | undefined = archivo.archivo?.itinerarioId;

      if (!itinerarioId && archivo.archivo?.actividadId) {
        const actividadId = archivo.archivo.actividadId;
        for (const [itId, actividades] of actividadesPorItinerario.entries()) {
          if (actividades.some((act: any) => act.id === actividadId)) {
            itinerarioId = itId;
            break;
          }
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

    archivosPorItinerario.forEach((fotos, itinerarioId) => {
      fotos.sort((a, b) => this.obtenerTimestampReal(a) - this.obtenerTimestampReal(b));
    });

    const itinerariosOrdenados = this.listaItinerarios.sort((a, b) => {
      const fechaA = new Date(a.fechaInicio || 0);
      const fechaB = new Date(b.fechaInicio || 0);
      return fechaA.getTime() - fechaB.getTime();
    });

    // Comprobar si el viaje tiene un solo itinerario con fotos (o viaje == itinerario)
    const itinerariosConFotos = itinerariosOrdenados.filter(it => (archivosPorItinerario.get(it.id) || []).length > 0);
    const esItinerarioUnico = itinerariosConFotos.length <= 1;

    // Puntos acumulados de todos los itinerarios para el Mapa General del Viaje
    const puntosTodosItinerarios: GpxPoint[] = [];
    const mapaGpsPorItinerario = new Map<number, GpxPoint[]>();
    let distanciaTotalViajeKm = 0;

    // Generar mapas y contenido para cada itinerario
    const contenidoItinerarios: PaginaMedia[] = [];

    for (const itinerario of itinerariosOrdenados) {
      const fotosItinerario = archivosPorItinerario.get(itinerario.id) || [];

      if (fotosItinerario.length > 0) {
        let itinerarioCompleto: any = null;
        try {
          itinerarioCompleto = await firstValueFrom(
            this.itinerarioService.obtenerItinerarioGeneral(itinerario.id)
              .pipe(takeUntil(this.destroy$))
          );
        } catch (error) {
          console.warn(`⚠️ Error al cargar itinerario ${itinerario.id}: ${error}`);
        }

        const tituloItin = (itinerarioCompleto?.nombre || itinerario.nombre || `Itinerario #${itinerario.id}`).toUpperCase();
        const descItin = itinerarioCompleto?.descripcionGeneral || itinerario.descripcion || 'Diario de viaje y recorrido del itinerario.';
        const fechaItin = itinerarioCompleto?.fechaInicio || itinerario.fechaInicio || '';
        const diasItin = itinerarioCompleto?.duracionDias || this.calcularDiasEntreFechas(fechaItin, itinerarioCompleto?.fechaFin) || 1;

        // Resolver GPX del itinerario
        const actsItin = actividadesPorItinerario.get(itinerario.id) || [];
        const infoItinGpx = await this.resolverGpxItinerario(actsItin, fotosItinerario);

        if (infoItinGpx.puntos.length > 0) {
          mapaGpsPorItinerario.set(itinerario.id, infoItinGpx.puntos);
          if (puntosTodosItinerarios.length > 0) {
            infoItinGpx.puntos[0].isGap = true;
          }
          puntosTodosItinerarios.push(...infoItinGpx.puntos);
          distanciaTotalViajeKm += infoItinGpx.distanciaKm;
        }

        if (esItinerarioUnico) {
          // 💡 Si el viaje consta de un único itinerario, el itinerario ES el viaje completo.
          // Enriquecemos la carta del viaje si es necesario y NO duplicamos la carta ni el mapa del itinerario.
          if (descItin && (!paginaIntroViaje.descripcion || paginaIntroViaje.descripcion.includes('Diario de viaje, memorias fotográficas'))) {
            paginaIntroViaje.descripcion = descItin;
          }
          contenidoItinerarios.push(...fotosItinerario);
          console.log(`✅ Itinerario único ${itinerario.id}: Asimilado en el Mapa General del Viaje, omitida duplicación estructural y añadidas ${fotosItinerario.length} fotos.`);
        } else {
          // 1. Carta manuscrita de descripción del itinerario
          const paginaDescripcion: PaginaMedia = {
            archivo: {} as Archivo,
            url: '',
            titulo: `Itinerario: ${itinerarioCompleto?.destinosPorDia?.split(',')[0] || tituloItin}`,
            descripcion: descItin,
            fecha: fechaItin,
            tipoMedia: 'carta-manuscrita',
            mimeType: '',
            esCartaManuscrita: true,
            itinerarioId: itinerario.id
          };
          contenidoItinerarios.push(paginaDescripcion);

          // 2. Mapa específico del Itinerario a doble página con puntos clave y pre-renderizado instantáneo
          const tituloMapaItin = `MAPA: ${tituloItin}`;
          const descMapaItin = descItin;
          const puntosClaveItin: PuntoClaveMapa[] = [];
          if (infoItinGpx.puntos && infoItinGpx.puntos.length > 0) {
            const pt0 = infoItinGpx.puntos[0];
            const destinosItin = (itinerarioCompleto?.destinosPorDia || '').split(',').map((s: string) => s.trim()).filter(Boolean);
            const origenNom = destinosItin[0] || itinerario.nombre || 'Salida';
            puntosClaveItin.push({
              numero: 1,
              nombre: origenNom,
              lat: pt0.lat,
              lng: pt0.lng,
              color: '#10b981'
            });
            if (infoItinGpx.puntos.length > 5) {
              const ptN = infoItinGpx.puntos[infoItinGpx.puntos.length - 1];
              const destNom = destinosItin.length > 1 ? destinosItin[destinosItin.length - 1] : (itinerarioCompleto?.descripcionGeneral || 'Llegada');
              puntosClaveItin.push({
                numero: 2,
                nombre: destNom,
                lat: ptN.lat,
                lng: ptN.lng,
                color: '#ef4444'
              });
            }
          }

          const paginaMapaItin: PaginaMedia = {
            archivo: {} as Archivo,
            url: '',
            titulo: tituloMapaItin,
            descripcion: descMapaItin,
            fecha: fechaItin,
            tipoMedia: 'mapa-animado',
            mimeType: '',
            cargado: true,
            esMapaAnimado: true,
            esMapaItinerario: true,
            duracionDias: diasItin,
            trackGpx: infoItinGpx.gpx,
            distanciaTramoKm: infoItinGpx.distanciaKm,
            itinerarioId: itinerario.id,
            multimedia: fotosItinerario,
            puntosClave: puntosClaveItin
          };
          contenidoItinerarios.push(paginaMapaItin);

          // Consulta de pre-caché y generación de snapshot del mapa de itinerario para carga instantánea sin frames
          const idViajeActual = this.infoViaje?.id || this.contextoViaje?.viajeId;
          if (idViajeActual && itinerario.id) {
            this.routeVideoGeneratorService.verificarSnapshotExiste(idViajeActual, 'itinerario', itinerario.id)
              .then(async (snap) => {
                if (snap.exists && snap.url) {
                  const fullUrl = snap.url.startsWith('http') ? snap.url : `${environment.apiUrl || 'http://localhost:3000'}${snap.url}`;
                  paginaMapaItin.urlMapaRenderizado = fullUrl;
                  paginaMapaItin.url = fullUrl;
                  this.cdr.detectChanges();
                } else if (infoItinGpx.gpx) {
                  try {
                    const urlGen = await this.routeVideoGeneratorService.generarYSubirSnapshotMapa(
                      idViajeActual,
                      infoItinGpx.gpx,
                      tituloMapaItin,
                      descMapaItin,
                      infoItinGpx.distanciaKm,
                      'itinerario',
                      itinerario.id,
                      puntosClaveItin
                    );
                    const fullUrl = urlGen.startsWith('http') ? urlGen : `${environment.apiUrl || 'http://localhost:3000'}${urlGen}`;
                    paginaMapaItin.urlMapaRenderizado = fullUrl;
                    paginaMapaItin.url = fullUrl;
                    this.cdr.detectChanges();
                  } catch (e) {
                    console.warn(`⚠️ No se pudo generar snapshot de mapa itinerario ${itinerario.id}:`, e);
                  }
                }
              })
              .catch((e) => console.warn(`⚠️ Error al verificar snapshot de itinerario ${itinerario.id}:`, e));
          }

          // 3. Fotos ordenadas del itinerario
          contenidoItinerarios.push(...fotosItinerario);
          console.log(`✅ Procesado itinerario ${itinerario.id}: descripción + mapa doble página + ${fotosItinerario.length} fotos`);
        }
      }
    }

    // Página 2 inicial: Mapa General de todo el Viaje (Doble página panorámica)
    let gpxGeneralViaje = '';
    if (puntosTodosItinerarios.length > 0 && this.trackEditorService) {
      try {
        gpxGeneralViaje = this.trackEditorService.pointsToGpxXml(puntosTodosItinerarios);
      } catch (err) {
        console.warn('⚠️ Error al generar GPX XML general del viaje:', err);
      }
    }

    // Acumular duración total y pasos de todas las actividades del viaje
    let duracionTotalViajeSegundos = 0;
    let pasosTotalesViaje = 0;
    for (const [itId, acts] of actividadesPorItinerario.entries()) {
      for (const act of acts) {
        if (act.duracionSegundos) {
          duracionTotalViajeSegundos += Number(act.duracionSegundos);
        }
        if (act.pasosEstimados) {
          pasosTotalesViaje += Number(act.pasosEstimados);
        }
      }
    }

    // Calcular fechas y días reales de todo el conjunto de itinerarios
    const todasFechas: string[] = [];
    if (this.infoViaje?.fechaInicio) todasFechas.push(this.infoViaje.fechaInicio);
    if (this.infoViaje?.fechaFin) todasFechas.push(this.infoViaje.fechaFin);
    this.listaItinerarios.forEach(it => {
      if (it.fechaInicio) todasFechas.push(it.fechaInicio);
      if (it.fechaFin) todasFechas.push(it.fechaFin);
    });
    todasFechas.sort();
    const fechaMinViaje = todasFechas.length > 0 ? todasFechas[0] : (this.infoViaje?.fechaInicio || '');
    const fechaMaxViaje = todasFechas.length > 0 ? todasFechas[todasFechas.length - 1] : (this.infoViaje?.fechaFin || fechaMinViaje);

    let diasTotalesViaje = this.listaItinerarios.length > 0 ? this.listaItinerarios.length : 1;
    if (fechaMinViaje && fechaMaxViaje) {
      diasTotalesViaje = Math.max(diasTotalesViaje, this.calcularDiasEntreFechas(fechaMinViaje, fechaMaxViaje));
    }

    // Si la carta intro tiene la descripción auto-generada de tracking importado, actualizarla con los totales reales del viaje
    const esDescTracking = !paginaIntroViaje.descripcion ||
      paginaIntroViaje.descripcion.includes('Tracking importado') ||
      paginaIntroViaje.descripcion.startsWith('Tracking importado');

    if (esDescTracking && distanciaTotalViajeKm > 0) {
      const horas = Math.floor(duracionTotalViajeSegundos / 3600);
      const minutos = Math.floor((duracionTotalViajeSegundos % 3600) / 60);
      const segundos = duracionTotalViajeSegundos % 60;
      const duracionStr = `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
      const duracionCorta = `${horas}h ${String(minutos).padStart(2, '0')}m`;
      const diasStr = `${diasTotalesViaje} ${diasTotalesViaje === 1 ? 'día' : 'días'}`;
      const pasosStr = pasosTotalesViaje > 0 ? ` - ${pasosTotalesViaje.toLocaleString('es-ES')} pasos` : '';

      paginaIntroViaje.descripcion = `Tracking importado desde AudioPhotoApp - ${diasStr} - ${distanciaTotalViajeKm.toFixed(2)} km - ${duracionStr} (${duracionCorta})${pasosStr}`;
    }

    if (fechaMinViaje) {
      paginaIntroViaje.fecha = fechaMinViaje;
    }

    const tituloMapaGeneral = `MAPA GENERAL: ${this.obtenerTituloIntroLimpio()}`;
    const descMapaGeneral = `Recorrido unificado y vista panorámica de ${this.obtenerTituloIntroLimpio()}`;

    const puntosClaveGeneral = this.extraerPuntosClaveParaMapa(itinerariosOrdenados, mapaGpsPorItinerario);

    const paginaMapaGeneralViaje: PaginaMedia = {
      archivo: {} as Archivo,
      url: '',
      titulo: tituloMapaGeneral,
      descripcion: descMapaGeneral,
      fecha: fechaMinViaje || this.infoViaje?.fechaInicio || '',
      tipoMedia: 'mapa-animado',
      mimeType: '',
      cargado: true,
      esMapaAnimado: true,
      esMapaGeneral: true,
      duracionDias: diasTotalesViaje,
      trackGpx: gpxGeneralViaje,
      distanciaTramoKm: distanciaTotalViajeKm,
      multimedia: [],
      visualSessionData: null,
      puntosClave: puntosClaveGeneral
    };
    paginasFinales.push(paginaMapaGeneralViaje);

    // Consulta de pre-caché y generación de snapshot del mapa general para carga instantánea
    const viajeId = this.infoViaje?.id || this.contextoViaje?.viajeId;
    if (viajeId) {
      this.routeVideoGeneratorService.verificarSnapshotExiste(viajeId, 'general')
        .then(async (snap) => {
          if (snap.exists && snap.url) {
            const fullUrl = snap.url.startsWith('http') ? snap.url : `${environment.apiUrl || 'http://localhost:3000'}${snap.url}`;
            paginaMapaGeneralViaje.urlMapaRenderizado = fullUrl;
            paginaMapaGeneralViaje.url = fullUrl;
            this.cdr.detectChanges();
          } else if (gpxGeneralViaje) {
            try {
              const urlGen = await this.routeVideoGeneratorService.generarYSubirSnapshotMapa(
                viajeId,
                gpxGeneralViaje,
                tituloMapaGeneral,
                descMapaGeneral,
                distanciaTotalViajeKm,
                'general',
                undefined,
                puntosClaveGeneral
              );
              const fullUrl = urlGen.startsWith('http') ? urlGen : `${environment.apiUrl || 'http://localhost:3000'}${urlGen}`;
              paginaMapaGeneralViaje.urlMapaRenderizado = fullUrl;
              paginaMapaGeneralViaje.url = fullUrl;
              this.cdr.detectChanges();
            } catch (e) {
              console.warn('⚠️ No se pudo generar snapshot inicial de mapa general:', e);
            }
          }
        })
        .catch((e) => console.warn('⚠️ Error al verificar snapshot de mapa general:', e));
    }

    // Añadir todos los itinerarios (carta + mapa doble página + fotos)
    paginasFinales.push(...contenidoItinerarios);

    // Añadir fotos sin itinerario al final si las hubiera
    if (archivosSinItinerario.length > 0) {
      archivosSinItinerario.sort((a, b) => this.obtenerTimestampReal(a) - this.obtenerTimestampReal(b));
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
    }

    console.log(`📖 Creadas ${paginasFinales.length} páginas con mapas de doble página (viaje completo e itinerarios) e historias ordenadas`);
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

  /**
   * 🛡️ Determina con máxima precisión si la actividad/viaje actual corresponde al módulo Dynamics.
   */
  public esActividadDynamics(archivos?: any[]): boolean {
    if (this.infoViaje) {
      const nombre = (this.infoViaje.nombre || '').toLowerCase();
      const desc = (this.infoViaje.descripcion || '').toLowerCase();
      if (nombre.includes('dynamics') || desc.includes('dynamics') || (this.infoViaje as any).esDynamics) {
        return true;
      }
    }
    const items = archivos || this.paginas;
    if (items && items.length > 0) {
      return items.some((item: any) => {
        const arch = item.archivo || item;
        const n = arch.nombreArchivo || arch.nombre || item.titulo || '';
        const f = (arch.fuente || arch.origen || '').toLowerCase();
        return /^(?:recording|JPEG|VID)-\d{13}|^(?:recording|JPEG|VID)_\d{13}/.test(n) ||
               f.includes('dynamics') ||
               n.toLowerCase().includes('dynamics');
      });
    }
    return false;
  }

  /**
   * 🎬 Callback cuando la intro cinemática de 5 segundos finaliza
   */
  public onIntroDynamicsCompletada(): void {
    console.log('🎬 [IntroDynamics] Secuencia completada con el libro abierto. Abriendo páginas del álbum...');
    this.mostrarIntroDynamics = false;
    this.introDynamicsReproducida = true;

    // Transición directa al libro abierto (el libro 3D ya quedó abierto en la mesa)
    this.estado = 'abierto';
    this.abriendoPortada3D = false;
    this.modoRecuerdoActivo = true;
    this.modoGuiadoActivo = true;
    this.spreadActual = 0;
    this.paginaActual = 0;

    this.reiniciarInstanciaMapa();
    this.precargarSiguienteVideo();
    this.precargarContenidoVentana(0);
    this.iniciarSecuenciaVideosSpread();
    this.intentarReproducirAudioViaje();

    setTimeout(() => {
      if (this.reproducirEnFullscreen) {
        this.abrirPaginaActualEnFullscreen();
      }
      this.iniciarSlideshow();
    }, 150);

    this.cdr.detectChanges();
  }

  private esArchivoMultimedia(a: Archivo): boolean {
    if (!a) return false;
    const t = (a.tipo || '').toLowerCase();
    if (t === 'foto' || t === 'imagen' || t === 'video' || t === 'audio') return true;
    const ext = this.obtenerExtension(a.nombreArchivo || '').toLowerCase();
    return this.EXTENSIONES_IMAGEN.includes(ext) || this.EXTENSIONES_VIDEO.includes(ext) || this.EXTENSIONES_AUDIO.includes(ext);
  }

  private determinarTipoMedia(archivo: Archivo): TipoMedia {
    const tipoStr = (archivo.tipo as string) || '';
    if (tipoStr === 'video') {
      return 'video';
    }
    if (tipoStr === 'foto' || tipoStr === 'imagen') {
      return 'imagen';
    }
    if (tipoStr === 'audio') {
      return 'audio';
    }
    if (tipoStr === 'pdf') {
      return 'pdf';
    }

    const extension = this.obtenerExtension(archivo.nombreArchivo || '').toLowerCase();

    if (this.EXTENSIONES_VIDEO.includes(extension)) {
      return 'video';
    } else if (this.EXTENSIONES_IMAGEN.includes(extension)) {
      return 'imagen';
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

  private paginasPrecargadas = new Set<number>();

  precargarContenidoVentana(centroIndice: number): void {
    if (!this.paginas || this.paginas.length === 0) return;

    const radio = 3;
    const inicio = Math.max(0, centroIndice - 1);
    const fin = Math.min(this.paginas.length - 1, centroIndice + radio);

    for (let i = inicio; i <= fin; i++) {
      if (this.paginasPrecargadas.has(i)) continue;

      const pag = this.paginas[i];
      if (pag.tipoMedia === 'imagen' && pag.url) {
        this.paginasPrecargadas.add(i);
        this.precargarImagen(pag.url, i).catch(() => { });
      }
    }
  }

  private async precargarContenido(): Promise<void> {
    console.log('🔄 Precargando contenido multimedia en ventana...');
    this.precargarContenidoVentana(0);
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

    // Caso 1: El viaje tiene imagen de portada configurada
    if (this.infoViaje?.imagen && !this.imagenViajeError) {
      if (this.infoViaje.imagen.startsWith('http')) {
        this.imagenViajeUrlCache = this.infoViaje.imagen;
        return this.imagenViajeUrlCache;
      }

      const nombreArchivo = this.infoViaje.imagen.split(/[\\/]/).pop();
      const url = `${environment.apiUrl}/uploads/${nombreArchivo}`;
      this.imagenViajeUrlCache = url;
      return this.imagenViajeUrlCache;
    }

    // Caso 2: Fallback → usar la primera imagen real del álbum (paginas)
    if (this.paginas && this.paginas.length > 0) {
      const primeraImagen = this.paginas.find(p => p.tipoMedia === 'imagen' && p.url && !p.esIndice);
      if (primeraImagen) {
        this.imagenViajeUrlCache = primeraImagen.url;
        return this.imagenViajeUrlCache;
      }
    }

    this.imagenViajeUrlCache = null;
    return null;
  }

  // ==========================================
  // MÉTODOS DE NAVEGACIÓN DEL ÁLBUM
  // ==========================================

  abrirLibro(activarModoRecuerdo = false, modoGuiado = false): void {
    console.log('📖 Abriendo libro...');
    if (this.paginas.length === 0 || this.isLoading) {
      console.log('⏳ Álbum aún cargándose, programando apertura automática al terminar...');
      this.pendienteAbrirLibro = { activarModoRecuerdo, modoGuiado };
      return;
    }

    if (this.estado === 'portada' && this.modoAlbumVintage && !this.abriendoPortada3D) {
      this.abriendoPortada3D = true;
      this.cdr.detectChanges();

      setTimeout(() => {
        this.estado = 'abierto';
        this.abriendoPortada3D = false;
        this.modoRecuerdoActivo = activarModoRecuerdo;
        this.modoGuiadoActivo = activarModoRecuerdo ? modoGuiado : false;

        const startPag = (activarModoRecuerdo && modoGuiado) ? this.obtenerPrimeraPaginaMemoria() : 0;
        this.paginaActual = startPag;
        if (this.spreads && this.spreads.length > 0) {
          const spIdx = this.spreads.findIndex(s => s.indices?.includes(startPag));
          if (spIdx >= 0) this.spreadActual = spIdx;
        }
        this.reiniciarInstanciaMapa();
        this.precargarSiguienteVideo();
        this.precargarContenidoVentana(0);
        this.iniciarSecuenciaVideosSpread();
        if (activarModoRecuerdo) {
          this.intentarReproducirAudioViaje();
          setTimeout(() => {
            if (this.reproducirEnFullscreen) {
              this.abrirPaginaActualEnFullscreen();
            }
            this.iniciarSlideshow();
          }, 120);
        }
        this.cdr.detectChanges();
      }, 650);
      return;
    }

    this.estado = 'abierto';
    this.modoRecuerdoActivo = activarModoRecuerdo;
    this.modoGuiadoActivo = activarModoRecuerdo ? modoGuiado : false;
    const startPag = (activarModoRecuerdo && modoGuiado) ? this.obtenerPrimeraPaginaMemoria() : 0;
    this.paginaActual = startPag;
    if (this.spreads && this.spreads.length > 0) {
      const spIdx = this.spreads.findIndex(s => s.indices?.includes(startPag));
      if (spIdx >= 0) this.spreadActual = spIdx;
    }
    this.precargarSiguienteVideo();
    this.precargarContenidoVentana(0);
    this.iniciarSecuenciaVideosSpread();
    if (activarModoRecuerdo) {
      this.intentarReproducirAudioViaje();
      setTimeout(() => {
        if (this.reproducirEnFullscreen) {
          this.abrirPaginaActualEnFullscreen();
        }
        this.iniciarSlideshow();
      }, 120);
    }
    console.log('✅ Libro abierto en Spread 0 (Página 1: ITINERARIO: ESPAÑA)');
    this.cdr.detectChanges();
  }

  iniciarModoRecuerdo(event?: Event): void {
    event?.stopPropagation();
    this.abrirLibro(true, false);
  }

  iniciarGenerarRecorridoAnimado(event?: Event): void {
    event?.stopPropagation();
    console.log('📖 [Generar Recorrido] Disparado por el usuario. Tipo de intro activa:', this.tipoIntro);
    if (this.estado === 'portada') {
      if (this.tipoIntro === 'video-mp4') {
        this.abrirIntroModal();
      } else {
        this.iniciarCinematicaYApertura(true, true);
      }
    } else {
      this.iniciarModoGuiado(event);
    }
  }

  private introModalTimestampApertura = 0;

  abrirIntroModal(): void {
    console.log('🎬 [Intro] Abriendo cinemática MP4 (Estantería -> Mesa con velas -> Apertura de páginas)...');
    this.introModalTimestampApertura = Date.now();
    this.pausarMediosPliego();
    this.detenerSlideshow();
    this.cancelarSecuenciaCinematica();
    this.mostrarModalIntro = true;
    this.cdr.detectChanges();

    setTimeout(() => {
      const vIntro = document.getElementById('video-intro-modal') as HTMLVideoElement;
      console.log('🎬 [Intro] Elemento video-intro-modal en DOM:', vIntro ? 'ENCONTRADO' : 'NO ENCONTRADO');
      if (vIntro) {
        vIntro.currentTime = 0;
        vIntro.muted = this.videoMuted;
        const playPromise = vIntro.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              console.log('▶️ [Intro] Vídeo MP4 reproduciéndose con éxito');
            })
            .catch(e => {
              console.warn('⚠️ [Intro] Auto-play vídeo intro bloqueado con sonido, reintentando silenciado:', e);
              vIntro.muted = true;
              vIntro.play().catch(err => console.error('❌ [Intro] No se pudo reproducir intro:', err));
            });
        }
      }
    }, 100);
  }

  onIntroOverlayClick(event: MouseEvent): void {
    if (Date.now() - this.introModalTimestampApertura < 450) {
      console.log('🛡️ [Intro] Click residual ignorado');
      return;
    }
    const target = event.target as HTMLElement;
    if (target?.classList?.contains('modal-intro-overlay')) {
      console.log('👆 [Intro] Click en fondo oscuro overlay: cerrando');
      this.cerrarIntroModal();
    }
  }

  cerrarIntroModal(): void {
    console.log('❌ [Intro] Cerrando modal de intro');
    const vIntro = document.getElementById('video-intro-modal') as HTMLVideoElement;
    if (vIntro) {
      try { vIntro.pause(); } catch (e) {}
    }
    this.mostrarModalIntro = false;
    this.cdr.detectChanges();
  }

  onIntroVideoEnded(): void {
    console.log('🎬 [Intro] Vídeo de intro completado. Apertura fluida al libro...');
    this.abrirLibroDesdeIntroVideo();
  }

  abrirLibroDesdeIntroVideo(): void {
    this.cerrarIntroModal();
    // Apertura del libro exactamente igual que al finalizar IntroDynamics
    this.onIntroDynamicsCompletada();
  }

  iniciarCinematicaYApertura(activarModoRecuerdo: boolean = true, modoGuiado: boolean = true): void {
    console.log('🎬 [AlbumLibro] Iniciando cinemática 3D Dynamics (libro cae a la mesa, se abre, fotos vuelan y vuelven)...');
    this.mostrarIntroDynamics = true;
    this.cdr.detectChanges();
  }

  iniciarModoGuiado(event?: Event): void {
    event?.stopPropagation();
    if (this.estado === 'portada') {
      this.iniciarGenerarRecorridoAnimado(event);
      return;
    }
    this.modoGuiadoActivo = true;
    this.modoRecuerdoActivo = true;
    this.intentarReproducirAudioViaje();
    if (this.paginaActualData?.esIndice) {
      this.paginaActual = this.obtenerPrimeraPaginaMemoria();
    }
    if (this.reproducirEnFullscreen) {
      this.abrirPaginaActualEnFullscreen();
    }
    this.iniciarSlideshow();
  }

  toggleModoRecuerdo(event?: Event): void {
    event?.stopPropagation();

    if (this.estado === 'portada') {
      this.iniciarGenerarRecorridoAnimado(event);
      return;
    }

    if (this.modoRecuerdoActivo && !this.modoGuiadoActivo) {
      this.modoRecuerdoActivo = false;
      this.detenerSlideshow();
      return;
    }

    this.modoGuiadoActivo = false;
    this.modoRecuerdoActivo = true;
    this.intentarReproducirAudioViaje();

    if (this.paginaActualData?.esIndice) {
      this.paginaActual = this.obtenerPrimeraPaginaMemoria();
    }
    this.precargarSiguienteVideo();

    if (this.reproducirEnFullscreen) {
      this.abrirPaginaActualEnFullscreen();
    }
    this.iniciarSlideshow();
  }

  toggleModoGuiado(event?: Event): void {
    event?.stopPropagation();

    if (this.estado === 'portada') {
      this.abrirLibro(true, true);
      return;
    }

    if (this.modoRecuerdoActivo && this.modoGuiadoActivo) {
      this.modoRecuerdoActivo = false;
      this.modoGuiadoActivo = false;
      this.detenerSlideshow();
      return;
    }

    this.modoGuiadoActivo = true;
    this.modoRecuerdoActivo = true;
    this.intentarReproducirAudioViaje();

    if (this.paginaActualData?.esIndice) {
      this.paginaActual = this.obtenerPrimeraPaginaMemoria();
    }
    this.precargarSiguienteVideo();

    if (this.reproducirEnFullscreen) {
      this.abrirPaginaActualEnFullscreen();
    }
    this.iniciarSlideshow();
  }

  private obtenerPrimeraPaginaMemoria(): number {
    const index = this.paginas.findIndex(pagina => !pagina.esIndice);
    return index >= 0 ? index : 0;
  }

  abrirPaginaActualEnFullscreen(): void {
    const pagina = this.paginaSpreadDerecha || this.paginaSpreadIzquierda || this.paginaActualData;
    if (!pagina || pagina.esIndice) return;

    if (pagina.esCartaManuscrita) {
      this.abrirFullscreen('', 'carta-manuscrita', {
        titulo: pagina.titulo,
        descripcion: pagina.descripcion
      });
      return;
    }

    if (pagina.esMapaAnimado) {
      this.abrirFullscreen('', 'mapa-animado', {
        titulo: pagina.titulo,
        descripcion: pagina.descripcion
      });
      return;
    }

    this.abrirFullscreen(pagina.url || '', pagina.tipoMedia);
  }

  cambiarPagina(direccion: number): void {
    this.forzarMapaInteractivo = false;
    this.cargandoMapaInteractivo = false;
    console.log(`🔄 Cambiando pliego (spread), dirección: ${direccion}`);

    // Si estamos en modo clásico (página simple por página)
    if (!this.modoAlbumVintage) {
      const nuevaPag = this.paginaActual + direccion;
      if (nuevaPag >= 0 && nuevaPag < this.paginas.length) {
        this.paginaActual = nuevaPag;
        if (this.spreads && this.spreads.length > 0) {
          const spIdx = this.spreads.findIndex(s => s.indices?.includes(nuevaPag));
          if (spIdx >= 0) this.spreadActual = spIdx;
        }
        this.reiniciarInstanciaMapa();
        this.iniciarSecuenciaVideosSpread();
        this.verificarSincronizacionAudioItinerario();
        this.centrarMiniaturaActiva(this.paginaActual);
        this.precargarSiguienteVideo();
        if (this.reproduciendoSlideshow) {
          if (this.modoZoomCinematico) {
            this.limpiarTimerSlideshow();
          } else {
            const currentPag = this.paginas[this.paginaActual];
            const tieneMediaInteractivo = currentPag?.tipoMedia === 'video' || currentPag?.tipoMedia === 'audio';
            const tieneMapa = currentPag?.esMapaAnimado && !this.modoRutaImagen;
            if (!tieneMediaInteractivo && !tieneMapa) {
              this.reiniciarTimerSlideshow();
            } else {
              this.limpiarTimerSlideshow();
              if (this.timerFallbackMapa) { clearTimeout(this.timerFallbackMapa); this.timerFallbackMapa = null; }
            }
          }
        }
        this.cdr.detectChanges();
      }
      return;
    }

    if (this.spreads.length === 0 && this.paginas && this.paginas.length > 0) {
      this.construirSpreads();
    }
    const nuevoSpread = this.spreadActual + direccion;

    if (nuevoSpread >= 0 && nuevoSpread < this.totalSpreads) {
      const spreadDestino = this.spreads[nuevoSpread];
      const nuevaPaginaIdx = spreadDestino?.indices[0] ?? 0;

      if (this.modoAlbumVintage && !this.hojaVolteando3D) {
        this.direccionVolteo3D = direccion > 0 ? 'adelante' : 'atras';

        if (direccion > 0) {
          this.paginaVolteoSaliente = this.paginaSpreadDerecha;
          this.paginaVolteoEntrante = spreadDestino?.paginaIzquierda || null;
          this.paginaDebajoIzquierda = this.paginaSpreadIzquierda; // Mantener la página izquierda actual visible abajo
          this.paginaDebajoDerecha = spreadDestino?.paginaDerecha || null; // Revelar debajo de la hoja que se levanta la nueva derecha
        } else {
          this.paginaVolteoSaliente = this.paginaSpreadIzquierda;
          this.paginaVolteoEntrante = spreadDestino?.paginaDerecha || null;
          this.paginaDebajoIzquierda = spreadDestino?.paginaIzquierda || null; // Revelar debajo la nueva izquierda
          this.paginaDebajoDerecha = this.paginaSpreadDerecha; // Mantener la derecha actual visible abajo
        }

        this.hojaVolteando3D = true;
        this.detenerVideosActuales();
        this.cdr.detectChanges();

        setTimeout(() => {
          this.spreadActual = nuevoSpread;
          this.paginaActual = nuevaPaginaIdx;
          this.hojaVolteando3D = false;
          this.paginaVolteoSaliente = null;
          this.paginaVolteoEntrante = null;
          this.paginaDebajoIzquierda = null;
          this.paginaDebajoDerecha = null;

          this.reiniciarInstanciaMapa();

          // Iniciar secuencia de reproducción de video en el nuevo spread (Regla 3)
          this.iniciarSecuenciaVideosSpread();

          this.verificarSincronizacionAudioItinerario();
          this.centrarMiniaturaActiva(this.paginaActual);
          this.precargarSiguienteVideo();
          this.precargarContenidoVentana(this.paginaActual);

          if (this.reproduciendoSlideshow) {
            if (this.modoZoomCinematico) {
              this.limpiarTimerSlideshow();
            } else {
              const tieneMediaInteractivo = (
                this.paginaSpreadIzquierda?.tipoMedia === 'video' ||
                this.paginaSpreadIzquierda?.tipoMedia === 'audio' ||
                this.paginaSpreadDerecha?.tipoMedia === 'video' ||
                this.paginaSpreadDerecha?.tipoMedia === 'audio'
              );
              const esMapaEstructural = this.spreadActualData?.paginaMapa?.esMapaGeneral || this.spreadActualData?.paginaMapa?.esMapaItinerario;
              const tieneMapa = this.spreadActualData?.tipo === 'mapa' && !this.modoRutaImagen && !esMapaEstructural;
              if (!tieneMediaInteractivo && !tieneMapa) {
                this.reiniciarTimerSlideshow();
              } else {
                this.limpiarTimerSlideshow();
              }
            }
          }

          this.cdr.detectChanges();
        }, 600);
      } else {
        this.spreadActual = nuevoSpread;
        this.paginaActual = nuevaPaginaIdx;
        this.reiniciarInstanciaMapa();
        this.iniciarSecuenciaVideosSpread();
        this.verificarSincronizacionAudioItinerario();
        this.centrarMiniaturaActiva(this.paginaActual);
        this.precargarSiguienteVideo();
        if (this.reproduciendoSlideshow) {
          if (this.modoZoomCinematico) {
            this.limpiarTimerSlideshow();
          } else {
            const tieneMediaInteractivo = (
              this.paginaSpreadIzquierda?.tipoMedia === 'video' ||
              this.paginaSpreadIzquierda?.tipoMedia === 'audio' ||
              this.paginaSpreadDerecha?.tipoMedia === 'video' ||
              this.paginaSpreadDerecha?.tipoMedia === 'audio'
            );
            const esMapaEstructural = this.spreadActualData?.paginaMapa?.esMapaGeneral || this.spreadActualData?.paginaMapa?.esMapaItinerario;
            const tieneMapa = this.spreadActualData?.tipo === 'mapa' && !this.modoRutaImagen && !esMapaEstructural;
            if (!tieneMediaInteractivo && !tieneMapa) {
              this.reiniciarTimerSlideshow();
            } else {
              this.limpiarTimerSlideshow();
            }
          }
        }
        this.cdr.detectChanges();
      }
    }
  }

  cerrarLibro(): void {
    console.log('📕 Cerrando libro...');
    this.detenerVideosActuales();
    this.estado = 'portada';
    this.spreadActual = 0;
    this.paginaActual = 0;
  }

  irAPagina(index: number): void {
    if (index >= 0 && index < this.paginas.length) {
      if (this.spreads.length === 0 && this.paginas && this.paginas.length > 0) {
        this.construirSpreads();
      }
      const targetSpread = this.spreads.findIndex(s => s.indices.includes(index));
      const spreadIdx = targetSpread >= 0 ? targetSpread : 0;

      if (spreadIdx !== this.spreadActual || index !== this.paginaActual) {
        this.detenerVideosActuales();
        this.spreadActual = spreadIdx;
        this.paginaActual = index;
        this.reiniciarInstanciaMapa();
        this.precargarContenidoVentana(this.paginaActual);
      }
      const pagina = this.paginas[this.paginaActual];
      if (pagina?.tipoMedia === 'video') {
        this.bajarVolumenAudioViaje();
      } else {
        this.restaurarVolumenAudioViaje();
      }
      this.centrarMiniaturaActiva(index);
      this.cdr.detectChanges();
    }
  }

  toggleMuteVideos(event?: Event): void {
    event?.stopPropagation();
    this.videoMuted = !this.videoMuted;
    console.log('🔊 [Sonido Vídeos] Conmutado a:', this.videoMuted ? 'SILENCIADO' : 'ABIERTO / CON SONIDO');

    const vIzq = document.getElementById('video-spread-izq') as HTMLVideoElement;
    const vDer = document.getElementById('video-spread-der') as HTMLVideoElement;
    const vSingle = document.getElementById('video-single-page') as HTMLVideoElement;
    if (vIzq) vIzq.muted = this.videoMuted;
    if (vDer) vDer.muted = this.videoMuted;
    if (vSingle) vSingle.muted = this.videoMuted;

    const algunVideoSonando =
      (vIzq && !vIzq.paused && !vIzq.ended) ||
      (vDer && !vDer.paused && !vDer.ended) ||
      (vSingle && !vSingle.paused && !vSingle.ended);

    if (this.videoMuted) {
      this.restaurarVolumenAudioViaje();
    } else if (algunVideoSonando) {
      this.bajarVolumenAudioViaje();
    }
    this.cdr.detectChanges();
  }

  onVideoSpreadPlay(origen: 'izq' | 'der' | 'single'): void {
    if (!this.videoMuted) {
      this.bajarVolumenAudioViaje();
    }
  }

  onVideoSpreadPause(origen: 'izq' | 'der' | 'single'): void {
    const vIzq = document.getElementById('video-spread-izq') as HTMLVideoElement;
    const vDer = document.getElementById('video-spread-der') as HTMLVideoElement;
    const vSingle = document.getElementById('video-single-page') as HTMLVideoElement;

    const otroVideoReproduciendo =
      (origen !== 'izq' && vIzq && !vIzq.paused && !vIzq.ended) ||
      (origen !== 'der' && vDer && !vDer.paused && !vDer.ended) ||
      (origen !== 'single' && vSingle && !vSingle.paused && !vSingle.ended);

    if (!otroVideoReproduciendo) {
      this.restaurarVolumenAudioViaje();
    }
  }

  private timerFallbackMedia: any = null;

  private reproducirMediaSeguro(media: HTMLMediaElement, lado?: 'izq' | 'der'): void {
    if (!media) return;
    media.play().catch(err => {
      if (err && err.name === 'NotAllowedError' && media instanceof HTMLVideoElement && !this.videoMuted) {
        console.warn('⚠️ Autoplay con sonido bloqueado por política del navegador; reproduciendo vídeo silenciado como fallback');
        media.muted = true;
        media.play().catch(e => {
          console.warn('Error autoplay fallback:', e);
          this.avanzarMediaFallback(lado);
        });
      } else {
        console.warn('⚠️ No se pudo reproducir medio interactivo:', err);
        this.avanzarMediaFallback(lado);
      }
    });
  }

  private avanzarMediaFallback(lado?: 'izq' | 'der'): void {
    if (!this.reproduciendoSlideshow) return;
    if (this.timerFallbackMedia) clearTimeout(this.timerFallbackMedia);
    this.timerFallbackMedia = setTimeout(() => {
      if (this.reproduciendoSlideshow) {
        console.log('⏭️ [Fallback Media] Avanzando tras timeout por medio bloqueado o no reproducible');
        if (lado === 'izq' || this.videoActualSecuencia === 'izq') {
          this.onVideoIzquierdoTerminado();
        } else if (lado === 'der' || this.videoActualSecuencia === 'der') {
          this.onVideoDerechoTerminado();
        }
      }
    }, 4000);
  }

  /**
   * Determina si una página es un vídeo o animación de ruta (mapa con avatar en movimiento).
   * Por directriz de diseño, los vídeos de animación de ruta SIEMPRE se reproducen completos
   * de principio a fin, independientemente de que reproducirVideosCompletos esté activo o no.
   */
  esVideoAnimacionRuta(pag?: PaginaMedia | null): boolean {
    if (!pag) return false;
    return !!(pag.esMapaAnimado || pag.urlVideoAnimacion || pag.trackGpx);
  }

  iniciarSecuenciaVideosSpread(): void {
    this.detenerVideosActuales();

    // 🛡️ Gestión de reproducción para pliegos de tipo mapa
    if (this.spreadActualData?.tipo === 'mapa') {
      const pagMapa = this.spreadActualData.paginaMapa;
      if (this.timerFallbackMapa) clearTimeout(this.timerFallbackMapa);

      // Si existe un vídeo pre-renderizado MP4, la reproducción está gobernada por el evento nativo (ended)
      // del elemento <video>, que se dispara SOLO tras concluir todo el viaje y el hold en destino B.
      // NO ejecutamos ningún temporizador prematuro que interrumpa el viaje del avatar.
      if (pagMapa?.urlVideoAnimacion && !this.forzarMapaInteractivo) {
        console.log('🎥 [Reproducción Mapa MP4] Reproduciendo ruta completa hasta destino B. Esperando evento nativo (ended)...');
        // Watchdog de emergencia largo (90s) ÚNICAMENTE por si el vídeo fallase en cargar o decodificar en el dispositivo
        this.timerFallbackMapa = setTimeout(() => {
          console.warn('⏱️ [Emergencia Mapa MP4] Timeout de seguridad de 90s alcanzado; verificando estado');
          this.onFinAnimacionMapa();
        }, 90000);
        return;
      }

      // Si es mapa interactivo Leaflet o animación GPX vectorial basada en código:
      const dist = pagMapa?.distanciaTramoKm || 0.5;
      const durSeg = this.routeVideoGeneratorService.calcularDuracionDinamica(dist);
      const tiempoEsperaMs = Math.max(9000, (durSeg + 4.0) * 1000);
      this.timerFallbackMapa = setTimeout(() => {
        console.log('⏱️ [Watchdog Mapa Interactivo] Tiempo de animación cumplido; avanzando');
        this.onFinAnimacionMapa();
      }, tiempoEsperaMs);
      return;
    }

    // 🎬 SI MODO ZOOM CINEMÁTICO ESTÁ ACTIVO Y EL SLIDESHOW / MODO RECUERDO ESTÁ CORRIENDO:
    if (this.modoZoomCinematico && this.reproduciendoSlideshow) {
      this.limpiarTimerSlideshow();
      this.ejecutarSecuenciaCinematicaSpread();
      return;
    }

    setTimeout(() => {
      const vIzq = document.getElementById('video-spread-izq') as HTMLVideoElement;
      const vDer = document.getElementById('video-spread-der') as HTMLVideoElement;
      const aIzq = document.getElementById('audio-spread-izq') as HTMLAudioElement;
      const aDer = document.getElementById('audio-spread-der') as HTMLAudioElement;

      // Detectar si la página izquierda o derecha tiene medio interactivo (vídeo o audio)
      const tieneMediaIzq = (this.paginaSpreadIzquierda?.tipoMedia === 'video' && !!vIzq) ||
        (this.paginaSpreadIzquierda?.tipoMedia === 'audio' && !!aIzq);
      const tieneMediaDer = (this.paginaSpreadDerecha?.tipoMedia === 'video' && !!vDer) ||
        (this.paginaSpreadDerecha?.tipoMedia === 'audio' && !!aDer);

      const elMediaIzq: HTMLMediaElement | null = this.paginaSpreadIzquierda?.tipoMedia === 'video' ? vIzq : (this.paginaSpreadIzquierda?.tipoMedia === 'audio' ? aIzq : null);
      const elMediaDer: HTMLMediaElement | null = this.paginaSpreadDerecha?.tipoMedia === 'video' ? vDer : (this.paginaSpreadDerecha?.tipoMedia === 'audio' ? aDer : null);

      console.log('🎬 [Secuencia Medios] Spread:', this.spreadActual, '| Media Izq:', tieneMediaIzq, '| Media Der:', tieneMediaDer, '| Medios Completos:', this.reproducirVideosCompletos);

      if (!tieneMediaIzq && !tieneMediaDer) {
        this.videoActualSecuencia = null;
        return;
      }

      // Preparar medios: pausar y reiniciar
      if (elMediaIzq) {
        try { elMediaIzq.pause(); } catch (e) { }
        elMediaIzq.currentTime = 0;
        if (elMediaIzq instanceof HTMLVideoElement) {
          elMediaIzq.muted = this.videoMuted;
        }
      }
      if (elMediaDer) {
        try { elMediaDer.pause(); } catch (e) { }
        elMediaDer.currentTime = 0;
        if (elMediaDer instanceof HTMLVideoElement) {
          elMediaDer.muted = this.videoMuted;
        }
      }

      const esAnimacionIzq = this.esVideoAnimacionRuta(this.paginaSpreadIzquierda);
      const esAnimacionDer = this.esVideoAnimacionRuta(this.paginaSpreadDerecha);

      // =========================================================================
      // REGLA CRÍTICA DE REPRODUCCIÓN SECUENCIAL:
      // Cuando existen dos medios (izq y der), SIEMPRE se reproduce PRIMERO el de
      // la izquierda y DESPUÉS el de la derecha. NUNCA a la vez.
      // 🌟 VÍDEOS DE ANIMACIÓN DE RUTA: SIEMPRE se reproducen completos hasta terminar.
      // 🌟 VÍDEOS/AUDIOS DE USUARIO: respetan reproducirVideosCompletos (preview 5s si false).
      // =========================================================================
      if (tieneMediaIzq && elMediaIzq) {
        this.videoActualSecuencia = 'izq';
        console.log(`▶️ [Secuencia Medios 1/2] Reproduciendo PRIMERO medio izquierdo (esAnimacion: ${esAnimacionIzq})...`);
        this.reproducirMediaSeguro(elMediaIzq, 'izq');
        this.bajarVolumenAudioViaje();

        if (!this.reproducirVideosCompletos && !esAnimacionIzq) {
          this.timerVideoPreview = setTimeout(() => {
            console.log('⏱️ [Secuencia Medios] Fin de preview (5s) para medio izquierdo de usuario');
            try { elMediaIzq.pause(); } catch (e) { }
            this.onVideoIzquierdoTerminado();
          }, this.INTERVALO_SLIDESHOW);
        }
      } else if (tieneMediaDer && elMediaDer) {
        this.videoActualSecuencia = 'der';
        console.log(`▶️ [Secuencia Medios] Solo hay medio derecho, reproduciendo (esAnimacion: ${esAnimacionDer})...`);
        this.reproducirMediaSeguro(elMediaDer, 'der');
        this.bajarVolumenAudioViaje();

        if (!this.reproducirVideosCompletos && !esAnimacionDer) {
          this.timerVideoPreview = setTimeout(() => {
            console.log('⏱️ [Secuencia Medios] Fin de preview (5s) para medio derecho de usuario');
            try { elMediaDer.pause(); } catch (e) { }
            this.onVideoDerechoTerminado();
          }, this.INTERVALO_SLIDESHOW);
        }
      }
    }, 200);
  }

  onVideoIzquierdoTerminado(): void {
    console.log('⏹️ [Secuencia Medios] Medio izquierdo completado');
    if (this.timerVideoPreview) {
      clearTimeout(this.timerVideoPreview);
      this.timerVideoPreview = null;
    }
    if (this.timerFallbackMedia) {
      clearTimeout(this.timerFallbackMedia);
      this.timerFallbackMedia = null;
    }
    if (this.timerFallbackMapa) {
      clearTimeout(this.timerFallbackMapa);
      this.timerFallbackMapa = null;
    }

    const vIzq = document.getElementById('video-spread-izq') as HTMLVideoElement;
    const aIzq = document.getElementById('audio-spread-izq') as HTMLAudioElement;
    if (vIzq) try { vIzq.pause(); } catch (e) { }
    if (aIzq) try { aIzq.pause(); } catch (e) { }

    const vDer = document.getElementById('video-spread-der') as HTMLVideoElement;
    const aDer = document.getElementById('audio-spread-der') as HTMLAudioElement;
    const tieneMediaDer = (this.paginaSpreadDerecha?.tipoMedia === 'video' && !!vDer) ||
      (this.paginaSpreadDerecha?.tipoMedia === 'audio' && !!aDer);
    const elMediaDer: HTMLMediaElement | null = this.paginaSpreadDerecha?.tipoMedia === 'video' ? vDer : (this.paginaSpreadDerecha?.tipoMedia === 'audio' ? aDer : null);

    if (tieneMediaDer && elMediaDer) {
      // REGLA CRÍTICA: Al terminar el de la izquierda, se reproduce el de la derecha
      this.videoActualSecuencia = 'der';
      const esAnimacionDer = this.esVideoAnimacionRuta(this.paginaSpreadDerecha);
      console.log(`▶️ [Secuencia Medios 2/2] Transición secuencial: reproduciendo medio derecho (esAnimacion: ${esAnimacionDer})...`);
      elMediaDer.currentTime = 0;
      if (elMediaDer instanceof HTMLVideoElement) {
        elMediaDer.muted = this.videoMuted;
      }
      this.reproducirMediaSeguro(elMediaDer, 'der');
      this.bajarVolumenAudioViaje();

      if (!this.reproducirVideosCompletos && !esAnimacionDer) {
        this.timerVideoPreview = setTimeout(() => {
          console.log('⏱️ [Secuencia Medios] Fin de preview (5s) para medio derecho de usuario');
          try { elMediaDer.pause(); } catch (e) { }
          this.onVideoDerechoTerminado();
        }, this.INTERVALO_SLIDESHOW);
      }
    } else {
      // Solo había medio izquierdo y ha finalizado
      this.videoActualSecuencia = null;
      this.restaurarVolumenAudioViaje();
      if (this.reproduciendoSlideshow) {
        setTimeout(() => {
          if (this.reproduciendoSlideshow) {
            this.cambiarPagina(1);
          }
        }, 600);
      }
    }
  }

  onVideoDerechoTerminado(): void {
    console.log('⏹️ [Secuencia Medios] Medio derecho completado');
    if (this.timerVideoPreview) {
      clearTimeout(this.timerVideoPreview);
      this.timerVideoPreview = null;
    }
    if (this.timerFallbackMedia) {
      clearTimeout(this.timerFallbackMedia);
      this.timerFallbackMedia = null;
    }

    const vDer = document.getElementById('video-spread-der') as HTMLVideoElement;
    const aDer = document.getElementById('audio-spread-der') as HTMLAudioElement;
    if (vDer) try { vDer.pause(); } catch (e) { }
    if (aDer) try { aDer.pause(); } catch (e) { }

    this.videoActualSecuencia = null;
    this.restaurarVolumenAudioViaje();

    if (this.reproduciendoSlideshow) {
      setTimeout(() => {
        if (this.reproduciendoSlideshow) {
          this.cambiarPagina(1);
        }
      }, 600);
    }
  }

  detenerVideosActuales(): void {
    if (this.timerVideoPreview) {
      clearTimeout(this.timerVideoPreview);
      this.timerVideoPreview = null;
    }
    if (this.timerFallbackMedia) {
      clearTimeout(this.timerFallbackMedia);
      this.timerFallbackMedia = null;
    }
    this.videoActualSecuencia = null;
    const vIzq = document.getElementById('video-spread-izq') as HTMLVideoElement;
    const vDer = document.getElementById('video-spread-der') as HTMLVideoElement;
    const vSingle = document.getElementById('video-single-page') as HTMLVideoElement;
    const aIzq = document.getElementById('audio-spread-izq') as HTMLAudioElement;
    const aDer = document.getElementById('audio-spread-der') as HTMLAudioElement;
    const aSingle = document.getElementById('audio-single-page') as HTMLAudioElement;
    if (vIzq) try { vIzq.pause(); } catch (e) { }
    if (vDer) try { vDer.pause(); } catch (e) { }
    if (vSingle) try { vSingle.pause(); } catch (e) { }
    if (aIzq) try { aIzq.pause(); } catch (e) { }
    if (aDer) try { aDer.pause(); } catch (e) { }
    if (aSingle) try { aSingle.pause(); } catch (e) { }
    this.restaurarVolumenAudioViaje();
  }

  centrarMiniaturaActiva(index: number): void {
    setTimeout(() => {
      const el = document.getElementById(`thumb-item-${index}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }, 50);
  }

  desplazarCarrusel(direccion: -1 | 1): void {
    const contenedor = document.querySelector('.indicadores-container') as HTMLElement;
    if (contenedor) {
      const offset = 280 * direccion;
      contenedor.scrollBy({ left: offset, behavior: 'smooth' });
    }
  }

  onCarruselWheel(event: WheelEvent): void {
    const contenedor = document.querySelector('.indicadores-container') as HTMLElement;
    if (contenedor && event.deltaY !== 0) {
      event.preventDefault();
      contenedor.scrollLeft += event.deltaY;
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

    if (this.modoAlbumVintage) {
      this.reiniciarInstanciaMapa();
      setTimeout(() => {
        this.iniciarSecuenciaVideosSpread();
        this.cdr.detectChanges();
      }, 100);
    }

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

    if (this.modoZoomCinematico) {
      console.log('🎬 Modo Zoom Cinemático activo: delegando secuencia en ejecutarSecuenciaCinematicaSpread()');
      this.limpiarTimerSlideshow();
      this.iniciarSecuenciaVideosSpread();
      return;
    }

    const currentPag = this.paginas[this.paginaActual];
    const esAnimacion = this.esVideoAnimacionRuta(currentPag) ||
      this.esVideoAnimacionRuta(this.paginaSpreadIzquierda) ||
      this.esVideoAnimacionRuta(this.paginaSpreadDerecha);
    const tieneMediaInteractivo = (currentPag?.tipoMedia === 'video' || currentPag?.tipoMedia === 'audio') && this.reproducirVideosCompletos;
    const esMapaEstructural = currentPag?.esMapaGeneral || currentPag?.esMapaItinerario ||
      this.spreadActualData?.paginaMapa?.esMapaGeneral || this.spreadActualData?.paginaMapa?.esMapaItinerario;
    const tieneMapa = (currentPag?.esMapaAnimado || this.spreadActualData?.tipo === 'mapa') && !this.modoRutaImagen && !esMapaEstructural;

    if (esAnimacion || tieneMapa) {
      console.log('🗺️ Página inicial del slideshow es animación/mapa de ruta: pausando timer hasta completar');
      this.limpiarTimerSlideshow();
    } else if (tieneMediaInteractivo) {
      console.log('🎬 Página inicial del slideshow es vídeo o audio con reproducción completa: pausando timer de 5s hasta que finalice');
      this.limpiarTimerSlideshow();
    } else {
      this.reiniciarTimerSlideshow();
    }
  }

  private limpiarTimerSlideshow(): void {
    if (this.timerSlideshow) {
      clearInterval(this.timerSlideshow);
      this.timerSlideshow = null;
    }
  }

  private reiniciarTimerSlideshow(): void {
    this.limpiarTimerSlideshow();
    if (this.reproduciendoSlideshow) {
      this.timerSlideshow = setInterval(() => {
        this.ngZone.run(() => {
          this.avanzarSlideshow();
        });
      }, this.INTERVALO_SLIDESHOW);
    }
  }

  private detenerSlideshow(): void {
    console.log('⏸️ Deteniendo slideshow...');
    this.reproduciendoSlideshow = false;
    this.modoRecuerdoActivo = false;
    this.cancelarSecuenciaCinematica();
    this.limpiarTimerSlideshow();
    if (this.audioViaje) {
      this.audioViaje.pause();
    }
  }

  private avanzarSlideshow(): void {
    if (!this.reproduciendoSlideshow) {
      this.detenerSlideshow();
      return;
    }

    if (this.modoAlbumVintage) {
      if (this.mostrarFullscreen && this.fullscreenSinglePageMode) {
        if (this.hayPaginaSiguiente) {
          this.navegarSinglePage(1);
          this.cdr.detectChanges();
        } else {
          console.log('🏁 Fin del álbum alcanzado en slideshow');
          this.detenerSlideshow();
        }
        return;
      }

      const siguienteSpread = this.spreadActual + 1;
      if (siguienteSpread < this.totalSpreads) {
        this.cambiarPagina(1);
        this.cdr.detectChanges();
      } else {
        console.log('🏁 Fin del álbum alcanzado en slideshow: mostrando Outro Estantería de los Recuerdos');
        this.detenerSlideshow();
        this.mostrarOutroEstanteriaRecuerdos();
      }
      return;
    }

    const SIGUIENTE_PAGINA = this.paginaActual + 1;

    if (SIGUIENTE_PAGINA < this.paginas.length) {
      // Elegir transición aleatoria
      this.transicionActual = this.TRANSICIONES[Math.floor(Math.random() * this.TRANSICIONES.length)];

      if (this.mostrarFullscreen) {
        this.navegarEnFullscreen(1);
      } else {
        this.cambiarPagina(1);
      }
      this.cdr.detectChanges();
    } else {
      console.log('🏁 Fin del álbum alcanzado en slideshow');
      this.detenerSlideshow();
    }
  }

  cerrarFullscreen(): void {
    console.log('❌ Cerrando pantalla completa');
    this.detenerVideosActuales(); // Detener cualquier vídeo que estuviese reproduciéndose
    this.detenerSlideshow(); // Detener si estaba activo
    this.mostrarFullscreen = false;
    this.fullscreenSinglePageMode = false;
    this.paginaSinglePageActual = null;
    this.tipoFullscreen = 'imagen';
    this.fullscreenTitulo = '';
    this.fullscreenDescripcion = '';
    this.hojaVolteando3D = false;
    document.body.style.overflow = '';
    if (this.modoAlbumVintage) {
      this.reiniciarInstanciaMapa();
      setTimeout(() => {
        this.iniciarSecuenciaVideosSpread();
        this.cdr.detectChanges();
      }, 100);
    }
    this.cdr.detectChanges();
  }

  navegarEnFullscreen(direccion: number): void {
    if (this.modoAlbumVintage) {
      if (this.fullscreenSinglePageMode) {
        this.navegarSinglePage(direccion);
        return;
      }
      this.cambiarPagina(direccion);
      return;
    }

    console.log(`🖼️ Navegando en fullscreen, dirección: ${direccion}`);
    const nuevaPagina = this.paginaActual + direccion;
    if (nuevaPagina >= 0 && nuevaPagina < this.paginas.length && !this.paginas[nuevaPagina].esIndice) {
      if (this.modoAlbumVintage && !this.hojaVolteando3D) {
        this.paginaVolteoSaliente = this.paginas[this.paginaActual];
        this.paginaVolteoEntrante = this.paginas[nuevaPagina];
        this.direccionVolteo3D = direccion > 0 ? 'adelante' : 'atras';
        this.hojaVolteando3D = true;

        setTimeout(() => {
          this.hojaVolteando3D = false;
          this.cdr.detectChanges();
        }, 750);
      }

      this.paginaActual = nuevaPagina;
      if (this.fullscreenSinglePageMode) {
        this.paginaSinglePageActual = this.paginas[this.paginaActual];
      }
      if (this.spreads && this.spreads.length > 0) {
        const spIdx = this.spreads.findIndex(s => s.indices?.includes(this.paginaActual));
        if (spIdx >= 0) {
          this.spreadActual = spIdx;
        }
      }
      const paginaActual = this.paginas[this.paginaActual];

      if (paginaActual?.tipoMedia === 'video' || paginaActual?.tipoMedia === 'audio') {
        this.bajarVolumenAudioViaje();
      } else {
        this.restaurarVolumenAudioViaje();
      }
      this.verificarSincronizacionAudioItinerario();

      if (paginaActual.esCartaManuscrita) {
        this.tipoFullscreen = 'carta-manuscrita';
        this.mediaFullscreen = '';
        this.fullscreenTitulo = paginaActual.titulo;
        this.fullscreenDescripcion = paginaActual.descripcion;
      } else if (paginaActual.esMapaAnimado) {
        this.tipoFullscreen = 'mapa-animado';
        this.mediaFullscreen = '';
        this.fullscreenTitulo = paginaActual.titulo;
        this.fullscreenDescripcion = paginaActual.descripcion;
      } else {
        this.mediaFullscreen = paginaActual.url;
        this.tipoFullscreen = paginaActual.tipoMedia;
        this.fullscreenTitulo = '';
        this.fullscreenDescripcion = '';
      }

      this.centrarMiniaturaActiva(this.paginaActual);
      this.precargarSiguienteVideo();

      // Control inteligente del timer de slideshow según la diapositiva entrante
      if (this.reproduciendoSlideshow) {
        const esAnimacion = this.esVideoAnimacionRuta(paginaActual);
        if (esAnimacion || (paginaActual?.esMapaAnimado && !this.modoRutaImagen)) {
          console.log('🗺️ Slideshow navegó a animación/mapa de ruta: reproduciendo completa hasta el final');
          this.limpiarTimerSlideshow();
        } else if ((paginaActual?.tipoMedia === 'video' || paginaActual?.tipoMedia === 'audio') && this.reproducirVideosCompletos) {
          console.log('🎬 Slideshow navegó a medio con reproducción completa: pausando timer de 5s');
          this.limpiarTimerSlideshow();
        } else {
          this.reiniciarTimerSlideshow();
        }
      }
      this.cdr.detectChanges();
    } else if (nuevaPagina >= this.paginas.length) {
      console.log('🏁 Fin del álbum alcanzado');
      this.detenerSlideshow();
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
    if (!pagina) return '';
    if (pagina.esIndice) return 'Índice';
    if (pagina.esCartaManuscrita) return 'Descripción del Viaje';

    const fecha = pagina.fecha || pagina.fechaOriginal || this.infoViaje?.fechaInicio;
    if (!fecha) return 'Sin fecha';

    try {
      const fechaObj = new Date(fecha);
      if (isNaN(fechaObj.getTime())) {
        return 'Sin fecha';
      }
      const fechaFormateada = fechaObj.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });

      let horaFormateada = '';
      if (pagina.archivo?.horaCaptura && pagina.archivo.horaCaptura !== '00:00:00') {
        horaFormateada = pagina.archivo.horaCaptura.substring(0, 5);
      } else if (pagina.horaFormateada) {
        horaFormateada = pagina.horaFormateada;
      } else if (fecha.includes('T')) {
        if (fechaObj.getUTCHours() !== 0 || fechaObj.getUTCMinutes() !== 0) {
          horaFormateada = fechaObj.toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          });
        }
      }

      return horaFormateada ? `${fechaFormateada} ${horaFormateada}` : fechaFormateada;
    } catch (error) {
      return 'Sin fecha';
    }
  }

  /**
   * Obtiene el timestamp numérico real (ms) combinando fecha y hora de captura de forma precisa.
   * Soporta audios grabados con Modo Dynamics (sin EXIF estándar): lee metadatos.timestamp,
   * fechaTomada, fechaHora, created_at. Ignora 'Desconocido' como horaCaptura.
   */
  obtenerTimestampReal(pagina: PaginaMedia | any): number {
    if (!pagina) return 0;

    // Caso 1: mapa animado ya tiene timestampReal calculado
    if (pagina.timestampReal && !isNaN(pagina.timestampReal) && pagina.timestampReal > 0) {
      return pagina.timestampReal;
    }

    const arch = pagina.archivo || pagina;

    // 1. Si tiene horaCaptura válida y fechaCreacion/fechaTomada/pagina.fecha
    let datePart = '';
    if (pagina.fecha) datePart = pagina.fecha.split('T')[0];
    else if (arch.fechaCreacion) datePart = arch.fechaCreacion.split('T')[0];
    else if (arch.fechaTomada) datePart = arch.fechaTomada.split('T')[0];

    let timePart = '';
    const hc = arch.horaCaptura;
    if (hc && typeof hc === 'string' && hc !== '00:00:00' && hc.toLowerCase() !== 'desconocido' && hc.trim() !== '') {
      timePart = hc.trim();
      if (timePart.length === 5) timePart += ':00';
    }

    // Si no hay horaCaptura o es desconocida, extraer de fechaCreacion ISO o YYYYMMDD_HHMMSS del nombre
    if (!timePart && arch.fechaCreacion && typeof arch.fechaCreacion === 'string') {
      const matchIsoTime = arch.fechaCreacion.match(/T(\d{2}:\d{2}:\d{2})/);
      if (matchIsoTime && matchIsoTime[1] !== '00:00:00') {
        timePart = matchIsoTime[1];
      }
    }

    if (!timePart && arch.nombreArchivo) {
      const m = arch.nombreArchivo.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
      if (m) {
        if (!datePart || datePart.startsWith('1970') || datePart.startsWith('1792')) {
          datePart = `${m[1]}-${m[2]}-${m[3]}`;
        }
        timePart = `${m[4]}:${m[5]}:${m[6]}`;
      }
    }

    if (datePart && !datePart.startsWith('1970') && !datePart.startsWith('1792') && timePart) {
      const dt = new Date(`${datePart}T${timePart}`);
      if (!isNaN(dt.getTime()) && dt.getFullYear() >= 2000 && dt.getFullYear() <= 2100) return dt.getTime();
    }

    if (arch.metadatos) {
      try {
        const meta = typeof arch.metadatos === 'string' ? JSON.parse(arch.metadatos) : arch.metadatos;
        if (meta?.timestamp) {
          const t = new Date(meta.timestamp).getTime();
          const yr = new Date(t).getFullYear();
          if (!isNaN(t) && yr >= 2000 && yr <= 2100) return t;
        }
      } catch (e) { }
    }

    // 2. Fallback: Timestamp epoch de 13 dígitos en el nombre de archivo
    if (arch.nombreArchivo) {
      const m = arch.nombreArchivo.match(/(?:recording-|^|_|JPEG_|VID_)(\d{13})/);
      if (m) {
        const ts = Number(m[1]);
        if (ts > 946684800000 && ts < 4102444800000) return ts;
      }
    }

    if (arch.metadatos) {
      try {
        const meta = typeof arch.metadatos === 'string' ? JSON.parse(arch.metadatos) : arch.metadatos;
        if (meta?.timestamp) {
          const ts = new Date(meta.timestamp).getTime();
          if (!isNaN(ts) && ts > 0) return ts;
        }
      } catch (e) { }
    }

    // 3. Si tiene fechaTomada / fechaHora
    if (arch.fechaTomada || arch.fechaHora) {
      const ts = new Date(arch.fechaTomada || arch.fechaHora).getTime();
      if (!isNaN(ts) && ts > 0 && new Date(ts).getFullYear() >= 2000) return ts;
    }

    // 4. Nombre con timestamp epoch (si no había fecha/hora completa previa)
    if (arch.nombreArchivo) {
      const m = arch.nombreArchivo.match(/(\d{13})/);
      if (m) {
        const ts = Number(m[1]);
        if (ts > 1577836800000 && ts < 2051222400000) return ts;
      }
    }

    // 5. fechaCreacion / created_at fallback
    if (arch.fechaCreacion) {
      const ts = new Date(arch.fechaCreacion).getTime();
      if (!isNaN(ts) && ts > 0) return ts;
    }
    if (arch.created_at) {
      const ts = new Date(arch.created_at).getTime();
      if (!isNaN(ts) && ts > 0) return ts;
    }

    return 0;
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
  // MÉTODOS DE PÁGINA ÚNICA EN FULLSCREEN (ÁLBUM VINTAGE 3D)
  // ==========================================

  onFotoClick(pagina: PaginaMedia | null, isFullscreen: boolean, event?: Event, lado: 'izq' | 'der' = 'der'): void {
    if (event) {
      event.stopPropagation();
    }
    if (!pagina) return;

    if (pagina.tipoMedia === 'imagen' || pagina.tipoMedia === 'video' || pagina.tipoMedia === 'audio') {
      this.abrirElementoInteractivo(pagina, lado, event);
    } else if (isFullscreen) {
      this.toggleFullscreenSinglePage(pagina, event);
    }
  }

  // ==========================================
  // GESTIÓN DE ELEMENTO MAXIMIZADO / DESACOPLADO (INTERACTIVO Y CINEMÁTICO)
  // ==========================================

  toggleModoZoomCinematico(event?: Event): void {
    if (event) event.stopPropagation();
    this.modoZoomCinematico = !this.modoZoomCinematico;
    try {
      localStorage.setItem('album_modo_zoom_cinematico', this.modoZoomCinematico ? 'true' : 'false');
    } catch (e) {}

    console.log(`🎬 Modo Zoom Cinemático: ${this.modoZoomCinematico ? 'ACTIVADO' : 'DESACTIVADO'}`);

    if (this.modoZoomCinematico && this.reproduciendoSlideshow) {
      this.limpiarTimerSlideshow();
      this.iniciarSecuenciaVideosSpread();
    } else if (!this.modoZoomCinematico && this.secuenciaCinematicaEnCurso) {
      this.cancelarSecuenciaCinematica();
      this.iniciarSecuenciaVideosSpread();
    }
    this.cdr.detectChanges();
  }

  cancelarSecuenciaCinematica(): void {
    if (this.abortControllerCinematico) {
      this.abortControllerCinematico.abort();
      this.abortControllerCinematico = null;
    }
    if (this.timerCinematicoHold) {
      clearTimeout(this.timerCinematicoHold);
      this.timerCinematicoHold = null;
    }
    this.secuenciaCinematicaEnCurso = false;
    if (this.elementoMaximizado?.esCinematico) {
      this.cerrarElementoMaximizado(true);
    }
  }

  abrirElementoInteractivo(pagina: PaginaMedia | null | undefined, lado: 'izq' | 'der', event?: Event, esCinematico: boolean = false): void {
    if (event) event.stopPropagation();
    if (!pagina || !pagina.url) return;

    this.pausarMediosPliego();

    const tipo: 'imagen' | 'video' | 'audio' =
      pagina.tipoMedia === 'video' ? 'video' :
      (pagina.tipoMedia === 'audio' ? 'audio' : 'imagen');

    this.elementoMaximizado = {
      pagina,
      tipo,
      lado,
      zoom: 1.0,
      rotacion: 0,
      panX: 0,
      panY: 0,
      animandoEntrada: true,
      esCinematico
    };

    setTimeout(() => {
      if (this.elementoMaximizado) {
        this.elementoMaximizado.animandoEntrada = false;
        this.cdr.detectChanges();
      }
    }, 40);

    this.cdr.detectChanges();
  }

  cerrarElementoMaximizado(esAutoCinematico: boolean = false): void {
    if (!this.elementoMaximizado) return;

    if (!esAutoCinematico && this.secuenciaCinematicaEnCurso) {
      this.cancelarSecuenciaCinematica();
    }

    const vModal = document.getElementById('video-fullscreen-modal') as HTMLVideoElement;
    if (vModal) {
      try { vModal.pause(); } catch (e) {}
    }
    const aModal = document.getElementById('audio-fullscreen-modal') as HTMLAudioElement;
    if (aModal) {
      try { aModal.pause(); } catch (e) {}
    }

    this.elementoMaximizado.animandoSalida = true;
    this.cdr.detectChanges();

    setTimeout(() => {
      this.elementoMaximizado = null;
      this.cdr.detectChanges();
    }, 280);
  }

  pausarMediosPliego(): void {
    const vIzq = document.getElementById('video-spread-izq') as HTMLVideoElement;
    const vDer = document.getElementById('video-spread-der') as HTMLVideoElement;
    const aIzq = document.getElementById('audio-spread-izq') as HTMLAudioElement;
    const aDer = document.getElementById('audio-spread-der') as HTMLAudioElement;
    if (vIzq) try { vIzq.pause(); } catch (e) {}
    if (vDer) try { vDer.pause(); } catch (e) {}
    if (aIzq) try { aIzq.pause(); } catch (e) {}
    if (aDer) try { aDer.pause(); } catch (e) {}
  }

  zoomIn(): void {
    if (!this.elementoMaximizado) return;
    this.elementoMaximizado.zoom = Math.min(+(this.elementoMaximizado.zoom + 0.25).toFixed(2), 4.0);
    this.cdr.detectChanges();
  }

  zoomOut(): void {
    if (!this.elementoMaximizado) return;
    this.elementoMaximizado.zoom = Math.max(+(this.elementoMaximizado.zoom - 0.25).toFixed(2), 0.5);
    if (this.elementoMaximizado.zoom <= 1.0) {
      this.elementoMaximizado.panX = 0;
      this.elementoMaximizado.panY = 0;
    }
    this.cdr.detectChanges();
  }

  rotarIzquierda(): void {
    if (!this.elementoMaximizado) return;
    this.elementoMaximizado.rotacion = (this.elementoMaximizado.rotacion - 90) % 360;
    this.cdr.detectChanges();
  }

  rotarDerecha(): void {
    if (!this.elementoMaximizado) return;
    this.elementoMaximizado.rotacion = (this.elementoMaximizado.rotacion + 90) % 360;
    this.cdr.detectChanges();
  }

  resetZoom(): void {
    if (!this.elementoMaximizado) return;
    this.elementoMaximizado.zoom = 1.0;
    this.elementoMaximizado.rotacion = 0;
    this.elementoMaximizado.panX = 0;
    this.elementoMaximizado.panY = 0;
    this.cdr.detectChanges();
  }

  onWheelZoom(event: WheelEvent): void {
    if (!this.elementoMaximizado || this.elementoMaximizado.tipo !== 'imagen') return;
    event.preventDefault();
    if (event.deltaY < 0) {
      this.zoomIn();
    } else {
      this.zoomOut();
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.elementoMaximizado || this.elementoMaximizado.tipo !== 'imagen') return;
    this.elementoMaximizado.isDragging = true;
    this.elementoMaximizado.startX = event.clientX;
    this.elementoMaximizado.startY = event.clientY;
    this.elementoMaximizado.startPanX = this.elementoMaximizado.panX;
    this.elementoMaximizado.startPanY = this.elementoMaximizado.panY;
    (event.target as HTMLElement)?.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.elementoMaximizado || !this.elementoMaximizado.isDragging) return;
    const dx = event.clientX - (this.elementoMaximizado.startX || 0);
    const dy = event.clientY - (this.elementoMaximizado.startY || 0);
    this.elementoMaximizado.panX = (this.elementoMaximizado.startPanX || 0) + dx;
    this.elementoMaximizado.panY = (this.elementoMaximizado.startPanY || 0) + dy;
    this.cdr.detectChanges();
  }

  onPointerUp(event: PointerEvent): void {
    if (!this.elementoMaximizado) return;
    this.elementoMaximizado.isDragging = false;
    try {
      (event.target as HTMLElement)?.releasePointerCapture?.(event.pointerId);
    } catch (e) {}
  }

  obtenerTransformFotoMaximizada(): string {
    if (!this.elementoMaximizado) return 'none';
    const { zoom, rotacion, panX, panY } = this.elementoMaximizado;
    return `translate3d(${panX}px, ${panY}px, 0) scale(${zoom}) rotate(${rotacion}deg)`;
  }

  onVideoModalEnded(): void {
    console.log('🎬 [Modal Vídeo] Vídeo finalizado en pantalla completa');
  }

  onAudioModalEnded(): void {
    console.log('🎵 [Modal Audio] Audio finalizado en pantalla completa');
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeKey(event: KeyboardEvent): void {
    if (this.elementoMaximizado) {
      this.cerrarElementoMaximizado();
    }
    if (this.mostrarModalIntro) {
      this.cerrarIntroModal();
    }
    if (this.mostrarModalOutro) {
      this.cerrarOutroModal();
    }
  }

  // ==========================================
  // ORQUESTACIÓN CINEMÁTICA SECUENCIAL
  // ==========================================

  async ejecutarSecuenciaCinematicaSpread(): Promise<void> {
    if (this.abortControllerCinematico) {
      this.abortControllerCinematico.abort();
    }
    this.abortControllerCinematico = new AbortController();
    const signal = this.abortControllerCinematico.signal;
    this.secuenciaCinematicaEnCurso = true;

    console.log(`🎬 [Zoom Cinemático] Iniciando secuencia cinemática para Spread ${this.spreadActual}`);

    const tieneIzq = this.esMediaValidoParaZoom(this.paginaSpreadIzquierda);
    const tieneDer = this.esMediaValidoParaZoom(this.paginaSpreadDerecha);

    if (!tieneIzq && !tieneDer) {
      console.log('🎬 [Zoom Cinemático] Spread sin fotos ni multimedia; esperando pausa para lectura...');
      await this.esperarCinematico(3000, signal);
      if (!signal.aborted && this.reproduciendoSlideshow) {
        this.secuenciaCinematicaEnCurso = false;
        this.cambiarPagina(1);
      }
      return;
    }

    // 1. Elemento Izquierdo
    if (tieneIzq && this.paginaSpreadIzquierda) {
      await this.ejecutarPasoCinematico(this.paginaSpreadIzquierda, 'izq', signal);
    }

    if (signal.aborted || !this.reproduciendoSlideshow) {
      this.secuenciaCinematicaEnCurso = false;
      return;
    }

    // 2. Elemento Derecho
    if (tieneDer && this.paginaSpreadDerecha) {
      await this.ejecutarPasoCinematico(this.paginaSpreadDerecha, 'der', signal);
    }

    if (signal.aborted || !this.reproduciendoSlideshow) {
      this.secuenciaCinematicaEnCurso = false;
      return;
    }

    this.secuenciaCinematicaEnCurso = false;

    // 3. Pasar a la siguiente página tras completar ambos lados
    if (this.reproduciendoSlideshow) {
      if (this.spreadActual + 1 < this.totalSpreads) {
        console.log('🎬 [Zoom Cinemático] Pliego completado con éxito. Pasando a siguiente página...');
        setTimeout(() => {
          if (this.reproduciendoSlideshow && !signal.aborted) {
            this.cambiarPagina(1);
          }
        }, 500);
      } else {
        console.log('🎬 [Zoom Cinemático] Fin del álbum alcanzado. Mostrando Outro Estantería de los Recuerdos...');
        this.detenerSlideshow();
        this.mostrarOutroEstanteriaRecuerdos();
      }
    }
  }

  private esMediaValidoParaZoom(p: PaginaMedia | null | undefined): boolean {
    if (!p || !p.url) return false;
    if (p.esIndice || p.esCartaManuscrita || p.esMapaAnimado || p.esMapaGeneral || p.esMapaItinerario) return false;
    return p.tipoMedia === 'imagen' || p.tipoMedia === 'video' || p.tipoMedia === 'audio';
  }

  private esperarCinematico(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  private async ejecutarPasoCinematico(pagina: PaginaMedia, lado: 'izq' | 'der', signal: AbortSignal): Promise<void> {
    if (signal.aborted || !this.reproduciendoSlideshow) return;

    if (pagina.tipoMedia === 'imagen') {
      // CASO 1: FOTO
      console.log(`🎬 [Zoom Cinemático] Foto ${lado}: zoom a pantalla completa...`);
      this.abrirElementoInteractivo(pagina, lado, undefined, true);
      // Esperar ~2.8s para que se aprecie al detalle
      await this.esperarCinematico(2800, signal);
      if (signal.aborted) return;
      this.cerrarElementoMaximizado(true);
      await this.esperarCinematico(380, signal);
    } else if (pagina.tipoMedia === 'video') {
      // CASO 2: VÍDEO
      console.log(`🎬 [Zoom Cinemático] Vídeo ${lado}: pantalla completa y reproducción...`);
      this.abrirElementoInteractivo(pagina, lado, undefined, true);
      this.bajarVolumenAudioViaje();

      await new Promise<void>((resolve) => {
        const checkVideo = () => {
          const v = document.getElementById('video-fullscreen-modal') as HTMLVideoElement;
          if (!v) {
            resolve();
            return;
          }
          v.muted = this.videoMuted;
          const onEnded = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            resolve();
          };
          let timerPreview: any = null;
          if (!this.reproducirVideosCompletos) {
            timerPreview = setTimeout(() => {
              cleanup();
              resolve();
            }, this.INTERVALO_SLIDESHOW);
          }
          const onAbort = () => {
            cleanup();
            resolve();
          };
          signal.addEventListener('abort', onAbort, { once: true });

          const cleanup = () => {
            v.removeEventListener('ended', onEnded);
            v.removeEventListener('error', onError);
            if (timerPreview) clearTimeout(timerPreview);
            signal.removeEventListener('abort', onAbort);
          };

          v.addEventListener('ended', onEnded, { once: true });
          v.addEventListener('error', onError, { once: true });

          v.play().catch(err => {
            console.warn('Auto-play vídeo cinemático bloqueado:', err);
            resolve();
          });
        };

        setTimeout(checkVideo, 120);
      });

      this.restaurarVolumenAudioViaje();
      if (signal.aborted) return;
      this.cerrarElementoMaximizado(true);
      await this.esperarCinematico(380, signal);
    } else if (pagina.tipoMedia === 'audio') {
      // CASO 3: AUDIO
      // "El libro se detiene al abrir la página. El audio comienza a reproducirse de forma automatizada completando su pista (o fragmento) mientras la página se mantiene fija a la vista del espectador."
      console.log(`🎬 [Zoom Cinemático] Audio ${lado}: reproduciendo pista en página fija...`);
      this.bajarVolumenAudioViaje();

      const audioId = lado === 'izq' ? 'audio-spread-izq' : 'audio-spread-der';
      await new Promise<void>((resolve) => {
        const a = document.getElementById(audioId) as HTMLAudioElement;
        if (!a) {
          resolve();
          return;
        }
        a.currentTime = 0;
        const onEnded = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          resolve();
        };
        let timerPreview: any = null;
        if (!this.reproducirVideosCompletos) {
          timerPreview = setTimeout(() => {
            cleanup();
            resolve();
          }, this.INTERVALO_SLIDESHOW);
        }
        const onAbort = () => {
          cleanup();
          resolve();
        };
        signal.addEventListener('abort', onAbort, { once: true });

        const cleanup = () => {
          a.removeEventListener('ended', onEnded);
          a.removeEventListener('error', onError);
          if (timerPreview) clearTimeout(timerPreview);
          signal.removeEventListener('abort', onAbort);
        };

        a.addEventListener('ended', onEnded, { once: true });
        a.addEventListener('error', onError, { once: true });

        a.play().catch(err => {
          console.warn('Auto-play audio cinemático bloqueado:', err);
          resolve();
        });
      });

      this.restaurarVolumenAudioViaje();
      if (signal.aborted) return;
      await this.esperarCinematico(500, signal);
    }
  }

  // ==========================================
  // OUTRO CINEMÁTICO: ESTANTERÍA DE LOS RECUERDOS
  // ==========================================

  mostrarOutroEstanteriaRecuerdos(): void {
    console.log('📚 [Outro] Mostrando secuencia final: Estantería de los Recuerdos');
    this.pausarMediosPliego();
    this.detenerSlideshow();
    this.cancelarSecuenciaCinematica();
    this.mostrarModalOutro = true;
    this.cdr.detectChanges();

    setTimeout(() => {
      const vOutro = document.getElementById('video-outro-modal') as HTMLVideoElement;
      if (vOutro) {
        vOutro.currentTime = 0;
        vOutro.muted = this.videoMuted;
        vOutro.play().catch(e => console.warn('Auto-play vídeo outro bloqueado:', e));
      }
    }, 150);
  }

  cerrarOutroModal(): void {
    const vOutro = document.getElementById('video-outro-modal') as HTMLVideoElement;
    if (vOutro) {
      try { vOutro.pause(); } catch (e) {}
    }
    this.mostrarModalOutro = false;
    this.cdr.detectChanges();
  }

  onOutroVideoEnded(): void {
    console.log('🎬 [Outro] Vídeo completado: El libro descansa en la Estantería de los Recuerdos.');
  }

  volverAlInicio(): void {
    this.cerrarOutroModal();
    this.irAPagina(0);
  }

  obtenerDestinoViajeTexto(): string {
    return this.infoViaje?.destino?.trim() || '';
  }

  obtenerFechaViajeTexto(): string {
    const fIni = this.infoViaje?.fechaInicio || this.telemetriaActual?.fechaActual || '';
    const fFin = this.infoViaje?.fechaFin || '';
    if (!fIni) return '';
    try {
      const dIni = new Date(fIni);
      if (isNaN(dIni.getTime())) return fIni;
      const fIniStr = dIni.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
      if (fFin && fFin !== fIni) {
        const dFin = new Date(fFin);
        if (!isNaN(dFin.getTime())) {
          const fFinStr = dFin.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
          return `${fIniStr} – ${fFinStr}`;
        }
      }
      return fIniStr;
    } catch {
      return fIni;
    }
  }

  obtenerDistanciaTotalTexto(): string {
    const km = this.distanciaTotalKm;
    if (!km || km <= 0) return '';
    return `${km.toFixed(2).replace('.', ',')} km`;
  }

  obtenerDuracionTotalTexto(): string {
    let duracionMs = 0;
    if (this.cacheDatosActividadGpx && this.cacheDatosActividadGpx.size > 0) {
      let minTs = Infinity;
      let maxTs = -Infinity;
      this.cacheDatosActividadGpx.forEach(d => {
        const pts: any[] = d.points || [];
        if (pts.length >= 2 && pts[0].time && pts[pts.length - 1].time) {
          const t0 = new Date(pts[0].time).getTime();
          const t1 = new Date(pts[pts.length - 1].time).getTime();
          if (!isNaN(t0) && !isNaN(t1) && t1 > t0) {
            minTs = Math.min(minTs, t0);
            maxTs = Math.max(maxTs, t1);
          }
        }
      });
      if (minTs < Infinity && maxTs > -Infinity) {
        duracionMs = maxTs - minTs;
      }
    }
    if (duracionMs <= 0 && this.paginas.length > 0) {
      let minTs = Infinity;
      let maxTs = -Infinity;
      this.paginas.forEach(p => {
        const ts = p.timestampReal || (p.fecha ? new Date(p.fecha).getTime() : 0);
        if (ts > 0) {
          minTs = Math.min(minTs, ts);
          maxTs = Math.max(maxTs, ts);
        }
      });
      if (minTs < Infinity && maxTs > -Infinity && maxTs > minTs) {
        duracionMs = maxTs - minTs;
      }
    }

    if (duracionMs <= 0) return '';
    const totalMin = Math.round(duracionMs / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) {
      return `${h}h ${m}m`;
    }
    return `${m} min`;
  }

  obtenerPasosTotalesTexto(): string {
    const km = this.distanciaTotalKm;
    if (!km || km <= 0) return '';
    const pasos = Math.round((km * 1000) / 0.75);
    return `${pasos.toLocaleString('es-ES')} pasos`;
  }

  toggleFullscreenSinglePage(pagina: PaginaMedia | null, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    if (!this.mostrarFullscreen) {
      return;
    }

    if (this.fullscreenSinglePageMode) {
      // Salir de vista de 1 página -> volver a díptico de 2 páginas
      this.fullscreenSinglePageMode = false;
      if (this.paginaSinglePageActual) {
        const idx = this.paginas.indexOf(this.paginaSinglePageActual);
        if (idx !== -1) {
          const spreadIdx = this.spreads.findIndex(s => s.indices.includes(idx));
          if (spreadIdx !== -1) {
            this.spreadActual = spreadIdx;
            this.paginaActual = this.spreads[spreadIdx].indices[0] ?? idx;
          }
        }
      }
      this.paginaSinglePageActual = null;
      this.reiniciarInstanciaMapa();
      setTimeout(() => {
        this.iniciarSecuenciaVideosSpread();
        this.cdr.detectChanges();
      }, 100);
    } else {
      // Entrar a vista de 1 página maximizada
      this.detenerVideosActuales();
      this.fullscreenSinglePageMode = true;
      this.paginaSinglePageActual = pagina || this.paginaSpreadDerecha || this.paginaSpreadIzquierda || this.paginas[this.paginaActual];
      if (this.paginaSinglePageActual) {
        const idx = this.paginas.indexOf(this.paginaSinglePageActual);
        if (idx !== -1) {
          this.paginaActual = idx;
        }
      }
    }
    this.cdr.detectChanges();
  }

  navegarSinglePage(direccion: number): void {
    let idx = this.paginaSinglePageActual ? this.paginas.indexOf(this.paginaSinglePageActual) : this.paginaActual;
    if (idx === -1) idx = this.paginaActual;
    const nuevoIdx = idx + direccion;
    if (nuevoIdx >= 0 && nuevoIdx < this.paginas.length) {
      this.detenerVideosActuales();
      this.paginaActual = nuevoIdx;
      this.paginaSinglePageActual = this.paginas[nuevoIdx];
      const spreadIdx = this.spreads.findIndex(s => s.indices.includes(nuevoIdx));
      if (spreadIdx !== -1) {
        this.spreadActual = spreadIdx;
      }
      if (this.reproduciendoSlideshow) {
        const pag = this.paginas[nuevoIdx];
        const tieneMedia = pag?.tipoMedia === 'video' || pag?.tipoMedia === 'audio';
        if (!tieneMedia) {
          this.reiniciarTimerSlideshow();
        } else {
          this.limpiarTimerSlideshow();
        }
      }
      this.cdr.detectChanges();
    }
  }

  getNumeroPaginaSingle(): number {
    if (!this.paginaSinglePageActual) return this.paginaActual + 1;
    const idx = this.paginas.indexOf(this.paginaSinglePageActual);
    return idx !== -1 ? idx + 1 : this.paginaActual + 1;
  }

  onVideoSingleTerminado(): void {
    console.log('🎬 Vídeo en página única completado');
    this.videoActualSecuencia = null;
    this.restaurarVolumenAudioViaje();
    if (this.reproduciendoSlideshow) {
      if (this.hayPaginaSiguiente) {
        this.navegarSinglePage(1);
      } else {
        this.detenerSlideshow();
      }
    }
  }

  // ==========================================
  // GETTERS Y MÉTODOS DE INFORMACIÓN CONTEXTUAL
  // ==========================================

  get hayPaginaAnterior(): boolean {
    if (this.modoAlbumVintage && this.mostrarFullscreen && this.fullscreenSinglePageMode) {
      const idx = this.paginaSinglePageActual ? this.paginas.indexOf(this.paginaSinglePageActual) : this.paginaActual;
      return idx > 0;
    }
    return this.spreadActual > 0;
  }

  get hayPaginaSiguiente(): boolean {
    if (this.modoAlbumVintage && this.mostrarFullscreen && this.fullscreenSinglePageMode) {
      const idx = this.paginaSinglePageActual ? this.paginas.indexOf(this.paginaSinglePageActual) : this.paginaActual;
      return idx < this.paginas.length - 1;
    }
    return this.spreadActual < this.totalSpreads - 1;
  }

  get paginaActualData(): PaginaMedia | null {
    return this.paginas[this.paginaActual] || null;
  }

  get progresoAlbum(): number {
    if (!this.paginas.length) return 0;
    return Math.round(((this.paginaActual + 1) / this.paginas.length) * 100);
  }

  get totalRecuerdosDisplay(): number {
    return Math.max(this.paginas.filter(pagina => !pagina.esIndice).length, 0);
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
    const plurales: { [key: string]: string } = {
      'imagen': 'imágenes',
      'video': 'vídeos',
      'audio': 'audios',
      'documento': 'documentos',
      'pdf': 'PDFs',
      'texto': 'textos',
      'carta-manuscrita': 'cartas manuscritas',
      'mapa-animado': 'mapas animados',
      'desconocido': 'otros'
    };
    const tipos = Object.keys(stats).map(tipo => `${stats[tipo]} ${plurales[tipo] || tipo + 's'}`).join(', ');

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

  obtenerUbicacionCercana(lat?: number, lng?: number): string | null {
    if (lat == null || lng == null || !this.ubicacionesCache || this.ubicacionesCache.size === 0) return null;
    let mejorUbicacion: string | null = null;
    let menorDistancia = Infinity;

    this.ubicacionesCache.forEach((nombre, key) => {
      if (!nombre || nombre === 'Ubicación') return;
      const partes = key.split(',');
      if (partes.length === 2) {
        const cLat = parseFloat(partes[0]);
        const cLng = parseFloat(partes[1]);
        if (!isNaN(cLat) && !isNaN(cLng)) {
          const d = Math.hypot(lat - cLat, lng - cLng);
          if (d < menorDistancia) {
            menorDistancia = d;
            mejorUbicacion = nombre;
          }
        }
      }
    });

    if (menorDistancia < 0.02) { // Coincidencia dentro de radio cercano
      return mejorUbicacion;
    }
    return null;
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

  obtenerClaseMarco(pagina?: PaginaMedia | null, index: number = 0): string {
    if (!pagina) return 'marco-madera-noble';
    const marcos = [
      'marco-madera-noble',
      'marco-dorado-vintage',
      'marco-paspartu-galeria',
      'marco-cuero-bronce',
      'marco-polaroid-vintage'
    ];
    const id = (pagina.archivo?.id || 0) + (pagina.archivo?.numeroSecuencial || 0) + index;
    return marcos[Math.abs(id) % marcos.length];
  }

  obtenerBadgeOrden(pagina: PaginaMedia, index: number): string {
    if (!pagina) return '';
    if (pagina.esIndice) return 'Índice';
    if (pagina.esCartaManuscrita) return 'Diario';
    if (pagina.esMapaGeneral) return 'Mapa Viaje';
    if (pagina.esMapaItinerario) return 'Mapa Itin';
    if (pagina.esMapaAnimado) return 'Ruta';
    if (pagina.archivo?.numeroSecuencial) {
      return '#' + pagina.archivo.numeroSecuencial;
    }
    // Si no tiene número de parada, enumerar de forma secuencial los elementos multimedia
    let contadorMedia = 0;
    if (this.paginas && this.paginas.length > 0) {
      for (let i = 0; i <= index && i < this.paginas.length; i++) {
        const p = this.paginas[i];
        if (p && !p.esIndice && !p.esCartaManuscrita && !p.esMapaAnimado) {
          contadorMedia++;
        }
      }
    }
    return '#' + (contadorMedia || (index + 1));
  }

  obtenerTooltipRecorrido(pagina: PaginaMedia): string {
    if (!pagina.esMapaAnimado) return pagina.titulo || '';

    const dist = pagina.distanciaTramoKm ? `${pagina.distanciaTramoKm.toFixed(1)} km` : '';
    const dia = pagina.fecha ? this.formatearFechaLarga(pagina.fecha) : 'Día del itinerario';
    const horario = (pagina.horaInicioTramo && pagina.horaFinTramo)
      ? `${pagina.horaInicioTramo} - ${pagina.horaFinTramo}`
      : (pagina.horaInicioTramo ? `Desde las ${pagina.horaInicioTramo}` : 'Horario del día');
    const transporte = this.formatearTextoTransporte(pagina.tipoTransporteTramo);

    return `📍 Recorrido animado: ${dist}\n📅 Día: ${dia}\n⏰ Horario: ${horario}\n🚗 Transporte: ${transporte}`;
  }

  formatearFechaLarga(fecha: string): string {
    if (!fecha) return '';
    try {
      const d = new Date(fecha);
      return d.toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
      return fecha;
    }
  }

  formatearTextoTransporte(tipo?: string): string {
    if (!tipo) return 'A pie';
    const norm = tipo.toLowerCase();
    if (norm.includes('coche') || norm.includes('driving') || norm.includes('car') || norm.includes('auto') || norm.includes('taxi')) {
      return 'En coche / vehículo';
    }
    if (norm.includes('barco') || norm.includes('boat') || norm.includes('ship') || norm.includes('ferry') || norm.includes('crucero') || norm.includes('embarc')) {
      return 'En barco / crucero';
    }
    if (norm.includes('bici') || norm.includes('cycling') || norm.includes('bicycle')) {
      return 'En bicicleta';
    }
    if (norm.includes('bus') || norm.includes('autobus')) {
      return 'En autobús';
    }
    if (norm.includes('tren') || norm.includes('train')) {
      return 'En tren';
    }
    if (norm.includes('avion') || norm.includes('plane') || norm.includes('flight')) {
      return 'En avión';
    }
    if (norm.includes('run') || norm.includes('correr')) {
      return 'Corriendo';
    }
    if (norm.includes('andando') || norm.includes('walking') || norm.includes('caminar') || norm.includes('pie')) {
      return 'A pie / caminando';
    }
    return tipo.charAt(0).toUpperCase() + tipo.slice(1);
  }

  obtenerIconoTransporte(tipo?: string): string {
    if (!tipo) return 'fas fa-route';
    const norm = tipo.toLowerCase();
    if (norm.includes('coche') || norm.includes('driving') || norm.includes('car') || norm.includes('auto') || norm.includes('taxi')) {
      return 'fas fa-car';
    }
    if (norm.includes('barco') || norm.includes('boat') || norm.includes('ship') || norm.includes('ferry') || norm.includes('crucero')) {
      return 'fas fa-ship';
    }
    if (norm.includes('bici') || norm.includes('cycling') || norm.includes('bicycle')) {
      return 'fas fa-bicycle';
    }
    if (norm.includes('bus') || norm.includes('autobus')) {
      return 'fas fa-bus';
    }
    if (norm.includes('tren') || norm.includes('train')) {
      return 'fas fa-train';
    }
    if (norm.includes('avion') || norm.includes('plane')) {
      return 'fas fa-plane';
    }
    if (norm.includes('run') || norm.includes('correr') || norm.includes('walking') || norm.includes('pie') || norm.includes('andando')) {
      return 'fas fa-walking';
    }
    return 'fas fa-route';
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

  // Animaciones de ruta pendientes vs totales para exportación de vídeo
  animacionesRutaTotales: PaginaMedia[] = [];
  animacionesRutaPendientes: PaginaMedia[] = [];
  get distanciaMinimaAnimacionMetros(): number {
    return Math.round((this.distanciaMinimaAnimacionKm || 0.05) * 1000);
  }


  // Vídeo generado listo para previsualizar y compartir
  urlVideoGenerado: string | null = null;
  blobVideoGenerado: Blob | null = null;
  nombreArchivoVideoGenerado: string = 'pelicula-viaje.mp4';

  // Control de estado de la intro 3D personalizada del viaje
  introVideoLista: boolean = false;
  urlIntroVideoViaje: string | null = null;
  generandoIntro3D: boolean = false;
  progresoIntro3D: string = '';

  mostrarDialogoVideo(): void {
    // Sincronizar parámetros activos de las herramientas con la exportación
    this.configuracionExportacion.mantenerEstiloAlbum = this.modoAlbumVintage;
    this.configuracionExportacion.esModoVintage = this.modoAlbumVintage;
    this.configuracionExportacion.tipoIntro = this.tipoIntro;
    this.configuracionExportacion.distanciaMinimaAnimacionKm = this.distanciaMinimaAnimacionKm;
    this.configuracionExportacion.incluirAudio = !this.videoMuted && (this.audioViaje != null);

    this.actualizarEstadoAnimacionesRuta();
    this.verificarEstadoIntroVideo();
    this.mostrarConfiguracionVideo = true;
    document.body.style.overflow = 'hidden';
  }

  async verificarEstadoIntroVideo(): Promise<void> {
    const vId = this.infoViaje?.id || this.contextoViaje?.viajeId;
    if (!vId) return;
    try {
      const res = await this.introVideoGeneratorService.verificarIntroExiste(vId);
      this.introVideoLista = res.exists;
      this.urlIntroVideoViaje = res.url;
      this.cdr.detectChanges();
    } catch {
      this.introVideoLista = false;
      this.urlIntroVideoViaje = null;
    }
  }

  async generarIntro3DManual(): Promise<void> {
    const vId = this.infoViaje?.id || this.contextoViaje?.viajeId;
    if (this.generandoIntro3D || !vId) return;
    try {
      this.generandoIntro3D = true;
      this.progresoIntro3D = 'Iniciando renderizado 3D de portada...';
      this.cdr.detectChanges();

      const titulo = this.infoViaje?.nombre || this.getTituloContextual() || 'Mi Viaje';
      const imagenPortada = this.getImagenViajeUrl();

      const urlGenerada = await this.introVideoGeneratorService.generarYSubirVideoIntro(
        vId,
        titulo,
        imagenPortada,
        this.paginas,
        (p) => {
          this.progresoIntro3D = p.mensaje;
          if (this.generandoVideo) {
            this.progresoVideo = {
              fase: 'generando',
              porcentaje: Math.round(p.porcentaje * 0.15),
              mensaje: `Portada 3D: ${p.mensaje}`
            };
          }
          this.cdr.detectChanges();
        }
      );
      this.urlIntroVideoViaje = urlGenerada;
      this.introVideoLista = true;
      console.log('✅ [AlbumLibro] Intro 3D personalizada generada con éxito:', urlGenerada);
    } catch (err) {
      console.error('❌ Error generando intro 3D personalizada:', err);
      alert('No se pudo generar la animación 3D de la portada: ' + (err instanceof Error ? err.message : 'Error desconocido'));
    } finally {
      this.generandoIntro3D = false;
      this.progresoIntro3D = '';
      this.cdr.detectChanges();
    }
  }

  cerrarDialogoVideo(): void {
    this.mostrarConfiguracionVideo = false;
    document.body.style.overflow = '';
  }

  actualizarEstadoAnimacionesRuta(): void {
    const fuentes = this.paginas || [];
    const vistas = new Set<string>();
    const totales: PaginaMedia[] = [];
    const pendientes: PaginaMedia[] = [];

    for (const p of fuentes) {
      if (p.esMapaAnimado && !p.esMapaGeneral && !p.esMapaItinerario && p.trackGpx) {
        const key = `${p.actividadId}_${p.idParadaOrigen}_${p.idParadaDestino}`;
        if (!vistas.has(key)) {
          vistas.add(key);
          totales.push(p);
          if (!p.urlVideoAnimacion || p.urlVideoAnimacion.trim() === '') {
            pendientes.push(p);
          }
        }
      }
    }
    this.animacionesRutaTotales = totales;
    this.animacionesRutaPendientes = pendientes;
  }

  async generarRutasPendientesDesdeModal(): Promise<void> {
    this.mostrarConfiguracionVideo = false;
    document.body.style.overflow = '';

    await this.iniciarGeneracionLoteVideos();

    this.actualizarEstadoAnimacionesRuta();
    this.mostrarConfiguracionVideo = true;
    document.body.style.overflow = 'hidden';
    this.cdr.detectChanges();
  }

  async generarVideoViaje(): Promise<void> {
    if (this.generandoVideo) return;
    this.actualizarEstadoAnimacionesRuta();

    if (this.animacionesRutaPendientes.length > 0) {
      alert(`Hay ${this.animacionesRutaPendientes.length} animaciones de ruta pendientes de generar en MP4. Pulsa "Generar rutas MP4 pendientes" antes de crear el vídeo del viaje.`);
      return;
    }

    try {
      this.generandoVideo = true;

      // Comprobar y generar la portada 3D interactiva personalizada solo si se eligió dicho modo y aún no existe
      if (this.configuracionExportacion.tipoIntro === '3d-interactiva') {
        if (!this.introVideoLista || !this.urlIntroVideoViaje) {
          this.progresoVideo = {
            fase: 'generando',
            porcentaje: 2,
            mensaje: 'Generando animación 3D de portada interactiva...'
          };
          this.cdr.detectChanges();
          await this.generarIntro3DManual();
        }
      }

      // Comprobar y generar snapshots de mapa para el Mapa General y Mapas de Itinerario si aún no están listos
      const viajeId = this.infoViaje?.id || this.contextoViaje?.viajeId || 0;
      for (const p of this.paginas) {
        if ((p.esMapaGeneral || p.esMapaItinerario) && (!p.urlMapaRenderizado || p.urlMapaRenderizado.trim() === '')) {
          this.progresoVideo = {
            fase: 'generando',
            porcentaje: 3,
            mensaje: p.esMapaGeneral ? 'Generando mapa panorámico del viaje completo...' : `Generando mapa panorámico de ${p.titulo || 'itinerario'}...`
          };
          this.cdr.detectChanges();
          try {
            const tipo = p.esMapaGeneral ? 'general' : 'itinerario';
            const tituloMapa = p.titulo || (p.esMapaGeneral ? `MAPA GENERAL: ${this.infoViaje?.nombre || 'Mi Viaje'}` : 'MAPA DEL ITINERARIO');
            const subTexto = p.descripcion || (p.distanciaTramoKm ? `Recorrido total: ${p.distanciaTramoKm.toFixed(1)} km` : '');
            const urlSnapshot = await this.routeVideoGeneratorService.generarYSubirSnapshotMapa(
              viajeId,
              p.trackGpx || '',
              tituloMapa,
              subTexto,
              p.distanciaTramoKm,
              tipo,
              p.itinerarioId,
              p.puntosClave
            );
            const urlCompleta = urlSnapshot.startsWith('http') ? urlSnapshot : `${environment.apiUrl || 'http://localhost:3000'}${urlSnapshot.startsWith('/') ? '' : '/'}${urlSnapshot}`;
            p.urlMapaRenderizado = urlCompleta;
            p.url = urlCompleta;
            console.log(`🗺️ [VideoViaje] Mapa estructural incorporado a la película: ${p.url}`);
          } catch (mapErr) {
            console.warn('⚠️ No se pudo generar snapshot de mapa para el vídeo:', mapErr);
          }
        }
      }

      this.progresoVideo = {
        fase: 'cargando',
        porcentaje: 5,
        mensaje: 'Preparando secuencia del viaje...'
      };

      const secuencia = this.construirSecuenciaEscenas();

      if (secuencia.length === 0) {
        throw new Error('No hay contenido para generar el vídeo');
      }

      console.log('🎬 Secuencia de vídeo construida:', secuencia.length, 'escenas');

      const incluirMusica = !!(this.configuracionExportacion.incluirAudio && this.audioViaje);
      const audioParaExportacion = incluirMusica ? this.audioViaje! : null;
      console.log('🎵 Opción de exportación: incluir música =', incluirMusica);

      const videoBlob = await this.videoGeneratorService.generarVideoDesdeSecuencia(
        secuencia,
        this.infoViaje,
        this.configuracionExportacion,
        audioParaExportacion,
        (progreso) => {
          this.progresoVideo = progreso;
          this.cdr.detectChanges();
        }
      );

      this.blobVideoGenerado = videoBlob;
      if (this.urlVideoGenerado) {
        URL.revokeObjectURL(this.urlVideoGenerado);
      }
      this.urlVideoGenerado = URL.createObjectURL(videoBlob);

      const nombreBase = this.contextoViaje?.itinerarioId
        ? `itinerario-${this.contextoViaje.itinerarioId}`
        : this.sanitizarNombreArchivo(this.infoViaje?.nombre || 'viaje');

      this.nombreArchivoVideoGenerado = `viaje-${nombreBase}.mp4`;

      this.progresoVideo = {
        fase: 'completado',
        porcentaje: 100,
        mensaje: '¡Película del viaje lista!'
      };
      this.generandoVideo = false;
      this.cdr.detectChanges();

    } catch (error) {
      console.error('❌ Error generando vídeo:', error);
      this.progresoVideo = {
        fase: 'error',
        porcentaje: 0,
        mensaje: `Error: ${error instanceof Error ? error.message : 'Error desconocido'}`
      };
      this.generandoVideo = false;
      this.cdr.detectChanges();
    }
  }

  async compartirVideoPorWhatsApp(): Promise<void> {
    if (!this.blobVideoGenerado) return;
    const archivo = new File([this.blobVideoGenerado], this.nombreArchivoVideoGenerado, { type: 'video/mp4' });

    if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
      try {
        await navigator.share({
          files: [archivo],
          title: this.infoViaje?.nombre || 'Película del Viaje',
          text: `🎬 ¡Mira la película de nuestro viaje: ${this.infoViaje?.nombre || 'Mi Viaje'}!`
        });
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.warn('Web Share no disponible, usando fallback:', err);
      }
    }

    // Fallback escritorio
    this.descargarVideoGenerado();
    const textoMsg = encodeURIComponent(`🎬 ¡Aquí tienes la película de nuestro viaje "${this.infoViaje?.nombre || 'Mi Viaje'}"! Adjunto el vídeo descargado.`);
    window.open(`https://api.whatsapp.com/send?text=${textoMsg}`, '_blank');
  }

  descargarVideoGenerado(): void {
    if (!this.blobVideoGenerado && !this.urlVideoGenerado) return;
    const url = this.urlVideoGenerado || URL.createObjectURL(this.blobVideoGenerado!);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.nombreArchivoVideoGenerado;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * Construye la secuencia fiel de escenas para el vídeo basándose EXACTAMENTE
   * en lo que el usuario ve en las páginas del álbum (incluyendo 3D intro, cartas, mapas y marcos de lujo).
   */
  private construirSecuenciaEscenas(): EscenaMultimedia[] {
    const secuencia: EscenaMultimedia[] = [];

    // 1. Escena 1: INTRO SEGÚN SELECCIÓN DEL USUARIO (Vídeo MP4 cinemático o 3D interactiva)
    const viajeId = this.infoViaje?.id || this.contextoViaje?.viajeId;
    const backendUrl = environment.apiUrl || 'http://localhost:3000';
    let introUrl = '/assets/videos/intro-libro-3d.mp4';

    if (this.configuracionExportacion.tipoIntro === '3d-interactiva') {
      introUrl = this.urlIntroVideoViaje || (viajeId ? `${backendUrl}/uploads/${viajeId}/intro_3d_${viajeId}.mp4` : '/assets/videos/intro-libro-3d.mp4');
    } else {
      introUrl = '/assets/videos/intro-libro-3d.mp4';
    }

    secuencia.push({
      id: 'intro-3d-cinematica',
      tipo: 'video',
      url: introUrl,
      duracion: 10.5,
      titulo: this.infoViaje?.nombre || 'Mi Viaje',
      descripcion: 'Apertura del diario de viaje',
      esIntro3D: true
    });

    // 2. Páginas del álbum en orden
    this.paginas
      .filter(p => !p.esIndice)
      .forEach((p, index) => {
        const fechaHora = this.obtenerFechaHoraSeparadas(p);
        const badge = this.obtenerBadgeOrden(p, index);
        const marco = this.obtenerClaseMarco(p, index);

        if (p.esCartaManuscrita) {
          const desc = (p.descripcion || '').trim();
          const tit = (p.titulo || '').trim().toLowerCase();
          // Omitir cartas sin contenido descriptivo real o páginas que sólo digan 'Itinerario'
          if (desc.length >= 15 && desc.toLowerCase() !== 'itinerario' && tit !== 'itinerario') {
            secuencia.push({
              id: p.archivo?.id || `carta-${index}`,
              tipo: 'carta',
              url: '',
              duracion: 5,
              titulo: p.titulo || 'Diario de Viaje',
              descripcion: desc,
              fecha: fechaHora.fecha,
              hora: fechaHora.hora,
              badgeOrden: badge
            });
          }

        } else if (p.esMapaGeneral) {
          const mapaUrl = p.urlMapaRenderizado || p.url;
          if (mapaUrl && mapaUrl.trim().length > 0) {
            secuencia.push({
              id: `mapa-general-${index}`,
              tipo: 'mapa_resumen',
              url: mapaUrl,
              duracion: 5,
              titulo: p.titulo || `MAPA GENERAL: ${this.infoViaje?.nombre || 'Mi Viaje'}`,
              descripcion: p.descripcion || 'Recorrido unificado y panorámica completa del viaje',
              trackGpx: p.trackGpx,
              distanciaKm: p.distanciaTramoKm,
              badgeOrden: 'Mapa Viaje'
            });
          }

        } else if (p.esMapaItinerario) {
          const mapaUrl = p.urlMapaRenderizado || p.url;
          if (mapaUrl && mapaUrl.trim().length > 0) {
            secuencia.push({
              id: `mapa-itinerario-${index}`,
              tipo: 'mapa_resumen',
              url: mapaUrl,
              duracion: 5,
              titulo: p.titulo || 'MAPA DEL ITINERARIO',
              descripcion: p.descripcion || '',
              trackGpx: p.trackGpx,
              distanciaKm: p.distanciaTramoKm,
              badgeOrden: 'Mapa Itin'
            });
          }

        } else if (p.esMapaAnimado) {
          if (p.urlVideoAnimacion && p.urlVideoAnimacion.trim() !== '') {
            secuencia.push({
              id: `ruta-video-${p.idParadaOrigen}-${p.idParadaDestino}-${index}`,
              tipo: 'video',
              url: p.urlVideoAnimacion,
              duracion: p.distanciaTramoKm ? this.routeVideoGeneratorService.calcularDuracionDinamica(p.distanciaTramoKm) : 5,
              titulo: p.titulo || `Recorrido Parada #${p.idParadaOrigen} ➔ #${p.idParadaDestino}`,
              descripcion: p.descripcion,
              fecha: fechaHora.fecha,
              hora: fechaHora.hora,
              esMapaAnimado: true,
              badgeOrden: 'Ruta'
            });
          }

        } else {
          const esAudio = p.tipoMedia === 'audio' || /\.(aac|mp3|m4a|wav|ogg)$/i.test(p.url || p.archivo?.rutaArchivo || '');
          const esVideo = p.tipoMedia === 'video' || /\.(mp4|mov|webm|avi|mkv)$/i.test(p.url || p.archivo?.rutaArchivo || '');

          if (esVideo) {
            secuencia.push({
              id: p.archivo?.id || `video-${index}`,
              tipo: 'video',
              url: p.url,
              duracion: 0,
              archivo: p.archivo,
              titulo: p.titulo,
              descripcion: p.descripcion,
              fecha: fechaHora.fecha,
              hora: fechaHora.hora,
              badgeOrden: badge,
              itinerarioId: p.archivo?.itinerarioId
            });
          } else if (esAudio) {
            secuencia.push({
              id: p.archivo?.id || `audio-${index}`,
              tipo: 'audio',
              url: p.url,
              duracion: 4,
              archivo: p.archivo,
              titulo: p.titulo || 'Nota de Voz',
              descripcion: p.descripcion,
              fecha: fechaHora.fecha,
              hora: fechaHora.hora,
              badgeOrden: badge,
              itinerarioId: p.archivo?.itinerarioId
            });
          } else {
            secuencia.push({
              id: p.archivo?.id || `foto-${index}`,
              tipo: 'imagen',
              url: p.url,
              duracion: 4,
              archivo: p.archivo,
              titulo: p.titulo,
              descripcion: p.descripcion,
              fecha: fechaHora.fecha,
              hora: fechaHora.hora,
              badgeOrden: badge,
              claseMarco: marco,
              itinerarioId: p.archivo?.itinerarioId
            });
          }
        }
      });

    // 3. Escena Final: OUTRO 3D CINEMÁTICA EN MP4 A 60 FPS
    // Cierre del libro de recuerdos y colocación en la Estantería de los Recuerdos
    const subPartes = [this.obtenerDistanciaTotalTexto(), this.obtenerDuracionTotalTexto(), this.obtenerPasosTotalesTexto()].filter(Boolean);
    secuencia.push({
      id: 'outro-3d-cinematica',
      tipo: 'video',
      url: '/assets/videos/outro-libro-3d.mp4',
      duracion: 11.8,
      titulo: this.infoViaje?.nombre || this.infoViaje?.destino || 'Viaje Inolvidable',
      destino: this.obtenerDestinoViajeTexto(),
      descripcion: this.obtenerFechaViajeTexto(),
      fecha: this.obtenerFechaViajeTexto(),
      subtitulo: subPartes.join('  ·  '),
      esOutro3D: true
    });

    return secuencia;
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
    const paginaActual = this.paginas[this.paginaActual];
    const esAnimacion = this.esVideoAnimacionRuta(paginaActual);

    // 🌟 Si es un vídeo de animación de ruta, SIEMPRE avanza tras finalizar completamente.
    // Para vídeos de usuario, solo avanza automáticamente si reproducirVideosCompletos está activado.
    if (this.reproduciendoSlideshow && (this.reproducirVideosCompletos || esAnimacion)) {
      console.log('🎬 Vídeo finalizado en slideshow (animación o vídeo completo): avanzando a la siguiente diapositiva');
      setTimeout(() => {
        if (this.reproduciendoSlideshow) {
          this.avanzarSlideshow();
        }
      }, 500);
    }
  }

  onAudioItemPlay(): void {
    this.bajarVolumenAudioViaje();
    if (this.reproduciendoSlideshow) {
      this.limpiarTimerSlideshow();
    }
  }

  onAudioItemPause(): void {
    this.restaurarVolumenAudioViaje();
  }

  onAudioItemEnded(): void {
    this.restaurarVolumenAudioViaje();
    if (this.reproduciendoSlideshow) {
      console.log('🎵 Audio finalizado en slideshow: avanzando a la siguiente página');
      setTimeout(() => {
        if (this.reproduciendoSlideshow) {
          this.avanzarSlideshow();
        }
      }, 500);
    }
  }

  extraerPuntosClaveParaMapa(itinerarios: any[], mapaGps: Map<number, GpxPoint[]>): PuntoClaveMapa[] {
    const puntosClave: PuntoClaveMapa[] = [];
    if (!itinerarios || itinerarios.length === 0) return puntosClave;

    itinerarios.forEach((it, idx) => {
      const pts = mapaGps.get(it.id);
      let coord: { lat: number; lng: number } | null = null;
      if (pts && pts.length > 0) {
        if (idx === 0 && pts.length > 10) {
          // En la etapa de salida (ej. Zaragoza -> Barcelona), el destino de parada es el final del track (puerto)
          coord = { lat: pts[pts.length - 1].lat, lng: pts[pts.length - 1].lng };
        } else {
          coord = { lat: pts[0].lat, lng: pts[0].lng };
        }
      }

      const ciudad = this.limpiarNombreCiudadPuntoClave(it.destinosPorDia, it.descripcionGeneral || it.descripcion, coord, idx, itinerarios.length);
      if (ciudad && coord) {
        puntosClave.push({
          numero: puntosClave.length + 1,
          nombre: ciudad,
          lat: coord.lat,
          lng: coord.lng,
          subtexto: it.fechaInicio ? this.formatearFechaCorta(it.fechaInicio) : undefined
        });
      }
    });

    return puntosClave;
  }

  limpiarNombreCiudadPuntoClave(dest: string, desc: string, coords: { lat: number; lng: number } | null, idx: number, total: number): string | null {
    let ciudad = (dest || '').split(',')[0].replace(/[\[\]"']/g, '').trim();
    const descL = (desc || '').toLowerCase();

    if (ciudad.toLowerCase().includes('marseille')) return 'Marsella';
    if (ciudad.toLowerCase().includes('firenze') || ciudad.toLowerCase().includes('livorno')) return 'Livorno / Florencia';
    if (ciudad.toLowerCase().includes('españa') && (descL.includes('cerdeña') || (coords && coords.lat < 40 && coords.lat > 38 && coords.lng > 8 && coords.lng < 10))) {
      return 'Cagliari (Cerdeña)';
    }
    if (ciudad.toLowerCase().includes('il-mosta') || ciudad.toLowerCase().includes('malta')) return 'Malta';
    if (ciudad.toLowerCase().includes('palermo')) return 'Palermo';

    if (coords && coords.lat > 41.2 && coords.lat < 41.5 && coords.lng > 2.0 && coords.lng < 2.3) {
      return idx === 0 ? 'Barcelona (Salida)' : 'Barcelona (Llegada)';
    }
    if (ciudad === 'Destino por Asignar' || descL.includes('solo navegando')) return null;
    return ciudad || 'Destino';
  }
}

