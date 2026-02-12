// ─── Atlas Popup Renderer — Pass 4: Alive ────────────────────────────────
// Receives a notification via IPC, renders the rich card, handles
// click-to-open-panel, dismiss, acknowledge, auto-dismiss countdown,
// and client-side ElevenLabs TTS with Web Speech fallback.
// Pass 4: layered notification sounds with reverb, ghost trail dismiss,
// compact briefing rendering, upgraded sound design.

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

// ─── Simple Reverb via Delay Node ───────────────────────────────────
// Creates a short reverb tail using a feedback delay

function createReverb(ctx, delayTime, feedback) {
  const delay = ctx.createDelay();
  delay.delayTime.setValueAtTime(delayTime || 0.1, ctx.currentTime);

  const feedbackGain = ctx.createGain();
  feedbackGain.gain.setValueAtTime(feedback || 0.3, ctx.currentTime);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2000, ctx.currentTime);

  delay.connect(feedbackGain);
  feedbackGain.connect(filter);
  filter.connect(delay);

  // Return input node and output node
  return { input: delay, output: filter };
}

// ─── Premium Notification Sound Generator ───────────────────────────
// Pass 4: Layered sounds with reverb tails and richer textures.

async function playNotificationSound(type) {
  if (!soundEnabled) return;

  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // Always play static crackle under every sound
    playStaticCrackle(ctx, 0.02);

    switch (type) {
      case 'toast':
        // Pass 4: Short sine click (800Hz, 30ms) + high harmonic (1600Hz, 20ms) + noise burst
        playTone(ctx, 800, 0.03, 0.14, 'sine');
        playTone(ctx, 1600, 0.02, 0.06, 'sine', 0.005);
        // Tiny noise burst (10ms)
        playNoiseBurst(ctx, 0.01, 0.04);
        break;

      case 'briefing':
        // Pass 4: Two-note ascending (C5→E5) with reverb tail
        // "Connection established" beep-boop
        playTone(ctx, 400, 0.06, 0.08, 'square');
        playTone(ctx, 600, 0.06, 0.08, 'square', 0.07);

        // C5 with reverb
        setTimeout(() => {
          playStaticCrackle(ctx, 0.015);
          playToneWithReverb(ctx, 523.25, 0.15, 0.16, 'sine', 0, 0.1, 0.3);
          playTone(ctx, 1046.5, 0.08, 0.05, 'sine', 0.01); // Harmonic
        }, 160);

        // E5 with reverb
        setTimeout(() => {
          playToneWithReverb(ctx, 659.25, 0.15, 0.16, 'sine', 0, 0.1, 0.3);
          playTone(ctx, 1318.5, 0.06, 0.04, 'sine', 0.01); // Harmonic
        }, 300);

        // G5 resolution
        setTimeout(() => {
          playToneWithReverb(ctx, 783.99, 0.2, 0.12, 'sine', 0, 0.12, 0.25);
        }, 440);
        break;

      case 'alert':
        // Pass 4: Triangle wave pings (harsher), low 80Hz undertone, layered urgency
        // Low undertone — 80Hz, 200ms
        playTone(ctx, 80, 0.2, 0.08, 'sine');
        playStaticCrackle(ctx, 0.035);

        // Ping 1 — triangle waves
        playTone(ctx, 1200, 0.06, 0.26, 'triangle');
        playTone(ctx, 1800, 0.04, 0.10, 'triangle', 0.005);

        // Ping 2
        setTimeout(() => {
          playTone(ctx, 1200, 0.06, 0.26, 'triangle');
          playTone(ctx, 1800, 0.04, 0.10, 'triangle', 0.005);
          playStaticCrackle(ctx, 0.03);
        }, 100);

        // Ping 3 — higher
        setTimeout(() => {
          playTone(ctx, 1400, 0.08, 0.20, 'triangle');
          playTone(ctx, 80, 0.15, 0.05, 'sine'); // Second rumble
        }, 220);
        break;

      case 'production-card':
        // Pass 4: Warm chord — 200Hz + 250Hz + 300Hz, each at 1/3 volume, 200ms
        // Like a system coming online
        playTone(ctx, 200, 0.2, 0.06, 'sine');
        playTone(ctx, 250, 0.2, 0.06, 'sine', 0.01);
        playTone(ctx, 300, 0.2, 0.06, 'sine', 0.02);
        // Gentle overtone
        playTone(ctx, 400, 0.15, 0.02, 'triangle', 0.03);
        break;

      default:
        playTone(ctx, 800, 0.03, 0.12, 'sine');
    }
  } catch (e) {
    console.warn('Audio playback failed:', e);
  }
}

// ─── Core Audio Helpers ─────────────────────────────────────────────

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

function playToneWithReverb(ctx, frequency, duration, volume, type, delay, reverbDelay, reverbFeedback) {
  const startAt = ctx.currentTime + (delay || 0);
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = type || 'sine';
  oscillator.frequency.setValueAtTime(frequency, startAt);

  gainNode.gain.setValueAtTime(0, startAt);
  gainNode.gain.linearRampToValueAtTime(volume, startAt + 0.008);
  gainNode.gain.exponentialRampToValueAtTime(0.001, startAt + duration);

  // Direct path
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  // Reverb path via delay feedback loop
  const reverb = createReverb(ctx, reverbDelay || 0.1, reverbFeedback || 0.3);
  const reverbGain = ctx.createGain();
  reverbGain.gain.setValueAtTime(volume * 0.4, startAt);

  oscillator.connect(reverbGain);
  reverbGain.connect(reverb.input);
  reverb.output.connect(ctx.destination);

  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.5); // Extra time for reverb tail
}

function playNoiseBurst(ctx, duration, volume) {
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1);
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(volume, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(4000, ctx.currentTime);

  source.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ctx.destination);

  source.start(ctx.currentTime);
  source.stop(ctx.currentTime + duration + 0.01);
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

  // Pass 4: Render card — popup mode for compact briefings
  container.innerHTML = renderCard(notification, { popup: true });

  // Resize popup for content
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
  requestAnimationFrame(() => {
    const card = container.querySelector('.notif-card');
    if (!card) return;
    const contentHeight = card.scrollHeight + 24;
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

// ─── Dismiss — Pass 4: Ghost Trail Effect ───────────────────────────

function dismiss() {
  resetCountdown();
  stopTTS();
  document.body.classList.add('popup-dismissing');

  // Wait for ghost trail animation to finish (0.5s for afterimage)
  setTimeout(() => {
    window.atlas.popupDismiss();
  }, 500);
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
      fallbackSpeech(notif);
      return;
    }

    const text = buildTTSText(notif);
    if (!text) {
      startCountdown();
      return;
    }

    resetCountdown();
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
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.3,
          similarity_boost: 0.85,
          style: 0.4,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      console.warn('ElevenLabs API error:', response.status);
      fallbackSpeech(notif);
      return;
    }

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
