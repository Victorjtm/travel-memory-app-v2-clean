const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

let ffmpegStatic = null;
try {
  ffmpegStatic = require('ffmpeg-static');
} catch (e) {}

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
    // Buscar en src/assets
    const p3 = path.resolve(__dirname, '../..', clean.substring(1));
    if (fs.existsSync(p3)) return p3;
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
        const secs = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
        resolve(secs);
      } else {
        resolve(4);
      }
    });
  });
}

/**
 * Genera la película completa del viaje usando FFmpeg en servidor
 */
async function generarPeliculaViaje(viajeId, secuencia, configuracion = {}, infoViaje = {}, audioViajeUrl = null) {
  console.log(`🎬 [PeliculaServer] Iniciando generación para Viaje ID: ${viajeId}. Total escenas recibidas: ${secuencia?.length || 0}`);
  const t0 = Date.now();

  const sessionFolder = `temp_pelicula_${viajeId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const tmpDir = path.join(UPLOADS_DIR, sessionFolder);
  fs.mkdirSync(tmpDir, { recursive: true });

  const fontPath = fs.existsSync('C:/Windows/Fonts/arial.ttf') ? 'C\\:/Windows/Fonts/arial.ttf' : null;

  try {
    // 1. Filtrar escenas vacías o "Itinerario" sin descripción
    const escenasValidas = [];
    for (const esc of secuencia || []) {
      if (!esc) continue;

      if (esc.tipo === 'carta') {
        const desc = (esc.descripcion || '').trim();
        const tit = (esc.titulo || '').trim().toLowerCase();
        // Omitir cartas sin contenido real o que sean sólo el cartel "Itinerario"
        if (!desc || desc.length < 15 || desc.toLowerCase() === 'itinerario' || tit === 'itinerario') {
          continue;
        }
      }

      if (esc.tipo === 'mapa_resumen') {
        // Si no tiene imagen renderizada ni mapa, omitir
        const local = resolverRutaLocal(esc.url);
        if (!local || !fs.existsSync(local)) continue;
      }

      escenasValidas.push(esc);
    }

    console.log(`🎬 [PeliculaServer] Escenas válidas tras filtrado: ${escenasValidas.length}`);
    if (escenasValidas.length === 0) {
      throw new Error('No hay escenas multimedia válidas para componer la película.');
    }

    // 2. Procesar escenas en segmentos normalizados a 1920x1080 @ 30fps
    const segmentosGenerados = [];
    const limitConcurrency = 3;

    for (let i = 0; i < escenasValidas.length; i += limitConcurrency) {
      const chunk = escenasValidas.slice(i, i + limitConcurrency);

      await Promise.all(chunk.map(async (esc, chunkIdx) => {
        const globalIdx = i + chunkIdx;
        const segName = `seg_${String(globalIdx).padStart(4, '0')}.mp4`;
        const segPath = path.join(tmpDir, segName);

        const localMedia = resolverRutaLocal(esc.url);

        // A. ESCENA TIPO VIDEO (Intro 3D, animación de ruta o vídeo de usuario)
        if (esc.tipo === 'video' || esc.esIntro3D || esc.esMapaAnimado) {
          if (!localMedia || !fs.existsSync(localMedia)) {
            console.warn(`⚠️ [PeliculaServer] Vídeo no encontrado localmente: ${esc.url}`);
            return;
          }

          const tieneAudio = await videoTieneAudio(localMedia);

          const vf = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black';
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
          segmentosGenerados.push({ index: globalIdx, path: segPath });
          return;
        }

        // B. ESCENA TIPO AUDIO
        if (esc.tipo === 'audio') {
          if (!localMedia || !fs.existsSync(localMedia)) return;
          const dur = await obtenerDuracionAudio(localMedia);
          const durFinal = Math.max(3.5, dur);

          let vf = 'scale=1920:1080';
          if (configuracion.incluirTexto && fontPath) {
            const textoBadge = (esc.titulo || 'Nota de Voz').replace(/'/g, '');
            vf += `,drawtext=text='${textoBadge}':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.7:boxborderw=24:fontfile='${fontPath}'`;
          }

          await runFFmpeg([
            '-y',
            '-f', 'lavfi', '-t', String(durFinal), '-i', 'color=c=0x1a2430:s=1920x1080:d=' + durFinal,
            '-i', localMedia,
            '-vf', vf,
            '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest',
            segPath
          ]);

          segmentosGenerados.push({ index: globalIdx, path: segPath });
          return;
        }

        // C. ESCENA TIPO CARTA MANUSCRITA
        if (esc.tipo === 'carta') {
          const dur = 5;
          let vf = 'scale=1920:1080';
          if (fontPath) {
            const tituloLimpio = (esc.titulo || 'Diario').replace(/'/g, '');
            vf += `,drawtext=text='${tituloLimpio}':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=180:box=1:boxcolor=black@0.6:boxborderw=16:fontfile='${fontPath}'`;
          }

          await runFFmpeg([
            '-y',
            '-f', 'lavfi', '-t', String(dur), '-i', 'color=c=0x2c221e:s=1920x1080:d=' + dur,
            '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
            '-vf', vf,
            '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-ar', '44100', '-ac', '2',
            segPath
          ]);

          segmentosGenerados.push({ index: globalIdx, path: segPath });
          return;
        }

        // D. ESCENA TIPO IMAGEN (Fotos y mapas)
        if (!localMedia || !fs.existsSync(localMedia)) {
          console.warn(`⚠️ [PeliculaServer] Imagen no encontrada: ${esc.url}`);
          return;
        }

        const dur = Number(esc.duracion) > 0 ? Number(esc.duracion) : 3.5;
        let vf = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black';

        // Superponer subtítulo/badge inferior si está activado
        if (configuracion.incluirTexto !== false && fontPath) {
          let textoBadge = '';
          if (esc.badgeOrden && esc.badgeOrden !== 'Ruta') {
            textoBadge = `Parada #${esc.badgeOrden}`;
          }
          if (esc.titulo && esc.titulo.trim().length > 0 && esc.titulo.toLowerCase() !== 'itinerario') {
            textoBadge = textoBadge ? `${textoBadge} - ${esc.titulo.trim()}` : esc.titulo.trim();
          }

          if (textoBadge) {
            const txtSanitizado = textoBadge.replace(/'/g, '').replace(/:/g, ' -').substring(0, 75);
            vf += `,drawtext=text='${txtSanitizado}':fontcolor=white:fontsize=36:x=80:y=h-110:box=1:boxcolor=black@0.65:boxborderw=16:fontfile='${fontPath}'`;
          }
        }

        await runFFmpeg([
          '-y',
          '-loop', '1', '-t', String(dur), '-i', localMedia,
          '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo',
          '-vf', vf,
          '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-ar', '44100', '-ac', '2',
          segPath
        ]);

        segmentosGenerados.push({ index: globalIdx, path: segPath });
      }));
    }

    // Ordenar los segmentos generados según su índice original
    segmentosGenerados.sort((a, b) => a.index - b.index);

    if (segmentosGenerados.length === 0) {
      throw new Error('No se pudo codificar ningún segmento multimedia.');
    }

    console.log(`🎬 [PeliculaServer] ${segmentosGenerados.length} segmentos codificados con éxito. Concatenando...`);

    // 3. Crear archivo concat.txt
    const concatFile = path.join(tmpDir, 'concat_list.txt');
    const concatContent = segmentosGenerados
      .map(s => `file '${s.path.replace(/\\/g, '/')}'`)
      .join('\n');
    fs.writeFileSync(concatFile, concatContent);

    // 4. Concatenación instantánea sin pérdida (-c copy)
    const peliculaConcatenada = path.join(tmpDir, 'pelicula_concatenada.mp4');
    await runFFmpeg([
      '-y',
      '-f', 'concat', '-safe', '0', '-i', concatFile,
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      peliculaConcatenada
    ]);

    // 5. Destino final en la carpeta del viaje
    const carpetaViaje = path.join(UPLOADS_DIR, String(viajeId));
    if (!fs.existsSync(carpetaViaje)) fs.mkdirSync(carpetaViaje, { recursive: true });

    const nombreFinal = `pelicula_viaje_${viajeId}_${Date.now()}.mp4`;
    const rutaPeliculaFinal = path.join(carpetaViaje, nombreFinal);

    // 6. Mezclar música de fondo si se solicitó y existe
    const localAudioViaje = resolverRutaLocal(audioViajeUrl);
    if (configuracion.incluirAudio !== false && localAudioViaje && fs.existsSync(localAudioViaje)) {
      console.log(`🎵 [PeliculaServer] Mezclando música de fondo del viaje...`);
      try {
        await runFFmpeg([
          '-y',
          '-i', peliculaConcatenada,
          '-stream_loop', '-1', '-i', localAudioViaje,
          '-filter_complex', '[0:a]volume=1.0[a0];[1:a]volume=0.22[a1];[a0][a1]amix=inputs=2:duration=first[aout]',
          '-map', '0:v',
          '-map', '[aout]',
          '-c:v', 'copy',
          '-c:a', 'aac', '-ar', '44100', '-ac', '2',
          '-movflags', '+faststart',
          rutaPeliculaFinal
        ]);
      } catch (errMusic) {
        console.warn('⚠️ [PeliculaServer] Error mezclando música, usando película sin música:', errMusic.message);
        fs.copyFileSync(peliculaConcatenada, rutaPeliculaFinal);
      }
    } else {
      fs.copyFileSync(peliculaConcatenada, rutaPeliculaFinal);
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

module.exports = {
  generarPeliculaViaje,
  resolverRutaLocal
};
