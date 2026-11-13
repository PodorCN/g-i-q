# Cloudflare deployment

This project uses **your Cloudflare account**: a Pages project for the frontend, a separate Worker for API/collection, and a D1 database. The configured production deployment is [g-i-q.pages.dev](https://g-i-q.pages.dev/), with [Worker health](https://giq-api.zixiao-cab.workers.dev/api/health). The setup instructions below are for reproducing it in another account; do not recreate the existing database during routine updates.

## One-time setup

Install dependencies (`npm ci`), then authenticate Wrangler with `npx wrangler login`, or configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` securely in your shell / CI settings. Never commit them or paste them into chat. The deployment token needs product-level Workers Admin for first creation (Editor suffices for an existing Worker), D1 database creation and write access, Pages Edit/Write, and Workers AI permissions; use the narrowest account scope.

Find the account ID using the Cloudflare dashboard search command **Copy account ID**. Create the token under **Manage Account → Account API Tokens**, scoped to the selected account. [Cloudflare account ID guide](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/) and [Workers roles](https://developers.cloudflare.com/workers/authorization/workers/) explain the current UI and role names; older interfaces may still show legacy Edit permissions.

### Database and Worker

```sh
npx wrangler d1 create giq
```

Copy the returned database UUID into `backend/wrangler.jsonc` → `d1_databases[0].database_id`. The UUID is configuration, not a secret. Commit this change so future backend deploys use the same database.

```sh
npm run db:migrate
npm run deploy:backend
```

Keep the Worker URL returned by Wrangler, for example `https://giq-api.your-subdomain.workers.dev`. `AI_ENABLED` is `true` by default. Workers AI usage is subject to your account’s plan, quotas and billing; set it to `false` if you want conservative rule extraction instead. A model failure leaves the article unscored and visible in coverage.

Choose a random admin token of at least 24 characters. Store it through Wrangler’s hidden prompt:

```sh
npx wrangler secret put ADMIN_TOKEN --config backend/wrangler.jsonc
```

You can also set `ADMIN_TOKEN` directly in the Worker’s Cloudflare secret settings. The admin token is never sent to the frontend.

The main GDP/PCE axes use BEA and Atlanta Fed public sources without an API key. For reliable supporting BLS collection from a shared cloud egress address, register a free [BLS API key](https://data.bls.gov/registrationEngine/) and store it as the Worker secret `BLS_API_KEY`. The public unregistered allowance can be exhausted by other users of the same egress address. The collector batches all five series into one request and preserves verified observations with their original retrieval timestamps when the provider quota is reached. Provider errors are sanitized so a registration key cannot appear in a public snapshot.

```sh
npx wrangler secret put BLS_API_KEY --config backend/wrangler.jsonc
```

### Pages

Set `wrangler.jsonc` → `vars.BACKEND_URL` to the actual Worker URL. Set `backend/wrangler.jsonc` → `vars.ALLOWED_ORIGIN` to your Pages URL if it differs from `https://g-i-q.pages.dev`; the same-origin Pages proxy does not require CORS.

```sh
npx wrangler pages project create g-i-q --production-branch main
npm run deploy:frontend
```

If the Pages project name is already taken in your account, choose another name and update the name in the frontend deployment script and its origin in the backend config. The CLI uploads the `functions/` directory with the frontend build, so `/api/*` reads go through the Pages proxy. You can use a Pages service binding named `BACKEND` instead of `BACKEND_URL` if you prefer.

Use **Direct Upload / Wrangler** for this setup. If you instead connect Pages directly to GitHub, use build command `npm run build`, output `dist`, and build-watch paths limited to frontend, functions, shared, public and build configuration; otherwise Cloudflare may rebuild the frontend on backend-only commits.

### Collect the first production snapshot

Set `GIQ_API_URL` to the Worker URL and `GIQ_ADMIN_TOKEN` securely in your local environment. Then:

```sh
node scripts/trigger-refresh.mjs
```

This waits for the authenticated research refresh and reports its run status. The Worker uses its AI binding. Initial collection may take a minute or more. Visit `WORKER_URL/api/health` to inspect the last run, then load the Pages URL. The UI’s Refresh control only fetches the latest stored snapshot; visitors cannot trigger model spending.

Alternatively, import a locally collected snapshot (optionally with your own model credentials):

```sh
npm run refresh
```

When both `GIQ_API_URL` and `GIQ_ADMIN_TOKEN` are set, the CLI uploads the snapshot to `/api/import`. It refuses demo data and future-dated snapshots. Production scheduled collection does not need these local variables.

## Daily operation

The deployed Worker has cron triggers at 11:00 and 12:00 UTC. Only the trigger that corresponds to **07:00 America/New_York** runs; the other is a no-op. A unique daily run ID prevents a duplicate collection. A D1 partial unique index prevents overlapping manual and scheduled runs; locks older than 30 minutes are marked failed before another run is admitted.

The collector runs while nobody has the page open. It creates a versioned snapshot in D1. The frontend automatically rechecks every five minutes while viewing the latest snapshot; historical views stay fixed. Public API responses cache for 60 seconds with a further 120 seconds of stale-while-revalidate.

**No frontend deployment, commit or rebuild occurs during a daily data update.**

The initial snapshot shipped with the static build is only an offline fallback. The UI explicitly labels it as a saved snapshot when the API is unavailable. It is never a substitute for a working production backend.

## Independent GitHub deployments

CI runs on main and pull requests. Deploy workflows are opt-in and use separate path filters.

1. Complete the initial Cloudflare setup and commit the real non-secret D1 ID and Worker URL.
2. Add GitHub Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. Set repository variable `CLOUDFLARE_DEPLOY_ENABLED=true` to deploy automatically on relevant pushes, or run either deploy workflow manually.

Backend source changes deploy only the Worker. Frontend/UI changes deploy only Pages. Shared-schema and dependency changes intentionally deploy both. Secrets already stored on the Worker survive deployment.

## Local backend verification

```sh
npm run db:migrate:local
npm run dev:api
```

Use a gitignored `.dev.vars` next to the backend config for `ADMIN_TOKEN` during local Worker testing. Live Workers AI calls may require your Cloudflare account; the local CLI and default Vite API can be tested without Cloudflare authentication.

## Useful API routes

| Route                      | Access             | Purpose                                     |
| -------------------------- | ------------------ | ------------------------------------------- |
| `GET /api/snapshot`        | Public             | Latest snapshot, conditional ETag reads     |
| `GET /api/snapshot?id=...` | Public             | An immutable historical snapshot            |
| `GET /api/history`         | Public             | Most recent 90 snapshot IDs                 |
| `GET /api/health`          | Public             | Last collection run and snapshot status     |
| `POST /api/refresh`        | Admin Bearer token | Run a collection, keeping the request alive |
| `POST /api/import`         | Admin Bearer token | Validate and store a collected snapshot     |

The Pages proxy forwards only the three GET routes. The public site never receives the admin token or a model API key.

## Recovery

- Empty database: trigger the first refresh or import a real snapshot.
- Failed source: inspect Sources and Worker logs; check canonical URLs or update `backend/sources.ts`. Do not bypass paywalls or bot challenges.
- Model quota / model failure: the affected article remains unscored. Update quota or use rule extraction; never silently synthesize a point.
- Complete collection failure: the previous snapshot remains live and `/api/health` records a failed run. Retry with `scripts/trigger-refresh.mjs` after correcting the cause.
- Stale data: the frontend shows an overdue notice after 36 hours. Inspect the deployed cron and refresh-run status.

Cloudflare references: [Pages Functions](https://developers.cloudflare.com/pages/functions/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Workers AI](https://developers.cloudflare.com/workers-ai/).
