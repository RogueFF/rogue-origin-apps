/** One way to save from any view. Resolves {data} once the server confirms. */
import { call } from './api.js';

export async function submit(action, body) {
  return { data: await call(action, body) };
}

const ACTOR_KEY = 'consign_actor';
export const actor = () => { try { return localStorage.getItem(ACTOR_KEY) || ''; } catch { return ''; } };
export const setActor = (v) => { try { localStorage.setItem(ACTOR_KEY, v || ''); } catch { /* private mode */ } };
