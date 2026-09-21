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
  @Input() permitirSaltar: boolean = true;
  @Input() archivosViaje: any[] = [];
  @Input() sonidoActivado: boolean = true;

  @Output() completado = new EventEmitter<void>();

  activo: boolean = true;
  tiempoActual: number = 0; // 0.0s a 5.00s exactos

  private readonly DURACION_TOTAL: number = 5.0; // 5 segundos
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;

  // Mallas 3D
  private mesaMesh!: THREE.Mesh;
  private libroGroup!: THREE.Group;
  private tapaMesh!: THREE.Mesh;
  private polvoParticles!: THREE.Points;
  private polvoVelocidades: THREE.Vector3[] = [];
  private planoRecuerdos!: THREE.Mesh;
  private materialRecuerdos!: THREE.MeshBasicMaterial;
  private texturaRecuerdoActual: THREE.CanvasTexture | null = null;
  private canvasRecuerdos!: HTMLCanvasElement;
  private ctxRecuerdos!: CanvasRenderingContext2D;

  // Control de animación
  private animacionId: number | null = null;
  private tiempoInicio: number = 0;
  private framesPrecargados: MemoryFrame[] = [];
  private audioContext: AudioContext | null = null;
  private sonidoImpactoEmitido: boolean = false;
  private sonidoRiserEmitido: boolean = false;

  constructor(
    private ngZone: NgZone,
    private preloaderService: IntroMemoryPreloaderService
  ) {}

  async ngOnInit(): Promise<void> {
    // Iniciar precarga de memoria en segundo plano
    if (this.archivosViaje && this.archivosViaje.length > 0) {
      this.framesPrecargados = await this.preloaderService.prepararRafagaRecuerdos(this.archivosViaje, 30);
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
   * 🎬 Configura la escena Three.js, luces, texturas y partículas
   */
  private iniciarEscena3D(): void {
    const canvas = this.canvasRef.nativeElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;

    // Canvas auxiliar 2D para renderizar la ráfaga estroboscópica sobre textura Three.js
    this.canvasRecuerdos = document.createElement('canvas');
    this.canvasRecuerdos.width = 1280;
    this.canvasRecuerdos.height = 720;
    this.ctxRecuerdos = this.canvasRecuerdos.getContext('2d')!;

    // Escena y Cámara
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0705);
    this.scene.fog = new THREE.FogExp2(0x0a0705, 0.08);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(0, 4.2, 5.8);
    this.camera.lookAt(0, 0, 0);

    // Renderer optimizado con sombreado suave
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

    // Luces
    const luzAmbiente = new THREE.AmbientLight(0xffeedd, 0.7);
    this.scene.add(luzAmbiente);

    const luzDireccional = new THREE.DirectionalLight(0xffdfa0, 2.2);
    luzDireccional.position.set(4, 8, 4);
    luzDireccional.castShadow = true;
    luzDireccional.shadow.mapSize.width = 1024;
    luzDireccional.shadow.mapSize.height = 1024;
    luzDireccional.shadow.bias = -0.0005;
    this.scene.add(luzDireccional);

    const luzCalidaContraluz = new THREE.PointLight(0xff9944, 1.2, 10);
    luzCalidaContraluz.position.set(-3, 3, -2);
    this.scene.add(luzCalidaContraluz);

    // Construcción de la mesa y el libro
    this.construirMesaMadera();
    this.construirLibroVintage();
    this.construirPolvoVolumetrico();
    this.construirPlanoRecuerdos();

    // Iniciar bucle cinemático fuera de Angular Zone para evitar disparar Change Detection a 60 FPS
    this.ngZone.runOutsideAngular(() => {
      this.tiempoInicio = performance.now();
      this.bucleRender(this.tiempoInicio);
    });
  }

  /**
   * 🪵 Crea la mesa de madera con textura procedural y vetas envejecidas
   */
  private construirMesaMadera(): void {
    const canvasMadera = document.createElement('canvas');
    canvasMadera.width = 1024;
    canvasMadera.height = 1024;
    const ctx = canvasMadera.getContext('2d')!;

    // Vetas de madera de nogal envejecido
    ctx.fillStyle = '#22140c';
    ctx.fillRect(0, 0, 1024, 1024);

    for (let i = 0; i < 600; i++) {
      ctx.strokeStyle = `rgba(50, 30, 18, ${Math.random() * 0.4})`;
      ctx.lineWidth = 1 + Math.random() * 4;
      ctx.beginPath();
      const x = Math.random() * 1024;
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 20, 350, x - 20, 700, x + 10, 1024);
      ctx.stroke();
    }

    const texturaMadera = new THREE.CanvasTexture(canvasMadera);
    texturaMadera.wrapS = THREE.RepeatWrapping;
    texturaMadera.wrapT = THREE.RepeatWrapping;
    texturaMadera.repeat.set(2, 2);

    const matMadera = new THREE.MeshStandardMaterial({
      map: texturaMadera,
      roughness: 0.75,
      metalness: 0.1
    });

    const geoMadera = new THREE.PlaneGeometry(16, 16);
    this.mesaMesh = new THREE.Mesh(geoMadera, matMadera);
    this.mesaMesh.rotation.x = -Math.PI / 2;
    this.mesaMesh.position.y = 0;
    this.mesaMesh.receiveShadow = true;
    this.scene.add(this.mesaMesh);
  }

  /**
   * 📖 Construye la malla del libro vintage con encuadernación de cuero y letras grabadas
   */
  private construirLibroVintage(): void {
    this.libroGroup = new THREE.Group();

    // 1. Textura de cuero envejecido con relieve "CRUCERO" y filigrana dorada
    const canvasCuero = document.createElement('canvas');
    canvasCuero.width = 1024;
    canvasCuero.height = 1024;
    const ctx = canvasCuero.getContext('2d')!;

    // Fondo cuero envejecido oscuro
    ctx.fillStyle = '#2e1910';
    ctx.fillRect(0, 0, 1024, 1024);

    // Relieve y textura orgánica de poro
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `rgba(20, 10, 6, ${Math.random() * 0.15})`;
      ctx.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
    }

    // Marco exterior con filigrana dorada
    ctx.strokeStyle = '#c59d42';
    ctx.lineWidth = 14;
    ctx.strokeRect(60, 60, 904, 904);

    ctx.strokeStyle = 'rgba(230, 195, 95, 0.6)';
    ctx.lineWidth = 4;
    ctx.strokeRect(90, 90, 844, 844);

    // Título en bajo relieve dorado
    const titulo = (this.tituloViaje || 'CRUCERO').toUpperCase();
    ctx.font = 'bold 88px "Cinzel", "Georgia", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Sombra del grabado en cuero
    ctx.fillStyle = '#120804';
    ctx.fillText(titulo, 512 + 4, 380 + 4);

    // Letras doradas con reflejo de pan de oro
    ctx.fillStyle = '#e8c46c';
    ctx.fillText(titulo, 512, 380);

    // Subtítulo e insignia
    ctx.font = '32px "Cinzel", serif';
    ctx.fillStyle = '#be9946';
    ctx.fillText('DIARIO DE VIAJES Y MEMORIAS', 512, 480);
    ctx.fillText('✦   ✦   ✦', 512, 530);

    const texturaCuero = new THREE.CanvasTexture(canvasCuero);

    // Malla de la tapa superior
    const matCuero = new THREE.MeshStandardMaterial({
      map: texturaCuero,
      roughness: 0.55,
      metalness: 0.25
    });

    const anchoLibro = 2.4;
    const altoLibro = 0.35;
    const profLibro = 3.2;

    // Cuerpo / Hojas doradas del libro
    const geoHojas = new THREE.BoxGeometry(anchoLibro * 0.96, altoLibro * 0.85, profLibro * 0.96);
    const matHojas = new THREE.MeshStandardMaterial({
      color: 0xd4b256,
      roughness: 0.8,
      metalness: 0.3
    });
    const hojasMesh = new THREE.Mesh(geoHojas, matHojas);
    hojasMesh.position.set(0.04, altoLibro * 0.45, 0);
    hojasMesh.castShadow = true;
    hojasMesh.receiveShadow = true;
    this.libroGroup.add(hojasMesh);

    // Tapa dura de cuero (cubierta exterior)
    const geoTapa = new THREE.BoxGeometry(anchoLibro, 0.08, profLibro);
    this.tapaMesh = new THREE.Mesh(geoTapa, matCuero);
    this.tapaMesh.position.set(0, altoLibro + 0.04, 0);
    this.tapaMesh.castShadow = true;
    this.libroGroup.add(this.tapaMesh);

    // Lomo curvado a la izquierda
    const geoLomo = new THREE.CylinderGeometry(altoLibro * 0.5, altoLibro * 0.5, profLibro, 16, 1, false, 0, Math.PI);
    const matLomo = new THREE.MeshStandardMaterial({
      color: 0x24140c,
      roughness: 0.6
    });
    const lomoMesh = new THREE.Mesh(geoLomo, matLomo);
    lomoMesh.rotation.z = Math.PI / 2;
    lomoMesh.rotation.y = Math.PI / 2;
    lomoMesh.position.set(-anchoLibro / 2, altoLibro * 0.5, 0);
    lomoMesh.castShadow = true;
    this.libroGroup.add(lomoMesh);

    // Posición inicial: suspendido en el aire antes de caer
    this.libroGroup.position.set(0, 4.0, 0);
    this.libroGroup.rotation.set(-0.15, -0.05, 0.08);
    this.scene.add(this.libroGroup);
  }

  /**
   * 💨 Partículas de polvo volumétrico que se disparan en el impacto del libro (segundo 1.25s)
   */
  private construirPolvoVolumetrico(): void {
    const totalParticulas = 220;
    const geoPolvo = new THREE.BufferGeometry();
    const posiciones = new Float32Array(totalParticulas * 3);
    const opacidades = new Float32Array(totalParticulas);

    this.polvoVelocidades = [];

    for (let i = 0; i < totalParticulas; i++) {
      // Posición concentrada en el perímetro del libro
      const angulo = Math.random() * Math.PI * 2;
      const radio = 0.8 + Math.random() * 1.6;

      posiciones[i * 3] = Math.cos(angulo) * radio;
      posiciones[i * 3 + 1] = 0.04;
      posiciones[i * 3 + 2] = Math.sin(angulo) * radio;

      // Velocidad radial tangencial al suelo con leve elevación
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

  /**
   * 🎞️ Plano 2D fijado a la cámara para la Ráfaga de Recuerdos (2.5s a 4.0s)
   */
  private construirPlanoRecuerdos(): void {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.texturaRecuerdoActual = new THREE.CanvasTexture(this.canvasRecuerdos);

    this.materialRecuerdos = new THREE.MeshBasicMaterial({
      map: this.texturaRecuerdoActual,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false
    });

    this.planoRecuerdos = new THREE.Mesh(geo, this.materialRecuerdos);
    this.planoRecuerdos.position.set(0, 0, -0.5); // Justo frente a la cámara
    this.camera.add(this.planoRecuerdos);
    this.scene.add(this.camera);
  }

  /**
   * ⏱️ Bucle de animación cinemático a 60 FPS
   */
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
   * 🎛️ Orquestador de las 4 fases cinemáticas
   */
  public actualizarEstadoCinematico(t: number): void {
    // -------------------------------------------------------------
    // FASE 1: IMPACTO Y POLVO (0.0s - 1.5s)
    // -------------------------------------------------------------
    if (t <= 1.5) {
      const tImpacto = 1.25; // Momento del golpe seco

      if (t < tImpacto) {
        // Caída con aceleración por gravedad
        const p = t / tImpacto;
        const progresoCaida = p * p; // Cuadrático
        this.libroGroup.position.y = 4.0 * (1 - progresoCaida);
        this.libroGroup.rotation.x = -0.15 * (1 - progresoCaida);
        this.libroGroup.rotation.z = 0.08 * (1 - progresoCaida);
        this.polvoParticles.visible = false;
      } else {
        // Impacto y micro-rebote elástico amortiguado (Spring bounce)
        if (!this.sonidoImpactoEmitido) {
          this.emitirSonidoImpacto();
          this.sonidoImpactoEmitido = true;
        }

        const deltaImpacto = t - tImpacto; // 0.0s a 0.25s
        const amplitud = 0.35 * Math.exp(-deltaImpacto * 16);
        const rebote = Math.sin(deltaImpacto * 40) * amplitud;

        this.libroGroup.position.y = Math.max(0, rebote);
        this.libroGroup.rotation.set(0, 0, 0);

        // Dispersión de partículas de polvo
        this.actualizarParticulasPolvo(deltaImpacto);
      }

      // Cámara en reposo observando el impacto
      this.camera.position.set(0, 3.8, 5.2);
      this.camera.lookAt(0, 0.4, 0);
      this.materialRecuerdos.opacity = 0;
    }

    // -------------------------------------------------------------
    // FASE 2: ZOOM DE IMPACTO (1.5s - 2.5s)
    // -------------------------------------------------------------
    else if (t > 1.5 && t <= 2.5) {
      this.polvoParticles.visible = false;

      if (!this.sonidoRiserEmitido) {
        this.emitirSonidoRiser();
        this.sonidoRiserEmitido = true;
      }

      // Dolly-in agresivo hacia las letras "CRUCERO"
      const pZoom = (t - 1.5) / 1.0; // 0 a 1
      const easeZoom = Math.pow(pZoom, 3.5); // Aceleración cúbica rápida

      // La cámara viaja desde la vista general hasta sumergirse en la portada
      this.camera.position.x = THREE.MathUtils.lerp(0, 0, easeZoom);
      this.camera.position.y = THREE.MathUtils.lerp(3.8, 0.52, easeZoom);
      this.camera.position.z = THREE.MathUtils.lerp(5.2, 0.4, easeZoom);
      this.camera.lookAt(0, 0.45, 0);

      // Oscurecimiento y viñeteado hacia negro total en t = 2.5s
      if (pZoom > 0.6) {
        const pNegro = (pZoom - 0.6) / 0.4;
        this.scene.background = new THREE.Color(0x0a0705).lerp(new THREE.Color(0x000000), pNegro);
      }
      this.materialRecuerdos.opacity = 0;
    }

    // -------------------------------------------------------------
    // FASE 3: RÁFAGA DE RECUERDOS (FLICKER ESTROBOSCÓPICO) (2.5s - 4.0s)
    // -------------------------------------------------------------
    else if (t > 2.5 && t <= 4.0) {
      const pRafaga = (t - 2.5) / 1.5; // 0 a 1

      // Modulación de frecuencia (strobe flicker de recuerdos)
      const frame = this.preloaderService.obtenerFrameEnTiempo(pRafaga);
      if (frame) {
        this.dibujarFrameRecuerdoEnCanvas(frame, pRafaga);
        this.texturaRecuerdoActual!.needsUpdate = true;
      }

      // Opacidad estroboscópica con efecto de obturador de proyector
      const flickerShutter = Math.sin(t * 70) > -0.25 ? 1.0 : 0.85;
      this.materialRecuerdos.opacity = flickerShutter;
    }

    // -------------------------------------------------------------
    // FASE 4: ACOPLAMIENTO ÓPTICO CON PORTADA REAL (4.0s - 5.0s)
    // -------------------------------------------------------------
    else if (t > 4.0) {
      const pRetroceso = (t - 4.0) / 1.0; // 0 a 1
      const easeOut = 1 - Math.pow(1 - pRetroceso, 3); // Desaceleración suave

      // Mitigación de la ráfaga
      this.materialRecuerdos.opacity = Math.max(0, 1 - pRetroceso * 2.5);

      // La cámara retrocede suavemente y se alinea con la perspectiva frontal del DOM
      this.camera.position.x = 0;
      this.camera.position.y = THREE.MathUtils.lerp(1.2, 2.5, easeOut);
      this.camera.position.z = THREE.MathUtils.lerp(1.5, 4.4, easeOut);
      this.camera.lookAt(0, 0.4, 0);

      // Iluminación dorada de resolución
      this.scene.background = new THREE.Color(0x0d0a08);
    }
  }

  /**
   * 🎨 Pinta el fotograma actual con viñeteado, grano y destellos de fuga de luz analógica
   */
  private dibujarFrameRecuerdoEnCanvas(frame: MemoryFrame, progresoRafaga: number): void {
    const ctx = this.ctxRecuerdos;
    ctx.clearRect(0, 0, 1280, 720);

    // 1. Imagen o miniatura del recuerdo
    ctx.drawImage(frame.bitmap, 0, 0, 1280, 720);

    // 2. Viñeteado cinematográfico
    const gradiente = ctx.createRadialGradient(640, 360, 250, 640, 360, 750);
    gradiente.addColorStop(0, 'rgba(0,0,0,0)');
    gradiente.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = gradiente;
    ctx.fillRect(0, 0, 1280, 720);

    // 3. Destello de fuga de luz ámbar dorado (Light leak)
    const leakAlpha = (Math.sin(progresoRafaga * 30) + 1) * 0.15;
    ctx.fillStyle = `rgba(230, 180, 60, ${leakAlpha})`;
    ctx.fillRect(0, 0, 1280, 720);

    // 4. Etiqueta vintage inferior sutil
    if (frame.titulo) {
      ctx.fillStyle = 'rgba(13, 10, 8, 0.7)';
      ctx.fillRect(40, 640, 420, 45);
      ctx.fillStyle = '#f3e5ab';
      ctx.font = '18px "Cinzel", "Georgia", serif';
      ctx.fillText(frame.titulo.substring(0, 32), 60, 668);
    }
  }

  /**
   * 💨 Actualiza la física y dispersión de partículas de polvo
   */
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

      // Resistencia del aire y gravedad
      vel.y -= 0.08;
      vel.x *= 0.96;
      vel.z *= 0.96;
    }
    geo.attributes['position'].needsUpdate = true;
  }

  /**
   * 🔊 Síntesis de audio con Web Audio API: Golpe seco de madera y cuero
   */
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

  /**
   * 🔊 Síntesis de audio con Web Audio API: Riser / Whoosh cinemático
   */
  private emitirSonidoRiser(): void {
    if (!this.sonidoActivado) return;
    try {
      if (!this.audioContext) return;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(80, this.audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(520, this.audioContext.currentTime + 0.9);

      gain.gain.setValueAtTime(0.01, this.audioContext.currentTime);
      gain.gain.linearRampToValueAtTime(0.35, this.audioContext.currentTime + 0.8);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.95);

      osc.connect(gain);
      gain.connect(this.audioContext.destination);

      osc.start();
      osc.stop(this.audioContext.currentTime + 1.0);
    } catch {}
  }

  /**
   * ⏭️ Permite al usuario omitir la intro instantáneamente si lo desea
   */
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

  /**
   * 🎞️ MÉTODO PARA EXPORTACIÓN DETERMINISTA (Remotion / WebCodecs / MP4):
   * Permite renderizar un fotograma congelado en el segundo exacto `t`.
   */
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
