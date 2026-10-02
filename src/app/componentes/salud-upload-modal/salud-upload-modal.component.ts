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

  // ⌚ Soporte multi-tramo dinámico (1 tramo = 4 fotos, 2 tramos = 8 fotos, etc.)
  watchSegmentsCount: number = 1;
  expectedPhotosCount: number = 4;
  segmentsInfo: Array<{ index: number; label: string }> = [{ index: 1, label: 'Tramo 1' }];
  tramoActivoSubida: number = 1;
  selectedFilesByTramo: { [tramoIndex: number]: File[] } = { 1: [] };
  previewUrlsByTramo: { [tramoIndex: number]: string[] } = { 1: [] };

  // Modo detalle: 0 = Total combinado, 1 = Tramo 1, 2 = Tramo 2, etc.
  tramoActivoDetalle: number = 0;

  // Fallback / legacy / báscula
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

  inicializarEstructurasTramos(count: number = 1, segments?: Array<{ index: number; label: string }>) {
    this.watchSegmentsCount = Math.max(1, count);
    this.expectedPhotosCount = this.watchSegmentsCount * 4;
    this.segmentsInfo = segments || Array.from({ length: this.watchSegmentsCount }, (_, i) => ({
      index: i + 1,
      label: `Tramo ${i + 1}`
    }));

    this.selectedFilesByTramo = {};
    this.previewUrlsByTramo = {};
    for (let i = 1; i <= this.watchSegmentsCount; i++) {
      this.selectedFilesByTramo[i] = [];
      this.previewUrlsByTramo[i] = [];
    }
    this.tramoActivoSubida = 1;
    this.tramoActivoDetalle = 0;
  }

  verificarDatosExistentes(): void {
    this.limpiarArchivos();
    this.errorMensaje = '';
    this.resultadoExito = null;

    if (this.activityId) {
      this.cargandoVerificacion = true;
      this.saludService.getActivityByActivityId(this.activityId).subscribe({
        next: (res: any) => {
          this.cargandoVerificacion = false;
          const count = res?.watch_segments_count || 1;
          const segments = res?.segments;
          this.inicializarEstructurasTramos(count, segments);

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
          this.inicializarEstructurasTramos(1);
          this.datosActividad = null;
          this.modoVista = 'subida';
        }
      });
    } else {
      this.inicializarEstructurasTramos(1);
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

  cambiarTramoSubida(tramoIndex: number) {
    if (this.cargando) return;
    this.tramoActivoSubida = tramoIndex;
  }

  cambiarTramoDetalle(tramoIndex: number) {
    this.tramoActivoDetalle = tramoIndex;
  }

  getArchivosTramo(tramoIndex: number): File[] {
    return this.selectedFilesByTramo[tramoIndex] || [];
  }

  getPreviewsTramo(tramoIndex: number): string[] {
    return this.previewUrlsByTramo[tramoIndex] || [];
  }

  get totalArchivosSeleccionados(): number {
    if (this.tipoCarga === 'scale') {
      return this.selectedFiles.length;
    }
    if (this.watchSegmentsCount > 1) {
      let total = 0;
      for (let i = 1; i <= this.watchSegmentsCount; i++) {
        total += (this.selectedFilesByTramo[i] || []).length;
      }
      return total;
    }
    return (this.selectedFilesByTramo[1] || []).length || this.selectedFiles.length;
  }

  onFilesSelected(event: any, tramoIndex?: number) {
    const files: FileList = event.target.files;
    if (!files || files.length === 0) return;
    this.agregarArchivos(Array.from(files), tramoIndex);
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  onDrop(event: DragEvent, tramoIndex?: number) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer && event.dataTransfer.files) {
      this.agregarArchivos(Array.from(event.dataTransfer.files), tramoIndex);
    }
  }

  private agregarArchivos(files: File[], tramoIndex?: number) {
    const validImageFiles = files.filter(f => f.type.startsWith('image/'));
    if (validImageFiles.length === 0) return;

    if (this.tipoCarga === 'scale') {
      const maxFiles = 2;
      for (const file of validImageFiles) {
        if (this.selectedFiles.length >= maxFiles) break;
        this.selectedFiles.push(file);
        const reader = new FileReader();
        reader.onload = (e: any) => this.previewUrls.push(e.target.result);
        reader.readAsDataURL(file);
      }
      return;
    }

    // Tipo reloj
    if (this.watchSegmentsCount > 1 && !tramoIndex && validImageFiles.length > 4) {
      // Distribución automática equitativa en bloques de 4 si el usuario seleccionó todas a la vez
      const perTramo = 4;
      let offset = 0;
      for (let t = 1; t <= this.watchSegmentsCount; t++) {
        const slice = validImageFiles.slice(offset, offset + perTramo);
        offset += perTramo;
        if (!this.selectedFilesByTramo[t]) this.selectedFilesByTramo[t] = [];
        if (!this.previewUrlsByTramo[t]) this.previewUrlsByTramo[t] = [];
        this.selectedFilesByTramo[t] = [];
        this.previewUrlsByTramo[t] = [];

        for (const file of slice) {
          this.selectedFilesByTramo[t].push(file);
          const reader = new FileReader();
          reader.onload = (e: any) => this.previewUrlsByTramo[t].push(e.target.result);
          reader.readAsDataURL(file);
        }
      }
      return;
    }

    const t = tramoIndex || this.tramoActivoSubida || 1;
    if (!this.selectedFilesByTramo[t]) this.selectedFilesByTramo[t] = [];
    if (!this.previewUrlsByTramo[t]) this.previewUrlsByTramo[t] = [];

    const maxFiles = 4;
    for (const file of validImageFiles) {
      if (this.selectedFilesByTramo[t].length >= maxFiles) break;
      this.selectedFilesByTramo[t].push(file);

      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.previewUrlsByTramo[t].push(e.target.result);
      };
      reader.readAsDataURL(file);
    }
  }

  eliminarArchivoTramo(tramoIndex: number, fileIndex: number) {
    if (this.cargando) return;
    if (this.selectedFilesByTramo[tramoIndex]) {
      this.selectedFilesByTramo[tramoIndex].splice(fileIndex, 1);
    }
    if (this.previewUrlsByTramo[tramoIndex]) {
      this.previewUrlsByTramo[tramoIndex].splice(fileIndex, 1);
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
    this.inicializarEstructurasTramos(this.watchSegmentsCount, this.segmentsInfo);
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
    if (this.totalArchivosSeleccionados === 0) {
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
      const allFiles: File[] = [];
      const tramosMeta: Array<{ tramo: number; count: number }> = [];

      for (let t = 1; t <= this.watchSegmentsCount; t++) {
        const tFiles = this.selectedFilesByTramo[t] || [];
        if (tFiles.length > 0) {
          allFiles.push(...tFiles);
          tramosMeta.push({ tramo: t, count: tFiles.length });
        }
      }

      // Fallback si venían en selectedFiles legacy
      if (allFiles.length === 0 && this.selectedFiles.length > 0) {
        allFiles.push(...this.selectedFiles);
        tramosMeta.push({ tramo: 1, count: this.selectedFiles.length });
      }

      const tramosMsg = this.watchSegmentsCount > 1 ? ` de ${this.watchSegmentsCount} tramos` : '';
      this.mensajeProgreso = `Analizando capturas${tramosMsg} de Xiaomi Mi Fitness con Gemini 3.6 Flash... Extrayendo métricas y splits...`;

      this.saludService.uploadWatch(this.itineraryId, this.activityId, allFiles, this.customApiKey, tramosMeta)
        .subscribe({
          next: (res) => {
            this.cargando = false;
            this.resultadoExito = res;
            this.completado.emit(res);

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

  // Getter reactivo para obtener los datos del tramo seleccionado en modo detalle
  get metricasActuales(): any {
    if (!this.datosActividad) return null;
    if (this.tramoActivoDetalle > 0 && this.datosActividad.tramos && this.datosActividad.tramos.length > 0) {
      const tr = this.datosActividad.tramos.find((t: any) => t.tramo === this.tramoActivoDetalle);
      if (tr && tr.data) {
        return {
          ...tr.data,
          actividad_distancia_gps: this.datosActividad.actividad_distancia_gps,
          splits: tr.data.splits || []
        };
      }
    }
    return this.datosActividad;
  }

  get diferenciaDivergencia(): number {
    const m = this.metricasActuales;
    if (!m) return 0;
    const reloj = m.distance_km || 0;
    const gps = this.datosActividad?.actividad_distancia_gps || 0;
    return Number((reloj - gps).toFixed(2));
  }

  get mejorRitmo(): string {
    const m = this.metricasActuales;
    if (!m?.splits || m.splits.length === 0) {
      return m?.pace_max || '--:--';
    }
    const paces = [...m.splits].map((s: any) => s.pace).filter(Boolean);
    paces.sort();
    return paces[0] || '--:--';
  }
}
