import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeBank, isScorable, judge, recordAttempt, emptyState, examQuestions } from '../dist/core.mjs';
const raw=JSON.parse(readFileSync('dist/data/bank.json','utf8'));
const reviews=JSON.parse(readFileSync('data/question-reviews.json','utf8')).entries;
const bank=normalizeBank(raw), byId=new Map(bank.questions.map(q=>[q.id,q]));

test('source-bound reviews apply corrected keys and honor grading eligibility',()=>{
  const state=emptyState(), exams=new Set(examQuestions(bank).map(q=>q.id));
  for(const [id,row] of Object.entries(reviews)){
    const q=byId.get(id);
    assert.equal(q.answer,row.correctedAnswer ?? row.referenceAnswer,id);
    assert.equal(q.source.sha256,row.sourceSha256,id);
    if(row.correctedAnswer){
      assert.equal(judge(q,row.correctedAnswer),true,id);
      assert.equal(judge(q,row.referenceAnswer),false,id);
    }
    if(row.assessment==='review-only'){
      assert.equal(isScorable(q),false,id);
      assert.equal(exams.has(id),false,id);
      for(const option of q.options) assert.equal(judge(q,option.id),null,id);
      assert.equal(recordAttempt(state,q,q.answer,true),false,id);
    }
  }
  assert.equal(state.attempts.length,0);
});

test('restored stems retain their source intervals and requested quantities',()=>{
  for(const id of ['u-calculus-cb9b4ad5c9479e2b','u-calculus-c3a0c221ffbf26a2']){
    const q=byId.get(id);assert.match(q.stem,/最大值/);assert.match(q.stem,/\\\(\[/);
    assert.equal(isScorable(q),true);
  }
  assert.match(byId.get('u-calculus-e8566906ec7c7f85').analysis,/alpha=-3/);
  assert.match(byId.get('u-calculus-a43245867d0f68fe').analysis,/当前选项 C/);
});
