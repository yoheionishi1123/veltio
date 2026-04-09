/**
 * Supabase-backed readDb / writeDb
 * JSON ファイル DB の代替として server/index.js から import して使う
 */
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[db] SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が未設定です");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

// ── camelCase ↔ snake_case ─────────────────────────────────────────────────────

function toSnakeKey(k) {
  return k.replace(/([A-Z])/g, "_$1").toLowerCase();
}

function toCamelKey(k) {
  return k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function toSnake(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [toSnakeKey(k), v]));
}

function toCamel(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [toCamelKey(k), v]));
}

// ── JS コレクション名 → Supabase テーブル名 ──────────────────────────────────

const TABLE_MAP = {
  tenants:           "tenants",
  users:             "users",
  memberships:       "memberships",
  sessions:          "sessions",
  projects:          "projects",
  projectContexts:   "project_contexts",
  ga4Connections:    "ga4_connections",
  stageRules:        "stage_rules",
  metricDaily:       "metric_daily",
  diagnosisResults:  "diagnosis_results",
  reportJobs:        "report_jobs",
  assistantMessages: "assistant_messages",
  appEvents:         "app_events",
  oauthStates:       "oauth_states",
  benchmarks:        "benchmarks",
  diagnosisRules:    "diagnosis_rules",
};

// ── テーブルごとの有効カラム（スキーマ外フィールドを除外するため）────────────

const COLUMNS = {
  tenants: new Set([
    "id","account_name","company_name","contact_name","job_title","plan",
    "trial_ends_at","plan_history","invited_users","stripe_customer_id",
    "stripe_subscription_id","stripe_subscription_status","created_at"
  ]),
  users: new Set([
    "id","email","password_hash","display_name","email_verified_at",
    "email_verification","password_reset","created_at"
  ]),
  memberships: new Set(["id","tenant_id","user_id","role","created_at"]),
  sessions: new Set(["id","user_id","expires_at","created_at"]),
  projects: new Set([
    "id","tenant_id","name","domain","target_cvr","site_type",
    "purchase_intent","store_integration","site_goal","campaigns","created_at"
  ]),
  project_contexts: new Set([
    "id","project_id","company_note","action_log_history","company_note_history",
    "group_measurements","updated_at",
    // v2 migration で追加されたカラム
    "action_log","action_owner","action_status","action_priority","action_completed_at_date"
  ]),
  ga4_connections: new Set([
    "id","project_id","tenant_id","property_id","access_token","refresh_token",
    "token_expires_at","google_email","connected_at","last_synced_at","last_sync_error"
  ]),
  stage_rules: new Set(["id","project_id","pdp_event_name","cart_reach_mode"]),
  metric_daily: new Set([
    "id","project_id","date","sessions","pdp_sessions","add_to_cart_sessions",
    "cart_reach_sessions","checkout_sessions","purchase_sessions",
    "conversions","channel","device","created_at"
  ]),
  diagnosis_results: new Set(["id","project_id","from_date","to_date","result","created_at"]),
  report_jobs: new Set([
    "id","project_id","tenant_id","status","format","file_path","error",
    "created_at","completed_at"
  ]),
  assistant_messages: new Set(["id","project_id","role","content","created_at"]),
  app_events: new Set([
    "id","event_type","user_id","tenant_id","project_id","anonymous_id","data","created_at"
  ]),
  oauth_states: new Set(["id","tenant_id","project_id","user_id","expires_at","created_at"]),
  benchmarks: new Set(["id","project_id","metric_key","label","target","bad_when","unit"]),
  diagnosis_rules: new Set([
    "id","project_id","metric_key","title","reason","bottleneck_stage",
    "min_sessions","critical_gap","high_gap","medium_gap"
  ]),
};

function filterColumns(table, row) {
  const allowed = COLUMNS[table];
  if (!allowed) return row;
  return Object.fromEntries(Object.entries(row).filter(([k]) => allowed.has(k)));
}

// ── app_events: JS は "meta", DB は "data" ────────────────────────────────────

function serializeAppEvent(item) {
  const { meta, ...rest } = item;
  return toSnake({ ...rest, data: meta ?? {} });
}

function deserializeAppEvent(row) {
  const { data, ...rest } = toCamel(row);
  return { ...rest, meta: data ?? null };
}

// ── キャッシュ & スナップショット ─────────────────────────────────────────────

let _dbCache = null;
let _snapshot = null;

function makeId() {
  return crypto.randomUUID();
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ── readDb ────────────────────────────────────────────────────────────────────

export async function readDb() {
  if (_dbCache) return _dbCache;

  const tableKeys  = Object.keys(TABLE_MAP);
  const tableNames = Object.values(TABLE_MAP);

  const [rows, configResult] = await Promise.all([
    Promise.all(
      tableNames.map(async (table) => {
        const { data, error } = await supabase.from(table).select("*");
        if (error) throw new Error(`[db] readDb ${table}: ${error.message}`);
        return data ?? [];
      })
    ),
    supabase.from("app_config").select("*")
  ]);

  const db = {};
  tableKeys.forEach((key, i) => {
    db[key] = key === "appEvents"
      ? rows[i].map(deserializeAppEvent)
      : rows[i].map(toCamel);
  });

  // app_config → lastBatchRunAt
  db.lastBatchRunAt = configResult.data?.find(r => r.key === "last_batch_run_at")?.value ?? null;

  // Supabase スキーマ外のコレクション（インメモリのみ）
  db.metricItemDaily = [];
  db.templates = []; // bootstrap() でコード定数から注入される

  _snapshot = deepClone(db);
  _dbCache = db;
  return db;
}

// ── writeDb ───────────────────────────────────────────────────────────────────
// 外部キー制約の順序: tenants/users → memberships/sessions/projects → 子テーブル

// 依存関係を考慮した実行順序グループ
const WRITE_GROUPS = [
  ["tenants", "users"],                                        // 親テーブル
  ["memberships", "sessions", "projects"],                     // tenants/users に依存
  ["projectContexts", "ga4Connections", "stageRules",         // projects に依存
   "diagnosisResults", "reportJobs", "assistantMessages",
   "metricDaily", "oauthStates", "appEvents",
   "benchmarks", "diagnosisRules"],                            // 独立 or 弱依存
];

function buildOps(db, keys) {
  const ops = [];
  for (const key of keys) {
    const table = TABLE_MAP[key];
    if (!table) continue;

    const current = db[key] ?? [];
    const initial = _snapshot?.[key] ?? [];

    const initialById = new Map(initial.map(item => [item.id, item]));
    const currentById = new Map();

    for (const item of current) {
      if (!item.id) item.id = makeId();
      currentById.set(item.id, item);
    }

    const toUpsert = current.filter(item => {
      const orig = initialById.get(item.id);
      return !orig || JSON.stringify(item) !== JSON.stringify(orig);
    });

    const toDelete = initial
      .filter(item => item.id && !currentById.has(item.id))
      .map(item => item.id);

    if (toUpsert.length > 0) {
      const rows = toUpsert.map(item =>
        filterColumns(table, key === "appEvents" ? serializeAppEvent(item) : toSnake(item))
      );
      ops.push(
        supabase.from(table).upsert(rows, { onConflict: "id" }).then(({ error }) => {
          if (error) console.error(`[db] upsert ${table}:`, error.message);
        })
      );
    }

    if (toDelete.length > 0) {
      // IDを50件ずつに分割してdelete（URLの長さ制限を回避）
      for (let i = 0; i < toDelete.length; i += 50) {
        const chunk = toDelete.slice(i, i + 50);
        ops.push(
          supabase.from(table).delete().in("id", chunk).then(({ error }) => {
            if (error) console.error(`[db] delete ${table}:`, error.message);
          })
        );
      }
    }
  }
  return ops;
}

export async function writeDb(db) {
  _dbCache = db;

  // グループ順に直列実行（外部キー制約を尊重）
  for (const group of WRITE_GROUPS) {
    const ops = buildOps(db, group);
    if (ops.length > 0) await Promise.all(ops);
  }

  // lastBatchRunAt → app_config テーブル
  if (db.lastBatchRunAt !== _snapshot?.lastBatchRunAt) {
    const { error } = await supabase.from("app_config")
      .upsert({ key: "last_batch_run_at", value: db.lastBatchRunAt }, { onConflict: "key" });
    if (error) console.error("[db] upsert app_config:", error.message);
  }

  _snapshot = deepClone(db);
}
