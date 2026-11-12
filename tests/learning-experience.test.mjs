import test from 'node:test';
import assert from 'node:assert/strict';
import { resumeRoute } from '../dist/learning-guide.mjs';
import { changeScope, descendants } from '../dist/preparation-scope.mjs';
import { normalizeStudySettings } from '../dist/preferences.mjs';

test('entry resumes ordinary practice, preparation and live exams without reviving expired exams', () => {
  const state = { exams: [], practice: null, preparation: null };
  assert.equal(resumeRoute(state, 100), '/');
  state.practice = { questionIds: ['q'] };
  assert.equal(resumeRoute(state, 100), '/practice?session=1');
  state.preparation = { id: 'p' }; state.practice.preparationId = 'p';
  assert.equal(resumeRoute(state, 100), '/prepare?session=1');
  state.exams = [{ id: 'expired', status: 'active', endsAt: 99 }, { id: 'live', status: 'active', endsAt: 101 }];
  assert.equal(resumeRoute(state, 100), '/exam/live');
  state.exams[1].status = 'submitted';
  assert.equal(resumeRoute(state, 100), '/prepare?session=1');
});

test('selecting a chapter replaces overlapping descendants while leaving other ranges intact', () => {
  const chapters = [{ id: 'a' }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }, { id: 'd' }];
  assert.deepEqual([...descendants(chapters, 'a')].sort(), ['b', 'c']);
  assert.deepEqual(changeScope(chapters, ['b', 'c', 'd'], 'a', true), ['d', 'a']);
  assert.deepEqual(changeScope(chapters, ['a', 'd'], 'a', false), ['d']);
  assert.deepEqual(changeScope(chapters, [], 'c', true), ['c']);
});

test('motion preferences survive normalization and old backups use the system preference', () => {
  assert.equal(normalizeStudySettings({ motion: 'reduced' }).motion, 'reduced');
  assert.equal(normalizeStudySettings({ motion: 'invalid' }).motion, 'system');
  assert.equal(normalizeStudySettings({ fontSize: 'large' }).motion, 'system');
});
