// popup.js

const captureBtn        = document.getElementById('captureBtn');
const captureViewport   = document.getElementById('captureViewport');
const captureRegionBtn  = document.getElementById('captureRegionBtn');
const recordBtn         = document.getElementById('recordBtn');
const statusMsg         = document.getElementById('statusMsg');
const progressBar       = document.getElementById('progressBar');
const progressFill      = document.getElementById('progressFill');
const countdownEl       = document.getElementById('countdownDisplay');
const speedSlider       = document.getElementById('speedSlider');
const speedLabel        = document.getElementById('speedLabel');
const lazyCheck         = document.getElementById('lazyLoad');
const urlStampCheck     = document.getElementById('urlStamp');

// Speed settings: slider value → CAPTURE_DELAY in ms
const SPEED_MAP   = { 1: 800, 2: 350, 3: 150 };
const SPEED_NAMES = { 1: 'Slow', 2: 'Normal', 3: 'Fast' };

let selectedDelay = 0;
let countdownTimer = null;

// ----- Delay buttons -----
document.querySelectorAll('.delay-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.delay-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedDelay = parseInt(btn.dataset.delay, 10);
  });
});

// ----- Speed slider -----
speedSlider.addEventListener('input', () => {
  speedLabel.textContent = SPEED_NAMES[speedSlider.value];
});

// ----- Helpers -----
function showStatus(msg, type = 'info') {
  statusMsg.textContent = msg;
  statusMsg.className = `status ${type}`;
}

function setProgress(pct) {
  progressBar.style.display = 'block';
  progressFill.style.width = `${pct}%`;
}

function setLoading(isLoading) {
  captureBtn.disabled         = isLoading;
  captureViewport.disabled    = isLoading;
  captureRegionBtn.disabled   = isLoading;
  recordBtn.disabled          = isLoading;
  if (!isLoading) {
    progressBar.style.display = 'none';
    progressFill.style.width  = '0%';
    countdownEl.style.display = 'none';
  }
}

function getCaptureDelay() {
  return SPEED_MAP[speedSlider.value] || 350;
}

// ----- Countdown then capture -----
function startCaptureAfterDelay(fn) {
  if (selectedDelay === 0) {
    fn();
    return;
  }
  let count = selectedDelay;
  countdownEl.style.display = 'block';
  countdownEl.textContent = count;
  showStatus(`Capturing in ${count}s…`, 'info');

  countdownTimer = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(countdownTimer);
      countdownEl.style.display = 'none';
      fn();
    } else {
      countdownEl.textContent = count;
      showStatus(`Capturing in ${count}s…`, 'info');
    }
  }, 1000);
}

// ----- Full-page capture -----
captureBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { showStatus('No active tab found.', 'error'); return; }
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
    showStatus('Cannot capture Chrome system pages.', 'error');
    return;
  }

  setLoading(true);
  showStatus('Ready…', 'info');

  startCaptureAfterDelay(async () => {
    showStatus('Scrolling and capturing…', 'info');
    setProgress(30);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'captureFullPage',
        tabId: tab.id,
        captureDelay: getCaptureDelay(),
        lazyLoad: lazyCheck.checked,
        delay: selectedDelay,
        urlStamp: urlStampCheck.checked,
        pageUrl: tab.url,
        captureTime: new Date().toISOString()
      });

      if (response?.error) {
        showStatus(`Error: ${response.error}`, 'error');
      } else {
        setProgress(100);
        showStatus('Done! Editor opening…', 'success');
        setTimeout(() => window.close(), 800);
      }
    } catch (err) {
      showStatus(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  });
});

// ----- Viewport-only capture -----
captureViewport.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { showStatus('No active tab found.', 'error'); return; }
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
    showStatus('Cannot capture Chrome system pages.', 'error');
    return;
  }

  setLoading(true);
  showStatus('Capturing viewport…', 'info');

  startCaptureAfterDelay(async () => {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      const response = await chrome.runtime.sendMessage({
        action: 'storeCapture',
        data: {
          captures: [{ dataUrl, x: 0, y: 0, windowWidth: tab.width || 1280 }],
          meta: {
            totalWidth: tab.width || 1280,
            totalHeight: tab.height || 800,
            windowWidth: tab.width || 1280,
            windowHeight: tab.height || 800,
            devicePixelRatio: 1,
            urlStamp: urlStampCheck.checked,
            pageUrl: tab.url,
            captureTime: new Date().toISOString()
          },
          viewportOnly: true
        }
      });
      const editorUrl = chrome.runtime.getURL(`editor.html?id=${response.id}`);
      await chrome.tabs.create({ url: editorUrl });
      showStatus('Done! Editor opening…', 'success');
      setTimeout(() => window.close(), 600);
    } catch (err) {
      showStatus(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  });
});

// ----- Region capture -----
captureRegionBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { showStatus('No active tab found.', 'error'); return; }
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
    showStatus('Cannot capture Chrome system pages.', 'error');
    return;
  }

  setLoading(true);
  showStatus('Select a region on the page…', 'info');

  try {
    // Close popup so user can see the page
    window.close();
    await chrome.runtime.sendMessage({
      action: 'captureRegion',
      tabId: tab.id,
      urlStamp: urlStampCheck.checked,
      pageUrl: tab.url,
      captureTime: new Date().toISOString()
    });
  } catch (err) {
    // Popup is closed, can't show error
  }
});

// ----- Record Screen -----
recordBtn.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ action: 'startRecording' });
    window.close();
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
  }
});
