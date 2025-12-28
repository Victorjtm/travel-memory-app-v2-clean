import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TipoActividadFormComponent } from './tipo-actividad-form.component';

describe('TipoActividadFormComponent', () => {
  let component: TipoActividadFormComponent;
  let fixture: ComponentFixture<TipoActividadFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TipoActividadFormComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TipoActividadFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
