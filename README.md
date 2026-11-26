# g-i-q — Growth × Inflation Quadrant

Shows where the US economy sits on the growth/inflation quadrant, according to:

- **Hard data**: 16 FRED indicators turned into one model point with a confidence region.
- **Each house's market commentary** (GS, JPM, MS, BofA, Wells, U.S. Bank, BlackRock, PIMCO, Vanguard, Schwab, the Fed, …). Claude reads each one and scores it with a fixed rubric. Every point on the chart is labelled with the house it belongs to.
- **A blended consensus**: a probability for each quadrant, plus a short write-up of what the data supports.

```
frontend/   Static site (Cloudflare Pages). Plain HTML/CSS/JS, no build step. It only reads from the API.
backend/    Cloudflare Worker + KV. Serves /api/* and accepts new snapshots at POST /api/ingest.
collector/  Python. Pulls FRED data, has Claude score the commentary, and builds a snapshot JSON.
data/       Snapshots committed by the scheduled job (an audit trail). Hand-scored views go in data/views/.
```

**To update the site, update only the backend.** The collector POSTs a new snapshot to the Worker. The page fetches `/api/latest` every time it loads, so the frontend never needs a redeploy for new data.

```
GitHub Actions cron ──► collector (FRED + Claude) ──► POST /api/ingest ──► Worker KV ◄── GET /api/latest ◄── Pages site
```

## The model

### Axes (units: percentage points, "pp"; horizon: the next 6–12 months)

- `x = g − g*`
  - `g`: expected real GDP growth
  - `g*`: trend growth (2.0%, set in `collector/config.yaml`)
- `y = π − π*`
  - `π`: expected core PCE inflation
  - `π*`: the Fed's 2% target

| Quadrant | x | y |
|---|---|---|
| Goldilocks | > 0 | < 0 |
| Overheating / Reflation | > 0 | > 0 |
| Stagflation | < 0 | > 0 |
| Disinflationary slowdown | < 0 | < 0 |

### Hard-data point (`collector/giq/model.py`)

Each indicator `i` is mapped to an implied gap `gᵢ` with a documented rule of thumb. Examples:

- Okun's law: `g = −4 × Δu₆ₘ`, where `Δu₆ₘ` is the 6-month change in the unemployment rate.
- CFNAI: `g = 1.5 × CFNAI`.
- Core CPI: `y = CPI − 2.4`. The extra 0.4pp is the usual gap between CPI and PCE.

The model point for an axis is

- `μ = Σ wᵢgᵢ / Σ wᵢ`
- `σ = √( Σ wᵢ(gᵢ − μ)² / Σ wᵢ + σ₀² )`

where

- `wᵢ`: the weight of indicator `i`
- `σ₀`: a measurement floor (0.25pp)

So `σ` measures how much the indicators disagree with each other, plus that floor.

### House views (`collector/giq/commentary.py`)

Claude searches the web for each house's latest outlook, reads it, and returns a JSON record (structured output) containing:

- `x`, `y`: the house's point
- `σx`, `σy`: its uncertainty
- `plausible_quadrants`: quadrants explicitly mentioned or implied in the outlook (used to constrain uncertainty regions)
- a direction arrow
- forecast numbers and verbatim quotes
- the reasoning behind the score

The rubric:

- Explicit forecasts convert directly. A CPI forecast has 0.4pp subtracted to put it on a PCE basis.
- Qualitative views map to fixed anchors, e.g. "sticky above target" = +1.0pp.
- `σ` is 0.3 for point forecasts, 0.5 for ranges, 0.8 for qualitative views, and +0.2 when the house stresses tail risks.
- `plausible_quadrants` only admits quadrants beyond the base call when the commentary explicitly mentions or implies a scenario/risk crossing `x = 0` or `y = 0`.

Views older than 60 days are marked stale. They are drawn hollow and given 0.35× weight.

### Confidence regions (quadrant-constrained)

Each point and the hard-data model follow a quadrant-truncated bivariate normal restricted to `plausible_quadrants` (for hard data, crossing `x = 0` or `y = 0` requires either a model mean inside `±0.25pp` or at least one indicator beyond `±0.25pp` on that side). Contour levels (68% / 90%) are calibrated over the truncated support, and `Blended` / `Houses` regions are true Highest Density Regions (HDR) of the weighted mixture density.

### Quadrant probabilities

Each view is a quadrant-truncated normal distribution `N(μ, σ) · 1[Q]`, with weight = confidence × staleness factor.

- **Houses**: a mixture of all house views.
- **Blended**: the house mixture with 60% of the weight and the hard-data point with 40% (`model_weight_share`).

Probabilities are the share of 40k Monte Carlo draws that land in each quadrant.

## Setup (one time)

1. **Create the KV namespace and deploy the Worker.**
   ```bash
   cd backend && npm install
   npx wrangler login
   npx wrangler kv namespace create GIQ   # paste the id into wrangler.toml
   npx wrangler secret put INGEST_TOKEN   # any long random string
   npx wrangler deploy                    # note the URL, e.g. https://giq-api.<you>.workers.dev
   ```
2. **Deploy the site.** Set `apiBase` in `frontend/config.js` to the Worker URL, then:
   ```bash
   npx wrangler pages deploy frontend --project-name giq
   ```
   Optional: set `ALLOWED_ORIGINS` in `wrangler.toml` to your Pages domain(s), then redeploy the Worker.
3. **Seed the data.**
   ```bash
   cd collector && pip install -r requirements.txt
   GIQ_API_URL=https://giq-api.<you>.workers.dev GIQ_INGEST_TOKEN=... python -m giq.publish ../data/latest.json
   ```
4. **Automate.** In the GitHub repo settings, add:
   - Secrets: `ANTHROPIC_API_KEY`, `GIQ_INGEST_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - Variables: `GIQ_API_URL`, and optionally `CF_PAGES_PROJECT`

   The workflows then run on their own:
   - `collect.yml`: Mon/Thu 13:17 UTC, plus manual runs. Builds a snapshot, commits it to `data/`, and publishes it to the Worker.
   - `deploy-backend.yml` / `deploy-frontend.yml`: run only when that code changes.

## Day-to-day

| Task | Command |
|---|---|
| Full refresh (FRED + Claude) | `python -m giq.build` (needs `ANTHROPIC_API_KEY`) |
| FRED only, keep house views | `python -m giq.build --skip-llm` |
| Hand-scored views / synthesis | `python -m giq.build --views ../data/views/<file>.json --synthesis ../data/views/<file>.json` |
| Push to the site | `python -m giq.publish ../data/latest.json` |
| Add or remove a house | edit `sources:` in `collector/config.yaml` |
| Tune trend growth, staleness, weights | edit `params:` in `collector/config.yaml` |

Local dev:

```bash
cd backend && echo "INGEST_TOKEN=dev" > .dev.vars && npx wrangler dev --local --port 8787
```

```bash
cd frontend && python3 -m http.server 8080   # open http://localhost:8080/?api=http://localhost:8787
```

Tests:

```bash
cd collector && python -m pytest -q tests
```

```bash
cd backend && npm test
```

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/latest` | full latest snapshot |
| GET | `/api/history?limit=N` | compact series: consensus, model and every house per date |
| GET | `/api/snapshots` | stored dates |
| GET | `/api/snapshot/YYYY-MM-DD` | one snapshot |
| POST | `/api/ingest` | `Authorization: Bearer $INGEST_TOKEN`; validates schema v1 |

## Caveats

- The indicator-to-gap mappings are rules of thumb, not an estimated model. Tune the weights and scalings to your own priors.
- The hard-data history uses current-vintage FRED data with approximate publication lags. It is not true real-time data.
- House scores are an interpretation of the house's commentary, not the house's own coordinates. Each record keeps `scoring_rationale`, quotes and the source URL so you can audit it.
- The seed snapshot (`data/views/2026-11-13-seed.json`) was scored by hand from public pages found on 2026-11-13. Some dates and figures came from secondary coverage; those records are flagged in their rationale.
