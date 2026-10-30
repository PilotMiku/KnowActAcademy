import { chromium, browserOptions, baseURL } from "./browser-helpers.mjs";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const bank = JSON.parse(await readFile("dist/data/bank.json", "utf8"));
const browser = await chromium.launch(browserOptions), errors = [];
const text = '检查换元的条件。<img src=x onerror="window.noteExecuted=true">';
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: "reduce" });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${baseURL}/#/`);
  await page.locator(".daily-tasks").waitFor();
  await page.locator('.daily-tasks a[href="#/practice"]').click();
  await page.locator('[data-action="start-practice"][data-mode="sequential"]').click();
  await page.locator("[data-question-id]").waitFor();
  const id = await page.locator("[data-question-id]").getAttribute("data-question-id");
  const q = bank.questions.find(q => q.id === id);
  await page.locator(".question-notes summary").click();
  await page.locator("[data-question-note]").fill(text);
  await page.locator('[data-note-reason][value="concept"]').check();
  await page.locator('[data-note-status]').filter({ hasText: '已保存' }).waitFor();
  const textarea = await page.locator("[data-question-note]").elementHandle();
  await page.locator(`[data-action="answer-option"][data-value="${q.answer}"]`).click();
  await page.locator('[data-action="submit-answer"]').click();
  await page.locator(".result-label").waitFor();
  assert.ok(await textarea.evaluate(node => node.isConnected), "判分保留笔记输入框");
  await page.goto(`${baseURL}/#/`);
  await page.locator('.daily-tasks [data-action="resume-practice"]').waitFor();
  assert.match(await page.locator(".daily-task-head").innerText(), /今日有效作答 1 题次/);
  await page.screenshot({ path: "artifacts/daily-tasks-desktop.png", animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: "artifacts/daily-tasks-mobile.png", animations: "disabled" });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('.daily-tasks [data-action="resume-practice"]').click();
  await page.reload();
  await page.locator(".question-notes summary").click();
  assert.equal(await page.locator("[data-question-note]").inputValue(), text);
  assert.ok(await page.locator('[data-note-reason][value="concept"]').isChecked());
  assert.equal(await page.evaluate(() => window.noteExecuted), undefined);
  await page.goto(`${baseURL}/#/library`);
  const downloading = page.waitForEvent("download");
  await page.locator('[data-action="export-backup"]').click();
  const backup = await downloading;
  await backup.saveAs("artifacts/daily-notes-backup.json");
  const payload = JSON.parse(await readFile("artifacts/daily-notes-backup.json", "utf8"));
  assert.equal(payload.state.questionNotes[id].text, text);
  await page.locator('[data-action="restore-backup"]').click();
  await page.locator("#file-input").setInputFiles("artifacts/daily-notes-backup.json");
  await page.locator('#dialog [data-action="confirm-dialog"]').click();
  await page.locator(".daily-tasks").waitFor();
  await page.locator('.daily-tasks [data-action="resume-practice"]').click();
  await page.locator(".question-notes summary").click();
  assert.equal(await page.locator("[data-question-note]").inputValue(), text);

  // Home shows the total due queue even when another course tab is selected.
  await page.clock.install();
  await page.clock.fastForward(86401000);
  await page.goto(`${baseURL}/#/?subject=linear`);
  await page.locator('.daily-tasks [data-action="start-spaced"]').click();
  await page.locator('[data-question-id]').waitFor();
  assert.equal(await page.locator('[data-question-id]').getAttribute('data-question-id'), id);

  for (const name of ["向量概念及其性质、内积、正交", "基础解系和解的结构", "线性变换、欧几里得空间", "线性方程组解判定及其求解", "线性空间"]) {
    const section = bank.sections.find(s => s.name === name);
    assert.ok(section, name);
    await page.goto(`${baseURL}/#/practice?subject=linear&chapter=${section.id}`);
    await page.locator('[data-action="start-practice"][data-mode="sequential"]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.question-title img,.option img')].length > 0 &&
      [...document.querySelectorAll('.question-title img,.option img')].every(image => image.complete && image.naturalWidth > 0));
    assert.equal(await page.locator(".option").count(), 4);
  }
  await page.locator('[data-action="toggle-theme"]').click();
  await page.screenshot({ path: "artifacts/new-linear-notes-mobile-dark.png", fullPage: true, animations: "disabled" });
  assert.deepEqual(errors, []);
  console.log("Daily tasks, personal notes/reasons, safe text, stable grading DOM, backup/restore and all five new PDF sections passed.");
} finally { await browser.close(); }
