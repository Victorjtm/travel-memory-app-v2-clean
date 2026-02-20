import { Component, OnInit } from '@angular/core';
import { RouterModule, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpEventType } from '@angular/common/http';
import { timeout, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-inicio',
  standalone: true,
  imports: [RouterModule, CommonModule, FormsModule],
  templateUrl: './inicio.component.html',
  styleUrls: ['./inicio.component.scss'],
  styles: [`
    .video-alert {
      background: #f8f9fa;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      padding: 1rem;
      margin: 1rem 0;
    }
    
    .alert-content {
      display: flex;
      gap: 1rem;
      margin-bottom: 1rem;
      
      &.success {
        .icon { background: #d4edda; }
        h4 { color: #155724; }
      }
      
      &.ignored {
        .icon { background: #fff3cd; }
        h4 { color: #856404; }
      }
    }
    
    .icon {
      font-size: 1.5rem;
      background: #e2e3e5;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
    }
    
    h4 { margin: 0 0 0.25rem 0; font-size: 1rem; }
    p { margin: 0; font-size: 0.9rem; color: #6c757d; }
    code { background: #e9ecef; padding: 2px 4px; border-radius: 4px; font-size: 0.85rem; }
    
    .video-actions {
      display: flex;
      gap: 0.5rem;
    }
    
    .btn-video {
      background: #6c757d;
      color: white;
      flex: 2;
      padding: 0.5rem;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      &:hover { background: #5a6268; }
    }
    
    .btn-ignore {
      background: transparent;
      border: 1px solid #ced4da;
      color: #6c757d;
      flex: 1;
      padding: 0.5rem;
      border-radius: 6px;
      cursor: pointer;
      &:hover { background: #e9ecef; color: #495057; }
    }
  `]
})
export class InicioComponent implements OnInit {
  mensajeBienvenida = "¡Bienvenido a la aplicación de recuerdos de viajes!";

  // ✅ USAR ENVIRONMENT (ya no agregamos /api porque las rutas del backend no lo tienen)
  private readonly API_URL = environment.apiUrl;

  // Estado de importación
  mostrarModalImport = false;

  importando = false;
  progresoSubida = 0;
  mensajeProgreso = '';

  // Datos del modal de configuración
  destinoViaje = '';
  tipoActividadId: number | null = null;
  tiposActividad: any[] = [];

  // Archivos seleccionados
  archivosSeleccionados: File[] = [];
  manifestData: any = null;

  // Manejo de videos (Carpeta adicional)
  videosRequeridos = false;
  videosSeleccionados = false;
  ignorarVideos = false;
  archivosVideo: File[] = [];

  constructor(
    private http: HttpClient,
    private router: Router
  ) {
    // 🔍 Log para verificar la URL correcta
    console.log('🔗 [InicioComponent] API_URL configurada:', this.API_URL);
  }

  ngOnInit() {
    this.cargarTiposActividad();
  }

  // ====================================================================
  // CARGAR TIPOS DE ACTIVIDAD
  // ====================================================================

  /**
   * Carga los tipos de actividad disponibles desde el backend
   */
  cargarTiposActividad() {
    const url = `${this.API_URL}/tipos-actividad`;
    console.log('📡 [cargarTiposActividad] Petición a:', url);

    this.http.get<any[]>(url).subscribe({
      next: (tipos) => {
        this.tiposActividad = tipos;
        console.log('✅ Tipos de actividad cargados:', tipos.length);
      },
      error: (error) => {
        console.error('❌ Error cargando tipos de actividad:', error);
        console.error('🔗 URL que falló:', url);
        // Tipos por defecto si falla
        this.tiposActividad = [
          { id: 1, nombre: 'Senderismo' },
          { id: 2, nombre: 'Conducir' },
          { id: 3, nombre: 'Ciclismo' }
        ];
      }
    });
  }

  // ====================================================================
  // IMPORTACIÓN DESDE MÓVIL
  // ====================================================================

  /**
   * Inicia el proceso de importación desde móvil
   * Abre selector de carpeta usando File System Access API
   */
  async importarDesdeMovil() {
    console.log('📂 Iniciando importación desde móvil...');

    try {
      // Crear input file temporal con webkitdirectory
      const input = document.createElement('input');
      input.type = 'file';
      (input as any).webkitdirectory = true;
      input.multiple = true;

      // Promesa para manejar la selección
      const filesPromise = new Promise<FileList | null>((resolve) => {
        input.onchange = () => resolve(input.files);
        input.oncancel = () => resolve(null);
      });

      // Abrir selector
      input.click();

      // Esperar selección
      const files = await filesPromise;

      if (!files || files.length === 0) {
        console.log('ℹ️ Usuario canceló la selección');
        return;
      }

      console.log(`📁 Carpeta seleccionada con ${files.length} archivos`);

      // Convertir FileList a Array
      this.archivosSeleccionados = Array.from(files);

      // Buscar manifest.json
      const manifestFile = this.archivosSeleccionados.find(f => f.name === 'manifest.json');

      if (!manifestFile) {
        alert('❌ La carpeta seleccionada no contiene manifest.json\n\nAsegúrate de seleccionar una carpeta exportada desde AudioPhotoApp.');
        return;
      }

      // Leer manifest
      const manifestText = await manifestFile.text();
      this.manifestData = JSON.parse(manifestText);

      console.log('✅ Manifest cargado:', this.manifestData.nombre);

      // Verificar si el viaje tiene videos
      const hayVideos = this.manifestData.multimedia?.some((m: any) => m.tipo === 'video');
      if (hayVideos) {
        this.videosRequeridos = true;
        this.videosSeleccionados = false;
        console.log('📹 El viaje contiene videos. Se requiere seleccionar la carpeta de videos.');
      } else {
        this.videosRequeridos = false;
      }

      // Autocompletar destino
      const primeraFoto = this.manifestData.multimedia?.find((m: any) => m.tipo === 'foto');
      if (primeraFoto?.gps) {
        this.destinoViaje = this.manifestData.destino || 'España';
      }

      // Mostrar modal de configuración
      this.mostrarModalImport = true;

    } catch (error: any) {
      console.error('❌ Error seleccionando carpeta:', error);
      alert(`Error al acceder a la carpeta: ${error.message}`);
    }
  }

  /**
   * Permite seleccionar la carpeta de videos (DCIM/AudioPhotoApp/videos)
   */
  async seleccionarCarpetaVideos() {
    console.log('📂 Seleccionando carpeta de videos...');
    try {
      const input = document.createElement('input');
      input.type = 'file';
      (input as any).webkitdirectory = true;
      input.multiple = true;

      const filesPromise = new Promise<FileList | null>((resolve) => {
        input.onchange = () => resolve(input.files);
        input.oncancel = () => resolve(null);
      });

      input.click();
      const files = await filesPromise;

      if (!files || files.length === 0) {
        return;
      }

      // Filtrar solo videos MP4
      const allMp4 = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.mp4'));

      // ✅ LOGICA ROBUSTA DE FILTRADO
      // 1. Extraer fecha del tracking desde el nombre del manifest (ej: "Recorrido_20260217" -> "20260217")
      const matchFecha = this.manifestData.nombre?.match(/(\d{8})/);
      const fechaTracking = matchFecha ? matchFecha[1] : null;

      // 2. Obtener nombres de videos del manifest para comparación (sin extensión)
      const videosEnManifest = this.manifestData.multimedia
        ?.filter((m: any) => m.tipo === 'video')
        .map((m: any) => m.nombre.toLowerCase()) || [];

      console.log(`🎯 Fecha de referencia: ${fechaTracking}`);
      console.log(`📋 Videos en manifest: ${videosEnManifest.length}`);
      console.log(`📂 Videos totales en carpeta: ${allMp4.length}`);

      const videoFiles = allMp4.filter(file => {
        const nombre = file.name.toLowerCase();
        const basename = nombre.replace(/\.[^.]+$/, '');

        // A. DETECCIÓN DE FECHA EN EL NOMBRE (Prioridad Máxima de rechazo/aceptación)
        // Buscamos un patrón de 8 dígitos (YYYYMMDD)
        const matchFechaArchivo = nombre.match(/(\d{8})/);
        const fechaEnNombre = matchFechaArchivo ? matchFechaArchivo[1] : null;

        // Caso crítico: Si el nombre tiene una fecha y NO coincide con el tracking, DESCARTAMOS inmediatamente
        // Esto evita que videos del día 15 o 17 entren en el tracking del 16 si se copiaron ese día.
        if (fechaEnNombre && fechaTracking && fechaEnNombre !== fechaTracking) {
          console.log(`❌ DESCARTADO (Fecha incorrecta en nombre): ${file.name}`);
          return false;
        }

        // B. COINCIDENCIA POR LISTA DEL MANIFEST (Basename)
        // El manifest es la fuente de verdad definitiva de lo que AudioPhotoApp incluyó.
        if (videosEnManifest.some((v: string) => basename.includes(v) || v.includes(basename))) {
          console.log(`✅ Coincidencia por MANIFEST: ${file.name}`);
          return true;
        }

        // C. COINCIDENCIA POR NOMBRE (Fecha correcta)
        if (fechaTracking && fechaEnNombre === fechaTracking) {
          console.log(`✅ Coincidencia por NOMBRE (Fecha correcta): ${file.name}`);
          return true;
        }

        // D. COINCIDENCIA POR METADATOS (Solo si no hay fecha clara en el nombre)
        if (!fechaEnNombre && fechaTracking) {
          const fechaMod = new Date(file.lastModified);
          const y = fechaMod.getFullYear();
          const m = String(fechaMod.getMonth() + 1).padStart(2, '0');
          const d = String(fechaMod.getDate()).padStart(2, '0');
          const fechaModStr = `${y}${m}${d}`;

          if (fechaModStr === fechaTracking) {
            console.log(`✅ Coincidencia por METADATOS: ${file.name}`);
            return true;
          }
        }

        return false;
      });

      if (videoFiles.length === 0 && allMp4.length > 0) {
        const confirmar = confirm(`⚠️ No se detectaron videos del día ${fechaTracking || ''} en la carpeta.\n\n¿Quieres usar TODOS los videos (${allMp4.length}) de todos modos?`);
        if (confirmar) {
          this.archivosVideo = allMp4;
        } else {
          return;
        }
      } else {
        this.archivosVideo = videoFiles;
      }

      this.videosSeleccionados = true;
      console.log(`✅ ${this.archivosVideo.length} videos listos para subir.`);

    } catch (error: any) {
      console.error('❌ Error seleccionando carpeta de videos:', error);
    }
  }

  // ====================================================================
  // MODAL DE CONFIGURACIÓN
  // ====================================================================

  /**
   * Cierra el modal y cancela la importación
   */
  cancelarImportacion() {
    this.mostrarModalImport = false;
    this.archivosSeleccionados = [];
    this.manifestData = null;
    this.destinoViaje = '';
    this.tipoActividadId = null;
    this.videosRequeridos = false;
    this.videosSeleccionados = false;
    this.ignorarVideos = false;
    this.archivosVideo = [];
  }

  /**
   * Confirma la importación y procesa los archivos
   */
  async confirmarImportacion() {
    // Validar campos
    if (!this.destinoViaje.trim()) {
      alert('Por favor, ingresa el destino del viaje');
      return;
    }

    if (!this.tipoActividadId) {
      alert('Por favor, selecciona el tipo de actividad');
      return;
    }

    console.log('🚀 Iniciando subida de archivos...');

    this.importando = true;
    this.progresoSubida = 0;
    this.mensajeProgreso = 'Preparando archivos...';

    try {
      // ✅ NUEVO: Debug de archivos ANTES de crear FormData
      console.log('\n🔍 =============== ANÁLISIS DE ARCHIVOS A ENVIAR ===============');
      console.log(`📦 Total de archivos seleccionados: ${this.archivosSeleccionados.length}`);

      // Contar por tipo
      const gpxFiles = this.archivosSeleccionados.filter(f => f.name.endsWith('.gpx'));
      const pngFiles = this.archivosSeleccionados.filter(f => f.name.endsWith('.png'));
      const jpgFiles = this.archivosSeleccionados.filter(f => f.name.endsWith('.jpg'));
      const mp4Files = this.archivosSeleccionados.filter(f => f.name.endsWith('.mp4'));
      const wavFiles = this.archivosSeleccionados.filter(f => f.name.endsWith('.wav'));
      const jsonFiles = this.archivosSeleccionados.filter(f => f.name.endsWith('.json'));

      console.log('📊 Resumen por tipo:');
      console.log(`  📍 GPX: ${gpxFiles.length}`);
      console.log(`  🗺️ PNG: ${pngFiles.length}`);
      console.log(`  📸 JPG: ${jpgFiles.length}`);
      console.log(`  🎥 MP4: ${mp4Files.length}`);
      console.log(`  🎤 WAV: ${wavFiles.length}`);
      console.log(`  📋 JSON: ${jsonFiles.length}`);

      console.log('\n📍 DETALLE DE ARCHIVOS GPX:');
      gpxFiles.forEach((f, idx) => {
        const relativePath = (f as any).webkitRelativePath || f.name;
        console.log(`  [${idx + 1}] ${relativePath} (${(f.size / 1024).toFixed(2)} KB)`);
      });

      console.log('\n🗺️ DETALLE DE ARCHIVOS PNG:');
      pngFiles.forEach((f, idx) => {
        const relativePath = (f as any).webkitRelativePath || f.name;
        console.log(`  [${idx + 1}] ${relativePath} (${(f.size / 1024).toFixed(2)} KB)`);
      });

      console.log('\n===============================================\n');

      // Crear FormData
      const formData = new FormData();
      formData.append('destino', this.destinoViaje);
      formData.append('tipoActividadId', this.tipoActividadId.toString());

      // Añadir todos los archivos CON su ruta relativa preservada
      // COMBINAR ARCHIVOS: Exportación + Videos (si los hay)
      const todosLosArchivos = [...this.archivosSeleccionados, ...this.archivosVideo];

      // ✅ LOG: Tamaño total a enviar
      const totalBytes = todosLosArchivos.reduce((sum, f) => sum + f.size, 0);
      console.log(`📊 Análisis final de subida:`);
      console.log(`   Archivos totales: ${todosLosArchivos.length}`);
      console.log(`   Tamaño total: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

      // Añadir todos los archivos al FormData
      todosLosArchivos.forEach((file, index) => {
        const relativePath = (file as any).webkitRelativePath || file.name;
        formData.append('archivos', file, relativePath);

        // Actualizar progreso de preparación (0-30%)
        const progreso = Math.round((index / todosLosArchivos.length) * 30);
        this.progresoSubida = progreso;
        this.mensajeProgreso = `Preparando archivos... ${index + 1}/${todosLosArchivos.length}`;
      });

      const uploadUrl = `${this.API_URL}/import-tracking`;
      console.log(`📤 Subiendo a:`, uploadUrl);
      this.mensajeProgreso = 'Iniciando subida...';
      this.progresoSubida = 0;

      // Subir al backend con seguimiento de progreso real y timeout de 30 min
      const resultado = await new Promise<any>((resolve, reject) => {
        this.http.post(uploadUrl, formData, {
          reportProgress: true,
          observe: 'events'
        }).pipe(
          timeout(1800000), // 30 minutos
          catchError(err => {
            if (err.name === 'TimeoutError') {
              console.error('❌ [TIMEOUT] La subida ha superado los 30 minutos');
              return throwError(() => new Error('La subida ha superado el tiempo máximo (30 min). Por favor, intenta con menos archivos o mejor conexión.'));
            }
            return throwError(() => err);
          })
        ).subscribe({
          next: (event: any) => {
            if (event.type === HttpEventType.UploadProgress) {
              // CALCULAR PROGRESO REAL (0-100%)
              const total = event.total || totalBytes;
              this.progresoSubida = Math.round((event.loaded / total) * 100);
              const mbSubidos = (event.loaded / 1024 / 1024).toFixed(2);
              const mbTotal = (total / 1024 / 1024).toFixed(2);
              this.mensajeProgreso = `Subiendo archivos... ${this.progresoSubida}% (${mbSubidos} / ${mbTotal} MB)`;
            } else if (event.type === HttpEventType.Response) {
              console.log('✅ Servidor recibió los archivos. Procesando...');
              this.mensajeProgreso = 'Procesando en servidor...';
              this.progresoSubida = 100;
              resolve(event.body);
            }
          },
          error: (err) => {
            console.error('❌ Error en subida:', err);
            reject(err);
          }
        });
      });

      console.log('✅ Importación completada:', resultado);

      // Mostrar mensaje de éxito
      const resumen = `✅ Importación Completada

📁 Viaje creado: "${this.manifestData.nombre}"
📸 ${this.manifestData.estadisticas.num_fotos} fotos importadas
🎥 ${this.manifestData.estadisticas.num_videos} videos importados
🎤 ${this.manifestData.estadisticas.num_audios} audios importados
🗺️ Track GPS guardado`;

      alert(resumen);

      // 🗑️ NUEVO: Borrar carpeta de Documents después de importar
      try {
        console.log('🗑️ Intentando borrar carpeta de almacenamiento público...');
        // Nota: File System Access API no tiene método delete por seguridad
        // El usuario debe borrar manualmente la carpeta de Documents/AudioPhotoApp/
        console.log('ℹ️ Carpeta no borrada automáticamente (restricción del navegador)');
        console.log('💡 Sugerencia: Borrar manualmente desde el administrador de archivos');
      } catch (error) {
        console.warn('⚠️ No se pudo borrar la carpeta automáticamente:', error);
      }

      // Navegar al viaje importado
      this.router.navigate(['/viajes', resultado.viajeId]);

      // Cerrar modal
      this.mostrarModalImport = false;
      this.importando = false;

    } catch (error: any) {
      console.error('❌ Error en importación:', error);
      console.error('🔗 URL que falló:', `${this.API_URL}/import-tracking`);

      this.importando = false;

      const errorMsg = error.error?.error || error.message || 'Error desconocido';
      alert(`❌ Error al importar:\n\n${errorMsg}\n\nRevisa la consola para más detalles.`);
    }
  }

  // ====================================================================
  // MÉTODOS AUXILIARES
  // ====================================================================

  /**
 * Formatea el tamaño total de archivos
 */
  getTamanoTotal(): string {
    const totalBytes = this.archivosSeleccionados.reduce((sum, f) => sum + f.size, 0);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
    return `${totalMB} MB`;
  }

  // ====================================================================
  // ✨ NUEVOS MÉTODOS PARA NAVEGACIÓN
  // ====================================================================

  /**
   * Navega a la página de planificación de viajes (con IA)
   */
  irAPlanificarViaje() {
    this.router.navigate(['/planificar-viaje']);
  }

  /**
   * Navega a la lista de viajes futuros
   */
  irAViajesFuturos() {
    this.router.navigate(['/viajes-futuros']);
  }

  /**
   * Navega a la lista de recuerdos (viajes realizados)
   */
  irARecuerdos() {
    this.router.navigate(['/viajes-previstos']);
  }
}
