import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSubtitleFingerprint,
  compactRepeatedSubtitleText,
  mergeDedupedSegments,
  normalizeSubtitleForDedup,
} from '../src/shared/subtitleDedup.js';

test('normalizeSubtitleForDedup removes Netflix repeated text and spacing noise', () => {
  assert.equal(
    normalizeSubtitleForDedup('All right, ready our defenses!The Fire Nation could come any moment now.'),
    'all right ready our defenses the fire nation could come any moment now',
  );
  assert.equal(
    compactRepeatedSubtitleText('All right, ready our defenses! The Fire Nation could come any moment now. All right, ready our defenses! The Fire Nation could come any moment now.'),
    'All right, ready our defenses! The Fire Nation could come any moment now.',
  );
});

test('buildSubtitleFingerprint keeps repeated lines separate when timestamps are far apart', () => {
  assert.equal(
    buildSubtitleFingerprint({ text: 'Yes.', startedAt: 2_000, updatedAt: 4_000 }),
    buildSubtitleFingerprint({ text: ' yes ', startedAt: 2_300, updatedAt: 4_200 }),
  );
  assert.notEqual(
    buildSubtitleFingerprint({ text: 'Yes.', startedAt: 2_000, updatedAt: 4_000 }),
    buildSubtitleFingerprint({ text: 'Yes.', startedAt: 8_000, updatedAt: 10_000 }),
  );
});

test('mergeDedupedSegments updates incremental subtitle growth instead of appending', () => {
  const merged = mergeDedupedSegments([
    { id: 'a', text: 'All right, ready our defenses!', startedAt: 18_100, updatedAt: 18_100 },
    { id: 'b', text: 'All right, ready our defenses! The Fire Nation could come any moment now.', startedAt: 18_250, updatedAt: 18_250 },
    { id: 'c', text: 'All right, ready our defenses!The Fire Nation could come any moment now.', startedAt: 18_450, updatedAt: 18_450 },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'a');
  assert.equal(merged[0].text, 'All right, ready our defenses! The Fire Nation could come any moment now.');
  assert.equal(merged[0].updatedAt, 18_450);
});
