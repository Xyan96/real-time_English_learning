import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchSubtitleTrack } from '../src/background/subtitleTrackFetcher.js';

test('fetchSubtitleTrack returns WebVTT text for http subtitle URLs', async () => {
  const result = await fetchSubtitleTrack('https://example.test/captions.vtt', async (url, options) => {
    assert.equal(url, 'https://example.test/captions.vtt');
    assert.deepEqual(options, { credentials: 'include' });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://cdn.example.test/final/captions.vtt',
      headers: new Map([
        ['content-type', 'text/vtt; charset=utf-8'],
      ]),
      text: async () => 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello.',
    };
  });

  assert.deepEqual(result, {
    ok: true,
    text: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello.',
    finalUrl: 'https://cdn.example.test/final/captions.vtt',
    status: 200,
    contentType: 'text/vtt; charset=utf-8',
    length: 44,
  });
});

test('fetchSubtitleTrack rejects unsupported URL schemes', async () => {
  const result = await fetchSubtitleTrack('file:///private/captions.vtt', async () => {
    throw new Error('should not fetch file URLs');
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /不支持的字幕 URL 协议/);
});

test('fetchSubtitleTrack reports non-2xx fetch failures', async () => {
  const result = await fetchSubtitleTrack('https://example.test/missing.vtt', async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    text: async () => '',
  }));

  assert.equal(result.ok, false);
  assert.match(result.error, /404/);
});
