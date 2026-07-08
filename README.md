# DeepYomi

> 読み (*yomi*, "reading") + a deep dive into your light novels.

**DeepYomi** is a small Electron desktop app that reads **vertical Japanese**
light-novel pages and manga speech bubbles, runs OCR on them, cleans up the
text, and opens the result in **DeepL** for translation — all from a single
drag-and-drop window.

It's built for readers who hit a page they can't quite parse and want a fast,
low-friction way to get a translation without retyping anything.

---

## Features

- **Drag, paste, pick, or snip** an image of a light-novel page.
- **Snip Screenshot** — capture any region of your screen directly, Windows
  Snipping Tool style, without leaving the app. Works across multiple
  monitors.
- **Vertical (tategaki) OCR** via [Tesseract.js](https://github.com/naptha/tesseract.js)
  using the high-accuracy `jpn_vert` *best* model and a vertical-text page
  segmentation mode.
- **Full-size image viewer** — zoom (scroll wheel or toolbar), pan, and a
  crop tool, so you can work with the page at any resolution.
- **Crop tool** — drag a box over just the body text to exclude decorative
  title blocks before recognition.
- **Manga mode** — for pages with multiple speech bubbles, drag over each
  bubble in reading order (right → left, top → bottom); the app OCRs each
  bubble individually and stitches the dialogue together before translation.
- **Image preprocessing** — automatic crop, upscale, grayscale, and Otsu
  thresholding to sharpen dense kanji.
- **Light-novel text clean-up** — repairs common OCR artifacts (`《…》`
  guillemets, `「」` corner brackets, `……` ellipses, stray Latin letters) and
  puts each dialogue/monologue on its own line. Dialogue blocks missing a
  closing bracket are repaired structurally, including adding `？」` when a
  line ends in the question particle か.
- **One-click DeepL hand-off** — opens the translation in your browser and also
  copies the text to your clipboard as a fallback.

---

## Requirements

- [Node.js](https://nodejs.org/) (LTS recommended) and npm
- An internet connection on **first run** (the `jpn_vert` model is downloaded
  from a CDN and then cached)

## Getting started

```bash
# install dependencies
npm install

# launch the app
npm start
```

## Usage

1. **Load a page** — drag an image onto the window, paste from the clipboard,
   click to browse, or click **Snip Screenshot** to select a region of your
   screen (e.g. straight from an e-reader or browser).
2. **Crop (optional)** — drag a box over the body text to skip the stylized
   title block. Drag a tiny/empty box to clear the selection. Use the toolbar
   to zoom, fit, or switch to Pan mode to move around a zoomed-in page.
   - **For manga**, switch to **Manga mode** instead and drag a box over each
     speech bubble in the order you'd naturally read them (right to left,
     top to bottom, panel by panel). Each bubble gets a numbered outline;
     use **Undo**/**Clear** to fix mistakes.
3. **Extract & Translate** — the app preprocesses the image, runs OCR, formats
   the text, and opens DeepL. In Manga mode, it OCRs each bubble in order and
   joins the dialogue before translating. The text is also on your clipboard.
4. **Clear** — reset for the next page.

> First extraction may pause briefly while the OCR model downloads.

---

## Project structure

```
deepyomi/
├─ src/
│  ├─ main.js       # Electron main process: window, OCR worker, snip capture, DeepL hand-off
│  ├─ renderer.js   # UI logic: drag/drop, crop tool, zoom/pan, image preprocessing
│  ├─ index.html    # App window markup and styles
│  ├─ snip.js       # Snip overlay logic: region selection and cropping
│  └─ snip.html     # Full-screen transparent overlay used for screen snipping
├─ package.json
└─ README.md
```

## Notes & limitations

- OCR is not perfect on dense vertical kanji; occasional character mistakes are
  expected. The clean-up step fixes common, systematic errors only — the full
  text is copied to your clipboard so you can correct anything by hand.
- Designed and tested on Windows; it should run anywhere Electron does.
- **Manga mode** requires manually drawing a box over each speech bubble in
  reading order; there is no automatic bubble/panel detection. Sound effects
  and narration boxes outside bubbles are not treated specially — select
  whatever text regions you want extracted. Since bubbles are round but
  selections are rectangular, the app auto-trims each crop down to the
  bubble's white interior (flood-fill from the center) to discard background
  art/screentone the box's corners would otherwise capture — draw the box
  loosely around the bubble; it doesn't need to be pixel-perfect.
- **Snip Screenshot** uses Electron's `desktopCapturer`. On macOS this requires
  granting the app Screen Recording permission in System Settings.

---

## Disclaimer

DeepYomi is **not affiliated with, endorsed by, or sponsored by DeepL SE**.
"DeepL" is a trademark of its respective owner. DeepYomi merely opens your
default browser to the public DeepL translator website.

Please respect copyright. Use DeepYomi only with material you have the right to
read and translate, for personal use.

## License

[MIT](LICENSE)
