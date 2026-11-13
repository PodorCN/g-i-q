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

Workers AI reads each article's U.S. macro argument and extracts real-growth and core-inflation level estimates. An explicit forecast is marked **direct**. Qualitative statements are mapped to an approximate numerical level and marked **inferred**, with a broader range and a written explanation. Headline/unspecified inflation translated into a core-PCE-equivalent is inferred. Quoted third-party assessments must not become the author's own forecast. A strategist's commentary must not be presented as a formal institution-wide forecast.

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

## Uncertainty and comparison

Institution ellipses show subjective axis ranges from the mapper: typically about ±0.3–0.6pp for an explicit near-term forecast and ±0.7–1.2pp for qualitative or longer-horizon interpretation. They are not the institution's published forecast intervals, estimated standard errors, or calibrated 68%/90% confidence regions. The ellipse is a visual representation of two assumed marginal widths; it does not estimate correlation.

The hard-data point uses ±0.6pp growth and ±0.25pp inflation as transparent sensitivity assumptions. They are not statistical confidence intervals. The implementation retains a legacy momentum/bootstrap mode for old snapshots, but the live default and history selector use level snapshots.

Agreement compares which side of the benchmark each point falls on; an interval spanning zero is inconclusive. A forward-looking institution may differ legitimately from current/backward-looking observations. The narrative reports those differences without treating dissimilar horizons as an apples-to-apples forecast contest.

## Daily collection and failure behavior

The Worker runs at 07:00 America/New_York daily. A database lock prevents concurrent refreshes and a unique daily ID prevents duplicate cron runs. Collection permits only bounded requests to allowlisted source hosts. Source text is treated as untrusted evidence. Repeated unchanged articles reuse their validated mapping.

Provider failures retain previously verified observations or recent house views with their original timestamps and a visible warning. A complete failure leaves the previous snapshot live. Daily updates write a new D1 snapshot and require no frontend deployment. The included saved snapshot is an explicitly labeled fallback if the API is unreachable. The optional demo is fictional and cannot be imported into production.
