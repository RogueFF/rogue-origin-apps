/**
 * Webhook Dispatcher — Mission Control → Atlas Notifications
 *
 * Non-blocking webhook that fires POST /notify to atlas-notifications
 * when high-value events occur (briefs, urgent inbox).
 *
 * Usage:
 *   import { dispatch } from './webhook.js';
 *   ctx.waitUntil(dispatch(env, 'briefing', payload));
 */

/**
 * Map MC brief data → atlas-notifications briefing format
 */
function mapBrief(body) {
  const segments = [];

  // Main brief body as primary segment
  if (body.body) {
    segments.push({
      label: body.domain || body.type || 'Brief',
      text: body.body,
      icon: 'briefing',
    });
  }

  // Action items as a separate segment
  let actionItems = body.action_items;
  if (typeof actionItems === 'string') {
    try { actionItems = JSON.parse(actionItems); } catch { actionItems = null; }
  }
  if (Array.isArray(actionItems) && actionItems.length > 0) {
    segments.push({
      label: 'Action Items',
      text: actionItems.map((a, i) => `${i + 1}. ${typeof a === 'string' ? a : a.text || a.title || JSON.stringify(a)}`).join('\n'),
      icon: 'alert',
    });
  }

  return {
    type: 'briefing',
    title: body.title,
    priority: 'normal',
    tts: true,
    ...(body.audio_url ? { audio_url: body.audio_url } : {}),
    data: { segments },
  };
}

/**
 * Map MC inbox item → atlas-notifications alert format
 */
function mapInboxAlert(body) {
  return {
    type: 'alert',
    title: body.title,
    body: body.body || `${body.agent_name}: ${body.title}`,
    priority: body.priority === 'urgent' ? 'high' : 'high',
    tts: body.priority === 'urgent',
  };
}


const MAPPERS = {
  briefing: mapBrief,
  alert: mapInboxAlert,
};

/**
 * Dispatch a webhook to atlas-notifications.
 * Non-blocking — designed to be called via ctx.waitUntil().
 * Fails silently (logs errors, never throws to caller).
 *
 * @param {object} env  - Worker env (needs NOTIFY_URL, NOTIFY_TOKEN)
 * @param {string} type - Event type: 'briefing' | 'alert'
 * @param {object} payload - MC data structure for the event
 */
export async function dispatch(env, type, payload) {
  try {
    const url = env.NOTIFY_URL;
    if (!url) return; // Not configured — skip silently

    const mapper = MAPPERS[type];
    if (!mapper) {
      console.error(`[webhook] Unknown type: ${type}`);
      return;
    }

    const body = mapper(payload);

    const headers = { 'Content-Type': 'application/json' };
    if (env.NOTIFY_TOKEN) {
      headers['Authorization'] = `Bearer ${env.NOTIFY_TOKEN}`;
    }

    const resp = await fetch(`${url}/notify`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`[webhook] ${type} dispatch failed: ${resp.status} ${text}`);
    }
  } catch (e) {
    console.error(`[webhook] ${type} dispatch error:`, e.message || e);
  }
}
