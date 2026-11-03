// Runs FSRS optimisation/evaluation off the main thread.

import { buildTrainingHistories } from './fsrsDataset';
import { evaluate, optimizeParameters } from './fsrsOptimizer';
import type { RevlogEntry } from './types';

export type WorkerRequest =
  | { type: 'optimize'; revlog: RevlogEntry[]; params: number[]; relearnSteps: number }
  | { type: 'evaluate'; revlog: RevlogEntry[]; params: number[] };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'optimize') {
      let lastPost = 0;
      const result = optimizeParameters(req.revlog, req.params, req.relearnSteps, (p) => {
        const now = performance.now();
        if (now - lastPost > 100) {
          lastPost = now;
          self.postMessage({ type: 'progress', progress: p });
        }
        return true;
      });
      self.postMessage({ type: 'optimized', result });
    } else {
      const histories = buildTrainingHistories(req.revlog);
      const items = histories.reduce((n, h) => n + h.itemEnds.length, 0);
      self.postMessage({
        type: 'evaluated',
        items,
        evaluation: items ? evaluate(req.params, histories) : null,
      });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message });
  }
};
