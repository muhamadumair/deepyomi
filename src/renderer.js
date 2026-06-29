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
const zoomLabel = document.getElementById('zoom-label');
const modeCropBtn = document.getElementById('mode-crop');
const modePanBtn = document.getElementById('mode-pan');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomFitBtn = document.getElementById('zoom-fit');

let currentPreviewUrl = null;
let cropNatural = null;   // selection mapped to natural image pixels (== image-local px)

// View transform state (transform-origin is top-left of #preview-wrap)
let zoom = 1;
let panX = 0;
let panY = 0;
let mode = 'crop';        // 'crop' | 'pan'
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 12;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function applyTransform() {
  previewWrap.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  zoomLabel.innerText = `${Math.round(zoom * 100)}%`;
}

// Reset the view so the whole page fits and is centered in the drop zone
function fitToViewport() {
  const iw = preview.naturalWidth;
  const ih = preview.naturalHeight;
  if (!iw || !ih) return;
  // Layout the image at its natural size; zoom handles the scaling.
  preview.style.width = `${iw}px`;
  preview.style.height = `${ih}px`;
  const vp = dropZone.getBoundingClientRect();
  const pad = 16;
  const z = clamp(Math.min((vp.width - pad) / iw, (vp.height - pad) / ih), MIN_ZOOM, MAX_ZOOM);
  zoom = z;
  panX = (vp.width - iw * z) / 2;
  panY = (vp.height - ih * z) / 2;
  applyTransform();
}

// Zoom toward a point given in drop-zone-local coordinates
function zoomAt(cx, cy, factor) {
  const newZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
  if (newZoom === zoom) return;
  panX = cx - (cx - panX) * (newZoom / zoom);
  panY = cy - (cy - panY) * (newZoom / zoom);
  zoom = newZoom;
  applyTransform();
}

function setMode(next) {
  mode = next;
  modeCropBtn.classList.toggle('active', mode === 'crop');
  modePanBtn.classList.toggle('active', mode === 'pan');
  dropZone.classList.toggle('mode-crop', mode === 'crop');
  dropZone.classList.toggle('mode-pan', mode === 'pan');
}

// Display the given image (File/Blob) in the upload area
function showPreview(imageSource) {
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
  }
  currentPreviewUrl = URL.createObjectURL(imageSource);
  preview.onload = () => {
    fitToViewport();
    preview.onload = null;
  };
  preview.src = currentPreviewUrl;
  dropZone.classList.add('has-image');
  actions.classList.add('visible');
  setMode('crop');
  resetCrop();
  statusText.style.color = '#cdd6f4';
  statusText.innerText = 'Drag to crop · scroll to zoom · switch to Pan to move.';
}

function resetCrop() {
  cropBox.style.display = 'none';
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

// --- Pointer interaction: drag-to-crop (crop mode) or drag-to-pan (pan mode) ---
// The image is laid out at its natural size, so image-local px == natural px.
let dragging = false;
let panning = false;
let startX = 0;          // crop start, in image-local px
let startY = 0;
let cropLocal = null;    // crop selection in image-local px
let panStartX = 0;       // pan start, in screen px
let panStartY = 0;
let panOriginX = 0;
let panOriginY = 0;

// Convert a screen point to image-local pixels, clamped to the image bounds
function toImageLocal(clientX, clientY) {
  const rect = preview.getBoundingClientRect();
  return {
    x: clamp((clientX - rect.left) / zoom, 0, preview.naturalWidth),
    y: clamp((clientY - rect.top) / zoom, 0, preview.naturalHeight),
  };
}

preview.addEventListener('mousedown', (e) => {
  e.preventDefault();
  // Pan with the pan mode (left button) or the middle mouse button in any mode
  if (mode === 'pan' || e.button === 1) {
    panning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panOriginX = panX;
    panOriginY = panY;
    dropZone.classList.add('grabbing');
    return;
  }
  const p = toImageLocal(e.clientX, e.clientY);
  dragging = true;
  startX = p.x;
  startY = p.y;
  cropBox.style.display = 'block';
  updateCropBox(startX, startY, 0, 0);
});

window.addEventListener('mousemove', (e) => {
  if (panning) {
    panX = panOriginX + (e.clientX - panStartX);
    panY = panOriginY + (e.clientY - panStartY);
    applyTransform();
    return;
  }
  if (!dragging) return;
  const p = toImageLocal(e.clientX, e.clientY);
  const x = Math.min(startX, p.x);
  const y = Math.min(startY, p.y);
  const w = Math.abs(p.x - startX);
  const h = Math.abs(p.y - startY);
  updateCropBox(x, y, w, h);
  cropLocal = { x, y, w, h };
});

window.addEventListener('mouseup', () => {
  if (panning) {
    panning = false;
    dropZone.classList.remove('grabbing');
    return;
  }
  if (!dragging) return;
  dragging = false;

  if (cropLocal && cropLocal.w > 5 && cropLocal.h > 5) {
    cropNatural = {
      x: Math.round(cropLocal.x),
      y: Math.round(cropLocal.y),
      w: Math.round(cropLocal.w),
      h: Math.round(cropLocal.h),
    };
    statusText.style.color = '#cdd6f4';
    statusText.innerText = 'Crop set. Click Extract & Translate.';
  } else {
    resetCrop();
  }
});

// Crop box lives inside the transformed wrapper, so it is sized in image-local px
function updateCropBox(x, y, w, h) {
  cropBox.style.left = `${x}px`;
  cropBox.style.top = `${y}px`;
  cropBox.style.width = `${w}px`;
  cropBox.style.height = `${h}px`;
}

// --- Zoom: mouse wheel toward cursor + toolbar buttons ---
dropZone.addEventListener('wheel', (e) => {
  if (!dropZone.classList.contains('has-image')) return;
  e.preventDefault();
  const vp = dropZone.getBoundingClientRect();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  zoomAt(e.clientX - vp.left, e.clientY - vp.top, factor);
}, { passive: false });

function zoomByCenter(factor) {
  const vp = dropZone.getBoundingClientRect();
  zoomAt(vp.width / 2, vp.height / 2, factor);
}

zoomInBtn.addEventListener('click', () => zoomByCenter(1.25));
zoomOutBtn.addEventListener('click', () => zoomByCenter(1 / 1.25));
zoomFitBtn.addEventListener('click', fitToViewport);
modeCropBtn.addEventListener('click', () => setMode('crop'));
modePanBtn.addEventListener('click', () => setMode('pan'));

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

    statusText.innerText = 'Opening DeepL (full text also copied to clipboard)...';
    statusText.style.color = '#a6e3a1';
    ipcRenderer.send('open-deepl', extractedText);

    setTimeout(() => { statusText.innerText = 'Ready'; }, 4000);
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
  preview.style.width = '';
  preview.style.height = '';
  dropZone.classList.remove('has-image');
  actions.classList.remove('visible');
  fileInput.value = '';
  zoom = 1;
  panX = 0;
  panY = 0;
  applyTransform();
  resetCrop();
  statusText.style.color = '#a6e3a1';
  statusText.innerText = 'Ready';
}

extractBtn.addEventListener('click', runExtract);
clearBtn.addEventListener('click', resetAll);
