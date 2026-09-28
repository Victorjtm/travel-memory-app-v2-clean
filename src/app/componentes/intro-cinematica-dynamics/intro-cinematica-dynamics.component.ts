import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
  NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as THREE from 'three';
import { IntroMemoryPreloaderService, MemoryFrame } from '../../servicios/intro-memory-preloader.service';

interface FotoVuelo {
  frame: MemoryFrame;
  tiempoInicio: number;
  duracion: number;
  formato: 'polaroid' | 'cuadrado' | 'postal' | 'vertical' | 'panoramica';
  driftX: number;
  driftY: number;
  giroMax: number;
  anchoBase: number;
  altoBase: number;
}

@Component({
  selector: 'app-intro-cinematica-dynamics',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './intro-cinematica-dynamics.component.html',
  styleUrls: ['./intro-cinematica-dynamics.component.scss']
})
export class IntroCinematicaDynamicsComponent implements OnInit, OnDestroy {
  @ViewChild('introCanvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input() tituloViaje: string = 'CRUCERO';
  @Input() imagenPortada: string | null = null;
  @Input() permitirSaltar: boolean = true;
  @Input() archivosViaje: any[] = [];
  @Input() sonidoActivado: boolean = true;

  @Output() completado = new EventEmitter<void>();

  activo: boolean = true;
  tiempoActual: number = 0; // 0.0s a 7.50s exactos

  // Duración pausada y cinematográfica: 11.2 segundos (caída visible, zoom a portada y lectura tranquila)
  public readonly DURACION_TOTAL: number = 11.2;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;

  // Mallas 3D
  private mesaMesh!: THREE.Mesh;
  private sombraContactoMesh!: THREE.Mesh;
  private libroGroup!: THREE.Group;
  private tapaPivotGroup!: THREE.Group;
  private tapaMesh!: THREE.Mesh;
  private polvoParticles!: THREE.Points;
  private polvoVelocidades: THREE.Vector3[] = [];
  private motesParticles!: THREE.Points;
  private motesVelocidades: THREE.Vector3[] = [];
  private planoRecuerdos!: THREE.Mesh;
  private materialRecuerdos!: THREE.MeshBasicMaterial;
  private texturaRecuerdoActual: THREE.CanvasTexture | null = null;
  private canvasRecuerdos!: HTMLCanvasElement;
  private ctxRecuerdos!: CanvasRenderingContext2D;
  private luzInteriorLibro!: THREE.PointLight;

  // Textura y gráfica de la cubierta 3D
  private canvasCuero!: HTMLCanvasElement;
  private ctxCuero!: CanvasRenderingContext2D;
  private texturaCuero!: THREE.CanvasTexture;
  private texturaBumpCuero!: THREE.CanvasTexture;
  private texturaHojas!: THREE.CanvasTexture;
  private fotoPortadaBitmap: ImageBitmap | null = null;

  // Control de animación
  private animacionId: number | null = null;
  private tiempoInicio: number = 0;
  private framesPrecargados: MemoryFrame[] = [];
  private audioContext: AudioContext | null = null;
  private sonidoImpactoEmitido: boolean = false;
  private sonidoAperturaEmitido: boolean = false;
  private sonidoCierreEmitido: boolean = false;

  // Vuelo sereno de fotos desde la página derecha del libro abierto
  private fotosEnVuelo: FotoVuelo[] = [];
  private indiceSiguienteFoto: number = 0;
  private ultimoTiempoSpawn: number = 0;

  constructor(
    private ngZone: NgZone,
    private preloaderService: IntroMemoryPreloaderService
  ) {}

  async ngOnInit(): Promise<void> {
    if (this.imagenPortada) {
      this.cargarFotoPortadaBitmap(this.imagenPortada);
    }

    if (this.archivosViaje && this.archivosViaje.length > 0) {
      // 🚀 Precarga ultra-rápida (16 fotos mezcladas de todos los itinerarios de forma equilibrada)
      this.preloaderService.prepararRafagaRecuerdos(this.archivosViaje, 16).then(frames => {
        this.framesPrecargados = frames;
        if (!this.fotoPortadaBitmap && this.framesPrecargados.length > 0) {
          this.fotoPortadaBitmap = this.framesPrecargados[0].bitmap;
          this.repintarCubiertaLibro();
        }
      }).catch(err => {
        console.warn('⚠️ [IntroCinematica] Error en precarga de recuerdos:', err);
      });
    }
  }

  ngAfterViewInit(): void {
    this.iniciarEscena3D();
  }

  ngOnDestroy(): void {
    this.detenerAnimacion();
    this.liberarRecursosThree();
    this.preloaderService.liberarMemoria();
  }

  /**
   * 🖼️ Carga y decodifica la imagen de portada como bitmap para el relicario 3D
   */
  private async cargarFotoPortadaBitmap(url: string): Promise<void> {
    try {
      const resp = await fetch(url, { mode: 'cors' });
      if (!resp.ok) throw new Error('Error al descargar imagen portada');
      const blob = await resp.blob();
      this.fotoPortadaBitmap = await createImageBitmap(blob, {
        resizeWidth: 1024,
        resizeHeight: 680,
        resizeQuality: 'high'
      });
      this.repintarCubiertaLibro();
    } catch {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        try {
          this.fotoPortadaBitmap = await createImageBitmap(img, {
            resizeWidth: 1024,
            resizeHeight: 680,
            resizeQuality: 'high'
          });
          this.repintarCubiertaLibro();
        } catch {}
      };
      img.src = url;
    }
  }

  /**
   * 🎬 Configura la escena Three.js, luces, texturas y cámara cercana
   */
  private iniciarEscena3D(): void {
    const canvas = this.canvasRef.nativeElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;

    this.canvasRecuerdos = document.createElement('canvas');
    this.canvasRecuerdos.width = 1280;
    this.canvasRecuerdos.height = 720;
    this.ctxRecuerdos = this.canvasRecuerdos.getContext('2d', { alpha: true })!;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0705);
    this.scene.fog = new THREE.FogExp2(0x0a0705, 0.08);

    // Cámara más cercana (3.2, 3.2) para que el libro y el título se vean GRANDES en pantalla
    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    this.camera.position.set(0, 3.2, 3.2);
    this.camera.lookAt(0, 0.35, 0.25);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 💡 Iluminación cinematográfica PBR:
    // 1. Luz ambiente difusa tenue
    const luzAmbiente = new THREE.AmbientLight(0xffeedd, 0.45);
    this.scene.add(luzAmbiente);

    // 2. Luz hemisférica (cielo cálido y rebote de caoba desde la mesa)
    const luzHemisferio = new THREE.HemisphereLight(0xffeedd, 0x221108, 0.55);
    this.scene.add(luzHemisferio);

    // 3. Foco directivo principal con sombras suaves de alta definición
    const luzDireccional = new THREE.DirectionalLight(0xfff0d2, 3.2);
    luzDireccional.position.set(3.2, 7.5, 3.8);
    luzDireccional.castShadow = true;
    luzDireccional.shadow.mapSize.width = 2048;
    luzDireccional.shadow.mapSize.height = 2048;
    luzDireccional.shadow.camera.near = 1.0;
    luzDireccional.shadow.camera.far = 16.0;
    luzDireccional.shadow.camera.left = -3.5;
    luzDireccional.shadow.camera.right = 3.5;
    luzDireccional.shadow.camera.top = 3.5;
    luzDireccional.shadow.camera.bottom = -3.5;
    luzDireccional.shadow.bias = -0.0003;
    luzDireccional.shadow.normalBias = 0.025;
    luzDireccional.shadow.radius = 2.4;
    this.scene.add(luzDireccional);

    // 4. Luz rasante lateral/trasera (Rim light) para siluetas de cuero y esquineras metálicas
    const luzRim = new THREE.DirectionalLight(0xffaa55, 1.4);
    luzRim.position.set(-3.5, 4.2, -2.5);
    this.scene.add(luzRim);

    // 5. Relleno suave frontal
    const luzRellenoFrontal = new THREE.PointLight(0xfff0d8, 0.85, 10);
    luzRellenoFrontal.position.set(0, 2.5, 3.8);
    this.scene.add(luzRellenoFrontal);

    // 6. Luz interior dorada que brota del libro al abrirse
    this.luzInteriorLibro = new THREE.PointLight(0xffd570, 0, 7, 1.2);
    this.luzInteriorLibro.position.set(0.5, 0.55, 0);
    this.scene.add(this.luzInteriorLibro);

    this.construirMesaMadera();
    this.construirSombraContacto();
    this.construirLibroVintage();
    this.construirPolvoVolumetrico();
    this.construirPolvoAmbiental();
    this.construirPlanoRecuerdos();

    this.ngZone.runOutsideAngular(() => {
      this.tiempoInicio = performance.now();
      this.bucleRender(this.tiempoInicio);
    });
  }

  private construirMesaMadera(): void {
    const canvasMadera = document.createElement('canvas');
    canvasMadera.width = 2048;
    canvasMadera.height = 2048;
    const ctx = canvasMadera.getContext('2d')!;

    const gradBase = ctx.createLinearGradient(0, 0, 0, 2048);
    gradBase.addColorStop(0, '#1c0f08');
    gradBase.addColorStop(0.5, '#2a180f');
    gradBase.addColorStop(1, '#180d07');
    ctx.fillStyle = gradBase;
    ctx.fillRect(0, 0, 2048, 2048);

    for (let i = 0; i < 900; i++) {
      ctx.strokeStyle = `rgba(65, 38, 22, ${0.05 + Math.random() * 0.28})`;
      ctx.lineWidth = 1 + Math.random() * 5;
      ctx.beginPath();
      const x = Math.random() * 2048;
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 35, 700, x - 35, 1400, x + 20, 2048);
      ctx.stroke();
    }

    for (let x = 340; x < 2048; x += 340) {
      ctx.strokeStyle = 'rgba(10, 5, 2, 0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 2048);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(120, 75, 45, 0.2)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 2, 0);
      ctx.lineTo(x + 2, 2048);
      ctx.stroke();
    }

    const sombraCentro = ctx.createRadialGradient(1024, 1024, 200, 1024, 1024, 800);
    sombraCentro.addColorStop(0, 'rgba(5, 2, 1, 0.7)');
    sombraCentro.addColorStop(0.7, 'rgba(10, 5, 2, 0.35)');
    sombraCentro.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = sombraCentro;
    ctx.fillRect(0, 0, 2048, 2048);

    const texturaMadera = new THREE.CanvasTexture(canvasMadera);
    texturaMadera.wrapS = THREE.RepeatWrapping;
    texturaMadera.wrapT = THREE.RepeatWrapping;
    texturaMadera.repeat.set(1.5, 1.5);

    const matMadera = new THREE.MeshStandardMaterial({
      map: texturaMadera,
      roughness: 0.45,
      metalness: 0.08
    });

    const geoMadera = new THREE.PlaneGeometry(18, 18);
    this.mesaMesh = new THREE.Mesh(geoMadera, matMadera);
    this.mesaMesh.rotation.x = -Math.PI / 2;
    this.mesaMesh.position.y = 0;
    this.mesaMesh.receiveShadow = true;
    this.scene.add(this.mesaMesh);
  }

  /**
   * 🌑 Sombra de contacto suave y dinámica que ancla el libro físicamente a la mesa
   */
  private construirSombraContacto(): void {
    const canvasSombra = document.createElement('canvas');
    canvasSombra.width = 512;
    canvasSombra.height = 512;
    const ctx = canvasSombra.getContext('2d')!;

    const grad = ctx.createRadialGradient(256, 256, 35, 256, 256, 250);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.92)');
    grad.addColorStop(0.35, 'rgba(10, 5, 2, 0.65)');
    grad.addColorStop(0.70, 'rgba(15, 8, 4, 0.22)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    const tex = new THREE.CanvasTexture(canvasSombra);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });

    this.sombraContactoMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 4.3), mat);
    this.sombraContactoMesh.rotation.x = -Math.PI / 2;
    this.sombraContactoMesh.position.set(0, 0.003, 0);
    this.scene.add(this.sombraContactoMesh);
  }

  /**
   * ✨ Partículas doradas ambientales que flotan serenamente en el haz del foco
   */
  private construirPolvoAmbiental(): void {
    const total = 90;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(total * 3);
    this.motesVelocidades = [];

    for (let i = 0; i < total; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 4.5;
      pos[i * 3 + 1] = 0.2 + Math.random() * 3.6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4.5;

      this.motesVelocidades.push(new THREE.Vector3(
        (Math.random() - 0.5) * 0.003,
        0.001 + Math.random() * 0.003,
        (Math.random() - 0.5) * 0.003
      ));
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffe2a4,
      size: 0.045,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.motesParticles = new THREE.Points(geo, mat);
    this.scene.add(this.motesParticles);
  }

  private actualizarPolvoAmbiental(): void {
    if (!this.motesParticles) return;
    const geo = this.motesParticles.geometry as THREE.BufferGeometry;
    const pos = geo.attributes['position'].array as Float32Array;
    for (let i = 0; i < this.motesVelocidades.length; i++) {
      const vel = this.motesVelocidades[i];
      pos[i * 3] += vel.x + Math.sin(this.tiempoActual * 0.8 + i) * 0.001;
      pos[i * 3 + 1] += vel.y;
      pos[i * 3 + 2] += vel.z + Math.cos(this.tiempoActual * 0.8 + i) * 0.001;

      if (pos[i * 3 + 1] > 3.8) {
        pos[i * 3 + 1] = 0.2;
      }
    }
    geo.attributes['position'].needsUpdate = true;
  }

  /**
   * 🔬 Genera un mapa de relieve (bump map) procedimental para poro de cuero y bajorrelieves
   */
  private generarTexturaBumpCuero(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 1024, 1024);

    const imgData = ctx.getImageData(0, 0, 1024, 1024);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 32;
      const v = Math.min(255, Math.max(0, 128 + n));
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);

    // Hendiduras de grabado por estampación en caliente de los marcos dorados
    ctx.strokeStyle = '#484848';
    ctx.lineWidth = 10;
    ctx.strokeRect(50, 50, 924, 924);
    ctx.lineWidth = 4;
    ctx.strokeRect(65, 65, 894, 894);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  /**
   * 📜 Genera textura realista con microestratificación de páginas y pan de oro en los cantos
   */
  private generarTexturaCantosHojas(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Fondo dorado envejecido con degradado
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#f2dc98');
    grad.addColorStop(0.3, '#d4af37');
    grad.addColorStop(0.7, '#a98024');
    grad.addColorStop(1, '#edd692');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 256);

    // Microestratificación horizontal: simula miles de hojas de papel prensadas
    for (let y = 0; y < 256; y += 2) {
      const alpha = 0.12 + Math.random() * 0.32;
      const esOscuro = Math.random() > 0.45;
      ctx.strokeStyle = esOscuro ? `rgba(60, 38, 12, ${alpha})` : `rgba(255, 248, 215, ${alpha * 0.9})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1024, y);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  /**
   * 📖 Construye la malla del libro vintage 3D con TAPA ARTICULADA:
   * Exterior con título en oro y relicario; INTERIOR EN CUERO MARRÓN LIMPIO (sin texto al revés)
   */
  private construirLibroVintage(): void {
    this.libroGroup = new THREE.Group();

    this.canvasCuero = document.createElement('canvas');
    this.canvasCuero.width = 2048;
    this.canvasCuero.height = 2048;
    this.ctxCuero = this.canvasCuero.getContext('2d')!;

    this.texturaCuero = new THREE.CanvasTexture(this.canvasCuero);
    this.texturaCuero.colorSpace = THREE.SRGBColorSpace;
    this.texturaCuero.anisotropy = 8;

    this.texturaBumpCuero = this.generarTexturaBumpCuero();
    this.texturaHojas = this.generarTexturaCantosHojas();

    this.repintarCubiertaLibro();

    const anchoLibro = 2.4;
    const altoLibro = 0.35;
    const profLibro = 3.2;

    // 1. Material exterior de la cubierta (cara superior +Y) con microrelieve de piel
    const matCueroFrontal = new THREE.MeshStandardMaterial({
      map: this.texturaCuero,
      bumpMap: this.texturaBumpCuero,
      bumpScale: 0.042,
      roughness: 0.38,
      metalness: 0.22
    });

    // 2. Material interior de la tapa (cara -Y): CUERO MARRÓN LIMPIO Y ELEGANTE
    const canvasInteriorTapa = document.createElement('canvas');
    canvasInteriorTapa.width = 512;
    canvasInteriorTapa.height = 512;
    const ctxTapaInt = canvasInteriorTapa.getContext('2d')!;
    ctxTapaInt.fillStyle = '#261309';
    ctxTapaInt.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2500; i++) {
      ctxTapaInt.fillStyle = `rgba(15, 7, 3, ${0.05 + Math.random() * 0.14})`;
      ctxTapaInt.fillRect(Math.random() * 512, Math.random() * 512, 2.5, 2.5);
    }
    const texCueroInterior = new THREE.CanvasTexture(canvasInteriorTapa);
    const matCueroInterior = new THREE.MeshStandardMaterial({
      map: texCueroInterior,
      roughness: 0.65,
      metalness: 0.12
    });

    const matBorde = new THREE.MeshStandardMaterial({
      color: 0x1f0e08,
      roughness: 0.55
    });

    // Hojas doradas del libro con microestratificación fotorrealista
    const geoHojas = new THREE.BoxGeometry(anchoLibro * 0.96, altoLibro * 0.85, profLibro * 0.96);
    const matHojas = new THREE.MeshStandardMaterial({
      map: this.texturaHojas,
      roughness: 0.52,
      metalness: 0.42
    });
    const hojasMesh = new THREE.Mesh(geoHojas, matHojas);
    hojasMesh.position.set(0.04, altoLibro * 0.45, 0);
    hojasMesh.castShadow = true;
    hojasMesh.receiveShadow = true;
    this.libroGroup.add(hojasMesh);

    // Página interior derecha visible cuando se abre la tapa (pergamino con filigrana dorada)
    const canvasInterior = document.createElement('canvas');
    canvasInterior.width = 1024;
    canvasInterior.height = 1024;
    const ctxInt = canvasInterior.getContext('2d')!;
    ctxInt.fillStyle = '#f5ecd8';
    ctxInt.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 3000; i++) {
      ctxInt.fillStyle = `rgba(180, 140, 90, ${0.03 + Math.random() * 0.08})`;
      ctxInt.fillRect(Math.random() * 1024, Math.random() * 1024, 3, 3);
    }
    ctxInt.strokeStyle = '#c59d42';
    ctxInt.lineWidth = 12;
    ctxInt.strokeRect(60, 60, 904, 904);
    ctxInt.font = 'italic 34px "Cinzel", "Georgia", serif';
    ctxInt.fillStyle = '#6a4515';
    ctxInt.textAlign = 'center';
    ctxInt.fillText('✦   MEMORIAS Y RECUERDOS DEL VIAJE   ✦', 512, 512);

    const texInterior = new THREE.CanvasTexture(canvasInterior);
    const matInterior = new THREE.MeshStandardMaterial({ map: texInterior, roughness: 0.8 });
    const geoInterior = new THREE.PlaneGeometry(anchoLibro * 0.94, profLibro * 0.94);
    const interiorMesh = new THREE.Mesh(geoInterior, matInterior);
    interiorMesh.rotation.x = -Math.PI / 2;
    interiorMesh.position.set(0.04, altoLibro * 0.88, 0);
    this.libroGroup.add(interiorMesh);

    // PIVOTE ARTICULADO EN EL LOMO (x = -anchoLibro / 2) para rotar la tapa en Z
    this.tapaPivotGroup = new THREE.Group();
    this.tapaPivotGroup.position.set(-anchoLibro / 2, altoLibro + 0.03, 0);

    const geoTapa = new THREE.BoxGeometry(anchoLibro, 0.06, profLibro);
    // Asignación de materiales por cara de BoxGeometry:
    // [0:+X der, 1:-X izq, 2:+Y FRONT COVER, 3:-Y TAPA INTERIOR MARRÓN, 4:+Z front, 5:-Z back]
    this.tapaMesh = new THREE.Mesh(geoTapa, [
      matBorde,
      matBorde,
      matCueroFrontal,
      matCueroInterior,
      matBorde,
      matBorde
    ]);
    this.tapaMesh.position.set(anchoLibro / 2, 0, 0);
    this.tapaMesh.castShadow = true;

    // Esquineras metálicas (cantoneras de latón dorado) en las esquinas exteriores
    const matEsqMetal = new THREE.MeshStandardMaterial({
      color: 0xdfbe65,
      roughness: 0.28,
      metalness: 0.88
    });
    const cantoneraGeo = new THREE.BoxGeometry(0.18, 0.075, 0.18);
    const esq1 = new THREE.Mesh(cantoneraGeo, matEsqMetal);
    esq1.position.set(anchoLibro - 0.08, 0.002, profLibro / 2 - 0.08);
    this.tapaMesh.add(esq1);

    const esq2 = new THREE.Mesh(cantoneraGeo, matEsqMetal);
    esq2.position.set(anchoLibro - 0.08, 0.002, -profLibro / 2 + 0.08);
    this.tapaMesh.add(esq2);

    this.tapaPivotGroup.add(this.tapaMesh);
    this.libroGroup.add(this.tapaPivotGroup);

    // Lomo cilíndrico curvo a la izquierda
    const geoLomo = new THREE.CylinderGeometry(altoLibro * 0.5, altoLibro * 0.5, profLibro, 24, 1, false, 0, Math.PI);
    const matLomo = new THREE.MeshStandardMaterial({
      color: 0x1f0e08,
      roughness: 0.55,
      metalness: 0.2
    });
    const lomoMesh = new THREE.Mesh(geoLomo, matLomo);
    lomoMesh.rotation.z = Math.PI / 2;
    lomoMesh.rotation.y = Math.PI / 2;
    lomoMesh.position.set(-anchoLibro / 2, altoLibro * 0.5, 0);
    lomoMesh.castShadow = true;
    this.libroGroup.add(lomoMesh);

    // 4 nervios en relieve típicos de encuadernación artesanal clásica en el lomo
    const posicionesNerviosZ = [-1.05, -0.35, 0.35, 1.05];
    posicionesNerviosZ.forEach(posZ => {
      const geoNervio = new THREE.CylinderGeometry(altoLibro * 0.53, altoLibro * 0.53, 0.09, 24, 1, false, 0, Math.PI);
      const nervioMesh = new THREE.Mesh(geoNervio, matLomo);
      nervioMesh.rotation.z = Math.PI / 2;
      nervioMesh.rotation.y = Math.PI / 2;
      nervioMesh.position.set(-anchoLibro / 2, altoLibro * 0.5, posZ);
      nervioMesh.castShadow = true;
      this.libroGroup.add(nervioMesh);
    });

    // Posición inicial: suspendido en el aire antes de caer
    this.libroGroup.position.set(0, 4.0, 0);
    this.libroGroup.rotation.set(-0.2, -0.05, 0.08);
    this.scene.add(this.libroGroup);
  }

  /**
   * 🎨 Pinta la cubierta 3D con TÍTULO MAXIMIZADO (160px), pan de oro y relicario
   */
  private repintarCubiertaLibro(): void {
    if (!this.ctxCuero || !this.canvasCuero) return;
    const ctx = this.ctxCuero;
    const W = 2048;
    const H = 2048;

    ctx.clearRect(0, 0, W, H);

    // Fondo de cuero envejecido
    const gradCuero = ctx.createRadialGradient(W * 0.45, H * 0.35, 100, W * 0.5, H * 0.5, 1350);
    gradCuero.addColorStop(0, '#3a1e12');
    gradCuero.addColorStop(0.45, '#28130a');
    gradCuero.addColorStop(0.85, '#1a0b06');
    gradCuero.addColorStop(1, '#0e0502');
    ctx.fillStyle = gradCuero;
    ctx.fillRect(0, 0, W, H);

    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = `rgba(15, 7, 3, ${0.08 + Math.random() * 0.16})`;
      ctx.fillRect(Math.random() * W, Math.random() * H, 2.5, 2.5);
    }

    // Marcos exteriores de pan de oro repujado
    const margenExt = 100;
    const anchoExt = W - margenExt * 2;
    const altoExt = H - margenExt * 2;

    ctx.strokeStyle = '#0e0603';
    ctx.lineWidth = 18;
    ctx.strokeRect(margenExt + 4, margenExt + 4, anchoExt, altoExt);

    const gradOro = ctx.createLinearGradient(margenExt, margenExt, W - margenExt, H - margenExt);
    gradOro.addColorStop(0, '#fff3d1');
    gradOro.addColorStop(0.25, '#dfc488');
    gradOro.addColorStop(0.5, '#7a531a');
    gradOro.addColorStop(0.75, '#eecf8c');
    gradOro.addColorStop(1, '#9b6c26');
    ctx.strokeStyle = gradOro;
    ctx.lineWidth = 14;
    ctx.strokeRect(margenExt, margenExt, anchoExt, altoExt);

    const margenInt = margenExt + 30;
    ctx.strokeStyle = 'rgba(238, 207, 140, 0.75)';
    ctx.lineWidth = 3.5;
    ctx.strokeRect(margenInt, margenInt, W - margenInt * 2, H - margenInt * 2);

    this.dibujarEsquinerasOro(ctx, margenExt, margenExt, anchoExt, altoExt);

    // Insignia superior
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 38px "Cinzel", "Georgia", serif';
    ctx.fillStyle = '#100703';
    ctx.fillText('✦   DIARIO DE VIAJES Y MEMORIAS   ✦', W / 2 + 2, 220 + 2);
    ctx.fillStyle = '#dfc488';
    ctx.fillText('✦   DIARIO DE VIAJES Y MEMORIAS   ✦', W / 2, 220);

    // TÍTULO PRINCIPAL: LETRAS EXTRA GRANDES (160px) Y MÁXIMO CONTRASTE
    this.dibujarTituloAdaptativo(ctx, W / 2, 410, 1620);

    // Relicario fotográfico central enmarcado en oro
    this.dibujarRelicarioCentral(ctx, W / 2, 1250, 840, 530);

    // Insignia inferior
    ctx.font = 'bold 34px "Cinzel", serif';
    ctx.fillStyle = '#100703';
    ctx.fillText('✦   ✦   ✦', W / 2 + 2, 1740 + 2);
    ctx.fillStyle = '#dfc488';
    ctx.fillText('✦   ✦   ✦', W / 2, 1740);

    if (this.texturaCuero) {
      this.texturaCuero.needsUpdate = true;
    }
  }

  private dibujarEsquinerasOro(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const tam = 120;
    const esquinas = [
      { x: x, y: y, dx: 1, dy: 1 },
      { x: x + w, y: y, dx: -1, dy: 1 },
      { x: x, y: y + h, dx: 1, dy: -1 },
      { x: x + w, y: y + h, dx: -1, dy: -1 }
    ];

    for (const esq of esquinas) {
      ctx.save();
      ctx.translate(esq.x, esq.y);
      ctx.scale(esq.dx, esq.dy);

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(tam, 0);
      ctx.lineTo(tam, 22);
      ctx.lineTo(22, 22);
      ctx.lineTo(22, tam);
      ctx.lineTo(0, tam);
      ctx.closePath();

      ctx.fillStyle = 'rgba(12, 5, 2, 0.8)';
      ctx.fill();

      const gradEsq = ctx.createLinearGradient(0, 0, tam, tam);
      gradEsq.addColorStop(0, '#fff5d6');
      gradEsq.addColorStop(0.3, '#dfc488');
      gradEsq.addColorStop(0.7, '#7a541b');
      gradEsq.addColorStop(1, '#eccf8c');
      ctx.fillStyle = gradEsq;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(36, 36, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#fff0b8';
      ctx.fill();
      ctx.strokeStyle = '#5a3814';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.restore();
    }
  }

  /**
   * ✍️ Dibuja el título del libro con tamaño máximo (160px) para lectura inmediata
   */
  private dibujarTituloAdaptativo(ctx: CanvasRenderingContext2D, centerX: number, startY: number, maxAncho: number): void {
    const rawTitulo = (this.tituloViaje || 'CRUCERO').trim();

    const partes = rawTitulo.split(/\s*[-–—]\s*/);
    let lineas: { texto: string; esSecundaria: boolean }[] = [];

    if (partes.length >= 2) {
      const partePrincipal = partes[0].toUpperCase();
      const parteSecundaria = partes.slice(1).join(' · ').toUpperCase();

      const palabras = partePrincipal.split(' ');
      let lineaActual = '';
      for (const p of palabras) {
        if ((lineaActual + ' ' + p).trim().length > 17) {
          if (lineaActual) lineas.push({ texto: lineaActual.trim(), esSecundaria: false });
          lineaActual = p;
        } else {
          lineaActual = (lineaActual + ' ' + p).trim();
        }
      }
      if (lineaActual) lineas.push({ texto: lineaActual.trim(), esSecundaria: false });
      lineas.push({ texto: parteSecundaria, esSecundaria: true });
    } else {
      const palabras = rawTitulo.toUpperCase().split(' ');
      let lineaActual = '';
      for (const p of palabras) {
        if ((lineaActual + ' ' + p).trim().length > 18) {
          if (lineaActual) lineas.push({ texto: lineaActual.trim(), esSecundaria: false });
          lineaActual = p;
        } else {
          lineaActual = (lineaActual + ' ' + p).trim();
        }
      }
      if (lineaActual) lineas.push({ texto: lineaActual.trim(), esSecundaria: false });
    }

    // TAMAÑO DE FUENTE MAXIMIZADO (160px)
    let fontSizePrincipal = lineas.length === 1 ? 165 : (lineas.length === 2 ? 148 : 120);
    ctx.font = `bold ${fontSizePrincipal}px "Cinzel", "Georgia", serif`;

    while (lineas.some(l => !l.esSecundaria && ctx.measureText(l.texto).width > maxAncho) && fontSizePrincipal > 60) {
      fontSizePrincipal -= 4;
      ctx.font = `bold ${fontSizePrincipal}px "Cinzel", "Georgia", serif`;
    }

    const fontSizeSecundaria = Math.max(56, Math.round(fontSizePrincipal * 0.5));
    const interlineado = fontSizePrincipal * 1.15;

    let yActual = startY;
    for (const linea of lineas) {
      const esSec = linea.esSecundaria;
      const fSize = esSec ? fontSizeSecundaria : fontSizePrincipal;
      ctx.font = esSec ? `italic ${fSize}px "Georgia", serif` : `bold ${fSize}px "Cinzel", "Georgia", serif`;

      // Sombra profunda grabada en cuero
      ctx.fillStyle = '#020100';
      ctx.fillText(linea.texto, centerX + 6, yActual + 7);

      // Relieve dorado brillante con núcleo blanco-oro
      const gradTexto = ctx.createLinearGradient(centerX - 550, yActual - 40, centerX + 550, yActual + 40);
      gradTexto.addColorStop(0, '#ffffff');
      gradTexto.addColorStop(0.2, '#fff9e6');
      gradTexto.addColorStop(0.5, '#ffd97d');
      gradTexto.addColorStop(0.8, '#b88628');
      gradTexto.addColorStop(1, '#ffefa8');

      ctx.fillStyle = esSec ? '#fff0c2' : gradTexto;
      ctx.fillText(linea.texto, centerX, yActual);

      yActual += interlineado;
    }
  }

  private dibujarRelicarioCentral(ctx: CanvasRenderingContext2D, centerX: number, centerY: number, ancho: number, alto: number): void {
    const x = centerX - ancho / 2;
    const y = centerY - alto / 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(x - 6, y - 6, ancho + 12, alto + 12);

    const gradMarco = ctx.createLinearGradient(x, y, x + ancho, y + alto);
    gradMarco.addColorStop(0, '#fffbf0');
    gradMarco.addColorStop(0.3, '#dfc488');
    gradMarco.addColorStop(0.65, '#5a3814');
    gradMarco.addColorStop(1, '#dfc488');
    ctx.fillStyle = gradMarco;
    ctx.fillRect(x, y, ancho, alto);

    const padMarco = 12;
    const px = x + padMarco;
    const py = y + padMarco;
    const pw = ancho - padMarco * 2;
    const ph = alto - padMarco * 2;

    ctx.fillStyle = '#140b07';
    ctx.fillRect(px, py, pw, ph);

    const padFoto = 8;
    const fx = px + padFoto;
    const fy = py + padFoto;
    const fw = pw - padFoto * 2;
    const fh = ph - padFoto * 2;

    if (this.fotoPortadaBitmap) {
      this.dibujarImagenCover(ctx, this.fotoPortadaBitmap, fx, fy, fw, fh);

      const gradCristal = ctx.createLinearGradient(fx, fy, fx + fw, fy + fh);
      gradCristal.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
      gradCristal.addColorStop(0.4, 'rgba(255, 255, 255, 0.0)');
      gradCristal.addColorStop(0.7, 'rgba(0, 0, 0, 0.15)');
      gradCristal.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
      ctx.fillStyle = gradCristal;
      ctx.fillRect(fx, fy, fw, fh);
    } else {
      ctx.fillStyle = '#1a0e08';
      ctx.fillRect(fx, fy, fw, fh);

      ctx.fillStyle = '#dfc488';
      ctx.font = '60px serif';
      ctx.fillText('📷', centerX, centerY - 15);

      ctx.font = '26px "Cinzel", serif';
      ctx.fillText('DIARIO DE VIAJE', centerX, centerY + 45);
    }

    ctx.strokeStyle = 'rgba(223, 196, 136, 0.8)';
    ctx.lineWidth = 3;
    ctx.strokeRect(fx, fy, fw, fh);
  }

  private dibujarImagenCover(ctx: CanvasRenderingContext2D, img: ImageBitmap, x: number, y: number, w: number, h: number): void {
    const imgW = img.width;
    const imgH = img.height;
    const r = Math.max(w / imgW, h / imgH);
    const nw = imgW * r;
    const nh = imgH * r;
    const cx = (w - nw) * 0.5;
    const cy = (h - nh) * 0.5;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.drawImage(img, x + cx, y + cy, nw, nh);
    ctx.restore();
  }

  private construirPolvoVolumetrico(): void {
    const totalParticulas = 220;
    const geoPolvo = new THREE.BufferGeometry();
    const posiciones = new Float32Array(totalParticulas * 3);
    const opacidades = new Float32Array(totalParticulas);
    this.polvoVelocidades = [];

    for (let i = 0; i < totalParticulas; i++) {
      const angulo = Math.random() * Math.PI * 2;
      const radio = 0.8 + Math.random() * 1.6;

      posiciones[i * 3] = Math.cos(angulo) * radio;
      posiciones[i * 3 + 1] = 0.04;
      posiciones[i * 3 + 2] = Math.sin(angulo) * radio;

      const vel = new THREE.Vector3(
        Math.cos(angulo) * (2.5 + Math.random() * 3.5),
        0.4 + Math.random() * 1.8,
        Math.sin(angulo) * (2.5 + Math.random() * 3.5)
      );
      this.polvoVelocidades.push(vel);
      opacidades[i] = 0;
    }

    geoPolvo.setAttribute('position', new THREE.BufferAttribute(posiciones, 3));

    const matPolvo = new THREE.PointsMaterial({
      color: 0xd4c29a,
      size: 0.12,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.polvoParticles = new THREE.Points(geoPolvo, matPolvo);
    this.scene.add(this.polvoParticles);
  }

  private construirPlanoRecuerdos(): void {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.texturaRecuerdoActual = new THREE.CanvasTexture(this.canvasRecuerdos);
    this.texturaRecuerdoActual.colorSpace = THREE.SRGBColorSpace;

    this.materialRecuerdos = new THREE.MeshBasicMaterial({
      map: this.texturaRecuerdoActual,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });

    this.planoRecuerdos = new THREE.Mesh(geo, this.materialRecuerdos);
    this.planoRecuerdos.position.set(0, 0, -0.5);
    this.camera.add(this.planoRecuerdos);
    this.scene.add(this.camera);
  }

  private bucleRender = (tiempoActualMs: number): void => {
    const segundos = (tiempoActualMs - this.tiempoInicio) / 1000;
    this.tiempoActual = Math.min(segundos, this.DURACION_TOTAL);

    this.actualizarEstadoCinematico(this.tiempoActual);
    this.renderer.render(this.scene, this.camera);

    if (this.tiempoActual < this.DURACION_TOTAL) {
      this.animacionId = requestAnimationFrame(this.bucleRender);
    } else {
      this.ngZone.run(() => {
        this.finalizarIntro();
      });
    }
  };

  /**
   * 🎛️ Orquestador de las fases cinemáticas (11.2s pausados y cinematográficos):
   * 1. Caída majestuosa y visible con impacto y rebote amortiguado (0.0s - 1.40s)
   * 2. Travelling cinematográfico (ZOOM) suave hacia el título y foto de portada (1.40s - 2.80s)
   * 3. Pausa de lectura tranquila y contemplación del título y portada en primer plano (2.80s - 5.40s)
   * 4. Apertura suave, pausada y majestuosa de la tapa 3D con luz interior (5.40s - 7.20s)
   * 5. Vuelo sereno y sosegado de los recuerdos fotográficos (7.20s - 10.20s)
   * 6. Encuadre final del libro abierto y transición al álbum interactivo (10.20s - 11.20s)
   */
  public actualizarEstadoCinematico(t: number): void {
    const ANGULO_MAX_APERTURA = Math.PI * 0.82; // ~148 grados

    // -------------------------------------------------------------
    // FASE 1: CAÍDA MAJESTUOSA Y VISIBLE (0.0s - 1.40s)
    // El libro desciende con inercia perceptible y rebota suavemente sobre la mesa
    // -------------------------------------------------------------
    if (t <= 1.40) {
      const tImpacto = 1.10;

      if (t < tImpacto) {
        const p = t / tImpacto;
        // Caída con aceleración realista cuadrática y sutil cabeceo aerodinámico
        const progresoCaida = Math.pow(p, 2.3);
        const wobble = Math.sin(p * Math.PI) * 0.04;
        this.libroGroup.position.y = 4.8 * (1 - progresoCaida);
        this.libroGroup.rotation.x = -0.32 * (1 - progresoCaida) - 0.15 + wobble;
        this.libroGroup.rotation.y = 0.08 * (1 - progresoCaida);
        this.libroGroup.rotation.z = 0.10 * (1 - progresoCaida) - wobble * 0.5;
        this.polvoParticles.visible = false;
        this.tapaPivotGroup.rotation.z = 0;
      } else {
        if (!this.sonidoImpactoEmitido) {
          this.emitirSonidoImpacto();
          this.sonidoImpactoEmitido = true;
        }

        const deltaImpacto = t - tImpacto;
        // Doble armónico amortiguado que simula la masa pesada y cuerpo elástico del tomo
        const env = Math.exp(-deltaImpacto * 14);
        const rebote = Math.sin(deltaImpacto * 34) * 0.18 * env;
        const microTiltX = Math.sin(deltaImpacto * 28) * 0.035 * env;
        const microTiltZ = Math.cos(deltaImpacto * 32) * 0.025 * env;

        this.libroGroup.position.y = Math.max(0, rebote);
        this.libroGroup.rotation.set(-0.15 + microTiltX, 0, microTiltZ);
        this.tapaPivotGroup.rotation.z = 0;

        this.actualizarParticulasPolvo(deltaImpacto);
      }

      this.camera.position.set(0, 3.4, 3.4);
      this.camera.lookAt(0, 0.35, 0.25);
      this.materialRecuerdos.opacity = 0;
      this.luzInteriorLibro.intensity = 0;
    }

    // -------------------------------------------------------------
    // FASE 2: TRAVELLING CINEMATOGRÁFICO (ZOOM) HACIA EL TÍTULO Y PORTADA (1.40s - 2.80s)
    // La cámara se acerca suavemente para destacar el título en oro y el relicario
    // -------------------------------------------------------------
    else if (t > 1.40 && t <= 2.80) {
      this.polvoParticles.visible = false;
      this.libroGroup.position.set(0, 0, 0);
      this.libroGroup.rotation.set(-0.15, 0, 0);
      this.tapaPivotGroup.rotation.z = 0;
      this.materialRecuerdos.opacity = 0;
      this.luzInteriorLibro.intensity = 0;

      const pZoom = (t - 1.40) / 1.40;
      const easeZoom = (1 - Math.cos(pZoom * Math.PI)) / 2;

      // Travelling suave desde plano general hacia primer plano de la portada
      this.camera.position.x = 0;
      this.camera.position.y = THREE.MathUtils.lerp(3.4, 2.15, easeZoom);
      this.camera.position.z = THREE.MathUtils.lerp(3.4, 2.05, easeZoom);

      const targetY = THREE.MathUtils.lerp(0.35, 0.30, easeZoom);
      const targetZ = THREE.MathUtils.lerp(0.25, 0.10, easeZoom);
      this.camera.lookAt(0, targetY, targetZ);
    }

    // -------------------------------------------------------------
    // FASE 3: PAUSA DE LECTURA TRANQUILA Y CONTEMPLACIÓN (2.80s - 5.40s)
    // 2.6 segundos para leer el título, subtítulo, fecha y ver la foto sin prisas
    // -------------------------------------------------------------
    else if (t > 2.80 && t <= 5.40) {
      this.polvoParticles.visible = false;
      this.libroGroup.position.set(0, 0, 0);
      this.libroGroup.rotation.set(-0.15, 0, 0);
      this.tapaPivotGroup.rotation.z = 0;
      this.materialRecuerdos.opacity = 0;
      this.luzInteriorLibro.intensity = 0;

      // Sutilísimo micro-dolly flotante que mantiene viva la escena 3D
      const pHold = (t - 2.80) / 2.60;
      this.camera.position.set(0, 2.15 - pHold * 0.04, 2.05 - pHold * 0.04);
      this.camera.lookAt(0, 0.30, 0.10);
    }

    // -------------------------------------------------------------
    // FASE 4: APERTURA SUAVE Y MAJESTUOSA DEL LIBRO 3D (5.40s - 7.20s)
    // La tapa se abre despacio (1.8s) y la cámara retrocede para encuadrar las dos páginas
    // -------------------------------------------------------------
    else if (t > 5.40 && t <= 7.20) {
      if (!this.sonidoAperturaEmitido) {
        this.emitirSonidoApertura();
        this.sonidoAperturaEmitido = true;
      }

      const pApertura = (t - 5.40) / 1.80; // 0 a 1 suave en 1.80s
      const easeApertura = (1 - Math.cos(pApertura * Math.PI)) / 2;

      this.tapaPivotGroup.rotation.z = easeApertura * ANGULO_MAX_APERTURA;
      this.luzInteriorLibro.intensity = easeApertura * 2.5;

      // La cámara retrocede suavemente para encuadrar la doble página abierta
      this.camera.position.x = 0;
      this.camera.position.y = THREE.MathUtils.lerp(2.11, 3.10, easeApertura);
      this.camera.position.z = THREE.MathUtils.lerp(2.01, 3.10, easeApertura);
      this.camera.lookAt(0, 0.35, THREE.MathUtils.lerp(0.10, 0.25, easeApertura));

      this.materialRecuerdos.opacity = 0;
    }

    // -------------------------------------------------------------
    // FASE 5: VUELO Y RETORNO SERENO DE RECUERDOS (7.20s - 10.20s)
    // Las fotos emergen con calma desde la página derecha hacia el usuario
    // -------------------------------------------------------------
    else if (t > 7.20 && t <= 10.20) {
      this.tapaPivotGroup.rotation.z = ANGULO_MAX_APERTURA;
      this.luzInteriorLibro.intensity = 2.5;

      this.actualizarVueloFotosDesdeLibro(t);
      this.texturaRecuerdoActual!.needsUpdate = true;
      this.materialRecuerdos.opacity = 1.0;

      this.camera.position.set(0, 3.1, 3.1);
      this.camera.lookAt(0, 0.35, 0.25);
    }

    // -------------------------------------------------------------
    // FASE 6: EL LIBRO SE QUEDA ABIERTO Y TRANSICIÓN FLUIDA AL DOM (10.20s - 11.20s)
    // El libro permanece abierto mostrando sus dos páginas interiores
    // -------------------------------------------------------------
    else if (t > 10.20) {
      this.ctxRecuerdos.clearRect(0, 0, 1280, 720);
      this.texturaRecuerdoActual!.needsUpdate = true;
      this.materialRecuerdos.opacity = 0;

      // La tapa permanece totalmente abierta mostrando el pergamino
      this.tapaPivotGroup.rotation.z = ANGULO_MAX_APERTURA;
      this.luzInteriorLibro.intensity = 2.0;

      const pTrans = Math.min(1.0, (t - 10.20) / 1.00);
      const easeTrans = (1 - Math.cos(pTrans * Math.PI)) / 2;

      this.camera.position.x = 0;
      this.camera.position.y = THREE.MathUtils.lerp(3.1, 2.9, easeTrans);
      this.camera.position.z = THREE.MathUtils.lerp(3.1, 2.8, easeTrans);
      this.camera.lookAt(0, 0.35, 0.2);

      this.libroGroup.rotation.set(-0.15, 0, 0);
    }

    // 🌑 Sombra de contacto suave y dinámica que ancla físicamente el libro a la mesa
    if (this.sombraContactoMesh) {
      const h = Math.max(0, this.libroGroup.position.y);
      const matS = this.sombraContactoMesh.material as THREE.MeshBasicMaterial;
      matS.opacity = Math.max(0, Math.min(0.88, (1 - h / 3.2) * 0.88));
      const esc = 1 + h * 0.18;
      this.sombraContactoMesh.scale.set(esc, esc, 1);
      this.sombraContactoMesh.position.x = this.libroGroup.position.x;
      this.sombraContactoMesh.position.z = this.libroGroup.position.z;
    }

    // ✨ Partículas ambientales de polvo suspendido en el haz del foco
    this.actualizarPolvoAmbiental();
  }

  /**
   * 🚀 FASE 5: Genera y anima las fotos emergiendo de la página derecha del libro
   * a un ritmo sereno y pausado, creciendo suavemente hacia la cámara
   */
  private actualizarVueloFotosDesdeLibro(t: number): void {
    const ctx = this.ctxRecuerdos;
    const CW = 1280;
    const CH = 720;

    ctx.clearRect(0, 0, CW, CH);

    // Spawn de fotos desde t=7.25s hasta t=9.30s (ritmo fluido, pausado y armonioso)
    const INTERVALO_SPAWN = 0.28;
    if (t >= 7.25 && t <= 9.30 && t - this.ultimoTiempoSpawn >= INTERVALO_SPAWN) {
      this.ultimoTiempoSpawn = t;

      const framesDisponibles = this.framesPrecargados.length > 0
        ? this.framesPrecargados
        : this.preloaderService.obtenerTodosLosFrames();

      let frame: MemoryFrame | null = null;
      if (framesDisponibles.length > 0) {
        frame = framesDisponibles[this.indiceSiguienteFoto % framesDisponibles.length];
      } else if (this.fotoPortadaBitmap) {
        frame = {
          bitmap: this.fotoPortadaBitmap,
          titulo: this.tituloViaje || 'Recuerdo',
          esVideo: false
        };
      }

      if (frame) {
        this.indiceSiguienteFoto++;

        const formatos: ('polaroid' | 'cuadrado' | 'postal' | 'vertical' | 'panoramica')[] = [
          'polaroid',
          'cuadrado',
          'postal',
          'vertical',
          'panoramica',
          'polaroid',
          'cuadrado'
        ];
        const formato = formatos[this.indiceSiguienteFoto % formatos.length];

        const anguloAbanico = ((this.indiceSiguienteFoto * 137.5) % 360) * (Math.PI / 180);
        const radioDrift = 280 + Math.random() * 220;
        const driftX = Math.cos(anguloAbanico) * radioDrift;
        const driftY = -140 - Math.random() * 220;

        let anchoBase = 320;
        let altoBase = 240;

        switch (formato) {
          case 'polaroid':
            anchoBase = 290;
            altoBase = 340;
            break;
          case 'cuadrado':
            anchoBase = 290;
            altoBase = 290;
            break;
          case 'postal':
            anchoBase = 340;
            altoBase = 240;
            break;
          case 'vertical':
            anchoBase = 250;
            altoBase = 340;
            break;
          case 'panoramica':
            anchoBase = 380;
            altoBase = 230;
            break;
        }

        // Cada foto viaja 1.85 segundos: sale hacia el usuario y regresa al libro con calma
        this.fotosEnVuelo.push({
          frame,
          tiempoInicio: t,
          duracion: 1.85,
          formato,
          driftX,
          driftY,
          giroMax: ((Math.random() - 0.5) * 16) * (Math.PI / 180),
          anchoBase,
          altoBase
        });
      }
    }

    this.fotosEnVuelo = this.fotosEnVuelo.filter(f => (t - f.tiempoInicio) < f.duracion);

    // Origen y retorno: página derecha del libro abierto
    const origenX = CW * 0.58;
    const origenY = CH * 0.62;

    for (const foto of this.fotosEnVuelo) {
      const p = (t - foto.tiempoInicio) / foto.duracion;

      // Curva armónica de ida y vuelta: u=0 al inicio, u=1 en el cenit hacia el usuario (p=0.5), u=0 al regresar (p=1.0)
      const u = Math.sin(p * Math.PI);

      // Crecimiento y contracción: escala 0.14 en el libro -> hasta 2.05 frente al usuario -> 0.14 de vuelta al libro
      const escala = 0.14 + Math.pow(u, 1.25) * 1.90;

      // Trayectoria curvada elegante de ida y regreso
      const curvatura = Math.sin(p * Math.PI * 2) * 40;
      const posX = origenX + foto.driftX * Math.pow(u, 1.1) + curvatura;
      const posY = origenY + foto.driftY * Math.pow(u, 1.1) - Math.abs(curvatura) * 0.4;
      const rot = foto.giroMax * Math.sin(p * Math.PI);

      // Transparencia suave al emerger y al aterrizar en el libro
      let alpha = 1.0;
      if (p < 0.08) {
        alpha = p / 0.08;
      } else if (p > 0.90) {
        alpha = Math.max(0, (1.0 - p) / 0.10);
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(posX, posY);
      ctx.rotate(rot);
      ctx.scale(escala, escala);

      ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
      ctx.shadowBlur = 8 + u * 24;
      ctx.shadowOffsetX = 3 + u * 8;
      ctx.shadowOffsetY = 5 + u * 14;

      this.dibujarTarjetaFoto(ctx, foto);

      ctx.restore();
    }
  }

    private dibujarTarjetaFoto(ctx: CanvasRenderingContext2D, foto: FotoVuelo): void {
    const { frame, formato, anchoBase: w, altoBase: h } = foto;
    const rx = -w / 2;
    const ry = -h / 2;

    switch (formato) {
      case 'polaroid': {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(rx, ry, w, h);

        ctx.shadowColor = 'transparent';

        const pad = 10;
        const fotoW = w - pad * 2;
        const fotoH = h - pad - 45;
        this.dibujarImagenCover(ctx, frame.bitmap, rx + pad, ry + pad, fotoW, fotoH);

        ctx.fillStyle = '#2d2015';
        ctx.font = 'bold 15px "Cinzel", "Georgia", serif';
        ctx.textAlign = 'center';
        const txt = frame.titulo ? frame.titulo.substring(0, 24) : 'Recuerdo';
        ctx.fillText(txt, 0, ry + h - 16);
        break;
      }

      case 'cuadrado': {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(rx, ry, w, h);

        ctx.shadowColor = 'transparent';

        const pad = 8;
        this.dibujarImagenCover(ctx, frame.bitmap, rx + pad, ry + pad, w - pad * 2, h - pad * 2);

        ctx.strokeStyle = 'rgba(212, 175, 55, 0.65)';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx + pad, ry + pad, w - pad * 2, h - pad * 2);
        break;
      }

      case 'postal': {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(rx, ry, w, h);

        ctx.shadowColor = 'transparent';

        const pad = 8;
        this.dibujarImagenCover(ctx, frame.bitmap, rx + pad, ry + pad, w - pad * 2, h - pad * 2);

        ctx.strokeStyle = 'rgba(160, 120, 70, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rx + 4, ry + 4, w - 8, h - 8);
        break;
      }

      case 'vertical': {
        ctx.fillStyle = '#16100c';
        ctx.fillRect(rx, ry, w, h);

        ctx.shadowColor = 'transparent';

        ctx.strokeStyle = '#dfc488';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx + 4, ry + 4, w - 8, h - 8);

        const pad = 8;
        this.dibujarImagenCover(ctx, frame.bitmap, rx + pad, ry + pad, w - pad * 2, h - pad * 2);
        break;
      }

      case 'panoramica':
      default: {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(rx, ry, w, h);

        ctx.shadowColor = 'transparent';

        const pad = 8;
        this.dibujarImagenCover(ctx, frame.bitmap, rx + pad, ry + pad, w - pad * 2, h - pad * 2);

        ctx.strokeStyle = '#c59d42';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx + pad, ry + pad, w - pad * 2, h - pad * 2);
        break;
      }
    }

    // Brillo sutil de papel fotográfico satinado de alta gama
    const gradGloss = ctx.createLinearGradient(rx, ry, rx + w, ry + h);
    gradGloss.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    gradGloss.addColorStop(0.35, 'rgba(255, 255, 255, 0.0)');
    gradGloss.addColorStop(0.70, 'rgba(255, 255, 255, 0.0)');
    gradGloss.addColorStop(1, 'rgba(255, 255, 255, 0.10)');
    ctx.fillStyle = gradGloss;
    ctx.fillRect(rx, ry, w, h);
  }

  private actualizarParticulasPolvo(delta: number): void {
    this.polvoParticles.visible = true;
    const geo = this.polvoParticles.geometry as THREE.BufferGeometry;
    const pos = geo.attributes['position'].array as Float32Array;
    const mat = this.polvoParticles.material as THREE.PointsMaterial;

    const opacidad = Math.max(0, 0.85 * (1 - delta / 0.8));
    mat.opacity = opacidad;

    for (let i = 0; i < this.polvoVelocidades.length; i++) {
      const vel = this.polvoVelocidades[i];
      pos[i * 3] += vel.x * 0.016;
      pos[i * 3 + 1] += vel.y * 0.016;
      pos[i * 3 + 2] += vel.z * 0.016;

      vel.y -= 0.08;
      vel.x *= 0.96;
      vel.z *= 0.96;
    }
    geo.attributes['position'].needsUpdate = true;
  }

  private emitirSonidoImpacto(): void {
    if (!this.sonidoActivado) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      if (!this.audioContext) this.audioContext = new AudioContextClass();
      if (this.audioContext.state === 'suspended') this.audioContext.resume();

      const t0 = this.audioContext.currentTime;

      // 1. Golpe profundo de baja frecuencia (resonancia de mesa de madera maciza)
      const oscLow = this.audioContext.createOscillator();
      const gainLow = this.audioContext.createGain();
      oscLow.type = 'triangle';
      oscLow.frequency.setValueAtTime(120, t0);
      oscLow.frequency.exponentialRampToValueAtTime(28, t0 + 0.32);
      gainLow.gain.setValueAtTime(0.85, t0);
      gainLow.gain.exponentialRampToValueAtTime(0.001, t0 + 0.38);
      oscLow.connect(gainLow);
      gainLow.connect(this.audioContext.destination);
      oscLow.start(t0);
      oscLow.stop(t0 + 0.40);

      // 2. Chasquido nítido de impacto de cuero tenso
      const oscMid = this.audioContext.createOscillator();
      const gainMid = this.audioContext.createGain();
      oscMid.type = 'sine';
      oscMid.frequency.setValueAtTime(260, t0);
      oscMid.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
      gainMid.gain.setValueAtTime(0.40, t0);
      gainMid.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
      oscMid.connect(gainMid);
      gainMid.connect(this.audioContext.destination);
      oscMid.start(t0);
      oscMid.stop(t0 + 0.18);
    } catch {}
  }

  private emitirSonidoApertura(): void {
    if (!this.sonidoActivado || !this.audioContext) return;
    try {
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(60, this.audioContext.currentTime);
      osc.frequency.linearRampToValueAtTime(220, this.audioContext.currentTime + 0.4);

      gain.gain.setValueAtTime(0.01, this.audioContext.currentTime);
      gain.gain.linearRampToValueAtTime(0.22, this.audioContext.currentTime + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.45);

      osc.connect(gain);
      gain.connect(this.audioContext.destination);

      osc.start();
      osc.stop(this.audioContext.currentTime + 0.46);
    } catch {}
  }

  private emitirSonidoCierre(): void {
    if (!this.sonidoActivado || !this.audioContext) return;
    try {
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(110, this.audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(28, this.audioContext.currentTime + 0.2);

      gain.gain.setValueAtTime(0.5, this.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(this.audioContext.destination);

      osc.start();
      osc.stop(this.audioContext.currentTime + 0.26);
    } catch {}
  }

  saltarIntro(): void {
    this.finalizarIntro();
  }

  private finalizarIntro(): void {
    this.detenerAnimacion();
    this.activo = false;
    this.completado.emit();
  }

  private detenerAnimacion(): void {
    if (this.animacionId !== null) {
      cancelAnimationFrame(this.animacionId);
      this.animacionId = null;
    }
  }

  private liberarRecursosThree(): void {
    if (this.renderer) {
      this.renderer.dispose();
    }
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {}
    }
  }

  public renderizarFrameDeterminista(t: number, targetCanvas?: HTMLCanvasElement): void {
    this.actualizarEstadoCinematico(t);
    this.renderer.render(this.scene, this.camera);

    if (targetCanvas) {
      const ctxTarget = targetCanvas.getContext('2d');
      if (ctxTarget) {
        ctxTarget.drawImage(this.canvasRef.nativeElement, 0, 0, targetCanvas.width, targetCanvas.height);
      }
    }
  }
}
