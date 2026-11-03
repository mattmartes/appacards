import { useEffect, useRef, useState } from 'react';
import type { RevlogEntry } from '../lib/types';
import type { Evaluation, OptimizeResult, Progress } from '../lib/fsrsOptimizer';
import type { WorkerRequest } from '../lib/optimizer.worker';

type WorkerResponse =
  | { type: 'progress'; progress: Progress }
  | { type: 'optimized'; result: OptimizeResult }
  | { type: 'evaluated'; items: number; evaluation: Evaluation | null }
  | { type: 'error'; message: string };

const fmtLoss = (e: Evaluation | null) => (e ? e.logLoss.toFixed(4) : '—');
const fmtRmse = (e: Evaluation | null) => (e ? `${(e.rmseBins * 100).toFixed(2)}%` : '—');

/** Optimize/Evaluate controls. `params` is the (possibly unsaved) text in the
 * parameters box; `onParams` receives optimized values to put there. */
/** `revlog` is the history to train on: like Anki's default search
 * ("preset:<name>"), the review log of cards in decks using the preset. */
export function Optimize({
  params,
  relearnSteps,
  revlog,
  presetName,
  onParams,
}: {
  params: number[] | null;
  relearnSteps: number;
  revlog: RevlogEntry[];
  presetName: string;
  onParams: (p: number[]) => void;
}) {
  const worker = useRef<Worker | null>(null);
  const [running, setRunning] = useState<'optimize' | 'evaluate' | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [result, setResult] = useState<OptimizeResult | null>(null);

  useEffect(() => () => worker.current?.terminate(), []);

  const start = (req: WorkerRequest) => {
    worker.current?.terminate();
    const w = new Worker(new URL('../lib/optimizer.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setRunning(req.type);
    setProgress(null);
    setMessage(null);
    if (req.type === 'optimize') setResult(null);
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setProgress(msg.progress);
        return;
      }
      w.terminate();
      worker.current = null;
      setRunning(null);
      if (msg.type === 'error') setMessage({ text: msg.message, error: true });
      else if (msg.type === 'evaluated') {
        setMessage({
          text: msg.evaluation
            ? `Current parameters on ${msg.items} reviews: log loss ${fmtLoss(msg.evaluation)}, RMSE ${fmtRmse(msg.evaluation)}. Lower is better.`
            : 'No reviews to evaluate yet.',
        });
      } else {
        const r = msg.result;
        setResult(r);
        if (r.improved && r.params !== params) onParams(r.params);
        setMessage({
          text: r.note
            ? r.note
            : r.improved
              ? 'Optimized parameters are in the box above. Click Save to use them.'
              : 'Your current parameters already fit your history at least as well, so they were kept.',
        });
      }
    };
    w.onerror = (e) => {
      setRunning(null);
      setMessage({ text: e.message || 'The optimizer crashed.', error: true });
    };
    w.postMessage(req);
  };

  const cancel = () => {
    worker.current?.terminate();
    worker.current = null;
    setRunning(null);
    setMessage({ text: 'Cancelled.' });
  };

  const pct = progress ? ((progress.epoch - 1 + progress.processed / progress.total) / progress.epochs) * 100 : 0;
  const disabled = running !== null || params === null;

  return (
    <div style={{ display: 'grid', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <h2 style={{ margin: 0 }}>Optimize parameters</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Trains FSRS-7 parameters for the “{presetName}” preset on the {revlog.length} logged answers of cards in
        decks that use it, as the “Optimize” button in Anki's
        development version does. It
        needs at least 64 reviews done on a later day than the card's previous review; a few hundred or more works
        best.
      </p>
      <div className="row">
        <button
          className="primary"
          disabled={disabled}
          onClick={() => start({ type: 'optimize', revlog: revlog, params: params ?? [], relearnSteps })}
        >
          Optimize
        </button>
        <button disabled={disabled} onClick={() => start({ type: 'evaluate', revlog: revlog, params: params ?? [] })}>
          Evaluate
        </button>
        {running && <button onClick={cancel}>Cancel</button>}
      </div>
      {running === 'optimize' && (
        <div style={{ display: 'grid', gap: 4 }}>
          <div
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{ height: 8, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}
          >
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.1s' }} />
          </div>
          <span className="muted num" style={{ fontSize: 12 }}>
            {progress ? `Epoch ${progress.epoch} of ${progress.epochs} · ${Math.round(pct)}%` : 'Preparing your review history…'}
          </span>
        </div>
      )}
      {running === 'evaluate' && <span className="muted">Evaluating…</span>}
      {result && result.before && result.after && (
        <table className="cards num" style={{ maxWidth: 420 }}>
          <thead>
            <tr>
              <th />
              <th>Log loss</th>
              <th>RMSE (bins)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Current</td>
              <td>{fmtLoss(result.before)}</td>
              <td>{fmtRmse(result.before)}</td>
            </tr>
            <tr>
              <td>Optimized</td>
              <td>{fmtLoss(result.after)}</td>
              <td>{fmtRmse(result.after)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {result && result.itemCount > 0 && (
        <span className="muted num" style={{ fontSize: 12 }}>
          Trained on {result.itemCount} items from {result.reviewCount} reviews.
        </span>
      )}
      {message && <span style={{ color: message.error ? 'var(--again)' : 'var(--text-2)' }}>{message.text}</span>}
    </div>
  );
}
