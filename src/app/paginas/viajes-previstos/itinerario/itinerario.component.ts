import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router'; // Importa RouterModule
import { ItinerarioService } from '../../../servicios/itinerario.service';
import { Itinerario } from '../../../modelos/viaje-previsto.model';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-itinerarios',
  standalone: true,
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    RouterModule  // Asegúrate de importar RouterModule aquí
  ],
  templateUrl: './itinerario.component.html',
  styleUrls: ['./itinerario.component.scss']
})
export class ItinerariosComponent implements OnInit {

  itinerarios: Itinerario[] = [];
  viajePrevistoId!: number;

  // Este objeto se usará para capturar los valores del itinerario en el formulario de actualización
  itinerarioActualizado: Itinerario = {
    id: 0,
    viajePrevistoId: 0,
    fechaInicio: '',
    fechaFin: '',
    duracionDias: 0,
    destinosPorDia: '',
    descripcionGeneral: '',
    horaInicio: '',
    horaFin: '',
    climaGeneral: '',
    tipoDeViaje: 'costa'
  };

  constructor(
    private itinerarioService: ItinerarioService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const idParam = params.get('viajePrevistoId');
      if (idParam) {
        this.viajePrevistoId = +idParam;
        this.cargarItinerarios();
      }
    });
  }

  cargarItinerarios(): void {
    this.itinerarioService.getItinerarios(this.viajePrevistoId).subscribe(itinerarios => {
      this.itinerarios = itinerarios;
    });
  }

  agregarItinerario(): void {
    const itinerarioAEnviar = { ...this.itinerarioActualizado, viajePrevistoId: this.viajePrevistoId };
    this.itinerarioService.crearItinerario(itinerarioAEnviar).subscribe(nuevo => {
      this.itinerarios.push(nuevo);
      this.resetearFormulario();
    });
  }

  eliminarItinerario(id: number): void {
    this.itinerarioService.eliminarItinerario(id).subscribe(() => {
      this.itinerarios = this.itinerarios.filter(it => it.id !== id);
    });
  }

  // Método que se activa cuando se hace clic en el botón "Actualizar"
  actualizarItinerario(itinerario: Itinerario): void {
    this.itinerarioActualizado = { ...itinerario }; // Copia el itinerario a editar en el formulario
    console.log('Itinerario listo para actualizar:', this.itinerarioActualizado);
  }

  // Método que maneja el envío del itinerario actualizado
  guardarActualizacion(): void {
    this.itinerarioService.actualizarItinerario(this.itinerarioActualizado.id, this.itinerarioActualizado).subscribe(() => {
      console.log('Itinerario actualizado correctamente');
      this.cargarItinerarios(); // Vuelve a cargar los itinerarios para reflejar el cambio
      this.resetearFormulario();
    });
  }


  verActividades(itinerario: any) {
    console.log('Ver actividades del itinerario:', itinerario);
    if (itinerario && itinerario.viajePrevistoId != null && itinerario.id != null) {
      this.router.navigate(['/viajes-previstos', itinerario.viajePrevistoId, 'itinerarios', itinerario.id, 'actividades']);
    } else {
      console.error('Faltan datos para navegar a actividades');
    }}
  
  agregarActividad(itinerario: any): void {
    console.log('Agregar actividad al itinerario:', itinerario);
    this.router.navigate([
      '/formulario-actividad',
      this.viajePrevistoId,
      itinerario.id,
      0  // id de la actividad = 0 para nueva
    ]);
  }
  
  

  volverAViajes(): void {
    this.router.navigate(['/viajes-previstos']);
  }

  // Método para resetear el formulario
  private resetearFormulario(): void {
    this.itinerarioActualizado = {
      id: 0,
      viajePrevistoId: this.viajePrevistoId,
      fechaInicio: '',
      fechaFin: '',
      duracionDias: 0,
      destinosPorDia: '',
      descripcionGeneral: '',
      horaInicio: '',
      horaFin: '',
      climaGeneral: '',
      tipoDeViaje: 'costa'
    };
  }

  cancelarActualizacion(): void {
    this.itinerarioActualizado = {
      id: 0,
      viajePrevistoId: this.viajePrevistoId,
      fechaInicio: '',
      fechaFin: '',
      duracionDias: 0,
      destinosPorDia: '',
      descripcionGeneral: '',
      horaInicio: '',
      horaFin: '',
      climaGeneral: '',
      tipoDeViaje: 'costa'
    };
  }
  
}
