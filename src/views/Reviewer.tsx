import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { View } from '../App';
import { useCollection, type QueueCounts } from '../lib/collection';
import type { Rating } from '../lib/fsrs';
import { pickVariation } from '../lib/cardVariation';
import { actionFor, onPadPress } from '../lib/gamepad';
import { renderMedia } from '../lib/media';
import { renderRun, runCase, type SmartFace } from '../lib/smart';
import { randomSeed } from '../lib/smartLib';
import { intervalSecs } from '../lib/scheduler';
import { formatInterval } from '../lib/time';
import type { Card, Id } from '../lib/types';
import { CardEditor } from './CardEditor';
import { PromptDialog } from './Modal';

const BUTTONS: { rating: Rating; label: string; key: 'again' | 'hard' | 'good' | 'easy' }[] = [
  { rating: 1, label: 'Again', key: 'again' },
  { rating: 2, label: 'Hard', key: 'hard' },
  { rating: 3, label: 'Good', key: 'good' },
  { rating: 4, label: 'Easy', key: 'easy' },
];

/** The last few versions of each smart card shown, so the next one differs. */
const recentVersions = new Map<Id, string[]>();
const RECENT = 4;

interface SmartShown {
  /** card id and showing it belongs to */
  key: string;
  seed: number;
  vars: Record<string, string>;
  face?: SmartFace;
  error?: string;
}

function Timer({ since, capSecs }: { since: number; capSecs: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.min(Math.floor((now - since) / 1000), capSecs);
  return (
    <span className="num muted" title="Time on this card">
      {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
    </span>
  );
}

export function Reviewer({ deckId, go }: { deckId: Id; go: (v: View) => void }) {
  const col = useCollection();
  const deck = col.decks.get(deckId);
  const [card, setCard] = useState<Card | null>(null);
  const [counts, setCounts] = useState<QueueCounts>({ newCount: 0, learnCount: 0, reviewCount: 0 });
  const [nextLearnAt, setNextLearnAt] = useState<number | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [shownAt, setShownAt] = useState(Date.now());
  const faceRef = useRef<HTMLDivElement>(null);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const loadNext = useCallback(() => {
    const next = col.nextCard(deckId);
    setCard(next.card);
    setCounts(next.counts);
    setNextLearnAt(next.nextLearnAt);
    setShowAnswer(false);
    setShownAt(Date.now());
  }, [col, deckId]);

  // The first card loads before the screen paints, so opening a deck never
  // flashes the "finished" screen while it's still being fetched.
  const [loaded, setLoaded] = useState(false);
  useLayoutEffect(() => {
    col.endSession();
    loadNext();
    setLoaded(true);
    return () => col.endSession();
  }, [col, loadNext]);

  // When only future learning cards remain, wake up when the next one is due.
  useEffect(() => {
    if (card || nextLearnAt === null) return;
    const ms = Math.max(1000, nextLearnAt * 1000 - Date.now() - col.prefs.learnAheadMins * 60_000);
    const t = setTimeout(loadNext, ms);
    return () => clearTimeout(t);
  }, [card, nextLearnAt, loadNext, col.prefs.learnAheadMins]);

  const preset = card ? col.presetFor(card.deckId) : null;
  // Card variation: a new font and size each time a card is shown (kept the
  // same for its question and answer).
  const variationPrefs = col.prefs.cardVariation;
  const varied = useMemo(
    () => (card && variationPrefs.enabled ? pickVariation(variationPrefs) : null),
    // shownAt changes every time a card is (re)shown, but not when its answer is revealed
    [card?.id, shownAt, variationPrefs],
  );
  const states = useMemo(() => (card ? col.previewStates(card) : null), [card, col]);

  // Other wordings of the front: one at random each time the card is shown.
  const varyWording = col.prefs.varyWording;
  const front = useMemo(() => {
    if (!card) return '';
    const options = [card.front, ...(varyWording ? (card.altFronts ?? []) : [])];
    return options[Math.floor(Math.random() * options.length)];
    // shownAt changes each showing, not when the answer is revealed
  }, [card?.id, card?.front, card?.altFronts, shownAt, varyWording]);

  // Smart cards: a new version (seed) every time the card is shown.
  const note = card?.noteId !== undefined ? col.notes.get(card.noteId) : undefined;
  const smart = note?.kind === 'smart' ? note.smart : undefined;
  const smartKey = card ? `${card.id}:${shownAt}` : '';
  const [smartShown, setSmartShown] = useState<SmartShown | null>(null);
  const [reporting, setReporting] = useState(false);
  /** the showing a version was made for; edits to the note (e.g. a report) don't swap the values mid-card */
  const generatedFor = useRef('');
  useEffect(() => {
    if (!card || !smart || generatedFor.current === smartKey) return;
    generatedFor.current = smartKey;
    const ord = card.ord ?? 0;
    const caseTemplates = smart.cases[ord];
    // one of the case's wordings, if varying is on
    const fronts = caseTemplates ? [caseTemplates.front, ...(varyWording ? (caseTemplates.altFronts ?? []).filter((x) => x.trim()) : [])] : [];
    const smartCase = caseTemplates && { ...caseTemplates, front: fronts[Math.floor(Math.random() * fronts.length)] };
    const key = smartKey;
    // a later showing replaces this one
    const stale = () => generatedFor.current !== key;
    (async () => {
      if (!smartCase) throw new Error('This card’s case was removed from its smart note.');
      const recent = recentVersions.get(card.id) ?? [];
      let seed = randomSeed();
      let run = await runCase(smart, ord, seed);
      for (let tries = 0; tries < 5 && recent.includes(JSON.stringify(run.vars)); tries++) {
        seed = randomSeed();
        run = await runCase(smart, ord, seed);
      }
      recentVersions.set(card.id, [JSON.stringify(run.vars), ...recent].slice(0, RECENT));
      if (!stale()) setSmartShown({ key, seed, vars: run.vars, face: renderRun(smartCase, run) });
    })().catch((e: Error) => !stale() && setSmartShown({ key, seed: 0, vars: {}, error: e.message }));
  }, [card, smart, smartKey, varyWording]);
  const shown = smart && smartShown?.key === smartKey ? smartShown : null;

  const report = async (comment: string) => {
    if (!note?.smart || !card || !shown) return;
    const entry = { case: card.ord ?? 0, seed: shown.seed, vars: shown.vars, comment, at: Date.now() };
    await col.updateNote({ ...note, smart: { ...note.smart, reports: [...(note.smart.reports ?? []), entry].slice(-20) } }, card.deckId);
    setReporting(false);
    flash('Reported. Open Edit → Update with AI to fix it.');
  };

  // Autoplay: question audio when shown, answer audio when revealed.
  useEffect(() => {
    if (!card || !preset?.autoplay || editing) return;
    const audios = [...(faceRef.current?.querySelectorAll('audio') ?? [])];
    const target = showAnswer ? audios.find((a) => a.closest('.answer-part')) : audios[0];
    target?.play().catch(() => {
      // browsers block autoplay until the page has had a user gesture
    });
  }, [card, showAnswer, preset?.autoplay, editing]);

  // Actions run one at a time, so a fast keypress (e.g. undo) can't
  // interleave with a save that's still in flight.
  const busy = useRef(false);
  const exclusive = useCallback(async (fn: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    (document.activeElement as HTMLElement | null)?.blur();
    try {
      await fn();
    } finally {
      busy.current = false;
    }
  }, []);

  const answer = useCallback(
    (rating: Rating) =>
      exclusive(async () => {
        if (!card || !showAnswer) return;
        await col.answer(card, rating, Date.now() - shownAt, shown?.seed);
        loadNext();
      }),
    [exclusive, card, showAnswer, col, shownAt, loadNext, shown],
  );

  const undo = useCallback(
    () =>
      exclusive(async () => {
        const restored = await col.undo();
        if (!restored) return;
        setCard(restored);
        setCounts(col.nextCard(deckId).counts);
        setShowAnswer(false);
        setShownAt(Date.now());
        flash('Undid last answer');
      }),
    [exclusive, col, deckId],
  );

  const suspend = useCallback(
    () =>
      exclusive(async () => {
        if (!card) return;
        await col.setSuspended([card.id], true);
        flash('Card suspended');
        loadNext();
      }),
    [exclusive, card, col, loadNext],
  );

  const bury = useCallback(
    () =>
      exclusive(async () => {
        if (!card) return;
        await col.bury([card.id]);
        flash('Card buried until tomorrow');
        loadNext();
      }),
    [exclusive, card, col, loadNext],
  );

  useEffect(() => {
    if (editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if (!card) return;
      if (!showAnswer && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setShowAnswer(true);
      } else if (showAnswer && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        answer(3);
      } else if (showAnswer && ['1', '2', '3', '4'].includes(e.key)) {
        answer(Number(e.key) as Rating);
      } else if (e.key === 'e') {
        setEditing(true);
      } else if (e.key === '@') {
        suspend();
      } else if (e.key === '-') {
        bury();
      } else if (e.key === 'r' || e.key === 'F5') {
        // replay audio, as in Anki
        e.preventDefault();
        const audios = [...(faceRef.current?.querySelectorAll('audio') ?? [])];
        audios.forEach((a) => (a.currentTime = 0));
        audios[0]?.play().catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, showAnswer, answer, undo, suspend, bury, editing]);

  // Game controller buttons, mapped in Preferences → Controller.
  const controller = col.prefs.controller;
  useEffect(() => {
    if (editing || !controller.enabled) return;
    return onPadPress(({ input }) => {
      const action = actionFor(controller.bindings, input);
      if (!action) return;
      if (action === 'undo') return void undo();
      if (!card) return;
      if (!showAnswer) {
        // any rating button reveals the answer first
        setShowAnswer(true);
        return;
      }
      const rating: Record<typeof action, Rating> = { show: 3, again: 1, hard: 2, good: 3, easy: 4 };
      answer(rating[action]);
    });
  }, [controller, card, showAnswer, answer, undo, editing]);

  if (!deck) return <div className="panel">Deck not found.</div>;

  const currentQueue = card ? (card.queue === 0 ? 'new' : card.queue === 2 ? 'review' : 'learn') : null;

  if (!loaded) return null;

  if (!card) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: 48 }}>
        <h1>Congratulations! You have finished “{deck.name}” for now.</h1>
        {nextLearnAt ? (
          <p className="muted">
            More learning cards are due in {formatInterval(Math.max(0, nextLearnAt - Date.now() / 1000))}. This screen will
            continue automatically.
          </p>
        ) : (
          <p className="muted">Come back tomorrow for more reviews, or raise today's limits in the deck's options.</p>
        )}
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button onClick={() => go({ name: 'decks' })}>Back to Home</button>
          <button onClick={() => go({ name: 'options', deckId })}>Deck options</button>
          {col.canUndo() && <button onClick={undo}>Undo last answer</button>}
        </div>
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  if (editing) {
    return (
      <CardEditor
        card={card}
        onDone={(updated) => {
          setEditing(false);
          if (updated) {
            setCard(updated);
            // a smart card shows a fresh version from its edited generator
            if (smart) setShownAt(Date.now());
          }
        }}
      />
    );
  }

  const r = col.retrievability(card);
  const cardDeck = col.decks.get(card.deckId);

  return (
    <div className="reviewer">
      <div className="row">
        <button className="link" onClick={() => go({ name: 'decks' })}>
          ← Home
        </button>
        <strong>{deck.name.split('::').join(' › ')}</strong>
        {cardDeck && cardDeck.id !== deck.id && (
          <span className="muted">· {cardDeck.name.slice(deck.name.length).replace(/^::/, '').split('::').join(' › ')}</span>
        )}
        <span className="spacer" />
        {preset?.showTimer && <Timer key={card.id} since={shownAt} capSecs={preset.capAnswerTimeSecs} />}
        <button onClick={() => setEditing(true)} title="Edit (E)">
          Edit
        </button>
        <button onClick={bury} title="Bury (-)">
          Bury
        </button>
        <button onClick={suspend} title="Suspend (@)">
          Suspend
        </button>
        <button onClick={undo} disabled={!col.canUndo()} title="Undo (Ctrl+Z)">
          Undo
        </button>
      </div>

      <div className="counts-bar num">
        <span className={`c-new ${currentQueue === 'new' ? 'current' : ''}`}>{counts.newCount}</span>
        <span className={`c-learn ${currentQueue === 'learn' ? 'current' : ''}`}>{counts.learnCount}</span>
        <span className={`c-review ${currentQueue === 'review' ? 'current' : ''}`}>{counts.reviewCount}</span>
      </div>

      <div
        className="panel card-face"
        ref={faceRef}
        style={varied ? { fontFamily: varied.fontFamily, fontSize: varied.fontSize } : undefined}
      >
        {smart ? (
          shown?.error ? (
            <div className="polish-error">This smart card couldn't be generated: {shown.error} Press E to edit it.</div>
          ) : shown?.face ? (
            <>
              <div dangerouslySetInnerHTML={{ __html: renderMedia(shown.face.front) }} />
              {showAnswer && (
                <>
                  <hr />
                  <div className="answer-part" dangerouslySetInnerHTML={{ __html: renderMedia(shown.face.back) }} />
                </>
              )}
            </>
          ) : (
            <div className="muted">Generating…</div>
          )
        ) : showAnswer && card.answerReplacesFront ? (
          <div className="answer-part" dangerouslySetInnerHTML={{ __html: renderMedia(card.back) }} />
        ) : (
          <>
            <div dangerouslySetInnerHTML={{ __html: renderMedia(front) }} />
            {showAnswer && (
              <>
                <hr />
                <div className="answer-part" dangerouslySetInnerHTML={{ __html: renderMedia(card.back) }} />
              </>
            )}
          </>
        )}
      </div>

      {showAnswer && states ? (
        <div className="answer-bar">
          {BUTTONS.map((b) => (
            <button key={b.rating} className={b.key} onClick={() => answer(b.rating)}>
              <span className="ivl num">{formatInterval(intervalSecs(states[b.key]))}</span>
              <strong>{b.label}</strong>
              <span className="kbd">{b.rating}</span>
            </button>
          ))}
        </div>
      ) : (
        <button
          className="primary show-answer"
          onClick={(e) => {
            e.currentTarget.blur();
            setShowAnswer(true);
          }}
        >
          Show answer <span style={{ opacity: 0.7, fontSize: 12 }}>(Space)</span>
        </button>
      )}

      {smart && shown?.face && (
        <div className="row" style={{ justifyContent: 'center', gap: 16, fontSize: 13 }}>
          {!showAnswer ? (
            <button className="link" onClick={() => setShownAt(Date.now())} title="Show this card with other values">
              ↻ New values
            </button>
          ) : (
            <button className="link" onClick={() => setReporting(true)}>
              Report a wrong answer
            </button>
          )}
        </div>
      )}
      {reporting && (
        <PromptDialog
          title="Report a wrong answer"
          label="What's wrong?"
          hint="Saved with these exact values, so Update with AI can fix the generator."
          submitLabel="Report"
          onSubmit={report}
          onCancel={() => setReporting(false)}
        />
      )}

      <div className="memory-info num">
        {card.stability === null ? (
          <span>New card</span>
        ) : (
          <>
            <span>Stability {card.stability.toFixed(2)}d</span>
            <span>Difficulty {((((card.difficulty ?? 1) - 1) / 9) * 100).toFixed(0)}%</span>
            {r !== null && <span>Retrievability {(r * 100).toFixed(1)}%</span>}
          </>
        )}
        <span>Reviews {card.reps}</span>
        <span>Lapses {card.lapses}</span>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
