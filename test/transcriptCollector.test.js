import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearTranscriptInFrames,
  collectDiagnosticsFromFrames,
  collectLearningHistoryFromFrames,
  collectTranscriptFromFrames,
  mergeFrameDiagnostics,
  mergeFrameLearningHistory,
  mergeFrameSegments,
} from '../src/background/transcriptCollector.js';

test('mergeFrameSegments combines frame transcripts chronologically and removes duplicates', () => {
  const segments = mergeFrameSegments([
    {
      segments: [
        { id: 'b', startedAt: 2000, updatedAt: 3000, text: 'Second frame line.' },
      ],
    },
    {
      segments: [
        { id: 'a', startedAt: 1000, updatedAt: 1500, text: 'First frame line.' },
        { id: 'b', startedAt: 2000, updatedAt: 3000, text: 'Second frame line.' },
      ],
    },
  ]);

  assert.deepEqual(segments, [
    { id: 'a', startedAt: 1000, updatedAt: 1500, text: 'First frame line.' },
    { id: 'b', startedAt: 2000, updatedAt: 3000, text: 'Second frame line.' },
  ]);
});

test('mergeFrameSegments dedupes same subtitle text across frames and sources', () => {
  const segments = mergeFrameSegments([
    {
      segments: [
        { id: 'dom', startedAt: 1_099_000, updatedAt: 1_099_000, text: 'All right, ready our defenses!The Fire Nation could come any moment now.' },
      ],
    },
    {
      segments: [
        { id: 'track', startedAt: 1_099_050, updatedAt: 1_101_000, text: 'All right, ready our defenses! The Fire Nation could come any moment now.' },
      ],
    },
  ]);

  assert.deepEqual(segments, [
    {
      id: 'dom',
      startedAt: 1_099_000,
      updatedAt: 1_101_000,
      text: 'All right, ready our defenses! The Fire Nation could come any moment now.',
    },
  ]);
});

test('collectTranscriptFromFrames reads transcript snapshots from all frames', async () => {
  const calls = [];
  const chromeApi = {
    scripting: {
      executeScript: async (details) => {
        calls.push(details);
        return [
          { frameId: 0, result: { ok: true, segments: [] } },
          {
            frameId: 4,
            result: {
              ok: true,
              segments: [
                { id: 'iframe-caption', startedAt: 1250, updatedAt: 2750, text: 'Iframe subtitle.' },
              ],
            },
          },
        ];
      },
    },
  };

  const response = await collectTranscriptFromFrames(chromeApi, 7);

  assert.deepEqual(calls, [
    {
      target: { tabId: 7, allFrames: true },
      func: calls[0].func,
    },
  ]);
  assert.deepEqual(response.segments, [
    { id: 'iframe-caption', startedAt: 1250, updatedAt: 2750, text: 'Iframe subtitle.' },
  ]);
  assert.match(response.text, /Iframe subtitle/);
  assert.match(response.srt, /00:00:01,250 --> 00:00:02,750/);
});

test('mergeFrameDiagnostics combines subtitle evidence across frames', () => {
  const diagnostics = mergeFrameDiagnostics([
    {
      url: 'https://example.test/watch',
      status: 'idle',
      detail: 'Top frame',
      transcriptCount: 0,
      captureState: { ok: true, isCapturing: false },
      renderedSubtitles: { count: 0, samples: [] },
      subtitleResources: [],
      pageSubtitleResources: [],
      videos: [],
    },
    {
      url: 'https://example.test/player',
      status: 'site-subtitles',
      detail: 'Using subtitles already rendered by this page',
      transcriptCount: 1,
      captureState: { ok: true, isCapturing: false },
      renderedSubtitles: {
        count: 1,
        samples: [{ source: 'netflix-rendered-subtitle', text: 'Iframe subtitle.' }],
      },
      subtitleResources: ['https://cdn.example.test/subtitles/en.vtt'],
      pageSubtitleResources: [{ url: 'wss://example.test/live', cueCount: 1, cueSamples: ['Iframe subtitle.'] }],
      videos: [{ currentTime: 4.5, textTrackCount: 1, textTracks: [{ activeCueCount: 1 }] }],
    },
  ]);

  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.transcriptCount, 1);
  assert.equal(diagnostics.renderedSubtitles.count, 1);
  assert.deepEqual(diagnostics.subtitleResources, ['https://cdn.example.test/subtitles/en.vtt']);
  assert.equal(diagnostics.pageSubtitleResources.length, 1);
  assert.equal(diagnostics.videos.length, 1);
  assert.equal(diagnostics.status, 'site-subtitles');
});

test('collectDiagnosticsFromFrames reads diagnostics snapshots from all frames', async () => {
  const calls = [];
  const chromeApi = {
    scripting: {
      executeScript: async (details) => {
        calls.push(details);
        return [
          { frameId: 0, result: { ok: true, transcriptCount: 0, renderedSubtitles: { count: 0 } } },
          {
            frameId: 3,
            result: {
              ok: true,
              transcriptCount: 1,
              renderedSubtitles: { count: 1, samples: [{ source: 'rendered-subtitle', text: 'Frame line.' }] },
            },
          },
        ];
      },
    },
  };

  const response = await collectDiagnosticsFromFrames(chromeApi, 7);

  assert.deepEqual(calls, [
    {
      target: { tabId: 7, allFrames: true },
      func: calls[0].func,
    },
  ]);
  assert.equal(response.ok, true);
  assert.equal(response.transcriptCount, 1);
  assert.equal(response.renderedSubtitles.count, 1);
});

test('collectLearningHistoryFromFrames reads highlight history from all frames', async () => {
  const calls = [];
  const chromeApi = {
    scripting: {
      executeScript: async (details) => {
        calls.push(details);
        return [
          { frameId: 0, result: { ok: true, highlights: [], sourceUrl: 'https://example.test/watch', pageTitle: 'Top' } },
          {
            frameId: 4,
            result: {
              ok: true,
              sourceUrl: 'https://example.test/player',
              pageTitle: 'Player',
              highlights: [
                { startedAt: 2_000, order: 0, type: 'phrase', text: 'being raised', translation: '被养育', segmentText: 'being raised by monks' },
              ],
            },
          },
        ];
      },
    },
  };

  const response = await collectLearningHistoryFromFrames(chromeApi, 7);

  assert.deepEqual(calls, [
    {
      target: { tabId: 7, allFrames: true },
      func: calls[0].func,
    },
  ]);
  assert.equal(response.ok, true);
  assert.equal(response.sourceUrl, 'https://example.test/player');
  assert.deepEqual(response.highlights, [
    { startedAt: 2_000, order: 0, type: 'phrase', text: 'being raised', translation: '被养育', segmentText: 'being raised by monks', frameId: 4 },
  ]);
});

test('mergeFrameLearningHistory dedupes highlights across frames', () => {
  const response = mergeFrameLearningHistory([
    {
      frameId: 0,
      highlights: [
        { startedAt: 1_000, order: 0, type: 'word', text: 'warship', translation: '战舰', segmentText: 'A warship.' },
      ],
    },
    {
      frameId: 4,
      highlights: [
        { startedAt: 1_000, order: 0, type: 'word', text: 'warship', translation: '军舰', segmentText: 'A warship.' },
        { startedAt: 2_000, order: 0, type: 'phrase', text: 'being raised', translation: '被养育', segmentText: 'being raised by monks' },
      ],
    },
  ]);

  assert.deepEqual(response.highlights.map((item) => item.text), ['warship', 'being raised']);
});

test('collectDiagnosticsFromFrames includes per-frame subtitle evidence', async () => {
  const chromeApi = {
    scripting: {
      executeScript: async () => [
        {
          frameId: 0,
          result: {
            ok: true,
            url: 'https://example.test/watch',
            transcriptCount: 0,
            renderedSubtitles: { count: 0, samples: [] },
            domSubtitleResources: [],
            pageSubtitleResources: [],
            videos: [],
          },
        },
        {
          frameId: 4,
          result: {
            ok: true,
            url: 'https://example.test/player',
            transcriptCount: 1,
            renderedSubtitles: {
              count: 1,
              samples: [{ source: 'netflix-rendered-subtitle', text: 'Iframe subtitle.' }],
            },
            pageSubtitleResources: [
              { url: 'wss://example.test/live', cueCount: 1, cueSamples: ['Iframe subtitle.'] },
            ],
            domSubtitleResources: ['https://example.test/data-setup/en.vtt'],
            videos: [{ textTrackCount: 1, textTracks: [{ activeCueCount: 1 }] }],
          },
        },
      ],
    },
  };

  const response = await collectDiagnosticsFromFrames(chromeApi, 7);

  assert.deepEqual(response.frames, [
    {
      frameId: 0,
      url: 'https://example.test/watch',
      transcriptCount: 0,
      renderedSubtitleCount: 0,
      pageSubtitleResourceCount: 0,
      domSubtitleResourceCount: 0,
      textTrackCount: 0,
      activeCueCount: 0,
    },
    {
      frameId: 4,
      url: 'https://example.test/player',
      transcriptCount: 1,
      renderedSubtitleCount: 1,
      pageSubtitleResourceCount: 1,
      domSubtitleResourceCount: 1,
      textTrackCount: 1,
      activeCueCount: 1,
    },
  ]);
});

test('clearTranscriptInFrames clears every injected frame', async () => {
  const calls = [];
  const chromeApi = {
    scripting: {
      executeScript: async (details) => {
        calls.push(details);
        return [
          { frameId: 0, result: { ok: true } },
          { frameId: 3, result: { ok: true } },
        ];
      },
    },
  };

  const response = await clearTranscriptInFrames(chromeApi, 7);

  assert.deepEqual(calls, [
    {
      target: { tabId: 7, allFrames: true },
      func: calls[0].func,
    },
  ]);
  assert.deepEqual(response, { ok: true, clearedFrames: 2 });
});
