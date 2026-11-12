import { examQuestions } from "./core.mjs";
import { icon, esc, attr, button } from "./ui.mjs";

export function createExamSetup({ getBank, getState, dialog, openDialog, toast, go, defaultCount }) {
  function examChapterOptions(subjectId = "") {
    const bank = getBank();
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
    const bank = getBank();
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
    const bank = getBank();
    if (!bank.questions.length) {
      toast("请先导入原题库");
      go("/library");
      return;
    }
    const active = getState().exams.find((e) => e.status === "active");
    if (active) {
      go("/exam/" + active.id);
      return;
    }
    openDialog(
      "给自己一场小小的检验",
      `<p style="margin-bottom:20px">从已导入题库中随机抽题。选择、判断与填空题自动判分，解答题保留在章节练习中自评。</p><div class="field"><label for="exam-subject">考试科目</label><select id="exam-subject"><option value="">综合练习</option>${bank.subjects.map((s) => `<option value="${attr(s.id)}">${esc(s.name)}</option>`).join("")}</select></div><fieldset class="exam-chapters" aria-describedby="exam-availability"><legend>大章节（可多选）</legend><label class="exam-all-chapters"><input id="exam-all-chapters" type="checkbox" checked><span>全部章节</span></label><div id="exam-chapter-options">${examChapterOptions()}</div></fieldset><p id="exam-availability" aria-live="polite"></p><div class="flex"><div class="field"><label for="exam-count">题量</label><input class="input" id="exam-count" type="number" min="1" max="100" value="${Math.min(defaultCount, bank.questions.filter((q) => q.type !== "solution").length) || 1}"></div><div class="field"><label for="exam-minutes">时长 / 分钟</label><input class="input" id="exam-minutes" type="number" min="1" max="240" value="30"></div></div><p id="exam-error" role="alert"></p>`,
      `${button("先不考", "close-dialog")}${button(`开始考试 ${icon("arrow", 13)}`, "begin-exam", "", "btn primary")}`,
    );
    updateExamAvailability();
  }

  return { examChapterOptions, examFilters, updateExamAvailability, examOptions };
}
