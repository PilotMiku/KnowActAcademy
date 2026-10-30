import { icon, brandIcon, esc, attr, button, head, empty } from "./ui.mjs";
import { renderRich } from "./rich-content.mjs";
import { createOverviewPages } from "./overview-pages.mjs";
import { createCollectionPages } from "./collection-pages.mjs";
import { createExamPages } from "./exam-pages.mjs";
import { createSessionActions } from "./session-actions.mjs";
import { createSyncClient, PROGRESS_FORMAT } from "./sync.mjs";
import {
  BANK_FORMAT,
  BACKUP_FORMAT,
  emptyBank,
  emptyState,
  normalizeBank,
  judge,
  hasResponse,
  shuffle,
  filterQuestions,
  getBankIndex,
  examQuestions,
  createPractice,
  recordAttempt,
  createExam,
  finishExam,
  dayKey,
  stats,
  validateBackup,
  textOnly,
} from "./core.mjs";
import { openStorage, saveStorage, onStorageConflict, storageConflicted, StorageConflictError } from "./storage.mjs";
import {
  PREPARATION_COUNT, preparationQuestions, diagnosticProgress,
  preparationProfile, trainingCount, practiceProgress,
  currentPreparationPractice,
  preparationMetrics, syncPreparationMistakes,
} from "./preparation.mjs";
import { getConceptIndex } from "./concepts.mjs";
import { practicePool } from "./study-planning.mjs";
import { applyPreferences } from "./preferences.mjs";
import { displaySettingsHTML } from "./preferences-view.mjs";
import { questionNotesHTML, installQuestionNotes } from "./question-notes.mjs";
import { welcomePage, enterStudy, cancelWelcomeExit } from "./welcome.mjs";
import { createSaveScheduler } from "./save-scheduler.mjs";
import { pauseExamQuestion, resumeExamQuestion } from "./exam-timing.mjs";
import { pausePracticeQuestion, resumePracticeQuestion } from "./practice-timing.mjs";
import { feedbackHTML, patchPracticeAnswer } from "./question-view.mjs";
import { spacedReview, learningProgress } from "./study.mjs";
import { reviewCard, conceptPanel, trendPanel, learningProgressCard, preparationStatusCard } from "./study-view.mjs";
import {
  emptyKnowledge,
  normalizeKnowledgeRecords,
  knowledgePage,
  filterKnowledge,
} from "./knowledge.mjs";

let knowledge = emptyKnowledge();
const sync = createSyncClient();
let configuredAPI = "";
async function loadConfig() {
  try {
    const response = await fetch("./config.json", { cache: "no-store" });
    if (response.ok) return String((await response.json()).apiBase || "");
  } catch { /* Optional backend configuration never blocks local study. */ }
  return "";
}

async function loadKnowledge() {
  try {
    const response = await fetch("./data/knowledge.json", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("请先生成知识点索引并重新启动网站");
    const data = await response.json();
    if (!Array.isArray(data.articles) || !data.sources)
      throw new Error("知识点数据格式不完整");
    return data;
  } catch (error) {
    return { ...emptyKnowledge(), error: error.message };
  }
}

let bank = emptyBank(),
  state = emptyState(),
  storageReady = false,
  saving = Promise.resolve(),
  mobileOpen = false;
let toastTimer,
  timerInterval,
  fileMode = "bank",
  pendingImport = null,
  autoSubmitting = false,
  startingSession = false;
let displayedExam = null;
let displayedPractice = null;
const app = document.querySelector("#app"),
  dialog = document.querySelector("#dialog");
const names = {
  single: "单选题",
  multiple: "多选题",
  boolean: "判断题",
  fill: "填空题",
  solution: "解答题",
};
const difficultyNames = { easy: "基础", medium: "进阶", hard: "挑战" };
const DEFAULT_QUESTION_COUNT = 25;
const routes = {
  welcome: "起始页",
  dashboard: "学习概览",
  practice: "题库练习",
  prepare: "备考模式",
  spaced: "间隔复习",
  exams: "模拟考试",
  exam: "模拟考试",
  review: "错题本",
  favorites: "我的收藏",
  stats: "学习统计",
  library: "题库管理",
  knowledge: "习概知识点",
};
function route() {
  const [path, query = ""] = (location.hash.slice(1) || "/").split("?");
  return {
    parts: path.split("/").filter(Boolean),
    query: new URLSearchParams(query),
    page: !location.hash ? "welcome" : path === "/" ? "dashboard" : path.split("/")[1],
  };
}
function go(path) {
  dialog.close();
  mobileOpen = false;
  if (location.hash === `#${path}`) render();
  else location.hash = path;
}
function subject(id) {
  return getBankIndex(bank).subjects.get(id);
}
function chapter(q) {
  return (
    getBankIndex(bank).chapters.get(q.subjectId)?.get(q.chapterId)?.name ??
    q.chapterId
  );
}
function qById(id) {
  return getBankIndex(bank).questions.get(id);
}
function shortDate(at) {
  return new Date(at).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function toast(message) {
  clearTimeout(toastTimer);
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("show");
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}
function persist() {
  deferredSaves.cancel();
  if (!storageReady)
    return Promise.reject(new Error("当前浏览器无法保存学习数据"));
  const practiceRunning = Number.isFinite(displayedPractice?.questionStartedAt);
  const examRunning = Number.isFinite(displayedExam?.questionStartedAt);
  pausePracticeQuestion(displayedPractice);
  pauseExamQuestion(displayedExam);
  if (state.preparation && state.practice?.preparationId === state.preparation.id)
    state.preparation.session = structuredClone(state.practice);
  saving = saveStorage(bank, state);
  if (!document.hidden && !storageConflicted()) {
    if (practiceRunning) resumePracticeQuestion(displayedPractice);
    if (examRunning) resumeExamQuestion(displayedExam);
  }
  saving.catch((error) => {
    for (const status of document.querySelectorAll("[data-note-status]")) status.textContent = "尚未保存，请先导出此页备份";
    if (!(error instanceof StorageConflictError)) toast("保存失败，请检查浏览器可用空间，并导出备份");
  });
  saving.then(() => {
    if (!deferredSaves.pending)
      for (const status of document.querySelectorAll("[data-note-status]")) status.textContent = "已保存";
  }, () => {});
  return saving;
}
const deferredSaves = createSaveScheduler(() => persist(), () => toast("保存失败，请导出备份"));
installQuestionNotes({ getState: () => state, getQuestion: qById,
  save: () => persist(), schedule: () => deferredSaves.schedule() });
onStorageConflict(() => {
  pausePracticeQuestion(displayedPractice);
  pauseExamQuestion(displayedExam);
  deferredSaves.cancel();
  clearInterval(timerInterval);
  dialog.close();
  app.inert = true;
  document.querySelector("#storage-conflict").hidden = false;
});
document.querySelector("#reload-latest").addEventListener("click", () => location.reload());
document.querySelector("#export-stale-page").addEventListener("click", () => {
  download(`知行学习-此页备份-${dayKey()}.json`, { format: BACKUP_FORMAT, bank, state });
});
function bankNotice() {
  return !bank.questions.length
    ? `<div class="notice">${icon("info", 17)}<div><strong>题库准备中，学习空间已就绪</strong><p>导入 NeuMathe 原题后，题目、答案与解析将按原始数据展示。</p></div><a class="btn small" href="#/library">去导入 ${icon("arrow", 12)}</a></div>`
    : "";
}
function getFilters() {
  const { query } = route();
  return {
    subjectId: query.get("subject") ?? "",
    chapterId: query.get("chapter") ?? "",
    type: query.get("type") ?? "",
    search: query.get("q") ?? "",
    status: query.get("status") ?? "",
  };
}
function filtersHTML(filters, search = true) {
  const selectedSubjects = bank.subjects.filter(
    (s) => !filters.subjectId || s.id === filters.subjectId,
  );
  return `<div class="card filter-bar"><div class="field"><label for="subject-filter">科目</label><select id="subject-filter" data-filter="subject"><option value="">全部科目</option>${bank.subjects.map((s) => `<option value="${attr(s.id)}" ${s.id === filters.subjectId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div><div class="field"><label for="chapter-filter">章节</label><select id="chapter-filter" data-filter="chapter"><option value="">全部章节</option>${selectedSubjects.map((s) => `<optgroup label="${attr(s.name)}">${s.chapters.map((c) => `<option value="${attr(c.id)}" ${c.id === filters.chapterId ? "selected" : ""}>${c.parentId ? "　↳ " : ""}${esc(c.name)}</option>`).join("")}</optgroup>`).join("")}</select></div><div class="field"><label for="type-filter">题型</label><select id="type-filter" data-filter="type"><option value="">全部题型</option>${Object.entries(
    names,
  )
    .map(
      ([k, v]) =>
        `<option value="${k}" ${filters.type === k ? "selected" : ""}>${v}</option>`,
    )
    .join(
      "",
    )}</select></div>${search ? `<div class="field"><label for="question-search">关键词</label><input class="input" id="question-search" type="search" data-filter="q" value="${attr(filters.search)}" placeholder="搜索题干或标签"></div>` : ""}</div>`;
}
function practiceControls() {
  const query = route().query;
  return `<div class="practice-extra-controls"><div class="field"><label for="practice-status">练习范围</label><select id="practice-status" data-filter="status"><option value="">全部题目</option><option value="unseen" ${query.get("status") === "unseen" ? "selected" : ""}>只练未做题</option><option value="unmastered" ${query.get("status") === "unmastered" ? "selected" : ""}>只练未掌握题</option></select></div><div class="field"><label for="random-distribution">随机抽题方式</label><select id="random-distribution" data-filter="distribution"><option value="random">题目均匀随机</option><option value="balanced" ${query.get("distribution") === "balanced" ? "selected" : ""}>按大章节均衡抽题</option></select></div><p class="format-note">未掌握题按连续两次确定答对判断，备考范围使用当前计划的掌握状态。</p></div>`;
}
function questionToolbar() {
  const q = currentQuestion(), exam = currentExam(), p = state.practice;
  if (!q) return "";
  const uncertain = exam ? exam.uncertainIds?.includes(q.id) : p?.responses[q.id]?.uncertain;
  const locked = !exam && p?.responses[q.id]?.graded;
  return `<div class="question-toolbar">${button(`${icon("target", 15)} ${state.studySettings.focus ? "退出专注" : "专注模式"}`, "toggle-focus", `aria-pressed="${state.studySettings.focus}"`, "btn small")}${button(`${icon("settings", 15)} 学习显示设置`, "display-settings", "", "btn small")}${button(uncertain ? "? 已标记拿不准" : "? 这题拿不准", "toggle-uncertain", `aria-pressed="${!!uncertain}" ${locked ? "disabled" : ""}`, "btn small uncertain-control")}</div>`;
}
function practicePage() {
  if (route().query.has("session") && state.practice) return practiceSession();
  const filters = getFilters();
  const questions = practicePool(bank, filters, state);
  const randomCount = route().query.get("count") === "all" ? "all" : "25";
  return `${head("章节练习", "选择章节与知识点，按自己的节奏练习。", state.practice ? button(`继续上次练习 ${icon("arrow", 14)}`, "resume-practice", "", "btn soft") : "")}${filtersHTML(filters)}${learningProgressCard(learningProgress(filterQuestions(bank, filters, state), state))}${practiceControls()}<section class="card practice-start"><div><span class="pill blue">${esc(subject(filters.subjectId)?.name ?? "全部科目")}</span><h2>${filters.chapterId ? esc(bank.subjects.filter((s) => !filters.subjectId || s.id === filters.subjectId).flatMap((s) => s.chapters).find((c) => c.id === filters.chapterId)?.name ?? "当前章节") : "全部题目"}</h2><p>当前范围共 <strong>${questions.length}</strong> 道题 · 题目、答案来自你提供的 PDF</p></div><div class="practice-controls">${button(`${icon("book", 17)} 顺序练习`, "start-practice", `data-mode="sequential" ${questions.length ? "" : "disabled"}`, "btn primary")}<div class="random-controls"><div class="field"><label for="random-count">随机题量</label><select id="random-count" data-filter="count"><option value="25" ${randomCount === "25" ? "selected" : ""}>25 题</option><option value="all" ${randomCount === "all" ? "selected" : ""}>所有题目（${questions.length} 题）</option></select></div>${button(`${icon("refresh", 17)} ${randomCount === "all" ? "随机所有题目" : `随机 ${DEFAULT_QUESTION_COUNT} 题`}`, "start-practice", `data-mode="random" ${questions.length ? "" : "disabled"}`, "btn")}</div><a href="#/prepare" class="text-btn">${icon("target", 15)} 备考模式：先测评，再专项训练</a></div></section><div class="section-head"><h2>章节目录 <small>展开查看小节</small></h2><span class="muted">${bank.subjects.filter((s) => !filters.subjectId || s.id === filters.subjectId).flatMap((s) => s.chapters.filter((c) => !c.parentId)).length} 章 · ${bank.subjects.filter((s) => !filters.subjectId || s.id === filters.subjectId).flatMap((s) => s.chapters.filter((c) => c.parentId)).length} 个小节</span></div>${bank.subjects
    .filter((s) => !filters.subjectId || s.id === filters.subjectId)
    .map(
      (s) =>
        `<section class="subject-chapters"><h3 class="subject-label">${esc(s.name)}</h3>${chapterCards(true, s.id)}</section>`,
    )
    .join("")}${
    questions.length
      ? `<div class="section-head"><h2>题目列表 <small>前 ${Math.min(20, questions.length)} 题，顺序练习可访问全部</small></h2></div><section class="card">${questions
          .slice(0, 20)
          .map((q, i) => collectionRow(q, i, "preview"))
          .join("")}</section>`
      : empty(
          "没有符合条件的题目",
          "请切换章节或清除关键词。",
          `<a class="btn" href="#/practice">查看全部</a>`,
        )
  }`;
}
function preparationSelection() {
  const query = route().query;
  const subjectId = subject(query.get("subject"))?.id ?? state.preparation?.subjectId ?? bank.subjects[0]?.id ?? "";
  return { subjectId, roundPolicy: query.get("roundPolicy") ?? state.preparation?.roundPolicy ?? "adaptive", chapterIds: query.has("scope") ? query.getAll("chapter")
    : state.preparation?.subjectId === subjectId ? state.preparation.chapterIds
    : (subject(subjectId)?.chapters.filter((c) => !c.parentId).map((c) => c.id) ?? []) };
}
function preparationTopics() {
  const profile = preparationProfile(bank, state);
  const topics = profile.topics;
  return `<section class="card preparation-topics"><h2>复习重点</h2><p class="subtitle">按本次备考的小节与题型调整出题频率。答错后增加，答对后逐步减少；每组结束后重新抽题。</p>${topics.length ? `<div class="preparation-topic-list">${topics.slice(0, 8).map((t) => `<div class="preparation-topic"><div><strong>${esc(getBankIndex(bank).chapters.get(t.subjectId)?.get(t.chapterId)?.name)}</strong><small>${names[t.type]} · 已答 ${t.answered} 次 · 答对 ${t.correct} 次</small></div><span class="pill ${t.priority > 1.15 ? "blue" : t.priority < 0.85 ? "green" : ""}">${t.priority > 1.15 ? "加强训练" : t.priority < 0.85 ? "减少频率" : "常规巩固"}</span></div>`).join("")}</div>` : `<p class="muted">完成测评后，这里会显示你的复习重点。</p>`}<p class="format-note">其他知识点仍有机会抽中，同组题目不重复；上一组题目适当降低频率，兼顾新题和复习。</p></section>${conceptPanel(profile.concepts, { esc, attr, button })}`;
}
function preparationPage() {
  if (route().query.has("session") && state.practice?.preparationId === state.preparation?.id && state.preparation)
    return practiceSession();
  const selection = preparationSelection();
  const available = preparationQuestions(bank, selection).length;
  const prep = state.preparation;
  const diagnostic = diagnosticProgress(state);
  const active = currentPreparationPractice(state);
  const unfinished = active && !practiceProgress(active).ready;
  const scope = prep ? prep.chapterIds.map((id) => getBankIndex(bank).chapters.get(prep.subjectId)?.get(id)?.name).filter(Boolean).join("、") : "";
  return `${head("备考模式", "先随机测评，再围绕薄弱知识点加权刷题。掌握得越好，相关题目出现得越少。")}${prep ? `${preparationStatus()}<section class="card preparation-current"><div><span class="pill blue">当前备考 · ${esc(subject(prep.subjectId)?.name)}</span><h2>${diagnostic.ready ? "测评完成，开始专项巩固" : `测评进度 ${diagnostic.completed} / ${diagnostic.total}`}</h2><p>${esc(scope)}</p><p class="muted">${diagnostic.ready ? `已开启 ${prep.round} 组加权训练` : "请完成全部测评题，解答题对照答案自评后计入。"}</p></div><div class="flex">${unfinished || !diagnostic.ready ? button("继续备考", "resume-preparation", "", "btn primary") : button(`开始加权训练 · ${trainingCount(bank, prep)} 题`, "next-training", "", "btn primary")}${active && !unfinished ? button("查看本组结果", "resume-preparation") : ""}</div></section>${preparationReviewCard()}${preparationTopics()}` : ""}${trendPanel(bank, state, route().query.get("plan"), { esc, attr })}<section class="card preparation-setup"><h2>${prep ? "重新选择备考范围" : "选择备考范围"}</h2><p class="subtitle">一次选择一个科目，可勾选多个大章或小节。大章包含下属全部小节。</p><div class="field"><label for="prepare-subject">备考科目</label><select id="prepare-subject">${bank.subjects.map((s) => `<option value="${attr(s.id)}" ${s.id === selection.subjectId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div><fieldset class="exam-chapters preparation-chapters" aria-describedby="prepare-availability"><legend>章节范围（可多选）</legend><div class="flex">${button("全选大章", "prepare-select-all", "", "btn small")}${button("清空选择", "prepare-select-none", "", "btn small")}</div><div class="preparation-chapter-options">${(subject(selection.subjectId)?.chapters ?? []).map((c) => `<label class="${c.parentId ? "preparation-subchapter" : "preparation-root"}"><input type="checkbox" data-prepare-chapter value="${attr(c.id)}" ${selection.chapterIds.includes(c.id) ? "checked" : ""}><span>${esc(c.name)}</span><small>${getBankIndex(bank).chapterQuestions.get(selection.subjectId).get(c.id).length} 题</small></label>`).join("")}</div></fieldset><div id="prepare-learning-progress">${learningProgressCard(learningProgress(preparationQuestions(bank, selection), state))}</div><div class="field"><label for="prepare-round-policy">后续训练题量</label><select id="prepare-round-policy"><option value="adaptive" ${selection.roundPolicy === "adaptive" ? "selected" : ""}>自动强化：小题库使用短组</option><option value="fixed" ${selection.roundPolicy === "fixed" ? "selected" : ""}>固定 20 题，不足则全部</option></select></div><p id="prepare-availability" aria-live="polite">${preparationAvailability(available)}</p><p class="format-note">${prep ? "重新测评会建立新的备考计划，已有答题记录保留。" : "首组均匀随机抽题，不受历史成绩影响。"}选择、判断、填空题自动判分，解答题需自评。</p>${button(`开始 ${PREPARATION_COUNT} 题测评`, "begin-preparation", available ? "" : "disabled", "btn primary")}</section>`;
}
function preparationAvailability(count) {
  return count ? `所选范围共 ${count} 道题，本次测评 ${Math.min(PREPARATION_COUNT, count)} 道${count < PREPARATION_COUNT ? "（不足 20 题，使用全部题目）" : ""}。`
    : "当前范围没有题目，请至少选择一个有题目的章节。";
}
function preparationReviewCard() {
  const review = spacedReview(bank, state);
  const allowed = new Set(preparationQuestions(bank, state.preparation).map((q) => q.id));
  return reviewCard({ schedule: new Map([...review.schedule].filter(([id]) => allowed.has(id))),
    due: review.due.filter((item) => allowed.has(item.questionId)),
    upcoming: review.upcoming.filter((item) => allowed.has(item.questionId)),
  }, { button, icon }, { inPreparation: true });
}
function spacedReviewPage() {
  const allowed = new Set(filterQuestions(bank, getFilters(), state).map((q) => q.id));
  const all = spacedReview(bank, state);
  const review = { schedule: new Map([...all.schedule].filter(([id]) => allowed.has(id))),
    due: all.due.filter((item) => allowed.has(item.questionId)),
    upcoming: all.upcoming.filter((item) => allowed.has(item.questionId)) };
  const rows = (items, due) => items.map((item) => {
    const q = qById(item.questionId);
    return `<article class="collection-item spaced-item"><div class="grow"><div class="collection-stem">${esc(q.sourceLabel || textOnly(q.stem))}</div><div class="collection-meta"><span>${esc(subject(q.subjectId)?.name)} · ${esc(chapter(q))}</span><span>${due ? "已到期" : "下次复习"}：${shortDate(item.dueAt)}</span><span>当前间隔 ${item.intervalDays} 天</span></div></div>${button("复习这题", "spaced-one", `data-id="${attr(q.id)}"`, "btn small")}</article>`;
  }).join("");
  return `${head("间隔复习", "按时重温已学题，逐步延长记忆。提前重复答对不会跳过复习阶段。")}${filtersHTML(getFilters())}${reviewCard(review, { button, icon })}<section class="card"><div class="study-section-head"><h2>到期题目 · ${review.due.length}</h2><p class="subtitle">按所选时长和历史用时估算本组题量，优先最早到期题；下方列出前 30 题。</p></div>${review.due.length ? rows(review.due.slice(0, 30), true) : `<p class="study-empty">当前范围没有到期题目。</p>`}</section><section class="card spaced-upcoming"><div class="study-section-head"><h2>接下来的复习</h2><p class="subtitle">按复习时间显示前 20 题，只有已判分或已自评的题目进入计划。</p></div>${review.upcoming.length ? rows(review.upcoming.slice(0, 20), false) : `<p class="study-empty">完成练习后，会自动安排下一次复习。</p>`}</section>`;
}
function showConceptDetails(name) {
  const concept = getConceptIndex(bank).concepts.get(name);
  if (!concept) return;
  const prep = state.preparation;
  const chapters = [...concept.chapters.values()];
  const chapterIds = [...new Set([...(prep?.chapterIds ?? []), ...chapters.filter((c) => c.subjectId === prep?.subjectId).map((c) => c.chapterId)])];
  const query = prep ? new URLSearchParams({ subject: prep.subjectId, scope: "custom" }) : null;
  for (const id of chapterIds) query?.append("chapter", id);
  openDialog(esc(concept.name), `<p class="subtitle">关联来自章节标题或显式知识点标签，可查看各章题目。扩大备考范围后，开始新测评即可训练新增章节。</p><div class="concept-chapter-list">${chapters.map((c) => `<a href="#/practice?subject=${encodeURIComponent(c.subjectId)}&chapter=${encodeURIComponent(c.chapterId)}"><span>${esc(subject(c.subjectId)?.name)} · ${esc(c.name)}</span><small>${c.count} 题 ${icon("arrow", 12)}</small></a>`).join("")}</div>`, `${button("关闭", "close-dialog")}${prep ? `<a class="btn primary" href="#/prepare?${attr(query.toString())}">将同科目关联章节加入待选范围</a>` : ""}`);
}
function updatePreparationSelection() {
  const query = new URLSearchParams({ subject: document.querySelector("#prepare-subject").value, scope: "custom" });
  query.set("roundPolicy", document.querySelector("#prepare-round-policy").value);
  for (const input of document.querySelectorAll("[data-prepare-chapter]:checked")) query.append("chapter", input.value);
  history.replaceState(null, "", "#/prepare?" + query);
  const count = preparationQuestions(bank, preparationSelection()).length;
  document.querySelector("#prepare-availability").textContent = preparationAvailability(count);
  document.querySelector("#prepare-learning-progress").innerHTML = learningProgressCard(
    learningProgress(preparationQuestions(bank, preparationSelection()), state));
  document.querySelector('[data-action="begin-preparation"]').disabled = !count;
}
function isPreparationPractice(p = state.practice) {
  return p?.mode === "prepare-diagnostic" || p?.mode === "prepare-training";
}
let preparationMetricsCache;
function currentPreparationMetrics() {
  const practice = currentPreparationPractice(state);
  const cached = preparationMetricsCache;
  if (!cached || cached.bank !== bank || cached.state !== state || cached.attempts !== state.attempts ||
    cached.count !== state.attempts.length || cached.preparation !== state.preparation || cached.practice !== practice)
    preparationMetricsCache = { bank, state, attempts: state.attempts, count: state.attempts.length,
      preparation: state.preparation, practice, metrics: preparationMetrics(bank, state) };
  return preparationMetricsCache.metrics;
}
function preparationStatus() {
  return state.preparation ? preparationStatusCard(currentPreparationMetrics()) : "";
}
function preparationQuestionStatus(id) {
  const result = currentPreparationMetrics().questions.get(id);
  const streak = result?.correctStreak ?? 0;
  return `<p class="preparation-question-status"><span class="pill ${result?.mastered ? "green" : "blue"}" data-preparation-question-status>${result?.mastered ? "已掌握" : result?.wrongCount ? "错题巩固中" : "掌握确认中"} · 连续答对 ${streak} / 2 次</span>${result?.wrongCount && !result.mastered ? "<small>已提高后续抽中频率</small>" : ""}</p>`;
}
function preparationRoundSummary() {
  const p = state.practice;
  const progress = practiceProgress(p);
  return `<section class="card preparation-summary"><span class="pill blue">${p.mode === "spaced" ? "到期复习" : p.mode === "prepare-diagnostic" ? "备考测评" : `加权训练 · 第 ${p.round} 组`}</span><h2>${progress.ready ? "本组已完成" : "还有题目待完成"}</h2><p>共 ${progress.total} 题，已完成 ${progress.completed} 题，答对 ${progress.correct} 题${progress.completed ? `，正确率 ${Math.round(progress.correct / progress.completed * 100)}%` : ""}。</p><p class="muted">${progress.ready ? "已根据本组表现更新复习重点，可开始下一组加权训练。" : "跳过的题目不会按错题计入。请先补完；解答题需选择自评结果。"}</p><div class="flex">${progress.ready ? button("下一组加权训练", "next-training", "", "btn primary") : button("继续完成本组", "complete-preparation", "", "btn primary")}<a href="#/prepare" class="btn">查看备考计划</a></div></section>${preparationStatus()}${preparationTopics()}${trendPanel(bank, state, state.preparation?.id, { esc, attr })}`;
}

function optionHTML(q, response, graded = false, correct = null) {
  const selected = Array.isArray(response) ? response : [response];
  const answers = Array.isArray(q.answer) ? q.answer : [q.answer];
  return `<div class="options">${q.options
    .map((o) => {
      let style = selected.includes(o.id) ? "selected" : "";
      if (graded) {
        if (answers.includes(o.id)) style = "correct";
        else if (selected.includes(o.id) && correct === false) style = "wrong";
      }
      return `<button class="option ${style}" data-action="answer-option" data-value="${attr(o.id)}" ${graded ? "disabled" : ""} aria-pressed="${selected.includes(o.id)}"><span class="option-key">${q.type === "boolean" ? (o.id === "true" ? "√" : "×") : esc(o.id)}</span><span class="rich" data-rich="${attr(o.text)}"></span></button>`;
    })
    .join("")}</div>`;
}
function updateSelectedOptions(answer) {
  const selected = new Set(Array.isArray(answer) ? answer : [answer]);
  for (const option of app.querySelectorAll('[data-action="answer-option"]')) {
    const pressed = selected.has(option.dataset.value);
    option.classList.toggle("selected", pressed);
    option.setAttribute("aria-pressed", String(pressed));
  }
}
function updateExamProgress(exam) {
  const nav = app.querySelector(".question-nav");
  if (!nav) return;
  const completed = exam.questionIds.filter((id) => hasResponse(qById(id), exam.answers[id])).length;
  const currentId = exam.questionIds[exam.index];
  nav.querySelector(".card-head .muted").textContent = `${completed}/${exam.questionIds.length}`;
  nav.querySelector(".progress-bar > span").style.width = `${completed / exam.questionIds.length * 100}%`;
  nav.querySelector(".index-btn.current")?.classList.toggle("answered", hasResponse(qById(currentId), exam.answers[currentId]));
}
function updateMenu() {
  app.querySelector(".local-nav")?.classList.toggle("open", mobileOpen);
  app.querySelector('[data-action="toggle-menu"]')?.setAttribute("aria-expanded", String(mobileOpen));
}
function updateTheme() {
  const theme = applyPreferences(state);
  const control = app.querySelector('[data-action="toggle-theme"]');
  if (control) control.innerHTML = icon(theme === "dark" ? "sun" : "moon", 19);
  const focus = app.querySelector('[data-action="toggle-focus"]');
  if (focus) {
    focus.setAttribute("aria-pressed", String(state.studySettings.focus));
    focus.innerHTML = `${icon("target", 15)} ${state.studySettings.focus ? "退出专注" : "专注模式"}`;
  }
}
function answerInput(q, response, graded) {
  if (["single", "multiple", "boolean"].includes(q.type))
    return optionHTML(q, response, graded, currentResponse()?.correct);
  return `<label class="field"><span>${q.type === "solution" ? "写下你的解题过程" : "你的答案"}</span><textarea class="input blank-answer" data-answer-text ${graded ? "disabled" : ""} placeholder="${q.type === "solution" ? "先独立思考，再对照参考解析。支持输入 LaTeX。" : "填写答案；多个可接受形式由题库定义。"}">${esc(response ?? "")}</textarea></label>`;
}
function currentExam() {
  const r = route();
  return r.page === "exam"
    ? state.exams.find((e) => e.id === r.parts[1])
    : null;
}
function currentQuestion() {
  const e = currentExam();
  const p = e ?? state.practice;
  if (!p) return null;
  return qById(p.questionIds[p.index ?? 0]);
}
function currentResponse() {
  const q = currentQuestion();
  return q ? state.practice?.responses[q.id] : null;
}
function sourceInfo(q) {
  if (!q.source?.documentId) return "";
  return `<div class="source-info"><span>${esc(q.sourceLabel)}</span><a href="./source-pdf/${encodeURIComponent(q.source.documentId)}.pdf#page=${Number(q.source.page) || 1}" target="_blank" rel="noopener">查看原 PDF · 第 ${Number(q.source.page) || 1} 页 ${icon("arrow", 12)}</a></div>`;
}
function resultBox(q, r, { mode = "practice" } = {}) {
  const preparing = ["prepare-diagnostic", "prepare-training"].includes(mode);
  return feedbackHTML(q, r, { mode, mastery: preparing ? currentPreparationMetrics().questions.get(q.id) : null,
    mistake: state.mistakes[q.id] }, { icon, attr, button });
}
function refreshGradedPractice(p, q) {
  const response = p.responses[q.id];
  if (!patchPracticeAnswer({ root: app, question: q, practice: p, response,
    feedback: resultBox(q, response, { mode: p.mode }),
    status: isPreparationPractice(p) ? preparationStatus() : "",
    questionStatus: isPreparationPractice(p) ? preparationQuestionStatus(q.id) : "", renderRich })) {
    if (currentQuestion()?.id === q.id && route().query.has("session")) render();
  }
}
function questionNavigation(p, exam = false) {
  const completed = exam
    ? Object.keys(p.answers).filter((id) =>
        hasResponse(qById(id), p.answers[id]),
      ).length
    : practiceProgress(p).completed;
  const navStart = Math.floor(p.index / 40) * 40;
  return `<aside class="card question-nav"><div class="card-head"><h3>题目导航</h3><span class="muted" style="font-size:10px">${completed}/${p.questionIds.length}</span></div><div class="progress-bar"><span style="width:${(completed / p.questionIds.length) * 100}%"></span></div><div class="question-index">${p.questionIds
    .slice(navStart, navStart + 40)
    .map((id, localIndex) => {
      const i = navStart + localIndex;
      const r = exam ? null : p.responses[id];
      const cls = exam
        ? hasResponse(qById(id), p.answers[id])
          ? "answered"
          : ""
        : r?.graded
          ? r.correct === true
            ? "correct"
            : r.correct === false
              ? "wrong"
              : "answered"
          : "";
      return button(
        `${i + 1}<span class="nav-state" aria-hidden="true">${exam ? p.uncertainIds?.includes(id) ? "?" : "" : r?.correct === true ? "✓" : r?.correct === false ? "×" : r?.graded ? "?" : ""}</span>`,
        "navigate-question",
        `data-index="${i}" aria-label="第 ${i + 1} 题"`,
        "index-btn " + cls + (i === p.index ? " current" : ""),
      );
    })
    .join(
      "",
    )}</div>${p.questionIds.length > 40 ? `<div class="flex nav-pages">${button("上一组", "navigate-question", `data-index="${Math.max(0, navStart - 40)}" ${navStart === 0 ? "disabled" : ""}`, "btn small")}${button("下一组", "navigate-question", `data-index="${navStart + 40}" ${navStart + 40 >= p.questionIds.length ? "disabled" : ""}`, "btn small")}</div><small class="muted">${navStart + 1}–${Math.min(navStart + 40, p.questionIds.length)} / ${p.questionIds.length}</small>` : ""}<p class="navigator-note">${exam ? "答案会自动保存在当前浏览器。交卷后查看结果与解析。" : "答完一题，再前进一步。练习进度会自动保存。"}</p>${exam ? `<div style="border-top:1px solid var(--line);padding-top:17px;margin-top:19px"><p class="muted" style="font-size:10px">剩余时间</p><div class="timer" data-timer="${attr(p.id)}">${timeRemaining(p)}</div><div style="margin-top:15px">${button("提交试卷", "submit-exam", "", "btn coral")}</div></div>` : ""}</aside>`;
}
function practiceSession() {
  const p = state.practice;
  if (isPreparationPractice(p) && route().query.has("summary")) return preparationRoundSummary();
  const q = currentQuestion();
  if (!q)
    return `<section class="card">${empty("这组练习已不可用", "题库可能发生了变化，请重新选择练习。", button("选择练习", "exit-practice", "", "btn primary"))}</section>`;
  const r = p.responses[q.id] ?? {
    answer: q.type === "multiple" ? [] : "",
    graded: false,
  };
  return `${head(p.mode === "spaced" ? "到期复习" : p.mode === "prepare-diagnostic" ? "备考测评" : p.mode === "prepare-training" ? `加权训练 · 第 ${p.round} 组` : p.mode === "random" ? "随机练习" : p.mode === "review" ? "错题回顾" : p.mode === "favorites" ? "收藏练习" : "章节练习", `${esc(subject(q.subjectId)?.name ?? "")} · ${esc(chapter(q))}`, button(`${icon("back", 13)} 选择练习`, "exit-practice", "", "btn"))}${questionToolbar()}${isPreparationPractice(p) ? preparationStatus() : ""}<div class="question-layout"><section class="card question-main" data-practice-id="${attr(p.id)}" data-question-id="${attr(q.id)}"><div class="question-top"><div class="flex"><span class="pill green">${names[q.type]}</span><span class="pill">${q.source ? "PDF 原题" : difficultyNames[q.difficulty]}</span></div>${button(icon("star", 18), "toggle-favorite", `data-id="${attr(q.id)}" aria-label="${state.favorites.includes(q.id) ? "取消收藏" : "收藏题目"}" style="color:${state.favorites.includes(q.id) ? "var(--accent)" : "var(--muted)"}"`, "icon-btn")}</div>${isPreparationPractice(p) ? preparationQuestionStatus(q.id) : ""}<p class="eyebrow">QUESTION ${String(p.index + 1).padStart(2, "0")} <span class="muted">/ ${p.questionIds.length}</span></p>${sourceInfo(q)}<div class="question-title rich" data-rich="${attr(q.stem)}"></div>${q.source ? `<p class="pdf-reading-note">长公式可左右滑动查看</p>` : ""}${answerInput(q, r.answer, r.graded)}${r.graded ? resultBox(q, r, { mode: p.mode }) : ""}${questionNotesHTML(q.id, state, { esc, attr })}<div class="question-actions">${button(`${icon("back", 13)} 上一题`, "navigate-question", `data-index="${p.index - 1}" ${p.index === 0 ? "disabled" : ""}`, "btn")}<span class="grow"></span>${!r.graded ? button(q.type === "solution" ? "查看参考答案" : "确认答案", "submit-answer", "", "btn primary") : ""}${button(`${p.index === p.questionIds.length - 1 ? "完成本组" : "下一题"} ${icon("arrow", 13)}`, "next-question", "", "btn " + (r.graded ? "primary" : ""))}</div></section>${questionNavigation(p)}</div><p class="shortcut-hint">${q.type === "fill" ? "填空题按题库答案及可接受答案匹配；等价数学表达式请以原题配置为准。" : "先思考，再确认。答题记录只保存在当前浏览器。"}</p>`;
}
function cloudCard() {
  return `<section class="card library-card cloud-card"><div class="card-head"><h2>跨设备学习进度</h2><span class="pill ${sync.connected ? "green" : ""}">${sync.connected ? "已连接" : "可选"}</span></div><p class="subtitle">${sync.connected ? `服务器进度版本：${sync.version}。上传会替换服务器进度；恢复会替换本机进度。` : "连接自己的同步服务器，在不同设备间接续学习。未连接时，所有刷题功能仍可正常使用。"}</p><div class="flex" style="margin-top:18px">${sync.connected ? `${button("上传本机进度", "cloud-upload", "", "btn primary")}${button("恢复服务器进度", "cloud-download")}${button("断开连接", "cloud-disconnect", "", "text-btn")}` : button("连接同步服务器", "cloud-connect", "", "btn")}</div><p class="format-note" style="margin-top:14px">同步密钥只在当前页面内存中使用，刷新后需重新连接。支持内置知行学习题库；自定义题库请使用完整备份。</p></section>`;
}
function showCloudConnect() {
  openDialog("连接同步服务器", `<p>输入自己的服务器地址和个人同步密钥。每位学习者使用不同密钥。</p><div class="field"><label for="cloud-api">服务器地址</label><input id="cloud-api" class="input" type="url" value="${attr(sync.base || configuredAPI)}" placeholder="https://api.example.com" autocomplete="off"></div><div class="field"><label for="cloud-token">个人同步密钥</label><input id="cloud-token" class="input" type="password" autocomplete="off" spellcheck="false"></div><p class="format-note">连接只检查服务器进度，不会上传或替换学习记录。</p>`, `${button("取消", "close-dialog")}${button("连接", "cloud-do-connect", "", "btn primary")}`);
}
function requireBundledBank() {
  if (bank.managedBundle === false || !bank.revision?.startsWith("pdf-"))
    throw new Error("自定义题库请通过导出和恢复完整备份跨设备迁移");
  if (state.exams.some((exam) => exam.status === "active"))
    throw new Error("请先完成正在进行的考试，再同步学习进度");
}
function libraryPage() {
  return `${head("让原题，回到你的学习节奏。", "保留原题内容、标准答案和解析，再用自己的方式练习。", bank.questions.length ? button(`${icon("download", 14)} 导出题库`, "export-bank", "", "btn") : "")}<section class="card library-hero"><div class="empty-symbol">${icon(bank.questions.length ? "check" : "folder", 29)}</div><div class="grow"><span class="pill ${bank.questions.length ? "green" : "coral"}">${bank.questions.length ? "题库已就绪" : "等待原题数据"}</span><h2 style="margin-top:10px">${bank.questions.length ? `${bank.questions.length.toLocaleString()} 道原题，已加入学习空间` : "网站已就绪，题库由你补充"}</h2><p class="subtitle">${bank.questions.length ? `${esc(bank.managedBundle !== false && bank.revision?.startsWith("pdf-") ? "知行学习题库" : bank.source.name || "已导入题库")} · ${bank.subjects.length} 个科目 · 导入于 ${shortDate(bank.importedAt)}` : "目前没有填入示例题。导入后，科目、章节、题干、答案与解析均以原始数据为准。"}</p></div></section>${cloudCard()}<div class="grid-2"><section class="card library-card"><div class="card-head"><h2>导入原题库</h2>${icon("upload", 18)}</div><div class="upload-zone" id="drop-zone" tabindex="0" role="button" aria-label="选择或拖入 JSON 题库">${icon("upload", 29)}<h3>把题库带到这里</h3><p>拖入 JSON 文件，或点击选择。导入前会检查题型、答案、选项和章节关联。</p>${button("选择题库文件", "choose-file", "", "btn primary")}<div class="muted" style="font-size:9px;margin-top:12px">JSON 格式 · 最大 50 MB · 最多 100,000 题</div></div><div class="flex" style="justify-content:space-between">${button(`${icon("download", 13)} 下载空白模板`, "download-template", "", "text-btn")}${button("查看格式说明", "import-help", "", "text-btn")}</div><p class="format-note" style="margin-top:18px">支持单选、多选、判断、填空和解答题。公式支持 LaTeX，题干与解析可保留常见 HTML 排版。解答题使用对照自评；填空题可配置多个可接受答案。</p></section><div class="stack"><section class="card library-card"><div class="card-head"><h2>学习数据，留在自己手里</h2>${icon("lock", 16)}</div><div class="data-actions"><button class="data-action" data-action="export-backup"><b>${icon("download", 15)} 导出完整备份</b><p>题库、作答记录、考试与知识点阅读进度。</p></button><button class="data-action" data-action="restore-backup"><b>${icon("refresh", 15)} 恢复学习数据</b><p>选择之前导出的知行学习备份，继续上次的进度。</p></button></div><p class="format-note" style="margin-top:14px">学习数据保存在当前浏览器。更换设备或清理浏览器前，请先导出备份。</p></section><section class="card library-card"><div class="card-head"><h2>当前题库</h2><span class="pill">${bank.questions.length} 题</span></div>${bank.subjects.map((s) => `<div class="chapter-row"><span class="grow">${esc(s.name)}</span><span class="muted">${getBankIndex(bank).subjectQuestions.get(s.id).length} 题</span></div>`).join("")}<div style="margin-top:17px">${button(`${icon("trash", 12)} 清空学习记录`, "reset-data", "", "text-btn")}</div></section></div></div>`;
}

const { dashboard, chapterCards, statsPage } = createOverviewPages({
  getBank: () => bank, getState: () => state, getKnowledge: () => knowledge, getFilters, subject, qById,
});
const { collectionRow, collectionPage } = createCollectionPages({
  getBank: () => bank, getState: () => state, getFilters, route, subject, chapter, filtersHTML, names,
});
const { examsPage, examPage, timeRemaining } = createExamPages({
  getBank: () => bank, getState: () => state, subject, qById, shortDate, bankNotice,
  currentExam, currentQuestion, questionToolbar, sourceInfo, answerInput, questionNavigation, resultBox, names,
});
const sessionActions = createSessionActions({
  getBank: () => bank, getState: () => state, getFilters, route, subject,
  startPractice, persist, go, toast, render, isPreparationPractice, preparationSelection,
  updatePreparationSelection, showConceptDetails, currentQuestion, currentExam,
  updateSelectedOptions, updateExamProgress, tickExam, submitPractice, openDialog, defaultCount: DEFAULT_QUESTION_COUNT,
});

let renderPending = false;
let lastView = "";
function render() {
  if (renderPending) return;
  renderPending = true;
  queueMicrotask(() => {
    renderPending = false;
    draw();
  });
}
function draw() {
  clearInterval(timerInterval);
  if (storageReady) applyPreferences(state);
  const r = route();
  const page = routes[r.page] ? r.page : "dashboard";
  const practice = ["practice", "prepare"].includes(page) && r.query.has("session") && !r.query.has("summary") ? state.practice : null;
  if (displayedPractice && displayedPractice !== practice) {
    pausePracticeQuestion(displayedPractice);
    persist();
  }
  displayedPractice = practice;
  if (practice && !document.hidden && !storageConflicted()) resumePracticeQuestion(practice);
  const exam = currentExam();
  if (displayedExam && displayedExam !== exam) { pauseExamQuestion(displayedExam); persist(); }
  displayedExam = exam?.status === "active" ? exam : null;
  if (displayedExam && !document.hidden && !storageConflicted()) resumeExamQuestion(displayedExam);
  document.body.dataset.studyActivity = (r.query.has("session") && state.practice || exam?.status === "active") ? "question" : "overview";
  if (page === "welcome") {
    if (!app.querySelector(".welcome-shell")) app.innerHTML = welcomePage();
    document.title = "知行学习 · 行是知之始 知是行之成";
    watchActiveExams();
    return;
  }
  if (!storageReady) {
    app.innerHTML = '<main id="main" class="boot"><span class="boot-mark">∑</span><p role="status">正在准备学习空间…</p></main>';
    return;
  }
  const view = `${location.hash}:${state.practice?.id}:${state.practice?.index}:${exam?.id}:${exam?.index}:${exam?.status}`;
  const entering = view !== lastView;
  lastView = view;
  const navItems = [
    ["dashboard", "home", "学习概览", "/"],
    ["practice", "book", "题库练习", "/practice"],
    ["prepare", "target", "备考模式", "/prepare"],
    ["knowledge", "book", "习概知识点", "/knowledge"],
    ["exams", "exam", "模拟考试", "/exams"],
    ["review", "mistake", "错题本", "/review"],
    ["favorites", "star", "我的收藏", "/favorites"],
    ["stats", "chart", "学习统计", "/stats"],
  ];
  const countWrong = Object.values(state.mistakes).filter(
    (m) => !m.resolved,
  ).length;
  app.innerHTML = `<div class="local-shell"><header class="local-header"><div class="local-navbar"><a class="local-brand" href="#/" aria-label="知行学习 首页">${brandIcon(document.documentElement.dataset.theme)}<strong>知行学习</strong><span>题库</span></a><nav class="local-nav ${mobileOpen ? "open" : ""}" aria-label="主要导航">${[...navItems, ["library", "folder", "题库管理", "/library"]].map(([key, i, label, path]) => `<a href="#${path}" class="${page === key || (page === "exam" && key === "exams") ? "active" : ""}" ${page === key ? 'aria-current="page"' : ""}>${icon(i, 16)}${label}${key === "review" && countWrong ? `<small>${countWrong}</small>` : ""}</a>`).join("")}</nav><div class="local-header-actions">${button(icon("settings", 19), "display-settings", 'aria-label="学习显示设置"', "icon-btn")}${button(icon("search", 19), "search", 'aria-label="搜索题目与知识点"', "icon-btn")}${button(icon(document.body.classList.contains("dark") ? "sun" : "moon", 19), "toggle-theme", 'aria-label="切换明暗主题"', "icon-btn")}${button(icon("menu", 20), "toggle-menu", `aria-label="打开导航" aria-expanded="${mobileOpen}"`, "icon-btn local-menu")}</div></div></header><main id="main" class="local-main" tabindex="-1">${page === "dashboard" ? dashboard() : page === "practice" ? practicePage() : page === "prepare" ? preparationPage() : page === "spaced" ? spacedReviewPage() : page === "knowledge" ? knowledgePage(knowledge, state, r, { esc, attr, icon, button, head }) : page === "review" || page === "favorites" ? collectionPage(page) : page === "exams" ? examsPage() : page === "exam" ? examPage() : page === "stats" ? statsPage() : libraryPage()}<footer class="footer"><a href="#/welcome" aria-label="查看起始页">知行学习 · 练习与知识复习</a><span>知行学习题库 · 学习记录自动保存在当前浏览器</span></footer></main></div>`;
  document.title = `${routes[page]} · 知行学习`;
  document.querySelector("#main").toggleAttribute("data-enter", entering);
  renderRich(app, page === "exam" && exam?.status === "submitted");
  attachDropZone();
  watchActiveExams();
}
function watchActiveExams() {
  if (storageReady && !storageConflicted() && state.exams.some((e) => e.status === "active")) {
    tickExam();
    timerInterval = setInterval(tickExam, 1000);
  }
}
function openDialog(title, body, actions = "") {
  dialog.innerHTML = `<header class="dialog-head"><h2 id="dialog-title">${title}</h2>${button(icon("close", 18), "close-dialog", 'aria-label="关闭"', "icon-btn")}</header><div class="dialog-body">${body}</div>${actions ? `<div class="dialog-actions">${actions}</div>` : ""}`;
  dialog.showModal();
  renderRich(dialog);
}
function confirmDialog(title, body, onConfirm, label = "确认") {
  openDialog(
    title,
    `<p>${body}</p>`,
    `${button("取消", "close-dialog")}${button(label, "confirm-dialog", "", "btn coral")}`,
  );
  dialog._confirm = onConfirm;
}
function download(name, value) {
  const blob = new Blob(
    [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
    {
      type:
        typeof value === "string"
          ? "text/plain;charset=utf-8"
          : "application/json",
    },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function selectFile(mode = "bank") {
  fileMode = mode;
  const el = document.querySelector("#file-input");
  el.value = "";
  el.click();
}
function examChapterOptions(subjectId = "") {
  return bank.subjects
    .filter((s) => !subjectId || s.id === subjectId)
    .map((s) => `<div class="exam-chapter-group"><p>${esc(s.name)}</p>${s.chapters
      .filter((c) => !c.parentId)
      .map((c) => `<label><input type="checkbox" data-exam-chapter value="${attr(JSON.stringify([s.id, c.id]))}"><span>${esc(c.name)}</span></label>`)
      .join("")}</div>`)
    .join("");
}
function examFilters() {
  return {
    subjectId: document.querySelector("#exam-subject").value,
    chapters: document.querySelector("#exam-all-chapters").checked ? null
      : [...dialog.querySelectorAll("[data-exam-chapter]:checked")].map((input) => {
        const [subjectId, chapterId] = JSON.parse(input.value);
        return { subjectId, chapterId };
      }),
  };
}
function updateExamAvailability() {
  const filters = examFilters();
  const available = examQuestions(bank, filters).length;
  const count = document.querySelector("#exam-count");
  count.max = Math.max(1, Math.min(100, available));
  if (available && Number(count.value) > Number(count.max)) count.value = count.max;
  document.querySelector("#exam-availability").textContent = filters.chapters?.length === 0
    ? "请至少选择一个大章节，或勾选全部章节。"
    : available
    ? `当前范围共 ${available} 道可考试题目${filters.chapters ? `，已选 ${filters.chapters.length} 个大章节` : ""}，包含各章下的全部小节。`
    : "当前范围没有可考试的自动判分题，请选择其他章节或科目。";
  document.querySelector('[data-action="begin-exam"]').disabled = !available;
  const error = document.querySelector("#exam-error");
  error.textContent = "";
  error.className = "";
}
function examOptions() {
  if (!bank.questions.length) {
    toast("请先导入原题库");
    go("/library");
    return;
  }
  const active = state.exams.find((e) => e.status === "active");
  if (active) {
    go("/exam/" + active.id);
    return;
  }
  openDialog(
    "给自己一场小小的检验",
    `<p style="margin-bottom:20px">从已导入题库中随机抽题。选择、判断与填空题自动判分，解答题保留在章节练习中自评。</p><div class="field"><label for="exam-subject">考试科目</label><select id="exam-subject"><option value="">综合练习</option>${bank.subjects.map((s) => `<option value="${attr(s.id)}">${esc(s.name)}</option>`).join("")}</select></div><fieldset class="exam-chapters" aria-describedby="exam-availability"><legend>大章节（可多选）</legend><label class="exam-all-chapters"><input id="exam-all-chapters" type="checkbox" checked><span>全部章节</span></label><div id="exam-chapter-options">${examChapterOptions()}</div></fieldset><p id="exam-availability" aria-live="polite"></p><div class="flex"><div class="field"><label for="exam-count">题量</label><input class="input" id="exam-count" type="number" min="1" max="100" value="${Math.min(DEFAULT_QUESTION_COUNT, bank.questions.filter((q) => q.type !== "solution").length) || 1}"></div><div class="field"><label for="exam-minutes">时长 / 分钟</label><input class="input" id="exam-minutes" type="number" min="1" max="240" value="30"></div></div><p id="exam-error" role="alert"></p>`,
    `${button("先不考", "close-dialog")}${button(`开始考试 ${icon("arrow", 13)}`, "begin-exam", "", "btn primary")}`,
  );
  updateExamAvailability();
}
async function startPractice(ids, mode) {
  await deferredSaves.flush();
  if (!ids.length) {
    toast(bank.questions.length ? "当前筛选下没有题目" : "请先导入原题库");
    if (!bank.questions.length) go("/library");
    return;
  }
  state.practice = createPractice(ids, mode);
  await persist();
  go("/practice?session=1");
}
async function submitPractice(manual) {
  const p = state.practice,
    q = currentQuestion();
  if (!p || !q) return;
  const r = p.responses[q.id] ?? { answer: q.type === "multiple" ? [] : "" };
  if (r.graded && (manual === undefined || typeof r.correct === "boolean"))
    return;
  if (!hasResponse(q, r.answer) && q.type !== "solution") {
    toast("先选择或填写你的答案");
    return;
  }
  if (q.type === "solution" && manual === undefined) {
    p.responses[q.id] = { ...r, graded: true, correct: null };
    await persist();
    refreshGradedPractice(p, q);
    return;
  }
  const correct = manual ?? judge(q, r.answer);
  pausePracticeQuestion(p);
  p.responses[q.id] = { ...r, correct, graded: true };
  recordAttempt(state, q, r.answer, correct, {
    id: `practice:${p.id}:${q.id}`,
    mode: p.mode,
    durationMs: p.questionTimes?.[q.id] ?? 0,
    manual: q.type === "solution",
    uncertain: r.uncertain,
    preparationId: p.preparationId,
    ...(isPreparationPractice(p) ? { practiceId: p.id, round: p.round ?? 0, sessionSize: p.questionIds.length } : {}),
  });
  if (isPreparationPractice(p)) syncPreparationMistakes(bank, state);
  await persist();
  refreshGradedPractice(p, q);
}
async function finishCurrentExam(force = false) {
  const e = currentExam();
  if (!e || e.status !== "active") return;
  const complete = () => {
    finishExam(state, bank, e);
    return persist().then(() => {
      dialog.close();
      render();
      window.scrollTo(0, 0);
    });
  };
  if (force) return complete();
  const pending = e.questionIds.filter(
    (id) => !hasResponse(qById(id), e.answers[id]),
  ).length;
  confirmDialog(
    "确认提交试卷？",
    pending
      ? `还有 ${pending} 道题未作答，未作答将按错误计入。交卷后可查看答案和解析。`
      : "所有题目都已填写，交卷后可查看成绩、答案和解析。",
    complete,
    "提交试卷",
  );
}
async function tickExam() {
  if (storageConflicted()) return;
  const e = currentExam();
  if (e?.status === "active")
    for (const el of document.querySelectorAll("[data-timer]")) {
      el.textContent = timeRemaining(e);
      el.classList.toggle("urgent", e.endsAt - Date.now() < 60000);
    }
  const expired = state.exams.filter(
    (x) => x.status === "active" && Date.now() >= x.endsAt,
  );
  if (expired.length && !autoSubmitting) {
    autoSubmitting = true;
    try {
      for (const x of expired) finishExam(state, bank, x);
      await persist();
      if (e && expired.some((x) => x.id === e.id)) dialog.close();
      render();
      toast("考试时间已到，已自动交卷");
    } catch (err) {
      toast(err.message);
    } finally {
      autoSubmitting = false;
    }
  }
}
function attachDropZone() {
  const z = document.querySelector("#drop-zone");
  if (!z) return;
  z.addEventListener("dragover", (e) => {
    e.preventDefault();
    z.classList.add("drag");
  });
  z.addEventListener("dragleave", () => z.classList.remove("drag"));
  z.addEventListener("drop", (e) => {
    e.preventDefault();
    z.classList.remove("drag");
    fileMode = "bank";
    if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
  });
  z.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectFile();
    }
  });
}
async function readFile(file) {
  if (file.size > 50 * 1024 * 1024) {
    toast("文件超过 50 MB，请拆分题库");
    return;
  }
  try {
    const parsed = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
    if (fileMode === "backup") {
      const restored = validateBackup(parsed);
      confirmDialog(
        "恢复这份学习备份？",
        `将恢复 ${restored.bank.questions.length} 道题、${restored.state.attempts.length} 条作答记录，并替换当前学习空间。`,
        async () => {
          const prevBank = bank,
            prevState = state;
          bank = restored.bank;
          state = restored.state;
          syncPreparationMistakes(bank, state);
          try {
            await persist();
            dialog.close();
            go("/");
            render();
            toast("学习数据已恢复");
          } catch (e) {
            bank = prevBank;
            state = prevState;
            throw e;
          }
        },
        "恢复备份",
      );
      return;
    }
    pendingImport = normalizeBank(parsed);
    pendingImport.managedBundle = false;
    const n = pendingImport;
    openDialog(
      "原题已检查，准备导入",
      `<p>共 ${n.subjects.length} 个科目、${n.questions.length.toLocaleString()} 道题。题干、答案和解析保留导入内容。</p><div class="import-details">${n.subjects.map((s) => `${esc(s.name)}：${s.chapters.length} 个章节，${n.questions.filter((q) => q.subjectId === s.id).length} 题`).join("<br>")}</div>${bank.questions.length ? "<p>导入会替换当前题库并重置答题记录、收藏、错题和考试。请先导出完整备份。</p>" : "<p>确认后即可开始练习。后续可在题库管理中导出完整备份。</p>"}`,
      `${bank.questions.length ? button("先导出备份", "export-backup") : button("取消", "close-dialog")}${button("确认导入", "confirm-import", "", "btn primary")}`,
    );
  } catch (err) {
    toast(`导入失败：${err.message}`);
  }
}
let searchTimer;
function updateSearchResults(query) {
  const results = query.trim()
    ? filterQuestions(bank, { search: query }, state).slice(0, 25)
    : [];
  const notes = query.trim()
    ? filterKnowledge(
        knowledge,
        new URLSearchParams({ q: query }),
        state,
      ).slice(0, 12)
    : [];
  document.querySelector("#search-results").innerHTML =
    results.length || notes.length
      ? results
          .map(
            (q) =>
              `<button class="search-item" data-action="practice-one" data-id="${attr(q.id)}">${esc(q.sourceLabel || textOnly(q.stem).slice(0, 120))}<small>${esc(subject(q.subjectId)?.name)} · ${esc(chapter(q))}</small></button>`,
          )
          .join("") +
        notes
          .map(
            (article) =>
              `<button class="search-item" data-action="open-knowledge" data-id="${attr(article.id)}">${esc(article.title)}<small>习概知识点 · ${esc(article.category)}</small></button>`,
          )
          .join("")
      : `<p style="padding:16px 8px">${query.trim() ? "没有找到相关题目或知识点，换个关键词试试。" : "输入关键词，搜索题目或知识点。"}</p>`;
}
function scheduleSearch(input, composing = false) {
  clearTimeout(searchTimer);
  if (composing) return;
  searchTimer = setTimeout(() => {
    if (dialog.open && input.isConnected) updateSearchResults(input.value);
  }, 120);
}
function showSearch() {
  openDialog(
    "搜索题目与知识点",
    `<label class="sr-only" for="global-search">搜索题目与知识点</label><input class="input" id="global-search" type="search" placeholder="搜索题目、习概知识点…" autocomplete="off"><div class="search-results" id="search-results"><p style="padding:16px 8px">输入关键词，查找数学题目或习概知识点。</p></div>`,
  );
  setTimeout(() => document.querySelector("#global-search")?.focus(), 50);
}
async function handleAction(action, el) {
  if (storageConflicted()) throw new StorageConflictError();
  if (await sessionActions(action, el)) return;
  switch (action) {
    case "question-notes":
      if (qById(el.dataset.id)) openDialog("错因与个人笔记", questionNotesHTML(el.dataset.id, state, { esc, attr }, { open: true }), button("完成", "close-dialog"));
      break;
    case "display-settings":
      openDialog("学习显示设置", displaySettingsHTML(state), button("完成", "close-dialog", "", "btn primary"));
      break;
    case "toggle-focus":
      state.studySettings.focus = !state.studySettings.focus;
      applyPreferences(state);
      el.setAttribute("aria-pressed", String(state.studySettings.focus));
      el.innerHTML = `${icon("target", 15)} ${state.studySettings.focus ? "退出专注" : "专注模式"}`;
      await persist();
      break;
    case "zoom-image":
      openDialog("查看题图", `<div class="image-zoom-controls"><label for="image-zoom">缩放</label><input id="image-zoom" type="range" min="50" max="200" value="100"><output id="image-zoom-value">100%</output>${button("还原", "reset-image-zoom", "", "btn small")}</div><div class="image-zoom-viewport"><img id="zoomed-image" src="${attr(el.src)}" alt="${attr(el.alt)}"></div>`, button("关闭", "close-dialog"));
      break;
    case "reset-image-zoom":
      document.querySelector("#image-zoom").value = "100";
      document.querySelector("#image-zoom").dispatchEvent(new Event("input", { bubbles: true }));
      break;
    case "toggle-uncertain": {
      const q = currentQuestion(), exam = currentExam();
      if (!q) return;
      if (exam && (exam.status !== "active" || Date.now() >= exam.endsAt)) { await tickExam(); return; }
      if (!exam && state.practice?.responses[q.id]?.graded) return;
      let uncertain;
      if (exam) {
        exam.uncertainIds ??= [];
        uncertain = !exam.uncertainIds.includes(q.id);
        exam.uncertainIds = uncertain ? [...exam.uncertainIds, q.id] : exam.uncertainIds.filter((id) => id !== q.id);
        const symbol = app.querySelector(".index-btn.current .nav-state");
        if (symbol) symbol.textContent = uncertain ? "?" : "";
      } else {
        const response = state.practice.responses[q.id] ??= { answer: q.type === "multiple" ? [] : "", graded: false };
        response.uncertain = !response.uncertain;
        uncertain = response.uncertain;
      }
      el.setAttribute("aria-pressed", String(uncertain));
      el.textContent = uncertain ? "? 已标记拿不准" : "? 这题拿不准";
      await persist();
      break;
    }
    case "cloud-connect":
      showCloudConnect();
      break;
    case "cloud-do-connect": {
      const control = el;
      control.disabled = true;
      try {
        await sync.connect(document.querySelector("#cloud-api").value.trim(), document.querySelector("#cloud-token").value.trim());
        document.querySelector("#cloud-token").value = "";
        dialog.close(); render();
        toast("已连接，学习进度尚未变更");
      } finally { control.disabled = false; }
      break;
    }
    case "cloud-disconnect":
      sync.disconnect(); render(); toast("已断开同步连接");
      break;
    case "cloud-upload":
      requireBundledBank();
      confirmDialog("上传本机学习进度？", "将以当前浏览器的作答、收藏、错题、考试和知识点进度替换服务器进度。服务器保留最近 10 次旧版本。", async () => {
        requireBundledBank();
        await saving;
        await sync.upload({ format: PROGRESS_FORMAT, bankRevision: bank.revision, state: structuredClone(state) });
        render(); toast("学习进度已上传");
      }, "确认上传");
      break;
    case "cloud-download":
      requireBundledBank();
      confirmDialog("恢复服务器学习进度？", "将替换当前浏览器的学习进度，并先自动下载一份本机完整备份。题库内容保持原样。", async () => {
        requireBundledBank();
        const remote = await sync.read();
        if (!remote.payload) throw new Error("服务器还没有学习进度，请先从有进度的设备上传");
        if (remote.payload.bankRevision !== bank.revision) throw new Error("两端题库版本不一致，请先更新网站或使用完整备份迁移");
        const restored = validateBackup({ format: BACKUP_FORMAT, bank, state: remote.payload.state });
        // Finish any exam that expired while the remote snapshot was idle.
        for (const exam of restored.state.exams)
          if (exam.status === "active" && exam.endsAt <= Date.now()) finishExam(restored.state, bank, exam);
        if (restored.state.exams.some((exam) => exam.status === "active"))
          throw new Error("服务器进度包含正在进行的考试，请在原设备完成后重新上传");
        await saving;
        download(`知行学习-同步前备份-${dayKey()}.json`, { format: BACKUP_FORMAT, bank, state });
        const previous = state;
        state = normalizeKnowledgeRecords(restored.state);
        syncPreparationMistakes(bank, state);
        try { await persist(); } catch (error) { state = previous; throw error; }
        go("/library"); render(); toast("服务器进度已恢复");
      }, "确认恢复");
      break;
    case "open-knowledge":
      if (knowledge.articles.some((article) => article.id === el.dataset.id))
        go("/knowledge/" + el.dataset.id);
      break;
    case "reload-knowledge":
      knowledge = await loadKnowledge();
      render();
      break;
    case "knowledge-recall": {
      const article = knowledge.articles.find((a) => a.id === el.dataset.id);
      if (!article || article.kind !== "note") return;
      await deferredSaves.flush();
      go(`/knowledge/${article.id}?recall=1`);
      break;
    }
    case "knowledge-recalled": {
      const id = el.dataset.id;
      if (!state.knowledgeRecallDrafts[id]?.trim() || !document.querySelector(".recall-reference[open]")) return;
      if (!state.knowledgeRecalled.includes(id)) state.knowledgeRecalled.push(id);
      await persist();
      el.textContent = "已完成回忆核对";
      el.disabled = true;
      break;
    }
    case "knowledge-read":
    case "knowledge-favorite": {
      const id = el.dataset.id;
      if (!knowledge.articles.some((article) => article.id === id)) return;
      const key =
        action === "knowledge-read" ? "knowledgeRead" : "knowledgeFavorites";
      state[key] = state[key].includes(id)
        ? state[key].filter((value) => value !== id)
        : [...state[key], id];
      await persist();
      render();
      break;
    }
    case "knowledge-scroll":
      if (/^knowledge-heading-\d+$/.test(el.dataset.target))
        document
          .getElementById(el.dataset.target)
          ?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
      break;
    case "toggle-menu":
      mobileOpen = !mobileOpen;
      updateMenu();
      break;
    case "close-menu":
      mobileOpen = false;
      updateMenu();
      break;
    case "toggle-theme":
      state.theme = document.body.classList.contains("dark") ? "light" : "dark";
      updateTheme();
      await persist();
      break;
    case "close-dialog":
      if (dialog.querySelector("[data-note-id]")) {
        await deferredSaves.flush();
        dialog.close();
        render();
      }
      dialog.close();
      pendingImport = null;
      break;
    case "confirm-dialog":
      if (dialog._confirming) return;
      dialog._confirming = true;
      try { await dialog._confirm?.(); dialog.close(); }
      finally { dialog._confirming = false; }
      break;
    case "search":
      showSearch();
      break;
    case "goal":
      openDialog(
        "给今天，设一个小目标",
        `<p style="margin-bottom:18px">适合自己的节奏，才容易坚持。每天 1–200 题。</p><div class="field"><label for="daily-goal">每日题量</label><input id="daily-goal" class="input" type="number" min="1" max="200" value="${state.dailyGoal}"></div>`,
        `${button("取消", "close-dialog")}${button("保存目标", "save-goal", "", "btn primary")}`,
      );
      break;
    case "save-goal": {
      const n = Number(document.querySelector("#daily-goal").value);
      if (!Number.isInteger(n) || n < 1 || n > 200) {
        toast("请输入 1–200 的整数");
        return;
      }
      state.dailyGoal = n;
      await persist();
      dialog.close();
      render();
      toast("今日目标已更新");
      break;
    }
    case "choose-file":
      selectFile();
      break;
    case "restore-backup":
      selectFile("backup");
      break;
    case "confirm-import": {
      if (!pendingImport) return;
      const oldBank = bank,
        oldState = state;
      const theme = state.theme;
      bank = pendingImport;
      state = { ...emptyState(), theme };
      try {
        await persist();
        pendingImport = null;
        dialog.close();
        go("/");
        render();
        toast(`已导入 ${bank.questions.length} 道题`);
      } catch (err) {
        bank = oldBank;
        state = oldState;
        throw err;
      }
      break;
    }
    case "download-template":
      download("知行学习-原题导入模板.json", {
        format: BANK_FORMAT,
        source: { name: "NeuMathe", note: "填入实际导出的原题内容" },
        subjects: bank.subjects,
        questions: [],
      });
      toast("空白模板已下载，题目字段可在格式说明中查看");
      break;
    case "import-help":
      openDialog(
        "题库导入格式",
        `<p>顶层使用 <code>subjects</code> 和 <code>questions</code>。科目包含 id、name、chapters；章节包含 id 和 name。题目需提供：</p><div class="import-details"><b>id</b>：唯一题目 ID<br><b>subjectId / chapterId</b>：对应的科目与章节 ID<br><b>type</b>：single、multiple、boolean、fill、solution<br><b>stem</b>：原题题干，支持 HTML 与 LaTeX<br><b>options</b>：[{"id":"A","text":"选项原文"}, …]<br><b>answer</b>：选项 ID、ID 数组或原题答案<br><b>analysis</b>：原题解析<br><b>acceptedAnswers</b>：填空题的其他可接受答案（可选）<br><b>concepts</b>：知识点名称数组（可选），相同名称用于跨章节关联</div><p>也接受 subject_id、chapter_id、title、choices、explanation 等常见字段。数字题型编码需先明确映射，避免错误判题。内容会安全排版；导入前请核对数据来源。</p>`,
        button("下载格式说明", "download-guide", "", "btn primary"),
      );
      break;
    case "download-guide":
      download("知行学习-导入格式说明.txt", IMPORT_GUIDE);
      break;
    case "export-bank":
      download(`知行学习-题库-${dayKey()}.json`, bank);
      toast("题库已导出");
      break;
    case "export-backup":
      download(`知行学习-完整备份-${dayKey()}.json`, {
        format: BACKUP_FORMAT,
        exportedAt: Date.now(),
        bank,
        state,
      });
      toast("完整备份已导出");
      break;
    case "reset-data":
      confirmDialog(
        "清空当前学习记录？",
        "答题记录、收藏、错题和考试都会删除，当前题库保留。此操作无法撤销，建议先导出备份。",
        async () => {
          state = emptyState();
          await persist();
          go("/");
          render();
          toast("学习记录已清空");
        },
        "确认清空",
      );
      break;
    case "toggle-favorite": {
      const id = el.dataset.id;
      const has = state.favorites.includes(id);
      state.favorites = has
        ? state.favorites.filter((i) => i !== id)
        : [...state.favorites, id];
      await persist();
      render();
      toast(has ? "已取消收藏" : "好题已收藏");
      break;
    }
    case "resolve-mistake": {
      if (state.preparation) {
        const metrics = currentPreparationMetrics();
        if (metrics.pool.some((q) => q.id === el.dataset.id) && !metrics.questions.get(el.dataset.id)?.mastered) {
          toast("当前备考范围的题目需在不同组中连续答对两次，才能标记已掌握");
          return;
        }
      }
      if (state.mistakes[el.dataset.id])
        state.mistakes[el.dataset.id].resolved = true;
      await persist();
      render();
      toast("已标记掌握，继续加油");
      break;
    }
    case "create-exam":
      examOptions();
      break;
    case "begin-exam": {
      const filters = examFilters(),
        count = Number(document.querySelector("#exam-count").value),
        minutes = Number(document.querySelector("#exam-minutes").value);
      const list = examQuestions(bank, filters);
      if (
        !Number.isInteger(count) ||
        count < 1 ||
        count > 100 ||
        count > list.length ||
        !Number.isInteger(minutes) ||
        minutes < 1 ||
        minutes > 240
      ) {
        const e = document.querySelector("#exam-error");
        e.className = "inline-error";
        e.textContent = `当前可用 ${list.length} 道自动判分题；题量为 1–100，时长为 1–240 分钟。`;
        return;
      }
      const exam = createExam(
        shuffle(list)
          .slice(0, count)
          .map((q) => q.id),
        minutes,
        filters.subjectId,
      );
      exam.chapters = filters.chapters;
      state.exams.push(exam);
      await persist();
      go("/exam/" + exam.id);
      break;
    }
    case "submit-exam":
      await finishCurrentExam();
      break;
  }
}
const IMPORT_GUIDE = `知行学习题库导入说明\n\n题目、答案与解析请使用实际原始数据。本说明不包含 NeuMathe 原题。\n\nJSON 结构：\n{\n "format":"local-neumathe.bank.v1",\n "source":{"name":"题库来源"},\n "subjects":[{"id":"math","name":"科目名称","chapters":[{"id":"chapter-1","name":"章节名称"}]}],\n "questions":[{\n  "id":"全局唯一ID", "subjectId":"math", "chapterId":"chapter-1",\n  "type":"single", "stem":"原题题干",\n  "options":[{"id":"A","text":"原选项A"},{"id":"B","text":"原选项B"}],\n  "answer":"A", "analysis":"原题解析", "difficulty":"medium", "tags":[], "concepts":["知识点名称"]\n }]\n}\n\n题型：single 单选，multiple 多选，boolean 判断，fill 填空，solution 解答。\n多选 answer 使用选项 ID 数组，例如 ["A","C"]。\n判断题默认选项 ID 为 true / false（字符串），也可提供自定义选项。\n填空 answer 为字符串或可接受答案数组；acceptedAnswers 可补充其他写法。\n填空只比较规范化文本，不提供符号代数等价判定。\n解答题保留原答案并由学习者对照自评。\n题干与解析支持常见 HTML 排版和 $…$、$$…$$、\\(…\\)、\\[…\\] LaTeX 公式。\n不执行 HTML 中的脚本、事件或其他主动内容。\n导入会替换题库并重置现有学习数据；导入前请先导出完整备份。\n学习数据只保存在本浏览器，完整备份可用于换设备。\n`;
document.addEventListener("click", (event) => {
  const entry = event.target.closest(".welcome-enter");
  if (entry && !event.defaultPrevented && event.button === 0 &&
    !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    enterStudy(entry.closest(".welcome-shell"), () => go("/")).catch((error) => {
      cancelWelcomeExit();
      toast(error.message ?? "请重新进入学习");
    });
    return;
  }
  if (event.target.closest(".skip")) {
    event.preventDefault();
    document.getElementById("main")?.focus();
    return;
  }
  const el = event.target.closest('.option[data-action="answer-option"]') ?? event.target.closest("[data-action]");
  if (el) {
    event.preventDefault();
    const startsSession = ["start-practice", "start-collection", "practice-one", "begin-preparation", "next-training", "resume-preparation", "start-spaced", "spaced-one"].includes(el.dataset.action);
    if (startsSession && startingSession) return;
    if (startsSession) startingSession = true;
    handleAction(el.dataset.action, el).catch((err) =>
      toast(err.message ?? "操作失败，请重试"),
    ).finally(() => { if (startsSession) startingSession = false; });
  } else if (event.target.closest(".local-nav a,.local-brand")) {
    mobileOpen = false;
    updateMenu();
  }
});
document.addEventListener("change", (event) => {
  if (event.target.matches("[data-study-setting]")) {
    const key = event.target.dataset.studySetting;
    if (key === "theme") state.theme = event.target.value;
    else state.studySettings[key] = key === "focus" ? event.target.checked : event.target.value;
    updateTheme(); persist();
    return;
  }
  if (event.target.matches("[data-review-minutes]")) {
    const query = route().query;
    query.set("reviewMinutes", event.target.value);
    history.replaceState(null, "", "#/" + route().page + "?" + query);
    return;
  }
  if (event.target.matches("#prepare-round-policy")) { updatePreparationSelection(); return; }
  if (event.target.matches("#trend-plan")) {
    const query = route().query;
    query.set("plan", event.target.value);
    history.replaceState(null, "", "#/" + route().page + "?" + query);
    document.querySelector("#preparation-trends").outerHTML = trendPanel(bank, state, event.target.value, { esc, attr });
    return;
  }
  if (event.target.matches("#prepare-subject")) {
    go("/prepare?subject=" + encodeURIComponent(event.target.value));
    return;
  }
  if (event.target.matches("[data-prepare-chapter]")) {
    updatePreparationSelection();
    return;
  }
  if (event.target.matches("#exam-subject")) {
    document.querySelector("#exam-chapter-options").innerHTML = examChapterOptions(event.target.value);
    document.querySelector("#exam-all-chapters").checked = true;
    updateExamAvailability();
    return;
  }
  if (event.target.matches("[data-exam-chapter]")) {
    document.querySelector("#exam-all-chapters").checked = false;
    updateExamAvailability();
    return;
  }
  if (event.target.matches("#exam-all-chapters")) {
    for (const input of dialog.querySelectorAll("[data-exam-chapter]")) input.checked = false;
    updateExamAvailability();
    return;
  }
  if (event.target.matches("[data-knowledge-query]")) {
    const query = route().query;
    const value = event.target.value.trim();
    value ? query.set("q", value) : query.delete("q");
    go("/knowledge" + (query.size ? "?" + query : ""));
    return;
  }
  const f = event.target.dataset.filter;
  if (f) {
    const query = route().query;
    query.delete("session");
    event.target.value ? query.set(f, event.target.value) : query.delete(f);
    if (f === "subject") query.delete("chapter");
    query.delete("page");
    go("/" + route().page + (query.size ? "?" + query : ""));
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "image-zoom") {
    const percent = Number(event.target.value);
    document.querySelector("#zoomed-image").style.width = `${percent}%`;
    document.querySelector("#image-zoom-value").textContent = `${percent}%`;
    return;
  }
  if (event.target.matches("[data-recall-text]")) {
    const id = event.target.dataset.recallText;
    state.knowledgeRecallDrafts[id] = event.target.value.slice(0, 10000);
    const check = app.querySelector('[data-action="knowledge-recalled"]');
    if (check && !state.knowledgeRecalled.includes(id)) check.disabled = !event.target.value.trim();
    deferredSaves.schedule();
    return;
  }
  if (event.target.matches("[data-answer-text]")) {
    const q = currentQuestion(),
      exam = currentExam();
    if (!q) return;
    if (exam) {
      if (exam.status !== "active" || Date.now() >= exam.endsAt) {
        tickExam();
        return;
      }
      exam.answers[q.id] = event.target.value;
      updateExamProgress(exam);
    } else {
      const p = state.practice;
      if (!p) return;
      p.responses[q.id] = {
        ...(p.responses[q.id] ?? { graded: false }),
        answer: event.target.value,
      };
    }
    deferredSaves.schedule();
  }
  if (event.target.id === "global-search") scheduleSearch(event.target, event.isComposing);
});
document.querySelector("#file-input").addEventListener("change", (e) => {
  if (e.target.files[0]) readFile(e.target.files[0]);
});
dialog.addEventListener("close", () => clearTimeout(searchTimer));
dialog.addEventListener("compositionstart", () => clearTimeout(searchTimer));
dialog.addEventListener("compositionend", (event) => {
  if (event.target.id === "global-search") scheduleSearch(event.target);
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  }
});
document.addEventListener("keydown", (event) => {
  if (["Enter", " "].includes(event.key) && event.target.matches('img[data-action="zoom-image"]')) {
    event.preventDefault(); handleAction("zoom-image", event.target);
  }
  if (event.key === "Enter" && event.target.matches("[data-knowledge-query]")) {
    event.preventDefault();
    event.target.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (dialog.open) dialog.close();
    showSearch();
  }
});
window.addEventListener("hashchange", () => {
  cancelWelcomeExit();
  deferredSaves.flush().catch(() => {});
  if (dialog.open) dialog.close();
  render();
  window.scrollTo(0, 0);
});
document.addEventListener("visibilitychange", () => {
  if (storageConflicted()) return;
  if (document.hidden) {
    pausePracticeQuestion(displayedPractice);
    pauseExamQuestion(displayedExam);
    deferredSaves.flush().catch(() => {});
    if (displayedExam || displayedPractice) persist();
  } else {
    if (!storageConflicted()) resumePracticeQuestion(displayedPractice);
    resumeExamQuestion(displayedExam);
    if (displayedExam) persist();
    tickExam();
  }
});
document.addEventListener("focusout", (event) => {
  if (event.target.matches("[data-answer-text],[data-recall-text],[data-question-note]")) deferredSaves.flush().catch(() => {});
});
window.addEventListener("pagehide", () => {
  pausePracticeQuestion(displayedPractice);
  pauseExamQuestion(displayedExam);
  deferredSaves.flush().catch(() => {});
  if (displayedExam || displayedPractice) persist();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.theme === "system") updateTheme();
});
if (route().page === "welcome") render();
try {
  const [data, notes, api] = await Promise.all([openStorage(), loadKnowledge(), loadConfig()]);
  configuredAPI = api;
  knowledge = notes;
  bank = data.bank;
  const originalState = JSON.stringify(data.state);
  state = normalizeKnowledgeRecords({ ...emptyState(), ...data.state });
  if (state.practice) state.practice.questionStartedAt = null;
  if (state.preparation?.session) state.preparation.session.questionStartedAt = null;
  syncPreparationMistakes(bank, state);
  storageReady = true;
  for (const e of state.exams) e.questionStartedAt = null;
  for (const exam of state.exams)
    if (exam.status === "active" && exam.endsAt <= Date.now())
      finishExam(state, bank, exam);
  if (data.needsSave || JSON.stringify(state) !== originalState) await persist();
  render();
  if (data.notice) toast(data.notice);
} catch (err) {
  if (err instanceof StorageConflictError) render();
  else
  app.innerHTML = `<div class="boot"><span class="boot-mark">∑</span><h1>暂时无法打开学习空间</h1><p>请允许此网站使用浏览器存储，或在普通浏览窗口中重试。</p><p>${esc(err.message)}</p><button class="btn" onclick="location.reload()">重新打开</button></div>`;
}
