import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBank, emptyState, recordAttempt, stats, dayKey } from '../dist/core.mjs';
import { getAttemptIndex } from '../dist/attempt-index.mjs';
import { spacedReview, learningProgress, DAY_MS } from '../dist/study.mjs';
import { fixture } from './fixture.mjs';

test('incremental statistics match late exam records and reset on imported history', () => {
  const bank=normalizeBank(fixture), state=emptyState(), q=bank.questions[0], now=Date.now();
  recordAttempt(state,q,'B',true,{at:now,id:'first',durationMs:60000});
  const index=getAttemptIndex(state,bank);
  assert.equal(stats(state,now,bank).total,1);
  spacedReview(bank,state,now);
  // A timed-out exam can append an older result after a more recent practice.
  recordAttempt(state,q,'A',false,{at:now-DAY_MS*2,id:'late'});
  assert.equal(getAttemptIndex(state,bank),index);
  assert.equal(stats(state,now,bank).today,1);
  assert.equal(stats(state,now,bank).accuracy,50);
  assert.equal(stats(state,now,bank).minutes,1);
  assert.equal(learningProgress([q],state).correct,1);
  assert.equal(spacedReview(bank,state,now).schedule.get(q.id).lastAt,now);
  assert.equal(index.days.get(dayKey(now-DAY_MS*2)).correct,0);
  state.attempts=state.attempts.slice(1);
  assert.notEqual(getAttemptIndex(state,bank),index);
  assert.equal(stats(state,now,bank).total,1);
  assert.equal(learningProgress([q],state).correct,0);
  state.attempts=[];
  assert.equal(spacedReview(bank,state,now).schedule.size,0);
  assert.equal(stats(state,now,bank).total,0);
});

test('legacy solution self-assessments count without a written answer or manual marker', () => {
  const bank=normalizeBank(fixture), state=emptyState(), q=bank.questions.find(q=>q.type==='solution');
  state.attempts.push({id:'legacy',questionId:q.id,answer:'',correct:true,at:Date.now()});
  assert.equal(learningProgress([q],state).correct,1);
});
