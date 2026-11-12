import test from 'node:test';
import assert from 'node:assert/strict';
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
