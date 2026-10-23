import test from 'node:test';
import assert from 'node:assert/strict';
import { questionImageURL } from '../dist/assets.mjs';

test('original bank paths work at both Pages root and repository subpaths', () => {
  const original = '/api/question-image/s-abc-q0001/option-B/0.webp?v=pdf-123';
  for (const prefix of ['/', '/study/', '/%E7%9F%A5%E8%A1%8C/']) {
    assert.equal(questionImageURL(original, new URL('https://example.github.io' + prefix)),
      'https://example.github.io' + prefix + 'question-images/s-abc-q0001/option-B/0.webp?v=pdf-123');
  }
});

test('custom imported image URLs keep their original meaning', () => {
  assert.equal(questionImageURL('https://images.example.com/x.png', new URL('https://host/repo/')),
    'https://images.example.com/x.png');
  assert.equal(questionImageURL('./assets/example.png', new URL('https://host/repo/')),
    'https://host/repo/assets/example.png');
});
