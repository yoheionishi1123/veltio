const state = {
  user: null,
  tenants: [],
  projects: [],
  projectId: null,
  from: null,
  to: null,
  comparePreset: "none",
  compareFrom: "",
  compareTo: "",
  granularity: "day",
  chartMetric: "sessions",
  account: null,
  activePage: "dashboard",
  latestDiagnosis: null,
  assistantHistoryLoaded: false,
  ga4Connection: null,
  projectContext: null,
  addingProject: false,
  selectedValidationActionId: null,
  selectedValidationWindowDays: 30,
  journey: null,
  isAdmin: false,
  adminFrom: null,
  adminTo: null,
  adminSearch: "",
  adminCache: { tenants: [], users: [], projects: [] },
  adminBusiness: null
};

const q = (id) => document.getElementById(id);

const SITE_DIAGNOSIS_MAP = {
  ec_emotional_connected_sell: {
    segment: "感性型 店舗連携モール",
    summary: "ブランド世界観と店舗連携を両立するOMO型ECです。Web単体ではなく店舗を含む統合体験が成果の中心です。",
    drivers: [
      "商品写真・着用画像・ブランドストーリーの質",
      "店舗在庫表示・店舗受け取りなどチャネル横断導線",
      "スタッフコーデや実店舗接客のWeb再現"
    ],
    goals: ["統合LTV", "EC化率", "CVR", "クロスユース率"],
    focus: ["直帰率", "PDP到達率", "カート追加率", "カート離脱率"]
  },
  ec_rational_none_sell: {
    segment: "理性型 EC",
    summary: "スペック・価格・比較性が重要な比較購買型ECです。",
    drivers: [
      "検索性と絞り込み機能",
      "価格競争力とスペック比較",
      "レビュー・在庫・納期の明瞭さ"
    ],
    goals: ["検索CVR", "客単価", "リピート購入率"],
    focus: ["PDP到達率", "カート追加率", "購入完了率"]
  },
  ec_rational_connected_sell: {
    segment: "理性型 店舗連携EC",
    summary: "比較購買に加え、店舗在庫や受取導線が重要なOMO型ECです。",
    drivers: [
      "店舗在庫可視化",
      "価格/納期/受取方法の比較しやすさ",
      "Webから店舗への送客導線"
    ],
    goals: ["CVR", "店舗受取率", "リピート率"],
    focus: ["PDP到達率", "checkout到達率", "購入完了率"]
  },
  web_complete_non_ec_media: {
    segment: "記事メディア / 商品紹介ポータル",
    summary: "PV・回遊・送客が主目的のメディア型サイトです。",
    drivers: [
      "SEOと記事量",
      "関連記事導線",
      "送客リンクの配置"
    ],
    goals: ["PV", "UU", "滞在時間", "送客数"],
    focus: ["直帰率", "回遊率", "LP別流入品質"]
  },
  web_complete_non_ec_brand: {
    segment: "広報 / ブランドサイト",
    summary: "認知・信頼・ブランド形成が主目的のサイトです。",
    drivers: [
      "世界観の一貫性",
      "企業情報・実績の明瞭さ",
      "SNSや指名検索への波及"
    ],
    goals: ["指名検索数", "SNSシェア", "採用応募数"],
    focus: ["直帰率", "主要ページ到達率", "滞在時間"]
  },
  lead_btob_consultative_lead: {
    segment: "BtoB ソリューション型",
    summary: "課題啓蒙と信頼醸成から商談化までつなぐBtoBリード獲得サイトです。",
    drivers: [
      "導入事例・ホワイトペーパー",
      "ウェビナー・お役立ち資料",
      "MQLから商談への質"
    ],
    goals: ["MQL数", "商談化率", "資料請求数"],
    focus: ["LP別CVR", "フォーム到達率", "フォーム離脱率"]
  },
  lead_btob_rational_lead: {
    segment: "BtoB 専門商品型",
    summary: "顧客の知識が高く、スペック・価格・デモ導線が重要なBtoBサイトです。",
    drivers: [
      "詳細スペック",
      "価格や比較資料",
      "デモ申込導線"
    ],
    goals: ["問い合わせ数", "見積依頼数", "デモ申込数"],
    focus: ["PDP到達率", "フォームCVR", "比較資料DL率"]
  },
  lead_btoc_urgent_lead: {
    segment: "BtoC 切迫型",
    summary: "今すぐ解決したいニーズに対応する、即時反応重視のリード型サイトです。",
    drivers: [
      "対応スピード訴求",
      "料金の明朗さ",
      "電話・予約ボタンの即時性"
    ],
    goals: ["電話タップ数", "即時予約数", "CPA"],
    focus: ["直帰率", "電話/予約CVR", "モバイルCTA率"]
  },
  lead_btoc_consultative_lead: {
    segment: "BtoC こだわり型",
    summary: "高額・長期検討で、情報量と安心感が重要な相談型サイトです。",
    drivers: [
      "写真・事例・比較情報の豊富さ",
      "資料請求の魅力",
      "スタッフや実績の信頼感"
    ],
    goals: ["資料請求数", "来店予約数", "相談申込数"],
    focus: ["主要ページ到達率", "資料請求CVR", "フォーム離脱率"]
  }
};

function fmtPct(n) {
  return `${(n * 100).toFixed(2)}%`;
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString();
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
  return text;
}

function downloadCsv(filename, headers, rows) {
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(","))
  ];
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function trackGa4(eventName, params = {}) {
  if (typeof window.gtag !== "function") return;
  window.gtag("event", eventName, params);
}

function getVisitorId() {
  const key = "veltio_vid";
  let value = localStorage.getItem(key);
  if (!value) {
    value = `vid_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    localStorage.setItem(key, value);
  }
  return value;
}

async function trackVisitor(eventType, meta = {}) {
  try {
    await fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType,
        anonymousId: getVisitorId(),
        path: location.pathname,
        page: state.activePage || "dashboard",
        ...meta
      })
    });
  } catch {
    // best effort
  }
  trackGa4(eventType === "page_view" ? "veltio_page_view" : eventType, meta);
}

function metricLabel(metricKey) {
  const map = {
    sessions: "Sessions",
    bounce_rate: "直帰率",
    pdp_reach_rate: "PDP到達率",
    add_to_cart_rate: "カート追加率",
    cart_abandon_rate: "カート離脱率",
    checkout_reach_rate: "checkout到達率",
    purchase_rate: "購入完了率",
    cvr: "CVR"
  };
  return map[metricKey] || metricKey;
}

function metricActualValue(dataBlock, metricKey) {
  if (!dataBlock) return 0;
  if (metricKey === "sessions") return dataBlock.totals?.sessions || 0;
  return dataBlock.metrics?.[metricKey] || 0;
}

function metricActualText(dataBlock, metricKey) {
  const value = metricActualValue(dataBlock, metricKey);
  return metricKey === "sessions" ? String(value) : fmtPct(value);
}

function metricCompareRatio(currentBlock, compareBlock, metricKey) {
  const current = metricActualValue(currentBlock, metricKey);
  const previous = metricActualValue(compareBlock, metricKey);
  if (!previous) return null;
  return (current / previous) - 1;
}

function metricImprovementDirection(metricKey, ratio) {
  if (ratio === null || ratio === 0) return "neutral";
  const lowerIsBetter = ["bounce_rate", "cart_abandon_rate"].includes(metricKey);
  const improved = lowerIsBetter ? ratio < 0 : ratio > 0;
  return improved ? "good" : "bad";
}

function metricCompareRatioMeta(currentBlock, compareBlock, metricKey, label) {
  const ratio = metricCompareRatio(currentBlock, compareBlock, metricKey);
  if (ratio === null) return null;
  const prefix = ratio >= 0 ? "+" : "";
  return {
    text: `${prefix}${(ratio * 100).toFixed(2)}%`,
    tone: metricImprovementDirection(metricKey, ratio)
  };
}

function currentProject() {
  return state.projects.find((item) => item.id === state.projectId) || state.projects[0] || null;
}

function comparePresetLabel(value) {
  const map = {
    none: "",
    prev_year: "前年",
    prev_year_same_week: "前年同週",
    prev_month: "前月",
    prev_month_same_week: "前月同週",
    custom: "カスタム期間"
  };
  return map[value] || "";
}

function statusLabel(value) {
  return {
    todo: "未着手",
    doing: "進行中",
    done: "完了"
  }[value] || value;
}

function priorityLabel(value) {
  return {
    high: "高",
    medium: "中",
    low: "低"
  }[value] || value;
}

function uiErrorText(err) {
  const detail = err?.data?.detail ? ` (${err.data.detail})` : "";
  if (err?.message) return `${err.message}${detail}`;
  return "不明なエラーが発生しました。";
}

function compactDimensionLabel(value, max = 56) {
  const text = String(value || "");
  if (text.length <= max) return text;
  const head = text.slice(0, 24);
  const tail = text.slice(-18);
  return `${head}...${tail}`;
}

function syncActionStatusUI() {
  const isDone = q("action-status").value === "done";
  q("action-completed-date").required = isDone;
  if (isDone) {
    q("action-completed-date").removeAttribute("disabled");
  } else {
    q("action-completed-date").removeAttribute("required");
  }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function shiftDateIso(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftMonthIso(iso, months) {
  const date = new Date(`${iso}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

function resolveCompareRange() {
  const preset = state.comparePreset || "none";
  if (preset === "none") return { compareFrom: "", compareTo: "" };
  if (preset === "custom") {
    return {
      compareFrom: q("compare-from-date").value,
      compareTo: q("compare-to-date").value
    };
  }
  if (preset === "prev_year") {
    return {
      compareFrom: shiftMonthIso(state.from, -12),
      compareTo: shiftMonthIso(state.to, -12)
    };
  }
  if (preset === "prev_year_same_week") {
    return {
      compareFrom: shiftDateIso(state.from, -364),
      compareTo: shiftDateIso(state.to, -364)
    };
  }
  if (preset === "prev_month") {
    return {
      compareFrom: shiftMonthIso(state.from, -1),
      compareTo: shiftMonthIso(state.to, -1)
    };
  }
  if (preset === "prev_month_same_week") {
    return {
      compareFrom: shiftDateIso(state.from, -28),
      compareTo: shiftDateIso(state.to, -28)
    };
  }
  return { compareFrom: "", compareTo: "" };
}

function syncComparePresetUI() {
  const custom = state.comparePreset === "custom";
  q("compare-from-date").classList.toggle("hidden", !custom);
  q("compare-to-date").classList.toggle("hidden", !custom);
  if (!custom) {
    const range = resolveCompareRange();
    q("compare-from-date").value = range.compareFrom;
    q("compare-to-date").value = range.compareTo;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function recommendationImage(label, color) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="240" height="180" viewBox="0 0 240 180">
      <rect width="240" height="180" rx="16" fill="${color || "#0a58ca"}" />
      <rect x="16" y="20" width="208" height="96" rx="10" fill="rgba(255,255,255,0.16)" />
      <rect x="16" y="128" width="120" height="12" rx="6" fill="rgba(255,255,255,0.45)" />
      <rect x="16" y="146" width="84" height="10" rx="5" fill="rgba(255,255,255,0.25)" />
      <text x="18" y="108" fill="white" font-size="26" font-family="Arial, sans-serif" font-weight="700">${escapeHtml(label || "CVR")}</text>
    </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function resolveSiteDiagnosis() {
  const model = q("diag-model").value;
  const intent = q("diag-intent").value;
  const store = q("diag-store").value;
  const goal = q("diag-goal").value;

  const exactKeys = [
    `${model}_${intent}_${store}_${goal}`,
    `${model}_${intent}_${goal}`
  ];
  for (const key of exactKeys) {
    if (SITE_DIAGNOSIS_MAP[key]) return SITE_DIAGNOSIS_MAP[key];
  }
  if (model === "web_complete_non_ec") {
    return SITE_DIAGNOSIS_MAP[goal === "brand" ? "web_complete_non_ec_brand" : "web_complete_non_ec_media"];
  }
  if (model === "lead_btob") {
    return SITE_DIAGNOSIS_MAP[intent === "rational" ? "lead_btob_rational_lead" : "lead_btob_consultative_lead"];
  }
  if (model === "lead_btoc") {
    return SITE_DIAGNOSIS_MAP[intent === "urgent" ? "lead_btoc_urgent_lead" : "lead_btoc_consultative_lead"];
  }
  return SITE_DIAGNOSIS_MAP[
    intent === "emotional" && store === "connected"
      ? "ec_emotional_connected_sell"
      : intent === "rational" && store === "connected"
        ? "ec_rational_connected_sell"
        : "ec_rational_none_sell"
  ];
}

function renderSiteDiagnosis() {
  const result = resolveSiteDiagnosis();
  q("site-diagnosis-result").innerHTML = `
    <div class="diag-title">${escapeHtml(result.segment)}</div>
    <div class="diag-text">${escapeHtml(result.summary)}</div>
    <div class="diag-text"><strong>成果ドライバー:</strong> ${escapeHtml(result.drivers.join(" / "))}</div>
    <div class="diag-text"><strong>主なゴール:</strong> ${escapeHtml(result.goals.join(" / "))}</div>
    <div class="diag-text"><strong>このアプリでまず追う指標:</strong> ${escapeHtml(result.focus.join(" / "))}</div>
  `;
}

function seriesMetricValue(item, metricKey) {
  return metricKey === "sessions" ? item.totals.sessions : item.metrics[metricKey] || 0;
}

function bucketEndForGranularity(bucket, granularity) {
  if (granularity === "week") return shiftDateIso(bucket, 6);
  if (granularity === "month") return shiftDateIso(shiftMonthIso(bucket, 1), -1);
  return bucket;
}

function renderTrendChart(series, metricKey, compareSeries = []) {
  const host = q("trend-chart");
  host.innerHTML = "";
  if (!series.length) {
    host.textContent = "データがありません。";
    return;
  }

  const width = 520;
  const height = 220;
  const pad = 28;
  const allValues = [
    ...series.map((item) => seriesMetricValue(item, metricKey)),
    ...compareSeries.map((item) => seriesMetricValue(item, metricKey))
  ];
  const maxValue = Math.max(...allValues, 1);
  const pointsMain = series
    .map((item, idx) => {
      const x = pad + (idx * (width - pad * 2)) / Math.max(series.length - 1, 1);
      const y = height - pad - (seriesMetricValue(item, metricKey) / maxValue) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");
  const pointsCompare = compareSeries
    .map((item, idx) => {
      const x = pad + (idx * (width - pad * 2)) / Math.max(compareSeries.length - 1, 1);
      const y = height - pad - (seriesMetricValue(item, metricKey) / maxValue) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");
  const activeCampaigns = (currentProject()?.campaigns || []).filter((item) => {
    const seriesStart = series[0]?.bucket;
    const seriesEnd = series[series.length - 1]?.bucket ? bucketEndForGranularity(series[series.length - 1].bucket, state.granularity) : null;
    if (!seriesStart || !seriesEnd) return false;
    return !(item.endDate < seriesStart || item.startDate > seriesEnd);
  });
  const campaignBands = activeCampaigns.map((item) => {
    let startIdx = -1;
    let endIdx = -1;
    series.forEach((point, idx) => {
      const bucketStart = point.bucket;
      const bucketEnd = bucketEndForGranularity(point.bucket, state.granularity);
      const overlaps = !(item.endDate < bucketStart || item.startDate > bucketEnd);
      if (overlaps) {
        if (startIdx === -1) startIdx = idx;
        endIdx = idx;
      }
    });
    if (startIdx === -1) return "";
    const startX = pad + (startIdx * (width - pad * 2)) / Math.max(series.length - 1, 1);
    const endX = pad + (endIdx * (width - pad * 2)) / Math.max(series.length - 1, 1);
    const rectWidth = Math.max(8, endX - startX + 8);
    return `
      <rect x="${startX - 4}" y="${pad}" width="${rectWidth}" height="${height - pad * 2}" fill="#f59e0b" opacity="0.10" rx="8"></rect>
      <text x="${startX}" y="${height - 8}" fill="#b45309" font-size="10">${escapeHtml(item.name)}</text>
    `;
  }).join("");

  host.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#f8fafc" rx="10"></rect>
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#cbd5e1"></line>
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#cbd5e1"></line>
      ${campaignBands}
      <polyline fill="none" stroke="#0a58ca" stroke-width="3" points="${pointsMain}"></polyline>
      ${pointsCompare ? `<polyline fill="none" stroke="#94a3b8" stroke-dasharray="6 4" stroke-width="3" points="${pointsCompare}"></polyline>` : ""}
      <text x="${pad}" y="18" fill="#0a58ca" font-size="12">${escapeHtml(metricLabel(metricKey))}</text>
      ${pointsCompare ? `<text x="${pad + 110}" y="18" fill="#94a3b8" font-size="12">${escapeHtml(comparePresetLabel(state.comparePreset) || "比較期間")}</text>` : ""}
      ${activeCampaigns.length ? `<text x="${pad + 240}" y="18" fill="#b45309" font-size="12">セール / キャンペーン期間</text>` : ""}
      <text x="${width - 90}" y="18" fill="#475467" font-size="12">${escapeHtml(state.granularity)}</text>
    </svg>
  `;
}

function renderChartSummary(data, metricKey) {
  const host = q("chart-summary");
  const currentText = metricActualText(data, metricKey);
  if (!data.compare) {
    host.innerHTML = `
      <div>対象指標: ${escapeHtml(metricLabel(metricKey))}</div>
      <div>現在期間 (${data.from} 〜 ${data.to}): ${escapeHtml(currentText)}</div>
    `;
    return;
  }
  const compareLabel = comparePresetLabel(state.comparePreset) || "比較期間";
  const previousText = metricActualText(data.compare, metricKey);
  const ratioMeta = metricCompareRatioMeta(data, data.compare, metricKey, compareLabel);
  host.innerHTML = `
    <div>対象指標: ${escapeHtml(metricLabel(metricKey))}</div>
    <div>現在期間 (${data.from} 〜 ${data.to}): ${escapeHtml(currentText)}</div>
    <div>${escapeHtml(compareLabel)} (${data.compare.from} 〜 ${data.compare.to}): ${escapeHtml(previousText)}</div>
    ${ratioMeta ? `<div class="compare-${ratioMeta.tone}">${escapeHtml(ratioMeta.text)}</div>` : ""}
  `;
}

function renderFunnelChart(funnel) {
  const host = q("funnel-chart");
  host.innerHTML = "";
  if (!funnel.length || funnel[0].value === 0) {
    host.textContent = "データがありません。";
    return;
  }

  const max = funnel[0].value || 1;
  host.innerHTML = funnel
    .map((item) => {
      const width = Math.max(8, (item.value / max) * 100);
      return `
        <div style="margin-bottom:8px;">
          <div class="tiny">${item.label} (${item.value})</div>
          <div style="background:#e2e8f0;border-radius:999px;overflow:hidden;">
            <div style="width:${width}%;background:#0a58ca;height:12px;"></div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderJourney(data) {
  const summary = q("journey-summary");
  const stepsHost = q("journey-steps");
  const channelHost = q("journey-channel-top");
  const deviceHost = q("journey-device-top");
  if (!data || !Array.isArray(data.steps) || !data.steps.length) {
    summary.textContent = "データがありません。";
    stepsHost.innerHTML = "";
    channelHost.innerHTML = "";
    deviceHost.innerHTML = "";
    return;
  }
  const primary = data.primaryDropoff;
  summary.innerHTML = primary
    ? `<div class="journey-alert">最大離脱: <strong>${escapeHtml(primary.fromLabel)} → ${escapeHtml(primary.toLabel)}</strong> / 離脱率 <strong>${fmtPct(primary.dropRate)}</strong> / 離脱セッション <strong>${fmtNum(primary.dropCount)}</strong></div>`
    : "<div class='journey-alert'>離脱分析のデータが不足しています。</div>";

  const max = data.steps[0]?.value || 1;
  stepsHost.innerHTML = data.steps.map((step, index) => {
    const prev = index > 0 ? data.steps[index - 1] : null;
    const passRate = prev ? (prev.value ? step.value / prev.value : 0) : 1;
    const dropCount = prev ? Math.max(0, prev.value - step.value) : 0;
    return `
      <article class="journey-step-card">
        <div class="journey-step-head">
          <div class="journey-step-name">${index + 1}. ${escapeHtml(step.label)}</div>
          <div class="journey-step-value">${fmtNum(step.value)}</div>
        </div>
        <div class="journey-step-track">
          <div class="journey-step-fill" style="width:${Math.max(4, (step.value / max) * 100)}%"></div>
        </div>
        <div class="journey-step-meta">
          ${prev ? `前段階通過率 ${fmtPct(passRate)} / 離脱 ${fmtNum(dropCount)}` : "起点セッション"}
        </div>
      </article>
    `;
  }).join("");

  const renderRank = (rows) => {
    if (!rows?.length) return "<div class='tiny muted'>データなし</div>";
    return rows.map((row, idx) => `
      <div class="journey-rank-row">
        <div class="journey-rank-title">${idx + 1}. ${escapeHtml(row.dimensionValue)}</div>
        <div class="journey-rank-meta">離脱率 ${fmtPct(row.dropRatio)} / Sessions ${fmtNum(row.sessions)}</div>
      </div>
    `).join("");
  };
  channelHost.innerHTML = renderRank(data.channelTop);
  deviceHost.innerHTML = renderRank(data.deviceTop);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || body.error || `HTTP ${res.status}`);
    err.code = body.error || `HTTP_${res.status}`;
    err.status = res.status;
    err.data = body;
    throw err;
  }
  return body;
}

function showAuth(mode = "login") {
  q("auth-view").classList.remove("hidden");
  q("app-view").classList.add("hidden");
  q("logout").classList.add("hidden");
  q("topbar-nav").classList.add("hidden");
  q("login-form").classList.toggle("hidden", mode !== "login");
  q("signup-form").classList.toggle("hidden", mode !== "signup");
  q("verify-form").classList.toggle("hidden", mode !== "verify");
  q("forgot-form").classList.toggle("hidden", mode !== "forgot");
  q("reset-form").classList.toggle("hidden", mode !== "reset");
  q("show-login").classList.toggle("active", mode === "login");
  q("show-signup").classList.toggle("active", mode === "signup");
}

function showApp() {
  q("auth-view").classList.add("hidden");
  q("app-view").classList.remove("hidden");
  q("logout").classList.remove("hidden");
  q("topbar-nav").classList.remove("hidden");
  setActivePage(state.activePage || "dashboard");
}

function syncAppPath() {
  const nextPath = state.activePage === "admin" ? "/admin" : "/";
  if (location.pathname !== nextPath) {
    history.replaceState({}, "", `${nextPath}${location.search || ""}${location.hash || ""}`);
  }
}

function renderProjectHeader() {
  const empty = state.projects.length === 0;
  const multi = state.projects.length > 1;
  const current = currentProject();
  q("project-empty-state").classList.toggle("hidden", !empty && !multi);
  q("project-current-card").classList.toggle("hidden", empty);
  q("project-actions").classList.toggle("hidden", empty);
  q("project-form").classList.toggle("hidden", !empty && !state.addingProject);

  if (empty) {
    q("project-status").textContent = "";
    q("project-current-card").innerHTML = "";
    q("project-target-cvr").value = "";
    q("project-goal-status").textContent = "";
    return;
  }

  q("project-current-card").innerHTML = `
    <div class="k">現在のプロジェクト</div>
    <div class="v">${escapeHtml(current?.name || "")}</div>
    <div class="k">${escapeHtml(current?.domain || "")}</div>
    <div class="k">目標CVR ${typeof current?.targetCvr === "number" ? fmtPct(current.targetCvr) : "未設定"}</div>
    ${multi ? `<div class="k">登録済み ${state.projects.length}件</div>` : ""}
  `;
  q("project-target-cvr").value = typeof current?.targetCvr === "number" ? (current.targetCvr * 100).toFixed(2) : "";
  q("show-add-project").textContent = "別プロパティを追加";
  q("project-status").textContent = "";
}

function setActivePage(page) {
  const allowed = state.isAdmin
    ? ["dashboard", "validation", "account", "assistant", "admin"]
    : ["dashboard", "validation", "account", "assistant"];
  state.activePage = allowed.includes(page) ? page : "dashboard";
  ["dashboard", "validation", "account", "assistant", "admin"].forEach((key) => {
    if (!q(`tab-${key}`) || !q(`page-${key}`)) return;
    q(`tab-${key}`).classList.toggle("active", key === state.activePage);
    q(`page-${key}`).classList.toggle("hidden", key !== state.activePage);
  });
  if (state.activePage === "assistant" && !state.assistantHistoryLoaded) {
    void loadAssistantHistory();
  }
  if (state.activePage === "admin" && state.isAdmin) {
    void loadAdminDashboard();
  }
  syncAppPath();
  void trackVisitor("page_view", { activePage: state.activePage });
}

function appendChatMessage(role, text) {
  const host = q("assistant-chat");
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = text;
  host.appendChild(bubble);
  host.scrollTop = host.scrollHeight;
}

function renderAssistantReferences(references = []) {
  const card = q("assistant-reference-card");
  const host = q("assistant-references");
  host.innerHTML = "";
  if (!references.length) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");
  references.forEach((item) => {
    const node = document.createElement("div");
    node.className = "timeline-item";
    node.innerHTML = `
      <div class="timeline-date">${escapeHtml(item.title || item.type || "reference")}</div>
      <div class="timeline-body">${escapeHtml(item.body || "")}</div>
    `;
    host.appendChild(node);
  });
}

function renderTopActionCard(context) {
  const host = q("top-action-card");
  const rows = (context?.actionLogHistory || []).slice();
  if (!rows.length) {
    host.classList.add("hidden");
    host.innerHTML = "";
    return;
  }
  rows.sort((a, b) => {
    const pa = a.effectiveness?.effectivePriority || a.priority || "medium";
    const pb = b.effectiveness?.effectivePriority || b.priority || "medium";
    const rank = { high: 3, medium: 2, low: 1 };
    if ((rank[pb] || 0) !== (rank[pa] || 0)) return (rank[pb] || 0) - (rank[pa] || 0);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  const topRows = rows.slice(0, 3);
  host.classList.remove("hidden");
  host.innerHTML = `
    <div class="k">今やる施策（上位3件）</div>
    ${topRows.map((item, index) => `
      <div style="margin-top:${index === 0 ? "8px" : "12px"};">
        <div class="v" style="font-size:16px;">${index + 1}. ${escapeHtml(item.content)}</div>
        <div class="k">担当 ${escapeHtml(item.owner || "-")} / 状態 ${escapeHtml(statusLabel(item.status || "todo"))} / 優先 ${escapeHtml(priorityLabel(item.effectiveness?.effectivePriority || item.priority || "medium"))}</div>
        ${item.effectiveness?.comment ? `<div class="k">${escapeHtml(item.effectiveness.comment)}</div>` : ""}
      </div>
    `).join("")}
  `;
}

function renderTimeline(hostId, items, formatter) {
  const host = q(hostId);
  host.innerHTML = "";
  if (!items || !items.length) {
    host.innerHTML = `<div class="tiny muted">まだ履歴はありません。</div>`;
    return;
  }
  items
    .slice()
    .reverse()
    .forEach((item) => {
      const node = document.createElement("div");
      const rendered = formatter(item);
      if (typeof rendered === "string") {
        node.className = "timeline-item";
        node.innerHTML = rendered;
      } else {
        node.className = rendered.className || "timeline-item";
        node.innerHTML = rendered.html || "";
      }
      host.appendChild(node);
    });
}

function renderActionLogTimeline(items) {
  renderTimeline("action-log-timeline", items || [], (item) => ({
    className: `timeline-item ${item.id === state.selectedValidationActionId ? "selected" : ""}`,
    html: `
      <div class="timeline-date">${new Date(item.createdAt).toLocaleString()}</div>
      <div class="timeline-body">${escapeHtml(item.content)}</div>
      <div class="timeline-badge-row">
        ${item.owner ? `<span class="timeline-badge">担当 ${escapeHtml(item.owner)}</span>` : ""}
        ${item.status ? `<span class="timeline-badge">状態 ${escapeHtml(statusLabel(item.status))}</span>` : ""}
        ${item.priority ? `<span class="timeline-badge">優先 ${escapeHtml(priorityLabel(item.priority))}</span>` : ""}
        ${item.effectiveness ? `<span class="timeline-badge">効果 ${escapeHtml(item.effectiveness.label)}</span>` : ""}
        ${item.effectiveness?.effectivePriority ? `<span class="timeline-badge">再優先 ${escapeHtml(priorityLabel(item.effectiveness.effectivePriority))}</span>` : ""}
      </div>
      ${item.completedAtDate ? `<div class="timeline-meta">完了日: ${escapeHtml(item.completedAtDate)}</div>` : ""}
      ${item.linkedDiagnosisTitle ? `<div class="timeline-meta">紐づけ診断: ${escapeHtml(item.linkedDiagnosisTitle)}</div>` : ""}
      ${item.autoComment ? `<div class="timeline-meta">改善コメント: ${escapeHtml(item.autoComment)}</div>` : ""}
      ${item.effectiveness?.comment ? `<div class="timeline-meta">効果判定: ${escapeHtml(item.effectiveness.comment)}</div>` : ""}
      ${(item.evaluations || []).map((evaluation) => `<div class="timeline-meta">${evaluation.days}日後: ${escapeHtml(evaluation.comment)}</div>`).join("")}
      <div class="timeline-actions">
        <button type="button" class="ghost view-action-log" data-id="${escapeHtml(item.id)}">比較を見る</button>
        <button type="button" class="ghost edit-action-log" data-id="${escapeHtml(item.id)}">編集</button>
        <button type="button" class="ghost delete-action-log" data-id="${escapeHtml(item.id)}">削除</button>
      </div>
    `
  }));
}

function validationMetricItems(entry) {
  const active = (entry?.evaluations || []).find((item) => item.days === state.selectedValidationWindowDays && item.available && item.metrics)
    || [...(entry?.evaluations || [])].reverse().find((item) => item.available && item.metrics);
  if (!entry?.metrics || !active?.metrics) return [];
  return [
    {
      key: "bounce_rate",
      label: "直帰率",
      before: entry.metrics.bounce_rate || 0,
      after: active.metrics.bounce_rate || 0
    },
    {
      key: "add_to_cart_rate",
      label: "カート追加率",
      before: entry.metrics.add_to_cart_rate || 0,
      after: active.metrics.add_to_cart_rate || 0
    },
    {
      key: "purchase_rate",
      label: "購入完了率",
      before: entry.metrics.purchase_rate || 0,
      after: active.metrics.purchase_rate || 0
    }
  ];
}

function renderValidationDetail(context) {
  const summary = q("validation-detail-summary");
  const cards = q("validation-detail-cards");
  const chart = q("validation-detail-chart");
  const rows = context?.actionLogHistory || [];
  if (!rows.length) {
    summary.textContent = "施策ログを保存すると、ここに前後比較を表示します。";
    cards.innerHTML = "";
    chart.textContent = "";
    return;
  }

  const selected = rows.find((item) => item.id === state.selectedValidationActionId) || rows[rows.length - 1];
  state.selectedValidationActionId = selected.id;
  const activeEvaluation = (selected.evaluations || []).find((item) => item.days === state.selectedValidationWindowDays && item.available && item.metrics)
    || [...(selected.evaluations || [])].reverse().find((item) => item.available && item.metrics);
  const metrics = validationMetricItems(selected);
  [7, 14, 30].forEach((days) => {
    q(`validation-window-${days}`).classList.toggle("active-filter", days === (activeEvaluation?.days || state.selectedValidationWindowDays));
  });

  summary.textContent = activeEvaluation
    ? `対象施策: ${selected.content} / 保存時点 ${selected.fromDate || "-"} 〜 ${selected.toDate || "-"} と、${activeEvaluation.days}日後 (${activeEvaluation.from} 〜 ${activeEvaluation.to}) を比較しています。`
    : `対象施策: ${selected.content} / まだ比較できる観測データがありません。`;

  if (!metrics.length) {
    cards.innerHTML = "";
    chart.textContent = "完了後の観測データがたまると、前後比較を表示します。";
    return;
  }

  cards.innerHTML = "";
  const max = Math.max(...metrics.flatMap((item) => [item.before, item.after]), 0.01);
  chart.innerHTML = `
    <div class="validation-detail-stack">
      ${metrics.map((item) => {
        const delta = item.after - item.before;
        const tone = metricImprovementDirection(item.key, item.before ? (item.after / item.before) - 1 : null);
        const beforeWidth = Math.max(4, (item.before / max) * 100);
        const afterWidth = Math.max(4, (item.after / max) * 100);
        return `
          <section class="validation-metric-card">
            <div class="validation-metric-head">
              <div class="validation-metric-name">${escapeHtml(item.label)}</div>
              <div class="k compare-${tone}">変化 ${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(2)}pt</div>
            </div>
            <div class="validation-metric-grid">
              <div class="card">
                <div class="k">施策前</div>
                <div class="v">${escapeHtml(fmtPct(item.before))}</div>
              </div>
              <div class="card">
                <div class="k">施策後</div>
                <div class="v">${escapeHtml(fmtPct(item.after))}</div>
              </div>
              <div class="card">
                <div class="k">評価</div>
                <div class="v compare-${tone}">${escapeHtml(delta >= 0 ? "+" : "")}${(delta * 100).toFixed(2)}pt</div>
              </div>
            </div>
            <div class="validation-bar">
              <div class="validation-bar-label">
                <span>施策前</span>
                <span>${escapeHtml(fmtPct(item.before))}</span>
              </div>
              <div class="validation-bar-track">
                <div class="validation-bar-fill-before" style="width:${beforeWidth}%;"></div>
              </div>
            </div>
            <div class="validation-bar">
              <div class="validation-bar-label">
                <span>施策後</span>
                <span>${escapeHtml(fmtPct(item.after))}</span>
              </div>
              <div class="validation-bar-track">
                <div class="validation-bar-fill-after" style="width:${afterWidth}%;"></div>
              </div>
            </div>
          </section>
        `;
      }).join("")}
    </div>
  `;
}

function renderCampaignList(campaigns) {
  const host = q("campaign-list");
  host.innerHTML = "";
  if (!campaigns.length) {
    host.innerHTML = `<div class="tiny muted">まだセール / キャンペーン期間は登録されていません。</div>`;
    return;
  }
  campaigns.forEach((item) => {
    const impact = item.impact || {};
    const currentCvr = impact.current ? fmtPct(impact.current.metrics?.cvr || 0) : "-";
    const baselineCvr = impact.baseline ? fmtPct(impact.baseline.metrics?.cvr || 0) : "-";
    const baselineDelta = typeof impact.delta?.cvr === "number" ? `${impact.delta.cvr >= 0 ? "+" : ""}${(impact.delta.cvr * 100).toFixed(2)}pt` : "-";
    const currentSessions = impact.current?.totals?.sessions ?? 0;
    const baselineSessions = impact.baseline?.totals?.sessions ?? 0;
    const sessionDelta = `${currentSessions - baselineSessions >= 0 ? "+" : ""}${currentSessions - baselineSessions}`;
    const currentRevenue = impact.current?.totals?.revenue ?? 0;
    const baselineRevenue = impact.baseline?.totals?.revenue ?? 0;
    const revenueDelta = `${currentRevenue - baselineRevenue >= 0 ? "+" : ""}${(currentRevenue - baselineRevenue).toFixed(0)}`;
    const currentAdd = impact.current ? fmtPct(impact.current.metrics?.add_to_cart_rate || 0) : "-";
    const baselineAdd = impact.baseline ? fmtPct(impact.baseline.metrics?.add_to_cart_rate || 0) : "-";
    const addDelta = typeof impact.delta?.add_to_cart_rate === "number" ? `${impact.delta.add_to_cart_rate >= 0 ? "+" : ""}${(impact.delta.add_to_cart_rate * 100).toFixed(2)}pt` : "-";
    const yearlyCvr = item.recurringAnnual && impact.yearly ? fmtPct(impact.yearly.metrics?.cvr || 0) : "未比較";
    const yearlyDelta = item.recurringAnnual && impact.yearly
      ? `${((impact.current.metrics?.cvr || 0) - (impact.yearly.metrics?.cvr || 0)) >= 0 ? "+" : ""}${(((impact.current.metrics?.cvr || 0) - (impact.yearly.metrics?.cvr || 0)) * 100).toFixed(2)}pt`
      : "未比較";
    const card = document.createElement("div");
    card.className = "breakdown-row-card";
    card.innerHTML = `
      <div class="breakdown-row-title">${escapeHtml(item.name)} <span class="tiny muted">(${item.type === "sale" ? "セール" : "キャンペーン"})</span></div>
      <div class="tiny muted">${item.startDate} 〜 ${item.endDate}${item.recurringAnnual ? ` / 毎年比較あり${impact.linkedPreviousCampaignId ? `（前回登録: ${impact.linkedPreviousCampaignName}）` : ""}` : ""}</div>
      <div class="campaign-impact-grid">
        <div class="card">
          <div class="k">期間CVR</div>
          <div class="v">${escapeHtml(currentCvr)}</div>
        </div>
        <div class="card">
          <div class="k">直前同日数CVR</div>
          <div class="v">${escapeHtml(baselineCvr)}</div>
          <div class="k">${escapeHtml(baselineDelta)}</div>
        </div>
        <div class="card">
          <div class="k">前年同施策CVR</div>
          <div class="v">${escapeHtml(yearlyCvr)}</div>
          <div class="k">${escapeHtml(yearlyDelta)}</div>
        </div>
        <div class="card">
          <div class="k">期間Sessions</div>
          <div class="v">${escapeHtml(String(currentSessions))}</div>
          <div class="k">直前比 ${escapeHtml(sessionDelta)}</div>
        </div>
        <div class="card">
          <div class="k">期間AddCart</div>
          <div class="v">${escapeHtml(currentAdd)}</div>
          <div class="k">直前比 ${escapeHtml(addDelta)}</div>
        </div>
        <div class="card">
          <div class="k">期間売上</div>
          <div class="v">${escapeHtml(String(Math.round(currentRevenue)))}</div>
          <div class="k">直前比 ${escapeHtml(revenueDelta)}</div>
        </div>
      </div>
      <div class="timeline-actions">
        <button type="button" class="ghost delete-campaign" data-id="${escapeHtml(item.id)}">削除</button>
      </div>
    `;
    host.appendChild(card);
  });
}

async function loadCampaigns() {
  if (!state.projectId) return;
  const out = await api(`/api/projects/${state.projectId}/campaigns`);
  const project = currentProject();
  if (project) {
    project.campaigns = out.campaigns.map((item) => ({ ...item }));
  }
  renderCampaignList(out.campaigns || []);
}

async function bootstrap() {
  state.from = daysAgoISO(29);
  state.to = todayISO();
  state.adminFrom = daysAgoISO(29);
  state.adminTo = todayISO();
  state.adminSearch = "";
  state.comparePreset = "none";
  state.compareFrom = "";
  state.compareTo = "";
  state.granularity = "day";
  state.chartMetric = "sessions";
  if (location.pathname === "/admin" || location.pathname.startsWith("/admin/")) {
    state.activePage = "admin";
  }
  q("from-date").value = state.from;
  q("to-date").value = state.to;
  q("compare-preset").value = state.comparePreset;
  q("compare-from-date").value = state.compareFrom;
  q("compare-to-date").value = state.compareTo;
  q("granularity-select").value = state.granularity;
  q("chart-metric-select").value = state.chartMetric;
  if (q("admin-from-date")) q("admin-from-date").value = state.adminFrom;
  if (q("admin-to-date")) q("admin-to-date").value = state.adminTo;
  if (q("admin-search")) q("admin-search").value = state.adminSearch;
  syncComparePresetUI();
  syncActionStatusUI();
  renderSiteDiagnosis();
  void trackVisitor("page_view", { activePage: location.pathname.startsWith("/admin") ? "admin" : "auth_or_dashboard" });

  try {
    const me = await api("/api/me");
    state.user = me.user;
    state.tenants = me.tenants;
    state.isAdmin = Boolean(me.isAdmin);
    q("tab-admin").classList.toggle("hidden", !state.isAdmin);
    showApp();
    showGa4CallbackMessage();
    await loadProjects();
  } catch {
    showAuth("login");
  }
}

function renderAdminTrendChart(data) {
  const host = q("admin-trend-chart");
  const rows = data?.series || [];
  if (!rows.length) {
    host.textContent = "データがありません。";
    return;
  }
  const width = 860;
  const height = 240;
  const pad = 36;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const maxTenant = Math.max(...rows.map((r) => r.tenantCount), 1);
  const maxActive = Math.max(...rows.map((r) => r.activeProjects), 1);
  const maxRevenue = Math.max(...rows.map((r) => r.revenue), 1);

  const points = (arr, maxVal) => arr.map((item, idx) => {
    const x = pad + (idx / Math.max(arr.length - 1, 1)) * innerW;
    const y = pad + (1 - ((item / maxVal) || 0)) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const xLabels = [0, Math.floor(rows.length / 2), rows.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((idx) => {
      const x = pad + (idx / Math.max(rows.length - 1, 1)) * innerW;
      return `<text x="${x.toFixed(1)}" y="${height - 8}" fill="#64748b" font-size="11" text-anchor="middle">${rows[idx].date}</text>`;
    })
    .join("");

  host.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#e2e8f0"/>
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#e2e8f0"/>
      <polyline fill="none" stroke="#0a58ca" stroke-width="2.4" points="${points(rows.map((r) => r.tenantCount), maxTenant)}"></polyline>
      <polyline fill="none" stroke="#0f766e" stroke-width="2.4" points="${points(rows.map((r) => r.activeProjects), maxActive)}"></polyline>
      <polyline fill="none" stroke="#b45309" stroke-width="2.4" points="${points(rows.map((r) => r.revenue), maxRevenue)}"></polyline>
      <text x="${pad}" y="16" fill="#0a58ca" font-size="12">企業数</text>
      <text x="${pad + 70}" y="16" fill="#0f766e" font-size="12">有効PJ数</text>
      <text x="${pad + 160}" y="16" fill="#b45309" font-size="12">売上</text>
      ${xLabels}
    </svg>
  `;
}

function renderAdminBusinessKpi(data) {
  state.adminBusiness = data || null;
  const cards = q("admin-business-kpi-cards");
  const funnel = q("admin-ga4-funnel");
  if (!data?.kpis) {
    cards.innerHTML = "<div class='tiny muted'>データがありません。</div>";
    funnel.innerHTML = "";
    return;
  }
  cards.innerHTML = `
    <div class="card"><div class="k">Veltioセッション</div><div class="v">${fmtNum(data.kpis.veltioSessions)}</div></div>
    <div class="card"><div class="k">期間新規企業</div><div class="v">${fmtNum(data.kpis.signupTenants)}</div></div>
    <div class="card"><div class="k">期間有料化数</div><div class="v">${fmtNum(data.kpis.paidConversions)}</div></div>
    <div class="card"><div class="k">課金CVR</div><div class="v">${fmtPct(data.kpis.paidCvr || 0)}</div></div>
    <div class="card"><div class="k">30日離脱率</div><div class="v">${fmtPct(data.kpis.churnRate30d || 0)}</div></div>
  `;
  const f = data.ga4Funnel || {};
  funnel.innerHTML = `
    <article class="journey-step-card"><div class="journey-step-head"><div class="journey-step-name">全プロジェクト</div><div class="journey-step-value">${fmtNum(f.totalProjects || 0)}</div></div></article>
    <article class="journey-step-card"><div class="journey-step-head"><div class="journey-step-name">GA4接続済み</div><div class="journey-step-value">${fmtNum(f.ga4ConnectedProjects || 0)}</div></div><div class="journey-step-meta">接続率 ${fmtPct(f.ga4ConnectRate || 0)}</div></article>
    <article class="journey-step-card"><div class="journey-step-head"><div class="journey-step-name">初回同期完了</div><div class="journey-step-value">${fmtNum(f.ga4SyncedProjects || 0)}</div></div><div class="journey-step-meta">同期率 ${fmtPct(f.ga4SyncRate || 0)}</div></article>
    <article class="journey-step-card"><div class="journey-step-head"><div class="journey-step-name">レポート生成済み</div><div class="journey-step-value">${fmtNum(f.reportProjects || 0)}</div></div><div class="journey-step-meta">活用率 ${fmtPct(f.reportActivationRate || 0)}</div></article>
  `;
}

function showGa4CallbackMessage() {
  const params = new URLSearchParams(location.search);
  const ga4 = params.get("ga4");
  if (!ga4) return;
  const reason = params.get("reason");
  const projectId = params.get("projectId");
  if (projectId) {
    state.projectId = projectId;
  }
  if (ga4 === "connected") {
    q("ga4-quick-status").textContent = "GA4 OAuth連携が完了しました。";
    trackGa4("ga4_connected", {});
  } else if (ga4 === "error") {
    q("ga4-quick-status").textContent = `GA4 OAuth連携に失敗しました: ${reason || "unknown_error"}`;
    trackGa4("ga4_connect_error", { reason: String(reason || "unknown_error").slice(0, 80) });
  }
  history.replaceState({}, "", location.pathname + location.hash);
}

async function loadProjects() {
  const data = await api("/api/projects");
  state.projects = data.projects;
  const sel = q("project-select");
  sel.innerHTML = "";

  if (state.projects.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "プロジェクトを作成してください";
    sel.appendChild(opt);
    state.projectId = null;
    state.assistantHistoryLoaded = false;
    state.projectContext = null;
    state.addingProject = true;
    renderProjectHeader();
    await loadAccount();
    return;
  }

  state.projects.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.domain})`;
    sel.appendChild(opt);
  });

  state.projectId = state.projectId || state.projects[0].id;
  sel.value = state.projectId;
  state.assistantHistoryLoaded = false;
  state.projectContext = null;
  state.addingProject = false;
  renderProjectHeader();
  await refreshAll();
}

async function refreshAll() {
  if (!state.projectId) return;
  await Promise.all([
    loadGa4Status(),
    loadMetrics(),
    loadJourney(),
    loadBreakdown(),
    loadLatestDiagnosis(),
    loadReports(),
    loadAccount(),
    loadProjectContext(),
    loadCampaigns()
  ]);
  if (state.isAdmin) {
    await loadAdminDashboard();
  }
}

async function loadAdminDashboard() {
  if (!state.isAdmin) return;
  const params = new URLSearchParams({
    from: state.adminFrom || daysAgoISO(29),
    to: state.adminTo || todayISO()
  });
  if (state.adminSearch) {
    params.set("q", state.adminSearch);
  }
  const [overview, trend, business, tenants, users, projects] = await Promise.all([
    api(`/api/admin/overview?${params.toString()}`),
    api(`/api/admin/trend?${params.toString()}`),
    api(`/api/admin/business-kpi?${params.toString()}`),
    api(`/api/admin/tenants?${params.toString()}`),
    api(`/api/admin/users?${params.toString()}`),
    api(`/api/admin/projects?${params.toString()}`)
  ]);
  state.adminCache = {
    tenants: tenants.rows || [],
    users: users.rows || [],
    projects: projects.rows || []
  };
  q("admin-status").textContent = `集計期間: ${overview.from} 〜 ${overview.to}${state.adminSearch ? ` / 検索: ${state.adminSearch}` : ""}`;
  renderAdminTrendChart(trend);
  renderAdminBusinessKpi(business);

  q("admin-overview-cards").innerHTML = `
    <div class="card"><div class="k">企業数</div><div class="v">${fmtNum(overview.totalTenants)}</div></div>
    <div class="card"><div class="k">ユーザー数</div><div class="v">${fmtNum(overview.totalUsers)}</div><div class="k">認証率 ${(overview.emailVerificationRate * 100).toFixed(1)}%</div></div>
    <div class="card"><div class="k">プロジェクト数</div><div class="v">${fmtNum(overview.totalProjects)}</div><div class="k">期間稼働 ${fmtNum(overview.activeProjects7d)}</div></div>
    <div class="card"><div class="k">GA4連携率</div><div class="v">${(overview.ga4ConnectedRate * 100).toFixed(1)}%</div><div class="k">同期エラー ${fmtNum(overview.ga4SyncErrors)}</div></div>
    <div class="card"><div class="k">期間Sessions</div><div class="v">${fmtNum(overview.sessions)}</div><div class="k">期間CVR ${(overview.cvr * 100).toFixed(2)}%</div></div>
    <div class="card"><div class="k">期間売上</div><div class="v">${fmtNum(Math.round(overview.revenue || 0))}</div><div class="k">期間Purchase ${fmtNum(overview.purchases)}</div></div>
    <div class="card"><div class="k">期間新規</div><div class="v">企業 ${fmtNum(overview.newTenants)}</div><div class="k">ユーザー ${fmtNum(overview.newUsers)} / プロジェクト ${fmtNum(overview.newProjects)}</div></div>
    <div class="card"><div class="k">生成レポート</div><div class="v">${fmtNum(overview.generatedReports)}</div></div>
  `;

  q("admin-tenants-body").innerHTML = state.adminCache.tenants.map((row) => `
    <tr>
      <td>${escapeHtml(row.companyName || row.accountName || "-")}</td>
      <td>${escapeHtml(row.plan || "-")}</td>
      <td>${fmtNum(row.users)}</td>
      <td>${fmtNum(row.projects)}</td>
      <td>${fmtNum(row.sessions || 0)}</td>
      <td>${fmtPct(row.cvr || 0)}</td>
      <td>${row.latestSyncAt ? new Date(row.latestSyncAt).toLocaleString() : "-"}</td>
      <td><button type="button" class="ghost admin-danger admin-delete-tenant" data-id="${escapeHtml(row.id)}" data-name="${escapeHtml(row.companyName || row.accountName || "")}">削除</button></td>
    </tr>
  `).join("");

  q("admin-users-body").innerHTML = state.adminCache.users.map((row) => `
    <tr>
      <td>${escapeHtml(row.email || "-")}</td>
      <td>${escapeHtml(row.displayName || "-")}</td>
      <td>${row.verified ? "認証済み" : "未認証"}</td>
      <td>${row.activeSession ? "有効" : "-"}</td>
      <td>${escapeHtml((row.tenants || []).join(", ") || "-")}</td>
      <td>${row.emailVerifiedAt ? new Date(row.emailVerifiedAt).toLocaleString() : "-"}</td>
    </tr>
  `).join("");

  q("admin-projects-body").innerHTML = state.adminCache.projects.map((row) => `
    <tr>
      <td>${escapeHtml(row.tenantName || "-")}</td>
      <td>${escapeHtml(row.name || "-")}</td>
      <td>${escapeHtml(row.domain || "-")}</td>
      <td>${escapeHtml(row.ga4PropertyId || "-")}</td>
      <td>${fmtNum(row.sessions || 0)}</td>
      <td>${fmtPct(row.cvr || 0)}</td>
      <td>${row.lastSyncError ? `<span class="error">${escapeHtml(row.lastSyncError)}</span>` : (row.lastSyncedAt ? `正常 (${new Date(row.lastSyncedAt).toLocaleString()})` : "未接続")}</td>
    </tr>
  `).join("");
}

async function loadGa4Status() {
  const data = await api(`/api/projects/${state.projectId}/ga4/status`);
  state.ga4Connection = data.connection || null;
  if (!data.connected) {
    q("ga4-reconnect").classList.add("hidden");
    q("ga4-status").innerHTML = `
      <div class="ga4-kicker">GA4</div>
      <div class="ga4-main">未接続</div>
      <div class="ga4-sub">Property ID を入力してかんたん接続してください。</div>
    `;
  } else {
    q("ga4-reconnect").classList.remove("hidden");
    const statusLine = data.connection.lastSyncError
      ? `更新エラー: ${data.connection.lastSyncError}`
      : data.connection.lastSyncedAt
        ? `最終更新: ${new Date(data.connection.lastSyncedAt).toLocaleString()}`
        : "接続直後です";
    q("ga4-status").innerHTML = `
      <div class="ga4-kicker">Connected GA4 Property</div>
      <div class="ga4-main">Property ${escapeHtml(data.connection.propertyId)}</div>
      <div class="ga4-sub">${escapeHtml(data.connection.accountEmail || "")}</div>
      <div class="ga4-sub">${escapeHtml(statusLine)}</div>
    `;
  }
}

async function loadMetrics() {
  const params = new URLSearchParams({
    from: state.from,
    to: state.to,
    granularity: state.granularity
  });
  if (state.compareFrom && state.compareTo) {
    params.set("compare_from", state.compareFrom);
    params.set("compare_to", state.compareTo);
  }
  let data;
  try {
    data = await api(`/api/projects/${state.projectId}/metrics?${params.toString()}`);
    q("compare-status").className = "tiny";
  } catch (err) {
    if (err.code === "feature_locked") {
      q("compare-status").className = "tiny locked";
      q("compare-status").textContent = err.message;
      params.delete("compare_from");
      params.delete("compare_to");
      data = await api(`/api/projects/${state.projectId}/metrics?${params.toString()}`);
    } else {
      throw err;
    }
  }
  const cards = q("metric-cards");
  cards.innerHTML = "";

  const orderedComparisons = (data.comparisons || []).slice().sort((a, b) => {
    if (a.metricKey === "cvr") return -1;
    if (b.metricKey === "cvr") return 1;
    return 0;
  });

  orderedComparisons.forEach((item) => {
    const card = document.createElement("div");
    card.className = item.metricKey === "cvr" ? "card action-focus-card" : "card";
    const status = item.status === "ok" ? "基準内" : `要改善 ${Math.abs(item.gap * 100).toFixed(2)}pt`;
    const delta = data.compare?.delta?.[item.metricKey];
    const currentText = metricActualText(data, item.metricKey);
    const compareText = data.compare ? metricActualText(data.compare, item.metricKey) : "";
    const compareRateMeta = data.compare ? metricCompareRatioMeta(data, data.compare, item.metricKey, "") : null;
    const cvrProgress = item.metricKey === "cvr" && item.target > 0 ? (item.value / item.target) : null;
    const cvrRemaining = item.metricKey === "cvr" ? Math.max(0, item.target - item.value) : null;
    card.innerHTML = `
      <div class="k">${item.label}</div>
      <div class="v">${escapeHtml(currentText)}</div>
      <div class="k">現在期間 (${data.from} 〜 ${data.to})</div>
      <div class="k">基準 ${fmtPct(item.target)}</div>
      ${cvrProgress !== null ? `<div class="k">目標進捗 ${Math.max(0, cvrProgress * 100).toFixed(2)}%</div>` : ""}
      ${cvrRemaining !== null ? `<div class="k">目標まで ${fmtPct(cvrRemaining)}</div>` : ""}
      <div class="k">${status}</div>
      ${data.compare ? `<div class="k">比較値 ${escapeHtml(compareText)}</div>` : ""}
      ${compareRateMeta ? `<div class="v compare-${compareRateMeta.tone}">${escapeHtml(compareRateMeta.text)}</div>` : ""}
      ${typeof delta === "number" ? `<div class="k">比較差 ${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(2)}pt</div>` : ""}
    `;
    cards.appendChild(card);
  });
  if (data.compare) {
    q("compare-status").className = "tiny";
    q("compare-status").textContent = `現在期間: ${data.from} 〜 ${data.to} / 比較期間: ${data.compare.from} 〜 ${data.compare.to}`;
  } else {
    q("compare-status").className = "tiny";
    q("compare-status").textContent = `現在期間: ${data.from} 〜 ${data.to}（比較なし）`;
  }
  renderTrendChart(data.series || [], state.chartMetric, data.compare?.series || []);
  renderChartSummary(data, state.chartMetric);
  renderFunnelChart(data.funnel || []);
}

async function loadJourney() {
  const data = await api(`/api/projects/${state.projectId}/journey?from=${state.from}&to=${state.to}`);
  state.journey = data;
  renderJourney(data);
}

async function loadBreakdown() {
  const dimension = q("dimension-select").value;
  const data = await api(`/api/projects/${state.projectId}/breakdown?dimension=${dimension}&from=${state.from}&to=${state.to}`);
  const body = q("breakdown-body");
  const cards = q("breakdown-cards");
  const tableWrap = q("breakdown-table-wrap");
  body.innerHTML = "";
  cards.innerHTML = "";
  const useCards = dimension === "landing_page" || window.innerWidth <= 768;
  tableWrap.classList.toggle("hidden", useCards);
  cards.classList.toggle("landing-mode", useCards);

  data.rows.slice(0, 12).forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="breakdown-dimension" title="${escapeHtml(row.dimensionValue)}">${escapeHtml(row.dimensionValue)}</span></td>
      <td>${row.sessions}</td>
      <td>${fmtPct(row.metrics.bounce_rate)}</td>
      <td>${fmtPct(row.metrics.pdp_reach_rate)}</td>
      <td>${fmtPct(row.metrics.add_to_cart_rate)}</td>
      <td>${fmtPct(row.metrics.cart_abandon_rate)}</td>
    `;
    body.appendChild(tr);

    const card = document.createElement("div");
    const compactLanding = dimension === "landing_page";
    card.className = compactLanding ? "breakdown-row-card breakdown-row-card-compact" : "breakdown-row-card";
    card.innerHTML = compactLanding
      ? `
        <div class="breakdown-row-title breakdown-row-title-inline" title="${escapeHtml(row.dimensionValue)}">${escapeHtml(compactDimensionLabel(row.dimensionValue))}</div>
        <div class="breakdown-inline-metrics-grid">
          <span><strong>Sessions</strong><em>${row.sessions}</em></span>
          <span><strong>Bounce</strong><em>${fmtPct(row.metrics.bounce_rate)}</em></span>
          <span><strong>PDP</strong><em>${fmtPct(row.metrics.pdp_reach_rate)}</em></span>
          <span><strong>AddCart</strong><em>${fmtPct(row.metrics.add_to_cart_rate)}</em></span>
          <span><strong>CartAbandon</strong><em>${fmtPct(row.metrics.cart_abandon_rate)}</em></span>
        </div>
      `
      : `
        <div class="breakdown-row-title">${escapeHtml(row.dimensionValue)}</div>
        <div class="breakdown-row-metrics">
          <div class="k">Sessions</div><div>${row.sessions}</div>
          <div class="k">Bounce</div><div>${fmtPct(row.metrics.bounce_rate)}</div>
          <div class="k">PDP</div><div>${fmtPct(row.metrics.pdp_reach_rate)}</div>
          <div class="k">AddCart</div><div>${fmtPct(row.metrics.add_to_cart_rate)}</div>
          <div class="k">CartAbandon</div><div>${fmtPct(row.metrics.cart_abandon_rate)}</div>
        </div>
      `;
    cards.appendChild(card);
  });
}

async function loadLatestDiagnosis() {
  const data = await api(`/api/projects/${state.projectId}/diagnosis/latest`);
  state.latestDiagnosis = data.result;
  renderDiagnosis(data.result);
}

function renderDiagnosis(result) {
  const el = q("diagnosis-result");
  const rec = q("recommendation-list");
  el.innerHTML = "";
  rec.innerHTML = "";

  if (!result) {
    el.textContent = "診断未実行";
    return;
  }

  const ul = document.createElement("ul");
  result.findings.forEach((f) => {
    const li = document.createElement("li");
    const worstText = f.worstHint ? ` / 悪化箇所 ${f.worstHint.dimension}:${f.worstHint.dimensionValue}` : "";
    li.textContent = `${f.title} [${f.severity}] - ${f.reason}${worstText}`;
    ul.appendChild(li);
  });
  el.appendChild(ul);

  result.recommendations.forEach((r) => {
    const card = document.createElement("div");
    card.className = "rec-card";
    const firstSteps = (r.actionSteps || [])
      .slice(0, 3)
      .map((step) => `<div class="rec-step">- ${escapeHtml(step)}</div>`)
      .join("");
    card.innerHTML = `
      <img alt="${escapeHtml(r.title)}" src="${recommendationImage(r.imageLabel, r.imageColor)}" />
      <div>
        <div class="rec-title">${escapeHtml(r.title)}</div>
        <div class="rec-meta">Impact:${r.impactScore} / Ease:${r.easeScore} / 検証:${escapeHtml(r.validationMetric)}</div>
        <div class="rec-summary">${escapeHtml(r.summary || "")}</div>
        ${firstSteps}
      </div>
    `;
    rec.appendChild(card);
  });
}

async function loadReports() {
  const data = await api(`/api/projects/${state.projectId}/reports`);
  const list = q("report-list");
  list.innerHTML = "";
  data.reports.forEach((r) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `/api/reports/${r.id}/download`;
    a.textContent = `${String(r.format || "pdf").toUpperCase()} ${r.fromDate}〜${r.toDate}`;
    a.target = "_blank";
    a.download = "";
    li.appendChild(a);
    list.appendChild(li);
  });
}

async function loadAccount() {
  const data = await api("/api/account");
  state.account = data.account;
  q("account-name").value = data.account.accountName || "";
  q("company-name").value = data.account.companyName || "";
  q("contact-name").value = data.account.contactName || "";
  q("job-title").value = data.account.jobTitle || "";
  q("account-plan").textContent = `プラン: ${String(data.account.plan).toUpperCase()}`;
  const sites = q("account-sites");
  sites.innerHTML = "";
  (data.account.projectUrls || []).forEach((url) => {
    const li = document.createElement("li");
    li.textContent = url;
    sites.appendChild(li);
  });
  const inviteList = q("invite-list");
  inviteList.innerHTML = "";
  (data.account.invitedUsers || []).forEach((email) => {
    const li = document.createElement("li");
    li.textContent = email;
    inviteList.appendChild(li);
  });
  q("invite-status").textContent = `${(data.account.invitedUsers || []).length}/3 使用中`;
  renderProjectHeader();
}

async function loadAssistantHistory() {
  const host = q("assistant-chat");
  host.innerHTML = "";
  if (!state.projectId) {
    appendChatMessage("assistant", "先にプロジェクトを作成してください。");
    state.assistantHistoryLoaded = true;
    return;
  }
  try {
    const out = await api(`/api/projects/${state.projectId}/assistant/history`);
    if (!out.messages.length) {
      appendChatMessage("assistant", "現在のプロジェクト・期間のGA4データを前提に回答します。ボトルネック、施策、チャネル差分の相談ができます。");
    } else {
      out.messages.forEach((item) => appendChatMessage(item.role, item.content));
    }
    state.assistantHistoryLoaded = true;
  } catch {
    appendChatMessage("assistant", "チャット履歴を読み込めませんでした。");
    state.assistantHistoryLoaded = true;
  }
}

async function loadProjectContext() {
  if (!state.projectId) return;
  const out = await api(`/api/projects/${state.projectId}/context`);
  state.projectContext = out.context;
  q("company-note").value = out.context.companyNote || "";
  q("action-log").value = out.context.actionLog || "";
  q("action-owner").value = out.context.actionOwner || "";
  q("action-status").value = out.context.actionStatus || "todo";
  q("action-priority").value = out.context.actionPriority || "medium";
  q("action-completed-date").value = out.context.actionCompletedAtDate || "";
  q("editing-action-log-id").value = "";
  q("cancel-edit-action-log").classList.add("hidden");
  q("assistant-context-status").textContent = "";
  const ids = new Set((out.context.actionLogHistory || []).map((item) => item.id));
  if (!ids.has(state.selectedValidationActionId)) {
    state.selectedValidationActionId = out.context.actionLogHistory?.length
      ? out.context.actionLogHistory[out.context.actionLogHistory.length - 1].id
      : null;
  }
  syncActionStatusUI();
  renderTopActionCard(out.context);
  renderTimeline("company-note-timeline", out.context.companyNoteHistory || [], (item) => `
    <div class="timeline-date">${new Date(item.createdAt).toLocaleString()}</div>
    <div class="timeline-body">${escapeHtml(item.content)}</div>
  `);
  renderActionLogTimeline(out.context.actionLogHistory || []);
  renderValidationDetail(out.context);
}

q("show-login").addEventListener("click", () => showAuth("login"));
q("show-signup").addEventListener("click", () => showAuth("signup"));
q("show-forgot").addEventListener("click", () => {
  q("forgot-email").value = q("login-email").value || "";
  q("forgot-status").textContent = "";
  showAuth("forgot");
});
q("back-to-login").addEventListener("click", () => showAuth("login"));
q("back-to-login-2").addEventListener("click", () => showAuth("login"));
q("tab-dashboard").addEventListener("click", () => setActivePage("dashboard"));
q("tab-validation").addEventListener("click", () => setActivePage("validation"));
q("tab-account").addEventListener("click", () => setActivePage("account"));
q("tab-assistant").addEventListener("click", () => setActivePage("assistant"));
q("tab-admin").addEventListener("click", () => setActivePage("admin"));
q("admin-apply").addEventListener("click", async () => {
  state.adminFrom = q("admin-from-date").value || daysAgoISO(29);
  state.adminTo = q("admin-to-date").value || todayISO();
  state.adminSearch = (q("admin-search").value || "").trim();
  await loadAdminDashboard();
});
q("admin-export-tenants").addEventListener("click", () => {
  const rows = state.adminCache.tenants || [];
  downloadCsv("veltio-admin-tenants.csv",
    ["company_name", "plan", "users", "projects", "sessions", "cvr", "latest_sync_at"],
    rows.map((row) => [
      row.companyName || row.accountName || "",
      row.plan || "",
      row.users ?? 0,
      row.projects ?? 0,
      row.sessions ?? 0,
      (row.cvr ?? 0).toFixed(6),
      row.latestSyncAt || ""
    ])
  );
});
q("admin-export-users").addEventListener("click", () => {
  const rows = state.adminCache.users || [];
  downloadCsv("veltio-admin-users.csv",
    ["email", "display_name", "verified", "active_session", "tenants", "email_verified_at"],
    rows.map((row) => [
      row.email || "",
      row.displayName || "",
      row.verified ? "true" : "false",
      row.activeSession ? "true" : "false",
      (row.tenants || []).join(" | "),
      row.emailVerifiedAt || ""
    ])
  );
});
q("admin-export-projects").addEventListener("click", () => {
  const rows = state.adminCache.projects || [];
  downloadCsv("veltio-admin-projects.csv",
    ["tenant_name", "project_name", "domain", "ga4_property_id", "sessions", "cvr", "last_synced_at", "last_sync_error"],
    rows.map((row) => [
      row.tenantName || "",
      row.name || "",
      row.domain || "",
      row.ga4PropertyId || "",
      row.sessions ?? 0,
      (row.cvr ?? 0).toFixed(6),
      row.lastSyncedAt || "",
      row.lastSyncError || ""
    ])
  );
});
q("admin-tenants-body").addEventListener("click", async (e) => {
  const target = e.target.closest(".admin-delete-tenant");
  if (!target) return;
  const tenantId = target.getAttribute("data-id");
  const tenantName = target.getAttribute("data-name") || "";
  const typed = prompt(`企業アカウントを削除します。\n確認のため企業名を入力してください。\n\n${tenantName}`);
  if (typed === null) return;
  try {
    await api(`/api/admin/tenants/${encodeURIComponent(tenantId)}`, {
      method: "DELETE",
      body: { confirmName: typed }
    });
    q("admin-status").textContent = `企業「${tenantName}」を削除しました。`;
    await loadAdminDashboard();
  } catch (err) {
    q("admin-status").textContent = `削除失敗: ${err.message}`;
  }
});
q("run-signup-diagnosis").addEventListener("click", () => {
  renderSiteDiagnosis();
});

q("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: {
        email: q("login-email").value,
        password: q("login-password").value
      }
    });
    trackGa4("login", { method: "email_password" });
    await bootstrap();
  } catch (err) {
    if (err.code === "email_not_verified") {
      q("verify-email").value = q("login-email").value;
      q("verify-status").textContent = uiErrorText(err);
      showAuth("verify");
      return;
    }
    alert(`ログイン失敗: ${err.message}`);
  }
});

q("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const out = await api("/api/auth/signup", {
      method: "POST",
      body: {
        tenantName: q("signup-tenant").value,
        displayName: q("signup-name").value,
        email: q("signup-email").value,
        password: q("signup-password").value
      }
    });
    trackGa4("sign_up", { method: "email_password" });
    q("verify-email").value = q("signup-email").value;
    q("verify-code").value = "";
    q("signup-status").textContent = "";
    q("verify-status").textContent = out.previewCode
      ? `確認コードを送信しました。開発環境プレビューコード: ${out.previewCode}`
      : "確認コードを送信しました。メールを確認してください。";
    showAuth("verify");
  } catch (err) {
    alert(`登録失敗: ${err.message}`);
  }
});

q("verify-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/auth/verify-email", {
      method: "POST",
      body: {
        email: q("verify-email").value,
        code: q("verify-code").value
      }
    });
    trackGa4("email_verify_completed", {});
    await bootstrap();
  } catch (err) {
    q("verify-status").textContent = uiErrorText(err);
  }
});

q("forgot-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const out = await api("/api/auth/forgot-password", {
      method: "POST",
      body: { email: q("forgot-email").value }
    });
    q("reset-email").value = q("forgot-email").value;
    q("reset-code").value = "";
    q("reset-password").value = "";
    q("forgot-status").textContent = out.previewCode
      ? `コード送信済み（開発プレビュー: ${out.previewCode}）`
      : (out.message || "コードを送信しました。");
    q("reset-status").textContent = "";
    showAuth("reset");
  } catch (err) {
    q("forgot-status").textContent = uiErrorText(err);
  }
});

q("reset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const out = await api("/api/auth/reset-password", {
      method: "POST",
      body: {
        email: q("reset-email").value,
        code: q("reset-code").value,
        newPassword: q("reset-password").value
      }
    });
    q("login-email").value = q("reset-email").value;
    q("reset-status").textContent = out.message || "パスワードを更新しました。";
    showAuth("login");
  } catch (err) {
    q("reset-status").textContent = uiErrorText(err);
  }
});

q("resend-code").addEventListener("click", async () => {
  try {
    const out = await api("/api/auth/resend-verification", {
      method: "POST",
      body: { email: q("verify-email").value }
    });
    q("verify-status").textContent = out.previewCode
      ? `確認コードを再送しました。開発環境プレビューコード: ${out.previewCode}`
      : out.message;
  } catch (err) {
    q("verify-status").textContent = uiErrorText(err);
  }
});

q("logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  location.reload();
});

q("project-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const tenantId = state.tenants[0]?.id;
  if (!tenantId) return alert("テナント情報がありません");

  try {
    const out = await api("/api/projects", {
      method: "POST",
      body: {
        tenantId,
        name: q("project-name").value,
        domain: q("project-domain").value
      }
    });
    state.projectId = out.project.id;
    q("project-name").value = "";
    q("project-domain").value = "";
    q("project-status").textContent = "";
    await loadProjects();
  } catch (err) {
    q("project-status").textContent = uiErrorText(err);
  }
});

q("project-select").addEventListener("change", async (e) => {
  state.projectId = e.target.value;
  state.assistantHistoryLoaded = false;
  state.projectContext = null;
  await refreshAll();
});

q("refresh-project").addEventListener("click", refreshAll);
q("show-add-project").addEventListener("click", () => {
  state.addingProject = !state.addingProject;
  q("project-status").textContent = "";
  renderProjectHeader();
});

q("project-goal-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.projectId) return;
  q("project-goal-status").textContent = "";
  try {
    const rawValue = q("project-target-cvr").value.trim();
    const targetCvr = rawValue ? Number(rawValue) / 100 : null;
    const out = await api(`/api/projects/${state.projectId}/settings`, {
      method: "POST",
      body: { targetCvr }
    });
    state.projects = state.projects.map((item) => item.id === out.project.id ? out.project : item);
    renderProjectHeader();
    q("project-goal-status").textContent = "保存しました。";
    await loadMetrics();
  } catch (err) {
    q("project-goal-status").textContent = uiErrorText(err);
  }
});

q("campaign-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.projectId) return;
  q("campaign-status").textContent = "";
  try {
    await api(`/api/projects/${state.projectId}/campaigns`, {
      method: "POST",
      body: {
        name: q("campaign-name").value,
        type: q("campaign-type").value,
        startDate: q("campaign-start-date").value,
        endDate: q("campaign-end-date").value,
        recurringAnnual: q("campaign-recurring").checked
      }
    });
    q("campaign-name").value = "";
    q("campaign-start-date").value = "";
    q("campaign-end-date").value = "";
    q("campaign-recurring").checked = false;
    q("campaign-status").textContent = "保存しました。";
    await loadCampaigns();
  } catch (err) {
    q("campaign-status").textContent = uiErrorText(err);
  }
});

q("campaign-list").addEventListener("click", async (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.classList.contains("delete-campaign")) return;
  const id = target.dataset.id;
  if (!id || !confirm("このセール / キャンペーンを削除しますか？")) return;
  try {
    await api(`/api/projects/${state.projectId}/campaigns/${id}`, { method: "DELETE" });
    await loadCampaigns();
  } catch (err) {
    q("campaign-status").textContent = uiErrorText(err);
  }
});

q("ga4-quick-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.projectId) {
    q("ga4-quick-status").textContent = "先にプロジェクトを作成してください。";
    return;
  }
  q("ga4-quick-status").textContent = "接続中...";
  try {
    const out = await api(`/api/projects/${state.projectId}/ga4/quick-connect`, {
      method: "POST",
      body: {
        ga4Input: q("ga4-quick-input").value,
        accountEmail: q("ga4-quick-email").value
      }
    });
    q("ga4-quick-status").textContent = `OAuth画面へ移動します: Property ${out.propertyId}`;
    location.href = out.authUrl;
  } catch (err) {
    q("ga4-quick-status").textContent = "";
    alert(`GA4かんたん接続失敗: ${err.message}`);
  }
});

q("ga4-reconnect").addEventListener("click", async () => {
  if (!state.projectId || !state.ga4Connection?.propertyId) return;
  q("ga4-quick-status").textContent = "再連携中...";
  try {
    const out = await api(`/api/projects/${state.projectId}/ga4/quick-connect`, {
      method: "POST",
      body: {
        ga4Input: state.ga4Connection.propertyId,
        accountEmail: state.ga4Connection.accountEmail || ""
      }
    });
    location.href = out.authUrl;
  } catch (err) {
    q("ga4-quick-status").textContent = "";
    alert(`GA4再連携失敗: ${err.message}`);
  }
});

q("apply-range").addEventListener("click", async () => {
  state.from = q("from-date").value;
  state.to = q("to-date").value;
  state.comparePreset = q("compare-preset").value;
  const compareRange = resolveCompareRange();
  state.compareFrom = compareRange.compareFrom;
  state.compareTo = compareRange.compareTo;
  q("compare-from-date").value = state.compareFrom;
  q("compare-to-date").value = state.compareTo;
  state.granularity = q("granularity-select").value;
  await refreshAll();
});

q("compare-preset").addEventListener("change", (e) => {
  state.comparePreset = e.target.value;
  syncComparePresetUI();
});

q("action-status").addEventListener("change", (e) => {
  if (e.target.value === "done" && !q("action-completed-date").value) {
    q("action-completed-date").value = todayISO();
  }
  syncActionStatusUI();
});

q("chart-metric-select").addEventListener("change", async (e) => {
  state.chartMetric = e.target.value;
  await loadMetrics();
});

q("load-breakdown").addEventListener("click", loadBreakdown);

q("run-diagnosis").addEventListener("click", async () => {
  if (!state.projectId) return;
  const data = await api(`/api/projects/${state.projectId}/diagnosis/run?from=${state.from}&to=${state.to}`, {
    method: "POST"
  });
  renderDiagnosis(data.result);
});

async function createReport(format) {
  if (!state.projectId) return;
  try {
    await api(`/api/projects/${state.projectId}/reports/${format}`, {
      method: "POST",
      body: { from: state.from, to: state.to }
    });
    trackGa4("report_generated", { report_format: format });
    q("report-status").className = "tiny";
    q("report-status").textContent = `${String(format).toUpperCase()} を生成しました。`;
    await loadReports();
  } catch (err) {
    q("report-status").className = "tiny locked";
    q("report-status").textContent = err.message;
  }
}

q("create-report-pdf").addEventListener("click", async () => createReport("pdf"));
q("create-report-ppt").addEventListener("click", async () => createReport("ppt"));

q("account-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/account/profile", {
      method: "POST",
      body: {
        accountName: q("account-name").value,
        companyName: q("company-name").value,
        contactName: q("contact-name").value,
        jobTitle: q("job-title").value
      }
    });
    await loadAccount();
  } catch (err) {
    alert(`プロフィール保存失敗: ${err.message}`);
  }
});

q("invite-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/account/invites", {
      method: "POST",
      body: { email: q("invite-email").value }
    });
    q("invite-email").value = "";
    q("invite-status").className = "tiny";
    await loadAccount();
  } catch (err) {
    q("invite-status").className = "tiny locked";
    q("invite-status").textContent = err.message;
  }
});

q("upgrade-plan").addEventListener("click", async () => {
  await api("/api/account/plan", {
    method: "POST",
    body: { plan: "pro" }
  });
  trackGa4("upgrade_to_pro", {});
  q("report-status").className = "tiny";
  q("report-status").textContent = "Proプランに更新しました。";
  await loadAccount();
});

q("send-test-email").addEventListener("click", async () => {
  q("test-email-status").textContent = "送信中...";
  try {
    const out = await api("/api/account/email-delivery/test", {
      method: "POST"
    });
    q("test-email-status").textContent = out.previewCode
      ? `開発環境プレビューコード: ${out.previewCode}`
      : "送信しました。受信箱を確認してください。";
  } catch (err) {
    q("test-email-status").textContent = uiErrorText(err);
  }
});

q("assistant-context-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.projectId) return;
  try {
    if (q("action-status").value === "done" && !q("action-completed-date").value) {
      q("assistant-context-status").textContent = "状態が完了の場合、完了日は必須です。";
      return;
    }
    await api(`/api/projects/${state.projectId}/context`, {
      method: "POST",
      body: {
        companyNote: q("company-note").value,
        actionLog: q("action-log").value,
        actionLogId: q("editing-action-log-id").value,
        actionOwner: q("action-owner").value,
        actionStatus: q("action-status").value,
        actionPriority: q("action-priority").value,
        actionCompletedAtDate: q("action-completed-date").value,
        from: state.from,
        to: state.to
      }
    });
    q("assistant-context-status").textContent = "保存しました。";
    await loadProjectContext();
  } catch (err) {
    q("assistant-context-status").textContent = err.message;
  }
});

q("cancel-edit-action-log").addEventListener("click", () => {
  q("editing-action-log-id").value = "";
  q("action-log").value = "";
  q("action-owner").value = state.projectContext?.actionOwner || "";
  q("action-status").value = state.projectContext?.actionStatus || "todo";
  q("action-priority").value = state.projectContext?.actionPriority || "medium";
  q("action-completed-date").value = "";
  q("cancel-edit-action-log").classList.add("hidden");
  q("assistant-context-status").textContent = "";
  syncActionStatusUI();
});

q("action-log-timeline").addEventListener("click", async (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const editId = target.dataset.id;
  if (target.classList.contains("view-action-log")) {
    state.selectedValidationActionId = editId || null;
    renderActionLogTimeline(state.projectContext?.actionLogHistory || []);
    renderValidationDetail(state.projectContext);
    return;
  }
  if (target.classList.contains("edit-action-log")) {
    const row = (state.projectContext?.actionLogHistory || []).find((item) => item.id === editId);
    if (!row) return;
    q("editing-action-log-id").value = row.id;
    q("action-log").value = row.content || "";
    q("action-owner").value = row.owner || "";
    q("action-status").value = row.status || "todo";
    q("action-priority").value = row.priority || "medium";
    q("action-completed-date").value = row.completedAtDate || "";
    q("cancel-edit-action-log").classList.remove("hidden");
    q("assistant-context-status").textContent = "施策ログを編集中です。保存で更新します。";
    syncActionStatusUI();
    return;
  }
  if (target.classList.contains("delete-action-log")) {
    if (!editId || !confirm("この施策ログを削除しますか？")) return;
    try {
      await api(`/api/projects/${state.projectId}/context/action-logs/${editId}`, {
        method: "DELETE"
      });
      await loadProjectContext();
    } catch (err) {
      q("assistant-context-status").textContent = err.message;
    }
  }
});

[7, 14, 30].forEach((days) => {
  q(`validation-window-${days}`).addEventListener("click", () => {
    state.selectedValidationWindowDays = days;
    renderValidationDetail(state.projectContext);
  });
});

async function sendAssistantMessage(message) {
  const text = String(message || "").trim();
  if (!text) return;
  if (!state.projectId) {
    appendChatMessage("assistant", "先にプロジェクトを作成してください。");
    return;
  }
  appendChatMessage("user", text);
  q("assistant-input").value = "";
  q("assistant-status").textContent = "回答中...";
  try {
    const out = await api(`/api/projects/${state.projectId}/assistant/chat`, {
      method: "POST",
      body: {
        message: text,
        from: state.from,
        to: state.to,
        compareFrom: state.compareFrom,
        compareTo: state.compareTo,
        dimension: q("dimension-select").value
      }
    });
    appendChatMessage("assistant", out.answer);
    renderAssistantReferences(out.references || []);
    state.assistantHistoryLoaded = true;
    q("assistant-status").textContent = "";
  } catch (err) {
    q("assistant-status").textContent = "";
    renderAssistantReferences([]);
    appendChatMessage("assistant", `回答できませんでした: ${err.message}`);
  }
}

q("assistant-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await sendAssistantMessage(q("assistant-input").value);
});

Array.from(document.querySelectorAll(".suggestion-chip")).forEach((button) => {
  button.addEventListener("click", async () => {
    await sendAssistantMessage(button.dataset.message || "");
  });
});

bootstrap();
