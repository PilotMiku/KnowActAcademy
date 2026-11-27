import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';

const browser = await chromium.launch(browserOptions), errors = [], report = {};
try {
  const page = await browser.newPage({ viewport:{ width:1440, height:1000 }, reducedMotion:'reduce', acceptDownloads:true });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL + '/#/favorites');
  await page.locator('.local-main').waitFor();
  const seeded = await page.evaluate(async () => {
    const storage = await import('./storage.mjs');
    const { getBankIndex } = await import('./core.mjs');
    const { bank, state } = await storage.readSavedData();
    const index = getBankIndex(bank);
    const groups = ['chapter-1', 'chapter-2'].map((id, i) => {
      const pool = index.chapterQuestions.get('calculus').get(id);
      return { name: index.chapters.get('calculus').get(id).name, questions: [...pool.slice(0, 17 - i), pool.at(-1)] };
    });
    const questions = groups.flatMap(group => group.questions);
    state.favorites = questions.map(q => q.id);
    state.mistakes = Object.fromEntries(questions.map((q, i) => [q.id,{ wrongCount:1 + i % 3, resolved:false }]));
    await storage.saveStorage(bank,state);
    return groups.map(group => ({
      name: group.name,
      questions: group.questions.map(q => ({ id:q.id, label:q.sourceLabel }))
        .sort((a, b) => state.mistakes[b.id].wrongCount - state.mistakes[a.id].wrongCount),
    }));
  });
  await page.reload();
  for (const mode of ['favorites','review']) {
    await page.goto(baseURL + '/#/' + mode);
    const first = page.locator('[data-collection-selected]').first();
    await first.waitFor();
    const chapterCards = page.locator('.review-chapter');
    if (mode === 'review') {
      await page.locator('#collection-sort').selectOption('wrong');
      await page.locator('#collection-sort option[value="wrong"][selected]').waitFor({state:'attached'});
      assert.deepEqual(await chapterCards.locator('h2').allTextContents(), seeded.map(group => group.name));
      for (const [i, count] of [18, 12].entries()) {
        const card = chapterCards.nth(i);
        assert.match(await card.locator('header').innerText(), new RegExp(`高等数学.*${seeded[i].questions.length} 道错题`, 's'));
        assert.deepEqual(await card.locator('[data-collection-selected]').evaluateAll(inputs => inputs.map(input => input.value)),
          seeded[i].questions.slice(0, count).map(q => q.id));
      }
    } else assert.equal(await chapterCards.count(), 0);
    await first.evaluate(el => { window.originalSelection = el; window.originalExcerpt = document.querySelector('.question-excerpt'); });
    await first.focus();
    await first.press('Space');
    assert.equal(await first.evaluate(el => document.activeElement === el && el === window.originalSelection && document.querySelector('.question-excerpt') === window.originalExcerpt),true);
    assert.equal(await first.isChecked(),true);
    await first.press('Space');
    assert.equal(await first.isChecked(),false);
    assert.equal(await page.locator('[data-action="practice-selected"]').isDisabled(),true);
    const select = page.locator('[data-action="select-collection-page"]');
    await select.click();
    assert.equal(await select.evaluate(el => document.activeElement === el),true);
    assert.equal(await page.locator('[data-collection-selected]:checked').count(),30);
    await page.getByRole('link',{ name:'下一页', exact:true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-collection-selected]').length === 5);
    if (mode === 'review') {
      assert.deepEqual(await chapterCards.locator('h2').allTextContents(), [seeded[1].name]);
      const current = page.locator('[data-collection-selected]');
      assert.deepEqual(await current.evaluateAll(inputs => inputs.map(input => input.value)), seeded[1].questions.slice(12).map(q => q.id));
      assert.match(await chapterCards.locator('header').innerText(), /17 道错题/);
    }
    await page.locator('[data-collection-selection-count]').filter({ hasText:'30' }).waitFor();
    await page.locator('[data-collection-selected]').first().check();
    assert.match(await page.locator('[data-collection-selection-count]').innerText(),/31 题/);
    await page.locator('[data-filter="subject"]').selectOption('linear');
    await page.locator('[data-collection-selection-count]').filter({ hasText:/已选 0 题/ }).waitFor();
    assert.equal(await page.locator('[data-action="practice-selected"]').isDisabled(),true);
    await page.locator('[data-filter="subject"]').selectOption('calculus');
    await page.locator('[data-collection-selection-count]').filter({ hasText:'31' }).waitFor();
    await page.locator('[data-action="clear-collection-selection"]').click();
    assert.equal(await page.locator('[data-collection-selected]:checked').count(),0);
    await page.locator('[data-collection-selected]').first().check();
    await page.locator('[data-action="practice-selected"]').click();
    await page.locator('.question-main').waitFor();
    const state = await page.evaluate(async () => (await import('./storage.mjs')).readSavedState());
    assert.equal(state.practice.questionIds.length,1);
  }
  await page.goto(baseURL + '/#/review?sort=wrong&page=2');
  await page.locator('[data-action="clear-collection-selection"]').click();
  await page.setViewportSize({ width:390, height:844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const expectedPage = seeded[1].questions.slice(12);
  const printed = page.waitForEvent('download');
  await page.locator('[data-action="print-collection"]').click();
  const html = await readFile(await (await printed).path(), 'utf8');
  assert.deepEqual(await page.evaluate(markup => [...new DOMParser().parseFromString(markup, 'text/html').querySelectorAll('main h2')].map(el => el.textContent), html),
    expectedPage.map((q, i) => `${i + 1}. ${q.label || q.id}`));
  await page.getByRole('button', { name:'开始复习', exact:true }).click();
  await page.locator('.question-main').waitFor();
  const review = await page.evaluate(async () => (await import('./storage.mjs')).readSavedState());
  assert.deepEqual(review.practice.questionIds, expectedPage.map(q => q.id));
  report.reviewGroupedByChapter = true;
  report.selectionKeepsFocusAndContent = true;
  report.crossPageAndFilteredSelections = true;

  await page.setViewportSize({ width:390, height:300 });
  await page.goto(baseURL + '/#/practice');
  const toggle = page.locator('[data-action="toggle-menu"]'), nav = page.locator('#primary-navigation');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-controls'),'primary-navigation');
  assert.equal(await toggle.getAttribute('aria-label'),'收起导航');
  assert.equal(await nav.evaluate(el => el.getBoundingClientRect().bottom <= innerHeight && el.scrollHeight > el.clientHeight),true);
  await nav.getByRole('link',{ name:'题库管理', exact:true }).focus();
  await page.keyboard.press('Escape');
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  assert.equal(await toggle.evaluate(el => document.activeElement === el),true);
  assert.equal(await nav.evaluate(el => el.inert),true);
  await toggle.press('ArrowDown');
  assert.equal(await nav.locator('a').first().evaluate(el => el === document.activeElement),true);
  await page.mouse.click(5,299);
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  await toggle.click();
  await nav.getByRole('link',{ name:'数据备份', exact:true }).click();
  await page.locator('.backup-overview').first().waitFor();
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  await toggle.click();
  await page.locator('[data-action="search"]').focus();
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  await toggle.click();
  await page.setViewportSize({ width:1440, height:1000 });
  await page.waitForFunction(() => !document.querySelector('#primary-navigation').inert);
  await page.setViewportSize({ width:390, height:844 });
  await page.waitForFunction(() => document.querySelector('[data-action="toggle-menu"]').getAttribute('aria-expanded') === 'false');
  await toggle.click();
  await page.screenshot({ path:'artifacts/mobile-navigation-menu.png', animations:'disabled' });
  report.mobileMenuEscapeOutsideFocusAndResize = true;
  await page.emulateMedia({ reducedMotion:'no-preference' });
  await page.waitForFunction(() => document.documentElement.dataset.motion === 'full');
  await page.evaluate(() => {
    const toggle = document.querySelector('[data-action="toggle-menu"]');
    toggle.click(); toggle.click();
  });
  await page.waitForTimeout(180);
  assert.equal(await nav.isVisible(),true);
  assert.equal(await nav.evaluate(el => el.inert),false);
  await page.keyboard.press('Escape');
  await nav.waitFor({ state:'hidden' });
  for (const width of [1050,1100]) {
    await page.setViewportSize({ width, height:500 });
    await toggle.click();
    await nav.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {}))));
    assert.equal(await nav.evaluate(el => Math.abs(el.getBoundingClientRect().top - document.querySelector('.local-header').getBoundingClientRect().bottom) < 2),true);
    await page.keyboard.press('Escape');
    await nav.waitFor({ state:'hidden' });
  }
  report.menuAnimationAndTabletWidths = true;
  assert.deepEqual(errors,[]);
  await writeFile('artifacts/collection-navigation-report.json',JSON.stringify(report,null,2));
  console.log('Collection and navigation checks passed:',JSON.stringify(report));
} finally { await browser.close(); }
