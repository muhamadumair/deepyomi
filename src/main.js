const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');

function createWindow() {
  const win = new BrowserWindow({
    width: 600,
    height: 500,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false // Simplified for local personal utility use
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  // Optional: win.webContents.openDevTools(); // Uncomment to debug
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Open the recognized text in DeepL in the default browser
ipcMain.on('open-deepl', (event, text) => {
  const deepLUrl = `https://www.deepl.com/translator#ja/en/${encodeURIComponent(text)}`;
  shell.openExternal(deepLUrl);
});
