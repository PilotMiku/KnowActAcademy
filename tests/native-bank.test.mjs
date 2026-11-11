import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {normalizeBank} from '../dist/core.mjs';

const read=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const bank=read('../dist/data/bank.json');
const original=read('../data/pdf-source-bank.json');
const manifest=read('../dist/data/manifest.json');

test('unified bank retains original identities, answer keys and section references',()=>{
  const normalized=normalizeBank(bank), questions=new Map(normalized.questions.map(q=>[q.id,q]));
  assert.equal(bank.contentMode,'native');
  assert.equal(bank.revision,manifest.revision);
  assert.equal(bank.questions.length,manifest.questions);
  assert.ok(bank.questions.length>original.questions.length);
  for(const old of original.questions){
    const q=questions.get(old.id);assert.ok(q,old.id);
    assert.equal(q.answer,old.answer,old.id);
    assert.equal(q.subjectId,old.subjectId,old.id);
    assert.equal(q.chapterId,old.chapterId,old.id);
    assert.deepEqual(q.options.map(o=>o.id),old.options.map(o=>o.id),old.id);
  }
  for(const q of bank.questions){
    assert.ok(q.stem.trim()&&q.analysis.trim(),q.id);
    assert.ok(q.options.every(o=>o.text.trim()),q.id);
    assert.ok(q.options.every(o=>!o.text.includes('未提供可用解析')),q.id+' options must not use an analysis placeholder');
    if(q.sourceIncomplete){
      assert.match(q.stem,/原始资料有缺损/);
      assert.equal(q.answerVerified,false);
    }
    assert.match(q.source.url,/^https:\/\/github\.com\/PilotMiku\/KnowActAcademy\/blob\/main\//);
    assert.doesNotMatch([q.stem,q.analysis,...q.options.map(o=>o.text)].join(''),/api\/question-image\//);
  }
});

test('every published LaTeX expression renders with the deployed KaTeX',()=>{
  const context={module:{exports:{}}};context.exports=context.module.exports;
  vm.runInNewContext(readFileSync(new URL('../dist/vendor/katex/katex.min.js',import.meta.url),'utf8'),context);
  const katex=context.module.exports,seen=new Set();
  const decode=s=>s.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g,e=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#x27;':"'",'&#39;':"'"}[e]));
  for(const q of bank.questions)for(const text of [q.stem,q.analysis,...q.options.map(o=>o.text)]){
    for(const match of decode(text).matchAll(/\\\(([\s\S]*?)\\\)/g)){
      if(seen.has(match[1]))continue;
      assert.doesNotThrow(()=>katex.renderToString(match[1],{throwOnError:true,trust:false,strict:'ignore',maxExpand:500,maxSize:10,output:'mathml'}),q.id+' '+match[1]);
      seen.add(match[1]);
    }
  }
  assert.ok(seen.size>10000);
});
