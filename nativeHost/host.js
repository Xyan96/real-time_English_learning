#!/opt/homebrew/bin/node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createNativeMessageParser,
  encodeNativeMessage,
} from './protocol.js';

const HOST_VERSION = '0.1.0';
const DEFAULT_PORT = 8787;
const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_SCRIPT = path.join(PROJECT_ROOT, 'server', 'transcriptionServer.js');
const HEALTH_URL = `http://127.0.0.1:${DEFAULT_PORT}/health`;

let child = null;
let ownsServer = false;
let idleTimer = null;
let lastActivityAt = Date.now();

const parse = createNativeMessageParser((message) => {
  handleMessage(message).catch((error) => {
    send({
      requestId: message?.requestId,
      ok: false,
      error: error.message,
      status: getStatus('error'),
    });
  });
});

process.stdin.on('data', parse);
process.stdin.on('end', () => {
  stopOwnedServer().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  stopOwnedServer().finally(() => process.exit(0));
});

async function handleMessage(message) {
  const requestId = message?.requestId;
  const type = String(message?.type ?? '').trim();
  markActivity(Number(message?.idleTimeoutMs));

  if (type === 'ensure') {
    await ensureServerRunning();
    send({ requestId, ok: true, status: getStatus('running') });
    return;
  }

  if (type === 'heartbeat') {
    send({ requestId, ok: true, status: getStatus(await readState()) });
    return;
  }

  if (type === 'status') {
    send({ requestId, ok: true, status: getStatus(await readState()) });
    return;
  }

  if (type === 'stop') {
    await stopOwnedServer();
    send({ requestId, ok: true, status: getStatus('stopped') });
    process.exit(0);
    return;
  }

  send({
    requestId,
    ok: false,
    error: `Unsupported native host message: ${type || '(empty)'}`,
    status: getStatus('error'),
  });
}

async function ensureServerRunning() {
  if (await isHealthy()) return;

  if (!child) {
    child = spawn(process.execPath, [SERVER_SCRIPT], {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: 'ignore',
    });
    ownsServer = true;
    child.once('exit', () => {
      child = null;
      ownsServer = false;
    });
  }

  await waitForHealthy();
}

async function waitForHealthy() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8_000) {
    if (await isHealthy()) return;
    await delay(250);
  }
  throw new Error('本地导出服务启动超时。');
}

async function readState() {
  if (await isHealthy()) return 'running';
  return child ? 'starting' : 'stopped';
}

async function isHealthy() {
  try {
    const response = await fetch(HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
}

function markActivity(idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS) {
  lastActivityAt = Date.now();
  const timeout = Number.isFinite(idleTimeoutMs) && idleTimeoutMs > 0
    ? idleTimeoutMs
    : DEFAULT_IDLE_TIMEOUT_MS;

  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    stopOwnedServer().finally(() => {
      try {
        send({ ok: true, event: 'idle-stopped', status: getStatus('stopped') });
      } finally {
        process.exit(0);
      }
    });
  }, timeout);
}

async function stopOwnedServer() {
  if (!child || !ownsServer) return;
  const nextChild = child;
  child = null;
  ownsServer = false;

  await new Promise((resolve) => {
    const forceTimer = setTimeout(() => {
      try {
        nextChild.kill('SIGKILL');
      } catch {
        // Process may have already exited.
      }
      resolve();
    }, 3_000);

    nextChild.once('exit', () => {
      clearTimeout(forceTimer);
      resolve();
    });

    try {
      nextChild.kill('SIGTERM');
    } catch {
      clearTimeout(forceTimer);
      resolve();
    }
  });
}

function getStatus(state) {
  return {
    state,
    version: HOST_VERSION,
    pid: child?.pid ?? null,
    ownsServer,
    port: DEFAULT_PORT,
    healthUrl: HEALTH_URL,
    projectRoot: PROJECT_ROOT,
    lastActivityAt,
  };
}

function send(message) {
  process.stdout.write(encodeNativeMessage(message));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
