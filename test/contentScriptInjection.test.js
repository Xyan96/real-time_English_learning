import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureContentScript } from '../src/background/contentScriptInjection.js';

test('ensureContentScript injects page-world interceptor before overlay script when ping fails', async () => {
  const calls = [];
  const chromeApi = {
    tabs: {
      sendMessage: async (tabId, message) => {
        calls.push({ api: 'tabs.sendMessage', tabId, message });
        throw new Error('Receiving end does not exist.');
      },
    },
    scripting: {
      executeScript: async (details) => {
        calls.push({ api: 'scripting.executeScript', details });
      },
      insertCSS: async (details) => {
        calls.push({ api: 'scripting.insertCSS', details });
      },
    },
  };

  await ensureContentScript(chromeApi, 42);

  assert.deepEqual(calls, [
    {
      api: 'scripting.executeScript',
      details: {
        target: { tabId: 42, allFrames: true },
        files: ['src/content/pageSubtitleInterceptor.js'],
        world: 'MAIN',
      },
    },
    {
      api: 'tabs.sendMessage',
      tabId: 42,
      message: { type: 'PING_TRANSCRIBER_OVERLAY' },
    },
    {
      api: 'scripting.insertCSS',
      details: {
        target: { tabId: 42, allFrames: true },
        files: ['src/content/overlay.css'],
      },
    },
    {
      api: 'scripting.executeScript',
      details: {
        target: { tabId: 42, allFrames: true },
        files: ['src/content/contentScript.js'],
      },
    },
  ]);
});

test('ensureContentScript still injects page-world interceptor when overlay already responds', async () => {
  const calls = [];
  const chromeApi = {
    tabs: {
      sendMessage: async (tabId, message) => {
        calls.push({ api: 'tabs.sendMessage', tabId, message });
        return { ok: true };
      },
    },
    scripting: {
      executeScript: async (details) => {
        calls.push({ api: 'scripting.executeScript', details });
      },
      insertCSS: async (details) => {
        calls.push({ api: 'scripting.insertCSS', details });
      },
    },
  };

  await ensureContentScript(chromeApi, 42);

  assert.deepEqual(calls, [
    {
      api: 'scripting.executeScript',
      details: {
        target: { tabId: 42, allFrames: true },
        files: ['src/content/pageSubtitleInterceptor.js'],
        world: 'MAIN',
      },
    },
    {
      api: 'tabs.sendMessage',
      tabId: 42,
      message: { type: 'PING_TRANSCRIBER_OVERLAY' },
    },
  ]);
});
