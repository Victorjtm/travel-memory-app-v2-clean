// src/app/paginas/viajes-previstos/formulario-archivos.helpers.ts

export type TipoArchivo = 'foto' | 'video' | 'audio' | 'texto' | 'imagen';

// Función para detectar tipo desde nombre de archivo
export function detectarTipoDesdeNombre(tipo: string): TipoArchivo | undefined {
  switch (tipo) {
    case 'img': return 'foto';
    case 'vid': return 'video';
    case 'audio': return 'audio';
    default: return undefined;
  }
}

// Función para obtener hora actual
export function getHoraActual(): string {
  const ahora = new Date();
  return ahora.toTimeString().substring(0, 5); // HH:mm
}

// Función para validar fecha y hora
export function validarFechaHora(año: number, mes: number, dia: number, hora: number, minuto: number, segundo: number): boolean {
  if (año < 1900 || año > 2100) return false;
  if (mes < 1 || mes > 12) return false;
  if (dia < 1 || dia > 31) return false;
  if (hora < 0 || hora > 23) return false;
  if (minuto < 0 || minuto > 59) return false;
  if (segundo < 0 || segundo > 59) return false;

  const fechaTest = new Date(año, mes - 1, dia);
  return fechaTest.getFullYear() === año && 
         fechaTest.getMonth() === mes - 1 && 
         fechaTest.getDate() === dia;
}

// Función para extraer mensaje de error
export function extraerMensajeError(error: any): string {
  if (error?.error?.message) {
    return error.error.message;
  }
  if (error?.message) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Error desconocido';
}

// Función para parsear nombre de archivo y extraer metadatos
export function parsearNombreArchivoCompleto(nombre: string): { fechaISO: string, horaCaptura: string, tipoDetectado?: TipoArchivo } | null {
  console.log(`[📂 INICIO PARSEO] ${nombre}`);

  // Regex flexible: cualquier separador no numérico (\D+) entre secciones, incluso texto intermedio
  const regex = /(IMG|VID|AUDIO)?(?:\D*\w*\D*)?(\d{4})\D*(\d{2})\D*(\d{2})\D*(\d{2})\D*(\d{2})\D*(\d{2})/i;

  const match = nombre.match(regex);

  if (!match) {
    console.log(`[❌ NO MATCH] ${nombre} no coincide con el patrón de fecha`);
    return null;
  }

  console.log(`[✅ MATCH] Valores extraídos:`, match);

  const tipoRaw = match[1]?.toLowerCase() || '';
  const año = match[2];
  const mes = match[3];
  const dia = match[4];
  const hora = match[5];
  const minuto = match[6];
  const segundo = match[7];

  console.log(`Tipo raw: ${tipoRaw}, Fecha: ${año}-${mes}-${dia}, Hora: ${hora}:${minuto}:${segundo}`);

  // Crear fecha local
  const fechaLocal = new Date(Number(año), Number(mes) - 1, Number(dia), Number(hora), Number(minuto), Number(segundo));
  const horaCaptura = `${hora}:${minuto}:${segundo}`;

  // Construir ISO local para evitar desfase UTC
  const fechaISO = `${fechaLocal.getFullYear()}-${(fechaLocal.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${fechaLocal.getDate().toString().padStart(2, '0')}T${fechaLocal
    .getHours()
    .toString()
    .padStart(2, '0')}:${fechaLocal.getMinutes().toString().padStart(2, '0')}:${fechaLocal
    .getSeconds()
    .toString()
    .padStart(2, '0')}`;

  console.log(`Fecha ISO: ${fechaISO}, Hora captura: ${horaCaptura}`);

  const tipoDetectado = detectarTipoDesdeNombre(tipoRaw);
  if (tipoDetectado) console.log(`Tipo detectado: ${tipoDetectado}`);

  return {
    fechaISO,
    horaCaptura,
    tipoDetectado
  };
}
