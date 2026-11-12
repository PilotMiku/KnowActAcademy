import { getAttemptIndex } from './attempt-index.mjs';
import { getBankIndex, isScorable, dayKey } from './core.mjs';

const cache = new WeakMap();
export function learningSummary(bank, state) {
  const attempts = getAttemptIndex(state, bank), cached = cache.get(attempts);
  if (cached?.version === attempts.version) return cached.result;
  const index = getBankIndex(bank), histories = new Map();
  for (const a of attempts.answered) {
    const rows = histories.get(a.questionId) || [];
    rows.push(a); histories.set(a.questionId, rows);
  }
  const stable = new Set();
  for (const [id, rows] of histories) {
    rows.sort((a,b) => a.at-b.at);
    const last = rows.at(-1), previous = rows.at(-2);
    if (last?.correct && !last.uncertain && previous?.correct && !previous.uncertain && dayKey(last.at) !== dayKey(previous.at)) stable.add(id);
  }
  const summarize = questions => {
    const pool = questions.filter(isScorable), done = pool.filter(q => attempts.latest.has(q.id));
    const correct = done.filter(q => attempts.latest.get(q.id).correct).length;
    return { total: pool.length, covered: done.length, correct, stable: pool.filter(q => stable.has(q.id)).length,
      coverage: pool.length ? Math.round(done.length / pool.length * 1000) / 10 : 0,
      accuracy: done.length ? Math.round(correct / done.length * 1000) / 10 : null };
  };
  const subjects = bank.subjects.map(s => ({ id:s.id, name:s.name, ...summarize(index.subjectQuestions.get(s.id) || []) }));
  const sections = bank.subjects.flatMap(s => s.chapters.filter(c => c.parentId).map(c => ({ subjectId:s.id, chapterId:c.id,
    name:c.name, ...summarize(index.chapterQuestions.get(s.id).get(c.id) || []) })));
  const result = { subjects, weak: sections.filter(s => s.covered).sort((a,b) => a.accuracy-b.accuracy || b.covered-a.covered).slice(0,5) };
  cache.set(attempts, { version: attempts.version, result });
  return result;
}
