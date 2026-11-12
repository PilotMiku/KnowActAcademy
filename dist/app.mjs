import { entryPreferences, rememberEntry, resumeRoute, guideHTML } from "./learning-guide.mjs";
import { preparationTreeHTML, syncPreparationTree, changeScope } from "./preparation-scope.mjs";
import { questionCounts, questionCountDescription } from "./question-counts.mjs";
import { createExamSetup } from "./exam-setup.mjs";
import { createLibraryPages } from "./library-pages.mjs";
import { icon, brandIcon, esc, attr, button, head, empty } from "./ui.mjs";
import { renderRich } from "./rich-content.mjs";
import { createReadingController } from "./knowledge-reading.mjs";
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
  isScorable,
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
import { openStorage, saveStorage, onStorageConflict, storageConflicted, storageVersion, StorageConflictError } from "./storage.mjs";
import { createRestoreGuard } from "./restore-guard.mjs";
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
import { fetchJSON } from "./resources.mjs";
import { createBackup, MAX_BACKUP_BYTES, PROGRESS_BACKUP_FORMAT } from "./backup-codec.mjs";
import { loadedQuestion, loadQuestionContent, materializeBank } from "./question-content.mjs";
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

let knowledge = { ...emptyKnowledge(), loading: true };
const sync = createSyncClient();
let configuredAPI = "";
async function loadConfig() {
  try {
    return String((await fetchJSON("./config.json", { timeout: 3000 })).apiBase || "");
  } catch { /* Optional backend configuration never blocks local study. */ }
  return "";
}

async function loadKnowledge() {
  try {
    const data = await fetchJSON("./data/knowledge.json");
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
  sessionTransitionPending = false;
let displayedExam = null;
let displayedPractice = null;
let localEditVersion = 0;
let dialogGeneration = 0;
const restoreGuard = createRestoreGuard(() => ({ bank, state, version: storageVersion(),
  edits: localEditVersion, conflict: storageConflicted(), drafts: deferredSaves.pending,
  hash: location.hash, dialog: dialogGeneration }));
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
const sessionTransitions = new Set([
  "start-practice", "start-collection", "practice-one", "begin-preparation",
  "next-training", "resume-preparation", "start-spaced", "spaced-one",
  "begin-exam", "navigate-question", "next-question", "complete-preparation",
]);
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
  knowledge: "学习资料",
};
function route() {
  const [path, query = ""] = (location.hash.slice(1) || "/").split("?");
  return {
    parts: path.split("/").filter(Boolean),
    query: new URLSearchParams(query),
    page: !location.hash ? (entryPreferences().entered ? "dashboard" : "welcome") : path === "/" ? "dashboard" : path.split("/")[1],
  };
}
function go(path) {
  dialog.close();
  mobileOpen = false;
  if (!path.startsWith("/welcome")) rememberEntry();
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
  return loadedQuestion(bank, id) ?? getBankIndex(bank).questions.get(id);
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
let saveSequence = 0, saveMessage = "准备保存", saveFailed = false;
function setSaveState(message, failed = false) {
  saveMessage = message; saveFailed = failed;
  const label = document.querySelector('[data-save-message]');
  if (label) label.textContent = message;
  const indicator = document.querySelector('.save-indicator');
  if (indicator) indicator.dataset.failed = String(failed);
  const retry = document.querySelector('[data-action="retry-save"]');
  if (retry) retry.hidden = !failed;
}
function scheduleSave() {
  setSaveState("等待保存…"); deferredSaves.schedule();
}
function persist() {
  localEditVersion++;
  const sequence = ++saveSequence;
  setSaveState("正在保存…");
  readingController.capture(false);
  deferredSaves.cancel();
  if (!storageReady) {
    setSaveState("当前无法保存", true);
    return Promise.reject(new Error("当前浏览器无法保存学习数据"));
  }
  const practiceRunning = Number.isFinite(displayedPractice?.questionStartedAt);
  const examRunning = Number.isFinite(displayedExam?.questionStartedAt);
  pausePracticeQuestion(displayedPractice);
  pauseExamQuestion(displayedExam);
  if (state.preparation && state.practice?.preparationId === state.preparation.id)
    state.preparation.session = structuredClone(state.practice);
  try { saving = saveStorage(bank, state); }
  catch (error) { saving = Promise.reject(error); }
  if (!document.hidden && !storageConflicted()) {
    if (practiceRunning) resumePracticeQuestion(displayedPractice);
    if (examRunning) resumeExamQuestion(displayedExam);
  }
  saving.catch((error) => {
    if (sequence !== saveSequence) return;
    setSaveState("保存失败，请重试或导出备份", true);
    for (const status of document.querySelectorAll("[data-note-status]")) status.textContent = "尚未保存，请先导出此页备份";
    if (!(error instanceof StorageConflictError)) toast("保存失败，请检查浏览器可用空间，并导出备份");
  });
  saving.then(() => {
    if (sequence !== saveSequence) return;
    setSaveState(deferredSaves.pending ? "等待保存…" : "已保存到此浏览器");
    if (!deferredSaves.pending)
      for (const status of document.querySelectorAll("[data-note-status]")) status.textContent = "已保存";
  }, () => {});
  return saving;
}
const deferredSaves = createSaveScheduler(() => persist(), () => toast("保存失败，请导出备份"));
const readingController = createReadingController({ getState: () => state,
  canSave: () => storageReady && !storageConflicted(),
  schedule: () => scheduleSave(), toast });
installQuestionNotes({ getState: () => state, getQuestion: qById,
  save: () => persist(), schedule: () => scheduleSave() });
onStorageConflict(() => {
  restoreGuard.cancel();
  pausePracticeQuestion(displayedPractice);
  pauseExamQuestion(displayedExam);
  deferredSaves.cancel();
  clearInterval(timerInterval);
  dialog.close();
  app.inert = true;
  document.querySelector("#storage-conflict").hidden = false;
  document.querySelector("#export-stale-progress").hidden = bank.managedBundle === false || !bank.revision?.startsWith('pdf-');
});
document.querySelector("#reload-latest").addEventListener("click", () => location.reload());
document.querySelector("#export-stale-page").addEventListener("click", async () => {
  try { await downloadBackup(`知行学习-此页备份-${dayKey()}.json`); } catch (error) { toast(error.message); }
});
document.querySelector("#export-stale-progress").addEventListener("click", async () => {
  try { await downloadBackup(`知行学习-此页进度备份-${dayKey()}.json`, true); } catch (error) { toast(error.message); }
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
function filtersHTML(filters, search = true, mode = "all") {
  const selectedSubjects = bank.subjects.filter(
    (s) => !filters.subjectId || s.id === filters.subjectId,
  );
  const basic = `<div class="field"><label for="subject-filter">科目</label><select id="subject-filter" data-filter="subject"><option value="">全部科目</option>${bank.subjects.map((s) => `<option value="${attr(s.id)}" ${s.id === filters.subjectId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div><div class="field"><label for="chapter-filter">章节</label><select id="chapter-filter" data-filter="chapter"><option value="">全部章节</option>${selectedSubjects.map((s) => `<optgroup label="${attr(s.name)}">${s.chapters.map((c) => `<option value="${attr(c.id)}" ${c.id === filters.chapterId ? "selected" : ""}>${c.parentId ? "　↳ " : ""}${esc(c.name)}</option>`).join("")}</optgroup>`).join("")}</select></div>`;
  const advanced = `<div class="field"><label for="type-filter">题型</label><select id="type-filter" data-filter="type"><option value="">全部题型</option>${Object.entries(
    names,
  )
    .map(
      ([k, v]) =>
        `<option value="${k}" ${filters.type === k ? "selected" : ""}>${v}</option>`,
    )
    .join(
      "",
    )}</select></div>${search ? `<div class="field"><label for="question-search">关键词</label><input class="input" id="question-search" type="search" data-filter="q" value="${attr(filters.search)}" placeholder="搜索题干或标签"></div>` : ""}`;
  return mode === "advanced" ? `<div class="practice-advanced-fields">${advanced}</div>` : `<div class="${mode === "basic" ? "filter-bar practice-filters" : "card filter-bar"}">${basic}${mode === "basic" ? "" : advanced}</div>`;
}
function practiceControls() {
  const query = route().query;
  return `<div class="practice-extra-controls"><div class="field"><label for="practice-status">练习范围</label><select id="practice-status" data-filter="status"><option value="">全部题目</option><option value="unseen" ${query.get("status") === "unseen" ? "selected" : ""}>只练未做题</option><option value="unmastered" ${query.get("status") === "unmastered" ? "selected" : ""}>只练未掌握题</option></select></div><div class="field"><label for="random-distribution">随机抽题方式</label><select id="random-distribution" data-filter="distribution"><option value="random">题目均匀随机</option><option value="balanced" ${query.get("distribution") === "balanced" ? "selected" : ""}>按大章节均衡抽题</option></select></div><p class="format-note">未掌握题按连续两次确定答对判断，备考范围使用当前计划的掌握状态。</p></div>`;
}
function questionToolbar() {
  const q = currentQuestion(), exam = currentExam(), p = state.practice;
  if (!q) return "";
  const uncertain = exam ? exam.uncertainIds?.includes(q.id) : p?.responses[q.id]?.uncertain;
  const locked = !isScorable(q) || !exam && p?.responses[q.id]?.graded;
  return `<div class="question-toolbar">${button(`${icon("target", 15)} ${state.studySettings.focus ? "退出专注" : "专注模式"}`, "toggle-focus", `aria-pressed="${state.studySettings.focus}"`, "btn small")}${button(`${icon("settings", 15)} 学习显示设置`, "display-settings", "", "btn small")}${button(uncertain ? "? 已标记拿不准" : "? 这题拿不准", "toggle-uncertain", `aria-pressed="${!!uncertain}" ${locked ? "disabled" : ""}`, "btn small uncertain-control")}</div>`;
}
let practiceOptionsOpen = false, practiceProgressOpen = false;
function practicePage() {
  if (route().query.has("session") && state.practice) return practiceSession();
  const filters = getFilters(), query = route().query;
  const questions = practicePool(bank, filters, state);
  const progress = learningProgress(filterQuestions(bank, filters, state), state);
  const randomCount = query.get("count") === "all" ? "all" : "25";
  const view = query.get("view") === "chapters" ? "chapters" : "questions";
  const advanced = !!(filters.type || filters.search || filters.status || query.get("distribution") || query.get("count"));
  const href = (view) => { const next = new URLSearchParams(query); next.set("view", view); return "#/practice?" + next; };
  const chapterName = getBankIndex(bank).chapters.get(filters.subjectId)?.get(filters.chapterId)?.name
    ?? bank.subjects.flatMap(s => s.chapters).find(c => c.id === filters.chapterId)?.name;
  return `${head("章节练习", "选好科目与章节，就可以开始。", state.practice ? button(`继续上次练习 ${icon("arrow", 14)}`, "resume-practice", "", "btn soft") : "")}
    <section class="card practice-start practice-setup" aria-label="选择练习范围">
      ${filtersHTML(filters, true, "basic")}
      <div class="practice-scope-summary"><strong>${esc(chapterName ?? subject(filters.subjectId)?.name ?? "全部题目")}</strong><span>共 ${questions.length.toLocaleString()} 条 · 可评分 ${questionCounts(questions).scorable.toLocaleString()} 题</span></div>
      <div class="practice-primary-actions">${button(`${icon("book", 17)} 顺序练习`, "start-practice", `data-mode="sequential" ${questions.length ? "" : "disabled"}`, "btn primary")}${button(`${icon("refresh", 17)} ${randomCount === "all" ? "随机所有题目" : `随机 ${DEFAULT_QUESTION_COUNT} 题`}`, "start-practice", `data-mode="random" ${questions.length ? "" : "disabled"}`, "btn")}</div>
      <details class="practice-options" ${advanced || practiceOptionsOpen ? "open" : ""}><summary>筛选与练习设置${advanced ? " · 已启用" : ""}</summary><div class="practice-options-body">${filtersHTML(filters, true, "advanced")}${practiceControls()}<div class="field"><label for="random-count">随机题量</label><select id="random-count" data-filter="count"><option value="25" ${randomCount === "25" ? "selected" : ""}>25 题</option><option value="all" ${randomCount === "all" ? "selected" : ""}>所有题目（${questions.length} 题）</option></select></div><p class="format-note question-count-note">${esc(questionCountDescription(questions))}</p></div></details>
    </section>
    <details class="practice-progress" ${practiceProgressOpen ? "open" : ""}><summary><span>${icon("chevron", 13)} 学习进度</span><span>已完成 ${progress.completed} / ${progress.total} 题 · ${progress.completion}%</span></summary>${learningProgressCard(progress)}</details>
    <nav class="practice-view-switch" aria-label="浏览练习内容"><a href="${attr(href("questions"))}" ${view === "questions" ? 'aria-current="page"' : ""}>题目列表</a><a href="${attr(href("chapters"))}" ${view === "chapters" ? 'aria-current="page"' : ""}>章节目录</a><a href="#/prepare" class="practice-prepare-link">${icon("target", 14)} 备考测评</a></nav>
    ${view === "chapters" ? `<div class="section-head"><h2>章节目录 <small>展开查看小节</small></h2></div>${bank.subjects.filter(s => !filters.subjectId || s.id === filters.subjectId).map(s => `<section class="subject-chapters"><h3 class="subject-label">${esc(s.name)}</h3>${chapterCards(true, s.id)}</section>`).join("")}`
      : questions.length ? `<div class="section-head"><h2>题目列表 <small>显示前 ${Math.min(20, questions.length)} 题，开始练习可访问全部</small></h2></div><section class="card">${questions.slice(0, 20).map((q, i) => collectionRow(q, i, "preview")).join("")}</section>`
      : empty("没有符合条件的题目", "请调整筛选，或返回全部题目。", '<a class="btn" href="#/practice">清除筛选</a>')}`;
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
  const diagnostic = diagnosticProgress(state, bank);
  const active = currentPreparationPractice(state);
  const unfinished = active && !practiceProgress(active, bank).ready;
  const scope = prep ? prep.chapterIds.map((id) => getBankIndex(bank).chapters.get(prep.subjectId)?.get(id)?.name).filter(Boolean).join("、") : "";
  return `${head("备考模式", "先随机测评，再围绕薄弱知识点加权刷题。掌握得越好，相关题目出现得越少。")}${prep ? `${preparationStatus()}<section class="card preparation-current"><div><span class="pill blue">当前备考 · ${esc(subject(prep.subjectId)?.name)}</span><h2>${diagnostic.ready ? "测评完成，开始专项巩固" : `测评进度 ${diagnostic.completed} / ${diagnostic.total}`}</h2><p>${esc(scope)}</p><p class="muted">${diagnostic.ready ? `已开启 ${prep.round} 组加权训练` : "请完成全部测评题，解答题对照答案自评后计入。"}</p></div><div class="flex">${unfinished || !diagnostic.ready ? button("继续备考", "resume-preparation", "", "btn primary") : button(`开始加权训练 · ${trainingCount(bank, prep)} 题`, "next-training", "", "btn primary")}${active && !unfinished ? button("查看本组结果", "resume-preparation") : ""}</div></section>${preparationReviewCard()}${preparationTopics()}` : ""}${prep || state.preparationHistory.length ? trendPanel(bank, state, route().query.get("plan"), { esc, attr }) : ""}<section class="card preparation-setup"><h2>${prep ? "重新选择备考范围" : "选择备考范围"}</h2><p class="subtitle">一次选择一个科目，可勾选多个大章或小节。大章包含下属全部小节。</p><div class="field"><label for="prepare-subject">备考科目</label><select id="prepare-subject">${bank.subjects.map((s) => `<option value="${attr(s.id)}" ${s.id === selection.subjectId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div><div class="preparation-launch"><p id="prepare-availability" aria-live="polite">${preparationAvailability(available)}</p>${button(`开始 ${PREPARATION_COUNT} 题测评`, "begin-preparation", available ? "" : "disabled", "btn primary")}</div><fieldset class="exam-chapters preparation-chapters" aria-describedby="prepare-availability"><legend>章节范围（可多选）</legend><div class="flex">${button("全选大章", "prepare-select-all", "", "btn small")}${button("清空选择", "prepare-select-none", "", "btn small")}</div><p class="scope-help">勾选大章包含全部小节。取消整章后，可展开选择小节。下列数量为可评分题量。</p><div class="preparation-chapter-options">${preparationTreeHTML(bank, selection.subjectId, selection.chapterIds)}</div></fieldset><details class="preparation-progress"><summary>查看所选范围的学习进度</summary><div id="prepare-learning-progress">${learningProgressCard(learningProgress(preparationQuestions(bank, selection), state))}</div></details><details class="preparation-options"><summary>训练题量与测评说明</summary><div class="field"><label for="prepare-round-policy">后续训练题量</label><select id="prepare-round-policy"><option value="adaptive" ${selection.roundPolicy === "adaptive" ? "selected" : ""}>自动强化：小题库使用短组</option><option value="fixed" ${selection.roundPolicy === "fixed" ? "selected" : ""}>固定 20 题，不足则全部</option></select></div><p class="format-note">${prep ? "重新测评会建立新的备考计划，已有答题记录保留。" : "首组均匀随机抽题，不受历史成绩影响。"}选择、判断、填空题自动判分，解答题需自评。</p></details></section>`;
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
function updatePreparationSelection(changed = null) {
  const subjectId = document.querySelector("#prepare-subject").value;
  const chapters = subject(subjectId).chapters;
  const selected = changed ? changeScope(chapters, preparationSelection().chapterIds, changed.value, changed.checked)
    : [...document.querySelectorAll('[data-prepare-chapter]:checked:not(:disabled)')].map(input => input.value);
  const query = new URLSearchParams({ subject: subjectId, scope: "custom" });
  query.set("roundPolicy", document.querySelector("#prepare-round-policy").value);
  for (const id of selected) query.append("chapter", id);
  history.replaceState(null, "", "#/prepare?" + query);
  syncPreparationTree(app, chapters, selected);
  const questions = preparationQuestions(bank, preparationSelection());
  document.querySelector("#prepare-availability").textContent = preparationAvailability(questions.length);
  document.querySelector("#prepare-learning-progress").innerHTML = learningProgressCard(learningProgress(questions, state));
  document.querySelector('[data-action="begin-preparation"]').disabled = !questions.length;
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
  if (!isScorable(qById(id))) return '<p class="preparation-question-status">仅供查阅 · 不计掌握度</p>';
  const result = currentPreparationMetrics().questions.get(id);
  const streak = result?.correctStreak ?? 0;
  return `<p class="preparation-question-status"><span class="pill ${result?.mastered ? "green" : "blue"}" data-preparation-question-status>${result?.mastered ? "已掌握" : result?.wrongCount ? "错题巩固中" : "掌握确认中"} · 连续答对 ${streak} / 2 次</span>${result?.wrongCount && !result.mastered ? "<small>已提高后续抽中频率</small>" : ""}</p>`;
}
function preparationRoundSummary() {
  const p = state.practice;
  const progress = practiceProgress(p, bank);
  return `<section class="card preparation-summary"><span class="pill blue">${p.mode === "spaced" ? "到期复习" : p.mode === "prepare-diagnostic" ? "备考测评" : `加权训练 · 第 ${p.round} 组`}</span><h2>${progress.ready ? "本组已完成" : "还有题目待完成"}</h2><p>共 ${progress.total} 题，已完成 ${progress.completed} 题，答对 ${progress.correct} 题${progress.completed ? `，正确率 ${Math.round(progress.correct / progress.completed * 100)}%` : ""}。</p><p class="muted">${progress.ready ? "已根据本组表现更新复习重点，可开始下一组加权训练。" : "跳过的题目不会按错题计入。请先补完；解答题需选择自评结果。"}</p><div class="flex">${progress.ready ? button("下一组加权训练", "next-training", "", "btn primary") : button("继续完成本组", "complete-preparation", "", "btn primary")}<a href="#/prepare" class="btn">查看备考计划</a></div></section>${preparationStatus()}${preparationTopics()}${trendPanel(bank, state, state.preparation?.id, { esc, attr })}`;
}

function optionHTML(q, response, graded = false, correct = null) {
  const selected = Array.isArray(response) ? response : [response];
  const answers = Array.isArray(q.answer) ? q.answer : [q.answer];
  return `<div class="options">${q.options
    .map((o) => {
      let style = selected.includes(o.id) ? "selected" : "";
      if (graded && isScorable(q)) {
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
  const notice = isScorable(q) ? "" : '<p class="notice" role="note">此题原件缺损或答案待核实，仅供查阅，不计分、不计掌握度，也不安排复习。</p>';
  if (!q.source?.documentId) return notice;
  let href = `./source-pdf/${encodeURIComponent(q.source.documentId)}.pdf#page=${Number(q.source.page) || 1}`;
  if (q.source.url) {
    try {
      const url = new URL(q.source.url);
      if (url.protocol === "https:" && !url.username && !url.password) href = url.href;
    } catch {}
  }
  const label = q.source.format === "html" ? "查看原始资料" : `查看原 PDF · 第 ${Number(q.source.page) || 1} 页`;
  return notice + `<div class="source-info"><span>${esc(q.sourceLabel)}</span><a href="${attr(href)}" target="_blank" rel="noopener noreferrer">${label} ${icon("arrow", 12)}</a></div>`;
}
function resultBox(q, r, { mode = "practice" } = {}) {
  const preparing = ["prepare-diagnostic", "prepare-training"].includes(mode);
  return feedbackHTML(q, r, { mode, mastery: preparing ? currentPreparationMetrics().questions.get(q.id) : null,
    mistake: state.mistakes[q.id] }, { icon, attr, button });
}
function refreshGradedPractice(p, q) {
  const response = p.responses[q.id];
  const submittedWithFocus = document.activeElement?.matches('[data-action="submit-answer"],[data-action="self-grade"]');
  if (!patchPracticeAnswer({ root: app, question: q, practice: p, response,
    feedback: resultBox(q, response, { mode: p.mode }),
    status: isPreparationPractice(p) ? preparationStatus() : "",
    questionStatus: isPreparationPractice(p) ? preparationQuestionStatus(q.id) : "", progress: practiceProgress(p, bank), renderRich })) {
    if (currentQuestion()?.id === q.id && route().query.has("session")) render();
  }
  requestAnimationFrame(() => {
    if (currentQuestion()?.id !== q.id || !route().query.has("session")) return;
    const result = app.querySelector('.result-box');
    const announcement = document.querySelector('#answer-announcement');
    announcement.textContent = '';
    requestAnimationFrame(() => { if (currentQuestion()?.id === q.id) announcement.textContent = result?.querySelector('.result-label')?.textContent ?? ''; });
    if (submittedWithFocus) (app.querySelector('[data-action="self-grade"]') ?? app.querySelector('[data-action="next-question"]'))?.focus({ preventScroll: true });
    if (matchMedia('(max-width:600px)').matches)
      result?.scrollIntoView({ block: 'nearest', behavior: document.documentElement.dataset.motion === 'reduced' ? 'instant' : 'smooth' });
  });
}
function questionNavigation(p, exam = false) {
  const completed = exam
    ? Object.keys(p.answers).filter((id) =>
        hasResponse(qById(id), p.answers[id]),
      ).length
    : practiceProgress(p, bank).completed;
  const total = exam ? p.questionIds.length : practiceProgress(p, bank).total;
  const navStart = Math.floor(p.index / 40) * 40;
  return `<aside class="card question-nav"><div class="card-head"><h3>题目导航</h3><span class="muted" style="font-size:10px">${completed}/${total}</span></div><div class="progress-bar"><span style="width:${total ? completed / total * 100 : 0}%"></span></div><div class="question-index">${p.questionIds
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
  return `${head(p.mode === "spaced" ? "到期复习" : p.mode === "prepare-diagnostic" ? "备考测评" : p.mode === "prepare-training" ? `加权训练 · 第 ${p.round} 组` : p.mode === "random" ? "随机练习" : p.mode === "review" ? "错题回顾" : p.mode === "favorites" ? "收藏练习" : "章节练习", `${esc(subject(q.subjectId)?.name ?? "")} · ${esc(chapter(q))}`, button(`${icon("back", 13)} 选择练习`, "exit-practice", "", "btn"))}${questionToolbar()}${isPreparationPractice(p) ? preparationStatus() : ""}<div class="question-layout"><section class="card question-main" data-practice-id="${attr(p.id)}" data-question-id="${attr(q.id)}"><div class="question-top"><div class="flex"><span class="pill green">${names[q.type]}</span><span class="pill">${q.source ? "原题" : difficultyNames[q.difficulty]}</span></div>${button(icon("star", 18), "toggle-favorite", `data-id="${attr(q.id)}" aria-label="${state.favorites.includes(q.id) ? "取消收藏" : "收藏题目"}" style="color:${state.favorites.includes(q.id) ? "var(--accent)" : "var(--muted)"}"`, "icon-btn")}</div>${isPreparationPractice(p) ? preparationQuestionStatus(q.id) : ""}<p class="eyebrow">QUESTION ${String(p.index + 1).padStart(2, "0")} <span class="muted">/ ${p.questionIds.length}</span></p>${sourceInfo(q)}<div class="question-title rich" data-rich="${attr(q.stem)}"></div>${q.source ? `<p class="pdf-reading-note">长公式可左右滑动查看</p>` : ""}${answerInput(q, r.answer, r.graded || !isScorable(q))}${r.graded ? resultBox(q, r, { mode: p.mode }) : ""}${questionNotesHTML(q.id, state, { esc, attr })}<div class="question-actions">${button(`${icon("back", 13)} 上一题`, "navigate-question", `data-index="${p.index - 1}" ${p.index === 0 ? "disabled" : ""}`, "btn")}<span class="grow"></span>${!r.graded ? button(!isScorable(q) ? "查看参考（不计分）" : q.type === "solution" ? "查看参考答案" : "确认答案", "submit-answer", "", "btn primary") : ""}${button(`${p.index === p.questionIds.length - 1 ? "完成本组" : "下一题"} ${icon("arrow", 13)}`, "next-question", "", "btn " + (r.graded ? "primary" : ""))}</div></section>${questionNavigation(p)}</div><p class="shortcut-hint">${q.type === "fill" ? "填空题按题库答案及可接受答案匹配；等价数学表达式请以原题配置为准。" : "先思考，再确认。答题记录只保存在当前浏览器。"}</p>`;
}
function requireBundledBank() {
  if (bank.managedBundle === false || !bank.revision?.startsWith("pdf-"))
    throw new Error("自定义题库请通过导出和恢复完整备份跨设备迁移");
  if (state.exams.some((exam) => exam.status === "active"))
    throw new Error("请先完成正在进行的考试，再同步学习进度");
}
const { libraryPage, showCloudConnect } = createLibraryPages({ getBank: () => bank, sync,
  getConfiguredAPI: () => configuredAPI, openDialog, shortDate });
const { examChapterOptions, examFilters, updateExamAvailability, examOptions } = createExamSetup({
  getBank: () => bank, getState: () => state, dialog, openDialog, toast, go, defaultCount: DEFAULT_QUESTION_COUNT });
const { dashboard, chapterCards, statsPage } = createOverviewPages({
  getGuideHTML: () => !entryPreferences().guideDismissed && !state.attempts.length && !state.practice && !state.preparation && !state.exams.length ? guideHTML({ dismissible: true }) : "",
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
  returnToPractice: () => {
    if (practiceReturn) { pendingPracticeScroll = practiceReturn; go(practiceReturn.hash.slice(1)); }
    else go("/practice");
  },
  getBank: () => bank, getState: () => state, getFilters, route, subject,
  startPractice, persist, go, toast, render, isPreparationPractice, preparationSelection,
  updatePreparationSelection, showConceptDetails, currentQuestion, currentExam,
  updateSelectedOptions, updateExamProgress, tickExam, submitPractice, openDialog, defaultCount: DEFAULT_QUESTION_COUNT,
});

let renderPending = false;
let lastView = "";
let contentLoad = null;
function prepareQuestionView(ids) {
  const key = JSON.stringify(ids), currentBank = bank;
  if (contentLoad && (contentLoad.bank !== bank || contentLoad.key !== key)) {
    contentLoad.controller.abort(); contentLoad = null;
  }
  if (!bank.contentCatalog || !ids.length || ids.some(id => !getBankIndex(bank).questions.has(id)) || ids.every(id => loadedQuestion(bank, id))) return "";
  if (!contentLoad) {
    const pending = { bank, key, controller: new AbortController(), error: null };
    contentLoad = pending;
    loadQuestionContent(bank, ids, undefined, { signal: pending.controller.signal }).then(() => {
      if (contentLoad === pending && bank === currentBank) { contentLoad = null; render(); }
    }).catch(error => {
      if (contentLoad === pending && error.name !== 'AbortError') { pending.error = error; render(); }
    });
  }
  return contentLoad?.error
    ? `<section class="card" role="alert"><h2>题目暂时无法加载</h2><p>${esc(contentLoad.error.message)}</p>${button("重新加载题目", "retry-content", "", "btn primary")}<a class="btn" href="#/practice">返回题库</a></section>`
    : '<section class="card" role="status"><p>正在加载题目…</p><a class="text-btn" href="#/practice">返回题库</a></section>';
}
function render() {
  if (renderPending) return;
  renderPending = true;
  queueMicrotask(() => {
    renderPending = false;
    draw();
  });
}
function draw() {
  readingController.detach();
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
  document.body.dataset.studyActivity = (practice || exam?.status === "active") ? "question" : "overview";
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
  const ids = page === 'exam' && exam ? exam.status === 'submitted' ? exam.questionIds : [exam.questionIds[exam.index]]
    : practice ? [practice.questionIds[practice.index]] : [];
  const contentNotice = prepareQuestionView(ids);
  if (contentNotice) { pausePracticeQuestion(displayedPractice); pauseExamQuestion(displayedExam); }
  const view = `${location.hash}:${state.practice?.id}:${state.practice?.index}:${exam?.id}:${exam?.index}:${exam?.status}`;
  const entering = view !== lastView;
  lastView = view;
  const navItems = [
    ["dashboard", "home", "学习概览", "/"],
    ["practice", "book", "题库练习", "/practice"],
    ["prepare", "target", "备考模式", "/prepare"],
    ["knowledge", "book", "学习资料", "/knowledge"],
    ["exams", "exam", "模拟考试", "/exams"],
    ["review", "mistake", "错题本", "/review"],
    ["favorites", "star", "我的收藏", "/favorites"],
    ["stats", "chart", "学习统计", "/stats"],
  ];
  const countWrong = Object.values(state.mistakes).filter(
    (m) => !m.resolved,
  ).length;
  app.innerHTML = `<div class="local-shell"><header class="local-header"><div class="local-navbar"><a class="local-brand" href="#/welcome" aria-label="知行学习 欢迎页">${brandIcon(document.documentElement.dataset.theme)}<strong>知行学习</strong><span>题库</span></a><nav class="local-nav ${mobileOpen ? "open" : ""}" aria-label="主要导航">${[...navItems, ["library", "folder", "题库管理", "/library"]].map(([key, i, label, path]) => `<a href="#${path}" class="${page === key || (page === "exam" && key === "exams") ? "active" : ""}" ${page === key ? 'aria-current="page"' : ""}>${icon(i, 16)}${label}${key === "review" && countWrong ? `<small>${countWrong}</small>` : ""}</a>`).join("")}</nav><div class="local-header-actions">${button(icon("settings", 19), "display-settings", 'aria-label="学习显示设置"', "icon-btn")}${button(icon("search", 19), "search", 'aria-label="搜索题目与知识点"', "icon-btn")}${button(icon(document.body.classList.contains("dark") ? "sun" : "moon", 19), "toggle-theme", 'aria-label="切换明暗主题"', "icon-btn")}${button(icon("menu", 20), "toggle-menu", `aria-label="打开导航" aria-expanded="${mobileOpen}"`, "icon-btn local-menu")}</div></div></header><main id="main" class="local-main" tabindex="-1">${contentNotice || (page === "dashboard" ? dashboard() : page === "practice" ? practicePage() : page === "prepare" ? preparationPage() : page === "spaced" ? spacedReviewPage() : page === "knowledge" ? knowledgePage(knowledge, state, r, { esc, attr, icon, button, head }) : page === "review" || page === "favorites" ? collectionPage(page) : page === "exams" ? examsPage() : page === "exam" ? examPage() : page === "stats" ? statsPage() : libraryPage())}<div class="save-indicator" data-failed="${saveFailed}"><span data-save-message role="status" aria-live="polite">${esc(saveMessage)}</span>${button("重试保存", "retry-save", saveFailed ? "" : "hidden", "btn small")}</div><footer class="footer"><a href="#/welcome" aria-label="查看起始页">知行学习 · 练习与知识复习</a>${button("学习指南", "open-guide", "", "text-btn")}</footer></main></div>`;
  document.title = `${routes[page]} · 知行学习`;
  document.querySelector("#main").toggleAttribute("data-enter", entering);
  renderRich(app, page === "exam" && exam?.status === "submitted");
  readingController.mount(app);
  attachDropZone();
  if (page === "prepare" && document.querySelector('#prepare-subject')) {
    const selection = preparationSelection();
    syncPreparationTree(app, subject(selection.subjectId).chapters, selection.chapterIds);
  }
  if (pendingPracticeScroll?.hash === location.hash) {
    const y = pendingPracticeScroll.y; pendingPracticeScroll = null;
    requestAnimationFrame(() => scrollTo(0, y));
  }
  watchActiveExams();
}
function watchActiveExams() {
  if (storageReady && !storageConflicted() && state.exams.some((e) => e.status === "active")) {
    tickExam();
    timerInterval = setInterval(tickExam, 1000);
  }
}
function openDialog(title, body, actions = "") {
  restoreGuard.cancel();
  dialogGeneration++;
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
  const blob = value instanceof Blob ? value : new Blob(
    [typeof value === "string" ? value : JSON.stringify(value)],
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
async function downloadBackup(name, progressOnly = false, { signal } = {}) {
  const snapshotBank = bank, snapshotState = structuredClone(state);
  const full = progressOnly ? snapshotBank : await materializeBank(snapshotBank);
  if (signal?.aborted) throw new DOMException('恢复已取消', 'AbortError');
  const payload = createBackup(full, snapshotState, progressOnly);
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  if (blob.size > MAX_BACKUP_BYTES)
    throw new Error(progressOnly ? '进度备份超过 50 MiB，请先连接服务器同步' : '完整备份超过 50 MiB，请导出轻量进度备份或连接服务器同步');
  download(name, blob);
}
function selectFile(mode = "bank") {
  fileMode = mode;
  const el = document.querySelector("#file-input");
  el.value = "";
  el.click();
}
let practiceReturn = null, pendingPracticeScroll = null;
async function startPractice(ids, mode) {
  if (route().page === "practice" && !route().query.has("session")) practiceReturn = { hash: location.hash, y: scrollY };
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
  if (!isScorable(q)) {
    p.responses[q.id] = { ...r, graded: true, correct: null, referenceOnly: true };
    pausePracticeQuestion(p);
    await persist();
    refreshGradedPractice(p, q);
    return;
  }
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
  if (file.size > MAX_BACKUP_BYTES) {
    toast("文件超过 50 MB，请拆分题库");
    return;
  }
  try {
    const parsed = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
    if (fileMode === "backup") {
      const restored = validateBackup(parsed, bank);
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
              `<button class="search-item" data-action="open-knowledge" data-id="${attr(article.id)}">${esc(article.title)}<small>学习资料 · ${esc(article.category)}</small></button>`,
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
    `<label class="sr-only" for="global-search">搜索题目与知识点</label><input class="input" id="global-search" type="search" placeholder="搜索题目、学习资料…" autocomplete="off"><div class="search-results" id="search-results"><p style="padding:16px 8px">输入关键词，查找数学题目或学习资料。</p></div>`,
  );
  setTimeout(() => document.querySelector("#global-search")?.focus(), 50);
}
async function handleAction(action, el) {
  if (storageConflicted()) throw new StorageConflictError();
  if (restoreGuard.pending && action !== "close-dialog") {
    toast("正在恢复学习记录，请等待或关闭弹窗取消恢复"); return;
  }
  if (await sessionActions(action, el)) return;
  switch (action) {
    case "retry-save":
      await persist(); break;
    case "open-guide":
      openDialog("学习指南", guideHTML(), button("关闭指南", "close-dialog", "", "btn primary"));
      break;
    case "dismiss-guide":
      rememberEntry({ guideDismissed: true }); render(); break;
    case 'retry-content':
      contentLoad?.controller.abort(); contentLoad = null; render(); break;
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
      if (el.dataset.figureLoading || !el.naturalWidth) break;
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
        const dialogAtStart = dialogGeneration;
        await deferredSaves.flush();
        await saving;
        if (!dialog.open || dialogAtStart !== dialogGeneration) throw new DOMException('恢复已取消', 'AbortError');
        const token = restoreGuard.start();
        try {
        const remote = await sync.read({ signal: token.controller.signal });
        restoreGuard.assert(token);
        if (!remote.payload) throw new Error("服务器还没有学习进度，请先从有进度的设备上传");
        if (remote.payload.bankRevision !== bank.revision) throw new Error("两端题库版本不一致，请先更新网站或使用完整备份迁移");
        const restored = validateBackup({ format: PROGRESS_BACKUP_FORMAT, bankRevision: remote.payload.bankRevision, state: remote.payload.state }, bank);
        // Finish any exam that expired while the remote snapshot was idle.
        for (const exam of restored.state.exams)
          if (exam.status === "active" && exam.endsAt <= Date.now()) finishExam(restored.state, bank, exam);
        if (restored.state.exams.some((exam) => exam.status === "active"))
          throw new Error("服务器进度包含正在进行的考试，请在原设备完成后重新上传");
        await saving;
        restoreGuard.assert(token);
        requireBundledBank();
        await downloadBackup(`知行学习-同步前备份-${dayKey()}.json`, false, { signal: token.controller.signal });
        restoreGuard.assert(token);
        const previous = state;
        state = normalizeKnowledgeRecords(restored.state);
        syncPreparationMistakes(bank, state);
        try { await persist(); } catch (error) { state = previous; throw error; }
        restoreGuard.finish(token);
        go("/library"); render(); toast("服务器进度已恢复");
        } finally { restoreGuard.finish(token); }
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
      restoreGuard.cancel();
      if (dialog.querySelector("[data-note-id]")) {
        await deferredSaves.flush();
        dialog.close();
        render();
      }
      dialog.close();
      pendingImport = null;
      break;
    case "confirm-dialog": {
      const confirm = dialog._confirm;
      if (!confirm || dialog._confirming === confirm) return;
      dialog._confirming = confirm;
      try { await confirm(); if (dialog._confirm === confirm) dialog.close(); }
      finally { if (dialog._confirming === confirm) dialog._confirming = null; }
      break;
    }
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
      download(`知行学习-题库-${dayKey()}.json`, await materializeBank(bank));
      toast("题库已导出");
      break;
    case "export-backup":
      await downloadBackup(`知行学习-完整备份-${dayKey()}.json`);
      toast("完整备份已导出");
      break;
    case "export-progress":
      await downloadBackup(`知行学习-进度备份-${dayKey()}.json`, true);
      toast("进度备份已导出，恢复时需要相同版本的内置题库");
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
      if (!isScorable(qById(el.dataset.id))) { toast("此题待核实，不计掌握度"); return; }
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
  if (event.target.closest('[data-guide-destination]')) {
    rememberEntry({ guideDismissed: true });
    if (dialog.open) dialog.close();
  }
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
    const transitionsSession = sessionTransitions.has(el.dataset.action);
    if (transitionsSession && sessionTransitionPending) return;
    if (transitionsSession) sessionTransitionPending = true;
    handleAction(el.dataset.action, el).catch((err) => {
      if (err.name !== "AbortError") toast(err.message ?? "操作失败，请重试");
    }).finally(() => { if (transitionsSession) sessionTransitionPending = false; });
  } else if (event.target.closest(".local-nav a,.local-brand")) {
    mobileOpen = false;
    updateMenu();
  }
});
document.addEventListener("toggle", (event) => {
  if (!event.target.isConnected) return;
  if (event.target.matches('.practice-options')) practiceOptionsOpen = event.target.open;
  if (event.target.matches('.practice-progress')) practiceProgressOpen = event.target.open;
}, true);
document.addEventListener("change", (event) => {
  if (event.target.matches("[data-reading-section]")) {
    go(`/knowledge/${route().parts[1]}?chapter=${encodeURIComponent(event.target.value)}`);
    return;
  }
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
    updatePreparationSelection(event.target);
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
    scheduleSave();
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
    scheduleSave();
  }
  if (event.target.id === "global-search") scheduleSearch(event.target, event.isComposing);
});
document.querySelector("#file-input").addEventListener("change", (e) => {
  if (e.target.files[0]) readFile(e.target.files[0]);
});
dialog.addEventListener("close", () => { clearTimeout(searchTimer); restoreGuard.cancel(); });
dialog.addEventListener("cancel", () => restoreGuard.cancel());
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
  if (event.isComposing || event.keyCode === 229) return;
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
function updateKeyboardInset() {
  const editing = document.activeElement?.matches('textarea,input:not([type="checkbox"])');
  const inset = editing && window.visualViewport && visualViewport.scale === 1 ? Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop) : 0;
  document.documentElement.style.setProperty('--keyboard-inset', inset + 'px');
}
window.visualViewport?.addEventListener('resize', updateKeyboardInset);
window.visualViewport?.addEventListener('scroll', updateKeyboardInset);
document.addEventListener('focusin', updateKeyboardInset);
document.addEventListener('focusout', () => requestAnimationFrame(updateKeyboardInset));
window.addEventListener("hashchange", () => {
  if (route().page !== 'welcome') rememberEntry();
  restoreGuard.cancel();
  cancelWelcomeExit();
  readingController.detach();
  deferredSaves.flush().catch(() => {});
  if (dialog.open) dialog.close();
  render();
  window.scrollTo(0, 0);
});
document.addEventListener("visibilitychange", () => {
  document.documentElement.toggleAttribute("data-background-hidden", document.hidden);
  if (storageConflicted()) return;
  if (document.hidden) {
    readingController.capture();
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
  readingController.capture();
  pausePracticeQuestion(displayedPractice);
  pauseExamQuestion(displayedExam);
  deferredSaves.flush().catch(() => {});
  if (displayedExam || displayedPractice) persist();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.theme === "system") updateTheme();
});
matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => { if (storageReady) updateTheme(); });
if (route().page === "welcome") render();
loadConfig().then(api => { configuredAPI = api; });
loadKnowledge().then(notes => {
  knowledge = notes;
  if (storageReady && ["dashboard", "knowledge", "welcome"].includes(route().page)) render();
});
try {
  const data = await openStorage();
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
  else setSaveState("已保存到此浏览器");
  if (!location.hash && entryPreferences().entered) history.replaceState(null, "", "#" + resumeRoute(state));
  if (route().page !== "welcome") rememberEntry();
  render();
  if (data.notice) toast(data.notice);
} catch (err) {
  if (err instanceof StorageConflictError) render();
  else
  app.innerHTML = `<div class="boot"><span class="boot-mark">∑</span><h1>暂时无法打开学习空间</h1><p>请允许此网站使用浏览器存储，或在普通浏览窗口中重试。</p><p>${esc(err.message)}</p><button class="btn" onclick="location.reload()">重新打开</button></div>`;
}
