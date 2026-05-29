import {
  DEFAULT_SETTINGS,
  getMissingDefaultSettings,
  normalizeSettings,
} from '../shared/settings.js';
import { ensureContentScript as ensureContentScriptInjected } from './contentScriptInjection.js';
import { fetchSubtitleTrack } from './subtitleTrackFetcher.js';
import {
  clearTranscriptInFrames,
  collectDiagnosticsFromFrames,
  collectLearningHistoryFromFrames,
  collectTranscriptFromFrames,
} from './transcriptCollector.js';
import {
  createNativeServiceManager,
  isLocalServiceEndpoint,
} from './nativeServiceManager.js';

const nativeService = createNativeServiceManager(chrome);

chrome.runtime.onInstalled.addListener(async () => {
  const existingSettings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const missingSettings = getMissingDefaultSettings(existingSettings);
  if (Object.keys(missingSettings).length > 0) {
    await chrome.storage.sync.set(missingSettings);
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureNativeServiceWhenEnabled().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !Object.hasOwn(changes ?? {}, 'enabled')) return;
  if (changes.enabled?.newValue === false) {
    nativeService.stopService().catch(() => {});
    return;
  }
  ensureNativeServiceWhenEnabled().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === 'background' && message.type === 'GET_CAPTURE_STATE') {
    sendResponse({
      ok: true,
      isCapturing: false,
      mode: 'removed',
      tabId: null,
      sourceUrl: '',
    });
    return true;
  }

  if (message?.target === 'background' && message.type === 'ENSURE_NATIVE_SERVICE') {
    ensureNativeService(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.target === 'background' && message.type === 'STOP_NATIVE_SERVICE') {
    nativeService.stopService()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.target === 'background' && message.type === 'GET_NATIVE_SERVICE_STATUS') {
    nativeService.getStatus()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.target === 'background' && message.type === 'FETCH_SUBTITLE_TRACK') {
    fetchSubtitleTrack(message.url)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.target === 'background' && message.type === 'ENSURE_CONTENT_SCRIPT') {
    ensureContentScript(message.tabId ?? sender.tab?.id)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.target === 'background' && message.type === 'COLLECT_TRANSCRIPT') {
    collectTranscript(message.tabId ?? sender.tab?.id)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.target === 'background' && message.type === 'COLLECT_DIAGNOSTICS') {
    collectDiagnostics(message.tabId ?? sender.tab?.id)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.target === 'background' && message.type === 'COLLECT_LEARNING_HISTORY') {
    collectLearningHistory(message.tabId ?? sender.tab?.id)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.target === 'background' && message.type === 'CLEAR_TRANSCRIPTS') {
    clearTranscripts(message.tabId ?? sender.tab?.id)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.target === 'background' && message.type === 'SITE_SUBTITLES_AVAILABLE') {
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

async function ensureContentScript(tabId) {
  await ensureContentScriptInjected(chrome, tabId);
}

async function collectTranscript(tabId) {
  await ensureContentScript(tabId);
  return collectTranscriptFromFrames(chrome, tabId);
}

async function collectDiagnostics(tabId) {
  await ensureContentScript(tabId);
  return collectDiagnosticsFromFrames(chrome, tabId);
}

async function collectLearningHistory(tabId) {
  await ensureContentScript(tabId);
  return collectLearningHistoryFromFrames(chrome, tabId);
}

async function clearTranscripts(tabId) {
  await ensureContentScript(tabId);
  return clearTranscriptInFrames(chrome, tabId);
}

async function ensureNativeService(message = {}) {
  const endpoint = String(message.endpoint ?? '').trim();
  if (endpoint && !isLocalServiceEndpoint(endpoint)) {
    return { ok: true, skipped: true, status: { state: 'external' } };
  }
  const settings = normalizeSettings(await chrome.storage.sync.get(DEFAULT_SETTINGS));
  if (settings.enabled === false) {
    return { ok: false, error: '插件已关闭。', status: { state: 'disabled' } };
  }
  return nativeService.ensureService();
}

async function ensureNativeServiceWhenEnabled() {
  const settings = normalizeSettings(await chrome.storage.sync.get(DEFAULT_SETTINGS));
  if (settings.enabled === false) return { ok: false, status: { state: 'disabled' } };
  if (
    !isLocalServiceEndpoint(settings.analysisEndpoint) &&
    !isLocalServiceEndpoint(settings.obsidianExportEndpoint)
  ) {
    return { ok: true, skipped: true, status: { state: 'external' } };
  }
  return nativeService.ensureService();
}
