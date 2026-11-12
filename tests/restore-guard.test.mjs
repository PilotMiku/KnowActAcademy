import test from 'node:test';
import assert from 'node:assert/strict';
import { createRestoreGuard } from '../dist/restore-guard.mjs';
import { createSyncClient } from '../dist/sync.mjs';

test('cancelled and stale restores cannot replace progress or unlock a newer restore', () => {
  let version = 1;
  const guard = createRestoreGuard(() => ({ version }));
  const old = guard.start();
  guard.cancel();
  assert.equal(old.controller.signal.aborted, true);
  assert.throws(() => guard.assert(old), { name: 'AbortError' });
  const latest = guard.start();
  guard.finish(old);
  assert.equal(guard.pending, true);
  guard.assert(latest);
  version++;
  assert.throws(() => guard.assert(latest), /学习记录已变化/);
  guard.finish(latest);
  assert.equal(guard.pending, false);
});

test('aborting a restore read leaves the sync version unchanged even if transport ignores abort', async () => {
  let complete, count = 0;
  const client = createSyncClient(async () => {
    if (++count === 1) return Response.json({ version: 0, payload: null });
    return new Promise(resolve => { complete = resolve; });
  });
  await client.connect('https://example.com', 'a'.repeat(43));
  const controller = new AbortController(), pending = client.read({ signal: controller.signal });
  controller.abort();
  complete(Response.json({ version: 1, payload: { format: 'zhixing.progress.v1', bankRevision: 'pdf-abcd', state: {} } }));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(client.version, 0);
});
