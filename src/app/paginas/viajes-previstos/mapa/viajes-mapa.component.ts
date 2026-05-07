import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { GeolocalizacionViajesService } from '../../../servicios/geolocalizacion-viajes.service';
import { ViajePrevisto } from '../../../modelos/viaje-previsto.model';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-viajes-mapa',
  templateUrl: './viajes-mapa.component.html',
  styleUrls: ['./viajes-mapa.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule]
})
export class ViajesMapaComponent implements OnInit, OnDestroy {
  viajesMapeables: ViajePrevisto[] = [];
  viajesSinUbicacion: ViajePrevisto[] = [];
  loading: boolean = true;
  private sub: Subscription = new Subscription();

  constructor(private geolocService: GeolocalizacionViajesService) { }

  ngOnInit() {
    this.cargarDatos();
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
  }

  cargarDatos() {
    this.loading = true;
    this.sub.add(
      this.geolocService.getViajesMapeables().subscribe(viajes => {
        this.viajesMapeables = viajes;
        this.checkLoading();
      })
    );

    this.sub.add(
      this.geolocService.getViajesSinUbicacion().subscribe(viajes => {
        this.viajesSinUbicacion = viajes;
        this.checkLoading();
      })
    );
  }

  checkLoading() {
    // En una fase posterior esto será más robusto
    setTimeout(() => {
      this.loading = false;
    }, 500);
  }

  irAtras() {
    // Lógica para volver a la lista
  }
}
