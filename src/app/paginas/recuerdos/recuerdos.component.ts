import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-recuerdos',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './recuerdos.component.html',
  styleUrls: ['./recuerdos.component.scss']
})
export class RecuerdosComponent {
  recuerdos = [
    { nombre: 'Recuerdo en la Torre Eiffel', descripcion: 'Fotografia tomada en Paris' },
    { nombre: 'Recuerdo en la Sagrada Familia', descripcion: 'Fotografia tomada en Barcelona' },
  ];
}
