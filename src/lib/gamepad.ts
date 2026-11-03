// Game controllers (Joy-Cons and others) through the browser's Gamepad API.
// The API has no events for button presses, so connected pads are polled
// about 60 times a second and a press is reported when an input goes from released to
// held. Inputs are recorded by raw index, so any controller works whatever
// its layout: you map a button by pressing it.

import { useEffect, useState } from 'react';
import type { ControllerAction, PadInput } from './types';

export interface PadPress {
  input: PadInput;
  padId: string;
}

type Listener = (press: PadPress) => void;

const listeners = new Set<Listener>();
/** pad -> inputs held at the last poll */
const held = new Map<string, Set<string>>();
/** pad -> axis values when first seen; sticks rest near 0, hats rest elsewhere */
const restingAxes = new Map<string, number[]>();
let timer: ReturnType<typeof setInterval> | null = null;
const POLL_MS = 16;

/** How far an axis must move from rest, and how close to a recorded value it must be. */
const AXIS_MOVED = 0.5;
const AXIS_MATCH = 0.25;

const padKey = (p: Gamepad) => `${p.index}:${p.id}`;
const inputKey = (i: PadInput) => (i.kind === 'button' ? `b${i.index}` : `a${i.index}:${i.value}`);

export function sameInput(a: PadInput | undefined, b: PadInput | undefined): boolean {
  if (!a || !b || a.kind !== b.kind || a.index !== b.index) return false;
  return a.kind === 'button' || Math.abs(a.value - (b as typeof a).value) < AXIS_MATCH;
}

function pads(): Gamepad[] {
  try {
    return [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected);
  } catch {
    // blocked by a permissions policy
    return [];
  }
}

/** The inputs a pad is holding right now. */
function heldInputs(p: Gamepad): PadInput[] {
  const out: PadInput[] = [];
  p.buttons.forEach((b, index) => {
    if (b.pressed || b.value > 0.5) out.push({ kind: 'button', index });
  });
  const key = padKey(p);
  if (!restingAxes.has(key)) restingAxes.set(key, [...p.axes]);
  const rest = restingAxes.get(key)!;
  p.axes.forEach((v, index) => {
    if (Math.abs(v - (rest[index] ?? 0)) < AXIS_MOVED) return;
    // sticks report a direction (±1); hats report one of a few fixed values
    const value = Math.abs(rest[index] ?? 0) < 0.2 ? Math.sign(v) : Math.round(v * 100) / 100;
    out.push({ kind: 'axis', index, value });
  });
  return out;
}

function poll() {
  const seen = new Set<string>();
  for (const p of pads()) {
    const key = padKey(p);
    seen.add(key);
    const before = held.get(key) ?? new Set<string>();
    const now = new Set<string>();
    for (const input of heldInputs(p)) {
      const k = inputKey(input);
      now.add(k);
      if (!before.has(k)) for (const l of [...listeners]) l({ input, padId: p.id });
    }
    held.set(key, now);
  }
  for (const key of [...held.keys()]) {
    if (!seen.has(key)) {
      held.delete(key);
      restingAxes.delete(key);
    }
  }
}

/** Calls `listener` on every controller press until the returned function is called. */
export function onPadPress(listener: Listener): () => void {
  listeners.add(listener);
  timer ??= setInterval(poll, POLL_MS);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Names of the connected controllers. Browsers only list a controller
 * after one of its buttons is pressed while the page is open. */
export function useGamepads(): string[] {
  const [names, setNames] = useState<string[]>(() => pads().map((p) => p.id));
  useEffect(() => {
    const update = () => setNames(pads().map((p) => p.id));
    window.addEventListener('gamepadconnected', update);
    window.addEventListener('gamepaddisconnected', update);
    const timer = setInterval(update, 1000);
    return () => {
      window.removeEventListener('gamepadconnected', update);
      window.removeEventListener('gamepaddisconnected', update);
      clearInterval(timer);
    };
  }, []);
  return names;
}

/** A friendlier name for a controller id like "Joy-Con (R) (STANDARD GAMEPAD Vendor: 057e Product: 2007)". */
export function padName(id: string): string {
  return id.replace(/\s*\((STANDARD GAMEPAD|Vendor:)[^)]*\)\s*/gi, ' ').replace(/\s+/g, ' ').trim() || 'Controller';
}

// Positions in the browser's standard layout. Nintendo labels differ (its A
// is on the right), so positions are named rather than letters.
const STANDARD_BUTTONS = [
  'Bottom button',
  'Right button',
  'Left button',
  'Top button',
  'Left bumper (L)',
  'Right bumper (R)',
  'Left trigger (ZL)',
  'Right trigger (ZR)',
  'Minus / Select',
  'Plus / Start',
  'Left stick press',
  'Right stick press',
  'D-pad up',
  'D-pad down',
  'D-pad left',
  'D-pad right',
  'Home',
  'Capture',
];

export function describeInput(i: PadInput): string {
  if (i.kind === 'button') {
    const name = STANDARD_BUTTONS[i.index];
    return name ? `${name} (button ${i.index})` : `Button ${i.index}`;
  }
  if (i.value === 1 || i.value === -1) {
    const dir = i.index % 2 === 0 ? (i.value < 0 ? 'left' : 'right') : i.value < 0 ? 'up' : 'down';
    return `Stick ${dir} (axis ${i.index})`;
  }
  return `Hat/D-pad at ${i.value} (axis ${i.index})`;
}

export const CONTROLLER_ACTIONS: { action: ControllerAction; label: string; hint: string }[] = [
  { action: 'show', label: 'Show answer', hint: 'like Space' },
  { action: 'again', label: 'Again', hint: 'like 1' },
  { action: 'hard', label: 'Hard', hint: 'like 2' },
  { action: 'good', label: 'Good', hint: 'like 3' },
  { action: 'easy', label: 'Easy', hint: 'like 4' },
  { action: 'undo', label: 'Undo', hint: 'like Ctrl+Z' },
];

/** The action a press is bound to, if any. */
export function actionFor(bindings: Partial<Record<ControllerAction, PadInput>>, input: PadInput): ControllerAction | undefined {
  return CONTROLLER_ACTIONS.find(({ action }) => sameInput(bindings[action], input))?.action;
}
