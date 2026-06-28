const { ipcRenderer } = require('electron');
const Tesseract = require('tesseract.js');

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const statusText = document.getElementById('status');
const preview = document.getElementById('preview');

let currentPreviewUrl = null;

// Display the given image (File/Blob) in the upload area
function showPreview(imageSource) {
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
  }
  currentPreviewUrl = URL.createObjectURL(imageSource);
  preview.src = currentPreviewUrl;
  dropZone.classList.add('has-image');
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
    processImage(files[0]);
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
        processImage(blob);
      }
      break;
    }
  }
});

// Allow clicking the area to upload a file alternatively
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    showPreview(e.target.files[0]);
    processImage(e.target.files[0]);
  }
});

// Core OCR & Communication Logic
async function processImage(imageSource) {
  statusText.innerText = 'Initializing Tesseract Engine...';
  statusText.style.color = '#f9e2af';

  try {
    const result = await Tesseract.recognize(imageSource, 'jpn_vert', {
      logger: m => {
        if (m.status === 'recognizing text') {
          statusText.innerText = `Extracting Text: ${Math.round(m.progress * 100)}%`;
        }
      }
    });

    const extractedText = result.data.text;

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
  }
}
