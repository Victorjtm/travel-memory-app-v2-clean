const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs'); // ← Añade esta línea para funciones síncronas

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            webSecurity: false // Permitir carga de recursos locales (file://) desde localhost
        }
    });

    mainWindow.loadURL('http://localhost:4200');
    mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });

    if (result.canceled) {
        return null;
    }

    return result.filePaths[0];
});

ipcMain.handle('read-directory', async (event, dirPath) => {
    try {
        const items = await fs.readdir(dirPath, { withFileTypes: true });

        const result = await Promise.all(
            items.map(async (item) => {
                const fullPath = path.join(dirPath, item.name);
                let stats = null;

                try {
                    if (!item.isDirectory()) {
                        stats = await fs.stat(fullPath);
                    }
                } catch (error) {
                    console.error('Error reading stats:', error);
                }

                return {
                    nombre: item.name,
                    rutaCompleta: fullPath,
                    esDirectorio: item.isDirectory(),
                    tamano: stats ? stats.size : 0,
                    fechaModificacion: stats ? stats.mtime : new Date()
                };
            })
        );

        return result;
    } catch (error) {
        console.error('Error reading directory:', error);
        throw error;
    }
});

ipcMain.handle('copy-file', async (event, sourcePath, destPath) => {
    try {
        await fs.copyFile(sourcePath, destPath);
        return { success: true };
    } catch (error) {
        console.error('Error copying file:', error);
        throw error;
    }
});

/**
 * Copia un archivo a la carpeta de uploads (versión mejorada)
 */
ipcMain.handle('copy-file-to-uploads', async (event, sourcePath, fileName) => {
    try {
        const destPath = path.join(__dirname, 'uploads', fileName);

        // Crear carpeta uploads si no existe
        const uploadsDir = path.join(__dirname, 'uploads');
        if (!fsSync.existsSync(uploadsDir)) { // ← Cambio aquí: usa fsSync
            await fs.mkdir(uploadsDir, { recursive: true });
        }

        await fs.copyFile(sourcePath, destPath);
        console.log(`✅ Archivo copiado: ${fileName}`);
        return { success: true, path: destPath };
    } catch (error) {
        console.error('Error copiando archivo:', error);
        throw error;
    }
});