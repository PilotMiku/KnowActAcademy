import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, browserOptions, baseURL } from "./browser-helpers.mjs";

const data = JSON.parse(await readFile("dist/data/knowledge.json", "utf8"));
const article = data.articles.find(a => a.title.startsWith("Codex"));
const browser = await chromium.launch(browserOptions);
try {
  const context = await browser.newContext({ acceptDownloads: true, reducedMotion: "reduce",
    permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const ready = (chapter) => page.locator('[data-reading-ready="true"]' + (chapter ? `[data-reading-chapter="${chapter}"]` : "")).waitFor();
  const url = `${baseURL}/#/knowledge/${article.id}`;
  await page.goto(url);
  await ready();
  const code = await page.locator('.reading-content pre code').first().textContent();
  await page.locator('.code-copy').first().click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code);
  assert.ok(code.includes("\n"));

  const terminal = page.locator('[data-reading-section] option').filter({ hasText: "终端常用命令" });
  const chapter = await terminal.getAttribute("value");
  await page.locator('[data-reading-section]').selectOption(chapter);
  await page.waitForURL(new RegExp(`chapter=${chapter}`));
  await ready(chapter);
  assert.equal(await page.locator('[data-reading-section]').inputValue(), chapter);
  assert.equal(await page.locator('.reading-content h2').count(), 1);
  assert.match(await page.locator('.reading-content h2').textContent(), /终端常用命令/);
  assert.equal(await page.locator('.reading-content').getByText("官方资料与版本依据", { exact: true }).count(), 0);
  const nextLink = page.getByRole('link', { name: '下一章', exact: true });
  const nextURL = await nextLink.getAttribute('href');
  await nextLink.click();
  await page.waitForURL(baseURL + '/' + nextURL);
  await ready(new URLSearchParams(nextURL.split("?")[1]).get("chapter"));
  assert.match(await page.locator('.reading-content h2').textContent(), /会话内常用指令/);
  await page.getByRole('link', { name: '上一章', exact: true }).click();
  await page.waitForURL(new RegExp(`chapter=${chapter}`));
  await ready(chapter);

  await page.evaluate(() => {
    const body = document.querySelector('.reading-content');
    window.scrollTo({ top: scrollY + body.getBoundingClientRect().top + 700, behavior: 'instant' });
  });
  const scroll = await page.evaluate(() => scrollY);
  // Wait for the actual IndexedDB transaction, not an arbitrary timeout.
  const waitForSavedOffset = async expected => {
  let savedPosition;
  for (let retry = 0; retry < 100; retry++) {
    savedPosition = await page.evaluate(async id => {
      const { storageName } = await import('./assets.mjs');
      return new Promise(resolve => {
        const request = indexedDB.open(storageName, 1);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('kv');
          const value = tx.objectStore('kv').get('state');
          tx.oncomplete = () => { db.close(); resolve(value.result?.knowledgePositions?.[id]); };
        };
      });
    }, article.id);
    if (savedPosition?.chapter === chapter && savedPosition.anchor === chapter && Math.abs(savedPosition.offset - expected) < 5) break;
    await page.waitForTimeout(100);
  }
  assert.equal(savedPosition?.chapter, chapter);
  assert.equal(savedPosition?.anchor, chapter);
  assert.ok(Math.abs(savedPosition.offset - expected) < 5);
  };
  await waitForSavedOffset(700);
  await page.reload();
  await ready(chapter);
  assert.ok(Math.abs((await page.evaluate(() => scrollY)) - scroll) < 10, JSON.stringify(await page.evaluate(expected => ({ expected, actual: scrollY, anchor: [...document.querySelectorAll('.reading-content [id]')].map(h => [h.id, h.getBoundingClientRect().top]) }), scroll)));
  await page.evaluate(() => { location.hash = '#/knowledge'; });
  await page.locator('.knowledge-overview').waitFor();
  await page.goto(url);
  await ready();
  assert.equal(await page.locator('[data-reading-section]').inputValue(), chapter);
  assert.ok(Math.abs((await page.evaluate(() => scrollY)) - scroll) < 10, JSON.stringify(await page.evaluate(expected => ({ expected, actual: scrollY, anchor: [...document.querySelectorAll('.reading-content [id]')].map(h => [h.id, h.getBoundingClientRect().top]) }), scroll)));

  await page.evaluate(() => { location.hash = '#/library'; });
  await page.locator('[data-action="export-backup"]').waitFor();
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整备份', exact: false }).click();
  await (await exported).saveAs('artifacts/qa-reading-backup.json');
  const backup = JSON.parse(await readFile('artifacts/qa-reading-backup.json', 'utf8'));
  assert.equal(backup.state.knowledgePositions[article.id].chapter, chapter);
  await page.getByRole('button', { name: '清空学习记录', exact: false }).click();
  await page.locator('#dialog [data-action="confirm-dialog"]').click();
  await page.locator('.local-hero').waitFor();
  await page.goto(`${baseURL}/#/library`);
  await page.getByRole('button', { name: '恢复学习数据', exact: false }).click();
  await page.locator('#file-input').setInputFiles('artifacts/qa-reading-backup.json');
  await page.locator('#dialog [data-action="confirm-dialog"]').click();
  await page.locator('.local-hero').waitFor();
  await page.goto(url);
  await ready();
  assert.equal(await page.locator('[data-reading-section]').inputValue(), chapter);
  assert.ok(Math.abs((await page.evaluate(() => scrollY)) - scroll) < 10, JSON.stringify(await page.evaluate(expected => ({ expected, actual: scrollY, anchor: [...document.querySelectorAll('.reading-content [id]')].map(h => [h.id, h.getBoundingClientRect().top]) }), scroll)));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '切换明暗主题', exact: true }).click();
  await page.waitForFunction(() => document.body.classList.contains('dark'));
  await ready();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.evaluate(() => {
    const content = document.querySelector('.reading-content');
    window.scrollTo({ top: scrollY + content.getBoundingClientRect().top + 350, behavior: 'instant' });
  });
  const mobileScroll = await page.evaluate(() => scrollY);
  await waitForSavedOffset(350);
  await page.reload();
  await ready();
  assert.ok(Math.abs((await page.evaluate(() => scrollY)) - mobileScroll) < 10, JSON.stringify(await page.evaluate(expected => ({expected, actual: scrollY, paperTop: document.querySelector(".reading-paper").getBoundingClientRect().top, headings: [...document.querySelectorAll(".reading-content [id]")].map(h=>[h.id,h.getBoundingClientRect().top])}),mobileScroll)));
  await page.locator('.reading-chapters').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/reading-chapters-mobile-dark.png', animations: 'disabled' });
  await page.getByRole('link', { name: '查看全文', exact: true }).click();
  await page.waitForURL(/chapter=all/);
  await ready("all");
  assert.equal(await page.locator('.reading-content h2').count(), article.headings.filter(h => h.level === 2).length);
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
  await page.locator('.code-copy').first().click();
  assert.equal(await page.evaluate(() => getSelection().toString()), code);
  assert.deepEqual(errors, []);
  console.log('Reading browser checks passed: chapter navigation, exact clipboard contents, reload and return positions, full-backup recovery, mobile dark layout and clipboard fallback.');
} finally {
  await browser.close();
}
