import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBank } from '../dist/core.mjs';
import { pendingQuestionIndices, nextPendingIndex, nextPracticeSection } from '../dist/session-navigation.mjs';
import { offlineProgressDisplay, formatBytes } from '../dist/offline-view.mjs';
import { fixture } from './fixture.mjs';

const bank = normalizeBank({...fixture, questions:[...fixture.questions,
  {...fixture.questions[0],id:'qa-reference',answerVerified:false}]});
test('pending practice requires grading/self-grading and excludes reference-only questions', () => {
  const session = {questionIds:['qa-single','qa-solution','qa-reference','qa-multi'],responses:{
    'qa-single':{graded:true,correct:false},'qa-solution':{graded:true,correct:null},
    'qa-multi':{answer:['A'],graded:false}}};
  assert.deepEqual(pendingQuestionIndices(session, bank), [1,3]);
  session.responses['qa-solution'].correct = true;
  assert.deepEqual(pendingQuestionIndices(session, bank), [3]);
});
test('exam pending distinguishes whitespace, empty multi answers and valid false answers', () => {
  const session = {questionIds:['qa-single','qa-fill','qa-multi','qa-boolean'],
    answers:{'qa-single':'A','qa-fill':'  ','qa-multi':[],'qa-boolean':'false'}};
  assert.deepEqual(pendingQuestionIndices(session, bank, true), [1,2]);
  session.answers['qa-fill'] = '0.5'; session.answers['qa-multi'] = ['A','B'];
  assert.deepEqual(pendingQuestionIndices(session, bank, true), []);
});
test('next pending wraps across navigation pages without returning the current question', () => {
  assert.equal(nextPendingIndex([0,42,81],42),81);
  assert.equal(nextPendingIndex([0,42,81],81),0);
  assert.equal(nextPendingIndex([42],42),null);
  assert.equal(nextPendingIndex([],0),null);
});
test('offline progress survives rendering from state and exposes readable small transfer sizes', () => {
  assert.deepEqual(offlineProgressDisplay({done:512,total:1024}), {percent:50,label:'已处理 512 B / 1.0 KB · 50%'});
  assert.equal(offlineProgressDisplay({done:199,total:200}).label.endsWith('99%'),true);
  assert.equal(offlineProgressDisplay({done:210,total:200}).percent,100);
  assert.equal(offlineProgressDisplay(null).percent,0);
  assert.equal(formatBytes(1048576),'1.0 MB');
});

test('completed chapter practice advances in syllabus order and skips empty sections', () => {
  const tree = normalizeBank({
    subjects: [{ id: 'math', name: '测试科目', chapters: [
      { id: 'first', name: '第一章', children: [{ id: 'a', name: '第一节' }, { id: 'b', name: '第二节' }] },
      { id: 'second', name: '第二章', children: [{ id: 'empty', name: '空小节' }, { id: 'c', name: '第三节' }] },
    ] }],
    questions: ['a', 'b', 'c'].flatMap(chapterId => [1, 2].map(n => ({
      ...fixture.questions[0], id: chapterId + n, chapterId,
    }))),
  });
  const finished = (...ids) => ({
    mode: 'random', questionIds: ids,
    responses: Object.fromEntries(ids.map(id => [id, { graded: true, correct: false }])),
  });
  assert.equal(nextPracticeSection(finished('a1'), tree), null);
  const pending = finished('a1', 'a2');
  delete pending.responses.a1;
  assert.equal(nextPracticeSection(pending, tree), null);
  assert.equal(nextPracticeSection(finished('a2', 'a1'), tree).chapter.id, 'b');
  assert.equal(nextPracticeSection(finished('b2', 'a2', 'b1', 'a1'), tree).chapter.id, 'c');
  assert.equal(nextPracticeSection(finished('c1', 'c2'), tree), null);
  assert.equal(nextPracticeSection({ ...finished('a1', 'a2'), temporary: true }, tree), null);
});
