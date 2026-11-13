import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Point } from '../shared/schema';

const WIDTH = 850,
  HEIGHT = 530;
const M = { top: 27, right: 30, bottom: 65, left: 56 };
const PW = WIDTH - M.left - M.right,
  PH = HEIGHT - M.top - M.bottom;
const LIMIT = 2.5;
const sx = (value: number) => M.left + ((value + LIMIT) / (LIMIT * 2)) * PW;
const sy = (value: number) => M.top + ((LIMIT - value) / (LIMIT * 2)) * PH;
const zeroX = sx(0),
  zeroY = sy(0);

function Labels({
  points,
  selectedId,
  scale,
}: {
  points: Point[];
  selectedId: string;
  scale: number;
}) {
  const labels = useMemo(() => {
    const occupied: { x: number; y: number; width: number }[] = [];
    return [...points]
      .sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId))
      .map((point) => {
        const width = Math.min(270, (point.shortName.length * 7.7 + 18) * scale);
        let x = sx(point.x) + 14 * scale,
          y = sy(point.y) - 14 * scale;
        if (x + width > WIDTH - M.right) x = sx(point.x) - width - 12 * scale;
        let attempt = 0;
        while (
          occupied.some(
            (other) =>
              Math.abs(other.y - y) < 23 * scale &&
              x < other.x + other.width + 6 &&
              x + width + 6 > other.x,
          ) &&
          attempt < 16
        ) {
          attempt++;
          y =
            sy(point.y) - 14 * scale + (attempt % 2 ? 1 : -1) * Math.ceil(attempt / 2) * 25 * scale;
        }
        y = Math.max(M.top + 19 * scale, Math.min(HEIGHT - M.bottom - 8 * scale, y));
        occupied.push({ x, y, width });
        return { point, x, y, width };
      });
  }, [points, selectedId, scale]);
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
}: {
  points: Point[];
  selectedId: string;
  onSelect: (id: string) => void;
  showRanges: boolean;
  showLabels: boolean;
}) {
  const clip = useId().replace(/:/g, '');
  const container = useRef<HTMLDivElement>(null);
  const [labelScale, setLabelScale] = useState(1);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setLabelScale(Math.max(1, Math.min(2, 650 / Math.max(1, entry.contentRect.width))));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const selected = points.find((point) => point.id === selectedId);
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
        </defs>
        <g clipPath={`url(#${clip})`}>
          <rect x={M.left} y={M.top} width={PW / 2} height={PH / 2} fill="#faf1e7" />
          <rect x={zeroX} y={M.top} width={PW / 2} height={PH / 2} fill="#eaf5f1" />
          <rect x={M.left} y={zeroY} width={PW / 2} height={PH / 2} fill="#f1edf7" />
          <rect x={zeroX} y={zeroY} width={PW / 2} height={PH / 2} fill="#edf2fc" />
          {[-2, -1, 1, 2].map((tick) => (
            <g key={tick} className="chart-grid">
              <line x1={sx(tick)} x2={sx(tick)} y1={M.top} y2={M.top + PH} />
              <line y1={sy(tick)} y2={sy(tick)} x1={M.left} x2={M.left + PW} />
            </g>
          ))}
          <line x1={zeroX} x2={zeroX} y1={M.top} y2={M.top + PH} className="zero-axis" />
          <line y1={zeroY} y2={zeroY} x1={M.left} x2={M.left + PW} className="zero-axis" />
          <g className="quadrant-name" aria-hidden="true" style={{ fontSize: 11 * labelScale }}>
            <text x={M.left + 17} y={M.top + 27} fill="#a17446">
              Stagflation
            </text>
            <text x={WIDTH - M.right - 17} y={M.top + 27} textAnchor="end" fill="#438578">
              Overheating
            </text>
            <text x={M.left + 17} y={HEIGHT - M.bottom - 17} fill="#8a79a1">
              Slowdown
            </text>
            <text
              x={WIDTH - M.right - 17}
              y={HEIGHT - M.bottom - 17}
              textAnchor="end"
              fill="#6481bd"
            >
              Goldilocks
            </text>
          </g>
          {showRanges &&
            points.map((point) => {
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
          {points.map((point) => (
            <g
              key={point.id}
              role="button"
              tabIndex={0}
              className={`scatter-point ${selectedId === point.id ? 'selected-point' : ''}`}
              aria-label={`${point.institution}, ${point.horizonLabel || point.horizon}, growth ${point.growthDirection === 'unclear' ? 'unresolved' : point.x.toFixed(2)}, inflation ${point.inflationDirection === 'unclear' ? 'unresolved' : point.y.toFixed(2)}. Select to inspect evidence.`}
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
                  fill={point.color}
                  stroke="white"
                  strokeWidth="2"
                />
              )}
            </g>
          ))}
          {showLabels && <Labels points={points} selectedId={selectedId} scale={labelScale} />}
        </g>
        <g className="tick-labels" aria-hidden="true">
          {[-2, -1, 0, 1, 2].map((tick) => (
            <g key={tick}>
              <text x={sx(tick)} y={HEIGHT - M.bottom + 20} textAnchor="middle">
                {tick > 0 ? '+' : ''}
                {tick.toFixed(1)}
              </text>
              <text x={M.left - 12} y={sy(tick) + 4} textAnchor="end">
                {tick > 0 ? '+' : ''}
                {tick.toFixed(1)}
              </text>
            </g>
          ))}
        </g>
        <text x={M.left} y={HEIGHT - 9} className="axis-description">
          Below-trend growth
        </text>
        <text x={WIDTH - M.right} y={HEIGHT - 9} textAnchor="end" className="axis-description">
          Above-trend growth
        </text>
        <text
          x="13"
          y={M.top + PH / 2}
          textAnchor="middle"
          transform={`rotate(-90 13 ${M.top + PH / 2})`}
          className="axis-description"
        >
          Core inflation vs 2% target (pp)
        </text>
        <text x={zeroX} y={HEIGHT - 9} textAnchor="middle" className="axis-title">
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
        <span className="diamond-icon" /> Hard data <span className="circle-icon" /> Institutional
        interpretation <span className="range-icon" />{' '}
        {selected?.kind === 'institution'
          ? 'Selected view’s model range'
          : 'Data / model sensitivity range'}
      </div>
    </div>
  );
}
