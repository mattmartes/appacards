// The app's sidebar: the product, the main screens, your classes (click one
// for its homepage), and statistics and preferences at the foot. Opening a
// class shows its Decks: the decks in it, which you click to study, with +
// on each to add cards. A class's Notes are on its homepage. Opening one
// class closes the others.

import { useState } from 'react';
import type { View } from '../App';
import { useCollection } from '../lib/collection';
import { baseName } from '../lib/deckTree';
import type { Deck, Id } from '../lib/types';
import { AddCards } from './AddCards';
import { ClassDialog } from './ClassDialog';
import { NewDeckDialog } from './NewDeckDialog';
import { DeckOptions } from './DeckOptions';
import { ImportAnki } from './ImportAnki';
import { ChartIcon, GearIcon, Modal, PlusIcon } from './Modal';

const icon = (d: string, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const NAV: { name: View['name']; label: string; icon: string }[] = [
  { name: 'decks', label: 'Home', icon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { name: 'browse', label: 'Edit', icon: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM21 21l-4.35-4.35' },
  { name: 'lab', label: 'Lab', icon: 'M9 3h6M10 3v6L4.5 19a1 1 0 0 0 .9 1.5h13.2a1 1 0 0 0 .9-1.5L14 9V3M7 15h10' },
];

const CARDS_ICON = 'M4 7h12a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM7 4h13a1 1 0 0 1 1 1v12';

const OPEN_KEY = 'appa-sidebar-open';

function readOpen(): Set<Id> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as Id[]);
  } catch {
    return new Set();
  }
}

export function Sidebar({ view, go }: { view: View; go: (v: View) => void }) {
  const col = useCollection();
  const decks = col.deckList();
  const [open, setOpen] = useState<Set<Id>>(readOpen);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [settingsFor, setSettingsFor] = useState<Id | null>(null);
  const [newDeckIn, setNewDeckIn] = useState<Deck | null>(null);
  /** the deck the add-cards window is open for */
  const [addingTo, setAddingTo] = useState<Deck | null>(null);

  const save = (next: Set<Id>) => {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
    } catch {
      // not remembered next time
    }
  };

  const toggle = (id: Id) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    save(next);
  };

  /** Opens a class and closes the others, keeping its parents and its own open subdecks. */
  const openClass = (d: Deck) => {
    const next = new Set<Id>([d.id]);
    for (const id of open) {
      const name = col.decks.get(id)?.name;
      if (name && (name.startsWith(`${d.name}::`) || d.name.startsWith(`${name}::`))) next.add(id);
    }
    save(next);
  };

  const childrenOf = (d: Deck | null) =>
    decks.filter((x) => (d ? x.name.startsWith(`${d.name}::`) && !x.name.slice(d.name.length + 2).includes('::') : !x.name.includes('::')));
  const studying = view.name === 'review' ? view.deckId : null;
  // a class's Notes page belongs to its homepage, so the class stays lit there
  const classOf = view.name === 'class' || view.name === 'notes' ? view.deckId : null;
  const settingsDeck = settingsFor !== null ? col.decks.get(settingsFor) : undefined;

  const indent = (n: number) => ({ paddingLeft: 4 + n * 14 });
  const countsOf = (d: Deck) => {
    const c = col.counts(d.id);
    const due = c.reviewCount + c.learnCount;
    return (
      <span className="deck-counts num">
        {c.newCount > 0 && <span className="c-new">{c.newCount}</span>}
        {due > 0 && <span className="c-review">{due}</span>}
      </span>
    );
  };
  const settingsButton = (d: Deck) => (
    <button className="icon-button" onClick={() => setSettingsFor(d.id)} aria-label={`Settings for ${d.name}`} title="Deck settings">
      <GearIcon size={16} />
    </button>
  );

  /** A class, and when it's open, its Decks row with its decks under it. */
  const renderClass = (d: Deck) => {
    const isOpen = open.has(d.id);
    const subs = childrenOf(d);
    return (
      <div key={d.id} role="treeitem" aria-expanded={isOpen}>
        <div className={`deck-item ${classOf === d.id || (!isOpen && studying === d.id) ? 'active' : ''}`} style={indent(0)}>
          <button className="deck-twisty" aria-label={isOpen ? `Close ${d.name}` : `Open ${d.name}`} onClick={() => (isOpen ? toggle(d.id) : openClass(d))}>
            {isOpen ? '▾' : '▸'}
          </button>
          <button
            className="deck-open"
            onClick={() => {
              openClass(d);
              go({ name: 'class', deckId: d.id });
            }}
            title={`Open ${d.name}`}
          >
            {d.icon && (
              <span className="class-icon" aria-hidden="true">
                {d.icon}
              </span>
            )}
            <span className="deck-label">{baseName(d.name)}</span>
            {countsOf(d)}
          </button>
          <span className="deck-actions">{settingsButton(d)}</span>
        </div>
        {isOpen && (
          <div role="group">
            <div className="deck-sub-row">
              <button className={`deck-sub ${studying === d.id ? 'active' : ''}`} style={indent(1)} onClick={() => go({ name: 'review', deckId: d.id })} title={`Study all of ${baseName(d.name)}`}>
                {icon(CARDS_ICON, 15)}
                <span className="deck-label">Decks</span>
                {subs.length > 0 && <span className="deck-sub-count num">{subs.length}</span>}
              </button>
              <span className="deck-actions">
                <button className="icon-button" onClick={() => setNewDeckIn(d)} aria-label={`New deck in ${d.name}`} title="New deck">
                  <PlusIcon />
                </button>
              </span>
            </div>
            {subs.map((s) => renderDeck(s, 2))}
          </div>
        )}
      </div>
    );
  };

  /** A deck in a class: click it to study it, + to add cards to it. Decks
   * inside it (from Anki imports, say) sit under it. */
  const renderDeck = (d: Deck, level: number) => {
    const subs = childrenOf(d);
    const isOpen = open.has(d.id);
    return (
      <div key={d.id} role="treeitem" aria-expanded={subs.length ? isOpen : undefined}>
        <div className={`deck-item deck-leaf ${studying === d.id ? 'active' : ''}`} style={indent(level)}>
          {subs.length > 0 ? (
            <button className="deck-twisty" aria-label={isOpen ? `Close ${d.name}` : `Open ${d.name}`} onClick={() => toggle(d.id)}>
              {isOpen ? '▾' : '▸'}
            </button>
          ) : (
            <span className="deck-twisty" aria-hidden="true" />
          )}
          <button className="deck-open" onClick={() => go({ name: 'review', deckId: d.id })} title={`Study ${d.name}`}>
            <span className="deck-label">{baseName(d.name)}</span>
            {countsOf(d)}
          </button>
          <span className="deck-actions">
            <button className="icon-button" onClick={() => setAddingTo(d)} aria-label={`Add cards to ${d.name}`} title="Add cards">
              <PlusIcon />
            </button>
            {settingsButton(d)}
          </span>
        </div>
        {isOpen && subs.length > 0 && <div role="group">{subs.map((s) => renderDeck(s, level + 1))}</div>}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src="/icon.png" alt="" />
        <span>Appa</span>
      </div>

      <nav className="sidebar-nav" aria-label="Screens">
        {NAV.map((n) => (
          <button key={n.name} className={view.name === n.name ? 'active' : ''} aria-current={view.name === n.name ? 'page' : undefined} onClick={() => go({ name: n.name } as View)}>
            {icon(n.icon)}
            {n.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-group">
        <span>Classes</span>
        <button className="icon-button" onClick={() => setImporting(true)} aria-label="Import from Anki" title="Import from Anki (.apkg)">
          {icon('M12 3v12M7 10l5 5 5-5M5 21h14')}
        </button>
        <button className="icon-button" onClick={() => setCreating(true)} aria-label="New class" title="New class">
          <PlusIcon />
        </button>
      </div>

      <div className="sidebar-decks" role="tree" aria-label="Classes">
        {childrenOf(null).map((d) => renderClass(d))}
      </div>

      <div className="sidebar-foot">
        <button className={view.name === 'stats' ? 'active' : ''} onClick={() => go({ name: 'stats' })}>
          <ChartIcon />
          Statistics
        </button>
        <button className={view.name === 'settings' ? 'active' : ''} onClick={() => go({ name: 'settings' })}>
          <GearIcon size={16} />
          Preferences
        </button>
      </div>

      {importing && <ImportAnki onClose={() => setImporting(false)} />}
      {creating && (
        <ClassDialog
          title="New class"
          askName
          submitLabel="Create class"
          validate={(n) => (col.deckByName(n.split('::').map((s) => s.trim()).join('::')) ? `A class named “${n}” already exists.` : null)}
          onSubmit={async (n, emoji) => {
            let d = await col.addDeck(n);
            if (emoji) {
              d = { ...d, icon: emoji };
              await col.updateDeck(d);
            }
            setCreating(false);
            openClass(d);
            go({ name: 'class', deckId: d.id });
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {newDeckIn && (
        <NewDeckDialog
          title={`New deck in ${baseName(newDeckIn.name)}`}
          validate={(n) => (col.deckByName(`${newDeckIn.name}::${n.trim()}`) ? `A deck named “${n}” already exists here.` : null)}
          onSubmit={async (n, plan) => {
            const d = await col.addDeck(`${newDeckIn.name}::${n.trim()}`);
            if (plan) await col.updateDeck({ ...d, dueDate: plan });
            setNewDeckIn(null);
          }}
          onCancel={() => setNewDeckIn(null)}
        />
      )}
      {addingTo && (
        <Modal title={`Add cards to ${baseName(addingTo.name)}`} onClose={() => setAddingTo(null)} wide>
          <AddCards key={addingTo.id} initialDeckId={addingTo.id} bare />
        </Modal>
      )}
      {settingsDeck && (
        <Modal title={`${settingsDeck.name} settings`} onClose={() => setSettingsFor(null)} wide>
          <DeckOptions
            key={settingsDeck.id}
            deckId={settingsDeck.id}
            go={(v) => {
              setSettingsFor(null);
              go(v);
            }}
            onClose={() => setSettingsFor(null)}
          />
        </Modal>
      )}
    </aside>
  );
}
