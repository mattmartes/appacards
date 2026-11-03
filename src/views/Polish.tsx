// AI Polish: choose a deck and an OpenRouter key, let the model suggest
// improvements, then review them side by side before creating the
// "<deck> - Polished" deck.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCollection } from '../lib/collection';
import { stripHtml } from '../lib/template';
import { depth } from '../lib/deckTree';
import { fromEditorHtml, renderMedia, toEditorHtml } from '../lib/media';
import {
  cardsToCreate,
  collectItems,
  countCardsToCreate,
  createPolishedDeck,
  draftId,
  draftProblem,
  estimateCost,
  getLastSession,
  polishedDeckName,
  runPolish,
  savedKey,
  saveKey,
  saveModel,
  setLastSession,
  type DraftCard,
  type DraftKind,
  type PolishItem,
  type PolishProgress,
  type PolishSession,
} from '../lib/polish';
import { KeyField, ModelPicker, useModels } from './AiPrefs';
import type { Id } from '../lib/types';
import { Modal } from './Modal';

export function PolishDialog({
  initialDeckId,
  onClose,
  onCreated,
}: {
  initialDeckId?: Id;
  onClose: () => void;
  onCreated: (deckName: string, cards: number) => void;
}) {
  const col = useCollection();
  const decks = col.deckList();
  const [deckId, setDeckId] = useState<Id | undefined>(initialDeckId ?? decks[0]?.id);
  const [key, setKey] = useState(savedKey);
  const { models, initial } = useModels();
  const [chosenModel, setModel] = useState<string | null>(null);
  const model = chosenModel ?? initial;
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<PolishProgress | null>(null);
  const [session, setSession] = useState<PolishSession | null>(null);
  const abort = useRef<AbortController | null>(null);
  const last = getLastSession();

  useEffect(() => () => abort.current?.abort(), []);

  const items = useMemo(() => (deckId !== undefined ? collectItems(deckId) : []), [deckId, col.version]);
  const occlusions = items.filter((it) => it.status === 'occlusion').length;
  const toPolish = items.length - occlusions;
  const deckName = deckId !== undefined ? col.decks.get(deckId)?.name : undefined;
  const cost = estimateCost(items, models.find((m) => m.id === model));

  const start = async (s: PolishSession) => {
    setError(null);
    setLastSession(s);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      await runPolish(s, key.trim(), ctrl.signal, setProgress);
      if (ctrl.signal.aborted) return;
      setSession(s);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
      // keep what finished, so a retry only redoes the rest
      if (s.items.some((it) => it.status !== 'pending' && it.status !== 'error' && it.status !== 'occlusion')) setSession(s);
    } finally {
      setProgress(null);
    }
  };

  if (session) {
    return (
      <PolishReview
        session={session}
        onRetry={() => {
          setSession(null);
          void start(session);
        }}
        onExit={onClose}
        onCreated={onCreated}
      />
    );
  }

  if (progress) {
    const pct = progress.total ? (progress.done / progress.total) * 100 : 0;
    return (
      <Modal
        title="Polishing…"
        onClose={() => abort.current?.abort()}
        footer={
          <button
            onClick={() => {
              abort.current?.abort();
              setProgress(null);
            }}
          >
            Cancel
          </button>
        }
      >
        <p style={{ margin: 0 }}>
          {model} is working through {deckName}, {progress.done} of {progress.total} cards done.
        </p>
        <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${pct}%` }} />
        </div>
      </Modal>
    );
  }

  const canStart = deckId !== undefined && toPolish > 0 && key.trim() !== '' && model.trim() !== '';
  return (
    <Modal
      title="AI Polish"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={!canStart}
            onClick={() => {
              if (deckId === undefined) return;
              const info = models.find((m) => m.id === model.trim());
              void start({
                deckId,
                deckName: deckName ?? '',
                model: model.trim(),
                items,
                jsonMode: info?.supported_parameters?.includes('response_format'),
                maxTokens: info?.top_provider?.max_completion_tokens ?? undefined,
              });
            }}
          >
            Polish {toPolish} card{toPolish === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        An AI model rewords cards, splits cards that test several things, and suggests cards that fill gaps in the deck. You review
        every change before anything is made. Confirming creates a new deck, “{deckName ? polishedDeckName(deckName) : '… - Polished'}”,
        and your original deck stays as it is.
      </p>
      {last && (
        <div className="polish-resume">
          <span>
            A polish of <b>{last.deckName}</b> hasn't been confirmed yet.
          </span>
          <button onClick={() => setSession(last)}>Resume review</button>
        </div>
      )}
      <label>
        <div className="field-label">Deck (with its subdecks)</div>
        <select value={deckId ?? ''} onChange={(e) => setDeckId(Number(e.target.value))} style={{ width: '100%' }}>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {'  '.repeat(depth(d.name))}
              {d.name.split('::').pop()}
            </option>
          ))}
        </select>
      </label>
      <div className="muted" style={{ fontSize: 13, marginTop: -6 }}>
        {toPolish} card{toPolish === 1 ? '' : 's'} to polish
        {occlusions > 0 && `; ${occlusions} image occlusion or smart note${occlusions === 1 ? ' is' : 's are'} copied as is`}.
      </div>
      <label>
        <div className="field-label">OpenRouter API key</div>
        <KeyField
          value={key}
          onChange={(k) => {
            setKey(k);
            saveKey(k);
          }}
        />
      </label>
      <label>
        <div className="field-label">Model</div>
        <ModelPicker
          value={model}
          onChange={(m) => {
            setModel(m);
            saveModel(m);
          }}
        />
      </label>
      <div className="muted" style={{ fontSize: 13, marginTop: -6 }}>
        {cost !== null && toPolish > 0 && <>Estimated cost of this run: about {formatUsd(cost)}, billed to your OpenRouter account. </>}
        The key and model are saved in Preferences → AI.
      </div>
      {error && <div className="polish-error">{error}</div>}
    </Modal>
  );
}

// ---------------------------------------------------------------- review

type Filter = 'all' | 'changed' | 'split' | 'vague' | 'duplicates' | 'added' | 'unchanged' | 'skipped';

/** "under $0.01", "$0.35", "$4.20" */
function formatUsd(n: number): string {
  if (n < 0.01) return n === 0 ? 'free' : 'under $0.01';
  return `$${n.toFixed(2)}`;
}

const FILTERS: { key: Filter; label: string; test: (it: PolishItem) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'changed', label: 'Reworded', test: (it) => it.status === 'changed' },
  { key: 'split', label: 'Split', test: (it) => it.status === 'split' },
  { key: 'vague', label: 'Too vague', test: (it) => it.issues.includes('vague') },
  { key: 'duplicates', label: 'Duplicates', test: (it) => it.issues.includes('duplicate') },
  { key: 'added', label: 'New cards', test: (it) => it.added.length > 0 },
  { key: 'unchanged', label: 'No changes', test: (it) => it.status === 'unchanged' },
  { key: 'skipped', label: 'Not polished', test: (it) => it.status === 'occlusion' || it.status === 'error' || it.status === 'pending' },
];

function PolishReview({
  session,
  onRetry,
  onExit,
  onCreated,
}: {
  session: PolishSession;
  onRetry: () => void;
  onExit: () => void;
  onCreated: (deckName: string, cards: number) => void;
}) {
  // Items are edited in place; this re-renders after each change.
  const [, setTick] = useState(0);
  const touch = () => setTick((t) => t + 1);
  const [filter, setFilter] = useState<Filter>('all');
  const [showProblems, setShowProblems] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = session.items;
  const shown = items.filter(FILTERS.find((f) => f.key === filter)!.test);
  const failed = items.filter((it) => it.status === 'error' || it.status === 'pending').length;
  const { total, added: newCards } = countCardsToCreate(items);
  const targetName = polishedDeckName(session.deckName);
  const byKey = new Map(items.map((it) => [it.key, it]));
  /** key -> the cards marked as duplicates of it */
  const repeatedBy = new Map<string, PolishItem[]>();
  for (const it of items) if (it.duplicateOf) repeatedBy.set(it.duplicateOf, [...(repeatedBy.get(it.duplicateOf) ?? []), it]);

  /** Scrolls to a card's row and briefly highlights it. */
  const jumpTo = (key: string) => {
    setFilter('all');
    // after the "All" list renders
    setTimeout(() => {
      const el = document.getElementById(`polish-${key}`);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    });
  };

  const confirm = async () => {
    const problems = cardsToCreate(items).filter(({ draft }) => draftProblem(draft));
    if (problems.length) {
      setShowProblems(true);
      setFilter('all');
      setError(`${problems.length} card${problems.length === 1 ? ' needs' : 's need'} fixing first (marked in red).`);
      requestAnimationFrame(() => listRef.current?.querySelector('.draft-card.invalid')?.scrollIntoView({ block: 'center' }));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const r = await createPolishedDeck(session);
      setLastSession(null);
      onCreated(r.name, r.cards);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  };

  return createPortal(
    <div className="polish-review" role="dialog" aria-modal="true" aria-label="Review AI polish">
      <header className="polish-header">
        <div>
          <h2 style={{ margin: 0 }}>Review AI polish</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            {session.deckName} → <b>{targetName}</b> · {session.model}
          </div>
        </div>
        <div className="polish-filters" role="tablist">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} className={filter === f.key ? 'active' : ''} onClick={() => setFilter(f.key)}>
              {f.label} <span className="num muted">{items.filter(f.test).length}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="polish-list" ref={listRef}>
        <div className="polish-columns muted">
          <span>Original</span>
          <span />
          <span>AI polished (edit freely)</span>
        </div>
        {shown.map((it) => (
          <ItemRow
            key={it.key}
            item={it}
            touch={touch}
            showProblems={showProblems}
            other={it.duplicateOf ? byKey.get(it.duplicateOf) : undefined}
            repeatedBy={repeatedBy.get(it.key) ?? []}
            jumpTo={jumpTo}
          />
        ))}
        {!shown.length && <p className="muted">Nothing here.</p>}
      </div>

      <footer className="polish-footer">
        <span className="muted" style={{ fontSize: 13 }}>
          {total} card{total === 1 ? '' : 's'} will be created{newCards > 0 && `, including ${newCards} new`}.
        </span>
        {error && <span className="polish-error">{error}</span>}
        <span className="spacer" />
        {failed > 0 && <button onClick={onRetry}>Retry {failed} not polished</button>}
        <button onClick={onExit} disabled={creating}>
          Exit
        </button>
        <button className="primary" onClick={() => void confirm()} disabled={creating}>
          {creating ? 'Creating…' : 'Confirm and create deck'}
        </button>
      </footer>
    </div>,
    document.body,
  );
}

const STATUS_LABEL: Record<PolishItem['status'], string> = {
  pending: 'Not polished yet',
  unchanged: 'No changes',
  changed: 'Reworded',
  split: 'Split',
  duplicate: 'Duplicate',
  occlusion: 'Not polished',
  error: 'Not polished',
};

/** A card's question as a short quote, for linking between duplicates. */
const quote = (it: PolishItem) => {
  const t = stripHtml(it.original.front).replace(/\s+/g, ' ').trim();
  return `“${t.length > 70 ? `${t.slice(0, 69)}…` : t}”`;
};

function ItemRow({
  item,
  touch,
  showProblems,
  other,
  repeatedBy,
  jumpTo,
}: {
  item: PolishItem;
  touch: () => void;
  showProblems: boolean;
  /** the card this one duplicates or overlaps */
  other?: PolishItem;
  /** cards marked as duplicates of this one */
  repeatedBy: PolishItem[];
  jumpTo: (key: string) => void;
}) {
  const setChoice = (c: PolishItem['choice']) => {
    item.choice = c;
    touch();
  };
  const addCard = () => {
    item.cards.push({ id: draftId(), kind: item.original.kind, front: '', back: '', include: true });
    item.choice = 'polished';
    if (item.status === 'unchanged') item.status = 'changed';
    touch();
  };
  const editAnyway = () => {
    item.cards = [{ ...item.original, id: draftId(), include: true }];
    item.status = 'changed';
    item.reason = 'Edited by you.';
    item.choice = 'polished';
    touch();
  };
  const polishable = item.status === 'changed' || item.status === 'split';
  const split = item.cards.length > 1;

  return (
    <section id={`polish-${item.key}`} className={`polish-item choice-${item.choice}`}>
      <div className="polish-side">
        <div className="polish-side-label">
          <span>{item.deckName}</span>
          <ChoiceButtons item={item} polishable={polishable} setChoice={setChoice} />
        </div>
        <OriginalCard item={item} />
      </div>

      <div className="polish-arrow" aria-hidden="true">
        →
      </div>

      <div className="polish-side">
        <div className="polish-side-label">
          <span className={`polish-badge status-${item.status}`}>
            {item.status === 'split' ? `Split into ${item.cards.length} cards` : STATUS_LABEL[item.status]}
          </span>
          {item.issues.includes('vague') && <span className="polish-badge issue">Too vague</span>}
          {item.issues.includes('duplicate') && item.status !== 'duplicate' && <span className="polish-badge issue">Overlaps another card</span>}
          {item.reason && <span className="muted polish-reason">{item.reason}</span>}
        </div>

        {(item.issueNote || other) && (
          <div className="polish-issue">
            {item.issueNote}
            {other && (
              <>
                {item.issueNote && ' '}
                {item.status === 'duplicate' ? 'Same question as ' : 'Overlaps with '}
                <button className="link" onClick={() => jumpTo(other.key)}>
                  {quote(other)}
                </button>
                {item.status === 'duplicate' && item.choice === 'drop' && '; this copy is left out and that one is kept.'}
              </>
            )}
          </div>
        )}
        {repeatedBy.length > 0 && (
          <div className="polish-issue">
            {repeatedBy.length === 1 ? 'A duplicate of this card' : `${repeatedBy.length} duplicates of this card`} (
            {repeatedBy.map((d, i) => (
              <span key={d.key}>
                {i > 0 && ', '}
                <button className="link" onClick={() => jumpTo(d.key)}>
                  {quote(d)}
                </button>
              </span>
            ))}
            ) {repeatedBy.every((d) => d.choice === 'drop') ? 'is left out; this one is kept.' : 'was found.'}
          </div>
        )}

        {item.status === 'unchanged' && (
          <div className="polish-note">
            No changes; the original is copied over.{' '}
            <button className="link" onClick={editAnyway}>
              Edit anyway
            </button>
          </div>
        )}
        {item.status === 'duplicate' && item.choice === 'drop' && (
          <div className="polish-note">Left out as a duplicate. Choose Keep original on the left to keep it anyway.</div>
        )}
        {item.status === 'occlusion' && <div className="polish-note">Image occlusion and smart cards aren't polished; this one is copied as is.</div>}
        {(item.status === 'error' || item.status === 'pending') && (
          <div className="polish-note">
            {item.error ?? 'This card was not polished.'} The original is copied over unless you retry.
          </div>
        )}

        {polishable && (
          <div className={`${split ? 'split-group' : ''} ${item.choice !== 'polished' ? 'dimmed' : ''}`}>
            {split && <div className="split-label">From the card on the left:</div>}
            {item.cards.map((d, i) => (
              <DraftEditor
                key={d.id}
                draft={d}
                label={split ? `Card ${i + 1} of ${item.cards.length}` : 'Polished card'}
                touch={touch}
                showProblems={showProblems && item.choice === 'polished'}
                onRemove={() => {
                  item.cards = item.cards.filter((x) => x !== d);
                  if (!item.cards.length) item.choice = 'drop';
                  else if (item.cards.length === 1 && item.status === 'split') item.status = 'changed';
                  touch();
                }}
              />
            ))}
            <button className="link" onClick={addCard}>
              + Add a card
            </button>
          </div>
        )}

        {item.added.map((d) => (
          <DraftEditor
            key={d.id}
            draft={d}
            label="New card · fills a gap"
            added
            touch={touch}
            showProblems={showProblems && d.include}
          />
        ))}
      </div>
    </section>
  );
}

function ChoiceButtons({
  item,
  polishable,
  setChoice,
}: {
  item: PolishItem;
  polishable: boolean;
  setChoice: (c: PolishItem['choice']) => void;
}) {
  const options: { key: PolishItem['choice']; label: string }[] = [
    ...(polishable ? [{ key: 'polished' as const, label: 'Use polished' }] : []),
    { key: 'original', label: 'Keep original' },
    { key: 'drop', label: 'Leave out' },
  ];
  return (
    <div className="seg" role="radiogroup" aria-label="What to put in the polished deck">
      {options.map((o) => (
        <button key={o.key} role="radio" aria-checked={item.choice === o.key} className={item.choice === o.key ? 'active' : ''} onClick={() => setChoice(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Shows cloze deletions as highlighted [answer] text. */
function showCloze(html: string): string {
  return html.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (_, n: string, answer: string) => `<span class="cloze-mark" title="c${n}">${answer}</span>`);
}

const FIELD_LABELS: Record<DraftKind, [string, string]> = {
  basic: ['Front', 'Back'],
  reversed: ['Front', 'Back'],
  cloze: ['Text', 'Back Extra'],
};

const KIND_LABEL: Record<DraftKind, string> = { basic: 'Basic', reversed: 'Basic + reversed', cloze: 'Cloze' };

function OriginalCard({ item }: { item: PolishItem }) {
  const o = item.original;
  if (item.status === 'occlusion') {
    return <div className="original-card" dangerouslySetInnerHTML={{ __html: renderMedia(item.card?.front ?? o.front) }} />;
  }
  const [a, b] = FIELD_LABELS[o.kind];
  return (
    <div className="original-card">
      <div className="muted polish-kind">{KIND_LABEL[o.kind]}</div>
      <div className="field-label">{a}</div>
      <div dangerouslySetInnerHTML={{ __html: renderMedia(showCloze(o.front)) }} />
      {o.back.trim() && (
        <>
          <div className="field-label" style={{ marginTop: 8 }}>
            {b}
          </div>
          <div dangerouslySetInnerHTML={{ __html: renderMedia(o.back) }} />
        </>
      )}
    </div>
  );
}

function DraftEditor({
  draft,
  label,
  added,
  touch,
  showProblems,
  onRemove,
}: {
  draft: DraftCard;
  label: string;
  added?: boolean;
  touch: () => void;
  showProblems: boolean;
  onRemove?: () => void;
}) {
  const problem = showProblems ? draftProblem(draft) : null;
  const [a, b] = FIELD_LABELS[draft.kind];
  return (
    <div className={`draft-card ${added ? 'added' : ''} ${problem ? 'invalid' : ''} ${added && !draft.include ? 'dimmed' : ''}`}>
      <div className="draft-head">
        {added ? (
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={draft.include}
              onChange={(e) => {
                draft.include = e.target.checked;
                touch();
              }}
            />
            <b>{label}</b>
          </label>
        ) : (
          <b>{label}</b>
        )}
        <span className="spacer" />
        <select
          value={draft.kind}
          aria-label="Card type"
          onChange={(e) => {
            draft.kind = e.target.value as DraftKind;
            touch();
          }}
        >
          {(Object.keys(KIND_LABEL) as DraftKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        {onRemove && (
          <button className="icon-button" onClick={onRemove} aria-label="Remove this card" title="Remove this card">
            ✕
          </button>
        )}
      </div>
      {added && draft.reason && <div className="muted polish-reason">{draft.reason}</div>}
      <div className="field-label">{a}</div>
      <EditableHtml value={draft.front} label={a} onChange={(v) => (draft.front = v)} onBlur={touch} />
      <div className="field-label" style={{ marginTop: 6 }}>
        {b}
      </div>
      <EditableHtml value={draft.back} label={b} onChange={(v) => (draft.back = v)} onBlur={touch} />
      {problem && <div className="polish-error">{problem}</div>}
    </div>
  );
}

/** A small rich-text field; the full editor would be heavy with hundreds of cards on screen. */
function EditableHtml({ value, label, onChange, onBlur }: { value: string; label: string; onChange: (v: string) => void; onBlur: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.innerHTML = toEditorHtml(value);
  }, [value]);
  return (
    <div
      ref={ref}
      className="rich-field polish-field"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      onInput={(e) => onChange(fromEditorHtml(e.currentTarget.innerHTML))}
      onBlur={onBlur}
    />
  );
}
