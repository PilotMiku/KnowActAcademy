import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBank, emptyState, validateBackup } from '../dist/core.mjs';
import { loadQuestionContent, loadedQuestion, materializeBank } from '../dist/question-content.mjs';
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
