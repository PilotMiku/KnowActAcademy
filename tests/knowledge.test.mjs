import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  emptyState,
  emptyBank,
  validateBackup,
  BACKUP_FORMAT,
} from "../dist/core.mjs";
import {
  filterKnowledge,
  normalizeKnowledgeRecords,
} from "../dist/knowledge.mjs";

const data = JSON.parse(
  await readFile(
    new URL("../dist/data/knowledge.json", import.meta.url),
    "utf8",
  ),
);

test("knowledge search covers original note text, categories and independent favorites", () => {
  const state = emptyState();
  assert.equal(data.stats.notes, data.articles.filter(a => a.kind === "note").length);
  assert.equal(data.stats.pdfFiles, Object.values(data.sources).filter(s => s.type === "pdf").length);
  assert.equal(data.articles.length, data.stats.articles);
  assert.deepEqual(
    filterKnowledge(data, new URLSearchParams({ category: "章节笔记" }), state).map(a => a.id),
    data.articles.filter((a) => a.category === "章节笔记").map(a => a.id),
  );
  const article = data.articles.find((a) => a.title.includes("以人民为中心"));
  const query = new URLSearchParams({ q: "民心" });
  assert.ok(
    filterKnowledge(data, query, state).some((a) => a.id === article.id),
  );
  state.knowledgeFavorites = [article.id];
  assert.deepEqual(
    filterKnowledge(
      data,
      new URLSearchParams({ view: "favorites" }),
      state,
    ).map((a) => a.id),
    [article.id],
  );
  assert.deepEqual(state.favorites, []);
  assert.equal(
    filterKnowledge(data, new URLSearchParams({ category: "汇编资料" }), state)
      .length,
    data.articles.filter(a => a.category === "汇编资料").length,
  );
  assert.equal(
    filterKnowledge(
      data,
      new URLSearchParams({ q: "no-such-note-unique-test" }),
      state,
    ).length,
    0,
  );
});

test("knowledge progress survives current backups and old backups default to empty progress", () => {
  const state = emptyState();
  state.knowledgeRead = [data.articles[0].id];
  state.knowledgeFavorites = [data.articles[1].id];
  const restored = validateBackup({
    format: BACKUP_FORMAT,
    bank: emptyBank(),
    state,
  });
  assert.deepEqual(restored.state.knowledgeRead, state.knowledgeRead);
  assert.deepEqual(restored.state.knowledgeFavorites, state.knowledgeFavorites);
  delete state.knowledgeRead;
  delete state.knowledgeFavorites;
  const legacy = validateBackup({
    format: "shijie.backup.v1",
    bank: emptyBank(),
    state,
  });
  assert.deepEqual(legacy.state.knowledgeRead, []);
  assert.deepEqual(legacy.state.knowledgeFavorites, []);
  assert.deepEqual(
    normalizeKnowledgeRecords({
      knowledgeRead: ["a", "a", null],
      knowledgeFavorites: "invalid",
    }),
    { knowledgeRead: ["a"], knowledgeFavorites: [], knowledgeRecalled: [], knowledgeRecallDrafts: {}, knowledgePositions: {} },
  );
  state.knowledgeRead = "corrupt";
  assert.throws(
    () => validateBackup({ format: BACKUP_FORMAT, bank: emptyBank(), state }),
    /知识点学习记录/,
  );
});
