import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleSiteSubtitlesAvailable,
  normalizeCaptureMode,
  shouldStopCaptureForSiteSubtitles,
} from '../src/background/autoCaptureMode.js';

test('normalizeCaptureMode accepts only auto mode explicitly', () => {
  assert.equal(normalizeCaptureMode('auto'), 'auto');
  assert.equal(normalizeCaptureMode('manual'), 'manual');
  assert.equal(normalizeCaptureMode('anything-else'), 'manual');
  assert.equal(normalizeCaptureMode(undefined), 'manual');
});

test('shouldStopCaptureForSiteSubtitles stops matching captures when site subtitles appear', () => {
  assert.equal(shouldStopCaptureForSiteSubtitles({
    captureMode: 'auto',
    activeTabId: 7,
    senderTabId: 7,
  }), true);
  assert.equal(shouldStopCaptureForSiteSubtitles({
    captureMode: 'manual',
    activeTabId: 7,
    senderTabId: 7,
  }), true);
  assert.equal(shouldStopCaptureForSiteSubtitles({
    captureMode: 'auto',
    activeTabId: 7,
    senderTabId: 8,
  }), false);
});

test('handleSiteSubtitlesAvailable stops capture and reports site subtitle status', async () => {
  const calls = [];
  const result = await handleSiteSubtitlesAvailable({
    captureMode: 'auto',
    activeTabId: 7,
    senderTabId: 7,
    stopCapture: async (options) => calls.push(options),
  });

  assert.deepEqual(result, { stopped: true });
  assert.deepEqual(calls, [
    {
      status: 'site-subtitles',
      detail: '网页字幕已可用，音频兜底已停止。',
    },
  ]);
});

test('handleSiteSubtitlesAvailable stops manual capture when site subtitles are available', async () => {
  const calls = [];
  const result = await handleSiteSubtitlesAvailable({
    captureMode: 'manual',
    activeTabId: 7,
    senderTabId: 7,
    stopCapture: async (options) => calls.push(options),
  });

  assert.deepEqual(result, { stopped: true });
  assert.deepEqual(calls, [
    {
      status: 'site-subtitles',
      detail: '网页字幕已可用，音频兜底已停止。',
    },
  ]);
});
