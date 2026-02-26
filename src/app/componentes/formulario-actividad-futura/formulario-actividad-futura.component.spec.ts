import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormularioActividadFuturaComponent } from './formulario-actividad-futura.component';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ReactiveFormsModule } from '@angular/forms';
import { HttpClientTestingModule } from '@angular/common/http/testing';

describe('FormularioActividadFuturaComponent', () => {
  let component: FormularioActividadFuturaComponent;
  let fixture: ComponentFixture<FormularioActividadFuturaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        FormularioActividadFuturaComponent,
        ReactiveFormsModule,
        HttpClientTestingModule
      ],
      providers: [
        { provide: MatDialogRef, useValue: {} },
        { provide: MAT_DIALOG_DATA, useValue: { actividadId: 1 } }
      ]
    })
      .compileComponents();

    fixture = TestBed.createComponent(FormularioActividadFuturaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
