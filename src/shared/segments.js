export function mergeTranscriptSegment(segments, nextSegment) {
  const normalized = normalizeSegment(nextSegment);
  const existingIndex = segments.findIndex((segment) => segment.id === normalized.id);

  const merged =
    existingIndex === -1
      ? [...segments, normalized]
      : segments.map((segment, index) =>
          index === existingIndex ? { ...segment, ...normalized } : segment,
        );

  return merged.sort((a, b) => a.startedAt - b.startedAt || a.updatedAt - b.updatedAt);
}

export function trimTranscriptHistory(segments, maxSegments = 40) {
  if (maxSegments === Infinity) return [...segments];
  if (segments.length <= maxSegments) return [...segments];
  return segments.slice(segments.length - maxSegments);
}

export function getVisibleTranscriptSegments(segments, maxVisibleSegments = 30) {
  return trimTranscriptHistory(segments, maxVisibleSegments);
}

export function clearTranscriptHistory() {
  return [];
}

export function normalizeSegment(segment) {
  if (!segment || typeof segment !== 'object') {
    throw new TypeError('Transcript segment must be an object.');
  }

  const text = String(segment.text ?? '').trim();
  if (!text) {
    throw new TypeError('Transcript segment text is required.');
  }

  const now = Date.now();
  const startedAt = Number.isFinite(segment.startedAt) ? segment.startedAt : now;
  const updatedAt = Number.isFinite(segment.updatedAt) ? segment.updatedAt : startedAt;

  return {
    id: String(segment.id ?? `seg-${startedAt}-${updatedAt}`),
    text,
    translatedText: String(segment.translatedText ?? segment.translated_text ?? '').trim(),
    language: String(segment.language ?? ''),
    isFinal: segment.isFinal !== false,
    startedAt,
    updatedAt,
  };
}
