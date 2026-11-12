import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBank, emptyState, recordAttempt, validateBackup, BACKUP_FORMAT } from '../dist/core.mjs';
import { questionGuidance } from '../dist/question-guidance.mjs';
import { getConceptIndex } from '../dist/concepts.mjs';
import { learningSummary } from '../dist/learning-summary.mjs';
import { validateExamDesign, drawExam } from '../dist/exam-design.mjs';
import { collectionQueue, practicePool } from '../dist/study-planning.mjs';
import { mathReferences } from '../dist/math-reference.mjs';

const bank = () => normalizeBank({ subjects:[{id:'s',name:'测试',chapters:[{id:'a',name:'A',children:[{id:'a1',name:'A1'}]},{id:'b',name:'B'}]}],
  questions:Array.from({length:6},(_,i)=>({id:'q'+i,subjectId:'s',chapterId:i<3?'a1':'b',type:'single',stem:'test '+i,options:[{id:'A',text:'A'},{id:'B',text:'B'}],answer:'A'})) });

test('new learning records roundtrip with old backups defaulting empty and malformed fields rejected',()=>{
  const b=bank(),s=emptyState();
  s.questionFeedback.q0={kind:'formula',text:'<script>personal</script>',status:'reviewed',updatedAt:1};
  s.questionAnnotations.q0={difficulty:'hard',concepts:['公式转换'],method:'个人方法',updatedAt:2};
  s.examTemplates=[{id:'t',name:'章节配比',subjectId:'s',chapters:null,count:3,minutes:10,allocation:[{subjectId:'s',chapterId:'a',count:2},{subjectId:'s',chapterId:'b',count:1}],updatedAt:3}];
  s.readingHistory=[{id:'article',at:4}];
  const restored=validateBackup({format:BACKUP_FORMAT,bank:b,state:s});
  assert.deepEqual(restored.state.questionFeedback,s.questionFeedback);assert.deepEqual(restored.state.questionAnnotations,s.questionAnnotations);
  assert.deepEqual(restored.state.examTemplates,s.examTemplates);assert.deepEqual(restored.state.readingHistory,s.readingHistory);
  const old=structuredClone(s);delete old.questionFeedback;delete old.questionAnnotations;delete old.examTemplates;
  assert.deepEqual(validateBackup({format:BACKUP_FORMAT,bank:b,state:old}).state.examTemplates,[]);
  assert.throws(()=>validateBackup({format:BACKUP_FORMAT,bank:b,state:{...s,questionFeedback:{missing:s.questionFeedback.q0}}}));
  assert.throws(()=>validateBackup({format:BACKUP_FORMAT,bank:b,state:{...s,questionAnnotations:{q0:{...s.questionAnnotations.q0,concepts:['x'.repeat(100)]}}}}));
});

test('manual metadata changes filtering and concept association without rewriting source questions',()=>{
  const b=bank(),s=emptyState(),before=JSON.stringify(b);
  s.questionAnnotations={q0:{difficulty:'hard',concepts:['换元'],method:'test',updatedAt:1}};
  assert.deepEqual(practicePool(b,{difficulty:'hard',concept:'换元'},s).map(q=>q.id),['q0']);
  assert.deepEqual(getConceptIndex(b,s.questionAnnotations).questions.get('q0'),['换元']);
  s.questionAnnotations={q0:{difficulty:'easy',concepts:['积分'],method:'test',updatedAt:2}};
  assert.deepEqual(getConceptIndex(b,s.questionAnnotations).questions.get('q0'),['积分']);
  assert.equal(JSON.stringify(b),before);
  assert.equal(questionGuidance({...b.questions[0],source:{format:'pdf'}}).difficulty,'unrated');
});

test('coverage and latest accuracy resist repeated easy questions; next-day confirmation resets after an error',()=>{
  const b=bank(),s=emptyState(),q=b.questions[0];
  const first=new Date(2026,0,1,12).getTime();
  recordAttempt(s,q,'A',true,{at:first});recordAttempt(s,q,'A',true,{at:first+100});
  let summary=learningSummary(b,s).subjects[0];
  assert.equal(summary.covered,1);assert.equal(summary.accuracy,100);assert.equal(summary.stable,0);
  recordAttempt(s,q,'A',true,{at:first+86400000});
  assert.equal(learningSummary(b,s).subjects[0].stable,1);
  recordAttempt(s,q,'B',false,{at:first+86401000});
  summary=learningSummary(b,s).subjects[0];assert.equal(summary.stable,0);assert.equal(summary.accuracy,0);assert.equal(summary.covered,1);
});

test('chapter quotas draw exact amounts without duplicates and reject overfilled or malformed templates',()=>{
  const b=bank(),design={subjectId:'s',chapters:null,count:4,minutes:20,allocation:[{subjectId:'s',chapterId:'a',count:3},{subjectId:'s',chapterId:'b',count:1}]};
  const selected=drawExam(b,design,()=>0.2);
  assert.equal(new Set(selected.map(q=>q.id)).size,4);assert.equal(selected.filter(q=>q.chapterId==='a1').length,3);
  assert.throws(()=>validateExamDesign({...design,count:3},b));
  assert.throws(()=>validateExamDesign({...design,allocation:[{subjectId:'s',chapterId:'a',count:4}]},b));
  assert.throws(()=>validateExamDesign({...design,allocation:[design.allocation[0],design.allocation[0]]},b));
});

test('collection filters are shared by preview, batch practice and export queues',()=>{
  const b=bank(),s=emptyState();
  for(const q of b.questions.slice(0,3)){recordAttempt(s,q,'B',false);recordAttempt(s,q,'B',false);}
  s.questionNotes={q0:{text:'review',reasons:['calculation'],updatedAt:1},q1:{text:'',reasons:['concept'],updatedAt:1}};
  assert.deepEqual(collectionQueue(b,{reason:'calculation',notes:true,repeated:true},s,'review').map(q=>q.id),['q0']);
});

test('new reference cards cover exactly the seventeen existing root chapters',()=>{
  assert.equal(mathReferences.length,17);assert.equal(new Set(mathReferences.map(r=>r.subjectId+':'+r.chapterId)).size,17);
});
