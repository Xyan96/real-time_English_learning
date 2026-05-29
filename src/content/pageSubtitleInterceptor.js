(() => {
  const SOURCE = 'rvt-page-subtitle-interceptor';
  const MAX_TEXT_LENGTH = 2_000_000;
  const EVENTSOURCE_SUBTITLE_EVENTS = [
    'caption',
    'captions',
    'subtitle',
    'subtitles',
    'transcript',
    'timedtext',
    'texttrack',
    'closedcaption',
    'cc',
  ];

  if (window.__rvtPageSubtitleInterceptorInstalled) return;
  window.__rvtPageSubtitleInterceptorInstalled = true;

  installFetchInterceptor();
  installXhrInterceptor();
  installWebSocketInterceptor();
  installEventSourceInterceptor();
  installYouTubePlayerResponseProbe();

  function installFetchInterceptor() {
    if (typeof window.fetch !== 'function') return;

    const originalFetch = window.fetch;
    window.fetch = async function interceptedFetch(...args) {
      const response = await originalFetch.apply(this, args);
      inspectFetchResponse(args[0], response);
      return response;
    };
  }

  function installXhrInterceptor() {
    const NativeXhr = window.XMLHttpRequest;
    if (typeof NativeXhr !== 'function') return;

    const originalOpen = NativeXhr.prototype.open;
    const originalSend = NativeXhr.prototype.send;

    NativeXhr.prototype.open = function interceptedOpen(method, url, ...args) {
      this.__rvtSubtitleUrl = resolveRequestUrl(url);
      return originalOpen.call(this, method, url, ...args);
    };

    NativeXhr.prototype.send = function interceptedSend(...args) {
      this.addEventListener('loadend', () => {
        inspectXhrResponse(this);
      });
      return originalSend.apply(this, args);
    };
  }

  function installWebSocketInterceptor() {
    const NativeWebSocket = window.WebSocket;
    if (typeof NativeWebSocket !== 'function') return;

    function InterceptedWebSocket(url, protocols) {
      const socket = protocols === undefined
        ? new NativeWebSocket(url)
        : new NativeWebSocket(url, protocols);
      const resolvedUrl = resolveRequestUrl(url) || String(socket?.url ?? '');

      if (typeof socket?.addEventListener === 'function') {
        socket.addEventListener('message', (event) => {
          inspectWebSocketMessage(resolvedUrl, event?.data);
        });
      }

      return socket;
    }

    try {
      Object.setPrototypeOf(InterceptedWebSocket, NativeWebSocket);
      InterceptedWebSocket.prototype = NativeWebSocket.prototype;
    } catch {
      // Keeping constructor replacement best-effort is enough for message inspection.
    }

    window.WebSocket = InterceptedWebSocket;
  }

  function installEventSourceInterceptor() {
    const NativeEventSource = window.EventSource;
    if (typeof NativeEventSource !== 'function') return;

    function InterceptedEventSource(url, eventSourceInitDict) {
      const stream = eventSourceInitDict === undefined
        ? new NativeEventSource(url)
        : new NativeEventSource(url, eventSourceInitDict);
      const resolvedUrl = resolveRequestUrl(url) || String(stream?.url ?? '');

      if (typeof stream?.addEventListener === 'function') {
        stream.addEventListener('message', (event) => {
          inspectEventSourceMessage(resolvedUrl, event?.data, 'message');
        });
        for (const eventName of EVENTSOURCE_SUBTITLE_EVENTS) {
          stream.addEventListener(eventName, (event) => {
            inspectEventSourceMessage(resolvedUrl, event?.data, eventName);
          });
        }
      }

      return stream;
    }

    try {
      Object.setPrototypeOf(InterceptedEventSource, NativeEventSource);
      InterceptedEventSource.prototype = NativeEventSource.prototype;
    } catch {
      // Constructor replacement still lets us observe message events on most pages.
    }

    window.EventSource = InterceptedEventSource;
  }

  function installYouTubePlayerResponseProbe() {
    if (!isYouTubePage()) return;

    const postedKeys = new Set();
    let attempts = 0;
    const maxAttempts = 80;

    const probe = () => {
      attempts += 1;
      for (const payload of collectYouTubePlayerResponses()) {
        const text = safeJsonStringify(payload);
        if (!text || !hasYouTubeCaptionTracks(payload)) continue;

        const key = collectYouTubeCaptionTrackUrls(payload).join('|') || text.slice(0, 1000);
        if (postedKeys.has(key)) continue;
        postedKeys.add(key);

        postSubtitleResource({
          url: `${String(window.location?.href ?? '').split('#')[0]}#yt-player-response`,
          contentType: 'application/json; source=yt-player-response',
          text,
        });
      }
    };

    probe();
    if (typeof window.setInterval !== 'function' || typeof window.clearInterval !== 'function') return;

    const intervalId = window.setInterval(() => {
      probe();
      if (attempts >= maxAttempts || postedKeys.size > 0) {
        window.clearInterval(intervalId);
      }
    }, 500);
  }

  function isYouTubePage() {
    try {
      return /(^|\.)youtube\.com$/i.test(String(new URL(window.location?.href ?? '').hostname)) ||
        /(^|\.)youtu\.be$/i.test(String(new URL(window.location?.href ?? '').hostname));
    } catch {
      return false;
    }
  }

  function collectYouTubePlayerResponses() {
    const candidates = [
      window.ytInitialPlayerResponse,
      window.ytInitialData,
      window.ytplayer?.config?.args?.player_response,
      window.ytplayer?.bootstrapPlayerResponse,
      window.ytcfg?.data_?.PLAYER_VARS?.player_response,
    ];

    return candidates
      .map(parseMaybeJson)
      .filter(Boolean);
  }

  function parseMaybeJson(value) {
    if (!value) return null;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    if (typeof value === 'object') return value;
    return null;
  }

  function hasYouTubeCaptionTracks(value) {
    return collectYouTubeCaptionTrackUrls(value).length > 0;
  }

  function collectYouTubeCaptionTrackUrls(value) {
    const urls = [];
    collectYouTubeCaptionTrackUrlsInto(value, [], urls);
    return urls.filter((url, index) => urls.indexOf(url) === index);
  }

  function collectYouTubeCaptionTrackUrlsInto(value, path, urls) {
    if (typeof value === 'string') {
      if (/captionTracks/i.test(path.join(' ')) && /\/api\/timedtext\b/i.test(value)) {
        urls.push(value);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => collectYouTubeCaptionTrackUrlsInto(item, path.concat(String(index)), urls));
      return;
    }

    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      collectYouTubeCaptionTrackUrlsInto(child, path.concat(key), urls);
    }
  }

  function safeJsonStringify(value) {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }

  function inspectFetchResponse(input, response) {
    const url = response?.url || resolveRequestUrl(input);
    const contentType = readHeader(response?.headers, 'content-type');

    if (!shouldInspectSubtitleCandidate({ url, contentType }) && !isJsonContentType(contentType) && !isXmlContentType(contentType)) return;
    if (typeof response?.clone !== 'function') return;

    response.clone().text()
      .then((text) => postSubtitleResource({ url, contentType, text }))
      .catch(() => {});
  }

  function inspectXhrResponse(xhr) {
    const responseType = String(xhr?.responseType ?? '');
    if (responseType && !['text', 'arraybuffer', 'blob', 'document', 'json'].includes(responseType)) return;
    if (Number(xhr?.status) >= 400) return;

    const url = xhr?.__rvtSubtitleUrl ?? '';
    const contentType = String(xhr?.getResponseHeader?.('content-type') ?? '');
    readXhrResponseText(xhr)
      .then((text) => postSubtitleResource({ url, contentType, text }))
      .catch(() => {});
  }

  async function readXhrResponseText(xhr) {
    const responseType = String(xhr?.responseType ?? '');
    if (!responseType || responseType === 'text') return String(xhr?.responseText ?? '');
    if (responseType === 'arraybuffer') return new TextDecoder().decode(xhr?.response ?? new ArrayBuffer(0));
    if (responseType === 'blob' && typeof xhr?.response?.text === 'function') return xhr.response.text();
    if (responseType === 'document' && xhr?.response) return new XMLSerializer().serializeToString(xhr.response);
    if (responseType === 'json' && xhr?.response != null) return JSON.stringify(xhr.response);
    return '';
  }

  function postSubtitleResource({ url, contentType, text }) {
    const normalizedText = String(text ?? '');
    if (!isLikelySubtitleResource({ url, contentType, text: normalizedText })) return;
    if (normalizedText.length > MAX_TEXT_LENGTH) return;

    window.postMessage({
      source: SOURCE,
      type: 'SUBTITLE_RESOURCE',
      url: String(url ?? ''),
      contentType: String(contentType ?? ''),
      text: normalizedText,
    }, '*');
  }

  function postSubtitleText({ url, contentType, text }) {
    const normalizedText = normalizeLiveSubtitleText(text);
    if (!normalizedText || normalizedText.length > MAX_TEXT_LENGTH) return;

    window.postMessage({
      source: SOURCE,
      type: 'SUBTITLE_TEXT',
      url: String(url ?? ''),
      contentType: String(contentType ?? ''),
      text: normalizedText,
    }, '*');
  }

  function inspectWebSocketMessage(url, data) {
    readPotentialText(data)
      .then((text) => {
        const subtitleText = extractLiveSubtitleText(text);
        if (subtitleText) {
          postSubtitleText({
            url,
            contentType: 'websocket-message',
            text: subtitleText,
          });
        }
      })
      .catch(() => {});
  }

  function inspectEventSourceMessage(url, data, eventName = 'message') {
    const subtitleText = extractLiveSubtitleText(data, eventName);
    if (subtitleText) {
      postSubtitleText({
        url,
        contentType: eventName === 'message' ? 'eventsource-message' : `eventsource-${eventName}-event`,
        text: subtitleText,
      });
    }
  }

  async function readPotentialText(value) {
    if (typeof value === 'string') return value;
    if (value instanceof ArrayBuffer) return new TextDecoder().decode(value);
    if (typeof value?.text === 'function') return value.text();
    return '';
  }

  function extractLiveSubtitleText(text, context = '') {
    let payload;
    try {
      payload = JSON.parse(String(text ?? ''));
    } catch {
      return '';
    }

    return findLiveSubtitleText(payload, [], context);
  }

  function findLiveSubtitleText(value, path = [], inheritedContext = '') {
    if (!value || typeof value !== 'object') return '';

    if (Array.isArray(value)) {
      return normalizeLiveSubtitleText(value
        .map((item, index) => findLiveSubtitleText(item, path.concat(String(index)), inheritedContext))
        .filter(Boolean)
        .join(' '));
    }

    const currentContext = getLiveSubtitleContext(value, path, inheritedContext);
    for (const [key, child] of Object.entries(value)) {
      if (isLiveSubtitleTextKey(key) && hasLiveSubtitleContext(value, path.concat(key), currentContext)) {
        const text = normalizeLiveSubtitleText(child);
        if (text) return text;
      }
    }

    for (const [key, child] of Object.entries(value)) {
      const text = findLiveSubtitleText(child, path.concat(key), currentContext);
      if (text) return text;
    }

    return '';
  }

  function isLiveSubtitleTextKey(key) {
    return /^(?:text|caption|subtitle|transcript|content|body|value)$/i.test(String(key ?? ''));
  }

  function getLiveSubtitleContext(value, path, inheritedContext = '') {
    return [
      inheritedContext,
      ...path,
      value?.type,
      value?.kind,
      value?.event,
      value?.eventType,
      value?.name,
      value?.action,
    ].join(' ');
  }

  function hasLiveSubtitleContext(value, path, inheritedContext = '') {
    const context = getLiveSubtitleContext(value, path, inheritedContext);
    return /subtitle|caption|timedtext|closedcaption|texttrack|\bcc\b/i.test(context);
  }

  function normalizeLiveSubtitleText(text) {
    return String(text ?? '')
      .replace(/\\n/g, ' ')
      .replace(/[♪♫]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function shouldInspectSubtitleCandidate({ url, contentType }) {
    const value = `${url ?? ''} ${contentType ?? ''}`.toLowerCase();
    return /(subtitle|subtitles|caption|captions|timedtext|webvtt|vtt|srt|ttml|dfxp|lrc|bcc|ass|ssa|text\/vtt|application\/ttml|application\/xml|\+xml)/.test(value) ||
      /(?:^|[/?#&._=-])(?:cue|cues|texttrack|texttracks|closedcaption|closedcaptions|cc)(?:$|[/?#&._=-])/.test(value);
  }

  function isLikelySubtitleResource({ url, contentType, text }) {
    if (!String(text ?? '').trim()) return false;
    if (shouldInspectSubtitleCandidate({ url, contentType })) return true;

    return /^(WEBVTT|\uFEFFWEBVTT)/i.test(text.trimStart()) ||
      isLikelySubtitleJsonText(text) ||
      /^<\?xml\b[\s\S]*<(tt|transcript|timedtext|MPD)\b/i.test(text.trimStart()) ||
      /^<(tt|transcript|timedtext|MPD)\b/i.test(text.trimStart()) ||
      /^#EXTM3U/m.test(text) ||
      /^\s*(?:\d+\s*)?\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/m.test(text) ||
      /^\s*(?:\[Script Info\]|\[Events\]|Dialogue:)/im.test(text) ||
      /^\s*(?:\[[a-z]+:[^\]]*\]\s*)*\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/im.test(text);
  }

  function isJsonContentType(contentType) {
    return /(^|[;\s])application\/(?:[\w.+-]+\+)?json(?:[;\s]|$)/i.test(String(contentType ?? ''));
  }

  function isXmlContentType(contentType) {
    return /(^|[;\s])(?:application|text)\/(?:[\w.+-]+\+)?xml(?:[;\s]|$)/i.test(String(contentType ?? ''));
  }

  function isLikelySubtitleJsonText(text) {
    let payload;
    try {
      payload = JSON.parse(String(text ?? ''));
    } catch {
      return false;
    }

    const events = Array.isArray(payload?.events) ? payload.events : [];
    if (events.some((event) => {
      const segments = Array.isArray(event?.segs) ? event.segs : [];
      return Number.isFinite(Number(event?.tStartMs)) &&
        segments.some((segment) => typeof segment?.utf8 === 'string' && segment.utf8.trim());
    })) return true;

    if (hasGenericJsonCues(payload)) return true;
    return hasJsonSubtitleReferences(payload);
  }

  function hasGenericJsonCues(value, path = []) {
    if (!value || typeof value !== 'object') return false;

    if (Array.isArray(value)) {
      if ((path.length === 0 || /cue|caption|subtitle|timedtext|texttrack|body/i.test(path.at(-1) ?? '')) &&
        value.some(isLikelyGenericJsonCue)) {
        return true;
      }
      return value.some((item, index) => hasGenericJsonCues(item, path.concat(String(index))));
    }

    return Object.entries(value).some(([key, child]) => hasGenericJsonCues(child, path.concat(key)));
  }

  function isLikelyGenericJsonCue(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

    const hasStart = hasCueTime(value, [
      'startTime',
      'start',
      'begin',
      'from',
      'startMs',
      'start_ms',
      'beginMs',
      'startTimeMs',
      'start_time_ms',
      'startOffsetMs',
      'start_offset_ms',
      't',
    ]);
    const hasEndOrDuration = hasCueTime(value, [
      'endTime',
      'end',
      'to',
      'endMs',
      'end_ms',
      'endTimeMs',
      'end_time_ms',
      'endOffsetMs',
      'end_offset_ms',
      'duration',
      'dur',
      'durationMs',
      'duration_ms',
      'durationMillis',
      'duration_millis',
      'd',
      'e',
    ]);
    return hasStart && hasEndOrDuration && hasGenericCueText(value);
  }

  function hasCueTime(value, keys) {
    return keys.some((key) => isCueTimeValue(value?.[key]));
  }

  function isCueTimeValue(value) {
    if (Number.isFinite(Number(value))) return true;
    if (typeof value !== 'string') return false;
    const text = value.trim();
    return /^\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?$/.test(text) ||
      /^\d+(?:\.\d+)?(?:h|m|s|ms|f|t)$/i.test(text);
  }

  function hasGenericCueText(value) {
    if (['text', 'caption', 'body', 'content', 'value', 'utf8'].some((key) => String(value?.[key] ?? '').trim())) {
      return true;
    }

    return ['lines', 'segments', 'segs', 'fragments', 'words', 'tokens'].some((key) => {
      const items = value?.[key];
      return Array.isArray(items) && items.some((item) => (
        typeof item === 'string' ? item.trim() : String(item?.text ?? item?.utf8 ?? item?.caption ?? item?.word ?? item?.value ?? '').trim()
      ));
    });
  }

  function hasJsonSubtitleReferences(value, path = []) {
    if (typeof value === 'string') {
      return isLikelyJsonSubtitleReference(value, path);
    }

    if (Array.isArray(value)) {
      return value.some((item, index) => hasJsonSubtitleReferences(item, path.concat(String(index))));
    }

    if (!value || typeof value !== 'object') return false;

    return Object.entries(value).some(([key, child]) => hasJsonSubtitleReferences(child, path.concat(key)));
  }

  function isLikelyJsonSubtitleReference(value, path) {
    const text = String(value ?? '').trim();
    if (!text) return false;
    if (/(?:timedtext|subtitle|subtitles|caption|captions)/i.test(text) && looksLikeUrlOrPath(text)) return true;
    if (!/subtitle|caption|timedtext|texttrack|ttdownloadable|downloadurl|downloadable/i.test(path.join(' '))) return false;

    return looksLikeUrlOrPath(text);
  }

  function looksLikeUrlOrPath(text) {
    return /^(https?:)?\/\//i.test(text) ||
      /^\//.test(text) ||
      isExtensionlessSubtitleEndpoint(text) ||
      /^[^<>{}\s]+\.(?:vtt|webvtt|srt|ttml|dfxp|xml|lrc|bcc|ass|ssa|m3u8|mpd)(?:[?#]|$)/i.test(text);
  }

  function isExtensionlessSubtitleEndpoint(url) {
    const text = String(url ?? '').toLowerCase();
    if (!/(?:^|[/?#&._=-])(?:timedtext|texttrack|texttracks|subtitle|subtitles|caption|captions|closedcaption|closedcaptions)(?:$|[/?#&._=-])/.test(text)) {
      return false;
    }

    return !/[./](?:css|js|mjs|png|jpe?g|gif|webp|svg|mp4|m4v|m4s|mov|ts)(?:[?#]|$)/.test(text);
  }

  function readHeader(headers, name) {
    try {
      return String(headers?.get?.(name) ?? '');
    } catch {
      return '';
    }
  }

  function resolveRequestUrl(input) {
    const rawUrl = typeof input === 'string' ? input : input?.url ? String(input.url) : '';
    if (!rawUrl) return '';

    try {
      return new URL(rawUrl, window.location?.href || globalThis.location?.href).href;
    } catch {
      return rawUrl;
    }
  }
})();
