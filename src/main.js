const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const Tesseract = require('tesseract.js');

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

// Run OCR in the main process (Node env) so worker_threads gets a valid path.
// The renderer's "browser" environment turns workerPath into a file:// URL,
// which worker_threads rejects; the main process avoids that conversion.
ipcMain.handle('run-ocr', async (event, bytes) => {
  const result = await Tesseract.recognize(
    Buffer.from(bytes),
    'jpn_vert',
    {
      logger: m => {
        if (m.status === 'recognizing text') {
          event.sender.send('ocr-progress', Math.round(m.progress * 100));
        }
      }
    }
  );
  return result.data.text;
});

// Open the recognized text in DeepL in the default browser
ipcMain.on('open-deepl', (event, text) => {
  const deepLUrl = `https://www.deepl.com/translator#ja/en/${encodeURIComponent(text)}`;
  shell.openExternal(deepLUrl);
});
