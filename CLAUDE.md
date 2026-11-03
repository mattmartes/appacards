# Appa: notes for Claude

Appa is an Anki-style flashcard app with FSRS scheduling, AI tools (Polish,
Learn, Quiz, smart cards) and Grid notes, written in TypeScript with React,
Vite and IndexedDB. It runs in the browser and as an Electron desktop app for
Windows and macOS. The GitHub repository is https://github.com/mattmartes/appacards
(public, branch `main`); this folder (`anki-web/`) is the repository root.

## Layout

- `src/lib/`: logic with no UI (collection/IndexedDB, FSRS, scheduler, AI calls in
  `polish.ts`, `learn.ts`, `quiz.ts`, Grid notes in `gridText.ts` and `notesAi.ts`).
- `src/views/`: screens. `GridLab.tsx` holds the Grid notes editor (`GridEditor`),
  used by the Lab and by notes written in a deck's Notes (`GridNotePage.tsx`).
  `NoteEditor.tsx` is the **card field editor** for Add/Edit cards: a different
  thing, don't overwrite it.
- `electron/`: the desktop container. `main.cjs` (window, `app://` protocol, data
  folder IPC), `preload.cjs` (the `window.desktop` bridge), `updater.cjs` and
  `bundle.cjs` (self-updates), `build.mjs`, `publish.mjs`, `keys.mjs`.
- `.github/workflows/desktop.yml`: builds the installers on GitHub (Mac and
  Windows) and publishes releases from version tags.

## Commands

```bash
npm run dev                    # web app at http://localhost:5173
npx tsc -p tsconfig.app.json --noEmit
npm run desktop:build          # Windows installers into release/ (Mac ones when run on a Mac)
npm run publish-update -- "notes"   # signed update into release/updates/ (normally CI does this)
```

The browser preview is the `fsrs-cards` server in `../.claude/launch.json` (port 5173).

## Routine after a change

1. Type-check (`npx tsc -p tsconfig.app.json --noEmit`) and fix any errors.
2. Check it in the browser preview when the change shows there.
3. Bump the patch number of `"version"` in `package.json` (1.1.0 → 1.1.1).
4. Run `npm run desktop:build`. If it says a file is in use, Appa is open: tell the
   user to close it and build again.
5. Commit with a message saying what changed and why, and push to `main`.
6. Offer to release it (below). Releasing sends the update to everyone's
   installed app, so do it when the user says to, not on your own.

## Releasing

A release is a version tag; GitHub does the rest. With `"version"` bumped and
committed:

```bash
git tag -a v1.1.1 -m "One line on what's new"   # must match package.json's version
git push origin v1.1.1
```

The workflow then builds the Mac and Windows installers, signs the update with
the `UPDATE_PRIVATE_KEY` repository secret, and publishes a GitHub release with
all of it. Installed apps read `releases/latest/download/latest.json`
(`"appaUpdates.url"` in `package.json`), download the update within a few
hours or at their next start, and offer a restart. Point the user at the run on
the repository's Actions tab, and check it finished.

If the secret isn't set, the release still has installers but no update, and
the workflow warns about it.

## How updates work, and what needs a new installer

- Installed apps only replace the web app (`dist/`). The container
  (`electron/`) and Electron itself only change with a new installer.
- When a change to `electron/` is needed by the web app, raise
  `"appaUpdates.minShell"` to the version being released, so older installers
  say a new download is needed instead of loading something they can't run.
- Updates are signed with `update-keys/private.pem` (never commit it; it's in
  `.gitignore`) and checked against `electron/update-key.pem` (committed).
  Losing the private key means installed apps can't update any more.
- A downloaded update that never reports in after starting twice is dropped,
  and the app goes back to its built-in copy.

## Testing the desktop app

Never test with the user's own profile or data folder. Start the built app
with a throwaway profile whose `desktop-config.json` points `dataDir` at an
empty folder:

```bash
"release/Appa <version> portable.exe" --user-data-dir=<temp profile>
```

`APPA_UPDATE_URL=http://127.0.0.1:<port>/latest.json` makes it check a local
server instead of GitHub. Only close processes started with that profile: the
user may have Appa open.

## Gotchas

- In a Bash heredoc, `\\` turns into `\`. For patch scripts, write them with the
  Write tool or use Python raw strings.
- Vite sometimes keeps serving an old copy of a file after several quick edits:
  `touch` it and reload.
- The browser preview pane is hidden, so `requestAnimationFrame`, CSS
  transitions, `img.decode()` and focus/blur events don't happen there. Check
  state and computed values instead, and load images with `onload` rather than
  `decode()`.
- A changed `vite.config.ts` needs the preview server restarted.

## Style

- Comments say why, in plain words, at the density of the code around them.
- Keep the user's data safe: no destructive migrations; old saved formats are
  read and converted (see `toSheet` in `gridText.ts`).
