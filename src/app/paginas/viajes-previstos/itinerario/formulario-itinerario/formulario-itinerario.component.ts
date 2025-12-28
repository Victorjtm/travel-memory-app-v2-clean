import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ItinerarioService } from '../../../../servicios/itinerario.service';
import { Itinerario } from '../../../../modelos/viaje-previsto.model';
import { HttpClientModule } from '@angular/common/http';

@Component({
  selector: 'app-formulario-itinerario',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    HttpClientModule
  ],
  templateUrl: './formulario-itinerario.component.html',
  styleUrls: ['./formulario-itinerario.component.scss']
})
export class FormularioItinerarioComponent implements OnInit {

  viajePrevistoId!: number;

  // Propiedades para reconocimiento de voz
  private recognition: any;
  estaGrabando: boolean = false;
  soportaReconocimientoVoz: boolean = false;
  textoReconocido: string = '';
  textoEnTiempoReal: string = ''; // ✅ NUEVA PROPIEDAD
  mensajeError: string = '';

  nuevoItinerario: Itinerario = {
    id: 0,
    viajePrevistoId: 0,
    fechaInicio: '',
    fechaFin: '',
    duracionDias: 0,
    destinosPorDia: '',
    descripcionGeneral: '',
    horaInicio: '',
    horaFin: '',
    climaGeneral: '',
    tipoDeViaje: 'costa'
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private itinerarioService: ItinerarioService
  ) {}

ngOnInit(): void {
  this.route.paramMap.subscribe(params => {
    const idParam = params.get('viajePrevistoId');
    if (idParam) {
      this.viajePrevistoId = +idParam;
      this.nuevoItinerario.viajePrevistoId = this.viajePrevistoId;
    }
  });

  // ✅ Valores por defecto para horas
  this.nuevoItinerario.horaInicio = '00:00';
  this.nuevoItinerario.horaFin = '23:59';
  
  // Inicializar reconocimiento de voz
  this.inicializarReconocimientoVoz();
}

/**
 * Se ejecuta cada vez que el usuario cambia la fecha de inicio
 */
onFechaInicioChange(): void {
  if (this.nuevoItinerario.fechaInicio) {
    // ✅ Copiar fecha fin si está vacía o es anterior
    if (!this.nuevoItinerario.fechaFin ||
        this.nuevoItinerario.fechaFin < this.nuevoItinerario.fechaInicio) {
      this.nuevoItinerario.fechaFin = this.nuevoItinerario.fechaInicio;
    }
    this.calcularDuracionDias();
  }
}

/**
 * Se ejecuta cuando el usuario cambia la fecha fin
 */
onFechaFinChange(): void {
  if (this.nuevoItinerario.fechaFin) {
    this.calcularDuracionDias();
  }
}

/**
 * ✅ Calcula los días de duración = diferencia en días + 1
 */
private calcularDuracionDias(): void {
  if (this.nuevoItinerario.fechaInicio && this.nuevoItinerario.fechaFin) {
    const inicio = new Date(this.nuevoItinerario.fechaInicio);
    const fin = new Date(this.nuevoItinerario.fechaFin);
    const diffMs = fin.getTime() - inicio.getTime();

    if (diffMs >= 0) {
      const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      this.nuevoItinerario.duracionDias = diffDias + 1;
    } else {
      // Si el usuario pone una fecha fin anterior, duracion mínima 1
      this.nuevoItinerario.duracionDias = 1;
    }
  }
}



agregarItinerario(): void {
    const itinerarioAEnviar = { ...this.nuevoItinerario, viajePrevistoId: this.viajePrevistoId };
    this.itinerarioService.crearItinerario(itinerarioAEnviar).subscribe(() => {
      console.log('✅ Itinerario agregado con éxito');
      this.router.navigate(['/itinerarios', this.viajePrevistoId]);
    });
  }

  /**
   * Inicializa el reconocimiento de voz si está disponible
   */
  private inicializarReconocimientoVoz(): void {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (SpeechRecognition) {
      this.soportaReconocimientoVoz = true;
this.recognition = new SpeechRecognition();

// ✅ CONFIGURACIÓN MEJORADA
this.recognition.continuous = false; // Cambiar a false para mejor captura
this.recognition.interimResults = true;
this.recognition.lang = 'es-ES';
this.recognition.maxAlternatives = 1;
this.recognition.serviceURI = undefined; // Usar servicio por defecto

console.log('🔧 Reconocimiento configurado:', {
  continuous: this.recognition.continuous,
  interimResults: this.recognition.interimResults,
  lang: this.recognition.lang
});
      
      // Eventos del reconocimiento
this.recognition.onstart = () => {
  this.estaGrabando = true;
  this.mensajeError = '';
  this.textoReconocido = '';
  this.textoEnTiempoReal = ''; // ✅ LIMPIAR TEXTO EN TIEMPO REAL
};
      
this.recognition.onresult = (event: any) => {
  console.log('🎤 Evento onresult disparado:', event.results.length, 'resultados');
  
  let textoCompleto = '';
  let textoTemporal = '';
  
  for (let i = 0; i < event.results.length; i++) {
    const transcript = event.results[i][0].transcript;
    const confidence = event.results[i][0].confidence;
    const isFinal = event.results[i].isFinal;
    
    console.log(`Resultado ${i}:`, {
      transcript,
      confidence,
      isFinal
    });
    
    if (isFinal) {
      textoCompleto += transcript + ' ';
    } else {
      textoTemporal += transcript + ' ';
    }
  }
  
  this.textoReconocido = textoCompleto.trim();
  this.textoEnTiempoReal = (textoCompleto + textoTemporal).trim();
  
  console.log('💾 Texto actualizado:', {
    textoReconocido: this.textoReconocido,
    textoEnTiempoReal: this.textoEnTiempoReal
  });
};
      
      this.recognition.onend = () => {
        this.estaGrabando = false;
        if (this.textoReconocido) {
          this.procesarTextoDictado(this.textoReconocido);
        }
      };
      
this.recognition.onerror = (event: any) => {
  this.estaGrabando = false;
  this.mensajeError = 'Error en el reconocimiento de voz: ' + event.error;
  console.error('❌ Error de reconocimiento:', event.error, event);
};

// ✅ AGREGAR NUEVOS EVENTOS
this.recognition.onnomatch = (event: any) => {
  console.log('🤷 No se encontró coincidencia:', event);
  this.mensajeError = 'No se pudo reconocer lo que dijiste. Intenta hablar más claro.';
};

this.recognition.onsoundstart = () => {
  console.log('🔊 Sonido detectado');
};

this.recognition.onsoundend = () => {
  console.log('🔇 Sonido terminado');
};

this.recognition.onspeechstart = () => {
  console.log('🗣️ Habla detectada');
};

this.recognition.onspeechend = () => {
  console.log('🤐 Habla terminada');
};
} else {
      this.soportaReconocimientoVoz = false;
      this.mensajeError = 'Tu navegador no soporta reconocimiento de voz. Usa Chrome, Firefox o Safari.';
    }
    
    // Detectar si estamos en HTTP (no seguro)
    if (location.protocol === 'http:' && location.hostname !== 'localhost') {
      this.mensajeError = '⚠️ El reconocimiento de voz requiere HTTPS. Accede desde https:// o usa http://localhost:4200/ en su lugar.';
      this.soportaReconocimientoVoz = false;
    }
  }

/**
   * Inicia o para el dictado por voz
   */
private timeoutDictado: any;

async toggleDictado(): Promise<void> {
  if (this.estaGrabando) {
    // ✅ PROCESAR TEXTO ANTES DE PARAR
    console.log('🎤 Texto capturado al parar:', this.textoReconocido);
    console.log('🎤 Texto en tiempo real al parar:', this.textoEnTiempoReal);
    
    // Procesar cualquier texto disponible
    const textoParaProcesar = this.textoReconocido || this.textoEnTiempoReal;
    if (textoParaProcesar.trim()) {
      this.procesarTextoDictado(textoParaProcesar);
    }
    
    this.recognition.stop();
    
    // Limpiar timeout si existe
    if (this.timeoutDictado) {
      clearTimeout(this.timeoutDictado);
    }
  } else {
    // Solicitar permisos de micrófono antes de iniciar
    try {
      await this.solicitarPermisosMicrofono();
      console.log('🎤 Iniciando reconocimiento...');
      this.recognition.start();
      
      // ✅ TIMEOUT DE SEGURIDAD: parar automáticamente después de 10 segundos
      this.timeoutDictado = setTimeout(() => {
        if (this.estaGrabando) {
          console.log('⏰ Timeout alcanzado, parando dictado');
          this.toggleDictado();
        }
      }, 10000);
      
    } catch (error) {
      this.mensajeError = 'Es necesario permitir el acceso al micrófono para usar esta función';
      console.error('Error de permisos:', error);
    }
  }
}

  /**
   * Solicita permisos de micrófono explícitamente
   */
  private async solicitarPermisosMicrofono(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Parar el stream inmediatamente, solo necesitamos el permiso
      stream.getTracks().forEach(track => track.stop());
      this.mensajeError = '';
    } catch (error: any) {
      if (error.name === 'NotAllowedError') {
        throw new Error('Permisos de micrófono denegados');
      } else if (error.name === 'NotFoundError') {
        throw new Error('No se encontró micrófono');
      } else {
        throw new Error('Error al acceder al micrófono');
      }
    }
  }

/**
 * Procesa el texto dictado y rellena el formulario
 */
private procesarTextoDictado(texto: string): void {
  try {
    console.log('🔍 Procesando texto:', texto);
    
    // Convertir a minúsculas para facilitar el procesamiento
    const textoLimpio = texto.toLowerCase();
    
    // Extraer destino/itinerario (antes de "día")
    const regexDestino = /(?:itinerario|destino)\s+([^día]+?)(?=día|$)/i;
    const matchDestino = textoLimpio.match(regexDestino);
    
    // Extraer y procesar fecha con múltiples formatos
    const fechaExtraida = this.extraerFecha(textoLimpio);
    
    if (matchDestino && fechaExtraida) {
      const nombreItinerario = matchDestino[1].trim();
      
      // Rellenar destinosPorDia (textarea)
      this.nuevoItinerario.destinosPorDia = nombreItinerario;
      
      // Rellenar fechas (formato YYYY-MM-DD para input date)
      this.nuevoItinerario.fechaInicio = fechaExtraida;
      this.nuevoItinerario.fechaFin = fechaExtraida;
      
      // Disparar el cálculo de duración manualmente
      this.calcularDuracionDias();
      
      // Valores por defecto
      this.nuevoItinerario.climaGeneral = 'Despejado';
      this.nuevoItinerario.tipoDeViaje = 'naturaleza';
      this.nuevoItinerario.horaInicio = '00:00';
      this.nuevoItinerario.horaFin = '23:59';
      
      this.mensajeError = '';
      console.log('✅ Formulario rellenado:', {
        destinosPorDia: nombreItinerario,
        fechaInicio: this.nuevoItinerario.fechaInicio,
        fechaFin: this.nuevoItinerario.fechaFin,
        duracionDias: this.nuevoItinerario.duracionDias
      });
      
    } else {
      this.mensajeError = 'Formato incorrecto. Ejemplos válidos: "Destino Barcelona día 25 del 9 del 2025" o "Itinerario Madrid día veinticinco de septiembre del 2025"';
      console.log('❌ No coincide el patrón. Texto recibido:', textoLimpio);
      console.log('❌ Destino encontrado:', matchDestino ? matchDestino[1] : 'NO');
      console.log('❌ Fecha encontrada:', fechaExtraida ? fechaExtraida : 'NO');
    }
    
  } catch (error) {
    this.mensajeError = 'Error al procesar el texto dictado';
    console.error('Error procesando dictado:', error);
  }
}
/**
 * Extrae fecha de texto dictado con múltiples formatos
 */
private extraerFecha(texto: string): string | null {
  try {
    // Diccionario de números en español
    const numeros: { [key: string]: string } = {
      'uno': '1', 'dos': '2', 'tres': '3', 'cuatro': '4', 'cinco': '5',
      'seis': '6', 'siete': '7', 'ocho': '8', 'nueve': '9', 'diez': '10',
      'once': '11', 'doce': '12', 'trece': '13', 'catorce': '14', 'quince': '15',
      'dieciséis': '16', 'diecisiete': '17', 'dieciocho': '18', 'diecinueve': '19',
      'veinte': '20', 'veintiuno': '21', 'veintidós': '22', 'veintitrés': '23',
      'veinticuatro': '24', 'veinticinco': '25', 'veintiséis': '26', 'veintisiete': '27',
      'veintiocho': '28', 'veintinueve': '29', 'treinta': '30', 'treinta y uno': '31'
    };

    const meses: { [key: string]: string } = {
      'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
      'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
      'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
    };

const años: { [key: string]: string } = {
  'dosmilveinticinco': '2025', 'dos mil veinticinco': '2025',
  'dosmilveinticuatro': '2024', 'dos mil veinticuatro': '2024',
  'dosmilveintiséis': '2026', 'dos mil veintiséis': '2026',
  'dosmilveintisiete': '2027', 'dos mil veintisiete': '2027',
  'dosmilveintiocho': '2028', 'dos mil veintiocho': '2028',
  'dosmilveintinueve': '2029', 'dos mil veintinueve': '2029',
  'dosmiltreinta': '2030', 'dos mil treinta': '2030'
};

// Convertir años PRIMERO (para evitar conflictos)
let textoNormalizado = texto;
Object.keys(años).forEach(palabra => {
  textoNormalizado = textoNormalizado.replace(new RegExp(palabra, 'gi'), años[palabra]);
});

// Luego convertir números individuales
Object.keys(numeros).forEach(palabra => {
  textoNormalizado = textoNormalizado.replace(new RegExp(`\\b${palabra}\\b`, 'gi'), numeros[palabra]);
});

    console.log('🗣️ Texto normalizado:', textoNormalizado);

    // Patrones de fecha flexibles
    const patrones = [
      // "día 25 del 9 del 2025"
      /día\s+(\d{1,2})\s+del\s+(\d{1,2})\s+del\s+(\d{4})/i,
      
      // "día veinticinco del nueve del 2025" (ya convertido a números)
      /día\s+(\d{1,2})\s+del\s+(\d{1,2})\s+del\s+(\d{4})/i,
      
      // "día 25 de septiembre del 2025"
      /día\s+(\d{1,2})\s+de\s+(\w+)\s+del\s+(\d{4})/i,
      
      // "día 25/9/2025" o "día 25-9-2025"
      /día\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i,
      
      // "día 25 9 2025" (solo espacios)
      /día\s+(\d{1,2})\s+(\d{1,2})\s+(\d{4})/i
    ];

    for (const patron of patrones) {
      const match = textoNormalizado.match(patron);
      if (match) {
        let dia = match[1];
        let mes = match[2];
        let año = match[3];

        // Si el mes es texto (septiembre, enero, etc.)
        if (meses[mes.toLowerCase()]) {
          mes = meses[mes.toLowerCase()];
        }

        // Validar rangos
        const diaNum = parseInt(dia);
        const mesNum = parseInt(mes);
        const añoNum = parseInt(año);

        if (diaNum >= 1 && diaNum <= 31 && mesNum >= 1 && mesNum <= 12 && añoNum >= 2020 && añoNum <= 2030) {
          const fechaFormateada = `${año}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
          console.log('✅ Fecha extraída:', fechaFormateada);
          return fechaFormateada;
        }
      }
    }

    console.log('❌ No se pudo extraer fecha del texto');
    return null;

  } catch (error) {
    console.error('Error extrayendo fecha:', error);
    return null;
  }
}
}
