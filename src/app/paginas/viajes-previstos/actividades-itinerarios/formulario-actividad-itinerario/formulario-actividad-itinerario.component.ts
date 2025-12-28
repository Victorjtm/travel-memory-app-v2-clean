import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TiposActividadService } from '../../../../servicios/tipos-actividad.service';
import { ActividadesDisponiblesService } from '../../../../servicios/actividades-disponibles.service';
import { ActividadesItinerariosService } from '../../../../servicios/actividades-itinerarios.service';
import { ItinerarioService } from '../../../../servicios/itinerario.service';

@Component({
  selector: 'app-formulario-actividad-itinerario',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule
  ],
  templateUrl: './formulario-actividad-itinerario.component.html',
  styleUrls: ['./formulario-actividad-itinerario.component.scss']
})
export class FormularioActividadItinerarioComponent implements OnInit {
  viajePrevistoId!: number;
  itinerarioId!: number;
  actividadId!: number;

  actividad: any = {
    id: 0,
    viajePrevistoId: 0,
    itinerarioId: 0,
    tipoActividadId: 0,
    actividadDisponibleId: null,
    nombre: '',
    descripcion: '',
    horaInicio: '00:00',
    horaFin: '23:59'
  };

  tiposActividad: any[] = [];
  actividadesDisponibles: any[] = [];
  tipoActividadSeleccionado: number | null = null;
  itinerarioInfo: any = null; // Para almacenar info del itinerario

constructor(
  private route: ActivatedRoute,
  private router: Router,
  private tiposActividadService: TiposActividadService,
  private actividadesDisponiblesService: ActividadesDisponiblesService,
  private actividadesItinerariosService: ActividadesItinerariosService,
  private itinerarioService: ItinerarioService
) {}

ngOnInit(): void {
  this.route.params.subscribe(params => {
    this.viajePrevistoId = +params['viajePrevistoId'];
    this.itinerarioId = +params['itinerarioId'];
    const actividadIdParam = params['actividadId'];

    if (actividadIdParam === 'nuevo') {
      // Modo creación: cargar valores por defecto
      this.actividadId = 0;
      this.actividad = {
        id: 0,
        viajePrevistoId: this.viajePrevistoId,
        itinerarioId: this.itinerarioId,
        tipoActividadId: 0,
        actividadDisponibleId: null,
        nombre: '',
        descripcion: '',
        horaInicio: '00:00',
        horaFin: '23:59'
      };
      this.cargarValoresPorDefecto();
    } else {
      this.actividadId = +actividadIdParam;
      this.actividad.viajePrevistoId = this.viajePrevistoId;
      this.actividad.itinerarioId = this.itinerarioId;
      if (this.actividadId) {
        this.cargarActividadExistente();
      }
    }

    this.cargarTiposActividad();
  });
}

cargarTiposActividad(): void {
  // Solo cargar si no es modo creación (ya se carga en cargarValoresPorDefecto)
  if (this.actividadId !== 0) {
    this.tiposActividadService.getTiposActividad().subscribe(
      (tipos) => {
        this.tiposActividad = tipos;
      },
      (error) => {
        console.error('Error cargando tipos de actividad:', error);
      }
    );
  }
}

  cargarActividadesDisponibles(): void {
    if (this.tipoActividadSeleccionado) {
      this.actividad.tipoActividadId = this.tipoActividadSeleccionado;

      this.actividadesDisponiblesService.getActividadesDisponibles(this.tipoActividadSeleccionado).subscribe(
        (actividades) => {
          this.actividadesDisponibles = actividades;
        },
        (error) => {
          console.error('Error cargando actividades disponibles:', error);
        }
      );
    }
  }

  actualizarCamposDesdeActividad(): void {
    const actividadSeleccionada = this.actividadesDisponibles.find(
      a => a.id === this.actividad.actividadDisponibleId
    );

    if (actividadSeleccionada) {
      if (!this.actividad.nombre) {
        this.actividad.nombre = actividadSeleccionada.descripcion.substring(0, 30);
      }
      if (!this.actividad.descripcion) {
        this.actividad.descripcion = actividadSeleccionada.descripcion;
      }
    }
  }

  cargarActividadExistente(): void {
    this.actividadesItinerariosService.getById(this.actividadId).subscribe(
      (actividad) => {
        this.actividad = actividad;
        this.tipoActividadSeleccionado = actividad.tipoActividadId;
        this.cargarActividadesDisponibles();
      },
      (error) => {
        console.error('Error cargando actividad:', error);
      }
    );
  }

  guardarActividad(): void {
    if (this.actividad.id) {
      this.actividadesItinerariosService.update(this.actividad.id, this.actividad).subscribe(
        () => {
          this.router.navigate(['/itinerarios', this.viajePrevistoId]);
        },
        (error) => {
          console.error('Error actualizando actividad:', error);
        }
      );
    } else {
      this.actividadesItinerariosService.create(this.actividad).subscribe(
        () => {
          this.router.navigate(['/itinerarios', this.viajePrevistoId]);
        },
        (error) => {
          console.error('Error creando actividad:', error);
        }
      );
    }
  }

  cancelar(): void {
    this.router.navigate(['/itinerarios', this.viajePrevistoId]);
  }

  // Nuevo método para cargar información del itinerario
cargarInfoItinerario(): void {
  this.itinerarioService.getById(this.itinerarioId).subscribe(
    (itinerario) => {
      this.itinerarioInfo = itinerario;
      
      if (itinerario) {
        // destinosPorDia viene como JSON string desde la BD, hay que parsearlo
        let destinosTexto = '';
        
        try {
          if (itinerario.destinosPorDia) {
            const destinosArray = JSON.parse(itinerario.destinosPorDia);
            // Si es un array, unir con comas. Si es string, usar directamente
            destinosTexto = Array.isArray(destinosArray) 
              ? destinosArray.join(', ') 
              : destinosArray.toString();
          }
        } catch (e) {
          // Si falla el parse, usar como string directamente
          destinosTexto = itinerario.destinosPorDia || '';
        }
        
        // Usar destinos o descripción general como nombre de la actividad
        if (destinosTexto) {
          this.actividad.nombre = destinosTexto;
        } else if (itinerario.descripcionGeneral) {
          this.actividad.nombre = itinerario.descripcionGeneral;
        } else {
          this.actividad.nombre = 'Actividad de relajación';
        }
      } else {
        this.actividad.nombre = 'Actividad de relajación';
      }
    },
    (error) => {
      console.error('Error cargando información del itinerario:', error);
      // Valor por defecto si falla la carga
      this.actividad.nombre = 'Actividad de relajación';
    }
  );
}

  // Nuevo método para establecer valores por defecto
  cargarValoresPorDefecto(): void {
    this.cargarInfoItinerario();
    
    // Buscar el tipo "Relax / Bienestar" cuando se carguen los tipos
    this.tiposActividadService.getTiposActividad().subscribe(
      (tipos) => {
        this.tiposActividad = tipos;
        
        // Buscar el tipo "Relax / Bienestar"
        const tipoRelax = tipos.find(tipo => 
          tipo.nombre.toLowerCase().includes('relax') || 
          tipo.nombre.toLowerCase().includes('bienestar')
        );
        
        if (tipoRelax) {
          this.tipoActividadSeleccionado = tipoRelax.id;
          this.actividad.tipoActividadId = tipoRelax.id;
          
          // Cargar actividades disponibles para este tipo
          this.actividadesDisponiblesService.getActividadesDisponibles(tipoRelax.id).subscribe(
            (actividades) => {
              this.actividadesDisponibles = actividades;
              
              // Buscar "Dedicar la tarde a relajarse sin planes fijos ni estrés"
              const actividadRelax = actividades.find(act =>
                act.descripcion.toLowerCase().includes('relajarse') ||
                act.descripcion.toLowerCase().includes('sin planes')
              );
              
              if (actividadRelax) {
                this.actividad.actividadDisponibleId = actividadRelax.id;
                this.actividad.descripcion = actividadRelax.descripcion;
              }
            },
            (error) => {
              console.error('Error cargando actividades por defecto:', error);
            }
          );
        }
      },
      (error) => {
        console.error('Error cargando tipos de actividad:', error);
      }
    );
  }
}
