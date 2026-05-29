import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTranscriptionClient,
  getAudioChunkFilename,
  normalizeTranscriptionResponse,
} from '../src/offscreen/transcriptionClient.js';

test('normalizeTranscriptionResponse accepts text-only backend responses', () => {
  const result = normalizeTranscriptionResponse({
    text: 'Computers changed our work.',
    language: 'en',
    isFinal: true,
  });

  assert.deepEqual(result, {
    text: 'Computers changed our work.',
    translatedText: '',
    language: 'en',
    isFinal: true,
  });
});

test('normalizeTranscriptionResponse accepts translated_text snake case', () => {
  const result = normalizeTranscriptionResponse({
    text: 'How do we use computers?',
    translated_text: '我们如何使用电脑？',
  });

  assert.equal(result.translatedText, '我们如何使用电脑？');
  assert.equal(result.isFinal, true);
});

test('normalizeTranscriptionResponse preserves backend warnings', () => {
  const result = normalizeTranscriptionResponse({
    text: 'The transcript still succeeded.',
    warning: 'Translation failed: rate limited',
  });

  assert.equal(result.warning, 'Translation failed: rate limited');
});

test('normalizeTranscriptionResponse treats empty backend text as an empty chunk', () => {
  assert.deepEqual(normalizeTranscriptionResponse({ text: '   ', isFinal: false }), {
    text: '',
    translatedText: '',
    language: '',
    isFinal: false,
    isEmpty: true,
  });
});

test('normalizeTranscriptionResponse preserves warnings on empty chunks', () => {
  assert.deepEqual(normalizeTranscriptionResponse({ text: '', warning: 'No speech detected.' }), {
    text: '',
    translatedText: '',
    language: '',
    isFinal: true,
    isEmpty: true,
    warning: 'No speech detected.',
  });
});

test('createTranscriptionClient sends audio chunks as form data', async () => {
  const calls = [];
  const client = createTranscriptionClient({
    endpoint: 'https://example.test/transcribe',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            text: 'Hello from a video',
            translatedText: '视频里的问候',
            isFinal: true,
          };
        },
      };
    },
  });

  const result = await client.transcribeChunk({
    blob: new Blob(['audio'], { type: 'audio/webm' }),
    sequence: 7,
    startedAt: 1200,
    endedAt: 4200,
    sourceUrl: 'https://www.netflix.com/watch/1',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.test/transcribe');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body.get('sequence'), '7');
  assert.equal(calls[0].options.body.get('audio').name, 'chunk-7.webm');
  assert.equal(calls[0].options.body.get('sourceUrl'), 'https://www.netflix.com/watch/1');
  assert.equal(result.text, 'Hello from a video');
  assert.equal(result.translatedText, '视频里的问候');
});

test('createTranscriptionClient includes a configured API key in audio chunk requests', async () => {
  const calls = [];
  const client = createTranscriptionClient({
    endpoint: 'http://localhost:8787/transcribe',
    apiKey: 'sk-local-test',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { text: 'Audio transcript.' };
        },
      };
    },
  });

  await client.transcribeChunk({
    blob: new Blob(['audio'], { type: 'audio/webm' }),
    sequence: 8,
    startedAt: 1200,
    endedAt: 4200,
    sourceUrl: 'https://www.youtube.com/watch?v=1',
  });

  assert.equal(calls[0].options.body.get('apiKey'), 'sk-local-test');
});

test('createTranscriptionClient includes backend JSON error details for failed chunks', async () => {
  const client = createTranscriptionClient({
    endpoint: 'http://localhost:8787/transcribe',
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async json() {
        return { error: 'Missing or invalid OpenAI API key.' };
      },
    }),
  });

  await assert.rejects(
    () => client.transcribeChunk({
      blob: new Blob(['audio'], { type: 'audio/webm' }),
      sequence: 1,
      startedAt: 1000,
      endedAt: 2000,
      sourceUrl: 'https://www.netflix.com/watch/1',
    }),
    /HTTP 401: Missing or invalid OpenAI API key\./,
  );
});

test('createTranscriptionClient includes backend text error details for failed chunks', async () => {
  const client = createTranscriptionClient({
    endpoint: 'http://localhost:8787/transcribe',
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      async json() {
        throw new Error('Not JSON');
      },
      async text() {
        return 'OpenAI transcription failed.';
      },
    }),
  });

  await assert.rejects(
    () => client.transcribeChunk({
      blob: new Blob(['audio'], { type: 'audio/webm' }),
      sequence: 1,
      startedAt: 1000,
      endedAt: 2000,
      sourceUrl: 'https://www.netflix.com/watch/1',
    }),
    /HTTP 500: OpenAI transcription failed\./,
  );
});

test('getAudioChunkFilename matches common MediaRecorder MIME types', () => {
  assert.equal(getAudioChunkFilename(3, 'audio/webm;codecs=opus'), 'chunk-3.webm');
  assert.equal(getAudioChunkFilename(4, 'audio/mp4'), 'chunk-4.mp4');
  assert.equal(getAudioChunkFilename(5, 'audio/ogg;codecs=opus'), 'chunk-5.ogg');
  assert.equal(getAudioChunkFilename(6, ''), 'chunk-6.webm');
});
