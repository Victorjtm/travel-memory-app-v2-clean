const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

let ffmpegStatic = null;
try {
  ffmpegStatic = require(path.join(process.cwd(), 'node_modules/ffmpeg-static'));
} catch (e) {
  try { ffmpegStatic = require('ffmpeg-static'); } catch (e2) {}
}

let sharp = null;
try {
  sharp = require(path.join(process.cwd(), 'node_modules/sharp'));
} catch (e) {
  try { sharp = require('sharp'); } catch (e2) {}
}

const FFMPEG_BIN = ffmpegStatic || 'ffmpeg';

const UPLOADS_DIR = path.resolve(__dirname, '../../../uploads');
const ASSETS_DIR = path.resolve(__dirname, '../../../src/assets');

/**
 * Resuelve una URL o ruta relativa al sistema de archivos local
 */
function resolverRutaLocal(url) {
  if (!url) return null;
  let clean = url.replace(/^https?:\/\/[^\/]+/, '');
  clean = clean.split('?')[0].split('#')[0];

  if (clean.startsWith('/assets/')) {
    const p1 = path.join(ASSETS_DIR, clean.replace('/assets/', ''));
    if (fs.existsSync(p1)) return p1;
    const p2 = path.join(UPLOADS_DIR, clean.replace('/assets/', ''));
    if (fs.existsSync(p2)) return p2;
    const p3 = path.resolve(__dirname, '../..', clean.substring(1));
    if (fs.existsSync(p3)) return p3;
    const p4 = path.resolve(process.cwd(), 'src/assets', clean.replace('/assets/', ''));
    if (fs.existsSync(p4)) return p4;
  }

  const relUpload = clean.replace(/^\/?uploads\//, '');
  const pUpload = path.join(UPLOADS_DIR, relUpload);
  if (fs.existsSync(pUpload)) return pUpload;

  if (fs.existsSync(clean)) return clean;
  if (fs.existsSync(url)) return url;

  return null;
}

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG_BIN, args, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`FFmpeg error: ${error.message}\n${stderr}`));
      }
      resolve();
    });
  });
}

function videoTieneAudio(filePath) {
  return new Promise((resolve) => {
    execFile(FFMPEG_BIN, ['-i', filePath], (err, stdout, stderr) => {
      const output = stderr || '';
      resolve(output.includes('Audio:'));
    });
  });
}

function obtenerDuracionAudio(filePath) {
  return new Promise((resolve) => {
    execFile(FFMPEG_BIN, ['-i', filePath], (err, stdout, stderr) => {
      const match = (stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
      if (match) {
        const secs = parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseFloat(match[3]);
        resolve(secs);
      } else {
        resolve(4);
      }
    });
  });
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function esNombreArchivoCrudo(t) {
  if (!t) return false;
  const lower = t.toLowerCase();
  return /^(jpeg|video|img|dsc|rec|recording|photo|audi)[\w\d_\-\.]+/i.test(lower) ||
         /\.(jpg|jpeg|png|mp4|aac|mp3|m4a)$/i.test(lower);
}

// =========================================================================
// MÓDULO 1: RENDERIZADOR DE ÁLBUM VINTAGE CON SHARP (DIARIO DE VIAJE 3D)
// =========================================================================

/**
 * Genera la base del pliego abierto del libro (Mesa, cuero, hojas apiladas, pergamino, lomo con costura)
 */
function generarSvgBaseLibroVintage() {
  return `
    <svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <!-- Fondo de mesa de madera cálida con viñeta -->
        <radialGradient id="deskGlow" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stop-color="#2a1c12"/>
          <stop offset="50%" stop-color="#180f09"/>
          <stop offset="100%" stop-color="#0a0604"/>
        </radialGradient>
        <linearGradient id="leatherGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#382115"/>
          <stop offset="100%" stop-color="#1f0f08"/>
        </linearGradient>
        <linearGradient id="parchmentLeft" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#faf6ee"/>
          <stop offset="85%" stop-color="#f5eedc"/>
          <stop offset="100%" stop-color="#d9c7ad"/>
        </linearGradient>
        <linearGradient id="parchmentRight" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#d9c7ad"/>
          <stop offset="15%" stop-color="#f5eedc"/>
          <stop offset="100%" stop-color="#faf6ee"/>
        </linearGradient>
        <linearGradient id="spineShadow" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="rgba(0,0,0,0.4)"/>
          <stop offset="42%" stop-color="rgba(0,0,0,0.1)"/>
          <stop offset="50%" stop-color="rgba(255,255,255,0.18)"/>
          <stop offset="58%" stop-color="rgba(0,0,0,0.1)"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0.4)"/>
        </linearGradient>
      </defs>

      <!-- Mesa de madera -->
      <rect width="1920" height="1080" fill="url(#deskGlow)"/>

      <!-- Cubierta de cuero del libro con relieve -->
      <rect x="68" y="45" width="1784" height="990" rx="18" fill="#000000" opacity="0.65"/>
      <rect x="74" y="48" width="1772" height="984" rx="16" fill="url(#leatherGrad)"/>
      <rect x="80" y="54" width="1760" height="972" rx="12" fill="none" stroke="#8a6528" stroke-width="2" stroke-opacity="0.55"/>

      <!-- Hojas apiladas laterales (grosor) -->
      <rect x="78" y="58" width="16" height="964" rx="2" fill="#d2c1a2"/>
      <rect x="1826" y="58" width="16" height="964" rx="2" fill="#d2c1a2"/>

      <!-- Página izquierda de pergamino -->
      <rect x="94" y="58" width="856" height="964" rx="4" fill="url(#parchmentLeft)"/>

      <!-- Página derecha de pergamino -->
      <rect x="970" y="58" width="856" height="964" rx="4" fill="url(#parchmentRight)"/>

      <!-- Sombras de curvatura hacia el lomo central -->
      <rect x="900" y="58" width="50" height="964" fill="black" opacity="0.12"/>
      <rect x="970" y="58" width="50" height="964" fill="black" opacity="0.12"/>

      <!-- Lomo central con hendidura y costura -->
      <rect x="948" y="58" width="24" height="964" fill="url(#spineShadow)"/>
      <line x1="960" y1="58" x2="960" y2="1022" stroke="#5a3a1c" stroke-width="2" stroke-dasharray="4,8" opacity="0.8"/>

      <!-- Esquineras decorativas doradas en las puntas exteriores -->
      <path d="M 104 90 L 104 68 L 126 68" fill="none" stroke="#bfa15f" stroke-width="3"/>
      <path d="M 1816 90 L 1816 68 L 1794 68" fill="none" stroke="#bfa15f" stroke-width="3"/>
      <path d="M 104 992 L 104 1014 L 126 1014" fill="none" stroke="#bfa15f" stroke-width="3"/>
      <path d="M 1816 992 L 1816 1014 L 1794 1014" fill="none" stroke="#bfa15f" stroke-width="3"/>
    </svg>
  `;
}

/**
 * Renderiza el Pliego 0 (Portada interior con marco ornamentado, títulos, fechas y estadísticas)
 */
async function renderizarPliego0Vintage(baseBookBuf, infoViaje, stats = {}, pagDerecha = null, tmpDir) {
  const tituloViaje = escapeXml(infoViaje?.nombre || 'Mi Viaje').toUpperCase();
  const descViaje = escapeXml(infoViaje?.descripcion || 'Diario de viaje y recuerdos inolvidables');
  const fechasTexto = escapeXml(infoViaje?.fechaInicio ? `${infoViaje.fechaInicio} ${infoViaje.fechaFin ? '— ' + infoViaje.fechaFin : ''}` : '');
  const totRecuerdos = escapeXml(String(stats.totalRecuerdos || '366'));
  const totItinerarios = escapeXml(String(stats.totalItinerarios || '1'));

  let overlaySvg = `
    <svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000000" flood-opacity="0.22"/>
        </filter>
      </defs>

      <!-- PÁGINA IZQUIERDA: MARCO PERGAMINO ORNAMENTADO DE PORTADA -->
      <g>
        <rect x="150" y="140" width="750" height="800" rx="6" fill="#fdfaf3" fill-opacity="0.65" stroke="#bfa15f" stroke-width="2"/>
        <path d="M 160 170 L 160 150 L 180 150" fill="none" stroke="#b8860b" stroke-width="3"/>
        <path d="M 890 170 L 890 150 L 870 150" fill="none" stroke="#b8860b" stroke-width="3"/>
        <path d="M 160 910 L 160 930 L 180 930" fill="none" stroke="#b8860b" stroke-width="3"/>
        <path d="M 890 910 L 890 930 L 870 930" fill="none" stroke="#b8860b" stroke-width="3"/>

        <!-- Título principal en mayúsculas estilo serif noble -->
        <text x="525" y="270" fill="#2b1810" font-family="Cinzel, Georgia, serif" font-size="38" font-weight="bold" text-anchor="middle" letter-spacing="3">${tituloViaje}</text>
        <line x1="325" y1="310" x2="725" y2="310" stroke="#bfa15f" stroke-width="2"/>

        <!-- Fechas del viaje -->
        <text x="525" y="360" fill="#8b6b47" font-family="Georgia, serif" font-style="italic" font-size="20" text-anchor="middle">${fechasTexto}</text>

        <!-- Descripción del viaje -->
        <foreignObject x="210" y="410" width="630" height="230">
          <p xmlns="http://www.w3.org/1999/xhtml" style="font-family: Georgia, serif; font-size: 19px; line-height: 1.6; color: #4a3828; text-align: center; margin: 0;">
            ${descViaje}
          </p>
        </foreignObject>

        <!-- Pastillas de estadísticas (Recuerdos e Itinerarios) -->
        <g transform="translate(325, 690)">
          <rect x="0" y="0" width="180" height="85" rx="8" fill="#ffffff" fill-opacity="0.9" stroke="#bfa15f" stroke-width="1.5"/>
          <text x="90" y="44" fill="#8b5a2b" font-family="Cinzel, Georgia, serif" font-size="30" font-weight="bold" text-anchor="middle">${totRecuerdos}</text>
          <text x="90" y="70" fill="#7a6048" font-family="Georgia, serif" font-size="14" text-anchor="middle" letter-spacing="1">RECUERDOS</text>

          <rect x="220" y="0" width="180" height="85" rx="8" fill="#ffffff" fill-opacity="0.9" stroke="#bfa15f" stroke-width="1.5"/>
          <text x="310" y="44" fill="#8b5a2b" font-family="Cinzel, Georgia, serif" font-size="30" font-weight="bold" text-anchor="middle">${totItinerarios}</text>
          <text x="310" y="70" fill="#7a6048" font-family="Georgia, serif" font-size="14" text-anchor="middle" letter-spacing="1">ITINERARIOS</text>
        </g>

        <!-- Pie de página -->
        <text x="140" y="1000" fill="#8b6b47" font-family="Cinzel, Georgia, serif" font-size="15" opacity="0.7">PORTADA</text>
      </g>
  `;

  const composites = [];

  // PÁGINA DERECHA: Si hay primera foto o contenido
  if (pagDerecha && pagDerecha.url) {
    const localImg = resolverRutaLocal(pagDerecha.url);
    if (localImg && fs.existsSync(localImg)) {
      try {
        const pDerResized = await sharp(localImg).resize(680, 560, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
        const pDerX = 1056 + Math.round((680 - pDerResized.info.width) / 2);
        const pDerY = 150 + Math.round((560 - pDerResized.info.height) / 2);

        overlaySvg += `
          <!-- TARJETA FOTO PÁGINA DERECHA -->
          <g filter="url(#cardShadow)">
            <rect x="1036" y="130" width="720" height="820" rx="4" fill="#ffffff"/>
          </g>
          <!-- Esquineras doradas -->
          <path d="M ${pDerX - 2} ${pDerY + 16} L ${pDerX - 2} ${pDerY - 2} L ${pDerX + 16} ${pDerY - 2}" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
          <path d="M ${pDerX + pDerResized.info.width + 2} ${pDerY + 16} L ${pDerX + pDerResized.info.width + 2} ${pDerY - 2} L ${pDerX + pDerResized.info.width - 16} ${pDerY - 2}" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
          <path d="M ${pDerX - 2} ${pDerY + pDerResized.info.height - 16} L ${pDerX - 2} ${pDerY + pDerResized.info.height + 2} L ${pDerX + 16} ${pDerY + pDerResized.info.height + 2}" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
          <path d="M ${pDerX + pDerResized.info.width + 2} ${pDerY + pDerResized.info.height - 16} L ${pDerX + pDerResized.info.width + 2} ${pDerY + pDerResized.info.height + 2} L ${pDerX + pDerResized.info.width - 16} ${pDerY + pDerResized.info.height + 2}" fill="none" stroke="#bfa15f" stroke-width="3.5"/>

          <text x="1396" y="750" fill="#2b1810" font-family="Cinzel, Georgia, serif" font-size="22" font-weight="bold" text-anchor="middle">${escapeXml(pagDerecha.titulo || 'Primer recuerdo')}</text>
          <text x="1396" y="780" fill="#8b6b47" font-family="Georgia, serif" font-style="italic" font-size="16" text-anchor="middle">${escapeXml(pagDerecha.fecha || '')} ${pagDerecha.hora ? '· ' + escapeXml(pagDerecha.hora) + ' h' : ''}</text>
          <text x="1396" y="810" fill="#5c432d" font-family="Georgia, serif" font-size="16" text-anchor="middle">${escapeXml((pagDerecha.descripcion && pagDerecha.descripcion.length < 55) ? pagDerecha.descripcion : '')}</text>
          <text x="1780" y="1000" fill="#8b6b47" font-family="Cinzel, Georgia, serif" font-size="15" text-anchor="end" opacity="0.7">PÁG. 1</text>
        `;

        composites.push({ input: pDerResized.data, top: pDerY, left: pDerX });
      } catch (e) {
        console.warn('Error montando foto derecha pliego 0:', e.message);
      }
    }
  }

  overlaySvg += `</svg>`;

  composites.unshift({ input: Buffer.from(overlaySvg), top: 0, left: 0 });

  return await sharp(baseBookBuf).composite(composites).jpeg({ quality: 92 }).toBuffer();
}

/**
 * Renderiza un Pliego de Fotos Vintage (2 fotos o tarjeta con hueco para overlay de vídeo)
 */
async function renderizarPliegoFotosVintage(baseBookBuf, pIzq, pDer, pagIzqNum, pagDerNum) {
  let overlaySvg = `
    <svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000000" flood-opacity="0.22"/>
        </filter>
      </defs>
  `;

  const composites = [];

  // 1. PÁGINA IZQUIERDA
  if (pIzq) {
    overlaySvg += `
      <!-- Tarjeta blanca página izquierda -->
      <g filter="url(#cardShadow)">
        <rect x="164" y="130" width="720" height="820" rx="4" fill="#ffffff"/>
      </g>
    `;

    const tit = escapeXml((pIzq.titulo && !esNombreArchivoCrudo(pIzq.titulo) && pIzq.titulo.toLowerCase() !== 'itinerario') ? pIzq.titulo : '');
    const desc = escapeXml((pIzq.descripcion && !esNombreArchivoCrudo(pIzq.descripcion) && pIzq.descripcion.toLowerCase() !== 'itinerario' && pIzq.descripcion.length < 55) ? pIzq.descripcion : '');
    const fechaHora = escapeXml(`${pIzq.fecha || ''}${pIzq.hora ? ' · ' + pIzq.hora + ' h' : ''}`);

    overlaySvg += `
      <text x="524" y="750" fill="#2b1810" font-family="Cinzel, Georgia, serif" font-size="22" font-weight="bold" text-anchor="middle">${tit}</text>
      <text x="524" y="780" fill="#8b6b47" font-family="Georgia, serif" font-style="italic" font-size="16" text-anchor="middle">${fechaHora}</text>
      <text x="524" y="810" fill="#5c432d" font-family="Georgia, serif" font-size="16" text-anchor="middle">${desc}</text>
      <text x="140" y="1000" fill="#8b6b47" font-family="Cinzel, Georgia, serif" font-size="15" opacity="0.7">PÁG. ${pagIzqNum}</text>
    `;

    if (pIzq.tipoMedia === 'imagen' && pIzq.url) {
      const local = resolverRutaLocal(pIzq.url);
      if (local && fs.existsSync(local)) {
        try {
          const imgResized = await sharp(local).resize(680, 560, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
          const imgX = 184 + Math.round((680 - imgResized.info.width) / 2);
          const imgY = 150 + Math.round((560 - imgResized.info.height) / 2);

          overlaySvg += `
            <path d="M ${imgX - 2} ${imgY + 16} L ${imgX - 2} ${imgY - 2} L ${imgX + 16} ${imgY - 2}" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
            <path d="M ${imgX + imgResized.info.width + 2} ${imgY + 16} L ${imgX + imgResized.info.width + 2} ${imgY - 2} L ${imgX + imgResized.info.width - 16} ${imgY - 2}" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
            <path d="M ${imgX - 2} ${imgY + imgResized.info.height - 16} L ${imgX - 2} ${imgY + imgResized.info.height + 2} L ${imgX + 16} ${imgY + imgResized.info.height + 2}" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
            <path d="M ${imgX + imgResized.info.width + 2} ${imgY + imgResized.info.height - 16} L ${imgX + imgResized.info.width + 2} ${imgY + imgResized.info.height + 2} L ${imgX + imgResized.info.width - 16} ${imgY + imgResized.info.height + 2}" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
          `;

          composites.push({ input: imgResized.data, top: imgY, left: imgX });
        } catch (e) {
          console.warn('Error procesando imagen izquierda:', e.message);
        }
      }
    } else if (pIzq.tipoMedia === 'video') {
      // Dejar marco para el overlay de vídeo
      overlaySvg += `
        <rect x="184" y="150" width="680" height="560" fill="#181412" rx="2"/>
        <path d="M 182 166 L 182 148 L 200 148" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
        <path d="M 866 166 L 866 148 L 848 148" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
        <path d="M 182 694 L 182 712 L 200 712" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
        <path d="M 866 694 L 866 712 L 848 712" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
      `;
    }
  }

  // 2. PÁGINA DERECHA
  if (pDer) {
    overlaySvg += `
      <!-- Tarjeta blanca página derecha -->
      <g filter="url(#cardShadow)">
        <rect x="1036" y="130" width="720" height="820" rx="4" fill="#ffffff"/>
      </g>
    `;

    const tit = escapeXml((pDer.titulo && !esNombreArchivoCrudo(pDer.titulo) && pDer.titulo.toLowerCase() !== 'itinerario') ? pDer.titulo : '');
    const desc = escapeXml((pDer.descripcion && !esNombreArchivoCrudo(pDer.descripcion) && pDer.descripcion.toLowerCase() !== 'itinerario' && pDer.descripcion.length < 55) ? pDer.descripcion : '');
    const fechaHora = escapeXml(`${pDer.fecha || ''}${pDer.hora ? ' · ' + pDer.hora + ' h' : ''}`);

    overlaySvg += `
      <text x="1396" y="750" fill="#2b1810" font-family="Cinzel, Georgia, serif" font-size="22" font-weight="bold" text-anchor="middle">${tit}</text>
      <text x="1396" y="780" fill="#8b6b47" font-family="Georgia, serif" font-style="italic" font-size="16" text-anchor="middle">${fechaHora}</text>
      <text x="1396" y="810" fill="#5c432d" font-family="Georgia, serif" font-size="16" text-anchor="middle">${desc}</text>
      <text x="1780" y="1000" fill="#8b6b47" font-family="Cinzel, Georgia, serif" font-size="15" text-anchor="end" opacity="0.7">PÁG. ${pagDerNum}</text>
    `;

    if (pDer.tipoMedia === 'imagen' && pDer.url) {
      const local = resolverRutaLocal(pDer.url);
      if (local && fs.existsSync(local)) {
        try {
          const imgResized = await sharp(local).resize(680, 560, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
          const imgX = 1056 + Math.round((680 - imgResized.info.width) / 2);
          const imgY = 150 + Math.round((560 - imgResized.info.height) / 2);

          overlaySvg += `
            <path d="M ${imgX - 2} ${imgY + 16} L ${imgX - 2} ${imgY - 2} L ${imgX + 16} ${imgY - 2}" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
            <path d="M ${imgX + imgResized.info.width + 2} ${imgY + 16} L ${imgX + imgResized.info.width + 2} ${imgY - 2} L ${imgX + imgResized.info.width - 16} ${imgY - 2}" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
            <path d="M ${imgX - 2} ${imgY + imgResized.info.height - 16} L ${imgX - 2} ${imgY + imgResized.info.height + 2} L ${imgX + 16} ${imgY + imgResized.info.height + 2}" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
            <path d="M ${imgX + imgResized.info.width + 2} ${imgY + imgResized.info.height - 16} L ${imgX + imgResized.info.width + 2} ${imgY + imgResized.info.height + 2} L ${imgX + imgResized.info.width - 16} ${imgY + imgResized.info.height + 2}" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
          `;

          composites.push({ input: imgResized.data, top: imgY, left: imgX });
        } catch (e) {
          console.warn('Error procesando imagen derecha:', e.message);
        }
      }
    } else if (pDer.tipoMedia === 'video') {
      overlaySvg += `
        <rect x="1056" y="150" width="680" height="560" fill="#181412" rx="2"/>
        <path d="M 1054 166 L 1054 148 L 1072 148" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
        <path d="M 1738 166 L 1738 148 L 1720 148" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
        <path d="M 1054 694 L 1054 712 L 1072 712" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
        <path d="M 1738 694 L 1738 712 L 1720 712" fill="none" stroke="#bfa15f" stroke-width="3.5"/>
      `;
    }
  } else {
    // Si solo hay página izquierda (impar), página derecha en blanco con sello sutil
    overlaySvg += `
      <text x="1396" y="540" fill="#8b6b47" font-family="Cinzel, Georgia, serif" font-size="20" font-style="italic" text-anchor="middle" opacity="0.35">— Fin del Álbum —</text>
    `;
  }

  overlaySvg += `</svg>`;
  composites.unshift({ input: Buffer.from(overlaySvg), top: 0, left: 0 });

  return await sharp(baseBookBuf).composite(composites).jpeg({ quality: 92 }).toBuffer();
}

/**
 * Genera el SVG del marco de mapa con su cabecera completa (Título, Subtítulo, Distancia km y fecha)
 */
function generarSvgHeaderMapa(titulo = 'Itinerario de Ruta', subtitulo = '', distanciaKm = null, fecha = '', esVintage = true) {
  const tit = escapeXml(titulo || 'Itinerario').toUpperCase();
  const sub = escapeXml(subtitulo || '');
  const distNum = parseFloat(distanciaKm);
  const badgeDist = (!isNaN(distNum) && distNum > 0) ? `${distNum.toFixed(1)} km` : '';
  const fechaTexto = escapeXml(fecha || '');

  if (esVintage) {
    return `
      <svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="mapBarShadow" x="-5%" y="-5%" width="110%" height="110%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.5"/>
          </filter>
        </defs>

        <!-- Marco dorado perimetral del mapa -->
        <rect x="136" y="106" width="1648" height="868" rx="6" fill="none" stroke="#bfa15f" stroke-width="3"/>

        <!-- Pliegue central del lomo del libro sobre el mapa -->
        <rect x="948" y="108" width="24" height="864" fill="black" opacity="0.22"/>
        <line x1="960" y1="108" x2="960" y2="972" stroke="#5a3a1c" stroke-width="1.5" stroke-dasharray="4,8" opacity="0.6"/>

        <!-- Barra superior de telemetría y título -->
        <g filter="url(#mapBarShadow)">
          <rect x="156" y="120" width="1608" height="66" rx="10" fill="#140e0a" fill-opacity="0.94" stroke="#dfc488" stroke-width="1.8"/>

          <!-- Título del recorrido -->
          <text x="185" y="152" fill="#ffffff" font-family="Cinzel, Georgia, serif" font-size="22" font-weight="bold">${tit}</text>
          ${sub ? `<text x="185" y="173" fill="#c4a572" font-family="Georgia, serif" font-size="14">${sub}</text>` : ''}

          <!-- Badge de Distancia en km -->
          ${badgeDist ? `
            <g transform="translate(1530, 131)">
              <rect x="0" y="0" width="210" height="44" rx="22" fill="#2a1c12" stroke="#dfc488" stroke-width="1.5"/>
              <text x="105" y="28" fill="#facc15" font-family="Cinzel, Georgia, serif" font-size="18" font-weight="bold" text-anchor="middle">🛣️ ${badgeDist}</text>
            </g>
          ` : ''}

          <!-- Fecha si existe -->
          ${fechaTexto ? `
            <text x="${badgeDist ? 1510 : 1730}" y="158" fill="#dfc488" font-family="Georgia, serif" font-size="16" text-anchor="end">${fechaTexto}</text>
          ` : ''}
        </g>
      </svg>
    `;
  } else {
    // Modo moderno 16:9
    return `
      <svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="headerGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="rgba(0,0,0,0.88)"/>
            <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="1920" height="180" fill="url(#headerGrad)"/>
        <g transform="translate(80, 50)">
          <text x="0" y="36" fill="#ffffff" font-family="Segoe UI, Roboto, sans-serif" font-size="32" font-weight="bold">${tit}</text>
          ${sub ? `<text x="0" y="68" fill="#e2e8f0" font-family="Segoe UI, Roboto, sans-serif" font-size="20">${sub}</text>` : ''}
          ${badgeDist ? `
            <g transform="translate(1540, 0)">
              <rect x="0" y="0" width="220" height="48" rx="24" fill="#0f172a" stroke="#00D2FF" stroke-width="2"/>
              <text x="110" y="31" fill="#00D2FF" font-family="Segoe UI, Roboto, sans-serif" font-size="20" font-weight="bold" text-anchor="middle">🛣️ ${badgeDist}</text>
            </g>
          ` : ''}
        </g>
      </svg>
    `;
  }
}

/**
 * Renderiza la base del Pliego de Mapa Panorámico (Doble página unificada con hueco para el mapa)
 */
async function renderizarPliegoMapaPanoramicoBase(baseBookBuf) {
  const overlaySvg = Buffer.from(`
    <svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
      <rect x="136" y="106" width="1648" height="868" rx="6" fill="#14110e" stroke="#bfa15f" stroke-width="3"/>
    </svg>
  `);

  return await sharp(baseBookBuf).composite([{ input: overlaySvg, top: 0, left: 0 }]).jpeg({ quality: 92 }).toBuffer();
}


/**
 * Renderiza el Pliego de Carta Manuscrita
 */
async function renderizarPliegoCartaVintage(baseBookBuf, carta = {}) {
  const tit = escapeXml(carta.titulo || 'Diario de Viaje');
  const fecha = escapeXml(carta.fecha || '');
  const texto = escapeXml(carta.descripcion || '');

  const overlaySvg = Buffer.from(`
    <svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000000" flood-opacity="0.22"/>
        </filter>
      </defs>

      <!-- Tarjeta pergamino carta en página izquierda -->
      <g filter="url(#cardShadow)">
        <rect x="164" y="130" width="720" height="820" rx="4" fill="#faf4e8" stroke="#d5c19d" stroke-width="1.5"/>
      </g>

      <text x="524" y="220" fill="#2b1810" font-family="Cinzel, Georgia, serif" font-size="30" font-weight="bold" text-anchor="middle">${tit}</text>
      <text x="524" y="260" fill="#8b6b47" font-family="Georgia, serif" font-style="italic" font-size="18" text-anchor="middle">${fecha}</text>
      <line x1="324" y1="290" x2="724" y2="290" stroke="#bfa15f" stroke-width="1.5"/>

      <foreignObject x="210" y="320" width="630" height="520">
        <p xmlns="http://www.w3.org/1999/xhtml" style="font-family: Georgia, serif; font-size: 20px; line-height: 1.7; color: #3d2a1b; text-align: justify; margin: 0; white-space: pre-line;">
          ${texto}
        </p>
      </foreignObject>

      <text x="524" y="900" fill="#8b6b47" font-family="Georgia, serif" font-style="italic" font-size="18" text-anchor="middle">— Diario de viaje —</text>
    </svg>
  `);

  return await sharp(baseBookBuf).composite([{ input: overlaySvg, top: 0, left: 0 }]).jpeg({ quality: 92 }).toBuffer();
}

// =========================================================================
// MÓDULO 2: RENDERIZADOR DE MODO VÍDEO (PANTALLA COMPLETA 16:9 MODERNA)
// =========================================================================

/**
 * Renderiza una foto en Modo Vídeo moderno (1920x1080)
 * Si no es 16:9 pura, aplica fondo ambiental desenfocado de la propia imagen + subtítulo inferior cinematográfico
 */
async function renderizarFotoModoVideo(imagePath, esc = {}) {
  const bg = await sharp(imagePath)
    .resize(1920, 1080, { fit: 'cover' })
    .blur(25)
    .modulate({ brightness: 0.65 })
    .toBuffer();

  const fg = await sharp(imagePath)
    .resize(1600, 900, { fit: 'inside' })
    .toBuffer({ resolveWithObject: true });

  const fgX = Math.round((1920 - fg.info.width) / 2);
  const fgY = Math.round((960 - fg.info.height) / 2) + 15;

  const tit = escapeXml((esc.titulo && !esNombreArchivoCrudo(esc.titulo) && esc.titulo.toLowerCase() !== 'itinerario') ? esc.titulo : '');
  const fechaHora = escapeXml(`${esc.fecha || ''}${esc.hora ? ' · ' + esc.hora + ' h' : ''}`);
  const desc = escapeXml((esc.descripcion && !esNombreArchivoCrudo(esc.descripcion) && esc.descripcion.toLowerCase() !== 'itinerario' && esc.descripcion.length < 65) ? esc.descripcion : '');

  let textoSvg = '';
  if (tit || fechaHora || desc) {
    textoSvg = `
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="rgba(0,0,0,0)"/>
          <stop offset="35%" stop-color="rgba(0,0,0,0.6)"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0.92)"/>
        </linearGradient>
      </defs>
      <rect x="0" y="850" width="1920" height="230" fill="url(#grad)"/>
      ${tit ? `<text x="100" y="930" fill="#ffffff" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="36" font-weight="bold">${tit}</text>` : ''}
      ${fechaHora ? `<text x="100" y="${tit ? 970 : 940}" fill="#facc15" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="20" font-weight="600">${fechaHora}</text>` : ''}
      ${desc ? `<text x="100" y="${tit ? 1005 : 980}" fill="#e2e8f0" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="20">${desc}</text>` : ''}
    `;
  }

  const lowerThird = Buffer.from(`<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">${textoSvg}</svg>`);

  return await sharp(bg)
    .composite([
      { input: fg.data, top: fgY, left: fgX },
      { input: lowerThird, top: 0, left: 0 }
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}

// =========================================================================
// MÓDULO 3: GENERADOR PRINCIPAL DE LA PELÍCULA
// =========================================================================

async function generarPeliculaViaje(viajeId, secuencia, configuracion = {}, infoViaje = {}, audioViajeUrl = null, itinerariosAudio = {}) {
  console.log(`🎬 [PeliculaServer] Iniciando generación para Viaje ID: ${viajeId}. Total escenas recibidas: ${secuencia?.length || 0}`);
  const t0 = Date.now();

  const sessionFolder = `temp_pelicula_${viajeId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const tmpDir = path.join(UPLOADS_DIR, sessionFolder);
  fs.mkdirSync(tmpDir, { recursive: true });

  const esVintage = configuracion.esModoVintage !== false && configuracion.mantenerEstiloAlbum !== false;
  const esWhatsapp = configuracion.calidad === 'whatsapp';

  console.log(`🎬 [PeliculaServer] Perfil seleccionado: ${esVintage ? 'ÁLBUM VINTAGE 3D' : 'MODO VÍDEO 16:9'}. Calidad: ${esWhatsapp ? 'WhatsApp Móvil' : 'Alta fidelidad'}`);

  try {
    // 1. Filtrar escenas vacías
    const escenasValidas = [];
    for (const esc of secuencia || []) {
      if (!esc) continue;
      escenasValidas.push(esc);
    }

    if (escenasValidas.length === 0) {
      throw new Error('No hay escenas multimedia válidas para componer la película.');
    }

    // 2. Pre-generar base del libro vintage en memoria si estamos en Modo Vintage
    let baseBookBuf = null;
    if (esVintage && sharp) {
      baseBookBuf = await sharp(Buffer.from(generarSvgBaseLibroVintage())).jpeg({ quality: 92 }).toBuffer();
    }

    // 3. Procesar escenas por lotes normalizados a 1920x1080 @ 30fps
    const segmentosGenerados = [];
    const limitConcurrency = 4;

    for (let i = 0; i < escenasValidas.length; i += limitConcurrency) {
      const chunk = escenasValidas.slice(i, i + limitConcurrency);

      await Promise.all(chunk.map(async (esc, chunkIdx) => {
        const globalIdx = i + chunkIdx;
        const segName = `seg_${String(globalIdx).padStart(4, '0')}.mp4`;
        const segPath = path.join(tmpDir, segName);

        // ===============================================================
        // CASO A: INTRO 3D O OUTRO 3D CINEMÁTICA EN MP4
        // ===============================================================
        if (esc.esIntro3D || esc.esOutro3D) {
          let localMedia = resolverRutaLocal(esc.url);
          if (!localMedia || !fs.existsSync(localMedia)) {
            const fallbackAsset = esc.esIntro3D ? '/assets/videos/intro-libro-3d.mp4' : '/assets/videos/outro-libro-3d.mp4';
            localMedia = resolverRutaLocal(fallbackAsset);
          }

          if (localMedia && fs.existsSync(localMedia)) {
            const tieneAudio = await videoTieneAudio(localMedia);
            const args = ['-y', '-i', localMedia];
            if (tieneAudio) {
              args.push(
                '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-ar', '44100', '-ac', '2',
                segPath
              );
            } else {
              args.push(
                '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
                '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest',
                segPath
              );
            }

            await runFFmpeg(args);
            segmentosGenerados.push({
              index: globalIdx,
              path: segPath,
              esc,
              tieneAudioPropio: false // La intro/outro se integra en la banda sonora
            });
            return;
          }
        }

        // ===============================================================
        // CASO B: PLIEGO 0 (INTRODUCCIÓN DEL LIBRO VINTAGE)
        // ===============================================================
        if (esc.tipo === 'spread_intro') {
          const dur = esc.duracion || 4.5;
          const stats = {
            totalRecuerdos: esc.totalRecuerdos,
            totalItinerarios: esc.totalItinerarios
          };
          const spread0Buf = await renderizarPliego0Vintage(baseBookBuf, infoViaje, stats, esc.paginaDerecha, tmpDir);
          const spread0Img = path.join(tmpDir, `spread_intro_${globalIdx}.jpg`);
          fs.writeFileSync(spread0Img, spread0Buf);

          await runFFmpeg([
            '-y',
            '-loop', '1', '-t', String(dur), '-i', spread0Img,
            '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-ar', '44100', '-ac', '2',
            segPath
          ]);

          segmentosGenerados.push({ index: globalIdx, path: segPath, esc, tieneAudioPropio: false });
          return;
        }

        // ===============================================================
        // CASO C: PLIEGO DE FOTOS VINTAGE (2 PÁGINAS)
        // ===============================================================
        if (esc.tipo === 'spread_fotos') {
          const pIzq = esc.paginaIzquierda;
          const pDer = esc.paginaDerecha;
          const numIzq = pIzq?.numeroPagina || (globalIdx * 2);
          const numDer = pDer?.numeroPagina || (numIzq + 1);

          const esVidIzq = pIzq?.tipoMedia === 'video';
          const esVidDer = pDer?.tipoMedia === 'video';

          const spreadBuf = await renderizarPliegoFotosVintage(baseBookBuf, pIzq, pDer, numIzq, numDer);
          const spreadImg = path.join(tmpDir, `spread_base_${globalIdx}.jpg`);
          fs.writeFileSync(spreadImg, spreadBuf);

          // Si ninguna de las dos páginas es vídeo: imagen estática fluida con zoom cinemático opcional
          if (!esVidIzq && !esVidDer) {
            const dur = esc.duracion || 4;
            const aplicarZoom = configuracion.zoomAutomatico !== false && configuracion.modoZoomCinematico !== false;

            if (aplicarZoom) {
              const frames = Math.round(dur * 30);
              const vf = `zoompan=z='min(zoom+0.00065,1.08)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=30`;
              await runFFmpeg([
                '-y',
                '-i', spreadImg,
                '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
                '-vf', vf,
                '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-ar', '44100', '-ac', '2',
                '-t', String(dur),
                segPath
              ]);
            } else {
              await runFFmpeg([
                '-y',
                '-loop', '1', '-t', String(dur), '-i', spreadImg,
                '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-ar', '44100', '-ac', '2',
                segPath
              ]);
            }
            segmentosGenerados.push({ index: globalIdx, path: segPath, esc, tieneAudioPropio: false });
            return;
          }

          // Si una página es vídeo de usuario: reproducir el vídeo dentro de su tarjeta
          const vidEsc = esVidDer ? pDer : pIzq;
          const localVid = resolverRutaLocal(vidEsc.url);
          const overlayX = esVidDer ? 1056 : 184;
          const overlayY = 150;

          if (localVid && fs.existsSync(localVid)) {
            const durVid = await obtenerDuracionAudio(localVid);
            const dur = Math.max(3, durVid);
            const tieneAudio = await videoTieneAudio(localVid);

            const filterComplex = `[1:v]scale=680:560:force_original_aspect_ratio=decrease,pad=680:560:(ow-iw)/2:(oh-ih)/2:color=black[fg];[0:v][fg]overlay=${overlayX}:${overlayY}[v]`;

            const args = [
              '-y',
              '-loop', '1', '-t', String(dur), '-i', spreadImg,
              '-i', localVid,
              '-filter_complex', filterComplex,
              '-map', '[v]',
              '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p'
            ];

            if (tieneAudio) {
              args.push('-map', '1:a', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-t', String(dur), segPath);
            } else {
              args.push('-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo', '-map', '2:a', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-t', String(dur), segPath);
            }

            await runFFmpeg(args);
            segmentosGenerados.push({ index: globalIdx, path: segPath, esc, tieneAudioPropio: tieneAudio });
            return;
          } else {
            // Fallback si el archivo de vídeo no estuviera disponible en disco
            const dur = 4;
            await runFFmpeg([
              '-y',
              '-loop', '1', '-t', String(dur), '-i', spreadImg,
              '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
              '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', '-ar', '44100', '-ac', '2',
              segPath
            ]);
            segmentosGenerados.push({ index: globalIdx, path: segPath, esc, tieneAudioPropio: false });
            return;
          }
        }

        // ===============================================================
        // CASO D: PLIEGO DE MAPA PANORÁMICO VINTAGE (DOBLE PÁGINA)
        // ===============================================================
        if (esc.tipo === 'spread_mapa') {
          const mapBaseBuf = await renderizarPliegoMapaPanoramicoBase(baseBookBuf);
          const mapBaseImg = path.join(tmpDir, `spread_map_base_${globalIdx}.jpg`);
          fs.writeFileSync(mapBaseImg, mapBaseBuf);

          const headerSvgStr = generarSvgHeaderMapa(esc.titulo, esc.descripcion, esc.distanciaKm, esc.fecha, true);
          const headerSvgBuf = Buffer.from(headerSvgStr);
          const headerSvgPath = path.join(tmpDir, `spread_map_hdr_${globalIdx}.png`);
          await sharp(headerSvgBuf).png().toFile(headerSvgPath);

          let localMedia = resolverRutaLocal(esc.url);
          const dur = esc.duracion || 5;

          if (localMedia && fs.existsSync(localMedia)) {
            const esVideo = esc.esMapaAnimado || /\.mp4$/i.test(localMedia);

            if (esVideo) {
              const durVid = await obtenerDuracionAudio(localMedia);
              const durFinal = durVid > 0 ? durVid : dur;

              await runFFmpeg([
                '-y',
                '-loop', '1', '-t', String(durFinal), '-i', mapBaseImg,
                '-i', localMedia,
                '-i', headerSvgPath,
                '-filter_complex', '[1:v]scale=1648:868:force_original_aspect_ratio=decrease,pad=1648:868:(ow-iw)/2:(oh-ih)/2:color=black[mapfg];[0:v][mapfg]overlay=136:106[bgmap];[bgmap][2:v]overlay=0:0[v]',
                '-map', '[v]',
                '-f', 'lavfi', '-t', String(durFinal), '-i', 'anullsrc=r=44100:cl=stereo',
                '-map', '3:a',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-ar', '44100', '-ac', '2',
                '-t', String(durFinal),
                segPath
              ]);
            } else {
              // Imagen estática de mapa dentro del marco con la cabecera enriquecida encima
              const imgMapaResized = await sharp(localMedia).resize(1648, 868, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
              const mX = 136 + Math.round((1648 - imgMapaResized.info.width) / 2);
              const mY = 106 + Math.round((868 - imgMapaResized.info.height) / 2);

              const compositeMapBuf = await sharp(mapBaseImg)
                .composite([
                  { input: imgMapaResized.data, top: mY, left: mX },
                  { input: headerSvgBuf, top: 0, left: 0 }
                ])
                .jpeg({ quality: 90 })
                .toBuffer();

              const fullMapImg = path.join(tmpDir, `map_full_${globalIdx}.jpg`);
              fs.writeFileSync(fullMapImg, compositeMapBuf);

              await runFFmpeg([
                '-y',
                '-loop', '1', '-t', String(dur), '-i', fullMapImg,
                '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-ar', '44100', '-ac', '2',
                segPath
              ]);
            }
          } else {
            // Marco de mapa sin archivo renderizado pero con la cabecera visible
            const emptyMapBuf = await sharp(mapBaseImg)
              .composite([{ input: headerSvgBuf, top: 0, left: 0 }])
              .jpeg({ quality: 90 })
              .toBuffer();
            const emptyMapImg = path.join(tmpDir, `map_empty_${globalIdx}.jpg`);
            fs.writeFileSync(emptyMapImg, emptyMapBuf);

            await runFFmpeg([
              '-y',
              '-loop', '1', '-t', String(dur), '-i', emptyMapImg,
              '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
              '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', '-ar', '44100', '-ac', '2',
              segPath
            ]);
          }

          segmentosGenerados.push({ index: globalIdx, path: segPath, esc, tieneAudioPropio: false });
          return;
        }

        // ===============================================================
        // CASO E: PLIEGO DE CARTA MANUSCRITA VINTAGE
        // ===============================================================
        if (esc.tipo === 'spread_carta') {
          const dur = esc.duracion || 5;
          const cartaBuf = await renderizarPliegoCartaVintage(baseBookBuf, esc);
          const cartaImg = path.join(tmpDir, `spread_carta_${globalIdx}.jpg`);
          fs.writeFileSync(cartaImg, cartaBuf);

          await runFFmpeg([
            '-y',
            '-loop', '1', '-t', String(dur), '-i', cartaImg,
            '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-ar', '44100', '-ac', '2',
            segPath
          ]);

          segmentosGenerados.push({ index: globalIdx, path: segPath, esc, tieneAudioPropio: false });
          return;
        }

        // ===============================================================
        // CASO F: MODO VÍDEO (ESCENAS INDIVIDUALES EN PANTALLA COMPLETA 16:9)
        // ===============================================================
        let localMedia = resolverRutaLocal(esc.url);

        // F.1 VÍDEO (De usuario o de animación de ruta)
        if (esc.tipo === 'video' || esc.esMapaAnimado) {
          if (!localMedia || !fs.existsSync(localMedia)) {
            console.warn(`⚠️ Vídeo no encontrado: ${esc.url}`);
            return;
          }

          const tieneAudio = await videoTieneAudio(localMedia);
          const vf = 'split[main][bg];[bg]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=25:5[bgblur];[main]scale=1920:1080:force_original_aspect_ratio=decrease[fg];[bgblur][fg]overlay=(W-w)/2:(H-h)/2';

          const args = ['-y', '-i', localMedia];
          if (tieneAudio) {
            args.push(
              '-vf', vf,
              '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', '-ar', '44100', '-ac', '2',
              segPath
            );
          } else {
            args.push(
              '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
              '-vf', vf,
              '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest',
              segPath
            );
          }

          await runFFmpeg(args);
          segmentosGenerados.push({ index: globalIdx, path: segPath, esc, tieneAudioPropio: tieneAudio });
          return;
        }

        // F.2 IMAGEN (Foto individual en pantalla completa moderna)
        if (esc.tipo === 'imagen') {
          if (!localMedia || !fs.existsSync(localMedia)) {
            console.warn(`⚠️ Imagen no encontrada: ${esc.url}`);
            return;
          }

          const dur = esc.duracion || 3.5;
          const aplicarZoom = configuracion.zoomAutomatico !== false && configuracion.modoZoomCinematico !== false;
          let imgFrameBuf = null;

          if (sharp) {
            try {
              imgFrameBuf = await renderizarFotoModoVideo(localMedia, esc);
            } catch (e) {
              console.warn('Fallback imagen sharp:', e.message);
            }
          }

          if (imgFrameBuf) {
            const frameImgPath = path.join(tmpDir, `modern_frame_${globalIdx}.jpg`);
            fs.writeFileSync(frameImgPath, imgFrameBuf);

            if (aplicarZoom) {
              const frames = Math.round(dur * 30);
              const vf = `zoompan=z='min(zoom+0.001,1.12)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=30`;
              await runFFmpeg([
                '-y',
                '-i', frameImgPath,
                '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
                '-vf', vf,
                '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-ar', '44100', '-ac', '2',
                '-t', String(dur),
                segPath
              ]);
            } else {
              await runFFmpeg([
                '-y',
                '-loop', '1', '-t', String(dur), '-i', frameImgPath,
                '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-ar', '44100', '-ac', '2',
                segPath
              ]);
            }
          } else {
            // Fallback con FFmpeg directo
            const vf = 'split[main][bg];[bg]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=25:5[bgblur];[main]scale=1600:900:force_original_aspect_ratio=decrease[fg];[bgblur][fg]overlay=(W-w)/2:(H-h)/2';
            await runFFmpeg([
              '-y',
              '-loop', '1', '-t', String(dur), '-i', localMedia,
              '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
              '-vf', vf,
              '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', '-ar', '44100', '-ac', '2',
              segPath
            ]);
          }

          segmentosGenerados.push({ index: globalIdx, path: segPath, esc, tieneAudioPropio: false });
          return;
        }

        // F.3 MAPA RESUMEN ESTRUCTURAL EN MODO VÍDEO CON CABECERA SUPERIOR
        if (esc.tipo === 'mapa_resumen') {
          if (!localMedia || !fs.existsSync(localMedia)) return;
          const dur = esc.duracion || 5;

          const headerSvgStr = generarSvgHeaderMapa(esc.titulo, esc.descripcion, esc.distanciaKm, esc.fecha, false);
          const headerSvgBuf = Buffer.from(headerSvgStr);
          const headerPath = path.join(tmpDir, `modern_map_hdr_${globalIdx}.png`);
          await sharp(headerSvgBuf).png().toFile(headerPath);

          await runFFmpeg([
            '-y',
            '-loop', '1', '-t', String(dur), '-i', localMedia,
            '-i', headerPath,
            '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
            '-filter_complex', '[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black[bg];[bg][1:v]overlay=0:0[v]',
            '-map', '[v]',
            '-map', '2:a',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-ar', '44100', '-ac', '2',
            '-t', String(dur),
            segPath
          ]);

          segmentosGenerados.push({ index: globalIdx, path: segPath, esc, tieneAudioPropio: false });
          return;
        }

        // F.4 NOTA DE VOZ (AUDIO CON LÍMITE DE DURACIÓN DE SEGURIDAD)
        if (esc.tipo === 'audio') {
          if (!localMedia || !fs.existsSync(localMedia)) return;
          const durReal = await obtenerDuracionAudio(localMedia);
          const maxDurAudio = configuracion.maxDuracionAudioSegundos || 30;
          const durFinal = Math.min(Math.max(3.5, durReal), maxDurAudio);
          const fadeStart = Math.max(0, durFinal - 1.5);

          await runFFmpeg([
            '-y',
            '-f', 'lavfi', '-t', String(durFinal), '-i', `color=c=0x18120e:s=1920x1080:d=${durFinal}`,
            '-i', localMedia,
            '-filter_complex', `[1:a]atrim=0:${durFinal},afade=t=out:st=${fadeStart.toFixed(2)}:d=1.5,asplit=2[a1][a2];[a2]showwaves=s=1600x260:mode=cline:colors=0xdfc488:scale=cbrt[waves];[0:v][waves]overlay=160:H-360[v]`,
            '-map', '[v]',
            '-map', '[a1]',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-ar', '44100', '-ac', '2',
            '-t', String(durFinal),
            segPath
          ]);

          segmentosGenerados.push({ index: globalIdx, path: segPath, esc, tieneAudioPropio: true });
          return;
        }

        // F.5 CARTA EN MODO VÍDEO
        if (esc.tipo === 'carta') {
          const dur = 5;
          const tit = escapeXml(esc.titulo || 'Diario de Viaje');
          const desc = escapeXml(esc.descripcion || '');

          const svgCarta = Buffer.from(`
            <svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
              <rect width="1920" height="1080" fill="#18120e"/>
              <rect x="260" y="140" width="1400" height="800" rx="12" fill="#faf4e8" stroke="#d5c19d" stroke-width="2"/>
              <text x="960" y="240" fill="#2b1810" font-family="Cinzel, Georgia, serif" font-size="34" font-weight="bold" text-anchor="middle">${tit}</text>
              <line x1="560" y1="280" x2="1360" y2="280" stroke="#bfa15f" stroke-width="2"/>
              <foreignObject x="360" y="320" width="1200" height="520">
                <p xmlns="http://www.w3.org/1999/xhtml" style="font-family: Georgia, serif; font-size: 24px; line-height: 1.8; color: #3d2a1b; text-align: justify; margin: 0;">
                  ${desc}
                </p>
              </foreignObject>
            </svg>
          `);

          const cartaImg = path.join(tmpDir, `carta_modern_${globalIdx}.jpg`);
          await sharp(svgCarta).jpeg({ quality: 90 }).toFile(cartaImg);

          await runFFmpeg([
            '-y',
            '-loop', '1', '-t', String(dur), '-i', cartaImg,
            '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-ar', '44100', '-ac', '2',
            segPath
          ]);

          segmentosGenerados.push({ index: globalIdx, path: segPath, esc, tieneAudioPropio: false });
          return;
        }

      }));
    }

    segmentosGenerados.sort((a, b) => a.index - b.index);

    if (segmentosGenerados.length === 0) {
      throw new Error('No se pudo codificar ningún segmento multimedia.');
    }

    console.log(`🎬 [PeliculaServer] ${segmentosGenerados.length} segmentos codificados con éxito.`);

    // 4. Ensamblar escenas con transiciones cinemáticas (Paso de página en álbum vintage)
    const peliculaConcatenada = path.join(tmpDir, 'pelicula_concatenada.mp4');
    await ensamblarPeliculaConTransiciones(segmentosGenerados, tmpDir, esVintage, peliculaConcatenada);

    // 5. Destino final en la carpeta del viaje
    const carpetaViaje = path.join(UPLOADS_DIR, String(viajeId));
    if (!fs.existsSync(carpetaViaje)) fs.mkdirSync(carpetaViaje, { recursive: true });

    const nombreFinal = `pelicula_viaje_${viajeId}_${Date.now()}.mp4`;
    const rutaPeliculaFinal = path.join(carpetaViaje, nombreFinal);

    // 6. Mezclar música de fondo con soporte multi-itinerario y ducking profesional sidechain
    if (configuracion.incluirAudio !== false) {
      console.log(`🎵 [PeliculaServer] Analizando pistas de música y ducking inteligente...`);
      try {
        let tActual = 0;
        for (const seg of segmentosGenerados) {
          seg.startTime = tActual;
          const dur = await obtenerDuracionAudio(seg.path);
          seg.duration = dur > 0 ? dur : 3.5;
          seg.endTime = seg.startTime + seg.duration;
          tActual = seg.endTime;
        }

        const duracionTotal = tActual;
        console.log(`⏱️ [PeliculaServer] Duración total del montaje: ${duracionTotal.toFixed(2)}s`);

        // Resolver música del viaje o de itinerarios
        const localAudioViajeGeneral = resolverRutaLocal(audioViajeUrl);

        for (const seg of segmentosGenerados) {
          let rutaAudioSeg = null;
          const itinId = seg.esc?.itinerarioId;
          if (itinId && itinerariosAudio && itinerariosAudio[itinId]) {
            const resItin = resolverRutaLocal(itinerariosAudio[itinId]);
            if (resItin && fs.existsSync(resItin)) {
              rutaAudioSeg = resItin;
            }
          }
          if (!rutaAudioSeg && localAudioViajeGeneral && fs.existsSync(localAudioViajeGeneral)) {
            rutaAudioSeg = localAudioViajeGeneral;
          }
          seg.audioPath = rutaAudioSeg;
        }

        const hayMusica = segmentosGenerados.some(s => !!s.audioPath);

        if (hayMusica) {
          // Agrupar en bloques de itinerario
          const bloquesMusica = [];
          let bloqueActual = null;

          for (const seg of segmentosGenerados) {
            const itinId = seg.esc?.itinerarioId;
            const claveItin = itinId ? `itin_${itinId}` : (seg.esc?.esIntro3D ? 'intro' : (seg.esc?.esOutro3D ? 'outro' : 'general'));

            if (!bloqueActual) {
              bloqueActual = {
                clave: claveItin,
                audioPath: seg.audioPath,
                startTime: seg.startTime,
                endTime: seg.endTime
              };
            } else {
              if (bloqueActual.clave === claveItin && bloqueActual.audioPath === seg.audioPath) {
                bloqueActual.endTime = seg.endTime;
              } else {
                bloquesMusica.push(bloqueActual);
                bloqueActual = {
                  clave: claveItin,
                  audioPath: seg.audioPath,
                  startTime: seg.startTime,
                  endTime: seg.endTime
                };
              }
            }
          }
          if (bloqueActual) bloquesMusica.push(bloqueActual);

          // Generar bloques con fade in / fade out
          const listaArchivosBloques = [];
          for (let bIdx = 0; bIdx < bloquesMusica.length; bIdx++) {
            const b = bloquesMusica[bIdx];
            const durBloque = Math.max(0.1, b.endTime - b.startTime);
            const outWav = path.join(tmpDir, `bloque_audio_${String(bIdx).padStart(3, '0')}.wav`);

            if (!b.audioPath || !fs.existsSync(b.audioPath)) {
              await runFFmpeg([
                '-y',
                '-f', 'lavfi', '-t', String(durBloque), '-i', 'anullsrc=r=44100:cl=stereo',
                '-c:a', 'pcm_s16le',
                outWav
              ]);
            } else {
              const fadeDur = Math.min(2.5, Math.max(0.4, durBloque / 3));
              const fadeFilters = [
                `afade=t=in:st=0:d=${fadeDur.toFixed(2)}`,
                `afade=t=out:st=${Math.max(0, durBloque - fadeDur).toFixed(2)}:d=${fadeDur.toFixed(2)}`
              ].join(',');

              await runFFmpeg([
                '-y',
                '-stream_loop', '-1', '-i', b.audioPath,
                '-t', String(durBloque),
                '-af', fadeFilters,
                '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2',
                outWav
              ]);
            }
            listaArchivosBloques.push(outWav);
          }

          const concatAudioList = path.join(tmpDir, 'concat_audio_list.txt');
          fs.writeFileSync(concatAudioList, listaArchivosBloques.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));

          const musicaCompletaWav = path.join(tmpDir, 'musica_timeline_completa.wav');
          await runFFmpeg([
            '-y',
            '-f', 'concat', '-safe', '0', '-i', concatAudioList,
            '-c:a', 'pcm_s16le',
            musicaCompletaWav
          ]);

          // Ducking suave y profesional mediante sidechain compressor
          console.log(`🎚️ [PeliculaServer] Aplicando ducking dinámico sidechain con compresión inteligente...`);
          const filterComplex = '[0:a]asplit=2[speech_play][speech_sc];[1:a]volume=0.28[m_norm];[m_norm][speech_sc]sidechaincompress=threshold=0.015:ratio=7:attack=150:release=800[m_ducked];[speech_play][m_ducked]amix=inputs=2:duration=first:dropout_transition=2[aout]';

          const finalArgs = [
            '-y',
            '-i', peliculaConcatenada,
            '-i', musicaCompletaWav,
            '-filter_complex', filterComplex,
            '-map', '0:v',
            '-map', '[aout]'
          ];

          if (esWhatsapp) {
            // Optimizado para WhatsApp móvil: 720p H.264 ligero y compatible
            finalArgs.push(
              '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black',
              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-maxrate', '1800k', '-bufsize', '2400k', '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k',
              '-movflags', '+faststart',
              rutaPeliculaFinal
            );
          } else {
            // Alta fidelidad Full HD 1080p
            finalArgs.push(
              '-c:v', 'copy',
              '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '192k',
              '-movflags', '+faststart',
              rutaPeliculaFinal
            );
          }

          await runFFmpeg(finalArgs);
          console.log(`✅ [PeliculaServer] Banda sonora mezclada con éxito con ducking sidechain.`);

        } else {
          console.log('ℹ️ [PeliculaServer] Sin archivos de música válidos, conservando audios de los vídeos.');
          if (esWhatsapp) {
            await runFFmpeg([
              '-y', '-i', peliculaConcatenada,
              '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black',
              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-maxrate', '1800k', '-bufsize', '2400k', '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k',
              '-movflags', '+faststart',
              rutaPeliculaFinal
            ]);
          } else {
            fs.copyFileSync(peliculaConcatenada, rutaPeliculaFinal);
          }
        }
      } catch (errMusic) {
        console.warn('⚠️ [PeliculaServer] Error en mezcla de música:', errMusic.message);
        fs.copyFileSync(peliculaConcatenada, rutaPeliculaFinal);
      }
    } else {
      console.log('ℹ️ [PeliculaServer] Música desactivada en la configuración de exportación.');
      if (esWhatsapp) {
        await runFFmpeg([
          '-y', '-i', peliculaConcatenada,
          '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-maxrate', '1800k', '-bufsize', '2400k', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k',
          '-movflags', '+faststart',
          rutaPeliculaFinal
        ]);
      } else {
        fs.copyFileSync(peliculaConcatenada, rutaPeliculaFinal);
      }
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const statFinal = fs.statSync(rutaPeliculaFinal);
    console.log(`✅ [PeliculaServer] ¡Película generada con éxito en ${elapsed}s! Tamaño: ${(statFinal.size / 1024 / 1024).toFixed(2)} MB`);

    // Limpieza de archivos temporales
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}

    const urlRelativa = `/uploads/${viajeId}/${nombreFinal}`;
    return {
      success: true,
      url: urlRelativa,
      tamanoBytes: statFinal.size,
      tiempoGeneracionSegundos: parseFloat(elapsed)
    };

  } catch (error) {
    console.error('❌ [PeliculaServer] Error generando película:', error);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
    throw error;
  }
}

/**
 * Ensambla los segmentos de vídeo aplicando transiciones suaves:
 * - En Álbum Vintage: Transición de paso de página de derecha a izquierda (smoothleft de 0.75s).
 * - En Modo Vídeo moderno: Fundido cruzado suave (fade de 0.5s).
 * - Intro 3D y Outro 3D: Fundido suave cinematográfico (fade).
 */
async function ensamblarPeliculaConTransiciones(segmentos, tmpDir, esVintage, outPath) {
  if (!segmentos || segmentos.length === 0) throw new Error('No hay segmentos para ensamblar.');
  if (segmentos.length === 1) {
    fs.copyFileSync(segmentos[0].path, outPath);
    return;
  }

  console.log(`🎬 [PeliculaServer] Ensamblando ${segmentos.length} escenas con transiciones cinemáticas (${esVintage ? 'Paso de página 3D suave (smoothleft)' : 'Fundido cruzado'})...`);

  for (const seg of segmentos) {
    const dur = await obtenerDuracionAudio(seg.path);
    seg.dur = dur > 0 ? dur : 3.5;
  }

  const BATCH_SIZE = 6;
  try {
    if (segmentos.length <= BATCH_SIZE) {
      await ejecutarXfadeLote(segmentos, tmpDir, esVintage, outPath);
    } else {
      let subReels = [];
      let i = 0;
      let reelIdx = 0;
      while (i < segmentos.length) {
        const chunk = segmentos.slice(i, i + BATCH_SIZE);
        const subOut = path.join(tmpDir, `subreel_${reelIdx}.mp4`);
        await ejecutarXfadeLote(chunk, tmpDir, esVintage, subOut);
        const subDur = await obtenerDuracionAudio(subOut);
        subReels.push({ path: subOut, dur: subDur, esc: chunk[chunk.length - 1].esc });
        reelIdx++;
        i += BATCH_SIZE;
      }

      if (subReels.length === 1) {
        fs.copyFileSync(subReels[0].path, outPath);
      } else {
        await ejecutarXfadeLote(subReels, tmpDir, esVintage, outPath);
      }
    }
    console.log(`✅ [PeliculaServer] Transiciones ensambladas con éxito.`);
  } catch (errXfade) {
    console.warn(`⚠️ [PeliculaServer] Fallback a concatenación directa por error en transiciones:`, errXfade.message);
    const concatFile = path.join(tmpDir, 'concat_list_fallback.txt');
    fs.writeFileSync(concatFile, segmentos.map(s => `file '${s.path.replace(/\\/g, '/')}'`).join('\n'));
    await runFFmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c:v', 'copy', '-c:a', 'copy', outPath]);
  }
}

async function ejecutarXfadeLote(clips, tmpDir, esVintage, outPath) {
  if (clips.length === 1) {
    fs.copyFileSync(clips[0].path, outPath);
    return;
  }

  const transDur = 0.75;
  const inputs = [];
  clips.forEach(c => { inputs.push('-i', c.path); });

  let filterV = '';
  let filterA = '';
  let prevV = '0:v';
  let prevA = '0:a';
  let curOffset = Math.max(0.1, clips[0].dur - transDur);

  for (let i = 1; i < clips.length; i++) {
    const nextV = i === clips.length - 1 ? 'vout' : `v${i}`;
    const nextA = i === clips.length - 1 ? 'aout' : `a${i}`;
    const esIntroOOutro = clips[i - 1].esc?.esIntro3D || clips[i].esc?.esOutro3D;
    const transTipo = esIntroOOutro ? 'fade' : (esVintage ? 'smoothleft' : 'fade');

    filterV += `[${prevV}][${i}:v]xfade=transition=${transTipo}:duration=${transDur}:offset=${curOffset.toFixed(2)}[${nextV}];`;
    filterA += `[${prevA}][${i}:a]acrossfade=d=${transDur}[${nextA}];`;
    prevV = nextV;
    prevA = nextA;
    if (i < clips.length - 1) {
      curOffset += Math.max(0.1, clips[i].dur - transDur);
    }
  }

  const filterComplex = filterV + filterA.slice(0, -1);
  await runFFmpeg([
    '-y',
    ...inputs,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    outPath
  ]);
}

/**
 * Comprime un archivo de vídeo MP4 para adaptarlo a WhatsApp:
 * - Resolución: 720p H.264 compatible
 * - Bitrate controlado (~1100 kbps de vídeo + 96 kbps de audio)
 * - CRF 28 para máxima reducción de tamaño con nitidez en pantallas móviles
 */
async function comprimirPeliculaParaWhatsApp(inputPath, outputPath) {
  const args = [
    '-y',
    '-i', inputPath,
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '28',
    '-maxrate', '1100k',
    '-bufsize', '1500k',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-ar', '44100',
    '-ac', '2',
    '-b:a', '96k',
    '-movflags', '+faststart',
    outputPath
  ];
  await runFFmpeg(args);
  const st = fs.statSync(outputPath);
  return {
    tamanoBytes: st.size,
    tamanoMB: (st.size / 1024 / 1024).toFixed(2)
  };
}

module.exports = {
  generarPeliculaViaje,
  comprimirPeliculaParaWhatsApp,
  resolverRutaLocal
};

