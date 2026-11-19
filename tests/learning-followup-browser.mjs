import assert from 'node:assert/strict';
import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';

const browser = await chromium.launch(browserOptions);
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const saved = () => page.evaluate(async () => (await import('./storage.mjs')).readSavedState());
const action = name => page.locator(`[data-action="${name}"]`);
const scope = '/#/practice?subject=calculus&chapter=s-6b82188494c1';
try {
  await page.goto(baseURL + scope);
  await action('start-practice').filter({ hasText: '顺序' }).click();
  const question = page.locator('.question-main[data-practice-id]');
  await question.waitFor();
  await page.locator('[data-action="answer-option"][data-value="A"]').click();
  await action('submit-answer').click();
  await action('practice-similar').waitFor();
  const original = (await saved()).practice;
  await action('practice-similar').click();
  await page.getByRole('heading', { name: '同类新题', exact: true }).waitFor();
  const temporary = (await saved()).practice;
  assert.equal(temporary.questionIds.length, 3);
  assert.ok(!temporary.questionIds.includes(original.questionIds[0]));
  await page.reload();
  await action('resume-suspended-practice').click();
  await page.waitForFunction(id => document.querySelector('.question-main')?.dataset.practiceId === id, original.id);
  assert.deepEqual((await saved()).practice.responses, original.responses);
  await action('next-question').click();
  await page.waitForFunction(async () => (await (await import('./storage.mjs')).readSavedState()).practice?.index === 1);
  await page.goto(baseURL + scope);
  await action('practice-one').first().click();
  await action('resume-suspended-practice').click();
  await page.waitForFunction(id => document.querySelector('.question-main')?.dataset.practiceId === id, original.id);
  assert.equal((await saved()).practice.index, 1);

  await page.evaluate(async () => {
    const { readSavedData, saveStorage } = await import('./storage.mjs');
    const { createPractice, getBankIndex, isScorable } = await import('./core.mjs');
    const { bank, state } = await readSavedData();
    const ids = getBankIndex(bank).chapterQuestions.get('calculus').get('s-6b82188494c1').filter(isScorable).map(q => q.id);
    state.practice = createPractice(ids, 'random');
    for (const id of ids.slice(1)) state.practice.responses[id] = { graded: true, correct: true, answer: 'A' };
    await saveStorage(bank, state);
  });
  await page.reload();
  const nextSection = action('next-practice-section');
  await page.locator('[data-action="submit-answer"]').waitFor();
  assert.equal(await nextSection.count(), 0);
  await page.locator('[data-action="answer-option"][data-value="A"]').click();
  await action('submit-answer').click();
  await nextSection.waitFor();
  assert.match(await nextSection.innerText(), /数列极限的定义/);
  await nextSection.click();
  await page.waitForFunction(async () => {
    const { bank, state } = await (await import('./storage.mjs')).readSavedData();
    const { getBankIndex } = await import('./core.mjs');
    const { questions } = getBankIndex(bank);
    return state.practice.index === 0 && state.practice.questionIds.every(id => questions.get(id)?.chapterId === 's-0cda94732a27');
  });
  assert.equal((await saved()).practice.mode, 'random');

  await page.goto(baseURL + '/#/reference?section=s-748a0b9cef9b');
  const selfCheck = page.locator('[data-self-check]').first();
  await selfCheck.locator('textarea').fill('8x(1+x²)³');
  await selfCheck.getByText('核对答案与推导', { exact: true }).click();
  await selfCheck.getByRole('button', { name: '待复习' }).click();
  await selfCheck.getByRole('status').filter({ hasText: '已标记待复习' }).waitFor();
  await page.reload();
  await selfCheck.getByRole('status').filter({ hasText: '已标记待复习' }).waitFor();
  assert.equal(await selfCheck.locator('textarea').inputValue(), '8x(1+x²)³');

  await page.goto(baseURL + '/#/calendar');
  const form = page.locator('#revision-plan-form');
  await form.waitFor();
  const today = await page.evaluate(async () => (await import('./core.mjs')).dayKey());
  await form.locator('[name="weekendMinutes"]').fill('0');
  await form.locator('[name="skippedDates"]').fill(today);
  await form.getByRole('button', { name: '生成复习日历' }).click();
  await page.locator('.revision-day.is-today').getByText('休息日').waitFor();
  assert.equal(await action('revision-practice').count(), 0);
  await page.reload();
  await page.locator('.revision-day.is-today').getByText('休息日').waitFor();
  assert.equal((await saved()).revisionPlan.weekendMinutes, 0);
  await page.locator('.revision-day.is-today [data-action="revision-day"]').click();
  await action('revision-skip-date').filter({ hasText: '恢复此日安排' }).click();
  await page.waitForFunction(async () => !(await (await import('./storage.mjs')).readSavedState()).revisionPlan.skippedDates?.length);
  await page.locator('.revision-day.is-today [data-action="revision-day"]').click();
  await action('revision-skip-date').filter({ hasText: '跳过这一天' }).click();
  await page.waitForFunction(async day => (await (await import('./storage.mjs')).readSavedState()).revisionPlan.skippedDates?.includes(day), today);

  const examId = await page.evaluate(async () => {
    const { createExam, finishExam, isScorable } = await import('./core.mjs');
    const { readSavedData, saveStorage } = await import('./storage.mjs');
    const { bank, state } = await readSavedData();
    const { loadQuestionContent, loadedQuestion } = await import('./question-content.mjs');
    const ids = bank.questions.filter(q => q.type === 'single' && isScorable(q)).slice(0, 3).map(q => q.id);
    await loadQuestionContent(bank, ids);
    const qs = ids.map(id => loadedQuestion(bank, id));
    const exam = createExam(qs.map(q => q.id), 20);
    exam.answers[qs[0].id] = 'wrong';
    exam.answers[qs[2].id] = qs[2].answer;
    exam.uncertainIds = [qs[2].id];
    exam.questionTimes[qs[0].id] = 15000;
    finishExam(state, { questions: qs }, exam, exam.startedAt + 500);
    state.exams = [...state.exams, exam];
    await saveStorage(bank, state);
    return exam.id;
  });
  await page.reload();
  await page.goto(baseURL + '/#/exam/' + examId);
  const reportFilters = page.getByRole('navigation', { name: '筛选试题' });
  for (const [label, number] of [['答错', 1], ['未答', 2], ['答对但拿不准', 3], ['耗时较长', 1]]) {
    await reportFilters.getByRole('link', { name: new RegExp('^' + label) }).click();
    await page.locator('.question-main').filter({ hasText: new RegExp('第 ' + number + ' 题') }).waitFor();
  }
  await action('practice-exam-filter').click();
  await question.waitFor();
  assert.equal((await saved()).practice.questionIds.length, 1);
  assert.deepEqual(errors, []);
  console.log('Learning follow-up passed: temporary practice, same-topic questions, persisted self-checks, rest days and exam filters.');
} finally {
  await browser.close();
}
