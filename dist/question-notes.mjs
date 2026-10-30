export const mistakeReasons = [
  ["concept", "概念不清"], ["method", "方法不熟"], ["calculation", "计算失误"],
  ["reading", "审题失误"], ["memory", "记忆不牢"], ["time", "时间不足"],
];
const reasonIds = new Set(mistakeReasons.map(([id]) => id));
export function getQuestionNote(state, id) {
  return state.questionNotes && Object.hasOwn(state.questionNotes, id) ? state.questionNotes[id] : undefined;
}

export function normalizeQuestionNotes(value, questionIds) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("备份中的个人笔记格式错误");
  for (const [id, note] of Object.entries(value)) {
    if (!questionIds.has(id) || !note || typeof note !== "object" || Array.isArray(note) ||
        typeof note.text !== "string" || note.text.length > 10000 ||
        !Array.isArray(note.reasons) || note.reasons.some(reason => !reasonIds.has(reason)) ||
        new Set(note.reasons).size !== note.reasons.length || !Number.isFinite(note.updatedAt))
      throw new Error("备份中的个人笔记或错因关联不完整");
  }
  return Object.fromEntries(Object.entries(value).map(([id, note]) => [id,
    { text: note.text, reasons: [...note.reasons], updatedAt: note.updatedAt }]));
}

export function updateQuestionNote(state, id, patch, now = Date.now()) {
  state.questionNotes ??= {};
  const previous = getQuestionNote(state, id) ?? { text: "", reasons: [] };
  const note = { ...previous, ...patch, updatedAt: now };
  note.text = note.text.slice(0, 10000);
  note.reasons = [...new Set(note.reasons.filter(id => reasonIds.has(id)))];
  if (!note.text.trim() && !note.reasons.length) delete state.questionNotes[id];
  else state.questionNotes[id] = note;
  return note;
}

export function questionNotesHTML(id, state, { esc, attr }, { open = false } = {}) {
  const note = getQuestionNote(state, id), key = "question-note-" + encodeURIComponent(id);
  return `<details class="question-notes" data-note-id="${attr(id)}" ${open ? "open" : ""}><summary>错因与个人笔记${note ? " · 已记录" : ""}</summary><fieldset><legend>这道题需要注意什么？可多选</legend><div class="note-reasons">${mistakeReasons.map(([reason, label]) => `<label><input type="checkbox" data-note-reason value="${reason}" ${note?.reasons.includes(reason) ? "checked" : ""}>${label}</label>`).join("")}</div></fieldset><label class="field" for="${attr(key)}">我的思路与提醒</label><textarea class="input" id="${attr(key)}" data-question-note maxlength="10000" rows="4" placeholder="记录解题思路、容易错的步骤，或下次复习的提醒">${esc(note?.text ?? "")}</textarea><p class="format-note" data-note-status role="status">${note ? "已保存" : "自动保存，随完整备份和学习进度同步"}</p></details>`;
}

export function installQuestionNotes({ getState, getQuestion, save, schedule }) {
  document.addEventListener("input", event => {
    if (!event.target.matches("[data-question-note]")) return;
    const section = event.target.closest("[data-note-id]"), id = section.dataset.noteId;
    if (!getQuestion(id)) return;
    updateQuestionNote(getState(), id, { text: event.target.value });
    section.querySelector("[data-note-status]").textContent = "正在保存…";
    schedule();
  });
  document.addEventListener("change", event => {
    if (!event.target.matches("[data-note-reason]")) return;
    const section = event.target.closest("[data-note-id]"), id = section.dataset.noteId;
    if (!getQuestion(id)) return;
    updateQuestionNote(getState(), id, {
      reasons: [...section.querySelectorAll("[data-note-reason]:checked")].map(input => input.value),
    });
    section.querySelector("[data-note-status]").textContent = "正在保存…";
    save().catch(() => {});
  });
}
