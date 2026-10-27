import { chromium, browserOptions, baseURL } from "./browser-helpers.mjs";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { normalizeBank, filterQuestions } from "../dist/core.mjs";
import { preparationQuestions, preparationProfile } from "../dist/preparation.mjs";
import { fixture } from "./fixture.mjs";

const bank = normalizeBank(JSON.parse(await readFile("dist/data/bank.json", "utf8")));
const browser = await chromium.launch(browserOptions);
const errors = [];
async function stateOf(page) {
  return page.evaluate(async () => {
    const { storageName } = await import("./assets.mjs");
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(storageName, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction("kv");
        const state = tx.objectStore("kv").get("state");
        tx.oncomplete = () => { db.close(); resolve(state.result); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}
async function answerCurrent(page, questions, correct) {
  const state = await stateOf(page);
  const q = questions.find((q) => q.id === state.practice.questionIds[state.practice.index]);
  if (q.type === "solution") {
    await page.locator('[data-action="submit-answer"]').click();
    await page.locator(`[data-action="self-grade"][data-correct="${correct}"]`).click();
  } else {
    if (q.type === "fill") await page.locator("[data-answer-text]").fill(correct ? q.answer : "wrong-answer");
    else {
      const answers = correct ? (Array.isArray(q.answer) ? q.answer : [String(q.answer)])
        : [q.options.find((o) => !(Array.isArray(q.answer) ? q.answer : [String(q.answer)]).includes(o.id))?.id ?? q.options[0].id];
      for (const value of answers) await page.locator(`[data-action="answer-option"][data-value="${value}"]`).click();
    }
    await page.locator('[data-action="submit-answer"]').click();
  }
  await page.locator(".result-box").waitFor();
}
async function next(page) {
  await page.locator('[data-action="next-question"]').click();
}
async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1060 }, acceptDownloads: true });
  page.on("pageerror", (e) => errors.push(e.message));
  const randomURL = `${baseURL}/#/practice?subject=linear&chapter=linear-chapter-1`;
  await page.goto(randomURL);
  await page.getByRole("button", { name: /随机 25 题/ }).click();
  await page.locator(".question-main").waitFor();
  assert.equal((await stateOf(page)).practice.questionIds.length, 25);
  await page.goto(randomURL);
  await page.locator("#random-count").selectOption("all");
  await page.getByRole("button", { name: /随机所有题目/ }).click();
  await page.locator(".question-main").waitFor();
  const all = (await stateOf(page)).practice;
  const expected = filterQuestions(bank, { subjectId: "linear", chapterId: "linear-chapter-1" }).map((q) => q.id);
  assert.equal(all.questionIds.length, 92);
  assert.deepEqual([...all.questionIds].sort(), [...expected].sort());
  assert.notDeepEqual(all.questionIds, expected);
  await page.getByRole("button", { name: "下一组", exact: true }).click();
  await page.locator('.index-btn.current[data-index="40"]').waitFor();
  await page.reload();
  await page.locator('.index-btn.current[data-index="40"]').waitFor();
  assert.deepEqual((await stateOf(page)).practice.questionIds, all.questionIds);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({ path: "artifacts/random-all-mobile.png", fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1060 });

  await page.goto(`${baseURL}/#/prepare?subject=linear`);
  await page.locator("#prepare-subject").waitFor();
  await page.locator('[data-action="prepare-select-none"]').click();
  assert.ok(await page.locator('[data-action="begin-preparation"]').isDisabled());
  assert.match(await page.locator("#prepare-availability").innerText(), /至少选择/);
  for (const id of ["linear-chapter-1", "linear-chapter-2"])
    await page.locator(`[data-prepare-chapter][value="${id}"]`).check();
  const scope = { subjectId: "linear", chapterIds: ["linear-chapter-1", "linear-chapter-2"] };
  const pool = preparationQuestions(bank, scope);
  assert.match(await page.locator("#prepare-availability").innerText(), new RegExp(`共 ${pool.length} 道`));
  await page.reload();
  await page.locator("#prepare-subject").waitFor();
  assert.equal(await page.locator("[data-prepare-chapter]:checked").count(), 2);
  await page.locator("#prepare-round-policy").selectOption("fixed");
  await page.locator('[data-action="begin-preparation"]').click();
  await page.getByRole("heading", { name: "备考测评", exact: true }).waitFor();
  const initial = await stateOf(page);
  assert.equal(initial.practice.questionIds.length, 20);
  assert.ok(initial.practice.questionIds.every((id) => pool.some((q) => q.id === id)));
  // Skip a question, finish the rest, then return to the unanswered item.
  await next(page);
  for (let i = 1; i < 20; i++) {
    await answerCurrent(page, bank.questions, i % 3 !== 0);
    await next(page);
  }
  await page.locator(".preparation-summary").waitFor();
  assert.match(await page.locator(".preparation-summary").innerText(), /已完成 19 题/);
  assert.equal(await page.locator('[data-action="next-training"]').count(), 0);
  await page.locator('[data-action="complete-preparation"]').click();
  await page.locator('.index-btn.current[data-index="0"]').waitFor();
  await answerCurrent(page, bank.questions, false);
  await page.reload();
  await page.locator(".result-box").waitFor();
  assert.equal((await stateOf(page)).attempts.filter((a) => a.preparationId === initial.preparation.id).length, 20);
  await page.locator('[data-action="navigate-question"][data-index="19"]').first().click();
  await next(page);
  await page.locator(".preparation-summary").waitFor();
  assert.match(await page.locator(".preparation-summary").innerText(), /已完成 20 题/);
  await page.screenshot({ path: "artifacts/preparation-summary-desktop.png", fullPage: true, animations: "disabled" });
  await page.reload();
  await page.locator('[data-action="next-training"]').click();
  await page.getByRole("heading", { name: "加权训练 · 第 1 组", exact: true }).waitFor();
  let trained = await stateOf(page);
  assert.equal(trained.preparation.round, 1);
  assert.equal(new Set(trained.practice.questionIds).size, 20);
  assert.ok(trained.practice.questionIds.every((id) => pool.some((q) => q.id === id)));
  const profile = preparationProfile(bank, trained);
  assert.ok(new Set(profile.weights.values()).size > 1);
  assert.ok([...profile.weights.values()].every((weight) => weight > 0));
  await answerCurrent(page, bank.questions, false);
  trained = await stateOf(page);
  // Starting an ordinary practice must keep the unfinished preparation session.
  await page.goto(randomURL);
  await page.getByRole("button", { name: /随机 25 题/ }).click();
  await page.locator(".question-main").waitFor();
  assert.equal((await stateOf(page)).practice.mode, "random");
  await page.goto(`${baseURL}/#/prepare`);
  assert.equal(await page.locator('[data-action="next-training"]').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "切换明暗主题" }).click();
  await noOverflow(page);
  await page.screenshot({ path: "artifacts/preparation-plan-mobile-dark.png", fullPage: true, animations: "disabled" });
  await page.locator('[data-action="resume-preparation"]').click();
  await page.locator(".result-box").waitFor();
  assert.equal((await stateOf(page)).practice.id, trained.practice.id);
  trained = await stateOf(page);
  await noOverflow(page);

  // Full backup and restore must preserve the active training and derived weights.
  await page.goto(`${baseURL}/#/library`);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整备份" }).click();
  await (await downloaded).saveAs("artifacts/preparation-backup.json");
  await page.getByRole("button", { name: "清空学习记录" }).click();
  await page.locator('[data-action="confirm-dialog"]').click();
  await page.locator(".local-hero").waitFor();
  await page.goto(`${baseURL}/#/library`);
  await page.getByRole("button", { name: "恢复学习数据" }).click();
  await page.locator("#file-input").setInputFiles("artifacts/preparation-backup.json");
  await page.locator('[data-action="confirm-dialog"]').click();
  await page.locator(".local-hero").waitFor();
  const restored = await stateOf(page);
  assert.deepEqual(restored.preparation, trained.preparation);
  assert.deepEqual(restored.practice, trained.practice);
  assert.deepEqual(restored.attempts, trained.attempts);
  await page.goto(`${baseURL}/#/prepare?session=1`);
  await page.locator(".result-box").waitFor();

  // Small custom banks include all question types and manual self-assessment.
  await page.goto(`${baseURL}/#/library`);
  await page.getByRole("button", { name: "选择题库文件" }).click();
  await page.locator("#file-input").setInputFiles({ name: "qa-preparation.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await page.locator(".local-hero").waitFor();
  await page.goto(`${baseURL}/#/practice`);
  await page.getByRole("button", { name: /随机 25 题/ }).click();
  await page.locator(".question-main").waitFor();
  assert.equal((await stateOf(page)).practice.questionIds.length, 6);
  await page.goto(`${baseURL}/#/prepare`);
  await page.locator("#prepare-subject").waitFor();
  assert.match(await page.locator("#prepare-availability").innerText(), /不足 20 题/);
  await page.locator("#prepare-round-policy").selectOption("fixed");
  await page.locator('[data-action="begin-preparation"]').click();
  await page.locator(".question-main").waitFor();
  const small = await stateOf(page);
  assert.equal(small.practice.questionIds.length, fixture.questions.length);
  for (const [i, id] of small.practice.questionIds.entries()) {
    const q = fixture.questions.find((q) => q.id === id);
    if (q.type === "solution") {
      await page.locator('[data-action="submit-answer"]').click();
      const pending = await stateOf(page);
      assert.equal(pending.attempts.length, i);
      assert.match(await page.locator(".question-nav .card-head .muted").innerText(), new RegExp(`^${i}/`));
      await page.locator('[data-action="self-grade"][data-correct="false"]').click();
    } else await answerCurrent(page, fixture.questions, true);
    await next(page);
  }
  await page.locator(".preparation-summary").waitFor();
  assert.match(await page.locator(".preparation-summary").innerText(), /已完成 6 题，答对 5 题/);
  await page.locator('[data-action="next-training"]').click();
  await page.getByRole("heading", { name: "加权训练 · 第 1 组", exact: true }).waitFor();
  assert.equal((await stateOf(page)).practice.questionIds.length, 6);
  await noOverflow(page);
  assert.deepEqual(errors, []);
  await writeFile("artifacts/preparation-browser-report.json", JSON.stringify({ passed: true, pageErrors: errors, scenarios: [
    "25/all random within filters, pagination and reload", "multi-chapter diagnosis, empty scope and skipped answers",
    "20-question adaptive training, positive weights and round completion guard", "refresh and backup restore retain plan and active training",
    "small custom banks, all question types and manual self-assessment", "390px mobile layout and dark theme",
  ] }, null, 2));
  console.log("Random question counts and adaptive preparation browser checks passed.");
} finally { await browser.close(); }
