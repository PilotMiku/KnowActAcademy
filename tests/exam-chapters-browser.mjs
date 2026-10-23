import { chromium, browserOptions, baseURL } from "./browser-helpers.mjs";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { normalizeBank, filterQuestions, validateBackup, BACKUP_FORMAT } from "../dist/core.mjs";
import { fixture } from "./fixture.mjs";

const bank = normalizeBank(JSON.parse(await readFile(new URL("../dist/data/bank.json", import.meta.url), "utf8")));
const browser = await chromium.launch(browserOptions);
const errors = [];
const chapterValue = (subjectId, chapterId) => JSON.stringify([subjectId, chapterId]);
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
  assert.equal(await page.locator("#exam-chapter option").count(), 13);
  assert.equal(await page.locator("#exam-chapter").inputValue(), "");
  assert.match(await page.locator("#exam-availability").innerText(), /3501/);

  for (const subject of bank.subjects) {
    for (const chapter of subject.chapters.filter((c) => !c.parentId)) {
      await page.locator("#exam-subject").selectOption(subject.id);
      await page.locator("#exam-chapter").selectOption(chapterValue(subject.id, chapter.id));
      const expected = filterQuestions(bank, { subjectId: subject.id, chapterId: chapter.id }).length;
      assert.match(await page.locator("#exam-availability").innerText(), new RegExp(`共 ${expected} 道`));
    }
  }
  await page.locator("#exam-subject").selectOption("calculus");
  assert.equal(await page.locator("#exam-chapter").inputValue(), "");
  assert.equal(await page.locator("#exam-chapter option").count(), 8);
  await page.locator("#exam-subject").selectOption("");
  // Choosing a chapter from the combined list also selects its subject.
  await page.locator("#exam-chapter").selectOption(chapterValue("linear", "linear-chapter-1"));
  assert.equal(await page.locator("#exam-subject").inputValue(), "linear");
  assert.equal(await page.locator("#exam-chapter option").count(), 6);
  await page.screenshot({ path: "artifacts/exam-chapters-desktop.png", fullPage: true, animations: "disabled" });
  await page.locator("#exam-count").fill("100");
  await page.getByRole("button", { name: "开始考试" }).click();
  assert.match(await page.locator("#exam-error").innerText(), /92/);
  await page.locator("#exam-count").fill("5");
  await page.getByRole("button", { name: "开始考试" }).click();
  await page.locator("[data-timer]").waitFor();
  const stored = await readStored(page);
  const exam = stored.state.exams.at(-1);
  assert.equal(exam.chapterId, "linear-chapter-1");
  assert.equal(exam.subjectId, "linear");
  const expectedIds = new Set(filterQuestions(bank, { subjectId: "linear", chapterId: "linear-chapter-1" }).map((q) => q.id));
  assert.equal(exam.questionIds.length, 5);
  assert.equal(new Set(exam.questionIds).size, 5);
  assert.ok(exam.questionIds.every((id) => expectedIds.has(id)));
  assert.equal(validateBackup({ format: BACKUP_FORMAT, ...stored }).state.exams.at(-1).chapterId, "linear-chapter-1");
  await page.reload();
  await page.locator("[data-timer]").waitFor();
  assert.match(await page.locator(".page-head .subtitle").innerText(), /第1章 行列式/);
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
  ];
  custom.questions = custom.questions.filter((q) => q.id !== "qa-html");
  custom.questions.forEach((q) => { q.chapterId = q.type === "solution" ? "manual" : "section"; });
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
  assert.equal(await mp.locator("#exam-chapter option").count(), 4);
  await mp.locator("#exam-chapter").selectOption(chapterValue("math", "limits"));
  assert.equal(await mp.locator("#exam-count").inputValue(), "4");
  assert.equal(await mp.locator("#exam-count").getAttribute("max"), "4");
  await mp.locator("#exam-chapter").selectOption(chapterValue("math", "manual"));
  assert.match(await mp.locator("#exam-availability").innerText(), /没有可考试/);
  assert.equal(await mp.getByRole("button", { name: "开始考试" }).isDisabled(), true);
  await mp.locator("#exam-subject").selectOption("other");
  assert.equal(await mp.locator("#exam-chapter").inputValue(), "");
  await mp.locator("#exam-chapter").selectOption(chapterValue("other", "limits"));
  assert.match(await mp.locator("#exam-availability").innerText(), /共 1 道/);
  assert.equal(await mp.getByRole("button", { name: "开始考试" }).isEnabled(), true);
  await mp.screenshot({ path: "artifacts/exam-chapters-mobile.png", fullPage: true, animations: "disabled" });
  assert.ok(await mp.evaluate(() => {
    const dialog = document.querySelector("#dialog");
    return document.documentElement.scrollWidth <= innerWidth && dialog.scrollWidth <= dialog.clientWidth;
  }));
  await mp.getByRole("button", { name: "开始考试" }).click();
  await mp.locator("[data-timer]").waitFor();
  assert.deepEqual((await readStored(mp)).state.exams.at(-1).questionIds, ["other-question"]);
  await mobile.close();
  assert.deepEqual(errors, []);
  console.log("Exam chapters passed: all 12 major chapters, scoped sampling, persistence, backups, reports, subject changes, small/empty pools and mobile layout.");
} finally {
  await browser.close();
}
