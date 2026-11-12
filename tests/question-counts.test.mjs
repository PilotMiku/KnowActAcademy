import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeBank, getBankIndex } from '../dist/core.mjs';
import { questionCounts, questionCountDescription } from '../dist/question-counts.mjs';

test('all site, subject and chapter counts agree with a fresh independent recount', async () => {
  const bank = normalizeBank(JSON.parse(await readFile('dist/data/bank.json', 'utf8')));
  const report = JSON.parse(await readFile('data/question-counts.json', 'utf8'));
  const index = getBankIndex(bank);
  assert.deepEqual(questionCounts(bank.questions), report.counts);
  let total = 0;
  for (const subject of report.subjects) {
    assert.deepEqual(questionCounts(index.subjectQuestions.get(subject.id)), subject.counts);
    let roots = 0;
    for (const chapter of subject.chapters) {
      assert.deepEqual(questionCounts(index.chapterQuestions.get(subject.id).get(chapter.id)), chapter.counts);
      if (!chapter.parentId) roots += chapter.counts.total;
    }
    assert.equal(roots, subject.counts.total);
    total += roots;
  }
  assert.equal(total, bank.questions.length);
  assert.equal(report.sources.originalPdf + report.sources.supplementEntries - report.sources.previouslyMerged, total);
  assert.match(questionCountDescription(bank.questions), /未确认等价的相似题分别保留/);
});

test('overlapping scopes count each ID once while keeping similar records with different IDs', () => {
  const q = { id: 'a', stem: '相同题干', source: { format: 'pdf' } };
  const similar = { ...q, id: 'b', source: { format: 'html' }, sourceIncomplete: true };
  assert.deepEqual(questionCounts([q, q, similar]), { total: 2, pdf: 1, supplement: 1, other: 0, scorable: 1 });
  assert.deepEqual(questionCounts([]), { total: 0, pdf: 0, supplement: 0, other: 0, scorable: 0 });
  assert.equal(questionCounts([{ id: 'custom' }]).other, 1);
});
