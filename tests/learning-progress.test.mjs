import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, normalizeBank, filterQuestions, recordAttempt, createExam, finishExam } from "../dist/core.mjs";
import { learningProgress } from "../dist/study.mjs";
import { fixture } from "./fixture.mjs";

const bank = normalizeBank(fixture);
test("learning progress deduplicates questions and uses the latest valid result by time", () => {
  const state = emptyState(), [single, multi] = bank.questions;
  recordAttempt(state, single, "A", false, { id: "wrong", at: 1000 });
  recordAttempt(state, single, "B", true, { id: "right", at: 3000, mode: "prepare-training" });
  recordAttempt(state, single, "A", false, { id: "older-exam", at: 2000, mode: "exam" });
  recordAttempt(state, multi, ["A"], false, { id: "partial-multi", at: 3000 });
  const before = JSON.stringify(state);
  assert.deepEqual(learningProgress(bank.questions, state), {
    total: 6, completed: 2, correct: 1, completion: 33.33, accuracy: 50,
  });
  assert.equal(JSON.stringify(state), before);
  recordAttempt(state, single, "A", false, { id: "same-time-later", at: 3000 });
  assert.equal(learningProgress(bank.questions, state).accuracy, 0);
});

test("progress follows nested scope and question types, separates subjects and deduplicates overlapping selections", () => {
  const raw = structuredClone(fixture);
  raw.subjects[0].chapters = [{ id: "root", name: "大章", children: [{ id: "limits", name: "小节" }] }];
  raw.subjects.push({ id: "other", name: "另一科目", chapters: [{ id: "limits", name: "同 ID 章节" }] });
  raw.questions.push({ ...raw.questions[0], id: "other-q", subjectId: "other" });
  const bank = normalizeBank(raw), state = emptyState();
  recordAttempt(state, bank.questions[0], "B", true, { at: 1000 });
  const scope = filterQuestions(bank, { subjectId: "math", chapterId: "root" });
  assert.equal(learningProgress([...scope, ...scope], state).total, 6);
  assert.equal(learningProgress(scope, state).completed, 1);
  assert.equal(learningProgress(filterQuestions(bank, { subjectId: "other", chapterId: "limits" }), state).completed, 0);
  assert.equal(learningProgress(filterQuestions(bank, { subjectId: "math", type: "multiple" }), state).completed, 0);
  assert.deepEqual(learningProgress([], state), { total: 0, completed: 0, correct: 0, completion: 0, accuracy: null });
});

test("reference viewing and unanswered exams do not count; manual self-assessment counts without written text", () => {
  const state = emptyState(), [single, multi] = bank.questions, solution = bank.questions[4];
  const exam = createExam([single.id, multi.id], 30, "math", 1000);
  exam.answers[single.id] = "B";
  finishExam(state, bank, exam, 2000);
  recordAttempt(state, solution, "", null, { id: "reference", at: 3000 });
  assert.deepEqual(learningProgress(bank.questions, state), {
    total: 6, completed: 1, correct: 1, completion: 16.67, accuracy: 100,
  });
  recordAttempt(state, solution, "", false, { id: "self-grade", at: 4000, manual: true });
  recordAttempt(state, bank.questions[2], "  ", false, { id: "blank-fill", at: 4000 });
  assert.equal(learningProgress(bank.questions, state).completed, 2);
  assert.equal(learningProgress(bank.questions, state).accuracy, 50);
  assert.equal(learningProgress(bank.questions, emptyState()).accuracy, null);
});
