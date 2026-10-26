import { getBankIndex } from "./core.mjs";
import { preparationPlans, preparationTrends } from "./study.mjs";

export function reviewCard(review, { button, icon }, { inPreparation = false } = {}) {
  const next = review.upcoming[0];
  return `<section class="card spaced-overview"><div><span class="pill blue">${icon("clock", 14)} 间隔复习</span><h2>${review.due.length ? `${review.due.length} 道题到了复习时间` : review.schedule.size ? "今天的到期题已复习完" : "给学过的题安排一次重温"}</h2><p class="subtitle">${review.schedule.size ? `${next ? `下次复习：${new Date(next.dueAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}。` : ""}按 1、3、7、14、30、60 天逐步延长间隔，答错后回到 1 天。` : "完成答题后自动安排复习，到期题会在这里出现。"}${inPreparation ? "备考抽题也会提高范围内到期题的权重。" : ""}</p></div><div class="flex">${review.due.length ? button("开始到期复习", "start-spaced", inPreparation ? 'data-scope="preparation"' : "", "btn primary") : ""}<a class="btn" href="#/spaced">查看复习计划</a></div></section>`;
}

export function conceptPanel(concepts, { esc, attr, button }) {
  return `<section class="card concept-panel"><h2>跨章节知识关联</h2><p class="subtitle">根据章节标题和题目知识点标签关联训练；相关概念答错后，所选范围内其他章节的关联题也会增加频率。</p>${concepts.length ? `<div class="concept-grid">${concepts.slice(0, 6).map((c) => `<article><strong>${esc(c.name)}</strong><p>关联 ${c.chapters.size} 个小节 · 当前范围 ${c.inScope} 题</p>${button("查看关联章节", "concept-details", `data-name="${attr(c.name)}"`, "btn small")}</article>`).join("")}</div>` : `<p class="muted">完成带有关联知识点的题目后，显示相关章节。</p>`}<p class="format-note">章节主题关联覆盖该小节全部题目。训练仅在所选范围进行，可查看关联章节后调整范围。</p></section>`;
}

export function trendPanel(bank, state, selectedId, { esc, attr }) {
  const plans = preparationPlans(state);
  const selected = plans.find((p) => p.id === selectedId) ?? plans.find((p) => p.id === state.preparation?.id) ?? plans[0];
  const rows = preparationTrends(bank, state, selected?.id);
  const completed = rows.filter((r) => r.ready), points = completed.slice(-12);
  const index = getBankIndex(bank);
  const planName = (p) => `${index.subjects.get(p.subjectId)?.name ?? p.subjectId} · ${new Date(p.startedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  const scope = selected?.chapterIds.map((id) => index.chapters.get(selected.subjectId)?.get(id)?.name).filter(Boolean).join("、");
  const delta = completed.length > 1 ? completed.at(-1).accuracy - completed[0].accuracy : null;
  const pointLabel = (r) => r.mode === "prepare-diagnostic" ? "测评" : `第 ${r.round} 组`;
  const x = (i) => points.length === 1 ? 350 : 50 + i * 570 / (points.length - 1);
  const y = (r) => 165 - r.accuracy * 1.3;
  return `<section id="preparation-trends" class="card preparation-trends"><div class="section-head"><h2>备考成绩趋势</h2>${delta !== null ? `<span class="pill ${delta >= 0 ? "green" : ""}">较首组 ${delta >= 0 ? "+" : ""}${delta} 个百分点</span>` : ""}</div>${plans.length ? `<div class="field"><label for="trend-plan">查看备考计划</label><select id="trend-plan">${plans.map((p) => `<option value="${attr(p.id)}" ${p.id === selected?.id ? "selected" : ""}>${esc(planName(p))}${p.id === state.preparation?.id ? " · 当前" : " · 历史"}</option>`).join("")}</select></div><p class="subtitle">${esc(scope)}</p>` : ""}${points.length ? `<div class="trend-chart-wrap" tabindex="0" role="region" aria-label="可左右滑动的正确率趋势图"><svg class="trend-chart" viewBox="0 0 680 220" role="img" aria-label="所选计划最近 ${points.length} 组已完成测评和训练的正确率趋势"><title>正确率趋势，详细数值见下方表格</title>${[0, 50, 100].map((v) => `<line x1="50" x2="620" y1="${165 - v * 1.3}" y2="${165 - v * 1.3}" class="trend-grid"/><text x="40" y="${169 - v * 1.3}" text-anchor="end">${v}%</text>`).join("")}<polyline class="trend-line" points="${points.map((r, i) => `${x(i)},${y(r)}`).join(" ")}"/>${points.map((r, i) => `<circle class="trend-point" cx="${x(i)}" cy="${y(r)}" r="5"><title>${pointLabel(r)}：${r.accuracy}%</title></circle><text x="${x(i)}" y="${y(r) - 12}" text-anchor="middle">${r.accuracy}%</text><text x="${x(i)}" y="190" text-anchor="middle">${pointLabel(r)}</text>`).join("")}</svg></div>` : `<p class="muted trend-empty">完成首组测评后生成趋势图。未完成组仅显示作答进度。</p>`}${rows.length ? `<div class="trend-table-wrap" tabindex="0" role="region" aria-label="备考逐组成绩"><table class="trend-table"><thead><tr><th>阶段</th><th>作答时间</th><th>作答</th><th>正确率</th></tr></thead><tbody>${[...rows].reverse().map((r) => `<tr><td>${pointLabel(r)}${r.ready ? "" : " · 未完成"}</td><td>${esc(new Date(r.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</td><td>${r.completed}/${r.total}</td><td>${r.accuracy}%</td></tr>`).join("")}</tbody></table></div>` : ""}<p class="format-note">每份计划单独比较，图表显示最近 12 组已完成结果，表格保留全部记录。图表可左右滑动。加权训练的题目分布会变化，请结合复习重点看待正确率。</p></section>`;
}
