import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VisorArchivoComponent } from './visor-archivo.component';

describe('VisorArchivoComponent', () => {
  let component: VisorArchivoComponent;
  let fixture: ComponentFixture<VisorArchivoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VisorArchivoComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(VisorArchivoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
