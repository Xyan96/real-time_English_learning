const DEFAULT_HOST_NAME = 'com.realtime_english_learning.host';
const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export function createNativeServiceManager(chromeApi, {
  hostName = DEFAULT_HOST_NAME,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
} = {}) {
  let port = null;
  let nextRequestId = 1;
  let cachedStatus = { state: 'unknown' };
  const pending = new Map();

  function connect() {
    if (port) return port;
    if (typeof chromeApi?.runtime?.connectNative !== 'function') {
      throw new Error('当前浏览器不支持本机助手。');
    }

    try {
      port = chromeApi.runtime.connectNative(hostName);
    } catch (error) {
      throw new Error(`本机助手未安装或无法启动：${error.message}`);
    }

    port.onMessage.addListener((message) => {
      if (message?.status) cachedStatus = message.status;
      const requestId = message?.requestId;
      if (!requestId || !pending.has(requestId)) return;
      const callbacks = pending.get(requestId);
      pending.delete(requestId);
      if (message.ok === false) {
        callbacks.reject(new Error(message.error || '本机助手请求失败。'));
        return;
      }
      callbacks.resolve(message);
    });

    port.onDisconnect.addListener(() => {
      const error = new Error(chromeApi.runtime.lastError?.message || '本机助手连接已断开。');
      for (const callbacks of pending.values()) {
        callbacks.reject(error);
      }
      pending.clear();
      port = null;
      cachedStatus = { ...cachedStatus, state: cachedStatus.state === 'running' ? 'unknown' : cachedStatus.state };
    });

    return port;
  }

  function request(type, body = {}) {
    const requestId = nextRequestId;
    nextRequestId += 1;
    const activePort = connect();
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      activePort.postMessage({
        ...body,
        type,
        requestId,
        idleTimeoutMs,
      });
    });
  }

  async function ensureService() {
    const response = await request('ensure');
    return normalizeResponse(response);
  }

  async function stopService() {
    const response = await request('stop');
    return normalizeResponse(response);
  }

  async function getStatus() {
    try {
      const response = await request('status');
      return normalizeResponse(response);
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        status: cachedStatus,
      };
    }
  }

  async function heartbeat() {
    const response = await request('heartbeat');
    return normalizeResponse(response);
  }

  return {
    ensureService,
    stopService,
    getStatus,
    heartbeat,
  };
}

export function isLocalServiceEndpoint(endpoint) {
  try {
    const url = new URL(String(endpoint ?? ''));
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function normalizeResponse(response) {
  return {
    ok: response?.ok !== false,
    status: response?.status ?? { state: 'unknown' },
  };
}
