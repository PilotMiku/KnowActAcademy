import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeBank, emptyState, recordAttempt, validateBackup, BACKUP_FORMAT } from "../dist/core.mjs";
import { createPreparation, preparationProfile } from "../dist/preparation.mjs";
import { getConceptIndex } from "../dist/concepts.mjs";
import { DAY_MS, spacedReview, reviewWeight, archivePreparation, preparationPlans, preparationTrends } from "../dist/study.mjs";
import { fixture } from "./fixture.mjs";

const T = Date.UTC(2026, 9, 1, 8);
const bank = normalizeBank(fixture);
function answer(state, q, correct, at, extra = {}) {
  recordAttempt(state, q, "answer", correct, { at, ...extra });
}

test("spaced review progresses 1/3/7/14/30/60 days, caps the interval and resets after an error", () => {
  const state = emptyState(), q = bank.questions[0];
  let at = T;
  for (const [i, days] of [1, 3, 7, 14, 30, 60, 60].entries()) {
    answer(state, q, true, at, { id: `right-${i}` });
    const item = spacedReview(bank, state, at).schedule.get(q.id);
    assert.equal(item.intervalDays, days);
    assert.equal(item.dueAt, at + days * DAY_MS);
    at = item.dueAt;
  }
  answer(state, q, false, at, { id: "wrong" });
  const item = spacedReview(bank, state, at).schedule.get(q.id);
  assert.equal(item.streak, 0);
  assert.equal(item.intervalDays, 1);
  assert.equal(item.dueAt, at + DAY_MS);
});

test("early correct repetitions retain the due date; pending self-assessment and missing questions do not schedule", () => {
  const state = emptyState(), q = bank.questions[0];
  answer(state, q, true, T, { id: "first" });
  answer(state, q, true, T + 1000, { id: "early" });
  answer(state, bank.questions[4], null, T, { id: "reference" });
  state.attempts.push({ questionId: "removed", correct: true, at: T });
  const schedule = spacedReview(bank, state, T).schedule;
  assert.equal(schedule.size, 1);
  assert.equal(schedule.get(q.id).dueAt, T + DAY_MS);
  assert.equal(schedule.get(q.id).streak, 1);
  assert.equal(spacedReview(bank, state, T + DAY_MS - 1).due.length, 0);
  assert.equal(spacedReview(bank, state, T + DAY_MS).due.length, 1);
});

test("review schedules sort out-of-order exam records, remain portable and boost overdue weights", () => {
  const state = emptyState(), q = bank.questions[0];
  answer(state, q, true, T + 2 * DAY_MS, { id: "later", mode: "exam" });
  answer(state, q, false, T, { id: "earlier" });
  const serialized = JSON.stringify(state), result = spacedReview(bank, state, T + 4 * DAY_MS);
  assert.equal(JSON.stringify(state), serialized);
  assert.equal(result.due.length, 1);
  const item = result.schedule.get(q.id);
  assert.equal(item.dueAt, T + 3 * DAY_MS);
  assert.equal(reviewWeight(item, T), 1);
  assert.ok(reviewWeight(item, T + 4 * DAY_MS) > 1.8);
  assert.ok(reviewWeight(item, T + 1000 * DAY_MS) <= 3.8);
  const restored = validateBackup(JSON.parse(JSON.stringify({ format: BACKUP_FORMAT, bank, state })));
  assert.deepEqual([...spacedReview(restored.bank, restored.state, T).schedule], [...spacedReview(bank, state, T).schedule]);
});

function crossBank() {
  const raw = structuredClone(fixture);
  raw.subjects[0].chapters.push({ id: "series", name: "另一章" }, { id: "other", name: "无关章节" });
  raw.questions = [
    { ...raw.questions[0], id: "first", concepts: ["展开", "展开"] },
    { ...raw.questions[0], id: "related", chapterId: "series", tags: ["知识点：展开"] },
    { ...raw.questions[0], id: "unrelated", chapterId: "other" },
  ];
  return normalizeBank(raw);
}

test("explicit concepts propagate weak-topic weights across chapters while respecting the selected scope", () => {
  const bank = crossBank();
  const state = { ...emptyState(), ...createPreparation(bank, { subjectId: "math", chapterIds: ["limits", "series", "other"] }) };
  state.practice = null;
  const first = bank.questions[0];
  answer(state, first, false, T, { id: "weak", preparationId: state.preparation.id, mode: "prepare-diagnostic" });
  const profile = preparationProfile(bank, state, T);
  assert.ok(profile.weights.get("related") > profile.weights.get("unrelated"));
  assert.equal(profile.concepts[0].chapters.size, 2);
  assert.equal(profile.concepts[0].inScope, 2);
  state.preparation.chapterIds = ["limits"];
  const scoped = preparationProfile(bank, state, T);
  assert.ok(!scoped.weights.has("related"));
  assert.equal(scoped.concepts[0].inScope, 1);
  assert.equal(scoped.concepts[0].chapters.size, 2);
});

test("bundled concepts connect Taylor and series chapters and keep original question data unchanged", async () => {
  const bank = normalizeBank(JSON.parse(await readFile(new URL("../dist/data/bank.json", import.meta.url), "utf8")));
  const before = JSON.stringify(bank), index = getConceptIndex(bank);
  assert.equal(getConceptIndex(bank), index);
  const concept = index.concepts.get("泰勒展开与幂级数");
  assert.ok([...concept.chapters.values()].some((c) => /Taylor/i.test(c.name)));
  assert.ok([...concept.chapters.values()].some((c) => /幂级数/.test(c.name)));
  assert.ok(concept.questionIds.length > 0);
  assert.equal(JSON.stringify(bank), before);
});

test("due review boosts a previously mastered question in weighted preparation", () => {
  const bank = crossBank(), state = { ...emptyState(), ...createPreparation(bank, { subjectId: "math", chapterIds: ["limits", "series"] }) };
  state.practice = null;
  answer(state, bank.questions[0], true, T, { id: "old", preparationId: state.preparation.id });
  const before = preparationProfile(bank, state, T), due = preparationProfile(bank, state, T + DAY_MS);
  assert.equal(before.due.length, 0);
  assert.equal(due.due.length, 1);
  assert.ok(due.weights.get("first") > before.weights.get("first"));
});

test("trends separate plans and groups, include partial progress and read legacy practice IDs", () => {
  const state = { ...emptyState(), ...createPreparation(bank, { subjectId: "math", chapterIds: ["limits"] }) };
  const prepId = state.preparation.id;
  for (const [i, q] of bank.questions.entries()) {
    answer(state, q, i < 3, T + i, { id: `practice:legacy-diagnostic:${q.id}`, mode: "prepare-diagnostic", preparationId: prepId });
    answer(state, q, true, T + 100 + i, { id: `training:${q.id}`, mode: "prepare-training", preparationId: prepId, practiceId: "group-one", round: 1, sessionSize: 6 });
  }
  answer(state, bank.questions[0], false, T + 200, { id: "partial", mode: "prepare-training", preparationId: prepId, practiceId: "group-two", round: 2, sessionSize: 6 });
  const rows = preparationTrends(bank, state, prepId);
  assert.deepEqual(rows.map((r) => r.accuracy), [50, 100, 0]);
  assert.deepEqual(rows.map((r) => r.ready), [true, true, false]);
  assert.deepEqual(rows.map((r) => r.round), [0, 1, 2]);
  archivePreparation(state);
  archivePreparation(state);
  assert.equal(state.preparationHistory.length, 1);
  state.preparation = createPreparation(bank, { subjectId: "math", chapterIds: ["limits"] }).preparation;
  assert.equal(preparationPlans(state).length, 2);
  assert.deepEqual(preparationTrends(bank, state, prepId), rows);
  assert.deepEqual(preparationTrends(bank, state, state.preparation.id), []);
  const restored = validateBackup(JSON.parse(JSON.stringify({ format: BACKUP_FORMAT, bank, state })));
  assert.deepEqual(restored.state.preparationHistory, state.preparationHistory);
  assert.deepEqual(preparationTrends(restored.bank, restored.state, prepId), rows);
});

test("old backups default to no history; malformed history and invalid group sizes are rejected", () => {
  const state = emptyState();
  delete state.preparationHistory;
  assert.deepEqual(validateBackup({ format: BACKUP_FORMAT, bank, state }).state.preparationHistory, []);
  for (const history of [null, {}, [null], [{ id: "broken", subjectId: "missing" }]])
    assert.throws(() => validateBackup({ format: BACKUP_FORMAT, bank, state: { ...emptyState(), preparationHistory: history } }), /备考历史/);
  const invalid = emptyState();
  answer(invalid, bank.questions[0], true, T, { practiceId: "bad", sessionSize: 0 });
  assert.throws(() => validateBackup({ format: BACKUP_FORMAT, bank, state: invalid }), /答题记录/);
});
