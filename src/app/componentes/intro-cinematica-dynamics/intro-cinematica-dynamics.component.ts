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

  // Duración pausada y cinematográfica: 7.5 segundos
  public readonly DURACION_TOTAL: number = 6.8;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;

  // Mallas 3D
  private mesaMesh!: THREE.Mesh;
  private libroGroup!: THREE.Group;
  private tapaPivotGroup!: THREE.Group;
  private tapaMesh!: THREE.Mesh;
  private polvoParticles!: THREE.Points;
  private polvoVelocidades: THREE.Vector3[] = [];
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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Iluminación cálida
    const luzAmbiente = new THREE.AmbientLight(0xffeedd, 0.95);
    this.scene.add(luzAmbiente);

    const luzDireccional = new THREE.DirectionalLight(0xffdfa0, 2.8);
    luzDireccional.position.set(3, 7, 3.5);
    luzDireccional.castShadow = true;
    luzDireccional.shadow.mapSize.width = 2048;
    luzDireccional.shadow.mapSize.height = 2048;
    luzDireccional.shadow.bias = -0.0005;
    this.scene.add(luzDireccional);

    const luzCalidaContraluz = new THREE.PointLight(0xff9944, 1.5, 12);
    luzCalidaContraluz.position.set(-3, 3, -2);
    this.scene.add(luzCalidaContraluz);

    const luzRellenoFrontal = new THREE.PointLight(0xfff0d8, 1.2, 8);
    luzRellenoFrontal.position.set(0, 2.5, 3.8);
    this.scene.add(luzRellenoFrontal);

    // Luz interior dorada que brota del libro al abrirse
    this.luzInteriorLibro = new THREE.PointLight(0xffd570, 0, 6);
    this.luzInteriorLibro.position.set(0.6, 0.6, 0);
    this.scene.add(this.luzInteriorLibro);

    this.construirMesaMadera();
    this.construirLibroVintage();
    this.construirPolvoVolumetrico();
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
      roughness: 0.65,
      metalness: 0.12
    });

    const geoMadera = new THREE.PlaneGeometry(18, 18);
    this.mesaMesh = new THREE.Mesh(geoMadera, matMadera);
    this.mesaMesh.rotation.x = -Math.PI / 2;
    this.mesaMesh.position.y = 0;
    this.mesaMesh.receiveShadow = true;
    this.scene.add(this.mesaMesh);
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

    this.repintarCubiertaLibro();

    const anchoLibro = 2.4;
    const altoLibro = 0.35;
    const profLibro = 3.2;

    // 1. Material exterior de la cubierta (cara superior +Y)
    const matCueroFrontal = new THREE.MeshStandardMaterial({
      map: this.texturaCuero,
      roughness: 0.45,
      metalness: 0.25
    });

    // 2. Material interior de la tapa (cara -Y): CUERO MARRÓN LIMPIO Y ELEGANTE (sin textos al revés)
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

    // Hojas doradas del libro
    const geoHojas = new THREE.BoxGeometry(anchoLibro * 0.96, altoLibro * 0.85, profLibro * 0.96);
    const matHojas = new THREE.MeshStandardMaterial({
      color: 0xdfbe65,
      roughness: 0.72,
      metalness: 0.35
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
   * 🎛️ Orquestador de las 5 fases cinemáticas (7.5s pausados y cinematográficos):
   * 1. Caída e impacto (0.0s - 0.8s)
   * 2. PAUSA DE LECTURA TRANQUILA DE LA PORTADA (0.8s - 2.2s)
   * 3. APERTURA SUAVE 3D DE LA TAPA (2.2s - 3.0s) -> izquierda marrón limpio
   * 4. VUELO SERENO DE FOTOS DESDE LA PÁGINA DERECHA (3.0s - 5.8s) -> sin prisas
   * 5. CIERRE 3D DE LA TAPA (5.8s - 6.6s)
   * 6. ENCUADRE FINAL DEL LIBRO CERRADO Y TRANSICIÓN AL DOM (6.6s - 7.5s)
   */
    public actualizarEstadoCinematico(t: number): void {
    const ANGULO_MAX_APERTURA = Math.PI * 0.82; // ~148 grados

    // -------------------------------------------------------------
    // FASE 1: IMPACTO (0.0s - 0.75s) - Libro cae y rebota sobre la mesa
    // -------------------------------------------------------------
    if (t <= 0.75) {
      const tImpacto = 0.58;

      if (t < tImpacto) {
        const p = t / tImpacto;
        const progresoCaida = p * p;
        this.libroGroup.position.y = 4.0 * (1 - progresoCaida);
        this.libroGroup.rotation.x = -0.2 * (1 - progresoCaida);
        this.libroGroup.rotation.z = 0.08 * (1 - progresoCaida);
        this.polvoParticles.visible = false;
        this.tapaPivotGroup.rotation.z = 0;
      } else {
        if (!this.sonidoImpactoEmitido) {
          this.emitirSonidoImpacto();
          this.sonidoImpactoEmitido = true;
        }

        const deltaImpacto = t - tImpacto;
        const amplitud = 0.26 * Math.exp(-deltaImpacto * 18);
        const rebote = Math.sin(deltaImpacto * 42) * amplitud;

        this.libroGroup.position.y = Math.max(0, rebote);
        this.libroGroup.rotation.set(-0.15, 0, 0);
        this.tapaPivotGroup.rotation.z = 0;

        this.actualizarParticulasPolvo(deltaImpacto);
      }

      this.camera.position.set(0, 3.2, 3.2);
      this.camera.lookAt(0, 0.35, 0.25);
      this.materialRecuerdos.opacity = 0;
      this.luzInteriorLibro.intensity = 0;
    }

    // -------------------------------------------------------------
    // FASE 2: PAUSA DE APRECIACIÓN EN LA MESA (0.75s - 1.30s)
    // -------------------------------------------------------------
    else if (t > 0.75 && t <= 1.30) {
      this.polvoParticles.visible = false;
      this.libroGroup.position.y = 0;
      this.libroGroup.rotation.set(-0.15, 0, 0);
      this.tapaPivotGroup.rotation.z = 0;

      this.camera.position.set(0, 3.2, 3.2);
      this.camera.lookAt(0, 0.35, 0.25);
      this.materialRecuerdos.opacity = 0;
      this.luzInteriorLibro.intensity = 0;
    }

    // -------------------------------------------------------------
    // FASE 3: APERTURA SUAVE 3D DE LA TAPA (1.30s - 2.10s)
    // -------------------------------------------------------------
    else if (t > 1.30 && t <= 2.10) {
      if (!this.sonidoAperturaEmitido) {
        this.emitirSonidoApertura();
        this.sonidoAperturaEmitido = true;
      }

      const pApertura = (t - 1.30) / 0.80; // 0 a 1 suave
      const ease = (1 - Math.cos(pApertura * Math.PI)) / 2;

      this.tapaPivotGroup.rotation.z = ease * ANGULO_MAX_APERTURA;
      this.luzInteriorLibro.intensity = ease * 2.5;

      this.camera.position.set(0, 3.2, 3.2);
      this.camera.lookAt(0, 0.35, 0.25);
      this.materialRecuerdos.opacity = 0;
    }

    // -------------------------------------------------------------
    // FASE 4: VUELO Y RETORNO DE FOTOS (2.10s - 5.70s)
    // Las fotos salen hacia el usuario y regresan al libro abierto
    // -------------------------------------------------------------
    else if (t > 2.10 && t <= 5.70) {
      this.tapaPivotGroup.rotation.z = ANGULO_MAX_APERTURA;
      this.luzInteriorLibro.intensity = 2.5;

      this.actualizarVueloFotosDesdeLibro(t);
      this.texturaRecuerdoActual!.needsUpdate = true;
      this.materialRecuerdos.opacity = 1.0;

      this.camera.position.set(0, 3.1, 3.1);
      this.camera.lookAt(0, 0.35, 0.25);
    }

    // -------------------------------------------------------------
    // FASE 5: EL LIBRO SE QUEDA ABIERTO Y TRANSICIÓN FLUIDA AL DOM (5.70s - 6.80s)
    // El libro permanece abierto mostrando sus dos páginas interiores
    // -------------------------------------------------------------
    else if (t > 5.70) {
      this.ctxRecuerdos.clearRect(0, 0, 1280, 720);
      this.texturaRecuerdoActual!.needsUpdate = true;
      this.materialRecuerdos.opacity = 0;

      // ¡LA TAPA PERMANECE TOTALMENTE ABIERTA!
      this.tapaPivotGroup.rotation.z = ANGULO_MAX_APERTURA;
      this.luzInteriorLibro.intensity = 2.0;

      const pTrans = Math.min(1.0, (t - 5.70) / 1.10);
      const easeTrans = (1 - Math.cos(pTrans * Math.PI)) / 2;

      this.camera.position.x = 0;
      this.camera.position.y = THREE.MathUtils.lerp(3.1, 2.9, easeTrans);
      this.camera.position.z = THREE.MathUtils.lerp(3.1, 2.8, easeTrans);
      this.camera.lookAt(0, 0.35, 0.2);

      this.libroGroup.rotation.set(-0.15, 0, 0);
    }
  }

  /**
   * 🚀 FASE 4: Genera y anima las fotos emergiendo de la página derecha del libro
   * a un ritmo sereno y pausado (no enloquecido), creciendo suavemente hacia la cámara
   */
    private actualizarVueloFotosDesdeLibro(t: number): void {
    const ctx = this.ctxRecuerdos;
    const CW = 1280;
    const CH = 720;

    ctx.clearRect(0, 0, CW, CH);

    // Spawn de fotos desde t=2.15s hasta t=4.00s (ritmo fluido y armonioso)
    const INTERVALO_SPAWN = 0.17;
    if (t >= 2.15 && t <= 4.00 && t - this.ultimoTiempoSpawn >= INTERVALO_SPAWN) {
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

        // Cada foto viaja 1.65 segundos: sale hacia el usuario y regresa al libro
        this.fotosEnVuelo.push({
          frame,
          tiempoInicio: t,
          duracion: 1.65,
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

      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, this.audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(32, this.audioContext.currentTime + 0.25);

      gain.gain.setValueAtTime(0.7, this.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(this.audioContext.destination);

      osc.start();
      osc.stop(this.audioContext.currentTime + 0.36);
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
