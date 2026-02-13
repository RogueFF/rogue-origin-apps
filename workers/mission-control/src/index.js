/**
 * Mission Control API — Atlas Squad System
 *
 * Endpoints:
 * GET  /api/health              Health check
 * GET  /api/agents              List all agents
 * GET  /api/agents/:name        Get agent detail
 * PATCH /api/agents/:name       Update agent status/task
 * GET  /api/activity            Activity feed (paginated)
 * POST /api/activity            Post new activity
 * GET  /api/inbox               Koa's inbox (pending items)
 * POST /api/inbox               Create inbox item
 * POST /api/inbox/:id/action    Approve/reject/snooze
 * GET  /api/comms               Recent inter-agent comms
 * POST /api/comms               Post a comm
 * GET  /api/briefs              Briefs list
 * GET  /api/briefs/latest       Most recent brief
 * POST /api/briefs              Create a brief
 */

// ── CORS ────────────────────────────────────────────────────────────

const DEFAULT_ALLOWED_ORIGINS = [
  'https://rogueff.github.io',
  'https://rogueorigin.com',
];

function getAllowedOrigin(origin, env) {
  if (!origin) return '*';
  const envOrigins = env?.ALLOWED_ORIGINS;
  const allowList = envOrigins
    ? envOrigins.split(',').map(o => o.trim())
    : DEFAULT_ALLOWED_ORIGINS;
  if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
    return origin;
  }
  if (allowList.includes(origin)) return origin;
  if (!envOrigins) return origin;
  return '';
}

function corsHeaders(env, request) {
  const origin = request ? request.headers.get('Origin') : null;
  const allowed = getAllowedOrigin(origin, env);
  return {
    'Access-Control-Allow-Origin': allowed || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Max-Age': '86400',
    ...(allowed && allowed !== '*' ? { Vary: 'Origin' } : {}),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
  });
}

function err(message, code = 'INTERNAL_ERROR', status = 500) {
  return json({ success: false, error: message, code }, status);
}

async function parseBody(request) {
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json') || ct.includes('text/plain')) {
    try { return await request.json(); } catch { return {}; }
  }
  return {};
}

// ── Route matching ──────────────────────────────────────────────────

function matchRoute(method, path) {
  const routes = [
    ['GET',  /^\/api\/health$/,                  'health'],
    ['GET',  /^\/api\/agents$/,                  'agentsList'],
    ['GET',  /^\/api\/agents\/([a-z-]+)$/,       'agentsGet'],
    ['PATCH',/^\/api\/agents\/([a-z-]+)$/,       'agentsUpdate'],
    ['GET',  /^\/api\/activity$/,                'activityList'],
    ['POST', /^\/api\/activity$/,                'activityCreate'],
    ['GET',  /^\/api\/inbox$/,                   'inboxList'],
    ['POST', /^\/api\/inbox$/,                   'inboxCreate'],
    ['POST', /^\/api\/inbox\/(\d+)\/action$/,    'inboxAction'],
    ['GET',  /^\/api\/comms$/,                   'commsList'],
    ['POST', /^\/api\/comms$/,                   'commsCreate'],
    ['GET',  /^\/api\/briefs\/latest$/,          'briefsLatest'],
    ['GET',  /^\/api\/briefs$/,                  'briefsList'],
    ['POST', /^\/api\/briefs$/,                  'briefsCreate'],
  ];

  for (const [m, re, handler] of routes) {
    if (method === m) {
      const match = path.match(re);
      if (match) return { handler, params: match.slice(1) };
    }
  }
  return null;
}

// ── Handlers ────────────────────────────────────────────────────────

const handlers = {
  // Health check
  async health() {
    return json({
      success: true,
      service: 'mission-control-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    });
  },

  // GET /api/agents — list all agents
  async agentsList(_req, env) {
    const db = env.DB;
    const results = await db.prepare('SELECT * FROM agents ORDER BY domain, name').all();
    return json({ success: true, data: results.results });
  },

  // GET /api/agents/:name
  async agentsGet(_req, env, params) {
    const db = env.DB;
    const name = params[0];
    const agent = await db.prepare('SELECT * FROM agents WHERE name = ?').bind(name).first();
    if (!agent) return err('Agent not found', 'NOT_FOUND', 404);

    // Include recent activity for this agent
    const activity = await db.prepare(
      'SELECT * FROM activity WHERE agent_name = ? ORDER BY created_at DESC LIMIT 10'
    ).bind(name).all();

    return json({ success: true, data: { ...agent, recent_activity: activity.results } });
  },

  // PATCH /api/agents/:name — update status/current_task
  async agentsUpdate(req, env, params) {
    const db = env.DB;
    const name = params[0];
    const body = await parseBody(req);

    const agent = await db.prepare('SELECT * FROM agents WHERE name = ?').bind(name).first();
    if (!agent) return err('Agent not found', 'NOT_FOUND', 404);

    const allowed = ['status', 'current_task', 'last_active'];
    const sets = [];
    const vals = [];
    for (const key of allowed) {
      if (body[key] !== undefined) {
        sets.push(`${key} = ?`);
        vals.push(body[key]);
      }
    }
    if (sets.length === 0) return err('No valid fields to update', 'VALIDATION_ERROR', 400);

    // Auto-set last_active when status changes to 'active'
    if (body.status === 'active' && !body.last_active) {
      sets.push('last_active = ?');
      vals.push(new Date().toISOString());
    }

    vals.push(name);
    await db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE name = ?`).bind(...vals).run();

    const updated = await db.prepare('SELECT * FROM agents WHERE name = ?').bind(name).first();
    return json({ success: true, data: updated });
  },

  // GET /api/activity — paginated activity feed
  async activityList(req, env) {
    const db = env.DB;
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const domain = url.searchParams.get('domain');
    const agent = url.searchParams.get('agent');
    const type = url.searchParams.get('type');

    let sql = 'SELECT * FROM activity';
    const conditions = [];
    const params = [];

    if (domain) { conditions.push('domain = ?'); params.push(domain); }
    if (agent) { conditions.push('agent_name = ?'); params.push(agent); }
    if (type) { conditions.push('type = ?'); params.push(type); }

    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const results = await db.prepare(sql).bind(...params).all();

    // Get total count for pagination
    let countSql = 'SELECT COUNT(*) as total FROM activity';
    if (conditions.length) {
      countSql += ' WHERE ' + conditions.join(' AND ');
    }
    const countParams = params.slice(0, -2); // remove limit/offset
    const countResult = await db.prepare(countSql).bind(...countParams).first();

    return json({
      success: true,
      data: results.results,
      pagination: { total: countResult.total, limit, offset },
    });
  },

  // POST /api/activity — create activity entry
  async activityCreate(req, env) {
    const db = env.DB;
    const body = await parseBody(req);

    const required = ['agent_name', 'type', 'domain', 'title'];
    for (const field of required) {
      if (!body[field]) return err(`Missing required field: ${field}`, 'VALIDATION_ERROR', 400);
    }

    const result = await db.prepare(
      `INSERT INTO activity (agent_name, type, domain, title, body, priority)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      body.agent_name, body.type, body.domain, body.title,
      body.body || null, body.priority || 'normal'
    ).run();

    return json({
      success: true,
      data: { id: result.meta.last_row_id },
    }, 201);
  },

  // GET /api/inbox — pending inbox items
  async inboxList(req, env) {
    const db = env.DB;
    const url = new URL(req.url);
    const status = url.searchParams.get('status') || 'pending';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

    const results = await db.prepare(
      'SELECT * FROM inbox WHERE status = ? ORDER BY CASE priority WHEN \'urgent\' THEN 0 WHEN \'high\' THEN 1 WHEN \'normal\' THEN 2 ELSE 3 END, created_at DESC LIMIT ?'
    ).bind(status, limit).all();

    return json({ success: true, data: results.results });
  },

  // POST /api/inbox — create inbox item
  async inboxCreate(req, env) {
    const db = env.DB;
    const body = await parseBody(req);

    const required = ['agent_name', 'type', 'domain', 'title'];
    for (const field of required) {
      if (!body[field]) return err(`Missing required field: ${field}`, 'VALIDATION_ERROR', 400);
    }

    const result = await db.prepare(
      `INSERT INTO inbox (agent_name, type, domain, title, body, actions, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      body.agent_name, body.type, body.domain, body.title,
      body.body || null,
      body.actions ? JSON.stringify(body.actions) : null,
      body.priority || 'normal'
    ).run();

    return json({
      success: true,
      data: { id: result.meta.last_row_id },
    }, 201);
  },

  // POST /api/inbox/:id/action — approve/reject/snooze
  async inboxAction(req, env, params) {
    const db = env.DB;
    const id = parseInt(params[0]);
    const body = await parseBody(req);
    const action = body.action; // 'approved' | 'rejected' | 'snoozed'

    if (!['approved', 'rejected', 'snoozed'].includes(action)) {
      return err('Invalid action. Must be: approved, rejected, snoozed', 'VALIDATION_ERROR', 400);
    }

    const item = await db.prepare('SELECT * FROM inbox WHERE id = ?').bind(id).first();
    if (!item) return err('Inbox item not found', 'NOT_FOUND', 404);

    await db.prepare(
      'UPDATE inbox SET status = ?, resolved_at = ? WHERE id = ?'
    ).bind(action, new Date().toISOString(), id).run();

    const updated = await db.prepare('SELECT * FROM inbox WHERE id = ?').bind(id).first();
    return json({ success: true, data: updated });
  },

  // GET /api/comms — recent comms
  async commsList(req, env) {
    const db = env.DB;
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const channel = url.searchParams.get('channel');
    const agent = url.searchParams.get('agent');

    let sql = 'SELECT * FROM comms';
    const conditions = [];
    const params = [];

    if (channel) { conditions.push('channel = ?'); params.push(channel); }
    if (agent) { conditions.push('(from_agent = ? OR to_agent = ?)'); params.push(agent, agent); }

    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const results = await db.prepare(sql).bind(...params).all();
    return json({ success: true, data: results.results });
  },

  // POST /api/comms — post a comm
  async commsCreate(req, env) {
    const db = env.DB;
    const body = await parseBody(req);

    const required = ['from_agent', 'channel', 'subject', 'body'];
    for (const field of required) {
      if (!body[field]) return err(`Missing required field: ${field}`, 'VALIDATION_ERROR', 400);
    }

    const validChannels = ['board', 'direct', 'broadcast', 'standup'];
    if (!validChannels.includes(body.channel)) {
      return err(`Invalid channel. Must be: ${validChannels.join(', ')}`, 'VALIDATION_ERROR', 400);
    }

    if (body.channel === 'direct' && !body.to_agent) {
      return err('Direct messages require a to_agent', 'VALIDATION_ERROR', 400);
    }

    const result = await db.prepare(
      `INSERT INTO comms (from_agent, to_agent, channel, subject, body)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(
      body.from_agent, body.to_agent || null, body.channel, body.subject, body.body
    ).run();

    return json({
      success: true,
      data: { id: result.meta.last_row_id },
    }, 201);
  },

  // GET /api/briefs — list briefs
  async briefsList(req, env) {
    const db = env.DB;
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
    const type = url.searchParams.get('type');
    const domain = url.searchParams.get('domain');

    let sql = 'SELECT * FROM briefs';
    const conditions = [];
    const params = [];

    if (type) { conditions.push('type = ?'); params.push(type); }
    if (domain) { conditions.push('domain = ?'); params.push(domain); }

    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const results = await db.prepare(sql).bind(...params).all();
    return json({ success: true, data: results.results });
  },

  // GET /api/briefs/latest — most recent brief
  async briefsLatest(req, env) {
    const db = env.DB;
    const url = new URL(req.url);
    const type = url.searchParams.get('type');

    let sql = 'SELECT * FROM briefs';
    const params = [];
    if (type) { sql += ' WHERE type = ?'; params.push(type); }
    sql += ' ORDER BY created_at DESC LIMIT 1';

    const brief = await db.prepare(sql).bind(...params).first();
    if (!brief) return err('No briefs found', 'NOT_FOUND', 404);

    return json({ success: true, data: brief });
  },

  // POST /api/briefs — create a brief
  async briefsCreate(req, env) {
    const db = env.DB;
    const body = await parseBody(req);

    const required = ['type', 'domain', 'title', 'body'];
    for (const field of required) {
      if (!body[field]) return err(`Missing required field: ${field}`, 'VALIDATION_ERROR', 400);
    }

    const result = await db.prepare(
      `INSERT INTO briefs (type, domain, title, body, audio_url, action_items)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      body.type, body.domain, body.title, body.body,
      body.audio_url || null,
      body.action_items ? JSON.stringify(body.action_items) : null
    ).run();

    return json({
      success: true,
      data: { id: result.meta.last_row_id },
    }, 201);
  },
};

// ── Worker entry ────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    try {
      // Route matching
      const route = matchRoute(request.method, path);

      let response;
      if (route) {
        response = await handlers[route.handler](request, env, route.params);
      } else if (path === '/' || path === '/api') {
        response = await handlers.health();
      } else {
        response = err('Not found', 'NOT_FOUND', 404);
      }

      // Attach CORS headers
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(corsHeaders(env, request))) {
        headers.set(k, v);
      }
      return new Response(response.body, { status: response.status, headers });

    } catch (error) {
      console.error('Unhandled error:', error);
      const response = err(error.message || 'Internal server error', 'INTERNAL_ERROR', 500);
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(corsHeaders(env, request))) {
        headers.set(k, v);
      }
      return new Response(response.body, { status: response.status, headers });
    }
  },
};
