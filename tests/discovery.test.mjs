import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterQuestions, normalizeBank } from '../dist/core.mjs';
import { questionExcerpt, highlightedText, paginationHTML } from '../dist/question-discovery.mjs';

test('preview preserves a complete formula and removes repeated source metadata', () => {
  const formula = '\\(\\frac{x^2+1}{x-1}\\)';
  assert.equal(questionExcerpt({ sourceLabel: '来源', searchText: `来源 求 ${formula} 的极限` }, 10), `求 ${formula}…`);
});
test('search highlight treats query and question text as untrusted prose, preserving TeX', () => {
  assert.equal(highlightedText('<img> a.b aXb', 'a.b'), '&lt;img&gt; <mark>a.b</mark> aXb');
  assert.equal(highlightedText('求 x，公式 \\(x+1\\)', 'x'), '求 <mark>x</mark>，公式 \\(x+1\\)');
});
test('pagination preserves search and chapter and reaches the last page', () => {
  const html = paginationHTML(2, 51, new URLSearchParams({ q: '极限', chapter: 'c' }));
  assert.match(html, /page=3/);
  assert.match(html, /chapter=c/);
  assert.match(html, /aria-current="page">2/);
});

test('bundled question search resolves compact source numbers, IDs and course terminology', () => {
  const bank = normalizeBank(JSON.parse(readFileSync(new URL('../dist/data/bank.json', import.meta.url))));
  const ids = (search) => filterQuestions(bank, { search }).map(q => q.id);
  assert.deepEqual(ids('３．５：第２３题'), ['s-5213d062494c-q0023']);
  assert.deepEqual(ids('s-5213d062494c-q0023'), ['s-5213d062494c-q0023']);
  assert.ok(ids('第23题').length > 30);
  for (const [alias, name] of [['函数最值', '函数的最值'], ['变上限积分', '积分上限'], ['罗尔定理', 'Roll定理']]) {
    assert.ok(ids(alias).length > 0, alias);
    assert.deepEqual(ids(alias), ids(name), alias);
  }
});
