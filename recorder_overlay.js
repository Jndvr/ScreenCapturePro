// recorder_overlay.js — floating recording HUD (injected content script)
(function () {
  if (document.getElementById('__scp_rec_hud')) return;

  // ── State ──────────────────────────────────────────────────────────────
  let stream     = null;
  let recorder   = null;
  let chunks     = [];
  let ticker     = null;
  let elapsed    = 0;
  let paused     = false;
  let blobUrl    = null;
  let mimeType   = '';
  let useMic     = true;
  let showClicks = true;
  let fmtPref    = 'video/webm;codecs=vp9';

  // Drag
  let dragging = false, dragDX = 0, dragDY = 0;

  // Click-highlight
  let clickLayer = null;

  // Draw-on-screen
  let drawMode   = false;
  let drawCanvas = null;
  let drawCtx    = null;
  let isDrawing  = false;
  let lastX = 0, lastY = 0;
  let drawColor  = '#e8485e';
  let drawSize   = 4;
  let isErasing  = false;

  // Laser pointer
  let laserMode  = false;
  let laserEl    = null;
  let laserTimer = null;

  // Zoom bubble
  let zoomMode     = false;
  let zoomVideoEl  = null;
  let zoomCanvasEl = null;

  // ── Styles ─────────────────────────────────────────────────────────────
  const css = document.createElement('style');
  css.id = '__scp_rec_css';
  css.textContent = `
    #__scp_rec_hud,
    #__scp_rec_hud *,
    #__scp_rec_hud *::before,
    #__scp_rec_hud *::after {
      box-sizing: border-box; margin: 0; padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    /* ── Host ── */
    #__scp_rec_hud {
      position: fixed;
      bottom: 32px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      width: max-content;
      min-width: 520px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: stretch;
    }

    /* ── Card shell ── */
    .__scp_card {
      background: #111114;
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 24px 64px rgba(0,0,0,.85), 0 1px 0 rgba(255,255,255,.06) inset;
    }

    /* ── Header / drag handle ── */
    .__scp_head {
      display: flex; align-items: center; gap: 12px;
      padding: 18px 18px 17px;
      background: #16161a;
      border-bottom: 1px solid rgba(255,255,255,.07);
      cursor: grab; user-select: none;
    }
    .__scp_head:active { cursor: grabbing; }
    .__scp_head_icon {
      width: 32px; height: 32px; border-radius: 9px;
      background: rgba(232,72,94,.18); border: 1px solid rgba(232,72,94,.32);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .__scp_head_title {
      flex: 1; font-size: 14px; font-weight: 700; color: #e0e0e8; letter-spacing: -.015em;
    }
    .__scp_x {
      width: 28px; height: 28px; border-radius: 8px;
      background: transparent; border: none; cursor: pointer;
      color: #46464e; font-size: 20px; line-height: 28px; text-align: center;
      transition: background .12s, color .12s;
    }
    .__scp_x:hover { background: rgba(255,255,255,.08); color: #9090a0; }

    /* ── Settings sections ── */
    .__scp_body { padding: 22px 18px 20px; display: flex; flex-direction: column; gap: 22px; }
    .__scp_section_label {
      font-size: 10px; font-weight: 700; color: #3a3a48;
      letter-spacing: .1em; text-transform: uppercase; margin-bottom: 10px;
    }

    /* Format buttons */
    .__scp_fmt_grp { display: flex; gap: 7px; }
    .__scp_fmt_btn {
      flex: 1; padding: 11px 0; text-align: center;
      border: 1px solid rgba(255,255,255,.08); border-radius: 10px;
      background: rgba(255,255,255,.03); color: #505060;
      font-size: 13px; font-weight: 600; cursor: pointer;
      transition: background .12s, border-color .12s, color .12s; line-height: 1;
    }
    .__scp_fmt_btn:hover:not(.on) {
      background: rgba(255,255,255,.07); color: #8888a0; border-color: rgba(255,255,255,.14);
    }
    .__scp_fmt_btn.on { background: rgba(232,72,94,.16); border-color: rgba(232,72,94,.45); color: #e8485e; }

    /* Toggle items */
    .__scp_toggle_list { display: flex; flex-direction: column; gap: 8px; }
    .__scp_tog_item {
      display: flex; align-items: center; gap: 14px;
      padding: 13px 15px;
      background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.07); border-radius: 11px;
    }
    .__scp_tog_label { font-size: 13px; color: #8888a0; flex: 1; }
    .__scp_tog { position: relative; width: 36px; height: 21px; flex-shrink: 0; }
    .__scp_tog input { position: absolute; opacity: 0; width: 0; height: 0; }
    .__scp_track {
      position: absolute; inset: 0;
      background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.12);
      border-radius: 11px; cursor: pointer; transition: background .18s, border-color .18s;
    }
    .__scp_tog input:checked + .__scp_track { background: #e8485e; border-color: #e8485e; }
    .__scp_track::after {
      content: ''; position: absolute;
      width: 15px; height: 15px; top: 2px; left: 2px;
      background: #fff; border-radius: 50%; transition: transform .18s;
    }
    .__scp_tog input:checked + .__scp_track::after { transform: translateX(15px); }

    /* Divider & CTA */
    .__scp_div { height: 1px; background: rgba(255,255,255,.06); }
    .__scp_foot { padding: 18px 18px 20px; }
    .__scp_start {
      width: 100%; padding: 14px 18px;
      background: #e8485e; border: none; border-radius: 11px;
      color: #fff; font-size: 14px; font-weight: 700; cursor: pointer;
      display: flex; align-items: center; justify-content: center; gap: 10px;
      transition: background .12s; letter-spacing: .02em;
    }
    .__scp_start:hover  { background: #f05570; }
    .__scp_start:active { background: #d03850; }

    /* ── Draw toolbar (appears above pill when draw mode is on) ── */
    .__scp_draw_bar {
      display: flex; align-items: center; gap: 6px;
      padding: 10px 14px;
      background: #111114;
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 100px;
      box-shadow: 0 12px 40px rgba(0,0,0,.8);
      cursor: grab; user-select: none;
    }
    .__scp_draw_bar:active { cursor: grabbing; }

    .__scp_draw_sep { width: 1px; height: 18px; background: rgba(255,255,255,.08); flex-shrink: 0; margin: 0 2px; }

    /* Colour swatches */
    .__scp_swatch {
      width: 20px; height: 20px; border-radius: 50%; cursor: pointer; flex-shrink: 0;
      border: 2px solid transparent;
      transition: transform .1s, border-color .1s;
    }
    .__scp_swatch:hover  { transform: scale(1.2); }
    .__scp_swatch.on     { border-color: #fff; transform: scale(1.15); }

    /* Size buttons */
    .__scp_sz {
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px;
      background: transparent; border: 1px solid rgba(255,255,255,.1);
      cursor: pointer; color: #8888a0; transition: background .1s, color .1s;
    }
    .__scp_sz:hover { background: rgba(255,255,255,.1); color: #ebebef; }
    .__scp_sz.on    { background: rgba(255,255,255,.12); color: #ebebef; border-color: rgba(255,255,255,.22); }

    /* Eraser + clear */
    .__scp_tool {
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px;
      background: transparent; border: 1px solid rgba(255,255,255,.1);
      cursor: pointer; color: #8888a0; font-size: 13px;
      transition: background .1s, color .1s;
    }
    .__scp_tool:hover { background: rgba(255,255,255,.1); color: #ebebef; }
    .__scp_tool.on    { background: rgba(245,166,35,.15); color: #f5a623; border-color: rgba(245,166,35,.35); }
    .__scp_tool.clear:hover { background: rgba(232,72,94,.14); color: #e8485e; border-color: rgba(232,72,94,.3); }

    /* ── Active recording pill ── */
    .__scp_pill {
      display: flex; align-items: stretch;
      background: #18181c;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 100px;
      box-shadow: 0 12px 40px rgba(0,0,0,.8);
      overflow: visible; cursor: grab; user-select: none;
    }
    .__scp_pill:active { cursor: grabbing; }

    .__scp_pill_l {
      display: flex; align-items: center; gap: 16px;
      padding: 18px 26px 18px 28px;
      border-right: 1px solid rgba(255,255,255,.1); flex-shrink: 0;
      border-radius: 100px 0 0 100px;
      background: #18181c;
    }
    .__scp_dot {
      width: 11px; height: 11px; border-radius: 50%; background: #3a3a48; flex-shrink: 0;
    }
    .__scp_dot.rec   { background: #e8485e; animation: __scp_blink 1.1s step-start infinite; }
    .__scp_dot.pause { background: #f5a623; }
    @keyframes __scp_blink { 50% { opacity: .12; } }

    .__scp_timer {
      font-size: 26px; font-weight: 700; letter-spacing: 1.5px;
      font-variant-numeric: tabular-nums;
      font-family: 'SF Mono', 'Consolas', 'Menlo', monospace;
      color: #ffffff; min-width: 76px;
    }

    /* ── Pill middle section (tool buttons) ── */
    .__scp_pill_m {
      display: flex; align-items: center; gap: 10px;
      padding: 14px 22px;
      border-right: 1px solid rgba(255,255,255,.1); flex-shrink: 0;
      background: #18181c;
    }

    /* ── Pill right section ── */
    .__scp_pill_r {
      display: flex; align-items: center; gap: 10px;
      padding: 14px 24px 14px 20px;
      background: #18181c;
      border-radius: 0 100px 100px 0;
    }

    /* ── Icon button with optional mini-label ── */
    .__scp_ic_wrap {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      cursor: pointer;
    }
    .__scp_ic_lbl {
      font-size: 10px; font-weight: 600; color: #9090a8;
      letter-spacing: .04em; text-transform: uppercase; white-space: nowrap;
      pointer-events: none; transition: color .12s;
    }
    .__scp_ic_wrap:hover .__scp_ic_lbl { color: #c8c8d8; }
    .__scp_ic_wrap.active-lbl .__scp_ic_lbl { color: #6dd6a0; }
    .__scp_ic_wrap.amber-lbl  .__scp_ic_lbl { color: #f5a623; }
    .__scp_ic_wrap.danger-lbl .__scp_ic_lbl { color: #e8485e; }

    .__scp_ic {
      width: 40px; height: 40px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14);
      cursor: pointer; transition: background .1s, border-color .12s; color: #b0b0c8;
    }
    .__scp_ic:hover         { background: rgba(255,255,255,.18); color: #ffffff; border-color: rgba(255,255,255,.28); }
    .__scp_ic.amber         { color: #f5a623; background: rgba(245,166,35,.12); border-color: rgba(245,166,35,.4); }
    .__scp_ic.amber:hover   { background: rgba(245,166,35,.22); border-color: rgba(245,166,35,.65); }
    .__scp_ic.danger        { color: #e8485e; background: rgba(232,72,94,.12); border-color: rgba(232,72,94,.4); }
    .__scp_ic.danger:hover  { background: rgba(232,72,94,.22); border-color: rgba(232,72,94,.65); }
    .__scp_ic.draw-on  { background: rgba(109,214,160,.18); color: #6dd6a0; border-color: rgba(109,214,160,.5); }
    .__scp_ic.draw-on:hover  { background: rgba(109,214,160,.3); }
    .__scp_ic.zoom-on  { background: rgba(109,214,160,.18); color: #6dd6a0; border-color: rgba(109,214,160,.5); }
    .__scp_ic.zoom-on:hover  { background: rgba(109,214,160,.3); }
    .__scp_ic.laser-on { background: rgba(255,59,59,.18);  color: #ff6060;  border-color: rgba(255,59,59,.5); }
    .__scp_ic.laser-on:hover { background: rgba(255,59,59,.3); }

    /* ── Custom tooltip ── */
    #__scp_tip {
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      padding: 8px 12px;
      background: #232329;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 9px;
      box-shadow: 0 6px 22px rgba(0,0,0,.75);
      /* visibility keeps layout but hides the element so opacity can transition */
      visibility: hidden;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity .16s ease, transform .16s ease, visibility 0s linear .16s;
      max-width: 230px;
    }
    #__scp_tip.show {
      visibility: visible;
      opacity: 1;
      transform: translateY(0);
      transition: opacity .16s ease, transform .16s ease, visibility 0s linear 0s;
    }
    #__scp_tip .tip-name {
      font-size: 12px; font-weight: 700; color: #e8e8f0; white-space: nowrap;
    }
    #__scp_tip .tip-desc {
      font-size: 11px; color: #9090a0; margin-top: 3px; line-height: 1.45;
    }
    #__scp_tip::after {
      content: '';
      position: absolute;
      bottom: -5px; left: 50%; transform: translateX(-50%);
      width: 8px; height: 5px;
      background: #232329;
      clip-path: polygon(0 0, 100% 0, 50% 100%);
    }

    /* ── Done card ── */
    .__scp_done_body {
      display: flex; align-items: center; gap: 16px; padding: 20px 18px 22px;
    }
    .__scp_done_badge {
      width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;
      background: rgba(109,214,160,.12); border: 1px solid rgba(109,214,160,.28);
      display: flex; align-items: center; justify-content: center;
    }
    .__scp_done_info { flex: 1; min-width: 0; }
    .__scp_done_title { font-size: 14px; font-weight: 600; color: #e0e0e8; }
    .__scp_done_meta  { font-size: 12px; color: #46464e; margin-top: 4px; }
    .__scp_done_actions {
      display: flex; flex-direction: column; gap: 6px; flex-shrink: 0;
    }
    .__scp_dl {
      padding: 9px 16px; border-radius: 9px;
      background: rgba(109,214,160,.1); border: 1px solid rgba(109,214,160,.28);
      color: #6dd6a0; font-size: 12px; font-weight: 600; cursor: pointer;
      transition: background .1s; white-space: nowrap;
    }
    .__scp_dl:hover { background: rgba(109,214,160,.22); }
    .__scp_gif_btn {
      padding: 9px 16px; border-radius: 9px;
      background: rgba(232,72,94,.1); border: 1px solid rgba(232,72,94,.28);
      color: #e8485e; font-size: 12px; font-weight: 600; cursor: pointer;
      transition: background .1s; white-space: nowrap;
    }
    .__scp_gif_btn:hover { background: rgba(232,72,94,.22); }

    /* ── GIF progress ── */
    .__scp_gif_prog_wrap {
      display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; min-width: 110px;
    }
    .__scp_gif_prog_label {
      font-size: 11px; color: #8888a0; font-weight: 500;
    }
    .__scp_gif_prog_track {
      width: 100%; height: 3px;
      background: rgba(255,255,255,.08);
      border-radius: 2px; overflow: hidden;
    }
    .__scp_gif_prog_fill {
      background: #e8485e; height: 100%;
      border-radius: 2px; width: 0%;
      transition: width .15s;
    }

    /* ── Error card ── */
    .__scp_err_body { padding: 20px 18px 22px; }
    .__scp_err_msg  { font-size: 13px; color: #f07080; line-height: 1.55; margin-bottom: 16px; }

    /* ── Click rings ── */
    #__scp_click_layer {
      position: fixed; inset: 0; z-index: 2147483646;
      pointer-events: none; overflow: hidden;
    }
    .__scp_ring {
      position: absolute; width: 44px; height: 44px; border-radius: 50%;
      border: 2.5px solid rgba(232,72,94,.88);
      transform: translate(-50%,-50%) scale(.2); opacity: 1;
      animation: __scp_ring_out .55s cubic-bezier(.2,.6,.4,1) forwards;
      pointer-events: none;
    }
    @keyframes __scp_ring_out {
      0%   { transform: translate(-50%,-50%) scale(.2); opacity: 1; }
      60%  { opacity: .65; }
      100% { transform: translate(-50%,-50%) scale(2.2); opacity: 0; }
    }

    /* ── Draw canvas ── */
    #__scp_draw_canvas {
      position: fixed; inset: 0;
      z-index: 2147483645;
      pointer-events: none;
      touch-action: none;
    }
    #__scp_draw_canvas.active {
      pointer-events: all;
      cursor: crosshair;
    }
    #__scp_draw_canvas.erasing {
      cursor: cell;
    }

    /* ── Laser pointer ── */
    #__scp_laser {
      position: fixed;
      width: 22px; height: 22px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 2147483644;
      background: radial-gradient(circle, #ff3b3b 0%, rgba(255,59,59,.55) 45%, transparent 70%);
      box-shadow: 0 0 8px 3px rgba(255,59,59,.55), 0 0 22px 8px rgba(255,59,59,.2);
      transition: opacity 0.4s ease;
    }
    #__scp_laser.fading { opacity: 0; }

    /* ── Zoom bubble ── */
    #__scp_zoom {
      position: fixed;
      width: 160px; height: 160px;
      border-radius: 50%;
      pointer-events: none;
      z-index: 2147483644;
      box-shadow: 0 4px 28px rgba(0,0,0,.75), 0 0 0 1.5px rgba(255,255,255,.18);
    }
  `;
  document.head.appendChild(css);

  const host = document.createElement('div');
  host.id = '__scp_rec_hud';
  document.documentElement.appendChild(host);

  // ── Drag ──────────────────────────────────────────────────────────────
  function makeDraggable(handle) {
    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      const r = host.getBoundingClientRect();
      dragDX = e.clientX - r.left;
      dragDY = e.clientY - r.top;
    });
  }
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    host.style.left      = (e.clientX - dragDX) + 'px';
    host.style.top       = (e.clientY - dragDY) + 'px';
    host.style.bottom    = 'auto';
    host.style.transform = 'none';
    if (isDrawing) isDrawing = false;
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  // ── Custom tooltip ────────────────────────────────────────────────────
  const tipEl = document.createElement('div');
  tipEl.id = '__scp_tip';
  document.documentElement.appendChild(tipEl);
  let tipTimer = null;

  function showTip(anchor, name, desc) {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      tipEl.innerHTML =
        `<div class="tip-name">${name}</div>` +
        (desc ? `<div class="tip-desc">${desc}</div>` : '');
      // visibility:hidden keeps the element in layout so offsetWidth/Height work
      const tw = tipEl.offsetWidth  || 120;
      const th = tipEl.offsetHeight || 32;
      const ar = anchor.getBoundingClientRect();
      let left = ar.left + ar.width / 2 - tw / 2;
      let top  = ar.top - th - 12;
      if (top < 6) top = ar.bottom + 12;
      tipEl.style.left = Math.max(8, Math.min(left, window.innerWidth  - tw - 8)) + 'px';
      tipEl.style.top  = top + 'px';
      tipEl.classList.add('show');
    }, 500);
  }
  function hideTip() {
    clearTimeout(tipTimer);
    tipEl.classList.remove('show');
  }

  // ── Click-highlight ────────────────────────────────────────────────────
  function startClickLayer() {
    if (clickLayer) return;
    clickLayer = document.createElement('div');
    clickLayer.id = '__scp_click_layer';
    document.documentElement.appendChild(clickLayer);
    document.addEventListener('mousedown', onUserClick, true);
  }
  function stopClickLayer() {
    document.removeEventListener('mousedown', onUserClick, true);
    if (clickLayer) { clickLayer.remove(); clickLayer = null; }
  }
  function onUserClick(e) {
    if (host.contains(e.target) || !clickLayer || !showClicks) return;
    if (drawMode) return;
    const ring = document.createElement('div');
    ring.className = '__scp_ring';
    ring.style.left = e.clientX + 'px';
    ring.style.top  = e.clientY + 'px';
    clickLayer.appendChild(ring);
    ring.addEventListener('animationend', () => ring.remove(), { once: true });
  }

  // ── Draw canvas ───────────────────────────────────────────────────────
  function ensureDrawCanvas() {
    if (drawCanvas) return;
    drawCanvas = document.createElement('canvas');
    drawCanvas.id = '__scp_draw_canvas';
    resizeDrawCanvas();
    document.documentElement.appendChild(drawCanvas);
    drawCtx = drawCanvas.getContext('2d');
    drawCtx.lineCap  = 'round';
    drawCtx.lineJoin = 'round';

    drawCanvas.addEventListener('mousedown', e => {
      if (e.button !== 0 || !drawMode) return;
      e.preventDefault();
      isDrawing = true;
      lastX = e.clientX; lastY = e.clientY;
      drawDot(e.clientX, e.clientY);
    });
    drawCanvas.addEventListener('mousemove', e => {
      if (!isDrawing || !drawMode) return;
      e.preventDefault();
      drawStroke(lastX, lastY, e.clientX, e.clientY);
      lastX = e.clientX; lastY = e.clientY;
    });
    drawCanvas.addEventListener('mouseup',    () => { isDrawing = false; });
    drawCanvas.addEventListener('mouseleave', () => { isDrawing = false; });

    window.addEventListener('resize', resizeDrawCanvas);
  }

  function resizeDrawCanvas() {
    if (!drawCanvas) return;
    const tmp = document.createElement('canvas');
    tmp.width = drawCanvas.width; tmp.height = drawCanvas.height;
    if (drawCtx) tmp.getContext('2d').drawImage(drawCanvas, 0, 0);
    drawCanvas.width  = window.innerWidth;
    drawCanvas.height = window.innerHeight;
    drawCtx = drawCanvas.getContext('2d');
    drawCtx.lineCap  = 'round';
    drawCtx.lineJoin = 'round';
    if (tmp.width && tmp.height) drawCtx.drawImage(tmp, 0, 0);
  }

  function drawDot(x, y) {
    if (!drawCtx) return;
    drawCtx.beginPath();
    if (isErasing) {
      drawCtx.globalCompositeOperation = 'destination-out';
      drawCtx.arc(x, y, drawSize * 3, 0, Math.PI * 2);
      drawCtx.fillStyle = 'rgba(0,0,0,1)';
      drawCtx.fill();
      drawCtx.globalCompositeOperation = 'source-over';
    } else {
      drawCtx.arc(x, y, drawSize / 2, 0, Math.PI * 2);
      drawCtx.fillStyle = drawColor;
      drawCtx.fill();
    }
  }

  function drawStroke(x1, y1, x2, y2) {
    if (!drawCtx) return;
    drawCtx.beginPath();
    if (isErasing) {
      drawCtx.globalCompositeOperation = 'destination-out';
      drawCtx.lineWidth = drawSize * 6;
      drawCtx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      drawCtx.globalCompositeOperation = 'source-over';
      drawCtx.lineWidth = drawSize;
      drawCtx.strokeStyle = drawColor;
    }
    drawCtx.moveTo(x1, y1);
    drawCtx.lineTo(x2, y2);
    drawCtx.stroke();
    drawCtx.globalCompositeOperation = 'source-over';
  }

  function setDrawMode(on) {
    drawMode = on;
    if (on) {
      ensureDrawCanvas();
      drawCanvas.classList.add('active');
      if (isErasing) drawCanvas.classList.add('erasing');
    } else {
      if (drawCanvas) {
        drawCanvas.classList.remove('active');
        drawCanvas.classList.remove('erasing');
      }
    }
    render(paused ? 'paused' : 'rec');
  }

  function setEraser(on) {
    isErasing = on;
    if (drawCanvas) {
      drawCanvas.classList.toggle('erasing', on && drawMode);
    }
    renderDrawBar();
  }

  function clearDrawCanvas() {
    if (drawCtx) drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  }

  function destroyDrawCanvas() {
    window.removeEventListener('resize', resizeDrawCanvas);
    if (drawCanvas) { drawCanvas.remove(); drawCanvas = null; drawCtx = null; }
    drawMode = false; isDrawing = false;
  }

  function renderDrawBar() {
    const existing = host.querySelector('.__scp_draw_bar');
    if (!existing || !drawMode) return;
    const bar = buildDrawBar();
    host.replaceChild(bar, existing);
  }

  function buildDrawBar() {
    const bar = mk('div', '__scp_draw_bar');
    makeDraggable(bar);

    const colors = [
      { c: '#e8485e', label: 'Red'    },
      { c: '#f5a623', label: 'Orange' },
      { c: '#f5e642', label: 'Yellow' },
      { c: '#34c97a', label: 'Green'  },
      { c: '#4d9de0', label: 'Blue'   },
      { c: '#ffffff', label: 'White'  },
    ];
    colors.forEach(({ c, label }) => {
      const sw = mk('button', '__scp_swatch' + (drawColor === c && !isErasing ? ' on' : ''));
      sw.style.background = c;
      sw.addEventListener('mouseenter', () => showTip(sw, label + ' pen', 'Draw in ' + label.toLowerCase()));
      sw.addEventListener('mouseleave', hideTip);
      sw.addEventListener('click', () => {
        drawColor = c; isErasing = false;
        if (drawCanvas) { drawCanvas.classList.remove('erasing'); drawCanvas.style.cursor = 'crosshair'; }
        renderDrawBar();
      });
      bar.appendChild(sw);
    });

    bar.appendChild(mk('div', '__scp_draw_sep'));

    [
      { size: 3,  label: 'Thin',  desc: 'Fine stroke',  svg: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>` },
      { size: 8,  label: 'Thick', desc: 'Bold stroke',  svg: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>` },
    ].forEach(({ size, label, desc, svg }) => {
      const b = mk('button', '__scp_sz' + (drawSize === size && !isErasing ? ' on' : ''));
      b.innerHTML = svg;
      b.addEventListener('mouseenter', () => showTip(b, label, desc));
      b.addEventListener('mouseleave', hideTip);
      b.addEventListener('click', () => {
        drawSize = size; isErasing = false;
        if (drawCanvas) drawCanvas.classList.remove('erasing');
        renderDrawBar();
      });
      bar.appendChild(b);
    });

    bar.appendChild(mk('div', '__scp_draw_sep'));

    const erBtn = mk('button', '__scp_tool' + (isErasing ? ' on' : ''));
    erBtn.innerHTML = svgEraser();
    erBtn.addEventListener('mouseenter', () => showTip(erBtn, 'Eraser', 'Click and drag to erase strokes'));
    erBtn.addEventListener('mouseleave', hideTip);
    erBtn.addEventListener('click', () => setEraser(!isErasing));
    bar.appendChild(erBtn);

    const clrBtn = mk('button', '__scp_tool clear');
    clrBtn.innerHTML = svgTrash();
    clrBtn.addEventListener('mouseenter', () => showTip(clrBtn, 'Clear all', 'Remove all drawings from screen'));
    clrBtn.addEventListener('mouseleave', hideTip);
    clrBtn.addEventListener('click', clearDrawCanvas);
    bar.appendChild(clrBtn);

    return bar;
  }

  // ── Laser pointer ──────────────────────────────────────────────────────
  function onLaserMove(e) {
    if (!laserEl) return;
    laserEl.style.left = e.clientX + 'px';
    laserEl.style.top  = e.clientY + 'px';
    laserEl.classList.remove('fading');
    clearTimeout(laserTimer);
    laserTimer = setTimeout(() => {
      if (laserEl) laserEl.classList.add('fading');
    }, 400);
  }

  function createLaser() {
    if (laserEl) return;
    laserEl = document.createElement('div');
    laserEl.id = '__scp_laser';
    document.documentElement.appendChild(laserEl);
    document.addEventListener('mousemove', onLaserMove);
  }

  function destroyLaser() {
    document.removeEventListener('mousemove', onLaserMove);
    clearTimeout(laserTimer);
    laserTimer = null;
    if (laserEl) { laserEl.remove(); laserEl = null; }
  }

  function setLaserMode(on) {
    laserMode = on;
    if (on) createLaser();
    else    destroyLaser();
    render(paused ? 'paused' : 'rec');
  }

  // ── Zoom bubble ────────────────────────────────────────────────────────
  function onZoomMove(e) {
    if (!zoomVideoEl || !zoomCanvasEl || !stream) return;

    const vw = zoomVideoEl.videoWidth  || window.innerWidth;
    const vh = zoomVideoEl.videoHeight || window.innerHeight;
    const iw = window.innerWidth;
    const ih = window.innerHeight;

    // Scale: video px per viewport px
    const rx = vw / iw;
    const ry = vh / ih;

    // Source region: 80*rx wide (zoom 2x of 160px bubble) centered on cursor
    const srcW = 80 * rx;
    const srcH = 80 * ry;
    const srcLeft = Math.max(0, Math.min(vw - srcW, e.clientX * rx - srcW / 2));
    const srcTop  = Math.max(0, Math.min(vh - srcH, e.clientY * ry - srcH / 2));

    const ctx = zoomCanvasEl.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, 320, 320);

    // Clip to circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(160, 160, 160, 0, Math.PI * 2);
    ctx.clip();

    ctx.drawImage(zoomVideoEl, srcLeft, srcTop, srcW, srcH, 0, 0, 320, 320);
    ctx.restore();

    // Subtle white border ring
    ctx.beginPath();
    ctx.arc(160, 160, 158, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Small red crosshair (12px) at center
    ctx.strokeStyle = 'rgba(255,59,59,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(160 - 6, 160); ctx.lineTo(160 + 6, 160);
    ctx.moveTo(160, 160 - 6); ctx.lineTo(160, 160 + 6);
    ctx.stroke();

    // Position bubble upper-right of cursor, clamped to viewport
    const gap = 14;
    const bSize = 160;
    let bx = e.clientX + gap;
    let by = e.clientY - bSize - gap;
    if (bx + bSize > iw) bx = e.clientX - bSize - gap;
    if (by < 0) by = e.clientY + gap;
    bx = Math.max(0, Math.min(iw - bSize, bx));
    by = Math.max(0, Math.min(ih - bSize, by));

    zoomCanvasEl.style.left = bx + 'px';
    zoomCanvasEl.style.top  = by + 'px';
  }

  function createZoomBubble() {
    if (zoomCanvasEl || !stream) return;

    zoomVideoEl = document.createElement('video');
    zoomVideoEl.srcObject = stream;
    zoomVideoEl.muted     = true;
    zoomVideoEl.autoplay  = true;
    zoomVideoEl.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.documentElement.appendChild(zoomVideoEl);
    zoomVideoEl.play().catch(() => {});

    zoomCanvasEl = document.createElement('canvas');
    zoomCanvasEl.id = '__scp_zoom';
    zoomCanvasEl.width  = 320;
    zoomCanvasEl.height = 320;
    zoomCanvasEl.style.cssText = 'width:160px;height:160px;';
    document.documentElement.appendChild(zoomCanvasEl);

    document.addEventListener('mousemove', onZoomMove);
  }

  function destroyZoomBubble() {
    document.removeEventListener('mousemove', onZoomMove);
    if (zoomVideoEl) {
      zoomVideoEl.srcObject = null;
      zoomVideoEl.remove();
      zoomVideoEl = null;
    }
    if (zoomCanvasEl) { zoomCanvasEl.remove(); zoomCanvasEl = null; }
  }

  function setZoomMode(on) {
    zoomMode = on;
    if (on) createZoomBubble();
    else    destroyZoomBubble();
    render(paused ? 'paused' : 'rec');
  }

  // ── GIF export ────────────────────────────────────────────────────────
  async function gifExport(container) {
    if (!blobUrl) return;

    if (typeof window.__scpGifEncode !== 'function') {
      const errMsg = mk('p', '__scp_err_msg');
      errMsg.style.fontSize = '12px';
      errMsg.textContent = 'GIF encoder not loaded. Make sure gif_encoder.js is injected.';
      container.innerHTML = '';
      container.appendChild(errMsg);
      return;
    }

    // Replace actions area with progress UI
    container.innerHTML = '';
    const wrap  = mk('div', '__scp_gif_prog_wrap');
    const label = mk('div', '__scp_gif_prog_label');
    label.textContent = 'Encoding GIF…';
    const track = mk('div', '__scp_gif_prog_track');
    const fill  = mk('div', '__scp_gif_prog_fill');
    track.appendChild(fill);
    wrap.append(label, track);
    container.appendChild(wrap);

    try {
      const gifBlob = await window.__scpGifEncode(blobUrl, { fps: 10, maxWidth: 800 }, pct => {
        fill.style.width = pct + '%';
        label.textContent = 'Encoding GIF… ' + pct + '%';
      });

      const gifUrl = URL.createObjectURL(gifBlob);
      // Trigger download
      const a = document.createElement('a');
      a.href = gifUrl;
      a.download = 'recording_' + Date.now() + '.gif';
      a.click();

      // Show success UI
      container.innerHTML = '';
      const successLabel = mk('div', '__scp_gif_prog_label');
      successLabel.textContent = 'GIF saved!';
      successLabel.style.color = '#6dd6a0';
      const dlAgain = mk('button', '__scp_dl');
      dlAgain.textContent = 'Download again';
      dlAgain.addEventListener('click', () => {
        const a2 = document.createElement('a');
        a2.href = gifUrl;
        a2.download = 'recording_' + Date.now() + '.gif';
        a2.click();
      });
      container.append(successLabel, dlAgain);

    } catch (err) {
      container.innerHTML = '';
      const errMsg = mk('p', '__scp_err_msg');
      errMsg.style.fontSize = '12px';
      errMsg.textContent = 'GIF encoding failed: ' + (err && err.message ? err.message : String(err));
      const retry = mk('button', '__scp_gif_btn');
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => gifExport(container));
      container.append(errMsg, retry);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  function render(state) {
    host.innerHTML = '';

    if (state === 'idle') {
      const card = mk('div', '__scp_card');
      card.append(makeHeader('Screen Recorder', destroy));
      const body = mk('div', '__scp_body');

      const fmtSec = mk('div');
      const fmtLbl = mk('div', '__scp_section_label'); fmtLbl.textContent = 'Output Format';
      const fmtGrp = mk('div', '__scp_fmt_grp');
      fmtGrp.append(
        fmtBtn('WebM',  'video/webm;codecs=vp9'),
        fmtBtn('H.264', 'video/webm;codecs=h264'),
        fmtBtn('MP4',   'video/mp4')
      );
      fmtSec.append(fmtLbl, fmtGrp);

      const optSec = mk('div');
      const optLbl = mk('div', '__scp_section_label'); optLbl.textContent = 'Options';
      const togList = mk('div', '__scp_toggle_list');
      togList.append(
        togItem('🎙', 'Include microphone audio', useMic,     v => { useMic = v; }),
        togItem('🖱', 'Highlight cursor clicks',  showClicks, v => { showClicks = v; })
      );
      optSec.append(optLbl, togList);
      body.append(fmtSec, optSec);

      const foot = mk('div', '__scp_foot');
      const startBtn = mk('button', '__scp_start');
      startBtn.innerHTML = svgRec('#fff', 14) + ' Start Recording';
      startBtn.addEventListener('click', startRec);
      foot.append(startBtn);

      card.append(body, mk('div', '__scp_div'), foot);
      host.appendChild(card);

    } else if (state === 'rec' || state === 'paused') {

      // Draw toolbar above pill when draw mode is on
      if (drawMode) host.appendChild(buildDrawBar());

      const pill = mk('div', '__scp_pill');
      makeDraggable(pill);

      // Left: dot + timer
      const left = mk('div', '__scp_pill_l');
      const dot  = mk('div', '__scp_dot ' + (state === 'rec' ? 'rec' : 'pause'));
      const tim  = mk('span', '__scp_timer');
      tim.id = '__scp_t'; tim.textContent = fmt(elapsed);
      left.append(dot, tim);

      // Middle: tool toggle buttons (zoom, laser, draw)
      const mid = mk('div', '__scp_pill_m');
      mid.append(
        icLabelBtn(svgZoom(),   zoomMode  ? 'zoom-on'  : '', () => setZoomMode(!zoomMode),
          'Zoom', 'Zoom bubble', zoomMode ? 'Click to turn off' : 'Magnify the area under your cursor (2×)'),
        icLabelBtn(svgLaser(),  laserMode ? 'laser-on' : '', () => setLaserMode(!laserMode),
          'Laser', 'Laser pointer', laserMode ? 'Click to turn off' : 'Glowing dot that fades after you stop moving'),
        icLabelBtn(svgPencil(), drawMode  ? 'draw-on'  : '', () => setDrawMode(!drawMode),
          'Draw', 'Draw on screen', drawMode ? 'Click to stop drawing' : 'Annotate with freehand strokes — choose colour & size above')
      );

      // Right: pause + stop
      const right = mk('div', '__scp_pill_r');
      right.append(
        icLabelBtn(state === 'paused' ? svgPlay() : svgPause(), 'amber', togglePause,
          state === 'paused' ? 'Resume' : 'Pause',
          state === 'paused' ? 'Resume' : 'Pause', 'Pause or resume the recording'),
        icLabelBtn(svgStop(), 'danger', stopRec,
          'Stop', 'Stop & save', 'Stop recording — file downloads automatically')
      );

      pill.append(left, mid, right);
      host.appendChild(pill);

    } else if (state === 'done') {
      const card = mk('div', '__scp_card');
      card.append(makeHeader('Recording saved', destroy));
      const body = mk('div', '__scp_done_body');
      const badge = mk('div', '__scp_done_badge');
      badge.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3.5 9.5l4 4 7-8" stroke="#6dd6a0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      const info  = mk('div', '__scp_done_info');
      const dtit  = mk('div', '__scp_done_title'); dtit.textContent = 'Saved successfully';
      const ext   = mimeType.includes('mp4') ? 'MP4' : 'WebM';
      const dmeta = mk('div', '__scp_done_meta');  dmeta.textContent = fmt(elapsed) + '  ·  ' + ext + '  ·  Auto-downloaded';
      info.append(dtit, dmeta);

      const actions = mk('div', '__scp_done_actions');
      const dlBtn = mk('button', '__scp_dl'); dlBtn.textContent = 'Download again';
      dlBtn.addEventListener('click', doDownload);
      const gifBtn = mk('button', '__scp_gif_btn'); gifBtn.textContent = 'Export GIF';
      gifBtn.addEventListener('click', () => gifExport(actions));
      actions.append(dlBtn, gifBtn);

      body.append(badge, info, actions);
      card.append(body);
      host.appendChild(card);

    } else if (state === 'error') {
      const card = mk('div', '__scp_card');
      card.append(makeHeader('Screen Recorder', destroy));
      const body = mk('div', '__scp_err_body');
      const msg  = mk('p', '__scp_err_msg');
      msg.textContent = 'Screen sharing was denied or cancelled. Click below to try again.';
      const retry = mk('button', '__scp_start');
      retry.innerHTML = svgRec('#fff', 14) + ' Try Again';
      retry.addEventListener('click', startRec);
      body.append(msg, retry);
      card.append(body);
      host.appendChild(card);
    }
  }

  // ── DOM helpers ───────────────────────────────────────────────────────
  function mk(tag, cls) {
    const e = document.createElement(tag); if (cls) e.className = cls; return e;
  }
  function makeHeader(title, onClose) {
    const head = mk('div', '__scp_head');
    makeDraggable(head);
    const icon = mk('div', '__scp_head_icon'); icon.innerHTML = svgRec('#e8485e', 13);
    const t    = mk('div', '__scp_head_title'); t.textContent = title;
    const x    = mk('button', '__scp_x');      x.textContent = '×'; x.title = 'Dismiss';
    x.addEventListener('click', onClose);
    head.append(icon, t, x);
    return head;
  }
  const fmtDescs = {
    'video/webm;codecs=vp9':  ['WebM · VP9',    'Best compatibility in Chrome — smallest file'],
    'video/webm;codecs=h264': ['WebM · H.264',  'Better compression, same WebM container'],
    'video/mp4':               ['MP4',           'Widest playback support across devices'],
  };
  function fmtBtn(label, value) {
    const b = mk('button', '__scp_fmt_btn' + (fmtPref === value ? ' on' : ''));
    b.textContent = label;
    const [tipName, tipDesc] = fmtDescs[value] || [label, ''];
    b.addEventListener('mouseenter', () => showTip(b, tipName, tipDesc));
    b.addEventListener('mouseleave', hideTip);
    b.addEventListener('click', () => {
      fmtPref = value;
      host.querySelectorAll('.__scp_fmt_btn').forEach(o => o.classList.toggle('on', o === b));
    });
    return b;
  }
  const togDescs = {
    '🎙': 'Records your mic alongside the screen audio',
    '🖱': 'Shows a red ripple ring at every click position',
  };
  function togItem(icon, label, checked, onChange) {
    const row  = mk('div', '__scp_tog_item');
    const ico  = mk('span'); ico.textContent = icon; ico.style.fontSize = '15px';
    const txt  = mk('span', '__scp_tog_label'); txt.textContent = label;
    const tog  = mk('label', '__scp_tog');
    const inp  = document.createElement('input');
    inp.type = 'checkbox'; inp.checked = checked;
    inp.addEventListener('change', () => onChange(inp.checked));
    const track = mk('div', '__scp_track');
    tog.append(inp, track);
    row.append(ico, txt, tog);
    // Tooltip on the whole row
    row.addEventListener('mouseenter', () => showTip(row, label, togDescs[icon] || ''));
    row.addEventListener('mouseleave', hideTip);
    return row;
  }
  function icBtn(svgStr, colorCls, fn, name, desc) {
    const b = mk('button', '__scp_ic' + (colorCls ? ' ' + colorCls : ''));
    b.innerHTML = svgStr;
    b.addEventListener('click', fn);
    b.addEventListener('mouseenter', () => showTip(b, name, desc));
    b.addEventListener('mouseleave', hideTip);
    return b;
  }
  // Icon button with a small visible label underneath
  function icLabelBtn(svgStr, colorCls, fn, label, tipName, tipDesc) {
    // wrapperCls for label colour coordination
    const wrapCls = colorCls === 'amber' ? 'amber-lbl'
                  : colorCls === 'danger' ? 'danger-lbl'
                  : (colorCls && colorCls.endsWith('-on')) ? 'active-lbl' : '';
    const wrap = mk('div', '__scp_ic_wrap' + (wrapCls ? ' ' + wrapCls : ''));
    const btn  = icBtn(svgStr, colorCls, fn, tipName, tipDesc);
    const lbl  = mk('span', '__scp_ic_lbl');
    lbl.textContent = label;
    wrap.append(btn, lbl);
    return wrap;
  }
  function fmt(s) {
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  // ── SVG icons ─────────────────────────────────────────────────────────
  function svgRec(color, sz) {
    return `<svg width="${sz}" height="${sz}" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="6" stroke="${color}" stroke-width="1.4" fill="none"/>
      <circle cx="7" cy="7" r="2.8" fill="${color}"/>
    </svg>`;
  }
  function svgPause() {
    return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="3" y="2.5" width="3" height="9" rx="1.2" fill="currentColor"/>
      <rect x="8" y="2.5" width="3" height="9" rx="1.2" fill="currentColor"/>
    </svg>`;
  }
  function svgPlay() {
    return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 2l10 5-10 5V2z" fill="currentColor"/>
    </svg>`;
  }
  function svgStop() {
    return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="2.5" y="2.5" width="9" height="9" rx="2" fill="currentColor"/>
    </svg>`;
  }
  function svgPencil() {
    return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M9.5 2.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor" stroke-width="1.3"
        stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>`;
  }
  function svgEraser() {
    return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 11h10M8.5 3L11 5.5l-5 5L3.5 8l5-5z" stroke="currentColor" stroke-width="1.3"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  function svgTrash() {
    return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2.5 4h9M5 4V2.5h4V4M5.5 6.5v4M8.5 6.5v4M3.5 4l.5 7.5h6L11 4"
        stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  function svgZoom() {
    return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.3"/>
      <line x1="9.2" y1="9.2" x2="12" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="4" y1="6" x2="8" y2="6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <line x1="6" y1="4" x2="6" y2="8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>`;
  }
  function svgLaser() {
    return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2.2" fill="currentColor"/>
      <line x1="7" y1="1" x2="7" y2="3.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <line x1="7" y1="10.8" x2="7" y2="13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <line x1="1" y1="7" x2="3.2" y2="7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <line x1="10.8" y1="7" x2="13" y2="7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <line x1="2.93" y1="2.93" x2="4.52" y2="4.52" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="9.48" y1="9.48" x2="11.07" y2="11.07" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="11.07" y1="2.93" x2="9.48" y2="4.52" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="4.52" y1="9.48" x2="2.93" y2="11.07" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`;
  }

  // ── Timer ─────────────────────────────────────────────────────────────
  function startTick() {
    ticker = setInterval(() => {
      elapsed++;
      const t = document.getElementById('__scp_t');
      if (t) t.textContent = fmt(elapsed);
    }, 1000);
  }
  function stopTick() { clearInterval(ticker); ticker = null; }

  // ── Recording ─────────────────────────────────────────────────────────
  async function startRec() {
    try {
      const disp = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' }, audio: true
      });
      let mic = null;
      if (useMic) {
        try { mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
        catch (_) {}
      }
      const tracks = [...disp.getTracks()];
      if (mic) mic.getAudioTracks().forEach(t => tracks.push(t));
      stream = new MediaStream(tracks);

      const chains = {
        'video/webm;codecs=vp9':  ['video/webm;codecs=vp9', 'video/webm'],
        'video/webm;codecs=h264': ['video/webm;codecs=h264', 'video/webm;codecs=vp9', 'video/webm'],
        'video/mp4':              ['video/mp4;codecs=h264,aac', 'video/mp4;codecs=avc1', 'video/mp4',
                                   'video/webm;codecs=vp9', 'video/webm']
      };
      mimeType = (chains[fmtPref] || chains['video/webm;codecs=vp9'])
        .find(t => MediaRecorder.isTypeSupported(t)) || '';

      chunks = []; elapsed = 0; paused = false;
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      recorder.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stopTick(); stopClickLayer(); destroyDrawCanvas();
        destroyZoomBubble(); destroyLaser();
        blobUrl = URL.createObjectURL(new Blob(chunks, { type: mimeType || 'video/webm' }));
        doDownload(); render('done');
      };
      recorder.onerror = () => {
        stopTick(); stopClickLayer(); destroyDrawCanvas();
        destroyZoomBubble(); destroyLaser();
        render('error');
      };
      disp.getVideoTracks()[0].addEventListener('ended', () => {
        if (recorder?.state !== 'inactive') stopRec();
      });

      recorder.start(1000);
      startTick();
      if (showClicks) startClickLayer();
      render('rec');
    } catch (e) {
      render(e.name === 'NotAllowedError' ? 'error' : 'idle');
    }
  }

  function togglePause() {
    if (!recorder) return;
    if (!paused) { recorder.pause(); stopTick(); paused = true;  render('paused'); }
    else         { recorder.resume(); startTick(); paused = false; render('rec'); }
  }
  function stopRec() {
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }
  function doDownload() {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'recording_' + Date.now() + '.' + (mimeType.includes('mp4') ? 'mp4' : 'webm');
    a.click();
  }
  function destroy() {
    stopTick(); stopClickLayer(); destroyDrawCanvas();
    destroyZoomBubble(); destroyLaser();
    hideTip(); tipEl.remove();
    if (recorder?.state !== 'inactive') recorder?.stop();
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    host.remove(); css.remove();
  }

  render('idle');
})();
