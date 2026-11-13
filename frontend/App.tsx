import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, Download, RefreshCw, Search, Settings2, X } from 'lucide-react';
import {
  axisSupport,
  isStale,
  regime,
  type Point,
  type Snapshot,
  type Indicator,
} from '../shared/schema';
import Chart from './Chart';
import { useSnapshot } from './useSnapshot';

type Tab = 'map' | 'views' | 'data' | 'sources' | 'methodology';
type Horizon = 'all' | 'current' | 'outlook';
const tabs = [
  { id: 'map', label: 'Map' },
  { id: 'views', label: 'House views' },
  { id: 'data', label: 'Data' },
  { id: 'sources', label: 'Sources' },
] as const;
const date = (value: string, time = false) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(time ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(new Date(value));
const number = (value: number, digits = 2) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: 'exceptZero',
  }).format(Math.abs(value) < 1e-9 ? 0 : value);
const rate = (value: number) =>
  `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)}%`;
const initialTab = () => {
  const tab = new URLSearchParams(window.location.search).get('view');
  return ['map', 'views', 'data', 'sources', 'methodology'].includes(tab || '')
    ? (tab as Tab)
    : 'map';
};

function SourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
      <ArrowUpRight size={14} aria-hidden="true" />
    </a>
  );
}
function HorizonLabel({ point }: { point: Point }) {
  return (
    <span className={`horizon-label ${point.horizon}`}>
      {point.kind === 'data'
        ? 'Data & nowcast'
        : point.horizon === 'outlook'
          ? 'Forward-looking'
          : 'Current assessment'}
    </span>
  );
}
function PointInspector({
  point,
  data,
  snapshot,
  onMethodology,
}: {
  point?: Point;
  data?: Point;
  snapshot: Snapshot;
  onMethodology: () => void;
}) {
  if (!point)
    return (
      <aside className="point-inspector">
        <h2>Explore a house view</h2>
        <p>Select a named point to see its horizon and the evidence behind it.</p>
      </aside>
    );
  const isData = point.kind === 'data';
  const anchors = snapshot.indicators.filter((i) => i.mode === 'level');
  return (
    <aside className="point-inspector" aria-label="Selected point" key={point.id}>
      <div className="inspector-heading">
        <HorizonLabel point={point} />
        <h2>{isData ? 'The data anchor' : point.shortName}</h2>
        <p>
          {isData
            ? 'Latest releases & current-quarter estimate'
            : point.horizonLabel || 'Horizon not specified'}
        </p>
      </div>
      <div className="point-coordinates">
        <div>
          <span>Growth gap</span>
          <strong>
            {number(point.x)}
            <small> pp</small>
          </strong>
        </div>
        <div>
          <span>Inflation gap</span>
          <strong>
            {number(point.y)}
            <small> pp</small>
          </strong>
        </div>
      </div>
      <p className="regime-line">
        <span className="small-cross" aria-hidden="true" />
        {regime(point.x, point.y)}
      </p>
      {isData ? (
        <div className="anchor-list">
          {anchors.map((i) => (
            <div key={i.id}>
              <div>
                <span>{i.name.replace('Atlanta Fed ', '')}</span>
                <small>{i.referenceWindow || i.period}</small>
              </div>
              <strong>{rate(i.value)}</strong>
            </div>
          ))}
          <p className="quiet-copy">
            GDP & GDPNow cover different quarters. The anchor blends both.
          </p>
        </div>
      ) : (
        <div className="point-evidence">
          {point.evidence.map((e) => (
            <section key={e.axis}>
              <div className="evidence-label">
                <span>{e.axis === 'growth' ? 'Growth' : 'Inflation'}</span>
                <span>
                  {(e.axis === 'growth' ? point.growthBasis : point.inflationBasis) === 'direct'
                    ? 'Published forecast'
                    : 'Our interpretation'}
                </span>
              </div>
              {e.quote ? <blockquote>“{e.quote}”</blockquote> : <p>{e.interpretation}</p>}
            </section>
          ))}
          <div className="point-source">
            <SourceLink href={point.sourceUrl}>Read the commentary</SourceLink>
            <span>{date(point.publishedAt)}</span>
          </div>
        </div>
      )}
      {isStale(point.publishedAt, snapshot.asOf, point.maxAgeDays || 35) && (
        <p className="inline-warning">This view is outside its freshness window.</p>
      )}
      <details className="disclosure inspector-analysis">
        <summary>
          Analysis & assumptions
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <div className="disclosure-body">
          <p>{point.summary}</p>
          {!isData && data && (
            <div className="data-comparison">
              <h3>Compared with the data</h3>
              <dl>
                {(['growth', 'inflation'] as const).map((axis) => (
                  <div key={axis}>
                    <dt>{axis === 'growth' ? 'Growth' : 'Inflation'}</dt>
                    <dd>{axisSupport(point, data, axis)}</dd>
                  </div>
                ))}
              </dl>
              <p>
                Different horizons can explain different positions. Distance alone is not a forecast
                error.
              </p>
            </div>
          )}
          <h3>Model ranges</h3>
          <dl className="range-values">
            <div>
              <dt>Growth</dt>
              <dd>
                {number(point.xRange.low)} to {number(point.xRange.high)} pp
              </dd>
            </div>
            <div>
              <dt>Inflation</dt>
              <dd>
                {number(point.yRange.low)} to {number(point.yRange.high)} pp
              </dd>
            </div>
          </dl>
          <p>
            Assumed ranges, without calibrated probability coverage. They are not the institution’s
            confidence intervals.
          </p>
          <button className="text-button" onClick={onMethodology}>
            How the mapping works <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        </div>
      </details>
      <div className="inspector-bottom">
        <span>
          {isData ? 'Retrieved' : 'Published'} {date(point.publishedAt)}
        </span>
        {isData && <SourceLink href={point.sourceUrl}>BEA source</SourceLink>}
      </div>
    </aside>
  );
}

function Methodology() {
  return (
    <article className="reading-page">
      <p className="reading-intro">
        Read positions as mapped views. Check the horizon, the source, and which numbers were
        inferred.
      </p>
      <section>
        <h2>What the axes measure</h2>
        <p>
          Growth is real GDP growth minus an assumed 2% trend. Inflation is core PCE inflation minus
          the 2% target. Both axes use percentage-point gaps. The 2% growth trend is a modeling
          assumption.
        </p>
        <div className="formula">
          Growth gap = real growth − 2%
          <br />
          Inflation gap = core inflation − 2%
        </div>
        <p>Slower growth can remain above trend. Falling inflation can remain above target.</p>
      </section>
      <section>
        <h2>How a house becomes a point</h2>
        <p>
          Explicit forecasts are labeled “Published forecast.” Qualitative commentary is translated
          into an approximate rate and labeled “Our interpretation.” These inferred numbers are our
          mapping, not forecasts published by the institution. Each point preserves a dated source,
          short verified quotations and the author’s actual horizon.
        </p>
        <p>
          There is one recent mapped point per institution. Current assessments, 6–12 month outlooks
          and annual forecasts are different comparisons; the horizon filter helps separate them.
        </p>
      </section>
      <section>
        <h2>What the ranges mean</h2>
        <p>
          The ellipses show subjective model ranges, not statistically calibrated confidence
          intervals. They have no 68% or 90% coverage meaning.
        </p>
        <p>
          House ranges use assumed half-widths, generally ±0.3–0.6 pp for explicit near-term
          forecasts and ±0.7–1.2 pp for qualitative or longer-term interpretation. The data anchor
          uses fixed sensitivity widths of ±0.6 pp for growth and ±0.25 pp for inflation. No
          growth–inflation covariance or historical coverage has been estimated.
        </p>
      </section>
      <section>
        <h2>What enters the data anchor</h2>
        <p>
          The growth anchor averages the latest BEA annualized quarterly GDP rate and Atlanta Fed
          GDPNow, then subtracts 2%. Inflation uses BEA year-over-year core PCE minus 2%. GDP and
          GDPNow cover different quarters; GDPNow is a nowcast rather than a realized observation.
        </p>
        <p>
          BLS labor and CPI series provide supporting context. They do not enter the main GDP/PCE
          coordinates.
        </p>
      </section>
      <section>
        <h2>Dates, freshness & coverage</h2>
        <p>
          Research refreshes daily at 7 a.m. New York time. Publication dates, observation periods
          and collection dates remain distinct. When collection fails, a recent verified view or
          observation may remain with its original date; source failures stay visible under Sources.
        </p>
        <p>
          Weekly, monthly and quarterly commentary generally has a 35-, 60- or 90-day freshness
          window. The chart includes a monitored sample of public research, not every institution’s
          complete forecast set.
        </p>
      </section>
      <SourceLink href="https://github.com/PodorCN/g-i-q/blob/main/docs/methodology.md">
        Read the full methodology
      </SourceLink>
    </article>
  );
}

function DataPage({ snapshot }: { snapshot: Snapshot }) {
  const anchors = snapshot.indicators.filter((i) => i.mode === 'level');
  const supporting = snapshot.indicators.filter((i) => i.mode !== 'level');
  const point = snapshot.points.find((p) => p.kind === 'data');
  return (
    <div className="data-page">
      <p className="page-note">
        The map uses these published anchors. Their reference periods differ.
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Indicator</th>
              <th>Published rate</th>
              <th>Gap to 2%</th>
              <th>Reference</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {anchors.map((i) => (
              <tr key={i.id}>
                <td>
                  <strong>{i.name}</strong>
                  <small>{i.axis === 'growth' ? 'Growth' : 'Inflation'}</small>
                </td>
                <td className="numeric">{rate(i.value)}</td>
                <td className="numeric">{number(i.value - (i.benchmark ?? 2))} pp</td>
                <td>{i.referenceWindow || i.period}</td>
                <td>
                  <SourceLink href={i.sourceUrl}>Official data</SourceLink>
                </td>
              </tr>
            ))}
            {!anchors.length && (
              <tr>
                <td colSpan={5}>No published GDP/PCE anchors are available in this snapshot.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {point && (
        <section className="data-reading">
          <h2>What the data supports</h2>
          <p>{point.summary}</p>
          <p className="quiet-copy">
            Compare this anchor with house views at matching horizons and growth-rate definitions.
            An annual forecast and quarterly annualized growth are not interchangeable.
          </p>
        </section>
      )}
      <details className="disclosure supporting-data">
        <summary>
          Supporting labor & CPI indicators <span>{supporting.length}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="disclosure-body">
          <p className="page-note">
            These momentum measures provide context and do not determine the map coordinates.
          </p>
          {supporting.map((i) => (
            <IndicatorDetails key={i.id} indicator={i} />
          ))}
        </div>
      </details>
    </div>
  );
}
function IndicatorDetails({ indicator: i }: { indicator: Indicator }) {
  return (
    <details className="indicator-row">
      <summary>
        <strong>{i.name}</strong>
        <span>{i.period}</span>
        <span>{number(i.currentMomentum)}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="indicator-body">
        <p>{i.transform}</p>
        <dl>
          <div>
            <dt>Latest 3-month momentum</dt>
            <dd>{number(i.currentMomentum)}</dd>
          </div>
          <div>
            <dt>Previous 3-month momentum</dt>
            <dd>{number(i.priorMomentum)}</dd>
          </div>
          <div>
            <dt>Change</dt>
            <dd>{number(i.acceleration)}</dd>
          </div>
        </dl>
        <p>
          Units: {i.unit}. Retrieved {date(i.retrievedAt)}.
        </p>
        <SourceLink href={i.sourceUrl}>Open source</SourceLink>
        <details>
          <summary>Raw observation history</summary>
          <div className="raw-history">
            {i.history.map((row) => (
              <div key={row.date}>
                <span>{row.date}</span>
                <span>
                  {new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(row.value)}
                </span>
              </div>
            ))}
          </div>
        </details>
      </div>
    </details>
  );
}

export default function App() {
  const { snapshot, status, error, refreshing, history, historyId, load } = useSnapshot();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [selectedId, setSelectedId] = useState(
    () => new URLSearchParams(window.location.search).get('point') || 'hard-data',
  );
  const [horizon, setHorizon] = useState<Horizon>(() => {
    const value = new URLSearchParams(window.location.search).get('horizon');
    return value === 'current' || value === 'outlook' ? value : 'all';
  });
  const [rangeMode, setRangeMode] = useState<'selected' | 'all' | 'none'>('selected');
  const [showLabels, setShowLabels] = useState(
    () => !window.matchMedia('(max-width: 600px)').matches,
  );
  const [houseQuery, setHouseQuery] = useState('');
  const [sourceQuery, setSourceQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const displayOptions = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const [key, value, fallback] of [
      ['view', tab, 'map'],
      ['horizon', horizon, 'all'],
      ['point', selectedId, 'hard-data'],
    ]) {
      if (value === fallback) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    window.history.replaceState(null, '', url);
  }, [tab, horizon, selectedId]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (displayOptions.current && !displayOptions.current.contains(event.target as Node))
        displayOptions.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && displayOptions.current?.open) {
        displayOptions.current.open = false;
        displayOptions.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const dataPoint = snapshot?.points.find((p) => p.kind === 'data');
  const houses =
    snapshot?.points.filter(
      (p) => p.kind === 'institution' && !isStale(p.publishedAt, snapshot.asOf, p.maxAgeDays || 35),
    ) || [];
  const filteredHouses = houses.filter((p) => horizon === 'all' || p.horizon === horizon);
  const visiblePoints = [...(dataPoint ? [dataPoint] : []), ...filteredHouses];
  const selected = visiblePoints.find((p) => p.id === selectedId) || visiblePoints[0];
  const houseResults = filteredHouses.filter((p) =>
    `${p.institution} ${p.title}`.toLowerCase().includes(houseQuery.toLowerCase()),
  );
  const documents = (snapshot?.documents || []).filter(
    (d) =>
      (sourceFilter === 'all' || d.status === sourceFilter) &&
      `${d.institution} ${d.title}`.toLowerCase().includes(sourceQuery.toLowerCase()),
  );
  const issues = snapshot?.sources.filter((s) => s.status !== 'ok') || [];
  const stale = !!snapshot && !historyId && Date.now() - Date.parse(snapshot.asOf) > 36 * 3600_000;
  const notice =
    status === 'demo'
      ? 'Illustrative demo — fictional institutions and numbers.'
      : error ||
        (stale
          ? 'This snapshot is more than 36 hours old. Check source dates before treating it as current.'
          : '');
  const titles: Record<Tab, string> = {
    map: 'Growth–inflation map',
    views: 'House views',
    data: 'Behind the data point',
    sources: 'Research sources',
    methodology: 'How to read the map',
  };
  function changeTab(next: Tab) {
    setTab(next);
    window.scrollTo({ top: 0 });
  }
  function inspect(point: Point) {
    setSelectedId(point.id);
    changeTab('map');
  }
  function exportSnapshot() {
    if (!snapshot) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `giq-${snapshot.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  const horizonControl = (
    <div className="horizon-control" role="group" aria-label="View horizon">
      {(
        [
          { id: 'all', name: 'All views' },
          { id: 'current', name: 'Current' },
          { id: 'outlook', name: 'Forward-looking' },
        ] as const
      ).map((item) => (
        <button
          key={item.id}
          aria-pressed={horizon === item.id}
          onClick={() => setHorizon(item.id)}
        >
          {item.name}
        </button>
      ))}
    </div>
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="/" aria-label="G I Q home">
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <strong>g / i / q</strong>
          </a>
          <nav aria-label="Research sections">
            {tabs.map((item) => (
              <button
                key={item.id}
                className={tab === item.id ? 'active' : ''}
                aria-current={tab === item.id ? 'page' : undefined}
                onClick={() => changeTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <span className="header-region">United States</span>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <div className="page-heading">
          <div>
            <h1>{titles[tab]}</h1>
            <p>
              {tab === 'map'
                ? `${houses.length} house views alongside US data & nowcasts.`
                : tab === 'views'
                  ? 'The source, horizon and interpretation behind every institution.'
                  : tab === 'data'
                    ? 'Published observations first. Supporting context one step deeper.'
                    : tab === 'sources'
                      ? 'Public commentary, official releases and collection coverage.'
                      : 'Definitions, assumptions and the limits of the analysis.'}
            </p>
          </div>
          {snapshot && (
            <div className="snapshot-controls">
              <label>
                <span className="sr-only">Snapshot date</span>
                <select
                  aria-label="Snapshot date"
                  value={historyId}
                  onChange={(e) => void load(e.target.value)}
                >
                  <option value="">
                    Latest · {date(historyId ? history[0]?.asOf || snapshot.asOf : snapshot.asOf)}
                  </option>
                  {history.map((item) => (
                    <option key={item.id} value={item.id}>
                      {date(item.asOf, true)} UTC
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="icon-button"
                aria-label="Refresh research"
                disabled={refreshing}
                onClick={() => void load(historyId)}
              >
                <RefreshCw size={16} className={refreshing ? 'spin' : ''} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            {status === 'demo' ? (
              <a href="/">Return to live research</a>
            ) : (
              <button onClick={() => void load(historyId, !snapshot)}>Retry</button>
            )}
          </div>
        )}
        {!snapshot ? (
          <div className="loading-state" role="status">
            {status === 'loading' ? (
              <>
                <div className="skeleton-line" />
                <div className="skeleton-chart" />
                <span>Loading the research…</span>
              </>
            ) : (
              <>
                <h2>No research is available</h2>
                <p>Try again to load the latest snapshot.</p>
                <button className="secondary-button" onClick={() => void load('', true)}>
                  Try again
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            {tab === 'map' && (
              <>
                <section className="map-workspace" aria-label="Quadrant research workspace">
                  <div className="chart-column">
                    <div className="chart-toolbar">
                      {horizonControl}
                      <details className="display-options" ref={displayOptions}>
                        <summary>
                          <Settings2 size={16} aria-hidden="true" />
                          <span>Display</span>
                        </summary>
                        <div className="display-popover">
                          <label>
                            Ranges
                            <select
                              aria-label="Range display"
                              value={rangeMode}
                              onChange={(e) => setRangeMode(e.target.value as typeof rangeMode)}
                            >
                              <option value="selected">Selected point</option>
                              <option value="all">All points</option>
                              <option value="none">Hidden</option>
                            </select>
                          </label>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={showLabels}
                              onChange={(e) => setShowLabels(e.target.checked)}
                            />
                            All institution labels
                          </label>
                          <p>
                            Ranges are subjective estimates, without calibrated probability
                            coverage.
                          </p>
                        </div>
                      </details>
                    </div>
                    <Chart
                      points={visiblePoints}
                      selectedId={selected?.id || ''}
                      onSelect={setSelectedId}
                      showRanges={rangeMode !== 'none'}
                      rangeMode={rangeMode === 'all' ? 'all' : 'selected'}
                      showLabels={showLabels}
                    />
                    <div className="mobile-house-list" aria-label="Select a house view">
                      {visiblePoints.map((point) => (
                        <button
                          key={point.id}
                          aria-pressed={selected?.id === point.id}
                          onClick={() => setSelectedId(point.id)}
                        >
                          <span style={{ background: point.color }} />
                          {point.shortName}
                        </button>
                      ))}
                    </div>
                    <div className="map-caption">
                      <span>Mixed horizons. Select a point to inspect its source.</span>
                      <button className="text-button" onClick={() => changeTab('methodology')}>
                        How to read this <ArrowUpRight size={13} aria-hidden="true" />
                      </button>
                    </div>
                    {!filteredHouses.length && (
                      <p className="inline-empty">
                        No house views match this horizon.{' '}
                        <button className="text-button" onClick={() => setHorizon('all')}>
                          Show all views
                        </button>
                      </p>
                    )}
                  </div>
                  <PointInspector
                    point={selected}
                    data={dataPoint}
                    snapshot={snapshot}
                    onMethodology={() => changeTab('methodology')}
                  />
                </section>
                <div className="map-bottom">
                  <button className="text-button" onClick={() => changeTab('views')}>
                    Compare all {houses.length} house views{' '}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </button>
                  <span>Daily research · 7 a.m. New York</span>
                </div>
              </>
            )}
            {tab === 'views' && (
              <section className="views-page">
                <div className="section-toolbar">
                  {horizonControl}
                  <label className="search-field">
                    <Search size={15} aria-hidden="true" />
                    <input
                      aria-label="Search institutions"
                      name="institution"
                      autoComplete="off"
                      placeholder="Find an institution…"
                      value={houseQuery}
                      onChange={(e) => setHouseQuery(e.target.value)}
                    />
                    {houseQuery && (
                      <button
                        aria-label="Clear institution search"
                        onClick={() => setHouseQuery('')}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    )}
                  </label>
                </div>
                <div className="table-scroll">
                  <table className="house-table">
                    <thead>
                      <tr>
                        <th>Institution</th>
                        <th>Growth gap</th>
                        <th>Inflation gap</th>
                        <th>View horizon</th>
                        <th>Published</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {houseResults.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <button className="house-name" onClick={() => inspect(p)}>
                              <span style={{ background: p.color }} />
                              {p.shortName}
                              <ArrowUpRight size={14} aria-hidden="true" />
                            </button>
                          </td>
                          <td className="numeric">
                            <strong>{number(p.x)} pp</strong>
                            <small>
                              {p.growthBasis === 'direct' ? 'Published' : 'Interpreted'}
                            </small>
                          </td>
                          <td className="numeric">
                            <strong>{number(p.y)} pp</strong>
                            <small>
                              {p.inflationBasis === 'direct' ? 'Published' : 'Interpreted'}
                            </small>
                          </td>
                          <td>
                            <HorizonLabel point={p} />
                            <small>{p.horizonLabel || p.horizon}</small>
                          </td>
                          <td>{date(p.publishedAt)}</td>
                          <td>
                            <SourceLink href={p.sourceUrl}>Article</SourceLink>
                          </td>
                        </tr>
                      ))}
                      {!houseResults.length && (
                        <tr>
                          <td colSpan={6} className="empty-table">
                            No institutions match. Try another horizon or clear the search.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="page-note">
                  Gaps are percentage points relative to 2% benchmarks. “Interpreted” values are our
                  mapping of the commentary, not published forecasts.
                </p>
              </section>
            )}
            {tab === 'data' && <DataPage snapshot={snapshot} />}
            {tab === 'sources' && (
              <section className="sources-page">
                <details className="disclosure coverage-details">
                  <summary>
                    Collection coverage{' '}
                    <span>
                      {issues.length ? `${issues.length} need attention` : 'All sources refreshed'}
                    </span>
                    <ChevronDown size={16} aria-hidden="true" />
                  </summary>
                  <div className="disclosure-body">
                    {snapshot.warnings.map((warning, i) => (
                      <p key={i} className="inline-warning">
                        {warning}
                      </p>
                    ))}
                    {snapshot.sources.map((source) => (
                      <details key={source.id} className="source-row">
                        <summary>
                          <strong>{source.name}</strong>
                          <span className={`source-state ${source.status}`}>
                            {source.status === 'ok'
                              ? 'Updated'
                              : source.status === 'partial'
                                ? 'Partial'
                                : 'Unavailable'}
                          </span>
                          <ChevronDown size={14} aria-hidden="true" />
                        </summary>
                        <div>
                          <p>{source.message}</p>
                          <small>Checked {date(source.checkedAt, true)} UTC</small>
                          <SourceLink href={source.url}>Open source</SourceLink>
                        </div>
                      </details>
                    ))}
                  </div>
                </details>
                <div className="section-toolbar">
                  <label className="search-field">
                    <Search size={15} aria-hidden="true" />
                    <input
                      aria-label="Search source articles"
                      name="source"
                      autoComplete="off"
                      placeholder="Search commentary…"
                      value={sourceQuery}
                      onChange={(e) => setSourceQuery(e.target.value)}
                    />
                  </label>
                  <label className="filter-select">
                    <span className="sr-only">Evidence status</span>
                    <select
                      aria-label="Evidence status"
                      value={sourceFilter}
                      onChange={(e) => setSourceFilter(e.target.value)}
                    >
                      <option value="all">All evidence</option>
                      <option value="scored">Mapped views</option>
                      <option value="unscored">Unmapped articles</option>
                      <option value="news">Official releases</option>
                      <option value="stale">Older articles</option>
                      <option value="error">Unavailable</option>
                    </select>
                  </label>
                </div>
                <div className="article-list">
                  {documents.map((doc) => (
                    <article key={doc.id}>
                      <div className="article-meta">
                        <strong>{doc.shortName}</strong>
                        <span>{doc.publishedAt ? date(doc.publishedAt) : 'Date unverified'}</span>
                        <span className="article-state">
                          {
                            {
                              scored: 'Mapped',
                              unscored: 'Unmapped',
                              news: 'Official release',
                              stale: 'Older article',
                              error: 'Unavailable',
                            }[doc.status]
                          }
                        </span>
                      </div>
                      <h2>
                        <SourceLink href={doc.url}>{doc.title}</SourceLink>
                      </h2>
                      <details>
                        <summary>Research notes</summary>
                        <p>{doc.reason}</p>
                        {doc.excerpt && <p>{doc.excerpt}</p>}
                      </details>
                    </article>
                  ))}
                  {!documents.length && (
                    <p className="empty-table">
                      No articles match. Clear the search or choose another evidence status.
                    </p>
                  )}
                </div>
              </section>
            )}
            {tab === 'methodology' && <Methodology />}
          </>
        )}
        <footer className="site-footer">
          <div>
            <span className={`status-dot ${status === 'live' && !stale ? 'live' : ''}`} />
            {historyId
              ? 'Historical snapshot'
              : status === 'saved'
                ? 'Saved snapshot'
                : status === 'demo'
                  ? 'Illustrative demo'
                  : snapshot
                    ? `Updated ${date(snapshot.asOf, true)} UTC`
                    : 'Research unavailable'}
            {issues.length > 0 && (
              <button onClick={() => changeTab('sources')}>Coverage notes</button>
            )}
          </div>
          <div>
            <button onClick={() => changeTab('methodology')}>Methodology</button>
            <button onClick={exportSnapshot} disabled={!snapshot}>
              <Download size={13} aria-hidden="true" />
              Export data
            </button>
            <SourceLink href="https://github.com/PodorCN/g-i-q/tree/main">Code</SourceLink>
          </div>
        </footer>
      </main>
    </div>
  );
}
