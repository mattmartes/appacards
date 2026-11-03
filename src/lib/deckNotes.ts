// Turns a deck's Notes files into material for Learn and Quiz.

import { col } from './collection';
import { readMaterial } from './materials';
import type { DeckFile, Id, LessonSource, QuizSet, QuizSetSource } from './types';

/** Files the readers understand: PowerPoint, PDF, Word and text. */
export const isReadable = (f: DeckFile) => /\.(pptx|pdf|docx|txt|md|markdown|gridnote)$/i.test(f.name);

/** Past quizzes and exams, by name: used as the quiz's style reference. */
export const looksLikeQuiz = (name: string) =>
  // not \b: "Topic_5_PFF" has no word boundary before PFF
  /(^|[^a-z])(quiz|quizzes|exam|midterm|final|practice|pff|test|problem.?set|worksheet|answers)/i.test(name);

/** Reads the files into numbered sources (M1, M2, ...). Returns the files it couldn't read too. */
export async function readDeckFiles(files: DeckFile[]): Promise<{ sources: LessonSource[]; skipped: string[] }> {
  const sources: LessonSource[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    if (!isReadable(f)) {
      skipped.push(f.name);
      continue;
    }
    const blob = await col.getMedia(f.media);
    if (!blob) {
      skipped.push(f.name);
      continue;
    }
    try {
      sources.push(await readMaterial(new File([blob], f.name, { type: f.type }), sources.length));
    } catch {
      skipped.push(f.name);
    }
  }
  return { sources, skipped };
}

/** The deck's own quiz set, made or refreshed from these files. */
export async function quizSetFromDeck(deckId: Id, sources: LessonSource[]): Promise<QuizSet> {
  const deck = col.decks.get(deckId);
  const withRoles: QuizSetSource[] = sources.map((s) => ({ ...s, role: looksLikeQuiz(s.name) ? 'reference' : 'material' }));
  // keep at least one file as material, so there's something to ask about
  if (withRoles.length && withRoles.every((s) => s.role === 'reference')) withRoles.forEach((s) => (s.role = 'material'));
  const existing = [...col.quizSets.values()].find((s) => s.deckId === deckId);
  const set: QuizSet = existing
    ? { ...existing, title: `${deck?.name.split('::').pop() ?? 'Deck'} notes`, sources: withRoles }
    : {
        id: Date.now(),
        title: `${deck?.name.split('::').pop() ?? 'Deck'} notes`,
        created: Date.now(),
        updated: Date.now(),
        sources: withRoles,
        stats: {},
        missed: [],
        deckId,
      };
  return col.saveQuizSet(set);
}
