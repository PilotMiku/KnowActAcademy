import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, browserOptions, baseURL } from "./browser-helpers.mjs";

const data = JSON.parse(await readFile("dist/data/knowledge.json", "utf8"));
const materials = JSON.parse(await readFile("data/study-materials.json", "utf8")).materials;
const browser = await chromium.launch(browserOptions);
try {
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${baseURL}/#/knowledge?group=${encodeURIComponent("category:开发工具")}`);
  await page.locator(".knowledge-overview").waitFor();
  assert.equal(await page.locator(".knowledge-card").count(), materials.filter(m => m.category === "开发工具").length);
  assert.match(await page.locator(".page-head").textContent(), /开发工具/);
  for (const material of materials) {
    const source = Object.values(data.sources).find(s => s.path === material.path);
    const article = data.articles.find(a => a.sources[0].id === source.id);
    // Search a phrase from the actual body, independently of the title.
    const needle = article.searchText.slice(90, 100);
    await page.goto(`${baseURL}/#/knowledge?q=${encodeURIComponent(needle)}`);
    const card = page.locator(`.knowledge-title[href="#/knowledge/${article.id}"]`);
    await card.waitFor();
    await card.click();
    await page.locator(".reading-content").waitFor();
    assert.equal(await page.locator(".reading-paper h1").textContent(), article.title);
    const original = await page.request.get(`${baseURL}/knowledge-source/${source.id}.${source.type}`);
    assert.equal(original.status(), 200);
    assert.deepEqual(await original.body(), await readFile(source.path));
    assert.equal(await page.locator(".reading-toc button").count(), article.headings.length);
    if (source.type === "docx") {
      assert.equal(await page.locator(".reading-content table").count(), (article.html.match(/<table>/g) || []).length);
      assert.ok(await page.locator(".reading-content a").count() > 0);
    }
    const downloadPromise = page.waitForEvent("download");
    await page.locator(".source-links a[download]").click();
    assert.equal((await downloadPromise).suggestedFilename(), source.name);
    await page.getByRole("button", { name: "标为已读", exact: false }).click();
    await page.getByRole("button", { name: "标为未读", exact: false }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "标为未读", exact: false }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), material.path);
    if (source.name.startsWith("Codex")) {
      assert.ok((await page.locator(".reading-content pre code").first().textContent()).includes("\n"));
      await page.screenshot({ path: "artifacts/materials-mobile.png", fullPage: false });
    }
    await page.setViewportSize({ width: 1440, height: 1050 });
  }
  assert.deepEqual(errors, []);
  console.log(`Study materials browser checks passed: ${materials.length} original files, search, categories, downloads, read progress and mobile layout.`);
} finally {
  await browser.close();
}
