-- Mission Control D1 Schema v0.1
-- Atlas Squad System — Backend API

-- Agents registry
CREATE TABLE IF NOT EXISTS agents (
  name TEXT PRIMARY KEY,
  domain TEXT NOT NULL,           -- 'work' | 'trading' | 'life' | 'system'
  model_tier TEXT NOT NULL,       -- 'opus' | 'sonnet' | 'haiku' | 'ollama'
  status TEXT DEFAULT 'idle',     -- 'idle' | 'active' | 'error'
  last_active DATETIME,
  current_task TEXT,
  signature_color TEXT,           -- hex color for UI
  signature_glyph TEXT            -- emoji/icon identifier
);

-- Activity feed — everything agents do
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name TEXT NOT NULL,
  type TEXT NOT NULL,             -- 'task_complete' | 'insight' | 'alert' | 'comm' | 'error'
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  priority TEXT DEFAULT 'normal', -- 'low' | 'normal' | 'high' | 'urgent'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_name) REFERENCES agents(name)
);

-- Inbox — items needing Koa's decision
CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name TEXT NOT NULL,
  type TEXT NOT NULL,             -- 'decision' | 'approval' | 'alert' | 'recommendation'
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  actions TEXT,                   -- JSON array of available actions
  priority TEXT DEFAULT 'normal',
  status TEXT DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected' | 'snoozed'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  FOREIGN KEY (agent_name) REFERENCES agents(name)
);

-- Briefs — trading briefs, standups, reports
CREATE TABLE IF NOT EXISTS briefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,             -- 'morning' | 'evening' | 'standup' | 'alert' | 'degen'
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audio_url TEXT,                 -- URL to TTS audio if generated
  action_items TEXT,              -- JSON array
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Comms — inter-agent communication
CREATE TABLE IF NOT EXISTS comms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_agent TEXT NOT NULL,
  to_agent TEXT,                  -- null = broadcast
  channel TEXT NOT NULL,          -- 'board' | 'direct' | 'broadcast' | 'standup'
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Agent files — AGENT.md, SOUL.md, SKILLS.md, CONTEXT.md content
CREATE TABLE IF NOT EXISTS agent_files (
  agent_name TEXT NOT NULL,
  file_name TEXT NOT NULL,            -- 'AGENT.md' | 'SOUL.md' | 'SKILLS.md' | 'CONTEXT.md'
  content TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_name, file_name),
  FOREIGN KEY (agent_name) REFERENCES agents(name)
);

-- Positions — Ledger portfolio tracking
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  direction TEXT NOT NULL,            -- 'long' | 'short'
  vehicle TEXT NOT NULL,              -- 'calls' | 'puts' | 'shares' | 'spread' | 'crypto'
  strike REAL,                        -- option strike price (null for shares/crypto)
  expiry TEXT,                        -- option expiry date (null for shares/crypto)
  entry_price REAL NOT NULL,
  quantity REAL NOT NULL,             -- contracts, shares, or units
  entry_date DATETIME NOT NULL,
  status TEXT DEFAULT 'open',         -- 'open' | 'closed'
  exit_price REAL,
  exit_date DATETIME,
  pnl REAL,                           -- realized P&L (set on close)
  notes TEXT,
  target_price REAL DEFAULT 0,
  stop_loss REAL DEFAULT 0,
  current_price REAL,
  current_pnl REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity(agent_name);
CREATE INDEX IF NOT EXISTS idx_activity_domain ON activity(domain);
CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox(status);
CREATE INDEX IF NOT EXISTS idx_inbox_priority ON inbox(priority);
CREATE INDEX IF NOT EXISTS idx_briefs_type ON briefs(type);
CREATE INDEX IF NOT EXISTS idx_briefs_created ON briefs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_created ON comms(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_from ON comms(from_agent);
CREATE INDEX IF NOT EXISTS idx_comms_to ON comms(to_agent);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_ticker ON positions(ticker);
CREATE INDEX IF NOT EXISTS idx_positions_entry_date ON positions(entry_date DESC);

-- Regime signals — market health snapshots
CREATE TABLE IF NOT EXISTS regime_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal TEXT NOT NULL,            -- 'GREEN' | 'YELLOW' | 'RED'
  label TEXT,                      -- 'Risk On' | 'Caution' | 'Risk Off'
  data TEXT,                       -- JSON: {spy_price, spy_trend, vix, yield_10y, ...}
  scores TEXT,                     -- JSON: {green: N, yellow: N, red: N}
  reasoning TEXT,                  -- JSON array of reasoning strings
  strategy TEXT,                   -- JSON: {position_sizing, strategies, stops, new_entries}
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_regime_created ON regime_signals(created_at DESC);

-- Trade plays — structured trade setups from Strategist
CREATE TABLE IF NOT EXISTS trade_plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  direction TEXT DEFAULT 'long',   -- 'long' | 'short'
  vehicle TEXT DEFAULT 'shares',   -- 'shares' | 'calls' | 'puts' | 'spread' | 'straddle'
  thesis TEXT,
  setup TEXT,                      -- JSON: {entry, target, stop, size, greeks, etc}
  risk_level TEXT DEFAULT 'normal', -- 'normal' | 'degen' | 'conservative'
  source_agent TEXT DEFAULT 'strategist',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plays_created ON trade_plays(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plays_ticker ON trade_plays(ticker);
