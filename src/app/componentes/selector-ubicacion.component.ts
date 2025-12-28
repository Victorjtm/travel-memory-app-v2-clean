import { Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import * as L from 'leaflet';

export interface UbicacionSeleccionada {
  latitud: number;
  longitud: number;
  direccion?: string;
  nombreLugar?: string;
}

@Component({
  selector: 'app-selector-ubicacion',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  template: `
    <div class="selector-ubicacion-dialog">
      <div class="dialog-header">
        <div class="header-content">
          <div class="header-icon">
            <mat-icon>location_on</mat-icon>
          </div>
          <h2>Seleccionar Ubicación</h2>
        </div>
        <button mat-icon-button class="close-btn" (click)="cerrar()">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div class="dialog-content">
        <!-- Buscador de direcciones -->
        <div class="buscador-container">
          <mat-form-field appearance="outline" class="search-field">
            <mat-label>Buscar dirección o lugar</mat-label>
            <input matInput
                   [(ngModel)]="textoBusqueda"
                   (keydown.enter)="buscarDireccion()"
                   placeholder="Ej: Zaragoza, Plaza del Pilar">
            <button mat-icon-button matSuffix 
                    (click)="buscarDireccion()" 
                    [disabled]="buscando"
                    class="search-btn">
              <mat-spinner diameter="20" *ngIf="buscando"></mat-spinner>
              <mat-icon *ngIf="!buscando">search</mat-icon>
            </button>
          </mat-form-field>
        </div>

        <!-- Información de ubicación seleccionada -->
        <div class="info-ubicacion" *ngIf="ubicacionSeleccionada">
          <div class="info-card">
            <div class="info-icon">
              <mat-icon>place</mat-icon>
            </div>
            <div class="info-content">
              <div class="coordenadas">
                <span class="label">Coordenadas:</span>
                <span class="value">
                  {{ubicacionSeleccionada.latitud | number:'1.6-6'}}, 
                  {{ubicacionSeleccionada.longitud | number:'1.6-6'}}
                </span>
              </div>
              <div class="direccion" *ngIf="ubicacionSeleccionada.direccion">
                <span class="label">Dirección:</span>
                <span class="value">{{ubicacionSeleccionada.direccion}}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Contenedor del mapa -->
        <div class="mapa-container">
          <div id="mapa-selector" class="mapa"></div>
          <div class="mapa-overlay">
            <div class="tap-hint" *ngIf="!ubicacionSeleccionada">
              <mat-icon>touch_app</mat-icon>
              <span>Toca en el mapa para seleccionar</span>
            </div>
          </div>
        </div>

        <!-- Botones de acción rápida -->
        <div class="acciones-rapidas">
          <button mat-flat-button 
                  class="action-btn primary" 
                  (click)="obtenerUbicacionActual()" 
                  [disabled]="obteniendo">
            <div class="btn-content">
              <mat-spinner diameter="16" *ngIf="obteniendo"></mat-spinner>
              <mat-icon *ngIf="!obteniendo">my_location</mat-icon>
              <span>Mi ubicación</span>
            </div>
          </button>
          <button mat-flat-button 
                  class="action-btn secondary" 
                  (click)="centrarEnEspana()">
            <div class="btn-content">
              <mat-icon>map</mat-icon>
              <span>Ver España</span>
            </div>
          </button>
        </div>
      </div>

      <div class="dialog-actions">
        <button mat-stroked-button 
                class="cancel-btn" 
                (click)="cerrar()">
          Cancelar
        </button>
        <button mat-flat-button 
                class="confirm-btn"
                (click)="confirmarSeleccion()"
                [disabled]="!ubicacionSeleccionada">
          <mat-icon>check</mat-icon>
          Confirmar
        </button>
      </div>
    </div>
  `,
  styles: [`
    .selector-ubicacion-dialog {
      width: 100%;
      max-width: 500px;
      height: 90vh;
      max-height: 700px;
      display: flex;
      flex-direction: column;
      border-radius: 24px;
      overflow: hidden;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    }

    .dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 24px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    }

    .header-content {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .header-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    }

    .dialog-header h2 {
      margin: 0;
      color: #2c3e50;
      font-weight: 600;
      font-size: 18px;
    }

    .close-btn {
      background: rgba(0, 0, 0, 0.05);
      border-radius: 12px;
    }

    .dialog-content {
      flex: 1;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      background: #f8f9ff;
      overflow-y: auto;
    }

    .buscador-container {
      position: relative;
    }

    .search-field {
      width: 100%;
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    }

    .search-field ::ng-deep .mat-mdc-form-field-outline {
      border-radius: 16px;
      border: 2px solid #e1e8ff;
    }

    .search-field ::ng-deep .mat-mdc-form-field-focus-overlay {
      border-radius: 16px;
    }

    .search-btn {
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white;
      border-radius: 12px;
      margin-right: 8px;
    }

    .info-ubicacion {
      animation: slideInUp 0.3s ease-out;
    }

    .info-card {
      background: white;
      border-radius: 16px;
      padding: 20px;
      display: flex;
      align-items: flex-start;
      gap: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.8);
    }

    .info-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: linear-gradient(135deg, #4CAF50, #45a049);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      flex-shrink: 0;
    }

    .info-content {
      flex: 1;
      min-width: 0;
    }

    .coordenadas, .direccion {
      margin-bottom: 8px;
      word-wrap: break-word;
    }

    .label {
      font-weight: 600;
      color: #2c3e50;
      font-size: 14px;
      display: block;
      margin-bottom: 4px;
    }

    .value {
      color: #5a6c7d;
      font-size: 13px;
      line-height: 1.4;
      display: block;
    }

    .mapa-container {
      flex: 1;
      min-height: 280px;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
      position: relative;
      background: linear-gradient(135deg, #e3f2fd, #bbdefb);
    }

    .mapa {
      width: 100%;
      height: 100%;
      min-height: 280px;
      border-radius: 20px;
    }

    .mapa-overlay {
      position: absolute;
      top: 16px;
      left: 16px;
      right: 16px;
      pointer-events: none;
      z-index: 1000;
    }

    .tap-hint {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      padding: 12px 16px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #5a6c7d;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
      animation: pulse 2s infinite;
    }

    .acciones-rapidas {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .action-btn {
      height: 56px;
      border-radius: 16px;
      font-weight: 600;
      text-transform: none;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
      transition: all 0.3s ease;
    }

    .action-btn:hover:not([disabled]) {
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
    }

    .action-btn.primary {
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white;
    }

    .action-btn.secondary {
      background: white;
      color: #667eea;
      border: 2px solid #e1e8ff;
    }

    .btn-content {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .dialog-actions {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 20px 24px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-top: 1px solid rgba(255, 255, 255, 0.2);
    }

    .cancel-btn {
      flex: 1;
      height: 48px;
      border-radius: 12px;
      font-weight: 600;
      color: #5a6c7d;
      border: 2px solid #e1e8ff;
      background: transparent;
    }

    .confirm-btn {
      flex: 2;
      height: 48px;
      border-radius: 12px;
      font-weight: 600;
      background: linear-gradient(135deg, #4CAF50, #45a049);
      color: white;
      box-shadow: 0 6px 20px rgba(76, 175, 80, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .confirm-btn:disabled {
      background: #e0e0e0;
      color: #9e9e9e;
      box-shadow: none;
    }

    @keyframes slideInUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes pulse {
      0%, 100% {
        transform: scale(1);
        opacity: 1;
      }
      50% {
        transform: scale(1.02);
        opacity: 0.9;
      }
    }

    @media (max-width: 480px) {
      .selector-ubicacion-dialog {
        width: 100vw;
        height: 100vh;
        max-height: 100vh;
        border-radius: 0;
      }
      
      .dialog-header {
        padding: 16px 20px;
      }
      
      .dialog-content {
        padding: 20px;
        gap: 16px;
      }
      
      .header-icon {
        width: 36px;
        height: 36px;
      }
      
      .dialog-header h2 {
        font-size: 16px;
      }
      
      .acciones-rapidas {
        grid-template-columns: 1fr;
        gap: 10px;
      }
      
      .action-btn {
        height: 52px;
      }
      
      .mapa-container {
        min-height: 250px;
      }
      
      .dialog-actions {
        padding: 16px 20px;
        gap: 12px;
      }
      
      .cancel-btn, .confirm-btn {
        height: 44px;
      }
    }

    @media (max-width: 360px) {
      .info-card {
        padding: 16px;
        gap: 12px;
      }
      
      .info-icon {
        width: 40px;
        height: 40px;
      }
      
      .label {
        font-size: 13px;
      }
      
      .value {
        font-size: 12px;
      }
    }

    /* Estilos para el mapa en modo oscuro */
    @media (prefers-color-scheme: dark) {
      .dialog-content {
        background: #1a1a2e;
      }
      
      .info-card {
        background: #16213e;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      
      .label {
        color: #e1e8ff;
      }
      
      .value {
        color: #a8b4c8;
      }
      
      .search-field {
        background: #16213e;
      }
    }
  `]
})
export class SelectorUbicacionComponent implements OnInit, OnDestroy {
  
  private mapa!: L.Map;
  private marcadorActual?: L.Marker;
  
  textoBusqueda: string = '';
  buscando: boolean = false;
  obteniendo: boolean = false;
  ubicacionSeleccionada?: UbicacionSeleccionada;

  constructor(
    private dialogRef: MatDialogRef<SelectorUbicacionComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { ubicacionInicial?: UbicacionSeleccionada }
  ) {}

  ngOnInit(): void {
    setTimeout(() => this.inicializarMapa(), 100);
  }

  ngOnDestroy(): void {
    if (this.mapa) {
      this.mapa.remove();
    }
  }

  private inicializarMapa(): void {
    // Configurar iconos de Leaflet
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    });

    // Coordenadas iniciales (Madrid o ubicación proporcionada)
    const latInicial = this.data?.ubicacionInicial?.latitud || 40.4168;
    const lngInicial = this.data?.ubicacionInicial?.longitud || -3.7038;

    // Crear el mapa
    this.mapa = L.map('mapa-selector').setView([latInicial, lngInicial], 10);

    // Añadir capa de OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.mapa);

    // Si hay ubicación inicial, mostrar marcador
    if (this.data?.ubicacionInicial) {
      this.colocarMarcador(latInicial, lngInicial);
      this.ubicacionSeleccionada = this.data.ubicacionInicial;
    }

    // Evento click en el mapa
    this.mapa.on('click', (e: L.LeafletMouseEvent) => {
      this.colocarMarcador(e.latlng.lat, e.latlng.lng);
      this.buscarDireccionReversa(e.latlng.lat, e.latlng.lng);
    });
  }

  private colocarMarcador(lat: number, lng: number): void {
    // Remover marcador anterior si existe
    if (this.marcadorActual) {
      this.mapa.removeLayer(this.marcadorActual);
    }

    // Crear nuevo marcador
    this.marcadorActual = L.marker([lat, lng]).addTo(this.mapa);

    // Actualizar ubicación seleccionada
    this.ubicacionSeleccionada = {
      latitud: lat,
      longitud: lng,
      direccion: this.ubicacionSeleccionada?.direccion // Mantener dirección si existe
    };
  }

  async buscarDireccion(): Promise<void> {
    if (!this.textoBusqueda.trim()) return;

    this.buscando = true;
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(this.textoBusqueda)}&limit=1&addressdetails=1`
      );
      const data = await response.json();

      if (data && data.length > 0) {
        const resultado = data[0];
        const lat = parseFloat(resultado.lat);
        const lng = parseFloat(resultado.lon);

        // Centrar mapa y colocar marcador
        this.mapa.setView([lat, lng], 15);
        this.colocarMarcador(lat, lng);

        // Actualizar información
        this.ubicacionSeleccionada = {
          latitud: lat,
          longitud: lng,
          direccion: resultado.display_name,
          nombreLugar: resultado.name || this.textoBusqueda
        };
      } else {
        alert('No se encontraron resultados para la búsqueda');
      }
    } catch (error) {
      console.error('Error en búsqueda:', error);
      alert('Error al buscar la dirección');
    } finally {
      this.buscando = false;
    }
  }

  private async buscarDireccionReversa(lat: number, lng: number): Promise<void> {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`
      );
      const data = await response.json();

      if (data && data.display_name) {
        this.ubicacionSeleccionada = {
          latitud: lat,
          longitud: lng,
          direccion: data.display_name,
          nombreLugar: data.name
        };
      }
    } catch (error) {
      console.error('Error en búsqueda reversa:', error);
      // No mostrar error al usuario, mantener solo coordenadas
    }
  }

  obtenerUbicacionActual(): void {
    if (!navigator.geolocation) {
      alert('Geolocalización no soportada en este navegador');
      return;
    }

    this.obteniendo = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        this.mapa.setView([lat, lng], 15);
        this.colocarMarcador(lat, lng);
        this.buscarDireccionReversa(lat, lng);

        this.obteniendo = false;
      },
      (error) => {
        console.error('Error obteniendo ubicación:', error);
        alert('Error al obtener ubicación actual: ' + error.message);
        this.obteniendo = false;
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }

  centrarEnEspana(): void {
    this.mapa.setView([40.4168, -3.7038], 6);
  }

  confirmarSeleccion(): void {
    if (this.ubicacionSeleccionada) {
      this.dialogRef.close(this.ubicacionSeleccionada);
    }
  }

  cerrar(): void {
    this.dialogRef.close(null);
  }
}