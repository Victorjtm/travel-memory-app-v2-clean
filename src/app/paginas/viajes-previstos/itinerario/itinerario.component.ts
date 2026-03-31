import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
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
  filtroInicio: string | null = null;
  filtroFin: string | null = null;
  itinerariosCompletos: Itinerario[] = [];

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
    private router: Router,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    // Escuchar parámetros de ruta (ID del viaje)
    this.route.paramMap.subscribe(params => {
      const idParam = params.get('viajePrevistoId');
      if (idParam) {
        this.viajePrevistoId = +idParam;

        // Escuchar parámetros de consulta (filtros de fecha)
        this.route.queryParamMap.subscribe(queryParams => {
          this.filtroInicio = queryParams.get('inicio');
          let fFin = queryParams.get('fin');
          
          if (this.filtroInicio && fFin && (this.filtroInicio === fFin || fFin.endsWith('00:00:00'))) {
              fFin = fFin.substring(0, 10) + ' 23:59:59';
          }
          
          this.filtroFin = fFin;
          console.log('[FILTER] Fechas detectadas:', { inicio: this.filtroInicio, fin: this.filtroFin });

          this.cargarItinerarios();
        });
      }
    });
  }

  cargarItinerarios(): void {
    this.itinerarioService.getItinerarios(this.viajePrevistoId).subscribe(itinerarios => {
      this.itinerariosCompletos = itinerarios;
      this.aplicarFiltro();
      this.checkDuplicados();
    });
  }

  aplicarFiltro(): void {
    if (this.filtroInicio && this.filtroFin) {
      this.itinerarios = this.itinerariosCompletos.filter(it => {
        // Normalizar fechas para comparar solo la parte YYYY-MM-DD (los primeros 10 caracteres)
        const itInicio = it.fechaInicio ? it.fechaInicio.substring(0, 10) : '';
        const itFin = it.fechaFin ? it.fechaFin.substring(0, 10) : '';
        const filtroI = this.filtroInicio!.substring(0, 10);
        const filtroF = this.filtroFin!.substring(0, 10);

        return itInicio >= filtroI && itFin <= filtroF;
      });
      console.log(`[FILTER] Itinerarios filtrados (${this.itinerarios.length}/${this.itinerariosCompletos.length})`);
    } else {
      this.itinerarios = [...this.itinerariosCompletos];
    }
  }

  limpiarFiltro(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { inicio: null, fin: null },
      queryParamsHandling: 'merge'
    });
  }

  hayDuplicados: boolean = false;

  checkDuplicados(): void {
    if (!this.itinerarios || this.itinerarios.length === 0) {
      this.hayDuplicados = false;
      return;
    }

    const fechas = this.itinerarios.map(it => {
      // Normalizar a YYYY-MM-DD
      if (!it.fechaInicio) return '';
      return it.fechaInicio.split('T')[0].split(' ')[0].trim();
    });

    console.log('📅 Fechas detectadas para unificación:', fechas);

    const counts: { [key: string]: number } = {};
    fechas.forEach(f => {
      if (f) counts[f] = (counts[f] || 0) + 1;
    });

    const duplicados = Object.keys(counts).filter(f => counts[f] > 1);
    this.hayDuplicados = duplicados.length > 0;

    console.log('🔍 ¿Hay duplicados?:', this.hayDuplicados, duplicados);
    this.cdr.detectChanges();
  }

  unificarMismoDia(): void {
    // Usamos un modal nativo simple para la elección
    const mensaje = `Se han detectado itinerarios duplicados.\n\n` +
      `Elija la opción de unificación:\n` +
      `A) Mantener actividades separadas por hora (Clustering > 30min).\n` +
      `B) Una sola actividad genérica para todo el día (00:00-23:59).`;

    const eleccion = window.prompt(mensaje, 'A');

    if (eleccion === null) return; // Cancelado

    const opcion = eleccion.toUpperCase() as 'A' | 'B';
    if (opcion !== 'A' && opcion !== 'B') {
      alert("Opción no válida. Use 'A' o 'B'.");
      return;
    }

    this.itinerarioService.unificarItinerarios(this.viajePrevistoId, opcion).subscribe({
      next: (res: any) => {
        console.log('Unificación exitosa:', res);
        
        let msg = `🧹 ¡Unificación completada!\n\n` +
                 `• Itinerarios eliminados: ${res.itinerariosEliminados}\n` +
                 `• Actividades creadas: ${res.actividadesCreadas}\n`;
        
        if (res.archivosOmitidosCount > 0) {
          msg += `• Archivos omitidos (duplicados): ${res.archivosOmitidosCount}\n\n` +
                 `LISTA DE ARCHIVOS OMITIDOS (Cópiala si la necesitas):\n` +
                 `--------------------------------------------------\n` +
                 res.listaOmitidos.join('\n') +
                 `\n--------------------------------------------------`;
          
          // Opcional: copiar al portapapeles automáticamente
          try {
            navigator.clipboard.writeText(res.listaOmitidos.join('\n'));
            msg += `\n\n(La lista se ha copiado automáticamente al portapapeles)`;
          } catch(e) {
            console.log('No se pudo copiar al portapapeles');
          }
        }

        alert(msg);
        this.cargarItinerarios();
      },
      error: (err) => {
        console.error('Error al unificar:', err);
        alert('Hubo un error al unificar los itinerarios. Se ha realizado un rollback.');
      }
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
    }
  }

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
