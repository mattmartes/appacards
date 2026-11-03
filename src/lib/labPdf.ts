// The PDFs open beside Grid notes, one tab each, kept in this browser so
// they're still there next time.

import { openDB } from 'idb';

export interface LabPdf {
  id: string;
  blob: Blob;
  name: string;
}

/** The tabs: their PDFs in order, and the one showing. */
export interface LabPdfs {
  list: LabPdf[];
  active: string | null;
}

const db = () =>
  openDB('appa-lab', 1, {
    upgrade(d) {
      d.createObjectStore('files');
    },
  });

/** Each PDF is kept under its own key, with a small index of the tabs, so
 * switching tabs doesn't write every file again. */
interface Index {
  tabs: { id: string; name: string }[];
  active: string | null;
}

export const newPdfId = () => Math.random().toString(36).slice(2, 10);

export async function loadLabPdfs(): Promise<LabPdfs> {
  try {
    const d = await db();
    const index = (await d.get('files', 'pdfs')) as Index | undefined;
    if (!index) {
      // before tabs there was one PDF
      const old = (await d.get('files', 'pdf')) as { blob: Blob; name: string } | undefined;
      if (!old) return { list: [], active: null };
      const pdf = { id: newPdfId(), blob: old.blob, name: old.name };
      await addLabPdf(pdf);
      await saveLabTabs({ list: [pdf], active: pdf.id });
      await d.delete('files', 'pdf');
      return { list: [pdf], active: pdf.id };
    }
    const list: LabPdf[] = [];
    for (const t of index.tabs) {
      const blob = (await d.get('files', `pdf:${t.id}`)) as Blob | undefined;
      if (blob) list.push({ ...t, blob });
    }
    return { list, active: list.some((p) => p.id === index.active) ? index.active : (list[0]?.id ?? null) };
  } catch {
    return { list: [], active: null };
  }
}

/** Keeps a newly opened PDF's file. */
export async function addLabPdf(pdf: LabPdf): Promise<void> {
  try {
    await (await db()).put('files', pdf.blob, `pdf:${pdf.id}`);
  } catch {
    // open it again next time
  }
}

export async function removeLabPdf(id: string): Promise<void> {
  try {
    await (await db()).delete('files', `pdf:${id}`);
  } catch {
    // left over until the browser clears it
  }
}

/** Keeps the tabs' order and which one is showing. */
export async function saveLabTabs(state: LabPdfs): Promise<void> {
  try {
    const index: Index = { tabs: state.list.map(({ id, name }) => ({ id, name })), active: state.active };
    await (await db()).put('files', index, 'pdfs');
  } catch {
    // the last saved tabs come back next time
  }
}
