// AI for Grid notes. Polish tidies a student's notes (same order, same
// wording, consistent formatting, requests carried out). Polish with figures
// also reads every page of the PDF beside the notes with a vision model, picks
// the figures that would help, has a model arrange them, and lays it all out
// on the grid, sized from each figure's shape and the predicted text heights.

import { CELL_H, CELL_W, DOC, mathOf, MARGIN_CELLS, PAGE_COLS, PAGE_ROWS, SHEET_COLS, cleanStyle, inMargin, layoutAll, layoutText, sheetOf, type GridItem, type ImageBlock, type Rect, type Style, type TextBlock } from './gridText';
import { renderPdfPages } from './pdfRender';
import { askModel, type ModelOptions } from './polish';
import { readMaterial } from './materials';
import { block, repairJson } from './smart';

// ---------------------------------------------------------------- markup

/** Formatting written as marks the models know: **bold**, *italic*,
 * __underline__, ~~strike~~ and ==highlight==, a line wrapped in
 * <center>…</center> or <right>…</right> for its alignment, and formulas as
 * $$ … $$ lines, kept as they are. Colours and fonts aren't kept. */
const styleKey = (s: Style | null | undefined) => (s ? `${+!!s.b}${+!!s.i}${+!!s.u}${+!!s.s}${+!!s.hl}` : '00000');

export function toMarkup(t: Pick<TextBlock, 'text' | 'styles'>): string {
  let pos = 0;
  return t.text
    .split('\n')
    .map((line) => {
      const start = pos;
      pos += line.length + 1;
      if (mathOf(line)) return line;
      let out = '';
      for (let k = start; k < start + line.length; ) {
        const s = t.styles?.[k];
        const id = styleKey(s);
        let e = k;
        while (e < start + line.length && styleKey(t.styles?.[e]) === id) e++;
        const marks = [s?.hl && '==', s?.b && '**', s?.u && '__', s?.s && '~~', s?.i && '*'].filter(Boolean) as string[];
        out += marks.join('') + t.text.slice(k, e) + [...marks].reverse().join('');
        k = e;
      }
      // a short line that's all bold reads as a heading
      out = out.replace(/^\*\*([^*\n]{1,60})\*\*$/, '# $1');
      const align = line.trim() ? t.styles?.[start]?.align : undefined;
      return align ? `<${align}>${out}</${align}>` : out;
    })
    .join('\n');
}

const TOKEN = /\*\*|__|~~|==|\*/g;
const MARK_OF: Record<string, 'b' | 'i' | 'u' | 's' | 'hl'> = { '**': 'b', '*': 'i', __: 'u', '~~': 's', '==': 'hl' };

/** Reads the marks back into text and per-letter styles. "# " lines are bold
 * headings and "- " bullets become "• ". A mark with no partner on its line
 * stays as a literal character. */
export function fromMarkup(md: string, highlight: string): Pick<TextBlock, 'text' | 'styles'> {
  let text = '';
  const styles: (Style | null)[] = [];
  md.replace(/\r\n?/g, '\n').split('\n').forEach((raw, n) => {
    if (n) {
      text += '\n';
      styles.push(null);
    }
    let line = raw.replace(/\s+$/, '');
    const aligned = /^\s*<(center|right)>(.*)<\/\1>$/.exec(line);
    if (aligned) line = aligned[2].trim();
    const align = aligned?.[1] as 'center' | 'right' | undefined;
    // a formula's LaTeX is kept exactly
    if (mathOf(line)) {
      text += line.trim();
      styles.push(...new Array<Style | null>(line.trim().length).fill(align ? { align } : null));
      return;
    }
    const heading = /^#{1,6}\s+/.exec(line);
    if (heading) line = line.slice(heading[0].length);
    line = line.replace(/^(\s*)[-*•]\s+/, '$1• ');
    const on: Style = { ...(heading ? { b: true as const } : {}), ...(align ? { align } : {}) };
    const push = (s: string) => {
      for (const ch of s) {
        text += ch;
        styles.push(cleanStyle(on));
      }
    };
    const tokens = [...line.matchAll(TOKEN)];
    const count = new Map<string, number>();
    for (const t of tokens) count.set(t[0], (count.get(t[0]) ?? 0) + 1);
    const seen = new Map<string, number>();
    let last = 0;
    for (const t of tokens) {
      const m = t[0];
      const i = (seen.get(m) ?? 0) + 1;
      seen.set(m, i);
      push(line.slice(last, t.index));
      last = t.index + m.length;
      if (count.get(m)! % 2 === 1 && i === count.get(m)) {
        push(m);
        continue;
      }
      const key = MARK_OF[m];
      if (key === 'hl') on.hl = on.hl ? undefined : highlight;
      else on[key] = on[key] ? undefined : true;
    }
    push(line.slice(last));
  });
  return { text: text.replace(/\n+$/, ''), styles: styles.slice(0, text.replace(/\n+$/, '').length) };
}

// ---------------------------------------------------------------- the PDFs

/** A PDF open beside the notes. */
export interface NotesPdf {
  blob: Blob;
  name: string;
}

const shortName = (name: string) => {
  const n = name.replace(/\.pdf$/i, '').trim();
  return n.length > 24 ? `${n.slice(0, 23)}…` : n;
};

/** each PDF's pages as text, read once per file */
const pdfPages = new WeakMap<Blob, Promise<string[]>>();
function pagesOf(pdf: NotesPdf): Promise<string[]> {
  let p = pdfPages.get(pdf.blob);
  if (!p) {
    const file = new File([pdf.blob], /\.pdf$/i.test(pdf.name) ? pdf.name : `${pdf.name}.pdf`);
    p = readMaterial(file, 0).then((m) => m.sections.map((x) => x.text.trim()));
    pdfPages.set(pdf.blob, p);
    p.catch(() => pdfPages.delete(pdf.blob));
  }
  return p;
}

/** All the PDFs' text, each page tagged like [f2 p3] (file 2, page 3), within
 * a character budget. `readable` is false when none of them has any text. */
export async function pdfsText(pdfs: NotesPdf[], budget: number): Promise<{ text: string; readable: boolean }> {
  const out: string[] = [];
  let left = budget;
  let readable = false;
  for (const [f, pdf] of pdfs.entries()) {
    const pages = await pagesOf(pdf);
    readable ||= pages.some(Boolean);
    out.push(`## File ${f + 1}: ${pdf.name} (${pages.length} page${pages.length === 1 ? '' : 's'})`);
    for (const [i, t] of pages.entries()) {
      const piece = `[f${f + 1} p${i + 1}]\n${t || '(no text: probably a picture)'}`;
      if (piece.length > left) {
        out.push(`(the rest is cut off: ${budget.toLocaleString()} characters is the limit)`);
        return { text: out.join('\n\n'), readable };
      }
      left -= piece.length;
      out.push(piece);
    }
  }
  return { text: out.join('\n\n'), readable };
}

/** characters of the PDFs' text Polish sees */
const POLISH_PDF_CHARS = 80_000;

// ---------------------------------------------------------------- polish

const POLISH_PROMPT = (line: number) => `You tidy a student's own notes. They're shown on a grid of monospace letters about ${line} letters wide, laid out to print on letter paper at 12-14 pt (about ${PAGE_COLS} letters a line and ${PAGE_ROWS} lines a page), so they should read like a clean printed page: short headings, compact lists, no walls of text.

Keep:
- the order of ideas, and the student's voice: it should still read as their notes, only cleaner.
- every fact. Don't remove anything the student wrote.

Clean up the wording:
- fix spelling, grammar, punctuation and capitalisation, and expand unclear shorthand where the meaning is obvious (keep common abbreviations like e.g., w/, →).
- turn run-on lines and half-sentences into clear, compact points; split a crammed line into several points.
- fill in what the notes clearly imply but leave out: a missing word, an unfinished definition, a blank the student left ("___", "?", "..."), a step skipped in a sequence, the obvious other half of a comparison. Keep it short and certain: only what any textbook would say, never guesses or new topics.

Give the notes structure, and don't hold back:
- "# " starts a heading line wherever the topic changes (short, sentence case). Keep the student's headings, and add ones where a run of notes has none.
- bullets as "- ", with related detail indented under its point two spaces per level ("  - ", "    - "), so the notes show what belongs to what. Indent generously: examples, sub-types, causes and consequences, and details all sit indented under the point they belong to, never flat beside it.
- number anything that's a sequence, a process, steps, stages, ranked items or a count the notes mention ("three types of …"): "1. ", "2. ", with sub-points indented under them.
- **bold** every key term where it's defined or first matters, as "**Term**: meaning" for definitions, and bold the few words in a point that carry it.
- ==highlight== the facts most worth remembering: the definition, result, rule or number an exam would ask for. Use it in every topic, usually two or three highlights each, on the few key words rather than whole sentences.
- *italic* for species names, titles and emphasis; __underline__ and ~~strikethrough~~ only where the student used them.
- one blank line between topics, none inside a topic's lists.
- a line of ${line} dashes on its own ("${'-'.repeat(line)}") draws a ruled line across the page: put one between the major parts of the notes (where the subject shifts, not between every heading), and a shorter run of dashes can underline a title.
- tables as plain columns lined up with spaces, at most ${line} letters wide, with no | or --- borders, when the notes compare things side by side.
- <center>…</center> around a whole line centres it, <right>…</right> right-aligns it. Use them where it reads better: a title at the top, a key formula's label, a short standalone definition or quote. Most lines stay left-aligned.
- maths: a formula, equation or chemical equation worth seeing properly goes on a line of its own as LaTeX between $$ and $$ (e.g. $$E = mc^2$$, $$\\frac{dy}{dx} = 2x$$, $$6CO_2 + 6H_2O \\rightarrow C_6H_{12}O_6 + 6O_2$$); it's drawn as a centred math block. Turn formulas the student wrote out in plain text into this. Small inline maths in a sentence stays plain text (x², a/b, →).

Course material: you may also get the text of the PDFs the notes are on (lecture slides, readings), each page tagged like [f1 p3]. Use it to fill the gaps and blanks the notes imply and to get facts and terms right, never to add topics the notes don't touch.

Requests: the student may write requests to you in the notes, in [[double brackets]] or on a line starting "AI:". Do what they ask (expand, summarise, add an example, make a table, …) where they asked, then remove the request. Also follow any requests given with the notes.

The notes come as blocks, each in a <notes id="..."> tag, using the same marks for the formatting they already have. Reply with every block, polished, in the same tags and nothing else:
<notes id="t1">...</notes>`;

/** Polishes text blocks; returns each block's new markup by id. */
export async function polishNotes(
  key: string,
  model: ModelOptions,
  blocks: { id: string; markup: string }[],
  request: string,
  line: number,
  signal: AbortSignal,
  /** the PDFs' text, for context */
  material = '',
): Promise<Map<string, string>> {
  const user =
    (material ? `The course material the notes are on:\n<material>\n${material}\n</material>\n\n` : '') +
    blocks.map((b) => `<notes id="${b.id}">\n${b.markup}\n</notes>`).join('\n\n') +
    (request.trim() ? `\n\nRequests from the student: ${request.trim()}` : '');
  const reply = await askModel(key, { ...model, jsonMode: false }, user, signal, POLISH_PROMPT(line), 32000);
  if (reply.truncated) throw new Error('The polished notes were cut off. Try polishing a smaller part.');
  const out = new Map<string, string>();
  for (const m of reply.text.matchAll(/<notes id="([^"]+)">\n?([\s\S]*?)\n?<\/notes>/g)) out.set(m[1], m[2]);
  if (!out.size) throw new Error("The model's reply had no notes in it. Try again.");
  return out;
}

// ---------------------------------------------------------------- figures

export type FigureKind = 'diagram' | 'chart' | 'photo' | 'illustration' | 'table' | 'equation' | 'decorative' | 'yours';

export interface Figure {
  id: string;
  /** 1-based; 0 for a picture already in the notes */
  page: number;
  kind: FigureKind;
  /** a brief caption, a few words */
  label: string;
  /** what it shows, in a sentence */
  caption: string;
  topics: string[];
  /** 1 … 5: how much it helps a student */
  value: number;
  src: string;
  /** height / width */
  aspect: number;
  /** a picture already in the notes keeps its place in this section */
  keepIn?: number;
  /** which PDF it's from, when there are several */
  source?: string;
}

const VISION_PROMPT = `You look at one page of a PDF (lecture slides, a textbook, an article) and find the pictures on it that could go in a student's notes.

List each figure: diagrams, charts and graphs, photos, illustrations, labelled drawings, tables or equations drawn as pictures, and purely decorative images (stock photos, scenery, title art), which you mark "decorative".
Leave out logos, icons, page headers and footers, slide backgrounds, bullets and plain paragraphs of text.

For each give:
- "box": [ymin, xmin, ymax, xmax] on a 0-1000 scale of the page, tight around the figure but including its labels, axis titles, legend and key.
- "kind": diagram | chart | photo | illustration | table | equation | decorative
- "label": a brief caption of 2-6 words for under the figure (e.g. "Moss life cycle")
- "caption": one sentence on what it shows, naming the specific subject (e.g. "Moss life cycle: haploid gametophyte, diploid sporophyte and spores")
- "topics": 2-5 keywords
- "value": 1-5, how much it would help a student understand or remember the topic (5 = the key figure, 1 = filler)

Reply with JSON only: {"figures":[...]}. An empty list is fine.`;

function parseJson<T>(text: string): T | null {
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const json = text.slice(start, Math.max(text.lastIndexOf(']'), text.lastIndexOf('}')) + 1);
  try {
    return JSON.parse(json) as T;
  } catch {
    try {
      return JSON.parse(repairJson(json)) as T;
    } catch {
      return null;
    }
  }
}

/** Cuts a box (0-1000, [ymin, xmin, ymax, xmax]) out of a page image. */
async function crop(page: string, box: number[]): Promise<{ src: string; aspect: number } | null> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = page;
  });
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const clamp = (v: number) => Math.max(0, Math.min(1000, Number(v) || 0)) / 1000;
  const [y0, x0, y1, x1] = box.map(clamp);
  const pad = 0.012;
  const sx = Math.max(0, x0 - pad) * W;
  const sy = Math.max(0, y0 - pad) * H;
  const sw = Math.min(1, x1 + pad) * W - sx;
  const sh = Math.min(1, y1 + pad) * H - sy;
  // slivers are text lines or rules, not figures
  if (sw < W * 0.08 || sh < H * 0.06) return null;
  const scale = Math.min(1, 900 / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  canvas.getContext('2d')?.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return { src: canvas.toDataURL('image/webp', 0.85), aspect: sh / sw };
}

const KINDS: FigureKind[] = ['diagram', 'chart', 'photo', 'illustration', 'table', 'equation', 'decorative'];

async function pageFigures(key: string, model: ModelOptions, page: string, n: number, signal: AbortSignal): Promise<Figure[]> {
  const reply = await askModel(
    key,
    model,
    [
      { type: 'text', text: `Page ${n} of the PDF.` },
      { type: 'image_url', image_url: { url: page } },
    ],
    signal,
    VISION_PROMPT,
    6000,
  );
  type Raw = { box?: number[]; kind?: string; label?: string; caption?: string; topics?: unknown; value?: number };
  const raw = parseJson<{ figures?: Raw[] }>(reply.text)?.figures ?? [];
  const out: Figure[] = [];
  for (const f of raw) {
    if (!Array.isArray(f.box) || f.box.length !== 4) continue;
    const cut = await crop(page, f.box);
    if (!cut) continue;
    out.push({
      id: '',
      page: n,
      kind: KINDS.includes(f.kind as FigureKind) ? (f.kind as FigureKind) : 'illustration',
      label: String(f.label ?? '').trim().slice(0, 60),
      caption: String(f.caption ?? '').slice(0, 240),
      topics: Array.isArray(f.topics) ? f.topics.map(String).slice(0, 5) : [],
      value: Math.max(1, Math.min(5, Math.round(Number(f.value) || 2))),
      ...cut,
    });
  }
  return out;
}

/** most pages read from one PDF, and pages read at once */
const MAX_PAGES = 80;
const PAGE_CONCURRENCY = 3;
/** figures found per PDF, so running again doesn't pay to read it twice */
const found = new WeakMap<Blob, Figure[]>();

/** Every figure in the PDF, reading the pages a few at a time. */
export async function pdfFigures(
  key: string,
  model: ModelOptions,
  pdf: Blob,
  signal: AbortSignal,
  onPage: (done: number, total: number) => void,
): Promise<{ figures: Figure[]; pages: number; skipped: number }> {
  const cached = found.get(pdf);
  if (cached) return { figures: cached, pages: 0, skipped: 0 };
  const perPage: Figure[][] = [];
  const running = new Set<Promise<void>>();
  let done = 0;
  let total = 0;
  let pages = 0;
  let failed: unknown = null;
  await renderPdfPages(
    pdf,
    1300 / (window.devicePixelRatio || 1),
    (i, url, count) => {
      pages = count;
      total = Math.min(count, MAX_PAGES);
      const job = pageFigures(key, model, url, i + 1, signal).then(
        (f) => {
          perPage[i] = f;
          onPage(++done, total);
        },
        (e) => {
          failed ??= e;
          onPage(++done, total);
        },
      );
      running.add(job);
      void job.finally(() => running.delete(job));
      // render the next page only once there's room to send it
      return (async () => {
        while (running.size >= PAGE_CONCURRENCY) await Promise.race(running);
      })();
    },
    { maxPages: MAX_PAGES, signal },
  );
  await Promise.all(running);
  signal.throwIfAborted();
  const figures = perPage.flat().filter(Boolean);
  // every page failing is a problem (a model that can't see, say); a few is not
  if (!figures.length && failed) throw failed;
  figures.forEach((f, i) => (f.id = `F${i + 1}`));
  found.set(pdf, figures);
  return { figures, pages: total, skipped: Math.max(0, pages - total) };
}

// ---------------------------------------------------------------- sections

export interface Section {
  markup: string;
  text: string;
  styles?: (Style | null)[];
  /** the first line is a heading */
  heading: boolean;
}

/** Splits polished notes at their "# " headings, or into paragraphs of a
 * few hundred letters when there are none. */
export function splitSections(markup: string, highlight: string): Section[] {
  const lines = markup.replace(/\r\n?/g, '\n').split('\n');
  const parts: string[][] = [];
  const headed = lines.some((l) => /^#{1,6}\s/.test(l));
  for (const l of lines) {
    const last = parts[parts.length - 1];
    const starts = headed ? /^#{1,6}\s/.test(l) : !l.trim() && !!last && last.join('\n').length > 300;
    if (!last || starts) parts.push(headed || l.trim() ? [l] : []);
    else last.push(l);
  }
  return parts
    .map((p) => p.join('\n').trim())
    .filter(Boolean)
    .map((md) => ({ markup: md, heading: /^#{1,6}\s/.test(md), ...fromMarkup(md, highlight) }));
}

// ---------------------------------------------------------------- picking

const PICK_PROMPT = `You pick figures from a PDF to illustrate a student's notes. The notes' sections are S1, S2, …; the figures F1, F2, … say what they show.

Pick the figures that would make a section clearer or easier to remember: a figure fits a section when it shows what that section explains.
- Prefer high-value figures. Skip near-duplicates (the same figure on several pages or slides): keep the clearest one.
- At most one figure per section, two if the section is long and both are key figures.
- Decorative figures only as filler for a section with nothing else, and never more than two in all.
- Picking nothing for a section, or nothing at all, is fine.
- The student's own pictures (U1, …) are already in the notes: always include each, in the section given.

Reply with JSON only: {"picks":[{"figure":"F3","section":"S2","why":"short reason"}]}`;

const shape = (aspect: number) => {
  const r = 1 / aspect;
  return `${r.toFixed(2)}:1 ${r > 1.35 ? 'wide' : r < 0.8 ? 'tall' : 'squarish'}`;
};

export interface FigurePick {
  figure: Figure;
  section: number;
}

export async function pickFigures(key: string, model: ModelOptions, sections: Section[], figures: Figure[], signal: AbortSignal): Promise<FigurePick[]> {
  if (!figures.length) return [];
  const user =
    'Sections:\n' +
    sections.map((s, i) => `S${i + 1} (${s.text.length} letters): ${s.text.slice(0, 500).replace(/\s+/g, ' ')}`).join('\n') +
    '\n\nFigures:\n' +
    figures
      .map((f) =>
        f.kind === 'yours'
          ? `${f.id}: the student's own picture, keep in S${(f.keepIn ?? 0) + 1}`
          : `${f.id}: ${f.source ? `${f.source} ` : ''}page ${f.page}, ${f.kind}, value ${f.value}, ${shape(f.aspect)}: ${f.caption} [${f.topics.join(', ')}]`,
      )
      .join('\n');
  const reply = await askModel(key, model, user, signal, PICK_PROMPT, 8000);
  const raw = parseJson<{ picks?: { figure?: string; section?: string }[] }>(reply.text)?.picks ?? [];
  const byId = new Map(figures.map((f) => [f.id, f]));
  const picks: FigurePick[] = [];
  const used = new Set<string>();
  for (const r of raw) {
    const figure = byId.get(String(r.figure));
    const section = Number(String(r.section).replace(/\D/g, '')) - 1;
    if (!figure || used.has(figure.id) || !(section >= 0 && section < sections.length)) continue;
    used.add(figure.id);
    picks.push({ figure, section: figure.keepIn ?? section });
  }
  // the student's pictures stay even if the model forgot them
  for (const f of figures) if (f.kind === 'yours' && !used.has(f.id)) picks.push({ figure: f, section: f.keepIn ?? 0 });
  return picks;
}

// ---------------------------------------------------------------- layout

/** Left and right margins, in letters. */
export const MARGIN = MARGIN_CELLS;

/** The line the AI lays notes out on: a printed page's, or the screen's
 * when that's narrower. */
export const pageLine = (cols: number) => Math.max(20, Math.min(PAGE_COLS, cols - 2 * MARGIN));
/** Fewest letters per line beside a figure, and on each side of a centred one. */
const MIN_BESIDE = 28;
const MIN_EACH_SIDE = 16;
/** Tallest a figure gets, in rows. */
const MAX_ROWS = 16;
/** Most rows a caption takes; longer ones are shortened. */
const CAPTION_ROWS = 2;
const SIDE_WIDTHS = [25, 30, 35, 40, 45, 50];
/** Narrowest a figure gets, in letters, before it's too small to bother with. */
const MIN_FIGURE = 10;
const CENTRE_WIDTHS = [20, 25, 30, 35, 40];

/** Where a figure sits; text wraps around it on the other side, or both. */
export type Place = 'right' | 'left' | 'centre';
const PLACES: Place[] = ['right', 'left', 'centre'];

/** A width near `want` letters whose height comes out closest to a whole
 * number of rows, so the picture keeps its shape on the grid. */
function fit(want: number, aspect: number, max: number): { width: number; height: number } {
  let best = { width: Math.max(4, Math.min(max, want)), height: 1, err: Infinity };
  for (let w = Math.max(4, want - 1); w <= Math.min(max, want + 1); w++) {
    const exact = (w * CELL_W * aspect) / CELL_H;
    const err = Math.abs(exact - Math.round(exact)) / exact;
    if (err < best.err) best = { width: w, height: Math.max(1, Math.round(exact)), err };
  }
  // too tall: narrower until it fits
  while (best.height > MAX_ROWS && best.width > 4) {
    best.width--;
    best.height = Math.max(1, Math.round((best.width * CELL_W * aspect) / CELL_H));
  }
  return { width: best.width, height: best.height };
}

const pct = (p: number, line: number) => Math.round((p / 100) * line);

/** The widths a figure can take in a place, leaving the text room to read. */
const widthsFor = (place: Place, line: number) =>
  place === 'centre'
    ? CENTRE_WIDTHS.filter((w) => Math.floor((line - pct(w, line)) / 2) - 1 >= MIN_EACH_SIDE)
    : SIDE_WIDTHS.filter((w) => line - pct(w, line) - 1 >= MIN_BESIDE);

const colFor = (place: Place, width: number, line: number) =>
  place === 'left' ? MARGIN : place === 'right' ? MARGIN + line - width : MARGIN + Math.floor((line - width) / 2);

/** A brief caption under every figure from the PDF: "Fig. 2: Moss life
 * cycle (p. 4)", kept to a couple of rows of its width. */
function captionFor(f: Figure, width: number, n = 0): string | null {
  if (f.kind === 'yours') return null;
  const label = f.label || f.caption.split(/[:.;,(]/)[0].trim() || f.kind;
  const words = `Fig. ${n || '0'}: ${label} (${f.source ? `${f.source}, ` : ''}p. ${f.page})`;
  const room = Math.max(width, 14) * CAPTION_ROWS - 2;
  return words.length <= room ? words : `${words.slice(0, room).replace(/\s+\S*$/, '')}…`;
}

function captionRows(text: string | null, width: number): number {
  if (!text) return 0;
  const w = Math.max(width, 14);
  return layoutText({ id: 'c', kind: 'text', col: 0, row: 0, width: w, text }, [], w).rows;
}

/** Rows of text a section takes across the full line. */
const fullRows = (s: Section, line: number) =>
  layoutText({ id: 'x', kind: 'text', col: MARGIN, row: 0, width: line, text: s.text, styles: s.styles }, [], MARGIN + line).rows;

const LAYOUT_PROMPT = `You arrange figures in a student's notes. The notes sit on a grid of monospace letters (each cell 11 px wide and 22 px tall). Every figure is wrapped by text: the notes flow around it, and when a figure is taller than its own section, the next sections keep wrapping around it.

For each figure choose:
- "place": "left" (figure on the left, text on its right), "right" (figure on the right, text on its left) or "centre" (figure in the middle, text on both sides)
- "width": one of the widths offered for that place, in percent of the line

Figures keep their shape: the height follows from the width, nothing is stretched. Choose so that:
- the page reads well: mostly left and right, alternating between consecutive figures; centre only for a small figure in a long passage of text
- charts, tables and labelled diagrams are wide enough to read (usually 35% or more)
- wide figures stay a few rows tall; tall figures stay narrow
- a figure is not much taller than the text left to wrap around it (given), or there's a gap at the end
- decorative figures stay small

Reply with JSON only: {"layout":[{"figure":"F3","place":"right","width":40}]}`;

export interface Placement {
  pick: FigurePick;
  place: Place;
  width: number;
  /** the figure's rows, without its caption */
  height: number;
}

/** Asks the model where each figure goes, then keeps every choice inside
 * what fits: a width offered for that place, and no taller than the text
 * there is to wrap around it. */
export async function arrange(key: string, model: ModelOptions, sections: Section[], picks: FigurePick[], line: number, signal: AbortSignal): Promise<Placement[]> {
  if (!picks.length) return [];
  const rows = sections.map((s) => fullRows(s, line));
  /** rows of text from a section's start to the end of the notes */
  const textLeft = (i: number) => rows.slice(i).reduce((a, b) => a + b + 1, 0);
  const sizes = (p: FigurePick, place: Place) =>
    widthsFor(place, line).map((w) => {
      const f = fit(pct(w, line), p.figure.aspect, line);
      return { pct: w, ...f, total: f.height + captionRows(captionFor(p.figure, f.width, 9), f.width) };
    });
  const user =
    `Line: ${line} letters.\n\n` +
    picks
      .map((p) => {
        const options = PLACES.map((place) => {
          const list = sizes(p, place);
          return `  ${place}: ${list.map((x) => `${x.pct}% → ${x.total} rows`).join('; ') || 'too narrow'}`;
        });
        return (
          `${p.figure.id} in S${p.section + 1} (S${p.section + 1} is ${rows[p.section]} rows; ${textLeft(p.section)} rows of text from there to the end), ` +
          `${p.figure.kind}, ${shape(p.figure.aspect)}: ${p.figure.caption || 'no caption'}\n${options.join('\n')}`
        );
      })
      .join('\n');
  let raw: { figure?: string; place?: string; width?: number }[] = [];
  try {
    raw = parseJson<{ layout?: typeof raw }>((await askModel(key, model, user, signal, LAYOUT_PROMPT, 6000)).text)?.layout ?? [];
  } catch (e) {
    if (signal.aborted) throw e;
    // laid out by the rules below alone
  }
  const asked = new Map(raw.map((r) => [String(r.figure), r]));
  let side: Place = 'left';
  const out = picks.map((p): Placement | null => {
    const r = asked.get(p.figure.id);
    side = side === 'left' ? 'right' : 'left';
    let place: Place = PLACES.includes(r?.place as Place) ? (r!.place as Place) : side;
    if (!widthsFor(place, line).length) place = 'right';
    const want = Number(r?.width) || (place === 'centre' ? 25 : 35);
    const list = sizes(p, place);
    // the widest offered that's no wider than asked and not taller than the text around it
    const room = textLeft(p.section) + 2;
    const fits = list.filter((x) => x.total <= room);
    const choice = [...fits].reverse().find((x) => x.pct <= want) ?? fits[0];
    if (choice) return { pick: p, place, width: choice.width, height: choice.height };
    // taller than the text left even at its narrowest: narrower still, as
    // long as it stays big enough to see, else it's left out
    const caption = captionRows(captionFor(p.figure, 14, 9), 14);
    const width = Math.floor(((room - caption) * CELL_H) / (p.figure.aspect * CELL_W));
    if (width < MIN_FIGURE) return null;
    return { pick: p, place, ...fit(width, p.figure.aspect, width) };
  });
  return out.filter((x): x is Placement => !!x);
}

const newId = () => Math.random().toString(36).slice(2, 9);
const fromPdf = (f: Figure) => (f.page ? { fromPdf: f.page } : {});

/** The notes laid out as one sheet, top to bottom, sections a blank line
 * apart. Each figure starts beside the top of its section (under the
 * heading) and the text of that section, and of the ones after it while the
 * figure lasts, wraps around it. Figures never share rows unless there's a
 * full column of text between them, and never run over a page break. */
export function buildLayout(sections: Section[], placements: Placement[], line: number): GridItem[] {
  const images: ImageBlock[] = [];
  const taken: Rect[] = [];
  const pageOf = (r: number) => Math.floor(r / PAGE_ROWS);
  const clash = (c: Rect) =>
    (c.height <= PAGE_ROWS - 2 * MARGIN_CELLS && (pageOf(c.row) !== pageOf(c.row + c.height - 1) || inMargin(c.row) || inMargin(c.row + c.height - 1))) ||
    taken.some(
      (o) =>
        c.row <= o.row + o.height && o.row <= c.row + c.height && !(c.col >= o.col + o.width + MIN_BESIDE || o.col >= c.col + c.width + MIN_BESIDE),
    );
  const sheet: TextBlock = { id: DOC, kind: 'text', col: MARGIN, row: 0, width: line, text: '' };
  const styles: (Style | null)[] = [];
  let figures = 0;
  sections.forEach((s, i) => {
    // the row this section starts on: a blank line after the text so far
    let row = sheet.text ? layoutText(sheet, images, MARGIN + line, { skip: inMargin }).end.row + 2 : MARGIN_CELLS;
    while (inMargin(row)) row++;
    const anchor = row + (s.heading ? 1 : 0);
    for (const p of placements.filter((x) => x.pick.section === i)) {
      const caption = captionFor(p.pick.figure, p.width, p.pick.figure.kind === 'yours' ? 0 : ++figures);
      const capRows = captionRows(caption, p.width);
      const height = p.height + capRows;
      // the place asked for, then the others, then a little lower down
      const order = [p.place, ...PLACES.filter((x) => x !== p.place)].filter((x) => widthsFor(x, line).length);
      let rect: Rect | null = null;
      for (let r = anchor; !rect && r < anchor + 400; r++) {
        for (const place of order) {
          const c = { col: colFor(place, p.width, line), row: r, width: p.width, height };
          if (!clash(c)) {
            rect = c;
            break;
          }
        }
      }
      if (!rect) continue;
      taken.push(rect);
      images.push({
        id: newId(),
        kind: 'image',
        ...rect,
        src: p.pick.figure.src,
        ...fromPdf(p.pick.figure),
        ...(caption ? { caption, captionRows: capRows } : {}),
      });
    }
    const join = sheet.text ? '\n\n' : '';
    sheet.text += join + s.text;
    styles.push(...new Array<Style | null>(join.length).fill(null), ...(s.styles ?? new Array<Style | null>(s.text.length).fill(null)));
  });
  return [{ ...sheet, width: PAGE_COLS, styles: styles.some(Boolean) ? styles : undefined }, ...images];
}

/** The student's notes and their own pictures, each with how far down the
 * notes it sits (0 at the top, 1 at the bottom). */
export function readNotes(items: GridItem[]): { blocks: TextBlock[]; pictures: { image: ImageBlock; at: number }[] } {
  const sheet = sheetOf(items);
  const blocks = sheet.text.trim() ? [sheet] : [];
  const rows = Math.max(1, layoutAll(items, SHEET_COLS).get(DOC)?.rows ?? 1);
  // figures from an earlier run are chosen again, not kept
  const pictures = items
    .filter((i): i is ImageBlock => i.kind === 'image' && !i.fromPdf)
    .map((image) => ({ image, at: Math.min(1, image.row / rows) }));
  return { blocks, pictures };
}


// ---------------------------------------------------------------- runs

/** Polishes every text block where it is. */
export async function polishInPlace(
  key: string,
  model: ModelOptions,
  items: GridItem[],
  request: string,
  cols: number,
  highlight: string,
  signal: AbortSignal,
  pdfs: NotesPdf[] = [],
): Promise<GridItem[]> {
  const { blocks } = readNotes(items);
  if (!blocks.length) throw new Error('Write some notes first.');
  const material = pdfs.length ? (await pdfsText(pdfs, POLISH_PDF_CHARS)).text : '';
  const ids = new Map(blocks.map((b, k) => [b.id, `t${k + 1}`]));
  const line = Math.min(PAGE_COLS, Math.max(...blocks.map((b) => Math.min(b.width, cols - b.col))));
  const polished = await polishNotes(key, model, blocks.map((b) => ({ id: ids.get(b.id)!, markup: toMarkup(b) })), request, line, signal, material);
  return items.map((it) => {
    const md = it.kind === 'text' ? polished.get(ids.get(it.id) ?? '') : undefined;
    return md === undefined ? it : { ...it, ...fromMarkup(md, highlight) };
  });
}

/** Polish, then figures from the PDFs, chosen and arranged; the notes are
 * laid out again from the top. */
export async function polishWithFigures(o: {
  key: string;
  text: ModelOptions;
  vision: ModelOptions;
  items: GridItem[];
  pdfs: NotesPdf[];
  request: string;
  cols: number;
  highlight: string;
  signal: AbortSignal;
  onStatus: (status: string) => void;
}): Promise<{ items: GridItem[]; report: string }> {
  const { blocks, pictures } = readNotes(o.items);
  if (!blocks.length) throw new Error('Write some notes first.');
  const line = pageLine(o.cols);

  // the notes and the pages are worked on at the same time
  let polishing = true;
  let pages = `Reading the PDF${o.pdfs.length === 1 ? '' : 's'}`;
  const status = () => o.onStatus([polishing && 'Polishing the notes', pages].filter(Boolean).join(' · ') || 'Working');
  status();
  const polishJob = pdfsText(o.pdfs, POLISH_PDF_CHARS)
    .then((m) => polishNotes(o.key, o.text, blocks.map((b, k) => ({ id: `t${k + 1}`, markup: toMarkup(b) })), o.request, line, o.signal, m.text))
    .finally(() => {
      polishing = false;
      status();
    });
  // one PDF after another, so the page count reads naturally
  const figureJob = (async () => {
    const all: Figure[] = [];
    let read = 0;
    let skipped = 0;
    for (const [f, file] of o.pdfs.entries()) {
      const r = await pdfFigures(o.key, o.vision, file.blob, o.signal, (done, total) => {
        pages = `Looking for figures${o.pdfs.length > 1 ? ` in ${shortName(file.name)} (${f + 1} of ${o.pdfs.length})` : ''}: page ${done} of ${total}`;
        status();
      });
      read += r.pages;
      skipped += r.skipped;
      all.push(...r.figures.map((x) => ({ ...x, ...(o.pdfs.length > 1 ? { source: shortName(file.name) } : {}) })));
    }
    return { figures: all.map((x, i) => ({ ...x, id: `F${i + 1}` })), pages: read, skipped };
  })();
  const [polished, pdf] = await Promise.all([polishJob, figureJob]);

  const sections: Section[] = [];
  blocks.forEach((b, k) => {
    sections.push(...splitSections(polished.get(`t${k + 1}`) ?? toMarkup(b), o.highlight));
  });
  const yours: Figure[] = pictures.map((p, j) => ({
    id: `U${j + 1}`,
    page: 0,
    kind: 'yours',
    label: '',
    caption: '',
    topics: [],
    value: 5,
    src: p.image.src,
    aspect: ((p.image.height - (p.image.captionRows ?? 0)) * CELL_H) / (p.image.width * CELL_W),
    keepIn: Math.min(Math.floor(p.at * sections.length), Math.max(0, sections.length - 1)),
  }));

  o.onStatus(`Choosing from ${pdf.figures.length} figures`);
  const picks = await pickFigures(o.key, o.text, sections, [...pdf.figures, ...yours], o.signal);
  o.onStatus('Arranging the page');
  const placements = await arrange(o.key, o.text, sections, picks, line, o.signal);
  const items = buildLayout(sections, placements, line);

  const used = placements.filter((p) => p.pick.figure.kind !== 'yours').length;
  const dropped = picks.length - placements.length;
  const read = pdf.pages ? `Read ${pdf.pages} pages` : 'Used the figures already found in these PDFs';
  const report =
    `${read}: ${pdf.figures.length} figure${pdf.figures.length === 1 ? '' : 's'}, ${used} added.` +
    (dropped ? ` ${dropped} left out: not enough text to wrap around ${dropped === 1 ? 'it' : 'them'}.` : '') +
    (pdf.skipped ? ` Only the first ${MAX_PAGES} pages of each PDF were read.` : '');
  return { items, report };
}

// ---------------------------------------------------------------- fill

/** characters of the PDF's text sent to Fill */
const FILL_PDF_CHARS = 160_000;

const FILL_PROMPT = (line: number) => `You continue a student's notes on a PDF (lecture slides, a chapter, an article), writing the rest of them the way the student would.

You get the student's notes so far and the text of the PDFs they're taking notes on, page by page, each page starting with a tag like [f1 p3] (file 1, page 3). With several files, take them in order.

1. Work out where the student got to: the notes follow the PDF, usually in order. Pages the notes already cover are done.
2. Study the student's style closely and copy it: how much they write per page, headings or not (and how they word them), bullets or sentences, how deep the bullets nest, their abbreviations and symbols (→, w/, b/c, ≈, e.g.), capitalisation, how they mark key terms and definitions, which marks they use and how often, their level of detail, what kinds of content they skip (title pages, outlines, admin, references, examples?), and their voice (questions to themselves, "!!", reminders).
3. Write notes for the rest of the PDF, from where they stopped to the end, in that style, as if the same student kept going. Don't repeat what's covered. Use only what's in the PDF. Skip the kinds of pages the student skipped.

The notes show on a grid of monospace letters about ${line} letters wide. Formatting marks: "# " starts a heading line, **bold**, *italic*, __underline__, ~~strike~~, ==highlight==, "- " bullets, <center>…</center> around a centred line, and $$ … $$ around a LaTeX formula on its own line. Use only the marks the student uses, except that formulas always go in $$ … $$.

Reply in exactly this format:
<covered>the pages the notes already cover, e.g. 1-6, or with several files "file 1, file 2 pages 1-4"</covered>
<style>one short sentence describing the student's style</style>
<notes>the new notes</notes>`;

/** Notes for the rest of the PDF, in the student's own style. */
export async function fillNotes(o: {
  key: string;
  model: ModelOptions;
  items: GridItem[];
  pdfs: NotesPdf[];
  request: string;
  line: number;
  signal: AbortSignal;
  onStatus: (status: string) => void;
}): Promise<{ markup: string; covered: string; style: string; cutOff: boolean }> {
  const { blocks } = readNotes(o.items);
  if (!blocks.length) throw new Error('Take some notes on the PDF first, so Fill can copy your style.');
  o.onStatus(`Reading the PDF${o.pdfs.length === 1 ? '' : 's'}`);
  const material = await pdfsText(o.pdfs, FILL_PDF_CHARS);
  if (!material.readable)
    throw new Error("These PDFs have no text to read (they're probably scanned pictures), so Fill can't continue from them.");
  o.onStatus('Writing the rest in your style');
  const user =
    `The student's notes so far:\n<notes>\n${blocks.map((b) => toMarkup(b)).join('\n\n')}\n</notes>\n\n` +
    `The PDFs:\n${material.text}` +
    (o.request.trim() ? `\n\nRequests from the student: ${o.request.trim()}` : '');
  const reply = await askModel(o.key, { ...o.model, jsonMode: false }, user, o.signal, FILL_PROMPT(o.line), 32000);
  let markup = block(reply.text, 'notes') ?? '';
  // cut off part-way: keep the complete lines
  if (reply.truncated) markup = markup.replace(/\n[^\n]*$/, '');
  markup = markup.trim();
  if (!markup) throw new Error("The model didn't write any notes. Try again.");
  return { markup, covered: block(reply.text, 'covered') ?? '', style: block(reply.text, 'style') ?? '', cutOff: reply.truncated };
}
