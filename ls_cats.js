const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('viajes.db');

console.log('--- TABLES ---');
db.all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%tipo%';", (err, tables) => {
    if (err) console.error(err);
    console.log(tables);

    if (tables && tables.length > 0) {
        tables.forEach(t => {
            db.all(`SELECT * FROM ${t.name};`, (err, rows) => {
                if (err) console.error(err);
                console.log(`--- ${t.name} ---`);
                console.log(rows);
            });
        });
    }
});

setTimeout(() => db.close(), 1000);
