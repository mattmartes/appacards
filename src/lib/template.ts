// Renders Anki card templates (a subset of rslib/src/template.rs and
// template_filters.rs): {{Field}}, {{#Field}}…{{/Field}}, {{^Field}}…,
// {{FrontSide}}, special fields, and the cloze/text/hint/furigana/kana/kanji
// filters. {{type:…}} renders nothing (typing answers isn't supported).

export interface RenderContext {
  fields: Record<string, string>;
  tags: string[];
  noteType: string;
  deck: string;
  cardName: string;
  /** 1-based cloze number for cloze cards */
  clozeOrd: number;
  question: boolean;
  frontSide?: string;
}

type Node = { kind: 'text'; text: string } | { kind: 'field'; key: string } | { kind: 'section'; key: string; negated: boolean; children: Node[] };

function parse(tmpl: string): Node[] {
  const root: Node[] = [];
  const stack: { key: string; nodes: Node[] }[] = [{ key: '', nodes: root }];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tmpl))) {
    const top = stack[stack.length - 1].nodes;
    if (m.index > last) top.push({ kind: 'text', text: tmpl.slice(last, m.index) });
    last = re.lastIndex;
    const tag = m[1].trim();
    if (tag.startsWith('#') || tag.startsWith('^')) {
      const node: Node = { kind: 'section', key: tag.slice(1).trim(), negated: tag[0] === '^', children: [] };
      top.push(node);
      stack.push({ key: node.key, nodes: node.children });
    } else if (tag.startsWith('/')) {
      if (stack.length > 1) stack.pop();
    } else if (tag.startsWith('!')) {
      // comment
    } else {
      top.push({ kind: 'field', key: tag });
    }
  }
  if (last < tmpl.length) stack[stack.length - 1].nodes.push({ kind: 'text', text: tmpl.slice(last) });
  return root;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fieldIsEmpty(text: string) {
  return stripHtml(text).replace(/[\s ]/g, '') === '' && !/<img|\[sound:/i.test(text);
}

// ------------------------------------------------------------ cloze

interface ClozeNode {
  ord: number;
  children: (string | ClozeNode)[];
  hint: string | null;
}

/** Parses text into plain runs and (possibly nested) {{cN::…::hint}} nodes. */
function parseCloze(text: string): (string | ClozeNode)[] {
  const out: (string | ClozeNode)[] = [];
  const stack: ClozeNode[] = [];
  const push = (s: string | ClozeNode) => {
    const target = stack.length ? stack[stack.length - 1].children : out;
    if (typeof s === 'string' && typeof target[target.length - 1] === 'string') target[target.length - 1] += s;
    else target.push(s);
  };
  let i = 0;
  while (i < text.length) {
    const open = /^\{\{c(\d+)::/.exec(text.slice(i, i + 12));
    if (open) {
      stack.push({ ord: Number(open[1]), children: [], hint: null });
      i += open[0].length;
    } else if (text.startsWith('}}', i) && stack.length) {
      const node = stack.pop()!;
      // a trailing ::hint belongs to this cloze
      const lastChild = node.children[node.children.length - 1];
      if (typeof lastChild === 'string') {
        const idx = lastChild.lastIndexOf('::');
        if (idx >= 0) {
          node.hint = lastChild.slice(idx + 2);
          node.children[node.children.length - 1] = lastChild.slice(0, idx);
        }
      }
      push(node);
      i += 2;
    } else {
      push(text[i]);
      i++;
    }
  }
  // unclosed clozes are kept as literal text
  while (stack.length) {
    const node = stack.shift()!;
    push(`{{c${node.ord}::`);
    node.children.forEach(push);
  }
  return out;
}

function clozeText(nodes: (string | ClozeNode)[]): string {
  return nodes.map((n) => (typeof n === 'string' ? n : clozeText(n.children))).join('');
}

function revealCloze(nodes: (string | ClozeNode)[], ord: number, question: boolean): string {
  return nodes
    .map((n) => {
      if (typeof n === 'string') return n;
      if (n.ord === ord) {
        if (question) {
          const inner = clozeText(n.children);
          return `<span class="cloze" data-cloze="${escapeHtml(inner)}" data-ordinal="${n.ord}">[${n.hint ?? '...'}]</span>`;
        }
        return `<span class="cloze" data-ordinal="${n.ord}">${revealCloze(n.children, ord, question)}</span>`;
      }
      return `<span class="cloze-inactive" data-ordinal="${n.ord}">${revealCloze(n.children, ord, question)}</span>`;
    })
    .join('');
}

export function clozeOrdinals(text: string): number[] {
  const ords = new Set<number>();
  const walk = (nodes: (string | ClozeNode)[]) =>
    nodes.forEach((n) => {
      if (typeof n !== 'string') {
        ords.add(n.ord);
        walk(n.children);
      }
    });
  walk(parseCloze(text));
  return [...ords].sort((a, b) => a - b);
}

function clozeOnly(nodes: (string | ClozeNode)[], ord: number): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (typeof n === 'string') continue;
    if (n.ord === ord) out.push(clozeText(n.children));
    else out.push(...clozeOnly(n.children, ord));
  }
  return out;
}

// ------------------------------------------------------------ filters

function furigana(text: string, mode: 'ruby' | 'kanji' | 'kana') {
  return text.replace(/ ?([^ >]+?)\[(.+?)\]/g, (_, base: string, reading: string) =>
    mode === 'kanji' ? base : mode === 'kana' ? reading : `<ruby><rb>${base}</rb><rt>${reading}</rt></ruby>`,
  );
}

let hintId = 0;
function applyFilter(filter: string, text: string, fieldName: string, ctx: RenderContext): string {
  switch (filter) {
    case 'text':
      return stripHtml(text);
    case 'cloze':
      return revealCloze(parseCloze(text), ctx.clozeOrd, ctx.question);
    case 'cloze-only':
      return clozeOnly(parseCloze(text), ctx.clozeOrd).join(', ');
    case 'hint': {
      if (fieldIsEmpty(text)) return '';
      const id = `hint${hintId++}`;
      return `<a class="hint" href="#" onclick="this.style.display='none';document.getElementById('${id}').style.display='block';return false;">${escapeHtml(fieldName)}</a><div id="${id}" class="hint" style="display:none">${text}</div>`;
    }
    case 'furigana':
      return furigana(text, 'ruby');
    case 'kanji':
      return furigana(text, 'kanji');
    case 'kana':
      return furigana(text, 'kana');
    default:
      // tts and unknown filters (e.g. add-on filters) pass the text through
      return filter.startsWith('tts') ? '' : text;
  }
}

function fieldValue(key: string, ctx: RenderContext): string {
  const parts = key.split(':').map((s) => s.trim());
  const name = parts.pop()!;
  const filters = parts;
  if (filters.includes('type')) return '';
  let text: string;
  switch (name) {
    case 'FrontSide':
      return ctx.frontSide ?? '';
    case 'Tags':
      text = ctx.tags.join(' ');
      break;
    case 'Type':
      text = ctx.noteType;
      break;
    case 'Deck':
      text = ctx.deck;
      break;
    case 'Subdeck':
      text = ctx.deck.split('::').pop() ?? '';
      break;
    case 'Card':
      text = ctx.cardName;
      break;
    case 'CardFlag':
      text = '';
      break;
    default:
      text = ctx.fields[name] ?? '';
  }
  // Filters apply from the one nearest the field outward.
  for (const f of [...filters].reverse()) text = applyFilter(f, text, name, ctx);
  return text;
}

function sectionTruthy(key: string, ctx: RenderContext): boolean {
  if (key in ctx.fields) return !fieldIsEmpty(ctx.fields[key]);
  if (key === 'Tags') return ctx.tags.length > 0;
  return ['Type', 'Deck', 'Subdeck', 'Card'].includes(key);
}

function renderNodes(nodes: Node[], ctx: RenderContext): string {
  return nodes
    .map((n) => {
      if (n.kind === 'text') return n.text;
      if (n.kind === 'field') return fieldValue(n.key, ctx);
      // Cloze notes use {{#c1}} sections to test for a given cloze number.
      const clozeSection = /^c(\d+)$/.exec(n.key);
      const truthy = clozeSection ? Number(clozeSection[1]) === ctx.clozeOrd : sectionTruthy(n.key, ctx);
      return truthy !== n.negated ? renderNodes(n.children, ctx) : '';
    })
    .join('');
}

export function renderTemplate(tmpl: string, ctx: RenderContext): string {
  return renderNodes(parse(tmpl), ctx);
}

/** Renders one Anki card into this app's front/back pair. When the answer
 * template starts with {{FrontSide}} (as most do), the back holds only what
 * follows it; otherwise the back is the full answer and replaces the front. */
export function renderCard(
  qfmt: string,
  afmt: string,
  base: Omit<RenderContext, 'question' | 'frontSide'>,
): { front: string; back: string; answerReplacesFront: boolean } {
  const front = renderTemplate(qfmt, { ...base, question: true });
  const trimmed = afmt.trimStart();
  const frontSideFirst = /^\{\{\s*FrontSide\s*\}\}/.exec(trimmed);
  if (frontSideFirst) {
    const rest = trimmed.slice(frontSideFirst[0].length).replace(/^\s*(<br\s*\/?>\s*)*<hr[^>]*>/i, '');
    return { front, back: renderTemplate(rest, { ...base, question: false, frontSide: front }).trim(), answerReplacesFront: false };
  }
  return { front, back: renderTemplate(afmt, { ...base, question: false, frontSide: front }), answerReplacesFront: true };
}
