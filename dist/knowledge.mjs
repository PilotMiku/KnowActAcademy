import { normalizeReadingPositions, readingView } from "./knowledge-reading.mjs";

export const emptyKnowledge = () => ({
  articles: [],
  sources: {},
  stats: {},
  sourceNotice: "",
  error: "",
});

export function normalizeKnowledgeRecords(state) {
  for (const key of ["knowledgeRead", "knowledgeFavorites", "knowledgeRecalled"]) {
    state[key] = [
      ...new Set(
        Array.isArray(state[key])
          ? state[key].filter((id) => typeof id === "string")
          : [],
      ),
    ];
  }
  state.knowledgeRecallDrafts ??= {};
  try { state.knowledgePositions = normalizeReadingPositions(state.knowledgePositions); }
  catch { state.knowledgePositions = {}; }
  return state;
}

export function knowledgeGroupId(data, article) {
  return article.sources.some(ref => data.sources[ref.id]?.path?.startsWith("question-bank/习概/"))
    ? "xigai" : "category:" + (article.category || "其他资料");
}

export function knowledgeGroups(data) {
  const groups = new Map();
  for (const article of data.articles) {
    const id = knowledgeGroupId(data, article);
    if (!groups.has(id)) groups.set(id, { id, name: id === "xigai" ? "习概资料" : article.category || "其他资料", articles: [] });
    groups.get(id).articles.push(article);
  }
  return [...groups.values()].sort((a, b) => a.id === "xigai" ? -1 : b.id === "xigai" ? 1 : 0);
}

export const knowledgeGroupURL = id => "#/knowledge?group=" + encodeURIComponent(id);
const categoryLabel = (category, group) => group?.id === "xigai"
  ? ({ "章节笔记": "笔记", "专题提纲": "提纲" }[category] || category) : category;

export function filterKnowledge(data, query, state) {
  const needle = (query.get("q") || "").trim().toLocaleLowerCase();
  return data.articles.filter(
    (article) =>
      (!query.get("group") || knowledgeGroupId(data, article) === query.get("group")) &&
      (!query.get("category") || article.category === query.get("category")) &&
      (query.get("view") !== "favorites" ||
        state.knowledgeFavorites.includes(article.id)) &&
      (!needle ||
        `${article.title} ${article.searchText}`
          .toLocaleLowerCase()
          .includes(needle)),
  );
}

export function knowledgePage(data, state, route, ui) {
  if (data.loading) return '<section class="card" role="status"><h1>学习资料</h1><p>正在加载资料，可先到题库练习。</p></section>';
  const { esc, attr, icon, button, head } = ui;
  const groups = knowledgeGroups(data);
  const breadcrumbs = group => `<nav class="knowledge-breadcrumbs" aria-label="资料路径"><a href="#/knowledge">学习资料</a>${group ? `<span aria-hidden="true">/</span><a href="${knowledgeGroupURL(group.id)}">${esc(group.name)}</a>` : ""}</nav>`;
  if (data.error)
    return `${head("学习资料", "阅读笔记与学习指南，整理学习进度。")}
    <section class="card empty"><h2>暂时无法加载知识点</h2><p>${esc(data.error)}</p>${button("重新加载", "reload-knowledge", "", "btn primary")}</section>`;
  const sourceLink = (reference, label) => {
    const source = data.sources[reference.id];
    if (!source) return "";
    return `<a class="btn small" href="./knowledge-source/${encodeURIComponent(source.id)}.${source.type}${source.type === "pdf" ? `#page=${reference.page || 1}` : ""}" target="_blank" rel="noopener" ${["docx", "txt"].includes(source.type) ? `download="${attr(source.name)}"` : ""}>${icon("folder", 14)} ${label || ({pdf: `原 PDF · ${source.pages} 页`, md: "Markdown 原文", docx: "下载 Word 原文", txt: "下载 TXT 原文"}[source.type] || "下载原文")}</a>`;
  };
  const toggleFavorite = (article) =>
    button(
      `${icon("star", 15)} ${state.knowledgeFavorites.includes(article.id) ? "已收藏" : "收藏"}`,
      "knowledge-favorite",
      `data-id="${attr(article.id)}" aria-label="${state.knowledgeFavorites.includes(article.id) ? "取消收藏知识点" : "收藏知识点"}"`,
      "btn small " +
        (state.knowledgeFavorites.includes(article.id) ? "soft" : ""),
    );

  if (route.parts[1]) {
    const article = data.articles.find((a) => a.id === route.parts[1]);
    if (!article)
      return `${head("未找到这份资料", "可以返回目录查看现有知识点。", '<a class="btn" href="#/knowledge">返回目录</a>')}`;
    const read = state.knowledgeRead.includes(article.id);
    const recalling = route.query.get("recall") === "1" && article.kind === "note";
    const reading = readingView(article, data.sources, state.knowledgePositions, route.query);
    const headings = recalling ? article.headings : reading.headings;
    const sectionIndex = reading.sections.findIndex(s => s.id === reading.chapter);
    const sectionURL = chapter => `#/knowledge/${article.id}?chapter=${chapter}`;
    const chapterNavigation = !recalling && reading.sections.length ? `<nav class="reading-chapters" aria-label="分章阅读"><label>阅读范围<select class="input" data-reading-section><option value="all" ${reading.chapter === "all" ? "selected" : ""}>全文</option>${reading.sections.map((s, i) => `<option value="${attr(s.id)}" ${reading.chapter === s.id ? "selected" : ""}>${i + 1}. ${esc(s.title)}</option>`).join("")}</select></label><div class="reading-chapter-links">${sectionIndex > 0 ? `<a class="btn small" href="${sectionURL(reading.sections[sectionIndex - 1].id)}">上一章</a>` : ""}${sectionIndex >= 0 && sectionIndex < reading.sections.length - 1 ? `<a class="btn small" href="${sectionURL(reading.sections[sectionIndex + 1].id)}">下一章</a>` : ""}${reading.chapter === "all" ? `<a class="btn small" href="${sectionURL(reading.sections[0].id)}">分章阅读</a>` : `<a class="btn small" href="${sectionURL("all")}">查看全文</a>`}</div></nav>` : "";
    const group = groups.find(g => g.id === knowledgeGroupId(data, article));
    const index = group.articles.indexOf(article);
    const previous = group.articles[index - 1],
      next = group.articles[index + 1];
    return `${breadcrumbs(group)}${head(group.name, categoryLabel(article.category, group), `<a class="btn" href="${knowledgeGroupURL(group.id)}">返回资料目录</a>`)}
      <div class="reading-toolbar"><span class="pill ${read ? "green" : "blue"}">${read ? "已读" : "未读"}</span><span class="grow"></span>${article.kind === "note" ? button("主动回忆", "knowledge-recall", `data-id="${attr(article.id)}"`, "btn small") : ""}${state.knowledgeRecalled.includes(article.id) ? '<span class="pill green">已回忆核对</span>' : ""}${toggleFavorite(article)}${button(`${icon("check", 15)} ${read ? "标为未读" : "标为已读"}`, "knowledge-read", `data-id="${attr(article.id)}"`, "btn small " + (read ? "" : "primary"))}</div>
      <div class="reading-layout ${headings.length ? "" : "no-toc"}">
        ${headings.length ? `<aside class="card reading-toc"><details open><summary>本篇目录 <small>${headings.length} 节</small></summary><div>${headings.map((h) => `<button data-action="knowledge-scroll" data-target="${attr(h.id)}" style="--level:${Math.min(3, Math.max(0, h.level - 2))}">${esc(h.title)}</button>`).join("")}</div></details></aside>` : ""}
        <article class="card reading-paper" ${!recalling && article.kind === "note" ? `data-reading-article="${attr(article.id)}" data-reading-chapter="${attr(reading.chapter)}" data-reading-revision="${attr(reading.revision)}"` : ""}><header><span class="eyebrow">STUDY NOTES · 原文阅读</span><h1>${esc(article.title)}</h1><div class="reading-meta"><span>${article.kind === "note" ? `约 ${article.minutes} 分钟` : "PDF 汇编资料"}</span><span>来自你提供的复习资料</span></div><div class="flex source-links">${article.sources.map((ref) => sourceLink(ref)).join("")}</div></header>
          ${chapterNavigation}${article.kind === "note" ? recalling ? `<section class="recall-exercise"><h2>先回忆，再对照</h2><label class="field"><span>不看原文，写下本篇的核心概念和要点</span><textarea class="input" data-recall-text="${attr(article.id)}" maxlength="10000" rows="8">${esc(state.knowledgeRecallDrafts[article.id] || "")}</textarea></label><details class="recall-reference"><summary>展开原文，核对遗漏</summary><div class="reading-content rich" data-rich="${attr(article.html)}"></div></details>${button(state.knowledgeRecalled.includes(article.id) ? "已完成回忆核对" : "已对照原文，完成回忆核对", "knowledge-recalled", `data-id="${attr(article.id)}" ${!state.knowledgeRecallDrafts[article.id]?.trim() || state.knowledgeRecalled.includes(article.id) ? "disabled" : ""}`, "btn primary")}<p class="format-note">草稿自动保存。回忆记录与已读记录分别统计；请先展开原文核对。</p></section>` : `<div class="reading-content rich" data-rich="${attr(reading.html)}"></div>` : `<div class="pdf-reading-card">${icon("book", 36)}<h2>打开原始 PDF 阅读</h2><p>这份资料是 PDF 汇编，保留原来的页面和排版。</p>${article.sources.map((ref) => sourceLink(ref, "打开 PDF 资料")).join("")}</div>`}
          <nav class="reading-adjacent" aria-label="上一篇和下一篇">${previous ? `<a href="#/knowledge/${previous.id}"><small>上一篇</small><span>${esc(previous.title)}</span></a>` : "<span></span>"}${next ? `<a href="#/knowledge/${next.id}"><small>下一篇</small><span>${esc(next.title)}</span></a>` : ""}</nav>
        </article>
      </div>`;
  }

  const group = groups.find(g => g.id === route.query.get("group"));
  if (route.query.has("group") && !group)
    return `${head("未找到这个资料分类", "返回学习资料，选择现有分类。", '<a class="btn" href="#/knowledge">返回学习资料</a>')}`;
  const scope = group?.articles || data.articles;
  const articles = filterKnowledge(data, route.query, state);
  const done = scope.filter(a => state.knowledgeRead.includes(a.id)).length;
  const landing = !group && !["q", "view", "category"].some(key => route.query.has(key));
  const link = (key, value) => {
    const query = new URLSearchParams(route.query);
    value ? query.set(key, value) : query.delete(key);
    return "#/knowledge" + (query.size ? "?" + query.toString() : "");
  };
  const categories = [...new Set(scope.map(a => a.category))];
  const sourceIds = new Set(scope.flatMap(a => a.sources.map(ref => ref.id)));
  const formats = [["pdf", "原始 PDF"], ["docx", "Word"], ["txt", "TXT"]]
    .map(([type, label]) => [label, [...sourceIds].filter(id => data.sources[id]?.type === type).length])
    .filter(([, count]) => count).map(([label, count]) => `${count} 份${label}`).join(" · ");
  const descriptions = { "习概资料": "章节笔记、专题提纲与汇编资料，按需选择。", "编程入门": "从基础开始，边学边实践。", "开发工具": "Git、AI 编程工具与插件开发指南。", "部署指南": "网站发布与服务器部署资料。", "升学准备": "专业选择与面试准备资料。" };
  const filters = `<div class="card knowledge-filters"><label class="knowledge-search"><span class="sr-only">搜索学习资料全文</span>${icon("search", 18)}<input class="input" data-knowledge-query type="search" value="${attr(route.query.get("q") || "")}" placeholder="${group ? "搜索当前分类的资料全文" : "搜索全部学习资料"}，回车确认"></label><a class="btn small ${route.query.get("view") === "favorites" ? "soft" : ""}" href="${link("view", route.query.get("view") === "favorites" ? "" : "favorites")}">${icon("star", 14)} ${route.query.get("view") === "favorites" ? "查看全部" : "只看收藏"}</a></div>`;
  const overview = `<section class="card knowledge-overview"><div><span class="pill blue">${group ? esc(group.name) : "笔记与学习指南"}</span><h2>${group ? "选择资料，开始阅读。" : "选择学习方向，打开对应资料。"}</h2><p>${scope.filter(a => a.kind === "note").length} 篇知识笔记${formats ? " · " + formats : ""}</p></div><div class="knowledge-progress"><b>${done}<small> / ${scope.length}</small></b><span>已读资料 · 已回忆核对 ${scope.filter(a => state.knowledgeRecalled.includes(a.id)).length} 篇</span><div class="progress-bar"><span style="width:${scope.length ? done / scope.length * 100 : 0}%"></span></div></div></section>`;
  if (landing) return `${head("学习资料", "先选择资料分类，再阅读对应的笔记与指南。")}${overview}${filters}
    <div class="section-head"><h2>资料分类 <small>选择一个学习方向</small></h2><span class="muted">${groups.length} 个分类</span></div>
    <div class="chapter-grid knowledge-group-grid">${groups.map((g, i) => {
      const read = g.articles.filter(a => state.knowledgeRead.includes(a.id)).length;
      const href = knowledgeGroupURL(g.id);
      return `<section class="card chapter-card chapter-color-${i % 4} knowledge-group-card" data-knowledge-group="${attr(g.id)}"><div class="chapter-card-head"><span class="chapter-glyph">${icon("book", 24)}</span><span class="pill">${g.articles.length} 份资料</span></div><a href="${href}" class="chapter-title knowledge-group-title"><span>STUDY MATERIALS</span><h3>${esc(g.name)}</h3></a><p class="chapter-description">${esc(descriptions[g.name] || "打开目录，按需阅读。")}<br>已读 ${read} / ${g.articles.length} 份</p><div class="progress-bar"><span style="width:${g.articles.length ? read / g.articles.length * 100 : 0}%"></span></div><a class="chapter-link" href="${href}">查看资料 ${icon("arrow", 15)}</a></section>`;
    }).join("")}</div>${!groups.length ? '<section class="card empty"><h2>暂无学习资料</h2></section>' : ""}`;
  return `${breadcrumbs(group)}${head(group?.name || "学习资料", group ? descriptions[group.name] || "阅读当前分类的学习资料。" : "搜索与收藏结果。", '<a class="btn" href="#/knowledge">返回学习资料</a>')}${overview}${filters}
    <nav class="knowledge-categories" aria-label="资料分类"><a class="${!route.query.get("category") ? "active" : ""}" href="${link("category", "")}">全部资料</a>${categories.map(category => `<a href="${link("category", category)}" class="${route.query.get("category") === category ? "active" : ""}">${esc(categoryLabel(category, group))}</a>`).join("")}<span class="grow"></span><small>共 ${articles.length} 份</small></nav>
    <div class="knowledge-grid">${articles.map(article => `<article class="card knowledge-card"><div class="knowledge-card-top"><span class="pill ${article.kind === "pdf" ? "" : "blue"}">${esc(categoryLabel(article.category, group))}</span>${state.knowledgeRead.includes(article.id) ? '<span class="knowledge-read-badge">已读</span>' : ""}</div><a href="#/knowledge/${article.id}" class="knowledge-title"><h2>${esc(article.title)}</h2></a><p>${esc(article.excerpt)}</p><div class="knowledge-card-bottom"><a class="text-btn" href="#/knowledge/${article.id}">${article.kind === "pdf" ? "打开资料" : "阅读笔记"} ${icon("arrow", 13)}</a><span class="grow"></span>${toggleFavorite(article)}</div></article>`).join("")}</div>
    ${!articles.length ? `<section class="card empty"><h2>没有找到相关资料</h2><p>试试其他关键词，或切换资料分类。</p><a class="btn primary" href="${group ? knowledgeGroupURL(group.id) : "#/knowledge"}">查看全部资料</a></section>` : ""}
    ${group?.id === "xigai" ? `<details class="card knowledge-source-notice"><summary>原资料说明</summary><div class="rich reading-content" data-rich="${attr(data.sourceNotice)}"></div></details>` : ""}`;
}
