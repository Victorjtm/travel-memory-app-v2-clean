// src/app/servicios/auto-asignacion.service.ts

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, of } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ArchivoService } from './archivo.service';
import { ViajesPrevistosService } from './viajes-previstos.service';
import { ItinerarioService } from './itinerario.service';
import { ActividadesItinerariosService } from './actividades-itinerarios.service';
import { GeocodificacionService } from './geocodificacion.service';
import { Archivo } from '../modelos/archivo';

export interface ResultadoAutoAsignacion {
    exito: boolean;
    mensaje: string;
    viajeCreado?: any;
    itinerarioCreado?: any;
    actividadCreada?: any;
    archivosAsignados?: number;
    destinoDetectado?: string;
    errores?: string[];
}

export interface MetadatosEXIF {
    gps?: string; // "latitud,longitud"
    fecha?: string; // ISO 8601
    hora?: string; // "HH:MM:SS"
    ciudad?: string;
    region?: string;
    pais?: string;
}

@Injectable({
    providedIn: 'root'
})
export class AutoAsignacionService {
    private apiUrl = `${environment.apiUrl}/archivos`;

    constructor(
        private http: HttpClient,
        private archivoService: ArchivoService,
        private viajesService: ViajesPrevistosService,
        private itinerarioService: ItinerarioService,
        private actividadesService: ActividadesItinerariosService,
        private geocodificacionService: GeocodificacionService
    ) { }

    /**
     * 🚀 MÉTODO PRINCIPAL: Auto-asigna archivos con IA
     * 
     * Flujo:
     * 1. Lee EXIF de todos los archivos seleccionados
     * 2. Detecta destino común (GPS → Ciudad)
     * 3. Si no hay destino, pide al usuario
     * 4. Crea Viaje genérico (si no existe)
     * 5. Crea Itinerario del día (00:00-23:59)
     * 6. Crea Actividad con nombre del destino
     * 7. Asigna TODOS los archivos a la actividad
     */
    autoAsignarConIA(archivoIds: number[], destinoManual?: string): Observable<ResultadoAutoAsignacion> {
        console.log('🚀 Iniciando auto-asignación con IA para archivos:', archivoIds);

        // 1. Leer metadatos EXIF de todos los archivos
        return this.leerMetadatosMultiples(archivoIds).pipe(
            switchMap(metadatos => {
                console.log('📊 Metadatos EXIF leídos:', metadatos);

                // 2. Detectar destino común
                const destinoDetectado = destinoManual || this.detectarDestinoComun(metadatos);

                if (!destinoDetectado) {
                    return of({
                        exito: false,
                        mensaje: 'No se pudo detectar un destino común. Por favor, introduce uno manualmente.',
                        errores: ['Sin GPS en las fotos o ubicación no identificable']
                    });
                }

                console.log('📍 Destino detectado:', destinoDetectado);

                // 3. Obtener fecha del primer archivo
                const fechaPrimeraFoto = this.extraerFecha(metadatos[0]);
                if (!fechaPrimeraFoto) {
                    return of({
                        exito: false,
                        mensaje: 'No se pudo determinar la fecha de las fotos',
                        errores: ['Falta información de fecha en los archivos']
                    });
                }

                // 4. Crear estructura completa (Viaje → Itinerario → Actividad → Asignar)
                return this.crearEstructuraCompleta(
                    archivoIds,
                    destinoDetectado,
                    fechaPrimeraFoto,
                    metadatos
                );
            }),
            catchError(error => {
                console.error('❌ Error en auto-asignación:', error);
                return of({
                    exito: false,
                    mensaje: 'Error durante la auto-asignación',
                    errores: [error.message || 'Error desconocido']
                });
            })
        );
    }

    /**
     * 📖 Lee metadatos EXIF de múltiples archivos
     */
    private leerMetadatosMultiples(archivoIds: number[]): Observable<MetadatosEXIF[]> {
        const peticiones = archivoIds.map(id => this.leerMetadatosEXIF(id));
        return forkJoin(peticiones);
    }

    /**
     * 📸 Lee metadatos EXIF de un archivo individual (llamada al backend)
     */
    private leerMetadatosEXIF(archivoId: number): Observable<MetadatosEXIF> {
        return this.http.get<MetadatosEXIF>(`${this.apiUrl}/${archivoId}/exif`).pipe(
            catchError(error => {
                console.warn(`⚠️ No se pudo leer EXIF del archivo ${archivoId}:`, error);
                return of({} as MetadatosEXIF);
            })
        );
    }

    /**
     * 🎯 Detecta destino común analizando GPS de todos los archivos
     */
    private detectarDestinoComun(metadatos: MetadatosEXIF[]): string | null {
        // Filtrar solo archivos con GPS
        const archivosConGPS = metadatos.filter(m => m.gps && m.ciudad);

        if (archivosConGPS.length === 0) {
            console.warn('⚠️ Ningún archivo tiene información GPS');
            return null;
        }

        // Contar frecuencia de ciudades
        const contadorCiudades = new Map<string, number>();
        archivosConGPS.forEach(m => {
            const ciudad = m.ciudad!;
            contadorCiudades.set(ciudad, (contadorCiudades.get(ciudad) || 0) + 1);
        });

        // Obtener ciudad más frecuente
        let ciudadMasFrecuente = '';
        let maxFrecuencia = 0;

        contadorCiudades.forEach((frecuencia, ciudad) => {
            if (frecuencia > maxFrecuencia) {
                maxFrecuencia = frecuencia;
                ciudadMasFrecuente = ciudad;
            }
        });

        // Si más del 70% de fotos son de la misma ciudad, usar esa
        const porcentaje = (maxFrecuencia / archivosConGPS.length) * 100;

        if (porcentaje >= 70) {
            console.log(`✅ Destino detectado: ${ciudadMasFrecuente} (${porcentaje.toFixed(0)}% coincidencia)`);
            return ciudadMasFrecuente;
        }

        // Si no hay mayoría clara, usar la primera ciudad encontrada
        console.log(`⚠️ No hay mayoría clara, usando: ${ciudadMasFrecuente}`);
        return ciudadMasFrecuente || null;
    }

    /**
     * 📅 Extrae fecha del metadato (prioriza fecha EXIF, luego fecha de archivo)
     */
    private extraerFecha(metadato: MetadatosEXIF): string | null {
        if (metadato.fecha) {
            return metadato.fecha.split('T')[0]; // Solo fecha (YYYY-MM-DD)
        }
        return null;
    }

    /**
     * 🏗️ Crea estructura completa: Viaje → Itinerario → Actividad → Asignar archivos
     */
    private crearEstructuraCompleta(
        archivoIds: number[],
        destino: string,
        fecha: string,
        metadatos: MetadatosEXIF[]
    ): Observable<ResultadoAutoAsignacion> {
        console.log('🏗️ Creando estructura completa...');

        return this.viajesService.obtenerViajes().pipe(
            switchMap(viajes => {
                // 1. Buscar o crear viaje genérico
                let viajeExistente = viajes.find(v =>
                    v.destino.toLowerCase() === destino.toLowerCase() &&
                    fecha >= v.fecha_inicio &&
                    fecha <= v.fecha_fin
                );

                if (viajeExistente) {
                    console.log('✅ Viaje existente encontrado:', viajeExistente.nombre);
                    return of(viajeExistente);
                }

                // Crear nuevo viaje genérico
                console.log('📝 Creando nuevo viaje genérico...');
                const nuevoViaje = {
                    nombre: `Viaje a ${destino}`,
                    destino: destino,
                    fecha_inicio: fecha,
                    fecha_fin: fecha,
                    descripcion: 'Viaje creado automáticamente desde archivos sin asignar'
                };

                return this.viajesService.crearViaje(nuevoViaje);
            }),
            switchMap(viaje => {
                console.log('✅ Viaje confirmado:', viaje.nombre);

                // 2. Crear itinerario del día
                return this.itinerarioService.getItinerarios(viaje.id).pipe(
                    switchMap(itinerarios => {
                        // Buscar itinerario existente para esa fecha
                        let itinerarioExistente = itinerarios.find(it =>
                            it.fechaInicio.startsWith(fecha)
                        );

                        if (itinerarioExistente) {
                            console.log('✅ Itinerario existente encontrado');
                            return of({ viaje, itinerario: itinerarioExistente });
                        }

                        // Crear nuevo itinerario
                        console.log('📝 Creando nuevo itinerario...');
                        const nuevoItinerario = {
                            viajePrevistoId: viaje.id,
                            fechaInicio: `${fecha}T00:00:00`,
                            fechaFin: `${fecha}T23:59:59`,
                            duracionDias: 1,  // ← AGREGADO
                            destinosPorDia: destino,  // ← AGREGADO
                            descripcionGeneral: `Día en ${destino}`,
                            horaInicio: '00:00',  // ← AGREGADO (opcional)
                            horaFin: '23:59',  // ← AGREGADO (opcional)
                            climaGeneral: null,  // ← AGREGADO (opcional)
                            tipoDeViaje: 'urbana'  // ← AGREGADO (opcional)
                        } as any;  // ← AGREGADO para evitar errores de tipo

                        return this.itinerarioService.crearItinerario(nuevoItinerario).pipe(
                            map(itinerario => ({ viaje, itinerario }))
                        );
                    })
                );
            }),
            switchMap(({ viaje, itinerario }) => {
                console.log('✅ Itinerario confirmado');

                // 3. Crear actividad con nombre del destino
                return this.actividadesService.getByItinerario(itinerario.id).pipe(
                    switchMap(actividades => {
                        // Buscar actividad existente con el mismo nombre
                        let actividadExistente = actividades.find(a =>
                            a.nombre && a.nombre.toLowerCase().includes(destino.toLowerCase())
                        );

                        if (actividadExistente) {
                            console.log('✅ Actividad existente encontrada:', actividadExistente.nombre);
                            return of({ viaje, itinerario, actividad: actividadExistente });
                        }

                        // Crear nueva actividad
                        console.log('📝 Creando nueva actividad...');
                        const nuevaActividad = {
                            viajePrevistoId: viaje.id,
                            itinerarioId: itinerario.id,
                            tipoActividadId: 1, // "Otro" o tipo genérico
                            nombre: `Visita a ${destino}`,
                            descripcion: 'Actividad creada automáticamente',
                            horaInicio: '00:00',
                            horaFin: '23:59'
                        };

                        return this.actividadesService.create(nuevaActividad).pipe(
                            map(actividad => ({ viaje, itinerario, actividad }))
                        );
                    })
                );
            }),
            switchMap(({ viaje, itinerario, actividad }) => {
                console.log('✅ Actividad confirmada:', actividad.nombre);

                // 4. Asignar TODOS los archivos a la actividad
                console.log(`📎 Asignando ${archivoIds.length} archivos a actividad ${actividad.id}...`);

                const peticionesAsignacion = archivoIds.map(id =>
                    this.archivoService.asignarArchivoAActividad(id, actividad.id).pipe(
                        catchError(error => {
                            console.error(`❌ Error asignando archivo ${id}:`, error);
                            return of({ error: true, archivoId: id });
                        })
                    )
                );

                return forkJoin(peticionesAsignacion).pipe(
                    map(resultados => {
                        const errores = resultados.filter((r: any) => r.error);
                        const exitosos = resultados.length - errores.length;

                        return {
                            exito: errores.length === 0,
                            mensaje: errores.length === 0
                                ? `✅ ¡Auto-asignación completada! ${exitosos} archivos asignados a "${actividad.nombre}"`
                                : `⚠️ Asignación parcial: ${exitosos}/${resultados.length} archivos asignados`,
                            viajeCreado: viaje,
                            itinerarioCreado: itinerario,
                            actividadCreada: actividad,
                            archivosAsignados: exitosos,
                            destinoDetectado: destino,
                            errores: errores.length > 0 ? ['Algunos archivos no se pudieron asignar'] : undefined
                        };
                    })
                );
            })
        );
    }

    /**
     * 🌍 Obtiene ciudad desde coordenadas GPS (usa servicio de geocodificación)
     */
    obtenerCiudadDesdeGPS(gps: string): Observable<string | null> {
        return this.geocodificacionService.obtenerUbicacionPorCoordenadas(gps).pipe(
            map(ubicacion => {
                if (!ubicacion) return null;
                return this.geocodificacionService.obtenerNombreCorto(ubicacion);
            })
        );
    }
}