import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSubtitleSegment,
  collectSubtitleAttributeResourceUrls,
  collectSubtitleLinkElements,
  collectSubtitleNodes,
  collectSubtitleTrackElements,
  collectVideoElements,
  getSubtitleSource,
  collectSubtitleResourceUrls,
  isSubtitleResourceUrl,
  normalizeSubtitleText,
  parseSubtitleTrackCues,
  parseSubtitleResourceReferences,
  parseSrtCues,
  parseTimedTextXmlCues,
  parseTtmlCues,
  parseWebVttCues,
  readActiveCueText,
  prepareTextTracksForReading,
  selectWebVttCueText,
  selectSubtitleText,
} from '../src/content/siteSubtitles.js';

test('normalizeSubtitleText removes repeated whitespace and music markers', () => {
  assert.equal(
    normalizeSubtitleText(' ♪  How can we\\nuse computers?  ♪ '),
    'How can we use computers?',
  );
});

test('selectSubtitleText prefers Netflix-style subtitle nodes', () => {
  const nodes = [
    { matches: () => false, textContent: 'Ignore me', getClientRects: () => [{ width: 10, height: 10 }] },
    {
      matches: (selector) => selector.includes('.player-timedtext-text-container'),
      textContent: 'How can we use computers?',
      getClientRects: () => [{ width: 10, height: 10 }],
    },
  ];

  assert.equal(selectSubtitleText(nodes), 'How can we use computers?');
});

test('selectSubtitleText prefers Netflix timedtext data-uia nodes', () => {
  const nodes = [
    { matches: () => false, textContent: 'Player chrome label', getClientRects: () => [{ width: 120, height: 20 }] },
    {
      matches: (selector) => selector.includes('[data-uia*="timedtext"]'),
      textContent: 'Netflix data-uia timed text.',
      getClientRects: () => [{ width: 200, height: 20 }],
    },
  ];

  assert.equal(selectSubtitleText(nodes), 'Netflix data-uia timed text.');
});

test('selectSubtitleText ignores hidden subtitle-like nodes when visible nodes exist', () => {
  const nodes = [
    {
      matches: (selector) => selector.includes('[class*="subtitle"]'),
      textContent: 'Hidden marketing subtitle',
      getClientRects: () => [],
    },
    {
      matches: (selector) => selector.includes('.ytp-caption-segment'),
      textContent: 'Visible caption line',
      getClientRects: () => [{ width: 100, height: 20 }],
    },
  ];

  assert.equal(selectSubtitleText(nodes), 'Visible caption line');
});

test('selectSubtitleText ignores bilingual subtitle shortcut prompts', () => {
  const nodes = [
    {
      matches: (selector) => selector.includes('[class*="subtitle"]'),
      textContent: '双语字幕自动开启双语字幕不再显示该快捷方式下载字幕设置',
      getClientRects: () => [{ width: 500, height: 40 }],
    },
  ];

  assert.equal(selectSubtitleText(nodes), '');
});

test('selectSubtitleText combines visible YouTube caption segments', () => {
  const nodes = [
    {
      matches: (selector) => selector.includes('.ytp-caption-segment'),
      textContent: 'The generation before us',
      getClientRects: () => [{ width: 160, height: 20 }],
    },
    {
      matches: (selector) => selector.includes('.ytp-caption-segment'),
      textContent: 'had no computers.',
      getClientRects: () => [{ width: 130, height: 20 }],
    },
  ];

  assert.equal(selectSubtitleText(nodes), 'The generation before us had no computers.');
});

test('selectSubtitleText prefers YouTube caption segments over broad caption-like page text', () => {
  const nodes = [
    {
      matches: (selector) => selector.includes('[class*="caption"]'),
      textContent: 'The Excalidraw-Obsidian Showcase: 57 key features in just 17 minutes',
      getClientRects: () => [{ width: 800, height: 80 }],
    },
    {
      matches: (selector) => selector.includes('.ytp-caption-segment'),
      textContent: 'you can select between the different models',
      getClientRects: () => [{ width: 300, height: 24 }],
    },
  ];

  assert.equal(selectSubtitleText(nodes), 'you can select between the different models');
});

test('selectSubtitleText ignores YouTube page chrome captured by broad caption selectors', () => {
  const nodes = [
    {
      matches: (selector) => selector.includes('[class*="caption"]'),
      textContent: [
        'The Excalidraw-Obsidian Showcase: 57 key features in just 17 minutes',
        '点按取消静音',
        '2x',
        'Zsolt\'s Visual Personal Knowledge Management 192,607次观看 2年前',
        '复制链接 信息 购物 播放列表',
        '如果稍后没有开始播放，请尝试重新启动设备。',
        '向上拉以精确地调整播放进度',
        '自动播放模式已关闭',
        '接下来播放 直播即将直播 取消 立即播放',
        '你已退出账号',
        '隐藏 分享 包括播放列表 检索分享信息时出错，请稍后重试。',
        '0:00 0:32 / 18:39 直播 观看完整版视频 OCR',
      ].join(''),
      getClientRects: () => [{ width: 600, height: 500 }],
    },
  ];

  assert.equal(selectSubtitleText(nodes), '');
});

test('selectSubtitleText ignores player control labels captured as caption text', () => {
  const nodes = [
    {
      matches: (selector) => selector.includes('[class*="caption"]'),
      textContent: [
        'PausePlayRewind 10sForward 10s',
        'test% buffered25:5025:4800:4126:00',
        'Unmute Settings Full screen',
      ].join(''),
      getClientRects: () => [{ width: 620, height: 160 }],
    },
  ];

  assert.equal(selectSubtitleText(nodes), '');
});

test('selectSubtitleText combines Netflix child subtitle spans inside one line', () => {
  const nodes = [
    {
      matches: (selector) => selector.includes('[data-uia*="subtitle"]'),
      textContent: 'My generation was the first generation',
      getClientRects: () => [{ width: 260, height: 20 }],
    },
    {
      matches: (selector) => selector.includes('[data-uia*="subtitle"]'),
      textContent: 'that had to ask the question,',
      getClientRects: () => [{ width: 230, height: 20 }],
    },
  ];

  assert.equal(
    selectSubtitleText(nodes),
    'My generation was the first generation that had to ask the question,',
  );
});

test('selectSubtitleText reads accessibility live caption regions', () => {
  const nodes = [
    {
      matches: (selector) => selector.includes('[aria-live][aria-label*="caption" i]'),
      textContent: 'Accessibility caption region.',
      getClientRects: () => [{ width: 240, height: 24 }],
    },
  ];

  assert.equal(selectSubtitleText(nodes), 'Accessibility caption region.');
});

test('selectSubtitleText reads common embedded video player caption containers', () => {
  const cases = [
    ['.xgplayer-text-track', 'XGPlayer visible caption.'],
    ['.vjs-text-track-cue', 'Video.js visible caption.'],
    ['.jw-text-track-cue', 'JW Player visible caption.'],
    ['.plyr__caption', 'Plyr visible caption.'],
  ];

  for (const [matchingSelector, expectedText] of cases) {
    const nodes = [
      {
        matches: () => false,
        textContent: 'Visible player title, not a caption.',
        getClientRects: () => [{ width: 240, height: 24 }],
      },
      {
        matches: (selector) => selector.includes(matchingSelector),
        textContent: expectedText,
        getClientRects: () => [{ width: 240, height: 24 }],
      },
    ];

    assert.equal(selectSubtitleText(nodes), expectedText);
  }
});

test('collectSubtitleNodes scans open shadow DOM subtitle nodes', () => {
  const subtitle = createNode({
    className: 'player-timedtext-text-container',
    textContent: 'Captions inside a player component.',
  });
  const host = createNode({
    shadowRoot: createNode({
      children: [subtitle],
    }),
  });
  const document = createDocument([host]);

  const nodes = collectSubtitleNodes(document, '.player-timedtext-text-container');

  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].textContent, 'Captions inside a player component.');
});

test('collectVideoElements scans video elements inside open shadow DOM', () => {
  const video = createNode({ tagName: 'video' });
  const host = createNode({
    shadowRoot: createNode({
      children: [video],
    }),
  });
  const document = createDocument([host]);

  assert.deepEqual(collectVideoElements(document), [video]);
});

test('collectSubtitleTrackElements scans subtitle track elements inside open shadow DOM', () => {
  const track = createNode({ tagName: 'track', kind: 'subtitles', src: 'captions.vtt' });
  const host = createNode({
    shadowRoot: createNode({
      children: [track],
    }),
  });
  const document = createDocument([host]);

  assert.deepEqual(collectSubtitleTrackElements(document), [track]);
});

test('collectSubtitleLinkElements scans preload subtitle links inside open shadow DOM', () => {
  const link = createNode({
    tagName: 'link',
    rel: 'preload',
    as: 'track',
    href: 'https://cdn.example/subtitles/en.vtt',
  });
  const host = createNode({
    shadowRoot: createNode({
      children: [link],
    }),
  });
  const document = createDocument([host]);

  assert.deepEqual(collectSubtitleLinkElements(document), [link]);
});

test('collectSubtitleAttributeResourceUrls extracts subtitle references from player data attributes', () => {
  const player = createNode({
    tagName: 'video',
    attributes: {
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
  const document = createDocument([player]);

  assert.deepEqual(collectSubtitleAttributeResourceUrls(document, 'https://example.test/watch/123'), [
    'https://example.test/captions/player-config-en.vtt',
  ]);
});

test('collectSubtitleResourceUrls finds subtitle resources from performance entries', () => {
  const resources = collectSubtitleResourceUrls({
    getEntriesByType: (type) => {
      assert.equal(type, 'resource');
      return [
        { name: 'https://cdn.example/video/init.mp4' },
        { name: 'https://cdn.example/subtitles/en.vtt?token=abc' },
        { name: 'https://cdn.example/timedtext/episode.dfxp' },
        { name: 'https://cdn.example/player/texttracks/en?format=json' },
        { name: 'https://cdn.example/player/cues/en?type=json' },
      ];
    },
  });

  assert.deepEqual(resources, [
    'https://cdn.example/subtitles/en.vtt?token=abc',
    'https://cdn.example/timedtext/episode.dfxp',
    'https://cdn.example/player/texttracks/en?format=json',
    'https://cdn.example/player/cues/en?type=json',
  ]);
});

test('isSubtitleResourceUrl recognizes common subtitle asset URLs', () => {
  assert.equal(isSubtitleResourceUrl('https://example.test/captions.ttml'), true);
  assert.equal(isSubtitleResourceUrl('https://example.test/subtitles/episode.srt'), true);
  assert.equal(isSubtitleResourceUrl('https://example.test/subtitles/episode.ass'), true);
  assert.equal(isSubtitleResourceUrl('https://example.test/subtitles/episode.ssa'), true);
  assert.equal(isSubtitleResourceUrl('https://example.test/subtitles/episode.bcc'), true);
  assert.equal(isSubtitleResourceUrl('https://example.test/subtitles/episode.lrc'), true);
  assert.equal(isSubtitleResourceUrl('https://example.test/api/timedtext?format=dfxp'), true);
  assert.equal(isSubtitleResourceUrl('https://example.test/api/timedtext?id=abc123'), true);
  assert.equal(isSubtitleResourceUrl('https://example.test/api/texttrack/en?format=json'), true);
  assert.equal(isSubtitleResourceUrl('https://example.test/api/texttracks/en?movieId=123'), true);
  assert.equal(isSubtitleResourceUrl('https://example.test/api/closedcaption?type=json'), true);
  assert.equal(isSubtitleResourceUrl('https://example.test/api/cc/en?fmt=vtt'), true);
  assert.equal(isSubtitleResourceUrl('https://example.test/movie.mp4'), false);
});

test('parseWebVttCues parses cue timestamps and multi-line text', () => {
  const cues = parseWebVttCues([
    'WEBVTT',
    '',
    '1',
    '00:00:01.250 --> 00:00:03.500 align:middle',
    'How can we use',
    'computers better?',
    '',
    '00:00:04.000 --> 00:00:05.000',
    '<v Speaker>The next line.',
  ].join('\n'));

  assert.deepEqual(cues, [
    {
      startTime: 1.25,
      endTime: 3.5,
      text: 'How can we use computers better?',
    },
    {
      startTime: 4,
      endTime: 5,
      text: 'The next line.',
    },
  ]);
});

test('parseWebVttCues decodes common HTML entities in cue text', () => {
  assert.deepEqual(parseWebVttCues([
    'WEBVTT',
    '',
    '00:00:01.000 --> 00:00:02.000',
    'Tom &amp; Jerry &#39;quoted&#39; &lt;tag&gt;',
  ].join('\n')), [
    { startTime: 1, endTime: 2, text: "Tom & Jerry 'quoted' <tag>" },
  ]);
});

test('parseSubtitleTrackCues detects LRC timestamped subtitle assets', () => {
  const cues = parseSubtitleTrackCues([
    '[ar:Example teacher]',
    '[00:01.20]First LRC subtitle line.',
    '[00:03.50]Second LRC subtitle line.',
  ].join('\n'));

  assert.deepEqual(cues, [
    {
      startTime: 1.2,
      endTime: 3.5,
      text: 'First LRC subtitle line.',
    },
    {
      startTime: 3.5,
      endTime: 6.5,
      text: 'Second LRC subtitle line.',
    },
  ]);
});

test('parseSrtCues parses SubRip subtitle blocks', () => {
  assert.deepEqual(parseSrtCues([
    '1',
    '00:00:01,250 --> 00:00:03,500',
    '<i>First SRT subtitle line.</i>',
    '',
    '2',
    '00:00:04.000 --> 00:00:05.250',
    'Second',
    'SRT subtitle line.',
  ].join('\n')), [
    { startTime: 1.25, endTime: 3.5, text: 'First SRT subtitle line.' },
    { startTime: 4, endTime: 5.25, text: 'Second SRT subtitle line.' },
  ]);
});

test('parseSrtCues decodes common HTML entities in cue text', () => {
  assert.deepEqual(parseSrtCues([
    '1',
    '00:00:01,000 --> 00:00:02,000',
    'Tom &amp; Jerry &quot;quoted&quot;',
  ].join('\n')), [
    { startTime: 1, endTime: 2, text: 'Tom & Jerry "quoted"' },
  ]);
});

test('parseSubtitleTrackCues detects SubRip subtitle assets', () => {
  assert.deepEqual(parseSubtitleTrackCues([
    '1',
    '00:00:01,000 --> 00:00:03,000',
    'SRT track subtitle.',
  ].join('\n')), [
    { startTime: 1, endTime: 3, text: 'SRT track subtitle.' },
  ]);
});

test('parseSubtitleTrackCues detects ASS subtitle assets', () => {
  const cues = parseSubtitleTrackCues([
    '[Script Info]',
    'Title: Example',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.20,0:00:03.50,Default,,0,0,0,,{\\an8}First ASS subtitle line.',
    'Dialogue: 0,0:00:04.00,0:00:05.25,Default,,0,0,0,,Second\\NASS subtitle line.',
  ].join('\n'));

  assert.deepEqual(cues, [
    { startTime: 1.2, endTime: 3.5, text: 'First ASS subtitle line.' },
    { startTime: 4, endTime: 5.25, text: 'Second ASS subtitle line.' },
  ]);
});

test('parseTtmlCues parses timed text cues from TTML documents', () => {
  const cues = parseTtmlCues([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tt xmlns="http://www.w3.org/ns/ttml">',
    '  <body>',
    '    <div>',
    '      <p begin="00:00:01.000" end="00:00:03.500">How can we use<br/>computers better?</p>',
    '      <p begin="4s" dur="1.5s"><span>The next line.</span></p>',
    '    </div>',
    '  </body>',
    '</tt>',
  ].join('\n'));

  assert.deepEqual(cues, [
    {
      startTime: 1,
      endTime: 3.5,
      text: 'How can we use computers better?',
    },
    {
      startTime: 4,
      endTime: 5.5,
      text: 'The next line.',
    },
  ]);
});

test('parseTtmlCues parses namespaced TTML tags and frame timestamps', () => {
  const cues = parseTtmlCues([
    '<tt:tt xmlns:tt="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="24">',
    '  <tt:body>',
    '    <tt:div>',
    '      <tt:p begin="00:00:01:12" end="00:00:03:00">Frame timed<br/>subtitle.</tt:p>',
    '    </tt:div>',
    '  </tt:body>',
    '</tt:tt>',
  ].join('\n'));

  assert.deepEqual(cues, [
    {
      startTime: 1.5,
      endTime: 3,
      text: 'Frame timed subtitle.',
    },
  ]);
});

test('parseTtmlCues parses TTML tick timestamps used by streaming subtitle assets', () => {
  const cues = parseTtmlCues([
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:timeBase="media" ttp:tickRate="10000000">',
    '  <body>',
    '    <div>',
    '      <p begin="12000000t" end="24500000t"><span>Tick timed</span><br/><span>subtitle.</span></p>',
    '    </div>',
    '  </body>',
    '</tt>',
  ].join('\n'));

  assert.deepEqual(cues, [
    {
      startTime: 1.2,
      endTime: 2.45,
      text: 'Tick timed subtitle.',
    },
  ]);
});

test('parseTtmlCues parses TTML hour minute and frame offset timestamps', () => {
  const cues = parseTtmlCues([
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="25">',
    '  <body>',
    '    <div>',
    '      <p begin="1.5m" dur="2s">Minute offset subtitle.</p>',
    '      <p begin="0.001h" end="4s">Hour offset subtitle.</p>',
    '      <p begin="50f" dur="25f">Frame offset subtitle.</p>',
    '    </div>',
    '  </body>',
    '</tt>',
  ].join('\n'));

  assert.deepEqual(cues, [
    {
      startTime: 90,
      endTime: 92,
      text: 'Minute offset subtitle.',
    },
    {
      startTime: 3.6,
      endTime: 4,
      text: 'Hour offset subtitle.',
    },
    {
      startTime: 2,
      endTime: 3,
      text: 'Frame offset subtitle.',
    },
  ]);
});

test('parseTtmlCues applies TTML frameRateMultiplier to frame timestamps', () => {
  const cues = parseTtmlCues([
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="30" ttp:frameRateMultiplier="1000 1001">',
    '  <body>',
    '    <div>',
    '      <p begin="00:00:01:15" dur="30f">Fractional frame rate subtitle.</p>',
    '    </div>',
    '  </body>',
    '</tt>',
  ].join('\n'));

  assert.deepEqual(cues, [
    {
      startTime: 1.5005,
      endTime: 2.5015,
      text: 'Fractional frame rate subtitle.',
    },
  ]);
});

test('parseSubtitleTrackCues detects WebVTT and TTML subtitle assets', () => {
  assert.deepEqual(parseSubtitleTrackCues('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello.'), [
    { startTime: 1, endTime: 2, text: 'Hello.' },
  ]);
  assert.deepEqual(parseSubtitleTrackCues('<tt><body><div><p begin="1s" end="2s">Hello XML.</p></div></body></tt>'), [
    { startTime: 1, endTime: 2, text: 'Hello XML.' },
  ]);
});

test('parseTimedTextXmlCues parses transcript text start and duration attributes', () => {
  const cues = parseTimedTextXmlCues([
    '<transcript>',
    '  <text start="1.25" dur="2.5">How can we &amp; use computers?</text>',
    '  <text start="4">Next line without duration.</text>',
    '</transcript>',
  ].join('\n'));

  assert.deepEqual(cues, [
    { startTime: 1.25, endTime: 3.75, text: 'How can we & use computers?' },
    { startTime: 4, endTime: 7, text: 'Next line without duration.' },
  ]);
});

test('parseTimedTextXmlCues parses YouTube srv3 timedtext p t and d attributes', () => {
  const cues = parseTimedTextXmlCues([
    '<timedtext format="3">',
    '  <body>',
    '    <p t="1250" d="2500"><s>How can we </s><s>use computers?</s></p>',
    '    <p t="4000"><s>Next line without duration.</s></p>',
    '  </body>',
    '</timedtext>',
  ].join('\n'));

  assert.deepEqual(cues, [
    { startTime: 1.25, endTime: 3.75, text: 'How can we use computers?' },
    { startTime: 4, endTime: 7, text: 'Next line without duration.' },
  ]);
});

test('parseSubtitleTrackCues detects timedtext transcript XML assets', () => {
  assert.deepEqual(parseSubtitleTrackCues('<transcript><text start="2" dur="1">Hello timed text.</text></transcript>'), [
    { startTime: 2, endTime: 3, text: 'Hello timed text.' },
  ]);
});

test('parseSubtitleTrackCues detects YouTube srv3 timedtext XML assets', () => {
  assert.deepEqual(parseSubtitleTrackCues([
    '<timedtext format="3">',
    '  <body><p t="2000" d="1000"><s>Hello srv3 timed text.</s></p></body>',
    '</timedtext>',
  ].join('\n')), [
    { startTime: 2, endTime: 3, text: 'Hello srv3 timed text.' },
  ]);
});

test('parseSubtitleTrackCues detects timedtext JSON caption assets', () => {
  assert.deepEqual(parseSubtitleTrackCues(JSON.stringify({
    events: [
      {
        tStartMs: 1250,
        dDurationMs: 2250,
        segs: [
          { utf8: 'How can we ' },
          { utf8: 'use captions?' },
        ],
      },
      {
        tStartMs: 4000,
        segs: [
          { utf8: 'Next line.' },
        ],
      },
    ],
  })), [
    { startTime: 1.25, endTime: 3.5, text: 'How can we use captions?' },
    { startTime: 4, endTime: 7, text: 'Next line.' },
  ]);
});

test('parseSubtitleTrackCues detects generic JSON cue arrays', () => {
  assert.deepEqual(parseSubtitleTrackCues(JSON.stringify({
    cues: [
      {
        start: 1.5,
        end: 3,
        text: 'Generic JSON cue.',
      },
      {
        startMs: 4200,
        durationMs: 1300,
        lines: ['Second ', 'generic cue.'],
      },
    ],
  })), [
    { startTime: 1.5, endTime: 3, text: 'Generic JSON cue.' },
    { startTime: 4.2, endTime: 5.5, text: 'Second generic cue.' },
  ]);
});

test('parseSubtitleTrackCues detects BCC-style JSON body cues', () => {
  assert.deepEqual(parseSubtitleTrackCues(JSON.stringify({
    font_size: 0.4,
    font_color: '#FFFFFF',
    background_alpha: 0.5,
    body: [
      {
        from: 1.2,
        to: 3.4,
        location: 2,
        content: 'BCC body cue.',
      },
      {
        from: 4,
        to: 5.5,
        content: '<b>Second</b> BCC cue.',
      },
    ],
  })), [
    { startTime: 1.2, endTime: 3.4, text: 'BCC body cue.' },
    { startTime: 4, endTime: 5.5, text: 'Second BCC cue.' },
  ]);
});

test('parseSubtitleTrackCues detects compact JSON cues with t and d fields', () => {
  assert.deepEqual(parseSubtitleTrackCues(JSON.stringify({
    subtitles: [
      {
        t: 1500,
        d: 2200,
        text: 'Compact millisecond cue.',
      },
      {
        t: '00:00:05.000',
        d: '1.5s',
        fragments: [
          { text: 'Compact ' },
          { text: 'fragment cue.' },
        ],
      },
    ],
  })), [
    { startTime: 1.5, endTime: 3.7, text: 'Compact millisecond cue.' },
    { startTime: 5, endTime: 6.5, text: 'Compact fragment cue.' },
  ]);
});

test('parseSubtitleTrackCues detects offset JSON cues with word arrays', () => {
  assert.deepEqual(parseSubtitleTrackCues(JSON.stringify({
    captions: [
      {
        startOffsetMs: 2400,
        endOffsetMs: 4800,
        words: [
          { word: 'Offset ' },
          { word: 'word ' },
          { text: 'cue.' },
        ],
      },
      {
        start_time_ms: 5200,
        duration_ms: 1100,
        tokens: [
          { value: 'Token ' },
          { value: 'cue.' },
        ],
      },
    ],
  })), [
    { startTime: 2.4, endTime: 4.8, text: 'Offset word cue.' },
    { startTime: 5.2, endTime: 6.3, text: 'Token cue.' },
  ]);
});

test('parseSubtitleTrackCues detects root JSON cue arrays', () => {
  assert.deepEqual(parseSubtitleTrackCues(JSON.stringify([
    {
      start: 2,
      duration: 1.5,
      text: 'Root JSON array cue.',
    },
  ])), [
    { startTime: 2, endTime: 3.5, text: 'Root JSON array cue.' },
  ]);
});

test('parseSubtitleTrackCues detects generic JSON cues with string timestamps', () => {
  assert.deepEqual(parseSubtitleTrackCues(JSON.stringify({
    captions: [
      {
        start: '00:00:02.000',
        end: '00:00:04.500',
        text: 'String timestamp JSON cue.',
      },
      {
        begin: '5.5s',
        dur: '1500ms',
        text: 'Offset string timestamp cue.',
      },
    ],
  })), [
    { startTime: 2, endTime: 4.5, text: 'String timestamp JSON cue.' },
    { startTime: 5.5, endTime: 7, text: 'Offset string timestamp cue.' },
  ]);
});

test('parseSubtitleTrackCues cleans markup and entities from generic JSON cue text', () => {
  assert.deepEqual(parseSubtitleTrackCues(JSON.stringify({
    captions: [
      {
        start: 1,
        end: 2,
        text: '<i>Hello</i> &amp; <b>welcome</b>.',
      },
      {
        start: 3,
        end: 4,
        segments: [
          { text: '<span>Second</span> ' },
          { text: 'line&nbsp;here.' },
        ],
      },
    ],
  })), [
    { startTime: 1, endTime: 2, text: 'Hello & welcome.' },
    { startTime: 3, endTime: 4, text: 'Second line here.' },
  ]);
});

test('parseSubtitleResourceReferences extracts subtitle URIs from HLS playlists', () => {
  const references = parseSubtitleResourceReferences([
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",URI="subs/en/prog_index.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,SUBTITLES="subs"',
    'video/main.m3u8',
    '#EXTINF:4.000,',
    'segments/caption-001.vtt',
  ].join('\n'), 'https://cdn.example.test/master.m3u8');

  assert.deepEqual(references, [
    'https://cdn.example.test/subs/en/prog_index.m3u8',
    'https://cdn.example.test/segments/caption-001.vtt',
  ]);
});

test('parseSubtitleResourceReferences extracts subtitle BaseURL entries from DASH MPD manifests', () => {
  const references = parseSubtitleResourceReferences([
    '<MPD>',
    '  <Period>',
    '    <AdaptationSet mimeType="video/mp4">',
    '      <Representation><BaseURL>video/init.mp4</BaseURL></Representation>',
    '    </AdaptationSet>',
    '    <AdaptationSet contentType="text" mimeType="text/vtt">',
    '      <Representation><BaseURL>subtitles/en.vtt</BaseURL></Representation>',
    '    </AdaptationSet>',
    '    <AdaptationSet mimeType="application/ttml+xml">',
    '      <Representation><BaseURL>subtitles/es.ttml</BaseURL></Representation>',
    '    </AdaptationSet>',
    '  </Period>',
    '</MPD>',
  ].join('\n'), 'https://cdn.example.test/path/manifest.mpd');

  assert.deepEqual(references, [
    'https://cdn.example.test/path/subtitles/en.vtt',
    'https://cdn.example.test/path/subtitles/es.ttml',
  ]);
});

test('parseSubtitleResourceReferences extracts subtitle SegmentTemplate entries from DASH MPD manifests', () => {
  const references = parseSubtitleResourceReferences([
    '<MPD>',
    '  <Period>',
    '    <AdaptationSet mimeType="video/mp4">',
    '      <SegmentTemplate media="video/$Number$.m4s" startNumber="1"/>',
    '    </AdaptationSet>',
    '    <AdaptationSet contentType="text" mimeType="text/vtt">',
    '      <Representation id="en">',
    '        <SegmentTemplate media="subs/$RepresentationID$/$Number$.vtt" startNumber="3"/>',
    '      </Representation>',
    '    </AdaptationSet>',
    '    <AdaptationSet mimeType="application/ttml+xml">',
    '      <Representation id="zh">',
    '        <SegmentTemplate media="timedtext/$RepresentationID$/$Number$.dfxp" startNumber="7"/>',
    '      </Representation>',
    '    </AdaptationSet>',
    '  </Period>',
    '</MPD>',
  ].join('\n'), 'https://cdn.example.test/path/manifest.mpd');

  assert.deepEqual(references, [
    'https://cdn.example.test/path/subs/en/3.vtt',
    'https://cdn.example.test/path/timedtext/zh/7.dfxp',
  ]);
});

test('parseSubtitleResourceReferences extracts subtitle URLs from player JSON manifests', () => {
  const references = parseSubtitleResourceReferences(JSON.stringify({
    videoTracks: [
      {
        urls: [
          { url: 'https://cdn.example.test/video/segment-001.m4s' },
        ],
      },
    ],
    timedtexttracks: [
      {
        language: 'en',
        ttDownloadables: {
          'webvtt-lssdh-ios8': {
            downloadUrls: {
              en: 'subtitles/en.vtt',
            },
          },
          'dfxp-ls-sdh': {
            downloadUrls: {
              en: 'https://cdn.example.test/timedtext?id=abc123',
            },
          },
        },
      },
    ],
  }), 'https://www.netflix.com/watch/12345');

  assert.deepEqual(references, [
    'https://www.netflix.com/watch/subtitles/en.vtt',
    'https://cdn.example.test/timedtext?id=abc123',
  ]);
});

test('parseSubtitleResourceReferences extracts extensionless timedtext URLs from player JSON manifests', () => {
  const references = parseSubtitleResourceReferences(JSON.stringify({
    timedtexttracks: [
      {
        language: 'en',
        ttDownloadables: {
          'dfxp-ls-sdh': {
            downloadUrls: {
              en: 'timedtext?id=relative123',
            },
          },
          'webvtt-lssdh-ios8': {
            downloadUrls: {
              en: 'texttracks/en?profile=webvtt',
            },
          },
        },
      },
    ],
  }), 'https://stream.example.test/player/session/manifest.json');

  assert.deepEqual(references, [
    'https://stream.example.test/player/session/timedtext?id=relative123',
    'https://stream.example.test/player/session/texttracks/en?profile=webvtt',
  ]);
});

test('parseSubtitleResourceReferences extracts subtitle URLs from JavaScript player state assignments', () => {
  const references = parseSubtitleResourceReferences([
    'window.__PLAYER_STATE__ = {',
    '  "videoTracks": [{"urls": [{"url": "video/segment-001.m4s"}]}],',
    '  "timedtexttracks": [{',
    '    "ttDownloadables": {',
    '      "dfxp-ls-sdh": {',
    '        "downloadUrls": {',
    '          "en": "subtitles/assignment-en.dfxp"',
    '        }',
    '      }',
    '    }',
    '  }]',
    '};',
  ].join('\n'), 'https://www.netflix.com/watch/12345');

  assert.deepEqual(references, [
    'https://www.netflix.com/watch/subtitles/assignment-en.dfxp',
  ]);
});

test('parseSubtitleResourceReferences extracts subtitle URLs from JavaScript object literal assignments', () => {
  const references = parseSubtitleResourceReferences([
    'window.__PLAYER_STATE__ = {',
    '  videoTracks: [{ urls: [{ url: "video/segment-001.m4s" }] }],',
    '  timedtexttracks: [{',
    '    ttDownloadables: {',
    "      'dfxp-ls-sdh': {",
    '        downloadUrls: {',
    "          en: 'fixtures/object-literal-en.dfxp'",
    '        }',
    '      }',
    '    }',
    '  }]',
    '};',
  ].join('\n'), 'https://stream.example.test/watch/987');

  assert.deepEqual(references, [
    'https://stream.example.test/watch/fixtures/object-literal-en.dfxp',
  ]);
});

test('parseSubtitleResourceReferences ignores unrelated quoted URLs in subtitle-adjacent scripts', () => {
  const references = parseSubtitleResourceReferences([
    'window.ytInitialData = {',
    '  "captions": {"playerCaptionsTracklistRenderer": {"captionTracks": [',
    '    {"baseUrl": "http://www.youtube.com/api/timedtext?v=test&lang=en&fmt=srv3"}',
    '  ]}},',
    '  "navigationEndpoint": {"url": "http://www.youtube.com/upload"},',
    '  "searchEndpoint": {"url": "http://www.youtube.com/results?search_query="},',
    '  "accountEndpoint": {"url": "http://www.youtube.com/youtubei/v1/account/account_menu"}',
    '};',
  ].join('\n'), 'https://www.youtube.com/watch?v=test');

  assert.deepEqual(references, [
    'http://www.youtube.com/api/timedtext?v=test&lang=en&fmt=srv3',
  ]);
});

test('selectWebVttCueText returns active cue text for current video time', () => {
  const cues = [
    { startTime: 1, endTime: 2, text: 'First line.' },
    { startTime: 2.5, endTime: 4, text: 'Second line.' },
  ];

  assert.equal(selectWebVttCueText(cues, 2.75), 'Second line.');
  assert.equal(selectWebVttCueText(cues, 4.5), '');
});

test('readActiveCueText reads active cues from a video text track', () => {
  const video = {
    textTracks: [
      {
        mode: 'disabled',
        activeCues: [],
      },
      {
        mode: 'showing',
        activeCues: [
          { text: 'The generation before us' },
          { text: 'had no computers.' },
        ],
      },
    ],
  };

  assert.equal(readActiveCueText(video), 'The generation before us had no computers.');
});

test('prepareTextTracksForReading enables disabled subtitle tracks as hidden', () => {
  const subtitleTrack = { kind: 'subtitles', mode: 'disabled' };
  const captionTrack = { kind: 'captions', mode: 'disabled' };
  const metadataTrack = { kind: 'metadata', mode: 'disabled' };
  const showingTrack = { kind: 'subtitles', mode: 'showing' };

  prepareTextTracksForReading({
    textTracks: [subtitleTrack, captionTrack, metadataTrack, showingTrack],
  });

  assert.equal(subtitleTrack.mode, 'hidden');
  assert.equal(captionTrack.mode, 'hidden');
  assert.equal(metadataTrack.mode, 'disabled');
  assert.equal(showingTrack.mode, 'showing');
});

test('buildSubtitleSegment keeps stable ids for unchanged subtitle text', () => {
  const first = buildSubtitleSegment('Hello world', 1000);
  const second = buildSubtitleSegment('Hello world', 1800);
  const third = buildSubtitleSegment('New line', 2200);

  assert.equal(second.id, first.id);
  assert.notEqual(third.id, first.id);
  assert.equal(third.text, 'New line');
});

test('buildSubtitleSegment reuses ids for incremental subtitle growth', () => {
  const first = buildSubtitleSegment('Remember, I came', 1000, {});
  const second = buildSubtitleSegment('Remember, I came into the industry', 1300, {
    id: first.id,
    text: first.text,
  });

  assert.equal(second.id, first.id);
  assert.equal(second.text, 'Remember, I came into the industry');
});

test('buildSubtitleSegment creates a new id for a different sentence', () => {
  const first = buildSubtitleSegment('How do I use computers?', 1000, {});
  const second = buildSubtitleSegment('The generation before us had no computers.', 1300, {
    id: first.id,
    text: first.text,
  });

  assert.notEqual(second.id, first.id);
});

test('getSubtitleSource labels known subtitle providers', () => {
  assert.equal(
    getSubtitleSource({
      matches: (selector) => selector.includes('.player-timedtext-text-container'),
    }),
    'netflix-rendered-subtitle',
  );
  assert.equal(
    getSubtitleSource({
      matches: (selector) => selector.includes('[data-uia*="timedtext"]'),
    }),
    'netflix-rendered-subtitle',
  );
  assert.equal(
    getSubtitleSource({
      matches: (selector) => selector.includes('.ytp-caption-segment'),
    }),
    'youtube-rendered-caption',
  );
  assert.equal(
    getSubtitleSource({
      matches: (selector) => selector.includes('.ytp-caption-window-container'),
    }),
    'youtube-rendered-caption',
  );
  assert.equal(
    getSubtitleSource({
      matches: (selector) => selector.includes('[aria-live][aria-label*="caption" i]'),
    }),
    'accessibility-rendered-caption',
  );
  assert.equal(
    getSubtitleSource({
      matches: (selector) => selector.includes('.xgplayer-text-track'),
    }),
    'xgplayer-rendered-caption',
  );
  assert.equal(
    getSubtitleSource({
      matches: (selector) => selector.includes('.vjs-text-track-cue'),
    }),
    'videojs-rendered-caption',
  );
  assert.equal(
    getSubtitleSource({
      matches: (selector) => selector.includes('.jw-text-track-cue'),
    }),
    'jwplayer-rendered-caption',
  );
  assert.equal(
    getSubtitleSource({
      matches: (selector) => selector.includes('.plyr__caption'),
    }),
    'plyr-rendered-caption',
  );
});

function createDocument(children = []) {
  const documentElement = createNode({ children });
  return {
    documentElement,
    querySelectorAll(selector) {
      return documentElement.querySelectorAll(selector);
    },
  };
}

function createNode(options = {}) {
  const node = {
    tagName: options.tagName ?? 'div',
    className: options.className ?? '',
    kind: options.kind ?? '',
    src: options.src ?? '',
    href: options.href ?? '',
    rel: options.rel ?? '',
    as: options.as ?? '',
    type: options.type ?? '',
    textContent: options.textContent ?? '',
    shadowRoot: options.shadowRoot ?? null,
    children: options.children ?? [],
    attributes: new Map(Object.entries(options.attributes ?? {})),
    getAttribute(name) {
      const propertyValue = this[String(name)];
      if (propertyValue) return propertyValue;
      return this.attributes.get(String(name)) ?? null;
    },
    getAttributeNames() {
      return Array.from(this.attributes.keys());
    },
    matches(selector) {
      if (selector === '*') return true;
      if (selector === '.player-timedtext-text-container') {
        return this.className.split(/\s+/).includes('player-timedtext-text-container');
      }
      if (selector === 'video') return this.tagName === 'video';
      if (selector === 'link[href]') return this.tagName === 'link' && Boolean(this.href);
      if (selector === 'track[kind="subtitles"]') return this.tagName === 'track' && this.kind === 'subtitles';
      if (selector === 'track[kind="captions"]') return this.tagName === 'track' && this.kind === 'captions';
      return false;
    },
    querySelectorAll(selector) {
      const matches = [];
      const selectors = selector.split(',').map((item) => item.trim());
      if (selectors.some((item) => this.matches(item))) matches.push(this);
      for (const child of this.children) {
        matches.push(...child.querySelectorAll(selector));
      }
      return matches;
    },
  };

  for (const child of node.children) {
    child.parentNode = node;
  }

  return node;
}
