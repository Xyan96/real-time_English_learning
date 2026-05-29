import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createNativeMessageParser,
  encodeNativeMessage,
} from '../nativeHost/protocol.js';
import {
  buildNativeHostLauncher,
  buildNativeHostManifest,
  getExtensionIdFromManifestKey,
  installNativeHost,
} from '../tools/installNativeHost.js';

const MANIFEST_KEY = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')).key;

test('native host protocol parses length-prefixed JSON messages', () => {
  const messages = [];
  const parser = createNativeMessageParser((message) => messages.push(message));
  const encoded = encodeNativeMessage({ type: 'ensure', requestId: 7 });

  parser(encoded.subarray(0, 3));
  assert.deepEqual(messages, []);
  parser(encoded.subarray(3));

  assert.deepEqual(messages, [{ type: 'ensure', requestId: 7 }]);
});

test('installNativeHost builds a Chrome native messaging manifest', () => {
  const extensionId = getExtensionIdFromManifestKey(MANIFEST_KEY);
  const manifest = buildNativeHostManifest({
    hostPath: '/Users/me/project/nativeHost/host.js',
    extensionId,
  });

  assert.equal(extensionId, 'fcodklpbgmifpflfafekidokjjcceloe');
  assert.deepEqual(manifest, {
    name: 'com.realtime_english_learning.host',
    description: 'Realtime English Learning local service helper',
    path: '/Users/me/project/nativeHost/host.js',
    type: 'stdio',
    allowed_origins: ['chrome-extension://fcodklpbgmifpflfafekidokjjcceloe/'],
  });
});

test('installNativeHost writes a launcher with an absolute Node path', async () => {
  const tempRoot = fs.mkdtempSync(path.join(tmpdir(), 'native-host-install-'));
  const rootDir = path.join(tempRoot, 'project');
  const homeDir = path.join(tempRoot, 'home');
  await mkdir(path.join(rootDir, 'nativeHost'), { recursive: true });
  await writeFile(path.join(rootDir, 'manifest.json'), JSON.stringify({ key: MANIFEST_KEY }), 'utf8');
  await writeFile(path.join(rootDir, 'nativeHost', 'host.js'), '#!/usr/bin/env node\n', 'utf8');

  const result = await installNativeHost({
    rootDir,
    homeDir,
    platform: 'darwin',
    nodePath: '/opt/homebrew/bin/node',
  });

  const launcherPath = path.join(homeDir, 'Library/Application Support/RealtimeEnglishLearning/NativeHost/launch-host.sh');
  assert.equal(result.hostPath, launcherPath);
  assert.equal(await readFile(launcherPath, 'utf8'), buildNativeHostLauncher({
    nodePath: '/opt/homebrew/bin/node',
    hostPath: path.join(rootDir, 'nativeHost', 'host.js'),
  }));
  assert.equal((await stat(launcherPath)).mode & 0o755, 0o755);

  const nativeManifest = JSON.parse(await readFile(result.written[0], 'utf8'));
  assert.equal(nativeManifest.path, launcherPath);
});
