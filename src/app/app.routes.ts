import { Routes } from '@angular/router';
import { InicioComponent } from './paginas/inicio/inicio.component';
import { ViajesComponent } from './paginas/viajes/viajes.component';
import { RecuerdosComponent } from './paginas/recuerdos/recuerdos.component';
import { ViajesPrevistosComponent } from './paginas/viajes-previstos/viajes-previstos.component';
import { FormularioViajePrevistoComponent } from './paginas/viajes-previstos/formulario-viaje-previsto/formulario-viaje-previsto.component';
import { ItinerariosComponent } from './paginas/viajes-previstos/itinerario/itinerario.component';
import { FormularioItinerarioComponent } from './paginas/viajes-previstos/itinerario/formulario-itinerario/formulario-itinerario.component';
import { ConfiguracionComponent } from './paginas/configuracion/configuracion.component';
import { CrudTiposActividadComponent } from './paginas/configuracion/crud-tipos-actividad/crud-tipos-actividad.component';
import { TipoActividadFormComponent } from './paginas/configuracion/crud-tipos-actividad/tipo-actividad-form/tipo-actividad-form.component';

// Nuevos componentes para actividades disponibles
import { ActividadesDisponiblesComponent } from './paginas/configuracion/actividades-disponibles/actividades-disponibles.component';
import { FormularioActividadComponent } from './paginas/configuracion/actividades-disponibles/formulario-actividad/formulario-actividad.component';
import { AlbumLibroComponent } from './paginas/viajes-previstos/itinerario/album-libro/album-libro.component';
import { FormularioArchivosComponent } from './paginas/viajes-previstos/formulario-archivos-actividades-itinerario.component';

// Importar componentes para archivos sin asignación
import { CrudArchivosSinAsignacionComponent } from './paginas/configuracion/crud-archivos-sin-asignacion/crud-archivos-sin-asignacion/crud-archivos-sin-asignacion.component';

export const routes: Routes = [
  { path: '', component: InicioComponent },
  { path: 'viajes', component: ViajesComponent },
  { path: 'recuerdos', component: RecuerdosComponent },
  { path: 'viajes-previstos', component: ViajesPrevistosComponent },
{ path: 'formulario-viaje-previsto/:id', component: FormularioViajePrevistoComponent }, // id = número (edición) o 'nuevo' (creación)

  { path: 'itinerarios/:viajePrevistoId', component: ItinerariosComponent },
  { path: 'formulario-itinerario/:viajePrevistoId', component: FormularioItinerarioComponent },

  // Sección de configuración
  { path: 'configuracion', component: ConfiguracionComponent },
  { 
    path: 'configuracion/tipos-actividad', 
    children: [
      { path: '', component: CrudTiposActividadComponent },
      { path: 'nuevo', component: TipoActividadFormComponent },
      { path: 'editar/:id', component: TipoActividadFormComponent }
    ]
  },
  {
    path: 'configuracion/actividades-disponibles',
    children: [
      { path: '', component: ActividadesDisponiblesComponent },
      { path: 'nueva', component: FormularioActividadComponent },
      { path: 'nueva/:idTipo', component: FormularioActividadComponent },
      { path: 'editar/:id', component: FormularioActividadComponent }
    ]
  },
  // 🆕 Nueva ruta para archivos sin asignación con la misma estructura
  {
    path: 'configuracion/archivos-sin-asignacion',
    children: [
      { path: '', component: CrudArchivosSinAsignacionComponent }
      // Puedes agregar más rutas hijas aquí si necesitas en el futuro
      // { path: 'nuevo', component: FormularioArchivoSinAsignacionComponent },
      // { path: 'editar/:id', component: FormularioArchivoSinAsignacionComponent }
    ]
  },

  {
    path: 'formulario-actividad/:viajePrevistoId/:itinerarioId/:actividadId',
    loadComponent: () =>
      import('./paginas/viajes-previstos/actividades-itinerarios/formulario-actividad-itinerario/formulario-actividad-itinerario.component')
        .then(m => m.FormularioActividadItinerarioComponent)
  },
  
  {
    path: 'viajes-previstos/:viajePrevistoId/itinerarios/:itinerarioId/actividades',
    loadComponent: () => 
      import('./paginas/viajes-previstos/actividades-itinerarios/actividades-itinerarios.component')
        .then(m => m.ActividadesItinerariosComponent)
  },

  // Rutas relacionadas con archivos de actividades e itinerarios
  {
    path: 'viajes-previstos/:viajePrevistoId/itinerarios/:itinerarioId/actividades/:actividadId/archivos',
    loadComponent: () => import('./paginas/viajes-previstos/archivos-actividades-itinerario.component').then(m => m.ArchivosComponent)
  },

  {
    path: 'viajes-previstos/:viajePrevistoId/itinerarios/:itinerarioId/actividades/:actividadId/archivos/nuevo',
    loadComponent: () => import('./paginas/viajes-previstos/formulario-archivos-actividades-itinerario.component').then(m => m.FormularioArchivosComponent)
  },

  // 🆕 Nueva ruta para edición de archivos
  {
    path: 'viajes-previstos/:viajePrevistoId/itinerarios/:itinerarioId/actividades/:actividadId/archivos/editar/:archivoId',
    loadComponent: () => import('./paginas/viajes-previstos/formulario-archivos-actividades-itinerario.component').then(m => m.FormularioArchivosComponent)
  },

    // 🆕 Nueva ruta para gestión de archivos asociados
  {
    path: 'viajes-previstos/:viajePrevistoId/itinerarios/:itinerarioId/actividades/:actividadId/archivos/:archivoId/asociados',
    loadComponent: () => import('./paginas/viajes-previstos/gestion-archivos-asociados.component').then(m => m.GestionArchivosAsociadosComponent)
  },

  // Nueva ruta para el botón "Seleccionar Archivos" desde Inicio
{ path: 'formulario-archivos-actividades-itinerario', component: FormularioArchivosComponent },


  // Rutas para el álbum en formato libro desde viajes previstos
  {
  path: 'viajes-previstos/:viajeId/itinerarios/album/libro',
  component: AlbumLibroComponent
},

  // Ruta para ver formato de libro
  {
  path: 'viajes-previstos/:viajeId/itinerarios/:itinerarioId/actividades/:actividadId/libro',
  component: AlbumLibroComponent
},

  { path: '**', redirectTo: '' }
];