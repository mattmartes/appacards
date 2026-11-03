// The app's sidebar: the product, the main screens, your decks as a tree
// (click one to study it), and statistics and preferences at the foot.
// Opening a deck's arrow shows its Notes (uploaded files) and its Decks
// (its cards and subdecks). Decks are classes: opening one closes the
// others. Deck actions live here too.

import { useState } from 'react';
import type { View } from '../App';
import { useCollection } from '../lib/collection';
import { baseName } from '../lib/deckTree';
import type { Deck, Id } from '../lib/types';
import { DeckOptions } from './DeckOptions';
import { ImportAnki } from './ImportAnki';
import { ChartIcon, GearIcon, Modal, PlusIcon, PromptDialog } from './Modal';

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

const NOTES_ICON = 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6';
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
  const notesOf = view.name === 'notes' ? view.deckId : null;
  const classOf = view.name === 'class' ? view.deckId : null;
  const settingsDeck = settingsFor !== null ? col.decks.get(settingsFor) : undefined;

  /** A deck row, and when it's open, its Notes and Decks with the subdecks under Decks. */
  const renderDeck = (d: Deck, level: number) => {
    const c = col.counts(d.id);
    const due = c.reviewCount + c.learnCount;
    const isOpen = open.has(d.id);
    const files = col.deckFilesFor(d.id).length;
    const subs = childrenOf(d);
    const indent = (n: number) => ({ paddingLeft: 4 + n * 14 });
    return (
      <div key={d.id} role="treeitem" aria-expanded={isOpen}>
        <div className={`deck-item ${classOf === d.id || (!isOpen && studying === d.id) ? 'active' : ''}`} style={indent(level)}>
          <button
            className="deck-twisty"
            aria-label={isOpen ? `Close ${d.name}` : `Open ${d.name}`}
            onClick={() => (isOpen ? toggle(d.id) : openClass(d))}
          >
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
            <span className="deck-label">{baseName(d.name)}</span>
            <span className="deck-counts num">
              {c.newCount > 0 && <span className="c-new">{c.newCount}</span>}
              {due > 0 && <span className="c-review">{due}</span>}
            </span>
          </button>
          <span className="deck-actions">
            <button className="icon-button" onClick={() => go({ name: 'add', deckId: d.id })} aria-label={`Add cards to ${d.name}`} title="Add cards">
              <PlusIcon />
            </button>
            <button className="icon-button" onClick={() => setSettingsFor(d.id)} aria-label={`Settings for ${d.name}`} title="Deck settings">
              <GearIcon size={16} />
            </button>
          </span>
        </div>
        {isOpen && (
          <div role="group">
            <button className={`deck-sub ${notesOf === d.id ? 'active' : ''}`} style={indent(level + 1)} onClick={() => go({ name: 'notes', deckId: d.id })}>
              {icon(NOTES_ICON, 15)}
              <span className="deck-label">Notes</span>
              {files > 0 && <span className="deck-sub-count num">{files}</span>}
            </button>
            <button className={`deck-sub ${studying === d.id ? 'active' : ''}`} style={indent(level + 1)} onClick={() => go({ name: 'review', deckId: d.id })}>
              {icon(CARDS_ICON, 15)}
              <span className="deck-label">Decks</span>
              {subs.length > 0 && <span className="deck-sub-count num">{subs.length}</span>}
            </button>
            {subs.map((s) => renderDeck(s, level + 2))}
          </div>
        )}
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
        <button className="icon-button" onClick={() => setCreating(true)} aria-label="Create deck" title="Create deck">
          <PlusIcon />
        </button>
      </div>

      <div className="sidebar-decks" role="tree" aria-label="Classes">
        {childrenOf(null).map((d) => renderDeck(d, 0))}
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
        <PromptDialog
          title="Create deck"
          label="Deck name"
          hint="Use :: for subdecks, e.g. Spanish::Verbs"
          submitLabel="Create"
          validate={(n) => (col.deckByName(n.split('::').map((s) => s.trim()).join('::')) ? `A deck named “${n}” already exists.` : null)}
          onSubmit={async (n) => {
            await col.addDeck(n);
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
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
