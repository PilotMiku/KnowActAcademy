import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, normalizeBank, validateBackup, BACKUP_FORMAT } from "../dist/core.mjs";
import { updateQuestionNote, getQuestionNote } from "../dist/question-notes.mjs";
import { fixture } from "./fixture.mjs";

test("personal notes and mistake reasons survive backups independently of the question bank", () => {
  const bank = normalizeBank(fixture), state = emptyState(), before = JSON.stringify(bank), id = bank.questions[0].id;
  updateQuestionNote(state, id, { text: "先核对定义，再检查符号。", reasons: ["concept", "calculation"] }, 1000);
  const restored = validateBackup(JSON.parse(JSON.stringify({ format: BACKUP_FORMAT, bank, state })));
  assert.deepEqual(restored.state.questionNotes, state.questionNotes);
  assert.equal(JSON.stringify(bank), before);
  updateQuestionNote(state, id, { text: "", reasons: [] });
  assert.equal(Object.keys(state.questionNotes).length, 0);
  delete state.questionNotes;
  assert.deepEqual(validateBackup({ format: BACKUP_FORMAT, bank, state }).state.questionNotes, {});
  assert.equal(getQuestionNote(state, "toString"), undefined);
  updateQuestionNote(state, "toString", { text: "自定义题号", reasons: [] });
  assert.equal(getQuestionNote(state, "toString").text, "自定义题号");
});

test("corrupt or unrelated personal notes cannot replace learning records", () => {
  const bank = normalizeBank(fixture), id = bank.questions[0].id;
  for (const questionNotes of [{ missing: { text: "", reasons: [], updatedAt: 1 } },
    { [id]: { text: "", reasons: ["unknown"], updatedAt: 1 } },
    { [id]: { text: "x".repeat(10001), reasons: [], updatedAt: 1 } },
    { [id]: { text: "", reasons: [], updatedAt: "bad" } }])
    assert.throws(() => validateBackup({ format: BACKUP_FORMAT, bank, state: { ...emptyState(), questionNotes } }));
});
