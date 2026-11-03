// A year of study activity, like the Review Heatmap add-on for Anki: one
// square per day shaded by how many cards you answered, plus streak stats.

import { useMemo, useRef, useState } from 'react';
import { useCollection } from '../lib/collection';
import { dayNumber, dayStartMs, today } from '../lib/time';

const WEEKS = 53;
const CELL = 12;
const GAP = 3;
const DAY_LABELS: [number, string][] = [
  [1, 'Mon'],
  [3, 'Wed'],
  [5, 'Fri'],
];

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

export function ReviewHeatmap() {
  const col = useCollection();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ day: number; x: number; y: number } | null>(null);

  const data = useMemo(() => {
    const t = today();
    const perDay = new Map<number, number>();
    for (const r of col.revlog) {
      if (r.rating === 0) continue;
      const d = dayNumber(r.id);
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    // Grid: columns are weeks (Sunday first), the last column holds today.
    const todayDow = new Date(dayStartMs(t)).getDay();
    const start = t - todayDow - (WEEKS - 1) * 7;

    // Streaks over all history, counting a streak still alive if today
    // hasn't been studied yet.
    const studied = [...perDay.keys()].sort((a, b) => a - b);
    let longest = 0;
    let run = 0;
    let prev: number | null = null;
    for (const d of studied) {
      run = prev !== null && d === prev + 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = d;
    }
    let current = 0;
    for (let d = perDay.has(t) ? t : t - 1; perDay.has(d); d--) current++;

    // Daily average and "days learned" over the shown period, from the first
    // day studied in it (as the add-on does).
    const shownDays = [...perDay.keys()].filter((d) => d >= start && d <= t);
    const first = shownDays.length ? Math.min(...shownDays) : t;
    const span = t - first + 1;
    const total = shownDays.reduce((n, d) => n + perDay.get(d)!, 0);

    // Shade levels from quartiles of the busy days shown, so the scale adapts.
    const counts = shownDays.map((d) => perDay.get(d)!).sort((a, b) => a - b);
    const q = (p: number) => counts[Math.min(counts.length - 1, Math.floor(p * counts.length))] ?? 0;
    const thresholds = [q(0.25), q(0.5), q(0.75)];
    const level = (n: number) => (n === 0 ? 0 : n <= thresholds[0] ? 1 : n <= thresholds[1] ? 2 : n <= thresholds[2] ? 3 : 4);

    return {
      t,
      start,
      perDay,
      level,
      thresholds,
      stats: {
        average: shownDays.length ? Math.round(total / span) : 0,
        daysLearnedPct: shownDays.length ? Math.round((shownDays.length / span) * 100) : 0,
        longest,
        current,
        total,
        daysStudied: shownDays.length,
      },
    };
  }, [col, col.version]);

  const { t, start, perDay, level, stats } = data;
  const width = WEEKS * (CELL + GAP) + 28;
  const height = 7 * (CELL + GAP) + 18;
  const dateLabel = (d: number) =>
    new Date(dayStartMs(d)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  // Month labels at the first week that contains the 1st of a month.
  const months: { x: number; label: string }[] = [];
  for (let w = 0; w < WEEKS; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const d = start + w * 7 + dow;
      const date = new Date(dayStartMs(d));
      if (date.getDate() === 1 && d <= t) {
        months.push({ x: 28 + w * (CELL + GAP), label: date.toLocaleDateString(undefined, { month: 'short' }) });
      }
    }
  }

  const summary = `${plural(stats.daysStudied, 'day')} studied in the past year, ${plural(stats.total, 'answer')} in total. Current streak ${plural(stats.current, 'day')}, longest ${plural(stats.longest, 'day')}.`;

  return (
    <div className="panel heatmap-panel" style={{ marginTop: 16 }}>
      <div className="heatmap-stats">
        <div>
          <span className="value num">{stats.average.toLocaleString()}</span>
          <span className="label">Daily average</span>
        </div>
        <div>
          <span className="value num">{stats.daysLearnedPct}%</span>
          <span className="label">Days learned</span>
        </div>
        <div>
          <span className="value num">{plural(stats.longest, 'day')}</span>
          <span className="label">Longest streak</span>
        </div>
        <div>
          <span className={`value num ${stats.current ? 'streak-live' : ''}`}>{plural(stats.current, 'day')}</span>
          <span className="label">Current streak</span>
        </div>
      </div>
      <div className="heatmap-scroll" ref={wrapRef}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={summary}
          className="heatmap"
          onMouseLeave={() => setHover(null)}
        >
          {months.map((m) => (
            <text key={m.x} x={m.x} y={10} className="heatmap-axis">
              {m.label}
            </text>
          ))}
          {DAY_LABELS.map(([dow, label]) => (
            <text key={dow} x={0} y={18 + dow * (CELL + GAP) + CELL - 2} className="heatmap-axis">
              {label}
            </text>
          ))}
          {Array.from({ length: WEEKS * 7 }, (_, i) => {
            const d = start + i;
            if (d > t) return null;
            const w = Math.floor(i / 7);
            const dow = i % 7;
            const n = perDay.get(d) ?? 0;
            const x = 28 + w * (CELL + GAP);
            const y = 18 + dow * (CELL + GAP);
            return (
              <rect
                key={d}
                x={x}
                y={y}
                width={CELL}
                height={CELL}
                rx={2.5}
                className={`heat-${level(n)} ${d === t ? 'heat-today' : ''}`}
                onMouseEnter={() => setHover({ day: d, x: x + CELL / 2, y })}
              />
            );
          })}
        </svg>
        {hover && (
          <div className="tooltip num" style={{ left: hover.x, top: hover.y }}>
            {plural(perDay.get(hover.day) ?? 0, 'card')} · {dateLabel(hover.day)}
          </div>
        )}
      </div>
      <div className="heatmap-legend" aria-hidden="true">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <svg key={l} width={CELL} height={CELL}>
            <rect width={CELL} height={CELL} rx={2.5} className={`heat-${l}`} />
          </svg>
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
