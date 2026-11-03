import { useMemo, useState } from 'react';
import { useCollection } from '../lib/collection';
import { buildSearch, stripHtml } from '../lib/search';
import { dayStartMs, today } from '../lib/time';
import type { Card, Id } from '../lib/types';
import { CardEditor } from './CardEditor';
import { PolishDialog } from './Polish';
import { WordingsDialog } from './WordingsDialog';

type SortKey = 'front' | 'deck' | 'due' | 'ivl' | 's' | 'd' | 'r' | 'reps' | 'lapses' | 'created';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'front', label: 'Front' },
  { key: 'deck', label: 'Deck' },
  { key: 'due', label: 'Due' },
  { key: 'ivl', label: 'Interval' },
  { key: 's', label: 'Stability' },
  { key: 'd', label: 'Difficulty' },
  { key: 'r', label: 'Retrievability' },
  { key: 'reps', label: 'Reviews' },
  { key: 'lapses', label: 'Lapses' },
  { key: 'created', label: 'Created' },
];

function dueLabel(c: Card): string {
  if (c.queue === -1) return '(suspended)';
  if (c.queue === -3) return '(buried)';
  if (c.type === 0) return `New #${c.due}`;
  const ms = c.queue === 1 ? c.due * 1000 : dayStartMs(c.due);
  return new Date(ms).toLocaleDateString();
}

export function Browse({ initialQuery }: { initialQuery?: string }) {
  const col = useCollection();
  const [query, setQuery] = useState(initialQuery ?? '');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'created', desc: true });
  const [selected, setSelected] = useState<Set<Id>>(new Set());
  const [editing, setEditing] = useState<Id | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [wording, setWording] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // every deck section starts collapsed each time Browse opens
  const [collapsed, setCollapsed] = useState<Set<Id>>(() => new Set(col.deckList().map((d) => d.id)));
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

  // Group the sorted matches by deck, in deck-tree order.
  const groups = useMemo(() => {
    const byDeck = new Map<Id, Card[]>();
    for (const c of matches) {
      const list = byDeck.get(c.deckId);
      if (list) list.push(c);
      else byDeck.set(c.deckId, [c]);
    }
    return col
      .deckList()
      .filter((d) => byDeck.has(d.id))
      .map((d) => ({ deck: d, cards: byDeck.get(d.id)! }));
  }, [matches, col]);

  /** cards in visible (expanded) groups, in display order, capped for speed */
  const rows = useMemo(() => {
    const out: Card[] = [];
    for (const g of groups) if (!collapsed.has(g.deck.id)) out.push(...g.cards);
    return out.slice(0, 2000);
  }, [groups, collapsed]);

  const toggleGroup = (deckId: Id) => {
    const next = new Set(collapsed);
    if (next.has(deckId)) next.delete(deckId);
    else next.add(deckId);
    setCollapsed(next);
  };

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
  const visibleCount = groups.reduce((n, g) => n + (collapsed.has(g.deck.id) ? 0 : g.cards.length), 0);
  // AI Polish starts on the selected card's deck, else the searched deck
  const searchedDeck = /deck:(?:"([^"]+)"|(\S+))/.exec(query);
  const polishDeckId =
    (ids.length ? col.cards.get(ids[0])?.deckId : undefined) ??
    (searchedDeck ? col.deckByName(searchedDeck[1] ?? searchedDeck[2])?.id : undefined) ??
    groups[0]?.deck.id;

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
        <button onClick={() => setPolishing(true)} disabled={!col.cards.size} title="Let an AI model suggest clearer, split and extra cards">
          AI Polish
        </button>
        <button onClick={() => setWording(true)} disabled={!col.cards.size} title="Let an AI write other wordings of card questions">
          AI wordings
        </button>
        <button onClick={() => setCollapsed(new Set(groups.map((g) => g.deck.id)))} disabled={!groups.length}>
          Collapse all
        </button>
        <button onClick={() => setCollapsed(new Set())} disabled={!collapsed.size}>
          Expand all
        </button>
      </div>

      <div className={`browse ${editingCard ? 'with-editor' : ''}`}>
        <div className="table-wrap">
          <table className="cards">
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {sort.key === c.key ? (sort.desc ? ' ▾' : ' ▴') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map(({ deck, cards }) => {
              const isCollapsed = collapsed.has(deck.id);
              return (
                <tbody key={deck.id}>
                  <tr className="group-row">
                    <td colSpan={COLUMNS.length}>
                      <button className="group-toggle" aria-expanded={!isCollapsed} onClick={() => toggleGroup(deck.id)}>
                        <span className="twisty-icon" aria-hidden="true">
                          {isCollapsed ? '▸' : '▾'}
                        </span>
                        {deck.name.split("::").join(" › ")}
                        <span className="muted num"> · {cards.length}</span>
                      </button>
                    </td>
                  </tr>
                  {!isCollapsed &&
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
                            <td>{deck.name.split("::").join(" › ")}</td>
                            <td className="num">{dueLabel(c)}</td>
                            <td className="num">{c.type === 0 || c.type === 1 ? '' : `${c.ivl}d`}</td>
                            <td className="num">{c.stability === null ? '' : `${c.stability.toFixed(1)}d`}</td>
                            <td className="num">{c.difficulty === null ? '' : `${(((c.difficulty - 1) / 9) * 100).toFixed(0)}%`}</td>
                            <td className="num">{r === null ? '' : `${(r * 100).toFixed(1)}%`}</td>
                            <td className="num">{c.reps}</td>
                            <td className="num">{c.lapses}</td>
                            <td className="num">{new Date(c.created * 1000).toLocaleDateString()}</td>
                          </tr>
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
      {polishing && (
        <PolishDialog
          initialDeckId={polishDeckId}
          onClose={() => setPolishing(false)}
          onCreated={(name, n) => {
            setPolishing(false);
            setQuery(`deck:"${name}"`);
            setCollapsed(new Set());
            setToast(`Created “${name}” with ${n} card${n === 1 ? '' : 's'}.`);
            setTimeout(() => setToast(null), 4000);
          }}
        />
      )}
      {wording && (
        <WordingsDialog
          selected={ids}
          initialDeckId={polishDeckId}
          onClose={() => setWording(false)}
          onDone={(message) => {
            setWording(false);
            setToast(message);
            setTimeout(() => setToast(null), 5000);
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
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
