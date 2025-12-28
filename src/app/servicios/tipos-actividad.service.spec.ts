import { TestBed } from '@angular/core/testing';

import { TiposActividadService } from './tipos-actividad.service';

describe('TiposActividadService', () => {
  let service: TiposActividadService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TiposActividadService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
