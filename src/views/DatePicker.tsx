// A date picker for "know it by": a button showing the date and how far
// off it is, which opens a month calendar with quick picks. Values are
// <input type="date"> strings (YYYY-MM-DD), like the field it replaces.

import { useEffect, useRef, useState } from 'react';
import { dayFromInput, inputFromDay } from '../lib/dueDate';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const QUICK: [string, number][] = [
  ['1 week', 7],
  ['2 weeks', 14],
  ['3 weeks', 21],
  ['1 month', 30],
];

/** UTC date parts of a day number (day numbers count local calendar days). */
const partsOf = (day: number) => {
  const d = new Date(day * 86_400_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), date: d.getUTCDate(), weekday: d.getUTCDay() };
};
const dayOf = (y: number, m: number, date: number) => Math.floor(Date.UTC(y, m, date) / 86_400_000);

function untilLabel(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  const weeks = Math.round(days / 7);
  return days < 60 ? `in ${days} days · about ${weeks} weeks` : `in ${days} days · about ${Math.round(days / 30)} months`;
}

export function DatePicker({ value, min, today, onChange }: { value: string; min: number; today: number; onChange: (value: string) => void }) {
  const chosen = dayFromInput(value);
  const [open, setOpen] = useState(false);
  // the month on show, and the day the arrow keys are on
  const [cursor, setCursor] = useState(chosen ?? min);
  const [month, setMonth] = useState(() => {
    const p = partsOf(chosen ?? min);
    return { y: p.y, m: p.m };
  });
  const wrap = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  // keep the keyboard's day in view and focused
  useEffect(() => {
    if (!open) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${cursor}"]`)?.focus();
  }, [open, cursor, month]);

  const show = (day: number) => {
    const p = partsOf(day);
    setMonth({ y: p.y, m: p.m });
    setCursor(day);
  };
  const pick = (day: number) => {
    if (day < min) return;
    onChange(inputFromDay(day));
    show(day);
    setOpen(false);
  };
  const shiftMonth = (by: number) => {
    const m = month.m + by;
    const next = { y: month.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    setMonth(next);
    const p = partsOf(cursor);
    const last = partsOf(dayOf(next.y, next.m + 1, 0)).date;
    setCursor(dayOf(next.y, next.m, Math.min(p.date, last)));
  };

  const first = dayOf(month.y, month.m, 1);
  const lead = partsOf(first).weekday;
  const inMonth = partsOf(dayOf(month.y, month.m + 1, 0)).date;
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: inMonth }, (_, i) => first + i)];
  while (cells.length % 7) cells.push(null);
  const title = new Date(Date.UTC(month.y, month.m, 1)).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const canGoBack = dayOf(month.y, month.m, 1) > min;

  const label = chosen
    ? new Date(chosen * 86_400_000).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })
    : 'Choose a date';

  return (
    <div className="date-picker" ref={wrap}>
      <button
        type="button"
        className={`date-picker-button ${open ? 'open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open && chosen) show(chosen);
          setOpen(!open);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 10h18" />
        </svg>
        <span className="date-picker-text">
          <b>{label}</b>
          {chosen !== null && <span className="muted">{untilLabel(chosen - today)}</span>}
        </span>
      </button>

      {open && (
        <div
          className="date-pop"
          role="dialog"
          aria-label="Choose the date"
          onKeyDown={(e) => {
            const move: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
            if (e.key in move) {
              e.preventDefault();
              show(Math.max(min, cursor + move[e.key]));
            } else if (e.key === 'PageUp' || e.key === 'PageDown') {
              e.preventDefault();
              shiftMonth(e.key === 'PageUp' ? -1 : 1);
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          <div className="date-quick">
            {QUICK.map(([name, days]) => (
              <button type="button" key={name} className={chosen === today + days ? 'active' : ''} onClick={() => pick(today + days)}>
                {name}
              </button>
            ))}
          </div>
          <div className="date-head">
            <button type="button" className="icon-button" onClick={() => shiftMonth(-1)} disabled={!canGoBack} aria-label="Previous month">
              ‹
            </button>
            <span>{title}</span>
            <button type="button" className="icon-button" onClick={() => shiftMonth(1)} aria-label="Next month">
              ›
            </button>
          </div>
          <div className="date-grid" ref={grid} role="grid">
            {WEEKDAYS.map((w) => (
              <span key={w} className="date-weekday" aria-hidden="true">
                {w}
              </span>
            ))}
            {cells.map((day, i) =>
              day === null ? (
                <span key={`x${i}`} />
              ) : (
                <button
                  type="button"
                  key={day}
                  data-day={day}
                  tabIndex={day === cursor ? 0 : -1}
                  disabled={day < min}
                  className={`date-day ${day === chosen ? 'chosen' : ''} ${day === today ? 'today' : ''} ${chosen !== null && day > today && day < chosen ? 'between' : ''}`}
                  aria-pressed={day === chosen}
                  aria-label={new Date(day * 86_400_000).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })}
                  onClick={() => pick(day)}
                >
                  {partsOf(day).date}
                </button>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
