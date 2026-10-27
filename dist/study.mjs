import { getBankIndex, hasResponse } from "./core.mjs";

export function learningProgress(questions, state) {
  const scope = new Map(questions.map((q) => [q.id, q]));
  const latest = new Map();
  for (const attempt of state.attempts) {
    const q = scope.get(attempt.questionId);
    if (!q || typeof attempt.correct !== "boolean" || !Number.isFinite(attempt.at) ||
      (q.type !== "solution" && !hasResponse(q, attempt.answer))) continue;
    const previous = latest.get(q.id);
    if (!previous || attempt.at >= previous.at) latest.set(q.id, attempt);
  }
  const total = scope.size, completed = latest.size;
  const correct = [...latest.values()].filter((a) => a.correct).length;
  const percent = (part, whole) => Number((part / whole * 100).toFixed(2));
  return { total, completed, correct, completion: total ? percent(completed, total) : 0,
    accuracy: completed ? percent(correct, completed) : null };
}

export const DAY_MS = 86400000;
const intervals = [1, 3, 7, 14, 30, 60];

// Rebuild from portable attempt records so normal practice, exams, backups and
// sync all share the same schedule without a second mutable source of truth.
export function spacedReview(bank, state, now = Date.now()) {
  const questions = getBankIndex(bank).questions, schedule = new Map();
  const attempts = state.attempts.filter((a) => questions.has(a.questionId) && typeof a.correct === "boolean" && Number.isFinite(a.at))
    .sort((a, b) => a.at - b.at);
  for (const a of attempts) {
    const previous = schedule.get(a.questionId);
    // Repeating a correct answer before it is due does not skip memory stages.
    const early = a.correct && !a.uncertain && previous && a.at < previous.dueAt;
    const streak = a.correct && !a.uncertain ? early ? previous.streak : (previous?.streak ?? 0) + 1 : 0;
    const intervalDays = intervals[Math.min(intervals.length - 1, Math.max(0, streak - 1))];
    schedule.set(a.questionId, { questionId: a.questionId, streak, intervalDays, lastAt: a.at,
      dueAt: early ? previous.dueAt : a.at + intervalDays * DAY_MS });
  }
  const due = [...schedule.values()].filter((item) => item.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
  const upcoming = [...schedule.values()].filter((item) => item.dueAt > now).sort((a, b) => a.dueAt - b.dueAt);
  return { schedule, due, upcoming };
}

export function reviewWeight(item, now = Date.now()) {
  return !item || item.dueAt > now ? 1 : 1.8 + Math.min(2, (now - item.dueAt) / (item.intervalDays * DAY_MS));
}

export function archivePreparation(state) {
  const prep = state.preparation;
  if (!prep) return;
  state.preparationHistory ??= [];
  if (state.preparationHistory.some((p) => p.id === prep.id)) return;
  state.preparationHistory.push({ id: prep.id, subjectId: prep.subjectId,
    chapterIds: [...prep.chapterIds], diagnosticIds: [...prep.diagnosticIds], startedAt: prep.startedAt });
}

export function preparationPlans(state) {
  const plans = new Map((state.preparationHistory ?? []).map((p) => [p.id, p]));
  if (state.preparation) plans.set(state.preparation.id, state.preparation);
  return [...plans.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function preparationTrends(bank, state, preparationId) {
  const plan = preparationPlans(state).find((p) => p.id === preparationId);
  if (!plan) return [];
  const index = getBankIndex(bank);
  const allowed = new Set(plan.chapterIds.flatMap((id) =>
    (index.chapterQuestions.get(plan.subjectId)?.get(id) ?? []).map((q) => q.id)));
  const groups = new Map();
  for (const a of state.attempts) {
    if (a.preparationId !== plan.id || !allowed.has(a.questionId) ||
      !["prepare-diagnostic", "prepare-training"].includes(a.mode) || typeof a.correct !== "boolean") continue;
    const practiceId = a.practiceId ?? (typeof a.id === "string" && a.id.startsWith("practice:") ? a.id.slice(9).split(":")[0] : a.mode);
    const key = `${a.mode}:${practiceId}`;
    const group = groups.get(key) ?? { id: key, mode: a.mode, round: a.round, at: a.at,
      total: a.sessionSize ?? (a.mode === "prepare-diagnostic" ? plan.diagnosticIds.length : Math.min(20, allowed.size)), responses: new Map() };
    group.responses.set(a.questionId, a.correct);
    group.at = Math.max(group.at, a.at);
    groups.set(key, group);
  }
  let round = 0;
  return [...groups.values()].sort((a, b) => a.at - b.at).map((group) => {
    const completed = group.responses.size, correct = [...group.responses.values()].filter(Boolean).length;
    return { id: group.id, mode: group.mode, at: group.at, total: group.total, completed, correct,
      round: group.mode === "prepare-training" ? (round = group.round ?? round + 1) : 0,
      accuracy: Math.round(correct / completed * 100), ready: completed === group.total };
  });
}
