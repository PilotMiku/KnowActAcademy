import { isScorable } from './core.mjs';

// Count saved question IDs, never source pages, option images or parent + child
// totals. Similar records stay separate until their equivalence is confirmed.
const cache = new WeakMap();
export function questionCounts(questions) {
  if (cache.has(questions)) return cache.get(questions);
  const result = { total: 0, pdf: 0, supplement: 0, other: 0, scorable: 0 };
  const seen = new Set();
  for (const q of questions) {
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    result.total++;
    result[q.source?.format === 'pdf' ? 'pdf' : q.source?.format === 'html' ? 'supplement' : 'other']++;
    if (isScorable(q)) result.scorable++;
  }
  cache.set(questions, result);
  return result;
}

export function questionCountDescription(questions) {
  const counts = questionCounts(questions);
  const parts = [];
  if (counts.pdf) parts.push(`PDF ${counts.pdf.toLocaleString()} 题`);
  if (counts.supplement) parts.push(`补充 ${counts.supplement.toLocaleString()} 题`);
  if (counts.other) parts.push(`其他来源 ${counts.other.toLocaleString()} 题`);
  const quality = counts.total > counts.scorable ? `其中 ${counts.scorable.toLocaleString()} 题可评分，${counts.total - counts.scorable} 题仅供查阅；` : '';
  return `按题号统计 ${counts.total.toLocaleString()} 条记录${parts.length ? `（${parts.join('、')}）` : ''}；${quality}未确认等价的相似题分别保留。`;
}
