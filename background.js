// background.js — MV3 Service Worker

const captureStore = {};
let regionResolver = null;   // module-level (no `window` in service workers)

// =====================================================================
// Message listener
// =====================================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'captureFullPage') {
    startCapture(msg).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.action === 'storeCapture') {
    const id = Date.now().toString();
    captureStore[id] = msg.data;
    setTimeout(() => { delete captureStore[id]; }, 5 * 60 * 1000);
    sendResponse({ id });
    return true;
  }
  if (msg.action === 'getCaptureData') {
    const data = captureStore[msg.id];
    if (data) { sendResponse(data); delete captureStore[msg.id]; }
    else       { sendResponse(null); }
    return true;
  }
  if (msg.action === 'captureRegion') {
    handleCaptureRegion(msg).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.action === 'regionSelected') {
    if (regionResolver) {
      regionResolver(msg.rect);
      regionResolver = null;
    }
    sendResponse(true);
    return true;
  }
  if (msg.action === 'startRecording') {
    chrome.tabs.create({ url: chrome.runtime.getURL('recording.html') });
    sendResponse({ ok: true });
    return true;
  }
});

// =====================================================================
// Keyboard command shortcuts (Feature 3)
// =====================================================================
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) return;

  if (command === 'capture-fullpage') {
    startCapture({ tabId: tab.id, captureDelay: 350, lazyLoad: true, delay: 0,
                   urlStamp: false, pageUrl: tab.url, captureTime: new Date().toISOString() })
      .catch(() => {});
  } else if (command === 'capture-visible') {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const id = Date.now().toString();
      captureStore[id] = {
        captures: [{ dataUrl, x: 0, y: 0, windowWidth: tab.width || 1280 }],
        meta: {
          totalWidth: tab.width || 1280, totalHeight: tab.height || 800,
          windowWidth: tab.width || 1280, windowHeight: tab.height || 800,
          devicePixelRatio: 1
        },
        viewportOnly: true
      };
      setTimeout(() => { delete captureStore[id]; }, 5 * 60 * 1000);
      await chrome.tabs.create({ url: chrome.runtime.getURL('editor.html?id=' + id) });
    } catch (e) {}
  } else if (command === 'capture-region') {
    handleCaptureRegion({ tabId: tab.id, urlStamp: false, pageUrl: tab.url,
                          captureTime: new Date().toISOString() }).catch(() => {});
  }
});

// =====================================================================
// Countdown overlay + full page capture
// =====================================================================
async function startCapture({ tabId, captureDelay = 350, lazyLoad = true, delay = 0,
                               urlStamp = false, pageUrl = '', captureTime = '' }) {
  if (delay > 0) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (secs) => {
        const existing = document.getElementById('__scp_cd');
        if (existing) existing.remove();

        const el = document.createElement('div');
        el.id = '__scp_cd';
        el.style.cssText = [
          'position:fixed', 'top:18px', 'right:18px', 'z-index:2147483647',
          'background:rgba(10,10,30,0.88)', 'color:#fff',
          'border:2px solid #e94560', 'border-radius:12px',
          'padding:12px 20px', 'font:600 15px/1.4 system-ui,sans-serif',
          'display:flex', 'align-items:center', 'gap:10px',
          'box-shadow:0 4px 24px rgba(0,0,0,0.5)', 'pointer-events:none'
        ].join(';');

        const dot = document.createElement('div');
        dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#e94560;flex-shrink:0';

        const lbl = document.createElement('span');
        lbl.id = '__scp_cd_lbl';
        lbl.textContent = `Capturing in ${secs}s — hover now!`;

        el.append(dot, lbl);
        document.body.appendChild(el);

        let on = true;
        const blink = setInterval(() => { dot.style.opacity = (on = !on) ? '1' : '0.3'; }, 500);

        let count = secs;
        const tick = setInterval(() => {
          count--;
          if (count <= 0) {
            clearInterval(tick); clearInterval(blink);
            lbl.textContent = 'Capturing…'; dot.style.opacity = '1';
          } else {
            lbl.textContent = `Capturing in ${count}s — hover now!`;
          }
        }, 1000);

        setTimeout(() => el.remove(), (secs + 60) * 1000);
      },
      args: [delay]
    }).catch(() => {});

    await new Promise(r => setTimeout(r, delay * 1000));

    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => { const e = document.getElementById('__scp_cd'); if (e) e.remove(); }
    }).catch(() => {});
    // Give the browser one render frame to repaint before the first captureVisibleTab call
    await new Promise(r => setTimeout(r, 150));
  }

  return handleFullPageCapture({ tabId, captureDelay, lazyLoad, urlStamp, pageUrl, captureTime });
}

// =====================================================================
// Progress feedback via extension icon badge (Feature 5)
// Uses the action badge — never injects into the page, so it never
// appears in screenshots.
// =====================================================================
function setBadgeProgress(tabId, pct) {
  const text = pct >= 100 ? '' : (pct === 0 ? '…' : Math.round(pct) + '%');
  chrome.action.setBadgeBackgroundColor({ color: '#e94560' }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}

function clearBadge(tabId) {
  chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
}

// =====================================================================
// Full-page capture handler
// =====================================================================
async function handleFullPageCapture({ tabId, captureDelay, lazyLoad,
                                        urlStamp = false, pageUrl = '', captureTime = '' }) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['content.js']
  });

  // Show progress on extension icon badge (never injected into page)
  setBadgeProgress(tabId, 0);

  const tab      = await chrome.tabs.get(tabId);
  const windowId = tab.windowId;
  const captures = [];
  let meta = null;

  return new Promise((resolve, reject) => {
    let finished = false;

    function onMessage(msg, msgSender, sendResponse) {
      if (msg.msg !== 'capture' || !msgSender.tab || msgSender.tab.id !== tabId) return;

      chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
        .then(dataUrl => {
          if (!meta) {
            meta = {
              totalWidth:      msg.totalWidth,
              totalHeight:     msg.totalHeight,
              windowWidth:     msg.windowWidth,
              windowHeight:    msg.windowHeight,
              devicePixelRatio: msg.devicePixelRatio || 1,
              customScroll:    !!msg.customScroll,
              containerRect:   msg.containerRect || null,
              urlStamp,
              pageUrl,
              captureTime
            };
          }
          captures.push({ dataUrl, x: msg.x, y: msg.y,
                          windowWidth: msg.windowWidth, customScroll: !!msg.customScroll });

          // Update badge progress
          setBadgeProgress(tabId, Math.round(msg.complete * 100));

          sendResponse(true);
          if (msg.complete >= 1) finish();
        })
        .catch(err => { sendResponse(false); finish(err); });

      return true;
    }

    function finish(err) {
      if (finished) return;
      finished = true;
      chrome.runtime.onMessage.removeListener(onMessage);
      clearBadge(tabId);

      if (err) { reject(err); return; }

      const captureId = Date.now().toString();
      captureStore[captureId] = { captures, meta };
      setTimeout(() => { delete captureStore[captureId]; }, 5 * 60 * 1000);

      chrome.tabs.create({ url: chrome.runtime.getURL('editor.html?id=' + captureId) })
        .then(() => resolve({ success: true }))
        .catch(reject);
    }

    chrome.runtime.onMessage.addListener(onMessage);

    const scrollMsg = { msg: 'scrollPage', captureDelay, lazyLoad };
    chrome.webNavigation.getAllFrames({ tabId })
      .then(frames => {
        frames.forEach(f => chrome.tabs.sendMessage(tabId, scrollMsg, { frameId: f.frameId }).catch(() => {}));
      })
      .catch(() => {
        chrome.tabs.sendMessage(tabId, scrollMsg).catch(err => {
          chrome.runtime.onMessage.removeListener(onMessage);
          reject(err);
        });
      });
  });
}

// =====================================================================
// Region capture (Feature 1)
// =====================================================================
async function handleCaptureRegion({ tabId, urlStamp = false, pageUrl = '', captureTime = '' }) {
  // Inject region selection overlay on the page
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // Remove any existing region overlay
      const existing = document.getElementById('__scp_region_overlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = '__scp_region_overlay';
      overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:2147483646',
        'cursor:crosshair', 'background:rgba(0,0,0,0.35)',
        'user-select:none'
      ].join(';');

      const label = document.createElement('div');
      label.style.cssText = [
        'position:absolute', 'top:12px', 'left:50%', 'transform:translateX(-50%)',
        'background:rgba(10,10,30,0.9)', 'color:#fff',
        'padding:8px 18px', 'border-radius:8px',
        'font:600 13px system-ui,sans-serif', 'pointer-events:none',
        'border:1px solid rgba(233,69,96,0.5)'
      ].join(';');
      label.textContent = 'Drag to select region — Esc to cancel';

      const selBox = document.createElement('div');
      selBox.style.cssText = [
        'position:fixed', 'border:2px solid #e94560',
        'background:rgba(233,69,96,0.12)',
        'pointer-events:none', 'display:none',
        'box-shadow:0 0 0 1px rgba(0,0,0,0.3)'
      ].join(';');

      overlay.appendChild(label);
      overlay.appendChild(selBox);
      document.body.appendChild(overlay);

      let startX = 0, startY = 0, dragging = false;

      function cleanup() {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
      }

      function onKey(e) {
        if (e.key === 'Escape') { cleanup(); }
      }
      document.addEventListener('keydown', onKey);

      overlay.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        selBox.style.display = 'block';
        selBox.style.left    = startX + 'px';
        selBox.style.top     = startY + 'px';
        selBox.style.width   = '0px';
        selBox.style.height  = '0px';
      });

      overlay.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const x = Math.min(e.clientX, startX);
        const y = Math.min(e.clientY, startY);
        const w = Math.abs(e.clientX - startX);
        const h = Math.abs(e.clientY - startY);
        selBox.style.left   = x + 'px';
        selBox.style.top    = y + 'px';
        selBox.style.width  = w + 'px';
        selBox.style.height = h + 'px';
      });

      overlay.addEventListener('mouseup', (e) => {
        if (!dragging) return;
        dragging = false;
        const x = Math.min(e.clientX, startX);
        const y = Math.min(e.clientY, startY);
        const w = Math.abs(e.clientX - startX);
        const h = Math.abs(e.clientY - startY);

        cleanup();

        if (w < 10 || h < 10) return; // Too small, ignore

        // Send region to background
        chrome.runtime.sendMessage({
          action: 'regionSelected',
          rect: { x, y, w, h }
        });
      });
    }
  });

  // Wait for region selection — resolved by main message listener when 'regionSelected' arrives
  const rect = await new Promise((resolve) => {
    regionResolver = resolve;
    setTimeout(() => { regionResolver = null; resolve(null); }, 120000); // 2-min timeout
  });

  if (!rect || rect.w < 10 || rect.h < 10) return { cancelled: true };

  // Capture the visible tab and crop to the region
  const tab = await chrome.tabs.get(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

  // Get device pixel ratio from page
  const dprResult = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1)
  }).catch(() => [{ result: 1 }]);
  const dpr = (dprResult && dprResult[0] && dprResult[0].result) || 1;

  // Crop region using OffscreenCanvas (available in SW)
  const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const cropX = Math.round(rect.x * dpr);
  const cropY = Math.round(rect.y * dpr);
  const cropW = Math.round(rect.w * dpr);
  const cropH = Math.round(rect.h * dpr);

  const oc  = new OffscreenCanvas(cropW, cropH);
  const ctx = oc.getContext('2d');
  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  const croppedBlob = await oc.convertToBlob({ type: 'image/png' });

  // Convert blob to data URL (FileReader unavailable in SW — use arrayBuffer + btoa)
  const buffer = await croppedBlob.arrayBuffer();
  const bytes  = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const croppedDataUrl = 'data:image/png;base64,' + btoa(binary);

  const captureId = Date.now().toString();
  captureStore[captureId] = {
    captures: [{ dataUrl: croppedDataUrl, x: 0, y: 0, windowWidth: cropW }],
    meta: {
      totalWidth: cropW, totalHeight: cropH,
      windowWidth: cropW, windowHeight: cropH,
      devicePixelRatio: 1,
      urlStamp, pageUrl, captureTime
    },
    viewportOnly: true
  };
  setTimeout(() => { delete captureStore[captureId]; }, 5 * 60 * 1000);

  await chrome.tabs.create({ url: chrome.runtime.getURL('editor.html?id=' + captureId) });
  return { success: true };
}
