import { filterQuestions, getBankIndex, isEffectiveAttempt, shuffle } from "./core.mjs";
import { preparationMastery } from "./preparation.mjs";
import { spacedReview } from "./study.mjs";

export function questionActivity(questions, state) {
  const scope = new Map(questions.map((q) => [q.id, q])), activity = new Map();
  for (const a of state.attempts.filter((a) => scope.has(a.questionId) && typeof a.correct === "boolean")
    .sort((a, b) => a.at - b.at)) {
    const q = scope.get(a.questionId);
    if (!isEffectiveAttempt(a, q)) continue;
    const item = activity.get(q.id) ?? { streak: 0, lastAt: 0, count: 0 };
    item.streak = a.correct && !a.uncertain ? item.streak + 1 : 0;
    item.lastAt = a.at;
    item.latestCorrect = a.correct;
    item.count++;
    activity.set(q.id, item);
  }
  return activity;
}

export function practicePool(bank, filters, state) {
  const questions = filterQuestions(bank, filters, state);
  if (!filters.status) return questions;
  const activity = questionActivity(questions, state);
  const mastery = filters.status === "unmastered" ? preparationMastery(bank, state) : null;
  const preparationIds = new Set(mastery?.pool.map((q) => q.id) ?? []);
  return questions.filter((q) => filters.status === "unseen" ? !activity.has(q.id)
    : preparationIds.has(q.id) ? !mastery.questions.get(q.id)?.mastered : (activity.get(q.id)?.streak ?? 0) < 2);
}

export function rootChapter(bank, q) {
  const chapters = getBankIndex(bank).chapters.get(q.subjectId), visited = new Set();
  let id = q.chapterId;
  while (chapters?.get(id)?.parentId && !visited.has(id)) {
    visited.add(id);
    id = chapters.get(id).parentId;
  }
  return JSON.stringify([q.subjectId, id]);
}

export function balancedSample(bank, questions, count, random = Math.random) {
  const groups = new Map();
  for (const q of questions) {
    const key = rootChapter(bank, q);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }
  const queues = shuffle([...groups.values()], random).map((items) => shuffle(items, random));
  const result = [];
  while (result.length < count && queues.some((items) => items.length))
    for (const items of queues) if (items.length && result.length < count) result.push(items.pop());
  return result;
}

export function collectionQueue(bank, filters, state, mode, sort = "priority", now = Date.now()) {
  const questions = filterQuestions(bank, { ...filters, mistakes: mode === "review", favorites: mode === "favorites" }, state);
  if (sort === "bank") return questions;
  const activity = questionActivity(questions, state);
  const { schedule } = spacedReview(bank, state, now);
  return [...questions].sort((a, b) => {
    const wrong = (id) => state.mistakes[id]?.wrongCount ?? 0;
    const due = (id) => schedule.get(id)?.dueAt ?? 0;
    if (sort === "wrong") return wrong(b.id) - wrong(a.id) || due(a.id) - due(b.id);
    if (sort === "due") return due(a.id) - due(b.id);
    return Number(due(b.id) <= now) - Number(due(a.id) <= now) ||
      (activity.get(a.id)?.lastAt ?? 0) - (activity.get(b.id)?.lastAt ?? 0) || wrong(b.id) - wrong(a.id);
  });
}

export function collectionPageSlice(questions, requestedPage, size = 30) {
  const pages = Math.max(1, Math.ceil(questions.length / size));
  const page = Math.max(1, Math.min(pages, Number.isInteger(Number(requestedPage)) ? Number(requestedPage) : 1));
  return { page, pages, offset: (page - 1) * size, items: questions.slice((page - 1) * size, page * size) };
}

export function reviewBatchSize(state, minutes = 0) {
  if (![5, 10, 20].includes(Number(minutes))) return 20;
  const times = state.attempts.filter((a) => isEffectiveAttempt(a) && Number.isFinite(a.durationMs) && a.durationMs > 0).slice(-100).map((a) => a.durationMs).sort((a, b) => a - b);
  const typical = Math.max(30000, Math.min(300000, times[Math.floor(times.length / 2)] ?? 60000));
  return Math.max(1, Math.min(20, Math.floor(Number(minutes) * 60000 / typical)));
}
