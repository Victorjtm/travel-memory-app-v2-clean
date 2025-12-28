import { Component } from '@angular/core';
import { CommonModule } from '@angular/common'; // Importa CommonModule

@Component({
  selector: 'app-recuerdos',
  standalone: true,
  imports: [CommonModule],  // Añade CommonModule aquí
  templateUrl: './recuerdos.component.html',
  styleUrls: ['./recuerdos.component.scss']
})
export class RecuerdosComponent {
  recuerdos = [
    { nombre: 'Recuerdo en la Torre Eiffel', descripcion: 'Fotografía tomada en París' },
    { nombre: 'Recuerdo en la Sagrada Familia', descripcion: 'Fotografía tomada en Barcelona' },
  ];
}

