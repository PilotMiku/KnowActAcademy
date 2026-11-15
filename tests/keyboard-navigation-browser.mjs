import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';

const browser = await chromium.launch(browserOptions), errors = [], report = [];
async function ready(page, index) {
  await page.waitForFunction(index => {
    const question = document.querySelector('.question-main');
    return question && document.querySelector('.index-btn.current')?.dataset.index === String(index) &&
      [...question.querySelectorAll('img')].every(image => !image.dataset.figureLoading && image.complete && image.naturalWidth > 0);
  }, index);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function switchQuestion(page, key, index, focusedIndex = String(index)) {
  const before = await page.evaluate(() => scrollY);
  await page.keyboard.press(key);
  await ready(page, index);
  const after = await page.evaluate(() => ({ y:scrollY, focused:document.activeElement.dataset.index,
    current:document.querySelector('[aria-current="step"]')?.dataset.index }));
  assert.equal(after.current, String(index));
  if (focusedIndex !== null) assert.equal(after.focused, focusedIndex, 'keyboard focus follows the current navigation/action button');
  assert.ok(Math.abs(after.y - before) < 3, `${key} to question ${index + 1} moved the page from ${before} to ${after.y}`);
}
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport:{width,height:900}, reducedMotion:width === 390 ? 'reduce' : 'no-preference' });
    page.on('pageerror', error => errors.push(error.message));
    // Exercise foreground loading without speculative content hiding it.
    await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value:{saveData:true} }));
    await page.goto(baseURL + '/#/practice?subject=calculus&chapter=s-6b82188494c1');
    await page.locator('[data-action="start-practice"][data-mode="sequential"]').click();
    await ready(page, 0);
    await page.locator('.index-btn.current').evaluate(el => el.focus({preventScroll:true}));
    await page.evaluate(() => window.scrollTo({top:350,behavior:'instant'}));
    for (const index of [1,2,3]) await switchQuestion(page, 'ArrowRight', index);
    for (const index of [2,1,0]) await switchQuestion(page, 'ArrowLeft', index);

    // Enter activates the new current number, rather than returning to the old one.
    await switchQuestion(page, 'ArrowRight', 1);
    await page.keyboard.press('Enter');
    await ready(page, 1);
    assert.equal(await page.locator('.question-main').getAttribute('data-question-id'), 's-6b82188494c1-q0002');
    await page.locator('.question-actions [data-action="navigate-question"]').evaluate(el => el.focus({preventScroll:true}));
    await switchQuestion(page, 'ArrowRight', 2, '1');
    await page.locator('.question-actions [data-action="next-question"]').evaluate(el => el.focus({preventScroll:true}));
    await switchQuestion(page, 'Enter', 3, null);

    await page.locator('.index-btn[data-index="39"]').evaluate(el => el.click());
    await ready(page, 39);
    await page.locator('.index-btn.current').evaluate(el => el.focus({preventScroll:true}));
    await switchQuestion(page, 'ArrowRight', 40);
    await switchQuestion(page, 'ArrowLeft', 39);
    await switchQuestion(page, 'ArrowRight', 40);
    await page.locator('.index-btn[data-index="50"]').evaluate(el => el.click());
    await ready(page, 50);
    await page.locator('.index-btn.current').evaluate(el => el.focus({preventScroll:true}));
    const beforeLoad = await page.evaluate(() => scrollY);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/question-content/*.json', async route => { await gate; await route.continue(); });
    await page.keyboard.press('ArrowRight');
    await page.getByRole('status').filter({hasText:'正在加载题目'}).waitFor();
    assert.ok(Math.abs(await page.evaluate(() => scrollY) - beforeLoad) < 3, 'loading must retain scroll');
    release();
    await ready(page, 51);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '51');
    assert.ok(Math.abs(await page.evaluate(() => scrollY) - beforeLoad) < 3, 'loaded question must retain scroll');
    await page.unroute('**/question-content/*.json');

    await page.locator('[data-action="question-learning"]').click();
    await page.locator('#learning-panel').waitFor({state:'visible'});
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({top:350,behavior:'instant'}); });
    await switchQuestion(page, 'ArrowRight', 52, null);
    assert.equal(await page.locator('#learning-panel').getAttribute('data-question-id'), await page.locator('.question-main').getAttribute('data-question-id'));
    await page.keyboard.press('Escape');
    await page.locator('#learning-panel').waitFor({state:'hidden'});
    await page.goto(baseURL + '/#/exams');
    await page.getByRole('button', {name:'新建模拟考试'}).click();
    await page.locator('#exam-subject').selectOption('calculus');
    await page.locator('#exam-count').fill('5');
    await page.getByRole('button', {name:'开始考试'}).click();
    await ready(page, 0);
    await page.locator('.index-btn.current').evaluate(el => el.focus({preventScroll:true}));
    await page.evaluate(() => window.scrollTo({top:350,behavior:'instant'}));
    await switchQuestion(page, 'ArrowRight', 1);
    await switchQuestion(page, 'ArrowLeft', 0);
    report.push({width, continuousNavigation:true, navigationPages:true, delayedContent:true, learningPanel:true, exam:true});
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile('artifacts/keyboard-navigation-report.json', JSON.stringify(report, null, 2));
  console.log('Keyboard navigation passed:', JSON.stringify(report));
} finally { await browser.close(); }
