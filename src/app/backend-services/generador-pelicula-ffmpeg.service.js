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

/**
 * Convierte una ruta absoluta a ruta relativa con barras inclinadas '/'
 * para evitar que los dos puntos de unidad en Windows (C:) rompan los filtros drawtext de FFmpeg
 */
function rutaRelativaFFmpeg(filePath) {
  if (!filePath) return '';
  return path.relative(process.cwd(), filePath).replace(/\\/g, '/');
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
 * Genera la curva de volumen dinámica (ducking) en FFmpeg
 * Reduce el volumen de la música de fondo durante los vídeos con audio y notas de voz,
 * con rampas de transición suaves de entrada y salida.
 */
function construirExpresionVolumenDucking(intervalos, vNormal = 0.22, vDucked = 0.04, rampDown = 0.5, rampUp = 0.8) {
  if (!intervalos || intervalos.length === 0) return '' + vNormal;
  const ordenados = [...intervalos].sort((a, b) => a.start - b.start);
  const fusionados = [];
  let actual = { ...ordenados[0] };
  for (let i = 1; i < ordenados.length; i++) {
    const sig = ordenados[i];
    if (sig.start <= actual.end + 1.2) {
      actual.end = Math.max(actual.end, sig.end);
    } else {
      fusionados.push(actual);
      actual = { ...sig };
    }
  }
  fusionados.push(actual);

  let expr = '' + vNormal;
  for (let i = fusionados.length - 1; i >= 0; i--) {
    const { start: s, end: e } = fusionados[i];
    const s0 = Math.max(0, s - rampDown).toFixed(2);
    const s1 = s.toFixed(2);
    const e1 = e.toFixed(2);
    const e2 = (e + rampUp).toFixed(2);
    const deltaV = (vNormal - vDucked).toFixed(3);
    const rDown = (rampDown).toFixed(2);
    const rUp = (rampUp).toFixed(2);

    const rampDownExpr = `${vNormal}-${deltaV}*(t-${s0})/${rDown}`;
    const rampUpExpr = `${vDucked}+${deltaV}*(t-${e1})/${rUp}`;

    expr = `if(between(t,${s0},${s1}),${rampDownExpr},if(between(t,${s1},${e1}),${vDucked},if(between(t,${e1},${e2}),${rampUpExpr},${expr})))`;
  }
  return expr;
}

/**
 * Genera la película completa del viaje usando FFmpeg en servidor
 */
async function generarPeliculaViaje(viajeId, secuencia, configuracion = {}, infoViaje = {}, audioViajeUrl = null, itinerariosAudio = {}) {
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
          segmentosGenerados.push({
            index: globalIdx,
            path: segPath,
            esc,
            tieneAudioPropio: (tieneAudio && !esc.esIntro3D && !esc.esOutro3D && !esc.esMapaAnimado)
          });
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
            const relTxt = rutaRelativaFFmpeg(txtFile);
            drawTextFilter = `,drawtext=textfile='${relTxt}':fontcolor=white:fontsize=46:x=(w-text_w)/2:y=(h-text_h)/2-90:box=1:boxcolor=black@0.7:boxborderw=24:fontfile='${fontPath}'`;
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

          segmentosGenerados.push({
            index: globalIdx,
            path: segPath,
            esc,
            tieneAudioPropio: true
          });
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

          segmentosGenerados.push({
            index: globalIdx,
            path: segPath,
            esc,
            tieneAudioPropio: false
          });
          return;
        }

        // D. ESCENA TIPO IMAGEN (Fotos y mapas)
        if (!localMedia || !fs.existsSync(localMedia)) {
          console.warn(`⚠️ [PeliculaServer] Imagen no encontrada: ${esc.url}`);
          return;
        }

        const dur = Number(esc.duracion) > 0 ? Number(esc.duracion) : 3.5;
        const esVintage = configuracion.esModoVintage !== false && configuracion.mantenerEstiloAlbum !== false;
        let vf;
        if (esVintage && esc.tipo !== 'mapa_resumen') {
          // Encuadre fotográfico vintage con marco de lujo dorado sobre fondo desenfocado cálido (estilo pliego de álbum)
          vf = 'split[main][bg];[bg]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=30:5,colorchannelmixer=rr=0.8:gg=0.75:bb=0.7[bgblur];[main]scale=1540:870:force_original_aspect_ratio=decrease,pad=iw+24:ih+24:12:12:color=0xd4af37,pad=iw+10:ih+10:5:5:color=0x261d15,pad=iw+12:ih+12:6:6:color=0xb8860b[fgframed];[bgblur][fgframed]overlay=(W-w)/2:(H-h)/2';
        } else {
          vf = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black';
        }

        // Superponer subtítulo inferior limpio si está activado (excepto en mapas que ya traen su cabecera integrada)
        if (configuracion.incluirTexto !== false && fontPath && esc.tipo !== 'mapa_resumen') {
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
            const relTxt = rutaRelativaFFmpeg(txtFile);
            vf += `,drawtext=textfile='${relTxt}':fontcolor=white:fontsize=36:x=80:y=h-110:box=1:boxcolor=black@0.65:boxborderw=16:fontfile='${fontPath}'`;
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

        segmentosGenerados.push({
          index: globalIdx,
          path: segPath,
          esc,
          tieneAudioPropio: false
        });
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

    // 6. Mezclar música de fondo con soporte multi-itinerario, transiciones suavizadas y ducking
    if (configuracion.incluirAudio !== false) {
      console.log(`🎵 [PeliculaServer] Analizando pistas de música por itinerario y ducking dinámico...`);
      try {
        // 6.a Calcular tiempos exactos de la línea temporal
        let tActual = 0;
        const duckIntervals = [];

        for (const seg of segmentosGenerados) {
          seg.startTime = tActual;
          const dur = await obtenerDuracionAudio(seg.path);
          seg.duration = dur > 0 ? dur : 3.5;
          seg.endTime = seg.startTime + seg.duration;
          tActual = seg.endTime;

          if (seg.tieneAudioPropio) {
            duckIntervals.push({ start: seg.startTime, end: seg.endTime });
          }
        }

        const duracionTotalPelicula = tActual;
        console.log(`⏱️ [PeliculaServer] Duración total: ${duracionTotalPelicula.toFixed(2)}s. Clips con audio para ducking: ${duckIntervals.length}`);

        // 6.b Asignar ruta de audio a cada segmento según su itinerario o viaje general
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
          // Si el itinerario no tiene música propia, suena la música del viaje
          if (!rutaAudioSeg && localAudioViajeGeneral && fs.existsSync(localAudioViajeGeneral)) {
            rutaAudioSeg = localAudioViajeGeneral;
          }

          seg.audioPath = rutaAudioSeg;
        }

        const hayMusica = segmentosGenerados.some(s => !!s.audioPath);

        if (hayMusica) {
          // 6.c Agrupar segmentos consecutivos en bloques de itinerario
          const bloquesMusica = [];
          let bloqueActual = null;

          for (const seg of segmentosGenerados) {
            const itinId = seg.esc?.itinerarioId;
            const claveItin = itinId ? `itin_${itinId}` : (seg.esc?.esIntro3D ? 'intro' : (seg.esc?.esOutro3D ? 'outro' : 'general'));

            if (!bloqueActual) {
              bloqueActual = {
                clave: claveItin,
                itinerarioId: itinId,
                audioPath: seg.audioPath,
                startTime: seg.startTime,
                endTime: seg.endTime
              };
            } else {
              // Unificar si es el mismo itinerario y mismo audio
              if (bloqueActual.clave === claveItin && bloqueActual.audioPath === seg.audioPath) {
                bloqueActual.endTime = seg.endTime;
              } else {
                bloquesMusica.push(bloqueActual);
                bloqueActual = {
                  clave: claveItin,
                  itinerarioId: itinId,
                  audioPath: seg.audioPath,
                  startTime: seg.startTime,
                  endTime: seg.endTime
                };
              }
            }
          }
          if (bloqueActual) {
            bloquesMusica.push(bloqueActual);
          }

          console.log(`🎶 [PeliculaServer] ${bloquesMusica.length} bloques de música creados:`);
          bloquesMusica.forEach((b, idx) => {
            console.log(`   [Bloque #${idx}] ${b.clave} | ${b.startTime.toFixed(1)}s -> ${b.endTime.toFixed(1)}s (${(b.endTime - b.startTime).toFixed(1)}s) | ${b.audioPath ? path.basename(b.audioPath) : 'Silencio'}`);
          });

          // 6.d Generar archivos de audio para cada bloque con fade-in y fade-out suavizados
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
              // Transición suavizada: fade-in y fade-out de 2.5s (o 1/3 si el bloque es corto)
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

          // 6.e Concatenar todos los bloques de música
          const concatAudioList = path.join(tmpDir, 'concat_audio_list.txt');
          fs.writeFileSync(concatAudioList, listaArchivosBloques.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));

          const musicaCompletaWav = path.join(tmpDir, 'musica_timeline_completa.wav');
          await runFFmpeg([
            '-y',
            '-f', 'concat', '-safe', '0', '-i', concatAudioList,
            '-c:a', 'pcm_s16le',
            musicaCompletaWav
          ]);

          // 6.f Mezclar con ducking dinámico para vídeos y notas de voz
          console.log(`🎚️ [PeliculaServer] Mezclando audio con ducking dinámico para vídeos...`);
          const exprVolumen = construirExpresionVolumenDucking(duckIntervals, 0.22, 0.04, 0.5, 0.8);
          const filterComplex = `[0:a]volume=1.0[speech];[1:a]volume='${exprVolumen}':eval=frame[music_ducked];[speech][music_ducked]amix=inputs=2:duration=first:dropout_transition=2[aout]`;

          await runFFmpeg([
            '-y',
            '-i', peliculaConcatenada,
            '-i', musicaCompletaWav,
            '-filter_complex', filterComplex,
            '-map', '0:v',
            '-map', '[aout]',
            '-c:v', 'copy',
            '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '192k',
            '-movflags', '+faststart',
            rutaPeliculaFinal
          ]);
          console.log(`✅ [PeliculaServer] Mezcla de audio y ducking completada con éxito.`);

        } else {
          console.log('ℹ️ [PeliculaServer] No hay pistas de música válidas, conservando audio original de escenas.');
          fs.copyFileSync(peliculaConcatenada, rutaPeliculaFinal);
        }
      } catch (errMusic) {
        console.warn('⚠️ [PeliculaServer] Error en mezcla avanzada de música, usando película sin banda sonora:', errMusic.message);
        fs.copyFileSync(peliculaConcatenada, rutaPeliculaFinal);
      }
    } else {
      console.log('ℹ️ [PeliculaServer] Música desactivada en configuración.');
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
