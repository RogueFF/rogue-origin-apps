// ─── Atlas Popup Renderer ──────────────────────────────────────────
// Receives a notification via IPC, renders the rich card, handles
// click-to-open-panel, dismiss, acknowledge, and auto-dismiss countdown.

let notification = null;
let dismissTimeout = null;
let progressInterval = null;
let startTime = null;
let duration = 8000;
let audioContext = null;
let soundEnabled = true;

const container = document.getElementById('popup-container');
const progressBar = document.getElementById('popup-progress-bar');

// Duration per notification type (ms)
const DURATIONS = {
  toast: 8000,
  briefing: 10000,
  alert: 15000,
  'production-card': 10000
};

// ─── Web Audio Context Initialization ───────────────────────────────

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

// ─── Notification Sound Generator ───────────────────────────────────

function playNotificationSound(type) {
  if (!soundEnabled) return;

  try {
    const ctx = getAudioContext();
    
    switch (type) {
      case 'toast':
        // Soft click: short sine wave, 800Hz, 50ms
        playSineWave(ctx, 800, 0.05, 0.15);
        break;
      
      case 'briefing':
        // Warm chime: two notes, C5 (523Hz) + E5 (659Hz), 100ms each
        playSineWave(ctx, 523.25, 0.1, 0.2);
        setTimeout(() => playSineWave(ctx, 659.25, 0.1, 0.2), 120);
        break;
      
      case 'alert':
        // Urgent double-ping: two short 1200Hz pings, 60ms gap
        playSineWave(ctx, 1200, 0.06, 0.3);
        setTimeout(() => playSineWave(ctx, 1200, 0.06, 0.3), 80);
        break;
      
      case 'production-card':
        // Low hum: 200Hz, 150ms, gentle fade
        playSineWave(ctx, 200, 0.15, 0.15);
        break;
      
      default:
        playSineWave(ctx, 800, 0.05, 0.15);
    }
  } catch (e) {
    console.warn('Audio playback failed:', e);
  }
}

function playSineWave(ctx, frequency, duration, volume = 0.2) {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
  
  // Envelope: quick attack, gentle release
  gainNode.gain.setValueAtTime(0, ctx.currentTime);
  gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
  
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  
  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + duration);
}

// ─── IPC: Receive notification to display ───────────────────────────

window.atlas.onShowPopup(async (data) => {
  notification = data.notification;
  duration = DURATIONS[notification.type] || 8000;

  // Check sound setting
  try {
    const settings = await window.atlas.getSettings();
    soundEnabled = settings.soundEnabled !== false;
  } catch (e) {
    soundEnabled = true;
  }

  // Play notification sound
  if (soundEnabled) {
    playNotificationSound(notification.type);
  }

  // Render the card
  container.innerHTML = renderCard(notification);

  // Speak if TTS enabled
  speakNotification(notification);

  // Start auto-dismiss countdown (unless TTS paused it)
  if (!notification.tts && !notification.data?.tts) {
    startCountdown();
  }
});

// ─── Auto-dismiss countdown with progress bar ───────────────────────

function startCountdown() {
  startTime = Date.now();

  progressInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, 1 - elapsed / duration);
    progressBar.style.transform = `scaleX(${remaining})`;
  }, 50);

  dismissTimeout = setTimeout(() => {
    dismiss();
  }, duration);
}

function resetCountdown() {
  clearTimeout(dismissTimeout);
  clearInterval(progressInterval);
  progressBar.style.transform = 'scaleX(1)';
}

// ─── Dismiss ────────────────────────────────────────────────────────

function dismiss() {
  resetCountdown();
  stopTTS();
  document.body.classList.add('popup-dismissing');

  // Wait for slide-out animation to finish
  setTimeout(() => {
    window.atlas.popupDismiss();
  }, 300);
}

// ─── IPC: Main process can force-dismiss ────────────────────────────

window.atlas.onDismissPopup(() => {
  dismiss();
});

// ─── Click handling ─────────────────────────────────────────────────

container.addEventListener('click', (e) => {
  // Alert acknowledge button
  const ackBtn = e.target.closest('.btn-acknowledge');
  if (ackBtn) {
    e.stopPropagation();
    const id = ackBtn.dataset.ackId;
    window.atlas.popupAcknowledge(id);

    // Update UI to show acknowledged
    ackBtn.closest('.alert-footer').innerHTML = '<div class="alert-acked">Acknowledged</div>';

    // Dismiss after short delay so user sees the ack state
    resetCountdown();
    dismissTimeout = setTimeout(() => dismiss(), 2000);
    return;
  }

  // Click anywhere else on the card → open panel + dismiss
  window.atlas.popupClicked(notification.id);
  dismiss();
});

// ─── TTS — ElevenLabs audio_url or Web Speech fallback ──────────────

let ttsAudio = null;

function speakNotification(notif) {
  if (!notif.tts && !notif.data?.tts) return;

  // Prefer pre-generated audio URL (ElevenLabs)
  if (notif.audio_url) {
    resetCountdown();
    ttsAudio = new Audio(notif.audio_url);
    ttsAudio.volume = 0.9;
    ttsAudio.onended = () => { ttsAudio = null; startCountdown(); };
    ttsAudio.onerror = () => { ttsAudio = null; fallbackSpeech(notif); };
    ttsAudio.play().catch(() => fallbackSpeech(notif));
    return;
  }

  fallbackSpeech(notif);
}

function fallbackSpeech(notif) {
  if (!window.speechSynthesis) { startCountdown(); return; }

  let text = '';
  if (notif.data?.segments?.length) {
    text = notif.data.segments.map(s => `${s.label}. ${s.text}`).join('. ');
  } else {
    text = notif.body || notif.title || '';
  }
  if (!text) { startCountdown(); return; }

  resetCountdown();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.volume = 0.9;
  utterance.onend = () => startCountdown();
  utterance.onerror = () => startCountdown();
  window.speechSynthesis.speak(utterance);
}

function stopTTS() {
  if (ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

// ─── Pause countdown on hover ───────────────────────────────────────

container.addEventListener('mouseenter', () => {
  clearTimeout(dismissTimeout);
  clearInterval(progressInterval);
});

container.addEventListener('mouseleave', () => {
  // Resume with remaining time
  const elapsed = Date.now() - startTime;
  const remaining = Math.max(1000, duration - elapsed);

  progressInterval = setInterval(() => {
    const now = Date.now();
    const totalElapsed = now - startTime;
    const pct = Math.max(0, 1 - totalElapsed / duration);
    progressBar.style.transform = `scaleX(${pct})`;
  }, 50);

  dismissTimeout = setTimeout(() => {
    dismiss();
  }, remaining);
});
