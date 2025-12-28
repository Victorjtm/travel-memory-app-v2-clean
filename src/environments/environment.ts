// Detectar el host actual
const host = window.location.hostname;

// Determinar la URL del backend
let apiUrl: string;

console.log('[Environment] Host detectado:', host);
console.log('[Environment] NGROK_BACKEND_URL:', (window as any).NGROK_BACKEND_URL);

if (host === 'localhost' || host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('172.')) {
  // Estás en LAN - detectar si es HTTPS o HTTP
  const protocol = window.location.protocol; // 'https:' o 'http:'
  const port = protocol === 'https:' ? '3001' : '3000';
  apiUrl = `${protocol}//${host}:${port}`;
  console.log('[Environment] Modo LAN detectado:', apiUrl, 'Protocol:', protocol);
} else if (host.includes('ngrok')) {
  // Estás usando ngrok
  const ngrokBackendUrl = (window as any).NGROK_BACKEND_URL;
  if (ngrokBackendUrl && ngrokBackendUrl !== 'http://localhost:3000') {
    // ✅ Limpiar SOLO espacios y comillas al inicio/final
    apiUrl = ngrokBackendUrl.trim();
    // ✅ Eliminar comillas si están al inicio/fin
    if (apiUrl.startsWith('"') || apiUrl.startsWith("'")) apiUrl = apiUrl.slice(1);
    if (apiUrl.endsWith('"') || apiUrl.endsWith("'")) apiUrl = apiUrl.slice(0, -1);
    if (apiUrl.endsWith(';')) apiUrl = apiUrl.slice(0, -1);
    console.log('[Environment] Modo ngrok - usando config.js:', apiUrl);
  } else {
    // Fallback a localhost si no hay URL ngrok válida
    apiUrl = 'http://localhost:3000';
    console.log('[Environment] Modo ngrok - fallback a localhost:', apiUrl);
  }
} else {
  // Fuera de LAN, fallback
  apiUrl = 'http://localhost:3000';
  console.log('[Environment] Fallback localhost:', apiUrl);
}

console.log('[Environment] URL final del backend:', apiUrl);

export const environment = {
  production: false,
  apiUrl: apiUrl
};