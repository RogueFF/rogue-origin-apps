-- Create system_config table
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK(value_type IN ('string', 'number', 'boolean', 'json')),
  category TEXT NOT NULL,
  description TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_config_category ON system_config(category);

-- Insert initial configuration values
INSERT OR IGNORE INTO system_config (key, value, value_type, category, description) VALUES
('labor.base_wage_rate', '23.00', 'number', 'labor', 'Base wage rate in $/hour before taxes'),
('labor.employer_tax_rate', '0.14', 'number', 'labor', 'Oregon employer tax rate (FICA, FUTA, SUI, Workers Comp)'),
('production.baseline_daily_goal', '200', 'number', 'production', 'Baseline daily production goal in lbs'),
('production.fallback_daily_goal', '66', 'number', 'production', 'Fallback daily goal when calculation fails'),
('production.bag_weight_lbs', '11.0231', 'number', 'production', '5kg bag weight converted to lbs'),
('production.target_bag_weight_kg', '5.0', 'number', 'production', 'Target bag weight in kg for scale'),
('schedule.time_slot_multipliers', '{"7:00 AM – 8:00 AM":1.0,"8:00 AM – 9:00 AM":1.0,"9:00 AM – 10:00 AM":0.83,"10:00 AM – 11:00 AM":1.0,"11:00 AM – 12:00 PM":1.0,"12:30 PM – 1:00 PM":0.5,"1:00 PM – 2:00 PM":1.0,"2:00 PM – 3:00 PM":1.0,"2:30 PM – 3:00 PM":0.5,"3:00 PM – 4:00 PM":0.83,"4:00 PM – 4:30 PM":0.33,"3:00 PM – 3:30 PM":0.5}', 'json', 'schedule', 'Time slot multipliers for break-adjusted targets'),
('schedule.normal_hours', '8.5', 'number', 'schedule', 'Normal productive work hours per day'),
('schedule.shift_start', '07:00', 'string', 'schedule', 'Shift start time (HH:MM)'),
('schedule.shift_end', '16:30', 'string', 'schedule', 'Shift end time (HH:MM)'),
('schedule.breaks', '[{"hour":9,"min":0,"duration":10},{"hour":12,"min":0,"duration":30},{"hour":14,"min":30,"duration":10},{"hour":16,"min":20,"duration":10}]', 'json', 'schedule', 'Break times and durations'),
('api.ai_model', 'claude-sonnet-4-20250514', 'string', 'api', 'Anthropic AI model version for chat'),
('polling.dashboard_refresh_ms', '30000', 'number', 'polling', 'Dashboard auto-refresh interval'),
('polling.scale_stale_threshold_ms', '3000', 'number', 'polling', 'Scale reading stale threshold'),
('validation.max_lbs_per_entry', '200', 'number', 'validation', 'Maximum lbs allowed per hourly entry');
