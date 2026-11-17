import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {supplementalAnalyses, supplementalAnalysis, analysisReview} from '../dist/supplemental-analysis.mjs';
import {normalizeBank, isScorable, judge, examQuestions} from '../dist/core.mjs';
import {preparationQuestions} from '../dist/preparation.mjs';

const raw = JSON.parse(readFileSync('dist/data/bank.json','utf8'));
const bank = normalizeBank(raw);
const records = JSON.parse(readFileSync('data/supplemental-analysis.json','utf8')).entries;
test('all source-missing explanations are accounted for, with unresolved material distinguished', () => {
  assert.deepEqual(supplementalAnalyses,records);
  const missing = bank.questions.filter(q => q.analysisMissing);
  assert.equal(missing.length,60);
  const statuses = {};
  for (const question of missing) {
    const row = supplementalAnalysis(question);
    assert.ok(row,question.id);
    statuses[row.status] = (statuses[row.status] || 0) + 1;
    assert.ok(row.body.length > 90,question.id);
    assert.equal(row.referenceAnswer,question.answer);
    // Authoring does not rewrite any source explanation or answer.
    assert.equal(question.analysis,raw.questions.find(q => q.id === question.id).analysis);
  }
  assert.deepEqual(statuses,{verified:55,partial:1,unresolved:2,review:2});
});
test('explanations and grading exclusions follow the exact source through catalog hydration', () => {
  const review = bank.questions.find(q => q.id === 'u-calculus-14122fde4a7eb48c');
  assert.ok(analysisReview(review));
  const catalog = {...review,stem:'catalog',analysis:'',source:{format:'html'},contentChunk:'1234567890abcdef'};
  assert.deepEqual(supplementalAnalysis(catalog),supplementalAnalysis(review));
  assert.equal(isScorable(catalog),false);
  assert.equal(supplementalAnalysis({...review,source:{format:'html'}}),null);
  assert.equal(supplementalAnalysis({...review,source:{...review.source,sha256:'different'}}),null);
  assert.equal(supplementalAnalysis({...review,analysisMissing:false}),null);
  assert.equal(supplementalAnalysis({...review,answer:'A'}),null);
});
test('equivalent-option and inconsistent-answer source questions cannot penalize a learner', () => {
  const ids = ['u-calculus-67154e9abf199a16','u-calculus-14122fde4a7eb48c'];
  for (const id of ids) {
    const q = bank.questions.find(q => q.id === id);
    assert.equal(isScorable(q),false);
    for (const option of q.options) assert.equal(judge(q,option.id),null);
    assert.ok(!examQuestions(bank).some(q => q.id === id));
    assert.ok(!preparationQuestions(bank,{subjectId:q.subjectId,chapterIds:[q.chapterId]}).some(q => q.id === id));
  }
});
test('every authored formula parses with the shipped math renderer', () => {
  const context = {module:{exports:{}}}; context.exports = context.module.exports;
  vm.runInNewContext(readFileSync('dist/vendor/katex/katex.min.js','utf8'),context);
  let count = 0;
  for (const [id,row] of Object.entries(records)) {
    for (const match of row.body.matchAll(/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g)) {
      const math = (match[1] || match[2]).replaceAll('&lt;','<').replaceAll('&gt;','>');
      assert.doesNotThrow(() => context.module.exports.renderToString(math,{throwOnError:true,trust:false,strict:'ignore'}),id+' '+math);
      count++;
    }
  }
  assert.ok(count > 180);
});
