import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeBank, emptyState, validateBackup, BACKUP_FORMAT} from '../dist/core.mjs';
import {questionGuidance, normalizeQuestionAnnotations, difficultyBadge} from '../dist/question-guidance.mjs';
import {estimatedDifficulty} from '../dist/question-difficulty.mjs';
import {practicePool, collectionQueue} from '../dist/study-planning.mjs';
import {readableFormulas, readableFormula} from '../dist/readable-formulas.mjs';
import {favoriteButton} from '../dist/favorite-button.mjs';
const raw=JSON.parse(readFileSync('dist/data/bank.json','utf8'));

test('every bundled question has a source-bound star estimate before and after hydration',()=>{
  const before=JSON.stringify(raw);
  assert.equal(estimatedDifficulty({id:'toString'}),null);
  assert.equal(questionGuidance({id:'toString',difficulty:'medium'}).stars,3);
  const distribution = new Map();
  for(const q of raw.questions){
    const value=estimatedDifficulty(q);
    assert.ok(value && value.stars>=1 && value.stars<=5 && Number.isInteger(value.stars),q.id);
    assert.deepEqual(estimatedDifficulty({...q,source:{format:q.source.format},contentChunk:'1234567890abcdef'}),value);
    assert.equal(estimatedDifficulty({...q,source:{...q.source,sha256:'changed'}}),null);
    assert.equal(estimatedDifficulty({...q,source:{format:q.source.format}}),null);
    const guide=questionGuidance(q);
    assert.ok(guide.stars>=1 && guide.stars<=5);
    distribution.set(guide.stars, (distribution.get(guide.stars) ?? 0) + 1);
    assert.match(difficultyBadge(q),/aria-label="[1-5]\/5 星/);
  }
  assert.equal(distribution.size, 5);
  assert.ok((distribution.get(2) ?? 0) < raw.questions.length / 2);
  assert.equal(JSON.stringify(raw),before);
});

test('personal stars survive backups and drive practice and collection filters',()=>{
  const bank=normalizeBank({...raw,questions:raw.questions.slice(0,3)}),state=emptyState(),id=bank.questions[0].id;
  state.questionAnnotations[id]={difficulty:'hard',stars:5,concepts:[],method:'个人判断',updatedAt:1};
  state.favorites=[id];
  assert.deepEqual(validateBackup({format:BACKUP_FORMAT,bank,state}).state.questionAnnotations,state.questionAnnotations);
  assert.equal(questionGuidance(bank.questions[0],state.questionAnnotations).stars,5);
  assert.deepEqual(practicePool(bank,{difficulty:'5'},state).map(q=>q.id),[id]);
  assert.deepEqual(collectionQueue(bank,{difficulty:'5'},state,'favorites').map(q=>q.id),[id]);
  assert.equal(practicePool(bank,{difficulty:'1'},state).some(q=>q.id===id),false);
  assert.throws(()=>normalizeQuestionAnnotations({[id]:{...state.questionAnnotations[id],stars:6}},new Set([id])));
  assert.throws(()=>normalizeQuestionAnnotations({[id]:{...state.questionAnnotations[id],difficulty:'easy'}},new Set([id])));
  const legacy={...state.questionAnnotations[id]};delete legacy.stars;
  assert.equal(questionGuidance(bank.questions[0],{[id]:legacy}).stars,4);
});

test('readable formulas require the exact original pack and parse in the shipped renderer',()=>{
  const context={module:{exports:{}}};context.exports=context.module.exports;
  vm.runInNewContext(readFileSync('dist/vendor/katex/katex.min.js','utf8'),context);
  for(const [id,row] of Object.entries(readableFormulas)){
    assert.equal(readableFormula(id,row.version),row.latex);
    assert.equal(readableFormula(id,'different-source'),null);
    assert.doesNotThrow(()=>context.module.exports.renderToString(row.latex,{throwOnError:true,trust:false}),id);
  }
});

test('favorite controls have explicit persistent state and visible labels',()=>{
  assert.match(favoriteButton('x',true),/class="icon-btn favorite-button is-favorite"/);
  assert.match(favoriteButton('x',true),/aria-pressed="true"/);
  assert.match(favoriteButton('x',true),/已收藏/);
  assert.match(favoriteButton('x'),/aria-pressed="false"/);
  assert.doesNotMatch(favoriteButton('x'),/is-favorite/);
});
