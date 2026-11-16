/**
 * One way to save from any view. Resolves {data} once the server confirms, or
 * {held: true} when there was no signal and the entry was kept on this device.
 * Rejects with the server's message on a refusal; with err.blocking when the
 * entry could neither be sent nor kept (the person must write it down).
 */
import { call } from './api.js';
import { hold } from './held.js';

export async function submit(action, body) {
  try {
    return { data: await call(action, body) };
  } catch (err) {
    // No signal, or a failure worth retrying (auth, rate limit, server trouble): keep it.
    if (!err.network && !err.retry) throw err;
    if (!hold(action, body)) {
      const e = new Error('hold failed');
      e.blocking = true;
      throw e;
    }
    return { held: true };
  }
}

const ACTOR_KEY = 'consign_actor';
export const actor = () => { try { return localStorage.getItem(ACTOR_KEY) || ''; } catch { return ''; } };
export const setActor = (v) => { try { localStorage.setItem(ACTOR_KEY, v || ''); } catch { /* private mode */ } };
