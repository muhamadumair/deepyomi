const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { createWorker, PSM } = require('tesseract.js');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 900,
    minWidth: 700,
    minHeight: 600,
    resizable: true,
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
let workerPromise = null;
let progressSender = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('jpn_vert', 1, {
      // Use the high-accuracy "best" trained data instead of the default "fast" model
      langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',
      logger: m => {
        if (m.status === 'recognizing text' && progressSender) {
          progressSender.send('ocr-progress', Math.round(m.progress * 100));
        }
      }
    }).then(async (worker) => {
      // Treat the page as a single block of vertically-aligned text
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK_VERT_TEXT,
        preserve_interword_spaces: '1',
      });
      return worker;
    });
  }
  return workerPromise;
}

ipcMain.handle('run-ocr', async (event, bytes) => {
  progressSender = event.sender;
  const worker = await getWorker();
  const { data } = await worker.recognize(Buffer.from(bytes));
  return data.text;
});

// Open the recognized text in DeepL in the default browser
ipcMain.on('open-deepl', (event, text) => {
  const deepLUrl = `https://www.deepl.com/translator#ja/en/${encodeURIComponent(text)}`;
  shell.openExternal(deepLUrl);
});
