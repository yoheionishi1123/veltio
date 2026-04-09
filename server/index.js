import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { readDb, writeDb } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const APP_STORAGE_ROOT = process.env.CVR_STORAGE_DIR
  ? path.resolve(process.env.CVR_STORAGE_DIR)
  : __dirname;
const DATA_DIR = path.join(APP_STORAGE_ROOT, "data");
const REPORT_DIR = path.join(APP_STORAGE_ROOT, "reports");
const DB_FILE = path.join(DATA_DIR, "db.json");
const PORT = Number(process.env.PORT || 3210);
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "cvr_sid";
const AUTH_PROVIDER = String(process.env.AUTH_PROVIDER || "local").trim().toLowerCase() === "supabase" ? "supabase" : "local";
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const GOOGLE_OAUTH_CLIENT_ID = process.env.GA4_OAUTH_CLIENT_ID || "";
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GA4_OAUTH_CLIENT_SECRET || "";
const GOOGLE_OAUTH_REDIRECT_URI = process.env.GA4_OAUTH_REDIRECT_URI || `http://localhost:${PORT}/api/ga4/oauth/callback`;
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "";
const SELF_GA4_PROPERTY_ID = process.env.SELF_GA4_PROPERTY_ID || "";
const SELF_GA4_MEASUREMENT_ID = process.env.SELF_GA4_MEASUREMENT_ID || "G-VBKYWDLGE5";
const SELF_GA4_STREAM_ID = process.env.SELF_GA4_STREAM_ID || "14131607973";
const SELF_GA4_SERVICE_ACCOUNT_EMAIL = process.env.SELF_GA4_SERVICE_ACCOUNT_EMAIL || "";
const SELF_GA4_SERVICE_ACCOUNT_PRIVATE_KEY = process.env.SELF_GA4_SERVICE_ACCOUNT_PRIVATE_KEY || "";
const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";

// ── Stripe ────────────────────────────────────────────────────────────────────
const STRIPE_SECRET_KEY        = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET    = process.env.STRIPE_WEBHOOK_SECRET || "";
const STRIPE_PRO_PRICE_ID      = process.env.STRIPE_PRO_PRICE_ID || "";
const STRIPE_BUSINESS_PRICE_ID = process.env.STRIPE_BUSINESS_PRICE_ID || "";
const APP_BASE_URL             = process.env.APP_BASE_URL || "https://app.vel-tio.com";

let stripe = null;
if (STRIPE_SECRET_KEY) {
  try {
    const { default: Stripe } = await import("stripe");
    stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-04-10" });
  } catch (e) {
    console.warn("[stripe] init failed:", e.message);
  }
}

const PLAN_PRICE_MAP = {};
if (STRIPE_PRO_PRICE_ID)      PLAN_PRICE_MAP[STRIPE_PRO_PRICE_ID]      = "pro";
if (STRIPE_BUSINESS_PRICE_ID) PLAN_PRICE_MAP[STRIPE_BUSINESS_PRICE_ID] = "business";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const BENCHMARK_DEFAULTS = [
  { id: "bm-bounce", metricKey: "bounce_rate", label: "直帰率", target: 0.50, badWhen: "higher", unit: "ratio" },
  { id: "bm-pdp", metricKey: "pdp_reach_rate", label: "商品詳細ページ到達率", target: 0.3, badWhen: "lower", unit: "ratio" },
  { id: "bm-add", metricKey: "add_to_cart_rate", label: "カート追加率", target: 0.2, badWhen: "lower", unit: "ratio" },
  { id: "bm-cart-abandon", metricKey: "cart_abandon_rate", label: "カート離脱率", target: 0.7, badWhen: "higher", unit: "ratio" },
  { id: "bm-checkout", metricKey: "checkout_reach_rate", label: "checkout到達率", target: 0.45, badWhen: "lower", unit: "ratio" },
  { id: "bm-purchase", metricKey: "purchase_rate", label: "購入完了率", target: 0.35, badWhen: "lower", unit: "ratio" },
  { id: "bm-cvr", metricKey: "cvr", label: "CVR", target: 0.015, badWhen: "lower", unit: "ratio" }
];

const DIAGNOSIS_RULE_DEFAULTS = [
  {
    id: "rule-bounce",
    metricKey: "bounce_rate",
    title: "直帰率が高止まり",
    reason: "流入意図とLPの訴求ミスマッチまたは初期表示品質の問題が疑われます",
    bottleneckStage: "landing_page",
    minSessions: 500,
    criticalGap: 0.15,
    highGap: 0.08,
    mediumGap: 0.04
  },
  {
    id: "rule-pdp",
    metricKey: "pdp_reach_rate",
    title: "PDP到達率が低い",
    reason: "一覧からPDPへの導線、検索性、商品情報の露出不足が疑われます",
    bottleneckStage: "navigation_to_pdp",
    minSessions: 500,
    criticalGap: 0.12,
    highGap: 0.06,
    mediumGap: 0.03
  },
  {
    id: "rule-add",
    metricKey: "add_to_cart_rate",
    title: "カート追加率が低い",
    reason: "PDPのCTA視認性、価格/送料情報、商品選択UIの摩擦が疑われます",
    bottleneckStage: "pdp_to_cart",
    minSessions: 300,
    criticalGap: 0.1,
    highGap: 0.05,
    mediumGap: 0.02
  },
  {
    id: "rule-cart",
    metricKey: "cart_abandon_rate",
    title: "カート離脱率が高い",
    reason: "配送費表示タイミング、クーポン導線、決済前の不安要因が疑われます",
    bottleneckStage: "cart_to_checkout",
    minSessions: 200,
    criticalGap: 0.12,
    highGap: 0.06,
    mediumGap: 0.03
  },
  {
    id: "rule-checkout",
    metricKey: "checkout_reach_rate",
    title: "チェックアウト到達率が低い",
    reason: "カート画面から決済開始ボタンまでの導線に改善余地があります",
    bottleneckStage: "cart_to_checkout",
    minSessions: 200,
    criticalGap: 0.12,
    highGap: 0.06,
    mediumGap: 0.03
  },
  {
    id: "rule-purchase",
    metricKey: "purchase_rate",
    title: "購入完了率が低い",
    reason: "決済手段不足、入力項目過多、チェックアウトエラーが疑われます",
    bottleneckStage: "checkout_to_purchase",
    minSessions: 150,
    criticalGap: 0.12,
    highGap: 0.06,
    mediumGap: 0.03
  }
];

const RECOMMENDATION_TEMPLATES = [
  {
    id: "tpl-bounce-1",
    metricKey: "bounce_rate",
    causeCategory: "landing_message_mismatch",
    title: "LPファーストビューを流入訴求に合わせる",
    summary: "ファーストビューの訴求・速度・信頼情報を同時に改善して直帰を抑えます。",
    imageLabel: "First View",
    imageColor: "#1d4ed8",
    actionSteps: [
      "広告文と見出しを一致させる",
      "1stビューで誰の何を解決するかを3秒で伝える",
      "3秒以内の表示を目標に画像最適化する",
      "累計購入数やレビューをFV直下に配置する"
    ],
    impactScore: 5,
    easeScore: 3,
    validationMetric: "bounce_rate"
  },
  {
    id: "tpl-pdp-1",
    metricKey: "pdp_reach_rate",
    causeCategory: "weak_navigation",
    title: "一覧→PDP導線の強化",
    summary: "一覧・検索・導線設計を改善し、商品詳細の閲覧率を底上げします。",
    imageLabel: "PDP Flow",
    imageColor: "#0f766e",
    actionSteps: [
      "一覧カード全体をクリック可能にする",
      "商品画像に人気・再入荷などのバッジを付ける",
      "在庫/価格/配送日を一覧で可視化する",
      "検索導線とタグ導線を目立つ位置へ再配置する"
    ],
    impactScore: 4,
    easeScore: 4,
    validationMetric: "pdp_reach_rate"
  },
  {
    id: "tpl-add-1",
    metricKey: "add_to_cart_rate",
    causeCategory: "pdp_friction",
    title: "PDPの購入意思決定阻害を削減",
    summary: "CTAの視認性・商品情報・心理的障壁を同時に下げてカート追加を増やします。",
    imageLabel: "Add Cart",
    imageColor: "#b45309",
    actionSteps: [
      "カート追加CTAの固定表示",
      "サイズ/カラー選択エラーを即時表示する",
      "送料・返品条件をCTA付近で明示する",
      "レビュー・サイズ感・利用画像をPDP上部に追加する"
    ],
    impactScore: 5,
    easeScore: 2,
    validationMetric: "add_to_cart_rate"
  },
  {
    id: "tpl-cart-1",
    metricKey: "cart_abandon_rate",
    causeCategory: "checkout_entry_drop",
    title: "カートから決済開始への遷移率を改善",
    summary: "送料・クーポン・決済導線の不安を減らし、カゴ落ちを抑えます。",
    imageLabel: "Checkout",
    imageColor: "#be123c",
    actionSteps: [
      "合計金額内訳をカート画面で即表示",
      "ゲスト購入導線を明確化",
      "クーポン入力UIを簡素化する",
      "離脱防止モーダルで戻る前に特典を提示する"
    ],
    impactScore: 5,
    easeScore: 3,
    validationMetric: "checkout_reach_rate"
  },
  {
    id: "tpl-purchase-1",
    metricKey: "purchase_rate",
    causeCategory: "checkout_friction",
    title: "チェックアウト完了率を引き上げる",
    summary: "フォーム項目削減・EFO・決済手段追加で購入完了率を上げます。",
    imageLabel: "Purchase",
    imageColor: "#7c3aed",
    actionSteps: [
      "入力項目を最小化し自動補完を有効化",
      "利用可能決済手段を増やす",
      "エラー理由と修正方法をその場表示する",
      "Amazon Pay等の簡易決済を導入する"
    ],
    impactScore: 5,
    easeScore: 2,
    validationMetric: "purchase_rate"
  }
];

const DEFAULT_STAGE_RULES = {
  pdpEventName: "view_item",
  pdpUrlPattern: "/products/",
  addToCartEventName: "add_to_cart",
  cartEventName: "view_cart",
  cartAltEventName: "begin_checkout",
  cartUrlPattern: "/cart",
  checkoutEventName: "begin_checkout",
  checkoutUrlPattern: "/checkout",
  purchaseEventName: "purchase",
  cartReachMode: "view_cart_or_begin_checkout"
};

function uid() {
  return crypto.randomUUID();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const test = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(test));
}

function verificationCodeHash(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function issueEmailVerification(user) {
  const code = generateVerificationCode();
  user.emailVerification = {
    codeHash: verificationCodeHash(code),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    issuedAt: new Date().toISOString()
  };
  return code;
}

function issuePasswordReset(user) {
  const code = generateVerificationCode();
  user.passwordReset = {
    codeHash: verificationCodeHash(code),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    issuedAt: new Date().toISOString()
  };
  return code;
}

function trackAppEvent(db, event) {
  if (!Array.isArray(db.appEvents)) db.appEvents = [];
  db.appEvents.push({
    id: uid(),
    eventType: String(event.eventType || "unknown"),
    userId: event.userId || null,
    tenantId: event.tenantId || null,
    projectId: event.projectId || null,
    anonymousId: event.anonymousId || null,
    meta: event.meta || null,
    createdAt: event.createdAt || new Date().toISOString()
  });
}

async function sendVerificationEmail(email, code) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("email_delivery_not_configured");
    }
    return { delivered: false, previewCode: code };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [email],
      subject: "Veltio メール認証コード",
      text: `Veltio の確認コードは ${code} です。15分以内に入力してください。`
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`email_delivery_failed:${text}`);
  }
  return { delivered: true };
}

async function sendInviteEmail(inviteeEmail, inviterName, inviterCompany) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    return { delivered: false };
  }
  const displayName = inviterCompany || inviterName || "Veltioユーザー";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [inviteeEmail],
      subject: `${displayName}さんからVeltioへの招待が届きました`,
      text: [
        `${displayName}さんがあなたをVeltio（CVR分析ツール）に招待しました。`,
        ``,
        `Veltioはサイトのコンバージョン改善を支援するSaaSツールです。`,
        `以下のURLからアカウントを作成すると、${displayName}さんのワークスペースに参加できます。`,
        ``,
        `https://app.vel-tio.com/`,
        ``,
        `このメールに心当たりがない場合は無視してください。`
      ].join("\n")
    })
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("invite email failed:", text);
    return { delivered: false };
  }
  return { delivered: true };
}

async function sendPasswordResetEmail(email, code) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("email_delivery_not_configured");
    }
    return { delivered: false, previewCode: code };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [email],
      subject: "Veltio パスワード再設定コード",
      text: `Veltio のパスワード再設定コードは ${code} です。15分以内に入力してください。`
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`email_delivery_failed:${text}`);
  }
  return { delivered: true };
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(";").reduce((acc, pair) => {
    const [key, ...rest] = pair.trim().split("=");
    acc[key] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(REPORT_DIR, { recursive: true });
  try {
    await fs.access(DB_FILE);
  } catch {
    const initial = {
      tenants: [],
      users: [],
      memberships: [],
      sessions: [],
      projects: [],
      projectContexts: [],
      ga4Connections: [],
      stageRules: [],
      metricDaily: [],
      diagnosisResults: [],
      reportJobs: [],
      assistantMessages: [],
      appEvents: [],
      oauthStates: [],
      benchmarks: BENCHMARK_DEFAULTS,
      diagnosisRules: DIAGNOSIS_RULE_DEFAULTS,
      templates: RECOMMENDATION_TEMPLATES,
      lastBatchRunAt: null
    };
    await fs.writeFile(DB_FILE, JSON.stringify(initial, null, 2), "utf8");
  }
}

// readDb / writeDb は ./db.js (Supabase) から import 済み

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function notFound(res) {
  json(res, 404, { error: "not_found" });
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("invalid_json");
  }
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}


function base64UrlEncode(value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function normalizePrivateKey(value) {
  return String(value || "").replace(/\\n/g, "\n");
}

function selfGaConfigured() {
  return Boolean(SELF_GA4_PROPERTY_ID && SELF_GA4_SERVICE_ACCOUNT_EMAIL && SELF_GA4_SERVICE_ACCOUNT_PRIVATE_KEY);
}

async function fetchSelfGaAccessToken() {
  if (!selfGaConfigured()) throw new Error("self_ga4_not_configured");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: SELF_GA4_SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(normalizePrivateKey(SELF_GA4_SERVICE_ACCOUNT_PRIVATE_KEY));
  const assertion = `${unsigned}.${base64UrlEncode(signature)}`;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`self_ga4_token_failed:${txt}`);
  const data = JSON.parse(txt);
  return data.access_token;
}

async function runSelfGa4Report(accessToken, body) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${SELF_GA4_PROPERTY_ID}:runReport`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`self_ga4_run_report_failed:${txt}`);
  return JSON.parse(txt);
}

function metricNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

async function fetchSelfGa4Analytics(from, to) {
  const accessToken = await fetchSelfGaAccessToken();
  const [summary, trend, events] = await Promise.all([
    runSelfGa4Report(accessToken, {
      dateRanges: [{ startDate: from, endDate: to }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "conversions" },
        { name: "bounceRate" },
        { name: "screenPageViews" }
      ]
    }),
    runSelfGa4Report(accessToken, {
      dateRanges: [{ startDate: from, endDate: to }],
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "conversions" }
      ],
      orderBys: [{ dimension: { dimensionName: "date" } }]
    }),
    runSelfGa4Report(accessToken, {
      dateRanges: [{ startDate: from, endDate: to }],
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: {
            values: ["page_view", "sign_up", "login", "upgrade_to_pro", "report_generated", "ga4_connected"]
          }
        }
      }
    })
  ]);

  const s = summary.rows?.[0]?.metricValues || [];
  const summaryData = {
    sessions: metricNumber(s[0]?.value),
    users: metricNumber(s[1]?.value),
    conversions: metricNumber(s[2]?.value),
    bounceRate: metricNumber(s[3]?.value),
    pageViews: metricNumber(s[4]?.value)
  };

  const trendData = (trend.rows || []).map((row) => {
    const raw = row.dimensionValues?.[0]?.value || "";
    const label = raw.length === 8 ? `${raw.slice(4, 6)}/${raw.slice(6, 8)}` : raw;
    return {
      date: raw,
      label,
      sessions: metricNumber(row.metricValues?.[0]?.value),
      users: metricNumber(row.metricValues?.[1]?.value),
      conversions: metricNumber(row.metricValues?.[2]?.value)
    };
  });

  const eventCounts = {};
  (events.rows || []).forEach((row) => {
    eventCounts[row.dimensionValues?.[0]?.value || "unknown"] = metricNumber(row.metricValues?.[0]?.value);
  });

  const days = dayList(from, to).length;
  return {
    propertyId: SELF_GA4_PROPERTY_ID,
    measurementId: SELF_GA4_MEASUREMENT_ID,
    streamId: SELF_GA4_STREAM_ID,
    from,
    to,
    days,
    syncedAt: new Date().toISOString(),
    summary: summaryData,
    trend: trendData,
    eventCounts
  };
}

function safeDivide(num, den) {
  if (!den || den <= 0) return 0;
  return num / den;
}

function aggregateBlankRow() {
  return {
    sessions: 0,
    engagedSessions: 0,
    pdpSessions: 0,
    addToCartSessions: 0,
    cartReachSessions: 0,
    checkoutSessions: 0,
    purchaseSessions: 0,
    revenue: 0
  };
}

function metricBadWhen(metricKey, db) {
  const benchmark = db?.benchmarks?.find((item) => item.metricKey === metricKey);
  return benchmark?.badWhen || (["bounce_rate", "cart_abandon_rate"].includes(metricKey) ? "higher" : "lower");
}

function benchmarkForMetric(db, metricKey) {
  return db.benchmarks.find((item) => item.metricKey === metricKey) || null;
}

function metricGap(metricKey, value, benchmark, db) {
  if (!benchmark) return 0;
  return metricBadWhen(metricKey, db) === "higher" ? value - benchmark.target : benchmark.target - value;
}

function severityFromGap(rule, gap) {
  if (gap >= rule.criticalGap) return "critical";
  if (gap >= rule.highGap) return "high";
  if (gap >= rule.mediumGap) return "medium";
  return "low";
}

function buildMetricComparisons(db, rates, project = null) {
  return db.benchmarks.map((benchmark) => {
    const target = benchmark.metricKey === "cvr" && typeof project?.targetCvr === "number"
      ? project.targetCvr
      : benchmark.target;
    const value = rates[benchmark.metricKey] ?? 0;
    const gap = metricGap(benchmark.metricKey, value, { ...benchmark, target }, db);
    return {
      metricKey: benchmark.metricKey,
      label: benchmark.label,
      value,
      target,
      badWhen: benchmark.badWhen,
      gap,
      status: gap > 0 ? "needs_attention" : "ok"
    };
  });
}

function computeRates(agg) {
  const engagementRate = safeDivide(agg.engagedSessions, agg.sessions);
  const bounceRate = 1 - engagementRate;
  const pdpReachRate = safeDivide(agg.pdpSessions, agg.sessions);
  const addToCartRate = safeDivide(agg.addToCartSessions, agg.pdpSessions);
  const cartAbandonRate = safeDivide(agg.cartReachSessions - agg.purchaseSessions, agg.cartReachSessions);
  const checkoutReachRate = safeDivide(agg.checkoutSessions, Math.max(agg.addToCartSessions, agg.checkoutSessions));
  const purchaseRate = safeDivide(agg.purchaseSessions, agg.checkoutSessions);
  const cvr = safeDivide(agg.purchaseSessions, agg.sessions);

  return {
    bounce_rate: bounceRate,
    pdp_reach_rate: pdpReachRate,
    add_to_cart_rate: addToCartRate,
    cart_abandon_rate: cartAbandonRate,
    checkout_reach_rate: checkoutReachRate,
    purchase_rate: purchaseRate,
    cvr
  };
}

function findProjectAccessible(db, projectId, userId) {
  const project = db.projects.find((p) => p.id === projectId);
  if (!project) return null;
  const member = db.memberships.find((m) => m.tenantId === project.tenantId && m.userId === userId);
  if (!member) return null;
  return project;
}

function primaryTenantForUser(db, userId) {
  const membership = db.memberships.find((m) => m.userId === userId);
  if (!membership) return null;
  return db.tenants.find((t) => t.id === membership.tenantId) || null;
}

// ── Plan session limits ────────────────────────────────────────────────────────
const PLAN_SESSION_LIMITS = {
  free:     10_000,
  pro:     100_000,
  business: Infinity // unlimited
};
const TRIAL_DAYS = 14;

function isTrialActive(tenant) {
  if (!tenant) return false;
  const endsAt = tenant.trialEndsAt;
  if (!endsAt) return false;
  return new Date(endsAt) > new Date();
}

function ensureTenantDefaults(tenant) {
  if (!tenant) return tenant;
  tenant.accountName = tenant.accountName || tenant.name || "";
  tenant.companyName = tenant.companyName || tenant.name || "";
  tenant.contactName = tenant.contactName || "";
  tenant.jobTitle = tenant.jobTitle || "";
  // migrate legacy "starter" to "free"
  if (tenant.plan === "starter") tenant.plan = "free";
  tenant.plan = tenant.plan || "free";
  // trial: set trialEndsAt 14 days from creation if not present
  if (!tenant.trialEndsAt) {
    const base = tenant.createdAt ? new Date(tenant.createdAt) : new Date();
    const end = new Date(base.getTime() + TRIAL_DAYS * ONE_DAY_MS);
    tenant.trialEndsAt = end.toISOString();
  }
  if (!Array.isArray(tenant.planHistory)) {
    tenant.planHistory = [{
      id: uid(),
      fromPlan: null,
      toPlan: tenant.plan,
      changedAt: tenant.createdAt || new Date().toISOString(),
      source: "init"
    }];
  }
  if (!Array.isArray(tenant.invitedUsers)) {
    tenant.invitedUsers = [];
  }
  // Stripe billing fields
  tenant.stripeCustomerId        = tenant.stripeCustomerId        || null;
  tenant.stripeSubscriptionId    = tenant.stripeSubscriptionId    || null;
  tenant.stripeSubscriptionStatus = tenant.stripeSubscriptionStatus || null;
  return tenant;
}

function ensureProjectDefaults(project) {
  if (!project) return project;
  if (!Object.prototype.hasOwnProperty.call(project, "targetCvr")) {
    project.targetCvr = null;
  }
  if (!Array.isArray(project.campaigns)) {
    project.campaigns = [];
  }
  return project;
}

function tenantForProject(db, project) {
  const tenant = db.tenants.find((t) => t.id === project.tenantId) || null;
  return ensureTenantDefaults(tenant);
}

function ensureProjectContextDefaults(context, projectId = "") {
  const next = context || {};
  next.projectId = next.projectId || projectId;
  next.companyNote = next.companyNote || "";
  next.actionLog = next.actionLog || "";
  next.actionOwner = next.actionOwner || "";
  next.actionStatus = next.actionStatus || "todo";
  next.actionPriority = next.actionPriority || "medium";
  next.actionCompletedAtDate = next.actionCompletedAtDate || null;
  next.updatedAt = next.updatedAt || null;
  if (!Array.isArray(next.companyNoteHistory)) next.companyNoteHistory = [];
  if (!Array.isArray(next.actionLogHistory)) next.actionLogHistory = [];
  return next;
}

function projectContextFor(db, projectId) {
  const found = db.projectContexts.find((item) => item.projectId === projectId) || null;
  return ensureProjectContextDefaults(found, projectId);
}

function currentUser(db, req) {
  const cookies = parseCookies(req);
  const sid = cookies[SESSION_COOKIE_NAME];
  if (!sid) return null;
  const session = db.sessions.find((s) => s.id === sid && new Date(s.expiresAt).getTime() > Date.now());
  if (!session) return null;
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) return null;
  return user;
}

function isAdminUser(user) {
  const email = String(user?.email || "").toLowerCase();
  return ADMIN_EMAILS.has(email);
}

function authConfigPayload() {
  const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  return {
    provider: "local",
    requestedProvider: AUTH_PROVIDER,
    hasEmailDelivery: Boolean(RESEND_API_KEY && RESEND_FROM_EMAIL),
    supportsVerificationCode: true,
    supportsPasswordResetCode: true,
    hasSupabaseConfig,
    supabaseUrl: hasSupabaseConfig ? SUPABASE_URL : null
  };
}

function validateDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function extractGa4PropertyId(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (/^\d{5,}$/.test(raw)) return raw;
  if (/^p\d{5,}$/i.test(raw)) return raw.slice(1);
  const pMatch = raw.match(/\/p(\d{5,})(?:\/|$)/i);
  if (pMatch) return pMatch[1];
  const propMatch = raw.match(/[?&]property[_-]?id=(\d{5,})/i);
  if (propMatch) return propMatch[1];
  const anyLongNumber = raw.match(/(\d{5,})/);
  if (anyLongNumber) return anyLongNumber[1];
  return null;
}

function requireGoogleOAuthConfig() {
  return Boolean(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET && GOOGLE_OAUTH_REDIRECT_URI);
}

function buildGa4OauthUrl(state) {
  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: [
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
      "openid"
    ].join(" "),
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    grant_type: "authorization_code"
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`oauth_token_exchange_failed:${txt}`);
  }
  return res.json();
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
    grant_type: "refresh_token"
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`oauth_token_refresh_failed:${txt}`);
  }
  return res.json();
}

async function fetchGoogleUserEmail(accessToken) {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.email || null;
}

function normalizeGrantedScopes(scopeValue) {
  return String(scopeValue || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasAnalyticsReadonlyScope(conn) {
  return normalizeGrantedScopes(conn?.grantedScope).includes("https://www.googleapis.com/auth/analytics.readonly");
}

async function runGa4Report(propertyId, accessToken, requestBody) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`ga4_run_report_failed:${txt}`);
  }
  return res.json();
}

async function ensureFreshAccessToken(db, projectId) {
  const conn = db.ga4Connections.find((g) => g.projectId === projectId);
  if (!conn) {
    throw new Error("ga4_not_connected");
  }

  const expiresAt = new Date(conn.expiresAt).getTime();
  const marginMs = 60 * 1000;
  if (expiresAt > Date.now() + marginMs) {
    return conn;
  }

  const refreshed = await refreshAccessToken(conn.refreshToken);
  conn.accessToken = refreshed.access_token;
  if (refreshed.refresh_token) {
    conn.refreshToken = refreshed.refresh_token;
  }
  if (refreshed.scope) {
    conn.grantedScope = refreshed.scope;
  }
  conn.expiresAt = new Date(Date.now() + (refreshed.expires_in || 3600) * 1000).toISOString();
  conn.updatedAt = new Date().toISOString();
  return conn;
}

function cleanDimensionValue(value, fallback) {
  const v = String(value || "").trim();
  if (!v) return fallback;
  if (v === "(not set)") return fallback;
  return v;
}

function normalizeGa4Date(value) {
  const raw = String(value || "").trim();
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}

async function syncProjectMetricsFromGa4(db, project, from, to) {
  const rules = db.stageRules.find((r) => r.projectId === project.id) || { ...DEFAULT_STAGE_RULES, projectId: project.id };
  const conn = await ensureFreshAccessToken(db, project.id);
  if (!hasAnalyticsReadonlyScope(conn)) {
    throw new Error(`ga4_missing_scope:${conn.grantedScope || "none"}`);
  }

  const baseReport = await runGa4Report(conn.ga4PropertyId, conn.accessToken, {
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [
      { name: "date" },
      { name: "sessionDefaultChannelGroup" },
      { name: "deviceCategory" },
      { name: "landingPagePlusQueryString" }
    ],
    metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "totalRevenue" }],
    keepEmptyRows: false,
    limit: "250000"
  });

  const eventNames = new Set([
    rules.pdpEventName || "view_item",
    rules.addToCartEventName || "add_to_cart",
    rules.cartEventName || "view_cart",
    rules.cartAltEventName || "begin_checkout",
    rules.checkoutEventName || "begin_checkout",
    rules.purchaseEventName || "purchase"
  ]);

  const eventReport = await runGa4Report(conn.ga4PropertyId, conn.accessToken, {
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [
      { name: "date" },
      { name: "sessionDefaultChannelGroup" },
      { name: "deviceCategory" },
      { name: "landingPagePlusQueryString" },
      { name: "eventName" }
    ],
    metrics: [{ name: "sessions" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        inListFilter: { values: [...eventNames] }
      }
    },
    keepEmptyRows: false,
    limit: "250000"
  });

  const baseMap = new Map();
  for (const row of baseReport.rows || []) {
    const date = normalizeGa4Date(row.dimensionValues?.[0]?.value || "");
    const channel = cleanDimensionValue(row.dimensionValues?.[1]?.value, "Unassigned");
    const device = cleanDimensionValue(row.dimensionValues?.[2]?.value, "unknown");
    const landingPage = cleanDimensionValue(row.dimensionValues?.[3]?.value, "/");
    const key = `${date}|${channel}|${device}|${landingPage}`;
    baseMap.set(key, {
      id: uid(),
      projectId: project.id,
      date,
      channel,
      device,
      landingPage,
      sessions: Number(row.metricValues?.[0]?.value || 0),
      engagedSessions: Number(row.metricValues?.[1]?.value || 0),
      pdpSessions: 0,
      addToCartSessions: 0,
      cartReachSessions: 0,
      checkoutSessions: 0,
      purchaseSessions: 0,
      revenue: Number(row.metricValues?.[2]?.value || 0)
    });
  }

  const eventMap = new Map();
  for (const row of eventReport.rows || []) {
    const date = normalizeGa4Date(row.dimensionValues?.[0]?.value || "");
    const channel = cleanDimensionValue(row.dimensionValues?.[1]?.value, "Unassigned");
    const device = cleanDimensionValue(row.dimensionValues?.[2]?.value, "unknown");
    const landingPage = cleanDimensionValue(row.dimensionValues?.[3]?.value, "/");
    const eventName = row.dimensionValues?.[4]?.value || "";
    const sessions = Number(row.metricValues?.[0]?.value || 0);
    const key = `${date}|${channel}|${device}|${landingPage}`;
    if (!eventMap.has(key)) {
      eventMap.set(key, {});
    }
    eventMap.get(key)[eventName] = sessions;
  }

  for (const [key, row] of baseMap.entries()) {
    const ev = eventMap.get(key) || {};
    const pdpEvent = rules.pdpEventName || "view_item";
    const cartEvent = rules.cartEventName || "view_cart";
    const cartAltEvent = rules.cartAltEventName || "begin_checkout";
    const checkoutEvent = rules.checkoutEventName || "begin_checkout";

    const addToCartEvent = rules.addToCartEventName || "add_to_cart";
    const purchaseEvent = rules.purchaseEventName || "purchase";
    row.pdpSessions = Number(ev[pdpEvent] || 0);
    row.addToCartSessions = Number(ev[addToCartEvent] || 0);
    row.checkoutSessions = Number(ev[checkoutEvent] || 0);
    row.purchaseSessions = Number(ev[purchaseEvent] || 0);

    const cartByViewCart = Number(ev[cartEvent] || 0);
    const cartByBeginCheckout = Number(ev[cartAltEvent] || 0);
    if (rules.cartReachMode === "view_cart_only") {
      row.cartReachSessions = cartByViewCart;
    } else if (rules.cartReachMode === "begin_checkout_only") {
      row.cartReachSessions = cartByBeginCheckout || row.checkoutSessions;
    } else {
      row.cartReachSessions = Math.max(cartByViewCart, cartByBeginCheckout, row.checkoutSessions);
    }
  }

  const dates = dayList(from, to);
  db.metricDaily = db.metricDaily.filter((r) => !(r.projectId === project.id && dates.includes(r.date)));
  db.metricDaily.push(...baseMap.values());

  // Item-level report (itemName × itemCategory)
  const itemReport = await runGa4Report(conn.ga4PropertyId, conn.accessToken, {
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [
      { name: "date" },
      { name: "itemName" },
      { name: "itemCategory" }
    ],
    metrics: [
      { name: "itemsViewed" },
      { name: "addToCarts" },
      { name: "itemsPurchased" },
      { name: "itemRevenue" }
    ],
    keepEmptyRows: false,
    limit: "50000"
  }).catch(() => ({ rows: [] }));

  const itemMap = new Map();
  for (const row of itemReport.rows || []) {
    const date = normalizeGa4Date(row.dimensionValues?.[0]?.value || "");
    const itemName = cleanDimensionValue(row.dimensionValues?.[1]?.value, "(not set)");
    const itemCategory = cleanDimensionValue(row.dimensionValues?.[2]?.value, "(not set)");
    const key = `${date}|${itemName}|${itemCategory}`;
    if (!itemMap.has(key)) {
      itemMap.set(key, {
        id: uid(), projectId: project.id, date, itemName, itemCategory,
        itemsViewed: 0, addToCarts: 0, itemsPurchased: 0, itemRevenue: 0
      });
    }
    const r = itemMap.get(key);
    r.itemsViewed += Number(row.metricValues?.[0]?.value || 0);
    r.addToCarts += Number(row.metricValues?.[1]?.value || 0);
    r.itemsPurchased += Number(row.metricValues?.[2]?.value || 0);
    r.itemRevenue += Number(row.metricValues?.[3]?.value || 0);
  }
  if (!Array.isArray(db.metricItemDaily)) db.metricItemDaily = [];
  db.metricItemDaily = db.metricItemDaily.filter((r) => !(r.projectId === project.id && dates.includes(r.date)));
  db.metricItemDaily.push(...itemMap.values());

  conn.lastSyncedAt = new Date().toISOString();
  conn.updatedAt = new Date().toISOString();
}

function dateRangeFromQuery(urlObj) {
  const from = urlObj.searchParams.get("from");
  const to = urlObj.searchParams.get("to");
  if (!from || !to || !validateDate(from) || !validateDate(to)) {
    return null;
  }
  return { from, to };
}

function aggregateMetricRows(rows) {
  return rows.reduce((acc, row) => {
    acc.sessions += row.sessions;
    acc.engagedSessions += row.engagedSessions;
    acc.pdpSessions += row.pdpSessions;
    acc.addToCartSessions += row.addToCartSessions;
    acc.cartReachSessions += row.cartReachSessions;
    acc.checkoutSessions += row.checkoutSessions;
    acc.purchaseSessions += row.purchaseSessions;
    acc.revenue += row.revenue;
    return acc;
  }, aggregateBlankRow());
}

function selectRowsForPeriod(db, projectId, from, to) {
  return db.metricDaily.filter((row) => row.projectId === projectId && row.date >= from && row.date <= to);
}

function dayList(from, to) {
  const out = [];
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + ONE_DAY_MS);
  }
  return out;
}

function defaultRecentRange(days = 30) {
  const to = isoDateOnly(new Date());
  const from = isoDateOnly(new Date(Date.now() - (days - 1) * ONE_DAY_MS));
  return { from, to };
}

function adminRangeFromQuery(urlObj) {
  const from = urlObj.searchParams.get("from");
  const to = urlObj.searchParams.get("to");
  if (!from && !to) {
    return defaultRecentRange(30);
  }
  if (!from || !to || !validateDate(from) || !validateDate(to)) {
    return null;
  }
  return { from, to };
}

function parseIsoDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function isoDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function startOfWeekIso(value) {
  const date = parseIsoDate(value);
  const day = date.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  return isoDateOnly(new Date(date.getTime() + delta * ONE_DAY_MS));
}

function startOfMonthIso(value) {
  const date = parseIsoDate(value);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function bucketKeyForGranularity(date, granularity) {
  if (granularity === "week") return startOfWeekIso(date);
  if (granularity === "month") return startOfMonthIso(date);
  return date;
}

function normalizeGranularity(input) {
  return ["day", "week", "month"].includes(input) ? input : "day";
}

function userHasProPlan(db, userId) {
  const tenant = primaryTenantForUser(db, userId);
  if (!tenant) return false;
  // Trial gives full Pro access
  if (isTrialActive(tenant)) return true;
  return tenant.plan === "pro" || tenant.plan === "business";
}
function userHasBusinessPlan(db, userId) {
  const tenant = primaryTenantForUser(db, userId);
  if (!tenant) return false;
  if (isTrialActive(tenant)) return true; // trial = full business access
  return tenant.plan === "business";
}
function setPlanForTenant(db, tenant, newPlan, source = "stripe_webhook") {
  const fromPlan = tenant.plan || "free";
  if (!["free", "pro", "business"].includes(newPlan)) return;
  tenant.plan = newPlan;
  if (!Array.isArray(tenant.planHistory)) tenant.planHistory = [];
  if (fromPlan !== newPlan) {
    tenant.planHistory.push({
      id: uid(), fromPlan, toPlan: newPlan,
      changedAt: new Date().toISOString(), source
    });
    trackAppEvent(db, { eventType: "tenant_plan_changed", tenantId: tenant.id,
      meta: { fromPlan, toPlan: newPlan, source } });
  }
}

function buildSeries(rows, granularity) {
  const map = new Map();
  for (const row of rows) {
    const bucket = bucketKeyForGranularity(row.date, granularity);
    const current = map.get(bucket) || { date: bucket, ...aggregateBlankRow() };
    current.sessions += row.sessions;
    current.engagedSessions += row.engagedSessions;
    current.pdpSessions += row.pdpSessions;
    current.addToCartSessions += row.addToCartSessions;
    current.cartReachSessions += row.cartReachSessions;
    current.checkoutSessions += row.checkoutSessions;
    current.purchaseSessions += row.purchaseSessions;
    current.revenue += row.revenue;
    map.set(bucket, current);
  }
  return [...map.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((item) => ({
      bucket: item.date,
      totals: item,
      metrics: computeRates(item)
    }));
}

function seedRng(seedStr) {
  let seed = 0;
  for (const ch of seedStr) {
    seed = (seed * 31 + ch.charCodeAt(0)) % 2147483647;
  }
  return () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
}

function generateDailyMetrics(project, stageRules, date) {
  const channels = ["Organic Search", "Paid Search", "Direct", "Social", "Referral"];
  const devices = ["desktop", "mobile"];
  const lps = ["/", "/sale", "/category/new", "/campaign/spring"];
  const rng = seedRng(`${project.id}-${date}`);
  const rows = [];

  for (const channel of channels) {
    for (const device of devices) {
      for (const lp of lps) {
        const sessions = Math.floor(60 + rng() * 260);
        const engagementRate = 0.25 + rng() * 0.55;
        const engagedSessions = Math.floor(sessions * engagementRate);

        const pdpBase = stageRules.pdpEventName === "view_item" ? 0.2 : 0.14;
        const pdpSessions = Math.floor(sessions * (pdpBase + rng() * 0.32));
        const addToCartSessions = Math.floor(pdpSessions * (0.12 + rng() * 0.34));

        const cartLift = stageRules.cartReachMode === "begin_checkout_only" ? 0.9 : 1.0;
        const cartReachSessions = Math.floor(addToCartSessions * (cartLift + rng() * 0.35));
        const checkoutSessions = Math.floor(cartReachSessions * (0.35 + rng() * 0.5));
        const purchaseSessions = Math.floor(checkoutSessions * (0.25 + rng() * 0.5));
        const revenue = purchaseSessions * (3500 + Math.floor(rng() * 12000));

        rows.push({
          id: crypto.createHash("sha256")
            .update(`${project.id}|${date}|${channel}|${device}|${lp}`)
            .digest("hex").slice(0, 36),
          projectId: project.id,
          date,
          channel,
          device,
          landingPage: lp,
          sessions,
          engagedSessions,
          pdpSessions,
          addToCartSessions,
          cartReachSessions,
          checkoutSessions,
          purchaseSessions,
          revenue
        });
      }
    }
  }

  return rows;
}

function generateItemMetrics(project, date) {
  const rng = seedRng(`${project.id}-item-${date}`);
  const items = [
    { name: "Tシャツ A", category: "トップス" },
    { name: "デニム B", category: "ボトムス" },
    { name: "スニーカー C", category: "シューズ" },
    { name: "コート D", category: "アウター" },
    { name: "バッグ E", category: "アクセサリー" },
    { name: "ワンピース F", category: "ワンピース" },
    { name: "パーカー G", category: "トップス" },
    { name: "スカート H", category: "ボトムス" }
  ];
  return items.map((item) => {
    const itemsViewed = Math.floor(80 + rng() * 400);
    const addToCarts = Math.floor(itemsViewed * (0.1 + rng() * 0.25));
    const itemsPurchased = Math.floor(addToCarts * (0.2 + rng() * 0.5));
    const itemRevenue = itemsPurchased * (2000 + Math.floor(rng() * 15000));
    return {
      id: uid(), projectId: project.id, date,
      itemName: item.name, itemCategory: item.category,
      itemsViewed, addToCarts, itemsPurchased, itemRevenue
    };
  });
}

function groupedItemBreakdown(rows, dimension) {
  const map = new Map();
  for (const row of rows) {
    const key = dimension === "item_name" ? row.itemName : row.itemCategory;
    if (!map.has(key)) {
      map.set(key, { dimensionValue: key, itemsViewed: 0, addToCarts: 0, itemsPurchased: 0, itemRevenue: 0 });
    }
    const g = map.get(key);
    g.itemsViewed += row.itemsViewed;
    g.addToCarts += row.addToCarts;
    g.itemsPurchased += row.itemsPurchased;
    g.itemRevenue += row.itemRevenue;
  }
  return [...map.values()].map((g) => ({
    ...g,
    metrics: {
      view_to_cart_rate: g.itemsViewed > 0 ? g.addToCarts / g.itemsViewed : 0,
      cart_to_purchase_rate: g.addToCarts > 0 ? g.itemsPurchased / g.addToCarts : 0,
      purchase_rate: g.itemsViewed > 0 ? g.itemsPurchased / g.itemsViewed : 0
    }
  }));
}

function worstRowForMetric(metricKey, groupedRows, db) {
  if (!groupedRows.length) return null;
  const badWhen = metricBadWhen(metricKey, db);
  const sorted = [...groupedRows].sort((a, b) =>
    badWhen === "higher" ? b.metrics[metricKey] - a.metrics[metricKey] : a.metrics[metricKey] - b.metrics[metricKey]
  );
  return sorted[0] || null;
}

function runDiagnosisFromAggregate(db, agg, breakdownSets, project = null) {
  const rates = computeRates(agg);
  const findings = [];
  const comparisons = buildMetricComparisons(db, rates, project);
  const confidence = Math.min(1, Math.log10(Math.max(agg.sessions, 10)) / 4);
  const trafficWeight = Math.min(1.5, Math.max(0.5, agg.sessions / 5000));

  for (const rule of db.diagnosisRules) {
    const benchmark = benchmarkForMetric(db, rule.metricKey);
    const value = rates[rule.metricKey] ?? 0;
    const gap = metricGap(rule.metricKey, value, benchmark, db);
    if (!benchmark || agg.sessions < rule.minSessions || gap <= 0) {
      continue;
    }

    const worstCandidates = [
      worstRowForMetric(rule.metricKey, breakdownSets.channel || [], db),
      worstRowForMetric(rule.metricKey, breakdownSets.device || [], db),
      worstRowForMetric(rule.metricKey, breakdownSets.landing_page || [], db)
    ].filter(Boolean);
    const worstHint =
      worstCandidates.sort((a, b) => {
        const av = a.metrics[rule.metricKey] ?? 0;
        const bv = b.metrics[rule.metricKey] ?? 0;
        return metricBadWhen(rule.metricKey, db) === "higher" ? bv - av : av - bv;
      })[0] || null;

    findings.push({
      metricKey: rule.metricKey,
      bottleneckStage: rule.bottleneckStage,
      severity: severityFromGap(rule, gap),
      title: rule.title,
      reason: rule.reason,
      benchmark: benchmark.target,
      value,
      gap,
      score: gap * trafficWeight * confidence,
      worstHint: worstHint
        ? {
            dimension: worstHint.dimension,
            dimensionValue: worstHint.dimensionValue,
            metricValue: worstHint.metrics[rule.metricKey]
          }
        : null,
      worstCandidates: worstCandidates.slice(0, 3).map((w) => ({
        dimension: w.dimension,
        dimensionValue: w.dimensionValue,
        metricValue: w.metrics[rule.metricKey]
      }))
    });
  }

  const worstBySessions = [...(breakdownSets.landing_page || [])]
    .sort((a, b) => a.metrics.pdp_reach_rate - b.metrics.pdp_reach_rate)
    .slice(0, 3);

  return {
    rates,
    comparisons,
    findings: findings.sort((a, b) => b.score - a.score),
    worstHints: worstBySessions
  };
}

function pickTemplates(db, findings, projectId = "") {
  const keys = new Set(findings.map((f) => f.metricKey));
  const context = projectId ? projectContextFor(db, projectId) : null;
  return db.templates
    .filter((tpl) => keys.has(tpl.metricKey))
    .sort((a, b) => reprioritizedTemplateScore(b, context) - reprioritizedTemplateScore(a, context));
}

async function syncProjectMetrics(db, project) {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end.getTime() - 29 * ONE_DAY_MS);
  const from = start.toISOString().slice(0, 10);
  const to = end.toISOString().slice(0, 10);
  const conn = db.ga4Connections.find((g) => g.projectId === project.id);

  if (conn && requireGoogleOAuthConfig()) {
    try {
      await syncProjectMetricsFromGa4(db, project, from, to);
      conn.lastSyncError = null;
      return;
    } catch (err) {
      conn.lastSyncError = String(err.message || err);
    }
  }

  const rules = db.stageRules.find((r) => r.projectId === project.id) || { ...DEFAULT_STAGE_RULES, projectId: project.id };
  const dates = dayList(from, to);
  db.metricDaily = db.metricDaily.filter((r) => !(r.projectId === project.id && dates.includes(r.date)));
  if (!Array.isArray(db.metricItemDaily)) db.metricItemDaily = [];
  db.metricItemDaily = db.metricItemDaily.filter((r) => !(r.projectId === project.id && dates.includes(r.date)));
  for (const date of dates) {
    db.metricDaily.push(...generateDailyMetrics(project, rules, date));
    db.metricItemDaily.push(...generateItemMetrics(project, date));
  }
}

function reportText(project, from, to, metrics, comparisons, worstRows, findings, recommendations) {
  const lines = [];
  lines.push(`Veltioレポート: ${project.name}`);
  lines.push(`期間: ${from} 〜 ${to}`);
  lines.push(`サイト: ${project.domain}`);
  lines.push("");
  lines.push("[主要指標]");
  for (const item of comparisons) {
    const gapText =
      item.status === "ok"
        ? "基準内"
        : `基準差 ${(Math.abs(item.gap) * 100).toFixed(2)}pt`;
    lines.push(`- ${item.label}: ${(item.value * 100).toFixed(2)}% (基準 ${(item.target * 100).toFixed(2)}% / ${gapText})`);
  }
  lines.push("");
  lines.push("[ワーストTOP]");
  for (const row of worstRows.slice(0, 5)) {
    lines.push(`- ${row.dimensionValue}: PDP到達率 ${(row.metrics.pdp_reach_rate * 100).toFixed(2)}%`);
  }
  lines.push("");
  lines.push("[診断要点]");
  if (findings.length === 0) {
    lines.push("- 重大なボトルネックは検出されませんでした");
  } else {
    for (const finding of findings.slice(0, 5)) {
      const worstText = finding.worstHint
        ? ` / 悪化箇所 ${finding.worstHint.dimension}:${finding.worstHint.dimensionValue}`
        : "";
      lines.push(`- ${finding.title} (${finding.severity}): ${finding.reason}${worstText}`);
    }
  }
  lines.push("");
  lines.push("[推奨施策TOP]");
  for (const tpl of recommendations.slice(0, 5)) {
    const firstAction = Array.isArray(tpl.actionSteps) && tpl.actionSteps[0] ? ` / まずは: ${tpl.actionSteps[0]}` : "";
    lines.push(`- ${tpl.title} / Impact:${tpl.impactScore} Ease:${tpl.easeScore} / 検証:${tpl.validationMetric}${firstAction}`);
  }

  return lines.join("\n");
}

function asciiReportLines(project, from, to, metrics, comparisons, worstRows, findings, recommendations) {
  const lines = [];
  lines.push(`CVR Optimizer Report: ${project.name}`);
  lines.push(`Period: ${from} to ${to}`);
  lines.push(`Site: ${project.domain}`);
  lines.push("");
  lines.push("Key Metrics");
  for (const item of comparisons) {
    lines.push(
      `- ${item.metricKey}: ${(item.value * 100).toFixed(2)}% vs benchmark ${(item.target * 100).toFixed(2)}%`
    );
  }
  lines.push("");
  lines.push("Worst Landing Pages");
  for (const row of worstRows.slice(0, 5)) {
    lines.push(`- ${row.dimensionValue}: pdp reach ${(row.metrics.pdp_reach_rate * 100).toFixed(2)}%`);
  }
  lines.push("");
  lines.push("Findings");
  if (findings.length === 0) {
    lines.push("- No critical bottleneck detected.");
  } else {
    for (const finding of findings.slice(0, 5)) {
      lines.push(`- ${finding.title} [${finding.severity}]`);
    }
  }
  lines.push("");
  lines.push("Recommendations");
  for (const rec of recommendations.slice(0, 5)) {
    lines.push(`- ${rec.title}`);
    for (const step of rec.actionSteps.slice(0, 3)) {
      lines.push(`  * ${step}`);
    }
  }
  return lines;
}

const METRIC_LABEL_MAP = {
  bounce_rate: "直帰率", pdp_reach_rate: "PDP到達率", add_to_cart_rate: "カート追加率",
  cart_abandon_rate: "カート離脱率", checkout_reach_rate: "チェックアウト到達率",
  purchase_rate: "購入完了率", cvr: "CVR"
};
const SEVERITY_LABEL_MAP = { critical: "重大", high: "高", medium: "中", low: "低" };

function buildReportHtml(lines, project, from, to, comparisons, worstRows, findings, recommendations) {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmtPctReport = (v) => v != null ? `${(Number(v) * 100).toFixed(2)}%` : "-";

  const severityColor = { critical: "#e03137", high: "#f59e0b", medium: "#3b82f6", low: "#6b7280" };

  // Key Metrics rows
  const metricsHtml = (comparisons || []).map((item) => {
    const pct = (item.value * 100).toFixed(2);
    const bm = (item.target * 100).toFixed(2);
    const isGood = item.badWhen === "higher" ? item.value <= item.target : item.value >= item.target;
    const color = isGood ? "#047857" : "#b91c1c";
    const label = METRIC_LABEL_MAP[item.metricKey] || item.metricKey;
    const barWidth = Math.min(100, (item.value / Math.max(item.target, item.value)) * 100).toFixed(1);
    return `
      <tr>
        <td>${esc(label)}</td>
        <td style="text-align:right;font-weight:700;color:${color};">${esc(pct)}%</td>
        <td style="text-align:right;color:#64748b;">${esc(bm)}%</td>
        <td style="color:${color};text-align:center;">${isGood ? "✓" : "✗"}</td>
      </tr>`;
  }).join("");

  // Worst landing pages
  const worstHtml = (worstRows || []).slice(0, 5).map((row) => `
    <tr>
      <td style="font-family:monospace;font-size:12px;">${esc(row.dimensionValue)}</td>
      <td style="text-align:right;">${esc(fmtPctReport(row.metrics?.pdp_reach_rate))}</td>
      <td style="text-align:right;">${esc(fmtPctReport(row.metrics?.add_to_cart_rate))}</td>
      <td style="text-align:right;">${esc(fmtPctReport(row.metrics?.cvr))}</td>
    </tr>`).join("");

  // Findings
  const findingsHtml = (!findings || findings.length === 0)
    ? `<p style="color:#64748b;">ボトルネックは検出されませんでした。</p>`
    : (findings || []).slice(0, 5).map((f) => {
        const col = severityColor[f.severity] || "#64748b";
        const sevLabel = SEVERITY_LABEL_MAP[f.severity] || f.severity;
        return `
          <div style="border-left:4px solid ${col};padding:10px 14px;margin-bottom:10px;background:#fafafa;border-radius:0 6px 6px 0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <strong>${esc(f.title)}</strong>
              <span style="font-size:11px;background:${col};color:#fff;padding:2px 8px;border-radius:999px;">${esc(sevLabel)}</span>
            </div>
            <div style="font-size:12px;color:#475569;">${esc(f.reason || "")}</div>
            ${f.value != null ? `<div style="font-size:12px;color:#94a3b8;margin-top:4px;">実測値: ${esc(fmtPctReport(f.value))} / 基準: ${esc(fmtPctReport(f.benchmark))}</div>` : ""}
          </div>`;
      }).join("");

  // Recommendations
  const recsHtml = (recommendations || []).slice(0, 5).map((rec) => `
    <div style="border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:12px;">
      <div style="font-weight:700;margin-bottom:8px;">${esc(rec.title)}</div>
      <ul style="margin:0;padding-left:18px;">
        ${(rec.actionSteps || []).slice(0, 4).map((step) => `<li style="font-size:13px;color:#475569;margin-bottom:4px;">${esc(step)}</li>`).join("")}
      </ul>
    </div>`).join("");

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Veltio CVR レポート — ${esc(project?.name || "")} (${esc(from)}〜${esc(to)})</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
  *{box-sizing:border-box;}
  body{font-family:'Noto Sans JP','Hiragino Sans','Yu Gothic',Meiryo,sans-serif;max-width:860px;margin:0 auto;padding:36px 24px 60px;color:#0f172a;font-size:13.5px;line-height:1.8;background:#fff;}
  .report-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0a58ca;padding-bottom:16px;margin-bottom:32px;}
  .report-title{font-size:22px;font-weight:800;color:#0b1320;margin:0 0 4px;}
  .report-meta{font-size:12px;color:#64748b;}
  .report-badge{background:#0a58ca;color:#fff;font-size:11px;font-weight:700;padding:4px 12px;border-radius:999px;}
  h2{font-size:14px;font-weight:700;color:#0b1320;margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid #e2e8f0;text-transform:uppercase;letter-spacing:.08em;}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  th{background:#f8fafc;text-align:left;padding:8px 12px;font-weight:700;font-size:12px;color:#475569;border-bottom:2px solid #e2e8f0;}
  td{padding:8px 12px;border-bottom:1px solid #f1f5f9;vertical-align:middle;}
  .no-print{margin-bottom:20px;padding:12px 16px;background:#f0f7ff;border-radius:8px;font-size:12px;color:#0a58ca;display:flex;align-items:center;gap:10px;}
  @media print{
    .no-print{display:none!important;}
    body{padding:16px;font-size:12px;}
    h2{margin-top:20px;}
  }
</style>
</head>
<body>
<div class="no-print">
  💡 印刷 → PDF保存 でPDFファイルにできます。
  <button onclick="window.print()" style="background:#0a58ca;color:#fff;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer;">印刷 / PDF保存</button>
</div>
<div class="report-header">
  <div>
    <div class="report-title">CVR分析レポート</div>
    <div class="report-meta">
      プロジェクト: ${esc(project?.name || "-")} &nbsp;|&nbsp;
      ドメイン: ${esc(project?.domain || "-")} &nbsp;|&nbsp;
      期間: ${esc(from)} 〜 ${esc(to)}
    </div>
  </div>
  <span class="report-badge">Veltio</span>
</div>

<h2>主要KPI指標</h2>
<table>
  <thead><tr><th>指標</th><th style="text-align:right;">実測値</th><th style="text-align:right;">基準値</th><th style="text-align:center;">判定</th></tr></thead>
  <tbody>${metricsHtml}</tbody>
</table>

<h2>流入ページ別パフォーマンス（下位）</h2>
${worstHtml ? `<table>
  <thead><tr><th>ページ</th><th style="text-align:right;">PDP到達率</th><th style="text-align:right;">カート追加率</th><th style="text-align:right;">CVR</th></tr></thead>
  <tbody>${worstHtml}</tbody>
</table>` : "<p style='color:#64748b;'>データなし</p>"}

<h2>診断結果 — ボトルネック</h2>
${findingsHtml}

<h2>改善提案</h2>
${recsHtml || "<p style='color:#64748b;'>提案なし</p>"}

<div style="margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;">
  Generated by Veltio — ${new Date().toLocaleDateString("ja-JP")}
</div>
</body>
</html>`;
  return Buffer.from(html, "utf8");
}

function buildSimplePptOutline(lines) {
  const text = lines.join("\r\n");
  const bom = Buffer.from([0xff, 0xfe]);
  const body = Buffer.from(text, "utf16le");
  return Buffer.concat([bom, body]);
}

function groupedBreakdown(rows, dimension) {
  const map = new Map();
  for (const row of rows) {
    const key =
      dimension === "channel"
        ? row.channel
        : dimension === "device"
          ? row.device
          : row.landingPage;

    const current =
      map.get(key) || {
        dimension,
        dimensionValue: key,
        sessions: 0,
        engagedSessions: 0,
        pdpSessions: 0,
        addToCartSessions: 0,
        cartReachSessions: 0,
        checkoutSessions: 0,
        purchaseSessions: 0,
        revenue: 0
      };

    current.sessions += row.sessions;
    current.engagedSessions += row.engagedSessions;
    current.pdpSessions += row.pdpSessions;
    current.addToCartSessions += row.addToCartSessions;
    current.cartReachSessions += row.cartReachSessions;
    current.checkoutSessions += row.checkoutSessions;
    current.purchaseSessions += row.purchaseSessions;
    current.revenue += row.revenue;
    map.set(key, current);
  }

  return [...map.values()].map((item) => ({ ...item, metrics: computeRates(item) }));
}

function journeyStepRows(agg) {
  return [
    { key: "sessions", label: "訪問", value: agg.sessions },
    { key: "pdp", label: "PDP閲覧", value: agg.pdpSessions },
    { key: "add_to_cart", label: "カート追加", value: agg.addToCartSessions },
    { key: "checkout", label: "チェックアウト開始", value: agg.checkoutSessions },
    { key: "purchase", label: "購入完了", value: agg.purchaseSessions }
  ];
}

function journeyDropoffs(steps) {
  const out = [];
  for (let i = 1; i < steps.length; i += 1) {
    const prev = steps[i - 1];
    const curr = steps[i];
    const dropped = Math.max(0, prev.value - curr.value);
    out.push({
      from: prev.key,
      to: curr.key,
      fromLabel: prev.label,
      toLabel: curr.label,
      dropCount: dropped,
      dropRate: safeDivide(dropped, prev.value),
      passRate: safeDivide(curr.value, prev.value)
    });
  }
  return out;
}

function topDropoffSegments(rows, dimension, limit = 3) {
  const grouped = groupedBreakdown(rows, dimension);
  const scored = grouped.map((item) => {
    const dropRatio = safeDivide(item.sessions - item.purchaseSessions, item.sessions);
    const weightedScore = dropRatio * Math.log10(Math.max(10, item.sessions));
    return {
      dimensionValue: item.dimensionValue,
      sessions: item.sessions,
      purchaseSessions: item.purchaseSessions,
      dropRatio,
      weightedScore
    };
  });
  return scored.sort((a, b) => b.weightedScore - a.weightedScore).slice(0, limit);
}

function metricLabel(metricKey) {
  return {
    sessions: "Sessions",
    bounce_rate: "直帰率",
    pdp_reach_rate: "PDP到達率",
    add_to_cart_rate: "カート追加率",
    cart_abandon_rate: "カート離脱率",
    checkout_reach_rate: "checkout到達率",
    purchase_rate: "購入完了率"
  }[metricKey] || metricKey;
}

function pctText(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function metricFromMessage(message) {
  const text = String(message || "").toLowerCase();
  if (text.includes("直帰") || text.includes("bounce")) return "bounce_rate";
  if (text.includes("pdp") || text.includes("商品詳細")) return "pdp_reach_rate";
  if (text.includes("カート追加") || text.includes("add")) return "add_to_cart_rate";
  if (text.includes("カート離脱") || text.includes("カゴ落ち")) return "cart_abandon_rate";
  if (text.includes("checkout") || text.includes("チェックアウト")) return "checkout_reach_rate";
  if (text.includes("購入") || text.includes("purchase")) return "purchase_rate";
  return null;
}

function topRecommendationLines(recommendations, limit = 3) {
  return recommendations.slice(0, limit).map((item, index) => {
    const firstStep = Array.isArray(item.actionSteps) && item.actionSteps[0] ? ` / まずは ${item.actionSteps[0]}` : "";
    return `${index + 1}. ${item.title}${firstStep}`;
  });
}

function metricDeltaText(current, previous, metricKey) {
  if (!current || !previous) return null;
  const delta = (current[metricKey] || 0) - (previous[metricKey] || 0);
  if (!Number.isFinite(delta)) return null;
  const sign = delta > 0 ? "+" : "";
  return `${metricLabel(metricKey)} ${sign}${(delta * 100).toFixed(2)}pt`;
}

function summarizeActionLogProgress(currentEntry, previousEntry) {
  if (!currentEntry?.metrics || !previousEntry?.metrics) {
    return "初回ログのため、次回以降に改善差分を自動コメントします。";
  }
  const parts = [
    metricDeltaText(currentEntry.metrics, previousEntry.metrics, "bounce_rate"),
    metricDeltaText(currentEntry.metrics, previousEntry.metrics, "add_to_cart_rate"),
    metricDeltaText(currentEntry.metrics, previousEntry.metrics, "purchase_rate")
  ].filter(Boolean);
  const diag = currentEntry.linkedDiagnosisTitle ? ` / 紐づけ診断: ${currentEntry.linkedDiagnosisTitle}` : "";
  return parts.length ? `${parts.join(" / ")}${diag}` : `数値差分を算出できませんでした${diag}`;
}

function metricsForWindow(db, projectId, from, days) {
  if (!from || !validateDate(from)) return null;
  const to = shiftDate(from, days - 1);
  const rows = selectRowsForPeriod(db, projectId, from, to);
  if (!rows.length) return null;
  return {
    from,
    to,
    metrics: computeRates(aggregateMetricRows(rows))
  };
}

function shiftDate(iso, days) {
  const date = parseIsoDate(iso);
  return isoDateOnly(new Date(date.getTime() + days * ONE_DAY_MS));
}

function shiftYear(iso, years) {
  const date = parseIsoDate(iso);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return isoDateOnly(date);
}

function statusLabel(status) {
  return {
    todo: "未着手",
    doing: "進行中",
    done: "完了"
  }[status] || status;
}

function priorityLabel(priority) {
  return {
    high: "高",
    medium: "中",
    low: "低"
  }[priority] || priority;
}

function priorityRank(priority) {
  return { low: 0, medium: 1, high: 2 }[priority] ?? 1;
}

function priorityFromRank(rank) {
  return rank <= 0 ? "low" : rank >= 2 ? "high" : "medium";
}

// Build group-level effect measurement when all tasks sharing a targetMetricKey are done
function buildGroupMeasurements(db, projectId, actionLogHistory) {
  const groups = {};
  for (const item of actionLogHistory) {
    if (!item.targetMetricKey) continue;
    if (!groups[item.targetMetricKey]) groups[item.targetMetricKey] = [];
    groups[item.targetMetricKey].push(item);
  }
  const results = [];
  for (const [metricKey, tasks] of Object.entries(groups)) {
    if (!tasks.length) continue;
    const allDone = tasks.every((t) => (t.status || "todo") === "done");
    if (!allDone) continue;
    // Baseline: oldest-created task's pre-task metrics snapshot
    const sorted = tasks.slice().sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    const baselineMetrics = sorted[0].metrics;
    // Measurement window starts from the date the LAST task was completed
    const completedDates = tasks.map((t) => t.completedAtDate).filter(Boolean).sort();
    const lastCompletedDate = completedDates[completedDates.length - 1] || null;
    const firstCompletedDate = completedDates[0] || null;
    if (!lastCompletedDate || !baselineMetrics) continue;
    const evaluations = [7, 14, 30].map((days) => {
      const win = metricsForWindow(db, projectId, lastCompletedDate, days);
      if (!win) return { days, available: false, comment: "十分なデータがまだありません。" };
      const deltas = [metricKey, "bounce_rate", "add_to_cart_rate", "purchase_rate"]
        .filter((k, i, arr) => arr.indexOf(k) === i) // dedupe
        .map((k) => metricDeltaText(win.metrics, baselineMetrics, k))
        .filter(Boolean);
      return { days, available: true, from: win.from, to: win.to, metrics: win.metrics,
        comment: deltas.join(" / ") || "差分を算出できませんでした。" };
    });
    results.push({
      metricKey,
      taskCount: tasks.length,
      taskIds: tasks.map((t) => t.id),
      lastCompletedDate,
      firstCompletedDate,
      baselineMetrics,
      evaluations,
      tasks: tasks.map((t) => ({ id: t.id, content: t.content, completedAtDate: t.completedAtDate }))
    });
  }
  return results;
}

function buildEvaluationWindows(db, projectId, entry) {
  const start = entry.completedAtDate || entry.monitorStartDate || (entry.createdAt ? entry.createdAt.slice(0, 10) : null);
  if (!start) return [];
  return [7, 14, 30].map((days) => {
    const window = metricsForWindow(db, projectId, start, days);
    if (!window || !entry.metrics) {
      return {
        days,
        available: false,
        comment: "十分なデータがまだありません。"
      };
    }
    const bounceDelta = metricDeltaText(window.metrics, entry.metrics, "bounce_rate");
    const addDelta = metricDeltaText(window.metrics, entry.metrics, "add_to_cart_rate");
    const purchaseDelta = metricDeltaText(window.metrics, entry.metrics, "purchase_rate");
    return {
      days,
      available: true,
      from: window.from,
      to: window.to,
      metrics: window.metrics,
      comment: [bounceDelta, addDelta, purchaseDelta].filter(Boolean).join(" / ") || "差分を算出できませんでした。"
    };
  });
}

function buildAssistantAnswer(db, project, options) {
  const { from, to, compareFrom, compareTo, message, dimension } = options;
  const rows = selectRowsForPeriod(db, project.id, from, to);
  if (!rows.length) {
    return {
      answer: `指定期間 ${from} 〜 ${to} のデータがありません。先にGA4連携を完了し、対象期間を見直してください。`,
      references: []
    };
  }

  const agg = aggregateMetricRows(rows);
  const rates = computeRates(agg);
  const comparisons = buildMetricComparisons(db, rates, project);
  const breakdownDimension = ["channel", "device", "landing_page"].includes(dimension) ? dimension : "channel";
  const breakdownRows = groupedBreakdown(rows, breakdownDimension).sort((a, b) => b.sessions - a.sessions);
  const context = db.projectContexts.find((item) => item.projectId === project.id) || null;
  const diagnosis = runDiagnosisFromAggregate(db, agg, {
    channel: groupedBreakdown(rows, "channel"),
    device: groupedBreakdown(rows, "device"),
    landing_page: groupedBreakdown(rows, "landing_page")
  }, project);
  const recommendations = pickTemplates(db, diagnosis.findings, project.id);
  const requestedMetric = metricFromMessage(message);
  const text = String(message || "").toLowerCase();
  const lines = [];
  const references = [];

  lines.push(`対象: ${project.name} / ${from} 〜 ${to}`);
  const recentCompanyNotes = (context?.companyNoteHistory || []).slice(-2).reverse();
  const recentActionLogs = (context?.actionLogHistory || [])
    .map((item) => {
      const enriched = {
        ...item,
        evaluations: buildEvaluationWindows(db, project.id, item)
      };
      enriched.effectiveness = evaluateActionEffectiveness(enriched);
      return enriched;
    })
    .slice(-2)
    .reverse();
  if (recentCompanyNotes.length || recentActionLogs.length) {
    lines.push("根拠メモ:");
    recentCompanyNotes.forEach((item) => {
      lines.push(`- 企業メモ(${item.createdAt.slice(0, 10)}): ${item.content}`);
      references.push({
        type: "company_note",
        title: `企業メモ ${item.createdAt.slice(0, 10)}`,
        body: item.content
      });
    });
    recentActionLogs.forEach((item) => {
      lines.push(`- 施策ログ(${item.createdAt.slice(0, 10)}): ${item.content}`);
      if (item.autoComment) {
        lines.push(`  変化: ${item.autoComment}`);
      }
      if (item.effectiveness) {
        lines.push(`  効果判定: ${item.effectiveness.label} / 優先度見直し: ${priorityLabel(item.effectiveness.effectivePriority)}`);
      }
      references.push({
        type: "action_log",
        title: `施策ログ ${item.createdAt.slice(0, 10)}`,
        body: `${item.content}${item.autoComment ? ` / ${item.autoComment}` : ""}${item.effectiveness ? ` / 効果判定: ${item.effectiveness.label}` : ""}`
      });
    });
  } else {
    if (context?.companyNote) lines.push(`企業メモ: ${context.companyNote}`);
    if (context?.actionLog) lines.push(`施策ログ: ${context.actionLog}`);
  }

  if (requestedMetric) {
    const metricItem = comparisons.find((item) => item.metricKey === requestedMetric);
    if (metricItem) {
      lines.push(
        `${metricLabel(metricItem.metricKey)} は ${pctText(metricItem.value)} です。基準 ${pctText(metricItem.target)} に対して ${
          metricItem.status === "ok" ? "基準内" : `${(Math.abs(metricItem.gap) * 100).toFixed(2)}pt の改善余地`
        } があります。`
      );
    }
    const metricFinding = diagnosis.findings.find((item) => item.metricKey === requestedMetric);
    if (metricFinding) {
      lines.push(`診断: ${metricFinding.title}。${metricFinding.reason}`);
      if (metricFinding.worstHint) {
        lines.push(
          `悪化箇所: ${metricFinding.worstHint.dimension} の ${metricFinding.worstHint.dimensionValue} が目立って悪化しています。`
        );
      }
    }
    const related = recommendations.filter((item) => item.metricKey === requestedMetric);
    if (related.length) {
      lines.push("優先施策:");
      lines.push(...topRecommendationLines(related, 2));
    }
  } else if (text.includes("比較") && compareFrom && compareTo) {
    const compareRows = selectRowsForPeriod(db, project.id, compareFrom, compareTo);
    const compareAgg = aggregateMetricRows(compareRows);
    const compareRates = computeRates(compareAgg);
    lines.push(`比較対象: ${compareFrom} 〜 ${compareTo}`);
    lines.push(
      `Sessions は ${agg.sessions}（比較差 ${agg.sessions - compareAgg.sessions >= 0 ? "+" : ""}${agg.sessions - compareAgg.sessions}）です。`
    );
    lines.push(
      `直帰率は ${pctText(rates.bounce_rate)}（比較差 ${((rates.bounce_rate - compareRates.bounce_rate) * 100).toFixed(2)}pt）、購入完了率は ${pctText(rates.purchase_rate)}（比較差 ${((rates.purchase_rate - compareRates.purchase_rate) * 100).toFixed(2)}pt）です。`
    );
  } else if (text.includes("チャネル") || text.includes("device") || text.includes("lp") || text.includes("landing")) {
    const worstMetricKey = diagnosis.findings[0]?.metricKey || "pdp_reach_rate";
    const sorted = [...breakdownRows].sort((a, b) => b.sessions - a.sessions);
    const largest = sorted[0];
    const weakest = [...breakdownRows].sort((a, b) => {
      if (metricBadWhen(worstMetricKey, db) === "higher") {
        return (b.metrics[worstMetricKey] || 0) - (a.metrics[worstMetricKey] || 0);
      }
      return (a.metrics[worstMetricKey] || 0) - (b.metrics[worstMetricKey] || 0);
    })[0];
    if (largest) {
      lines.push(`最多流入の ${breakdownDimension} は ${largest.dimensionValue} で、Sessions は ${largest.sessions} です。`);
    }
    if (weakest) {
      lines.push(
        `最も注意すべき ${breakdownDimension} は ${weakest.dimensionValue} で、${metricLabel(worstMetricKey)} が ${pctText(
          weakest.metrics[worstMetricKey]
        )} です。`
      );
    }
  } else {
    const topFinding = diagnosis.findings[0];
    if (topFinding) {
      lines.push(`最大ボトルネックは「${topFinding.title}」です。${topFinding.reason}`);
      if (topFinding.worstHint) {
        lines.push(`特に ${topFinding.worstHint.dimension} の ${topFinding.worstHint.dimensionValue} から優先して確認してください。`);
      }
    } else {
      lines.push("現時点で重大なボトルネックは検出されていません。");
    }
    lines.push(
      `主要値: 直帰率 ${pctText(rates.bounce_rate)} / PDP到達率 ${pctText(rates.pdp_reach_rate)} / カート追加率 ${pctText(
        rates.add_to_cart_rate
      )} / 購入完了率 ${pctText(rates.purchase_rate)}`
    );
    if (recommendations.length) {
      lines.push("推奨施策:");
      lines.push(...topRecommendationLines(recommendations, 3));
    }
  }

  lines.push("追加で、直帰率・チャネル別・比較差分など具体的に聞けば、その観点で絞って返答できます。");
  return {
    answer: lines.join("\n"),
    references
  };
}

function evaluateActionEffectiveness(entry) {
  const evaluations = entry.evaluations || [];
  const latest = [...evaluations].reverse().find((item) => item.available && item.metrics);
  const basePriority = entry.priority || "medium";
  if (!latest || !entry.metrics) {
    return {
      code: "pending",
      label: "判定保留",
      effectivePriority: basePriority,
      comment: "完了後の十分な観測期間がまだありません。"
    };
  }
  const bounceDelta = (latest.metrics.bounce_rate || 0) - (entry.metrics.bounce_rate || 0);
  const addDelta = (latest.metrics.add_to_cart_rate || 0) - (entry.metrics.add_to_cart_rate || 0);
  const purchaseDelta = (latest.metrics.purchase_rate || 0) - (entry.metrics.purchase_rate || 0);
  const score = (-bounceDelta * 100) + (addDelta * 100) + (purchaseDelta * 140);
  let code = "neutral";
  let label = "変化限定";
  let nextRank = priorityRank(basePriority);
  if (score >= 1.2) {
    code = "effective";
    label = "効果あり";
    nextRank -= 1;
  } else if (score <= -1.2) {
    code = "ineffective";
    label = "効果弱い";
    nextRank = 2;
  }
  return {
    code,
    label,
    effectivePriority: priorityFromRank(nextRank),
    comment: `最新観測(${latest.days}日後): ${latest.comment}`
  };
}

function campaignImpactSummary(db, projectId, campaign) {
  const currentRows = selectRowsForPeriod(db, projectId, campaign.startDate, campaign.endDate);
  const currentAgg = aggregateMetricRows(currentRows);
  const currentMetrics = computeRates(currentAgg);
  const currentBlock = { totals: currentAgg, metrics: currentMetrics };
  const durationDays = Math.max(1, dayList(campaign.startDate, campaign.endDate).length);
  // 比較期間：カスタム指定があればそちらを使用、なければ直前同期間
  let baselineStart, baselineEnd;
  if (campaign.customCompareStart && campaign.customCompareEnd && validateDate(campaign.customCompareStart) && validateDate(campaign.customCompareEnd)) {
    baselineStart = campaign.customCompareStart;
    baselineEnd = campaign.customCompareEnd;
  } else {
    baselineEnd = shiftDate(campaign.startDate, -1);
    baselineStart = shiftDate(baselineEnd, -(durationDays - 1));
  }
  const baselineRows = selectRowsForPeriod(db, projectId, baselineStart, baselineEnd);
  const baselineAgg = aggregateMetricRows(baselineRows);
  const baselineMetrics = computeRates(baselineAgg);
  const baselineBlock = { totals: baselineAgg, metrics: baselineMetrics };

  let yearly = null;
  let linkedPreviousCampaignId = null;
  let linkedPreviousCampaignName = null;
  if (campaign.recurringAnnual) {
    const previousRegistered = (db.projects.find((item) => item.id === projectId)?.campaigns || [])
      .filter((item) => item.id !== campaign.id && item.name === campaign.name && item.type === campaign.type && item.startDate < campaign.startDate)
      .sort((a, b) => b.startDate.localeCompare(a.startDate))[0] || null;

    if (previousRegistered) {
      linkedPreviousCampaignId = previousRegistered.id;
      linkedPreviousCampaignName = previousRegistered.name;
      const yearRows = selectRowsForPeriod(db, projectId, previousRegistered.startDate, previousRegistered.endDate);
      const yearAgg = aggregateMetricRows(yearRows);
      const yearMetrics = computeRates(yearAgg);
      yearly = {
        from: previousRegistered.startDate,
        to: previousRegistered.endDate,
        totals: yearAgg,
        metrics: yearMetrics
      };
    } else {
      const yearStart = shiftYear(campaign.startDate, -1);
      const yearEnd = shiftYear(campaign.endDate, -1);
      const yearRows = selectRowsForPeriod(db, projectId, yearStart, yearEnd);
      const yearAgg = aggregateMetricRows(yearRows);
      const yearMetrics = computeRates(yearAgg);
      yearly = {
        from: yearStart,
        to: yearEnd,
        totals: yearAgg,
        metrics: yearMetrics
      };
    }
  }

  // Daily sparkline series
  const dailySeries = currentRows
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => {
      const dayAgg = {
        sessions: row.sessions || 0,
        engagedSessions: row.engagedSessions || 0,
        pdpSessions: row.pdpSessions || 0,
        addToCartSessions: row.addToCartSessions || 0,
        cartReachSessions: row.cartReachSessions || 0,
        checkoutSessions: row.checkoutSessions || 0,
        purchaseSessions: row.purchaseSessions || 0,
        revenue: row.revenue || 0
      };
      const dayRates = computeRates(dayAgg);
      return { date: row.date, sessions: dayAgg.sessions, cvr: dayRates.cvr || 0, revenue: dayAgg.revenue };
    });

  return {
    current: {
      from: campaign.startDate,
      to: campaign.endDate,
      totals: currentAgg,
      metrics: currentMetrics
    },
    baseline: {
      from: baselineStart,
      to: baselineEnd,
      totals: baselineAgg,
      metrics: baselineMetrics
    },
    yearly,
    dailySeries,
    linkedPreviousCampaignId,
    linkedPreviousCampaignName,
    delta: {
      cvr: currentMetrics.cvr - baselineMetrics.cvr,
      sessions: currentAgg.sessions - baselineAgg.sessions,
      add_to_cart_rate: currentMetrics.add_to_cart_rate - baselineMetrics.add_to_cart_rate,
      purchase_rate: currentMetrics.purchase_rate - baselineMetrics.purchase_rate
    }
  };
}

function reprioritizedTemplateScore(template, context) {
  const base = template.impactScore / Math.max(template.easeScore, 1);
  if (!context?.actionLogHistory?.length) return base;
  const related = context.actionLogHistory
    .filter((item) => item.linkedMetricKey === template.metricKey)
    .map((item) => ({
      ...item,
      evaluations: item.evaluations || [],
      effectiveness: item.effectiveness || evaluateActionEffectiveness(item)
    }));
  if (!related.length) return base;
  const latest = [...related].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const priorityBoost = priorityRank(latest.effectiveness?.effectivePriority || latest.priority || "medium") * 0.35;
  const effectivenessPenalty =
    latest.effectiveness?.code === "effective"
      ? -0.6
      : latest.effectiveness?.code === "ineffective"
        ? 0.8
        : latest.effectiveness?.code === "pending"
          ? 0.2
          : 0;
  return base + priorityBoost + effectivenessPenalty;
}

async function serveStatic(req, res, urlObj) {
  let reqPath = urlObj.pathname;

  // Root → /ja/
  if (reqPath === "/") {
    res.writeHead(302, { "Location": "/ja/" });
    res.end();
    return;
  }

  // 301 redirects for old root-level URLs → /ja/
  const jaRedirects = {
    "/privacy": "/ja/privacy",
    "/privacy.html": "/ja/privacy",
    "/terms": "/ja/terms",
    "/terms.html": "/ja/terms",
    "/tokusho": "/ja/tokusho",
    "/tokusho.html": "/ja/tokusho",
    "/contact": "/ja/contact",
    "/contact.html": "/ja/contact",
    "/articles": "/ja/articles",
    "/articles.html": "/ja/articles",
  };
  if (jaRedirects[reqPath]) {
    res.writeHead(301, { "Location": jaRedirects[reqPath] });
    res.end();
    return;
  }

  // /ja/ directory index
  if (reqPath === "/ja" || reqPath === "/ja/") reqPath = "/ja/index.html";

  // 301 redirects: old app URLs → /app/* (permanent, SEO-safe)
  const appRedirects = {
    "/dashboard":  "/app/dashboard",
    "/analytics":  "/app/dashboard",
    "/experiments":"/app/experiments",
    "/account":    "/app/account",
    "/agent":      "/app/agent",
    "/admin":      "/app/admin",
  };
  if (appRedirects[reqPath]) {
    res.writeHead(301, { "Location": appRedirects[reqPath] });
    res.end();
    return;
  }

  // /app/* → analytics.html
  if (reqPath === "/app" || reqPath === "/app/") { res.writeHead(302, { "Location": "/app/dashboard" }); res.end(); return; }
  if (reqPath === "/app/login"   || reqPath.startsWith("/app/login/"))   reqPath = "/analytics.html";
  if (reqPath === "/app/signin"  || reqPath.startsWith("/app/signin/"))  reqPath = "/analytics.html";
  if (reqPath === "/app/dashboard"   || reqPath.startsWith("/app/dashboard/"))   reqPath = "/analytics.html";
  if (reqPath === "/app/experiments" || reqPath.startsWith("/app/experiments/")) reqPath = "/analytics.html";
  if (reqPath === "/app/account"     || reqPath.startsWith("/app/account/"))     reqPath = "/analytics.html";
  if (reqPath === "/app/agent"       || reqPath.startsWith("/app/agent/"))       reqPath = "/analytics.html";
  if (reqPath === "/app/admin"       || reqPath.startsWith("/app/admin/"))       reqPath = "/analytics.html";

  // Legacy root-level login/signin (keep working)
  if (reqPath === "/login"  || reqPath.startsWith("/login/"))  reqPath = "/analytics.html";
  if (reqPath === "/signin" || reqPath.startsWith("/signin/")) reqPath = "/analytics.html";
  if (reqPath.endsWith("/")) reqPath = `${reqPath}index.html`;
  if (!path.extname(reqPath)) reqPath = `${reqPath}.html`;
  const fsPath = path.join(PUBLIC_DIR, reqPath);

  if (!fsPath.startsWith(PUBLIC_DIR)) {
    notFound(res);
    return;
  }

  try {
    const content = await fs.readFile(fsPath);
    const ext = path.extname(fsPath).toLowerCase();
    const contentType =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".css"
          ? "text/css; charset=utf-8"
          : ext === ".js"
            ? "application/javascript; charset=utf-8"
            : ext === ".svg"
              ? "image/svg+xml"
            : "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    notFound(res);
  }
}

async function handleApi(req, res, urlObj) {
  const db = await readDb();

  const requireAuth = () => {
    const user = currentUser(db, req);
    if (!user) {
      json(res, 401, { error: "unauthorized" });
      return null;
    }
    return user;
  };

  if (req.method === "POST" && urlObj.pathname === "/api/track") {
    const body = await parseBody(req);
    const user = currentUser(db, req);
    const tenant = user ? primaryTenantForUser(db, user.id) : null;
    trackAppEvent(db, {
      eventType: String(body.eventType || "page_view"),
      userId: user?.id || null,
      tenantId: tenant?.id || null,
      projectId: body.projectId || null,
      anonymousId: String(body.anonymousId || "").trim().slice(0, 128) || null,
      meta: {
        path: String(body.path || "").slice(0, 512),
        page: String(body.page || "").slice(0, 64)
      }
    });
    await writeDb(db);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && urlObj.pathname === "/api/auth/signup") {
    const body = await parseBody(req);
    const { tenantName, email, password, displayName } = body;
    if (!tenantName || !email || !password || !displayName) {
      return json(res, 400, { error: "missing_fields" });
    }
    if (db.users.some((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
      return json(res, 409, { error: "email_exists" });
    }

    const tenant = ensureTenantDefaults({
      id: uid(),
      name: tenantName,
      accountName: tenantName,
      companyName: tenantName,
      contactName: displayName,
      jobTitle: "",
      plan: "starter",
      invitedUsers: [],
      createdAt: new Date().toISOString()
    });
    const user = {
      id: uid(),
      email,
      passwordHash: hashPassword(password),
      displayName,
      emailVerifiedAt: null,
      emailVerification: null,
      passwordReset: null,
      createdAt: new Date().toISOString()
    };
    const code = issueEmailVerification(user);

    let delivery;
    try {
      delivery = await sendVerificationEmail(user.email, code);
    } catch (err) {
      return json(res, 500, {
        error: "email_delivery_failed",
        message: "確認コードの送信に失敗しました。メール送信設定を確認してください。",
        detail: String(err.message || err)
      });
    }

    db.tenants.push(tenant);
    db.users.push(user);
    db.memberships.push({
      tenantId: tenant.id,
      userId: user.id,
      role: "owner",
      createdAt: new Date().toISOString()
    });
    trackAppEvent(db, { eventType: "tenant_signup", userId: user.id, tenantId: tenant.id });
    await writeDb(db);
    return json(res, 200, {
      requiresVerification: true,
      email: user.email,
      message: "確認コードを入力してメール認証を完了してください。",
      previewCode: delivery.previewCode
    });
  }

  if (req.method === "POST" && urlObj.pathname === "/api/auth/verify-email") {
    const body = await parseBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").trim();
    const user = db.users.find((u) => String(u.email || "").toLowerCase() === email);
    if (!user || !user.emailVerification) {
      return json(res, 400, { error: "invalid_verification_request" });
    }
    if (new Date(user.emailVerification.expiresAt).getTime() < Date.now()) {
      return json(res, 400, { error: "verification_expired", message: "確認コードの有効期限が切れています" });
    }
    if (user.emailVerification.codeHash !== verificationCodeHash(code)) {
      return json(res, 400, { error: "invalid_verification_code", message: "確認コードが一致しません" });
    }
    user.emailVerifiedAt = new Date().toISOString();
    user.emailVerification = null;
    const tenant = primaryTenantForUser(db, user.id);
    trackAppEvent(db, { eventType: "user_verified", userId: user.id, tenantId: tenant?.id || null });

    const sid = uid();
    db.sessions = db.sessions.filter((s) => !(s.userId === user.id && new Date(s.expiresAt).getTime() <= Date.now()));
    db.sessions.push({
      id: sid,
      userId: user.id,
      expiresAt: new Date(Date.now() + 30 * ONE_DAY_MS).toISOString()
    });
    await writeDb(db);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": `${SESSION_COOKIE_NAME}=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
    });
    return res.end(JSON.stringify({ user: { id: user.id, email: user.email, displayName: user.displayName } }));
  }

  if (req.method === "POST" && urlObj.pathname === "/api/auth/resend-verification") {
    const body = await parseBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const user = db.users.find((u) => String(u.email || "").toLowerCase() === email);
    if (!user) {
      return json(res, 404, { error: "user_not_found" });
    }
    if (user.emailVerifiedAt) {
      return json(res, 400, { error: "already_verified", message: "このメールは認証済みです" });
    }
    const code = issueEmailVerification(user);
    let delivery;
    try {
      delivery = await sendVerificationEmail(user.email, code);
    } catch (err) {
      return json(res, 500, {
        error: "email_delivery_failed",
        message: "確認コードの再送に失敗しました。メール送信設定を確認してください。",
        detail: String(err.message || err)
      });
    }
    await writeDb(db);
    return json(res, 200, {
      ok: true,
      message: "確認コードを再送しました。",
      previewCode: delivery.previewCode
    });
  }

  if (req.method === "POST" && urlObj.pathname === "/api/auth/forgot-password") {
    const body = await parseBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) {
      return json(res, 400, { error: "missing_email", message: "メールアドレスを入力してください。" });
    }
    const user = db.users.find((u) => String(u.email || "").toLowerCase() === email);
    if (!user || !user.emailVerifiedAt) {
      return json(res, 200, { ok: true, message: "再設定コードを送信しました。メールを確認してください。" });
    }

    const code = issuePasswordReset(user);
    let delivery;
    try {
      delivery = await sendPasswordResetEmail(user.email, code);
    } catch (err) {
      return json(res, 500, {
        error: "email_delivery_failed",
        message: "再設定コードの送信に失敗しました。メール送信設定を確認してください。",
        detail: String(err.message || err)
      });
    }
    await writeDb(db);
    return json(res, 200, {
      ok: true,
      message: "再設定コードを送信しました。メールを確認してください。",
      previewCode: delivery.previewCode
    });
  }

  if (req.method === "POST" && urlObj.pathname === "/api/auth/reset-password") {
    const body = await parseBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").trim();
    const newPassword = String(body.newPassword || "");
    if (!email || !code || !newPassword) {
      return json(res, 400, { error: "missing_fields", message: "メール・コード・新しいパスワードを入力してください。" });
    }
    if (newPassword.length < 8) {
      return json(res, 400, { error: "weak_password", message: "パスワードは8文字以上で入力してください。" });
    }
    const user = db.users.find((u) => String(u.email || "").toLowerCase() === email);
    if (!user || !user.passwordReset) {
      return json(res, 400, { error: "invalid_reset_request", message: "再設定コードが無効です。" });
    }
    if (new Date(user.passwordReset.expiresAt).getTime() < Date.now()) {
      return json(res, 400, { error: "reset_expired", message: "再設定コードの有効期限が切れています。" });
    }
    if (user.passwordReset.codeHash !== verificationCodeHash(code)) {
      return json(res, 400, { error: "invalid_reset_code", message: "再設定コードが一致しません。" });
    }

    user.passwordHash = hashPassword(newPassword);
    user.passwordReset = null;
    db.sessions = db.sessions.filter((s) => s.userId !== user.id);
    await writeDb(db);
    return json(res, 200, { ok: true, message: "パスワードを更新しました。ログインしてください。" });
  }

  if (req.method === "POST" && urlObj.pathname === "/api/auth/login") {
    const body = await parseBody(req);
    const { email, password } = body;
    const user = db.users.find((u) => u.email.toLowerCase() === String(email || "").toLowerCase());
    if (!user || !verifyPassword(password || "", user.passwordHash)) {
      return json(res, 401, { error: "invalid_credentials" });
    }
    if (!user.emailVerifiedAt) {
      return json(res, 403, {
        error: "email_not_verified",
        message: "メール認証が未完了です。確認コードを入力してください。"
      });
    }

    const sid = uid();
    // Keep existing sessions (allow concurrent sessions across devices/tabs)
    // Only remove expired sessions to keep the list clean
    db.sessions = db.sessions.filter((s) => !(s.userId === user.id && new Date(s.expiresAt).getTime() <= Date.now()));
    db.sessions.push({
      id: sid,
      userId: user.id,
      expiresAt: new Date(Date.now() + 30 * ONE_DAY_MS).toISOString()
    });
    const tenant = primaryTenantForUser(db, user.id);
    trackAppEvent(db, { eventType: "user_login", userId: user.id, tenantId: tenant?.id || null });
    await writeDb(db);

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": `${SESSION_COOKIE_NAME}=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
    });
    return res.end(JSON.stringify({ user: { id: user.id, email: user.email, displayName: user.displayName } }));
  }

  if (req.method === "POST" && urlObj.pathname === "/api/auth/logout") {
    const user = currentUser(db, req);
    if (user) {
      const sid = parseCookies(req)[SESSION_COOKIE_NAME];
      db.sessions = db.sessions.filter((s) => s.id !== sid);
      await writeDb(db);
    }
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method === "GET" && urlObj.pathname === "/api/auth/config") {
    return json(res, 200, authConfigPayload());
  }

  if (req.method === "GET" && urlObj.pathname === "/api/me") {
    const user = requireAuth();
    if (!user) return;
    const memberships = db.memberships.filter((m) => m.userId === user.id);
    const tenants = memberships
      .map((m) => {
        const tenant = db.tenants.find((t) => t.id === m.tenantId);
        if (!tenant) return null;
        ensureTenantDefaults(tenant);
        return { id: tenant.id, name: tenant.name, role: m.role, plan: tenant.plan };
      })
      .filter(Boolean);

    return json(res, 200, {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      tenants,
      isAdmin: isAdminUser(user)
    });
  }

  if (req.method === "GET" && urlObj.pathname === "/api/health") {
    return json(res, 200, {
      ok: true,
      service: "veltio",
      now: new Date().toISOString()
    });
  }

  if (req.method === "GET" && urlObj.pathname === "/api/demo") {
    const DEMO_PROJECT = { id: "demo", name: "デモショップ", domain: "https://demo.example.com", targetCvr: 0.025 };
    const DEMO_STAGE_RULES = { pdpEventName: "view_item", cartReachMode: "add_to_cart_or_begin_checkout" };
    const today = new Date();
    const toDate = today.toISOString().slice(0, 10);
    const fromDate = new Date(today.getTime() - 29 * 86400000).toISOString().slice(0, 10);
    const rows = [];
    for (let d = new Date(fromDate); d <= today; d = new Date(d.getTime() + 86400000)) {
      rows.push(...generateDailyMetrics(DEMO_PROJECT, DEMO_STAGE_RULES, d.toISOString().slice(0, 10)));
    }
    const agg = aggregateMetricRows(rows);
    const rates = computeRates(agg);
    const comparisons = buildMetricComparisons(db, rates, DEMO_PROJECT);
    const granularity = "day";
    const series = buildSeries(rows, granularity);
    const funnel = [
      { key: "sessions", label: "Sessions", value: agg.sessions },
      { key: "pdp", label: "PDP", value: agg.pdpSessions },
      { key: "add_to_cart", label: "Add to Cart", value: agg.addToCartSessions },
      { key: "cart_reach", label: "Cart Reach", value: agg.cartReachSessions },
      { key: "checkout", label: "Checkout", value: agg.checkoutSessions },
      { key: "purchase", label: "Purchase", value: agg.purchaseSessions }
    ];
    return json(res, 200, {
      projectId: "demo",
      from: fromDate,
      to: toDate,
      granularity,
      totals: agg,
      metrics: rates,
      comparisons,
      series,
      funnel,
      compare: null,
      isDemo: true
    });
  }

  if (req.method === "GET" && urlObj.pathname === "/api/account") {
    const user = requireAuth();
    if (!user) return;
    const tenant = primaryTenantForUser(db, user.id);
    if (!tenant) return json(res, 404, { error: "tenant_not_found" });
    const projectSites = db.projects
      .filter((p) => p.tenantId === tenant.id)
      .map((p) => ({ id: p.id, name: p.name, domain: p.domain }));

    // Monthly session count (current calendar month, all tenant projects)
    const tenantProjectIds = new Set(db.projects.filter((p) => p.tenantId === tenant.id).map((p) => p.id));
    const nowDate = new Date();
    const monthPrefix = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, "0")}`;
    const monthlySessionCount = (db.metricDaily || [])
      .filter((row) => tenantProjectIds.has(row.projectId) && String(row.date || "").startsWith(monthPrefix))
      .reduce((sum, row) => sum + (row.sessions || 0), 0);

    // Trial info
    const trialActive = isTrialActive(tenant);
    const trialEndsAt = tenant.trialEndsAt || null;
    const trialDaysLeft = trialActive
      ? Math.max(0, Math.ceil((new Date(trialEndsAt) - nowDate) / ONE_DAY_MS))
      : 0;

    // Effective plan (trial overrides to "business")
    const effectivePlan = trialActive ? "business" : (tenant.plan || "free");
    const planSessionLimit = PLAN_SESSION_LIMITS[effectivePlan] ?? PLAN_SESSION_LIMITS.free;

    return json(res, 200, {
      account: {
        id: tenant.id,
        accountName: tenant.accountName,
        companyName: tenant.companyName,
        contactName: tenant.contactName,
        jobTitle: tenant.jobTitle,
        plan: tenant.plan,
        effectivePlan,
        trialActive,
        trialEndsAt,
        trialDaysLeft,
        planSessionLimit,
        monthlySessionCount,
        stripeSubscriptionStatus: tenant.stripeSubscriptionStatus,
        invitedUsers: tenant.invitedUsers,
        projectSites
      }
    });
  }

  const requireAdmin = () => {
    // APIキー認証（レポート用）
    const apiKey = req.headers["x-admin-api-key"] || urlObj.searchParams.get("api_key");
    if (ADMIN_API_KEY && apiKey === ADMIN_API_KEY) {
      return { id: "api-key", email: "api-key", isApiKey: true };
    }
    const user = requireAuth();
    if (!user) return null;
    if (!isAdminUser(user)) {
      json(res, 403, { error: "forbidden", message: "管理者のみアクセスできます" });
      return null;
    }
    return user;
  };

  // 緊急ユーザー作成（ADMIN_API_KEY必須・メール認証スキップ）
  if (req.method === "POST" && urlObj.pathname === "/api/admin/create-user") {
    const apiKey = req.headers["x-admin-api-key"] || urlObj.searchParams.get("api_key");
    if (!ADMIN_API_KEY || apiKey !== ADMIN_API_KEY) {
      return json(res, 403, { error: "forbidden" });
    }
    const body = await parseBody(req);
    const { email, password, displayName, tenantName } = body;
    if (!email || !password || !displayName || !tenantName) {
      return json(res, 400, { error: "missing_fields", message: "email, password, displayName, tenantName が必要です" });
    }
    if (db.users.some((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
      return json(res, 409, { error: "email_exists" });
    }
    const tenant = ensureTenantDefaults({
      id: uid(), name: tenantName, accountName: tenantName,
      companyName: tenantName, contactName: displayName, jobTitle: "",
      plan: "starter", invitedUsers: [], createdAt: new Date().toISOString()
    });
    const user = {
      id: uid(), email, passwordHash: hashPassword(password),
      displayName, emailVerifiedAt: new Date().toISOString(),
      emailVerification: null, passwordReset: null, createdAt: new Date().toISOString()
    };
    db.tenants.push(tenant);
    db.users.push(user);
    db.memberships.push({ tenantId: tenant.id, userId: user.id, role: "owner", createdAt: new Date().toISOString() });
    await writeDb(db);
    return json(res, 200, { ok: true, userId: user.id, tenantId: tenant.id, email: user.email });
  }

  if (req.method === "GET" && urlObj.pathname === "/api/admin/overview") {
    const user = requireAdmin();
    if (!user) return;
    const range = adminRangeFromQuery(urlObj);
    if (!range) return json(res, 400, { error: "invalid_date_range" });
    const periodRows = db.metricDaily.filter((row) => row.date >= range.from && row.date <= range.to);
    const periodAgg = aggregateMetricRows(periodRows);
    const activeProjectIds = new Set(periodRows.filter((row) => row.sessions > 0).map((row) => row.projectId));
    const ga4Connected = new Set(db.ga4Connections.map((item) => item.projectId));
    const syncErrors = db.ga4Connections.filter((item) => item.lastSyncError).length;
    const newUsers = db.users.filter((item) => (item.createdAt || "").slice(0, 10) >= range.from && (item.createdAt || "").slice(0, 10) <= range.to).length;
    const newTenants = db.tenants.filter((item) => (item.createdAt || "").slice(0, 10) >= range.from && (item.createdAt || "").slice(0, 10) <= range.to).length;
    const newProjects = db.projects.filter((item) => (item.createdAt || "").slice(0, 10) >= range.from && (item.createdAt || "").slice(0, 10) <= range.to).length;
    const verifiedUsers = db.users.filter((item) => item.emailVerifiedAt).length;
    const emailVerificationRate = safeDivide(verifiedUsers, db.users.length);
    const ga4ConnectedRate = safeDivide(ga4Connected.size, db.projects.length);
    const cvr = safeDivide(periodAgg.purchaseSessions, periodAgg.sessions);
    return json(res, 200, {
      from: range.from,
      to: range.to,
      totalTenants: db.tenants.length,
      totalUsers: db.users.length,
      verifiedUsers,
      emailVerificationRate,
      totalProjects: db.projects.length,
      activeProjects7d: activeProjectIds.size,
      ga4ConnectedProjects: ga4Connected.size,
      ga4ConnectedRate,
      ga4SyncErrors: syncErrors,
      generatedReports: db.reportJobs.length,
      sessions: periodAgg.sessions,
      purchases: periodAgg.purchaseSessions,
      revenue: periodAgg.revenue,
      cvr,
      newUsers,
      newTenants,
      newProjects
    });
  }

  if (req.method === "GET" && urlObj.pathname === "/api/admin/tenants") {
    const user = requireAdmin();
    if (!user) return;
    const range = adminRangeFromQuery(urlObj);
    if (!range) return json(res, 400, { error: "invalid_date_range" });
    const search = String(urlObj.searchParams.get("q") || "").trim().toLowerCase();
    const periodRows = db.metricDaily.filter((row) => row.date >= range.from && row.date <= range.to);
    const rows = db.tenants.map((tenant) => {
      const memberships = db.memberships.filter((m) => m.tenantId === tenant.id);
      const projects = db.projects.filter((p) => p.tenantId === tenant.id);
      const projectIds = new Set(projects.map((p) => p.id));
      const ga4Rows = db.ga4Connections.filter((conn) => projectIds.has(conn.projectId));
      const agg = aggregateMetricRows(periodRows.filter((row) => projectIds.has(row.projectId)));
      const latestSync = ga4Rows
        .map((item) => item.lastSyncedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || null;
      return {
        id: tenant.id,
        accountName: tenant.accountName || tenant.name,
        companyName: tenant.companyName || tenant.name,
        plan: tenant.plan || "starter",
        users: memberships.length,
        projects: projects.length,
        ga4ConnectedProjects: ga4Rows.length,
        sessions: agg.sessions,
        purchases: agg.purchaseSessions,
        revenue: agg.revenue,
        cvr: safeDivide(agg.purchaseSessions, agg.sessions),
        latestSyncAt: latestSync,
        createdAt: tenant.createdAt || null
      };
    });
    const filtered = search
      ? rows.filter((row) => [row.accountName, row.companyName, row.plan].join(" ").toLowerCase().includes(search))
      : rows;
    filtered.sort((a, b) => (b.sessions - a.sessions) || (b.projects - a.projects) || (b.users - a.users));
    return json(res, 200, { from: range.from, to: range.to, q: search, rows: filtered });
  }

  if (req.method === "GET" && urlObj.pathname === "/api/admin/users") {
    const user = requireAdmin();
    if (!user) return;
    const search = String(urlObj.searchParams.get("q") || "").trim().toLowerCase();
    const now = Date.now();
    const rows = db.users.map((item) => {
      const memberships = db.memberships.filter((m) => m.userId === item.id);
      const tenantNames = memberships
        .map((m) => db.tenants.find((t) => t.id === m.tenantId)?.name)
        .filter(Boolean);
      const hasLiveSession = db.sessions.some((s) => s.userId === item.id && new Date(s.expiresAt).getTime() > now);
      return {
        id: item.id,
        email: item.email,
        displayName: item.displayName || "",
        verified: Boolean(item.emailVerifiedAt),
        activeSession: hasLiveSession,
        emailVerifiedAt: item.emailVerifiedAt || null,
        createdAt: item.createdAt || null,
        tenants: tenantNames
      };
    });
    const filtered = search
      ? rows.filter((row) => [row.email, row.displayName, ...(row.tenants || [])].join(" ").toLowerCase().includes(search))
      : rows;
    filtered.sort((a, b) => String(a.email).localeCompare(String(b.email)));
    return json(res, 200, { q: search, rows: filtered });
  }

  if (req.method === "GET" && urlObj.pathname === "/api/admin/projects") {
    const user = requireAdmin();
    if (!user) return;
    const range = adminRangeFromQuery(urlObj);
    if (!range) return json(res, 400, { error: "invalid_date_range" });
    const search = String(urlObj.searchParams.get("q") || "").trim().toLowerCase();
    const periodRows = db.metricDaily.filter((row) => row.date >= range.from && row.date <= range.to);
    const rows = db.projects.map((project) => {
      const tenant = db.tenants.find((t) => t.id === project.tenantId);
      const conn = db.ga4Connections.find((g) => g.projectId === project.id) || null;
      const agg = aggregateMetricRows(periodRows.filter((row) => row.projectId === project.id));
      return {
        id: project.id,
        name: project.name,
        domain: project.domain,
        tenantName: tenant?.name || "",
        ga4PropertyId: conn?.ga4PropertyId || null,
        ga4AccountEmail: conn?.accountEmail || null,
        lastSyncedAt: conn?.lastSyncedAt || null,
        lastSyncError: conn?.lastSyncError || null,
        sessions: agg.sessions,
        purchases: agg.purchaseSessions,
        revenue: agg.revenue,
        cvr: safeDivide(agg.purchaseSessions, agg.sessions)
      };
    });
    const filtered = search
      ? rows.filter((row) => [row.tenantName, row.name, row.domain, row.ga4PropertyId || ""].join(" ").toLowerCase().includes(search))
      : rows;
    filtered.sort((a, b) => (b.sessions - a.sessions) || String(a.tenantName).localeCompare(String(b.tenantName)));
    return json(res, 200, { from: range.from, to: range.to, q: search, rows: filtered });
  }

  const adminTenantDeleteMatch = urlObj.pathname.match(/^\/api\/admin\/tenants\/([^/]+)$/);
  if (req.method === "DELETE" && adminTenantDeleteMatch) {
    const user = requireAdmin();
    if (!user) return;
    const tenantId = adminTenantDeleteMatch[1];
    const tenant = db.tenants.find((t) => t.id === tenantId);
    if (!tenant) return json(res, 404, { error: "tenant_not_found" });

    const body = await parseBody(req);
    const confirmName = String(body.confirmName || "").trim();
    if (!confirmName || confirmName !== String(tenant.name || "")) {
      return json(res, 400, {
        error: "confirm_name_mismatch",
        message: "削除確認のため、企業名を正確に入力してください。"
      });
    }

    const projectIds = new Set(db.projects.filter((p) => p.tenantId === tenantId).map((p) => p.id));
    const memberUserIds = new Set(db.memberships.filter((m) => m.tenantId === tenantId).map((m) => m.userId));
    const reportJobsToDelete = db.reportJobs.filter((r) => projectIds.has(r.projectId));

    // Clean report files if present.
    for (const report of reportJobsToDelete) {
      if (report.filePath) {
        try {
          await fs.unlink(report.filePath);
        } catch {
          // ignore if file is already missing
        }
      }
    }

    db.projects = db.projects.filter((p) => p.tenantId !== tenantId);
    db.ga4Connections = db.ga4Connections.filter((g) => !projectIds.has(g.projectId));
    db.stageRules = db.stageRules.filter((s) => !projectIds.has(s.projectId));
    db.metricDaily = db.metricDaily.filter((m) => !projectIds.has(m.projectId));
    db.metricItemDaily = (db.metricItemDaily || []).filter((m) => !projectIds.has(m.projectId));
    db.diagnosisResults = db.diagnosisResults.filter((d) => !projectIds.has(d.projectId));
    db.reportJobs = db.reportJobs.filter((r) => !projectIds.has(r.projectId));
    db.projectContexts = db.projectContexts.filter((c) => !projectIds.has(c.projectId));
    db.assistantMessages = db.assistantMessages.filter((m) => !projectIds.has(m.projectId));
    db.oauthStates = db.oauthStates.filter((s) => s.tenantId !== tenantId && !projectIds.has(s.projectId));
    db.appEvents = (db.appEvents || []).filter((e) => e.tenantId !== tenantId && !projectIds.has(e.projectId));
    db.memberships = db.memberships.filter((m) => m.tenantId !== tenantId);
    db.tenants = db.tenants.filter((t) => t.id !== tenantId);

    // Remove users who no longer belong to any tenant.
    const remainingMemberUserIds = new Set(db.memberships.map((m) => m.userId));
    const orphanUserIds = [...memberUserIds].filter((id) => !remainingMemberUserIds.has(id));
    if (orphanUserIds.length) {
      const orphanSet = new Set(orphanUserIds);
      db.users = db.users.filter((u) => !orphanSet.has(u.id));
      db.sessions = db.sessions.filter((s) => !orphanSet.has(s.userId));
      db.oauthStates = db.oauthStates.filter((s) => !orphanSet.has(s.userId));
      db.appEvents = (db.appEvents || []).filter((e) => !orphanSet.has(e.userId));
    }

    trackAppEvent(db, {
      eventType: "admin_tenant_deleted",
      userId: user.id,
      tenantId,
      meta: { tenantName: tenant.name || "" }
    });

    await writeDb(db);
    return json(res, 200, { ok: true, deletedTenantId: tenantId, deletedUsers: orphanUserIds.length });
  }

  if (req.method === "GET" && urlObj.pathname === "/api/admin/trend") {
    const user = requireAdmin();
    if (!user) return;
    const range = adminRangeFromQuery(urlObj);
    if (!range) return json(res, 400, { error: "invalid_date_range" });
    const dates = dayList(range.from, range.to);
    const rows = db.metricDaily.filter((row) => row.date >= range.from && row.date <= range.to);
    const byDate = new Map();
    rows.forEach((row) => {
      const current = byDate.get(row.date) || { revenue: 0, activeProjects: new Set() };
      current.revenue += Number(row.revenue || 0);
      if (Number(row.sessions || 0) > 0) {
        current.activeProjects.add(row.projectId);
      }
      byDate.set(row.date, current);
    });

    const tenantCreatedDates = (db.tenants || [])
      .map((item) => (item.createdAt || "").slice(0, 10))
      .filter((v) => validateDate(v))
      .sort();

    let tenantCursor = 0;
    let tenantCount = 0;
    const series = dates.map((date) => {
      while (tenantCursor < tenantCreatedDates.length && tenantCreatedDates[tenantCursor] <= date) {
        tenantCount += 1;
        tenantCursor += 1;
      }
      const day = byDate.get(date);
      return {
        date,
        tenantCount,
        activeProjects: day ? day.activeProjects.size : 0,
        revenue: day ? day.revenue : 0
      };
    });
    return json(res, 200, { from: range.from, to: range.to, series });
  }


  if (req.method === "GET" && urlObj.pathname === "/api/admin/self-ga4") {
    const user = requireAdmin();
    if (!user) return;
    const range = adminRangeFromQuery(urlObj);
    if (!range) return json(res, 400, { error: "invalid_date_range" });
    try {
      const data = await fetchSelfGa4Analytics(range.from, range.to);
      return json(res, 200, data);
    } catch (err) {
      return json(res, 200, {
        error: String(err.message || err),
        propertyId: SELF_GA4_PROPERTY_ID || null,
        measurementId: SELF_GA4_MEASUREMENT_ID,
        streamId: SELF_GA4_STREAM_ID,
        from: range.from,
        to: range.to,
        days: dayList(range.from, range.to).length
      });
    }
  }

  if (req.method === "GET" && urlObj.pathname === "/api/admin/business-kpi") {
    const user = requireAdmin();
    if (!user) return;
    const range = adminRangeFromQuery(urlObj);
    if (!range) return json(res, 400, { error: "invalid_date_range" });
    const search = String(urlObj.searchParams.get("q") || "").trim().toLowerCase();

    const events = (db.appEvents || []).filter((item) => {
      const d = String(item.createdAt || "").slice(0, 10);
      if (!validateDate(d) || d < range.from || d > range.to) return false;
      if (!search) return true;
      return [
        item.eventType,
        item.tenantId,
        item.projectId,
        item.userId,
        JSON.stringify(item.meta || {})
      ].join(" ").toLowerCase().includes(search);
    });

    const veltioSessions = events.filter((e) => e.eventType === "page_view").length;
    const signupTenants = db.tenants.filter((item) => {
      const d = String(item.createdAt || "").slice(0, 10);
      return validateDate(d) && d >= range.from && d <= range.to;
    }).length;
    const paidConversions = db.tenants.reduce((acc, tenant) => {
      const history = tenant.planHistory || [];
      const hit = history.some((row) => {
        const d = String(row.changedAt || "").slice(0, 10);
        return row.toPlan === "pro" && row.fromPlan !== "pro" && validateDate(d) && d >= range.from && d <= range.to;
      });
      return acc + (hit ? 1 : 0);
    }, 0);
    const paidCvr = safeDivide(paidConversions, signupTenants);

    const churnTo = parseIsoDate(range.to);
    const churnFrom = isoDateOnly(new Date(churnTo.getTime() - 29 * ONE_DAY_MS));
    const eligibleTenants = db.tenants.filter((tenant) => {
      const created = String(tenant.createdAt || "").slice(0, 10);
      return validateDate(created) && created <= churnFrom;
    });
    const activeTenantSet = new Set(
      (db.appEvents || [])
        .filter((item) => {
          const d = String(item.createdAt || "").slice(0, 10);
          return item.tenantId && validateDate(d) && d >= churnFrom && d <= range.to;
        })
        .map((item) => item.tenantId)
    );
    const churnedTenants = eligibleTenants.filter((tenant) => !activeTenantSet.has(tenant.id)).length;
    const churnRate30d = safeDivide(churnedTenants, eligibleTenants.length);

    const totalProjects = db.projects.length;
    const ga4ConnectedProjects = db.ga4Connections.length;
    const ga4SyncedProjects = db.ga4Connections.filter((item) => item.lastSyncedAt).length;
    const reportProjectSet = new Set(db.reportJobs.map((item) => item.projectId));
    const reportProjects = reportProjectSet.size;
    const ga4ConnectRate = safeDivide(ga4ConnectedProjects, totalProjects);
    const ga4SyncRate = safeDivide(ga4SyncedProjects, ga4ConnectedProjects);
    const reportActivationRate = safeDivide(reportProjects, ga4SyncedProjects);

    return json(res, 200, {
      from: range.from,
      to: range.to,
      kpis: {
        veltioSessions,
        signupTenants,
        paidConversions,
        paidCvr,
        churnRate30d
      },
      ga4Funnel: {
        totalProjects,
        ga4ConnectedProjects,
        ga4SyncedProjects,
        reportProjects,
        ga4ConnectRate,
        ga4SyncRate,
        reportActivationRate
      }
    });
  }

  if (req.method === "POST" && urlObj.pathname === "/api/account/profile") {
    const user = requireAuth();
    if (!user) return;
    const tenant = primaryTenantForUser(db, user.id);
    if (!tenant) return json(res, 404, { error: "tenant_not_found" });
    const body = await parseBody(req);
    const accountName = String(body.accountName || "").trim();
    const companyName = String(body.companyName || "").trim();
    const contactName = String(body.contactName || "").trim();
    const jobTitle = String(body.jobTitle || "").trim();
    if (!accountName || !companyName || !contactName || !jobTitle) {
      return json(res, 400, { error: "missing_fields", message: "アカウント管理の項目はすべて必須です" });
    }
    tenant.accountName = accountName;
    tenant.companyName = companyName;
    tenant.contactName = contactName;
    tenant.jobTitle = jobTitle;
    await writeDb(db);
    return json(res, 200, { ok: true, account: tenant });
  }

  if (req.method === "POST" && urlObj.pathname === "/api/account/invites") {
    const user = requireAuth();
    if (!user) return;
    const tenant = primaryTenantForUser(db, user.id);
    if (!tenant) return json(res, 404, { error: "tenant_not_found" });
    const body = await parseBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) return json(res, 400, { error: "missing_fields" });
    if (tenant.invitedUsers.includes(email)) return json(res, 409, { error: "invite_exists" });
    if (tenant.invitedUsers.length >= 3) {
      return json(res, 400, { error: "invite_limit_reached", message: "招待ユーザーは3名までです" });
    }
    tenant.invitedUsers.push(email);
    await writeDb(db);
    // Send invite notification email (best-effort, non-blocking)
    sendInviteEmail(email, user.accountName || user.email, tenant.companyName || user.companyName)
      .catch((e) => console.error("invite email error:", e));
    return json(res, 201, { ok: true, invitedUsers: tenant.invitedUsers });
  }

  if (req.method === "POST" && urlObj.pathname === "/api/account/plan") {
    const user = requireAuth();
    if (!user) return;
    const tenant = primaryTenantForUser(db, user.id);
    if (!tenant) return json(res, 404, { error: "tenant_not_found" });
    const body = await parseBody(req);
    const validPlans = ["free", "pro", "business", "starter"]; // starter=legacy alias for free
    let plan = validPlans.includes(body.plan) ? body.plan : "free";
    if (plan === "starter") plan = "free";
    setPlanForTenant(db, tenant, plan, "account_plan_api");
    await writeDb(db);
    return json(res, 200, { ok: true, plan: tenant.plan });
  }

  // ── Stripe: create checkout session ─────────────────────────────────────────
  // ── Stripe: status check ─────────────────────────────────────────────────────
  if (req.method === "GET" && urlObj.pathname === "/api/stripe/status") {
    const user = requireAuth();
    if (!user) return;
    return json(res, 200, {
      configured: !!(stripe && STRIPE_PRO_PRICE_ID),
      hasSecretKey: !!STRIPE_SECRET_KEY,
      hasPriceId: !!STRIPE_PRO_PRICE_ID,
      hasWebhook: !!STRIPE_WEBHOOK_SECRET
    });
  }

  if (req.method === "POST" && urlObj.pathname === "/api/stripe/create-checkout-session") {
    const user = requireAuth();
    if (!user) return;
    if (!stripe) return json(res, 503, { error: "stripe_not_configured" });
    const body = await parseBody(req);
    const planId = String(body.plan || "");
    const priceId = planId === "pro" ? STRIPE_PRO_PRICE_ID : planId === "business" ? STRIPE_BUSINESS_PRICE_ID : null;
    if (!priceId) return json(res, 400, { error: "invalid_plan" });

    const tenant = primaryTenantForUser(db, user.id);
    if (!tenant) return json(res, 404, { error: "tenant_not_found" });

    // Ensure Stripe customer exists
    let customerId = tenant.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: tenant.companyName || tenant.accountName || user.email,
        metadata: { tenantId: tenant.id, userId: user.id }
      });
      customerId = customer.id;
      tenant.stripeCustomerId = customerId;
      await writeDb(db);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_BASE_URL}/analytics.html?stripe=success&plan=${planId}`,
      cancel_url:  `${APP_BASE_URL}/analytics.html?stripe=cancel`,
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { tenantId: tenant.id, userId: user.id, plan: planId }
      }
    });
    return json(res, 200, { url: session.url });
  }

  // ── Stripe: create customer portal session ───────────────────────────────────
  if (req.method === "POST" && urlObj.pathname === "/api/stripe/create-portal-session") {
    const user = requireAuth();
    if (!user) return;
    if (!stripe) return json(res, 503, { error: "stripe_not_configured" });

    const tenant = primaryTenantForUser(db, user.id);
    if (!tenant) return json(res, 404, { error: "tenant_not_found" });
    if (!tenant.stripeCustomerId) return json(res, 400, { error: "no_stripe_customer" });

    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: `${APP_BASE_URL}/analytics.html`
    });
    return json(res, 200, { url: session.url });
  }

  // ── Stripe: webhook ──────────────────────────────────────────────────────────
  if (req.method === "POST" && urlObj.pathname === "/api/stripe/webhook") {
    const rawBody = await readRawBody(req);
    const sig = req.headers["stripe-signature"] || "";
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
      return json(res, 503, { error: "stripe_not_configured" });
    }
    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error("[stripe webhook] signature verification failed:", err.message);
      return json(res, 400, { error: "invalid_signature" });
    }

    // Helper: find tenant by stripeCustomerId
    function tenantByCustomer(customerId) {
      return db.tenants.find((t) => t.stripeCustomerId === customerId) || null;
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode !== "subscription") break;
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        const planId = session.metadata?.plan ||
          PLAN_PRICE_MAP[(await stripe.subscriptions.retrieve(subscriptionId))?.items?.data?.[0]?.price?.id] ||
          "pro";
        const tenant = tenantByCustomer(customerId);
        if (tenant) {
          tenant.stripeSubscriptionId = subscriptionId;
          tenant.stripeSubscriptionStatus = "active";
          setPlanForTenant(db, tenant, planId, "stripe_checkout");
          await writeDb(db);
          console.log(`[stripe] checkout completed: tenant=${tenant.id} plan=${planId}`);
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const customerId = sub.customer;
        const tenant = tenantByCustomer(customerId);
        if (tenant) {
          tenant.stripeSubscriptionId = sub.id;
          tenant.stripeSubscriptionStatus = sub.status;
          const priceId = sub.items?.data?.[0]?.price?.id;
          const planId = PLAN_PRICE_MAP[priceId] || null;
          if (planId) {
            setPlanForTenant(db, tenant, planId, "stripe_sub_update");
          }
          // If subscription is no longer active, downgrade to free
          if (!["active", "trialing"].includes(sub.status)) {
            setPlanForTenant(db, tenant, "free", "stripe_sub_inactive");
          }
          await writeDb(db);
          console.log(`[stripe] subscription updated: tenant=${tenant.id} status=${sub.status} plan=${planId}`);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const tenant = tenantByCustomer(sub.customer);
        if (tenant) {
          tenant.stripeSubscriptionId = null;
          tenant.stripeSubscriptionStatus = "canceled";
          setPlanForTenant(db, tenant, "free", "stripe_sub_deleted");
          await writeDb(db);
          console.log(`[stripe] subscription deleted: tenant=${tenant.id}`);
        }
        break;
      }
      default:
        // Unhandled event types — ignore
        break;
    }
    return json(res, 200, { received: true });
  }

  if (req.method === "POST" && urlObj.pathname === "/api/account/email-delivery/test") {
    const user = requireAuth();
    if (!user) return;
    const code = generateVerificationCode();
    try {
      const delivery = await sendVerificationEmail(user.email, code);
      return json(res, 200, {
        ok: true,
        message: "送信しました。",
        previewCode: delivery.previewCode
      });
    } catch (err) {
      return json(res, 500, {
        error: "email_delivery_failed",
        message: "テスト送信に失敗しました。Resend設定または送信元ドメインを確認してください。",
        detail: String(err.message || err)
      });
    }
  }

  if (req.method === "DELETE" && urlObj.pathname === "/api/account") {
    const user = requireAuth();
    if (!user) return;

    // require password confirmation
    const body = await parseBody(req);
    const password = String(body.password || "").trim();
    if (!password) {
      return json(res, 400, { error: "missing_password", message: "確認のためパスワードを入力してください" });
    }
    const ok = verifyPassword(password, user.passwordHash);
    if (!ok) {
      return json(res, 401, { error: "invalid_password", message: "パスワードが正しくありません" });
    }

    // collect all data belonging to this user
    const membershipRows = (db.memberships || []).filter((m) => m.userId === user.id);
    const tenantIds = membershipRows.map((m) => m.tenantId);
    // only delete tenants where this user is the sole member
    const soleTenantIds = tenantIds.filter((tid) => {
      const members = (db.memberships || []).filter((m) => m.tenantId === tid);
      return members.length === 1 && members[0].userId === user.id;
    });
    const projectIds = (db.projects || []).filter((p) => soleTenantIds.includes(p.tenantId)).map((p) => p.id);
    const projectIdSet = new Set(projectIds);
    const soleTenantIdSet = new Set(soleTenantIds);

    db.users = (db.users || []).filter((u) => u.id !== user.id);
    db.memberships = (db.memberships || []).filter((m) => m.userId !== user.id);
    db.tenants = (db.tenants || []).filter((t) => !soleTenantIdSet.has(t.id));
    db.projects = (db.projects || []).filter((p) => !projectIdSet.has(p.id));
    db.ga4Connections = (db.ga4Connections || []).filter((c) => !projectIdSet.has(c.projectId));
    db.stageRules = (db.stageRules || []).filter((r) => !projectIdSet.has(r.projectId));
    db.metricDaily = (db.metricDaily || []).filter((r) => !projectIdSet.has(r.projectId));
    db.metricItemDaily = (db.metricItemDaily || []).filter((r) => !projectIdSet.has(r.projectId));
    db.diagnosisResults = (db.diagnosisResults || []).filter((r) => !projectIdSet.has(r.projectId));
    db.reportJobs = (db.reportJobs || []).filter((r) => !projectIdSet.has(r.projectId));
    db.projectContexts = (db.projectContexts || []).filter((c) => !projectIdSet.has(c.projectId));
    db.assistantMessages = (db.assistantMessages || []).filter((m) => !projectIdSet.has(m.projectId));
    db.oauthStates = (db.oauthStates || []).filter((s) => s.userId !== user.id && !projectIdSet.has(s.projectId));
    db.appEvents = (db.appEvents || []).filter((e) => e.userId !== user.id && !soleTenantIdSet.has(e.tenantId));
    db.sessions = (db.sessions || []).filter((s) => s.userId !== user.id);
    await writeDb(db);

    // clear session cookie
    res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && urlObj.pathname === "/api/contact") {
    const body = await parseBody(req);
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const category = String(body.category || "general").trim();
    const msgBody = String(body.body || "").trim();
    if (!name || !email || !msgBody) {
      return json(res, 400, { error: "missing_fields", message: "名前・メール・本文は必須です" });
    }
    const CONTACT_TO = process.env.CONTACT_TO_EMAIL || RESEND_FROM_EMAIL;
    if (!RESEND_API_KEY || !RESEND_FROM_EMAIL || !CONTACT_TO) {
      // Dev fallback: just log
      console.log("[contact form]", { name, email, category, body: msgBody });
      return json(res, 200, { ok: true });
    }
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [CONTACT_TO],
        reply_to: email,
        subject: `[Veltio お問い合わせ] ${category} — ${name}`,
        text: `名前: ${name}\nメール: ${email}\n種別: ${category}\n\n${msgBody}`
      })
    });
    if (!emailRes.ok) {
      return json(res, 500, { error: "email_delivery_failed", message: "送信に失敗しました。時間をおいて再度お試しください。" });
    }
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && urlObj.pathname === "/api/projects") {
    const user = requireAuth();
    if (!user) return;
    const tenantIds = new Set(db.memberships.filter((m) => m.userId === user.id).map((m) => m.tenantId));
    const projects = db.projects
      .filter((p) => tenantIds.has(p.tenantId))
      .map((p) => ({
        ...p,
        ga4Connected: db.ga4Connections.some((g) => g.projectId === p.id)
      }));
    return json(res, 200, { projects });
  }

  if (req.method === "POST" && urlObj.pathname === "/api/projects") {
    const user = requireAuth();
    if (!user) return;

    const body = await parseBody(req);
    const { tenantId, name, domain, timezone = "Asia/Tokyo" } = body;
    if (!tenantId || !name || !domain) {
      return json(res, 400, { error: "missing_fields" });
    }
    const member = db.memberships.find((m) => m.userId === user.id && m.tenantId === tenantId);
    if (!member) {
      return json(res, 403, { error: "forbidden" });
    }
    const existingProjects = db.projects.filter((p) => p.tenantId === tenantId);
    if (existingProjects.length >= 1 && !userHasProPlan(db, user.id)) {
      return json(res, 402, {
        error: "feature_locked",
        feature: "multi_project",
        requiredPlan: "pro",
        message: "2件目以降のプロジェクト追加はProプランで利用できます"
      });
    }

    const project = {
      id: uid(),
      tenantId,
      name,
      domain,
      timezone,
      targetCvr: null,
      createdAt: new Date().toISOString()
    };
    db.projects.push(project);
    db.stageRules.push({ id: uid(), projectId: project.id, ...DEFAULT_STAGE_RULES, updatedAt: new Date().toISOString() });
    await syncProjectMetrics(db, project);
    await writeDb(db);

    return json(res, 201, { project });
  }

  const projectIdMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (req.method === "GET" && projectIdMatch) {
    const user = requireAuth();
    if (!user) return;
    const project = findProjectAccessible(db, projectIdMatch[1], user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });
    return json(res, 200, { project });
  }

  if (req.method === "PATCH" && projectIdMatch) {
    const user = requireAuth();
    if (!user) return;
    const project = findProjectAccessible(db, projectIdMatch[1], user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });

    const body = await parseBody(req);
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return json(res, 400, { error: "missing_name" });
      project.name = name;
    }
    if (body.domain !== undefined) {
      const domain = String(body.domain).trim();
      if (!domain) return json(res, 400, { error: "missing_domain" });
      project.domain = domain;
    }
    project.updatedAt = new Date().toISOString();
    await writeDb(db);
    return json(res, 200, { project });
  }

  const projectSettingsMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/settings$/);
  if (req.method === "POST" && projectSettingsMatch) {
    const user = requireAuth();
    if (!user) return;
    const project = findProjectAccessible(db, projectSettingsMatch[1], user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });

    const body = await parseBody(req);
    const rawTarget = body.targetCvr;
    if (rawTarget !== null && rawTarget !== "" && rawTarget !== undefined) {
      const parsed = Number(rawTarget);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
        return json(res, 400, { error: "invalid_target_cvr", message: "目標CVRは 0% より大きく 100% 未満で入力してください" });
      }
      project.targetCvr = parsed;
    } else {
      project.targetCvr = null;
    }
    await writeDb(db);
    return json(res, 200, { project });
  }

  const projectCampaignsMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/campaigns$/);
  if (projectCampaignsMatch) {
    const user = requireAuth();
    if (!user) return;
    const project = findProjectAccessible(db, projectCampaignsMatch[1], user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });

    if (req.method === "GET") {
      const campaigns = (project.campaigns || []).map((item) => ({
        ...item,
        impact: campaignImpactSummary(db, project.id, item)
      }));
      return json(res, 200, { campaigns });
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const { id, name, type, startDate, endDate, recurringAnnual } = body;
      if (!name || !type || !startDate || !endDate || !validateDate(startDate) || !validateDate(endDate)) {
        return json(res, 400, { error: "missing_fields", message: "名称、種別、開始日、終了日は必須です" });
      }
      if (startDate > endDate) {
        return json(res, 400, { error: "invalid_date_range", message: "終了日は開始日以降に設定してください" });
      }
      const customCompareStart = validateDate(String(body.customCompareStart || "")) ? String(body.customCompareStart) : "";
      const customCompareEnd = validateDate(String(body.customCompareEnd || "")) ? String(body.customCompareEnd) : "";
      const nextItem = {
        id: id || uid(),
        name: String(name).trim(),
        type: type === "campaign" ? "campaign" : "sale",
        startDate,
        endDate,
        recurringAnnual: Boolean(recurringAnnual),
        goalRevenue: Number(body.goalRevenue) > 0 ? Number(body.goalRevenue) : 0,
        goalCvr: Number(body.goalCvr) > 0 ? Number(body.goalCvr) : 0,
        customCompareStart,
        customCompareEnd,
        memo: String(body.memo || "").slice(0, 500),
        updatedAt: new Date().toISOString()
      };
      project.campaigns = (project.campaigns || []).filter((item) => item.id !== nextItem.id);
      project.campaigns.push(nextItem);
      project.campaigns.sort((a, b) => a.startDate.localeCompare(b.startDate));
      await writeDb(db);
      return json(res, 200, { campaign: nextItem });
    }
  }

  const projectCampaignDeleteMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/campaigns\/([^/]+)$/);
  if (req.method === "DELETE" && projectCampaignDeleteMatch) {
    const user = requireAuth();
    if (!user) return;
    const project = findProjectAccessible(db, projectCampaignDeleteMatch[1], user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });
    project.campaigns = (project.campaigns || []).filter((item) => item.id !== projectCampaignDeleteMatch[2]);
    await writeDb(db);
    return json(res, 200, { ok: true });
  }

  // PATCH /api/projects/:id/campaigns/:cid — update memo/goals
  const projectCampaignPatchMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/campaigns\/([^/]+)$/);
  if (req.method === "PATCH" && projectCampaignPatchMatch) {
    const user = requireAuth();
    if (!user) return;
    const project = findProjectAccessible(db, projectCampaignPatchMatch[1], user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });
    const camp = (project.campaigns || []).find((c) => c.id === projectCampaignPatchMatch[2]);
    if (!camp) return json(res, 404, { error: "campaign_not_found" });
    const body = await parseBody(req);
    if (typeof body.memo === "string") camp.memo = body.memo.slice(0, 500);
    if (typeof body.goalRevenue === "number") camp.goalRevenue = body.goalRevenue;
    if (typeof body.goalCvr === "number") camp.goalCvr = body.goalCvr;
    await writeDb(db);
    return json(res, 200, { campaign: camp });
  }

  const ga4QuickConnectMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/ga4\/quick-connect$/);
  if (req.method === "POST" && ga4QuickConnectMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = ga4QuickConnectMatch[1];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });

    const body = await parseBody(req);
    const propertyId = extractGa4PropertyId(body.ga4Input);
    if (!propertyId) {
      return json(res, 400, { error: "invalid_ga4_input" });
    }

    // GA4 property uniqueness: one property can only be connected by one project (any user)
    const existingConn = db.ga4Connections.find((g) => g.ga4PropertyId === propertyId && g.projectId !== projectId);
    if (existingConn) {
      return json(res, 409, {
        error: "property_already_registered",
        message: "このGA4プロパティはすでに別のプロジェクトで登録されています。"
      });
    }

    if (!requireGoogleOAuthConfig()) {
      return json(res, 400, {
        error: "ga4_oauth_not_configured",
        message: "GA4_OAUTH_CLIENT_ID / GA4_OAUTH_CLIENT_SECRET / GA4_OAUTH_REDIRECT_URI を設定してください"
      });
    }

    const state = uid();
    db.oauthStates = db.oauthStates.filter((s) => new Date(s.expiresAt).getTime() > Date.now());
    db.oauthStates.push({
      state,
      projectId,
      tenantId: project.tenantId,
      userId: user.id,
      propertyId,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString()
    });
    await writeDb(db);
    return json(res, 200, { ok: true, propertyId, authUrl: buildGa4OauthUrl(state) });
  }

  if (req.method === "GET" && urlObj.pathname === "/api/ga4/oauth/callback") {
    const code = urlObj.searchParams.get("code");
    const state = urlObj.searchParams.get("state");
    const error = urlObj.searchParams.get("error");
    if (error) {
      res.writeHead(302, { Location: `/dashboard?ga4=error&reason=${encodeURIComponent(error)}` });
      return res.end();
    }
    if (!code || !state) {
      res.writeHead(302, { Location: "/dashboard?ga4=error&reason=missing_code_or_state" });
      return res.end();
    }

    const pending = db.oauthStates.find((s) => s.state === state && new Date(s.expiresAt).getTime() > Date.now());
    if (!pending) {
      res.writeHead(302, { Location: "/dashboard?ga4=error&reason=invalid_or_expired_state" });
      return res.end();
    }

    try {
      const tokens = await exchangeCodeForTokens(code);
      const email = (await fetchGoogleUserEmail(tokens.access_token)) || "connected@example.com";
      // Re-check uniqueness at callback time (race-condition guard)
      const conflictConn = db.ga4Connections.find((g) => g.ga4PropertyId === pending.propertyId && g.projectId !== pending.projectId);
      if (conflictConn) {
        db.oauthStates = db.oauthStates.filter((s) => s.state !== state);
        await writeDb(db);
        res.writeHead(302, { Location: "/dashboard?ga4=error&reason=property_already_registered" });
        return res.end();
      }
      db.ga4Connections = db.ga4Connections.filter((g) => g.projectId !== pending.projectId);
      db.ga4Connections.push({
        id: uid(),
        projectId: pending.projectId,
        ga4PropertyId: pending.propertyId,
        accountEmail: email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || "",
        grantedScope: tokens.scope || "",
        expiresAt: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastSyncedAt: null,
        lastSyncError: null
      });
      trackAppEvent(db, {
        eventType: "ga4_connected",
        userId: pending.userId,
        tenantId: pending.tenantId,
        projectId: pending.projectId,
        meta: { propertyId: pending.propertyId }
      });

      const project = db.projects.find((p) => p.id === pending.projectId);
      if (project) {
        await syncProjectMetrics(db, project);
        trackAppEvent(db, {
          eventType: "ga4_sync_success",
          userId: pending.userId,
          tenantId: pending.tenantId,
          projectId: pending.projectId,
          meta: { mode: "oauth_callback" }
        });
      }
      db.oauthStates = db.oauthStates.filter((s) => s.state !== state);
      await writeDb(db);
      res.writeHead(302, { Location: `/dashboard?ga4=connected&projectId=${encodeURIComponent(pending.projectId)}` });
      return res.end();
    } catch (err) {
      db.oauthStates = db.oauthStates.filter((s) => s.state !== state);
      await writeDb(db);
      res.writeHead(302, { Location: `/dashboard?ga4=error&reason=${encodeURIComponent(String(err.message || err))}` });
      return res.end();
    }
  }

  const ga4StatusMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/ga4\/status$/);
  if (req.method === "GET" && ga4StatusMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = ga4StatusMatch[1];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });

    const conn = db.ga4Connections.find((g) => g.projectId === projectId);
    return json(res, 200, {
      connected: Boolean(conn),
      connection: conn
        ? {
            propertyId: conn.ga4PropertyId,
            accountEmail: conn.accountEmail,
            grantedScope: conn.grantedScope || "",
            expiresAt: conn.expiresAt,
            lastSyncedAt: conn.lastSyncedAt || null,
            lastSyncError: conn.lastSyncError || null
          }
        : null
    });
  }

  const ga4SyncMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/ga4\/sync$/);
  if (req.method === "POST" && ga4SyncMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = ga4SyncMatch[1];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });
    const conn = db.ga4Connections.find((g) => g.projectId === projectId);
    if (!conn) return json(res, 400, { error: "ga4_not_connected" });
    if (!requireGoogleOAuthConfig()) return json(res, 400, { error: "ga4_oauth_not_configured" });
    await syncProjectMetrics(db, project);
    if (!conn.lastSyncError) {
      trackAppEvent(db, {
        eventType: "ga4_sync_success",
        userId: user.id,
        tenantId: project.tenantId,
        projectId: project.id,
        meta: { mode: "manual_sync" }
      });
    }
    await writeDb(db);
    return json(res, 200, { ok: true, lastSyncedAt: conn.lastSyncedAt || null, lastSyncError: conn.lastSyncError || null });
  }

  // GET /api/projects/:id/export/daily — CSV export of daily metrics
  const exportDailyMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/export\/daily$/);
  if (req.method === "GET" && exportDailyMatch) {
    const user = requireAuth();
    if (!user) return;
    const project = findProjectAccessible(db, exportDailyMatch[1], user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });
    const from = urlObj.searchParams.get("from") || shiftDate(new Date().toISOString().slice(0, 10), -90);
    const to = urlObj.searchParams.get("to") || new Date().toISOString().slice(0, 10);
    const rows = selectRowsForPeriod(db, project.id, from, to);
    const header = ["date","channel","device","landingPage","sessions","engagedSessions","pdpSessions","addToCartSessions","cartReachSessions","checkoutSessions","purchaseSessions","revenue","bounce_rate","pdp_reach_rate","add_to_cart_rate","cart_abandon_rate","checkout_reach_rate","purchase_rate","cvr"];
    const csvLines = [header.join(",")];
    for (const r of rows.sort((a, b) => a.date.localeCompare(b.date))) {
      const m = computeRates(r);
      const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      csvLines.push([
        r.date, esc(r.channel), esc(r.device), esc(r.landingPage),
        r.sessions, r.engagedSessions, r.pdpSessions, r.addToCartSessions,
        r.cartReachSessions, r.checkoutSessions, r.purchaseSessions, r.revenue,
        m.bounce_rate.toFixed(4), m.pdp_reach_rate.toFixed(4), m.add_to_cart_rate.toFixed(4),
        m.cart_abandon_rate.toFixed(4), m.checkout_reach_rate.toFixed(4), m.purchase_rate.toFixed(4), m.cvr.toFixed(4)
      ].join(","));
    }
    const csv = csvLines.join("\n");
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="veltio-daily-${from}-${to}.csv"`,
      "Access-Control-Allow-Origin": "*"
    });
    res.end("\uFEFF" + csv); // BOM for Excel UTF-8 compatibility
    return;
  }

  const stageRulesMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/setup\/stage-rules$/);
  if (stageRulesMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = stageRulesMatch[1];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });

    if (req.method === "GET") {
      const rules = db.stageRules.find((r) => r.projectId === projectId) || null;
      return json(res, 200, { rules });
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const next = {
        ...DEFAULT_STAGE_RULES,
        ...body,
        projectId,
        id: uid(),
        updatedAt: new Date().toISOString()
      };
      db.stageRules = db.stageRules.filter((r) => r.projectId !== projectId);
      db.stageRules.push(next);
      await syncProjectMetrics(db, project);
      await writeDb(db);
      return json(res, 200, { rules: next });
    }
  }

  // GET /api/projects/:id/ga4/events — fetch event names from GA4 (last 30 days)
  const ga4EventsMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/ga4\/events$/);
  if (req.method === "GET" && ga4EventsMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = ga4EventsMatch[1];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });
    try {
      const conn = await ensureFreshAccessToken(db, projectId);
      if (!hasAnalyticsReadonlyScope(conn)) {
        return json(res, 403, { error: "ga4_missing_scope" });
      }
      const today = isoDateOnly(new Date());
      const thirtyDaysAgo = shiftDate(today, -30);
      const report = await runGa4Report(conn.ga4PropertyId, conn.accessToken, {
        dateRanges: [{ startDate: thirtyDaysAgo, endDate: today }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
        limit: "100",
        keepEmptyRows: false
      });
      const events = (report.rows || []).map((row) => ({
        name: row.dimensionValues[0].value,
        count: parseInt(row.metricValues[0].value || "0", 10)
      }));
      return json(res, 200, { events });
    } catch (err) {
      return json(res, 500, { error: "ga4_fetch_failed", message: err.message });
    }
  }

  const metricsMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/metrics$/);
  if (req.method === "GET" && metricsMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = metricsMatch[1];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });

    const range = dateRangeFromQuery(urlObj);
    if (!range) return json(res, 400, { error: "invalid_date_range" });
    const compareFrom = urlObj.searchParams.get("compare_from");
    const compareTo = urlObj.searchParams.get("compare_to");
    const wantsCompare = Boolean(compareFrom || compareTo);
    if (wantsCompare) {
      if (!compareFrom || !compareTo || !validateDate(compareFrom) || !validateDate(compareTo)) {
        return json(res, 400, { error: "invalid_compare_range" });
      }
      if (!userHasProPlan(db, user.id)) {
        return json(res, 402, {
          error: "feature_locked",
          feature: "period_compare",
          requiredPlan: "pro",
          message: "期間比較はProプランで利用できます"
        });
      }
    }

    // Auto-sync if no data exists for this period and GA4 is connected
    let rows = selectRowsForPeriod(db, projectId, range.from, range.to);
    if (rows.length === 0) {
      const conn = db.ga4Connections.find((g) => g.projectId === projectId);
      if (conn && requireGoogleOAuthConfig()) {
        try {
          await syncProjectMetrics(db, project);
          await writeDb(db);
          rows = selectRowsForPeriod(db, projectId, range.from, range.to);
        } catch (err) {
          console.error("auto-sync on empty metrics:", err.message);
        }
      }
    }
    const agg = aggregateMetricRows(rows);
    const rates = computeRates(agg);
    const comparisons = buildMetricComparisons(db, rates, project);
    const granularity = normalizeGranularity(urlObj.searchParams.get("granularity") || "day");
    const series = buildSeries(rows, granularity);
    const funnel = [
      { key: "sessions", label: "Sessions", value: agg.sessions },
      { key: "pdp", label: "PDP", value: agg.pdpSessions },
      { key: "add_to_cart", label: "Add to Cart", value: agg.addToCartSessions },
      { key: "cart_reach", label: "Cart Reach", value: agg.cartReachSessions },
      { key: "checkout", label: "Checkout", value: agg.checkoutSessions },
      { key: "purchase", label: "Purchase", value: agg.purchaseSessions }
    ];

    let compare = null;
    if (wantsCompare) {
      const compareRows = selectRowsForPeriod(db, projectId, compareFrom, compareTo);
      const compareAgg = aggregateMetricRows(compareRows);
      const compareRates = computeRates(compareAgg);
      const compareComparisons = buildMetricComparisons(db, compareRates, project);
      const compareSeries = buildSeries(compareRows, granularity);
      compare = {
        from: compareFrom,
        to: compareTo,
        totals: compareAgg,
        metrics: compareRates,
        comparisons: compareComparisons,
        series: compareSeries,
        delta: {
          sessions: agg.sessions - compareAgg.sessions,
          bounce_rate: rates.bounce_rate - compareRates.bounce_rate,
          pdp_reach_rate: rates.pdp_reach_rate - compareRates.pdp_reach_rate,
          add_to_cart_rate: rates.add_to_cart_rate - compareRates.add_to_cart_rate,
          cart_abandon_rate: rates.cart_abandon_rate - compareRates.cart_abandon_rate,
          checkout_reach_rate: rates.checkout_reach_rate - compareRates.checkout_reach_rate,
          purchase_rate: rates.purchase_rate - compareRates.purchase_rate,
          cvr: rates.cvr - compareRates.cvr
        }
      };
    }

    return json(res, 200, {
      projectId,
      from: range.from,
      to: range.to,
      granularity,
      totals: agg,
      metrics: rates,
      comparisons,
      series,
      funnel,
      compare
    });
  }

  const journeyMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/journey$/);
  if (req.method === "GET" && journeyMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = journeyMatch[1];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });

    const range = dateRangeFromQuery(urlObj);
    if (!range) return json(res, 400, { error: "invalid_date_range" });
    const rows = selectRowsForPeriod(db, projectId, range.from, range.to);
    const agg = aggregateMetricRows(rows);
    const steps = journeyStepRows(agg);
    const dropoffs = journeyDropoffs(steps);
    const primaryDropoff = [...dropoffs].sort((a, b) => b.dropRate - a.dropRate)[0] || null;
    const channelTop = topDropoffSegments(rows, "channel", 3);
    const deviceTop = topDropoffSegments(rows, "device", 3);

    return json(res, 200, {
      projectId,
      from: range.from,
      to: range.to,
      steps,
      dropoffs,
      primaryDropoff,
      channelTop,
      deviceTop
    });
  }

  const breakdownMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/breakdown$/);
  if (req.method === "GET" && breakdownMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = breakdownMatch[1];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });

    const range = dateRangeFromQuery(urlObj);
    const dimension = urlObj.searchParams.get("dimension") || "channel";
    if (!range) return json(res, 400, { error: "invalid_date_range" });
    if (!["channel", "device", "landing_page", "item_name", "item_category"].includes(dimension)) {
      return json(res, 400, { error: "invalid_dimension" });
    }

    const isItemDimension = dimension === "item_name" || dimension === "item_category";

    if (isItemDimension) {
      if (!Array.isArray(db.metricItemDaily)) db.metricItemDaily = [];
      const itemRows = db.metricItemDaily.filter(
        (r) => r.projectId === projectId && r.date >= range.from && r.date <= range.to
      );
      const grouped = groupedItemBreakdown(itemRows, dimension);
      grouped.sort((a, b) => b.itemsViewed - a.itemsViewed);

      const compareFrom = urlObj.searchParams.get("compare_from");
      const compareTo = urlObj.searchParams.get("compare_to");
      let compareRows = null;
      if (compareFrom && compareTo && validateDate(compareFrom) && validateDate(compareTo)) {
        const cmpRows = db.metricItemDaily.filter(
          (r) => r.projectId === projectId && r.date >= compareFrom && r.date <= compareTo
        );
        const cmpGrouped = groupedItemBreakdown(cmpRows, dimension);
        compareRows = Object.fromEntries(cmpGrouped.map((r) => [r.dimensionValue, r]));
      }
      return json(res, 200, { dimension, rows: grouped, compareRows, isItemDimension: true });
    }

    const rows = selectRowsForPeriod(db, projectId, range.from, range.to);
    const grouped = groupedBreakdown(rows, dimension);
    grouped.sort((a, b) => b.sessions - a.sessions);

    const compareFrom = urlObj.searchParams.get("compare_from");
    const compareTo = urlObj.searchParams.get("compare_to");
    let compareRows = null;
    if (compareFrom && compareTo && validateDate(compareFrom) && validateDate(compareTo)) {
      const cmpRawRows = selectRowsForPeriod(db, projectId, compareFrom, compareTo);
      const cmpGrouped = groupedBreakdown(cmpRawRows, dimension);
      compareRows = Object.fromEntries(cmpGrouped.map((r) => [r.dimensionValue, r]));
    }

    return json(res, 200, { dimension, rows: grouped, compareRows });
  }

  const worstMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/worst$/);
  if (req.method === "GET" && worstMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = worstMatch[1];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });

    const range = dateRangeFromQuery(urlObj);
    const dimension = urlObj.searchParams.get("dimension") || "channel";
    const limit = Number(urlObj.searchParams.get("limit") || 5);
    if (!range) return json(res, 400, { error: "invalid_date_range" });

    const rows = groupedBreakdown(selectRowsForPeriod(db, projectId, range.from, range.to), dimension);
    rows.sort((a, b) => a.metrics.pdp_reach_rate - b.metrics.pdp_reach_rate);
    return json(res, 200, { rows: rows.slice(0, limit) });
  }

  const diagnosisRunMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/diagnosis\/run$/);
  if (req.method === "POST" && diagnosisRunMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = diagnosisRunMatch[1];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });

    const range = dateRangeFromQuery(urlObj);
    if (!range) return json(res, 400, { error: "invalid_date_range" });

    const periodRows = selectRowsForPeriod(db, projectId, range.from, range.to);
    const agg = aggregateMetricRows(periodRows);
    const breakdownSets = {
      channel: groupedBreakdown(periodRows, "channel"),
      device: groupedBreakdown(periodRows, "device"),
      landing_page: groupedBreakdown(periodRows, "landing_page")
    };
    const diagnosis = runDiagnosisFromAggregate(db, agg, breakdownSets, project);
    const recommendations = pickTemplates(db, diagnosis.findings, projectId);

    const result = {
      id: uid(),
      projectId,
      fromDate: range.from,
      toDate: range.to,
      findings: diagnosis.findings,
      rates: diagnosis.rates,
      comparisons: diagnosis.comparisons,
      worstHints: diagnosis.worstHints,
      recommendations,
      createdAt: new Date().toISOString()
    };

    db.diagnosisResults.push(result);
    await writeDb(db);
    return json(res, 200, { result });
  }

  const diagnosisLatestMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/diagnosis\/latest$/);
  if (req.method === "GET" && diagnosisLatestMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = diagnosisLatestMatch[1];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });

    const latest = [...db.diagnosisResults]
      .filter((d) => d.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    return json(res, 200, { result: latest || null });
  }

  const projectContextMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/context$/);
  if (projectContextMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = projectContextMatch[1];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });

    if (req.method === "GET") {
      const context = projectContextFor(db, projectId);
      context.actionLogHistory = context.actionLogHistory.map((item, index, arr) => ({
        ...item,
        autoComment: item.autoComment || summarizeActionLogProgress(item, index > 0 ? arr[index - 1] : null),
        evaluations: buildEvaluationWindows(db, projectId, item)
      }));
      context.actionLogHistory = context.actionLogHistory.map((item) => ({
        ...item,
        effectiveness: evaluateActionEffectiveness(item)
      }));
      const groupMeasurements = buildGroupMeasurements(db, projectId, context.actionLogHistory);
      return json(res, 200, { context: { ...context, groupMeasurements } });
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const existing = projectContextFor(db, projectId);
      const VALID_METRIC_KEYS = ["bounce_rate","pdp_reach_rate","add_to_cart_rate","cart_abandon_rate","checkout_reach_rate","purchase_rate","cvr"];
      const next = {
        ...existing,
        projectId,
        companyNote: String(body.companyNote || "").trim(),
        actionLog: String(body.actionLog || "").trim(),
        actionTargetPage: String(body.actionTargetPage || "").trim(),
        actionOwner: String(body.actionOwner || existing.actionOwner || "").trim(),
        actionStatus: ["todo", "doing", "done"].includes(String(body.actionStatus || "")) ? String(body.actionStatus) : (existing.actionStatus || "todo"),
        actionPriority: ["low", "medium", "high"].includes(String(body.actionPriority || "")) ? String(body.actionPriority) : (existing.actionPriority || "medium"),
        actionCompletedAtDate: validateDate(String(body.actionCompletedAtDate || "")) ? String(body.actionCompletedAtDate) : null,
        actionTargetMetricKey: VALID_METRIC_KEYS.includes(String(body.targetMetricKey || "")) ? String(body.targetMetricKey) : (existing.actionTargetMetricKey || null),
        updatedAt: new Date().toISOString()
      };
      if (next.actionStatus === "done" && !next.actionCompletedAtDate) {
        return json(res, 400, { error: "missing_completed_date", message: "状態が完了の場合、完了日は必須です" });
      }
      if (next.companyNote && next.companyNote !== existing.companyNote) {
        next.companyNoteHistory.push({
          id: uid(),
          content: next.companyNote,
          createdAt: next.updatedAt
        });
      }
      const editingActionLogId = String(body.actionLogId || "").trim();
      if (next.actionLog) {
        const snapshotFrom = validateDate(String(body.from || "")) ? String(body.from) : null;
        const snapshotTo = validateDate(String(body.to || "")) ? String(body.to) : null;
        const rows = snapshotFrom && snapshotTo ? selectRowsForPeriod(db, projectId, snapshotFrom, snapshotTo) : [];
        const metrics = rows.length ? computeRates(aggregateMetricRows(rows)) : null;
        const latestDiagnosis = [...db.diagnosisResults]
          .filter((d) => d.projectId === projectId)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
        const prevAction = next.actionLogHistory[next.actionLogHistory.length - 1] || null;
        if (editingActionLogId) {
          next.actionLogHistory = next.actionLogHistory.map((item) =>
            item.id === editingActionLogId
              ? {
                  ...item,
                  content: next.actionLog,
                  targetPage: next.actionTargetPage || item.targetPage || "",
                  owner: next.actionOwner,
                  status: next.actionStatus,
                  priority: next.actionPriority,
                  completedAtDate: next.actionStatus === "done" ? (next.actionCompletedAtDate || next.updatedAt.slice(0, 10)) : null,
                  monitorStartDate: item.monitorStartDate || next.updatedAt.slice(0, 10),
                  fromDate: snapshotFrom,
                  toDate: snapshotTo,
                  metrics,
                  targetMetricKey: next.actionTargetMetricKey || item.targetMetricKey || null,
                  linkedDiagnosisId: latestDiagnosis?.id || null,
                  linkedDiagnosisTitle: latestDiagnosis?.findings?.[0]?.title || null,
                  linkedMetricKey: latestDiagnosis?.findings?.[0]?.metricKey || null
                }
              : item
          );
        } else if (next.actionLog !== existing.actionLog) {
          const entry = {
            id: uid(),
            content: next.actionLog,
            targetPage: next.actionTargetPage || "",
            owner: next.actionOwner,
            status: next.actionStatus,
            priority: next.actionPriority,
            completedAtDate: next.actionStatus === "done" ? (next.actionCompletedAtDate || next.updatedAt.slice(0, 10)) : null,
            monitorStartDate: next.updatedAt.slice(0, 10),
            fromDate: snapshotFrom,
            toDate: snapshotTo,
            metrics,
            targetMetricKey: next.actionTargetMetricKey || null,
            linkedDiagnosisId: latestDiagnosis?.id || null,
            linkedDiagnosisTitle: latestDiagnosis?.findings?.[0]?.title || null,
            linkedMetricKey: latestDiagnosis?.findings?.[0]?.metricKey || null,
            createdAt: next.updatedAt
          };
          entry.autoComment = summarizeActionLogProgress(entry, prevAction);
          entry.evaluations = buildEvaluationWindows(db, projectId, entry);
          entry.effectiveness = evaluateActionEffectiveness(entry);
          next.actionLogHistory.push(entry);
        }
      }
      next.actionLogHistory = next.actionLogHistory.map((item, index, arr) => {
        const enriched = {
          ...item,
          autoComment: summarizeActionLogProgress(item, index > 0 ? arr[index - 1] : null)
        };
        enriched.evaluations = buildEvaluationWindows(db, projectId, enriched);
        enriched.effectiveness = evaluateActionEffectiveness(enriched);
        return enriched;
      });
      db.projectContexts = db.projectContexts.filter((item) => item.projectId !== projectId);
      db.projectContexts.push(next);
      await writeDb(db);
      return json(res, 200, { context: next });
    }
  }

  const actionLogDeleteMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/context\/action-logs\/([^/]+)$/);
  if (req.method === "DELETE" && actionLogDeleteMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = actionLogDeleteMatch[1];
    const actionLogId = actionLogDeleteMatch[2];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });
    const existing = projectContextFor(db, projectId);
    existing.actionLogHistory = existing.actionLogHistory.filter((item) => item.id !== actionLogId);
    db.projectContexts = db.projectContexts.filter((item) => item.projectId !== projectId);
    db.projectContexts.push(existing);
    await writeDb(db);
    return json(res, 200, { ok: true });
  }

  const assistantHistoryMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/assistant\/history$/);
  if (req.method === "GET" && assistantHistoryMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = assistantHistoryMatch[1];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });
    const messages = db.assistantMessages
      .filter((item) => item.projectId === projectId && item.userId === user.id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(-20)
      .map((item) => ({
        role: item.role,
        content: item.content,
        createdAt: item.createdAt
      }));
    return json(res, 200, { messages });
  }

  const assistantChatMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/assistant\/chat$/);
  if (req.method === "POST" && assistantChatMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = assistantChatMatch[1];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });

    const body = await parseBody(req);
    const from = validateDate(String(body.from || "")) ? String(body.from) : isoDateOnly(new Date(Date.now() - 29 * ONE_DAY_MS));
    const to = validateDate(String(body.to || "")) ? String(body.to) : isoDateOnly(new Date());
    const compareFrom = validateDate(String(body.compareFrom || "")) ? String(body.compareFrom) : "";
    const compareTo = validateDate(String(body.compareTo || "")) ? String(body.compareTo) : "";
    const answerPayload = buildAssistantAnswer(db, project, {
      from,
      to,
      compareFrom,
      compareTo,
      message: String(body.message || ""),
      dimension: String(body.dimension || "channel")
    });

    const now = new Date().toISOString();
    db.assistantMessages.push({
      id: uid(),
      projectId,
      userId: user.id,
      role: "user",
      content: String(body.message || ""),
      createdAt: now
    });
    db.assistantMessages.push({
      id: uid(),
      projectId,
      userId: user.id,
      role: "assistant",
      content: answerPayload.answer,
      createdAt: new Date().toISOString()
    });
    await writeDb(db);

    return json(res, 200, answerPayload);
  }

  const recommendationMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/recommendations$/);
  if (req.method === "GET" && recommendationMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = recommendationMatch[1];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });

    const metricKey = urlObj.searchParams.get("metricKey");
    const rows = metricKey ? db.templates.filter((t) => t.metricKey === metricKey) : db.templates;
    return json(res, 200, { recommendations: rows });
  }

  const reportCreateMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/reports\/(pdf|ppt)$/);
  if (req.method === "POST" && reportCreateMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = reportCreateMatch[1];
    const format = reportCreateMatch[2];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });
    if (format === "ppt" && !userHasProPlan(db, user.id)) {
      return json(res, 402, {
        error: "feature_locked",
        feature: "ppt_export",
        requiredPlan: "pro",
        message: "PPTダウンロードはProプランで利用できます"
      });
    }

    const body = await parseBody(req);
    const { from, to } = body;
    if (!from || !to || !validateDate(from) || !validateDate(to)) {
      return json(res, 400, { error: "invalid_date_range" });
    }

    const rows = selectRowsForPeriod(db, projectId, from, to);
    const agg = aggregateMetricRows(rows);
    const metrics = computeRates(agg);
    const comparisons = buildMetricComparisons(db, metrics, project);
    const worstRows = groupedBreakdown(rows, "landing_page").sort((a, b) => a.metrics.pdp_reach_rate - b.metrics.pdp_reach_rate);
    const diagnosis = runDiagnosisFromAggregate(db, agg, {
      channel: groupedBreakdown(rows, "channel"),
      device: groupedBreakdown(rows, "device"),
      landing_page: worstRows
    }, project);
    const recommendations = pickTemplates(db, diagnosis.findings, projectId);

    const reportId = uid();
    const fileExt = format === "pdf" ? "html" : format;
    const fileName = `${reportId}.${fileExt}`;
    const filePath = path.join(REPORT_DIR, fileName);
    const outlineLines = asciiReportLines(
      project,
      from,
      to,
      metrics,
      comparisons,
      worstRows,
      diagnosis.findings,
      recommendations
    );
    const binary =
      format === "pdf"
        ? buildReportHtml(outlineLines, project, from, to, comparisons, worstRows, diagnosis.findings, recommendations)
        : buildSimplePptOutline(outlineLines);
    await fs.writeFile(filePath, binary);

    const job = {
      id: reportId,
      projectId,
      format,
      fromDate: from,
      toDate: to,
      status: "done",
      filePath,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.reportJobs.push(job);
    trackAppEvent(db, {
      eventType: "report_generated",
      userId: user.id,
      tenantId: project.tenantId,
      projectId: project.id,
      meta: { format }
    });
    await writeDb(db);

    return json(res, 201, { report: job });
  }

  const reportListMatch = urlObj.pathname.match(/^\/api\/projects\/([^/]+)\/reports$/);
  if (req.method === "GET" && reportListMatch) {
    const user = requireAuth();
    if (!user) return;
    const projectId = reportListMatch[1];
    const project = findProjectAccessible(db, projectId, user.id);
    if (!project) return json(res, 404, { error: "project_not_found" });

    const rows = db.reportJobs
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return json(res, 200, { reports: rows });
  }

  const reportDownloadMatch = urlObj.pathname.match(/^\/api\/reports\/([^/]+)\/download$/);
  if (req.method === "GET" && reportDownloadMatch) {
    const user = requireAuth();
    if (!user) return;
    const report = db.reportJobs.find((r) => r.id === reportDownloadMatch[1]);
    if (!report) return json(res, 404, { error: "report_not_found" });
    const project = findProjectAccessible(db, report.projectId, user.id);
    if (!project) return json(res, 403, { error: "forbidden" });

    const content = await fs.readFile(report.filePath);
    const ext = path.extname(report.filePath).toLowerCase();
    if (ext === ".html") {
      // Open HTML report inline in browser (user uses browser Print → PDF)
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(content);
    }
    const contentType =
      ext === ".pdf"
        ? "application/pdf"
        : "text/plain; charset=utf-16le";
    const dispName = report.format === "ppt" ? `veltio-report-${report.fromDate}.txt` : `report${ext}`;
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${dispName}"`
    });
    return res.end(content);
  }

  if (req.method === "POST" && urlObj.pathname === "/api/internal/batch/daily-sync") {
    for (const project of db.projects) {
      await syncProjectMetrics(db, project);
    }
    db.lastBatchRunAt = new Date().toISOString();
    await writeDb(db);
    return json(res, 200, { ok: true, syncedProjects: db.projects.length, lastBatchRunAt: db.lastBatchRunAt });
  }

  return notFound(res);
}

async function runDailyBatch() {
  const db = await readDb();
  for (const project of db.projects) {
    await syncProjectMetrics(db, project);
  }
  db.lastBatchRunAt = new Date().toISOString();
  await writeDb(db);
  console.log(`[batch] daily sync completed: ${db.lastBatchRunAt}`);
}

async function bootstrap() {
  await ensureStorage();

  // 起動時にSupabaseからロードしてキャッシュを温める
  const warmDb = await readDb();

  // 静的データをキャッシュに注入（Supabaseとは別管理）
  if (!Array.isArray(warmDb.templates) || warmDb.templates.length === 0) {
    warmDb.templates = RECOMMENDATION_TEMPLATES;
  }
  if (!Array.isArray(warmDb.benchmarks) || warmDb.benchmarks.length === 0) {
    warmDb.benchmarks = BENCHMARK_DEFAULTS;
  } else {
    const existingKeys = new Set(warmDb.benchmarks.map(b => b.metricKey));
    BENCHMARK_DEFAULTS.forEach(b => {
      if (!existingKeys.has(b.metricKey)) warmDb.benchmarks.push(b);
    });
  }
  if (!Array.isArray(warmDb.diagnosisRules) || warmDb.diagnosisRules.length === 0) {
    warmDb.diagnosisRules = DIAGNOSIS_RULE_DEFAULTS;
  }
  warmDb.tenants         = warmDb.tenants.map(t => ensureTenantDefaults(t));
  warmDb.projects        = warmDb.projects.map(p => ensureProjectDefaults(p));
  warmDb.projectContexts = warmDb.projectContexts.map(item => ensureProjectContextDefaults(item, item.projectId));
  warmDb.users           = warmDb.users.map(user => ({
    ...user,
    emailVerifiedAt: Object.prototype.hasOwnProperty.call(user, "emailVerifiedAt")
      ? user.emailVerifiedAt
      : (user.createdAt || new Date().toISOString()),
    emailVerification: user.emailVerification || null,
    passwordReset: user.passwordReset || null
  }));

  const server = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url || "/", `http://${req.headers.host}`);
      if (urlObj.pathname.startsWith("/api/")) {
        await handleApi(req, res, urlObj);
      } else {
        await serveStatic(req, res, urlObj);
      }
    } catch (err) {
      if (err.message === "invalid_json") {
        return json(res, 400, { error: "invalid_json" });
      }
      console.error(err);
      return json(res, 500, { error: "internal_server_error" });
    }
  });

  server.listen(PORT, () => {
    console.log(`server started on http://localhost:${PORT}`);
  });

  // Run batch on startup (catches up stale data from server sleep/restart)
  setTimeout(() => {
    runDailyBatch().catch((err) => console.error("startup batch error", err));
  }, 5000);

  // Then check every hour; only sync if ≥23h since last run
  setInterval(async () => {
    try {
      const db = await readDb();
      const lastRun = db.lastBatchRunAt ? new Date(db.lastBatchRunAt).getTime() : 0;
      if (Date.now() - lastRun >= 23 * 60 * 60 * 1000) {
        await runDailyBatch();
      }
    } catch (err) {
      console.error("batch interval error", err);
    }
  }, 60 * 60 * 1000);
}

bootstrap().catch((err) => {
  console.error("bootstrap error", err);
  process.exit(1);
});
