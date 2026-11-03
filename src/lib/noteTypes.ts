// Anki's stock note types (rslib/src/notetype/stock.rs) and card generation
// for them (rslib/src/notetype/cardgen.rs).

import { occlusionOrdinals, renderOcclusionCard } from './imageOcclusion';
import { clozeOrdinals, renderCard, stripHtml } from './template';
import type { Note, NoteKind } from './types';

export interface NoteTypeDef {
  kind: NoteKind;
  name: string;
  fields: string[];
  cloze: boolean;
  templates: { name: string; qfmt: string; afmt: string }[];
}

const answer = (field: string) => `{{FrontSide}}\n\n<hr id=answer>\n\n{{${field}}}`;

export const NOTE_TYPES: NoteTypeDef[] = [
  {
    kind: 'basic',
    name: 'Basic',
    fields: ['Front', 'Back'],
    cloze: false,
    templates: [{ name: 'Card 1', qfmt: '{{Front}}', afmt: answer('Back') }],
  },
  {
    kind: 'reversed',
    name: 'Basic (and reversed card)',
    fields: ['Front', 'Back'],
    cloze: false,
    templates: [
      { name: 'Card 1', qfmt: '{{Front}}', afmt: answer('Back') },
      { name: 'Card 2', qfmt: '{{Back}}', afmt: answer('Front') },
    ],
  },
  {
    kind: 'optionalReversed',
    name: 'Basic (optional reversed card)',
    fields: ['Front', 'Back', 'Add Reverse'],
    cloze: false,
    templates: [
      { name: 'Card 1', qfmt: '{{Front}}', afmt: answer('Back') },
      { name: 'Card 2', qfmt: '{{#Add Reverse}}{{Back}}{{/Add Reverse}}', afmt: answer('Front') },
    ],
  },
  {
    kind: 'cloze',
    name: 'Cloze',
    fields: ['Text', 'Back Extra'],
    cloze: true,
    templates: [{ name: 'Cloze', qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>\n{{Back Extra}}' }],
  },
  {
    // Anki's stock Image Occlusion note type (rslib/src/image_occlusion/notetype.rs).
    // Cards are rendered by renderOcclusionCard rather than templates.
    kind: 'imageOcclusion',
    name: 'Image Occlusion',
    fields: ['Occlusion', 'Image', 'Header', 'Back Extra', 'Comments'],
    cloze: true,
    templates: [{ name: 'Image Occlusion', qfmt: '', afmt: '' }],
  },
  {
    // Appa's own: one card per case of a generator whose values change each
    // time it's shown (src/lib/smart.ts). Built with the smart card editor.
    kind: 'smart',
    name: 'Smart card',
    fields: ['Title'],
    cloze: false,
    templates: [],
  },
];

/** Fields edited with the normal text editor (Occlusion and Image have
 * their own mask editor). */
export function textFields(kind: NoteKind): string[] {
  const nt = noteType(kind);
  if (kind === 'smart') return [];
  return kind === 'imageOcclusion' ? nt.fields.filter((f) => f !== 'Occlusion' && f !== 'Image') : nt.fields;
}

export function noteType(kind: NoteKind): NoteTypeDef {
  return NOTE_TYPES.find((t) => t.kind === kind) ?? NOTE_TYPES[0];
}

export interface GeneratedCard {
  ord: number;
  front: string;
  back: string;
  answerReplacesFront: boolean;
}

const isBlank = (html: string) => stripHtml(html).replace(/[\s ]/g, '') === '' && !/<img|\[sound:/i.test(html);

/** The cards a note should have: one per cloze number for cloze notes, or
 * one per template whose question isn't empty. `ord` is 0-based. */
export function generateCards(note: Note, deckName: string): GeneratedCard[] {
  const nt = noteType(note.kind);
  const fields = Object.fromEntries(nt.fields.map((f) => [f, note.fields[f] ?? '']));
  if (note.kind === 'smart') {
    // the templates, for Browse; the reviewer fills them in each time
    return (note.smart?.cases ?? []).map((c, ord) => ({ ord, front: c.front, back: c.back, answerReplacesFront: false }));
  }
  const base = { fields, tags: note.tags, noteType: nt.name, deck: deckName };
  if (note.kind === 'imageOcclusion') {
    const io = { occlusion: fields.Occlusion, image: fields.Image, header: fields.Header, backExtra: fields['Back Extra'] };
    return occlusionOrdinals(fields.Occlusion).map((n) => ({
      ord: n - 1,
      front: renderOcclusionCard(io, n, true),
      back: renderOcclusionCard(io, n, false),
      answerReplacesFront: true,
    }));
  }
  if (nt.cloze) {
    const t = nt.templates[0];
    return clozeOrdinals(fields.Text).map((n) => ({
      ord: n - 1,
      ...renderCard(t.qfmt, t.afmt, { ...base, cardName: t.name, clozeOrd: n }),
    }));
  }
  return nt.templates
    .map((t, ord) => ({ ord, ...renderCard(t.qfmt, t.afmt, { ...base, cardName: t.name, clozeOrd: 1 }) }))
    .filter((c) => !isBlank(c.front));
}

/** Why a note can't be added yet, or null if it's fine. */
export function noteProblem(note: Note): string | null {
  const nt = noteType(note.kind);
  if (note.kind === 'smart') return note.smart?.cases.length ? null : 'Create the smart card first.';
  if (note.kind === 'imageOcclusion') {
    if (!/<img/i.test(note.fields.Image ?? '')) return 'Choose an image first.';
    if (occlusionOrdinals(note.fields.Occlusion ?? '').length === 0) return 'Draw at least one mask on the image.';
    return null;
  }
  if (isBlank(note.fields[nt.fields[0]] ?? '')) return `The ${nt.fields[0]} field is empty.`;
  if (nt.cloze && clozeOrdinals(note.fields.Text ?? '').length === 0) {
    return 'Add at least one cloze deletion, e.g. select text and press Ctrl+Shift+C.';
  }
  return null;
}
