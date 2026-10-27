export function feedbackHTML(q, response, { mode = "practice", mastery = null, mistake = null }, { icon, attr, button }) {
  const preparing = ["prepare-diagnostic", "prepare-training"].includes(mode);
  const label = response.correct === null ? "对照参考答案，自评掌握情况"
    : response.correct ? mode === "exam" ? response.uncertain ? "本题答对，但标记为拿不准" : "本题回答正确" : preparing ? response.uncertain ? "这次答对但不确定，继续巩固" : mastery?.mastered ? "连续答对两次，已掌握" : "这次答对了，再巩固一次"
      : response.uncertain ? "这次答对但不确定，建议再练一次" : "这道题，掌握了" : "没关系，把思路再理一遍";
  return `<section class="result-box ${response.correct === false ? "wrong" : ""}"><div class="result-label">${icon(response.correct === false ? "mistake" : response.correct === null ? "info" : "check", 16)} ${label}</div><div class="answer-line">参考答案：<span class="rich" data-rich="${attr(Array.isArray(q.answer) ? q.answer.join(q.type === "multiple" ? "、" : " / ") : q.answer)}"></span></div><div class="analysis"><b>思路与解析</b><div class="rich" data-rich="${attr(q.analysis || "这道题的原 PDF 未附解析，请查看原 PDF 核对。")}"></div></div><div class="result-footer">${q.type === "solution" && response.correct === null ? `<div class="flex self-grade-actions" style="margin-top:18px">${button(preparing ? "本次答对" : "我掌握了", "self-grade", 'data-correct="true"', "btn small")}${button(preparing ? "本次答错" : "还需练习", "self-grade", 'data-correct="false"', "btn small soft")}</div>` : ""}${!preparing && mistake && !mistake.resolved ? `<div style="margin-top:14px">${button(`${icon("check", 12)} 标记已掌握`, "resolve-mistake", `data-id="${attr(q.id)}"`, "text-btn")}</div>` : ""}</div></section>`;
}

export function patchPracticeAnswer({ root, question: q, practice, response, feedback, status, questionStatus, renderRich }) {
  const main = root.querySelector(".question-main");
  if (main?.dataset.practiceId !== practice.id || main.dataset.questionId !== q.id) return false;
  const answers = new Set(Array.isArray(q.answer) ? q.answer : [String(q.answer)]);
  const selected = new Set(Array.isArray(response.answer) ? response.answer : [String(response.answer)]);
  for (const option of main.querySelectorAll(".option")) {
    option.disabled = true;
    option.classList.remove("selected", "correct", "wrong");
    if (answers.has(option.dataset.value)) option.classList.add("correct");
    else if (selected.has(option.dataset.value) && response.correct === false) option.classList.add("wrong");
  }
  const uncertainty = root.querySelector(".uncertain-control");
  if (uncertainty) uncertainty.disabled = true;
  const input = main.querySelector("[data-answer-text]");
  if (input) input.disabled = true;
  const template = document.createElement("template");
  template.innerHTML = feedback;
  const existing = main.querySelector(".result-box"), replacement = template.content.firstElementChild;
  if (existing) {
    existing.className = replacement.className;
    existing.querySelector(".result-label").innerHTML = replacement.querySelector(".result-label").innerHTML;
    existing.querySelector(".result-footer").innerHTML = replacement.querySelector(".result-footer").innerHTML;
  } else {
    main.querySelector(".question-actions").before(replacement);
    renderRich(replacement);
  }
  main.querySelector('[data-action="submit-answer"]')?.remove();
  main.querySelector('[data-action="next-question"]')?.classList.add("primary");
  const completed = practice.questionIds.filter((id) => typeof practice.responses[id]?.correct === "boolean").length;
  const nav = root.querySelector(".question-nav");
  if (nav) {
    nav.querySelector(".card-head .muted").textContent = `${completed}/${practice.questionIds.length}`;
    nav.querySelector(".progress-bar>span").style.width = `${completed / practice.questionIds.length * 100}%`;
    const current = nav.querySelector(".index-btn.current");
    current?.classList.remove("correct", "wrong", "answered");
    current?.classList.add(response.correct === true ? "correct" : response.correct === false ? "wrong" : "answered");
    if (current?.querySelector(".nav-state")) current.querySelector(".nav-state").textContent = response.correct === true ? "✓" : response.correct === false ? "×" : "?";
  }
  if (status && root.querySelector(".preparation-live")) {
    template.innerHTML = status;
    const fresh = template.content.firstElementChild, live = root.querySelector(".preparation-live");
    for (const field of fresh.querySelectorAll("[data-live-field]")) {
      const target = [...live.querySelectorAll("[data-live-field]")].find((el) => el.dataset.liveField === field.dataset.liveField);
      if (target) target.textContent = field.textContent;
    }
    const bars = [...live.querySelectorAll("[role=progressbar]")];
    fresh.querySelectorAll("[role=progressbar]").forEach((bar, i) => {
      if (!bars[i]) return;
      bars[i].setAttribute("aria-valuenow", bar.getAttribute("aria-valuenow"));
      bars[i].querySelector("span").style.width = bar.querySelector("span").style.width;
    });
  }
  if (questionStatus) main.querySelector(".preparation-question-status").outerHTML = questionStatus;
  return true;
}
