import {
  formatTranscriptAsSrt,
  formatTranscriptAsText,
} from '../shared/transcriptExport.js';
import { mergeDedupedSegments } from '../shared/subtitleDedup.js';

export async function collectTranscriptFromFrames(chromeApi, tabId) {
  if (!tabId) return { ok: false, error: '没有可用于收集字幕的标签页。' };

  const results = await chromeApi.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => globalThis.__rvtGetTranscriptSnapshot?.() ?? { ok: true, segments: [] },
  });
  const segments = mergeFrameSegments(results.map((item) => item?.result));

  return {
    ok: true,
    segments,
    text: formatTranscriptAsText(segments),
    srt: formatTranscriptAsSrt(segments),
  };
}

export async function collectDiagnosticsFromFrames(chromeApi, tabId) {
  if (!tabId) return { ok: false, error: '没有可用于收集诊断信息的标签页。' };

  const results = await chromeApi.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => globalThis.__rvtGetDiagnosticsSnapshot?.() ?? { ok: true, transcriptCount: 0 },
  });

  return mergeFrameDiagnostics(results.map((item) => ({
    ...(item?.result ?? {}),
    frameId: item?.frameId,
  })));
}

export async function collectLearningHistoryFromFrames(chromeApi, tabId) {
  if (!tabId) return { ok: false, error: '没有可用于收集学习项历史的标签页。' };

  const results = await chromeApi.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => globalThis.__rvtGetLearningHistorySnapshot?.() ?? { ok: true, highlights: [] },
  });

  return mergeFrameLearningHistory(results.map((item) => ({
    ...(item?.result ?? {}),
    frameId: item?.frameId,
  })));
}

export async function clearTranscriptInFrames(chromeApi, tabId) {
  if (!tabId) return { ok: false, error: '没有可用于清空字幕的标签页。' };

  const results = await chromeApi.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => globalThis.__rvtClearTranscript?.() ?? { ok: true },
  });

  return {
    ok: true,
    clearedFrames: results.filter((item) => item?.result?.ok !== false).length,
  };
}

export function mergeFrameLearningHistory(snapshots = []) {
  const validSnapshots = Array.from(snapshots ?? []).filter((snapshot) => snapshot?.ok !== false);
  const sourceSnapshot = validSnapshots.find((snapshot) => Array.from(snapshot?.highlights ?? []).length > 0) ?? validSnapshots[0] ?? {};
  const seen = new Set();
  const highlights = [];

  for (const snapshot of validSnapshots) {
    for (const item of Array.from(snapshot?.highlights ?? [])) {
      const key = [
        String(item?.text ?? '').trim().toLowerCase(),
        String(item?.startedAt ?? ''),
        String(item?.segmentText ?? '').trim().toLowerCase(),
      ].join('\n');
      if (seen.has(key)) continue;
      seen.add(key);
      highlights.push({ ...item, frameId: snapshot.frameId ?? 0 });
    }
  }

  highlights.sort((left, right) => (
    (Number(left.startedAt) || 0) - (Number(right.startedAt) || 0) ||
    (Number(left.order) || 0) - (Number(right.order) || 0)
  ));

  return {
    ok: true,
    highlights,
    sourceUrl: sourceSnapshot.sourceUrl ?? '',
    pageTitle: sourceSnapshot.pageTitle ?? '',
    frames: validSnapshots.map((snapshot) => ({
      frameId: snapshot.frameId ?? 0,
      highlightCount: Array.from(snapshot?.highlights ?? []).length,
      sourceUrl: snapshot.sourceUrl ?? '',
    })),
  };
}

export function mergeFrameSegments(snapshots = []) {
  const segments = [];

  for (const snapshot of snapshots) {
    for (const segment of Array.from(snapshot?.segments ?? [])) {
      segments.push({ ...segment });
    }
  }

  return mergeDedupedSegments(segments);
}

export function mergeFrameDiagnostics(snapshots = []) {
  const validSnapshots = Array.from(snapshots ?? []).filter((snapshot) => snapshot?.ok !== false);
  const statusSnapshot = validSnapshots.find((snapshot) => snapshot?.status === 'site-subtitles') ?? validSnapshots[0] ?? {};

  return {
    ok: true,
    url: statusSnapshot.url ?? '',
    status: statusSnapshot.status ?? 'idle',
    detail: statusSnapshot.detail ?? '',
    transcriptCount: validSnapshots.reduce((sum, snapshot) => sum + normalizedCount(snapshot?.transcriptCount), 0),
    captureState: validSnapshots.find((snapshot) => snapshot?.captureState)?.captureState ?? { ok: false, error: '没有可用的捕获状态。' },
    subtitleResources: unique(validSnapshots.flatMap((snapshot) => Array.from(snapshot?.subtitleResources ?? []))),
    domSubtitleResources: unique(validSnapshots.flatMap((snapshot) => Array.from(snapshot?.domSubtitleResources ?? []))),
    pageSubtitleResources: uniqueBy(
      validSnapshots.flatMap((snapshot) => Array.from(snapshot?.pageSubtitleResources ?? [])),
      (resource) => String(resource?.url ?? ''),
    ),
    renderedSubtitles: {
      count: validSnapshots.reduce((sum, snapshot) => sum + normalizedCount(snapshot?.renderedSubtitles?.count), 0),
      samples: validSnapshots.flatMap((snapshot) => Array.from(snapshot?.renderedSubtitles?.samples ?? [])).slice(0, 5),
    },
    frames: validSnapshots.map(summarizeFrameDiagnostics),
    videos: validSnapshots.flatMap((snapshot) => Array.from(snapshot?.videos ?? [])),
  };
}

function summarizeFrameDiagnostics(snapshot) {
  const videos = Array.from(snapshot?.videos ?? []);
  return {
    frameId: snapshot?.frameId ?? 0,
    url: snapshot?.url ?? '',
    transcriptCount: normalizedCount(snapshot?.transcriptCount),
    renderedSubtitleCount: normalizedCount(snapshot?.renderedSubtitles?.count),
    pageSubtitleResourceCount: Array.from(snapshot?.pageSubtitleResources ?? []).length,
    domSubtitleResourceCount: Array.from(snapshot?.domSubtitleResources ?? []).length,
    textTrackCount: videos.reduce((sum, video) => sum + normalizedCount(video?.textTrackCount), 0),
    activeCueCount: videos.reduce((sum, video) => (
      sum + Array.from(video?.textTracks ?? []).reduce((trackSum, track) => (
        trackSum + normalizedCount(track?.activeCueCount)
      ), 0)
    ), 0),
  };
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueBy(values, getKey) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = getKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function normalizedCount(value) {
  return Math.max(0, Number(value) || 0);
}
