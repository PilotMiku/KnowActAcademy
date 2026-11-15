import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBank } from '../dist/core.mjs';
import { pendingQuestionIndices, nextPendingIndex } from '../dist/session-navigation.mjs';
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
