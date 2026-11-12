import test from 'node:test';
import assert from 'node:assert/strict';
import { readinessForecast } from '../dist/forecast.mjs';

test('repeating twenty questions cannot predict a large course or substitute for untouched sections', () => {
  const pool = Array.from({ length: 1000 }, (_, i) => ({ id: 'q'+i, subjectId: 'math', chapterId: 'section'+(i%10), type: 'single' }));
  const mastery = new Map(pool.slice(0,20).map(q => [q.id, { trialCount: 100 }]));
  const state = { exams: [] };
  const small = readinessForecast(pool, mastery, state, { startedAt: 0 }, 52.8);
  assert.equal(small.estimatedScore, null);
  assert.equal(small.requiredCoverage, 100);
  assert.equal(small.sampleCoverage, 2);
  const unbalanced = new Map(pool.filter(q => q.chapterId === 'section0').map(q => [q.id, { trialCount: 2 }]));
  assert.equal(readinessForecast(pool, unbalanced, state, { startedAt: 0 }, 60).estimatedScore, null);
  const balanced = new Map(pool.slice(0,100).map(q => [q.id, { trialCount: 2 }]));
  const enough = readinessForecast(pool, balanced, state, { startedAt: 0 }, 60);
  assert.equal(enough.estimatedScore, 60);
  assert.equal(enough.qualifiedSections, 10);
});
