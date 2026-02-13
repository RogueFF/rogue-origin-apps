-- Seed all 14 agents
-- Domain: work | trading | life | system
-- Model tier from master plan: atlas=opus, friday/radar/regime/ledger/strategist/analyst=sonnet, viper/wire/scout/guide/dispatch=haiku, grower=haiku, darwin=sonnet

INSERT OR REPLACE INTO agents (name, domain, model_tier, status, signature_color, signature_glyph) VALUES
  ('atlas',      'system',  'opus',   'idle', '#a78bfa', '🧭'),
  ('friday',     'work',    'sonnet', 'idle', '#60a5fa', '🔧'),
  ('radar',      'work',    'sonnet', 'idle', '#34d399', '📡'),
  ('dispatch',   'work',    'haiku',  'idle', '#fbbf24', '📋'),
  ('grower',     'work',    'haiku',  'idle', '#4ade80', '🌱'),
  ('viper',      'trading', 'haiku',  'idle', '#f87171', '⚡'),
  ('wire',       'trading', 'haiku',  'idle', '#38bdf8', '📰'),
  ('regime',     'trading', 'sonnet', 'idle', '#a3a3a3', '🌡️'),
  ('strategist', 'trading', 'sonnet', 'idle', '#c084fc', '🎯'),
  ('analyst',    'trading', 'sonnet', 'idle', '#fb923c', '🔬'),
  ('ledger',     'trading', 'sonnet', 'idle', '#2dd4bf', '📊'),
  ('scout',      'life',    'haiku',  'idle', '#e879f9', '🔭'),
  ('guide',      'life',    'haiku',  'idle', '#f472b6', '🗺️'),
  ('sensei',     'life',    'haiku',  'idle', '#fde047', '🧘'),
  ('darwin',     'system',  'sonnet', 'idle', '#94a3b8', '🧬');
