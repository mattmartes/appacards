// Text where every letter occupies one cell of a grid, like a voxel. The
// notes are one sheet of text that flows its words row by row through the
// cells images leave free, so letters wrap around a picture on whichever
// sides have room.

/** A cell's size in pixels. */
export const CELL_W = 11;
export const CELL_H = 22;

/** A printed page of letter paper at about 13 pt with 1-inch margins:
 * letters per line and lines per page. */
export const PAGE_COLS = 60;
export const PAGE_ROWS = 34;
/** Empty cells around the text on each edge of a page. */
export const MARGIN_CELLS = 2;
/** The grid's width: a page's line and its side margins. */
export const SHEET_COLS = PAGE_COLS + 2 * MARGIN_CELLS;
/** The rows text skips: just the top margin, as the notes are one
 * continuous page. (They used to skip a margin at each printed page's top
 * and bottom too, which left odd gaps mid-paragraph.) */
export const inMargin = (row: number) => row < MARGIN_CELLS;

export interface Cell {
  col: number;
  row: number;
}

/** Formatting for one character. */
export interface Style {
  b?: true;
  i?: true;
  u?: true;
  s?: true;
  /** highlight colour */
  hl?: string;
  color?: string;
  /** a font's key (see FONTS in Grid notes); missing means the notes' own */
  font?: string;
  /** set on every letter of a line that's centred or right-aligned */
  align?: 'center' | 'right';
}

export interface TextBlock extends Cell {
  id: string;
  kind: 'text';
  /** in cells; the height follows from the text */
  width: number;
  text: string;
  /** one entry per character of `text`; missing when it's all plain */
  styles?: (Style | null)[];
  /** a figure caption from before captions moved onto the figure (read
   * only to turn old notes into a sheet) */
  caption?: true;
}

export interface ImageBlock extends Cell {
  id: string;
  kind: 'image';
  width: number;
  height: number;
  src: string;
  /** the PDF page a figure added by Polish with figures came from */
  fromPdf?: number;
  /** a few words under the picture, taking its last `captionRows` rows */
  caption?: string;
  captionRows?: number;
  /** how the picture sits in its box: all of it, scaled to fit ('fit'), or
   * filling the box with its edges cut off (the default) */
  fit?: 'fit' | 'crop';
}

/** A LaTeX formula, drawn on the grid; text wraps around it like a picture. */
export interface MathItem extends Cell {
  id: string;
  kind: 'math';
  width: number;
  height: number;
  tex: string;
  /** how the formula sits in its box: scaled to fill it (the default), or
   * at its own size, centred and cut off at the edges */
  fit?: 'fit' | 'crop';
  /** the box was resized by hand, so it keeps its size when the formula changes */
  sized?: true;
}

export type GridItem = TextBlock | ImageBlock | MathItem;

export interface Rect extends Cell {
  width: number;
  height: number;
}

/** One cell per character of the text, in order. */
export interface Glyph extends Cell {
  ch: string;
}

export interface TextLayout {
  glyphs: Glyph[];
  /** where the caret goes after the last character */
  end: Cell;
  rows: number;
}

/** Free cells kept between letters and an image. */
const GAP = 1;
/** Gaps narrower than this beside an image stay empty. */
const MIN_SPAN = 3;
const MAX_ROWS = 4000;

/** The runs of free cells [start, end) on a row between `from` and `to`. */
export function freeSpans(row: number, from: number, to: number, obstacles: Rect[]): [number, number][] {
  let spans: [number, number][] = [[from, to]];
  for (const o of obstacles) {
    if (row < o.row || row >= o.row + o.height) continue;
    const a = o.col - GAP;
    const b = o.col + o.width + GAP;
    spans = spans.flatMap(([s, e]): [number, number][] => {
      if (b <= s || a >= e) return [[s, e]];
      const out: [number, number][] = [];
      if (a > s) out.push([s, a]);
      if (b < e) out.push([b, e]);
      return out;
    });
  }
  return spans.filter(([s, e]) => e - s >= MIN_SPAN);
}

/** The LaTeX in a line that's a formula of its own, or null. */
export const mathOf = (line: string): string | null => /^\s*\$\$(.+?)\$\$\s*$/.exec(line)?.[1].trim() || null;

export interface LayoutOptions {
  /** rows a page's margins take, which the text skips */
  skip?: (row: number) => boolean;
}

export function layoutText(block: TextBlock, obstacles: Rect[], gridCols: number, opts: LayoutOptions = {}): TextLayout {
  const right = Math.max(block.col + MIN_SPAN, Math.min(block.col + block.width, gridCols));
  const full = right - block.col;
  let row = block.row;
  let spans: [number, number][] = [];
  let si = 0;
  let c = block.col;

  const enterRow = (r: number) => {
    spans = [];
    for (row = r; row < block.row + MAX_ROWS; row++) {
      if (opts.skip?.(row)) continue;
      spans = freeSpans(row, block.col, right, obstacles);
      if (spans.length) break;
    }
    if (!spans.length) spans = [[block.col, right]];
    si = 0;
    c = spans[0][0];
  };
  const nextSpan = () => {
    if (si + 1 < spans.length) c = spans[++si][0];
    else enterRow(row + 1);
  };
  enterRow(block.row);

  const glyphs: Glyph[] = [];
  const lines = block.text.split('\n');
  let pos = 0;
  lines.forEach((line, li) => {
    const first = glyphs.length;
    const last = li === lines.length - 1;
    for (const t of line.match(/ |[^ ]+/g) ?? []) {
      if (t === ' ') {
        // a space at the end of a run may sit just past it, out of sight
        glyphs.push({ ch: t, col: c, row });
        c++;
        if (c >= spans[si][1]) nextSpan();
        continue;
      }
      let word = t;
      while (word.length) {
        const [s, e] = spans[si];
        if (word.length <= e - c) {
          for (const ch of word) glyphs.push({ ch, col: c++, row });
          break;
        }
        // start the word on a fresh run, and skip slim gaps beside images
        // when a full line would hold it
        if (c > s || (word.length <= full && e - s < full)) {
          nextSpan();
          continue;
        }
        // longer than a whole line: break it
        const room = e - c;
        for (const ch of word.slice(0, room)) glyphs.push({ ch, col: c++, row });
        word = word.slice(room);
        nextSpan();
      }
    }
    if (!last) glyphs.push({ ch: '\n', col: c, row });
    // a centred or right-aligned line moves each of its rows over
    const align = line.trim() ? block.styles?.[pos]?.align : undefined;
    if (align) {
      const byRow = new Map<number, Glyph[]>();
      for (const g of glyphs.slice(first)) {
        if (!byRow.has(g.row)) byRow.set(g.row, []);
        byRow.get(g.row)!.push(g);
      }
      for (const [r, gs] of byRow) {
        const shown = gs.filter((g) => g.ch.trim());
        if (!shown.length) continue;
        const from = shown[0].col;
        const to = shown[shown.length - 1].col + 1;
        const span = freeSpans(r, block.col, right, obstacles).find(([s, e]) => from >= s && to <= e);
        if (!span) continue;
        const shift = align === 'center' ? Math.floor((span[1] - span[0] - (to - from)) / 2) - (from - span[0]) : span[1] - to;
        if (shift <= 0) continue;
        for (const g of gs) g.col += shift;
        if (last && r === row) c += shift;
      }
    }
    if (!last) enterRow(row + 1);
    pos += line.length + 1;
  });
  return { glyphs, end: { col: c, row }, rows: row - block.row + 1 };
}

const isText = (it: GridItem): it is TextBlock => it.kind === 'text';
const isImage = (it: GridItem): it is ImageBlock => it.kind === 'image';
const isMath = (it: GridItem): it is MathItem => it.kind === 'math';

/** Fewest letters worth keeping beside a formula. */
const BESIDE_FORMULA = 16;

/** The cells a formula keeps clear. Text runs beside a formula on one side
 * only, the side it's been moved away from, and only when there's room for
 * a useful column; a formula in the middle reads as a line of its own. */
function formulaRect(m: MathItem, sheet: TextBlock | undefined): Rect {
  if (!sheet) return m;
  const left = sheet.col;
  const right = sheet.col + sheet.width;
  const roomLeft = m.col - left;
  const roomRight = right - (m.col + m.width);
  // the side with text beside it: the roomier one, if it's room enough
  const textLeft = roomLeft >= BESIDE_FORMULA && roomLeft >= roomRight + 4;
  const textRight = roomRight >= BESIDE_FORMULA && roomRight >= roomLeft + 4;
  const col = textLeft ? m.col : left;
  const end = textRight ? m.col + m.width : right;
  return { col, row: m.row, width: end - col, height: m.height };
}

/**
 * Every text block's layout. Images push text aside, and so do figure
 * captions, which sit under their figure and get wrapped around with it.
 */
export function layoutAll(items: GridItem[], cols: number): Map<string, TextLayout> {
  const sheet = items.find((i): i is TextBlock => i.id === DOC && isText(i));
  const images: Rect[] = [...items.filter(isImage), ...items.filter(isMath).map((m) => formulaRect(m, sheet))];
  const out = new Map<string, TextLayout>();
  const captions: Rect[] = [];
  for (const t of items.filter(isText)) {
    if (!t.caption) continue;
    const l = layoutText(t, images, cols);
    out.set(t.id, l);
    captions.push({ col: t.col, row: t.row, width: t.width, height: l.rows });
  }
  const obstacles = [...images, ...captions];
  // the sheet skips each page's top and bottom margin
  for (const t of items.filter(isText)) if (!t.caption) out.set(t.id, layoutText(t, obstacles, cols, t.id === DOC ? { skip: inMargin } : {}));
  return out;
}

/** The id of the notes' one sheet of text. */
export const DOC = 'doc';

/** The sheet of text in a list of items (there's always one). */
export const sheetOf = (items: GridItem[]): TextBlock => items.find((i): i is TextBlock => i.id === DOC && isText(i)) ?? emptySheet();
const emptySheet = (): TextBlock => ({ id: DOC, kind: 'text', col: MARGIN_CELLS, row: 0, width: PAGE_COLS, text: '' });

/**
 * Notes as one sheet of text from the top-left of the grid, flowing around
 * the images. Notes saved as separate text boxes are turned into the sheet
 * with every letter kept on the cell it was on: each row's letters in order,
 * with spaces for the free cells between them. Captions written as text under
 * a figure become that figure's caption.
 */
export function toSheet(items: GridItem[], cols = SHEET_COLS): GridItem[] {
  const texts = items.filter(isText);
  if (texts.length === 1 && texts[0].id === DOC) {
    // a sheet from before the margins starts at the grid's edge
    const t = texts[0];
    return t.col === MARGIN_CELLS && t.width === PAGE_COLS ? items : items.map((x) => (x === t ? { ...t, col: MARGIN_CELLS, width: PAGE_COLS } : x));
  }
  const layouts = layoutAll(items, cols);
  const images = items.filter(isImage).map((i) => ({ ...i }));
  for (const t of texts.filter((x) => x.caption)) {
    const im = images.find((i) => t.row === i.row + i.height && t.col < i.col + i.width && i.col < t.col + t.width);
    if (!im) continue;
    const rows = layouts.get(t.id)!.rows;
    Object.assign(im, { caption: t.text, captionRows: rows, height: im.height + rows });
  }
  const cells = new Map<number, { col: number; ch: string; style: Style | null }[]>();
  for (const t of texts.filter((x) => !x.caption))
    layouts.get(t.id)!.glyphs.forEach((g, k) => {
      if (g.ch === '\n') return;
      if (!cells.has(g.row)) cells.set(g.row, []);
      cells.get(g.row)!.push({ col: g.col, ch: g.ch, style: t.styles?.[k] ?? null });
    });
  const covered = (r: number, x: number) => images.some((im) => r >= im.row && r < im.row + im.height && x >= im.col - GAP && x < im.col + im.width + GAP);
  let text = '';
  const styles: (Style | null)[] = [];
  const lastRow = Math.max(-1, ...cells.keys());
  for (let r = 0; r <= lastRow; r++) {
    if (r) {
      text += '\n';
      styles.push(null);
    }
    const row = (cells.get(r) ?? []).sort((a, b) => a.col - b.col);
    while (row.length && row[row.length - 1].ch === ' ' && !row[row.length - 1].style) row.pop();
    let col = freeSpans(r, MARGIN_CELLS, cols, images)[0]?.[0] ?? MARGIN_CELLS;
    for (const c of row) {
      let gap = 0;
      for (let x = col; x < c.col; x++) if (!covered(r, x)) gap++;
      text += ' '.repeat(gap) + c.ch;
      styles.push(...new Array<Style | null>(gap).fill(null), c.style);
      col = c.col + 1;
    }
  }
  return [{ ...emptySheet(), text, styles: pack(styles) }, ...images, ...items.filter(isMath)];
}

const newItemId = () => Math.random().toString(36).slice(2, 9);

/**
 * Formula lines ("$$ … $$") in the text become formula items where they sit,
 * centred, so they can be dragged around; the caret's own line is left
 * alone while it's being written. `size` measures a formula in cells.
 */
export function liftFormulas(
  items: GridItem[],
  cols: number,
  caret: number | null,
  size: (tex: string) => { cols: number; rows: number },
): { items: GridItem[]; caret: number | null } {
  let list = items;
  let k = caret;
  for (let guard = 0; guard < 200; guard++) {
    const sheet = sheetOf(list);
    const text = sheet.text;
    let found: { start: number; end: number; tex: string } | null = null;
    let pos = 0;
    for (const line of text.split('\n')) {
      const end = pos + line.length;
      const tex = mathOf(line);
      if (tex && !(k !== null && k >= pos && k <= end)) {
        found = { start: pos, end, tex };
        break;
      }
      pos = end + 1;
    }
    if (!found) break;
    const layout = layoutAll(list, cols).get(DOC)!;
    const row = layout.glyphs[found.start]?.row ?? layout.end.row;
    // the line goes, with its line break
    let from = found.start;
    let to = found.end;
    if (text[to] === '\n') to++;
    else if (from > 0) from--;
    const styles = stylesOf(sheet);
    styles.splice(from, to - from);
    const next: TextBlock = { ...sheet, text: text.slice(0, from) + text.slice(to), styles: pack(styles) };
    if (k !== null && k > from) k = Math.max(from, k - (to - from));
    const sz = size(found.tex);
    const width = Math.min(sheet.width, sz.cols);
    const m: MathItem = { id: newItemId(), kind: 'math', col: sheet.col + Math.floor((sheet.width - width) / 2), row, width, height: sz.rows, tex: found.tex };
    list = [...list.map((i) => (i.id === DOC ? next : i)), m];
  }
  return { items: list, caret: k };
}

/** The formulas written back into the text as "$$ … $$" lines where they
 * sit, for the AI to read and rewrite with the notes. */
export function formulasIntoText(items: GridItem[], cols: number): GridItem[] {
  const maths = items.filter(isMath).sort((a, b) => b.row - a.row);
  if (!maths.length) return items;
  const layout = layoutAll(items, cols).get(DOC)!;
  const sheet = sheetOf(items);
  let text = sheet.text;
  const styles = stylesOf(sheet);
  for (const m of maths) {
    const k = layout.glyphs.findIndex((g) => g.row >= m.row);
    const at = k < 0 ? text.length : text.lastIndexOf('\n', k - 1) + 1;
    const line = `$$${m.tex}$$`;
    const insert = at >= text.length && text ? `\n${line}` : `${line}\n`;
    text = text.slice(0, at) + insert + text.slice(at);
    styles.splice(at, 0, ...new Array<Style | null>(insert.length).fill(null));
  }
  return [{ ...sheet, text, styles: pack(styles) }, ...items.filter((i) => i.id !== DOC && !isMath(i))];
}

/**
 * Where a click on the sheet puts the caret. A click on a row the caret isn't
 * on goes just after the last letter left of the click (an empty row: its
 * start); a second click on the same row goes to the cell clicked. Past the end of the text, or of a line, the caret shows
 * on the cell and `fill` is the line breaks and spaces typing puts in first
 * to get there.
 */
export function clickTarget(
  sheet: TextBlock,
  layout: TextLayout,
  cell: Cell,
  exact: boolean,
  obstacles: Rect[],
): { at: number; fill: string; cell: Cell } {
  const rowStart = (r: number) => freeSpans(r, sheet.col, sheet.col + sheet.width, obstacles)[0]?.[0] ?? sheet.col;
  // a click in the top margin goes to the first row text can use
  if (inMargin(cell.row)) cell = { col: cell.col, row: MARGIN_CELLS };
  cell = { col: Math.max(sheet.col, Math.min(sheet.col + sheet.width - 1, cell.col)), row: cell.row };
  const last = layout.end.row;
  if (cell.row > last) {
    const start = rowStart(cell.row);
    const col = exact ? Math.max(start, cell.col) : start;
    // one line break for each row text can use on the way down
    let breaks = 0;
    for (let r = last + 1; r <= cell.row; r++) if (!inMargin(r)) breaks++;
    return { at: sheet.text.length, fill: '\n'.repeat(breaks) + ' '.repeat(col - start), cell: { col, row: cell.row } };
  }
  const onRow = layout.glyphs.map((g, k) => ({ g, k })).filter((x) => x.g.row === cell.row);
  if (!onRow.length) {
    if (cell.row === last) {
      const start = layout.end.col;
      const col = exact ? Math.max(start, cell.col) : start;
      return { at: sheet.text.length, fill: ' '.repeat(col - start), cell: { col, row: cell.row } };
    }
    // a row the text passes over (beside a wide image): the nearest place
    const k = indexAt(layout, cell.col, cell.row);
    return { at: k, fill: '', cell: caretAt(layout, k) };
  }
  if (!exact) {
    // just after the last letter left of the click, or the row's start
    const before = onRow.filter((x) => x.g.ch.trim() && x.g.col < cell.col).pop();
    if (!before) return { at: onRow[0].k, fill: '', cell: { col: onRow[0].g.col, row: cell.row } };
    return { at: before.k + 1, fill: '', cell: { col: before.g.col + 1, row: cell.row } };
  }
  const lastOnRow = onRow[onRow.length - 1];
  const endAt = lastOnRow.g.ch === '\n' ? lastOnRow.k : lastOnRow.k + 1;
  const endCol = lastOnRow.g.ch === '\n' ? lastOnRow.g.col : lastOnRow.g.col + 1;
  if (cell.col > endCol) return { at: endAt, fill: ' '.repeat(cell.col - endCol), cell };
  const k = indexAt(layout, cell.col, cell.row);
  return { at: k, fill: '', cell: caretAt(layout, k) };
}

/** The caret's cell for a character index (0 … text length). */
export const caretAt = (layout: TextLayout, i: number): Cell => layout.glyphs[i] ?? layout.end;

/** The character index nearest a point; `col` is fractional, in cells. */
export function indexAt(layout: TextLayout, col: number, row: number): number {
  let best = 0;
  let bestScore = Infinity;
  const consider = (k: number, p: Cell) => {
    const score = Math.abs(p.row - row) * 1000 + Math.abs(p.col - col);
    if (score < bestScore) {
      best = k;
      bestScore = score;
    }
  };
  layout.glyphs.forEach((g, k) => {
    consider(k, g);
    if (g.ch !== '\n') consider(k + 1, { col: g.col + 1, row: g.row });
  });
  consider(layout.glyphs.length, layout.end);
  return best;
}

/** Every character's formatting, null where it's plain. */
export function stylesOf(t: TextBlock): (Style | null)[] {
  const out: (Style | null)[] = [];
  for (let k = 0; k < t.text.length; k++) out.push(t.styles?.[k] ?? null);
  return out;
}

/** Drops unset marks; null when nothing is left. */
export function cleanStyle(s: Style | null | undefined): Style | null {
  if (!s) return null;
  const out: Style = {};
  if (s.b) out.b = true;
  if (s.i) out.i = true;
  if (s.u) out.u = true;
  if (s.s) out.s = true;
  if (s.hl) out.hl = s.hl;
  if (s.color) out.color = s.color;
  if (s.font) out.font = s.font;
  if (s.align) out.align = s.align;
  return Object.keys(out).length ? out : null;
}

const pack = (styles: (Style | null)[]) => (styles.some(Boolean) ? styles : undefined);

/** Replaces text[from, to) with `insert`, all in one style. */
export function spliceText(t: TextBlock, from: number, to: number, insert: string, style: Style | null): Pick<TextBlock, 'text' | 'styles'> {
  const styles = stylesOf(t);
  styles.splice(from, to - from, ...new Array<Style | null>(insert.length).fill(cleanStyle(style)));
  return { text: t.text.slice(0, from) + insert + t.text.slice(to), styles: pack(styles) };
}

/** Changes the formatting of text[from, to). */
export function restyle(t: TextBlock, from: number, to: number, change: (s: Style | null) => Style | null): Pick<TextBlock, 'styles'> {
  const styles = stylesOf(t);
  for (let k = from; k < to; k++) styles[k] = cleanStyle(change(styles[k]));
  return { styles: pack(styles) };
}

/** The word around index i, as [start, end). */
export function wordAt(text: string, i: number): [number, number] {
  const inWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_'-]/u.test(ch);
  let a = i;
  let b = i;
  while (inWord(text[a - 1])) a--;
  while (inWord(text[b])) b++;
  if (a === b && b < text.length) b++;
  return [a, b];
}
