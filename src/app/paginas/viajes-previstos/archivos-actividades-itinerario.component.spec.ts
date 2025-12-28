import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ArchivosActividadesItinerarioComponent } from './archivos-actividades-itinerario.component';

describe('ArchivosActividadesItinerarioComponent', () => {
  let component: ArchivosActividadesItinerarioComponent;
  let fixture: ComponentFixture<ArchivosActividadesItinerarioComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArchivosActividadesItinerarioComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ArchivosActividadesItinerarioComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
