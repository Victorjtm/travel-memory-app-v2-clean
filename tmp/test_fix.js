
const acts = [
    { id: 1, horaInicio: '17:20:39', horaFin: '23:11:49', fechaInicio: '2017-03-18' },
    { id: 2, horaInicio: '17:20:39', horaFin: '23:11:49', fechaInicio: '2017-03-18' }
];

// Sort like in server.js
acts.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));

let colisionDetectada = null;
for (let i = 0; i < acts.length - 1; i++) {
    const actual = acts[i];
    const siguiente = acts[i + 1];
    
    console.log(`Comparing ${actual.horaInicio}-${actual.horaFin} with ${siguiente.horaInicio}-${siguiente.horaFin}`);
    
    // CURRENT LOGIC (Buggy)
    if (actual.horaFin > siguiente.horaInicio) {
        // This flags the identical range as a conflict
        colisionDetectada = `Conflicto entre ${actual.horaInicio}-${actual.horaFin} y ${siguiente.horaInicio}-${siguiente.horaFin}`;
    }
}

console.log("Current logic result:", colisionDetectada);

// PROPOSED LOGIC
colisionDetectada = null;
for (let i = 0; i < acts.length - 1; i++) {
    const actual = acts[i];
    const siguiente = acts[i + 1];
    
    if (actual.horaFin > siguiente.horaInicio) {
        // FIX: Ignore identical slots
        if (actual.horaInicio === siguiente.horaInicio && actual.horaFin === siguiente.horaFin) {
            console.log("Ignoring identical slots (likely duplicate)");
            continue;
        }
        colisionDetectada = `Conflicto entre ${actual.horaInicio}-${actual.horaFin} y ${siguiente.horaInicio}-${siguiente.horaFin}`;
    }
}

console.log("Proposed logic result:", colisionDetectada ? colisionDetectada : "No conflict (Success!)");
