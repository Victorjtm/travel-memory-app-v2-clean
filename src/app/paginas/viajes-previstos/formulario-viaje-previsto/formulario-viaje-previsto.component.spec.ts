import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FormularioViajePrevistoComponent } from './formulario-viaje-previsto.component';

describe('FormularioViajePrevistoComponent', () => {
  let component: FormularioViajePrevistoComponent;
  let fixture: ComponentFixture<FormularioViajePrevistoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormularioViajePrevistoComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FormularioViajePrevistoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
