/**
 * War Room API v3 — D1-backed Agent + Koa Collaboration
 * 
 * Features: threads, messages, presence, claims, workstreams, deliverables,
 *           roles, priority, templates, thread summaries
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

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  workstream TEXT NOT NULL,
  agent TEXT NOT NULL,
  status TEXT DEFAULT 'claimed',
  claimed_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);

CREATE INDEX IF NOT EXISTS idx_claims_thread ON claims(thread_id);

CREATE TABLE IF NOT EXISTS workstreams (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  assigned_to TEXT,
  blocked_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);

CREATE INDEX IF NOT EXISTS idx_workstreams_thread ON workstreams(thread_id);

CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  workstream_id TEXT,
  agent TEXT,
  description TEXT NOT NULL,
  file_path TEXT,
  url TEXT,
  status TEXT DEFAULT 'draft',
  created_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);

CREATE INDEX IF NOT EXISTS idx_deliverables_thread ON deliverables(thread_id);
`;

const ALTER_STATEMENTS = [
  "ALTER TABLE threads ADD COLUMN roles TEXT DEFAULT '{}'",
  "ALTER TABLE threads ADD COLUMN priority TEXT DEFAULT 'normal'",
];

const TEMPLATES = {
  'bug-fix': {
    workstreams: ['Reproduce', 'Root Cause', 'Fix', 'Test', 'Deploy'],
    roles: ['investigator', 'fixer', 'reviewer']
  },
  'feature-build': {
    workstreams: ['Spec', 'Design', 'Build', 'Test', 'Deploy'],
    roles: ['architect', 'builder', 'reviewer']
  },
  'research': {
    workstreams: ['Gather', 'Analyze', 'Synthesize', 'Report'],
    roles: ['researcher', 'reviewer']
  }
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const parts = path.split('/').filter(Boolean);

    if (method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    try {
      await ensureSchema(env.DB);

      let res;

      // Health
      if (path === '/api/warroom/health') {
        res = json({ status: 'ok', service: 'warroom-api', version: '3.0.0' });
      }
      // Template creation — must be before generic threads/:id match
      else if (path === '/api/warroom/threads/from-template' && method === 'POST') {
        res = await createFromTemplate(env.DB, await request.json(), env, ctx);
      }
      // List threads
      else if (path === '/api/warroom/threads' && method === 'GET') {
        res = await listThreads(env.DB, url.searchParams);
      }
      // Create thread
      else if (path === '/api/warroom/threads' && method === 'POST') {
        res = await createThread(env.DB, await request.json(), env, ctx);
      }
      // Thread claims: POST /api/warroom/threads/:id/claims
      else if (parts.length === 5 && parts[0]==='api' && parts[1]==='warroom' && parts[2]==='threads' && parts[4]==='claims' && method === 'POST') {
        res = await createClaim(env.DB, parts[3], await request.json());
      }
      // Thread claims: GET
      else if (parts.length === 5 && parts[0]==='api' && parts[1]==='warroom' && parts[2]==='threads' && parts[4]==='claims' && method === 'GET') {
        res = await listClaims(env.DB, parts[3]);
      }
      // Update claim: PUT /api/warroom/threads/:id/claims/:claimId
      else if (parts.length === 6 && parts[0]==='api' && parts[1]==='warroom' && parts[2]==='threads' && parts[4]==='claims' && method === 'PUT') {
        res = await updateClaim(env.DB, parts[3], parts[5], await request.json());
      }
      // Workstreams: GET
      else if (parts.length === 5 && parts[0]==='api' && parts[1]==='warroom' && parts[2]==='threads' && parts[4]==='workstreams' && method === 'GET') {
        res = await listWorkstreams(env.DB, parts[3]);
      }
      // Workstreams: PUT /api/warroom/threads/:id/workstreams/:wsId
      else if (parts.length === 6 && parts[0]==='api' && parts[1]==='warroom' && parts[2]==='threads' && parts[4]==='workstreams' && method === 'PUT') {
        res = await updateWorkstream(env.DB, parts[3], parts[5], await request.json(), env, ctx);
      }
      // Deliverables: POST
      else if (parts.length === 5 && parts[0]==='api' && parts[1]==='warroom' && parts[2]==='threads' && parts[4]==='deliverables' && method === 'POST') {
        res = await createDeliverable(env.DB, parts[3], await request.json());
      }
      // Deliverables: GET
      else if (parts.length === 5 && parts[0]==='api' && parts[1]==='warroom' && parts[2]==='threads' && parts[4]==='deliverables' && method === 'GET') {
        res = await listDeliverables(env.DB, parts[3]);
      }
      // Single thread GET
      else if (parts.length === 4 && parts[0]==='api' && parts[1]==='warroom' && parts[2]==='threads' && method === 'GET') {
        res = await getThread(env.DB, parts[3]);
      }
      // Update thread PUT
      else if (parts.length === 4 && parts[0]==='api' && parts[1]==='warroom' && parts[2]==='threads' && method === 'PUT') {
        res = await updateThread(env.DB, parts[3], await request.json());
      }
      // Thread messages
      else if (parts.length === 5 && parts[0]==='api' && parts[1]==='warroom' && parts[2]==='threads' && parts[4]==='messages' && method === 'GET') {
        res = await getMessages(env.DB, parts[3], url.searchParams);
      }
      // Post message
      else if (path === '/api/warroom/messages' && method === 'POST') {
        res = await postMessage(env.DB, await request.json(), env, ctx);
      }
      // Recent messages
      else if (path === '/api/warroom/messages/recent' && method === 'GET') {
        res = await recentMessages(env.DB, url.searchParams);
      }
      // Presence
      else if (path === '/api/warroom/presence' && method === 'POST') {
        res = await setPresence(env.DB, await request.json());
      }
      else if (path === '/api/warroom/presence' && method === 'GET') {
        res = await getPresence(env.DB, url.searchParams);
      }
      // Thread summary
      else if (parts.length === 5 && parts[0]==='api' && parts[1]==='warroom' && parts[2]==='threads' && parts[4]==='summary' && method === 'GET') {
        res = await getThreadSummary(env.DB, parts[3]);
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
  // Alter existing tables — ignore errors if columns already exist
  for (const stmt of ALTER_STATEMENTS) {
    try { await db.prepare(stmt).run(); } catch {}
  }
  schemaApplied = true;
}

// ─── Threads ───

async function listThreads(db, params) {
  const status = params.get('status');
  let query = 'SELECT * FROM threads';
  const args = [];
  if (status) { query += ' WHERE status = ?'; args.push(status); }
  query += ' ORDER BY updated_at DESC';
  const limit = Math.min(parseInt(params.get('limit') || '50'), 100);
  query += ' LIMIT ?';
  args.push(limit);
  const { results } = await db.prepare(query).bind(...args).all();
  const threads = results.map(t => ({
    ...t,
    participants: safeParse(t.participants),
    roles: safeParse(t.roles || '{}')
  }));
  return json({ threads });
}

async function getThread(db, id) {
  const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first();
  if (!thread) return json({ error: 'Thread not found' }, 404);
  thread.participants = safeParse(thread.participants);
  thread.roles = safeParse(thread.roles || '{}');
  const { count } = await db.prepare('SELECT COUNT(*) as count FROM messages WHERE thread_id = ?').bind(id).first();
  thread.message_count = count;
  return json({ thread });
}

async function createThread(db, body, env, ctx) {
  const { title, participants, created_by, workstreams, roles, priority } = body;
  if (!title) return json({ error: 'title is required' }, 400);

  const id = genId();
  const now = new Date().toISOString();
  const parts = JSON.stringify(participants || []);
  const creator = created_by || 'koa';
  const rolesJson = JSON.stringify(roles || {});
  const prio = priority || 'normal';

  await db.prepare(
    'INSERT INTO threads (id, title, status, participants, created_by, created_at, updated_at, roles, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, title, 'active', parts, creator, now, now, rolesJson, prio).run();

  await db.prepare(
    'INSERT INTO messages (thread_id, sender, content, msg_type, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, 'system', `Thread created: ${title}`, 'system', now).run();

  // Create workstreams if provided
  if (workstreams && Array.isArray(workstreams)) {
    for (const ws of workstreams) {
      const wsId = genId();
      await db.prepare(
        'INSERT INTO workstreams (id, thread_id, title, status, assigned_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(wsId, id, ws.title, 'pending', ws.assigned_to || null, now, now).run();
    }
  }

  const thread = { id, title, status: 'active', participants: participants || [], created_by: creator, created_at: now, updated_at: now, roles: roles || {}, priority: prio };
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
  if (body.roles) { updates.push('roles = ?'); args.push(JSON.stringify(body.roles)); }
  if (body.priority) { updates.push('priority = ?'); args.push(body.priority); }
  updates.push('updated_at = ?'); args.push(now);
  args.push(id);

  await db.prepare(`UPDATE threads SET ${updates.join(', ')} WHERE id = ?`).bind(...args).run();

  if (body.status && body.status !== thread.status) {
    await db.prepare(
      'INSERT INTO messages (thread_id, sender, content, msg_type, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, 'system', `Thread ${body.status === 'completed' || body.status === 'done' ? 'completed ✅' : 'status → ' + body.status}`, 'system', now).run();
  }

  return json({ ok: true });
}

// ─── Claims ───

async function createClaim(db, threadId, body) {
  const { agent, workstream } = body;
  if (!agent || !workstream) return json({ error: 'agent and workstream required' }, 400);

  // Check if already claimed by another agent
  const existing = await db.prepare(
    "SELECT * FROM claims WHERE thread_id = ? AND workstream = ? AND status = 'claimed'"
  ).bind(threadId, workstream).first();
  if (existing && existing.agent !== agent) {
    return json({ error: `Already claimed by ${existing.agent}` }, 409);
  }
  if (existing) return json({ claim: existing });

  const id = genId();
  const now = new Date().toISOString();
  await db.prepare(
    'INSERT INTO claims (id, thread_id, workstream, agent, status, claimed_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, threadId, workstream, agent, 'claimed', now).run();

  // Auto-link to workstream if title matches
  const ws = await db.prepare(
    "SELECT id FROM workstreams WHERE thread_id = ? AND LOWER(title) = LOWER(?)"
  ).bind(threadId, workstream).first();
  if (ws) {
    await db.prepare(
      "UPDATE workstreams SET status = 'claimed', assigned_to = ?, updated_at = ? WHERE id = ?"
    ).bind(agent, now, ws.id).run();
  }

  const claim = { id, thread_id: threadId, workstream, agent, status: 'claimed', claimed_at: now };
  return json({ claim }, 201);
}

async function listClaims(db, threadId) {
  const { results } = await db.prepare('SELECT * FROM claims WHERE thread_id = ? ORDER BY claimed_at').bind(threadId).all();
  return json({ claims: results });
}

async function updateClaim(db, threadId, claimId, body) {
  const claim = await db.prepare('SELECT * FROM claims WHERE id = ? AND thread_id = ?').bind(claimId, threadId).first();
  if (!claim) return json({ error: 'Claim not found' }, 404);

  const now = new Date().toISOString();
  const status = body.status;
  if (!['done', 'released'].includes(status)) return json({ error: 'status must be done or released' }, 400);

  await db.prepare('UPDATE claims SET status = ?, completed_at = ? WHERE id = ?').bind(status, now, claimId).run();

  // If done, also update matching workstream
  if (status === 'done') {
    const ws = await db.prepare(
      "SELECT id FROM workstreams WHERE thread_id = ? AND LOWER(title) = LOWER(?)"
    ).bind(threadId, claim.workstream).first();
    if (ws) {
      await db.prepare("UPDATE workstreams SET status = 'done', updated_at = ? WHERE id = ?").bind(now, ws.id).run();
    }
    // Check if all workstreams done → auto-close thread
    await checkAutoClose(db, threadId);
  }

  return json({ ok: true });
}

// ─── Workstreams ───

async function listWorkstreams(db, threadId) {
  const { results } = await db.prepare('SELECT * FROM workstreams WHERE thread_id = ? ORDER BY created_at').bind(threadId).all();
  return json({ workstreams: results });
}

async function updateWorkstream(db, threadId, wsId, body, env, ctx) {
  const ws = await db.prepare('SELECT * FROM workstreams WHERE id = ? AND thread_id = ?').bind(wsId, threadId).first();
  if (!ws) return json({ error: 'Workstream not found' }, 404);

  const now = new Date().toISOString();
  const updates = [];
  const args = [];

  if (body.status) { updates.push('status = ?'); args.push(body.status); }
  if (body.assigned_to !== undefined) { updates.push('assigned_to = ?'); args.push(body.assigned_to); }
  if (body.blocked_by !== undefined) { updates.push('blocked_by = ?'); args.push(body.blocked_by); }
  updates.push('updated_at = ?'); args.push(now);
  args.push(wsId);

  await db.prepare(`UPDATE workstreams SET ${updates.join(', ')} WHERE id = ?`).bind(...args).run();

  // If completed, unblock dependents and notify
  if (body.status === 'done') {
    const { results: blocked } = await db.prepare(
      "SELECT * FROM workstreams WHERE thread_id = ? AND blocked_by = ?"
    ).bind(threadId, wsId).all();
    for (const b of blocked) {
      await db.prepare("UPDATE workstreams SET status = 'pending', blocked_by = NULL, updated_at = ? WHERE id = ?").bind(now, b.id).run();
      // Notify assigned agent if webhook available
      if (b.assigned_to && env.WEBHOOK_URL) {
        const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').bind(threadId).first();
        const notify = fireWebhook(env.WEBHOOK_URL, env.WEBHOOK_SECRET, {
          event: 'unblock',
          message: { sender: 'system', content: `Workstream "${b.title}" is now unblocked (${ws.title} completed)` },
          thread: { id: threadId, title: thread?.title || '', participants: safeParse(thread?.participants || '[]') }
        });
        if (ctx?.waitUntil) ctx.waitUntil(notify);
      }
    }
    await checkAutoClose(db, threadId);
  }

  return json({ ok: true });
}

async function checkAutoClose(db, threadId) {
  const { results: allWs } = await db.prepare('SELECT * FROM workstreams WHERE thread_id = ?').bind(threadId).all();
  if (allWs.length === 0) return;
  const allDone = allWs.every(w => w.status === 'done');
  if (allDone) {
    const now = new Date().toISOString();
    await db.prepare("UPDATE threads SET status = 'done', updated_at = ? WHERE id = ?").bind(now, threadId).run();
    await db.prepare(
      'INSERT INTO messages (thread_id, sender, content, msg_type, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(threadId, 'system', '🎉 All workstreams complete — thread auto-closed', 'system', now).run();
  }
}

// ─── Deliverables ───

async function createDeliverable(db, threadId, body) {
  const { agent, description, file_path, url, workstream_id, status: dStatus } = body;
  if (!description) return json({ error: 'description required' }, 400);

  const id = genId();
  const now = new Date().toISOString();
  await db.prepare(
    'INSERT INTO deliverables (id, thread_id, workstream_id, agent, description, file_path, url, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, threadId, workstream_id || null, agent || null, description, file_path || null, url || null, dStatus || 'draft', now).run();

  return json({ deliverable: { id, thread_id: threadId, description, status: dStatus || 'draft', created_at: now } }, 201);
}

async function listDeliverables(db, threadId) {
  const { results } = await db.prepare('SELECT * FROM deliverables WHERE thread_id = ? ORDER BY created_at').bind(threadId).all();
  return json({ deliverables: results });
}

// ─── Thread Summary ───

async function getThreadSummary(db, threadId) {
  const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').bind(threadId).first();
  if (!thread) return json({ error: 'Thread not found' }, 404);

  const summary = await generateSummary(db, threadId, thread);
  return json({ summary });
}

async function generateSummary(db, threadId, thread) {
  const { results: messages } = await db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY id').bind(threadId).all();
  const { results: claims } = await db.prepare('SELECT * FROM claims WHERE thread_id = ?').bind(threadId).all();
  const { results: workstreams } = await db.prepare('SELECT * FROM workstreams WHERE thread_id = ?').bind(threadId).all();
  const { results: deliverables } = await db.prepare('SELECT * FROM deliverables WHERE thread_id = ?').bind(threadId).all();

  const participants = [...new Set(messages.filter(m => m.sender !== 'system').map(m => m.sender))];
  const decisions = messages.filter(m => m.content.includes('[DECISION]') || m.content.includes('decided') || m.content.includes('agreed')).map(m => m.content);
  const blockers = messages.filter(m => m.content.includes('[BLOCKED]') || m.content.includes('blocked')).map(m => m.content);

  const firstMsg = messages[0];
  const lastMsg = messages[messages.length - 1];
  const duration = firstMsg && lastMsg ? 
    Math.round((new Date(lastMsg.created_at) - new Date(firstMsg.created_at)) / 60000) + ' minutes' : 'unknown';

  return {
    thread_id: threadId,
    title: thread.title,
    status: thread.status,
    priority: thread.priority || 'normal',
    participants,
    decisions: decisions.slice(0, 20),
    deliverables: deliverables.map(d => ({ description: d.description, file_path: d.file_path, url: d.url, status: d.status })),
    workstreams: workstreams.map(w => ({ title: w.title, status: w.status, assigned_to: w.assigned_to })),
    claims: claims.map(c => ({ workstream: c.workstream, agent: c.agent, status: c.status })),
    blockers_hit: blockers.slice(0, 10),
    duration,
    message_count: messages.length
  };
}

// ─── Templates ───

async function createFromTemplate(db, body, env, ctx) {
  const { template, title, participants, role_assignments } = body;
  if (!template || !TEMPLATES[template]) {
    return json({ error: `Unknown template. Available: ${Object.keys(TEMPLATES).join(', ')}` }, 400);
  }
  const tmpl = TEMPLATES[template];
  const threadTitle = title || `${template} thread`;

  // Build roles from template + assignments
  const roles = {};
  if (role_assignments) {
    Object.assign(roles, role_assignments);
  } else if (participants && participants.length > 0) {
    // Auto-assign roles round-robin
    for (let i = 0; i < participants.length && i < tmpl.roles.length; i++) {
      roles[participants[i]] = tmpl.roles[i];
    }
  }

  const workstreams = tmpl.workstreams.map(w => ({ title: w }));

  return createThread(db, {
    title: threadTitle,
    participants: participants || [],
    created_by: 'template',
    workstreams,
    roles,
    priority: 'normal'
  }, env, ctx);
}

// ─── Messages ───

async function postMessage(db, body, env, ctx) {
  const { sender, thread, thread_id, content, type } = body;
  const tid = thread_id || thread;
  if (!sender || !tid || !content) {
    return json({ error: 'sender, thread/thread_id, and content are required' }, 400);
  }

  const thr = await db.prepare('SELECT * FROM threads WHERE id = ?').bind(tid).first();
  if (!thr) return json({ error: 'Thread not found' }, 404);

  const now = new Date().toISOString();
  const msgType = type || 'message';

  const result = await db.prepare(
    'INSERT INTO messages (thread_id, sender, content, msg_type, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(tid, sender, content, msgType, now).run();

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

  await db.prepare('DELETE FROM presence WHERE agent = ? AND thread_id = ?').bind(sender, tid).run();

  if (env.WEBHOOK_URL) {
    const webhook = fireWebhook(env.WEBHOOK_URL, env.WEBHOOK_SECRET, {
      event: 'message',
      message: msg,
      thread: { id: thr.id, title: thr.title, participants: parts, roles: safeParse(thr.roles || '{}'), priority: thr.priority || 'normal' }
    });
    if (ctx?.waitUntil) ctx.waitUntil(webhook);
  }

  return json({ message: msg }, 201);
}

// ─── Presence ───

const PRESENCE_TTL_MS = 30000;

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
  const threadStatus = payload.thread?.status?.toLowerCase();
  if (threadStatus === 'done') return;

  const participants = (payload.thread?.participants || [])
    .map(p => p.toLowerCase())
    .filter(p => p !== sender && p !== 'koa' && AGENT_IDS.includes(p));
  if (participants.length === 0) return;

  const content = (payload.message?.content || '').toLowerCase();
  const mentioned = AGENT_IDS.filter(a => content.includes(`@${a}`) || content.includes(a));
  const notifyList = mentioned.length > 0
    ? participants.filter(p => mentioned.includes(p))
    : participants;

  const threadTitle = payload.thread?.title || 'War Room';
  const threadId = payload.thread?.id;
  const msgContent = payload.message?.content;
  const roles = payload.thread?.roles || {};

  for (const agentId of notifyList) {
    try {
      const agentRole = roles[agentId] ? `\n**Your role: ${roles[agentId].toUpperCase()}**` : '';
      const body = {
        message: `**War Room — ${threadTitle}**\nFrom **${sender}**: ${msgContent}${agentRole}\n\n**MANDATORY RULES:**\n1. Read the FULL thread first: GET https://warroom-api.roguefamilyfarms.workers.dev/api/warroom/threads/${threadId}/messages\n2. Do NOT duplicate work already done or questions already answered\n3. Reference what others said — this is a conversation\n4. If thread has a "✅ DONE:" message or status is "done" → DO NOT RESPOND. Silence is correct.\n5. If you already posted in the last 5 messages and nobody asked you a new question → DO NOT RESPOND.\n6. Do NOT post "acknowledged", "standing by", or "confirmed" unless you're adding new information.\n\nTo respond: POST to https://warroom-api.roguefamilyfarms.workers.dev/api/warroom/messages with {"sender":"${agentId}","thread_id":"${threadId}","content":"your reply"}`,
        agentId,
        name: 'WarRoom',
        wakeMode: 'now',
        deliver: false
      };
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secret}` },
        body: JSON.stringify(body)
      });
    } catch (err) {
      console.error(`Webhook to ${agentId} failed:`, err.message);
    }
  }
}

async function getMessages(db, threadId, params) {
  const since = params.get('since');
  const limit = Math.min(parseInt(params.get('limit') || '100'), 500);
  let query, args;
  if (since) {
    query = 'SELECT * FROM messages WHERE thread_id = ? AND id > ? ORDER BY id ASC LIMIT ?';
    args = [threadId, parseInt(since), limit];
  } else {
    query = 'SELECT * FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT ?';
    args = [threadId, limit];
  }
  const { results } = await db.prepare(query).bind(...args).all();
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
