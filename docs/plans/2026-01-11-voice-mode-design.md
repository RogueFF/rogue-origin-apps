# Voice Mode Implementation Design

**Date:** January 11, 2026
**Feature:** Voice Mode for AI Assistant
**Status:** Implementation Ready

---

## Overview

Add voice capabilities to the Rogue Origin AI Assistant, enabling speech-to-text input and text-to-speech output for hands-free interaction on the production floor.

## User Story

As a production manager, I want to ask the AI questions hands-free and hear responses aloud, so I can get updates while working without stopping to type or read.

## Requirements

### Functional
- **Speech-to-Text (STT):** Click 🎤 button → speak question → auto-sends when done
- **Text-to-Speech (TTS):** Toggle 🔊 button → AI reads short responses aloud
- **Smart Mode:** Long responses (>150 words) get summarized as "Check the screen for details"
- **Visual Feedback:** Show listening/speaking status clearly
- **Chrome/Edge Only:** Primary browser support (excellent Web Speech API)

### Non-Functional
- **Latency:** TTS response within 1 second
- **Cost:** Stay within Google Cloud TTS free tier (4M characters/month)
- **Security:** API keys never exposed to frontend
- **Reliability:** Graceful fallback if APIs unavailable

---

## Architecture

### System Components

```
┌─────────────────┐
│   Frontend      │
│  (Browser)      │
│                 │
│  ┌───────────┐  │
│  │ voice.js  │  │  ← Speech-to-Text (Web Speech API)
│  └───────────┘  │  ← Text-to-Speech (Audio playback)
│        │        │
│        ↓        │
│  ┌───────────┐  │
│  │ panels.js │  │  ← Triggers TTS after AI response
│  └───────────┘  │
└────────┬────────┘
         │
         ↓
┌────────────────────────┐
│   Apps Script Backend  │
│                        │
│  handleTTSRequest()    │  → Calls Google Cloud TTS API
│                        │  → Returns audio (base64 or URL)
│  (keeps API key safe)  │
└────────────────────────┘
```

### Data Flow

**Speech-to-Text Flow:**
1. User clicks 🎤 button
2. `startListening()` activates `webkitSpeechRecognition`
3. Show "🎤 Listening..." indicator
4. Auto-stops after 2 seconds of silence
5. Transcribed text populates input field
6. Auto-sends message to AI

**Text-to-Speech Flow:**
1. AI response arrives in `panels.js`
2. Check if voice enabled (`isVoiceEnabled`)
3. Check response length:
   - **<150 words:** Send full text to backend TTS
   - **>150 words:** Send "I have a detailed answer for you, check the screen"
4. Backend calls Google Cloud TTS
5. Returns audio data (base64 or blob URL)
6. Frontend plays audio through Web Audio API
7. Show "🔊 Speaking..." while playing

---

## Implementation Details

### 1. Frontend: voice.js Module

**New Functions:**

```javascript
// Speech-to-Text
export function initVoiceRecognition()
  - Creates webkitSpeechRecognition instance
  - Sets language to 'en-US'
  - Configures continuous: false, interimResults: false
  - Returns boolean (supported or not)

export function startListening()
  - Starts recognition
  - Returns Promise that resolves with transcript
  - Shows visual feedback (status indicator)
  - Auto-stops on silence (2 sec)

export function stopListening()
  - Stops recognition immediately
  - Hides status indicator

// Text-to-Speech
export function speak(text)
  - Checks isVoiceEnabled
  - Checks text length
  - Calls backend TTS endpoint
  - Plays returned audio
  - Shows "🔊 Speaking..." indicator
  - Returns Promise (resolves when done speaking)

export function stopSpeaking()
  - Stops current audio playback
  - Hides speaking indicator

// State Management
export function toggleVoice()
  - Toggles isVoiceEnabled flag
  - Updates 🔊 button visual state
  - Returns new state

export function isVoiceActive()
  - Returns current isVoiceEnabled state
```

**State Variables:**
```javascript
let isVoiceEnabled = false;      // TTS on/off
let recognition = null;          // STT instance
let isSpeaking = false;          // Prevent overlaps
let isListening = false;         // Prevent double-activation
let currentAudio = null;         // Current playing audio
```

### 2. Backend: Apps Script TTS Proxy

**New Function in Code.gs:**

```javascript
function handleTTSRequest(data) {
  // Input: { text: "AI response text" }

  try {
    // Get Google Cloud TTS API key from script properties
    var apiKey = PropertiesService.getScriptProperties().getProperty('GOOGLE_TTS_API_KEY');

    if (!apiKey) {
      return { success: false, error: 'TTS not configured' };
    }

    // Call Google Cloud TTS API
    var url = 'https://texttospeech.googleapis.com/v1/text:synthesize?key=' + apiKey;

    var payload = {
      input: { text: data.text },
      voice: {
        languageCode: 'en-US',
        name: 'en-US-Neural2-F',  // Natural female voice
        ssmlGender: 'FEMALE'
      },
      audioConfig: {
        audioEncoding: 'MP3',
        pitch: 0.0,
        speakingRate: 1.0
      }
    };

    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(url, options);
    var result = JSON.parse(response.getContentText());

    if (result.audioContent) {
      return {
        success: true,
        audioBase64: result.audioContent  // Base64 encoded MP3
      };
    } else {
      return { success: false, error: 'TTS failed' };
    }

  } catch (error) {
    Logger.log('TTS Error: ' + error.message);
    return { success: false, error: error.message };
  }
}
```

**Update doPost() to handle TTS action:**

```javascript
function doPost(e) {
  // ... existing code ...

  if (action === 'tts') {
    var ttsData = JSON.parse(e.postData.contents);
    result = handleTTSRequest(ttsData);
  }

  // ... existing code ...
}
```

### 3. Frontend Integration

**panels.js - Trigger TTS after AI response:**

```javascript
// In handleSuccess() function, after displaying AI message:
function handleSuccess(response) {
  // ... existing code to display message ...

  // Trigger TTS if voice mode enabled
  if (isVoiceActive()) {
    const responseText = response.response || response.message || response;
    speak(responseText);  // From voice.js
  }
}
```

**index.js - Wire up button handlers:**

```javascript
window.aiToggleVoiceMode = function() {
  const btn = document.getElementById('aiVoiceModeToggle');
  const enabled = toggleVoice();  // From voice.js

  if (btn) {
    if (enabled) {
      btn.classList.add('active');
      showToast('Voice mode enabled', 'success', 2000);
    } else {
      btn.classList.remove('active');
      stopSpeaking();  // Stop any current speech
      showToast('Voice mode disabled', 'info', 2000);
    }
  }
};

window.aiToggleVoice = async function() {
  const btn = document.getElementById('aiVoiceBtn');
  const statusDiv = document.getElementById('aiVoiceStatus');
  const input = document.getElementById('aiInput');

  try {
    // Show listening indicator
    btn.classList.add('listening');
    statusDiv.style.display = 'flex';

    // Start listening
    const transcript = await startListening();  // From voice.js

    if (transcript) {
      input.value = transcript;
      sendAIMessage();  // Auto-send
    }

  } catch (error) {
    console.error('Voice input error:', error);
    showToast('Voice input failed: ' + error.message, 'error', 3000);

  } finally {
    // Hide listening indicator
    btn.classList.remove('listening');
    statusDiv.style.display = 'none';
  }
};
```

### 4. CSS Updates

**ai-chat.css - Visual feedback:**

```css
/* Voice button listening state */
.ai-voice-btn.listening {
  background: #ef4444;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* Voice status indicator */
.ai-voice-status {
  display: none;
  position: absolute;
  bottom: 70px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(239, 68, 68, 0.95);
  color: white;
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 1000;
}

/* Voice mode toggle active state */
.ai-voice-mode-toggle.active {
  background: rgba(34, 197, 94, 0.2);
  border-color: #22c55e;
}
```

---

## Smart Mode Logic

**Response Length Detection:**

```javascript
function shouldReadFullResponse(text) {
  // Remove HTML tags for accurate word count
  const plainText = text.replace(/<[^>]*>/g, '');
  const wordCount = plainText.trim().split(/\s+/).length;
  return wordCount <= 150;
}

function getSpeakableText(responseText) {
  if (shouldReadFullResponse(responseText)) {
    // Remove HTML tags but keep the content
    return responseText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  } else {
    return "I have a detailed answer for you. Check the screen for the full details.";
  }
}
```

---

## Error Handling

### STT Errors
- **No microphone permission:** Show toast "Please allow microphone access"
- **Recognition failed:** Show toast "Couldn't understand, please try again"
- **Browser not supported:** Disable 🎤 button, show tooltip "Voice input not supported"

### TTS Errors
- **Backend error:** Fallback to silent mode, log error
- **API key missing:** Show toast "Voice output not configured"
- **Network timeout:** Show toast "Voice unavailable, check connection"
- **Audio playback failed:** Log error, continue without speech

---

## Testing Checklist

### Speech-to-Text
- [ ] Click 🎤 → microphone permission requested (first time)
- [ ] Speak "How are we doing today" → transcribes correctly
- [ ] Auto-stops after 2 seconds silence
- [ ] Transcript populates input field
- [ ] Message auto-sends
- [ ] Visual "Listening..." indicator shows/hides correctly

### Text-to-Speech
- [ ] Toggle 🔊 button → visual state changes
- [ ] Short response (<150 words) → reads full text aloud
- [ ] Long response (>150 words) → says "Check screen for details"
- [ ] Voice sounds natural (Google Neural voice)
- [ ] Can stop speech mid-playback by toggling 🔊 off
- [ ] No overlapping speech from multiple responses

### Error Scenarios
- [ ] No microphone permission → shows helpful error
- [ ] No API key → graceful fallback
- [ ] Network offline → shows error, doesn't break chat
- [ ] Browser doesn't support Web Speech API → buttons disabled

---

## Deployment Steps

### 1. Set up Google Cloud TTS API Key

1. Go to https://console.cloud.google.com/
2. Create new project or select existing
3. Enable "Cloud Text-to-Speech API"
4. Create API key (Credentials → Create Credentials → API Key)
5. Restrict API key to Text-to-Speech API only
6. Copy API key

### 2. Configure Apps Script

1. Open Apps Script editor
2. Go to Project Settings → Script Properties
3. Add property:
   - Key: `GOOGLE_TTS_API_KEY`
   - Value: [paste your API key]
4. Deploy new version

### 3. Deploy Frontend

1. Implement voice.js changes
2. Update panels.js integration
3. Update index.js button handlers
4. Update CSS for visual feedback
5. Commit and push to GitHub
6. Wait for GitHub Pages deployment

### 4. Test

1. Open fresh incognito window
2. Navigate to production site
3. Grant microphone permission
4. Test STT: Click 🎤, speak, verify transcript
5. Test TTS: Toggle 🔊, ask question, verify audio
6. Test error scenarios

---

## Future Enhancements

### Phase 2 (Optional)
- Voice picker dropdown (choose different voices)
- Adjustable speech rate (slower/faster)
- Wake word detection ("Hey Rogue")
- Multi-language support
- Voice command shortcuts ("status", "bags", "crew")

### Phase 3 (Advanced)
- Custom voice training (sound like specific person)
- Emotional tone detection (respond to urgency)
- Background noise filtering
- Voice authentication (recognize who's speaking)

---

## Estimated Effort

- **voice.js implementation:** 2 hours
- **Backend TTS proxy:** 1 hour
- **UI integration:** 1 hour
- **Testing & polish:** 1 hour
- **Documentation:** 30 minutes

**Total:** 5.5 hours

---

## Success Metrics

- Voice input accuracy: >90% for clear speech
- TTS latency: <1 second from response to audio start
- Cost: <10% of free tier usage per month
- User feedback: "This is way faster than typing"

---

## Notes

- Google Cloud TTS free tier: 4 million characters/month
- Average AI response: ~200 characters
- Estimated monthly TTS calls: ~500 (well under free tier)
- Web Speech API (STT) is completely free
