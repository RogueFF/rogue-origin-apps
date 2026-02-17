/**
 * Mission Control API — Atlas Squad System
 *
 * Endpoints (30):
 * GET  /api/health                       Health check
 * GET  /api/agents                       List all agents
 * GET  /api/agents/:name                 Get agent detail
 * PATCH /api/agents/:name                Update agent status/task
 * GET  /api/agents/:name/files           List agent files
 * GET  /api/agents/:name/files/:filename Get agent file content
 * PUT  /api/agents/:name/files/:filename Create/update agent file
 * GET  /api/activity                     Activity feed (paginated)
 * POST /api/activity                     Post new activity
 * GET  /api/inbox                        Koa's inbox (pending items)
 * POST /api/inbox                        Create inbox item
 * POST /api/inbox/:id/action             Approve/reject/snooze
 * GET  /api/comms                        Recent inter-agent comms
 * POST /api/comms                        Post a comm
 * GET  /api/briefs                       Briefs list
 * GET  /api/briefs/latest                Most recent brief
 * POST /api/briefs                       Create a brief
 * GET  /api/positions                    List positions (filter: status=open|closed)
 * POST /api/positions                    Open a new position
 * PATCH /api/positions/:id               Update/close a position
 * GET  /api/portfolio                    Portfolio summary (P&L, win rate, exposure, bankroll)
 * GET  /api/regime                       Get current market regime signal
 * POST /api/regime                       Update regime signal
 * GET  /api/plays                        Get today's trade setups
 * POST /api/plays                        Create a trade setup/play
 * GET  /api/tasks                        List tasks (filter: status, agent, domain, priority)
 * POST /api/tasks                        Create task
 * PATCH /api/tasks/:id                   Update task (status, assignment, priority)
 * DELETE /api/tasks/:id                  Remove task
 * GET  /api/tasks/stats                  Task counts by status, agent, domain
 * GET  /api/github?action=dashboard       GitHub repo dashboard (commits, CI, issues, PRs, branches)
 */

import { handleGitHub } from './github.js';
import { dispatch } from './webhook.js';

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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
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
    ['GET',  /^\/api\/agents\/roster$/,          'agentsRoster'],
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
    ['GET',  /^\/api\/positions$/,                'positionsList'],
    ['POST', /^\/api\/positions$/,                'positionsCreate'],
    ['PATCH',/^\/api\/positions\/(\d+)$/,         'positionsUpdate'],
    ['GET',  /^\/api\/portfolio$/,                'portfolio'],
    ['GET',  /^\/api\/tasks\/stats$/,               'tasksStats'],
    ['POST', /^\/api\/tasks\/sync$/,                'tasksSync'],
    ['POST', /^\/api\/tasks\/push-all$/,            'tasksPushAll'],
    ['GET',  /^\/api\/tasks\/(\d+)\/comments$/,     'taskCommentsList'],
    ['POST', /^\/api\/tasks\/(\d+)\/comments$/,     'taskCommentsCreate'],
    ['DELETE',/^\/api\/tasks\/(\d+)\/comments\/(\d+)$/, 'taskCommentsDelete'],
    ['GET',  /^\/api\/tasks\/(\d+)\/deliverables$/, 'taskDeliverablesList'],
    ['POST', /^\/api\/tasks\/(\d+)\/deliverables$/, 'taskDeliverablesCreate'],
    ['DELETE',/^\/api\/tasks\/(\d+)\/deliverables\/(\d+)$/, 'taskDeliverablesDelete'],
    ['POST', /^\/api\/tasks\/(\d+)\/push$/,         'taskPushClickUp'],
    ['GET',  /^\/api\/tasks$/,                      'tasksList'],
    ['POST', /^\/api\/tasks$/,                      'tasksCreate'],
    ['PATCH',/^\/api\/tasks\/(\d+)$/,               'tasksUpdate'],
    ['DELETE',/^\/api\/tasks\/(\d+)$/,              'tasksDelete'],
    ['GET',  /^\/api\/regime$/,                       'regimeGet'],
    ['GET',  /^\/api\/regime\/history$/,             'regimeHistory'],
    ['POST', /^\/api\/regime$/,                      'regimeUpdate'],
    ['GET',  /^\/api\/plays$/,                       'playsGet'],
    ['POST', /^\/api\/plays$/,                       'playsCreate'],
    ['GET',  /^\/api\/widgets$/,                     'widgetsGet'],
    ['POST', /^\/api\/widgets$/,                     'widgetsUpdate'],
    ['GET',  /^\/api\/agents\/([a-z-]+)\/files$/,   'agentFilesList'],
    ['GET',  /^\/api\/agents\/([a-z-]+)\/files\/(.+)$/, 'agentFileGet'],
    ['PUT',  /^\/api\/agents\/([a-z-]+)\/files\/(.+)$/, 'agentFilePut'],
    ['GET',  /^\/api\/github$/,                  'github'],
    ['GET',  /^\/api\/prices$/,                  'pricesGet'],
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

    const allowed = ['status', 'current_task', 'last_active', 'model_tier'];
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
  async inboxCreate(req, env, _params, ctx) {
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

    // Webhook: notify atlas-notifications for urgent/high priority items
    const prio = (body.priority || 'normal').toLowerCase();
    if (ctx && (prio === 'urgent' || prio === 'high')) {
      ctx.waitUntil(dispatch(env, 'alert', body));
    }

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
  async briefsCreate(req, env, _params, ctx) {
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

    // Webhook: notify atlas-notifications of new brief
    if (ctx) ctx.waitUntil(dispatch(env, 'briefing', body));

    return json({
      success: true,
      data: { id: result.meta.last_row_id },
    }, 201);
  },

  // GET /api/positions — list positions (filter by status)
  async positionsList(req, env) {
    const db = env.DB;
    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const ticker = url.searchParams.get('ticker');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);

    let sql = 'SELECT * FROM positions';
    const conditions = [];
    const params = [];

    if (status) { conditions.push('status = ?'); params.push(status); }
    if (ticker) { conditions.push('ticker = ?'); params.push(ticker.toUpperCase()); }

    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY entry_date DESC LIMIT ?';
    params.push(limit);

    const results = await db.prepare(sql).bind(...params).all();
    return json({ success: true, data: results.results });
  },

  // POST /api/positions — open a new position
  async positionsCreate(req, env) {
    const db = env.DB;
    const body = await parseBody(req);

    const required = ['ticker', 'direction', 'vehicle', 'entry_price', 'quantity', 'entry_date'];
    for (const field of required) {
      if (body[field] === undefined || body[field] === null || body[field] === '') {
        return err(`Missing required field: ${field}`, 'VALIDATION_ERROR', 400);
      }
    }

    const validDirections = ['long', 'short'];
    if (!validDirections.includes(body.direction)) {
      return err('Invalid direction. Must be: long, short', 'VALIDATION_ERROR', 400);
    }

    const validVehicles = ['calls', 'puts', 'shares', 'spread', 'crypto'];
    if (!validVehicles.includes(body.vehicle)) {
      return err(`Invalid vehicle. Must be: ${validVehicles.join(', ')}`, 'VALIDATION_ERROR', 400);
    }

    const result = await db.prepare(
      `INSERT INTO positions (ticker, direction, vehicle, strike, expiry, entry_price, quantity, entry_date, status, notes, target_price, stop_loss, current_price, current_pnl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`
    ).bind(
      body.ticker.toUpperCase(),
      body.direction,
      body.vehicle,
      body.strike || null,
      body.expiry || null,
      body.entry_price,
      body.quantity,
      body.entry_date,
      body.notes || null,
      body.target_price || 0,
      body.stop_loss || 0,
      body.current_price || null,
      body.current_pnl || 0
    ).run();

    const position = await db.prepare('SELECT * FROM positions WHERE id = ?')
      .bind(result.meta.last_row_id).first();

    return json({ success: true, data: position }, 201);
  },

  // PATCH /api/positions/:id — update or close a position
  async positionsUpdate(req, env, params) {
    const db = env.DB;
    const id = parseInt(params[0]);
    const body = await parseBody(req);

    const position = await db.prepare('SELECT * FROM positions WHERE id = ?').bind(id).first();
    if (!position) return err('Position not found', 'NOT_FOUND', 404);

    const allowed = ['exit_price', 'exit_date', 'status', 'pnl', 'notes', 'target_price', 'stop_loss', 'current_price', 'current_pnl'];
    const sets = [];
    const vals = [];
    for (const key of allowed) {
      if (body[key] !== undefined) {
        sets.push(`${key} = ?`);
        vals.push(body[key]);
      }
    }

    // Auto-calculate P&L when closing with an exit_price
    if (body.status === 'closed' && body.exit_price !== undefined && body.pnl === undefined) {
      const multiplier = position.vehicle === 'shares' ? 1 : 100; // options = 100x
      const direction = position.direction === 'long' ? 1 : -1;
      const calculatedPnl = direction * (body.exit_price - position.entry_price) * position.quantity * multiplier;
      sets.push('pnl = ?');
      vals.push(Math.round(calculatedPnl * 100) / 100);
    }

    // Auto-set exit_date when closing without one
    if (body.status === 'closed' && !body.exit_date && !position.exit_date) {
      sets.push('exit_date = ?');
      vals.push(new Date().toISOString());
    }

    if (sets.length === 0) return err('No valid fields to update', 'VALIDATION_ERROR', 400);

    vals.push(id);
    await db.prepare(`UPDATE positions SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();

    const updated = await db.prepare('SELECT * FROM positions WHERE id = ?').bind(id).first();
    return json({ success: true, data: updated });
  },

  // GET /api/portfolio — portfolio summary
  async portfolio(_req, env) {
    const db = env.DB;
    const STARTING_BANKROLL = 10000;

    // Get all positions
    const open = await db.prepare(
      'SELECT * FROM positions WHERE status = ? ORDER BY entry_date DESC'
    ).bind('open').all();
    const closed = await db.prepare(
      'SELECT * FROM positions WHERE status = ? ORDER BY exit_date DESC'
    ).bind('closed').all();

    const openPositions = open.results;
    const closedTrades = closed.results;

    // Calculate realized P&L from closed trades
    const realizedPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

    // Win/loss stats
    const wins = closedTrades.filter(t => (t.pnl || 0) > 0);
    const losses = closedTrades.filter(t => (t.pnl || 0) < 0);
    const totalClosed = closedTrades.length;
    const winRate = totalClosed > 0 ? Math.round((wins.length / totalClosed) * 10000) / 100 : 0;
    const avgWinner = wins.length > 0
      ? Math.round(wins.reduce((s, t) => s + t.pnl, 0) / wins.length * 100) / 100
      : 0;
    const avgLoser = losses.length > 0
      ? Math.round(losses.reduce((s, t) => s + t.pnl, 0) / losses.length * 100) / 100
      : 0;

    // Open exposure (sum of entry_price * quantity * multiplier)
    const openExposure = openPositions.reduce((sum, p) => {
      const multiplier = p.vehicle === 'shares' ? 1 : 100;
      return sum + (p.entry_price * p.quantity * multiplier);
    }, 0);

    // Unrealized P&L from open positions
    const unrealizedPnl = openPositions.reduce((sum, p) => sum + (p.current_pnl || 0), 0);

    // Portfolio value & bankroll
    const portfolioValue = Math.round((STARTING_BANKROLL + realizedPnl + unrealizedPnl) * 100) / 100;
    const availableBankroll = Math.round((portfolioValue - openExposure) * 100) / 100;

    // Bankroll rule checks
    const maxSinglePosition = Math.round(portfolioValue * 0.20 * 100) / 100;
    const maxExposure = Math.round(portfolioValue * 0.80 * 100) / 100;
    const cashMinimum = Math.round(portfolioValue * 0.20 * 100) / 100;
    const exposureCompliant = openExposure <= maxExposure;
    const cashCompliant = availableBankroll >= cashMinimum;

    return json({
      success: true,
      data: {
        starting_bankroll: STARTING_BANKROLL,
        portfolio_value: portfolioValue,
        realized_pnl: Math.round(realizedPnl * 100) / 100,
        unrealized_pnl: Math.round(unrealizedPnl * 100) / 100,
        open_exposure: Math.round(openExposure * 100) / 100,
        available_bankroll: availableBankroll,
        open_positions: openPositions.length,
        closed_trades: totalClosed,
        win_rate: winRate,
        wins: wins.length,
        losses: losses.length,
        avg_winner: avgWinner,
        avg_loser: avgLoser,
        expectancy: totalClosed > 0
          ? Math.round(((winRate / 100 * avgWinner) + ((1 - winRate / 100) * avgLoser)) * 100) / 100
          : 0,
        rules: {
          max_single_position: maxSinglePosition,
          max_exposure: maxExposure,
          cash_minimum: cashMinimum,
          exposure_compliant: exposureCompliant,
          cash_compliant: cashCompliant,
        },
        positions: openPositions,
      },
    });
  },

  // GET /api/regime — current market regime signal
  async regimeGet(_req, env) {
    const db = env.DB;
    const row = await db.prepare(
      `SELECT * FROM regime_signals ORDER BY created_at DESC LIMIT 1`
    ).first();
    if (!row) return json({ success: true, data: null });
    try { row.data = JSON.parse(row.data || '{}'); } catch { row.data = {}; }
    try { row.scores = JSON.parse(row.scores || '{}'); } catch { row.scores = {}; }
    try { row.reasoning = JSON.parse(row.reasoning || '[]'); } catch { row.reasoning = []; }
    try { row.strategy = JSON.parse(row.strategy || '{}'); } catch { row.strategy = {}; }
    return json({ success: true, data: row });
  },

  // POST /api/regime — update regime signal
  async regimeUpdate(req, env, _params, ctx) {
    const db = env.DB;
    const body = await parseBody(req);
    if (!body.signal) return err('Missing required field: signal', 'VALIDATION_ERROR', 400);
    await db.prepare(
      `INSERT INTO regime_signals (signal, label, data, scores, reasoning, strategy, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      body.signal,
      body.label || '',
      JSON.stringify(body.data || {}),
      JSON.stringify(body.scores || {}),
      JSON.stringify(body.reasoning || []),
      JSON.stringify(body.strategy || {})
    ).run();

    // Webhook: notify atlas-notifications of regime change
    if (ctx) ctx.waitUntil(dispatch(env, 'regime', body));

    return json({ success: true, data: { signal: body.signal } }, 201);
  },

  // GET /api/regime/history — last 30 days of regime signals (one per day)
  async regimeHistory(_req, env) {
    const db = env.DB;
    const rows = await db.prepare(
      `SELECT signal, label, DATE(created_at) as date, created_at
       FROM regime_signals
       WHERE created_at >= datetime('now', '-30 days')
       ORDER BY created_at DESC`
    ).all();
    // Deduplicate to one per day (latest)
    const byDate = {};
    for (const r of (rows.results || [])) {
      if (!byDate[r.date]) byDate[r.date] = r;
    }
    const history = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    return json({ success: true, data: history });
  },

  // GET /api/widgets — get cached widget data
  async widgetsGet(_req, env) {
    const db = env.DB;
    const rows = await db.prepare(
      `SELECT key, value FROM widgets ORDER BY key`
    ).all();
    const widgets = {};
    for (const r of (rows.results || [])) {
      try { widgets[r.key] = JSON.parse(r.value); } catch { widgets[r.key] = r.value; }
    }
    return json({ success: true, data: widgets });
  },

  // POST /api/widgets — update widget data (key-value)
  async widgetsUpdate(req, env) {
    const db = env.DB;
    const body = await parseBody(req);
    if (!body.key || body.value === undefined) return err('Missing key or value', 'VALIDATION_ERROR', 400);
    const key = body.key;
    const value = typeof body.value === 'string' ? body.value : JSON.stringify(body.value);
    await db.prepare(
      `INSERT OR REPLACE INTO widgets (key, value, updated_at) VALUES (?, ?, datetime('now'))`
    ).bind(key, value).run();
    return json({ success: true, data: { key: body.key } }, 201);
  },

  // GET /api/plays — today's trade setups
  async playsGet(_req, env) {
    const db = env.DB;
    const rows = await db.prepare(
      `SELECT * FROM trade_plays WHERE created_at >= datetime('now', '-24 hours') ORDER BY created_at DESC`
    ).all();
    const plays = (rows.results || []).map(r => {
      try { r.setup = JSON.parse(r.setup || '{}'); } catch { r.setup = {}; }
      return r;
    });
    return json({ success: true, data: plays });
  },

  // POST /api/plays — create a trade setup/play
  async playsCreate(req, env, _params, ctx) {
    const db = env.DB;
    const body = await parseBody(req);
    if (!body.ticker) return err('Missing required field: ticker', 'VALIDATION_ERROR', 400);
    await db.prepare(
      `INSERT INTO trade_plays (ticker, direction, vehicle, thesis, setup, risk_level, source_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      body.ticker,
      body.direction || 'long',
      body.vehicle || 'shares',
      body.thesis || '',
      JSON.stringify(body.setup || {}),
      body.risk_level || 'normal',
      body.source_agent || 'strategist'
    ).run();

    // Webhook: notify atlas-notifications of new play
    if (ctx) ctx.waitUntil(dispatch(env, 'play', body));

    return json({ success: true, data: { ticker: body.ticker } }, 201);
  },

  // GET /api/agents/:name/files — list all files for an agent
  async agentFilesList(_req, env, params) {
    const db = env.DB;
    const name = params[0];
    const results = await db.prepare(
      'SELECT agent_name, file_name, updated_at FROM agent_files WHERE agent_name = ? ORDER BY file_name'
    ).bind(name).all();
    return json({ success: true, data: results.results });
  },

  // GET /api/agents/:name/files/:filename — get file content
  async agentFileGet(_req, env, params) {
    const db = env.DB;
    const name = params[0];
    const fileName = decodeURIComponent(params[1]);
    const file = await db.prepare(
      'SELECT * FROM agent_files WHERE agent_name = ? AND file_name = ?'
    ).bind(name, fileName).first();
    if (!file) return err('File not found', 'NOT_FOUND', 404);
    return json({ success: true, data: file });
  },

  // ── Tasks (Dispatch) ───────────────────────────────────────────────

  // GET /api/tasks — list tasks with filters
  async tasksList(req, env) {
    const db = env.DB;
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const status = url.searchParams.get('status');
    const agent = url.searchParams.get('agent');
    const domain = url.searchParams.get('domain');
    const priority = url.searchParams.get('priority');
    const parent_id = url.searchParams.get('parent_id');

    let sql = 'SELECT * FROM tasks';
    const conditions = [];
    const params = [];

    if (status) { conditions.push('status = ?'); params.push(status); }
    if (agent) { conditions.push('assigned_agent = ?'); params.push(agent); }
    if (domain) { conditions.push('domain = ?'); params.push(domain); }
    if (priority) { conditions.push('priority = ?'); params.push(priority); }
    if (parent_id) { conditions.push('parent_id = ?'); params.push(parseInt(parent_id)); }

    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY CASE priority WHEN \'critical\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END, created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const results = await db.prepare(sql).bind(...params).all();

    let countSql = 'SELECT COUNT(*) as total FROM tasks';
    if (conditions.length) countSql += ' WHERE ' + conditions.join(' AND ');
    const countParams = params.slice(0, -2);
    const countResult = countParams.length > 0
      ? await db.prepare(countSql).bind(...countParams).first()
      : await db.prepare(countSql).first();

    return json({
      success: true,
      data: results.results,
      pagination: { total: countResult.total, limit, offset },
    });
  },

  // POST /api/tasks — create task
  async tasksCreate(req, env) {
    const db = env.DB;
    const body = await parseBody(req);

    if (!body.title) return err('Missing required field: title', 'VALIDATION_ERROR', 400);

    const validStatuses = ['backlog', 'active', 'review', 'done', 'blocked'];
    const validPriorities = ['critical', 'high', 'medium', 'low'];

    if (body.status && !validStatuses.includes(body.status)) {
      return err(`Invalid status. Must be: ${validStatuses.join(', ')}`, 'VALIDATION_ERROR', 400);
    }
    if (body.priority && !validPriorities.includes(body.priority)) {
      return err(`Invalid priority. Must be: ${validPriorities.join(', ')}`, 'VALIDATION_ERROR', 400);
    }

    const now = new Date().toISOString();
    const result = await db.prepare(
      `INSERT INTO tasks (title, description, status, priority, assigned_agent, domain, created_at, updated_at, parent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      body.title,
      body.description || null,
      body.status || 'backlog',
      body.priority || 'medium',
      body.assigned_agent || null,
      body.domain || null,
      now,
      now,
      body.parent_id || null
    ).run();

    const task = await db.prepare('SELECT * FROM tasks WHERE id = ?')
      .bind(result.meta.last_row_id).first();
    return json({ success: true, data: task }, 201);
  },

  // PATCH /api/tasks/:id — update task
  async tasksUpdate(req, env, params) {
    const db = env.DB;
    const id = parseInt(params[0]);
    const body = await parseBody(req);

    const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
    if (!task) return err('Task not found', 'NOT_FOUND', 404);

    const validStatuses = ['backlog', 'active', 'review', 'done', 'blocked'];
    const validPriorities = ['critical', 'high', 'medium', 'low'];

    if (body.status && !validStatuses.includes(body.status)) {
      return err(`Invalid status. Must be: ${validStatuses.join(', ')}`, 'VALIDATION_ERROR', 400);
    }
    if (body.priority && !validPriorities.includes(body.priority)) {
      return err(`Invalid priority. Must be: ${validPriorities.join(', ')}`, 'VALIDATION_ERROR', 400);
    }

    const allowed = ['title', 'description', 'status', 'priority', 'assigned_agent', 'domain', 'parent_id', 'session_url'];
    const sets = [];
    const vals = [];
    for (const key of allowed) {
      if (body[key] !== undefined) {
        sets.push(`${key} = ?`);
        vals.push(body[key]);
      }
    }

    // Always update updated_at
    sets.push('updated_at = ?');
    vals.push(new Date().toISOString());

    // Auto-set completed_at when status changes to 'done'
    if (body.status === 'done' && !task.completed_at) {
      sets.push('completed_at = ?');
      vals.push(new Date().toISOString());
    }
    // Clear completed_at if task is moved back from done
    if (body.status && body.status !== 'done' && task.completed_at) {
      sets.push('completed_at = ?');
      vals.push(null);
    }

    if (sets.length <= 1) return err('No valid fields to update', 'VALIDATION_ERROR', 400);

    vals.push(id);
    await db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();

    const updated = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
    return json({ success: true, data: updated });
  },

  // DELETE /api/tasks/:id — remove task
  async tasksDelete(_req, env, params) {
    const db = env.DB;
    const id = parseInt(params[0]);

    const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
    if (!task) return err('Task not found', 'NOT_FOUND', 404);

    await db.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
    return json({ success: true, data: { id, deleted: true } });
  },

  // GET /api/tasks/stats — task counts by status, agent, domain
  async tasksStats(_req, env) {
    const db = env.DB;

    const byStatus = await db.prepare(
      'SELECT status, COUNT(*) as count FROM tasks GROUP BY status'
    ).all();
    const byAgent = await db.prepare(
      'SELECT assigned_agent, COUNT(*) as count FROM tasks WHERE assigned_agent IS NOT NULL GROUP BY assigned_agent'
    ).all();
    const byDomain = await db.prepare(
      'SELECT domain, COUNT(*) as count FROM tasks WHERE domain IS NOT NULL GROUP BY domain'
    ).all();
    const total = await db.prepare('SELECT COUNT(*) as total FROM tasks').first();

    return json({
      success: true,
      data: {
        total: total.total,
        by_status: Object.fromEntries(byStatus.results.map(r => [r.status, r.count])),
        by_agent: Object.fromEntries(byAgent.results.map(r => [r.assigned_agent, r.count])),
        by_domain: Object.fromEntries(byDomain.results.map(r => [r.domain, r.count])),
      },
    });
  },

  // POST /api/tasks/sync — sync tasks from ClickUp
  async tasksSync(_req, env) {
    const db = env.DB;
    const token = env.CLICKUP_API_TOKEN;
    if (!token) return err('CLICKUP_API_TOKEN not configured', 'CONFIG_ERROR', 500);

    const LISTS = [
      { id: '901710736658', domain: 'work' },
      { id: '901710736659', domain: 'work' },
      { id: '901710736660', domain: 'system' },
      { id: '901710736661', domain: 'work' },
    ];

    const STATUS_MAP = { 'to do': 'backlog', 'in progress': 'active', 'review': 'review', 'complete': 'done', 'closed': 'done' };
    const PRIORITY_MAP = { 1: 'critical', 2: 'high', 3: 'medium', 4: 'low' };

    let created = 0, updated = 0, unchanged = 0;

    for (const list of LISTS) {
      let page = 0;
      let hasMore = true;
      while (hasMore) {
        const resp = await fetch(
          `https://api.clickup.com/api/v2/list/${list.id}/task?include_closed=true&page=${page}&subtasks=true`,
          { headers: { Authorization: token } }
        );
        if (!resp.ok) { hasMore = false; break; }
        const data = await resp.json();
        const tasks = data.tasks || [];
        if (tasks.length === 0 || data.last_page) hasMore = false;

        for (const t of tasks) {
          const clickupId = t.id;
          const title = t.name;
          const description = t.description || null;
          const statusRaw = (t.status?.status || 'to do').toLowerCase();
          const status = STATUS_MAP[statusRaw] || 'backlog';
          const priority = PRIORITY_MAP[t.priority?.id] || 'medium';
          const domain = list.domain;
          const assignee = t.assignees?.[0]?.username || null;
          const createdAt = t.date_created ? new Date(parseInt(t.date_created)).toISOString() : new Date().toISOString();
          const updatedAt = t.date_updated ? new Date(parseInt(t.date_updated)).toISOString() : createdAt;
          const completedAt = status === 'done' ? (t.date_done ? new Date(parseInt(t.date_done)).toISOString() : updatedAt) : null;

          const existing = await db.prepare('SELECT id, title, status, priority FROM tasks WHERE clickup_id = ?').bind(clickupId).first();

          if (existing) {
            // Only override local status if ClickUp says "done" (closed task).
            // If ClickUp says "to do" but local is active/review/blocked, keep local status.
            const localAdvanced = ['active', 'review', 'blocked'].includes(existing.status);
            const effectiveStatus = (status === 'backlog' && localAdvanced) ? existing.status : status;
            const effectiveCompleted = effectiveStatus === 'done' ? (completedAt || updatedAt) : null;

            if (existing.title !== title || existing.status !== effectiveStatus || existing.priority !== priority) {
              await db.prepare(
                'UPDATE tasks SET title=?, description=?, status=?, priority=?, assigned_agent=?, domain=?, updated_at=?, completed_at=? WHERE clickup_id=?'
              ).bind(title, description, effectiveStatus, priority, assignee, domain, updatedAt, effectiveCompleted, clickupId).run();
              updated++;
            } else {
              unchanged++;
            }
          } else {
            await db.prepare(
              'INSERT INTO tasks (title, description, status, priority, assigned_agent, domain, created_at, updated_at, completed_at, clickup_id) VALUES (?,?,?,?,?,?,?,?,?,?)'
            ).bind(title, description, status, priority, assignee, domain, createdAt, updatedAt, completedAt, clickupId).run();
            created++;
          }
        }
        page++;
      }
    }

    return json({ success: true, data: { created, updated, unchanged, total: created + updated + unchanged } });
  },

  // ── Comments ──────────────────────────────────────────

  async taskCommentsList(_req, env, params) {
    const db = env.DB;
    const taskId = parseInt(params[0]);
    const results = await db.prepare('SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC').bind(taskId).all();
    return json({ success: true, data: results.results });
  },

  async taskCommentsCreate(req, env, params) {
    const db = env.DB;
    const taskId = parseInt(params[0]);
    const body = await parseBody(req);
    if (!body.body) return err('Missing required field: body', 'VALIDATION_ERROR', 400);
    const now = new Date().toISOString();
    const result = await db.prepare(
      'INSERT INTO task_comments (task_id, author, body, comment_type, created_at) VALUES (?,?,?,?,?)'
    ).bind(taskId, body.author || 'atlas', body.body, body.comment_type || 'comment', now).run();
    const comment = await db.prepare('SELECT * FROM task_comments WHERE id = ?').bind(result.meta.last_row_id).first();
    return json({ success: true, data: comment }, 201);
  },

  async taskCommentsDelete(_req, env, params) {
    const db = env.DB;
    const taskId = parseInt(params[0]);
    const commentId = parseInt(params[1]);
    const c = await db.prepare('SELECT * FROM task_comments WHERE id = ? AND task_id = ?').bind(commentId, taskId).first();
    if (!c) return err('Comment not found', 'NOT_FOUND', 404);
    await db.prepare('DELETE FROM task_comments WHERE id = ?').bind(commentId).run();
    return json({ success: true, data: { id: commentId, deleted: true } });
  },

  // ── Deliverables ──────────────────────────────────────

  async taskDeliverablesList(_req, env, params) {
    const db = env.DB;
    const taskId = parseInt(params[0]);
    const results = await db.prepare('SELECT * FROM task_deliverables WHERE task_id = ? ORDER BY created_at DESC').bind(taskId).all();
    return json({ success: true, data: results.results });
  },

  async taskDeliverablesCreate(req, env, params) {
    const db = env.DB;
    const taskId = parseInt(params[0]);
    const body = await parseBody(req);
    if (!body.title) return err('Missing required field: title', 'VALIDATION_ERROR', 400);
    const now = new Date().toISOString();
    const result = await db.prepare(
      'INSERT INTO task_deliverables (task_id, title, url, content, deliverable_type, author, created_at) VALUES (?,?,?,?,?,?,?)'
    ).bind(taskId, body.title, body.url || null, body.content || null, body.deliverable_type || 'link', body.author || 'atlas', now).run();
    const d = await db.prepare('SELECT * FROM task_deliverables WHERE id = ?').bind(result.meta.last_row_id).first();
    return json({ success: true, data: d }, 201);
  },

  async taskDeliverablesDelete(_req, env, params) {
    const db = env.DB;
    const taskId = parseInt(params[0]);
    const delId = parseInt(params[1]);
    const d = await db.prepare('SELECT * FROM task_deliverables WHERE id = ? AND task_id = ?').bind(delId, taskId).first();
    if (!d) return err('Deliverable not found', 'NOT_FOUND', 404);
    await db.prepare('DELETE FROM task_deliverables WHERE id = ?').bind(delId).run();
    return json({ success: true, data: { id: delId, deleted: true } });
  },

  // ── Push to ClickUp ──────────────────────────────────

  async taskPushClickUp(_req, env, params) {
    const db = env.DB;
    const token = env.CLICKUP_API_TOKEN;
    if (!token) return err('CLICKUP_API_TOKEN not configured', 'CONFIG_ERROR', 500);
    const id = parseInt(params[0]);
    const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
    if (!task) return err('Task not found', 'NOT_FOUND', 404);

    const STATUS_REVERSE = { backlog: 'to do', active: 'to do', review: 'to do', blocked: 'to do', done: 'complete' };
    const DEFAULT_LIST = '901710736660'; // Operations/Backlog

    if (task.clickup_id) {
      // Update existing
      await fetch(`https://api.clickup.com/api/v2/task/${task.clickup_id}`, {
        method: 'PUT',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: task.title, description: task.description || '', status: STATUS_REVERSE[task.status] || 'to do' }),
      });
      return json({ success: true, data: { action: 'updated', clickup_id: task.clickup_id } });
    } else {
      // Create new
      const resp = await fetch(`https://api.clickup.com/api/v2/list/${DEFAULT_LIST}/task`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: task.title, description: task.description || '', status: STATUS_REVERSE[task.status] || 'to do' }),
      });
      const cu = await resp.json();
      if (cu.id) {
        await db.prepare('UPDATE tasks SET clickup_id = ?, clickup_list_id = ? WHERE id = ?').bind(cu.id, DEFAULT_LIST, id).run();
        return json({ success: true, data: { action: 'created', clickup_id: cu.id } });
      }
      return err('ClickUp API error', 'EXTERNAL_ERROR', 502);
    }
  },

  async tasksPushAll(_req, env) {
    const db = env.DB;
    const token = env.CLICKUP_API_TOKEN;
    if (!token) return err('CLICKUP_API_TOKEN not configured', 'CONFIG_ERROR', 500);

    const unsynced = await db.prepare('SELECT * FROM tasks WHERE clickup_id IS NULL').all();
    const DEFAULT_LIST = '901710736660';
    const STATUS_REVERSE = { backlog: 'to do', active: 'to do', review: 'to do', blocked: 'to do', done: 'complete' };
    let pushed = 0;

    for (const task of unsynced.results) {
      const resp = await fetch(`https://api.clickup.com/api/v2/list/${DEFAULT_LIST}/task`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: task.title, description: task.description || '', status: STATUS_REVERSE[task.status] || 'to do' }),
      });
      const cu = await resp.json();
      if (cu.id) {
        await db.prepare('UPDATE tasks SET clickup_id = ?, clickup_list_id = ? WHERE id = ?').bind(cu.id, DEFAULT_LIST, task.id).run();
        pushed++;
      }
    }
    return json({ success: true, data: { pushed, total: unsynced.results.length } });
  },

  // ── Agent Roster ──────────────────────────────────────

  async agentsRoster(_req, env) {
    const db = env.DB;
    const results = await db.prepare('SELECT name, signature_color, status FROM agents ORDER BY name ASC').all();
    // Add Koa as assignable
    const roster = [{ name: 'koa', signature_color: '#f97316', status: 'active' }, ...results.results];
    return json({ success: true, data: roster });
  },

  // GET /api/github — GitHub dashboard proxy
  async github(req, env) {
    const result = await handleGitHub(req, env);
    return json(result, result.success ? 200 : 500);
  },

  // GET /api/prices?symbols=MRNA,CSGP,KLAC — Yahoo Finance price proxy
  async pricesGet(req, env) {
    const url = new URL(req.url);
    const symbols = (url.searchParams.get('symbols') || '').split(',').filter(Boolean).slice(0, 20);
    if (symbols.length === 0) return err('Missing symbols parameter', 'VALIDATION_ERROR', 400);

    const prices = {};
    const fetches = symbols.map(async (ticker) => {
      try {
        const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (resp.ok) {
          const data = await resp.json();
          const meta = data?.chart?.result?.[0]?.meta;
          if (meta) {
            const price = meta.regularMarketPrice || 0;
            const prevClose = meta.previousClose || meta.chartPreviousClose || 0;
            prices[ticker] = {
              price,
              prevClose,
              change: prevClose > 0 ? +(price - prevClose).toFixed(2) : 0,
              changePct: prevClose > 0 ? +((price - prevClose) / prevClose * 100).toFixed(2) : 0
            };
          }
        }
      } catch {}
    });
    await Promise.all(fetches);
    return json({ success: true, data: prices, timestamp: new Date().toISOString() });
  },

  // PUT /api/agents/:name/files/:filename — create or update file
  async agentFilePut(req, env, params) {
    const db = env.DB;
    const name = params[0];
    const fileName = decodeURIComponent(params[1]);
    const body = await parseBody(req);

    if (!body.content) return err('Missing required field: content', 'VALIDATION_ERROR', 400);

    await db.prepare(
      `INSERT INTO agent_files (agent_name, file_name, content, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(agent_name, file_name) DO UPDATE SET content = excluded.content, updated_at = datetime('now')`
    ).bind(name, fileName, body.content).run();

    return json({ success: true, data: { agent_name: name, file_name: fileName } });
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
        response = await handlers[route.handler](request, env, route.params, ctx);
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

  // Cron: sync ClickUp tasks every 5 minutes
  async scheduled(event, env, ctx) {
    try {
      const fakeReq = new Request('https://localhost/api/tasks/sync', { method: 'POST' });
      await handlers.tasksSync(fakeReq, env);
      console.log('Cron sync completed');
    } catch (e) {
      console.error('Cron sync failed:', e);
    }
  },
};
