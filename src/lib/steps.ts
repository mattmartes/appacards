/** "1m 10m 1h 1d" -> minutes, as Anki's step fields accept. Null if invalid. */
export function parseSteps(s: string): number[] | null {
  const units: Record<string, number> = { s: 1 / 60, m: 1, h: 60, d: 1440 };
  const out: number[] = [];
  for (const part of s.trim().split(/\s+/).filter(Boolean)) {
    const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(part);
    if (!m) return null;
    out.push(Number(m[1]) * units[m[2] || 'm']);
  }
  return out;
}

export function formatSteps(steps: number[]): string {
  return steps
    .map((m) =>
      m >= 1440 && m % 1440 === 0 ? `${m / 1440}d` : m >= 60 && m % 60 === 0 ? `${m / 60}h` : m < 1 ? `${Math.round(m * 60)}s` : `${m}m`,
    )
    .join(' ');
}

export function parseParams(s: string): number[] {
  const t = s.trim();
  return t ? t.split(/[\s,]+/).filter(Boolean).map(Number) : [];
}
