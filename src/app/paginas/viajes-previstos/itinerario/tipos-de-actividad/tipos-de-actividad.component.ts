import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TiposActividadService } from '../../../../servicios/tipos-actividad.service';

@Component({
  selector: 'app-tipos-de-actividad',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tipos-de-actividad.component.html',
  styleUrls: ['./tipos-de-actividad.component.scss']
})
export class TiposDeActividadComponent implements OnInit {
  @Input() tipoSeleccionado: string = 'costa';
  @Output() tipoSeleccionadoChange = new EventEmitter<string>();

  tiposObj: { value: string, label: string }[] = [];

  constructor(private tiposActividadService: TiposActividadService) {}

  ngOnInit(): void {
    this.tiposActividadService.getTiposActividad().subscribe({
      next: (res) => {
        this.tiposObj = res.map(t => ({
          value: t.nombre.toLowerCase(),
          label: t.nombre.charAt(0).toUpperCase() + t.nombre.slice(1)
        }));
      },
      error: (err) => console.error('Error cargando tipos de actividad:', err)
    });
  }

  seleccionarTipo(nuevoTipo: string) {
    this.tipoSeleccionado = nuevoTipo;
    this.tipoSeleccionadoChange.emit(this.tipoSeleccionado);
  }
}
