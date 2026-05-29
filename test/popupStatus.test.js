import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDiagnosticsReport,
  formatDiagnosticsVerdict,
  formatDiagnosticsSummary,
  formatTranscriptCount,
  getInitialPopupStatus,
  getTranscriptStatus,
} from '../src/popup/popupStatus.js';

test('formatTranscriptCount handles empty transcripts', () => {
  assert.equal(formatTranscriptCount(0), '还没有收集到字幕。');
});

test('formatTranscriptCount handles singular and plural lines', () => {
  assert.equal(formatTranscriptCount(1), '已收集 1 行字幕。');
  assert.equal(formatTranscriptCount(12), '已收集 12 行字幕。');
});

test('getInitialPopupStatus explains site subtitle mode', () => {
  assert.equal(
    getInitialPopupStatus(),
    '会自动读取网页字幕，并实时高亮学习项。',
  );
});

test('getTranscriptStatus reports active tab transcript counts', () => {
  assert.equal(
    getTranscriptStatus({ ok: true, segments: [{ id: 'seg-1' }, { id: 'seg-2' }] }),
    '已收集 2 行字幕。',
  );
});

test('getTranscriptStatus reports missing content script state', () => {
  assert.equal(
    getTranscriptStatus({ ok: false, error: '当前标签页没有字幕浮窗。' }),
    '当前标签页没有字幕浮窗。',
  );
});

test('formatDiagnosticsSummary reports subtitle source counts for manual verification', () => {
  assert.equal(
    formatDiagnosticsSummary({
      ok: true,
      transcriptCount: 3,
      renderedSubtitles: {
        count: 2,
        samples: [
          { source: 'netflix-rendered-subtitle', text: 'Already visible caption.' },
        ],
      },
      pageSubtitleResources: [
        { url: 'https://stream.example.test/timedtext?id=1', cueCount: 12 },
        {
          url: 'https://stream.example.test/expired.dfxp',
          cueCount: 0,
          status: 403,
          error: 'Subtitle track request failed with 403 Forbidden',
        },
      ],
      subtitleResources: [
        'https://stream.example.test/texttracks/en.vtt',
        'https://stream.example.test/timedtext?id=1',
      ],
      domSubtitleResources: [
        'https://stream.example.test/data-setup/en.vtt',
      ],
      frames: [
        { frameId: 0, url: 'https://example.test/watch', renderedSubtitleCount: 0 },
        { frameId: 4, url: 'https://example.test/player', renderedSubtitleCount: 2 },
      ],
      videos: [
        {
          textTrackCount: 1,
          textTracks: [{ activeCueCount: 1 }],
        },
      ],
    }),
    '诊断信息已复制：3 行字幕, 2 个页面字幕节点, 2 个拦截到的字幕资源, 1 个失败的字幕资源, 2 个浏览器字幕资源, 1 个 DOM 字幕资源, 2 个 frame, 1 个视频, 1 条文本轨道, 1 条活跃字幕.',
  );
});

test('formatDiagnosticsSummary reports errors and empty pages clearly', () => {
  assert.equal(
    formatDiagnosticsSummary({ ok: false, error: '当前标签页没有字幕浮窗。' }),
    '当前标签页没有字幕浮窗。',
  );
  assert.equal(
    formatDiagnosticsSummary({ ok: true }),
    '诊断信息已复制：0 行字幕, 0 个页面字幕节点, 0 个拦截到的字幕资源, 0 个失败的字幕资源, 0 个浏览器字幕资源, 0 个 DOM 字幕资源, 0 个 frame, 0 个视频, 0 条文本轨道, 0 条活跃字幕.',
  );
});

test('formatDiagnosticsVerdict reports website subtitle evidence in popup-friendly text', () => {
  assert.equal(
    formatDiagnosticsVerdict({
      ok: true,
      transcriptCount: 2,
      renderedSubtitles: { count: 1, samples: [] },
      pageSubtitleResources: [{ url: 'https://example.test/timedtext', cueCount: 8 }],
      subtitleResources: [],
      domSubtitleResources: ['https://example.test/data-setup/en.vtt'],
      videos: [],
      frames: [],
    }),
    '已检测到网页字幕：2 行已收集字幕，1 个页面字幕节点，1 个带字幕片段的拦截资源，1 个 DOM 字幕资源。验证报告已复制。',
  );
});

test('formatDiagnosticsVerdict reports when website subtitles are not detected yet', () => {
  assert.equal(
    formatDiagnosticsVerdict({
      ok: true,
      transcriptCount: 0,
      renderedSubtitles: { count: 0, samples: [] },
      pageSubtitleResources: [],
      subtitleResources: [],
      domSubtitleResources: [],
      videos: [],
      frames: [],
    }),
    '尚未检测到网页字幕。音频兜底已移除；验证报告已复制。',
  );
});

test('buildDiagnosticsReport classifies website subtitle evidence for real-site verification', () => {
  const report = buildDiagnosticsReport({
    ok: true,
    url: 'https://www.netflix.com/watch/123',
    status: 'site-subtitles',
    detail: 'Using subtitles already rendered by this page',
    transcriptCount: 4,
    renderedSubtitles: {
      count: 1,
      samples: [{ source: 'netflix-rendered-subtitle', text: 'Visible Netflix line.' }],
    },
    pageSubtitleResources: [
      {
        url: 'https://example.test/timedtext?id=1',
        cueCount: 18,
        cueSamples: ['Network subtitle line.'],
        source: 'page-fetch',
      },
    ],
    subtitleResources: ['https://example.test/texttracks/en.vtt'],
    domSubtitleResources: ['https://example.test/data-setup/en.vtt'],
    frames: [
      {
        frameId: 0,
        url: 'https://www.netflix.com/watch/123',
        renderedSubtitleCount: 1,
        pageSubtitleResourceCount: 1,
        textTrackCount: 0,
        activeCueCount: 0,
      },
    ],
    videos: [
      {
        textTrackCount: 1,
        textTracks: [{ activeCueCount: 0, cueSamples: [] }],
      },
    ],
  }, new Date('2026-05-29T00:00:00.000Z'));

  assert.equal(report.generatedAt, '2026-05-29T00:00:00.000Z');
  assert.equal(report.url, 'https://www.netflix.com/watch/123');
  assert.equal(report.verdict.status, 'site-subtitles-detected');
  assert.deepEqual(report.verdict.evidence, [
    '4 行已收集字幕',
    '1 个页面字幕节点',
    '1 个带字幕片段的拦截资源',
    '1 个浏览器字幕资源',
    '1 个 DOM 字幕资源',
    '1 条文本轨道',
  ]);
  assert.equal(report.samples.renderedSubtitles[0].text, 'Visible Netflix line.');
  assert.equal(report.samples.pageSubtitleResources[0].cueSamples[0], 'Network subtitle line.');
  assert.deepEqual(report.samples.domSubtitleResources, ['https://example.test/data-setup/en.vtt']);
  assert.equal(report.raw.status, 'site-subtitles');
});

test('buildDiagnosticsReport reports when no website subtitles are visible yet', () => {
  const report = buildDiagnosticsReport({
    ok: true,
    url: 'https://example.test/watch',
    transcriptCount: 0,
    renderedSubtitles: { count: 0, samples: [] },
    pageSubtitleResources: [],
    subtitleResources: [],
    domSubtitleResources: [],
    videos: [],
    frames: [],
  }, new Date('2026-05-29T00:00:00.000Z'));

  assert.equal(report.verdict.status, 'no-site-subtitles-detected');
  assert.deepEqual(report.verdict.evidence, []);
});
