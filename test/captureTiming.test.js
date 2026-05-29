import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAudioTranscriptSegment,
  createCaptureChunkTimer,
  createCaptureClock,
} from '../src/offscreen/captureTiming.js';

test('createCaptureClock returns timestamps relative to capture start', () => {
  let currentTime = 1_779_999_000_000;
  const clock = createCaptureClock({ now: () => currentTime });

  assert.equal(clock.elapsedMs(), 0);

  currentTime += 1_250;
  assert.equal(clock.elapsedMs(), 1_250);

  currentTime += 2_750;
  assert.equal(clock.elapsedMs(), 4_000);
});

test('createCaptureClock clamps clock skew to zero', () => {
  let currentTime = 10_000;
  const clock = createCaptureClock({ now: () => currentTime });

  currentTime -= 500;

  assert.equal(clock.elapsedMs(), 0);
});

test('createCaptureChunkTimer returns contiguous chunk ranges', () => {
  let currentTime = 50_000;
  const timer = createCaptureChunkTimer({ now: () => currentTime });

  currentTime += 4_000;
  assert.deepEqual(timer.nextChunkTiming(), {
    startedAt: 0,
    endedAt: 4_000,
  });

  currentTime += 4_250;
  assert.deepEqual(timer.nextChunkTiming(), {
    startedAt: 4_000,
    endedAt: 8_250,
  });
});

test('createAudioTranscriptSegment uses chunk end time instead of transcription completion time', () => {
  assert.deepEqual(
    createAudioTranscriptSegment({
      sequence: 3,
      result: {
        text: 'Fallback audio transcript.',
        translatedText: '音频转写字幕。',
        language: 'en',
        isFinal: true,
      },
      startedAt: 1_000,
      endedAt: 4_000,
      completedAt: 9_000,
    }),
    {
      id: 'seg-3',
      text: 'Fallback audio transcript.',
      translatedText: '音频转写字幕。',
      language: 'en',
      isFinal: true,
      startedAt: 1_000,
      updatedAt: 4_000,
    },
  );
});
