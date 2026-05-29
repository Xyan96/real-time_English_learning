import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasCapturedSiteSubtitleLine,
  hasUsableSiteSubtitleEvidence,
  waitForCapturedSiteSubtitles,
  waitForUsableSiteSubtitles,
} from '../src/popup/autoFallback.js';

test('hasUsableSiteSubtitleEvidence detects website subtitle sources', () => {
  assert.equal(hasUsableSiteSubtitleEvidence({ transcriptCount: 1 }), true);
  assert.equal(hasUsableSiteSubtitleEvidence({ renderedSubtitles: { count: 1 } }), true);
  assert.equal(hasUsableSiteSubtitleEvidence({ pageSubtitleResources: [{ cueCount: 3 }] }), true);
  assert.equal(hasUsableSiteSubtitleEvidence({ subtitleResources: ['https://cdn.example.test/en.vtt'] }), true);
  assert.equal(hasUsableSiteSubtitleEvidence({ domSubtitleResources: ['https://cdn.example.test/from-data-setup.vtt'] }), true);
  assert.equal(hasUsableSiteSubtitleEvidence({ videos: [{ textTracks: [{ activeCueCount: 1 }] }] }), true);
});

test('hasUsableSiteSubtitleEvidence ignores empty diagnostics', () => {
  assert.equal(hasUsableSiteSubtitleEvidence({
    transcriptCount: 0,
    renderedSubtitles: { count: 0 },
    pageSubtitleResources: [{ cueCount: 0 }],
    subtitleResources: [],
    domSubtitleResources: [],
    videos: [{ textTracks: [{ activeCueCount: 0 }] }],
  }), false);
});

test('hasCapturedSiteSubtitleLine requires collected transcript lines', () => {
  assert.equal(hasCapturedSiteSubtitleLine({ transcriptCount: 1 }), true);
  assert.equal(hasCapturedSiteSubtitleLine({ renderedSubtitles: { count: 1 } }), false);
  assert.equal(hasCapturedSiteSubtitleLine({ subtitleResources: ['https://cdn.example.test/en.vtt'] }), false);
});

test('waitForUsableSiteSubtitles polls until delayed website subtitles appear', async () => {
  const reads = [
    { ok: true, renderedSubtitles: { count: 0 }, subtitleResources: [], pageSubtitleResources: [] },
    { ok: true, renderedSubtitles: { count: 1 }, subtitleResources: [], pageSubtitleResources: [] },
  ];
  const waits = [];

  const result = await waitForUsableSiteSubtitles({
    readDiagnostics: async () => reads.shift(),
    wait: async (ms) => waits.push(ms),
    intervalMs: 250,
    maxAttempts: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(result.found, true);
  assert.equal(result.attempts, 2);
  assert.deepEqual(waits, [250]);
});

test('waitForUsableSiteSubtitles returns the last diagnostics when subtitles never appear', async () => {
  const result = await waitForUsableSiteSubtitles({
    readDiagnostics: async () => ({
      ok: true,
      renderedSubtitles: { count: 0 },
      subtitleResources: [],
      pageSubtitleResources: [],
    }),
    wait: async () => {},
    maxAttempts: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(result.found, false);
  assert.equal(result.attempts, 2);
  assert.equal(result.diagnostics.ok, true);
});

test('waitForCapturedSiteSubtitles waits until a subtitle line is collected', async () => {
  const reads = [
    { ok: true, transcriptCount: 0, renderedSubtitles: { count: 1 }, subtitleResources: [], pageSubtitleResources: [] },
    { ok: true, transcriptCount: 1, renderedSubtitles: { count: 1 }, subtitleResources: [], pageSubtitleResources: [] },
  ];
  const waits = [];

  const result = await waitForCapturedSiteSubtitles({
    readDiagnostics: async () => reads.shift(),
    wait: async (ms) => waits.push(ms),
    intervalMs: 250,
    maxAttempts: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(result.found, true);
  assert.equal(result.hasEvidence, true);
  assert.equal(result.attempts, 2);
  assert.deepEqual(waits, [250]);
});

test('waitForCapturedSiteSubtitles distinguishes evidence from collected lines', async () => {
  const result = await waitForCapturedSiteSubtitles({
    readDiagnostics: async () => ({
      ok: true,
      transcriptCount: 0,
      renderedSubtitles: { count: 1 },
      subtitleResources: [],
      pageSubtitleResources: [],
    }),
    wait: async () => {},
    maxAttempts: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(result.found, false);
  assert.equal(result.hasEvidence, true);
  assert.equal(result.attempts, 2);
});
