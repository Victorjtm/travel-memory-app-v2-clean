import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CrudTiposActividadComponent } from './crud-tipos-actividad.component';

describe('CrudTiposActividadComponent', () => {
  let component: CrudTiposActividadComponent;
  let fixture: ComponentFixture<CrudTiposActividadComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CrudTiposActividadComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CrudTiposActividadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
