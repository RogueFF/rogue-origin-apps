/**
 * AI chat and TTS handlers.
 */

import { successResponse, errorResponse } from '../../lib/response.js';
import { TIMEZONE } from '../../lib/production-helpers.js';
import { AI_MODEL, getConfig } from '../../lib/production-utils.js';

async function chat(body, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return errorResponse('AI chat not configured', 'INTERNAL_ERROR', 500);
  }

  const userMessage = body.userMessage || '';

  const MAX_MESSAGE_LENGTH = 4000;
  if (typeof userMessage !== 'string' || userMessage.length > MAX_MESSAGE_LENGTH) {
    return errorResponse(`Message too long (max ${MAX_MESSAGE_LENGTH} characters)`, 'VALIDATION_ERROR', 400);
  }
  const history = Array.isArray(body.history) ? body.history.slice(-20) : [];

  if (!userMessage) {
    return errorResponse('No message provided', 'VALIDATION_ERROR', 400);
  }

  const aiModel = (await getConfig(env, 'api.ai_model')) ?? AI_MODEL;

  const { getScoreboardData } = await import('./scoreboard.js');
  const { getBagTimerData } = await import('./bag-tracking.js');
  const scoreboardData = await getScoreboardData(env);
  const timerData = await getBagTimerData(env);

  const now = new Date();
  const currentTime = now.toLocaleString('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const systemPrompt = `You are the Rogue Origin AI Assistant for a hemp processing facility.

CURRENT TIME: ${currentTime}

TODAY'S PRODUCTION:
- Tops: ${(scoreboardData.todayLbs || 0).toFixed(1)} lbs
- Target: ${(scoreboardData.todayTarget || 0).toFixed(1)} lbs
- Performance: ${Math.round(scoreboardData.todayPercentage || 0)}%
- Strain: ${scoreboardData.strain || 'Unknown'}

CREW: ${scoreboardData.currentHourTrimmers || 0} trimmers
BAGS: ${timerData.bags5kgToday || 0} (5kg) today

Be concise and helpful. Support English and Spanish.`;

  const messages = [];
  for (const msg of history.slice(-10)) {
    messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: 'user', content: userMessage });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: aiModel,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    return errorResponse('AI service error', 'INTERNAL_ERROR', 500);
  }

  const aiResult = await response.json();
  const aiResponse = aiResult.content?.[0]?.text || 'Sorry, I could not generate a response.';

  return successResponse({ response: aiResponse });
}

async function tts(body, env) {
  if (!env.GOOGLE_TTS_API_KEY) {
    return errorResponse('TTS not configured', 'INTERNAL_ERROR', 500);
  }

  const text = body.text;
  if (!text) {
    return errorResponse('No text provided', 'VALIDATION_ERROR', 400);
  }

  const truncatedText = text.length > 5000 ? `${text.substring(0, 5000)}...` : text;

  const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${env.GOOGLE_TTS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text: truncatedText },
      voice: { languageCode: 'en-US', name: 'en-US-Neural2-A', ssmlGender: 'MALE' },
      audioConfig: { audioEncoding: 'MP3', pitch: 0.0, speakingRate: 1.1 },
    }),
  });

  if (!response.ok) {
    return errorResponse('TTS API error', 'INTERNAL_ERROR', 500);
  }

  const result = await response.json();
  if (result.audioContent) {
    return successResponse({ audioBase64: result.audioContent });
  }

  return errorResponse('TTS failed', 'INTERNAL_ERROR', 500);
}

export { chat, tts };
