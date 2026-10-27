import { chromium, browserOptions, baseURL } from "./browser-helpers.mjs";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { fixture } from "./fixture.mjs";
import { normalizeBank } from "../dist/core.mjs";
import { spacedReview, DAY_MS } from "../dist/study.mjs";

const raw = structuredClone(fixture);
raw.subjects[0].chapters = [{ id: "limits", name: "测试极限章节" }, { id: "series", name: "测试级数章节" }];
for (const [i, q] of raw.questions.entries()) {
  q.chapterId = i < 3 ? "limits" : "series";
  q.concepts = ["测试共同知识点"];
}
const bank = normalizeBank(raw), errors = [];
const browser = await chromium.launch(browserOptions);
async function stateOf(page) {
  return page.evaluate(async () => {
    const { storageName } = await import("./assets.mjs");
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(storageName, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction("kv"), state = tx.objectStore("kv").get("state");
        tx.oncomplete = () => { db.close(); resolve(state.result); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}
async function answer(page, correct) {
  const state = await stateOf(page), q = bank.questions.find((q) => q.id === state.practice.questionIds[state.practice.index]);
  if (q.type === "solution") {
    await page.locator('[data-action="submit-answer"]').click();
    await page.locator(`[data-action="self-grade"][data-correct="${correct}"]`).click();
  } else {
    if (q.type === "fill") await page.locator("[data-answer-text]").fill(q.answer);
    else for (const value of Array.isArray(q.answer) ? q.answer : [String(q.answer)])
      await page.locator(`[data-action="answer-option"][data-value="${value}"]`).click();
    await page.locator('[data-action="submit-answer"]').click();
  }
  await page.locator(".result-box").waitFor();
}
async function finishGroup(page, manualCorrect) {
  const state = await stateOf(page);
  for (const id of state.practice.questionIds) {
    const q = bank.questions.find((q) => q.id === id);
    await answer(page, q.type === "solution" ? manualCorrect : true);
    await page.locator('[data-action="next-question"]').click();
  }
  await page.locator(".preparation-summary").waitFor();
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: new Date("2026-10-26T04:00:00Z") });
  await page.goto(`${baseURL}/#/library`);
  await page.getByRole("button", { name: "选择题库文件" }).click();
  await page.locator("#file-input").setInputFiles({ name: "qa-study.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(raw)) });
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await page.locator(".local-hero").waitFor();
  await page.goto(`${baseURL}/#/prepare`);
  await page.locator("#prepare-round-policy").selectOption("fixed");
  await page.locator('[data-action="begin-preparation"]').click();
  await page.locator(".question-main").waitFor();
  const planId = (await stateOf(page)).preparation.id;
  await finishGroup(page, false);
  assert.equal(await page.locator(".trend-point").count(), 1);
  assert.match(await page.locator(".trend-table tbody").innerText(), /83%/);
  await page.locator(".concept-panel>summary").click();
  await page.locator('[data-action="concept-details"]').click();
  assert.equal(await page.locator(".concept-chapter-list>a").count(), 2);
  await page.locator(".concept-chapter-list>a").first().click();
  await page.locator('[data-action="start-practice"]').first().waitFor();
  assert.ok(!await page.locator("#dialog").evaluate((dialog) => dialog.open));
  await page.goto(`${baseURL}/#/prepare`);
  await page.locator('[data-action="next-training"]').click();
  await page.locator(".question-main").waitFor();
  await finishGroup(page, true);
  assert.equal(await page.locator(".trend-point").count(), 2);
  assert.equal(await page.locator(".trend-table tbody tr").count(), 2);
  assert.match(await page.locator("#preparation-trends").innerText(), /\+17 个百分点/);
  await page.screenshot({ path: "artifacts/study-trend-desktop.png", fullPage: true, animations: "disabled" });
  const completed = await stateOf(page);
  assert.equal(completed.attempts.length, 12);

  await page.goto(`${baseURL}/#/prepare`);
  await page.locator("#prepare-round-policy").selectOption("fixed");
  await page.locator('[data-action="begin-preparation"]').click();
  await page.locator(".question-main").waitFor();
  const currentId = (await stateOf(page)).preparation.id;
  assert.notEqual(currentId, planId);
  assert.equal((await stateOf(page)).preparationHistory.length, 1);
  await page.goto(`${baseURL}/#/prepare`);
  await page.locator("#preparation-trends>summary").click();
  await page.locator("#trend-plan").selectOption(planId);
  assert.equal(await page.locator(".trend-point").count(), 2);
  await page.reload();
  await page.locator(".trend-chart").waitFor();
  assert.equal(await page.locator("#trend-plan").inputValue(), planId);
  assert.equal((await stateOf(page)).preparation.id, currentId);

  await page.goto(`${baseURL}/#/library`);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整备份" }).click();
  await (await downloaded).saveAs("artifacts/study-history-backup.json");
  await page.getByRole("button", { name: "清空学习记录" }).click();
  await page.locator('[data-action="confirm-dialog"]').click();
  await page.locator(".local-hero").waitFor();
  await page.goto(`${baseURL}/#/library`);
  await page.getByRole("button", { name: "恢复学习数据" }).click();
  await page.locator("#file-input").setInputFiles("artifacts/study-history-backup.json");
  await page.locator('[data-action="confirm-dialog"]').click();
  await page.locator(".local-hero").waitFor();
  const restored = await stateOf(page);
  assert.equal(restored.preparationHistory[0].id, planId);
  assert.equal(spacedReview(bank, restored, Number.MAX_SAFE_INTEGER).schedule.size, 6);
  await page.clock.fastForward(DAY_MS + 1000);
  await page.goto(`${baseURL}/#/spaced`);
  await page.locator(".spaced-overview").waitFor();
  assert.match(await page.locator(".spaced-overview h2").innerText(), /^6 道/);
  await page.locator("#chapter-filter").selectOption("limits");
  await page.locator('.spaced-overview h2').filter({ hasText: "3 道" }).waitFor();
  await page.locator('[data-action="start-spaced"]').click();
  await page.getByRole("heading", { name: "到期复习", exact: true }).waitFor();
  const duePractice = (await stateOf(page)).practice;
  assert.equal(duePractice.questionIds.length, 3);
  assert.ok(duePractice.questionIds.every((id) => bank.questions.find((q) => q.id === id).chapterId === "limits"));
  for (const id of duePractice.questionIds) {
    await answer(page, true);
    await page.locator('[data-action="next-question"]').click();
  }
  await page.goto(`${baseURL}/#/spaced`);
  await page.locator(".spaced-overview").waitFor();
  assert.match(await page.locator(".spaced-overview h2").innerText(), /^3 道/);
  const after = await stateOf(page);
  const schedule = spacedReview(bank, after, 0).schedule;
  for (const id of duePractice.questionIds) assert.equal(schedule.get(id).intervalDays, 3);
  assert.equal(after.preparation.id, currentId);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "切换明暗主题" }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "artifacts/spaced-review-mobile-dark.png", fullPage: true, animations: "disabled" });
  await page.goto(`${baseURL}/#/prepare?plan=${planId}`);
  await page.locator(".trend-chart").waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "artifacts/study-history-mobile-dark.png", fullPage: true, animations: "disabled" });
  await page.locator('[data-action="resume-preparation"]').click();
  await page.locator(".question-main").waitFor();
  assert.equal((await stateOf(page)).practice.preparationId, currentId);
  assert.deepEqual(errors, []);
  await writeFile("artifacts/study-browser-report.json", JSON.stringify({ passed: true, pageErrors: errors, scenarios: [
    "cross-chapter concept details and navigation", "completed and partial round trends with archived plan selection",
    "backup restores history, current diagnosis and review schedules", "time travel reveals due reviews and subject/chapter filtering",
    "successful due reviews extend intervals; preparation resumes after review", "mobile dark theme and chart layout",
  ] }, null, 2));
  console.log("Spaced review, cross-chapter concepts and preparation trends passed.");
} finally { await browser.close(); }
