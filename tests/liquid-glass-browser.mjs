import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { webkit } from 'playwright';
import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';

const engines = [[chromium, browserOptions]];
if (existsSync(webkit.executablePath())) engines.push([webkit, { headless:true }]);

function channels(color) {
  return color.match(/[\d.]+/g).map(Number);
}
function luminance(rgb) {
  const linear = rgb.map(value => value / 255).map(value => value <= .04045
    ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
}
function contrast(foreground, background) {
  const tones = [luminance(channels(foreground)), luminance(background)].sort((a, b) => a - b);
  return (tones[1] + .05) / (tones[0] + .05);
}
function toolbarState(toolbar) {
  return toolbar.evaluate(el => {
    const style = getComputedStyle(el);
    const color = selector => getComputedStyle(el.querySelector(selector)).color;
    return {
      fill:style.backgroundColor,
      filter:style.backdropFilter || style.webkitBackdropFilter,
      mask:getComputedStyle(el, '::before').maskImage,
      text:color('.local-brand strong'),
      icon:color('.local-nav a > svg'),
    };
  });
}
function finishTransitions(control) {
  return control.evaluate(async el => {
    await new Promise(resolve => requestAnimationFrame(resolve));
    await Promise.all(el.getAnimations().map(animation => animation.finished));
  });
}

for (const [engine, options] of engines) {
  const browser = await engine.launch(options);
  try {
    const page = await browser.newPage({ viewport:{width:1440,height:900}, colorScheme:'light', reducedMotion:'no-preference' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith(baseURL + '/') && response.status() >= 400) errors.push(response.url());
    });
    await page.goto(baseURL + '/#/');
    await page.locator('.dashboard-heading').waitFor();
    const toolbar = page.locator('.local-header');
    const root = page.locator('html');
    const search = toolbar.locator('[data-action="search"]');

    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme:theme });
      await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, theme);
      await finishTransitions(toolbar);
      const resting = await toolbarState(toolbar);
      assert.ok(channels(resting.fill)[3] <= .45, 'the resting toolbar stays highly transparent');
      assert.match(resting.filter, /blur\(22px\).*saturate/);
      assert.notEqual(resting.mask, 'none');
      const selected = await toolbar.locator('[aria-current="page"]').evaluate(el => {
        const { color, backgroundColor } = getComputedStyle(el);
        return { color, backgroundColor };
      });
      assert.ok(contrast(selected.color, channels(selected.backgroundColor)) >= 4.5);
      const bounds = await toolbar.boundingBox();
      await page.evaluate(() => scrollTo(0, 280));
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-toolbar-scrolled'));
      await finishTransitions(toolbar);
      const scrolled = await toolbarState(toolbar);
      const [r,g,b,alpha] = channels(scrolled.fill);
      assert.ok(alpha > channels(resting.fill)[3] && alpha < .8);
      assert.deepEqual(await toolbar.boundingBox(), bounds);
      // Bound the composited contrast with a completely black or white backdrop.
      const backdrop = theme === 'light' ? 0 : 255;
      const composite = [r,g,b].map(value => value * alpha + backdrop * (1 - alpha));
      assert.ok(contrast(scrolled.text, composite) >= 4.5);
      assert.ok(contrast(scrolled.icon, composite) >= 3);
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-toolbar-scrolled'));
      await finishTransitions(toolbar);
      assert.equal((await toolbarState(toolbar)).fill, resting.fill);
    }

    const press = await search.boundingBox();
    await page.mouse.move(press.x + press.width / 2, press.y + press.height / 2);
    await page.mouse.down();
    await finishTransitions(search);
    assert.notEqual(await search.evaluate(el => getComputedStyle(el).transform), 'none');
    await page.mouse.move(1, 1);
    await page.mouse.up();
    await page.emulateMedia({ reducedMotion:'reduce' });
    await page.waitForFunction(() => document.documentElement.dataset.motion === 'reduced');
    assert.equal(await toolbar.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    await search.press('Enter');
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await dialog.evaluate(el => getComputedStyle(el).backdropFilter), 'none');
    await page.locator('#global-search').fill('函数');
    await page.locator('#search-results .search-item').first().waitFor();
    await dialog.getByRole('button', { name:'关闭', exact:true }).focus();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state:'hidden' });
    assert.equal(await search.evaluate(el => el.matches(':focus-visible')), true);

    for (const width of [1401,1321,1101,1024,768,390,320]) {
      await page.setViewportSize({ width,height:width === 320 ? 568 : 900 });
      assert.equal(await root.evaluate(el => el.scrollWidth), width);
      const header = await toolbar.boundingBox();
      assert.ok(header.x >= 8 && header.y >= 8 && header.x + header.width <= width - 8);
      for (const control of await toolbar.locator('.local-header-actions button:visible').all()) {
        const box = await control.boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44 && box.x + box.width < header.x + header.width);
      }
    }
    await page.goto(baseURL + '/#/practice?subject=calculus&chapter=s-6b82188494c1');
    await page.locator('[data-action="start-practice"][data-mode="sequential"]').click();
    const dock = page.locator('.question-actions');
    await dock.waitFor();
    assert.match(await dock.evaluate(el => getComputedStyle(el).backdropFilter), /blur/);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const footer = await page.locator('.footer').boundingBox();
    const dockBounds = await dock.boundingBox();
    assert.ok(footer.y + footer.height < dockBounds.y, 'the last controls clear the floating dock');
    await dock.locator('[data-action="next-question"]').click();
    await page.locator('.index-btn.current[data-index="1"]').waitFor();
    await page.setViewportSize({ width:1440,height:900 });
    assert.equal(await dock.evaluate(el => getComputedStyle(el).backdropFilter), 'none');

    await page.goto(baseURL + '/#/welcome');
    const shortcuts = page.locator('.welcome-footer');
    await shortcuts.waitFor();
    assert.match(await shortcuts.evaluate(el => getComputedStyle(el).backdropFilter), /blur\(18px\)/);
    await shortcuts.getByRole('link', { name:'知识复习' }).click();
    await page.waitForURL('**/#/knowledge');

    if (engine === chromium) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-transparency',value:'reduce'}] });
      assert.equal(await toolbar.evaluate(el => getComputedStyle(el).backdropFilter), 'none');
      assert.equal(channels((await toolbarState(toolbar)).fill).length, 3);
      await page.emulateMedia({ forcedColors:'active' });
      assert.equal(await toolbar.evaluate(el => getComputedStyle(el, '::before').display), 'none');
    }

    // Simulate a browser that rejects the enhancement, keeping the base material.
    await page.route('**/styles.css', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        '@supports (backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))',
        '@supports (not-a-css-property:1px)',
      );
      await route.fulfill({ response, body });
    });
    await page.emulateMedia({ colorScheme:'light', forcedColors:'none' });
    await page.reload();
    await toolbar.waitFor();
    const fallback = await toolbarState(toolbar);
    assert.equal(fallback.filter, 'none');
    assert.equal(channels(fallback.fill).length, 3);
    assert.deepEqual(errors, []);
    console.log(`Liquid Glass passed in ${engine.name()}: adaptive tint, layered rim, contrast, press, layout, dialog, and opaque fallbacks.`);
  } finally {
    await browser.close();
  }
}
