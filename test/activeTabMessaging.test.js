import test from 'node:test';
import assert from 'node:assert/strict';

import { sendActiveTabMessage } from '../src/popup/activeTabMessaging.js';

test('sendActiveTabMessage retries after ensuring the content script is injected', async () => {
  const runtimeMessages = [];
  const tabMessages = [];
  let tabMessageAttempts = 0;
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 7 }],
      sendMessage: async (tabId, message) => {
        tabMessages.push({ tabId, message });
        tabMessageAttempts += 1;
        if (tabMessageAttempts === 1) {
          throw new Error('Receiving end does not exist.');
        }
        return { ok: true, segments: [] };
      },
    },
    runtime: {
      sendMessage: async (message) => {
        runtimeMessages.push(message);
        return { ok: true };
      },
    },
  };

  const response = await sendActiveTabMessage(chromeApi, { type: 'PING_TRANSCRIBER_OVERLAY' });

  assert.deepEqual(response, { ok: true, segments: [] });
  assert.deepEqual(runtimeMessages, [
    {
      target: 'background',
      type: 'ENSURE_CONTENT_SCRIPT',
      tabId: 7,
    },
  ]);
  assert.deepEqual(tabMessages, [
    { tabId: 7, message: { type: 'PING_TRANSCRIBER_OVERLAY' } },
    { tabId: 7, message: { type: 'PING_TRANSCRIBER_OVERLAY' } },
  ]);
});

test('sendActiveTabMessage collects transcripts through background all-frame aggregation', async () => {
  const runtimeMessages = [];
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 7 }],
      sendMessage: async () => {
        throw new Error('GET_TRANSCRIPT should use background aggregation.');
      },
    },
    runtime: {
      sendMessage: async (message) => {
        runtimeMessages.push(message);
        return { ok: true, segments: [{ id: 'frame-seg', text: 'Iframe subtitle.' }] };
      },
    },
  };

  const response = await sendActiveTabMessage(chromeApi, { type: 'GET_TRANSCRIPT' });

  assert.deepEqual(response, { ok: true, segments: [{ id: 'frame-seg', text: 'Iframe subtitle.' }] });
  assert.deepEqual(runtimeMessages, [
    {
      target: 'background',
      type: 'COLLECT_TRANSCRIPT',
      tabId: 7,
    },
  ]);
});

test('sendActiveTabMessage collects diagnostics through background all-frame aggregation', async () => {
  const runtimeMessages = [];
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 7 }],
      sendMessage: async () => {
        throw new Error('GET_DIAGNOSTICS should use background aggregation.');
      },
    },
    runtime: {
      sendMessage: async (message) => {
        runtimeMessages.push(message);
        return { ok: true, transcriptCount: 1, renderedSubtitles: { count: 1 } };
      },
    },
  };

  const response = await sendActiveTabMessage(chromeApi, { type: 'GET_DIAGNOSTICS' });

  assert.deepEqual(response, { ok: true, transcriptCount: 1, renderedSubtitles: { count: 1 } });
  assert.deepEqual(runtimeMessages, [
    {
      target: 'background',
      type: 'COLLECT_DIAGNOSTICS',
      tabId: 7,
    },
  ]);
});

test('sendActiveTabMessage collects learning history through background all-frame aggregation', async () => {
  const runtimeMessages = [];
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 7 }],
      sendMessage: async () => {
        throw new Error('GET_LEARNING_HISTORY should use background aggregation.');
      },
    },
    runtime: {
      sendMessage: async (message) => {
        runtimeMessages.push(message);
        return { ok: true, highlights: [{ text: 'being raised' }] };
      },
    },
  };

  const response = await sendActiveTabMessage(chromeApi, { type: 'GET_LEARNING_HISTORY' });

  assert.deepEqual(response, { ok: true, highlights: [{ text: 'being raised' }] });
  assert.deepEqual(runtimeMessages, [
    {
      target: 'background',
      type: 'COLLECT_LEARNING_HISTORY',
      tabId: 7,
    },
  ]);
});

test('sendActiveTabMessage clears transcripts through background all-frame aggregation', async () => {
  const runtimeMessages = [];
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 7 }],
      sendMessage: async () => {
        throw new Error('CLEAR_TRANSCRIPT should use background aggregation.');
      },
    },
    runtime: {
      sendMessage: async (message) => {
        runtimeMessages.push(message);
        return { ok: true, clearedFrames: 2 };
      },
    },
  };

  const response = await sendActiveTabMessage(chromeApi, { type: 'CLEAR_TRANSCRIPT' });

  assert.deepEqual(response, { ok: true, clearedFrames: 2 });
  assert.deepEqual(runtimeMessages, [
    {
      target: 'background',
      type: 'CLEAR_TRANSCRIPTS',
      tabId: 7,
    },
  ]);
});

test('sendActiveTabMessage reports a missing active tab', async () => {
  const response = await sendActiveTabMessage({
    tabs: {
      query: async () => [],
    },
  }, { type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, false);
  assert.match(response.error, /没有找到当前活动标签页/);
});

test('sendActiveTabMessage preserves the overlay missing error when injection fails', async () => {
  const response = await sendActiveTabMessage({
    tabs: {
      query: async () => [{ id: 3 }],
      sendMessage: async () => {
        throw new Error('No receiving end');
      },
    },
    runtime: {
      sendMessage: async () => ({ ok: false, error: 'Cannot inject into this page.' }),
    },
  }, { type: 'PING_TRANSCRIBER_OVERLAY' });

  assert.equal(response.ok, false);
  assert.match(response.error, /当前标签页没有字幕浮窗/);
});
