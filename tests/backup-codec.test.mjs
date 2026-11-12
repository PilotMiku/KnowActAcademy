import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBackup } from '../dist/backup-codec.mjs';
import { normalizeBank, emptyState, validateBackup, BACKUP_FORMAT } from '../dist/core.mjs';
import { fixture } from './fixture.mjs';

test('compact backups retain exact custom source metadata, normalization and legacy compatibility', () => {
  const raw = structuredClone(fixture);
  raw.questions[0].customProvenance = { edition: 'original', note: '原始资料' };
  const bank = normalizeBank(raw), state = emptyState();
  const backup = createBackup(bank, state);
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(backup))).bank.questions, bank.questions);
  assert.deepEqual(validateBackup({ format: BACKUP_FORMAT, bank, state }).bank.questions, bank.questions);
  assert.throws(() => createBackup(bank, state, true), /自定义题库/);
});

test('bundled backups shrink while progress-only restores require the matching bank', () => {
  const bank = normalizeBank(JSON.parse(readFileSync(new URL('../dist/data/bank.json', import.meta.url))));
  const state = emptyState(); state.favorites.push(bank.questions[0].id);
  const full = createBackup(bank, state), light = createBackup(bank, state, true);
  assert.ok(Buffer.byteLength(JSON.stringify(full)) < 25000000);
  assert.ok(Buffer.byteLength(JSON.stringify(light)) < 2000);
  assert.equal(validateBackup(full).bank.questions.length, bank.questions.length);
  assert.deepEqual(validateBackup(light, bank).state, state);
  assert.throws(() => validateBackup(light, { ...bank, revision: 'pdf-0000' }), /版本不一致/);
  assert.throws(() => validateBackup(light), /版本不一致/);
});
