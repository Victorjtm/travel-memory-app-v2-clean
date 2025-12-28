import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-tipos-de-actividad',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tipos-de-actividad.component.html',
  styleUrls: ['./tipos-de-actividad.component.scss']
})
export class TiposDeActividadComponent {
  @Input() tipoSeleccionado: string = 'costa';
  @Output() tipoSeleccionadoChange = new EventEmitter<string>();

  tipos: string[] = ['costa', 'naturaleza', 'rural', 'urbana', 'cultural', 'trabajo'];

  seleccionarTipo(nuevoTipo: string) {
    this.tipoSeleccionado = nuevoTipo;
    this.tipoSeleccionadoChange.emit(this.tipoSeleccionado);
  }
}
