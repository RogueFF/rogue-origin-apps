# Voice Mode Setup Guide

This guide walks you through setting up voice mode (speech-to-text and text-to-speech) for the Rogue Origin AI Assistant.

---

## Overview

Voice mode consists of two parts:
1. **Speech-to-Text (STT)** - Uses browser's built-in Web Speech API (free, no setup needed)
2. **Text-to-Speech (TTS)** - Uses Google Cloud TTS API (free tier: 4M characters/month)

---

## Part 1: Google Cloud TTS Setup (Required for Voice Output)

### Step 1: Create Google Cloud Project

1. Go to https://console.cloud.google.com/
2. Sign in with your Google account
3. Click **Select a project** dropdown at the top
4. Click **NEW PROJECT**
5. Project name: `rogue-origin-tts` (or any name you prefer)
6. Click **CREATE**
7. Wait for project creation (~30 seconds)

### Step 2: Enable Cloud Text-to-Speech API

1. In the Google Cloud Console, make sure your new project is selected
2. Go to **APIs & Services** → **Library**
   - Or visit: https://console.cloud.google.com/apis/library
3. Search for "Text-to-Speech"
4. Click on **Cloud Text-to-Speech API**
5. Click **ENABLE**
6. Wait for activation (~10 seconds)

### Step 3: Create API Key

1. Go to **APIs & Services** → **Credentials**
   - Or visit: https://console.cloud.google.com/apis/credentials
2. Click **+ CREATE CREDENTIALS** at the top
3. Select **API key**
4. Your API key will be created and displayed
5. **IMPORTANT:** Click **Edit API key** (or the pencil icon)

### Step 4: Restrict API Key (Security Best Practice)

1. In the API key settings:
   - **Application restrictions:**
     - Select **None** (since it's called from Apps Script backend)
   - **API restrictions:**
     - Select **Restrict key**
     - Search for and select **Cloud Text-to-Speech API**
     - Click **OK**
2. Click **SAVE**
3. **Copy your API key** - you'll need it in the next step
   - Format: `AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`

---

## Part 2: Configure Apps Script Backend

### Step 1: Open Apps Script

1. Open your Google Sheet (production tracking)
2. Click **Extensions** → **Apps Script**
3. Wait for the script editor to load

### Step 2: Add API Key to Script Properties

1. In the Apps Script editor, click the **Settings** icon (⚙️) in the left sidebar
2. Scroll down to **Script Properties**
3. Click **+ Add script property**
4. Enter:
   - **Property:** `GOOGLE_TTS_API_KEY`
   - **Value:** Paste your API key from Step 3 above
5. Click **Save script properties**

### Step 3: Update Code.gs

1. Go back to the **Editor** tab
2. Open `Code.gs`
3. Make sure the latest code with `handleTTSRequest` function is present
4. The function should already be there after following the implementation guide

### Step 4: Deploy New Version

1. Click **Deploy** → **Manage deployments**
2. Click the **pencil icon (✏️)** next to your active deployment
3. Under **Version**, select **New version**
4. Description: `Add voice mode TTS support`
5. Click **Deploy**
6. Click **Done**

**Note:** The deployment URL stays the same - no need to update your frontend config.

---

## Part 3: Test Voice Mode

### Step 1: Deploy Frontend Changes

```bash
# Make sure all voice mode files are committed
git add src/js/modules/voice.js
git add src/js/modules/index.js
git add src/js/modules/panels.js
git add src/css/ai-chat.css
git commit -m "feat: add voice mode with Google Cloud TTS"
git push
```

### Step 2: Wait for Deployment

- Wait 1-2 minutes for GitHub Pages to deploy the changes
- You can check deployment status at: https://github.com/YOUR_USERNAME/rogue-origin-apps/actions

### Step 3: Test Speech-to-Text (Microphone Input)

1. Open https://rogueff.github.io/rogue-origin-apps/ in **Chrome or Edge**
2. Open AI chat (click 🌿 button)
3. Click the 🎤 **microphone button** (bottom right of input)
4. **Allow microphone access** when prompted (first time only)
5. You should see "🎤 Listening..." indicator appear
6. Say: **"How are we doing today?"**
7. Wait 2 seconds (auto-stops)
8. Your speech should appear as text in the input field
9. Message should auto-send to AI

✅ **Expected:** Text appears in input, message sends automatically

❌ **If it fails:**
- Check browser console (F12) for errors
- Make sure you're using Chrome or Edge (Safari has limited support)
- Grant microphone permission if blocked

### Step 4: Test Text-to-Speech (Voice Output)

1. Click the 🔊 **Voice button** in the AI chat header (should turn green/active)
2. Ask a question: "What's our production status?"
3. Wait for AI response
4. You should hear the AI read the response aloud

✅ **Expected:** Voice reads the response with natural-sounding female voice

❌ **If it fails:**
- Check browser console (F12) for TTS errors
- Verify API key is correctly set in Apps Script properties
- Check Apps Script execution logs for errors
- Make sure backend deployment succeeded

### Step 5: Test Smart Mode (Long Responses)

1. Keep voice mode enabled (🔊 button active)
2. Ask: "Give me a detailed breakdown of today's production"
3. AI will respond with detailed data cards
4. You should hear: **"I have a detailed answer for you. Check the screen for the full details."**

✅ **Expected:** Short summary spoken instead of reading entire long response

---

## Troubleshooting

### Microphone Not Working

**Error:** "Microphone permission denied"
- **Solution:** Click the 🔒 icon in browser address bar → Site settings → Allow Microphone

**Error:** "No speech detected"
- **Solution:** Speak louder and closer to microphone, try again

**Error:** "Speech recognition not supported"
- **Solution:** Use Chrome or Edge browser (Safari has limited Web Speech API support)

### Voice Output Not Working

**Error:** "TTS not configured"
- **Solution:**
  1. Check that `GOOGLE_TTS_API_KEY` is set in Apps Script properties
  2. Make sure there are no spaces before/after the API key
  3. Redeploy Apps Script after adding the key

**Error:** "TTS API error: 400"
- **Solution:**
  1. Verify your API key is correct (no typos)
  2. Make sure Cloud Text-to-Speech API is enabled
  3. Check API key restrictions (should include Text-to-Speech API)

**Error:** "TTS API error: 403"
- **Solution:**
  1. Your API key may be restricted incorrectly
  2. Go to Cloud Console → APIs & Services → Credentials
  3. Edit your API key, set API restrictions to "Cloud Text-to-Speech API"

**No audio plays:**
- **Solution:**
  1. Check browser volume is not muted
  2. Open browser console (F12) and look for audio playback errors
  3. Try refreshing the page
  4. Check that 🔊 button is active (green)

### Backend Errors

**Check Apps Script Execution Logs:**
1. Open Apps Script editor
2. Click **Executions** icon (📝) in left sidebar
3. Look for errors in recent executions
4. Common issues:
   - Missing API key: Add `GOOGLE_TTS_API_KEY` to script properties
   - API disabled: Enable Cloud Text-to-Speech API in Cloud Console
   - Invalid API key: Double-check API key for typos

---

## Usage Tips

### Best Practices

1. **Toggle voice mode on/off as needed**
   - Click 🔊 to enable voice output when you want hands-free updates
   - Disable it for long/complex responses you prefer to read

2. **Microphone usage**
   - Click 🎤, wait for "Listening..." indicator
   - Speak clearly and naturally
   - No need to click again - it auto-stops after 2 seconds of silence

3. **Smart mode**
   - Short responses (<150 words): Full voice output
   - Long responses (>150 words): "Check the screen" summary
   - This prevents long TTS readings that are better read visually

### Keyboard Shortcuts

- **Enter**: Send message (when typing)
- **Escape**: Close AI chat panel
- No keyboard shortcut for voice yet (coming in future update)

---

## Cost & Usage Limits

### Google Cloud TTS Free Tier

- **Free:** 4 million characters per month
- **Pricing after free tier:** $4-16 per 1M characters

### Your Estimated Usage

- Average AI response: ~200 characters
- Short responses read aloud: ~50% of responses
- Estimated responses per month: ~500

**Total monthly usage:** ~50,000 characters (1.25% of free tier)

✅ **You'll stay well within the free tier** for typical usage!

### Monitor Usage (Optional)

1. Go to https://console.cloud.google.com/apis/dashboard
2. Select your project
3. View **Cloud Text-to-Speech API** usage metrics
4. Set up billing alerts if you want notifications

---

## Feature Roadmap

### Coming Soon
- Voice command shortcuts ("status", "bags", "crew")
- Wake word detection ("Hey Rogue")
- Voice picker (choose different voices/speeds)
- Multi-language support

### Future Enhancements
- Custom voice training
- Emotion detection in voice
- Background noise filtering

---

## Support

**Issues?**
- Check browser console (F12) for detailed error messages
- Review Apps Script execution logs
- Verify all setup steps were completed

**Need Help?**
- Report issues at: [GitHub Issues](https://github.com/YOUR_USERNAME/rogue-origin-apps/issues)
- Include browser console errors and Apps Script logs

---

## Security Notes

### API Key Security

✅ **Good:**
- API key is stored in Apps Script properties (server-side)
- Never exposed to frontend code or browser
- Restricted to Text-to-Speech API only

❌ **Never:**
- Commit API keys to git
- Share API keys publicly
- Use API keys in frontend JavaScript

### Microphone Privacy

- Microphone only activates when you click 🎤
- Audio is processed by browser's Web Speech API (local)
- No audio is sent to your backend or stored
- Transcript text is sent to AI backend (same as typed messages)

---

**Setup complete!** 🎉 You now have full voice mode capabilities.

**Next steps:** Test it in production and gather feedback from your team!
