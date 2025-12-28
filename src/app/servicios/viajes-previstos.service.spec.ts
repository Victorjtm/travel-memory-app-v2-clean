import { TestBed } from '@angular/core/testing';

import { ViajesPrevistosService } from './viajes-previstos.service';

describe('ViajesPrevistosService', () => {
  let service: ViajesPrevistosService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ViajesPrevistosService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
