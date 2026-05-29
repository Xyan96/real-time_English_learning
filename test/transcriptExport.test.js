import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatTranscriptAsSrt,
  formatTranscriptAsText,
  segmentTimestampToSrtTime,
} from '../src/shared/transcriptExport.js';

const segments = [
  {
    id: 'seg-1',
    text: 'How can we use computers?',
    translatedText: '我们如何使用电脑？',
    isFinal: true,
    startedAt: 1_200,
    updatedAt: 3_700,
  },
  {
    id: 'seg-2',
    text: 'The generation before us had no computers.',
    translatedText: '',
    isFinal: true,
    startedAt: 4_000,
    updatedAt: 7_500,
  },
];

test('segmentTimestampToSrtTime formats milliseconds for subtitles', () => {
  assert.equal(segmentTimestampToSrtTime(3_723_045), '01:02:03,045');
});

test('formatTranscriptAsText includes timestamps and translations', () => {
  assert.equal(
    formatTranscriptAsText(segments),
    [
      '[00:01] How can we use computers?',
      '我们如何使用电脑？',
      '',
      '[00:04] The generation before us had no computers.',
    ].join('\n'),
  );
});

test('formatTranscriptAsSrt exports numbered subtitle blocks', () => {
  assert.equal(
    formatTranscriptAsSrt(segments),
    [
      '1',
      '00:00:01,200 --> 00:00:03,700',
      'How can we use computers?',
      '我们如何使用电脑？',
      '',
      '2',
      '00:00:04,000 --> 00:00:07,500',
      'The generation before us had no computers.',
    ].join('\n'),
  );
});
