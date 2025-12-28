import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CrudArchivosSinAsignacionComponent } from './crud-archivos-sin-asignacion.component';

describe('CrudArchivosSinAsignacionComponent', () => {
  let component: CrudArchivosSinAsignacionComponent;
  let fixture: ComponentFixture<CrudArchivosSinAsignacionComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CrudArchivosSinAsignacionComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CrudArchivosSinAsignacionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
