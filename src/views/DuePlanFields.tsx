// The "Add due date" toggle and its fields, shared by the New deck dialog
// and a deck's settings: the date the deck must be known by, and the fewest
// new cards a day.

import { dayFromInput, DEFAULT_MIN_NEW, formatDay, inputFromDay, planNewLimit } from '../lib/dueDate';
import { today } from '../lib/time';
import type { DuePlan } from '../lib/types';
import { DatePicker } from './DatePicker';

/** What the fields hold while being edited. */
export interface DueDraft {
  on: boolean;
  date: string;
  minNew: string;
  /** kept from the saved plan, so editing the minimum doesn't reset it */
  setOn?: number;
}

export function draftFromPlan(plan: DuePlan | null | undefined): DueDraft {
  return plan
    ? { on: true, date: inputFromDay(plan.day), minNew: String(plan.minNew), setOn: plan.setOn }
    : { on: false, date: inputFromDay(today() + 14), minNew: String(DEFAULT_MIN_NEW) };
}

/** The plan to save, null for none, or an error message to show. */
export function planFromDraft(d: DueDraft, before?: DuePlan | null): DuePlan | null | string {
  if (!d.on) return null;
  const day = dayFromInput(d.date);
  if (day === null) return 'Choose the date you need to know the deck by.';
  if (day <= today()) return 'The due date has to be after today.';
  const minNew = Math.round(Number(d.minNew));
  if (!(minNew >= 0)) return 'The minimum new cards a day must be 0 or more.';
  // a new date starts the plan again from today; same date keeps when it began
  const setOn = before && before.day === day ? before.setOn : today();
  return { day, setOn, minNew };
}

export function DuePlanFields({ draft, onChange, newCards }: { draft: DueDraft; onChange: (d: DueDraft) => void; newCards?: number }) {
  const t = today();
  const plan = planFromDraft(draft);
  const preview = plan && typeof plan === 'object' && newCards !== undefined ? planNewLimit(plan, t, newCards) : null;
  const reviewDay = plan && typeof plan === 'object' && plan.day - plan.setOn > 3;

  return (
    <div className="due-plan">
      <label className="due-toggle">
        <input type="checkbox" role="switch" checked={draft.on} onChange={(e) => onChange({ ...draft, on: e.target.checked })} />
        <span>
          <b>Add due date</b>
          <span className="hint">Spread the new cards so you know them all by a date</span>
        </span>
      </label>
      {draft.on && (
        <>
          <div className="field">
            <span>Know it by</span>
            <DatePicker value={draft.date} min={t + 1} today={t} onChange={(date) => onChange({ ...draft, date })} />
          </div>
          <label className="field due-min">
            Minimum new cards/day
            <input type="number" min={0} value={draft.minNew} onChange={(e) => onChange({ ...draft, minNew: e.target.value })} />
          </label>
          <p className="muted due-plan-note">
            {typeof plan === 'string'
              ? plan
              : plan && (
                  <>
                    Each day, the new cards left are shared over the days until {formatDay(plan.day)}
                    {reviewDay ? ', keeping the day before it for reviews only' : ''}.
                    {preview !== null && newCards! > 0 && (
                      <>
                        {' '}
                        Today: <b className="num">{preview}</b> new card{preview === 1 ? '' : 's'} of {newCards}.
                      </>
                    )}
                  </>
                )}
          </p>
        </>
      )}
    </div>
  );
}
