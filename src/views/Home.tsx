// Home: what today holds. Cards waiting across your classes, what you've
// done today, your streak, each class with the decks in it that have cards
// up next, and the year's heatmap.

import { useMemo } from 'react';
import type { View } from '../App';
import { useCollection } from '../lib/collection';
import { baseName } from '../lib/deckTree';
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
  /** the decks in a class with cards waiting, most due first */
  const waitingIn = (cls: { name: string }) =>
    col
      .deckList()
      .filter((d) => d.name.startsWith(`${cls.name}::`))
      .map((d) => {
        const c = col.counts(d.id);
        return { deck: d, due: c.reviewCount + c.learnCount, fresh: c.newCount };
      })
      .filter((x) => x.due + x.fresh > 0)
      .sort((a, b) => b.due - a.due || b.fresh - a.fresh);
  const line =
    data.due + data.fresh === 0
      ? data.reviewed
        ? 'All caught up for today.'
        : 'Nothing waiting today. Add cards to a deck, or start a lesson in Learn.'
      : `${data.due.toLocaleString()} to review and ${data.fresh.toLocaleString()} new across ${upNext.length} class${upNext.length === 1 ? '' : 'es'}.`;

  return (
    <div className="home">
      <header className="page-head home-head">
        <div>
          <h1>Today</h1>
          <p className="muted">{line}</p>
        </div>
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
              {upNext.length} class{upNext.length === 1 ? '' : 'es'} with cards waiting
            </span>
          </div>
          {upNext.slice(0, 6).map(({ deck: cls, counts, due }) => {
            const decks = waitingIn(cls);
            return (
              <div key={cls.id} className="up-next-class">
                <button className="up-next-row up-next-class-row" onClick={() => go({ name: 'class', deckId: cls.id })} title={`Open ${cls.name}`}>
                  <span className={`deck-mark ${cls.icon ? 'has-icon' : ''}`} style={{ '--hue': hueOf(cls.name) } as React.CSSProperties} aria-hidden="true">
                    {cls.icon ?? cls.name.trim()[0]?.toUpperCase()}
                  </span>
                  <span className="up-next-text">
                    <span className="up-next-name">{cls.name}</span>
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
                      <span>
                        {decks.length} deck{decks.length === 1 ? '' : 's'} waiting
                      </span>
                    </span>
                  </span>
                  <span className="up-next-open" aria-hidden="true">
                    ›
                  </span>
                </button>
                {decks.length > 0 && (
                  <div className="up-next-decks">
                    {decks.map((x) => (
                      <div key={x.deck.id} className="up-next-deck">
                        <span className="up-next-deck-name">{x.deck.name.slice(cls.name.length + 2).split('::').map((n) => n.trim()).join(' › ') || baseName(x.deck.name)}</span>
                        <span className="up-next-meta">
                          {x.due > 0 && (
                            <span>
                              <b className="num c-review">{x.due}</b> due
                            </span>
                          )}
                          {x.fresh > 0 && (
                            <span>
                              <b className="num c-new">{x.fresh}</b> new
                            </span>
                          )}
                        </span>
                        <button onClick={() => go({ name: 'review', deckId: x.deck.id })}>Study</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      <ReviewHeatmap />
    </div>
  );
}
