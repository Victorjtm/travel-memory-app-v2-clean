// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPONENTE DE CHAT CON IA PARA PLANIFICACIÓN DE VIAJES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { IAService } from '../../servicios/ia.service';
import { MensajeIA, PlanEstructurado } from '../../modelos/conversacion-ia.model';

@Component({
    selector: 'app-chat-ia',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './chat-ia.component.html',
    styleUrls: ['./chat-ia.component.scss']
})
export class ChatIAComponent implements OnInit, OnDestroy, AfterViewChecked {

    // ══════════════════════════════════════════════════════════════════════
    // PROPIEDADES
    // ══════════════════════════════════════════════════════════════════════

    mensajes: MensajeIA[] = [];
    mensajeActual: string = '';
    cargando: boolean = false;
    planDetectado: PlanEstructurado | null = null;
    sessionId: string = '';
    mostrarJson: boolean = false;
    apiKeyConfigurada: boolean = false;

    // ✨ NUEVO: Información de límite de tokens
    limiteTokens: {
        consumidos: number;
        maximo: number;
        restantes: number;
        porcentaje_usado: number;
    } | null = null;


    // Control de scroll
    @ViewChild('mensajesContainer') private mensajesContainer!: ElementRef;
    private shouldScroll = false;

    // Control de subscripciones
    private destroy$ = new Subject<void>();

    // ══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ══════════════════════════════════════════════════════════════════════

    constructor(public iaService: IAService) { }

    // ══════════════════════════════════════════════════════════════════════
    // CICLO DE VIDA
    // ══════════════════════════════════════════════════════════════════════

    ngOnInit(): void {
        console.log('🤖 ChatIA: Componente inicializado');

        // Verificar si hay API Key configurada
        this.apiKeyConfigurada = !!this.iaService.getApiKey();

        // Suscribirse al historial de mensajes
        this.iaService.historial$
            .pipe(takeUntil(this.destroy$))
            .subscribe(mensajes => {
                this.mensajes = mensajes;
                this.shouldScroll = true;
                console.log(`📝 Historial actualizado: ${mensajes.length} mensajes`);
            });

        // Suscribirse al estado de carga
        this.iaService.cargando$
            .pipe(takeUntil(this.destroy$))
            .subscribe(cargando => {
                this.cargando = cargando;
            });

        // Suscribirse al plan detectado
        this.iaService.planDetectado$
            .pipe(takeUntil(this.destroy$))
            .subscribe(plan => {
                this.planDetectado = plan;
                if (plan) {
                    console.log('✨ Plan detectado:', plan.viaje.nombre);
                }
            });

        // Suscribirse al sessionId
        this.iaService.sessionId$
            .pipe(takeUntil(this.destroy$))
            .subscribe(id => {
                this.sessionId = id;
            });

        // ✨ NUEVO: Suscribirse a límites de tokens
        this.iaService.limiteTokens$
            .pipe(takeUntil(this.destroy$))
            .subscribe(limite => {
                this.limiteTokens = limite;
                if (limite && limite.porcentaje_usado >= 90) {
                    console.warn(`⚠️ Advertencia: ${limite.porcentaje_usado}% de tokens consumidos`);
                }
            });

    }

    ngAfterViewChecked(): void {
        if (this.shouldScroll) {
            this.scrollToBottom();
            this.shouldScroll = false;
        }
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    // ══════════════════════════════════════════════════════════════════════
    // MÉTODOS DE MENSAJERÍA
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Envía un mensaje a la IA
     */
    enviarMensaje(): void {
        const mensaje = this.mensajeActual.trim();

        if (!mensaje) {
            return;
        }

        if (!this.apiKeyConfigurada) {
            alert('⚠️ No hay API Key configurada.\n\nPor favor, configura tu API Key de Perplexity primero.');
            this.configurarApiKey();
            return;
        }

        console.log('📤 Enviando mensaje:', mensaje);

        this.iaService.enviarMensaje(mensaje).subscribe({
            next: (respuesta) => {
                console.log('✅ Respuesta recibida');
                this.mensajeActual = '';
            },
            error: (error) => {
                console.error('❌ Error:', error);
                alert(`Error al enviar mensaje:\n\n${error.message}`);
            }
        });
    }

    /**
     * Maneja el Enter en el textarea
     */
    onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.enviarMensaje();
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // GESTIÓN DE CONVERSACIÓN
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Inicia una nueva conversación
     */
    nuevaConversacion(): void {
        if (this.mensajes.length > 0) {
            const confirmar = confirm('¿Iniciar una nueva conversación?\n\nLa conversación actual se guardará en el historial.');
            if (!confirmar) return;
        }

        this.iaService.nuevaConversacion();
        this.planDetectado = null;
        this.mostrarJson = false;
        console.log('🆕 Nueva conversación iniciada');
    }

    /**
     * Limpia el historial de la conversación actual
     */
    limpiarHistorial(): void {
        if (this.mensajes.length === 0) {
            alert('No hay mensajes para limpiar.');
            return;
        }

        const confirmar = confirm('¿Borrar el historial de esta conversación?\n\nEsta acción no se puede deshacer.');
        if (!confirmar) return;

        this.iaService.limpiarConversacion().subscribe({
            next: () => {
                this.planDetectado = null;
                this.mostrarJson = false;
                console.log('🗑️ Historial limpiado');
            },
            error: (error) => {
                console.error('❌ Error limpiando historial:', error);
                alert(`Error al limpiar historial:\n\n${error.message}`);
            }
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    // CONFIGURACIÓN
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Configura la API Key de Perplexity
     */
    configurarApiKey(): void {
        const apiKey = prompt('Introduce tu API Key de Perplexity:\n\n(Se guardará de forma segura en tu navegador)');

        if (!apiKey || !apiKey.trim()) {
            return;
        }

        console.log('🔑 Validando API Key...');

        this.iaService.validarApiKey(apiKey.trim()).subscribe({
            next: (resultado) => {
                if (resultado.valida) {
                    this.iaService.setApiKey(apiKey.trim());
                    this.apiKeyConfigurada = true;
                    alert('✅ API Key configurada correctamente');
                    console.log('✅ API Key válida y guardada');
                } else {
                    alert(`❌ API Key inválida:\n\n${resultado.error}`);
                    console.error('❌ API Key inválida:', resultado.error);
                }
            },
            error: (error) => {
                alert(`❌ Error al validar API Key:\n\n${error.message}`);
                console.error('❌ Error validando API Key:', error);
            }
        });
    }

    /**
     * Elimina la API Key guardada
     */
    eliminarApiKey(): void {
        const confirmar = confirm('¿Eliminar la API Key guardada?\n\nTendrás que configurarla de nuevo para usar el chat.');
        if (!confirmar) return;

        this.iaService.setApiKey(null);
        this.apiKeyConfigurada = false;
        console.log('🔑 API Key eliminada');
    }

    // ══════════════════════════════════════════════════════════════════════
    // UTILIDADES
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Hace scroll al final del contenedor de mensajes
     */
    private scrollToBottom(): void {
        try {
            if (this.mensajesContainer) {
                this.mensajesContainer.nativeElement.scrollTop =
                    this.mensajesContainer.nativeElement.scrollHeight;
            }
        } catch (err) {
            console.error('Error al hacer scroll:', err);
        }
    }

    /**
     * Toggle para mostrar/ocultar JSON del plan
     */
    toggleMostrarJson(): void {
        this.mostrarJson = !this.mostrarJson;
    }

    /**
     * Formatea una fecha ISO a formato legible
     */
    formatearFecha(fecha: string): string {
        const date = new Date(fecha);
        return date.toLocaleString('es-ES', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    /**
     * Copia el JSON del plan al portapapeles
     */
    copiarJson(): void {
        if (!this.planDetectado) return;

        const json = JSON.stringify(this.planDetectado, null, 2);
        navigator.clipboard.writeText(json).then(() => {
            alert('✅ JSON copiado al portapapeles');
        }).catch(err => {
            console.error('Error copiando JSON:', err);
            alert('❌ Error al copiar JSON');
        });
    }

    /**
     * Cuenta el total de actividades en todos los itinerarios
     */
    contarActividades(plan: PlanEstructurado): number {
        return plan.itinerarios.reduce((total, itinerario) => {
            return total + (itinerario.actividades?.length || 0);
        }, 0);
    }
}
