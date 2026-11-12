import { dayKey, getBankIndex, isEffectiveAttempt } from './core.mjs';

const indexes = new WeakMap();

// Persisted attempts are append-only. Replacing an imported/restored array rebuilds
// the index; rendering and ordinary saves reuse the already processed prefix.
export function getAttemptIndex(state, bank = null) {
  let variants = indexes.get(state);
  if (!variants) { variants = new Map(); indexes.set(state, variants); }
  let index = variants.get(bank);
  const attempts = state.attempts;
  if (!index || index.array !== attempts || attempts.length < index.count || attempts[index.count - 1] !== index.last) {
    index = { array: attempts, count: 0, last: undefined, answered: [], latest: new Map(), latestResults: new Map(),
      days: new Map(), subjects: new Map(), ids: new Set(), correct: 0, duration: 0, version: 0 };
    variants.set(bank, index);
  }
  const questions = bank && getBankIndex(bank).questions;
  for (let i = index.count; i < attempts.length; i++) {
    const a = attempts[i];
    index.ids.add(a.id);
    if (typeof a.correct === 'boolean' && Number.isFinite(a.at) &&
        (!index.latestResults.has(a.questionId) || a.at >= index.latestResults.get(a.questionId).at))
      index.latestResults.set(a.questionId, a);
    if (questions && !questions.has(a.questionId) || !isEffectiveAttempt(a, questions?.get(a.questionId))) continue;
    index.answered.push(a);
    index.correct += Number(a.correct);
    index.duration += Number.isFinite(a.durationMs) ? Math.max(0, a.durationMs) : 0;
    const key = dayKey(a.at), day = index.days.get(key) ?? { total: 0, correct: 0 };
    day.total++; day.correct += Number(a.correct); index.days.set(key, day);
    const subjectId = questions?.get(a.questionId)?.subjectId ?? a.subjectId;
    const subject = index.subjects.get(subjectId) ?? { total: 0, correct: 0 };
    subject.total++; subject.correct += Number(a.correct); index.subjects.set(subjectId, subject);
    if (!index.latest.has(a.questionId) || a.at >= index.latest.get(a.questionId).at) index.latest.set(a.questionId, a);
  }
  if (index.count !== attempts.length) index.version++;
  index.count = attempts.length;
  index.last = attempts.at(-1);
  return index;
}
