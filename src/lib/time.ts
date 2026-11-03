export const DAY_SECS = 86_400;

/** Anki's "next day starts at" preference, in hours after midnight. */
let rolloverHour = 4;

export function setRolloverHour(hour: number) {
  rolloverHour = Math.min(Math.max(Math.round(hour), 0), 23);
}

/** Day number (days since the unix epoch in local time), with the day
 * starting at the rollover hour. */
export function dayNumber(ms: number = Date.now()): number {
  const d = new Date(ms - rolloverHour * 3600_000);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

export function today(): number {
  return dayNumber();
}

export function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

/** Epoch ms at which the given day number begins. */
export function dayStartMs(day: number): number {
  const utc = new Date(day * 86_400_000);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), rolloverHour).getTime();
}

/** Anki-style compact interval label. */
export function formatInterval(secs: number): string {
  const units: [number, string][] = [
    [365 * DAY_SECS, 'y'],
    [30 * DAY_SECS, 'mo'],
    [DAY_SECS, 'd'],
    [3600, 'h'],
    [60, 'm'],
  ];
  if (secs < 60) return '<1m';
  for (const [size, label] of units) {
    if (secs >= size) {
      const v = secs / size;
      const shown = size >= 30 * DAY_SECS ? Math.round(v * 10) / 10 : Math.round(v);
      return `${shown}${label}`;
    }
  }
  return `${Math.round(secs)}s`;
}

export function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  return `${(mins / 60).toFixed(1)} h`;
}
