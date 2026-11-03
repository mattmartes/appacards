import { useState } from 'react';

export interface Bar {
  label: string;
  value: number;
  tooltip: string;
}

/** Single-series bar chart: rounded data-ends, 2px gaps, recessive grid,
 * per-bar hover tooltip with hit targets taller than the bars. */
export function BarChart({ bars, height = 180, ariaLabel }: { bars: Bar[]; height?: number; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const padL = 36;
  const padB = 22;
  const plotH = height - padB - 8;
  const max = Math.max(1, ...bars.map((b) => b.value));
  // At least 2 so the midpoint tick is a whole number.
  const niceMax = Math.max(2, niceCeil(max));
  const step = (width - padL) / Math.max(bars.length, 1);
  const barW = Math.max(2, step - 2);
  const ticks = [0, niceMax / 2, niceMax];
  const labelEvery = Math.ceil(bars.length / 10);

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => {
          const y = 8 + plotH - (t / niceMax) * plotH;
          return (
            <g key={t}>
              <line className="grid" x1={padL} x2={width} y1={y} y2={y} />
              <text className="axis" x={padL - 6} y={y + 4} textAnchor="end">
                {Math.round(t)}
              </text>
            </g>
          );
        })}
        {bars.map((b, i) => {
          const h = (b.value / niceMax) * plotH;
          const x = padL + i * step + 1;
          const y = 8 + plotH - h;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x - 1} y={8} width={step} height={plotH} fill="transparent" />
              {b.value > 0 && <path className={`bar ${hover === i ? 'hover' : ''}`} d={roundedTop(x, y, barW, h, Math.min(4, barW / 2, h))} />}
              {i % labelEvery === 0 && (
                <text className="axis" x={x + barW / 2} y={height - 6} textAnchor="middle">
                  {b.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="tooltip num"
          style={{
            left: `${((padL + hover * step + step / 2) / width) * 100}%`,
            top: `${((8 + plotH - (bars[hover].value / niceMax) * plotH) / height) * 100}%`,
          }}
        >
          {bars[hover].tooltip}
        </div>
      )}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function niceCeil(v: number) {
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}
