PRAGMA foreign_keys=off;
BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS ItinerarioGeneral_new (
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
    tipoDeViaje TEXT,
    FOREIGN KEY (viajePrevistoId) REFERENCES viajes(id) ON DELETE CASCADE
);
INSERT INTO ItinerarioGeneral_new SELECT * FROM ItinerarioGeneral;
DROP TABLE ItinerarioGeneral;
ALTER TABLE ItinerarioGeneral_new RENAME TO ItinerarioGeneral;
COMMIT;
PRAGMA foreign_keys=on;
