import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SaludService, HealthActivity } from '../../servicios/salud.service';

@Component({
  selector: 'app-salud-upload-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './salud-upload-modal.component.html',
  styleUrls: ['./salud-upload-modal.component.scss']
})
export class SaludUploadModalComponent implements OnInit, OnChanges {
  @Input() mostrar: boolean = false;
  @Input() itineraryId: number = 0;
  @Input() activityId: number | null = null;
  @Input() tripName: string = '';

  @Output() cerrar = new EventEmitter<void>();
  @Output() completado = new EventEmitter<any>();

  // Modos: 'detalle' para ver métricas existentes, 'subida' para arrastrar capturas
  modoVista: 'detalle' | 'subida' = 'subida';
  cargandoVerificacion: boolean = false;
  datosActividad: HealthActivity | null = null;

  tipoCarga: 'watch' | 'scale' = 'watch';
  selectedFiles: File[] = [];
  previewUrls: string[] = [];
  customApiKey: string = '';
  cargando: boolean = false;
  mensajeProgreso: string = '';
  errorMensaje: string = '';
  resultadoExito: any = null;

  constructor(private saludService: SaludService) {}

  ngOnInit(): void {
    const savedKey = localStorage.getItem('gemini_api_key') || localStorage.getItem('ia_api_key');
    if (savedKey) {
      this.customApiKey = savedKey.trim();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['mostrar'] && this.mostrar) {
      this.verificarDatosExistentes();
    } else if (changes['activityId'] && this.mostrar) {
      this.verificarDatosExistentes();
    }
  }

  verificarDatosExistentes(): void {
    this.limpiarArchivos();
    this.errorMensaje = '';
    this.resultadoExito = null;

    if (this.activityId) {
      this.cargandoVerificacion = true;
      this.saludService.getActivityByActivityId(this.activityId).subscribe({
        next: (res) => {
          this.cargandoVerificacion = false;
          if (res && res.hasData && res.data) {
            this.datosActividad = res.data;
            this.modoVista = 'detalle';
          } else {
            this.datosActividad = null;
            this.modoVista = 'subida';
          }
        },
        error: () => {
          this.cargandoVerificacion = false;
          this.datosActividad = null;
          this.modoVista = 'subida';
        }
      });
    } else {
      this.datosActividad = null;
      this.modoVista = 'subida';
    }
  }

  cambiarTipo(tipo: 'watch' | 'scale') {
    if (this.cargando) return;
    this.tipoCarga = tipo;
    this.limpiarArchivos();
    this.errorMensaje = '';
    this.resultadoExito = null;
  }

  onFilesSelected(event: any) {
    const files: FileList = event.target.files;
    if (!files || files.length === 0) return;
    this.agregarArchivos(Array.from(files));
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer && event.dataTransfer.files) {
      this.agregarArchivos(Array.from(event.dataTransfer.files));
    }
  }

  private agregarArchivos(files: File[]) {
    const maxFiles = this.tipoCarga === 'watch' ? 4 : 2;
    const validImageFiles = files.filter(f => f.type.startsWith('image/'));

    for (const file of validImageFiles) {
      if (this.selectedFiles.length >= maxFiles) break;
      this.selectedFiles.push(file);

      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.previewUrls.push(e.target.result);
      };
      reader.readAsDataURL(file);
    }
  }

  eliminarArchivo(index: number) {
    if (this.cargando) return;
    this.selectedFiles.splice(index, 1);
    this.previewUrls.splice(index, 1);
  }

  limpiarArchivos() {
    this.selectedFiles = [];
    this.previewUrls = [];
  }

  cerrarModal() {
    if (this.cargando) return;
    this.limpiarArchivos();
    this.errorMensaje = '';
    this.resultadoExito = null;
    this.cerrar.emit();
  }

  irASubida() {
    this.limpiarArchivos();
    this.errorMensaje = '';
    this.resultadoExito = null;
    this.modoVista = 'subida';
  }

  volverADetalle() {
    if (this.datosActividad) {
      this.limpiarArchivos();
      this.errorMensaje = '';
      this.modoVista = 'detalle';
    }
  }

  eliminarMetricas() {
    if (!this.datosActividad || !this.datosActividad.id) return;
    if (!confirm('¿Estás seguro de que deseas eliminar las métricas de salud de esta actividad?')) return;

    this.cargando = true;
    this.saludService.deleteActivity(this.datosActividad.id).subscribe({
      next: () => {
        this.cargando = false;
        this.datosActividad = null;
        this.modoVista = 'subida';
        this.completado.emit({ deleted: true });
      },
      error: (err) => {
        this.cargando = false;
        alert('Error al eliminar métricas: ' + (err.error?.error || err.message));
      }
    });
  }

  enviarCapturas() {
    if (this.selectedFiles.length === 0) {
      this.errorMensaje = 'Selecciona al menos una captura de pantalla.';
      return;
    }

    if (this.customApiKey && this.customApiKey.trim()) {
      localStorage.setItem('gemini_api_key', this.customApiKey.trim());
      localStorage.setItem('ia_api_key', this.customApiKey.trim());
    }

    this.cargando = true;
    this.errorMensaje = '';
    this.resultadoExito = null;

    if (this.tipoCarga === 'watch') {
      this.mensajeProgreso = 'Analizando capturas de Xiaomi Mi Fitness con Gemini 3.6 Flash... Extrayendo métricas y splits...';
      this.saludService.uploadWatch(this.itineraryId, this.activityId, this.selectedFiles, this.customApiKey)
        .subscribe({
          next: (res) => {
            this.cargando = false;
            this.resultadoExito = res;
            this.completado.emit(res);

            // Si está vinculado a una actividad, refrescar y mostrar directamente el detalle
            if (this.activityId) {
              this.verificarDatosExistentes();
            }
          },
          error: (err) => {
            this.cargando = false;
            console.error('Error subiendo capturas del reloj:', err);
            this.errorMensaje = err.error?.error || 'Error al procesar las capturas con la IA. Verifica la API key o las imágenes.';
          }
        });
    } else {
      this.mensajeProgreso = 'Analizando constantes corporales de la báscula inteligente con Gemini...';
      const userId = 1;
      this.saludService.uploadScale(userId, this.selectedFiles, this.customApiKey)
        .subscribe({
          next: (res) => {
            this.cargando = false;
            this.resultadoExito = res;
            this.completado.emit(res);
          },
          error: (err) => {
            this.cargando = false;
            console.error('Error subiendo capturas de báscula:', err);
            this.errorMensaje = err.error?.error || 'Error al procesar la captura de la báscula.';
          }
        });
    }
  }

  get diferenciaDivergencia(): number {
    if (!this.datosActividad) return 0;
    const reloj = this.datosActividad.distance_km || 0;
    const gps = this.datosActividad.actividad_distancia_gps || 0;
    return Number((reloj - gps).toFixed(2));
  }

  get mejorRitmo(): string {
    if (!this.datosActividad?.splits || this.datosActividad.splits.length === 0) {
      return this.datosActividad?.pace_max || '--:--';
    }
    const paces = [...this.datosActividad.splits].map(s => s.pace).filter(Boolean);
    paces.sort();
    return paces[0];
  }
}
