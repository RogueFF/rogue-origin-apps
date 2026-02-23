/**
 * War Room API — Live Agent Collaboration Feed
 * Cloudflare Worker with KV backend
 * 
 * Endpoints:
 *   GET  /api/war-room/threads              → list all threads
 *   GET  /api/war-room/threads/:id          → get single thread
 *   GET  /api/war-room/threads/:id/messages → messages for thread
 *   POST /api/war-room/threads              → create thread
 *   PUT  /api/war-room/threads/:id          → update thread (status, title)
 *   POST /api/war-room/log                  → agent logs a message
 *   GET  /api/war-room/health               → health check
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return corsResponse(env, new Response(null, { status: 204 }));
    }

    try {
      let response;

      // Health
      if (path === '/api/war-room/health' && method === 'GET') {
        response = json({ status: 'ok', service: 'war-room-api', timestamp: new Date().toISOString() });
      }
      // List threads
      else if (path === '/api/war-room/threads' && method === 'GET') {
        response = await listThreads(env);
      }
      // Create thread
      else if (path === '/api/war-room/threads' && method === 'POST') {
        response = await createThread(env, await request.json());
      }
      // Thread messages
      else if (path.match(/^\/api\/war-room\/threads\/([^/]+)\/messages$/) && method === 'GET') {
        const threadId = path.match(/^\/api\/war-room\/threads\/([^/]+)\/messages$/)[1];
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const after = url.searchParams.get('after') || null;
        response = await getMessages(env, threadId, limit, after);
      }
      // Get single thread
      else if (path.match(/^\/api\/war-room\/threads\/([^/]+)$/) && method === 'GET') {
        const threadId = path.match(/^\/api\/war-room\/threads\/([^/]+)$/)[1];
        response = await getThread(env, threadId);
      }
      // Update thread
      else if (path.match(/^\/api\/war-room\/threads\/([^/]+)$/) && method === 'PUT') {
        const threadId = path.match(/^\/api\/war-room\/threads\/([^/]+)$/)[1];
        response = await updateThread(env, threadId, await request.json());
      }
      // Log message (agent endpoint)
      else if (path === '/api/war-room/log' && method === 'POST') {
        response = await logMessage(env, await request.json());
      }
      // 404
      else {
        response = json({ error: 'Not found' }, 404);
      }

      return corsResponse(env, response);
    } catch (err) {
      return corsResponse(env, json({ error: err.message }, 500));
    }
  }
};

// ─── Thread Operations ───

async function listThreads(env) {
  const index = await env.WAR_ROOM.get('threads:index', 'json') || [];
  const threads = [];

  for (const id of index) {
    const thread = await env.WAR_ROOM.get(`thread:${id}`, 'json');
    if (thread) threads.push(thread);
  }

  // Sort by updatedAt descending
  threads.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return json({ threads });
}

async function getThread(env, threadId) {
  const thread = await env.WAR_ROOM.get(`thread:${threadId}`, 'json');
  if (!thread) return json({ error: 'Thread not found' }, 404);
  return json({ thread });
}

async function createThread(env, body) {
  const { title, agents, createdBy } = body;
  if (!title) return json({ error: 'title is required' }, 400);

  const id = generateId();
  const now = new Date().toISOString();

  const thread = {
    id,
    title,
    agents: agents || [],
    status: 'active',
    createdBy: createdBy || 'koa',
    createdAt: now,
    updatedAt: now,
    messageCount: 0
  };

  // Save thread
  await env.WAR_ROOM.put(`thread:${id}`, JSON.stringify(thread));

  // Update index
  const index = await env.WAR_ROOM.get('threads:index', 'json') || [];
  index.unshift(id);
  await env.WAR_ROOM.put('threads:index', JSON.stringify(index));

  // Initialize message list for thread
  await env.WAR_ROOM.put(`messages:${id}:index`, JSON.stringify([]));

  // Log creation message
  await appendMessage(env, id, {
    from: createdBy || 'koa',
    message: `Started thread: ${title}`,
    type: 'system'
  });

  return json({ thread }, 201);
}

async function updateThread(env, threadId, body) {
  const thread = await env.WAR_ROOM.get(`thread:${threadId}`, 'json');
  if (!thread) return json({ error: 'Thread not found' }, 404);

  if (body.status) thread.status = body.status;
  if (body.title) thread.title = body.title;
  if (body.agents) thread.agents = body.agents;
  thread.updatedAt = new Date().toISOString();

  await env.WAR_ROOM.put(`thread:${threadId}`, JSON.stringify(thread));

  // If completing, log it
  if (body.status === 'completed') {
    await appendMessage(env, threadId, {
      from: body.completedBy || 'system',
      message: body.summary || '✅ Thread completed',
      type: 'completion'
    });
  }

  return json({ thread });
}

// ─── Message Operations ───

async function logMessage(env, body) {
  const { from, threadId, message, to, type } = body;
  if (!from || !threadId || !message) {
    return json({ error: 'from, threadId, and message are required' }, 400);
  }

  // Verify thread exists
  const thread = await env.WAR_ROOM.get(`thread:${threadId}`, 'json');
  if (!thread) return json({ error: 'Thread not found' }, 404);

  const msg = await appendMessage(env, threadId, { from, to, message, type: type || 'message' });

  // Update thread metadata
  thread.updatedAt = msg.timestamp;
  thread.messageCount = (thread.messageCount || 0) + 1;
  if (from && !thread.agents.includes(from) && from !== 'koa' && from !== 'system') {
    thread.agents.push(from);
  }
  await env.WAR_ROOM.put(`thread:${threadId}`, JSON.stringify(thread));

  return json({ message: msg }, 201);
}

async function getMessages(env, threadId, limit = 100, after = null) {
  const index = await env.WAR_ROOM.get(`messages:${threadId}:index`, 'json') || [];

  let msgIds = index;
  if (after) {
    const afterIdx = index.indexOf(after);
    if (afterIdx >= 0) {
      msgIds = index.slice(afterIdx + 1);
    }
  }

  // Limit
  msgIds = msgIds.slice(-limit);

  const messages = [];
  for (const msgId of msgIds) {
    const msg = await env.WAR_ROOM.get(`msg:${msgId}`, 'json');
    if (msg) messages.push(msg);
  }

  return json({ messages, threadId, hasMore: index.length > messages.length });
}

// ─── Helpers ───

async function appendMessage(env, threadId, { from, to, message, type }) {
  const now = new Date().toISOString();
  const msgId = `${threadId}:${Date.now()}:${from}`;

  const msg = {
    id: msgId,
    threadId,
    from,
    to: to || null,
    message,
    type: type || 'message',
    timestamp: now
  };

  await env.WAR_ROOM.put(`msg:${msgId}`, JSON.stringify(msg));

  // Append to thread message index
  const index = await env.WAR_ROOM.get(`messages:${threadId}:index`, 'json') || [];
  index.push(msgId);
  await env.WAR_ROOM.put(`messages:${threadId}:index`, JSON.stringify(index));

  return msg;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function corsResponse(env, response) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',');
  const headers = new Headers(response.headers);
  // Allow all origins in dev, check allowlist conceptually
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Max-Age', '86400');

  return new Response(response.body, {
    status: response.status,
    headers
  });
}
