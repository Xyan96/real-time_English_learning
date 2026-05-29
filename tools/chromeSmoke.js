import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

import {
  mergeFrameDiagnostics,
  mergeFrameSegments,
} from '../src/background/transcriptCollector.js';
import { buildDiagnosticsReport } from '../src/popup/popupStatus.js';
import { validateExtensionPackage } from './validateExtension.js';

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_PLAYWRIGHT_CACHE = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
const SMOKE_FIXTURES = [
  {
    name: 'caption',
    path: '/demo/caption-fixture.html',
    expectedText: 'How can we use computers',
  },
  {
    name: 'iframe-player',
    path: '/demo/iframe-player-fixture.html',
    expectedText: 'How can we use computers',
  },
  {
    name: 'track',
    path: '/demo/track-fixture.html',
    expectedText: 'WebVTT track file',
  },
  {
    name: 'data-setup',
    path: '/demo/data-setup-fixture.html',
    expectedText: 'Data setup subtitle',
    expectedDomSubtitleResource: 'data-setup-captions.vtt',
  },
  {
    name: 'accessibility-caption',
    path: '/demo/accessibility-caption-fixture.html',
    expectedText: 'Accessibility caption',
  },
  {
    name: 'xgplayer-caption',
    path: '/demo/xgplayer-caption-fixture.html',
    expectedText: 'XGPlayer style rendered caption',
  },
  {
    name: 'early-network-json',
    path: '/demo/early-network-json-fixture.html',
    expectedText: 'Early network JSON subtitle',
  },
  {
    name: 'network-json',
    path: '/demo/network-json-fixture.html',
    expectedText: 'Network JSON subtitle',
  },
  {
    name: 'network-srv3',
    path: '/demo/network-srv3-fixture.html',
    expectedText: 'YouTube srv3 XML subtitle',
  },
  {
    name: 'network-generic-json',
    path: '/demo/network-generic-json-fixture.html',
    expectedText: 'Generic JSON subtitle',
  },
  {
    name: 'network-offset-json',
    path: '/demo/network-offset-json-fixture.html',
    expectedText: 'Offset JSON subtitle',
  },
  {
    name: 'network-root-json',
    path: '/demo/network-root-json-fixture.html',
    expectedText: 'Root JSON array subtitle',
  },
  {
    name: 'network-string-json',
    path: '/demo/network-string-json-fixture.html',
    expectedText: 'String timestamp JSON subtitle',
  },
  {
    name: 'network-lrc',
    path: '/demo/network-lrc-fixture.html',
    expectedText: 'LRC network subtitle',
  },
  {
    name: 'network-srt',
    path: '/demo/network-srt-fixture.html',
    expectedText: 'SRT network subtitle',
  },
  {
    name: 'network-bcc',
    path: '/demo/network-bcc-fixture.html',
    expectedText: 'BCC network subtitle',
  },
  {
    name: 'network-ass',
    path: '/demo/network-ass-fixture.html',
    expectedText: 'ASS network subtitle',
  },
  {
    name: 'network-ttml',
    path: '/demo/network-ttml-fixture.html',
    expectedText: 'Netflix-like TTML subtitle',
  },
  {
    name: 'network-json-manifest',
    path: '/demo/network-json-manifest-fixture.html',
    expectedText: 'Netflix JSON manifest subtitle',
  },
  {
    name: 'inline-json-manifest',
    path: '/demo/inline-json-manifest-fixture.html',
    expectedText: 'Netflix JSON manifest subtitle',
  },
  {
    name: 'inline-js-manifest',
    path: '/demo/inline-js-manifest-fixture.html',
    expectedText: 'Netflix JSON manifest subtitle',
  },
  {
    name: 'websocket-live',
    path: '/demo/websocket-live-fixture.html',
    expectedText: 'Live WebSocket subtitle',
  },
  {
    name: 'eventsource-live',
    path: '/demo/eventsource-live-fixture.html',
    expectedText: 'Live EventSource subtitle',
  },
];

export function buildChromeArgs({ extensionDir, profileDir, url, headless = true }) {
  return [
    headless ? '--headless=new' : '',
    '--disable-gpu',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--password-store=basic',
    '--use-mock-keychain',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    url,
  ].filter(Boolean);
}

export function findChromeForTestingPath(cacheDir = DEFAULT_PLAYWRIGHT_CACHE, {
  exists = fs.existsSync,
  readdir = (dirPath) => fs.readdirSync(dirPath),
} = {}) {
  if (!exists(cacheDir)) return '';

  const versions = readdir(cacheDir)
    .map((entry) => {
      const match = /^chromium-(\d+)$/.exec(entry);
      return match ? { entry, version: Number(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.version - left.version);

  for (const { entry } of versions) {
    for (const platformDir of ['chrome-mac-arm64', 'chrome-mac']) {
      const executable = path.join(
        cacheDir,
        entry,
        platformDir,
        'Google Chrome for Testing.app',
        'Contents',
        'MacOS',
        'Google Chrome for Testing',
      );
      if (exists(executable)) return executable;
    }
  }

  return '';
}

export function getDefaultChromePath() {
  return process.env.CHROME_PATH || findChromeForTestingPath() || DEFAULT_CHROME;
}

export function buildChromeAttachLaunchCommand({
  port = 9222,
  chromePath = getDefaultChromePath(),
  profileDir = path.join(os.tmpdir(), 'rvt-attach-profile'),
  extensionDir = process.cwd(),
  url = 'about:blank',
} = {}) {
  const quote = (value) => `"${String(value).replace(/(["\\$`])/g, '\\$1')}"`;
  return [
    quote(chromePath),
    `--remote-debugging-port=${Math.max(1, Number(port) || 9222)}`,
    quote('--remote-allow-origins=*'),
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--password-store=basic',
    '--use-mock-keychain',
    '--no-sandbox',
    `--user-data-dir=${quote(profileDir)}`,
    `--disable-extensions-except=${quote(extensionDir)}`,
    `--load-extension=${quote(extensionDir)}`,
    quote(url),
  ].join(' ');
}

export function parseChromeSmokeCliArgs(argv = process.argv) {
  const args = Array.from(argv ?? []).slice(2);
  const getArg = (name) => {
    const prefix = `--${name}=`;
    const value = args.find((argument) => argument.startsWith(prefix));
    return value ? value.slice(prefix.length) : '';
  };
  const attach = getArg('attach');
  const diagnoseAttach = getArg('diagnose-attach');
  const printLaunchCommand = getArg('print-launch-command');

  return {
    mode: printLaunchCommand ? 'print-launch-command' : diagnoseAttach ? 'diagnose-attach' : attach ? 'attach' : 'smoke',
    fixture: getArg('fixture') || 'caption',
    headed: args.includes('--headed'),
    devtools: printLaunchCommand || diagnoseAttach || attach || '9222',
    urlMatch: getArg('url-match'),
    expectedText: getArg('expected-text'),
    expectedDomSubtitleResource: getArg('expected-dom-subtitle-resource'),
    minLines: Math.max(1, Number(getArg('min-lines')) || 1),
    timeoutMs: Math.max(1, Number(getArg('timeout-ms')) || 15_000),
    reportPath: getArg('report'),
    url: getArg('url'),
    profileDir: getArg('profile-dir'),
  };
}

export function findPageTarget(targets, url) {
  return targets.find((target) => target.type === 'page' && target.url === url);
}

export function normalizeDevToolsHttpBase(value = '9222') {
  const text = String(value || '9222').trim();
  const withProtocol = /^\w+:\/\//.test(text)
    ? text
    : text.includes(':')
      ? `http://${text}`
      : `http://127.0.0.1:${text}`;
  const url = new URL(withProtocol);
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/$/, '');
}

export function selectInspectablePageTarget(targets, urlMatch = '') {
  const pages = Array.from(targets ?? [])
    .filter((target) => target?.type === 'page')
    .filter((target) => !/^chrome:\/\//i.test(String(target?.url ?? '')));
  const needle = String(urlMatch ?? '').trim();
  if (!needle) return pages[0] ?? null;
  return pages.find((target) => String(target?.url ?? '').includes(needle)) ?? null;
}

export function selectExtensionServiceWorkerTargets(targets) {
  return Array.from(targets ?? [])
    .filter((target) => target?.type === 'service_worker')
    .filter((target) => /^chrome-extension:\/\//i.test(String(target?.url ?? '')))
    .filter((target) => Boolean(target?.webSocketDebuggerUrl));
}

export function buildAttachReadinessReport({
  targets = [],
  urlMatch = '',
  expectedExtensionName = '',
  extensionManifests = [],
  pageProbe = null,
} = {}) {
  const page = selectInspectablePageTarget(targets, urlMatch);
  const extensionWorkers = selectExtensionServiceWorkerTargets(targets);
  const matchedManifest = Array.from(extensionManifests ?? [])
    .find((manifest) => manifest?.name === expectedExtensionName);
  const pageContentScriptActive = Boolean(pageProbe?.ok && (
    pageProbe?.hasOverlay ||
    pageProbe?.contentScriptLoaded ||
    pageProbe?.hasDiagnosticsFunction ||
    pageProbe?.hasTranscriptFunction
  ));
  const pageDetail = page?.url
    ?? (urlMatch ? `no page target matching "${urlMatch}"` : 'no inspectable page target found');
  const workerDetail = extensionWorkers.length > 0
    ? `${extensionWorkers.length} inspectable extension service worker(s)`
    : pageContentScriptActive
      ? 'idle or not inspectable; page content script is active'
    : 'no inspectable extension service worker found';
  const extensionDetail = matchedManifest?.name
    ?? (pageContentScriptActive && expectedExtensionName
      ? `${expectedExtensionName} content script detected in page`
      : (expectedExtensionName ? `${expectedExtensionName} not found` : 'no expected extension name configured'));

  const shouldReportPageContentScript = Boolean(pageProbe && (!matchedManifest || pageContentScriptActive));
  const checks = [
    { name: 'inspectablePage', ok: Boolean(page), detail: pageDetail },
    ...(shouldReportPageContentScript ? [{
      name: 'pageContentScript',
      ok: pageContentScriptActive,
      detail: pageContentScriptActive
        ? 'overlay detected on target page'
        : (pageProbe?.error || 'extension content script not detected in target page'),
    }] : []),
    { name: 'extensionServiceWorker', ok: extensionWorkers.length > 0 || pageContentScriptActive, detail: workerDetail },
    { name: 'expectedExtension', ok: Boolean(matchedManifest) || pageContentScriptActive, detail: extensionDetail },
  ];

  return {
    ready: checks.every((check) => check.ok),
    urlMatch: String(urlMatch ?? ''),
    page: page ?? null,
    pageProbe: pageProbe ?? null,
    extensionWorkers,
    extensionManifests: Array.from(extensionManifests ?? []),
    checks,
  };
}

export function formatAttachReadinessOutput(report = {}, {
  devtools = '9222',
  urlMatch = '',
} = {}) {
  const status = report?.ready ? 'ready' : 'not ready';
  const labels = {
    inspectablePage: 'Inspectable page',
    extensionServiceWorker: 'Extension service worker',
    expectedExtension: 'Expected extension',
  };
  const lines = [`Attach readiness: ${status}`];

  for (const check of Array.from(report?.checks ?? [])) {
    const label = labels[check.name] ?? check.name;
    lines.push(`${label}: ${check.ok ? 'ok' : 'missing'} (${check.detail})`);
  }

  if (report?.ready) {
    lines.push(`Next: node tools/chromeSmoke.js --attach=${devtools} --url-match=${urlMatch || report.urlMatch || '<page-url-fragment>'} --min-lines=3 --report=real-site-report.json`);
  } else {
    lines.push(`Open Chrome with --remote-debugging-port=${devtools}, load this extension unpacked, open the target video page, enable captions, then retry.`);
  }

  return lines.join('\n');
}

export function resolveSmokeFixtures(fixtureName = 'caption') {
  if (fixtureName === 'all') return SMOKE_FIXTURES.slice();

  const fixture = SMOKE_FIXTURES.find((candidate) => candidate.name === fixtureName);
  if (!fixture) {
    throw new Error(`Unknown smoke fixture "${fixtureName}". Use one of: ${SMOKE_FIXTURES.map((item) => item.name).join(', ')}, all.`);
  }

  return [fixture];
}

export function hasExpectedTranscriptLine(lines, expectedText) {
  return Array.from(lines ?? []).some((line) => String(line ?? '').includes(expectedText));
}

export function smokeResultMatchesFixture(value, fixture = {}) {
  const lines = buildAttachedTranscriptLines(value);
  const minLines = Math.max(1, Number(fixture.minLines) || 1);
  const requireSiteSubtitles = fixture.requireSiteSubtitles !== false;
  const hasOverlayEvidence = value?.hasOverlay && value.hidden === false;
  const hasBackgroundEvidence = Boolean(value?.background?.ok && lines.length > 0);
  if (!hasOverlayEvidence && !hasBackgroundEvidence) return false;
  if (lines.length < minLines) return false;

  const expectedText = String(fixture.expectedText ?? '').trim();
  if (expectedText && !hasExpectedTranscriptLine(lines, expectedText)) return false;
  if (requireSiteSubtitles && !hasAttachedSiteSubtitleEvidence(value)) return false;

  const expectedDomSubtitleResource = String(fixture.expectedDomSubtitleResource ?? '');
  if (!expectedDomSubtitleResource) return true;

  return Array.from(buildAttachedDiagnostics(value)?.domSubtitleResources ?? [])
    .some((url) => String(url).includes(expectedDomSubtitleResource));
}

export function hasAttachedSiteSubtitleEvidence(result = {}) {
  const diagnostics = buildAttachedDiagnostics(result);
  const videos = Array.from(diagnostics?.videos ?? []);
  const textTrackCount = videos.reduce((sum, video) => sum + Math.max(0, Number(video?.textTrackCount) || 0), 0);
  const activeCueCount = videos.reduce((sum, video) => (
    sum + Array.from(video?.textTracks ?? []).reduce((trackSum, track) => (
      trackSum + Math.max(0, Number(track?.activeCueCount) || 0)
    ), 0)
  ), 0);

  return (
    /页面已渲染的字幕|site-subtitles|rendered subtitle/i.test(String(result?.status ?? '')) ||
    String(result?.subtitleText ?? '').trim().length > 0 ||
    Math.max(0, Number(diagnostics?.renderedSubtitles?.count) || 0) > 0 ||
    Array.from(diagnostics?.pageSubtitleResources ?? []).some((resource) => (
      Math.max(0, Number(resource?.cueCount) || 0) > 0
    )) ||
    Array.from(diagnostics?.subtitleResources ?? []).length > 0 ||
    Array.from(diagnostics?.domSubtitleResources ?? []).length > 0 ||
    textTrackCount > 0 ||
    activeCueCount > 0
  );
}

export function buildAttachedDiagnostics(result = {}) {
  if (result?.background?.diagnostics?.ok !== false && result?.background?.diagnostics) {
    return result.background.diagnostics;
  }

  const frameDiagnostics = Array.from(result?.frameDiagnostics ?? []).filter(Boolean);
  if (frameDiagnostics.length > 0) return mergeFrameDiagnostics(frameDiagnostics);
  return result?.diagnostics ?? {};
}

export function buildAttachedTranscriptLines(result = {}) {
  const lines = [];
  const seen = new Set();
  const addLine = (value) => {
    const text = String(value ?? '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    lines.push(text);
  };

  for (const line of Array.from(result?.lines ?? [])) {
    addLine(line);
  }

  for (const segment of Array.from(result?.background?.transcript?.segments ?? [])) {
    addLine(segment?.text);
  }

  return lines;
}

export function normalizeServiceWorkerVerificationResult(value = {}) {
  if (value?.ok === false) return value;

  const transcriptFrames = Array.from(value?.transcriptFrames ?? [])
    .map((item) => item?.result)
    .filter(Boolean);
  const diagnosticsFrames = Array.from(value?.diagnosticsFrames ?? [])
    .map((item) => ({
      ...(item?.result ?? {}),
      frameId: item?.frameId,
    }))
    .filter(Boolean);

  return {
    ok: true,
    tab: value?.tab ?? null,
    extension: value?.extension ?? null,
    ensure: value?.ensure ?? null,
    transcript: {
      ok: true,
      segments: mergeFrameSegments(transcriptFrames),
    },
    diagnostics: mergeFrameDiagnostics(diagnosticsFrames),
    raw: value,
  };
}

export function buildServiceWorkerVerificationExpression({ targetUrl = '', urlMatch = '' } = {}) {
  return `(async () => {
    const targetUrl = ${JSON.stringify(String(targetUrl ?? ''))};
    const urlMatch = ${JSON.stringify(String(urlMatch ?? ''))};
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => String(candidate.url || '') === targetUrl)
      || (urlMatch ? tabs.find((candidate) => String(candidate.url || '').includes(urlMatch)) : null)
      || tabs.find((candidate) => candidate.active)
      || tabs[0];

    if (!tab?.id) {
      return {
        ok: false,
        error: 'No matching tab found for service worker verification.',
        tabs: tabs.map((candidate) => ({
          id: candidate.id,
          url: candidate.url || '',
          title: candidate.title || '',
          active: Boolean(candidate.active),
        })),
      };
    }

    const ensure = { ok: true, steps: [] };
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['src/content/pageSubtitleInterceptor.js'],
        world: 'MAIN',
      });
      ensure.steps.push('pageSubtitleInterceptor');
    } catch (error) {
      ensure.ok = false;
      ensure.steps.push('pageSubtitleInterceptor-failed');
      ensure.error = error?.message || String(error);
    }

    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id, allFrames: true },
        files: ['src/content/overlay.css'],
      });
      ensure.steps.push('overlayCss');
    } catch (error) {
      ensure.ok = false;
      ensure.steps.push('overlayCss-failed');
      ensure.error = ensure.error || error?.message || String(error);
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['src/content/contentScript.js'],
      });
      ensure.steps.push('contentScript');
    } catch (error) {
      ensure.ok = false;
      ensure.steps.push('contentScript-failed');
      ensure.error = ensure.error || error?.message || String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 300));

    const transcriptFrames = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => globalThis.__rvtGetTranscriptSnapshot?.() ?? { ok: true, segments: [] },
    });
    const diagnosticsFrames = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => globalThis.__rvtGetDiagnosticsSnapshot?.() ?? { ok: true, transcriptCount: 0 },
    });

    return {
      ok: true,
      tab: {
        id: tab.id,
        url: tab.url || '',
        title: tab.title || '',
        active: Boolean(tab.active),
      },
      extension: {
        id: chrome.runtime.id,
        name: chrome.runtime.getManifest().name,
      },
      ensure,
      transcriptFrames,
      diagnosticsFrames,
    };
  })()`;
}

export function buildAttachedVerificationReport(result = {}, generatedAt = new Date()) {
  const diagnostics = buildAttachedDiagnostics(result);
  return {
    generatedAt: generatedAt.toISOString(),
    url: String(result?.url ?? diagnostics?.url ?? ''),
    status: String(result?.status ?? ''),
    transcriptLines: buildAttachedTranscriptLines(result),
    diagnosticsReport: buildDiagnosticsReport(diagnostics),
    raw: result,
  };
}

export function formatAttachedVerificationOutput(result = {}) {
  const attachedReport = buildAttachedVerificationReport(result);
  const report = attachedReport.diagnosticsReport;
  const diagnostics = report.raw ?? {};
  const lines = [
    `Attached page verification passed: ${attachedReport.transcriptLines.length} transcript line(s), status="${String(result?.status ?? '')}"`,
    `URL: ${String(attachedReport.url ?? '')}`,
    `Verdict: ${report.verdict.status}`,
  ];

  if (report.verdict.evidence.length > 0) {
    lines.push(`Evidence: ${report.verdict.evidence.join('; ')}`);
  }

  const domSubtitleResources = Array.from(diagnostics.domSubtitleResources ?? []);
  if (domSubtitleResources.length > 0) {
    lines.push(`DOM subtitle resources: ${domSubtitleResources.slice(0, 3).join(', ')}`);
  }

  const backgroundLines = formatServiceWorkerEvidenceLines(result?.background);
  lines.push(...backgroundLines);

  return lines.join('\n');
}

function formatServiceWorkerEvidenceLines(background) {
  if (!background) return [];

  if (background.ok === false) {
    return [`Service worker evidence: unavailable - ${String(background.error ?? 'Unknown error')}`];
  }

  const segments = Array.from(background?.transcript?.segments ?? []);
  const frames = Array.from(background?.diagnostics?.frames ?? []);
  const lines = [
    `Service worker evidence: ok, transcript segments=${segments.length}, diagnostic frames=${frames.length}`,
  ];

  if (background?.ensure) {
    const steps = Array.from(background.ensure.steps ?? []);
    if (background.ensure.ok === false) {
      lines.push([
        `Service worker injection: incomplete (${steps.join(', ') || 'no steps recorded'})`,
        background.ensure.error ? ` - ${background.ensure.error}` : '',
      ].join(''));
    } else if (steps.length > 0) {
      lines.push(`Service worker injection: ok (${steps.join(', ')})`);
    }
  }

  return lines;
}

export async function runChromeSmoke({
  rootDir = process.cwd(),
  chromePath = getDefaultChromePath(),
  fixture = 'caption',
  url = '',
  expectedText = '',
  minLines = 1,
  headless = true,
  timeoutMs = 15_000,
} = {}) {
  const validationErrors = validateExtensionPackage({ rootDir });
  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join('\n'));
  }

  if (!fs.existsSync(chromePath)) {
    throw new Error(`Chrome executable not found: ${chromePath}`);
  }

  const fixtures = url
    ? [{
        name: 'external',
        url,
        expectedText,
        minLines,
      }]
    : resolveSmokeFixtures(fixture);
  const server = url ? null : await startStaticServer(rootDir);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rvt-chrome-profile-'));
  const firstUrl = fixtures[0].url ?? `http://127.0.0.1:${server.port}${fixtures[0].path}`;
  const args = buildChromeArgs({
    extensionDir: rootDir,
    headless,
    profileDir,
    url: firstUrl,
  });
  const chrome = spawn(chromePath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let chromeStderr = '';
  chrome.stderr.on('data', (chunk) => {
    chromeStderr += chunk.toString();
  });

  try {
    const devtools = await waitForDevToolsEndpoint(profileDir, timeoutMs);
    const results = [];
    const target = await waitForPageTarget(devtools.httpBase, firstUrl, timeoutMs);
    const client = await createCdpClient(target.webSocketDebuggerUrl);
    const expectedManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
    const loadedManifests = await waitForExtensionManifests(devtools.httpBase, expectedManifest.name, timeoutMs);
    const loadedExpectedExtension = loadedManifests.some((manifest) => manifest?.name === expectedManifest.name);

    if (!loadedExpectedExtension) {
      throw new Error([
        `Expected extension was not loaded: ${expectedManifest.name}`,
        'Branded Google Chrome builds may ignore --load-extension. Use Chrome for Testing or Chromium via CHROME_PATH, or load the extension manually from chrome://extensions.',
        `Loaded extension manifests: ${JSON.stringify(loadedManifests)}`,
      ].join('\n'));
    }

    await client.send('Page.enable');
    await client.send('Runtime.enable');

    for (const currentFixture of fixtures) {
      const currentUrl = currentFixture.url ?? `http://127.0.0.1:${server.port}${currentFixture.path}`;
      await client.send('Page.navigate', { url: currentUrl });
      if (currentFixture.url) {
        await delay(3_000);
      } else {
        await waitForPageLoad(client, timeoutMs, currentUrl);
        await client.send('Page.reload', { ignoreCache: true });
      }
      await delay(1_000);
      const result = await waitForOverlayResult(client, timeoutMs, currentFixture, {
        readBackgroundVerification: () => readAttachedServiceWorkerVerification({
          httpBase: devtools.httpBase,
          expectedExtensionName: expectedManifest.name,
          targetUrl: currentUrl,
          urlMatch: currentUrl,
        }),
      }).catch(async (error) => {
        const targets = await fetchJson(`${devtools.httpBase}/json/list`).catch(() => []);
        const targetSummary = targets.map((item) => ({ type: item.type, title: item.title, url: item.url }));
        const extensionManifest = await readExtensionManifestFromTargets(targets).catch((manifestError) => ({
          error: manifestError.message,
        }));
        throw new Error([
          `Fixture "${currentFixture.name}" failed.`,
          error.message,
          `Targets: ${JSON.stringify(targetSummary)}`,
          `Extension manifest: ${JSON.stringify(extensionManifest)}`,
          chromeStderr ? `Chrome stderr: ${chromeStderr.slice(-2000)}` : '',
        ].filter(Boolean).join('\n'));
      });
      results.push({ ...result, fixture: currentFixture.name, url: currentUrl });
    }

    await client.send('Browser.close').catch(() => {});
    client.close();

    return {
      ...results.at(-1),
      results,
      profileDir,
    };
  } finally {
    chrome.kill('SIGTERM');
    await server?.close();
  }
}

export async function runAttachedPageVerification({
  rootDir = process.cwd(),
  devtools = '9222',
  urlMatch = '',
  expectedText = '',
  expectedDomSubtitleResource = '',
  minLines = 1,
  timeoutMs = 15_000,
} = {}) {
  const httpBase = normalizeDevToolsHttpBase(devtools);
  const targets = await fetchJson(`${httpBase}/json/list`);
  const target = selectInspectablePageTarget(targets, urlMatch);
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`No inspectable page target found${urlMatch ? ` matching "${urlMatch}"` : ''}.`);
  }

  const client = await createCdpClient(target.webSocketDebuggerUrl);
  try {
    await client.send('Runtime.enable');
    const expectedManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
    const result = await waitForOverlayResult(client, timeoutMs, {
      expectedText,
      expectedDomSubtitleResource,
      minLines,
    }, {
      readBackgroundVerification: () => readAttachedServiceWorkerVerification({
        httpBase,
        expectedExtensionName: expectedManifest.name,
        targetUrl: target.url,
        urlMatch,
      }),
    });

    return {
      ...result,
      url: target.url,
    };
  } finally {
    client.close();
  }
}

export async function diagnoseAttachReadiness({
  rootDir = process.cwd(),
  devtools = '9222',
  urlMatch = '',
  timeoutMs = 15_000,
  retryDelayMs = 500,
  fetchTargets = null,
  readExtensionManifestsForAttach = null,
  readPageProbeForAttach = null,
} = {}) {
  const httpBase = normalizeDevToolsHttpBase(devtools);
  const expectedManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
  const startedAt = Date.now();
  let lastReport = null;
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const targets = fetchTargets
        ? await fetchTargets(httpBase)
        : await fetchJson(`${httpBase}/json/list`);
      const extensionManifests = readExtensionManifestsForAttach
        ? await readExtensionManifestsForAttach(httpBase)
        : await readExtensionManifests(httpBase);
      const page = selectInspectablePageTarget(targets, urlMatch);
      const pageProbe = page
        ? (readPageProbeForAttach
          ? await readPageProbeForAttach(page, httpBase)
          : await readPageAttachProbe(page))
        : null;
      lastReport = buildAttachReadinessReport({
        targets,
        urlMatch,
        expectedExtensionName: expectedManifest.name,
        extensionManifests,
        pageProbe,
      });

      if (lastReport.ready) return lastReport;
    } catch (error) {
      lastError = error;
    }
    await delay(retryDelayMs);
  }

  return lastReport ?? buildAttachReadinessReport({
    targets: [],
    urlMatch,
    expectedExtensionName: expectedManifest.name,
    extensionManifests: [],
    lastError: lastError?.message,
  });
}

async function readPageAttachProbe(target) {
  if (!target?.webSocketDebuggerUrl) {
    return {
      ok: false,
      error: 'target page has no WebSocket debugger URL',
    };
  }

  const client = await createCdpClient(target.webSocketDebuggerUrl);
  try {
    await client.send('Runtime.enable');
    return await evaluateCdpExpression(client, `(() => {
      const overlay = document.querySelector('#rvt-overlay');
      return {
        ok: true,
        href: location.href,
        hasOverlay: Boolean(overlay),
        overlayHidden: overlay ? Boolean(overlay.hidden) : null,
        overlayText: overlay?.innerText?.slice(0, 300) || '',
        contentScriptLoaded: Boolean(window.__realtimeVideoTranscriberLoaded),
        hasTranscriptFunction: typeof window.__rvtGetTranscriptSnapshot === 'function',
        hasDiagnosticsFunction: typeof window.__rvtGetDiagnosticsSnapshot === 'function',
        bodyText: document.body?.innerText?.slice(0, 300) || ''
      };
    })()`);
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  } finally {
    client.close();
  }
}

async function waitForPageLoad(client, timeoutMs, url) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const evaluation = await client.send('Runtime.evaluate', {
      expression: `({ readyState: document.readyState, href: location.href })`,
      returnByValue: true,
    });
    const value = evaluation.result.value;
    if (value?.readyState === 'complete' && (!url || value.href === url)) return;
    await delay(100);
  }

  throw new Error('Timed out waiting for page load.');
}

async function startStaticServer(rootDir) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/demo/live-caption-events') {
      serveEventSourceCaption(res);
      return;
    }

    const filePath = path.normalize(path.join(rootDir, decodeURIComponent(url.pathname)));

    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      res.writeHead(200, {
        'content-type': contentTypeFor(filePath),
      });
      res.end(data);
    });
  });
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/demo/live-caption') {
      socket.destroy();
      return;
    }

    acceptWebSocketUpgrade(req, socket);
    setTimeout(() => {
      writeWebSocketText(socket, JSON.stringify({
        type: 'subtitle',
        payload: {
          text: 'Live WebSocket subtitle from page message.',
        },
      }));
      setTimeout(() => socket.end(), 100);
    }, 300);
    return;
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function serveEventSourceCaption(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  setTimeout(() => {
    res.write('event: caption\n');
    res.write(`data: ${JSON.stringify({
      data: {
        text: 'Live EventSource subtitle from named page event.',
      },
    })}\n\n`);
    setTimeout(() => res.end(), 100);
  }, 300);
}

function acceptWebSocketUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    '',
  ].join('\r\n'));
}

function writeWebSocketText(socket, text) {
  const payload = Buffer.from(String(text), 'utf8');
  const header = payload.length < 126
    ? Buffer.from([0x81, payload.length])
    : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  socket.write(Buffer.concat([header, payload]));
}

async function waitForDevToolsEndpoint(profileDir, timeoutMs) {
  const activePortFile = path.join(profileDir, 'DevToolsActivePort');
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(activePortFile)) {
      const [port] = fs.readFileSync(activePortFile, 'utf8').trim().split('\n');
      return {
        port,
        httpBase: `http://127.0.0.1:${port}`,
      };
    }
    await delay(100);
  }

  throw new Error('Timed out waiting for Chrome DevToolsActivePort.');
}

async function waitForPageTarget(httpBase, url, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const targets = await fetchJson(`${httpBase}/json/list`);
    const target = findPageTarget(targets, url);
    if (target) return target;
    await delay(200);
  }

  throw new Error(`Timed out waiting for page target: ${url}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  return response.json();
}

export async function createCdpClient(webSocketUrl, WebSocketCtor = WebSocket) {
  const socket = new WebSocketCtor(webSocketUrl);
  const pending = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;

    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);

    if (message.error) {
      request.reject(new Error(message.error.message));
    } else {
      request.resolve(message.result);
    }
  });

  return {
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    close() {
      socket.close();
    },
  };
}

async function evaluateCdpExpression(client, expression) {
  const evaluation = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });

  if (evaluation.exceptionDetails) {
    const description = evaluation.exceptionDetails.exception?.description
      || evaluation.exceptionDetails.text
      || 'Runtime.evaluate failed.';
    throw new Error(description);
  }

  return evaluation.result.value;
}

async function readExtensionManifestFromTargets(targets) {
  const serviceWorker = targets.find((target) => target.type === 'service_worker' && target.webSocketDebuggerUrl);
  if (!serviceWorker) return null;

  const client = await createCdpClient(serviceWorker.webSocketDebuggerUrl);
  try {
    await client.send('Runtime.enable');
    const result = await client.send('Runtime.evaluate', {
      expression: 'chrome.runtime.getManifest()',
      returnByValue: true,
    });
    return result.result.value;
  } finally {
    client.close();
  }
}

async function readAttachedServiceWorkerVerification({
  httpBase,
  expectedExtensionName,
  targetUrl = '',
  urlMatch = '',
} = {}) {
  const targets = await fetchJson(`${httpBase}/json/list`).catch(() => []);
  const workers = selectExtensionServiceWorkerTargets(targets);
  if (workers.length === 0) {
    return {
      ok: false,
      error: 'No inspectable extension service worker target found. Open the extension popup once, or inspect the service worker from chrome://extensions, then retry.',
    };
  }

  const errors = [];
  for (const worker of workers) {
    try {
      const client = await createCdpClient(worker.webSocketDebuggerUrl);
      try {
        await client.send('Runtime.enable');
        const manifest = await evaluateCdpExpression(client, 'chrome.runtime.getManifest()');
        if (expectedExtensionName && manifest?.name !== expectedExtensionName) continue;

        const raw = await evaluateCdpExpression(
          client,
          buildServiceWorkerVerificationExpression({ targetUrl, urlMatch }),
        );
        return normalizeServiceWorkerVerificationResult(raw);
      } finally {
        client.close();
      }
    } catch (error) {
      errors.push(`${worker.url}: ${error.message}`);
    }
  }

  return {
    ok: false,
    error: errors.length > 0
      ? `Could not collect service worker verification evidence. ${errors.join(' | ')}`
      : `No extension service worker matched "${expectedExtensionName}".`,
  };
}

async function readExtensionManifests(httpBase) {
  const targets = await fetchJson(`${httpBase}/json/list`).catch(() => []);
  const manifests = [];

  for (const target of targets) {
    if (target.type !== 'service_worker' || !target.webSocketDebuggerUrl) continue;
    try {
      const client = await createCdpClient(target.webSocketDebuggerUrl);
      try {
        await client.send('Runtime.enable');
        const result = await client.send('Runtime.evaluate', {
          expression: 'chrome.runtime.getManifest()',
          returnByValue: true,
        });
        manifests.push(result.result.value);
      } finally {
        client.close();
      }
    } catch (error) {
      manifests.push({ error: error.message, url: target.url });
    }
  }

  return manifests;
}

async function waitForExtensionManifests(httpBase, expectedName, timeoutMs) {
  const startedAt = Date.now();
  let lastManifests = [];

  while (Date.now() - startedAt < timeoutMs) {
    lastManifests = await readExtensionManifests(httpBase);
    if (lastManifests.some((manifest) => manifest?.name === expectedName)) {
      return lastManifests;
    }
    await delay(200);
  }

  return lastManifests;
}

async function waitForOverlayResult(client, timeoutMs, fixture = {}, {
  readBackgroundVerification = null,
} = {}) {
  const startedAt = Date.now();
  let lastValue = null;

  while (Date.now() - startedAt < timeoutMs) {
    const evaluation = await client.send('Runtime.evaluate', {
      expression: `(async () => {
        const documents = [document];
        for (const frame of Array.from(document.querySelectorAll('iframe'))) {
          try {
            if (frame.contentDocument) documents.push(frame.contentDocument);
          } catch {}
        }
        const overlays = documents.flatMap((doc) => Array.from(doc.querySelectorAll('#rvt-overlay')));
        const lines = overlays.flatMap((overlay) => (
          Array.from(overlay?.querySelectorAll('.rvt-text, .rvt-current-text') || [])
            .map((node) => node.textContent)
            .filter(Boolean)
        ));
        const visibleOverlay = overlays.find((overlay) => overlay && !overlay.hidden);
        const frameDiagnostics = [];
        for (const doc of documents) {
          try {
            const view = doc.defaultView;
            if (typeof view?.__rvtGetDiagnosticsSnapshot === 'function') {
              frameDiagnostics.push(await view.__rvtGetDiagnosticsSnapshot());
            }
          } catch {}
        }
        const diagnostics = frameDiagnostics[0] || null;
        return {
          hasOverlay: overlays.length > 0,
          hidden: visibleOverlay ? false : true,
          lines,
          status: visibleOverlay?.querySelector('.rvt-status')?.textContent || '',
          diagnostics,
          frameDiagnostics,
          contentScriptLoaded: Boolean(window.__realtimeVideoTranscriberLoaded),
          subtitleText: document.querySelector('.player-timedtext-text-container')?.textContent?.trim() || '',
          bodyText: document.body?.innerText?.slice(0, 300) || ''
        };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });

    const value = evaluation.result.value;
    if (readBackgroundVerification) {
      value.background = await readBackgroundVerification().catch((error) => ({
        ok: false,
        error: error.message,
      }));
    }

    lastValue = value;
    if (smokeResultMatchesFixture(value, fixture)) {
      return value;
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for extension overlay to collect expected subtitles. Last page state: ${JSON.stringify(lastValue)}`);
}

export function contentTypeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.dfxp') || filePath.endsWith('.ttml')) return 'application/ttml+xml; charset=utf-8';
  if (filePath.endsWith('.vtt')) return 'text/vtt; charset=utf-8';
  if (filePath.endsWith('.srt')) return 'text/plain; charset=utf-8';
  if (filePath.endsWith('.lrc')) return 'text/plain; charset=utf-8';
  if (filePath.endsWith('.ass') || filePath.endsWith('.ssa')) return 'text/plain; charset=utf-8';
  if (filePath.endsWith('.bcc')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isCliEntrypoint(metaUrl, argvPath = process.argv[1], cwd = process.cwd()) {
  if (!argvPath) return false;
  return metaUrl === `file://${path.resolve(cwd, argvPath)}`;
}

if (isCliEntrypoint(import.meta.url)) {
  const cli = parseChromeSmokeCliArgs(process.argv);
  const run = cli.mode === 'print-launch-command'
    ? Promise.resolve({
      command: buildChromeAttachLaunchCommand({
        port: cli.devtools,
        profileDir: cli.profileDir || path.join(os.tmpdir(), 'rvt-attach-profile'),
        extensionDir: process.cwd(),
        url: cli.url || 'about:blank',
      }),
    })
    : cli.mode === 'diagnose-attach'
    ? diagnoseAttachReadiness({
      devtools: cli.devtools,
      urlMatch: cli.urlMatch,
      timeoutMs: cli.timeoutMs,
    })
    : cli.mode === 'attach'
    ? runAttachedPageVerification({
      devtools: cli.devtools,
      urlMatch: cli.urlMatch,
      expectedText: cli.expectedText,
      expectedDomSubtitleResource: cli.expectedDomSubtitleResource,
      minLines: cli.minLines,
      timeoutMs: cli.timeoutMs,
    })
    : runChromeSmoke({
      fixture: cli.fixture,
      url: cli.url,
      expectedText: cli.expectedText,
      minLines: cli.minLines,
      headless: !cli.headed,
      timeoutMs: cli.timeoutMs,
    });

  run
    .then((result) => {
      if (cli.mode === 'print-launch-command') {
        console.log(result.command);
        return;
      }

      if (cli.mode === 'diagnose-attach') {
        console.log(formatAttachReadinessOutput(result, {
          devtools: cli.devtools,
          urlMatch: cli.urlMatch,
        }));
        return;
      }

      if (cli.mode === 'attach') {
        if (cli.reportPath) {
          fs.writeFileSync(cli.reportPath, `${JSON.stringify(buildAttachedVerificationReport(result), null, 2)}\n`);
          console.log(`Report: ${cli.reportPath}`);
        }
        console.log(formatAttachedVerificationOutput(result));
        return;
      }

      console.log(`Chrome smoke passed: ${result.results.length} fixture(s)`);
      for (const fixtureResult of result.results) {
        console.log(`- ${fixtureResult.fixture}: ${fixtureResult.lines.length} transcript line(s), status="${fixtureResult.status}"`);
        console.log(`  URL: ${fixtureResult.url}`);
      }
      console.log(`Chrome profile: ${result.profileDir}`);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
