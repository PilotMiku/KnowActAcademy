import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBank, emptyState, recordAttempt, validateBackup, BACKUP_FORMAT } from '../dist/core.mjs';
import { normalizeRevisionPlan, revisionSchedule, dateNumber } from '../dist/revision-planner.mjs';
import { questionLearningCards } from '../dist/question-learning.mjs';

const at = value => new Date(value + 'T12:00:00').getTime();
function fixture() {
  const bank = normalizeBank({ subjects: [
    { id: 'calculus', name: '高数', chapters: [{ id: 'chapter-1', name: '函数', children: [{ id: 'section', name: '小节' }] }] },
    { id: 'other', name: '其他', chapters: [{ id: 'chapter-1', name: '同名章节' }] },
  ], questions: Array.from({ length: 9 }, (_, i) => ({ id: 'q' + i,
    subjectId: i < 8 ? 'calculus' : 'other', chapterId: i < 8 ? 'section' : 'chapter-1',
    type: 'single', stem: '题目', options: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }], answer: 'A' })) });
  const state = emptyState();
  state.revisionPlan = { title: '期末', subjectId: 'calculus', chapterIds: ['chapter-1', 'section'],
    examDate: '2026-03-11', minutesPerDay: 10, createdAt: at('2026-03-08'), updatedAt: at('2026-03-08') };
  return { bank, state };
}

test('civil dates reject rollover and remain consecutive across daylight saving boundaries', () => {
  assert.ok(Number.isNaN(dateNumber('2026-02-30')));
  assert.ok(Number.isNaN(dateNumber('03/08/2026')));
  assert.equal(dateNumber('2026-03-09') - dateNumber('2026-03-08'), 1);
});

test('calendar deduplicates parent scopes, separates subjects, reserves the exam day and respects time capacity', () => {
  const { bank, state } = fixture();
  const summary = revisionSchedule(bank, state, at('2026-03-08'));
  assert.equal(summary.total, 8);
  assert.equal(summary.daysLeft, 3);
  assert.equal(summary.dailyCapacity, 5);
  assert.deepEqual(summary.days.map(d => d.date), ['2026-03-08', '2026-03-09', '2026-03-10']);
  assert.deepEqual(summary.days.map(d => d.newIds.length), [5, 3, 0]);
  assert.equal(new Set(summary.days.flatMap(d => d.questionIds)).size, 8);
  assert.ok(summary.days.every(d => d.minutes <= 10));
  assert.equal(summary.unscheduled, 0);
});

test('missed work is reassigned, overdue errors precede new work and repeated answers do not inflate today', () => {
  const { bank, state } = fixture();
  recordAttempt(state, bank.questions[0], 'B', false, { at: at('2026-03-07'), durationMs: 240000 });
  let summary = revisionSchedule(bank, state, at('2026-03-09'));
  assert.equal(summary.days[0].reviewIds[0], 'q0');
  assert.equal(summary.days[0].questionIds.length, 2);
  assert.ok(summary.unscheduled > 0);
  recordAttempt(state, bank.questions[0], 'A', true, { at: at('2026-03-09'), durationMs: 240000 });
  recordAttempt(state, bank.questions[0], 'A', true, { at: at('2026-03-09') + 1000, durationMs: 240000 });
  summary = revisionSchedule(bank, state, at('2026-03-09') + 2000);
  assert.equal(summary.completedToday, 1);
  assert.equal(summary.days[0].questionIds.length, 1);
  assert.equal(summary.days[0].questionIds.includes('q0'), false);
  assert.equal(revisionSchedule(bank, state, at('2026-03-11')).expired, true);
  assert.deepEqual(revisionSchedule(bank, state, at('2026-03-11')).days, []);
});

test('manual self-assessment counts, reference-only questions are excluded and future reviews are not pulled early', () => {
  const { bank, state } = fixture();
  bank.questions[0].type = 'solution';
  bank.questions[1].answerVerified = false;
  recordAttempt(state, bank.questions[0], '', true, { manual: true, at: at('2026-03-08') });
  const summary = revisionSchedule(bank, state, at('2026-03-08') + 1000);
  assert.equal(summary.total, 7);
  assert.equal(summary.completedToday, 1);
  assert.equal(summary.days[0].reviewIds.includes('q0'), false);
});

test('plans roundtrip through backups, old backups default empty and malformed plans cannot replace progress', () => {
  const { bank, state } = fixture();
  const payload = { format: BACKUP_FORMAT, bank, state };
  assert.deepEqual(validateBackup(payload).state.revisionPlan, state.revisionPlan);
  const old = structuredClone(payload); delete old.state.revisionPlan;
  assert.equal(validateBackup(old).state.revisionPlan, null);
  for (const patch of [{ examDate: '2026-02-30' }, { chapterIds: ['missing'] }, { minutesPerDay: Infinity }, { minutesPerDay: 0 }, { title: 'x'.repeat(81) }])
    assert.throws(() => normalizeRevisionPlan({ ...state.revisionPlan, ...patch }, bank));
});

test('rapid submissions cannot inflate the daily time budget estimate', () => {
  const { bank, state } = fixture();
  recordAttempt(state, bank.questions[0], 'A', true, { at: at('2026-03-08'), durationMs: 500 });
  assert.equal(revisionSchedule(bank, state, at('2026-03-08') + 1000).dailyCapacity, 5);
});

test('knowledge aids distinguish concept annotations from broad chapter association and preserve sources', () => {
  const { bank, state } = fixture(), original = JSON.stringify(bank);
  assert.equal(questionLearningCards(bank.questions[0], bank, state)[0].association, '章节关联 · 本章代表性主题');
  state.questionAnnotations.q0 = { concepts: ['函数定义域'] };
  assert.equal(questionLearningCards(bank.questions[0], bank, state)[0].id, 'domain');
  assert.deepEqual(questionLearningCards(bank.questions[8], bank, state), []);
  assert.equal(JSON.stringify(bank), original);
});
