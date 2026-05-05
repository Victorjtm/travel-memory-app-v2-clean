import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Archivo } from '../../../modelos/archivo';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-archivo-thumbnail',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './archivo-thumbnail.component.html',
  styleUrls: ['./archivo-thumbnail.component.scss']
})
export class ArchivoThumbnailComponent implements OnInit {
  @Input() archivo!: Archivo;
  @Input() fileUrl: string = '';
  @Input() compact: boolean = false;
  
  @Output() clickMedia = new EventEmitter<Archivo>();
  @Output() imageError = new EventEmitter<any>();

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    // Si es vídeo y no tiene poster, intentamos generarlo desde el cliente una sola vez
    if (this.archivo.tipo === 'video' && !this.archivo.urlPoster && this.fileUrl) {
      this.generarPosterDesdeCliente();
    }
  }

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

  getServerUrl(): string {
    return environment.apiUrl;
  }

  /**
   * Captura un frame del vídeo y lo envía al servidor para persistirlo
   */
  private generarPosterDesdeCliente(): void {
    const video = document.createElement('video');
    video.src = this.fileUrl;
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      // Ir al segundo 1 para capturar el frame
      video.currentTime = 1;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          
          // Enviar al servidor
          this.http.post<any>(`${environment.apiUrl}/archivos/${this.archivo.id}/poster-cliente`, {
            imageBase64: dataUrl
          }).subscribe({
            next: (res) => {
              if (res.success) {
                console.log(`✅ Miniatura generada y guardada para archivo ${this.archivo.id}`);
                this.archivo.urlPoster = res.urlPoster;
              }
            }
          });
        }
      } catch (e) {
        console.warn('No se pudo capturar miniatura de vídeo:', e);
      }
    };

    video.onerror = (e) => {
      console.warn('Error cargando vídeo para miniatura:', e);
    };
  }
}
