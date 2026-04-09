-- Supabase マイグレーション v2
-- project_contexts に欠落カラムを追加
-- Supabase ダッシュボード → SQL Editor で実行してください

ALTER TABLE project_contexts
  ADD COLUMN IF NOT EXISTS action_log TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS action_owner TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS action_status TEXT DEFAULT 'todo',
  ADD COLUMN IF NOT EXISTS action_priority TEXT DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS action_completed_at_date TEXT;
