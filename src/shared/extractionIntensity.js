export const DEFAULT_EXTRACTION_INTENSITY = 50;

export function normalizeExtractionIntensity(value, fallback = DEFAULT_EXTRACTION_INTENSITY) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(0, Math.round(number)));
}

export function getExtractionModeLabel(intensity = DEFAULT_EXTRACTION_INTENSITY) {
  const value = normalizeExtractionIntensity(intensity);
  if (value <= 20) return '极简';
  if (value <= 40) return '精简';
  if (value <= 60) return '平衡';
  if (value <= 80) return '详细';
  return '全量';
}

export function getExtractionConfigFromIntensity(intensity = DEFAULT_EXTRACTION_INTENSITY) {
  const value = normalizeExtractionIntensity(intensity);
  const base = {
    intensity: value,
    allowPatterns: true,
    allowIdioms: true,
    allowPhrasalVerbs: true,
    allowCollocations: true,
    allowAdvancedWords: true,
    allowTechnicalTerms: false,
    allowB2Words: true,
    allowProperNouns: false,
    compactDuringPlayback: true,
  };

  if (value <= 20) {
    return {
      ...base,
      realtimeMaxItemsPerLine: 1,
      exportMaxItemsPerLine: 2,
      minStructureScore: 8,
      minAdvancedWordScore: 8,
      allowCollocations: false,
      allowTechnicalTerms: false,
      allowB2Words: false,
    };
  }

  if (value <= 40) {
    return {
      ...base,
      realtimeMaxItemsPerLine: 1,
      exportMaxItemsPerLine: 3,
      minStructureScore: 7,
      minAdvancedWordScore: 7,
      allowTechnicalTerms: false,
    };
  }

  if (value <= 60) {
    return {
      ...base,
      realtimeMaxItemsPerLine: 2,
      exportMaxItemsPerLine: 4,
      minStructureScore: 6,
      minAdvancedWordScore: 6,
      allowTechnicalTerms: false,
    };
  }

  if (value <= 80) {
    return {
      ...base,
      realtimeMaxItemsPerLine: 2,
      exportMaxItemsPerLine: 6,
      minStructureScore: 5,
      minAdvancedWordScore: 5,
      allowTechnicalTerms: true,
    };
  }

  return {
    ...base,
    realtimeMaxItemsPerLine: 3,
    exportMaxItemsPerLine: 8,
    minStructureScore: 4,
    minAdvancedWordScore: 4,
    allowTechnicalTerms: true,
    compactDuringPlayback: false,
  };
}
