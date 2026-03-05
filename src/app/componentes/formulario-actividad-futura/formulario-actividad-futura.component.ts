import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ActividadesFuturasService, ActividadFutura } from '../../servicios/actividades-futuras.service';

interface DialogData {
  actividadId: number;
  itinerarioId?: number;
  origen?: 'normal' | 'conflicto';
}

@Component({
  selector: 'app-formulario-actividad-futura',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule
  ],
  templateUrl: './formulario-actividad-futura.component.html',
  styleUrls: ['./formulario-actividad-futura.component.scss']
})
export class FormularioActividadFuturaComponent implements OnInit {
  form: FormGroup;
  actividadOriginal: ActividadFutura | null = null;
  cargando = true;
  errorSolapamiento: { mensaje: string; conflictoId?: number; conflictoNombre?: string | null } | null = null;
  formChanged = false;

  // Tipos de actividad — IDs alineados con tabla TiposActividad de la BD
  tiposActividad = [
    { id: 1, nombre: 'costa' },
    { id: 2, nombre: 'naturaleza' },
    { id: 3, nombre: 'rural' },
    { id: 4, nombre: 'urbana' },
    { id: 5, nombre: 'cultural' },
    { id: 6, nombre: 'deportiva' },
    { id: 7, nombre: 'fiesta' },
    { id: 8, nombre: 'transporte' },
    { id: 9, nombre: 'restauración' }
  ];

  constructor(
    public dialogRef: MatDialogRef<FormularioActividadFuturaComponent>,
    @Inject(MAT_DIALOG_DATA) public data: DialogData,
    private fb: FormBuilder,
    private actividadesService: ActividadesFuturasService,
    private dialog: MatDialog
  ) {
    this.form = this.fb.group({
      nombre: ['', Validators.required],
      descripcion: [''],
      horaInicio: ['', Validators.required],
      horaFin: ['', Validators.required],
      tipoActividadId: [1, Validators.required],
      ubicacion_planeada: ['']
    }, {
      validators: [
        this.validarHorasCoherentes.bind(this)
      ],
      asyncValidators: [
        this.validarAntiSolapamiento.bind(this)
      ]
    });

    // Detectar cualquier cambio en el formulario
    this.form.valueChanges.subscribe(() => {
      if (!this.cargando && this.actividadOriginal) {
        this.formChanged = this.hayAlgunCambio();
      }
    });
  }

  ngOnInit() {
    this.cargarActividad();
  }

  cargarActividad() {
    this.actividadesService.obtenerActividad(this.data.actividadId).subscribe({
      next: (actividad) => {
        this.actividadOriginal = actividad;
        this.form.patchValue({
          nombre: actividad.nombre || '',
          descripcion: actividad.descripcion || '',
          horaInicio: actividad.horaInicio,
          horaFin: actividad.horaFin,
          tipoActividadId: actividad.tipoActividadId,
          ubicacion_planeada: actividad.ubicacion_planeada || ''
        });
        this.cargando = false;
      },
      error: (err) => {
        console.error('❌ Error cargando actividad:', err);
        this.cargando = false;
      }
    });
  }

  // ✅ VALIDADOR 1: Horas coherentes (inicio < fin)
  validarHorasCoherentes(group: AbstractControl): ValidationErrors | null {
    const inicio = group.get('horaInicio')?.value;
    const fin = group.get('horaFin')?.value;
    if (!inicio || !fin) return null;

    const minInicio = this.horaToMinutos(inicio);
    const minFin = this.horaToMinutos(fin);

    return minInicio >= minFin ? { horasNoCoherentes: true } : null;
  }

  // ✅ VALIDADOR 2: Anti-solapamiento (TU REQUERIMIENTO)
  validarAntiSolapamiento(group: AbstractControl): Promise<ValidationErrors | null> {
    return new Promise((resolve) => {
      const inicio = group.get('horaInicio')?.value;
      const fin = group.get('horaFin')?.value;

      if (!inicio || !fin || !this.actividadOriginal) {
        resolve(null);
        return;
      }

      // Solo validar si realmente cambió
      if (inicio === this.actividadOriginal.horaInicio &&
        fin === this.actividadOriginal.horaFin) {
        this.errorSolapamiento = null;
        resolve(null);
        return;
      }

      // 🔍 OBTENER OTRAS ACTIVIDADES DEL MISMO ITINERARIO
      this.actividadesService.obtenerActividadesDeItinerario(
        this.actividadOriginal.itinerarioFuturoId
      ).subscribe({
        next: (todasActividades) => {
          // Filtrar actividades que NO sean la actual
          const otrasActividades = todasActividades.filter(
            act => act.id !== this.actividadOriginal!.id
          );

          // Buscar conflicto
          const conflicto = otrasActividades.find(otraAct =>
            this.haySolapamiento(
              inicio,
              fin,
              otraAct.horaInicio,
              otraAct.horaFin,
              group.get('nombre')?.value || '',
              otraAct.nombre || ''
            )
          );

          if (conflicto) {
            this.errorSolapamiento = {
              mensaje: `Horario solapa con '${conflicto.nombre}' (${conflicto.horaInicio}-${conflicto.horaFin}). Modifica primero esa actividad o acorta esta.`,
              conflictoId: conflicto.id,
              conflictoNombre: conflicto.nombre ?? undefined
            };
            resolve({ solapamiento: true });
          } else {
            this.errorSolapamiento = null;
            resolve(null);
          }
        },
        error: () => resolve(null)
      });
    });
  }

  haySolapamiento(h1i: string, h1f: string, h2i: string, h2f: string, n1: string, n2: string): boolean {
    const f1 = n1.match(/\((\d{4}-\d{2}-\d{2})\)/)?.[1];
    const f2 = n2.match(/\((\d{4}-\d{2}-\d{2})\)/)?.[1];
    if (f1 && f2 && f1 !== f2) {
      return false; // Son de días distintos, no hay solapamiento
    }

    const m1i = this.horaToMinutos(h1i);
    const m1f = this.horaToMinutos(h1f);
    const m2i = this.horaToMinutos(h2i);
    const m2f = this.horaToMinutos(h2f);
    // Se solapan si: fin1 > inicio2 Y fin2 > inicio1
    return (m1f > m2i) && (m2f > m1i);
  }

  horaToMinutos(hora: string): number {
    const [h, m] = hora.split(':').map(Number);
    return h * 60 + m;
  }

  // 🔍 Comparar valores actuales con los originales
  private hayAlgunCambio(): boolean {
    if (!this.actividadOriginal) return false;
    const v = this.form.value;
    const o = this.actividadOriginal;
    return (
      (v.nombre || '') !== (o.nombre || '') ||
      (v.descripcion || '') !== (o.descripcion || '') ||
      v.horaInicio !== o.horaInicio ||
      v.horaFin !== o.horaFin ||
      v.tipoActividadId !== o.tipoActividadId ||
      (v.ubicacion_planeada || '') !== (o.ubicacion_planeada || '')
    );
  }

  // 🚀 NAVEGACIÓN INTELIGENTE AL CONFLICTO (TU REQUERIMIENTO)
  editarConflicto() {
    if (!this.errorSolapamiento?.conflictoId) return;

    // Modal ANIDADO encima del actual
    const dialogRef = this.dialog.open(FormularioActividadFuturaComponent, {
      width: '500px',
      data: {
        actividadId: this.errorSolapamiento.conflictoId!,
        itinerarioId: this.actividadOriginal!.itinerarioFuturoId,
        origen: 'conflicto'
      },
      autoFocus: false // No robar foco al modal padre
    });

    // Cuando cierre el modal hijo, revalidar el formulario padre
    dialogRef.afterClosed().subscribe(() => {
      this.form.updateValueAndValidity({ emitEvent: false });
    });
  }

  // 💾 GUARDAR
  guardar() {
    if (this.form.invalid || this.cargando || this.errorSolapamiento) {
      this.form.markAllAsTouched();
      return;
    }

    const datos = this.form.value;

    this.actividadesService.actualizarActividad(this.data.actividadId, datos)
      .subscribe({
        next: (resultado) => {
          console.log('✅ Actividad actualizada:', resultado);
          this.dialogRef.close('guardado');
        },
        error: (err) => {
          console.error('❌ Error guardando:', err);
          alert(`Error al guardar: ${err.error?.message || err.message}`);
        }
      });
  }

  // ❌ CANCELAR (revierte TODO)
  cancelar() {
    // No guarda nada, cierra modal
    this.dialogRef.close('cancelado');
  }

  // 🗑️ ELIMINAR
  eliminar() {
    if (!confirm(`¿Eliminar permanentemente "${this.form.value.nombre}"?`)) return;

    this.actividadesService.eliminarActividad(this.data.actividadId)
      .subscribe({
        next: (resultado) => {
          console.log('🗑️ Actividad eliminada:', resultado);
          this.dialogRef.close('eliminado');
        },
        error: (err) => {
          console.error('❌ Error eliminando:', err);
          alert(`Error al eliminar: ${err.error?.message || err.message}`);
        }
      });
  }
}
