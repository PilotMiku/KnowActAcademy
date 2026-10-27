import { chromium, browserOptions, baseURL } from "./browser-helpers.mjs";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fixture } from "./fixture.mjs";

const raw = structuredClone(fixture);
raw.subjects[0].chapters = [{ id: "root", name: "测试大章", children: [{ id: "limits", name: "测试小节" }] }, { id: "extra", name: "另一章" }];
raw.subjects.push({ id: "other", name: "另一科目", chapters: [{ id: "limits", name: "同 ID 章节" }] });
raw.questions.push({ ...raw.questions[0], id: "extra-q", chapterId: "extra" });
raw.questions.push({ ...raw.questions[0], id: "other-q", subjectId: "other" });
const browser = await chromium.launch(browserOptions), errors = [];
async function expectProgress(page, { completion, accuracy, count }, within = ".learning-progress") {
  const card = page.locator(within);
  await card.locator("[data-progress-count]").filter({ hasText: count }).waitFor();
  assert.equal(await card.locator("[data-progress-completion]").innerText(), completion);
  assert.equal(await card.locator("[data-progress-accuracy]").innerText(), accuracy);
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1060 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${baseURL}/#/library`);
  await page.getByRole("button", { name: "选择题库文件" }).click();
  await page.locator("#file-input").setInputFiles({ name: "qa-progress.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(raw)) });
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await page.locator(".local-hero").waitFor();
  const practiceURL = `${baseURL}/#/practice?subject=math&chapter=root`;
  await page.goto(practiceURL);
  await expectProgress(page, { completion: "0%", accuracy: "—", count: "已完成 0 / 6 题" });
  assert.ok(await page.locator(".filter-bar").evaluate((el) => el.nextElementSibling.classList.contains("learning-progress")));
  await page.getByRole("button", { name: /顺序练习/ }).click();
  await page.locator('[data-action="answer-option"][data-value="A"]').click();
  await page.locator('[data-action="submit-answer"]').click();
  await page.locator(".result-box").waitFor();
  await page.locator('[data-action="next-question"]').click();
  for (const value of ["A", "B"]) await page.locator(`[data-action="answer-option"][data-value="${value}"]`).click();
  await page.locator('[data-action="submit-answer"]').click();
  await page.locator(".result-box").waitFor();
  await page.goto(practiceURL);
  await expectProgress(page, { completion: "33.33%", accuracy: "50%", count: "已完成 2 / 6 题" });
  await page.locator("#type-filter").selectOption("multiple");
  await expectProgress(page, { completion: "100%", accuracy: "100%", count: "已完成 1 / 1 题" });
  await page.goto(practiceURL);
  await page.getByRole("button", { name: /顺序练习/ }).click();
  await page.locator('[data-action="answer-option"][data-value="B"]').click();
  await page.locator('[data-action="submit-answer"]').click();
  await page.locator(".result-box").waitFor();
  await page.locator('.index-btn[data-index="4"]').click();
  await page.locator('[data-action="submit-answer"]').click();
  await page.locator('[data-action="self-grade"]').first().waitFor();
  await page.goto(practiceURL);
  await expectProgress(page, { completion: "33.33%", accuracy: "100%", count: "已完成 2 / 6 题" });
  await page.locator('[data-action="resume-practice"]').click();
  await page.locator('[data-action="self-grade"][data-correct="false"]').click();
  await page.locator(".result-box").waitFor();
  await page.goto(practiceURL);
  await expectProgress(page, { completion: "50%", accuracy: "66.67%", count: "已完成 3 / 6 题" });
  await page.reload();
  await expectProgress(page, { completion: "50%", accuracy: "66.67%", count: "已完成 3 / 6 题" });
  await page.screenshot({ path: "artifacts/learning-progress-desktop.png", fullPage: true, animations: "disabled" });
  await page.locator("#subject-filter").selectOption("other");
  await expectProgress(page, { completion: "0%", accuracy: "—", count: "已完成 0 / 1 题" });
  await page.goto(practiceURL);
  await page.locator("#question-search").fill("不存在的关键词");
  await page.locator("#question-search").dispatchEvent("change");
  await expectProgress(page, { completion: "0%", accuracy: "—", count: "已完成 0 / 0 题" });

  await page.goto(`${baseURL}/#/prepare?subject=math&scope=custom&chapter=root`);
  const within = "#prepare-learning-progress .learning-progress";
  await expectProgress(page, { completion: "50%", accuracy: "66.67%", count: "已完成 3 / 6 题" }, within);
  const child = page.locator('[data-prepare-chapter][value="limits"]');
  await child.check();
  await expectProgress(page, { completion: "50%", accuracy: "66.67%", count: "已完成 3 / 6 题" }, within);
  assert.ok(await child.evaluate((el) => el === document.activeElement));
  await page.locator('[data-prepare-chapter][value="extra"]').check();
  await expectProgress(page, { completion: "42.86%", accuracy: "66.67%", count: "已完成 3 / 7 题" }, within);
  await page.locator('[data-action="prepare-select-none"]').click();
  await expectProgress(page, { completion: "0%", accuracy: "—", count: "已完成 0 / 0 题" }, within);
  await page.locator('[data-prepare-chapter][value="root"]').check();
  await page.reload();
  await expectProgress(page, { completion: "50%", accuracy: "66.67%", count: "已完成 3 / 6 题" }, within);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "切换明暗主题" }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "artifacts/learning-progress-preparation-mobile-dark.png", fullPage: true, animations: "disabled" });
  await page.goto(practiceURL);
  await expectProgress(page, { completion: "50%", accuracy: "66.67%", count: "已完成 3 / 6 题" });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "artifacts/learning-progress-mobile-dark.png", fullPage: true, animations: "disabled" });
  assert.deepEqual(errors, []);
  await writeFile("artifacts/learning-progress-browser-report.json", JSON.stringify({ passed: true, pageErrors: errors, scenarios: [
    "chapter selector placement and new-user empty states", "distinct answered questions and latest answer accuracy",
    "manual reference viewing versus completed self-assessment", "subject/type/search filters and nested overlapping chapter scopes",
    "preparation checkbox updates preserve focus", "reload persistence and 390px dark theme layout",
  ] }, null, 2));
  console.log("Learning progress passed: scoped completion, latest accuracy, self-assessment, filters, persistence and mobile layout.");
} finally { await browser.close(); }
