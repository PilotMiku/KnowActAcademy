import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, normalizeBank, recordAttempt, createPractice, createExam, finishExam } from "../dist/core.mjs";
import { createPreparation } from "../dist/preparation.mjs";
import { dailyTasks } from "../dist/dashboard-tasks.mjs";
import { fixture } from "./fixture.mjs";

test("daily tasks retain both saved preparation and ordinary practice, count only valid work, and exclude expired exams", () => {
  const bank = normalizeBank(fixture), state = emptyState(), now = Date.now();
  const created = createPreparation(bank, { subjectId: "math", chapterIds: ["limits"] });
  state.preparation = { ...created.preparation, session: created.practice };
  state.practice = createPractice(bank.questions.map(q => q.id));
  const expired = createExam([bank.questions[0].id], 1, "math", now - 120000);
  finishExam(state, bank, expired, now);
  state.exams.push(expired);
  recordAttempt(state, bank.questions[0], "B", true, { at: now });
  const tasks = dailyTasks(bank, state, now);
  assert.equal(tasks.completed, 1);
  assert.equal(tasks.remaining, 19);
  assert.equal(tasks.preparation.progress.total, 6);
  assert.equal(tasks.practice.progress.completed, 0);
  assert.equal(tasks.exam, null);
});
