import { stats, dayKey, getBankIndex, isEffectiveAttempt } from "./core.mjs";
import { spacedReview } from "./study.mjs";
import { reviewCard } from "./study-view.mjs";
import { dailyTasksHTML } from "./dashboard-tasks.mjs";
import { icon, esc, attr, button, head } from "./ui.mjs";

// Read current data at render time, including after imports and server restores.
export function createOverviewPages({ getBank, getState, getKnowledge, getFilters, subject, qById }) {
  function heatmap() {
    const state = getState();
    const counts = new Map();
    for (const a of state.attempts.filter((a) => isEffectiveAttempt(a, qById(a.questionId))))
      counts.set(dayKey(a.at), (counts.get(dayKey(a.at)) ?? 0) + 1);
    const end = new Date();
    end.setDate(end.getDate() + ((7 - end.getDay()) % 7));
    let cells = "";
    for (let i = 104; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      const count = counts.get(dayKey(d)) ?? 0;
      const future = d.getTime() > Date.now() + 86400000;
      const level =
        count >= 20 ? 4 : count >= 10 ? 3 : count >= 3 ? 2 : count ? 1 : 0;
      cells += `<span class="heat-cell ${level ? "l" + level : ""}" title="${dayKey(d)} · ${count} 题" ${future ? 'style="opacity:.25"' : ""}></span>`;
    }
    return `<div class="heatmap" role="img" aria-label="近十五周学习记录">${cells}</div><div class="heat-footer"><span>每一小格，都算数</span><span class="legend">少 <i></i><i></i><i></i> 多</span></div>`;
  }
  function dashboard() {
    const bank = getBank(), state = getState(), knowledge = getKnowledge();
    const s = stats(state);
    const parents = bank.subjects.flatMap((s) =>
      s.chapters.filter((c) => !c.parentId),
    );
    const activeSubject = subject(getFilters().subjectId) ?? bank.subjects[0];
    return `${dailyTasksHTML(bank, state, { esc, attr, button })}<section class="local-hero"><div class="hero-copy"><span class="pill blue">${icon("spark", 14)} 知行学习</span><h1>学数学，<br><span>从每一道题开始。</span></h1><p>跟着章节梳理知识，在练习中找到思路。<br>${esc(bank.subjects.map((s) => s.name).join("、"))}题库，已经准备就绪。</p><div class="flex"><a class="btn primary" href="#/practice">开始刷题 ${icon("arrow", 16)}</a>${state.practice ? button("继续上次练习", "resume-practice", "", "btn") : `<a class="btn" href="#/exams">模拟考试</a>`}</div><div class="hero-source"><span class="status-dot"></span>打开即学 · 无需登录 · 自动保存进度</div></div><div class="math-visual" aria-hidden="true"><div class="math-orbit orbit-one"></div><div class="math-orbit orbit-two"></div><div class="math-grid"></div><div class="math-equation">∫<sub>a</sub><sup>b</sup> f(x) dx</div><div class="math-caption">把知识连成线，让思路更清晰</div><div class="float-formula formula-a">e<sup>iπ</sup> + 1 = 0</div><div class="float-formula formula-b">lim<sub>x→0</sub> sin x / x = 1</div></div></section><section class="card local-stat-strip">${[
      ["book", bank.questions.length.toLocaleString(), "原版题目"],
      ["folder", parents.length, "已接入章节"],
      ["target", s.today, "今日完成"],
      ["chart", s.total ? s.accuracy + "%" : "—", "累计正确率"],
    ]
      .map(
        ([i, v, l]) =>
          `<div>${icon(i, 22)}<span><b>${v}</b><small>${l}</small></span></div>`,
      )
      .join(
        "",
      )}</section>${reviewCard(spacedReview(bank, state), { button, icon })}<div class="course-tabs" role="navigation" aria-label="选择学习科目">${bank.subjects.map((s) => `<a href="#/?subject=${encodeURIComponent(s.id)}" class="course-tab ${s.id === activeSubject?.id ? "active" : ""}" ${s.id === activeSubject?.id ? 'aria-current="true"' : ""}><span class="course-symbol">${s.id === "linear" ? "A" : "∫"}</span><span><b>${esc(s.name)}</b><small>${getBankIndex(bank).subjectQuestions.get(s.id).length.toLocaleString()} 题 · ${s.chapters.filter((c) => !c.parentId).length} 章</small></span>${icon("arrow", 16)}</a>`).join("")}<a href="#/knowledge" class="course-tab knowledge-entry"><span class="course-symbol">${icon("book", 23)}</span><span><b>习概知识点</b><small>${knowledge.stats.notes ? `${knowledge.stats.notes} 篇笔记 · ${knowledge.stats.pdfCollections} 份汇编` : "查看复习资料"}</small></span>${icon("arrow", 16)}</a></div><div class="section-head"><h2>${esc(activeSubject?.name ?? "章节")} <small>选择章节，开始练习</small></h2><a href="#/practice?subject=${encodeURIComponent(activeSubject?.id ?? "")}" class="text-btn">全部章节 ${icon("arrow", 15)}</a></div>${chapterCards(false, activeSubject?.id)}<div class="grid-2 local-shortcuts"><a class="card" href="#/review"><span class="shortcut-icon pink">${icon("mistake", 23)}</span><div><h3>错题回顾</h3><p>查漏补缺，把薄弱知识点逐个巩固</p></div>${icon("arrow", 18)}</a><a class="card" href="#/favorites"><span class="shortcut-icon purple">${icon("star", 23)}</span><div><h3>我的收藏</h3><p>留下值得再练的题目，随时复习</p></div>${icon("arrow", 18)}</a></div>`;
  }
  function chapterCards(expanded = true, subjectId = "") {
    const bank = getBank(), state = getState();
    const filters = getFilters();
    const index = getBankIndex(bank);
    const practiced = new Set(state.attempts.filter((a) => isEffectiveAttempt(a, qById(a.questionId))).map((a) => a.questionId));
    return `<div class="chapter-grid">${bank.subjects
      .filter((s) => !subjectId || s.id === subjectId)
      .flatMap((s) =>
        s.chapters
          .filter((c) => !c.parentId)
          .map((c, i) => {
            const questions = index.chapterQuestions.get(s.id).get(c.id);
            const done = questions.filter((q) => practiced.has(q.id)).length;
            const children = s.chapters.filter((ch) => ch.parentId === c.id);
            const href = `#/practice?subject=${encodeURIComponent(s.id)}&chapter=${encodeURIComponent(c.id)}`;
            return `<section class="card chapter-card chapter-color-${i % 4}"><div class="chapter-card-head"><span class="chapter-glyph">${(s.id === "linear" ? ["|A|", "A", "r", "λ", "Q"] : ["ƒ", "∂", "f′", "∫", "∑", "→", "∇"])[i % (s.id === "linear" ? 5 : 7)]}</span><span class="pill">${questions.length} 题</span></div><a href="${href}" class="chapter-title"><span>CHAPTER ${String(i + 1).padStart(2, "0")}</span><h3>${esc(c.name.replace(/^第\d+章\s*/, ""))}</h3></a><p class="chapter-description">${children.length} 个小节 · 已练 ${done} 题</p><div class="progress-bar"><span style="width:${questions.length ? (done / questions.length) * 100 : 0}%"></span></div>${expanded ? `<details ${filters.chapterId === c.id || children.some((ch) => ch.id === filters.chapterId) ? "open" : ""}><summary>查看章节目录 ${icon("chevron", 13)}</summary><div class="section-list">${children.map((ch) => `<a href="#/practice?subject=${encodeURIComponent(s.id)}&chapter=${encodeURIComponent(ch.id)}" class="${filters.chapterId === ch.id ? "active" : ""}"><span>${esc(ch.name)}</span><small>${index.chapterQuestions.get(s.id).get(ch.id).length}题</small></a>`).join("")}</div></details>` : `<a class="chapter-link" href="${href}">进入章节 ${icon("arrow", 15)}</a>`}</section>`;
          }),
      )
      .join("")}</div>`;
  }

  function statsPage() {
    const bank = getBank(), state = getState();
    const s = stats(state);
    const daily = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      daily.push({
        date: dayKey(d),
        count: state.attempts.filter((a) => isEffectiveAttempt(a, qById(a.questionId)) && dayKey(a.at) === dayKey(d)).length,
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
      )}</div><div class="grid-2"><section class="card activity-card"><div class="card-head"><h2>近七天练习</h2><span class="muted" style="font-size:10px">单位：题次</span></div><div class="chart" role="img" aria-label="近七天练习数量">${daily.map((d) => `<div class="bar-column"><span class="bar-value">${d.count}</span><div class="bar" style="height:${Math.max(2, (d.count / max) * 100)}%"></div><span>${d.label}</span></div>`).join("")}</div></section><section class="card activity-card"><div class="card-head"><h2>学习足迹</h2><span class="pill">近十五周</span></div>${heatmap()}</section></div><div class="section-head"><h2>科目掌握情况</h2><span class="muted" style="font-size:10px">按实际答题记录计算</span></div><section class="card" style="padding:12px 24px">${bank.subjects
      .map((sub) => {
        const a = state.attempts.filter(
          (a) => a.subjectId === sub.id && isEffectiveAttempt(a, qById(a.questionId)),
        );
        const pct = a.length
          ? Math.round((a.filter((a) => a.correct).length / a.length) * 100)
          : 0;
        return `<div class="chapter-row"><span class="grow">${esc(sub.name)}</span><span class="muted">${a.length} 次练习</span><div class="progress-bar"><span style="width:${pct}%"></span></div><span style="width:35px;text-align:right">${a.length ? pct + "%" : "—"}</span></div>`;
      })
      .join("")}</section>`;
  }

  return { dashboard, chapterCards, statsPage };
}
