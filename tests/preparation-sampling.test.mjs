import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBank,emptyState,recordAttempt,validateBackup,BACKUP_FORMAT} from '../dist/core.mjs';
import {createPreparation,createTraining,preparationProfile,preparationMastery,preparationMetrics,preparationTrainingPool,trainingCount,syncPreparationMistakes,markPreparationIncorrect} from '../dist/preparation.mjs';
import {DAY_MS} from '../dist/study.mjs';
import {learningProgress,spacedReview,preparationTrends} from '../dist/study.mjs';
import {practicePool} from '../dist/study-planning.mjs';
import {fixture} from './fixture.mjs';
const seedRandom=(seed=9)=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
function setup(count=80){
 const raw=structuredClone(fixture);raw.subjects[0].chapters=[{id:'limits',name:'极限'},{id:'derivatives',name:'导数'}];
 raw.questions=Array.from({length:count},(_,i)=>({...raw.questions[0],id:`q${i}`,chapterId:i%2?'derivatives':'limits'}));
 const bank=normalizeBank(raw),state={...emptyState(),...createPreparation(bank,{subjectId:'math',chapterIds:['limits','derivatives']},seedRandom())};
 return {bank,state};
}
function grade(bank,state,id,correct,round,at=1000,uncertain=false,session=`g${round}`){
 const q=bank.questions.find(q=>q.id===id);
 recordAttempt(state,q,correct?'B':'A',correct,{id:`practice:${session}:${id}`,preparationId:state.preparation.id,
  mode:round===0?'prepare-diagnostic':'prepare-training',practiceId:session,round,sessionSize:Math.min(20,bank.questions.length),at,uncertain});
}
function diagnose(bank,state){for(const id of state.preparation.diagnosticIds)grade(bank,state,id,true,0);}

test('first success masters immediately while independent delayed checks retain review evidence',()=>{
 const {bank,state}=setup(1);grade(bank,state,'q0',true,0);
 assert.equal(preparationMastery(bank,state).mastered,1);
 assert.equal(preparationMetrics(bank,state).progress,100);
 grade(bank,state,'q0',true,0,1001,false,'g0');
 grade(bank,state,'q0',true,1,1002);
 assert.equal(preparationMastery(bank,state).mastered,1);
 grade(bank,state,'q0',true,3,1003);
 assert.equal(preparationMastery(bank,state).mastered,1);
 assert.equal(preparationMastery(bank,state).stableMastered,0);
 grade(bank,state,'q0',false,4,1004);
 assert.equal(preparationMastery(bank,state).passed,0);
 assert.equal(syncPreparationMistakes(bank,state).pendingMistakes,1);
});

test('the next round contains fresh learning and the following round adds at most three older checks',()=>{
 const {bank,state}=setup();diagnose(bank,state);
 const diagnostic=new Set(state.preparation.diagnosticIds);
 const first=createTraining(bank,state,seedRandom(),1001);
 assert.equal(first.questionIds.length,20);assert.deepEqual(first.auditQuestionIds,[]);
 assert.ok(first.questionIds.every(id=>!diagnostic.has(id)));
 state.practice=first;state.preparation.round=first.round;
 first.questionIds.forEach(id=>grade(bank,state,id,true,1,1100));
 const second=createTraining(bank,state,seedRandom(5),1200);
 assert.equal(second.auditQuestionIds.length,3);
 assert.ok(second.auditQuestionIds.every(id=>diagnostic.has(id)));
 assert.ok(second.questionIds.every(id=>!first.questionIds.includes(id)));
 assert.equal(new Set(second.questionIds).size,20);
 assert.ok(second.questionIds.some(id=>bank.questions.find(q=>q.id===id).chapterId==='derivatives'));
 assert.ok(second.questionIds.some(id=>bank.questions.find(q=>q.id===id).chapterId==='limits'));
});

test('hard questions get most checks while a broad random slot still reaches ordinary questions',()=>{
 const {bank,state}=setup();diagnose(bank,state);state.preparation.round=1;
 const hard=new Set(state.preparation.diagnosticIds.slice(0,10));
 state.questionAnnotations=Object.fromEntries(state.preparation.diagnosticIds.map(id=>[id,{stars:hard.has(id)?5:1,concepts:[],method:''}]));
 const random=seedRandom(24);let difficult=0,ordinary=0;
 for(let i=0;i<160;i++){
  const p=createTraining(bank,state,random,1200);
  assert.equal(p.auditQuestionIds.length,3);
  for(const id of p.auditQuestionIds)hard.has(id)?difficult++:ordinary++;
 }
 assert.ok(difficult>ordinary*2);assert.ok(ordinary>0);
});

test('a one-question scope waits instead of forcing a repeat, then permits a next-day check',()=>{
 const {bank,state}=setup(1);diagnose(bank,state);
 assert.equal(trainingCount(bank,state.preparation,state,1001),0);
 assert.throws(()=>createTraining(bank,state,seedRandom(),1001),/暂不重复/);
 const p=createTraining(bank,state,seedRandom(),1000+DAY_MS);
 assert.deepEqual(p.questionIds,['q0']);assert.deepEqual(p.auditQuestionIds,['q0']);
 grade(bank,state,'q0',true,p.round,1000+DAY_MS);
 assert.equal(preparationMastery(bank,state).stableMastered,1);
 assert.equal(preparationTrainingPool(bank,state,1000+DAY_MS+1).count,0);
});

test('uncertain successes still master and resolve mistakes while later failures reopen them',()=>{
 const {bank,state}=setup(1);grade(bank,state,'q0',false,0);
 grade(bank,state,'q0',true,1,1100);
 assert.equal(syncPreparationMistakes(bank,state).mastered,1);
 assert.equal(state.mistakes.q0.resolved,true);
 assert.equal(preparationMetrics(bank,state).trainingScore,100);
 grade(bank,state,'q0',true,3,1200,true);
 assert.equal(preparationMastery(bank,state).mastered,1);
 assert.equal(syncPreparationMistakes(bank,state).mastered,1);
 assert.equal(state.mistakes.q0.resolved,true);
 grade(bank,state,'q0',true,5,1300);
 assert.equal(preparationMastery(bank,state).mastered,1);
 grade(bank,state,'q0',true,7,1400);
 assert.equal(preparationMastery(bank,state).mastered,1);
 grade(bank,state,'q0',false,8,1500);
 assert.equal(syncPreparationMistakes(bank,state).passed,0);
 assert.equal(state.mistakes.q0.resolved,false);
});

test('sample metadata, immediate mastery and review evidence survive backups with source-session deduplication',()=>{
 const {bank,state}=setup();diagnose(bank,state);state.preparation.round=1;
 state.practice=createTraining(bank,state,seedRandom(),1200);state.preparation.round=state.practice.round;
 const restored=validateBackup(JSON.parse(JSON.stringify({format:BACKUP_FORMAT,bank,state})));
 assert.deepEqual(restored.state.practice.auditQuestionIds,state.practice.auditQuestionIds);
 assert.equal(preparationMastery(restored.bank,restored.state).mastered,20);
 const broken=structuredClone(restored.state);broken.practice.auditQuestionIds=['nonexistent'];
 assert.equal(validateBackup({format:BACKUP_FORMAT,bank,state:broken}).state.practice,null);
 const legacy=structuredClone(state);delete legacy.practice.auditQuestionIds;
 assert.ok(validateBackup({format:BACKUP_FORMAT,bank,state:legacy}).state.practice);
});

test('actually cannot solve revises one trial across mastery, notebook, scores, filters, schedules and backups',()=>{
 const {bank,state}=setup(1),q=bank.questions[0];
 state.practice.id='g0';state.practice.responses.q0={answer:'B',correct:true,graded:true};
 state.preparation.session=structuredClone(state.practice);
 grade(bank,state,'q0',true,0);
 // Prime cached indexes before revising the existing result.
 assert.equal(learningProgress([q],state).correct,1);
 assert.equal(spacedReview(bank,state).schedule.get(q.id).streak,1);
 assert.equal(markPreparationIncorrect(bank,state,'q0',1100),true);
 assert.equal(markPreparationIncorrect(bank,state,'q0',1101),false);
 assert.equal(state.attempts.length,1);
 assert.equal(state.attempts[0].correct,false);
 assert.equal(state.practice.responses.q0.correct,false);
 assert.equal(state.preparation.session.responses.q0.correct,false);
 assert.equal(preparationMastery(bank,state).mastered,0);
 assert.equal(preparationMetrics(bank,state).trainingScore,0);
 assert.equal(preparationMastery(bank,state).pendingMistakes,1);
 assert.equal(state.mistakes.q0.wrongCount,1);
 assert.equal(state.mistakes.q0.resolved,false);
 assert.equal(learningProgress([q],state).correct,0);
 assert.equal(spacedReview(bank,state).schedule.get(q.id).streak,0);
 assert.equal(preparationTrends(bank,state,state.preparation.id)[0].accuracy,0);
 assert.deepEqual(practicePool(bank,{status:'unmastered'},state).map(q=>q.id),['q0']);
 assert.equal(preparationTrainingPool(bank,state,1101).fresh.length,1);
 const restored=validateBackup(JSON.parse(JSON.stringify({format:BACKUP_FORMAT,bank,state})));
 assert.equal(preparationMastery(restored.bank,restored.state).mastered,0);
 assert.equal(restored.state.mistakes.q0.resolved,false);
 const before=preparationProfileWeight(bank,state);
 grade(bank,state,'q0',true,1,1200);
 assert.equal(syncPreparationMistakes(bank,state).mastered,1);
 assert.equal(state.mistakes.q0.resolved,true);
 assert.ok(preparationProfileWeight(bank,state)<before);
});

function preparationProfileWeight(bank,state){return preparationProfile(bank,state,1101).weights.get('q0');}

test('actually cannot solve applies to self-graded solutions and never revises an ordinary session',()=>{
 const raw=structuredClone(fixture);raw.questions=[raw.questions.find(q=>q.type==='solution')];
 const bank=normalizeBank(raw),state={...emptyState(),...createPreparation(bank,{subjectId:'math',chapterIds:['limits']})};
 const q=bank.questions[0],p=state.practice;
 p.responses[q.id]={answer:'',correct:true,graded:true};
 recordAttempt(state,q,'',true,{id:`practice:${p.id}:${q.id}`,practiceId:p.id,round:0,
  preparationId:state.preparation.id,mode:p.mode,manual:true,at:1000});
 assert.equal(markPreparationIncorrect(bank,state,q.id,1100),true);
 assert.equal(preparationMastery(bank,state).mastered,0);
 assert.equal(preparationMastery(bank,state).pendingMistakes,1);
 p.responses[q.id].correct=true;p.mode='sequential';
 assert.equal(markPreparationIncorrect(bank,state,q.id,1200),false);
 assert.equal(state.mistakes[q.id].wrongCount,1);
});
