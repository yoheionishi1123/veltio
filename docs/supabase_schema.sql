-- Veltio Supabase Schema
-- SQL Editor で実行してください

-- ── テナント（企業アカウント） ───────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  account_name TEXT NOT NULL DEFAULT '',
  company_name TEXT DEFAULT '',
  contact_name TEXT DEFAULT '',
  job_title TEXT DEFAULT '',
  plan TEXT DEFAULT 'free',
  trial_ends_at TIMESTAMPTZ,
  plan_history JSONB DEFAULT '[]',
  invited_users JSONB DEFAULT '[]',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_subscription_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── ユーザー ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  display_name TEXT DEFAULT '',
  email_verified_at TIMESTAMPTZ,
  email_verification JSONB,
  password_reset JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── テナント-ユーザー紐付け ──────────────────────────────────
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, user_id)
);

-- ── セッション ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

-- ── プロジェクト（分析対象サイト） ──────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT DEFAULT '',
  target_cvr NUMERIC,
  site_type TEXT,
  purchase_intent TEXT,
  store_integration TEXT,
  site_goal TEXT,
  campaigns JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS projects_tenant_id_idx ON projects(tenant_id);

-- ── プロジェクトコンテキスト（施策ログ） ────────────────────
CREATE TABLE IF NOT EXISTS project_contexts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
  company_note TEXT DEFAULT '',
  action_log_history JSONB DEFAULT '[]',
  company_note_history JSONB DEFAULT '[]',
  group_measurements JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── GA4接続情報 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ga4_connections (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  property_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  google_email TEXT,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  last_sync_error TEXT
);

-- ── ステージルール（GA4ファネル設定） ────────────────────────
CREATE TABLE IF NOT EXISTS stage_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
  pdp_event_name TEXT DEFAULT 'view_item',
  cart_reach_mode TEXT DEFAULT 'add_to_cart_or_begin_checkout'
);

-- ── 日次メトリクス ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metric_daily (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  sessions INTEGER DEFAULT 0,
  pdp_sessions INTEGER DEFAULT 0,
  add_to_cart_sessions INTEGER DEFAULT 0,
  cart_reach_sessions INTEGER DEFAULT 0,
  checkout_sessions INTEGER DEFAULT 0,
  purchase_sessions INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  channel TEXT DEFAULT '',
  device TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS metric_daily_project_date_idx ON metric_daily(project_id, date);

-- ── 診断結果 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS diagnosis_results (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  from_date DATE,
  to_date DATE,
  result JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── レポートジョブ ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  format TEXT,
  file_path TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ── AIアシスタントメッセージ ─────────────────────────────────
CREATE TABLE IF NOT EXISTS assistant_messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS assistant_messages_project_idx ON assistant_messages(project_id, created_at);

-- ── アプリイベント（行動ログ） ───────────────────────────────
CREATE TABLE IF NOT EXISTS app_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_type TEXT NOT NULL,
  user_id TEXT,
  tenant_id TEXT,
  project_id TEXT,
  anonymous_id TEXT,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS app_events_type_idx ON app_events(event_type, created_at DESC);

-- ── OAuthステート（一時トークン） ────────────────────────────
CREATE TABLE IF NOT EXISTS oauth_states (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  project_id TEXT,
  user_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── ベンチマーク（KPI基準値） ────────────────────────────────
CREATE TABLE IF NOT EXISTS benchmarks (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  label TEXT,
  target NUMERIC,
  bad_when TEXT,
  unit TEXT,
  UNIQUE(project_id, metric_key)
);

-- ── 診断ルール ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS diagnosis_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  title TEXT,
  reason TEXT,
  bottleneck_stage TEXT,
  min_sessions INTEGER DEFAULT 500,
  critical_gap NUMERIC,
  high_gap NUMERIC,
  medium_gap NUMERIC,
  UNIQUE(project_id, metric_key)
);

-- ── レコメンドテンプレート ───────────────────────────────────
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  metric_key TEXT,
  cause_category TEXT,
  title TEXT,
  summary TEXT,
  image_label TEXT,
  data JSONB DEFAULT '{}'
);

-- ── アプリ設定 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO app_config (key, value) VALUES ('last_batch_run_at', NULL)
  ON CONFLICT (key) DO NOTHING;

-- ── 管理用ビュー（ユーザー管理に便利） ──────────────────────
CREATE OR REPLACE VIEW admin_users AS
SELECT
  u.id,
  u.email,
  u.display_name,
  u.email_verified_at IS NOT NULL AS verified,
  u.created_at,
  t.id AS tenant_id,
  t.account_name,
  t.company_name,
  t.plan,
  t.trial_ends_at,
  m.role,
  (SELECT COUNT(*) FROM projects p WHERE p.tenant_id = t.id) AS project_count,
  (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > NOW()) AS active_sessions
FROM users u
LEFT JOIN memberships m ON m.user_id = u.id
LEFT JOIN tenants t ON t.id = m.tenant_id
ORDER BY u.created_at DESC;
