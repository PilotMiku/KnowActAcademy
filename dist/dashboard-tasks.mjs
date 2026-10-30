import { stats } from "./core.mjs";
import { currentPreparationPractice, diagnosticProgress, practiceProgress } from "./preparation.mjs";
import { spacedReview } from "./study.mjs";

export function dailyTasks(bank, state, now = Date.now()) {
  const completed = stats(state, now).today;
  const goal = state.dailyGoal;
  const exam = state.exams.find(e => e.status === "active" && e.endsAt > now) ?? null;
  const session = currentPreparationPractice(state);
  const preparation = state.preparation ? {
    subjectId: state.preparation.subjectId,
    diagnostic: !diagnosticProgress(state).ready,
    progress: session ? practiceProgress(session) : null,
  } : null;
  const practice = state.practice && !state.practice.preparationId ? {
    progress: practiceProgress(state.practice), mode: state.practice.mode,
  } : null;
  return { completed, goal, remaining: Math.max(0, goal - completed), exam, preparation, practice,
    due: spacedReview(bank, state, now).due.length };
}

export function dailyTasksHTML(bank, state, ui) {
  const { esc, attr, button } = ui;
  const tasks = dailyTasks(bank, state);
  const percent = Math.min(100, Math.round(tasks.completed / tasks.goal * 100));
  const items = [];
  if (tasks.exam) items.push(`<article><strong>模拟考试进行中</strong><p>${tasks.exam.questionIds.length} 题，交卷后查看成绩</p><a class="btn primary" href="#/exam/${attr(encodeURIComponent(tasks.exam.id))}">继续模拟考试</a></article>`);
  if (tasks.preparation) {
    const prep = tasks.preparation, progress = prep.progress;
    const name = bank.subjects.find(s => s.id === prep.subjectId)?.name ?? "当前科目";
    const ready = !prep.diagnostic && (!progress || progress.ready);
    items.push(`<article><strong>${esc(name)} · ${prep.diagnostic ? "备考测评" : "备考训练"}</strong><p>${progress ? `本组已完成 ${progress.completed} / ${progress.total} 题` : "已保留备考范围和历史成绩"}</p>${button(ready ? "开始下一组备考" : "继续备考训练", ready ? "next-training" : "resume-preparation", "", tasks.exam ? "btn" : "btn primary")}</article>`);
  }
  if (tasks.practice && !tasks.practice.progress.ready) {
    const progress = tasks.practice.progress;
    items.push(`<article><strong>上次练习还没完成</strong><p>已完成 ${progress.completed} / ${progress.total} 题，继续保留原顺序</p>${button("继续章节练习", "resume-practice", "", tasks.exam || tasks.preparation ? "btn" : "btn primary")}</article>`);
  }
  items.push(`<article><strong>${tasks.due ? `待复习 ${tasks.due} 题` : "到期复习已安排"}</strong><p>${tasks.due ? "先巩固快忘记的题，再练新题" : "做过的题会按复习间隔回到这里"}</p>${tasks.due ? button("复习到期题", "start-spaced", "", items.length ? "btn" : "btn primary") : '<a class="btn" href="#/spaced">查看复习安排</a>'}</article>`);
  if (!tasks.exam && !tasks.preparation && (!tasks.practice || tasks.practice.progress.ready))
    items.unshift('<article><strong>开始今天的练习</strong><p>选择章节，或围绕薄弱项开展备考训练</p><a class="btn primary" href="#/practice">选择今天的练习</a></article>');
  return `<section class="card daily-tasks" aria-label="今日学习安排"><div class="daily-task-head"><div><span class="pill blue">今天接着学</span><h2>${tasks.remaining ? `距离今日目标还差 ${tasks.remaining} 题` : "今天的学习目标已完成"}</h2><p>今日有效作答 ${tasks.completed} 题次 · 目标 ${tasks.goal} 题</p></div>${button("调整每日目标", "goal", "", "btn small")}</div><div class="progress-bar" role="progressbar" aria-label="每日目标题量" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div><div class="daily-task-items">${items.join("")}</div></section>`;
}
