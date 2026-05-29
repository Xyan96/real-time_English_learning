import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import * as overlayMount from '../src/content/overlayMount.js';
import * as segments from '../src/shared/segments.js';
import * as siteSubtitles from '../src/content/siteSubtitles.js';
import * as transcriptExport from '../src/shared/transcriptExport.js';

test('content script detects rendered subtitles and exports full transcript', async () => {
  const harness = createContentHarness();
  runContentScript(harness);

  harness.setSubtitleText('How can we use computers to do our jobs better?');
  await harness.flush();
  harness.tick();
  await harness.flush();

  harness.setSubtitleText('The generation before us had no computers.');
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 2);
  assert.match(response.text, /How can we use computers/);
  assert.match(response.srt, /The generation before us had no computers\./);
  assert.equal(harness.document.querySelector('#rvt-overlay').hidden, false);
});

test('content script stays idle when the plugin is disabled', async () => {
  const harness = createContentHarness({
    storageSettings: { enabled: false },
  });
  runContentScript(harness);

  harness.setSubtitleText('This subtitle should not be captured.');
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 0);
  assert.equal(harness.document.querySelector('#rvt-overlay').hidden, true);
});

test('content script refreshes disabled state before capturing subtitles', async () => {
  const harness = createContentHarness({
    storageSettings: { enabled: false },
  });
  runContentScript(harness);

  harness.setSubtitleText('This subtitle should wait for the enabled setting.');
  await harness.flush();
  harness.tick();
  await harness.flush();

  assert.equal((await harness.sendMessage({ type: 'GET_TRANSCRIPT' })).segments.length, 0);

  harness.setSyncStorageSettings({ enabled: true });
  const refresh = await harness.sendMessage({ type: 'REFRESH_ENABLED_SETTING' });
  harness.setSubtitleText('Now the subtitle capture is enabled.');
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(refresh.ok, true);
  assert.equal(refresh.enabled, true);
  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 2);
  assert.equal(response.segments[0].text, 'This subtitle should wait for the enabled setting.');
  assert.equal(response.segments[1].text, 'Now the subtitle capture is enabled.');
});

test('content script renders a bottom learning bar instead of a transcript card list', async () => {
  const harness = createContentHarness();
  runContentScript(harness);

  harness.setSubtitleText('All right, ready our defenses! The Fire Nation could come any moment now.');
  await harness.flush();
  harness.tick();
  await harness.flush();

  const overlay = harness.document.querySelector('#rvt-overlay');

  assert.equal(overlay.classList.contains('rvt-learning-bar'), true);
  assert.equal(overlay.querySelector('.rvt-current-text').textContent, 'All right, ready our defenses! The Fire Nation could come any moment now.');
  assert.equal(overlay.querySelector('.rvt-history-count').textContent, '1 行');
  assert.equal(overlay.querySelector('.rvt-list'), null);
});

test('content script applies learning analysis highlights to current subtitle', async () => {
  const harness = createContentHarness({
    analysisResponse: {
      items: [
        { type: 'phrase', text: 'ready our defenses', translation: '准备好防御', difficulty: 'B2', start: 11, end: 29 },
      ],
    },
  });
  runContentScript(harness);

  harness.setSubtitleText('All right, ready our defenses!');
  await harness.flush();
  harness.tick();
  await harness.flush();
  await harness.sendMessage({ type: 'ANALYZE_CURRENT_LINE', settings: { analysisEndpoint: 'http://localhost:8787/analyze', englishLevel: 'B2' } });
  await harness.flush();

  const overlay = harness.document.querySelector('#rvt-overlay');
  const highlight = overlay.querySelector('.rvt-learning-highlight-row');

  assert.equal(overlay.querySelector('.rvt-current-text').textContent, 'All right, ready our defenses!');
  assert.equal(highlight.querySelector('.rvt-highlight-term').textContent, 'ready our defenses');
  assert.equal(highlight.querySelector('.rvt-highlight-translation').textContent, '准备好防御');
  assert.deepEqual(harness.analysisRequests, [
    {
      text: 'All right, ready our defenses!',
      context: [],
      level: 'B2',
      intensity: 50,
      sourceUrl: 'https://example.test/watch',
      pageTitle: '',
    },
  ]);
});

test('content script renders instant subtitle highlights before async analysis returns', async () => {
  let resolveAnalysis;
  const pendingAnalysis = new Promise((resolve) => {
    resolveAnalysis = resolve;
  });
  const harness = createContentHarness({
    analysisFetches: [() => pendingAnalysis],
  });
  runContentScript(harness);

  harness.setSubtitleText("Grandmother, please, don't let Sokka do this.");
  await harness.flush();
  harness.tick();
  await harness.flush();

  const overlay = harness.document.querySelector('#rvt-overlay');
  const inlineHighlight = overlay.querySelector('.rvt-subtitle-highlight');
  const card = overlay.querySelector('.rvt-learning-highlight-row');

  assert.equal(inlineHighlight.textContent, "don't let Sokka do this");
  assert.equal(inlineHighlight.dataset.highlightIndex, '0');
  assert.equal(card.dataset.highlightIndex, '0');
  assert.equal(card.querySelector('.rvt-highlight-term').textContent, 'let sb do sth');
  assert.match(card.querySelector('.rvt-highlight-translation').textContent, /让某人做某事/);
  assert.equal(harness.analysisRequests.length, 1);

  resolveAnalysis({
    items: [
      {
        type: 'pattern',
        expression: 'let sb do sth',
        surface: "don't let Sokka do this",
        meaning_zh: '让某人做某事',
        structure: 'let + object + bare infinitive',
        difficulty: 'B1',
        why_useful: '高频使役结构。',
        example: "Grandmother, please, don't let Sokka do this.",
      },
    ],
  });
  await harness.flush();
});

test('content script automatically applies learning analysis to new subtitles', async () => {
  const harness = createContentHarness({
    analysisResponse: {
      items: [
        { type: 'collocation', text: 'ready our defenses', translation: '准备防御', difficulty: 'B2', start: 11, end: 29 },
      ],
    },
  });
  runContentScript(harness);

  harness.setSubtitleText('All right, ready our defenses!');
  await harness.flush();
  harness.tick();
  await harness.flush();

  const overlay = harness.document.querySelector('#rvt-overlay');
  const highlight = overlay.querySelector('.rvt-learning-highlight-row');

  assert.equal(overlay.querySelector('.rvt-current-text').textContent, 'All right, ready our defenses!');
  assert.equal(highlight.querySelector('.rvt-highlight-term').textContent, 'ready our defenses');
  assert.equal(highlight.querySelector('.rvt-highlight-translation').textContent, '准备防御');
  assert.deepEqual(harness.analysisRequests, [
    {
      text: 'All right, ready our defenses!',
      context: [],
      level: 'B2',
      intensity: 50,
      sourceUrl: 'https://example.test/watch',
      pageTitle: '',
    },
  ]);
});

test('content script sends stored OpenAI API key to local learning analysis', async () => {
  const harness = createContentHarness({
    localStorageSettings: {
      openAiApiKey: 'sk-local-test',
    },
    analysisResponse: {
      items: [
        { type: 'word', text: 'warship', translation: '战舰', difficulty: 'B2' },
      ],
    },
  });
  runContentScript(harness);

  harness.setSubtitleText("There's no way we're gonna catch a warship with a canoe.");
  await harness.flush();
  harness.tick();
  await harness.flush();

  assert.equal(harness.analysisRequests[0].apiKey, 'sk-local-test');
});

test('content script sends extraction intensity with automatic learning analysis', async () => {
  const harness = createContentHarness({
    localStorageSettings: {
      extractionIntensity: 80,
    },
    analysisResponse: { realtimeItems: [], exportItems: [] },
  });
  runContentScript(harness);

  harness.setSubtitleText("This will be a super fast paced demonstration. But we're only scratching the surface.");
  await harness.flush();
  harness.tick();
  await harness.flush();

  assert.equal(harness.analysisRequests[0].intensity, 80);
});

test('content script renders realtime items but keeps export items for learning history', async () => {
  const harness = createContentHarness({
    analysisResponse: {
      realtimeItems: [
        {
          type: 'idiom',
          expression: 'scratch the surface',
          surface: 'scratching the surface',
          meaning_zh: '浅尝辄止',
          difficulty: 'B2',
          start: 49,
          end: 71,
        },
      ],
      exportItems: [
        {
          type: 'idiom',
          expression: 'scratch the surface',
          surface: 'scratching the surface',
          meaning_zh: '浅尝辄止',
          difficulty: 'B2',
          start: 49,
          end: 71,
        },
        {
          type: 'advanced_word',
          expression: 'fast-paced',
          surface: 'fast paced',
          meaning_zh: '快节奏的',
          difficulty: 'B2',
          start: 21,
          end: 31,
        },
      ],
    },
  });
  runContentScript(harness);

  harness.setSubtitleText("This will be a super fast paced demonstration. But we're only scratching the surface.");
  await harness.flush();
  harness.tick();
  await harness.flush();

  const overlay = harness.document.querySelector('#rvt-overlay');
  const rows = overlay.querySelectorAll('.rvt-learning-highlight-row');
  const history = await harness.sendMessage({ type: 'GET_LEARNING_HISTORY' });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('.rvt-highlight-term').textContent, 'scratch the surface');
  assert.deepEqual(Array.from(history.highlights).map((item) => item.text), [
    'scratch the surface',
    'fast-paced',
  ]);
});

test('content script recalculates current subtitle when extraction intensity changes', async () => {
  const harness = createContentHarness();
  runContentScript(harness);

  harness.setSubtitleText("This will be a super fast paced demonstration. But we're only scratching the surface.");
  await harness.flush();
  harness.tick();
  await harness.flush();

  let overlay = harness.document.querySelector('#rvt-overlay');
  assert.deepEqual(
    Array.from(overlay.querySelectorAll('.rvt-learning-highlight-row')).map((row) => row.querySelector('.rvt-highlight-term').textContent),
    ['scratch the surface', 'fast-paced'],
  );

  await harness.sendMessage({
    type: 'REFRESH_EXTRACTION_INTENSITY',
    settings: { extractionIntensity: 20 },
  });
  await harness.flush();

  overlay = harness.document.querySelector('#rvt-overlay');
  assert.deepEqual(
    Array.from(overlay.querySelectorAll('.rvt-learning-highlight-row')).map((row) => row.querySelector('.rvt-highlight-term').textContent),
    ['scratch the surface'],
  );
});

test('content script keeps delayed learning highlights after the current subtitle advances', async () => {
  let resolveFirstAnalysis;
  const firstAnalysis = new Promise((resolve) => {
    resolveFirstAnalysis = resolve;
  });
  const harness = createContentHarness({
    analysisFetches: [
      () => firstAnalysis,
      () => Promise.resolve({
        items: [
          { type: 'word', text: 'warriors', translation: '战士', difficulty: 'B2', start: 8, end: 16 },
        ],
      }),
    ],
  });
  runContentScript(harness);

  harness.setSubtitleText('You are just a teenager.');
  await harness.flush();
  harness.tick();
  await harness.flush();

  harness.setSubtitleText('We need warriors.');
  await harness.flush();
  harness.tick();
  await harness.flush();

  resolveFirstAnalysis({
    items: [
      { type: 'phrase', text: 'just a teenager', translation: '只是个青少年', difficulty: 'B2', start: 8, end: 23 },
    ],
  });
  await harness.flush();

  const overlay = harness.document.querySelector('#rvt-overlay');
  const history = overlay.querySelector('.rvt-learning-history');

  assert.equal(overlay.querySelector('.rvt-current-text').textContent, 'We need warriors.');
  assert.match(history.textContent, /just a teenager/);
  assert.match(history.textContent, /只是个青少年/);
  assert.match(history.textContent, /warriors/);
  assert.match(history.textContent, /战士/);
});

test('content script keeps only the two newest learning highlight entries', async () => {
  const harness = createContentHarness({
    analysisFetches: [
      () => Promise.resolve({ items: [{ type: 'word', text: 'alpha', translation: '一', difficulty: 'B2' }] }),
      () => Promise.resolve({ items: [{ type: 'word', text: 'bravo', translation: '二', difficulty: 'B2' }] }),
      () => Promise.resolve({ items: [{ type: 'word', text: 'charlie', translation: '三', difficulty: 'B2' }] }),
      () => Promise.resolve({ items: [{ type: 'word', text: 'delta', translation: '四', difficulty: 'B2' }] }),
    ],
  });
  runContentScript(harness);

  for (const text of ['alpha line.', 'bravo line.', 'charlie line.', 'delta line.']) {
    harness.setSubtitleText(text);
    await harness.flush();
    harness.tick();
    await harness.flush();
  }

  const historyText = harness.document.querySelector('#rvt-overlay').querySelector('.rvt-learning-history').textContent;
  const rows = harness.document.querySelector('#rvt-overlay').querySelectorAll('.rvt-learning-highlight-row');
  assert.equal(rows.length, 2);
  assert.doesNotMatch(historyText, /alpha/);
  assert.doesNotMatch(historyText, /bravo/);
  assert.match(historyText, /charlie/);
  assert.match(historyText, /三/);
  assert.match(historyText, /delta/);
  assert.match(historyText, /四/);
});

test('content script dedupes repeated learning highlights on screen', async () => {
  const harness = createContentHarness({
    analysisFetches: [
      () => Promise.resolve({ items: [{ type: 'phrase', text: 'ready our defenses', translation: '准备好防御', difficulty: 'B2' }] }),
      () => Promise.resolve({ items: [{ type: 'phrase', text: 'ready our defenses', translation: '准备好防御', difficulty: 'B2' }] }),
    ],
  });
  runContentScript(harness);

  for (const text of ['All right, ready our defenses!', 'Again, ready our defenses!']) {
    harness.setSubtitleText(text);
    await harness.flush();
    harness.tick();
    await harness.flush();
  }

  const rows = harness.document.querySelector('#rvt-overlay').querySelectorAll('.rvt-learning-highlight-row');
  const historyText = harness.document.querySelector('#rvt-overlay').querySelector('.rvt-learning-history').textContent;

  assert.equal(rows.length, 1);
  assert.equal(historyText.match(/ready our defenses/g).length, 1);
});

test('content script dedupes repeated highlights with different translations', async () => {
  const harness = createContentHarness({
    analysisFetches: [
      () => Promise.resolve({ items: [{ type: 'word', text: 'warship', translation: '战舰', difficulty: 'B2' }] }),
      () => Promise.resolve({ items: [{ type: 'word', text: 'warship', translation: '军舰', difficulty: 'B2' }] }),
    ],
  });
  runContentScript(harness);

  for (const text of ['We need a warship.', 'That warship is gone.']) {
    harness.setSubtitleText(text);
    await harness.flush();
    harness.tick();
    await harness.flush();
  }

  const rows = harness.document.querySelector('#rvt-overlay').querySelectorAll('.rvt-learning-highlight-row');
  const historyText = harness.document.querySelector('#rvt-overlay').querySelector('.rvt-learning-history').textContent;

  assert.equal(rows.length, 1);
  assert.equal(historyText.match(/warship/g).length, 1);
});

test('content script dedupes repeated phrase variants by core expression', async () => {
  const harness = createContentHarness({
    analysisFetches: [
      () => Promise.resolve({ items: [{ type: 'phrase', text: 'we need your help', translation: '我们需要你的帮助', difficulty: 'B2' }] }),
      () => Promise.resolve({ items: [{ type: 'phrase', text: 'needs your help', translation: '需要你的帮助', difficulty: 'B2' }] }),
    ],
  });
  runContentScript(harness);

  for (const text of ['We need your help.', 'Aang needs your help.']) {
    harness.setSubtitleText(text);
    await harness.flush();
    harness.tick();
    await harness.flush();
  }

  const rows = harness.document.querySelector('#rvt-overlay').querySelectorAll('.rvt-learning-highlight-row');
  const historyText = harness.document.querySelector('#rvt-overlay').querySelector('.rvt-learning-history').textContent;

  assert.equal(rows.length, 1);
  assert.match(historyText, /needs your help/);
  assert.doesNotMatch(historyText, /we need your help/);
});

test('content script filters learning highlights already saved as known', async () => {
  const harness = createContentHarness({
    localStorageSettings: {
      knownLearningExpressions: [
        { key: 'riding them', text: 'riding them', addedAt: '2026-05-29T00:00:00.000Z' },
      ],
    },
    analysisResponse: {
      items: [
        { type: 'phrase', text: 'riding them', translation: '骑着它们', difficulty: 'B2' },
        { type: 'word', text: 'warship', translation: '战舰', difficulty: 'B2' },
      ],
    },
  });
  runContentScript(harness);

  harness.setSubtitleText('They were riding them near a warship.');
  await harness.flush();
  harness.tick();
  await harness.flush();

  const learning = await harness.sendMessage({ type: 'GET_LEARNING_HISTORY' });
  const historyText = harness.document.querySelector('#rvt-overlay').querySelector('.rvt-learning-history').textContent;

  assert.equal(learning.ok, true);
  assert.equal(Array.from(learning.highlights).map((item) => item.text).join(','), 'warship');
  assert.doesNotMatch(historyText, /riding them/);
  assert.match(historyText, /warship/);
});

test('content script refreshes known highlights and removes them from history', async () => {
  const harness = createContentHarness({
    analysisResponse: {
      items: [
        { type: 'word', text: 'warship', translation: '战舰', difficulty: 'B2' },
      ],
    },
  });
  runContentScript(harness);

  harness.setSubtitleText('They found a warship.');
  await harness.flush();
  harness.tick();
  await harness.flush();
  harness.setLocalStorageSettings({
    knownLearningExpressions: [
      { key: 'warship', text: 'warship', addedAt: '2026-05-29T00:00:00.000Z' },
    ],
  });

  const refresh = await harness.sendMessage({ type: 'REFRESH_KNOWN_LEARNING' });
  const learning = await harness.sendMessage({ type: 'GET_LEARNING_HISTORY' });
  const rows = harness.document.querySelector('#rvt-overlay').querySelectorAll('.rvt-learning-highlight-row');

  assert.equal(refresh.ok, true);
  assert.equal(learning.ok, true);
  assert.equal(Array.from(learning.highlights).length, 0);
  assert.equal(rows.length, 0);
});

test('content script exports full learning highlight history beyond the two visible rows', async () => {
  const harness = createContentHarness({
    analysisFetches: [
      () => Promise.resolve({ items: [{ type: 'word', text: 'alpha', translation: '一', difficulty: 'B2' }] }),
      () => Promise.resolve({ items: [{ type: 'word', text: 'bravo', translation: '二', difficulty: 'B2' }] }),
      () => Promise.resolve({ items: [{ type: 'word', text: 'charlie', translation: '三', difficulty: 'B2' }] }),
      () => Promise.resolve({ items: [{ type: 'word', text: 'delta', translation: '四', difficulty: 'B2' }] }),
    ],
  });
  runContentScript(harness);

  for (const text of ['alpha line.', 'bravo line.', 'charlie line.', 'delta line.']) {
    harness.setSubtitleText(text);
    await harness.flush();
    harness.tick();
    await harness.flush();
  }

  const rows = harness.document.querySelector('#rvt-overlay').querySelectorAll('.rvt-learning-highlight-row');
  const learning = await harness.sendMessage({ type: 'GET_LEARNING_HISTORY' });

  assert.equal(rows.length, 2);
  assert.equal(learning.ok, true);
  assert.equal(Array.from(learning.highlights).map((item) => item.text).join(','), 'alpha,bravo,charlie,delta');
});

test('content script keeps local highlights when automatic analysis fetch fails', async () => {
  const harness = createContentHarness({
    analysisFetches: [
      () => {
        throw new Error('backend unavailable');
      },
      () => {
        throw new Error('backend unavailable');
      },
    ],
  });
  runContentScript(harness);

  harness.setSubtitleText("Grandmother, please, don't let Sokka do this.");
  await harness.flush();
  harness.tick();
  await harness.flush();

  const overlay = harness.document.querySelector('#rvt-overlay');
  const highlight = overlay.querySelector('.rvt-subtitle-highlight');
  const card = overlay.querySelector('.rvt-learning-highlight-row');

  assert.equal(overlay.dataset.status, 'site-subtitles');
  assert.equal(highlight.textContent, "don't let Sokka do this");
  assert.equal(card.querySelector('.rvt-highlight-term').textContent, 'let sb do sth');
});

test('content script surfaces manual learning analysis request failures', async () => {
  const harness = createContentHarness({
    analysisFetches: [
      () => {
        throw new Error('backend unavailable');
      },
      () => {
        throw new Error('backend unavailable');
      },
    ],
  });
  runContentScript(harness);

  harness.setSubtitleText('There is no way.');
  await harness.flush();
  harness.tick();
  await harness.flush();
  await harness.sendMessage({ type: 'ANALYZE_CURRENT_LINE', settings: { analysisEndpoint: 'http://localhost:8787/analyze', englishLevel: 'B2' } });
  await harness.flush();

  const overlay = harness.document.querySelector('#rvt-overlay');

  assert.equal(overlay.dataset.status, 'warning');
  assert.match(overlay.querySelector('.rvt-status').textContent, /backend unavailable/);
});

test('content script surfaces manual learning analysis backend error details', async () => {
  const harness = createContentHarness({
    analysisResponseStatus: 500,
    analysisResponse: {
      error: 'OPENAI_API_KEY is required to analyze subtitle lines.',
    },
  });
  runContentScript(harness);

  harness.setSubtitleText('There is no way.');
  await harness.flush();
  harness.tick();
  await harness.flush();
  await harness.sendMessage({ type: 'ANALYZE_CURRENT_LINE', settings: { analysisEndpoint: 'http://localhost:8787/analyze', englishLevel: 'B2' } });
  await harness.flush();

  const overlay = harness.document.querySelector('#rvt-overlay');

  assert.equal(overlay.dataset.status, 'warning');
  assert.match(overlay.querySelector('.rvt-status').textContent, /OPENAI_API_KEY is required/);
});

test('content script exposes a transcript snapshot for all-frame collection', async () => {
  const harness = createContentHarness();
  runContentScript(harness);

  harness.setSubtitleText('Iframe player subtitle.');
  await harness.flush();
  harness.tick();
  await harness.flush();

  const snapshot = harness.context.window.__rvtGetTranscriptSnapshot();

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.segments.length, 1);
  assert.equal(snapshot.segments[0].text, 'Iframe player subtitle.');
  assert.match(snapshot.text, /Iframe player subtitle/);
  assert.match(snapshot.srt, /Iframe player subtitle/);
});

test('content script exposes clear transcript for all-frame clearing', async () => {
  const harness = createContentHarness();
  runContentScript(harness);

  harness.setSubtitleText('Iframe subtitle to clear.');
  await harness.flush();
  harness.tick();
  await harness.flush();

  const clearResponse = harness.context.window.__rvtClearTranscript();
  const transcript = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(clearResponse.ok, true);
  assert.equal(transcript.segments.length, 0);
  assert.equal(harness.document.querySelector('#rvt-overlay').hidden, true);
});

test('content script notifies background when site subtitles become available', async () => {
  const harness = createContentHarness();
  runContentScript(harness);

  harness.setSubtitleText('Website subtitle became available.');
  await harness.flush();
  harness.tick();
  await harness.flush();

  assert.deepEqual(JSON.parse(JSON.stringify(harness.backgroundMessages)).filter((message) => (
    message.type === 'SITE_SUBTITLES_AVAILABLE'
  )), [
    {
      target: 'background',
      type: 'SITE_SUBTITLES_AVAILABLE',
    },
  ]);
});

test('content script keeps site subtitle status when stale audio capture errors arrive', async () => {
  const harness = createContentHarness();
  runContentScript(harness);

  harness.setSubtitleText('Website subtitle is working.');
  await harness.flush();
  harness.tick();
  await harness.flush();
  await harness.sendMessage({
    type: 'CAPTURE_STATUS',
    status: 'error',
    detail: 'Transcription backend failed with HTTP 500: fetch failed.',
  });
  await harness.flush();

  const overlay = harness.document.querySelector('#rvt-overlay');

  assert.equal(overlay.dataset.status, 'site-subtitles');
  assert.equal(overlay.querySelector('.rvt-status').textContent, '正在使用页面已渲染的字幕');
});

test('content script detects Netflix timedtext data-uia subtitles', async () => {
  const harness = createContentHarness({
    subtitleClassName: '',
    subtitleDataUia: 'player-timedtext-text-container',
  });
  runContentScript(harness);

  harness.setSubtitleText('Netflix data-uia timedtext subtitle.');
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Netflix data-uia timedtext subtitle.');
});

test('content script detects XGPlayer-style rendered captions', async () => {
  const harness = createContentHarness({
    subtitleClassName: 'xgplayer-text-track-inner',
  });
  runContentScript(harness);

  harness.setSubtitleText('XGPlayer style rendered caption.');
  await harness.flush();
  harness.tick();
  await harness.flush();

  const transcript = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });
  const diagnostics = await harness.sendMessage({ type: 'GET_DIAGNOSTICS' });

  assert.equal(transcript.ok, true);
  assert.equal(transcript.segments.length, 1);
  assert.equal(transcript.segments[0].text, 'XGPlayer style rendered caption.');
  assert.equal(diagnostics.renderedSubtitles.samples[0].source, 'xgplayer-rendered-caption');
});

test('content script detects YouTube caption window container text', async () => {
  const harness = createContentHarness({
    subtitleClassName: 'ytp-caption-window-container',
  });
  runContentScript(harness);

  harness.setSubtitleText('then dive into the basics. I have a lot in store for you.');
  await harness.flush();
  harness.tick();
  await harness.flush();

  const transcript = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });
  const diagnostics = await harness.sendMessage({ type: 'GET_DIAGNOSTICS' });

  assert.equal(transcript.ok, true);
  assert.equal(transcript.segments.length, 1);
  assert.equal(transcript.segments[0].text, 'then dive into the basics. I have a lot in store for you.');
  assert.equal(diagnostics.renderedSubtitles.samples[0].source, 'youtube-rendered-caption');
});

test('content script detects classless visible YouTube player caption text', async () => {
  const harness = createContentHarness({
    pageUrl: 'https://www.youtube.com/watch?v=P_Q6avJGoWI',
    useYouTubePlayerSubtitle: true,
    subtitleClassName: '',
  });
  runContentScript(harness);

  harness.setSubtitleText('this mind map in the video description. Will start with a teaser power feature');
  await harness.flush();
  harness.tick();
  await harness.flush();

  const transcript = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });
  const diagnostics = await harness.sendMessage({ type: 'GET_DIAGNOSTICS' });

  assert.equal(transcript.ok, true);
  assert.equal(transcript.segments.length, 1);
  assert.equal(transcript.segments[0].text, 'this mind map in the video description. Will start with a teaser power feature');
  assert.equal(diagnostics.renderedSubtitles.samples[0].source, 'youtube-player-text-caption');
});

test('content script ignores broad YouTube page chrome that looks caption-like', async () => {
  const harness = createContentHarness({
    pageUrl: 'https://www.youtube.com/watch?v=P_Q6avJGoWI',
    subtitleClassName: 'caption-page-shell',
    initialSubtitleText: [
      '请登录，以便我们确认你不是聊天机器人',
      'The Excalidraw-Obsidian Showcase: 57 key features in just 17 minutes',
      'YouTube Premium 搜索 创建 分享 评论 排序方式 首页 推荐视频',
      '0:00 / 18:39 自动播放模式已关闭 接下来播放 播放列表',
    ].join(' '),
  });
  runContentScript(harness);

  await harness.flush();
  harness.tick();
  await harness.flush();

  const transcript = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });
  const diagnostics = await harness.sendMessage({ type: 'GET_DIAGNOSTICS' });

  assert.equal(transcript.ok, true);
  assert.equal(transcript.segments.length, 0);
  assert.equal(diagnostics.renderedSubtitles.count, 0);
  assert.equal(diagnostics.renderedSubtitles.samples.length, 0);
});

test('content script timestamps rendered subtitles with video playback time', async () => {
  const harness = createContentHarness({ includeVideo: true });
  runContentScript(harness);

  harness.setVideoTime(12.5);
  harness.setSubtitleText('Rendered subtitle on the video timeline.');
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Rendered subtitle on the video timeline.');
  assert.equal(response.segments[0].startedAt, 12_500);
  assert.match(response.srt, /00:00:12,500 --> 00:00:14,000/);
});

test('content script clears transcript and hides idle overlay', async () => {
  const harness = createContentHarness();
  runContentScript(harness);

  harness.setSubtitleText('A visible subtitle line.');
  await harness.flush();
  harness.tick();
  await harness.flush();

  const clearResponse = await harness.sendMessage({ type: 'CLEAR_TRANSCRIPT' });
  const transcript = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(clearResponse.ok, true);
  assert.equal(transcript.segments.length, 0);
  assert.equal(harness.document.querySelector('#rvt-overlay').hidden, true);
});

test('content script detects rendered subtitles inside open shadow DOM', async () => {
  const harness = createContentHarness({ useShadowSubtitle: true });
  runContentScript(harness);

  harness.setSubtitleText('Shadow captions are still page subtitles.');
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Shadow captions are still page subtitles.');
});

test('content script reads current subtitle text from WebVTT track files', async () => {
  const harness = createContentHarness({
    useTrackSubtitle: true,
    trackText: [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:02.000',
      'First track caption.',
      '',
      '00:00:02.500 --> 00:00:04.000',
      'Second track caption.',
    ].join('\n'),
  });
  runContentScript(harness);

  harness.setVideoTime(2.75);
  harness.tick();
  await harness.flush();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Second track caption.');
});

test('content script requests WebVTT track files through the background worker', async () => {
  const harness = createContentHarness({
    useTrackSubtitle: true,
    disablePageFetch: true,
    backgroundTrackText: [
      'WEBVTT',
      '',
      '00:00:02.000 --> 00:00:04.000',
      'Background fetched subtitle.',
    ].join('\n'),
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Background fetched subtitle.');
  assert.deepEqual(harness.backgroundFetchRequests, ['https://example.test/captions.vtt']);
});

test('content script reads WebVTT track files from data URLs without background fetch', async () => {
  const dataUrl = [
    'data:text/vtt;charset=utf-8,',
    encodeURIComponent([
      'WEBVTT',
      '',
      '00:00:02.000 --> 00:00:04.000',
      'Data URL subtitle.',
    ].join('\n')),
  ].join('');
  const harness = createContentHarness({
    useTrackSubtitle: true,
    trackSrc: dataUrl,
    disablePageFetch: true,
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Data URL subtitle.');
  assert.deepEqual(harness.backgroundFetchRequests, []);
});

test('content script decodes UTF-8 base64 data URL subtitle tracks', async () => {
  const trackText = [
    'WEBVTT',
    '',
    '00:00:02.000 --> 00:00:04.000',
    '双语 Data URL subtitle.',
  ].join('\n');
  const dataUrl = `data:text/vtt;charset=utf-8;base64,${Buffer.from(trackText, 'utf8').toString('base64')}`;
  const harness = createContentHarness({
    useTrackSubtitle: true,
    trackSrc: dataUrl,
    disablePageFetch: true,
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, '双语 Data URL subtitle.');
  assert.deepEqual(harness.backgroundFetchRequests, []);
});

test('content script reads WebVTT track files from blob URLs without background fetch', async () => {
  const blobUrl = 'blob:https://example.test/subtitle-track-id';
  const harness = createContentHarness({
    useTrackSubtitle: true,
    trackSrc: blobUrl,
    pageFetchTextByUrl: {
      [blobUrl]: [
        'WEBVTT',
        '',
        '00:00:02.000 --> 00:00:04.000',
        'Blob URL subtitle.',
      ].join('\n'),
    },
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Blob URL subtitle.');
  assert.deepEqual(harness.backgroundFetchRequests, []);
});

test('content script reads current subtitle text from TTML track files', async () => {
  const harness = createContentHarness({
    useTrackSubtitle: true,
    backgroundTrackText: [
      '<tt>',
      '  <body>',
      '    <div>',
      '      <p begin="00:00:02.000" end="00:00:04.000">TTML subtitle line.</p>',
      '    </div>',
      '  </body>',
      '</tt>',
    ].join('\n'),
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'TTML subtitle line.');
});

test('content script enables disabled text tracks before reading active cues', async () => {
  const harness = createContentHarness({
    textTracks: [
      {
        kind: 'subtitles',
        mode: 'disabled',
        activeCues: [{ text: 'Cue from a browser text track.' }],
      },
    ],
  });
  runContentScript(harness);

  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(harness.videoNode.textTracks[0].mode, 'hidden');
  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Cue from a browser text track.');
});

test('content script reads subtitle resources discovered from performance entries', async () => {
  const harness = createContentHarness({
    includeVideo: true,
    performanceEntries: [
      { name: 'https://cdn.example.test/video/init.mp4' },
      { name: 'https://cdn.example.test/subtitles/en.dfxp' },
    ],
    backgroundTrackText: [
      '<tt>',
      '  <body><div>',
      '    <p begin="00:00:02.000" end="00:00:04.000">Performance resource subtitle.</p>',
      '  </div></body>',
      '</tt>',
    ].join('\n'),
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Performance resource subtitle.');
  assert.deepEqual(harness.backgroundFetchRequests, ['https://cdn.example.test/subtitles/en.dfxp']);
});

test('content script reads cue-like JSON resources discovered from performance entries', async () => {
  const harness = createContentHarness({
    includeVideo: true,
    performanceEntries: [
      { name: 'https://cdn.example.test/video/init.mp4' },
      { name: 'https://cdn.example.test/player/texttracks/en?format=json' },
    ],
    backgroundTrackText: JSON.stringify({
      cues: [
        {
          start: 2,
          end: 4,
          text: 'Performance texttrack JSON subtitle.',
        },
      ],
    }),
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Performance texttrack JSON subtitle.');
  assert.deepEqual(harness.backgroundFetchRequests, ['https://cdn.example.test/player/texttracks/en?format=json']);
});

test('content script reads subtitle resources declared as preload track links', async () => {
  const harness = createContentHarness({
    includeVideo: true,
    subtitleLinks: [
      {
        rel: 'preload',
        as: 'track',
        href: 'https://cdn.example.test/subtitles/preloaded-en.vtt',
      },
    ],
    backgroundTrackTextByUrl: {
      'https://cdn.example.test/subtitles/preloaded-en.vtt': [
        'WEBVTT',
        '',
        '00:00:02.000 --> 00:00:04.000',
        'Preloaded link subtitle.',
      ].join('\n'),
    },
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Preloaded link subtitle.');
  assert.deepEqual(harness.backgroundFetchRequests, ['https://cdn.example.test/subtitles/preloaded-en.vtt']);
});

test('content script reads subtitle resources declared in player data attributes', async () => {
  const harness = createContentHarness({
    includeVideo: true,
    playerAttributes: {
      'data-setup': JSON.stringify({
        tracks: [
          {
            kind: 'captions',
            src: '/captions/player-config-en.vtt',
          },
        ],
      }),
    },
    backgroundTrackTextByUrl: {
      'https://example.test/captions/player-config-en.vtt': [
        'WEBVTT',
        '',
        '00:00:02.000 --> 00:00:04.000',
        'Player config subtitle.',
      ].join('\n'),
    },
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Player config subtitle.');
  assert.deepEqual(harness.backgroundFetchRequests, ['https://example.test/captions/player-config-en.vtt']);
});

test('content script expands HLS subtitle playlists discovered from performance entries', async () => {
  const harness = createContentHarness({
    includeVideo: true,
    performanceEntries: [
      { name: 'https://cdn.example.test/master.m3u8' },
    ],
    backgroundTrackTextByUrl: {
      'https://cdn.example.test/master.m3u8': [
        '#EXTM3U',
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",URI="subs/en.m3u8"',
      ].join('\n'),
      'https://cdn.example.test/subs/en.m3u8': [
        '#EXTM3U',
        '#EXTINF:4.000,',
        'segment-001.vtt',
      ].join('\n'),
      'https://cdn.example.test/subs/segment-001.vtt': [
        'WEBVTT',
        '',
        '00:00:02.000 --> 00:00:04.000',
        'Subtitle from an HLS segment.',
      ].join('\n'),
    },
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();
  harness.tick();
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Subtitle from an HLS segment.');
  assert.deepEqual(harness.backgroundFetchRequests, [
    'https://cdn.example.test/master.m3u8',
    'https://cdn.example.test/subs/en.m3u8',
    'https://cdn.example.test/subs/segment-001.vtt',
  ]);
});

test('content script reads timedtext XML resources discovered from performance entries', async () => {
  const harness = createContentHarness({
    includeVideo: true,
    performanceEntries: [
      { name: 'https://www.youtube.com/api/timedtext?v=test&lang=en' },
    ],
    backgroundTrackText: [
      '<transcript>',
      '  <text start="2" dur="2">Timedtext XML subtitle.</text>',
      '</transcript>',
    ].join('\n'),
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Timedtext XML subtitle.');
  assert.deepEqual(harness.backgroundFetchRequests, ['https://www.youtube.com/api/timedtext?v=test&lang=en']);
});

test('content script upgrades same-host http subtitle resources on https pages', async () => {
  const harness = createContentHarness({
    includeVideo: true,
    pageUrl: 'https://www.youtube.com/watch?v=test',
    performanceEntries: [
      { name: 'http://www.youtube.com/api/timedtext?v=test&lang=en' },
    ],
    backgroundTrackText: [
      '<transcript>',
      '  <text start="2" dur="2">Secure timedtext subtitle.</text>',
      '</transcript>',
    ].join('\n'),
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments[0].text, 'Secure timedtext subtitle.');
  assert.deepEqual(harness.backgroundFetchRequests, ['https://www.youtube.com/api/timedtext?v=test&lang=en']);
});

test('content script reads YouTube srv3 timedtext XML resources discovered from performance entries', async () => {
  const harness = createContentHarness({
    includeVideo: true,
    performanceEntries: [
      { name: 'https://www.youtube.com/api/timedtext?v=test&lang=en&fmt=srv3' },
    ],
    backgroundTrackText: [
      '<timedtext format="3">',
      '  <body>',
      '    <p t="2000" d="2000"><s>YouTube srv3 XML subtitle.</s></p>',
      '  </body>',
      '</timedtext>',
    ].join('\n'),
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'YouTube srv3 XML subtitle.');
  assert.deepEqual(harness.backgroundFetchRequests, ['https://www.youtube.com/api/timedtext?v=test&lang=en&fmt=srv3']);
});

test('content script expands DASH MPD subtitle resources discovered from performance entries', async () => {
  const harness = createContentHarness({
    includeVideo: true,
    performanceEntries: [
      { name: 'https://cdn.example.test/dash/manifest.mpd' },
    ],
    backgroundTrackTextByUrl: {
      'https://cdn.example.test/dash/manifest.mpd': [
        '<MPD>',
        '  <Period>',
        '    <AdaptationSet mimeType="video/mp4"><Representation><BaseURL>video/init.mp4</BaseURL></Representation></AdaptationSet>',
        '    <AdaptationSet contentType="text" mimeType="text/vtt">',
        '      <Representation><BaseURL>subs/en.vtt</BaseURL></Representation>',
        '    </AdaptationSet>',
        '  </Period>',
        '</MPD>',
      ].join('\n'),
      'https://cdn.example.test/dash/subs/en.vtt': [
        'WEBVTT',
        '',
        '00:00:02.000 --> 00:00:04.000',
        'Subtitle from a DASH manifest.',
      ].join('\n'),
    },
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Subtitle from a DASH manifest.');
  assert.deepEqual(harness.backgroundFetchRequests, [
    'https://cdn.example.test/dash/manifest.mpd',
    'https://cdn.example.test/dash/subs/en.vtt',
  ]);
});

test('content script reads subtitle resources sent from the page interceptor', async () => {
  const harness = createContentHarness({
    includeVideo: true,
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.dispatchWindowMessage({
    source: 'rvt-page-subtitle-interceptor',
    type: 'SUBTITLE_RESOURCE',
    url: 'https://cdn.example.test/timedtext?v=1',
    contentType: 'text/vtt',
    text: 'WEBVTT\n\n00:00:02.000 --> 00:00:04.000\nNetwork captured subtitle.',
  });
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Network captured subtitle.');
});

test('content script reads live subtitle text sent from the page interceptor', async () => {
  const harness = createContentHarness({
    includeVideo: true,
  });
  runContentScript(harness);

  harness.setVideoTime(31.25);
  harness.dispatchWindowMessage({
    source: 'rvt-page-subtitle-interceptor',
    type: 'SUBTITLE_TEXT',
    url: 'wss://stream.example.test/live',
    contentType: 'websocket-message',
    text: 'Live WebSocket subtitle.',
  });
  await harness.flush();

  const transcript = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });
  const diagnostics = await harness.sendMessage({ type: 'GET_DIAGNOSTICS' });

  assert.equal(transcript.ok, true);
  assert.equal(transcript.segments.length, 1);
  assert.equal(transcript.segments[0].text, 'Live WebSocket subtitle.');
  assert.equal(transcript.segments[0].startedAt, 31_250);
  assert.deepEqual(JSON.parse(JSON.stringify(diagnostics.pageSubtitleResources)), [
    {
      url: 'wss://stream.example.test/live',
      contentType: 'websocket-message',
      length: 24,
      cueCount: 1,
      cueSamples: ['Live WebSocket subtitle.'],
    },
  ]);
});

test('content script timestamps parsed subtitle cues with cue start and end times', async () => {
  const harness = createContentHarness({
    includeVideo: true,
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.dispatchWindowMessage({
    source: 'rvt-page-subtitle-interceptor',
    type: 'SUBTITLE_RESOURCE',
    url: 'https://cdn.example.test/timedtext?v=1',
    contentType: 'text/vtt',
    text: 'WEBVTT\n\n00:00:02.000 --> 00:00:04.000\nNetwork cue timeline subtitle.',
  });
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].startedAt, 2_000);
  assert.equal(response.segments[0].updatedAt, 4_000);
  assert.match(response.srt, /00:00:02,000 --> 00:00:04,000/);
});

test('content script records repeated parsed cue text when cue times differ', async () => {
  const harness = createContentHarness({
    includeVideo: true,
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.dispatchWindowMessage({
    source: 'rvt-page-subtitle-interceptor',
    type: 'SUBTITLE_RESOURCE',
    url: 'https://cdn.example.test/repeated.vtt',
    contentType: 'text/vtt',
    text: [
      'WEBVTT',
      '',
      '00:00:02.000 --> 00:00:04.000',
      'Yes.',
      '',
      '00:00:08.000 --> 00:00:10.000',
      'Yes.',
    ].join('\n'),
  });
  await harness.flush();

  harness.setVideoTime(8.5);
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 2);
  assert.deepEqual(response.segments.map((segment) => segment.startedAt), [2_000, 8_000]);
});

test('content script reads timedtext JSON resources sent from the page interceptor', async () => {
  const harness = createContentHarness({
    includeVideo: true,
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.dispatchWindowMessage({
    source: 'rvt-page-subtitle-interceptor',
    type: 'SUBTITLE_RESOURCE',
    url: 'https://www.youtube.com/api/timedtext?fmt=json3&lang=en',
    contentType: 'application/json',
    text: JSON.stringify({
      events: [
        {
          tStartMs: 2000,
          dDurationMs: 2000,
          segs: [
            { utf8: 'Network JSON ' },
            { utf8: 'subtitle.' },
          ],
        },
      ],
    }),
  });
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Network JSON subtitle.');
});

test('content script cleans generic JSON subtitle markup sent from the page interceptor', async () => {
  const harness = createContentHarness({
    includeVideo: true,
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.dispatchWindowMessage({
    source: 'rvt-page-subtitle-interceptor',
    type: 'SUBTITLE_RESOURCE',
    url: 'https://stream.example.test/api/captions',
    contentType: 'application/json',
    text: JSON.stringify({
      captions: [
        {
          start: 2,
          end: 4,
          text: '<i>Generic</i> JSON&nbsp;<b>subtitle</b>.',
        },
      ],
    }),
  });
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Generic JSON subtitle.');
});

test('content script reuses page-intercepted subtitle cues as playback advances', async () => {
  const harness = createContentHarness({
    includeVideo: true,
  });
  runContentScript(harness);

  harness.setVideoTime(0);
  harness.dispatchWindowMessage({
    source: 'rvt-page-subtitle-interceptor',
    type: 'SUBTITLE_RESOURCE',
    url: 'https://cdn.example.test/early-subtitles.vtt',
    contentType: 'text/vtt',
    text: 'WEBVTT\n\n00:00:02.000 --> 00:00:04.000\nDelayed network subtitle.',
  });
  await harness.flush();

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Delayed network subtitle.');
});

test('content script loads subtitle references from page-intercepted player JSON', async () => {
  const harness = createContentHarness({
    includeVideo: true,
    backgroundTrackTextByUrl: {
      'https://www.netflix.com/watch/subtitles/en.dfxp': [
        '<tt>',
        '  <body><div>',
        '    <p begin="00:00:02.000" end="00:00:04.000">Referenced JSON manifest subtitle.</p>',
        '  </div></body>',
        '</tt>',
      ].join('\n'),
    },
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.dispatchWindowMessage({
    source: 'rvt-page-subtitle-interceptor',
    type: 'SUBTITLE_RESOURCE',
    url: 'https://www.netflix.com/watch/12345',
    contentType: 'application/json',
    text: JSON.stringify({
      timedtexttracks: [
        {
          language: 'en',
          ttDownloadables: {
            'dfxp-ls-sdh': {
              downloadUrls: {
                en: 'subtitles/en.dfxp',
              },
            },
          },
        },
      ],
    }),
  });
  await harness.flush();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Referenced JSON manifest subtitle.');
  assert.deepEqual(harness.backgroundFetchRequests, ['https://www.netflix.com/watch/subtitles/en.dfxp']);
});

test('content script loads subtitle references from inline player JSON scripts', async () => {
  const harness = createContentHarness({
    includeVideo: true,
    inlineScripts: [
      JSON.stringify({
        player: {
          timedtexttracks: [
            {
              language: 'en',
              ttDownloadables: {
                'dfxp-ls-sdh': {
                  downloadUrls: {
                    en: 'subtitles/inline-en.dfxp',
                  },
                },
              },
            },
          ],
        },
      }),
    ],
    backgroundTrackTextByUrl: {
      'https://example.test/subtitles/inline-en.dfxp': [
        '<tt>',
        '  <body><div>',
        '    <p begin="00:00:02.000" end="00:00:04.000">Inline manifest subtitle.</p>',
        '  </div></body>',
        '</tt>',
      ].join('\n'),
    },
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Inline manifest subtitle.');
  assert.deepEqual(harness.backgroundFetchRequests, ['https://example.test/subtitles/inline-en.dfxp']);
});

test('content script reuses inline player JSON subtitle cues as playback advances', async () => {
  const harness = createContentHarness({
    includeVideo: true,
    inlineScripts: [
      JSON.stringify({
        timedtexttracks: [
          {
            ttDownloadables: {
              'dfxp-ls-sdh': {
                downloadUrls: {
                  en: 'subtitles/inline-delayed.dfxp',
                },
              },
            },
          },
        ],
      }),
    ],
    backgroundTrackTextByUrl: {
      'https://example.test/subtitles/inline-delayed.dfxp': [
        '<tt>',
        '  <body><div>',
        '    <p begin="00:00:02.000" end="00:00:04.000">Delayed inline manifest subtitle.</p>',
        '  </div></body>',
        '</tt>',
      ].join('\n'),
    },
  });
  runContentScript(harness);

  harness.setVideoTime(0.5);
  harness.tick();
  await harness.flush();
  await harness.flush();

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_TRANSCRIPT' });

  assert.equal(response.ok, true);
  assert.equal(response.segments.length, 1);
  assert.equal(response.segments[0].text, 'Delayed inline manifest subtitle.');
  assert.deepEqual(harness.backgroundFetchRequests, ['https://example.test/subtitles/inline-delayed.dfxp']);
});

test('content script reports page subtitle diagnostics for manual site verification', async () => {
  const harness = createContentHarness({
    includeVideo: true,
    initialSubtitleText: 'Active cue.',
    captureState: {
      ok: true,
      isCapturing: true,
      mode: 'auto',
      tabId: 7,
      sourceUrl: 'https://example.test/watch',
    },
    textTracks: [
      { kind: 'subtitles', mode: 'hidden', activeCues: [{ text: 'Active cue.' }] },
      { kind: 'metadata', mode: 'disabled', activeCues: [] },
    ],
    performanceEntries: [
      { name: 'https://cdn.example.test/movie.mp4' },
      { name: 'https://cdn.example.test/subtitles/en.vtt' },
    ],
  });
  runContentScript(harness);

  harness.setVideoTime(12.5);
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_DIAGNOSTICS' });

  assert.equal(response.ok, true);
  assert.equal(response.url, 'https://example.test/watch');
  assert.equal(response.transcriptCount, 1);
  assert.deepEqual(response.captureState, {
    ok: true,
    isCapturing: true,
    mode: 'auto',
    tabId: 7,
    sourceUrl: 'https://example.test/watch',
  });
  assert.deepEqual(response.subtitleResources, ['https://cdn.example.test/subtitles/en.vtt']);
  assert.deepEqual(JSON.parse(JSON.stringify(response.renderedSubtitles)), {
    count: 1,
    samples: [
      {
        source: 'netflix-rendered-subtitle',
        text: 'Active cue.',
      },
    ],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(response.videos)), [
    {
      currentTime: 12.5,
      textTrackCount: 2,
      textTracks: [
        { kind: 'subtitles', mode: 'hidden', activeCueCount: 1, cueSamples: ['Active cue.'] },
        { kind: 'metadata', mode: 'disabled', activeCueCount: 0, cueSamples: [] },
      ],
    },
  ]);
});

test('content script exposes diagnostics snapshot for all-frame collection', async () => {
  const harness = createContentHarness({
    includeVideo: true,
    initialSubtitleText: 'Iframe diagnostics subtitle.',
    performanceEntries: [
      { name: 'https://cdn.example.test/subtitles/frame.vtt' },
    ],
  });
  runContentScript(harness);

  harness.setVideoTime(4.25);
  harness.tick();
  await harness.flush();

  const snapshot = await harness.context.window.__rvtGetDiagnosticsSnapshot();

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.transcriptCount, 1);
  assert.equal(snapshot.renderedSubtitles.count, 1);
  assert.deepEqual(snapshot.subtitleResources, ['https://cdn.example.test/subtitles/frame.vtt']);
});

test('content script reports DOM-declared subtitle resource diagnostics', async () => {
  const harness = createContentHarness({
    includeVideo: true,
    subtitleLinks: [
      {
        rel: 'preload',
        as: 'track',
        href: 'https://cdn.example.test/subtitles/preload-en.vtt',
      },
    ],
    playerAttributes: {
      'data-setup': JSON.stringify({
        tracks: [
          {
            kind: 'captions',
            src: '/captions/player-config-en.vtt',
          },
        ],
      }),
    },
  });
  runContentScript(harness);
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_DIAGNOSTICS' });

  assert.equal(response.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(response.domSubtitleResources)), [
    'https://cdn.example.test/subtitles/preload-en.vtt',
    'https://example.test/captions/player-config-en.vtt',
  ]);
});

test('content script reports intercepted page subtitle resource diagnostics', async () => {
  const harness = createContentHarness({
    includeVideo: true,
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.dispatchWindowMessage({
    source: 'rvt-page-subtitle-interceptor',
    type: 'SUBTITLE_RESOURCE',
    url: 'https://www.youtube.com/api/timedtext?fmt=json3&lang=en',
    contentType: 'application/json',
    text: JSON.stringify({
      events: [
        {
          tStartMs: 2000,
          dDurationMs: 2000,
          segs: [{ utf8: 'Diagnostic JSON subtitle.' }],
        },
      ],
    }),
  });
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_DIAGNOSTICS' });

  assert.equal(response.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(response.pageSubtitleResources)), [
    {
      url: 'https://www.youtube.com/api/timedtext?fmt=json3&lang=en',
      contentType: 'application/json',
      length: 95,
      cueCount: 1,
      cueSamples: ['Diagnostic JSON subtitle.'],
    },
  ]);
});

test('content script reports background-fetched subtitle resource diagnostics', async () => {
  const harness = createContentHarness({
    includeVideo: true,
    performanceEntries: [
      { name: 'https://stream.example.test/subtitles/redirected.vtt' },
    ],
    backgroundTrackResponseByUrl: {
      'https://stream.example.test/subtitles/redirected.vtt': {
        ok: true,
        text: 'WEBVTT\n\n00:00:02.000 --> 00:00:04.000\nBackground diagnostic subtitle.',
        finalUrl: 'https://cdn.example.test/final/subtitles.vtt',
        status: 200,
        contentType: 'text/vtt; charset=utf-8',
        length: 72,
      },
    },
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_DIAGNOSTICS' });

  assert.equal(response.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(response.pageSubtitleResources)), [
    {
      url: 'https://stream.example.test/subtitles/redirected.vtt',
      contentType: 'text/vtt; charset=utf-8',
      length: 72,
      cueCount: 1,
      cueSamples: ['Background diagnostic subtitle.'],
      finalUrl: 'https://cdn.example.test/final/subtitles.vtt',
      status: 200,
      source: 'background-fetch',
    },
  ]);
});

test('content script reports failed background subtitle fetch diagnostics', async () => {
  const harness = createContentHarness({
    includeVideo: true,
    performanceEntries: [
      { name: 'https://stream.example.test/subtitles/expired.dfxp' },
    ],
    backgroundTrackResponseByUrl: {
      'https://stream.example.test/subtitles/expired.dfxp': {
        ok: false,
        error: 'Subtitle track request failed with 403 Forbidden',
        finalUrl: 'https://stream.example.test/subtitles/expired.dfxp',
        status: 403,
        contentType: 'text/plain',
      },
    },
  });
  runContentScript(harness);

  harness.setVideoTime(2.5);
  harness.tick();
  await harness.flush();

  const response = await harness.sendMessage({ type: 'GET_DIAGNOSTICS' });

  assert.equal(response.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(response.pageSubtitleResources)), [
    {
      url: 'https://stream.example.test/subtitles/expired.dfxp',
      contentType: 'text/plain',
      length: 0,
      cueCount: 0,
      cueSamples: [],
      finalUrl: 'https://stream.example.test/subtitles/expired.dfxp',
      status: 403,
      source: 'background-fetch',
      error: 'Subtitle track request failed with 403 Forbidden',
    },
  ]);
});

function runContentScript(harness) {
  const source = fs.readFileSync(new URL('../src/content/contentScript.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, harness.context, {
    filename: 'contentScript.js',
  });
}

function createContentHarness(options = {}) {
  const listeners = [];
  const intervals = [];
  const windowListeners = new Map();
  const backgroundFetchRequests = [];
  const backgroundMessages = [];
  const analysisRequests = [];
  const analysisFetches = Array.from(options.analysisFetches ?? []);
  const syncStorageState = {
    ...(options.storageSettings ?? {}),
  };
  const localStorageState = {
    ...(options.localStorageSettings ?? {}),
  };
  const subtitleNode = new FakeElement('div');
  subtitleNode.className = options.subtitleClassName ?? 'player-timedtext-text-container';
  if (options.subtitleDataUia) subtitleNode.setAttribute('data-uia', options.subtitleDataUia);
  subtitleNode.textContent = options.initialSubtitleText ?? '';
  const documentElement = new FakeElement('html');
  const videoNode = new FakeElement('video');
  videoNode.textTracks = options.textTracks ?? [];
  for (const [name, value] of Object.entries(options.playerAttributes ?? {})) {
    videoNode.setAttribute(name, value);
  }
  const trackNode = new FakeElement('track');
  if (options.useTrackSubtitle) {
    trackNode.kind = 'subtitles';
    trackNode.src = options.trackSrc ?? 'https://example.test/captions.vtt';
    videoNode.append(trackNode);
    documentElement.append(videoNode);
  } else if (options.textTracks || options.includeVideo) {
    documentElement.append(videoNode);
  }
  const shadowHost = options.useShadowSubtitle ? new FakeElement('stream-player') : null;
  if (shadowHost) {
    shadowHost.shadowRoot = new FakeElement('#shadow-root');
    shadowHost.shadowRoot.append(subtitleNode);
    documentElement.append(shadowHost);
  } else if (options.useYouTubePlayerSubtitle) {
    const playerNode = new FakeElement('div');
    playerNode.className = 'html5-video-player';
    playerNode.append(subtitleNode);
    documentElement.append(playerNode);
  }
  for (const inlineScriptText of options.inlineScripts ?? []) {
    const scriptNode = new FakeElement('script');
    scriptNode.textContent = inlineScriptText;
    documentElement.append(scriptNode);
  }
  for (const link of options.subtitleLinks ?? []) {
    const linkNode = new FakeElement('link');
    if (link.rel) linkNode.rel = link.rel;
    if (link.as) linkNode.as = link.as;
    if (link.type) linkNode.type = link.type;
    if (link.href) linkNode.href = link.href;
    if (link.rel) linkNode.setAttribute('rel', link.rel);
    if (link.as) linkNode.setAttribute('as', link.as);
    if (link.type) linkNode.setAttribute('type', link.type);
    if (link.href) linkNode.setAttribute('href', link.href);
    documentElement.append(linkNode);
  }
  const document = new FakeDocument(documentElement, options.useShadowSubtitle ? null : subtitleNode);
  document.title = options.title ?? '';

  const context = {
    window: {},
    document,
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
      }

      observe() {
        document.mutationCallbacks.push(this.callback);
      }
    },
    chrome: {
      runtime: {
        getURL(path) {
          return `chrome-extension://test/${path}`;
        },
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          },
        },
        sendMessage(message, callback) {
          if (message?.target === 'background') {
            backgroundMessages.push(message);
          }

          if (message?.target === 'background' && message.type === 'FETCH_SUBTITLE_TRACK') {
            backgroundFetchRequests.push(message.url);
            callback?.(options.backgroundTrackResponseByUrl?.[message.url] ?? {
              ok: true,
              text: options.backgroundTrackTextByUrl?.[message.url] ?? options.backgroundTrackText ?? options.trackText ?? '',
            });
            return;
          }

          if (message?.target === 'background' && message.type === 'GET_CAPTURE_STATE') {
            callback?.(options.captureState ?? {
              ok: true,
              isCapturing: false,
              mode: 'manual',
              tabId: null,
              sourceUrl: '',
            });
            return;
          }

          if (message?.target === 'background' && message.type === 'ENSURE_NATIVE_SERVICE') {
            callback?.(options.nativeServiceResponse ?? {
              ok: true,
              status: { state: 'running' },
            });
            return;
          }

          callback?.({ ok: false, error: `Unexpected runtime message: ${message?.type}` });
        },
      },
      storage: {
        sync: {
          get(defaults, callback) {
            const settings = {
              ...defaults,
              ...syncStorageState,
            };
            callback?.(settings);
            return Promise.resolve(settings);
          },
          set(values) {
            Object.assign(syncStorageState, values ?? {});
            return Promise.resolve();
          },
        },
        local: {
          get(defaults, callback) {
            const settings = {
              ...defaults,
              ...localStorageState,
            };
            callback?.(settings);
            return Promise.resolve(settings);
          },
          set(values) {
            Object.assign(localStorageState, values ?? {});
            return Promise.resolve();
          },
        },
      },
    },
    setInterval(callback) {
      intervals.push(callback);
      return intervals.length;
    },
    location: {
      href: options.pageUrl ?? 'https://example.test/watch',
    },
    URL,
    TextDecoder,
    atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
    performance: {
      getEntriesByType(type) {
        return type === 'resource' ? options.performanceEntries ?? [] : [];
      },
    },
    fetch: options.disablePageFetch ? undefined : async (url, request = {}) => {
      const requestedUrl = String(url);
      if (requestedUrl === 'http://localhost:8787/analyze') {
        const analysisRequest = JSON.parse(String(request.body ?? '{}'));
        analysisRequests.push(analysisRequest);
        const nextAnalysisFetch = analysisFetches.shift();
        if (nextAnalysisFetch) {
          const payload = await nextAnalysisFetch(analysisRequest);
          return {
            ok: options.analysisResponseStatus ? options.analysisResponseStatus >= 200 && options.analysisResponseStatus < 300 : true,
            status: options.analysisResponseStatus ?? 200,
            json: async () => payload,
            text: async () => JSON.stringify(payload),
          };
        }
        const analysisResponseStatus = options.analysisResponseStatus ?? 200;
        return {
          ok: analysisResponseStatus >= 200 && analysisResponseStatus < 300,
          status: analysisResponseStatus,
          json: async () => options.analysisResponse ?? { items: [] },
          text: async () => JSON.stringify(options.analysisResponse ?? { items: [] }),
        };
      }

      const textByUrl = {
        'https://example.test/captions.vtt': options.trackText ?? '',
        ...(options.pageFetchTextByUrl ?? {}),
      };
      if (!Object.hasOwn(textByUrl, requestedUrl)) {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }
      return {
        ok: true,
        url: requestedUrl,
        status: 200,
        headers: {
          get(name) {
            return String(name).toLowerCase() === 'content-type' ? 'text/vtt; charset=utf-8' : '';
          },
        },
        text: async () => textByUrl[requestedUrl],
      };
    },
  };

  context.window = {
    __realtimeVideoTranscriberLoaded: false,
    setInterval: context.setInterval,
    addEventListener(type, callback) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(callback);
    },
    removeEventListener(type, callback) {
      windowListeners.set(
        type,
        (windowListeners.get(type) ?? []).filter((listener) => listener !== callback),
      );
    },
  };
  context.globalThis = context;
  context.__rvtImport = async (url) => {
    if (url.endsWith('/src/content/siteSubtitles.js')) return siteSubtitles;
    if (url.endsWith('/src/content/overlayMount.js')) return overlayMount;
    if (url.endsWith('/src/shared/segments.js')) return segments;
    if (url.endsWith('/src/shared/transcriptExport.js')) return transcriptExport;
    if (url.endsWith('/src/shared/learningAnalysis.js')) return await import('../src/shared/learningAnalysis.js');
    if (url.endsWith('/src/shared/subtitleDedup.js')) return await import('../src/shared/subtitleDedup.js');
    throw new Error(`Unexpected import URL: ${url}`);
  };

  return {
    context,
    document,
    backgroundMessages,
    backgroundFetchRequests,
    analysisRequests,
    videoNode,
    async flush() {
      for (let index = 0; index < 24; index += 1) {
        await Promise.resolve();
      }
    },
    setSubtitleText(text) {
      subtitleNode.textContent = text;
      document.mutationCallbacks.forEach((callback) => callback());
    },
    tick() {
      intervals.forEach((callback) => callback());
    },
    setVideoTime(currentTime) {
      videoNode.currentTime = currentTime;
    },
    setLocalStorageSettings(settings) {
      Object.assign(localStorageState, settings ?? {});
    },
    setSyncStorageSettings(settings) {
      Object.assign(syncStorageState, settings ?? {});
    },
    dispatchWindowMessage(data) {
      for (const listener of windowListeners.get('message') ?? []) {
        listener({ source: context.window, data });
      }
    },
    sendMessage(message) {
      return new Promise((resolve) => {
        for (const listener of listeners) {
          const handled = listener(message, {}, resolve);
          if (handled) return;
        }
        resolve(undefined);
      });
    },
  };
}

class FakeDocument {
  constructor(documentElement, subtitleNode) {
    this.documentElement = documentElement;
    this.fullscreenElement = null;
    this.webkitFullscreenElement = null;
    this.mutationCallbacks = [];
    this.subtitleNode = subtitleNode;
    this.listeners = new Map();
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }

  querySelector(selector) {
    if (selector === '#rvt-overlay') {
      return this.documentElement.findById('rvt-overlay');
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector !== '*' && this.subtitleNode && selector.split(',').some((item) => this.subtitleNode.matches(item.trim()))) {
      return [this.subtitleNode];
    }
    return this.documentElement.querySelectorAll(selector);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.currentTime = 0;
    this.kind = '';
    this.src = '';
    this.dataset = {};
    this.hidden = false;
    this._textContent = '';
    this.attributes = new Map();
    this.eventListeners = new Map();
    this.classList = {
      values: new Set(),
      toggle: (value) => {
        if (this.classList.values.has(value)) {
          this.classList.values.delete(value);
          return false;
        }
        this.classList.values.add(value);
        return true;
      },
      contains: (value) => this.classList.values.has(value),
    };
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map((child) => child.textContent).join('');
    }
    return this._textContent;
  }

  set id(value) {
    this.attributes.set('id', value);
  }

  get id() {
    return this.attributes.get('id') ?? '';
  }

  set className(value) {
    const classValue = String(value);
    this.attributes.set('class', classValue);
    this.classList.values = new Set(classValue.split(/\s+/).filter(Boolean));
  }

  get className() {
    return this.attributes.get('class') ?? '';
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.get(String(name)) ?? null;
  }

  getAttributeNames() {
    return Array.from(this.attributes.keys());
  }

  set innerHTML(value) {
    this.children = [];
    const html = String(value);

    if (!html.includes('rvt-header')) return;

    const header = new FakeElement('div');
    header.className = 'rvt-header';
    const title = new FakeElement('div');
    title.className = 'rvt-title';
    title.textContent = html.includes('实时学习项') ? '实时学习项' : '实时字幕';
    const status = new FakeElement('div');
    status.className = 'rvt-status';
    status.textContent = '就绪';
    const actions = new FakeElement('div');
    actions.className = 'rvt-header-actions';
    const historyCount = new FakeElement('span');
    historyCount.className = 'rvt-history-count';
    historyCount.textContent = '0 行';
    const positionButton = new FakeElement('button');
    positionButton.className = 'rvt-position';
    positionButton.textContent = '↕';
    const button = new FakeElement('button');
    button.className = 'rvt-collapse';
    button.textContent = '-';
    header.append(title);
    header.append(status);
    actions.append(historyCount);
    actions.append(positionButton);
    header.append(actions);
    header.append(button);
    this.append(header);
    if (html.includes('rvt-current-text')) {
      const current = new FakeElement('div');
      current.className = 'rvt-current';
      const learningHistory = new FakeElement('div');
      learningHistory.className = 'rvt-learning-history';
      const currentText = new FakeElement('div');
      currentText.className = 'rvt-current-text';
      current.append(learningHistory);
      current.append(currentText);
      this.append(current);
      return;
    }

    const list = new FakeElement('div');
    list.className = 'rvt-list';
    this.append(list);
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) {
        node.parentNode.children = node.parentNode.children.filter((child) => child !== node);
      }
      node.parentNode = this;
      this.children.push(node);
    }
  }

  get parentElement() {
    return this.parentNode;
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  addEventListener(type, callback) {
    this.eventListeners.set(type, callback);
  }

  querySelector(selector) {
    if (selector.startsWith('#')) return this.findById(selector.slice(1));
    if (selector.startsWith('.')) return this.findByClass(selector.slice(1));
    return null;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map((item) => item.trim());
    const matches = [];
    if (selectors.some((item) => this.matches(item))) {
      matches.push(this);
    }
    for (const child of this.children) {
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }

  matches(selector) {
    if (selector === '*') return true;
    if (selector === 'video') return String(this.tagName).toLowerCase() === 'video';
    if (selector === 'script') return String(this.tagName).toLowerCase() === 'script';
    if (selector === 'link[href]') return String(this.tagName).toLowerCase() === 'link' && Boolean(this.href || this.getAttribute('href'));
    if (selector === 'track[kind="subtitles"]') {
      return String(this.tagName).toLowerCase() === 'track' && this.kind === 'subtitles';
    }
    if (selector === 'track[kind="captions"]') {
      return String(this.tagName).toLowerCase() === 'track' && this.kind === 'captions';
    }
    if (selector === '.player-timedtext-text-container') return this.className.includes('player-timedtext-text-container');
    if (selector === '.player-timedtext') return this.className.split(/\s+/).includes('player-timedtext');
    if (selector === '[data-uia="player-subtitle"]') return this.attributes.get('data-uia') === 'player-subtitle';
    if (selector === '[data-uia*="subtitle"]') return String(this.attributes.get('data-uia') ?? '').includes('subtitle');
    if (selector === '[data-uia*="timedtext"]') return String(this.attributes.get('data-uia') ?? '').includes('timedtext');
    if (selector === '[class*="subtitle"]') return this.className.includes('subtitle');
    if (selector === '[class*="caption"]') return this.className.includes('caption');
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    return false;
  }

  getClientRects() {
    return [{ width: 100, height: 20 }];
  }

  findById(id) {
    if (this.id === id) return this;
    for (const child of this.children) {
      const found = child.findById(id);
      if (found) return found;
    }
    return null;
  }

  findByClass(className) {
    if (this.className.split(/\s+/).includes(className)) return this;
    for (const child of this.children) {
      const found = child.findByClass(className);
      if (found) return found;
    }
    return null;
  }
}
