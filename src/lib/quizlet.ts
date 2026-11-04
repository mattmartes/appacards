// Reads a Quizlet set exported as text (Export → "Between term and
// definition" / "Between rows", copied from the box). By default a tab
// separates the term from the definition and each row is a line.

export interface PlainCard {
  front: string;
  back: string;
}

export type TermSep = 'tab' | 'comma' | 'custom';
export type RowSep = 'newline' | 'semicolon' | 'custom';

export interface QuizletOptions {
  term: TermSep;
  row: RowSep;
  customTerm?: string;
  customRow?: string;
  /** drop "Q:" / "A:" (and "Term:", "Definition:") at the start of each side */
  stripLabels: boolean;
}

export const DEFAULT_QUIZLET: QuizletOptions = { term: 'tab', row: 'newline', stripLabels: true };

/** Text from Quizlet's export page that gets copied along with the set. */
const PAGE_TEXT = [/^\s*Copy and paste the text below\.\s*It is read-only\.\s*/i];
const PAGE_LINES = /^(export|between term and definition|between rows|options|tab|comma|new line|semicolon|custom)$/i;
const LABEL = /^\s*(q|a|question|answer|term|definition|front|back)\s*[:.)-]\s*/i;

export function parseQuizlet(text: string, o: QuizletOptions): { cards: PlainCard[]; skipped: number } {
  const termSep = o.term === 'tab' ? '\t' : o.term === 'comma' ? ',' : o.customTerm || '\t';
  const rowSep = o.row === 'newline' ? /\r?\n/ : o.row === 'semicolon' ? ';' : o.customRow || /\r?\n/;
  let body = text;
  for (const p of PAGE_TEXT) body = body.replace(p, '');
  const rows = body.split(rowSep);
  const tidy = (s: string) => (o.stripLabels ? s.replace(LABEL, '') : s).trim();

  const cards: PlainCard[] = [];
  let skipped = 0;
  for (const raw of rows) {
    // the page's own text can be glued to the first row, as in
    // "…It is read-only.What are…": strip it wherever a row starts with it
    let row = raw;
    for (const p of PAGE_TEXT) row = row.replace(p, '');
    if (!row.trim()) continue;
    const at = row.indexOf(termSep);
    if (at < 0) {
      // a definition running onto another line continues the card before it
      // (when rows are lines); anything before the first card is page text
      if (cards.length && o.row === 'newline' && !PAGE_LINES.test(row.trim())) cards[cards.length - 1].back += `\n${row.trim()}`;
      else if (!PAGE_LINES.test(row.trim())) skipped++;
      continue;
    }
    const front = tidy(row.slice(0, at));
    const back = tidy(row.slice(at + termSep.length));
    if (!front && !back) continue;
    if (!front || !back) {
      skipped++;
      continue;
    }
    cards.push({ front, back });
  }
  return { cards, skipped };
}

/** Plain text to the HTML a card field holds. */
export function toHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}
