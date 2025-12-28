import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ItinerariosComponent } from './itinerario.component';  // Cambia a ItinerariosComponent

describe('ItinerariosComponent', () => {
  let component: ItinerariosComponent;
  let fixture: ComponentFixture<ItinerariosComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ ItinerariosComponent ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(ItinerariosComponent);  // Cambia a ItinerariosComponent
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

