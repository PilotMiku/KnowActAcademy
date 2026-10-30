import assert from "node:assert/strict";
import { chromium, browserOptions, baseURL } from "./browser-helpers.mjs";

const browser = await chromium.launch(browserOptions);
const errors = [];
async function open(context, path = "/practice") {
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${baseURL}/#${path}`);
  await page.locator(".local-shell").waitFor();
  return page;
}
const stored = page => page.evaluate(async () => {
  const { storageName } = await import("./assets.mjs");
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(storageName, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv"), request = tx.objectStore("kv").get("state");
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = () => reject(tx.error);
  });
});
async function answer(page) {
  await page.locator("[data-question-id]").waitFor();
  const id = await page.locator("[data-question-id]").getAttribute("data-question-id");
  const bank = await page.evaluate(async () => (await fetch("./data/bank.json")).json());
  const q = bank.questions.find(q => q.id === id);
  for (const value of Array.isArray(q.answer) ? q.answer : [q.answer])
    await page.locator(`[data-action="answer-option"][data-value="${value}"]`).click();
  await page.locator('[data-action="submit-answer"]').click();
  await page.locator(".result-label").waitFor();
}
try {
  for (const notifications of [true, false]) {
    const context = await browser.newContext({ reducedMotion: "reduce", acceptDownloads: true,
      colorScheme: notifications ? "dark" : "light" });
    if (!notifications) await context.addInitScript(() => {
      Object.defineProperty(window, "BroadcastChannel", { value: undefined });
      window.addEventListener("storage", event => event.stopImmediatePropagation());
    });
    const a = await open(context), b = await open(context);
    await a.locator('[data-action="practice-one"]').first().click();
    await answer(a);
    assert.equal((await stored(a)).attempts.length, 1);
    if (!notifications) await b.locator('[data-action="toggle-theme"]').click();
    await b.locator("#storage-conflict:not([hidden])").waitFor();
    assert.equal(await b.locator("#app").evaluate(el => el.inert), true);
    if (notifications) {
      assert.equal(await b.locator("#storage-conflict").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(26, 29, 42)");
      await b.screenshot({ path: "artifacts/storage-conflict-dark.png", animations: "disabled" });
    }
    assert.equal((await stored(b)).attempts.length, 1);
    const download = b.waitForEvent("download");
    await b.locator("#export-stale-page").click();
    assert.match((await download).suggestedFilename(), /此页备份/);
    await b.locator("#reload-latest").click();
    await b.locator(".practice-start").waitFor();
    assert.equal(await b.locator("#storage-conflict").isHidden(), true);
    assert.equal((await stored(b)).attempts.length, 1);
    await context.close();
  }

  const examContext = await browser.newContext({ reducedMotion: "reduce" });
  const examPage = await open(examContext, "/exams");
  await examPage.getByRole("button", { name: "新建模拟考试" }).click();
  await examPage.locator("#exam-count").fill("1");
  await examPage.getByRole("button", { name: "开始考试", exact: true }).click();
  await examPage.locator("[data-timer]").waitFor();
  await examPage.getByRole("button", { name: "提交试卷", exact: true }).first().click();
  await examPage.locator('#dialog [data-action="confirm-dialog"]').click();
  await examPage.locator(".score").waitFor();
  await examPage.goto(`${baseURL}/#/`);
  await examPage.locator(".local-hero").waitFor();
  assert.equal(await examPage.locator(".local-stat-strip b").nth(2).innerText(), "0");
  assert.ok((await examPage.locator(".chapter-description").allTextContents()).every(text => /已练 0 题/.test(text)));
  assert.equal((await stored(examPage)).exams[0].score, 0);
  const scheduleCount = await examPage.evaluate(async () => {
    const { spacedReview } = await import("./study.mjs");
    const { openStorage } = await import("./storage.mjs");
    const data = await openStorage();
    return spacedReview(data.bank, data.state).schedule.size;
  });
  assert.equal(scheduleCount, 0);
  await examContext.close();

  const timingContext = await browser.newContext({ reducedMotion: "reduce" });
  const page = await open(timingContext);
  await page.clock.install();
  await page.locator('[data-action="practice-one"]').first().click();
  await page.locator('[data-action="exit-practice"]').click();
  await page.locator(".practice-start").waitFor();
  await page.clock.fastForward(600000);
  await page.locator('[data-action="resume-practice"]').click();
  await answer(page);
  const attempt = (await stored(page)).attempts[0];
  assert.ok(attempt.durationMs < 10000, JSON.stringify(attempt));
  await timingContext.close();
  assert.deepEqual(errors, []);
  console.log("Reliability passed: cross-tab notifications and atomic conflicts, stale-page backup, blank exams and paused practice timing.");
} finally { await browser.close(); }
