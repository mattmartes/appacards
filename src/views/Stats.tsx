import { useMemo, useState } from 'react';
import { useCollection } from '../lib/collection';
import { dayNumber, formatDuration, today } from '../lib/time';
import type { Id } from '../lib/types';
import { BarChart, type Bar } from './BarChart';

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="panel stat-tile">
      <div className="value num">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

export function Stats() {
  const col = useCollection();
  /** null = whole collection, like Anki's "Collection" toggle */
  const [deckId, setDeckId] = useState<Id | null>(null);

  const data = useMemo(() => {
    const t = today();
    const cards = deckId === null ? [...col.cards.values()] : col.subtreeCards(deckId);
    const cardIds = new Set(cards.map((c) => c.id));
    const revlog = col.revlog.filter((r) => cardIds.has(r.cardId));
    const answers = revlog.filter((r) => r.rating > 0);
    const todays = answers.filter((r) => dayNumber(r.id) === t);
    const month = revlog.filter((r) => dayNumber(r.id) > t - 30 && r.kind === 1);
    const passed = month.filter((r) => r.rating > 1).length;

    const reviewed = cards.filter((c) => c.type !== 0 && c.stability !== null && c.queue !== -1);
    const rs = reviewed.map((c) => col.retrievability(c) ?? 0);
    const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;

    const forecast: Bar[] = Array.from({ length: 31 }, (_, i) => {
      const day = t + i;
      const n = cards.filter(
        (c) => (c.queue === 2 || c.queue === 3) && (i === 0 ? c.due <= day : c.due === day),
      ).length;
      const label = i === 0 ? 'Today' : `+${i}d`;
      return { label, value: n, tooltip: `${label}: ${n} review${n === 1 ? '' : 's'} due` };
    });

    const history: Bar[] = Array.from({ length: 30 }, (_, i) => {
      const day = t - 29 + i;
      const n = answers.filter((r) => dayNumber(r.id) === day).length;
      const label = i === 29 ? 'Today' : `${i - 29}d`;
      return { label, value: n, tooltip: `${label}: ${n} answer${n === 1 ? '' : 's'}` };
    });

    const rBuckets: Bar[] = Array.from({ length: 10 }, (_, i) => {
      const lo = 0.5 + i * 0.05;
      const hi = lo + 0.05;
      const n = rs.filter((r) => (i === 0 ? r < hi : i === 9 ? r >= lo : r >= lo && r < hi)).length;
      const label = i === 0 ? '<55%' : `${Math.round(lo * 100)}%`;
      return { label, value: n, tooltip: `R ${i === 0 ? '<55' : `${Math.round(lo * 100)}–${Math.round(hi * 100)}`}%: ${n} card${n === 1 ? '' : 's'}` };
    });

    const dBuckets: Bar[] = Array.from({ length: 10 }, (_, i) => {
      const n = reviewed.filter((c) => Math.min(9, Math.floor((((c.difficulty ?? 1) - 1) / 9) * 10)) === i).length;
      const label = `${i * 10}%`;
      return { label, value: n, tooltip: `Difficulty ${i * 10}–${i * 10 + 10}%: ${n} card${n === 1 ? '' : 's'}` };
    });

    return {
      todayCount: todays.length,
      todayMs: todays.reduce((a, r) => a + r.time, 0),
      trueRetention: month.length ? passed / month.length : null,
      monthCount: month.length,
      avgR,
      counts: {
        new: cards.filter((c) => c.type === 0 && c.queue !== -1).length,
        learning: cards.filter((c) => (c.type === 1 || c.type === 3) && c.queue !== -1).length,
        review: cards.filter((c) => c.type === 2 && c.queue !== -1).length,
        suspended: cards.filter((c) => c.queue === -1).length,
      },
      forecast,
      history,
      rBuckets,
      dBuckets,
    };
  }, [col, col.version, deckId]);

  const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
  const scopeDeck = deckId === null ? null : col.decks.get(deckId);

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Statistics</h1>
        <span className="spacer" />
        <label className="row" style={{ gap: 6 }}>
          <span className="muted">Scope</span>
          <select
            value={deckId ?? ''}
            onChange={(e) => setDeckId(e.target.value ? Number(e.target.value) : null)}
            style={{ width: 'auto' }}
          >
            <option value="">Whole collection</option>
            {col.deckList().map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="stat-tiles">
        <Tile value={String(data.todayCount)} label={`Answers today · ${formatDuration(data.todayMs)}`} />
        <Tile value={pct(data.trueRetention)} label={`True retention, 30 days (${data.monthCount} reviews)`} />
        <Tile value={pct(data.avgR)} label="Average retrievability now" />
        {scopeDeck && (
          <Tile
            value={`${Math.round((scopeDeck.desiredRetention ?? col.presetFor(scopeDeck).desiredRetention) * 100)}%`}
            label={`Desired retention (${col.presetFor(scopeDeck).name})`}
          />
        )}
      </div>
      <div className="stat-tiles">
        <Tile value={String(data.counts.new)} label="New cards" />
        <Tile value={String(data.counts.learning)} label="Learning" />
        <Tile value={String(data.counts.review)} label="Review" />
        <Tile value={String(data.counts.suspended)} label="Suspended" />
      </div>
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="panel">
          <h2>Review forecast — next 30 days</h2>
          <BarChart bars={data.forecast} ariaLabel="Reviews due per day for the next 30 days" />
        </div>
        <div className="panel">
          <h2>Answers — last 30 days</h2>
          <BarChart bars={data.history} ariaLabel="Cards answered per day over the last 30 days" />
        </div>
        <div className="grid-2">
          <div className="panel">
            <h2>Card retrievability</h2>
            <BarChart bars={data.rBuckets} height={160} ariaLabel="Distribution of current retrievability" />
          </div>
          <div className="panel">
            <h2>Card difficulty</h2>
            <BarChart bars={data.dBuckets} height={160} ariaLabel="Distribution of FSRS difficulty" />
          </div>
        </div>
      </div>
    </div>
  );
}
