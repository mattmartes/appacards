// Due-date plans: "I need to know this deck by <date>". Instead of a fixed
// new cards/day, the deck spreads its unseen cards over the days left,
// worked out afresh each day so cards added later are fitted in too.

import type { DuePlan } from './types';

/** New cards/day a plan never goes below, unless asked otherwise. */
export const DEFAULT_MIN_NEW = 10;

/** A plan set more than this many days ahead keeps the day before the due
 * date free of new cards, for reviewing only. */
const ROOM_FOR_REVIEW_DAY = 3;

/**
 * New cards allowed today under `plan`, or null when the plan doesn't apply
 * (none set, or the due date has passed) and the deck's usual limit does.
 * `newAtDayStart` is the deck's unseen new cards plus the new cards already
 * studied today, so the number doesn't shrink as you study.
 */
export function planNewLimit(plan: DuePlan | null | undefined, today: number, newAtDayStart: number): number | null {
  if (!plan) return null;
  const daysLeft = plan.day - today;
  if (daysLeft < 0) return null;
  const reviewDay = plan.day - plan.setOn > ROOM_FOR_REVIEW_DAY;
  // the days from today up to the day before the due date, less that day
  // too when the plan left room for a review-only day
  const days = reviewDay ? daysLeft - 1 : daysLeft;
  if (days <= 0) return reviewDay ? 0 : newAtDayStart;
  const spread = Math.ceil(newAtDayStart / days);
  return Math.min(newAtDayStart, Math.max(plan.minNew, spread));
}

/** <input type="date"> value ↔ day number (see dayNumber in time.ts). */
export function dayFromInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000) : null;
}
export function inputFromDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}
export function formatDay(day: number): string {
  return new Date(day * 86_400_000).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}
