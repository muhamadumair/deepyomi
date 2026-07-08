const { ipcRenderer } = require('electron');

const bg = document.getElementById('bg');
const dim = document.getElementById('dim');
const selection = document.getElementById('selection');

let startX = 0;
let startY = 0;
let dragging = false;

ipcRenderer.on('snip-init', (event, dataUrl) => {
  bg.src = dataUrl;
});

document.addEventListener('mousedown', (e) => {
  dragging = true;
  startX = e.clientX;
  startY = e.clientY;
  dim.style.display = 'none';
  selection.style.display = 'block';
  updateSelection(startX, startY, 0, 0);
});

document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const x = Math.min(startX, e.clientX);
  const y = Math.min(startY, e.clientY);
  const w = Math.abs(e.clientX - startX);
  const h = Math.abs(e.clientY - startY);
  updateSelection(x, y, w, h);
});

document.addEventListener('mouseup', (e) => {
  if (!dragging) return;
  dragging = false;

  const x = Math.min(startX, e.clientX);
  const y = Math.min(startY, e.clientY);
  const w = Math.abs(e.clientX - startX);
  const h = Math.abs(e.clientY - startY);

  if (w < 4 || h < 4) {
    ipcRenderer.send('snip-cancel');
    return;
  }
  cropAndSend(x, y, w, h);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    ipcRenderer.send('snip-cancel');
  }
});

function updateSelection(x, y, w, h) {
  selection.style.left = `${x}px`;
  selection.style.top = `${y}px`;
  selection.style.width = `${w}px`;
  selection.style.height = `${h}px`;
}

async function cropAndSend(x, y, w, h) {
  // Map the CSS-pixel selection to the screenshot's natural pixel resolution
  // (the thumbnail is captured at a fixed size independent of the display's
  // DIP dimensions and scale factor).
  const scaleX = bg.naturalWidth / window.innerWidth;
  const scaleY = bg.naturalHeight / window.innerHeight;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scaleX);
  canvas.height = Math.round(h * scaleY);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    bg,
    x * scaleX, y * scaleY, w * scaleX, h * scaleY,
    0, 0, canvas.width, canvas.height
  );

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  ipcRenderer.send('snip-done', bytes);
}
