# Veltio

## 起動

```bash
npm start
```

起動後: `http://localhost:3210`

## 実装範囲

- マルチテナント認証（メール+パスワード）
- プロジェクト作成（1サイト=1プロジェクト）
- GA4かんたん接続（URLまたはProperty IDを1つ入力、MVPでは疑似連携）
- 6指標ダッシュボード
- 日別 / 週別 / 月別の推移グラフ
- ベンチマーク比較（基準値との差分表示）
- チャネル/デバイス/LP別分解とワースト
- 設定駆動のルールベース診断 + 施策テンプレ
- PDF / PPTレポート出力（MVPのPPTは簡易アウトライン）
- 日次バッチ（24時間）で疑似GA4データ更新

## 補足

- データは既定で `server/data/db.json` に保存されます。
- 既存アプリと分離したい場合は `PORT` と `CVR_STORAGE_DIR` を指定してください。

```bash
PORT=3210 CVR_STORAGE_DIR=./server npm start
```
- 本番ではPostgreSQL + Redis + 本物のGA4 OAuthへ差し替えを想定しています。

## GA4 OAuth 設定（必須）

本OAuthでGA4実データを取得するため、以下を設定してください。

```bash
export GA4_OAUTH_CLIENT_ID="xxxxx.apps.googleusercontent.com"
export GA4_OAUTH_CLIENT_SECRET="xxxxx"
export GA4_OAUTH_REDIRECT_URI="http://localhost:3210/api/ga4/oauth/callback"
```

Google Cloud Console 側では OAuth 同意画面とリダイレクトURIを一致させてください。

## ローンチ準備

最短構成は、現在の Node サーバーをそのままコンテナ化して Render / Railway / Fly.io などに載せる方式です。

- ヘルスチェック: `/api/health`
- コンテナ定義: `Dockerfile`
- 環境変数ひな形: `.env.example`

### 必須の本番設定

- `GA4_OAUTH_CLIENT_ID`
- `GA4_OAUTH_CLIENT_SECRET`
- `GA4_OAUTH_REDIRECT_URI`
- `CVR_STORAGE_DIR`
- `PORT`
- `RESEND_API_KEY` (本番のメール認証に必要)
- `RESEND_FROM_EMAIL` (本番のメール認証に必要)

### 本番で更新すべき点

- `GA4_OAUTH_REDIRECT_URI` を本番ドメインに変更
  - 例: `https://app.example.com/api/ga4/oauth/callback`
- Google Cloud 側の OAuth クライアントにも同じ URI を登録
- 先に会話で共有した古い `Client Secret` はローテーションする

### Docker 起動例

```bash
docker build -t veltio .
docker run --rm -p 3210:3210 --env-file .env.example veltio
```

## Render で一旦公開する

`render.yaml` を追加しています。GitHub に push して Render で `Blueprint` として読み込めば、そのまま立ち上げられます。

### 手順

1. このリポジトリを GitHub に push
2. Render で `New +` -> `Blueprint`
3. このリポジトリを選択
4. 次の環境変数を設定
   - `GA4_OAUTH_CLIENT_ID`
   - `GA4_OAUTH_CLIENT_SECRET`
   - `GA4_OAUTH_REDIRECT_URI`
   - `RESEND_API_KEY`
   - `RESEND_FROM_EMAIL`
5. デプロイ後、発行されたURLを `GA4_OAUTH_REDIRECT_URI` に反映
   - 例: `https://veltio.onrender.com/api/ga4/oauth/callback`
6. Google Cloud 側の OAuth クライアントにも同じ URI を登録

### 注意

- 今の `render.yaml` は Render の永続ディスクを使う構成です
- `CVR_STORAGE_DIR=/var/data/veltio`
- そのため、アプリ再起動や再デプロイでも JSON データは保持されます
- ただし、これは「永続ストレージ化」であり、まだ PostgreSQL ではありません
- 本番での同時アクセスや将来の拡張を考えると、次段階では PostgreSQL へ移行するべきです

### デプロイ後に必ずやること

1. Render のURLを確認
2. `GA4_OAUTH_REDIRECT_URI` を本番URLへ更新
   - 例: `https://your-app.onrender.com/api/ga4/oauth/callback`
3. Google Cloud 側の OAuth クライアントにも同じリダイレクトURIを追加
4. 再デプロイ
