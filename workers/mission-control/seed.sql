-- Seed the operations agent fleet
-- Domain: work | system

INSERT OR REPLACE INTO agents (name, domain, model_tier, status, signature_color, signature_glyph) VALUES
  ('atlas',      'system',  'opus',   'idle', '#a78bfa', '🧭'),
  ('friday',     'work',    'sonnet', 'idle', '#60a5fa', '🔧'),
  ('radar',      'work',    'sonnet', 'idle', '#34d399', '📡'),
  ('dispatch',   'work',    'haiku',  'idle', '#fbbf24', '📋'),
  ('grower',     'work',    'haiku',  'idle', '#4ade80', '🌱'),
  ('darwin',     'system',  'sonnet', 'idle', '#94a3b8', '🧬');
