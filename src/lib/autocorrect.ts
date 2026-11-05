// Auto-correct for the card editor: when a word is finished (a space, Enter
// or punctuation after it), a misspelling is swapped for the dictionary's best
// suggestion, as long as that suggestion is a near miss. Spelling comes from
// nspell (Hunspell in JavaScript) with the dictionary-en English dictionary,
// loaded the first time it's needed. On or off is remembered per computer.

import NSpell from 'nspell';
// dictionary-en's own entry reads these with Node's fs, so they're served as files instead
import affUrl from '../../node_modules/dictionary-en/index.aff?url';
import dicUrl from '../../node_modules/dictionary-en/index.dic?url';

const STORE = 'appa-autocorrect';

export function readAutocorrect(): boolean {
  try {
    return localStorage.getItem(STORE) !== '0';
  } catch {
    return true;
  }
}
export function saveAutocorrect(on: boolean) {
  try {
    localStorage.setItem(STORE, on ? '1' : '0');
  } catch {
    // back to on next time
  }
}

let speller: NSpell | null = null;
let loading: Promise<NSpell | null> | null = null;

/** The speller, loading the dictionary the first time; null if it can't load. */
export function loadSpeller(): Promise<NSpell | null> {
  if (speller) return Promise.resolve(speller);
  loading ??= Promise.all([fetch(affUrl).then((r) => r.text()), fetch(dicUrl).then((r) => r.text())])
    .then(([aff, dic]) => (speller = NSpell(aff, dic)))
    .catch(() => {
      loading = null;
      return null;
    });
  return loading;
}
/** The speller if it's already loaded (corrections happen as you type, so they can't wait). */
export const readySpeller = () => speller;

/** Edits between two words, a swap of neighbours counting as one (Damerau). */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/** The fix for a finished word, or null to leave it. Names, acronyms, numbers,
 * very short words and anything the dictionary knows are left alone, and only
 * a near miss (one or two letters off) is put in. */
export function correctionFor(sp: NSpell, word: string, startsSentence: boolean): string | null {
  if (word === 'i') return 'I';
  if (!/^[A-Za-z][a-z']*$/.test(word) || word.length < 3 || word.length > 24) return null;
  const capitalised = /^[A-Z]/.test(word);
  // a capitalised word mid-sentence is probably a name
  if (capitalised && !startsSentence) return null;
  if (sp.correct(word) || sp.correct(word.toLowerCase())) return null;
  const lower = word.toLowerCase();
  const best = bestFix(sp, lower);
  if (!best) return null;
  return capitalised ? best[0].toUpperCase() + best.slice(1) : best;
}

/** Everyday words, preferred when two fixes are equally close (wiht → with, not whit). */
const COMMON = new Set(
  'the and that with have this from they their there which would about because when what were your said could other into than then them these some time only also know just like people been more will does each where after first very well over such through between before while should those being every under after again'.split(' '),
);

const sameLetters = (a: string, b: string) => a.length === b.length && [...a].sort().join('') === [...b].sort().join('');

/** The likeliest word meant. A missing apostrophe comes first (dont → don't),
 * then the same letters in another order (teh → the), then everyday words,
 * then the fewest changes, then the dictionary's own order. */
function bestFix(sp: NSpell, lower: string): string | null {
  for (let k = 1; k < lower.length; k++) {
    const withApostrophe = `${lower.slice(0, k)}'${lower.slice(k)}`;
    if (sp.correct(withApostrophe)) return withApostrophe;
  }
  const limit = lower.length <= 4 ? 1 : 2;
  const ranked = sp
    .suggest(lower)
    .filter((s) => /^[a-z']+$/.test(s))
    .map((s, order) => ({ s, order, d: distance(lower, s), anagram: sameLetters(lower, s) }))
    .filter((x) => x.d <= limit)
    .sort((a, b) => +b.anagram - +a.anagram || +COMMON.has(b.s) - +COMMON.has(a.s) || a.d - b.d || a.order - b.order);
  return ranked[0]?.s ?? null;
}
