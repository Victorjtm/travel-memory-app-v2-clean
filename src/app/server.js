// Importar las dependencias
const fs = require('fs');
const ExifParser = require('exif-parser');
const { promisify } = require('util');
const readFileAsync = promisify(fs.readFile);
const { exiftool } = require('exiftool-vendored');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');

// Crear una instancia de la aplicación Express
const app = express();

// AGREGA ESTO ANTES de la configuración CORS existente en server.js

// Middleware para manejar preflight OPTIONS requests
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  console.log('🔧 [OPTIONS] Preflight request desde:', origin);

  // Verificar si el origen está permitido
  if (!origin ||
    allowedOrigins.includes(origin) ||
    /^https:\/\/.*\.ngrok(-free)?\.app$/.test(origin) ||
    /^https:\/\/.*\.ngrok\.io$/.test(origin) ||
    /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+):\d+$/.test(origin)) {

    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, ngrok-skip-browser-warning');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('ngrok-skip-browser-warning', '1');

    console.log('✅ [OPTIONS] Preflight permitido para:', origin);
    res.status(200).end();
  } else {
    console.log('❌ [OPTIONS] Preflight bloqueado para:', origin);
    res.status(403).end();
  }
});

// Aquí va tu configuración CORS existente...

// ----------------------------
// CORS y cabeceras de seguridad
// ----------------------------

// 1. Configuración CORS DINÁMICA
const allowedOrigins = [
  'http://localhost:4200',
  'https://localhost:4200',
  'http://localhost:3000',
  'https://b089c8b77672.ngrok-free.app',
  'https://d0bdb7a970da.ngrok-free.app'
];

app.use(cors({
  origin: function (origin, callback) {
    console.log('🔧 [CORS] Origen recibido:', origin);
    if (!origin) {
      console.log('✅ [CORS] Sin origen: permitido');
      return callback(null, true);
    }

    // ✅ NUEVO: Permitir cualquier IP de red local (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
    if (/^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+):\d+$/.test(origin)) {
      console.log('✅ [CORS] Red local permitida:', origin);
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      console.log('✅ [CORS] Origen permitido (lista blanca):', origin);
      return callback(null, true);
    }
    if (/^https:\/\/.*\.ngrok(-free)?\.app$/.test(origin)) {
      console.log('✅ [CORS] Origen permitido (ngrok):', origin);
      return callback(null, true);
    }
    if (/^https:\/\/.*\.ngrok\.io$/.test(origin)) {
      console.log('✅ [CORS] Origen permitido (ngrok.io):', origin);
      return callback(null, true);
    }
    console.log('❌ [CORS] Origen bloqueado:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'Origin',
    'X-Requested-With',
    'ngrok-skip-browser-warning'
  ]
}));

// 2. Evitar la página de advertencia de ngrok
app.use((req, res, next) => {
  res.set('ngrok-skip-browser-warning', '1');
  next();
});

// 3. Content Security Policy (CSP)
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' https://www.gstatic.com https://fonts.googleapis.com https://translate.googleapis.com; " +
    "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://translate.googleapis.com; " +
    "style-src 'self' 'unsafe-inline' https://www.gstatic.com https://fonts.googleapis.com; " +
    "img-src 'self' data: blob:; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "connect-src 'self' http://192.168.1.18:3000 https://*.ngrok-free.app https://*.ngrok.io; " +
    "frame-src 'self';"
  );
  next();
});

// 4. Logging de requests
app.use((req, res, next) => {
  console.log('🌐 Request recibida - Origen:', req.headers.origin, 'Path:', req.path);
  next();
});

// 5. Parseo del cuerpo
app.use(bodyParser.json());

// ✅ Servir archivos estáticos desde "uploads"
const uploadsPath = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
  console.log('✅ Carpeta uploads creada:', uploadsPath);
}

console.log('📁 Sirviendo archivos estáticos desde:', uploadsPath);
app.use('/uploads', express.static(uploadsPath));

// Configurar la base de datos SQLite
const db = new sqlite3.Database('./viajes.db', (err) => {
  if (err) {
    console.error('❌ Error al conectar con la base de datos SQLite:', err.message);
  } else {
    console.log('✅ Conectado a la base de datos SQLite');
  }
});

// Helper para promesas de SQLite
const dbQuery = {
  get: (sql, params) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row))),
  all: (sql, params) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows))),
  run: (sql, params) => new Promise((resolve, reject) => db.run(sql, params, function (err) { err ? reject(err) : resolve(this) }))
};

// Configuración multer para subir archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsPath);  // Usa la ruta absoluta que ya tienes
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + ext);
  }
});
const upload = multer({ storage });

// Crear la tabla de "viajes" (si no existe)
// Crear tabla de viajes con campo de imagen y audio
db.run(`
    CREATE TABLE IF NOT EXISTS viajes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT,
      destino TEXT,
      fecha_inicio TEXT,
      fecha_fin TEXT,
      imagen TEXT,
      audio TEXT,
      descripcion TEXT
    )
`, (err) => {
  if (err) {
    console.error('❌ Error al crear tabla viajes:', err.message);
  } else {
    console.log('✅ Tabla viajes verificada/creada');
  }
});

// Crear la tabla de "ItinerarioGeneral" (si no existe)
db.run(
  `CREATE TABLE IF NOT EXISTS ItinerarioGeneral (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    viajePrevistoId INTEGER NOT NULL,
    fechaInicio TEXT NOT NULL,
    fechaFin TEXT NOT NULL,
    duracionDias INTEGER NOT NULL,
    destinosPorDia TEXT NOT NULL,
    descripcionGeneral TEXT,
    horaInicio TEXT,
    horaFin TEXT,
    climaGeneral TEXT,
    tipoDeViaje TEXT CHECK(tipoDeViaje IN ('costa', 'naturaleza', 'rural', 'urbana', 'cultural', 'trabajo')),
    FOREIGN KEY (viajePrevistoId) REFERENCES viajes(id) ON DELETE CASCADE
  )`,
  (err) => {
    if (err) {
      console.error("❌ Error al crear la tabla ItinerarioGeneral:", err.message);
    } else {
      console.log("✅ Tabla ItinerarioGeneral creada o ya existe.");
    }
  }
);

// Crear la tabla TiposActividad
db.run(
  `CREATE TABLE IF NOT EXISTS TiposActividad (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  descripcion TEXT
)`,
  (err) => {
    if (err) {
      console.error("❌ Error al crear la tabla TiposActividad:", err.message);
    } else {
      console.log("✅ Tabla TiposActividad creada o ya existe.");
    }
  }
);

// Crear la tabla ActividadesDisponibles
db.run(
  `CREATE TABLE IF NOT EXISTS ActividadesDisponibles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipoActividadId INTEGER NOT NULL,
    descripcion TEXT NOT NULL,
    FOREIGN KEY (tipoActividadId) REFERENCES TiposActividad(id) ON DELETE CASCADE
  )`,
  (err) => {
    if (err) {
      console.error("❌ Error al crear la tabla ActividadesDisponibles:", err.message);
    } else {
      console.log("✅ Tabla ActividadesDisponibles creada o ya existe.");
    }
  }
);

// Crear la tabla actividades
db.run(
  `CREATE TABLE IF NOT EXISTS actividades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    viajePrevistoId INTEGER NOT NULL,
    itinerarioId INTEGER NOT NULL,
    tipoActividadId INTEGER NOT NULL,
    actividadDisponibleId INTEGER,
    nombre TEXT,
    descripcion TEXT,
    horaInicio TEXT NOT NULL,
    horaFin TEXT NOT NULL,
    
    -- ✨ NUEVO: Estadísticas del recorrido GPS (del manifest.json)
    distanciaKm DECIMAL DEFAULT 0,
    distanciaMetros INTEGER DEFAULT 0,
    duracionSegundos INTEGER DEFAULT 0,
    duracionFormateada TEXT,
    velocidadMediaKmh DECIMAL DEFAULT 0,
    velocidadMaximaKmh DECIMAL DEFAULT 0,
    velocidadMinimaKmh DECIMAL DEFAULT 0,
    calorias INTEGER DEFAULT 0,
    pasosEstimados INTEGER DEFAULT 0,
    puntosGPS INTEGER DEFAULT 0,
    perfilTransporte TEXT,
    
    -- ✨ NUEVO: Referencias a archivos generales del recorrido
    rutaGpxCompleto TEXT,
    rutaMapaCompleto TEXT,
    rutaManifest TEXT,
    rutaEstadisticas TEXT,
    
    -- Timestamps (se establecen en código Node.js, no con DEFAULT)
    fechaCreacion TEXT DEFAULT NULL,
    fechaActualizacion TEXT DEFAULT NULL,
    
    FOREIGN KEY (viajePrevistoId) REFERENCES viajes(id) ON DELETE CASCADE,
    FOREIGN KEY (itinerarioId) REFERENCES ItinerarioGeneral(id) ON DELETE CASCADE,
    FOREIGN KEY (tipoActividadId) REFERENCES TiposActividad(id),
    FOREIGN KEY (actividadDisponibleId) REFERENCES ActividadesDisponibles(id)
  )`,
  (err) => {
    if (err) {
      console.error("❌ Error al crear la tabla actividades:", err.message);
    } else {
      console.log("✅ Tabla actividades creada o ya existe (con campos de estadísticas y archivos generales).");
    }
  }
);


// Crear la tabla archivos (archivos subidos por el usuario para cada actividad)
db.run(
  `CREATE TABLE IF NOT EXISTS archivos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actividadId INTEGER NOT NULL,
    tipo TEXT CHECK(tipo IN ('foto', 'video', 'audio', 'texto', 'imagen')) NOT NULL,
    nombreArchivo TEXT NOT NULL,
    rutaArchivo TEXT NOT NULL,
    descripcion TEXT,
    fechaCreacion TEXT DEFAULT (datetime('now')),
    fechaActualizacion TEXT DEFAULT (datetime('now')),
    horaCaptura TEXT,                                 -- ⬅️ Nuevo campo para guardar la hora (HH:mm)
    version INTEGER DEFAULT 1,
    geolocalizacion TEXT,
    metadatos TEXT,
    FOREIGN KEY (actividadId) REFERENCES actividades(id) ON DELETE CASCADE
  )`,
  (err) => {
    if (err) {
      console.error("❌ Error al crear la tabla archivos:", err.message);
    } else {
      console.log("✅ Tabla archivos creada o ya existe.");
    }
  }
);


// Crear la tabla archivos_asociados (textos y audios asociados a fotos, videos o imágenes)
db.run(
  `CREATE TABLE IF NOT EXISTS archivos_asociados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    archivoPrincipalId INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    nombreArchivo TEXT NOT NULL,
    rutaArchivo TEXT NOT NULL,
    descripcion TEXT,
    fechaCreacion TEXT DEFAULT (datetime('now')),
    fechaActualizacion TEXT DEFAULT (datetime('now')),
    version INTEGER DEFAULT 1,
    FOREIGN KEY (archivoPrincipalId) REFERENCES archivos(id) ON DELETE CASCADE
  )`,
  (err) => {
    if (err) {
      console.error("❌ Error al crear la tabla archivos_asociados:", err.message);
    } else {
      console.log("✅ Tabla archivos_asociados creada o ya existe.");
    }
  }
);


// Extraer fecha y hora de un archivo (EXIF o metadatos del sistema)
async function getFileMetadata(filePath, fileType) {
  try {
    // 1. Intenta leer EXIF (imágenes)
    if (['image/jpeg', 'image/png'].includes(fileType)) {
      const buffer = await readFileAsync(filePath);
      const parser = ExifParser.create(buffer);
      const result = parser.parse();

      if (result.tags?.DateTimeOriginal) {
        let fecha = '';
        let hora = '';
        const dt = result.tags.DateTimeOriginal;
        if (typeof dt === 'number') {
          const d = new Date(dt * 1000);
          fecha = d.toISOString().split('T')[0];
          hora = d.toTimeString().substring(0, 5);
        } else if (typeof dt === 'string') {
          // "YYYY:MM:DD HH:MM:SS"
          const dateStr = dt.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
          const d = new Date(dateStr);
          fecha = d.toISOString().split('T')[0];
          hora = d.toTimeString().substring(0, 5);
        } else if (dt instanceof Date) {
          fecha = dt.toISOString().split('T')[0];
          hora = dt.toTimeString().substring(0, 5);
        }
        return { fecha, hora };
      }
    }
    // 2. Fallback a metadatos del sistema
    const stats = fs.statSync(filePath);
    return {
      fecha: new Date(stats.mtime).toISOString().split('T')[0],
      hora: new Date(stats.mtime).toTimeString().substring(0, 5)
    };
  } catch (error) {
    console.error('Error leyendo metadatos:', error);
    return {
      fecha: new Date().toISOString().split('T')[0],
      hora: new Date().toTimeString().substring(0, 5)
    };
  }
}

// ========================================
// ENDPOINT: Información del servidor (para detección automática de IP)
// ========================================
app.get('/api/server-info', (req, res) => {
  const os = require('os');
  const interfaces = os.networkInterfaces();

  // Buscar la primera IP de red local
  let serverIP = 'localhost';

  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      // Buscar IPv4 no loopback
      if (iface.family === 'IPv4' && !iface.internal) {
        serverIP = iface.address;
        break;
      }
    }
    if (serverIP !== 'localhost') break;
  }

  console.log('📡 [Server Info] IP detectada:', serverIP);

  res.json({
    ip: serverIP,
    hostname: os.hostname(),
    timestamp: new Date().toISOString()
  });
});

// ----------------------------------------
// RUTAS PARA Viajes previstos
// ----------------------------------------

console.log('Registrando rutas de viajes...');

// ----------------------------------------
// RUTAS PARA Viajes prvistgos
// ----------------------------------------

console.log('Registrando rutas de viajes...');

// Ruta para obtener todos los viajes
app.get('/viajes', (req, res) => {
  db.all('SELECT * FROM viajes', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    // Agregar URL completa para las imágenes y audios
    const viajesConImagenUrl = rows.map(viaje => ({
      ...viaje,
      imagen_url: viaje.imagen ? `${req.protocol}://${req.get('host')}/uploads/${viaje.imagen}` : null,
      audio_url: viaje.audio ? `${req.protocol}://${req.get('host')}/uploads/${viaje.audio}` : null
    }));

    res.json(viajesConImagenUrl);
  });
});

// Ruta para obtener un viaje por id
app.get('/viajes/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM viajes WHERE id = ?', [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: 'Viaje no encontrado' });
      return;
    }

    // Agregar URL completa de la imagen y audio
    const viajeConImagenUrl = {
      ...row,
      imagen_url: row.imagen ? `${req.protocol}://${req.get('host')}/uploads/${row.imagen}` : null,
      audio_url: row.audio ? `${req.protocol}://${req.get('host')}/uploads/${row.audio}` : null
    };

    res.json(viajeConImagenUrl);
  });
});

// GET rangos de fechas de itinerarios de un viaje
app.get('/viajes/:id/rangos-fechas', (req, res) => {
  const { id } = req.params;

  console.log(`📅 Obteniendo rangos de fechas para viaje ${id}...`);

  const sql = `
    SELECT fechaInicio, fechaFin 
    FROM ItinerarioGeneral 
    WHERE viajePrevistoId = ? 
    ORDER BY fechaInicio ASC
  `;

  db.all(sql, [id], (err, itinerarios) => {
    if (err) {
      console.error('❌ Error obteniendo itinerarios:', err.message);
      return res.status(500).json({ error: err.message });
    }

    if (!itinerarios || itinerarios.length === 0) {
      return res.json({ rangos: [], total: 0 });
    }

    // Función para detectar rangos consecutivos
    const rangos = [];
    let rangoActual = {
      inicio: itinerarios[0].fechaInicio,
      fin: itinerarios[0].fechaInicio,
      dias: 1
    };

    for (let i = 1; i < itinerarios.length; i++) {
      const fechaAnterior = new Date(rangoActual.fin);
      const fechaActual = new Date(itinerarios[i].fechaInicio);

      // Calcular diferencia en días
      const diffTime = fechaActual.getTime() - fechaAnterior.getTime();
      const diffDays = diffTime / (1000 * 60 * 60 * 24);

      if (diffDays === 1) {
        // Consecutivo: extender el rango actual
        rangoActual.fin = itinerarios[i].fechaInicio;
        rangoActual.dias++;
      } else {
        // No consecutivo: guardar rango actual y empezar uno nuevo
        rangos.push({ ...rangoActual });
        rangoActual = {
          inicio: itinerarios[i].fechaInicio,
          fin: itinerarios[i].fechaInicio,
          dias: 1
        };
      }
    }

    // Añadir último rango
    rangos.push(rangoActual);

    console.log(`✅ Rangos calculados (${rangos.length}):`, rangos);

    res.json({
      rangos,
      total: itinerarios.length
    });
  });
});


// Ruta para agregar un nuevo viaje
app.post('/viajes', upload.fields([{ name: 'imagen', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), (req, res) => {
  const { nombre, destino, fecha_inicio, fecha_fin, descripcion } = req.body;
  const imagen = req.files?.imagen ? req.files.imagen[0].filename : null;
  const audio = req.files?.audio ? req.files.audio[0].filename : null;

  console.log('📸 Imagen recibida:', req.files?.imagen?.[0]);
  console.log('🎵 Audio recibido:', req.files?.audio?.[0]);
  console.log('📝 Datos recibidos:', { nombre, destino, fecha_inicio, fecha_fin, descripcion });

  db.run(
    'INSERT INTO viajes (nombre, destino, fecha_inicio, fecha_fin, imagen, audio, descripcion) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [nombre, destino, fecha_inicio, fecha_fin, imagen, audio, descripcion],
    function (err) {
      if (err) {
        console.error('❌ Error al insertar viaje:', err);
        res.status(500).json({ error: err.message });
        return;
      }
      console.log('✅ Viaje creado con ID:', this.lastID);
      res.status(201).json({
        id: this.lastID,
        message: 'Viaje creado exitosamente',
        imagen: imagen,
        audio: audio,
        descripcion: descripcion
      });
    }
  );
});

// Ruta para actualizar un viaje
app.put('/viajes/:id', upload.fields([{ name: 'imagen', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), (req, res) => {
  const { id } = req.params;
  const { nombre, destino, fecha_inicio, fecha_fin, descripcion, imagen_actual, audio_actual } = req.body;

  // Si se subió nueva imagen, usarla. Si no, mantener la actual
  const imagen = req.files?.imagen ? req.files.imagen[0].filename : imagen_actual;
  // Si se subió nuevo audio, usarlo. Si no, mantener el actual
  const audio = req.files?.audio ? req.files.audio[0].filename : audio_actual;

  console.log('🔄 Actualizando viaje ID:', id);
  console.log('📸 Imagen:', imagen);
  console.log('🎵 Audio:', audio);
  console.log('📝 Datos recibidos:', { nombre, destino, fecha_inicio, fecha_fin, descripcion });

  db.run(
    'UPDATE viajes SET nombre = ?, destino = ?, fecha_inicio = ?, fecha_fin = ?, imagen = ?, audio = ?, descripcion = ? WHERE id = ?',
    [nombre, destino, fecha_inicio, fecha_fin, imagen, audio, descripcion, id],
    function (err) {
      if (err) {
        console.error('❌ Error al actualizar viaje:', err);
        res.status(500).json({ error: err.message });
        return;
      }
      console.log('✅ Viaje actualizado. Cambios:', this.changes);
      res.status(200).json({
        changes: this.changes,
        message: 'Viaje actualizado exitosamente',
        imagen: imagen,
        audio: audio,
        descripcion: descripcion
      });
    }
  );
});

// Ruta para obtener la imagen de un viaje
app.get('/viajes/:id/imagen', (req, res) => {
  const { id } = req.params;

  db.get('SELECT imagen FROM viajes WHERE id = ?', [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (!row || !row.imagen) {
      res.status(404).json({ error: 'Imagen no encontrada' });
      return;
    }

    const imagePath = path.join(uploadsPath, row.imagen);

    // Verificar que el archivo existe
    if (fs.existsSync(imagePath)) {
      res.sendFile(imagePath);
    } else {
      res.status(404).json({ error: 'Archivo de imagen no encontrado' });
    }
  });
});

// Ruta para eliminar un viaje
app.delete('/viajes/:id', async (req, res) => {
  const id = req.params.id;

  try {
    console.log(`🗑️ Iniciando eliminación en cascada del viaje ${id}...`);

    // 0. Obtener datos del viaje para eliminar imagen/audio de portada
    const viaje = await dbQuery.get('SELECT imagen, audio FROM viajes WHERE id = ?', [id]);
    if (!viaje) {
      return res.status(404).json({ error: 'Viaje no encontrado' });
    }

    // 1. Obtener todos los itinerarios del viaje
    const itinerarios = await dbQuery.all('SELECT id FROM ItinerarioGeneral WHERE viajePrevistoId = ?', [id]);
    console.log(`📋 Encontrados ${itinerarios.length} itinerarios`);

    let totalArchivosEliminados = 0;

    // 2. Procesar itinerarios y actividades
    for (const itin of itinerarios) {
      const actividades = await dbQuery.all('SELECT id FROM actividades WHERE itinerarioId = ?', [itin.id]);

      for (const act of actividades) {
        // Obtener archivos de la actividad
        const archivos = await dbQuery.all('SELECT id, rutaArchivo FROM archivos WHERE actividadId = ?', [act.id]);

        for (const arch of archivos) {
          // Eliminar archivos asociados físicos
          const asociados = await dbQuery.all('SELECT rutaArchivo FROM archivos_asociados WHERE archivoPrincipalId = ?', [arch.id]);
          for (const asoc of asociados) {
            try {
              const fullPathAsoc = path.isAbsolute(asoc.rutaArchivo) ? asoc.rutaArchivo : path.join(uploadsPath, asoc.rutaArchivo);
              if (fs.existsSync(fullPathAsoc)) fs.unlinkSync(fullPathAsoc);
            } catch (e) { console.warn(`  ⚠️ Error eliminando asociado: ${asoc.rutaArchivo}`); }
          }

          // Eliminar archivo principal físico
          try {
            const fullPathArch = path.isAbsolute(arch.rutaArchivo) ? arch.rutaArchivo : path.join(uploadsPath, arch.rutaArchivo);
            if (fs.existsSync(fullPathArch)) {
              fs.unlinkSync(fullPathArch);
              totalArchivosEliminados++;
            }
          } catch (e) { console.warn(`  ⚠️ Error eliminando archivo: ${arch.rutaArchivo}`); }
        }
      }
    }

    // 3. Eliminar archivos de portada (viaje.imagen y viaje.audio)
    [viaje.imagen, viaje.audio].forEach(fileName => {
      if (fileName) {
        try {
          const fullPath = path.isAbsolute(fileName) ? fileName : path.join(uploadsPath, fileName);
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        } catch (e) { console.warn(`  ⚠️ Error eliminando recurso viaje: ${fileName}`); }
      }
    });

    // 4. Ejecutar borrado en BD (suponiendo ON DELETE CASCADE, pero lo hacemos explícito para seguridad si falla el trigger)
    // El orden importa si no hay FK cascade: asociados -> archivos -> actividades -> itinerarios -> viaje
    // Pero asumiendo que viajes.db tiene FK habilitadas...
    await dbQuery.run('DELETE FROM viajes WHERE id = ?', [id]);

    // 5. Eliminar carpeta de viaje si existe (opcional, si se usa folders por ID)
    const viajeFolder = path.join(uploadsPath, id.toString());
    if (fs.existsSync(viajeFolder)) {
      try {
        fs.rmSync(viajeFolder, { recursive: true, force: true });
        console.log(`  ✅ Carpeta de viaje eliminada: ${viajeFolder}`);
      } catch (e) { console.warn(`  ⚠️ No se pudo eliminar la carpeta del viaje: ${viajeFolder}`); }
    }

    res.json({
      success: true,
      mensaje: `Viaje ${id} eliminado en cascada`,
      archivosEliminados: totalArchivosEliminados,
      itinerariosEliminados: itinerarios.length
    });

  } catch (error) {
    console.error(`❌ Error eliminando viaje: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});


// Ruta para unificar viajes por destino
app.post('/viajes/unificar', async (req, res) => {
  try {
    console.log('🔄 Iniciando unificación de viajes...');

    // 1. Obtener todos los viajes
    const viajes = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM viajes', [], (err, rows) => err ? reject(err) : resolve(rows));
    });

    // 2. Agrupar por destino (normalizado)
    const grupos = {};
    viajes.forEach(v => {
      if (!v.destino) return;
      const destinoNorm = v.destino.trim().toLowerCase();
      if (!grupos[destinoNorm]) grupos[destinoNorm] = [];
      grupos[destinoNorm].push(v);
    });

    // 3. Filtrar solo los que tienen duplicados
    const gruposDuplicados = Object.values(grupos).filter(g => g.length > 1);

    if (gruposDuplicados.length === 0) {
      return res.json({ success: true, message: 'No se encontraron viajes para unificar', unificados: 0, errores: [] });
    }

    console.log(`📋 Encontrados ${gruposDuplicados.length} grupos de destinos duplicados`);
    let unificadosCount = 0;
    const errores = [];

    // 4. Procesar cada grupo transaccionalmente (lógica secuencial)
    for (const grupo of gruposDuplicados) {
      const maestro = grupo[0]; // Tomamos el primero como maestro
      const secundarios = grupo.slice(1);
      const todosIds = grupo.map(v => v.id);

      console.log(`  🔹 Procesando grupo "${maestro.destino}" (Maestro ID: ${maestro.id}, Secundarios: ${secundarios.map(s => s.id).join(', ')})`);

      // 4.1 Validar colisiones de horario en TODO el grupo
      const actividades = await new Promise((resolve, reject) => {
        const placeholders = todosIds.map(() => '?').join(',');
        const query = `
          SELECT a.id, a.horaInicio, a.horaFin, i.fechaInicio, i.viajePrevistoId 
          FROM actividades a 
          JOIN ItinerarioGeneral i ON a.itinerarioId = i.id 
          WHERE i.viajePrevistoId IN (${placeholders})
        `;
        db.all(query, todosIds, (err, rows) => err ? reject(err) : resolve(rows || []));
      });

      let colisionDetectada = null;
      const actividadesPorFecha = {};
      actividades.forEach(act => {
        if (!actividadesPorFecha[act.fechaInicio]) actividadesPorFecha[act.fechaInicio] = [];
        actividadesPorFecha[act.fechaInicio].push(act);
      });

      for (const fecha in actividadesPorFecha) {
        // Ordenar por hora de inicio
        const acts = actividadesPorFecha[fecha].sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
        for (let i = 0; i < acts.length - 1; i++) {
          const actual = acts[i];
          const siguiente = acts[i + 1];
          // Verificar solapamiento: StartA < EndB AND EndA > StartB. (Aquí rango [Start, End))
          // "actual.horaFin > siguiente.horaInicio" es suficiente si están ordenados por Start.
          if (actual.horaFin > siguiente.horaInicio) {
            colisionDetectada = `Conflicto el ${fecha} entre ${actual.horaInicio}-${actual.horaFin} y ${siguiente.horaInicio}-${siguiente.horaFin}`;
            break;
          }
        }
        if (colisionDetectada) break;
      }

      if (colisionDetectada) {
        console.warn(`  ⚠️ Unificación abortada para "${maestro.destino}": ${colisionDetectada}`);
        errores.push({ destino: maestro.destino, error: colisionDetectada });
        continue;
      }

      // 4.2 Ejecutar Unificación
      for (const viajeSecundario of secundarios) {
        // Obtener itinerarios del secundario
        const itinerariosSec = await new Promise((resolve, reject) => {
          db.all('SELECT * FROM ItinerarioGeneral WHERE viajePrevistoId = ?', [viajeSecundario.id], (err, rows) => err ? reject(err) : resolve(rows || []));
        });

        for (const itinSec of itinerariosSec) {
          // Buscar si el Maestro ya tiene itinerario en esa fecha
          const itinMaestro = await new Promise((resolve, reject) => {
            db.get(
              'SELECT * FROM ItinerarioGeneral WHERE viajePrevistoId = ? AND fechaInicio = ?',
              [maestro.id, itinSec.fechaInicio],
              (err, row) => err ? reject(err) : resolve(row)
            );
          });

          if (itinMaestro) {
            // FUSIONAR
            console.log(`    -> Fusionando itinerario ${itinSec.fechaInicio} (ID ${itinSec.id} -> ${itinMaestro.id})`);
            await new Promise((resolve, reject) => {
              db.run(
                'UPDATE actividades SET itinerarioId = ?, viajePrevistoId = ? WHERE itinerarioId = ?',
                [itinMaestro.id, maestro.id, itinSec.id],
                (err) => err ? reject(err) : resolve()
              );
            });
            // ✅ ACTUALIZAR RUTA DE ARCHIVOS (si contienen la ID del viaje como carpeta)
            // Esto es importante si las rutas son relativas como "ID_VIAJE/..."
            await new Promise((resolve, reject) => {
              db.run(
                `UPDATE archivos 
                 SET rutaArchivo = REPLACE(rutaArchivo, '${viajeSecundario.id}/', '${maestro.id}/') 
                 WHERE actividadId IN (SELECT id FROM actividades WHERE itinerarioId = ?)`,
                [itinMaestro.id],
                (err) => err ? reject(err) : resolve()
              );
            });
            // Eliminar itinerario secundario
            await new Promise((resolve, reject) => {
              db.run('DELETE FROM ItinerarioGeneral WHERE id = ?', [itinSec.id], err => err ? reject(err) : resolve());
            });
          } else {
            // REASIGNAR
            console.log(`    -> Reasignando itinerario ${itinSec.fechaInicio} al maestro`);
            await new Promise((resolve, reject) => {
              db.run(
                'UPDATE ItinerarioGeneral SET viajePrevistoId = ? WHERE id = ?',
                [maestro.id, itinSec.id],
                (err) => err ? reject(err) : resolve()
              );
            });
            await new Promise((resolve, reject) => {
              db.run(
                'UPDATE actividades SET viajePrevistoId = ? WHERE itinerarioId = ?',
                [maestro.id, itinSec.id],
                (err) => err ? reject(err) : resolve()
              );
            });
            // ✅ ACTUALIZAR RUTA DE ARCHIVOS
            await new Promise((resolve, reject) => {
              db.run(
                `UPDATE archivos 
                 SET rutaArchivo = REPLACE(rutaArchivo, '${viajeSecundario.id}/', '${maestro.id}/') 
                 WHERE actividadId IN (SELECT id FROM actividades WHERE itinerarioId = ?)`,
                [itinSec.id],
                (err) => err ? reject(err) : resolve()
              );
            });
          }
        }

        // ✨ NUEVO: MIGRACIÓN DE ARCHIVOS Y ACTUALIZACIÓN DE RUTAS
        console.log(`\n📦 Migrando archivos del viaje ${viajeSecundario.id} al viaje ${maestro.id}...`);

        const carpetaSecundaria = path.join(uploadsPath, viajeSecundario.id.toString());
        const carpetaMaestra = path.join(uploadsPath, maestro.id.toString());

        if (fs.existsSync(carpetaSecundaria)) {
          // Crear carpeta maestra si no existe
          if (!fs.existsSync(carpetaMaestra)) {
            fs.mkdirSync(carpetaMaestra, { recursive: true });
            console.log(`    ✅ Carpeta maestra creada: ${carpetaMaestra}`);
          }

          // Mover cada subcarpeta de itinerario
          const itinerarios = fs.readdirSync(carpetaSecundaria);

          for (const itinerarioFolder of itinerarios) {
            const origenItinerario = path.join(carpetaSecundaria, itinerarioFolder);
            const destinoItinerario = path.join(carpetaMaestra, itinerarioFolder);

            if (fs.statSync(origenItinerario).isDirectory()) {
              // Si ya existe en destino, fusionar contenido
              if (fs.existsSync(destinoItinerario)) {
                console.log(`    🔀 Fusionando carpeta ${itinerarioFolder}...`);

                // Función recursiva para mover archivos
                const moverArchivosRecursivo = (origen, destino) => {
                  const elementos = fs.readdirSync(origen, { withFileTypes: true });

                  for (const elemento of elementos) {
                    const rutaOrigen = path.join(origen, elemento.name);
                    const rutaDestino = path.join(destino, elemento.name);

                    if (elemento.isDirectory()) {
                      // Crear directorio en destino si no existe
                      if (!fs.existsSync(rutaDestino)) {
                        fs.mkdirSync(rutaDestino, { recursive: true });
                      }
                      // Recursión para subdirectorios
                      moverArchivosRecursivo(rutaOrigen, rutaDestino);
                    } else {
                      // Mover archivo
                      fs.renameSync(rutaOrigen, rutaDestino);
                      console.log(`      ✓ Movido: ${elemento.name}`);
                    }
                  }
                };

                moverArchivosRecursivo(origenItinerario, destinoItinerario);

                // Eliminar carpeta origen vacía
                fs.rmSync(origenItinerario, { recursive: true, force: true });
              } else {
                // Mover carpeta completa
                fs.renameSync(origenItinerario, destinoItinerario);
                console.log(`    ✅ Carpeta movida: ${itinerarioFolder}`);
              }
            }
          }

          // Eliminar carpeta secundaria vacía
          try {
            fs.rmSync(carpetaSecundaria, { recursive: true, force: true });
            console.log(`    🗑️ Carpeta secundaria eliminada: ${carpetaSecundaria}`);
          } catch (e) {
            console.warn(`    ⚠️ No se pudo eliminar carpeta: ${e.message}`);
          }
        }

        // ✨ NUEVO: ACTUALIZAR RUTAS EN BASE DE DATOS
        console.log(`\n🔄 Actualizando rutas en base de datos...`);

        // Actualizar tabla archivos
        const rutasActualizadas = await new Promise((resolve, reject) => {
          db.run(
            `UPDATE archivos 
             SET rutaArchivo = REPLACE(rutaArchivo, '${viajeSecundario.id}/', '${maestro.id}/') 
             WHERE rutaArchivo LIKE '${viajeSecundario.id}/%'`,
            [],
            function (err) {
              if (err) return reject(err);
              console.log(`    ✅ Rutas actualizadas en archivos: ${this.changes} registros`);
              resolve(this.changes);
            }
          );
        });

        // Actualizar tabla archivos_asociados
        const rutasAsociadasActualizadas = await new Promise((resolve, reject) => {
          db.run(
            `UPDATE archivos_asociados 
             SET rutaArchivo = REPLACE(rutaArchivo, '${viajeSecundario.id}/', '${maestro.id}/') 
             WHERE rutaArchivo LIKE '${viajeSecundario.id}/%'`,
            [],
            function (err) {
              if (err) return reject(err);
              console.log(`    ✅ Rutas actualizadas en archivos_asociados: ${this.changes} registros`);
              resolve(this.changes);
            }
          );
        });

        // Actualizar tabla actividades (rutas de GPX, mapas, etc.)
        const rutasActividadesActualizadas = await new Promise((resolve, reject) => {
          db.run(
            `UPDATE actividades 
             SET 
               rutaGpxCompleto = REPLACE(rutaGpxCompleto, '${viajeSecundario.id}/', '${maestro.id}/'),
               rutaMapaCompleto = REPLACE(rutaMapaCompleto, '${viajeSecundario.id}/', '${maestro.id}/'),
               rutaManifest = REPLACE(rutaManifest, '${viajeSecundario.id}/', '${maestro.id}/'),
               rutaEstadisticas = REPLACE(rutaEstadisticas, '${viajeSecundario.id}/', '${maestro.id}/')
             WHERE viajePrevistoId = ?`,
            [maestro.id],
            function (err) {
              if (err) return reject(err);
              console.log(`    ✅ Rutas actualizadas en actividades: ${this.changes} registros`);
              resolve(this.changes);
            }
          );
        });

        // Eliminar viaje secundario
        console.log(`\n🗑️ Eliminando viaje secundario ${viajeSecundario.id}...`);

        // Limpiar imagen/audio del viaje si existen
        if (viajeSecundario.imagen) {
          try {
            const imagenPath = path.join(uploadsPath, viajeSecundario.imagen);
            if (fs.existsSync(imagenPath)) {
              fs.unlinkSync(imagenPath);
              console.log(`    ✅ Imagen eliminada: ${viajeSecundario.imagen}`);
            }
          } catch (e) {
            console.warn(`    ⚠️ Error eliminando imagen: ${e.message}`);
          }
        }

        if (viajeSecundario.audio) {
          try {
            const audioPath = path.join(uploadsPath, viajeSecundario.audio);
            if (fs.existsSync(audioPath)) {
              fs.unlinkSync(audioPath);
              console.log(`    ✅ Audio eliminado: ${viajeSecundario.audio}`);
            }
          } catch (e) {
            console.warn(`    ⚠️ Error eliminando audio: ${e.message}`);
          }
        }

        await new Promise((resolve, reject) => {
          db.run('DELETE FROM viajes WHERE id = ?', [viajeSecundario.id], err => {
            if (err) return reject(err);
            console.log(`    ✅ Viaje ${viajeSecundario.id} eliminado de la base de datos`);
            resolve();
          });
        });
      }

      unificadosCount++;
      console.log(`\n✅ Grupo "${maestro.destino}" unificado completamente.`);
    }

    res.json({
      success: true,
      unificados: unificadosCount,
      errores: errores,
      message: `Proceso completado. ${unificadosCount} grupos unificados. ${errores.length} conflictos.`
    });

  } catch (err) {
    console.error('❌ Error en unificación:', err);
    res.status(500).json({ error: err.message });
  }
});


// ----------------------------------------
// RUTAS PARA ItinerarioGeneral
// ----------------------------------------

// 1️⃣ GET todos los itinerarios (o filtrar por viajePrevistoId)
//    - Si pasas ?viajePrevistoId=123, devuelve sólo los de ese viaje

console.log('Registrando rutas de itinerarios...');
app.get('/itinerarios', (req, res) => {
  const { viajePrevistoId } = req.query;
  const sql = viajePrevistoId
    ? 'SELECT * FROM ItinerarioGeneral WHERE viajePrevistoId = ?'
    : 'SELECT * FROM ItinerarioGeneral';
  const params = viajePrevistoId ? [viajePrevistoId] : [];

  db.all(sql, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// 2️⃣ GET un itinerario por ID
app.get('/itinerarios/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM ItinerarioGeneral WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Itinerario no encontrado' });
    }
    res.json(row);
  });
});

// 3️⃣ POST crear un nuevo itinerario
app.post('/itinerarios', (req, res) => {
  const {
    viajePrevistoId,
    fechaInicio,
    horaInicio,
    fechaFin,
    horaFin,
    duracionDias,
    destinosPorDia,
    descripcionGeneral,
    climaGeneral,
    tipoDeViaje
  } = req.body;

  const sql = `INSERT INTO ItinerarioGeneral 
    (viajePrevistoId, fechaInicio, horaInicio, fechaFin, horaFin, duracionDias, destinosPorDia, descripcionGeneral, climaGeneral, tipoDeViaje) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  // Guardamos destinosPorDia como JSON string
  const destinosJSON = JSON.stringify(destinosPorDia);

  db.run(
    sql,
    [viajePrevistoId, fechaInicio, horaInicio, fechaFin, horaFin, duracionDias, destinosJSON, descripcionGeneral, climaGeneral, tipoDeViaje],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({ id: this.lastID });
    }
  );
});

// 4️⃣ PUT actualizar un itinerario existente
app.put('/itinerarios/:id', (req, res) => {
  const { id } = req.params;
  const {
    viajePrevistoId,
    fechaInicio,
    horaInicio,
    fechaFin,
    horaFin,
    duracionDias,
    destinosPorDia,
    descripcionGeneral,
    climaGeneral,
    tipoDeViaje
  } = req.body;

  const sql = `UPDATE ItinerarioGeneral SET
    viajePrevistoId = ?,
    fechaInicio = ?,
    horaInicio = ?,
    fechaFin = ?,
    horaFin = ?,
    duracionDias = ?,
    destinosPorDia = ?,
    descripcionGeneral = ?,
    climaGeneral = ?,
    tipoDeViaje = ?
    WHERE id = ?`;

  const destinosJSON = JSON.stringify(destinosPorDia);

  db.run(
    sql,
    [viajePrevistoId, fechaInicio, horaInicio, fechaFin, horaFin, duracionDias, destinosJSON, descripcionGeneral, climaGeneral, tipoDeViaje, id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ changes: this.changes });
    }
  );
});

// 5️⃣ DELETE eliminar un itinerario
app.delete('/itinerarios/:id', async (req, res) => {
  const id = req.params.id;

  try {
    console.log(`🗑️ Eliminando itinerario ${id} en cascada...`);

    // 1. Obtener actividades
    const actividades = await new Promise((resolve, reject) => {
      db.all(
        'SELECT id FROM actividades WHERE itinerarioId = ?',
        [id],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    // 2. Eliminar archivos y asociados
    let totalArch = 0;
    for (const act of actividades) {
      const archivos = await new Promise((resolve, reject) => {
        db.all(
          'SELECT id, rutaArchivo FROM archivos WHERE actividadId = ?',
          [act.id],
          (err, rows) => err ? reject(err) : resolve(rows || [])
        );
      });

      for (const arch of archivos) {
        // Eliminar asociados
        await new Promise((resolve) => {
          db.all(
            'SELECT rutaArchivo FROM archivos_asociados WHERE archivoPrincipalId = ?',
            [arch.id],
            (err, rows) => {
              rows?.forEach(row => {
                try {
                  if (fs.existsSync(row.rutaArchivo)) fs.unlinkSync(row.rutaArchivo);
                } catch (e) { console.warn(`  ⚠️ No se pudo eliminar: ${row.rutaArchivo}`); }
              });
              resolve();
            }
          );
        });

        await new Promise((resolve) => {
          db.run(
            'DELETE FROM archivos_asociados WHERE archivoPrincipalId = ?',
            [arch.id],
            () => resolve()
          );
        });

        // Eliminar archivo físico
        try {
          if (fs.existsSync(arch.rutaArchivo)) {
            fs.unlinkSync(arch.rutaArchivo);
            totalArch++;
          }
        } catch (e) { console.warn(`  ⚠️ Error: ${arch.rutaArchivo}`); }
      }

      await new Promise((resolve) => {
        db.run('DELETE FROM archivos WHERE actividadId = ?', [act.id], () => resolve());
      });
    }

    // 3. Eliminar actividades
    await new Promise((resolve) => {
      db.run('DELETE FROM actividades WHERE itinerarioId = ?', [id], () => resolve());
    });

    // 4. Eliminar itinerario
    await new Promise((resolve) => {
      db.run('DELETE FROM ItinerarioGeneral WHERE id = ?', [id], () => resolve());
    });

    res.json({
      success: true,
      mensaje: `Itinerario ${id} eliminado en cascada`,
      archivosEliminados: totalArch
    });

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});


// ----------------------------------------
// RUTAS PARA TiposActividad
// ----------------------------------------

console.log('Registrando rutas de tipos de actividad...');

// GET todos los tipos de actividad
app.get('/tipos-actividad', (req, res) => {
  db.all('SELECT * FROM TiposActividad', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// GET para obtener un tipo por ID
app.get('/tipos-actividad/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM TiposActividad WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Tipo de actividad no encontrado' });
    }
    res.json(row);
  });
});

// POST nuevo tipo de actividad
app.post('/tipos-actividad', (req, res) => {
  const { nombre, descripcion } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'El campo nombre es obligatorio' });
  }

  db.run(
    'INSERT INTO TiposActividad (nombre, descripcion) VALUES (?, ?)',
    [nombre, descripcion || null], // Acepta null si no viene descripción
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({
        id: this.lastID,
        message: 'Tipo de actividad creado exitosamente'
      });
    }
  );
});

// PUT actualizar tipo de actividad
app.put('/tipos-actividad/:id', (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'El campo nombre es obligatorio' });
  }

  db.run(
    'UPDATE TiposActividad SET nombre = ?, descripcion = ? WHERE id = ?',
    [nombre, descripcion || null, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Tipo de actividad no encontrado' });
      }
      res.json({
        changes: this.changes,
        message: 'Tipo de actividad actualizado exitosamente'
      });
    }
  );
});

// DELETE eliminar tipo de actividad
app.delete('/tipos-actividad/:id', (req, res) => {
  const { id } = req.params;

  db.run(
    'DELETE FROM TiposActividad WHERE id = ?',
    [id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Tipo de actividad no encontrado' });
      }
      res.json({
        changes: this.changes,
        message: 'Tipo de actividad eliminado exitosamente'
      });
    }
  );
});

// ----------------------------------------
// RUTAS MEJORADAS PARA ActividadesDisponibles
// ----------------------------------------

console.log('Registrando rutas de actividades disponibles...');

// GET todas las actividades (con filtro opcional) + validación
app.get('/actividades-disponibles', (req, res) => {
  const { tipoActividadId } = req.query;

  // Validación tipoActividadId (si se envía)
  if (tipoActividadId && isNaN(Number(tipoActividadId))) {
    return res.status(400).json({ error: "tipoActividadId debe ser un número" });
  }

  const sql = tipoActividadId
    ? 'SELECT * FROM ActividadesDisponibles WHERE tipoActividadId = ?'
    : 'SELECT * FROM ActividadesDisponibles';
  const params = tipoActividadId ? [Number(tipoActividadId)] : [];

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({
      error: "Error al obtener actividades",
      detalles: err.message
    });
    res.json(rows);
  });
});

// GET actividad por ID + manejo de 404
app.get('/actividades-disponibles/:id', (req, res) => {
  const { id } = req.params;

  if (isNaN(Number(id))) {
    return res.status(400).json({ error: "ID debe ser un número" });
  }

  db.get('SELECT * FROM ActividadesDisponibles WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({
      error: "Error al buscar la actividad",
      detalles: err.message
    });
    if (!row) return res.status(404).json({ error: "Actividad no encontrada" });
    res.json(row);
  });
});

// POST nueva actividad + validación de campos
app.post('/actividades-disponibles', (req, res) => {
  const { tipoActividadId, descripcion } = req.body;

  // Validaciones
  if (!tipoActividadId || !descripcion) {
    return res.status(400).json({
      error: "Campos incompletos",
      requeridos: { tipoActividadId: "number", descripcion: "string" }
    });
  }

  db.run(
    'INSERT INTO ActividadesDisponibles (tipoActividadId, descripcion) VALUES (?, ?)',
    [tipoActividadId, descripcion],
    function (err) {
      if (err) return res.status(500).json({
        error: "Error al crear actividad",
        detalles: err.message
      });
      res.status(201).json({
        id: this.lastID,
        message: "Actividad creada exitosamente"
      });
    }
  );
});

// PUT actualizar actividad + validaciones
app.put('/actividades-disponibles/:id', (req, res) => {
  const { id } = req.params;
  const { tipoActividadId, descripcion } = req.body;

  if (isNaN(Number(id))) {
    return res.status(400).json({ error: "ID inválido" });
  }
  if (!tipoActividadId && !descripcion) {
    return res.status(400).json({ error: "Se requiere al menos un campo para actualizar" });
  }

  db.run(
    'UPDATE ActividadesDisponibles SET tipoActividadId = COALESCE(?, tipoActividadId), descripcion = COALESCE(?, descripcion) WHERE id = ?',
    [tipoActividadId, descripcion, id],
    function (err) {
      if (err) return res.status(500).json({
        error: "Error al actualizar actividad",
        detalles: err.message
      });
      if (this.changes === 0) {
        return res.status(404).json({ error: "Actividad no encontrada" });
      }
      res.json({
        updatedId: id,
        changes: this.changes
      });
    }
  );
});

// DELETE actividad + validación
app.delete('/actividades-disponibles/:id', (req, res) => {
  const { id } = req.params;

  if (isNaN(Number(id))) {
    return res.status(400).json({ error: "ID debe ser un número" });
  }

  db.run('DELETE FROM ActividadesDisponibles WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({
      error: "Error al eliminar actividad",
      detalles: err.message
    });
    if (this.changes === 0) {
      return res.status(404).json({ error: "Actividad no encontrada" });
    }
    res.json({
      deletedId: id,
      message: "Actividad eliminada exitosamente"
    });
  });
});

// ----------------------------------------
// RUTAS PARA ActividadesPorItinerario
// ----------------------------------------

console.log('Registrando rutas de actividades por itinerario...');

// GET actividades de un itinerario o de un viaje
app.get('/actividades', (req, res) => {
  const { viajePrevistoId, itinerarioId } = req.query;
  let sql = 'SELECT * FROM actividades';
  let params = [];

  if (itinerarioId) {
    sql += ' WHERE itinerarioId = ?';
    params.push(itinerarioId);
  } else if (viajePrevistoId) {
    sql += ' WHERE viajePrevistoId = ?';
    params.push(viajePrevistoId);
  }

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// POST nueva actividad
app.post('/actividades', (req, res) => {
  const {
    viajePrevistoId,
    itinerarioId,
    tipoActividadId,
    actividadDisponibleId,
    nombre,
    descripcion,
    horaInicio,
    horaFin
  } = req.body;

  db.run(
    `INSERT INTO actividades 
    (viajePrevistoId, itinerarioId, tipoActividadId, actividadDisponibleId, nombre, descripcion, horaInicio, horaFin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [viajePrevistoId, itinerarioId, tipoActividadId, actividadDisponibleId || null, nombre || null, descripcion || null, horaInicio, horaFin],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: this.lastID });
    }
  );
});

// DELETE eliminar actividad
app.delete('/actividades/:id', async (req, res) => {
  const id = req.params.id;

  try {
    console.log(`🗑️ Eliminando actividad ${id}...`);

    // 1. Obtener archivos
    const archivos = await new Promise((resolve, reject) => {
      db.all(
        'SELECT id, rutaArchivo FROM archivos WHERE actividadId = ?',
        [id],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    // 2. Eliminar archivos asociados y físicos
    for (const arch of archivos) {
      // Asociados
      await new Promise((resolve) => {
        db.all(
          'SELECT rutaArchivo FROM archivos_asociados WHERE archivoPrincipalId = ?',
          [arch.id],
          (err, rows) => {
            rows?.forEach(row => {
              try {
                if (fs.existsSync(row.rutaArchivo)) fs.unlinkSync(row.rutaArchivo);
              } catch (e) { }
            });
            resolve();
          }
        );
      });

      await new Promise((resolve) => {
        db.run(
          'DELETE FROM archivos_asociados WHERE archivoPrincipalId = ?',
          [arch.id],
          () => resolve()
        );
      });

      // Principal
      try {
        if (fs.existsSync(arch.rutaArchivo)) fs.unlinkSync(arch.rutaArchivo);
      } catch (e) { }
    }

    // 3. Eliminar archivos
    await new Promise((resolve) => {
      db.run('DELETE FROM archivos WHERE actividadId = ?', [id], () => resolve());
    });

    // 4. Eliminar actividad
    await new Promise((resolve) => {
      db.run('DELETE FROM actividades WHERE id = ?', [id], () => resolve());
    });

    res.json({
      success: true,
      mensaje: `Actividad ${id} eliminada en cascada`,
      archivosEliminados: archivos.length
    });

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------
// NUEVOS ENDPOINTS PARA VER ARCHIVOS
// ----------------------------------------

// GET GPX de una actividad
app.get('/actividades/:id/gpx', (req, res) => {
  const id = req.params.id;

  db.get(
    'SELECT rutaGpxCompleto FROM actividades WHERE id = ?',
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row || !row.rutaGpxCompleto) {
        return res.status(404).json({ error: 'GPX no encontrado' });
      }

      const filePath = path.join(uploadsPath, row.rutaGpxCompleto);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Archivo GPX no existe' });
      }

      res.setHeader('Content-Type', 'application/gpx+xml');
      res.setHeader('Content-Disposition', `attachment; filename="recorrido.gpx"`);
      res.sendFile(filePath);
    }
  );
});

// GET PNG del mapa de una actividad
app.get('/actividades/:id/mapa', (req, res) => {
  const id = req.params.id;

  db.get(
    'SELECT rutaMapaCompleto FROM actividades WHERE id = ?',
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row || !row.rutaMapaCompleto) {
        return res.status(404).json({ error: 'Mapa PNG no encontrado' });
      }

      const filePath = path.join(uploadsPath, row.rutaMapaCompleto);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Archivo PNG no existe' });
      }

      res.setHeader('Content-Type', 'image/png');
      res.sendFile(filePath);
    }
  );
});

// GET Estadísticas JSON de una actividad
app.get('/actividades/:id/estadisticas', (req, res) => {
  const id = req.params.id;

  db.get(
    `SELECT 
      distanciaKm, distanciaMetros, duracionSegundos, duracionFormateada,
      velocidadMediaKmh, velocidadMaximaKmh, velocidadMinimaKmh,
      calorias, pasosEstimados, puntosGPS, perfilTransporte,
      horaInicio, horaFin, nombre, descripcion
    FROM actividades WHERE id = ?`,
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) {
        return res.status(404).json({ error: 'Actividad no encontrada' });
      }

      // Formato de estadísticas
      const estadisticas = {
        nombre: row.nombre,
        descripcion: row.descripcion,
        horario: {
          inicio: row.horaInicio,
          fin: row.horaFin
        },
        distancia: {
          km: row.distanciaKm,
          metros: row.distanciaMetros
        },
        duracion: {
          formateada: row.duracionFormateada,
          segundos: row.duracionSegundos
        },
        velocidad: {
          media: row.velocidadMediaKmh,
          maxima: row.velocidadMaximaKmh,
          minima: row.velocidadMinimaKmh
        },
        energia: {
          calorias: row.calorias,
          pasos: row.pasosEstimados
        },
        tracking: {
          puntosGPS: row.puntosGPS,
          perfilTransporte: row.perfilTransporte
        }
      };

      res.json(estadisticas);
    }
  );
});

console.log('✅ Endpoints de visualización de archivos registrados correctamente');



// ----------------------------------------
// RUTAS PARA Archivos (archivos por actividad)
// ----------------------------------------

console.log('📂 Registrando rutas de archivos...');

// 1️⃣ GET archivos (con filtro opcional por actividadId)
app.get('/archivos', (req, res) => {
  const { actividadId } = req.query;

  let sql = 'SELECT * FROM archivos';
  let params = [];

  if (actividadId) {
    sql += ' WHERE actividadId = ?';
    params.push(actividadId);
  }

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ----------------------------------------
// NUEVO: GET archivos por viaje
// ----------------------------------------
// ----------------------------------------
// NUEVO: GET archivos por itinerario
// ----------------------------------------
app.get('/archivos/itinerario/:itinerarioId', (req, res) => {
  const { itinerarioId } = req.params;

  console.log('🎯 Obteniendo archivos para itinerarioId:', itinerarioId);

  const sql = `
    SELECT a.* 
    FROM archivos a
    INNER JOIN actividades act ON a.actividadId = act.id
    WHERE act.itinerarioId = ?
    ORDER BY a.fechaCreacion DESC
  `;

  db.all(sql, [itinerarioId], (err, rows) => {
    if (err) {
      console.error('❌ Error obteniendo archivos por itinerario:', err.message);
      return res.status(500).json({ error: err.message });
    }

    console.log(`✅ Encontrados ${rows.length} archivos para itinerario ${itinerarioId}`);
    res.json(rows);
  });
});

app.get('/archivos/viaje/:viajeId', (req, res) => {
  const { viajeId } = req.params;

  console.log('🎯 Obteniendo archivos para viajeId:', viajeId);

  const sql = `
    SELECT a.* 
    FROM archivos a
    INNER JOIN actividades act ON a.actividadId = act.id
    WHERE act.viajePrevistoId = ?
    ORDER BY a.fechaCreacion
  `;

  db.all(sql, [viajeId], (err, rows) => {
    if (err) {
      console.error('❌ Error obteniendo archivos por viaje:', err.message);
      return res.status(500).json({ error: err.message });
    }

    console.log(`✅ Encontrados ${rows.length} archivos para viaje ${viajeId}`);
    res.json(rows);
  });
});

// ✅ AÑADIR al server.js - Endpoint que NO procese archivos

app.post('/archivos/buscar-coincidencias-metadatos', (req, res) => {
  try {
    const { viajePrevistoId, actividadId, nombreArchivo, fechaArchivo, horaArchivo } = req.body;

    console.log('\n🔍 =============== BUSCAR COINCIDENCIAS (SOLO METADATOS) ===============');
    console.log('📋 Datos recibidos:', { viajePrevistoId, actividadId, nombreArchivo, fechaArchivo, horaArchivo });

    // ✅ Función para extraer fecha y hora del nombre del archivo
    function parseDateFromFilename(filename) {
      const match = filename.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
      if (match) {
        const [_, y, m, d, h, min, s] = match;
        return {
          fecha: `${y}-${m}-${d}`,
          hora: `${h}:${min}:${s}`
        };
      }
      return null;
    }

    // ✅ Determinar fecha y hora a usar (IGUAL que antes pero sin archivo físico)
    let fechaUsar, horaUsar;

    // 1️⃣ Usar metadatos enviados por el frontend
    if (fechaArchivo && horaArchivo) {
      fechaUsar = fechaArchivo.split('T')[0];
      horaUsar = horaArchivo;
      console.log('📅 Usando fecha/hora del frontend:', fechaUsar, horaUsar);
    }
    // 2️⃣ Si no, parsear desde nombre del archivo
    else {
      const fechaFromName = parseDateFromFilename(nombreArchivo);
      if (fechaFromName) {
        fechaUsar = fechaFromName.fecha;
        horaUsar = fechaFromName.hora;
        console.log('📝 Usando fecha/hora del nombre del archivo:', fechaUsar, horaUsar);
      }
      // 3️⃣ Fallback a fecha actual
      else {
        const now = new Date();
        fechaUsar = now.toISOString().split('T')[0];
        horaUsar = now.toTimeString().split(' ')[0];
        console.log('🕐 Usando fecha/hora actual:', fechaUsar, horaUsar);
      }
    }

    const metadata = { fecha: fechaUsar, hora: horaUsar };

    // ✅ MISMA LÓGICA de búsqueda que en el endpoint original
    const query = `
      SELECT 
        a.id AS actividadId,
        a.nombre AS actividadNombre,
        a.descripcion AS actividadDescripcion,
        a.horaInicio,
        a.horaFin,
        i.id AS itinerarioId,
        i.fechaInicio,
        i.fechaFin,
        v.id AS viajeId,
        v.nombre AS nombreViaje,
        v.destino
      FROM actividades a
      JOIN ItinerarioGeneral i ON a.itinerarioId = i.id
      JOIN viajes v ON a.viajePrevistoId = v.id
      WHERE 
        DATE(?) BETWEEN DATE(i.fechaInicio) AND DATE(i.fechaFin)
        AND TIME(a.horaInicio) <= TIME(?)
        AND TIME(a.horaFin) >= TIME(?)
      ORDER BY a.horaInicio ASC
    `;

    db.all(query, [metadata.fecha, metadata.hora, metadata.hora], (err, actividades) => {
      if (err) {
        console.error('❌ Error en consulta de actividades:', err);
        return res.status(500).json({ error: err.message });
      }

      console.log(`✅ Encontradas ${actividades.length} actividades coincidentes`);

      // ✅ Obtener actividad actual si se proporciona ID
      let actividadActual = null;
      if (actividadId) {
        const queryActual = `
          SELECT 
            a.id AS actividadId, 
            a.nombre AS actividadNombre, 
            a.horaInicio, 
            a.horaFin,
            i.fechaInicio,
            i.fechaFin
          FROM actividades a
          JOIN ItinerarioGeneral i ON a.itinerarioId = i.id
          WHERE a.id = ?
        `;

        db.get(queryActual, [actividadId], (err, row) => {
          if (err) {
            console.error('❌ Error obteniendo actividad actual:', err);
            return res.json({
              metadata,
              actividadesCoincidentes: actividades || [],
              actividadActual: null
            });
          }

          // Validar fechas de la actividad actual
          if (row) {
            const fechaArchivo = new Date(`${metadata.fecha}T${metadata.hora}`);
            const fechaInicio = new Date(row.fechaInicio);
            const fechaFin = new Date(row.fechaFin);

            if (fechaArchivo >= fechaInicio && fechaArchivo <= fechaFin) {
              actividadActual = row;
              console.log('✅ Actividad actual válida:', row.actividadNombre);
            } else {
              console.log('❌ Actividad actual no coincide con fecha del archivo');
            }
          }

          res.json({
            metadata,
            actividadesCoincidentes: actividades || [],
            actividadActual
          });
        });
      } else {
        // Sin actividad actual especificada
        res.json({
          metadata,
          actividadesCoincidentes: actividades || [],
          actividadActual: null
        });
      }
    });

  } catch (error) {
    console.error('[buscar-coincidencias-metadatos] Error:', error);
    res.status(500).json({ error: "Error buscando coincidencias: " + error.message });
  }
});

// Ruta para buscar coincidencias de actividades por fecha/hora de archivo
app.post('/archivos/buscar-coincidencias', upload.single('archivo'), async (req, res) => {
  let archivoTemporal = null;

  try {
    archivoTemporal = req.file?.path; // Guardar ruta para limpieza posterior
    const { actividadId } = req.body;

    // 🔹 Función para extraer fecha y hora del nombre del archivo
    function parseDateFromFilename(filename) {
      const match = filename.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
      if (match) {
        const [_, y, m, d, h, min, s] = match;
        return {
          fecha: `${y}-${m}-${d}`,
          hora: `${h}:${min}:${s}`
        };
      }
      return null;
    }

    console.log('\n🔍 =============== BUSCAR COINCIDENCIAS ===============');

    // 🔹 Obtener metadatos del archivo
    let metadata = await getFileMetadata(req.file.path, req.file.mimetype);
    console.log('📅 Metadatos iniciales:', metadata);

    // 🔹 Determinar fecha y hora a usar
    let fechaUsar, horaUsar;

    // 1️⃣ Intentar usar EXIF si existe
    if (metadata.DateTimeOriginal) {
      const d = new Date(metadata.DateTimeOriginal * 1000); // EXIF usualmente en timestamp Unix
      fechaUsar = d.toISOString().split('T')[0];
      horaUsar = d.toTimeString().split(' ')[0];
      console.log('📸 Usando fecha/hora EXIF:', fechaUsar, horaUsar);
    }
    // 2️⃣ Si no hay EXIF, usar nombre del archivo
    else {
      const fechaFromName = parseDateFromFilename(req.file.originalname);
      if (fechaFromName) {
        fechaUsar = fechaFromName.fecha;
        horaUsar = fechaFromName.hora;
        console.log('⚠️ Usando fecha/hora del nombre del archivo:', fechaUsar, horaUsar);
      }
      // 3️⃣ Si no hay EXIF ni nombre, usar fecha/hora actual
      else {
        const now = new Date();
        fechaUsar = now.toISOString().split('T')[0];
        horaUsar = now.toTimeString().split(' ')[0];
        console.log('⚠️ Usando fecha/hora actual:', fechaUsar, horaUsar);
      }
    }

    metadata.fecha = fechaUsar;
    metadata.hora = horaUsar;

    console.log('📌 actividadId actual:', actividadId);

    // 🔹 Buscar actividades del mismo día y rango horario
    const query = `
      SELECT 
        a.id AS actividadId,
        a.nombre AS actividadNombre,
        a.descripcion AS actividadDescripcion,
        a.horaInicio,
        a.horaFin,
        i.id AS itinerarioId,
        i.fechaInicio,
        i.fechaFin,
        v.id AS viajeId,
        v.nombre AS nombreViaje,
        v.destino
      FROM actividades a
      JOIN ItinerarioGeneral i ON a.itinerarioId = i.id
      JOIN viajes v ON a.viajePrevistoId = v.id
      WHERE 
        DATE(?) BETWEEN DATE(i.fechaInicio) AND DATE(i.fechaFin)
        AND TIME(a.horaInicio) <= TIME(?)
        AND TIME(a.horaFin) >= TIME(?)
      ORDER BY a.horaInicio ASC
    `;

    const actividades = await new Promise((resolve, reject) => {
      db.all(query, [metadata.fecha, metadata.hora, metadata.hora], (err, rows) => {
        if (err) return reject(err);
        console.log(`✅ Encontradas ${rows.length} actividades coincidentes:`);
        rows.forEach(r => console.log(`  - ${r.actividadNombre} (${r.horaInicio}-${r.horaFin})`));
        resolve(rows);
      });
    });

    // 🔹 Obtener actividad actual solo por ID
    let actividadActual = null;
    if (actividadId) {
      actividadActual = await new Promise(resolve => {
        const queryActual = `
          SELECT 
            a.id AS actividadId, 
            a.nombre AS actividadNombre, 
            a.horaInicio, 
            a.horaFin,
            i.fechaInicio,
            i.fechaFin
          FROM actividades a
          JOIN ItinerarioGeneral i ON a.itinerarioId = i.id
          WHERE a.id = ?
        `;
        db.get(queryActual, [actividadId], (err, row) => {
          if (err) {
            console.error('❌ Error obteniendo actividad actual:', err);
            return resolve(null);
          }

          const fechaArchivo = new Date(`${metadata.fecha}T${metadata.hora}`);
          const fechaInicio = new Date(row.fechaInicio);
          const fechaFin = new Date(row.fechaFin);

          if (row && fechaArchivo >= fechaInicio && fechaArchivo <= fechaFin) {
            resolve(row);
          } else {
            resolve(null);
          }
        });
      });
    }

    if (actividadActual) {
      console.log('📌 Actividad actual válida:', actividadActual.actividadNombre, `(${actividadActual.fechaInicio} → ${actividadActual.fechaFin})`);
    } else {
      console.log('❌ Actividad actual no coincide con fecha del archivo');
    }

    res.json({
      metadata,
      actividadesCoincidentes: actividades || [],
      actividadActual
    });

  } catch (error) {
    console.error('[buscar-coincidencias] Error:', error);
    res.status(500).json({ error: "Error buscando coincidencias: " + error.message });
  } finally {
    // ✅ LIMPIEZA IMPORTANTE: Eliminar archivo temporal
    if (archivoTemporal) {
      try {
        const fs = require('fs');
        if (fs.existsSync(archivoTemporal)) {
          fs.unlinkSync(archivoTemporal);
          console.log(`🗑️ Archivo temporal eliminado: ${archivoTemporal}`);
        }
      } catch (cleanupError) {
        console.error('❌ Error eliminando archivo temporal:', cleanupError);
      }
    }
  }
});






// 2️⃣ GET archivo individual por ID
app.get('/archivos/:id', (req, res) => {
  db.get('SELECT * FROM archivos WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Archivo no encontrado' });
    res.json(row);
  });
});

app.post('/archivos', (req, res) => {
  // ✅ AÑADIR fechaCreacion aquí también
  const {
    actividadId, tipo, nombreArchivo, rutaArchivo, descripcion,
    horaCaptura, version, geolocalizacion, metadatos, fechaCreacion
  } = req.body;

  console.log('📝 Creando archivo individual con fechaCreacion:', fechaCreacion);

  // Log de geolocalizacion y metadatos recibidos
  console.log('🐾 Geolocalización recibida para guardar:', geolocalizacion);
  console.log('🐾 Metadatos recibidos para guardar:', metadatos ? (typeof metadatos === 'string' ? metadatos.substring(0, 500) : JSON.stringify(metadatos).substring(0, 500)) : null);

  // ✅ DETERMINAR FECHA DE CREACIÓN
  const fechaFinal = fechaCreacion ? new Date(fechaCreacion).toISOString() : new Date().toISOString();

  db.run(
    `INSERT INTO archivos 
    (actividadId, tipo, nombreArchivo, rutaArchivo, descripcion, horaCaptura, version, geolocalizacion, metadatos, fechaCreacion)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actividadId, tipo, nombreArchivo, rutaArchivo,
      descripcion || null, horaCaptura || null, version || 1,
      geolocalizacion || null, metadatos || null, fechaFinal
    ],
    function (err) {
      if (err) {
        console.error('❌ Error creando archivo:', err);
        return res.status(500).json({ error: err.message });
      }

      console.log('✅ Archivo creado con ID:', this.lastID, 'y fechaCreacion:', fechaFinal);
      res.status(201).json({ id: this.lastID, fechaCreacion: fechaFinal });
    }
  );
});


app.put('/archivos/:id/archivo', upload.single('archivo'), (req, res) => {
  const id = req.params.id;
  const archivo = req.file;
  const { actividadId, tipo, descripcion, horaCaptura, version, geolocalizacion, metadatos } = req.body;

  if (!archivo) {
    return res.status(400).json({ error: 'No se envió archivo para actualizar' });
  }

  console.log('🐾 Actualizando archivo con geolocalizacion:', geolocalizacion);
  console.log('🐾 Actualizando archivo con metadatos:', metadatos ? (typeof metadatos === 'string' ? metadatos.substring(0, 500) : JSON.stringify(metadatos).substring(0, 500)) : null);

  const campos = ['rutaArchivo = ?', 'nombreArchivo = ?'];
  const valores = [archivo.path, archivo.originalname];

  if (actividadId !== undefined) campos.push('actividadId = ?');
  if (tipo !== undefined) campos.push('tipo = ?');
  if (descripcion !== undefined) campos.push('descripcion = ?');
  if (horaCaptura !== undefined) campos.push('horaCaptura = ?');
  if (version !== undefined) campos.push('version = ?');
  if (geolocalizacion !== undefined) campos.push('geolocalizacion = ?');
  if (metadatos !== undefined) campos.push('metadatos = ?');

  campos.push("fechaActualizacion = datetime('now')");
  valores.push(id);

  const sql = `UPDATE archivos SET ${campos.join(', ')} WHERE id = ?`;
  db.run(sql, valores, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ updated: this.changes });
  });
});

app.put('/archivos/:id', (req, res) => {
  const id = req.params.id;
  const { actividadId, tipo, nombreArchivo, descripcion, horaCaptura, version, geolocalizacion, metadatos, fechaCreacion } = req.body;

  // Logs para ver datos antes de actualizar
  console.log('🐾 Actualizando archivo con geolocalizacion:', geolocalizacion);
  console.log('🐾 Actualizando archivo con metadatos:', metadatos ? (typeof metadatos === 'string' ? metadatos.substring(0, 500) : JSON.stringify(metadatos).substring(0, 500)) : null);

  const campos = [];
  const valores = [];

  if (actividadId !== undefined) { campos.push('actividadId = ?'); valores.push(actividadId); }
  if (tipo !== undefined) { campos.push('tipo = ?'); valores.push(tipo); }
  if (nombreArchivo !== undefined) { campos.push('nombreArchivo = ?'); valores.push(nombreArchivo); }
  if (descripcion !== undefined) { campos.push('descripcion = ?'); valores.push(descripcion); }
  if (horaCaptura !== undefined) { campos.push('horaCaptura = ?'); valores.push(horaCaptura); }
  if (version !== undefined) { campos.push('version = ?'); valores.push(version); }
  if (geolocalizacion !== undefined) { campos.push('geolocalizacion = ?'); valores.push(geolocalizacion); }
  if (metadatos !== undefined) { campos.push('metadatos = ?'); valores.push(metadatos); }
  if (fechaCreacion !== undefined) { campos.push('fechaCreacion = ?'); valores.push(fechaCreacion); }

  campos.push("fechaActualizacion = datetime('now')");
  valores.push(id);

  const sql = `UPDATE archivos SET ${campos.join(', ')} WHERE id = ?`;

  console.log('📝 Ejecutando UPDATE con:', { sql, valores }); // Debug

  db.run(sql, valores, function (err) {
    if (err) {
      console.error('❌ Error en UPDATE:', err);
      return res.status(500).json({ error: err.message });
    }

    console.log('✅ Resultado UPDATE:', { changes: this.changes, lastID: this.lastID }); // Debug

    if (this.changes === 0) {
      console.warn('⚠️ No se actualizó ningún registro. Posibles causas:');
      console.warn('- El ID no existe');
      console.warn('- Los datos enviados son idénticos a los existentes');
    }

    res.json({
      updated: this.changes,
      id: id,
      cambiosRealizados: campos.filter(c => !c.includes('fechaActualizacion'))
    });
  });
});


app.post('/archivos/subir', upload.array('archivos'), async (req, res) => {
  const { actividadId, tipo, descripcion, horaCaptura, geolocalizacion, fechaCreacion, actividadesCoincidentes, actividadSeleccionada } = req.body;
  const archivos = req.files;

  console.log('\n🚀 =============== NUEVA SUBIDA DE ARCHIVOS ===============');
  console.log('📦 Datos recibidos del frontend:');
  console.log('  - actividadId:', actividadId);
  console.log('  - actividadSeleccionada:', actividadSeleccionada);
  console.log('  - tipo:', tipo);
  console.log('  - descripcion:', descripcion);
  console.log('  - horaCaptura:', horaCaptura);
  console.log('  - fechaCreacion:', fechaCreacion);
  console.log('  - geolocalizacion:', geolocalizacion);
  console.log('  - archivos recibidos:', archivos?.length || 0);

  if (!archivos?.length) {
    console.log('❌ No se subieron archivos');
    return res.status(400).json({ error: 'No se subieron archivos' });
  }

  function extraerCoordendasGPS(exifTags) {
    try {
      console.log('🔍 Extrayendo coordenadas GPS de EXIF...');
      const { GPSLatitude, GPSLongitude, GPSLatitudeRef, GPSLongitudeRef, GPSAltitude } = exifTags;
      console.log('  - GPSLatitude:', GPSLatitude);
      console.log('  - GPSLongitude:', GPSLongitude);
      console.log('  - GPSLatitudeRef:', GPSLatitudeRef);
      console.log('  - GPSLongitudeRef:', GPSLongitudeRef);
      console.log('  - GPSAltitude:', GPSAltitude);
      if (!GPSLatitude || !GPSLongitude) {
        console.log('⚠️ GPSLatitude o GPSLongitude no están disponibles');
        return null;
      }

      let lat = convertirADecimal(GPSLatitude);
      let lng = convertirADecimal(GPSLongitude);

      console.log(`  - Convertido a decimal lat: ${lat}, lng: ${lng}`);

      if (GPSLatitudeRef?.toLowerCase() === 's') lat = -lat;
      if (GPSLongitudeRef?.toLowerCase() === 'w') lng = -lng;

      const coordenadas = { latitud: lat, longitud: lng, altitud: GPSAltitude || null };
      console.log('🌍 Coordenadas GPS extraídas y corregidas:', coordenadas);
      return JSON.stringify(coordenadas);
    } catch (error) {
      console.error('❌ Error extrayendo GPS:', error);
      return null;
    }
  }

  function convertirADecimal(coordenada) {
    if (typeof coordenada === 'number') return coordenada;
    if (Array.isArray(coordenada) && coordenada.length >= 2) {
      const grados = coordenada[0] || 0;
      const minutos = coordenada[1] || 0;
      const segundos = coordenada[2] || 0;
      const resultado = grados + minutos / 60 + segundos / 3600;
      console.log(`     - Convertir DMS a decimal: ${grados}° ${minutos}' ${segundos}" = ${resultado}`);
      return resultado;
    }
    return coordenada;
  }

  const resultados = [];

  for (const archivo of archivos) {
    try {
      console.log(`\n📁 Procesando archivo: ${archivo.originalname}`);

      let metadatos = {};
      let horaExif = null;
      let geolocalizacionExif = null;

      if (['image/jpeg', 'image/tiff'].includes(archivo.mimetype)) {
        console.log(`  - Leyendo buffer EXIF de ${archivo.originalname}...`);
        const buffer = fs.readFileSync(archivo.path);
        const parser = ExifParser.create(buffer);
        const exifData = parser.parse();
        console.log(`  - Metadata EXIF capturada:`, Object.keys(exifData.tags).length, 'propiedades');

        if (exifData.tags?.DateTimeOriginal) {
          const dt = exifData.tags.DateTimeOriginal;
          if (typeof dt === 'number') horaExif = new Date(dt * 1000).toISOString();
          else if (typeof dt === 'string') {
            const dateStr = dt.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
            horaExif = new Date(dateStr).toISOString();
          } else if (dt instanceof Date) horaExif = dt.toISOString();
          else horaExif = null;
          console.log('  - Fecha original EXIF:', horaExif);
        }

        metadatos = exifData.tags || {};
        geolocalizacionExif = extraerCoordendasGPS(exifData.tags || {});
        if (geolocalizacionExif) console.log('  - GPS encontrado en EXIF del archivo:', archivo.originalname);
      }

      // ✨ NUEVA LÓGICA: Extraer fecha del nombre del archivo
      let fechaCreacionFinal;
      if (fechaCreacion) {
        fechaCreacionFinal = new Date(fechaCreacion).toISOString();
        console.log('✅ Usando fechaCreacion del frontend:', fechaCreacionFinal);
      } else if (horaExif) {
        fechaCreacionFinal = horaExif;
        console.log('📷 Usando fecha EXIF como fallback:', fechaCreacionFinal);
      } else {
        // 🔹 NUEVO: Extraer fecha del nombre del archivo
        // Formatos esperados:
        // 1. "JPEG_20251026_150505_1761495343318.jpg" (YYYYMMDD_HHMMSS)
        // 2. "Recorrido_26_10_1761495343318" (DD_MM_timestamp)
        const matchFormato1 = archivo.originalname.match(/(\d{4})(\d{2})(\d{2})_?(\d{2})(\d{2})(\d{2})/);
        const matchFormato2 = archivo.originalname.match(/(\d{2})_(\d{2})_(\d+)/);

        if (matchFormato1) {
          const [_, y, m, d, h, min, s] = matchFormato1;
          fechaCreacionFinal = new Date(`${y}-${m}-${d}T${h}:${min}:${s}`).toISOString();
          console.log('📝 ✅ Fecha extraída del nombre (formato YYYYMMDD_HHMMSS):', fechaCreacionFinal);
          console.log('   Nombre archivo:', archivo.originalname);
        } else if (matchFormato2) {
          const [_, d, m, timestamp] = matchFormato2;
          // Asumir año 2025 si no está en el nombre
          const hoy = new Date();
          const año = hoy.getFullYear();
          fechaCreacionFinal = new Date(`${año}-${m}-${d}T12:00:00`).toISOString();
          console.log('📝 ✅ Fecha extraída del nombre (formato DD_MM_timestamp):', fechaCreacionFinal);
          console.log('   Nombre archivo:', archivo.originalname);
        } else {
          // Último recurso: usar fecha actual
          fechaCreacionFinal = new Date().toISOString();
          console.log('🕐 ⚠️ No se pudo extraer fecha del archivo, usando fecha actual:', fechaCreacionFinal);
          console.log('   Nombre archivo:', archivo.originalname);
        }
      }

      let geolocalizacionFinal;
      if (geolocalizacionExif) {
        geolocalizacionFinal = geolocalizacionExif;
        console.log('🌍 Usando geolocalización de EXIF');
      } else if (geolocalizacion) {
        geolocalizacionFinal = geolocalizacion;
        console.log('📱 Usando geolocalización del frontend');
      } else {
        geolocalizacionFinal = null;
        console.log('❌ No hay datos de geolocalización disponibles');
      }

      let actividadFinal = null;

      if (actividadId) {
        actividadFinal = actividadId;
        console.log(`📌 Asignando archivo a actividadId del frontend: ${actividadFinal}`);
        console.log('📝 Usuario NO seleccionó actividad manualmente, se usa actividadId por defecto');
      } else if (actividadSeleccionada) {
        actividadFinal = actividadSeleccionada;
        console.log(`📌 Asignando archivo a actividadSeleccionada enviada por frontend: ${actividadFinal}`);
        console.log('📝 Usuario SÍ seleccionó actividad manualmente');
      } else {
        if (!actividadesCoincidentes?.length) {
          console.log(`❌ No hay coincidencias para asignar automáticamente`);
          resultados.push({
            nombre: archivo.originalname,
            estado: 'no-actividad',
            mensaje: 'No hay actividades coincidentes'
          });
          continue;
        } else if (actividadesCoincidentes.length === 1) {
          actividadFinal = actividadesCoincidentes[0].actividadId;
          console.log(`📌 Asignando archivo automáticamente a la única actividad encontrada: ${actividadFinal}`);
          console.log('📝 Usuario NO seleccionó actividad manualmente, se asignó automáticamente');
        } else {
          console.log(`⚠️ Varias coincidencias encontradas, selección necesaria`);
          resultados.push({
            nombre: archivo.originalname,
            estado: 'seleccion-necesaria',
            actividadesCoincidentes
          });
          continue;
        }
      }

      const stmt = await db.prepare(
        `INSERT INTO archivos 
          (actividadId, tipo, nombreArchivo, rutaArchivo, descripcion, horaCaptura, geolocalizacion, metadatos, fechaCreacion) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      console.log('🐾 Geolocalización que se va a guardar (string JSON con coordenadas):', geolocalizacionFinal);
      console.log('🐾 Metadatos completos que se va a guardar:', JSON.stringify(metadatos).substring(0, 500));

      await stmt.run(
        actividadFinal,
        tipo || archivo.mimetype.split('/')[0],
        archivo.originalname,
        archivo.filename, // ✅ USAR filename (relativo) en lugar de path (absoluto)
        descripcion || '',
        horaCaptura || horaExif || new Date().toISOString(),
        geolocalizacionFinal,
        JSON.stringify(metadatos),
        fechaCreacionFinal  // ✨ AHORA USA LA FECHA EXTRAÍDA O EXIF, NO SIEMPRE HOY
      );

      console.log(`✅ Archivo guardado con actividadId: ${actividadFinal}`);
      resultados.push({
        id: stmt.lastID,
        nombre: archivo.originalname,
        estado: 'subido',
        actividadId: actividadFinal,
        fechaCreacion: fechaCreacionFinal,
        geolocalizacion: geolocalizacionFinal,
        metadatos: Object.keys(metadatos).length > 0 ? metadatos : null
      });

    } catch (error) {
      console.error(`❌ Error procesando ${archivo?.originalname}:`, error);
      resultados.push({
        nombre: archivo?.originalname || 'desconocido',
        estado: 'error',
        error: error.message
      });
    }
  }

  console.log('\n🏁 Subida completada. Resultados:', resultados.length);
  console.log('🔍 Detalle de resultados:', resultados);
  res.status(201).json(resultados);
});




// 7️⃣ DELETE archivo
app.delete('/archivos/:id', async (req, res) => {
  const id = req.params.id;

  try {
    console.log(`🗑️ Eliminando archivo ${id}...`);

    // 1. Obtener archivo principal
    const archivo = await dbQuery.get('SELECT rutaArchivo FROM archivos WHERE id = ?', [id]);

    if (!archivo) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    // 2. Obtener y eliminar archivos asociados (físicos)
    const asociados = await dbQuery.all('SELECT rutaArchivo FROM archivos_asociados WHERE archivoPrincipalId = ?', [id]);

    for (const row of asociados) {
      try {
        const fullPath = path.isAbsolute(row.rutaArchivo) ? row.rutaArchivo : path.join(uploadsPath, row.rutaArchivo);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          console.log(`  ✅ Archivo asociado físico eliminado: ${fullPath}`);
        }
      } catch (e) {
        console.warn(`  ⚠️ No se pudo eliminar asociado: ${row.rutaArchivo}`, e.message);
      }
    }

    // 3. Eliminar registros de asociados en BD
    await dbQuery.run('DELETE FROM archivos_asociados WHERE archivoPrincipalId = ?', [id]);

    // 4. Eliminar archivo físico principal
    try {
      const fullPath = path.isAbsolute(archivo.rutaArchivo) ? archivo.rutaArchivo : path.join(uploadsPath, archivo.rutaArchivo);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.log(`  ✅ Archivo físico principal eliminado: ${fullPath}`);
      }
    } catch (e) {
      console.warn(`  ⚠️ No se pudo eliminar archivo físico principal: ${archivo.rutaArchivo}`, e.message);
    }

    // 5. Eliminar registro principal en BD
    await dbQuery.run('DELETE FROM archivos WHERE id = ?', [id]);

    res.json({
      success: true,
      mensaje: `Archivo ${id} eliminado`,
      archivoFisico: archivo.rutaArchivo
    });

  } catch (error) {
    console.error(`❌ Error eliminando archivo: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------
// 8️⃣ GET descargar archivo
// ----------------------------------------
// 8️⃣ GET descargar archivo
app.get('/archivos/:id/descargar', (req, res) => {
  const { id } = req.params;

  console.log('📥 Descargando archivo ID:', id);

  db.get('SELECT rutaArchivo, nombreArchivo FROM archivos WHERE id = ?', [id], (err, row) => {
    if (err) {
      console.error('❌ Error BD:', err.message);
      return res.status(500).json({ error: err.message });
    }

    if (!row) {
      console.error('❌ Archivo no encontrado:', id);
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    console.log('🔍 rutaArchivo en BD:', row.rutaArchivo);

    let filePath;

    // 1️⃣ Si es ruta absoluta, úsala directamente
    if (path.isAbsolute(row.rutaArchivo)) {
      filePath = row.rutaArchivo;
    }
    // 2️⃣ Si ya empieza con "uploads/", quítalo y usa uploadsPath
    else if (row.rutaArchivo.startsWith('uploads/') || row.rutaArchivo.startsWith('uploads\\')) {
      // Quitar "uploads/" del inicio
      const fileName = row.rutaArchivo.replace(/^uploads[\/\\]/, '');
      filePath = path.join(uploadsPath, fileName);
    }
    // 3️⃣ En cualquier otro caso, añade uploadsPath
    else {
      filePath = path.join(uploadsPath, row.rutaArchivo);
    }

    console.log('📁 Ruta completa calculada:', filePath);

    if (!fs.existsSync(filePath)) {
      console.error('❌ Archivo físico no existe:', filePath);
      return res.status(404).json({ error: 'Archivo físico no encontrado' });
    }

    console.log('✅ Descargando:', row.nombreArchivo);
    res.download(filePath, row.nombreArchivo);
  });
});

// ----------------------------------------
// NUEVO: Procesamiento masivo de geolocalización EXIF
// ----------------------------------------

console.log('🌍 Registrando endpoint de procesamiento masivo GPS...');

app.post('/archivos/procesar-geolocalizacion-masiva', async (req, res) => {
  console.log('\n🌍 =============== PROCESAMIENTO MASIVO DE GEOLOCALIZACIÓN ===============');

  try {
    // 1️⃣ Obtener todos los archivos de tipo foto/imagen
    const archivos = await dbQuery.all(
      `SELECT id, nombreArchivo, rutaArchivo, geolocalizacion, tipo 
       FROM archivos 
       WHERE tipo IN ('foto', 'imagen')
       ORDER BY id`,
      []
    );

    console.log(`📊 Total de archivos a procesar: ${archivos.length}`);

    const resultados = {
      total: archivos.length,
      procesados: 0,
      actualizados: 0,
      sinGPS: 0,
      errores: 0,
      detalles: []
    };

    // 2️⃣ Procesar cada archivo
    for (const archivo of archivos) {
      try {
        console.log(`\n📁 [${resultados.procesados + 1}/${archivos.length}] ${archivo.nombreArchivo}`);

        // Verificar que el archivo físico existe
        const fullPath = path.isAbsolute(archivo.rutaArchivo) ? archivo.rutaArchivo : path.join(uploadsPath, archivo.rutaArchivo);
        if (!fs.existsSync(fullPath)) {
          console.warn(`⚠️ Archivo físico no existe: ${fullPath}`);
          resultados.errores++;
          resultados.detalles.push({
            id: archivo.id,
            nombre: archivo.nombreArchivo,
            estado: 'error',
            mensaje: 'Archivo físico no encontrado'
          });
          resultados.procesados++;
          continue;
        }

        // 3️⃣ Leer metadatos EXIF
        const buffer = fs.readFileSync(fullPath);
        const parser = ExifParser.create(buffer);
        const exifData = parser.parse();
        const tags = exifData.tags || {};

        // 4️⃣ Extraer SOLO los campos GPS necesarios
        const gpsLat = tags.GPSLatitude;
        const gpsLng = tags.GPSLongitude;
        const gpsLatRef = tags.GPSLatitudeRef;
        const gpsLngRef = tags.GPSLongitudeRef;
        const gpsAlt = tags.GPSAltitude;

        console.log(`🔍 GPS raw:`, {
          lat: gpsLat,
          lng: gpsLng,
          latRef: gpsLatRef,
          lngRef: gpsLngRef
        });

        // 5️⃣ VALIDACIÓN 1: Verificar que existen y no son null
        if (!gpsLat || !gpsLng || gpsLat === null || gpsLng === null) {
          console.log(`❌ GPS no disponible o null`);
          resultados.sinGPS++;
          resultados.detalles.push({
            id: archivo.id,
            nombre: archivo.nombreArchivo,
            estado: 'sin-gps',
            mensaje: 'No tiene datos GPS en EXIF'
          });
          resultados.procesados++;
          continue;
        }

        // 6️⃣ VALIDACIÓN 2: Si es array, verificar que no esté vacío o lleno de nulls
        if (Array.isArray(gpsLat)) {
          const tieneValoresValidos = gpsLat.some(v => v !== null && v !== undefined && !isNaN(v));
          if (!tieneValoresValidos) {
            console.log(`❌ GPS array vacío o con nulls`);
            resultados.sinGPS++;
            resultados.detalles.push({
              id: archivo.id,
              nombre: archivo.nombreArchivo,
              estado: 'sin-gps',
              mensaje: 'GPS array sin valores válidos'
            });
            resultados.procesados++;
            continue;
          }
        }

        if (Array.isArray(gpsLng)) {
          const tieneValoresValidos = gpsLng.some(v => v !== null && v !== undefined && !isNaN(v));
          if (!tieneValoresValidos) {
            console.log(`❌ GPS array vacío o con nulls`);
            resultados.sinGPS++;
            resultados.detalles.push({
              id: archivo.id,
              nombre: archivo.nombreArchivo,
              estado: 'sin-gps',
              mensaje: 'GPS array sin valores válidos'
            });
            resultados.procesados++;
            continue;
          }
        }

        // 7️⃣ Convertir a decimal
        const convertirADecimal = (coordenada) => {
          // Si ya es un número decimal, devolverlo
          if (typeof coordenada === 'number' && !isNaN(coordenada)) {
            return coordenada;
          }

          // Si es array DMS [grados, minutos, segundos]
          if (Array.isArray(coordenada) && coordenada.length >= 2) {
            const grados = parseFloat(coordenada[0]) || 0;
            const minutos = parseFloat(coordenada[1]) || 0;
            const segundos = parseFloat(coordenada[2]) || 0;

            // Validar que al menos grados sea válido
            if (isNaN(grados)) return null;

            return grados + minutos / 60 + segundos / 3600;
          }

          return null;
        };

        let latitud = convertirADecimal(gpsLat);
        let longitud = convertirADecimal(gpsLng);

        // 8️⃣ VALIDACIÓN 3: Verificar conversión exitosa
        if (latitud === null || longitud === null || isNaN(latitud) || isNaN(longitud)) {
          console.log(`❌ No se pudieron convertir coordenadas`);
          resultados.sinGPS++;
          resultados.detalles.push({
            id: archivo.id,
            nombre: archivo.nombreArchivo,
            estado: 'sin-gps',
            mensaje: 'Conversión de coordenadas falló'
          });
          resultados.procesados++;
          continue;
        }

        // 9️⃣ Aplicar hemisferio (N/S, E/W)
        if (gpsLatRef && typeof gpsLatRef === 'string' && gpsLatRef.toLowerCase() === 's') {
          latitud = -latitud;
        }
        if (gpsLngRef && typeof gpsLngRef === 'string' && gpsLngRef.toLowerCase() === 'w') {
          longitud = -longitud;
        }

        // 🔟 VALIDACIÓN 4: Verificar rango válido
        if (latitud < -90 || latitud > 90 || longitud < -180 || longitud > 180) {
          console.log(`❌ Coordenadas fuera de rango: ${latitud}, ${longitud}`);
          resultados.sinGPS++;
          resultados.detalles.push({
            id: archivo.id,
            nombre: archivo.nombreArchivo,
            estado: 'sin-gps',
            mensaje: `Coordenadas fuera de rango: lat=${latitud}, lng=${longitud}`
          });
          resultados.procesados++;
          continue;
        }

        // 1️⃣1️⃣ Crear objeto JSON LIMPIO con SOLO coordenadas
        const coordenadasLimpias = {
          latitud: parseFloat(latitud.toFixed(6)),
          longitud: parseFloat(longitud.toFixed(6)),
          altitud: (gpsAlt && typeof gpsAlt === 'number' && !isNaN(gpsAlt)) ? Math.round(gpsAlt) : 0
        };

        const gpsJSON = JSON.stringify(coordenadasLimpias);

        console.log('✅ Coordenadas limpias JSON:', gpsJSON);

        // 1️⃣2️⃣ Actualizar en base de datos
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE archivos 
              SET geolocalizacion = ?, 
                  fechaActualizacion = datetime('now') 
              WHERE id = ?`,
            [gpsJSON, archivo.id],
            function (err) {
              if (err) return reject(err);
              resolve();
            }
          );
        });

        resultados.actualizados++;
        resultados.detalles.push({
          id: archivo.id,
          nombre: archivo.nombreArchivo,
          estado: 'actualizado',
          geolocalizacion: coordenadasLimpias
        });
        resultados.procesados++;

      } catch (error) {
        console.error(`❌ Error procesando: ${error.message}`);
        resultados.errores++;
        resultados.detalles.push({
          id: archivo.id,
          nombre: archivo.nombreArchivo,
          estado: 'error',
          mensaje: error.message
        });
        resultados.procesados++;
      }
    }

    console.log('\n🏁 =============== PROCESAMIENTO COMPLETADO ===============');
    console.log(`📊 Resultados:`);
    console.log(`   - Total: ${resultados.total}`);
    console.log(`   - Procesados: ${resultados.procesados}`);
    console.log(`   - Actualizados: ${resultados.actualizados}`);
    console.log(`   - Sin GPS: ${resultados.sinGPS}`);
    console.log(`   - Errores: ${resultados.errores}`);

    res.json(resultados);

  } catch (error) {
    console.error('❌ Error fatal:', error);
    res.status(500).json({
      error: 'Error en procesamiento masivo: ' + error.message
    });
  }
});

console.log('✅ Endpoint de procesamiento GPS registrado correctamente');

// ========================================================================
// NUEVO ENDPOINT: LEER METADATOS EXIF PARA AUTO-ASIGNACIÓN CON IA
// ========================================================================

console.log('📸 Registrando endpoint de lectura EXIF para auto-asignación...');

/**
 * GET /api/archivos/:id/exif
 * Lee metadatos EXIF de un archivo (GPS, fecha, hora)
 * Usado por el servicio de auto-asignación con IA
 */
app.get('/archivos/:id/exif', async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`📸 Leyendo EXIF del archivo ID: ${id}`);

    // 1. Buscar archivo en BD
    const archivo = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM archivos WHERE id = ?', [id], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (!archivo) {
      console.warn(`❌ Archivo ${id} no encontrado en BD`);
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    console.log(`  📁 Archivo encontrado: ${archivo.nombreArchivo}`);
    console.log(`  📂 Tipo: ${archivo.tipo}`);

    // 2. Verificar que sea imagen o video
    if (!['imagen', 'foto', 'video'].includes(archivo.tipo)) {
      console.log(`  ⚠️ No es imagen/video, devolviendo solo fecha de creación`);
      return res.json({
        gps: null,
        fecha: archivo.fechaCreacion,
        hora: archivo.horaCaptura,
        ciudad: null,
        region: null,
        pais: null
      });
    }

    // 3. Construir ruta completa del archivo
    const rutaCompleta = path.isAbsolute(archivo.rutaArchivo)
      ? archivo.rutaArchivo
      : path.join(uploadsPath, archivo.rutaArchivo);

    console.log(`  📍 Ruta completa: ${rutaCompleta}`);

    // 4. Verificar que el archivo físico existe
    if (!fs.existsSync(rutaCompleta)) {
      console.warn(`  ❌ Archivo físico no existe: ${rutaCompleta}`);
      return res.json({
        gps: null,
        fecha: archivo.fechaCreacion,
        hora: archivo.horaCaptura,
        ciudad: null,
        region: null,
        pais: null
      });
    }

    // 5. Leer archivo físico
    let archivoBuffer;
    try {
      archivoBuffer = fs.readFileSync(rutaCompleta);
      console.log(`  ✅ Archivo leído correctamente (${archivoBuffer.length} bytes)`);
    } catch (error) {
      console.error(`  ❌ Error leyendo archivo:`, error.message);
      return res.json({
        gps: null,
        fecha: archivo.fechaCreacion,
        hora: archivo.horaCaptura,
        ciudad: null,
        region: null,
        pais: null
      });
    }

    // 6. Extraer EXIF
    let exifData = null;
    try {
      const parser = ExifParser.create(archivoBuffer);
      exifData = parser.parse();
      console.log(`  📊 EXIF extraído: ${Object.keys(exifData.tags || {}).length} propiedades`);
    } catch (error) {
      console.warn(`  ⚠️ No se pudo leer EXIF:`, error.message);
    }

    // 7. Procesar datos EXIF
    const metadatos = {
      gps: null,
      fecha: archivo.fechaCreacion,
      hora: archivo.horaCaptura,
      ciudad: null,
      region: null,
      pais: null
    };

    if (exifData && exifData.tags) {
      // Extraer GPS
      if (exifData.tags.GPSLatitude && exifData.tags.GPSLongitude) {
        const lat = exifData.tags.GPSLatitude;
        const lon = exifData.tags.GPSLongitude;

        // Convertir a decimal si es necesario
        const latDecimal = typeof lat === 'number' ? lat : (Array.isArray(lat) ? lat[0] + lat[1] / 60 + lat[2] / 3600 : lat);
        const lonDecimal = typeof lon === 'number' ? lon : (Array.isArray(lon) ? lon[0] + lon[1] / 60 + lon[2] / 3600 : lon);

        metadatos.gps = `${latDecimal},${lonDecimal}`;
        console.log(`  🌍 GPS encontrado: ${metadatos.gps}`);

        // Obtener ubicación desde GPS (geocoding reverso)
        try {
          const ubicacion = await obtenerUbicacionDesdeGPS(latDecimal, lonDecimal);
          if (ubicacion) {
            metadatos.ciudad = ubicacion.ciudad;
            metadatos.region = ubicacion.region;
            metadatos.pais = ubicacion.pais;
            console.log(`  📍 Ubicación: ${ubicacion.ciudad}, ${ubicacion.region}, ${ubicacion.pais}`);
          }
        } catch (error) {
          console.warn(`  ⚠️ Error en geocoding:`, error.message);
        }
      } else {
        console.log(`  ⚠️ No hay datos GPS en EXIF`);
      }

      // Extraer fecha/hora EXIF (más precisa que la del filesystem)
      if (exifData.tags.DateTimeOriginal) {
        const dt = exifData.tags.DateTimeOriginal;
        if (typeof dt === 'number') {
          const fechaExif = new Date(dt * 1000);
          metadatos.fecha = fechaExif.toISOString();
          metadatos.hora = fechaExif.toTimeString().split(' ')[0];
        } else if (typeof dt === 'string') {
          const dateStr = dt.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
          const fechaExif = new Date(dateStr);
          metadatos.fecha = fechaExif.toISOString();
          metadatos.hora = fechaExif.toTimeString().split(' ')[0];
        } else if (dt instanceof Date) {
          metadatos.fecha = dt.toISOString();
          metadatos.hora = dt.toTimeString().split(' ')[0];
        }
        console.log(`  📅 Fecha EXIF: ${metadatos.fecha}`);
      }
    }

    console.log(`✅ Metadatos EXIF procesados correctamente`);
    res.json(metadatos);

  } catch (error) {
    console.error('❌ Error en endpoint EXIF:', error);
    res.status(500).json({ error: 'Error al leer metadatos EXIF' });
  }
});

/**
 * 🌍 Función auxiliar: Obtiene ubicación desde coordenadas GPS (geocoding reverso)
 * Usa la API gratuita de OpenStreetMap (Nominatim)
 */
async function obtenerUbicacionDesdeGPS(lat, lon) {
  try {
    const https = require('https');
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`;

    return new Promise((resolve, reject) => {
      https.get(url, {
        headers: {
          'User-Agent': 'TravelMemoryApp/1.0' // Requerido por Nominatim
        }
      }, (response) => {
        let data = '';

        response.on('data', chunk => {
          data += chunk;
        });

        response.on('end', () => {
          try {
            const result = JSON.parse(data);

            if (result && result.address) {
              const address = result.address;

              resolve({
                ciudad: address.city || address.town || address.village || address.municipality,
                region: address.state || address.province || address.region,
                pais: address.country
              });
            } else {
              resolve(null);
            }
          } catch (parseError) {
            reject(parseError);
          }
        });
      }).on('error', (error) => {
        reject(error);
      });
    });
  } catch (error) {
    console.error('Error en geocoding:', error.message);
    return null;
  }
}

console.log('✅ Endpoint de lectura EXIF registrado correctamente');

// Función auxiliar para extraer coordenadas GPS
function extraerCoordendasGPS(exifTags) {
  try {
    console.log('🔍 [extraerCoordendasGPS] Tags recibidos:', JSON.stringify(exifTags).substring(0, 200));

    const { GPSLatitude, GPSLongitude, GPSLatitudeRef, GPSLongitudeRef, GPSAltitude } = exifTags;

    console.log('🔍 [extraerCoordendasGPS] GPS extraídos:', {
      GPSLatitude,
      GPSLongitude,
      GPSLatitudeRef,
      GPSLongitudeRef,
      GPSAltitude
    });

    // ✅ VALIDACIÓN 1: Verificar que existen
    if (!GPSLatitude || !GPSLongitude) {
      console.log('❌ [extraerCoordendasGPS] GPS no disponible');
      return null;
    }

    // ✅ VALIDACIÓN 2: Verificar que no sean null
    if (GPSLatitude === null || GPSLongitude === null) {
      console.log('❌ [extraerCoordendasGPS] GPS es null');
      return null;
    }

    // ✅ VALIDACIÓN 3: Si es array, verificar que tenga valores válidos
    if (Array.isArray(GPSLatitude)) {
      const tieneValores = GPSLatitude.some(v => v !== null && v !== undefined && !isNaN(v));
      if (!tieneValores) {
        console.log('❌ [extraerCoordendasGPS] Array de latitud sin valores válidos');
        return null;
      }
    }

    if (Array.isArray(GPSLongitude)) {
      const tieneValores = GPSLongitude.some(v => v !== null && v !== undefined && !isNaN(v));
      if (!tieneValores) {
        console.log('❌ [extraerCoordendasGPS] Array de longitud sin valores válidos');
        return null;
      }
    }

    // ✅ Función de conversión DENTRO de esta función para evitar conflictos
    const convertirADecimalLocal = (coordenada) => {
      console.log('🔄 [convertirADecimal] Entrada:', coordenada, 'Tipo:', typeof coordenada);

      // Si ya es un número
      if (typeof coordenada === 'number' && !isNaN(coordenada)) {
        console.log('✅ [convertirADecimal] Ya es número:', coordenada);
        return coordenada;
      }

      // Si es array DMS
      if (Array.isArray(coordenada) && coordenada.length >= 2) {
        const grados = parseFloat(coordenada[0]) || 0;
        const minutos = parseFloat(coordenada[1]) || 0;
        const segundos = parseFloat(coordenada[2]) || 0;

        if (isNaN(grados)) {
          console.log('❌ [convertirADecimal] Grados inválido');
          return null;
        }

        const resultado = grados + minutos / 60 + segundos / 3600;
        console.log('✅ [convertirADecimal] DMS convertido:', resultado);
        return resultado;
      }

      console.log('❌ [convertirADecimal] Tipo no soportado');
      return null;
    };

    let lat = convertirADecimalLocal(GPSLatitude);
    let lng = convertirADecimalLocal(GPSLongitude);

    console.log('🔄 [extraerCoordendasGPS] Conversión completada:', { lat, lng });

    // ✅ VALIDACIÓN 4: Verificar conversión exitosa
    if (lat === null || lng === null || isNaN(lat) || isNaN(lng)) {
      console.log('❌ [extraerCoordendasGPS] Conversión falló o resultó en NaN');
      return null;
    }

    // ✅ Aplicar hemisferio
    if (GPSLatitudeRef && typeof GPSLatitudeRef === 'string' && GPSLatitudeRef.toLowerCase() === 's') {
      lat = -lat;
    }
    if (GPSLongitudeRef && typeof GPSLongitudeRef === 'string' && GPSLongitudeRef.toLowerCase() === 'w') {
      lng = -lng;
    }

    // ✅ VALIDACIÓN 5: Verificar rango
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      console.log('❌ [extraerCoordendasGPS] Coordenadas fuera de rango:', { lat, lng });
      return null;
    }

    // ✅ Crear objeto LIMPIO con SOLO coordenadas
    const coordenadas = {
      latitud: parseFloat(lat.toFixed(6)),
      longitud: parseFloat(lng.toFixed(6)),
      altitud: (GPSAltitude && typeof GPSAltitude === 'number' && !isNaN(GPSAltitude)) ? Math.round(GPSAltitude) : 0
    };

    console.log('✅ [extraerCoordendasGPS] Coordenadas finales:', coordenadas);
    return JSON.stringify(coordenadas);

  } catch (error) {
    console.error('❌ [extraerCoordendasGPS] Error:', error);
    return null;
  }
}

// ❌ FUNCIÓN ELIMINADA - ahora cada endpoint usa su propia versión local
// function convertirADecimal(coordenada) {
//   if (typeof coordenada === 'number') return coordenada;
//   if (Array.isArray(coordenada) && coordenada.length >= 2) {
//     const grados = coordenada[0] || 0;
//     const minutos = coordenada[1] || 0;
//     const segundos = coordenada[2] || 0;
//     return grados + minutos / 60 + segundos / 3600;
//   }
//   return coordenada;
// }

// ----------------------------------------
// RUTAS PARA Archivos Asociados
// ----------------------------------------

console.log('📎 Registrando rutas de archivos asociados...');

// 1️⃣ GET archivos asociados (todos o por archivo principal)
app.get('/archivos-asociados', (req, res) => {
  const { archivoPrincipalId } = req.query;

  let sql = 'SELECT * FROM archivos_asociados';
  let params = [];

  if (archivoPrincipalId) {
    sql += ' WHERE archivoPrincipalId = ?';
    params.push(archivoPrincipalId);
  }

  sql += ' ORDER BY fechaCreacion DESC';

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('❌ Error obteniendo archivos asociados:', err.message);
      return res.status(500).json({ error: err.message });
    }

    console.log(`✅ Encontrados ${rows.length} archivos asociados`);
    res.json(rows);
  });
});

// 2️⃣ GET archivo asociado individual por ID
app.get('/archivos-asociados/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM archivos_asociados WHERE id = ?', [id], (err, row) => {
    if (err) {
      console.error('❌ Error obteniendo archivo asociado:', err.message);
      return res.status(500).json({ error: err.message });
    }

    if (!row) {
      return res.status(404).json({ error: 'Archivo asociado no encontrado' });
    }

    console.log('✅ Archivo asociado encontrado:', row.nombreArchivo);
    res.json(row);
  });
});

// 3️⃣ POST crear nuevo archivo asociado (solo metadatos)
app.post('/archivos-asociados', (req, res) => {
  const { archivoPrincipalId, tipo, nombreArchivo, rutaArchivo, descripcion } = req.body;

  console.log('📝 Creando archivo asociado:', {
    archivoPrincipalId,
    tipo,
    nombreArchivo,
    rutaArchivo,
    descripcion
  });

  // Validaciones
  if (!archivoPrincipalId || !tipo || !nombreArchivo || !rutaArchivo) {
    return res.status(400).json({
      error: 'Los campos archivoPrincipalId, tipo, nombreArchivo y rutaArchivo son obligatorios'
    });
  }

  if (!['audio', 'texto'].includes(tipo)) {
    return res.status(400).json({
      error: 'El tipo debe ser "audio" o "texto"'
    });
  }

  // Verificar que el archivo principal existe
  db.get('SELECT id FROM archivos WHERE id = ?', [archivoPrincipalId], (err, archivoExiste) => {
    if (err) {
      console.error('❌ Error verificando archivo principal:', err.message);
      return res.status(500).json({ error: err.message });
    }

    if (!archivoExiste) {
      return res.status(404).json({ error: 'El archivo principal no existe' });
    }

    const fechaActual = new Date().toISOString();

    db.run(
      `INSERT INTO archivos_asociados 
      (archivoPrincipalId, tipo, nombreArchivo, rutaArchivo, descripcion, fechaCreacion, fechaActualizacion, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        archivoPrincipalId,
        tipo,
        nombreArchivo,
        rutaArchivo,
        descripcion || null,
        fechaActual,
        fechaActual,
        1
      ],
      function (err) {
        if (err) {
          console.error('❌ Error creando archivo asociado:', err.message);
          return res.status(500).json({ error: err.message });
        }

        console.log('✅ Archivo asociado creado con ID:', this.lastID);
        res.status(201).json({
          id: this.lastID,
          archivoPrincipalId,
          tipo,
          nombreArchivo,
          rutaArchivo,
          descripcion: descripcion || null,
          fechaCreacion: fechaActual,
          fechaActualizacion: fechaActual,
          version: 1
        });
      }
    );
  });
});

// 4️⃣ POST subir archivo asociado (archivo físico + metadatos)
app.post('/archivos-asociados/subir', upload.single('archivo'), (req, res) => {
  const archivo = req.file;
  const { archivoPrincipalId, tipo, descripcion } = req.body;

  console.log('📤 Subiendo archivo asociado - Inicio');
  console.log('📤 Parámetros recibidos:', { archivoPrincipalId, tipo, descripcion });
  console.log('📤 Archivo recibido:', archivo ? {
    originalname: archivo.originalname,
    mimetype: archivo.mimetype,
    size: archivo.size,
    path: archivo.path
  } : 'Ninguno');

  if (!archivo) {
    console.warn('⚠️ No se envió archivo para subir');
    return res.status(400).json({ error: 'No se envió archivo para subir' });
  }

  if (!archivoPrincipalId || !tipo) {
    console.warn('⚠️ Parámetros obligatorios faltantes');
    return res.status(400).json({ error: 'Los campos archivoPrincipalId y tipo son obligatorios' });
  }

  if (!['audio', 'texto', 'mapa_ubicacion', 'gpx', 'manifest', 'estadisticas'].includes(tipo)) {
    return res.status(400).json({ error: 'El tipo debe ser "audio", "texto", "mapa_ubicacion", "gpx", "manifest" o "estadisticas"' });
  }


  // Validar tipo de archivo según tipo y mimetype
  if (tipo === 'audio' && !archivo.mimetype.startsWith('audio/')) {
    console.warn('⚠️ Archivo no es audio:', archivo.mimetype);
    return res.status(400).json({ error: 'El archivo debe ser de tipo audio para el tipo "audio"' });
  }

  if (tipo === 'texto' && !['text/', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].some(t => archivo.mimetype.includes(t))) {
    console.warn('⚠️ Archivo no es texto/PDF/documento:', archivo.mimetype);
    return res.status(400).json({ error: 'El archivo debe ser de tipo texto, PDF o documento para el tipo "texto"' });
  }

  if (tipo === 'imagen' && !archivo.mimetype.startsWith('image/')) {
    console.warn('⚠️ Archivo no es imagen:', archivo.mimetype);
    return res.status(400).json({ error: 'El archivo debe ser de tipo imagen para el tipo "imagen"' });
  }

  console.log('📤 Validación pasada, guardando en base de datos...');

  // Verificar que el archivo principal existe
  db.get('SELECT id FROM archivos WHERE id = ?', [archivoPrincipalId], (err, archivoExiste) => {
    if (err) {
      console.error('❌ Error verificando archivo principal:', err.message);
      return res.status(500).json({ error: err.message });
    }
    if (!archivoExiste) {
      console.warn('⚠️ Archivo principal no existe:', archivoPrincipalId);
      return res.status(404).json({ error: 'El archivo principal no existe' });
    }

    const fechaActual = new Date().toISOString();

    db.run(
      `INSERT INTO archivos_asociados 
      (archivoPrincipalId, tipo, nombreArchivo, rutaArchivo, descripcion, fechaCreacion, fechaActualizacion, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        archivoPrincipalId,
        tipo,
        archivo.originalname,
        archivo.filename, // ✅ Guardar solo nombre relativo
        descripcion || null,
        fechaActual,
        fechaActual,
        1
      ],
      function (err) {
        if (err) {
          console.error('❌ Error guardando archivo asociado:', err.message);
          return res.status(500).json({ error: err.message });
        }

        console.log('✅ Archivo asociado subido con ID:', this.lastID);
        res.status(201).json({
          id: this.lastID,
          archivoPrincipalId: parseInt(archivoPrincipalId),
          tipo,
          nombreArchivo: archivo.originalname,
          rutaArchivo: archivo.path,
          descripcion: descripcion || null,
          fechaCreacion: fechaActual,
          fechaActualizacion: fechaActual,
          version: 1
        });
      }
    );
  });
});



// 5️⃣ PUT actualizar archivo asociado (solo metadatos)
app.put('/archivos-asociados/:id', (req, res) => {
  const { id } = req.params;
  const { tipo, nombreArchivo, rutaArchivo, descripcion } = req.body;

  console.log('📝 Actualizando metadatos de archivo asociado ID:', id, req.body);

  const campos = [];
  const valores = [];

  // Agregar campos condicionalmente
  if (tipo !== undefined) {
    if (!['audio', 'texto'].includes(tipo)) {
      return res.status(400).json({ error: 'El tipo debe ser "audio" o "texto"' });
    }
    campos.push('tipo = ?');
    valores.push(tipo);
  }
  if (nombreArchivo !== undefined) { campos.push('nombreArchivo = ?'); valores.push(nombreArchivo); }
  if (rutaArchivo !== undefined) { campos.push('rutaArchivo = ?'); valores.push(rutaArchivo); }
  if (descripcion !== undefined) { campos.push('descripcion = ?'); valores.push(descripcion); }

  // Incrementar versión y actualizar fecha
  campos.push('version = version + 1');
  campos.push("fechaActualizacion = datetime('now')");

  // Agregar ID al final para el WHERE
  valores.push(id);

  if (campos.length === 2) { // Solo fechaActualizacion y version
    return res.status(400).json({ error: 'No se proporcionaron campos para actualizar' });
  }

  const sql = `UPDATE archivos_asociados SET ${campos.join(', ')} WHERE id = ?`;

  console.log('📝 Ejecutando UPDATE:', { sql, valores });

  db.run(sql, valores, function (err) {
    if (err) {
      console.error('❌ Error actualizando archivo asociado:', err.message);
      return res.status(500).json({ error: err.message });
    }

    if (this.changes === 0) {
      console.warn('⚠️ No se actualizó ningún registro para ID:', id);
      return res.status(404).json({ error: 'Archivo asociado no encontrado' });
    }

    console.log('✅ Archivo asociado actualizado:', { changes: this.changes });

    // Devolver el archivo actualizado
    db.get('SELECT * FROM archivos_asociados WHERE id = ?', [id], (err, row) => {
      if (err) {
        console.error('❌ Error obteniendo archivo actualizado:', err.message);
        return res.status(500).json({ error: err.message });
      }

      res.json(row);
    });
  });
});

// ✅ PUT: Actualizar geolocalización de todas las fotos de una actividad
app.put('/archivos/actividad/:actividadId/geolocalizacion', (req, res) => {
  const { actividadId } = req.params;
  const { geolocalizacion } = req.body;

  if (!geolocalizacion) {
    return res.status(400).json({ error: 'Falta geolocalizacion en el body' });
  }

  const sql = `
    UPDATE archivos
    SET geolocalizacion = ?, fechaActualizacion = datetime('now')
    WHERE actividadId = ? AND tipo IN ('foto', 'imagen')
  `;

  db.run(sql, [geolocalizacion, actividadId], function (err) {
    if (err) {
      console.error('❌ Error actualizando geolocalización:', err.message);
      return res.status(500).json({ error: err.message });
    }

    console.log(`✅ Geolocalización actualizada en ${this.changes} archivo(s) de la actividad ${actividadId}`);
    res.json({ actualizados: this.changes });
  });
});

// 6️⃣ PUT actualizar archivo asociado (archivo físico + metadatos)
app.put('/archivos-asociados/:id/archivo', upload.single('archivo'), (req, res) => {
  const { id } = req.params;
  const archivo = req.file;
  const { tipo, descripcion } = req.body;

  console.log('📤 Actualizando archivo físico asociado ID:', id, {
    tipo,
    descripcion,
    archivo: archivo ? archivo.originalname : 'No hay archivo'
  });

  if (!archivo) {
    return res.status(400).json({ error: 'No se envió archivo para actualizar' });
  }

  // Validar tipo si se proporciona
  if (tipo && !['audio', 'texto'].includes(tipo)) {
    return res.status(400).json({ error: 'El tipo debe ser "audio" o "texto"' });
  }

  // Validar tipo de archivo según el tipo especificado
  if (tipo === 'audio' && !archivo.mimetype.startsWith('audio/')) {
    return res.status(400).json({
      error: 'El archivo debe ser de tipo audio para el tipo "audio"'
    });
  }

  if (tipo === 'texto' && !['text/', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].some(t => archivo.mimetype.includes(t))) {
    return res.status(400).json({
      error: 'El archivo debe ser de tipo texto, PDF o documento para el tipo "texto"'
    });
  }

  const campos = ['rutaArchivo = ?', 'nombreArchivo = ?'];
  const valores = [archivo.filename, archivo.originalname]; // ✅ Usar filename relativo

  if (tipo !== undefined) { campos.push('tipo = ?'); valores.push(tipo); }
  if (descripcion !== undefined) { campos.push('descripcion = ?'); valores.push(descripcion); }

  // Incrementar versión y actualizar fecha
  campos.push('version = version + 1');
  campos.push("fechaActualizacion = datetime('now')");

  valores.push(id);

  const sql = `UPDATE archivos_asociados SET ${campos.join(', ')} WHERE id = ?`;

  db.run(sql, valores, function (err) {
    if (err) {
      console.error('❌ Error actualizando archivo asociado con archivo:', err.message);
      return res.status(500).json({ error: err.message });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Archivo asociado no encontrado' });
    }

    console.log('✅ Archivo asociado actualizado con nuevo archivo');

    // Devolver el archivo actualizado
    db.get('SELECT * FROM archivos_asociados WHERE id = ?', [id], (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(row);
    });
  });
});

// 7️⃣ DELETE archivo asociado
app.delete('/archivos-asociados/:id', (req, res) => {
  const { id } = req.params;

  console.log('🗑️ Eliminando archivo asociado ID:', id);

  // Primero obtener la ruta del archivo para eliminarlo físicamente
  db.get('SELECT rutaArchivo, nombreArchivo FROM archivos_asociados WHERE id = ?', [id], (err, archivo) => {
    if (err) {
      console.error('❌ Error obteniendo archivo asociado para eliminar:', err.message);
      return res.status(500).json({ error: err.message });
    }

    if (!archivo) {
      return res.status(404).json({ error: 'Archivo asociado no encontrado' });
    }

    // Eliminar registro de la base de datos
    db.run('DELETE FROM archivos_asociados WHERE id = ?', [id], function (err) {
      if (err) {
        console.error('❌ Error eliminando archivo asociado de BD:', err.message);
        return res.status(500).json({ error: err.message });
      }

      // Intentar eliminar archivo físico
      if (archivo.rutaArchivo) {
        try {
          const fullPath = path.isAbsolute(archivo.rutaArchivo) ? archivo.rutaArchivo : path.join(uploadsPath, archivo.rutaArchivo);
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            console.log('✅ Archivo físico eliminado:', fullPath);
          }
        } catch (fsError) {
          console.warn('⚠️ No se pudo eliminar el archivo físico:', fsError.message);
        }
      }

      console.log('✅ Archivo asociado eliminado:', archivo.nombreArchivo);
      res.json({
        deleted: this.changes,
        nombreArchivo: archivo.nombreArchivo,
        mensaje: 'Archivo asociado eliminado correctamente'
      });
    });
  });
});

// 8️⃣ DELETE todos los archivos asociados de un archivo principal
app.delete('/archivos-asociados/archivo-principal/:archivoPrincipalId', (req, res) => {
  const { archivoPrincipalId } = req.params;

  console.log('🗑️ Eliminando todos los archivos asociados del archivo principal ID:', archivoPrincipalId);

  // Obtener todos los archivos asociados para eliminar archivos físicos
  db.all('SELECT rutaArchivo, nombreArchivo FROM archivos_asociados WHERE archivoPrincipalId = ?', [archivoPrincipalId], (err, archivos) => {
    if (err) {
      console.error('❌ Error obteniendo archivos asociados para eliminar:', err.message);
      return res.status(500).json({ error: err.message });
    }

    // Eliminar registros de la base de datos
    db.run('DELETE FROM archivos_asociados WHERE archivoPrincipalId = ?', [archivoPrincipalId], function (err) {
      if (err) {
        console.error('❌ Error eliminando archivos asociados de BD:', err.message);
        return res.status(500).json({ error: err.message });
      }

      // Intentar eliminar archivos físicos
      const fs = require('fs');
      let archivosEliminados = 0;

      archivos.forEach(archivo => {
        if (archivo.rutaArchivo) {
          try {
            if (fs.existsSync(archivo.rutaArchivo)) {
              fs.unlinkSync(archivo.rutaArchivo);
              archivosEliminados++;
              console.log('✅ Archivo físico eliminado:', archivo.rutaArchivo);
            }
          } catch (fsError) {
            console.warn('⚠️ No se pudo eliminar archivo físico:', archivo.rutaArchivo, fsError.message);
          }
        }
      });

      console.log(`✅ Eliminados ${this.changes} archivos asociados (${archivosEliminados} archivos físicos)`);
      res.json({
        deleted: this.changes,
        archivosEliminados,
        mensaje: `${this.changes} archivos asociados eliminados correctamente`
      });
    });
  });
});

// 9️⃣ GET descargar archivo asociado
app.get('/archivos-asociados/:id/descargar', (req, res) => {
  const { id } = req.params;

  console.log('📥 Descargando archivo asociado ID:', id);

  db.get(
    'SELECT * FROM archivos_asociados WHERE id = ?',
    [id],
    (err, row) => {
      if (err) {
        console.error('❌ Error BD:', err.message);
        return res.status(500).json({ error: 'Database error' });
      }

      if (!row) {
        console.error('❌ Archivo asociado no encontrado: ID', id);
        return res.status(404).json({ error: 'Archivo asociado no encontrado' });
      }

      console.log('📁 Ruta en BD:', row.rutaArchivo);

      // ✅ CORRECCIÓN: Detectar si la ruta es absoluta o relativa
      let filePath;

      // Verificar si la ruta es absoluta (Windows: C:\ o Linux: /)
      if (path.isAbsolute(row.rutaArchivo)) {
        // Ya es absoluta, usar tal cual
        filePath = row.rutaArchivo;
        console.log('✓ Ruta absoluta detectada, usando directamente');
      } else {
        // Es relativa, combinar con uploadsPath
        filePath = path.join(uploadsPath, row.rutaArchivo);
        console.log('✓ Ruta relativa detectada, combinando con uploadsPath');
      }

      console.log('📁 Ruta completa del archivo:', filePath);

      if (!fs.existsSync(filePath)) {
        console.error('❌ Archivo físico no existe:', filePath);
        console.error('   Directorio padre existe:', fs.existsSync(path.dirname(filePath)));
        console.error('   Archivos en directorio:');

        try {
          const dir = path.dirname(filePath);
          if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            files.forEach(f => console.error(`     - ${f}`));
          }
        } catch (e) {
          console.error('   No se pudo listar directorio');
        }

        return res.status(404).json({ error: 'Archivo físico no encontrado en disco' });
      }

      console.log('✅ Descargando archivo asociado:', row.nombreArchivo);
      res.download(filePath, row.nombreArchivo);
    }
  );
});

// ----------------------------------------
// 🆕 POST: Corregir fechas desde nombre de archivo
// ----------------------------------------
app.post('/actividades/:id/corregir-fechas-nombre', (req, res) => {
  const { id } = req.params;

  console.log('🔄 Corrigiendo fechas desde nombres de archivo para actividad:', id);

  // 1️⃣ Obtener todos los archivos de la actividad
  db.all('SELECT * FROM archivos WHERE actividadId = ? ORDER BY nombreArchivo ASC', [id], (err, archivos) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!archivos || archivos.length === 0) {
      return res.status(404).json({ error: 'No hay archivos en esta actividad' });
    }

    let ultimaFechaExtraida = null;
    let archivosActualizados = 0;
    let archivosSinFecha = 0;

    // 2️⃣ Procesar cada archivo
    const updates = [];

    archivos.forEach((archivo) => {
      let fechaCaptura = null;

      // 3️⃣ Intentar extraer fecha del nombre
      // Formatos soportados:
      // IMG_20220129_134353.jpg
      // JPEG_20251230_105305_1767088385958.jpg
      // 1767698649281_DSCN00013.JPG (timestamp en milisegundos)

      const match1 = archivo.nombreArchivo.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
      const match2 = archivo.nombreArchivo.match(/^(\d{13})/); // timestamp de 13 dígitos

      if (match1) {
        // Formato: IMG_20220129_134353.jpg
        fechaCaptura = new Date(
          parseInt(match1[1]), // año
          parseInt(match1[2]) - 1, // mes (0-indexed)
          parseInt(match1[3]), // día
          parseInt(match1[4]), // hora
          parseInt(match1[5]), // minuto
          parseInt(match1[6])  // segundo
        );
        ultimaFechaExtraida = fechaCaptura;
        console.log(`✅ Fecha extraída de ${archivo.nombreArchivo}:`, fechaCaptura);
      } else if (match2) {
        // Formato: 1767698649281_DSCN00013.JPG (timestamp)
        fechaCaptura = new Date(parseInt(match2[1]));
        ultimaFechaExtraida = fechaCaptura;
        console.log(`✅ Fecha extraída (timestamp) de ${archivo.nombreArchivo}:`, fechaCaptura);
      }

      // 4️⃣ Si no se pudo extraer, usar la última fecha válida
      if (!fechaCaptura && ultimaFechaExtraida) {
        fechaCaptura = new Date(ultimaFechaExtraida);
        console.log(`⚠️ Usando fecha anterior para ${archivo.nombreArchivo}`);
      }

      // 5️⃣ Si hay fecha válida, preparar actualización
      if (fechaCaptura) {
        const horaCaptura = fechaCaptura.toTimeString().substring(0, 8); // HH:MM:SS
        const fechaCreacion = fechaCaptura.toISOString().split('T')[0]; // YYYY-MM-DD

        updates.push({
          id: archivo.id,
          horaCaptura,
          fechaCreacion,
          nombreArchivo: archivo.nombreArchivo
        });
      } else {
        archivosSinFecha++;
      }
    });

    // 6️⃣ Si no se pudo extraer ninguna fecha
    if (updates.length === 0) {
      return res.status(400).json({
        error: 'No se pudo extraer fechas de ningún archivo. Por favor, corrígelas manualmente.',
        archivosSinFecha
      });
    }

    // 7️⃣ Actualizar todos los archivos
    const updatePromises = updates.map(update => {
      return new Promise((resolve) => {
        db.run(
          'UPDATE archivos SET horaCaptura = ?, fechaCreacion = ? WHERE id = ?',
          [update.horaCaptura, update.fechaCreacion, update.id],
          (err) => {
            if (!err) {
              archivosActualizados++;
              console.log(`📝 Actualizado ${update.nombreArchivo}: ${update.fechaCreacion} ${update.horaCaptura}`);
            }
            resolve();
          }
        );
      });
    });

    // 8️⃣ Esperar a que terminen todas las actualizaciones
    Promise.all(updatePromises).then(() => {
      // 9️⃣ Actualizar itinerario y viaje
      actualizarItinerarioYViaje(id, (success) => {
        if (success) {
          res.json({
            message: 'Fechas corregidas exitosamente',
            archivosActualizados,
            archivosSinFecha
          });
        } else {
          res.status(500).json({ error: 'Error actualizando itinerario/viaje' });
        }
      });
    });
  });
});

// ----------------------------------------
// 🔧 Función auxiliar: Actualizar itinerario y viaje
// ----------------------------------------
function actualizarItinerarioYViaje(actividadId, callback) {
  // Obtener la actividad y su itinerario
  db.get('SELECT itinerarioId FROM actividades WHERE id = ?', [actividadId], (err, actividad) => {
    if (err || !actividad) {
      console.error('❌ Error obteniendo actividad:', err?.message);
      return callback(false);
    }

    const itinerarioId = actividad.itinerarioId;

    // Obtener la fecha más temprana y más tardía de los archivos
    db.get(
      `SELECT 
        MIN(fechaCreacion || ' ' || horaCaptura) as fechaMin,
        MAX(fechaCreacion || ' ' || horaCaptura) as fechaMax
       FROM archivos WHERE actividadId = ?`,
      [actividadId],
      (err, result) => {
        if (err || !result.fechaMin) {
          console.error('❌ Error obteniendo fechas de archivos:', err?.message);
          return callback(false);
        }

        const fechaInicio = result.fechaMin.split(' ')[0]; // Solo la fecha
        const fechaFin = result.fechaMax.split(' ')[0];

        console.log(`📅 Actualizando itinerario ${itinerarioId}: ${fechaInicio} - ${fechaFin}`);

        // ✅ Actualizar ItinerarioGeneral (nombre correcto de la tabla)
        db.run(
          `UPDATE ItinerarioGeneral 
           SET fechaInicio = datetime(?, 'start of day'),
               fechaFin = datetime(?, 'start of day', '+23 hours', '+59 minutes', '+59 seconds')
           WHERE id = ?`,
          [fechaInicio, fechaFin, itinerarioId],
          (err) => {
            if (err) {
              console.error('❌ Error actualizando ItinerarioGeneral:', err.message);
              return callback(false);
            }

            console.log('✅ ItinerarioGeneral actualizado correctamente');

            // Obtener viaje del itinerario
            db.get('SELECT viajePrevistoId FROM ItinerarioGeneral WHERE id = ?', [itinerarioId], (err, itinerario) => {
              if (err || !itinerario) {
                console.error('❌ Error obteniendo itinerario:', err?.message);
                return callback(false);
              }

              console.log(`📅 Actualizando viaje ${itinerario.viajePrevistoId}: ${fechaInicio} - ${fechaFin}`);

              // Actualizar tabla viajes
              db.run(
                `UPDATE viajes 
   SET fecha_inicio = date(?),
       fecha_fin = date(?)
   WHERE id = ?`,
                [fechaInicio, fechaFin, itinerario.viajePrevistoId],
                (err) => {
                  if (err) {
                    console.error('❌ Error actualizando viaje:', err.message);
                    return callback(false);
                  }
                  console.log('✅ Viaje actualizado correctamente');
                  callback(true);
                }
              );
            });
          }
        );
      }
    );
  });
}

console.log('✅ Rutas de archivos asociados registradas correctamente');

// ----------------------------------------
// NUEVO: ENDPOINT DE IMPORTACIÓN DE TRACKINGS GPS
// ----------------------------------------

console.log('📥 Registrando endpoint de importación de trackings...');

// Configurar multer para importación con múltiples archivos
const importStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempPath = path.join(uploadsPath, 'temp-imports');
    if (!fs.existsSync(tempPath)) {
      fs.mkdirSync(tempPath, { recursive: true });
    }
    cb(null, tempPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const importUpload = multer({
  storage: importStorage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB por archivo
});

/**
 * POST /api/import-tracking
 * Importa un tracking completo desde AudioPhotoApp
 * Recibe: FormData con archivos + metadata
 */
app.post('/import-tracking', importUpload.any(), async (req, res) => {
  console.log('\n🚀 =============== IMPORTACIÓN DE TRACKING ===============');
  console.log('📦 Archivos recibidos:', req.files?.length || 0);

  let viajeId = null;
  let itinerarioId = null;
  let actividadId = null;
  let manifestData = null;
  const archivosCreados = [];

  try {
    // 1. VALIDAR DATOS RECIBIDOS
    const { destino, tipoActividadId } = req.body;

    if (!destino || !tipoActividadId) {
      throw new Error('Faltan campos obligatorios: destino, tipoActividadId');
    }

    if (!req.files || req.files.length === 0) {
      throw new Error('No se recibieron archivos para importar');
    }

    console.log(`✅ Validación inicial completada`);
    console.log(`📍 Destino recibido: "${destino}"`);

    // 2. BUSCAR Y PARSEAR manifest.json
    const manifestFile = req.files.find(f => f.originalname === 'manifest.json');
    if (!manifestFile) {
      throw new Error('No se encontró manifest.json en los archivos');
    }

    manifestData = JSON.parse(fs.readFileSync(manifestFile.path, 'utf8'));
    console.log('✅ Manifest parseado:', manifestData.nombre);

    // ========================================================================
    // 3. CALCULAR FECHA REAL DEL RECORRIDO Y EXTRAER UBICACIÓN DESDE GPS
    // ========================================================================
    const ExifParser = require('exif-parser');
    let fechaRecorridoReal;
    let destinoCompleto = destino;
    let coordenadasGPS = null;

    console.log('\n📅 Determinando fecha real del recorrido...');

    // PRIORIDAD 1: Leer EXIF de la primera foto (más fiable)
    if (manifestData.multimedia && manifestData.multimedia.length > 0) {
      const primeraFoto = manifestData.multimedia.find(m => m.tipo === 'foto');

      if (primeraFoto) {
        const nombreCompletoMedia = `${primeraFoto.nombre}.jpg`;
        const fotoFile = req.files.find(f => path.basename(f.originalname) === nombreCompletoMedia);

        if (fotoFile && fotoFile.path) {
          try {
            console.log(`📷 Leyendo EXIF de: ${fotoFile.originalname}`);
            const buffer = fs.readFileSync(fotoFile.path);
            const parser = ExifParser.create(buffer);
            const exifData = parser.parse();

            // EXTRAER FECHA
            if (exifData.tags?.DateTimeOriginal) {
              const dt = exifData.tags.DateTimeOriginal;
              let fechaExif;

              if (typeof dt === 'number') {
                fechaExif = new Date(dt * 1000);
              } else if (typeof dt === 'string') {
                const dateStr = dt.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
                fechaExif = new Date(dateStr);
              }

              if (fechaExif && !isNaN(fechaExif)) {
                const y = fechaExif.getFullYear();
                const m = String(fechaExif.getMonth() + 1).padStart(2, '0');
                const d = String(fechaExif.getDate()).padStart(2, '0');
                fechaRecorridoReal = `${y}-${m}-${d}`;
                console.log(`✅ [EXIF] Fecha extraída de metadatos: ${fechaRecorridoReal}`);
                console.log(`   Foto: ${fotoFile.originalname}`);
              }
            }

            // EXTRAER COORDENADAS GPS
            if (exifData.tags?.GPSLatitude && exifData.tags?.GPSLongitude) {
              coordenadasGPS = {
                lat: exifData.tags.GPSLatitude,
                lng: exifData.tags.GPSLongitude
              };
              console.log(`✅ [GPS EXIF] Coordenadas extraídas: ${coordenadasGPS.lat}, ${coordenadasGPS.lng}`);
            }

          } catch (exifErr) {
            console.log(`⚠️ Error leyendo EXIF: ${exifErr.message}`);
          }
        }
      }

      // Si no hay coordenadas en EXIF, usar las del manifest
      if (!coordenadasGPS && primeraFoto && primeraFoto.gps) {
        coordenadasGPS = {
          lat: primeraFoto.gps.lat,
          lng: primeraFoto.gps.lng
        };
        console.log(`✅ [GPS MANIFEST] Coordenadas del manifest: ${coordenadasGPS.lat}, ${coordenadasGPS.lng}`);
      }

      // PRIORIDAD 2: Fecha del nombre del archivo multimedia (JPEG_YYYYMMDD_HHMMSS)
      if (!fechaRecorridoReal) {
        const primerMedia = manifestData.multimedia[0];
        if (primerMedia.archivo) {
          const matchFoto = primerMedia.archivo.match(/(\d{4})(\d{2})(\d{2})/);
          if (matchFoto) {
            const [_, y, m, d] = matchFoto;
            fechaRecorridoReal = `${y}-${m}-${d}`;
            console.log('✅ [MULTIMEDIA] Fecha extraída del primer archivo:', fechaRecorridoReal);
            console.log('   Archivo:', primerMedia.archivo);
          }
        }
      }
    }

    // PRIORIDAD 3: Fecha del nombre del manifest
    if (!fechaRecorridoReal) {
      const matchFormato = manifestData.nombre.match(/(\d{4})(\d{2})(\d{2})/);
      if (matchFormato) {
        const [_, y, m, d] = matchFormato;
        fechaRecorridoReal = `${y}-${m}-${d}`;
        console.log('✅ [NOMBRE MANIFEST] Fecha extraída:', fechaRecorridoReal);
        console.log('   Nombre:', manifestData.nombre);
      } else {
        // PRIORIDAD 4: Fecha de exportación (último recurso)
        fechaRecorridoReal = manifestData.fecha_exportacion.split('T')[0];
        console.log('⚠️ [FALLBACK] Usando fecha_exportacion:', fechaRecorridoReal);
      }
    }

    // ========================================================================
    // GEOCODIFICACIÓN INVERSA: Obtener dirección desde coordenadas GPS
    // ========================================================================
    if (coordenadasGPS) {
      try {
        console.log(`\n🌍 Obteniendo dirección desde coordenadas GPS...`);
        const https = require('https');

        const geocodingURL = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coordenadasGPS.lat}&lon=${coordenadasGPS.lng}&zoom=10&addressdetails=1`;

        const geocodingData = await new Promise((resolve, reject) => {
          https.get(geocodingURL, {
            headers: {
              'User-Agent': 'TravelApp/1.0'
            }
          }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(e);
              }
            });
          }).on('error', reject);
        });

        if (geocodingData && geocodingData.address) {
          const addr = geocodingData.address;

          const ciudad = addr.city || addr.town || addr.village || addr.municipality || 'Ubicación';
          const provincia = addr.state || addr.province || addr.region || '';
          const pais = addr.country || destino;

          if (provincia) {
            destinoCompleto = `${ciudad}, ${provincia}, ${pais}`;
          } else {
            destinoCompleto = `${ciudad}, ${pais}`;
          }

          console.log(`✅ [GEOCODING] Dirección obtenida: ${destinoCompleto}`);
          console.log(`   Ciudad: ${ciudad}`);
          console.log(`   Provincia/Estado: ${provincia || 'N/A'}`);
          console.log(`   País: ${pais}`);
        } else {
          console.log(`⚠️ [GEOCODING] No se pudo obtener dirección, usando destino del frontend: ${destino}`);
          destinoCompleto = destino;
        }

      } catch (geocodingErr) {
        console.log(`⚠️ Error en geocodificación: ${geocodingErr.message}`);
        console.log(`   Usando destino del frontend: ${destino}`);
        destinoCompleto = destino;
      }
    } else {
      console.log(`⚠️ No hay coordenadas GPS disponibles, usando destino del frontend: ${destino}`);
      destinoCompleto = destino;
    }

    console.log('📝 FECHA DEL RECORRIDO:', fechaRecorridoReal);
    console.log('📍 DESTINO COMPLETO FINAL:', destinoCompleto);

    const [año, mes, dia] = fechaRecorridoReal.split('-');
    const fechaFormateada = `${dia}/${mes}/${año}`;

    const nombreViaje = `${destinoCompleto} - ${fechaFormateada} - ${manifestData.estadisticas.distancia_km} km`;

    console.log('📝 Nombre del viaje:', nombreViaje);
    console.log('=====================================\n');

    // ========================================================================
    // 4. CREAR VIAJE
    // ========================================================================
    console.log('\n📁 Creando viaje...');

    viajeId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO viajes (nombre, destino, fecha_inicio, fecha_fin, descripcion) 
        VALUES (?, ?, ?, ?, ?)`,
        [
          nombreViaje,
          destinoCompleto,
          fechaRecorridoReal,
          fechaRecorridoReal,
          `Tracking importado desde AudioPhotoApp - ${manifestData.estadisticas.distancia_km} km - ${manifestData.estadisticas.duracion_formateada}`
        ],
        function (err) {
          if (err) return reject(err);
          console.log('✅ Viaje creado con ID:', this.lastID);
          console.log('   Nombre:', nombreViaje);
          resolve(this.lastID);
        }
      );
    });

    // ========================================================================
    // 5. CREAR ITINERARIO
    // ========================================================================
    console.log('\n📅 Creando itinerario...');

    const horaInicioItinerario = '00:00';
    const horaFinItinerario = '23:59';

    const horaInicioActividad = manifestData.estadisticas?.horaInicio || '00:00';
    const horaFinActividad = manifestData.estadisticas?.horaFin || '23:59';

    console.log(`✅ Horas extraídas del manifest (datos REALES):`);
    console.log(`  Actividad inicio: ${horaInicioActividad}`);
    console.log(`  Actividad fin: ${horaFinActividad}`);
    console.log(`⏰ Itinerario (siempre): ${horaInicioItinerario} - ${horaFinItinerario}`);

    const TIPO_VIAJE_MAP = {
      'walking': 'naturaleza',
      'running': 'naturaleza',
      'bicycle': 'naturaleza',
      'car': 'urbana'
    };

    const tipoViaje = TIPO_VIAJE_MAP[manifestData.perfil_transporte?.id] || 'naturaleza';

    itinerarioId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO ItinerarioGeneral 
        (viajePrevistoId, fechaInicio, fechaFin, duracionDias, destinosPorDia, 
          descripcionGeneral, horaInicio, horaFin, tipoDeViaje) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          viajeId,
          fechaRecorridoReal,
          fechaRecorridoReal,
          1,
          destinoCompleto,
          `Recorrido de ${manifestData.estadisticas.distancia_km} km en ${manifestData.estadisticas.duracion_formateada}`,
          horaInicioItinerario,
          horaFinItinerario,
          tipoViaje
        ],
        function (err) {
          if (err) return reject(err);
          console.log('✅ Itinerario creado con ID:', this.lastID);
          resolve(this.lastID);
        }
      );
    });

    // ========================================================================
    // 6. CREAR ACTIVIDAD
    // ========================================================================
    console.log('\n🏃 Creando actividad...');

    const descripcionActividad = `Distancia: ${manifestData.estadisticas.distancia_km} km
Duración: ${manifestData.estadisticas.duracion_formateada}
Velocidad media: ${manifestData.estadisticas.velocidad_media_kmh} km/h
Calorías: ${manifestData.estadisticas.calorias} kcal
Pasos: ${manifestData.estadisticas.pasos_estimados}`;

    let rutaGpxCompleto = null;
    let rutaMapaCompleto = null;
    let rutaManifest = null;
    let rutaEstadisticas = null;

    let fechaCreacionActividad;
    let fechaActualizacionActividad = new Date().toISOString();

    console.log('\n📅 Determinando fecha de creación de la actividad...');

    if (manifestData.multimedia && manifestData.multimedia.length > 0) {
      const primerMedia = manifestData.multimedia[0];

      if (primerMedia.archivo) {
        const matchFoto = primerMedia.archivo.match(/(\d{4})(\d{2})(\d{2})_?(\d{2})(\d{2})(\d{2})/);
        if (matchFoto) {
          const [_, y, m, d, h, min, s] = matchFoto;
          fechaCreacionActividad = new Date(Date.UTC(
            parseInt(y), parseInt(m) - 1, parseInt(d),
            parseInt(h), parseInt(min), parseInt(s)
          )).toISOString();
          console.log('✅ [PRIORIDAD 1] Usando fecha del PRIMER ARCHIVO MULTIMEDIA:', fechaCreacionActividad);
          console.log('   Archivo:', primerMedia.archivo);
        } else {
          throw new Error('No se pudo extraer fecha del archivo multimedia: ' + primerMedia.archivo);
        }
      } else if (primerMedia.timestamp) {
        fechaCreacionActividad = primerMedia.timestamp;
        console.log('✅ [PRIORIDAD 1B] Usando timestamp del primer media:', fechaCreacionActividad);
      }
    } else {
      console.log('⚠️ No hay multimedia, extrayendo del nombre del manifest...');

      const matchFormato1 = manifestData.nombre.match(/(\d{2})_(\d{2})_(\d+)/);
      const matchFormato2 = manifestData.nombre.match(/(\d{4})(\d{2})(\d{2})_?(\d{2})(\d{2})(\d{2})/);

      if (matchFormato2) {
        const [_, y, m, d, h, min, s] = matchFormato2;
        fechaCreacionActividad = new Date(Date.UTC(
          parseInt(y), parseInt(m) - 1, parseInt(d),
          parseInt(h), parseInt(min), parseInt(s)
        )).toISOString();
        console.log('✅ [PRIORIDAD 2A] Nombre YYYYMMDD_HHMMSS:', fechaCreacionActividad);
      } else if (matchFormato1) {
        const [_, d, m, timestamp] = matchFormato1;
        const año = new Date().getFullYear();
        fechaCreacionActividad = new Date(Date.UTC(
          año, parseInt(m) - 1, parseInt(d), 12, 0, 0
        )).toISOString();
        console.log('✅ [PRIORIDAD 2B] Nombre DD_MM_timestamp:', fechaCreacionActividad);
      } else {
        fechaCreacionActividad = manifestData.fecha_exportacion
          ? new Date(manifestData.fecha_exportacion).toISOString()
          : new Date().toISOString();
        console.log('⚠️ [PRIORIDAD 3] Usando fecha_exportacion:', fechaCreacionActividad);
      }
    }

    console.log('📝 FECHA FINAL ACTIVIDAD:', fechaCreacionActividad);
    console.log('=====================================\n');

    actividadId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO actividades 
        (viajePrevistoId, itinerarioId, tipoActividadId, nombre, descripcion, horaInicio, horaFin,
         distanciaKm, distanciaMetros, duracionSegundos, duracionFormateada, 
         velocidadMediaKmh, velocidadMaximaKmh, velocidadMinimaKmh, 
         calorias, pasosEstimados, puntosGPS, perfilTransporte,
         rutaGpxCompleto, rutaMapaCompleto, rutaManifest, rutaEstadisticas,
         fechaCreacion, fechaActualizacion) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          viajeId,
          itinerarioId,
          tipoActividadId,
          `${manifestData.nombre} - ${manifestData.perfil_transporte?.nombre || 'Actividad'}`,
          descripcionActividad,
          horaInicioActividad,
          horaFinActividad,
          parseFloat(manifestData.estadisticas.distancia_km) || 0,
          parseInt(manifestData.estadisticas.distancia_metros) || 0,
          parseInt(manifestData.estadisticas.duracion_segundos) || 0,
          manifestData.estadisticas.duracion_formateada || '00:00:00',
          parseFloat(manifestData.estadisticas.velocidad_media_kmh) || 0,
          parseFloat(manifestData.estadisticas.velocidad_maxima_kmh) || 0,
          parseFloat(manifestData.estadisticas.velocidad_minima_kmh) || 0,
          parseInt(manifestData.estadisticas.calorias) || 0,
          parseInt(manifestData.estadisticas.pasos_estimados) || 0,
          parseInt(manifestData.estadisticas.puntos_gps) || 0,
          manifestData.perfil_transporte?.id || 'unknown',
          rutaGpxCompleto,
          rutaMapaCompleto,
          rutaManifest,
          rutaEstadisticas,
          fechaCreacionActividad,
          fechaActualizacionActividad
        ],
        function (err) {
          if (err) return reject(err);
          console.log('✅ Actividad creada con ID:', this.lastID);
          console.log(`📊 Estadísticas guardadas:
    ✓ Distancia: ${manifestData.estadisticas.distancia_km} km
    ✓ Velocidad media: ${manifestData.estadisticas.velocidad_media_kmh} km/h
    ✓ Calorías: ${manifestData.estadisticas.calorias} kcal
    ✓ Pasos: ${manifestData.estadisticas.pasos_estimados}`);
          resolve(this.lastID);
        }
      );
    });

    // ========================================================================
    // 7. CREAR ESTRUCTURA DE CARPETAS
    // ========================================================================
    console.log('\n📂 Creando estructura de carpetas...');

    const actividadPath = path.join(uploadsPath, `${viajeId}`, `${actividadId}`);
    const folders = ['fotos', 'videos', 'audios', 'gpx', 'mapas', 'metadata'];

    for (const folder of folders) {
      const folderPath = path.join(actividadPath, folder);
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }
    }
    console.log('✅ Estructura de carpetas creada');

    // ========================================================================
    // 8. PROCESAR MULTIMEDIA
    // ========================================================================
    console.log('\n📸 Procesando multimedia...');

    // 🔧 DEBUG: Ver todos los archivos que llegaron
    console.log('\n🔍 ARCHIVOS RECIBIDOS EN req.files:');
    req.files.forEach((f, idx) => {
      console.log(`  [${idx}] ${f.originalname}`);
    });
    console.log('');

    const usedFileIndices = new Set(); // ✨ Nuevo: Para evitar procesar el mismo archivo dos veces

    for (const media of manifestData.multimedia) {
      let fechaCreacionMedia = media.timestamp;

      console.log(`\n📸 Procesando media: ${media.nombre}`);

      const tipoFolder = media.tipo === 'foto' ? 'fotos' : 'videos';
      const extensionMedia = media.tipo === 'foto' ? 'jpg' : 'mp4';
      let nombreCompletoMedia = media.nombre;
      if (!nombreCompletoMedia.toLowerCase().endsWith('.' + extensionMedia)) {
        nombreCompletoMedia += '.' + extensionMedia;
      }

      // Usar findIndex para poder guardar el índice del archivo usado
      const mediaFileIndex = req.files.findIndex((f, index) => {
        if (usedFileIndices.has(index)) return false; // Saltarse archivos ya usados

        const baseName = path.basename(f.originalname);
        return baseName === nombreCompletoMedia;
      });

      if (mediaFileIndex === -1) {
        console.warn(`⚠️ Archivo no encontrado: ${media.nombre}`);
        continue;
      }

      const mediaFile = req.files[mediaFileIndex];
      usedFileIndices.add(mediaFileIndex); // Marcar como usado

      // PRIORIDAD 1: Intentar extraer fecha de EXIF de la foto
      if (media.tipo === 'foto' && mediaFile.path) {
        try {
          console.log(`📷 Leyendo EXIF de: ${mediaFile.originalname}`);
          const buffer = fs.readFileSync(mediaFile.path);
          const parser = ExifParser.create(buffer);
          const exifData = parser.parse();

          if (exifData.tags?.DateTimeOriginal) {
            const dt = exifData.tags.DateTimeOriginal;
            if (typeof dt === 'number') {
              fechaCreacionMedia = new Date(dt * 1000).toISOString();
            } else if (typeof dt === 'string') {
              const dateStr = dt.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
              fechaCreacionMedia = new Date(dateStr).toISOString();
            }
            console.log(`✅ [PRIORIDAD 1] Fecha de EXIF: ${fechaCreacionMedia}`);
          } else {
            throw new Error('No hay DateTimeOriginal en EXIF');
          }
        } catch (exifErr) {
          console.log(`⚠️ No se pudo leer EXIF: ${exifErr.message}`);
          console.log(`   Intentando extraer del nombre del archivo...`);

          if (media.archivo) {
            const matchFoto = media.archivo.match(/(\d{4})(\d{2})(\d{2})_?(\d{2})(\d{2})(\d{2})/);
            if (matchFoto) {
              const [_, y, m, d, h, min, s] = matchFoto;
              fechaCreacionMedia = new Date(Date.UTC(
                parseInt(y), parseInt(m) - 1, parseInt(d),
                parseInt(h), parseInt(min), parseInt(s)
              )).toISOString();
              console.log(`✅ [PRIORIDAD 2] Fecha del nombre (YYYYMMDD_HHMMSS):`);
              console.log(`   ${y}${m}${d}_${h}${min}${s} → ${fechaCreacionMedia}`);
            } else {
              console.log(`⚠️ No se pudo extraer fecha del nombre: ${media.archivo}`);
              console.log(`✅ [PRIORIDAD 3] Usando timestamp por defecto: ${fechaCreacionMedia}`);
            }
          }
        }
      } else if (media.archivo) {
        const matchFoto = media.archivo.match(/(\d{4})(\d{2})(\d{2})_?(\d{2})(\d{2})(\d{2})/);
        if (matchFoto) {
          const [_, y, m, d, h, min, s] = matchFoto;
          fechaCreacionMedia = new Date(Date.UTC(
            parseInt(y), parseInt(m) - 1, parseInt(d),
            parseInt(h), parseInt(min), parseInt(s)
          )).toISOString();
          console.log(`✅ [PRIORIDAD 2] Fecha del nombre del archivo: ${fechaCreacionMedia}`);
        }
      }

      const nombreBaseMedia = path.basename(mediaFile.originalname);
      const destPath = path.join(actividadPath, tipoFolder, nombreBaseMedia);
      fs.renameSync(mediaFile.path, destPath);

      const rutaRelativa = path.relative(uploadsPath, destPath).replace(/\\/g, '/');

      const metadatosMedia = {
        timestamp: fechaCreacionMedia,
        altitude: media.gps?.altitude || null,
        latitude: media.gps?.lat || null,
        longitude: media.gps?.lng || null,
        timestampDisplay: media.timestamp_display
      };

      const archivoId = await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO archivos 
          (actividadId, tipo, nombreArchivo, rutaArchivo, horaCaptura, geolocalizacion, metadatos, fechaCreacion) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            actividadId,
            media.tipo,
            mediaFile.originalname,
            rutaRelativa,
            (fechaCreacionMedia ? fechaCreacionMedia.split('T')[1].substring(0, 8) : media.timestamp_display),
            JSON.stringify({
              latitud: media.gps.lat,
              longitud: media.gps.lng,
              altitud: media.gps.altitude || 0
            }),
            JSON.stringify(metadatosMedia),
            fechaCreacionMedia
          ],
          function (err) {
            if (err) return reject(err);
            resolve(this.lastID);
          }
        );
      });

      archivosCreados.push({ id: archivoId, nombre: mediaFile.originalname });
      console.log(`✅ ${media.tipo} procesado: ${media.nombre}`);
      console.log(`   Fecha guardada: ${fechaCreacionMedia}`);

      // AUDIO ASOCIADO (MODIFIED)
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
          return (fName === `${nameWithoutExt}.wav` || fName === `${nameWithoutExt}.mp3` ||
            fName === `${baseName}.wav` || fName === `${baseName}.mp3`);
        });

        if (audioFile) {
          audioFileName = audioFile.originalname;
          console.log(`   ✓ Audio asociado encontrado por coincidencia de nombre: ${audioFileName}`);
        }
      }

      if (audioFile && audioFileName) {
        const audioDestPath = path.join(actividadPath, 'audios', audioFileName);
        fs.renameSync(audioFile.path, audioDestPath);
        const audioRutaRelativa = path.relative(uploadsPath, audioDestPath).replace(/\\/g, '/');

        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO archivos_asociados 
            (archivoPrincipalId, tipo, nombreArchivo, rutaArchivo, fechaCreacion) 
            VALUES (?, ?, ?, ?, ?)`,
            [archivoId, 'audio', audioFileName, audioRutaRelativa, new Date().toISOString()],
            function (err) {
              if (err) return reject(err);
              resolve();
            }
          );
        });
        console.log(`  🎤 Audio asociado: ${audioFileName}`);
      }
      // GPX INDIVIDUAL - MEJORADO CON DEBUG Y FALLBACK
      console.log(`\n📍 Buscando GPX individual para media: ${media.nombre}`);
      console.log(`   Buscando archivo: ${media.nombre}.gpx`);

      // PRIORIDAD 1: Buscar por nombre exacto
      let gpxFileName = `${media.nombre}.gpx`;
      let gpxFile = req.files.find(f => {
        const baseName = path.basename(f.originalname);
        const match = baseName === gpxFileName;
        if (match) {
          console.log(`   ✓ [EXACTO] Encontrado: "${baseName}"`);
        }
        return match;
      });

      // PRIORIDAD 2: Si no encuentra exacto, buscar por patrón
      if (!gpxFile) {
        console.log(`   ⚠️ No encontrado con nombre exacto, buscando por patrón...`);

        // Extraer prefijo (ej: "JPEG_20241226_150505" -> "JPEG_20241226_150505")
        const baseName = media.nombre.includes('.')
          ? media.nombre.split('.')[0]
          : media.nombre;

        console.log(`   Patrón de búsqueda: archivos .gpx que empiecen con "${baseName}"`);

        gpxFile = req.files.find(f => {
          const fBaseName = path.basename(f.originalname, '.gpx');
          const esMatch = f.originalname.endsWith('.gpx') && fBaseName.startsWith(baseName);
          if (esMatch) {
            console.log(`   ✓ [PATRÓN] Encontrado: ${f.originalname}`);
          }
          return esMatch;
        });
      }

      if (gpxFile) {
        gpxFileName = path.basename(gpxFile.originalname);
        console.log(`  ✅ GPX encontrado: ${gpxFileName}`);

        const gpxDestPath = path.join(actividadPath, 'gpx', gpxFileName);
        fs.renameSync(gpxFile.path, gpxDestPath);
        const gpxRutaRelativa = path.relative(uploadsPath, gpxDestPath).replace(/\\/g, '/');

        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO archivos_asociados 
      (archivoPrincipalId, tipo, nombreArchivo, rutaArchivo, fechaCreacion) 
      VALUES (?, ?, ?, ?, ?)`,
            [archivoId, 'gpx', gpxFileName, gpxRutaRelativa, new Date().toISOString()],
            function (err) {
              if (err) return reject(err);
              resolve();
            }
          );
        });
        console.log(`  ✅ GPX individual asociado correctamente`);
      } else {
        console.warn(`  ❌ NO SE ENCONTRÓ GPX para media: ${media.nombre}`);
        console.warn(`     GPX disponibles en req.files:`);
        req.files.filter(f => f.originalname.endsWith('.gpx')).forEach((f, idx) => {
          console.warn(`       [${idx + 1}] ${f.originalname}`);
        });
      }

      // MAPA PNG INDIVIDUAL - MEJORADO CON DEBUG
      console.log(`\n🗺️ Buscando PNG individual para: ${media.nombre}`);

      // PRIORIDAD 1: Nombre exacto esperado
      let mapaFile = req.files.find(f => {
        const baseName = path.basename(f.originalname);
        const expectedName = `${media.nombre}.png`;
        const match = baseName === expectedName;
        if (match) {
          console.log(`   ✓ Coincidencia encontrada: "${baseName}"`);
        }
        return match;
      });

      // PRIORIDAD 2: Si no encuentra con nombre exacto, buscar por extensión .png
      if (!mapaFile) {
        console.log(`   ⚠️ No encontrado con nombre exacto, buscando PNG por patrón...`);
        mapaFile = req.files.find(f => {
          const baseName = path.basename(f.originalname);
          const prefijo = media.nombre.split('_').slice(0, 3).join('_');
          const esMatch = baseName.endsWith('.png') && baseName.startsWith(prefijo);
          if (esMatch) {
            console.log(`   ✓ Encontrado PNG con patrón: ${baseName}`);
          }
          return esMatch;
        });
      }

      if (mapaFile) {
        console.log(`  ✅ PNG encontrado: ${mapaFile.originalname}`);
        const mapaDestPath = path.join(actividadPath, 'mapas', path.basename(mapaFile.originalname));
        fs.renameSync(mapaFile.path, mapaDestPath);
        const mapaRutaRelativa = path.relative(uploadsPath, mapaDestPath).replace(/\\/g, '/');

        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO archivos_asociados 
            (archivoPrincipalId, tipo, nombreArchivo, rutaArchivo, fechaCreacion) 
            VALUES (?, ?, ?, ?, ?)`,
            [archivoId, 'mapa_ubicacion', path.basename(mapaFile.originalname), mapaRutaRelativa, new Date().toISOString()],
            function (err) {
              if (err) return reject(err);
              resolve();
            }
          );
        });
        console.log(`  🗺️ Mapa PNG individual asociado: ${mapaFile.originalname}`);
      } else {
        console.warn(`  ❌ NO SE ENCONTRÓ PNG para: ${media.nombre}`);
        console.warn(`     PNG disponibles en req.files:`);
        req.files.filter(f => f.originalname.endsWith('.png')).forEach(f => {
          console.warn(`       - ${f.originalname}`);
        });
      }
    }

    // ========================================================================
    // 9. PROCESAR ARCHIVOS GENERALES (SOLO EN actividades, NO en archivos_asociados)
    // ========================================================================
    console.log('\n📋 Procesando archivos generales...');

    // GPX COMPLETO - SOLO en actividades
    const gpxFile = req.files.find(f => path.basename(f.originalname) === 'recorrido.gpx');
    if (gpxFile) {
      const gpxDest = path.join(actividadPath, 'gpx', 'recorrido.gpx');
      fs.renameSync(gpxFile.path, gpxDest);
      rutaGpxCompleto = path.relative(uploadsPath, gpxDest).replace(/\\/g, '/');
      console.log('✅ GPX del recorrido procesado (guardado en actividades)');
    }

    // PNG COMPLETO - SOLO en actividades
    const pngFile = req.files.find(f => path.basename(f.originalname) === 'mapa.png');
    if (pngFile) {
      const pngDest = path.join(actividadPath, 'mapas', 'mapa.png');
      fs.renameSync(pngFile.path, pngDest);
      rutaMapaCompleto = path.relative(uploadsPath, pngDest).replace(/\\/g, '/');
      console.log('✅ Mapa PNG general procesado (guardado en actividades)');
    }

    // MANIFEST - SOLO en actividades
    const manifestDest = path.join(actividadPath, 'metadata', 'manifest.json');
    fs.renameSync(manifestFile.path, manifestDest);
    rutaManifest = path.relative(uploadsPath, manifestDest).replace(/\\/g, '/');
    console.log('✅ Manifest procesado (guardado en actividades)');

    // ESTADÍSTICAS - SOLO en actividades
    const statsFile = req.files.find(f => f.originalname === 'estadisticas.json');
    if (statsFile) {
      const statsDest = path.join(actividadPath, 'metadata', 'estadisticas.json');
      fs.renameSync(statsFile.path, statsDest);
      rutaEstadisticas = path.relative(uploadsPath, statsDest).replace(/\\/g, '/');
      console.log('✅ Estadísticas procesadas (guardado en actividades)');
    }

    // ACTUALIZAR REFERENCIAS EN ACTIVIDADES
    console.log('\n📝 Actualizando referencias de archivos generales en actividades...');
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE actividades 
         SET rutaGpxCompleto = ?, rutaMapaCompleto = ?, rutaManifest = ?, rutaEstadisticas = ?, fechaActualizacion = ?
         WHERE id = ?`,
        [rutaGpxCompleto, rutaMapaCompleto, rutaManifest, rutaEstadisticas, new Date().toISOString(), actividadId],
        (err) => {
          if (err) {
            console.warn('⚠️ Error actualizando rutas:', err.message);
            return reject(err);
          }
          console.log('✅ Rutas de archivos generales actualizadas EN ACTIVIDADES');
          console.log(`   📁 GPX completo: ${rutaGpxCompleto || 'N/A'}`);
          console.log(`   🗺️ Mapa completo: ${rutaMapaCompleto || 'N/A'}`);
          console.log(`   📋 Manifest: ${rutaManifest || 'N/A'}`);
          console.log(`   📊 Estadísticas: ${rutaEstadisticas || 'N/A'}`);
          resolve();
        }
      );
    });

    // ========================================================================
    // 10. LIMPIAR CARPETA TEMPORAL
    // ========================================================================
    const tempPath = path.join(uploadsPath, 'temp-imports');
    if (fs.existsSync(tempPath)) {
      fs.readdirSync(tempPath).forEach(file => {
        try {
          fs.unlinkSync(path.join(tempPath, file));
        } catch (err) {
          console.warn('⚠️ No se pudo eliminar archivo temporal:', file);
        }
      });
    }

    console.log('\n🏁 =============== IMPORTACIÓN COMPLETADA ===============');
    console.log(`✅ Viaje ID: ${viajeId}`);
    console.log(`✅ Itinerario ID: ${itinerarioId}`);
    console.log(`✅ Actividad ID: ${actividadId}`);
    console.log(`✅ Archivos importados: ${archivosCreados.length}`);

    res.status(201).json({
      success: true,
      viajeId,
      itinerarioId,
      actividadId,
      mensaje: 'Importación exitosa',
      resumen: {
        fotos: manifestData.estadisticas.num_fotos,
        videos: manifestData.estadisticas.num_videos,
        audios: manifestData.estadisticas.num_audios,
        archivosCreados: archivosCreados.length
      }
    });

  } catch (error) {
    console.error('\n❌ =============== ERROR EN IMPORTACIÓN ===============');
    console.error('Error:', error.message);

    // ========================================================================
    // ROLLBACK: Revertir todos los cambios en caso de error
    // ========================================================================
    if (actividadId) {
      await new Promise(resolve => db.run('DELETE FROM actividades WHERE id = ?', [actividadId], () => resolve()));
      console.log('🔄 Actividad eliminada (rollback)');
    }
    if (itinerarioId) {
      await new Promise(resolve => db.run('DELETE FROM ItinerarioGeneral WHERE id = ?', [itinerarioId], () => resolve()));
      console.log('🔄 Itinerario eliminado (rollback)');
    }
    if (viajeId) {
      await new Promise(resolve => db.run('DELETE FROM viajes WHERE id = ?', [viajeId], () => resolve()));
      console.log('🔄 Viaje eliminado (rollback)');
    }

    // Eliminar archivos físicos
    if (viajeId && actividadId) {
      const actividadPath = path.join(uploadsPath, `${viajeId}`, `${actividadId}`);
      if (fs.existsSync(actividadPath)) {
        try {
          fs.rmSync(actividadPath, { recursive: true, force: true });
          console.log('🔄 Archivos físicos eliminados (rollback)');
        } catch (err) {
          console.warn('⚠️ Error eliminando archivos:', err.message);
        }
      }
    }

    // Limpiar archivos temporales
    if (req.files) {
      req.files.forEach(file => {
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        } catch (err) {
          console.warn('⚠️ No se pudo eliminar temporal:', file.originalname);
        }
      });
    }

    res.status(500).json({
      success: false,
      error: error.message,
      detalles: 'La importación falló y se revirtieron los cambios'
    });
  }
});

console.log('✅ Endpoint de importación registrado correctamente');



// ----------------------------------------

// Configuración del servidor Express

// 🧱 Ruta a archivos Angular compilados
const isProduction = process.env.NODE_ENV === 'production';
const frontendPath = isProduction
  ? path.join(__dirname, '../../dist/travel-memory-app/browser')
  : null;

if (isProduction) {
  if (!fs.existsSync(frontendPath)) {
    console.error('❌ frontendPath NO existe:', frontendPath);
    process.exit(1);
  } else {
    console.log('✅ frontendPath existe:', frontendPath);
  }
  app.use(express.static(frontendPath));

  const indexPath = path.join(frontendPath, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.error('❌ index.html NO existe en:', indexPath);
    process.exit(1);
  } else {
    console.log('✅ index.html existe en:', indexPath);
  }
  // 🌀 Para cualquier ruta no API, sirve index.html SOLO en producción
  app.get('*', (req, res) => {
    res.sendFile(indexPath);
  });
}

// Configurar el puerto y poner a escuchar el servidor
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3001;

// Servidor HTTP (para compatibilidad)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor backend HTTP escuchando en http://0.0.0.0:${PORT}`);
});

// Servidor HTTPS
const https = require('https');

// Usar certificado .pfx generado con PowerShell
let httpsServer;
try {
  const sslOptions = {
    pfx: fs.readFileSync(path.join(__dirname, '../../ssl/server.pfx')),
    passphrase: 'password'
  };

  httpsServer = https.createServer(sslOptions, app);
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`Servidor backend HTTPS escuchando en https://0.0.0.0:${HTTPS_PORT}`);
  });
} catch (error) {
  console.log('⚠️  Certificados SSL no encontrados, solo HTTP disponible');
}