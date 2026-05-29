import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectExtensionFiles,
  validateExtensionPackage,
} from '../tools/validateExtension.js';

test('collectExtensionFiles includes manifest referenced scripts, styles, and resources', () => {
  const manifest = {
    background: { service_worker: 'src/background/serviceWorker.js' },
    icons: {
      16: 'icons/icon-16.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_popup: 'src/popup/popup.html',
      default_icon: {
        32: 'icons/icon-32.png',
      },
    },
    content_scripts: [
      {
        js: ['src/content/contentScript.js'],
        css: ['src/content/overlay.css'],
      },
    ],
    web_accessible_resources: [
      {
        resources: ['src/content/siteSubtitles.js'],
      },
    ],
  };

  assert.deepEqual(
    Array.from(collectExtensionFiles(manifest)).toSorted(),
    [
      'icons/icon-128.png',
      'icons/icon-16.png',
      'icons/icon-32.png',
      'manifest.json',
      'src/background/contentScriptInjection.js',
      'src/background/nativeServiceManager.js',
      'src/background/serviceWorker.js',
      'src/background/subtitleTrackFetcher.js',
      'src/background/transcriptCollector.js',
      'src/content/contentScript.js',
      'src/content/overlay.css',
      'src/content/siteSubtitles.js',
      'src/popup/activeTabMessaging.js',
      'src/popup/autoFallback.js',
      'src/popup/obsidianFallback.js',
      'src/popup/popup.css',
      'src/popup/popup.html',
      'src/popup/popup.js',
      'src/popup/popupStatus.js',
      'src/shared/deduper.js',
      'src/shared/exporter.js',
      'src/shared/extractionIntensity.js',
      'src/shared/extractor.js',
      'src/shared/filters.js',
      'src/shared/learningAnalysis.js',
      'src/shared/learningRules.js',
      'src/shared/normalizer.js',
      'src/shared/obsidianExport.js',
      'src/shared/scorer.js',
      'src/shared/settings.js',
      'src/shared/subtitleCleaner.js',
      'src/shared/subtitleDedup.js',
      'src/shared/transcriptExport.js',
    ],
  );
});

test('collectExtensionFilesFromPackage includes popup relative assets', () => {
  const manifest = {
    background: { service_worker: 'src/background/serviceWorker.js' },
    action: { default_popup: 'src/popup/popup.html' },
    content_scripts: [],
    web_accessible_resources: [],
  };
  const files = new Map([
    ['/virtual/src/popup/popup.html', [
      '<link rel="stylesheet" href="./popup.css">',
      '<script type="module" src="./popup.js"></script>',
    ].join('\n')],
  ]);

  assert.deepEqual(
    Array.from(
      collectExtensionFiles({
        rootDir: '/virtual',
        manifest,
        readText: (path) => files.get(path) ?? '',
      }),
    ).toSorted(),
    [
      'manifest.json',
      'src/background/serviceWorker.js',
      'src/popup/popup.css',
      'src/popup/popup.html',
      'src/popup/popup.js',
    ],
  );
});

test('collectExtensionFilesFromPackage includes static module imports and offscreen documents', () => {
  const manifest = {
    background: { service_worker: 'src/background/serviceWorker.js' },
    action: { default_popup: 'src/popup/popup.html' },
    content_scripts: [],
    web_accessible_resources: [],
  };
  const files = new Map([
    ['/virtual/src/background/serviceWorker.js', [
      "const OFFSCREEN_URL = 'src/offscreen/offscreen.html';",
      'chrome.offscreen.createDocument({ url: OFFSCREEN_URL });',
    ].join('\n')],
    ['/virtual/src/offscreen/offscreen.html', '<script type="module" src="./offscreen.js"></script>'],
    ['/virtual/src/offscreen/offscreen.js', "import { createTranscriptionClient } from './transcriptionClient.js';"],
    ['/virtual/src/popup/popup.html', '<script type="module" src="./popup.js"></script>'],
    ['/virtual/src/popup/popup.js', "import { getInitialPopupStatus } from './popupStatus.js';"],
  ]);

  assert.deepEqual(
    Array.from(
      collectExtensionFiles({
        rootDir: '/virtual',
        manifest,
        readText: (path) => files.get(path) ?? '',
      }),
    ).toSorted(),
    [
      'manifest.json',
      'src/background/serviceWorker.js',
      'src/offscreen/offscreen.html',
      'src/offscreen/offscreen.js',
      'src/offscreen/transcriptionClient.js',
      'src/popup/popup.html',
      'src/popup/popup.js',
      'src/popup/popupStatus.js',
    ],
  );
});

test('validateExtensionPackage rejects missing MV3 permissions', () => {
  const errors = validateExtensionPackage({
    rootDir: '/virtual',
    manifest: {
      manifest_version: 3,
      permissions: ['activeTab'],
      background: { service_worker: 'src/background/serviceWorker.js', type: 'module' },
      action: { default_popup: 'src/popup/popup.html' },
      content_scripts: [],
      web_accessible_resources: [],
    },
    exists: () => true,
    readText: () => '',
  });

    assert.match(errors.join('\n'), /Missing required permission: nativeMessaging/);
});

test('validateExtensionPackage requires content scripts to run in all frames', () => {
  const errors = validateExtensionPackage({
    rootDir: '/virtual',
    manifest: {
      manifest_version: 3,
      permissions: ['activeTab', 'nativeMessaging', 'scripting', 'storage'],
      background: { service_worker: 'src/background/serviceWorker.js', type: 'module' },
      action: { default_popup: 'src/popup/popup.html' },
      content_scripts: [{ js: ['src/content/contentScript.js'], css: [] }],
      web_accessible_resources: [],
    },
    exists: () => true,
    readText: () => '',
  });

  assert.match(errors.join('\n'), /Content script must run in all frames: src\/content\/contentScript\.js/);
});

test('validateExtensionPackage requires content scripts to match origin fallback frames', () => {
  const errors = validateExtensionPackage({
    rootDir: '/virtual',
    manifest: {
      manifest_version: 3,
      permissions: ['activeTab', 'nativeMessaging', 'scripting', 'storage'],
      background: { service_worker: 'src/background/serviceWorker.js', type: 'module' },
      action: { default_popup: 'src/popup/popup.html' },
      content_scripts: [
        {
          js: ['src/content/contentScript.js'],
          css: [],
          all_frames: true,
        },
      ],
      web_accessible_resources: [],
    },
    exists: () => true,
    readText: () => '',
  });

  assert.match(
    errors.join('\n'),
    /Content script must match origin fallback frames: src\/content\/contentScript\.js/,
  );
});

test('validateExtensionPackage checks dynamic import resources', () => {
  const files = new Map([
    ['/virtual/src/content/contentScript.js', "importModule(chrome.runtime.getURL('src/shared/segments.js'))"],
    ['/virtual/src/popup/popup.html', '<script type="module" src="./popup.js"></script>'],
  ]);

  const errors = validateExtensionPackage({
    rootDir: '/virtual',
    manifest: {
      manifest_version: 3,
      permissions: ['activeTab', 'nativeMessaging', 'scripting', 'storage'],
      background: { service_worker: 'src/background/serviceWorker.js', type: 'module' },
      action: { default_popup: 'src/popup/popup.html' },
      content_scripts: [{ js: ['src/content/contentScript.js'], css: [] }],
      web_accessible_resources: [],
    },
    exists: (path) => files.has(path) || path.endsWith('manifest.json') || path.endsWith('serviceWorker.js'),
    readText: (path) => files.get(path) ?? '',
  });

  assert.match(errors.join('\n'), /Dynamic import resource is not web-accessible: src\/shared\/segments\.js/);
});

test('validateExtensionPackage checks transitive dynamic import resources', () => {
  const files = new Map([
    ['/virtual/src/content/contentScript.js', "importModule(chrome.runtime.getURL('src/shared/learningAnalysis.js'))"],
    ['/virtual/src/shared/learningAnalysis.js', "import { normalizeExtractionIntensity } from './extractionIntensity.js';"],
    ['/virtual/src/shared/extractionIntensity.js', 'export function normalizeExtractionIntensity(value) { return Number(value) || 50; }'],
    ['/virtual/src/popup/popup.html', '<script type="module" src="./popup.js"></script>'],
    ['/virtual/src/popup/popup.js', ''],
  ]);

  const errors = validateExtensionPackage({
    rootDir: '/virtual',
    manifest: {
      manifest_version: 3,
      permissions: ['activeTab', 'nativeMessaging', 'scripting', 'storage'],
      background: { service_worker: 'src/background/serviceWorker.js', type: 'module' },
      action: { default_popup: 'src/popup/popup.html' },
      content_scripts: [{ js: ['src/content/contentScript.js'], css: [], all_frames: true, match_origin_as_fallback: true }],
      web_accessible_resources: [
        { resources: ['src/shared/learningAnalysis.js'] },
      ],
    },
    exists: (path) => files.has(path) || path.endsWith('manifest.json') || path.endsWith('serviceWorker.js'),
    readText: (path) => files.get(path) ?? '',
  });

  assert.match(errors.join('\n'), /Dynamic import dependency is not web-accessible: src\/shared\/extractionIntensity\.js/);
});
