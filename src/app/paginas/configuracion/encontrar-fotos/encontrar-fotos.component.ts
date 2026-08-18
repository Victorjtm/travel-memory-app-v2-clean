import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

export interface ItinerarioCompleto {
  id: number;
  viajePrevistoId: number;
  fechaInicio: string;
  fechaFin: string;
  destinosPorDia: string;
  descripcionGeneral: string;
  tipoDeViaje?: string;
  viajeNombre?: string;
  viajeDestino?: string;
  etiquetaCompleta: string;
}

export interface ArchivoEncontrado {
  nombre: string;
  rutaCompleta: string;
  tamano: number;
  fechaCreacion: string;
  extension: string;
  tipo: 'imagen' | 'video';
}

export interface ActividadItinerario {
  id: number;
  nombre: string;
  fecha?: string;
  horaInicio?: string;
  horaFin?: string;
  tipoActividad?: string;
}

@Component({
  selector: 'app-encontrar-fotos',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './encontrar-fotos.component.html',
  styleUrls: ['./encontrar-fotos.component.scss']
})
export class EncontrarFotosComponent implements OnInit {

  // Formulario de búsqueda
  rutaCarpeta: string = 'C:\\recorridos\\Recorrido_20260630';
  itinerarioIdSeleccionado: number | null = null;
  itinerariosDisponibles: ItinerarioCompleto[] = [];

  // Estados de carga
  cargandoItinerarios: boolean = false;
  buscando: boolean = false;
  asignando: boolean = false;
  busquedaRealizada: boolean = false;

  // Resultados de la comparación
  totalEnDisco: number = 0;
  totalEnItinerario: number = 0;
  archivosFaltantes: ArchivoEncontrado[] = [];
  archivosFiltrados: ArchivoEncontrado[] = [];
  actividadesItinerario: ActividadItinerario[] = [];

  // Filtros y Selección
  terminoBusqueda: string = '';
  filtroTipo: string = '';
  archivosSeleccionados: Set<string> = new Set(); // Guarda rutaCompleta

  // Modal de asignación
  mostrarModalAsignacion: boolean = false;
  actividadDestinoId: number | null = null;

  // Modal de visualización multimedia
  archivoModal: ArchivoEncontrado | null = null;

  // Detección de soporte de explorador del navegador
  soportaSelector: boolean = false;

  private readonly apiUrl = environment.apiUrl;

  constructor(
    private http: HttpClient,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.soportaSelector = 'showDirectoryPicker' in window;
    this.cargarItinerarios();
  }

  cargarItinerarios(): void {
    this.cargandoItinerarios = true;
    this.http.get<ItinerarioCompleto[]>(`${this.apiUrl}/api/explorador/itinerarios-completos`)
      .subscribe({
        next: (itins) => {
          this.itinerariosDisponibles = itins || [];
          this.cargandoItinerarios = false;
          this.cdr.detectChanges();
        },
        error: (err) => {
          console.error('❌ Error cargando itinerarios:', err);
          this.cargandoItinerarios = false;
          this.cdr.detectChanges();
        }
      });
  }

  async seleccionarCarpetaNavegador(): Promise<void> {
    try {
      if ('showDirectoryPicker' in window) {
        const handle = await (window as any).showDirectoryPicker();
        if (handle && handle.name) {
          // En navegadores web, showDirectoryPicker solo da el nombre relativo por seguridad,
          // pero si el usuario tiene ruta en portapapeles o Windows, permitimos escribirla
          alert(`📁 Carpeta seleccionada: "${handle.name}".\n\nPor favor, verifica que la ruta completa sea correcta (ej: C:\\recorridos\\${handle.name})`);
          this.rutaCarpeta = `C:\\recorridos\\${handle.name}`;
        }
      } else {
        alert('Tu navegador no soporta el selector nativo. Por favor, escribe o pega la ruta completa de la carpeta.');
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.warn('Selección de carpeta:', e);
      }
    }
  }

  buscarFotos(): void {
    if (!this.rutaCarpeta || !this.rutaCarpeta.trim()) {
      alert('⚠️ Por favor, introduce la ruta de la carpeta que deseas escanear.');
      return;
    }

    if (!this.itinerarioIdSeleccionado) {
      alert('⚠️ Por favor, selecciona un itinerario para comparar.');
      return;
    }

    this.buscando = true;
    this.busquedaRealizada = false;
    this.archivosSeleccionados.clear();

    const payload = {
      rutaCarpeta: this.rutaCarpeta.trim(),
      itinerarioId: this.itinerarioIdSeleccionado
    };

    this.http.post<any>(`${this.apiUrl}/api/explorador/comparar-itinerario`, payload)
      .subscribe({
        next: (resp) => {
          this.buscando = false;
          this.busquedaRealizada = true;
          this.totalEnDisco = resp.totalEnDisco || 0;
          this.totalEnItinerario = resp.totalEnItinerario || 0;
          this.archivosFaltantes = resp.archivos || [];
          this.actividadesItinerario = resp.actividades || [];
          this.filtrarArchivos();
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.buscando = false;
          console.error('❌ Error comparando carpeta con itinerario:', err);
          const msg = err.error?.error || err.error?.detalles || 'No se pudo leer la carpeta o comparar el itinerario. Comprueba que la ruta exista.';
          alert(`❌ ${msg}`);
          this.cdr.detectChanges();
        }
      });
  }

  filtrarArchivos(): void {
    let list = [...this.archivosFaltantes];

    if (this.terminoBusqueda && this.terminoBusqueda.trim()) {
      const term = this.terminoBusqueda.toLowerCase().trim();
      list = list.filter(a => a.nombre.toLowerCase().includes(term));
    }

    if (this.filtroTipo) {
      list = list.filter(a => a.tipo === this.filtroTipo);
    }

    this.archivosFiltrados = list;
  }

  // Selección de archivos
  toggleSeleccion(archivo: ArchivoEncontrado): void {
    if (this.archivosSeleccionados.has(archivo.rutaCompleta)) {
      this.archivosSeleccionados.delete(archivo.rutaCompleta);
    } else {
      this.archivosSeleccionados.add(archivo.rutaCompleta);
    }
  }

  estaSeleccionado(archivo: ArchivoEncontrado): boolean {
    return this.archivosSeleccionados.has(archivo.rutaCompleta);
  }

  seleccionarTodos(): void {
    this.archivosFiltrados.forEach(a => this.archivosSeleccionados.add(a.rutaCompleta));
  }

  deseleccionarTodos(): void {
    this.archivosSeleccionados.clear();
  }

  // Previews
  getPreviewUrl(rutaCompleta: string): string {
    return `${this.apiUrl}/api/explorador/preview-local?ruta=${encodeURIComponent(rutaCompleta)}`;
  }

  abrirModal(archivo: ArchivoEncontrado): void {
    this.archivoModal = archivo;
  }

  cerrarModal(): void {
    this.archivoModal = null;
  }

  // Modal de Asignación
  abrirModalAsignacion(): void {
    if (this.archivosSeleccionados.size === 0) {
      alert('⚠️ Selecciona al menos un archivo para asignar.');
      return;
    }

    if (this.actividadesItinerario.length === 0) {
      alert('⚠️ Este itinerario no tiene actividades creadas. Crea una actividad en el itinerario antes de asignarle fotos.');
      return;
    }

    this.actividadDestinoId = this.actividadesItinerario[0]?.id || null;
    this.mostrarModalAsignacion = true;
  }

  cerrarModalAsignacion(): void {
    this.mostrarModalAsignacion = false;
  }

  confirmarAsignacion(): void {
    if (!this.actividadDestinoId) {
      alert('⚠️ Por favor, selecciona la actividad destino.');
      return;
    }

    const archivosAImportar = this.archivosFaltantes.filter(a => this.archivosSeleccionados.has(a.rutaCompleta));
    if (archivosAImportar.length === 0) {
      alert('⚠️ No hay archivos seleccionados para importar.');
      return;
    }

    const confirmacion = confirm(`¿Estás seguro de que deseas importar y asignar ${archivosAImportar.length} archivo(s) a la actividad seleccionada?`);
    if (!confirmacion) return;

    this.asignando = true;
    const payload = {
      archivos: archivosAImportar,
      actividadId: this.actividadDestinoId,
      itinerarioId: this.itinerarioIdSeleccionado
    };

    this.http.post<any>(`${this.apiUrl}/api/explorador/importar-y-asignar`, payload)
      .subscribe({
        next: (res) => {
          this.asignando = false;
          this.mostrarModalAsignacion = false;
          alert(`✅ ¡Excelente! Se han importado y asignado ${res.importados || archivosAImportar.length} archivo(s) con éxito.`);
          
          // Eliminar de la lista local los archivos ya asignados
          const rutasAsignadas = new Set(archivosAImportar.map(a => a.rutaCompleta));
          this.archivosFaltantes = this.archivosFaltantes.filter(a => !rutasAsignadas.has(a.rutaCompleta));
          this.archivosSeleccionados.clear();
          this.filtrarArchivos();
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.asignando = false;
          console.error('❌ Error asignando archivos:', err);
          alert('❌ Hubo un error al importar y asignar los archivos. Revisa la consola del servidor.');
          this.cdr.detectChanges();
        }
      });
  }

  // Utilidades
  formatBytes(bytes: number | undefined): string {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  volverAConfiguracion(): void {
    this.router.navigate(['/configuracion']);
  }
}
