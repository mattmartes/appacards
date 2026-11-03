// Browse → AI wordings: generate other wordings of card fronts for the
// selected cards or a deck.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCollection } from '../lib/collection';
import { depth } from '../lib/deckTree';
import { savedKey, saveKey, saveModel } from '../lib/polish';
import { MAX_WORDINGS, type Id } from '../lib/types';
import { canReword, estimateWordingCost, generateWordings, type WordingProgress } from '../lib/wordings';
import { KeyField, ModelPicker, useModels } from './AiPrefs';
import { Modal } from './Modal';

export function WordingsDialog({
  selected,
  initialDeckId,
  onClose,
  onDone,
}: {
  /** selected card ids; when there are some, they're the default scope */
  selected: Id[];
  initialDeckId?: Id;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const col = useCollection();
  const decks = col.deckList();
  const [scope, setScope] = useState<'selected' | 'deck'>(selected.length ? 'selected' : 'deck');
  const [deckId, setDeckId] = useState<Id | undefined>(initialDeckId ?? decks[0]?.id);
  const [count, setCount] = useState(MAX_WORDINGS);
  const [replace, setReplace] = useState(false);
  const [key, setKey] = useState(savedKey);
  const { models, initial } = useModels();
  const [chosenModel, setModel] = useState<string | null>(null);
  const model = chosenModel ?? initial;
  const [progress, setProgress] = useState<WordingProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const { cards, skipped, alreadyDone } = useMemo(() => {
    const pool = scope === 'selected' ? selected.map((id) => col.cards.get(id)).filter((c) => !!c) : deckId !== undefined ? col.subtreeCards(deckId) : [];
    const ok = pool.filter(canReword);
    const todo = replace ? ok : ok.filter((c) => !c.altFronts?.length);
    return { cards: todo, skipped: pool.length - ok.length, alreadyDone: ok.length - todo.length };
  }, [scope, selected, deckId, replace, col, col.version]);

  const info = models.find((m) => m.id === model);
  const cost = estimateWordingCost(cards, count, info?.pricing?.prompt, info?.pricing?.completion);

  const start = async () => {
    setError(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const n = await generateWordings(
        cards,
        count,
        key,
        {
          model,
          jsonMode: info?.supported_parameters?.includes('response_format'),
          maxTokens: info?.top_provider?.max_completion_tokens ?? undefined,
        },
        ctrl.signal,
        setProgress,
      );
      if (ctrl.signal.aborted) return;
      onDone(`Added ${count === 1 ? 'a wording' : `up to ${count} wordings`} to ${n} card${n === 1 ? '' : 's'}${n < cards.length ? ` (${cards.length - n} failed; run it again to retry them)` : ''}.`);
    } catch (e) {
      if (!ctrl.signal.aborted) setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  if (progress) {
    const pct = progress.total ? (progress.done / progress.total) * 100 : 0;
    return (
      <Modal
        title="Writing wordings…"
        onClose={() => abort.current?.abort()}
        footer={
          <button
            onClick={() => {
              abort.current?.abort();
              setProgress(null);
            }}
          >
            Stop
          </button>
        }
      >
        <p style={{ margin: 0 }}>
          {progress.done} of {progress.total} cards done. Finished cards are saved as you go.
        </p>
        <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${pct}%` }} />
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="AI wordings"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!cards.length || !key || !model} onClick={() => void start()}>
            Write wordings for {cards.length} card{cards.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        An AI writes other ways of asking each card's question, with the same answer. Each review shows the original or one of these at
        random, so you recall the answer rather than recognize the sentence. You can edit or remove them in each card's editor.
      </p>
      <div className="row" style={{ gap: 16 }}>
        <label className="row" style={{ gap: 6 }}>
          <input type="radio" checked={scope === 'selected'} disabled={!selected.length} onChange={() => setScope('selected')} />
          Selected cards ({selected.length})
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input type="radio" checked={scope === 'deck'} onChange={() => setScope('deck')} />
          A deck and its subdecks
        </label>
      </div>
      {scope === 'deck' && (
        <select value={deckId ?? ''} onChange={(e) => setDeckId(Number(e.target.value))} aria-label="Deck">
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {'  '.repeat(depth(d.name))}
              {d.name.split('::').pop()}
            </option>
          ))}
        </select>
      )}
      <div className="grid-2">
        <label className="field">
          Wordings per card
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {Array.from({ length: MAX_WORDINGS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="row" style={{ gap: 8, alignSelf: 'end' }}>
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          Redo cards that already have wordings
        </label>
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        {cards.length} card{cards.length === 1 ? '' : 's'} to do
        {alreadyDone > 0 && `; ${alreadyDone} already have wordings`}
        {skipped > 0 && `; ${skipped} skipped (cloze, image occlusion and smart cards are worded differently)`}
        {cost !== null && cards.length > 0 && `. Estimated cost: ${cost < 0.01 ? 'under $0.01' : `about $${cost.toFixed(2)}`}`}.
      </div>
      {!savedKey() && (
        <label className="field">
          OpenRouter API key
          <KeyField
            value={key}
            onChange={(k) => {
              setKey(k);
              saveKey(k);
            }}
          />
        </label>
      )}
      <label className="field">
        Model
        <ModelPicker
          value={model}
          onChange={(m) => {
            setModel(m);
            saveModel(m);
          }}
        />
      </label>
      {error && <div className="polish-error">{error}</div>}
    </Modal>
  );
}
