import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createNativeServiceManager,
  isLocalServiceEndpoint,
} from '../src/background/nativeServiceManager.js';

test('native service manager sends ensure requests through Chrome native messaging', async () => {
  const posted = [];
  let messageListener = null;
  const chromeApi = {
    runtime: {
      connectNative(hostName) {
        assert.equal(hostName, 'com.realtime_english_learning.host');
        return {
          postMessage(message) {
            posted.push(message);
            messageListener?.({
              requestId: message.requestId,
              ok: true,
              status: { state: 'running', port: 8787 },
            });
          },
          onMessage: {
            addListener(listener) {
              messageListener = listener;
            },
          },
          onDisconnect: {
            addListener() {},
          },
        };
      },
    },
  };

  const manager = createNativeServiceManager(chromeApi, { idleTimeoutMs: 1234 });
  const result = await manager.ensureService();

  assert.deepEqual(result, {
    ok: true,
    status: { state: 'running', port: 8787 },
  });
  assert.equal(posted[0].type, 'ensure');
  assert.equal(posted[0].idleTimeoutMs, 1234);
});

test('native service manager identifies local endpoints', () => {
  assert.equal(isLocalServiceEndpoint('http://localhost:8787/analyze'), true);
  assert.equal(isLocalServiceEndpoint('http://127.0.0.1:8787/analyze'), true);
  assert.equal(isLocalServiceEndpoint('https://api.example.test/analyze'), false);
  assert.equal(isLocalServiceEndpoint('not a url'), false);
});
