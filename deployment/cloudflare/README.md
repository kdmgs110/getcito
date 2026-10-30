# Cloudflare Containers adapter

GetCito の既存 Node.js Web と pg-boss worker を、Cloudflare Containers の **basic 1台**で動かす任意のデプロイ構成です。既存の Docker Compose と外部 PostgreSQL を使い続けられます。データベースを D1 に変換しません。

## 構成

- Worker → 名前固定の Durable Object `getcito-primary` → Web `3000`。URLやユーザー入力からインスタンス名を作りません。
- `max_instances: 1`、`instance_type: basic`（1/4 vCPU / 1 GiB RAM / 4 GB disk）。Web と worker は supervisor で同時起動します。
- 内部 `3001/__container/health` は既存管理者の確認・worker の起動完了・Web の応答を確認します。公開プロキシは `3000` のみです。
- 毎分の Cron Trigger と60秒の Durable Object alarm で起動・状態確認します。DO再起動時にも inactivity timeout を再設定します。timeout は API の最大6時間で、通常の無アクセスによる短時間スリープがバックグラウンドジョブを止めないようにしています。
- 片方のプロセスが終了すると他方も停止します。SIGTERM では最大35秒 drain します。adapter は40秒後も停止しないコンテナを強制停止し、停止できなければエラーとして扱います。再起動後は既存 PostgreSQL の pg-boss キューから処理が回復します。

**常駐は可用性保証ではありません。** プラットフォーム再配置・更新・障害ではコンテナが再起動します。ジョブは少なくとも1回実行される可能性があるため、外部APIへの副作用は冪等にしてください。ディスクに永続データを置かず、DBのバックアップを維持してください。

## 認証と公開範囲

`local` はこのアプリの単一ユーザー用 deployment mode で、better-auth のログインを使います。匿名利用を許可する mode ではありません。

この adapter は初回サインアップを公開しません。

1. デプロイ前に、既存DBのmigrationと管理者アカウントを非公開のローカル環境で作成してください。
2. supervisor は起動時に既存管理者をDBで確認し、存在しなければ起動しません。
3. `/auth/register` と `/api/auth/sign-up/*` は Worker で拒否します。内部 supervisor のパスも拒否します。
4. `APP_URL` と一致する HTTPS origin のみ転送し、クライアント指定の `Forwarded` / `X-Forwarded-*` は認証用originとして信用しません。
5. `workers_dev` と preview URL は無効です。本番DBを別のプレビューに接続しません。

## 設定

Node.js 24、pnpm、Docker、Workers Paid が必要です。このディレクトリは独立したpnpm workspace / lockfileを持ち、アプリ本体の依存を変更しません。

```sh
cd deployment/cloudflare
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
pnpm validate
pnpm build
```

`build` は Worker の **dry-run** のみで、アップロードや実デプロイを行いません。Docker imageの実ビルドと外部DBへの接続は別途確認が必要です。

`wrangler.json` の次を実際の公開先に合わせて変更してください。初期値の `.example` は意図的に起動を拒否します。

- `vars.APP_URL` と `containers[0].image_vars.VITE_APP_URL`：同じ `https://<hostname>`。ポート・パス・クエリを付けません。
- 公開するCloudflare DNS zoneのカスタムドメインを `routes` に追加。例：`[{ "pattern": "getcito.example.org", "custom_domain": true }]`。
- 必要な非機密設定（`SCRAPE_TARGETS` など）は Worker の `vars` に追加してください。アプリの既存 provider 設定と必要なAPIキーは本体の環境変数定義を参照してください。
- `CLOUDFLARE_ACCOUNT_ID` で対象アカウントを明示して、別アカウントへの誤デプロイを防いでください。Cloudflare用のAPI tokenはWorker secretへ入れません。

`prepare:container` は root の `docker/Dockerfile` にある `cloudflare` stage を選択する `Dockerfile.generated` を作ります。WranglerにDockerの `--target` 設定がないための生成処理で、ステージ定義は複製しません。生成ファイルはgit管理外です。

## 秘密情報

必要な秘密情報は `wrangler secret put <NAME>` または組織のシークレット管理から **Worker runtime bindings** に設定します。値を `wrangler.json`・`image_vars`・Docker build args・PR・CIログに書かないでください。

| 名前 | 用途 |
| --- | --- |
| `DATABASE_URL` | 既存の外部 PostgreSQL。TLSとDB側の接続許可を設定。コンテナ内localhostは利用不可 |
| `BETTER_AUTH_SECRET` | 既存環境と同じ32文字以上の認証secret。変更すると既存セッションに影響 |
| `SCRAPE_TARGETS` に対応するAPI credentials | Web/worker が使う既存のAI・検索 provider |
| `GOOGLE_ANALYTICS_CLIENT_ID` / `GOOGLE_ANALYTICS_CLIENT_SECRET` | GA4 OAuth（利用時） |
| `GOOGLE_ANALYTICS_REDIRECT_URI` | 公開先の `/api/analytics/google/callback` （利用時） |
| `ANALYTICS_TOKEN_ENCRYPTION_KEY` | 既存DBのGA4 token暗号鍵と同じ値（利用時） |

転送する環境変数は `src/environment.ts` の allowlist のみです。`NODE_ENV=production`、`DEPLOYMENT_MODE=local`、`HOST`、`PORT` などの実行条件は adapter が固定します。新しいアプリ環境変数が必要なときはallowlistへ追加してください。

DB migration は **デプロイ前の明示的な作業**です。コンテナが起きるたびにmigrationを実行しません。外部DBのschema・pg-boss・既存暗号鍵を保持してください。

## デプロイと停止

設定・シークレット・既存DB・Docker imageの確認後に、承認されたアカウントでのみ実行します。

```sh
pnpm deploy
```

公開後はログイン、GA4 callback、ページ分析、背景ジョブの完了、意図しないアクセスに対する拒否を確認してください。imageの再配置を伴う更新には短時間の停止があります。

**停止・secret変更時の手順：**

1. `vars.CONTAINER_ENABLED` を文字列 `"false"` にしてデプロイします。
2. 公開応答が503になり、Cron/alarmが既存コンテナへSIGTERMを送り停止します。Cloudflareのinstance状態で停止を確認してください。
3. 必要なsecret・公開URL・imageを更新します。
4. `CONTAINER_ENABLED` を `"true"` に戻してデプロイします。次のcronまたはアクセスで同じ名前のインスタンスが起動します。

**Workerのsecret変更だけでは起動中のコンテナの環境変数は変わりません。** 上の停止・再開を行い、新しい環境変数を起動時に渡してください。Cronだけを無効にしてもalarmは残るため、停止には `CONTAINER_ENABLED` を使います。

## 費用とログ

1台制限と1/4 vCPUはリソース上限で、月額料金のハード上限ではありません。

basic の1 GiB RAMでWeb・workerを共有します。既存workerには最大10件の同時実行設定があり、AIジョブ・レポート生成の全負荷ピークは未測定です。アイドル時に収まっていてもピークのメモリ不足がないことは保証しません。実ジョブのメモリ・再試行・待ち時間を監視し、必要なら同時実行数の調整またはサイズ変更を別途判断してください。メモリ・ディスクの常時割当、利用CPU、ネットワーク、Worker・Durable Object、DB、外部AI APIを別々に確認してください。既存Workers Paidの無料枠は他のアプリと共有されます。

WorkerはCPU 50ms/呼出しに制限し、通常のリクエストログ・trace・コンテナのログ保存を無効にしています。Worker側の固定文言のエラーのみ10% samplingで保存します。OAuthクエリはredactします。調査時にコンテナログを一時的に有効にする場合は、機密情報・URL・保存量に注意し、調査後に戻してください。

公式資料（2026-10-30確認）：[Containers API](https://developers.cloudflare.com/containers/api/durable-object-container/)、[Wrangler設定](https://developers.cloudflare.com/containers/configuration/wrangler/)、[instance types](https://developers.cloudflare.com/containers/platform/limits/)、[料金](https://developers.cloudflare.com/containers/platform/pricing/)。
