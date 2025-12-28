import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ViajesPrevistosService } from '../../../servicios/viajes-previstos.service';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-formulario-viaje-previsto',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './formulario-viaje-previsto.component.html',
  styleUrls: ['./formulario-viaje-previsto.component.scss']
})

export class FormularioViajePrevistoComponent implements OnInit, OnDestroy {
  viaje = { 
    nombre: '', 
    destino: '', 
    fecha_inicio: '', 
    fecha_fin: '', 
    descripcion: '',
    imagen: '',
    audio: ''
  };

  viajeId: number | null = null; // ID del viaje en edición
  viajeSubscription: Subscription | null = null;
  imagenSeleccionada: File | undefined;
  imagenPrevia: string | null = null;
  audioSeleccionado: File | undefined;
  audioActual: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private viajesPrevistosService: ViajesPrevistosService
  ) {}

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');

    if (idParam && idParam !== 'nuevo') {
      // 🔄 Modo edición
      this.viajeId = +idParam;
      console.log('🔄 Cargando viaje ID:', this.viajeId);

      this.viajeSubscription = this.viajesPrevistosService.obtenerViaje(this.viajeId).subscribe(
        (viaje) => {
          console.log('📋 Viaje recibido del backend:', viaje);
          if (viaje) {
this.viaje = { 
  nombre: viaje.nombre || '',
  destino: viaje.destino || '',
  fecha_inicio: viaje.fecha_inicio || '',
  fecha_fin: viaje.fecha_fin || '',
  descripcion: viaje.descripcion || '',
  imagen: viaje.imagen || '',
  audio: viaje.audio || ''
};
if (viaje.audio_url) {
  this.audioActual = viaje.audio_url;
  console.log('🎵 Audio actual cargado:', this.audioActual);
}
            if (viaje.imagen_url) {
              this.imagenPrevia = viaje.imagen_url;
              console.log('🖼️ Imagen previa cargada:', this.imagenPrevia);
            }
          }
        },
        (error) => {
          console.error('❌ Error al obtener el viaje:', error);
          alert('Error al cargar el viaje. Por favor, intenta nuevamente.');
        }
      );
    } else {
      // ➕ Modo creación
      console.log('➕ Modo creación de nuevo viaje');
      this.viajeId = null;
    }
  }

  ngOnDestroy(): void {
    if (this.viajeSubscription) {
      this.viajeSubscription.unsubscribe();
      this.viajeSubscription = null;
    }
  }

onFileSelected(event: any): void {
  const file = event.target.files[0];
  if (file) {
    if (!file.type.startsWith('image/')) {
      alert('Por favor, selecciona solo archivos de imagen');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e: any) => {
      const img = new Image();
      img.onload = () => {
        const MAX_WIDTH = 1024;   // 📏 ancho máximo para portada
        const MAX_HEIGHT = 768;   // 📏 alto máximo (opcional)
        let width = img.width;
        let height = img.height;

        // 🔄 Ajustamos proporción al máximo permitido
        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round((width * MAX_HEIGHT) / height);
            height = MAX_HEIGHT;
          }
        }

        // 🎨 Redibujamos en canvas
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        // 🖼️ Guardamos la versión reducida para previsualización
        this.imagenPrevia = canvas.toDataURL('image/jpeg', 0.8); // calidad 80%

        // 📂 Convertimos a File optimizado para subir
        canvas.toBlob((blob) => {
          if (blob) {
            this.imagenSeleccionada = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
            console.log("✅ Imagen preparada:", this.imagenSeleccionada);
          }
        }, "image/jpeg", 0.8);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  } else {
    this.imagenSeleccionada = undefined;
  }
}


eliminarImagen(): void {
  this.imagenSeleccionada = undefined;
  this.imagenPrevia = null;

  if (this.viajeId !== null) {
    this.viaje.imagen = '';
  }

  const fileInput = document.getElementById('imagen') as HTMLInputElement;
  if (fileInput) {
    fileInput.value = '';
  }
}

onAudioSelected(event: any): void {
  const file = event.target.files[0];
  if (file) {
    // Verificar que sea un archivo de audio
    if (!file.type.startsWith('audio/')) {
      alert('Por favor, selecciona solo archivos de audio');
      event.target.value = '';
      return;
    }

    // Verificar tamaño del archivo (máximo 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB en bytes
    if (file.size > maxSize) {
      alert('El archivo de audio es demasiado grande. Máximo 10MB.');
      event.target.value = '';
      return;
    }

    this.audioSeleccionado = file;
    console.log('🎵 Audio seleccionado:', file.name);
  } else {
    this.audioSeleccionado = undefined;
  }
}

eliminarAudio(): void {
  this.audioSeleccionado = undefined;
  this.audioActual = null;

  if (this.viajeId !== null) {
    this.viaje.audio = '';
  }

  const fileInput = document.getElementById('audio') as HTMLInputElement;
  if (fileInput) {
    fileInput.value = '';
  }
}

  guardar(): void {
    if (this.viajeId !== null) {
      // 🔄 Actualizar viaje
      this.viajesPrevistosService.actualizarViaje(this.viajeId, this.viaje, this.imagenSeleccionada, this.audioSeleccionado).subscribe(
        () => this.router.navigate(['/viajes-previstos']),
        (error) => {
          console.error('Error al actualizar el viaje', error);
          alert('Error al actualizar el viaje. Por favor, intenta nuevamente.');
        }
      );
    } else {
      // ➕ Crear nuevo viaje
      this.viajesPrevistosService.crearViaje(this.viaje, this.imagenSeleccionada, this.audioSeleccionado).subscribe(
        () => this.router.navigate(['/viajes-previstos']),
        (error) => {
          console.error('Error al crear el viaje', error);
          alert('Error al crear el viaje. Por favor, intenta nuevamente.');
        }
      );
    }
  }
} // 👈 Añade esta llave de cierre aquí
