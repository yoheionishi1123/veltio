# Veltio MVP設計

## 1. DBスキーマ（PostgreSQL想定）

```sql
-- tenants: 企業単位
CREATE TABLE tenants (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'starter',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- users: 認証ユーザー
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- tenant_memberships: マルチテナント所属
CREATE TABLE tenant_memberships (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);

-- projects: 1サイト=1プロジェクト
CREATE TABLE projects (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  currency TEXT NOT NULL DEFAULT 'JPY',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ga4_connections: OAuthトークン
CREATE TABLE ga4_connections (
  id UUID PRIMARY KEY,
  project_id UUID UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ga4_property_id TEXT NOT NULL,
  account_email TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- project_stage_rules: PDP/Cart/Checkout判定ルール
CREATE TABLE project_stage_rules (
  id UUID PRIMARY KEY,
  project_id UUID UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pdp_event_name TEXT NOT NULL DEFAULT 'view_item',
  pdp_url_pattern TEXT,
  cart_event_name TEXT NOT NULL DEFAULT 'view_cart',
  cart_alt_event_name TEXT DEFAULT 'begin_checkout',
  cart_url_pattern TEXT,
  checkout_event_name TEXT NOT NULL DEFAULT 'begin_checkout',
  checkout_url_pattern TEXT,
  cart_reach_mode TEXT NOT NULL CHECK (cart_reach_mode IN ('view_cart_or_begin_checkout','view_cart_only','begin_checkout_only')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- metric_daily: 日次集計キャッシュ
CREATE TABLE metric_daily (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  channel TEXT NOT NULL,
  device TEXT NOT NULL,
  landing_page TEXT NOT NULL,
  sessions INTEGER NOT NULL,
  engaged_sessions INTEGER NOT NULL,
  pdp_sessions INTEGER NOT NULL,
  add_to_cart_sessions INTEGER NOT NULL,
  cart_reach_sessions INTEGER NOT NULL,
  checkout_sessions INTEGER NOT NULL,
  purchase_sessions INTEGER NOT NULL,
  revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, date, channel, device, landing_page)
);

-- diagnosis_results: ルール診断スナップショット
CREATE TABLE diagnosis_results (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  bottleneck_stage TEXT NOT NULL,
  title TEXT NOT NULL,
  reason TEXT NOT NULL,
  metrics JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- recommendation_templates: 施策テンプレ
CREATE TABLE recommendation_templates (
  id UUID PRIMARY KEY,
  metric_key TEXT NOT NULL,
  cause_category TEXT NOT NULL,
  title TEXT NOT NULL,
  action_steps JSONB NOT NULL,
  impact_score INTEGER NOT NULL CHECK (impact_score BETWEEN 1 AND 5),
  ease_score INTEGER NOT NULL CHECK (ease_score BETWEEN 1 AND 5),
  validation_metric TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- report_jobs: PDF生成ジョブ
CREATE TABLE report_jobs (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
  file_path TEXT,
  error_message TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## 2. 画面遷移

1. `/login` ログイン
2. `/signup` テナント作成付きサインアップ
3. `/projects` プロジェクト一覧
4. `/projects/new` 新規プロジェクト作成（サイト情報）
5. `/projects/:id/setup` GA4連携・PDP/Cart/Checkout判定
6. `/projects/:id/dashboard` 主要6指標と推移
7. `/projects/:id/breakdown` チャネル/デバイス/LP比較・ワーストランキング
8. `/projects/:id/diagnosis` 自動診断（詰まり判定 + 理由）
9. `/projects/:id/recommendations` 施策テンプレ（Impact/Ease・検証指標）
10. `/projects/:id/reports` PDFレポート生成・履歴

## 3. API設計（MVP）

### 認証/テナント
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`

### プロジェクト
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`

### GA4連携/セットアップ
- `POST /api/projects/:projectId/ga4/connect` (OAuth code受取)
- `GET /api/projects/:projectId/ga4/status`
- `POST /api/projects/:projectId/setup/stage-rules`
- `GET /api/projects/:projectId/setup/stage-rules`

### 指標/分析
- `GET /api/projects/:projectId/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/projects/:projectId/breakdown?dimension=channel|device|landing_page&from=&to=`
- `GET /api/projects/:projectId/worst?dimension=channel|device|landing_page&limit=5&from=&to=`

### 診断/施策
- `POST /api/projects/:projectId/diagnosis/run?from=&to=`
- `GET /api/projects/:projectId/diagnosis/latest`
- `GET /api/projects/:projectId/recommendations?metricKey=&severity=`

### レポート
- `POST /api/projects/:projectId/reports/pdf`
- `GET /api/projects/:projectId/reports`
- `GET /api/reports/:reportId/download`

### バッチ
- `POST /api/internal/batch/daily-sync`（cronから実行）

## 4. GA4 Data API取得クエリ例（疑似）

```ts
// runReport: 全体指標（日次）
POST https://analyticsdata.googleapis.com/v1beta/properties/{propertyId}:runReport
{
  "dateRanges": [{ "startDate": "2026-02-01", "endDate": "2026-02-21" }],
  "dimensions": [
    { "name": "date" },
    { "name": "sessionDefaultChannelGroup" },
    { "name": "deviceCategory" },
    { "name": "landingPagePlusQueryString" }
  ],
  "metrics": [
    { "name": "sessions" },
    { "name": "engagementRate" },
    { "name": "eventCount" },
    { "name": "totalRevenue" }
  ],
  "dimensionFilter": {
    "filter": {
      "fieldName": "eventName",
      "inListFilter": {
        "values": ["view_item", "add_to_cart", "view_cart", "begin_checkout", "purchase"]
      }
    }
  }
}
```

```ts
// runReport: イベント別セッション数
POST ...:runReport
{
  "dateRanges": [{ "startDate": "2026-02-01", "endDate": "2026-02-21" }],
  "dimensions": [
    { "name": "eventName" },
    { "name": "sessionDefaultChannelGroup" },
    { "name": "deviceCategory" },
    { "name": "landingPagePlusQueryString" }
  ],
  "metrics": [{ "name": "sessions" }],
  "dimensionFilter": {
    "orGroup": {
      "expressions": [
        { "filter": { "fieldName": "eventName", "stringFilter": { "value": "view_item" } } },
        { "filter": { "fieldName": "eventName", "stringFilter": { "value": "add_to_cart" } } },
        { "filter": { "fieldName": "eventName", "stringFilter": { "value": "view_cart" } } },
        { "filter": { "fieldName": "eventName", "stringFilter": { "value": "begin_checkout" } } },
        { "filter": { "fieldName": "eventName", "stringFilter": { "value": "purchase" } } }
      ]
    }
  }
}
```

集計後の計算式:
- `bounce_rate = 1 - engagement_rate`
- `pdp_reach_rate = pdp_sessions / sessions`
- `add_to_cart_rate = add_to_cart_sessions / pdp_sessions`
- `cart_abandon_rate = (cart_reach_sessions - purchase_sessions) / cart_reach_sessions`
- `checkout_reach_rate = checkout_sessions / cart_reach_sessions`
- `purchase_rate = purchase_sessions / checkout_sessions`

## 5. 診断ロジック（ルール案）

### 基本しきい値（初期値）
- Bounce高止まり: `bounce_rate >= 0.65`
- PDP到達不足: `pdp_reach_rate < 0.30`
- カート追加不足: `add_to_cart_rate < 0.20`
- カート離脱過多: `cart_abandon_rate >= 0.70`
- Checkout到達不足: `checkout_reach_rate < 0.45`
- 購入完了不足: `purchase_rate < 0.35`

### 判定ルール
1. `bounce_rate` が閾値超えかつ LP別ワーストの偏差が大きい場合
   - ボトルネック: `landing_page`
   - 原因候補: ファーストビュー訴求弱い/流入ミスマッチ/表示速度
2. `pdp_reach_rate` が低く、チャネル別で広告流入が特に低い場合
   - ボトルネック: `navigation_to_pdp`
   - 原因候補: 一覧導線不足/検索性低い/在庫切れ導線
3. `add_to_cart_rate` が低く、デバイス別でSPのみ悪化
   - ボトルネック: `pdp_to_cart`
   - 原因候補: CTA視認性/サイズ選択UX/価格送料不明瞭
4. `cart_abandon_rate` 高く、checkout_reach_rate 低い
   - ボトルネック: `cart_to_checkout`
   - 原因候補: 送料・手数料表示タイミング/クーポン入力導線
5. `purchase_rate` 低く、checkout到達後に離脱
   - ボトルネック: `checkout_to_purchase`
   - 原因候補: 決済手段不足/フォーム長い/エラー率

### 優先度
- `severity_score = impact_gap * traffic_weight * confidence`
- `impact_gap`: 閾値との差
- `traffic_weight`: 当該セッション比率
- `confidence`: サンプル数（セッション数）による補正

## 6. 実装計画（MVP）

1. Node.js APIサーバーと静的フロント基盤作成（認証・セッション）
2. JSONベースの永続層実装（DBスキーマ対応の構造）
3. プロジェクト管理・GA4接続状態・セットアップAPI実装
4. 指標集計ロジック（定義式準拠）と分解API実装
5. ルールベース診断エンジン + 施策テンプレ返却API実装
6. PDFレポート（MVPはテキストレポートを `.pdf` 拡張子で保存）実装
7. 日次バッチ（24時間ごと）で疑似GA4取り込み・集計キャッシュ更新
8. フロント実装（画面遷移/ダッシュボード/診断/レポート）
9. 動作確認と最小README整備
