import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readingSections, readingView } from "../dist/knowledge-reading.mjs";
import { emptyState, emptyBank, validateBackup, BACKUP_FORMAT } from "../dist/core.mjs";

const data = JSON.parse(await readFile("dist/data/knowledge.json", "utf8"));
const article = data.articles.find(a => a.title.startsWith("Codex"));
const revision = data.sources[article.sources[0].id].sha256;

test("chapter views partition the original HTML exactly once and include all subordinate headings", () => {
  for (const a of data.articles) {
    const sections = readingSections(a);
    if (!sections.length) continue;
    assert.equal(sections.map(s => s.html).join(""), a.html);
    assert.deepEqual(sections.flatMap(s => s.headings), a.headings);
    assert.equal(new Set(sections.map(s => s.id)).size, sections.length);
  }
  assert.ok(readingSections(article).length > 2);
  assert.deepEqual(readingSections({ ...article, minutes: 1 }), []);
});

test("saved chapters resume with matching source hashes; explicit links win and stale positions are ignored", () => {
  const chapter = readingSections(article)[2].id;
  const positions = { [article.id]: { chapter, anchor: chapter, offset: -100, revision } };
  assert.equal(readingView(article, data.sources, positions, new URLSearchParams()).chapter, chapter);
  assert.equal(readingView(article, data.sources, positions, new URLSearchParams({ chapter: "all" })).html, article.html);
  assert.equal(readingView(article, data.sources, positions, new URLSearchParams({ chapter: "missing" })).chapter, "all");
  positions[article.id].revision = "0".repeat(64);
  assert.equal(readingView(article, data.sources, positions, new URLSearchParams()).chapter, "all");
});

test("reading positions survive backups, old archives default empty, and corrupt offsets cannot replace progress", () => {
  const state = emptyState();
  state.knowledgePositions[article.id] = { chapter: "all", anchor: "knowledge-heading-2", offset: -110, revision };
  const backup = { format: BACKUP_FORMAT, bank: emptyBank(), state };
  assert.deepEqual(validateBackup(backup).state.knowledgePositions, state.knowledgePositions);
  for (const bad of [null, [], { x: {} }, { x: { ...state.knowledgePositions[article.id], offset: Infinity } },
    { x: { ...state.knowledgePositions[article.id], anchor: '<img src=x>' } },
    { x: { ...state.knowledgePositions[article.id], chapter: 'invalid' } }]) {
    assert.throws(() => validateBackup({ ...backup, state: { ...state, knowledgePositions: bad } }), /阅读位置/);
  }
  delete state.knowledgePositions;
  assert.deepEqual(validateBackup(backup).state.knowledgePositions, {});
});
