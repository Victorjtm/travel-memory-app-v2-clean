import { Component, OnInit } from '@angular/core';
import { RouterModule, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-inicio',
  standalone: true,
  imports: [RouterModule, CommonModule, FormsModule],
  templateUrl: './inicio.component.html',
  styleUrls: ['./inicio.component.scss']
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
      this.archivosSeleccionados.forEach((file, index) => {
        // Preservar la ruta completa del archivo (ej: "fotos/JPEG_123.jpg")
        const relativePath = (file as any).webkitRelativePath || file.name;
        formData.append('archivos', file, relativePath);

        // ✅ NUEVO: Log específico para archivos importantes
        if (file.name.endsWith('.gpx') || file.name.endsWith('.png') || file.name === 'manifest.json') {
          console.log(`📤 Agregando a FormData: ${relativePath}`);
        }

        // Actualizar progreso de preparación
        const progreso = Math.round((index / this.archivosSeleccionados.length) * 30);
        this.progresoSubida = progreso;
        this.mensajeProgreso = `Preparando archivos... ${index + 1}/${this.archivosSeleccionados.length}`;
      });

      const uploadUrl = `${this.API_URL}/import-tracking`;
      console.log(`📤 Subiendo ${this.archivosSeleccionados.length} archivos a:`, uploadUrl);
      this.mensajeProgreso = 'Subiendo al servidor...';
      this.progresoSubida = 50;

      // Subir al backend
      const resultado: any = await this.http.post(uploadUrl, formData).toPromise();

      // Progreso completado
      this.progresoSubida = 100;
      this.mensajeProgreso = 'Procesando en servidor...';

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
}