import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeBank, emptyState, isScorable, judge, recordAttempt, examQuestions,
  createExam, finishExam, stats, validateBackup, BACKUP_FORMAT } from '../dist/core.mjs';
import { preparationQuestions, preparationMastery, diagnosticProgress, practiceProgress,
  createPreparation, restoreDiagnostic } from '../dist/preparation.mjs';
import { examResultSummary } from '../dist/exam-view.mjs';
import { learningProgress, spacedReview } from '../dist/study.mjs';
import { fixture } from './fixture.mjs';

test('question quality survives legacy normalization and excludes unreliable grading without hiding sources', () => {
  const input = structuredClone(fixture);
  input.questions[0].answerVerified = false;
  input.questions[1].sourceIncomplete = true;
  const bank = normalizeBank(input), state = emptyState();
  const [unverified, incomplete, valid] = bank.questions;
  assert.equal(isScorable(unverified), false);
  assert.equal(isScorable(incomplete), false);
  assert.equal(isScorable(valid), true); // Unmarked custom questions remain compatible.
  const legacy = structuredClone(incomplete); delete legacy.sourceIncomplete;
  assert.equal(normalizeBank({ ...bank, questions: [legacy] }).questions[0].sourceIncomplete, true);
  assert.equal(judge(unverified, unverified.answer), null);
  assert.equal(recordAttempt(state, unverified, unverified.answer, true), false);
  assert.ok(examQuestions(bank).every(isScorable));
  assert.ok(preparationQuestions(bank, { subjectId: 'math', chapterIds: ['limits'] }).every(isScorable));
  const restored = validateBackup({ format: BACKUP_FORMAT, bank, state });
  assert.equal(restored.bank.questions.length, bank.questions.length);
  assert.deepEqual(restored.bank.questions[1].original, incomplete.original);
  assert.equal(restored.bank.questions[1].sourceIncomplete, true);
});

test('legacy attempts, active exams and preparation sessions ignore newly ineligible questions', () => {
  const bank = normalizeBank(fixture), state = emptyState(), [bad, good] = bank.questions;
  recordAttempt(state, bad, bad.answer, true);
  bad.answerVerified = false;
  assert.equal(stats(state, Date.now(), bank).total, 0);
  assert.equal(learningProgress([bad, good], state).total, 1);
  assert.equal(spacedReview(bank, state).schedule.size, 0);
  state.preparation = { id: 'plan', subjectId: 'math', chapterIds: ['limits'], diagnosticIds: [bad.id, good.id] };
  state.attempts[0].preparationId = 'plan'; state.attempts[0].mode = 'prepare-diagnostic';
  assert.equal(preparationMastery(bank, state).covered, 0);
  assert.deepEqual(diagnosticProgress(state, bank), { completed: 0, total: 1, ready: false });
  assert.deepEqual(practiceProgress({ questionIds: [bad.id], responses: {} }, bank), { completed: 0, correct: 0, total: 0, ready: true });
  const exam = createExam([bad.id, good.id], 10, 'math');
  exam.answers[good.id] = good.answer;
  finishExam(state, bank, exam);
  assert.equal(exam.results[bad.id], null);
  assert.equal(exam.score, 100);
  assert.equal(state.attempts.filter(a => a.examId === exam.id).length, 1);
  const legacyReport = { ...exam, results: { [bad.id]: true, [good.id]: false } };
  assert.deepEqual(examResultSummary(bank, legacyReport), { total: 1, correct: 0, excluded: 1, score: 0 });
});

test('resuming an older diagnostic skips ineligible questions and survives a backup', () => {
  const bank = normalizeBank(fixture), state = emptyState();
  const created = createPreparation(bank, { subjectId: 'math', chapterIds: ['limits'] }, () => 0);
  state.preparation = created.preparation;
  bank.questions[0].answerVerified = false;
  state.practice = restoreDiagnostic(state, bank);
  assert.ok(!state.practice.questionIds.includes(bank.questions[0].id));
  assert.ok(state.practice.index < state.practice.questionIds.length);
  assert.deepEqual(validateBackup({ format: BACKUP_FORMAT, bank, state }).state.practice, state.practice);
});

test('all 19 incomplete bundled questions stay available but outside assessment pools', () => {
  const raw = JSON.parse(readFileSync(new URL('../dist/data/bank.json', import.meta.url)));
  const bank = normalizeBank(raw);
  assert.equal(bank.questions.filter(q => !isScorable(q)).length, 19);
  assert.equal(examQuestions(bank).length, raw.questions.length - 19);
});
