/**
 * War Room API v2 — D1-backed Agent + Koa Collaboration
 *
 * Tables:
 *   threads  — id, title, status, participants, created_by, created_at, updated_at
 *   messages — id, thread_id, sender, content, msg_type, created_at
 *
 * Endpoints:
 *   GET    /api/warroom/health
 *   GET    /api/warroom/threads                         → list threads
 *   GET    /api/warroom/threads/:id                     → get thread
 *   POST   /api/warroom/threads                         → create thread
 *   PUT    /api/warroom/threads/:id                     → update thread
 *   GET    /api/warroom/threads/:id/messages             → get messages (polling)
 *   POST   /api/warroom/messages                        → post a message
 *   GET    /api/warroom/messages/recent                  → recent across all threads
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  participants TEXT DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  content TEXT NOT NULL,
  msg_type TEXT DEFAULT 'message',
  created_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_since ON messages(thread_id, id);

CREATE TABLE IF NOT EXISTS presence (
  agent TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  status TEXT DEFAULT 'typing',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (agent, thread_id)
);
`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    try {
      // Auto-migrate on first request
      await ensureSchema(env.DB);

      let res;

      // Health
      if (path === '/api/warroom/health') {
        res = json({ status: 'ok', service: 'warroom-api', version: '2.0.0' });
      }
      // List threads
      else if (path === '/api/warroom/threads' && method === 'GET') {
        res = await listThreads(env.DB, url.searchParams);
      }
      // Create thread
      else if (path === '/api/warroom/threads' && method === 'POST') {
        res = await createThread(env.DB, await request.json());
      }
      // Single thread
      else if (matchPath(path, '/api/warroom/threads/:id') && method === 'GET') {
        res = await getThread(env.DB, extractId(path, 4));
      }
      // Update thread
      else if (matchPath(path, '/api/warroom/threads/:id') && method === 'PUT') {
        res = await updateThread(env.DB, extractId(path, 4), await request.json());
      }
      // Thread messages (polling endpoint)
      else if (matchPath(path, '/api/warroom/threads/:id/messages') && method === 'GET') {
        res = await getMessages(env.DB, extractId(path, 4), url.searchParams);
      }
      // Post message
      else if (path === '/api/warroom/messages' && method === 'POST') {
        res = await postMessage(env.DB, await request.json(), env, ctx);
      }
      // Recent messages across threads
      else if (path === '/api/warroom/messages/recent' && method === 'GET') {
        res = await recentMessages(env.DB, url.searchParams);
      }
      // Presence: set
      else if (path === '/api/warroom/presence' && method === 'POST') {
        res = await setPresence(env.DB, await request.json());
      }
      // Presence: get
      else if (path === '/api/warroom/presence' && method === 'GET') {
        res = await getPresence(env.DB, url.searchParams);
      }
      else {
        res = json({ error: 'Not found' }, 404);
      }

      return cors(res);
    } catch (err) {
      console.error('Error:', err);
      return cors(json({ error: err.message }, 500));
    }
  }
};

// ─── Schema ───

let schemaApplied = false;
async function ensureSchema(db) {
  if (schemaApplied) return;
  const stmts = SCHEMA.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of stmts) {
    await db.prepare(stmt).run();
  }
  schemaApplied = true;
}

// ─── Threads ───

async function listThreads(db, params) {
  const status = params.get('status');
  let query = 'SELECT * FROM threads';
  const args = [];

  if (status) {
    query += ' WHERE status = ?';
    args.push(status);
  }

  query += ' ORDER BY updated_at DESC';

  const limit = Math.min(parseInt(params.get('limit') || '50'), 100);
  query += ' LIMIT ?';
  args.push(limit);

  const { results } = await db.prepare(query).bind(...args).all();

  // Parse participants JSON
  const threads = results.map(t => ({
    ...t,
    participants: safeParse(t.participants)
  }));

  return json({ threads });
}

async function getThread(db, id) {
  const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first();
  if (!thread) return json({ error: 'Thread not found' }, 404);
  thread.participants = safeParse(thread.participants);

  // Get message count
  const { count } = await db.prepare('SELECT COUNT(*) as count FROM messages WHERE thread_id = ?').bind(id).first();
  thread.message_count = count;

  return json({ thread });
}

async function createThread(db, body) {
  const { title, participants, created_by } = body;
  if (!title) return json({ error: 'title is required' }, 400);

  const id = genId();
  const now = new Date().toISOString();
  const parts = JSON.stringify(participants || []);
  const creator = created_by || 'koa';

  await db.prepare(
    'INSERT INTO threads (id, title, status, participants, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, title, 'active', parts, creator, now, now).run();

  // Auto-post system message
  await db.prepare(
    'INSERT INTO messages (thread_id, sender, content, msg_type, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, 'system', `Thread created: ${title}`, 'system', now).run();

  const thread = { id, title, status: 'active', participants: participants || [], created_by: creator, created_at: now, updated_at: now };
  return json({ thread }, 201);
}

async function updateThread(db, id, body) {
  const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first();
  if (!thread) return json({ error: 'Thread not found' }, 404);

  const now = new Date().toISOString();
  const updates = [];
  const args = [];

  if (body.title) { updates.push('title = ?'); args.push(body.title); }
  if (body.status) { updates.push('status = ?'); args.push(body.status); }
  if (body.participants) { updates.push('participants = ?'); args.push(JSON.stringify(body.participants)); }
  updates.push('updated_at = ?'); args.push(now);
  args.push(id);

  await db.prepare(`UPDATE threads SET ${updates.join(', ')} WHERE id = ?`).bind(...args).run();

  // Log status changes
  if (body.status && body.status !== thread.status) {
    await db.prepare(
      'INSERT INTO messages (thread_id, sender, content, msg_type, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, 'system', `Thread ${body.status === 'completed' ? 'completed ✅' : 'status → ' + body.status}`, 'system', now).run();
  }

  return json({ ok: true });
}

// ─── Messages ───

async function postMessage(db, body, env, ctx) {
  const { sender, thread, thread_id, content, type } = body;
  const tid = thread_id || thread;
  if (!sender || !tid || !content) {
    return json({ error: 'sender, thread/thread_id, and content are required' }, 400);
  }

  // Verify thread exists
  const thr = await db.prepare('SELECT id, title, participants FROM threads WHERE id = ?').bind(tid).first();
  if (!thr) return json({ error: 'Thread not found' }, 404);

  const now = new Date().toISOString();
  const msgType = type || 'message';

  const result = await db.prepare(
    'INSERT INTO messages (thread_id, sender, content, msg_type, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(tid, sender, content, msgType, now).run();

  // Update thread's updated_at and add participant if new
  const parts = safeParse(thr.participants);
  if (!parts.includes(sender) && sender !== 'system') {
    parts.push(sender);
    await db.prepare('UPDATE threads SET updated_at = ?, participants = ? WHERE id = ?')
      .bind(now, JSON.stringify(parts), tid).run();
  } else {
    await db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').bind(now, tid).run();
  }

  const msg = {
    id: result.meta?.last_row_id,
    thread_id: tid,
    sender,
    content,
    msg_type: msgType,
    created_at: now
  };

  // Clear typing presence on message send
  await db.prepare('DELETE FROM presence WHERE agent = ? AND thread_id = ?').bind(sender, tid).run();

  // Fire webhook notification (non-blocking)
  if (env.WEBHOOK_URL) {
    const webhook = fireWebhook(env.WEBHOOK_URL, env.WEBHOOK_SECRET, {
      event: 'message',
      message: msg,
      thread: { id: thr.id, title: thr.title, participants: parts }
    });
    if (ctx?.waitUntil) ctx.waitUntil(webhook);
  }

  return json({ message: msg }, 201);
}

// ─── Presence ───

const PRESENCE_TTL_MS = 30000; // 30s expiry

async function setPresence(db, body) {
  const { agent, thread_id, status } = body;
  if (!agent || !thread_id) return json({ error: 'agent and thread_id required' }, 400);

  const now = new Date().toISOString();

  if (status === 'idle') {
    await db.prepare('DELETE FROM presence WHERE agent = ? AND thread_id = ?').bind(agent, thread_id).run();
  } else {
    await db.prepare(
      'INSERT INTO presence (agent, thread_id, status, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(agent, thread_id) DO UPDATE SET status = ?, updated_at = ?'
    ).bind(agent, thread_id, status || 'typing', now, status || 'typing', now).run();
  }

  return json({ ok: true });
}

async function getPresence(db, params) {
  const threadId = params.get('thread_id');
  if (!threadId) return json({ error: 'thread_id required' }, 400);

  const cutoff = new Date(Date.now() - PRESENCE_TTL_MS).toISOString();

  // Clean expired
  await db.prepare('DELETE FROM presence WHERE updated_at < ?').bind(cutoff).run();

  const { results } = await db.prepare(
    'SELECT agent, status, updated_at FROM presence WHERE thread_id = ? AND updated_at >= ?'
  ).bind(threadId, cutoff).all();

  return json({ presence: results });
}

// ─── Webhook ───

async function fireWebhook(url, secret, payload) {
  const AGENT_IDS = ['atlas', 'hex', 'razor', 'kiln', 'meridian'];
  const sender = payload.message?.sender?.toLowerCase();
  const participants = (payload.thread?.participants || [])
    .map(p => p.toLowerCase())
    .filter(p => p !== sender && p !== 'koa' && AGENT_IDS.includes(p));

  if (participants.length === 0) return;

  const threadTitle = payload.thread?.title || 'War Room';
  const threadId = payload.thread?.id;
  const content = payload.message?.content;

  for (const agentId of participants) {
    try {
      const body = {
        message: `**War Room — ${threadTitle}**\nFrom **${sender}**: ${content}\n\n**MANDATORY: Read the FULL thread before responding.** GET https://warroom-api.roguefamilyfarms.workers.dev/api/warroom/threads/${threadId}/messages — Do NOT duplicate work already done. Do NOT ask questions already answered. Reference what others said. This is a conversation, not a bulletin board.\n\nTo respond: POST to https://warroom-api.roguefamilyfarms.workers.dev/api/warroom/messages with {"sender":"${agentId}","thread_id":"${threadId}","content":"your reply"}`,
        agentId,
        name: 'WarRoom',
        wakeMode: 'now',
        deliver: false
      };
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${secret}`
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      console.error(`Webhook to ${agentId} failed:`, err.message);
    }
  }
}

async function getMessages(db, threadId, params) {
  const since = params.get('since'); // message ID for polling
  const limit = Math.min(parseInt(params.get('limit') || '100'), 500);

  let query, args;

  if (since) {
    // Polling: get messages newer than the given ID
    query = 'SELECT * FROM messages WHERE thread_id = ? AND id > ? ORDER BY id ASC LIMIT ?';
    args = [threadId, parseInt(since), limit];
  } else {
    // Initial load: get last N messages
    query = 'SELECT * FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT ?';
    args = [threadId, limit];
  }

  const { results } = await db.prepare(query).bind(...args).all();

  // Reverse if initial load (so oldest first)
  const messages = since ? results : results.reverse();

  return json({ messages, thread_id: threadId });
}

async function recentMessages(db, params) {
  const limit = Math.min(parseInt(params.get('limit') || '50'), 200);
  const { results } = await db.prepare(
    'SELECT m.*, t.title as thread_title FROM messages m JOIN threads t ON m.thread_id = t.id ORDER BY m.id DESC LIMIT ?'
  ).bind(limit).all();

  return json({ messages: results.reverse() });
}

// ─── Helpers ───

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function safeParse(s) {
  try { return JSON.parse(s || '[]'); } catch { return []; }
}

function matchPath(actual, pattern) {
  const aParts = actual.split('/').filter(Boolean);
  const pParts = pattern.split('/').filter(Boolean);
  if (aParts.length !== pParts.length) return false;
  return pParts.every((p, i) => p.startsWith(':') || p === aParts[i]);
}

function extractId(path, segIndex) {
  return path.split('/').filter(Boolean)[segIndex - 1];
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function cors(response) {
  const h = new Headers(response.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  h.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, { status: response.status, headers: h });
}
