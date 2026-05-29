import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createOpenAITranscriber,
  normalizeOpenAITranscription,
} from '../server/openaiTranscriber.js';

test('normalizeOpenAITranscription accepts text responses from OpenAI', () => {
  assert.deepEqual(
    normalizeOpenAITranscription({
      text: 'How can we use computers?',
      language: 'en',
    }),
    {
      text: 'How can we use computers?',
      translatedText: '',
      language: 'en',
      isFinal: true,
    },
  );
});

test('createOpenAITranscriber posts audio to the transcription endpoint', async () => {
  const calls = [];
  const transcriber = createOpenAITranscriber({
    apiKey: 'test-key',
    model: 'gpt-4o-mini-transcribe',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { text: 'A transcript line.' };
        },
      };
    },
  });

  const result = await transcriber.transcribe({
    audio: new Blob(['audio'], { type: 'audio/webm' }),
    filename: 'chunk-4.webm',
    prompt: 'Streaming video dialogue.',
  });

  assert.equal(result.text, 'A transcript line.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.equal(calls[0].options.body.get('model'), 'gpt-4o-mini-transcribe');
  assert.equal(calls[0].options.body.get('response_format'), 'json');
  assert.equal(calls[0].options.body.get('prompt'), 'Streaming video dialogue.');
  assert.equal(calls[0].options.body.get('file').name, 'chunk-4.webm');
});

test('createOpenAITranscriber can translate transcript text when enabled', async () => {
  const calls = [];
  const transcriber = createOpenAITranscriber({
    apiKey: 'test-key',
    model: 'gpt-4o-mini-transcribe',
    translateTo: 'zh-CN',
    translationModel: 'gpt-4.1-mini',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/audio/transcriptions')) {
        return {
          ok: true,
          async json() {
            return { text: 'How can we use computers?' };
          },
        };
      }

      return {
        ok: true,
        async json() {
          return { output_text: '我们如何使用电脑？' };
        },
      };
    },
  });

  const result = await transcriber.transcribe({
    audio: new Blob(['audio'], { type: 'audio/webm' }),
    filename: 'chunk-5.webm',
  });

  assert.equal(result.text, 'How can we use computers?');
  assert.equal(result.translatedText, '我们如何使用电脑？');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://api.openai.com/v1/responses');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-key');
  assert.equal(calls[1].options.headers['content-type'], 'application/json');
  assert.equal(JSON.parse(calls[1].options.body).model, 'gpt-4.1-mini');
});

test('createOpenAITranscriber keeps transcription when translation fails', async () => {
  const transcriber = createOpenAITranscriber({
    apiKey: 'test-key',
    translateTo: 'zh-CN',
    fetchImpl: async (url) => {
      if (url.endsWith('/audio/transcriptions')) {
        return {
          ok: true,
          async json() {
            return { text: 'The generation before us had no computers.' };
          },
        };
      }

      return {
        ok: false,
        status: 429,
        async text() {
          return 'rate limited';
        },
      };
    },
  });

  const result = await transcriber.transcribe({
    audio: new Blob(['audio'], { type: 'audio/webm' }),
    filename: 'chunk-6.webm',
  });

  assert.equal(result.text, 'The generation before us had no computers.');
  assert.equal(result.translatedText, '');
  assert.match(result.warning, /translation failed/i);
  assert.match(result.warning, /429/);
});

test('createOpenAITranscriber asks for character offsets in learning analysis', async () => {
  const calls = [];
  const transcriber = createOpenAITranscriber({
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify({
              items: [
                {
                  type: 'phrase',
                  text: 'ready our defenses',
                  translation: '准备好防御',
                  difficulty: 'B2',
                  start: 11,
                  end: 29,
                },
              ],
            }),
          };
        },
      };
    },
  });

  const result = await transcriber.analyze({
    text: 'All right, ready our defenses!',
    context: [],
    level: 'B2',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  const body = JSON.parse(calls[0].options.body);
  const systemText = body.input[0].content[0].text;
  assert.match(systemText, /pattern, phrasal_verb, collocation, idiom, advanced_word, technical_term, or named_entity/i);
  assert.match(systemText, /technicalMode/i);
  assert.match(systemText, /let sb do sth/i);
  assert.match(systemText, /protect sb from sth/i);
  assert.match(systemText, /don't let/i);
  assert.match(systemText, /bestif -> best if/i);
  assert.match(systemText, /zero-based character offsets/i);
  assert.deepEqual(result.items, [
    {
      type: 'phrase',
      text: 'ready our defenses',
      translation: '准备好防御',
      difficulty: 'B2',
      start: 11,
      end: 29,
    },
  ]);
});

test('createOpenAITranscriber can use a request API key for learning analysis', async () => {
  const calls = [];
  const transcriber = createOpenAITranscriber({
    apiKey: '',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { output_text: JSON.stringify({ items: [] }) };
        },
      };
    },
  });

  await transcriber.analyze({
    text: 'We need warriors.',
    context: [],
    level: 'B2',
    apiKey: 'sk-request-test',
  });

  assert.equal(calls[0].options.headers.Authorization, 'Bearer sk-request-test');
});

test('createOpenAITranscriber can use a request API key for audio transcription', async () => {
  const calls = [];
  const transcriber = createOpenAITranscriber({
    apiKey: '',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { text: 'A transcript line.' };
        },
      };
    },
  });

  await transcriber.transcribe({
    audio: new Blob(['audio'], { type: 'audio/webm' }),
    filename: 'chunk.webm',
    apiKey: 'sk-request-test',
  });

  assert.equal(calls[0].options.headers.Authorization, 'Bearer sk-request-test');
});

test('createOpenAITranscriber treats unreadable audio chunks as empty transcription results', async () => {
  const transcriber = createOpenAITranscriber({
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      async text() {
        return JSON.stringify({
          error: {
            message: 'Audio file might be corrupted or unsupported',
            type: 'invalid_request_error',
            param: 'file',
            code: 'invalid_value',
          },
        });
      },
    }),
  });

  assert.deepEqual(
    await transcriber.transcribe({
      audio: new Blob(['bad-audio'], { type: 'audio/webm' }),
      filename: 'chunk.webm',
    }),
    {
      text: '',
      translatedText: '',
      language: '',
      isFinal: true,
      isEmpty: true,
    },
  );
});

test('createOpenAITranscriber requires an API key', async () => {
  const transcriber = createOpenAITranscriber({ apiKey: '' });

  await assert.rejects(
    () =>
      transcriber.transcribe({
        audio: new Blob(['audio'], { type: 'audio/webm' }),
        filename: 'chunk.webm',
      }),
    /OPENAI_API_KEY/,
  );
});
