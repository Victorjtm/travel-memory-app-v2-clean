import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ViajesFuturosListaComponent } from './viajes-futuros-lista.component';

describe('ViajesFuturosListaComponent', () => {
  let component: ViajesFuturosListaComponent;
  let fixture: ComponentFixture<ViajesFuturosListaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ViajesFuturosListaComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ViajesFuturosListaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
