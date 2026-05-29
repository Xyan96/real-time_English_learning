export function getInitialPopupStatus() {
  return '会自动读取网页字幕，并实时高亮学习项。';
}

export function formatTranscriptCount(count) {
  const normalizedCount = Math.max(0, Number(count) || 0);
  if (normalizedCount === 0) return '还没有收集到字幕。';
  return `已收集 ${normalizedCount} 行字幕。`;
}

export function getTranscriptStatus(response) {
  if (!response?.ok) {
    return response?.error || '无法读取当前标签页的字幕状态。';
  }

  return formatTranscriptCount(response.segments?.length ?? 0);
}

export function formatDiagnosticsSummary(response) {
  if (!response?.ok) {
    return response?.error || '无法读取当前标签页的字幕诊断信息。';
  }

  const videos = Array.from(response.videos ?? []);
  const frames = Array.from(response.frames ?? []);
  const pageSubtitleResources = Array.from(response.pageSubtitleResources ?? []);
  const domSubtitleResources = Array.from(response.domSubtitleResources ?? []);
  const failedSubtitleResourceCount = pageSubtitleResources.filter(isFailedSubtitleResource).length;
  const textTrackCount = videos.reduce((sum, video) => sum + normalizedCount(video?.textTrackCount), 0);
  const activeCueCount = videos.reduce((sum, video) => (
    sum + Array.from(video?.textTracks ?? []).reduce((trackSum, track) => (
      trackSum + normalizedCount(track?.activeCueCount)
    ), 0)
  ), 0);

  return [
    `诊断信息已复制：${normalizedCount(response.transcriptCount)} 行字幕`,
    `${normalizedCount(response.renderedSubtitles?.count)} 个页面字幕节点`,
    `${pageSubtitleResources.length} 个拦截到的字幕资源`,
    `${failedSubtitleResourceCount} 个失败的字幕资源`,
    `${Array.from(response.subtitleResources ?? []).length} 个浏览器字幕资源`,
    `${domSubtitleResources.length} 个 DOM 字幕资源`,
    `${frames.length} 个 frame`,
    `${videos.length} 个视频`,
    `${textTrackCount} 条文本轨道`,
    `${activeCueCount} 条活跃字幕.`,
  ].join(', ');
}

export function formatDiagnosticsVerdict(response) {
  if (!response?.ok) {
    return response?.error || '无法读取当前标签页的字幕诊断信息。';
  }

  const report = buildDiagnosticsReport(response);
  if (report.verdict.status === 'site-subtitles-detected') {
    return `已检测到网页字幕：${report.verdict.evidence.join('，')}。验证报告已复制。`;
  }

  return '尚未检测到网页字幕。音频兜底已移除；验证报告已复制。';
}

export function buildDiagnosticsReport(response, generatedAt = new Date()) {
  const safeResponse = response ?? {};
  const counts = getDiagnosticsCounts(safeResponse);
  const evidence = buildSubtitleEvidence(counts);

  return {
    generatedAt: generatedAt.toISOString(),
    url: String(safeResponse.url ?? ''),
    summary: formatDiagnosticsSummary(safeResponse),
    verdict: {
      status: evidence.length > 0 ? 'site-subtitles-detected' : 'no-site-subtitles-detected',
      evidence,
    },
    counts,
    samples: {
      renderedSubtitles: Array.from(safeResponse.renderedSubtitles?.samples ?? []),
      pageSubtitleResources: Array.from(safeResponse.pageSubtitleResources ?? [])
        .filter((resource) => normalizedCount(resource?.cueCount) > 0)
        .map((resource) => ({
          url: String(resource?.url ?? ''),
          source: String(resource?.source ?? ''),
          cueCount: normalizedCount(resource?.cueCount),
          cueSamples: Array.from(resource?.cueSamples ?? []),
        })),
      domSubtitleResources: Array.from(safeResponse.domSubtitleResources ?? []),
      frames: Array.from(safeResponse.frames ?? []),
    },
    raw: safeResponse,
  };
}

function getDiagnosticsCounts(response) {
  const videos = Array.from(response.videos ?? []);
  const pageSubtitleResources = Array.from(response.pageSubtitleResources ?? []);
  const textTrackCount = videos.reduce((sum, video) => sum + normalizedCount(video?.textTrackCount), 0);
  const activeCueCount = videos.reduce((sum, video) => (
    sum + Array.from(video?.textTracks ?? []).reduce((trackSum, track) => (
      trackSum + normalizedCount(track?.activeCueCount)
    ), 0)
  ), 0);

  return {
    transcriptLines: normalizedCount(response.transcriptCount),
    renderedSubtitleNodes: normalizedCount(response.renderedSubtitles?.count),
    interceptedSubtitleResources: pageSubtitleResources.length,
    interceptedSubtitleResourcesWithCues: pageSubtitleResources
      .filter((resource) => normalizedCount(resource?.cueCount) > 0)
      .length,
    failedSubtitleResources: pageSubtitleResources.filter(isFailedSubtitleResource).length,
    browserSubtitleResources: Array.from(response.subtitleResources ?? []).length,
    domSubtitleResources: Array.from(response.domSubtitleResources ?? []).length,
    frames: Array.from(response.frames ?? []).length,
    videos: videos.length,
    textTracks: textTrackCount,
    activeCues: activeCueCount,
  };
}

function buildSubtitleEvidence(counts) {
  return [
    formatEvidenceCount(counts.transcriptLines, '行已收集字幕'),
    formatEvidenceCount(counts.renderedSubtitleNodes, '个页面字幕节点'),
    formatEvidenceCount(counts.interceptedSubtitleResourcesWithCues, '个带字幕片段的拦截资源'),
    formatEvidenceCount(counts.browserSubtitleResources, '个浏览器字幕资源'),
    formatEvidenceCount(counts.domSubtitleResources, '个 DOM 字幕资源'),
    formatEvidenceCount(counts.textTracks, '条文本轨道'),
    formatEvidenceCount(counts.activeCues, '条活跃字幕'),
  ].filter(Boolean);
}

function formatEvidenceCount(count, label) {
  const normalized = normalizedCount(count);
  return normalized > 0 ? `${normalized} ${label}` : '';
}

function normalizedCount(value) {
  return Math.max(0, Number(value) || 0);
}

function isFailedSubtitleResource(resource) {
  return Boolean(resource?.error) || normalizedCount(resource?.status) >= 400;
}
