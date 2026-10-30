import { chromium, browserOptions, baseURL } from './browser-helpers.mjs';
import assert from 'node:assert/strict';

const browser = await chromium.launch(browserOptions);
const errors = [];
async function assertBrand(page, theme) {
  await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, theme);
  const logo = page.locator('[data-theme-asset]:not(link)');
  await logo.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('img[data-theme-asset]')]
    .every(image => image.complete && image.naturalWidth === 512));
  assert.match(await logo.getAttribute('src'), new RegExp(`icon-${theme}\\.png$`));
  const assets = await page.locator('link[data-theme-asset]').evaluateAll(links => links.map(link => ({
    href: link.getAttribute('href'), expected: link.dataset[document.documentElement.dataset.theme === 'dark' ? 'darkSrc' : 'lightSrc'],
  })));
  assert.equal(assets.length, 3);
  for (const asset of assets) {
    assert.equal(asset.href, asset.expected);
    const response = await page.request.get(new URL(asset.href, page.url()).href);
    assert.equal(response.status(), 200, asset.href);
  }
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL + '/#/');
  await page.locator('.local-hero').waitFor();
  await assertBrand(page, 'light');
  assert.equal(await page.locator('.local-avatar').count(), 0);
  await page.screenshot({ path: 'artifacts/brand-header-light.png', fullPage: true, animations: 'disabled' });

  await page.getByRole('button', { name: '切换明暗主题' }).click();
  await assertBrand(page, 'dark');
  await page.screenshot({ path: 'artifacts/brand-header-dark.png', fullPage: true, animations: 'disabled' });
  await page.reload();
  await page.locator('.local-hero').waitFor();
  await assertBrand(page, 'dark');

  // A saved manual choice applies to the welcome logo and favicons before bank loading finishes.
  let releaseBank;
  const gate = new Promise(resolve => { releaseBank = resolve; });
  await page.route('**/data/bank.json', async route => { await gate; await route.continue(); });
  try {
    await page.goto(baseURL + '/#/welcome', { waitUntil: 'domcontentloaded' });
    await page.locator('.welcome-brand').waitFor();
    await assertBrand(page, 'dark');
  } finally {
    releaseBank();
    await page.unroute('**/data/bank.json');
  }
  await page.getByRole('link', { name: '进入学习', exact: true }).click();
  await page.locator('.local-hero').waitFor();

  await page.getByRole('button', { name: '学习显示设置', exact: true }).click();
  await page.locator('#display-theme').selectOption('light');
  await assertBrand(page, 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await assertBrand(page, 'light'); // Manual light overrides the operating system.
  await page.locator('#display-theme').selectOption('system');
  await assertBrand(page, 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await assertBrand(page, 'light');
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const controls = await page.locator('.local-header-actions > button:visible').evaluateAll(buttons => buttons.map(button => {
      const rect = button.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    }));
    for (let i = 1; i < controls.length; i++) assert.ok(controls[i].left >= controls[i - 1].right, `Toolbar overlap at ${width}px`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}px`);
  }
  await page.screenshot({ path: 'artifacts/brand-header-mobile.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '切换明暗主题' }).click();
  await assertBrand(page, 'dark');
  assert.deepEqual(errors, []);
  console.log('Brand themes passed: manual/system selection, first paint, refresh, welcome logo, favicon files, mobile toolbar and removed avatar.');
} finally {
  await browser.close();
}
