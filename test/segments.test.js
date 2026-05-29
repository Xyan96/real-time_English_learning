import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearTranscriptHistory,
  getVisibleTranscriptSegments,
  mergeTranscriptSegment,
  trimTranscriptHistory,
} from '../src/shared/segments.js';

test('mergeTranscriptSegment replaces interim text for the same segment', () => {
  const initial = [
    {
      id: 'seg-1',
      text: 'Hello wor',
      translatedText: '',
      isFinal: false,
      startedAt: 100,
      updatedAt: 110,
    },
  ];

  const merged = mergeTranscriptSegment(initial, {
    id: 'seg-1',
    text: 'Hello world',
    translatedText: '你好，世界',
    isFinal: true,
    startedAt: 100,
    updatedAt: 140,
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, 'Hello world');
  assert.equal(merged[0].translatedText, '你好，世界');
  assert.equal(merged[0].isFinal, true);
});

test('mergeTranscriptSegment appends new segments in chronological order', () => {
  const merged = mergeTranscriptSegment(
    [
      {
        id: 'seg-1',
        text: 'First line',
        translatedText: '第一句',
        isFinal: true,
        startedAt: 200,
        updatedAt: 220,
      },
    ],
    {
      id: 'seg-2',
      text: 'Second line',
      translatedText: '第二句',
      isFinal: false,
      startedAt: 150,
      updatedAt: 180,
    },
  );

  assert.deepEqual(
    merged.map((segment) => segment.id),
    ['seg-2', 'seg-1'],
  );
});

test('trimTranscriptHistory keeps the newest entries', () => {
  const segments = Array.from({ length: 6 }, (_, index) => ({
    id: `seg-${index + 1}`,
    text: `Line ${index + 1}`,
    translatedText: '',
    isFinal: true,
    startedAt: index,
    updatedAt: index,
  }));

  const trimmed = trimTranscriptHistory(segments, 3);

  assert.deepEqual(
    trimmed.map((segment) => segment.id),
    ['seg-4', 'seg-5', 'seg-6'],
  );
});

test('trimTranscriptHistory keeps full history when maxSegments is unlimited', () => {
  const segments = Array.from({ length: 120 }, (_, index) => ({
    id: `seg-${index + 1}`,
    text: `Line ${index + 1}`,
    translatedText: '',
    isFinal: true,
    startedAt: index,
    updatedAt: index,
  }));

  const trimmed = trimTranscriptHistory(segments, Infinity);

  assert.equal(trimmed.length, 120);
  assert.equal(trimmed[0].id, 'seg-1');
  assert.equal(trimmed[119].id, 'seg-120');
});

test('getVisibleTranscriptSegments limits only the overlay display window', () => {
  const segments = Array.from({ length: 45 }, (_, index) => ({
    id: `seg-${index + 1}`,
    text: `Line ${index + 1}`,
    translatedText: '',
    isFinal: true,
    startedAt: index,
    updatedAt: index,
  }));

  const visible = getVisibleTranscriptSegments(segments, 5);

  assert.deepEqual(
    visible.map((segment) => segment.id),
    ['seg-41', 'seg-42', 'seg-43', 'seg-44', 'seg-45'],
  );
  assert.equal(segments.length, 45);
});

test('clearTranscriptHistory returns an empty transcript without mutating the original', () => {
  const segments = [
    {
      id: 'seg-1',
      text: 'Line 1',
      translatedText: '',
      isFinal: true,
      startedAt: 1,
      updatedAt: 2,
    },
  ];

  const cleared = clearTranscriptHistory(segments);

  assert.deepEqual(cleared, []);
  assert.equal(segments.length, 1);
});
