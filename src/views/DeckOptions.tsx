// Anki's deck options screen: a preset chooser plus the preset's settings,
// grouped the way Anki groups them, with "This deck" / "Today only" limit
// overrides and a deck-specific desired retention.

import { useMemo, useState, type ReactNode } from 'react';
import type { View } from '../App';
import { useCollection } from '../lib/collection';
import { isWithin } from '../lib/deckTree';
import { FSRS, FSRS6_DEFAULT_PARAMETERS, FSRS7_DEFAULT_PARAMETERS } from '../lib/fsrs';
import { formatSteps, parseParams, parseSteps } from '../lib/steps';
import { today } from '../lib/time';
import {
  DEFAULT_PRESET,
  DEFAULT_PRESET_ID,
  type Deck,
  type Id,
  type NewGatherPriority,
  type NewSortOrder,
  type Preset,
  type ReviewMix,
  type ReviewOrder,
} from '../lib/types';
import { ConfirmDialog, PromptDialog, TrashIcon } from './Modal';
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

type LimitScope = 'preset' | 'deck' | 'today';

type DialogState =
  | { kind: 'addPreset'; clone: boolean }
  | { kind: 'renamePreset' }
  | { kind: 'removePreset' }
  | { kind: 'deleteDeck' }
  | null;

/** Deck settings: name, the options preset and per-deck overrides, delete.
 * Shown as a page, or inside the deck list's settings dialog (`onClose`). */
export function DeckOptions({ deckId, go, onClose }: { deckId: Id; go: (v: View) => void; onClose?: () => void }) {
  const col = useCollection();
  const deck = col.decks.get(deckId);
  const t = today();
  const [name, setName] = useState(deck?.name ?? '');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [presetId, setPresetId] = useState<Id>(deck?.configId ?? DEFAULT_PRESET_ID);
  // Drafts of every preset touched in this session, as Anki keeps them until Save.
  const [drafts, setDrafts] = useState<Record<Id, Preset>>({});
  const [newPresets, setNewPresets] = useState<Id[]>([]);
  const preset = drafts[presetId] ?? col.presets.get(presetId) ?? col.presetFor(deck);
  const [learn, setLearn] = useState<Record<Id, string>>({});
  const [relearn, setRelearn] = useState<Record<Id, string>>({});
  const [paramsText, setParamsText] = useState<Record<Id, string>>({});
  const [deckDraft, setDeckDraft] = useState<Deck | undefined>(deck);
  const [scope, setScope] = useState<LimitScope>(() =>
    deck?.newLimitToday?.day === t || deck?.reviewLimitToday?.day === t ? 'today' : deck?.newLimit != null || deck?.reviewLimit != null ? 'deck' : 'preset',
  );
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const subdecks = useMemo(() => (deck ? col.deckList().filter((d) => d.id !== deck.id && isWithin(d.name, deck.name)) : []), [col, deck]);

  if (!deck || !deckDraft) return <div className="panel">Deck not found.</div>;

  const update = (patch: Partial<Preset>) => setDrafts((d) => ({ ...d, [presetId]: { ...preset, ...patch } }));
  const learnText = learn[presetId] ?? formatSteps(preset.learnSteps);
  const relearnText = relearn[presetId] ?? formatSteps(preset.relearnSteps);
  const pText = paramsText[presetId] ?? preset.params.join(', ');
  const parsedParams = parseParams(pText);
  let modelLabel = '';
  let paramError = '';
  try {
    const f = new FSRS(parsedParams);
    modelLabel = (f.version === 'fsrs7' ? 'FSRS-7' : 'FSRS-6') + (parsedParams.length ? '' : ' defaults');
  } catch (e) {
    paramError = (e as Error).message;
  }

  const usersOf = (id: Id) => col.decksUsingPreset(id).filter((d) => d.id !== deck.id).length + (presetId === id ? 1 : 0);
  const presetOptions = [...col.presetList().map((p) => drafts[p.id] ?? p), ...newPresets.filter((id) => !col.presets.has(id)).map((id) => drafts[id])];

  const addPreset = (clone: boolean, name: string) => {
    const id = Date.now();
    // Anki's "Add Preset" starts from the stock defaults; "Clone" copies.
    const fresh: Preset = { ...(clone ? preset : DEFAULT_PRESET), id, name };
    setDrafts((d) => ({ ...d, [id]: fresh }));
    setNewPresets((n) => [...n, id]);
    setPresetId(id);
    setDialog(null);
  };

  const removePreset = async () => {
    if (col.presets.has(presetId)) await col.deletePreset(presetId);
    setNewPresets((n) => n.filter((id) => id !== presetId));
    setPresetId(DEFAULT_PRESET_ID);
    setDialog(null);
  };

  const deleteDeck = async () => {
    await col.deleteDeck(deck.id);
    setDialog(null);
    if (onClose) onClose();
    else go({ name: 'decks' });
  };

  const presetUsers = col.decksUsingPreset(presetId).length;
  const deckCardCount = col.subtreeCards(deck.id).length;
  const subdeckCount = subdecks.length;

  /** Limits shown in the Daily Limits section for the current scope. */
  const limitValue = (kind: 'new' | 'review'): number | '' => {
    if (scope === 'preset') return kind === 'new' ? preset.newPerDay : preset.reviewsPerDay;
    if (scope === 'deck') return (kind === 'new' ? deckDraft.newLimit : deckDraft.reviewLimit) ?? '';
    const l = kind === 'new' ? deckDraft.newLimitToday : deckDraft.reviewLimitToday;
    return l && l.day === t ? l.limit : '';
  };
  const setLimit = (kind: 'new' | 'review', raw: string) => {
    const v = raw === '' ? null : Math.max(0, Math.round(Number(raw)));
    if (scope === 'preset') return update(kind === 'new' ? { newPerDay: v ?? 0 } : { reviewsPerDay: v ?? 0 });
    if (scope === 'deck') return setDeckDraft({ ...deckDraft, ...(kind === 'new' ? { newLimit: v } : { reviewLimit: v }) });
    const dl = v === null ? null : { limit: v, day: t };
    setDeckDraft({ ...deckDraft, ...(kind === 'new' ? { newLimitToday: dl } : { reviewLimitToday: dl }) });
  };

  const save = async (toSubdecks: boolean) => {
    setMsg(null);
    // validate every edited preset
    const finalPresets: Preset[] = [];
    for (const id of Object.keys(drafts).map(Number)) {
      const p = { ...drafts[id] };
      const l = parseSteps(learn[id] ?? formatSteps(p.learnSteps));
      const r = parseSteps(relearn[id] ?? formatSteps(p.relearnSteps));
      if (!l || !r) return setMsg({ text: `Steps in “${p.name}” must look like "1m 10m 1d".`, error: true });
      p.learnSteps = l;
      p.relearnSteps = r;
      if (paramsText[id] !== undefined) p.params = parseParams(paramsText[id]);
      try {
        new FSRS(p.params);
      } catch (e) {
        return setMsg({ text: `“${p.name}”: ${(e as Error).message}`, error: true });
      }
      if (!(p.desiredRetention >= 0.7 && p.desiredRetention <= 0.99)) {
        return setMsg({ text: 'Desired retention must be between 0.70 and 0.99.', error: true });
      }
      finalPresets.push(p);
    }
    if (deckDraft.desiredRetention != null && !(deckDraft.desiredRetention >= 0.7 && deckDraft.desiredRetention <= 0.99)) {
      return setMsg({ text: "This deck's desired retention must be between 0.70 and 0.99.", error: true });
    }
    try {
      // Renaming moves subdecks along, as in Anki; refuse clashes before saving anything.
      const newName = name.split('::').map((s) => s.trim()).filter(Boolean).join('::');
      if (!newName) return setMsg({ text: "The deck name can't be empty.", error: true });
      if (newName !== deck.name) await col.renameDeck(deck.id, newName);
      const renamed = col.decks.get(deck.id)!;
      const paramsChanged = new Set<Id>();
      for (const p of finalPresets) {
        const before = col.presets.get(p.id);
        if (!before || before.params.join() !== p.params.join() || before.relearnSteps.length !== p.relearnSteps.length) paramsChanged.add(p.id);
        await col.savePreset(p, false);
      }
      const targets = [deckDraft, ...(toSubdecks ? subdecks.map((s) => col.decks.get(s.id) ?? s) : [])];
      for (const d of targets) {
        await col.updateDeck(d.id === deck.id ? { ...deckDraft, name: renamed.name, configId: presetId } : { ...d, configId: presetId });
      }
      // Like Anki, changing parameters recomputes memory states.
      const affected = new Set(
        [...col.cards.values()].filter((c) => paramsChanged.has(col.presetFor(c.deckId).id)).map((c) => c.id),
      );
      const n = affected.size ? await col.recomputeMemoryStates(affected) : 0;
      setDrafts({});
      setNewPresets([]);
      setLearn({});
      setRelearn({});
      setParamsText({});
      setMsg({ text: `Saved${toSubdecks ? ` to ${targets.length} decks` : ''}.${n ? ` Recomputed memory states for ${n} card(s).` : ''}` });
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
  };

  // Training data for Optimize: cards in decks using this preset.
  const presetDecks = new Set(
    [...col.decks.values()].filter((d) => (d.id === deck.id ? presetId : (d.configId ?? DEFAULT_PRESET_ID)) === presetId).map((d) => d.id),
  );
  const presetCardIds = new Set([...col.cards.values()].filter((c) => presetDecks.has(c.deckId)).map((c) => c.id));
  const presetRevlog = col.revlog.filter((r) => presetCardIds.has(r.cardId));

  return (
    <div
      style={{ display: 'grid', gap: 16 }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          save(false);
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
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: 1, minWidth: 200 }}>
            Deck name
            <span className="hint">Use :: to make it a subdeck, e.g. Spanish::Verbs</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="link" onClick={() => go({ name: 'browse', query: `deck:"${deck.name}"` })}>
            Edit cards
          </button>
          <button
            className="icon-button danger"
            onClick={() => setDialog({ kind: 'deleteDeck' })}
            aria-label={`Delete deck ${deck.name}`}
            title="Delete deck"
          >
            <TrashIcon />
          </button>
        </div>
        <div className="row">
          <select value={presetId} onChange={(e) => setPresetId(Number(e.target.value))} style={{ width: 'auto', minWidth: 220 }} aria-label="Preset">
            {presetOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (used by {usersOf(p.id)} deck{usersOf(p.id) === 1 ? '' : 's'})
              </option>
            ))}
          </select>
          <button onClick={() => setDialog({ kind: 'addPreset', clone: false })}>Add preset</button>
          <button onClick={() => setDialog({ kind: 'addPreset', clone: true })}>Clone</button>
          <button onClick={() => setDialog({ kind: 'renamePreset' })}>Rename preset</button>
          <button className="danger" onClick={() => setDialog({ kind: 'removePreset' })} disabled={presetId === DEFAULT_PRESET_ID}>
            Remove
          </button>
          <span className="spacer" />
          <button className="primary" onClick={() => save(false)}>
            Save <span style={{ opacity: 0.7, fontSize: 12 }}>(Ctrl+Enter)</span>
          </button>
          {subdecks.length > 0 && <button onClick={() => save(true)}>Save to all subdecks</button>}
        </div>
        {msg && <span style={{ color: msg.error ? 'var(--again)' : 'var(--text-2)' }}>{msg.text}</span>}
      </div>

      <Section title="Daily Limits">
        <div className="row" role="tablist" aria-label="Limit scope">
          {(
            [
              ['preset', 'Preset'],
              ['deck', 'This deck'],
              ['today', 'Today only'],
            ] as [LimitScope, string][]
          ).map(([s, l]) => (
            <button key={s} role="tab" aria-selected={scope === s} className={scope === s ? 'primary' : ''} onClick={() => setScope(s)}>
              {l}
            </button>
          ))}
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {scope === 'preset'
            ? 'Limits for every deck using this preset.'
            : scope === 'deck'
              ? 'Limits for this deck only, overriding the preset. Leave empty to use the preset.'
              : "Limits for this deck for today only. Leave empty to use the deck's usual limits."}{' '}
          Studying a deck also applies its subdecks' own limits.
        </p>
        <div className="grid-2">
          <label className="field">
            New cards/day
            <input type="number" min={0} value={limitValue('new')} onChange={(e) => setLimit('new', e.target.value)} />
          </label>
          <label className="field">
            Maximum reviews/day
            <input type="number" min={0} value={limitValue('review')} onChange={(e) => setLimit('review', e.target.value)} />
          </label>
        </div>
      </Section>

      <Section title="New Cards">
        <div className="grid-2">
          <label className="field">
            Learning steps
            <span className="hint">e.g. 1m 10m</span>
            <input type="text" value={learnText} onChange={(e) => setLearn((s) => ({ ...s, [presetId]: e.target.value }))} />
          </label>
          <Choice
            label="Insertion order"
            value={preset.newInsertOrder}
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
            <input type="text" value={relearnText} onChange={(e) => setRelearn((s) => ({ ...s, [presetId]: e.target.value }))} />
          </label>
          <Num label="Leech threshold" hint="Lapses before a card becomes a leech" value={preset.leechThreshold} onChange={(v) => update({ leechThreshold: Math.round(v) })} />
          <Choice
            label="Leech action"
            value={preset.leechAction}
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
          <Choice label="New card gather order" value={preset.newGatherPriority} options={GATHER} onChange={(v) => update({ newGatherPriority: v })} />
          <Choice label="New card sort order" value={preset.newSortOrder} options={NEW_SORT} onChange={(v) => update({ newSortOrder: v })} />
          <Choice label="New/review order" value={preset.newMix} options={MIX} onChange={(v) => update({ newMix: v })} />
          <Choice label="Interday learning/review order" value={preset.interdayLearningMix} options={MIX} onChange={(v) => update({ interdayLearningMix: v })} />
          <Choice label="Review sort order" value={preset.reviewOrder} options={REVIEW_ORDER} onChange={(v) => update({ reviewOrder: v })} />
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          As in Anki, display order comes from the preset of the deck you click to study.
        </p>
      </Section>

      <Section title="FSRS">
        <div className="grid-2">
          <Num
            label="Desired retention"
            hint="Recall probability to aim for when a card is due. Higher means more reviews."
            value={preset.desiredRetention}
            step={0.01}
            min={0.7}
            onChange={(v) => update({ desiredRetention: v })}
          />
          <label className="field">
            Desired retention for this deck only
            <span className="hint">Leave empty to use the preset's value.</span>
            <input
              type="number"
              step={0.01}
              min={0.7}
              max={0.99}
              value={deckDraft.desiredRetention ?? ''}
              onChange={(e) => setDeckDraft({ ...deckDraft, desiredRetention: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </label>
        </div>
        <label className="field">
          FSRS parameters {modelLabel && <span className="hint">Model: {modelLabel}</span>}
          <span className="hint">Leave empty for FSRS-7 defaults. 34 values = FSRS-7; 17/19/21 values (from Anki 23.10–25.09) = FSRS-6.</span>
          <textarea
            value={pText}
            onChange={(e) => setParamsText((s) => ({ ...s, [presetId]: e.target.value }))}
            style={{ minHeight: 70, fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
            placeholder={FSRS7_DEFAULT_PARAMETERS.join(', ')}
          />
          {paramError && <span style={{ color: 'var(--again)' }}>{paramError}</span>}
        </label>
        <div className="row">
          <button onClick={() => setParamsText((s) => ({ ...s, [presetId]: '' }))}>Use FSRS-7 defaults</button>
          <button onClick={() => setParamsText((s) => ({ ...s, [presetId]: FSRS6_DEFAULT_PARAMETERS.join(', ') }))}>Use FSRS-6 defaults</button>
        </div>
        <Optimize
          params={paramError ? null : parsedParams}
          relearnSteps={parseSteps(relearnText)?.length ?? preset.relearnSteps.length}
          revlog={presetRevlog}
          presetName={preset.name}
          onParams={(p) => setParamsText((s) => ({ ...s, [presetId]: p.map((v) => +v.toFixed(4)).join(', ') }))}
        />
      </Section>

      <Section title="Burying">
        <Check label="Bury new siblings" hint="Other new cards of the same note wait until tomorrow." checked={preset.buryNew} onChange={(v) => update({ buryNew: v })} />
        <Check label="Bury review siblings" hint="Other review cards of the same note wait until tomorrow." checked={preset.buryReviews} onChange={(v) => update({ buryReviews: v })} />
        <Check
          label="Bury interday learning siblings"
          hint="Other interday learning cards of the same note wait until tomorrow."
          checked={preset.buryInterdayLearning}
          onChange={(v) => update({ buryInterdayLearning: v })}
        />
      </Section>

      <Section title="Audio">
        <Check label="Don't play audio automatically" checked={!preset.autoplay} onChange={(v) => update({ autoplay: !v })} />
      </Section>

      <Section title="Timers">
        <div className="grid-2">
          <Num label="Maximum answer seconds" hint="Longer answers are recorded as this many seconds." value={preset.capAnswerTimeSecs} min={1} onChange={(v) => update({ capAnswerTimeSecs: Math.round(v) })} />
        </div>
        <Check label="Show answer timer" checked={preset.showTimer} onChange={(v) => update({ showTimer: v })} />
      </Section>

      <Section title="Advanced">
        <div className="grid-2">
          <Num label="Maximum interval (days)" value={preset.maxInterval} min={1} onChange={(v) => update({ maxInterval: Math.max(1, Math.round(v)) })} />
        </div>
      </Section>

      {dialog?.kind === 'addPreset' && (
        <PromptDialog
          title={dialog.clone ? 'Clone preset' : 'Add preset'}
          label="Preset name"
          initial={dialog.clone ? `${preset.name} copy` : ''}
          submitLabel={dialog.clone ? 'Clone' : 'Add'}
          onSubmit={(n) => addPreset(dialog.clone, n)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'renamePreset' && (
        <PromptDialog
          title="Rename preset"
          label="Preset name"
          initial={preset.name}
          submitLabel="Rename"
          onSubmit={(n) => {
            update({ name: n });
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'removePreset' && (
        <ConfirmDialog
          title="Remove preset"
          message={`Remove “${preset.name}”?${presetUsers ? ` The ${presetUsers} deck${presetUsers === 1 ? '' : 's'} using it will switch to Default.` : ''}`}
          confirmLabel="Remove"
          danger
          onConfirm={removePreset}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'deleteDeck' && (
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
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
