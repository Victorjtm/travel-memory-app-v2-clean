import { Component, Inject } from '@angular/core';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';


@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule], // <- IMPORTANTE
  template: `
    <h2 mat-dialog-title>{{data.titulo}}</h2>
    <mat-dialog-content><p>{{data.mensaje}}</p></mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancelarClick()">{{data.textoCancelar || 'Cancelar'}}</button>
      <button mat-raised-button color="primary" (click)="onAceptarClick()">{{data.textoAceptar || 'Aceptar'}}</button>
    </mat-dialog-actions>
  `
})
export class ConfirmDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { titulo: string; mensaje: string; textoAceptar?: string; textoCancelar?: string }
  ) {}

  onCancelarClick(): void {
    this.dialogRef.close(false);
  }

  onAceptarClick(): void {
    this.dialogRef.close(true);
  }
}
