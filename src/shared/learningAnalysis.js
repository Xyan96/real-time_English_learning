import {
  dedupeLearningItems,
  selectItemsByIntensity,
  selectTopItemsForSubtitleLine,
} from './deduper.js';
import { analyzeSubtitleLearningItems } from './extractor.js';
import {
  getExtractionConfigFromIntensity,
  getExtractionModeLabel,
  normalizeExtractionIntensity,
} from './extractionIntensity.js';
import {
  mergeLearningItemIntoLibrary,
  normalizeExportableLearningItems,
} from './exporter.js';
import {
  isAdvancedWord,
  shouldKeepItem,
  shouldRejectCandidate,
} from './filters.js';
import { extractionConfig } from './learningRules.js';
import {
  completeLearningItem,
  normalizeExpression,
  normalizeToPattern,
} from './normalizer.js';
import {
  scoreUsefulness,
  withUsefulnessScore,
} from './scorer.js';

export {
  analyzeSubtitleLearningItems,
  dedupeLearningItems,
  extractionConfig,
  getExtractionConfigFromIntensity,
  getExtractionModeLabel,
  isAdvancedWord,
  mergeLearningItemIntoLibrary,
  normalizeExpression,
  normalizeToPattern,
  normalizeExportableLearningItems,
  normalizeExtractionIntensity,
  scoreUsefulness,
  shouldRejectCandidate,
  selectItemsByIntensity,
  selectTopItemsForSubtitleLine,
  shouldKeepItem,
  withUsefulnessScore,
};

const ALLOWED_TYPES = new Set([
  'phrase',
  'collocation',
  'word',
  'pattern',
  'phrasal_verb',
  'idiom',
  'advanced_word',
  'technical_term',
  'named_entity',
]);
const STRUCTURED_TYPES = new Set(['pattern', 'phrasal_verb', 'idiom', 'advanced_word', 'technical_term', 'named_entity']);
const SIMPLE_WORDS = new Set([
  'ask',
  'asked',
  'come',
  'came',
  'do',
  'does',
  'did',
  'escape',
  'escaped',
  'get',
  'go',
  'good',
  'help',
  'know',
  'like',
  'look',
  'make',
  'made',
  'need',
  'needed',
  'needs',
  'save',
  'saved',
  'see',
  'take',
  'took',
  'think',
  'want',
  'wanted',
  'way',
]);
const LEADING_SUBJECTS = new Set(['i', 'you', 'we', 'they', 'he', 'she', 'it']);

export function normalizeLearningAnalysis(payload, sourceText = '') {
  const text = String(sourceText ?? '');
  const sourceItems = Array.from(
    payload?.realtimeItems ?? payload?.exportItems ?? payload?.items ?? [],
  );
  const items = sourceItems
    .map((item) => normalizeAnalysisItem(item, text))
    .filter(Boolean)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  if (items.some((item) => STRUCTURED_TYPES.has(item.type))) {
    const intensityConfig = getExtractionConfigFromIntensity(payload?.intensity ?? extractionConfig.intensity);
    const config = {
      ...extractionConfig,
      ...intensityConfig,
      userLevel: String(payload?.level ?? payload?.userLevel ?? extractionConfig.userLevel).trim() || extractionConfig.userLevel,
      includeProperNouns: payload?.includeProperNouns === true,
      technicalMode: payload?.technicalMode === true,
      includeUiTerms: payload?.includeUiTerms === true,
      minUsefulnessScore: Number.isFinite(Number(payload?.minUsefulnessScore))
        ? Number(payload.minUsefulnessScore)
        : Math.min(intensityConfig.minStructureScore, intensityConfig.minAdvancedWordScore),
    };
    const realtimePayloadItems = Array.from(payload?.realtimeItems ?? []);
    const exportPayloadItems = Array.from(payload?.exportItems ?? []);
    const hasSeparatedItems = realtimePayloadItems.length > 0 || exportPayloadItems.length > 0;
    const keptItems = items
      .map((item) => withUsefulnessScore(item, config))
      .filter((item) => shouldKeepItem(item, config.userLevel, config));
    const selected = hasSeparatedItems
      ? {
          realtimeItems: normalizeSeparatedItems(realtimePayloadItems, text, config),
          exportItems: normalizeSeparatedItems(exportPayloadItems.length > 0 ? exportPayloadItems : realtimePayloadItems, text, config),
        }
      : selectItemsByIntensity(keptItems, config);
    return {
      ...selected,
      items: selected.realtimeItems,
    };
  }

  const fallbackItems = removeOverlappingItems(items);
  return {
    realtimeItems: fallbackItems,
    exportItems: fallbackItems,
    items: fallbackItems,
  };
}

export function buildHighlightedTextParts(text, items = []) {
  const source = String(text ?? '');
  const normalizedItems = normalizeLearningAnalysis({ items }, source).items;
  const parts = [];
  let offset = 0;

  for (const item of normalizedItems) {
    if (item.start > offset) {
      parts.push({ text: source.slice(offset, item.start), highlight: null });
    }
    parts.push({
      text: source.slice(item.start, item.end),
      highlight: {
        type: item.type,
        translation: item.translation,
      },
    });
    offset = item.end;
  }

  if (offset < source.length) {
    parts.push({ text: source.slice(offset), highlight: null });
  }

  return parts.filter((part) => part.text);
}

function normalizeAnalysisItem(item, sourceText) {
  const type = String(item?.type ?? '').trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) return null;

  if (STRUCTURED_TYPES.has(type)) {
    return normalizeStructuredAnalysisItem(item, sourceText, type);
  }

  const text = String(item?.text ?? item?.term ?? '').trim();
  const translation = String(item?.translation ?? item?.meaning ?? item?.zh ?? '').trim();
  if (!text || !translation) return null;

  const range = resolveItemRange(item, sourceText, text);
  if (!range) return null;
  if (type === 'word' && isSimpleWord(text)) return null;

  return {
    type,
    text,
    translation,
    difficulty: String(item?.difficulty ?? '').trim(),
    start: range.start,
    end: range.end,
  };
}

function normalizeSeparatedItems(items, sourceText, config) {
  const normalized = Array.from(items ?? [])
    .map((item) => normalizeAnalysisItem(item, sourceText))
    .filter(Boolean)
    .map((item) => withUsefulnessScore(item, config))
    .filter((item) => shouldKeepItem(item, config.userLevel, config));
  return dedupeLearningItems(normalized, {
    maxItems: Number.POSITIVE_INFINITY,
    config: {
      ...config,
      playbackFriendlyMode: false,
    },
  });
}

function normalizeStructuredAnalysisItem(item, sourceText, type) {
  const expression = String(item?.expression ?? item?.text ?? item?.term ?? '').trim();
  const surface = String(item?.surface ?? item?.text ?? expression).trim();
  const meaning = String(item?.meaning_zh ?? item?.translation ?? item?.meaning ?? item?.zh ?? '').trim();
  if (!expression || !meaning) return null;

  const range = resolveItemRange(item, sourceText, surface) ?? resolveItemRange(item, sourceText, expression);
  const completed = completeLearningItem({
    ...item,
    type,
    expression,
    surface,
    meaning_zh: meaning,
    example: String(item?.example ?? sourceText ?? '').trim(),
    source: {
      ...(item?.source ?? {}),
      subtitle: String(item?.source?.subtitle ?? sourceText ?? '').trim(),
    },
  });

  if (range) {
    completed.start = range.start;
    completed.end = range.end;
  }

  return completed;
}

export function normalizeLearningExpressionKey(text) {
  const tokens = String(text ?? '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9'\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length > 2 && LEADING_SUBJECTS.has(tokens[0])) {
    tokens.shift();
  }

  return tokens.map(lemmatizeToken).join(' ');
}

function isSimpleWord(text) {
  const key = normalizeLearningExpressionKey(text);
  return SIMPLE_WORDS.has(key);
}

function lemmatizeToken(token) {
  const value = String(token ?? '').trim();
  if (value.length <= 3) return value;
  if (value.endsWith('ies') && value.length > 4) return `${value.slice(0, -3)}y`;
  if (value.endsWith('ed') && value.length > 4) {
    const root = value.slice(0, -2);
    if (SIMPLE_WORDS.has(`${root}e`)) return `${root}e`;
    return root;
  }
  if (value.endsWith('es') && value.length > 4) {
    const root = value.slice(0, -2);
    if (SIMPLE_WORDS.has(root)) return root;
  }
  if (value.endsWith('s') && value.length > 4) return value.slice(0, -1);
  return value;
}

function resolveItemRange(item, sourceText, itemText) {
  const start = Number(item?.start);
  const end = Number(item?.end);
  if (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end > start &&
    end <= sourceText.length
  ) {
    const rangedText = sourceText.slice(start, end);
    if (rangedText.toLowerCase() === itemText.toLowerCase()) {
      return { start, end };
    }
  }

  const index = sourceText.toLowerCase().indexOf(itemText.toLowerCase());
  if (index === -1) return null;
  return { start: index, end: index + itemText.length };
}

function removeOverlappingItems(items) {
  const accepted = [];
  const candidates = [...items].sort(compareLearningItemPriority);

  for (const item of candidates) {
    if (accepted.some((existing) => item.start < existing.end && item.end > existing.start)) continue;
    accepted.push(item);
  }

  return accepted.sort((left, right) => left.start - right.start || left.end - right.end);
}

function compareLearningItemPriority(left, right) {
  return (
    getLearningTypePriority(left.type) - getLearningTypePriority(right.type) ||
    getExpressionLength(left) - getExpressionLength(right) ||
    left.start - right.start ||
    left.end - right.end
  );
}

function getLearningTypePriority(type) {
  if (type === 'pattern') return 0;
  if (type === 'phrasal_verb') return 1;
  if (type === 'idiom') return 2;
  if (type === 'phrase' || type === 'collocation') return 0;
  if (type === 'advanced_word' || type === 'word') return 1;
  if (type === 'named_entity') return 3;
  return 2;
}

function getExpressionLength(item) {
  return Math.max(0, Number(item?.end) - Number(item?.start));
}
