import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const interceptorPath = path.resolve('src/content/pageSubtitleInterceptor.js');

test('page subtitle interceptor posts subtitle fetch responses without changing fetch result', async () => {
  const postedMessages = [];
  const response = {
    url: 'https://cdn.example.test/subtitles/en.vtt',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'text/vtt' : '';
      },
    },
    clone() {
      return {
        text: async () => 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello from fetch.',
      };
    },
  };
  const context = createInterceptorContext({
    fetchImpl: async () => response,
    postedMessages,
  });

  runInterceptor(context);

  const result = await context.window.fetch('https://cdn.example.test/subtitles/en.vtt');
  await flushPromises();

  assert.equal(result, response);
  assert.equal(postedMessages.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(postedMessages[0])), {
    source: 'rvt-page-subtitle-interceptor',
    type: 'SUBTITLE_RESOURCE',
    url: 'https://cdn.example.test/subtitles/en.vtt',
    contentType: 'text/vtt',
    text: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello from fetch.',
  });
});

test('page subtitle interceptor posts LRC subtitle fetch responses', async () => {
  const postedMessages = [];
  const response = {
    url: 'https://cdn.example.test/lyrics/en.lrc',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'text/plain' : '';
      },
    },
    clone() {
      return {
        text: async () => '[00:01.20]LRC subtitle from fetch.',
      };
    },
  };
  const context = createInterceptorContext({
    fetchImpl: async () => response,
    postedMessages,
  });

  runInterceptor(context);

  const result = await context.window.fetch('https://cdn.example.test/lyrics/en.lrc');
  await flushPromises();

  assert.equal(result, response);
  assert.deepEqual(JSON.parse(JSON.stringify(postedMessages)), [
    {
      source: 'rvt-page-subtitle-interceptor',
      type: 'SUBTITLE_RESOURCE',
      url: 'https://cdn.example.test/lyrics/en.lrc',
      contentType: 'text/plain',
      text: '[00:01.20]LRC subtitle from fetch.',
    },
  ]);
});

test('page subtitle interceptor posts SRT subtitle fetch responses', async () => {
  const postedMessages = [];
  const responseText = [
    '1',
    '00:00:01,200 --> 00:00:03,500',
    'SRT subtitle from fetch.',
  ].join('\n');
  const response = {
    url: 'https://cdn.example.test/subtitles/en.srt',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'text/plain' : '';
      },
    },
    clone() {
      return {
        text: async () => responseText,
      };
    },
  };
  const context = createInterceptorContext({
    fetchImpl: async () => response,
    postedMessages,
  });

  runInterceptor(context);

  const result = await context.window.fetch('https://cdn.example.test/subtitles/en.srt');
  await flushPromises();

  assert.equal(result, response);
  assert.deepEqual(JSON.parse(JSON.stringify(postedMessages)), [
    {
      source: 'rvt-page-subtitle-interceptor',
      type: 'SUBTITLE_RESOURCE',
      url: 'https://cdn.example.test/subtitles/en.srt',
      contentType: 'text/plain',
      text: responseText,
    },
  ]);
});

test('page subtitle interceptor inspects generic text/xml timedtext fetch responses', async () => {
  const postedMessages = [];
  const responseText = [
    '<timedtext format="3">',
    '  <body><p t="1200" d="1800"><s>Generic XML timedtext from fetch.</s></p></body>',
    '</timedtext>',
  ].join('\n');
  const response = {
    url: 'https://stream.example.test/api/playback?id=item-123',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'text/xml; charset=utf-8' : '';
      },
    },
    clone() {
      return {
        text: async () => responseText,
      };
    },
  };
  const context = createInterceptorContext({
    fetchImpl: async () => response,
    postedMessages,
  });

  runInterceptor(context);

  const result = await context.window.fetch('https://stream.example.test/api/playback?id=item-123');
  await flushPromises();

  assert.equal(result, response);
  assert.deepEqual(JSON.parse(JSON.stringify(postedMessages)), [
    {
      source: 'rvt-page-subtitle-interceptor',
      type: 'SUBTITLE_RESOURCE',
      url: 'https://stream.example.test/api/playback?id=item-123',
      contentType: 'text/xml; charset=utf-8',
      text: responseText,
    },
  ]);
});

test('page subtitle interceptor posts ASS subtitle fetch responses', async () => {
  const postedMessages = [];
  const responseText = [
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.20,0:00:03.50,Default,,0,0,0,,ASS subtitle from fetch.',
  ].join('\n');
  const response = {
    url: 'https://cdn.example.test/subtitles/en.ass',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'text/plain' : '';
      },
    },
    clone() {
      return {
        text: async () => responseText,
      };
    },
  };
  const context = createInterceptorContext({
    fetchImpl: async () => response,
    postedMessages,
  });

  runInterceptor(context);

  const result = await context.window.fetch('https://cdn.example.test/subtitles/en.ass');
  await flushPromises();

  assert.equal(result, response);
  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].url, 'https://cdn.example.test/subtitles/en.ass');
  assert.equal(postedMessages[0].text, responseText);
});

test('page subtitle interceptor posts BCC subtitle fetch responses', async () => {
  const postedMessages = [];
  const responseText = JSON.stringify({
    body: [
      {
        from: 1.2,
        to: 3.4,
        content: 'BCC subtitle from fetch.',
      },
    ],
  });
  const response = {
    url: 'https://cdn.example.test/subtitles/en.bcc',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'application/json' : '';
      },
    },
    clone() {
      return {
        text: async () => responseText,
      };
    },
  };
  const context = createInterceptorContext({
    fetchImpl: async () => response,
    postedMessages,
  });

  runInterceptor(context);

  const result = await context.window.fetch('https://cdn.example.test/subtitles/en.bcc');
  await flushPromises();

  assert.equal(result, response);
  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].url, 'https://cdn.example.test/subtitles/en.bcc');
  assert.equal(postedMessages[0].text, responseText);
});

test('page subtitle interceptor posts JSON fetch subtitle responses with generic API URLs', async () => {
  const postedMessages = [];
  const response = {
    url: 'https://stream.example.test/player/api/session/1234',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'application/json' : '';
      },
    },
    clone() {
      return {
        text: async () => JSON.stringify({
          events: [
            {
              tStartMs: 1500,
              dDurationMs: 1200,
              segs: [{ utf8: 'Generic JSON subtitle.' }],
            },
          ],
        }),
      };
    },
  };
  const context = createInterceptorContext({
    fetchImpl: async () => response,
    postedMessages,
  });

  runInterceptor(context);

  const result = await context.window.fetch('https://stream.example.test/player/api/session/1234');
  await flushPromises();

  assert.equal(result, response);
  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].url, 'https://stream.example.test/player/api/session/1234');
  assert.equal(postedMessages[0].contentType, 'application/json');
  assert.match(postedMessages[0].text, /Generic JSON subtitle/);
});

test('page subtitle interceptor posts JSON player manifests with subtitle download URLs', async () => {
  const postedMessages = [];
  const responseText = JSON.stringify({
    timedtexttracks: [
      {
        language: 'en',
        ttDownloadables: {
          'dfxp-ls-sdh': {
            downloadUrls: {
              en: 'https://cdn.example.test/timedtext?id=manifest-subtitle',
            },
          },
        },
      },
    ],
  });
  const response = {
    url: 'https://stream.example.test/player/api/session/manifest',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'application/json' : '';
      },
    },
    clone() {
      return {
        text: async () => responseText,
      };
    },
  };
  const context = createInterceptorContext({
    fetchImpl: async () => response,
    postedMessages,
  });

  runInterceptor(context);

  await context.window.fetch('https://stream.example.test/player/api/session/manifest');
  await flushPromises();

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].url, 'https://stream.example.test/player/api/session/manifest');
  assert.equal(postedMessages[0].text, responseText);
});

test('page subtitle interceptor posts JSON player manifests with extensionless timedtext download URLs', async () => {
  const postedMessages = [];
  const responseText = JSON.stringify({
    timedtexttracks: [
      {
        language: 'en',
        ttDownloadables: {
          'dfxp-ls-sdh': {
            downloadUrls: {
              en: 'timedtext?id=relative123',
            },
          },
        },
      },
    ],
  });
  const response = {
    url: 'https://stream.example.test/player/api/session/manifest',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'application/json' : '';
      },
    },
    clone() {
      return {
        text: async () => responseText,
      };
    },
  };
  const context = createInterceptorContext({
    fetchImpl: async () => response,
    postedMessages,
  });

  runInterceptor(context);

  await context.window.fetch('https://stream.example.test/player/api/session/manifest');
  await flushPromises();

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].text, responseText);
});

test('page subtitle interceptor posts generic JSON cue responses with generic API URLs', async () => {
  const postedMessages = [];
  const responseText = JSON.stringify({
    captions: [
      {
        start: 1,
        duration: 2,
        text: 'Generic API JSON caption.',
      },
    ],
  });
  const response = {
    url: 'https://stream.example.test/player/api/cues/1234',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'application/json' : '';
      },
    },
    clone() {
      return {
        text: async () => responseText,
      };
    },
  };
  const context = createInterceptorContext({
    fetchImpl: async () => response,
    postedMessages,
  });

  runInterceptor(context);

  await context.window.fetch('https://stream.example.test/player/api/cues/1234');
  await flushPromises();

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].url, 'https://stream.example.test/player/api/cues/1234');
  assert.equal(postedMessages[0].text, responseText);
});

test('page subtitle interceptor posts compact JSON cues with t and d fields', async () => {
  const postedMessages = [];
  const responseText = JSON.stringify({
    subtitles: [
      {
        t: 1500,
        d: 2000,
        fragments: [{ text: 'Compact interceptor cue.' }],
      },
    ],
  });
  const response = {
    url: 'https://stream.example.test/player/api/session/1234',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'application/json' : '';
      },
    },
    clone() {
      return {
        text: async () => responseText,
      };
    },
  };
  const context = createInterceptorContext({
    fetchImpl: async () => response,
    postedMessages,
  });

  runInterceptor(context);

  await context.window.fetch('https://stream.example.test/player/api/session/1234');
  await flushPromises();

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].text, responseText);
});

test('page subtitle interceptor posts offset JSON cues with word arrays', async () => {
  const postedMessages = [];
  const responseText = JSON.stringify({
    captions: [
      {
        startOffsetMs: 1200,
        endOffsetMs: 2800,
        words: [{ word: 'Offset interceptor cue.' }],
      },
    ],
  });
  const response = {
    url: 'https://stream.example.test/player/api/session/1234',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'application/json' : '';
      },
    },
    clone() {
      return {
        text: async () => responseText,
      };
    },
  };
  const context = createInterceptorContext({
    fetchImpl: async () => response,
    postedMessages,
  });

  runInterceptor(context);

  await context.window.fetch('https://stream.example.test/player/api/session/1234');
  await flushPromises();

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].text, responseText);
});

test('page subtitle interceptor inspects cue-like text responses without JSON content type', async () => {
  const postedMessages = [];
  const responseText = JSON.stringify({
    cues: [
      {
        start: 1,
        duration: 2,
        text: 'Cue-like URL JSON caption.',
      },
    ],
  });
  const response = {
    url: 'https://stream.example.test/player/api/cues/1234',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'text/plain' : '';
      },
    },
    clone() {
      return {
        text: async () => responseText,
      };
    },
  };
  const context = createInterceptorContext({
    fetchImpl: async () => response,
    postedMessages,
  });

  runInterceptor(context);

  await context.window.fetch('https://stream.example.test/player/api/cues/1234');
  await flushPromises();

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].url, 'https://stream.example.test/player/api/cues/1234');
  assert.equal(postedMessages[0].text, responseText);
});

test('page subtitle interceptor resolves relative fetch URLs against the page URL', async () => {
  const postedMessages = [];
  const responseText = JSON.stringify({
    cues: [
      {
        start: 1,
        duration: 2,
        text: 'Relative fetch cue.',
      },
    ],
  });
  const response = {
    url: '',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'application/json' : '';
      },
    },
    clone() {
      return {
        text: async () => responseText,
      };
    },
  };
  const context = createInterceptorContext({
    fetchImpl: async () => response,
    postedMessages,
    pageUrl: 'https://stream.example.test/watch/episode',
  });

  runInterceptor(context);

  await context.window.fetch('../api/cues?format=json');
  await flushPromises();

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].url, 'https://stream.example.test/api/cues?format=json');
  assert.equal(postedMessages[0].text, responseText);
});

test('page subtitle interceptor posts root JSON cue array responses', async () => {
  const postedMessages = [];
  const responseText = JSON.stringify([
    {
      start: 2,
      duration: 1.5,
      text: 'Root JSON array caption.',
    },
  ]);
  const response = {
    url: 'https://stream.example.test/player/api/cue-array/1234',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'application/json' : '';
      },
    },
    clone() {
      return {
        text: async () => responseText,
      };
    },
  };
  const context = createInterceptorContext({
    fetchImpl: async () => response,
    postedMessages,
  });

  runInterceptor(context);

  await context.window.fetch('https://stream.example.test/player/api/cue-array/1234');
  await flushPromises();

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].url, 'https://stream.example.test/player/api/cue-array/1234');
  assert.equal(postedMessages[0].text, responseText);
});

test('page subtitle interceptor posts generic JSON cue responses with string timestamps', async () => {
  const postedMessages = [];
  const responseText = JSON.stringify({
    captions: [
      {
        start: '00:00:02.000',
        end: '00:00:04.500',
        text: 'String timestamp JSON caption.',
      },
    ],
  });
  const response = {
    url: 'https://stream.example.test/player/api/string-cues/1234',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'application/json' : '';
      },
    },
    clone() {
      return {
        text: async () => responseText,
      };
    },
  };
  const context = createInterceptorContext({
    fetchImpl: async () => response,
    postedMessages,
  });

  runInterceptor(context);

  await context.window.fetch('https://stream.example.test/player/api/string-cues/1234');
  await flushPromises();

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].url, 'https://stream.example.test/player/api/string-cues/1234');
  assert.equal(postedMessages[0].text, responseText);
});

test('page subtitle interceptor posts text XHR subtitle responses', async () => {
  const postedMessages = [];
  const context = createInterceptorContext({ postedMessages });

  runInterceptor(context);

  const xhr = new context.window.XMLHttpRequest();
  xhr.open('GET', 'https://cdn.example.test/timedtext?fmt=vtt');
  xhr.responseType = '';
  xhr.responseText = 'WEBVTT\n\n00:00:03.000 --> 00:00:04.000\nHello from xhr.';
  xhr.status = 200;
  xhr.headers.set('content-type', 'text/vtt');
  xhr.send();
  xhr.dispatchEvent('loadend');
  await flushPromises();

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].url, 'https://cdn.example.test/timedtext?fmt=vtt');
  assert.equal(postedMessages[0].text, 'WEBVTT\n\n00:00:03.000 --> 00:00:04.000\nHello from xhr.');
});

test('page subtitle interceptor resolves relative XHR subtitle URLs against the page URL', async () => {
  const postedMessages = [];
  const context = createInterceptorContext({
    postedMessages,
    pageUrl: 'https://stream.example.test/watch/episode',
  });

  runInterceptor(context);

  const xhr = new context.window.XMLHttpRequest();
  xhr.open('GET', './texttracks/en.vtt');
  xhr.responseType = '';
  xhr.responseText = 'WEBVTT\n\n00:00:03.000 --> 00:00:04.000\nRelative XHR cue.';
  xhr.status = 200;
  xhr.headers.set('content-type', 'text/vtt');
  xhr.send();
  xhr.dispatchEvent('loadend');
  await flushPromises();

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].url, 'https://stream.example.test/watch/texttracks/en.vtt');
  assert.equal(postedMessages[0].text, 'WEBVTT\n\n00:00:03.000 --> 00:00:04.000\nRelative XHR cue.');
});

test('page subtitle interceptor posts arraybuffer XHR subtitle responses', async () => {
  const postedMessages = [];
  const context = createInterceptorContext({ postedMessages });

  runInterceptor(context);

  const xhr = new context.window.XMLHttpRequest();
  xhr.open('GET', 'https://cdn.example.test/subtitles/binary.vtt');
  xhr.responseType = 'arraybuffer';
  xhr.response = new TextEncoder().encode('WEBVTT\n\n00:00:05.000 --> 00:00:06.000\nHello from binary xhr.').buffer;
  xhr.status = 200;
  xhr.headers.set('content-type', 'text/vtt');
  xhr.send();
  xhr.dispatchEvent('loadend');
  await flushPromises();

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].url, 'https://cdn.example.test/subtitles/binary.vtt');
  assert.equal(postedMessages[0].text, 'WEBVTT\n\n00:00:05.000 --> 00:00:06.000\nHello from binary xhr.');
});

test('page subtitle interceptor posts document XHR subtitle responses', async () => {
  const postedMessages = [];
  const context = createInterceptorContext({ postedMessages });

  runInterceptor(context);

  const xhr = new context.window.XMLHttpRequest();
  xhr.open('GET', 'https://cdn.example.test/subtitles/document.dfxp');
  xhr.responseType = 'document';
  xhr.response = {
    xml: '<tt><body><div><p begin="1s" end="2s">Hello from document xhr.</p></div></body></tt>',
  };
  xhr.status = 200;
  xhr.headers.set('content-type', 'application/ttml+xml');
  xhr.send();
  xhr.dispatchEvent('loadend');
  await flushPromises();

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].url, 'https://cdn.example.test/subtitles/document.dfxp');
  assert.equal(postedMessages[0].text, '<tt><body><div><p begin="1s" end="2s">Hello from document xhr.</p></div></body></tt>');
});

test('page subtitle interceptor posts json XHR subtitle responses', async () => {
  const postedMessages = [];
  const context = createInterceptorContext({ postedMessages });

  runInterceptor(context);

  const xhr = new context.window.XMLHttpRequest();
  xhr.open('GET', 'https://www.youtube.com/api/timedtext?fmt=json3');
  xhr.responseType = 'json';
  xhr.response = {
    events: [
      {
        tStartMs: 1000,
        dDurationMs: 1000,
        segs: [{ utf8: 'Hello json xhr.' }],
      },
    ],
  };
  xhr.status = 200;
  xhr.headers.set('content-type', 'application/json');
  xhr.send();
  xhr.dispatchEvent('loadend');
  await flushPromises();

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].url, 'https://www.youtube.com/api/timedtext?fmt=json3');
  assert.equal(postedMessages[0].text, JSON.stringify(xhr.response));
});

test('page subtitle interceptor ignores non-subtitle responses', async () => {
  const postedMessages = [];
  const response = {
    url: 'https://cdn.example.test/api/movie.json',
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'application/json' : '';
      },
    },
    clone() {
      return {
        text: async () => '{"title":"Example"}',
      };
    },
  };
  const context = createInterceptorContext({
    fetchImpl: async () => response,
    postedMessages,
  });

  runInterceptor(context);

  await context.window.fetch('https://cdn.example.test/api/movie.json');
  await flushPromises();

  assert.deepEqual(postedMessages, []);
});

test('page subtitle interceptor posts live subtitle text from websocket messages', async () => {
  const postedMessages = [];
  const context = createInterceptorContext({ postedMessages });

  runInterceptor(context);

  const socket = new context.window.WebSocket('wss://stream.example.test/live');
  socket.dispatchMessage(JSON.stringify({
    type: 'subtitle',
    payload: {
      text: 'Live WebSocket subtitle.',
    },
  }));
  await flushPromises();

  assert.deepEqual(JSON.parse(JSON.stringify(postedMessages)), [
    {
      source: 'rvt-page-subtitle-interceptor',
      type: 'SUBTITLE_TEXT',
      url: 'wss://stream.example.test/live',
      contentType: 'websocket-message',
      text: 'Live WebSocket subtitle.',
    },
  ]);
});

test('page subtitle interceptor posts live subtitle text from eventsource messages', async () => {
  const postedMessages = [];
  const context = createInterceptorContext({ postedMessages });

  runInterceptor(context);

  const stream = new context.window.EventSource('/live-caption-events');
  stream.dispatchMessage(JSON.stringify({
    eventType: 'caption',
    data: {
      text: 'Live EventSource subtitle.',
    },
  }));
  await flushPromises();

  assert.deepEqual(JSON.parse(JSON.stringify(postedMessages)), [
    {
      source: 'rvt-page-subtitle-interceptor',
      type: 'SUBTITLE_TEXT',
      url: 'https://example.test/live-caption-events',
      contentType: 'eventsource-message',
      text: 'Live EventSource subtitle.',
    },
  ]);
});

test('page subtitle interceptor posts live subtitle text from named eventsource caption events', async () => {
  const postedMessages = [];
  const context = createInterceptorContext({ postedMessages });

  runInterceptor(context);

  const stream = new context.window.EventSource('/live-caption-events');
  stream.dispatchEvent('caption', JSON.stringify({
    payload: {
      text: 'Named EventSource subtitle.',
    },
  }));
  await flushPromises();

  assert.deepEqual(JSON.parse(JSON.stringify(postedMessages)), [
    {
      source: 'rvt-page-subtitle-interceptor',
      type: 'SUBTITLE_TEXT',
      url: 'https://example.test/live-caption-events',
      contentType: 'eventsource-caption-event',
      text: 'Named EventSource subtitle.',
    },
  ]);
});

test('page subtitle interceptor posts YouTube player caption tracks from page globals', async () => {
  const postedMessages = [];
  const context = createInterceptorContext({
    postedMessages,
    pageUrl: 'https://www.youtube.com/watch?v=test',
  });
  context.window.ytInitialPlayerResponse = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: 'https://www.youtube.com/api/timedtext?v=test&lang=en&fmt=srv3',
            languageCode: 'en',
          },
        ],
      },
    },
  };

  runInterceptor(context);
  await flushPromises();

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].source, 'rvt-page-subtitle-interceptor');
  assert.equal(postedMessages[0].type, 'SUBTITLE_RESOURCE');
  assert.equal(postedMessages[0].url, 'https://www.youtube.com/watch?v=test#yt-player-response');
  assert.equal(postedMessages[0].contentType, 'application/json; source=yt-player-response');
  assert.match(postedMessages[0].text, /api\/timedtext/);
});

function runInterceptor(context) {
  vm.runInNewContext(fs.readFileSync(interceptorPath, 'utf8'), context, {
    filename: 'pageSubtitleInterceptor.js',
  });
}

function createInterceptorContext({ fetchImpl = async () => ({}), postedMessages, pageUrl = 'https://example.test/watch' }) {
  class FakeXMLHttpRequest {
    constructor() {
      this.listeners = new Map();
      this.responseType = '';
      this.response = null;
      this.responseText = '';
      this.status = 0;
      this.headers = new Map();
    }

    open(_method, url) {
      this.__url = url;
    }

    send() {}

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }

    getResponseHeader(name) {
      return this.headers.get(String(name).toLowerCase()) ?? '';
    }

    dispatchEvent(type) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener.call(this);
      }
    }
  }

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }

    dispatchMessage(data) {
      for (const listener of this.listeners.get('message') ?? []) {
        listener.call(this, { data });
      }
    }

    dispatchEvent(type, data) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener.call(this, { data });
      }
    }
  }

  class FakeEventSource {
    constructor(url) {
      this.url = String(url);
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }

    dispatchMessage(data) {
      for (const listener of this.listeners.get('message') ?? []) {
        listener.call(this, { data });
      }
    }

    dispatchEvent(type, data) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener.call(this, { data });
      }
    }
  }

  const window = {
    fetch: fetchImpl,
    XMLHttpRequest: FakeXMLHttpRequest,
    WebSocket: FakeWebSocket,
    EventSource: FakeEventSource,
    location: {
      href: pageUrl,
    },
    postMessage(message) {
      postedMessages.push(message);
    },
  };

  return {
    window,
    globalThis: window,
    Request: class {
      constructor(url) {
        this.url = url;
      }
    },
    URL,
    TextDecoder,
    XMLSerializer: class {
      serializeToString(document) {
        return document.xml;
      }
    },
    Promise,
    setTimeout,
    clearTimeout,
  };
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}
