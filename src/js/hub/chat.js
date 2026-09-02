/**
 * "Ask the line" — the AI chat drawer. Text in, text out; browser speech-to-text
 * for the mic, worker TTS for the spoken reply when the speaker is on.
 */
import { chat, tts } from './api.js';
import { hasKey, unlock, forget } from './auth.js';

const HIST = 'hub-chat-history';
const SID = 'hub-chat-session';
const VOICE = 'hub-voice';
const MAX_TURNS = 20;

function sessionId() {
  let id = sessionStorage.getItem(SID);
  if (!id) { id = `hub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; sessionStorage.setItem(SID, id); }
  return id;
}
function loadHistory() {
  try { return JSON.parse(sessionStorage.getItem(HIST) || '[]'); } catch { return []; }
}
function saveHistory(h) {
  sessionStorage.setItem(HIST, JSON.stringify(h.slice(-MAX_TURNS)));
}

export function initChat(getContext) {
  const fab = document.getElementById('chatFab');
  const drawer = document.getElementById('chatDrawer');
  const scrim = document.getElementById('chatScrim');
  const closeBtn = document.getElementById('chatClose');
  const msgs = document.getElementById('chatMsgs');
  const input = document.getElementById('chatInput');
  const send = document.getElementById('chatSend');
  const mic = document.getElementById('chatMic');
  const voice = document.getElementById('chatVoice');
  const lockBtn = document.getElementById('chatLock');

  let history = loadHistory();
  let busy = false;
  let voiceOn = localStorage.getItem(VOICE) === '1';
  voice.setAttribute('aria-pressed', String(voiceOn));

  const add = (role, text) => {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  };
  const typing = () => {
    const div = document.createElement('div');
    div.className = 'msg ai typing';
    div.innerHTML = '<span></span><span></span><span></span>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  };

  for (const m of history) add(m.role === 'user' ? 'me' : 'ai', m.content);
  if (!history.length) add('ai', 'Ask about today’s production, the queue, crew, or bags. I can only see what the hub sees.');

  const open = () => { drawer.classList.add('open'); scrim.classList.add('on'); drawer.setAttribute('aria-hidden', 'false'); setTimeout(() => input.focus(), 200); refreshLock(); };
  const close = () => { drawer.classList.remove('open'); scrim.classList.remove('on'); drawer.setAttribute('aria-hidden', 'true'); };
  const refreshLock = () => { lockBtn.dataset.state = hasKey() ? 'open' : 'locked'; lockBtn.title = hasKey() ? 'Unlocked — click to forget the password' : 'Locked — click to unlock'; };

  fab.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer.classList.contains('open')) close(); });
  lockBtn.addEventListener('click', async () => {
    if (hasKey()) { forget(); } else { await unlock(); }
    refreshLock();
  });

  async function speak(text) {
    if (!voiceOn) return;
    try {
      const r = await tts(text.slice(0, 600));
      const b64 = r?.audioBase64 || r?.data?.audioBase64;
      if (b64) await new Audio(`data:audio/mpeg;base64,${b64}`).play();
    } catch { /* voice is best-effort */ }
  }

  async function ask(text) {
    const q = String(text || '').trim();
    if (!q || busy) return;
    input.value = '';
    add('me', q);
    if (!hasKey()) {
      const ok = await unlock();
      refreshLock();
      if (!ok) { add('err', 'Unlock with the shared password to ask the line.'); return; }
    }
    busy = true;
    send.disabled = true;
    const t = typing();
    try {
      const r = await chat({
        userMessage: q,
        sessionId: sessionId(),
        history: history.slice(-10),
        context: { date: new Date().toISOString(), data: getContext?.() || {} },
      });
      const reply = r?.response || r?.data?.response || r?.message || 'No reply.';
      t.remove();
      add('ai', reply);
      history = [...history, { role: 'user', content: q }, { role: 'assistant', content: reply }];
      saveHistory(history);
      speak(reply);
    } catch (err) {
      t.remove();
      const msg = String(err?.message || err);
      if (/401|Unauthorized|password/i.test(msg)) { forget(); refreshLock(); add('err', 'The saved password was rejected. Unlock again and resend.'); } else add('err', `Could not reach the assistant: ${msg}`);
    } finally {
      busy = false;
      send.disabled = false;
    }
  }

  send.addEventListener('click', () => ask(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(input.value); });
  drawer.querySelectorAll('.quick button').forEach((b) => b.addEventListener('click', () => ask(b.dataset.q)));

  voice.addEventListener('click', () => {
    voiceOn = !voiceOn;
    localStorage.setItem(VOICE, voiceOn ? '1' : '0');
    voice.setAttribute('aria-pressed', String(voiceOn));
  });

  // Speech-to-text (browser-native; Chrome and Safari).
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) mic.classList.add('hidden');
  else {
    let rec = null;
    mic.addEventListener('click', () => {
      if (rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.onresult = (e) => { const said = e.results?.[0]?.[0]?.transcript; if (said) ask(said); };
      rec.onend = () => { rec = null; mic.classList.remove('listening'); };
      rec.onerror = () => { rec = null; mic.classList.remove('listening'); };
      mic.classList.add('listening');
      rec.start();
    });
  }

  return { open, close, refreshLock };
}
