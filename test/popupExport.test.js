import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  formatObsidianExportNetworkError,
} from '../src/popup/obsidianFallback.js';

const popupJs = fs.readFileSync(new URL('../src/popup/popup.js', import.meta.url), 'utf8');

test('popup export requires the local service for direct Obsidian writes', () => {
  assert.match(popupJs, /catch\s*\(\s*error\s*\)/);
  assert.match(popupJs, /formatObsidianExportNetworkError\(error, settings\.obsidianExportEndpoint\)/);
  assert.doesNotMatch(popupJs, /downloadObsidianMarkdownFallback/);
  assert.match(popupJs, /无法直接导出到 Obsidian 目录/);
  assert.match(popupJs, /readResponseError/);
  assert.match(popupJs, /await response\.json\(\)/);
});

test('formatObsidianExportNetworkError explains local service outages in Chinese', () => {
  assert.equal(
    formatObsidianExportNetworkError(new TypeError('Failed to fetch'), 'http://localhost:8787/obsidian/export'),
    '无法直接导出到 Obsidian 目录：未检测到本地导出服务（http://localhost:8787/obsidian/export）。请在项目目录运行 npm run transcribe-server，然后重新点击导出。',
  );
});
