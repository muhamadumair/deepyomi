const { ipcRenderer } = require('electron');

// OCR runs in the main process; show its progress here. currentBubbleLabel
// is set by runExtract() while looping through manga bubbles so the
// progress line can show which bubble is being processed.
let currentBubbleLabel = '';
ipcRenderer.on('ocr-progress', (event, pct) => {
  const prefix = currentBubbleLabel ? `${currentBubbleLabel} — ` : '';
  statusText.innerText = `${prefix}Extracting Text: ${pct}%`;
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
const fileNameEl = document.getElementById('file-name');
const zoomLabel = document.getElementById('zoom-label');
const modeCropBtn = document.getElementById('mode-crop');
const modePanBtn = document.getElementById('mode-pan');
const modeBubbleBtn = document.getElementById('mode-bubble');
const bubbleUndoBtn = document.getElementById('bubble-undo');
const bubbleClearBtn = document.getElementById('bubble-clear');
const bubbleCountEl = document.getElementById('bubble-count');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomFitBtn = document.getElementById('zoom-fit');
const snipBtn = document.getElementById('snip-btn');

let currentPreviewUrl = null;
let cropNatural = null;   // selection mapped to natural image pixels (== image-local px)

// Manga mode: an ordered list of speech-bubble regions (natural image px),
// in the order the user selected them (right-to-left, top-to-bottom is the
// natural manga reading order). Each entry has a matching overlay element.
let bubbleRegions = [];
let bubbleBoxEls = [];

// View transform state (transform-origin is top-left of #preview-wrap)
let zoom = 1;
let panX = 0;
let panY = 0;
let mode = 'crop';        // 'crop' | 'pan' | 'bubble'
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
  modeBubbleBtn.classList.toggle('active', mode === 'bubble');
  dropZone.classList.toggle('mode-crop', mode === 'crop');
  dropZone.classList.toggle('mode-pan', mode === 'pan');
  dropZone.classList.toggle('mode-bubble', mode === 'bubble');

  if (mode === 'bubble' && dropZone.classList.contains('has-image')) {
    statusText.style.color = '#cdd6f4';
    statusText.innerText = 'Manga mode: drag over each speech bubble in reading order (right → left, top → bottom).';
  }
}

// Add a new numbered bubble overlay for a selected region (natural image px)
function addBubble(region) {
  bubbleRegions.push(region);

  const el = document.createElement('div');
  el.className = 'bubble-box';
  el.style.left = `${region.x}px`;
  el.style.top = `${region.y}px`;
  el.style.width = `${region.w}px`;
  el.style.height = `${region.h}px`;

  const badge = document.createElement('span');
  badge.className = 'bubble-number';
  badge.textContent = String(bubbleRegions.length);
  el.appendChild(badge);

  previewWrap.appendChild(el);
  bubbleBoxEls.push(el);
  updateBubbleCount();
}

function undoBubble() {
  if (bubbleRegions.length === 0) return;
  bubbleRegions.pop();
  const el = bubbleBoxEls.pop();
  if (el) el.remove();
  updateBubbleCount();
}

function resetBubbles() {
  bubbleBoxEls.forEach((el) => el.remove());
  bubbleBoxEls = [];
  bubbleRegions = [];
  updateBubbleCount();
}

function updateBubbleCount() {
  const n = bubbleRegions.length;
  bubbleCountEl.textContent = `${n} bubble${n === 1 ? '' : 's'}`;
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
  const name = (imageSource && imageSource.name) ? imageSource.name : 'Pasted image';
  fileNameEl.textContent = name;
  fileNameEl.title = name;
  dropZone.classList.add('has-image');
  actions.classList.add('visible');
  setMode('crop');
  resetCrop();
  resetBubbles();
  statusText.style.color = '#cdd6f4';
  statusText.innerText = 'Drag to crop · scroll to zoom · switch to Pan to move.';
}

function resetCrop() {
  cropBox.style.display = 'none';
  cropNatural = null;
}

// Highlight the drop zone while a file is dragged over it
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
    const region = {
      x: Math.round(cropLocal.x),
      y: Math.round(cropLocal.y),
      w: Math.round(cropLocal.w),
      h: Math.round(cropLocal.h),
    };
    if (mode === 'bubble') {
      cropBox.style.display = 'none';
      addBubble(region);
    } else {
      cropNatural = region;
      statusText.style.color = '#cdd6f4';
      statusText.innerText = 'Crop set. Click Extract & Translate.';
    }
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
modeBubbleBtn.addEventListener('click', () => setMode('bubble'));
bubbleUndoBtn.addEventListener('click', undoBubble);
bubbleClearBtn.addEventListener('click', resetBubbles);

// Manga bubbles are round/cloud-shaped, but selections are rectangular, so
// the box's corners usually capture background art or screentone just
// outside the bubble. Tesseract then misreads that noise as extra (often
// Latin-looking) garbage characters mixed into the real dialogue. This
// flood-fills the bubble's white interior from the crop's center, then keeps
// only that interior plus a small margin (for the border/ink strokes),
// erasing everything else to white.
function trimToBubbleInterior(imgData, width, height) {
  const d = imgData.data;
  const total = width * height;
  const isWhite = (idx) => d[idx * 4] > 127;

  // Find a white seed near the center (nudge outward in case the exact
  // center lands on a character stroke).
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const maxR = Math.floor(Math.min(width, height) / 2);
  let seed = -1;
  seedSearch:
  for (let r = 0; r <= maxR; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const idx = y * width + x;
        if (isWhite(idx)) { seed = idx; break seedSearch; }
      }
    }
  }
  if (seed === -1) return; // No white anchor found — leave image untouched.

  // Flood-fill through white pixels only to find the bubble's interior.
  const keep = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  keep[seed] = 1;
  queue[tail] = seed; tail += 1;
  while (head < tail) {
    const idx = queue[head]; head += 1;
    const x = idx % width;
    const y = (idx / width) | 0;
    if (x > 0 && !keep[idx - 1] && isWhite(idx - 1)) { keep[idx - 1] = 1; queue[tail] = idx - 1; tail += 1; }
    if (x < width - 1 && !keep[idx + 1] && isWhite(idx + 1)) { keep[idx + 1] = 1; queue[tail] = idx + 1; tail += 1; }
    if (y > 0 && !keep[idx - width] && isWhite(idx - width)) { keep[idx - width] = 1; queue[tail] = idx - width; tail += 1; }
    if (y < height - 1 && !keep[idx + width] && isWhite(idx + width)) { keep[idx + width] = 1; queue[tail] = idx + width; tail += 1; }
  }

  // Dilate the interior by a small radius so the bubble's border and any
  // ink strokes right at its edge are preserved, not just the pure-white
  // interior.
  const radius = Math.max(4, Math.round(Math.min(width, height) * 0.02));
  let frontier = [];
  for (let i = 0; i < total; i += 1) if (keep[i]) frontier.push(i);
  for (let step = 0; step < radius && frontier.length > 0; step += 1) {
    const next = [];
    for (let k = 0; k < frontier.length; k += 1) {
      const idx = frontier[k];
      const x = idx % width;
      const y = (idx / width) | 0;
      if (x > 0 && !keep[idx - 1]) { keep[idx - 1] = 1; next.push(idx - 1); }
      if (x < width - 1 && !keep[idx + 1]) { keep[idx + 1] = 1; next.push(idx + 1); }
      if (y > 0 && !keep[idx - width]) { keep[idx - width] = 1; next.push(idx - width); }
      if (y < height - 1 && !keep[idx + width]) { keep[idx + width] = 1; next.push(idx + width); }
    }
    frontier = next;
  }

  // Erase everything outside the kept region (background art bleeding into
  // the rectangular selection's corners).
  for (let i = 0; i < total; i += 1) {
    if (!keep[i]) {
      const p = i * 4;
      d[p] = 255; d[p + 1] = 255; d[p + 2] = 255; d[p + 3] = 255;
    }
  }
}

// --- Preprocess (crop + upscale + grayscale + Otsu threshold) for better OCR ---
// Shared by the single-crop (light novel) flow and the per-bubble (manga) flow.
async function buildProcessedBytesForRegion(region, options = {}) {
  const nW = preview.naturalWidth;
  const nH = preview.naturalHeight;
  const { x: sx, y: sy, w: sw, h: sh } = region || { x: 0, y: 0, w: nW, h: nH };

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

  if (options.isBubble) {
    trimToBubbleInterior(imgData, canvas.width, canvas.height);
  }

  ctx.putImageData(imgData, 0, 0);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

async function buildProcessedBytes() {
  return buildProcessedBytesForRegion(cropNatural, { isBubble: false });
}

// --- Extract & Translate ---
async function runExtract() {
  try {
    extractBtn.disabled = true;
    statusText.style.color = '#f9e2af';

    let extractedText;

    if (mode === 'bubble' && bubbleRegions.length > 0) {
      // Manga mode: OCR each bubble separately, in the order they were
      // selected (right-to-left, top-to-bottom). Each bubble's text is
      // wrapped in 「…」 — same as light-novel dialogue — so formatNovelText's
      // existing bracket-based separation puts each one on its own line
      // instead of collapsing them into a single run-on line.
      const texts = [];
      for (let i = 0; i < bubbleRegions.length; i += 1) {
        currentBubbleLabel = `Bubble ${i + 1}/${bubbleRegions.length}`;
        statusText.innerText = `${currentBubbleLabel}: preprocessing...`;
        const bytes = await buildProcessedBytesForRegion(bubbleRegions[i], { isBubble: true });
        statusText.innerText = `${currentBubbleLabel}: running OCR...`;
        const text = await ipcRenderer.invoke('run-ocr', bytes);
        const trimmed = text.trim();
        if (trimmed) texts.push(`\u300C${trimmed}\u300D`);
      }
      currentBubbleLabel = '';
      extractedText = texts.join('\n\n');
    } else {
      statusText.innerText = 'Preprocessing image...';
      const bytes = await buildProcessedBytes();
      statusText.innerText = 'Initializing Tesseract Engine...';
      extractedText = await ipcRenderer.invoke('run-ocr', bytes);
    }

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
  fileNameEl.textContent = '';
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
  resetBubbles();
  statusText.style.color = '#a6e3a1';
  statusText.innerText = 'Ready';
}

// --- Snip Screenshot (Windows Snipping Tool style capture) ---
async function runSnip() {
  try {
    snipBtn.disabled = true;
    statusText.style.color = '#f9e2af';
    statusText.innerText = 'Select an area to snip... (Esc to cancel)';

    const bytes = await ipcRenderer.invoke('start-snip');
    if (!bytes) {
      statusText.style.color = '#a6adc8';
      statusText.innerText = 'Snip canceled.';
      return;
    }

    const file = new File([bytes], 'Snipped screenshot.png', { type: 'image/png' });
    showPreview(file);
  } catch (error) {
    console.error(error);
    statusText.innerText = `Snip error: ${error.message || error}`;
    statusText.style.color = '#f38ba8';
  } finally {
    snipBtn.disabled = false;
  }
}

extractBtn.addEventListener('click', runExtract);
clearBtn.addEventListener('click', resetAll);
snipBtn.addEventListener('click', runSnip);
