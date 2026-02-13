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
