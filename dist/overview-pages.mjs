import { getAttemptIndex } from "./attempt-index.mjs";
import { stats, dayKey, getBankIndex, isScorable } from "./core.mjs";
import { questionCounts, questionCountDescription } from "./question-counts.mjs";
import { learningSummary } from './learning-summary.mjs';
import { compactDashboard, weakSectionsHTML } from './dashboard-view.mjs';
import { icon, esc, attr, button, head } from "./ui.mjs";

// Read current data at render time, including after imports and server restores.
export function createOverviewPages({ getBank, getState, getKnowledge, getFilters, subject, qById, getGuideHTML = () => "" }) {
  function heatmap() {
    const state = getState();
    const counts = getAttemptIndex(state, getBank()).days;
    const end = new Date();
    end.setDate(end.getDate() + ((7 - end.getDay()) % 7));
    let cells = "";
    for (let i = 104; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      const count = counts.get(dayKey(d))?.total ?? 0;
      const future = d.getTime() > Date.now() + 86400000;
      const level =
        count >= 20 ? 4 : count >= 10 ? 3 : count >= 3 ? 2 : count ? 1 : 0;
      cells += `<span class="heat-cell ${level ? "l" + level : ""}" title="${dayKey(d)} · ${count} 题" ${future ? 'style="opacity:.25"' : ""}></span>`;
    }
    return `<div class="heatmap" role="img" aria-label="近十五周学习记录">${cells}</div><div class="heat-footer"><span>每一小格，都算数</span><span class="legend">少 <i></i><i></i><i></i> 多</span></div>`;
  }
  function dashboard() {
    const bank = getBank(), state = getState(), knowledge = getKnowledge();
    const s = stats(state, Date.now(), bank);
    const activeSubject = subject(getFilters().subjectId) ?? bank.subjects[0];
    return compactDashboard({ bank, state, knowledge, activeSubject, stats:s, guide:getGuideHTML(), chapters:chapterCards(false, activeSubject?.id, 3) });
  }

  function chapterCards(expanded = true, subjectId = "", limit = Infinity) {
    const bank = getBank(), state = getState();
    const filters = getFilters();
    const index = getBankIndex(bank);
    const practiced = getAttemptIndex(state, bank).latest;
    const recency = new Map();
    for (const [id, attempt] of practiced) {
      const q = index.questions.get(id), chapter = index.chapters.get(q.subjectId)?.get(q.chapterId);
      const key = q.subjectId + ':' + (chapter?.parentId || chapter?.id);
      recency.set(key, Math.max(recency.get(key) || 0, attempt.at));
    }
    return `<div class="chapter-grid">${bank.subjects
      .filter((s) => !subjectId || s.id === subjectId)
      .flatMap((s) =>
        s.chapters
          .filter((c) => !c.parentId)
          .map((c, displayIndex) => ({ ...c, displayIndex }))
          .sort((a,b) => expanded ? 0 : (recency.get(s.id+':'+b.id)||0)-(recency.get(s.id+':'+a.id)||0))
          .slice(0,limit)
          .map((c) => {
            const i = c.displayIndex;
            const questions = index.chapterQuestions.get(s.id).get(c.id);
            const eligible = questions.filter(isScorable);
            const done = eligible.filter((q) => practiced.has(q.id)).length;
            const children = s.chapters.filter((ch) => ch.parentId === c.id);
            const href = `#/practice?subject=${encodeURIComponent(s.id)}&chapter=${encodeURIComponent(c.id)}`;
            return `<section class="card chapter-card chapter-color-${i % 4}"><div class="chapter-card-head"><span class="chapter-glyph">${(s.id === "linear" ? ["|A|", "A", "r", "λ", "Q"] : ["ƒ", "∂", "f′", "∫", "∑", "→", "∇"])[i % (s.id === "linear" ? 5 : 7)]}</span><span class="pill" title="${attr(questionCountDescription(questions))}">${questionCounts(questions).total} 题</span></div><a href="${href}" class="chapter-title"><span>CHAPTER ${String(i + 1).padStart(2, "0")}</span><h3>${esc(c.name.replace(/^第\d+章\s*/, ""))}</h3></a><p class="chapter-description">${children.length} 个小节 · 已练 ${done} 题</p><div class="progress-bar"><span style="width:${eligible.length ? (done / eligible.length) * 100 : 0}%"></span></div>${expanded ? `<details ${filters.chapterId === c.id || children.some((ch) => ch.id === filters.chapterId) ? "open" : ""}><summary>查看章节目录 ${icon("chevron", 13)}</summary><div class="section-list">${children.map((ch) => `<a href="#/practice?subject=${encodeURIComponent(s.id)}&chapter=${encodeURIComponent(ch.id)}" class="${filters.chapterId === ch.id ? "active" : ""}"><span>${esc(ch.name)}</span><small title="${attr(questionCountDescription(index.chapterQuestions.get(s.id).get(ch.id)))}">${questionCounts(index.chapterQuestions.get(s.id).get(ch.id)).total}题</small></a>`).join("")}</div></details>` : `<a class="chapter-link" href="${href}">进入章节 ${icon("arrow", 15)}</a>`}</section>`;
          }),
      )
      .join("")}</div>`;
  }

  function statsPage() {
    const bank = getBank(), state = getState();
    const s = stats(state, Date.now(), bank);
    const summary = learningSummary(bank, state);
    const daily = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      daily.push({
        date: dayKey(d),
        count: getAttemptIndex(state, bank).days.get(dayKey(d))?.total ?? 0,
        label: i === 0 ? "今天" : `${d.getMonth() + 1}/${d.getDate()}`,
      });
    }
    const max = Math.max(5, ...daily.map((d) => d.count));
    return `${head("让积累，看得见。", "和昨天的自己比，就已经是一种进步。")}<div class="stat-cards">${[
      ["累计做题", s.total],
      ["综合正确率", s.total ? s.accuracy + "%" : "—"],
      ["连续学习", s.streak + " 天"],
      ["活跃天数", s.activeDays + " 天"],
    ]
      .map(([l, v]) => `<div class="card big-stat"><p>${l}</p><b>${v}</b></div>`)
      .join(
        "",
      )}</div><div class="grid-2"><section class="card activity-card"><div class="card-head"><h2>近七天练习</h2><span class="muted" style="font-size:10px">单位：题次</span></div><div class="chart" role="img" aria-label="近七天练习数量">${daily.map((d) => `<div class="bar-column"><span class="bar-value">${d.count}</span><div class="bar" style="height:${Math.max(2, (d.count / max) * 100)}%"></div><span>${d.label}</span></div>`).join("")}</div></section><section class="card activity-card"><div class="card-head"><h2>学习足迹</h2><span class="pill">近十五周</span></div>${heatmap()}</section></div><div class="section-head"><h2>科目学习情况</h2><span class="muted" style="font-size:10px">按实际答题记录计算</span></div><section class="card" style="padding:12px 24px">${bank.subjects
      .map((sub) => {
        const row = summary.subjects.find(r => r.id === sub.id);
        return `<article class="subject-learning-row"><h3>${esc(sub.name)}</h3><div class="subject-learning-metrics"><span>题库覆盖 <b>${row.coverage}%</b><small>${row.covered} / ${row.total} 题</small></span><span>最近作答正确率 <b>${row.accuracy === null ? '—' : row.accuracy+'%'}</b><small>每题最近一次有效作答</small></span><span>隔日巩固 <b>${row.stable} 题</b><small>最近两次确定答对分属不同日期</small></span></div></article>`;
      })
      .join("")}</section>${weakSectionsHTML(summary)}`;
  }

  return { dashboard, chapterCards, statsPage };
}
