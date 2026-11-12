import { textOnly } from './core.mjs';
import { esc, attr } from './ui.mjs';

// Keep complete math spans so truncation never leaves an unclosed formula.
export function questionExcerpt(question, limit = 240) {
  let text = question.previewText || textOnly(question.searchText || question.stem);
  if (!question.previewText) text = text.replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, value => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[value]);
  if (question.sourceLabel && text.startsWith(question.sourceLabel)) text = text.slice(question.sourceLabel.length).trim();
  const tokens = text.match(/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|[\s\S]/g) || [];
  let result = '';
  for (const token of tokens) {
    if (result.length >= limit) return result.trim() + '…';
    result += token;
  }
  return result.trim();
}

export function highlightedText(text, query = '') {
  const needle = query.trim();
  if (!needle) return esc(text);
  const expression = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  // Highlight prose only; injecting markup into TeX would invalidate formulas.
  return String(text).split(/(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g)
    .map((part, i) => i % 2 ? esc(part) : part.split(expression).map((plain, j, pieces) =>
      esc(plain) + (j < pieces.length - 1 ? `<mark>${esc(part.match(expression)[j])}</mark>` : '')).join('')).join('');
}

export function questionPreviewHTML(question, query = '') {
  const excerpt = questionExcerpt(question);
  return `<div class="question-excerpt rich" data-rich="${attr('<p>' + highlightedText(excerpt || '本题包含题图，可打开预览查看。', query) + '</p>')}"></div>${question.previewHasImages || /<img\b/i.test(question.stem) ? '<small class="preview-image-note">含题图或原式图片，打开预览查看完整题干</small>' : ''}`;
}

export function paginationHTML(page, total, query, route = 'practice', size = 20) {
  const pages = Math.max(1, Math.ceil(total / size));
  const href = number => { const next = new URLSearchParams(query); next.set('page', number); return `#/${route}?${next}`; };
  const visible = [...new Set([1, page - 1, page, page + 1, pages].filter(n => n >= 1 && n <= pages))].sort((a, b) => a - b);
  return `<nav class="question-pagination" aria-label="题目分页">${page > 1 ? `<a class="btn small" href="${href(page - 1)}">上一页</a>` : ''}${visible.map((n, i) => `${i && n - visible[i - 1] > 1 ? '<span aria-hidden="true">…</span>' : ''}<a class="btn small ${n === page ? 'soft' : ''}" href="${href(n)}" ${n === page ? 'aria-current="page"' : ''}>${n}</a>`).join('')}${page < pages ? `<a class="btn small" href="${href(page + 1)}">下一页</a>` : ''}<span class="muted">第 ${page} / ${pages} 页 · 共 ${total} 题</span></nav>`;
}
