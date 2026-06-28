const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron');
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

// Range of characters that count as "Japanese" (kana, kanji, CJK punctuation,
// and full-width forms incl. 「」『』《》（）).
const JP = '\\u3000-\\u30FF\\u4E00-\\u9FFF\\uFF00-\\uFFEF';

// Clean and format OCR text from a light-novel page for translation.
function formatNovelText(text) {
  let t = text
    // DeepL deep-link is #ja/en/<source>/<target>; a literal "/" splits the panes.
    // Vertical OCR also misreads the long dash "――" as slash/bar noise.
    .replace(/[／/＼\\｜|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Drop isolated Latin letters wedged between Japanese characters. These are
  // OCR noise for punctuation (e.g. the 》 in 《女神》 misread as "w").
  t = t.replace(new RegExp(`(?<=[${JP}])[A-Za-z](?=[${JP}])`, 'g'), '');

  // Vertical OCR often misreads the closing guillemet 》 as a stray 。
  // Repair 《…。 (no closing 》) back into 《…》.
  t = t.replace(/《([^》。\n]{1,12})。/g, '《$1》');

  // Dialogue corner brackets 「」 are often read as half-width square brackets.
  t = t.replace(/[\[［]/g, '「').replace(/[\]］]/g, '」');

  // The Japanese ellipsis …… is frequently misread as colons or a vertical
  // ellipsis glyph. Normalize those back to ……
  t = t.replace(/[:：]{2,}/g, '……').replace(/[⋮︙]+/g, '……');

  // Separate each dialogue (「…」 / 『…』) and monologue (（…） / (…)) from the
  // surrounding narration with a blank line.
  t = t
    .replace(/\s*([「『（(])/g, '\n\n$1')
    .replace(/([」』）)])\s*/g, '$1\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
    .trim();

  return t;
}

// Handle opening DeepL securely in the default browser
ipcMain.on('open-deepl', (event, text) => {
  const formatted = formatNovelText(text);

  // Keep the formatted text on the clipboard as a reliable fallback in case a
  // very long page still exceeds DeepL's deep-link length limit.
  clipboard.writeText(formatted);

  const deepLUrl = `https://www.deepl.com/translator#ja/en/${encodeURIComponent(formatted)}`;
  shell.openExternal(deepLUrl);
});
