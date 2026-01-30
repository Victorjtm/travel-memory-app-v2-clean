// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PÁGINA: PLANIFICAR VIAJE CON IA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ChatIAComponent } from '../../componentes/chat-ia/chat-ia.component';

@Component({
    selector: 'app-planificar-viaje',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        ChatIAComponent
    ],
    templateUrl: './planificar-viaje.component.html',
    styleUrls: ['./planificar-viaje.component.scss']
})
export class PlanificarViajeComponent {

    constructor() {
        console.log('📄 Página Planificar Viaje cargada');
    }
}
