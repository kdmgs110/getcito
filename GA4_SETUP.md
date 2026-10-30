# GA4 traffic analysis setup

GetCito can read GA4 sessions through Google OAuth. Organization owners and admins connect a property; members can view its traffic and saved analysis views. Google access is read-only and separate from signing in to GetCito.

## Server configuration

Enable **Google Analytics Data API** and **Google Analytics Admin API** in your Google Cloud project. Configure the OAuth consent screen, add the Analytics read-only scope (`https://www.googleapis.com/auth/analytics.readonly`), and create an OAuth client of type **Web application**. While the consent screen is in testing, add the Google accounts that will connect as test users. Complete Google's applicable verification requirements before making the integration publicly available.

Register this exact authorized redirect URI, substituting the public GetCito origin:

```text
https://getcito.example.com/api/analytics/google/callback
```

For local development on the existing Docker port, use `http://localhost:3001/api/analytics/google/callback` instead. The configured origin must match the address used to open GetCito.

Set these **server-only** environment variables in the web application's runtime:

```dotenv
GOOGLE_ANALYTICS_CLIENT_ID=
GOOGLE_ANALYTICS_CLIENT_SECRET=
GOOGLE_ANALYTICS_REDIRECT_URI=https://getcito.example.com/api/analytics/google/callback
ANALYTICS_TOKEN_ENCRYPTION_KEY=
```

Generate a separate 32-byte encryption key, for example with `openssl rand -hex 32`. Keep it in your deployment's secret manager and retain it across restarts. Changing the key makes existing encrypted tokens unreadable and requires reconnecting affected properties. Never use `VITE_` variables for credentials or commit actual values.

These variables are optional for the rest of GetCito: the traffic screen explains configuration when the integration is unavailable. Apply the database migrations before starting the updated app:

```sh
cd packages/lib
pnpm exec drizzle-kit migrate
```

Use the same `DATABASE_URL` configuration as the web application. The Docker web image contains only the built app; use the dedicated migration service instead:

```sh
docker compose build web db-migrate
docker compose run --rm db-migrate
docker compose up -d web
```

## Connect and use

1. Open a brand's **Traffic analysis / トラフィック分析** menu.
2. Choose **Connect Google Analytics**, authorize read-only access, and select a GA4 property and matching website. The property picker lists account summaries without fetching every property's settings.
3. Check the site-wide AI sessions for the last 28 completed days in the property's time zone.
4. Filter entry-page paths by exact match, directory subtree, contains, or regular expression; include or exclude conditions as needed.
5. Switch daily, weekly, or monthly charts and tables. Use the page ranking and **View trend / 推移を見る** for a particular entry page.
6. Register frequent scopes as named views: `/` exactly for the homepage, or `/job_listings/` and its subtree for job listings. Switching saved views keeps the current date range.

Views are shared within the brand. Owners and admins manage them; members can select them and explore temporary filters without modifying the shared definition. Views save conditions, rather than fixed historical dates or a snapshot of the traffic numbers.

## Traffic measurement and availability

- For a verified single-site property, the metric is **sessions by landing page**, not pageviews or every page visited during a session.
- If a property contains several hostnames or its stream's configured website is outdated, GetCito verifies actual session starts on the selected site and uses **observed session starts** instead. Every report is restricted to that web hostname and `eventName=session_start`; paths come from that same event's `pagePath`. The chart, denominator, source breakdown, ranking, and details all use this measurement consistently. The interface labels this mode **セッション開始（計測分）**.
- Observed session starts exclude sessions without a recorded start event. They can differ from standard GA4 session totals, which can also be calculated from session identifiers. GetCito does not combine other hostnames or silently present these counts as unrestricted GA4 totals.
- AI traffic uses GA4's AI Assistant channel and recognized AI referrers, including historical aliases. The interface reports identifiable AI referrals; it cannot recover AI-origin visits whose source was lost.
- Google AI Overviews and AI Mode are excluded from GA4's AI Assistant channel. They are not inferred from ordinary Google search traffic.
- Regular expressions use RE2 full-match semantics. Directory matching respects path boundaries; `/job_listings-old` does not match the `/job_listings/` subtree.
- Entry paths ignore query strings. Exact matching preserves case and trailing slashes. The selected property determines the time zone.
- The entry-page ranking displays each page's title above its full URL. Titles come from a separate `page_view` report for the exact hostname and ranked paths in the selected period; the most frequently observed title is used. This metadata does not change session counts or rankings. Missing titles show **Title unavailable / タイトル未取得**. URLs combine `https://`, the connected hostname, and the entry path, without query strings; they are not the original event's protocol or query parameters.
- GA4 processing delay, thresholding, sampling, and other-row limitations can affect results. Data-quality warnings and fetch times accompany results; API failures are not shown as zero sessions.
- Results are cached for 30 minutes. Selecting a view fetches that scope; registering views does not start a scheduled monitoring task or query all saved views at once.
- A site must be verifiable from its stream configuration and observed data. A mixed-site property additionally needs actual session-start observations for the selected hostname and a compatible Data API dimension combination; unsupported boundaries are rejected. Historical sessions with missing start events require another measurement configuration or session-level event analysis to reconstruct their entrance host.

## Conversion settings and analysis

Open **Conversions / コンバージョン** in Traffic analysis, then **CV settings / CV設定**. Owners and admins can select an existing GA4 key event, give it a display name, rename it, or disable/reactivate it. These settings are stored in GetCito; the integration never creates events or changes GA4 key-event settings. If an event is missing from the picker, configure its instrumentation and key-event status in GA4 first. No additional OAuth scope is required.

Select one conversion goal to view AI and all-source key-event counts, daily/weekly/monthly trends, provider breakdowns, landing-path rankings and path details. Saved views preserve the analysis tab and selected conversion goal along with path conditions. Disabling a saved goal shows an explicit unavailable state instead of silently choosing a different outcome.

- **CV count** uses GA4 `keyEvents` with the event's configured counting method. A repeat conversion can count more than once in one session.
- **CV sessions** count sessions containing that selected key event. **CVR** uses GA4's event-specific `sessionKeyEventRate:event_name`; GetCito does not divide key-event counts by sessions or average daily rates. GA4-native weekly/monthly and whole-period aggregates preserve the denominator.
- AI attribution uses the same session-source classification as traffic analysis. It does not include assisted conversions or conversions in a later session. Event-scoped advertising attribution is not used as a substitute for session source.
- Path filters apply to the session's GA4 `landingPage`, not the page where the conversion occurred. A thank-you URL is not a completion rule; this release selects existing GA4 key events.
- For multi-host properties in observed-start mode, conversion reports instead restrict **the conversion event's hostname** to the selected site. They never apply the traffic screen's `session_start` event filter to key-event counts. The start hostname cannot be established from this report, so landing paths are explicitly labeled **CVしたセッションの開始パス（開始ホスト未判定）**. Session denominators, CV sessions and CVR remain unavailable (`—`). These CV counts must not be divided by the separate observed traffic totals.
- Unsupported metric combinations and GA4 data-quality limitations suppress CVR with a reason. Unavailable values differ from genuine zero conversions. Missing key events, expired authorization and upstream errors are reported explicitly.
- Key-event registration is not retroactive. Date ranges before the event's registration show a notice. Reports retain the property's time zone and a last-fetched timestamp, and are cached for 30 minutes per connection, goal revision and report conditions.

If authorization is revoked or the connecting user's Google access changes, reconnect through the connection settings. Disconnecting removes local credentials and cached reports while preserving named view definitions. Deleting a view does not delete GA4 data.

Official references: [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [GA4 default channels](https://support.google.com/analytics/answer/9756891?hl=en), [GA4 session calculation](https://support.google.com/analytics/answer/9191807?hl=en), [Data API dimensions](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema), [Data API reporting](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport).
