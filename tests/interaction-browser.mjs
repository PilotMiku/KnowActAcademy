import { chromium, browserOptions, baseURL } from "./browser-helpers.mjs";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { fixture } from "./fixture.mjs";

const browser = await chromium.launch(browserOptions);
const errors = [];
async function storedState(page) {
  return page.evaluate(async () => {
    const { storageName } = await import("./assets.mjs");
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(storageName, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("kv");
        const state = tx.objectStore("kv").get("state");
        tx.oncomplete = () => { db.close(); resolve(state.result); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}
async function rememberQuestion(page) {
  await page.evaluate(() => {
    window.stableQuestion = {
      main: document.querySelector("#main"),
      question: document.querySelector(".question-main"),
      images: [...document.querySelectorAll(".question-main img")],
    };
  });
}
async function assertQuestionRetained(page) {
  assert.ok(await page.evaluate(() => {
    const stable = window.stableQuestion;
    return stable.main === document.querySelector("#main") &&
      stable.question === document.querySelector(".question-main") &&
      stable.images.every((image) => image.isConnected);
  }), "Interaction must retain the current question and images");
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1060 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseURL}/#/practice?subject=calculus&chapter=s-6b82188494c1`);
  await page.getByRole("button", { name: /顺序练习/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".original-pdf-image")].every((i) => i.complete && i.naturalWidth > 0));
  await rememberQuestion(page);
  const answer = page.locator('[data-action="answer-option"][data-value="B"]');
  await answer.focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector('.option[data-value="B"]').getAttribute("aria-pressed") === "true");
  await assertQuestionRetained(page);
  assert.ok(await answer.evaluate((el) => el === document.activeElement), "Keyboard selection retains focus");
  const selectionTimings = await page.evaluate(() => {
    const durations = [];
    for (let i = 0; i < 12; i++) {
      const option = document.querySelector(`.option[data-value="${i % 2 ? "B" : "A"}"]`);
      const start = performance.now();
      option.click();
      if (option.getAttribute("aria-pressed") !== "true") throw new Error("Selection feedback must be immediate");
      durations.push(performance.now() - start);
    }
    return durations;
  });
  await assertQuestionRetained(page);
  await page.getByRole("button", { name: "切换明暗主题" }).click();
  assert.ok(await page.locator("body").evaluate((el) => el.classList.contains("dark")));
  await assertQuestionRetained(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole("button", { name: "打开导航" });
  await menu.click();
  assert.equal(await menu.getAttribute("aria-expanded"), "true");
  await assertQuestionRetained(page);
  await menu.click();
  assert.equal(await menu.getAttribute("aria-expanded"), "false");
  await page.reload();
  await page.locator('.option[data-value="B"][aria-pressed="true"]').waitFor();
  assert.ok(await page.locator("body").evaluate((el) => el.classList.contains("dark")));
  await page.getByRole("button", { name: "确认答案", exact: true }).click();
  await page.getByText("这道题，掌握了", { exact: false }).waitFor();

  // Reduced motion also disables scripted smooth scrolling and modal effects.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${baseURL}/#/knowledge`);
  await page.locator(".knowledge-grid").waitFor();
  assert.equal(await page.locator(".knowledge-grid").evaluate((el) => getComputedStyle(el).animationName), "none");
  await page.getByRole("button", { name: "搜索题目与知识点" }).click();
  assert.equal(await page.locator("#dialog").evaluate((el) => getComputedStyle(el).animationName), "none");
  const search = page.locator("#global-search");
  await search.evaluate(async (input) => {
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    input.value = "函数";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    await new Promise((resolve) => setTimeout(resolve, 180));
  });
  assert.equal(await page.locator(".search-item").count(), 0);
  await search.dispatchEvent("compositionend");
  await page.locator(".search-item").first().waitFor();
  await search.fill("不会存在的搜索结果abcdefgh");
  await page.getByText("没有找到相关题目或知识点，换个关键词试试。", { exact: true }).waitFor();
  await search.fill("函数");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "搜索题目与知识点" }).click();
  assert.equal(await page.locator("#global-search").inputValue(), "");
  assert.equal(await page.locator(".search-item").count(), 0);
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  // Imported choice/fill exams must update navigation without rebuilding the
  // question or interrupting typing, and still save every final answer.
  await page.goto(`${baseURL}/#/library`);
  await page.getByRole("button", { name: "选择题库文件" }).waitFor();
  const custom = structuredClone(fixture);
  custom.questions = custom.questions.filter((q) => q.id !== "qa-html");
  await page.locator("#file-input").setInputFiles({ name: "interactions.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(custom)) });
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await page.locator(".local-hero").waitFor();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${baseURL}/#/exams`);
  await page.getByRole("button", { name: "新建模拟考试" }).click();
  await page.locator("#exam-count").fill("4");
  await page.getByRole("button", { name: "开始考试" }).click();
  await page.locator("[data-timer]").waitFor();
  const exam = (await storedState(page)).exams.at(-1);
  const fillIndex = exam.questionIds.indexOf("qa-fill");
  await page.getByRole("button", { name: `第 ${fillIndex + 1} 题`, exact: true }).click();
  const text = page.locator("[data-answer-text]");
  await text.waitFor();
  await rememberQuestion(page);
  await text.fill("1/2");
  assert.equal(await page.locator(".question-nav .card-head .muted").innerText(), "1/4");
  assert.match(await page.locator(".index-btn.current").getAttribute("class"), /answered/);
  await text.fill("");
  assert.equal(await page.locator(".question-nav .card-head .muted").innerText(), "0/4");
  await text.pressSequentially("0.5");
  await assertQuestionRetained(page);
  const multiIndex = exam.questionIds.indexOf("qa-multi");
  await page.getByRole("button", { name: `第 ${multiIndex + 1} 题`, exact: true }).click();
  await page.locator('.option[data-value="C"]').waitFor();
  await rememberQuestion(page);
  await page.evaluate(() => {
    for (const value of ["A", "B", "A", "C", "C", "A"])
      document.querySelector(`.option[data-value="${value}"]`).click();
  });
  assert.equal(await page.locator(".option.selected").count(), 2);
  assert.equal(await page.locator(".question-nav .card-head .muted").innerText(), "2/4");
  await assertQuestionRetained(page);
  await page.getByRole("button", { name: "切换明暗主题" }).click(); // Waits behind queued answer saves.
  await page.reload();
  await page.locator('.option[data-value="A"][aria-pressed="true"]').waitFor();
  assert.equal(await page.locator(".option.selected").count(), 2);
  const saved = (await storedState(page)).exams.at(-1);
  assert.deepEqual(saved.answers["qa-multi"], ["B", "A"]);
  assert.equal(saved.answers["qa-fill"], "0.5");
  assert.equal(saved.endsAt, exam.endsAt);
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: "artifacts/interactions-mobile.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "提交试卷", exact: true }).first().click();
  await page.locator('#dialog [data-action="confirm-dialog"]').click();
  await page.locator(".score").waitFor();
  assert.match(await page.locator(".score").innerText(), /^50/);
  assert.deepEqual(errors, []);
  await writeFile("artifacts/interaction-review.json", JSON.stringify({
    passed: true, selectionTimingsMs: selectionTimings,
    retainedQuestionDOM: true, retainedImageDOM: true,
    verified: ["keyboard focus", "rapid choices", "theme and mobile menu", "refresh persistence", "reduced motion", "Chinese composition search", "fill and multiple exam progress", "unchanged deadline and grading"],
  }, null, 2));
  console.log("Interaction regression passed: retained question/images, keyboard focus, rapid saves, exam progress, reduced motion and Chinese search.");
} finally {
  await browser.close();
}
