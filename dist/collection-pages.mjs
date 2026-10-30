import { textOnly } from "./core.mjs";
import { getQuestionNote } from "./question-notes.mjs";
import { collectionQueue, collectionPageSlice } from "./study-planning.mjs";
import { icon, esc, attr, button, head, empty } from "./ui.mjs";

export function createCollectionPages({ getBank, getState, getFilters, route, subject, chapter, filtersHTML, names }) {
  function collectionRow(q, i, mode) {
    const state = getState();
    const m = state.mistakes[q.id];
    return `<article class="collection-item"><span class="collection-number">${String(i + 1).padStart(2, "0")}</span><div class="grow"><div class="collection-stem">${esc(q.sourceLabel || textOnly(q.stem))}</div><div class="collection-meta"><span>${esc(subject(q.subjectId)?.name)}</span><span>${esc(chapter(q))}</span><span>${names[q.type]}</span>${mode === "review" ? `<span>错过 ${m?.wrongCount ?? 0} 次</span>` : ""}</div></div>${button(getQuestionNote(state, q.id) ? "已记笔记" : "笔记", "question-notes", `data-id="${attr(q.id)}"`, "btn small")}${button("练一练", "practice-one", `data-id="${attr(q.id)}"`, "btn small")}${mode === "favorites" ? button(icon("star", 15), "toggle-favorite", `data-id="${attr(q.id)}" aria-label="取消收藏"`, "icon-btn") : mode === "review" ? button(icon("check", 15), "resolve-mistake", `data-id="${attr(q.id)}" aria-label="标记已掌握"`, "icon-btn") : ""}</article>`;
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
    return `${head(isWrong ? "回头看，是为了走得更远。" : "好题，值得再见。", "按复习优先级排列，每页 30 题；从当前页开始练习。", questions.length ? button(isWrong ? "开始复习" : "练习收藏题", "start-collection", `data-mode="${mode}"`, "btn primary") : "")}${filtersHTML(filters)}<div class="collection-controls field"><label for="collection-sort">排序方式</label><select id="collection-sort" data-filter="sort">${[["priority", "复习优先"], ["due", "最早到期"], ["wrong", "错误次数"], ["bank", "题库顺序"]].map(([value, name]) => `<option value="${value}" ${sort === value ? "selected" : ""}>${name}</option>`).join("")}</select></div><section class="card">${questions.length ? `<div class="collection-item"><span class="muted">共 ${questions.length} 题 · 第 ${page.page} / ${page.pages} 页</span></div>${page.items.map((q, i) => collectionRow(q, page.offset + i, mode)).join("")}<nav class="collection-pagination flex" aria-label="题目分页">${page.page > 1 ? `<a class="btn small" href="${pageLink(page.page - 1)}">上一页</a>` : ""}${page.page < page.pages ? `<a class="btn small" href="${pageLink(page.page + 1)}">下一页</a>` : ""}</nav>` : empty(isWrong ? "错题本，等待你的第一道题" : "把好题，留在这里", "在练习中积累需要复习的题目。", '<a class="btn primary" href="#/practice">去练习</a>')}</section>`;
  }

  return { collectionRow, collectionPage };
}
