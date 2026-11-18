import { createPractice, getBankIndex, hasResponse, isScorable, shuffle, uid } from "./core.mjs";
import { getConceptIndex } from "./concepts.mjs";
import { spacedReview, reviewWeight } from "./study.mjs";
import { readinessForecast } from "./forecast.mjs";
import { questionGuidance } from "./question-guidance.mjs";

export const PREPARATION_COUNT = 20;
export const PREPARATION_CHECK_LIMIT = 3;
const DAY_MS = 86400000;
const skillKey = (q) => JSON.stringify([q.subjectId, q.chapterId, q.type]);
const chapterKey = (q) => JSON.stringify([q.subjectId, q.chapterId]);

// Keep scope tied to a subject: imported banks may reuse chapter IDs.
export function preparationQuestions(bank, { subjectId, chapterIds = [] }) {
  const index = getBankIndex(bank);
  const ids = new Set(chapterIds.flatMap((id) =>
    (index.chapterQuestions.get(subjectId)?.get(id) ?? []).map((q) => q.id)));
  return (index.subjectQuestions.get(subjectId) ?? []).filter((q) => ids.has(q.id) && isScorable(q));
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

export function diagnosticProgress(state, bank = null) {
  const prep = state.preparation;
  if (!prep) return { completed: 0, total: 0, ready: false };
  const answered = new Set(state.attempts.filter((a) =>
    a.preparationId === prep.id && a.mode === "prepare-diagnostic" && typeof a.correct === "boolean")
    .map((a) => a.questionId));
  const ids = prep.diagnosticIds.filter((id) => !bank || isScorable(getBankIndex(bank).questions.get(id)));
  const completed = ids.filter((id) => answered.has(id)).length;
  return { completed, total: ids.length, ready: completed === ids.length };
}

export function currentPreparationPractice(state) {
  const prep = state.preparation;
  if (!prep) return null;
  return state.practice?.preparationId === prep.id ? state.practice : prep.session ?? null;
}

export function restoreDiagnostic(state, bank = null) {
  const prep = state.preparation;
  if (!prep) throw new Error("请先开始备考测评");
  const practice = createPractice(prep.diagnosticIds.filter((id) => !bank || isScorable(getBankIndex(bank).questions.get(id))), "prepare-diagnostic");
  Object.assign(practice, { id: prep.diagnosticPracticeId, preparationId: prep.id, startedAt: prep.startedAt });
  for (const a of state.attempts) {
    if (a.preparationId === prep.id && a.mode === "prepare-diagnostic" && prep.diagnosticIds.includes(a.questionId))
      practice.responses[a.questionId] = { answer: a.answer, correct: a.correct, uncertain: !!a.uncertain,
        graded: typeof a.correct === "boolean", ...(a.selfAssessment ? { selfAssessment: true } : {}) };
  }
  practice.index = Math.max(0, practice.questionIds.findIndex((id) => !practice.responses[id]?.graded));
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
  const rounds = new Map();
  let legacyRound = 0;
  for (const a of attempts) {
    const q = scope.get(a.questionId);
    if (q.type !== "solution" && !hasResponse(q, a.answer)) continue;
    // A replayed submission or revisiting the same graded session is one trial.
    const sessionId = a.practiceId ?? (typeof a.id === "string" && a.id.startsWith("practice:")
      ? a.id.slice(9).split(":")[0] : a.id ?? `${a.mode}:${a.at}`);
    if (!rounds.has(sessionId)) rounds.set(sessionId, a.mode === "prepare-diagnostic" ? 0
      : Number.isInteger(a.round) ? a.round : ++legacyRound);
    const round = rounds.get(sessionId);
    legacyRound = Math.max(legacyRound, round);
    const key = JSON.stringify([q.id, sessionId]);
    if (trials.has(key)) continue;
    trials.add(key);
    const result = questions.get(q.id) ?? { questionId: q.id, correctStreak: 0, wrongCount: 0, mastered: false, trialCount: 0 };
    const confident = a.correct && !a.uncertain;
    const spaced = result.lastSuccessAt !== undefined &&
      (round - result.lastSuccessRound >= 2 || a.at - result.lastSuccessAt >= DAY_MS);
    const reviewed = a.correct && (result.reviewed || spaced);
    const stable = confident && (result.stableMastered || a.at - result.lastSuccessAt >= DAY_MS);
    if (!confident) result.streakStartedAt = null;
    else if (!result.correctStreak) result.streakStartedAt = a.at;
    result.correctStreak = confident ? Math.min(2, result.correctStreak + 1) : 0;
    result.trialCount++;
    result.wrongCount += Number(!a.correct);
    result.latestCorrect = a.correct;
    result.uncertain = !!a.uncertain;
    result.lastAt = a.at;
    result.lastRound = round;
    result.mastered = a.correct;
    result.reviewed = !!reviewed;
    result.stableMastered = !!stable;
    if (a.correct) {
      result.lastSuccessAt = a.at;
      result.lastSuccessRound = round;
    } else {
      delete result.lastSuccessAt;
      delete result.lastSuccessRound;
    }
    questions.set(q.id, result);
  }
  const mastered = [...questions.values()].filter((q) => q.mastered).length;
  const pendingMistakes = [...questions.values()].filter((q) => q.wrongCount > 0 && !q.mastered).length;
  const stableMastered = [...questions.values()].filter((q) => q.stableMastered).length;
  return { pool, questions, total: pool.length, covered: questions.size, mastered, passed: mastered, stableMastered, pendingMistakes,
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

// Revise the existing trial so scores, review schedules and restored sessions
// all treat this self-assessment exactly like a wrong answer, without an extra trial.
function preparationTrial(bank, state, questionId) {
  const practice = state.practice;
  const q = getBankIndex(bank).questions.get(questionId);
  if (!q || !isScorable(q) || !state.preparation || practice?.preparationId !== state.preparation.id ||
      !["prepare-diagnostic", "prepare-training"].includes(practice.mode) ||
      !practice.questionIds.includes(questionId)) return null;
  return state.attempts.find(a => a.questionId === questionId && a.preparationId === practice.preparationId &&
    (a.id === `practice:${practice.id}:${questionId}` || a.practiceId === practice.id));
}

function replacePreparationTrial(state, attempt, updated, response) {
  const practice = state.practice, questionId = attempt.questionId;
  // Replacing the array invalidates the indexes and cached progress.
  state.attempts = state.attempts.map(a => a === attempt ? updated : a);
  practice.responses[questionId] = response;
  if (state.preparation.session?.id === practice.id)
    state.preparation.session.responses[questionId] = { ...response };
}

export function markPreparationIncorrect(bank, state, questionId, now = Date.now()) {
  const attempt = preparationTrial(bank, state, questionId);
  const response = state.practice?.responses[questionId];
  if (attempt?.correct !== true || response?.correct !== true) return false;
  const mistake = state.mistakes[questionId];
  const selfAssessment = { at: now, manual: !!attempt.manual, previousMistake: mistake ? { ...mistake } : null };
  replacePreparationTrial(state, attempt, { ...attempt, correct: false, manual: true, selfAssessment },
    { ...response, correct: false, selfAssessment: true });
  state.mistakes[questionId] = { firstAt: mistake?.firstAt ?? now, lastAt: now,
    wrongCount: (mistake?.wrongCount ?? 0) + 1, resolved: false };
  return true;
}

export function undoPreparationIncorrect(bank, state, questionId) {
  const attempt = preparationTrial(bank, state, questionId);
  const response = state.practice?.responses[questionId];
  if (attempt?.correct !== false || !response?.selfAssessment || !attempt.selfAssessment) return false;
  const { selfAssessment, ...originalAttempt } = attempt;
  const { selfAssessment: ignored, ...originalResponse } = response;
  const { at, manual, previousMistake } = selfAssessment;
  const current = state.mistakes[questionId];
  if (!current || current.resolved !== false || current.lastAt !== at ||
      current.wrongCount !== (previousMistake?.wrongCount ?? 0) + 1) return false;
  replacePreparationTrial(state, attempt, { ...originalAttempt, correct: true, manual: !!manual },
    { ...originalResponse, correct: true });
  if (previousMistake) state.mistakes[questionId] = { ...previousMistake };
  else delete state.mistakes[questionId];
  syncPreparationMistakes(bank, state);
  return true;
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
      group.points += result.latestCorrect ? result.uncertain ? 0.5 : 1 : 0;
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
    round: active ? practiceProgress(active, bank) : { completed: 0, total: 0, correct: 0, ready: false } };
}

export function preparationProfile(bank, state, now = Date.now()) {
  const prep = state.preparation;
  const questions = prep ? preparationQuestions(bank, prep) : [];
  const allowed = new Set(questions.map((q) => q.id));
  const index = getBankIndex(bank);
  const chapters = new Map(), skills = new Map(), individuals = new Map(), conceptNeeds = new Map();
  const conceptIndex = getConceptIndex(bank, state.questionAnnotations);
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
    const pending = result?.wrongCount > 0 && !result.latestCorrect;
    const reinforcement = pending ? 6 : result?.uncertain ? 2 : result?.mastered ? 0.5 : 1;
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

function roundSize(bank, preparation) {
  const total = preparationQuestions(bank, preparation).length;
  return preparation?.roundPolicy !== "fixed" && total > 1 && total <= PREPARATION_COUNT
    ? Math.min(total - 1, Math.ceil(total * 0.6)) : Math.min(PREPARATION_COUNT, total);
}

// Successful questions leave the ordinary queue. A small delayed sample checks
// retention; elapsed time also permits the next day when a small scope runs out.
export function preparationTrainingPool(bank, state, now = Date.now()) {
  const mastery = preparationMastery(bank, state);
  if (!state.preparation) return { mastery, fresh: [], checks: [], checkLimit: 0, round: 0, count: 0 };
  const lastRound = [...mastery.questions.values()].reduce((last, item) => Math.max(last, item.lastRound), state.preparation.round);
  const round = lastRound + 1;
  const size = roundSize(bank, state.preparation);
  const { schedule } = spacedReview(bank, state, now);
  const fresh = [], checks = [];
  for (const q of mastery.pool) {
    const item = mastery.questions.get(q.id);
    if (!item?.latestCorrect) { fresh.push(q); continue; }
    const spaced = round - item.lastRound >= 2 || now - item.lastAt >= DAY_MS;
    if (spaced && (!item.reviewed || (schedule.get(q.id)?.dueAt ?? Infinity) <= now)) checks.push(q);
  }
  const checkLimit = Math.min(PREPARATION_CHECK_LIMIT, Math.max(1, Math.ceil(size * 0.15)));
  return { mastery, fresh, checks, checkLimit, round,
    count: Math.min(size, fresh.length + Math.min(checks.length, checkLimit)) };
}

export function trainingCount(bank, preparation, state = null, now = Date.now()) {
  return state ? preparationTrainingPool(bank, state, now).count : roundSize(bank, preparation);
}

function sampleChecks(bank, state, candidates, count, mastery, random, now) {
  if (!count) return [];
  const weights = new Map(candidates.map(q => {
    const item = mastery.questions.get(q.id), stars = questionGuidance(q, state.questionAnnotations).stars ?? 3;
    const age = Math.min(7, Math.max(0, (now - item.lastAt) / DAY_MS));
    return [q.id, stars + Math.min(3, item.wrongCount) + (item.uncertain ? 3 : 0) + age];
  }));
  const ranked = [...candidates].sort((a, b) => weights.get(b.id) - weights.get(a.id));
  const hard = ranked.slice(0, Math.max(6, count * 3));
  const selected = weightedSample(hard, weights, count > 1 ? count - 1 : count, random);
  // Reserve one broadly random check, so easier or untagged items are not ignored.
  if (count > 1) {
    const ids = new Set(selected.map(q => q.id));
    selected.push(...shuffle(candidates.filter(q => !ids.has(q.id)), random).slice(0, 1));
  }
  return selected;
}

function mixedSample(questions, weights, count, selected, random) {
  const chosen = [], topics = new Map();
  for (const q of selected) topics.set(q.chapterId, (topics.get(q.chapterId) ?? 0) + 1);
  let remaining = [...questions];
  while (chosen.length < count && remaining.length) {
    const balanced = new Map(remaining.map(q => [q.id, (weights.get(q.id) ?? 1) / (1 + (topics.get(q.chapterId) ?? 0))]));
    const [q] = weightedSample(remaining, balanced, 1, random);
    chosen.push(q); topics.set(q.chapterId, (topics.get(q.chapterId) ?? 0) + 1);
    remaining = remaining.filter(item => item.id !== q.id);
  }
  return chosen;
}

export function createTraining(bank, state, random = Math.random, now = Date.now()) {
  if (!diagnosticProgress(state, bank).ready) throw new Error("请先完成本次测评的所有题目；解答题需完成自评");
  const { weights } = preparationProfile(bank, state, now);
  const { mastery, fresh: questions, checks, checkLimit, count, round } = preparationTrainingPool(bank, state, now);
  if (!count) throw new Error("当前范围的题目已通过，本场暂不重复；完成其他范围后再抽查，或次日回来复习。");
  const unseen = questions.filter((q) => !mastery.questions.has(q.id));
  const pending = questions.filter((q) => mastery.questions.get(q.id)?.wrongCount);
  const selected = weightedSample(unseen, weights, Math.min(unseen.length, Math.max(1, Math.floor(count / 4))), random);
  const selectedIds = new Set(selected.map((q) => q.id));
  for (const q of weightedSample(pending, weights, Math.min(Math.ceil(count / 2), count - selected.length), random)) {
    selected.push(q); selectedIds.add(q.id);
  }
  const checkCount = Math.min(checkLimit, checks.length, count - selected.length);
  const audits = sampleChecks(bank, state, checks, checkCount, mastery, random, now);
  selected.push(...audits);
  for (const q of audits) selectedIds.add(q.id);
  selected.push(...mixedSample(questions.filter((q) => !selectedIds.has(q.id)), weights, count - selected.length, selected, random));
  const practice = createPractice(shuffle(selected, random).map((q) => q.id), "prepare-training");
  if (!practice.questionIds.length) throw new Error("备考范围内已没有可用题目，请重新选择章节");
  practice.preparationId = state.preparation.id;
  practice.round = round;
  practice.auditQuestionIds = audits.map(q => q.id);
  return practice;
}

export function practiceProgress(practice, bank = null) {
  const ids = practice.questionIds.filter((id) => !bank || isScorable(getBankIndex(bank).questions.get(id)));
  const results = ids.map((id) => practice.responses[id])
    .filter((r) => r?.graded && typeof r.correct === "boolean");
  return { completed: results.length, correct: results.filter((r) => r.correct).length,
    total: ids.length, ready: results.length === ids.length };
}
