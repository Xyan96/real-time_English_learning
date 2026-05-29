export function segmentTimestampToSrtTime(milliseconds) {
  const totalMilliseconds = Math.max(0, Math.floor(Number(milliseconds) || 0));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1_000);
  const millis = totalMilliseconds % 1_000;

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':') + `,${String(millis).padStart(3, '0')}`;
}

export function formatTranscriptAsText(segments) {
  return normalizeSegments(segments)
    .map((segment) => {
      const lines = [`[${formatShortTimestamp(segment.startedAt)}] ${segment.text}`];
      if (segment.translatedText) lines.push(segment.translatedText);
      return lines.join('\n');
    })
    .join('\n\n');
}

export function formatTranscriptAsSrt(segments) {
  return normalizeSegments(segments)
    .map((segment, index) => {
      const endAt = Math.max(segment.updatedAt, segment.startedAt + 1_500);
      const lines = [
        String(index + 1),
        `${segmentTimestampToSrtTime(segment.startedAt)} --> ${segmentTimestampToSrtTime(endAt)}`,
        segment.text,
      ];
      if (segment.translatedText) lines.push(segment.translatedText);
      return lines.join('\n');
    })
    .join('\n\n');
}

function normalizeSegments(segments) {
  return Array.from(segments ?? [])
    .map((segment) => ({
      id: String(segment.id ?? ''),
      text: String(segment.text ?? '').trim(),
      translatedText: String(segment.translatedText ?? '').trim(),
      startedAt: Number(segment.startedAt) || 0,
      updatedAt: Number(segment.updatedAt) || Number(segment.startedAt) || 0,
    }))
    .filter((segment) => segment.text)
    .sort((a, b) => a.startedAt - b.startedAt || a.updatedAt - b.updatedAt);
}

function formatShortTimestamp(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
