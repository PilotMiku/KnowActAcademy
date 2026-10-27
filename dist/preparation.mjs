import { createPractice, getBankIndex, hasResponse, shuffle, uid } from "./core.mjs";
import { getConceptIndex } from "./concepts.mjs";
import { spacedReview, reviewWeight } from "./study.mjs";
import { readinessForecast } from "./forecast.mjs";

export const PREPARATION_COUNT = 20;
const skillKey = (q) => JSON.stringify([q.subjectId, q.chapterId, q.type]);
const chapterKey = (q) => JSON.stringify([q.subjectId, q.chapterId]);

// Keep scope tied to a subject: imported banks may reuse chapter IDs.
export function preparationQuestions(bank, { subjectId, chapterIds = [] }) {
  const index = getBankIndex(bank);
  const ids = new Set(chapterIds.flatMap((id) =>
    (index.chapterQuestions.get(subjectId)?.get(id) ?? []).map((q) => q.id)));
  return (index.subjectQuestions.get(subjectId) ?? []).filter((q) => ids.has(q.id));
}

export function createPreparation(bank, scope, random = Math.random) {
  const questions = preparationQuestions(bank, scope);
  if (!questions.length) throw new Error("请先选择有题目的科目和章节");
  const practice = createPractice(shuffle(questions, random).slice(0, PREPARATION_COUNT).map((q) => q.id), "prepare-diagnostic");
  const preparation = {
    id: uid(), subjectId: scope.subjectId, chapterIds: [...new Set(scope.chapterIds)],
    diagnosticIds: [...practice.questionIds], diagnosticPracticeId: practice.id,
    startedAt: practice.startedAt, round: 0,
    roundPolicy: scope.roundPolicy === "fixed" ? "fixed" : "adaptive",
  };
  practice.preparationId = preparation.id;
  return { preparation, practice };
}

export function diagnosticProgress(state) {
  const prep = state.preparation;
  if (!prep) return { completed: 0, total: 0, ready: false };
  const answered = new Set(state.attempts.filter((a) =>
    a.preparationId === prep.id && a.mode === "prepare-diagnostic" && typeof a.correct === "boolean")
    .map((a) => a.questionId));
  const completed = prep.diagnosticIds.filter((id) => answered.has(id)).length;
  return { completed, total: prep.diagnosticIds.length, ready: completed === prep.diagnosticIds.length };
}

export function currentPreparationPractice(state) {
  const prep = state.preparation;
  if (!prep) return null;
  return state.practice?.preparationId === prep.id ? state.practice : prep.session ?? null;
}

export function restoreDiagnostic(state) {
  const prep = state.preparation;
  if (!prep) throw new Error("请先开始备考测评");
  const practice = createPractice(prep.diagnosticIds, "prepare-diagnostic");
  Object.assign(practice, { id: prep.diagnosticPracticeId, preparationId: prep.id, startedAt: prep.startedAt });
  for (const a of state.attempts) {
    if (a.preparationId === prep.id && a.mode === "prepare-diagnostic" && prep.diagnosticIds.includes(a.questionId))
      practice.responses[a.questionId] = { answer: a.answer, correct: a.correct, uncertain: !!a.uncertain, graded: typeof a.correct === "boolean" };
  }
  practice.index = Math.max(0, prep.diagnosticIds.findIndex((id) => !practice.responses[id]?.graded));
  return practice;
}

function update(map, key, correct) {
  const entry = map.get(key) ?? { need: 1, answered: 0, correct: 0 };
  // Recent answers outweigh older ones. Every correct answer reduces priority;
  // repeated mistakes raise it, with a positive floor for topic coverage.
  entry.need = entry.need * 0.6 + (correct ? 0.25 : 4) * 0.4;
  entry.answered++;
  entry.correct += Number(correct);
  map.set(key, entry);
}

export function preparationMastery(bank, state) {
  const pool = state.preparation ? preparationQuestions(bank, state.preparation) : [];
  const scope = new Map(pool.map((q) => [q.id, q]));
  const questions = new Map(), trials = new Set();
  const attempts = state.attempts.filter((a) => a.preparationId === state.preparation?.id &&
    ["prepare-diagnostic", "prepare-training"].includes(a.mode) &&
    typeof a.correct === "boolean" && Number.isFinite(a.at) && scope.has(a.questionId))
    .sort((a, b) => a.at - b.at);
  for (const a of attempts) {
    const q = scope.get(a.questionId);
    if (q.type !== "solution" && !hasResponse(q, a.answer)) continue;
    // A replayed submission or revisiting the same graded session is one trial.
    const sessionId = a.practiceId ?? (typeof a.id === "string" && a.id.startsWith("practice:")
      ? a.id.slice(9).split(":")[0] : a.id ?? `${a.mode}:${a.at}`);
    const key = JSON.stringify([q.id, sessionId]);
    if (trials.has(key)) continue;
    trials.add(key);
    const result = questions.get(q.id) ?? { questionId: q.id, correctStreak: 0, wrongCount: 0, mastered: false, trialCount: 0 };
    const confident = a.correct && !a.uncertain;
    if (!confident) result.streakStartedAt = null;
    else if (!result.correctStreak) result.streakStartedAt = a.at;
    result.correctStreak = confident ? Math.min(2, result.correctStreak + 1) : 0;
    result.trialCount++;
    result.wrongCount += Number(!a.correct);
    result.latestCorrect = a.correct;
    result.uncertain = !!a.uncertain;
    result.lastAt = a.at;
    result.mastered = result.correctStreak === 2;
    result.stableMastered = result.mastered && a.at - result.streakStartedAt >= 86400000;
    questions.set(q.id, result);
  }
  const mastered = [...questions.values()].filter((q) => q.mastered).length;
  const pendingMistakes = [...questions.values()].filter((q) => q.wrongCount > 0 && !q.mastered).length;
  const stableMastered = [...questions.values()].filter((q) => q.stableMastered).length;
  return { pool, questions, total: pool.length, covered: questions.size, mastered, stableMastered, pendingMistakes,
    progress: pool.length ? Math.round(mastered / pool.length * 10000) / 100 : 0,
    coverage: pool.length ? Math.round(questions.size / pool.length * 10000) / 100 : 0 };
}

export function syncPreparationMistakes(bank, state) {
  const mastery = preparationMastery(bank, state);
  for (const [id, q] of mastery.questions)
    if (q.wrongCount && state.mistakes[id] && state.mistakes[id].lastAt <= q.lastAt)
      state.mistakes[id].resolved = q.mastered;
  return mastery;
}

export function preparationMetrics(bank, state) {
  const mastery = preparationMastery(bank, state);
  const groups = new Map();
  // Each distinct question contributes once, so repeatedly drawing a weak topic
  // cannot make that topic dominate the estimate for the entire selected bank.
  for (const q of mastery.pool) {
    const key = skillKey(q), group = groups.get(key) ?? { total: 0, seen: 0, points: 0 };
    const result = mastery.questions.get(q.id);
    group.total++;
    if (result) {
      group.seen++;
      // One correction of a previous mistake is tentative until confirmed.
      group.points += result.latestCorrect ? result.uncertain || result.wrongCount && !result.mastered ? 0.5 : 1 : 0;
    }
    groups.set(key, group);
  }
  let expected = 0;
  for (const g of groups.values()) {
    // Unseen questions borrow a smoothed estimate from their section and type;
    // untouched groups start at 50%, rather than inheriting another topic's score.
    const unseenEstimate = (g.points + 1) / (g.seen + 2);
    expected += g.points + (g.total - g.seen) * unseenEstimate;
  }
  const active = currentPreparationPractice(state);
  const trainingScore = mastery.covered ? Math.round(expected / mastery.total * 1000) / 10 : null;
  return { ...mastery, ...readinessForecast(mastery.pool, mastery.questions, state, state.preparation, trainingScore),
    round: active ? practiceProgress(active) : { completed: 0, total: 0, correct: 0, ready: false } };
}

export function preparationProfile(bank, state, now = Date.now()) {
  const prep = state.preparation;
  const questions = prep ? preparationQuestions(bank, prep) : [];
  const allowed = new Set(questions.map((q) => q.id));
  const index = getBankIndex(bank);
  const chapters = new Map(), skills = new Map(), individuals = new Map(), conceptNeeds = new Map();
  const conceptIndex = getConceptIndex(bank);
  // recordAttempt appends in answer order; null (reference answer only) is ignored.
  for (const a of state.attempts) {
    if (a.preparationId !== prep?.id || !allowed.has(a.questionId) || typeof a.correct !== "boolean") continue;
    const q = index.questions.get(a.questionId);
    update(chapters, chapterKey(q), a.correct);
    update(skills, skillKey(q), a.correct);
    update(individuals, q.id, a.correct);
    for (const name of conceptIndex.questions.get(q.id) ?? []) update(conceptNeeds, name, a.correct);
  }
  const recent = new Set(currentPreparationPractice(state)?.questionIds ?? []);
  const mastery = preparationMastery(bank, state);
  const { schedule, due } = spacedReview(bank, state, now);
  const weights = new Map(questions.map((q) => {
    const base = 0.5 * (chapters.get(chapterKey(q))?.need ?? 1) +
      0.3 * (skills.get(skillKey(q))?.need ?? 1) +
      0.2 * (individuals.get(q.id)?.need ?? 1);
    const names = conceptIndex.questions.get(q.id) ?? [];
    const associated = names.length ? names.reduce((sum, name) => sum + (conceptNeeds.get(name)?.need ?? 1), 0) / names.length : base;
    const result = mastery.questions.get(q.id);
    const pending = result?.wrongCount > 0 && !result.mastered;
    const reinforcement = pending ? result.correctStreak === 0 ? 6 : 4 : result?.uncertain ? 2 : result?.mastered ? 0.5 : 1;
    return [q.id, (0.75 * base + 0.25 * associated) * reviewWeight(schedule.get(q.id), now) *
      reinforcement * (recent.has(q.id) && !pending ? 0.7 : 1)];
  }));
  const topics = [...skills].map(([key, value]) => {
    const [subjectId, chapterId, type] = JSON.parse(key);
    return { ...value, subjectId, chapterId, type,
      priority: 0.5 * chapters.get(JSON.stringify([subjectId, chapterId])).need + 0.3 * value.need + 0.2 };
  }).sort((a, b) => b.priority - a.priority);
  const concepts = [...conceptNeeds].map(([name, value]) => ({ ...value, ...conceptIndex.concepts.get(name),
    inScope: conceptIndex.concepts.get(name).questionIds.filter((id) => allowed.has(id)).length,
  })).sort((a, b) => b.need - a.need);
  return { questions, weights, topics, concepts, due: due.filter((item) => allowed.has(item.questionId)) };
}

// Exponential races implement weighted sampling without replacement. No question
// has zero probability, and a round never contains duplicate question IDs.
export function weightedSample(questions, weights, count = PREPARATION_COUNT, random = Math.random) {
  return questions.map((q) => ({ q,
    score: -Math.log(Math.max(Number.MIN_VALUE, 1 - random())) / Math.max(0.01, weights.get(q.id) ?? 1),
  })).sort((a, b) => a.score - b.score).slice(0, count).map(({ q }) => q);
}

export function trainingCount(bank, preparation) {
  const total = preparationQuestions(bank, preparation).length;
  return preparation?.roundPolicy !== "fixed" && total > 1 && total <= PREPARATION_COUNT
    ? Math.min(total - 1, Math.ceil(total * 0.6)) : Math.min(PREPARATION_COUNT, total);
}

export function createTraining(bank, state, random = Math.random) {
  if (!diagnosticProgress(state).ready) throw new Error("请先完成本次测评的所有题目；解答题需完成自评");
  const { questions, weights } = preparationProfile(bank, state);
  const mastery = preparationMastery(bank, state);
  const count = trainingCount(bank, state.preparation);
  const unseen = questions.filter((q) => !mastery.questions.has(q.id));
  const pending = questions.filter((q) => { const item = mastery.questions.get(q.id); return item?.wrongCount && !item.mastered; });
  const selected = weightedSample(unseen, weights, Math.min(unseen.length, Math.max(1, Math.floor(count / 4))), random);
  const selectedIds = new Set(selected.map((q) => q.id));
  for (const q of weightedSample(pending, weights, Math.min(Math.ceil(count / 2), count - selected.length), random)) {
    selected.push(q); selectedIds.add(q.id);
  }
  selected.push(...weightedSample(questions.filter((q) => !selectedIds.has(q.id)), weights, count - selected.length, random));
  const practice = createPractice(shuffle(selected, random).map((q) => q.id), "prepare-training");
  if (!practice.questionIds.length) throw new Error("备考范围内已没有可用题目，请重新选择章节");
  practice.preparationId = state.preparation.id;
  practice.round = state.preparation.round + 1;
  return practice;
}

export function practiceProgress(practice) {
  const results = practice.questionIds.map((id) => practice.responses[id])
    .filter((r) => r?.graded && typeof r.correct === "boolean");
  return { completed: results.length, correct: results.filter((r) => r.correct).length,
    total: practice.questionIds.length, ready: results.length === practice.questionIds.length };
}
