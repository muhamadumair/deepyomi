const { app, BrowserWindow, ipcMain, shell, clipboard, desktopCapturer, screen } = require('electron');
const path = require('node:path');
const { createWorker, PSM } = require('tesseract.js');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
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

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  // Optional: mainWindow.webContents.openDevTools(); // Uncomment to debug
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

// --- Snip-to-image (Windows Snipping Tool style screen capture) ---
let snipWindows = [];
let snipResolve = null;

function closeSnipWindows() {
  snipWindows.forEach(w => { if (!w.isDestroyed()) w.close(); });
  snipWindows = [];
}

ipcMain.handle('start-snip', async () => {
  if (mainWindow) mainWindow.hide();
  // Give the OS time to actually hide the window before we screenshot,
  // otherwise our own app can appear in the captured image.
  await new Promise(r => setTimeout(r, 150));

  return new Promise(async (resolve) => {
    snipResolve = (bytes) => {
      resolve(bytes);
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    };

    try {
      const displays = screen.getAllDisplays();
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 3840, height: 2160 }
      });

      displays.forEach((display) => {
        const source = sources.find(s => s.display_id === String(display.id)) || sources[0];
        if (!source) return;
        const dataUrl = source.thumbnail.toDataURL();

        const win = new BrowserWindow({
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
          frame: false,
          transparent: true,
          alwaysOnTop: true,
          skipTaskbar: true,
          resizable: false,
          movable: false,
          hasShadow: false,
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
          }
        });
        win.setAlwaysOnTop(true, 'screen-saver');
        win.loadFile(path.join(__dirname, 'snip.html'));
        win.webContents.once('did-finish-load', () => {
          win.webContents.send('snip-init', dataUrl);
        });
        snipWindows.push(win);
      });

      if (snipWindows.length === 0) {
        snipResolve(null);
      }
    } catch (err) {
      console.error('Failed to start snip:', err);
      snipResolve(null);
    }
  });
});

ipcMain.on('snip-done', (event, bytes) => {
  closeSnipWindows();
  if (snipResolve) { snipResolve(bytes); snipResolve = null; }
});

ipcMain.on('snip-cancel', () => {
  closeSnipWindows();
  if (snipResolve) { snipResolve(null); snipResolve = null; }
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

  // Vertical OCR often renders rotated corner brackets as box-drawing or
  // presentation-form characters. Normalize them back to standard brackets.
  t = t
    .replace(/┌-/g, '「')
    .replace(/[┌⌜﹁︽]/g, '「')
    .replace(/[┐⌝﹂︾]/g, '」');

  // Repair opening 「 misread as a leading dash or box-drawing form after a
  // sentence boundary (e.g. "。-まさか" → "。「まさか").
  t = t.replace(/(^|[。、！？…」』）)])\s*[-┌─ー⌜﹁︽]+(?=[\u3000-\u30FF\u4E00-\u9FFF])/g, '$1「');

  // Vertical em dash is sometimes misread as 和 (e.g. あれか 和軍票も → あれか──軍票も).
  t = t.replace(/か\s*和(?=[\u3000-\u30FF\u4E00-\u9FFF])/g, 'か──');

  // Drop isolated Latin letters wedged between Japanese characters. These are
  // OCR noise for punctuation (e.g. the 》 in 《女神》 misread as "w").
  t = t.replace(new RegExp(`(?<=[${JP}])[A-Za-z](?=[${JP}])`, 'g'), '');

  // Vertical OCR often misreads the closing guillemet 》 as 。 or a quotation mark.
  // Repair 《…[。 or quote-like] back into 《…》.
  const misreadChars = '\u3002\u201C\u201D\u0022\u0027\u2019\u2018';
  t = t.replace(
    new RegExp(`《([^》\\n${misreadChars}]{1,12})[${misreadChars}]`, 'g'),
    '《$1》'
  );

  // Dialogue corner brackets 「」 are often read as half-width square brackets.
  t = t.replace(/[\[［]/g, '「').replace(/[\]］]/g, '」');

  // Repair opening dialogue bracket 「 misread as katakana prolonged sound ー.
  // It can appear at the start of text, after a closing bracket, or after a
  // sentence-ending punctuation such as 。
  t = t.replace(/(^|[」』）】。、！？…])\s*ー(?=[^」「]*?」)/g, '$1「');

  // The Japanese ellipsis …… is frequently misread as colons or a vertical
  // ellipsis glyph. Normalize those back to ……
  t = t.replace(/[:：]{2,}/g, '……').replace(/[⋮︙]+/g, '……');

  // Separate each dialogue (「…」 / 『…』) and monologue (（…） / (…)) from the
  // surrounding narration with a blank line.
  t = t
    .replace(/\s*([「『（(])/g, '\n\n$1')
    .replace(/([」』）)])\s*/g, '$1\n\n')
    .replace(/([」』）)])\s*\1/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
    .trim();

  // Structural repair: any dialogue block that opens with 「 but has no
  // closing bracket should get one. If it ends with the question particle か
  // (with optional OCR noise), add ？」.
  t = t
    .split(/\n\n+/)
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed.startsWith('「')) return block;
      if (/[」』）)]$/.test(trimmed)) return block;
      if (/か[っつッツｯ?？]*$/.test(trimmed)) {
        return trimmed.replace(/か[っつッツｯ?？]*$/, 'か？\u300D');
      }
      return trimmed + '\u300D';
    })
    .join('\n\n');

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
