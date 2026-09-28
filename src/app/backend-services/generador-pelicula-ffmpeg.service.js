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

        let localMedia = resolverRutaLocal(esc.url);
        if ((!localMedia || !fs.existsSync(localMedia)) && esc.esIntro3D) {
          console.warn(`⚠️ [PeliculaServer] Intro personalizada no encontrada en ${esc.url}, usando intro base por defecto`);
          localMedia = resolverRutaLocal('/assets/videos/intro-libro-3d.mp4');
        }

        // A. ESCENA TIPO VIDEO (Intro 3D, Outro 3D, animación de ruta o vídeo de usuario)
        if (esc.tipo === 'video' || esc.esIntro3D || esc.esOutro3D || esc.esMapaAnimado) {
          if (!localMedia || !fs.existsSync(localMedia)) {
            console.warn(`⚠️ [PeliculaServer] Vídeo no encontrado localmente: ${esc.url}`);
            return;
          }

          const tieneAudio = await videoTieneAudio(localMedia);

          // Si es un vídeo de usuario grabado en vertical (9:16), aplicar fondo desenfocado (blurred pillarbox)
          let vf;
          if (!esc.esIntro3D && !esc.esOutro3D && !esc.esMapaAnimado) {
            vf = 'split[main][bg];[bg]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=25:5[bgblur];[main]scale=1920:1080:force_original_aspect_ratio=decrease[fg];[bgblur][fg]overlay=(W-w)/2:(H-h)/2';
          } else {
            vf = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black';
          }

          // Placa cinemática en el Outro 3D (Destino, Fecha, Kilómetros, Tiempo y Pasos)
          if (esc.esOutro3D && configuracion.incluirTexto !== false && fontPath) {
            const txtOutroTitle = path.join(tmpDir, `txt_outro_t_${globalIdx}.txt`);
            const txtOutroSub = path.join(tmpDir, `txt_outro_s_${globalIdx}.txt`);
            const t1 = (esc.titulo || 'Estantería de los Recuerdos').toUpperCase();
            const metrics = esc.subtitulo ? `${esc.fecha ? esc.fecha + '   ·   ' : ''}${esc.subtitulo}` : (esc.fecha || '');
            fs.writeFileSync(txtOutroTitle, `✦  ${t1}  ✦`, 'utf-8');
            fs.writeFileSync(txtOutroSub, metrics, 'utf-8');

            const pTitle = txtOutroTitle.replace(/\\/g, '/');
            const pSub = txtOutroSub.replace(/\\/g, '/');

            vf += `,drawtext=textfile='${pTitle}':fontfile='${fontPath}':fontsize=38:fontcolor=0xfef3c7:x=(w-text_w)/2:y=65:box=1:boxcolor=0x0f172a@0.85:boxborderw=20:enable='between(t,0.8,5.8)'`;
            if (metrics) {
              vf += `,drawtext=textfile='${pSub}':fontfile='${fontPath}':fontsize=24:fontcolor=0xfcd34d:x=(w-text_w)/2:y=125:enable='between(t,0.8,5.8)'`;
            }
          }

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

        // B. ESCENA TIPO AUDIO (Con onda animada y título limpio sin truncamiento)
        if (esc.tipo === 'audio') {
          if (!localMedia || !fs.existsSync(localMedia)) return;
          const dur = await obtenerDuracionAudio(localMedia);
          const durFinal = Math.max(3.5, dur);

          const txtFile = path.join(tmpDir, `txt_audio_${globalIdx}.txt`);
          const tituloLimpio = (esc.titulo || 'Nota de Voz').trim();
          fs.writeFileSync(txtFile, `🎙️ ${tituloLimpio}`, 'utf-8');

          let drawTextFilter = '';
          if (configuracion.incluirTexto !== false && fontPath) {
            drawTextFilter = `,drawtext=textfile='${txtFile.replace(/\\/g, '/')}':fontcolor=white:fontsize=46:x=(w-text_w)/2:y=(h-text_h)/2-90:box=1:boxcolor=black@0.7:boxborderw=24:fontfile='${fontPath}'`;
          }

          await runFFmpeg([
            '-y',
            '-f', 'lavfi', '-t', String(durFinal), '-i', `color=c=0x0a1128:s=1920x1080:d=${durFinal}`,
            '-i', localMedia,
            '-filter_complex', `[1:a]showwaves=s=1600x260:mode=cline:colors=0x38bdf8:scale=cbrt[waves];[0:v][waves]overlay=160:H-360${drawTextFilter}[v]`,
            '-map', '[v]',
            '-map', '1:a',
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

        // Superponer subtítulo inferior limpio si está activado
        if (configuracion.incluirTexto !== false && fontPath) {
          const esNombreArchivoCrudo = (t) => {
            if (!t) return false;
            const lower = t.toLowerCase();
            return /^(jpeg|video|img|dsc|rec|recording|photo|audi)[\w\d_\-\.]+/i.test(lower) ||
                   /\.(jpg|jpeg|png|mp4|aac|mp3|m4a)$/i.test(lower);
          };

          let textoPrincipal = '';
          if (esc.titulo && !esNombreArchivoCrudo(esc.titulo) && esc.titulo.toLowerCase() !== 'itinerario') {
            textoPrincipal = esc.titulo.trim();
          } else if (esc.descripcion && !esNombreArchivoCrudo(esc.descripcion) && esc.descripcion.toLowerCase() !== 'itinerario' && esc.descripcion.length < 60) {
            textoPrincipal = esc.descripcion.trim();
          }

          const horaLimpia = esc.hora ? ` · ${esc.hora} h` : '';
          let textoFinal = '';
          if (textoPrincipal) {
            textoFinal = `${textoPrincipal}${horaLimpia}`;
          } else if (horaLimpia) {
            textoFinal = `${horaLimpia.replace(/^\s*·\s*/, '')}`;
          }

          if (textoFinal) {
            const txtFile = path.join(tmpDir, `txt_img_${globalIdx}.txt`);
            fs.writeFileSync(txtFile, textoFinal, 'utf-8');
            vf += `,drawtext=textfile='${txtFile.replace(/\\/g, '/')}':fontcolor=white:fontsize=36:x=80:y=h-110:box=1:boxcolor=black@0.65:boxborderw=16:fontfile='${fontPath}'`;
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
