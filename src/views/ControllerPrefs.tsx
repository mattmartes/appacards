// Preferences → Controller: map game controller buttons (Joy-Cons and
// others) to the reviewer's Show answer and 1-4 rating keys by pressing them.

import { useEffect, useState } from 'react';
import { useCollection } from '../lib/collection';
import { actionFor, CONTROLLER_ACTIONS, describeInput, onPadPress, padName, useGamepads, type PadPress } from '../lib/gamepad';
import type { ControllerAction, ControllerPrefs as Prefs, PadInput } from '../lib/types';

export function ControllerPrefs() {
  const col = useCollection();
  const prefs = col.prefs.controller;
  const pads = useGamepads();
  /** the action waiting for a button press */
  const [listening, setListening] = useState<ControllerAction | null>(null);
  /** mapping every action in turn */
  const [wizard, setWizard] = useState(false);
  const [lastPress, setLastPress] = useState<PadPress | null>(null);

  const save = (next: Prefs) => col.setPrefs({ ...col.prefs, controller: next });

  const bind = (action: ControllerAction, input: PadInput) => {
    const bindings = { ...prefs.bindings };
    // one button does one thing: take it from any other action
    const taken = actionFor(bindings, input);
    if (taken) delete bindings[taken];
    bindings[action] = input;
    void save({ ...prefs, bindings });
  };

  useEffect(
    () =>
      onPadPress((press) => {
        setLastPress(press);
        if (!listening) return;
        bind(listening, press.input);
        const i = CONTROLLER_ACTIONS.findIndex((a) => a.action === listening);
        // the wizard maps Show answer and the four ratings; Undo is optional
        const next = wizard && i < 4 ? CONTROLLER_ACTIONS[i + 1].action : null;
        setListening(next);
        if (!next) setWizard(false);
      }),
    // bind reads prefs, so re-subscribe when they change
    [listening, wizard, prefs],
  );

  // Escape cancels listening
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setListening(null);
      setWizard(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listening]);

  const lastAction = lastPress ? actionFor(prefs.bindings, lastPress.input) : undefined;

  return (
    <div className="panel" style={{ display: 'grid', gap: 14 }}>
      <h2 style={{ margin: 0 }}>Controller</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Review with a game controller such as a Joy-Con. Map its buttons to Show answer and Again / Hard / Good / Easy (the 1-4 keys)
        by pressing them. Before the answer is shown, any rating button shows it.
      </p>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={prefs.enabled} onChange={(e) => void save({ ...prefs, enabled: e.target.checked })} />
        Use a controller in the reviewer
      </label>

      <div className="controller-status">
        {pads.length ? (
          <>
            <b>Connected:</b> {pads.map(padName).join(', ')}
          </>
        ) : (
          <>
            <b>No controller found yet.</b> To pair a Joy-Con, open Windows Settings → Bluetooth & devices → Add device → Bluetooth, then
            hold the small sync button on the Joy-Con's rail until its lights sweep and pick it from the list. Once it's paired, press any
            button on it with this window open: browsers only show a controller after a button press.
          </>
        )}
      </div>

      <table className="controller-map">
        <tbody>
          {CONTROLLER_ACTIONS.map(({ action, label, hint }) => {
            const input = prefs.bindings[action];
            const isListening = listening === action;
            return (
              <tr key={action} className={isListening ? 'listening' : ''}>
                <td>
                  <b>{label}</b> <span className="muted">{hint}</span>
                </td>
                <td className="muted">{isListening ? 'Press a button on the controller… (Esc cancels)' : input ? describeInput(input) : 'Not set'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button
                    onClick={() => {
                      setWizard(false);
                      setListening(isListening ? null : action);
                    }}
                  >
                    {isListening ? 'Cancel' : input ? 'Change' : 'Set'}
                  </button>{' '}
                  <button
                    disabled={!input}
                    onClick={() => {
                      const bindings = { ...prefs.bindings };
                      delete bindings[action];
                      void save({ ...prefs, bindings });
                    }}
                  >
                    Clear
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="row">
        <button
          className="primary"
          onClick={() => {
            setWizard(true);
            setListening('show');
          }}
        >
          Map buttons…
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          {wizard ? 'Press the button for each action in turn.' : 'Steps through Show answer, Again, Hard, Good and Easy.'}
        </span>
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 13 }} aria-live="polite">
          {lastPress
            ? `Last press: ${describeInput(lastPress.input)}${lastAction ? ` → ${CONTROLLER_ACTIONS.find((a) => a.action === lastAction)!.label}` : ''}`
            : 'Press a controller button to test it.'}
        </span>
      </div>
    </div>
  );
}
