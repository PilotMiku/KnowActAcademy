import test, { after } from "node:test";
import assert from "node:assert/strict";
import { chromium, browserOptions, baseURL } from "./browser-helpers.mjs";
import { fixture } from "./fixture.mjs";

const browser = await chromium.launch(browserOptions);
after(() => browser.close());

async function withPage(path, run) {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(baseURL + "/#" + path);
    await page.locator(".local-shell").waitFor();
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function storedState(page) {
  return page.evaluate(async () => (await import('./storage.mjs')).readSavedState());
}

async function importQuestions(page, questions) {
  const bank = { ...fixture, questions };
  await page.goto(baseURL + "/#/library");
  await page.locator('[data-action="choose-file"]').waitFor();
  await page.locator("#file-input").setInputFiles({
    name: "interaction-safety.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bank)),
  });
  await page.locator('[data-action="confirm-import"]').click();
  await page.locator(".local-hero").waitFor();
}

test("repeated start clicks create exactly one exam", () => withPage("/exams", async page => {
  await page.locator('[data-action="create-exam"]').first().click();
  await page.locator("#exam-count").fill("0");
  await page.locator('[data-action="begin-exam"]').click();
  await page.locator("#exam-error.inline-error").waitFor();
  assert.equal((await storedState(page)).exams.length, 0);
  await page.locator("#exam-count").fill("2");
  await page.locator('[data-action="begin-exam"]').evaluate(button => {
    button.click(); button.click(); button.click();
  });
  await page.locator(".question-main").waitFor();
  assert.equal((await storedState(page)).exams.length, 1);
}));

test("unverified questions can be read and annotated without grading or scheduling", () => withPage("/library", async page => {
  const question = { ...fixture.questions[0], answerVerified: false, sourceIncomplete: true };
  await importQuestions(page, [question, fixture.questions[1]]);
  await page.goto(baseURL + "/#/practice");
  await page.locator('[data-action="practice-one"]').first().click();
  await page.getByRole('button', { name: '查看参考（不计分）', exact: true }).click();
  await page.getByText('仅供查阅 · 本题不计分', { exact: true }).waitFor();
  assert.equal(await page.locator('.option.correct').count(), 0);
  assert.equal((await storedState(page)).attempts.length, 0);
  await page.reload();
  await page.getByText('仅供查阅 · 本题不计分', { exact: true }).waitFor();
  await page.goto(baseURL + '/#/prepare?subject=math');
  await page.locator('#prepare-availability').waitFor();
  assert.match(await page.locator('#prepare-availability').innerText(), /共 1 道题/);
}));

test("repeated next clicks advance one question and release the navigation lock", () => withPage("/library", async page => {
  await importQuestions(page, fixture.questions.slice(0, 5));
  await page.goto(baseURL + "/#/practice");
  await page.locator('[data-action="start-practice"][data-mode="sequential"]').click();
  await page.locator('[data-question-id="qa-single"]').waitFor();
  await page.locator('[data-action="next-question"]').evaluate(button => {
    button.click(); button.click(); button.click();
  });
  await page.waitForFunction(() => document.querySelector("[data-question-id]")?.dataset.questionId !== "qa-single");
  assert.equal(await page.locator("[data-question-id]").getAttribute("data-question-id"), "qa-multi");
  await page.locator('[data-action="next-question"]').click();
  await page.locator('[data-question-id="qa-fill"]').waitFor();
  assert.equal((await storedState(page)).practice.index, 2);
}));

test("Chinese composition confirmation does not submit material search", () => withPage("/knowledge", async page => {
  const input = page.locator("[data-knowledge-query]"), initialURL = page.url();
  await input.fill("函数");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true });
  assert.equal(page.url(), initialURL);
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, bubbles: true });
  assert.equal(page.url(), initialURL);
  await input.press("Enter");
  await page.waitForURL(url => new URLSearchParams(url.hash.split("?")[1]).get("q") === "函数");
  await page.locator("[data-knowledge-query]").waitFor();
  assert.equal(await page.locator("[data-knowledge-query]").inputValue(), "函数");
}));

test("blank fill and empty multiple-choice answers are labeled unanswered in reports", () => withPage("/library", async page => {
  await importQuestions(page, fixture.questions.filter(q => ["qa-fill", "qa-multi"].includes(q.id)));
  await page.goto(baseURL + "/#/exams");
  await page.locator('[data-action="create-exam"]').first().click();
  await page.locator("#exam-count").fill("2");
  await page.locator('[data-action="begin-exam"]').click();
  await page.locator(".question-main").waitFor();
  const exam = (await storedState(page)).exams[0];
  for (const [index, id] of exam.questionIds.entries()) {
    await page.locator('.index-btn[data-index="' + index + '"]').click();
    if (id === "qa-fill") await page.locator("[data-answer-text]").fill("   ");
    else {
      await page.locator('[data-action="answer-option"][data-value="A"]').click();
      await page.locator('[data-action="answer-option"][data-value="A"]').click();
    }
  }
  await page.locator('.question-nav [data-action="submit-exam"]').click();
  await page.locator('#dialog [data-action="confirm-dialog"]').click();
  await page.locator(".score").waitFor();
  const answers = await page.locator(".question-main > .answer-line").allTextContents();
  assert.equal(answers.length, 2);
  assert.ok(answers.every(answer => /你的答案：未作答/.test(answer)), JSON.stringify(answers));
}));
