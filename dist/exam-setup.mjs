import { examQuestions } from "./core.mjs";
import { rootChapter } from './study-planning.mjs';
import { validateExamDesign } from './exam-design.mjs';
import { icon, esc, attr, button } from "./ui.mjs";

export function createExamSetup({ getBank, getState, dialog, openDialog, toast, go, defaultCount }) {
  function chapterQuotas() {
    const bank = getBank(), pool = examQuestions(bank,examFilters());
    const previous = new Map([...dialog.querySelectorAll('[data-exam-quota]')].map(el=>[el.dataset.examQuota,el.value]));
    const groups = new Map();
    for (const q of pool) { const key=rootChapter(bank,q); const row=groups.get(key)||{subjectId:q.subjectId,chapterId:JSON.parse(key)[1],available:0}; row.available++; groups.set(key,row); }
    return [...groups].map(([key,row])=>`<label class="exam-quota-row"><span>${esc(bank.subjects.find(s=>s.id===row.subjectId).name)} · ${esc(bank.subjects.find(s=>s.id===row.subjectId).chapters.find(c=>c.id===row.chapterId).name)}<small>最多 ${row.available} 题</small></span><input class="input" type="number" min="0" max="${Math.min(100,row.available)}" value="${attr(previous.get(key)||'0')}" data-exam-quota="${attr(key)}" aria-label="${attr(row.chapterId)} 题量"></label>`).join('');
  }
  function examSettings() {
    const allocation = dialog.querySelector('#exam-distribution').value === 'custom' ? [...dialog.querySelectorAll('[data-exam-quota]')].map(el=> {
      const [subjectId,chapterId]=JSON.parse(el.dataset.examQuota);return {subjectId,chapterId,count:Number(el.value)};
    }).filter(row=>row.count !== 0) : [];
    if (dialog.querySelector('#exam-distribution').value === 'custom' && !allocation.length) throw new Error('请至少为一个章节设置题量');
    return validateExamDesign({...examFilters(),count:Number(dialog.querySelector('#exam-count').value),minutes:Number(dialog.querySelector('#exam-minutes').value),allocation},getBank());
  }
  function loadExamTemplate(id) {
    const saved=getState().examTemplates.find(t=>t.id===id);
    if (!saved) { toast('请先选择已保存的模板'); return; }
    dialog.querySelector('#exam-subject').value=saved.subjectId;
    dialog.querySelector('#exam-chapter-options').innerHTML=examChapterOptions(saved.subjectId);
    dialog.querySelector('#exam-all-chapters').checked=saved.chapters===null;
    for(const el of dialog.querySelectorAll('[data-exam-chapter]')) el.checked=saved.chapters?.some(c=>JSON.stringify([c.subjectId,c.chapterId])===el.value)||false;
    dialog.querySelector('#exam-count').value=saved.count; dialog.querySelector('#exam-minutes').value=saved.minutes;
    dialog.querySelector('#exam-distribution').value=saved.allocation.length?'custom':'random';
    dialog.querySelector('#exam-template-name').value=saved.name;
    updateExamAvailability();
    for(const el of dialog.querySelectorAll('[data-exam-quota]')) { const row=saved.allocation.find(c=>JSON.stringify([c.subjectId,c.chapterId])===el.dataset.examQuota); el.value=row?.count||0; }
  }
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
    const quotas = dialog.querySelector('#exam-quotas');
    if (quotas) { quotas.innerHTML = chapterQuotas(); quotas.hidden = dialog.querySelector('#exam-distribution').value !== 'custom'; }
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
      `<p style="margin-bottom:20px">从已导入题库中随机抽题。选择、判断与填空题自动判分，解答题保留在章节练习中自评。</p><section class="exam-template-controls"><label for="exam-template">已保存的组卷模板</label><select id="exam-template"><option value="">选择模板</option>${(getState().examTemplates||[]).map(t=>`<option value="${attr(t.id)}">${esc(t.name)}</option>`).join('')}</select><div class="flex">${button('应用模板','load-exam-template','','btn small')}${button('删除所选模板','delete-exam-template','','btn small')}</div></section><div class="field"><label for="exam-subject">考试科目</label><select id="exam-subject"><option value="">综合练习</option>${bank.subjects.map((s) => `<option value="${attr(s.id)}">${esc(s.name)}</option>`).join("")}</select></div><fieldset class="exam-chapters" aria-describedby="exam-availability"><legend>大章节（可多选）</legend><label class="exam-all-chapters"><input id="exam-all-chapters" type="checkbox" checked><span>全部章节</span></label><div id="exam-chapter-options">${examChapterOptions()}</div></fieldset><p id="exam-availability" aria-live="polite"></p><div class="flex"><div class="field"><label for="exam-count">题量</label><input class="input" id="exam-count" type="number" min="1" max="100" value="${Math.min(defaultCount, bank.questions.filter((q) => q.type !== "solution").length) || 1}"></div><div class="field"><label for="exam-minutes">时长 / 分钟</label><input class="input" id="exam-minutes" type="number" min="1" max="240" value="30"></div></div><details class="exam-design-options"><summary>章节题量配比与保存模板</summary><div class="field"><label for="exam-distribution">组卷方式</label><select id="exam-distribution"><option value="random">范围内随机抽题</option><option value="custom">指定各大章题量</option></select></div><div id="exam-quotas" hidden></div><p class="format-note">各章配比之和必须等于总题量；各章内随机抽取，题目不重复。</p><div class="field"><label for="exam-template-name">模板名称</label><input class="input" id="exam-template-name" maxlength="80" placeholder="例如：期末高数章节配比"></div>${button('保存当前设置为模板','save-exam-template','','btn')}</details><p id="exam-error" role="alert"></p>`,
      `${button("先不考", "close-dialog")}${button(`开始考试 ${icon("arrow", 13)}`, "begin-exam", "", "btn primary")}`,
    );
    updateExamAvailability();
  }

  return { examChapterOptions, examFilters, updateExamAvailability, examOptions, examSettings, loadExamTemplate };
}
