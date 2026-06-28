const { ipcRenderer } = require('electron');

// OCR runs in the main process; show its progress here
ipcRenderer.on('ocr-progress', (event, pct) => {
  statusText.innerText = `Extracting Text: ${pct}%`;
});

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const statusText = document.getElementById('status');
const preview = document.getElementById('preview');
const previewWrap = document.getElementById('preview-wrap');
const cropBox = document.getElementById('crop-box');
const actions = document.getElementById('actions');
const extractBtn = document.getElementById('extract-btn');
const clearBtn = document.getElementById('clear-btn');

let currentPreviewUrl = null;
let cropDisplay = null;   // selection in on-screen pixels
let cropNatural = null;   // selection mapped to natural image pixels

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Display the given image (File/Blob) in the upload area
function showPreview(imageSource) {
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
  }
  currentPreviewUrl = URL.createObjectURL(imageSource);
  preview.src = currentPreviewUrl;
  dropZone.classList.add('has-image');
  actions.classList.add('visible');
  resetCrop();
  statusText.style.color = '#cdd6f4';
  statusText.innerText = 'Drag on the image to crop (optional), then Extract & Translate.';
}

function resetCrop() {
  cropBox.style.display = 'none';
  cropDisplay = null;
  cropNatural = null;
}

// Handle UI drag animations
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('hover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('hover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('hover');

  const files = e.dataTransfer.files;
  if (files.length > 0 && files[0].type.startsWith('image/')) {
    showPreview(files[0]);
  }
});

// Handle pasting an image from the clipboard while the window is active
window.addEventListener('paste', (e) => {
  const items = e.clipboardData.items;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile();
      if (blob) {
        showPreview(blob);
      }
      break;
    }
  }
});

// Allow clicking the empty area to upload a file alternatively
dropZone.addEventListener('click', () => {
  if (!dropZone.classList.contains('has-image')) fileInput.click();
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    showPreview(e.target.files[0]);
  }
});

// Prevent crop drags/clicks on the image from re-opening the file dialog
previewWrap.addEventListener('click', (e) => e.stopPropagation());

// --- Drag-to-crop selection over the preview image ---
let dragging = false;
let startX = 0;
let startY = 0;

preview.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const rect = preview.getBoundingClientRect();
  dragging = true;
  startX = clamp(e.clientX - rect.left, 0, rect.width);
  startY = clamp(e.clientY - rect.top, 0, rect.height);
  cropBox.style.display = 'block';
  updateCropBox(startX, startY, 0, 0);
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const rect = preview.getBoundingClientRect();
  const curX = clamp(e.clientX - rect.left, 0, rect.width);
  const curY = clamp(e.clientY - rect.top, 0, rect.height);
  const x = Math.min(startX, curX);
  const y = Math.min(startY, curY);
  const w = Math.abs(curX - startX);
  const h = Math.abs(curY - startY);
  updateCropBox(x, y, w, h);
  cropDisplay = { x, y, w, h };
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;

  if (cropDisplay && cropDisplay.w > 5 && cropDisplay.h > 5) {
    const scaleX = preview.naturalWidth / preview.clientWidth;
    const scaleY = preview.naturalHeight / preview.clientHeight;
    cropNatural = {
      x: Math.round(cropDisplay.x * scaleX),
      y: Math.round(cropDisplay.y * scaleY),
      w: Math.round(cropDisplay.w * scaleX),
      h: Math.round(cropDisplay.h * scaleY),
    };
    statusText.style.color = '#cdd6f4';
    statusText.innerText = 'Crop set. Click Extract & Translate.';
  } else {
    resetCrop();
  }
});

function updateCropBox(x, y, w, h) {
  cropBox.style.left = `${x}px`;
  cropBox.style.top = `${y}px`;
  cropBox.style.width = `${w}px`;
  cropBox.style.height = `${h}px`;
}

// --- Preprocess (crop + upscale + grayscale + Otsu threshold) for better OCR ---
async function buildProcessedBytes() {
  const nW = preview.naturalWidth;
  const nH = preview.naturalHeight;
  let { x: sx, y: sy, w: sw, h: sh } = cropNatural || { x: 0, y: 0, w: nW, h: nH };

  // Upscale small regions so glyphs are large enough for Tesseract
  const scale = clamp(1800 / sw, 1, 3);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(preview, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  // Grayscale + histogram
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;
  const gray = new Uint8ClampedArray(d.length / 4);
  const hist = new Array(256).fill(0);
  for (let i = 0, j = 0; i < d.length; i += 4, j += 1) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    gray[j] = g;
    hist[g] += 1;
  }

  // Otsu's method to find the optimal black/white threshold
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t += 1) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }

  // Binarize (dark text on light background)
  for (let i = 0, j = 0; i < d.length; i += 4, j += 1) {
    const v = gray[j] > threshold ? 255 : 0;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

// --- Extract & Translate ---
async function runExtract() {
  try {
    extractBtn.disabled = true;
    statusText.style.color = '#f9e2af';
    statusText.innerText = 'Preprocessing image...';
    const bytes = await buildProcessedBytes();

    statusText.innerText = 'Initializing Tesseract Engine...';
    const extractedText = await ipcRenderer.invoke('run-ocr', bytes);

    if (extractedText.trim().length === 0) {
      statusText.innerText = 'No Japanese text detected.';
      statusText.style.color = '#f38ba8';
      return;
    }

    statusText.innerText = 'Opening translation in DeepL...';
    statusText.style.color = '#a6e3a1';
    ipcRenderer.send('open-deepl', extractedText);

    setTimeout(() => { statusText.innerText = 'Ready'; }, 3000);
  } catch (error) {
    console.error(error);
    statusText.innerText = `OCR error: ${error.message || error}`;
    statusText.style.color = '#f38ba8';
  } finally {
    extractBtn.disabled = false;
  }
}

function resetAll() {
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = null;
  }
  preview.removeAttribute('src');
  dropZone.classList.remove('has-image');
  actions.classList.remove('visible');
  fileInput.value = '';
  resetCrop();
  statusText.style.color = '#a6e3a1';
  statusText.innerText = 'Ready';
}

extractBtn.addEventListener('click', runExtract);
clearBtn.addEventListener('click', resetAll);
