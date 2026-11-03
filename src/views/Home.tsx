// Home: what today holds. Cards waiting across your decks, what you've done
// today, your streak, the decks with cards up next, and the year's heatmap.

import { useMemo } from 'react';
import type { View } from '../App';
import { useCollection } from '../lib/collection';
import { dayNumber, dayStartMs, formatDuration, today } from '../lib/time';
import { ReviewHeatmap } from './ReviewHeatmap';

/** A stable hue per deck name, for its mark. */
export function hueOf(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function Home({ go }: { go: (v: View) => void }) {
  const col = useCollection();

  const data = useMemo(() => {
    const top = col.deckList().filter((d) => !d.name.includes('::'));
    const decks = top
      .map((d) => ({ deck: d, counts: col.counts(d.id) }))
      .map((x) => ({ ...x, due: x.counts.reviewCount + x.counts.learnCount, total: x.counts.reviewCount + x.counts.learnCount + x.counts.newCount }));
    const t = today();
    const start = dayStartMs(t);
    const done = col.revlog.filter((r) => r.id >= start && r.rating !== 0);
    const studiedDays = new Set(col.revlog.filter((r) => r.rating !== 0).map((r) => dayNumber(r.id)));
    let streak = 0;
    for (let d = studiedDays.has(t) ? t : t - 1; studiedDays.has(d); d--) streak++;
    const correct = done.filter((r) => r.rating > 1).length;
    return {
      decks,
      due: decks.reduce((n, x) => n + x.due, 0),
      fresh: decks.reduce((n, x) => n + x.counts.newCount, 0),
      reviewed: done.length,
      timeMs: done.reduce((n, r) => n + r.time, 0),
      correctPct: done.length ? Math.round((correct / done.length) * 100) : null,
      streak,
      studiedToday: studiedDays.has(t),
    };
  }, [col, col.version]);

  const upNext = data.decks.filter((x) => x.total > 0).sort((a, b) => b.due - a.due || b.total - a.total);
  const first = upNext[0];
  const line =
    data.due + data.fresh === 0
      ? data.reviewed
        ? 'All caught up for today.'
        : 'Nothing waiting today. Add cards to a deck, or start a lesson in Learn.'
      : `${data.due.toLocaleString()} to review and ${data.fresh.toLocaleString()} new across ${upNext.length} deck${upNext.length === 1 ? '' : 's'}.`;

  return (
    <div className="home">
      <header className="page-head home-head">
        <div>
          <h1>Today</h1>
          <p className="muted">{line}</p>
        </div>
        {first && (
          <button className="primary" onClick={() => go({ name: 'review', deckId: first.deck.id })}>
            Study {first.deck.name}
          </button>
        )}
      </header>

      <div className="panel kpi-strip">
        <div>
          <span className="kpi-label">To review</span>
          <span className={`kpi-value num ${data.due ? 'c-review' : ''}`}>{data.due.toLocaleString()}</span>
        </div>
        <div>
          <span className="kpi-label">New</span>
          <span className={`kpi-value num ${data.fresh ? 'c-new' : ''}`}>{data.fresh.toLocaleString()}</span>
        </div>
        <div>
          <span className="kpi-label">Reviewed today</span>
          <span className="kpi-value num">
            {data.reviewed.toLocaleString()}
            {data.reviewed > 0 && <span className="kpi-unit"> · {formatDuration(data.timeMs)}</span>}
          </span>
        </div>
        <div>
          <span className="kpi-label">Correct today</span>
          <span className="kpi-value num">{data.correctPct === null ? '–' : `${data.correctPct}%`}</span>
        </div>
        <div>
          <span className="kpi-label">Streak</span>
          <span className="kpi-value num">
            {data.streak}
            <span className="kpi-unit"> day{data.streak === 1 ? '' : 's'}</span>
          </span>
          {data.streak > 0 && !data.studiedToday && <span className="kpi-note">Study today to keep it</span>}
        </div>
      </div>

      {upNext.length > 0 && (
        <section className="panel up-next">
          <div className="up-next-head">
            <h2>Up next</h2>
            <span className="muted">
              {upNext.length} deck{upNext.length === 1 ? '' : 's'} with cards waiting
            </span>
          </div>
          {upNext.slice(0, 6).map(({ deck, counts, due }) => {
            const subs = col
              .deckList()
              .filter((d) => d.name.startsWith(`${deck.name}::`) && !d.name.slice(deck.name.length + 2).includes('::'))
              .filter((d) => {
                const c = col.counts(d.id);
                return c.newCount + c.reviewCount + c.learnCount > 0;
              })
              .map((d) => d.name.slice(deck.name.length + 2));
            return (
              <div key={deck.id} className="up-next-row">
                <span className="deck-mark" style={{ '--hue': hueOf(deck.name) } as React.CSSProperties} aria-hidden="true">
                  {deck.name.trim()[0]?.toUpperCase()}
                </span>
                <span className="up-next-text">
                  <span className="up-next-name">{deck.name}</span>
                  <span className="up-next-meta">
                    {due > 0 && (
                      <span>
                        <b className="num c-review">{due}</b> due
                      </span>
                    )}
                    {counts.newCount > 0 && (
                      <span>
                        <b className="num c-new">{counts.newCount}</b> new
                      </span>
                    )}
                    {subs.length > 0 && <span className="up-next-subs">{subs.join(', ')}</span>}
                  </span>
                </span>
                <button onClick={() => go({ name: 'review', deckId: deck.id })}>Study</button>
              </div>
            );
          })}
        </section>
      )}

      <ReviewHeatmap />
    </div>
  );
}
