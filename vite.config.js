import { defineConfig } from 'vite'
import { angular } from '@analogjs/vite-plugin-angular'

export default defineConfig({
  plugins: [angular()],
  server: {
    host: '0.0.0.0', // Permite acceso desde cualquier IP
    port: 4200,
    hmr: {
      host: '192.168.1.22', // Tu IP local
      port: 4200
    },
    // Configuración para servir archivos estáticos
    fs: {
      allow: ['..']
    }
  },
  // Configurar assets
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})