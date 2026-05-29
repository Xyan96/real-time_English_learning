import test from 'node:test';
import assert from 'node:assert/strict';

import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTranscriptionServer } from '../server/transcriptionServer.js';

test('transcription server responds to health checks', async () => {
  const { server, baseUrl } = await listenWithFakeTranscriber();

  try {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    await closeServer(server);
  }
});

test('transcription server accepts extension multipart chunks', async () => {
  const calls = [];
  const { server, baseUrl } = await listenWithFakeTranscriber({
    async transcribe(input) {
      calls.push(input);
      return {
        text: 'Captured tab audio.',
        translatedText: '',
        language: 'en',
        isFinal: true,
      };
    },
  });

  try {
    const body = new FormData();
    body.set('audio', new Blob(['audio'], { type: 'audio/webm' }), 'chunk-2.webm');
    body.set('sequence', '2');
    body.set('sourceUrl', 'https://www.netflix.com/watch/1');

    const response = await fetch(`${baseUrl}/transcribe`, {
      method: 'POST',
      body,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      text: 'Captured tab audio.',
      translatedText: '',
      language: 'en',
      isFinal: true,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].filename, 'chunk-2.webm');
    assert.match(calls[0].prompt, /netflix\.com/);
  } finally {
    await closeServer(server);
  }
});

test('transcription server forwards multipart API keys to audio transcription', async () => {
  const calls = [];
  const { server, baseUrl } = await listenWithFakeTranscriber({
    async transcribe(input) {
      calls.push(input);
      return {
        text: 'Captured tab audio.',
        translatedText: '',
        language: 'en',
        isFinal: true,
      };
    },
  });

  try {
    const body = new FormData();
    body.set('audio', new Blob(['audio'], { type: 'audio/webm' }), 'chunk-3.webm');
    body.set('sequence', '3');
    body.set('apiKey', 'sk-request-test');

    const response = await fetch(`${baseUrl}/transcribe`, {
      method: 'POST',
      body,
    });

    assert.equal(response.status, 200);
    assert.equal(calls[0].apiKey, 'sk-request-test');
  } finally {
    await closeServer(server);
  }
});

test('transcription server analyzes subtitle lines for learning highlights', async () => {
  const calls = [];
  const { server, baseUrl } = await listenWithFakeTranscriber({
    async analyze(input) {
      calls.push(input);
      return {
        items: [
          { type: 'phrase', text: 'ready our defenses', translation: '准备好防御', difficulty: 'B2' },
        ],
      };
    },
  });

  try {
    const response = await fetch(`${baseUrl}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'All right, ready our defenses!',
        context: ['Previous line.'],
        level: 'B2',
        apiKey: 'sk-request-test',
      }),
    });

    assert.equal(response.status, 200);
    const expectedItems = [
      { type: 'phrase', text: 'ready our defenses', translation: '准备好防御', difficulty: 'B2', start: 11, end: 29 },
    ];
    assert.deepEqual(await response.json(), {
      realtimeItems: expectedItems,
      exportItems: expectedItems,
      items: expectedItems,
    });
    assert.deepEqual(calls, [
      {
        text: 'All right, ready our defenses!',
        context: ['Previous line.'],
        level: 'B2',
        includeProperNouns: false,
        technicalMode: false,
        includeUiTerms: false,
        minUsefulnessScore: undefined,
        intensity: 50,
        apiKey: 'sk-request-test',
      },
    ]);
  } finally {
    await closeServer(server);
  }
});

test('transcription server keeps subtitle analysis playback friendly', async () => {
  const { server, baseUrl } = await listenWithFakeTranscriber({
    async analyze() {
      return {
        items: [
          {
            type: 'idiom',
            expression: 'scratch the surface',
            surface: 'scratching the surface',
            meaning_zh: '只触及表面',
            difficulty: 'B2',
          },
          {
            type: 'advanced_word',
            expression: 'demonstration',
            surface: 'demonstration',
            meaning_zh: '演示',
            difficulty: 'B2',
          },
          {
            type: 'advanced_word',
            expression: 'revolutionary',
            surface: 'revolutionary',
            meaning_zh: '革命性的',
            difficulty: 'C1',
          },
        ],
      };
    },
  });

  try {
    const response = await fetch(`${baseUrl}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: "This will be a revolutionary demonstration, but we're only scratching the surface.",
        level: 'B2',
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.realtimeItems.length, 2);
    assert.deepEqual(payload.realtimeItems.map((item) => item.expression), [
      'scratch the surface',
      'revolutionary',
    ]);
    assert.deepEqual(payload.items, payload.realtimeItems);
  } finally {
    await closeServer(server);
  }
});

test('transcription server returns realtime and export items by extraction intensity', async () => {
  const calls = [];
  const { server, baseUrl } = await listenWithFakeTranscriber({
    async analyze(input) {
      calls.push(input);
      return { items: [] };
    },
  });

  try {
    const response = await fetch(`${baseUrl}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: "This will be a super fast paced demonstration. But we're only scratching the surface.",
        level: 'B2',
        intensity: 20,
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.realtimeItems.map((item) => item.expression), ['scratch the surface']);
    assert.deepEqual(payload.exportItems.map((item) => item.expression), [
      'scratch the surface',
      'fast-paced',
    ]);
    assert.equal(calls[0].intensity, 20);
  } finally {
    await closeServer(server);
  }
});

test('transcription server honors includeProperNouns for named entity exports', async () => {
  const calls = [];
  const { server, baseUrl } = await listenWithFakeTranscriber({
    async analyze(input) {
      calls.push(input);
      return { items: [] };
    },
  });

  try {
    const response = await fetch(`${baseUrl}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: 'Sokka and Katara found Aang.',
        level: 'B2',
        includeProperNouns: true,
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.items.map((item) => item.expression), ['Katara', 'Sokka']);
    assert.equal(payload.items.every((item) => item.type === 'named_entity' && item.exportable === true), true);
    assert.equal(calls[0].includeProperNouns, true);
  } finally {
    await closeServer(server);
  }
});

test('transcription server exports highlights to an Obsidian markdown file', async () => {
  const writes = [];
  const { server, baseUrl } = await listenWithFakeTranscriber({
    async exportObsidian(input) {
      writes.push(input);
      return {
        ok: true,
        path: '/Users/me/Notes/English Watching/2026-05-29.md',
        bytesWritten: 220,
      };
    },
  });

  try {
    const payload = {
      vaultPath: '/Users/me/Notes',
      subdir: 'English Watching',
      pageTitle: 'Netflix',
      sourceUrl: 'https://www.netflix.com/watch/70116062',
      segment: { startedAt: 1_099_000, text: 'All right, ready our defenses!' },
      analysis: { items: [{ type: 'phrase', text: 'ready our defenses', translation: '准备好防御' }] },
    };
    const response = await fetch(`${baseUrl}/obsidian/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      path: '/Users/me/Notes/English Watching/2026-05-29.md',
      bytesWritten: 220,
    });
    assert.deepEqual(writes, [payload]);
  } finally {
    await closeServer(server);
  }
});

test('transcription server writes highlight history to an Obsidian markdown file', async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), 'rvt-obsidian-'));
  const { server, baseUrl } = await listenWithFakeTranscriber();

  try {
    const response = await fetch(`${baseUrl}/obsidian/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        vaultPath,
        subdir: 'English Watching',
        pageTitle: 'Netflix',
        sourceUrl: 'https://www.netflix.com/watch/70116062',
        highlights: [
          {
            startedAt: 1_000,
            type: 'phrase',
            text: 'being raised',
            translation: '被养育',
            difficulty: 'B2',
            segmentText: 'I never knew about being raised by monks.',
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.match(result.path, /English Watching\/\d{4}-\d{2}-\d{2}\.md$/);
    const markdown = await readFile(result.path, 'utf8');
    assert.match(markdown, /Highlight History Netflix/);
    assert.match(markdown, /being raised/);
    assert.match(markdown, /被养育/);
  } finally {
    await closeServer(server);
  }
});

async function listenWithFakeTranscriber(transcriber = { async transcribe() {} }) {
  const server = createTranscriptionServer({ transcriber });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
