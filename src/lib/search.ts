// A subset of Anki's search syntax. Terms are ANDed; prefix with "-" to negate.
//   text            front/back contains text (* wildcards)
//   deck:Name (includes subdecks)   tag:name   preset:Name
//   is:new|learn|review|due|suspended|buried
//   prop:s>10  prop:d<0.5  prop:r<0.9  prop:ivl>=30  prop:reps>5  prop:lapses>2
//     (d is 0-1 like Anki's display; r is current retrievability)

import { isWithin } from './deckTree';
import { today, nowSecs } from './time';
import type { Card, Deck, Id, Preset } from './types';

export interface SearchContext {
  decks: Map<Id, Deck>;
  presetFor: (deckId: Id) => Preset;
  retrievability: (card: Card) => number | null;
}

type Pred = (c: Card) => boolean;

function tokenize(q: string): string[] {
  const out: string[] = [];
  const re = /(-?)(\w+:)?"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) out.push(m[4] ?? `${m[1]}${m[2] ?? ''}${m[3]}`);
  return out;
}

function globRegex(pattern: string, whole: boolean) {
  const body = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(whole ? `^${body}$` : body, 'i');
}

export function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

const CMP: Record<string, (a: number, b: number) => boolean> = {
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '!=': (a, b) => a !== b,
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '=': (a, b) => a === b,
};

export function buildSearch(query: string, ctx: SearchContext): Pred {
  const t = today();
  const now = nowSecs();
  const { decks } = ctx;
  const preds = tokenize(query).map((raw): Pred => {
    const neg = raw.startsWith('-') && raw.length > 1;
    const tok = neg ? raw.slice(1) : raw;
    const colon = tok.indexOf(':');
    const key = colon > 0 ? tok.slice(0, colon).toLowerCase() : '';
    const val = colon > 0 ? tok.slice(colon + 1) : tok;
    let p: Pred;
    switch (key) {
      case 'deck': {
        // like Anki, deck:A also matches A's subdecks
        const re = globRegex(val, true);
        const matching = [...decks.values()].filter((d) => re.test(d.name)).map((d) => d.name);
        p = (c) => {
          const name = decks.get(c.deckId)?.name ?? '';
          return matching.some((m) => isWithin(name, m));
        };
        break;
      }
      case 'preset': {
        const re = globRegex(val, true);
        p = (c) => re.test(ctx.presetFor(c.deckId).name);
        break;
      }
      case 'tag': {
        const re = globRegex(val, true);
        p = (c) => c.tags.some((tg) => re.test(tg));
        break;
      }
      case 'is':
        p = {
          new: (c: Card) => c.type === 0,
          learn: (c: Card) => c.type === 1 || c.type === 3,
          review: (c: Card) => c.type === 2 || c.type === 3,
          suspended: (c: Card) => c.queue === -1,
          buried: (c: Card) => c.queue === -3,
          due: (c: Card) => (c.queue === 1 && c.due <= now) || ((c.queue === 2 || c.queue === 3) && c.due <= t),
        }[val.toLowerCase()] ?? (() => false);
        break;
      case 'prop': {
        const m = /^(\w+)(>=|<=|!=|>|<|=)([\d.]+)$/.exec(val);
        if (!m) {
          p = () => false;
          break;
        }
        const [, field, op, numStr] = m;
        const num = Number(numStr);
        const get: (c: Card) => number | null =
          {
            s: (c: Card) => c.stability,
            d: (c: Card) => (c.difficulty === null ? null : (c.difficulty - 1) / 9),
            r: (c: Card) => ctx.retrievability(c),
            ivl: (c: Card) => c.ivl,
            reps: (c: Card) => c.reps,
            lapses: (c: Card) => c.lapses,
            due: (c: Card) => (c.queue === 2 || c.queue === 3 ? c.due - t : null),
          }[field.toLowerCase()] ?? (() => null);
        p = (c) => {
          const v = get(c);
          return v !== null && CMP[op](v, num);
        };
        break;
      }
      default: {
        const re = globRegex(tok, false);
        p = (c) => re.test(stripHtml(c.front)) || re.test(stripHtml(c.back));
      }
    }
    return neg ? (c) => !p(c) : p;
  });
  return (c) => preds.every((p) => p(c));
}
