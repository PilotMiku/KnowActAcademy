import { chromium, browserOptions, baseURL } from "./browser-helpers.mjs";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { fixture } from "./fixture.mjs";

const raw = structuredClone(fixture);
raw.questions = [raw.questions[0], raw.questions[4], raw.questions[3]];
const browser = await chromium.launch(browserOptions), errors = [];
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
async function visitQuestion(page, id) {
  const state = await stateOf(page), index = state.practice.questionIds.indexOf(id);
  await page.locator(`.index-btn[data-index="${index}"]`).click();
}
async function grade(page, id, correct) {
  await visitQuestion(page, id);
  const q = raw.questions.find((q) => q.id === id);
  if (q.type === "solution") {
    await page.locator('[data-action="submit-answer"]').click();
    await page.locator(`[data-action="self-grade"][data-correct="${correct}"]`).click();
  } else {
    const answer = q.type === "boolean" ? String(correct ? q.answer : !q.answer) : correct ? q.answer : "A";
    await page.locator(`[data-action="answer-option"][data-value="${answer}"]`).click();
    // Replaying a click before the first save completes must not count twice.
    await page.locator('[data-action="submit-answer"]').evaluate((button) => { button.click(); button.click(); });
  }
  await page.locator(".result-box").waitFor();
}
async function summary(page) {
  const state = await stateOf(page);
  await page.locator(`.index-btn[data-index="${state.practice.questionIds.length - 1}"]`).click();
  await page.locator('[data-action="next-question"]').click();
  await page.locator(".preparation-summary").waitFor();
}
async function expectLive(page, score, progress, pending, completed) {
  const card = page.locator(".preparation-live");
  await card.locator('[data-live-field="training"]').filter({ hasText: String(score) }).waitFor();
  assert.equal(await card.locator('[data-live-field="training"]').innerText(), String(score));
  assert.equal(await card.locator("[data-preparation-progress]").innerText(), `${progress}%`);
  assert.equal(await card.locator("[data-preparation-pending]").innerText(), String(pending));
  assert.match(await card.locator("[data-preparation-round]").innerText(), new RegExp(`已完成 ${completed} / 3 题`));
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${baseURL}/#/library`);
  await page.getByRole("button", { name: "选择题库文件" }).click();
  await page.locator("#file-input").setInputFiles({ name: "qa-mastery.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(raw)) });
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await page.locator(".local-hero").waitFor();
  await page.goto(`${baseURL}/#/prepare`);
  await page.locator("#prepare-round-policy").selectOption("fixed");
  await page.locator('[data-action="begin-preparation"]').click();
  await expectLive(page, "—", 0, 0, 0);
  await grade(page, "qa-single", false);
  await expectLive(page, 33.3, 0, 1, 1);
  assert.equal(await page.locator("[data-preparation-score]").innerText(), "—");
  assert.equal(await page.locator('.question-main [data-action="resolve-mistake"]').count(), 0);
  await page.goto(`${baseURL}/#/review`);
  await page.locator('[data-action="resolve-mistake"][data-id="qa-single"]').click();
  await page.getByRole("status").filter({ hasText: "连续答对两次" }).waitFor();
  assert.equal((await stateOf(page)).mistakes["qa-single"].resolved, false);
  await page.goto(`${baseURL}/#/prepare?session=1`);
  await visitQuestion(page, "qa-solution");
  await page.locator('[data-action="submit-answer"]').click();
  await page.locator('[data-action="self-grade"]').first().waitFor();
  await expectLive(page, 33.3, 0, 1, 1);
  await page.getByRole("button", { name: "本次答对", exact: true }).click();
  await expectLive(page, 50, 0, 1, 2);
  await grade(page, "qa-boolean", true);
  await expectLive(page, 66.7, 0, 1, 3);
  await summary(page);
  await page.locator('[data-action="next-training"]').click();
  await grade(page, "qa-single", true);
  await expectLive(page, 83.3, 0, 1, 1);
  assert.match(await page.locator("[data-preparation-question-status]").innerText(), /连续答对 1 \/ 2/);
  assert.match(await page.locator(".result-label").innerText(), /再巩固一次/);
  assert.equal((await stateOf(page)).mistakes["qa-single"].resolved, false);
  await page.reload();
  await expectLive(page, 83.3, 0, 1, 1);
  await grade(page, "qa-solution", true);
  await grade(page, "qa-boolean", true);
  await expectLive(page, 83.3, 66.67, 1, 3);
  await visitQuestion(page, "qa-single");
  await page.screenshot({ path: "artifacts/preparation-live-desktop.png", fullPage: true, animations: "disabled" });
  const firstCorrection = await stateOf(page);
  assert.equal(firstCorrection.attempts.filter((a) => a.questionId === "qa-single").length, 2);

  await page.goto(`${baseURL}/#/library`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整备份" }).click();
  await (await download).saveAs("artifacts/preparation-mastery-backup.json");
  await page.getByRole("button", { name: "清空学习记录" }).click();
  await page.locator('[data-action="confirm-dialog"]').click();
  await page.locator(".local-hero").waitFor();
  await page.goto(`${baseURL}/#/library`);
  await page.getByRole("button", { name: "恢复学习数据" }).click();
  await page.locator("#file-input").setInputFiles("artifacts/preparation-mastery-backup.json");
  await page.locator('[data-action="confirm-dialog"]').click();
  await page.locator(".local-hero").waitFor();
  await page.goto(`${baseURL}/#/prepare?session=1`);
  await expectLive(page, 83.3, 66.67, 1, 3);
  await summary(page);
  await page.locator('[data-action="next-training"]').click();
  await grade(page, "qa-single", true);
  await expectLive(page, 100, 100, 0, 1);
  assert.match(await page.locator("[data-preparation-question-status]").innerText(), /已掌握.*2 \/ 2/);
  assert.equal((await stateOf(page)).mistakes["qa-single"].resolved, true);
  await grade(page, "qa-solution", true);
  await grade(page, "qa-boolean", true);
  await summary(page);
  await page.locator('[data-action="next-training"]').click();
  await grade(page, "qa-single", false);
  await expectLive(page, 66.7, 66.67, 1, 1);
  assert.match(await page.locator("[data-preparation-question-status]").innerText(), /连续答对 0 \/ 2/);
  assert.equal((await stateOf(page)).mistakes["qa-single"].resolved, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "切换明暗主题" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "artifacts/preparation-live-mobile-dark.png", fullPage: true, animations: "disabled" });
  assert.deepEqual(errors, []);
  await writeFile("artifacts/preparation-mastery-browser-report.json", JSON.stringify({ passed: true, pageErrors: errors, scenarios: [
    "live score, overall mastery and per-round completion after each answer", "wrong answers require two independent consecutive corrections",
    "double submission and manual mastery cannot bypass the rule", "unassessed solutions do not change the dashboard",
    "refresh and full backup restore preserve streaks and estimates", "a later error resets mastery and reopens the notebook",
    "390px dark theme dashboard layout",
  ] }, null, 2));
  console.log("Preparation mastery and live predictions passed: two corrections, relapse, safeguards, backups and mobile dashboard.");
} finally { await browser.close(); }
