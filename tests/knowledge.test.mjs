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
  knowledgeGroups,
  knowledgeGroupId,
} from "../dist/knowledge.mjs";

const data = JSON.parse(
  await readFile(
    new URL("../dist/data/knowledge.json", import.meta.url),
    "utf8",
  ),
);

test("learning material groups separate Xigai from guides without changing article identities", () => {
  const groups = knowledgeGroups(data);
  assert.equal(groups[0].name, "习概资料");
  assert.equal(groups[0].id, "xigai");
  const grouped = groups.flatMap(g => g.articles);
  assert.equal(new Set(grouped.map(a => a.id)).size, data.articles.length);
  assert.deepEqual(new Set(grouped), new Set(data.articles));
  assert.deepEqual(new Set(groups[0].articles.map(a => a.category)), new Set(["章节笔记", "专题提纲", "汇编资料"]));
  assert.ok(groups.find(g => g.name === "开发工具").articles.some(a => a.title.startsWith("Codex")));
  const generic = { id: "generic", category: "章节笔记", sources: [{ id: "other" }] };
  assert.equal(knowledgeGroupId({ sources: { other: { path: "question-bank/其他/notes.md" } } }, generic), "category:章节笔记");
});

test("group searches and favorites stay in their selected directory while global searches cover all materials", () => {
  const state = emptyState();
  const note = data.articles.find(a => a.title.includes("以人民为中心"));
  const guide = data.articles.find(a => a.title.startsWith("Codex"));
  state.knowledgeFavorites = [note.id, guide.id];
  assert.deepEqual(filterKnowledge(data, new URLSearchParams({ group: "xigai", view: "favorites" }), state).map(a => a.id), [note.id]);
  assert.equal(filterKnowledge(data, new URLSearchParams({ group: "xigai", q: "Codex" }), state).length, 0);
  assert.ok(filterKnowledge(data, new URLSearchParams({ q: "Codex" }), state).some(a => a.id === guide.id));
  assert.equal(filterKnowledge(data, new URLSearchParams({ group: "missing" }), state).length, 0);
});

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
