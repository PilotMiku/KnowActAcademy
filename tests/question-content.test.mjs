import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBank, emptyState, validateBackup } from '../dist/core.mjs';
import { loadQuestionContent, loadedQuestion, materializeBank, prefetchNextQuestions } from '../dist/question-content.mjs';
import { createBackup } from '../dist/backup-codec.mjs';
import { fixture } from './fixture.mjs';

function setup() {
  const raw = { ...structuredClone(fixture), revision: 'pdf-abcd', managedBundle: true };
  raw.questions = raw.questions.slice(0, 2);
  raw.questions[0].provenance = { note: '原始来源' };
  const chunk = '1234567890abcdef';
  const catalog = { ...raw, contentCatalog: { format: 'zhixing.question-catalog.v1', revision: raw.revision },
    questions: raw.questions.map(q => ({ ...q, stem: '目录占位', analysis: '',
      options: q.options.map(o => ({ id: o.id, text: o.id })), contentChunk: chunk })) };
  return { raw, catalog, bank: normalizeBank(catalog, { allowCatalog: true }), chunk };
}
test('catalogs support planning and progress backups while full exports preserve the original question', async () => {
  const { raw, catalog, bank, chunk } = setup();
  assert.throws(() => normalizeBank(catalog), /不能作为完整题库/);
  assert.throws(() => createBackup(bank, emptyState()), /需要完整题库/);
  const light = createBackup(bank, emptyState(), true);
  assert.equal(validateBackup(light, bank).bank.contentCatalog.revision, bank.revision);
  assert.equal(loadedQuestion(bank, raw.questions[0].id), undefined);
  let requests = 0;
  await loadQuestionContent(bank, raw.questions.map(q => q.id), async url => {
    requests++; assert.equal(url, `./question-content/${chunk}.json`);
    return { format: 'zhixing.question-chunk.v1', revision: raw.revision, questions: raw.questions };
  });
  assert.equal(requests, 1);
  assert.equal(loadedQuestion(bank, raw.questions[0].id).stem, raw.questions[0].stem);
  assert.equal(bank.questions[0].stem, '目录占位');
  const full = await materializeBank(bank, async () => raw);
  assert.deepEqual(full.questions[0].original, raw.questions[0]);
  assert.deepEqual(validateBackup(createBackup(full, emptyState())).bank.questions, full.questions);
});

test('next-question speculation reuses chunks, leaves source records intact and honors data saving', async () => {
  const { raw, bank } = setup(), before=JSON.stringify(bank);
  let calls=0;
  const request=async () => { calls++; return {format:'zhixing.question-chunk.v1',revision:raw.revision,questions:raw.questions}; };
  const session={index:0,questionIds:raw.questions.map(q=>q.id)};
  await prefetchNextQuestions(bank,session,request,{saveData:true});
  assert.equal(calls,0);
  await prefetchNextQuestions(bank,session,request,{});
  assert.equal(calls,1);
  assert.equal(loadedQuestion(bank,session.questionIds[1]).stem,raw.questions[1].stem);
  await loadQuestionContent(bank,[session.questionIds[1]],request);
  assert.equal(calls,1);
  assert.equal(JSON.stringify(bank),before);
});

test('prefetch cannot evict the displayed body when a long question history fills the cache', async () => {
  const { raw, chunk } = setup();
  raw.questions = Array.from({length:260},(_,i)=>({...raw.questions[0],id:'q'+i}));
  const bank=normalizeBank({...raw,contentCatalog:{format:'zhixing.question-catalog.v1',revision:raw.revision},
    questions:raw.questions.map(q=>({...q,stem:'placeholder',analysis:'',contentChunk:chunk}))},{allowCatalog:true});
  const request=async()=>({format:'zhixing.question-chunk.v1',revision:raw.revision,questions:raw.questions});
  await loadQuestionContent(bank,raw.questions.map(q=>q.id),request);
  await prefetchNextQuestions(bank,{index:0,questionIds:raw.questions.map(q=>q.id)},request,{});
  assert.equal(loadedQuestion(bank,'q0').stem,raw.questions[0].stem);
});

test('prefetch loads both upcoming questions and their figures, and retries failures', async () => {
  const { raw, chunk } = setup();
  const version = '1122334455667788', first = 'a'.repeat(24), second = 'b'.repeat(24);
  raw.questions = Array.from({length:4}, (_, index) => ({
    ...structuredClone(raw.questions[0]), id:'next-' + index,
    stem: index === 1 ? '<img src="/api/question-figure/' + version + '/' + first + '">' : '题干',
  }));
  raw.questions[2].options[0].text = '<img src="/api/question-figure/' + version + '/' + second + '">';
  const bank = normalizeBank({...raw, contentCatalog:{format:'zhixing.question-catalog.v1',revision:raw.revision},
    questions:raw.questions.map(q=>({...q,stem:'placeholder',contentChunk:chunk}))},{allowCatalog:true});
  const request = async () => ({format:'zhixing.question-chunk.v1',revision:raw.revision,questions:raw.questions});
  const session = {index:0,questionIds:raw.questions.map(q=>q.id)};
  const figures = [];
  let fail = true;
  const loadFigure = async (id, base, transport, figureVersion) => {
    figures.push([id,figureVersion]);
    if (id === second && fail) { fail = false; throw new Error('temporary failure'); }
  };
  await prefetchNextQuestions(bank, session, request, {}, loadFigure);
  assert.ok(loadedQuestion(bank,'next-1'));
  assert.ok(loadedQuestion(bank,'next-2'));
  assert.equal(loadedQuestion(bank,'next-3'),undefined);
  await prefetchNextQuestions(bank, session, request, {}, loadFigure);
  assert.deepEqual(figures,[[first,version],[second,version],[first,version],[second,version]]);
});

test('failed, mismatched and cancelled content loads cannot install partial or wrong answers', async () => {
  const { raw, bank } = setup(), id = raw.questions[0].id;
  const wrong = structuredClone(raw.questions); wrong[0].answer = 'A';
  await assert.rejects(loadQuestionContent(bank, [id], async () => ({ format: 'zhixing.question-chunk.v1', revision: raw.revision, questions: wrong })), /不匹配/);
  assert.equal(loadedQuestion(bank, id), undefined);
  const controller = new AbortController(); controller.abort();
  const request = async () => ({ format: 'zhixing.question-chunk.v1', revision: raw.revision, questions: raw.questions });
  await assert.rejects(loadQuestionContent(bank, [id], request, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(loadedQuestion(bank, id), undefined);
  await loadQuestionContent(bank, [id], request);
  assert.equal(loadedQuestion(bank, id).answer, 'B');
  await assert.rejects(materializeBank(bank, async () => ({ ...raw, revision: 'pdf-ffff' })), /版本已变化/);
});
