// ========================================
// CONFIGURACIÓN DINÁMICA DEL BACKEND
// ========================================

const host = window.location.hostname;
let apiUrl: string;

console.log('[Environment] Host detectado:', host);

// ========================================
// FUNCIÓN: Detectar IP del servidor automáticamente
// ========================================
async function detectServerIP(): Promise<string> {
  try {
    // Intentar primero con la IP actual del host
    const testUrl = `http://${host}:3000/api/server-info`;
    console.log('[Environment] Intentando detectar servidor en:', testUrl);

    const response = await fetch(testUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(2000) // Timeout de 2 segundos
    });

    if (response.ok) {
      const data = await response.json();
      console.log('[Environment] Servidor detectado en:', data.ip);
      return data.ip;
    }
  } catch (error) {
    console.warn('[Environment] No se pudo detectar IP del servidor:', error);
  }

  // Fallback: usar el host actual
  return host;
}

// ========================================
// CONFIGURACIÓN SEGÚN EL ENTORNO
// ========================================

if (host === 'localhost' || host.startsWith('192.168.') || host.startsWith('10.') || host.startsWith('172.')) {
  // MODO LAN: Detectar IP del servidor automáticamente
  const protocol = window.location.protocol;
  const port = protocol === 'https:' ? '3001' : '3000';

  // Usar host actual como fallback inicial
  apiUrl = `${protocol}//${host}:${port}`;
  console.log('[Environment] Modo LAN - URL inicial:', apiUrl);

  // Detectar IP real del servidor (asíncrono)
  detectServerIP().then(serverIP => {
    apiUrl = `${protocol}//${serverIP}:${port}`;
    console.log('[Environment] ✅ URL final del backend:', apiUrl);

    // Actualizar la configuración global
    (window as any).__API_URL__ = apiUrl;
  });

} else if (host.includes('ngrok')) {
  // MODO NGROK
  const ngrokBackendUrl = (window as any).NGROK_BACKEND_URL;
  if (ngrokBackendUrl && ngrokBackendUrl !== 'http://localhost:3000') {
    apiUrl = ngrokBackendUrl.trim();
    if (apiUrl.startsWith('"') || apiUrl.startsWith("'")) apiUrl = apiUrl.slice(1);
    if (apiUrl.endsWith('"') || apiUrl.endsWith("'")) apiUrl = apiUrl.slice(0, -1);
    if (apiUrl.endsWith(';')) apiUrl = apiUrl.slice(0, -1);
    console.log('[Environment] Modo ngrok:', apiUrl);
  } else {
    apiUrl = 'http://localhost:3000';
    console.log('[Environment] Modo ngrok - fallback:', apiUrl);
  }
} else {
  // FALLBACK
  apiUrl = 'http://localhost:3000';
  console.log('[Environment] Fallback localhost:', apiUrl);
}

console.log('[Environment] Configuración inicial:', apiUrl);

export const environment = {
  production: false,
  get apiUrl() {
    // Permitir actualización dinámica
    return (window as any).__API_URL__ || apiUrl;
  }
};