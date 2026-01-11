import { Component, OnInit, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { take } from 'rxjs/operators';

import { Actividad } from '../../../modelos/actividad.model';
import { ActividadesItinerariosService } from '../../../servicios/actividades-itinerarios.service';

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

  // ✨ VER GPX EN MAPA INTERACTIVO CON SATÉLITE Y FOTOS
  verGPX(actividadId: number): void {
    console.log('📍 Obteniendo GPX para actividad:', actividadId);
    this.actividadService.obtenerGPX(actividadId).subscribe({
      next: (blob) => {
        const reader = new FileReader();
        reader.onload = (e: any) => {
          const gpxText = e.target.result;
          this.parseGPX(gpxText);
          this.actividadSeleccionada = actividadId;
          this.mostrarModalGPXMapa = true;

          // ✨ CORRECCIÓN FINAL: Forzar cambios + esperar en Angular Zone
          this.cdr.detectChanges();

          this.ngZone.onStable.pipe(
            take(1)
          ).subscribe(() => {
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

        // Dibujar ruta con polyline roja
        L.polyline(this.coordenadasGPX, {
          color: '#FF0000',
          weight: 3,
          opacity: 0.8,
          dashArray: '5, 10'
        }).addTo(this.mapaGPX);

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
    const backendUrl = 'http://192.168.1.22:3000';
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

  // ✨ NUEVO: Añadir marcador de foto individual
  private anadirMarcadorFoto(lat: number, lng: number, nombre: string, rutaArchivo: string): void {
    if (!this.mapaGPX) return;

    import('leaflet').then(L => {
      // Icono rojo para fotos (como en la APK)
      const fotoIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        iconSize: [30, 49],
        iconAnchor: [15, 49],
        popupAnchor: [1, -40],
        shadowSize: [50, 50]
      });

      const popupContent = `<div style="text-align: center; min-width: 140px; padding: 8px;">
        <p style="margin: 5px 0; font-size: 12px;"><strong>📷 Foto</strong></p>
        <p style="margin: 3px 0; font-size: 10px; word-break: break-all; color: #666;">${nombre}</p>
        <p style="margin: 8px 0; font-size: 11px; color: #2196F3; font-weight: bold;">Haz clic para ver</p>
      </div>`;

      const marker = L.marker([lat, lng], { icon: fotoIcon })
        .addTo(this.mapaGPX!)
        .bindPopup(popupContent);

      (marker as any).fotoRuta = rutaArchivo;

      marker.on('click', () => {
        setTimeout(() => {
          this.abrirModalFoto(rutaArchivo, nombre);
        }, 300);
      });

      console.log(`✅ Marcador de foto añadido: ${nombre} en [${lat}, ${lng}]`);
    });
  }

  // ✨ NUEVO: Abrir modal con la foto
  private abrirModalFoto(rutaArchivo: string, nombre: string): void {
    console.log('🔍 Abriendo foto:', nombre);
    console.log('📁 rutaArchivo:', rutaArchivo);

    const backendUrl = 'http://192.168.1.22:3000';
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
}