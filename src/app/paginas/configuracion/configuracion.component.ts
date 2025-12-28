import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog } from '@angular/material/dialog';
import { ArchivoService } from '../../servicios/archivo.service';
import { ConfirmDialogComponent } from '../../componentes/confirm-dialog.component';

@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [
    RouterModule, 
    CommonModule,
    MatProgressBarModule
  ],
  templateUrl: './configuracion.component.html',
  styleUrl: './configuracion.component.scss'
})
export class ConfiguracionComponent {
  procesando = false;

  constructor(
    private archivoService: ArchivoService,
    private dialog: MatDialog
  ) {}

  async procesarGeolocalizacionMasiva(): Promise<void> {
    // Mostrar confirmación
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        titulo: 'Procesamiento Masivo de Geolocalización',
        mensaje: '¿Estás seguro de extraer la geolocalización GPS de TODAS las fotos? Este proceso puede tardar varios minutos.',
        textoAceptar: 'Sí, procesar',
        textoCancelar: 'Cancelar'
      }
    });

    const confirmar = await dialogRef.afterClosed().toPromise();
    
    if (!confirmar) {
      return;
    }

    this.procesando = true;

    this.archivoService.procesarGeolocalizacionMasiva().subscribe({
      next: (resultado) => {
        console.log('✅ Resultado del procesamiento:', resultado);
        this.procesando = false;
        
        this.mostrarResultados(resultado);
      },
      error: (error) => {
        console.error('❌ Error en procesamiento masivo:', error);
        this.procesando = false;
        
        alert(`❌ Error: ${error.error?.error || error.message || 'Error desconocido'}`);
      }
    });
  }

  private mostrarResultados(resultado: any): void {
    const mensaje = `
📊 Procesamiento completado:

✅ Archivos procesados: ${resultado.procesados}/${resultado.total}
🌍 Actualizados con GPS: ${resultado.actualizados}
❌ Sin datos GPS: ${resultado.sinGPS}
⚠️ Errores: ${resultado.errores}
    `.trim();

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '450px',
      data: {
        titulo: 'Procesamiento Completado',
        mensaje: mensaje,
        textoAceptar: 'Ver detalles',
        textoCancelar: 'Cerrar'
      }
    });

    dialogRef.afterClosed().subscribe(verDetalles => {
      if (verDetalles && resultado.detalles?.length > 0) {
        console.log('📋 Detalles completos:', resultado.detalles);
        
        // Opcional: Mostrar listado detallado
        const archivosActualizados = resultado.detalles
          .filter((d: any) => d.estado === 'actualizado')
          .map((d: any) => `✅ ${d.nombre}`)
          .join('\n');
        
        if (archivosActualizados) {
          alert(`Archivos actualizados:\n\n${archivosActualizados.substring(0, 500)}${archivosActualizados.length > 500 ? '\n...' : ''}`);
        }
      }
    });
  }
}