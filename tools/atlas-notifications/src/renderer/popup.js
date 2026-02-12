// ─── Atlas Popup Renderer — Hologram Glitch Pass 3 ──────────────────────
// Receives a notification via IPC, renders the rich card, handles
// click-to-open-panel, dismiss, acknowledge, auto-dismiss countdown,
// and client-side ElevenLabs TTS with Web Speech fallback.
// Pass 3: upgraded sounds with static crackle, tts_text support,
// updated popup heights.

let notification = null;
let dismissTimeout = null;
let progressInterval = null;
let startTime = null;
let duration = 10000;
let audioContext = null;
let soundEnabled = true;

const container = document.getElementById('popup-container');
const progressBar = document.getElementById('popup-progress-bar');

// Updated durations per notification type (ms)
const DURATIONS = {
  toast: 10000,
  briefing: 15000,
  alert: 20000,
  'production-card': 12000
};

// ─── Web Audio Context ──────────────────────────────────────────────

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended (autoplay policy)
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

// ─── Static Crackle Layer ───────────────────────────────────────────
// White noise burst — very short, very quiet. Layered under each sound.

function playStaticCrackle(ctx, volume) {
  const bufferSize = ctx.sampleRate * 0.04; // 40ms of noise
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.3;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const gainNode = ctx.createGain();
  const crackleVol = (volume || 0.02);
  gainNode.gain.setValueAtTime(crackleVol, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

  // Bandpass filter for that radio static feel
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(3000, ctx.currentTime);
  filter.Q.setValueAtTime(0.5, ctx.currentTime);

  source.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ctx.destination);

  source.start(ctx.currentTime);
  source.stop(ctx.currentTime + 0.05);
}

// ─── Premium Notification Sound Generator ───────────────────────────
// Layered tones with static crackle undertone.

function playNotificationSound(type) {
  if (!soundEnabled) return;

  try {
    const ctx = getAudioContext();

    // Always play static crackle under every sound
    playStaticCrackle(ctx, 0.02);

    switch (type) {
      case 'toast':
        // Warm click: layered soft tones
        playTone(ctx, 880, 0.04, 0.12, 'sine');
        playTone(ctx, 1320, 0.03, 0.06, 'sine', 0.01);
        break;

      case 'briefing':
        // "Connection established" beep-boop before the chime
        playTone(ctx, 400, 0.06, 0.08, 'square');
        playTone(ctx, 600, 0.06, 0.08, 'square', 0.07);
        // Elegant chime: C5 → E5 → G5 arpeggio with harmonics
        setTimeout(() => {
          playStaticCrackle(ctx, 0.015);
          playTone(ctx, 523.25, 0.12, 0.18, 'sine');
          playTone(ctx, 1046.5, 0.08, 0.06, 'sine', 0.01);
        }, 160);
        setTimeout(() => {
          playTone(ctx, 659.25, 0.12, 0.18, 'sine');
          playTone(ctx, 1318.5, 0.06, 0.04, 'sine', 0.01);
        }, 260);
        setTimeout(() => {
          playTone(ctx, 783.99, 0.15, 0.14, 'sine');
        }, 360);
        break;

      case 'alert':
        // Urgent pings with low rumble undertone (60Hz sine)
        playTone(ctx, 60, 0.5, 0.06, 'sine'); // Low rumble
        playStaticCrackle(ctx, 0.03);
        playTone(ctx, 1200, 0.06, 0.28, 'sine');
        playTone(ctx, 1800, 0.04, 0.10, 'triangle', 0.005);
        setTimeout(() => {
          playTone(ctx, 1200, 0.06, 0.28, 'sine');
          playTone(ctx, 1800, 0.04, 0.10, 'triangle', 0.005);
          playStaticCrackle(ctx, 0.025);
        }, 100);
        setTimeout(() => {
          playTone(ctx, 1400, 0.08, 0.22, 'sine');
        }, 220);
        break;

      case 'production-card':
        // Low warm hum with subtle overtone
        playTone(ctx, 220, 0.18, 0.14, 'sine');
        playTone(ctx, 330, 0.12, 0.06, 'sine', 0.02);
        playTone(ctx, 440, 0.08, 0.03, 'triangle', 0.04);
        break;

      default:
        playTone(ctx, 880, 0.04, 0.12, 'sine');
    }
  } catch (e) {
    console.warn('Audio playback failed:', e);
  }
}

function playTone(ctx, frequency, duration, volume, type, delay) {
  const startAt = ctx.currentTime + (delay || 0);
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = type || 'sine';
  oscillator.frequency.setValueAtTime(frequency, startAt);

  // Envelope: quick attack, smooth exponential release
  gainNode.gain.setValueAtTime(0, startAt);
  gainNode.gain.linearRampToValueAtTime(volume, startAt + 0.008);
  gainNode.gain.exponentialRampToValueAtTime(0.001, startAt + duration);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.01);
}

// ─── IPC: Receive notification to display ───────────────────────────

window.atlas.onShowPopup(async (data) => {
  notification = data.notification;
  duration = DURATIONS[notification.type] || 10000;

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

  // Render the card using shared renderer
  container.innerHTML = renderCard(notification);

  // Resize popup for briefing cards with segments
  resizeForContent();

  // Speak if TTS enabled on the notification
  if (notification.tts || notification.data?.tts) {
    await speakNotification(notification);
  } else {
    startCountdown();
  }
});

// ─── Dynamic Popup Resize ───────────────────────────────────────────

function resizeForContent() {
  // Let the browser lay out the content, then request resize via IPC
  requestAnimationFrame(() => {
    const card = container.querySelector('.notif-card');
    if (!card) return;
    // The height is set by main process based on notification type,
    // but we can signal if we need more space
    const contentHeight = card.scrollHeight + 24; // 24px for body padding
    // Store for potential IPC resize call if main process supports it
    container.dataset.contentHeight = contentHeight;
  });
}

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

    // Flash and change to CONFIRMED
    ackBtn.textContent = '[ CONFIRMED ]';
    ackBtn.style.color = 'var(--holo-green)';
    ackBtn.style.borderColor = 'var(--holo-green)';
    ackBtn.style.textShadow = '0 0 8px rgba(0, 255, 136, 0.3)';

    // Dismiss after short delay so user sees the ack state
    resetCountdown();
    dismissTimeout = setTimeout(() => dismiss(), 2000);
    return;
  }

  // Click anywhere else on the card → open panel + dismiss
  window.atlas.popupClicked(notification.id);
  dismiss();
});

// ─── TTS — Client-Side ElevenLabs + Web Speech Fallback ─────────────

let ttsAudio = null;

async function speakNotification(notif) {
  // 1. Prefer tts_text field if present
  // 2. Then pre-generated audio_url (server-side ElevenLabs)
  // 3. Then client-side ElevenLabs with segment stitching
  // 4. Then body text
  // 5. Fallback: Web Speech

  if (notif.audio_url) {
    resetCountdown();
    ttsAudio = new Audio(notif.audio_url);
    ttsAudio.volume = 0.9;
    ttsAudio.onended = () => { ttsAudio = null; startCountdown(); };
    ttsAudio.onerror = () => { ttsAudio = null; tryClientElevenLabs(notif); };
    try {
      await ttsAudio.play();
    } catch {
      ttsAudio = null;
      await tryClientElevenLabs(notif);
    }
    return;
  }

  // 2. Try client-side ElevenLabs
  await tryClientElevenLabs(notif);
}

async function tryClientElevenLabs(notif) {
  try {
    const ttsConfig = await window.atlas.getTtsConfig();

    if (!ttsConfig.ttsEnabled) {
      startCountdown();
      return;
    }

    const apiKey = ttsConfig.elevenLabsKey;
    const voiceId = ttsConfig.elevenLabsVoice;

    if (!apiKey || !voiceId) {
      // No ElevenLabs configured, fall back to Web Speech
      fallbackSpeech(notif);
      return;
    }

    // Build TTS text — prefer tts_text field
    const text = buildTTSText(notif);
    if (!text) {
      startCountdown();
      return;
    }

    resetCountdown();

    // Call ElevenLabs API directly from renderer
    const volume = ttsConfig.ttsVolume || 0.8;

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_turbo_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!response.ok) {
      console.warn('ElevenLabs API error:', response.status);
      fallbackSpeech(notif);
      return;
    }

    // Response is audio/mpeg — create Blob URL and play
    const audioBlob = await response.blob();
    const blobUrl = URL.createObjectURL(audioBlob);

    ttsAudio = new Audio(blobUrl);
    ttsAudio.volume = volume;
    ttsAudio.onended = () => {
      ttsAudio = null;
      URL.revokeObjectURL(blobUrl);
      startCountdown();
    };
    ttsAudio.onerror = () => {
      ttsAudio = null;
      URL.revokeObjectURL(blobUrl);
      fallbackSpeech(notif);
    };

    await ttsAudio.play();
  } catch (e) {
    console.warn('Client-side ElevenLabs TTS failed:', e);
    fallbackSpeech(notif);
  }
}

function buildTTSText(notif) {
  // Fallback chain: tts_text → audio_url (handled above) → segment stitching → body text
  if (notif.tts_text) return notif.tts_text;
  if (notif.data?.tts_text) return notif.data.tts_text;
  if (notif.data?.segments?.length) {
    return notif.data.segments.map(s => `${s.label}. ${s.text}`).join('. ');
  }
  return notif.body || notif.title || '';
}

function fallbackSpeech(notif) {
  if (!window.speechSynthesis) { startCountdown(); return; }

  const text = buildTTSText(notif);
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
  if (ttsAudio) {
    ttsAudio.pause();
    // Revoke blob URL if it exists
    if (ttsAudio.src && ttsAudio.src.startsWith('blob:')) {
      URL.revokeObjectURL(ttsAudio.src);
    }
    ttsAudio = null;
  }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

// ─── Pause countdown on hover ───────────────────────────────────────

container.addEventListener('mouseenter', () => {
  clearTimeout(dismissTimeout);
  clearInterval(progressInterval);
});

container.addEventListener('mouseleave', () => {
  if (!startTime) return;

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
