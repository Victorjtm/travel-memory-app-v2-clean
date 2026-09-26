import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import * as THREE from 'three';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { environment } from '../../environments/environment';
import { IntroMemoryPreloaderService, MemoryFrame } from './intro-memory-preloader.service';

export interface ProgresoIntroVideo {
  fase: 'preparando' | 'cargando_recursos' | 'renderizando' | 'codificando' | 'subiendo' | 'completado' | 'error';
  porcentaje: number;
  mensaje: string;
}

interface FotoVueloRender {
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

@Injectable({
  providedIn: 'root'
})
export class IntroVideoGeneratorService {

  public readonly DURACION_SEGUNDOS: number = 10.5;
  public readonly FPS: number = 30;
  public readonly ANCHO: number = 1920;
  public readonly ALTO: number = 1080;

  constructor(
    private http: HttpClient,
    private preloaderService: IntroMemoryPreloaderService
  ) {}

  /**
   * Comprueba si el viaje ya tiene una intro 3D personalizada generada en el servidor
   */
  async verificarIntroExiste(viajeId: number): Promise<{ exists: boolean; url: string | null }> {
    try {
      const backendUrl = environment.apiUrl || 'http://localhost:3000';
      const endpoint = `${backendUrl}/api/viajes/${viajeId}/intro-video`;
      const resp = await firstValueFrom(this.http.get<{ exists: boolean; url: string | null }>(endpoint));
      return resp || { exists: false, url: null };
    } catch {
      return { exists: false, url: null };
    }
  }

  /**
   * Genera el vídeo MP4 de la portada y apertura 3D personalizada con los datos del viaje actual,
   * y lo sube al backend.
   */
  async generarYSubirVideoIntro(
    viajeId: number,
    tituloViaje: string,
    imagenPortadaUrl: string | null,
    archivosViaje: any[],
    onProgress?: (p: ProgresoIntroVideo) => void
  ): Promise<string> {
    onProgress?.({ fase: 'preparando', porcentaje: 5, mensaje: 'Preparando motor 3D de portada...' });

    const blobVideo = await this.generarVideoIntro(
      viajeId,
      tituloViaje,
      imagenPortadaUrl,
      archivosViaje,
      onProgress
    );

    onProgress?.({ fase: 'subiendo', porcentaje: 92, mensaje: 'Guardando animación 3D de portada en servidor...' });

    const resultadoSubida = await this.subirVideoIntro(viajeId, blobVideo);

    onProgress?.({ fase: 'completado', porcentaje: 100, mensaje: '¡Portada 3D personalizada lista!' });
    return resultadoSubida.url;
  }

  /**
   * Sube el blob MP4 generado al servidor
   */
  async subirVideoIntro(viajeId: number, blob: Blob): Promise<{ success: boolean; url: string }> {
    const backendUrl = environment.apiUrl || 'http://localhost:3000';
    const endpoint = `${backendUrl}/api/viajes/${viajeId}/intro-video`;

    const formData = new FormData();
    formData.append('video', blob, `intro_3d_${viajeId}.mp4`);

    const resp = await firstValueFrom(this.http.post<{ success: boolean; url: string }>(endpoint, formData));
    return resp;
  }

  /**
   * Renderiza offscreen fotograma a fotograma la escena 3D de la caída y apertura del libro
   * con el título y fotografía del viaje especificado.
   */
  async generarVideoIntro(
    viajeId: number,
    tituloViaje: string,
    imagenPortadaUrl: string | null,
    archivosViaje: any[],
    onProgress?: (p: ProgresoIntroVideo) => void
  ): Promise<Blob> {
    onProgress?.({ fase: 'cargando_recursos', porcentaje: 10, mensaje: 'Cargando imagen de portada y recuerdos...' });

    // 1. Cargar recuerdos y foto de portada
    let fotoPortadaBitmap: ImageBitmap | null = null;
    let framesPrecargados: MemoryFrame[] = [];

    try {
      framesPrecargados = await this.preloaderService.prepararRafagaRecuerdos(archivosViaje, 16);
    } catch (e) {
      console.warn('⚠️ [IntroVideoGenerator] No se pudieron precargar recuerdos:', e);
    }

    if (imagenPortadaUrl) {
      try {
        fotoPortadaBitmap = await this.cargarFotoBitmap(imagenPortadaUrl);
      } catch (err) {
        console.warn('⚠️ [IntroVideoGenerator] Error cargando portada desde URL, usando primer frame:', err);
      }
    }

    if (!fotoPortadaBitmap && framesPrecargados.length > 0) {
      fotoPortadaBitmap = framesPrecargados[0].bitmap;
    }

    // 2. Preparar Canvas y Three.js WebGL Renderer
    const canvas = document.createElement('canvas');
    canvas.width = this.ANCHO;
    canvas.height = this.ALTO;
    canvas.style.position = 'fixed';
    canvas.style.left = '-9999px';
    canvas.style.top = '-9999px';
    canvas.style.width = `${this.ANCHO}px`;
    canvas.style.height = `${this.ALTO}px`;
    canvas.style.opacity = '0';
    canvas.style.pointerEvents = 'none';
    document.body.appendChild(canvas);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(this.ANCHO, this.ALTO, false);
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0502);

    const camera = new THREE.PerspectiveCamera(40, this.ANCHO / this.ALTO, 0.1, 50);

    // Iluminación
    const ambientLight = new THREE.AmbientLight(0xffedd4, 1.25);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff7e6, 2.8);
    dirLight.position.set(4.5, 7.5, 5.0);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.bias = -0.0004;
    scene.add(dirLight);

    const warmLight = new THREE.PointLight(0xff9d42, 2.2, 10);
    warmLight.position.set(-2.5, 3.2, 2.0);
    scene.add(warmLight);

    const luzInteriorLibro = new THREE.PointLight(0xffda73, 0, 4);
    luzInteriorLibro.position.set(0, 0.4, 0);
    scene.add(luzInteriorLibro);

    // 3. Mesa de madera noble
    const canvasMadera = document.createElement('canvas');
    canvasMadera.width = 2048;
    canvasMadera.height = 2048;
    this.dibujarMaderaProcedural(canvasMadera);
    const texturaMadera = new THREE.CanvasTexture(canvasMadera);
    texturaMadera.wrapS = THREE.RepeatWrapping;
    texturaMadera.wrapT = THREE.RepeatWrapping;
    texturaMadera.repeat.set(1.5, 1.5);
    const matMadera = new THREE.MeshStandardMaterial({ map: texturaMadera, roughness: 0.65, metalness: 0.12 });
    const geoMadera = new THREE.PlaneGeometry(18, 18);
    const mesaMesh = new THREE.Mesh(geoMadera, matMadera);
    mesaMesh.rotation.x = -Math.PI / 2;
    mesaMesh.receiveShadow = true;
    scene.add(mesaMesh);

    // 4. Libro vintage con tapa articulada
    const libroGroup = new THREE.Group();
    const anchoLibro = 2.4;
    const altoLibro = 0.35;
    const profLibro = 3.2;

    const canvasCuero = document.createElement('canvas');
    canvasCuero.width = 2048;
    canvasCuero.height = 2048;
    this.dibujarCubiertaCuero(canvasCuero, tituloViaje, fotoPortadaBitmap);
    const texturaCuero = new THREE.CanvasTexture(canvasCuero);
    texturaCuero.colorSpace = THREE.SRGBColorSpace;
    texturaCuero.anisotropy = 8;

    const matCueroFrontal = new THREE.MeshStandardMaterial({ map: texturaCuero, roughness: 0.45, metalness: 0.25 });

    const canvasInteriorTapa = document.createElement('canvas');
    canvasInteriorTapa.width = 512;
    canvasInteriorTapa.height = 512;
    const ctxTapaInt = canvasInteriorTapa.getContext('2d')!;
    ctxTapaInt.fillStyle = '#261309';
    ctxTapaInt.fillRect(0, 0, 512, 512);
    const texCueroInterior = new THREE.CanvasTexture(canvasInteriorTapa);
    const matCueroInterior = new THREE.MeshStandardMaterial({ map: texCueroInterior, roughness: 0.65, metalness: 0.12 });
    const matBorde = new THREE.MeshStandardMaterial({ color: 0x1f0e08, roughness: 0.55 });

    // Hojas doradas
    const geoHojas = new THREE.BoxGeometry(anchoLibro * 0.96, altoLibro * 0.85, profLibro * 0.96);
    const matHojas = new THREE.MeshStandardMaterial({ color: 0xdfbe65, roughness: 0.72, metalness: 0.35 });
    const hojasMesh = new THREE.Mesh(geoHojas, matHojas);
    hojasMesh.position.set(0.04, altoLibro * 0.45, 0);
    hojasMesh.castShadow = true;
    hojasMesh.receiveShadow = true;
    libroGroup.add(hojasMesh);

    // Página interior derecha visible (pergamino con filigrana)
    const canvasInterior = document.createElement('canvas');
    canvasInterior.width = 1024;
    canvasInterior.height = 1024;
    this.dibujarPaginaInteriorPergamino(canvasInterior);
    const texInterior = new THREE.CanvasTexture(canvasInterior);
    const matInterior = new THREE.MeshStandardMaterial({ map: texInterior, roughness: 0.8 });
    const geoInterior = new THREE.PlaneGeometry(anchoLibro * 0.94, profLibro * 0.94);
    const interiorMesh = new THREE.Mesh(geoInterior, matInterior);
    interiorMesh.rotation.x = -Math.PI / 2;
    interiorMesh.position.set(0.04, altoLibro * 0.88, 0);
    libroGroup.add(interiorMesh);

    // Pivote articulado en el lomo
    const tapaPivotGroup = new THREE.Group();
    tapaPivotGroup.position.set(-anchoLibro / 2, altoLibro + 0.03, 0);

    const geoTapa = new THREE.BoxGeometry(anchoLibro, 0.06, profLibro);
    const tapaMesh = new THREE.Mesh(geoTapa, [
      matBorde,
      matBorde,
      matCueroFrontal,
      matCueroInterior,
      matBorde,
      matBorde
    ]);
    tapaMesh.position.set(anchoLibro / 2, 0, 0);
    tapaMesh.castShadow = true;
    tapaPivotGroup.add(tapaMesh);
    libroGroup.add(tapaPivotGroup);

    // Lomo curvo
    const geoLomo = new THREE.CylinderGeometry(altoLibro * 0.5, altoLibro * 0.5, profLibro, 24, 1, false, 0, Math.PI);
    const matLomo = new THREE.MeshStandardMaterial({ color: 0x1f0e08, roughness: 0.55, metalness: 0.2 });
    const lomoMesh = new THREE.Mesh(geoLomo, matLomo);
    lomoMesh.rotation.z = Math.PI / 2;
    lomoMesh.rotation.y = Math.PI / 2;
    lomoMesh.position.set(-anchoLibro / 2, altoLibro * 0.5, 0);
    lomoMesh.castShadow = true;
    libroGroup.add(lomoMesh);

    libroGroup.position.set(0, 4.8, 0);
    scene.add(libroGroup);

    // 5. Partículas de polvo al caer
    const totalParticulas = 180;
    const geoPolvo = new THREE.BufferGeometry();
    const posPolvo = new Float32Array(totalParticulas * 3);
    const velPolvo: THREE.Vector3[] = [];
    for (let i = 0; i < totalParticulas; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 0.8 + Math.random() * 1.6;
      posPolvo[i * 3] = Math.cos(ang) * rad;
      posPolvo[i * 3 + 1] = 0.04;
      posPolvo[i * 3 + 2] = Math.sin(ang) * rad;
      velPolvo.push(new THREE.Vector3(Math.cos(ang) * (2 + Math.random() * 3), 0.4 + Math.random() * 1.5, Math.sin(ang) * (2 + Math.random() * 3)));
    }
    geoPolvo.setAttribute('position', new THREE.BufferAttribute(posPolvo, 3));
    const matPolvo = new THREE.PointsMaterial({
      color: 0xd4c29a,
      size: 0.12,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const polvoParticles = new THREE.Points(geoPolvo, matPolvo);
    scene.add(polvoParticles);

    // 6. Plano de recuerdos fotográficos en vuelo
    const canvasRecuerdos = document.createElement('canvas');
    canvasRecuerdos.width = 1280;
    canvasRecuerdos.height = 720;
    const ctxRecuerdos = canvasRecuerdos.getContext('2d')!;
    const texRecuerdos = new THREE.CanvasTexture(canvasRecuerdos);
    texRecuerdos.colorSpace = THREE.SRGBColorSpace;
    const matRecuerdos = new THREE.MeshBasicMaterial({
      map: texRecuerdos,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false
    });
    const planoRecuerdos = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), matRecuerdos);
    planoRecuerdos.position.set(0, 0, -0.5);
    camera.add(planoRecuerdos);
    scene.add(camera);

    // Variables de control cinemático
    const fotosEnVuelo: FotoVueloRender[] = [];
    let indiceSiguienteFoto = 0;
    let ultimoTiempoSpawn = 0;

    const actualizarEstadoCinematico = (t: number) => {
      const ANGULO_MAX_APERTURA = Math.PI * 0.82;

      // FASE 1: Caída majestuosa con rebote (0.0s - 1.40s)
      if (t <= 1.40) {
        const tImpacto = 1.10;
        if (t < tImpacto) {
          const p = t / tImpacto;
          const progCaida = Math.pow(p, 2.2);
          libroGroup.position.y = 4.8 * (1 - progCaida);
          libroGroup.rotation.x = -0.32 * (1 - progCaida) - 0.15;
          libroGroup.rotation.y = 0.08 * (1 - progCaida);
          libroGroup.rotation.z = 0.10 * (1 - progCaida);
          polvoParticles.visible = false;
          tapaPivotGroup.rotation.z = 0;
        } else {
          const delta = t - tImpacto;
          const amplitud = 0.22 * Math.exp(-delta * 14);
          const rebote = Math.sin(delta * 36) * amplitud;
          libroGroup.position.y = Math.max(0, rebote);
          libroGroup.rotation.set(-0.15, 0, 0);
          tapaPivotGroup.rotation.z = 0;

          polvoParticles.visible = true;
          matPolvo.opacity = Math.max(0, 0.7 - delta * 0.9);
          const pos = geoPolvo.attributes['position'].array as Float32Array;
          for (let i = 0; i < totalParticulas; i++) {
            const v = velPolvo[i];
            pos[i * 3] += v.x * 0.016;
            pos[i * 3 + 1] += v.y * 0.016;
            pos[i * 3 + 2] += v.z * 0.016;
          }
          geoPolvo.attributes['position'].needsUpdate = true;
        }
        camera.position.set(0, 3.4, 3.4);
        camera.lookAt(0, 0.35, 0.25);
        matRecuerdos.opacity = 0;
        luzInteriorLibro.intensity = 0;
      }
      // FASE 2: Travelling cinematográfico hacia portada (1.40s - 2.80s)
      else if (t > 1.40 && t <= 2.80) {
        polvoParticles.visible = false;
        libroGroup.position.set(0, 0, 0);
        libroGroup.rotation.set(-0.15, 0, 0);
        tapaPivotGroup.rotation.z = 0;
        matRecuerdos.opacity = 0;
        luzInteriorLibro.intensity = 0;

        const pZoom = (t - 1.40) / 1.40;
        const easeZoom = (1 - Math.cos(pZoom * Math.PI)) / 2;
        camera.position.x = 0;
        camera.position.y = THREE.MathUtils.lerp(3.4, 2.15, easeZoom);
        camera.position.z = THREE.MathUtils.lerp(3.4, 2.05, easeZoom);
        camera.lookAt(0, THREE.MathUtils.lerp(0.35, 0.30, easeZoom), THREE.MathUtils.lerp(0.25, 0.10, easeZoom));
      }
      // FASE 3: Pausa de lectura sosegada del título y foto (2.80s - 5.40s)
      else if (t > 2.80 && t <= 5.40) {
        polvoParticles.visible = false;
        libroGroup.position.set(0, 0, 0);
        libroGroup.rotation.set(-0.15, 0, 0);
        tapaPivotGroup.rotation.z = 0;
        matRecuerdos.opacity = 0;
        luzInteriorLibro.intensity = 0;

        const pHold = (t - 2.80) / 2.60;
        camera.position.set(0, 2.15 - pHold * 0.04, 2.05 - pHold * 0.04);
        camera.lookAt(0, 0.30, 0.10);
      }
      // FASE 4: Apertura majestuosa de la tapa (5.40s - 7.20s)
      else if (t > 5.40 && t <= 7.20) {
        const pAp = (t - 5.40) / 1.80;
        const easeAp = (1 - Math.cos(pAp * Math.PI)) / 2;
        tapaPivotGroup.rotation.z = easeAp * ANGULO_MAX_APERTURA;
        luzInteriorLibro.intensity = easeAp * 2.5;

        camera.position.x = 0;
        camera.position.y = THREE.MathUtils.lerp(2.11, 3.10, easeAp);
        camera.position.z = THREE.MathUtils.lerp(2.01, 3.10, easeAp);
        camera.lookAt(0, 0.35, THREE.MathUtils.lerp(0.10, 0.25, easeAp));
        matRecuerdos.opacity = 0;
      }
      // FASE 5: Vuelo de recuerdos desde el libro abierto (7.20s - 10.20s)
      else if (t > 7.20 && t <= 10.20) {
        tapaPivotGroup.rotation.z = ANGULO_MAX_APERTURA;
        luzInteriorLibro.intensity = 2.5;

        this.animarVueloFotos(
          ctxRecuerdos,
          fotosEnVuelo,
          framesPrecargados,
          fotoPortadaBitmap,
          tituloViaje,
          t,
          () => indiceSiguienteFoto++,
          () => ultimoTiempoSpawn,
          (ts) => { ultimoTiempoSpawn = ts; }
        );

        texRecuerdos.needsUpdate = true;
        matRecuerdos.opacity = 1.0;
        camera.position.set(0, 3.1, 3.1);
        camera.lookAt(0, 0.35, 0.25);
      }
      // FASE 6: Encuadre final del libro abierto (10.20s - 10.50s)
      else {
        ctxRecuerdos.clearRect(0, 0, 1280, 720);
        texRecuerdos.needsUpdate = true;
        matRecuerdos.opacity = 0;
        tapaPivotGroup.rotation.z = ANGULO_MAX_APERTURA;
        luzInteriorLibro.intensity = 2.0;
        camera.position.set(0, 3.1, 3.1);
        camera.lookAt(0, 0.35, 0.25);
      }
    };

    // 7. Codificación con WebCodecs / mp4-muxer
    const totalFrames = Math.round(this.DURACION_SEGUNDOS * this.FPS);
    const frameDurationMicros = Math.round(1_000_000 / this.FPS);

    onProgress?.({ fase: 'codificando', porcentaje: 20, mensaje: 'Codificando animación 3D de portada...' });

    let resultadoBlob: Blob;

    if (typeof (window as any).VideoEncoder !== 'undefined') {
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: {
          codec: 'avc',
          width: this.ANCHO,
          height: this.ALTO
        },
        fastStart: 'in-memory'
      });

      const encoder = new (window as any).VideoEncoder({
        output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
        error: (e: any) => console.error('❌ [IntroVideoGenerator] Error WebCodecs:', e)
      });

      encoder.configure({
        codec: 'avc1.42001f', // Baseline Profile level 3.1 universal
        width: this.ANCHO,
        height: this.ALTO,
        bitrate: 4_000_000,
        bitrateMode: 'variable',
        framerate: this.FPS
      });

      for (let frame = 0; frame < totalFrames; frame++) {
        const t = frame / this.FPS;
        actualizarEstadoCinematico(t);
        renderer.render(scene, camera);

        const videoFrame = new (window as any).VideoFrame(canvas, {
          timestamp: frame * frameDurationMicros
        });
        encoder.encode(videoFrame, { keyFrame: frame % (this.FPS * 2) === 0 });
        videoFrame.close();

        if (frame % 15 === 0) {
          const pct = 20 + Math.round((frame / totalFrames) * 70);
          onProgress?.({
            fase: 'renderizando',
            porcentaje: pct,
            mensaje: `Renderizando fotograma 3D ${frame + 1} de ${totalFrames}...`
          });
          await new Promise(r => setTimeout(r, 0));
        }
      }

      await encoder.flush();
      muxer.finalize();
      resultadoBlob = new Blob([muxer.target.buffer], { type: 'video/mp4' });

    } else {
      // Fallback con MediaRecorder
      onProgress?.({ fase: 'renderizando', porcentaje: 30, mensaje: 'Renderizando con MediaRecorder...' });
      const stream = canvas.captureStream(this.FPS);
      const mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=h264')
        ? 'video/mp4;codecs=h264'
        : (MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm');

      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      const finishedPromise = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });

      recorder.start();
      for (let frame = 0; frame < totalFrames; frame++) {
        const t = frame / this.FPS;
        actualizarEstadoCinematico(t);
        renderer.render(scene, camera);
        await new Promise(r => setTimeout(r, 1000 / this.FPS));
      }
      recorder.stop();
      resultadoBlob = await finishedPromise;
    }

    // 8. Limpieza de memoria
    try {
      renderer.dispose();
      geoMadera.dispose();
      matMadera.dispose();
      texturaMadera.dispose();
      geoHojas.dispose();
      matHojas.dispose();
      geoInterior.dispose();
      matInterior.dispose();
      texInterior.dispose();
      geoTapa.dispose();
      matCueroFrontal.dispose();
      matCueroInterior.dispose();
      texturaCuero.dispose();
      texCueroInterior.dispose();
      geoLomo.dispose();
      matLomo.dispose();
      geoPolvo.dispose();
      matPolvo.dispose();
      texRecuerdos.dispose();
      matRecuerdos.dispose();
      document.body.removeChild(canvas);
    } catch {}

    return resultadoBlob;
  }

  // =========================================================================
  // DIBUJADO 2D DE TEXTURAS (CUERO, MADERA, PERGAMINO Y FOTOS EN VUELO)
  // =========================================================================

  private async cargarFotoBitmap(url: string): Promise<ImageBitmap> {
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) throw new Error('Error al descargar imagen');
    const blob = await resp.blob();
    return await createImageBitmap(blob, {
      resizeWidth: 1024,
      resizeHeight: 680,
      resizeQuality: 'high'
    });
  }

  private dibujarMaderaProcedural(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#2c190f';
    ctx.fillRect(0, 0, 2048, 2048);

    for (let i = 0; i < 700; i++) {
      ctx.strokeStyle = `rgba(18, 9, 4, ${0.08 + Math.random() * 0.18})`;
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
    }

    const sombraCentro = ctx.createRadialGradient(1024, 1024, 200, 1024, 1024, 800);
    sombraCentro.addColorStop(0, 'rgba(5, 2, 1, 0.7)');
    sombraCentro.addColorStop(0.7, 'rgba(10, 5, 2, 0.35)');
    sombraCentro.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = sombraCentro;
    ctx.fillRect(0, 0, 2048, 2048);
  }

  private dibujarCubiertaCuero(canvas: HTMLCanvasElement, titulo: string, fotoPortada: ImageBitmap | null): void {
    const ctx = canvas.getContext('2d')!;
    const W = 2048;
    const H = 2048;

    ctx.clearRect(0, 0, W, H);

    // Fondo cuero oscuro con degradado radial
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

    // Marcos de pan de oro repujado
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
    ctx.fillText('✦   DIARIO DE VIAJES Y MEMORIAS   ✦', W / 2 + 2, 222);
    ctx.fillStyle = '#dfc488';
    ctx.fillText('✦   DIARIO DE VIAJES Y MEMORIAS   ✦', W / 2, 220);

    // Título adaptativo maximizado
    this.dibujarTituloAdaptativo(ctx, titulo, W / 2, 410, 1620);

    // Relicario fotográfico central
    this.dibujarRelicarioCentral(ctx, fotoPortada, W / 2, 1250, 840, 530);

    // Insignia inferior
    ctx.font = 'bold 34px "Cinzel", serif';
    ctx.fillStyle = '#100703';
    ctx.fillText('✦   ✦   ✦', W / 2 + 2, 1742);
    ctx.fillStyle = '#dfc488';
    ctx.fillText('✦   ✦   ✦', W / 2, 1740);
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

  private dibujarTituloAdaptativo(ctx: CanvasRenderingContext2D, titulo: string, centerX: number, startY: number, maxAncho: number): void {
    const rawTitulo = (titulo || 'MI VIAJE').trim();
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

      ctx.fillStyle = '#020100';
      ctx.fillText(linea.texto, centerX + 6, yActual + 7);

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

  private dibujarRelicarioCentral(ctx: CanvasRenderingContext2D, foto: ImageBitmap | null, centerX: number, centerY: number, ancho: number, alto: number): void {
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

    if (foto) {
      const imgW = foto.width;
      const imgH = foto.height;
      const r = Math.max(fw / imgW, fh / imgH);
      const nw = imgW * r;
      const nh = imgH * r;
      const cx = (fw - nw) * 0.5;
      const cy = (fh - nh) * 0.5;

      ctx.save();
      ctx.beginPath();
      ctx.rect(fx, fy, fw, fh);
      ctx.clip();
      ctx.drawImage(foto, fx + cx, fy + cy, nw, nh);
      ctx.restore();

      const gradCristal = ctx.createLinearGradient(fx, fy, fx + fw, fy + fh);
      gradCristal.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
      gradCristal.addColorStop(0.4, 'rgba(255, 255, 255, 0.0)');
      gradCristal.addColorStop(0.7, 'rgba(0, 0, 0, 0.15)');
      gradCristal.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
      ctx.fillStyle = gradCristal;
      ctx.fillRect(fx, fy, fw, fh);
    }

    ctx.strokeStyle = 'rgba(223, 196, 136, 0.8)';
    ctx.lineWidth = 3;
    ctx.strokeRect(fx, fy, fw, fh);
  }

  private dibujarPaginaInteriorPergamino(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f5ecd8';
    ctx.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 3000; i++) {
      ctx.fillStyle = `rgba(180, 140, 90, ${0.03 + Math.random() * 0.08})`;
      ctx.fillRect(Math.random() * 1024, Math.random() * 1024, 3, 3);
    }
    ctx.strokeStyle = '#c59d42';
    ctx.lineWidth = 12;
    ctx.strokeRect(60, 60, 904, 904);
    ctx.font = 'italic 34px "Cinzel", "Georgia", serif';
    ctx.fillStyle = '#6a4515';
    ctx.textAlign = 'center';
    ctx.fillText('✦   MEMORIAS Y RECUERDOS DEL VIAJE   ✦', 512, 512);
  }

  private animarVueloFotos(
    ctx: CanvasRenderingContext2D,
    fotosEnVuelo: FotoVueloRender[],
    framesPrecargados: MemoryFrame[],
    fotoPortadaBitmap: ImageBitmap | null,
    tituloViaje: string,
    t: number,
    avanzarIndice: () => number,
    getUltimoSpawn: () => number,
    setUltimoSpawn: (ts: number) => void
  ): void {
    const CW = 1280;
    const CH = 720;
    ctx.clearRect(0, 0, CW, CH);

    const INTERVALO_SPAWN = 0.28;
    if (t >= 7.25 && t <= 9.30 && t - getUltimoSpawn() >= INTERVALO_SPAWN) {
      setUltimoSpawn(t);
      const framesDisponibles = framesPrecargados;
      let frame: MemoryFrame | null = null;
      const idx = avanzarIndice();

      if (framesDisponibles.length > 0) {
        frame = framesDisponibles[idx % framesDisponibles.length];
      } else if (fotoPortadaBitmap) {
        frame = { bitmap: fotoPortadaBitmap, titulo: tituloViaje || 'Recuerdo', esVideo: false };
      }

      if (frame) {
        const formatos: ('polaroid' | 'cuadrado' | 'postal')[] = ['polaroid', 'cuadrado', 'postal'];
        const formato = formatos[idx % formatos.length];
        const anguloAbanico = ((idx * 137.5) % 360) * (Math.PI / 180);
        const radioDrift = 280 + Math.random() * 220;
        const driftX = Math.cos(anguloAbanico) * radioDrift;
        const driftY = -140 - Math.random() * 220;

        let anchoBase = 320;
        let altoBase = 240;
        if (formato === 'polaroid') { anchoBase = 290; altoBase = 340; }
        else if (formato === 'cuadrado') { anchoBase = 290; altoBase = 290; }
        else { anchoBase = 340; altoBase = 240; }

        fotosEnVuelo.push({
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

    const activas = fotosEnVuelo.filter(f => (t - f.tiempoInicio) < f.duracion);
    fotosEnVuelo.length = 0;
    fotosEnVuelo.push(...activas);

    const origenX = CW * 0.58;
    const origenY = CH * 0.62;

    for (const foto of fotosEnVuelo) {
      const p = (t - foto.tiempoInicio) / foto.duracion;
      const u = Math.sin(p * Math.PI);
      const escala = 0.14 + Math.pow(u, 1.25) * 1.90;
      const curvatura = Math.sin(p * Math.PI * 2) * 40;
      const posX = origenX + foto.driftX * Math.pow(u, 1.1) + curvatura;
      const posY = origenY + foto.driftY * Math.pow(u, 1.1) - Math.abs(curvatura) * 0.4;
      const rot = foto.giroMax * Math.sin(p * Math.PI);

      let alpha = 1.0;
      if (p < 0.08) alpha = p / 0.08;
      else if (p > 0.90) alpha = Math.max(0, (1.0 - p) / 0.10);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(posX, posY);
      ctx.rotate(rot);
      ctx.scale(escala, escala);
      ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
      ctx.shadowBlur = 8 + u * 24;
      ctx.shadowOffsetX = 3 + u * 8;
      ctx.shadowOffsetY = 5 + u * 14;

      const { frame, formato, anchoBase: w, altoBase: h } = foto;
      const rx = -w / 2;
      const ry = -h / 2;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(rx, ry, w, h);
      ctx.shadowColor = 'transparent';

      const pad = 10;
      const fotoW = w - pad * 2;
      const fotoH = formato === 'polaroid' ? h - pad - 45 : h - pad * 2;

      if (frame.bitmap) {
        const imgW = frame.bitmap.width;
        const imgH = frame.bitmap.height;
        const r = Math.max(fotoW / imgW, fotoH / imgH);
        const nw = imgW * r;
        const nh = imgH * r;
        const cx = (fotoW - nw) * 0.5;
        const cy = (fotoH - nh) * 0.5;
        ctx.save();
        ctx.beginPath();
        ctx.rect(rx + pad, ry + pad, fotoW, fotoH);
        ctx.clip();
        ctx.drawImage(frame.bitmap, rx + pad + cx, ry + pad + cy, nw, nh);
        ctx.restore();
      }

      if (formato === 'polaroid') {
        ctx.fillStyle = '#2d2015';
        ctx.font = 'bold 15px "Cinzel", "Georgia", serif';
        ctx.textAlign = 'center';
        const txt = frame.titulo ? frame.titulo.substring(0, 24) : 'Recuerdo';
        ctx.fillText(txt, 0, ry + h - 16);
      }

      ctx.restore();
    }
  }

}
