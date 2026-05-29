import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  buildAttachReadinessReport,
  buildAttachedTranscriptLines,
  buildChromeArgs,
  buildChromeAttachLaunchCommand,
  buildAttachedVerificationReport,
  formatAttachReadinessOutput,
  buildServiceWorkerVerificationExpression,
  contentTypeFor,
  createCdpClient,
  diagnoseAttachReadiness,
  findChromeForTestingPath,
  formatAttachedVerificationOutput,
  findPageTarget,
  hasExpectedTranscriptLine,
  isCliEntrypoint,
  normalizeDevToolsHttpBase,
  normalizeServiceWorkerVerificationResult,
  parseChromeSmokeCliArgs,
  resolveSmokeFixtures,
  selectExtensionServiceWorkerTargets,
  selectInspectablePageTarget,
  smokeResultMatchesFixture,
} from '../tools/chromeSmoke.js';

test('createCdpClient exposes close to release DevTools sockets', async () => {
  const sockets = [];
  class FakeSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.closed = false;
      sockets.push(this);
      setTimeout(() => this.dispatchEvent(new Event('open')), 0);
    }

    send(payload) {
      const { id } = JSON.parse(payload);
      setTimeout(() => {
        this.dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify({ id, result: { ok: true } }),
        }));
      }, 0);
    }

    close() {
      this.closed = true;
    }
  }

  const client = await createCdpClient('ws://127.0.0.1/devtools', FakeSocket);
  const result = await client.send('Runtime.enable');
  client.close();

  assert.deepEqual(result, { ok: true });
  assert.equal(sockets[0].closed, true);
});

test('buildChromeArgs loads the extension and opens the fixture URL', () => {
  const args = buildChromeArgs({
    extensionDir: '/repo',
    profileDir: '/tmp/profile',
    url: 'http://127.0.0.1:4173/demo/caption-fixture.html',
    headless: true,
  });

  assert.ok(args.includes('--headless=new'));
  assert.ok(args.includes('--disable-features=DisableLoadExtensionCommandLineSwitch'));
  assert.ok(args.includes('--password-store=basic'));
  assert.ok(args.includes('--use-mock-keychain'));
  assert.ok(args.includes('--no-sandbox'));
  assert.ok(args.includes('--load-extension=/repo'));
  assert.ok(args.includes('--disable-extensions-except=/repo'));
  assert.ok(args.includes('--user-data-dir=/tmp/profile'));
  assert.ok(args.includes('http://127.0.0.1:4173/demo/caption-fixture.html'));
});

test('buildChromeArgs can run headed for extension content-script smoke tests', () => {
  const args = buildChromeArgs({
    extensionDir: '/repo',
    profileDir: '/tmp/profile',
    url: 'http://127.0.0.1:4173/demo/caption-fixture.html',
    headless: false,
  });

  assert.equal(args.includes('--headless=new'), false);
});

test('findChromeForTestingPath selects the newest bundled Playwright Chromium executable', () => {
  const entries = new Map([
    ['/cache', ['chromium-1000', 'chromium-1223', 'firefox-1000']],
    ['/cache/chromium-1000', ['chrome-mac-arm64']],
    ['/cache/chromium-1000/chrome-mac-arm64', ['Google Chrome for Testing.app']],
    ['/cache/chromium-1000/chrome-mac-arm64/Google Chrome for Testing.app', ['Contents']],
    ['/cache/chromium-1000/chrome-mac-arm64/Google Chrome for Testing.app/Contents', ['MacOS']],
    ['/cache/chromium-1000/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS', ['Google Chrome for Testing']],
    ['/cache/chromium-1223', ['chrome-mac-arm64']],
    ['/cache/chromium-1223/chrome-mac-arm64', ['Google Chrome for Testing.app']],
    ['/cache/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app', ['Contents']],
    ['/cache/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents', ['MacOS']],
    ['/cache/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS', ['Google Chrome for Testing']],
  ]);
  const exists = (filePath) => (
    entries.has(filePath) ||
    (entries.has(path.dirname(filePath)) && entries.get(path.dirname(filePath)).includes(path.basename(filePath)))
  );
  const readdir = (dirPath) => entries.get(dirPath) ?? [];

  assert.equal(
    findChromeForTestingPath('/cache', { exists, readdir }),
    '/cache/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  );
});

test('buildChromeAttachLaunchCommand prints a remote-debugging Chrome command', () => {
  assert.equal(
    buildChromeAttachLaunchCommand({
      port: 9222,
      chromePath: '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      profileDir: '/tmp/rvt-profile',
      extensionDir: '/repo',
      url: 'https://www.netflix.com/watch/123',
    }),
    [
      '"/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"',
      '--remote-debugging-port=9222',
      '"--remote-allow-origins=*"',
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--password-store=basic',
      '--use-mock-keychain',
      '--no-sandbox',
      '--user-data-dir="/tmp/rvt-profile"',
      '--disable-extensions-except="/repo"',
      '--load-extension="/repo"',
      '"https://www.netflix.com/watch/123"',
    ].join(' '),
  );
});

test('findPageTarget selects the requested page target', () => {
  const target = findPageTarget(
    [
      { type: 'background_page', url: 'chrome-extension://id/background.html' },
      { type: 'page', url: 'http://127.0.0.1:4173/demo/caption-fixture.html', id: 'page-1' },
    ],
    'http://127.0.0.1:4173/demo/caption-fixture.html',
  );

  assert.equal(target.id, 'page-1');
});

test('normalizeDevToolsHttpBase accepts host ports and full URLs', () => {
  assert.equal(normalizeDevToolsHttpBase('9222'), 'http://127.0.0.1:9222');
  assert.equal(normalizeDevToolsHttpBase('127.0.0.1:9333'), 'http://127.0.0.1:9333');
  assert.equal(normalizeDevToolsHttpBase('http://localhost:9444/'), 'http://localhost:9444');
});

test('parseChromeSmokeCliArgs parses real-site attach timing options', () => {
  assert.deepEqual(parseChromeSmokeCliArgs([
    'node',
    'tools/chromeSmoke.js',
    '--attach=9222',
    '--url-match=netflix.com/watch',
    '--min-lines=3',
    '--timeout-ms=60000',
    '--report=real-site-report.json',
  ]), {
    mode: 'attach',
    fixture: 'caption',
    headed: false,
    devtools: '9222',
    urlMatch: 'netflix.com/watch',
    expectedText: '',
    expectedDomSubtitleResource: '',
    minLines: 3,
    timeoutMs: 60000,
    reportPath: 'real-site-report.json',
    url: '',
    profileDir: '',
  });
});

test('parseChromeSmokeCliArgs parses readiness diagnostics timing options', () => {
  assert.deepEqual(parseChromeSmokeCliArgs([
    'node',
    'tools/chromeSmoke.js',
    '--diagnose-attach=127.0.0.1:9222',
    '--url-match=xiaohongshu.com',
    '--timeout-ms=45000',
  ]), {
    mode: 'diagnose-attach',
    fixture: 'caption',
    headed: false,
    devtools: '127.0.0.1:9222',
    urlMatch: 'xiaohongshu.com',
    expectedText: '',
    expectedDomSubtitleResource: '',
    minLines: 1,
    timeoutMs: 45000,
    reportPath: '',
    url: '',
    profileDir: '',
  });
});

test('parseChromeSmokeCliArgs parses launch command options', () => {
  assert.deepEqual(parseChromeSmokeCliArgs([
    'node',
    'tools/chromeSmoke.js',
    '--print-launch-command=9333',
    '--url=https://www.netflix.com/watch/123',
    '--profile-dir=/tmp/rvt-profile',
  ]), {
    mode: 'print-launch-command',
    fixture: 'caption',
    headed: false,
    devtools: '9333',
    urlMatch: '',
    expectedText: '',
    expectedDomSubtitleResource: '',
    minLines: 1,
    timeoutMs: 15000,
    reportPath: '',
    url: 'https://www.netflix.com/watch/123',
    profileDir: '/tmp/rvt-profile',
  });
});

test('selectInspectablePageTarget chooses a matching page target for attach mode', () => {
  const targets = [
    { type: 'service_worker', url: 'chrome-extension://abc/service_worker.js', id: 'worker' },
    { type: 'page', url: 'chrome://extensions/', id: 'extensions' },
    { type: 'page', url: 'https://www.netflix.com/watch/123', id: 'netflix' },
  ];

  assert.equal(selectInspectablePageTarget(targets, 'netflix.com/watch').id, 'netflix');
  assert.equal(selectInspectablePageTarget(targets).id, 'netflix');
});

test('selectExtensionServiceWorkerTargets keeps inspectable extension workers only', () => {
  const targets = [
    { type: 'service_worker', url: 'chrome-extension://abc/src/background/serviceWorker.js', id: 'rvt', webSocketDebuggerUrl: 'ws://worker' },
    { type: 'service_worker', url: 'https://example.test/sw.js', id: 'site', webSocketDebuggerUrl: 'ws://site' },
    { type: 'page', url: 'chrome-extension://abc/popup.html', id: 'popup', webSocketDebuggerUrl: 'ws://popup' },
    { type: 'service_worker', url: 'chrome-extension://missing/src/background/serviceWorker.js', id: 'missing' },
  ];

  assert.deepEqual(selectExtensionServiceWorkerTargets(targets).map((target) => target.id), ['rvt']);
});

test('buildAttachReadinessReport summarizes matched page and extension worker state', () => {
  const report = buildAttachReadinessReport({
    targets: [
      { type: 'page', url: 'chrome://extensions/', id: 'extensions' },
      { type: 'page', url: 'https://www.netflix.com/watch/123', id: 'netflix' },
      { type: 'service_worker', url: 'chrome-extension://abc/src/background/serviceWorker.js', id: 'worker', webSocketDebuggerUrl: 'ws://worker' },
    ],
    urlMatch: 'netflix.com/watch',
    expectedExtensionName: '实时字幕英语学习助手',
    extensionManifests: [
      { name: '实时字幕英语学习助手', version: '0.1.0' },
    ],
  });

  assert.equal(report.ready, true);
  assert.equal(report.page?.id, 'netflix');
  assert.equal(report.extensionWorkers.length, 1);
  assert.deepEqual(report.checks, [
    { name: 'inspectablePage', ok: true, detail: 'https://www.netflix.com/watch/123' },
    { name: 'extensionServiceWorker', ok: true, detail: '1 inspectable extension service worker(s)' },
    { name: 'expectedExtension', ok: true, detail: '实时字幕英语学习助手' },
  ]);
});

test('buildAttachReadinessReport accepts page content script evidence when the service worker is idle', () => {
  const report = buildAttachReadinessReport({
    targets: [
      { type: 'page', url: 'https://www.netflix.com/title/123?fromWatch=true', id: 'netflix' },
    ],
    urlMatch: 'netflix.com',
    expectedExtensionName: '实时字幕英语学习助手',
    extensionManifests: [],
    pageProbe: {
      ok: true,
      hasOverlay: true,
      hasDiagnosticsFunction: false,
      contentScriptLoaded: false,
    },
  });

  assert.equal(report.ready, true);
  assert.deepEqual(report.checks, [
    { name: 'inspectablePage', ok: true, detail: 'https://www.netflix.com/title/123?fromWatch=true' },
    { name: 'pageContentScript', ok: true, detail: 'overlay detected on target page' },
    { name: 'extensionServiceWorker', ok: true, detail: 'idle or not inspectable; page content script is active' },
    { name: 'expectedExtension', ok: true, detail: '实时字幕英语学习助手 content script detected in page' },
  ]);
});

test('formatAttachReadinessOutput explains setup gaps before real-site verification', () => {
  const output = formatAttachReadinessOutput(buildAttachReadinessReport({
    targets: [
      { type: 'page', url: 'https://www.youtube.com/', id: 'youtube' },
    ],
    urlMatch: 'netflix.com/watch',
    expectedExtensionName: '实时字幕英语学习助手',
    extensionManifests: [],
  }), {
    devtools: '9222',
    urlMatch: 'netflix.com/watch',
  });

  assert.match(output, /Attach readiness: not ready/);
  assert.match(output, /Inspectable page: missing \(no page target matching "netflix.com\/watch"\)/);
  assert.match(output, /Extension service worker: missing \(no inspectable extension service worker found\)/);
  assert.match(output, /Expected extension: missing \(实时字幕英语学习助手 not found\)/);
  assert.match(output, /Open Chrome with --remote-debugging-port=9222/);
});

test('diagnoseAttachReadiness waits through early DevTools fetch failures', async () => {
  let attempts = 0;
  const report = await diagnoseAttachReadiness({
    rootDir: process.cwd(),
    devtools: '9222',
    urlMatch: 'netflix.com/watch',
    timeoutMs: 1000,
    retryDelayMs: 1,
    fetchTargets: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('fetch failed');
      return [
        { type: 'page', url: 'https://www.netflix.com/watch/123', id: 'netflix' },
        { type: 'service_worker', url: 'chrome-extension://abc/src/background/serviceWorker.js', id: 'worker', webSocketDebuggerUrl: 'ws://worker' },
      ];
    },
    readExtensionManifestsForAttach: async () => [
      { name: '实时字幕英语学习助手', version: '0.1.0' },
    ],
  });

  assert.equal(attempts, 2);
  assert.equal(report.ready, true);
});

test('diagnoseAttachReadiness uses page content script evidence when extension service worker is idle', async () => {
  const report = await diagnoseAttachReadiness({
    rootDir: process.cwd(),
    devtools: '9222',
    urlMatch: 'netflix.com',
    timeoutMs: 1000,
    retryDelayMs: 1,
    fetchTargets: async () => [
      { type: 'page', url: 'https://www.netflix.com/title/123?fromWatch=true', id: 'netflix' },
    ],
    readExtensionManifestsForAttach: async () => [],
    readPageProbeForAttach: async () => ({
      ok: true,
      hasOverlay: true,
      hasDiagnosticsFunction: false,
      hasTranscriptFunction: false,
      contentScriptLoaded: false,
    }),
  });

  assert.equal(report.ready, true);
  assert.equal(report.pageProbe?.hasOverlay, true);
  assert.equal(report.extensionWorkers.length, 0);
});

test('buildServiceWorkerVerificationExpression collects all-frame extension evidence', () => {
  const expression = buildServiceWorkerVerificationExpression({
    targetUrl: 'https://www.netflix.com/watch/123',
    urlMatch: 'netflix.com/watch',
  });

  assert.match(expression, /chrome\.tabs\.query/);
  assert.match(expression, /src\/content\/pageSubtitleInterceptor\.js/);
  assert.match(expression, /src\/content\/contentScript\.js/);
  assert.match(expression, /allFrames: true/);
  assert.match(expression, /__rvtGetTranscriptSnapshot/);
  assert.match(expression, /__rvtGetDiagnosticsSnapshot/);
  assert.match(expression, /https:\/\/www\.netflix\.com\/watch\/123/);
  assert.match(expression, /netflix\.com\/watch/);
});

test('resolveSmokeFixtures selects the rendered subtitle fixture by default', () => {
  assert.deepEqual(resolveSmokeFixtures(), [
    {
      name: 'caption',
      path: '/demo/caption-fixture.html',
      expectedText: 'How can we use computers',
    },
  ]);
});

test('resolveSmokeFixtures can select the WebVTT track fixture', () => {
  assert.deepEqual(resolveSmokeFixtures('track'), [
    {
      name: 'track',
      path: '/demo/track-fixture.html',
      expectedText: 'WebVTT track file',
    },
  ]);
});

test('resolveSmokeFixtures can run all subtitle-source fixtures', () => {
  assert.deepEqual(
    resolveSmokeFixtures('all').map((fixture) => fixture.name),
    [
      'caption',
      'iframe-player',
      'track',
      'data-setup',
      'accessibility-caption',
      'xgplayer-caption',
      'early-network-json',
      'network-json',
      'network-srv3',
      'network-generic-json',
      'network-offset-json',
      'network-root-json',
      'network-string-json',
      'network-lrc',
      'network-srt',
      'network-bcc',
      'network-ass',
      'network-ttml',
      'network-json-manifest',
      'inline-json-manifest',
      'inline-js-manifest',
      'websocket-live',
      'eventsource-live',
    ],
  );
});

test('resolveSmokeFixtures can select the data-setup subtitle fixture', () => {
  assert.deepEqual(resolveSmokeFixtures('data-setup'), [
    {
      name: 'data-setup',
      path: '/demo/data-setup-fixture.html',
      expectedText: 'Data setup subtitle',
      expectedDomSubtitleResource: 'data-setup-captions.vtt',
    },
  ]);
});

test('smokeResultMatchesFixture verifies expected DOM subtitle diagnostics when requested', () => {
  assert.equal(
    smokeResultMatchesFixture({
      hasOverlay: true,
      hidden: false,
      lines: ['This line comes from a Data setup subtitle file.'],
      diagnostics: {
        domSubtitleResources: [
          'http://127.0.0.1:4173/demo/fixtures/data-setup-captions.vtt',
        ],
      },
    }, {
      expectedText: 'Data setup subtitle',
      expectedDomSubtitleResource: 'data-setup-captions.vtt',
    }),
    true,
  );

  assert.equal(
    smokeResultMatchesFixture({
      hasOverlay: true,
      hidden: false,
      lines: ['This line comes from a Data setup subtitle file.'],
      diagnostics: {
        domSubtitleResources: [],
      },
    }, {
      expectedText: 'Data setup subtitle',
      expectedDomSubtitleResource: 'data-setup-captions.vtt',
    }),
    false,
  );
});

test('smokeResultMatchesFixture accepts a minimum transcript line count without expected text', () => {
  assert.equal(
    smokeResultMatchesFixture({
      hasOverlay: false,
      hidden: true,
      lines: [],
      background: {
        ok: true,
        transcript: {
          ok: true,
          segments: [
            { id: 'a', text: 'First detected website subtitle.' },
            { id: 'b', text: 'Second detected website subtitle.' },
          ],
        },
        diagnostics: {
          ok: true,
          transcriptCount: 2,
          renderedSubtitles: { count: 2, samples: [] },
          pageSubtitleResources: [],
          domSubtitleResources: [],
          subtitleResources: [],
          videos: [],
          frames: [],
        },
      },
    }, {
      expectedText: '',
      minLines: 2,
    }),
    true,
  );

  assert.equal(
    smokeResultMatchesFixture({
      hasOverlay: false,
      hidden: true,
      lines: [],
      background: {
        ok: true,
        transcript: {
          ok: true,
          segments: [{ id: 'a', text: 'Only one website subtitle.' }],
        },
        diagnostics: { ok: true, transcriptCount: 1, renderedSubtitles: { count: 1, samples: [] } },
      },
    }, {
      expectedText: '',
      minLines: 2,
    }),
    false,
  );
});

test('smokeResultMatchesFixture rejects transcript lines without site subtitle evidence by default', () => {
  assert.equal(
    smokeResultMatchesFixture({
      hasOverlay: false,
      hidden: true,
      lines: [],
      background: {
        ok: true,
        transcript: {
          ok: true,
          segments: [
            { id: 'audio-a', text: 'Audio fallback transcript line one.' },
            { id: 'audio-b', text: 'Audio fallback transcript line two.' },
          ],
        },
        diagnostics: {
          ok: true,
          transcriptCount: 2,
          renderedSubtitles: { count: 0, samples: [] },
          pageSubtitleResources: [],
          domSubtitleResources: [],
          subtitleResources: [],
          videos: [],
          frames: [],
        },
      },
    }, {
      expectedText: '',
      minLines: 2,
    }),
    false,
  );
});

test('smokeResultMatchesFixture accepts rendered page subtitle text as site subtitle evidence', () => {
  assert.equal(
    smokeResultMatchesFixture({
      hasOverlay: true,
      hidden: false,
      lines: ['How can we use computers to do our jobs better?'],
      subtitleText: 'How can we use computers to do our jobs better?',
      diagnostics: null,
    }, {
      expectedText: 'How can we use computers',
    }),
    true,
  );
});

test('smokeResultMatchesFixture accepts iframe overlay status as site subtitle evidence', () => {
  assert.equal(
    smokeResultMatchesFixture({
      hasOverlay: true,
      hidden: false,
      lines: ['How can we use computers to do our jobs better?'],
      status: '正在使用页面已渲染的字幕',
      diagnostics: null,
      frameDiagnostics: [],
    }, {
      expectedText: 'How can we use computers',
    }),
    true,
  );
});

test('smokeResultMatchesFixture can explicitly allow transcript-only evidence', () => {
  assert.equal(
    smokeResultMatchesFixture({
      hasOverlay: false,
      hidden: true,
      lines: [],
      background: {
        ok: true,
        transcript: {
          ok: true,
          segments: [
            { id: 'audio-a', text: 'Audio fallback transcript line one.' },
            { id: 'audio-b', text: 'Audio fallback transcript line two.' },
          ],
        },
        diagnostics: {
          ok: true,
          transcriptCount: 2,
          renderedSubtitles: { count: 0, samples: [] },
          pageSubtitleResources: [],
          domSubtitleResources: [],
          subtitleResources: [],
          videos: [],
          frames: [],
        },
      },
    }, {
      expectedText: '',
      minLines: 2,
      requireSiteSubtitles: false,
    }),
    true,
  );
});

test('formatAttachedVerificationOutput prints diagnostics verdict and evidence', () => {
  assert.equal(
    formatAttachedVerificationOutput({
      url: 'https://www.netflix.com/watch/123',
      status: '正在使用页面已渲染的字幕',
      lines: ['Visible Netflix line.'],
      diagnostics: {
        ok: true,
        url: 'https://www.netflix.com/watch/123',
        transcriptCount: 1,
        renderedSubtitles: { count: 1, samples: [] },
        pageSubtitleResources: [{ url: 'https://example.test/timedtext', cueCount: 3 }],
        domSubtitleResources: ['https://example.test/data-setup/en.vtt'],
        subtitleResources: [],
        captureState: { ok: true, isCapturing: false },
        videos: [],
        frames: [],
      },
    }),
    [
      'Attached page verification passed: 1 transcript line(s), status="正在使用页面已渲染的字幕"',
      'URL: https://www.netflix.com/watch/123',
      'Verdict: site-subtitles-detected',
      'Evidence: 1 行已收集字幕; 1 个页面字幕节点; 1 个带字幕片段的拦截资源; 1 个 DOM 字幕资源',
      'DOM subtitle resources: https://example.test/data-setup/en.vtt',
    ].join('\n'),
  );
});

test('formatAttachedVerificationOutput reports missing service worker evidence', () => {
  const output = formatAttachedVerificationOutput({
    url: 'https://www.netflix.com/watch/123',
    status: '',
    lines: [],
    diagnostics: {
      ok: true,
      url: 'https://www.netflix.com/watch/123',
      transcriptCount: 0,
      renderedSubtitles: { count: 0, samples: [] },
      pageSubtitleResources: [],
      domSubtitleResources: [],
      subtitleResources: [],
      captureState: { ok: true, isCapturing: false },
      videos: [],
      frames: [],
    },
    background: {
      ok: false,
      error: 'No inspectable extension service worker target found.',
    },
  });

  assert.match(output, /Service worker evidence: unavailable - No inspectable extension service worker target found\./);
});

test('formatAttachedVerificationOutput reports service worker injection diagnostics', () => {
  const output = formatAttachedVerificationOutput({
    url: 'https://www.netflix.com/watch/123',
    status: '',
    lines: [],
    background: {
      ok: true,
      ensure: {
        ok: false,
        steps: ['pageSubtitleInterceptor', 'overlayCss-failed', 'contentScript'],
        error: 'Cannot access contents of the page.',
      },
      transcript: { ok: true, segments: [] },
      diagnostics: {
        ok: true,
        url: 'https://www.netflix.com/watch/123',
        transcriptCount: 0,
        renderedSubtitles: { count: 0, samples: [] },
        pageSubtitleResources: [],
        domSubtitleResources: [],
        subtitleResources: [],
        captureState: { ok: true, isCapturing: false },
        videos: [],
        frames: [
          { frameId: 0, url: 'https://www.netflix.com/watch/123', transcriptCount: 0 },
          { frameId: 3, url: 'https://player.example.test/embed', transcriptCount: 0 },
        ],
      },
    },
  });

  assert.match(output, /Service worker evidence: ok, transcript segments=0, diagnostic frames=2/);
  assert.match(output, /Service worker injection: incomplete \(pageSubtitleInterceptor, overlayCss-failed, contentScript\) - Cannot access contents of the page\./);
});

test('buildAttachedVerificationReport returns full attach evidence for saving', () => {
  const report = buildAttachedVerificationReport({
    url: 'https://www.netflix.com/watch/123',
    status: '正在使用页面已渲染的字幕',
    lines: ['Visible Netflix line.'],
    diagnostics: {
      ok: true,
      url: 'https://www.netflix.com/watch/123',
      transcriptCount: 1,
      renderedSubtitles: { count: 1, samples: [] },
      pageSubtitleResources: [],
      domSubtitleResources: ['https://example.test/data-setup/en.vtt'],
      subtitleResources: [],
      captureState: { ok: true, isCapturing: false },
      videos: [],
      frames: [],
    },
  }, new Date('2026-05-29T00:00:00.000Z'));

  assert.equal(report.generatedAt, '2026-05-29T00:00:00.000Z');
  assert.equal(report.url, 'https://www.netflix.com/watch/123');
  assert.deepEqual(report.transcriptLines, ['Visible Netflix line.']);
  assert.equal(report.diagnosticsReport.verdict.status, 'site-subtitles-detected');
  assert.deepEqual(report.diagnosticsReport.samples.domSubtitleResources, ['https://example.test/data-setup/en.vtt']);
});

test('buildAttachedVerificationReport includes iframe diagnostics evidence', () => {
  const report = buildAttachedVerificationReport({
    url: 'https://example.test/watch',
    status: 'Using subtitles from embedded player',
    lines: ['Iframe subtitle line.'],
    diagnostics: {
      ok: true,
      url: 'https://example.test/watch',
      transcriptCount: 0,
      renderedSubtitles: { count: 0, samples: [] },
      pageSubtitleResources: [],
      domSubtitleResources: [],
      subtitleResources: [],
      captureState: { ok: true, isCapturing: false },
      videos: [],
      frames: [],
    },
    frameDiagnostics: [
      {
        ok: true,
        url: 'https://example.test/player',
        transcriptCount: 1,
        renderedSubtitles: { count: 1, samples: [{ source: 'netflix-rendered-subtitle', text: 'Iframe subtitle line.' }] },
        pageSubtitleResources: [{ url: 'https://example.test/player/timedtext', cueCount: 1 }],
        domSubtitleResources: ['https://example.test/player/subtitles/en.vtt'],
        subtitleResources: [],
        captureState: { ok: true, isCapturing: false },
        videos: [],
        frames: [],
      },
    ],
  }, new Date('2026-05-29T00:00:00.000Z'));

  assert.equal(report.diagnosticsReport.verdict.status, 'site-subtitles-detected');
  assert.deepEqual(report.diagnosticsReport.verdict.evidence, [
    '1 行已收集字幕',
    '1 个页面字幕节点',
    '1 个带字幕片段的拦截资源',
    '1 个 DOM 字幕资源',
  ]);
  assert.deepEqual(report.diagnosticsReport.raw.domSubtitleResources, ['https://example.test/player/subtitles/en.vtt']);
  assert.deepEqual(report.diagnosticsReport.raw.pageSubtitleResources, [
    { url: 'https://example.test/player/timedtext', cueCount: 1 },
  ]);
});

test('normalizeServiceWorkerVerificationResult merges all-frame service worker evidence', () => {
  const background = normalizeServiceWorkerVerificationResult({
    ok: true,
    tab: { id: 7, url: 'https://www.netflix.com/watch/123', title: 'Netflix' },
    extension: { id: 'abc', name: '实时字幕英语学习助手' },
    transcriptFrames: [
      { frameId: 0, result: { ok: true, segments: [] } },
      { frameId: 5, result: { ok: true, segments: [{ id: 'sw-line', startedAt: 1000, updatedAt: 2500, text: 'Cross-frame Netflix subtitle.' }] } },
    ],
    diagnosticsFrames: [
      { frameId: 0, result: { ok: true, url: 'https://www.netflix.com/watch/123', transcriptCount: 0, renderedSubtitles: { count: 0, samples: [] } } },
      {
        frameId: 5,
        result: {
          ok: true,
          url: 'https://player.example.test/embed',
          transcriptCount: 1,
          renderedSubtitles: { count: 1, samples: [{ source: 'netflix-rendered-subtitle', text: 'Cross-frame Netflix subtitle.' }] },
          pageSubtitleResources: [{ url: 'https://player.example.test/timedtext', cueCount: 1 }],
          domSubtitleResources: [],
          videos: [],
        },
      },
    ],
  });

  assert.equal(background.ok, true);
  assert.equal(background.transcript.segments.length, 1);
  assert.equal(background.diagnostics.transcriptCount, 1);
  assert.equal(background.diagnostics.renderedSubtitles.count, 1);
  assert.equal(background.diagnostics.pageSubtitleResources.length, 1);
});

test('attached verification uses service worker evidence when page overlay is inaccessible', () => {
  const result = {
    url: 'https://www.netflix.com/watch/123',
    hasOverlay: false,
    hidden: true,
    lines: [],
    diagnostics: {
      ok: true,
      url: 'https://www.netflix.com/watch/123',
      transcriptCount: 0,
      renderedSubtitles: { count: 0, samples: [] },
      pageSubtitleResources: [],
      domSubtitleResources: [],
      subtitleResources: [],
      captureState: { ok: true, isCapturing: false },
      videos: [],
      frames: [],
    },
    background: {
      ok: true,
      transcript: {
        ok: true,
        segments: [{ id: 'sw-line', startedAt: 1000, updatedAt: 2500, text: 'Cross-frame Netflix subtitle.' }],
      },
      diagnostics: {
        ok: true,
        url: 'https://www.netflix.com/watch/123',
        transcriptCount: 1,
        renderedSubtitles: { count: 1, samples: [{ source: 'rendered-subtitle', text: 'Cross-frame Netflix subtitle.' }] },
        pageSubtitleResources: [{ url: 'https://www.netflix.com/timedtext', cueCount: 1 }],
        domSubtitleResources: [],
        subtitleResources: [],
        captureState: { ok: true, isCapturing: false },
        videos: [],
        frames: [],
      },
    },
  };

  assert.deepEqual(buildAttachedTranscriptLines(result), ['Cross-frame Netflix subtitle.']);
  assert.equal(smokeResultMatchesFixture(result, { expectedText: 'Cross-frame Netflix subtitle' }), true);

  const report = buildAttachedVerificationReport(result, new Date('2026-05-29T00:00:00.000Z'));
  assert.equal(report.diagnosticsReport.verdict.status, 'site-subtitles-detected');
  assert.deepEqual(report.transcriptLines, ['Cross-frame Netflix subtitle.']);
  assert.match(formatAttachedVerificationOutput(result), /Evidence: 1 行已收集字幕; 1 个页面字幕节点; 1 个带字幕片段的拦截资源/);
});

test('resolveSmokeFixtures can select the XGPlayer-style rendered caption fixture', () => {
  assert.deepEqual(resolveSmokeFixtures('xgplayer-caption'), [
    {
      name: 'xgplayer-caption',
      path: '/demo/xgplayer-caption-fixture.html',
      expectedText: 'XGPlayer style rendered caption',
    },
  ]);
});

test('resolveSmokeFixtures can select the YouTube srv3 timedtext fixture', () => {
  assert.deepEqual(resolveSmokeFixtures('network-srv3'), [
    {
      name: 'network-srv3',
      path: '/demo/network-srv3-fixture.html',
      expectedText: 'YouTube srv3 XML subtitle',
    },
  ]);
});

test('resolveSmokeFixtures can select the LRC network subtitle fixture', () => {
  assert.deepEqual(resolveSmokeFixtures('network-lrc'), [
    {
      name: 'network-lrc',
      path: '/demo/network-lrc-fixture.html',
      expectedText: 'LRC network subtitle',
    },
  ]);
});

test('resolveSmokeFixtures can select the SRT network subtitle fixture', () => {
  assert.deepEqual(resolveSmokeFixtures('network-srt'), [
    {
      name: 'network-srt',
      path: '/demo/network-srt-fixture.html',
      expectedText: 'SRT network subtitle',
    },
  ]);
});

test('resolveSmokeFixtures can select the BCC network subtitle fixture', () => {
  assert.deepEqual(resolveSmokeFixtures('network-bcc'), [
    {
      name: 'network-bcc',
      path: '/demo/network-bcc-fixture.html',
      expectedText: 'BCC network subtitle',
    },
  ]);
});

test('resolveSmokeFixtures can select the ASS network subtitle fixture', () => {
  assert.deepEqual(resolveSmokeFixtures('network-ass'), [
    {
      name: 'network-ass',
      path: '/demo/network-ass-fixture.html',
      expectedText: 'ASS network subtitle',
    },
  ]);
});

test('hasExpectedTranscriptLine checks collected transcript content', () => {
  assert.equal(
    hasExpectedTranscriptLine(
      ['A previous line', 'This line comes from a WebVTT track file.'],
      'WebVTT track file',
    ),
    true,
  );
  assert.equal(hasExpectedTranscriptLine(['Only unrelated text'], 'WebVTT track file'), false);
});

test('contentTypeFor serves WebVTT fixtures with the expected MIME type', () => {
  assert.equal(contentTypeFor('/repo/demo/fixtures/captions.vtt'), 'text/vtt; charset=utf-8');
});

test('contentTypeFor serves LRC fixtures with the expected MIME type', () => {
  assert.equal(contentTypeFor('/repo/demo/fixtures/captions.lrc'), 'text/plain; charset=utf-8');
});

test('contentTypeFor serves SRT fixtures with the expected MIME type', () => {
  assert.equal(contentTypeFor('/repo/demo/fixtures/captions.srt'), 'text/plain; charset=utf-8');
});

test('contentTypeFor serves BCC fixtures with the expected MIME type', () => {
  assert.equal(contentTypeFor('/repo/demo/fixtures/captions.bcc'), 'application/json; charset=utf-8');
});

test('contentTypeFor serves ASS fixtures with the expected MIME type', () => {
  assert.equal(contentTypeFor('/repo/demo/fixtures/captions.ass'), 'text/plain; charset=utf-8');
});

test('contentTypeFor serves JSON subtitle fixtures with the expected MIME type', () => {
  assert.equal(contentTypeFor('/repo/demo/fixtures/timedtext.json'), 'application/json; charset=utf-8');
});

test('contentTypeFor serves TTML subtitle fixtures with the expected MIME type', () => {
  assert.equal(contentTypeFor('/repo/demo/fixtures/netflix-like.dfxp'), 'application/ttml+xml; charset=utf-8');
  assert.equal(contentTypeFor('/repo/demo/fixtures/netflix-like.ttml'), 'application/ttml+xml; charset=utf-8');
});

test('isCliEntrypoint accepts relative node script paths', () => {
  assert.equal(
    isCliEntrypoint('file:///repo/tools/chromeSmoke.js', 'tools/chromeSmoke.js', '/repo'),
    true,
  );
});
