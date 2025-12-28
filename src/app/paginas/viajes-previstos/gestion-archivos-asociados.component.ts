import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// Servicios y modelos
import { ArchivosAsociadosService } from '../../servicios/archivos-asociados.service';
import { ArchivoAsociado, CrearArchivoAsociado, ActualizarArchivoAsociado } from '../../modelos/archivo-asociado.model';
import { FilesizePipe } from '../../pipes/filesize.pipe';

@Component({
  selector: 'app-gestion-archivos-asociados',
  standalone: true,
  imports: [CommonModule, FormsModule, FilesizePipe],
  templateUrl: './gestion-archivos-asociados.component.html',
  styleUrls: ['./gestion-archivos-asociados.component.css']
})
export class GestionArchivosAsociadosComponent implements OnInit {
  viajePrevistoId!: number;
  itinerarioId!: number;
  actividadId!: number;
  archivoPrincipalId!: number;

  archivosAsociados: ArchivoAsociado[] = [];

  archivoAsociadoForm: CrearArchivoAsociado = {
    tipo: 'audio',
    descripcion: ''
  };

  modoEdicion: boolean = false;
  archivoEditandoId: number | null = null;
  archivoSeleccionado: File | null = null;
  guardando: boolean = false;
  cargando: boolean = false;

  mostrarModalEliminar: boolean = false;
  archivoAEliminar: ArchivoAsociado | null = null;

  constructor(
    private archivosAsociadosService: ArchivosAsociadosService,
    private route: ActivatedRoute,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      this.viajePrevistoId = +params.get('viajePrevistoId')!;
      this.itinerarioId = +params.get('itinerarioId')!;
      this.actividadId = +params.get('actividadId')!;
      this.archivoPrincipalId = +params.get('archivoId')!;

      console.log('[🔧 INICIALIZANDO] Gestión archivos asociados');
      console.log('  - Archivo Principal ID:', this.archivoPrincipalId);

      this.archivoAsociadoForm.archivoPrincipalId = this.archivoPrincipalId;
      this.cargarArchivosAsociados();
    });
  }

  cargarArchivosAsociados(): void {
    this.cargando = true;
    this.archivosAsociadosService.obtenerPorArchivoPrincipal(this.archivoPrincipalId).subscribe({
      next: (archivos) => {
        this.archivosAsociados = archivos;
        this.cargando = false;
        console.log('[✅ CARGADOS] Archivos asociados actualizados:', archivos);
      },
      error: (error) => {
        console.error('[❌ ERROR] Cargando archivos asociados:', error);
        this.cargando = false;
        alert('Error al cargar los archivos asociados');
      }
    });

  }

  onArchivoSeleccionado(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      this.archivoSeleccionado = null;
      return;
    }

    const file = input.files[0];

    // ✅ Validación de tamaño según tipo
    const maxSizeMB = this.archivoAsociadoForm.tipo === 'mapa_ubicacion' ? 10 : 50;
    const maxSizeBytes = maxSizeMB * 1024 * 1024;

    if (file.size > maxSizeBytes) {
      alert(`El archivo es demasiado grande. Tamaño máximo permitido: ${maxSizeMB}MB`);
      input.value = ''; // Resetear input
      this.archivoSeleccionado = null;
      return;
    }

    this.archivoSeleccionado = file;
    console.log('[📁 ARCHIVO SELECCIONADO]', {
      nombre: file.name,
      tipo: file.type,
      tamaño: `${(file.size / 1024 / 1024).toFixed(2)} MB`
    });
  }

  guardarArchivoAsociado(): void {
    if (!this.validarFormulario()) return;
    this.guardando = true;

    if (this.modoEdicion) {
      this.actualizarArchivoAsociado();
    } else {
      this.crearArchivoAsociado();
    }
  }

  private crearArchivoAsociado(): void {
    if (!this.archivoSeleccionado) {
      alert('Debes seleccionar un archivo');
      this.guardando = false;
      return;
    }

    const datosParaSubir = {
      archivoPrincipalId: this.archivoPrincipalId,
      tipo: this.archivoAsociadoForm.tipo ?? 'audio',
      descripcion: this.archivoAsociadoForm.descripcion || '',
      nombreArchivo: this.archivoSeleccionado.name
    };

    console.log('[INFO] Datos para subir archivo asociado:', datosParaSubir);
    console.log('[INFO] Archivo seleccionado para subir:', this.archivoSeleccionado);

    this.archivosAsociadosService.subirArchivo(this.archivoSeleccionado, datosParaSubir).subscribe({
      next: (respuesta) => {
        console.log('[✅ CREADO] Archivo asociado subido al servidor, respuesta completa:', respuesta);
        this.resetFormulario();
        this.cargarArchivosAsociados();
        this.guardando = false;
        alert('✅ Archivo asociado creado correctamente');
      },
      error: (err) => {
        console.error('[❌ ERROR] Creando archivo asociado:', err);
        alert('Error al crear el archivo asociado');
        this.guardando = false;
      }
    });
  }


  private actualizarArchivoAsociado(): void {
    if (!this.archivoEditandoId) {
      this.guardando = false;
      return;
    }

    if (this.archivoSeleccionado) {
      this.archivosAsociadosService.actualizarConArchivo(
        this.archivoEditandoId,
        this.archivoSeleccionado,
        {
          tipo: this.archivoAsociadoForm.tipo!,
          descripcion: this.archivoAsociadoForm.descripcion || ''
        }
      ).subscribe({
        next: () => {
          console.log('[✅ ACTUALIZADO] Archivo y metadatos');
          this.resetFormulario();
          this.cargarArchivosAsociados();
          this.guardando = false;
          alert('✅ Archivo asociado actualizado correctamente');
        },
        error: (err) => {
          console.error('[❌ ERROR] Actualizando archivo:', err);
          alert('Error al actualizar el archivo');
          this.guardando = false;
        }
      });
    } else {
      this.archivosAsociadosService.actualizar(this.archivoEditandoId, {
        tipo: this.archivoAsociadoForm.tipo!,
        descripcion: this.archivoAsociadoForm.descripcion || ''
      }).subscribe({
        next: () => {
          console.log('[✅ ACTUALIZADO] Solo metadatos');
          this.resetFormulario();
          this.cargarArchivosAsociados();
          this.guardando = false;
          alert('✅ Archivo asociado actualizado correctamente');
        },
        error: (err) => {
          console.error('[❌ ERROR] Actualizando metadatos:', err);
          alert('Error al actualizar');
          this.guardando = false;
        }
      });
    }
  }

  editarArchivo(archivo: ArchivoAsociado): void {
    console.log('[✏️ EDITANDO] Archivo asociado:', archivo);

    this.modoEdicion = true;
    this.archivoEditandoId = archivo.id!;
    this.archivoAsociadoForm = {
      tipo: archivo.tipo,
      descripcion: archivo.descripcion || ''
    };

    document.querySelector('.formulario-archivo-asociado')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  eliminarArchivo(archivo: ArchivoAsociado): void {
    this.archivoAEliminar = archivo;
    this.mostrarModalEliminar = true;
  }

  confirmarEliminacion(): void {
    if (!this.archivoAEliminar?.id) {
      this.cancelarEliminacion();
      return;
    }

    this.archivosAsociadosService.eliminar(this.archivoAEliminar.id).subscribe({
      next: () => {
        console.log('[✅ ELIMINADO] Archivo asociado');
        this.cargarArchivosAsociados();
        alert('✅ Archivo asociado eliminado correctamente');
        this.cancelarEliminacion();
      },
      error: (err) => {
        console.error('[❌ ERROR] Eliminando:', err);
        alert('Error al eliminar el archivo asociado');
        this.cancelarEliminacion();
      }
    });
  }

  cancelarEliminacion(): void {
    this.mostrarModalEliminar = false;
    this.archivoAEliminar = null;
  }

  descargarArchivo(archivo: ArchivoAsociado): void {
    console.log('[⬇️ DESCARGANDO] Archivo:', archivo.nombreArchivo);

    this.archivosAsociadosService.descargar(archivo.id!).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = archivo.nombreArchivo;
        link.click();
        window.URL.revokeObjectURL(url);
        console.log('[✅ DESCARGA] Completa:', archivo.nombreArchivo);
      },
      error: (err) => {
        console.error('[❌ ERROR] Descargando:', err);
        alert('Error al descargar el archivo');
      }
    });
  }

  private validarFormulario(): boolean {
    const errores: string[] = [];

    if (!this.archivoAsociadoForm.tipo) {
      errores.push('El tipo de archivo es obligatorio');
    }

    if (!this.modoEdicion && !this.archivoSeleccionado) {
      errores.push('Debes seleccionar un archivo');
    }

    if (errores.length > 0) {
      alert('Errores de validación:\n' + errores.join('\n'));
      return false;
    }

    return true;
  }

  resetFormulario(): void {
    this.modoEdicion = false;
    this.archivoEditandoId = null;
    this.archivoSeleccionado = null;

    this.archivoAsociadoForm = {
      archivoPrincipalId: this.archivoPrincipalId,
      tipo: 'audio',
      descripcion: ''
    };

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  }

  cancelarEdicion(): void {
    if (confirm('¿Descartar los cambios?')) this.resetFormulario();
  }

  volver(): void {
    this.router.navigate([
      '/viajes-previstos',
      this.viajePrevistoId,
      'itinerarios',
      this.itinerarioId,
      'actividades',
      this.actividadId,
      'archivos'
    ]);
  }
  /**
     * Devuelve los tipos de archivo aceptados según el tipo seleccionado
     */
  obtenerTiposAceptados(): string {
    switch (this.archivoAsociadoForm.tipo) {
      case 'audio':
        return 'audio/*';
      case 'texto':
        return '.txt,.doc,.docx,.pdf';
      case 'mapa_ubicacion':
        return 'image/*';
      default:
        return '*/*';
    }
  }

  /**
   * Devuelve el icono de Font Awesome apropiado según el tipo
   */
  obtenerIconoTipo(tipo: string): string {
    switch (tipo) {
      case 'audio':
        return 'fa-music';
      case 'texto':
        return 'fa-file-text';
      case 'mapa_ubicacion':
        return 'fa-map';
      default:
        return 'fa-file';
    }
  }

}