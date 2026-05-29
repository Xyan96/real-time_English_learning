import {
  extractionConfig,
  extractionQuota,
  LEVEL_ORDER,
  TYPE_PRIORITY,
} from './learningRules.js';
import {
  isFragment,
  shouldRejectCandidate,
} from './filters.js';
import { completeLearningItem } from './normalizer.js';
import { withUsefulnessScore } from './scorer.js';
import { cleanSubtitleText, normalizeTokenText } from './subtitleCleaner.js';

export function dedupeLearningItems(items, {
  maxItems = Number.POSITIVE_INFINITY,
  config = extractionConfig,
} = {}) {
  const prepared = Array.from(items ?? [])
    .filter(Boolean)
    .map((item) => completeLearningItem(item))
    .filter((item) => !shouldRejectCandidate(item, config))
    .filter((item) => !isFragment(item.expression) && !isFragment(item.surface))
    .filter((item) => item.expression && item.type);

  const byExpression = new Map();
  for (const item of prepared) {
    const key = `${item.type}:${normalizeTokenText(item.expression)}`;
    const existing = byExpression.get(key);
    if (!existing) {
      byExpression.set(key, withExampleList(item));
      continue;
    }
    mergeExamples(existing, item);
    if (getItemScore(item) < getItemScore(existing)) {
      Object.assign(existing, {
        ...item,
        examples: existing.examples,
      });
    }
  }

  const candidates = Array.from(byExpression.values()).sort(compareLearningItems);
  const accepted = [];

  for (const item of candidates) {
    if (accepted.some((existing) => shouldSuppressAsContained(item, existing))) continue;
    accepted.push(item);
  }

  const selected = config.playbackFriendlyMode === false
    ? accepted.sort(compareLearningItems).slice(0, maxItems)
    : selectTopItemsForSubtitleLine(accepted, {
      ...config,
      maxItemsPerSubtitleLine: Math.min(
        Number.isFinite(maxItems) ? maxItems : Number.POSITIVE_INFINITY,
        Number(config.maxItemsPerSubtitleLine ?? extractionQuota.maxTotalPerSubtitle) || extractionQuota.maxTotalPerSubtitle,
      ),
    });

  return selected
    .sort(compareLearningItems)
    .map((item) => ({
      ...item,
      examples: item.examples ?? [{ text: item.example, zh: item.example_zh }],
    }));
}

export function selectTopItemsForSubtitleLine(items, config = extractionConfig) {
  const maxTotal = Math.max(1, Number(config.maxItemsPerSubtitleLine ?? extractionQuota.maxTotalPerSubtitle) || 2);
  const maxStructure = Math.max(0, Number(config.maxStructureItemsPerLine ?? extractionQuota.maxPatternsPerSubtitle) || 1);
  const maxVocabulary = config.allowAdvancedWords === false
    ? 0
    : Math.max(0, Number(config.maxVocabularyItemsPerLine ?? extractionQuota.maxAdvancedWordsPerSubtitle) || 1);
  const filtered = Array.from(items ?? [])
    .filter(Boolean)
    .map((item) => completeLearningItem(item))
    .filter((item) => !shouldRejectCandidate(item, config))
    .filter((item) => item.type !== 'technical_term' || config.technicalMode === true)
    .filter((item) => item.type !== 'named_entity' || config.includeProperNouns === true || item.exportable === true)
    .filter((item) => !isFragment(item.expression) && !isFragment(item.surface))
    .sort(compareByPlaybackValue);

  const structureItems = filtered.filter(isStructureItem);
  const vocabularyItems = filtered.filter((item) => item.type === 'advanced_word');
  const technicalItems = filtered.filter((item) => item.type === 'technical_term' && config.technicalMode === true);
  const otherItems = filtered.filter((item) => (
    !isStructureItem(item) &&
    item.type !== 'advanced_word' &&
    item.type !== 'technical_term'
  ));
  const selected = [];

  if (structureItems.length > 0 && maxStructure > 0) {
    addFirstNonOverlapping(selected, structureItems);
  }
  if (vocabularyItems.length > 0 && maxVocabulary > 0 && selected.length < maxTotal) {
    addFirstNonOverlapping(selected, vocabularyItems);
  }

  const fallbackGroups = structureItems.length === 0
    ? [vocabularyItems, technicalItems, otherItems]
    : vocabularyItems.length === 0
      ? [structureItems, technicalItems, otherItems]
      : [structureItems, vocabularyItems, technicalItems, otherItems];

  for (const group of fallbackGroups) {
    for (const item of group) {
      if (selected.length >= maxTotal) break;
      if (selected.includes(item)) continue;
      if (selected.some((existing) => rangesOverlap(item, existing))) continue;
      const structureCount = selected.filter(isStructureItem).length;
      const vocabularyCount = selected.filter((candidate) => candidate.type === 'advanced_word').length;
      if (isStructureItem(item) && structureItems.length > 0 && vocabularyItems.length > 0 && structureCount >= maxStructure) continue;
      if (item.type === 'advanced_word' && structureItems.length > 0 && vocabularyItems.length > 0 && vocabularyCount >= maxVocabulary) continue;
      selected.push(item);
    }
  }

  return selected.sort(compareLearningItems).slice(0, maxTotal);
}

export function selectItemsByIntensity(items, config = extractionConfig) {
  const effectiveConfig = {
    ...extractionConfig,
    ...config,
    includeProperNouns: config.allowProperNouns === true || config.includeProperNouns === true,
    includeUiTerms: config.includeUiTerms === true,
    technicalMode: config.technicalMode === true || Number(config.intensity) > 80,
  };
  const cleaned = cleanCandidatesForIntensity(items, effectiveConfig);
  const structureItems = cleaned.filter(isStructureAllowedForIntensity);
  const vocabularyItems = cleaned.filter((item) => item.type === 'advanced_word');
  const technicalItems = cleaned.filter((item) => item.type === 'technical_term');
  const properNounItems = cleaned.filter((item) => item.type === 'named_entity');

  return {
    realtimeItems: selectRealtimeItems({
      structureItems,
      vocabularyItems,
      technicalItems,
      properNounItems,
      maxItems: effectiveConfig.realtimeMaxItemsPerLine ?? effectiveConfig.maxItemsPerSubtitleLine ?? 2,
    }),
    exportItems: selectExportItems({
      structureItems,
      vocabularyItems,
      technicalItems,
      properNounItems,
      maxItems: effectiveConfig.exportMaxItemsPerLine ?? effectiveConfig.maxItemsPerSubtitle ?? 4,
    }),
  };
}

export function compareLearningItems(left, right) {
  if (left?.type === 'named_entity' && right?.type === 'named_entity') {
    return normalizeTokenText(left.expression).localeCompare(normalizeTokenText(right.expression));
  }
  return (
    getItemScore(left) - getItemScore(right) ||
    getItemStart(left) - getItemStart(right) ||
    getUsefulnessScore(right) - getUsefulnessScore(left) ||
    normalizeTokenText(left.expression).localeCompare(normalizeTokenText(right.expression))
  );
}

function shouldSuppressAsContained(item, existing) {
  if (!sameSubtitle(item, existing)) return false;
  const itemSurface = normalizeComparable(item.surface || item.expression);
  const existingSurface = normalizeComparable(existing.surface || existing.expression);
  const itemExpression = normalizeComparable(item.expression);
  const existingExpression = normalizeComparable(existing.expression);

  const contained = (
    (existingSurface && itemSurface && existingSurface.includes(itemSurface)) ||
    (itemSurface && existingSurface && itemSurface.includes(existingSurface)) ||
    (existingExpression && itemExpression && existingExpression.includes(itemExpression)) ||
    (itemExpression && existingExpression && itemExpression.includes(existingExpression))
  );
  if (!contained) return false;

  if (
    item.type === 'pattern' &&
    existing.type === 'pattern' &&
    normalizeTokenText(item.expression) !== normalizeTokenText(existing.expression)
  ) {
    return false;
  }
  if (
    item.type === 'phrasal_verb' &&
    existing.type === 'pattern' &&
    !existingExpression.includes(itemExpression)
  ) {
    return false;
  }
  if (item.type === 'technical_term' && existing.type === 'pattern') {
    return false;
  }
  if (item.type === 'advanced_word' && existing.type === 'collocation') {
    return false;
  }
  if (item.type === 'advanced_word' && existing.type === 'idiom') {
    return true;
  }
  if (
    item.type === 'advanced_word' &&
    ['pattern', 'phrasal_verb'].includes(existing.type) &&
    existingExpression.includes(itemExpression)
  ) {
    return true;
  }
  if (item.type === 'advanced_word' && ['pattern', 'phrasal_verb'].includes(existing.type)) {
    return false;
  }

  const existingScore = getItemScore(existing);
  const itemScore = getItemScore(item);
  if (existingScore < itemScore) return true;
  if (existingScore === itemScore) {
    if (getUsefulnessScore(existing) !== getUsefulnessScore(item)) {
      return getUsefulnessScore(existing) >= getUsefulnessScore(item);
    }
    return existingExpression.length >= itemExpression.length;
  }
  return false;
}

function addFirstNonOverlapping(selected, candidates) {
  for (const item of candidates) {
    if (selected.some((existing) => rangesOverlap(item, existing))) continue;
    selected.push(item);
    return true;
  }
  return false;
}

function compareByPlaybackValue(left, right) {
  return (
    getUsefulnessScore(right) - getUsefulnessScore(left) ||
    getItemScore(left) - getItemScore(right) ||
    getItemStart(left) - getItemStart(right) ||
    normalizeTokenText(left.expression).localeCompare(normalizeTokenText(right.expression))
  );
}

function cleanCandidatesForIntensity(items, config) {
  const prepared = Array.from(items ?? [])
    .filter(Boolean)
    .map((item) => withUsefulnessScore(completeLearningItem(item), config))
    .filter((item) => isTypeAllowedByIntensity(item, config))
    .filter((item) => !shouldRejectCandidate(item, config))
    .filter((item) => !isFragment(item.expression) && !isFragment(item.surface))
    .filter((item) => passesIntensityScore(item, config));

  return dedupeLearningItems(prepared, {
    maxItems: Number.POSITIVE_INFINITY,
    config: {
      ...config,
      playbackFriendlyMode: false,
      maxItemsPerSubtitleLine: Number.POSITIVE_INFINITY,
    },
  }).sort(compareByPlaybackValue);
}

function isTypeAllowedByIntensity(item, config) {
  if (item.type === 'named_entity') return config.allowProperNouns === true || config.includeProperNouns === true;
  if (item.type === 'technical_term') return config.allowTechnicalTerms !== false && config.technicalMode === true;
  if (item.type === 'advanced_word') {
    if (config.allowAdvancedWords === false) return false;
    if (config.allowB2Words === false && !isC1OrHigher(item) && !isHighValueB2LexicalizedItem(item)) return false;
    return true;
  }
  if (item.type === 'collocation') return config.allowCollocations !== false;
  if (item.type === 'idiom') return config.allowIdioms !== false;
  if (item.type === 'pattern') return config.allowPatterns !== false;
  if (item.type === 'phrasal_verb') return config.allowPhrasalVerbs !== false;
  return false;
}

function passesIntensityScore(item, config) {
  const score = getUsefulnessScore(item);
  if (isStructureItem(item)) return score >= Number(config.minStructureScore ?? extractionConfig.minUsefulnessScore);
  if (item.type === 'advanced_word') return score >= Number(config.minAdvancedWordScore ?? extractionConfig.minUsefulnessScore);
  if (item.type === 'technical_term') return score >= Number(config.minStructureScore ?? extractionConfig.minUsefulnessScore);
  if (item.type === 'named_entity') return config.allowProperNouns === true || config.includeProperNouns === true;
  return false;
}

function selectRealtimeItems({ structureItems, vocabularyItems, technicalItems, properNounItems, maxItems }) {
  const maxTotal = Math.max(1, Number(maxItems) || 2);
  const selected = [];

  addFirstNonOverlapping(selected, structureItems);
  if (selected.length < maxTotal) addFirstNonOverlapping(selected, vocabularyItems);

  const fallbackGroups = selected.some((item) => item.type === 'advanced_word')
    ? [structureItems, technicalItems]
    : selected.some(isStructureItem)
      ? [vocabularyItems, structureItems, technicalItems, properNounItems]
      : [vocabularyItems, structureItems, technicalItems, properNounItems];

  fillSelectedItems(selected, fallbackGroups, maxTotal);
  return orderSelectedItems(selected.slice(0, maxTotal));
}

function selectExportItems({ structureItems, vocabularyItems, technicalItems, properNounItems, maxItems }) {
  const maxTotal = Math.max(1, Number(maxItems) || 4);
  const selected = [];
  addFirstNonOverlapping(selected, structureItems);
  fillSelectedItems(selected, [vocabularyItems, structureItems, technicalItems, properNounItems], maxTotal);
  return orderSelectedItems(selected.slice(0, maxTotal));
}

function fillSelectedItems(selected, groups, maxTotal) {
  for (const group of groups) {
    for (const item of group) {
      if (selected.length >= maxTotal) return selected;
      if (selected.includes(item)) continue;
      if (selected.some((existing) => rangesOverlap(item, existing))) continue;
      selected.push(item);
    }
  }
  return selected;
}

function isStructureAllowedForIntensity(item) {
  return isStructureItem(item);
}

function isC1OrHigher(item) {
  const difficulty = String(item?.difficulty ?? '').trim().toUpperCase();
  return (LEVEL_ORDER[difficulty] || 0) >= LEVEL_ORDER.C1;
}

function isHighValueB2LexicalizedItem(item) {
  const difficulty = String(item?.difficulty ?? '').trim().toUpperCase();
  const expression = String(item?.expression ?? '');
  return difficulty === 'B2' && /[-\s]/.test(expression) && getUsefulnessScore(item) >= 8;
}

function orderSelectedItems(items) {
  if (items.every((item) => item.type === 'named_entity')) {
    return items.sort(compareLearningItems);
  }
  return items;
}

function isStructureItem(item) {
  return ['pattern', 'idiom', 'phrasal_verb', 'collocation'].includes(item?.type);
}

function rangesOverlap(left, right) {
  const leftStart = Number(left?.start);
  const leftEnd = Number(left?.end);
  const rightStart = Number(right?.start);
  const rightEnd = Number(right?.end);
  if (![leftStart, leftEnd, rightStart, rightEnd].every(Number.isFinite)) return false;
  return leftStart < rightEnd && rightStart < leftEnd;
}

function sameSubtitle(left, right) {
  const leftSubtitle = cleanSubtitleText(left?.source?.subtitle || left?.example || '');
  const rightSubtitle = cleanSubtitleText(right?.source?.subtitle || right?.example || '');
  return Boolean(leftSubtitle && rightSubtitle && leftSubtitle === rightSubtitle);
}

function getItemScore(item) {
  return TYPE_PRIORITY[item?.type] ?? 99;
}

function getUsefulnessScore(item) {
  const score = Number(item?.usefulnessScore);
  return Number.isFinite(score) ? score : 0;
}

function getItemStart(item) {
  const start = Number(item?.start);
  return Number.isFinite(start) ? start : Number.MAX_SAFE_INTEGER;
}

function normalizeComparable(text) {
  return normalizeTokenText(text).replace(/\bsb\b/g, '').replace(/\bsth\b/g, '').replace(/\b[ab]\b/g, '').replace(/\s+/g, ' ').trim();
}

function withExampleList(item) {
  const examples = Array.from(item.examples ?? []);
  if (item.example && !examples.some((example) => example.text === item.example)) {
    examples.push({ text: item.example, zh: item.example_zh });
  }
  return { ...item, examples };
}

function mergeExamples(target, item) {
  target.examples = Array.from(target.examples ?? []);
  const text = String(item.example ?? '').trim();
  if (text && !target.examples.some((example) => example.text === text)) {
    target.examples.push({ text, zh: String(item.example_zh ?? '').trim() });
  }
}
