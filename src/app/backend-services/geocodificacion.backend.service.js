const axios = require('axios');

/**
 * Servicio de Geocodificación Backend con Proxy y Caché de dos niveles (Memoria + SQLite).
 * Protege contra bloqueos CORS y 429 Too Many Requests de OpenStreetMap (Nominatim).
 */
class GeocodificacionBackendService {
  constructor(db) {
    this.db = db;
    this.cacheMemoriaReverse = new Map(); // key: "lat_round,lon_round"
    this.cacheMemoriaSearch = new Map();  // key: "query_normalizada"
    this.colaPeticiones = Promise.resolve();
    this.ULTIMA_PETICION_MS = 0;
    this.INTERVALO_MINIMO_MS = 1100; // Respetar regla de oro de OSM Nominatim (máx. 1 req/seg)
    this.USER_AGENT = 'TravelMemoryApp/2.0 (contact: admin@travelmemoryapp.local; https://github.com/Victorjtm/travel-memory-app-v2-clean)';

    if (this.db) {
      this.inicializarTablas();
    }
  }

  /**
   * Helper para consultas SQLite con promesas
   */
  dbGet(sql, params = []) {
    return new Promise((resolve) => {
      this.db.get(sql, params, (err, row) => {
        if (err) resolve(null);
        else resolve(row);
      });
    });
  }

  dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  inicializarTablas() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS geocoding_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lat_round REAL NOT NULL,
        lon_round REAL NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        datos_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(lat_round, lon_round)
      )
    `, (err) => {
      if (err) {
        console.error('❌ Error creando tabla geocoding_cache:', err.message);
      } else {
        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_geocoding_lat_lon 
          ON geocoding_cache(lat_round, lon_round)
        `);
      }
    });

    this.db.run(`
      CREATE TABLE IF NOT EXISTS geocoding_search_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_key TEXT NOT NULL UNIQUE,
        datos_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('❌ Error creando tabla geocoding_search_cache:', err.message);
      } else {
        this.db.run(`
          CREATE INDEX IF NOT EXISTS idx_geocoding_search_query 
          ON geocoding_search_cache(query_key)
        `);
      }
    });

    console.log('🗺️ [GeocodificacionBackend] Tablas de caché persistente de geocodificación listas.');
  }

  /**
   * Geocodificación inversa con caché en RAM + SQLite + rate limiting seguro.
   */
  async reverseGeocode({ lat, lon, zoom = 18, addressdetails = 1, lang = 'es' }) {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);

    if (isNaN(latNum) || isNaN(lonNum)) {
      return null;
    }

    // Redondear a 4 decimales (~11 metros de precisión), óptimo para calles y ciudades
    const latRound = Number(latNum.toFixed(4));
    const lonRound = Number(lonNum.toFixed(4));
    const memKey = `${latRound},${lonRound}`;

    // 1. Nivel 1: Caché en Memoria RAM (Respuesta inmediata en 0ms)
    if (this.cacheMemoriaReverse.has(memKey)) {
      return this.cacheMemoriaReverse.get(memKey);
    }

    // 2. Nivel 2: Caché persistente en SQLite (1-2ms, sin tráfico de red)
    if (this.db) {
      const row = await this.dbGet(
        'SELECT datos_json FROM geocoding_cache WHERE lat_round = ? AND lon_round = ?',
        [latRound, lonRound]
      );

      if (row && row.datos_json) {
        try {
          const parsed = JSON.parse(row.datos_json);
          this.cacheMemoriaReverse.set(memKey, parsed);
          return parsed;
        } catch (e) {
          // JSON corrupto, ignorar y consultar
        }
      }
    }

    // 3. Nivel 3: Consulta secuencial a OpenStreetMap Nominatim con espaciado mínimo
    return new Promise((resolve) => {
      this.colaPeticiones = this.colaPeticiones.then(async () => {
        // Doble verificación por si otra petición concurrente ya lo resolvió
        if (this.cacheMemoriaReverse.has(memKey)) {
          resolve(this.cacheMemoriaReverse.get(memKey));
          return;
        }

        // Espaciar peticiones a Nominatim respetando su política (máx. 1 req/seg)
        const ahora = Date.now();
        const transcurrido = ahora - this.ULTIMA_PETICION_MS;
        if (transcurrido < this.INTERVALO_MINIMO_MS) {
          await new Promise(r => setTimeout(r, this.INTERVALO_MINIMO_MS - transcurrido));
        }
        this.ULTIMA_PETICION_MS = Date.now();

        try {
          const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latNum}&lon=${lonNum}&zoom=${zoom}&addressdetails=${addressdetails}&accept-language=${lang}`;
          
          const resp = await axios.get(url, {
            headers: {
              'User-Agent': this.USER_AGENT,
              'Accept': 'application/json',
              'Accept-Language': lang
            },
            timeout: 9000
          });

          if (resp.data && (resp.data.address || resp.data.display_name)) {
            const data = resp.data;
            this.cacheMemoriaReverse.set(memKey, data);

            if (this.db) {
              this.dbRun(
                'INSERT OR REPLACE INTO geocoding_cache (lat_round, lon_round, lat, lon, datos_json) VALUES (?, ?, ?, ?, ?)',
                [latRound, lonRound, latNum, lonNum, JSON.stringify(data)]
              ).catch(err => console.warn('⚠️ Error guardando en geocoding_cache:', err.message));
            }

            resolve(data);
            return;
          }
        } catch (error) {
          const status = error.response ? error.response.status : null;
          console.warn(`⚠️ [GeocodificacionBackend] Error Nominatim para (${latNum}, ${lonNum}):`, status || error.message);
          
          if (status === 429) {
            console.warn('🛑 [GeocodificacionBackend] Rate limit 429 detectado en OSM. Pausando cola 5s...');
            await new Promise(r => setTimeout(r, 5000));
          }
        }

        // Fallback seguro: datos básicos para que el cliente nunca reciba 429 ni CORS
        const fallback = {
          lat: latNum,
          lon: lonNum,
          display_name: `${latNum.toFixed(4)}, ${lonNum.toFixed(4)}`,
          address: {
            road: `${latNum.toFixed(4)}, ${lonNum.toFixed(4)}`,
            city: '',
            state: '',
            country: ''
          }
        };
        resolve(fallback);
      }).catch((e) => {
        console.error('❌ Error en cola de geocodificación:', e);
        resolve({
          lat: latNum,
          lon: lonNum,
          display_name: `${latNum.toFixed(4)}, ${lonNum.toFixed(4)}`,
          address: {}
        });
      });
    });
  }

  /**
   * Búsqueda de ubicación por texto con caché en SQLite y RAM.
   */
  async searchGeocode({ q, limit = 5, addressdetails = 1, lang = 'es' }) {
    if (!q || !q.trim()) return [];
    const queryClean = q.trim().toLowerCase();
    const memKey = `${queryClean}_${limit}`;

    // 1. RAM
    if (this.cacheMemoriaSearch.has(memKey)) {
      return this.cacheMemoriaSearch.get(memKey);
    }

    // 2. SQLite
    if (this.db) {
      const row = await this.dbGet(
        'SELECT datos_json FROM geocoding_search_cache WHERE query_key = ?',
        [memKey]
      );
      if (row && row.datos_json) {
        try {
          const parsed = JSON.parse(row.datos_json);
          this.cacheMemoriaSearch.set(memKey, parsed);
          return parsed;
        } catch (e) {}
      }
    }

    // 3. Nominatim con cola
    return new Promise((resolve) => {
      this.colaPeticiones = this.colaPeticiones.then(async () => {
        if (this.cacheMemoriaSearch.has(memKey)) {
          resolve(this.cacheMemoriaSearch.get(memKey));
          return;
        }

        const ahora = Date.now();
        const transcurrido = ahora - this.ULTIMA_PETICION_MS;
        if (transcurrido < this.INTERVALO_MINIMO_MS) {
          await new Promise(r => setTimeout(r, this.INTERVALO_MINIMO_MS - transcurrido));
        }
        this.ULTIMA_PETICION_MS = Date.now();

        try {
          const endpoint = 'https://nominatim.openstreetmap.org/search';
          const resp = await axios.get(endpoint, {
            params: {
              q: queryClean,
              format: 'json',
              limit: limit,
              addressdetails: addressdetails,
              'accept-language': lang
            },
            headers: {
              'User-Agent': this.USER_AGENT,
              'Accept': 'application/json'
            },
            timeout: 9000
          });

          const data = Array.isArray(resp.data) ? resp.data : [];
          this.cacheMemoriaSearch.set(memKey, data);

          if (this.db) {
            this.dbRun(
              'INSERT OR REPLACE INTO geocoding_search_cache (query_key, datos_json) VALUES (?, ?)',
              [memKey, JSON.stringify(data)]
            ).catch(() => {});
          }

          resolve(data);
          return;
        } catch (e) {
          console.warn(`⚠️ [GeocodificacionBackend] Error search Nominatim "${queryClean}":`, e.message);
          resolve([]);
        }
      });
    });
  }
}

module.exports = GeocodificacionBackendService;
