(() => {
  if (window.__realtimeVideoTranscriberLoaded) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'PING_TRANSCRIBER_OVERLAY') {
        sendResponse({ ok: true });
      }
    });
    return;
  }

  window.__realtimeVideoTranscriberLoaded = true;

  const state = {
    enabled: true,
    segments: [],
    learningHistory: [],
    knownLearningKeys: new Set(),
    status: 'idle',
    detail: '正在监听网页字幕',
    position: readStoredOverlayPosition(),
    extractionIntensity: 50,
  };

  const root = document.createElement('aside');
  root.id = 'rvt-overlay';
  root.className = `rvt-learning-bar rvt-position-${state.position}`;
  root.hidden = true;
  root.innerHTML = `
    <div class="rvt-header">
      <div>
        <div class="rvt-title">实时学习项</div>
        <div class="rvt-status">就绪</div>
      </div>
      <div class="rvt-header-actions">
        <span class="rvt-history-count">0 行</span>
        <button class="rvt-position" type="button" title="移动学习栏">↕</button>
      </div>
      <button class="rvt-collapse" type="button" title="折叠字幕">−</button>
    </div>
    <div class="rvt-current">
      <div class="rvt-learning-history" aria-label="最近学习项"></div>
      <div class="rvt-current-text" aria-live="polite"></div>
    </div>
  `;
  const statusNode = root.querySelector('.rvt-status');
  const currentTextNode = root.querySelector('.rvt-current-text');
  const learningHistoryNode = root.querySelector('.rvt-learning-history');
  const historyCountNode = root.querySelector('.rvt-history-count');
  const collapseButton = root.querySelector('.rvt-collapse');
  const positionButton = root.querySelector('.rvt-position');
  let siteSubtitleTools = null;
  let overlayMountTools = null;
  let segmentTools = null;
  let transcriptExportTools = null;
  let learningAnalysisTools = null;
  let subtitleDedupTools = null;
  let lastSiteSubtitleText = '';
  let lastSiteSubtitleId = '';
  let lastSiteSubtitleStartedAt = Number.NaN;
  let lastSiteSubtitleUpdatedAt = Number.NaN;
  const trackCueCache = new Map();
  const pageSubtitleResources = new Map();
  const pendingPageSubtitleMessages = [];
  const scannedInlineSubtitleScripts = new WeakSet();
  const autoAnalysisRequests = new Set();
  const analysisCache = new Map();
  const REMOTE_ANALYSIS_FAILURE_COOLDOWN_MS = 15_000;
  let remoteAnalysisUnavailableUntil = 0;

  mountOverlay();
  document.addEventListener('fullscreenchange', mountOverlay);
  document.addEventListener('webkitfullscreenchange', mountOverlay);
  window.addEventListener('message', handlePageSubtitleMessage);
  window.__rvtGetTranscriptSnapshot = getTranscriptSnapshot;
  window.__rvtGetDiagnosticsSnapshot = getDiagnosticsSnapshot;
  window.__rvtGetLearningHistorySnapshot = getLearningHistorySnapshot;
  window.__rvtClearTranscript = clearTranscriptState;

  collapseButton.addEventListener('click', () => {
    root.classList.toggle('rvt-collapsed');
    collapseButton.textContent = root.classList.contains('rvt-collapsed') ? '+' : '−';
  });
  positionButton.addEventListener('click', toggleOverlayPosition);
  root.querySelector('.rvt-header')?.addEventListener('pointerdown', startOverlayDrag);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PING_TRANSCRIBER_OVERLAY') {
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === 'CAPTURE_STATUS') {
      if (!state.enabled) return false;
      if (message.status === 'error' && state.status === 'site-subtitles' && state.segments.length > 0) {
        return false;
      }
      state.status = message.status ?? 'idle';
      state.detail = message.detail ?? '';
      render();
      return false;
    }

    if (message?.type === 'TRANSCRIPT_SEGMENT' && message.segment) {
      if (!state.enabled) return false;
      mergeSegment(message.segment);
      applyInstantLearningAnalysis(getCurrentSegment());
      render();
      triggerAutoAnalyzeSegment(getCurrentSegment());
      return false;
    }

    if (message?.type === 'GET_TRANSCRIPT') {
      sendResponse(getTranscriptSnapshot());
      return true;
    }

    if (message?.type === 'CLEAR_TRANSCRIPT') {
      sendResponse(clearTranscriptState());
      return true;
    }

    if (message?.type === 'GET_DIAGNOSTICS') {
      getDiagnosticsSnapshot()
        .then((diagnostics) => sendResponse(diagnostics));
      return true;
    }

    if (message?.type === 'REFRESH_ENABLED_SETTING') {
      refreshEnabledSetting()
        .then((enabled) => {
          if (enabled) captureRenderedSubtitles();
          sendResponse({ ok: true, enabled });
        });
      return true;
    }

    if (message?.type === 'ANALYZE_CURRENT_LINE') {
      analyzeCurrentLine(message.settings)
        .then((result) => sendResponse(result));
      return true;
    }

    if (message?.type === 'GET_CURRENT_LEARNING') {
      sendResponse(getCurrentLearningSnapshot());
      return true;
    }

    if (message?.type === 'GET_LEARNING_HISTORY') {
      sendResponse(getLearningHistorySnapshot());
      return true;
    }

    if (message?.type === 'REFRESH_KNOWN_LEARNING') {
      refreshKnownLearningExpressions()
        .then(() => {
          pruneKnownLearningHighlights();
          render();
          sendResponse({ ok: true, knownCount: state.knownLearningKeys.size });
        });
      return true;
    }

    if (message?.type === 'REFRESH_EXTRACTION_INTENSITY') {
      refreshExtractionIntensity(message.settings)
        .then((result) => sendResponse(result));
      return true;
    }

    return false;
  });

  const importModule = globalThis.__rvtImport || ((url) => import(url));

  Promise.all([
    importModule(chrome.runtime.getURL('src/content/siteSubtitles.js')),
    importModule(chrome.runtime.getURL('src/content/overlayMount.js')),
    importModule(chrome.runtime.getURL('src/shared/segments.js')),
    importModule(chrome.runtime.getURL('src/shared/transcriptExport.js')),
    importModule(chrome.runtime.getURL('src/shared/learningAnalysis.js')),
    importModule(chrome.runtime.getURL('src/shared/subtitleDedup.js')),
  ])
    .then(async ([subtitleModule, overlayMountModule, segmentModule, exportModule, learningModule, dedupModule]) => {
      siteSubtitleTools = subtitleModule;
      overlayMountTools = overlayMountModule;
      segmentTools = segmentModule;
      transcriptExportTools = exportModule;
      learningAnalysisTools = learningModule;
      subtitleDedupTools = dedupModule;
      await refreshEnabledSetting();
      await refreshStoredExtractionIntensity();
      watchEnabledSetting();
      await refreshKnownLearningExpressions();
      mountOverlay();
      startSiteSubtitleCapture();
      flushPageSubtitleMessages();
    })
    .catch(() => {
      state.status = 'idle';
      state.detail = '已准备好实时捕获';
    });

  function startSiteSubtitleCapture() {
    const observer = new MutationObserver(() => captureRenderedSubtitles());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    window.setInterval(() => {
      if (!state.enabled) return;
      captureRenderedSubtitles();
      captureTextTrackSubtitles();
      captureTrackFileSubtitles();
      captureSubtitleLinkResources();
      captureSubtitleAttributeResources();
      capturePerformanceSubtitleResources();
      captureInlineSubtitleResources();
      capturePageSubtitleResources();
    }, 500);

    captureRenderedSubtitles();
    captureTextTrackSubtitles();
    captureTrackFileSubtitles();
    captureSubtitleLinkResources();
    captureSubtitleAttributeResources();
    capturePerformanceSubtitleResources();
    captureInlineSubtitleResources();
    capturePageSubtitleResources();
  }

  function getTranscriptSnapshot() {
    const segments = state.segments.slice();
    return {
      ok: true,
      segments,
      text: transcriptExportTools?.formatTranscriptAsText(segments) ?? '',
      srt: transcriptExportTools?.formatTranscriptAsSrt(segments) ?? '',
    };
  }

  async function getDiagnosticsSnapshot() {
    return {
      ok: true,
      ...(await collectDiagnostics()),
    };
  }

  function clearTranscriptState() {
    state.segments = segmentTools?.clearTranscriptHistory(state.segments) ?? [];
    state.learningHistory = [];
    lastSiteSubtitleText = '';
    lastSiteSubtitleId = '';
    lastSiteSubtitleStartedAt = Number.NaN;
    lastSiteSubtitleUpdatedAt = Number.NaN;
    state.status = 'idle';
    state.detail = '字幕记录已清空，正在监听网页字幕。';
    render();
    return { ok: true };
  }

  function captureRenderedSubtitles() {
    if (!state.enabled) return;
    if (!siteSubtitleTools) return;

    const selector = siteSubtitleTools.SUBTITLE_SELECTORS.join(',');
    const nodes = siteSubtitleTools.collectSubtitleNodes?.(document, selector) ?? document.querySelectorAll(selector);
    const text = siteSubtitleTools.selectYouTubePlayerSubtitleText?.(document, location.href) ||
      siteSubtitleTools.selectSubtitleText(nodes) ||
      '';
    applySiteSubtitleText(text);
  }

  function captureTextTrackSubtitles() {
    if (!state.enabled) return;
    if (!siteSubtitleTools) return;

    const videos = siteSubtitleTools.collectVideoElements?.(document) ?? document.querySelectorAll('video');
    for (const video of videos) {
      const text = siteSubtitleTools.readActiveCueText(video);
      if (applySiteSubtitleText(text)) break;
    }
  }

  function captureTrackFileSubtitles() {
    if (!state.enabled) return;
    if (!siteSubtitleTools) return;

    const tracks = siteSubtitleTools.collectSubtitleTrackElements?.(document) ?? [];
    for (const track of tracks) {
      captureTrackFileSubtitle(track);
    }
  }

  function capturePerformanceSubtitleResources() {
    if (!state.enabled) return;
    if (!siteSubtitleTools) return;

    const video = getPrimaryVideo();
    const currentTime = Number(video?.currentTime);
    if (!Number.isFinite(currentTime)) return;

    const urls = siteSubtitleTools.collectSubtitleResourceUrls?.(performance) ?? [];
    for (const url of urls) {
      captureSubtitleResourceAtTime(normalizeSubtitleResourceUrl(url), currentTime);
    }
  }

  function captureSubtitleLinkResources() {
    if (!state.enabled) return;
    if (!siteSubtitleTools) return;

    const video = getPrimaryVideo();
    const currentTime = Number(video?.currentTime);
    if (!Number.isFinite(currentTime)) return;

    const links = siteSubtitleTools.collectSubtitleLinkElements?.(document) ?? [];
    for (const link of links) {
      const sourceUrl = resolveElementResourceUrl(link, 'href');
      if (sourceUrl) captureSubtitleResourceAtTime(sourceUrl, currentTime);
    }
  }

  function captureSubtitleAttributeResources() {
    if (!state.enabled) return;
    if (!siteSubtitleTools) return;

    const video = getPrimaryVideo();
    const currentTime = Number(video?.currentTime);
    if (!Number.isFinite(currentTime)) return;

    const urls = siteSubtitleTools.collectSubtitleAttributeResourceUrls?.(document, location.href) ?? [];
    for (const url of urls) {
      captureSubtitleResourceAtTime(url, currentTime);
    }
  }

  function capturePageSubtitleResources() {
    if (!state.enabled) return;
    if (!siteSubtitleTools) return;

    const currentTime = Number(getPrimaryVideo()?.currentTime);
    if (!Number.isFinite(currentTime)) return;

    for (const url of pageSubtitleResources.keys()) {
      const cached = trackCueCache.get(url);
      if (cached?.cues) {
        applySubtitleCuesAtTime(cached.cues, currentTime);
      }
    }
  }

  async function captureInlineSubtitleResources() {
    if (!state.enabled) return;
    if (!siteSubtitleTools) return;

    const video = getPrimaryVideo();
    const currentTime = Number(video?.currentTime);
    if (!Number.isFinite(currentTime)) return;

    for (const script of Array.from(document.querySelectorAll('script'))) {
      if (scannedInlineSubtitleScripts.has(script)) continue;
      scannedInlineSubtitleScripts.add(script);

      const text = String(script?.textContent ?? '');
      if (!isLikelyInlineSubtitleManifest(text)) continue;

      const references = siteSubtitleTools.parseSubtitleResourceReferences?.(text, location.href) ?? [];
      if (references.length === 0) continue;

      const cues = (await Promise.all(references.map((referenceUrl) => loadTrackCues(referenceUrl)))).flat();
      if (cues.length > 0) {
        const resourceKey = `inline-script:${references.join('|')}`;
        pageSubtitleResources.set(resourceKey, {
          contentType: 'inline-player-json',
          length: text.length,
          cueCount: cues.length,
          cueSamples: getCueSamples(cues),
          updatedAt: Date.now(),
        });
        trackCueCache.set(resourceKey, { cues });
        applySubtitleCuesAtTime(cues, currentTime);
      }
    }
  }

  function isLikelyInlineSubtitleManifest(text) {
    const value = String(text ?? '');
    if (!/subtitle|subtitles|caption|captions|timedtext|ttdownloadables|downloadurls/i.test(value)) return false;
    return /(?:^|[^\w])(?:\{|\[)/.test(value);
  }

  async function captureTrackFileSubtitle(track) {
    const sourceUrl = resolveTrackSourceUrl(track);
    if (!sourceUrl) return;

    const video = findTrackVideo(track);
    const currentTime = Number(video?.currentTime);
    if (!Number.isFinite(currentTime)) return;

    await captureSubtitleResourceAtTime(sourceUrl, currentTime);
  }

  async function captureSubtitleResourceAtTime(sourceUrl, currentTime) {
    const cues = await loadTrackCues(sourceUrl);
    applySubtitleCuesAtTime(cues, currentTime);
  }

  async function loadTrackCues(sourceUrl, depth = 0) {
    const normalizedSourceUrl = normalizeSubtitleResourceUrl(sourceUrl);
    const cached = trackCueCache.get(normalizedSourceUrl);
    if (cached?.cues) return cached.cues;
    if (cached?.promise) return cached.promise;
    if (depth > 4) return [];

    const promise = fetchSubtitleTrackText(normalizedSourceUrl)
      .then(async (resource) => {
        const text = String(resource?.text ?? '');
        const cues = siteSubtitleTools.parseSubtitleTrackCues?.(text) ?? siteSubtitleTools.parseWebVttCues(text);
        if (cues.length > 0) {
          recordFetchedSubtitleResource(normalizedSourceUrl, resource, cues);
          return cues;
        }

        const references = siteSubtitleTools.parseSubtitleResourceReferences?.(text, normalizedSourceUrl) ?? [];
        const nestedCues = await Promise.all(
          references.map((referenceUrl) => loadTrackCues(referenceUrl, depth + 1)),
        );
        return nestedCues.flat();
      })
      .catch(() => [])
      .then((cues) => {
        trackCueCache.set(normalizedSourceUrl, { cues });
        return cues;
      });

    trackCueCache.set(normalizedSourceUrl, { promise });
    return promise;
  }

  async function fetchSubtitleTrackText(sourceUrl) {
    const dataUrlResource = decodeDataSubtitleTrack(sourceUrl);
    if (dataUrlResource) return dataUrlResource;

    if (String(sourceUrl ?? '').startsWith('blob:')) {
      return fetchSubtitleTrackTextFromPage(sourceUrl);
    }

    const backgroundResponse = await sendBackgroundMessage({
      target: 'background',
      type: 'FETCH_SUBTITLE_TRACK',
      url: sourceUrl,
    });

    if (backgroundResponse?.ok && typeof backgroundResponse.text === 'string') {
      return {
        ...backgroundResponse,
        source: 'background-fetch',
      };
    }

    if (backgroundResponse && backgroundResponse.ok === false) {
      recordFailedSubtitleResource(sourceUrl, {
        ...backgroundResponse,
        source: 'background-fetch',
      });
    }

    if (typeof fetch !== 'function') {
      throw new Error(backgroundResponse?.error || `无法加载字幕轨道：${sourceUrl}`);
    }

    return fetchSubtitleTrackTextFromPage(sourceUrl);
  }

  async function fetchSubtitleTrackTextFromPage(sourceUrl) {
    if (typeof fetch !== 'function') {
      throw new Error(`无法加载字幕轨道：${sourceUrl}`);
    }

    const response = await fetch(sourceUrl);
    if (!response?.ok) throw new Error(`字幕轨道加载失败：${sourceUrl}`);
    const text = await response.text();
    return {
      text,
      finalUrl: response?.url ?? sourceUrl,
      status: Number(response?.status) || 200,
      contentType: readHeader(response?.headers, 'content-type'),
      length: text.length,
      source: 'content-fetch',
    };
  }

  function decodeDataSubtitleTrack(sourceUrl) {
    if (!String(sourceUrl ?? '').startsWith('data:')) return null;

    const match = String(sourceUrl).match(/^data:([^,]*),(.*)$/s);
    if (!match) return null;

    const metadata = match[1] ?? '';
    const payload = match[2] ?? '';
    const contentType = metadata.split(';')[0] || 'text/plain';
    const isBase64 = /(?:^|;)base64(?:;|$)/i.test(metadata);
    let text = '';

    try {
      text = isBase64 && typeof atob === 'function'
        ? decodeBase64Text(payload)
        : decodeURIComponent(payload.replace(/\+/g, '%20'));
    } catch {
      return null;
    }

    return {
      text,
      finalUrl: sourceUrl,
      status: 200,
      contentType,
      length: text.length,
      source: 'data-url-track',
    };
  }

  function decodeBase64Text(payload) {
    const binary = atob(payload);
    if (typeof TextDecoder !== 'function') return binary;

    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder('utf-8').decode(bytes);
  }

  function recordFetchedSubtitleResource(sourceUrl, resource, cues) {
    pageSubtitleResources.set(sourceUrl, {
      contentType: String(resource?.contentType ?? ''),
      length: Number(resource?.length) || String(resource?.text ?? '').length,
      cueCount: Array.from(cues ?? []).length,
      cueSamples: getCueSamples(cues),
      finalUrl: String(resource?.finalUrl ?? sourceUrl),
      status: Number(resource?.status) || 0,
      source: String(resource?.source ?? 'subtitle-fetch'),
      updatedAt: Date.now(),
    });
  }

  function recordFailedSubtitleResource(sourceUrl, resource) {
    pageSubtitleResources.set(sourceUrl, {
      contentType: String(resource?.contentType ?? ''),
      length: Number(resource?.length) || 0,
      cueCount: 0,
      cueSamples: [],
      finalUrl: String(resource?.finalUrl ?? sourceUrl),
      status: Number(resource?.status) || 0,
      source: String(resource?.source ?? 'subtitle-fetch'),
      error: String(resource?.error ?? 'Subtitle resource fetch failed.'),
      updatedAt: Date.now(),
    });
  }

  function readHeader(headers, name) {
    if (typeof headers?.get === 'function') return String(headers.get(name) ?? '');
    if (headers && typeof headers === 'object') {
      return String(headers[name] ?? headers[String(name).toLowerCase()] ?? '');
    }
    return '';
  }

  function sendBackgroundMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => resolve(response));
      } catch (error) {
        resolve({ ok: false, error: error.message });
      }
    });
  }

  function resolveTrackSourceUrl(track) {
    return resolveElementResourceUrl(track, 'src');
  }

  function resolveElementResourceUrl(element, attributeName) {
    const source = element?.[attributeName] || element?.getAttribute?.(attributeName);
    if (!source) return '';

    try {
      return normalizeSubtitleResourceUrl(new URL(source, document.baseURI || location.href).href);
    } catch {
      return String(source);
    }
  }

  function normalizeSubtitleResourceUrl(sourceUrl) {
    const rawUrl = String(sourceUrl ?? '').trim();
    if (!rawUrl) return '';

    try {
      const parsed = new URL(rawUrl, location.href);
      const pageUrl = new URL(location.href);
      if (
        pageUrl.protocol === 'https:' &&
        parsed.protocol === 'http:' &&
        parsed.host === pageUrl.host
      ) {
        parsed.protocol = 'https:';
      }
      return parsed.href;
    } catch {
      return rawUrl;
    }
  }

  function findTrackVideo(track) {
    const closestVideo = track?.closest?.('video');
    if (closestVideo) return closestVideo;

    let node = track?.parentElement ?? track?.parentNode;
    while (node) {
      if (String(node.tagName ?? '').toLowerCase() === 'video') return node;
      node = node.parentElement ?? node.parentNode;
    }

    return null;
  }

  function getPrimaryVideo() {
    const videos = siteSubtitleTools.collectVideoElements?.(document) ?? document.querySelectorAll('video');
    return Array.from(videos)[0] ?? null;
  }

  async function collectDiagnostics() {
    const videos = Array.from(siteSubtitleTools?.collectVideoElements?.(document) ?? document.querySelectorAll('video'));
    const domSubtitleResources = collectDomSubtitleResources();
    return {
      url: location.href,
      status: state.status,
      detail: state.detail,
      transcriptCount: state.segments.length,
      captureState: await readCaptureState(),
      subtitleResources: siteSubtitleTools?.collectSubtitleResourceUrls?.(performance) ?? [],
      domSubtitleResources,
      pageSubtitleResources: Array.from(pageSubtitleResources.entries()).map(([url, resource]) => ({
        url,
        contentType: resource.contentType,
        length: resource.length,
        cueCount: resource.cueCount,
        cueSamples: resource.cueSamples ?? [],
        finalUrl: resource.finalUrl,
        status: resource.status,
        source: resource.source,
        error: resource.error,
      })),
      renderedSubtitles: collectRenderedSubtitleDiagnostics(),
      videos: videos.map((video) => ({
        currentTime: Number(video?.currentTime) || 0,
        textTrackCount: Array.from(video?.textTracks ?? []).length,
        textTracks: Array.from(video?.textTracks ?? []).map((track) => ({
          kind: String(track?.kind ?? ''),
          mode: String(track?.mode ?? ''),
          activeCueCount: Array.from(track?.activeCues ?? []).length,
          cueSamples: collectActiveCueSamples(track),
        })),
      })),
    };
  }

  function collectDomSubtitleResources() {
    if (!siteSubtitleTools) return [];

    const linkUrls = Array.from(siteSubtitleTools.collectSubtitleLinkElements?.(document) ?? [])
      .map((link) => resolveElementResourceUrl(link, 'href'))
      .filter(Boolean);
    const attributeUrls = siteSubtitleTools.collectSubtitleAttributeResourceUrls?.(document, location.href) ?? [];
    return Array.from(new Set(linkUrls.concat(attributeUrls).map(normalizeSubtitleResourceUrl)));
  }

  function collectActiveCueSamples(track) {
    return Array.from(track?.activeCues ?? [])
      .map((cue) => {
        const text = cue?.text ?? cue?.getCueAsHTML?.()?.textContent ?? '';
        return siteSubtitleTools?.normalizeSubtitleText?.(text) ?? String(text).trim();
      })
      .filter(Boolean)
      .filter((text, index, texts) => texts.indexOf(text) === index)
      .slice(0, 3);
  }

  async function readCaptureState() {
    const response = await sendBackgroundMessage({
      target: 'background',
      type: 'GET_CAPTURE_STATE',
    });

    return response?.ok
      ? response
      : {
          ok: false,
          error: response?.error || '无法读取捕获状态。',
        };
  }

  function collectRenderedSubtitleDiagnostics() {
    if (!siteSubtitleTools) return { count: 0, samples: [] };

    const selector = siteSubtitleTools.SUBTITLE_SELECTORS.join(',');
    const nodes = siteSubtitleTools.collectSubtitleNodes?.(document, selector) ?? document.querySelectorAll(selector);
    const isYouTubePage = isCurrentYouTubePage();
    const visibleNodes = Array.from(nodes).filter((node) => isRenderedSubtitleDiagnosticNode(node, isYouTubePage));
    const fallbackSamples = Array.from(siteSubtitleTools.collectYouTubePlayerSubtitleNodes?.(document, location.href) ?? [])
      .map((node) => ({
        source: 'youtube-player-text-caption',
        text: siteSubtitleTools.normalizeSubtitleText?.(node?.textContent) ?? String(node?.textContent ?? '').trim(),
      }))
      .filter((sample) => sample.text);

    return {
      count: visibleNodes.length + fallbackSamples.length,
      samples: visibleNodes
        .map((node) => ({
          source: siteSubtitleTools.getSubtitleSource?.(node) ?? 'rendered-subtitle',
          text: siteSubtitleTools.normalizeSubtitleText?.(node?.textContent) ?? String(node?.textContent ?? '').trim(),
        }))
        .filter((sample) => sample.text)
        .concat(fallbackSamples)
        .slice(0, 5),
    };
  }

  function isRenderedSubtitleDiagnosticNode(node, isYouTubePage) {
    if (typeof node?.getClientRects === 'function' && !Array.from(node.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0)) {
      return false;
    }

    const text = siteSubtitleTools.normalizeSubtitleText?.(node?.textContent) ?? String(node?.textContent ?? '').trim();
    if (!text || siteSubtitleTools.isLikelySubtitleUiText?.(text)) return false;

    if (!isYouTubePage) return true;

    const source = siteSubtitleTools.getSubtitleSource?.(node) ?? 'rendered-subtitle';
    return source === 'youtube-rendered-caption' && isInsideYouTubePlayer(node);
  }

  function isCurrentYouTubePage() {
    try {
      const hostname = String(location?.hostname || new URL(String(location?.href ?? '')).hostname);
      return /(^|\.)youtube\.com$/i.test(hostname) || /(^|\.)youtu\.be$/i.test(hostname);
    } catch {
      return false;
    }
  }

  function isInsideYouTubePlayer(node) {
    let current = node;
    while (current) {
      const className = String(current.className ?? '');
      if (/(^|\s)html5-video-player(?:\s|$)/.test(className)) return true;
      current = current.parentElement ?? current.parentNode;
    }
    return false;
  }

  function applySiteSubtitleText(text, timestamp = getPlaybackTimestamp(), endTimestamp = timestamp) {
    if (!state.enabled) return false;
    if (!siteSubtitleTools) return false;

    const normalizedText = subtitleDedupTools?.compactRepeatedSubtitleText?.(text) ?? siteSubtitleTools.normalizeSubtitleText(text);
    const normalizedTimestamp = Math.max(0, Number(timestamp) || 0);
    const normalizedEndTimestamp = Math.max(Number(endTimestamp) || normalizedTimestamp, normalizedTimestamp);
    if (
      !normalizedText ||
      siteSubtitleTools.isLikelySubtitleUiText?.(normalizedText) ||
      isDuplicateSiteSubtitle(normalizedText, normalizedTimestamp, normalizedEndTimestamp)
    ) {
      return false;
    }

    const shouldReusePrevious = normalizedText !== lastSiteSubtitleText;
    const segment = siteSubtitleTools.buildSubtitleSegment(
      normalizedText,
      normalizedTimestamp,
      shouldReusePrevious ? { text: lastSiteSubtitleText, id: lastSiteSubtitleId } : { text: '', id: '' },
    );
    if (!segment) return false;
    segment.updatedAt = normalizedEndTimestamp;

    lastSiteSubtitleText = normalizedText;
    lastSiteSubtitleId = segment.id;
    lastSiteSubtitleStartedAt = segment.startedAt;
    lastSiteSubtitleUpdatedAt = segment.updatedAt;
    mergeSegment(segment);
    applyInstantLearningAnalysis(getCurrentSegment());
    state.status = 'site-subtitles';
    state.detail = '正在使用页面已渲染的字幕';
    notifySiteSubtitlesAvailable();
    render();
    triggerAutoAnalyzeSegment(getCurrentSegment());
    return true;
  }

  function notifySiteSubtitlesAvailable() {
    try {
      chrome.runtime.sendMessage({
        target: 'background',
        type: 'SITE_SUBTITLES_AVAILABLE',
      }, () => {});
    } catch {
      // The background worker may be unavailable on restricted pages; transcript capture can continue.
    }
  }

  function isDuplicateSiteSubtitle(text, startedAt, updatedAt) {
    if (text !== lastSiteSubtitleText) return false;
    if (startedAt === lastSiteSubtitleStartedAt && updatedAt === lastSiteSubtitleUpdatedAt) return true;

    // Rendered DOM subtitles do not expose cue duration; while the same text stays on screen
    // polling will see advancing video time, so keep treating it as the same line.
    return lastSiteSubtitleStartedAt === lastSiteSubtitleUpdatedAt && startedAt === updatedAt;
  }

  async function handlePageSubtitleMessage(event) {
    if (event.source !== window) return;

    const data = event.data;
    if (data?.source !== 'rvt-page-subtitle-interceptor' || !['SUBTITLE_RESOURCE', 'SUBTITLE_TEXT'].includes(data.type)) {
      return;
    }
    if (!siteSubtitleTools) {
      pendingPageSubtitleMessages.push(data);
      if (pendingPageSubtitleMessages.length > 25) {
        pendingPageSubtitleMessages.shift();
      }
      return;
    }

    await capturePageSubtitleMessage(data);
  }

  async function flushPageSubtitleMessages() {
    while (pendingPageSubtitleMessages.length > 0) {
      await capturePageSubtitleMessage(pendingPageSubtitleMessages.shift());
    }
  }

  async function capturePageSubtitleMessage(data) {
    if (data?.type === 'SUBTITLE_TEXT') {
      capturePageSubtitleText(data);
      return;
    }

    await capturePageSubtitleResource(data);
  }

  function capturePageSubtitleText(data) {
    const text = siteSubtitleTools.normalizeSubtitleText?.(data?.text) ?? String(data?.text ?? '').trim();
    if (!text) return;

    const url = normalizeSubtitleResourceUrl(data.url ?? `page-subtitle-text-${Date.now()}`);
    pageSubtitleResources.set(url, {
      contentType: String(data.contentType ?? ''),
      length: text.length,
      cueCount: 1,
      cueSamples: [text.slice(0, 160)],
      updatedAt: Date.now(),
    });
    applySiteSubtitleText(text);
  }

  async function capturePageSubtitleResource(data) {
    const url = normalizeSubtitleResourceUrl(data.url ?? `page-subtitle-${Date.now()}`);
    const text = String(data.text ?? '');
    const cues = siteSubtitleTools.parseSubtitleTrackCues?.(text) ?? siteSubtitleTools.parseWebVttCues(text);
    pageSubtitleResources.set(url, {
      contentType: String(data.contentType ?? ''),
      length: text.length,
      cueCount: cues.length,
      cueSamples: getCueSamples(cues),
      updatedAt: Date.now(),
    });

    if (cues.length > 0) {
      trackCueCache.set(url, { cues });
      applySubtitleCuesAtCurrentTime(cues);
      return;
    }

    const references = siteSubtitleTools.parseSubtitleResourceReferences?.(text, url) ?? [];
    const referencedCues = (await Promise.all(references.map((referenceUrl) => loadTrackCues(referenceUrl)))).flat();
    if (referencedCues.length > 0) {
      const resource = pageSubtitleResources.get(url);
      if (resource) {
        resource.cueCount = referencedCues.length;
        resource.cueSamples = getCueSamples(referencedCues);
      }
      trackCueCache.set(url, { cues: referencedCues });
      applySubtitleCuesAtCurrentTime(referencedCues);
    }
  }

  function getCueSamples(cues) {
    const samples = [];
    for (const cue of Array.from(cues ?? [])) {
      const text = siteSubtitleTools.normalizeSubtitleText?.(cue?.text) ?? String(cue?.text ?? '').trim();
      if (!text || samples.includes(text)) continue;
      samples.push(text.slice(0, 160));
      if (samples.length >= 3) break;
    }
    return samples;
  }

  function applySubtitleCuesAtCurrentTime(cues) {
    const currentTime = Number(getPrimaryVideo()?.currentTime);
    if (!Number.isFinite(currentTime)) return false;
    return applySubtitleCuesAtTime(cues, currentTime);
  }

  function applySubtitleCuesAtTime(cues, currentTime) {
    const activeCues = getActiveSubtitleCues(cues, currentTime);
    if (activeCues.length === 0) return false;
    const text = siteSubtitleTools.normalizeSubtitleText(activeCues.map((cue) => cue.text).join(' '));
    const segmentStart = Math.min(...activeCues.map((cue) => Number(cue.startTime)));
    const segmentEnd = Math.max(...activeCues.map((cue) => Number(cue.endTime)));
    return applySiteSubtitleText(text, secondsToMilliseconds(segmentStart), secondsToMilliseconds(segmentEnd));
  }

  function getPlaybackTimestamp() {
    const currentTime = Number(getPrimaryVideo()?.currentTime);
    if (Number.isFinite(currentTime)) return secondsToMilliseconds(currentTime);
    return Date.now();
  }

  function getActiveSubtitleCues(cues, currentTime) {
    return Array.from(cues ?? []).filter((cue) => {
      const startTime = Number(cue?.startTime);
      const endTime = Number(cue?.endTime);
      return Number(currentTime) >= startTime && Number(currentTime) <= endTime;
    });
  }

  function secondsToMilliseconds(seconds) {
    return Math.max(0, Math.round(Number(seconds) * 1000));
  }

  function mergeSegment(segment) {
    const normalizedSegment = {
      ...segment,
      text: subtitleDedupTools?.compactRepeatedSubtitleText?.(segment.text) ?? String(segment.text ?? '').trim(),
    };

    if (segmentTools) {
      const mergedSegments = segmentTools.mergeTranscriptSegment(state.segments, normalizedSegment);
      state.segments = subtitleDedupTools?.mergeDedupedSegments
        ? subtitleDedupTools.mergeDedupedSegments(mergedSegments)
        : segmentTools.trimTranscriptHistory(mergedSegments, Infinity);
      return;
    }

    const text = String(normalizedSegment.text ?? '').trim();
    if (!text) return;

    state.segments.push({
      id: String(normalizedSegment.id ?? `seg-${Date.now()}`),
      text,
      translatedText: String(normalizedSegment.translatedText ?? '').trim(),
      isFinal: normalizedSegment.isFinal !== false,
      startedAt: Number(normalizedSegment.startedAt) || Date.now(),
      updatedAt: Number(normalizedSegment.updatedAt) || Date.now(),
    });
  }

  function render() {
    mountOverlay();
    if (!state.enabled) {
      root.hidden = true;
      return;
    }
    root.hidden = state.segments.length === 0 && state.status === 'idle';
    root.dataset.status = state.status;
    root.className = `rvt-learning-bar rvt-position-${state.position}${root.classList.contains('rvt-collapsed') ? ' rvt-collapsed' : ''}`;
    statusNode.textContent = state.detail || state.status;
    historyCountNode.textContent = `${state.segments.length} 行`;
    renderLearningHistory();
    renderCurrentSegment(getCurrentSegment());
  }

  function getVisibleSegments() {
    if (segmentTools) {
      return segmentTools.getVisibleTranscriptSegments(state.segments, 30);
    }

    return state.segments.slice(-30);
  }

  async function analyzeCurrentLine(settings = {}) {
    if (!state.enabled || settings?.enabled === false) return { ok: false, error: '插件已关闭。' };
    if (!learningAnalysisTools) return { ok: false, error: '学习项分析工具尚未就绪。' };

    const segment = getCurrentSegment();
    if (!segment) return { ok: false, error: '当前没有可分析的字幕。' };
    if (segment.analysis && segment.analysis?.pending !== true) return { ok: true, segment, analysis: segment.analysis };

    return analyzeSegment(segment, settings);
  }

  async function analyzeSegment(segment, settings = {}) {
    if (!state.enabled || settings?.enabled === false) return { ok: false, error: '插件已关闭。' };
    const endpoint = String(settings?.analysisEndpoint ?? 'http://localhost:8787/analyze').trim();
    if (!endpoint) return { ok: false, error: '尚未配置学习项分析接口。' };
    const silentFailure = settings?.silentFailure === true;
    const service = await ensureLocalServiceForEndpoint(endpoint);
    if (!service.ok && !silentFailure) {
      return handleLearningAnalysisFailure(service.error, { silent: false });
    }

    const payload = {
      text: segment.text,
      context: state.segments.slice(-4, -1).map((item) => item.text),
      level: String(settings?.englishLevel ?? 'B2').trim() || 'B2',
      intensity: normalizeIntensity(settings?.extractionIntensity ?? state.extractionIntensity),
      sourceUrl: location.href,
      pageTitle: String(document.title ?? ''),
    };
    if (settings?.includeProperNouns === true) payload.includeProperNouns = true;
    if (settings?.technicalMode === true) payload.technicalMode = true;
    if (settings?.includeUiTerms === true) payload.includeUiTerms = true;
    if (Number.isFinite(Number(settings?.minUsefulnessScore))) payload.minUsefulnessScore = Number(settings.minUsefulnessScore);
    const apiKey = String(settings?.openAiApiKey ?? '').trim();
    if (apiKey) payload.apiKey = apiKey;

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      return handleLearningAnalysisFailure(`学习项分析请求失败：${error.message}`, { silent: silentFailure });
    }

    if (!response?.ok) {
      const detail = await readLearningAnalysisError(response);
      return handleLearningAnalysisFailure(`学习项分析失败，HTTP ${response?.status ?? 0}${detail ? `：${detail}` : ''}。`, { silent: silentFailure });
    }

    let analysis;
    try {
      analysis = learningAnalysisTools.normalizeLearningAnalysis({
        ...(await response.json()),
        intensity: payload.intensity,
        level: payload.level,
        includeProperNouns: payload.includeProperNouns === true,
        technicalMode: payload.technicalMode === true,
        includeUiTerms: payload.includeUiTerms === true,
        minUsefulnessScore: payload.minUsefulnessScore,
      }, segment.text);
    } catch (error) {
      return handleLearningAnalysisFailure(`学习项分析响应不可用：${error.message}`, { silent: silentFailure });
    }
    remoteAnalysisUnavailableUntil = 0;
    await refreshKnownLearningExpressions();
    analysis = filterKnownLearningAnalysis(analysis);
    analysisCache.set(getAnalysisCacheKey(segment.text), analysis);
    updateSegmentAnalysis(segment.id, analysis);
    recordLearningHistory({ ...segment, analysis });
    render();
    return { ok: true, segment: getCurrentSegment(), analysis };
  }

  function applyInstantLearningAnalysis(segment) {
    if (!learningAnalysisTools || !segment || segment.analysis) return;
    const text = String(segment.text ?? '').trim();
    if (!/[A-Za-z]/.test(text) || siteSubtitleTools?.isLikelySubtitleUiText?.(text)) return;
    if (typeof learningAnalysisTools.analyzeSubtitleLearningItems !== 'function') return;

    const cachedAnalysis = analysisCache.get(getAnalysisCacheKey(text));
    if (cachedAnalysis) {
      const filteredCachedAnalysis = filterKnownLearningAnalysis(cachedAnalysis);
      if (Array.from(filteredCachedAnalysis.items ?? []).length > 0) {
        updateSegmentAnalysis(segment.id, filteredCachedAnalysis);
        recordLearningHistory({ ...segment, analysis: filteredCachedAnalysis });
      }
      return;
    }

    const analysis = learningAnalysisTools.analyzeSubtitleLearningItems({
      text,
      time: formatSegmentClock(segment.startedAt),
      source: {
        site: location.hostname,
        url: location.href,
      },
      userLevel: 'B2',
      includeProperNouns: false,
      technicalMode: false,
      includeUiTerms: false,
      intensity: state.extractionIntensity,
    });
    const filteredAnalysis = filterKnownLearningAnalysis(analysis);
    if (Array.from(filteredAnalysis.items ?? []).length === 0) return;

    analysisCache.set(getAnalysisCacheKey(text), {
      ...filteredAnalysis,
      pending: true,
    });
    updateSegmentAnalysis(segment.id, {
      ...filteredAnalysis,
      pending: true,
    });
    recordLearningHistory({ ...segment, analysis: filteredAnalysis });
  }

  function recordLearningAnalysisFailure(error) {
    state.status = 'warning';
    state.detail = String(error ?? '学习项分析失败。');
    render();
    return { ok: false, error: state.detail };
  }

  function handleLearningAnalysisFailure(error, { silent = false } = {}) {
    const message = String(error ?? '学习项分析失败。');
    if (silent) {
      remoteAnalysisUnavailableUntil = Date.now() + REMOTE_ANALYSIS_FAILURE_COOLDOWN_MS;
      return { ok: false, error: message, silent: true };
    }
    return recordLearningAnalysisFailure(message);
  }

  async function readLearningAnalysisError(response) {
    try {
      const payload = await response.json();
      return String(payload?.error ?? payload?.message ?? '').trim();
    } catch {
      try {
        return String(await response.text()).trim();
      } catch {
        return '';
      }
    }
  }

  function triggerAutoAnalyzeSegment(segment) {
    if (!shouldAutoAnalyzeSegment(segment)) return;

    const key = `${segment.id}:${segment.text}`;
    if (autoAnalysisRequests.has(key)) return;
    autoAnalysisRequests.add(key);

    readAutoAnalysisSettings()
      .then((settings) => analyzeSegment(segment, { ...settings, silentFailure: true }))
      .catch((error) => handleLearningAnalysisFailure(error.message, { silent: true }));
  }

  async function ensureLocalServiceForEndpoint(endpoint) {
    if (!isLocalEndpoint(endpoint)) return { ok: true, skipped: true };
    try {
      const response = await sendRuntimeMessage({
        target: 'background',
        type: 'ENSURE_NATIVE_SERVICE',
        endpoint,
      });
      return response?.ok
        ? response
        : { ok: false, error: response?.error ?? '无法启动本地服务。' };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        const result = chrome.runtime.sendMessage(message, resolve);
        if (result && typeof result.then === 'function') {
          result.then(resolve, reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  function isLocalEndpoint(endpoint) {
    try {
      const url = new URL(String(endpoint ?? ''));
      return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
    } catch {
      return false;
    }
  }

  function shouldAutoAnalyzeSegment(segment) {
    const text = String(segment?.text ?? '').trim();
    return (
      Boolean(learningAnalysisTools) &&
      state.enabled &&
      Date.now() >= remoteAnalysisUnavailableUntil &&
      Boolean(segment?.id) &&
      (!segment.analysis || segment.analysis?.pending === true) &&
      /[A-Za-z]/.test(text) &&
      !siteSubtitleTools?.isLikelySubtitleUiText?.(text) &&
      typeof fetch === 'function'
    );
  }

  async function readAutoAnalysisSettings() {
    const defaults = {
      analysisEndpoint: 'http://localhost:8787/analyze',
      enabled: true,
      englishLevel: 'B2',
      includeProperNouns: false,
      technicalMode: false,
      includeUiTerms: false,
      extractionIntensity: state.extractionIntensity,
      openAiApiKey: '',
    };

    const syncStorage = chrome?.storage?.sync;
    const localStorage = chrome?.storage?.local;
    if (typeof syncStorage?.get !== 'function') return defaults;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (syncSettings, localSettings = {}) => {
        if (settled) return;
        settled = true;
        resolve({ ...defaults, ...(syncSettings ?? {}), ...(localSettings ?? {}) });
      };

      try {
        const syncResult = syncStorage.get(defaults);
        const localResult = typeof localStorage?.get === 'function'
          ? localStorage.get({ openAiApiKey: '', extractionIntensity: state.extractionIntensity })
          : Promise.resolve({});
        if (syncResult && typeof syncResult.then === 'function') {
          Promise.all([syncResult, localResult]).then(
            ([syncSettings, localSettings]) => finish(syncSettings, localSettings),
            () => finish(defaults),
          );
          return;
        }
        syncStorage.get(defaults, (syncSettings) => {
          if (typeof localStorage?.get === 'function') {
            const localCallbackResult = localStorage.get({ openAiApiKey: '', extractionIntensity: state.extractionIntensity }, (localSettings) => finish(syncSettings, localSettings));
            if (localCallbackResult && typeof localCallbackResult.then === 'function') {
              localCallbackResult.then((localSettings) => finish(syncSettings, localSettings), () => finish(syncSettings));
            }
            return;
          }
          finish(syncSettings);
        });
      } catch {
        finish(defaults);
      }
    });
  }

  async function refreshExtractionIntensity(settings = {}) {
    state.extractionIntensity = normalizeIntensity(settings?.extractionIntensity);
    const segment = getCurrentSegment();
    if (segment) {
      updateSegmentAnalysis(segment.id, null);
      const updatedSegment = getCurrentSegment();
      applyInstantLearningAnalysis(updatedSegment);
    }
    render();
    return { ok: true, extractionIntensity: state.extractionIntensity };
  }

  async function refreshEnabledSetting() {
    const syncStorage = chrome?.storage?.sync;
    if (typeof syncStorage?.get !== 'function') return state.enabled;

    try {
      const settings = await syncStorage.get({ enabled: true });
      state.enabled = settings.enabled !== false;
    } catch {
      state.enabled = true;
    }
    render();
    return state.enabled;
  }

  async function refreshStoredExtractionIntensity() {
    const localStorage = chrome?.storage?.local;
    if (typeof localStorage?.get !== 'function') return state.extractionIntensity;

    try {
      const settings = await localStorage.get({ extractionIntensity: state.extractionIntensity });
      state.extractionIntensity = normalizeIntensity(settings.extractionIntensity);
    } catch {
      state.extractionIntensity = 50;
    }
    return state.extractionIntensity;
  }

  function watchEnabledSetting() {
    const onChanged = chrome?.storage?.onChanged;
    if (typeof onChanged?.addListener !== 'function') return;

    onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !Object.hasOwn(changes ?? {}, 'enabled')) return;
      state.enabled = changes.enabled?.newValue !== false;
      if (!state.enabled) {
        state.status = 'idle';
        state.detail = '插件已关闭。';
      } else {
        state.detail = '正在监听网页字幕';
      }
      render();
    });
  }

  function updateSegmentAnalysis(segmentId, analysis) {
    state.segments = state.segments.map((segment) => (
      segment.id === segmentId ? { ...segment, analysis } : segment
    ));
  }

  function recordLearningHistory(segment) {
    const realtimeKeys = new Set(getRealtimeAnalysisItems(segment?.analysis).map(getLearningHistoryKey).filter(Boolean));
    const items = getExportAnalysisItems(segment?.analysis);
    if (items.length === 0) return;

    const segmentId = String(segment.id ?? '');
    const segmentText = String(segment.text ?? '').trim();
    const startedAt = Number(segment.startedAt) || 0;
    const entries = items.map((item, index) => ({
      id: `${segmentId}:${index}:${item.text}`,
      segmentId,
      order: index,
      startedAt,
      segmentText,
      type: String(item.type ?? ''),
      text: String(item.text ?? '').trim(),
      translation: String(item.translation ?? '').trim(),
      difficulty: String(item.difficulty ?? '').trim(),
      surface: String(item.surface ?? item.text ?? '').trim(),
      start: Number.isFinite(Number(item.start)) ? Number(item.start) : undefined,
      end: Number.isFinite(Number(item.end)) ? Number(item.end) : undefined,
      pending: segment?.analysis?.pending === true,
      display: realtimeKeys.has(getLearningHistoryKey(item)),
    }))
      .filter((item) => item.text && item.translation)
      .filter((item) => !isKnownLearningItem(item));
    const entryKeys = new Set(entries.map(getLearningHistoryKey));

    state.learningHistory = state.learningHistory
      .filter((item) => item.segmentId !== segmentId)
      .filter((item) => !entryKeys.has(getLearningHistoryKey(item)))
      .concat(entries)
      .sort((left, right) => left.startedAt - right.startedAt || left.order - right.order);
  }

  async function refreshKnownLearningExpressions() {
    const expressions = await readKnownLearningExpressions();
    state.knownLearningKeys = new Set(expressions.map(getKnownLearningKey).filter(Boolean));
    return state.knownLearningKeys;
  }

  function readKnownLearningExpressions() {
    const localStorage = chrome?.storage?.local;
    if (typeof localStorage?.get !== 'function') return Promise.resolve([]);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (settings = {}) => {
        if (settled) return;
        settled = true;
        resolve(Array.isArray(settings.knownLearningExpressions) ? settings.knownLearningExpressions : []);
      };

      try {
        const result = localStorage.get({ knownLearningExpressions: [] }, finish);
        if (result && typeof result.then === 'function') {
          result.then(finish, () => finish({ knownLearningExpressions: [] }));
        }
      } catch {
        finish({ knownLearningExpressions: [] });
      }
    });
  }

  function filterKnownLearningAnalysis(analysis) {
    const realtimeItems = getRealtimeAnalysisItems(analysis).filter((item) => !isKnownLearningItem(item));
    const exportItems = getExportAnalysisItems(analysis).filter((item) => !isKnownLearningItem(item));
    return {
      ...(analysis ?? {}),
      realtimeItems,
      exportItems,
      items: realtimeItems,
    };
  }

  function pruneKnownLearningHighlights() {
    state.learningHistory = state.learningHistory.filter((item) => !isKnownLearningItem(item));
    state.segments = state.segments.map((segment) => {
      if (!segment?.analysis) return segment;
      return {
        ...segment,
        analysis: filterKnownLearningAnalysis(segment.analysis),
      };
    });
  }

  function isKnownLearningItem(item) {
    const key = getLearningHistoryKey(item);
    return Boolean(key && state.knownLearningKeys.has(key));
  }

  function getKnownLearningKey(item) {
    const key = String(item?.key ?? '').trim();
    if (key) return key;
    return getLearningHistoryKey(item);
  }

  function getLearningHistoryKey(item) {
    const normalizedExpression = learningAnalysisTools?.normalizeLearningExpressionKey?.(item?.text)
      ?? String(item?.text ?? '').trim().toLowerCase();
    return normalizedExpression;
  }

  function getAnalysisCacheKey(text) {
    return `${normalizeIntensity(state.extractionIntensity)}:${String(text ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()}`;
  }

  function getCurrentLearningSnapshot() {
    const segment = getCurrentSegment();
    const analysis = getSnapshotAnalysis(segment?.analysis);
    return segment
      ? { ok: true, segment, analysis, sourceUrl: location.href, pageTitle: String(document.title ?? '') }
      : { ok: false, error: '还没有收集到当前字幕。' };
  }

  function getLearningHistorySnapshot() {
    return {
      ok: true,
      highlights: state.learningHistory.slice(),
      sourceUrl: location.href,
      pageTitle: String(document.title ?? ''),
    };
  }

  function getCurrentSegment() {
    return state.segments[state.segments.length - 1] ?? null;
  }

  function renderCurrentSegment(segment) {
    currentTextNode.replaceChildren();
    if (!segment) return;

    for (const part of buildSubtitleTextParts(segment)) {
      const node = document.createElement('span');
      node.textContent = part.text;
      if (part.highlight) {
        node.className = `rvt-subtitle-highlight rvt-highlight-${part.highlight.colorIndex}`;
        node.dataset.highlightIndex = String(part.highlight.colorIndex);
        node.setAttribute('title', part.highlight.text);
      }
      currentTextNode.append(node);
    }
  }

  function renderLearningHistory() {
    learningHistoryNode.replaceChildren(...state.learningHistory.filter((item) => item.display !== false).slice(-2).map((item) => {
      const row = document.createElement('div');
      const colorIndex = getHighlightColorIndex(item);
      row.className = `rvt-learning-highlight-row rvt-learning-${item.type} rvt-highlight-${colorIndex}`;
      row.dataset.highlightIndex = String(colorIndex);
      row.setAttribute('title', [item.type, item.difficulty].filter(Boolean).join(' · '));

      const term = document.createElement('span');
      term.className = 'rvt-highlight-term';
      term.textContent = item.text;

      const translation = document.createElement('span');
      translation.className = 'rvt-highlight-translation';
      translation.textContent = item.pending && !item.translation ? '分析中...' : item.translation;

      row.append(term, translation);
      return row;
    }));
  }

  function buildSubtitleTextParts(segment) {
    const source = String(segment?.text ?? '');
    const ranges = getSegmentHighlightRanges(segment);
    if (ranges.length === 0) return [{ text: source }];

    const parts = [];
    let offset = 0;
    for (const range of ranges) {
      if (range.start > offset) {
        parts.push({ text: source.slice(offset, range.start) });
      }
      parts.push({
        text: source.slice(range.start, range.end),
        highlight: {
          colorIndex: range.colorIndex,
          text: range.text,
        },
      });
      offset = range.end;
    }
    if (offset < source.length) {
      parts.push({ text: source.slice(offset) });
    }
    return parts.filter((part) => part.text);
  }

  function getSegmentHighlightRanges(segment) {
    const source = String(segment?.text ?? '');
    return getRealtimeAnalysisItems(segment?.analysis)
      .map((item, index) => {
        const range = resolveHighlightRange(source, item);
        if (!range) return null;
        return {
          ...range,
          colorIndex: index % 3,
          text: String(item.expression ?? item.text ?? '').trim(),
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.start - right.start || right.end - left.end)
      .reduce((accepted, range) => {
        if (accepted.some((item) => range.start < item.end && range.end > item.start)) return accepted;
        accepted.push(range);
        return accepted;
      }, []);
  }

  function resolveHighlightRange(source, item) {
    const start = Number(item?.start);
    const end = Number(item?.end);
    if (
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      end > start &&
      end <= source.length
    ) {
      return { start, end };
    }

    const surface = String(item?.surface ?? item?.text ?? item?.expression ?? '').trim();
    if (!surface) return null;
    const index = source.toLowerCase().indexOf(surface.toLowerCase());
    if (index < 0) return null;
    return { start: index, end: index + surface.length };
  }

  function getHighlightColorIndex(item) {
    const order = Number(item?.order);
    return Number.isFinite(order) ? Math.max(0, order) % 3 : 0;
  }

  function getRealtimeAnalysisItems(analysis) {
    return Array.from(analysis?.realtimeItems ?? analysis?.items ?? []);
  }

  function getExportAnalysisItems(analysis) {
    return Array.from(analysis?.exportItems ?? analysis?.items ?? analysis?.realtimeItems ?? []);
  }

  function getSnapshotAnalysis(analysis = {}) {
    const paused = getPrimaryVideo()?.paused === true;
    const items = paused ? getExportAnalysisItems(analysis) : getRealtimeAnalysisItems(analysis);
    return {
      ...(analysis ?? {}),
      realtimeItems: getRealtimeAnalysisItems(analysis),
      exportItems: getExportAnalysisItems(analysis),
      items,
    };
  }

  function normalizeIntensity(value) {
    if (typeof learningAnalysisTools?.normalizeExtractionIntensity === 'function') {
      return learningAnalysisTools.normalizeExtractionIntensity(value);
    }
    const number = Number(value);
    if (!Number.isFinite(number)) return 50;
    return Math.min(100, Math.max(0, Math.round(number)));
  }

  function formatSegmentClock(value) {
    const totalSeconds = Math.max(0, Math.floor((Number(value) || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function toggleOverlayPosition() {
    state.position = state.position === 'bottom' ? 'top' : 'bottom';
    storeOverlayPosition(state.position);
    render();
  }

  function startOverlayDrag(event) {
    if (event?.target === collapseButton || event?.target === positionButton) return;
    const startY = Number(event?.clientY);
    if (!Number.isFinite(startY)) return;

    const finishDrag = (upEvent) => {
      window.removeEventListener?.('pointerup', finishDrag);
      const endY = Number(upEvent?.clientY);
      if (!Number.isFinite(endY) || Math.abs(endY - startY) < 24) return;
      state.position = endY < window.innerHeight / 2 ? 'top' : 'bottom';
      storeOverlayPosition(state.position);
      render();
    };
    window.addEventListener?.('pointerup', finishDrag);
  }

  function readStoredOverlayPosition() {
    try {
      return localStorage.getItem('rvt-overlay-position') === 'top' ? 'top' : 'bottom';
    } catch {
      return 'bottom';
    }
  }

  function storeOverlayPosition(position) {
    try {
      localStorage.setItem('rvt-overlay-position', position);
    } catch {
      // Some streaming pages disable storage in frames; position can still work for this session.
    }
  }

  function mountOverlay() {
    const target = overlayMountTools?.getOverlayMountTarget(document) ?? document.documentElement;
    const shouldMove = overlayMountTools?.shouldMoveOverlay(root, target) ?? !target.contains(root);
    if (shouldMove) {
      target.append(root);
    }
  }
})();
