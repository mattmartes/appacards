# Appa

A local, browser-based port of Anki to TypeScript (React + Vite). It covers Anki's FSRS scheduling, note types, editor, deck options and `.apkg` import. Your data stays in your browser's IndexedDB.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173. To serve a production build instead: `npm run build && npm run preview`.

## Desktop app (Windows)

The same web code also runs as a desktop app (Electron), which saves straight to a folder on your computer.

```bash
npm run desktop
```

This opens the app in its own window, with live reload while you edit the code.

```bash
npm run desktop:build
```

This builds `release/Appa Setup <version>.exe` (an installer) and `release/Appa <version> portable.exe` (a single file that runs without installing).

- **Where it saves:** everything goes to `Documents\Appa` (`fsrs-cards-backup.json`, `media/`, `background`) a couple of seconds after each change. An existing `Documents\FSRS Cards` folder from before the rename keeps being used. You can change the folder in Preferences → Saving.
- **Icon:** `build/icon.png` is the app and installer icon, and `public/icon.png` is the browser tab icon.
- **Moving computers:** a fresh install, or a new computer pointed at the same folder (for example in OneDrive), loads the saved collection automatically.
- **Security:** the window runs with context isolation and a sandbox. The page can only read and write inside the data folder, through `electron/preload.cjs`.

## Layout

- **Sidebar:** on the left are the Appa mark, then Home, Browse, Learn and Quiz. Below them is your deck tree, showing each deck's new count (blue) and cards due (green). Click a deck to study it; the content area on the right switches to its cards. Hovering a deck shows **+** (add cards) and a gear, which opens its name, options, **Browse cards** and delete. The Decks header has Import from Anki and Create deck. Statistics and Preferences sit at the bottom.
- **Opening a deck** (its arrow in the sidebar) shows two entries:
  - **Notes:** a file-explorer grid of the files you've uploaded for the deck (lecture slides, PDFs, Word documents, images, text). Add files with **Upload files** or by dropping them on the page. PDFs show their first page as a thumbnail; clicking a file previews it (every PDF page, the text of slides and documents, images). The preview can rename, move to another deck, download or delete it. **Start a lesson** and **Quiz me on these** use the ticked files, or every readable file if none are ticked. The first opens a new lesson in Learn already filled with them; the second makes or refreshes the deck's own quiz set and opens it in Quiz. Files named like practice quizzes or exams (quiz, exam, midterm, practice, PFF, answers…) become the quiz's style reference. Files are saved with your collection and to the save folder's `media/`, and deleting a deck deletes its files.
  - **Decks:** studies the deck's cards, and its subdecks are listed under it.
- **Home:** today's numbers (to review, new, reviewed today with time spent, percent correct, your streak), an **Up next** list of decks with cards waiting, a button to study the first one, and the heatmap.
- **Review heatmap:** below the decks, a year of study activity like the Review Heatmap add-on, with daily average, percentage of days studied, and longest and current streaks.
- **Browse:** cards are grouped by deck in collapsible sections, all collapsed when Browse opens, with Collapse all and Expand all.
- **Image occlusion:** in Add, pick the **Image Occlusion** type. Choose, paste or drop an image, then drag rectangles or ellipses over what to hide. Each mask is a card, and masks with the same number (Group, `Ctrl+G`) are asked together. Choose **Hide all, guess one** or **Hide one, guess one**. Masks are stored in Anki's format, and image occlusion notes in imported `.apkg` files render too.
- **Quiz** (top bar → **Quiz**): pick a deck and an AI quizzes you on it, one question at a time, for as long as you like.
  - **Questions:** they test understanding (applying a fact to a new example, predicting, comparing, explaining why) as well as recall. Wrong options come from the most related cards and common misconceptions, and options are shuffled.
  - **Question types:** one answer, select all that apply (5 options, 2–4 right, scored only if exactly right, with a note on every option), or a mix.
  - **Rolling:** two questions are written to start, then each new question is written while you answer the one before, so there's always one ready. Press **Finish** for your results. Each request sends the focus card and about 45 related cards, not the whole deck, which keeps questions cheap.
  - **Coverage:** each question targets one card. Cards never quizzed (in any quiz) come first, then the least-quizzed, with no card repeated until every card has had a turn and none twice within a few questions. "Weakest" and "haven't studied much" decide which uncovered cards go first. A bar shows how much of the deck the quiz has covered.
  - **Questions you get wrong** are saved. The same question, with its options reshuffled, comes back about five questions later, and every few questions in later quizzes on that deck, until you get it right twice in a row. It's marked "You got this wrong before".
  - **Answering:** click, use `1`–`5` or `A`–`E` (Enter checks a select-all question and goes on), or use a controller's Again/Hard/Good/Easy buttons. Each answer is explained.
  - **Results:** your score, coverage, and the questions you missed, with **Quiz me again on what I missed**.
  - **From your material** (Quiz → **From your material**): quiz sets built from your own files, for content that isn't in flashcards.
    - **Two kinds of upload:** *study material* (lecture slides, notes, readings as PowerPoint, PDF, Word or text) and *practice quizzes and past exams*. Files can be moved between the two.
    - **Questions** are written from the material, one slide or page at a time, with nearby and related pages for context. The practice quizzes closest to that topic are included so the AI matches the course's question formats, difficulty and the kinds of things it tests, writing new questions rather than copying them.
    - **Same quiz flow:** endless, one-answer or select-all questions, coverage across every slide or page, and missed questions that come back. Each set keeps its own history, saved with your collection and backups.

- **Learn** (top bar → **Learn**): an AI tutor teaches you your course material and unlocks flashcards as you show you understand it.
  - **Material:** upload PowerPoint (.pptx, with speaker notes), PDF, Word (.docx) or text files. Each slide or page becomes a numbered section (M1.3 is material 1, slide 3). Text is read but images aren't, so picture-only slides are flagged.
  - **Teaching plan:** the tutor orders the material for learning (prerequisites first, examples after their idea) into small concepts covering everything, and explains any reordering. You can reorder, rename or remove concepts before starting.
  - **Lessons:** the tutor teaches one short chunk at a time and ends each with one question. It judges your answer ("✓ Understood" or "Not quite yet"), re-explains differently when you're stuck, adds prerequisite concepts if you need them, and moves on once you've shown understanding. **I don't get it**, **I know this** and **Next concept** steer it. After the last concept you can keep asking questions.
  - **Flashcards:** each concept you understand can unlock a few short flashcards. Review them, edit or untick any, and add them to a deck, tagged `learn::<lesson>`.
  - **Flashcard preferences:** in the review window, tell the tutor how you want flashcards (e.g. "less wordy"). That preference applies to every card for the rest of the lesson and can rewrite the cards waiting there.
  - **Saving:** lessons, plans and conversations are saved with your collection and backups. A reply still arriving when you leave a lesson is saved too.

- **Smart cards** (Add → type **Smart card**): cards whose values change every time they're shown, so you practise a skill rather than memorize one example. Examples: crosses with new genes and organisms, or primers for a new template each time.
  - **Creating:** describe what you want to practise (optionally paste course notes), and an AI writes a small generator plus one card per skill. Or start from an example (PCR primers, or two-gene interactions with one card per interaction type).
  - **One card per skill:** within a card only the surface changes (names, letters, sequences, numbers). Each skill is its own card with its own FSRS schedule, so a miss points at one skill.
  - **Checked before saving:** the generator runs on 60 random versions per card, its hand-worked examples must give the right answers, and every card must use its placeholders (inputs like `[a]` on the front, answers on the back). Placeholders are clickable chips, and missing ones are flagged in red.
  - **Editing:** you can reword the cards and see random previews. Ask the AI for changes, or edit the generator code under Advanced.
  - **Reviewing:** each showing is a new version, avoiding the last few. The back shows the answer, the worked steps and common mistakes. **New values** re-rolls before you answer, the version's seed is saved with your answer, and **Report a wrong answer** saves that exact version, which **Update with AI** then uses as a counterexample to fix.
  - **Combination cards:** a smart note can require others. Its cards stay hidden until every card of those notes has a stability of at least a week.
  - **Safety:** generators run in a separate worker with no page, network or storage access, and are stopped if they take too long. Reviews need no AI and no internet.
  - **Polish:** AI Polish copies smart cards as they are.

- **AI Polish** (Browse → **AI Polish**): an AI model on OpenRouter goes through a deck and its subdecks.
  - **What it suggests:** clearer, more specific wording; splitting cards that test several things; and new cards that fill gaps the deck implies, such as a bryophyte counterpart to a fern card.
  - **What it flags:** cards too vague to have one answer (marked *Too vague* and rewritten to be specific), and cards that ask the same thing as another card in different words (marked *Duplicate*). The later copy of a duplicate is left out by default, with a link to the card it repeats, and is never dropped together with its twin. Cards that only overlap are reworded so the difference is clear. The review has **Too vague** and **Duplicates** filters.
  - **Reliability:** cards are sent 15 at a time. If a reply is cut off or isn’t clean JSON, the complete parts are kept and the missing cards are asked for again in smaller batches, up to 3 times. Cards from one note (cloze numbers, a card and its reverse) are marked as siblings and are never called duplicates; for imported cards this uses the Anki note id, or for decks imported before 0.1.7 cards added in the same second with matching text.
  - **What it skips:** image occlusion cards aren't sent and are copied as is.
  - **Review:** each original is shown on the left and its polished version on the right, marked *Reworded*, *Split into N cards*, *No changes* or *New card · fills a gap*. Every polished card can be edited or retyped.
  - **Choices:** per card, choose **Use polished**, **Keep original** or **Leave out**.
  - **Confirming** creates `<deck> - Polished` beside the original (same parent deck, same options preset, subdecks mirrored) with fresh, unstudied cards. The original deck is never changed.
  - **Exit:** an unconfirmed review can be resumed until the app closes.
  - **Key and model** are set in Preferences → AI (or in the AI Polish dialog). The key is saved on this computer only, not in backups or the save folder. The model list shows the newest models from the major labs (Anthropic, OpenAI, Google, xAI, DeepSeek, Qwen, Moonshot, Z.ai, Mistral, Meta) with their price per million tokens; **Other model…** takes any OpenRouter id. The default is Gemini 3.5 Flash. The dialog estimates what each run will cost.

- **Game controller** (Preferences → Controller): review with a Joy-Con or any other controller.
  - **Pairing a Joy-Con:** in Windows Settings → Bluetooth & devices → Add device, hold the sync button on the Joy-Con’s rail. Then press any button on it with Appa open, since browsers only list a controller after a press.
  - **Mapping:** **Map buttons…** asks you to press the button for Show answer, Again, Hard, Good and Easy in turn. Each action can also be set, changed or cleared on its own, including Undo.
  - **What can be mapped:** buttons, stick directions and D-pad hats, matched by the controller’s raw input. Any layout works.
  - **In the reviewer:** a rating button pressed before the answer is shown reveals it first.
- **Question wordings:** each card can have up to 4 other wordings of its front. Each review shows the original or one of them at random, so you recall the answer from what's asked rather than recognize the sentence.
  - **Regular cards:** Browse → **AI wordings** writes them for the selected cards or a deck, with a cost estimate, saving as it goes. You can edit or remove them in each card's editor.
  - **Skipped cards:** cloze and image occlusion cards are left out. If a card's question changes, its old wordings are dropped.
  - **Smart cards:** the AI writes up to 4 wordings per card, and they must use the same placeholders as the front.
  - **Turning it off:** Preferences → Advanced → **Vary question wording**.
- **Card variation** (Preferences → Advanced): each time a card is shown, its text gets one of three similar fonts (Segoe UI/Arial/Verdana, or Georgia/Cambria/Palatino) and a random size within your range, so you learn the content rather than the look of the card. The question and answer of one showing use the same font and size.

## Saving and appearance

- **Automatic saving:** progress, cards and settings save automatically in the browser (IndexedDB). The app asks the browser to keep that storage persistent.
- **Saving to a folder:** Preferences → Saving → **Choose folder…** (Chrome or Edge) keeps everything in a folder on your computer, updated a couple of seconds after each change:
  - `fsrs-cards-backup.json` holds cards, notes, history, presets and preferences.
  - `media/` holds images and audio.
  - `background` is the background image.

  **Load from folder** restores it, for example after clearing browser data or in another browser. After a browser restart, click **Allow access** once to resume saving.
- **Background image:** Preferences → Appearance sets an image behind the app, with an opacity slider. Page text that sits straight on the image (titles, subtitles, file names, the Preferences list) switches between dark and light ink to suit how light the image is behind the content, at the chosen opacity, with a faint halo for busy photos. Text on panels and cards keeps its normal colours.

## What's ported from Anki

- **FSRS** (`src/lib/fsrs.ts`): the FSRS model from `fsrs-rs` 6.6.2, the version pinned on Anki's main branch.
  - It covers FSRS-7 (34 params) and FSRS-6 (17/19/21 params, with the same legacy conversion), parameter clipping, the forgetting curves, the interval solver and memory-state replay.
  - FSRS-6 output matches `ts-fsrs` to about 1e-7.
  - Empty parameters mean FSRS-7 defaults, as on Anki's main branch. The released Anki 25.09 still defaults to FSRS-6.
- **Card states** (`src/lib/scheduler.ts`): Anki's card state machine (`rslib/src/scheduler/states`) with FSRS turned on. That includes learning and relearning steps, the Hard special cases, review and learning fuzz, short-term scheduling and leech detection.
- **Study queue** (`src/lib/queue.ts`): Anki's v3 queue builder and deck limits (`scheduler/queue/builder`, `decks/limits.rs`).
  - Limits form a tree rooted at the deck you study. Each subdeck is capped by its parents, and every answer counts against the deck and all its parents.
  - New cards also count against the review limit, unless "new cards ignore review limit" is on.
  - Overrides apply in this order: "Today only", then "This deck", then the preset.
  - New cards are gathered and sorted by the preset's order, and so are reviews (all 13 review orders).
  - New cards and interday learning cards are mixed with, shown before, or shown after reviews.
  - Siblings are buried while the queue is gathered and after answering.
  - The main queue is built once per session, the way Anki does it.
- **Deck options** (Decks → Options) are option presets with Anki's defaults. You can add, clone, rename and remove presets, and save to all subdecks.
  - **Daily limits:** set for the preset, for this deck, or for today only.
  - **New cards:** learning steps and insertion order.
  - **Lapses:** relearning steps and leech handling.
  - **Display order:** new-card gather and sort order, new/review and interday mixing, and review sort order.
  - **FSRS:** desired retention (per preset or per deck) and parameters, with Optimize and Evaluate.
  - **Other:** burying, audio autoplay, timers and maximum interval.
- **Preferences:** next day starts at, learn-ahead limit, and new cards ignoring the review limit.
- **Deck tree:** `::` subdecks, with collapsible rows and counts that roll up to parents. Rename moves subdecks, and delete removes the whole subtree.
- **Note types and editor:**
  - Anki's stock Basic, Basic (and reversed card), Basic (optional reversed card) and Cloze.
  - Cards are generated per template or per cloze number, and editing a note updates its sibling cards.
  - The editor matches Anki's toolbar and shortcuts:

    | Action | Shortcut |
    |---|---|
    | Bold / italic / underline | `Ctrl+B` / `Ctrl+I` / `Ctrl+U` |
    | Superscript / subscript | `Ctrl+Shift+=` / `Ctrl+=` |
    | Remove formatting | `Ctrl+R` |
    | Text color (apply / choose) | `F7` / `F8` |
    | Indent / outdent | `Ctrl+Shift+.` / `Ctrl+Shift+,` |
    | Cloze (new / same number) | `Ctrl+Shift+C` / `Ctrl+Alt+Shift+C` |
    | HTML editor | `Ctrl+Shift+X` |
    | Attach image or audio | `F3` |

  - The toolbar also has highlight, lists and alignment buttons.
  - You can paste or drop images, and fields can be made sticky.
- **Parameter optimization** (Deck options → FSRS → Optimize) runs in a Web Worker. It trains FSRS-7 on the preset's review history the way Anki calls fsrs-rs.
  - Training items are built like Anki's `reviews_for_fsrs`, with recency weights, in windowed per-card batches.
  - The loss is weighted BCE plus an L2 penalty, optimized with Adam and a cosine-annealed learning rate over 8 epochs, with clipping and initial-stability smoothing.
  - New parameters are kept only if they lower the log loss.
  - Gradients use forward-mode duals, checked against finite differences.
- **Import from Anki** (`src/lib/apkg.ts`, `importAnki.ts`) reads `.apkg` and `.colpkg` files in all three package formats.
  - It brings over cards rendered from your templates, schedules, flags, review history (with Anki's rules for resets and cramming) and media.
  - It also brings the deck option presets and per-deck limits.

## Not yet ported

In rough priority order:

1. Custom note types: the Fields and Cards (template) editors, and Basic (type in the answer). Imported cards from custom note types are kept as rendered HTML.
2. Filtered decks and Custom Study.
3. Browser tools: card and note mode, Card Info, set due date, reposition, change deck or note type, find and replace, and flag colors.
4. MathJax and LaTeX rendering, plus template CSS and JavaScript.
5. FSRS extras: Easy Days, the load balancer, the simulator, "reschedule cards on change", historical retention, and ignoring reviews before a date.
6. Anki's full set of statistics graphs.
7. `.apkg` export and AnkiWeb sync.
8. Audio recording in the editor.

## Keys (reviewer)

Space or Enter shows the answer, and Space then rates it Good. `1`–`4` rate Again/Hard/Good/Easy. `Ctrl+Z` undoes, `E` edits, `-` buries, `@` suspends, and `R` replays audio.

## Search (Browse)

| Search | Matches |
|---|---|
| `deck:Name` | the deck and its subdecks |
| `preset:Name` | cards whose deck uses that preset |
| `tag:x` | cards with that tag |
| `is:new`, `learn`, `review`, `due`, `suspended`, `buried` | cards in that state |
| `prop:s>10`, `prop:d<0.5`, `prop:r<0.9`, `prop:ivl>=30`, `prop:lapses>2` | stability, difficulty, retrievability, interval and lapses |
| plain text | front or back |

Put `-` before a term to negate it.
