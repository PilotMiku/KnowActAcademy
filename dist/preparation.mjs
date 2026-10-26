import { createPractice, getBankIndex, shuffle, uid } from "./core.mjs";
import { getConceptIndex } from "./concepts.mjs";
import { spacedReview, reviewWeight } from "./study.mjs";

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
      practice.responses[a.questionId] = { answer: a.answer, correct: a.correct, graded: typeof a.correct === "boolean" };
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
  const { schedule, due } = spacedReview(bank, state, now);
  const weights = new Map(questions.map((q) => {
    const base = 0.5 * (chapters.get(chapterKey(q))?.need ?? 1) +
      0.3 * (skills.get(skillKey(q))?.need ?? 1) +
      0.2 * (individuals.get(q.id)?.need ?? 1);
    const names = conceptIndex.questions.get(q.id) ?? [];
    const associated = names.length ? names.reduce((sum, name) => sum + (conceptNeeds.get(name)?.need ?? 1), 0) / names.length : base;
    return [q.id, (0.75 * base + 0.25 * associated) * reviewWeight(schedule.get(q.id), now) * (recent.has(q.id) ? 0.7 : 1)];
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

export function createTraining(bank, state, random = Math.random) {
  if (!diagnosticProgress(state).ready) throw new Error("请先完成本次测评的所有题目；解答题需完成自评");
  const { questions, weights } = preparationProfile(bank, state);
  const practice = createPractice(weightedSample(questions, weights, PREPARATION_COUNT, random).map((q) => q.id), "prepare-training");
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
