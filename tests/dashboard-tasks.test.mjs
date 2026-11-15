import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, normalizeBank, recordAttempt, createPractice, createExam, finishExam } from "../dist/core.mjs";
import { createPreparation } from "../dist/preparation.mjs";
import { dailyTasks } from "../dist/dashboard-tasks.mjs";
import { fixture } from "./fixture.mjs";
import { dayKey } from '../dist/core.mjs';

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

test('an active calendar supplies the only daily target and counts distinct in-scope questions', () => {
  const bank = normalizeBank(fixture), state = emptyState(), now = Date.now();
  const date = new Date(now); date.setDate(date.getDate()+3);
  state.dailyGoal = 200;
  state.revisionPlan = { title:'考试',subjectId:'math',chapterIds:['limits'],examDate:dayKey(date),minutesPerDay:10,createdAt:now,updatedAt:now };
  recordAttempt(state,bank.questions[0],'B',true,{at:now});
  recordAttempt(state,bank.questions[0],'B',true,{at:now+1});
  const tasks = dailyTasks(bank,state,now+2);
  assert.equal(tasks.completed,1);
  assert.ok(tasks.goal <= 5);
  assert.equal(tasks.remaining,tasks.calendar.days[0].questionIds.length);
  assert.equal(tasks.goal,tasks.completed+tasks.remaining);
});
