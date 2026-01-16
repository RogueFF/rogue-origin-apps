/**
 * Voice Module
 * Handles Speech-to-Text (STT) and Text-to-Speech (TTS) for AI chat
 */

import { API_URL } from './config.js';
import { isAppsScript } from './state.js';

// State management
let isVoiceEnabled = false;
let recognition = null;
let isSpeaking = false;
let isListening = false;
let currentAudio = null;

/**
 * Initialize voice recognition (Web Speech API)
 * @returns {boolean} True if supported, false otherwise
 */
export function initVoiceRecognition() {
  // Check browser support
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.log('[Voice] Speech recognition not supported');
    return false;
  }

  try {
    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    console.log('[Voice] Recognition initialized');
    return true;

  } catch (error) {
    console.error('[Voice] Recognition init error:', error);
    return false;
  }
}

/**
 * Start listening for voice input
 * @returns {Promise<string>} Resolves with transcript
 */
export function startListening() {
  return new Promise((resolve, reject) => {
    if (!recognition) {
      const initialized = initVoiceRecognition();
      if (!initialized) {
        reject(new Error('Speech recognition not supported'));
        return;
      }
    }

    if (isListening) {
      console.log('[Voice] Already listening');
      reject(new Error('Already listening'));
      return;
    }

    isListening = true;

    // Set up event handlers
    recognition.onresult = function(event) {
      const transcript = event.results[0][0].transcript;
      console.log('[Voice] Recognized:', transcript);
      isListening = false;
      resolve(transcript);
    };

    recognition.onerror = function(event) {
      console.error('[Voice] Recognition error:', event.error);
      isListening = false;

      let errorMessage = 'Speech recognition failed';
      switch (event.error) {
        case 'no-speech':
          errorMessage = 'No speech detected. Please try again.';
          break;
        case 'audio-capture':
          errorMessage = 'No microphone found. Please check your device.';
          break;
        case 'not-allowed':
          errorMessage = 'Microphone permission denied. Please allow access.';
          break;
        case 'network':
          errorMessage = 'Network error. Please check your connection.';
          break;
      }

      reject(new Error(errorMessage));
    };

    recognition.onend = function() {
      console.log('[Voice] Recognition ended');
      isListening = false;
    };

    // Start recognition
    try {
      recognition.start();
      console.log('[Voice] Started listening');
    } catch (error) {
      isListening = false;
      reject(error);
    }
  });
}

/**
 * Stop listening
 */
export function stopListening() {
  if (recognition && isListening) {
    try {
      recognition.stop();
      isListening = false;
      console.log('[Voice] Stopped listening');
    } catch (error) {
      console.error('[Voice] Stop error:', error);
    }
  }
}

/**
 * Check if response should be read in full
 * @param {string} text - Response text
 * @returns {boolean}
 */
function shouldReadFullResponse(text) {
  // Remove HTML tags for accurate word count
  const plainText = text.replace(/<[^>]*>/g, '');
  const wordCount = plainText.trim().split(/\s+/).length;
  return wordCount <= 150;
}

/**
 * Get speakable version of response text
 * @param {string} responseText - Original response
 * @returns {string} Text to speak
 */
function getSpeakableText(responseText) {
  if (shouldReadFullResponse(responseText)) {
    // Remove HTML tags but keep the content
    return responseText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  } else {
    return 'I have a detailed answer for you. Check the screen for the full details.';
  }
}

/**
 * Convert base64 audio to playable blob URL
 * @param {string} base64Audio - Base64 encoded audio
 * @returns {string} Blob URL
 */
function base64ToAudioBlob(base64Audio) {
  const binaryString = atob(base64Audio);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const blob = new Blob([bytes], { type: 'audio/mp3' });
  return URL.createObjectURL(blob);
}

/**
 * Speak text using Google Cloud TTS
 * @param {string} text - Text to speak
 * @returns {Promise<void>}
 */
export function speak(text) {
  return new Promise((resolve, reject) => {
    if (!isVoiceEnabled) {
      console.log('[Voice] Voice mode disabled, skipping TTS');
      resolve();
      return;
    }

    if (isSpeaking) {
      console.log('[Voice] Already speaking, stopping current');
      stopSpeaking();
    }

    // Get speakable version (smart mode)
    const speakableText = getSpeakableText(text);
    console.log('[Voice] Speaking:', `${speakableText.substring(0, 50)}...`);

    isSpeaking = true;
    showSpeakingIndicator(true);

    // Prepare request data
    const requestData = {
      text: speakableText
    };

    // Call backend TTS endpoint
    if (isAppsScript()) {
      // Apps Script environment
      google.script.run
        .withSuccessHandler(function(response) {
          playAudio(response, resolve, reject);
        })
        .withFailureHandler(function(error) {
          console.error('[Voice] TTS error:', error);
          isSpeaking = false;
          showSpeakingIndicator(false);
          reject(new Error(`TTS failed: ${error.message}`));
        })
        .handleTTSRequest(requestData);

    } else {
      // Web app environment
      fetch(`${API_URL}?action=tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(requestData),
        cache: 'no-store'
      })
      .then(function(r) { return r.json(); })
      .then(function(response) {
        playAudio(response, resolve, reject);
      })
      .catch(function(error) {
        console.error('[Voice] TTS error:', error);
        isSpeaking = false;
        showSpeakingIndicator(false);
        reject(error);
      });
    }
  });
}

/**
 * Play audio from TTS response
 * @param {Object} response - Backend response with audioBase64
 * @param {Function} resolve - Promise resolve
 * @param {Function} reject - Promise reject
 */
function playAudio(response, resolve, reject) {
  if (!response.success || !response.audioBase64) {
    console.error('[Voice] TTS failed:', response.error);
    isSpeaking = false;
    showSpeakingIndicator(false);
    reject(new Error(response.error || 'TTS failed'));
    return;
  }

  try {
    // Convert base64 to blob URL
    const audioUrl = base64ToAudioBlob(response.audioBase64);

    // Create and play audio
    currentAudio = new Audio(audioUrl);

    currentAudio.onended = function() {
      console.log('[Voice] Playback complete');
      isSpeaking = false;
      showSpeakingIndicator(false);
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      resolve();
    };

    currentAudio.onerror = function(error) {
      console.error('[Voice] Playback error:', error);
      isSpeaking = false;
      showSpeakingIndicator(false);
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      reject(new Error('Audio playback failed'));
    };

    currentAudio.play();

  } catch (error) {
    console.error('[Voice] Audio creation error:', error);
    isSpeaking = false;
    showSpeakingIndicator(false);
    reject(error);
  }
}

/**
 * Stop current speech
 */
export function stopSpeaking() {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    } catch (error) {
      console.error('[Voice] Stop error:', error);
    }
  }
  isSpeaking = false;
  showSpeakingIndicator(false);
  console.log('[Voice] Stopped speaking');
}

/**
 * Show/hide speaking indicator
 * @param {boolean} show - True to show, false to hide
 */
function showSpeakingIndicator(show) {
  const indicator = document.getElementById('aiVoiceStatus');
  if (indicator) {
    if (show) {
      indicator.textContent = '🔊 Speaking...';
      indicator.style.display = 'flex';
    } else {
      indicator.style.display = 'none';
    }
  }
}

/**
 * Toggle voice mode on/off
 * @returns {boolean} New state
 */
export function toggleVoice() {
  isVoiceEnabled = !isVoiceEnabled;
  console.log('[Voice] Voice mode:', isVoiceEnabled ? 'enabled' : 'disabled');

  // Stop any current speech when disabling
  if (!isVoiceEnabled && isSpeaking) {
    stopSpeaking();
  }

  return isVoiceEnabled;
}

/**
 * Get voice mode status
 * @returns {boolean}
 */
export function isVoiceActive() {
  return isVoiceEnabled;
}

/**
 * Check if currently speaking
 * @returns {boolean}
 */
export function isSpeakingNow() {
  return isSpeaking;
}

/**
 * Check if currently listening
 * @returns {boolean}
 */
export function isListeningNow() {
  return isListening;
}

// Initialize on module load
console.log('[Voice] Module loaded');
