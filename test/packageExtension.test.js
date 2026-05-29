import test from 'node:test';
import assert from 'node:assert/strict';

import { getPackageFileList } from '../tools/packageExtension.js';

test('getPackageFileList includes only runtime extension files', () => {
  const manifest = {
    background: { service_worker: 'src/background/serviceWorker.js' },
    action: { default_popup: 'src/popup/popup.html' },
    content_scripts: [
      {
        js: ['src/content/contentScript.js'],
        css: ['src/content/overlay.css'],
      },
    ],
    web_accessible_resources: [
      {
        resources: ['src/shared/segments.js'],
      },
    ],
  };
  const files = new Map([
    ['/virtual/src/popup/popup.html', [
      '<link rel="stylesheet" href="./popup.css">',
      '<script type="module" src="./popup.js"></script>',
    ].join('\n')],
  ]);

  assert.deepEqual(
    getPackageFileList({
      rootDir: '/virtual',
      manifest,
      readText: (path) => files.get(path) ?? '',
    }),
    [
      'manifest.json',
      'src/background/serviceWorker.js',
      'src/content/contentScript.js',
      'src/content/overlay.css',
      'src/popup/popup.css',
      'src/popup/popup.html',
      'src/popup/popup.js',
      'src/shared/segments.js',
    ],
  );
});
