# Heroku deployment

Use the classic `heroku/nodejs` buildpack with Node 24 and the pnpm version pinned
in the root `package.json`. The Heroku build runs `heroku-postbuild`, which builds
only the web app. Config vars, including `VITE_*`, must be set before the build.
Let the buildpack install development dependencies for the build, then prune them;
the worker's `tsx` launcher is a production dependency.

The root `Procfile` defines:

- `web`: the production Nitro bundle, using Heroku's `PORT`.
- `worker`: the pg-boss worker; no Redis service is needed.
- `release`: Drizzle migrations, using one database connection and the same TLS
  settings as the app. Node 24 runs the small shared TypeScript configuration
  module directly, so this command does not depend on development tooling.

Start with one Basic dyno for each of `web` and `worker`. With a 20-connection
Postgres Essential-0 database, configure:

```dotenv
DB_POOL_MAX=4
PG_BOSS_POOL_MAX=2
WORKER_PROMPT_CONCURRENCY=1
WORKER_REPORT_CONCURRENCY=1
WORKER_ANALYSIS_CONCURRENCY=1
NODE_OPTIONS=--max-old-space-size=320
```

The two dynos can use at most `2 * (4 + 2) = 12` pooled connections, leaving eight
for releases and administration. Do not enable Preboot or
scale up without recalculating that total. These limits are per process, and the
three concurrency limits are per queue, not a single global semaphore. Provider
fan-out and native allocations can still increase memory; check runtime metrics
after a representative report and lower concurrency if needed. `heroku-postbuild`
overrides the heap limit to 4096MB only while building; the 512MB runtime dynos
retain their smaller configured limit. The worker Procfile command directly
executes Node with the production tsx import hook to avoid a resident pnpm process.

`DATABASE_SSL_MODE` is optional. When omitted, the existing connection URL policy
is preserved. Supported explicit policies are `verify-full` (verify certificate),
`disable`, and `no-verify` (encrypted connection without certificate verification).
Prefer `verify-full` with a valid provider certificate chain for production.
`no-verify` requires an explicit operator choice and is never selected automatically.
Explicit policy overrides URL SSL parameters consistently for app pools,
pg-boss and migrations. Never print the database URL or config var values.

Keep deployment mode consistent with the source data and local configuration.
Use the production HTTPS URL for `APP_URL` and `VITE_APP_URL`. Set
`GOOGLE_ANALYTICS_REDIRECT_URI` to that host's GA4 callback path and register it on
the existing OAuth web client. Preserve `ANALYTICS_TOKEN_ENCRYPTION_KEY` when
copying encrypted GA4 connections; otherwise copied refresh tokens cannot be read.
Preserve `BETTER_AUTH_SECRET` if copying active authentication sessions. When
omitting session data, a fresh production secret requires users to sign in again.

For an existing-data import, keep both dynos stopped, take a verified source
backup, restore the database, then run the release migration before starting
services. Transfer the Drizzle migration history together with application data.
Do not run writes against an imported staging copy until its target database and
OAuth origin have been verified. pg-boss contains queued work: review pending jobs
before starting the worker so imported jobs do not unexpectedly call paid APIs.

Heroku filesystems are ephemeral. Persist application records in PostgreSQL and
use external object storage if file uploads are introduced. Long GA4/API requests
must respect Heroku's initial 30-second HTTP response timeout.
