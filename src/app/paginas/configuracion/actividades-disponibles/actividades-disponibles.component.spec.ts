import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ActividadesDisponiblesComponent } from './actividades-disponibles.component';

describe('ActividadesDisponiblesComponent', () => {
  let component: ActividadesDisponiblesComponent;
  let fixture: ComponentFixture<ActividadesDisponiblesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ActividadesDisponiblesComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ActividadesDisponiblesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
