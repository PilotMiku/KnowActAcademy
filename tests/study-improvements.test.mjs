import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, normalizeBank, recordAttempt, createExam, finishExam, BACKUP_FORMAT, validateBackup } from '../dist/core.mjs';
import { createPreparation, createTraining, preparationMastery, preparationMetrics, trainingCount } from '../dist/preparation.mjs';
import { practicePool, balancedSample, collectionQueue, collectionPageSlice, reviewBatchSize } from '../dist/study-planning.mjs';
import { spacedReview, DAY_MS } from '../dist/study.mjs';
import { pauseExamQuestion, resumeExamQuestion } from '../dist/exam-timing.mjs';
import { resolvedTheme } from '../dist/preferences.mjs';
import { createSaveScheduler } from '../dist/save-scheduler.mjs';
import { fixture } from './fixture.mjs';
function setup(count = 6) {
  const raw = structuredClone(fixture);
  raw.subjects[0].chapters.push({ id: 'other', name: '另一章' });
  raw.questions = Array.from({length: count}, (_, i) => ({ ...raw.questions[0], id: `q${i}`, chapterId: i < count - 1 ? 'limits' : 'other' }));
  const bank = normalizeBank(raw);
  return { bank, state: { ...emptyState(), ...createPreparation(bank, {subjectId:'math', chapterIds:['limits', 'other']}) } };
}
function attempt(state, q, correct, i, extra = {}) {
  recordAttempt(state, q, correct ? 'B' : 'A', correct, { id:`practice:g${i}:${q.id}`, practiceId:`g${i}`, mode:'prepare-diagnostic', preparationId:state.preparation.id, at:1000+i, ...extra });
}
test('adaptive small pools leave room to repeat mistakes; fixed policy retains all questions', () => {
  const {bank, state} = setup();
  bank.questions.forEach((q, i) => attempt(state, q, i !== 0, i));
  assert.equal(trainingCount(bank, state.preparation), 4);
  let wrong = 0, other = 0, seed = 1;
  const rng = () => ((seed = (Math.imul(seed,1664525)+1013904223)>>>0) / 2**32);
  for(let i=0;i<200;i++) {
    const p = createTraining(bank, state, rng);
    assert.equal(new Set(p.questionIds).size, 4);
    wrong += p.questionIds.includes('q0'); other += p.questionIds.includes('q1');
  }
  assert.ok(wrong > other);
  state.preparation.roundPolicy='fixed';
  assert.equal(createTraining(bank,state).questionIds.length,6);
});
test('training reserves a quarter for unseen questions while reinforcing mistakes', () => {
  const {bank, state} = setup(60);
  for(const [i,id] of state.preparation.diagnosticIds.entries()) attempt(state, bank.questions.find(q=>q.id===id), false, i);
  const p = createTraining(bank,state);
  const seen = new Set(state.preparation.diagnosticIds);
  assert.equal(p.questionIds.length,20);
  assert.ok(p.questionIds.filter(id=>!seen.has(id)).length>=5);
  assert.ok(p.questionIds.filter(id=>seen.has(id)).length>=10);
});
test('uncertain success resets confident mastery and review interval; a later-day success confirms retention', () => {
  const {bank,state}=setup(1), q=bank.questions[0];
  attempt(state,q,true,0); attempt(state,q,true,1);
  assert.equal(preparationMastery(bank,state).mastered,1);
  assert.equal(preparationMastery(bank,state).stableMastered,0);
  attempt(state,q,true,2,{uncertain:true});
  assert.equal(preparationMastery(bank,state).mastered,0);
  assert.equal(spacedReview(bank,state).schedule.get(q.id).intervalDays,1);
  attempt(state,q,true,3);
  attempt(state,q,true,4,{at:DAY_MS+1003});
  assert.equal(preparationMastery(bank,state).stableMastered,1);
});
test('forecast stays pending with sparse samples and uses only recent in-scope mock exams', () => {
  const {bank,state}=setup(),q=bank.questions[0];
  attempt(state,q,true,0);
  assert.equal(preparationMetrics(bank,state).estimatedScore,null);
  const base={id:'mock',status:'submitted',score:80,submittedAt:state.preparation.startedAt+1,questionIds:bank.questions.map(q=>q.id)};
  state.exams=[{...base,submittedAt:state.preparation.startedAt-1}];
  assert.equal(preparationMetrics(bank,state).estimatedScore,null);
  state.exams=[{...base,questionIds:[...base.questionIds,'outside']}];
  assert.equal(preparationMetrics(bank,state).estimatedScore,null);
  state.exams=[base];
  const m=preparationMetrics(bank,state);
  assert.equal(m.evidence,'模拟成绩参考');
  assert.equal(m.estimatedScore,Math.round((m.trainingScore+80)/2*10)/10);
});
test('unseen and unmastered practice filters keep independent meaning', () => {
  const {bank,state}=setup();
  attempt(state,bank.questions[0],true,0); attempt(state,bank.questions[0],true,1);
  attempt(state,bank.questions[1],true,2,{uncertain:true});
  assert.equal(practicePool(bank,{status:'unseen'},state).length,4);
  const pending=practicePool(bank,{status:'unmastered'},state);
  assert.equal(pending.length,5); assert.ok(pending.some(q=>q.id==='q1'));
});
test('balanced practice samples small chapters and queues reach questions after the first page', () => {
  const {bank,state}=setup(65);
  assert.ok(balancedSample(bank,bank.questions,2).some(q=>q.chapterId==='other'));
  state.favorites=bank.questions.map(q=>q.id);
  attempt(state,bank.questions[0],true,0);
  const queue=collectionQueue(bank,{},state,'favorites','priority',DAY_MS+1001);
  assert.notEqual(queue[0].id,'q0');
  const last=collectionPageSlice(queue,3);
  assert.equal(last.items.length,5);
  assert.equal(collectionPageSlice(queue,999).page,3);
  assert.equal(collectionPageSlice(queue,-1).page,1);
  assert.equal(reviewBatchSize(state,5),5);
  state.attempts[0].durationMs=120000;
  assert.equal(reviewBatchSize(state,5),2);
});
test('exam timing excludes inactive periods, caps at deadline, and exports uncertainty', () => {
  const {bank,state}=setup(2);
  const e=createExam(bank.questions.map(q=>q.id),1,'math',1000);state.exams.push(e);
  pauseExamQuestion(e,3000); resumeExamQuestion(e,10000); pauseExamQuestion(e,12000);
  e.index=1;resumeExamQuestion(e,13000);e.uncertainIds=[e.questionIds[1]];
  finishExam(state,bank,e,70000);
  assert.equal(e.questionTimes[e.questionIds[0]],4000);
  assert.equal(e.questionTimes[e.questionIds[1]],48000);
  assert.equal(state.attempts[1].durationMs,48000);
  assert.equal(state.attempts[1].uncertain,true);
});
test('new preferences and recall drafts roundtrip; malformed timing and uncertainty are rejected', () => {
  const {bank,state}=setup();
  state.studySettings={fontSize:'larger',lineSpacing:'relaxed',focus:true};
  state.knowledgeRecallDrafts={note:'核心概念'}; state.knowledgeRecalled=['note'];
  const payload={format:BACKUP_FORMAT,bank,state};
  assert.deepEqual(validateBackup(structuredClone(payload)).state.studySettings,state.studySettings);
  assert.equal(validateBackup(structuredClone(payload)).state.knowledgeRecallDrafts.note,'核心概念');
  assert.equal(resolvedTheme('system',true),'dark'); assert.equal(resolvedTheme('light',true),'light');
  const e=createExam(['q0'],1,'math'); e.questionTimes.q0=-1;state.exams=[e];
  assert.throws(()=>validateBackup(structuredClone(payload)));
  e.questionTimes.q0=0;e.uncertainIds=['outside'];
  assert.throws(()=>validateBackup(structuredClone(payload)));
});
test('typing saves coalesce and critical actions flush once', async () => {
  let saves=0;
  const scheduler=createSaveScheduler(()=>{saves++},()=>{},20);
  scheduler.schedule();scheduler.schedule();scheduler.schedule();
  await scheduler.flush();assert.equal(saves,1);
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(saves,1);
  scheduler.schedule();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(saves,2);
  scheduler.schedule();scheduler.cancel();await scheduler.flush();assert.equal(saves,2);
});
