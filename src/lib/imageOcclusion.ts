// Image occlusion, compatible with Anki's format (rslib/src/image_occlusion,
// ts/routes/image-occlusion). Masks live in the Occlusion field as cloze
// deletions, one ordinal per card:
//   {{c1::image-occlusion:rect:left=.2325:top=.3261:width=.202:height=.0975:oi=1}}
// Coordinates are fractions of the image's width/height. `oi=1` means
// "Hide all, guess one" (other masks stay covered); without it, "Hide one,
// guess one".

export type ShapeKind = 'rect' | 'ellipse' | 'polygon';

export interface Shape {
  kind: ShapeKind;
  /** 1-based cloze number; shapes sharing one form a group (one card) */
  ordinal: number;
  left: number;
  top: number;
  width: number;
  height: number;
  /** polygons only: fractions of the image, "x,y" pairs */
  points?: [number, number][];
}

export interface Occlusions {
  shapes: Shape[];
  /** "Hide all, guess one" */
  occludeInactive: boolean;
}

const CLOZE_RE = /\{\{c(\d+)::image-occlusion:([^}]*)\}\}/g;

/** Splits "rect:left=.1:top=.2" into the shape name and properties,
 * honouring Anki's backslash escapes. */
function parseProps(text: string): { shape: string; props: Record<string, string> } {
  const parts: string[] = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) cur += text[++i];
    else if (ch === ':') {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  const [shape, ...rest] = parts;
  const props: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf('=');
    if (eq > 0) props[p.slice(0, eq)] = p.slice(eq + 1);
  }
  return { shape, props };
}

export function parseOcclusions(field: string): Occlusions {
  const shapes: Shape[] = [];
  let occludeInactive = false;
  for (const m of field.matchAll(CLOZE_RE)) {
    const ordinal = Number(m[1]);
    const { shape, props } = parseProps(m[2]);
    const num = (k: string) => Number(props[k] ?? 0) || 0;
    if (props.oi === '1') occludeInactive = true;
    if (shape === 'rect') {
      shapes.push({ kind: 'rect', ordinal, left: num('left'), top: num('top'), width: num('width'), height: num('height') });
    } else if (shape === 'ellipse') {
      const rx = num('rx');
      const ry = num('ry');
      shapes.push({
        kind: 'ellipse',
        ordinal,
        left: num('left'),
        top: num('top'),
        width: num('width') || rx * 2,
        height: num('height') || ry * 2,
      });
    } else if (shape === 'polygon' && props.points) {
      const points = props.points
        .split(' ')
        .map((p) => p.split(',').map(Number) as [number, number])
        .filter((p) => p.length === 2 && p.every(Number.isFinite));
      if (points.length >= 3) {
        const xs = points.map((p) => p[0]);
        const ys = points.map((p) => p[1]);
        const left = Math.min(...xs);
        const top = Math.min(...ys);
        shapes.push({ kind: 'polygon', ordinal, left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top, points });
      }
    }
  }
  return { shapes, occludeInactive };
}

/** Anki writes numbers like ".2325". */
function fmt(n: number) {
  return Math.min(Math.max(n, 0), 1)
    .toFixed(4)
    .replace(/0+$/, '')
    .replace(/\.$/, '')
    .replace(/^0(?=\.)/, '');
}

export function serializeOcclusions({ shapes, occludeInactive }: Occlusions): string {
  const oi = occludeInactive ? ':oi=1' : '';
  return shapes
    .map((s) => {
      let body: string;
      if (s.kind === 'ellipse') {
        body = `ellipse:left=${fmt(s.left)}:top=${fmt(s.top)}:rx=${fmt(s.width / 2)}:ry=${fmt(s.height / 2)}`;
      } else if (s.kind === 'polygon' && s.points) {
        body = `polygon:points=${s.points.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ')}`;
      } else {
        body = `rect:left=${fmt(s.left)}:top=${fmt(s.top)}:width=${fmt(s.width)}:height=${fmt(s.height)}`;
      }
      return `{{c${s.ordinal}::image-occlusion:${body}${oi}}}`;
    })
    .join('<br>');
}

export function occlusionOrdinals(field: string): number[] {
  return [...new Set(parseOcclusions(field).shapes.map((s) => s.ordinal))].sort((a, b) => a - b);
}

/** Renumbers ordinals to 1..n in order of first appearance, keeping groups. */
export function compactOrdinals(shapes: Shape[]): Shape[] {
  const map = new Map<number, number>();
  for (const s of shapes) if (!map.has(s.ordinal)) map.set(s.ordinal, map.size + 1);
  return shapes.map((s) => ({ ...s, ordinal: map.get(s.ordinal)! }));
}

function shapeSvg(s: Shape, cls: string): string {
  const attrs = `class="${cls}" vector-effect="non-scaling-stroke"`;
  if (s.kind === 'ellipse') {
    return `<ellipse ${attrs} cx="${s.left + s.width / 2}" cy="${s.top + s.height / 2}" rx="${s.width / 2}" ry="${s.height / 2}"/>`;
  }
  if (s.kind === 'polygon' && s.points) {
    return `<polygon ${attrs} points="${s.points.map(([x, y]) => `${x},${y}`).join(' ')}"/>`;
  }
  return `<rect ${attrs} x="${s.left}" y="${s.top}" width="${s.width}" height="${s.height}"/>`;
}

/** The SVG mask layer for one card side. */
export function masksSvg(occ: Occlusions, ordinal: number, question: boolean): string {
  const parts: string[] = [];
  for (const s of occ.shapes) {
    if (s.ordinal === ordinal) parts.push(shapeSvg(s, question ? 'io-active' : 'io-highlight'));
    else if (occ.occludeInactive) parts.push(shapeSvg(s, 'io-inactive'));
  }
  return `<svg class="io-masks" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">${parts.join('')}</svg>`;
}

/** Renders one image occlusion card side as HTML, like Anki's stock
 * Image Occlusion templates. `image` is the Image field (an <img> tag). */
export function renderOcclusionCard(
  fields: { occlusion: string; image: string; header: string; backExtra: string },
  ordinal: number,
  question: boolean,
): string {
  const occ = parseOcclusions(fields.occlusion);
  const header = fields.header.trim() ? `<div class="io-header">${fields.header}</div>` : '';
  const body =
    `${header}<div class="io-container">${fields.image}${masksSvg(occ, ordinal, question)}</div>`;
  if (question) return `<div class="io-card">${body}</div>`;
  const toggle = `<div><button type="button" class="io-toggle" onclick="this.closest('.io-card').classList.toggle('io-masks-hidden')">Toggle masks</button></div>`;
  const extra = fields.backExtra.trim() ? `<div class="io-extra">${fields.backExtra}</div>` : '';
  return `<div class="io-card">${body}${toggle}${extra}</div>`;
}
