import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ArchivoService } from '../../../../servicios/archivo.service';
import { Archivo } from '../../../../modelos/archivo';
import { HttpClientModule } from '@angular/common/http';
import { environment } from '../../../../../environments/environment';
import { FormsModule } from '@angular/forms';
import { ActividadesItinerariosService } from '../../../../servicios/actividades-itinerarios.service';
import { Actividad } from '../../../../modelos/actividad.model';
import { ItinerarioService } from '../../../../servicios/itinerario.service';
import { AutoAsignacionService } from '../../../../servicios/auto-asignacion.service';

// ✅ NUEVO: Interfaces para escaneo de disco
interface ArchivoEncontrado {
  nombre: string;
  rutaCompleta: string;
  tamano: number;
  fechaCreacion: string; // Cambiar Date a string para coincidir con el modelo Archivo
  extension: string;
  tipo: 'imagen' | 'video' | 'audio' | 'foto' | 'texto';
}

@Component({
  selector: 'app-archivos-sin-asignacion',
  standalone: true,
  imports: [CommonModule, RouterModule, HttpClientModule, FormsModule],
  templateUrl: './crud-archivos-sin-asignacion.component.html',
  styleUrls: ['./crud-archivos-sin-asignacion.component.scss'],
})
export class CrudArchivosSinAsignacionComponent implements OnInit {
  // ========== PROPIEDADES ORIGINALES ==========
  archivos: Archivo[] = [];
  archivosFiltrados: Archivo[] = [];
  archivoSeleccionado: Archivo | null = null;
  archivoParaAsignar: Archivo | null = null;
  mostrarModalAsignacion = false;
  actividadSeleccionada: number | null = null;
  terminoBusqueda = '';
  filtroTipo = '';
  actividades: Actividad[] = [];
  itinerarios: any[] = [];
  actividadesDelDiaSeleccionado: Actividad[] = [];

  // ✅ NUEVO: Propiedades para selector de rutas
  mostrarRutasComunes = false;
  rutaValida = false;
  soportaSelector = false;
  usuarioActual = '';

  // ========== NUEVAS PROPIEDADES - SELECCIÓN MÚLTIPLE ==========
  /** Map que agrupa archivos por fecha (YYYY-MM-DD) */
  archivosPorDia: Map<string, Archivo[]> = new Map();

  /** Set de IDs de archivos actualmente seleccionados */
  archivosSeleccionados: Set<number> = new Set();

  /** Fecha del día desde el cual se están seleccionando archivos */
  diaSeleccionado: string | null = null;

  /** Array de fechas ordenadas (más reciente primero) */
  diasOrdenados: string[] = [];

  /** Set de fechas expandidas en el acordeón */
  diasExpandidos: Set<string> = new Set();

  /** Filtro de fecha seleccionada (para el dropdown) */
  diaSeleccionadoFiltro = '';

  /** Control para mostrar modal de asignación múltiple */
  mostrarModalAsignacionMultiple = false;

  /** Actividad seleccionada para asignación múltiple */
  actividadSeleccionadaMultiples: number | null = null;

  // ========== NUEVAS PROPIEDADES - ESCANEO DE DISCO ==========
  /** Control para mostrar modal de escaneo */
  mostrarModalEscaneo = false;

  /** Ruta del disco o carpeta a escanear */
  rutaEscaneo = '';

  /** Indica si el escaneo está en progreso */
  escaneando = false;

  /** Indica si el escaneo se completó */
  escaneoCompletado = false;

  /** Número de carpetas procesadas durante el escaneo */
  carpetasProcesadas = 0;

  /** Array de archivos encontrados durante el escaneo */
  archivosEncontrados: ArchivoEncontrado[] = [];

  /** Progreso del escaneo (0-100) */
  progresoEscaneo = 0;

  /** Opción: Solo escanear fotos y videos */
  soloFotosVideos = true;

  /** Opción: Leer fecha EXIF de metadatos */
  leerFechaExif = true;

  /** Opción: Copiar archivos a uploads */
  copiarArchivos = true;

  /** Control para cancelar escaneo */
  private cancelarEscaneoFlag = false;

  /** Set de índices de archivos encontrados seleccionados para importar */
  archivosEncontradosSeleccionados: Set<number> = new Set();

  /** ✅ NUEVO: Toggle para mostrar/ocultar imágenes en preview */
  mostrarImagenesEncontradas: boolean = false;

  /** Control para mostrar modal de auto-asignación con IA */
  mostrarModalAutoAsignacion = false;
  /** Destino detectado automáticamente por IA */
  destinoDetectadoIA: string | null = null;
  /** Destino introducido manualmente por el usuario */
  destinoManualIA = '';
  /** Indica si la auto-asignación está en progreso */
  autoAsignando = false;
  /** Mensaje de progreso durante auto-asignación */
  mensajeProgreso = '';

  /** Mapa de extensiones seleccionadas {extensión: boolean} */
  extensionesSeleccionadas: { [key: string]: boolean } = {};

  // Extensiones válidas por tipo (públicas para usar en template)
  readonly EXTENSIONES_IMAGEN = [
    'jpg',
    'jpeg',
    'png',
    'gif',
    'webp',
    'heic',
    'heif',
    'bmp',
  ];
  readonly EXTENSIONES_VIDEO = [
    'mp4',
    'mov',
    'avi',
    'mkv',
    'wmv',
    'flv',
    'webm',
    'm4v',
  ];
  readonly EXTENSIONES_AUDIO = [
    'mp3',
    'wav',
    'ogg',
    'aac',
    'm4a',
    'flac',
    'wma',
  ];
  readonly EXTENSIONES_TEXTO = [
    'txt',
    'pdf',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'csv',
  ];

  constructor(
    private archivoService: ArchivoService,
    private actividadService: ActividadesItinerariosService,
    private itinerarioService: ItinerarioService,
    private router: Router,
    private autoAsignacionService: AutoAsignacionService
  ) { }

  ngOnInit(): void {
    this.cargarTodosLosArchivos();
    this.cargarActividades();
    this.cargarItinerarios();
    // ✅ NUEVO: Detectar soporte de selector de carpetas
    this.soportaSelector = 'webkitdirectory' in document.createElement('input');

    // ✅ NUEVO: Obtener usuario actual (solo funciona en entorno local)
    this.usuarioActual = this.obtenerUsuarioActual();
  }

  /**
   * Carga todos los archivos sin asignar y agrupa por fecha
   */
  cargarTodosLosArchivos(): void {
    this.archivoService.getArchivos().subscribe({
      next: (archivos) => {
        // Filtrar archivos con actividadId === 0 (sin asignar)
        this.archivos = (archivos ?? []).filter(
          (archivo) => archivo.actividadId === 0
        );
        this.agruparArchivosPorDia();
        this.filtrarArchivos();
      },
      error: (err) => {
        console.error('Error cargando archivos:', err);
        this.archivos = [];
        this.archivosFiltrados = [];
        this.archivosPorDia.clear();
        this.diasOrdenados = [];
      },
    });
  }

  cargarActividades(): void {
    this.actividadService.getActividades().subscribe({
      next: (actividades) => {
        this.actividades = actividades ?? [];
      },
      error: (err) => {
        console.error('Error cargando actividades:', err);
        this.actividades = [];
      },
    });
  }

  cargarItinerarios(): void {
    this.itinerarioService.getItinerarios().subscribe({
      next: (itinerarios) => {
        this.itinerarios = itinerarios ?? [];
        console.log('✅ Itinerarios cargados:', this.itinerarios.length);
      },
      error: (err) => {
        console.error('Error cargando itinerarios:', err);
        this.itinerarios = [];
      },
    });
  }

  // ========== MÉTODOS DE AGRUPACIÓN POR FECHA ==========

  agruparArchivosPorDia(): void {
    this.archivosPorDia.clear();

    for (const archivo of this.archivos) {
      const fecha = this.obtenerFechaDelArchivo(archivo);

      if (!this.archivosPorDia.has(fecha)) {
        this.archivosPorDia.set(fecha, []);
      }

      this.archivosPorDia.get(fecha)!.push(archivo);
    }

    this.diasOrdenados = Array.from(this.archivosPorDia.keys())
      .sort()
      .reverse();
    console.log(`✅ Archivos agrupados por ${this.diasOrdenados.length} días`);
  }

  obtenerFechaDelArchivo(archivo: Archivo): string {
    if (!archivo.fechaCreacion) {
      return 'sin-fecha';
    }

    const fecha = new Date(archivo.fechaCreacion);
    const año = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');

    return `${año}-${mes}-${dia}`;
  }

  formatearFecha(fecha: string): string {
    if (!fecha || fecha === 'sin-fecha') {
      return 'Sin fecha';
    }

    try {
      const [año, mes, dia] = fecha.split('-');
      const date = new Date(`${año}-${mes}-${dia}T00:00:00`);

      const opciones: Intl.DateTimeFormatOptions = {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        weekday: 'long',
      };

      return date.toLocaleDateString('es-ES', opciones);
    } catch (error) {
      console.error('Error formateando fecha:', error);
      return fecha;
    }
  }

  obtenerActividadesDelDia(fecha: string | null): Actividad[] {
    console.log(
      '\n🔍 ========== DIAGNÓSTICO obtenerActividadesDelDia =========='
    );
    console.log('📅 Fecha recibida:', fecha);
    console.log('📋 Total itinerarios cargados:', this.itinerarios.length);
    console.log('🎯 Total actividades cargadas:', this.actividades.length);

    if (!fecha || fecha === 'sin-fecha') {
      console.warn('❌ Fecha inválida o "sin-fecha"');
      return [];
    }

    // Parsear fecha SIN hora para evitar problemas de zona horaria
    const [año, mes, dia] = fecha.split('-');
    const fechaSeleccionada = new Date(
      parseInt(año),
      parseInt(mes) - 1,
      parseInt(dia)
    );

    console.log(
      '📆 Fecha parseada (sin hora):',
      fechaSeleccionada.toISOString().split('T')[0]
    );

    // Buscar itinerarios que contengan esta fecha
    const itinerariosDelDia = this.itinerarios.filter((itinerario) => {
      const [añoIni, mesIni, diaIni] = itinerario.fechaInicio
        .split('T')[0]
        .split('-');
      const fechaInicio = new Date(
        parseInt(añoIni),
        parseInt(mesIni) - 1,
        parseInt(diaIni)
      );

      const [añoFin, mesFin, diaFin] = itinerario.fechaFin
        .split('T')[0]
        .split('-');
      const fechaFin = new Date(
        parseInt(añoFin),
        parseInt(mesFin) - 1,
        parseInt(diaFin)
      );

      const coincide =
        fechaSeleccionada >= fechaInicio && fechaSeleccionada <= fechaFin;

      console.log(`   📂 Itinerario ${itinerario.id}:`, {
        fechaInicio: fechaInicio.toISOString().split('T')[0],
        fechaFin: fechaFin.toISOString().split('T')[0],
        coincide: coincide ? '✅' : '❌',
      });

      return coincide;
    });

    console.log(`✅ Itinerarios que coinciden: ${itinerariosDelDia.length}`);

    if (itinerariosDelDia.length === 0) {
      console.warn(`⚠️ No hay itinerarios para la fecha ${fecha}`);
      console.warn(
        '💡 Verifica que existan itinerarios con esa fecha en la BD'
      );
      return [];
    }

    const idsItinerarios = itinerariosDelDia.map((it) => it.id);
    console.log('🔑 IDs de itinerarios:', idsItinerarios);

    const actividadesFiltradas = this.actividades.filter((actividad) => {
      const coincide = idsItinerarios.includes(actividad.itinerarioId);

      if (coincide) {
        console.log(
          `   ✅ Actividad ${actividad.id}: "${actividad.nombre}" (itinerario ${actividad.itinerarioId})`
        );
      }

      return coincide;
    });

    console.log(
      `📊 RESULTADO: ${actividadesFiltradas.length} actividades encontradas`
    );
    console.log('========================================================\n');

    return actividadesFiltradas;
  }

  // ========== MÉTODOS DE SELECCIÓN MÚLTIPLE ==========

  toggleSeleccionArchivo(archivo: Archivo): void {
    if (!this.puedeSeleccionar(archivo)) {
      alert(
        '⚠️ Solo puedes seleccionar archivos del mismo día.\nPor favor, deselecciona los archivos del otro día primero.'
      );
      return;
    }

    const fecha = this.obtenerFechaDelArchivo(archivo);

    if (this.archivosSeleccionados.has(archivo.id)) {
      this.archivosSeleccionados.delete(archivo.id);
      console.log(`❌ Archivo ${archivo.id} deseleccionado`);

      if (this.archivosSeleccionados.size === 0) {
        this.diaSeleccionado = null;
      }
    } else {
      if (!this.diaSeleccionado) {
        this.diaSeleccionado = fecha;
      }

      this.archivosSeleccionados.add(archivo.id);
      console.log(`✅ Archivo ${archivo.id} seleccionado`);
    }
  }

  puedeSeleccionar(archivo: Archivo): boolean {
    if (this.archivosSeleccionados.size === 0) {
      return true;
    }

    const fechaArchivo = this.obtenerFechaDelArchivo(archivo);

    if (this.diaSeleccionado === fechaArchivo) {
      return true;
    }

    return false;
  }

  seleccionarTodosDelDia(fecha: string): void {
    if (this.diaSeleccionado && this.diaSeleccionado !== fecha) {
      alert(
        '⚠️ Ya tienes archivos seleccionados de otro día.\nPor favor, deselecciona todo primero.'
      );
      return;
    }

    const archivosDelDia = this.archivosPorDia.get(fecha) || [];

    const todosSeleccionados = archivosDelDia.every((a) =>
      this.archivosSeleccionados.has(a.id)
    );

    if (todosSeleccionados) {
      archivosDelDia.forEach((a) => this.archivosSeleccionados.delete(a.id));
      this.diaSeleccionado = null;
      console.log(`🔄 Todos los archivos del día ${fecha} deseleccionados`);
    } else {
      this.diaSeleccionado = fecha;
      archivosDelDia.forEach((a) => this.archivosSeleccionados.add(a.id));
      console.log(
        `✅ Todos los ${archivosDelDia.length} archivos del día ${fecha} seleccionados`
      );
    }
  }

  deseleccionarTodos(): void {
    this.archivosSeleccionados.clear();
    this.diaSeleccionado = null;
    this.actividadSeleccionadaMultiples = null;
    console.log('🔄 Selección limpiada');
  }

  estaSeleccionado(id: number): boolean {
    return this.archivosSeleccionados.has(id);
  }

  contarSeleccionadosDelDia(fecha: string): number {
    const archivosDelDia = this.archivosPorDia.get(fecha) || [];
    return archivosDelDia.filter((a) => this.archivosSeleccionados.has(a.id))
      .length;
  }

  obtenerArchivoPorId(id: number): Archivo {
    return this.archivos.find((a) => a.id === id) || ({} as Archivo);
  }

  obtenerIconoTipo(archivo: Archivo): string {
    if (this.esImagen(archivo)) return 'fa-image';
    if (this.esVideo(archivo)) return 'fa-video-camera';
    if (this.esAudio(archivo)) return 'fa-music';
    return 'fa-file';
  }

  // ========== MÉTODOS DE ACORDEÓN ==========

  toggleExpandirDia(fecha: string): void {
    if (this.diasExpandidos.has(fecha)) {
      this.diasExpandidos.delete(fecha);
      console.log(`▶ Día ${fecha} colapsado`);
    } else {
      this.diasExpandidos.add(fecha);
      console.log(`▼ Día ${fecha} expandido`);
    }
  }

  // ========== FILTRADO MODIFICADO ==========

  filtrarArchivos(): void {
    const archivosFiltradosPorBusquedaYTipo = this.archivos.filter(
      (archivo) => {
        const coincideBusqueda =
          !this.terminoBusqueda ||
          archivo.nombreArchivo
            .toLowerCase()
            .includes(this.terminoBusqueda.toLowerCase()) ||
          (archivo.descripcion &&
            archivo.descripcion
              .toLowerCase()
              .includes(this.terminoBusqueda.toLowerCase()));

        const coincideTipo =
          !this.filtroTipo || archivo.tipo === this.filtroTipo;

        return coincideBusqueda && coincideTipo;
      }
    );

    this.archivosFiltrados = this.diaSeleccionadoFiltro
      ? archivosFiltradosPorBusquedaYTipo.filter(
        (archivo) =>
          this.obtenerFechaDelArchivo(archivo) === this.diaSeleccionadoFiltro
      )
      : archivosFiltradosPorBusquedaYTipo;

    console.log(
      `📊 Archivos filtrados: ${this.archivosFiltrados.length}/${this.archivos.length}`
    );
  }

  // ========== MÉTODOS DE TIPO DE ARCHIVO ==========

  esImagen(archivo: Archivo): boolean {
    return archivo.tipo === 'imagen' || archivo.tipo === 'foto';
  }

  esVideo(archivo: Archivo): boolean {
    return archivo.tipo === 'video';
  }

  esAudio(archivo: Archivo): boolean {
    return archivo.tipo === 'audio';
  }

  esDocumento(archivo: Archivo): boolean {
    return (
      !this.esImagen(archivo) &&
      !this.esVideo(archivo) &&
      !this.esAudio(archivo)
    );
  }

  // ========== MÉTODOS DE MODAL INDIVIDUAL (1x1) ==========

  abrirModal(archivo: Archivo): void {
    this.archivoSeleccionado = archivo;
    document.body.style.overflow = 'hidden';
  }

  cerrarModal(): void {
    this.archivoSeleccionado = null;
    document.body.style.overflow = 'auto';
  }

  asignarAActividad(archivo: Archivo): void {
    this.archivoParaAsignar = archivo;
    this.actividadSeleccionada = null;
    this.mostrarModalAsignacion = true;
    document.body.style.overflow = 'hidden';
  }

  confirmarAsignacion(): void {
    if (this.archivoParaAsignar && this.actividadSeleccionada) {
      this.archivoService
        .asignarArchivoAActividad(
          this.archivoParaAsignar.id,
          this.actividadSeleccionada
        )
        .subscribe({
          next: () => {
            this.cerrarModalAsignacion();
            this.cargarTodosLosArchivos();
            alert('✅ Archivo asignado correctamente a la actividad.');
          },
          error: (err) => {
            console.error('Error al asignar archivo:', err);
            alert(
              '❌ No se pudo asignar el archivo a la actividad. Inténtalo de nuevo.'
            );
          },
        });
    } else {
      alert('⚠️ Por favor, selecciona una actividad para asignar el archivo.');
    }
  }

  cerrarModalAsignacion(): void {
    this.mostrarModalAsignacion = false;
    this.archivoParaAsignar = null;
    this.actividadSeleccionada = null;
    document.body.style.overflow = 'auto';
  }

  // ========== MÉTODOS DE MODAL MÚLTIPLE ==========

  abrirModalAsignacionMultiple(): void {
    if (this.archivosSeleccionados.size === 0) {
      alert('⚠️ Debes seleccionar al menos un archivo.');
      return;
    }

    this.mostrarModalAsignacionMultiple = true;
    this.actividadSeleccionadaMultiples = null;
    document.body.style.overflow = 'hidden';
  }

  cerrarModalAsignacionMultiple(): void {
    this.mostrarModalAsignacionMultiple = false;
    this.actividadSeleccionadaMultiples = null;
    document.body.style.overflow = 'auto';
  }

  confirmarAsignacionMultiple(): void {
    if (!this.actividadSeleccionadaMultiples) {
      alert('⚠️ Por favor, selecciona una actividad.');
      return;
    }

    if (this.archivosSeleccionados.size === 0) {
      alert('⚠️ No hay archivos seleccionados.');
      return;
    }

    const archivoIds = Array.from(this.archivosSeleccionados);
    const cantidadArchivos = archivoIds.length;

    const confirmar = confirm(
      `¿Estás seguro de que deseas asignar ${cantidadArchivos} archivo(s) a la actividad seleccionada?`
    );

    if (!confirmar) {
      return;
    }

    let completados = 0;
    let errores = 0;

    archivoIds.forEach((id) => {
      this.archivoService
        .asignarArchivoAActividad(id, this.actividadSeleccionadaMultiples!)
        .subscribe({
          next: () => {
            completados++;
            console.log(
              `✅ Archivo ${id} asignado (${completados}/${cantidadArchivos})`
            );

            if (completados + errores === cantidadArchivos) {
              this.finalizarAsignacionMultiple(completados, errores);
            }
          },
          error: (err) => {
            errores++;
            console.error(`❌ Error al asignar archivo ${id}:`, err);

            if (completados + errores === cantidadArchivos) {
              this.finalizarAsignacionMultiple(completados, errores);
            }
          },
        });
    });
  }

  private finalizarAsignacionMultiple(
    completados: number,
    errores: number
  ): void {
    this.cerrarModalAsignacionMultiple();
    this.deseleccionarTodos();
    this.cargarTodosLosArchivos();

    if (errores === 0) {
      alert(
        `✅ ¡Excelente! Se asignaron ${completados} archivo(s) correctamente.`
      );
    } else {
      alert(
        `⚠️ Se asignaron ${completados} archivo(s).\n❌ Hubo ${errores} error(es) en la asignación.`
      );
    }
  }

  // ========== MÉTODOS DESCARGA Y ELIMINACIÓN ==========

  descargarArchivo(id: number): void {
    this.archivoService.descargarArchivo(id).subscribe((blob) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const archivo = this.archivos.find((a) => a.id === id);
      a.href = url;
      a.download = archivo?.nombreArchivo || 'archivo';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    });
  }

  eliminarArchivo(id: number): void {
    if (
      confirm(
        '¿Estás seguro de que quieres eliminar permanentemente este archivo?'
      )
    ) {
      this.archivoService.eliminarArchivo(id).subscribe({
        next: () => {
          this.archivos = this.archivos.filter((a) => a.id !== id);
          this.agruparArchivosPorDia();
          this.filtrarArchivos();

          this.archivosSeleccionados.delete(id);

          if (this.archivoSeleccionado && this.archivoSeleccionado.id === id) {
            this.cerrarModal();
          }

          alert('✅ Archivo eliminado correctamente.');
        },
        error: (err) => {
          console.error('Error al eliminar archivo:', err);
          alert('❌ No se pudo eliminar el archivo. Inténtalo de nuevo.');
        },
      });
    }
  }

  /**
   * ✅ NUEVO: Elimina múltiples archivos seleccionados
   * Se puede llamar con una fecha específica (desde la cabecera del día) o sin ella (global)
   */
  eliminarArchivosSeleccionados(fecha?: string): void {
    const idsAEliminar: number[] = [];

    // Si se especifica fecha, solo tomamos los seleccionados de esa fecha
    if (fecha) {
      const archivosDelDia = this.archivosPorDia.get(fecha) || [];
      archivosDelDia.forEach((a) => {
        if (this.archivosSeleccionados.has(a.id)) {
          idsAEliminar.push(a.id);
        }
      });
    } else {
      // Globalmente todos los seleccionados (por si se agrega botón global en el futuro)
      idsAEliminar.push(...Array.from(this.archivosSeleccionados));
    }

    if (idsAEliminar.length === 0) {
      alert('⚠️ No hay archivos seleccionados para eliminar.');
      return;
    }

    if (
      !confirm(
        `⚠️ ALERTA: ¿Estás seguro de que quieres eliminar permanentemente ${idsAEliminar.length} archivos?\n\nEsta acción NO se puede deshacer.`
      )
    ) {
      return;
    }

    let eliminados = 0;
    let errores = 0;
    const total = idsAEliminar.length;

    // Mostrar indicador de carga...
    // (Opcional: podrías agregar una variable loading si quisieras bloquear la UI)

    idsAEliminar.forEach((id) => {
      this.archivoService.eliminarArchivo(id).subscribe({
        next: () => {
          eliminados++;
          // Eliminar de la lista local inmediatamente para feedback visual
          this.archivos = this.archivos.filter((a) => a.id !== id);
          this.archivosSeleccionados.delete(id);
          this.checkFinalizarEliminacionMasiva(eliminados, errores, total);
        },
        error: (err) => {
          console.error(`Error eliminando archivo ${id}:`, err);
          errores++;
          this.checkFinalizarEliminacionMasiva(eliminados, errores, total);
        },
      });
    });
  }

  private checkFinalizarEliminacionMasiva(
    eliminados: number,
    errores: number,
    total: number
  ): void {
    if (eliminados + errores === total) {
      // Re-agrupar y filtrar para actualizar la vista
      this.agruparArchivosPorDia();
      this.filtrarArchivos();

      if (errores > 0) {
        alert(
          `⚠️ Proceso finalizado.\n\n✅ Eliminados: ${eliminados}\n❌ Errores: ${errores}`
        );
      } else {
        alert(`✅ Se han eliminado ${eliminados} archivos correctamente.`);
      }
    }
  }

  desasignarDeActividad(id: number): void {
    this.archivoService.asignarArchivoAActividad(id, 0).subscribe({
      next: () => {
        this.cargarTodosLosArchivos();
        alert('✅ Archivo desasignado correctamente.');
      },
      error: (err) => {
        console.error('Error al desasignar archivo:', err);
        alert('❌ No se pudo desasignar el archivo. Inténtalo de nuevo.');
      },
    });
  }

  // ========== MÉTODOS UTILIDAD ==========

  getFileUrl(archivo: Archivo): string {
    if (!archivo.rutaArchivo) return '';
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

  contarArchivosSinAsignar(): number {
    return this.archivos.length;
  }

  contarArchivosAsignados(): number {
    return 0;
  }

  obtenerArchivosDelDia(fecha: string): Archivo[] {
    return this.archivosPorDia.get(fecha) || [];
  }

  obtenerIdsSeleccionadosArray(): number[] {
    return Array.from(this.archivosSeleccionados);
  }

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

  // ========== MÉTODOS DE ESCANEO DE DISCO (NUEVO) ==========
  // 📍 INSERTAR DESPUÉS DEL MÉTODO: volverAConfiguracion()
  // 📍 ANTES DE: (fin de clase)

  /**
   * Abre el modal de escaneo de disco
   */
  abrirEscaneoDisco(): void {
    this.mostrarModalEscaneo = true;
    this.reiniciarVariablesEscaneo();
    this.inicializarExtensionesSeleccionadas();
    document.body.style.overflow = 'hidden';
  }

  /**
   * ✅ NUEVO: Abre selector de carpeta nativo (Electron o File System Access API)
   */
  private seleccionandoCarpeta = false; // Añadir esta propiedad arriba en las propiedades de la clase

  async seleccionarCarpetaNavegador() {
    if (!this.soportaSelector) {
      alert(
        '❌ Tu navegador no soporta el selector de carpetas.\n\nPor favor, introduce la ruta manualmente.'
      );
      return;
    }

    this.seleccionandoCarpeta = true;

    try {
      // OPCIÓN 1: Intentar usar Electron Dialog (mejor para desktop)
      if ((window as any).require) {
        try {
          const { ipcRenderer } = (window as any).require('electron');
          const rutaSeleccionada = await ipcRenderer.invoke('select-directory');

          if (rutaSeleccionada) {
            this.rutaEscaneo = rutaSeleccionada;
            this.validarRutaEscaneo();
            console.log(
              '📁 [Electron] Carpeta seleccionada:',
              rutaSeleccionada
            );
          }
          this.seleccionandoCarpeta = false;
          return;
        } catch (electronError) {
          console.warn('⚠️ Electron dialog no disponible:', electronError);
          // Continuar con File System Access API
        }
      }

      // OPCIÓN 2: Usar File System Access API (navegadores modernos)
      if (!('showDirectoryPicker' in window)) {
        alert(
          '❌ Tu navegador no soporta la selección de carpetas.\n\n' +
          'Opciones:\n' +
          '1. Usa Chrome/Edge 86+\n' +
          '2. Usa Firefox con entrada manual\n' +
          '3. O escribe la ruta manualmente'
        );
        this.seleccionandoCarpeta = false;
        return;
      }

      const directoryHandle = await (window as any).showDirectoryPicker({
        mode: 'read',
      });

      // Guardar el handle para uso posterior
      (this as any).directoryHandle = directoryHandle;

      // Usar el nombre como referencia visual
      this.rutaEscaneo = directoryHandle.name;
      this.validarRutaEscaneo();

      console.log('📁 [Browser] Carpeta seleccionada:', directoryHandle.name);
      console.log(
        '💡 Nota: En navegadores web, solo se muestra el nombre de la carpeta por seguridad'
      );
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('❌ Error seleccionando carpeta:', error);
        alert('❌ Error al seleccionar la carpeta: ' + error.message);
      } else {
        console.log('ℹ️ Selección de carpeta cancelada por el usuario');
      }
    } finally {
      this.seleccionandoCarpeta = false;
    }
  }

  /**
   * ✅ NUEVO: Escanea una carpeta usando File System Access API
   */
  private async escanearCarpetaNavegador(directoryHandle: any): Promise<void> {
    this.escaneando = true;
    this.archivosEncontrados = [];
    this.carpetasProcesadas = 0;
    this.progresoEscaneo = 0;

    await this.procesarDirectorioNavegador(directoryHandle);

    if (!this.cancelarEscaneoFlag) {
      this.archivosEncontrados.sort(
        (a, b) =>
          new Date(b.fechaCreacion).getTime() -
          new Date(a.fechaCreacion).getTime()
      );
      this.progresoEscaneo = 100;
      this.escaneoCompletado = true;
      console.log(
        `✅ Escaneo completado: ${this.archivosEncontrados.length} archivos encontrados`
      );
    }

    this.escaneando = false;
  }

  /**
   * ✅ NUEVO: Procesa recursivamente directorios con File System Access API
   */
  private async procesarDirectorioNavegador(
    directoryHandle: any,
    rutaBase: string = ''
  ): Promise<void> {
    if (this.cancelarEscaneoFlag) return;

    this.carpetasProcesadas++;

    try {
      for await (const entry of directoryHandle.values()) {
        if (this.cancelarEscaneoFlag) break;

        const rutaCompleta = rutaBase
          ? `${rutaBase}/${entry.name}`
          : entry.name;

        if (entry.kind === 'directory') {
          // Recursión en subdirectorios
          await this.procesarDirectorioNavegador(entry, rutaCompleta);
        } else if (entry.kind === 'file') {
          const file = await entry.getFile();
          const extension = this.obtenerExtension(file.name).toLowerCase();

          if (this.esExtensionValida(extension)) {
            const archivoEncontrado: ArchivoEncontrado = {
              nombre: file.name,
              rutaCompleta: rutaCompleta,
              tamano: file.size,
              fechaCreacion: new Date(file.lastModified).toISOString(),
              extension: extension,
              tipo: this.determinarTipo(extension),
            };

            if (!this.esDuplicado(archivoEncontrado)) {
              this.archivosEncontrados.push(archivoEncontrado);
            }
          }
        }

        this.progresoEscaneo = Math.min(
          95,
          Math.floor((this.archivosEncontrados.length / 100) * 100)
        );
      }
    } catch (error) {
      console.error('Error procesando directorio:', error);
    }
  }

  /**
   * Cierra el modal de escaneo
   */
  cerrarModalEscaneo(): void {
    this.mostrarModalEscaneo = false;
    this.reiniciarVariablesEscaneo();
    document.body.style.overflow = 'auto';
  }

  /**
   * Reinicia todas las variables relacionadas con el escaneo
   */
  private reiniciarVariablesEscaneo(): void {
    this.escaneando = false;
    this.escaneoCompletado = false;
    this.carpetasProcesadas = 0;
    this.archivosEncontrados = [];
    this.archivosEncontradosSeleccionados.clear();
    this.progresoEscaneo = 0;
    this.cancelarEscaneoFlag = false;
  }
  /**
   * Reinicia el escaneo para escanear otra carpeta
   */
  reiniciarEscaneo(): void {
    this.reiniciarVariablesEscaneo();
    this.rutaEscaneo = '';
  }

  /**
   * Inicia el proceso de escaneo recursivo
   */
  async iniciarEscaneo(): Promise<void> {
    if (!this.rutaEscaneo.trim()) {
      alert('⚠️ Por favor, ingresa una ruta válida.');
      return;
    }

    this.escaneando = true;
    this.escaneoCompletado = false;
    this.archivosEncontrados = [];
    this.carpetasProcesadas = 0;
    this.progresoEscaneo = 0;
    this.cancelarEscaneoFlag = false;

    console.log(`🔍 Iniciando escaneo en: ${this.rutaEscaneo}`);

    try {
      await this.escanearDiscoRecursivo(this.rutaEscaneo);

      if (!this.cancelarEscaneoFlag) {
        // Ordenar archivos por fecha (más reciente primero)
        this.archivosEncontrados.sort(
          (a, b) =>
            new Date(b.fechaCreacion).getTime() -
            new Date(a.fechaCreacion).getTime()
        );

        this.progresoEscaneo = 100;
        this.escaneoCompletado = true;
        console.log(
          `✅ Escaneo completado: ${this.archivosEncontrados.length} archivos encontrados`
        );
      }
    } catch (error) {
      console.error('❌ Error durante el escaneo:', error);
      alert(
        '❌ Error durante el escaneo. Por favor, verifica la ruta e inténtalo de nuevo.'
      );
    } finally {
      this.escaneando = false;
    }
  }

  /**
   * Escanea recursivamente una carpeta y sus subcarpetas
   */
  private async escanearDiscoRecursivo(rutaActual: string): Promise<void> {
    if (this.cancelarEscaneoFlag) {
      console.log('⚠️ Escaneo cancelado por el usuario');
      return;
    }

    try {
      // Simular lectura de directorio (en producción, usar Capacitor Filesystem o Node.js fs)
      const archivosEnDirectorio = await this.leerDirectorio(rutaActual);

      this.carpetasProcesadas++;

      for (const item of archivosEnDirectorio) {
        if (this.cancelarEscaneoFlag) break;

        if (item.esDirectorio) {
          // Recursión para subdirectorios
          await this.escanearDiscoRecursivo(item.rutaCompleta);
        } else {
          // Procesar archivo
          const extension = this.obtenerExtension(item.nombre).toLowerCase();

          if (this.esExtensionValida(extension)) {
            const archivoEncontrado: ArchivoEncontrado = {
              nombre: item.nombre,
              rutaCompleta: item.rutaCompleta,
              tamano: item.tamano,
              fechaCreacion: await this.obtenerFechaArchivo(item, extension),
              extension: extension,
              tipo: this.determinarTipo(extension),
            };

            // Verificar duplicados
            if (!this.esDuplicado(archivoEncontrado)) {
              this.archivosEncontrados.push(archivoEncontrado);
            }
          }
        }

        // Actualizar progreso (simulado)
        this.progresoEscaneo = Math.min(
          95,
          Math.floor((this.archivosEncontrados.length / 100) * 100)
        );
      }
    } catch (error) {
      console.error(`Error escaneando ${rutaActual}:`, error);
    }
  }

  /**
   * Lee el contenido de un directorio
   * Implementación real usando Node.js fs para entorno desktop
   */
  private async leerDirectorio(ruta: string): Promise<any[]> {
    try {
      // Para entorno browser/Electron con Node.js
      const fs = (window as any).require('fs');
      const path = (window as any).require('path');

      // Leer directorio de forma síncrona
      const items = fs.readdirSync(ruta, { withFileTypes: true });

      // ✅ NUEVO: Filtrar carpetas del sistema ANTES de procesarlas
      const itemsFiltrados = items.filter((item: any) => {
        if (item.isDirectory() && this.debeSaltarDirectorio(item.name)) {
          console.log(`⏭️ Saltando carpeta del sistema: ${item.name}`);
          return false; // Excluir esta carpeta
        }
        return true; // Incluir este item
      });

      const resultado = itemsFiltrados.map((item: any) => {
        const rutaCompleta = path.join(ruta, item.name);
        let stats = null;
        let tamano = 0;
        let fechaModificacion = new Date();

        try {
          if (!item.isDirectory()) {
            stats = fs.statSync(rutaCompleta);
            tamano = stats.size;
            fechaModificacion = stats.mtime;
          }
        } catch (error) {
          console.warn(`No se pudo obtener stats de ${rutaCompleta}:`, error);
        }

        return {
          nombre: item.name,
          rutaCompleta: rutaCompleta,
          esDirectorio: item.isDirectory(),
          tamano: tamano,
          fechaModificacion: fechaModificacion,
        };
      });

      console.log(`📂 Leyendo ${ruta}: ${resultado.length} items encontrados`);
      return resultado;
    } catch (error: any) {
      // ✅ MEJORADO: Manejo de errores más silencioso para carpetas restringidas
      if (error.code === 'ENOENT') {
        console.warn(`⚠️ Ruta no encontrada: ${ruta}`);
      } else if (error.code === 'EACCES' || error.code === 'EPERM') {
        console.warn(
          `⚠️ Acceso denegado (normal en carpetas del sistema): ${ruta}`
        );
      } else if (error.message && error.message.includes('require')) {
        console.error(
          '❌ Node.js no disponible. Usa Electron o implementa con Capacitor Filesystem para móvil.'
        );
        alert(
          '⚠️ Esta funcionalidad requiere Electron o un entorno con acceso al filesystem.\n\nPara aplicaciones web, considera usar la API File System Access o implementar la carga manual de archivos.'
        );
      } else {
        console.error(`❌ Error leyendo directorio ${ruta}:`, error);
      }
      return []; // Retornar array vacío para continuar el escaneo
    }
  }

  /**
   * Obtiene la fecha de creación del archivo
   * Prioridad: EXIF > Metadatos del archivo > Fecha de modificación
   */
  private async obtenerFechaArchivo(
    item: any,
    extension: string
  ): Promise<string> {
    // Si está habilitado leer EXIF y es imagen/video
    if (
      this.leerFechaExif &&
      (this.esExtensionImagen(extension) || this.esExtensionVideo(extension))
    ) {
      try {
        // En producción, leer EXIF aquí
        // const exifData = await this.leerExif(item.rutaCompleta);
        // if (exifData.DateTimeOriginal) return exifData.DateTimeOriginal;
      } catch (error) {
        console.warn('No se pudo leer EXIF:', error);
      }
    }

    // Fallback: usar fecha de modificación del filesystem
    const fecha = item.fechaModificacion || new Date();
    return fecha instanceof Date ? fecha.toISOString() : fecha;
  }

  /**
   * Cancela el escaneo en progreso
   */
  cancelarEscaneo(): void {
    this.cancelarEscaneoFlag = true;
    console.log('⚠️ Cancelando escaneo...');
  }

  /**
   * Importa los archivos encontrados a la base de datos
   */
  async importarArchivosEncontrados(): Promise<void> {
    if (this.archivosEncontradosSeleccionados.size === 0) {
      alert('⚠️ No hay archivos seleccionados para importar.');
      return;
    }

    const confirmar = confirm(
      `¿Estás seguro de que deseas importar ${this.archivosEncontradosSeleccionados.size} archivo(s) seleccionado(s)?`
    );

    if (!confirmar) {
      return;
    }

    console.log(
      `📥 Iniciando importación de ${this.archivosEncontradosSeleccionados.size} archivos...`
    );

    let importados = 0;
    let errores = 0;

    // Obtener solo los archivos seleccionados
    const archivosAImportar = Array.from(
      this.archivosEncontradosSeleccionados
    ).map((index) => this.archivosEncontrados[index]);

    for (const archivoEncontrado of archivosAImportar) {
      try {
        // Si está habilitada la copia de archivos
        let rutaDestino = archivoEncontrado.rutaCompleta;

        if (this.copiarArchivos) {
          rutaDestino = await this.copiarArchivoAUploads(archivoEncontrado);
        }

        // Crear registro en BD
        await this.crearRegistroArchivo(archivoEncontrado, rutaDestino);
        importados++;
      } catch (error) {
        console.error(`Error importando ${archivoEncontrado.nombre}:`, error);
        errores++;
      }
    }

    // Recargar archivos y cerrar modal
    this.cargarTodosLosArchivos();
    this.cerrarModalEscaneo();

    if (errores === 0) {
      alert(
        `✅ ¡Excelente! Se importaron ${importados} archivo(s) correctamente.`
      );
    } else {
      alert(
        `⚠️ Se importaron ${importados} archivo(s).\n❌ Hubo ${errores} error(es).`
      );
    }
  }

  /**
   * Copia un archivo a la carpeta uploads
   */
  private async copiarArchivoAUploads(
    archivo: ArchivoEncontrado
  ): Promise<string> {
    try {
      // Generar nombre único con timestamp
      const nombreDestino = `${Date.now()}_${archivo.nombre}`;

      // Usar IPC de Electron para copiar el archivo
      if ((window as any).require) {
        const { ipcRenderer } = (window as any).require('electron');

        const resultado = await ipcRenderer.invoke(
          'copy-file-to-uploads',
          archivo.rutaCompleta,
          nombreDestino
        );

        if (resultado.success) {
          console.log(
            `✅ Archivo copiado: ${archivo.nombre} -> ${nombreDestino}`
          );
          return nombreDestino;
        } else {
          throw new Error('Error al copiar archivo');
        }
      } else {
        // Fallback: si no estamos en Electron, no copiar (solo referencia)
        console.warn('⚠️ No estamos en Electron, archivo no copiado');
        return archivo.nombre;
      }
    } catch (error) {
      console.error(`❌ Error copiando archivo ${archivo.nombre}:`, error);
      throw error;
    }
  }

  /**
   * Crea un registro de archivo en la base de datos
   */
  private async crearRegistroArchivo(
    archivo: ArchivoEncontrado,
    nombreArchivo: string
  ): Promise<void> {
    const nuevoArchivo: Omit<Archivo, 'id'> = {
      nombreArchivo: archivo.nombre,
      rutaArchivo: `uploads/${nombreArchivo}`,
      tipo: archivo.tipo,
      fechaCreacion: archivo.fechaCreacion,
      actividadId: 0, // Sin asignar
      descripcion: 'Importado desde escaneo de disco',
      tamano: archivo.tamano,
      // Campos opcionales
      itinerarioId: undefined,
      fechaActualizacion: archivo.fechaCreacion,
      horaCaptura: new Date(archivo.fechaCreacion).toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      version: 1,
      geolocalizacion: undefined,
      metadatos: JSON.stringify({
        rutaOriginal: archivo.rutaCompleta,
        importadoDesde: 'escaneo-disco',
        fechaImportacion: new Date().toISOString(),
      }),
      tipoMime: this.obtenerTipoMime(archivo.extension),
      archivosAsociados: [],
    };

    // Llamar al servicio para crear el archivo en la BD
    return new Promise((resolve, reject) => {
      this.archivoService.crearArchivo(nuevoArchivo).subscribe({
        next: (resultado) => {
          console.log(
            `✅ Registro creado en BD para: ${archivo.nombre} (ID: ${resultado.id})`
          );
          resolve();
        },
        error: (error) => {
          console.error(
            `❌ Error creando registro para ${archivo.nombre}:`,
            error
          );
          reject(error);
        },
      });
    });
  }
  /**
   * Verifica si una extensión es válida según las opciones
   */
  private esExtensionValida(extension: string): boolean {
    // Verificar si la extensión está seleccionada en el mapa
    return this.extensionesSeleccionadas[extension.toLowerCase()] === true;
  }

  /**
   * Verifica si un archivo es duplicado
   */
  private esDuplicado(archivo: ArchivoEncontrado): boolean {
    return this.archivosEncontrados.some(
      (a) =>
        a.nombre === archivo.nombre && a.fechaCreacion === archivo.fechaCreacion
    );
  }

  /**
   * Determina el tipo de archivo según su extensión
   */
  private determinarTipo(
    extension: string
  ): 'imagen' | 'video' | 'audio' | 'foto' | 'texto' {
    if (this.esExtensionImagen(extension)) return 'imagen';
    if (this.esExtensionVideo(extension)) return 'video';
    if (this.esExtensionAudio(extension)) return 'audio';
    return 'texto'; // Cambiar 'documento' por 'texto'
  }

  /**
   * Obtiene la extensión de un archivo
   */
  private obtenerExtension(nombreArchivo: string): string {
    return nombreArchivo.split('.').pop() || '';
  }

  /**
   * Verifica si es una extensión de imagen
   */
  esExtensionImagen(extension: string): boolean {
    return this.EXTENSIONES_IMAGEN.includes(extension.toLowerCase());
  }

  /**
   * Verifica si es una extensión de video
   */
  esExtensionVideo(extension: string): boolean {
    return this.EXTENSIONES_VIDEO.includes(extension.toLowerCase());
  }

  /**
   * Verifica si es una extensión de audio
   */
  esExtensionAudio(extension: string): boolean {
    return this.EXTENSIONES_AUDIO.includes(extension.toLowerCase());
  }

  /**
   * Verifica si es una extensión de texto/documento
   */
  esExtensionTexto(extension: string): boolean {
    return this.EXTENSIONES_TEXTO.includes(extension.toLowerCase());
  }

  /**
   * ✅ NUEVO: Inicializa las extensiones seleccionadas por defecto
   * Poner después de: esExtensionTexto()
   */
  private inicializarExtensionesSeleccionadas(): void {
    // Por defecto, seleccionar todas las imágenes y videos
    this.EXTENSIONES_IMAGEN.forEach(
      (ext) => (this.extensionesSeleccionadas[ext] = true)
    );
    this.EXTENSIONES_VIDEO.forEach(
      (ext) => (this.extensionesSeleccionadas[ext] = true)
    );
    this.EXTENSIONES_AUDIO.forEach(
      (ext) => (this.extensionesSeleccionadas[ext] = false)
    );
    this.EXTENSIONES_TEXTO.forEach(
      (ext) => (this.extensionesSeleccionadas[ext] = false)
    );
  }

  /**
   * ✅ NUEVO: Alterna selección de todas las extensiones de un grupo
   * Poner después de: inicializarExtensionesSeleccionadas()
   */
  toggleGrupo(tipo: 'imagen' | 'video' | 'audio' | 'texto'): void {
    let extensiones: string[] = [];

    switch (tipo) {
      case 'imagen':
        extensiones = this.EXTENSIONES_IMAGEN;
        break;
      case 'video':
        extensiones = this.EXTENSIONES_VIDEO;
        break;
      case 'audio':
        extensiones = this.EXTENSIONES_AUDIO;
        break;
      case 'texto':
        extensiones = this.EXTENSIONES_TEXTO;
        break;
    }

    // Verificar si todas están seleccionadas
    const todasSeleccionadas = extensiones.every(
      (ext) => this.extensionesSeleccionadas[ext]
    );

    // Si todas están seleccionadas, deseleccionar. Si no, seleccionar todas
    extensiones.forEach(
      (ext) => (this.extensionesSeleccionadas[ext] = !todasSeleccionadas)
    );

    console.log(
      `🔄 Grupo ${tipo}: ${!todasSeleccionadas ? 'Todas seleccionadas' : 'Todas deseleccionadas'
      }`
    );
  }

  /**
   * ✅ NUEVO: Selecciona/deselecciona un archivo encontrado
   * Poner después de: toggleGrupo()
   */
  toggleSeleccionArchivoEncontrado(index: number): void {
    if (this.archivosEncontradosSeleccionados.has(index)) {
      this.archivosEncontradosSeleccionados.delete(index);
      console.log(`❌ Archivo ${index} deseleccionado`);
    } else {
      this.archivosEncontradosSeleccionados.add(index);
      console.log(`✅ Archivo ${index} seleccionado`);
    }
  }

  /**
   * ✅ NUEVO: Selecciona todos los archivos encontrados
   * Poner después de: toggleSeleccionArchivoEncontrado()
   */
  seleccionarTodosEncontrados(): void {
    this.archivosEncontradosSeleccionados.clear();
    this.archivosEncontrados.forEach((_, index) => {
      this.archivosEncontradosSeleccionados.add(index);
    });
    console.log(
      `✅ Todos los ${this.archivosEncontrados.length} archivos seleccionados`
    );
  }

  /**
   * ✅ NUEVO: Deselecciona todos los archivos encontrados
   * Poner después de: seleccionarTodosEncontrados()
   */
  deseleccionarTodosEncontrados(): void {
    this.archivosEncontradosSeleccionados.clear();
    console.log('🔄 Selección limpiada');
  }

  /**
   * ✅ NUEVO: Verifica si una carpeta debe ser saltada durante el escaneo
   * PONER DESPUÉS DE: deseleccionarTodosEncontrados()
   */
  private debeSaltarDirectorio(nombreCarpeta: string): boolean {
    const carpetasAIgnorar = [
      // Carpetas del sistema Windows
      'system volume information',
      '$recycle.bin',
      'windows',
      'program files',
      'program files (x86)',
      'programdata',
      'recovery',
      'config.msi',
      'msdownld.tmp',
      'msocache',

      // Carpetas del sistema macOS/Linux
      '.trash',
      '.trashes',
      'lost+found',
      '.documentrevisions-v100',
      '.spotlight-v100',
      '.temporaryitems',

      // Carpetas ocultas y de desarrollo, build y dependencias
      'node_modules',
      '.git',
      '.svn',
      '.hg',
      '__pycache__',
      '.idea',
      '.vscode',
      '.vs',
      '.circleci',
      '.github',
      '.gitlab',

      // Build artifacts
      'bin',
      'obj',
      'build',
      'dist',
      'vendor',
      'target',
      'out',
      'bundle',
      'cmake-build-debug',
      'cmake-build-release',

      // Estructura de código fuente (evita escanear SDKs completos)
      'src',
      'lib',
      'include',
      'dev', // Common dev folder
      'tools',
      'tool',

      // Tests y Benchmarks
      'test',
      'tests',
      'testing',
      '__tests__',
      'unit_tests',
      'integration_tests',
      'e2e',
      'spec',
      'specs',
      'benchmark',
      'benchmarks',

      // Ejemplos y Documentación
      'example',
      'examples',
      'sample',
      'samples',
      'demo',
      'demos',
      'doc',
      'docs',
      'documentation',

      // Plataformas móviles (proyectos)
      'android',
      'ios',
      'macos',
      'linux',
      'web', // Cuidado con este, pero en contexto de dev suele ser build/src

      // Carpetas de caché/temp
      'cache',
      'temp',
      'tmp',
      '.cache',
      'cookies',
      'history',
      '.npm',
      '.yarn',
      '.gradle',
      '.dart_tool',
      'venv',
      '.venv',
      'env',
    ];

    const nombre = nombreCarpeta.toLowerCase();

    // Verificar nombre exacto
    if (carpetasAIgnorar.includes(nombre)) {
      return true;
    }

    // Verificar carpetas que empiezan con punto (ocultas)
    if (nombre.startsWith('.')) {
      return true;
    }

    // Verificar carpetas que empiezan con $ (sistema)
    if (nombre.startsWith('$')) {
      return true;
    }

    return false;
  }

  /**
   * ✅ NUEVO: Obtiene el tipo MIME según la extensión
   * Poner después de: debeSaltarDirectorio()
   */
  private obtenerTipoMime(extension: string): string {
    const mimeTypes: { [key: string]: string } = {
      // Imágenes
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      heic: 'image/heic',
      heif: 'image/heif',
      bmp: 'image/bmp',

      // Videos
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      avi: 'video/x-msvideo',
      mkv: 'video/x-matroska',
      wmv: 'video/x-ms-wmv',
      flv: 'video/x-flv',
      webm: 'video/webm',
      m4v: 'video/x-m4v',

      // Audio
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      aac: 'audio/aac',
      m4a: 'audio/mp4',
      flac: 'audio/flac',
      wma: 'audio/x-ms-wma',

      // Documentos
      txt: 'text/plain',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      csv: 'text/csv',
    };

    return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
  }

  /**
   * ✅ CORREGIDO: Obtiene la URL de preview para un archivo encontrado
   * PONER DESPUÉS DE: obtenerTipoMime()
   */
  obtenerUrlPreviewArchivo(archivo: ArchivoEncontrado): string {
    // IMPORTANTE: Solo funciona en Electron durante el escaneo
    // donde archivo.rutaCompleta contiene la ruta ORIGINAL del disco

    if ((window as any).require) {
      try {
        const fs = (window as any).require('fs');

        // Verificar si el archivo existe en la ruta original
        if (fs.existsSync(archivo.rutaCompleta)) {
          // Usar protocolo file:// para cargar desde la ruta original
          return `file://${archivo.rutaCompleta.replace(/\\/g, '/')}`;
        } else {
          console.warn(`⚠️ Archivo no accesible: ${archivo.rutaCompleta}`);
          return '';
        }
      } catch (error) {
        console.error(`Error verificando archivo:`, error);
        return '';
      }
    }

    // Fallback: si no estamos en Electron
    return '';
  }

  /**
   * ✅ NUEVO: Maneja errores al cargar imágenes
   * PONER DESPUÉS DE: obtenerUrlPreviewArchivo()
   */
  onImagenError(event: any, archivo: ArchivoEncontrado): void {
    console.warn(`⚠️ Error cargando preview de: ${archivo.nombre}`);
    event.target.style.display = 'none'; // Ocultar la imagen rota
    // Mostrar el icono en su lugar
    if (event.target.parentElement) {
      event.target.parentElement.style.display = 'none';
    }
  }

  // ✅ NUEVO: Obtener nombre de usuario del sistema
  // ✅ DESPUÉS (corregido)
  obtenerUsuarioActual(): string {
    // 1. Intentar obtener del path del navegador
    const path = window.location.pathname;
    if (path.includes('/home/')) {
      const match = path.match(/\/home\/([^\/]+)/);
      if (match) {
        console.log('✅ Usuario detectado desde path:', match[1]);
        return match[1];
      }
    }

    // 2. Intentar obtener de process (solo Electron)
    try {
      const proc = (window as any).process;
      if (proc && proc.env) {
        const usuario =
          proc.env['USER'] || proc.env['USERNAME'] || proc.env['LOGNAME'];
        if (usuario) {
          console.log('✅ Usuario detectado desde process.env:', usuario);
          return usuario;
        }
      }
    } catch (e) {
      console.log('ℹ️ process.env no disponible (navegador web normal)');
    }

    // 3. Fallback: usuario por defecto de Deepin
    console.log('ℹ️ Usando usuario por defecto: Victor');
    return 'Victor';
  }

  // ✅ NUEVO: Validar formato de ruta
  validarRutaEscaneo() {
    const ruta = this.rutaEscaneo.trim();

    if (!ruta) {
      this.rutaValida = false;
      return;
    }

    // Validar formatos comunes
    const esRutaLinux = /^\/[a-zA-Z0-9_\-\/\.~]+$/.test(ruta); // /home/user/Pictures
    const esRutaWindows = /^[a-zA-Z]:\\[^<>:"|?*]+$/.test(ruta); // D:\Fotos
    const esRutaAndroid =
      /^\/storage\/emulated\/[0-9]+\/[a-zA-Z0-9_\-\/]+$/.test(ruta); // /storage/emulated/0/DCIM

    this.rutaValida = esRutaLinux || esRutaWindows || esRutaAndroid;

    console.log('🔍 Validación de ruta:', {
      ruta,
      esRutaLinux,
      esRutaWindows,
      esRutaAndroid,
      rutaValida: this.rutaValida,
    });
  }

  // ✅ NUEVO: Seleccionar ruta sugerida
  seleccionarRuta(ruta: string) {
    this.rutaEscaneo = ruta;
    this.mostrarRutasComunes = false;
    this.validarRutaEscaneo();

    console.log('📂 Ruta seleccionada:', ruta);
  }

  // ✅ NUEVO: Abrir input para ruta personalizada
  abrirInputPersonalizado() {
    this.mostrarRutasComunes = false;

    const rutaPersonalizada = prompt(
      '📂 Introduce la ruta completa de la carpeta:\n\n' +
      'Ejemplos:\n' +
      '• Linux: /home/tu_usuario/Pictures\n' +
      '• Windows: D:\\Fotos\n' +
      '• Android: /storage/emulated/0/DCIM'
    );

    if (rutaPersonalizada) {
      this.rutaEscaneo = rutaPersonalizada.trim();
      this.validarRutaEscaneo();
    }
  }

  onToggleImagenesEncontradas(): void {
    // Verificar si estamos en Electron
    const enElectron = !!(window as any).require;

    if (this.mostrarImagenesEncontradas && !enElectron) {
      // Desactivar si se intenta activar fuera de Electron
      this.mostrarImagenesEncontradas = false;
      alert(
        '⚠️ La vista previa de imágenes solo está disponible en la aplicación de escritorio (Electron).\n\nPara usarla, ejecuta:\nnpx electron .'
      );
      return;
    }

    console.log(
      `🖼️ Vista de imágenes: ${this.mostrarImagenesEncontradas ? 'ON' : 'OFF'}`
    );
  }

  // ========== NUEVOS MÉTODOS DE AUTO-ASIGNACIÓN CON IA ==========

  /**
   * 🚀 Abre el modal de auto-asignación con IA
   * Analiza los archivos seleccionados y detecta destino automáticamente
   */
  abrirAutoAsignacionIA(): void {
    if (this.archivosSeleccionados.size === 0) {
      alert('⚠️ Debes seleccionar al menos un archivo para auto-asignar.');
      return;
    }

    console.log(`🚀 Iniciando análisis de ${this.archivosSeleccionados.size} archivos...`);

    this.mostrarModalAutoAsignacion = true;
    this.destinoDetectadoIA = null;
    this.destinoManualIA = '';
    this.autoAsignando = true;
    this.mensajeProgreso = 'Analizando metadatos EXIF y detectando ubicación...';
    document.body.style.overflow = 'hidden';

    // Detectar destino automáticamente
    const archivoIds = Array.from(this.archivosSeleccionados);

    this.autoAsignacionService.autoAsignarConIA(archivoIds).subscribe({
      next: (resultado) => {
        this.autoAsignando = false;

        if (!resultado.destinoDetectado) {
          // No se detectó destino → pedir al usuario
          this.mensajeProgreso = '';
          alert(
            '📍 No se pudo detectar un destino automáticamente.\n\n' +
            'Por favor, introduce el nombre de la ciudad o lugar donde se tomaron las fotos.'
          );
        } else {
          // Destino detectado → mostrar para confirmación
          this.destinoDetectadoIA = resultado.destinoDetectado;
          this.destinoManualIA = resultado.destinoDetectado;
          this.mensajeProgreso = '';
        }
      },
      error: (error) => {
        this.autoAsignando = false;
        this.mensajeProgreso = '';
        console.error('❌ Error detectando destino:', error);
        alert(
          '⚠️ No se pudo analizar automáticamente.\n\n' +
          'Por favor, introduce el destino manualmente.'
        );
      }
    });
  }

  /**
   * ✅ Confirma y ejecuta la auto-asignación con IA
   */
  confirmarAutoAsignacionIA(): void {
    const destinoFinal = this.destinoManualIA.trim();

    if (!destinoFinal) {
      alert('⚠️ Por favor, introduce un destino válido.');
      return;
    }

    const archivoIds = Array.from(this.archivosSeleccionados);
    const cantidad = archivoIds.length;

    const confirmar = confirm(
      `🚀 ¿Confirmas la auto-asignación con IA?\n\n` +
      `📍 Destino: ${destinoFinal}\n` +
      `📁 Archivos: ${cantidad}\n\n` +
      `Se creará automáticamente:\n` +
      `• Viaje genérico\n` +
      `• Itinerario del día\n` +
      `• Actividad "${destinoFinal}"\n` +
      `• Asignación de todos los archivos`
    );

    if (!confirmar) {
      return;
    }

    this.autoAsignando = true;
    this.mensajeProgreso = 'Creando estructura y asignando archivos...';

    this.autoAsignacionService.autoAsignarConIA(archivoIds, destinoFinal).subscribe({
      next: (resultado) => {
        this.autoAsignando = false;
        this.cerrarModalAutoAsignacion();

        if (resultado.exito) {
          this.deseleccionarTodos();
          this.cargarTodosLosArchivos();

          alert(
            `✅ ¡Auto-asignación completada con éxito!\n\n` +
            `📍 Destino: ${resultado.destinoDetectado}\n` +
            `🎯 Viaje: ${resultado.viajeCreado?.nombre}\n` +
            `📅 Itinerario: ${resultado.itinerarioCreado?.descripcionGeneral}\n` +
            `🎨 Actividad: ${resultado.actividadCreada?.nombre}\n` +
            `📁 Archivos asignados: ${resultado.archivosAsignados}`
          );
        } else {
          alert(
            `❌ Error en la auto-asignación:\n\n${resultado.mensaje}\n\n` +
            (resultado.errores ? resultado.errores.join('\n') : '')
          );
        }
      },
      error: (error) => {
        this.autoAsignando = false;
        this.mensajeProgreso = '';
        console.error('❌ Error en auto-asignación:', error);
        alert(
          `❌ Error durante la auto-asignación:\n\n${error.message || 'Error desconocido'}\n\n` +
          'Por favor, intenta asignar manualmente.'
        );
      }
    });
  }

  /**
   * ❌ Cierra el modal de auto-asignación
   */
  cerrarModalAutoAsignacion(): void {
    this.mostrarModalAutoAsignacion = false;
    this.destinoDetectadoIA = null;
    this.destinoManualIA = '';
    this.autoAsignando = false;
    this.mensajeProgreso = '';
    document.body.style.overflow = 'auto';
  }
}
