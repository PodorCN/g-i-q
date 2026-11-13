import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Focus,
  Layers3,
  ListFilter,
  LoaderCircle,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  SnapshotSchema,
  isStale,
  axisSupport,
  regime,
  type Snapshot,
  type Point,
  type Indicator,
} from '../shared/schema';
import Chart from './Chart';

type Tab = 'map' | 'data' | 'sources' | 'methodology';
type HistoryItem = { id: string; asOf: string; axisMode?: string };
const date = (value: string, options: Intl.DateTimeFormatOptions = {}) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options,
  }).format(new Date(value));
const number = (value: number, digits = 2) => `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
const direction = (value: number) =>
  Math.abs(value) < 0.08 ? 'At benchmark' : value > 0 ? 'Above benchmark' : 'Below benchmark';
const agree = (a: number, b: number) =>
  Math.abs(a) < 0.08 || Math.abs(b) < 0.08 ? 'Unclear' : a * b > 0 ? 'Aligned' : 'Diverges';

function SourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}
function Sparkline({ indicator }: { indicator: Indicator }) {
  const values = indicator.history.map((item) => item.value),
    min = Math.min(...values),
    span = Math.max(...values) - min || 1;
  const path = values
    .map(
      (value, index) =>
        `${index ? 'L' : 'M'}${(index / Math.max(1, values.length - 1)) * 130},${32 - ((value - min) / span) * 28}`,
    )
    .join(' ');
  return (
    <svg
      viewBox="0 0 132 36"
      role="img"
      aria-label={`${indicator.name}, recent raw observations`}
      className="sparkline"
    >
      <path
        d={path}
        fill="none"
        stroke={indicator.axis === 'growth' ? '#27877f' : '#bd7a4e'}
        strokeWidth="2"
      />
      <circle
        cx="130"
        cy={32 - ((values.at(-1)! - min) / span) * 28}
        r="2.6"
        fill={indicator.axis === 'growth' ? '#27877f' : '#bd7a4e'}
      />
    </svg>
  );
}
function Inspector({
  point,
  data,
  indicators,
  snapshotDate,
}: {
  point?: Point;
  data?: Point;
  indicators: Indicator[];
  snapshotDate: string;
}) {
  if (!point)
    return (
      <aside className="inspector empty-inspector">
        <Focus size={30} />
        <h3>Follow a point to its source</h3>
        <p>
          Select an institution in the chart or the ledger to inspect the growth and inflation
          evidence.
        </p>
      </aside>
    );
  const isData = point.kind === 'data';
  return (
    <aside className="inspector" aria-label="Selected point evidence">
      <div className="inspector-topline">
        <span>
          <Focus size={14} /> {isData ? 'Data estimate' : 'Selected view'}
        </span>
        <span className="point-number">
          {isData
            ? 'BLS'
            : point.method === 'llm'
              ? 'AI interpreted'
              : point.method === 'reviewed'
                ? 'Reviewed'
                : 'Rule extracted'}
        </span>
      </div>
      <div className="selected-house">
        <span
          className={isData ? 'house-diamond' : 'house-dot'}
          style={{ background: point.color }}
        />
        <h3>{point.shortName}</h3>
      </div>
      <p className="inspector-regime">{regime(point.x, point.y)}</p>
      <div className="selected-meta">
        <span>
          <Clock3 size={13} />
          {isData ? 'Retrieved ' : ''}
          {date(point.publishedAt, { timeZone: isData ? 'America/New_York' : 'UTC' })}
        </span>
        <span>
          {point.horizonLabel || (point.horizon === 'current' ? 'Current trend' : 'Outlook')}
        </span>
      </div>
      {isStale(point.publishedAt, snapshotDate, point.maxAgeDays || 35) && (
        <p className="small-warning">This view is outside its source freshness window.</p>
      )}
      <div className="coordinate-pair">
        <div>
          <span>Growth gap (pp)</span>
          <strong>
            {point.growthDirection === 'unclear' ? '?' : number(point.x)}
            <small>
              {point.growthDirection === 'unclear' ? 'Direction unresolved' : direction(point.x)}
            </small>
          </strong>
        </div>
        <div>
          <span>Inflation gap (pp)</span>
          <strong>
            {point.inflationDirection === 'unclear' ? '?' : number(point.y)}
            <small>
              {point.inflationDirection === 'unclear' ? 'Direction unresolved' : direction(point.y)}
            </small>
          </strong>
        </div>
      </div>
      {point.evidence.map((item) => (
        <section key={item.axis} className="axis-evidence">
          <h4>{item.axis === 'growth' ? 'Growth evidence' : 'Inflation evidence'}</h4>
          {item.quote && <blockquote>“{item.quote}…”</blockquote>}
          <p>{item.interpretation}</p>
        </section>
      ))}
      <section className="range-note">
        <h4>
          <ShieldCheck size={14} /> {isData ? 'What the interval means' : 'What the range means'}
        </h4>
        <p>
          {isData
            ? point.axisMode === 'levels'
              ? 'Sensitivity range around GDP/GDPNow and core PCE anchors: ±0.6pp growth and ±0.25pp inflation. This is a modeling assumption, not an official statistical interval.'
              : '80% marginal component-bootstrap ranges; not calibrated forecast uncertainty.'
            : 'A subjective range around the mapped growth and inflation levels. Direct forecasts and inferred estimates are labeled in the evidence; these ranges are ours.'}
        </p>
        <span>
          Growth [{number(point.xRange.low)}, {number(point.xRange.high)}]
        </span>
        <span>
          Inflation [{number(point.yRange.low)}, {number(point.yRange.high)}]
        </span>
      </section>
      {!isData && data && (
        <section className="data-check">
          <h4>Does the data support this?</h4>
          {(['growth', 'inflation'] as const).map((axis) => {
            const status = axisSupport(point, data, axis);
            return (
              <div key={axis}>
                <span>{axis === 'growth' ? 'Growth vs trend' : 'Inflation vs target'}</span>
                <b className={status === 'Aligned' ? 'aligned' : 'diverges'}>
                  {status === 'Aligned' ? <Check size={13} /> : <TriangleAlert size={12} />}
                  {status}
                </b>
              </div>
            );
          })}
          <p>
            {point.horizon === 'outlook'
              ? 'The view looks ahead; the data looks back. A difference is not a forecast error.'
              : 'Benchmark-side comparison only. Ranges spanning zero remain inconclusive.'}
          </p>
        </section>
      )}

      <p className="selected-summary">{point.summary}</p>
      <div className="inspector-source">
        <SourceLink href={point.sourceUrl}>
          {isData ? 'Open official data' : 'Read original commentary'}
        </SourceLink>
        <span>Retrieved {date(point.retrievedAt)}</span>
      </div>
    </aside>
  );
}

function Methodology() {
  const sections = [
    [
      'The axes are levels, not momentum',
      'X is expected real GDP growth minus an assumed 2.0% trend benchmark. Y is expected core PCE inflation minus the 2.0% inflation target. Values are percentage-point gaps. Slower growth can still be above trend; falling inflation can still be above target.',
    ],
    [
      'Institution views are interpreted research',
      'Each dot links to a dated commentary. Explicit numerical forecasts are labeled direct. Qualitative language is mapped to an implied growth or core-inflation rate and labeled inferred; it is our estimate, not a number published by that institution. The actual author and forecast horizon stay visible.',
    ],
    [
      'Official data and nowcasts',
      'The hard-data growth anchor averages the latest BEA annualized real GDP release and Atlanta Fed GDPNow, then subtracts 2.0%. The inflation anchor is BEA core PCE year-over-year inflation minus 2.0%. These growth measures cover different quarters. BLS labor and CPI series provide supporting context and do not become GDP-growth percentages.',
    ],
    [
      'Ranges express model uncertainty',
      'Institution ranges use subjective one-sigma assumptions supplied with the interpretation, widened for qualitative forecasts. The data anchor uses sensitivity widths of ±0.6 percentage points for growth and ±0.25 for inflation. These are not empirically calibrated confidence intervals or intervals published by the source institution.',
    ],
    [
      'Horizons and source age',
      'All views are shown by default. Current assessments, six-to-twelve-month outlooks, and annual forecasts keep their actual horizon labels. Weekly sources use a 35-day freshness window; monthly and quarterly outlooks use 60 or 90 days. Quotes must match the source word sequence; typography changes are normalized.',
    ],
    [
      'Daily updates are backend only',
      'The Worker collects at 7 a.m. New York time and stores versioned D1 snapshots. The frontend reads the API. Unchanged articles retain their mapped position; unavailable sources retain a recent verified view with original dates. Failed data requests never become new observations.',
    ],
  ];
  return (
    <div className="methodology-page">
      <div className="section-heading">
        <div>
          <h2>How to read the quadrant.</h2>
          <p>Published views, explicit assumptions, and a source behind every point.</p>
        </div>
        <span className="version-tag">Growth / inflation gaps</span>
      </div>
      <div className="method-grid">
        {sections.map(([title, text]) => (
          <article key={title}>
            <span className="method-icon">
              <BookOpen />
            </span>
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<'loading' | 'live' | 'saved' | 'demo' | 'error' | 'offline'>(
    'loading',
  );
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('map');
  const [selectedId, setSelectedId] = useState('hard-data');
  const [horizon, setHorizon] = useState<'all' | 'current' | 'outlook'>('all');
  const [showRanges, setShowRanges] = useState(true),
    [showLabels, setShowLabels] = useState(true);
  const [query, setQuery] = useState(''),
    [viewFilter, setViewFilter] = useState('all');
  const [history, setHistory] = useState<HistoryItem[]>([]),
    [historyId, setHistoryId] = useState('');
  const [noticeOpen, setNoticeOpen] = useState(false);
  const isDemo = useRef(new URLSearchParams(window.location.search).get('demo') === '1');
  const latestRequest = useRef(0);

  async function load(id = '', initial = false) {
    const requestId = ++latestRequest.current;
    setRefreshing(true);
    try {
      const endpoint = isDemo.current
        ? '/data/demo.json'
        : `/api/snapshot${id ? `?id=${encodeURIComponent(id)}` : ''}`;
      const response = await fetch(endpoint, { cache: 'no-store' });
      if (!response.ok) throw new Error(`The research API returned ${response.status}.`);
      const next = SnapshotSchema.parse(await response.json());
      if (requestId !== latestRequest.current) return;
      setSnapshot(next);
      setStatus(next.demo ? 'demo' : 'live');
      setHistoryId(id);
      setError('');
    } catch (failure) {
      if (requestId !== latestRequest.current) return;
      if (initial && !id && !isDemo.current) {
        try {
          const response = await fetch('/data/bootstrap.json', { cache: 'no-store' });
          if (!response.ok) throw new Error('No saved snapshot');
          const saved = SnapshotSchema.parse(await response.json());
          if (requestId !== latestRequest.current) return;
          setSnapshot(saved);
          setStatus('saved');
          setError(
            'The backend is not reachable. You are viewing the dated snapshot shipped with this build.',
          );
        } catch {
          setStatus('error');
          setError(
            'No research snapshot is available. Connect the backend or run npm run refresh locally.',
          );
        }
      } else {
        setStatus('offline');
        setError(
          failure instanceof Error ? failure.message : 'Could not load the research snapshot.',
        );
      }
    } finally {
      if (requestId === latestRequest.current) setRefreshing(false);
    }
  }
  useEffect(() => {
    void load('', true);
    void fetch('/api/history')
      .then((r) => (r.ok ? r.json() : { snapshots: [] }))
      .then((data) =>
        setHistory(
          (data.snapshots || []).filter((item: HistoryItem) => item.axisMode === 'levels'),
        ),
      )
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (historyId || isDemo.current) return;
    const timer = window.setInterval(() => void load(), 300_000);
    return () => window.clearInterval(timer);
  }, [historyId]);

  const dataPoint = snapshot?.points.find((point) => point.kind === 'data');
  const institutionPoints =
    snapshot?.points.filter(
      (point) =>
        point.kind === 'institution' &&
        (horizon === 'all' || point.horizon === horizon) &&
        !isStale(point.publishedAt, snapshot.asOf, point.maxAgeDays || 35),
    ) || [];
  const visiblePoints = [...(dataPoint ? [dataPoint] : []), ...institutionPoints].filter(
    (point) =>
      !query || `${point.institution} ${point.title}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = visiblePoints.find((point) => point.id === selectedId) || visiblePoints[0];
  const documents = useMemo(
    () =>
      (snapshot?.documents || []).filter(
        (doc) =>
          (!query ||
            `${doc.institution} ${doc.title}`.toLowerCase().includes(query.toLowerCase())) &&
          (viewFilter === 'all' || doc.status === viewFilter),
      ),
    [snapshot, query, viewFilter],
  );
  const covered = snapshot?.sources.filter((source) => source.type === 'commentary').length || 0;
  const healthy = snapshot?.sources.filter((source) => source.status === 'ok').length || 0;
  const staleSnapshot = !!snapshot && Date.now() - Date.parse(snapshot.asOf) > 36 * 3600_000;

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

  return (
    <div className="app-shell">
      <header className="topbar">
        <a href="/" className="brand" aria-label="G I Q home">
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <strong>g / i / q</strong>
          <span className="brand-description">Growth & inflation observatory</span>
        </a>
        <div className="topbar-right">
          <span className="region">
            <span className="us-flag" aria-hidden="true">
              🇺🇸
            </span>{' '}
            United States
          </span>
          <span className="topbar-divider" />
          <span className="schedule-text">
            <Clock3 size={13} /> Daily at 7 a.m. ET
          </span>
          <a
            className="github-link"
            href="https://github.com/PodorCN/g-i-q"
            target="_blank"
            rel="noreferrer"
          >
            Repository <ArrowUpRight size={15} />
          </a>
        </div>
      </header>
      <div className="navigation-row">
        <nav aria-label="Main navigation">
          {(
            [
              { id: 'map', name: 'Quadrant map', icon: Focus },
              { id: 'data', name: 'Hard data', icon: Layers3 },
              { id: 'sources', name: 'Sources & coverage', icon: Radio },
              { id: 'methodology', name: 'Methodology', icon: BookOpen },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? 'active' : ''}
              onClick={() => setTab(item.id)}
            >
              <item.icon size={16} />
              {item.name}
            </button>
          ))}
        </nav>
        <div
          className={`connection-status ${status === 'live' && !staleSnapshot ? 'connected' : ''}`}
        >
          <span />
          {historyId
            ? 'Historical snapshot'
            : status === 'loading'
              ? 'Connecting'
              : status === 'demo'
                ? 'Illustrative demo'
                : status === 'saved'
                  ? 'Saved snapshot'
                  : staleSnapshot
                    ? 'Update overdue'
                    : status === 'live'
                      ? 'Backend connected'
                      : 'Backend unavailable'}
        </div>
      </div>
      <main>
        {(error || status === 'demo' || staleSnapshot) && (
          <div className={`notice ${status === 'demo' ? 'demo-notice' : ''}`} role="status">
            <TriangleAlert size={16} />
            <span>
              {status === 'demo'
                ? 'Illustrative demo. These fictional institutions and numbers are for testing the interface, not a current market assessment.'
                : error ||
                  'This snapshot is more than 36 hours old. Inspect source dates before treating it as current.'}
            </span>
            {status === 'demo' ? (
              <a href="/">Return to research</a>
            ) : (
              <button onClick={() => void load(historyId)}>Retry connection</button>
            )}
          </div>
        )}
        {status === 'loading' && !snapshot ? (
          <div className="loading-state">
            <LoaderCircle className="spin" size={25} />
            <h2>Opening the research desk…</h2>
            <p>Loading the latest evidence and source coverage.</p>
          </div>
        ) : !snapshot ? (
          <div className="loading-state">
            <Radio size={28} />
            <h2>The research desk is waiting for data.</h2>
            <p>{error}</p>
            <button className="primary-button" onClick={() => void load('', true)}>
              Try again
            </button>
            <a className="demo-link" href="/?demo=1">
              Explore an illustrative demo
            </a>
          </div>
        ) : tab === 'methodology' ? (
          <Methodology />
        ) : (
          <>
            <div className="page-heading">
              <div>
                <div className="heading-context">
                  <span className="context-line" />
                  U.S. macro research
                </div>
                <h1>
                  {tab === 'map'
                    ? 'Growth–inflation quadrant'
                    : tab === 'data'
                      ? 'What is the data actually saying?'
                      : 'A clear view of the coverage.'}
                </h1>
                <p>
                  {tab === 'map'
                    ? 'Published house views and hard data. Growth vs trend; core inflation vs the 2% target.'
                    : tab === 'data'
                      ? 'Published growth and core-inflation anchors, plus supporting labor and CPI indicators.'
                      : 'Dated commentary, official releases, and the sources that need attention.'}
                </p>
              </div>
              <div className="snapshot-controls">
                <label className="snapshot-select">
                  <span>Snapshot</span>
                  <select
                    aria-label="Snapshot date"
                    value={historyId}
                    onChange={(event) => {
                      void load(event.target.value);
                    }}
                  >
                    <option value="">
                      Latest
                      {(!historyId || history[0]?.asOf) &&
                        ` · ${date(historyId ? history[0].asOf : snapshot.asOf, { year: undefined })}`}
                    </option>
                    {history
                      .filter((item) => item.id !== snapshot.id || historyId)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {date(item.asOf)} ·{' '}
                          {date(item.asOf, {
                            hour: 'numeric',
                            minute: '2-digit',
                            year: undefined,
                            month: undefined,
                            day: undefined,
                          })}
                        </option>
                      ))}
                  </select>
                  <ChevronDown size={14} />
                </label>
                <button
                  className="icon-button refresh-button"
                  aria-label="Fetch latest backend snapshot"
                  onClick={() => void load(historyId)}
                  disabled={refreshing}
                >
                  <RefreshCw size={17} className={refreshing ? 'spin' : ''} />
                </button>
              </div>
            </div>
            <div className="research-strip">
              <div className="regime-summary">
                <span className="data-mark">◆</span>
                <div>
                  <span>Data-implied regime</span>
                  <strong>
                    {dataPoint ? regime(dataPoint.x, dataPoint.y) : 'Insufficient recent data'}
                  </strong>
                </div>
              </div>
              <div>
                <span>Plotted institutions</span>
                <strong>
                  {new Set(institutionPoints.map((point) => point.institution)).size}
                  <small>of {covered} monitored</small>
                </strong>
              </div>
              <div>
                <span>Data components</span>
                <strong>
                  {snapshot.indicators.length}
                  <small>GDP, core PCE & supporting data</small>
                </strong>
              </div>
              <div>
                <span>Source health</span>
                <strong>
                  {healthy}
                  <small>/ {snapshot.sources.length} responding</small>
                </strong>
              </div>
              <button
                className="coverage-notice"
                onClick={() => setNoticeOpen(!noticeOpen)}
                aria-expanded={noticeOpen}
              >
                <CircleHelp size={16} />
                {snapshot.warnings.length} research notes
                <ChevronDown size={13} />
              </button>
            </div>
            {noticeOpen && (
              <div className="research-notes">
                <strong>Read alongside the map</strong>
                <ul>
                  {snapshot.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                  <li>
                    Coordinates are growth and core-inflation gaps in percentage points. Qualitative
                    views use explicitly inferred rate estimates. Institutional ranges are not
                    statistical confidence intervals.
                  </li>
                </ul>
                <button className="text-button" onClick={() => setTab('methodology')}>
                  See the methodology <ArrowUpRight size={13} />
                </button>
              </div>
            )}
            {tab === 'map' && (
              <>
                <section className="map-panel" aria-label="Quadrant research workspace">
                  <div className="plot-area">
                    <div className="plot-toolbar">
                      <div>
                        <h2>Growth × inflation</h2>
                        <span>Percentage-point gaps to 2% benchmarks</span>
                      </div>
                      <div className="segmented-control" aria-label="Commentary horizon">
                        <button
                          aria-pressed={horizon === 'all'}
                          className={horizon === 'all' ? 'chosen' : ''}
                          onClick={() => setHorizon('all')}
                        >
                          All views
                        </button>
                        <button
                          aria-pressed={horizon === 'current'}
                          className={horizon === 'current' ? 'chosen' : ''}
                          onClick={() => setHorizon('current')}
                        >
                          Current trend
                        </button>
                        <button
                          aria-pressed={horizon === 'outlook'}
                          className={horizon === 'outlook' ? 'chosen' : ''}
                          onClick={() => setHorizon('outlook')}
                        >
                          Outlooks
                        </button>
                      </div>
                    </div>
                    <div className="chart-options">
                      <span>
                        <i className="subtle-dot" />
                        As of {date(snapshot.asOf)}
                      </span>
                      <div>
                        <label>
                          <input
                            type="checkbox"
                            checked={showRanges}
                            onChange={(event) => setShowRanges(event.target.checked)}
                          />
                          Ranges
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={showLabels}
                            onChange={(event) => setShowLabels(event.target.checked)}
                          />
                          Labels
                        </label>
                      </div>
                    </div>
                    <Chart
                      points={visiblePoints}
                      selectedId={selected?.id || ''}
                      onSelect={setSelectedId}
                      showRanges={showRanges}
                      showLabels={showLabels}
                    />
                    <div className="chart-reading-note">
                      <CircleHelp size={14} />
                      <span>
                        {horizon === 'current'
                          ? 'Each dot is an interpreted house view. Its actual horizon and direct versus inferred evidence are shown when selected.'
                          : 'Published views may use different horizons. The data diamond looks back; forecasts look forward. A difference is not a forecast error.'}{' '}
                        <button onClick={() => setTab('methodology')}>How to read this</button>
                      </span>
                    </div>
                  </div>
                  <Inspector
                    point={selected}
                    data={dataPoint}
                    indicators={snapshot.indicators}
                    snapshotDate={snapshot.asOf}
                  />
                </section>
                {dataPoint && snapshot.axisMode === 'levels' && (
                  <section className="research-notes data-narrative">
                    <h2>What the data supports</h2>
                    <p>{dataPoint.summary}</p>
                    {institutionPoints.length > 0 && (
                      <>
                        <h4>House views vs. hard data</h4>
                        <p>
                          The mapped house average is{' '}
                          {number(
                            institutionPoints.reduce((sum, point) => sum + point.x, 0) /
                              institutionPoints.length,
                          )}
                          pp on growth and{' '}
                          {number(
                            institutionPoints.reduce((sum, point) => sum + point.y, 0) /
                              institutionPoints.length,
                          )}
                          pp on inflation. The data anchor is {number(dataPoint.x)}pp /{' '}
                          {number(dataPoint.y)}pp. Forecasting a slowdown does not imply a
                          below-trend economy; inflation can decline while remaining above 2%.
                          Compare the source horizons before reading the gap as disagreement.
                        </p>
                      </>
                    )}
                  </section>
                )}
                <section className="ledger-section">
                  <div className="section-heading">
                    <div>
                      <h2>The institutional view</h2>
                      <p>Select a row to trace the argument. Coverage gaps stay visible.</p>
                    </div>
                    <div className="ledger-actions">
                      <label className="search-field">
                        <Search size={15} />
                        <input
                          aria-label="Search institutions and evidence"
                          placeholder="Find an institution…"
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                        />
                        {query && (
                          <button aria-label="Clear search" onClick={() => setQuery('')}>
                            <X size={13} />
                          </button>
                        )}
                      </label>
                      <button className="export-button" onClick={exportSnapshot}>
                        <Download size={15} />
                        Export
                      </button>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table className="institution-table">
                      <thead>
                        <tr>
                          <th>Institution</th>
                          <th>Growth</th>
                          <th>Inflation</th>
                          <th>Against hard data</th>
                          <th>Horizon</th>
                          <th>Published</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {institutionPoints
                          .filter(
                            (point) =>
                              !query ||
                              point.institution.toLowerCase().includes(query.toLowerCase()),
                          )
                          .map((point) => (
                            <tr
                              key={point.id}
                              className={selected?.id === point.id ? 'selected-row' : ''}
                            >
                              <td>
                                <button
                                  onClick={() => setSelectedId(point.id)}
                                  className="institution-name"
                                >
                                  <span style={{ background: point.color }} />
                                  {point.shortName}
                                </button>
                              </td>
                              <td>
                                <span className={`direction-label ${point.x >= 0 ? 'up' : 'down'}`}>
                                  {point.x >= 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                                  {point.growthDirection === 'unclear'
                                    ? 'Unresolved'
                                    : direction(point.x)}
                                </span>
                              </td>
                              <td>
                                <span
                                  className={`direction-label ${point.y >= 0 ? 'inflation-up' : 'down'}`}
                                >
                                  {point.y >= 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                                  {point.inflationDirection === 'unclear'
                                    ? 'Unresolved'
                                    : direction(point.y)}
                                </span>
                              </td>
                              <td>
                                <span className="agreement-label">
                                  {dataPoint
                                    ? `${axisSupport(point, dataPoint, 'growth') === 'Aligned' && axisSupport(point, dataPoint, 'inflation') === 'Aligned' ? 'Both gaps aligned' : 'Mixed / inconclusive'}`
                                    : 'Data unavailable'}
                                </span>
                              </td>
                              <td>{point.horizonLabel || point.horizon}</td>
                              <td>
                                {date(point.publishedAt, { year: undefined, timeZone: 'UTC' })}
                              </td>
                              <td>
                                <SourceLink href={point.sourceUrl}>Article</SourceLink>
                              </td>
                            </tr>
                          ))}
                        {!institutionPoints.length && (
                          <tr>
                            <td colSpan={7} className="empty-table">
                              No institution currently has comparable, dated evidence on both axes
                              for this horizon. Review the unscored articles below or switch
                              horizons.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
            {tab === 'data' && (
              <section className="data-page">
                <div className="data-explainer">
                  <Layers3 size={21} />
                  <div>
                    <strong>Published anchors and supporting indicators.</strong>
                    <p>
                      The main map uses GDP, GDPNow and core PCE relative to the 2% benchmarks.
                      Labor and CPI momentum provide supporting context. Reference periods differ.{' '}
                      <button className="inline-link" onClick={() => setTab('methodology')}>
                        Inspect the calculation
                      </button>
                    </p>
                  </div>
                </div>
                <div className="indicator-grid">
                  {snapshot.indicators.map((indicator) => (
                    <article key={indicator.id} className="indicator-detail">
                      <div className="indicator-top">
                        <span className={`axis-pill ${indicator.axis}`}>{indicator.axis}</span>
                        <SourceLink href={indicator.sourceUrl}>
                          {indicator.mode === 'level' ? 'Official source' : 'BLS API'}
                        </SourceLink>
                      </div>
                      <h3>{indicator.name}</h3>
                      <div className="indicator-score">
                        <strong>
                          {number(
                            indicator.mode === 'level'
                              ? indicator.value - (indicator.benchmark || 2)
                              : indicator.score,
                          )}
                        </strong>
                        <Sparkline indicator={indicator} />
                      </div>
                      <p className="indicator-period">Reference month {indicator.period}</p>
                      <div className="indicator-values">
                        <div>
                          <span>
                            {indicator.mode === 'level' ? 'Published rate' : 'Latest 3m momentum'}
                          </span>
                          <b>{number(indicator.currentMomentum)}</b>
                        </div>
                        <div>
                          <span>
                            {indicator.mode === 'level' ? 'Benchmark' : 'Previous 3m momentum'}
                          </span>
                          <b>{number(indicator.priorMomentum)}</b>
                        </div>
                        <div>
                          <span>{indicator.mode === 'level' ? 'Gap (pp)' : 'Momentum change'}</span>
                          <b>{number(indicator.acceleration)}</b>
                        </div>
                      </div>
                      <span className="indicator-unit">
                        {indicator.mode === 'level' ? 'Rate unit' : 'Momentum unit'}:{' '}
                        {indicator.unit}
                      </span>
                      <p>{indicator.transform}</p>
                      <small>
                        Raw latest value:{' '}
                        {indicator.value.toLocaleString('en-US', { maximumFractionDigits: 3 })}.
                        Retrieved {date(indicator.retrievedAt)}.
                      </small>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {tab === 'sources' && (
              <section className="sources-panel">
                <div className="section-heading">
                  <div>
                    <h2>Collection health</h2>
                    <p>
                      Successful retrieval does not imply that an article is suitable for the map.
                    </p>
                  </div>
                </div>
                <div className="source-health-list">
                  {snapshot.sources.map((source) => (
                    <article key={source.id}>
                      <span className={`health-dot ${source.status}`} />
                      <div>
                        <h3>
                          {source.name}
                          <span className="source-type">{source.type}</span>
                        </h3>
                        <p>{source.message}</p>
                        <small>
                          Checked {date(source.checkedAt, { hour: 'numeric', minute: '2-digit' })}{' '}
                          ET
                        </small>
                      </div>
                      <SourceLink href={source.url}>Open source</SourceLink>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {(tab === 'map' || tab === 'sources') && (
              <section className="evidence-section">
                <div className="section-heading">
                  <div>
                    <h2>{tab === 'map' ? 'Behind the map' : 'Commentary & official releases'}</h2>
                    <p>What was read, what was plotted, and what did not meet the evidence bar.</p>
                  </div>
                  <label className="filter-select">
                    <ListFilter size={15} />
                    <select
                      aria-label="Filter evidence by status"
                      value={viewFilter}
                      onChange={(event) => setViewFilter(event.target.value)}
                    >
                      <option value="all">All evidence</option>
                      <option value="scored">Scored</option>
                      <option value="unscored">Unscored</option>
                      <option value="stale">Older articles</option>
                      <option value="error">Collection errors</option>
                      <option value="news">Official releases</option>
                    </select>
                    <ChevronDown size={13} />
                  </label>
                </div>
                <div className="evidence-list">
                  {documents.slice(0, 16).map((doc) => (
                    <article key={doc.id}>
                      <div className="evidence-house">
                        <span style={{ background: doc.color }} />
                        <strong>{doc.shortName}</strong>
                        <small>
                          {doc.publishedAt
                            ? date(doc.publishedAt, { year: undefined })
                            : 'Date unverified'}
                        </small>
                      </div>
                      <div className="evidence-content">
                        <SourceLink href={doc.url}>{doc.title}</SourceLink>
                        <p>{doc.reason}</p>
                        {doc.excerpt && <p className="news-excerpt">{doc.excerpt}…</p>}
                      </div>
                      <span className={`document-status ${doc.status}`}>
                        {doc.status === 'news'
                          ? 'Context'
                          : doc.status === 'stale'
                            ? 'Older article'
                            : doc.status === 'error'
                              ? 'Unavailable'
                              : doc.status}
                      </span>
                    </article>
                  ))}
                  {!documents.length && (
                    <p className="empty-evidence">
                      No articles match this filter. Choose another status or clear the institution
                      search.
                    </p>
                  )}
                </div>
              </section>
            )}
            <footer className="research-footer">
              <span>G / I / Q · Sources before conviction.</span>
              <span>
                Collected {date(snapshot.asOf, { hour: 'numeric', minute: '2-digit' })} ET ·{' '}
                {status === 'demo'
                  ? 'Demo data'
                  : status === 'saved'
                    ? 'Saved snapshot'
                    : 'Versioned research snapshot'}
              </span>
              <button onClick={() => setTab('methodology')}>
                Methodology <ArrowUpRight size={12} />
              </button>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
