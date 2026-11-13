import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Point } from '../shared/schema';
import { fitAxis } from './chartScale';
import { reportedAlternatives, constrainedRange } from '../shared/quadrants';
import { arrowSegment, outlookPath } from '../shared/outlookPaths';

const WIDTH = 850;
type Layout = {
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
};

function Labels({
  points,
  selectedId,
  scale,
  sx,
  sy,
  layout,
}: {
  points: Point[];
  selectedId: string;
  scale: number;
  sx: (value: number) => number;
  sy: (value: number) => number;
  layout: Layout;
}) {
  const { height: HEIGHT, margin: M } = layout;
  const labels = useMemo(() => {
    const occupied: { x: number; y: number; width: number }[] = [];
    return [...points]
      .sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId))
      .map((point) => {
        const width = Math.min(310, (point.shortName.length * 7.7 + 18) * scale);
        const path = outlookPath(point);
        const left = sx(point.x) - width - 12 * scale;
        const right = sx(point.x) + 14 * scale;
        // Keep the name away from the incoming outlook arrowhead.
        const arrowOnRight =
          path &&
          (Math.abs(point.x - path.from.x) < 1e-6 && Math.abs(point.y - path.from.y) < 1e-6
            ? path.dx > 0
            : path.dx < 0);
        const columns = (arrowOnRight ? [left, right] : [right, left]).map((x) =>
          Math.max(M.left + 6, Math.min(WIDTH - M.right - width - 6, x)),
        );
        let x = columns[0],
          y = sy(point.y) - 14 * scale;
        search: for (let attempt = 0; attempt < 24; attempt++) {
          const offset = (attempt % 2 ? 1 : -1) * Math.ceil(attempt / 2) * 27 * scale;
          const candidateY = Math.max(
            M.top + 21 * scale,
            Math.min(HEIGHT - M.bottom - 10 * scale, sy(point.y) - 14 * scale + offset),
          );
          for (const candidateX of columns) {
            if (
              !occupied.some(
                (other) =>
                  Math.abs(other.y - candidateY) < 25 * scale &&
                  candidateX < other.x + other.width + 8 &&
                  candidateX + width + 8 > other.x,
              )
            ) {
              x = candidateX;
              y = candidateY;
              break search;
            }
          }
        }
        y = Math.max(M.top + 21 * scale, Math.min(HEIGHT - M.bottom - 10 * scale, y));
        occupied.push({ x, y, width });
        return { point, x, y, width };
      });
  }, [points, selectedId, scale, sx, sy, layout]);
  return (
    <g aria-hidden="true">
      {labels.map(({ point, x, y, width }) => (
        <g key={point.id} className="point-label">
          <line
            x1={sx(point.x)}
            y1={sy(point.y)}
            x2={x + (x > sx(point.x) ? 0 : width)}
            y2={y - 4}
            stroke={point.color}
            strokeOpacity=".45"
          />
          <rect
            x={x - 3}
            y={y - 17 * scale}
            width={width}
            height={23 * scale}
            rx="4"
            fill={point.id === selectedId ? '#16314b' : '#ffffff'}
            fillOpacity={point.id === selectedId ? 1 : 0.95}
          />
          <text
            x={x + 5}
            y={y - 1}
            fill={point.id === selectedId ? '#fff' : '#455e76'}
            fontWeight={point.id === selectedId ? 750 : 650}
            style={{ fontSize: 12 * scale }}
          >
            {point.shortName}
          </text>
        </g>
      ))}
    </g>
  );
}

export default function Chart({
  points,
  selectedId,
  onSelect,
  showRanges,
  showLabels,
  rangeMode = 'all',
  showOutlooks = true,
  outlookMode = 'focused',
}: {
  points: Point[];
  selectedId: string;
  onSelect: (id: string) => void;
  showRanges: boolean;
  showLabels: boolean;
  rangeMode?: 'all' | 'selected';
  showOutlooks?: boolean;
  outlookMode?: 'focused' | 'all';
}) {
  const clip = useId().replace(/:/g, '');
  const container = useRef<HTMLDivElement>(null);
  const [labelScale, setLabelScale] = useState(1);
  const layout = useMemo<Layout>(
    () => ({
      height: 480 + (labelScale - 1) * 150,
      margin: {
        top: 27 + (labelScale - 1) * 8,
        right: 30,
        bottom: 65 + (labelScale - 1) * 20,
        left: 56 + (labelScale - 1) * 36,
      },
    }),
    [labelScale],
  );
  const { height: HEIGHT, margin: M } = layout;
  const PW = WIDTH - M.left - M.right,
    PH = HEIGHT - M.top - M.bottom;
  const { xAxis, yAxis, sx, sy } = useMemo(() => {
    // Fit the visible clipped ranges as well as published guidance endpoints.
    const extents = points.map((p) => ({
      point: p,
      path: outlookPath(p),
      range: p.kind === 'data' ? p : constrainedRange(p),
    }));
    const xAxis = fitAxis(
      extents.flatMap(({ point: p, path, range }) => [
        p.x,
        range.xRange.low,
        range.xRange.high,
        ...(path ? [path.from.x, path.to.x] : []),
      ]),
    );
    const yAxis = fitAxis(
      extents.flatMap(({ point: p, path, range }) => [
        p.y,
        range.yRange.low,
        range.yRange.high,
        ...(path ? [path.from.y, path.to.y] : []),
      ]),
    );
    return {
      xAxis,
      yAxis,
      sx: (value: number) => M.left + ((value - xAxis.min) / (xAxis.max - xAxis.min)) * PW,
      sy: (value: number) => M.top + ((yAxis.max - value) / (yAxis.max - yAxis.min)) * PH,
    };
  }, [points, layout]);
  const zeroX = sx(0),
    zeroY = sy(0);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setLabelScale(Math.max(1, Math.min(2.5, 760 / Math.max(1, entry.contentRect.width))));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const selected = points.find((point) => point.id === selectedId);
  const rangePoints = points.filter((p) => rangeMode === 'all' || p.id === selectedId);
  const hasHouseRange = rangePoints.some(
    (p) => p.kind === 'institution' && constrainedRange(p).slices.length > 0,
  );
  const rangeClip = (point: Point) => `${clip}-range-${points.indexOf(point)}`;
  const hasDataRange = rangePoints.some((p) => p.kind === 'data');
  const paths = showOutlooks
    ? points.flatMap((point) => {
        if (
          outlookMode === 'focused' &&
          selected?.kind === 'institution' &&
          point.id !== selectedId
        )
          return [];
        const path = outlookPath(point);
        return path ? [path] : [];
      })
    : [];
  return (
    <div
      className="chart-wrap"
      ref={container}
      style={{ '--chart-label-scale': labelScale } as React.CSSProperties}
    >
      <svg
        className="quadrant-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="group"
        aria-label="Growth and inflation quadrant scatter plot. Right means growth above the 2% trend benchmark; up means core inflation above the 2% target."
      >
        <defs>
          <clipPath id={clip}>
            <rect x={M.left} y={M.top} width={PW} height={PH} rx="6" />
          </clipPath>
          {points
            .filter((p) => p.kind === 'institution')
            .map((point) => (
              <clipPath key={point.id} id={rangeClip(point)}>
                {constrainedRange(point).slices.map((slice) => (
                  <rect
                    key={slice.quadrant}
                    data-range-quadrant={slice.quadrant}
                    x={sx(slice.xRange.low)}
                    y={sy(slice.yRange.high)}
                    width={sx(slice.xRange.high) - sx(slice.xRange.low)}
                    height={sy(slice.yRange.low) - sy(slice.yRange.high)}
                  />
                ))}
              </clipPath>
            ))}
        </defs>
        <g clipPath={`url(#${clip})`}>
          <rect x={M.left} y={M.top} width={zeroX - M.left} height={zeroY - M.top} fill="#faf1e7" />
          <rect
            x={zeroX}
            y={M.top}
            width={M.left + PW - zeroX}
            height={zeroY - M.top}
            fill="#eaf5f1"
          />
          <rect
            x={M.left}
            y={zeroY}
            width={zeroX - M.left}
            height={M.top + PH - zeroY}
            fill="#f1edf7"
          />
          <rect
            x={zeroX}
            y={zeroY}
            width={M.left + PW - zeroX}
            height={M.top + PH - zeroY}
            fill="#edf2fc"
          />
          <g className="chart-grid">
            {xAxis.ticks
              .filter((tick) => tick !== 0)
              .map((tick) => (
                <line key={`x-${tick}`} x1={sx(tick)} x2={sx(tick)} y1={M.top} y2={M.top + PH} />
              ))}
            {yAxis.ticks
              .filter((tick) => tick !== 0)
              .map((tick) => (
                <line key={`y-${tick}`} y1={sy(tick)} y2={sy(tick)} x1={M.left} x2={M.left + PW} />
              ))}
          </g>
          <line x1={zeroX} x2={zeroX} y1={M.top} y2={M.top + PH} className="zero-axis" />
          <line y1={zeroY} y2={zeroY} x1={M.left} x2={M.left + PW} className="zero-axis" />
          <g className="quadrant-name" aria-hidden="true" style={{ fontSize: 11 * labelScale }}>
            <text x={M.left + 17} y={M.top + 27} fill="#7b5731">
              Stagflation
            </text>
            <text x={WIDTH - M.right - 17} y={M.top + 27} textAnchor="end" fill="#376b5e">
              Overheating
            </text>
            <text x={M.left + 17} y={HEIGHT - M.bottom - 17} fill="#77618d">
              Slowdown
            </text>
            <text
              x={WIDTH - M.right - 17}
              y={HEIGHT - M.bottom - 17}
              textAnchor="end"
              fill="#466188"
            >
              Goldilocks
            </text>
          </g>
          {showRanges &&
            rangePoints
              .filter((p) => p.kind === 'institution')
              .map((point) => {
                const range = constrainedRange(point);
                if (!range.slices.length) return null;
                return (
                  <g
                    key={`house-range-${point.id}`}
                    className="interpretation-range"
                    data-point-id={point.id}
                    data-covered-quadrants={range.slices.map((s) => s.quadrant).join('|')}
                    clipPath={`url(#${rangeClip(point)})`}
                    pointerEvents="none"
                  >
                    <ellipse
                      data-range-kind="interpretation"
                      cx={sx(point.x)}
                      cy={sy(point.y)}
                      rx={Math.abs(sx(point.x + range.estimate.growthRadius) - sx(point.x))}
                      ry={Math.abs(sy(point.y + range.estimate.inflationRadius) - sy(point.y))}
                      fill={point.color}
                      fillOpacity={point.id === selectedId ? '.09' : '.025'}
                      stroke={point.color}
                      strokeDasharray="5 5"
                      strokeOpacity={point.id === selectedId ? '.65' : '.22'}
                    >
                      <title>
                        {point.shortName}: interpreted range, restricted to{' '}
                        {range.slices.map((s) => s.quadrant).join(', ')}. Not a statistical
                        confidence interval.
                      </title>
                    </ellipse>
                  </g>
                );
              })}
          {showRanges &&
            points
              .filter(
                (point) =>
                  point.kind === 'data' && (rangeMode === 'all' || point.id === selectedId),
              )
              .map((point) => {
                const x1 = sx(point.xRange.low),
                  x2 = sx(point.xRange.high),
                  y1 = sy(point.yRange.high),
                  y2 = sy(point.yRange.low);
                return (
                  <g
                    key={`range-${point.id}`}
                    className="uncertainty-range"
                    aria-hidden="true"
                    opacity={point.kind === 'data' || point.id === selectedId ? 1 : 0.24}
                  >
                    {point.rangeKind === 'model_range' && (
                      <ellipse
                        data-range-kind="data"
                        cx={(x1 + x2) / 2}
                        cy={(y1 + y2) / 2}
                        rx={(x2 - x1) / 2}
                        ry={(y2 - y1) / 2}
                        fill={point.color}
                        fillOpacity=".07"
                        stroke={point.color}
                        strokeDasharray="5 5"
                        strokeOpacity=".6"
                      />
                    )}
                    <path
                      d={`M${x1},${sy(point.y)}H${x2} M${x1},${sy(point.y) - 5}v10 M${x2},${sy(point.y) - 5}v10 M${sx(point.x)},${y1}V${y2} M${sx(point.x) - 5},${y1}h10 M${sx(point.x) - 5},${y2}h10`}
                      fill="none"
                      stroke={point.color}
                      strokeWidth="1.6"
                      opacity=".65"
                    />
                  </g>
                );
              })}
          {paths.map(({ point, from, to, dx, dy }) => {
            const arrowScale = Math.min(1.8, Math.sqrt(labelScale));
            const line = arrowSegment(
              { x: sx(from.x), y: sy(from.y) },
              { x: sx(to.x), y: sy(to.y) },
              10 * arrowScale,
            );
            if (!line) return null;
            const active = point.id === selectedId;
            const head = (active ? 9 : 8) * arrowScale;
            const headPath = `M${line.x2 - line.ux * head - line.uy * head * 0.55},${line.y2 - line.uy * head + line.ux * head * 0.55}L${line.x2},${line.y2}L${line.x2 - line.ux * head + line.uy * head * 0.55},${line.y2 - line.uy * head - line.ux * head * 0.55}`;
            const description = `${point.shortName} published forward guidance: ${from.period} → ${to.period}. Real GDP ${from.growthRate}% → ${to.growthRate}%; core PCE ${from.coreInflationRate}% → ${to.coreInflationRate}%. Both endpoints come from this report. Growth change ${dx.toFixed(2)} pp; inflation change ${dy.toFixed(2)} pp.`;
            const extra =
              Math.abs(point.x - from.x) < 1e-6 && Math.abs(point.y - from.y) < 1e-6 ? to : from;
            return (
              <g
                key={`outlook-${point.id}`}
                className="outlook-path"
                data-point-id={point.id}
                data-from-x={from.x}
                data-from-y={from.y}
                data-to-x={to.x}
                data-to-y={to.y}
                role="button"
                tabIndex={0}
                aria-label={description}
                onClick={() => onSelect(point.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(point.id);
                  }
                }}
                opacity={selected?.kind === 'institution' && !active ? 0.3 : 1}
              >
                <title>{description}</title>
                <rect
                  className="guidance-endpoint"
                  x={sx(extra.x) - 4}
                  y={sy(extra.y) - 4}
                  width="8"
                  height="8"
                  rx="1"
                  fill="white"
                  stroke={point.color}
                  strokeWidth="1.5"
                >
                  <title>
                    {point.shortName}: {extra.period}, GDP {extra.growthRate}%, core PCE{' '}
                    {extra.coreInflationRate}%
                  </title>
                </rect>
                <path
                  d={`M${line.x1},${line.y1}L${line.x2},${line.y2}`}
                  stroke="transparent"
                  strokeWidth="14"
                  fill="none"
                />
                <path
                  d={`M${line.x1},${line.y1}L${line.x2},${line.y2}`}
                  stroke="white"
                  strokeWidth={active ? 5 : 4}
                  strokeOpacity=".85"
                  fill="none"
                />
                <path
                  className="outlook-shaft"
                  d={`M${line.x1},${line.y1}L${line.x2},${line.y2}`}
                  stroke={point.color}
                  strokeWidth={(active ? 2.5 : 1.8) * arrowScale}
                  fill="none"
                />
                <path
                  className="outlook-arrowhead"
                  d={headPath}
                  stroke={point.color}
                  strokeWidth={(active ? 2.5 : 1.8) * arrowScale}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill="none"
                />
              </g>
            );
          })}
          {points.map((point) => (
            <g
              key={point.id}
              role="button"
              tabIndex={0}
              className={`scatter-point ${selectedId === point.id ? 'selected-point' : ''}`}
              aria-label={`${point.institution}, ${point.horizonLabel || point.horizon}, growth ${point.growthDirection === 'unclear' ? 'unresolved' : point.x.toFixed(2)}, inflation ${point.inflationDirection === 'unclear' ? 'unresolved' : point.y.toFixed(2)}. ${reportedAlternatives(point).length ? 'Report explicitly discusses an alternative quadrant. ' : ''}${outlookPath(point) ? 'Published forward guidance from this institution. ' : ''}${selectedId === point.id ? 'Deselect to show all ranges.' : 'Select to inspect evidence.'}`}
              aria-pressed={selectedId === point.id}
              onClick={() => onSelect(point.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(point.id);
                }
              }}
            >
              <title>
                {point.institution}: growth {point.x.toFixed(2)}, inflation {point.y.toFixed(2)}
              </title>
              <circle cx={sx(point.x)} cy={sy(point.y)} r="16" fill="transparent" />
              {selectedId === point.id && (
                <circle
                  cx={sx(point.x)}
                  cy={sy(point.y)}
                  r="13"
                  fill={point.color}
                  fillOpacity=".1"
                  stroke={point.color}
                  strokeOpacity=".25"
                />
              )}
              {point.kind === 'data' ? (
                <path
                  d={`M${sx(point.x)},${sy(point.y) - 8}l8,8 -8,8 -8,-8Z`}
                  fill={
                    point.growthDirection === 'unclear' || point.inflationDirection === 'unclear'
                      ? 'white'
                      : point.color
                  }
                  stroke={
                    point.growthDirection === 'unclear' || point.inflationDirection === 'unclear'
                      ? point.color
                      : 'white'
                  }
                  strokeWidth="2"
                />
              ) : (
                <circle
                  cx={sx(point.x)}
                  cy={sy(point.y)}
                  r="6.5"
                  fill={reportedAlternatives(point).length ? 'white' : point.color}
                  stroke={reportedAlternatives(point).length ? point.color : 'white'}
                  strokeWidth="2"
                />
              )}
            </g>
          ))}
          <Labels
            points={showLabels ? points : points.filter((point) => point.id === selectedId)}
            selectedId={selectedId}
            scale={labelScale}
            sx={sx}
            sy={sy}
            layout={layout}
          />
        </g>
        <g className="tick-labels" aria-hidden="true">
          {xAxis.ticks.map((tick) => (
            <text key={`x-${tick}`} x={sx(tick)} y={HEIGHT - M.bottom + 20} textAnchor="middle">
              {tick > 0 ? '+' : ''}
              {tick.toFixed(1)}
            </text>
          ))}
          {yAxis.ticks.map((tick) => (
            <text key={`y-${tick}`} x={M.left - 12} y={sy(tick) + 4} textAnchor="end">
              {tick > 0 ? '+' : ''}
              {tick.toFixed(1)}
            </text>
          ))}
        </g>
        <text
          x={13 + (labelScale - 1) * 9}
          y={M.top + PH / 2}
          textAnchor="middle"
          transform={`rotate(-90 ${13 + (labelScale - 1) * 9} ${M.top + PH / 2})`}
          className="axis-description"
        >
          Core inflation vs 2% target (pp)
        </text>
        <text x={M.left + PW / 2} y={HEIGHT - 9} textAnchor="middle" className="axis-title">
          Growth vs 2% trend (pp)
        </text>
      </svg>
      {!points.length && (
        <div className="chart-empty">
          <strong>No comparable views in this filter</strong>
          <span>Try another horizon or inspect unscored articles below.</span>
        </div>
      )}
      <div className="chart-footnote">
        <span>
          <i className="diamond-icon" /> Data & nowcast
        </span>
        <span>
          <i className="circle-icon" /> House view
        </span>
        {paths.length > 0 && (
          <span>
            <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
              <path d="M1 10L12 1M6 1h6v6" fill="none" stroke="currentColor" strokeWidth="1.4" />
            </svg>{' '}
            House’s published forward guidance
          </span>
        )}
        {showRanges && hasDataRange && (
          <span>
            <i className="range-icon" />
            Data sensitivity range
          </span>
        )}
        {showRanges && hasHouseRange && (
          <span>
            <i className="range-icon" /> Interpreted range · quadrant constrained
          </span>
        )}
      </div>
    </div>
  );
}
