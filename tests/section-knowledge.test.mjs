import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeBank,emptyState} from '../dist/core.mjs';
import {sectionKnowledge,sectionKnowledgeCard,sectionCardsForBank} from '../dist/section-knowledge.mjs';
import {filteredSectionCards,sectionReferencePage} from '../dist/section-reference.mjs';
import {questionLearningCards} from '../dist/question-learning.mjs';

const raw = JSON.parse(readFileSync('dist/data/bank.json','utf8'));
const bank = normalizeBank(raw), state = emptyState();
test('all 182 actual subsections have one distinct complete knowledge card', () => {
  const expected = bank.subjects.flatMap(s=>s.chapters.filter(c=>c.parentId).map(c=>s.id+':'+c.id));
  assert.equal(expected.length,182);
  assert.deepEqual(sectionKnowledge,JSON.parse(readFileSync('data/section-knowledge.json','utf8')).sections);
  const actual = sectionKnowledge.map(c=>c.subjectId+':'+c.sectionId);
  assert.equal(new Set(actual).size,actual.length);
  assert.deepEqual([...actual].sort(),expected.sort());
  assert.equal(sectionCardsForBank(bank).length,182);
  assert.equal(sectionCardsForBank(raw).length,182);
  for(const row of sectionKnowledge) {
    const section = bank.subjects.find(s=>s.id===row.subjectId).chapters.find(c=>c.id===row.sectionId);
    assert.equal(row.chapterId,section.parentId);
    assert.equal(row.sourceTitle,section.name);
    for(const key of ['overview','formula','condition','example','warning']) assert.ok(row[key].length>=8,row.title+' '+key);
  }
});
test('every bundled question can retrieve its own subsection without rewriting sources', () => {
  const snapshot = JSON.stringify(raw);
  for(const subject of bank.subjects) for(const section of subject.chapters.filter(c=>c.parentId)) {
    const question = bank.questions.find(q=>q.subjectId===subject.id&&q.chapterId===section.id)
      ?? {...bank.questions[0],id:'empty-section-'+section.id,subjectId:subject.id,chapterId:section.id};
    const cards = questionLearningCards(question,bank,state);
    const current = cards.find(card=>card.sectionId===section.id);
    assert.ok(current,section.name);
    assert.equal(current.association,'小节关联 · 本站整理');
    assert.equal(current.chapterId,section.parentId);
  }
  assert.equal(JSON.stringify(raw),snapshot);
});
test('section lookup is isolated by subject, chapter and catalog title', () => {
  assert.equal(sectionKnowledgeCard('linear','s-6b82188494c1'),null);
  const custom = {subjects:[{id:'calculus',chapters:[{id:'s-6b82188494c1',parentId:'chapter-1',name:'自定义其他主题'}]}]};
  assert.deepEqual(sectionCardsForBank(custom),[]);
});
test('knowledge search and chapter filters preserve exact scope', () => {
  assert.equal(filteredSectionCards(bank,new URLSearchParams('subject=linear')).length,17);
  const functions = filteredSectionCards(bank,new URLSearchParams('subject=calculus&chapter=chapter-1'));
  assert.equal(functions.length,18);
  assert.ok(filteredSectionCards(bank,new URLSearchParams('q=雅可比')).some(c=>c.sectionId==='u-section-907837c0c53c'));
  assert.deepEqual(filteredSectionCards(bank,new URLSearchParams('subject=linear&chapter=chapter-1')),[]);
  assert.match(sectionReferencePage(bank,new URLSearchParams('section=missing')),/没有找到/);
  assert.ok(!sectionReferencePage(bank,new URLSearchParams('q=%3Cscript%3Ealert(1)%3C%2Fscript%3E')).includes('<script>'));
  const curvature = sectionCardsForBank(bank).filter(c=>c.chapterId==='chapter-3').slice(-2);
  assert.match(curvature[0].title,/3\.8\.1/);
  assert.match(curvature[1].title,/3\.8\.2/);
});
test('every authored subsection formula renders with the deployed math engine', () => {
  const context={module:{exports:{}}};context.exports=context.module.exports;
  vm.runInNewContext(readFileSync('dist/vendor/katex/katex.min.js','utf8'),context);
  let count=0;
  for(const row of sectionKnowledge) {
    const content = [row.formula, row.condition, row.example, row.warning,
      ...(row.exercises ?? []).flatMap(({prompt, solution}) => [prompt, solution])];
    for(const text of content) for(const match of text.matchAll(/\$([^$]+)\$/g)) {
      assert.doesNotThrow(()=>context.module.exports.renderToString(match[1],{throwOnError:true,trust:false,strict:'ignore'}),row.title);
      count++;
    }
  }
  assert.ok(count>500);
});
