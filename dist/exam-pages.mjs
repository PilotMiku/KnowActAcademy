import { getBankIndex } from "./core.mjs";
import { examChapterSummary } from "./exam-view.mjs";
import { questionNotesHTML } from "./question-notes.mjs";
import { icon, esc, attr, button, head, empty } from "./ui.mjs";

export function createExamPages({ getBank, getState, subject, qById, shortDate, bankNotice,
  currentExam, currentQuestion, questionToolbar, sourceInfo, answerInput, questionNavigation, resultBox, names }) {
  function examsPage() {
    const state = getState();
    const active = state.exams.find((e) => e.status === "active");
    return `${head("在正式考试前，先遇见自己。", "用一次限时练习，找到节奏，也找到还需要补上的一块。", button(`${icon("plus", 15)} 新建模拟考试`, "create-exam", "", "btn primary"))}${bankNotice()}${active ? `<div class="notice">${icon("clock", 18)}<div><strong>有一场考试正在进行</strong><p>答案已保存，计时会继续。</p></div><a href="#/exam/${encodeURIComponent(active.id)}" class="btn small">继续考试 ${icon("arrow", 13)}</a></div>` : ""}<div class="section-head"><h2>考试记录</h2><span class="muted" style="font-size:11px">${state.exams.length} 场</span></div>${
      state.exams.length
        ? `<div class="stack">${[...state.exams]
            .reverse()
            .map(
              (e, i) =>
                `<article class="card exam-card"><div class="exam-score ${e.status === "active" ? "active" : ""}">${e.status === "active" ? icon("clock", 28) : e.score}<small>${e.status === "active" ? "进行中" : "得分 / 100"}</small></div><div class="grow"><h3 style="font-size:13px">${examScope(e)}模拟考试</h3><p class="subtitle" style="font-size:10px">${shortDate(e.startedAt)} · ${e.questionIds.length} 题 · ${e.minutes} 分钟</p></div><a class="btn small" href="#/exam/${encodeURIComponent(e.id)}">${e.status === "active" ? "继续考试" : "查看报告"} ${icon("arrow", 12)}</a></article>`,
            )
            .join("")}</div>`
        : `<section class="card">${empty("第一场模拟考试，从这里开始", "选择科目、大章节、题量和时长。系统会从所选范围中抽题，交卷后生成报告。", button(`${icon("plus", 14)} 创建考试`, "create-exam", "", "btn primary"))}</section>`
    }`;
  }
  function examScope(e) {
    const bank = getBank();
    const s = subject(e.subjectId);
    const selected = Array.isArray(e.chapters) ? e.chapters
      : e.chapterId ? [{ subjectId: e.subjectId, chapterId: e.chapterId }] : [];
    const chapters = selected.map((selection) => {
      const name = getBankIndex(bank).chapters.get(selection.subjectId)?.get(selection.chapterId)?.name;
      return name ? `${s ? "" : `${subject(selection.subjectId)?.name ?? ""} `}${name}` : "";
    }).filter(Boolean);
    return esc([s?.name ?? "综合", chapters.join("、")].filter(Boolean).join(" · "));
  }
  function timeRemaining(e) {
    const total = Math.max(0, Math.ceil((e.endsAt - Date.now()) / 1000));
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }
  function examPage() {
    const e = currentExam();
    if (!e)
      return `<section class="card">${empty("没有找到这场考试", "可以返回考试记录查看其他试卷。", `<a class="btn primary" href="#/exams">考试记录</a>`)}</section>`;
    if (e.status === "submitted") return examReport(e);
    const q = currentQuestion();
    if (!q) return empty("题目不可用", "请恢复考试对应的题库。");
    return `${head("模拟考试", `${examScope(e)} · ${e.questionIds.length} 题 · ${e.minutes} 分钟`, `<a href="#/exams" class="btn">${icon("back", 13)} 考试记录</a>`)}${questionToolbar()}<div class="question-layout"><section class="card question-main"><div class="question-top"><span class="pill blue">${names[q.type]}</span><span class="muted" style="font-size:11px">第 ${e.index + 1} / ${e.questionIds.length} 题</span></div>${sourceInfo(q)}<div class="question-title rich" data-rich="${attr(q.stem)}"></div>${q.source ? `<p class="pdf-reading-note">长公式可左右滑动查看</p>` : ""}${answerInput(q, e.answers[q.id] ?? (q.type === "multiple" ? [] : ""), false)}<div class="question-actions">${button(`${icon("back", 13)} 上一题`, "navigate-question", `data-index="${e.index - 1}" ${e.index === 0 ? "disabled" : ""}`, "btn")}<span class="grow"></span>${e.index < e.questionIds.length - 1 ? button(`下一题 ${icon("arrow", 13)}`, "navigate-question", `data-index="${e.index + 1}"`, "btn primary") : button("提交试卷", "submit-exam", "", "btn coral")}</div></section>${questionNavigation(e, true)}</div>`;
  }
  function examReport(e) {
    const bank = getBank(), state = getState();
    const wrong = e.questionIds
      .filter((id) => e.results[id] === false)
      .map(qById)
      .filter(Boolean);
    return `${head("每一次检验，都带来新的方向。", "把分数放在一边，也看看自己真正学会了什么。", `<a href="#/exams" class="btn">${icon("back", 13)} 考试记录</a>`)}<section class="card score-hero"><span class="pill green">${e.timedOut ? "时间到，已自动交卷" : "本次考试已完成"}</span><div class="score">${e.score}<span style="font-size:19px"> 分</span></div><p>${examScope(e)}模拟考试</p><div class="score-meta"><span><b>${e.correct}/${e.questionIds.length}</b>答对题目</span><span><b>${Math.min(e.minutes, Math.max(1, Math.ceil((e.submittedAt - e.startedAt) / 60000)))}</b>用时 / 分钟</span><span><b>${wrong.length}</b>待巩固题目</span></div></section>${examChapterSummary(bank, e, { esc })}<div class="section-head"><h2>逐题回顾</h2><span class="muted" style="font-size:10px">本次错题已进入错题本</span></div><div class="stack">${e.questionIds
      .map((id, i) => {
        const q = qById(id);
        if (!q) return "";
        return `<section class="card question-main"><div class="question-top"><span class="pill ${e.results[id] ? "green" : "coral"}">第 ${i + 1} 题 · ${e.results[id] ? "正确" : "待巩固"}</span>${button(icon("star", 16), "toggle-favorite", `data-id="${attr(id)}" aria-label="收藏题目"`, "icon-btn")}</div>${sourceInfo(q)}<div class="question-title rich" data-rich="${attr(q.stem)}"></div>${q.source ? `<p class="pdf-reading-note">长公式可左右滑动查看</p>` : ""}<p class="answer-line">你的答案：${esc(Array.isArray(e.answers[id]) ? e.answers[id].join("、") : (e.answers[id] ?? "未作答"))}${e.uncertainIds?.includes(id) ? " · 曾标记拿不准" : ""}${e.questionTimes ? ` · 本题用时 ${Math.round((e.questionTimes[id] ?? 0) / 1000)} 秒` : ""}</p>${resultBox(q, { correct: e.results[id], graded: true, uncertain: e.uncertainIds?.includes(id) }, { mode: "exam" })}${questionNotesHTML(id, state, { esc, attr })}</section>`;
      })
      .join("")}</div>`;
  }

  return { examsPage, examPage, timeRemaining };
}
