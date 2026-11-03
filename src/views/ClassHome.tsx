// A class's homepage: opened by clicking a class in the sidebar. Its title,
// what's waiting, then its decks and its notes as two separate grids.

import { useMemo, useState } from 'react';
import type { View } from '../App';
import { useCollection } from '../lib/collection';
import { baseName, isWithin } from '../lib/deckTree';
import type { Id } from '../lib/types';
import { FileTile, kindOf } from './DeckNotes';
import { hueOf } from './Home';
import { PlusIcon, PromptDialog } from './Modal';

const NOTES_SHOWN = 10;

export function ClassHome({ deckId, go }: { deckId: Id; go: (v: View) => void }) {
  const col = useCollection();
  const deck = col.decks.get(deckId);
  const [creating, setCreating] = useState(false);

  const data = useMemo(() => {
    if (!deck) return null;
    const names = new Map([...col.decks.values()].map((d) => [d.id, d.name]));
    const cardsIn = (name: string) => [...col.cards.values()].filter((c) => isWithin(names.get(c.deckId) ?? '', name)).length;
    const subs = col
      .deckList()
      .filter((d) => d.name.startsWith(`${deck.name}::`) && !d.name.slice(deck.name.length + 2).includes('::'))
      .map((d) => {
        const c = col.counts(d.id);
        return {
          deck: d,
          due: c.reviewCount + c.learnCount,
          fresh: c.newCount,
          cards: cardsIn(d.name),
          subs: col.deckList().filter((x) => x.name.startsWith(`${d.name}::`)).length,
          files: col.deckFilesFor(d.id).length,
        };
      });
    const c = col.counts(deck.id);
    return { subs, due: c.reviewCount + c.learnCount, fresh: c.newCount, cards: cardsIn(deck.name) };
  }, [col, col.version, deck]);

  if (!deck || !data) return <div className="panel">Class not found.</div>;
  const files = col.deckFilesFor(deckId);
  const path = deck.name.split('::');

  return (
    <div className="class-home">
      <header className="page-head home-head">
        <div className="class-title">
          <span className="deck-mark deck-mark-lg" style={{ '--hue': hueOf(deck.name) } as React.CSSProperties} aria-hidden="true">
            {baseName(deck.name).trim()[0]?.toUpperCase()}
          </span>
          <div>
            {path.length > 1 && <p className="muted">{path.slice(0, -1).join(' › ')}</p>}
            <h1>{baseName(deck.name)}</h1>
          </div>
        </div>
        <div className="row">
          <button onClick={() => go({ name: 'add', deckId })}>Add cards</button>
        </div>
      </header>

      <div className="panel kpi-strip class-kpis">
        <div>
          <span className="kpi-label">To review</span>
          <span className={`kpi-value num ${data.due ? 'c-review' : ''}`}>{data.due.toLocaleString()}</span>
        </div>
        <div>
          <span className="kpi-label">New</span>
          <span className={`kpi-value num ${data.fresh ? 'c-new' : ''}`}>{data.fresh.toLocaleString()}</span>
        </div>
        <div>
          <span className="kpi-label">Cards</span>
          <span className="kpi-value num">{data.cards.toLocaleString()}</span>
        </div>
        <div>
          <span className="kpi-label">Notes</span>
          <span className="kpi-value num">{files.length.toLocaleString()}</span>
        </div>
      </div>

      <section className="class-section">
        <div className="up-next-head">
          <h2>Decks</h2>
          <span className="muted">
            {data.subs.length} deck{data.subs.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="class-deck-grid" role="list">
          {data.subs.map((s) => (
            <button key={s.deck.id} role="listitem" className="class-deck-tile" onClick={() => go({ name: 'review', deckId: s.deck.id })} title={`Study ${s.deck.name}`}>
              <span className="class-deck-name">{baseName(s.deck.name)}</span>
              <span className="class-deck-meta muted num">
                {s.cards} card{s.cards === 1 ? '' : 's'}
                {s.subs > 0 && ` · ${s.subs} subdeck${s.subs === 1 ? '' : 's'}`}
                {s.files > 0 && ` · ${s.files} note${s.files === 1 ? '' : 's'}`}
              </span>
              <span className="deck-counts num">
                {s.fresh > 0 && <span className="c-new">{s.fresh} new</span>}
                {s.due > 0 && <span className="c-review">{s.due} due</span>}
                {s.fresh + s.due === 0 && <span className="muted">Nothing waiting</span>}
              </span>
            </button>
          ))}
          <button className="class-deck-tile class-deck-new" onClick={() => setCreating(true)}>
            <PlusIcon />
            <span>New deck</span>
          </button>
        </div>
      </section>

      <section className="class-section">
        <div className="up-next-head">
          <h2>Notes</h2>
          <button className="link" onClick={() => go({ name: 'notes', deckId })}>
            {files.length > NOTES_SHOWN ? `See all ${files.length}` : 'Open notes'}
          </button>
        </div>
        {files.length === 0 ? (
          <button className="notes-empty" onClick={() => go({ name: 'notes', deckId })}>
            <b>No notes yet</b>
            <span className="muted">Open Notes to upload lecture slides, PDFs and documents, or write a note.</span>
          </button>
        ) : (
          <div className="file-grid" role="list">
            {files.slice(0, NOTES_SHOWN).map((f) => (
              <FileTile
                key={f.id}
                file={f}
                selected={false}
                selecting={false}
                onToggle={() => go({ name: 'notes', deckId })}
                onOpen={() => go(kindOf(f) === 'note' ? { name: 'note', fileId: f.id } : { name: 'notes', deckId })}
              />
            ))}
          </div>
        )}
      </section>

      {creating && (
        <PromptDialog
          title={`New deck in ${baseName(deck.name)}`}
          label="Deck name"
          submitLabel="Create"
          validate={(n) => (col.deckByName(`${deck.name}::${n.trim()}`) ? `A deck named “${n}” already exists here.` : null)}
          onSubmit={async (n) => {
            await col.addDeck(`${deck.name}::${n.trim()}`);
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      )}
    </div>
  );
}
