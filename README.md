# DeepYomi

> 読み (*yomi*, "reading") + a deep dive into your light novels.

**DeepYomi** is a small Electron desktop app that reads **vertical Japanese**
light-novel page scans, runs OCR on them, cleans up the text, and opens the
result in **DeepL** for translation — all from a single drag-and-drop window.

It's built for readers who hit a page they can't quite parse and want a fast,
low-friction way to get a translation without retyping anything.

---

## Features

- **Drag, paste, or pick** an image of a light-novel page.
- **Vertical (tategaki) OCR** via [Tesseract.js](https://github.com/naptha/tesseract.js)
  using the high-accuracy `jpn_vert` *best* model and a vertical-text page
  segmentation mode.
- **Crop tool** — drag a box over just the body text to exclude decorative
  title blocks before recognition.
- **Image preprocessing** — automatic crop, upscale, grayscale, and Otsu
  thresholding to sharpen dense kanji.
- **Light-novel text clean-up** — repairs common OCR artifacts (`《…》`
  guillemets, `「」` corner brackets, `……` ellipses, stray Latin letters) and
  puts each dialogue/monologue on its own line.
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
   or click to browse.
2. **Crop (optional)** — drag a box over the body text to skip the stylized
   title block. Drag a tiny/empty box to clear the selection.
3. **Extract & Translate** — the app preprocesses the image, runs OCR, formats
   the text, and opens DeepL. The text is also on your clipboard.
4. **Clear** — reset for the next page.

> First extraction may pause briefly while the OCR model downloads.

---

## Project structure

```
deepyomi/
├─ src/
│  ├─ main.js       # Electron main process: window, OCR worker, DeepL hand-off
│  ├─ renderer.js   # UI logic: drag/drop, crop tool, image preprocessing
│  └─ index.html    # App window markup and styles
├─ package.json
└─ README.md
```

## Notes & limitations

- OCR is not perfect on dense vertical kanji; occasional character mistakes are
  expected. The clean-up step fixes common, systematic errors only — the full
  text is copied to your clipboard so you can correct anything by hand.
- Designed and tested on Windows; it should run anywhere Electron does.

---

## Disclaimer

DeepYomi is **not affiliated with, endorsed by, or sponsored by DeepL SE**.
"DeepL" is a trademark of its respective owner. DeepYomi merely opens your
default browser to the public DeepL translator website.

Please respect copyright. Use DeepYomi only with material you have the right to
read and translate, for personal use.

## License

[MIT](LICENSE)
