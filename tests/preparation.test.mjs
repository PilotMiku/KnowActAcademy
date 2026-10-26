import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBank, emptyState, recordAttempt, validateBackup, BACKUP_FORMAT } from "../dist/core.mjs";
import {
  preparationQuestions, createPreparation, diagnosticProgress, restoreDiagnostic,
  preparationProfile, weightedSample, createTraining, practiceProgress,
  currentPreparationPractice,
} from "../dist/preparation.mjs";
import { fixture } from "./fixture.mjs";

function makeBank() {
  const raw = structuredClone(fixture);
  raw.subjects[0].chapters = [{ id: "root", name: "大章", children: [
    { id: "limits", name: "极限" }, { id: "derivatives", name: "导数" },
  ] }];
  raw.subjects.push({ id: "other", name: "另一科目", chapters: [{ id: "limits", name: "同名 ID" }] });
  raw.questions = Array.from({ length: 60 }, (_, i) => ({ ...raw.questions[0],
    id: `q-${i}`, chapterId: i < 30 ? "limits" : "derivatives",
  }));
  raw.questions.push({ ...raw.questions[0], id: "other-q", subjectId: "other" });
  raw.questions.push({ ...fixture.questions[4], id: "manual-q" });
  return normalizeBank(raw);
}
function makeState(bank) {
  return { ...emptyState(), ...createPreparation(bank, { subjectId: "math", chapterIds: ["root"] }, () => 0.5) };
}
function answer(state, q, correct, id) {
  recordAttempt(state, q, correct ? "B" : "A", correct, {
    id, mode: state.practice.mode, preparationId: state.preparation.id,
  });
}
function finishDiagnostic(bank, state) {
  for (const id of state.preparation.diagnosticIds)
    answer(state, bank.questions.find((q) => q.id === id), true, `diagnostic:${id}`);
}
function seededRandom(seed = 7) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}

test("preparation scope includes descendants, deduplicates and separates shared chapter IDs", () => {
  const bank = makeBank();
  const scope = { subjectId: "math", chapterIds: ["root", "limits", "limits"] };
  assert.equal(preparationQuestions(bank, scope).length, 61);
  assert.equal(preparationQuestions(bank, { subjectId: "other", chapterIds: ["limits"] }).length, 1);
  assert.equal(preparationQuestions(bank, { subjectId: "math", chapterIds: [] }).length, 0);
  assert.throws(() => createPreparation(bank, { subjectId: "math", chapterIds: [] }), /选择/);
  const created = createPreparation(bank, scope, () => 0.5);
  assert.equal(created.practice.questionIds.length, 20);
  assert.equal(new Set(created.practice.questionIds).size, 20);
  assert.ok(!created.practice.questionIds.includes("other-q"));
  assert.deepEqual(created.preparation.chapterIds, ["root", "limits"]);
  const small = createPreparation(bank, { subjectId: "other", chapterIds: ["limits"] });
  assert.deepEqual(small.practice.questionIds, ["other-q"]);
});

test("diagnostic answers belong to their plan; skipped and unassessed questions do not unlock training", () => {
  const bank = makeBank(), state = makeState(bank);
  const q = bank.questions.find((q) => q.id === state.preparation.diagnosticIds[0]);
  recordAttempt(state, q, "B", true, { id: "older", mode: "prepare-diagnostic", preparationId: "old-plan" });
  answer(state, q, null, "pending");
  assert.equal(diagnosticProgress(state).completed, 0);
  assert.throws(() => createTraining(bank, state), /完成/);
  answer(state, q, false, "current");
  answer(state, q, false, "current");
  assert.equal(diagnosticProgress(state).completed, 1);
  const resumed = restoreDiagnostic(state);
  assert.equal(resumed.id, state.preparation.diagnosticPracticeId);
  assert.equal(resumed.index, 1);
  assert.equal(resumed.responses[q.id].correct, false);
  assert.equal(practiceProgress(resumed).completed, 1);
  finishDiagnostic(bank, state);
  assert.ok(diagnosticProgress(state).ready);
  const training = createTraining(bank, state, seededRandom());
  assert.equal(training.questionIds.length, 20);
  assert.equal(new Set(training.questionIds).size, 20);
  assert.equal(training.preparationId, state.preparation.id);
  assert.equal(training.round, 1);
  assert.equal(state.preparation.round, 0); // Caller commits after creating the session.
});

test("wrong answers increase related-topic weights; recent success lowers weights without excluding other topics", () => {
  const bank = makeBank(), state = makeState(bank);
  state.practice = null;
  const q = bank.questions[0], related = bank.questions[1], other = bank.questions[35];
  const before = preparationProfile(bank, state);
  recordAttempt(state, q, "A", false, { id: "wrong", mode: "prepare-diagnostic", preparationId: state.preparation.id });
  const wrong = preparationProfile(bank, state);
  assert.ok(wrong.weights.get(q.id) > before.weights.get(q.id));
  assert.ok(wrong.weights.get(related.id) > before.weights.get(related.id));
  assert.equal(wrong.weights.get(other.id), 1);
  assert.ok(wrong.weights.get(related.id) > wrong.weights.get(other.id));
  for (let i = 0; i < 5; i++)
    recordAttempt(state, q, "B", true, { id: `success-${i}`, mode: "prepare-training", preparationId: state.preparation.id });
  const recovered = preparationProfile(bank, state);
  assert.ok(recovered.weights.get(q.id) < 1);
  assert.ok(recovered.weights.get(related.id) < 1);
  assert.ok([...recovered.weights.values()].every((w) => w > 0 && Number.isFinite(w)));
  assert.equal(recovered.topics[0].answered, 6);
  assert.equal(recovered.topics[0].correct, 5);
});

test("weighted sampling has the intended probability and no duplicates, including random endpoints and small pools", () => {
  const questions = [{ id: "weak" }, { id: "strong" }, { id: "unseen" }];
  const weights = new Map([["weak", 4], ["strong", 0.5], ["unseen", 1]]);
  const random = seededRandom();
  const counts = { weak: 0, strong: 0, unseen: 0 };
  for (let i = 0; i < 15000; i++) counts[weightedSample(questions, weights, 1, random)[0].id]++;
  assert.ok(Math.abs(counts.weak / 15000 - 4 / 5.5) < 0.02);
  assert.ok(counts.unseen > counts.strong && counts.strong > 0);
  for (const rng of [() => 0, () => 1, seededRandom()]) {
    const selected = weightedSample(questions, weights, 20, rng);
    assert.equal(new Set(selected.map((q) => q.id)).size, 3);
    assert.equal(selected.length, 3);
  }
  assert.deepEqual(questions.map((q) => q.id), ["weak", "strong", "unseen"]);
});

test("manual reference viewing is pending; only self-assessment affects weights and completion", () => {
  const bank = normalizeBank(fixture), state = { ...emptyState(), ...createPreparation(normalizeBank(fixture), { subjectId: "math", chapterIds: ["limits"] }) };
  const q = bank.questions.find((q) => q.type === "solution");
  state.practice.responses[q.id] = { answer: "", graded: true, correct: null };
  assert.equal(practiceProgress(state.practice).completed, 0);
  assert.equal(diagnosticProgress(state).completed, 0);
  assert.equal(preparationProfile(bank, state).topics.length, 0);
  answer(state, q, false, "manual-result");
  state.practice.responses[q.id].correct = false;
  assert.equal(practiceProgress(state.practice).completed, 1);
  assert.equal(diagnosticProgress(state).completed, 1);
  assert.equal(preparationProfile(bank, state).topics[0].correct, 0);
});

test("backup roundtrips retain preparation and weights; legacy and damaged plans remain recoverable", () => {
  const bank = makeBank(), state = makeState(bank);
  finishDiagnostic(bank, state);
  const backup = () => JSON.parse(JSON.stringify({ format: BACKUP_FORMAT, bank, state }));
  const restored = validateBackup(backup());
  assert.deepEqual(restored.state.preparation, state.preparation);
  assert.deepEqual(restored.state.practice, state.practice);
  assert.deepEqual([...preparationProfile(restored.bank, restored.state).weights], [...preparationProfile(bank, state).weights]);
  const legacy = backup();
  delete legacy.state.preparation;
  legacy.state.practice = null;
  assert.equal(validateBackup(legacy).state.preparation, null);
  for (const changes of [{ chapterIds: ["missing"] }, { diagnosticIds: ["other-q"] }, { round: -1 }, { subjectId: "missing" }, { diagnosticIds: [] }, { diagnosticIds: ["q-0", "q-0"] }]) {
    const invalid = backup();
    Object.assign(invalid.state.preparation, changes);
    const result = validateBackup(invalid).state;
    assert.equal(result.preparation, null);
    assert.equal(result.practice, null);
    assert.equal(result.attempts.length, state.attempts.length);
  }
  const invalid = backup();
  invalid.state.practice.questionIds = ["other-q"];
  invalid.state.practice.index = 0;
  assert.equal(validateBackup(invalid).state.practice, null);
});

test("saved preparation sessions survive switching to ordinary practice; damaged saved sessions are discarded", () => {
  const bank = makeBank(), state = makeState(bank);
  state.preparation.session = structuredClone(state.practice);
  const original = currentPreparationPractice(state);
  state.practice = null;
  assert.deepEqual(currentPreparationPractice(state), original);
  const restored = validateBackup(JSON.parse(JSON.stringify({ format: BACKUP_FORMAT, bank, state })));
  assert.deepEqual(currentPreparationPractice(restored.state), original);
  restored.state.preparation.session.questionIds = ["other-q"];
  const damaged = validateBackup({ format: BACKUP_FORMAT, bank, state: restored.state }).state;
  assert.equal(damaged.preparation.session, null);
  assert.equal(damaged.preparation.id, state.preparation.id);
  assert.equal(currentPreparationPractice(damaged), null);
  for (const preparation of [false, "bad", 1, {}])
    assert.equal(validateBackup({ format: BACKUP_FORMAT, bank, state: { ...emptyState(), preparation } }).state.preparation, null);
});
