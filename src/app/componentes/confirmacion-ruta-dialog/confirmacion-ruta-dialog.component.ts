import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export interface DialogConfirmacionRutaData {
  titulo?: string;
  nombreViaje: string;
}

@Component({
  selector: 'app-confirmacion-ruta-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  template: `
    <div class="confirm-dialog-wrap">
      <div class="header-icon">
        <i class="fa-solid fa-map-location-dot"></i>
      </div>

      <h2 mat-dialog-title class="dialog-title">Viaje Rápido Creado</h2>

      <mat-dialog-content class="dialog-body">
        <p class="viaje-badge-info">
          Se ha creado el borrador: <br/>
          <strong>{{ data.nombreViaje }}</strong>
        </p>
        <p class="pregunta-destacada">
          ¿Quieres editar la ruta en el mapa a mano ahora mismo?
        </p>
      </mat-dialog-content>

      <mat-dialog-actions align="end" class="dialog-actions">
        <button mat-button class="btn-cancelar" (click)="cerrar(false)">
          <i class="fa-solid fa-clock"></i> Más tarde
        </button>
        <button mat-flat-button class="btn-confirmar" (click)="cerrar(true)">
          <i class="fa-solid fa-pencil"></i> Sí, trazar ruta ahora
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .confirm-dialog-wrap {
      padding: 1.25rem 0.5rem 0.5rem;
      text-align: center;
      font-family: inherit;
    }
    .header-icon {
      font-size: 2.8rem;
      color: #3b82f6;
      margin-bottom: 0.75rem;
      animation: pulse 1.5s infinite alternate ease-in-out;
    }
    @keyframes pulse {
      from { transform: scale(1); }
      to { transform: scale(1.08); }
    }
    .dialog-title {
      font-size: 1.4rem;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 0.5rem 0;
    }
    .dialog-body {
      color: #334155;
      font-size: 1rem;
      line-height: 1.5;
      padding: 0 0.5rem;
    }
    .viaje-badge-info {
      background: #f1f5f9;
      padding: 0.6rem 0.8rem;
      border-radius: 8px;
      font-size: 0.95rem;
      color: #475569;
      margin-bottom: 1rem;
      border-left: 4px solid #3b82f6;
    }
    .viaje-badge-info strong {
      color: #1e293b;
    }
    .pregunta-destacada {
      font-size: 1.15rem;
      font-weight: 600;
      color: #1e3a8a;
      margin: 1.2rem 0 0.5rem;
    }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      margin-top: 1.5rem;
      padding-top: 0.75rem;
      border-top: 1px solid #e2e8f0;
    }
    .btn-cancelar {
      color: #64748b !important;
      font-weight: 500;
    }
    .btn-cancelar:hover {
      background-color: #f1f5f9 !important;
      color: #334155 !important;
    }
    .btn-confirmar {
      background-color: #2563eb !important;
      color: #ffffff !important;
      font-weight: 600;
      border-radius: 6px;
      padding: 0 1.25rem;
    }
    .btn-confirmar:hover {
      background-color: #1d4ed8 !important;
    }
  `]
})
export class ConfirmacionRutaDialogComponent {
  private dialogRef = inject(MatDialogRef<ConfirmacionRutaDialogComponent>);
  public data: DialogConfirmacionRutaData = inject(MAT_DIALOG_DATA);

  cerrar(quiereEditarAhora: boolean): void {
    this.dialogRef.close(quiereEditarAhora);
  }
}
