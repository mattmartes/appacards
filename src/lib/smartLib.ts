// What smart card generators get to work with: seeded random numbers (`r`)
// and helpers (`lib`) for crosses and ratios, DNA, and drawing tables and
// gels. Generators run in a worker, so nothing here touches the page.

// ---------------------------------------------------------------- random

export interface Rng {
  /** 0 <= x < 1 */
  float(): number;
  /** an integer from min to max, inclusive */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** a shuffled copy */
  shuffle<T>(items: readonly T[]): T[];
  /** k different items */
  sample<T>(items: readonly T[], k: number): T[];
  bool(p?: number): boolean;
  /** counts from n draws with these relative weights, e.g. multinomial(320, [9, 3, 4]) */
  multinomial(n: number, weights: readonly number[]): number[];
}

/** Mulberry32: small, fast, and the same numbers for the same seed everywhere. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const float = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(float() * (max - min + 1));
  const shuffle = <T>(items: readonly T[]) => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return {
    float,
    int,
    pick: (items) => items[int(0, items.length - 1)],
    shuffle,
    sample: (items, k) => shuffle(items).slice(0, k),
    bool: (p = 0.5) => float() < p,
    multinomial(n, weights) {
      const total = weights.reduce((s, w) => s + w, 0);
      const counts = weights.map(() => 0);
      for (let i = 0; i < n; i++) {
        let x = float() * total;
        let k = 0;
        while (k < weights.length - 1 && x >= weights[k]) x -= weights[k++];
        counts[k]++;
      }
      return counts;
    },
  };
}

export const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

// ---------------------------------------------------------------- numbers

export function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a;
}

/** "9:3:4" from [9, 3, 4] or [18, 6, 8]. */
export function ratio(counts: readonly number[]): string {
  const g = counts.reduce((x, y) => gcd(x, y), 0) || 1;
  return counts.map((c) => c / g).join(':');
}

/** "3/4" in lowest terms. */
export function fraction(n: number, d: number): string {
  const g = gcd(n, d) || 1;
  return d / g === 1 ? String(n / g) : `${n / g}/${d / g}`;
}

/** 0.1534 -> "15.3%" */
export const percent = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

// ---------------------------------------------------------------- crosses

/** One gene's two alleles, e.g. ["A", "a"] or ["b+", "b"]. */
export type Gene = [string, string];

export interface Offspring {
  genes: Gene[];
  /** out of 4^genes.length equally likely combinations */
  count: number;
}

/** "Aa" -> ["A","a"]; "b+/b" -> ["b+","b"]. */
export function parseGene(g: string | readonly string[]): Gene {
  if (Array.isArray(g)) return [String(g[0]), String(g[1])];
  const s = String(g).trim();
  if (s.includes('/')) {
    const [x, y] = s.split('/');
    return [x.trim(), y.trim()];
  }
  return [s[0], s.slice(1)];
}

/** Genotype text or genes: "Aa Bb", "Aa;Bb", "b+/b; c+/c" or [["A","a"], ...]. */
export function parseGenotype(g: string | readonly (string | readonly string[])[]): Gene[] {
  const parts = typeof g === 'string' ? g.split(/[;\s]+/).filter(Boolean) : g;
  return parts.map((p) => parseGene(p as string | string[]));
}

/** Dominant-looking alleles first: uppercase or "+". */
const rank = (allele: string) => (allele.includes('+') ? 0 : allele[0] !== allele[0].toLowerCase() ? 1 : 2);
const sortPair = ([x, y]: Gene): Gene => (rank(x) < rank(y) || (rank(x) === rank(y) && x <= y) ? [x, y] : [y, x]);

/** Every offspring genotype of a cross with how many of the 4^n
 * combinations give it, assuming independent assortment. */
export function cross(
  p1: string | readonly (string | readonly string[])[],
  p2: string | readonly (string | readonly string[])[],
): Offspring[] {
  const a = parseGenotype(p1);
  const b = parseGenotype(p2);
  if (a.length !== b.length) throw new Error('Both parents need the same number of genes');
  let combos: Gene[][] = [[]];
  for (let i = 0; i < a.length; i++) {
    const next: Gene[][] = [];
    for (const partial of combos) for (const x of a[i]) for (const y of b[i]) next.push([...partial, sortPair([x, y])]);
    combos = next;
  }
  const byKey = new Map<string, Offspring>();
  for (const genes of combos) {
    const key = genotypeText(genes);
    const o = byKey.get(key);
    if (o) o.count++;
    else byKey.set(key, { genes, count: 1 });
  }
  return [...byKey.values()];
}

/** "A/a; B/b" */
export const genotypeText = (genes: readonly Gene[]) => genes.map(([x, y]) => `${x}/${y}`).join('; ');

/** True if the gene carries this allele. */
export const has = (gene: Gene, allele: string) => gene[0] === allele || gene[1] === allele;

/** True if both copies are this allele. */
export const homozygous = (gene: Gene, allele: string) => gene[0] === allele && gene[1] === allele;

/** Totals per phenotype. `rule` names each genotype's phenotype, or returns
 * null for genotypes that don't survive (lethal), which are left out. */
export function phenotypes(offspring: readonly Offspring[], rule: (genes: Gene[]) => string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of offspring) {
    const p = rule(o.genes);
    if (p !== null) out[p] = (out[p] ?? 0) + o.count;
  }
  return out;
}

/** "9 black : 3 brown : 4 yellow", largest first, in lowest terms. */
export function describeRatio(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  const g = entries.reduce((acc, [, n]) => gcd(acc, n), 0) || 1;
  return entries.map(([name, n]) => `${n / g} ${name}`).join(' : ');
}

/** Just the numbers of describeRatio, e.g. "9:3:4". */
export function ratioOf(counts: Record<string, number>): string {
  return ratio(
    Object.values(counts)
      .slice()
      .sort((x, y) => y - x),
  );
}

// ---------------------------------------------------------------- DNA

const PAIR: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G', U: 'A', N: 'N' };

/** Base-by-base complement, same direction (ATGC -> TACG). */
export function complement(seq: string): string {
  return [...seq]
    .map((b) => {
      const c = PAIR[b.toUpperCase()] ?? b;
      return b === b.toLowerCase() ? c.toLowerCase() : c;
    })
    .join('');
}

/** The other strand read 5'->3' (ATGC -> GCAT). */
export const reverseComplement = (seq: string) => [...complement(seq)].reverse().join('');

/** A random sequence with roughly this GC fraction. */
export function randomSeq(r: Rng, length: number, gc = 0.5): string {
  let s = '';
  for (let i = 0; i < length; i++) s += r.bool(gc) ? r.pick(['G', 'C']) : r.pick(['A', 'T']);
  return s;
}

export const isPurine = (b: string) => /^[AG]$/i.test(b);

/** Transition (purine<->purine or pyrimidine<->pyrimidine) or transversion. */
export function mutationType(from: string, to: string): 'transition' | 'transversion' | 'none' {
  if (from.toUpperCase() === to.toUpperCase()) return 'none';
  return isPurine(from) === isPurine(to) ? 'transition' : 'transversion';
}

/** Codons in a reading frame (0, 1 or 2). */
export function codons(seq: string, frame = 0): string[] {
  const out: string[] = [];
  for (let i = frame; i + 3 <= seq.length; i += 3) out.push(seq.slice(i, i + 3));
  return out;
}

export const gcContent = (seq: string) => (seq.length ? [...seq].filter((b) => /[GC]/i.test(b)).length / seq.length : 0);

// ---------------------------------------------------------------- display

export const esc = (s: unknown) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Monospace text, for sequences. */
export const mono = (s: string) => `<span class="smart-mono">${esc(s)}</span>`;

/** "5′–ACGT–3′" */
export const strand = (seq: string, reversed = false) => mono(reversed ? `3′–${seq}–5′` : `5′–${seq}–3′`);

/** A double strand: the given top strand 5'->3' over its complement 3'->5'. */
export const duplex = (top: string) => `<div class="smart-mono">5′–${esc(top)}–3′<br>3′–${esc(complement(top))}–5′</div>`;

/** An HTML table. Cells are text; pass `html: true` to allow markup in them. */
export function table(header: readonly unknown[], rows: readonly (readonly unknown[])[], html = false): string {
  const cell = (c: unknown) => (html ? String(c) : esc(c));
  const head = header.length ? `<thead><tr>${header.map((h) => `<th>${cell(h)}</th>`).join('')}</tr></thead>` : '';
  return `<table class="smart-table">${head}<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export interface GelLane {
  label: string;
  /** fragment sizes (bp), or lengths for a sequencing gel */
  bands: readonly number[];
}

/** An agarose/sequencing gel as SVG: wells at the top, small fragments run
 * farthest. `scale: 'log'` spaces bands by log size (agarose); 'linear'
 * spaces them evenly by length (sequencing gels). */
export function gel(lanes: readonly GelLane[], opts: { scale?: 'log' | 'linear'; min?: number; max?: number } = {}): string {
  const sizes = lanes.flatMap((l) => l.bands);
  const min = opts.min ?? Math.min(...sizes);
  const max = opts.max ?? Math.max(...sizes);
  const scale = opts.scale ?? 'log';
  const laneW = 54;
  const top = 34;
  const h = Math.max(160, scale === 'linear' ? (max - min + 1) * 14 : 220);
  const w = lanes.length * laneW + 20;
  const y = (s: number) => {
    const f = scale === 'log' ? (Math.log(s) - Math.log(min)) / (Math.log(max) - Math.log(min) || 1) : (s - min) / (max - min || 1);
    return top + 8 + (1 - f) * h;
  };
  const parts = lanes.map((l, i) => {
    const x = 10 + i * laneW;
    const bands = l.bands.map((s) => `<rect x="${x + 8}" y="${y(s) - 3}" width="${laneW - 16}" height="6" rx="2" fill="currentColor"/>`).join('');
    return (
      `<text x="${x + laneW / 2}" y="14" text-anchor="middle" font-size="12" fill="currentColor">${esc(l.label)}</text>` +
      `<rect x="${x + 8}" y="${top - 12}" width="${laneW - 16}" height="7" fill="none" stroke="currentColor" stroke-opacity="0.5"/>` +
      bands
    );
  });
  return `<svg class="smart-gel" viewBox="0 0 ${w} ${top + h + 24}" width="${w}" role="img" aria-label="Gel">${parts.join('')}</svg>`;
}

/** The original four-lane Sanger gel for a synthesized strand (5'->3'):
 * each base gives a band of its length in its ddNTP lane, so reading from
 * the bottom (shortest) up gives the strand 5'->3'. */
export function sangerGel(synthesized: string): string {
  const lanes = ['A', 'C', 'G', 'T'].map((b) => ({
    label: `dd${b}`,
    bands: [...synthesized.toUpperCase()].flatMap((x, i) => (x === b ? [i + 1] : [])),
  }));
  return gel(lanes, { scale: 'linear', min: 1, max: synthesized.length });
}

/** Everything generators can use as `lib`. */
export const lib = {
  gcd,
  ratio,
  fraction,
  percent,
  parseGene,
  parseGenotype,
  cross,
  genotypeText,
  has,
  homozygous,
  phenotypes,
  describeRatio,
  ratioOf,
  complement,
  reverseComplement,
  randomSeq,
  isPurine,
  mutationType,
  codons,
  gcContent,
  esc,
  mono,
  strand,
  duplex,
  table,
  gel,
  sangerGel,
};
