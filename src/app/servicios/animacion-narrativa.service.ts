import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export enum NarrativeState {
  IDLE = 'IDLE',
  MOVING_TO_POI = 'MOVING_TO_POI',
  POI_PAUSED = 'POI_PAUSED',
  FINISHED = 'FINISHED'
}

export interface SegmentState {
  currentPoiIndex: number;
  activeTransportMode: string;
  activeSegmentDistance: number;
}

export interface CameraState {
  autoCameraEnabled: boolean;
  userZoomValue: number | null;
}

export interface SpeedState {
  autoSpeedEnabled: boolean;
  userSpeedValue: number;
}

@Injectable({
  providedIn: 'root'
})
export class AnimacionNarrativaService {

  // Estados
  public narrativeState$ = new BehaviorSubject<NarrativeState>(NarrativeState.IDLE);
  public segmentState$ = new BehaviorSubject<SegmentState>({
    currentPoiIndex: 0,
    activeTransportMode: 'car',
    activeSegmentDistance: 0
  });
  
  public cameraState$ = new BehaviorSubject<CameraState>({
    autoCameraEnabled: true,
    userZoomValue: null
  });

  public speedState$ = new BehaviorSubject<SpeedState>({
    autoSpeedEnabled: true,
    userSpeedValue: 1.0
  });

  constructor() {}

  // --- MÉTODOS DE CÁLCULO ---

  /**
   * Calcula el nivel de zoom óptimo basado en la distancia del subtramo y el tipo de transporte.
   */
  public calculateAutoZoom(distanceKm: number, transportMode: string): number {
    let maxZoom = 14;
    switch (transportMode) {
      case 'walking':
        maxZoom = 16;
        break;
      case 'car':
        maxZoom = 14;
        break;
      case 'boat':
      case 'plane':
        maxZoom = 11;
        break;
    }
    
    // Una fórmula simple para relacionar distancia y zoom (muy cruda, la ideal depende de fitBounds).
    // Sin embargo, el servicio dictará el límite máximo de zoom para Leaflet cuando hagamos fitBounds.
    return maxZoom;
  }

  /**
   * Calcula la duración recomendada en milisegundos para viajar entre el punto A y el POI B.
   * Reglas: Mínimo 3 seg, Máximo 12 seg.
   */
  public calculateAutoDuration(distanceKm: number, transportMode: string): number {
    // clamp( (distance / 10), 3, 12 )
    let baseSeconds = distanceKm / 10;
    if (baseSeconds < 3) baseSeconds = 3;
    if (baseSeconds > 12) baseSeconds = 12;

    let modifier = 1.0;
    switch (transportMode) {
      case 'plane': modifier = 0.6; break;
      case 'car': modifier = 1.0; break;
      case 'boat': modifier = 1.2; break;
      case 'walking': modifier = 1.5; break;
    }

    return (baseSeconds * modifier) * 1000;
  }

  public calculateAutoSpeed(transportMode: string): number {
    switch (transportMode) {
      case 'walking': return 3;
      case 'cycling': return 4;
      case 'driving':
      case 'car':
        return 6;
      case 'bus': return 6;
      case 'transport': return 10;
      default: return 5;
    }
  }

  // --- OVERRIDES MANUALES ---

  public setManualZoom() {
    const current = this.cameraState$.value;
    if (current.autoCameraEnabled) {
      this.cameraState$.next({ ...current, autoCameraEnabled: false });
    }
  }

  public restoreAutoZoom() {
    const current = this.cameraState$.value;
    if (!current.autoCameraEnabled) {
      this.cameraState$.next({ ...current, autoCameraEnabled: true, userZoomValue: null });
    }
  }

  public setManualSpeed(speed: number) {
    const current = this.speedState$.value;
    this.speedState$.next({ autoSpeedEnabled: false, userSpeedValue: speed });
  }

  public restoreAutoSpeed() {
    const current = this.speedState$.value;
    if (!current.autoSpeedEnabled) {
      this.speedState$.next({ ...current, autoSpeedEnabled: true });
    }
  }

  // --- FLUJO NARRATIVO ---

  public startSegment(poiIndex: number, distanceKm: number, transportMode: string) {
    this.segmentState$.next({
      currentPoiIndex: poiIndex,
      activeSegmentDistance: distanceKm,
      activeTransportMode: transportMode
    });
    this.narrativeState$.next(NarrativeState.MOVING_TO_POI);
  }

  public pauseAtPoi() {
    this.narrativeState$.next(NarrativeState.POI_PAUSED);
  }

  public finishAnimation() {
    this.narrativeState$.next(NarrativeState.FINISHED);
  }
  
  public reset() {
    this.narrativeState$.next(NarrativeState.IDLE);
    this.cameraState$.next({ autoCameraEnabled: true, userZoomValue: null });
    this.speedState$.next({ autoSpeedEnabled: true, userSpeedValue: 1.0 });
  }
}
