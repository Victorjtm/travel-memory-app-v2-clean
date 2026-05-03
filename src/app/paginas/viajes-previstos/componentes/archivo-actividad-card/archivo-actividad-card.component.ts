import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Archivo } from '../../../../modelos/archivo';
import { ArchivoThumbnailComponent } from '../../../../componentes/compartidos/archivo-thumbnail/archivo-thumbnail.component';

@Component({
  selector: 'app-archivo-actividad-card',
  standalone: true,
  imports: [CommonModule, RouterModule, ArchivoThumbnailComponent],
  templateUrl: './archivo-actividad-card.component.html',
  styleUrls: ['./archivo-actividad-card.component.scss']
})
export class ArchivoActividadCardComponent {
  @Input() archivo!: Archivo;
  @Input() modoGaleria: boolean = false;
  @Input() fileUrl: string = '';
  @Input() direccionDisplay: string = '';
  
  // IDs para navegación
  @Input() viajePrevistoId!: number;
  @Input() itinerarioId!: number;
  @Input() actividadId!: number;

  @Output() preview = new EventEmitter<Archivo>();
  @Output() delete = new EventEmitter<number>();
  @Output() download = new EventEmitter<number>();
  @Output() searchAudio = new EventEmitter<Archivo>();
  @Output() openAssociated = new EventEmitter<{archivo: Archivo, tipo: 'audio' | 'texto' | 'mapa_ubicacion' | 'gpx' | 'manifest' | 'estadisticas'}>();
  @Output() playAudioPrincipal = new EventEmitter<Archivo>();

  onPreview(): void {
    this.preview.emit(this.archivo);
  }

  onDelete(): void {
    this.delete.emit(this.archivo.id);
  }

  onDownload(): void {
    this.download.emit(this.archivo.id);
  }

  onSearchAudio(): void {
    this.searchAudio.emit(this.archivo);
  }

  onOpenAssociated(tipo: 'audio' | 'texto' | 'mapa_ubicacion' | 'gpx' | 'manifest' | 'estadisticas'): void {
    this.openAssociated.emit({archivo: this.archivo, tipo});
  }

  onPlayAudioPrincipal(): void {
    this.playAudioPrincipal.emit(this.archivo);
  }

  tieneArchivoAsociado(tipo: 'audio' | 'texto' | 'mapa_ubicacion' | 'gpx' | 'manifest' | 'estadisticas'): boolean {
    return !!this.archivo.archivosAsociados?.some((a) => a.tipo === tipo);
  }

  tieneArchivosAsociados(): boolean {
    return !!this.archivo.archivosAsociados?.length;
  }
}
