import { textOnly } from "./core.mjs";
import { questionPreviewHTML } from './question-discovery.mjs';
import { getQuestionNote, mistakeReasons } from "./question-notes.mjs";
import { collectionQueue, collectionPageSlice } from "./study-planning.mjs";
import { icon, esc, attr, button, head, empty } from "./ui.mjs";

export function createCollectionPages({ getBank, getState, getFilters, route, subject, chapter, filtersHTML, names }) {
  const selections = { review: new Set(), favorites: new Set() };
  function selectedCollection(mode) {
    return collectionQueue(getBank(), getFilters(), getState(), mode, route().query.get('sort') || 'priority').filter(q => selections[mode]?.has(q.id));
  }
  function selectCollection(mode, id, checked) { if (checked) selections[mode]?.add(id); else selections[mode]?.delete(id); }
  function selectCollectionPage(mode, clear = false) {
    if (clear) selections[mode]?.clear();
    else {
      const list = collectionQueue(getBank(),getFilters(),getState(),mode,route().query.get('sort') || 'priority');
      for (const q of collectionPageSlice(list,route().query.get('page')).items) selections[mode]?.add(q.id);
    }
  }
  function collectionRow(q, i, mode) {
    const state = getState();
    const m = state.mistakes[q.id];
    return `<article class="collection-item">${selections[mode] ? `<label class="collection-select"><input type="checkbox" data-collection-selected data-mode="${mode}" value="${attr(q.id)}" ${selections[mode].has(q.id)?'checked':''} aria-label="选择第 ${i+1} 题"></label>` : `<span class="collection-number">${String(i + 1).padStart(2, "0")}</span>`}<div class="grow"><button class="text-btn collection-stem" data-action="show-question-preview" data-id="${attr(q.id)}">${esc(q.sourceLabel || textOnly(q.stem))}</button>${questionPreviewHTML(q, getFilters().search)}<div class="collection-meta"><span>${esc(subject(q.subjectId)?.name)}</span><span>${esc(chapter(q))}</span><span>${names[q.type]}</span>${mode === "review" ? `<span>错过 ${m?.wrongCount ?? 0} 次</span>` : ""}</div></div><div class="collection-actions">${button('预览', 'show-question-preview', `data-id="${attr(q.id)}"`, 'btn small')}${button(getQuestionNote(state, q.id) ? "已记笔记" : "笔记", "question-notes", `data-id="${attr(q.id)}"`, "btn small")}${button("练一练", "practice-one", `data-id="${attr(q.id)}"`, "btn small")}${mode === "favorites" ? button(icon("star", 15), "toggle-favorite", `data-id="${attr(q.id)}" aria-label="取消收藏"`, "icon-btn") : mode === "review" ? button(icon("check", 15), "resolve-mistake", `data-id="${attr(q.id)}" aria-label="标记已掌握"`, "icon-btn") : ""}</div></article>`;
  }
  function collectionPage(mode) {
    const bank = getBank(), state = getState();
    const isWrong = mode === "review", filters = getFilters(), query = route().query;
    const sort = query.get("sort") || "priority";
    const questions = collectionQueue(bank, filters, state, mode, sort);
    const page = collectionPageSlice(questions, query.get("page"));
    const pageLink = (number) => {
      const next = new URLSearchParams(query); next.set("page", number);
      return `#/${mode}?${next}`;
    };
    return `${head(isWrong ? "回头看，是为了走得更远。" : "好题，值得再见。", "按复习优先级排列，每页 30 题；从当前页开始练习。", questions.length ? button(isWrong ? "开始复习" : "练习收藏题", "start-collection", `data-mode="${mode}"`, "btn primary") : "")}${filtersHTML(filters)}<section class="card collection-filter-extra"><div class="field"><label for="collection-reason">错因</label><select id="collection-reason" data-filter="reason"><option value="">全部错因</option>${mistakeReasons.map(([id,label])=>`<option value="${id}" ${filters.reason===id?'selected':''}>${label}</option>`).join('')}</select></div><div class="field"><label for="collection-notes">个人笔记</label><select id="collection-notes" data-filter="notes"><option value="">全部题目</option><option value="1" ${filters.notes?'selected':''}>已有文字笔记</option></select></div>${isWrong?`<div class="field"><label for="collection-repeated">错误频次</label><select id="collection-repeated" data-filter="repeated"><option value="">全部错题</option><option value="1" ${filters.repeated?'selected':''}>反复出错（至少 2 次）</option></select></div>`:''}</section><div class="collection-selection-controls"><span>当前筛选已选 ${selectedCollection(mode).length} 题</span>${button('选择本页','select-collection-page',`data-mode="${mode}"`,'btn small')}${button('清空选择','clear-collection-selection',`data-mode="${mode}"`,'btn small')}${button('练习所选题','practice-selected',`data-mode="${mode}" ${selectedCollection(mode).length?'':'disabled'}`,'btn small primary')}${button('导出所选 / 本页打印稿','print-collection',`data-mode="${mode}"`,'btn small')}</div><div class="collection-controls field"><label for="collection-sort">排序方式</label><select id="collection-sort" data-filter="sort">${[["priority", "复习优先"], ["due", "最早到期"], ["wrong", "错误次数"], ["bank", "题库顺序"]].map(([value, name]) => `<option value="${value}" ${sort === value ? "selected" : ""}>${name}</option>`).join("")}</select></div><section class="card">${questions.length ? `<div class="collection-item"><span class="muted">共 ${questions.length} 题 · 第 ${page.page} / ${page.pages} 页</span></div>${page.items.map((q, i) => collectionRow(q, page.offset + i, mode)).join("")}<nav class="collection-pagination flex" aria-label="题目分页">${page.page > 1 ? `<a class="btn small" href="${pageLink(page.page - 1)}">上一页</a>` : ""}${page.page < page.pages ? `<a class="btn small" href="${pageLink(page.page + 1)}">下一页</a>` : ""}</nav>` : empty(isWrong ? "错题本，等待你的第一道题" : "把好题，留在这里", "在练习中积累需要复习的题目。", '<a class="btn primary" href="#/practice">去练习</a>')}</section>`;
  }

  return { collectionRow, collectionPage, selectedCollection, selectCollection, selectCollectionPage };
}
