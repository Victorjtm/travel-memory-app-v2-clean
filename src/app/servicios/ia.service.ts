// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SERVICIO ANGULAR PARA GESTIONAR CONVERSACIONES CON IA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError } from 'rxjs';
import { tap, catchError, map } from 'rxjs/operators';
import {
    MensajeIA,
    RespuestaChat,
    PlanEstructurado,
    HistorialSesion,
    ResumenSesion
} from '../modelos/conversacion-ia.model';
import { environment } from '../../environments/environment';


@Injectable({
    providedIn: 'root'
})
export class IAService {

    // ══════════════════════════════════════════════════════════════════════
    // CONFIGURACIÓN
    // ══════════════════════════════════════════════════════════════════════

    private apiUrl = `${environment.apiUrl}/ia`;


    // ══════════════════════════════════════════════════════════════════════
    // ESTADO REACTIVO (RxJS)
    // ══════════════════════════════════════════════════════════════════════

    private sessionIdSubject = new BehaviorSubject<string>(this.generarSessionId());
    private historialSubject = new BehaviorSubject<MensajeIA[]>([]);
    private planDetectadoSubject = new BehaviorSubject<PlanEstructurado | null>(null);
    private cargandoSubject = new BehaviorSubject<boolean>(false);

    // Observables públicos (para que los componentes se suscriban)
    public sessionId$ = this.sessionIdSubject.asObservable();
    public historial$ = this.historialSubject.asObservable();
    public planDetectado$ = this.planDetectadoSubject.asObservable();
    public cargando$ = this.cargandoSubject.asObservable();

    // ✨ NUEVO: Estado de consumo de tokens
    private limiteTokensSubject = new BehaviorSubject<{
        consumidos: number;
        maximo: number;
        restantes: number;
        porcentaje_usado: number;
    } | null>(null);

    public limiteTokens$ = this.limiteTokensSubject.asObservable();


    // API Key del usuario (opcional)
    private apiKeyUsuario: string | null = null;

    // ══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ══════════════════════════════════════════════════════════════════════

    constructor(private http: HttpClient) {
        // Cargar sessionId desde localStorage si existe
        const savedSessionId = localStorage.getItem('ia_session_id');
        if (savedSessionId) {
            this.sessionIdSubject.next(savedSessionId);
            this.cargarHistorial(savedSessionId);
        }

        // Cargar API Key guardada de forma prioritaria (Gemini AI Studio)
        this.apiKeyUsuario = this.resolverApiKeyGuardada();
    }

    /**
     * Resuelve la API Key de Gemini guardada en el almacenamiento local
     */
    public resolverApiKeyGuardada(): string | null {
        const geminiKey = localStorage.getItem('gemini_api_key');
        if (geminiKey && geminiKey.trim()) return geminiKey.trim();

        const iaKey = localStorage.getItem('ia_api_key');
        if (iaKey && iaKey.trim()) return iaKey.trim();

        const contextoKey = localStorage.getItem('contexto_viajeros_ia');
        if (contextoKey && (contextoKey.trim().startsWith('AIza') || contextoKey.trim().length > 30)) {
            return contextoKey.trim();
        }

        return null;
    }

    // ══════════════════════════════════════════════════════════════════════
    // GESTIÓN DE SESSION ID
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Genera un nuevo sessionId UUID v4
     */
    private generarSessionId(): string {
        // Generar UUID v4 simple
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Obtiene el sessionId actual
     */
    get sessionId(): string {
        return this.sessionIdSubject.value;
    }

    /**
     * Inicia una nueva conversación (genera nuevo sessionId)
     */
    nuevaConversacion(): void {
        const newSessionId = this.generarSessionId();
        localStorage.setItem('ia_session_id', newSessionId);
        this.sessionIdSubject.next(newSessionId);
        this.historialSubject.next([]);
        this.planDetectadoSubject.next(null);
        console.log('🆕 Nueva conversación iniciada:', newSessionId);
    }

    // ══════════════════════════════════════════════════════════════════════
    // GESTIÓN DE API KEY
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Configura API Key del usuario sincronizándola en el almacenamiento
     */
    setApiKey(apiKey: string | null): void {
        this.apiKeyUsuario = apiKey ? apiKey.trim() : null;
        if (this.apiKeyUsuario) {
            localStorage.setItem('gemini_api_key', this.apiKeyUsuario);
            localStorage.setItem('ia_api_key', this.apiKeyUsuario);
            console.log('🔑 API Key de Gemini configurada y sincronizada');
        } else {
            localStorage.removeItem('gemini_api_key');
            localStorage.removeItem('ia_api_key');
            console.log('🔑 API Key eliminada');
        }
    }

    /**
     * Obtiene API Key guardada
     */
    getApiKey(): string | null {
        if (!this.apiKeyUsuario) {
            this.apiKeyUsuario = this.resolverApiKeyGuardada();
        }
        return this.apiKeyUsuario;
    }

    /**
     * Valida una API Key
     */
    validarApiKey(apiKey: string): Observable<{ valida: boolean; error?: string }> {
        return this.http.post<{ valida: boolean; error?: string }>(
            `${this.apiUrl}/validar-apikey`,
            { apiKey }
        ).pipe(
            tap(resultado => {
                if (resultado.valida) {
                    console.log('✅ API Key válida');
                } else {
                    console.error('❌ API Key inválida:', resultado.error);
                }
            }),
            catchError(this.handleError)
        );
    }

    // ══════════════════════════════════════════════════════════════════════
    // ENVIAR MENSAJES
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Envía un mensaje a la IA
     */
    enviarMensaje(mensaje: string): Observable<RespuestaChat> {
        this.cargandoSubject.next(true);

        // Añadir mensaje del usuario al historial local inmediatamente
        const mensajeUsuario: MensajeIA = {
            sessionId: this.sessionId,
            rol: 'user',
            mensaje: mensaje,
            timestamp: new Date().toISOString()
        };

        const historialActual = this.historialSubject.value;
        this.historialSubject.next([...historialActual, mensajeUsuario]);

        // Preparar body de la petición
        const body: any = {
            sessionId: this.sessionId,
            mensaje: mensaje
        };

        // Añadir API Key si existe
        if (this.apiKeyUsuario) {
            body.apiKey = this.apiKeyUsuario;
        }

        console.log('📤 Enviando mensaje a IA:', mensaje.substring(0, 50) + '...');

        return this.http.post<RespuestaChat>(`${this.apiUrl}/chat`, body).pipe(
            tap(respuesta => {
                console.log(`📥 Respuesta recibida (${respuesta.tokens} tokens, ${respuesta.tiempo_ms}ms)`);

                // ✨ NUEVO: Actualizar información de límite de tokens
                if (respuesta.limite_tokens) {
                    this.limiteTokensSubject.next(respuesta.limite_tokens);
                    console.log(`📊 Tokens: ${respuesta.limite_tokens.consumidos}/${respuesta.limite_tokens.maximo} (${respuesta.limite_tokens.porcentaje_usado}% usado)`);
                }

                // Añadir respuesta de la IA al historial
                const mensajeIA: MensajeIA = {
                    id: respuesta.id,
                    sessionId: this.sessionId,
                    rol: 'assistant',
                    mensaje: respuesta.mensaje,
                    timestamp: new Date().toISOString(),
                    tokens_usados: respuesta.tokens,
                    tiempo_respuesta: respuesta.tiempo_ms,
                    datos_estructurados: respuesta.datos_estructurados
                };

                const historialNuevo = [...this.historialSubject.value, mensajeIA];
                this.historialSubject.next(historialNuevo);

                // Si se detectó un plan, actualizar
                if (respuesta.plan_detectado && respuesta.datos_estructurados) {
                    console.log('✨ Plan de viaje detectado');
                    this.planDetectadoSubject.next(respuesta.datos_estructurados);
                }

                this.cargandoSubject.next(false);
            }),

            catchError(error => {
                this.cargandoSubject.next(false);
                return this.handleError(error);
            })
        );
    }

    // ══════════════════════════════════════════════════════════════════════
    // GESTIÓN DE HISTORIAL
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Carga el historial de una sesión desde el backend
     */
    cargarHistorial(sessionId?: string): void {
        const sid = sessionId || this.sessionId;

        console.log('📖 Cargando historial de sesión:', sid);

        this.http.get<HistorialSesion>(`${this.apiUrl}/historial/${sid}`).pipe(
            catchError(this.handleError)
        ).subscribe({
            next: (historial) => {
                // Validar que mensajes sea un array
                const mensajes = Array.isArray(historial.mensajes) ? historial.mensajes : [];
                console.log(`✅ Historial cargado: ${mensajes.length} mensajes`);
                this.historialSubject.next(mensajes);

                // Buscar si hay un plan en el historial
                const mensajeConPlan = mensajes.find(m => m.datos_estructurados);
                if (mensajeConPlan?.datos_estructurados) {
                    this.planDetectadoSubject.next(mensajeConPlan.datos_estructurados);
                }
            },
            error: (error) => {
                console.error('❌ Error cargando historial:', error);
                // En caso de error, asegurar que el historial esté vacío
                this.historialSubject.next([]);
            }
        });
    }


    /**
     * Limpia el historial de la sesión actual
     */
    limpiarConversacion(): Observable<{ success: boolean; deleted: number }> {
        console.log('🗑️  Limpiando conversación:', this.sessionId);

        return this.http.delete<{ success: boolean; deleted: number }>(
            `${this.apiUrl}/historial/${this.sessionId}`
        ).pipe(
            tap(resultado => {
                console.log(`✅ Conversación limpiada (${resultado.deleted} mensajes)`);
                this.historialSubject.next([]);
                this.planDetectadoSubject.next(null);
                this.nuevaConversacion();
            }),
            catchError(this.handleError)
        );
    }

    // ══════════════════════════════════════════════════════════════════════
    // GESTIÓN DE SESIONES
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Obtiene lista de sesiones activas
     */
    obtenerSesionesActivas(): Observable<ResumenSesion[]> {
        return this.http.get<ResumenSesion[]>(`${this.apiUrl}/sesiones-activas`).pipe(
            catchError(this.handleError)
        );
    }

    /**
 * Guarda un plan de viaje estructurado en la base de datos
 */
    guardarViajeDesdePlan(plan: PlanEstructurado): Observable<{
        viaje_id: number;
        itinerarios_creados: number;
        actividades_creadas: number;
    }> {
        console.log('📤 Enviando plan al backend para guardar...');

        return this.http.post<{
            viaje_id: number;
            itinerarios_creados: number;
            actividades_creadas: number;
        }>(`${this.apiUrl.replace('/ia', '')}/viajes-futuros/desde-ia`, { plan }).pipe(

            tap(resultado => {
                console.log('✅ Viaje guardado:', resultado);
            }),
            catchError(this.handleError)
        );
    }


    // ══════════════════════════════════════════════════════════════════════
    // MANEJO DE ERRORES
    // ══════════════════════════════════════════════════════════════════════

    private handleError(error: HttpErrorResponse): Observable<never> {
        let errorMessage = 'Error desconocido';

        if (error.error instanceof ErrorEvent) {
            // Error del cliente
            errorMessage = `Error: ${error.error.message}`;
        } else {
            // Error del servidor
            errorMessage = error.error?.error ||
                error.error?.message ||
                `Error del servidor: ${error.status}`;
        }

        console.error('❌ Error en IAService:', errorMessage);
        return throwError(() => new Error(errorMessage));
    }
}
