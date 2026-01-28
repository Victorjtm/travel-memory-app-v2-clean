import { Component, OnInit, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { take } from 'rxjs/operators';

import { Actividad } from '../../../modelos/actividad.model';
import { ActividadesItinerariosService } from '../../../servicios/actividades-itinerarios.service';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-actividades-itinerarios',
  standalone: true,
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    RouterModule
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

  urlMapaDataURL: string | null = null;
  estadisticasActuales: any = null;
  actividadSeleccionada: number | null = null;

  // ✨ PROPIEDADES PARA MAPA GPX
  mapaGPX: any = null;
  coordenadasGPX: any[] = [];

  // ✅ NUEVAS PROPIEDADES: Panel de estadísticas
  showStatsPanel = true;
  panelExpanded = false;
  trackSegments: any[] = [];
  turningPoint: any = null;

  // ✅ NUEVAS PROPIEDADES: Estadísticas completas para el panel
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
      tiempoVueltaFormateado: '00:00:00'
    };


  // ✅ COLORES POR MODO DE TRANSPORTE
  private readonly MODE_COLORS = {
    walking: { outbound: '#059669', return: '#6EE7B7' },
    running: { outbound: '#2563EB', return: '#93C5FD' },
    cycling: { outbound: '#D97706', return: '#FCD34D' },
    driving: { outbound: '#DC2626', return: '#FCA5A5' }
  };


  constructor(
    private actividadService: ActividadesItinerariosService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    private http: HttpClient
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

  // ✅ MEJORADO: Ver GPX con carga de estadísticas
  verGPX(actividadId: number): void {
    console.log('📍 Obteniendo GPX para actividad:', actividadId);

    // ✅ PASO 1: Cargar estadísticas primero
    this.actividadService.obtenerEstadisticas(actividadId).subscribe({
      next: (stats) => {
        console.log('✅ Estadísticas recibidas:', stats);

        // Mapear estadísticas al formato del panel
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
          tiempoVueltaFormateado: stats.idaVuelta?.vuelta?.tiempo || '00:00:00'
        };

        console.log('✅ Estadísticas mapeadas:', this.estadisticasGPX);
      },
      error: err => console.warn('⚠️ Error cargando estadísticas:', err)
    });

    // ✅ PASO 2: Cargar GPX
    this.actividadService.obtenerGPX(actividadId).subscribe({
      next: (blob) => {
        const reader = new FileReader();
        reader.onload = (e: any) => {
          const gpxText = e.target.result;
          this.parseGPX(gpxText);
          this.actividadSeleccionada = actividadId;
          this.mostrarModalGPXMapa = true;

          this.cdr.detectChanges();
          this.ngZone.onStable.pipe(take(1)).subscribe(() => {
            this.inicializarMapaGPX();
          });
        };
        reader.readAsText(blob);
      },
      error: err => console.error('❌ Error obteniendo GPX:', err)
    });
  }


  // Parsear GPX y extraer coordenadas
  parseGPX(gpxText: string): void {
    const parser = new DOMParser();
    const gpxDoc = parser.parseFromString(gpxText, 'text/xml');

    // Extraer puntos de ruta (trkpt)
    const trkpts = gpxDoc.getElementsByTagName('trkpt');
    this.coordenadasGPX = [];

    for (let i = 0; i < trkpts.length; i++) {
      const lat = parseFloat(trkpts[i].getAttribute('lat') || '0');
      const lon = parseFloat(trkpts[i].getAttribute('lon') || '0');

      if (lat !== 0 && lon !== 0) {
        this.coordenadasGPX.push([lat, lon]);
      }
    }

    console.log('✅ GPX parseado. Puntos encontrados:', this.coordenadasGPX.length);
  }

  // Inicializar mapa Leaflet con satélite y fotos
  inicializarMapaGPX(): void {
    if (this.coordenadasGPX.length === 0) {
      console.warn('⚠️ No hay coordenadas para mostrar');
      return;
    }

    // Importar Leaflet dinámicamente
    import('leaflet').then(L => {
      // Destruir mapa anterior si existe
      if (this.mapaGPX) {
        this.mapaGPX.remove();
      }

      // ✨ MEJORADO: Buscar contenedor con validaciones
      const container = document.getElementById('mapa-gpx-container');
      if (!container) {
        console.error('❌ Contenedor del mapa no encontrado');
        return;
      }

      // ✨ IMPORTANTE: Limpiar contenedor antes
      container.innerHTML = '';

      try {
        this.mapaGPX = L.map(container, {
          attributionControl: true,
          zoomControl: true
        }).setView([this.coordenadasGPX[0][0], this.coordenadasGPX[0][1]], 13);

        // ✨ CAPA DE SATÉLITE (ESRI)
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: 'Tiles &copy; Esri',
            maxZoom: 18
          }
        ).addTo(this.mapaGPX);

        // ✅ MEJORADO: Dibujar ruta con polyline roja
        const routeLine = L.polyline(this.coordenadasGPX, {
          color: '#FF0000',
          weight: 4,
          opacity: 0.85,
          smoothFactor: 1
        }).addTo(this.mapaGPX);

        // ✅ NUEVO: Añadir flechas direccionales cada N puntos
        this.addDirectionArrows(L, this.coordenadasGPX);


        // Marcador de INICIO (verde)
        L.circleMarker(this.coordenadasGPX[0], {
          radius: 8,
          fillColor: '#00FF00',
          color: '#000',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.8
        }).bindPopup('🟢 Inicio').addTo(this.mapaGPX);

        // Marcador de FIN (rojo)
        L.circleMarker(this.coordenadasGPX[this.coordenadasGPX.length - 1], {
          radius: 8,
          fillColor: '#FF0000',
          color: '#000',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.8
        }).bindPopup('🔴 Fin').addTo(this.mapaGPX);

        // ✨ NUEVO: Añadir marcadores de fotos (como en la APK)
        this.cargarYAnadirFotos();

        // Ajustar vista a la ruta completa
        const bounds = L.latLngBounds(this.coordenadasGPX);
        this.mapaGPX.fitBounds(bounds, { padding: [50, 50] });

        console.log('✅ Mapa GPX inicializado con satélite ESRI. Puntos:', this.coordenadasGPX.length);
      } catch (error) {
        console.error('❌ Error inicializando Leaflet:', error);
      }
    });
  }

  // ✨ NUEVO: Cargar fotos desde backend y añadirlas al mapa
  private cargarYAnadirFotos(): void {
    if (!this.mapaGPX || !this.actividadSeleccionada) {
      console.warn('⚠️ Mapa o ID de actividad no disponible');
      return;
    }

    // ✨ USAR LA URL DEL BACKEND CORRECTAMENTE
    const backendUrl = environment.apiUrl;
    const url = `${backendUrl}/archivos?actividadId=${this.actividadSeleccionada}`;

    console.log('🔗 URL de solicitud:', url);

    this.http.get<any[]>(url).subscribe({
      next: (archivos: any[]) => {
        console.log('📷 Archivos obtenidos del backend:', archivos);

        // Filtrar fotos con geolocalización
        const fotos = archivos.filter((f: any) =>
          f.tipo === 'foto' && f.geolocalizacion
        );

        console.log(`📷 Fotos con coordenadas GPS: ${fotos.length}`);

        fotos.forEach((foto: any) => {
          // ✨ DEPURACIÓN COMPLETA
          console.log('📸 FOTO COMPLETA:', foto);
          console.log('📁 rutaArchivo:', foto.rutaArchivo);
          console.log('🏷️ nombreArchivo:', foto.nombreArchivo);
          console.log('📍 geolocalizacion:', foto.geolocalizacion);

          try {
            const geoData = typeof foto.geolocalizacion === 'string'
              ? JSON.parse(foto.geolocalizacion)
              : foto.geolocalizacion;

            if (geoData.latitud && geoData.longitud) {
              console.log(`✅ Foto válida: ${foto.nombreArchivo} en [${geoData.latitud}, ${geoData.longitud}]`);

              this.anadirMarcadorFoto(
                geoData.latitud,
                geoData.longitud,
                foto.nombreArchivo,
                foto.rutaArchivo
              );
            } else {
              console.warn(`⚠️ Foto sin coordenadas válidas:`, geoData);
            }
          } catch (err) {
            console.warn(`⚠️ Error parseando geolocalización de ${foto.nombreArchivo}:`, err);
          }
        });

        console.log(`✅ Procesadas ${fotos.length} fotos con GPS`);
      },
      error: err => {
        console.error('❌ Error cargando archivos:', err);
        console.error('Status:', err.status);
        console.error('URL intentada:', url);
      }
    });
  }

  // ✅ MEJORADO: Añadir marcador de foto más visible
  private anadirMarcadorFoto(lat: number, lng: number, nombre: string, rutaArchivo: string): void {
    if (!this.mapaGPX) return;

    import('leaflet').then(L => {
      // ✅ NUEVO: Icono personalizado más grande con badge
      const fotoIcon = L.divIcon({
        className: 'photo-marker-custom',
        html: `
        <div class="photo-marker-wrapper">
          <!-- Círculo de fondo con sombra -->
          <div class="photo-marker-circle">
            <svg width="44" height="44" viewBox="0 0 44 44">
              <!-- Sombra -->
              <circle cx="22" cy="24" r="18" fill="rgba(0,0,0,0.3)" />
              <!-- Fondo blanco -->
              <circle cx="22" cy="22" r="18" fill="white" stroke="#FF4444" stroke-width="3"/>
              <!-- Icono de cámara -->
              <g transform="translate(10, 10)">
                <path d="M12 3L14 6H18C19.1 6 20 6.9 20 8V18C20 19.1 19.1 20 18 20H6C4.9 20 4 19.1 4 18V8C4 6.9 4.9 6 6 6H10L12 3Z" 
                      fill="#FF4444"/>
                <circle cx="12" cy="13" r="3.5" fill="white"/>
              </g>
            </svg>
          </div>
          <!-- Badge con emoji -->
          <div class="photo-marker-badge">📷</div>
        </div>
      `,
        iconSize: [44, 44],
        iconAnchor: [22, 44],
        popupAnchor: [0, -44]
      });

      // Popup mejorado con preview
      const popupContent = `
      <div class="photo-popup-custom">
        <div class="photo-popup-header">
          <span class="photo-icon">📷</span>
          <strong>Foto</strong>
        </div>
        <p class="photo-name">${nombre}</p>
        <div class="photo-popup-action">
          <span class="click-hint">👆 Haz clic en el marcador</span>
        </div>
      </div>
    `;

      const marker = L.marker([lat, lng], {
        icon: fotoIcon,
        zIndexOffset: 2000 // ✅ Por encima de flechas y línea
      })
        .addTo(this.mapaGPX!)
        .bindPopup(popupContent, {
          className: 'photo-popup-leaflet',
          maxWidth: 250
        });

      // Guardar referencia de la foto
      (marker as any).fotoRuta = rutaArchivo;

      // Click para abrir modal (ajustado el timeout)
      marker.on('click', () => {
        setTimeout(() => {
          this.abrirModalFoto(rutaArchivo, nombre);
        }, 100); // Reducido de 300ms a 100ms para respuesta más rápida
      });

      console.log(`✅ Marcador de foto añadido: ${nombre} en [${lat}, ${lng}]`);
    });
  }

  // ✨ NUEVO: Abrir modal con la foto
  private abrirModalFoto(rutaArchivo: string, nombre: string): void {
    console.log('🔍 Abriendo foto:', nombre);
    console.log('📁 rutaArchivo:', rutaArchivo);

    const backendUrl = environment.apiUrl;
    const urlFoto = `${backendUrl}/uploads/${rutaArchivo}`;

    console.log('🖼️ URL final de la imagen:', urlFoto);

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

    const titulo = document.createElement('h3');
    titulo.textContent = '📷 Foto';
    titulo.style.cssText = 'margin: 0 0 10px 0; color: #333;';

    const imagen = document.createElement('img');
    imagen.src = urlFoto;
    imagen.style.cssText = `
    width: 100%;
    height: auto;
    border-radius: 8px;
    margin: 10px 0;
    background: #f0f0f0;
    cursor: pointer;
  `;

    imagen.onerror = () => {
      console.error('❌ Error cargando imagen desde:', urlFoto);
      imagen.alt = 'Error al cargar la imagen';
      imagen.style.background = '#ff6b6b';
    };

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
    contenido.appendChild(imagen);
    contenido.appendChild(nombreEl);
    contenido.appendChild(btnContainer);

    modal.appendChild(contenido);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);

    console.log('✅ Modal de foto abierto');
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
  toggleMapView(): void {
    this.showStatsPanel = !this.showStatsPanel;
    console.log(`🗺️ Panel: ${this.showStatsPanel ? 'VISIBLE' : 'OCULTO'}`);
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
  private addDirectionArrows(L: any, coordinates: any[], color: string = '#FF0000'): void {
    if (!this.mapaGPX || coordinates.length < 2) return;

    const totalPoints = coordinates.length;
    const interval = Math.max(Math.floor(totalPoints / 12), 5);

    console.log(`📍 Añadiendo flechas SVG cada ${interval} puntos (total: ${totalPoints})`);

    for (let i = interval; i < coordinates.length; i += interval) {
      const prevPoint = coordinates[i - 1];
      const currentPoint = coordinates[i];

      const angle = this.calculateAngle(prevPoint, currentPoint);

      const arrowIcon = L.divIcon({
        className: 'direction-arrow-svg',
        html: `
        <svg width="32" height="32" viewBox="0 0 32 32" 
             style="transform: rotate(${angle}deg); filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
          <!-- Borde blanco -->
          <path d="M16 4 L26 26 L16 20 L6 26 Z" 
                fill="white" 
                stroke="white" 
                stroke-width="2"/>
          <!-- Flecha principal -->
          <path d="M16 6 L24 24 L16 19 L8 24 Z" 
                fill="${color}" 
                stroke="none"/>
        </svg>
      `,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
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

}
