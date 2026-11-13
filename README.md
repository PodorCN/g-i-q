# g / i / q

Live: [g-i-q.pages.dev](https://g-i-q.pages.dev/) · API: [giq-api.zixiao-cab.workers.dev](https://giq-api.zixiao-cab.workers.dev/api/health)

An evidence-led **U.S. growth–inflation observatory**. Compare attributable institutional commentary with a reproducible hard-data estimate, inspect the evidence behind every point, and keep the frontend unchanged when the research updates.

**Frontend:** React + TypeScript + Vite on Cloudflare Pages. **Backend:** a separate Cloudflare Worker with D1 snapshots and native Workers AI. **Schedule:** daily at 7 a.m. America/New_York, including daylight saving time.

## What you can do

- Explore the four-quadrant scatter plot; select a named institution to inspect its source, date, horizon, supporting quotes, and position compared with the data.
- Toggle sourced scenario regions, data sensitivity and labels; show all house views by default, or filter current assessments and outlooks while preserving each author’s actual horizon.
- Follow two-axis arrows from the current data reference to each dated house outlook. Dashed arrows identify interpreted endpoints; these are coordinate comparisons, not matched-horizon forecast changes. Hollow dots flag report-backed alternative scenarios; they do not encode probabilities.
- Inspect individual data series, reference months, raw history, transformations, and component scores.
- Read unscored commentary, official news, and collection failures. Missing evidence never becomes an invented point.
- Select historical snapshots and export the complete research JSON.
- Change the source catalog, collector or model by deploying only the backend. A routine daily update writes D1 and deploys nothing.

## Run locally

Node 24 or later:

```sh
npm ci
npm run dev
```

The included `data/latest.json` is an actually collected, dated snapshot. Vite serves it through the local development API. The real-data view does not contain illustrative institution points. Open `/?demo=1` for an explicitly labeled demo of all four quadrants, overlap, evidence inspection and both horizons.

To collect fresh public data:

```sh
npm run refresh
```

If your environment supplies an HTTP proxy, use Node’s supported proxy mode:

```sh
NODE_USE_ENV_PROXY=1 npm run refresh
```

The local CLI defaults to conservative phrase extraction. For semantic extraction, set `OPENAI_API_KEY` securely in the process environment; `OPENAI_MODEL` defaults to `gpt-4.1-mini`. Local `.env` files are not automatically loaded. Production uses Workers AI instead and needs no OpenAI key.

```sh
npm test
npm run build
npm run check:worker
```

## Host on Cloudflare

Follow [the deployment guide](docs/deployment.md). It covers D1 creation, independent Worker/Pages deployments, the first refresh, production secrets, and optional GitHub deploy workflows. Nothing is deployed just by cloning the repository. A Cloudflare account and deployment credentials must be configured first.

```text
Browser → Pages frontend → /api read-only proxy → Worker → D1 snapshots
                                                    ↑
                                  daily 7 a.m. ET collector
                                  BEA / Atlanta Fed / BLS / institutional articles / Fed news
```

The browser knows only `/api/*`. Pages uses the configured `BACKEND_URL` to reach the separate Worker, so swapping the backend never requires compiling a new API URL into the frontend.

## Read the analysis correctly

The axes show **real growth minus an assumed 2.0% trend** and **core inflation minus the 2.0% target**, in percentage points. Strong growth with inflation falling toward—but still above—2% remains in Overheating. Growth trend is an explicit modeling assumption, not a measured constant.

The hard-data point averages the latest BEA annualized quarterly GDP rate and Atlanta Fed GDPNow, then compares BEA year-over-year core PCE with 2%. Different periods are shown explicitly. Five BLS labor/CPI series provide supporting momentum context and do not set the main coordinates. BEA and Atlanta Fed collection needs no BLS key.

The reviewed snapshot covers **20 research teams**, including UBS CIO, Citi Wealth CIO, BofA Private Bank CIO, Wells Fargo Investment Institute, TD Economics, U.S. Bank, ABN AMRO, HSBC AM, RBC Rochdale, UBP, BNP Paribas, PNC and Scotiabank alongside the original seven houses. The daily catalog monitors **23 teams**; Morgan Stanley, Barclays and BMO remain visible in coverage when their accessible material does not establish a usable two-axis house view. Team attribution is specific: wealth and asset-management views are not relabeled as an investment bank’s institutional research forecast. Explicit numerical forecasts are distinguished from our qualitative mappings. Each point preserves a real article, publication date, short verified quotations and the author's actual horizon. This is a monitored public-source sample, not comprehensive access to institutional research.

Institution views have **no assumed-width ellipses**. Only alternative quadrants explicitly supported by the report can be shaded, with growth/inflation quotes and a separate horizon. Qualitative scenario regions have no invented numerical bounds or probabilities. The hard-data ellipse remains a separate sensitivity assumption, without calibrated 68%/90% coverage. [Methodology](docs/methodology.md) gives the definitions and limits.

## Repository map

| Location                     | Purpose                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| `frontend/`                  | Responsive plot, evidence inspector, data and coverage views |
| `backend/collect.ts`         | Bounded public-source collection and validated extraction    |
| `backend/levels.ts`          | Level-gap anchors and institutional mapping prompt           |
| `backend/analysis.ts`        | Quote verification and supporting momentum transforms        |
| `backend/sources.ts`         | Monitored institutions, official news and BLS series         |
| `backend/index.ts`           | API, authentication, refresh locks and daily schedule        |
| `backend/migrations/`        | D1 schema                                                    |
| `functions/api/`             | Read-only Pages proxy                                        |
| `shared/schema.ts`           | Validated, versioned frontend/backend contract               |
| `data/latest.json`           | Dated local research snapshot                                |
| `public/data/bootstrap.json` | Explicitly labeled saved fallback if the API is offline      |
| `public/data/demo.json`      | Fictional, opt-in interface demo; rejected by the import API |
| `scripts/refresh.ts`         | Local collection and optional backend import                 |
| `.github/workflows/`         | Checks and independent, opt-in deployments                   |

Design guidance: [Anthropic’s official frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md). The specific palette, reading flow and layout are recorded in [the design notes](docs/design.md).
