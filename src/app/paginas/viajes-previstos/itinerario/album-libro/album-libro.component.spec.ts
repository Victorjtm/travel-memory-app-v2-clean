import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AlbumLibroComponent } from './album-libro.component';

describe('AlbumLibroComponent', () => {
  let component: AlbumLibroComponent;
  let fixture: ComponentFixture<AlbumLibroComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AlbumLibroComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AlbumLibroComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});


