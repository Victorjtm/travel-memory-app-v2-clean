const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('viajes.db', sqlite3.OPEN_READWRITE);

const updates = [
    { id: 6, nombre: 'deportiva', desc: 'Actividades deportivas y de aventura' },
    { id: 7, nombre: 'fiesta', desc: 'Fiestas, eventos y celebraciones' },
    { id: 8, nombre: 'transporte', desc: 'Trayectos y desplazamientos' },
    { id: 9, nombre: 'restauración', desc: 'Restaurantes, bares y gastronomía' },
];

db.serialize(() => {
    db.run('PRAGMA journal_mode=WAL;');
    const stmt = db.prepare('UPDATE TiposActividad SET nombre=?, descripcion=? WHERE id=?');
    for (const u of updates) {
        stmt.run(u.nombre, u.desc, u.id, (err) => {
            if (err) console.error(`Error updating id=${u.id}:`, err.message);
            else console.log(`✅ id=${u.id} → ${u.nombre}`);
        });
    }
    stmt.finalize(() => {
        db.all('SELECT id, nombre FROM TiposActividad ORDER BY id;', (err, rows) => {
            if (err) console.error(err);
            else console.table(rows);
            db.close();
        });
    });
});
