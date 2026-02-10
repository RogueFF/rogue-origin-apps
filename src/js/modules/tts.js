/**
 * TTS Module — Text-to-Speech for briefing system
 * Uses browser SpeechSynthesis API with graceful degradation
 */

let muted = false;
let speaking = false;
let currentUtterance = null;

try {
  muted = localStorage.getItem('briefing-muted') === 'true';
} catch { /* ignore */ }

/**
 * Speak a single text string via SpeechSynthesis
 */
function speakText(text) {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // Prefer a natural-sounding voice
    const voices = speechSynthesis.getVoices();
    const preferred = voices.find(v =>
      v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha')
    );
    if (preferred) utterance.voice = preferred;

    currentUtterance = utterance;

    utterance.onend = () => {
      currentUtterance = null;
      resolve();
    };
    utterance.onerror = (e) => {
      currentUtterance = null;
      // Don't reject on 'interrupted' — that's expected when stopping
      if (e.error === 'interrupted' || e.error === 'canceled') {
        resolve();
      } else {
        reject(e);
      }
    };

    speechSynthesis.speak(utterance);
  });
}

const TTS = {
  get muted() { return muted; },
  get speaking() { return speaking; },

  /**
   * Speak all segments of a briefing
   * @param {Object} briefing - { segments: [{ text }] }
   * @param {Function} onSegmentStart - called with segment index when each starts
   */
  async speak(briefing, onSegmentStart) {
    if (muted || !window.speechSynthesis) return;

    speechSynthesis.cancel();
    speaking = true;

    try {
      for (let i = 0; i < briefing.segments.length; i++) {
        if (!speaking) break; // stopped externally
        if (onSegmentStart) onSegmentStart(i);
        await speakText(briefing.segments[i].text);
        // Brief pause between segments
        if (i < briefing.segments.length - 1 && speaking) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } catch (e) {
      console.warn('TTS error:', e);
    }

    speaking = false;
  },

  stop() {
    speaking = false;
    if (window.speechSynthesis) {
      speechSynthesis.cancel();
    }
    currentUtterance = null;
  },

  toggle() {
    muted = !muted;
    try {
      localStorage.setItem('briefing-muted', muted);
    } catch { /* ignore */ }
    if (muted) this.stop();
    return muted;
  },

  setMuted(val) {
    muted = !!val;
    try {
      localStorage.setItem('briefing-muted', muted);
    } catch { /* ignore */ }
    if (muted) this.stop();
  },

  /** Pre-load voices (Chrome needs this) */
  init() {
    if (window.speechSynthesis) {
      speechSynthesis.getVoices();
      speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
    }
  }
};

export default TTS;
