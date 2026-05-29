import {
  buildDiagnosticsReport,
  formatDiagnosticsVerdict,
  getInitialPopupStatus,
  getTranscriptStatus,
} from './popupStatus.js';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
} from '../shared/settings.js';
import {
  getExtractionConfigFromIntensity,
  getExtractionModeLabel,
  normalizeExtractionIntensity,
} from '../shared/extractionIntensity.js';
import {
  buildObsidianMarkdown,
  normalizeFilesystemPath,
} from '../shared/obsidianExport.js';
import {
  normalizeLearningExpressionKey,
} from '../shared/learningAnalysis.js';
import {
  waitForCapturedSiteSubtitles,
  waitForUsableSiteSubtitles,
} from './autoFallback.js';
import { sendActiveTabMessage as sendMessageToActiveTab } from './activeTabMessaging.js';
import {
  formatObsidianExportNetworkError,
} from './obsidianFallback.js';

const enabledInput = document.querySelector('#enabled');
const analysisEndpointInput = document.querySelector('#analysisEndpoint');
const englishLevelSelect = document.querySelector('#englishLevel');
const includeProperNounsInput = document.querySelector('#includeProperNouns');
const technicalModeInput = document.querySelector('#technicalMode');
const includeUiTermsInput = document.querySelector('#includeUiTerms');
const extractionIntensityInput = document.querySelector('#extractionIntensity');
const extractionIntensityValueNode = document.querySelector('#extractionIntensityValue');
const extractionModeSummaryNode = document.querySelector('#extractionModeSummary');
const openAiApiKeyInput = document.querySelector('#openAiApiKey');
const obsidianVaultPathInput = document.querySelector('#obsidianVaultPath');
const obsidianSubdirInput = document.querySelector('#obsidianSubdir');
const obsidianExportEndpointInput = document.querySelector('#obsidianExportEndpoint');
const autoButton = document.querySelector('#auto');
const startLocalServiceButton = document.querySelector('#startLocalService');
const stopLocalServiceButton = document.querySelector('#stopLocalService');
const copyButton = document.querySelector('#copy');
const downloadButton = document.querySelector('#download');
const diagnosticsButton = document.querySelector('#diagnostics');
const clearButton = document.querySelector('#clear');
const analyzeButton = document.querySelector('#analyze');
const copyHighlightsButton = document.querySelector('#copyHighlights');
const reviewKnownButton = document.querySelector('#reviewKnown');
const knownReviewNode = document.querySelector('#knownReview');
const closeKnownReviewButton = document.querySelector('#closeKnownReview');
const knownReviewListNode = document.querySelector('#knownReviewList');
const addKnownHighlightsButton = document.querySelector('#addKnownHighlights');
const exportObsidianButton = document.querySelector('#exportObsidian');
const statusNode = document.querySelector('#status');
const KNOWN_LEARNING_STORAGE_KEY = 'knownLearningExpressions';
let knownReviewCandidates = [];

init();

async function init() {
  const [storedSettings, storedSecrets] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_SETTINGS),
    chrome.storage.local.get({
      openAiApiKey: DEFAULT_SETTINGS.openAiApiKey,
      extractionIntensity: DEFAULT_SETTINGS.extractionIntensity,
    }),
  ]);
  const settings = normalizeSettings({ ...storedSettings, ...storedSecrets });

  enabledInput.checked = settings.enabled;
  analysisEndpointInput.value = settings.analysisEndpoint;
  englishLevelSelect.value = settings.englishLevel;
  includeProperNounsInput.checked = settings.includeProperNouns;
  technicalModeInput.checked = settings.technicalMode;
  includeUiTermsInput.checked = settings.includeUiTerms;
  extractionIntensityInput.value = String(settings.extractionIntensity);
  openAiApiKeyInput.value = settings.openAiApiKey;
  obsidianVaultPathInput.value = settings.obsidianVaultPath;
  obsidianSubdirInput.value = settings.obsidianSubdir;
  obsidianExportEndpointInput.value = settings.obsidianExportEndpoint;
  renderExtractionIntensitySummary(settings.extractionIntensity);
  statusNode.textContent = getInitialPopupStatus();

  enabledInput.addEventListener('change', saveEnabledSetting);
  analysisEndpointInput.addEventListener('change', saveSettings);
  englishLevelSelect.addEventListener('change', saveSettings);
  includeProperNounsInput.addEventListener('change', saveSettings);
  technicalModeInput.addEventListener('change', saveSettings);
  includeUiTermsInput.addEventListener('change', saveSettings);
  extractionIntensityInput.addEventListener('input', saveExtractionIntensity);
  openAiApiKeyInput.addEventListener('change', saveSettings);
  obsidianVaultPathInput.addEventListener('change', saveSettings);
  obsidianSubdirInput.addEventListener('change', saveSettings);
  obsidianExportEndpointInput.addEventListener('change', saveSettings);
  bindAction(autoButton, startAutoMode, '检查字幕...');
  bindAction(startLocalServiceButton, startLocalService, '启动服务...');
  bindAction(stopLocalServiceButton, stopLocalService, '关闭服务...');
  bindAction(copyButton, copyTranscript, '复制中...');
  bindAction(downloadButton, downloadTranscript, '生成 SRT...');
  bindAction(diagnosticsButton, copyDiagnostics, '复制诊断...');
  bindAction(clearButton, clearTranscript, '清空中...');
  bindAction(analyzeButton, analyzeCurrentLine, '分析中...');
  bindAction(copyHighlightsButton, copyHighlightsMarkdown, '复制学习项...');
  bindAction(reviewKnownButton, reviewKnownHighlights, '整理中...');
  closeKnownReviewButton.addEventListener('click', closeKnownReview);
  bindAction(addKnownHighlightsButton, addSelectedKnownHighlights, '保存中...');
  bindAction(exportObsidianButton, exportHighlightsToObsidian, '导出中...');

  refreshTranscriptStatus();
  if (settings.enabled) {
    ensureLocalServiceForEndpoint(settings.analysisEndpoint, { silent: true });
  }
}

async function saveSettings() {
  await Promise.all([
    chrome.storage.sync.set({
      enabled: enabledInput.checked,
      analysisEndpoint: analysisEndpointInput.value.trim(),
      obsidianExportEndpoint: obsidianExportEndpointInput.value.trim(),
      englishLevel: englishLevelSelect.value,
      includeProperNouns: includeProperNounsInput.checked,
      technicalMode: technicalModeInput.checked,
      includeUiTerms: includeUiTermsInput.checked,
      obsidianVaultPath: normalizeFilesystemPath(obsidianVaultPathInput.value),
      obsidianSubdir: obsidianSubdirInput.value.trim(),
    }),
    chrome.storage.local.set({
      openAiApiKey: openAiApiKeyInput.value.trim(),
      extractionIntensity: normalizeExtractionIntensity(extractionIntensityInput.value),
    }),
  ]);
}

async function saveExtractionIntensity() {
  const intensity = normalizeExtractionIntensity(extractionIntensityInput.value);
  extractionIntensityInput.value = String(intensity);
  renderExtractionIntensitySummary(intensity);
  await chrome.storage.local.set({ extractionIntensity: intensity });
  await sendActiveTabMessage({
    type: 'REFRESH_EXTRACTION_INTENSITY',
    settings: getCurrentSettings(),
  });
}

async function saveEnabledSetting() {
  await saveSettings();
  statusNode.textContent = enabledInput.checked
    ? '插件已启用，会自动读取当前页面字幕。'
    : '插件已关闭。';
}

function bindAction(button, handler, busyText) {
  button.addEventListener('click', () => runButtonAction(button, handler, busyText));
}

async function runButtonAction(button, handler, busyText = '处理中...') {
  if (button.disabled) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.classList.add('is-busy');
  button.textContent = busyText;
  statusNode.textContent = busyText;
  try {
    await handler();
  } catch (error) {
    statusNode.textContent = error?.message ?? '操作失败。';
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
    button.textContent = originalText;
  }
}

async function startAutoMode() {
  enabledInput.checked = true;
  await saveSettings();
  const settings = getCurrentSettings();
  statusNode.textContent = '正在启动自动学习...';
  await sendActiveTabMessage({ type: 'REFRESH_ENABLED_SETTING' });
  const service = await ensureLocalServiceForEndpoint(settings.analysisEndpoint);
  if (!service.ok) {
    statusNode.textContent = service.error;
    return;
  }

  statusNode.textContent = '正在等待可分析的网页字幕...';

  const subtitleCheck = await waitForUsableSiteSubtitles({
    readDiagnostics: () => sendActiveTabMessage({ type: 'GET_DIAGNOSTICS' }),
  });
  if (!subtitleCheck.ok) {
    statusNode.textContent = subtitleCheck.diagnostics?.error ?? '无法读取字幕诊断信息。';
    return;
  }

  if (!subtitleCheck.found) {
    statusNode.textContent = '尚未检测到网页字幕；音频兜底已移除，无法自动转写音频。';
    return;
  }

  const captureCheck = await waitForCapturedSiteSubtitles({
    readDiagnostics: () => sendActiveTabMessage({ type: 'GET_DIAGNOSTICS' }),
  });
  if (!captureCheck.ok) {
    statusNode.textContent = captureCheck.diagnostics?.error ?? '无法读取字幕采集状态。';
    return;
  }
  if (!captureCheck.found) {
    statusNode.textContent = captureCheck.hasEvidence
      ? '已看到网页字幕源，但还没有抓到可分析的字幕行；请让视频继续播放几秒再试。'
      : '尚未抓到可分析的字幕行；请确认视频正在播放且字幕已打开。';
    return;
  }

  const analysis = await sendActiveTabMessage({
    type: 'ANALYZE_CURRENT_LINE',
    settings,
  });
  statusNode.textContent = analysis?.ok
    ? `自动学习已启动：已分析当前字幕，找到 ${analysis.analysis?.items?.length ?? 0} 个学习项。`
    : analysis?.error ?? '已抓到字幕，但无法分析当前字幕。';
}

async function startLocalService() {
  await saveSettings();
  statusNode.textContent = '正在启动本地服务...';
  const result = await ensureLocalServiceForEndpoint(getCurrentSettings().analysisEndpoint);
  statusNode.textContent = result.ok
    ? formatNativeServiceStatus(result.status)
    : result.error;
}

async function stopLocalService() {
  const response = await chrome.runtime.sendMessage({
    target: 'background',
    type: 'STOP_NATIVE_SERVICE',
  });
  statusNode.textContent = response?.ok
    ? '本地服务已关闭。'
    : response?.error ?? '无法关闭本地服务。';
}

function getCurrentSettings() {
  return normalizeSettings({
    enabled: enabledInput.checked,
    analysisEndpoint: analysisEndpointInput.value.trim(),
    obsidianExportEndpoint: obsidianExportEndpointInput.value.trim(),
    englishLevel: englishLevelSelect.value,
    includeProperNouns: includeProperNounsInput.checked,
    technicalMode: technicalModeInput.checked,
    includeUiTerms: includeUiTermsInput.checked,
    extractionIntensity: normalizeExtractionIntensity(extractionIntensityInput.value),
    openAiApiKey: openAiApiKeyInput.value.trim(),
    obsidianVaultPath: normalizeFilesystemPath(obsidianVaultPathInput.value),
    obsidianSubdir: obsidianSubdirInput.value.trim(),
  });
}

function renderExtractionIntensitySummary(intensity) {
  const normalizedIntensity = normalizeExtractionIntensity(intensity);
  const config = getExtractionConfigFromIntensity(normalizedIntensity);
  extractionIntensityValueNode.textContent = String(normalizedIntensity);
  extractionModeSummaryNode.textContent = [
    `当前模式：${getExtractionModeLabel(normalizedIntensity)}`,
    `实时显示：每行最多 ${config.realtimeMaxItemsPerLine} 个`,
    `后台导出：每行最多 ${config.exportMaxItemsPerLine} 个`,
  ].join(' · ');
}

async function copyTranscript() {
  const transcript = await getActiveTabTranscript();
  if (!transcript.ok) {
    statusNode.textContent = transcript.error;
    return;
  }

  if (!transcript.text) {
    statusNode.textContent = '当前标签页还没有收集到字幕。';
    return;
  }

  await navigator.clipboard.writeText(transcript.text);
  statusNode.textContent = `已复制 ${transcript.segments.length} 行字幕。`;
}

async function downloadTranscript() {
  const transcript = await getActiveTabTranscript();
  if (!transcript.ok) {
    statusNode.textContent = transcript.error;
    return;
  }

  if (!transcript.srt) {
    statusNode.textContent = '当前标签页还没有收集到字幕。';
    return;
  }

  const url = URL.createObjectURL(new Blob([transcript.srt], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `transcript-${new Date().toISOString().replace(/[:.]/g, '-')}.srt`;
  link.click();
  URL.revokeObjectURL(url);
  statusNode.textContent = `已下载 ${transcript.segments.length} 个字幕块。`;
}

async function clearTranscript() {
  const response = await sendActiveTabMessage({ type: 'CLEAR_TRANSCRIPT' });
  statusNode.textContent = response.ok
    ? '已清空当前标签页的字幕记录。'
    : response.error;
}

async function analyzeCurrentLine() {
  await saveSettings();
  statusNode.textContent = '正在分析当前字幕...';
  const service = await ensureLocalServiceForEndpoint(getCurrentSettings().analysisEndpoint);
  if (!service.ok) {
    statusNode.textContent = service.error;
    return;
  }
  const response = await sendActiveTabMessage({
    type: 'ANALYZE_CURRENT_LINE',
    settings: getCurrentSettings(),
  });
  statusNode.textContent = response.ok
    ? `找到 ${response.analysis.items.length} 个学习项。`
    : response.error;
}

async function copyHighlightsMarkdown() {
  const learning = await ensureCurrentLearning();
  if (!learning.ok) {
    statusNode.textContent = learning.error;
    return;
  }

  await navigator.clipboard.writeText(buildLearningMarkdown(learning));
  statusNode.textContent = `已复制 ${learning.analysis.items.length} 个学习项为 Markdown。`;
}

async function exportHighlightsToObsidian() {
  await saveSettings();
  const settings = getCurrentSettings();
  if (!settings.obsidianVaultPath) {
    statusNode.textContent = '请先设置 Obsidian 仓库路径。';
    return;
  }

  const history = await ensureLearningHistory();
  if (!history.ok) {
    statusNode.textContent = history.error;
    return;
  }
  const exportHistory = await filterHistoryAgainstKnown(history);
  if (exportHistory.highlights.length === 0) {
    statusNode.textContent = '没有新的学习项可导出。';
    return;
  }

  statusNode.textContent = '正在导出学习项到 Obsidian...';
  const service = await ensureLocalServiceForEndpoint(settings.obsidianExportEndpoint);
  if (!service.ok) {
    statusNode.textContent = service.error;
    return;
  }
  const payload = {
    vaultPath: settings.obsidianVaultPath,
    subdir: settings.obsidianSubdir,
    pageTitle: exportHistory.pageTitle,
    sourceUrl: exportHistory.sourceUrl,
    highlights: exportHistory.highlights,
  };
  try {
    const response = await fetch(settings.obsidianExportEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = await readResponseError(response);
      statusNode.textContent = `无法直接导出到 Obsidian 目录：本地导出服务返回 HTTP ${response.status}${detail ? `：${detail}` : ''}。`;
      return;
    }

    const result = await response.json();
    statusNode.textContent = `已导出 ${exportHistory.highlights.length} 个学习项到 ${result.path}。`;
  } catch (error) {
    statusNode.textContent = formatObsidianExportNetworkError(error, settings.obsidianExportEndpoint);
  }
}

async function ensureLocalServiceForEndpoint(endpoint, { silent = false } = {}) {
  if (!isLocalEndpoint(endpoint)) return { ok: true, skipped: true, status: { state: 'external' } };
  const response = await chrome.runtime.sendMessage({
    target: 'background',
    type: 'ENSURE_NATIVE_SERVICE',
    endpoint,
  });
  if (!response?.ok) {
    return {
      ok: false,
      error: response?.error ?? '无法启动本地服务。请先运行 npm run install-native-host 安装本机助手。',
    };
  }
  if (!silent) statusNode.textContent = formatNativeServiceStatus(response.status);
  return response;
}

function formatNativeServiceStatus(status = {}) {
  if (status.state === 'running') return '本地服务运行中；长时间不用会自动关闭。';
  if (status.state === 'starting') return '本地服务正在启动...';
  if (status.state === 'stopped') return '本地服务已关闭。';
  if (status.state === 'external') return '当前使用外部服务地址。';
  return '本地服务状态未知。';
}

function isLocalEndpoint(endpoint) {
  try {
    const url = new URL(String(endpoint ?? ''));
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function reviewKnownHighlights() {
  const history = await ensureLearningHistory();
  if (!history.ok) {
    statusNode.textContent = history.error;
    return;
  }

  knownReviewCandidates = await getKnownReviewCandidates(history.highlights);
  renderKnownReview();
  knownReviewNode.hidden = false;
  statusNode.textContent = knownReviewCandidates.length > 0
    ? `正在整理 ${knownReviewCandidates.length} 个学习项。`
    : '没有新的学习项需要标记为已掌握。';
}

function closeKnownReview() {
  knownReviewNode.hidden = true;
}

async function addSelectedKnownHighlights() {
  const selected = Array.from(knownReviewListNode.querySelectorAll('input[type="checkbox"]:checked'))
    .map((input) => knownReviewCandidates[Number(input.value)])
    .filter(Boolean);
  if (selected.length === 0) {
    statusNode.textContent = '没有选中任何学习项。';
    return;
  }

  const existing = await readKnownLearningExpressions();
  const existingKeys = new Set(existing.map((item) => item.key).filter(Boolean));
  const addedAt = new Date().toISOString();
  const additions = selected
    .filter((item) => item.key && !existingKeys.has(item.key))
    .map((item) => ({
      key: item.key,
      text: item.text,
      type: item.type,
      translation: item.translation,
      addedAt,
    }));

  if (additions.length > 0) {
    await writeKnownLearningExpressions(existing.concat(additions));
  }

  await sendActiveTabMessage({ type: 'REFRESH_KNOWN_LEARNING' });
  const addedKeys = new Set(selected.map((item) => item.key));
  knownReviewCandidates = knownReviewCandidates.filter((item) => !addedKeys.has(item.key));
  renderKnownReview();
  statusNode.textContent = `已将 ${selected.length} 个学习项标为已掌握。`;
}

async function getKnownReviewCandidates(highlights) {
  const known = await readKnownLearningExpressions();
  const knownKeys = new Set(known.map((item) => item.key).filter(Boolean));
  const candidatesByKey = new Map();

  for (const highlight of Array.from(highlights ?? [])) {
    const key = getKnownLearningKey(highlight);
    if (!key || knownKeys.has(key) || candidatesByKey.has(key)) continue;
    candidatesByKey.set(key, {
      key,
      type: String(highlight.type ?? '').trim(),
      text: String(highlight.text ?? '').trim(),
      translation: String(highlight.translation ?? '').trim(),
    });
  }

  return Array.from(candidatesByKey.values());
}

function renderKnownReview() {
  knownReviewListNode.replaceChildren();

  if (knownReviewCandidates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'review-empty';
    empty.textContent = '没有新的学习项';
    knownReviewListNode.append(empty);
    return;
  }

  knownReviewListNode.append(...knownReviewCandidates.map((item, index) => {
    const row = document.createElement('label');
    row.className = 'review-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(index);
    checkbox.checked = true;

    const body = document.createElement('span');
    const text = document.createElement('span');
    text.className = 'review-text';
    text.textContent = item.text;
    const translation = document.createElement('span');
    translation.className = 'review-translation';
    translation.textContent = item.translation;
    body.append(text, document.createElement('br'), translation);

    row.append(checkbox, body);
    return row;
  }));
}

async function filterHistoryAgainstKnown(history) {
  const known = await readKnownLearningExpressions();
  const knownKeys = new Set(known.map((item) => item.key).filter(Boolean));
  return {
    ...history,
    highlights: Array.from(history.highlights ?? []).filter((item) => !knownKeys.has(getKnownLearningKey(item))),
  };
}

async function readKnownLearningExpressions() {
  const settings = await chrome.storage.local.get({ [KNOWN_LEARNING_STORAGE_KEY]: [] });
  return normalizeKnownLearningExpressions(settings[KNOWN_LEARNING_STORAGE_KEY]);
}

async function writeKnownLearningExpressions(expressions) {
  await chrome.storage.local.set({
    [KNOWN_LEARNING_STORAGE_KEY]: normalizeKnownLearningExpressions(expressions),
  });
}

function normalizeKnownLearningExpressions(expressions) {
  const itemsByKey = new Map();
  for (const item of Array.from(expressions ?? [])) {
    const key = getKnownLearningKey(item);
    if (!key || itemsByKey.has(key)) continue;
    itemsByKey.set(key, {
      key,
      text: String(item?.text ?? '').trim() || key,
      type: String(item?.type ?? '').trim(),
      translation: String(item?.translation ?? '').trim(),
      addedAt: String(item?.addedAt ?? '').trim(),
    });
  }
  return Array.from(itemsByKey.values());
}

function getKnownLearningKey(item) {
  const key = String(item?.key ?? '').trim();
  if (key) return key;
  return normalizeLearningExpressionKey(item?.text);
}

async function readResponseError(response) {
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

async function ensureCurrentLearning() {
  let learning = await sendActiveTabMessage({ type: 'GET_CURRENT_LEARNING' });
  if (!learning.ok) return learning;
  if (Array.from(learning.analysis?.items ?? []).length > 0) return learning;

  const analyzed = await sendActiveTabMessage({
    type: 'ANALYZE_CURRENT_LINE',
    settings: getCurrentSettings(),
  });
  if (!analyzed.ok) return analyzed;
  learning = await sendActiveTabMessage({ type: 'GET_CURRENT_LEARNING' });
  return learning.ok ? learning : analyzed;
}

async function ensureLearningHistory() {
  let history = await sendActiveTabMessage({ type: 'GET_LEARNING_HISTORY' });
  if (!history.ok) return history;
  if (Array.from(history.highlights ?? []).length > 0) return history;

  const analyzed = await sendActiveTabMessage({
    type: 'ANALYZE_CURRENT_LINE',
    settings: getCurrentSettings(),
  });
  if (!analyzed.ok) return analyzed;
  history = await sendActiveTabMessage({ type: 'GET_LEARNING_HISTORY' });
  return history.ok && Array.from(history.highlights ?? []).length > 0
    ? history
    : { ok: false, error: '还没有收集到学习项。' };
}

function buildLearningMarkdown(learning) {
  return buildObsidianMarkdown({
    pageTitle: learning.pageTitle,
    sourceUrl: learning.sourceUrl,
    segment: learning.segment,
    analysis: learning.analysis,
  });
}

async function copyDiagnostics() {
  const response = await sendActiveTabMessage({ type: 'GET_DIAGNOSTICS' });
  if (!response.ok) {
    statusNode.textContent = response.error;
    return;
  }

  await navigator.clipboard.writeText(JSON.stringify(buildDiagnosticsReport(response), null, 2));
  statusNode.textContent = formatDiagnosticsVerdict(response);
}

async function refreshTranscriptStatus() {
  const transcript = await getActiveTabTranscript();
  statusNode.textContent = transcript.ok && transcript.segments.length === 0
    ? getInitialPopupStatus()
    : getTranscriptStatus(transcript);
}

async function getActiveTabTranscript() {
  const response = await sendActiveTabMessage({ type: 'GET_TRANSCRIPT' });
  return response.ok
    ? response
    : {
        ok: false,
        error: response.error,
      };
}

async function sendActiveTabMessage(message) {
  return sendMessageToActiveTab(chrome, message);
}
