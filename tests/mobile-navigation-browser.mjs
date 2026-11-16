import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { webkit } from 'playwright';
import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';

async function ready(page, index) {
  await page.waitForFunction(index => {
    const question = document.querySelector('.question-main');
    return question && document.querySelector('.index-btn.current')?.dataset.index === String(index) &&
      [...question.querySelectorAll('img')].every(image => !image.dataset.figureLoading && image.complete && image.naturalWidth > 0);
  }, index);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function swipe(page, name, selector, dx, dy = 0, {cancel = false, edge = false, multi = false} = {}) {
  const target = page.locator(selector).first();
  await target.evaluate(el => el.scrollIntoView({block:'center',behavior:'instant'}));
  const box = await target.boundingBox(), width = page.viewportSize().width;
  const x = edge ? 20 : dx < 0 ? width - 70 : 70, y = box.y + box.height / 2;
  const before = await page.evaluate(() => scrollY);
  if (name === 'chromium') {
    const client = await page.context().newCDPSession(page);
    const points = (x, y) => multi ? [{x,y,id:1},{x:x - 50,y:y + 10,id:2}] : [{x,y,id:1}];
    await client.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:points(x,y)});
    for (let step = 1; step <= 8; step++) {
      await client.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:points(x + dx * step / 8,y + dy * step / 8)});
      await page.waitForTimeout(20);
    }
    await client.send('Input.dispatchTouchEvent', {type:cancel ? 'touchCancel' : 'touchEnd',touchPoints:[]});
    await client.detach();
  } else {
    // Playwright exposes native WebKit taps but no drag API; also exercise its
    // DOM touch handlers. Chromium above covers trusted native swipe/pan events.
    await target.evaluate((el, {x,y,dx,dy,cancel,multi}) => {
      const send = (type, point, ended = false) => {
        const event = new Event(type, {bubbles:true,cancelable:true});
        const points = multi ? [point,{...point,identifier:2,clientX:point.clientX - 50,clientY:point.clientY + 10}] : [point];
        Object.defineProperties(event, {touches:{value:ended ? [] : points},changedTouches:{value:points}});
        el.dispatchEvent(event);
      };
      send('touchstart',{identifier:1,clientX:x,clientY:y});
      for (let step = 1; step <= 8; step++) send('touchmove',{identifier:1,clientX:x + dx * step / 8,clientY:y + dy * step / 8});
      send(cancel ? 'touchcancel' : 'touchend',{identifier:1,clientX:x + dx,clientY:y + dy},true);
    }, {x,y,dx,dy,cancel,multi});
  }
  return before;
}
async function unchanged(page, index) {
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.index-btn.current').getAttribute('data-index'), String(index));
}
const report = [], errors = [];
const engines = [['chromium', chromium, browserOptions]];
if (existsSync(webkit.executablePath())) engines.push(['webkit', webkit, {headless:true}]);
for (const [name, engine, options] of engines) {
  const browser = await engine.launch(options);
  try {
    for (const width of [390,320]) {
      const height = width === 320 ? 568 : 844;
      const page = await browser.newPage({viewport:{width,height}, isMobile:true, hasTouch:true, deviceScaleFactor:3});
      page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
      await page.goto(baseURL + '/#/practice?subject=calculus&chapter=s-6b82188494c1');
      await page.locator('[data-action="start-practice"][data-mode="sequential"]').tap();
      await ready(page, 0);
      await page.evaluate(() => window.scrollTo({top:350,behavior:'instant'}));
      for (const index of [1,2,3]) {
        const before = await page.evaluate(() => scrollY);
        const rect = await page.locator('[data-action="next-question"]').boundingBox();
        await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
        await ready(page, index);
        await page.waitForTimeout(400);
        assert.ok(Math.abs(await page.evaluate(() => scrollY) - before) < 3, 'tapping next must preserve the mobile viewport');
      }
      await page.evaluate(() => window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
      const beforeResize = await page.evaluate(() => scrollY);
      await page.locator('[data-action="next-question"]').tap();
      await ready(page, 4);
      // Toolbar changes can arrive after slow content/figure decoding or a pause
      // to read. They must not depend on a short wall-clock window after a tap.
      await page.waitForTimeout(1200);
      await page.setViewportSize({width,height:height + 120});
      await page.waitForTimeout(150);
      const afterResize = await page.evaluate(() => scrollY);
      assert.ok(Math.abs(afterResize - beforeResize) < 3, `${name} ${width}px toolbar/keyboard viewport expansion must not lift the question (${beforeResize} → ${afterResize})`);
      await page.evaluate(() => window.scrollTo({top:scrollY - 240,behavior:'instant'}));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const scrolledPosition = await page.evaluate(() => scrollY);
      await page.setViewportSize({width,height:height + 160});
      await page.waitForTimeout(150);
      assert.ok(Math.abs(await page.evaluate(() => scrollY) - scrolledPosition) < 3, 'a new reading position must not snap back on resize');
      await page.setViewportSize({width,height});
      await page.locator('.index-btn[data-index="0"]').evaluate(el => el.click());
      await ready(page, 0);
      const beforeSwipe = await swipe(page, name, '.question-main > .eyebrow', -150);
      await ready(page, 1);
      assert.ok(Math.abs(await page.evaluate(() => scrollY) - beforeSwipe) < 3, 'swipe preserves reading position');
      await swipe(page, name, '.question-main > .eyebrow', 150);
      await ready(page, 0);
      await swipe(page, name, '.question-main > .eyebrow', 150);
      await unchanged(page, 0);
      await swipe(page, name, '.question-main > .eyebrow', -30);
      await unchanged(page, 0);
      const beforeVertical = await swipe(page, name, '.question-main > .eyebrow', -15, -120);
      await unchanged(page, 0);
      if (name === 'chromium') assert.ok(await page.evaluate(() => scrollY) > beforeVertical + 30, 'vertical touch still scrolls the page');
      await swipe(page, name, '.question-main > .eyebrow', -150, 0, {cancel:true});
      await unchanged(page, 0);
      await swipe(page, name, '.question-main > .eyebrow', -100, 0, {multi:true});
      await unchanged(page, 0);
      await swipe(page, name, '.question-main > .eyebrow', 100, 0, {edge:true});
      await unchanged(page, 0);
      await swipe(page, name, '.option', -150);
      await ready(page, 1);
      const saved = await page.evaluate(async () => (await import('./storage.mjs')).readSavedState());
      assert.ok(!saved.practice.responses['s-6b82188494c1-q0001']?.answer, 'swiping over an option must not also select it');
      assert.equal(await page.locator('#dialog').evaluate(el => el.open), false);
      await page.locator('.option').first().tap();
      await page.locator('.option.selected').waitFor();
      await swipe(page, name, '.question-main > .eyebrow', 150);
      await ready(page, 0);
      await swipe(page, name, '.question-main > .eyebrow', -150);
      await ready(page, 1);
      assert.equal(await page.locator('.option.selected').count(), 1, 'normal taps and saved answers still work');

      // A genuinely overflowing formula keeps native horizontal panning.
      await page.locator('.question-title').evaluate(el => {
        const scroller = document.createElement('div'); scroller.id = 'mobile-formula-scroll';
        scroller.style.cssText = 'overflow-x:auto;width:100%;height:48px';
        scroller.innerHTML = '<div style="width:1000px;height:48px">长公式横向阅读测试</div>';
        el.append(scroller);
      });
      await swipe(page, name, '#mobile-formula-scroll', -150);
      await unchanged(page, 1);
      if (name === 'chromium') assert.ok(await page.locator('#mobile-formula-scroll').evaluate(el => el.scrollLeft) > 30);
      await page.locator('.question-notes').evaluate(el => { el.open = true; });
      await page.locator('[data-question-note]').fill('保留笔记');
      await swipe(page, name, '[data-question-note]', -150);
      await unchanged(page, 1);
      await page.locator('[data-question-note]').blur();
      await page.locator('[data-action="shortcut-help"]').evaluate(el => el.click());
      await swipe(page, name, '.question-main > .eyebrow', -150);
      await unchanged(page, 1);
      await page.locator('#dialog [data-action="close-dialog"]').first().tap();

      await page.locator('.index-btn[data-index="39"]').evaluate(el => el.click());
      await ready(page, 39);
      await swipe(page, name, '.question-main > .eyebrow', -150);
      await ready(page, 40);
      await swipe(page, name, '.question-main > .eyebrow', 150);
      await ready(page, 39);
      await page.locator('.nav-pages [data-index="40"]').evaluate(el => el.click());
      await ready(page, 40);
      await page.locator('.nav-pages [data-index="80"]').evaluate(el => el.click());
      await ready(page, 80);
      await page.locator('.index-btn[data-index="84"]').evaluate(el => el.click());
      await ready(page, 84);
      await swipe(page, name, '.question-main > .eyebrow', -150);
      await unchanged(page, 84);
      assert.equal(await page.locator('#dialog').evaluate(el => el.open), false, 'swiping past the end must not finish the session');
      await swipe(page, name, '.question-main > .eyebrow', 150);
      await ready(page, 83);
      await page.reload();
      await ready(page, 83);

      await page.goto(baseURL + '/#/exams');
      await page.getByRole('button', {name:'新建模拟考试'}).tap();
      await page.locator('#exam-subject').selectOption('calculus');
      await page.locator('#exam-count').fill('5');
      await page.getByRole('button', {name:'开始考试'}).tap();
      await ready(page, 0);
      await swipe(page, name, '.question-main > .question-top', -150);
      await ready(page, 1);
      await swipe(page, name, '.question-main > .question-top', 150);
      await ready(page, 0);
      report.push({engine:name,width,taps:true,viewportExpansion:true,delayedViewportExpansion:true,scrollTakeover:true,swipes:true,boundaries:true,nativeVerticalAndFormulaScroll:name === 'chromium',notesAndDialogs:true,exam:true});
      console.log('Mobile navigation passed:', JSON.stringify(report.at(-1)));
      await page.close();
    }
  } finally { await browser.close(); }
}
assert.deepEqual(errors, []);
await writeFile('artifacts/mobile-navigation-report.json', JSON.stringify(report, null, 2));
