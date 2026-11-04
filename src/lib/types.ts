// Data model. Card scheduling fields mirror Anki's `cards` table.

export type Id = number;

// Option values use Anki's names (rslib/src/deckconfig, proto/anki/deck_config.proto).
export type NewGatherPriority = 'deck' | 'deckThenRandomNotes' | 'lowestPosition' | 'highestPosition' | 'randomNotes' | 'randomCards';
export type NewSortOrder = 'template' | 'noSort' | 'templateThenRandom' | 'randomNoteThenTemplate' | 'randomCard';
export type ReviewOrder =
  | 'day'
  | 'dayThenDeck'
  | 'deckThenDay'
  | 'intervalsAscending'
  | 'intervalsDescending'
  | 'easeAscending'
  | 'easeDescending'
  | 'retrievabilityAscending'
  | 'retrievabilityDescending'
  | 'relativeOverdueness'
  | 'random'
  | 'added'
  | 'reverseAdded';
export type ReviewMix = 'mixWithReviews' | 'afterReviews' | 'beforeReviews';

/** A deck options preset (Anki's DeckConfig). */
export interface Preset {
  id: Id;
  name: string;
  // Daily limits
  newPerDay: number;
  reviewsPerDay: number;
  // New cards
  /** minutes */
  learnSteps: number[];
  newInsertOrder: 'due' | 'random';
  // Lapses
  /** minutes */
  relearnSteps: number[];
  leechThreshold: number;
  leechAction: 'suspend' | 'tag';
  // Display order
  newGatherPriority: NewGatherPriority;
  newSortOrder: NewSortOrder;
  newMix: ReviewMix;
  interdayLearningMix: ReviewMix;
  reviewOrder: ReviewOrder;
  // FSRS
  /** empty = FSRS-7 defaults */
  params: number[];
  desiredRetention: number;
  // Burying
  buryNew: boolean;
  buryReviews: boolean;
  buryInterdayLearning: boolean;
  // Audio & timer
  autoplay: boolean;
  showTimer: boolean;
  /** answer times are capped at this many seconds */
  capAnswerTimeSecs: number;
  // Advanced
  maxInterval: number;
  mtime: number;
}

export const DEFAULT_PRESET_ID = 1;

/** Anki's defaults (DEFAULT_DECK_CONFIG_INNER). */
export const DEFAULT_PRESET: Preset = {
  id: DEFAULT_PRESET_ID,
  name: 'Default',
  newPerDay: 20,
  reviewsPerDay: 200,
  learnSteps: [1, 10],
  newInsertOrder: 'due',
  relearnSteps: [10],
  leechThreshold: 8,
  leechAction: 'tag',
  newGatherPriority: 'deck',
  newSortOrder: 'template',
  newMix: 'mixWithReviews',
  interdayLearningMix: 'mixWithReviews',
  reviewOrder: 'day',
  params: [],
  desiredRetention: 0.9,
  buryNew: false,
  buryReviews: false,
  buryInterdayLearning: false,
  autoplay: true,
  showTimer: false,
  capAnswerTimeSecs: 60,
  maxInterval: 36500,
  mtime: 0,
};

/** Collection-wide preferences (Anki's Preferences → Review/Scheduling). */
export interface Preferences {
  /** "Learn ahead limit", minutes */
  learnAheadMins: number;
  /** "Next day starts at", hours after midnight */
  rolloverHour: number;
  newCardsIgnoreReviewLimit: boolean;
  /** Anki always fuzzes; kept as an option here */
  fuzz: boolean;
  /** opacity of the background image, 0-1 (the image itself is stored separately) */
  backgroundOpacity: number;
  /** Shows each card in a slightly different font and size, so you learn
   * the content rather than the look of the card. */
  cardVariation: CardVariation;
  /** game controller (e.g. Joy-Con) buttons for the reviewer */
  controller: ControllerPrefs;
  /** show a random one of a card's wordings (its front or an alternate) */
  varyWording: boolean;
}

/** Most alternate wordings a card (or smart card case) keeps. */
export const MAX_WORDINGS = 4;

/** What a controller button does in the reviewer. */
export type ControllerAction = 'show' | 'again' | 'hard' | 'good' | 'easy' | 'undo';

/** One controller input: a button, or a stick/hat axis held at a value. */
export type PadInput = { kind: 'button'; index: number } | { kind: 'axis'; index: number; value: number };

export interface ControllerPrefs {
  enabled: boolean;
  bindings: Partial<Record<ControllerAction, PadInput>>;
}

export type VariationFontSet = 'sans' | 'serif';

export interface CardVariation {
  enabled: boolean;
  fontSet: VariationFontSet;
  /** text size range, as % of the normal card text size */
  minSizePct: number;
  maxSizePct: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  learnAheadMins: 20,
  rolloverHour: 4,
  newCardsIgnoreReviewLimit: false,
  fuzz: true,
  backgroundOpacity: 0.35,
  cardVariation: { enabled: false, fontSet: 'sans', minSizePct: 85, maxSizePct: 125 },
  controller: { enabled: true, bindings: {} },
  varyWording: true,
};

/** What the scheduler needs for one card: its preset (with any deck
 * override applied) plus the relevant preferences. */
export interface Settings {
  params: number[];
  desiredRetention: number;
  learnSteps: number[];
  relearnSteps: number[];
  maxInterval: number;
  leechThreshold: number;
  leechAction: 'suspend' | 'tag';
  fuzz: boolean;
}

export type NoteKind = 'basic' | 'reversed' | 'optionalReversed' | 'cloze' | 'imageOcclusion' | 'smart';

/** A note made in this app; its cards are generated from it. Imported Anki
 * cards have no note and are edited as rendered HTML. */
export interface Note {
  id: Id;
  kind: NoteKind;
  /** field name -> HTML (media referenced by filename, like Anki) */
  fields: Record<string, string>;
  tags: string[];
  mtime: number;
  /** smart notes: the generator and card templates */
  smart?: SmartSpec;
}

/** A placeholder in a smart card, e.g. [a], with the legend's description. */
export interface SmartVar {
  name: string;
  label: string;
  /** inputs are shown on the front; answers are computed from the inputs */
  role: 'input' | 'answer';
}

/** One skill of a smart note, and one card. `params` tell the generator
 * which case this is (e.g. { type: "recessive" }). */
export interface SmartCase {
  name: string;
  params: Record<string, unknown>;
  /** templates with [placeholders] */
  front: string;
  back: string;
  /** other wordings of the front, with the same placeholders; one is picked each time */
  altFronts?: string[];
}

/** A hand-worked example: solve(inputs) must give these answers. */
export interface SmartTest {
  case: number;
  inputs: Record<string, unknown>;
  expected: Record<string, string>;
}

/** A "this answer is wrong" report from the reviewer. */
export interface SmartReport {
  case: number;
  seed: number;
  vars: Record<string, string>;
  comment: string;
  at: number;
}

/** A smart note: cards whose values change every time they're shown.
 * `code` defines sample(r, params, lib), which picks the inputs, and
 * solve(inputs, params, lib), which computes the answers. */
export interface SmartSpec {
  title: string;
  description: string;
  vars: SmartVar[];
  cases: SmartCase[];
  code: string;
  tests: SmartTest[];
  /** smart notes that must be learned before this one's cards are shown (combination cards) */
  requires?: Id[];
  reports?: SmartReport[];
  /** what the student asked the AI for */
  prompt?: string;
}

export interface DayLimit {
  limit: number;
  day: number;
}

export interface Deck {
  id: Id;
  /** Hierarchy uses Anki's "::" separator; parents always exist. */
  name: string;
  description: string;
  /** options preset; missing = Default */
  configId?: Id;
  /** "This deck" limit overrides */
  reviewLimit?: number | null;
  newLimit?: number | null;
  /** "Today only" limit overrides */
  reviewLimitToday?: DayLimit | null;
  newLimitToday?: DayLimit | null;
  /** deck-specific desired retention */
  desiredRetention?: number | null;
  collapsed?: boolean;
  /** a class's emoji, shown beside its name; missing = its first letter */
  icon?: string;
  /** a class's place in the sidebar, as arranged by dragging; missing = by name, after those placed */
  position?: number;
  /** "know it by" plan: when set, it decides the deck's new cards/day
   * (see planNewLimit in dueDate.ts); missing or null = the usual limits */
  dueDate?: DuePlan | null;
  /** Per-day study counters (this deck and its subdecks); reset when `day` != today. */
  today: { day: number; newDone: number; revDone: number };
}

export interface DuePlan {
  /** the day number the deck must be known by */
  day: number;
  /** the day the plan was set, to tell if there was room for a review-only day */
  setOn: number;
  /** fewest new cards a day, even when the spread works out lower */
  minNew: number;
}

/** 0 new, 1 learning, 2 review, 3 relearning */
export type CardType = 0 | 1 | 2 | 3;

/** -3 buried, -1 suspended, 0 new, 1 intraday learn (due = epoch secs),
 * 2 review (due = day), 3 interday learn (due = day) */
export type Queue = -3 | -1 | 0 | 1 | 2 | 3;

export interface Card {
  id: Id;
  deckId: Id;
  /** set for cards generated from a Note in this app */
  noteId?: Id;
  /** template index, or cloze number - 1 */
  ord?: number;
  front: string;
  back: string;
  tags: string[];
  type: CardType;
  queue: Queue;
  /** new: position; queue 1: epoch secs; queue 2/3: day number */
  due: number;
  /** scheduled interval in days (review/relearn) */
  ivl: number;
  reps: number;
  lapses: number;
  /** remaining learning steps */
  left: number;
  stability: number | null;
  difficulty: number | null;
  stabilityFast: number | null;
  /** epoch secs of the last answer */
  lastReview: number | null;
  /** 0-7, like Anki */
  flag: number;
  /** Imported cards whose answer template doesn't start with {{FrontSide}}:
   * the back is the whole answer and is shown instead of the front. */
  answerReplacesFront?: boolean;
  /** Other wordings of the front (AI-generated, up to MAX_WORDINGS). One of
   * them or the front is shown each time, if Preferences allow. */
  altFronts?: string[];
  /** Imported cards: the Anki note they came from, so sibling cards (cloze
   * numbers, reverse cards) can be recognized without a note here. */
  ankiNoteId?: number;
  created: number;
  mtime: number;
}

export interface RevlogEntry {
  /** epoch ms of answer */
  id: Id;
  cardId: Id;
  /** 1-4; 0 for a reset ("Forget") entry */
  rating: 0 | 1 | 2 | 3 | 4;
  /** positive = days, negative = seconds */
  ivl: number;
  lastIvl: number;
  stability: number;
  difficulty: number;
  /** retrievability at the time of review (null for new cards) */
  retrievability: number | null;
  /** whole days since the previous review */
  elapsedDays: number;
  /** ms spent answering */
  time: number;
  /** 0 learn, 1 review, 2 relearn, 3 early review, 4 reset */
  kind: number;
  /** smart cards: the seed of the version that was shown */
  seed?: number;
}

// ---------------------------------------------------------------- Learn

/** A slide, page or section of course material. */
export interface LessonSection {
  /** e.g. "M1.3": material 1, slide 3 */
  ref: string;
  title: string;
  text: string;
}

/** An uploaded file, as text. */
export interface LessonSource {
  /** "M1", "M2", ... */
  id: string;
  name: string;
  kind: 'slides' | 'pdf' | 'document' | 'text';
  sections: LessonSection[];
}

/** One concept of the teaching plan, small enough to teach in a few exchanges. */
export interface PlanItem {
  id: string;
  title: string;
  /** what the student will be able to do or explain */
  summary: string;
  /** the material it draws on */
  refs: string[];
  status: 'todo' | 'active' | 'understood' | 'skipped';
  /** added by the teacher during the lesson (e.g. a prerequisite the student was missing) */
  added?: boolean;
}

export interface LessonMessage {
  id: string;
  role: 'teacher' | 'student';
  /** Markdown */
  text: string;
  /** the teacher's check-for-understanding question */
  question?: string;
  /** the plan item this was about */
  item?: string;
  /** the teacher's verdict on the student's last answer */
  verdict?: 'understood' | 'not-yet';
  at: number;
}

/** A flashcard the student unlocked by showing they understand something. */
export interface LessonCard {
  id: string;
  front: string;
  back: string;
  item: string;
  status: 'pending' | 'approved' | 'rejected';
  /** the note made from it, once approved */
  noteId?: Id;
}

export interface Lesson {
  id: Id;
  title: string;
  created: number;
  updated: number;
  sources: LessonSource[];
  stage: 'setup' | 'plan' | 'learning' | 'done';
  plan: PlanItem[];
  /** the teacher's note on how it ordered the material, and why */
  planNote: string;
  messages: LessonMessage[];
  cards: LessonCard[];
  /** the student's standing instructions for flashcards in this lesson */
  cardStyle: string[];
  /** where approved flashcards go */
  deckId?: Id;
}

// ---------------------------------------------------------------- Quiz

export interface QuizQuestion {
  id: string;
  /** "select all that apply" */
  multi: boolean;
  question: string;
  /** shuffled */
  options: string[];
  /** indexes of the right options (one for single-answer questions) */
  correct: number[];
  explanation: string;
  /** why each option is right or wrong, by index (where given) */
  notes: Record<number, string>;
  /** deck quizzes: the cards it's about; the first is the one it was written for */
  cardIds: Id[];
  /** material quizzes: the sections it's about, e.g. "M1.4"; the first is the focus */
  refs?: string[];
  /** a question you got wrong before, back for another try */
  replay?: boolean;
}

/** A quiz question you got wrong, kept until you get it right twice in a row. */
export interface MissedQuestion {
  q: QuizQuestion;
  misses: number;
  /** right answers in a row since it came back */
  streak: number;
  /** epoch ms of the last time it was missed or asked again */
  last: number;
}

/** An uploaded file for a quiz set: material to write questions from, or a
 * past quiz or exam the AI follows for style and difficulty. */
export interface QuizSetSource extends LessonSource {
  role: 'material' | 'reference';
}

/** A custom quiz built from your own files (Quiz → From your material). */
export interface QuizSet {
  id: Id;
  title: string;
  created: number;
  updated: number;
  sources: QuizSetSource[];
  /** per section ref: how often questions were about it and got it wrong */
  stats: Record<string, { asked: number; wrong: number }>;
  missed: MissedQuestion[];
  /** made from this deck's Notes (Notes → Quiz me on these) */
  deckId?: Id;
}

// ---------------------------------------------------------------- deck notes

/** A file uploaded to a deck's Notes (slides, PDFs, documents, images). The
 * bytes live in the media store, so they're saved to the folder with media. */
export interface DeckFile {
  id: string;
  deckId: Id;
  name: string;
  /** MIME type */
  type: string;
  size: number;
  added: number;
  /** last saved, for notes written in Appa */
  updated?: number;
  /** its name in the media store */
  media: string;
}

/** A note written in Appa's grid editor, kept as a deck file. */
export const GRID_NOTE_TYPE = 'application/x-appa-gridnote';
export const GRID_NOTE_EXT = '.gridnote';
