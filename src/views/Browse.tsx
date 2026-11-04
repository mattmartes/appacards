// The Edit screen: every card, grouped by class and then by deck, with a
// search, bulk actions, a card editor, and Add cards on each deck.

import { Fragment, useMemo, useState } from 'react';
import { useCollection } from '../lib/collection';
import { baseName } from '../lib/deckTree';
import { buildSearch, stripHtml } from '../lib/search';
import { dayStartMs, today } from '../lib/time';
import type { Card, Deck, Id } from '../lib/types';
import { AddCards } from './AddCards';
import { CardEditor } from './CardEditor';
import { Modal } from './Modal';

type SortKey = 'front' | 'deck' | 'due' | 'ivl' | 's' | 'd' | 'r' | 'reps' | 'lapses' | 'created';

/** Fixed widths, so the header lines up with the rows whatever is shown;
 * numbers sit right, under a right-aligned heading. */
const COLUMNS: { key: SortKey; label: string; width: string; num?: boolean }[] = [
  { key: 'front', label: 'Front', width: '19%' },
  { key: 'deck', label: 'Deck', width: '12%' },
  { key: 'due', label: 'Due', width: '10%' },
  { key: 'ivl', label: 'Interval', width: '8%', num: true },
  { key: 's', label: 'Stability', width: '8%', num: true },
  { key: 'd', label: 'Difficulty', width: '9%', num: true },
  { key: 'r', label: 'Retention', width: '9%', num: true },
  { key: 'reps', label: 'Reviews', width: '8%', num: true },
  { key: 'lapses', label: 'Lapses', width: '7%', num: true },
  { key: 'created', label: 'Created', width: '10%', num: true },
];

function dueLabel(c: Card): string {
  if (c.queue === -1) return '(suspended)';
  if (c.queue === -3) return '(buried)';
  if (c.type === 0) return `New #${c.due}`;
  const ms = c.queue === 1 ? c.due * 1000 : dayStartMs(c.due);
  return new Date(ms).toLocaleDateString();
}

/** One deck's matching cards, inside its class. */
interface DeckGroup {
  deck: Deck;
  cards: Card[];
}

/** A class and the decks in it that have matching cards (or all of them,
 * with no search, so there's somewhere to add cards to). */
interface ClassGroup {
  cls: Deck;
  decks: DeckGroup[];
  count: number;
}

export function Browse({ initialQuery }: { initialQuery?: string }) {
  const col = useCollection();
  const [query, setQuery] = useState(initialQuery ?? '');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'created', desc: true });
  const [selected, setSelected] = useState<Set<Id>>(new Set());
  const [editing, setEditing] = useState<Id | null>(null);
  /** the deck the add-cards window is open for */
  const [addingTo, setAddingTo] = useState<Deck | null>(null);
  // what's open: classes ("c:" + id) and decks ("d:" + id) all start closed
  // each time Edit opens, and opening a class doesn't open its decks
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const matches = useMemo(() => {
    let match: (c: Card) => boolean;
    try {
      match = buildSearch(query, {
        decks: col.decks,
        presetFor: (id) => col.presetFor(id),
        retrievability: (c) => col.retrievability(c),
      });
    } catch {
      match = () => false;
    }
    const t = today();
    const r = (c: Card) => col.retrievability(c) ?? -1;
    const keyOf: Record<SortKey, (c: Card) => number | string> = {
      front: (c) => stripHtml(c.front).toLowerCase(),
      deck: (c) => col.decks.get(c.deckId)?.name ?? '',
      due: (c) => (c.type === 0 ? 1e12 + c.due : c.queue === 1 ? (c.due - Date.now() / 1000) / 86400 + t : c.due),
      ivl: (c) => c.ivl,
      s: (c) => c.stability ?? -1,
      d: (c) => c.difficulty ?? -1,
      r,
      reps: (c) => c.reps,
      lapses: (c) => c.lapses,
      created: (c) => c.id,
    };
    const k = keyOf[sort.key];
    const list = [...col.cards.values()].filter(match);
    list.sort((a, b) => {
      const x = k(a);
      const y = k(b);
      const cmp = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -cmp : cmp;
    });
    return list;
    // col.version changes on every mutation
  }, [query, sort, col, col.version]);

  // Group the sorted matches by class, then by deck, in deck-tree order.
  const classes = useMemo((): ClassGroup[] => {
    const byDeck = new Map<Id, Card[]>();
    for (const c of matches) {
      const list = byDeck.get(c.deckId);
      if (list) list.push(c);
      else byDeck.set(c.deckId, [c]);
    }
    const searching = query.trim() !== '';
    const all = col.deckList();
    return all
      .filter((d) => !d.name.includes('::'))
      .map((cls) => {
        const inside = all.filter((d) => d.name.startsWith(`${cls.name}::`));
        const decks = [cls, ...inside]
          .map((deck) => ({ deck, cards: byDeck.get(deck.id) ?? [] }))
          // with no search every deck shows, so cards can be added to it; the
          // class's own cards only show when it has some, or has no decks
          .filter((g) => (searching ? g.cards.length > 0 : g.deck !== cls || g.cards.length > 0 || inside.length === 0));
        return { cls, decks, count: decks.reduce((n, g) => n + g.cards.length, 0) };
      })
      .filter((g) => g.decks.length > 0);
  }, [matches, col, query]);

  const isOpen = (key: string) => opened.has(key);
  /** cards in open classes and decks, in display order, capped for speed */
  const rows = useMemo(() => {
    const out: Card[] = [];
    for (const g of classes) if (opened.has(`c:${g.cls.id}`)) for (const d of g.decks) if (opened.has(`d:${d.deck.id}`)) out.push(...d.cards);
    return out.slice(0, 2000);
  }, [classes, opened]);

  const toggle = (key: string) => {
    const next = new Set(opened);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpened(next);
  };

  const mark = (key: SortKey) =>
    sort.key === key && (
      <span className="sort-mark" aria-hidden="true">
        {sort.desc ? '▾' : '▴'}
      </span>
    );
  const toggleSort = (key: SortKey) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }));

  const clickRow = (e: React.MouseEvent, id: Id) => {
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
    } else if (e.shiftKey && selected.size) {
      const ids = rows.map((r) => r.id);
      const last = ids.indexOf([...selected].pop()!);
      const cur = ids.indexOf(id);
      setSelected(new Set(ids.slice(Math.min(last, cur), Math.max(last, cur) + 1)));
    } else {
      setSelected(new Set([id]));
      setEditing(id);
    }
  };

  const ids = [...selected].filter((id) => col.cards.has(id));
  const anySuspended = ids.some((id) => col.cards.get(id)?.queue === -1);
  const editingCard = editing !== null ? col.cards.get(editing) : undefined;
  const shownIds = new Set(rows.map((c) => c.id));
  const visibleCount = classes.reduce(
    (n, g) => n + (isOpen(`c:${g.cls.id}`) ? g.decks.reduce((m, d) => m + (isOpen(`d:${d.deck.id}`) ? d.cards.length : 0), 0) : 0),
    0,
  );
  const deckLabel = (deck: Deck, cls: Deck) => (deck.id === cls.id ? 'Not in a deck' : deck.name.slice(cls.name.length + 2).split('::').join(' › '));

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="row">
        <input
          type="search"
          placeholder='Search — e.g. deck:"Spanish" is:due prop:r<0.85 -tag:leech'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
        />
        <span className="muted num">{matches.length} cards</span>
      </div>
      <div className="row">
        <button disabled={!ids.length} onClick={() => col.setSuspended(ids, !anySuspended)}>
          {anySuspended ? 'Unsuspend' : 'Suspend'}
        </button>
        <button
          disabled={!ids.length}
          onClick={() => confirm(`Reset ${ids.length} card(s) to new? Their memory state is cleared.`) && col.forget(ids)}
        >
          Forget
        </button>
        <button
          className="danger"
          disabled={!ids.length}
          onClick={async () => {
            if (!confirm(`Delete ${ids.length} card(s) and their review history?`)) return;
            await col.deleteCards(ids);
            setSelected(new Set());
            setEditing(null);
          }}
        >
          Delete
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          Ctrl/Shift-click to select several
        </span>
        <span className="spacer" />
        <button onClick={() => setOpened(new Set())} disabled={!opened.size}>
          Collapse all
        </button>
        <button onClick={() => setOpened(new Set(classes.flatMap((g) => [`c:${g.cls.id}`, ...g.decks.map((d) => `d:${d.deck.id}`)])))} disabled={!classes.length}>
          Expand all
        </button>
      </div>

      <div className={`browse ${editingCard ? 'with-editor' : ''}`}>
        <div className="table-wrap">
          <table className="cards cards-fixed">
            <colgroup>
              {COLUMNS.map((c) => (
                <col key={c.key} style={{ width: c.width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} title={c.label} className={c.num ? 'num-col' : undefined} onClick={() => toggleSort(c.key)} aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
                    {c.label}
                    {mark(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            {classes.map(({ cls, decks, count }) => {
              const classOpen = isOpen(`c:${cls.id}`);
              return (
                <tbody key={cls.id}>
                  <tr className="group-row class-row">
                    <td colSpan={COLUMNS.length}>
                      <button className="group-toggle" aria-expanded={classOpen} onClick={() => toggle(`c:${cls.id}`)}>
                        <span className="twisty-icon" aria-hidden="true">
                          {classOpen ? '▾' : '▸'}
                        </span>
                        {cls.icon && (
                          <span className="class-icon" aria-hidden="true">
                            {cls.icon}
                          </span>
                        )}
                        {baseName(cls.name)}
                        <span className="muted num"> · {count}</span>
                      </button>
                    </td>
                  </tr>
                  {classOpen &&
                    decks.map(({ deck, cards }) => {
                      const deckOpen = isOpen(`d:${deck.id}`);
                      return (
                        <Fragment key={deck.id}>
                          <tr className="group-row deck-group-row">
                            <td colSpan={COLUMNS.length}>
                              <div className="deck-group-head">
                                <button className="group-toggle" aria-expanded={deckOpen} onClick={() => toggle(`d:${deck.id}`)}>
                                  <span className="twisty-icon" aria-hidden="true">
                                    {deckOpen ? '▾' : '▸'}
                                  </span>
                                  {deckLabel(deck, cls)}
                                  <span className="muted num"> · {cards.length}</span>
                                </button>
                                <button className="link group-add" onClick={() => setAddingTo(deck)} title={`Add cards to ${deck.name}`}>
                                  + Add cards
                                </button>
                              </div>
                            </td>
                          </tr>
                          {deckOpen &&
                            cards
                              .filter((c) => shownIds.has(c.id))
                              .map((c) => {
                                const r = col.retrievability(c);
                                return (
                                  <tr
                                    key={c.id}
                                    className={`${selected.has(c.id) ? 'selected' : ''} ${c.queue === -1 ? 'suspended' : ''}`}
                                    onClick={(e) => clickRow(e, c.id)}
                                  >
                                    <td title={stripHtml(c.front)}>{stripHtml(c.front)}</td>
                                    <td title={deck.name.split('::').join(' › ')}>{deckLabel(deck, cls)}</td>
                                    <td className="num">{dueLabel(c)}</td>
                                    <td className="num num-col">{c.type === 0 || c.type === 1 ? '' : `${c.ivl}d`}</td>
                                    <td className="num num-col">{c.stability === null ? '' : `${c.stability.toFixed(1)}d`}</td>
                                    <td className="num num-col">{c.difficulty === null ? '' : `${(((c.difficulty - 1) / 9) * 100).toFixed(0)}%`}</td>
                                    <td className="num num-col">{r === null ? '' : `${(r * 100).toFixed(1)}%`}</td>
                                    <td className="num num-col">{c.reps}</td>
                                    <td className="num num-col">{c.lapses}</td>
                                    <td className="num num-col">{new Date(c.created * 1000).toLocaleDateString()}</td>
                                  </tr>
                                );
                              })}
                        </Fragment>
                      );
                    })}
                </tbody>
              );
            })}
          </table>
          {visibleCount > rows.length && (
            <p className="muted" style={{ padding: 8 }}>
              Showing the first {rows.length} cards. Narrow the search or collapse some decks to see more.
            </p>
          )}
        </div>
        {editingCard && (
          <div>
            <CardEditor key={editingCard.id} card={editingCard} onDone={() => setEditing(null)} />
            <CardHistory card={editingCard} />
          </div>
        )}
      </div>
      {addingTo && (
        <Modal title={`Add cards to ${baseName(addingTo.name)}`} onClose={() => setAddingTo(null)} wide>
          <AddCards key={addingTo.id} initialDeckId={addingTo.id} bare />
        </Modal>
      )}
    </div>
  );
}

const RATING_LABELS = ['Reset', 'Again', 'Hard', 'Good', 'Easy'];

function CardHistory({ card }: { card: Card }) {
  const col = useCollection();
  const entries = col.revlog.filter((r) => r.cardId === card.id).sort((a, b) => b.id - a.id);
  if (!entries.length) return null;
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <h2>Review history</h2>
      <table className="cards">
        <thead>
          <tr>
            <th>Date</th>
            <th>Rating</th>
            <th>Elapsed</th>
            <th>R</th>
            <th>S after</th>
            <th>Next</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((r) => (
            <tr key={r.id}>
              <td className="num">{new Date(r.id).toLocaleString()}</td>
              <td>{RATING_LABELS[r.rating]}</td>
              <td className="num">{r.elapsedDays}d</td>
              <td className="num">{r.retrievability === null ? '' : `${(r.retrievability * 100).toFixed(0)}%`}</td>
              <td className="num">{r.stability ? `${r.stability.toFixed(1)}d` : ''}</td>
              <td className="num">{r.ivl >= 0 ? `${r.ivl}d` : `${Math.round(-r.ivl / 60)}m`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
