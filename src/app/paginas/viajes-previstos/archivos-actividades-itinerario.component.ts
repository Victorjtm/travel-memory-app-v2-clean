import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ArchivoService } from '../../servicios/archivo.service';
import { Archivo } from '../../modelos/archivo';
import { ArchivoAsociado, ArchivoEncontrado } from '../../modelos/archivo-asociado.model';
import { HttpClientModule } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { take } from 'rxjs/operators';

@Component({
  selector: 'app-archivos',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    HttpClientModule,
    FormsModule
  ],
  templateUrl: './archivos-actividades-itinerario.component.html',
  styleUrls: ['./archivos-actividades-itinerario.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ArchivosComponent implements OnInit, OnDestroy {
  archivos: Archivo[] = [];
  actividadId = 0;
  viajePrevistoId = 0;
  itinerarioId = 0;
  archivoSeleccionado: Archivo | null = null;
  urlsArchivos: { [key: number]: string } = {};
  estadoCarga: { [key: number]: 'cargando' | 'listo' | 'error' } = {};
  // ✨ NUEVAS PROPIEDADES PARA GPX INDIVIDUAL
  mostrarModalGPXIndividual = false;
  mapaGPXIndividual: any = null;
  coordenadasGPXIndividual: any[] = [];

  // ✨ PROPIEDADES PARA BÚSQUEDA EN AUDIOPHOTOAPP
  mostrarModalBusquedaAudio = false;
  archivosEncontradosAudio: ArchivoEncontrado[] = [];
  archivoActualBusqueda: Archivo | null = null;
  nombreBaseBusqueda = '';

  // Cache de direcciones para evitar llamadas repetidas a la API
  direccionesCache: { [key: string]: string } = {};

  // Control de rate limiting para Nominatim
  private nominatimQueue: Promise<any> = Promise.resolve();
  private readonly NOMINATIM_DELAY = 2000; // 2 segundos entre peticiones (rate limiting estricto)



  constructor(
    private archivoService: ArchivoService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone  // ← AGREGAR ESTA LÍNEA
  ) { }


  ngOnInit(): void {
    const params = this.route.snapshot.paramMap;

    this.viajePrevistoId = Number(params.get('viajePrevistoId')) || 0;
    this.itinerarioId = Number(params.get('itinerarioId')) || 0;

    const actividadIdParam = params.get('actividadId');
    if (actividadIdParam) {
      this.actividadId = Number(actividadIdParam);
      this.cargarArchivos();
    } else {
      console.error('actividadId no proporcionado en la ruta');
      this.archivos = [];
    }
  }

  ngAfterViewChecked(): void {
    this.archivos.forEach(archivo => {
      console.log(`Vista actualizada - Archivo ${archivo.id}, archivosAsociados:`, archivo.archivosAsociados);
    });
  }


  cargarArchivos(): void {
    this.archivoService.getArchivosPorActividad(this.actividadId).subscribe({
      next: archivos => {
        this.archivos = (archivos ?? []).sort((a, b) => {
          const toTimestamp = (fechaCreacion?: string, horaCaptura?: string): number => {
            if (!fechaCreacion) return Number.MAX_SAFE_INTEGER;

            const fecha = new Date(fechaCreacion);

            if (horaCaptura) {
              const [horas, minutos] = horaCaptura.split(':').map(Number);
              if (!isNaN(horas) && !isNaN(minutos)) {
                fecha.setHours(horas, minutos, 0, 0);
              }
            }

            return fecha.getTime();
          };

          const timestampA = toTimestamp(a.fechaCreacion, a.horaCaptura);
          const timestampB = toTimestamp(b.fechaCreacion, b.horaCaptura);

          return timestampA - timestampB;
        });

        // Cargar archivos asociados para cada archivo
        this.cargarArchivosAsociados();

        this.preGenerarUrlsAsincrono();

        // ✨ NUEVO: Cargar direcciones progresivamente
        this.cargarDireccionesProgresivamente();

        this.cdr.detectChanges();
      },
      error: err => {
        console.error('Error cargando archivos:', err);
        this.archivos = [];
        this.cdr.detectChanges();
      }
    });
  }


  private preGenerarUrlsAsincrono(): void {
    requestAnimationFrame(() => {
      this.archivos.forEach(archivo => {
        this.estadoCarga[archivo.id] = 'cargando';
        this.getFileUrl(archivo);

        if (this.esArchivoMultimedia(archivo) && environment.apiUrl.includes('ngrok')) {
          setTimeout(() => {
            this.verificarYCargarUrl(archivo);
          }, archivo.id * 100);
        } else {
          this.estadoCarga[archivo.id] = 'listo';
        }
      });
      this.cdr.detectChanges();
    });
  }

  private esArchivoMultimedia(archivo: Archivo): boolean {
    return archivo.tipo === 'foto' || archivo.tipo === 'imagen' ||
      archivo.tipo === 'video' || archivo.tipo === 'audio';
  }

  private async verificarYCargarUrl(archivo: Archivo): Promise<void> {
    try {
      const urlSimple = this.urlsArchivos[archivo.id];
      const esAccesible = await this.verificarUrl(urlSimple);

      if (esAccesible) {
        this.estadoCarga[archivo.id] = 'listo';
      } else {
        const blobUrl = await this.archivoService.obtenerArchivoConHeaders(archivo);
        this.urlsArchivos[archivo.id] = blobUrl;
        this.estadoCarga[archivo.id] = 'listo';
      }
    } catch (error) {
      console.warn(`No se pudo optimizar carga para archivo ${archivo.id}:`, error);
      this.estadoCarga[archivo.id] = 'error';
    }

    this.cdr.detectChanges();
  }

  private verificarUrl(url: string): Promise<boolean> {
    return new Promise(resolve => {
      const img = new Image();
      const timeout = setTimeout(() => {
        resolve(false);
      }, 2000);

      img.onload = () => {
        clearTimeout(timeout);
        resolve(true);
      };

      img.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };

      img.src = url;
    });
  }

  // ✨ NUEVO: Convertir coordenadas a dirección legible
  async obtenerDireccion(geolocalizacion: string): Promise<string> {
    if (!geolocalizacion || geolocalizacion === 'No disponible') {
      return 'No disponible';
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

        /* ----------  CORRECCIÓN DE SIGNO  ---------- */
        if (coords.longitudRef === 'W' || coords.longitudRef === 'O' || (!coords.longitudRef && lon > 0)) {
          lon = -Math.abs(lon);
        }
        if (coords.latitudRef === 'S') lat = -Math.abs(lat);
        /* ------------------------------------------ */
      } else if (geolocalizacion.includes(',')) {
        [lat, lon] = geolocalizacion.split(',').map(parseFloat);
      } else {
        return 'Formato inválido';
      }

      if (isNaN(lat) || isNaN(lon)) return 'Coordenadas inválidas';

      // Añadir a la cola de rate limiting
      this.nominatimQueue = this.nominatimQueue.then(() =>
        new Promise(resolve => setTimeout(resolve, this.NOMINATIM_DELAY))
      );

      await this.nominatimQueue;

      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // Timeout de 10 segundos

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

        // Si es timeout, devolver coordenadas formateadas
        if (fetchError.name === 'AbortError') {
          console.warn(`⏱️ Timeout obteniendo dirección para ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
          const fallback = `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;
          this.direccionesCache[geolocalizacion] = fallback;
          return fallback;
        }

        throw fetchError;
      }

      if (!res.ok) {
        console.warn(`❌ Error HTTP ${res.status} para coordenadas ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
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

      // Si es timeout o error de red, mostrar coordenadas formateadas
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



  // ✨ MODIFICADO: Obtener dirección de forma síncrona del cache
  // ✨ MODIFICADO: Obtener dirección de forma síncrona del cache
  getDireccionDisplay(archivo: Archivo): string {
    const geo = archivo.geolocalizacion;

    // Validar que existe la geolocalización
    if (!geo) {
      return 'No disponible';
    }

    // Si ya está en caché, devolverla
    if (this.direccionesCache[geo]) {
      return this.direccionesCache[geo];
    }

    // Mostrar coordenadas mientras se carga la dirección
    try {
      const coords = JSON.parse(geo);
      return `${coords.latitud.toFixed(5)}°, ${coords.longitud.toFixed(5)}° (cargando...)`;
    } catch {
      return 'Cargando ubicación...';
    }
  }

  abrirModal(archivo: Archivo): void {
    this.archivoSeleccionado = archivo;
    document.body.style.overflow = 'hidden';
    this.cdr.detectChanges();
  }

  cerrarModal(): void {
    this.archivoSeleccionado = null;
    document.body.style.overflow = 'auto';
    this.cdr.detectChanges();
  }

  editarArchivo(archivo: Archivo): void {
    this.router.navigate([
      '/viajes-previstos',
      this.viajePrevistoId,
      'itinerarios',
      this.itinerarioId,
      'actividades',
      this.actividadId,
      'archivos',
      'editar',
      archivo.id
    ]);
  }

  getFileUrl(archivo: Archivo): string {
    if (this.urlsArchivos[archivo.id]) {
      return this.urlsArchivos[archivo.id];
    }

    let url: string;
    if (environment.apiUrl.includes('ngrok')) {
      url = `${environment.apiUrl}/archivos/${archivo.id}/mostrar?ngrok-skip-browser-warning=1&_t=${archivo.id}`;
    } else {
      url = this.getDirectFileUrl(archivo);
    }

    this.urlsArchivos[archivo.id] = url;
    return url;
  }

  private getDirectFileUrl(archivo: Archivo): string {
    if (!archivo.rutaArchivo) return '';

    // Si la ruta es relativa (no contiene C:\ ni barras al inicio), usarla directamente
    if (!archivo.rutaArchivo.includes('C:\\') && !archivo.rutaArchivo.startsWith('/')) {
      // Ruta relativa tipo: "10/40/fotos/foto.jpg"
      if (environment.production) {
        return `/uploads/${archivo.rutaArchivo}`;
      } else {
        return `${environment.apiUrl}/uploads/${archivo.rutaArchivo}`;
      }
    }

    // Ruta absoluta antigua (legacy): extraer solo el nombre del archivo
    const nombre = archivo.rutaArchivo.split(/[\\/]/).pop() || '';

    if (environment.production) {
      return `/uploads/${nombre}`;
    } else {
      return `${environment.apiUrl}/uploads/${nombre}`;
    }
  }


  getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toLowerCase() || '';
  }

  formatDate(dateString?: string): string {
    if (!dateString) return 'Fecha no disponible';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Fecha inválida';
    return date.toLocaleString();
  }

  descargarArchivo(id: number): void {
    this.archivoService.descargarArchivo(id).subscribe(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const archivo = this.archivos.find(a => a.id === id);
      a.href = url;
      a.download = archivo?.nombreArchivo || 'archivo';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    });
  }

  eliminarArchivo(id: number): void {
    if (confirm('¿Estás seguro de que quieres eliminar este archivo?')) {
      this.archivoService.eliminarArchivo(id).subscribe({
        next: () => {
          this.archivos = this.archivos.filter(a => a.id !== id);

          if (this.urlsArchivos[id]) {
            if (this.urlsArchivos[id].startsWith('blob:')) {
              URL.revokeObjectURL(this.urlsArchivos[id]);
            }
            delete this.urlsArchivos[id];
            delete this.estadoCarga[id];
          }

          if (this.archivoSeleccionado && this.archivoSeleccionado.id === id) {
            this.cerrarModal();
          }

          this.cdr.detectChanges();
        },
        error: err => {
          console.error('Error al eliminar archivo:', err);
          alert('No se pudo eliminar el archivo. Inténtalo de nuevo.');
        }
      });
    }
  }

  onImgError(ev: Event): void {
    const img = ev.target as HTMLImageElement;
    if (img) {
      img.src = '/assets/images/image-not-found.png';
    }
  }

  volverAItinerario(): void {
    this.router.navigate([
      '/viajes-previstos',
      this.viajePrevistoId,
      'itinerarios',
      this.itinerarioId,
      'actividades'
    ]);
  }

  verEnFormatoLibro(): void {
    this.router.navigate([
      '/viajes-previstos',
      this.viajePrevistoId,
      'itinerarios',
      this.itinerarioId,
      'actividades',
      this.actividadId,
      'libro'
    ]);
  }

  getEstadoCarga(archivoId: number): string {
    return this.estadoCarga[archivoId] || 'listo';
  }

  trackByArchivoId(index: number, archivo: Archivo): number {
    return archivo.id;
  }

  ngOnDestroy(): void {
    Object.values(this.urlsArchivos).forEach(url => {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    });

    document.body.style.overflow = 'auto';
  }

  // ============================================
  // MÉTODOS PARA ARCHIVOS ASOCIADOS (NUEVOS)
  // ============================================

  private cargarArchivosAsociados(): void {
    let pendientes = this.archivos.length;
    this.archivos.forEach(archivo => {
      this.archivoService.getArchivosAsociados(archivo.id).subscribe({
        next: asociados => {
          archivo.archivosAsociados = asociados;
          console.log(`Archivo principal ID ${archivo.id} - Archivos asociados recibidos:`, asociados);
        },
        error: err => {
          console.error(`Error cargando archivos asociados para archivo ${archivo.id}:`, err);
          archivo.archivosAsociados = [];
        },
        complete: () => {
          pendientes--;
          if (pendientes === 0) {
            // Cuando todas las peticiones han acabado, forzamos una sola actualización global
            this.cdr.detectChanges();
            console.log('Todos los archivos asociados cargados y vista actualizada');
          }
        }
      });
    });
  }



  tieneArchivoAsociado(archivo: Archivo, tipo: 'audio' | 'texto' | 'mapa_ubicacion' | 'gpx' | 'manifest' | 'estadisticas'): boolean {
    const tiene = !!archivo.archivosAsociados?.some(a => a.tipo === tipo);
    console.log(`Archivo ${archivo.id} tiene archivo asociado tipo '${tipo}': ${tiene}`);
    return tiene;
  }


  // ✅ DESPUÉS - CORRECTO
  abrirArchivoAsociado(
    archivo: Archivo,
    tipo: 'audio' | 'texto' | 'mapa_ubicacion' | 'gpx' | 'manifest' | 'estadisticas'
  ): void {

    const asociado = archivo.archivosAsociados?.find(a => a.tipo === tipo);
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
        this.mostrarMapaGPXIndividual(asociado);  // ← Abre mapa con satélite
        break;
      case 'manifest':
        this.mostrarJSON(asociado);
        break;
      case 'estadisticas':
        this.mostrarJSON(asociado);
        break;
    }
  }


  private reproducirAudio(asociado: ArchivoAsociado): void {
    console.log('Reproducir audio asociado:', asociado);

    if (!asociado || !asociado.id || !asociado.rutaArchivo) {
      console.error('El objeto asociado no es válido o le faltan propiedades (id o rutaArchivo).');
      alert('Audio asociado inválido o incompleto.');
      return;
    }

    const url = this.archivoService.getUrlArchivoAsociado(asociado);
    console.log('URL archivo asociado:', url);

    if (!url) {
      alert('No se pudo obtener la URL del audio asociado.');
      return;
    }

    // Crear contenedor para audio y botón cerrar
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '20px';
    container.style.left = '50%';
    container.style.transform = 'translateX(-50%)';
    container.style.backgroundColor = 'rgba(0,0,0,0.8)';
    container.style.padding = '10px 20px';
    container.style.borderRadius = '5px';
    container.style.zIndex = '10000';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '10px';

    // Crear elemento audio
    const audioElement = document.createElement('audio');
    audioElement.controls = true;
    audioElement.src = url;
    audioElement.volume = 1.0;

    // Crear botón cerrar
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

    // Construir UI
    container.appendChild(audioElement);
    container.appendChild(btnCerrar);
    document.body.appendChild(container);

    // Intentar reproducir
    audioElement.play().catch(err => {
      console.error('Error reproduciendo audio:', err);
      alert('No se pudo reproducir el audio, usa el botón para cerrar y prueba manualmente');
    });
  }


  private mostrarTexto(asociado: ArchivoAsociado): void {
    // ✅ Validar que el ID existe antes de usarlo
    if (!asociado.id) {
      console.error('El archivo asociado no tiene ID');
      alert('No se pudo cargar el texto: archivo sin ID');
      return;
    }

    this.archivoService.descargarArchivoAsociado(asociado.id).subscribe({
      next: blob => {
        blob.text().then(contenido => {
          alert(`Contenido del texto:\n\n${contenido}`);
        });
      },
      error: err => {
        console.error('Error mostrando texto:', err);
        alert('No se pudo cargar el texto');
      }
    });
  }

  private mostrarImagen(asociado: ArchivoAsociado): void {
    console.log('Mostrar imagen asociada:', asociado);

    if (!asociado || !asociado.id || !asociado.rutaArchivo) {
      console.error('El objeto asociado no es válido o le faltan propiedades (id o rutaArchivo).');
      alert('Imagen asociada inválida o incompleta.');
      return;
    }

    const url = this.archivoService.getUrlArchivoAsociado(asociado);
    console.log('URL imagen asociada:', url);

    if (!url) {
      alert('No se pudo obtener la URL de la imagen asociada.');
      return;
    }

    // ========================================
    // SOLUCIÓN SIMPLIFICADA - MODAL BÁSICO
    // ========================================

    // Crear overlay de fondo
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.95);
      z-index: 10000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    `;

    // Wrapper para la imagen (con overflow)
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      width: 100%;
      height: 85%;
      overflow: scroll;
      -webkit-overflow-scrolling: touch;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    `;

    // Imagen
    const img = document.createElement('img');
    img.src = url;
    img.style.cssText = `
      display: block;
      width: 100%;
      height: auto;
      user-select: none;
      -webkit-user-select: none;
      pointer-events: auto;
    `;
    img.draggable = false;

    // Botón cerrar
    const btnCerrar = document.createElement('button');
    btnCerrar.textContent = 'Cerrar';
    btnCerrar.style.cssText = `
      margin-top: 15px;
      padding: 12px 30px;
      background: #f44336;
      color: white;
      border: none;
      border-radius: 5px;
      font-size: 18px;
      font-weight: bold;
      cursor: pointer;
      z-index: 10002;
    `;

    const cerrar = () => {
      document.body.removeChild(overlay);
      document.body.style.overflow = 'auto';
    };

    btnCerrar.onclick = cerrar;

    // ========================================
    // ZOOM CON PINCH - DETECCIÓN BÁSICA
    // ========================================

    let escala = 1;
    let tocando = false;

    wrapper.addEventListener('touchstart', (e: TouchEvent) => {
      console.log('👆 touchstart - dedos:', e.touches.length);
      if (e.touches.length === 2) {
        tocando = true;
        e.preventDefault();
        console.log('✌️ DOS DEDOS DETECTADOS');
      }
    }, { passive: false });

    wrapper.addEventListener('touchmove', (e: TouchEvent) => {
      if (e.touches.length === 2 && tocando) {
        e.preventDefault();

        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const distancia = Math.sqrt(dx * dx + dy * dy);

        // Cambiar tamaño de la imagen directamente
        escala = Math.min(Math.max(distancia / 100, 1), 5);
        img.style.width = `${escala * 100}%`;

        console.log('🔎 ZOOM - Escala:', escala.toFixed(2), 'Distancia:', distancia.toFixed(0));
      }
    }, { passive: false });

    wrapper.addEventListener('touchend', (e: TouchEvent) => {
      console.log('🖐️ touchend - dedos restantes:', e.touches.length);
      if (e.touches.length < 2) {
        tocando = false;
        console.log('✅ FIN ZOOM - Escala final:', escala.toFixed(2));
      }
    });

    // Construir UI
    wrapper.appendChild(img);
    overlay.appendChild(wrapper);
    overlay.appendChild(btnCerrar);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Error
    img.onerror = () => {
      alert('No se pudo cargar la imagen');
      cerrar();
    };

    console.log('✨ Modal imagen creado - ESPERANDO TOQUES');
  }

  /**
   * Descargar archivo asociado
   */
  private descargarArchivoAsociado(asociado: ArchivoAsociado, nombreDefault: string): void {
    if (!asociado.id) {
      console.error('El archivo asociado no tiene ID');
      alert('No se pudo descargar el archivo');
      return;
    }

    this.archivoService.descargarArchivoAsociado(asociado.id).subscribe({
      next: blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = asociado.nombreArchivo || nombreDefault;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      },
      error: err => {
        console.error('Error descargando archivo:', err);
        alert('No se pudo descargar el archivo');
      }
    });
  }
  /**
   * Mostrar contenido JSON (manifest o estadísticas)
   */
  private mostrarJSON(asociado: ArchivoAsociado): void {
    if (!asociado.id) {
      console.error('El archivo asociado no tiene ID');
      alert('No se pudo cargar el archivo JSON');
      return;
    }

    this.archivoService.descargarArchivoAsociado(asociado.id).subscribe({
      next: blob => {
        blob.text().then(contenido => {
          try {
            const json = JSON.parse(contenido);
            const formateado = JSON.stringify(json, null, 2);

            // Crear modal para mostrar JSON formateado
            const overlay = document.createElement('div');
            overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.95);
            z-index: 10000;
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
            font-size: 16px;
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
            alert(`Error parseando JSON:\n\n${contenido.substring(0, 500)}`);
          }
        });
      },
      error: err => {
        console.error('Error mostrando JSON:', err);
        alert('No se pudo cargar el archivo JSON');
      }
    });
  }

  // ✨ MOSTRAR MAPA GPX INDIVIDUAL
  private mostrarMapaGPXIndividual(asociado: ArchivoAsociado): void {
    if (!asociado || !asociado.id || !asociado.rutaArchivo) {
      alert('Archivo GPX inválido');
      return;
    }

    console.log('📍 Obteniendo GPX individual:', asociado.nombreArchivo);

    this.archivoService.descargarArchivoAsociado(asociado.id).subscribe({
      next: (blob) => {
        const reader = new FileReader();
        reader.onload = (e: any) => {
          const gpxText = e.target.result;
          this.parseGPXIndividual(gpxText);
          this.mostrarModalGPXIndividual = true;

          this.cdr.detectChanges();

          this.ngZone.onStable.pipe(take(1)).subscribe(() => {
            this.inicializarMapaGPXIndividual();
          });
        };
        reader.readAsText(blob);
      },
      error: err => {
        console.error('❌ Error obteniendo GPX:', err);
        alert('Error al cargar el GPX');
      }
    });
  }

  // ✨ PARSEAR GPX INDIVIDUAL
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

  // ✨ INICIALIZAR MAPA GPX INDIVIDUAL
  private inicializarMapaGPXIndividual(): void {
    if (this.coordenadasGPXIndividual.length === 0) {
      console.warn('⚠️ No hay coordenadas');
      return;
    }

    import('leaflet').then(L => {
      if (this.mapaGPXIndividual) {
        this.mapaGPXIndividual.remove();
      }

      const container = document.getElementById('mapa-gpx-individual');
      if (!container) {
        console.error('❌ Contenedor no encontrado');
        return;
      }

      container.innerHTML = '';

      try {
        this.mapaGPXIndividual = L.map(container, {
          attributionControl: true,
          zoomControl: true
        }).setView(
          [this.coordenadasGPXIndividual[0][0], this.coordenadasGPXIndividual[0][1]],
          13
        );

        // ✨ CAPA DE SATÉLITE (ESRI)
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: 'Tiles &copy; Esri',
            maxZoom: 18
          }
        ).addTo(this.mapaGPXIndividual);

        // Dibujar ruta con polyline roja
        L.polyline(this.coordenadasGPXIndividual, {
          color: '#FF0000',
          weight: 3,
          opacity: 0.8,
          dashArray: '5, 10'
        }).addTo(this.mapaGPXIndividual);

        // Marcador de INICIO (verde)
        L.circleMarker(this.coordenadasGPXIndividual[0], {
          radius: 8,
          fillColor: '#00FF00',
          color: '#000',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.8
        }).bindPopup('🟢 Inicio').addTo(this.mapaGPXIndividual);

        // Marcador de FIN (rojo)
        L.circleMarker(this.coordenadasGPXIndividual[this.coordenadasGPXIndividual.length - 1], {
          radius: 8,
          fillColor: '#FF0000',
          color: '#000',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.8
        }).bindPopup('🔴 Fin').addTo(this.mapaGPXIndividual);

        // Ajustar vista a la ruta completa
        const bounds = L.latLngBounds(this.coordenadasGPXIndividual);
        this.mapaGPXIndividual.fitBounds(bounds, { padding: [50, 50] });

        console.log('✅ Mapa GPX individual inicializado');
      } catch (error) {
        console.error('❌ Error inicializando Leaflet:', error);
      }
    });
  }

  // ✨ CERRAR MODAL GPX INDIVIDUAL
  cerrarModalGPXIndividual(): void {
    this.mostrarModalGPXIndividual = false;
    if (this.mapaGPXIndividual) {
      this.mapaGPXIndividual.remove();
      this.mapaGPXIndividual = null;
    }
  }


  /**
   * Cargar direcciones de forma progresiva con delay entre peticiones
   */
  private async cargarDireccionesProgresivamente(): Promise<void> {
    console.log(`🌍 Iniciando carga progresiva de ${this.archivos.length} direcciones...`);

    for (let i = 0; i < this.archivos.length; i++) {
      const archivo = this.archivos[i];

      if (archivo.geolocalizacion && archivo.geolocalizacion !== 'No disponible') {
        // Si ya está en caché, continuar
        if (this.direccionesCache[archivo.geolocalizacion]) {
          continue;
        }

        // Obtener dirección con rate limiting
        try {
          const direccion = await this.obtenerDireccion(archivo.geolocalizacion);

          // Forzar actualización de la vista
          this.cdr.detectChanges();

          console.log(`✅ Dirección ${i + 1}/${this.archivos.length} cargada:`, direccion);

        } catch (error) {
          console.warn(`⚠️ Error cargando dirección ${i + 1}:`, error);
        }
      }
    }

    console.log('🏁 Carga de direcciones completada');
  }

  // ============================================
  // MÉTODOS PARA BÚSQUEDA EN AUDIOPHOTOAPP
  // ============================================

  /**
   * Verifica si el archivo tiene archivos asociados (cualquier tipo)
   */
  tieneArchivosAsociados(archivo: Archivo): boolean {
    return !!(archivo.archivosAsociados && archivo.archivosAsociados.length > 0);
  }

  /**
   * Extrae el nombre base sin extensión
   */
  extraerNombreBase(nombreArchivo: string): string {
    return nombreArchivo.replace(/\.[^/.]+$/, '');
  }

  /**
   * Abre selector de carpeta para buscar en AudioPhotoApp
   */
  async buscarEnAudioPhotoApp(archivo: Archivo): Promise<void> {
    const nombreBase = this.extraerNombreBase(archivo.nombreArchivo);
    this.nombreBaseBusqueda = nombreBase;
    this.archivoActualBusqueda = archivo;

    try {
      const input = document.createElement('input');
      input.type = 'file';
      (input as any).webkitdirectory = true;
      input.multiple = true;

      const filesPromise = new Promise<FileList | null>((resolve) => {
        input.onchange = () => resolve(input.files);
        (input as any).oncancel = () => resolve(null);
      });

      input.click();
      const files = await filesPromise;

      if (!files || files.length === 0) return;

      this.archivosEncontradosAudio = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const nombreSinExt = this.extraerNombreBase(file.name);

        if (nombreSinExt.startsWith(nombreBase) && file.name !== archivo.nombreArchivo) {
          const ext = file.name.split('.').pop()?.toLowerCase() || '';
          let tipo: 'audio' | 'gpx' | 'mapa_ubicacion' = 'mapa_ubicacion';

          if (ext === 'gpx') tipo = 'gpx';
          else if (['m4a', 'mp3', 'wav'].includes(ext)) tipo = 'audio';

          this.archivosEncontradosAudio.push({
            nombre: file.name,
            rutaRelativa: (file as any).webkitRelativePath || file.name,
            tipo,
            file,
            tamaño: file.size,
            seleccionado: true
          });
        }
      }

      if (this.archivosEncontradosAudio.length > 0) {
        this.mostrarModalBusquedaAudio = true;
      } else {
        alert(`No se encontraron archivos que empiecen con "${nombreBase}"`);
      }
      this.cdr.detectChanges();

    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  }

  hayArchivosSeleccionados(): boolean {
    return this.archivosEncontradosAudio.some(a => a.seleccionado);
  }

  async importarArchivosSeleccionados(): Promise<void> {
    const seleccionados = this.archivosEncontradosAudio.filter(a => a.seleccionado);
    if (!seleccionados.length || !this.archivoActualBusqueda) return;

    let importados = 0;
    for (const archivo of seleccionados) {
      const formData = new FormData();
      formData.append('archivo', archivo.file);
      formData.append('archivoPrincipalId', this.archivoActualBusqueda.id.toString());
      formData.append('tipo', archivo.tipo);
      formData.append('nombreArchivo', archivo.nombre);

      try {
        const response = await fetch(`${environment.apiUrl}/archivos-asociados/subir`, {
          method: 'POST',
          body: formData
        });
        if (response.ok) importados++;
      } catch (err) {
        console.error(`Error importando ${archivo.nombre}:`, err);
      }
    }

    alert(`${importados} de ${seleccionados.length} archivos importados`);
    this.cerrarModalBusquedaAudio();
    this.cargarArchivosAsociados();
    this.cdr.detectChanges();
  }

  cerrarModalBusquedaAudio(): void {
    this.mostrarModalBusquedaAudio = false;
    this.archivosEncontradosAudio = [];
    this.archivoActualBusqueda = null;
    this.nombreBaseBusqueda = '';
    this.cdr.detectChanges();
  }

  getIconoTipo(tipo: string): string {
    switch (tipo) {
      case 'audio': return 'fa fa-volume-up';
      case 'gpx': return 'fa fa-map-marked-alt';
      case 'mapa_ubicacion': return 'fa fa-map';
      default: return 'fa fa-file';
    }
  }

}