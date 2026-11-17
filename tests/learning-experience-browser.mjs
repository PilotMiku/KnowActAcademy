import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';

const browser = await chromium.launch(browserOptions), errors = [], report = {};
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL + '/');
  await page.locator('.welcome-enter').click();
  await page.locator('.learning-guide').waitFor();
  assert.equal(await page.locator('.guide-options a').count(), 3);
  await page.screenshot({ path: 'artifacts/learning-guide-mobile.png', animations: 'disabled' });
  await page.locator('[data-action="dismiss-guide"]').click();
  assert.equal(await page.locator('.learning-guide').count(), 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.local-hero').waitFor();
  await page.screenshot({ path: 'artifacts/dashboard-overview-desktop.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseURL + '/');
  await page.locator('.local-hero').waitFor();
  assert.equal(await page.locator('.welcome-shell').count(), 0);
  await page.locator('.dashboard-heading [data-action="open-guide"]').click();
  await page.locator('#dialog .guide-options a[href="#/prepare"]').click();
  await page.locator('.preparation-setup').waitFor();
  const launch = await page.locator('[data-action="begin-preparation"]').boundingBox();
  assert.ok(launch.y + launch.height <= 844, JSON.stringify(launch));
  assert.equal(await page.locator('#preparation-trends').count(), 0);
  report.onboarding = true;
  report.preparationStartTop = launch.y;
  await page.locator('[data-action="prepare-select-none"]').click();
  assert.equal(await page.locator('[data-action="begin-preparation"]').isDisabled(), true);
  const root = page.locator('.preparation-scope-group').first();
  const parent = root.locator('.preparation-root input');
  await root.locator('details > summary').click();
  const child = root.locator('.preparation-subchapter input').first();
  const childId = await child.inputValue();
  await child.check();
  assert.equal(await parent.evaluate(el => el.indeterminate), true);
  assert.match(await root.locator('.scope-selection').innerText(), /部分已选/);
  await page.reload();
  await page.locator('.preparation-scope-group').first().waitFor();
  assert.equal(await parent.evaluate(el => el.indeterminate), true);
  await parent.check();
  assert.equal(await child.isChecked(), true);
  assert.equal(await child.isDisabled(), true);
  await parent.uncheck();
  assert.equal(await child.isChecked(), false);
  assert.equal(await child.isEnabled(), true);
  await child.check();
  assert.deepEqual(await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1]).getAll('chapter')), [childId]);
  await page.locator('#prepare-subject').selectOption('linear');
  assert.equal(await page.locator('.preparation-root input:checked').count(), 7);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'artifacts/preparation-scope-mobile.png', animations: 'disabled' });
  report.hierarchicalScopes = true;

  await page.locator('.local-header-actions [data-action="display-settings"]').click();
  await page.locator('#display-motion').selectOption('reduced');
  await page.locator('#dialog [data-action="close-dialog"]').first().click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(baseURL + '/#/welcome');
  await page.locator('.welcome-shell').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-motion'), 'reduced');
  assert.equal(await page.locator('.welcome-sky').evaluate(el => el.getAnimations({ subtree: true }).length), 0);
  await page.goto(baseURL + '/#/library');
  await page.locator('.local-header-actions [data-action="display-settings"]').click();
  await page.locator('#display-motion').selectOption('system');
  await page.locator('#dialog [data-action="close-dialog"]').first().click();
  await page.goto(baseURL + '/#/welcome');
  await page.locator('.welcome-shell').waitFor();
  assert.ok(await page.locator('.welcome-sky').evaluate(el => el.getAnimations({ subtree: true }).length > 0));
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.locator('.welcome-sky').evaluate(el => el.getAnimations({ subtree: true }).every(a => a.playState === 'paused')), true);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  report.motion = true;

  await page.goto(baseURL + '/#/practice?subject=calculus&chapter=s-6b82188494c1');
  await page.locator('[data-action="practice-one"]').first().click();
  await page.locator('.question-main').waitFor();
  const actions = await page.locator('.question-actions').boundingBox();
  assert.ok(actions.y >= 0 && actions.y + actions.height <= 845, JSON.stringify(actions));
  assert.equal(await page.locator('.question-actions').evaluate(el => getComputedStyle(el).position), 'fixed');
  await page.locator('[data-action="answer-option"][data-value="B"]').click();
  await page.locator('[data-action="submit-answer"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('.result-label').filter({ hasText: '本次答对了' }).waitFor();
  await page.waitForFunction(() => document.querySelector('#answer-announcement').textContent.includes('本次答对了'));
  assert.equal(await page.locator('[data-action="next-question"]').evaluate(el => document.activeElement === el), true);
  assert.match(await page.locator('[data-save-message]').innerText(), /已保存/);
  await page.waitForFunction(() => {
    const r = document.querySelector('.result-box').getBoundingClientRect();
    return r.y < innerHeight - 100 && r.bottom > 75;
  });
  const result = await page.locator('.result-box').boundingBox();
  assert.ok(result.y < 844 && result.y + result.height > 0, JSON.stringify(result));
  await page.screenshot({ path: 'artifacts/answer-feedback-mobile.png', animations: 'disabled' });
  await page.goto(baseURL + '/');
  await page.locator('.question-main').waitFor();
  assert.match(await page.evaluate(() => location.hash), /practice\?session=1/);
  report.fixedActionsAndResume = true;
  report.accessibleFeedbackAndSaveStatus = true;

  await page.locator('.question-notes > summary').click();
  await page.locator('[data-question-note]').focus();
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 400 });
    visualViewport.dispatchEvent(new Event('resize'));
  });
  const keyboardActions = await page.locator('.question-actions').boundingBox();
  assert.ok(keyboardActions.y + keyboardActions.height <= 401, JSON.stringify(keyboardActions));
  await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')); document.activeElement.blur(); });
  report.keyboardAvoidance = true;
  await page.evaluate(() => {
    const clone = structuredClone;
    globalThis.structuredClone = (...args) => {
      globalThis.structuredClone = clone;
      throw new DOMException('临时保存失败', 'DataCloneError');
    };
  });
  await page.locator('[data-action="toggle-theme"]').click();
  await page.locator('[data-save-message]').filter({ hasText: '保存失败' }).waitFor();
  await page.locator('[data-action="retry-save"]').click();
  await page.locator('[data-save-message]').filter({ hasText: '已保存' }).waitFor();
  assert.equal(await page.locator('[data-action="retry-save"]').isHidden(), true);
  assert.equal((await page.evaluate(async () => (await import('./storage.mjs')).readSavedState())).attempts.length, 1);
  report.saveRetryPreservesProgress = true;

  await page.goto(baseURL + '/#/practice?subject=linear&chapter=linear-chapter-1&view=questions');
  const practiceButton = page.locator('[data-action="practice-one"]').nth(10);
  await practiceButton.scrollIntoViewIfNeeded();
  const questionId = await practiceButton.getAttribute('data-id');
  // Playwright may scroll again while waiting for an entrance animation before
  // clicking. Match the app's departure point, after that actionability scroll.
  await page.evaluate(() => {
    window.addEventListener('click', event => {
      const button = event.target.closest('[data-action="practice-one"]');
      window.practiceListDeparture = button ? { hash:location.hash, y:scrollY, questionId:button.dataset.id } : null;
    }, { capture:true, once:true });
  });
  await practiceButton.click();
  const departure = await page.evaluate(() => window.practiceListDeparture);
  assert.equal(departure?.questionId, questionId);
  await page.locator('.question-main').waitFor();
  await page.locator('[data-action="exit-practice"]').click();
  await page.locator('.practice-start').waitFor();
  try {
    await page.waitForFunction(y => Math.abs(scrollY - y) < 4, departure.y);
    await page.evaluate(async () => {
      await Promise.allSettled([document.fonts.ready, ...document.querySelector('.local-main').getAnimations({subtree:true})
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished)]);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.ok(await page.evaluate(y => Math.abs(scrollY - y) < 4, departure.y), 'the returned list stays at the departure point after layout settles');
  }
  catch(error) {
    console.log('Return scroll diagnostics:',JSON.stringify(await page.evaluate(departure=>({departure,current:scrollY,max:document.documentElement.scrollHeight-innerHeight,hash:location.hash,fonts:document.fonts.status,animations:document.querySelector('.local-main').getAnimations({subtree:true}).map(a=>({state:a.playState,timing:a.effect.getComputedTiming()}))}),departure)));
    await page.screenshot({path:'artifacts/return-scroll-failure.png',fullPage:true});
    throw error;
  }
  assert.equal(await page.locator('#subject-filter').inputValue(), 'linear');
  assert.equal(await page.locator('#chapter-filter').inputValue(), 'linear-chapter-1');
  assert.equal(await page.evaluate(() => location.hash), departure.hash);
  report.returnScroll = { departure:departure.y, restored:await page.evaluate(() => scrollY) };
  report.returnContext = true;
  for (const viewport of [{ width: 320, height: 568 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await page.goto(baseURL + '/#/prepare');
    await page.locator('.preparation-setup').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.local-header-actions [data-action="display-settings"]').click();
  await page.locator('#display-theme').selectOption('dark');
  await page.locator('#dialog [data-action="close-dialog"]').first().click();
  await page.screenshot({ path: 'artifacts/preparation-scope-mobile-dark.png', animations: 'disabled' });
  assert.deepEqual(errors, []);
  report.originalBankQuestions = JSON.parse(await readFile('dist/data/bank.json', 'utf8')).questions.length;
  await writeFile('artifacts/learning-experience-report.json', JSON.stringify(report, null, 2));
  console.log('Learning experience passed:', JSON.stringify(report));
} finally { await browser.close(); }
