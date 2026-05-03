import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Archivo } from '../../../modelos/archivo';

@Component({
  selector: 'app-archivo-thumbnail',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './archivo-thumbnail.component.html',
  styleUrls: ['./archivo-thumbnail.component.scss']
})
export class ArchivoThumbnailComponent {
  @Input() archivo!: Archivo;
  @Input() fileUrl: string = '';
  @Input() compact: boolean = false;
  
  @Output() clickMedia = new EventEmitter<Archivo>();
  @Output() imageError = new EventEmitter<any>();

  onMediaClick(): void {
    this.clickMedia.emit(this.archivo);
  }

  onImgError(event: any): void {
    this.imageError.emit(event);
  }

  getFileExtension(filename: string): string {
    if (!filename) return '';
    return filename.split('.').pop()?.toLowerCase() || '';
  }
}
