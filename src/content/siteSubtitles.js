export const SUBTITLE_SELECTORS = [
  '.player-timedtext-text-container',
  '.player-timedtext',
  '[data-uia="player-subtitle"]',
  '[data-uia*="subtitle"]',
  '[data-uia*="timedtext"]',
  '[data-testid*="subtitle"]',
  '.ytp-caption-segment',
  '.ytp-caption-window-container',
  '.captions-text',
  '.caption-window',
  '.xgplayer-text-track',
  '.xgplayer-text-track-inner',
  '.xgplayer-subtitle',
  '.xgplayer-caption',
  '.vjs-text-track-display',
  '.vjs-text-track-cue',
  '.jw-text-track-display',
  '.jw-text-track-cue',
  '.plyr__captions',
  '.plyr__caption',
  '[aria-live][aria-label*="caption" i]',
  '[aria-live][aria-label*="subtitle" i]',
  '[role="status"][aria-label*="caption" i]',
  '[role="status"][aria-label*="subtitle" i]',
  '[role="log"][aria-label*="caption" i]',
  '[role="log"][aria-label*="subtitle" i]',
  '[class*="subtitle"]',
  '[class*="caption"]',
  'track[kind="subtitles"]',
  'track[kind="captions"]',
];

export function collectSubtitleNodes(root, selector = SUBTITLE_SELECTORS.join(',')) {
  return collectDeepNodes(root, selector);
}

export function collectSubtitleTrackElements(root) {
  return collectDeepNodes(root, 'track[kind="subtitles"],track[kind="captions"]');
}

export function collectSubtitleLinkElements(root) {
  return collectDeepNodes(root, 'link[href]')
    .filter(isSubtitleLinkElement)
    .filter((link, index, links) => {
      const href = getElementUrl(link, 'href');
      return links.findIndex((candidate) => getElementUrl(candidate, 'href') === href) === index;
    });
}

export function collectSubtitleAttributeResourceUrls(root, sourceUrl = '') {
  const references = [];
  for (const node of collectDeepNodes(root, '*')) {
    for (const { name, value } of collectElementAttributes(node)) {
      if (!isLikelySubtitleAttributeValue(name, value)) continue;

      const parsedReferences = parseSubtitleResourceReferences(value, sourceUrl);
      if (parsedReferences.length > 0) {
        references.push(...parsedReferences);
        continue;
      }

      if (looksLikeUrlOrPath(value) && isSubtitleResourceUrl(value)) {
        addResolvedReference(references, value, sourceUrl);
      }
    }
  }

  return references.filter((url, index) => references.indexOf(url) === index);
}

export function collectVideoElements(root) {
  return collectDeepNodes(root, 'video');
}

export function collectSubtitleResourceUrls(performanceObject = globalThis.performance) {
  if (typeof performanceObject?.getEntriesByType !== 'function') return [];

  return Array.from(performanceObject.getEntriesByType('resource') ?? [])
    .map((entry) => entry?.name)
    .filter(isSubtitleResourceUrl)
    .filter((url, index, urls) => urls.indexOf(url) === index);
}

export function isSubtitleResourceUrl(url) {
  const value = String(url ?? '').toLowerCase();
  if (!value) return false;

  return (
    /[./](vtt|webvtt|srt|ttml|dfxp|xml|lrc|bcc|ass|ssa|m3u8|mpd)(?:[?#]|$)/.test(value) ||
    /[?&](format|fmt|type|profile)=(webvtt|vtt|srt|srv1|srv2|srv3|ttml|dfxp|timedtext)(?:&|$)/.test(value) ||
    /(?:^|[/?#&._=-])(?:cue|cues|texttrack|texttracks|closedcaption|closedcaptions|cc)(?:$|[/?#&._=-])/.test(value) &&
      /(?:[?&](format|fmt|type|profile)=(?:json|json3|webvtt|vtt|srt|srv1|srv2|srv3|ttml|dfxp|timedtext)|[./](?:json|vtt|webvtt|srt|ttml|dfxp|xml|bcc|ass|ssa)(?:[?#]|$))/.test(value) ||
    isExtensionlessSubtitleEndpoint(value) ||
    /(?:timedtext|subtitle|subtitles|caption|captions)/.test(value) &&
      /(?:webvtt|vtt|ttml|dfxp|timedtext)/.test(value)
  );
}

function isSubtitleLinkElement(link) {
  const href = getElementUrl(link, 'href');
  if (!href) return false;
  if (isSubtitleResourceUrl(href)) return true;

  const rel = String(link?.rel || link?.getAttribute?.('rel') || '').toLowerCase();
  const as = String(link?.as || link?.getAttribute?.('as') || '').toLowerCase();
  const type = String(link?.type || link?.getAttribute?.('type') || '').toLowerCase();

  return (
    /\b(?:preload|prefetch|alternate)\b/.test(rel) &&
    (as === 'track' || as === 'fetch' || /(?:text\/vtt|application\/ttml|application\/dfxp|text\/xml|application\/xml|\+xml)/.test(type))
  );
}

function getElementUrl(element, attributeName) {
  return String(element?.[attributeName] || element?.getAttribute?.(attributeName) || '').trim();
}

function collectElementAttributes(element) {
  if (!element) return [];

  if (typeof element.getAttributeNames === 'function') {
    return element.getAttributeNames()
      .map((name) => ({ name: String(name), value: String(element.getAttribute(name) ?? '') }));
  }

  const attributes = element.attributes;
  if (!attributes) return [];
  if (attributes instanceof Map) {
    return Array.from(attributes.entries()).map(([name, value]) => ({ name: String(name), value: String(value ?? '') }));
  }

  return Array.from(attributes)
    .map((attribute) => ({ name: String(attribute?.name ?? ''), value: String(attribute?.value ?? '') }))
    .filter((attribute) => attribute.name);
}

function isLikelySubtitleAttributeValue(name, value) {
  const attributeName = String(name ?? '').toLowerCase();
  const attributeValue = String(value ?? '').trim();
  if (!attributeValue) return false;

  return (
    /(?:subtitle|subtitles|caption|captions|timedtext|texttrack|texttracks|track|tracks|setup|config|player)/.test(attributeName) ||
    /(?:subtitle|subtitles|caption|captions|timedtext|texttrack|texttracks|ttdownloadables|downloadurls)/i.test(attributeValue)
  );
}

let lastSubtitleText = '';
let lastSubtitleId = '';

export function normalizeSubtitleText(text) {
  return String(text ?? '')
    .replace(/\\n/g, ' ')
    .replace(/[♪♫]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isLikelySubtitleUiText(text) {
  const normalizedText = normalizeSubtitleText(text);
  if (!normalizedText) return false;
  const uiMarkerCount = countSubtitleUiMarkers(normalizedText);

  return (
    /双语字幕.*不再显示.*下载字幕设置/.test(normalizedText) ||
    /不再显示该快捷方式/.test(normalizedText) ||
    /下载字幕设置/.test(normalizedText) ||
    uiMarkerCount >= 3 ||
    (normalizedText.length > 220 && uiMarkerCount >= 2) ||
    looksLikeYouTubeChromeText(normalizedText) ||
    looksLikePlayerControlText(normalizedText)
  );
}

export function selectSubtitleText(nodes) {
  const candidates = Array.from(nodes ?? []);
  const visibleCandidates = candidates.filter(isVisibleSubtitleNode);
  const preferredCandidates = visibleCandidates.length > 0 ? visibleCandidates : candidates;

  for (const selector of SUBTITLE_SELECTORS) {
    const matches = preferredCandidates.filter((node) => {
      if (typeof node.matches !== 'function') return false;
      return node.matches(selector);
    });

    const text = combineSubtitleNodes(matches);
    if (text) return text;
  }

  for (const node of preferredCandidates) {
    const text = normalizeSubtitleText(node?.textContent);
    if (isLikelySubtitleUiText(text)) continue;
    if (text) return text;
  }

  return '';
}

export function selectYouTubePlayerSubtitleText(root, sourceUrl = '') {
  if (!isYouTubeUrl(sourceUrl)) return '';

  return combineSubtitleNodes(collectYouTubePlayerSubtitleNodes(root, sourceUrl));
}

export function collectYouTubePlayerSubtitleNodes(root, sourceUrl = '') {
  if (!isYouTubeUrl(sourceUrl)) return [];

  return collectDeepNodes(root, '.html5-video-player')
    .flatMap((player) => collectDeepNodes(player, '*'))
    .filter(isYouTubePlayerSubtitleFallbackNode);
}

function combineSubtitleNodes(nodes) {
  return normalizeSubtitleText(
    Array.from(nodes ?? [])
      .map((node) => node?.textContent ?? '')
      .filter(Boolean)
      .filter((text) => !isLikelySubtitleUiText(text))
      .join(' '),
  );
}

function isYouTubeUrl(sourceUrl) {
  try {
    const url = new URL(String(sourceUrl ?? ''));
    return /(^|\.)youtube\.com$/i.test(url.hostname) || /(^|\.)youtu\.be$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function isYouTubePlayerSubtitleFallbackNode(node) {
  const text = normalizeSubtitleText(node?.textContent);
  if (!text || text.length < 8) return false;
  if (!/[A-Za-z]/.test(text) || !/\s/.test(text)) return false;
  if (isLikelySubtitleUiText(text)) return false;
  if (!isVisibleSubtitleNode(node)) return false;
  if (hasTextChildElement(node)) return false;
  if (isInsideYouTubePlayerControls(node)) return false;

  return true;
}

function hasTextChildElement(node) {
  return Array.from(node?.children ?? [])
    .some((child) => normalizeSubtitleText(child?.textContent));
}

function isInsideYouTubePlayerControls(node) {
  let current = node;
  while (current) {
    const tagName = String(current.tagName ?? '').toLowerCase();
    const className = String(current.className ?? '');
    const role = String(current.getAttribute?.('role') ?? '').toLowerCase();
    const ariaLabel = String(current.getAttribute?.('aria-label') ?? '');

    if (['button', 'a', 'input', 'select', 'textarea'].includes(tagName)) return true;
    if (role === 'button' || role === 'slider' || role === 'menuitem') return true;
    if (ariaLabel && looksLikePlayerControlText(ariaLabel)) return true;
    if (/(?:^|\s)ytp-(?:ad|button|chrome|control|gradient|menu|playlist|progress|scrubber|settings|time|title|tooltip)(?:\s|$)/.test(className)) {
      return true;
    }
    if (/(?:^|\s)ytp-ce-|(?:^|\s)ytp-cards/.test(className)) return true;

    current = current.parentElement ?? current.parentNode;
  }

  return false;
}

function countSubtitleUiMarkers(text) {
  const value = String(text ?? '');
  const markers = [
    /点按取消静音/,
    /自动播放模式已关闭/,
    /接下来播放/,
    /直播即将直播/,
    /你已退出账号/,
    /观看的视频可能会添加到电视的观看记录/,
    /如果稍后没有开始播放/,
    /向上拉以精确地调整播放进度/,
    /播放列表/,
    /检索分享信息时出错/,
    /复制链接/,
    /隐藏分享|隐藏 分享/,
    /立即播放/,
    /取消确认/,
    /\b(?:share|autoplay|playlist|subscribed|subscribe|views|watch full video)\b/i,
  ];

  return markers.reduce((count, pattern) => count + (pattern.test(value) ? 1 : 0), 0);
}

function looksLikeYouTubeChromeText(text) {
  const value = String(text ?? '');
  return (
    value.length > 120 &&
    /\d+:\d{2}\s*\/\s*\d+:\d{2}/.test(value) &&
    /(点按取消静音|自动播放|接下来播放|播放列表|观看完整版视频|已退出账号)/.test(value)
  );
}

function looksLikePlayerControlText(text) {
  const value = String(text ?? '');
  const compact = value.replace(/\s+/g, '');
  const controlMarkers = [
    /pause/i,
    /play/i,
    /rewind\s*10s/i,
    /forward\s*10s/i,
    /unmute|mute/i,
    /settings/i,
    /fullscreen|full\s*screen/i,
    /buffered/i,
    /\b\d{1,2}:\d{2}(?::\d{2})?\b/,
    /%/,
  ];
  const markerCount = controlMarkers.reduce((count, pattern) => count + (pattern.test(value) || pattern.test(compact) ? 1 : 0), 0);
  const timeCodeCount = (value.match(/\d{1,2}:\d{2}(?::\d{2})?/g) ?? []).length +
    (compact.match(/\d{1,2}:\d{2}(?::\d{2})?/g) ?? []).length;

  return (
    markerCount >= 3 ||
    /pauseplay/i.test(compact) ||
    /rewind10sforward10s/i.test(compact) ||
    (/buffered/i.test(value) && timeCodeCount >= 2) ||
    (/pause|play|rewind|forward/i.test(value) && timeCodeCount >= 2)
  );
}

function collectDeepNodes(root, selector) {
  const results = [];
  const seenNodes = new Set();
  const seenRoots = new Set();

  collectFromRoot(root, selector, results, seenNodes, seenRoots);
  return results;
}

function collectFromRoot(root, selector, results, seenNodes, seenRoots) {
  if (!root || seenRoots.has(root)) return;
  seenRoots.add(root);

  for (const node of queryAll(root, selector)) {
    addUnique(results, seenNodes, node);
  }

  for (const shadowRoot of collectOpenShadowRoots(root)) {
    collectFromRoot(shadowRoot, selector, results, seenNodes, seenRoots);
  }
}

function collectOpenShadowRoots(root) {
  const shadowRoots = [];
  const seenHosts = new Set();

  const inspect = (node) => {
    if (!node || seenHosts.has(node)) return;
    seenHosts.add(node);

    if (node.shadowRoot) {
      shadowRoots.push(node.shadowRoot);
    }

    for (const child of Array.from(node.children ?? [])) {
      inspect(child);
    }
  };

  inspect(root.documentElement ?? root);

  for (const node of queryAll(root, '*')) {
    inspect(node);
  }

  return shadowRoots;
}

function queryAll(root, selector) {
  if (typeof root?.querySelectorAll !== 'function') return [];

  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function addUnique(results, seenNodes, node) {
  if (!node || seenNodes.has(node)) return;
  seenNodes.add(node);
  results.push(node);
}

export function getSubtitleSource(node) {
  if (!node || typeof node.matches !== 'function') return 'rendered-subtitle';

  if (
    node.matches('.player-timedtext-text-container') ||
    node.matches('.player-timedtext') ||
    node.matches('[data-uia="player-subtitle"]') ||
    node.matches('[data-uia*="subtitle"]') ||
    node.matches('[data-uia*="timedtext"]')
  ) {
    return 'netflix-rendered-subtitle';
  }

  if (
    node.matches('.ytp-caption-segment') ||
    node.matches('.ytp-caption-window-container') ||
    node.matches('.captions-text') ||
    node.matches('.caption-window')
  ) {
    return 'youtube-rendered-caption';
  }

  if (
    node.matches('.xgplayer-text-track') ||
    node.matches('.xgplayer-text-track-inner') ||
    node.matches('.xgplayer-subtitle') ||
    node.matches('.xgplayer-caption')
  ) {
    return 'xgplayer-rendered-caption';
  }

  if (
    node.matches('.vjs-text-track-display') ||
    node.matches('.vjs-text-track-cue')
  ) {
    return 'videojs-rendered-caption';
  }

  if (
    node.matches('.jw-text-track-display') ||
    node.matches('.jw-text-track-cue')
  ) {
    return 'jwplayer-rendered-caption';
  }

  if (
    node.matches('.plyr__captions') ||
    node.matches('.plyr__caption')
  ) {
    return 'plyr-rendered-caption';
  }

  if (
    node.matches('[aria-live][aria-label*="caption" i]') ||
    node.matches('[aria-live][aria-label*="subtitle" i]') ||
    node.matches('[role="status"][aria-label*="caption" i]') ||
    node.matches('[role="status"][aria-label*="subtitle" i]') ||
    node.matches('[role="log"][aria-label*="caption" i]') ||
    node.matches('[role="log"][aria-label*="subtitle" i]')
  ) {
    return 'accessibility-rendered-caption';
  }

  return 'rendered-subtitle';
}

export function readActiveCueText(video) {
  prepareTextTracksForReading(video);
  const tracks = Array.from(video?.textTracks ?? []);

  for (const track of tracks) {
    const activeCues = Array.from(track.activeCues ?? []);
    const text = normalizeSubtitleText(
      activeCues
        .map((cue) => cue.text ?? cue.getCueAsHTML?.().textContent ?? '')
        .join(' '),
    );

    if (text) return text;
  }

  return '';
}

export function prepareTextTracksForReading(video) {
  for (const track of Array.from(video?.textTracks ?? [])) {
    if (!['subtitles', 'captions'].includes(String(track?.kind ?? '').toLowerCase())) continue;
    if (track.mode !== 'disabled') continue;

    try {
      track.mode = 'hidden';
    } catch {
      // Some pages expose read-only track wrappers; keep reading any cues already available.
    }
  }
}

export function parseWebVttCues(webVttText) {
  const blocks = String(webVttText ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n\r?\n+/);
  const cues = [];

  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex === -1) continue;

    const [startRaw, endRaw] = lines[timingIndex].split('-->').map((part) => part.trim());
    const startTime = parseWebVttTimestamp(startRaw);
    const endTime = parseWebVttTimestamp(endRaw.split(/\s+/)[0]);
    const text = normalizeSubtitleText(
      lines
        .slice(timingIndex + 1)
        .map(stripWebVttMarkup)
        .join(' '),
    );

    if (Number.isFinite(startTime) && Number.isFinite(endTime) && text) {
      cues.push({ startTime, endTime, text });
    }
  }

  return cues;
}

export function parseLrcCues(lrcText) {
  const rawCues = [];
  const timingPattern = /\[(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\]/g;

  for (const line of String(lrcText ?? '').split(/\r?\n/)) {
    const matches = Array.from(line.matchAll(timingPattern));
    if (matches.length === 0) continue;

    const text = normalizeSubtitleText(line.replace(timingPattern, ''));
    if (!text) continue;

    for (const match of matches) {
      const startTime = parseLrcTimestamp(match[1]);
      if (Number.isFinite(startTime)) rawCues.push({ startTime, text });
    }
  }

  return rawCues
    .sort((left, right) => left.startTime - right.startTime)
    .map((cue, index, cues) => ({
      ...cue,
      endTime: roundCueTime(cues[index + 1]?.startTime ?? cue.startTime + 3),
    }));
}

export function parseSrtCues(srtText) {
  const cues = [];
  const blocks = String(srtText ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n\r?\n+/);

  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex === -1) continue;

    const [startRaw, endRaw] = lines[timingIndex].split('-->').map((part) => part.trim());
    const startTime = parseWebVttTimestamp(startRaw);
    const endTime = parseWebVttTimestamp(endRaw.split(/\s+/)[0]);
    const text = normalizeSubtitleText(
      lines
        .slice(timingIndex + 1)
        .map(stripWebVttMarkup)
        .join(' '),
    );

    if (Number.isFinite(startTime) && Number.isFinite(endTime) && text) {
      cues.push({ startTime: roundCueTime(startTime), endTime: roundCueTime(endTime), text });
    }
  }

  return cues;
}

export function parseTtmlCues(ttmlText) {
  const cues = [];
  const text = String(ttmlText ?? '').replace(/^\uFEFF/, '');
  const timing = readTtmlTimingParameters(text);
  const paragraphPattern = /<(?:[\w.-]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?p>/gi;
  let match;

  while ((match = paragraphPattern.exec(text))) {
    const attributes = parseXmlAttributes(match[1]);
    const startTime = parseTimedTextTimestamp(attributes.begin, timing);
    const endTime = attributes.end
      ? parseTimedTextTimestamp(attributes.end, timing)
      : startTime + parseTimedTextTimestamp(attributes.dur, timing);
    const cueText = normalizeSubtitleText(stripTtmlMarkup(match[2]));

    if (Number.isFinite(startTime) && Number.isFinite(endTime) && cueText) {
      cues.push({ startTime: roundCueTime(startTime), endTime: roundCueTime(endTime), text: cueText });
    }
  }

  return cues;
}

export function parseTimedTextXmlCues(xmlText) {
  const cues = [];
  const text = String(xmlText ?? '').replace(/^\uFEFF/, '');
  const textPattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  const paragraphPattern = /<(?:[\w.-]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?p>/gi;
  let match;

  while ((match = textPattern.exec(text))) {
    const attributes = parseXmlAttributes(match[1]);
    const startTime = Number(attributes.start);
    const duration = Number(attributes.dur ?? 3);
    const cueText = normalizeSubtitleText(stripTtmlMarkup(match[2]));

    if (Number.isFinite(startTime) && Number.isFinite(duration) && cueText) {
      cues.push({ startTime, endTime: startTime + duration, text: cueText });
    }
  }

  while ((match = paragraphPattern.exec(text))) {
    const attributes = parseXmlAttributes(match[1]);
    const startTime = Number(attributes.t) / 1000;
    const duration = Number(attributes.d ?? 3000) / 1000;
    const cueText = normalizeSubtitleText(stripTtmlMarkup(match[2]));

    if (Number.isFinite(startTime) && Number.isFinite(duration) && cueText) {
      cues.push({ startTime: roundCueTime(startTime), endTime: roundCueTime(startTime + duration), text: cueText });
    }
  }

  return cues;
}

export function parseTimedTextJsonCues(jsonText) {
  let payload;
  try {
    payload = JSON.parse(String(jsonText ?? ''));
  } catch {
    return [];
  }

  const events = Array.isArray(payload?.events) ? payload.events : [];
  const cues = [];

  for (const event of events) {
    const startTime = Number(event?.tStartMs) / 1000;
    const duration = Number(event?.dDurationMs ?? 3000) / 1000;
    const text = normalizeSubtitleText(
      Array.from(event?.segs ?? [])
        .map((segment) => segment?.utf8 ?? '')
        .join(''),
    );

    if (Number.isFinite(startTime) && Number.isFinite(duration) && text) {
      cues.push({ startTime, endTime: startTime + duration, text });
    }
  }

  if (cues.length > 0) return cues;
  return parseGenericJsonCues(payload);
}

export function parseSubtitleTrackCues(trackText) {
  const text = String(trackText ?? '').trimStart();
  if (/^(WEBVTT|\uFEFFWEBVTT)/i.test(text)) return parseWebVttCues(text);
  if (looksLikeLrcText(text)) return parseLrcCues(text);
  if (looksLikeSrtText(text)) return parseSrtCues(text);
  if (looksLikeAssText(text)) return parseAssCues(text);
  if (/^[\[{]/.test(text)) return parseTimedTextJsonCues(text);
  if (/^<\?xml\b/i.test(text) || /^<tt[\s>]/i.test(text)) return parseTtmlCues(text);
  if (/^<(transcript|timedtext)[\s>]/i.test(text)) return parseTimedTextXmlCues(text);
  return parseWebVttCues(text);
}

export function parseSubtitleResourceReferences(resourceText, sourceUrl = '') {
  const text = String(resourceText ?? '');
  const trimmedText = text.trimStart();
  if (/^[\[{]/.test(trimmedText)) {
    return parseJsonSubtitleReferences(text, sourceUrl);
  }

  if (/^<\?xml\b[\s\S]*<MPD\b/i.test(text) || /^<MPD\b/i.test(trimmedText)) {
    return parseMpdSubtitleReferences(text, sourceUrl);
  }

  if (!/^#EXTM3U/m.test(text)) {
    return parseInlineJavaScriptSubtitleReferences(text, sourceUrl);
  }

  const references = [];
  for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    if (line.startsWith('#EXT-X-MEDIA') && /TYPE=SUBTITLES/i.test(line)) {
      const attributes = parseM3u8Attributes(line.slice(line.indexOf(':') + 1));
      addResolvedReference(references, attributes.URI, sourceUrl);
      continue;
    }

    if (!line.startsWith('#') && isDirectSubtitleCueResourceUrl(line)) {
      addResolvedReference(references, line, sourceUrl);
    }
  }

  return references.filter((url, index) => references.indexOf(url) === index);
}

function parseJsonSubtitleReferences(text, sourceUrl) {
  let payload;
  try {
    payload = JSON.parse(String(text ?? ''));
  } catch {
    return [];
  }

  const references = [];
  collectJsonSubtitleReferences(payload, [], references, sourceUrl);
  return references.filter((url, index) => references.indexOf(url) === index);
}

function parseInlineJavaScriptSubtitleReferences(text, sourceUrl) {
  const references = [];
  for (const jsonText of extractJsonCandidates(text)) {
    references.push(...parseJsonSubtitleReferences(jsonText, sourceUrl));
  }
  references.push(...extractQuotedJavaScriptSubtitleReferences(text, sourceUrl));
  return references.filter((url, index) => references.indexOf(url) === index);
}

function extractQuotedJavaScriptSubtitleReferences(text, sourceUrl) {
  const references = [];
  const source = String(text ?? '');
  if (!isLikelySubtitleContext([source])) return references;

  const quotedStringPattern = /(["'])(.*?)\1/g;
  let match;
  while ((match = quotedStringPattern.exec(source))) {
    const value = match[2];
    if (!looksLikeUrlOrPath(value)) continue;
    if (isSubtitleResourceUrl(value)) {
      addResolvedReference(references, value, sourceUrl);
    }
  }
  return references;
}

function looksLikeUrlOrPath(value) {
  return /^(https?:)?\/\//i.test(String(value ?? '')) ||
    /^[./]/.test(String(value ?? '')) ||
    /[/?#]/.test(String(value ?? '')) ||
    /\.(?:vtt|webvtt|srt|ttml|dfxp|xml|lrc|bcc|ass|ssa|m3u8|mpd)(?:[?#]|$)/i.test(String(value ?? ''));
}

function extractJsonCandidates(text) {
  const value = String(text ?? '');
  const candidates = [];
  for (let index = 0; index < value.length; index += 1) {
    const open = value[index];
    if (open !== '{' && open !== '[') continue;

    const close = open === '{' ? '}' : ']';
    const end = findBalancedJsonEnd(value, index, open, close);
    if (end === -1) continue;

    candidates.push(value.slice(index, end + 1));
    index = end;
  }
  return candidates;
}

function findBalancedJsonEnd(text, startIndex, open, close) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === open) depth += 1;
    if (character === close) depth -= 1;
    if (depth === 0) return index;
  }

  return -1;
}

function parseGenericJsonCues(payload) {
  const cues = [];
  for (const item of collectGenericJsonCueItems(payload)) {
    const cue = parseGenericJsonCue(item);
    if (cue) cues.push(cue);
  }
  return cues;
}

function collectGenericJsonCueItems(value, path = []) {
  if (!value || typeof value !== 'object') return [];

  if (Array.isArray(value)) {
    if ((path.length === 0 || isLikelyGenericCueContainer(path)) && value.some((item) => parseGenericJsonCue(item))) {
      return value;
    }

    return value.flatMap((item, index) => collectGenericJsonCueItems(item, path.concat(String(index))));
  }

  return Object.entries(value).flatMap(([key, child]) => collectGenericJsonCueItems(child, path.concat(key)));
}

function parseGenericJsonCue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const startTime = readCueTime(value, ['startTime', 'start', 'begin', 'from'], [
    'startMs',
    'start_ms',
    'beginMs',
    'startTimeMs',
    'start_time_ms',
    'startOffsetMs',
    'start_offset_ms',
    't',
  ]);
  const endTime = readCueTime(value, ['endTime', 'end', 'to'], [
    'endMs',
    'end_ms',
    'endTimeMs',
    'end_time_ms',
    'endOffsetMs',
    'end_offset_ms',
    'e',
  ]);
  const duration = readCueTime(value, ['duration', 'dur'], [
    'durationMs',
    'duration_ms',
    'durationMillis',
    'duration_millis',
    'd',
  ]);
  const text = readGenericCueText(value);
  const resolvedEndTime = Number.isFinite(endTime) ? endTime : startTime + duration;

  if (!Number.isFinite(startTime) || !Number.isFinite(resolvedEndTime) || !text) return null;
  return { startTime, endTime: roundCueTime(resolvedEndTime), text };
}

function readCueTime(value, secondKeys, millisecondKeys) {
  for (const key of secondKeys) {
    const time = parseGenericCueTime(value?.[key], false);
    if (Number.isFinite(time)) return time;
  }

  for (const key of millisecondKeys) {
    const time = parseGenericCueTime(value?.[key], true);
    if (Number.isFinite(time)) return time;
  }

  return Number.NaN;
}

function parseGenericCueTime(value, milliseconds) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return milliseconds ? numeric / 1000 : numeric;

  if (typeof value !== 'string') return Number.NaN;
  return parseTimedTextTimestamp(value);
}

function looksLikeLrcText(text) {
  return /^\s*(?:\[[a-z]+:[^\]]*\]\s*)*\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/im.test(String(text ?? ''));
}

function looksLikeSrtText(text) {
  return /^\s*(?:\d+\s*)?\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/m.test(String(text ?? ''));
}

function parseLrcTimestamp(value) {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?$/);
  if (!match) return Number.NaN;

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fractionText = match[3] ?? '';
  const fraction = fractionText ? Number(`0.${fractionText.padEnd(3, '0').slice(0, 3)}`) : 0;
  if (![minutes, seconds, fraction].every(Number.isFinite)) return Number.NaN;
  return roundCueTime(minutes * 60 + seconds + fraction);
}

function looksLikeAssText(text) {
  return /^\s*\[Script Info\]/im.test(String(text ?? '')) ||
    /^\s*\[Events\]/im.test(String(text ?? '')) ||
    /^\s*Dialogue:/im.test(String(text ?? ''));
}

export function parseAssCues(assText) {
  const cues = [];
  let fields = [];

  for (const rawLine of String(assText ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^Format:/i.test(line)) {
      fields = line.slice(line.indexOf(':') + 1).split(',').map((field) => field.trim().toLowerCase());
      continue;
    }

    if (!/^Dialogue:/i.test(line)) continue;
    const values = splitAssDialogueValues(line.slice(line.indexOf(':') + 1), fields.length || 10);
    const startIndex = fields.indexOf('start') === -1 ? 1 : fields.indexOf('start');
    const endIndex = fields.indexOf('end') === -1 ? 2 : fields.indexOf('end');
    const textIndex = fields.indexOf('text') === -1 ? values.length - 1 : fields.indexOf('text');
    const startTime = parseAssTimestamp(values[startIndex]);
    const endTime = parseAssTimestamp(values[endIndex]);
    const text = cleanAssText(values.slice(textIndex).join(','));

    if (Number.isFinite(startTime) && Number.isFinite(endTime) && text) {
      cues.push({ startTime, endTime, text });
    }
  }

  return cues;
}

function splitAssDialogueValues(value, fieldCount) {
  const parts = String(value ?? '').split(',');
  if (fieldCount <= 1 || parts.length <= fieldCount) return parts.map((part) => part.trim());

  return parts
    .slice(0, fieldCount - 1)
    .concat(parts.slice(fieldCount - 1).join(','))
    .map((part) => part.trim());
}

function parseAssTimestamp(value) {
  const match = String(value ?? '').trim().match(/^(\d+):(\d{2}):(\d{2})(?:[.](\d{1,3}))?$/);
  if (!match) return Number.NaN;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fractionText = match[4] ?? '';
  const fraction = fractionText ? Number(`0.${fractionText.padEnd(3, '0').slice(0, 3)}`) : 0;
  if (![hours, minutes, seconds, fraction].every(Number.isFinite)) return Number.NaN;
  return roundCueTime(hours * 3600 + minutes * 60 + seconds + fraction);
}

function cleanAssText(text) {
  return normalizeSubtitleText(
    String(text ?? '')
      .replace(/\{[^}]*\}/g, ' ')
      .replace(/\\[Nnh]/g, ' ')
      .replace(/\\[A-Za-z]+(?:\([^)]*\)|-?\d+(?:\.\d+)?)?/g, ' '),
  );
}

function readGenericCueText(value) {
  for (const key of ['text', 'caption', 'body', 'content', 'value', 'utf8']) {
    const text = cleanGenericCueText(value?.[key]);
    if (text) return text;
  }

  for (const key of ['lines', 'segments', 'segs', 'fragments', 'words', 'tokens']) {
    if (!Array.isArray(value?.[key])) continue;
    const text = cleanGenericCueText(
      value[key]
        .map((item) => (typeof item === 'string' ? item : item?.text ?? item?.utf8 ?? item?.caption ?? item?.word ?? item?.value ?? ''))
        .join(''),
    );
    if (text) return text;
  }

  return '';
}

function cleanGenericCueText(text) {
  return normalizeSubtitleText(stripTtmlMarkup(text)).replace(/\s+([.,!?;:])/g, '$1');
}

function isLikelyGenericCueContainer(path) {
  return /cue|caption|subtitle|timedtext|texttrack|body/i.test(path.at(-1) ?? '');
}

function collectJsonSubtitleReferences(value, path, references, sourceUrl) {
  if (typeof value === 'string') {
    if (isLikelyJsonSubtitleReference(value, path)) {
      addResolvedReference(references, value, sourceUrl);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectJsonSubtitleReferences(item, path.concat(String(index)), references, sourceUrl));
    return;
  }

  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    collectJsonSubtitleReferences(child, path.concat(key), references, sourceUrl);
  }
}

function isLikelyJsonSubtitleReference(value, path) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  if (isSubtitleResourceUrl(text)) return true;
  if (!isLikelySubtitleContext(path)) return false;

  return /^(https?:)?\/\//i.test(text) ||
    /^\//.test(text) ||
    isExtensionlessSubtitleEndpoint(text) ||
    /^[^<>{}\s]+\.(?:vtt|webvtt|srt|ttml|dfxp|xml|lrc|bcc|ass|ssa|m3u8|mpd)(?:[?#]|$)/i.test(text);
}

function isExtensionlessSubtitleEndpoint(url) {
  const text = String(url ?? '').toLowerCase();
  if (!/[/?#=&.]/.test(text) && !/^(https?:)?\/\//.test(text)) return false;
  if (!/(?:^|[/?#&._=-])(?:timedtext|texttrack|texttracks|subtitle|subtitles|caption|captions|closedcaption|closedcaptions)(?:$|[/?#&._=-])/.test(text)) {
    return false;
  }

  return !/[./](?:css|js|mjs|png|jpe?g|gif|webp|svg|mp4|m4v|m4s|mov|ts)(?:[?#]|$)/.test(text);
}

function isLikelySubtitleContext(path) {
  return /subtitle|caption|timedtext|texttrack|(?:^|\s)tracks?(?:\s|$)|ttdownloadable|downloadurl|downloadable/i.test(path.join(' '));
}

function parseMpdSubtitleReferences(text, sourceUrl) {
  const references = [];
  const adaptationPattern = /<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi;
  let match;

  while ((match = adaptationPattern.exec(String(text ?? '')))) {
    const attributes = parseXmlAttributes(match[1]);
    const descriptor = `${attributes.contentType ?? ''} ${attributes.mimeType ?? ''} ${attributes.codecs ?? ''}`.toLowerCase();
    if (!/(text|subtitle|vtt|ttml|dfxp|stpp|wvtt)/.test(descriptor)) continue;

    const body = match[2];
    for (const baseUrl of extractXmlElementText(body, 'BaseURL')) {
      addResolvedReference(references, decodeXmlEntities(baseUrl), sourceUrl);
    }
    for (const segmentUrl of extractMpdSegmentTemplateReferences(body)) {
      addResolvedReference(references, segmentUrl, sourceUrl);
    }
  }

  return references.filter((url, index) => references.indexOf(url) === index);
}

function extractMpdSegmentTemplateReferences(body) {
  const references = [];
  const representationPattern = /<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/gi;
  let representationMatch;

  while ((representationMatch = representationPattern.exec(String(body ?? '')))) {
    const representationAttributes = parseXmlAttributes(representationMatch[1]);
    const representationId = representationAttributes.id ?? '';
    const representationBody = representationMatch[2];
    for (const segmentUrl of extractSegmentTemplateUrls(representationBody, representationId)) {
      references.push(segmentUrl);
    }
  }

  if (references.length > 0) return references;
  return extractSegmentTemplateUrls(body, '');
}

function extractSegmentTemplateUrls(text, representationId) {
  const references = [];
  const templatePattern = /<SegmentTemplate\b([^>]*)\/?>/gi;
  let templateMatch;

  while ((templateMatch = templatePattern.exec(String(text ?? '')))) {
    const attributes = parseXmlAttributes(templateMatch[1]);
    const media = decodeXmlEntities(attributes.media ?? '');
    if (!isDirectSubtitleCueResourceUrl(media)) continue;

    const startNumber = Number(attributes.startNumber ?? 1);
    const number = Number.isFinite(startNumber) && startNumber > 0 ? Math.floor(startNumber) : 1;
    references.push(
      media
        .replace(/\$RepresentationID\$/g, representationId)
        .replace(/\$Number(?:%0\d+d)?\$/g, String(number)),
    );
  }

  return references;
}

function isDirectSubtitleCueResourceUrl(url) {
  return /[./](vtt|webvtt|srt|ttml|dfxp|xml|lrc|bcc|ass|ssa)(?:[?#]|$)/i.test(String(url ?? ''));
}

export function selectWebVttCueText(cues, currentTime) {
  const activeCues = Array.from(cues ?? []).filter((cue) => {
    const startTime = Number(cue?.startTime);
    const endTime = Number(cue?.endTime);
    return Number(currentTime) >= startTime && Number(currentTime) <= endTime;
  });

  return normalizeSubtitleText(activeCues.map((cue) => cue.text).join(' '));
}

export function buildSubtitleSegment(text, timestamp = Date.now(), previous = {}) {
  const normalizedText = normalizeSubtitleText(text);
  if (!normalizedText) return null;

  const previousText = previous.text ?? lastSubtitleText;
  let id = previous.id ?? lastSubtitleId;

  if (normalizedText !== previousText && !isIncrementalSubtitleUpdate(previousText, normalizedText)) {
    id = `site-${timestamp}-${hashSubtitleText(normalizedText)}`;
  }

  if (!previous || Object.keys(previous).length === 0) {
    lastSubtitleText = normalizedText;
    lastSubtitleId = id;
  }

  return {
    id,
    text: normalizedText,
    translatedText: '',
    language: '',
    isFinal: true,
    startedAt: timestamp,
    updatedAt: timestamp,
    source: 'site-subtitle',
  };
}

function isVisibleSubtitleNode(node) {
  if (!node || typeof node.getClientRects !== 'function') return true;

  return Array.from(node.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
}

function hashSubtitleText(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function parseWebVttTimestamp(value) {
  const parts = String(value ?? '').split(':');
  if (parts.length < 2 || parts.length > 3) return Number.NaN;

  const seconds = Number(parts.at(-1).replace(',', '.'));
  const minutes = Number(parts.at(-2));
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite)) return Number.NaN;

  return hours * 3600 + minutes * 60 + seconds;
}

function stripWebVttMarkup(text) {
  return decodeXmlEntities(
    String(text ?? '')
      .replace(/<v\s+[^>]+>/gi, '')
      .replace(/<\/?[^>]+>/g, ''),
  );
}

function parseXmlAttributes(rawAttributes) {
  const attributes = {};
  const attributePattern = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;

  while ((match = attributePattern.exec(String(rawAttributes ?? '')))) {
    attributes[match[1]] = match[3] ?? match[4] ?? '';
  }

  return attributes;
}

function parseM3u8Attributes(rawAttributes) {
  const attributes = {};
  const attributePattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match;

  while ((match = attributePattern.exec(String(rawAttributes ?? '')))) {
    attributes[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, '');
  }

  return attributes;
}

function extractXmlElementText(text, tagName) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escapedTag}>`, 'gi');
  const values = [];
  let match;

  while ((match = pattern.exec(String(text ?? '')))) {
    values.push(stripTtmlMarkup(match[1]));
  }

  return values;
}

function addResolvedReference(references, value, sourceUrl) {
  if (!value) return;

  try {
    references.push(new URL(value, sourceUrl || globalThis.location?.href).href);
  } catch {
    references.push(String(value));
  }
}

function readTtmlTimingParameters(text) {
  const rootMatch = String(text ?? '').match(/<(?:[\w.-]+:)?tt\b([^>]*)>/i);
  const attributes = parseXmlAttributes(rootMatch?.[1] ?? '');
  const frameRate = Number(attributes['ttp:frameRate'] ?? attributes.frameRate);
  const frameRateMultiplier = parseTtmlFrameRateMultiplier(
    attributes['ttp:frameRateMultiplier'] ?? attributes.frameRateMultiplier,
  );
  const tickRate = Number(attributes['ttp:tickRate'] ?? attributes.tickRate);
  const baseFrameRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  return {
    frameRate: baseFrameRate * frameRateMultiplier,
    tickRate: Number.isFinite(tickRate) && tickRate > 0 ? tickRate : 1,
  };
}

function parseTtmlFrameRateMultiplier(value) {
  const parts = String(value ?? '').trim().split(/\s+/).map(Number);
  if (parts.length !== 2 || !parts.every((part) => Number.isFinite(part) && part > 0)) {
    return 1;
  }
  return parts[0] / parts[1];
}

function roundCueTime(value) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000;
}

function parseTimedTextTimestamp(value, timing = {}) {
  const text = String(value ?? '').trim();
  const frameRate = typeof timing === 'number' ? timing : timing.frameRate ?? 30;
  const tickRate = typeof timing === 'number' ? 1 : timing.tickRate ?? 1;
  if (!text) return Number.NaN;
  if (/^\d+(?:\.\d+)?h$/i.test(text)) return Number(text.slice(0, -1)) * 3600;
  if (/^\d+(?:\.\d+)?m$/i.test(text)) return Number(text.slice(0, -1)) * 60;
  if (/^\d+(?:\.\d+)?s$/i.test(text)) return Number(text.slice(0, -1));
  if (/^\d+(?:\.\d+)?ms$/i.test(text)) return Number(text.slice(0, -2)) / 1000;
  if (/^\d+(?:\.\d+)?f$/i.test(text)) return Number(text.slice(0, -1)) / frameRate;
  if (/^\d+(?:\.\d+)?t$/i.test(text)) return Number(text.slice(0, -1)) / tickRate;
  if (/^\d{1,2}:\d{2}:\d{2}:\d{1,2}$/.test(text)) {
    const [hours, minutes, seconds, frames] = text.split(':').map(Number);
    if (![hours, minutes, seconds, frames].every(Number.isFinite)) return Number.NaN;
    return hours * 3600 + minutes * 60 + seconds + frames / frameRate;
  }
  return parseWebVttTimestamp(text);
}

function stripTtmlMarkup(text) {
  return decodeXmlEntities(
    String(text ?? '')
      .replace(/<(?:[\w.-]+:)?br\s*\/?>/gi, ' ')
      .replace(/<\/?[^>]+>/g, ' '),
  );
}

function decodeXmlEntities(text) {
  return String(text ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, codePoint) => decodeCodePoint(Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_, codePoint) => decodeCodePoint(Number.parseInt(codePoint, 16)));
}

function decodeCodePoint(codePoint) {
  if (!Number.isInteger(codePoint) || codePoint < 0) return '';
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return '';
  }
}

function isIncrementalSubtitleUpdate(previousText, nextText) {
  const previous = normalizeSubtitleText(previousText).toLocaleLowerCase();
  const next = normalizeSubtitleText(nextText).toLocaleLowerCase();
  if (!previous || !next) return false;
  return next.startsWith(`${previous} `) || previous.startsWith(`${next} `);
}
