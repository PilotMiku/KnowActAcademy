import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';
import { fixture } from './fixture.mjs';

async function current(page, index) {
  await page.waitForFunction(index => document.querySelector('.question-main') &&
    document.querySelector('.index-btn.current')?.dataset.index === String(index), index);
}
async function jump(page, number) {
  await page.locator('[name="questionNumber"]').fill(String(number));
  await page.locator('[name="questionNumber"]').press('Enter');
  await current(page, number - 1);
}

const browser = await chromium.launch(browserOptions), report = {}, errors = [];
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL + '/#/practice?subject=calculus&chapter=s-6b82188494c1');
  await page.locator('[data-action="start-practice"][data-mode="sequential"]').click();
  await page.locator('.question-main').waitFor();
  await page.locator('[data-action="question-learning"]').click();
  await page.locator('#learning-panel').waitFor({state:'visible'});
  await page.locator('[data-action="shortcut-help"]').click();
  await page.keyboard.press('Escape');
  report.escapeClosesTopDialog = await page.locator('#dialog').evaluate(el => !el.open);
  assert.equal(await page.locator('#learning-panel').isVisible(), true, 'Escape leaves the panel behind the dialog open');
  await page.locator('[data-action="question-learning"]').click();
  await page.locator('#learning-panel').waitFor({state:'visible'});
  await page.evaluate(() => {
    document.querySelector('[data-action="close-learning"]').click();
    document.querySelector('[data-action="next-question"]').click();
  });
  await page.waitForFunction(() => document.querySelector('.index-btn.current')?.dataset.index === '1');
  await page.waitForTimeout(250);
  report.closingPanelStaysClosed = await page.locator('#learning-panel').isHidden();
  assert.equal(report.escapeClosesTopDialog, true, 'Escape closes the top dialog before the learning panel');
  assert.equal(report.closingPanelStaysClosed, true, 'a quick question change must not reopen a closing panel');
  await page.locator('[name="questionNumber"]').fill('41');
  await page.evaluate(() => window.scrollTo({top:350,behavior:'instant'}));
  const beforeJump = await page.evaluate(() => scrollY);
  await page.locator('[name="questionNumber"]').press('Enter');
  await current(page, 40);
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - beforeJump) < 3);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.index), '40');
  for (const invalid of ['0','9999','1.5']) {
    await page.locator('[name="questionNumber"]').fill(invalid);
    await page.locator('[name="questionNumber"]').press('Enter');
    assert.equal(await page.locator('[data-question-jump]').evaluate(el => el.checkValidity()), false);
    assert.equal(await page.locator('.index-btn.current').getAttribute('data-index'), '40');
  }
  await jump(page, 85);
  await page.locator('[data-action="next-pending-question"]').click();
  await current(page, 0);
  const beforeGrading = Number((await page.locator('[data-pending-count]').innerText()).match(/\d+/)[0]);
  await page.locator('.option[data-value="B"]').click();
  await page.locator('[data-action="submit-answer"]').click();
  await page.locator('.result-box').waitFor();
  assert.equal(Number((await page.locator('[data-pending-count]').innerText()).match(/\d+/)[0]), beforeGrading - 1);
  await page.locator('[data-action="next-pending-question"]').click();
  await current(page, 1);
  report.jumpValidationAndPendingNavigation = true;
  await page.waitForFunction(() => [...document.querySelectorAll('.question-main img')].every(image => !image.dataset.figureLoading && image.complete && image.naturalWidth > 0));
  await page.keyboard.press('Escape');
  await page.evaluate(() => {document.activeElement?.blur();window.scrollTo({top:0,behavior:'instant'});});
  await page.screenshot({path:'artifacts/navigation-tools-desktop.png',animations:'disabled'});
  for (const width of [768,390,320]) {
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const nav = document.querySelector('.question-nav');
    window.scrollTo({top:scrollY + nav.getBoundingClientRect().top - 85,behavior:'instant'});
  });
  await page.screenshot({path:'artifacts/navigation-tools-mobile.png',animations:'disabled'});

  // Audit the principal entry pages at desktop and small phone widths.
  report.pageLayouts = [];
  for (const width of [1440,320]) {
    await page.setViewportSize({width,height:1000});
    for (const route of ['welcome','', 'practice','prepare','calendar','knowledge','stats','data','offline']) {
      await page.goto(baseURL + '/#/' + route);
      await page.locator('#app h1').first().waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${route} overflows at ${width}`);
      report.pageLayouts.push({route:route || 'dashboard',width});
    }
  }
  await page.close();

  const custom = await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
  custom.on('pageerror', error => errors.push(error.message));
  await custom.goto(baseURL + '/#/library');
  await custom.locator('#file-input').setInputFiles({name:'review-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({
    ...fixture, questions:[fixture.questions[0],fixture.questions[1],fixture.questions[4],
      {...fixture.questions[0],id:'qa-reference',answerVerified:false}],
  }))});
  await custom.locator('[data-action="confirm-import"]').click();
  await custom.locator('.local-hero').waitFor();
  await custom.goto(baseURL + '/#/practice');
  await custom.locator('[data-action="start-practice"][data-mode="sequential"]').click();
  await current(custom, 0);
  assert.match(await custom.locator('[data-pending-count]').innerText(), /3/);
  await custom.locator('.option[data-value="B"]').click();
  await custom.locator('[data-action="submit-answer"]').click();
  await custom.locator('.result-box').waitFor();
  await custom.locator('[data-action="next-pending-question"]').click();
  await current(custom, 1);
  for (const value of ['A','B']) await custom.locator(`.option[data-value="${value}"]`).click();
  await custom.locator('[data-action="submit-answer"]').click();
  await custom.locator('.result-box').waitFor();
  await custom.locator('[data-action="next-pending-question"]').click();
  await current(custom, 2);
  await custom.locator('[data-action="submit-answer"]').click();
  await custom.locator('[data-action="self-grade"]').first().waitFor();
  assert.match(await custom.locator('[data-pending-count]').innerText(), /1/);
  await custom.locator('[data-action="self-grade"][data-correct="true"]').click();
  await custom.waitForFunction(() => document.querySelector('[data-pending-count]')?.textContent.includes('0'));
  assert.equal(await custom.locator('[data-action="next-pending-question"]').isDisabled(), true);
  assert.equal(await custom.locator('.question-main').evaluate(el => el.getAnimations({subtree:true}).length), 0);
  report.selfGradingAndReferenceExclusion = true;
  await custom.goto(baseURL + '/#/exams');
  await custom.locator('[data-action="create-exam"]').first().click();
  await custom.locator('#exam-count').fill('2');
  await custom.locator('[data-action="begin-exam"]').click();
  await current(custom, 0);
  await custom.locator('.option').first().click();
  await custom.waitForFunction(() => document.querySelector('[data-pending-count]')?.textContent.includes('1'));
  await custom.locator('[data-action="next-pending-question"]').click();
  await current(custom, 1);
  await custom.locator('.option').first().click();
  await custom.waitForFunction(() => document.querySelector('[data-pending-count]')?.textContent.includes('0'));
  assert.equal(await custom.locator('[data-action="next-pending-question"]').isDisabled(), true);
  report.examPendingUpdatesWithoutRerender = true;
  await custom.close();

  const context = await browser.newContext({viewport:{width:390,height:844}}), offline = await context.newPage();
  offline.on('pageerror', error => errors.push(error.message));
  await offline.goto(baseURL + '/#/offline');
  await offline.locator('#offline-chapter').selectOption('calculus:s-00ec8d743d0b');
  let release, blocked, timeout;
  const gate = new Promise(resolve => {release = resolve;}), seen = new Promise(resolve => {blocked = resolve;});
  await context.route('**/question-content/*.json', async route => {blocked(); await gate; await route.continue();});
  try {
    await offline.locator('[data-action="offline-download"]').click();
    await Promise.race([seen,new Promise((_,reject) => {timeout = setTimeout(() => reject(new Error('download never reached content')),30000);})]);
    clearTimeout(timeout);
    await offline.waitForFunction(() => document.querySelector('#offline-progress progress')?.value > 0);
    const before = await offline.locator('#offline-progress progress').evaluate(el => el.value);
    await offline.goto(baseURL + '/#/');
    await offline.locator('.daily-tasks').waitFor();
    await offline.goto(baseURL + '/#/offline');
    await offline.locator('#offline-progress:not([hidden])').waitFor();
    assert.ok(await offline.locator('#offline-progress progress').evaluate(el => el.value) >= before, 'returning to downloads must retain progress');
    assert.match(await offline.locator('#offline-progress-label').innerText(), /%/);
    release();
    await offline.locator('.offline-package').waitFor({timeout:60000});
    report.offlineProgressSurvivesNavigation = true;
  } finally {clearTimeout(timeout); release(); await context.close();}
  assert.deepEqual(errors, []);
  await writeFile('artifacts/usability-review-report.json', JSON.stringify(report,null,2));
  console.log('Usability review passed:', JSON.stringify(report));
} finally { await browser.close(); }
