import { Component, Input, Output, EventEmitter } from '@angular/core';
import { Archivo } from '../../modelos/archivo';
import { CommonModule } from '@angular/common';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-visor-archivo',
  standalone: true,
  imports: [CommonModule, FontAwesomeModule], // Asegúrate de tener FontAwesomeModule instalado
  templateUrl: './visor-archivo.component.html',
  styleUrls: ['./visor-archivo.component.scss']
})
export class VisorArchivoComponent {
  @Input() archivo!: Archivo;
  @Output() cerrarVisor = new EventEmitter<void>();

  getFileUrl(archivo: Archivo): string {
    const nombre = archivo.rutaArchivo.split(/[\\/]/).pop();
    return `${environment.apiUrl}/uploads/${nombre}`;
  }

  getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toLowerCase() || '';
  }

  cerrar(): void {
    this.cerrarVisor.emit();
  }
}