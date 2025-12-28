import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TiposDeActividadComponent } from './tipos-de-actividad.component';

describe('TiposDeActividadComponent', () => {
  let component: TiposDeActividadComponent;
  let fixture: ComponentFixture<TiposDeActividadComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TiposDeActividadComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TiposDeActividadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
