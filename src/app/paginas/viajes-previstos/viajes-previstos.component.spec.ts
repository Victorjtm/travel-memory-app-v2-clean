import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ViajesPrevistosComponent } from './viajes-previstos.component';

describe('ViajesPrevistosComponent', () => {
  let component: ViajesPrevistosComponent;
  let fixture: ComponentFixture<ViajesPrevistosComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ViajesPrevistosComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ViajesPrevistosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
