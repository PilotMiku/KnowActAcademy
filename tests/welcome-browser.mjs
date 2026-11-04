import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';
import { webkit } from 'playwright';
import assert from 'node:assert/strict';

const useWebKit = process.env.WELCOME_BROWSER_ENGINE === 'webkit';
const browser = await (useWebKit ? webkit.launch({ headless: true }) : chromium.launch(browserOptions)), errors = [];
let releaseBank;

// Sample a whole animation cycle, including the loop boundary. Static screenshots
// with animations disabled cannot catch a star repeatedly disappearing or flaring.
async function inspectStarMotion(page) {
  return page.evaluate(() => {
    const stars = [...document.querySelectorAll('.welcome-star,.welcome-constellation-node')]
      .filter(el => el.getBoundingClientRect().width > 0);
    return stars.map(star => {
      const animation = star.getAnimations()[0];
      const time = animation?.currentTime;
      const duration = animation ? Number(animation.effect.getTiming().duration) : 0;
      const samples = [];
      animation?.pause();
      for (let ms = 0; ms <= duration + 100; ms += 100) {
        if (animation) animation.currentTime = ms;
        samples.push(Number(getComputedStyle(star).opacity));
      }
      if (animation) { animation.currentTime = time; animation.play(); }
      const min = Math.min(...samples), max = Math.max(...samples);
      const jump = Math.max(...samples.slice(1).map((value, i) => Math.abs(value - samples[i]))) / max;
      return { className: star.getAttribute('class'), min, max, jump };
    });
  });
}

function assertCalmStars(stars, label) {
  assert.ok(stars.length > 30, `${label}: visible stars were sampled`);
  for (const star of stars) {
    assert.ok(star.min > 0 && star.max / star.min <= 2, `${label}: ${star.className} stays visible without bright flares (${star.min}–${star.max})`);
    assert.ok(star.jump <= .04, `${label}: ${star.className} changes brightness smoothly across frames and loop boundaries (${star.jump})`);
  }
}

async function assertCompleteOrbits(page, label) {
  const tracks = await page.locator('.welcome-orbit-track').evaluateAll(elements => {
    const sky = document.querySelector('.welcome-sky').getBoundingClientRect();
    return elements.map(track => {
      const matrix = track.getScreenCTM();
      const cx = track.cx.baseVal.value, cy = track.cy.baseVal.value;
      // Include the largest traveler's halo, also at the rotated ellipse extremes.
      const rx = track.rx.baseVal.value + 14, ry = track.ry.baseVal.value + 14;
      const contained = Array.from({ length: 120 }, (_, i) => {
        const angle = i * Math.PI / 60;
        const point = new DOMPoint(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)).matrixTransform(matrix);
        return point.x >= sky.left && point.x <= sky.right && point.y >= sky.top && point.y <= sky.bottom;
      }).every(Boolean);
      const animation = track.getAnimations()[0], time = animation?.currentTime;
      animation?.pause();
      const opacities = [0, .24, .48, .72, 1].map(progress => {
        if (animation) animation.currentTime = Number(animation.effect.getTiming().duration) * progress;
        return Number(getComputedStyle(track).opacity);
      });
      if (animation) { animation.currentTime = time; animation.play(); }
      return { contained, minOpacity: Math.min(...opacities), maxOpacity: Math.max(...opacities) };
    });
  });
  assert.equal(tracks.length, 3);
  for (const track of tracks) {
    assert.ok(track.contained, `${label}: complete orbit and traveler halo fit inside the sky`);
    assert.ok(track.minOpacity >= .14, `${label}: complete orbit stays visible throughout its pulse`);
    assert.ok(track.maxOpacity / track.minOpacity <= 2, `${label}: orbit brightness changes gently`);
  }
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  const bankGate = new Promise(resolve => { releaseBank = resolve; });
  await context.route('**/data/bank.json', async route => { await bankGate; await route.continue(); });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const requestedBank = page.waitForRequest('**/data/bank.json');
  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
  await requestedBank;
  await page.locator('.welcome-quote').waitFor();
  assert.equal(await page.locator('.welcome-quote h1').innerText(), '行是知之始\n知是行之成');
  assert.equal(await page.locator('.welcome-quote cite').innerText(), '陶行知');
  assert.equal(await page.locator('.welcome-constellation').count(), 5);
  assert.equal(await page.locator('.welcome-orbit-traveler').count(), 6);
  const skyMotion = await page.evaluate(() => {
    const dot = document.querySelector('.welcome-orbit-traveler');
    const animation = dot.getAnimations()[0];
    animation.pause();
    animation.currentTime = 0;
    const start = dot.getBoundingClientRect();
    animation.currentTime = 3000;
    const end = dot.getBoundingClientRect();
    animation.play();
    const track = document.querySelector('.welcome-orbit-track');
    const pulse = track.getAnimations()[0];
    pulse.pause();
    pulse.currentTime = 0;
    const dim = Number(getComputedStyle(track).opacity);
    pulse.currentTime = pulse.effect.getTiming().duration * .48;
    const bright = Number(getComputedStyle(track).opacity);
    pulse.play();
    const title = getComputedStyle(document.querySelector('.welcome-quote h1'));
    return { distance: Math.hypot(end.x - start.x, end.y - start.y), dim, bright, weight: Number(title.fontWeight), family: title.fontFamily, skyInteractive: getComputedStyle(document.querySelector('.welcome-sky')).pointerEvents };
  });
  assert.ok(skyMotion.distance > 10, 'Orbit lights travel along their paths');
  assert.ok(skyMotion.bright > skyMotion.dim * 1.25, 'Orbit tracks gently brighten and dim');
  assert.ok(skyMotion.weight >= 800);
  assert.ok(!/KaiTi|Kaiti|serif(?!-)/.test(skyMotion.family.replace('sans-serif', '')));
  assert.equal(skyMotion.skyInteractive, 'none');
  assertCalmStars(await inspectStarMotion(page), 'desktop');
  await assertCompleteOrbits(page, 'desktop');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'artifacts/welcome-desktop-light.png', fullPage: true, animations: 'disabled' });
  await page.locator('.skip').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
  assert.equal(await page.evaluate(() => location.hash), '');
  await page.getByRole('link', { name: '进入学习', exact: true }).focus();
  await page.evaluate(() => {
    window.addEventListener('click', () => {
      const shell = document.querySelector('.welcome-shell');
      window.entryMotion = { hash: location.hash, durations: shell.getAnimations().map(a => a.effect.getTiming().duration) };
    }, { once: true });
  });
  await page.keyboard.press('Enter');
  const entryMotion = await page.evaluate(() => window.entryMotion);
  assert.equal(entryMotion.hash, '');
  assert.ok(entryMotion.durations.some(duration => duration > 0 && duration <= 250));
  await page.getByRole('status').filter({ hasText: '正在准备学习空间' }).waitFor();
  releaseBank();
  await page.locator('.local-hero').waitFor();
  assert.equal(await page.evaluate(() => location.hash), '#/');
  await page.reload();
  await page.locator('.local-hero').waitFor();
  assert.equal(await page.locator('.welcome-shell').count(), 0);
  await page.goto(baseURL + '/#/practice?subject=calculus&chapter=s-6b82188494c1');
  await page.getByRole('button', { name: '顺序练习', exact: false }).click();
  await page.getByRole('button', { name: '收藏题目', exact: true }).click();
  await page.getByRole('button', { name: '取消收藏', exact: true }).waitFor();
  await page.getByRole('link', { name: '查看起始页', exact: true }).click();
  await page.locator('.welcome-shell').waitFor();
  const repeatedEntry = await page.evaluate(() => {
    const entry = document.querySelector('.welcome-enter'), shell = entry.closest('.welcome-shell');
    entry.click(); entry.click();
    return { hash: location.hash, animations: shell.getAnimations().length };
  });
  assert.equal(repeatedEntry.hash, '#/welcome');
  assert.equal(repeatedEntry.animations, 1);
  await page.locator('.local-hero').waitFor();
  await page.goto(baseURL + '/#/favorites');
  await page.locator('.collection-stem').waitFor();
  assert.equal(await page.locator('.collection-stem').count(), 1);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto(baseURL + '/#/welcome');
  await page.locator('.welcome-shell').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await page.locator('.welcome-main').evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await page.locator('.welcome-sky').evaluate(el => el.getAnimations({ subtree: true }).length), 0);
  await page.screenshot({ path: 'artifacts/welcome-desktop-dark.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'artifacts/welcome-mobile-dark.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 640 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'artifacts/welcome-mobile-light.png', fullPage: true });
  await page.getByRole('link', { name: '加权备考', exact: true }).click();
  await page.locator('#prepare-subject').waitFor();
  assert.equal(await page.locator('.welcome-shell').count(), 0);
  await page.goto(baseURL + '/#/welcome');
  await page.locator('.welcome-shell').waitFor();
  const reducedEntry = await page.evaluate(() => {
    const shell = document.querySelector('.welcome-shell');
    document.querySelector('.welcome-enter').click();
    return { hash: location.hash, animations: shell.getAnimations().length };
  });
  assert.deepEqual(reducedEntry, { hash: '#/', animations: 0 });
  await page.locator('.local-hero').waitFor();

  // Exercise actual motion on a touch device, in both orientations and themes.
  // The previous mobile coverage used reduced motion and missed the flicker.
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true, reducedMotion: 'no-preference',
  });
  const phone = await mobileContext.newPage();
  phone.on('pageerror', error => errors.push(error.message));
  await phone.goto(baseURL + '/#/welcome');
  await phone.locator('.welcome-quote').waitFor();
  for (const [orientation, viewport] of [
    ['small-portrait', { width: 320, height: 640 }],
    ['portrait', { width: 390, height: 844 }],
    ['large-portrait', { width: 430, height: 932 }],
    ['small-landscape', { width: 568, height: 320 }],
    ['landscape', { width: 844, height: 390 }],
  ]) {
    await phone.setViewportSize(viewport);
    for (const theme of ['light', 'dark']) {
      await phone.emulateMedia({ colorScheme: theme });
      await phone.waitForFunction(expected => document.documentElement.dataset.theme === expected, theme);
      assertCalmStars(await inspectStarMotion(phone), `${orientation} ${theme}`);
      const density = await phone.evaluate(() => {
        const visible = selector => [...document.querySelectorAll(selector)].filter(el => el.getBoundingClientRect().width > 0).length;
        return { stars: visible('.welcome-star'), nodes: visible('.welcome-constellation-node') };
      });
      assert.ok(density.stars <= 16 && density.nodes <= 18, `${orientation} ${theme}: phone sky has fewer scattered stars and constellation nodes`);
      await assertCompleteOrbits(phone, `${orientation} ${theme}`);
      const movement = await phone.locator('.welcome-constellation').first().evaluate(el => {
        const animation = el.getAnimations()[0], time = animation.currentTime;
        animation.pause(); animation.currentTime = 0;
        const start = el.getBoundingClientRect();
        animation.currentTime = 4000;
        const end = el.getBoundingClientRect();
        animation.currentTime = time; animation.play();
        return Math.hypot(end.x - start.x, end.y - start.y);
      });
      assert.ok(movement > 1, 'Math constellations still float and sway');
      assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await phone.screenshot({ path: `artifacts/welcome-mobile-motion-${orientation}-${theme}.png`, fullPage: true });
    }
  }
  await phone.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await phone.locator('.welcome-sky').evaluate(el => el.getAnimations({ subtree: true }).length), 0);
  await assertCompleteOrbits(phone, 'reduced motion');
  await mobileContext.close();
  assert.deepEqual(errors, []);
  console.log(`Welcome page passed (${useWebKit ? 'WebKit' : 'Chromium'}): slow loading, keyboard entry, deep links, saved favorites, light/dark, touch portrait/landscape motion cycles and reduced motion.`);
} finally {
  releaseBank?.();
  await browser.close();
}
