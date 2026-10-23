import test from 'node:test';
import assert from 'node:assert/strict';
import { apiEndpoint, createSyncClient, PROGRESS_FORMAT } from '../dist/sync.mjs';

test('sync endpoint accepts HTTPS and loopback, rejects credentials and mixed content', () => {
  assert.equal(apiEndpoint('https://api.example.com/api/'), 'https://api.example.com/api');
  assert.equal(apiEndpoint('http://127.0.0.1:8000'), 'http://127.0.0.1:8000');
  for (const input of ['http://example.com', 'javascript:alert(1)', 'https://key@host', 'https://host?token=x', 'https://host/#key']) {
    assert.throws(() => apiEndpoint(input));
  }
});

test('connection is read-only; upload uses CAS; conflict never retries or overwrites', async () => {
  const calls = [];
  const responses = [
    { version: 0, payload: null },
    { version: 1, updatedAt: 1 },
    { error: '版本冲突' },
  ];
  const client = createSyncClient(async (url, options) => {
    calls.push({ url, ...options });
    return new Response(JSON.stringify(responses.shift()), { status: calls.length === 3 ? 409 : 200 });
  });
  const token = 'a'.repeat(43);
  await client.connect('https://api.example.com', token);
  assert.equal(calls[0].method, undefined);
  assert.equal(calls[0].credentials, 'omit');
  assert.equal(calls[0].redirect, 'error');
  await client.upload({ format: PROGRESS_FORMAT, bankRevision: 'pdf-abcd', state: {} });
  assert.equal(calls[1].headers['If-Match'], '0');
  await assert.rejects(client.upload({}), /版本冲突/);
  assert.equal(client.version, 1);
  assert.equal(calls.length, 3);
  client.disconnect();
  assert.equal(client.connected, false);
  await assert.rejects(client.read(), /请先连接/);
});

test('malformed server data and invalid keys never establish a connection', async () => {
  let requests = 0;
  const client = createSyncClient(async () => {
    requests++;
    return new Response(JSON.stringify({ version: -1, payload: null }));
  });
  await assert.rejects(client.connect('https://api.example.com', 'short'), /格式/);
  assert.equal(requests, 0);
  await assert.rejects(client.connect('https://api.example.com', 'a'.repeat(43)), /格式/);
  assert.equal(client.connected, false);
});

test('concurrent sync actions cannot mutate the same session', async () => {
  let finish;
  const client = createSyncClient(() => new Promise(resolve => { finish = resolve; }));
  const first = client.connect('https://api.example.com', 'a'.repeat(43));
  await assert.rejects(client.connect('https://other.example.com', 'b'.repeat(43)), /正在进行/);
  assert.throws(() => client.disconnect(), /正在进行/);
  finish(new Response(JSON.stringify({ version: 0, payload: null })));
  await first;
});
