// A deck's settings: the everyday ones (daily limits or a due date, desired
// retention) up front, and Anki's other options, grouped the way Anki groups
// them, behind Advanced. Every deck has its own; presets stay out of sight.

import { useMemo, useState, type ReactNode } from 'react';
import type { View } from '../App';
import { useCollection } from '../lib/collection';
import { baseName, isWithin } from '../lib/deckTree';
import { FSRS, FSRS6_DEFAULT_PARAMETERS, FSRS7_DEFAULT_PARAMETERS } from '../lib/fsrs';
import { formatSteps, parseParams, parseSteps } from '../lib/steps';
import { today } from '../lib/time';
import {
  DEFAULT_PRESET_ID,
  type Id,
  type NewGatherPriority,
  type NewSortOrder,
  type Preset,
  type ReviewMix,
  type ReviewOrder,
} from '../lib/types';
import { EmojiButton } from './ClassDialog';
import { draftFromPlan, DuePlanFields, planFromDraft, type DueDraft } from './DuePlanFields';
import { ConfirmDialog, TrashIcon } from './Modal';
import { Optimize } from './Optimize';

const GATHER: [NewGatherPriority, string][] = [
  ['deck', 'Deck'],
  ['deckThenRandomNotes', 'Deck, then random notes'],
  ['lowestPosition', 'Ascending position'],
  ['highestPosition', 'Descending position'],
  ['randomNotes', 'Random notes'],
  ['randomCards', 'Random cards'],
];
const NEW_SORT: [NewSortOrder, string][] = [
  ['template', 'Card type, then order gathered'],
  ['noSort', 'Order gathered'],
  ['templateThenRandom', 'Card type, then random'],
  ['randomNoteThenTemplate', 'Random note, then card type'],
  ['randomCard', 'Random'],
];
const MIX: [ReviewMix, string][] = [
  ['mixWithReviews', 'Mix with reviews'],
  ['afterReviews', 'Show after reviews'],
  ['beforeReviews', 'Show before reviews'],
];
const REVIEW_ORDER: [ReviewOrder, string][] = [
  ['day', 'Due date, then random'],
  ['dayThenDeck', 'Due date, then deck'],
  ['deckThenDay', 'Deck, then due date'],
  ['intervalsAscending', 'Ascending intervals'],
  ['intervalsDescending', 'Descending intervals'],
  ['easeAscending', 'Ascending ease'],
  ['easeDescending', 'Descending ease'],
  ['retrievabilityAscending', 'Ascending retrievability'],
  ['retrievabilityDescending', 'Descending retrievability'],
  ['relativeOverdueness', 'Relative overdueness'],
  ['random', 'Random'],
  ['added', 'Order added'],
  ['reverseAdded', 'Reverse order added'],
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>{title}</h2>
      {children}
    </section>
  );
}

function Num({ label, hint, value, onChange, step = 1, min = 0 }: { label: string; hint?: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  return (
    <label className="field">
      {label}
      {hint && <span className="hint">{hint}</span>}
      <input type="number" step={step} min={min} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Check({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 4 }} />
      <span>
        {label}
        {hint && (
          <span className="muted" style={{ display: 'block', fontSize: 12 }}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

/** Deck settings, each deck its own: name, its daily limits or due date and
 * desired retention up front, everything else behind Advanced. Shown as a
 * page, or inside the sidebar's settings dialog (`onClose`).
 *
 * The scheduler still reads settings from a preset. A deck sharing one (the
 * Default, or an imported Anki preset) gets its own copy when its settings
 * are saved, so changing one deck never changes another. */
export function DeckOptions({ deckId, go, onClose }: { deckId: Id; go: (v: View) => void; onClose?: () => void }) {
  const col = useCollection();
  const deck = col.decks.get(deckId);
  const t = today();
  const [name, setName] = useState(deck?.name ?? '');
  const [deleting, setDeleting] = useState(false);
  // what the deck runs on now: its preset, with any old per-deck overrides folded in
  const [draft, setDraft] = useState<Preset | undefined>(() => {
    if (!deck) return undefined;
    const p = col.presetFor(deck);
    return {
      ...p,
      newPerDay: deck.newLimit ?? p.newPerDay,
      reviewsPerDay: deck.reviewLimit ?? p.reviewsPerDay,
      desiredRetention: deck.desiredRetention ?? p.desiredRetention,
    };
  });
  const [learnText, setLearnText] = useState(() => formatSteps(draft?.learnSteps ?? []));
  const [relearnText, setRelearnText] = useState(() => formatSteps(draft?.relearnSteps ?? []));
  const [pText, setPText] = useState(() => draft?.params.join(', ') ?? '');
  const [due, setDue] = useState<DueDraft>(() => draftFromPlan(deck?.dueDate));
  const [advanced, setAdvanced] = useState(false);
  /** a class's emoji (classes are the top-level decks) */
  const [icon, setIcon] = useState<string | undefined>(deck?.icon);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const subdecks = useMemo(() => (deck ? col.deckList().filter((d) => d.id !== deck.id && isWithin(d.name, deck.name)) : []), [col, deck]);

  if (!deck || !draft) return <div className="panel">Deck not found.</div>;

  const update = (patch: Partial<Preset>) => setDraft({ ...draft, ...patch });
  const parsedParams = parseParams(pText);
  let modelLabel = '';
  let paramError = '';
  try {
    const f = new FSRS(parsedParams);
    modelLabel = (f.version === 'fsrs7' ? 'FSRS-7' : 'FSRS-6') + (parsedParams.length ? '' : ' defaults');
  } catch (e) {
    paramError = (e as Error).message;
  }

  const deleteDeck = async () => {
    await col.deleteDeck(deck.id);
    setDeleting(false);
    if (onClose) onClose();
    else go({ name: 'decks' });
  };

  const isClass = !deck.name.includes('::');
  const subtree = col.subtreeCards(deck.id);
  const deckCardCount = subtree.length;
  // what a due date shares out today: unseen new cards plus today's already studied
  const newAtDayStart = subtree.filter((c) => c.queue === 0).length + (deck.today.day === t ? deck.today.newDone : 0);
  const subdeckCount = subdecks.length;
  // Optimize trains on this deck's own review history
  const subtreeIds = new Set(subtree.map((c) => c.id));
  const deckRevlog = col.revlog.filter((r) => subtreeIds.has(r.cardId));

  const save = async () => {
    setMsg(null);
    const learnSteps = parseSteps(learnText);
    const relearnSteps = parseSteps(relearnText);
    if (!learnSteps || !relearnSteps) return setMsg({ text: 'Learning and relearning steps must look like "1m 10m 1d".', error: true });
    const params = parseParams(pText);
    try {
      new FSRS(params);
    } catch (e) {
      return setMsg({ text: (e as Error).message, error: true });
    }
    if (!(draft.desiredRetention >= 0.7 && draft.desiredRetention <= 0.99)) {
      return setMsg({ text: 'Desired retention must be between 0.70 and 0.99.', error: true });
    }
    const plan = planFromDraft(due, deck.dueDate);
    if (typeof plan === 'string') return setMsg({ text: plan, error: true });
    try {
      // Renaming moves subdecks along, as in Anki; refuse clashes before saving anything.
      const newName = name.split('::').map((s) => s.trim()).filter(Boolean).join('::');
      if (!newName) return setMsg({ text: "The deck name can't be empty.", error: true });
      if (newName !== deck.name) await col.renameDeck(deck.id, newName);
      const current = col.decks.get(deck.id)!;
      const before = col.presetFor(current);
      // a preset other decks use (or the Default new decks start on) is copied, not changed
      const shared = before.id === DEFAULT_PRESET_ID || col.decksUsingPreset(before.id).some((d) => d.id !== deck.id);
      const own: Preset = { ...draft, learnSteps, relearnSteps, params, id: shared ? Date.now() : before.id, name: baseName(current.name) };
      await col.savePreset(own, false);
      // the deck's settings now all live in its own preset, so the old overrides go
      await col.updateDeck({
        ...current,
        configId: own.id,
        dueDate: plan,
        ...(isClass ? { icon } : {}),
        newLimit: null,
        reviewLimit: null,
        newLimitToday: null,
        reviewLimitToday: null,
        desiredRetention: null,
      });
      // Like Anki, changing parameters recomputes memory states.
      const paramsChanged = before.params.join() !== params.join() || before.relearnSteps.length !== relearnSteps.length;
      const n = paramsChanged ? await col.recomputeMemoryStates(new Set(col.subtreeCards(deck.id).filter((c) => c.deckId === deck.id).map((c) => c.id))) : 0;
      setMsg({ text: `Saved.${n ? ` Recomputed memory states for ${n} card(s).` : ''}` });
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
  };

  return (
    <div
      style={{ display: 'grid', gap: 16 }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void save();
        }
      }}
    >
      <div className="panel" style={{ display: 'grid', gap: 12, position: 'sticky', top: onClose ? -16 : 49, zIndex: 3 }}>
        {!onClose && (
          <div className="row">
            <button className="link" onClick={() => go({ name: 'decks' })}>
              ← Home
            </button>
            <h1 style={{ margin: 0 }}>Options for {deck.name}</h1>
          </div>
        )}
        <div className={`deck-options-bar ${isClass ? 'with-icon' : ''}`}>
          {isClass && <EmojiButton value={icon} onChange={setIcon} />}
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} aria-label="Deck name" placeholder="Deck name" />
          <button className="icon-button danger" onClick={() => setDeleting(true)} aria-label={`Delete deck ${deck.name}`} title="Delete deck">
            <TrashIcon />
          </button>
          <button className="primary" onClick={() => void save()}>
            Save <span style={{ opacity: 0.7, fontSize: 12 }}>(Ctrl+Enter)</span>
          </button>
        </div>
        {msg && <span style={{ color: msg.error ? 'var(--again)' : 'var(--text-2)' }}>{msg.text}</span>}
      </div>

      <Section title="Daily Limits">
        <DuePlanFields draft={due} onChange={setDue} newCards={newAtDayStart} />
        {due.on ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            While the due date is on, it sets the new cards each day and every review due is shown.
          </p>
        ) : (
          <div className="grid-2">
            <Num label="New cards/day" value={draft.newPerDay} onChange={(v) => update({ newPerDay: Math.max(0, Math.round(v)) })} />
            <Num label="Maximum reviews/day" value={draft.reviewsPerDay} onChange={(v) => update({ reviewsPerDay: Math.max(0, Math.round(v)) })} />
          </div>
        )}
        <div className="grid-2">
          <Num
            label="Desired retention"
            hint="Recall probability to aim for when a card is due (0.70–0.99). Higher means more reviews."
            value={draft.desiredRetention}
            step={0.01}
            min={0.7}
            onChange={(v) => update({ desiredRetention: v })}
          />
        </div>
      </Section>

      <button className="advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
        <span aria-hidden="true">{advanced ? '▾' : '▸'}</span> Advanced
        <span className="muted"> · steps, order, FSRS, burying, timers</span>
      </button>

      {advanced && (
        <>
          <Section title="New Cards">
            <div className="grid-2">
              <label className="field">
                Learning steps
                <span className="hint">e.g. 1m 10m</span>
                <input type="text" value={learnText} onChange={(e) => setLearnText(e.target.value)} />
              </label>
              <Choice
                label="Insertion order"
                value={draft.newInsertOrder}
                options={[
                  ['due', 'Sequential (oldest cards first)'],
                  ['random', 'Random'],
                ]}
                onChange={(v) => update({ newInsertOrder: v })}
              />
            </div>
          </Section>

          <Section title="Lapses">
            <div className="grid-2">
              <label className="field">
                Relearning steps
                <span className="hint">e.g. 10m</span>
                <input type="text" value={relearnText} onChange={(e) => setRelearnText(e.target.value)} />
              </label>
              <Num label="Leech threshold" hint="Lapses before a card becomes a leech" value={draft.leechThreshold} onChange={(v) => update({ leechThreshold: Math.round(v) })} />
              <Choice
                label="Leech action"
                value={draft.leechAction}
                options={[
                  ['tag', 'Tag only'],
                  ['suspend', 'Suspend card'],
                ]}
                onChange={(v) => update({ leechAction: v })}
              />
            </div>
          </Section>

          <Section title="Display Order">
            <div className="grid-2">
              <Choice label="New card gather order" value={draft.newGatherPriority} options={GATHER} onChange={(v) => update({ newGatherPriority: v })} />
              <Choice label="New card sort order" value={draft.newSortOrder} options={NEW_SORT} onChange={(v) => update({ newSortOrder: v })} />
              <Choice label="New/review order" value={draft.newMix} options={MIX} onChange={(v) => update({ newMix: v })} />
              <Choice label="Interday learning/review order" value={draft.interdayLearningMix} options={MIX} onChange={(v) => update({ interdayLearningMix: v })} />
              <Choice label="Review sort order" value={draft.reviewOrder} options={REVIEW_ORDER} onChange={(v) => update({ reviewOrder: v })} />
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Display order comes from the deck you click to study.
            </p>
          </Section>

          <Section title="FSRS">
            <label className="field">
              FSRS parameters {modelLabel && <span className="hint">Model: {modelLabel}</span>}
              <span className="hint">Leave empty for FSRS-7 defaults. 34 values = FSRS-7; 17/19/21 values (from Anki 23.10–25.09) = FSRS-6.</span>
              <textarea
                value={pText}
                onChange={(e) => setPText(e.target.value)}
                style={{ minHeight: 70, fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
                placeholder={FSRS7_DEFAULT_PARAMETERS.join(', ')}
              />
              {paramError && <span style={{ color: 'var(--again)' }}>{paramError}</span>}
            </label>
            <div className="row">
              <button onClick={() => setPText('')}>Use FSRS-7 defaults</button>
              <button onClick={() => setPText(FSRS6_DEFAULT_PARAMETERS.join(', '))}>Use FSRS-6 defaults</button>
            </div>
            <Optimize
              params={paramError ? null : parsedParams}
              relearnSteps={parseSteps(relearnText)?.length ?? draft.relearnSteps.length}
              revlog={deckRevlog}
              presetName={baseName(deck.name)}
              onParams={(p) => setPText(p.map((v) => +v.toFixed(4)).join(', '))}
            />
          </Section>

          <Section title="Burying">
            <Check label="Bury new siblings" hint="Other new cards of the same note wait until tomorrow." checked={draft.buryNew} onChange={(v) => update({ buryNew: v })} />
            <Check label="Bury review siblings" hint="Other review cards of the same note wait until tomorrow." checked={draft.buryReviews} onChange={(v) => update({ buryReviews: v })} />
            <Check
              label="Bury interday learning siblings"
              hint="Other interday learning cards of the same note wait until tomorrow."
              checked={draft.buryInterdayLearning}
              onChange={(v) => update({ buryInterdayLearning: v })}
            />
          </Section>

          <Section title="Audio">
            <Check label="Don't play audio automatically" checked={!draft.autoplay} onChange={(v) => update({ autoplay: !v })} />
          </Section>

          <Section title="Timers">
            <div className="grid-2">
              <Num label="Maximum answer seconds" hint="Longer answers are recorded as this many seconds." value={draft.capAnswerTimeSecs} min={1} onChange={(v) => update({ capAnswerTimeSecs: Math.round(v) })} />
            </div>
            <Check label="Show answer timer" checked={draft.showTimer} onChange={(v) => update({ showTimer: v })} />
          </Section>

          <Section title="Intervals">
            <div className="grid-2">
              <Num label="Maximum interval (days)" value={draft.maxInterval} min={1} onChange={(v) => update({ maxInterval: Math.max(1, Math.round(v)) })} />
            </div>
          </Section>
        </>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete deck"
          message={
            <>
              Delete <strong>{deck.name}</strong>
              {subdeckCount ? ` and its ${subdeckCount} subdeck${subdeckCount === 1 ? '' : 's'}` : ''}, with{' '}
              {deckCardCount} card{deckCardCount === 1 ? '' : 's'} and their review history? This can't be undone.
            </>
          }
          confirmLabel="Delete deck"
          danger
          onConfirm={deleteDeck}
          onCancel={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
