export function createCaptureClock({ now = Date.now } = {}) {
  const startedAt = Number(now()) || 0;

  return {
    elapsedMs() {
      return Math.max(0, Math.round((Number(now()) || 0) - startedAt));
    },
  };
}

export function createCaptureChunkTimer({ now = Date.now } = {}) {
  const clock = createCaptureClock({ now });
  let previousEndedAt = 0;

  return {
    nextChunkTiming() {
      const endedAt = clock.elapsedMs();
      const timing = {
        startedAt: previousEndedAt,
        endedAt: Math.max(previousEndedAt, endedAt),
      };
      previousEndedAt = timing.endedAt;
      return timing;
    },
  };
}

export function createAudioTranscriptSegment({ sequence, result, startedAt, endedAt }) {
  const normalizedStartedAt = Math.max(0, Number(startedAt) || 0);
  const normalizedEndedAt = Math.max(normalizedStartedAt, Number(endedAt) || normalizedStartedAt);

  return {
    id: `seg-${sequence}`,
    text: String(result?.text ?? '').trim(),
    translatedText: String(result?.translatedText ?? '').trim(),
    language: String(result?.language ?? ''),
    isFinal: result?.isFinal !== false,
    startedAt: normalizedStartedAt,
    updatedAt: normalizedEndedAt,
  };
}
