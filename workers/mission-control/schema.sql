-- Mission Control D1 Schema v0.1
-- Atlas Squad System — Backend API

-- Agents registry
CREATE TABLE IF NOT EXISTS agents (
  name TEXT PRIMARY KEY,
  domain TEXT NOT NULL,           -- 'work' | 'system'
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

-- Briefs — daily operations briefs, standups, reports
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

-- Tasks — dispatch/project tracking
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'backlog',      -- 'backlog' | 'active' | 'review' | 'done' | 'blocked'
  priority TEXT DEFAULT 'medium',     -- 'critical' | 'high' | 'medium' | 'low'
  assigned_agent TEXT,
  domain TEXT,
  parent_id INTEGER,
  clickup_id TEXT,
  clickup_list_id TEXT,
  session_url TEXT,                   -- dispatch session viewer deep-link
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(assigned_agent);
CREATE INDEX IF NOT EXISTS idx_tasks_clickup ON tasks(clickup_id);

-- Task comments
CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  author TEXT,
  body TEXT,
  comment_type TEXT DEFAULT 'comment',  -- 'comment' | 'insight' | 'status_update'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);

-- Task deliverables — screenshots, markdown, links, files
CREATE TABLE IF NOT EXISTS task_deliverables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  content TEXT,
  deliverable_type TEXT DEFAULT 'link', -- 'link' | 'note' | 'screenshot' | 'code' | 'file' | 'markdown'
  author TEXT DEFAULT 'atlas',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_deliverables_task ON task_deliverables(task_id);

-- Widgets — cached KV data for dashboard
CREATE TABLE IF NOT EXISTS widgets (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
