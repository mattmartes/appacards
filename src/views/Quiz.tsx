// The Quiz tab: an AI quizzes you on a deck, or on your own files (slides,
// notes, with past quizzes as a style reference), one question at a time
// for as long as you like. The next question is written while you answer
// the current one, and each targets the least-covered card or section.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCollection } from '../lib/collection';
import { depth } from '../lib/deckTree';
import { actionFor, onPadPress } from '../lib/gamepad';
import { savedKey, type ModelOptions } from '../lib/polish';
import {
  Coverage,
  isRight,
  MaterialCoverage,
  nextQuestion,
  quizCards,
  type QuizFocus,
  type QuizKinds,
  type QuizQuestion,
  type QuizSource,
} from '../lib/quiz';
import type { Id, QuizSet } from '../lib/types';
import { useModels } from './AiPrefs';
import { QuizSets } from './QuizSets';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
/** questions ready: the current one and the next */
const AHEAD = 2;

interface Slot {
  q: QuizQuestion;
  picks: number[];
  checked: boolean;
}

interface Run {
  /** what's being quizzed, for "quiz me again on what I missed" */
  origin: { kind: 'deck'; id: Id } | { kind: 'set'; id: Id };
  focus: QuizFocus;
  kinds: QuizKinds;
  source: QuizSource<unknown>;
  slots: Slot[];
  index: number;
  /** questions being written */
  writing: number;
  error?: string;
  finished: boolean;
}

export function Quiz({ setId }: { setId?: Id } = {}) {
  const col = useCollection();
  const { models, initial } = useModels();
  const decks = col.deckList();
  const [mode, setMode] = useState<'deck' | 'material'>(setId !== undefined ? 'material' : 'deck');
  const [deckId, setDeckId] = useState<Id | null>(null);
  const [focus, setFocus] = useState<QuizFocus>('all');
  const [kinds, setKinds] = useState<QuizKinds>('mixed');
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const latest = useRef(run);
  latest.current = run;
  /** questions being written right now (state lags a render behind) */
  const inFlight = useRef(0);
  useEffect(() => () => abort.current?.abort(), []);

  const usable = useMemo(() => new Map(decks.map((d) => [d.id, quizCards(d.id).length])), [decks, col.version]);
  const info = models.find((m) => m.id === initial);
  const model: ModelOptions = {
    model: initial,
    jsonMode: info?.supported_parameters?.includes('response_format'),
    maxTokens: info?.top_provider?.max_completion_tokens ?? undefined,
  };

  const begin = (origin: Run['origin'], source: QuizSource<unknown>) => {
    if (!savedKey()) return setError('Add your OpenRouter API key in Preferences → AI first.');
    abort.current?.abort();
    abort.current = new AbortController();
    inFlight.current = 0;
    setError(null);
    setRun({ origin, focus, kinds, source, slots: [], index: 0, writing: 0, finished: false });
  };
  const startDeck = (id: Id, firstIds: Id[] = []) =>
    begin({ kind: 'deck', id }, new Coverage(col.decks.get(id)?.name ?? 'Deck', quizCards(id), focus, firstIds) as QuizSource<unknown>);
  const startSet = (set: QuizSet, firstRefs: string[] = []) =>
    begin({ kind: 'set', id: set.id }, new MaterialCoverage(set, firstRefs) as QuizSource<unknown>);

  /** Writes one more question in the background. */
  const write = useCallback(() => {
    const r = latest.current;
    const ctrl = abort.current;
    if (!r || !ctrl) return;
    // a question you got wrong earlier, if one is due, needs no writing
    const replay = r.source.takeReplay();
    if (replay) {
      setRun((x) => x && { ...x, slots: [...x.slots, { q: replay, picks: [], checked: false }] });
      return;
    }
    inFlight.current++;
    setRun((x) => x && { ...x, writing: x.writing + 1 });
    nextQuestion(savedKey(), model, r.source, r.kinds, r.slots.map((s) => s.q.question), ctrl.signal)
      .then(
        (q) => !ctrl.signal.aborted && setRun((x) => x && { ...x, writing: x.writing - 1, slots: [...x.slots, { q, picks: [], checked: false }] }),
        (e: Error) => !ctrl.signal.aborted && setRun((x) => x && { ...x, writing: x.writing - 1, error: e.message }),
      )
      .finally(() => {
        // a request from an earlier quiz doesn't count against this one
        if (abort.current === ctrl) inFlight.current--;
      });
    // model is rebuilt each render from the saved choice
  }, [initial, info]);

  // Keep the current question and the next one ready.
  useEffect(() => {
    if (!run || run.finished || run.error) return;
    const missing = AHEAD - (run.slots.length - run.index) - inFlight.current;
    for (let i = 0; i < missing; i++) write();
  }, [run?.slots.length, run?.index, run?.writing, run?.finished, run?.error, write]);

  if (run) {
    return (
      <QuizRun
        run={run}
        setRun={setRun}
        onFinish={() => {
          abort.current?.abort();
          setRun((r) => r && { ...r, finished: true });
        }}
        onExit={() => {
          abort.current?.abort();
          setRun(null);
        }}
        onRetry={() => setRun((r) => r && { ...r, error: undefined })}
        onRetryMissed={(keys) => {
          setFocus(run.focus);
          setKinds(run.kinds);
          if (run.origin.kind === 'deck') startDeck(run.origin.id, keys.map(Number));
          else {
            const set = col.quizSets.get(run.origin.id);
            if (set) startSet(set, keys);
          }
        }}
      />
    );
  }

  const chosen = deckId !== null ? col.decks.get(deckId) : undefined;
  const n = deckId !== null ? (usable.get(deckId) ?? 0) : 0;
  const deckCards = deckId !== null ? quizCards(deckId) : [];
  const quizzed = deckCards.filter((c) => (col.quizStats.get(c.id)?.asked ?? 0) > 0).length;
  const deckIds = new Set(deckCards.map((c) => c.id));
  const toRevisit = [...col.quizMissed.values()].filter((m) => deckIds.has(m.q.cardIds[0])).length;

  const typePicker = (
    <fieldset className="quiz-focus">
      <legend>Question type</legend>
      {(
        [
          ['single', 'One answer'],
          ['mixed', 'Mix of one answer and select all that apply'],
          ['multi', 'Select all that apply'],
        ] as [QuizKinds, string][]
      ).map(([k, label]) => (
        <label key={k} className="row" style={{ gap: 6 }}>
          <input type="radio" checked={kinds === k} onChange={() => setKinds(k)} />
          {label}
        </label>
      ))}
    </fieldset>
  );

  const tabs = (
    <div className="row">
      <h1 style={{ margin: 0 }}>Quiz</h1>
      <span className="spacer" />
      <div className="seg quiz-mode" role="tablist">
        <button role="tab" aria-selected={mode === 'deck'} className={mode === 'deck' ? 'active' : ''} onClick={() => setMode('deck')}>
          From a deck
        </button>
        <button role="tab" aria-selected={mode === 'material'} className={mode === 'material' ? 'active' : ''} onClick={() => setMode('material')}>
          From your material
        </button>
      </div>
    </div>
  );

  if (mode === 'material') {
    return (
      <div className="panel" style={{ display: 'grid', gap: 14 }}>
        {tabs}
        <QuizSets typePicker={typePicker} model={initial} initialChosen={setId} onStart={(set) => startSet(set)} />
        {error && <div className="polish-error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="panel" style={{ display: 'grid', gap: 14 }}>
      {tabs}
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        Pick a deck and an AI quizzes you on it, one question at a time, for as long as you like. Questions apply, compare and predict
        rather than just repeat your cards, with wrong answers that are tempting rather than silly. Each question targets a card you
        haven't been quizzed on yet, so the whole deck gets covered, and cards you miss come back a few questions later.
      </p>
      <div className="quiz-decks" role="listbox" aria-label="Deck">
        {decks.map((d) => {
          const k = usable.get(d.id) ?? 0;
          return (
            <button
              key={d.id}
              role="option"
              aria-selected={deckId === d.id}
              className={`quiz-deck ${deckId === d.id ? 'active' : ''}`}
              style={{ paddingLeft: 12 + depth(d.name) * 18 }}
              disabled={k === 0}
              onClick={() => setDeckId(d.id)}
            >
              <span>{d.name.split('::').pop()}</span>
              <span className="muted num">{k} cards</span>
            </button>
          );
        })}
      </div>
      {chosen && (
        <div className="quiz-setup">
          <div className="muted" style={{ fontSize: 13 }}>
            {quizzed} of {n} cards in this deck have been quizzed before.
            {toRevisit > 0 && ` ${toRevisit} question${toRevisit === 1 ? '' : 's'} you got wrong before will come back during the quiz.`}
          </div>
          <div className="grid-2">
            {typePicker}
            <fieldset className="quiz-focus">
              <legend>Among cards not yet covered, start with</legend>
              {(
                [
                  ['all', 'Any card'],
                  ['weak', 'My weakest cards'],
                  ['new', 'Cards I haven’t studied much'],
                ] as [QuizFocus, string][]
              ).map(([k, label]) => (
                <label key={k} className="row" style={{ gap: 6 }}>
                  <input type="radio" checked={focus === k} onChange={() => setFocus(k)} />
                  {label}
                </label>
              ))}
            </fieldset>
          </div>
          <div className="row">
            <button className="primary" onClick={() => deckId !== null && startDeck(deckId)} disabled={!n}>
              Start quiz on {chosen.name.split('::').pop()}
            </button>
            <span className="muted" style={{ fontSize: 13 }}>
              Uses {initial} (Preferences → AI)
            </span>
          </div>
        </div>
      )}
      {error && <div className="polish-error">{error}</div>}
    </div>
  );
}

function QuizRun({
  run,
  setRun,
  onFinish,
  onExit,
  onRetry,
  onRetryMissed,
}: {
  run: Run;
  setRun: React.Dispatch<React.SetStateAction<Run | null>>;
  onFinish: () => void;
  onExit: () => void;
  onRetry: () => void;
  /** the cards or sections behind the missed questions */
  onRetryMissed: (keys: string[]) => void;
}) {
  const slot = run.slots[run.index];
  const q = slot?.q;
  const checkedSlots = run.slots.filter((s) => s.checked);
  const score = checkedSlots.filter((s) => isRight(s.q, s.picks)).length;
  const total = run.source.total;
  const title = run.source.title;
  const unitName = run.origin.kind === 'deck' ? 'cards' : 'sections';

  const update = useCallback(
    (fn: (s: Slot) => Slot) => setRun((r) => r && { ...r, slots: r.slots.map((s, i) => (i === r.index ? fn(s) : s)) }),
    [setRun],
  );

  const check = useCallback(() => {
    if (!slot || slot.checked || !slot.picks.length) return;
    run.source.answered(slot.q, isRight(slot.q, slot.picks));
    update((s) => ({ ...s, checked: true }));
  }, [slot, run.source, update]);

  const choose = useCallback(
    (i: number) => {
      if (!slot || slot.checked || i >= slot.q.options.length) return;
      if (slot.q.multi) {
        update((s) => ({ ...s, picks: s.picks.includes(i) ? s.picks.filter((x) => x !== i) : [...s.picks, i] }));
      } else {
        run.source.answered(slot.q, isRight(slot.q, [i]));
        update((s) => ({ ...s, picks: [i], checked: true }));
      }
    },
    [slot, run.source, update],
  );

  const next = useCallback(() => {
    if (!slot) return;
    if (!slot.checked) return check();
    setRun((r) => r && { ...r, index: r.index + 1 });
  }, [slot, check, setRun]);

  // Keys and controller buttons call the latest handlers through a ref, so a
  // quick second press never reaches a handler from before the first one.
  const handlers = useRef({ choose, next });
  handlers.current = { choose, next };

  // Keys: 1-6 or A-F pick; Enter or Space checks a "select all", then goes on.
  useEffect(() => {
    if (run.finished) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.ctrlKey || e.metaKey) return;
      const n = '123456'.indexOf(e.key) >= 0 && e.key ? Number(e.key) - 1 : 'abcdef'.indexOf(e.key.toLowerCase());
      if (e.key.length === 1 && n >= 0) handlers.current.choose(n);
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handlers.current.next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run.finished]);

  // A controller's Again/Hard/Good/Easy buttons pick A-D; Show answer checks and goes on.
  const col = useCollection();
  const controller = col.prefs.controller;
  useEffect(() => {
    if (!controller.enabled || run.finished) return;
    return onPadPress(({ input }) => {
      const action = actionFor(controller.bindings, input);
      const index: Record<string, number> = { again: 0, hard: 1, good: 2, easy: 3 };
      if (action && action in index) handlers.current.choose(index[action]);
      else if (action === 'show') handlers.current.next();
    });
  }, [controller, run.finished]);

  if (run.finished) {
    const missed = checkedSlots.filter((s) => !isRight(s.q, s.picks));
    const missedKeys = [...new Set(missed.map((s) => run.source.questionKey(s.q)).filter((k): k is string => !!k))];
    const pct = checkedSlots.length ? Math.round((score / checkedSlots.length) * 100) : 0;
    return (
      <div className="panel" style={{ display: 'grid', gap: 14 }}>
        <div className="row">
          <h1 style={{ margin: 0 }}>Quiz results</h1>
          <span className="muted">{title}</span>
        </div>
        {checkedSlots.length === 0 ? (
          <p className="muted">No questions answered.</p>
        ) : (
          <div className="quiz-score">
            <span className="num">{pct}%</span>
            <span className="muted">
              {score} of {checkedSlots.length} correct · covered {run.source.covered} of {total} {unitName}
            </span>
          </div>
        )}
        {missed.length > 0 && (
          <div className="quiz-missed">
            <b>Review what you missed</b>
            <span className="muted" style={{ fontSize: 13 }}>
              These are saved and will come back in later quizzes on this {run.origin.kind === 'deck' ? 'deck' : 'material'} until you get
              each right twice in a row.
            </span>
            {missed.map((s) => (
              <div key={s.q.id} className="quiz-missed-item">
                <div dangerouslySetInnerHTML={{ __html: s.q.question }} />
                <div className="quiz-wrong">
                  You said: <span dangerouslySetInnerHTML={{ __html: s.picks.map((i) => s.q.options[i]).join('; ') }} />
                </div>
                <div className="quiz-right">
                  Answer: <span dangerouslySetInnerHTML={{ __html: s.q.correct.map((i) => s.q.options[i]).join('; ') }} />
                </div>
                {s.q.explanation && <div className="muted" dangerouslySetInnerHTML={{ __html: s.q.explanation }} />}
              </div>
            ))}
          </div>
        )}
        <div className="row">
          {missedKeys.length > 0 && (
            <button className="primary" onClick={() => onRetryMissed(missedKeys)}>
              Quiz me again on what I missed
            </button>
          )}
          <button onClick={onExit}>New quiz</button>
        </div>
      </div>
    );
  }

  const right = slot?.checked ? isRight(slot.q, slot.picks) : null;

  return (
    <div className="panel quiz-run">
      <div className="row">
        <button className="link" onClick={onExit}>
          ← Quiz
        </button>
        <b>{title}</b>
        <span className="spacer" />
        <span className="muted num">
          Question {run.index + 1}
          {checkedSlots.length ? ` · ${score}/${checkedSlots.length} correct` : ''}
        </span>
        <button onClick={onFinish}>Finish</button>
      </div>
      <div className="quiz-coverage" title="Different cards or sections this quiz has asked about">
        <div className="progress">
          <div style={{ width: `${(run.source.covered / Math.max(total, 1)) * 100}%` }} />
        </div>
        <span className="muted num">
          Covered {run.source.covered} of {total} {unitName}
          {run.source.waiting > 0 && ` · ${run.source.waiting} missed to revisit`}
        </span>
      </div>

      {!q ? (
        run.error && !run.writing ? (
          <div className="polish-error">
            {run.error}{' '}
            <button className="link" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : (
          <div className="quiz-waiting">
            <div className="msg teacher thinking" aria-label="Writing a question">
              <span />
              <span />
              <span />
            </div>
            <span className="muted">Writing {run.slots.length ? 'the next question' : 'your first question'}…</span>
          </div>
        )
      ) : (
        <>
          {(q.multi || q.replay) && (
            <div className="quiz-kind">
              {q.replay && <span className="quiz-replay">You got this wrong before</span>}
              {q.multi && 'Select all that apply'}
            </div>
          )}
          <div className="quiz-question" dangerouslySetInnerHTML={{ __html: q.question }} />
          <div className="quiz-options">
            {q.options.map((o, i) => {
              const picked = slot.picks.includes(i);
              const isCorrect = q.correct.includes(i);
              const state = !slot.checked
                ? picked
                  ? 'picked'
                  : ''
                : isCorrect
                  ? picked || !q.multi
                    ? 'correct'
                    : 'missed'
                  : picked
                    ? 'wrong'
                    : 'faded';
              return (
                <button
                  key={i}
                  className={`quiz-option ${state} ${q.multi ? 'multi' : ''}`}
                  onClick={() => choose(i)}
                  disabled={slot.checked}
                  aria-pressed={q.multi ? picked : undefined}
                >
                  <span className="quiz-letter">{q.multi && !slot.checked ? (picked ? '✓' : LETTERS[i]) : LETTERS[i]}</span>
                  <span>
                    <span dangerouslySetInnerHTML={{ __html: o }} />
                    {slot.checked && state === 'missed' && <span className="quiz-tag"> you missed this one</span>}
                    {slot.checked && q.multi && q.notes[i] && <span className="quiz-note">{q.notes[i]}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          {slot.checked && (
            <div className={`quiz-feedback ${right ? 'good' : 'bad'}`}>
              <b>
                {right
                  ? 'Correct.'
                  : q.multi
                    ? `Not quite: the answers are ${q.correct.map((i) => LETTERS[i]).join(', ')}.`
                    : `Not quite: the answer is ${LETTERS[q.correct[0]]}.`}
              </b>{' '}
              {!q.multi && !right && q.notes[slot.picks[0]] && <span>{q.notes[slot.picks[0]]} </span>}
              {q.explanation && <span dangerouslySetInnerHTML={{ __html: q.explanation }} />}
            </div>
          )}
          <div className="row">
            <span className="muted" style={{ fontSize: 13 }}>
              {!slot.checked ? (q.multi ? 'Pick every right answer (1–5 or A–E), then Enter to check' : 'Press 1–4 or A–D') : 'Enter for the next question'}
            </span>
            <span className="spacer" />
            {!slot.checked && q.multi ? (
              <button className="primary" disabled={!slot.picks.length} onClick={check}>
                Check answer
              </button>
            ) : (
              <button className="primary" disabled={!slot.checked} onClick={next}>
                Next question
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
