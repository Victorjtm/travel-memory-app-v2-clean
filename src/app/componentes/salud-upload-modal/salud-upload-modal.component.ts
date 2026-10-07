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

  /**
   * Zancada de referencia en metros (usa la zancada reportada por el reloj o la deduce de pasos/distancia)
   */
  get zancadaReferenciaMetros(): number {
    const m = this.metricasActuales;
    if (m?.stride_avg_cm && m.stride_avg_cm > 25) {
      return m.stride_avg_cm / 100;
    }
    const relojKm = m?.distance_km || 0;
    const pasos = m?.steps || 0;
    if (relojKm > 0 && pasos > 0) {
      return (relojKm * 1000) / pasos;
    }
    return 0.75; // Estándar promedio humano caminando: 75 cm
  }

  /**
   * Pasos estimados que corresponden a la distancia registrada por el GPS
   */
  get pasosEstimadosGps(): number {
    const gpsKm = this.datosActividad?.actividad_distancia_gps || 0;
    if (gpsKm <= 0) return 0;
    const zancada = this.zancadaReferenciaMetros;
    return Math.round((gpsKm * 1000) / zancada);
  }

  /**
   * Diferencia de pasos: Pasos Reloj - Pasos Estimados GPS
   */
  get diferenciaPasos(): number {
    const m = this.metricasActuales;
    const pasosReloj = m?.steps || 0;
    const pasosGps = this.pasosEstimadosGps;
    if (pasosReloj <= 0 || pasosGps <= 0) return 0;
    return pasosReloj - pasosGps;
  }

  /**
   * Diagnóstico de Realismo Biomecánico:
   * Evalúa cuál de las dos mediciones (Reloj vs GPS) se asemeja más a la realidad
   * cruzando distancia, pasos reales, cadencia y longitud de zancada fisiológica.
   */
  get diagnosticoRealismo(): {
    ganador: 'reloj' | 'gps' | 'ambos';
    tituloGanador: string;
    badgeClase: string;
    explicacion: string;
    zancadaRelojCm: number;
    zancadaGpsCm: number;
    cadenciaSpm: number;
    velocidadRelojKmH: number;
    velocidadGpsKmH: number;
    coherenciaCadenciaPct: number;
  } {
    const m = this.metricasActuales;
    const relojKm = Number(m?.distance_km || 0);
    const gpsKm = Number(this.datosActividad?.actividad_distancia_gps || 0);
    const pasos = Number(m?.steps || 0);
    const cadencia = Number(m?.cadence_avg_steps_min || m?.cadence_avg || 0);
    const zancadaReportada = Number(m?.stride_avg_cm || 0);
    const duracionStr = m?.duration_total || '';

    const durSec = this.parseDurationToSeconds(duracionStr);
    const durMin = durSec > 0 ? (durSec / 60) : 0;
    const durHoras = durSec > 0 ? (durSec / 3600) : 0;

    const velReloj = durHoras > 0 ? Number((relojKm / durHoras).toFixed(1)) : 0;
    const velGps = durHoras > 0 ? Number((gpsKm / durHoras).toFixed(1)) : 0;

    // Zancadas implícitas
    const zRelojCm = pasos > 0 ? Number(((relojKm * 100000) / pasos).toFixed(1)) : (zancadaReportada || 75);
    const zGpsCm = pasos > 0 ? Number(((gpsKm * 100000) / pasos).toFixed(1)) : 0;

    // Coherencia cadencia * tiempo vs pasos podómetro
    let coherenciaCadenciaPct = 100;
    if (cadencia > 0 && durMin > 0 && pasos > 0) {
      const pasosEstimadosCadencia = cadencia * durMin;
      const error = Math.abs(pasos - pasosEstimadosCadencia) / pasos;
      coherenciaCadenciaPct = Math.max(0, Math.min(100, Math.round((1 - error) * 100)));
    }

    const diffKm = Math.abs(relojKm - gpsKm);
    const pctDiff = gpsKm > 0 ? (diffKm / gpsKm) * 100 : 0;

    if (pctDiff <= 6) {
      return {
        ganador: 'ambos',
        tituloGanador: 'Ambos coinciden (Alta Precisión)',
        badgeClase: 'badge-ambos',
        explicacion: `Tanto el reloj (${relojKm} km) como el GPS (${gpsKm} km) tienen una discrepancia mínima (${diffKm.toFixed(2)} km, ${pctDiff.toFixed(1)}%). La cadencia (${cadencia || '--'} spm) y zancada (${zRelojCm} cm) concuerdan plenamente con ambas mediciones.`,
        zancadaRelojCm: zRelojCm,
        zancadaGpsCm: zGpsCm,
        cadenciaSpm: cadencia,
        velocidadRelojKmH: velReloj,
        velocidadGpsKmH: velGps,
        coherenciaCadenciaPct
      };
    }

    // Si la zancada requerida por el GPS es excesiva para caminata (> 95 cm) y el reloj es fisiológico (60-88 cm):
    if (zGpsCm > 95 && zRelojCm >= 60 && zRelojCm <= 88) {
      return {
        ganador: 'reloj',
        tituloGanador: `Más realista: Reloj Xiaomi (${relojKm} km)`,
        badgeClase: 'badge-reloj',
        explicacion: `A una cadencia media de ${cadencia || 73} spm (ritmo de paseo), la zancada de ${zRelojCm} cm registrada por el reloj es 100% natural y fisiológica (velocidad: ${velReloj} km/h). La distancia GPS (${gpsKm} km) exigiría una zancada irreal de ${zGpsCm} cm a ese ritmo lento, lo que indica deriva satelital acumulada durante pausas o en calles con edificios.`,
        zancadaRelojCm: zRelojCm,
        zancadaGpsCm: zGpsCm,
        cadenciaSpm: cadencia,
        velocidadRelojKmH: velReloj,
        velocidadGpsKmH: velGps,
        coherenciaCadenciaPct
      };
    }

    // Si el reloj subestimó pasos (zancada anormalmente baja < 50 cm) y el GPS está en rango humano:
    if (zRelojCm < 50 && zGpsCm >= 65 && zGpsCm <= 88) {
      return {
        ganador: 'gps',
        tituloGanador: `Más realista: GPS Itinerario (${gpsKm} km)`,
        badgeClase: 'badge-gps',
        explicacion: `El podómetro del reloj registró pasos insuficientes para la distancia y tiempo (zancada implícita de solo ${zRelojCm} cm). La distancia satelital de ${gpsKm} km arroja una zancada mucho más lógica (${zGpsCm} cm) y es la más fiable.`,
        zancadaRelojCm: zRelojCm,
        zancadaGpsCm: zGpsCm,
        cadenciaSpm: cadencia,
        velocidadRelojKmH: velReloj,
        velocidadGpsKmH: velGps,
        coherenciaCadenciaPct
      };
    }

    // Caso general por proximidad a zancada media humana (~75 cm)
    const errReloj = Math.abs(zRelojCm - 75);
    const errGps = Math.abs(zGpsCm - 75);

    if (errReloj <= errGps) {
      return {
        ganador: 'reloj',
        tituloGanador: `Más realista: Reloj Xiaomi (${relojKm} km)`,
        badgeClase: 'badge-reloj',
        explicacion: `La distancia del reloj (${relojKm} km) se ajusta mejor a tu biomecánica: su zancada (${zRelojCm} cm) y velocidad (${velReloj} km/h) son más coherentes con tu cadencia de ${cadencia || '--'} spm que los ${gpsKm} km del GPS (zancada requerida: ${zGpsCm} cm).`,
        zancadaRelojCm: zRelojCm,
        zancadaGpsCm: zGpsCm,
        cadenciaSpm: cadencia,
        velocidadRelojKmH: velReloj,
        velocidadGpsKmH: velGps,
        coherenciaCadenciaPct
      };
    } else {
      return {
        ganador: 'gps',
        tituloGanador: `Más realista: GPS Itinerario (${gpsKm} km)`,
        badgeClase: 'badge-gps',
        explicacion: `La distancia del GPS (${gpsKm} km) es más coherente con tu desplazamiento continuo (${velGps} km/h). La lectura del reloj (${relojKm} km) presenta una desviación en la cadencia y longitud de paso.`,
        zancadaRelojCm: zRelojCm,
        zancadaGpsCm: zGpsCm,
        cadenciaSpm: cadencia,
        velocidadRelojKmH: velReloj,
        velocidadGpsKmH: velGps,
        coherenciaCadenciaPct
      };
    }
  }

  parseDurationToSeconds(durStr: string): number {
    if (!durStr) return 0;
    const parts = durStr.trim().split(':').map(p => parseInt(p, 10));
    if (parts.length === 3) {
      return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    } else if (parts.length === 2) {
      return (parts[0] || 0) * 60 + (parts[1] || 0);
    }
    return 0;
  }

  /**
   * Splits ordenados secuencialmente de menor a mayor kilómetro
   */
  get splitsOrdenados(): any[] {
    const splits = this.metricasActuales?.splits;
    if (!splits || !Array.isArray(splits)) return [];
    return [...splits].sort((a, b) => {
      const kmA = Number(a.km_number || a.km || 0);
      const kmB = Number(b.km_number || b.km || 0);
      return kmA - kmB;
    });
  }

  parsePaceToSeconds(paceStr: string): number {
    if (!paceStr) return 0;
    const clean = paceStr.replace(/[^0-9:]/g, '');
    const parts = clean.split(':').map(p => parseInt(p, 10));
    if (parts.length === 3) {
      return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    } else if (parts.length === 2) {
      return (parts[0] || 0) * 60 + (parts[1] || 0);
    }
    return 0;
  }

  obtenerVelocidadKmH(paceStr: string): number {
    const sec = this.parsePaceToSeconds(paceStr);
    if (sec <= 0) return 0;
    return Number((3600 / sec).toFixed(2));
  }

  obtenerVelocidadTexto(paceStr: string): string {
    const v = this.obtenerVelocidadKmH(paceStr);
    return v > 0 ? `${v.toFixed(1)} km/h` : '--';
  }

  obtenerPorcentajeBarraSplit(split: any): number {
    const splits = this.splitsOrdenados;
    if (!splits.length) return 50;

    const vSplit = this.obtenerVelocidadKmH(split.pace);
    if (vSplit <= 0) return 20;

    const velocidades = splits.map(s => this.obtenerVelocidadKmH(s.pace)).filter(v => v > 0);
    if (!velocidades.length) return 50;

    const maxV = Math.max(...velocidades);
    const minV = Math.min(...velocidades);

    if (maxV === minV) return 75;

    // Escala dinámica del 25% al 100% para visualizar diferencias reales entre kilómetros
    const proporcion = (vSplit - minV) / (maxV - minV);
    return Math.round(25 + (proporcion * 75));
  }

  obtenerEstiloBarraSplit(split: any): string {
    const pct = this.obtenerPorcentajeBarraSplit(split);
    if (pct >= 85) {
      return 'linear-gradient(90deg, #10b981, #34d399)'; // Rápido / Verde esmeralda
    } else if (pct >= 55) {
      return 'linear-gradient(90deg, #38bdf8, #818cf8)'; // Medio / Azul celeste
    } else {
      return 'linear-gradient(90deg, #f59e0b, #fbbf24)'; // Lento / Ámbar
    }
  }

  aplicandoMetricas: boolean = false;
  mensajeExitoFijado: string = '';

  aplicarMetricasRelojAActividad(): void {
    if (!this.activityId || this.aplicandoMetricas) return;
    this.aplicandoMetricas = true;
    this.mensajeExitoFijado = '';
    this.saludService.syncActivityWithHealth(this.activityId).subscribe({
      next: (res) => {
        this.aplicandoMetricas = false;
        if (this.datosActividad) {
          this.datosActividad.actividad_distancia_gps = res.distanciaKm;
        }
        this.mensajeExitoFijado = `¡Kilometraje del reloj (${res.distanciaKm} km) fijado con éxito en la actividad y el viaje!`;
        this.completado.emit(res);
        setTimeout(() => {
          this.mensajeExitoFijado = '';
        }, 4000);
      },
      error: (err) => {
        this.aplicandoMetricas = false;
        alert('Error al aplicar métricas del reloj: ' + (err.error?.error || err.message));
      }
    });
  }
}
