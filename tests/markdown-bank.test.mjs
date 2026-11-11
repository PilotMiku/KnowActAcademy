import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

test('chapter Markdown covers every stable question once and keeps OCR review warnings',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const bank=JSON.parse(readFileSync(path.join(root,'dist/data/bank.json'),'utf8'));
  const report=JSON.parse(readFileSync(path.join(root,'data/markdown-transcription-report.json'),'utf8'));
  const directory=path.join(root,'question-bank-markdown');
  const ids=[];
  for(const chapter of report.chapters){
    const text=readFileSync(path.join(directory,chapter.file),'utf8');
    const found=[...text.matchAll(/题目 ID：`([^`]+)`/g)].map(m=>m[1]);
    assert.equal(found.length,chapter.questions,chapter.file);
    assert.match(text,/可渲染并不表示已核实题意/);
    assert.doesNotMatch(text,/<img\b|\/api\/question-(?:image|figure)\//);
    ids.push(...found);
  }
  assert.equal(report.revision,bank.revision);
  assert.equal(ids.length,bank.questions.length);
  assert.equal(new Set(ids).size,ids.length);
  assert.deepEqual(ids.sort(),bank.questions.map(q=>q.id).sort());
  assert.ok(report.questionsWithCompleteRenderableText>7000);
});
