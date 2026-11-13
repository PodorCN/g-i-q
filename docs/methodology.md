# Growth–inflation level model

## Axes and quadrants

X is real GDP growth minus an **assumed 2.0% trend**. Y is core PCE inflation minus the **2.0% target**. Both coordinates are percentage-point gaps. A 2.5% growth estimate and 3.2% inflation estimate map to (+0.5, +1.2).

| Growth gap | Inflation gap | Label                    |
| ---------- | ------------- | ------------------------ |
| Positive   | Negative      | Goldilocks               |
| Positive   | Positive      | Overheating              |
| Negative   | Negative      | Disinflationary slowdown |
| Negative   | Positive      | Stagflation              |

These labels describe positions relative to benchmarks; they are not formal recession diagnoses. Falling inflation can remain above target. The main map does not use acceleration/deceleration or economic surprises. The growth trend assumption is visible and can be changed in a future backend model version.

## Institutional commentary

The collector monitors public pages from BlackRock, Schwab, J.P. Morgan Asset Management, PIMCO, Goldman Sachs, ING, Vanguard and Morgan Stanley, plus Federal Reserve releases. Index discovery and verified fallback articles provide a bounded daily research sweep. Paywalls, inaccessible pages and missing dates remain visible in Sources. Coverage is a public-source sample, not a complete survey of Wall Street.

Workers AI reads each article's U.S. macro argument and extracts real-growth and core-inflation level estimates. An explicit forecast is marked **direct**. Qualitative statements are mapped to an approximate numerical level and marked **inferred**, with a written explanation. Mapping uncertainty can inform an interpreted range, but cannot authorize crossing into an unmentioned quadrant. Headline/unspecified inflation translated into a core-PCE-equivalent is inferred. Quoted third-party assessments must not become the author's own forecast. A strategist's commentary must not be presented as a formal institution-wide forecast.

Both axes require actual, contiguous supporting source passages. Quote validation ignores punctuation/case differences but rejects invented wording. The snapshot retains only short excerpts, links and analysis; full articles are not redistributed. Publication dates, retrieval times and actual outlook horizons remain separate. Current conditions, six-to-twelve-month views and annual outlooks are shown together by default with explicit horizons, and can be filtered.

There is one latest mapped point per institution. If a new article lacks a usable macro view, a recent prior point can remain with its original dates. Weekly sources generally expire after 35 days, monthly outlooks after 60, and quarterly outlooks after 90. There is no AUM weighting or implied consensus probability.

## Hard-data anchor

| Input              | Published measure                                            | Main-map use   |
| ------------------ | ------------------------------------------------------------ | -------------- |
| BEA real GDP       | Latest quarterly change, annualized                          | Growth rate    |
| Atlanta Fed GDPNow | Current-quarter annualized GDP nowcast                       | Growth rate    |
| BEA core PCE       | Latest year-over-year price change excluding food and energy | Inflation rate |

X is the equal-weight mean of the available GDP/GDPNow rates minus 2%. Y is core PCE minus 2%. A recent growth observation and core PCE are required. Observations older than 150 days from their reference-month start are excluded. GDP and GDPNow cover different quarters; this simple anchor is not an estimated comprehensive nowcast or an official Federal Reserve forecast. GDPNow is not a published forecast of the Atlanta Fed or Federal Reserve System.

On the initial reviewed snapshot, real GDP is 3.4%, GDPNow is 3.5%, and core PCE is 3.1%. The point is therefore (+1.45pp, +1.10pp). Original source periods and retrieval dates are exposed in the interface.

Five BLS series—nonfarm payrolls, private aggregate weekly hours, unemployment, headline CPI and core CPI—provide supporting context. They are fetched in one batch. Their three-month momentum, change versus the preceding three months, and sign-preserving normalization are displayed separately; these labor/CPI component scores are **not mixed into GDP/PCE percentage-point coordinates**. Recent comparisons require contiguous monthly observations. Older missing months are skipped rather than bridged. An optional free BLS key helps avoid the shared anonymous request allowance; main-map BEA/Atlanta Fed collection does not depend on it.

## Reported scenarios and ranges

An institutional point is its mapped central view. An **interpreted range is allowed even when the report discusses only that quadrant**. Its growth and inflation half-widths reflect the specificity, horizon and strength of the evidence. They are our mapping assumptions, not a published house distribution or a statistically estimated confidence interval. There is no claimed 68%/90% coverage, standard error, covariance estimate or quadrant probability.

The daily extractor supplies `growthRangeWidth` and `inflationRangeWidth` in percentage points, plus `rangeRationale`. The prompt suggests roughly 0.3–0.6pp for explicit rates and 0.7–1.2pp for qualitative mappings, while allowing evidence-based variation. If widths are missing, compatibility defaults are 0.4pp for a direct axis, 0.9pp for a low-confidence inferred axis and 0.75pp for other inferred axes; existing reviewed widths are retained when available. These are transparent conventions, not empirically calibrated uncertainties. The November 13 snapshot restores previously reviewed widths without changing house centers, source dates or guidance; its per-house rationale and bounds are recorded in `data/reviews/2026-11-13-constrained-ranges.json`.

Width and permission are separate. A view can extend to another quadrant **only when its source explicitly supports that particular alternative**. The stored `reportedScenarios` contains the named quadrant, separate verbatim growth and inflation passages, and the scenario horizon. Conditional scenarios remain separate from the central forecast. The daily extractor is instructed to use the author's own U.S. scenario, not third-party views, rejected scenarios, other countries, or a sequence of unrelated stages. Validation checks both quotations, rejects denial/attribution and distant passages, and requires an explicit regime name or support for both axes. These conservative gates reduce errors; semantic interpretation is not infallible.

Recession risk alone does not specify the inflation outcome. Slower growth need not be below the assumed 2% trend, and falling inflation need not be below the 2% target. Missing evidence produces no extra quadrant. Excluding an unsupported quadrant is a display constraint, **not** a claim that the institution assigns it zero real-world probability. Inferred coordinates remain visibly labeled as our interpretations.

For a center `(x, y)` and interpreted half-widths `(rx, ry)`, the raw ellipse is:

`E = {(X,Y): ((X-x)/rx)² + ((Y-y)/ry)² ≤ 1}`

The plotted region is `E ∩ (Q₀ ∪ Q₁ ∪ …) ∩ [-3,3]²`, where `Q₀` is the central quadrant and every additional `Qᵢ` has verified report evidence. We clip the original ellipse; we do not recenter or squeeze it into the allowed area. A flat edge on an axis means clipping, not zero uncertainty. If an Overheating point also has explicit Stagflation and Goldilocks scenarios, their union still excludes Disinflationary slowdown. If only the diagonal quadrant is supported, no connecting region fills either unmentioned adjacent quadrant. Permission does not require the range to fill the entire alternative quadrant.

Institutions store `rangeKind: model_range`, `rangePolicy: quadrant-constrained-v1`, the original radii and rationale in `rangeEstimate`, and the visible marginal bounds in `xRange`/`yRange`. Those bounds do not authorize every combination in their rectangular bounding box; the chart uses the actual clipped ellipse. Exact coordinate signs govern clipping, independently of the UI's near-benchmark label. A point exactly on a benchmark has no default adjoining region without explicit scenario evidence. Merely touching an axis does not count as entering another quadrant.

A hollow point means a report-backed alternative exists; a filled point can still have a range within its quadrant. The inspector provides the original supporting passages and horizon, the interpreted widths before clipping, and the visible bounds. The chart fits these visible ranges even when they are hidden, so toggling visibility does not move points. There is no full-quadrant scenario shading.

The November 13 review retained one additional region: ING's conditional Iran/Gulf escalation scenario combines rising inflation with mounting recession risks, supporting Stagflation. ING's central point remains its baseline; its range can extend to Stagflation, but this risk does not supply a base-case trajectory. The later inflation decline in that scenario does not establish below-target inflation and does not authorize a second region. U.S. Bank's published recession probability does not specify inflation conditional on recession; it is not converted into quadrant odds. The other 19 mapped reports did not support an additional two-axis regime in this review. Source hashes, retrieval provenance and decisions are recorded in `data/reviews/2026-11-13-source-scenarios.json`.

The **hard-data** ellipse remains separate. It uses ±0.6pp growth and ±0.25pp inflation as transparent model sensitivity assumptions, not broker scenarios, statistical confidence intervals or probabilities. Its geometry is `((X-x)/rx)² + ((Y-y)/ry)² ≤ 1`; data overlap checks use the ellipse rather than its bounding box. Data uncertainty cannot expand an institution's view.

Comparisons describe mapped centers and separately flag a sourced scenario on the opposing side of an axis. A forecast may legitimately differ from current observations; different horizons are not an apples-to-apples forecast contest.

## Forward-guidance arrows

An arrow requires **two comparable, explicitly published U.S. forecasts from the same institution and report**. Both the earlier and later periods must specify real GDP and core PCE. The source must use the same growth-rate convention and core-PCE year-over-year basis at both ends. At least one endpoint must coincide with the plotted house point, and both of that point's axis values must be direct. A separate square marks the other dated forecast endpoint. Labels and the inspector distinguish the two periods.

`forwardGuidance` stores the two period/rate pairs, their measures, growth and inflation quotations, and a period/header quotation. Source validation checks verbatim evidence, numeric rates, measure labels, ordered comparable periods, and column correspondence for compact forecast tables. Conditional risks, foreign/global data, mixed inflation measures and unsupported numbers are rejected. An automated extractor still requires semantic interpretation; the initial two trajectories were reviewed against their primary sources.

The chart applies the same 2% benchmarks to both published endpoints and uses their actual two-dimensional difference. For example, U.S. Bank forecasts Q4-over-Q4 GDP of 2.5% in 2026 and 2.0% in 2027, and core PCE of 3.2% and 2.5% respectively. Its arrow runs from (+0.50, +1.20) to (0.00, +0.50), left and down. PNC's table gives 2026 values of 2.5%/3.2% and 2027 values of 2.2%/2.5%; its arrow ends at the plotted 2027 point (+0.20, +0.50). Source hashes and review evidence are in `data/reviews/2026-11-13-forward-guidance.json`.

**Hard data is never the starting point of an institution's arrow.** A `Forward-looking` label, a single forecast point, or a difference from current data does not create forward guidance. Missing direction is unknown, not zero movement. Partial or qualitative guidance remains as sourced text in the inspector; without comparable two-axis coordinates, no numerical trajectory is drawn. Thus Vanguard's later inflation forecast and PIMCO's qualitative inflation direction do not produce arrows with invented growth coordinates. ING's separately sourced Stagflation risk region is not a base-case arrow.

The arrow connects dated forecasts; it does not claim linear evolution, speed or probability. Published rates do not imply certainty. Thin label connectors remain layout elements, not guidance. Historical snapshots lacking validated `source-guidance-v1` data show no institution arrows, even if their old markup would have drawn data-to-house comparisons.

## Daily collection and failure behavior

The Worker runs at 07:00 America/New_York daily. A database lock prevents concurrent refreshes and a unique daily ID prevents duplicate cron runs. Collection permits only bounded requests to allowlisted source hosts. Source text is treated as untrusted evidence. Repeated unchanged articles reuse their validated mapping. The catalog monitors 23 named research teams across banks, wealth managers and asset managers. HTML indexes discover new articles and explicitly approved publisher/CDN PDF reports. PDF extraction is limited to 3 MB and 40 pages; only text is read, so image-only forecast tables are not inferred. Month-only issues retain month precision in the interface; their internal first-of-month date is a conservative freshness anchor, not a claimed publication day.

Core CPI, headline inflation and global GDP are not direct U.S. real-GDP/core-PCE forecasts. The extractor receives these distinctions explicitly; direct labels require measure-specific supporting quotations, inferred axes and range widths remain labeled interpretations, with crossings limited by explicit report evidence, and conditional-risk or missing macro quotations cannot become base-case points. Separately sourced risk scenarios can be retained under the explicit scenario rules above. These gates reduce errors but do not prove semantic accuracy. The November 13 coverage expansion was manually reviewed against primary sources; subsequent new articles use automated interpretation and remain labeled as such.

Provider failures retain previously verified observations or recent house views with their original timestamps and a visible warning. A complete failure leaves the previous snapshot live. Daily updates write a new D1 snapshot and require no frontend deployment. The included saved snapshot is an explicitly labeled fallback if the API is unreachable. The optional demo is fictional and cannot be imported into production.
