import { difficultyBadge } from './question-guidance.mjs';
import { favoriteButton } from './favorite-button.mjs';
import { textOnly } from "./core.mjs";
import { questionPreviewHTML } from './question-discovery.mjs';
import { getQuestionNote, mistakeReasons } from "./question-notes.mjs";
import { collectionQueue, collectionPageSlice, rootChapter } from "./study-planning.mjs";
import { icon, esc, attr, button, head, empty } from "./ui.mjs";

function reviewChapters(bank, questions) {
  const groups = new Map();
  for (const q of questions) {
    const key = rootChapter(bank, q);
    if (!groups.has(key)) {
      const [subjectId, chapterId] = JSON.parse(key);
      groups.set(key, { subjectId, chapterId, questions: [] });
    }
    groups.get(key).questions.push(q);
  }
  const ordered = [];
  for (const subject of bank.subjects) {
    for (const chapter of subject.chapters) {
      const key = JSON.stringify([subject.id, chapter.id]);
      if (groups.has(key)) {
        ordered.push(groups.get(key));
        groups.delete(key);
      }
    }
  }
  return ordered.concat([...groups.values()]);
}

export function createCollectionPages({ getBank, getState, getFilters, route, subject, chapter, filtersHTML, names }) {
  const selections = { review: new Set(), favorites: new Set() };
  function collectionListing(mode, filters = getFilters(), query = route().query) {
    const bank = getBank(), sort = query.get('sort') || 'priority';
    const queue = collectionQueue(bank, filters, getState(), mode, sort);
    const chapters = mode === 'review' ? reviewChapters(bank, queue) : null;
    const questions = chapters ? chapters.flatMap(group => group.questions) : queue;
    return { questions, chapters, sort, page: collectionPageSlice(questions, query.get('page')) };
  }
  function collectionPageQuestions(mode) {
    return collectionListing(mode).page.items;
  }
  function selectedCollection(mode, questions = collectionListing(mode).questions) {
    return questions.filter(q => selections[mode]?.has(q.id));
  }
  function selectCollection(mode, id, checked) { if (checked) selections[mode]?.add(id); else selections[mode]?.delete(id); }
  function selectCollectionPage(mode, clear = false) {
    if (clear) selections[mode]?.clear();
    else for (const q of collectionPageQuestions(mode)) selections[mode]?.add(q.id);
  }
  function updateCollectionSelection(root, mode) {
    const count = selectedCollection(mode).length;
    const summary = root.querySelector('[data-collection-selection-count]');
    if (summary) summary.textContent = `当前筛选已选 ${count} 题`;
    const practice = root.querySelector('[data-action="practice-selected"]');
    if (practice) practice.disabled = !count;
    for (const input of root.querySelectorAll('[data-collection-selected]'))
      input.checked = selections[mode]?.has(input.value) ?? false;
  }
  function collectionRow(q, i, mode) {
    const state = getState();
    const m = state.mistakes[q.id];
    return `<article class="collection-item">${selections[mode] ? `<label class="collection-select"><input type="checkbox" data-collection-selected data-mode="${mode}" value="${attr(q.id)}" ${selections[mode].has(q.id)?'checked':''} aria-label="选择第 ${i+1} 题"></label>` : `<span class="collection-number">${String(i + 1).padStart(2, "0")}</span>`}<div class="grow"><button class="text-btn collection-stem" data-action="show-question-preview" data-id="${attr(q.id)}">${esc(q.sourceLabel || textOnly(q.stem))}</button>${questionPreviewHTML(q, getFilters().search)}<div class="collection-meta"><span>${esc(subject(q.subjectId)?.name)}</span><span>${esc(chapter(q))}</span><span>${names[q.type]}</span>${difficultyBadge(q, state.questionAnnotations)}${mode === "review" ? `<span>错过 ${m?.wrongCount ?? 0} 次</span>` : ""}</div></div><div class="collection-actions">${button('预览', 'show-question-preview', `data-id="${attr(q.id)}"`, 'btn small')}${button(getQuestionNote(state, q.id) ? "已记笔记" : "笔记", "question-notes", `data-id="${attr(q.id)}"`, "btn small")}${button("练一练", "practice-one", `data-id="${attr(q.id)}"`, "btn small")}${mode === "favorites" ? favoriteButton(q.id, true) : mode === "review" ? button(icon("check", 15), "resolve-mistake", `data-id="${attr(q.id)}" aria-label="标记已掌握"`, "icon-btn") : ""}</div></article>`;
  }
  function reviewChapterCards(chapters, page) {
    const positions = new Map(page.items.map((q, i) => [q.id, page.offset + i]));
    return `<div class="review-chapters">${chapters.map((group, i) => {
      const questions = group.questions.filter(q => positions.has(q.id));
      if (!questions.length) return '';
      return `<section class="card review-chapter" aria-labelledby="review-chapter-${i}">
        <header class="review-chapter-header"><div><p class="muted">${esc(subject(group.subjectId)?.name)}</p><h2 id="review-chapter-${i}">${esc(chapter(group))}</h2></div><span class="muted">${group.questions.length} 道错题</span></header>
        ${questions.map(q => collectionRow(q, positions.get(q.id), 'review')).join('')}
      </section>`;
    }).join('')}</div>`;
  }
  function collectionPage(mode) {
    const isWrong = mode === "review", filters = getFilters(), query = route().query;
    const { questions, chapters, sort, page } = collectionListing(mode, filters, query);
    const selectedCount = selectedCollection(mode, questions).length;
    const pageLink = (number) => {
      const next = new URLSearchParams(query); next.set("page", number);
      return `#/${mode}?${next}`;
    };
    const summary = `<span class="muted">共 ${questions.length} 题 · 第 ${page.page} / ${page.pages} 页</span>`;
    const pagination = `<nav class="collection-pagination flex" aria-label="题目分页">${page.page > 1 ? `<a class="btn small" href="${pageLink(page.page - 1)}">上一页</a>` : ""}${page.page < page.pages ? `<a class="btn small" href="${pageLink(page.page + 1)}">下一页</a>` : ""}</nav>`;
    const results = !questions.length
      ? `<section class="card">${empty(isWrong ? "错题本，等待你的第一道题" : "把好题，留在这里", "在练习中积累需要复习的题目。", '<a class="btn primary" href="#/practice">去练习</a>')}</section>`
      : isWrong ? `<p class="review-page-summary">${summary}</p>${reviewChapterCards(chapters, page)}${pagination}`
      : `<section class="card"><div class="collection-item">${summary}</div>${page.items.map((q, i) => collectionRow(q, page.offset + i, mode)).join("")}${pagination}</section>`;
    const subtitle = isWrong ? '错题按大章分组，每页最多 30 题，可从当前页开始复习。' : '按复习优先级排列，每页 30 题，可从当前页开始练习。';
    return `${head(isWrong ? '回头看，是为了走得更远。' : '好题，值得再见。', subtitle, questions.length ? button(isWrong ? '开始复习' : '练习收藏题', 'start-collection', `data-mode="${mode}"`, 'btn primary') : '')}
      ${filtersHTML(filters)}
      <section class="card collection-filter-extra">
        <div class="field"><label for="collection-reason">错因</label><select id="collection-reason" data-filter="reason"><option value="">全部错因</option>${mistakeReasons.map(([id, label]) => `<option value="${id}" ${filters.reason === id ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
        <div class="field"><label for="collection-notes">个人笔记</label><select id="collection-notes" data-filter="notes"><option value="">全部题目</option><option value="1" ${filters.notes ? 'selected' : ''}>已有文字笔记</option></select></div>
        ${isWrong ? `<div class="field"><label for="collection-repeated">错误频次</label><select id="collection-repeated" data-filter="repeated"><option value="">全部错题</option><option value="1" ${filters.repeated ? 'selected' : ''}>反复出错（至少 2 次）</option></select></div>` : ''}
      </section>
      <div class="collection-selection-controls">
        <span data-collection-selection-count role="status" aria-live="polite">当前筛选已选 ${selectedCount} 题</span>
        ${button('选择本页', 'select-collection-page', `data-mode="${mode}"`, 'btn small')}
        ${button('清空选择', 'clear-collection-selection', `data-mode="${mode}"`, 'btn small')}
        ${button('练习所选题', 'practice-selected', `data-mode="${mode}" ${selectedCount ? '' : 'disabled'}`, 'btn small primary')}
        ${button('导出所选 / 本页打印稿', 'print-collection', `data-mode="${mode}"`, 'btn small')}
      </div>
      <div class="collection-controls field">
        <label for="collection-sort">${isWrong ? '章内排序' : '排序方式'}</label>
        <select id="collection-sort" data-filter="sort">${[['priority', '复习优先'], ['due', '最早到期'], ['wrong', '错误次数'], ['bank', '题库顺序']].map(([value, name]) => `<option value="${value}" ${sort === value ? 'selected' : ''}>${name}</option>`).join('')}</select>
      </div>
      ${results}`;
  }

  return { collectionRow, collectionPage, collectionPageQuestions, selectedCollection, selectCollection, selectCollectionPage, updateCollectionSelection };
}
