import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-viajes',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './viajes.component.html',
  styleUrls: ['./viajes.component.scss']
})
export class ViajesComponent {
  viajes = [
    { nombre: 'Viaje a París', fecha: '2023-07-15' },
    { nombre: 'Viaje a Barcelona', fecha: '2024-02-01' },
  ];
}
