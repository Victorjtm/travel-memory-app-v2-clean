import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ViajesComponent } from './viajes.component';

describe('ViajesComponent', () => {
  let component: ViajesComponent;
  let fixture: ComponentFixture<ViajesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ViajesComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ViajesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
