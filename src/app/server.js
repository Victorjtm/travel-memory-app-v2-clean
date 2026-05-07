// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CARGAR VARIABLES DE ENTORNO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
require('dotenv').config();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IMPORTAR DEPENDENCIAS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
const axios = require('axios');
const { exec } = require('child_process'); // ⬅️ NUEVO: Para ejecutar ffmpeg y stt local

// Lock para procesos de transcripción activos (evitar duplicados)
const procesosTranscripcionActivos = new Set();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MÓDULO 6: CLIENTE PERPLEXITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const PerplexityClient = require('./backend-services/perplexity-client');

// Inicializar cliente con API Key del .env
const perplexityClient = new PerplexityClient();

console.log('🤖 Cliente Perplexity inicializado');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

console.log('🤖 Cliente Perplexity inicializado');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MÓDULO 6: SEGURIDAD - RATE LIMITING Y LÍMITES DE TOKENS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const rateLimit = require('express-rate-limit');

// 1. RATE LIMITING: Limitar peticiones a endpoints de IA (10 cada 15 min)
const iaRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    error: 'Demasiadas peticiones a la IA',
    detalles: 'Por favor, espera 15 minutos antes de volver a intentar',
    reintentar_en: '15 minutos'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Arreglado para IPv6
  handler: (req, res) => {
    console.log(`⚠️ [RATE LIMIT] IP bloqueada temporalmente: ${req.ip}`);
    res.status(429).json({
      error: 'Demasiadas peticiones a la IA',
      mensaje: 'Has alcanzado el límite de 10 peticiones cada 15 minutos',
      reintentar_en_segundos: 900,
      ip: req.ip
    });
  }
});


console.log('🛡️ Rate limiting configurado: 10 peticiones cada 15 minutos');


// 2. LÍMITE DE TOKENS POR SESIÓN (10,000 tokens máximo)
const MAX_TOKENS_POR_SESION = 10000;

/**
 * Middleware para verificar el consumo de tokens de una sesión
 */
async function verificarLimiteTokens(req, res, next) {
  const { sessionId } = req.body;

  if (!sessionId) {
    return next();
  }

  try {
    const resultado = await dbQuery.get(
      'SELECT SUM(tokens_usados) as total FROM conversaciones_ia WHERE sessionId = ?',
      [sessionId]
    );

    const tokensConsumidos = resultado?.total || 0;

    if (tokensConsumidos >= MAX_TOKENS_POR_SESION) {
      console.log(`⚠️ [TOKENS] Sesión ${sessionId.substring(0, 8)} excedió límite: ${tokensConsumidos}/${MAX_TOKENS_POR_SESION}`);

      return res.status(429).json({
        error: 'Límite de tokens excedido',
        mensaje: `Esta sesión ha consumido ${tokensConsumidos} tokens de un máximo de ${MAX_TOKENS_POR_SESION}`,
        tokens_consumidos: tokensConsumidos,
        tokens_maximos: MAX_TOKENS_POR_SESION,
        accion: 'Inicia una nueva sesión para continuar conversando'
      });
    }

    req.tokensConsumidos = tokensConsumidos;
    req.tokensRestantes = MAX_TOKENS_POR_SESION - tokensConsumidos;

    console.log(`📊 [TOKENS] Sesión ${sessionId.substring(0, 8)}: ${tokensConsumidos}/${MAX_TOKENS_POR_SESION} (${req.tokensRestantes} restantes)`);

    next();
  } catch (error) {
    console.error('❌ Error verificando límite de tokens:', error.message);
    next();
  }
}

console.log(`🎯 Límite de tokens por sesión: ${MAX_TOKENS_POR_SESION}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Crear una instancia de la aplicación Express
const app = express();


// (Preflight options handling delegada completamente al middleware global cors())

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

// ✅ NUEVO: Interceptor global para asegurar que TODAS las respuestas incluyan cabeceras CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Solo añadir cabeceras si hay un origen
  if (origin) {
    // Verificar si el origen está permitido
    const isLocalNetwork = /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+):\d+$/.test(origin);
    const isAllowedOrigin = allowedOrigins.includes(origin);
    const isNgrok = /^https:\/\/.*\.ngrok(-free)?\.app$/.test(origin) || /^https:\/\/.*\.ngrok\.io$/.test(origin);

    if (isLocalNetwork || isAllowedOrigin || isNgrok || !origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, ngrok-skip-browser-warning');
      res.setHeader('Access-Control-Allow-Credentials', 'true');

      console.log(`✅ [GLOBAL CORS] Cabeceras añadidas para: ${origin}`);
    }
  }

  next();
});

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
// ✅ Solo usar bodyParser para JSON y URL-encoded, NO para multipart
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';

  // Si es multipart/form-data, dejar que multer lo maneje
  if (contentType.includes('multipart/form-data')) {
    return next();
  }

  // Para todo lo demás, usar bodyParser
  bodyParser.json({ limit: '50mb' })(req, res, () => {
    bodyParser.urlencoded({ limit: '50mb', extended: true })(req, res, next);
  });
});

// ✅ Servir archivos estáticos desde "uploads"
const uploadsPath = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
  console.log('✅ Carpeta uploads creada:', uploadsPath);
}

console.log('📁 Sirviendo archivos estáticos desde:', uploadsPath);
app.use('/uploads', cors(), express.static(uploadsPath));

// Configurar la base de datos SQLite
const db = new sqlite3.Database('./viajes.db', (err) => {
  if (err) {
    console.error('❌ Error al conectar con la base de datos SQLite:', err.message);
  } else {
    console.log('✅ Conectado a la base de datos SQLite');
    // Activar soporte para claves foráneas (activación por conexión)
    db.run('PRAGMA foreign_keys = ON', (pragmaErr) => {
      if (pragmaErr) console.error('❌ Error habilitando foreign keys:', pragmaErr.message);
      else console.log('🛡️ Soporte para claves foráneas ACTIVADO (Cascading habilitado)');
    });
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
const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // ✅ 500 MB por archivo
    files: 100, // ✅ Máximo 100 archivos
    fieldSize: 500 * 1024 * 1024, // ✅ 500 MB para campos
    parts: 200 // ✅ Partes totales (archivos + campos)
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TABLA CONVERSACIONES_IA (NUEVA)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
db.run(`
    CREATE TABLE IF NOT EXISTS conversaciones_ia (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessionId TEXT NOT NULL,
      rol TEXT NOT NULL CHECK(rol IN ('user', 'assistant', 'system')),
      mensaje TEXT NOT NULL,
      tokens_usados INTEGER DEFAULT 0,
      modelo TEXT,
      tiempo_respuesta INTEGER,
      datos_estructurados TEXT,
      tipo_interaccion TEXT DEFAULT 'planificacion',
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
console.log('✅ Tabla conversaciones_ia creada o ya existe.');

// Crear índice para búsquedas rápidas por sesión
db.run(`
    CREATE INDEX IF NOT EXISTS idx_conversaciones_sessionId 
    ON conversaciones_ia(sessionId)
  `);
console.log('✅ Índice de conversaciones_ia creado.');


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
    migrarColumnasUbicacionViajes();
  }
});

function migrarColumnasUbicacionViajes() {
  db.all(`PRAGMA table_info(viajes)`, [], async (err, rows) => {
    if (err) {
      console.error('❌ Error consultando columnas de viajes:', err.message);
      return;
    }

    const columnasActuales = new Set((rows || []).map(col => col.name));
    const columnasObjetivo = [
      { name: 'lat_representativa', sqlType: 'REAL' },
      { name: 'lng_representativa', sqlType: 'REAL' },
      { name: 'metodo_calculo', sqlType: 'TEXT' }
    ];

    for (const columna of columnasObjetivo) {
      if (columnasActuales.has(columna.name)) continue;

      try {
        await dbQuery.run(`ALTER TABLE viajes ADD COLUMN ${columna.name} ${columna.sqlType}`, []);
        console.log(`✅ Columna migrada en viajes: ${columna.name}`);
      } catch (migrationError) {
        console.error(`❌ Error migrando columna ${columna.name}:`, migrationError.message);
      }
    }
  });
}

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
    rutaVisualSession TEXT,
    
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
    actividadId INTEGER,                               -- ⬅️ Quitamos NOT NULL para permitir "sin asignar"
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
    urlPoster TEXT,
    FOREIGN KEY (actividadId) REFERENCES actividades(id) ON DELETE CASCADE
  )`,
  (err) => {
    if (err) {
      console.error("❌ Error al crear la tabla archivos:", err.message);
    } else {
      console.log("✅ Tabla archivos verificada/creada.");

      // ✅ MIGRACIÓN: Eliminar NOT NULL de actividadId si existe
      db.all("PRAGMA table_info(archivos)", (err, columns) => {
        if (err) return;
        const col = columns.find(c => c.name === 'actividadId');
        if (col && col.notnull === 1) {
          console.log("🔄 Migrando tabla archivos para permitir actividadId NULL...");
          // SQLite no permite quitar NOT NULL con ALTER TABLE simplemente. 
          // Hay que recrear la tabla o confiar en que no de problemas si solo insertamos NULLs.
          // En SQLite, NOT NULL se puede relajar a veces, pero lo más seguro es recrear si es crítico.
          // Intentaremos un truco: si insertamos NULL y falla, informaremos. 
          // Pero la definición CREATE TABLE arriba ya lo arreglará para nuevas BDs.
          // Para existentes, haremos la migración formal:
          const migrationSql = [
            'PRAGMA foreign_keys=OFF;',
            'BEGIN TRANSACTION;',
            'CREATE TABLE archivos_new AS SELECT * FROM archivos;',
            'DROP TABLE archivos;',
            `CREATE TABLE archivos (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              actividadId INTEGER,
              tipo TEXT CHECK(tipo IN ('foto', 'video', 'audio', 'texto', 'imagen')) NOT NULL,
              nombreArchivo TEXT NOT NULL,
              rutaArchivo TEXT NOT NULL,
              descripcion TEXT,
              fechaCreacion TEXT DEFAULT (datetime('now')),
              fechaActualizacion TEXT DEFAULT (datetime('now')),
              horaCaptura TEXT,
              version INTEGER DEFAULT 1,
              geolocalizacion TEXT,
              metadatos TEXT,
              urlPoster TEXT,
              FOREIGN KEY (actividadId) REFERENCES actividades(id) ON DELETE CASCADE
            );`,
            'INSERT INTO archivos (id, actividadId, tipo, nombreArchivo, rutaArchivo, descripcion, fechaCreacion, fechaActualizacion, horaCaptura, version, geolocalizacion, metadatos) SELECT id, actividadId, tipo, nombreArchivo, rutaArchivo, descripcion, fechaCreacion, fechaActualizacion, horaCaptura, version, geolocalizacion, metadatos FROM archivos_new;',
            'DROP TABLE archivos_new;',
            'COMMIT;',
            'PRAGMA foreign_keys=ON;'
          ];

          // Ejecutamos la migración secuencialmente
          const runMigration = async () => {
            try {
              for (const sql of migrationSql) {
                await dbQuery.run(sql);
              }
              console.log("✅ Migración de tabla archivos completada con éxito.");
            } catch (migErr) {
              console.error("❌ Error en migración de archivos:", migErr.message);
              await dbQuery.run('ROLLBACK;').catch(() => { });
            }
          };
          runMigration();
        }
      });

      // ✅ MIGRACIÓN 2026: Añadir urlPoster si no existe
      db.all("PRAGMA table_info(archivos)", (err, columns) => {
        if (err) return;
        if (!columns.some(c => c.name === 'urlPoster')) {
          console.log("🔄 [MIGRACIÓN] Añadiendo columna urlPoster a la tabla archivos...");
          db.run("ALTER TABLE archivos ADD COLUMN urlPoster TEXT", (err) => {
            if (err) console.error("❌ Error añadiendo urlPoster:", err.message);
            else console.log("✅ Columna urlPoster añadida con éxito.");
          });
        }
      });

      // ✅ MIGRACIÓN 2026: Añadir transcripcion_raw si no existe
      db.all("PRAGMA table_info(archivos)", (err, columns) => {
        if (err) return;
        if (!columns.some(c => c.name === 'transcripcion_raw')) {
          console.log("🔄 [MIGRACIÓN] Añadiendo columna transcripcion_raw a la tabla archivos...");
          db.run("ALTER TABLE archivos ADD COLUMN transcripcion_raw TEXT", (err) => {
            if (err) console.error("❌ Error añadiendo transcripcion_raw:", err.message);
            else console.log("✅ Columna transcripcion_raw añadida con éxito.");
          });
        }
      });
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIX DUPLICADOS 2026 — Migración anti-duplicados en tabla archivos
// Clave de unicidad: (actividadId, nombreArchivo)
// - Limpia duplicados existentes (conserva el registro más antiguo)
// - Crea UNIQUE INDEX para prevenir futuros duplicados
// - NULL actividadId NO se ve afectado (SQLite: NULL != NULL en UNIQUE)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(async () => {
  try {
    // Paso 1: Limpiar duplicados existentes (conservar el registro con menor id por grupo)
    const dupsExistentes = await dbQuery.all(`
      SELECT id FROM archivos
      WHERE actividadId IS NOT NULL
      AND id NOT IN (
        SELECT MIN(id) FROM archivos
        WHERE actividadId IS NOT NULL
        GROUP BY actividadId, nombreArchivo
      )
      AND EXISTS (
        SELECT 1 FROM archivos a2
        WHERE a2.actividadId = archivos.actividadId
        AND a2.nombreArchivo = archivos.nombreArchivo
        AND a2.id < archivos.id
      )
    `);

    if (dupsExistentes.length > 0) {
      const ids = dupsExistentes.map(d => d.id).join(',');
      await dbQuery.run(`DELETE FROM archivos WHERE id IN (${ids})`);
      console.log(`🔄 [FIX DUPLICADOS 2026] ${dupsExistentes.length} registros duplicados eliminados (conservado el más antiguo por grupo).`);
    } else {
      console.log('✅ [FIX DUPLICADOS 2026] No se encontraron duplicados existentes.');
    }

    // Paso 2: Crear índice UNIQUE para prevenir futuros duplicados
    await dbQuery.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_archivos_actividad_nombre
      ON archivos(actividadId, nombreArchivo)
    `);
    console.log('✅ [FIX DUPLICADOS 2026] Índice UNIQUE (actividadId, nombreArchivo) creado/verificado.');

  } catch (error) {
    console.error('❌ [FIX DUPLICADOS 2026] Error en migración anti-duplicados:', error.message);
  }
})();


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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MÓDULO 1: TABLAS VIAJES FUTUROS (PLANIFICACIÓN CON IA)
// Fecha: 2026-01-31
// Insertar DESPUÉS de la creación de archivos_asociados
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. TABLA: viajes_futuros
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

db.run(`
  CREATE TABLE IF NOT EXISTS viajes_futuros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    destino TEXT,
    fecha_inicio TEXT NOT NULL,
    fecha_fin TEXT NOT NULL,
    imagen TEXT,
    audio TEXT,
    descripcion TEXT,
    estado TEXT DEFAULT 'planificado' CHECK(estado IN ('planificado', 'migrado')),
    sessionId TEXT,
    fecha_creacion TEXT DEFAULT (datetime('now')),
    fecha_migracion TEXT,
    viaje_real_id INTEGER,
    FOREIGN KEY (viaje_real_id) REFERENCES viajes(id) ON DELETE SET NULL
  )
`, (err) => {
  if (err) {
    console.error('❌ Error al crear tabla viajes_futuros:', err.message);
  } else {
    console.log('✅ Tabla viajes_futuros creada o ya existe');
  }
});

// Índices para viajes_futuros
db.run('CREATE INDEX IF NOT EXISTS idx_viajes_futuros_estado ON viajes_futuros(estado)', (err) => {
  if (err) console.error('❌ Error creando índice idx_viajes_futuros_estado:', err.message);
  else console.log('✅ Índice idx_viajes_futuros_estado creado');
});

db.run('CREATE INDEX IF NOT EXISTS idx_viajes_futuros_sessionId ON viajes_futuros(sessionId)', (err) => {
  if (err) console.error('❌ Error creando índice idx_viajes_futuros_sessionId:', err.message);
  else console.log('✅ Índice idx_viajes_futuros_sessionId creado');
});

db.run('CREATE INDEX IF NOT EXISTS idx_viajes_futuros_fechas ON viajes_futuros(fecha_inicio, fecha_fin)', (err) => {
  if (err) console.error('❌ Error creando índice idx_viajes_futuros_fechas:', err.message);
  else console.log('✅ Índice idx_viajes_futuros_fechas creado');
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. TABLA: itinerarios_futuros
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

db.run(`
  CREATE TABLE IF NOT EXISTS itinerarios_futuros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    viajeFuturoId INTEGER NOT NULL,
    fechaInicio TEXT NOT NULL,
    fechaFin TEXT NOT NULL,
    duracionDias INTEGER NOT NULL,
    destinosPorDia TEXT NOT NULL,
    descripcionGeneral TEXT,
    horaInicio TEXT,
    horaFin TEXT,
    climaGeneral TEXT,
    tipoDeViaje TEXT CHECK(tipoDeViaje IN ('costa', 'naturaleza', 'rural', 'urbana', 'cultural', 'trabajo')),
    itinerario_real_id INTEGER,
    FOREIGN KEY (viajeFuturoId) REFERENCES viajes_futuros(id) ON DELETE CASCADE,
    FOREIGN KEY (itinerario_real_id) REFERENCES ItinerarioGeneral(id) ON DELETE SET NULL
  )
`, (err) => {
  if (err) {
    console.error('❌ Error al crear tabla itinerarios_futuros:', err.message);
  } else {
    console.log('✅ Tabla itinerarios_futuros creada o ya existe');
  }
});

// Índices para itinerarios_futuros
db.run('CREATE INDEX IF NOT EXISTS idx_itinerarios_futuros_viaje ON itinerarios_futuros(viajeFuturoId)', (err) => {
  if (err) console.error('❌ Error creando índice idx_itinerarios_futuros_viaje:', err.message);
  else console.log('✅ Índice idx_itinerarios_futuros_viaje creado');
});

db.run('CREATE INDEX IF NOT EXISTS idx_itinerarios_futuros_fechas ON itinerarios_futuros(fechaInicio, fechaFin)', (err) => {
  if (err) console.error('❌ Error creando índice idx_itinerarios_futuros_fechas:', err.message);
  else console.log('✅ Índice idx_itinerarios_futuros_fechas creado');
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. TABLA: actividades_futuras
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

db.run(`
  CREATE TABLE IF NOT EXISTS actividades_futuras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    viajeFuturoId INTEGER NOT NULL,
    itinerarioFuturoId INTEGER NOT NULL,
    tipoActividadId INTEGER NOT NULL,
    actividadDisponibleId INTEGER,
    nombre TEXT,
    descripcion TEXT,
    horaInicio TEXT NOT NULL,
    horaFin TEXT NOT NULL,
    ubicacion_planeada TEXT,
    
    -- Campos de estadísticas (vacíos en planificación)
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
    rutaGpxCompleto TEXT,
    rutaMapaCompleto TEXT,
    rutaManifest TEXT,
    rutaEstadisticas TEXT,
    rutaVisualSession TEXT,
    
    fechaCreacion TEXT DEFAULT (datetime('now')),
    fechaActualizacion TEXT DEFAULT (datetime('now')),
    actividad_real_id INTEGER,
    
    FOREIGN KEY (viajeFuturoId) REFERENCES viajes_futuros(id) ON DELETE CASCADE,
    FOREIGN KEY (itinerarioFuturoId) REFERENCES itinerarios_futuros(id) ON DELETE CASCADE,
    FOREIGN KEY (tipoActividadId) REFERENCES TiposActividad(id),
    FOREIGN KEY (actividadDisponibleId) REFERENCES ActividadesDisponibles(id),
    FOREIGN KEY (actividad_real_id) REFERENCES actividades(id) ON DELETE SET NULL
  )
`, (err) => {
  if (err) {
    console.error('❌ Error al crear tabla actividades_futuras:', err.message);
  } else {
    console.log('✅ Tabla actividades_futuras creada o ya existe');
  }
});

// Índices para actividades_futuras
db.run('CREATE INDEX IF NOT EXISTS idx_actividades_futuras_viaje ON actividades_futuras(viajeFuturoId)', (err) => {
  if (err) console.error('❌ Error creando índice idx_actividades_futuras_viaje:', err.message);
  else console.log('✅ Índice idx_actividades_futuras_viaje creado');
});

db.run('CREATE INDEX IF NOT EXISTS idx_actividades_futuras_itinerario ON actividades_futuras(itinerarioFuturoId)', (err) => {
  if (err) console.error('❌ Error creando índice idx_actividades_futuras_itinerario:', err.message);
  else console.log('✅ Índice idx_actividades_futuras_itinerario creado');
});

db.run('CREATE INDEX IF NOT EXISTS idx_actividades_futuras_tipo ON actividades_futuras(tipoActividadId)', (err) => {
  if (err) console.error('❌ Error creando índice idx_actividades_futuras_tipo:', err.message);
  else console.log('✅ Índice idx_actividades_futuras_tipo creado');
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. TABLA: log_migraciones (para auditoría)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

db.run(`
  CREATE TABLE IF NOT EXISTS log_migraciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    viaje_futuro_id INTEGER NOT NULL,
    viaje_real_id INTEGER NOT NULL,
    fecha_migracion TEXT DEFAULT (datetime('now')),
    itinerarios_migrados INTEGER DEFAULT 0,
    actividades_migradas INTEGER DEFAULT 0,
    errores TEXT,
    FOREIGN KEY (viaje_futuro_id) REFERENCES viajes_futuros(id),
    FOREIGN KEY (viaje_real_id) REFERENCES viajes(id)
  )
`, (err) => {
  if (err) {
    console.error('❌ Error al crear tabla log_migraciones:', err.message);
  } else {
    console.log('✅ Tabla log_migraciones creada o ya existe');
  }
});

// Índices para log_migraciones
db.run('CREATE INDEX IF NOT EXISTS idx_log_migraciones_viaje_futuro ON log_migraciones(viaje_futuro_id)', (err) => {
  if (err) console.error('❌ Error creando índice idx_log_migraciones_viaje_futuro:', err.message);
  else console.log('✅ Índice idx_log_migraciones_viaje_futuro creado');
});

db.run('CREATE INDEX IF NOT EXISTS idx_log_migraciones_fecha ON log_migraciones(fecha_migracion)', (err) => {
  if (err) console.error('❌ Error creando índice idx_log_migraciones_fecha:', err.message);
  else console.log('✅ Índice idx_log_migraciones_fecha creado');
});

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ MÓDULO 1: Tablas de Viajes Futuros inicializadas');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIN MÓDULO 1: TABLAS VIAJES FUTUROS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MÓDULO 2: ENDPOINTS VIAJES FUTUROS (PLANIFICACIÓN CON IA)
// Fecha: 2026-01-31
// Insertar DESPUÉS de todos los endpoints existentes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. LISTAR VIAJES FUTUROS
// GET /viajes-futuros?estado=planificado
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/viajes-futuros', (req, res) => {
  const { estado } = req.query;

  let sql = 'SELECT * FROM viajes_futuros';
  let params = [];

  if (estado) {
    sql += ' WHERE estado = ?';
    params.push(estado);
  }

  sql += ' ORDER BY fecha_inicio DESC';

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('❌ Error al listar viajes futuros:', err.message);
      return res.status(500).json({ error: 'Error al obtener viajes futuros' });
    }

    console.log(`✅ Listados ${rows.length} viajes futuros`);
    res.json(rows);
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. OBTENER VIAJE FUTURO POR ID (con itinerarios y actividades anidados)
// GET /viajes-futuros/:id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/viajes-futuros/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Obtener viaje
    const viaje = await dbQuery.get(
      `SELECT * FROM viajes_futuros WHERE id = ?`,
      [id]
    );

    if (!viaje) {
      return res.status(404).json({ error: 'Viaje no encontrado' });
    }

    // 2. Obtener itinerarios
    const itinerarios = await dbQuery.all(
      `SELECT * FROM itinerarios_futuros WHERE viajeFuturoId = ? ORDER BY fechaInicio`,
      [id]
    );

    // 3. Obtener actividades con el nombre del tipo
    const actividades = await dbQuery.all(
      `SELECT 
                a.*,
                t.nombre as tipoActividad
             FROM actividades_futuras a
             LEFT JOIN TiposActividad t ON t.id = a.tipoActividadId
             WHERE a.viajeFuturoId = ?
             ORDER BY a.horaInicio`,
      [id]
    );

    // 4. Calcular estadísticas
    const totalDias = itinerarios.reduce((sum, it) => sum + it.duracionDias, 0);
    const totalActividades = actividades.length;
    const actividadesPorDia = totalDias > 0 ? (totalActividades / totalDias).toFixed(1) : 0;

    console.log(`✅ Viaje futuro ${id} obtenido: ${totalActividades} actividades en ${totalDias} días`);

    res.json({
      viaje,
      itinerarios,
      actividades,
      estadisticas: {
        total_dias: totalDias,
        total_actividades: totalActividades,
        actividades_por_dia: parseFloat(actividadesPorDia)
      }
    });

  } catch (error) {
    console.error('❌ Error obteniendo viaje futuro:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. CREAR VIAJE FUTURO
// POST /viajes-futuros
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.post('/viajes-futuros', (req, res) => {
  const { nombre, destino, fecha_inicio, fecha_fin, imagen, audio, descripcion, sessionId } = req.body;

  if (!nombre || !fecha_inicio || !fecha_fin) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: nombre, fecha_inicio, fecha_fin' });
  }

  const sql = `
    INSERT INTO viajes_futuros 
    (nombre, destino, fecha_inicio, fecha_fin, imagen, audio, descripcion, sessionId, estado) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planificado')
  `;

  db.run(
    sql,
    [nombre, destino, fecha_inicio, fecha_fin, imagen, audio, descripcion, sessionId],
    function (err) {
      if (err) {
        console.error('❌ Error al crear viaje futuro:', err.message);
        return res.status(500).json({ error: 'Error al crear viaje futuro' });
      }

      const nuevoId = this.lastID;
      console.log(`✅ Viaje futuro creado: ${nombre} (ID: ${nuevoId})`);

      res.status(201).json({
        id: nuevoId,
        nombre,
        destino,
        fecha_inicio,
        fecha_fin,
        estado: 'planificado',
        sessionId
      });
    }
  );
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. ACTUALIZAR VIAJE FUTURO
// PUT /viajes-futuros/:id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.put('/viajes-futuros/:id', (req, res) => {
  const { id } = req.params;
  const { nombre, destino, fecha_inicio, fecha_fin, imagen, audio, descripcion } = req.body;

  // Verificar que el viaje existe y no está migrado
  db.get('SELECT estado FROM viajes_futuros WHERE id = ?', [id], (err, viaje) => {
    if (err) {
      console.error('❌ Error al verificar viaje:', err.message);
      return res.status(500).json({ error: 'Error al verificar viaje' });
    }

    if (!viaje) {
      return res.status(404).json({ error: 'Viaje futuro no encontrado' });
    }

    if (viaje.estado === 'migrado') {
      return res.status(400).json({ error: 'No se puede editar un viaje ya migrado' });
    }

    const sql = `
      UPDATE viajes_futuros 
      SET nombre = ?, destino = ?, fecha_inicio = ?, fecha_fin = ?, imagen = ?, audio = ?, descripcion = ?
      WHERE id = ?
    `;

    db.run(
      sql,
      [nombre, destino, fecha_inicio, fecha_fin, imagen, audio, descripcion, id],
      function (err) {
        if (err) {
          console.error('❌ Error al actualizar viaje futuro:', err.message);
          return res.status(500).json({ error: 'Error al actualizar viaje futuro' });
        }

        console.log(`✅ Viaje futuro actualizado: ${nombre} (ID: ${id})`);
        res.json({ message: 'Viaje futuro actualizado correctamente', id });
      }
    );
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. ELIMINAR VIAJE FUTURO
// DELETE /viajes-futuros/:id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.delete('/viajes-futuros/:id', (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM viajes_futuros WHERE id = ?', [id], function (err) {
    if (err) {
      console.error('❌ Error al eliminar viaje futuro:', err.message);
      return res.status(500).json({ error: 'Error al eliminar viaje futuro' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Viaje futuro no encontrado' });
    }

    console.log(`✅ Viaje futuro eliminado (ID: ${id})`);
    res.json({ message: 'Viaje futuro eliminado correctamente', id });
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. CREAR ITINERARIO PARA UN VIAJE FUTURO
// POST /viajes-futuros/:id/itinerarios
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.post('/viajes-futuros/:id/itinerarios', (req, res) => {
  const { id } = req.params;
  const { fechaInicio, fechaFin, duracionDias, destinosPorDia, descripcionGeneral, horaInicio, horaFin, climaGeneral, tipoDeViaje } = req.body;

  if (!fechaInicio || !fechaFin || !duracionDias || !destinosPorDia) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  const sql = `
    INSERT INTO itinerarios_futuros 
    (viajeFuturoId, fechaInicio, fechaFin, duracionDias, destinosPorDia, descripcionGeneral, horaInicio, horaFin, climaGeneral, tipoDeViaje)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(
    sql,
    [id, fechaInicio, fechaFin, duracionDias, destinosPorDia, descripcionGeneral, horaInicio, horaFin, climaGeneral, tipoDeViaje],
    function (err) {
      if (err) {
        console.error('❌ Error al crear itinerario:', err.message);
        return res.status(500).json({ error: 'Error al crear itinerario' });
      }

      console.log(`✅ Itinerario creado (ID: ${this.lastID}) para viaje ${id}`);
      res.status(201).json({ id: this.lastID, viajeFuturoId: id });
    }
  );
});



// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. CREAR ACTIVIDAD PARA UN ITINERARIO FUTURO
// POST /itinerarios-futuros/:id/actividades
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.post('/itinerarios-futuros/:id/actividades', (req, res) => {
  const { id } = req.params;
  const { viajeFuturoId, tipoActividadId, actividadDisponibleId, nombre, descripcion, horaInicio, horaFin, ubicacion_planeada } = req.body;

  if (!viajeFuturoId || !tipoActividadId || !horaInicio || !horaFin) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: viajeFuturoId, tipoActividadId, horaInicio, horaFin' });
  }

  const sql = `
    INSERT INTO actividades_futuras 
    (viajeFuturoId, itinerarioFuturoId, tipoActividadId, actividadDisponibleId, nombre, descripcion, horaInicio, horaFin, ubicacion_planeada)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(
    sql,
    [viajeFuturoId, id, tipoActividadId, actividadDisponibleId, nombre, descripcion, horaInicio, horaFin, ubicacion_planeada],
    function (err) {
      if (err) {
        console.error('❌ Error al crear actividad:', err.message);
        return res.status(500).json({ error: 'Error al crear actividad' });
      }

      console.log(`✅ Actividad creada (ID: ${this.lastID}) para itinerario ${id}`);
      res.status(201).json({ id: this.lastID, itinerarioFuturoId: id });
    }
  );
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. ACTUALIZAR ITINERARIO FUTURO
// PUT /itinerarios-futuros/:id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.put('/itinerarios-futuros/:id', (req, res) => {
  const { id } = req.params;
  const { fechaInicio, fechaFin, duracionDias, destinosPorDia, descripcionGeneral, horaInicio, horaFin, climaGeneral, tipoDeViaje } = req.body;

  const sql = `
    UPDATE itinerarios_futuros 
    SET fechaInicio = ?, fechaFin = ?, duracionDias = ?, destinosPorDia = ?, descripcionGeneral = ?, horaInicio = ?, horaFin = ?, climaGeneral = ?, tipoDeViaje = ?
    WHERE id = ?
  `;

  db.run(
    sql,
    [fechaInicio, fechaFin, duracionDias, destinosPorDia, descripcionGeneral, horaInicio, horaFin, climaGeneral, tipoDeViaje, id],
    function (err) {
      if (err) {
        console.error('❌ Error al actualizar itinerario:', err.message);
        return res.status(500).json({ error: 'Error al actualizar itinerario' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Itinerario no encontrado' });
      }

      console.log(`✅ Itinerario actualizado (ID: ${id})`);
      res.json({ message: 'Itinerario actualizado correctamente', id });
    }
  );
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. ACTUALIZAR ACTIVIDAD FUTURA
// PUT /actividades-futuras/:id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.put('/actividades-futuras/:id', (req, res) => {
  const { id } = req.params;
  const { tipoActividadId, actividadDisponibleId, nombre, descripcion, horaInicio, horaFin, ubicacion_planeada } = req.body;

  const sql = `
    UPDATE actividades_futuras 
    SET tipoActividadId = ?, actividadDisponibleId = ?, nombre = ?, descripcion = ?, horaInicio = ?, horaFin = ?, ubicacion_planeada = ?, fechaActualizacion = datetime('now')
    WHERE id = ?
  `;

  db.run(
    sql,
    [tipoActividadId, actividadDisponibleId, nombre, descripcion, horaInicio, horaFin, ubicacion_planeada, id],
    function (err) {
      if (err) {
        console.error('❌ Error al actualizar actividad:', err.message);
        return res.status(500).json({ error: 'Error al actualizar actividad' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Actividad no encontrada' });
      }

      console.log(`✅ Actividad actualizada (ID: ${id})`);
      res.json({ message: 'Actividad actualizada correctamente', id });
    }
  );
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 10. ELIMINAR ITINERARIO FUTURO
// DELETE /itinerarios-futuros/:id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.delete('/itinerarios-futuros/:id', (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM itinerarios_futuros WHERE id = ?', [id], function (err) {
    if (err) {
      console.error('❌ Error al eliminar itinerario:', err.message);
      return res.status(500).json({ error: 'Error al eliminar itinerario' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Itinerario no encontrado' });
    }

    console.log(`✅ Itinerario eliminado (ID: ${id})`);
    res.json({ message: 'Itinerario eliminado correctamente', id });
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 11. OBTENER ACTIVIDAD FUTURA INDIVIDUAL
// GET /actividades-futuras/:id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/actividades-futuras/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM actividades_futuras WHERE id = ?', [id], (err, row) => {
    if (err) {
      console.error('❌ Error al obtener actividad:', err.message);
      return res.status(500).json({ error: 'Error al obtener actividad' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Actividad no encontrada' });
    }

    res.json(row);
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 12. ELIMINAR ACTIVIDAD FUTURA
// DELETE /actividades-futuras/:id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.delete('/actividades-futuras/:id', (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM actividades_futuras WHERE id = ?', [id], function (err) {
    if (err) {
      console.error('❌ Error al eliminar actividad:', err.message);
      return res.status(500).json({ error: 'Error al eliminar actividad' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Actividad no encontrada' });
    }

    console.log(`✅ Actividad eliminada (ID: ${id})`);
    res.json({ message: 'Actividad eliminada correctamente', id });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 12. LISTAR ITINERARIOS DE UN VIAJE FUTURO
// GET /viajes-futuros/:id/itinerarios
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/viajes-futuros/:id/itinerarios', (req, res) => {
  const { id } = req.params;

  db.all('SELECT * FROM itinerarios_futuros WHERE viajeFuturoId = ? ORDER BY fechaInicio', [id], (err, rows) => {
    if (err) {
      console.error('❌ Error al listar itinerarios:', err.message);
      return res.status(500).json({ error: 'Error al obtener itinerarios' });
    }

    console.log(`✅ Listados ${rows.length} itinerarios del viaje ${id}`);
    res.json(rows);
  });
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 13. LISTAR ACTIVIDADES DE UN ITINERARIO FUTURO
// GET /itinerarios-futuros/:id/actividades
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/itinerarios-futuros/:id/actividades', (req, res) => {
  const { id } = req.params;

  db.all('SELECT * FROM actividades_futuras WHERE itinerarioFuturoId = ? ORDER BY horaInicio', [id], (err, rows) => {
    if (err) {
      console.error('❌ Error al listar actividades:', err.message);
      return res.status(500).json({ error: 'Error al obtener actividades' });
    }

    console.log(`✅ Listadas ${rows.length} actividades del itinerario ${id}`);
    res.json(rows);
  });
});


console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ MÓDULO 2: Endpoints de Viajes Futuros inicializados');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIN MÓDULO 2: ENDPOINTS VIAJES FUTUROS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENDPOINT ESPECIAL: GUARDAR VIAJE DESDE PLAN DE IA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.post('/viajes-futuros/desde-ia', async (req, res) => {
  const { plan } = req.body;

  if (!plan || !plan.viaje || !plan.itinerarios) {
    return res.status(400).json({ error: 'Plan incompleto' });
  }

  try {
    // 1. Crear el viaje
    const resultadoViaje = await dbQuery.run(
      `INSERT INTO viajes_futuros 
             (nombre, destino, fecha_inicio, fecha_fin, descripcion, estado, sessionId)
             VALUES (?, ?, ?, ?, ?, 'planificado', ?)`,
      [
        plan.viaje.nombre,
        plan.viaje.destino,
        plan.viaje.fecha_inicio,
        plan.viaje.fecha_fin,
        plan.viaje.descripcion || '',
        `ia-${Date.now()}`
      ]
    );

    const viajeId = resultadoViaje.lastID;
    console.log(`✅ Viaje creado con ID: ${viajeId}`);

    // 2. Preparar datos para un solo itinerario (resumen del viaje completo)
    const destinosPorDia = plan.itinerarios.map(it => {
      const numActividades = it.actividades?.length || 0;
      return `${it.fecha}: ${it.descripcion || 'Sin descripción'} (${numActividades} actividades)`;
    }).join(' | ');

    const duracionDias = plan.itinerarios.length;

    // 3. Crear UN itinerario general que engloba todo el viaje
    const resultadoItinerario = await dbQuery.run(
      `INSERT INTO itinerarios_futuros 
             (viajeFuturoId, fechaInicio, fechaFin, duracionDias, destinosPorDia, descripcionGeneral, tipoDeViaje)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        viajeId,
        plan.viaje.fecha_inicio,
        plan.viaje.fecha_fin,
        duracionDias,
        destinosPorDia,
        plan.viaje.descripcion || `Viaje planificado con IA - ${duracionDias} días`,
        plan.itinerarios[0]?.tipo_viaje || 'urbana'
      ]
    );

    const itinerarioId = resultadoItinerario.lastID;
    console.log(`✅ Itinerario general creado con ID: ${itinerarioId}`);

    // 4. Obtener ID del tipo de actividad por defecto (turismo)
    const tipoTurismo = await dbQuery.get(
      `SELECT id FROM TiposActividad WHERE nombre = 'Turismo' LIMIT 1`
    );
    const tipoTurismoId = tipoTurismo?.id || 1;

    // 5. Crear todas las actividades
    let actividadesCreadas = 0;

    for (const itinerarioDia of plan.itinerarios) {
      if (itinerarioDia.actividades && itinerarioDia.actividades.length > 0) {
        for (const act of itinerarioDia.actividades) {
          await dbQuery.run(
            `INSERT INTO actividades_futuras 
                         (viajeFuturoId, itinerarioFuturoId, tipoActividadId, nombre, descripcion, 
                          horaInicio, horaFin, ubicacion_planeada)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              viajeId,
              itinerarioId,
              tipoTurismoId,
              `${act.nombre} (${itinerarioDia.fecha})`,
              act.descripcion || '',
              act.hora_inicio,
              act.hora_fin,
              act.ubicacion || ''
            ]
          );

          actividadesCreadas++;
        }
      }
    }

    console.log(`✅ Plan guardado: 1 itinerario general, ${actividadesCreadas} actividades`);

    res.json({
      viaje_id: viajeId,
      itinerarios_creados: 1,
      actividades_creadas: actividadesCreadas,
      mensaje: `Viaje "${plan.viaje.nombre}" guardado correctamente`
    });

  } catch (error) {
    console.error('❌ Error guardando plan desde IA:', error.message);
    res.status(500).json({ error: error.message });
  }
});



// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MÓDULO 6: ENDPOINTS IA - INTEGRACIÓN CON PERPLEXITY
// Fecha: 2026-02-04
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


app.post('/ia/chat', iaRateLimiter, verificarLimiteTokens, async (req, res) => {
  const { sessionId, mensaje, apiKey } = req.body;

  if (!sessionId || !mensaje) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: sessionId, mensaje' });
  }

  const inicio = Date.now();

  try {
    // 1. Guardar mensaje del usuario en BD
    await dbQuery.run(
      `INSERT INTO conversaciones_ia (sessionId, rol, mensaje, timestamp) 
       VALUES (?, 'user', ?, datetime('now'))`,
      [sessionId, mensaje]
    );

    console.log(`📤 [IA] Usuario (${sessionId.substring(0, 8)}): ${mensaje.substring(0, 50)}...`);

    // 2. Obtener historial de la conversación (últimos 20 mensajes)
    const historial = await dbQuery.all(
      `SELECT rol, mensaje FROM conversaciones_ia 
       WHERE sessionId = ? 
       ORDER BY timestamp ASC 
       LIMIT 20`,
      [sessionId]
    );

    // 3. Preparar mensajes para Perplexity
    const mensajesPerplexity = [
      {
        role: 'system',
        content: `Eres un asistente experto en planificación de viajes. 

Tu objetivo es ayudar al usuario a crear un plan de viaje estructurado con:
- Nombre del viaje
- Destino principal
- Fechas de inicio y fin (formato YYYY-MM-DD)
- Itinerarios por día con actividades detalladas (nombre, horario, descripción)

Cuando el plan esté completo, incluye al final de tu respuesta un bloque JSON con este formato exacto:

\`\`\`json
{
  "plan_completo": true,
  "viaje": {
    "nombre": "Viaje a Barcelona",
    "destino": "Barcelona",
    "fecha_inicio": "2026-03-15",
    "fecha_fin": "2026-03-18",
    "descripcion": "Escapada cultural y gastronómica"
  },
  "itinerarios": [
    {
      "fecha": "2026-03-15",
      "descripcion": "Llegada y zona gótica",
      "tipo_viaje": "urbana",
      "actividades": [
        {
          "nombre": "Check-in hotel",
          "descripcion": "Hotel en Las Ramblas",
          "hora_inicio": "14:00",
          "hora_fin": "15:00",
          "tipo_actividad": "alojamiento",
          "ubicacion": "Las Ramblas, Barcelona"
        }
      ]
    }
  ]
}
\`\`\`

IMPORTANTE: 
- Los tipos de viaje válidos son: costa, naturaleza, rural, urbana, cultural, trabajo
- Los horarios deben estar en formato HH:MM (24 horas)
- Las fechas en formato YYYY-MM-DD
- Sé conversacional y amigable
- Haz preguntas si falta información importante`
      },
      ...historial.map(m => ({
        role: m.rol === 'user' ? 'user' : 'assistant',
        content: m.mensaje
      }))
    ];

    // 4. Llamar a Perplexity usando el cliente
    const respuestaPerplexity = await perplexityClient.chat(mensajesPerplexity, apiKey);

    const respuestaIA = respuestaPerplexity.contenido;
    const tokensUsados = respuestaPerplexity.tokens;
    const tiempoRespuesta = respuestaPerplexity.tiempo_ms;

    console.log(`📥 [IA] Respuesta recibida (${tokensUsados} tokens, ${tiempoRespuesta}ms)`);

    // 5. Detectar si hay un plan estructurado en la respuesta
    let planDetectado = false;
    let datosEstructurados = null;

    const jsonMatch = respuestaIA.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        datosEstructurados = JSON.parse(jsonMatch[1]);
        planDetectado = datosEstructurados.plan_completo === true;
        console.log('✨ [IA] Plan estructurado detectado');
      } catch (error) {
        console.warn('⚠️ [IA] Error parseando JSON del plan:', error.message);
      }
    }

    // 6. Guardar respuesta de la IA en BD
    const resultadoInsert = await dbQuery.run(
      `INSERT INTO conversaciones_ia 
       (sessionId, rol, mensaje, timestamp, tokens_usados, tiempo_respuesta, datos_estructurados, modelo) 
       VALUES (?, 'assistant', ?, datetime('now'), ?, ?, ?, ?)`,
      [
        sessionId,
        respuestaIA,
        tokensUsados,
        tiempoRespuesta,
        datosEstructurados ? JSON.stringify(datosEstructurados) : null,
        respuestaPerplexity.modelo
      ]
    );

    // 7. Responder al frontend
    res.json({
      id: resultadoInsert.lastID,
      mensaje: respuestaIA,
      tokens: tokensUsados,
      tiempo_ms: tiempoRespuesta,
      plan_detectado: planDetectado,
      datos_estructurados: datosEstructurados,
      citations: respuestaPerplexity.citations || [],
      // ✨ Información de límites de seguridad
      limite_tokens: {
        consumidos: (req.tokensConsumidos || 0) + tokensUsados,
        maximo: MAX_TOKENS_POR_SESION,
        restantes: Math.max(0, (req.tokensRestantes || MAX_TOKENS_POR_SESION) - tokensUsados),
        porcentaje_usado: Math.round(((req.tokensConsumidos || 0) + tokensUsados) / MAX_TOKENS_POR_SESION * 100)
      }
    });

  } catch (error) {
    console.error('❌ [IA] Error en chat:', error.message);

    res.status(error.status || 500).json({
      error: error.message || 'Error al procesar mensaje con IA',
      tiempo_ms: error.tiempo_ms || Date.now() - inicio
    });
  }
});



// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. VALIDAR API KEY
// POST /ia/validar-apikey
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.post('/ia/validar-apikey', async (req, res) => {
  const { apiKey } = req.body;

  if (!apiKey) {
    return res.status(400).json({ valida: false, error: 'API Key no proporcionada' });
  }

  try {
    console.log('🔑 Validando API Key de Perplexity...');
    const resultado = await perplexityClient.validarApiKey(apiKey);
    res.json(resultado);
  } catch (error) {
    console.error('❌ [IA] Error validando API Key:', error.message);
    res.json({
      valida: false,
      error: error.message || 'No se pudo validar la API Key'
    });
  }
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. OBTENER HISTORIAL DE UNA SESIÓN
// GET /ia/historial/:sessionId
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/ia/historial/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const mensajes = await dbQuery.all(
      `SELECT 
        id, sessionId, rol, mensaje, timestamp, 
        tokens_usados, modelo, tiempo_respuesta, 
        datos_estructurados, tipo_interaccion 
       FROM conversaciones_ia 
       WHERE sessionId = ? 
       ORDER BY timestamp ASC`,
      [sessionId]
    );

    // Parsear datos_estructurados si existen
    const mensajesProcesados = mensajes.map(m => ({
      ...m,
      datos_estructurados: m.datos_estructurados ? JSON.parse(m.datos_estructurados) : null
    }));

    console.log(`📖 [IA] Historial cargado: ${mensajes.length} mensajes (${sessionId.substring(0, 8)})`);

    res.json({
      sessionId,
      total: mensajes.length,
      mensajes: mensajesProcesados
    });
  } catch (error) {
    console.error('❌ Error obteniendo historial:', error.message);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. LIMPIAR HISTORIAL DE UNA SESIÓN
// DELETE /ia/historial/:sessionId
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.delete('/ia/historial/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const resultado = await dbQuery.run(
      'DELETE FROM conversaciones_ia WHERE sessionId = ?',
      [sessionId]
    );

    console.log(`🗑️ [IA] Historial eliminado: ${resultado.changes} mensajes (${sessionId.substring(0, 8)})`);

    res.json({
      success: true,
      deleted: resultado.changes
    });
  } catch (error) {
    console.error('❌ Error eliminando historial:', error.message);
    res.status(500).json({ error: 'Error al eliminar historial' });
  }
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. LISTAR SESIONES ACTIVAS
// GET /ia/sesiones-activas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/ia/sesiones-activas', async (req, res) => {
  try {
    const sesiones = await dbQuery.all(
      `SELECT 
        sessionId,
        COUNT(*) as num_mensajes,
        MIN(timestamp) as inicio,
        MAX(timestamp) as ultimo_mensaje,
        SUM(CASE WHEN rol = 'user' THEN 1 ELSE 0 END) as mensajes_usuario,
        SUM(CASE WHEN rol = 'assistant' THEN 1 ELSE 0 END) as respuestas_ia,
        SUM(COALESCE(tokens_usados, 0)) as tokens_totales,
        SUM(CASE WHEN datos_estructurados IS NOT NULL THEN 1 ELSE 0 END) as tiene_plan
       FROM conversaciones_ia 
       GROUP BY sessionId 
       ORDER BY ultimo_mensaje DESC`,
      []
    );

    console.log(`📚 [IA] Sesiones activas: ${sesiones.length}`);
    res.json(sesiones);
  } catch (error) {
    console.error('❌ Error listando sesiones:', error.message);
    res.status(500).json({ error: 'Error al listar sesiones' });
  }
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 15. TRANSCRIBIR AUDIO (SPEECH-TO-TEXT)
// POST /archivos/:id/transcribir
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.post('/archivos/:id/transcribir', async (req, res) => {
  const { id } = req.params;
  const { force = false } = req.body;

  if (procesosTranscripcionActivos.has(id)) {
    return res.status(409).json({ error: 'Ya hay una transcripción en curso para este archivo' });
  }

  try {
    procesosTranscripcionActivos.add(id);

    // 1. Obtener información del archivo
    const archivo = await dbQuery.get("SELECT * FROM archivos WHERE id = ?", [id]);
    if (!archivo) {
      procesosTranscripcionActivos.delete(id);
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    // 2. Comprobar si ya tiene transcripción y no se fuerza
    if (archivo.transcripcion_raw && !force) {
      procesosTranscripcionActivos.delete(id);
      return res.json({
        text: archivo.transcripcion_raw,
        fromCache: true,
        message: 'Recuperado de la base de datos'
      });
    }

    // 3. Determinar qué archivo transcribir (principal o asociado)
    let rutaAudio = '';

    // Normalizar ruta (quitar uploads/ si existe)
    const limpiarRuta = (r) => r.replace(/^uploads[\\\/]/, '').replace(/\\/g, '/');

    if (archivo.tipo === 'audio' || archivo.tipo === 'video') {
      rutaAudio = path.join(uploadsPath, limpiarRuta(archivo.rutaArchivo));
    } else if (archivo.tipo === 'foto' || archivo.tipo === 'imagen') {
      const asociado = await dbQuery.get(
        "SELECT rutaArchivo FROM archivos_asociados WHERE archivoPrincipalId = ? AND tipo = 'audio' LIMIT 1",
        [id]
      );
      if (!asociado) {
        procesosTranscripcionActivos.delete(id);
        return res.status(400).json({ error: 'Este archivo no tiene audio asociado para transcribir' });
      }
      rutaAudio = path.join(uploadsPath, limpiarRuta(asociado.rutaArchivo));
    } else {
      procesosTranscripcionActivos.delete(id);
      return res.status(400).json({ error: 'El tipo de archivo no es válido para transcripción' });
    }

    if (!fs.existsSync(rutaAudio)) {
      console.error(`❌ Archivo no encontrado en: ${rutaAudio}`);
      procesosTranscripcionActivos.delete(id);
      return res.status(404).json({ error: 'El archivo de audio no existe físicamente en el servidor' });
    }

    // 4. Procesar audio (extraer de vídeo o comprimir si es necesario)
    let rutaProcesada = rutaAudio;
    let esTemporal = false;

    // Si es vídeo, extraer audio a MP3 temporal
    if (archivo.tipo === 'video') {
      const tmpPath = path.join(uploadsPath, `tmp_audio_${id}_${Date.now()}.mp3`);
      console.log(`🎬 [FFMPEG] Extrayendo audio de vídeo para ID ${id}...`);
      await new Promise((resolve, reject) => {
        exec(`ffmpeg -i "${rutaAudio}" -vn -acodec libmp3lame -y "${tmpPath}"`, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      rutaProcesada = tmpPath;
      esTemporal = true;
    }

    // Comprobar tamaño (> 25MB) para Whisper
    const stats = fs.statSync(rutaProcesada);
    if (stats.size > 24 * 1024 * 1024) { // Dejamos margen (24MB)
      const compressedPath = path.join(uploadsPath, `comp_audio_${id}_${Date.now()}.mp3`);
      console.log(`📉 [FFMPEG] Comprimiendo audio para ID ${id} (${(stats.size / 1024 / 1024).toFixed(2)} MB)...`);
      await new Promise((resolve, reject) => {
        exec(`ffmpeg -i "${rutaProcesada}" -b:a 64k -y "${compressedPath}"`, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      if (esTemporal) fs.unlinkSync(rutaProcesada);
      rutaProcesada = compressedPath;
      esTemporal = true;
    }

    // 5. Llamar a Motor Local (faster-whisper)
    console.log(`🎙️ [IA LOCAL] Transcribiendo con faster-whisper: ${path.basename(rutaProcesada)}...`);

    const scriptPath = path.join(__dirname, 'backend-services/stt-engine/transcribe_local.py');
    const model = "small";

    const transcription = await new Promise((resolve, reject) => {
      // Ejecutar script de python local
      // Asegurarse de que 'python' esté en el PATH y tenga las dependencias
      exec(`python "${scriptPath}" "${rutaProcesada}" --model ${model} --lang es`, (err, stdout, stderr) => {
        if (err) {
          console.error(`❌ Error en motor STT local: ${stderr}`);
          reject(new Error(stderr || err.message));
          return;
        }
        try {
          const result = JSON.parse(stdout);
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result);
          }
        } catch (e) {
          reject(new Error(`Error de comunicación con el motor STT: ${stdout}`));
        }
      });
    });

    const text = transcription.text;

    // 6. Guardar en BD
    await dbQuery.run(
      "UPDATE archivos SET transcripcion_raw = ?, fechaActualizacion = datetime('now') WHERE id = ?",
      [text, id]
    );

    // 7. Limpiar archivos temporales
    if (esTemporal && fs.existsSync(rutaProcesada)) {
      fs.unlinkSync(rutaProcesada);
    }

    procesosTranscripcionActivos.delete(id);
    console.log(`✅ [IA] Transcripción completada para ID ${id}`);

    res.json({
      text,
      fromCache: false,
      message: 'Transcripción generada correctamente'
    });

  } catch (error) {
    procesosTranscripcionActivos.delete(id);
    console.error('❌ [IA] Error en transcripción:', error.message);
    res.status(500).json({ error: error.message || 'Error al transcribir el audio' });
  }
});


console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ MÓDULO 6: Endpoints de IA inicializados');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');


// Extraer fecha y hora de un archivo (EXIF o metadatos del sistema)


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

/**
 * ✨ NUEVO: Genera una miniatura de un vídeo usando ffmpeg
 * Usa el ID del archivo para evitar colisiones.
 */
function generarMiniaturaVideo(archivoId, rutaCompleta, callback) {
  const thumbnailName = `thumb_${archivoId}.jpg`;
  const folder = path.dirname(rutaCompleta);
  const outputPath = path.join(folder, thumbnailName);

  // Comando ffmpeg: extraer 1 frame en el segundo 1
  // -ss 1 (seek to 1s), -i input, -vframes 1 (output 1 frame), -q:v 2 (calidad alta), -y (sobrescribir)
  const command = `ffmpeg -ss 1 -i "${rutaCompleta}" -vframes 1 -q:v 2 -y "${outputPath}"`;

  console.log(`🎬 [FFMPEG] Generando miniatura para ID ${archivoId}...`);

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`❌ [FFMPEG] Error generando miniatura para ID ${archivoId}:`, error.message);
      return callback(null);
    }

    // Calcular ruta relativa a la carpeta uploads para guardar en DB
    const relativePath = path.relative(uploadsPath, outputPath).replace(/\\/g, '/');
    console.log(`✅ [FFMPEG] Miniatura creada: ${relativePath}`);
    callback(relativePath);
  });
}

/**
 * ✨ NUEVO: Endpoint para recibir miniaturas generadas por el cliente
 * Permite persistir miniaturas sin depender de ffmpeg en el servidor.
 */
app.post('/archivos/:id/poster-cliente', bodyParser.json({ limit: '2mb' }), async (req, res) => {
  const { id } = req.params;
  const { imageBase64 } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ error: 'Falta la imagen en base64' });
  }

  try {
    // 1. Obtener información del archivo para saber dónde guardarlo
    const archivo = await dbQuery.get("SELECT rutaArchivo FROM archivos WHERE id = ?", [id]);
    if (!archivo) return res.status(404).json({ error: 'Archivo no encontrado' });

    // 2. Preparar ruta
    const videoFolder = path.dirname(path.join(uploadsPath, archivo.rutaArchivo));
    const thumbnailName = `thumb_${id}.jpg`;
    const outputPath = path.join(videoFolder, thumbnailName);

    // 3. Guardar imagen
    const base64Data = imageBase64.replace(/^data:image\/jpeg;base64,/, "");
    fs.writeFileSync(outputPath, base64Data, 'base64');

    // 4. Actualizar base de datos
    const relativePath = path.relative(uploadsPath, outputPath).replace(/\\/g, '/');
    await dbQuery.run("UPDATE archivos SET urlPoster = ? WHERE id = ?", [relativePath, id]);

    console.log(`📸 [Poster-Cliente] Miniatura persistida para ID ${id}: ${relativePath}`);
    res.json({ success: true, urlPoster: relativePath });

  } catch (error) {
    console.error(`❌ [Poster-Cliente] Error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

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
    SELECT fechaInicio, fechaFin, descripcionGeneral, destinosPorDia 
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
      dias: 1,
      descripcion: itinerarios[0].descripcionGeneral || '',
      destinos: itinerarios[0].destinosPorDia || ''
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
          dias: 1,
          descripcion: itinerarios[i].descripcionGeneral || '',
          destinos: itinerarios[i].destinosPorDia || ''
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
    console.log(`🗑️ Iniciando eliminación integral del viaje ${id}...`);

    // 0. Obtener datos del viaje para limpiar recursos de portada
    const viaje = await dbQuery.get('SELECT imagen, audio FROM viajes WHERE id = ?', [id]);
    if (!viaje) {
      return res.status(404).json({ error: 'Viaje no encontrado' });
    }

    // 1. Eliminar archivos de portada (vía unlinked individual ya que suelen estar en raíz de uploads)
    [viaje.imagen, viaje.audio].forEach(fileName => {
      if (fileName) {
        try {
          const fullPath = path.isAbsolute(fileName) ? fileName : path.join(uploadsPath, fileName);
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            console.log(`  📄 Recurso de portada eliminado: ${fileName}`);
          }
        } catch (e) { console.warn(`  ⚠️ Error eliminando recurso viaje: ${fileName}`); }
      }
    });

    // 2. Eliminar carpeta física del viaje (Limpia GPX, Mapas y Fotos de actividades de un golpe)
    const viajeFolder = path.join(uploadsPath, id.toString());
    if (fs.existsSync(viajeFolder)) {
      try {
        fs.rmSync(viajeFolder, { recursive: true, force: true });
        console.log(`  📂 Carpeta de viaje eliminada (limpieza total de multimedia): ${viajeFolder}`);
      } catch (e) { console.warn(`  ⚠️ Error eliminando la carpeta del viaje: ${viajeFolder}`); }
    }

    // 3. Borrar de la Base de Datos
    // Gracias al PRAGMA foreign_keys = ON, esto borrará automáticamente en cascada:
    // ItinerarioGeneral -> actividades -> archivos -> archivos_asociados
    const result = await dbQuery.run('DELETE FROM viajes WHERE id = ?', [id]);

    console.log(`✅ Viaje ${id} eliminado correctamente de la BD.`);

    res.json({
      success: true,
      mensaje: `Viaje ${id} y todos sus recursos eliminados correctamente`,
      cambios: result.changes
    });

  } catch (error) {
    console.error(`❌ Error fatal eliminando viaje ${id}:`, error.message);
    res.status(500).json({ error: `Error interno al eliminar viaje: ${error.message}` });
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
            // ✨ FIX: Ignorar si son exactamente el mismo bloque (posible duplicidad)
            if (actual.horaInicio === siguiente.horaInicio && actual.horaFin === siguiente.horaFin) {
              continue;
            }
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

            // ✨ NUEVO: DEDUPLICAR ACTIVIDADES Y ARCHIVOS EN EL MAESTRO
            console.log(`    -> Limpiando duplicados en itinerario fusionado...`);
            const actsMaestro = await new Promise((resolve, reject) => {
              db.all('SELECT * FROM actividades WHERE itinerarioId = ? ORDER BY horaInicio ASC', [itinMaestro.id], (err, rows) => err ? reject(err) : resolve(rows || []));
            });

            const actsVistas = {};
            for (const act of actsMaestro) {
              const key = `${act.nombre || ''}_${act.horaInicio}_${act.horaFin}`.toLowerCase();
              if (!actsVistas[key]) {
                actsVistas[key] = act;
              } else {
                const masterAct = actsVistas[key];
                console.log(`      -> Fusionando actividad duplicada: "${act.nombre}" (ID ${act.id} -> ${masterAct.id})`);

                // Mover archivos evitando duplicados en BD
                const archivosSec = await new Promise((resolve, reject) => {
                  db.all('SELECT * FROM archivos WHERE actividadId = ?', [act.id], (err, rows) => err ? reject(err) : resolve(rows || []));
                });

                for (const f of archivosSec) {
                  const existe = await new Promise((resolve, reject) => {
                    db.get('SELECT id FROM archivos WHERE actividadId = ? AND nombreArchivo = ? AND tipo = ?', [masterAct.id, f.nombreArchivo, f.tipo], (err, row) => err ? reject(err) : resolve(row));
                  });
                  if (existe) {
                    await new Promise((resolve, reject) => {
                      db.run('DELETE FROM archivos WHERE id = ?', [f.id], err => err ? reject(err) : resolve());
                    });
                  } else {
                    await new Promise((resolve, reject) => {
                      db.run('UPDATE archivos SET actividadId = ? WHERE id = ?', [masterAct.id, f.id], err => err ? reject(err) : resolve());
                    });
                  }
                }
                // Eliminar actividad secundaria
                await new Promise((resolve, reject) => {
                  db.run('DELETE FROM actividades WHERE id = ?', [act.id], err => err ? reject(err) : resolve());
                });
              }
            }
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
// UNIFICAR ITINERARIOS DEL MISMO DÍA
// ----------------------------------------
app.post('/viajes/:id/unificar-itinerarios', async (req, res) => {
  const viajeId = req.params.id;
  const { opcion } = req.body; // 'A' (clustering) o 'B' (genérica)

  console.log(`🧹 Iniciando unificación de itinerarios para viaje ${viajeId}. Opción: ${opcion}`);

  try {
    await dbQuery.run('BEGIN TRANSACTION');

    // 1. Obtener todos los itinerarios del viaje
    const itinerarios = await dbQuery.all(
      'SELECT id, fechaInicio FROM ItinerarioGeneral WHERE viajePrevistoId = ? ORDER BY id ASC',
      [viajeId]
    );

    // 2. Agrupar por fecha
    const porFecha = {};
    itinerarios.forEach(it => {
      // Normalizar a YYYY-MM-DD para agrupar
      const fechaNorm = it.fechaInicio ? it.fechaInicio.split('T')[0].split(' ')[0].trim() : 'sin-fecha';
      if (!porFecha[fechaNorm]) porFecha[fechaNorm] = [];
      porFecha[fechaNorm].push(it);
    });

    console.log('📊 Grupos de fechas detectados en backend:', Object.keys(porFecha).map(k => `${k}: ${porFecha[k].length}`));

    let itinerariosProcesados = 0;
    let actividadesCreadas = 0;
    let archivosOmitidos = [];

    for (const fecha in porFecha) {
      const its = porFecha[fecha];
      if (its.length < 2) continue; // No hay duplicados en esta fecha

      const ids = its.map(it => it.id);
      const maestroId = ids[0];
      const secundariosIds = ids.slice(1);

      console.log(`  📅 Procesando fecha ${fecha}. Maestro: ${maestroId}, Secundarios: ${secundariosIds.join(', ')}`);

      // 3. Obtener todas las actividades de estos itinerarios
      const placeholders = ids.map(() => '?').join(',');
      const actividadesRes = await dbQuery.all(
        `SELECT id, horaInicio FROM actividades WHERE itinerarioId IN (${placeholders})`,
        ids
      );

      if (actividadesRes.length === 0) {
        // Si no hay actividades, simplemente borramos los itinerarios secundarios
        const deletePlaceholders = secundariosIds.map(() => '?').join(',');
        await dbQuery.run(
          `DELETE FROM ItinerarioGeneral WHERE id IN (${deletePlaceholders})`,
          secundariosIds
        );
        itinerariosProcesados += secundariosIds.length;
        continue;
      }

      const actIds = actividadesRes.map(a => a.id);
      const actPlaceholders = actIds.map(() => '?').join(',');

      // 4. Obtener todos los archivos de esas actividades
      const archivos = await dbQuery.all(
        `SELECT * FROM archivos WHERE actividadId IN (${actPlaceholders})`,
        actIds
      );

      if (opcion === 'B') {
        // --- OPCIÓN B: Actividad Genérica (00:00 - 23:59) ---
        // Crear una nueva actividad genérica
        const insertAct = await dbQuery.run(
          `INSERT INTO actividades (viajePrevistoId, itinerarioId, tipoActividadId, nombre, descripcion, horaInicio, horaFin, fechaCreacion)
           VALUES (?, ?, (SELECT id FROM TiposActividad LIMIT 1), 'Unificación del Día', 'Actividad generada automáticamente', '00:00', '23:59', datetime('now'))`,
          [viajeId, maestroId]
        );
        const nuevaActId = insertAct.lastID;
        actividadesCreadas++;

        // Mover todos los archivos a la nueva actividad, evadiendo duplicados por nombre
        const nombresEnMaestro = new Set();
        // 1. Ver archivos actuales del maestro (si los hubiera) - FIX: Join con actividades porque archivos no tiene itinerarioId
        const actualesMaestro = await dbQuery.all(
          'SELECT a.nombreArchivo FROM archivos a INNER JOIN actividades act ON a.actividadId = act.id WHERE act.itinerarioId = ?',
          [maestroId]
        );
        actualesMaestro.forEach(a => nombresEnMaestro.add(a.nombreArchivo));

        for (const archivo of archivos) {
          if (nombresEnMaestro.has(archivo.nombreArchivo)) {
            archivosOmitidos.push(archivo.nombreArchivo);
            continue;
          }
          await dbQuery.run('UPDATE archivos SET actividadId = ? WHERE id = ?', [nuevaActId, archivo.id]);
          nombresEnMaestro.add(archivo.nombreArchivo);
        }

        // Migrar también archivos vinculados a las actividades originales si hubiera una tabla de vinculación directa
        // En este esquema, archivos_asociados cuelgan de archivos, así que al mover el archivo, se mueve el conjunto.

      } else {
        // --- OPCIÓN A: Clustering por hora real ---
        // Clasificar archivos por timestamp
        const archivosConHora = archivos.map(f => {
          let mins = 0;
          if (f.horaCaptura && f.horaCaptura.includes(':')) {
            const [h, m] = f.horaCaptura.split(':').map(Number);
            mins = h * 60 + m;
          } else {
            // Fallback: usar horaInicio de la actividad original
            const origAct = actividadesRes.find(a => a.id === f.actividadId);
            if (origAct && origAct.horaInicio && origAct.horaInicio.includes(':')) {
              const [h, m] = origAct.horaInicio.split(':').map(Number);
              mins = h * 60 + m;
            } else {
              mins = 0; // Medianoche si no hay nada
            }
          }
          return { ...f, mins };
        }).sort((a, b) => a.mins - b.mins);

        // Agrupar en clusters (gap > 30 min)
        const clusters = [];
        if (archivosConHora.length > 0) {
          let currentCluster = [archivosConHora[0]];
          for (let i = 1; i < archivosConHora.length; i++) {
            const current = archivosConHora[i];
            const prev = archivosConHora[i - 1];
            if (current.mins - prev.mins > 30) {
              clusters.push(currentCluster);
              currentCluster = [current];
            } else {
              currentCluster.push(current);
            }
          }
          clusters.push(currentCluster);
        }

        // Crear actividades para cada cluster
        for (let i = 0; i < clusters.length; i++) {
          const cluster = clusters[i];
          const first = cluster[0];
          const last = cluster[cluster.length - 1];

          const formatTime = (m) => {
            const hh = Math.floor(m / 60).toString().padStart(2, '0');
            const mm = (m % 60).toString().padStart(2, '0');
            return `${hh}:${mm}`;
          };

          const insertAct = await dbQuery.run(
            `INSERT INTO actividades (viajePrevistoId, itinerarioId, tipoActividadId, nombre, descripcion, horaInicio, horaFin, fechaCreacion)
             VALUES (?, ?, (SELECT id FROM TiposActividad LIMIT 1), ?, 'Cluster detectado por hora', ?, ?, datetime('now'))`,
            [viajeId, maestroId, `Bloque Actividad ${i + 1}`, formatTime(first.mins), formatTime(last.mins)]
          );
          const nuevaActId = insertAct.lastID;
          actividadesCreadas++;

          const clusterFileIds = cluster.map(f => f.id);

          const nombresEnMaestro = new Set();
          // FIX: Join con actividades porque archivos no tiene itinerarioId
          const actualesMaestro = await dbQuery.all(
            'SELECT a.nombreArchivo FROM archivos a INNER JOIN actividades act ON a.actividadId = act.id WHERE act.itinerarioId = ?',
            [maestroId]
          );
          actualesMaestro.forEach(a => nombresEnMaestro.add(a.nombreArchivo));

          for (const f of cluster) {
            if (nombresEnMaestro.has(f.nombreArchivo)) {
              archivosOmitidos.push(f.nombreArchivo);
              continue;
            }
            await dbQuery.run('UPDATE archivos SET actividadId = ? WHERE id = ?', [nuevaActId, f.id]);
            nombresEnMaestro.add(f.nombreArchivo);
          }
        }
      }

      // 5. Limpieza final para esta fecha
      // Borrar las actividades originales
      await dbQuery.run(`DELETE FROM actividades WHERE id IN (${actPlaceholders})`, actIds);

      // Borrar itinerarios secundarios
      const deletePlaceholders = secundariosIds.map(() => '?').join(',');
      await dbQuery.run(
        `DELETE FROM ItinerarioGeneral WHERE id IN (${deletePlaceholders})`,
        secundariosIds
      );

      itinerariosProcesados += secundariosIds.length;
    }

    await dbQuery.run('COMMIT');
    console.log(`✅ Unificación finalizada. Itinerarios eliminados: ${itinerariosProcesados}, Actividades nuevas: ${actividadesCreadas}`);
    res.json({
      success: true,
      itinerariosEliminados: itinerariosProcesados,
      actividadesCreadas: actividadesCreadas,
      archivosOmitidosCount: archivosOmitidos.length,
      listaOmitidos: archivosOmitidos
    });

  } catch (error) {
    console.error('❌ Error en unificar-itinerarios:', error);
    await dbQuery.run('ROLLBACK');
    res.status(500).json({ error: error.message });
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
    ? 'SELECT * FROM ItinerarioGeneral WHERE viajePrevistoId = ? ORDER BY fechaInicio DESC'
    : 'SELECT * FROM ItinerarioGeneral ORDER BY fechaInicio DESC';
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
  console.log('📥 [POST /itinerarios] Datos recibidos:', req.body);

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

  // Validación básica y valores por defecto para campos NOT NULL
  if (!viajePrevistoId || !fechaInicio || !fechaFin) {
    console.error('⚠️ [POST /itinerarios] Faltan campos obligatorios');
    return res.status(400).json({ error: 'viajePrevistoId, fechaInicio y fechaFin son obligatorios' });
  }

  const sql = `INSERT INTO ItinerarioGeneral 
    (viajePrevistoId, fechaInicio, horaInicio, fechaFin, horaFin, duracionDias, destinosPorDia, descripcionGeneral, climaGeneral, tipoDeViaje) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  // Corregido: solo stringify si NO es ya un string
  const destinosJSON = (typeof destinosPorDia === 'string') ? destinosPorDia : JSON.stringify(destinosPorDia || '');

  db.run(
    sql,
    [
      viajePrevistoId,
      fechaInicio,
      horaInicio || '',
      fechaFin,
      horaFin || '',
      duracionDias || 0,
      destinosJSON,
      descripcionGeneral || '',
      climaGeneral || '',
      tipoDeViaje || 'urbana'
    ],
    function (err) {
      if (err) {
        console.error('❌ [POST /itinerarios] Error SQLite:', err.message);
        return res.status(500).json({ error: err.message });
      }
      console.log(`✅ [POST /itinerarios] Creado ID: ${this.lastID}`);
      res.status(201).json({ id: this.lastID });
    }
  );
});

// 4️⃣ PUT actualizar un itinerario existente
app.put('/itinerarios/:id', (req, res) => {
  const { id } = req.params;
  console.log(`📥 [PUT /itinerarios/${id}] Procesando actualización...`);
  console.log('📦 Body:', req.body);

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

  // Corregido: solo stringify si NO es ya un string
  const destinosJSON = (typeof destinosPorDia === 'string') ? destinosPorDia : JSON.stringify(destinosPorDia || '');

  const params = [
    viajePrevistoId,
    fechaInicio,
    horaInicio || '',
    fechaFin,
    horaFin || '',
    duracionDias || 0,
    destinosJSON,
    descripcionGeneral || '',
    climaGeneral || '',
    tipoDeViaje || 'urbana',
    id
  ];

  db.run(
    sql,
    params,
    function (err) {
      if (err) {
        console.error(`❌ [PUT /itinerarios/${id}] Error SQLite:`, err.message);
        return res.status(500).json({ error: err.message });
      }

      console.log(`✅ [PUT /itinerarios/${id}] Cambios realizados: ${this.changes}`);

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Itinerario no encontrado para actualizar' });
      }

      res.json({ changes: this.changes });
    }
  );
});

// 5️⃣ DELETE eliminar un itinerario
app.delete('/itinerarios/:id', async (req, res) => {
  const id = req.params.id;
  try {
    console.log(`🗑️ Eliminando itinerario ${id} integralmente...`);

    // 1. Obtener actividades de este itinerario para poder limpiar sus carpetas físicas
    const actividades = await dbQuery.all('SELECT id, viajePrevistoId FROM actividades WHERE itinerarioId = ?', [id]);

    // 2. Limpieza de Sistema de Archivos
    // Borramos las carpetas específicas de cada actividad dentro de este itinerario
    for (const act of actividades) {
      const actividadFolder = path.join(uploadsPath, act.viajePrevistoId.toString(), act.id.toString());
      if (fs.existsSync(actividadFolder)) {
        try {
          fs.rmSync(actividadFolder, { recursive: true, force: true });
          console.log(`  📂 Carpeta de actividad eliminada: ${actividadFolder}`);
        } catch (e) { console.warn(`  ⚠️ No se pudo eliminar carpeta actividad ${act.id}:`, e.message); }
      }
    }

    // 3. Borrado en BD
    // Gracias al PRAGMA foreign_keys = ON, esto borrará:
    // actividades -> archivos -> archivos_asociados
    const result = await dbQuery.run('DELETE FROM ItinerarioGeneral WHERE id = ?', [id]);

    res.json({
      success: true,
      mensaje: `Itinerario ${id} y todas sus actividades/archivos eliminados correctamente`,
      cambios: result.changes
    });
  } catch (error) {
    console.error(`❌ Error eliminando itinerario ${id}:`, error.message);
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

// ============================================
// ✨ NUEVO: GET actividad individual por ID
// ============================================
app.get('/actividades/:id', (req, res) => {
  const { id } = req.params;

  console.log(`🔍 Obteniendo actividad ID: ${id}`);

  db.get('SELECT * FROM actividades WHERE id = ?', [id], (err, row) => {
    if (err) {
      console.error('❌ Error obteniendo actividad:', err.message);
      return res.status(500).json({ error: err.message });
    }

    if (!row) {
      console.warn('⚠️ Actividad no encontrada:', id);
      return res.status(404).json({ error: 'Actividad no encontrada' });
    }

    console.log('✅ Actividad encontrada:', row.nombre || row.id);
    res.json(row);
  });
});

// ============================================
// ✨ NUEVO: PUT actualizar actividad
// ============================================
app.put('/actividades/:id', (req, res) => {
  const { id } = req.params;
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

  console.log(`🔄 Actualizando actividad ${id}:`, req.body);

  // Construir query dinámica solo con los campos proporcionados
  const campos = [];
  const valores = [];

  if (viajePrevistoId !== undefined) {
    campos.push('viajePrevistoId = ?');
    valores.push(viajePrevistoId);
  }
  if (itinerarioId !== undefined) {
    campos.push('itinerarioId = ?');
    valores.push(itinerarioId);
  }
  if (tipoActividadId !== undefined) {
    campos.push('tipoActividadId = ?');
    valores.push(tipoActividadId);
  }
  if (actividadDisponibleId !== undefined) {
    campos.push('actividadDisponibleId = ?');
    valores.push(actividadDisponibleId);
  }
  if (nombre !== undefined) {
    campos.push('nombre = ?');
    valores.push(nombre);
  }
  if (descripcion !== undefined) {
    campos.push('descripcion = ?');
    valores.push(descripcion);
  }
  if (horaInicio !== undefined) {
    campos.push('horaInicio = ?');
    valores.push(horaInicio);
  }
  if (horaFin !== undefined) {
    campos.push('horaFin = ?');
    valores.push(horaFin);
  }

  // Actualizar fechaActualizacion
  campos.push("fechaActualizacion = datetime('now')");

  if (campos.length === 1) { // Solo fechaActualizacion
    return res.status(400).json({ error: 'No se proporcionaron campos para actualizar' });
  }

  // Agregar ID al final para el WHERE
  valores.push(id);

  const sql = `UPDATE actividades SET ${campos.join(', ')} WHERE id = ?`;

  console.log('📝 SQL:', sql);
  console.log('📝 Valores:', valores);

  db.run(sql, valores, function (err) {
    if (err) {
      console.error('❌ Error actualizando actividad:', err.message);
      return res.status(500).json({ error: err.message });
    }

    if (this.changes === 0) {
      console.warn('⚠️ No se encontró la actividad con ID:', id);
      return res.status(404).json({ error: 'Actividad no encontrada' });
    }

    console.log(`✅ Actividad ${id} actualizada correctamente (${this.changes} cambio(s))`);

    // Devolver la actividad actualizada
    db.get('SELECT * FROM actividades WHERE id = ?', [id], (err, row) => {
      if (err) {
        console.error('❌ Error obteniendo actividad actualizada:', err.message);
        return res.status(500).json({ error: err.message });
      }

      res.json({
        changes: this.changes,
        actividad: row
      });
    });
  });
});

console.log('✅ Endpoints GET /actividades/:id y PUT /actividades/:id registrados correctamente');

// DELETE eliminar actividad
app.delete('/actividades/:id', async (req, res) => {
  const id = req.params.id;

  try {
    console.log(`🗑️ Eliminando actividad ${id} integralmente...`);

    // 1. Obtener datos de la actividad para localizar su carpeta física
    const actividad = await dbQuery.get('SELECT viajePrevistoId FROM actividades WHERE id = ?', [id]);

    if (actividad) {
      // 2. Limpieza de Sistema de Archivos
      // Usamos la estructura: uploads/<viajeId>/<actividadId>
      const actividadFolder = path.join(uploadsPath, actividad.viajePrevistoId.toString(), id.toString());

      if (fs.existsSync(actividadFolder)) {
        try {
          fs.rmSync(actividadFolder, { recursive: true, force: true });
          console.log(`  📂 Carpeta de actividad eliminada (limpieza total): ${actividadFolder}`);
        } catch (e) { console.warn(`  ⚠️ No se pudo eliminar la carpeta física de la actividad ${id}:`, e.message); }
      }
    }

    // 3. Borrado en BD
    // Gracias al PRAGMA foreign_keys = ON, esto borrará:
    // archivos -> archivos_asociados
    const result = await dbQuery.run('DELETE FROM actividades WHERE id = ?', [id]);

    res.json({
      success: true,
      mensaje: `Actividad ${id} y sus archivos eliminados correctamente`,
      cambios: result.changes
    });

  } catch (error) {
    console.error(`❌ Error fatal eliminando actividad ${id}:`, error.message);
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
      horaInicio, horaFin, nombre, descripcion, rutaEstadisticas, rutaManifest
    FROM actividades WHERE id = ?`,
    [id],
    async (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) {
        return res.status(404).json({ error: 'Actividad no encontrada' });
      }

      // Formato de estadísticas base
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
        },
        desgloseTransporte: [] // Por defecto vacío
      };

      // ✨ MEJORADO: Enriquecer con ambos JSONs (manifest y estadísticas)
      const dataExtra = {
        manifest: {},
        stats: {},
        altitud: { min: null, max: null, ganancia: null, perdida: null },
        ritmo: { medio: null, maximo: null },
        detallesApp: { nombre: 'AudioPhotoApp', version: null, dispositivo: null }
      };

      const parseNum = (val) => {
        if (val === undefined || val === null || val === '') return null;
        if (typeof val === 'string') return parseFloat(val.replace(/[^\d.-]/g, '')) || 0;
        return parseFloat(val);
      };

      // 1. Cargar Manifest
      if (row.rutaManifest) {
        try {
          const manifestPath = path.join(uploadsPath, row.rutaManifest);
          if (fs.existsSync(manifestPath)) {
            dataExtra.manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            dataExtra.detallesApp.version = dataExtra.manifest.version || null;
            dataExtra.detallesApp.dispositivo = dataExtra.manifest.dispositivo || null;
          }
        } catch (e) { console.warn('⚠️ Error manifest:', e.message); }
      }

      // 2. Cargar Estadísticas Detalladas
      if (row.rutaEstadisticas) {
        try {
          const statsPath = path.join(uploadsPath, row.rutaEstadisticas);
          if (fs.existsSync(statsPath)) {
            dataExtra.stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));

            // 🔍 DEBUG (Temporal): Ver claves de estadisticas.json
            console.log('📋 CLAVES estadisticas.json:', Object.keys(dataExtra.stats));

            // Extraer Altitud
            dataExtra.altitud.min = parseNum(dataExtra.stats.altitudMinima || dataExtra.stats.altitud_min || dataExtra.stats.min_alt || dataExtra.stats.altitud_minima);
            dataExtra.altitud.max = parseNum(dataExtra.stats.altitudMaxima || dataExtra.stats.altitud_max || dataExtra.stats.max_alt || dataExtra.stats.altitud_maxima);
            dataExtra.altitud.ganancia = parseNum(dataExtra.stats.desnivelPositivo || dataExtra.stats.ganancia_altitud || dataExtra.stats.ascenso || dataExtra.stats.altitude_gain);
            dataExtra.altitud.perdida = parseNum(dataExtra.stats.desnivelNegativo || dataExtra.stats.perdida_altitud || dataExtra.stats.descenso || dataExtra.stats.altitude_loss);

            // Extraer Ritmo (Pace)
            dataExtra.ritmo.medio = dataExtra.stats.ritmoMedio || dataExtra.stats.ritmo_medio || dataExtra.stats.v_pace;
            dataExtra.ritmo.maximo = dataExtra.stats.ritmoMaximo || dataExtra.stats.ritmo_maximo;

            // Extraer Tiempos (NUEVO)
            estadisticas.tiempos = {
              enMarcha: dataExtra.stats.tiempoMarcha || dataExtra.stats.tiempoEnMarcha || dataExtra.stats.en_marcha || dataExtra.stats['En marcha'],
              parado: dataExtra.stats.tiempoParada || dataExtra.stats.tiempoParada || dataExtra.stats.parado || dataExtra.stats['Parado'],
              pausado: dataExtra.stats.tiempoPausa || dataExtra.stats.tiempoPausa || dataExtra.stats.pausado || dataExtra.stats['Pausado']
            };

            // Extraer Ida y Vuelta (NUEVO)
            if (dataExtra.stats.ida || dataExtra.stats.round_trip?.ida || dataExtra.stats['Ida']) {
              const ida = dataExtra.stats.ida || dataExtra.stats.round_trip?.ida || dataExtra.stats['Ida'];
              const vuelta = dataExtra.stats.vuelta || dataExtra.stats.round_trip?.vuelta || dataExtra.stats['Vuelta'];
              estadisticas.idaVuelta = {
                ida: { km: parseNum(ida.km || ida.distancia_km), tiempo: ida.tiempo || ida.duracion_formateada },
                vuelta: { km: parseNum(vuelta.km || vuelta.distancia_km), tiempo: vuelta.tiempo || vuelta.duracion_formateada }
              };
            }

            if (dataExtra.stats.desgloseTransporte) {
              estadisticas.desgloseTransporte = dataExtra.stats.desgloseTransporte;
              console.log(`📊 [DEBUG] Desglose detectado: ${estadisticas.desgloseTransporte.length} segmentos. Claves primer seg: ${Object.keys(estadisticas.desgloseTransporte[0] || {}).join(', ')}`);
            }

            console.log(`📊 [STATS] vMedia: ${dataExtra.stats.velocidadMedia}, vMax: ${dataExtra.stats.velocidadMaxima}`);
          }
        } catch (e) { console.warn('⚠️ Error stats:', e.message); }
      }

      // 3. Fusionar campos en objeto base (PRIORIDAD: JSON > DB)
      const sources = [dataExtra.stats, dataExtra.manifest.estadisticas || {}, dataExtra.manifest];
      const getField = (keys) => {
        for (const src of sources) {
          for (const key of keys) {
            if (src && src[key] !== undefined && src[key] !== null && src[key] !== '') return src[key];
          }
        }
        return null;
      };

      // ✨ PRIORIDAD JSON: Sobrescribir valores del GPX/DB si el JSON tiene datos oficiales (incluso si es 0)
      const jsonVelMedia = parseNum(getField(['velocidadMedia', 'velocidad_media_kmh', 'velocidadMediaKmh', 'v_media', 'velocidad_media', 'avg_speed', 'V. Media', 'avgSpeed']));
      if (jsonVelMedia !== null && !isNaN(jsonVelMedia)) estadisticas.velocidad.media = jsonVelMedia;

      const jsonVelMax = parseNum(getField(['velocidadMaxima', 'velocidad_maxima_kmh', 'velocidadMaximaKmh', 'v_maxima', 'velocidad_maxima', 'max_speed', 'V. Máxima', 'maxSpeed']));
      if (jsonVelMax !== null && !isNaN(jsonVelMax)) estadisticas.velocidad.maxima = jsonVelMax;

      const jsonCalorias = parseInt(parseNum(getField(['calorias', 'calorias_kcal', 'calories', 'cals', 'kcal', 'Calorías'])));
      if (jsonCalorias !== null && !isNaN(jsonCalorias)) estadisticas.energia.calorias = jsonCalorias;

      const jsonPasos = parseInt(getField(['pasos', 'pasos_totales', 'pasos_estimados', 'pasosEstimados', 'num_pasos', 'steps', 'Pasos']));
      if (jsonPasos !== null && !isNaN(jsonPasos)) estadisticas.energia.pasos = jsonPasos;

      const jsonPuntosGPS = parseInt(getField(['puntosGPS', 'numeroPuntos', 'puntos_gps', 'numero_puntos', 'num_puntos', 'log_count', 'points', 'Puntos GPS', 'numLog', 'gps_count', 'logCount']));
      if (jsonPuntosGPS !== null && !isNaN(jsonPuntosGPS)) estadisticas.tracking.puntosGPS = jsonPuntosGPS;

      const jsonDuracion = getField(['tiempoEmpleado', 'duracion_ui', 'tiempo_total', 'tiempoTotal']);
      if (jsonDuracion !== null && jsonDuracion !== '') estadisticas.duracion.formateada = jsonDuracion;

      // ✨ EXTRACCIÓN DE DATOS RICOS: Cadencia, zancada y conteo multimedia
      estadisticas.cadencia = parseInt(getField(['cadencia', 'cadence', 'cadencia_pasos'])) || 0;
      estadisticas.zancada = parseInt(getField(['zancada', 'stride', 'zancada_cm'])) || 0;
      estadisticas.multimedia = {
        fotos: parseInt(getField(['fotos', 'photos'])) || 0,
        videos: parseInt(getField(['videos', 'videos'])) || 0
      };

      // ✨ SEGURO: Si vMax es 0 pero vMedia > 0, usar vMedia como suelo
      if ((!estadisticas.velocidad.maxima || estadisticas.velocidad.maxima === 0) && estadisticas.velocidad.media > 0) {
        estadisticas.velocidad.maxima = estadisticas.velocidad.media;
        console.log(`⚖️ [FLOOR] Aplicando suelo de velocidad media a máxima: ${estadisticas.velocidad.maxima}`);
      }

      // ✨ FALLBACK: Si sigue siendo 0, intentar contar puntos en el GPX real
      if (estadisticas.tracking.puntosGPS === 0 && row.rutaManifest) {
        try {
          // rutaManifest: '101/170/metadata/manifest.json'
          const manifestDir = path.dirname(row.rutaManifest); // '101/170/metadata'
          const actividadDir = path.dirname(manifestDir);   // '101/170'
          const gpxPath = path.join(uploadsPath, actividadDir, 'gpx', 'recorrido.gpx');

          console.log(`🔍 [FALLBACK] Buscando GPX para contar puntos en: ${gpxPath}`);

          if (fs.existsSync(gpxPath)) {
            const gpxContent = fs.readFileSync(gpxPath, 'utf8');
            const pointCount = (gpxContent.match(/<trkpt/g) || []).length;
            if (pointCount > 0) {
              estadisticas.tracking.puntosGPS = pointCount;
              console.log(`📊 [FALLBACK] Puntos GPS calculados: ${pointCount}`);
            }
          }
        } catch (e) { console.warn('⚠️ [FALLBACK] Error contando puntos GPX:', e.message); }
      }

      // 4. Normalizar Desglose (Evitar NaN en frontend)
      if (estadisticas.desgloseTransporte && Array.isArray(estadisticas.desgloseTransporte)) {
        estadisticas.desgloseTransporte = estadisticas.desgloseTransporte.map(seg => ({
          nombre: seg.nombre || 'Desconocido',
          distanciaKm: parseNum(seg.km || seg.distanciaKm || seg.distancia_km || seg.distancia || 0),
          duracionFormateada: seg.tiempoEmpleado || seg.duracionFormateada || seg.duracion_formateada || seg.tiempo || seg.duracion || '00:00:00'
        }));
      }

      // Añadir data extra y info de depuración
      estadisticas.altitud = dataExtra.altitud;
      estadisticas.ritmo = dataExtra.ritmo;
      estadisticas.app = dataExtra.detallesApp;
      estadisticas.debug = {
        calculoPuntosGPS: estadisticas.tracking.puntosGPS > 0 ? 'Exitoso' : 'Fallo',
        puntosContados: estadisticas.tracking.puntosGPS
      };
      estadisticas.raw = {
        manifest: dataExtra.manifest,
        stats: dataExtra.stats
      };

      res.json(estadisticas);
    }
  );
});

// GET Visual Session JSON de una actividad (Modo Alta Fidelidad)
app.get('/actividades/:id/visual-session', (req, res) => {
  const id = req.params.id;

  db.get(
    'SELECT rutaVisualSession FROM actividades WHERE id = ?',
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row || !row.rutaVisualSession) {
        return res.status(404).json({ error: 'visual_session.json no disponible para esta actividad' });
      }

      const filePath = path.join(uploadsPath, row.rutaVisualSession);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Archivo visual_session.json no existe en disco' });
      }

      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        res.json(data);
      } catch (parseErr) {
        console.error('❌ [visual-session] Error parseando JSON:', parseErr.message);
        res.status(500).json({ error: 'El archivo visual_session.json está corrupto' });
      }
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
  const { actividadId } = req.query
  let sql = 'SELECT * FROM archivos'
  let params = []

  if (actividadId) {
    // Si actividadId es "0", buscar donde es NULL
    if (actividadId === "0") {
      sql += ' WHERE actividadId IS NULL'
    } else {
      sql += ' WHERE actividadId = ?'
      params.push(actividadId)
    }
  }

  sql += ' ORDER BY fechaCreacion DESC'

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message })

    // ✅ NORMALIZACIÓN: Devolver 0 si actividadId es null
    const rowsNormalizadas = rows.map(r => ({
      ...r,
      actividadId: r.actividadId === null ? 0 : r.actividadId
    }));

    console.log(`[GET /archivos] Devolviendo ${rowsNormalizadas.length} archivos`)
    res.json(rowsNormalizadas)
  })
})


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

    // ✅ NORMALIZACIÓN
    const rowsNormalizadas = rows.map(r => ({
      ...r,
      actividadId: r.actividadId === null ? 0 : r.actividadId
    }));

    console.log(`✅ Encontrados ${rowsNormalizadas.length} archivos para itinerario ${itinerarioId}`);
    res.json(rowsNormalizadas);
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

    // ✅ NORMALIZACIÓN
    const rowsNormalizadas = rows.map(r => ({
      ...r,
      actividadId: r.actividadId === null ? 0 : r.actividadId
    }));

    console.log(`✅ Encontrados ${rowsNormalizadas.length} archivos para viaje ${viajeId}`);
    res.json(rowsNormalizadas);
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

app.post('/archivos', async (req, res) => {
  // ✅ AÑADIR fechaCreacion aquí también
  const {
    actividadId, tipo, nombreArchivo, rutaArchivo, descripcion,
    horaCaptura, version, geolocalizacion, metadatos, fechaCreacion
  } = req.body;

  console.log('📝 Creando archivo individual con fechaCreacion:', fechaCreacion);

  // ✅ NORMALIZACIÓN: Tratar "0" o 0 como NULL
  const actId = (actividadId !== undefined && actividadId !== null && actividadId !== "0" && actividadId !== 0) ? actividadId : null;

  // Log de geolocalizacion y metadatos recibidos
  console.log('🐾 Geolocalización recibida para guardar:', geolocalizacion);
  console.log('🐾 Metadatos recibidos para guardar:', metadatos ? (typeof metadatos === 'string' ? metadatos.substring(0, 500) : JSON.stringify(metadatos).substring(0, 500)) : null);

  // ✅ DETERMINAR FECHA DE CREACIÓN
  const fechaFinal = fechaCreacion ? new Date(fechaCreacion).toISOString() : new Date().toISOString();

  try {
    // FIX DUPLICADOS 2026 — Inserción idempotente con ON CONFLICT
    const result = await dbQuery.run(
      `INSERT INTO archivos 
      (actividadId, tipo, nombreArchivo, rutaArchivo, descripcion, horaCaptura, version, geolocalizacion, metadatos, fechaCreacion)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(actividadId, nombreArchivo) DO NOTHING`,
      [
        actId, tipo, nombreArchivo, rutaArchivo,
        descripcion || null, horaCaptura || null, version || 1,
        geolocalizacion || null, metadatos || null, fechaFinal
      ]
    );

    // FIX DUPLICADOS 2026 — Detectar si fue duplicado
    if (result.changes === 0) {
      console.log(`⚠️ [DUPLICADO] Archivo "${nombreArchivo}" ya existe en actividad ${actId}, ignorado.`);
      res.status(200).json({ id: null, duplicado: true, mensaje: 'Archivo ya existe en esta actividad' });
    } else {
      console.log('✅ Archivo creado con ID:', result.lastID, 'y fechaCreacion:', fechaFinal);
      res.status(201).json({ id: result.lastID, fechaCreacion: fechaFinal });
    }
  } catch (err) {
    console.error('❌ Error creando archivo:', err);
    res.status(500).json({ error: err.message });
  }
});


app.put('/archivos/:id/archivo', upload.single('archivo'), async (req, res) => {
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

  if (actividadId !== undefined) {
    campos.push('actividadId = ?');
    const actId = (actividadId !== null && actividadId !== "0" && actividadId !== 0) ? actividadId : null;
    valores.push(actId);
  }
  if (tipo !== undefined) { campos.push('tipo = ?'); valores.push(tipo); }
  if (descripcion !== undefined) { campos.push('descripcion = ?'); valores.push(descripcion); }
  if (horaCaptura !== undefined) { campos.push('horaCaptura = ?'); valores.push(horaCaptura); }
  if (version !== undefined) { campos.push('version = ?'); valores.push(version); }
  if (geolocalizacion !== undefined) { campos.push('geolocalizacion = ?'); valores.push(geolocalizacion); }
  if (metadatos !== undefined) { campos.push('metadatos = ?'); valores.push(metadatos); }

  campos.push("fechaActualizacion = datetime('now')");
  campos.push("transcripcion_raw = NULL"); // Invalidad transcripción si cambia el archivo
  valores.push(id);

  try {
    const sql = `UPDATE archivos SET ${campos.join(', ')} WHERE id = ?`;
    const result = await dbQuery.run(sql, valores);
    res.json({ updated: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/archivos/:id', async (req, res) => {
  const id = req.params.id;
  const { actividadId, tipo, nombreArchivo, descripcion, horaCaptura, version, geolocalizacion, metadatos, fechaCreacion } = req.body;

  // Logs para ver datos antes de actualizar
  console.log('🐾 Actualizando archivo con geolocalizacion:', geolocalizacion);
  console.log('🐾 Actualizando archivo con metadatos:', metadatos ? (typeof metadatos === 'string' ? metadatos.substring(0, 500) : JSON.stringify(metadatos).substring(0, 500)) : null);

  const campos = [];
  const valores = [];

  if (actividadId !== undefined) {
    campos.push('actividadId = ?');
    const actId = (actividadId !== null && actividadId !== "0" && actividadId !== 0) ? actividadId : null;
    valores.push(actId);
  }
  if (tipo !== undefined) { campos.push('tipo = ?'); valores.push(tipo); }
  if (nombreArchivo !== undefined) { campos.push('nombreArchivo = ?'); valores.push(nombreArchivo); }
  if (descripcion !== undefined) { campos.push('descripcion = ?'); valores.push(descripcion); }
  if (horaCaptura !== undefined) { campos.push('horaCaptura = ?'); valores.push(horaCaptura); }
  if (version !== undefined) { campos.push('version = ?'); valores.push(version); }
  if (geolocalizacion !== undefined) { campos.push('geolocalizacion = ?'); valores.push(geolocalizacion); }
  if (metadatos !== undefined) { campos.push('metadatos = ?'); valores.push(metadatos); }
  if (fechaCreacion !== undefined) { campos.push('fechaCreacion = ?'); valores.push(fechaCreacion); }

  campos.push("fechaActualizacion = datetime('now')");
  campos.push("transcripcion_raw = NULL"); // Invalidad transcripción en actualización de metadatos
  valores.push(id);

  const sql = `UPDATE archivos SET ${campos.join(', ')} WHERE id = ?`;

  console.log('📝 Ejecutando UPDATE con:', { sql, valores }); // Debug

  try {
    const result = await dbQuery.run(sql, valores);
    console.log('✅ Resultado UPDATE:', { changes: result.changes });

    if (result.changes === 0) {
      console.warn('⚠️ No se actualizó ningún registro. Posibles causas: ID no existe o datos idénticos.');
    }

    res.json({
      updated: result.changes,
      id: id,
      cambiosRealizados: campos.filter(c => !c.includes('fechaActualizacion'))
    });
  } catch (err) {
    console.error('❌ Error en UPDATE:', err);
    res.status(500).json({ error: err.message });
  }
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
  let insertados = 0;  // FIX DUPLICADOS 2026
  let duplicados = 0;  // FIX DUPLICADOS 2026

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

      // ✅ NORMALIZACIÓN: Tratar "0" o 0 del frontend como NULL (sin asignación)
      const inputActividadId = (actividadId !== undefined && actividadId !== null && actividadId !== "0" && actividadId !== 0) ? actividadId : null;
      const inputActividadSeleccionada = (actividadSeleccionada !== undefined && actividadSeleccionada !== null && actividadSeleccionada !== "0" && actividadSeleccionada !== 0) ? actividadSeleccionada : null;

      if (inputActividadId) {
        actividadFinal = inputActividadId;
        console.log(`📌 Asignando archivo a actividadId del frontend: ${actividadFinal}`);
        console.log('📝 Usuario NO seleccionó actividad manualmente, se usa actividadId por defecto');
      } else if (inputActividadSeleccionada) {
        actividadFinal = inputActividadSeleccionada;
        console.log(`📌 Asignando archivo a actividadSeleccionada enviada por frontend: ${actividadFinal}`);
        console.log('📝 Usuario SÍ seleccionó actividad manualmente');
      } else {
        if (!actividadesCoincidentes?.length) {
          console.log(`❌ No hay coincidencias para asignar automáticamente, se guardará sin asignar.`);
          actividadFinal = null;
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

      console.log('🐾 Geolocalización que se va a guardar (string JSON con coordenadas):', geolocalizacionFinal);
      console.log('🐾 Metadatos completos que se va a guardar:', JSON.stringify(metadatos).substring(0, 500));

      // FIX DUPLICADOS 2026 — Inserción idempotente con ON CONFLICT
      const result = await dbQuery.run(
        `INSERT INTO archivos 
          (actividadId, tipo, nombreArchivo, rutaArchivo, descripcion, horaCaptura, geolocalizacion, metadatos, fechaCreacion) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(actividadId, nombreArchivo) DO NOTHING`,
        [
          actividadFinal,
          tipo || archivo.mimetype.split('/')[0],
          archivo.originalname,
          archivo.filename,
          descripcion || '',
          horaCaptura || horaExif || new Date().toISOString(),
          geolocalizacionFinal,
          JSON.stringify(metadatos),
          fechaCreacionFinal
        ]
      );

      // FIX DUPLICADOS 2026 — Detectar duplicado y limpiar archivo huérfano
      if (result.changes === 0) {
        console.log(`⚠️ [DUPLICADO] ${archivo.originalname} ya existe en actividad ${actividadFinal}, ignorado.`);
        // Limpiar archivo físico huérfano (multer ya lo guardó en disco)
        try { fs.unlinkSync(path.join(uploadsPath, archivo.filename)); } catch (e) { /* ignorar */ }
        duplicados++;
        resultados.push({
          nombre: archivo.originalname,
          estado: 'duplicado',
          actividadId: actividadFinal || 0,
          mensaje: 'Archivo ya existe en esta actividad'
        });
      } else {
        console.log(`✅ Archivo guardado con ID: ${result.lastID} y actividadId: ${actividadFinal}`);

        // ✨ NUEVO: Si es vídeo, generar miniatura
        if (tipo === 'video' || archivo.mimetype.startsWith('video/')) {
          generarMiniaturaVideo(result.lastID, path.join(uploadsPath, archivo.filename), (thumbPath) => {
            if (thumbPath) {
              db.run("UPDATE archivos SET urlPoster = ? WHERE id = ?", [thumbPath, result.lastID]);
            }
          });
        }

        insertados++;
        resultados.push({
          id: result.lastID,
          nombre: archivo.originalname,
          estado: 'subido',
          actividadId: actividadFinal || 0,
          fechaCreacion: fechaCreacionFinal,
          geolocalizacion: geolocalizacionFinal,
          metadatos: Object.keys(metadatos).length > 0 ? metadatos : null
        });
      }

    } catch (error) {
      console.error(`❌ Error procesando ${archivo?.originalname}:`, error);
      resultados.push({
        nombre: archivo?.originalname || 'desconocido',
        estado: 'error',
        error: error.message
      });
    }
  }

  // FIX DUPLICADOS 2026 — Respuesta enriquecida con conteo de duplicados
  console.log(`\n🏁 Subida completada. Insertados: ${insertados}, Duplicados: ${duplicados}, Total procesados: ${resultados.length}`);
  console.log('🔍 Detalle de resultados:', resultados);
  res.status(201).json({
    success: true,
    insertados,
    duplicados,
    archivos: resultados
  });
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

      // 3️⃣ Intentar extraer fecha del nombre (v2 mejorada)
      let match;
      let extractMode = null;

      // a) Timestamp (13 dígitos al inicio)
      if (match = archivo.nombreArchivo.match(/^(\d{13})/)) {
        fechaCaptura = new Date(parseInt(match[1]));
        extractMode = "Timestamp";
      }
      // b) Formato Espacio/Punto: 2014-11-15 12.25.30
      else if (match = archivo.nombreArchivo.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2})\.(\d{2})\.(\d{2})/)) {
        const d = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
        if (d[1] >= 1 && d[1] <= 12 && d[2] >= 1 && d[2] <= 31) {
          fechaCaptura = new Date(d[0], d[1] - 1, d[2], parseInt(match[4]), parseInt(match[5]), parseInt(match[6]));
          extractMode = "Space/Dot";
        }
      }
      // c) Estilo WhatsApp: IMG-20141115-WA0014
      else if (match = archivo.nombreArchivo.match(/IMG-(\d{4})(\d{2})(\d{2})-WA/)) {
        fechaCaptura = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]), 12, 0, 0);
        extractMode = "WhatsApp";
      }
      // d) Estilo Guión Bajo (Estándar): IMG_20220129_134353
      else if (match = archivo.nombreArchivo.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/)) {
        const d = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
        if (d[1] >= 1 && d[1] <= 12 && d[2] >= 1 && d[2] <= 31) {
          fechaCaptura = new Date(d[0], d[1] - 1, d[2], parseInt(match[4]), parseInt(match[5]), parseInt(match[6]));
          extractMode = "Underscore";
        }
      }
      // e) Dígitos continuos (14 dígitos): 20250501143632
      else if (match = archivo.nombreArchivo.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/)) {
        const d = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
        if (d[1] >= 1 && d[1] <= 12 && d[2] >= 1 && d[2] <= 31) {
          fechaCaptura = new Date(d[0], d[1] - 1, d[2], parseInt(match[4]), parseInt(match[5]), parseInt(match[6]));
          extractMode = "Continuous";
        }
      }
      // f) Fecha con guiones solamente: 2014-11-15
      else if (match = archivo.nombreArchivo.match(/(\d{4})-(\d{2})-(\d{2})/)) {
        const d = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
        if (d[1] >= 1 && d[1] <= 12 && d[2] >= 1 && d[2] <= 31) {
          fechaCaptura = new Date(d[0], d[1] - 1, d[2], 12, 0, 0);
          extractMode = "HyphenDate";
        }
      }
      // g) Solo 8 dígitos (Fecha): 20141115
      else if (match = archivo.nombreArchivo.match(/(\d{4})(\d{2})(\d{2})/)) {
        const d = [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
        if (d[1] >= 1 && d[1] <= 12 && d[2] >= 1 && d[2] <= 31) {
          fechaCaptura = new Date(d[0], d[1] - 1, d[2], 12, 0, 0);
          extractMode = "8-Digits";
        }
      }

      if (fechaCaptura) {
        ultimaFechaExtraida = fechaCaptura;
        console.log(`✅ Fecha extraída (${extractMode}) de ${archivo.nombreArchivo}:`, fechaCaptura);
      } else if (ultimaFechaExtraida) {
        // 4️⃣ Si no se pudo extraer, usar la última fecha válida
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

// ============================================
// ✨ NUEVO ENDPOINT: Actualizar actividadId masivamente
// ============================================

/**
 * POST /archivos/actualizar-actividad-masiva
 * Actualiza la actividadId de múltiples archivos de una sola vez
 * Body: { archivosIds: number[], nuevaActividadId: number }
 */
app.post('/archivos/actualizar-actividad-masiva', (req, res) => {
  const { archivosIds, nuevaActividadId } = req.body;

  console.log(`\n🔄 =============== ACTUALIZACIÓN MASIVA DE ACTIVIDAD ===============`);
  console.log(`📦 Archivos a actualizar: ${archivosIds?.length || 0}`);
  console.log(`🎯 Nueva actividadId: ${nuevaActividadId}`);

  // Validaciones
  if (!archivosIds || !Array.isArray(archivosIds) || archivosIds.length === 0) {
    return res.status(400).json({
      error: 'Se requiere un array de archivosIds no vacío'
    });
  }

  if (!nuevaActividadId || isNaN(Number(nuevaActividadId))) {
    return res.status(400).json({
      error: 'Se requiere una nuevaActividadId válida'
    });
  }

  // Construir consulta SQL con placeholders
  const placeholders = archivosIds.map(() => '?').join(',');
  const sql = `UPDATE archivos SET actividadId = ?, fechaActualizacion = datetime('now') WHERE id IN (${placeholders})`;

  // Parámetros: [nuevaActividadId, ...archivosIds]
  const params = [nuevaActividadId, ...archivosIds];

  console.log('📝 Ejecutando actualización masiva...');

  db.run(sql, params, function (err) {
    if (err) {
      console.error('❌ Error en actualización masiva:', err.message);
      return res.status(500).json({ error: err.message });
    }

    console.log(`✅ Actualización completada: ${this.changes} archivo(s) actualizado(s)`);

    res.json({
      actualizados: this.changes,
      mensaje: `${this.changes} archivo(s) reasignado(s) a la actividad ${nuevaActividadId}`
    });
  });
});

console.log('✅ Endpoint de actualización masiva de actividad registrado correctamente');

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
    console.log(`📁 [MULTER] Procesando destino para: ${file.originalname}`);
    const tempPath = path.join(uploadsPath, 'temp-imports');
    if (!fs.existsSync(tempPath)) {
      fs.mkdirSync(tempPath, { recursive: true });
    }
    cb(null, tempPath);
  },
  filename: (req, file, cb) => {
    try {
      // ✅ CRÍTICO: Decodificar nombres de archivo URL-encoded del File System Access API
      // Los nombres vienen como: "tree/primary%3ADocuments%2FAudioPhotoApp/document/primary%3ADocuments%2FAudioPhotoApp%2Frecorrido.gpx"
      // Necesitamos extraer solo el nombre del archivo: "recorrido.gpx"

      let decodedName = decodeURIComponent(file.originalname);
      console.log(`🔍 [MULTER] Nombre original: ${file.originalname}`);
      console.log(`🔍 [MULTER] Nombre decodificado: ${decodedName}`);

      // Extraer solo el basename (último segmento después de /)
      const basename = path.basename(decodedName);
      console.log(`🔍 [MULTER] Basename extraído: ${basename}`);

      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const filename = uniqueSuffix + '-' + basename;
      console.log(`📝 [MULTER] Guardando archivo como: ${filename}`);

      cb(null, filename);
    } catch (error) {
      console.error(`❌ [MULTER] Error procesando nombre de archivo:`, error);
      // Fallback: usar un nombre genérico si falla la decodificación
      const fallbackName = Date.now() + '-' + Math.round(Math.random() * 1E9) + '-file';
      cb(null, fallbackName);
    }
  }
});

const importUpload = multer({
  storage: importStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // ✅ AUMENTAR a 5 GB por archivo
    files: 500, // ✅ AUMENTAR de 200 a 500
    fieldSize: 5 * 1024 * 1024 * 1024,
    parts: 1000 // ✅ AUMENTAR de 500 a 1000 (partes totales)
  }
});

console.log('🔧 [DEBUG] Antes de registrar endpoint:');
console.log('   importUpload:', typeof importUpload);
console.log('   importUpload.any:', typeof importUpload?.any);

console.log('✅ [DEBUG] importUpload creado correctamente');
console.log('   Tipo:', typeof importUpload);
console.log('   Método any():', typeof importUpload.any);

// (Preflight manejado por global cors())

/**
 * POST /api/import-tracking
 * Importa un tracking completo desde AudioPhotoApp
 * Recibe: FormData con archivos + metadata
 */
// ✅ DESPUÉS (CORRECTO - CORS manejado globalmente)
app.post('/import-tracking', (req, res, next) => {

  console.log('\n🔍 [DEBUG] Middleware ejecutado - Antes de multer');
  console.log('   Content-Type:', req.headers['content-type']);
  console.log('   Method:', req.method);
  console.log('   URL:', req.url);
  console.log('   Content-Length:', req.headers['content-length']);

  // ✅ AUMENTAR TIMEOUT: 30 minutos para archivos grandes
  req.setTimeout(30 * 60 * 1000); // 30 minutos
  res.setTimeout(30 * 60 * 1000);

  let filesProcessed = 0;
  const startTime = Date.now();

  // Interceptar el stream para trackear progreso
  const originalOn = req.on.bind(req);
  req.on = function (event, handler) {
    if (event === 'file') {
      return originalOn(event, function (...args) {
        filesProcessed++;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`📦 [MULTER PROGRESS] Archivo ${filesProcessed} procesado (${elapsed}s)`);
        return handler.apply(this, args);
      });
    }
    return originalOn(event, handler);
  };

  importUpload.any()(req, res, (err) => {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n🔍 [DEBUG] Después de multer (${totalTime}s)`);
    console.log('   Error multer:', err || 'ninguno');
    console.log('   Files:', req.files?.length || 0);
    console.log('   Body keys:', Object.keys(req.body || {}));

    if (err) {
      console.error('❌ [MULTER] Error:', err.message);
      console.error('   Stack:', err.stack);
      return res.status(500).json({ error: err.message });
    }

    next();
  });
}, async (req, res) => {
  // Las cabeceras CORS ya están puestas en el middleware anterior
  req.setTimeout(600000);
  res.setTimeout(600000);

  console.log('\n🚀 =============== IMPORTACIÓN DE TRACKING ===============');
  console.log('📦 Archivos recibidos:', req.files?.length || 0);

  // 🔍 DEBUG: Ver exactamente qué nombres de archivo llegan
  if (req.files) {
    req.files.forEach((f, idx) => {
      console.log(`  [FILE ${idx}] originalname: "${f.originalname}" (decoded: "${decodeURIComponent(f.originalname)}")`);
    });
  }

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

    // 2. BUSCAR Y PARSEAR manifest.json Y estadisticas.json
    // ✨ MEJORADO: Decodificar y usar path.basename para ignorar rutas si vienen del móvil
    const manifestFile = req.files.find(f => path.basename(decodeURIComponent(f.originalname)) === 'manifest.json');
    if (!manifestFile) {
      throw new Error('No se encontró manifest.json en los archivos');
    }

    manifestData = JSON.parse(fs.readFileSync(manifestFile.path, 'utf8'));
    console.log('✅ Manifest parseado:', manifestData.nombre);

    // ✨ NUEVO: Intentar leer estadísticas adicionales de estadisticas.json si viene en el upload
    let extraStatsData = {};
    const statsUploadedFile = req.files.find(f => path.basename(decodeURIComponent(f.originalname)) === 'estadisticas.json');
    if (statsUploadedFile) {
      try {
        extraStatsData = JSON.parse(fs.readFileSync(statsUploadedFile.path, 'utf8'));
        console.log('✅ estadisticas.json parseado del upload');
      } catch (e) {
        console.warn('⚠️ Error parseando estadisticas.json (ignorado):', e.message);
      }
    }

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
        const fotoFile = req.files.find(f => path.basename(decodeURIComponent(f.originalname)) === nombreCompletoMedia);

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

    // ✨ MEJORADO: Fusión profunda y selectores inteligentes para estadísticas
    // Buscamos en: 1. estadisticas.json (si existe), 2. manifest.estadisticas, 3. manifest (raíz)
    const getDeepStat = (keys) => {
      const sources = [
        extraStatsData,
        manifestData.estadisticas || {},
        manifestData
      ];
      for (const source of sources) {
        for (const key of keys) {
          if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
            return source[key];
          }
        }
      }
      return null;
    };

    // Limpiador numérico (quita " km/h", " kcal", etc.)
    const parseNum = (val) => {
      if (val === undefined || val === null) return 0;
      if (typeof val === 'string') {
        const cleaned = val.replace(/[^\d.]/g, '');
        return parseFloat(cleaned) || 0;
      }
      return parseFloat(val) || 0;
    };

    // Extraer datos con prioridades y alias
    const distKm = parseNum(getDeepStat(['km', 'distancia_km', 'distanciaKm', 'distancia_recorrida']));
    const duracionFmt = getDeepStat(['tiempoEmpleado', 'duracion_formateada', 'duracionFormateada', 'duracion_total', 'tiempo_total']) || '00:00:00';
    const velMedia = parseNum(getDeepStat(['velocidadMedia', 'velocidad_media_kmh', 'velocidadMediaKmh', 'velocidad_media', 'v_media']));
    const velMax = parseNum(getDeepStat(['velocidadMaxima', 'velocidad_maxima_kmh', 'velocidadMaximaKmh', 'velocidad_maxima', 'v_maxima']));
    const velMin = parseNum(getDeepStat(['velocidadMinima', 'velocidad_minima_kmh', 'velocidadMinimaKmh', 'velocidad_minima', 'v_minima']));
    const cals = parseInt(parseNum(getDeepStat(['calorias', 'calories', 'cals']))) || 0;
    const pasos = parseInt(getDeepStat(['pasos', 'pasos_estimados', 'pasosEstimados', 'num_pasos'])) || 0;
    const distMetros = parseInt(getDeepStat(['distanciaMetros', 'distancia_metros'])) || (distKm * 1000);
    const duracionSegs = parseInt(getDeepStat(['duracionSegundos', 'duracion_segundos', 'duracionEfectivaSegundos', 'segundos_totales'])) || 0;
    const ptsGPS = parseInt(getDeepStat(['numeroPuntos', 'puntosGPS', 'puntos_gps', 'numero_puntos', 'num_puntos'])) || 0;

    // ✨ Perfil de transporte (puede ser objeto o ID)
    const rawTransporte = getDeepStat(['perfilTransporte', 'perfil_transporte']);
    const perfilTransporteId = (typeof rawTransporte === 'object' && rawTransporte !== null)
      ? rawTransporte.id
      : (rawTransporte || 'unknown');

    // ✨ Desglose por transporte (lo sacamos preferiblemente de estadisticas.json)
    const desglose = getDeepStat(['desgloseTransporte']) || [];
    let desgloseTxt = '';
    if (desglose.length > 0) {
      desgloseTxt = '\n🚲 Desglose transporte:';
      desglose.forEach(d => {
        const dKm = d.km || d.distancia_km || d.distanciaKm || (d.distancia_metros ? (d.distancia_metros / 1000).toFixed(2) : (d.distanciaMetros / 1000).toFixed(2));
        const dDur = d.duracion_formateada || d.duracionFormateada || d.tiempoEmpleado || d.tiempo || d.duracion;
        desgloseTxt += `\n  - ${d.nombre}: ${dKm} km (${dDur})`;
      });
    }

    const descripcionActividad = `Distancia: ${distKm} km
  Duración: ${duracionFmt}
  Velocidad media: ${velMedia} km/h
  Calorías: ${cals} kcal
  Pasos: ${pasos}${desgloseTxt}`;

    let rutaGpxCompleto = null;
    let rutaMapaCompleto = null;
    let rutaManifest = null;
    let rutaEstadisticas = null;
    let rutaVisualSession = null;

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
          rutaGpxCompleto, rutaMapaCompleto, rutaManifest, rutaEstadisticas, rutaVisualSession,
          fechaCreacion, fechaActualizacion) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          viajeId,
          itinerarioId,
          tipoActividadId,
          `${manifestData.nombre} - ${manifestData.perfil_transporte?.nombre || 'Actividad'}`,
          descripcionActividad,
          horaInicioActividad,
          horaFinActividad,
          distKm,
          distMetros,
          duracionSegs,
          duracionFmt,
          velMedia,
          velMax,
          velMin,
          cals,
          pasos,
          ptsGPS,
          perfilTransporteId,
          rutaGpxCompleto,
          rutaMapaCompleto,
          rutaManifest,
          rutaEstadisticas,
          rutaVisualSession,
          fechaCreacionActividad,
          fechaActualizacionActividad
        ],
        function (err) {
          if (err) return reject(err);
          console.log('✅ Actividad creada con ID:', this.lastID);
          console.log(`📊 Estadísticas guardadas:
      ✓ Distancia: ${distKm} km
      ✓ Velocidad media: ${velMedia} km/h
      ✓ Calorías: ${cals} kcal
      ✓ Pasos: ${pasos}`);
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

      const mediaTipoNorm = (media.tipo || '').toLowerCase().trim();

      // Mapeo robusto de carpetas y extensiones
      let tipoFolder = 'videos';
      let extensionMedia = 'mp4';
      let dbTipo = 'video'; // Para la base de datos (según constraint CHECK)

      if (mediaTipoNorm.includes('foto') || mediaTipoNorm.includes('imagen') || mediaTipoNorm.includes('image') || mediaTipoNorm.includes('photo')) {
        tipoFolder = 'fotos';
        extensionMedia = 'jpg';
        dbTipo = 'foto';
      } else if (mediaTipoNorm.includes('audio') || mediaTipoNorm.includes('sonido') || mediaTipoNorm.includes('recording') || mediaTipoNorm.includes('voice')) {
        tipoFolder = 'audios';
        extensionMedia = 'wav';
        dbTipo = 'audio';
      }

      let nombreCompletoMedia = media.nombre;
      if (!nombreCompletoMedia.toLowerCase().endsWith('.' + extensionMedia)) {
        nombreCompletoMedia += '.' + extensionMedia;
      }

      // Usar findIndex para poder guardar el índice del archivo usado
      const mediaFileIndex = req.files.findIndex((f, index) => {
        if (usedFileIndices.has(index)) return false; // Saltarse archivos ya usados

        const baseName = path.basename(decodeURIComponent(f.originalname));
        return baseName.toLowerCase() === nombreCompletoMedia.toLowerCase();
      });

      if (mediaFileIndex === -1) {
        console.warn(`⚠️ Archivo no encontrado para media item: ${media.nombre} (.${extensionMedia})`);
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

      const nombreBaseMedia = path.basename(decodeURIComponent(mediaFile.originalname));
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

      // FIX DUPLICADOS 2026 — ON CONFLICT para import desde móvil
      const archivoId = await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO archivos 
            (actividadId, tipo, nombreArchivo, rutaArchivo, horaCaptura, geolocalizacion, metadatos, fechaCreacion) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(actividadId, nombreArchivo) DO NOTHING`,
          [
            actividadId,
            dbTipo,
            path.basename(decodeURIComponent(mediaFile.originalname)),
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

      archivosCreados.push({ id: archivoId, nombre: path.basename(decodeURIComponent(mediaFile.originalname)) });
      console.log(`✅ ${media.tipo} procesado: ${media.nombre}`);
      console.log(`   Fecha guardada: ${fechaCreacionMedia}`);

      // AUDIO ASOCIADO (MODIFIED)
      let audioFile = null;
      let audioFileName = null;

      // Solo buscar audio asociado si el item principal NO es un audio
      if (dbTipo !== 'audio') {
        const baseName = media.nombre;
        const nameWithoutExt = baseName.includes('.') ? baseName.split('.').slice(0, -1).join('.') : baseName;

        // 1. Intentar desde el manifest (media.audio)
        if (media.audio) {
          const expectedAudioName = path.basename(media.audio);
          const idx = req.files.findIndex((f, i) => !usedFileIndices.has(i) && f.originalname === expectedAudioName);
          if (idx !== -1) {
            audioFile = req.files[idx];
            usedFileIndices.add(idx);
          }
        }

        // 2. Fallback: Buscar por nombre coincidente
        if (!audioFile) {
          const idx = req.files.findIndex((f, i) => {
            if (usedFileIndices.has(i)) return false;
            const fName = path.basename(decodeURIComponent(f.originalname));
            return (fName === `${nameWithoutExt}.wav` || fName === `${nameWithoutExt}.mp3` ||
              fName === `${baseName}.wav` || fName === `${baseName}.mp3`);
          });

          if (idx !== -1) {
            audioFile = req.files[idx];
            usedFileIndices.add(idx);
            console.log(`   ✓ Audio asociado encontrado por coincidencia de nombre: ${audioFile.originalname}`);
          }
        }

        if (audioFile) {
          audioFileName = path.basename(decodeURIComponent(audioFile.originalname));
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
      // GPX INDIVIDUAL
      let gpxFile = null;
      let gpxFileName = `${media.nombre}.gpx`;

      // PRIORIDAD 1: Buscar por nombre exacto
      const gpxIdxExact = req.files.findIndex((f, i) => !usedFileIndices.has(i) && path.basename(f.originalname) === gpxFileName);
      if (gpxIdxExact !== -1) {
        gpxFile = req.files[gpxIdxExact];
        usedFileIndices.add(gpxIdxExact);
        console.log(`   ✓ [EXACTO] GPX encontrado: "${gpxFile.originalname}"`);
      }

      // PRIORIDAD 2: Si no encuentra exacto, buscar por patrón
      if (!gpxFile) {
        const baseName = media.nombre.includes('.') ? media.nombre.split('.')[0] : media.nombre;
        const gpxIdxPattern = req.files.findIndex((f, i) => {
          if (usedFileIndices.has(i)) return false;
          const fName = path.basename(decodeURIComponent(f.originalname));
          const fBaseName = path.basename(fName, '.gpx');
          return fName.endsWith('.gpx') && fBaseName.startsWith(baseName);
        });

        if (gpxIdxPattern !== -1) {
          gpxFile = req.files[gpxIdxPattern];
          usedFileIndices.add(gpxIdxPattern);
          console.log(`   ✓ [PATRÓN] GPX encontrado: ${gpxFile.originalname}`);
        }
      }

      if (gpxFile) {
        gpxFileName = path.basename(decodeURIComponent(gpxFile.originalname));
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

      // MAPA PNG INDIVIDUAL
      let mapaFile = null;

      // PRIORIDAD 1: Nombre exacto esperado
      const pngIdxExact = req.files.findIndex((f, i) => !usedFileIndices.has(i) && path.basename(f.originalname) === `${media.nombre}.png`);
      if (pngIdxExact !== -1) {
        mapaFile = req.files[pngIdxExact];
        usedFileIndices.add(pngIdxExact);
        console.log(`   ✓ [EXACTO] PNG encontrado: "${mapaFile.originalname}"`);
      }

      // PRIORIDAD 2: Si no encuentra con nombre exacto, buscar por patrón
      if (!mapaFile) {
        const pngIdxPattern = req.files.findIndex((f, i) => {
          if (usedFileIndices.has(i)) return false;
          const baseName = path.basename(f.originalname);
          const prefijo = media.nombre.split('_').slice(0, 3).join('_');
          return baseName.endsWith('.png') && baseName.startsWith(prefijo);
        });

        if (pngIdxPattern !== -1) {
          mapaFile = req.files[pngIdxPattern];
          usedFileIndices.add(pngIdxPattern);
          console.log(`   ✓ [PATRÓN] PNG encontrado: ${mapaFile.originalname}`);
        }
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
            [archivoId, 'mapa_ubicacion', path.basename(decodeURIComponent(mapaFile.originalname)), mapaRutaRelativa, new Date().toISOString()],
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
    const gpxFile = req.files.find(f => path.basename(decodeURIComponent(f.originalname)) === 'recorrido.gpx');
    if (gpxFile) {
      const gpxDest = path.join(actividadPath, 'gpx', 'recorrido.gpx');
      fs.renameSync(gpxFile.path, gpxDest);
      rutaGpxCompleto = path.relative(uploadsPath, gpxDest).replace(/\\/g, '/');
      console.log('✅ GPX del recorrido procesado (guardado en actividades)');
    }

    // PNG COMPLETO - SOLO en actividades
    const pngFile = req.files.find(f => path.basename(decodeURIComponent(f.originalname)) === 'mapa.png');
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
    const statsFile = req.files.find(f => path.basename(decodeURIComponent(f.originalname)) === 'estadisticas.json');
    if (statsFile) {
      const statsDest = path.join(actividadPath, 'metadata', 'estadisticas.json');
      fs.renameSync(statsFile.path, statsDest);
      rutaEstadisticas = path.relative(uploadsPath, statsDest).replace(/\\/g, '/');
      console.log('✅ Estadísticas procesadas (guardado en actividades)');

      // 🚀 Fase 3: Sincronización Canónica (Sobrescribir cálculos del servidor con datos del móvil)
      try {
        const statsData = JSON.parse(fs.readFileSync(statsDest, 'utf8'));
        if (statsData.v === "1.0") {
          console.log('💎 [Fase 3] Contrato Canónico v1.0 detectado. Sincronizando datos...');
          await new Promise((resolve, reject) => {
            db.run(
              `UPDATE actividades SET 
                distanciaKm = ?, 
                distanciaMetros = ?, 
                duracionSegundos = ?, 
                duracionFormateada = ?, 
                velocidadMediaKmh = ?,
                pasosEstimados = ?,
                calorias = ?
              WHERE id = ?`,
              [
                statsData.distancia_km,
                statsData.distancia_m,
                Math.round(statsData.tiempo_marcha_ms / 1000),
                statsData.duracion_ui,
                statsData.velocidad_media_kmh,
                statsData.pasos_totales,
                statsData.calorias_kcal,
                actividadId
              ],
              (err) => err ? reject(err) : resolve()
            );
          });
          console.log('✅ [Fase 3] Base de datos actualizada con la Verdad Canónica del móvil');
        }
      } catch (err) {
        console.warn('⚠️ Error en Sincronización Canónica:', err.message);
      }
    }

    // ✨ NUEVO: VISUAL_SESSION.JSON - MODO ALTA FIDELIDAD
    const visualSessionFile = req.files.find(f => path.basename(decodeURIComponent(f.originalname)) === 'visual_session.json');
    if (visualSessionFile) {
      const visualSessionDest = path.join(actividadPath, 'metadata', 'visual_session.json');
      fs.renameSync(visualSessionFile.path, visualSessionDest);
      rutaVisualSession = path.relative(uploadsPath, visualSessionDest).replace(/\\/g, '/');
      console.log('✅ visual_session.json procesado (Modo Alta Fidelidad activado)');
    } else {
      console.log('⚠️ visual_session.json no encontrado (Modo Legacy activado)');
    }

    // ACTUALIZAR REFERENCIAS EN ACTIVIDADES
    console.log('\n📝 Actualizando referencias de archivos generales en actividades...');
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE actividades 
          SET rutaGpxCompleto = ?, rutaMapaCompleto = ?, rutaManifest = ?, rutaEstadisticas = ?, rutaVisualSession = ?, fechaActualizacion = ?
          WHERE id = ?`,
        [rutaGpxCompleto, rutaMapaCompleto, rutaManifest, rutaEstadisticas, rutaVisualSession, new Date().toISOString(), actividadId],
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
          console.log(`   🎨 Visual Session: ${rutaVisualSession || 'N/A'}`);
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

// ✅ AÑADIR: Manejador de errores de multer
app.use((error, req, res, next) => {
  // ✅ CRÍTICO: Asegurar que las cabeceras CORS estén presentes en las respuestas de error
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, ngrok-skip-browser-warning');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  if (error instanceof multer.MulterError) {
    console.error('❌ [MULTER ERROR]:', error.message);
    console.error('   Código:', error.code);
    console.error('   Campo:', error.field);

    return res.status(400).json({
      success: false,
      error: `Error de subida: ${error.message}`,
      code: error.code,
      field: error.field
    });
  }

  if (error) {
    console.error('❌ [ERROR GENERAL]:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }

  next();
});

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


/**
 * GET /ia/historial/:sessionId
 * Obtiene el historial de una sesión
 */
app.get('/ia/historial/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  db.all(
    `SELECT * FROM conversaciones_ia 
      WHERE sessionId = ? 
      ORDER BY timestamp ASC`,
    [sessionId],
    (err, historial) => {
      if (err) {
        console.error('❌ Error obteniendo historial:', err.message);
        return res.status(500).json({ error: err.message });
      }

      // Parsear datos_estructurados si existen (con manejo de errores)
      const mensajesConDatos = historial.map(m => {
        let datosParseados = null;
        if (m.datos_estructurados) {
          try {
            datosParseados = JSON.parse(m.datos_estructurados);
          } catch (e) {
            console.warn(`⚠️  Error parseando datos_estructurados del mensaje ${m.id}:`, e.message);
          }
        }
        return {
          ...m,
          datos_estructurados: datosParseados
        };
      });

      res.json({
        sessionId,
        total: historial.length,
        mensajes: mensajesConDatos
      });
    }
  );
});

/**
 * DELETE /ia/historial/:sessionId
 * Limpia el historial de una sesión
 */
app.delete('/ia/historial/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  db.run(
    'DELETE FROM conversaciones_ia WHERE sessionId = ?',
    [sessionId],
    function (err) {
      if (err) {
        console.error('❌ Error limpiando historial:', err.message);
        return res.status(500).json({ error: err.message });
      }

      console.log(`🗑️  Historial de sesión ${sessionId} eliminado (${this.changes} mensajes)`);

      res.json({
        success: true,
        deleted: this.changes
      });
    }
  );
});

/**
 * POST /ia/validar-apikey
 * Valida que una API Key funciona
 */
app.post('/ia/validar-apikey', (req, res) => {
  const { apiKey } = req.body;

  if (!apiKey) {
    return res.status(400).json({
      valida: false,
      error: 'apiKey requerida'
    });
  }

  perplexityClient.validarApiKey(apiKey)
    .then(resultado => {
      res.json(resultado);
    })
    .catch(error => {
      res.status(500).json({
        valida: false,
        error: error.message
      });
    });
});

/**
 * GET /ia/sesiones-activas
 * Lista las sesiones con actividad reciente
 */
app.get('/ia/sesiones-activas', (req, res) => {
  db.all(`
      SELECT 
        sessionId,
        COUNT(*) as num_mensajes,
        MIN(timestamp) as inicio,
        MAX(timestamp) as ultimo_mensaje,
        SUM(CASE WHEN rol = 'user' THEN 1 ELSE 0 END) as mensajes_usuario,
        SUM(CASE WHEN rol = 'assistant' THEN 1 ELSE 0 END) as respuestas_ia,
        SUM(COALESCE(tokens_usados, 0)) as tokens_totales,
        MAX(CASE WHEN datos_estructurados IS NOT NULL THEN 1 ELSE 0 END) as tiene_plan
      FROM conversaciones_ia
      GROUP BY sessionId
      ORDER BY ultimo_mensaje DESC
      LIMIT 50
    `, (err, sesiones) => {
    if (err) {
      console.error('❌ Error obteniendo sesiones activas:', err.message);
      return res.status(500).json({ error: err.message });
    }

    res.json(sesiones);
  });
});

/**
 * 🛠️ ADMIN: Generar miniaturas faltantes (Legacy support)
 * Procesa vídeos que no tienen urlPoster.
 */
app.post('/api/admin/generate-missing-thumbnails', async (req, res) => {
  try {
    const videosSinPoster = await dbQuery.all(
      "SELECT id, rutaArchivo FROM archivos WHERE tipo = 'video' AND (urlPoster IS NULL OR urlPoster = '')"
    );

    console.log(`🔄 [Admin] Iniciando generación de ${videosSinPoster.length} miniaturas...`);

    let procesados = 0;
    // Procesamos de uno en uno para no saturar el sistema
    for (const v of videosSinPoster) {
      const fullPath = path.join(uploadsPath, v.rutaArchivo);
      if (fs.existsSync(fullPath)) {
        await new Promise(resolve => {
          generarMiniaturaVideo(v.id, fullPath, (thumbPath) => {
            if (thumbPath) {
              db.run("UPDATE archivos SET urlPoster = ? WHERE id = ?", [thumbPath, v.id], () => {
                procesados++;
                resolve();
              });
            } else {
              resolve();
            }
          });
        });
      }
    }

    res.json({
      success: true,
      mensaje: `Procesados ${procesados} vídeos de un total de ${videosSinPoster.length}`
    });
  } catch (error) {
    console.error('❌ [Admin] Error en generación masiva:', error.message);
    res.status(500).json({ error: error.message });
  }
});

console.log('🤖 Endpoints de IA configurados');


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIN ENDPOINTS DE IA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ========================================
// MAPA DE VIAJES PREVISTOS: CÁLCULO DE UBICACIÓN
// ========================================
function calcularDistancia(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radio de la Tierra en km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function geocodeDestino(destino) {
  if (!destino || typeof destino !== 'string' || !destino.trim()) {
    return null;
  }

  const endpoint = 'https://nominatim.openstreetmap.org/search';
  const response = await axios.get(endpoint, {
    params: {
      q: destino.trim(),
      format: 'json',
      limit: 1
    },
    timeout: 12000,
    headers: {
      'User-Agent': 'travel-memory-app/1.0 (mapa-viajes-previstos)'
    }
  });

  if (!Array.isArray(response.data) || response.data.length === 0) {
    return null;
  }

  const resultado = response.data[0];
  return {
    lat: Number(resultado.lat),
    lng: Number(resultado.lon),
    label: resultado.display_name || destino
  };
}

function extraerCoordenadasSeguras(valor) {
  if (!valor) return null;

  let geolocalizacion = valor;
  if (typeof valor === 'string') {
    try {
      geolocalizacion = JSON.parse(valor);
    } catch {
      return null;
    }
  }

  if (!geolocalizacion || typeof geolocalizacion !== 'object') {
    return null;
  }

  const lat = Number(
    geolocalizacion.lat ??
    geolocalizacion.latitude ??
    geolocalizacion.latitud
  );
  const lng = Number(
    geolocalizacion.lng ??
    geolocalizacion.lon ??
    geolocalizacion.longitude ??
    geolocalizacion.longitud
  );

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

async function calcularYPersistirUbicacion(viajeId) {
  const viaje = await dbQuery.get(
    'SELECT id, destino FROM viajes WHERE id = ?',
    [viajeId]
  );

  if (!viaje) {
    return { success: false, status: 404, error: 'Viaje no encontrado' };
  }

  const archivosConGeo = await dbQuery.all(
    `SELECT a.geolocalizacion
     FROM archivos a
     JOIN actividades ac ON ac.id = a.actividadId
     WHERE ac.viajePrevistoId = ?
       AND a.geolocalizacion IS NOT NULL
       AND TRIM(a.geolocalizacion) != ''`,
    [viajeId]
  );

  const puntos = (archivosConGeo || [])
    .map(r => extraerCoordenadasSeguras(r.geolocalizacion))
    .filter(Boolean);

  let latRepresentativa = null;
  let lngRepresentativa = null;
  let metodoCalculo = null;
  let distanciaMediaKm = null;

  if (puntos.length > 0) {
    // Elegimos el punto más "central" minimizando distancia total al resto.
    let mejorPunto = puntos[0];
    let mejorCosto = Number.POSITIVE_INFINITY;

    for (const candidato of puntos) {
      const costo = puntos.reduce(
        (acum, punto) => acum + calcularDistancia(candidato.lat, candidato.lng, punto.lat, punto.lng),
        0
      );
      if (costo < mejorCosto) {
        mejorCosto = costo;
        mejorPunto = candidato;
      }
    }

    latRepresentativa = mejorPunto.lat;
    lngRepresentativa = mejorPunto.lng;
    metodoCalculo = 'archivos_gps';
    distanciaMediaKm = puntos.length > 1 ? Number((mejorCosto / (puntos.length - 1)).toFixed(3)) : 0;
  } else {
    const geocodificado = await geocodeDestino(viaje.destino);
    if (geocodificado) {
      latRepresentativa = geocodificado.lat;
      lngRepresentativa = geocodificado.lng;
      metodoCalculo = 'geocoding_destino';
    }
  }

  await dbQuery.run(
    `UPDATE viajes
     SET lat_representativa = ?, lng_representativa = ?, metodo_calculo = ?
     WHERE id = ?`,
    [latRepresentativa, lngRepresentativa, metodoCalculo, viajeId]
  );

  return {
    success: true,
    viajeId: Number(viajeId),
    lat_representativa: latRepresentativa,
    lng_representativa: lngRepresentativa,
    metodo_calculo: metodoCalculo,
    fuente_puntos: puntos.length,
    distancia_media_km: distanciaMediaKm
  };
}

// Recalcular ubicación representativa para un viaje concreto
app.post('/viajes/:id/calcular-ubicacion', async (req, res) => {
  try {
    const { id } = req.params;
    const resultado = await calcularYPersistirUbicacion(id);

    if (!resultado.success) {
      return res.status(resultado.status || 400).json(resultado);
    }

    res.json(resultado);
  } catch (error) {
    console.error('❌ Error en /viajes/:id/calcular-ubicacion:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error calculando ubicación del viaje',
      detalle: error.message
    });
  }
});

// Migración masiva de ubicaciones para todos los viajes
app.post('/api/admin/migrar-viajes-ubicaciones', async (req, res) => {
  try {
    const viajes = await dbQuery.all('SELECT id FROM viajes ORDER BY id ASC', []);
    const resultados = [];

    for (const viaje of viajes) {
      try {
        const result = await calcularYPersistirUbicacion(viaje.id);
        resultados.push(result);
      } catch (errorViaje) {
        resultados.push({
          success: false,
          viajeId: viaje.id,
          error: errorViaje.message
        });
      }
    }

    const ok = resultados.filter(r => r.success).length;
    const fail = resultados.length - ok;

    res.json({
      success: true,
      total: resultados.length,
      actualizados: ok,
      errores: fail,
      resultados
    });
  } catch (error) {
    console.error('❌ Error en /api/admin/migrar-viajes-ubicaciones:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error ejecutando migración de ubicaciones',
      detalle: error.message
    });
  }
});

// ========================================
// 🛡️ MANEJADOR GLOBAL DE ERRORES (CORS SAFE)
// ========================================
app.use((err, req, res, next) => {
  console.error('\n💥 [ERROR GLOBAL] Detectado error no manejado:', err.message);
  console.error(err.stack);

  // Asegurar que las cabeceras CORS se mantengan incluso en crash 500
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  }

  res.status(500).json({
    error: 'Error interno del servidor',
    detalles: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Configurar el puerto y poner a escuchar el servidor
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3001;

// Helper para configurar Timeouts Extensos en servidores HTTP
const configureServerTimeouts = (server) => {
  server.requestTimeout = 30 * 60 * 1000; // 30 Minutos de parseo
  server.headersTimeout = 30 * 60 * 1000; // 30 Minutos por si los headers vienen fragmentados
  server.keepAliveTimeout = 2 * 60 * 1000; // 2 minutos free
  server.timeout = 30 * 60 * 1000; // Socket general (30 min)
  console.log('⏱️ Timeouts de red ajustados para permitir subidas gigantes (>1GB)');
};

// Servidor HTTP (para compatibilidad)
const httpServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor backend HTTP escuchando en http://0.0.0.0:${PORT}`);
});
configureServerTimeouts(httpServer);

// Servidor HTTPS
const https = require('https');

// Usar certificado .pfx generado con PowerShell
let httpsServerInstance;
try {
  const sslOptions = {
    pfx: fs.readFileSync(path.join(__dirname, '../../ssl/server.pfx')),
    passphrase: 'password'
  };

  httpsServerInstance = https.createServer(sslOptions, app);
  httpsServerInstance.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`Servidor backend HTTPS escuchando en https://0.0.0.0:${HTTPS_PORT}`);
  });
  configureServerTimeouts(httpsServerInstance);
} catch (error) {
  console.log('⚠️  Certificados SSL no encontrados, solo HTTP disponible');
}
