// recording.js — Screen Recorder (extracted from recording.html for MV3 CSP compliance)

// ---- State ----
let mediaStream    = null;
let mediaRecorder  = null;
let recordedChunks = [];
let timerInterval  = null;
let elapsedSeconds = 0;
let isPaused       = false;
let selectedMimeType = 'video/webm;codecs=vp9';

// ---- DOM ----
const recordBtn      = document.getElementById('recordBtn');
const pauseBtn       = document.getElementById('pauseBtn');
const stopBtn        = document.getElementById('stopBtn');
const timerDisplay   = document.getElementById('timerDisplay');
const statusDot      = document.getElementById('statusDot');
const statusText     = document.getElementById('statusText');
const msgBox         = document.getElementById('msgBox');
const previewSection = document.getElementById('previewSection');
const preview        = document.getElementById('preview');
const downloadLink   = document.getElementById('downloadLink');

// ---- Format buttons ----
document.querySelectorAll('.format-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') return;
    document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedMimeType = btn.dataset.format;
  });
});

// ---- Helpers ----
function showMsg(msg, type = 'info') {
  msgBox.textContent = msg;
  msgBox.className = `message ${type}`;
}
function clearMsg() { msgBox.className = 'message'; }

function setStatus(state) {
  statusDot.className = 'status-dot ' + state;
  const labels = { ready: 'Ready to record', recording: 'Recording…', paused: 'Paused', stopped: 'Stopped' };
  statusText.textContent = labels[state] || state;
}

function formatTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
function pad(n) { return n < 10 ? '0' + n : '' + n; }

function startTimer() {
  timerInterval = setInterval(() => {
    elapsedSeconds++;
    timerDisplay.textContent = formatTime(elapsedSeconds);
  }, 1000);
}
function stopTimer() { clearInterval(timerInterval); timerInterval = null; }

// ---- Recording ----
recordBtn.addEventListener('click', async () => {
  clearMsg();
  try {
    const displayMedia = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' },
      audio: true
    });

    let audioStream = null;
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) { /* mic not available — use screen audio only */ }

    const tracks = [...displayMedia.getTracks()];
    if (audioStream) audioStream.getAudioTracks().forEach(t => tracks.push(t));
    mediaStream = new MediaStream(tracks);

    let mimeType = selectedMimeType;
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      const fallbacks = ['video/webm;codecs=vp9', 'video/webm;codecs=h264', 'video/webm', 'video/mp4'];
      mimeType = fallbacks.find(t => MediaRecorder.isTypeSupported(t)) || '';
    }

    recordedChunks = [];
    elapsedSeconds = 0;
    timerDisplay.textContent = '00:00';
    timerDisplay.className = 'timer-display running';

    const options = mimeType ? { mimeType } : {};
    mediaRecorder = new MediaRecorder(mediaStream, options);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      stopTimer();
      timerDisplay.className = 'timer-display idle';
      setStatus('stopped');

      const ext = (mimeType || 'video/webm').includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(recordedChunks, { type: mimeType || 'video/webm' });
      const url  = URL.createObjectURL(blob);

      preview.src = url;
      downloadLink.href     = url;
      downloadLink.download = `recording_${Date.now()}.${ext}`;
      previewSection.style.display = 'block';
      downloadLink.click();
      showMsg(`Recording saved (${formatTime(elapsedSeconds)}). Auto-download started.`, 'success');

      recordBtn.disabled = false;
      pauseBtn.disabled  = true;
      stopBtn.disabled   = true;
      pauseBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="3" y="2" width="3" height="10" rx="1" fill="white"/>
        <rect x="8" y="2" width="3" height="10" rx="1" fill="white"/>
      </svg>Pause`;
      isPaused = false;
    };

    mediaRecorder.onerror = (e) => {
      showMsg('Recording error: ' + e.error?.message, 'error');
      stopRecording();
    };

    displayMedia.getVideoTracks()[0].addEventListener('ended', () => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') stopRecording();
    });

    mediaRecorder.start(1000);
    startTimer();
    setStatus('recording');
    recordBtn.disabled = false;
    pauseBtn.disabled  = false;
    stopBtn.disabled   = false;
    showMsg('Recording in progress. Switch to your target window now.', 'info');

  } catch (err) {
    if (err.name === 'NotAllowedError') {
      showMsg('Permission denied. Please allow screen recording.', 'error');
    } else {
      showMsg('Could not start recording: ' + err.message, 'error');
    }
    setStatus('ready');
  }
});

pauseBtn.addEventListener('click', () => {
  if (!mediaRecorder) return;
  if (!isPaused) {
    mediaRecorder.pause();
    stopTimer();
    isPaused = true;
    timerDisplay.className = 'timer-display paused';
    setStatus('paused');
    pauseBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 2l9 5-9 5V2z" fill="white"/>
    </svg>Resume`;
    showMsg('Recording paused. Click Resume to continue.', 'info');
  } else {
    mediaRecorder.resume();
    startTimer();
    isPaused = false;
    timerDisplay.className = 'timer-display running';
    setStatus('recording');
    pauseBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="3" y="2" width="3" height="10" rx="1" fill="white"/>
      <rect x="8" y="2" width="3" height="10" rx="1" fill="white"/>
    </svg>Pause`;
    clearMsg();
  }
});

stopBtn.addEventListener('click', stopRecording);

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  mediaRecorder.stop();
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
}

// ---- Init ----
setStatus('ready');
statusDot.classList.add('ready');
