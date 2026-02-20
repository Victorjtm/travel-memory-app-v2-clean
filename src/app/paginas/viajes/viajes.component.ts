// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPONENTE: LISTADO DE VIAJES FUTUROS
// Fecha: 2026-02-15
// Descripción: Lista de viajes planificados con IA, clickeables al detalle
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ViajesFuturosService, ViajeFuturo } from '../../servicios/viajes-futuros.service';

@Component({
  selector: 'app-viajes',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './viajes.component.html',
  styleUrls: ['./viajes.component.scss']
})
export class ViajesComponent implements OnInit {

  // ══════════════════════════════════════════════════════════════════════
  // PROPIEDADES
  // ══════════════════════════════════════════════════════════════════════

  viajes: ViajeFuturo[] = [];
  cargando: boolean = true;
  error: string | null = null;

  // ══════════════════════════════════════════════════════════════════════
  // CONSTRUCTOR
  // ══════════════════════════════════════════════════════════════════════

  constructor(
    private viajesService: ViajesFuturosService,
    private router: Router
  ) { }

  // ══════════════════════════════════════════════════════════════════════
  // CICLO DE VIDA
  // ══════════════════════════════════════════════════════════════════════

  ngOnInit(): void {
    console.log('🚀 [ViajesComponent] Inicializando...');
    this.cargarViajesFuturos();
  }

  // ══════════════════════════════════════════════════════════════════════
  // MÉTODOS PRINCIPALES
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Cargar viajes futuros desde la API
   * Solo trae viajes con estado 'planificado'
   */
  cargarViajesFuturos(): void {
    this.cargando = true;
    this.error = null;

    console.log('📋 [ViajesComponent] Cargando viajes futuros...');

    this.viajesService.obtenerViajesFuturos('planificado').subscribe({
      next: (viajes) => {
        this.viajes = viajes;
        this.cargando = false;
        console.log(`✅ [ViajesComponent] ${viajes.length} viajes cargados:`, viajes);
      },
      error: (error) => {
        console.error('❌ [ViajesComponent] Error cargando viajes:', error);
        this.error = error.error?.error || 'Error al cargar los viajes';
        this.cargando = false;
      }
    });
  }

  /**
   * Navegar al detalle del viaje
   */
  verDetalle(id: number): void {
    console.log(`🔍 [ViajesComponent] Navegando a detalle del viaje ID: ${id}`);
    this.router.navigate(['/viaje-futuro', id]);
  }

  // ══════════════════════════════════════════════════════════════════════
  // MÉTODOS AUXILIARES
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Formatear fecha ISO a formato DD/MM/YYYY
   */
  formatearFecha(fecha: string): string {
    if (!fecha) return '';
    const [year, month, day] = fecha.split('-');
    return `${day}/${month}/${year}`;
  }

  /**
   * Obtener icono según estado del viaje
   */
  getIconoEstado(estado?: string): string {
    return estado === 'migrado' ? '✅' : '📅';
  }

  /**
   * Calcular días hasta el viaje
   */
  diasHastaViaje(fechaInicio: string): number {
    const hoy = new Date();
    const inicio = new Date(fechaInicio);
    const diff = inicio.getTime() - hoy.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  /**
   * Obtener etiqueta de tiempo
   */
  getEtiquetaTiempo(fechaInicio: string): string {
    const dias = this.diasHastaViaje(fechaInicio);

    if (dias < 0) return 'En curso o pasado';
    if (dias === 0) return '¡Hoy!';
    if (dias === 1) return 'Mañana';
    if (dias <= 7) return `En ${dias} días`;
    if (dias <= 30) return `En ${Math.ceil(dias / 7)} semanas`;
    return `En ${Math.ceil(dias / 30)} meses`;
  }
}
