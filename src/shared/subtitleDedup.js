const DEDUP_TIME_BUCKET_MS = 5_000;
const INCREMENTAL_WINDOW_MS = 4_000;

export function compactRepeatedSubtitleText(text) {
  const normalized = normalizeSubtitleDisplayText(text);
  if (!normalized) return '';

  const halfLength = Math.floor(normalized.length / 2);
  for (let index = 1; index <= halfLength; index += 1) {
    if (normalized.length % index !== 0) continue;
    const unit = normalized.slice(0, index).trim();
    if (!unit) continue;
    const repeated = unit.repeat(normalized.length / unit.length);
    if (repeated === normalized) return unit;
  }

  const words = normalized.split(/\s+/);
  if (words.length % 2 === 0) {
    const midpoint = words.length / 2;
    const first = words.slice(0, midpoint).join(' ');
    const second = words.slice(midpoint).join(' ');
    if (normalizeForComparison(first) === normalizeForComparison(second)) return first;
  }

  return normalized;
}

export function normalizeSubtitleForDedup(text) {
  return normalizeForComparison(compactRepeatedSubtitleText(text));
}

export function buildSubtitleFingerprint(segment) {
  const textKey = normalizeSubtitleForDedup(segment?.text);
  const startedAt = Number(segment?.startedAt) || 0;
  const bucket = Math.floor(startedAt / DEDUP_TIME_BUCKET_MS);
  return `${bucket}:${textKey}`;
}

export function mergeDedupedSegments(segments) {
  const merged = [];

  for (const segment of Array.from(segments ?? []).map(normalizeDedupSegment).filter(Boolean)) {
    const existingIndex = findMergeTargetIndex(merged, segment);
    if (existingIndex === -1) {
      merged.push(segment);
      continue;
    }

    merged[existingIndex] = mergeTwoSegments(merged[existingIndex], segment);
  }

  return merged.sort((left, right) => left.startedAt - right.startedAt || left.updatedAt - right.updatedAt);
}

export function areIncrementalSubtitleTexts(previousText, nextText) {
  const previous = normalizeSubtitleForDedup(previousText);
  const next = normalizeSubtitleForDedup(nextText);
  if (!previous || !next || previous === next) return previous === next;
  return previous.length < next.length ? next.startsWith(previous) : previous.startsWith(next);
}

function normalizeSubtitleDisplayText(text) {
  return String(text ?? '')
    .replace(/\\n/g, ' ')
    .replace(/[♪♫]/g, ' ')
    .replace(/([.!?])(?=[A-Z])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForComparison(text) {
  return normalizeSubtitleDisplayText(text)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9'\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDedupSegment(segment) {
  const text = compactRepeatedSubtitleText(segment?.text);
  if (!text) return null;
  const startedAt = Number(segment?.startedAt) || 0;
  const updatedAt = Number(segment?.updatedAt) || startedAt;
  return {
    ...segment,
    text,
    startedAt,
    updatedAt,
  };
}

function findMergeTargetIndex(segments, segment) {
  const fingerprint = buildSubtitleFingerprint(segment);
  const index = segments.findIndex((existing) => buildSubtitleFingerprint(existing) === fingerprint);
  if (index !== -1) return index;

  return segments.findIndex((existing) => {
    const sameTimeline = Math.abs((Number(existing.startedAt) || 0) - segment.startedAt) <= INCREMENTAL_WINDOW_MS;
    return sameTimeline && areIncrementalSubtitleTexts(existing.text, segment.text);
  });
}

function mergeTwoSegments(left, right) {
  const leftText = compactRepeatedSubtitleText(left.text);
  const rightText = compactRepeatedSubtitleText(right.text);
  const text = normalizeSubtitleForDedup(rightText).length >= normalizeSubtitleForDedup(leftText).length
    ? rightText
    : leftText;
  const result = {
    ...left,
    ...right,
    id: left.id || right.id,
    text,
    startedAt: Math.min(Number(left.startedAt) || 0, Number(right.startedAt) || 0),
    updatedAt: Math.max(Number(left.updatedAt) || 0, Number(right.updatedAt) || 0),
  };
  const analysis = right.analysis ?? left.analysis;
  if (analysis !== undefined) result.analysis = analysis;
  return result;
}
