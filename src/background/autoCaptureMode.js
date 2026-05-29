export function normalizeCaptureMode(mode) {
  return mode === 'auto' ? 'auto' : 'manual';
}

export function shouldStopCaptureForSiteSubtitles({ captureMode, activeTabId, senderTabId } = {}) {
  if (!activeTabId || !senderTabId) return false;
  return Number(activeTabId) === Number(senderTabId);
}

export async function handleSiteSubtitlesAvailable({
  captureMode,
  activeTabId,
  senderTabId,
  stopCapture,
} = {}) {
  if (!shouldStopCaptureForSiteSubtitles({ captureMode, activeTabId, senderTabId })) {
    return { stopped: false };
  }

  await stopCapture({
    status: 'site-subtitles',
    detail: '网页字幕已可用，音频兜底已停止。',
  });
  return { stopped: true };
}
