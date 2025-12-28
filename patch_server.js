const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/server.js');
let content = fs.readFileSync(filePath, 'utf8');

const replacementBlock = `      // AUDIO ASOCIADO (MODIFIED)
      let audioFile = null;
      let audioFileName = null;

      // 1. Intentar desde el manifest
      if (media.audio) {
        audioFileName = path.basename(media.audio);
        audioFile = req.files.find(f => f.originalname === audioFileName);
      }

      // 2. Fallback: Buscar por nombre coincidente
      if (!audioFile) {
        const baseName = media.nombre; 
        const nameWithoutExt = baseName.includes('.') ? baseName.split('.').slice(0, -1).join('.') : baseName;
        
        audioFile = req.files.find(f => {
          const fName = f.originalname;
          return (fName === \`\${nameWithoutExt}.wav\` || fName === \`\${nameWithoutExt}.mp3\` || 
                  fName === \`\${baseName}.wav\` || fName === \`\${baseName}.mp3\`);
        });

        if (audioFile) {
          audioFileName = audioFile.originalname;
          console.log(\`   ✓ Audio asociado encontrado por coincidencia de nombre: \${audioFileName}\`);
        }
      }

      if (audioFile && audioFileName) {
        const audioDestPath = path.join(actividadPath, 'audios', audioFileName);
        fs.renameSync(audioFile.path, audioDestPath);
        const audioRutaRelativa = path.relative(uploadsPath, audioDestPath).replace(/\\/g, '/');

        await new Promise((resolve, reject) => {
          db.run(
            \`INSERT INTO archivos_asociados 
            (archivoPrincipalId, tipo, nombreArchivo, rutaArchivo, fechaCreacion) 
            VALUES (?, ?, ?, ?, ?)\`,
            [archivoId, 'audio', audioFileName, audioRutaRelativa, new Date().toISOString()],
            function (err) {
              if (err) return reject(err);
              resolve();
            }
          );
        });
        console.log(\`  🎤 Audio asociado: \${audioFileName}\`);
      }`;

if (content.includes('// AUDIO ASOCIADO (MODIFIED)')) {
  let lines = content.split('\r\n');
  let splitChar = '\r\n';
  if (lines.length === 1) {
    lines = content.split('\n');
    splitChar = '\n';
  }

  const startIndex = lines.findIndex(l => l.trim().includes('// AUDIO ASOCIADO (MODIFIED)'));
  const endIndex = lines.findIndex((l, i) => i > startIndex && l.trim().includes('// GPX INDIVIDUAL'));

  if (startIndex !== -1 && endIndex !== -1) {
    console.log(`Found block from line ${startIndex} to ${endIndex}`);

    // Construct new lines
    const newLines = replacementBlock.split('\n');

    // Replace
    lines.splice(startIndex, endIndex - startIndex, ...newLines);

    const newContent = lines.join(splitChar);
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log('Successfully patched server.js using line replacement');
  } else {
    console.log('Could not find start or end lines');
    console.log('Start:', startIndex);
    console.log('End:', endIndex);
  }
} else {
  console.log('Comment not found');
}
