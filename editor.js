// editor.js — ScreenCapture Pro Editor

// =====================================================================
// State
// =====================================================================
let zoom = 1;
let currentTool = 'select';
let strokeColor  = '#e94560';
let strokeSize   = 3;
let blurRadius   = 8;
let fontSize     = 24;
let fillShape    = false;
let highlightColor = '#FFE500';
let stepCounter  = 1;

let isDrawing = false;
let startX = 0, startY = 0;
let isPanning = false, panStartX = 0, panStartY = 0, panScrollLeft = 0, panScrollTop = 0;
let highlightPoints = [];

let cropActive = false;
let cropRect   = { x: 0, y: 0, w: 0, h: 0 };
let cropDragMode = null, cropDragStart = null;

let pendingText    = null; // { x, y }
let pendingCallout = null; // { x, y, w, h }


// Undo stack holds { data: ImageData, label: string, time: Date }
const undoStack = [];
const redoStack = [];
let snapshot = null;

// =====================================================================
// DOM
// =====================================================================
const baseCanvas    = document.getElementById('baseCanvas');
const drawCanvas    = document.getElementById('drawCanvas');
const baseCtx       = baseCanvas.getContext('2d', { willReadFrequently: true });
const drawCtx       = drawCanvas.getContext('2d', { willReadFrequently: true });
const viewport      = document.getElementById('viewport');
const canvasContainer = document.getElementById('canvasContainer');
const loadingOverlay  = document.getElementById('loadingOverlay');
const loadingText     = document.getElementById('loadingText');
const zoomLabel       = document.getElementById('zoomLabel');
const undoBtn  = document.getElementById('undoBtn');
const redoBtn  = document.getElementById('redoBtn');
const historyBtn = document.getElementById('historyBtn');
const historyPanel  = document.getElementById('historyPanel');
const historyList   = document.getElementById('historyList');
const colorPicker   = document.getElementById('colorPicker');
const sizeSlider    = document.getElementById('sizeSlider');
const sizeVal       = document.getElementById('sizeVal');
const blurSlider    = document.getElementById('blurSlider');
const blurVal       = document.getElementById('blurVal');
const fontSizeSlider= document.getElementById('fontSizeSlider');
const fontSizeVal   = document.getElementById('fontSizeVal');
const fillCheck     = document.getElementById('fillCheck');
const fillOption    = document.getElementById('fillOption');
const blurOption    = document.getElementById('blurOption');
const fontSizeOption= document.getElementById('fontSizeOption');
const highlightColorOpt = document.getElementById('highlightColorOption');
const highlightColorPicker = document.getElementById('highlightColor');
const stepOption    = document.getElementById('stepOption');
const stepCountDisplay = document.getElementById('stepCountDisplay');
const stepReset     = document.getElementById('stepReset');
const cropOverlay   = document.getElementById('cropOverlay');
const cropBox       = document.getElementById('cropBox');
const cropBar       = document.getElementById('cropBar');
const textInput     = document.getElementById('textInput');
const stickyLayer   = document.getElementById('stickyLayer');
const toast         = document.getElementById('toast');
const jpegQualOpt   = document.getElementById('jpegQualOpt');
const jpegQualSlider= document.getElementById('jpegQual');
const jpegQualVal   = document.getElementById('jpegQualVal');

// =====================================================================
// Init
// =====================================================================
(async function init() {
  const captureId = new URLSearchParams(location.search).get('id');
  if (!captureId) { showError('No capture ID in URL.'); return; }

  const data = await chrome.runtime.sendMessage({ action: 'getCaptureData', id: captureId });
  if (!data) { showError('Capture data not found (may have expired).'); return; }

  loadingText.textContent = 'Stitching screenshot…';
  await stitchCaptures(data);
  loadingOverlay.classList.add('hidden');
  fitToWindow();
  saveUndoState('Initial');
})();

function showError(msg) {
  loadingText.textContent = msg;
  document.querySelector('.spinner').style.display = 'none';
}

// =====================================================================
// Stitching
// =====================================================================
async function stitchCaptures(data) {
  const captures    = data.captures;
  const meta        = data.meta || data;
  const viewportOnly = data.viewportOnly || meta.viewportOnly;

  if (viewportOnly || captures.length === 1) {
    const img = await loadImage(captures[0].dataUrl);
    baseCanvas.width  = img.naturalWidth;
    baseCanvas.height = img.naturalHeight;
    baseCtx.drawImage(img, 0, 0);
  } else {
    const imgs  = await Promise.all(captures.map(c => loadImage(c.dataUrl)));
    const imgW  = imgs[0].naturalWidth;
    const cssW  = captures[0].windowWidth || meta.windowWidth;
    const scale = cssW ? imgW / cssW : 1;

    baseCtx.imageSmoothingEnabled = false;

    if (meta.customScroll && meta.containerRect) {
      // Custom scroll container (SPA / iframe)
      const cr      = meta.containerRect;
      const totalH  = meta.totalHeight;
      const vpH     = meta.windowHeight;
      const vpW     = meta.windowWidth;
      const expH    = vpH - cr.height + totalH;

      const cW = Math.round(vpW  * scale);
      const cH = Math.round(expH * scale);
      baseCanvas.width  = cW;
      baseCanvas.height = cH;
      baseCtx.fillStyle = '#fff';
      baseCtx.fillRect(0, 0, cW, cH);

      const crT  = Math.round(cr.top    * scale);
      const crH  = Math.round(cr.height * scale);
      const imgH = imgs[0].naturalHeight;

      // Header: everything above the scroll container (top nav bar, etc.) — full width, from first frame
      if (crT > 0) baseCtx.drawImage(imgs[0], 0, 0, cW, crT, 0, 0, cW, crT);

      for (let i = 0; i < captures.length; i++) {
        const c  = captures[i];
        const dY = Math.round((cr.top + c.y) * scale);
        // Draw the FULL viewport width for this row so fixed sidebars (left nav, right panel)
        // are included — previously only the container column was drawn, leaving them blank.
        baseCtx.drawImage(imgs[i], 0, crT, cW, crH, 0, dY, cW, crH);
        loadingText.textContent = `Stitching… ${i+1}/${captures.length}`;
        await tick();
      }

      // Footer: everything below the scroll container — full width, from last frame
      const footerSrcY = crT + crH;
      const footerH    = imgH - footerSrcY;
      if (footerH > 0) {
        const footerDstY = Math.round((cr.top + totalH) * scale);
        baseCtx.drawImage(imgs[imgs.length - 1], 0, footerSrcY, cW, footerH, 0, footerDstY, cW, footerH);
      }
    } else {
      // Standard page
      const cW = Math.round(meta.totalWidth  * scale);
      const cH = Math.round(meta.totalHeight * scale);
      baseCanvas.width  = cW;
      baseCanvas.height = cH;
      baseCtx.fillStyle = '#fff';
      baseCtx.fillRect(0, 0, cW, cH);

      for (let i = 0; i < captures.length; i++) {
        const c = captures[i];
        baseCtx.drawImage(imgs[i], Math.round(c.x * scale), Math.round(c.y * scale));
        loadingText.textContent = `Stitching… ${i+1}/${captures.length}`;
        await tick();
      }
    }
  }

  drawCanvas.width  = baseCanvas.width;
  drawCanvas.height = baseCanvas.height;

  // Feature 8: URL + Timestamp stamp at bottom of baseCanvas
  if (meta && meta.urlStamp && meta.pageUrl) {
    const stampH   = 28;
    const origW    = baseCanvas.width;
    const origH    = baseCanvas.height;

    // Save current image
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width  = origW;
    tmpCanvas.height = origH;
    tmpCanvas.getContext('2d').drawImage(baseCanvas, 0, 0);

    // Resize base canvas to add stamp area
    baseCanvas.height = origH + stampH;
    drawCanvas.height = origH + stampH;
    baseCtx.drawImage(tmpCanvas, 0, 0);

    // Draw stamp bar
    baseCtx.fillStyle = '#1a1a2e';
    baseCtx.fillRect(0, origH, origW, stampH);

    const dateStr = meta.captureTime
      ? new Date(meta.captureTime).toLocaleString()
      : new Date().toLocaleString();
    const stampText = `${meta.pageUrl}  •  ${dateStr}`;

    baseCtx.fillStyle = '#a0a0c0';
    baseCtx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    baseCtx.textBaseline = 'middle';
    baseCtx.textAlign    = 'left';

    // Truncate URL if too long
    const maxW = origW - 16;
    let displayText = stampText;
    while (baseCtx.measureText(displayText).width > maxW && displayText.length > 20) {
      displayText = displayText.slice(0, displayText.length - 4) + '…';
    }
    baseCtx.fillText(displayText, 8, origH + stampH / 2);
    baseCtx.textBaseline = 'alphabetic';
    baseCtx.textAlign    = 'left';
  }
}

function loadImage(src) {
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src; });
}
function tick() { return new Promise(r => setTimeout(r, 0)); }

// =====================================================================
// Zoom
// =====================================================================
function setZoom(z) {
  zoom = Math.max(0.05, Math.min(8, z));
  canvasContainer.style.transform = `scale(${zoom})`;
  canvasContainer.style.marginBottom = `${baseCanvas.height * zoom - baseCanvas.height}px`;
  canvasContainer.style.marginRight  = `${baseCanvas.width  * zoom - baseCanvas.width}px`;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}
function fitToWindow() {
  const vw = viewport.clientWidth - 60, vh = viewport.clientHeight - 60;
  setZoom(Math.min(vw / baseCanvas.width, vh / baseCanvas.height, 1));
  viewport.scrollTop = viewport.scrollLeft = 0;
}

document.getElementById('zoomIn').addEventListener('click',  () => setZoom(zoom * 1.25));
document.getElementById('zoomOut').addEventListener('click', () => setZoom(zoom / 1.25));
document.getElementById('zoomFit').addEventListener('click', fitToWindow);
viewport.addEventListener('wheel', e => {
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom + (e.deltaY > 0 ? -0.1 : 0.1)); }
}, { passive: false });

// =====================================================================
// Tool selection
// =====================================================================
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => selectTool(btn.dataset.tool));
});

function selectTool(tool) {
  currentTool = tool;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));

  drawCanvas.style.cursor =
    tool === 'select'  ? 'grab'      :
    tool === 'text'    ? 'text'      :
    tool === 'step'    ? 'crosshair' :
    tool === 'sticky'  ? 'copy'      :
    tool === 'cursor'  ? 'crosshair' :
    'crosshair';

  // Option visibility
  fillOption.style.display          = ['rect','ellipse','callout'].includes(tool) ? 'flex' : 'none';
  blurOption.style.display          = tool === 'blur'      ? 'flex' : 'none';
  fontSizeOption.style.display      = ['text','callout'].includes(tool) ? 'flex' : 'none';
  highlightColorOpt.style.display   = tool === 'highlight' ? 'flex' : 'none';
  stepOption.style.display          = tool === 'step'      ? 'flex' : 'none';

  if (tool === 'crop') startCropMode(); else endCropMode();

  commitText();
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.target === textInput || e.target.classList.contains('sticky-textarea')) return;
  const key = e.key.toLowerCase();
  const map = {
    v:'select', p:'pen', h:'highlight', a:'arrow', l:'line', r:'rect',
    e:'ellipse', q:'callout', n:'step', t:'text', b:'blur', k:'sticky', c:'crop',
    m:'cursor'
  };
  if (map[key] && !e.ctrlKey && !e.metaKey) { selectTool(map[key]); return; }
  if ((e.ctrlKey||e.metaKey) && key==='z') { e.preventDefault(); undo(); }
  if ((e.ctrlKey||e.metaKey) && (key==='y'||(e.shiftKey&&key==='z'))) { e.preventDefault(); redo(); }
  if ((e.ctrlKey||e.metaKey) && key==='s') { e.preventDefault(); downloadPng(); }
  if (key==='='||key==='+') setZoom(zoom*1.25);
  if (key==='-') setZoom(zoom/1.25);
  if (key==='0') fitToWindow();
  if (key==='escape') { commitText(); }
});

// =====================================================================
// Options
// =====================================================================
colorPicker.addEventListener('input', () => { strokeColor = colorPicker.value; });
sizeSlider.addEventListener('input',  () => { strokeSize = +sizeSlider.value; sizeVal.textContent = strokeSize; });
blurSlider.addEventListener('input',  () => { blurRadius = +blurSlider.value; blurVal.textContent = blurRadius; });
fontSizeSlider.addEventListener('input', () => { fontSize = +fontSizeSlider.value; fontSizeVal.textContent = fontSize; });
fillCheck.addEventListener('change',  () => { fillShape = fillCheck.checked; });
highlightColorPicker.addEventListener('input', () => { highlightColor = highlightColorPicker.value; });
stepReset.addEventListener('click', () => { stepCounter = 1; stepCountDisplay.textContent = stepCounter; });

// Feature 7: JPEG quality slider
jpegQualSlider.addEventListener('input', () => {
  jpegQualVal.textContent = jpegQualSlider.value;
});
document.getElementById('jpegBtn').addEventListener('mouseenter', () => {
  jpegQualOpt.style.display = 'flex';
});
document.getElementById('jpegBtn').addEventListener('mouseleave', () => {
  // Keep visible while hovering quality slider
});
jpegQualOpt.addEventListener('mouseleave', () => {
  jpegQualOpt.style.display = 'none';
});

// =====================================================================
// Canvas coords
// =====================================================================
function canvasCoords(e) {
  const rect = drawCanvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
}

// =====================================================================
// Undo / Redo / History
// =====================================================================
function saveUndoState(label) {
  const state = {
    data:  drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height),
    label: label || currentTool,
    time:  new Date()
  };
  undoStack.push(state);
  if (undoStack.length > 40) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
  renderHistoryPanel();
}

function undo() {
  if (undoStack.length <= 1) return;
  redoStack.push(undoStack.pop());
  drawCtx.putImageData(undoStack[undoStack.length-1].data, 0, 0);
  updateUndoButtons();
  renderHistoryPanel();
}
function redo() {
  if (!redoStack.length) return;
  const s = redoStack.pop();
  undoStack.push(s);
  drawCtx.putImageData(s.data, 0, 0);
  updateUndoButtons();
  renderHistoryPanel();
}
function updateUndoButtons() {
  undoBtn.disabled = undoStack.length <= 1;
  redoBtn.disabled = redoStack.length === 0;
}
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

// History panel toggle
historyBtn.addEventListener('click', () => {
  const hidden = historyPanel.classList.toggle('hidden');
  historyBtn.classList.toggle('active', !hidden);
});
document.getElementById('closeHistory').addEventListener('click', () => {
  historyPanel.classList.add('hidden');
  historyBtn.classList.remove('active');
});

function renderHistoryPanel() {
  historyList.innerHTML = '';
  // Show newest first
  for (let i = undoStack.length - 1; i >= 0; i--) {
    const s    = undoStack[i];
    const item = document.createElement('div');
    item.className = 'history-item' + (i === undoStack.length - 1 ? ' current' : '');
    item.innerHTML = `
      <span class="history-num">${i+1}</span>
      <span class="history-label">${s.label}</span>
      <span class="history-time">${s.time.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>`;
    item.addEventListener('click', () => restoreHistory(i));
    historyList.appendChild(item);
  }
}

function restoreHistory(idx) {
  if (!undoStack[idx]) return;
  undoStack.splice(idx + 1);
  redoStack.length = 0;
  drawCtx.putImageData(undoStack[idx].data, 0, 0);
  updateUndoButtons();
  renderHistoryPanel();
}

// Snapshot for shape preview
function takeSnapshot()    { snapshot = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height); }
function restoreSnapshot() { if (snapshot) drawCtx.putImageData(snapshot, 0, 0); }

// =====================================================================
// Mouse events
// =====================================================================
drawCanvas.addEventListener('mousedown', onMouseDown);
drawCanvas.addEventListener('mousemove', onMouseMove);
drawCanvas.addEventListener('mouseup',   onMouseUp);
drawCanvas.addEventListener('mouseleave', onMouseLeave);

viewport.addEventListener('mousedown', e => {
  if (pendingText && e.target !== textInput && e.target !== drawCanvas) commitText();
});

function onMouseDown(e) {
  if (e.button !== 0) return;
  const { x, y } = canvasCoords(e);

  if (currentTool === 'select') {
    isPanning = true;
    panStartX = e.clientX; panStartY = e.clientY;
    panScrollLeft = viewport.scrollLeft; panScrollTop = viewport.scrollTop;
    drawCanvas.style.cursor = 'grabbing';
    return;
  }
  if (currentTool === 'text') {
    commitText(); showTextInput(x, y);
    e.stopPropagation(); return;
  }
  if (currentTool === 'step') {
    placeStep(x, y); return;
  }
  if (currentTool === 'sticky') {
    placeSticky(x, y); return;
  }
  if (currentTool === 'cursor') {
    placeCursor(x, y); return;
  }
  if (currentTool === 'crop') return;


  isDrawing = true;
  startX = x; startY = y;
  takeSnapshot();

  if (currentTool === 'pen') {
    drawCtx.beginPath();
    drawCtx.moveTo(x, y);
    applyDrawStyle();
  } else if (currentTool === 'highlight') {
    highlightPoints = [{ x, y }];
  }
}

function onMouseMove(e) {
  const { x, y } = canvasCoords(e);
  if (isPanning) {
    viewport.scrollLeft = panScrollLeft - (e.clientX - panStartX);
    viewport.scrollTop  = panScrollTop  - (e.clientY - panStartY);
    return;
  }



  if (!isDrawing) return;

  switch (currentTool) {
    case 'pen':
      applyDrawStyle();
      drawCtx.lineTo(x, y); drawCtx.stroke();
      break;
    case 'highlight':
      highlightPoints.push({ x, y });
      restoreSnapshot();
      drawHighlightStroke(highlightPoints);
      break;
    case 'line':    restoreSnapshot(); drawLine(startX, startY, x, y); break;
    case 'arrow':   restoreSnapshot(); drawArrow(startX, startY, x, y); break;
    case 'rect':    restoreSnapshot(); drawRect(startX, startY, x-startX, y-startY); break;
    case 'ellipse': restoreSnapshot(); drawEllipse(startX, startY, x-startX, y-startY); break;
    case 'callout': restoreSnapshot(); previewCallout(startX, startY, x-startX, y-startY); break;
    case 'blur':    restoreSnapshot(); previewBlur(startX, startY, x-startX, y-startY); break;
  }
}

function onMouseUp(e) {
  const { x, y } = canvasCoords(e);
  if (isPanning) { isPanning = false; drawCanvas.style.cursor = 'grab'; return; }



  if (!isDrawing) return;
  isDrawing = false;

  if (currentTool === 'blur') {
    restoreSnapshot();
    applyBlur(startX, startY, x-startX, y-startY);
    saveUndoState('Blur');
  } else if (currentTool === 'callout') {
    restoreSnapshot();
    const w = x - startX, h = y - startY;
    if (Math.abs(w) > 20 && Math.abs(h) > 20) {
      showCalloutInput(startX, startY, w, h);
    }
  } else if (currentTool !== 'pen' && currentTool !== 'highlight') {
    const toolLabel = { line:'Line', arrow:'Arrow', rect:'Rectangle', ellipse:'Ellipse' }[currentTool] || currentTool;
    saveUndoState(toolLabel);
  } else {
    saveUndoState(currentTool === 'highlight' ? 'Highlight' : 'Pen');
  }
  snapshot = null;
}

function onMouseLeave() {
  if (isDrawing && currentTool === 'pen') {
    drawCtx.closePath(); saveUndoState('Pen'); isDrawing = false;
  }
  if (isDrawing && currentTool === 'highlight') {
    drawHighlightStroke(highlightPoints); saveUndoState('Highlight'); isDrawing = false;
  }
  if (isOcrDragging) { isOcrDragging = false; restoreSnapshot(); }
  if (isPanning) { isPanning = false; drawCanvas.style.cursor = 'grab'; }
}

// =====================================================================
// Draw style
// =====================================================================
function applyDrawStyle() {
  if (currentTool === 'highlight') {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = highlightColor;
    drawCtx.lineWidth   = Math.max(strokeSize * 6, 20);
    drawCtx.lineCap     = 'square';
    drawCtx.lineJoin    = 'round';
    drawCtx.globalAlpha = 0.38;
  } else {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = strokeColor;
    drawCtx.lineWidth   = strokeSize;
    drawCtx.lineCap     = 'round';
    drawCtx.lineJoin    = 'round';
    drawCtx.globalAlpha = 1;
  }
}

function drawHighlightStroke(points) {
  if (points.length < 2) return;
  drawCtx.save();
  drawCtx.globalCompositeOperation = 'source-over';
  drawCtx.globalAlpha = 0.38;
  drawCtx.strokeStyle = highlightColor;
  drawCtx.lineWidth   = Math.max(strokeSize * 6, 20);
  drawCtx.lineCap     = 'square';
  drawCtx.lineJoin    = 'round';
  drawCtx.beginPath();
  drawCtx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) drawCtx.lineTo(points[i].x, points[i].y);
  drawCtx.stroke();
  drawCtx.restore();
}

function resetCtxStyle() {
  drawCtx.globalCompositeOperation = 'source-over';
  drawCtx.globalAlpha = 1;
  drawCtx.lineCap  = 'round';
  drawCtx.lineJoin = 'round';
}

// =====================================================================
// Primitives
// =====================================================================
function drawLine(x1, y1, x2, y2) {
  resetCtxStyle(); applyDrawStyle();
  drawCtx.beginPath(); drawCtx.moveTo(x1, y1); drawCtx.lineTo(x2, y2); drawCtx.stroke();
}

function drawArrow(x1, y1, x2, y2) {
  resetCtxStyle(); applyDrawStyle();
  const angle = Math.atan2(y2-y1, x2-x1);
  const headLen = Math.max(strokeSize*4, 14);
  const spread  = Math.PI/6;
  drawCtx.beginPath(); drawCtx.moveTo(x1,y1); drawCtx.lineTo(x2,y2); drawCtx.stroke();
  drawCtx.beginPath();
  drawCtx.moveTo(x2,y2);
  drawCtx.lineTo(x2 - headLen*Math.cos(angle-spread), y2 - headLen*Math.sin(angle-spread));
  drawCtx.lineTo(x2 - headLen*Math.cos(angle+spread), y2 - headLen*Math.sin(angle+spread));
  drawCtx.closePath(); drawCtx.fillStyle = strokeColor; drawCtx.fill();
}

function drawRect(x, y, w, h) {
  resetCtxStyle(); applyDrawStyle();
  if (fillShape) {
    drawCtx.fillStyle = strokeColor; drawCtx.globalAlpha = 0.2;
    drawCtx.fillRect(x, y, w, h); drawCtx.globalAlpha = 1;
  }
  drawCtx.strokeRect(x, y, w, h);
}

function drawEllipse(x, y, w, h) {
  resetCtxStyle(); applyDrawStyle();
  const cx = x+w/2, cy = y+h/2, rx = Math.abs(w/2), ry = Math.abs(h/2);
  drawCtx.beginPath(); drawCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2);
  if (fillShape) {
    drawCtx.fillStyle = strokeColor; drawCtx.globalAlpha = 0.2;
    drawCtx.fill(); drawCtx.globalAlpha = 1;
  }
  drawCtx.stroke();
}

// =====================================================================
// Callout Bubble
// =====================================================================
function previewCallout(x, y, w, h) {
  drawCtx.save();
  drawCtx.setLineDash([6,4]);
  drawCtx.strokeStyle = strokeColor;
  drawCtx.lineWidth   = strokeSize;
  drawCtx.globalAlpha = 0.7;
  drawCalloutShape(x, y, w, h);
  drawCtx.restore();
}

function drawCalloutShape(x, y, w, h) {
  let rx = w < 0 ? x+w : x;
  let ry = h < 0 ? y+h : y;
  let rw = Math.abs(w), rh = Math.abs(h);
  if (rw < 8 || rh < 8) return;

  const r    = Math.min(10, rw*0.15, rh*0.15);
  const tailH = Math.min(rh * 0.35, 24);
  const tailW = Math.min(rw * 0.25, 20);

  drawCtx.beginPath();
  drawCtx.moveTo(rx + r, ry);
  drawCtx.lineTo(rx + rw - r, ry);
  drawCtx.arcTo(rx+rw, ry,    rx+rw, ry+r,    r);
  drawCtx.lineTo(rx+rw, ry+rh-r);
  drawCtx.arcTo(rx+rw, ry+rh, rx+rw-r, ry+rh, r);
  drawCtx.lineTo(rx + tailW*2, ry+rh);
  drawCtx.lineTo(rx + tailW,   ry+rh+tailH);
  drawCtx.lineTo(rx + tailW*0.4, ry+rh);
  drawCtx.lineTo(rx + r, ry+rh);
  drawCtx.arcTo(rx, ry+rh, rx, ry+rh-r, r);
  drawCtx.lineTo(rx, ry+r);
  drawCtx.arcTo(rx, ry, rx+r, ry, r);
  drawCtx.closePath();
}

function showCalloutInput(x, y, w, h) {
  pendingCallout = { x, y, w, h };
  pendingText    = { x: (w>0?x:x+w) + 8, y: (h>0?y:y+h) + 8 };
  textInput.style.display   = 'block';
  textInput.style.left      = `${pendingText.x}px`;
  textInput.style.top       = `${pendingText.y}px`;
  textInput.style.minWidth  = `${Math.max(60, Math.abs(w)-16)}px`;
  textInput.style.minHeight = `${Math.max(40, Math.abs(h)-16)}px`;
  const apparent = fontSize * zoom;
  if (apparent < 14) {
    const comp = 14 / apparent;
    textInput.style.fontSize = `${fontSize * comp}px`;
    textInput.style.transform = `scale(${1/comp})`;
    textInput.style.transformOrigin = 'top left';
  } else {
    textInput.style.fontSize  = `${fontSize}px`;
    textInput.style.transform = 'none';
  }
  textInput.style.color = strokeColor;
  textInput.value = '';
  setTimeout(() => textInput.focus(), 50);
}

function commitCallout() {
  if (!pendingCallout) return;
  const { x, y, w, h } = pendingCallout;
  resetCtxStyle(); applyDrawStyle();

  drawCalloutShape(x, y, w, h);
  if (fillShape) {
    drawCtx.fillStyle = strokeColor; drawCtx.globalAlpha = 0.12;
    drawCtx.fill(); drawCtx.globalAlpha = 1;
  }
  drawCtx.setLineDash([]); drawCtx.stroke();

  const text = textInput.value.trim();
  if (text) {
    const bx = w < 0 ? x+w : x;
    const by = h < 0 ? y+h : y;
    drawCtx.font      = `${fontSize}px -apple-system, sans-serif`;
    drawCtx.fillStyle = strokeColor; drawCtx.globalAlpha = 1;
    text.split('\n').forEach((line, i) => {
      drawCtx.fillText(line, bx+10, by + fontSize + 2 + i*(fontSize*1.3));
    });
  }

  resetCtxStyle();
  textInput.style.display = 'none'; textInput.value = '';
  pendingText = null; pendingCallout = null;
  saveUndoState('Callout');
}

// =====================================================================
// Numbered Step
// =====================================================================
function placeStep(x, y) {
  const r = Math.max(strokeSize * 3, fontSize * 0.75, 14);
  resetCtxStyle();
  drawCtx.beginPath();
  drawCtx.arc(x, y, r, 0, Math.PI*2);
  drawCtx.fillStyle = strokeColor; drawCtx.globalAlpha = 1;
  drawCtx.fill();

  drawCtx.fillStyle = '#fff';
  drawCtx.font = `bold ${Math.round(r * 1.1)}px -apple-system, sans-serif`;
  drawCtx.textAlign    = 'center';
  drawCtx.textBaseline = 'middle';
  drawCtx.fillText(stepCounter.toString(), x, y);
  drawCtx.textAlign    = 'left';
  drawCtx.textBaseline = 'alphabetic';

  stepCounter++;
  stepCountDisplay.textContent = stepCounter;
  saveUndoState(`Step ${stepCounter-1}`);
}

// =====================================================================
// Feature 9: Cursor/Pointer Annotation Tool
// =====================================================================
function placeCursor(x, y) {
  resetCtxStyle();

  // Classic cursor arrow pointing up-left
  const s = Math.max(strokeSize * 2, 20); // scale factor
  // Cursor polygon points (normalized 0-1 space, scaled to s)
  // Standard cursor arrow shape
  const pts = [
    [0, 0],
    [0, s * 0.85],
    [s * 0.25, s * 0.62],
    [s * 0.45, s],
    [s * 0.56, s * 0.96],
    [s * 0.36, s * 0.58],
    [s * 0.62, s * 0.58],
  ];

  drawCtx.save();
  drawCtx.translate(x, y);

  // Shadow for visibility
  drawCtx.shadowColor   = 'rgba(0,0,0,0.4)';
  drawCtx.shadowBlur    = 3;
  drawCtx.shadowOffsetX = 1;
  drawCtx.shadowOffsetY = 1;

  // White fill
  drawCtx.beginPath();
  drawCtx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) drawCtx.lineTo(pts[i][0], pts[i][1]);
  drawCtx.closePath();
  drawCtx.fillStyle = '#ffffff';
  drawCtx.fill();

  // Black outline
  drawCtx.shadowColor = 'transparent';
  drawCtx.strokeStyle = '#000000';
  drawCtx.lineWidth   = Math.max(1.5, strokeSize * 0.5);
  drawCtx.lineJoin    = 'round';
  drawCtx.stroke();

  drawCtx.restore();
  saveUndoState('Cursor');
}

// =====================================================================
// Blur
// =====================================================================
function previewBlur(x, y, w, h) {
  drawCtx.save();
  drawCtx.setLineDash([]);
  drawCtx.strokeStyle = 'rgba(0,0,0,0.75)'; drawCtx.lineWidth = 4;
  drawCtx.strokeRect(x, y, w, h);
  drawCtx.setLineDash([8, 5]);
  drawCtx.strokeStyle = '#ff4466'; drawCtx.lineWidth = 3;
  drawCtx.strokeRect(x, y, w, h);
  drawCtx.fillStyle = 'rgba(255,68,102,0.15)'; drawCtx.fillRect(x, y, w, h);
  drawCtx.restore();
}

function applyBlur(x, y, w, h) {
  let rx = w<0?x+w:x, ry = h<0?y+h:y, rw = Math.abs(w), rh = Math.abs(h);
  if (rw < 4 || rh < 4) return;

  const tmp = document.createElement('canvas');
  tmp.width = rw; tmp.height = rh;
  const tc  = tmp.getContext('2d');
  tc.drawImage(baseCanvas, rx, ry, rw, rh, 0, 0, rw, rh);
  tc.drawImage(drawCanvas, rx, ry, rw, rh, 0, 0, rw, rh);

  const f  = Math.max(2, blurRadius);
  const pw = Math.max(1, Math.round(rw/f));
  const ph = Math.max(1, Math.round(rh/f));

  const sm = document.createElement('canvas');
  sm.width = pw; sm.height = ph;
  const sc = sm.getContext('2d');
  sc.imageSmoothingEnabled = true;
  sc.drawImage(tmp, 0, 0, pw, ph);

  tc.clearRect(0, 0, rw, rh);
  tc.imageSmoothingEnabled = false;
  tc.drawImage(sm, 0, 0, rw, rh);
  drawCtx.drawImage(tmp, rx, ry);
}

// =====================================================================
// Text tool
// =====================================================================
function showTextInput(x, y) {
  pendingText    = { x, y };
  pendingCallout = null;
  textInput.style.display   = 'block';
  textInput.style.left      = `${x}px`;
  textInput.style.top       = `${y}px`;
  const apparent = fontSize * zoom;
  if (apparent < 14) {
    const comp = 14 / apparent;
    textInput.style.fontSize = `${fontSize * comp}px`;
    textInput.style.transform = `scale(${1/comp})`;
    textInput.style.transformOrigin = 'top left';
  } else {
    textInput.style.fontSize  = `${fontSize}px`;
    textInput.style.transform = 'none';
  }
  textInput.style.color    = strokeColor;
  textInput.style.minWidth = `${Math.max(150, (baseCanvas.width - x)*0.5)}px`;
  textInput.value = '';
  setTimeout(() => textInput.focus(), 50);
}

textInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { pendingText = pendingCallout = null; textInput.style.display = 'none'; textInput.value = ''; }
  else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
});
textInput.addEventListener('blur', () => {
  setTimeout(() => { if (pendingText || pendingCallout) commitText(); }, 150);
});

function commitText() {
  if (pendingCallout) { commitCallout(); return; }
  if (!pendingText || textInput.style.display === 'none') return;
  const text = textInput.value.trim();
  if (text) {
    resetCtxStyle();
    drawCtx.font      = `bold ${fontSize}px -apple-system, sans-serif`;
    drawCtx.fillStyle = strokeColor; drawCtx.globalAlpha = 1;
    text.split('\n').forEach((line, i) => {
      drawCtx.fillText(line, pendingText.x, pendingText.y + fontSize + i*(fontSize*1.3));
    });
    saveUndoState('Text');
  }
  textInput.style.display   = 'none';
  textInput.style.transform = 'none';
  textInput.value = '';
  pendingText = null;
}

// =====================================================================
// Sticky Notes
// =====================================================================
const STICKY_COLORS = ['#FFF9C4','#C8F7C5','#C8E6FF','#FFCDD2','#E1D5F7'];
let stickyIdCounter = 0;

function placeSticky(canvasX, canvasY) {
  const id   = ++stickyIdCounter;
  const color = STICKY_COLORS[(id-1) % STICKY_COLORS.length];

  const el = document.createElement('div');
  el.className = 'sticky-note';
  el.dataset.id = id;
  el.style.left = `${canvasX}px`;
  el.style.top  = `${canvasY}px`;
  el.style.background = color;
  el.style.width = '180px';

  // Header
  const header = document.createElement('div');
  header.className = 'sticky-header';
  header.style.background = shadeColor(color, -12);

  const drag = document.createElement('span');
  drag.className = 'sticky-drag'; drag.textContent = '⠿';

  const colorDots = document.createElement('div');
  colorDots.className = 'sticky-colors';
  STICKY_COLORS.forEach(c => {
    const dot = document.createElement('div');
    dot.className = 'sticky-color-dot';
    dot.style.background = c;
    dot.addEventListener('click', () => {
      el.style.background = c;
      header.style.background = shadeColor(c, -12);
    });
    colorDots.appendChild(dot);
  });

  const del = document.createElement('button');
  del.className = 'sticky-delete'; del.textContent = '×';
  del.addEventListener('click', () => el.remove());

  header.append(drag, colorDots, del);

  // Textarea
  const ta = document.createElement('textarea');
  ta.className     = 'sticky-textarea';
  ta.placeholder   = 'Type note…';
  ta.style.background = 'transparent';

  el.append(header, ta);
  stickyLayer.appendChild(el);

  // Enable dragging via header
  makeDraggable(el, header);

  // Focus textarea
  setTimeout(() => ta.focus(), 60);
}

function makeDraggable(el, handle) {
  let ox = 0, oy = 0, mx = 0, my = 0;
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    ox = el.offsetLeft; oy = el.offsetTop;
    mx = e.clientX;     my = e.clientY;
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup',   drop);
  });
  function drag(e) {
    el.style.left = `${ox + (e.clientX - mx) / zoom}px`;
    el.style.top  = `${oy + (e.clientY - my) / zoom}px`;
  }
  function drop() {
    document.removeEventListener('mousemove', drag);
    document.removeEventListener('mouseup',   drop);
  }
}

function shadeColor(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n>>16) + pct));
  const g = Math.min(255, Math.max(0, ((n>>8)&0xFF) + pct));
  const b = Math.min(255, Math.max(0, (n&0xFF) + pct));
  return `rgb(${r},${g},${b})`;
}

// =====================================================================
// Crop
// =====================================================================
function startCropMode() {
  cropRect = { x:0, y:0, w:baseCanvas.width, h:baseCanvas.height };
  updateCropBox();
  cropOverlay.style.display = 'block'; cropBar.style.display = 'flex';
  cropActive = true; bindCropEvents();
}
function endCropMode() {
  cropOverlay.style.display = 'none'; cropBar.style.display = 'none';
  cropActive = false; unbindCropEvents();
}
function updateCropBox() {
  cropBox.style.left   = `${cropRect.x * zoom}px`;
  cropBox.style.top    = `${cropRect.y * zoom}px`;
  cropBox.style.width  = `${cropRect.w * zoom}px`;
  cropBox.style.height = `${cropRect.h * zoom}px`;
}
function bindCropEvents() {
  cropBox.addEventListener('mousedown', cropBoxMouseDown);
  document.querySelectorAll('.crop-handle').forEach(h => h.addEventListener('mousedown', cropHandleMouseDown));
  document.addEventListener('mousemove', cropMouseMove);
  document.addEventListener('mouseup',   cropMouseUp);
}
function unbindCropEvents() {
  cropBox.removeEventListener('mousedown', cropBoxMouseDown);
  document.querySelectorAll('.crop-handle').forEach(h => h.removeEventListener('mousedown', cropHandleMouseDown));
  document.removeEventListener('mousemove', cropMouseMove);
  document.removeEventListener('mouseup',   cropMouseUp);
}
function cropBoxMouseDown(e) {
  e.stopPropagation(); cropDragMode = 'move';
  cropDragStart = { mx:e.clientX, my:e.clientY, rect:{...cropRect} };
}
function cropHandleMouseDown(e) {
  e.stopPropagation();
  const cls = e.currentTarget.classList;
  cropDragMode = cls.contains('tl')?'tl': cls.contains('tr')?'tr': cls.contains('bl')?'bl':'br';
  cropDragStart = { mx:e.clientX, my:e.clientY, rect:{...cropRect} };
}
function cropMouseMove(e) {
  if (!cropDragMode||!cropDragStart) return;
  const dx = (e.clientX-cropDragStart.mx)/zoom, dy = (e.clientY-cropDragStart.my)/zoom;
  const r  = cropDragStart.rect, cw = baseCanvas.width, ch = baseCanvas.height;
  if      (cropDragMode==='move') { cropRect.x=Math.max(0,Math.min(cw-r.w,r.x+dx)); cropRect.y=Math.max(0,Math.min(ch-r.h,r.y+dy)); }
  else if (cropDragMode==='tl')   { cropRect.x=Math.max(0,Math.min(r.x+r.w-10,r.x+dx)); cropRect.y=Math.max(0,Math.min(r.y+r.h-10,r.y+dy)); cropRect.w=r.x+r.w-cropRect.x; cropRect.h=r.y+r.h-cropRect.y; }
  else if (cropDragMode==='tr')   { cropRect.y=Math.max(0,Math.min(r.y+r.h-10,r.y+dy)); cropRect.w=Math.max(10,Math.min(cw-r.x,r.w+dx)); cropRect.h=r.y+r.h-cropRect.y; }
  else if (cropDragMode==='bl')   { cropRect.x=Math.max(0,Math.min(r.x+r.w-10,r.x+dx)); cropRect.w=r.x+r.w-cropRect.x; cropRect.h=Math.max(10,Math.min(ch-r.y,r.h+dy)); }
  else if (cropDragMode==='br')   { cropRect.w=Math.max(10,Math.min(cw-r.x,r.w+dx)); cropRect.h=Math.max(10,Math.min(ch-r.y,r.h+dy)); }
  updateCropBox();
}
function cropMouseUp() { cropDragMode = null; cropDragStart = null; }

document.getElementById('cropApply').addEventListener('click', applyCrop);
document.getElementById('cropCancel').addEventListener('click', () => selectTool('select'));

function applyCrop() {
  const { x,y,w,h } = cropRect;
  if (w<2||h<2) return;
  const merged  = mergedCanvas(true);

  const cropped = document.createElement('canvas');
  cropped.width = w; cropped.height = h;
  cropped.getContext('2d').drawImage(merged, x, y, w, h, 0, 0, w, h);

  baseCanvas.width = w; baseCanvas.height = h;
  baseCtx.drawImage(cropped, 0, 0);
  drawCanvas.width = w; drawCanvas.height = h;
  drawCtx.clearRect(0, 0, w, h);
  stickyLayer.innerHTML = '';

  undoStack.length = 0; redoStack.length = 0;
  saveUndoState('Crop');
  selectTool('select'); fitToWindow();
  showToast('Crop applied', 'success');
}

// =====================================================================
// Merge (export helper)
// =====================================================================
function mergedCanvas(includeStickyNotes = true) {
  const merged = document.createElement('canvas');
  merged.width  = baseCanvas.width;
  merged.height = baseCanvas.height;
  const ctx = merged.getContext('2d');
  ctx.drawImage(baseCanvas, 0, 0);
  ctx.drawImage(drawCanvas, 0, 0);

  if (includeStickyNotes) {
    document.querySelectorAll('.sticky-note').forEach(sticky => {
      const x  = parseFloat(sticky.style.left)  || 0;
      const y  = parseFloat(sticky.style.top)   || 0;
      const w  = sticky.offsetWidth  || 180;
      const h  = sticky.offsetHeight || 120;
      const bg = sticky.style.background || '#FFF9C4';
      const ta = sticky.querySelector('.sticky-textarea');
      const text = ta ? ta.value : '';
      const header = sticky.querySelector('.sticky-header');
      const hh = header ? header.offsetHeight || 24 : 24;

      ctx.fillStyle = bg;
      ctx.fillRect(x, y, w, h);

      ctx.fillStyle = header ? header.style.background || shadeColor(bg,-12) : shadeColor(bg,-12);
      ctx.fillRect(x, y, w, hh);

      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth   = 1;
      ctx.strokeRect(x, y, w, h);

      if (text) {
        ctx.fillStyle = '#222';
        ctx.font = '13px -apple-system, sans-serif';
        ctx.textBaseline = 'top';
        const maxW  = w - 16;
        const lines = wrapText(ctx, text, maxW);
        lines.forEach((line, i) => ctx.fillText(line, x+8, y+hh+6+i*18, maxW));
        ctx.textBaseline = 'alphabetic';
      }
    });
  }
  return merged;
}

function wrapText(ctx, text, maxWidth) {
  const words  = text.split(' ');
  const lines  = [];
  let current  = '';
  words.forEach(w => {
    const test = current ? current+' '+w : w;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current); current = w;
    } else { current = test; }
  });
  if (current) lines.push(current);
  return lines;
}

// =====================================================================
// Export
// =====================================================================
document.getElementById('downloadBtn').addEventListener('click', downloadPng);
document.getElementById('copyBtn').addEventListener('click', copyToClipboard);
document.getElementById('jpegBtn').addEventListener('click', downloadJpeg);
document.getElementById('pdfBtn').addEventListener('click', downloadPdf);

function downloadPng() {
  const link = document.createElement('a');
  link.download = `screenshot_${Date.now()}.png`;
  link.href = mergedCanvas().toDataURL('image/png');
  link.click();
  showToast('PNG download started', 'success');
}

// Feature 7: JPEG export with quality slider
function downloadJpeg() {
  const quality = parseInt(jpegQualSlider.value, 10) / 100;
  const link = document.createElement('a');
  link.download = `screenshot_${Date.now()}.jpg`;
  link.href = mergedCanvas().toDataURL('image/jpeg', quality);
  link.click();
  showToast(`JPEG download started (Q${jpegQualSlider.value})`, 'success');
}

// PDF export — pure JS, no library (single-image PDF via DCTDecode / JPEG stream)
function downloadPdf() {
  try {
    const canvas  = mergedCanvas();
    const imgW    = canvas.width;
    const imgH    = canvas.height;
    // CSS pixels (96 DPI) → PDF points (72 DPI)
    const ptW     = +(imgW * 72 / 96).toFixed(2);
    const ptH     = +(imgH * 72 / 96).toFixed(2);

    // JPEG bytes
    const b64       = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
    const jpegBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

    const enc = s => new TextEncoder().encode(s);

    // Content stream: scale image to fill page
    const cs = `q ${ptW} 0 0 ${ptH} 0 0 cm /Im0 Do Q`;

    // PDF object parts
    const parts = [
      enc('%PDF-1.4\n'),
      enc(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`),
      enc(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`),
      enc(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}]\n` +
          `   /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n`),
      enc(`4 0 obj\n<< /Length ${cs.length} >>\nstream\n${cs}\nendstream\nendobj\n`),
      enc(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH}\n` +
          `   /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode` +
          ` /Length ${jpegBytes.length} >>\nstream\n`),
      jpegBytes,
      enc('\nendstream\nendobj\n'),
    ];

    // Calculate byte offsets for objects 1–5 (for xref table)
    const offsets = [];
    let pos = 0;
    // obj1 starts after header (parts[0])
    offsets.push(parts[0].length);
    pos = offsets[0] + parts[1].length;
    for (let i = 2; i <= 4; i++) { offsets.push(pos); pos += parts[i].length; }
    offsets.push(pos); // obj5
    pos += parts[5].length + parts[6].length + parts[7].length;

    const xrefOffset = pos;
    const entries    = offsets.map(o => o.toString().padStart(10, '0') + ' 00000 n \n').join('');
    const xref       = enc(
      `xref\n0 6\n0000000000 65535 f \n${entries}` +
      `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
    );

    // Merge everything into one Uint8Array
    const all   = [...parts, xref];
    const total = all.reduce((s, p) => s + p.length, 0);
    const pdf   = new Uint8Array(total);
    let off = 0;
    for (const p of all) { pdf.set(p, off); off += p.length; }

    const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
    const a   = document.createElement('a');
    a.href = url; a.download = `screenshot_${Date.now()}.pdf`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('PDF downloaded', 'success');
  } catch (err) {
    showToast('PDF failed: ' + err.message, 'error');
  }
}

async function copyToClipboard() {
  mergedCanvas().toBlob(async blob => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showToast('Copied to clipboard!', 'success');
    } catch(err) { showToast('Copy failed: '+err.message, 'error'); }
  }, 'image/png');
}


// =====================================================================
// Toast
// =====================================================================
let toastTimer = null;
function showToast(msg, type='info') {
  toast.textContent = msg; toast.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = ''; }, 2500);
}
