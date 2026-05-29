import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const HOST_NAME = 'com.realtime_english_learning.host';
const HOST_DESCRIPTION = 'Realtime English Learning local service helper';
const HOST_DIRS_BY_PLATFORM = {
  darwin: [
    'Library/Application Support/Google/Chrome/NativeMessagingHosts',
    'Library/Application Support/Chromium/NativeMessagingHosts',
    'Library/Application Support/Google/Chrome for Testing/NativeMessagingHosts',
  ],
};
const HOST_RUNTIME_DIR = 'Library/Application Support/RealtimeEnglishLearning/NativeHost';

export function getExtensionIdFromManifestKey(key) {
  const der = Buffer.from(String(key ?? '').trim(), 'base64');
  if (der.length === 0) throw new Error('manifest.json 缺少 key，无法推导扩展 ID。');
  const hash = createHash('sha256').update(der).digest().subarray(0, 16);
  const alphabet = 'abcdefghijklmnop';
  return Array.from(hash).map((byte) => alphabet[byte >> 4] + alphabet[byte & 15]).join('');
}

export function buildNativeHostManifest({
  hostPath,
  extensionId,
} = {}) {
  const normalizedHostPath = path.resolve(String(hostPath ?? ''));
  const normalizedExtensionId = String(extensionId ?? '').trim();
  if (!normalizedExtensionId) throw new Error('缺少 Chrome 扩展 ID。');

  return {
    name: HOST_NAME,
    description: HOST_DESCRIPTION,
    path: normalizedHostPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${normalizedExtensionId}/`],
  };
}

export function buildNativeHostLauncher({
  nodePath = process.execPath,
  hostPath,
} = {}) {
  const normalizedNodePath = path.resolve(String(nodePath ?? ''));
  const normalizedHostPath = path.resolve(String(hostPath ?? ''));
  if (!normalizedNodePath) throw new Error('缺少 Node.js 路径。');
  if (!normalizedHostPath) throw new Error('缺少 native host 脚本路径。');

  return [
    '#!/bin/sh',
    `exec ${quoteShell(normalizedNodePath)} ${quoteShell(normalizedHostPath)} "$@"`,
    '',
  ].join('\n');
}

export async function installNativeHost({
  rootDir = process.cwd(),
  homeDir = os.homedir(),
  platform = process.platform,
  extensionId,
  nodePath = process.execPath,
} = {}) {
  const manifestPath = path.join(rootDir, 'manifest.json');
  const extensionManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const resolvedExtensionId = extensionId || getExtensionIdFromManifestKey(extensionManifest.key);
  const hostScriptPath = path.join(rootDir, 'nativeHost', 'host.js');
  const hostRuntimeDir = path.join(homeDir, HOST_RUNTIME_DIR);
  const hostPath = path.join(hostRuntimeDir, 'launch-host.sh');
  await fs.mkdir(hostRuntimeDir, { recursive: true });
  await fs.writeFile(hostPath, buildNativeHostLauncher({
    nodePath,
    hostPath: hostScriptPath,
  }), 'utf8');
  const nativeManifest = buildNativeHostManifest({
    hostPath,
    extensionId: resolvedExtensionId,
  });

  await fs.chmod(hostPath, 0o755);
  await fs.chmod(hostScriptPath, 0o755);

  const targetDirs = HOST_DIRS_BY_PLATFORM[platform];
  if (!targetDirs) {
    throw new Error(`暂不支持自动安装 Native Messaging host：${platform}`);
  }

  const written = [];
  for (const relativeDir of targetDirs) {
    const targetDir = path.join(homeDir, relativeDir);
    await fs.mkdir(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, `${HOST_NAME}.json`);
    await fs.writeFile(targetPath, `${JSON.stringify(nativeManifest, null, 2)}\n`, 'utf8');
    written.push(targetPath);
  }

  return {
    ok: true,
    extensionId: resolvedExtensionId,
    hostPath,
    hostScriptPath,
    written,
  };
}

function quoteShell(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--extension-id') {
      args.extensionId = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  installNativeHost(parseArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(`Native host installed for extension ${result.extensionId}`);
      for (const targetPath of result.written) {
        console.log(targetPath);
      }
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
