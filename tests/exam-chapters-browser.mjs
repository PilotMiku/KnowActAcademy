import { chromium, browserOptions, baseURL } from "./browser-helpers.mjs";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { normalizeBank, filterQuestions, examQuestions, validateBackup, BACKUP_FORMAT } from "../dist/core.mjs";
import { fixture } from "./fixture.mjs";

const bank = normalizeBank(JSON.parse(await readFile(new URL("../dist/data/bank.json", import.meta.url), "utf8")));
const browser = await chromium.launch(browserOptions);
const errors = [];
const chapterValue = (subjectId, chapterId) => JSON.stringify([subjectId, chapterId]);
const chapterInput = (page, subjectId, chapterId) => page.locator(`[data-exam-chapter][value='${chapterValue(subjectId, chapterId)}']`);
const readStored = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("zhixing-study:" + new URL("./", location.href).pathname, 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction("kv");
    const state = tx.objectStore("kv").get("state");
    const bank = tx.objectStore("kv").get("bank");
    tx.oncomplete = () => { resolve({ state: state.result, bank: bank.result }); db.close(); };
    tx.onerror = () => reject(tx.error);
  };
}));

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1060 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseURL}/#/exams`);
  await page.getByRole("button", { name: "新建模拟考试" }).click();
  assert.equal(await page.locator("[data-exam-chapter]").count(), 12);
  assert.ok(await page.locator("#exam-all-chapters").isChecked());
  assert.match(await page.locator("#exam-availability").innerText(), /3501/);

  for (const subject of bank.subjects) {
    for (const chapter of subject.chapters.filter((c) => !c.parentId)) {
      await page.locator("#exam-subject").selectOption(subject.id);
      await chapterInput(page, subject.id, chapter.id).check();
      const expected = filterQuestions(bank, { subjectId: subject.id, chapterId: chapter.id }).length;
      assert.match(await page.locator("#exam-availability").innerText(), new RegExp(`共 ${expected} 道`));
    }
  }
  await page.locator("#exam-subject").selectOption("calculus");
  assert.ok(await page.locator("#exam-all-chapters").isChecked());
  assert.equal(await page.locator("[data-exam-chapter]").count(), 7);
  await page.locator("#exam-subject").selectOption("");
  await chapterInput(page, "linear", "linear-chapter-1").check();
  assert.equal(await page.locator("#exam-subject").inputValue(), "");
  await page.locator("#exam-count").fill("100");
  await page.getByRole("button", { name: "开始考试" }).click();
  assert.match(await page.locator("#exam-error").innerText(), /92/);
  await chapterInput(page, "linear", "linear-chapter-1").uncheck();
  assert.equal(await page.locator("#exam-error").getAttribute("class"), "");
  assert.match(await page.locator("#exam-availability").innerText(), /请至少选择/);
  assert.ok(await page.getByRole("button", { name: "开始考试" }).isDisabled());
  const selected = [
    { subjectId: "calculus", chapterId: "chapter-1" },
    { subjectId: "linear", chapterId: "linear-chapter-1" },
    { subjectId: "linear", chapterId: "linear-chapter-2" },
  ];
  for (const scope of selected) await chapterInput(page, scope.subjectId, scope.chapterId).check();
  const expectedQuestions = examQuestions(bank, { chapters: selected });
  assert.match(await page.locator("#exam-availability").innerText(), new RegExp(`共 ${expectedQuestions.length} 道.*已选 3 个`));
  await page.locator("#exam-all-chapters").check();
  assert.equal(await page.locator("[data-exam-chapter]:checked").count(), 0);
  assert.match(await page.locator("#exam-availability").innerText(), /3501/);
  for (const scope of selected) await chapterInput(page, scope.subjectId, scope.chapterId).check();
  await page.screenshot({ path: "artifacts/exam-chapters-desktop.png", fullPage: true, animations: "disabled" });
  await page.locator("#exam-count").fill("5");
  await page.getByRole("button", { name: "开始考试" }).click();
  await page.locator("[data-timer]").waitFor();
  const stored = await readStored(page);
  const exam = stored.state.exams.at(-1);
  assert.deepEqual(exam.chapters, selected);
  assert.equal(exam.subjectId, "");
  const expectedIds = new Set(expectedQuestions.map((q) => q.id));
  assert.equal(exam.questionIds.length, 5);
  assert.equal(new Set(exam.questionIds).size, 5);
  assert.ok(exam.questionIds.every((id) => expectedIds.has(id)));
  assert.deepEqual(validateBackup({ format: BACKUP_FORMAT, ...stored }).state.exams.at(-1).chapters, selected);
  await page.reload();
  await page.locator("[data-timer]").waitFor();
  assert.match(await page.locator(".page-head .subtitle").innerText(), /第1章 行列式/);
  assert.match(await page.locator(".page-head .subtitle").innerText(), /第2章 矩阵及其运算/);
  assert.match(await page.locator(".page-head .subtitle").innerText(), /第1章 函数与极限/);
  await page.getByRole("button", { name: "提交试卷", exact: true }).first().click();
  await page.locator('#dialog [data-action="confirm-dialog"]').click();
  await page.locator(".score").waitFor();
  assert.match(await page.locator(".score-hero").innerText(), /第1章 行列式/);
  await page.goto(`${baseURL}/#/exams`);
  await page.locator(".exam-card").waitFor();
  assert.match(await page.locator(".exam-card").innerText(), /第1章 行列式/);
  await context.close();

  // Small imported banks cover limited pools, manual-only chapters, nested
  // sections, and chapter IDs shared by different subjects.
  const custom = structuredClone(fixture);
  custom.subjects[0].chapters = [
    { id: "limits", name: "测试大章节", children: [{ id: "section", name: "测试小节" }] },
    { id: "manual", name: "仅解答题" },
    { id: "extra", name: "另一大章节" },
  ];
  custom.questions = custom.questions.filter((q) => q.id !== "qa-html");
  custom.questions.forEach((q) => { q.chapterId = q.type === "solution" ? "manual" : "section"; });
  custom.questions.push({ ...custom.questions[0], id: "extra-question", chapterId: "extra" });
  custom.subjects.push({ id: "other", name: "另一科目", chapters: [{ id: "limits", name: "同 ID 章节" }] });
  custom.questions.push({ ...custom.questions[0], id: "other-question", subjectId: "other", chapterId: "limits" });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const mp = await mobile.newPage();
  mp.on("pageerror", (error) => errors.push(error.message));
  await mp.goto(`${baseURL}/#/library`);
  await mp.getByRole("button", { name: "选择题库文件" }).waitFor();
  await mp.locator("#file-input").setInputFiles({ name: "exam-chapters.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(custom)) });
  await mp.getByRole("button", { name: "确认导入", exact: true }).click();
  await mp.locator(".local-hero").waitFor();
  await mp.goto(`${baseURL}/#/exams`);
  await mp.getByRole("button", { name: "新建模拟考试" }).click();
  assert.equal(await mp.locator("[data-exam-chapter]").count(), 4);
  await chapterInput(mp, "math", "limits").check();
  assert.equal(await mp.locator("#exam-count").inputValue(), "4");
  assert.equal(await mp.locator("#exam-count").getAttribute("max"), "4");
  await chapterInput(mp, "math", "limits").uncheck();
  await chapterInput(mp, "math", "manual").check();
  assert.match(await mp.locator("#exam-availability").innerText(), /没有可考试/);
  assert.equal(await mp.getByRole("button", { name: "开始考试" }).isDisabled(), true);
  await mp.locator("#exam-subject").selectOption("other");
  assert.ok(await mp.locator("#exam-all-chapters").isChecked());
  await chapterInput(mp, "other", "limits").check();
  assert.match(await mp.locator("#exam-availability").innerText(), /共 1 道/);
  assert.equal(await mp.getByRole("button", { name: "开始考试" }).isEnabled(), true);
  await mp.locator("#exam-subject").selectOption("math");
  await chapterInput(mp, "math", "limits").check();
  await chapterInput(mp, "math", "extra").check();
  assert.match(await mp.locator("#exam-availability").innerText(), /共 5 道.*已选 2 个/);
  await mp.locator("#exam-count").fill("5");
  await mp.screenshot({ path: "artifacts/exam-chapters-mobile.png", fullPage: true, animations: "disabled" });
  assert.ok(await mp.evaluate(() => {
    const dialog = document.querySelector("#dialog");
    return document.documentElement.scrollWidth <= innerWidth && dialog.scrollWidth <= dialog.clientWidth;
  }));
  await mp.getByRole("button", { name: "开始考试" }).click();
  await mp.locator("[data-timer]").waitFor();
  const mobileExam = (await readStored(mp)).state.exams.at(-1);
  assert.deepEqual([...mobileExam.questionIds].sort(), ["extra-question", "qa-boolean", "qa-fill", "qa-multi", "qa-single"]);
  assert.equal(mobileExam.chapters.length, 2);
  await mobile.close();
  assert.deepEqual(errors, []);
  console.log("Exam chapters passed: 12 major chapters, multiple/cross-subject scopes, empty/all selections, persistence, backups, reports and mobile layout.");
} finally {
  await browser.close();
}
