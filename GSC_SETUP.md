# Search Console連携と流入キーワード分析

画面は `/app/<brand-id>/keywords`。サイドバー「流入キーワード分析」から開きます。

## Google Cloud設定

既存の `info@indieverse.jp` 管理下のGCPプロジェクトを利用できます。今回の利用先はユーザー指定の `indieverse-llmo`。プロジェクトの公開範囲・既存GA4クライアントを変更せず、GSC専用のウェブOAuthクライアントを用意します。

1. Google Search Console API (`searchconsole.googleapis.com`) を有効にする。
2. OAuthクライアント「GetCito Local Search Console」をウェブアプリケーションとして作成する。
3. 承認済みリダイレクトURIへ `http://localhost:3001/api/search-console/google/callback` を登録する。
4. 読み取り専用スコープ `https://www.googleapis.com/auth/webmasters.readonly` を使う。公開範囲や検証・テストユーザーの設定は、そのプロジェクトの運用に合わせる。
5. 管理者の環境変数へ下記を設定し、Webサーバーを再起動する。

```dotenv
GOOGLE_SEARCH_CONSOLE_CLIENT_ID=<GSC専用クライアントID>
GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET=<GSC専用シークレット>
GOOGLE_SEARCH_CONSOLE_REDIRECT_URI=http://localhost:3001/api/search-console/google/callback
ANALYTICS_TOKEN_ENCRYPTION_KEY=<既存の32バイト暗号化キー>
```

既存の暗号化キーを変えるとGA4を含む保存済み認証情報を読めなくなるため、設定済みの値を維持します。キー未設定の新規環境でのみ `openssl rand -hex 32` で生成します。秘密値をGitに登録しないでください。本番では実際のHTTPSオリジンと `APP_URL` に合わせて別途設定します。

## DB移行と起動

Herokuではreleaseコマンドが自動適用します。手動適用は `node packages/lib/scripts/migrate.mjs` を使用します。

追加マイグレーションは `0022_search_console_keyword_analysis.sql`。既存の移行手順で適用します。Docker環境では `db-migrate` イメージを再ビルドして実行し、Webイメージを再ビルド・起動します。

```sh
docker compose build db-migrate web
docker compose up -d web
```

workerの追加起動は不要です。通常のオンデマンド取得と30分キャッシュで動きます。

## 接続と操作

- ブランドのowner/adminが「連携設定」→「Google Search Consoleと連携」からGoogleの読み取り権限に同意し、プロパティを選びます。接続したGoogleユーザーが権限を持つ、ブランドのドメインに対応するプロパティだけが候補になります。
- 通常メンバーは接続済みブランドの分析を閲覧できます。接続・プロパティ変更・解除は管理者に限ります。
- 接続に使うGoogleアカウントを全ユーザー共通のinfoアカウントへ固定しません。Google側の本人確認は利用者が行います。
- 連携解除は当該ブランドのGSC接続・OAuth状態・キャッシュだけを削除します。Google側の共通grantをrevokeせず、既存GA4の継続利用を保ちます。

## 条件の意味

初期期間はPTで3日前までの28日間。開始・終了日を変更し「適用」します。Google検索のweb/finalデータを取得します。

| 条件 | 内容 |
| --- | --- |
| キーワード | 検索語に入力文字列を含む |
| AI質問フィルタ | 初期OFF。ONで質問・依頼・状況指定・比較選択・空白区切り4語以上・日本語14文字以上のOR正規表現を追加 |
| URL：含む | ページURLに指定文字列を含む |
| URL：含まない | ページURLに指定文字列を含まない |
| URL：完全一致 | 入力したフルURLと一致 |
| URL：配下を含む | 入力したフルURLのディレクトリ自身と配下。隣接する別ディレクトリを含めない |

URLは最大10条件。全条件をANDで結合します。「完全一致」「配下を含む」は `https://...` または `http://...` のフルURLを入力します。「配下を含む」にはクエリ文字列を指定しません。URL部分一致はパスなどの文字列を指定できます。

AI質問の正規表現は `packages/lib/src/search-console/ai-question.ts` で一元管理しています。RE2互換の各条件をORでつなぎ、Google APIの検索語フィルタに指定します。画面の情報ボタンでそのまま使える式全体を確認できます。

- 依頼：教えて、比較して、探して、教えてください、知りたい、お願いします等の語尾。単に「て」で終わるだけでは対象にしません。
- 疑問：なぜ、どうすれば、どうやって等、ですか・ますか等の語尾、末尾の `?` / `？`。
- 状況・条件：未経験ですが、週2日、予算5万円等。
- 比較・選択：私に合う、どれを選ぶ、メリットとデメリット等。
- 掛け合わせ：空白で区切られた4語以上。半角・全角スペース、連続スペース、タブに対応し、空白の繰り返しを複数語とは数えません。空白なしの文は自動分かち書きしません。
- 従来の日本語14文字以上もOR条件として維持します。短い依頼や4語の英語検索語に日本語14文字は要求しません。

AI質問フィルタON時の初期並び順は、取得済みの検索語の「AI質問らしさ順」です。各正規表現の一致を1回ずつ加点（依頼40、疑問20、状況20、比較15、4語10、日本語14文字5、上限100）し、同点は表示回数の多い順に並べます。優先度と判定理由を一覧で確認でき、指標ヘッダーから通常の並び順にも切り替えられます。優先度はAI経由の確率ではありません。

これらは候補抽出であり、AI経由・質問文であることの確定判定ではありません。正規表現を変更したため、サーバーとブラウザのキャッシュキーにフィルタ仕様バージョン2を含め、以前の抽出結果を再利用しません。

AI質問フィルタはスイッチを切り替えた時点で、画面上の条件を検証して指標・一覧へ反映します。期間・キーワード・URL条件だけを編集した場合は「適用」で反映します。条件が不正な場合はエラーを表示します。適用前は旧条件の結果を維持し、未適用の変更を表示します。「クリア」は期間・プロパティを維持してキーワード・AI質問・URL条件を初期状態へ戻します。適用済み条件と並び順・ページはURLに保存されます。

一覧は1ページ100件です。表示回数・クリック数・CTR・平均掲載順位は同じ条件のAPI集計値であり、表示中の100行の合計ではありません。CSVは取得した検索語全体を現在の並び順で出力し、数式として解釈される検索語をエスケープします。

GSC APIが返す上位データを最大50,000検索語まで取得します。匿名化された検索語などを含む全検索語の完全取得は保証されません。取得上限の検出時は画面に案内します。集計日はPT、最終取得日時はJSTで表示します。

## 実装・検証の要点

独立した `gsc_connections`・`gsc_oauth_states`・`gsc_query_cache` を追加。PKCE・セッションに結びついた1回限りのstate・AES-256-GCM暗号化を利用し、ブランドと用途別AADで秘密情報の入れ替えを防ぎます。

すべての取得にサーバー側でブランドのホスト名範囲を追加し、ドメインプロパティでも他ブランドのURLが混ざらないようにします。キャッシュキーには接続revision・プロパティ・ブランドホスト・期間・全フィルタ・フィルタ仕様バージョンを含めます。接続解除や権限取り消しと取得が競合した場合は結果を返しません。

参考：[OAuth要件](https://developers.google.com/webmaster-tools/v1/how-tos/authorizing)、[Sites list](https://developers.google.com/webmaster-tools/v1/sites/list)、[Search Analytics query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)。
