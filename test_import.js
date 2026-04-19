
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

async function runTest() {
  const manifest = {
    nombre: "Recorrido_20260419",
    estadisticas: { distancia_km: 5, duracion_formateada: "1h", horaInicio: "10:00", horaFin: "11:00" },
    multimedia: [], fecha_exportacion: "2026-04-19T16:00:00Z"
  };
  fs.writeFileSync('mock_manifest.json', JSON.stringify(manifest));
  
  const visualSession = { type: "FeatureCollection" };
  fs.writeFileSync('mock_visual_session.json', JSON.stringify(visualSession));

  console.log("--- TEST 1: LEGACY (No visual_session) ---");
  const form1 = new FormData();
  form1.append('destino', 'Legacy City');
  form1.append('tipoActividadId', '1');
  form1.append('archivos', fs.createReadStream('mock_manifest.json'), { filename: 'manifest.json' });
  
  try {
    const res1 = await axios.post('http://localhost:3002/import-tracking', form1, { headers: form1.getHeaders() });
    console.log("Legacy OK: Viaje ", res1.data.viajeId);
  } catch(e) {
    console.error("Legacy Error:", e.response ? e.response.data : e.message);
  }

  console.log("\n--- TEST 2: ENRICHED (With visual_session) ---");
  const form2 = new FormData();
  form2.append('destino', 'Enriched City');
  form2.append('tipoActividadId', '1');
  form2.append('archivos', fs.createReadStream('mock_manifest.json'), { filename: 'manifest.json' });
  form2.append('archivos', fs.createReadStream('mock_visual_session.json'), { filename: 'visual_session.json' });
  
  try {
    const res2 = await axios.post('http://localhost:3002/import-tracking', form2, { headers: form2.getHeaders() });
    console.log("Enriched OK: Viaje ", res2.data.viajeId);
  } catch(e) {
    console.error("Enriched Error:", e.response ? e.response.data : e.message);
  }
}

runTest();

