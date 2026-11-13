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

Workers AI reads each article's U.S. macro argument and extracts real-growth and core-inflation level estimates. An explicit forecast is marked **direct**. Qualitative statements are mapped to an approximate numerical level and marked **inferred**, with a written explanation. Mapping uncertainty does not authorize a plotted range. Headline/unspecified inflation translated into a core-PCE-equivalent is inferred. Quoted third-party assessments must not become the author's own forecast. A strategist's commentary must not be presented as a formal institution-wide forecast.

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

An institutional point is its mapped central view. **No ellipse or numerical interval is manufactured from interpretation confidence, a generic volatility assumption, or the word “risk.”** The retired mapper widths are ignored even when viewing an older snapshot. In current snapshots, institution `rangeKind` is `none`; legacy required bound fields equal the point for compatibility and are not interpreted as zero forecast uncertainty.

A view can extend to another quadrant only when its source explicitly supports that alternative. The stored `reportedScenarios` contains the named quadrant, separate verbatim growth and inflation passages, and the scenario horizon. Conditional scenarios remain separate from the central forecast. The daily extractor is instructed to use the author's own U.S. scenario, not third-party views, rejected scenarios, other countries, or a sequence of unrelated stages. Validation checks both quotations, rejects denial/attribution and distant passages, and requires an explicit regime name or support for both axes. These conservative gates reduce errors; semantic interpretation is not infallible.

Recession risk alone does not specify the inflation outcome. Slower growth need not be below the assumed 2% trend, and falling inflation need not be below the 2% target. Missing evidence produces no extra quadrant. Absence of shading is **not** a claim that the institution is certain or assigns zero probability to alternatives. Inferred coordinates remain visibly labeled as our interpretations.

Qualitative alternatives appear as **shaded scenario quadrants**, confined to the named regions. They have no numeric bounds or probability; no connecting ellipse fills unmentioned quadrants. A hollow point means a report-backed alternative exists. The inspector provides its exact supporting passages and horizon. No 68%/90% coverage or confidence level is claimed.

The November 13 review retained one additional region: ING's conditional Iran/Gulf escalation scenario combines rising inflation with mounting recession risks, supporting Stagflation. ING's central point and its baseline outlook arrow are unchanged. The later inflation decline in that scenario does not establish below-target inflation and does not authorize a second region. U.S. Bank's published recession probability does not specify inflation conditional on recession; it is not converted into quadrant odds. The other mapped reports did not support an additional two-axis regime in this review. Source hashes, retrieval provenance and decisions are recorded in `data/reviews/2026-11-13-source-scenarios.json`.

The **hard-data** ellipse remains separate. It uses ±0.6pp growth and ±0.25pp inflation as transparent model sensitivity assumptions, not broker scenarios, statistical confidence intervals or probabilities. Its geometry is `((X-x)/rx)² + ((Y-y)/ry)² ≤ 1`; data overlap checks use the ellipse rather than its bounding box. Data uncertainty cannot expand an institution's view.

Comparisons describe mapped centers and separately flag a sourced scenario on the opposing side of an axis. A forecast may legitimately differ from current observations; different horizons are not an apples-to-apples forecast contest.

## Outlook paths

Arrows connect the **current hard-data reference** to each **forward-looking institutional point** on the same level axes. The arrow uses both coordinates: `(Δx, Δy) = (house.x − data.x, house.y − data.y)`. Screen geometry uses the actual horizontal and vertical chart scales, so an increase in inflation points upward despite SVG's downward-positive pixel coordinates. The head stops just before the destination dot. No arbitrary unit-length or purely vertical symbol substitutes for the forecast endpoint.

The endpoint is the existing dated house forecast or mapped view, with its actual horizon. Reported alternatives are displayed separately. A **dashed** arrow means at least one endpoint rate is our interpretation; a **solid** arrow means both rates are explicit published forecasts. Solid does not mean a certain outcome. Current-only assessments, missing/unresolved endpoint coordinates, incompatible benchmarks and legacy momentum points do not receive these paths. An identical origin and destination has no displacement arrow. Very short paths may be hidden to keep arrowheads from obscuring dots; the coordinate comparison remains available.

This is a reference-to-outlook comparison, **not the institution's own current-to-future forecast trajectory**. The starting GDP/GDPNow anchor and an annual house forecast can use different periods and annualization conventions. Their coordinate difference is not an estimated future change in a matched economic series. It must not be presented as the institution forecasting a slowdown of exactly that amount. No linear time evolution, speed or transition probability is implied. A baseline arrow does not portray the path or probability of a separately reported risk scenario.

For example, the reviewed ING endpoint is (+0.25, +0.70), versus the data reference (+1.45, +1.10): its arrow points left and down, with differences (−1.20, −0.40) pp. Its center remains in Overheating. Vanguard's mapped year-end 2026 point is (+0.30, +1.20), so the corresponding arrow points left and slightly up. Its separate statement about core PCE falling toward 2.5% by April 2027 concerns a later date and does not turn that year-end arrow downward.

The backend also retains explicitly stated qualitative future directions with verified excerpts and separate horizons. These remain in the point's expanded analysis; they no longer determine the map's arrows. Missing directions are unknown, not steady. Quotation matching confirms that words occur in the source, not that an interpretation is infallible. Thin lines from dots to their labels are layout connectors, not outlook paths.

## Daily collection and failure behavior

The Worker runs at 07:00 America/New_York daily. A database lock prevents concurrent refreshes and a unique daily ID prevents duplicate cron runs. Collection permits only bounded requests to allowlisted source hosts. Source text is treated as untrusted evidence. Repeated unchanged articles reuse their validated mapping. The catalog monitors 23 named research teams across banks, wealth managers and asset managers. HTML indexes discover new articles and explicitly approved publisher/CDN PDF reports. PDF extraction is limited to 3 MB and 40 pages; only text is read, so image-only forecast tables are not inferred. Month-only issues retain month precision in the interface; their internal first-of-month date is a conservative freshness anchor, not a claimed publication day.

Core CPI, headline inflation and global GDP are not direct U.S. real-GDP/core-PCE forecasts. The extractor receives these distinctions explicitly; direct labels require measure-specific supporting quotations, inferred axes remain labeled interpretations without fabricated ranges, and conditional-risk or missing macro quotations cannot become base-case points. Separately sourced risk scenarios can be retained under the explicit scenario rules above. These gates reduce errors but do not prove semantic accuracy. The November 13 coverage expansion was manually reviewed against primary sources; subsequent new articles use automated interpretation and remain labeled as such.

Provider failures retain previously verified observations or recent house views with their original timestamps and a visible warning. A complete failure leaves the previous snapshot live. Daily updates write a new D1 snapshot and require no frontend deployment. The included saved snapshot is an explicitly labeled fallback if the API is unreachable. The optional demo is fictional and cannot be imported into production.
