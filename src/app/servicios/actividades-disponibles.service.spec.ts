import { TestBed } from '@angular/core/testing';

import { ActividadesDisponiblesService } from './actividades-disponibles.service';

describe('ActividadesDisponiblesService', () => {
  let service: ActividadesDisponiblesService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ActividadesDisponiblesService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
