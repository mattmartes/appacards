// Grid notes: note text where every letter occupies one cell of a grid. The
// notes are one sheet of text, a printed page wide: click any cell and type
// there. Images and formulas sit on the grid and push the letters around
// them. The editor is the Lab's experiment, and the editor of the notes you
// write in a deck's Notes.

import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  CELL_H,
  CELL_W,
  MARGIN_CELLS,
  PAGE_COLS,
  SHEET_COLS,
  HIGHLIGHTS,
  TEXT_COLORS,
  DOC,
  caretAt,
  clickTarget,
  indexAt,
  formulasIntoText,
  layoutAll,
  liftFormulas,
  restyle,
  sheetOf,
  spliceText,
  toSheet,
  stylesOf,
  wordAt,
  type Cell,
  type GridItem,
  type ImageBlock,
  type MathItem,
  type Style,
  type TextBlock,
} from '../lib/gridText';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { addLabPdf, loadLabPdfs, newPdfId, removeLabPdf, saveLabTabs, type LabPdf } from '../lib/labPdf';
import { fillNotes, fromMarkup, pageLine, polishInPlace, polishSelection, polishWithFigures, toMarkup } from '../lib/notesAi';
import { DEFAULT_MODEL, savedKey, type ModelInfo, type ModelOptions } from '../lib/polish';
import { useModels } from './AiPrefs';
import { FormulaEditor } from './FormulaEditor';
import { GridPdf } from './GridPdf';
import { canShowBrowser, NotesBrowser } from './NotesBrowser';

/** whether the notes' toolbars are folded away, remembered on this computer */
const TOOLS_STORE = 'appa-notes-tools-hidden';

/** How the side beside the notes is set out, remembered on this computer. */
const SIDE_STORE = 'appa-notes-side';
function readSide(): { browser: boolean; browserFirst: boolean; split: number } {
  try {
    const s = JSON.parse(localStorage.getItem(SIDE_STORE) ?? '{}') as Partial<{ browser: boolean; browserFirst: boolean; split: number }>;
    return { browser: !!s.browser, browserFirst: s.browserFirst ?? true, split: typeof s.split === 'number' ? s.split : 0.5 };
  } catch {
    return { browser: false, browserFirst: true, split: 0.5 };
  }
}
function saveSide(s: { browser: boolean; browserFirst: boolean; split: number }) {
  try {
    localStorage.setItem(SIDE_STORE, JSON.stringify(s));
  } catch {
    // set out as before next time
  }
}

const STORE = 'appa-gridlab';
const PAPER_STORE = 'appa-gridlab-paper';

/** How the page looks: following the app's theme, black with white text,
 * white with black text, or ruled notebook paper. */
export type Paper = 'theme' | 'dark' | 'white' | 'lined';

/** What a grid note is saved as. */
export interface GridNoteData {
  items: GridItem[];
  paper?: Paper;
}
/** what Tab types, and Backspace in an indent takes away at once */
const TAB = '    ';

const newId = () => Math.random().toString(36).slice(2, 9);

const DEMO_IMAGE =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#8dbb97"/><stop offset="1" stop-color="#2f6b4f"/></linearGradient></defs>' +
      '<rect width="160" height="120" rx="8" fill="url(#g)"/><circle cx="118" cy="34" r="14" fill="#f4e7b4"/>' +
      '<path d="M0 120 L50 60 L80 90 L110 55 L160 120Z" fill="#1f4636" opacity=".85"/></svg>',
  );

function demo(): GridItem[] {
  return [
    {
      id: DOC,
      kind: 'text',
      col: MARGIN_CELLS,
      row: 0,
      width: PAGE_COLS,
      text:
        'Bryophytes are small, non-vascular land plants: mosses, liverworts and hornworts. Without xylem and phloem they move ' +
        'water by diffusion and capillary action, which is why they stay low and grow in damp places.\n\n' +
        'Their life cycle is dominated by the haploid gametophyte, the green leafy plant you see. The diploid sporophyte grows ' +
        'out of it and stays attached, relying on the gametophyte for water and nutrients. Sperm swim to the egg through a film ' +
        'of water, so fertilisation needs moisture.\n\n' +
        'Ferns, by contrast, are vascular, and their sporophyte is the large independent plant.',
    },
    { id: newId(), kind: 'image', col: 40, row: 3, width: 18, height: 6, src: DEMO_IMAGE },
  ];
}

function load(): GridItem[] {
  try {
    const raw = localStorage.getItem(STORE);
    // notes saved as separate text boxes become one sheet
    if (raw) return liftFormulas(toSheet(JSON.parse(raw) as GridItem[]), SHEET_COLS, null, formulaSize).items;
  } catch {
    // start with the demo
  }
  return demo();
}

/** Shrinks a picture so the notes stay small enough to keep. */
async function readImage(file: File): Promise<{ src: string; aspect: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
    const scale = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { src: canvas.toDataURL('image/webp', 0.85), aspect: img.naturalHeight / img.naturalWidth };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Fonts for the letters. Each letter sits in its own cell, centred, so any
 * font works; fonts that aren't monospaced are sized so most letters fill
 * their cell, with the few too wide for one drawn a little narrower. */
const FONTS = [
  { key: 'mono', name: 'Mono', stack: "ui-monospace, 'Cascadia Code', Consolas, monospace", mono: true },
  { key: 'typewriter', name: 'Typewriter', stack: "'Courier New', Courier, monospace", mono: true },
  { key: 'sans', name: 'Sans', stack: "'Segoe UI', system-ui, Arial, sans-serif", mono: false },
  { key: 'serif', name: 'Serif', stack: "Georgia, 'Times New Roman', serif", mono: false },
  { key: 'hand', name: 'Handwriting', stack: "'Segoe Print', 'Ink Free', 'Bradley Hand', cursive", mono: false },
  { key: 'casual', name: 'Casual', stack: "'Comic Sans MS', 'Chalkboard SE', 'Comic Neue', cursive", mono: false },
];
const FONT_STORE = 'appa-gridlab-font';
const fontOf = (key: string | undefined) => FONTS.find((f) => f.key === key) ?? FONTS[0];

const measure = document.createElement('canvas').getContext('2d');
/** the size each font is drawn at, and how much each too-wide letter is narrowed */
const fontSizes = new Map<string, number>();
const narrowing = new Map<string, number>();

/** The size where a font's typical lowercase letter nearly fills a cell. */
function fontSize(key: string): number {
  let size = fontSizes.get(key);
  if (size === undefined) {
    size = 15;
    if (measure) {
      measure.font = `20px ${fontOf(key).stack}`;
      const widths = [...'abcdefghijklmnopqrstuvwxyz'].map((ch) => measure.measureText(ch).width).sort((x, y) => x - y);
      const typical = widths[Math.floor(widths.length / 2)];
      size = Math.max(12, Math.min(18, Math.round(((20 * (CELL_W - 2)) / typical) * 2) / 2));
    }
    fontSizes.set(key, size);
  }
  return size;
}

/** Where a word's letters are drawn: each one's left edge and width, in
 * pixels from the word's first cell, and the style that sets them so. */
interface WordLayout {
  fit: { paddingLeft?: number; letterSpacing?: number; transform?: string };
  at: number[];
  w: number[];
}

/**
 * A word in a font that isn't monospaced, set in its cells: the font's own
 * spacing, opened up a little when the word is narrower than its cells (the
 * rest of the room left after it), or squeezed when it's wider. Measured a
 * letter at a time (words are drawn without kerning or ligatures to match),
 * so the caret, the selection and clicks can find each letter.
 */
const wordLayouts = new Map<string, WordLayout>();
function wordLayout(key: string, letters: { ch: string; b: boolean; i: boolean }[]): WordLayout {
  const id = `${key}|${letters.map((l) => `${l.b ? 'b' : ''}${l.i ? 'i' : ''}${l.ch}`).join('')}`;
  let lay = wordLayouts.get(id);
  if (!lay) {
    const widths = letters.map((l) => {
      if (!measure) return CELL_W;
      measure.font = `${l.i ? 'italic ' : ''}${l.b ? '700 ' : ''}${fontSize(key)}px ${fontOf(key).stack}`;
      return measure.measureText(l.ch).width;
    });
    const n = letters.length;
    const natural = widths.reduce((x, y) => x + y, 0);
    const room = n * CELL_W;
    const at: number[] = [];
    const w: number[] = [];
    let fit: WordLayout['fit'];
    if (natural > room) {
      const k = room / natural;
      let x = 0;
      for (const wd of widths) {
        at.push(x * k);
        w.push(wd * k);
        x += wd;
      }
      fit = { transform: `scaleX(${k.toFixed(4)})` };
    } else {
      // letters spread a little (up to 3px) to take up most of the spare
      // room, and the word sits in the middle of the rest, so the gap between
      // words stays about the same however wide or narrow their letters are
      // (11-18px in Segoe UI at the notes' size, where it was 11-36px)
      const spread = Math.min(3, (room - natural) / n);
      const rest = room - natural - spread * n;
      const pad = rest / 2;
      let x = pad;
      for (const wd of widths) {
        at.push(x);
        w.push(wd + spread);
        x += wd + spread;
      }
      fit = { letterSpacing: spread, paddingLeft: pad };
    }
    lay = { fit, at, w };
    if (wordLayouts.size > 5000) wordLayouts.clear();
    wordLayouts.set(id, lay);
  }
  return lay;
}

/** Marks drawn in a word's cells, behind its letters. */
const MARKS_BEHIND = new Set(['u', 's', 'hl', 'hl-start', 'hl-end', 'picked']);

/** How much to narrow a letter that's too wide for its cell (1: not at all). */
function narrow(key: string, ch: string, bold: boolean): number {
  const id = `${key}|${bold ? 'b' : ''}|${ch}`;
  let k = narrowing.get(id);
  if (k === undefined) {
    k = 1;
    if (measure) {
      measure.font = `${bold ? '700 ' : ''}${fontSize(key)}px ${fontOf(key).stack}`;
      const w = measure.measureText(ch).width;
      if (w > CELL_W - 0.5) k = (CELL_W - 0.5) / w;
    }
    narrowing.set(id, k);
  }
  return k;
}

const MARKS = [
  { key: 'b', label: 'B', name: 'Bold', keys: 'Ctrl+B' },
  { key: 'i', label: 'I', name: 'Italic', keys: 'Ctrl+I' },
  { key: 'u', label: 'U', name: 'Underline', keys: 'Ctrl+U' },
  { key: 's', label: 'S', name: 'Strikethrough', keys: 'Ctrl+Shift+X' },
] as const;
type Mark = (typeof MARKS)[number]['key'];

/** The polished notes arriving: the old notes fade, the new layout shows as
 * a skeleton (text rows as bars, figures as boxes), then one pass fills it
 * in from top to bottom. */
const LEAVE_MS = 280;
const FILL_START = 700;
const FILL_MS = 1500;
type Reveal = 'leaving' | 'revealing' | null;
const calmMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Formulas drawn with KaTeX, and the cells each takes on the grid. */
const formulas = new Map<string, { html: string; cols: number; rows: number; w: number; h: number }>();
/** A formula's drawing, its size in cells, and its natural size in pixels. */
function formula(tex: string): { html: string; cols: number; rows: number; w: number; h: number } {
  let f = formulas.get(tex);
  if (!f) {
    const html = katex.renderToString(tex, { displayMode: true, throwOnError: false, output: 'html' });
    // measured off screen, at its natural size
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;display:inline-block;white-space:nowrap;font-size:15px';
    probe.innerHTML = html;
    document.body.appendChild(probe);
    const box = (probe.querySelector('.katex') ?? probe).getBoundingClientRect();
    const h = box.height;
    probe.remove();
    f = { html, cols: Math.max(4, Math.ceil(box.width / CELL_W) + 2), rows: Math.max(1, Math.ceil((h + 4) / CELL_H)), w: box.width, h };
    formulas.set(tex, f);
  }
  return f;
}
const formulaSize = (tex: string) => formula(tex);

/** One row of letters. Its letters are drawn once for each distinct row and
 * kept; when lines shift (Enter, say) only the row's position changes. */
const GlyphRow = memo(function GlyphRow({ top, cells }: { top: number; cells: ReactNode }) {
  return (
    <div className="grid-row" style={{ top }}>
      {cells}
    </div>
  );
});
/** wait this long after the last change before saving */
const SAVE_DELAY = 500;

const modelOptions = (id: string, info: ModelInfo | undefined): ModelOptions => ({
  model: id,
  jsonMode: info?.supported_parameters?.includes('response_format'),
  maxTokens: info?.top_provider?.max_completion_tokens ?? undefined,
});

/** Lab → Grid notes: one set of notes, kept in this browser. */
export function GridLab() {
  return (
    <GridEditor
      header={
        <header className="page-head">
          <div>
            <h1>Grid notes</h1>
            <p className="muted">One letter per cell, a printed page wide. Click anywhere and type; images push the text around them.</p>
          </div>
        </header>
      }
      open={() => {
        let paper: Paper = 'theme';
        try {
          paper = (localStorage.getItem(PAPER_STORE) as Paper | null) ?? 'theme';
        } catch {
          // the app's theme
        }
        return { items: load(), paper };
      }}
      onSave={(d) => {
        localStorage.setItem(STORE, JSON.stringify(d.items));
        localStorage.setItem(PAPER_STORE, d.paper ?? 'theme');
      }}
      demo={demo}
    />
  );
}

/** The editor: `open` is read once, and `onSave` gets the notes a moment
 * after each change (it may throw, or return a promise that fails). */
export function GridEditor({
  header,
  open,
  onSave,
  demo,
}: {
  header: ReactNode;
  open: () => GridNoteData;
  onSave: (data: GridNoteData) => void | Promise<void>;
  /** offers "Reset to the example" */
  demo?: () => GridItem[];
}) {
  const [start] = useState(open);
  const [items, setItems] = useState<GridItem[]>(() => liftFormulas(toSheet(start.items), SHEET_COLS, null, formulaSize).items);
  // a note keeps the paper it was saved with; there's no menu to change it any more
  const [paper] = useState<Paper>(start.paper ?? 'theme');
  const [active, setActive] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  /** the other end of a text selection; null when there isn't one */
  const [anchor, setAnchor] = useState<number | null>(null);
  /** formatting for the next typed letters, set by the toolbar with nothing selected */
  const [pending, setPending] = useState<Style | null>(null);
  /** a click past the end of a line: the cell the caret shows on, and the
   * spaces or line breaks typing will put in first to get there */
  const [pad, setPad] = useState<{ at: number; fill: string; cell: Cell } | null>(null);
  const [focused, setFocused] = useState(false);
  /** moved blocks snap to every letter across */
  const snap = 1;
  const [showGrid, setShowGrid] = useState(true);
  /** the font letters use unless they're set to another */
  const [noteFont, setNoteFont] = useState(() => {
    try {
      return localStorage.getItem(FONT_STORE) ?? 'mono';
    } catch {
      return 'mono';
    }
  });
  const [saveFailed, setSaveFailed] = useState(false);
  const [cols, setCols] = useState(SHEET_COLS);
  const gridRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const [dragging, setDragging] = useState(false);
  const past = useRef<GridItem[][]>([]);
  const future = useRef<GridItem[][]>([]);
  const lastEdit = useRef({ kind: '', at: 0 });
  const pdfInputRef = useRef<HTMLInputElement>(null);
  /** the PDFs open beside the notes, a tab each, and the one showing */
  const [pdfs, setPdfs] = useState<LabPdf[]>([]);
  const [activePdf, setActivePdf] = useState<string | null>(null);
  const pdf = pdfs.find((p) => p.id === activePdf) ?? pdfs[0] ?? null;
  const [pdfWidth, setPdfWidth] = useState(() => Math.round(Math.max(300, Math.min(620, window.innerWidth * 0.36))));
  /** a browser beside the notes (desktop app), on its own or sharing the side with the PDFs */
  const [browserOpen, setBrowserOpen] = useState(() => canShowBrowser() && readSide().browser);
  /** with both open: which goes on top, and the top one's share of the height (from the divider) */
  const [browserFirst, setBrowserFirst] = useState(() => readSide().browserFirst);
  const [split, setSplit] = useState(() => readSide().split);
  /** while a divider is dragged: the browser mustn't catch the pointer */
  const [resizing, setResizing] = useState(false);
  useEffect(() => saveSide({ browser: browserOpen, browserFirst, split }), [browserOpen, browserFirst, split]);
  const side = !!pdf || browserOpen;
  /** the toolbars (images, snap, paper, AI, formatting) folded away for more room */
  const [toolsHidden, setToolsHidden] = useState(() => {
    try {
      return localStorage.getItem(TOOLS_STORE) === '1';
    } catch {
      return false;
    }
  });
  const toggleTools = () => {
    const next = !toolsHidden;
    setToolsHidden(next);
    try {
      localStorage.setItem(TOOLS_STORE, next ? '1' : '0');
    } catch {
      // shown again next time
    }
  };
  const [request, setRequest] = useState('');
  /** what the AI is doing, while it works */
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiReport, setAiReport] = useState<string | null>(null);
  const aiAbort = useRef<AbortController | null>(null);
  const { models, initial } = useModels();
  const [reveal, setReveal] = useState<Reveal>(null);
  /** the formula being edited (id null: a new one) */
  const [texEdit, setTexEdit] = useState<{ id: string | null; tex: string } | null>(null);
  // formulas measured before KaTeX's fonts arrived are measured again once they have
  const [, setFontsIn] = useState(0);
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    const again = () => {
      formulas.clear();
      setFontsIn((n) => n + 1);
    };
    fonts.addEventListener('loadingdone', again);
    return () => fonts.removeEventListener('loadingdone', again);
  }, []);
  /** what the reveal fills in: after Fill, only what's new (not these blocks), from this row */
  const [revealScope, setRevealScope] = useState<{ keep: Set<string>; from: number } | null>(null);

  useEffect(() => {
    void loadLabPdfs().then((t) => {
      setPdfs((now) => (now.length ? now : t.list));
      setActivePdf((now) => now ?? t.active);
    });
    return () => aiAbort.current?.abort();
  }, []);

  /** Opens PDFs in new tabs, showing the last one. */
  const openPdfs = (files: File[]) => {
    const added = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)).map((f) => ({ id: newPdfId(), blob: f, name: f.name }));
    if (!added.length) return;
    const list = [...pdfs, ...added];
    const active = added[added.length - 1].id;
    setPdfs(list);
    setActivePdf(active);
    for (const p of added) void addLabPdf(p);
    void saveLabTabs({ list, active });
  };
  const showPdf = (id: string) => {
    setActivePdf(id);
    void saveLabTabs({ list: pdfs, active: id });
  };
  /** Closes a tab; the one next to it shows instead. */
  const closePdf = (id: string) => {
    const at = pdfs.findIndex((p) => p.id === id);
    const list = pdfs.filter((p) => p.id !== id);
    const active = id === pdf?.id ? (list[Math.min(at, list.length - 1)]?.id ?? null) : (pdf?.id ?? null);
    setPdfs(list);
    setActivePdf(active);
    void removeLabPdf(id);
    void saveLabTabs({ list, active });
  };

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCols(Math.max(20, Math.floor(el.clientWidth / CELL_W))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // saved once typing pauses: the notes (with their pictures) can be large,
  // and writing them out on every key made typing lag
  const unsaved = useRef<GridNoteData | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const save = () => {
    const data = unsaved.current;
    if (!data) return;
    unsaved.current = null;
    try {
      const done = onSaveRef.current(data);
      setSaveFailed(false);
      if (done) done.catch(() => setSaveFailed(true));
    } catch {
      setSaveFailed(true);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  const first = useRef(true);
  useEffect(() => {
    // nothing to save until something changes
    if (first.current) {
      first.current = false;
      return;
    }
    unsaved.current = { items, paper };
    const t = setTimeout(() => saveRef.current(), SAVE_DELAY);
    return () => clearTimeout(t);
  }, [items, paper]);
  useEffect(() => {
    const flush = () => saveRef.current();
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, []);

  const layouts = useMemo(() => layoutAll(items, cols), [items, cols]);
  /** Where letters in words in fonts that aren't monospaced are drawn: by
   * character index, and by row (for clicks). Monospaced letters sit in their cells. */
  const drawn = useMemo(() => {
    const at = new Map<number, { x: number; w: number }>();
    const rowsOf = new Map<number, { col: number; x: number; w: number }[]>();
    const doc = sheetOf(items);
    const glyphs = layouts.get(DOC)?.glyphs ?? [];
    const fontAt = (k: number) => doc.styles?.[k]?.font ?? noteFont;
    const isDash = (k: number) => {
      const g = glyphs[k];
      const near = (j: number) => glyphs[j]?.ch === '-' && glyphs[j].row === g.row && Math.abs(glyphs[j].col - g.col) === 1;
      return g.ch === '-' && (near(k - 1) || near(k + 1));
    };
    const letter = (k: number) => !!glyphs[k] && glyphs[k].ch !== ' ' && glyphs[k].ch !== '\n' && !isDash(k) && !fontOf(fontAt(k)).mono;
    for (let k = 0; k < glyphs.length; ) {
      if (!letter(k)) {
        k++;
        continue;
      }
      let j = k + 1;
      while (letter(j) && glyphs[j].row === glyphs[k].row && glyphs[j].col === glyphs[j - 1].col + 1 && fontAt(j) === fontAt(k)) j++;
      const lay = wordLayout(
        fontAt(k),
        glyphs.slice(k, j).map((g, n) => ({ ch: g.ch, b: !!doc.styles?.[k + n]?.b, i: !!doc.styles?.[k + n]?.i })),
      );
      const left = glyphs[k].col * CELL_W;
      const row = rowsOf.get(glyphs[k].row) ?? [];
      for (let n = 0; n < j - k; n++) {
        const spot = { x: left + lay.at[n], w: lay.w[n] };
        at.set(k + n, spot);
        row.push({ col: glyphs[k + n].col, ...spot });
      }
      rowsOf.set(glyphs[k].row, row);
      k = j;
    }
    return { at, rows: rowsOf };
  }, [items, layouts, noteFont]);
  /** A point's column, in cells: inside a word, between the letters as drawn. */
  const cellX = (px: number, row: number): number => {
    const letters = drawn.rows.get(row);
    if (letters) {
      for (let n = 0; n < letters.length; n++) {
        const l = letters[n];
        if (px >= l.x && px < l.x + l.w) return l.col + (px - l.x) / l.w;
        // past a word's last letter, but still within its cells: the word's end
        const next = letters[n + 1];
        const wordEnds = !next || next.col !== l.col + 1;
        if (wordEnds && px >= l.x + l.w && px < (l.col + 1) * CELL_W) return l.col + 1;
      }
    }
    return px / CELL_W;
  };

  const bottom = Math.max(
    0,
    ...items.map((it) => (it.kind === 'image' ? it.row + it.height : it.row + (layouts.get(it.id)?.rows ?? 1))),
  );
  const rows = Math.max(28, bottom + 8);
  const sheet = sheetOf(items);
  const sheetLayout = layouts.get(DOC) ?? layoutAll([sheet], cols).get(DOC)!;
  const images = items.filter((i): i is ImageBlock => i.kind === 'image');
  const current = items.find((i) => i.id === active);
  /** the sheet, while you're typing in it */
  const editing = active === DOC ? sheet : null;
  const sel: [number, number] | null =
    editing && anchor !== null && anchor !== caret
      ? [Math.min(anchor, caret, editing.text.length), Math.min(Math.max(anchor, caret), editing.text.length)]
      : null;

  /** Keeps the state before an edit for undo; a run of typing counts as one step. */
  const remember = (kind = 'other') => {
    const now = Date.now();
    const last = lastEdit.current;
    lastEdit.current = { kind, at: now };
    if ((kind === 'type' || kind === 'delete') && last.kind === kind && now - last.at < 800) return;
    past.current.push(items);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
  };
  const travel = (from: { current: GridItem[][] }, to: { current: GridItem[][] }) => {
    const state = from.current.pop();
    if (!state) return;
    to.current.push(items);
    setItems(state);
    setAnchor(null);
    setPad(null);
    // the text undone to can be shorter (after a paste, say): keep the caret inside it
    setCaret((k) => Math.min(k, sheetOf(state).text.length));
    lastEdit.current = { kind: '', at: 0 };
    if (!state.some((it) => it.id === active)) setActive(null);
  };
  const undo = () => travel(past, future);
  const redo = () => travel(future, past);

  const update = (id: string, patch: Partial<TextBlock> | Partial<ImageBlock> | Partial<MathItem>) =>
    setItems((list) => list.map((it) => (it.id === id ? ({ ...it, ...patch } as GridItem) : it)));

  /** Saves a change and puts the caret where it now belongs. Formula lines
   * become formulas on the grid, except the one the caret is still writing. */
  const commit = (next: GridItem[], caretNow = caret) => {
    const r = liftFormulas(toSheet(next, cols), cols, active === DOC ? caretNow : null, formulaSize);
    setItems(r.items);
    setCaret(r.caret ?? caretNow);
  };
  /** Saves the AI's notes, every formula line becoming a formula. */
  const commitAll = (next: GridItem[]) => {
    setItems(liftFormulas(toSheet(next, cols), cols, null, formulaSize).items);
    setCaret(0);
  };
  const patchBlock = (id: string, patch: Partial<TextBlock>, caretNow: number) =>
    commit(items.map((it) => (it.id === id ? ({ ...it, ...patch } as GridItem) : it)), caretNow);

  /** Selects an image, or the sheet (DOC) to type in it. */
  const select = (id: string | null) => {
    if (id !== active) {
      setAnchor(null);
      setPending(null);
      setPad(null);
    }
    setActive(id);
    if (id) inputRef.current?.focus({ preventScroll: true });
  };

  /** Where a point on the grid is, in cells; across a word in a font that
   * isn't monospaced, by where its letters are drawn. */
  const pointCell = (e: { clientX: number; clientY: number }) => {
    const r = gridRef.current!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const y = (e.clientY - r.top) / CELL_H;
    return { x: cellX(px, Math.floor(y)), y };
  };
  const snapCol = (x: number, width: number) => Math.max(0, Math.min(cols - width, Math.round(x / snap) * snap));

  /** Follows a drag with (dx, dy) in pixels until the pointer lifts. */
  const drag = (e: ReactPointerEvent, onMove: (dx: number, dy: number) => void) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => onMove(ev.clientX - x0, ev.clientY - y0);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Drags an item along the grid; a press that barely moves is left as a click. */
  const moveItem = (e: ReactPointerEvent, it: GridItem) => {
    select(it.id);
    let moved = false;
    drag(e, (dx, dy) => {
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) {
        remember();
        setDragging(true);
        setPad(null);
      }
      moved = true;
      update(it.id, {
        col: snapCol(it.col + dx / CELL_W, it.width),
        row: Math.max(0, Math.round(it.row + dy / CELL_H)),
      });
    });
  };

  const addImage = async (file: File, at?: Cell) => {
    if (!file.type.startsWith('image/')) return;
    const { src, aspect } = await readImage(file);
    const width = Math.min(22, Math.floor(cols / 2.5));
    const height = Math.max(2, Math.round((width * CELL_W * aspect) / CELL_H));
    const near = editing ? caretAt(layouts.get(editing.id)!, caret) : undefined;
    const pos = at ?? (near ? { col: near.col, row: near.row + 1 } : { col: MARGIN_CELLS, row: bottom + 1 });
    const image: ImageBlock = { id: newId(), kind: 'image', col: Math.max(0, Math.min(cols - width, pos.col)), row: pos.row, width, height, src };
    remember();
    setItems((list) => [...list, image]);
    select(image.id);
  };

  /** A picture on the clipboard, added to the notes; true when there was one. */
  const pasteImage = (e: ClipboardEvent): boolean => {
    const data = e.clipboardData;
    if (!data) return false;
    const file =
      [...data.files].find((x) => x.type.startsWith('image/')) ??
      [...data.items].find((x) => x.kind === 'file' && x.type.startsWith('image/'))?.getAsFile() ??
      null;
    if (file) {
      e.preventDefault();
      void addImage(file);
      return true;
    }
    // a picture copied from a web page comes as HTML: fetch it if the site allows
    const src = /<img[^>]+src="([^"]+)"/i.exec(data.getData('text/html'))?.[1]?.replace(/&amp;/g, '&');
    if (src && !data.getData('text/plain').trim()) {
      e.preventDefault();
      void fetch(src)
        .then((r) => r.blob())
        .then((blob) => {
          if (blob.type.startsWith('image/')) void addImage(new File([blob], 'pasted', { type: blob.type }));
        })
        .catch(() => setAiError("That picture couldn't be pasted; save it and drop the file in instead."));
      return true;
    }
    return false;
  };
  const pasteRef = useRef(pasteImage);
  pasteRef.current = pasteImage;
  // with an image selected, or nothing focused, a paste lands here too
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body && (t.closest('input, textarea, select, [contenteditable="true"]') || !t.closest('.grid-lab'))) return;
      pasteRef.current(e);
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, []);

  const removeItem = (id: string) => {
    remember();
    setItems((list) => list.filter((it) => it.id !== id));
    setActive(null);
  };

  // ---- AI ----

  const runAi = async (mode: 'polish' | 'figures' | 'fill') => {
    const withFigures = mode === 'figures';
    // with text selected, Polish works on just that part
    const part = mode === 'polish' && sel ? sel : null;
    const key = savedKey();
    if (!key) return setAiError('Add your OpenRouter API key in Preferences → AI first.');
    aiAbort.current?.abort();
    const ctrl = new AbortController();
    aiAbort.current = ctrl;
    setAiError(null);
    setAiReport(null);
    setAiStatus(part ? 'Polishing the selection' : mode === 'polish' ? 'Polishing the notes' : 'Starting');
    const info = models.find((m) => m.id === initial);
    const text = modelOptions(initial, info);
    // the pages need a model that can see; the default one can
    const sees = info?.architecture?.input_modalities?.includes('image');
    const vision = sees ? text : modelOptions(DEFAULT_MODEL, models.find((m) => m.id === DEFAULT_MODEL));
    try {
      if (mode === 'fill' && pdfs.length) {
        const line = pageLine(cols);
        const r = await fillNotes({
          key,
          model: text,
          items: formulasIntoText(items, cols),
          pdfs,
          request,
          line,
          signal: ctrl.signal,
          onStatus: (st) => !ctrl.signal.aborted && setAiStatus(st),
        });
        if (ctrl.signal.aborted) return;
        // after a blank line at the end of the notes
        const join = sheet.text.trim() ? '\n\n' : '';
        const from = sheet.text.trim() ? sheetLayout.end.row + 2 : 0;
        const added = fromMarkup(r.markup, HIGHLIGHTS[0].value);
        const base = sheet.text.replace(/\s+$/, '');
        const next = {
          ...sheet,
          text: base + join + added.text,
          styles: [...stylesOf(sheet).slice(0, base.length), ...new Array<Style | null>(join.length).fill(null), ...(added.styles ?? new Array<Style | null>(added.text.length).fill(null))],
        };
        await present(() => commitAll(items.map((it) => (it.id === DOC ? next : it))), { keep: new Set(images.map((i) => i.id)), from });
        setAiReport(
          `Filled in from where you stopped${r.covered ? ` (you'd covered ${/[-,–]/.test(r.covered) ? 'pages' : 'page'} ${r.covered})` : ''}. ${r.style ? `Your style: ${r.style} ` : ''}` +
            (r.cutOff ? 'The model ran out of room part-way, so run Fill again to go on. ' : '') +
            'Ctrl+Z takes it back out.',
        );
      } else if (withFigures && pdfs.length) {
        const r = await polishWithFigures({
          key,
          text,
          vision,
          items: formulasIntoText(items, cols),
          pdfs,
          request,
          cols,
          highlight: HIGHLIGHTS[0].value,
          signal: ctrl.signal,
          onStatus: (st) => !ctrl.signal.aborted && setAiStatus(st),
        });
        if (ctrl.signal.aborted) return;
        await present(() => commitAll(r.items));
        setAiReport(`${r.report} Ctrl+Z puts your notes back.`);
      } else if (part) {
        const [a, b] = part;
        const styles = stylesOf(sheet);
        const slice = (from: number, to: number) => ({ text: sheet.text.slice(from, to), styles: styles.slice(from, to) });
        const md = await polishSelection(
          key,
          text,
          { before: toMarkup(slice(0, a)), markup: toMarkup(slice(a, b)), after: toMarkup(slice(b, sheet.text.length)) },
          request,
          pageLine(cols),
          ctrl.signal,
          pdfs,
        );
        if (ctrl.signal.aborted) return;
        const polished = fromMarkup(md, HIGHLIGHTS[0].value);
        const newStyles = polished.styles ?? new Array<Style | null>(polished.text.length).fill(null);
        const next = {
          ...sheet,
          text: sheet.text.slice(0, a) + polished.text + sheet.text.slice(b),
          styles: [...styles.slice(0, a), ...newStyles, ...styles.slice(b)],
        };
        // only the selected part is redrawn; the rest of the page stays put
        const from = caretAt(sheetLayout, a)?.row ?? 0;
        await present(() => commitAll(items.map((it) => (it.id === DOC ? next : it))), { keep: new Set(images.map((i) => i.id)), from });
        setAiReport('Polished the selected part. Ctrl+Z puts it back.');
      } else {
        const next = await polishInPlace(key, text, formulasIntoText(items, cols), request, cols, HIGHLIGHTS[0].value, ctrl.signal, pdfs);
        if (ctrl.signal.aborted) return;
        await present(() => commitAll(next));
        setAiReport('Polished. Ctrl+Z puts your notes back.');
      }
      setActive(null);
      setAnchor(null);
    } catch (e) {
      if (!ctrl.signal.aborted) setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      if (aiAbort.current === ctrl) {
        aiAbort.current = null;
        setAiStatus(null);
      }
    }
  };
  /** Swaps in the AI's notes with the skeleton-and-fill effect. */
  const present = async (apply: () => void, only: { keep: Set<string>; from: number } | null = null) => {
    remember();
    setActive(null);
    setAnchor(null);
    if (calmMotion()) return apply();
    setRevealScope(only);
    // adding to the notes keeps what's there; replacing them fades it first
    if (!only) {
      setReveal('leaving');
      await new Promise((r) => setTimeout(r, LEAVE_MS));
    }
    apply();
    setReveal('revealing');
    if (only)
      setTimeout(() => gridRef.current?.querySelector('.grid-skeleton > span')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  };
  useEffect(() => {
    if (reveal !== 'revealing') return;
    const t = setTimeout(() => setReveal(null), FILL_START + FILL_MS + 600);
    return () => clearTimeout(t);
  }, [reveal]);

  const stopAi = () => {
    aiAbort.current?.abort();
    aiAbort.current = null;
    setAiStatus(null);
  };

  /** Drags the line between the browser and the PDF, with both beside the notes. */
  const resizeSplit = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    const move = (ev: PointerEvent) => setSplit(Math.max(0.15, Math.min(0.85, (ev.clientY - box.top) / box.height)));
    setResizing(true);
    const up = () => {
      setResizing(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Drags the line between the notes and the PDF. */
  const resizePdf = (e: ReactPointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = pdfWidth;
    const move = (ev: PointerEvent) => setPdfWidth(Math.max(260, Math.min(window.innerWidth * 0.6, w0 - (ev.clientX - x0))));
    setResizing(true);
    const up = () => {
      setResizing(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---- text editing ----

  /** Formatting the next typed letters get: the toolbar's, else the letter
   * before, in the font of the nearest letters. */
  const typingStyle = (from = caret): Style | null => {
    if (pending) return pending;
    if (!editing) return null;
    const text = editing.text;
    const styles = editing.styles;
    // never past the end, even if the caret hasn't caught up with a shorter text yet
    const at = Math.min(from, text.length);
    // at a line's start: plain, but keeping the line's alignment
    const before: Style | null =
      at === 0 || text[at - 1] === '\n'
        ? text[at] && text[at] !== '\n' && styles?.[at]?.align
          ? { align: styles[at]!.align }
          : null
        : (styles?.[at - 1] ?? null);
    if (before?.font) return before;
    // the font carries on from the nearest letter: before the caret (on this
    // line or the ones above), else after it on this line
    let near = -1;
    for (let k = at - 1; k >= 0 && near < 0; k--) if (text[k].trim()) near = k;
    for (let k = at; near < 0 && k < text.length && text[k] !== '\n'; k++) if (text[k].trim()) near = k;
    const font = near >= 0 ? styles?.[near]?.font : undefined;
    return font ? { ...before, font } : before;
  };

  const replaceRange = (from: number, to: number, insert: string, kind: string) => {
    if (!editing) return;
    remember(kind);
    patchBlock(editing.id, spliceText(editing, from, to, insert, typingStyle(from)), from + insert.length);
    setAnchor(null);
    setPending(null);
    setPad(null);
  };
  const type = (s: string) => {
    if (!editing || !s) return;
    // clicked past the end of a line: the spaces to get there go in first
    if (pad && !sel) {
      const fill = pad.fill + s.replace(/\r\n?/g, '\n');
      remember('type');
      patchBlock(editing.id, spliceText(editing, pad.at, pad.at, fill, typingStyle(pad.at)), pad.at + fill.length);
      setPad(null);
      return;
    }
    const [from, to] = sel ?? [caret, caret];
    replaceRange(from, to, s.replace(/\r\n?/g, '\n'), 'type');
  };

  /** Moves the caret; with `extend` the selection grows from where it was. */
  const moveCaret = (k: number, extend: boolean) => {
    if (!editing) return;
    if (extend) setAnchor((a) => a ?? caret);
    else setAnchor(null);
    setCaret(Math.max(0, Math.min(editing.text.length, k)));
    setPending(null);
    setPad(null);
  };

  /** Applies a formatting change to the selection. */
  const restyleSelection = (change: (s: Style | null) => Style | null) => {
    if (!editing || !sel) return;
    remember('format');
    patchBlock(editing.id, restyle(editing, sel[0], sel[1], change), caret);
  };
  const selectedStyles = () => (editing && sel ? stylesOf(editing).slice(sel[0], sel[1]) : []);

  /** What the toolbar shows as on: the whole selection's, or what typing would use. */
  const isOn = (test: (s: Style | null) => boolean) => (sel ? selectedStyles().every(test) : test(typingStyle()));

  const toggleMark = (key: Mark) => {
    if (!editing) return;
    const on = isOn((s) => !!s?.[key]);
    if (sel) restyleSelection((s) => ({ ...s, [key]: on ? undefined : true }));
    else setPending({ ...typingStyle(), [key]: on ? undefined : true });
  };
  /** The font picker: the selection's (or what you'll type next) while
   * editing, else the whole notes' font. */
  const pickFont = (key: string) => {
    if (editing) {
      const value = key === noteFont ? undefined : key;
      if (sel) restyleSelection((s) => ({ ...s, font: value }));
      else setPending({ ...typingStyle(), font: value });
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    setNoteFont(key);
    try {
      localStorage.setItem(FONT_STORE, key);
    } catch {
      // back to Mono next time
    }
  };
  const shownFont = (() => {
    if (!editing) return noteFont;
    const fonts = new Set((sel ? selectedStyles() : [typingStyle()]).map((s) => s?.font ?? noteFont));
    return fonts.size === 1 ? [...fonts][0] : '';
  })();

  const paint = (key: 'hl' | 'color', value: string | undefined) => {
    if (!editing) return;
    const next = value && isOn((s) => s?.[key] === value) ? undefined : value;
    if (sel) restyleSelection((s) => ({ ...s, [key]: next }));
    else setPending({ ...typingStyle(), [key]: next });
  };
  /** The lines the caret or selection is on, as [start, end) of the text. */
  const linesAround = (): [number, number] => {
    const text = sheet.text;
    const [a, b] = sel ?? [caret, caret];
    const start = text.lastIndexOf('\n', a - 1) + 1;
    const end = text.indexOf('\n', b);
    return [start, end < 0 ? text.length : end];
  };
  const lineAlign = (): 'left' | 'center' | 'right' => {
    const [start] = linesAround();
    return editing?.styles?.[start]?.align ?? 'left';
  };
  /** Aligns the lines the caret or selection is on. */
  const setAlign = (align: 'left' | 'center' | 'right') => {
    if (!editing) return;
    const [start, end] = linesAround();
    remember('format');
    const value = align === 'left' ? undefined : align;
    patchBlock(DOC, restyle(editing, start, end, (s) => ({ ...s, align: value })), caret);
    setPad(null);
  };
  /** Saves the formula being edited, or places a new one under the caret,
   * centred on the line. */
  const saveFormula = (tex: string) => {
    const t = texEdit;
    if (!t) return;
    const size = formulaSize(tex);
    const width = Math.min(PAGE_COLS, size.cols);
    remember();
    const old = t.id ? items.find((i): i is MathItem => i.id === t.id && i.kind === 'math') : undefined;
    if (old?.sized) update(old.id, { tex });
    else if (old) {
      const centre = old.col + old.width / 2;
      update(old.id, { tex, width, height: size.rows, col: Math.max(0, Math.min(cols - width, Math.round(centre - width / 2))) });
    } else {
      const m: MathItem = {
        id: newId(),
        kind: 'math',
        col: MARGIN_CELLS + Math.floor((PAGE_COLS - width) / 2),
        row: caretCell ? caretCell.row + 1 : bottom + 1,
        width,
        height: size.rows,
        tex,
      };
      setItems((list) => [...list, m]);
      setActive(m.id);
    }
    setTexEdit(null);
  };

  /** Indents the lines the caret or selection is on by a tab, or with
   * `out`, takes up to a tab's worth of spaces off the front of each. */
  const indentLines = (out: boolean) => {
    if (!editing) return;
    const [start, end] = linesAround();
    let text = sheet.text;
    const styles = stylesOf(sheet);
    const starts: number[] = [];
    for (let i = start; ; ) {
      starts.push(i);
      const n = text.indexOf('\n', i);
      if (n < 0 || n >= end) break;
      i = n + 1;
    }
    let delta = 0;
    let firstLine = 0;
    for (const at of starts.reverse()) {
      if (out) {
        const n = /^ {1,4}/.exec(text.slice(at))?.[0].length ?? 0;
        text = text.slice(0, at) + text.slice(at + n);
        styles.splice(at, n);
        delta -= n;
        firstLine = -n;
      } else {
        // the new spaces keep the line's alignment
        const align = styles[at]?.align;
        text = text.slice(0, at) + TAB + text.slice(at);
        styles.splice(at, 0, ...new Array<Style | null>(TAB.length).fill(align ? { align } : null));
        delta += TAB.length;
        firstLine = TAB.length;
      }
    }
    if (!delta) return;
    remember('format');
    const next = { ...sheet, text, styles: styles.some(Boolean) ? styles : undefined };
    if (sel) {
      commit(items.map((it) => (it.id === DOC ? next : it)), end + delta);
      setAnchor(start);
    } else commit(items.map((it) => (it.id === DOC ? next : it)), Math.max(start, caret + firstLine));
    setPad(null);
  };

  const clearFormatting = () => {
    if (sel) restyleSelection(() => null);
    else setPending({});
  };

  const copySelection = () => {
    if (editing && sel) void navigator.clipboard?.writeText(editing.text.slice(sel[0], sel[1])).catch(() => {});
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && (key === 'z' || key === 'y')) {
      e.preventDefault();
      if (key === 'y' || e.shiftKey) redo();
      else undo();
      return;
    }
    if (!current) return;
    const arrow = { ArrowLeft: [-snap, 0], ArrowRight: [snap, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (e.key === 'Escape') {
      if (sel) setAnchor(null);
      else {
        select(null);
        inputRef.current?.blur();
      }
      return;
    }
    // images move with the arrow keys
    if (arrow && current.kind !== 'text') {
      e.preventDefault();
      remember();
      update(current.id, { col: snapCol(current.col + arrow[0], current.width), row: Math.max(0, current.row + arrow[1]) });
      return;
    }
    if (current.kind !== 'text') {
      if (current.kind === 'math' && e.key === 'Enter') {
        e.preventDefault();
        setTexEdit({ id: current.id, tex: current.tex });
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeItem(current.id);
      }
      return;
    }
    const text = current.text;

    if (mod) {
      if (key === 'b' || key === 'i' || key === 'u') toggleMark(key);
      else if (key === 'x' && e.shiftKey) toggleMark('s');
      else if (key === 'h' && e.shiftKey) paint('hl', HIGHLIGHTS[0].value);
      else if (key === '\\') clearFormatting();
      else if (key === 'a') {
        setAnchor(0);
        setCaret(text.length);
      } else if (key === 'c') copySelection();
      else if (key === 'x') {
        copySelection();
        if (sel) replaceRange(sel[0], sel[1], '', 'delete');
      } else return; // paste and the rest go through as usual
      e.preventDefault();
      return;
    }

    // a click past the end of a line only counts once typing starts
    if (pad && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      setPad(null);
      return;
    }
    const layout = layouts.get(current.id)!;
    const here = caretAt(layout, caret);
    const onRow = (row: number) => layout.glyphs.map((g, k) => ({ ...g, k })).filter((g) => g.row === row);
    const extend = e.shiftKey;
    /** where the caret's line begins (after the last line break) */
    const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':
        moveCaret(sel && !extend ? sel[0] : caret - 1, extend);
        break;
      case 'ArrowRight':
        moveCaret(sel && !extend ? sel[1] : caret + 1, extend);
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        moveCaret(indexAt(layout, here.col, here.row + (e.key === 'ArrowUp' ? -1 : 1)), extend);
        break;
      case 'Home':
        moveCaret(onRow(here.row)[0]?.k ?? caret, extend);
        break;
      case 'End': {
        const line = onRow(here.row);
        const last = line[line.length - 1];
        moveCaret(last ? (last.ch === '\n' ? last.k : last.k + 1) : caret, extend);
        break;
      }
      case 'Backspace':
        if (sel) replaceRange(sel[0], sel[1], '', 'delete');
        else if (caret > 0) {
          // in a line's indent, a tab's worth of spaces goes at once
          const indent = text.slice(lineStart, caret);
          const n = /^ +$/.test(indent) ? indent.length % TAB.length || TAB.length : 1;
          replaceRange(caret - n, caret, '', 'delete');
        }
        break;
      case 'Delete':
        if (sel) replaceRange(sel[0], sel[1], '', 'delete');
        else if (caret < text.length) replaceRange(caret, caret + 1, '', 'delete');
        break;
      case 'Enter':
        // before a line's first letter, the whole line moves down, indent and all
        if (!sel && !pad && caret > lineStart && /^ +$/.test(text.slice(lineStart, caret))) {
          replaceRange(lineStart, lineStart, '\n', 'type');
          setCaret(caret + 1);
        } else type('\n');
        break;
      case 'Tab':
        // several lines at once, or Shift+Tab: the whole lines move
        if (sel || e.shiftKey) indentLines(e.shiftKey);
        else type(TAB);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };

  /** ms between one row filling in and the next */
  const revealFrom = revealScope?.from ?? 0;
  const rowStep = FILL_MS / Math.max(1, bottom - revealFrom);
  /** whether an item fills in now, or was there already */
  const fills = (id: string, row: number) =>
    reveal === 'revealing' && (!revealScope || (id === DOC ? row >= revealScope.from : !revealScope.keep.has(id)));
  const settled = (id: string, row: number) => reveal === 'revealing' && !fills(id, row);
  const rowVar = (row: number, id: string) => (fills(id, row) ? { ['--r' as string]: row - revealFrom } : undefined);
  /** the skeleton: each text row as a bar from its first letter to its last */
  const skeleton =
    reveal === 'revealing'
      ? items.flatMap((it) => {
          if (it.kind === 'image' && !fills(it.id, it.row)) return [];
          if (it.kind === 'image') return [{ key: it.id, image: true, col: it.col, row: it.row, width: it.width, height: it.height }];
          const spans = new Map<number, [number, number]>();
          for (const g of layouts.get(it.id)?.glyphs ?? []) {
            if (!g.ch.trim() || !fills(it.id, g.row)) continue;
            const s = spans.get(g.row);
            spans.set(g.row, s ? [Math.min(s[0], g.col), Math.max(s[1], g.col + 1)] : [g.col, g.col + 1]);
          }
          return [...spans].map(([row, [a, b]]) => ({ key: `${it.id}-${row}`, image: false, col: a, row, width: b - a, height: 1 }));
        })
        .map((b) => ({ ...b, r: b.row - revealFrom }))
      : [];

  /** each distinct row's letters, drawn once */
  const rowCells = useRef(new Map<string, ReactNode[]>());

  /** Where a formula's drawing sits in its box: scaled to fill the box
   * (keeping its shape) or at its own size, either way centred. Placed by
   * its measured size, so nothing squeezes it off one side. */
  const mathScale = (m: MathItem) => {
    const f = formula(m.tex);
    const boxW = m.width * CELL_W;
    const boxH = m.height * CELL_H;
    const k = m.fit === 'crop' ? 1 : Math.max(0.1, Math.min((boxW - 6) / Math.max(1, f.w), (boxH - 4) / Math.max(1, f.h)));
    return {
      left: (boxW - f.w * k) / 2,
      top: (boxH - f.h * k) / 2,
      width: f.w,
      height: f.h,
      transform: k === 1 ? undefined : `scale(${k.toFixed(4)})`,
    };
  };

  /** A letter's font, and how much it's narrowed to fit its cell (1: not). */
  const glyphFont = (key: string, ch: string, bold: boolean): { style?: { fontFamily: string; fontSize?: number }; narrow: number } => {
    const f = fontOf(key);
    if (f.key === 'mono') return { narrow: 1 };
    if (f.mono) return { style: { fontFamily: f.stack }, narrow: 1 };
    return { style: { fontFamily: f.stack, fontSize: fontSize(f.key) }, narrow: narrow(f.key, ch, bold) };
  };

  const caretCell = editing ? (pad?.cell ?? caretAt(sheetLayout, Math.min(caret, editing.text.length))) : null;
  /** where typing starts on an empty page */
  const startCell = caretAt(sheetLayout, 0);
  /** where the caret is drawn: by the letters it sits beside, in a word in a font that isn't monospaced */
  const caretPx = (() => {
    if (!caretCell) return 0;
    if (pad) return caretCell.col * CELL_W;
    const k = Math.min(caret, sheet.text.length);
    const here = drawn.at.get(k);
    if (here && sheetLayout.glyphs[k].row === caretCell.row) return here.x;
    const before = drawn.at.get(k - 1);
    if (before && sheetLayout.glyphs[k - 1].row === caretCell.row) return before.x + before.w;
    return caretCell.col * CELL_W;
  })();

  /** A press on the sheet: the caret goes to the start of the row, or, on
   * the row it's already on, to the cell pressed; dragging selects. */
  const pressSheet = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.grid-image, .grid-mathbox')) return;
    e.preventDefault();
    inputRef.current?.focus({ preventScroll: true });
    const p = pointCell(e);
    const cell = { col: Math.max(0, Math.min(cols - 1, Math.floor(p.x))), row: Math.max(0, Math.floor(p.y)) };
    setPending(null);
    if (e.shiftKey && editing) {
      setPad(null);
      setAnchor(anchor ?? caret);
      setCaret(indexAt(sheetLayout, p.x, cell.row));
      return;
    }
    // a second click on the caret's row goes to the exact cell, unless there
    // are letters between the caret and it
    const exact =
      !!editing &&
      !!caretCell &&
      caretCell.row === cell.row &&
      !sheetLayout.glyphs.some(
        (g) => g.row === cell.row && g.ch.trim() && g.col >= Math.min(caretCell.col, cell.col) && g.col < Math.max(caretCell.col, cell.col),
      );
    const t = clickTarget(sheet, sheetLayout, cell, exact, images);
    setActive(DOC);
    setAnchor(null);
    setCaret(t.at);
    setPad(t.fill ? t : null);
    const x0 = e.clientX;
    const y0 = e.clientY;
    let selecting = false;
    const move = (ev: PointerEvent) => {
      if (!selecting && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      selecting = true;
      const q = pointCell(ev);
      setPad(null);
      setAnchor((a) => a ?? indexAt(sheetLayout, p.x, cell.row));
      setCaret(indexAt(sheetLayout, q.x, Math.floor(q.y)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const block = (e: { preventDefault: () => void }) => e.preventDefault();

  return (
    <div className={`grid-lab ${side ? 'with-pdf' : ''} ${resizing ? 'resizing' : ''}`} style={side ? { ['--pdf-w' as string]: `${pdfWidth}px` } : undefined}>
      <div className="grid-lab-notes">
      {header}

      <div className="grid-tools-toggle">
        <button className="link" onClick={toggleTools} aria-expanded={!toolsHidden}>
          <span aria-hidden="true">{toolsHidden ? '▸' : '▾'}</span> {toolsHidden ? 'Show tools' : 'Hide tools'}
        </button>
        {toolsHidden && aiStatus && (
          <span className="grid-ai-status" role="status">
            <span className="grid-ai-spinner" aria-hidden="true" />
            {aiStatus}…
          </span>
        )}
      </div>

      <div className="grid-tools" hidden={toolsHidden}>
      <div className="grid-lab-bar">
        <button onClick={() => fileRef.current?.click()}>Add image</button>
        {!pdf && <button onClick={() => pdfInputRef.current?.click()}>Open a PDF beside</button>}
        {!browserOpen && canShowBrowser() && <button onClick={() => setBrowserOpen(true)}>Open a browser beside</button>}
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            openPdfs([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void addImage(f);
            e.target.value = '';
          }}
        />
        <label className="check">
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> Show grid
        </label>
        {demo && (
          <button
            className="link"
            onClick={() => {
              remember();
              setItems(demo());
              setActive(null);
            }}
          >
            Reset to the example
          </button>
        )}
      </div>

      <div className="grid-ai">
        <button
          className="grid-ai-go"
          disabled={!!aiStatus}
          // keep the selection: Polish works on it when there is one
          onMouseDown={block}
          onClick={() => void runAi('polish')}
          title={
            sel
              ? 'Tidy just the selected text, leaving the rest of the notes as they are'
              : pdf
                ? 'Tidy the formatting and wording, keeping your order, using the open PDFs to fill gaps'
                : 'Tidy the formatting and wording, keeping your order'
          }
        >
          {sel ? '✦ Polish selection' : '✦ Polish'}
        </button>
        <button
          className="grid-ai-go"
          disabled={!!aiStatus || !pdf}
          onClick={() => void runAi('figures')}
          title={pdf ? 'Polish, then add figures from the open PDFs and lay the page out again' : 'Open a PDF beside the notes first'}
        >
          ✦ Polish with figures
        </button>
        <button
          className="grid-ai-go"
          disabled={!!aiStatus || !pdf}
          onClick={() => void runAi('fill')}
          title={pdf ? 'Write the rest of the notes on the open PDFs, in your style, from where you stopped' : 'Open a PDF beside the notes first'}
        >
          ✦ Fill the rest
        </button>
        <input
          className="grid-ai-ask"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="Requests, e.g. add an example for each term (or write [[requests]] in the notes)"
          aria-label="Requests for the AI"
          disabled={!!aiStatus}
        />
        {aiStatus && (
          <span className="grid-ai-status" role="status">
            <span className="grid-ai-spinner" aria-hidden="true" />
            {aiStatus}…
            <button className="link" onClick={stopAi}>
              Stop
            </button>
          </span>
        )}
        {!aiStatus && aiReport && <span className="grid-ai-report">{aiReport}</span>}
      </div>
      {aiError && <div className="polish-error">{aiError}</div>}

      {/* pressing a toolbar button keeps the caret and selection in the text */}
      <div className="grid-format" role="toolbar" aria-label="Formatting" onPointerDown={block} onMouseDown={block}>
        {MARKS.map((m) => {
          const on = !!editing && isOn((s) => !!s?.[m.key]);
          return (
            <button
              key={m.key}
              className={`grid-format-mark mark-${m.key} ${on ? 'on' : ''}`}
              aria-pressed={on}
              aria-label={m.name}
              title={`${m.name} (${m.keys})`}
              disabled={!editing}
              onClick={() => toggleMark(m.key)}
            >
              {m.label}
            </button>
          );
        })}
        <span className="grid-format-sep" />
        <span className="grid-format-label">Highlight</span>
        {HIGHLIGHTS.map((h) => {
          const on = !!editing && isOn((s) => s?.hl === h.value);
          return (
            <button
              key={h.name}
              className={`grid-swatch ${on ? 'on' : ''}`}
              style={{ ['--swatch' as string]: h.value }}
              aria-pressed={on}
              aria-label={`${h.name} highlight`}
              title={h.name === 'Yellow' ? 'Yellow (Ctrl+Shift+H)' : h.name}
              disabled={!editing}
              onClick={() => paint('hl', h.value)}
            />
          );
        })}
        <button className="grid-swatch none" aria-label="No highlight" title="No highlight" disabled={!editing} onClick={() => paint('hl', undefined)} />
        <span className="grid-format-sep" />
        <select
          className="grid-font"
          aria-label="Font"
          title={editing ? 'Font for the selected text (or what you type next)' : 'Font for all the notes'}
          value={shownFont}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => e.target.value && pickFont(e.target.value)}
        >
          {!shownFont && <option value="">Mixed</option>}
          {FONTS.map((f) => (
            <option key={f.key} value={f.key} style={{ fontFamily: f.stack }}>
              {f.name}
              {f.key === noteFont && editing ? ' (notes)' : ''}
            </option>
          ))}
        </select>
        <span className="grid-format-sep" />
        <span className="grid-format-label">Text</span>
        {TEXT_COLORS.map((c) => {
          const on = !!editing && isOn((s) => s?.color === c.value);
          return (
            <button
              key={c.name}
              className={`grid-swatch ink ${on ? 'on' : ''}`}
              style={{ ['--swatch' as string]: c.value }}
              aria-pressed={on}
              aria-label={`${c.name} text`}
              title={c.name}
              disabled={!editing}
              onClick={() => paint('color', c.value)}
            />
          );
        })}
        <button className="grid-swatch ink default" aria-label="Default text colour" title="Default colour" disabled={!editing} onClick={() => paint('color', undefined)} />
        <span className="grid-format-sep" />
        {(['left', 'center', 'right'] as const).map((a) => {
          const on = !!editing && lineAlign() === a;
          const name = a === 'center' ? 'Centre' : a === 'left' ? 'Align left' : 'Align right';
          const bars = { left: 'M4 6h16M4 10h10M4 14h16M4 18h10', center: 'M4 6h16M7 10h10M4 14h16M7 18h10', right: 'M4 6h16M10 10h10M4 14h16M10 18h10' }[a];
          return (
            <button key={a} className={`grid-format-mark ${on ? 'on' : ''}`} aria-pressed={on} aria-label={name} title={name} disabled={!editing} onClick={() => setAlign(a)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d={bars} />
              </svg>
            </button>
          );
        })}
        <button className="grid-format-mark" title="Add a formula (LaTeX); or type $$ … $$ on a line of its own" aria-label="Add a formula" onClick={() => setTexEdit({ id: null, tex: '' })}>
          ∑
        </button>
        <span className="grid-format-sep" />
        <button title="Clear formatting (Ctrl+\)" disabled={!editing} onClick={clearFormatting}>
          Clear
        </button>
        <span className="grid-format-push" />
        <button aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!past.current.length} onClick={undo}>
          ↶
        </button>
        <button aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!future.current.length} onClick={redo}>
          ↷
        </button>
      </div>
      </div>
      {saveFailed && <div className="polish-error">These notes are too big to keep in this browser; try smaller images.</div>}

      <div
        ref={gridRef}
        className={`grid-lab-canvas panel paper-${paper} ${showGrid ? 'show-grid' : ''} ${dragging ? 'dragging' : ''} ${aiStatus ? 'thinking' : ''} ${reveal ?? ''}`}
        style={{
          height: rows * CELL_H,
          maxWidth: SHEET_COLS * CELL_W + 2,
          backgroundSize: `${CELL_W}px ${CELL_H}px`,
          ['--row-step' as string]: `${rowStep}ms`,
          ['--fill-start' as string]: `${FILL_START}ms`,
          ['--fill-ms' as string]: `${FILL_MS}ms`,
        }}
        onPointerDown={pressSheet}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('.grid-image') || !editing || pad) return;
          const [a, b] = wordAt(sheet.text, caret);
          setAnchor(a);
          setCaret(b);
        }}
        onPointerMove={(e) => {
          // the grid shows through only around the pointer; set directly, no re-render
          const el = revealRef.current;
          if (!el) return;
          const r = e.currentTarget.getBoundingClientRect();
          el.style.setProperty('--mx', `${e.clientX - r.left}px`);
          el.style.setProperty('--my', `${e.clientY - r.top}px`);
          el.classList.add('on');
        }}
        onPointerLeave={() => revealRef.current?.classList.remove('on')}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          const p = pointCell(e);
          if (f) void addImage(f, { col: Math.floor(p.x), row: Math.floor(p.y) });
        }}
      >
        {showGrid && (
          <div ref={revealRef} className="grid-reveal" aria-hidden="true" style={{ ['--cell' as string]: `${CELL_W}px ${CELL_H}px` }}>
            <div className="grid-reveal-lines" />
          </div>
        )}

        {items.map((it) => {
          const selected = it.id === active;
          if (it.kind === 'math')
            return (
              <div
                key={it.id}
                className={`grid-mathbox ${selected ? 'selected' : ''}`}
                style={{ left: it.col * CELL_W, top: it.row * CELL_H, width: it.width * CELL_W, height: it.height * CELL_H, ...rowVar(it.row, it.id) }}
                title="Drag to move · double-click to edit"
                onPointerDown={(e) => moveItem(e, it)}
                onDoubleClick={() => setTexEdit({ id: it.id, tex: it.tex })}
              >
                <div className="grid-math">
                  <div className="grid-math-inner" style={mathScale(it)} dangerouslySetInnerHTML={{ __html: formula(it.tex).html }} />
                </div>
                {selected && (
                  <>
                    <button className="grid-remove" aria-label="Remove formula" onPointerDown={(e) => e.stopPropagation()} onClick={() => removeItem(it.id)}>
                      ✕
                    </button>
                    <span className="grid-math-tools" onPointerDown={(e) => e.stopPropagation()}>
                      <button
                        className={(it.fit ?? 'fit') === 'fit' ? 'on' : ''}
                        aria-pressed={(it.fit ?? 'fit') === 'fit'}
                        title="Scale the formula to fill the box"
                        onClick={() => {
                          remember();
                          update(it.id, { fit: 'fit' });
                        }}
                      >
                        Fit
                      </button>
                      <button
                        className={it.fit === 'crop' ? 'on' : ''}
                        aria-pressed={it.fit === 'crop'}
                        title="Keep the formula's own size, centred; the box cuts it off if it's smaller"
                        onClick={() => {
                          remember();
                          update(it.id, { fit: 'crop' });
                        }}
                      >
                        Crop
                      </button>
                      <button onClick={() => setTexEdit({ id: it.id, tex: it.tex })}>✎ Edit</button>
                    </span>
                    <span
                      className="grid-resize corner"
                      aria-label="Resize formula"
                      onPointerDown={(e) => {
                        remember();
                        drag(e, (dx, dy) =>
                          update(it.id, {
                            width: Math.max(2, Math.min(cols - it.col, Math.round(it.width + dx / CELL_W))),
                            height: Math.max(1, Math.round(it.height + dy / CELL_H)),
                            sized: true,
                          }),
                        );
                      }}
                    />
                  </>
                )}
              </div>
            );
          if (it.kind === 'image')
            return (
              <div
                key={it.id}
                className={`grid-image ${selected ? 'selected' : ''} ${settled(it.id, it.row) ? 'settled' : ''}`}
                style={{ left: it.col * CELL_W, top: it.row * CELL_H, width: it.width * CELL_W, height: it.height * CELL_H, ...rowVar(it.row, it.id) }}
                onPointerDown={(e) => moveItem(e, it)}
              >
                <img
                  src={it.src}
                  alt=""
                  draggable={false}
                  style={{
                    objectFit: it.fit === 'fit' ? 'contain' : 'cover',
                    ...(it.captionRows ? { height: (it.height - it.captionRows) * CELL_H } : {}),
                  }}
                />
                {it.caption && (
                  <span className="grid-caption" style={{ height: (it.captionRows ?? 1) * CELL_H }}>
                    {it.caption}
                  </span>
                )}
                {selected && (
                  <>
                    <button className="grid-remove" aria-label="Remove image" onPointerDown={(e) => e.stopPropagation()} onClick={() => removeItem(it.id)}>
                      ✕
                    </button>
                    <span className="grid-math-tools" onPointerDown={(e) => e.stopPropagation()}>
                      <button
                        className={it.fit === 'fit' ? 'on' : ''}
                        aria-pressed={it.fit === 'fit'}
                        title="Show the whole picture, scaled to fit the box"
                        onClick={() => {
                          remember();
                          update(it.id, { fit: 'fit' });
                        }}
                      >
                        Fit
                      </button>
                      <button
                        className={it.fit !== 'fit' ? 'on' : ''}
                        aria-pressed={it.fit !== 'fit'}
                        title="Fill the box with the picture, centred; the edges that don't fit are cut off"
                        onClick={() => {
                          remember();
                          update(it.id, { fit: 'crop' });
                        }}
                      >
                        Crop
                      </button>
                    </span>
                    <span
                      className="grid-resize corner"
                      aria-label="Resize image"
                      onPointerDown={(e) => {
                        remember();
                        drag(e, (dx, dy) =>
                          update(it.id, {
                            width: Math.max(2, Math.min(cols - it.col, Math.round(it.width + dx / CELL_W))),
                            height: Math.max(1, Math.round(it.height + dy / CELL_H)),
                          }),
                        );
                      }}
                    />
                  </>
                )}
              </div>
            );
          return null;
        })}
        {!sheet.text && (
          // where the first letter will go, in the notes' own font, like a text box's placeholder
          <span
            className="grid-placeholder"
            style={{
              left: startCell.col * CELL_W + 2,
              top: startCell.row * CELL_H,
              fontFamily: fontOf(noteFont).stack,
              fontSize: fontSize(noteFont),
            }}
          >
            Click anywhere and start typing…
          </span>
        )}

        {(() => {
          // the letters, a row at a time; a row looks the same wherever it
          // sits, so rows that only moved are reused as they are
          const range = editing ? sel : null;
          type RowCell = { col: number; ch: string; st: Style | null | undefined; cls: string; base: string; font: string; plain: boolean; reveal?: object };
          const byRow = new Map<number, { sig: string[]; cells: RowCell[] }>();
          sheetLayout.glyphs.forEach((g, k) => {
            const st = sheet.styles?.[k];
            const picked = !!range && k >= range[0] && k < range[1];
            const blank = g.ch === ' ' || g.ch === '\n';
            // spaces only show when something marks them: a highlight, a line or the selection
            if (blank && !picked && !(st?.hl || st?.u || st?.s)) return;
            // a highlight is one stroke along its run, rounded where the run starts and ends
            const sameHl = (j: number) => {
              const o = sheetLayout.glyphs[j];
              return !!o && o.row === g.row && Math.abs(o.col - g.col) === 1 && sheet.styles?.[j]?.hl === st?.hl;
            };
            const hlEnds = st?.hl ? [!sameHl(k - 1) && 'hl-start', !sameHl(k + 1) && 'hl-end'] : [];
            // two or more dashes in a row are one unbroken line
            const dashAt = (j: number) => {
              const o = sheetLayout.glyphs[j];
              return !!o && o.ch === '-' && o.row === g.row && Math.abs(o.col - g.col) === 1;
            };
            const dash = g.ch === '-' && (dashAt(k - 1) || dashAt(k + 1));
            const dashEnds = dash ? ['dash', !dashAt(k - 1) && 'dash-start', !dashAt(k + 1) && 'dash-end'] : [];
            const cls = ['grid-glyph', settled(DOC, g.row) && 'settled', st?.b && 'b', st?.i && 'i', st?.u && 'u', st?.s && 's', st?.hl && 'hl', ...hlEnds, ...dashEnds, picked && 'picked']
              .filter(Boolean)
              .join(' ');
            const font = st?.font ?? noteFont;
            const reveal = rowVar(g.row, DOC);
            let row = byRow.get(g.row);
            if (!row) byRow.set(g.row, (row = { sig: [], cells: [] }));
            row.sig.push(`${g.col}|${g.ch}|${cls}|${st?.color ?? ''}|${st?.hl ?? ''}|${font}|${reveal ? g.row : ''}`);
            const base = cls.replace(/ hl-(start|end)/g, '');
            row.cells.push({ col: g.col, ch: blank || dash ? '' : g.ch, st, cls, base, font, plain: !blank && !dash, reveal });
          });
          /** A row's letters as spans: one per letter in a monospaced font;
           * in other fonts, one per word, so the letters keep the font's own
           * spacing. A word is laid out whole whatever parts of it are bold,
           * coloured, selected or highlighted, so marking it never moves it;
           * the marks are drawn cell by cell behind it. */
          const draw = (cells: RowCell[]): ReactNode[] => {
            const out: ReactNode[] = [];
            for (let i = 0; i < cells.length; ) {
              const c = cells[i];
              if (!c.plain || fontOf(c.font).mono) {
                const f = glyphFont(c.font, c.ch, !!c.st?.b);
                out.push(
                  <span key={c.col} className={c.cls} style={{ left: c.col * CELL_W, color: c.st?.color, ['--hl' as string]: c.st?.hl, ...f.style, ...c.reveal }}>
                    {f.narrow < 1 ? <span className="grid-ch" style={{ transform: `scaleX(${f.narrow.toFixed(3)})` }}>{c.ch}</span> : c.ch}
                  </span>,
                );
                i++;
                continue;
              }
              let j = i + 1;
              while (j < cells.length && cells[j].plain && cells[j].col === cells[j - 1].col + 1 && cells[j].font === c.font) j++;
              const word = cells.slice(i, j);
              const lay = wordLayout(
                c.font,
                word.map((x) => ({ ch: x.ch, b: !!x.st?.b, i: !!x.st?.i })),
              );
              // the marks behind the word, under each letter as it's drawn; the
              // first and last reach the edges of the word's cells, so a
              // highlight or underline runs on into the spaces either side unbroken
              word.forEach((x, n) => {
                const marks = x.cls.split(' ').filter((t) => MARKS_BEHIND.has(t));
                if (!marks.length) return;
                const from = n === 0 ? 0 : lay.at[n];
                const to = n === word.length - 1 ? word.length * CELL_W : lay.at[n] + lay.w[n];
                out.push(
                  <span
                    key={`m${x.col}`}
                    className={['grid-glyph', ...x.cls.split(' ').filter((t) => t === 'settled'), ...marks].join(' ')}
                    style={{ left: c.col * CELL_W + from, width: to - from, ['--hl' as string]: x.st?.hl, ...x.reveal }}
                  />,
                );
              });
              // the word, in pieces that differ only in weight, slant or colour
              const pieces: { text: string; b: boolean; i: boolean; color?: string }[] = [];
              for (const x of word) {
                const prev = pieces[pieces.length - 1];
                if (prev && prev.b === !!x.st?.b && prev.i === !!x.st?.i && prev.color === x.st?.color) prev.text += x.ch;
                else pieces.push({ text: x.ch, b: !!x.st?.b, i: !!x.st?.i, color: x.st?.color });
              }
              out.push(
                <span
                  key={c.col}
                  className={['grid-glyph run', ...c.cls.split(' ').filter((t) => t === 'settled')].join(' ')}
                  style={{ left: c.col * CELL_W, width: word.length * CELL_W, fontFamily: fontOf(c.font).stack, fontSize: fontSize(c.font), ...c.reveal }}
                >
                  <span className="grid-word" style={lay.fit}>
                    {pieces.map((pc, n) => (
                      <span key={n} style={{ color: pc.color, fontWeight: pc.b ? 700 : undefined, fontStyle: pc.i ? 'italic' : undefined }}>
                        {pc.text}
                      </span>
                    ))}
                  </span>
                </span>,
              );
              i = j;
            }
            return out;
          };
          const cache = rowCells.current;
          if (cache.size > 4000) cache.clear();
          const seen = new Map<string, number>();
          return [...byRow].map(([r, row]) => {
            const sig = row.sig.join('/');
            let cells = cache.get(sig);
            if (!cells) cache.set(sig, (cells = draw(row.cells)));
            const n = (seen.get(sig) ?? 0) + 1;
            seen.set(sig, n);
            return <GlyphRow key={`${sig}#${n}`} top={r * CELL_H} cells={cells} />;
          });
        })()}

        {reveal === 'revealing' && (
          <div className="grid-skeleton" aria-hidden="true">
            {skeleton.map((b) => (
              <span
                key={b.key}
                className={b.image ? 'grid-skeleton-box' : 'grid-skeleton-bar'}
                style={{ left: b.col * CELL_W, top: b.row * CELL_H, width: b.width * CELL_W, height: b.height * CELL_H, ['--r' as string]: b.r }}
              />
            ))}
            <span className="grid-sweep" style={{ top: revealFrom * CELL_H, ['--h' as string]: `${(bottom - revealFrom) * CELL_H}px` }} />
          </div>
        )}

        {caretCell && focused && !sel && <span className="grid-caret" style={{ left: caretPx - 1, top: caretCell.row * CELL_H + 3 }} />}

        <textarea
          ref={inputRef}
          className="grid-input"
          aria-label="Grid note text"
          style={caretCell ? { left: caretPx, top: caretCell.row * CELL_H } : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKey}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={(e) => {
            composing.current = false;
            type(e.data);
            e.currentTarget.value = '';
          }}
          onChange={(e) => {
            if (composing.current) return;
            type(e.target.value);
            e.target.value = '';
          }}
          onPaste={(e) => {
            if (pasteImage(e.nativeEvent)) e.stopPropagation();
          }}
        />
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Click a row to start at its beginning, click it again for the exact cell · Enter pushes everything below down a
        line · drag across text to select it, double-click a word · Ctrl+B, I, U, Ctrl+Shift+X strikethrough, Ctrl+Shift+H highlight, Ctrl+Z undo
        · drop or paste a picture to add it · saved in this browser only
      </p>
      </div>
      {texEdit && (
        <FormulaEditor
          tex={texEdit.tex}
          isNew={!texEdit.id}
          onSave={saveFormula}
          onDelete={() => {
            if (texEdit.id) removeItem(texEdit.id);
            setTexEdit(null);
          }}
          onClose={() => setTexEdit(null)}
        />
      )}
      {side && (
        <>
          <div className="grid-split" role="separator" aria-orientation="vertical" aria-label="Resize the side" onPointerDown={resizePdf} />
          <div className={`grid-side ${pdf && browserOpen ? 'both' : ''}`}>
            {browserOpen && (
              <div className="grid-side-pane browser-pane" style={{ order: browserFirst ? 0 : 2, flexGrow: !pdf ? 1 : browserFirst ? split : 1 - split }}>
                <NotesBrowser
                  onClose={() => setBrowserOpen(false)}
                  extra={
                    pdf && (
                      <button className="icon-button" onClick={() => setBrowserFirst(!browserFirst)} aria-label="Swap the browser and the PDF" title="Swap the browser and the PDF">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" />
                        </svg>
                      </button>
                    )
                  }
                />
              </div>
            )}
            {pdf && browserOpen && (
              <div className="grid-side-divider" role="separator" aria-orientation="horizontal" aria-label="Resize the browser and the PDF" style={{ order: 1 }} onPointerDown={resizeSplit} />
            )}
            {pdf && (
              <div className="grid-side-pane pdf-pane" style={{ order: browserFirst ? 2 : 0, flexGrow: !browserOpen ? 1 : browserFirst ? 1 - split : split }}>
                <GridPdf pdfs={pdfs} active={pdf.id} onSelect={showPdf} onAdd={() => pdfInputRef.current?.click()} onClose={closePdf} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
