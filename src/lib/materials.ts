// Reads course material for the Learn tab into numbered sections of text:
// slides (with speaker notes) from PowerPoint, pages from PDF, headed
// sections from Word and Markdown/text files. Images aren't read.

import { formulasIntoText, sheetOf, SHEET_COLS, toSheet, type GridItem } from './gridText';
import JSZip from 'jszip';
import type { LessonSource, LessonSection } from './types';

const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export const MATERIAL_ACCEPT = '.pptx,.pdf,.docx,.txt,.md,.markdown';

const tidy = (s: string) =>
  s
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const xml = (text: string) => new DOMParser().parseFromString(text, 'application/xml');

/** Text of DrawingML paragraphs, one per line. */
function drawingText(doc: Document | Element): string {
  return [...doc.getElementsByTagNameNS(DRAWING, 'p')]
    .map((p) => [...p.getElementsByTagNameNS(DRAWING, 't')].map((t) => t.textContent ?? '').join(''))
    .filter((l) => l.trim())
    .join('\n');
}

/** Resolves a relationship target like "../notesSlides/notesSlide1.xml" against a part's folder. */
function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

async function rels(zip: JSZip, part: string): Promise<Map<string, { target: string; type: string }>> {
  const folder = part.split('/').slice(0, -1).join('/');
  const name = part.split('/').pop();
  const file = zip.file(`${folder}/_rels/${name}.rels`);
  const out = new Map<string, { target: string; type: string }>();
  if (!file) return out;
  for (const r of xml(await file.async('text')).getElementsByTagName('Relationship')) {
    out.set(r.getAttribute('Id') ?? '', { target: resolvePath(part, r.getAttribute('Target') ?? ''), type: r.getAttribute('Type') ?? '' });
  }
  return out;
}

async function readPptx(data: ArrayBuffer, prefix: string): Promise<LessonSection[]> {
  const zip = await JSZip.loadAsync(data);
  const pres = zip.file('ppt/presentation.xml');
  if (!pres) throw new Error('This isn’t a PowerPoint file.');
  const presRels = await rels(zip, 'ppt/presentation.xml');
  // slide order is the presentation's list, not the file names
  const ids = [...xml(await pres.async('text')).getElementsByTagName('*')].filter((e) => e.localName === 'sldId');
  const sections: LessonSection[] = [];
  let n = 0;
  for (const id of ids) {
    const path = presRels.get(id.getAttributeNS(REL, 'id') ?? id.getAttribute('r:id') ?? '')?.target;
    const file = path && zip.file(path);
    if (!file) continue;
    n++;
    const slide = xml(await file.async('text'));
    // the title placeholder, if the slide has one
    const shapes = [...slide.getElementsByTagName('*')].filter((e) => e.localName === 'sp');
    const titleShape = shapes.find((sp) =>
      [...sp.getElementsByTagName('*')].some((e) => e.localName === 'ph' && /title/i.test(e.getAttribute('type') ?? '')),
    );
    const title = titleShape ? drawingText(titleShape).split('\n')[0] : '';
    let text = drawingText(slide);
    const notesRel = [...(await rels(zip, path)).values()].find((r) => r.type.endsWith('/notesSlide'));
    const notesFile = notesRel && zip.file(notesRel.target);
    if (notesFile) {
      const notes = drawingText(xml(await notesFile.async('text')))
        .split('\n')
        .filter((l) => !/^\d+$/.test(l.trim()))
        .join('\n');
      if (notes.trim()) text += `\n\nSpeaker notes: ${notes}`;
    }
    sections.push({ ref: `${prefix}.${n}`, title: title || text.split('\n')[0]?.slice(0, 80) || `Slide ${n}`, text: tidy(text) });
  }
  return sections;
}

async function readDocx(data: ArrayBuffer, prefix: string): Promise<LessonSection[]> {
  const zip = await JSZip.loadAsync(data);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('This isn’t a Word document.');
  const doc = xml(await file.async('text'));
  const sections: { title: string; lines: string[] }[] = [];
  for (const p of doc.getElementsByTagNameNS(WORD, 'p')) {
    const text = [...p.getElementsByTagNameNS(WORD, 't')].map((t) => t.textContent ?? '').join('');
    if (!text.trim()) continue;
    const style = p.getElementsByTagNameNS(WORD, 'pStyle')[0]?.getAttributeNS(WORD, 'val') ?? '';
    if (/^(heading|title)/i.test(style) || !sections.length) sections.push({ title: text.slice(0, 100), lines: [text] });
    else sections[sections.length - 1].lines.push(text);
  }
  return sections.flatMap((s) => chunk(s.title, s.lines.join('\n'))).map((s, i) => ({ ...s, ref: `${prefix}.${i + 1}` }));
}

/** Long sections split at paragraph breaks into pieces of about 3,000 characters. */
function chunk(title: string, text: string): { title: string; text: string }[] {
  const t = tidy(text);
  if (t.length <= 3500) return [{ title, text: t }];
  const out: { title: string; text: string }[] = [];
  let current = '';
  for (const para of t.split('\n\n')) {
    if (current && current.length + para.length > 3000) {
      out.push({ title: out.length ? `${title} (cont.)` : title, text: current });
      current = '';
    }
    current += (current ? '\n\n' : '') + para;
  }
  if (current) out.push({ title: out.length ? `${title} (cont.)` : title, text: current });
  return out;
}

function readText(text: string, prefix: string): LessonSection[] {
  const parts: { title: string; lines: string[] }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const heading = /^#{1,3}\s+(.*)/.exec(line);
    if (heading || !parts.length) parts.push({ title: heading ? heading[1] : line.slice(0, 80), lines: heading ? [] : [line] });
    else parts[parts.length - 1].lines.push(line);
  }
  return parts
    .flatMap((p) => chunk(p.title, p.lines.join('\n')))
    .filter((s) => s.text)
    .map((s, i) => ({ ...s, ref: `${prefix}.${i + 1}` }));
}

async function readPdf(data: ArrayBuffer, prefix: string): Promise<LessonSection[]> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const pdf = await task.promise;
  const sections: LessonSection[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      text += item.str + (item.hasEOL ? '\n' : ' ');
    }
    const t = tidy(text);
    sections.push({ ref: `${prefix}.${i}`, title: t.split('\n')[0]?.slice(0, 80) || `Page ${i}`, text: t });
  }
  await task.destroy();
  return sections;
}

/** Reads one file. `index` numbers the file's sections: M1.1, M1.2, ... */
export async function readMaterial(file: File, index: number): Promise<LessonSource> {
  const prefix = `M${index + 1}`;
  const name = file.name;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  let kind: LessonSource['kind'];
  let sections: LessonSection[];
  if (ext === 'pptx') {
    kind = 'slides';
    sections = await readPptx(await file.arrayBuffer(), prefix);
  } else if (ext === 'pdf') {
    kind = 'pdf';
    sections = await readPdf(await file.arrayBuffer(), prefix);
  } else if (ext === 'docx') {
    kind = 'document';
    sections = await readDocx(await file.arrayBuffer(), prefix);
  } else if (ext === 'gridnote') {
    // a note written in Appa: its text, formulas as LaTeX lines
    kind = 'text';
    const data = JSON.parse(await file.text()) as { items?: GridItem[] };
    sections = readText(sheetOf(formulasIntoText(toSheet(data.items ?? []), SHEET_COLS)).text, prefix);
  } else if (['txt', 'md', 'markdown'].includes(ext)) {
    kind = 'text';
    sections = readText(await file.text(), prefix);
  } else {
    throw new Error(`${name}: use PowerPoint (.pptx), PDF, Word (.docx) or text files. Older .ppt files need saving as .pptx first.`);
  }
  return { id: prefix, name, kind, sections };
}

/** How much readable text a source has, and how many of its sections are empty (likely images). */
export function sourceStats(s: LessonSource): { chars: number; empty: number } {
  return { chars: s.sections.reduce((n, x) => n + x.text.length, 0), empty: s.sections.filter((x) => x.text.length < 20).length };
}
