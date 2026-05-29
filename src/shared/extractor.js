import {
  ADVANCED_WORDS,
  extractionConfig,
  NORMALIZATION_RULES,
  TECHNICAL_TERMS,
} from './learningRules.js';
import { selectItemsByIntensity } from './deduper.js';
import { getExtractionConfigFromIntensity } from './extractionIntensity.js';
import { shouldKeepItem } from './filters.js';
import { normalizeExpression, completeLearningItem } from './normalizer.js';
import { withUsefulnessScore } from './scorer.js';
import {
  cleanSubtitleText,
  detectNamedEntities,
  normalizeTokenText,
} from './subtitleCleaner.js';

export function extractCandidateLearningItems({
  text,
  time = '',
  source = {},
  rules = NORMALIZATION_RULES,
  config = extractionConfig,
} = {}) {
  const subtitle = cleanSubtitleText(text);
  if (!subtitle) return [];

  const sourceInfo = {
    site: String(source?.site ?? '').trim(),
    url: String(source?.url ?? '').trim(),
    subtitle,
  };

  const candidates = [];
  for (const rule of rules) {
    const match = findRuleMatch(rule, subtitle);
    if (!match) continue;
    const item = normalizeExpression(match.surface, {
      subtitle,
      time,
      source: sourceInfo,
      rules: [rule],
    });
    if (item) candidates.push({ ...item, start: match.start, end: match.end });
  }

  candidates.push(...extractAdvancedWords(subtitle, { time, source: sourceInfo }));
  if (config.technicalMode === true) {
    candidates.push(...extractTechnicalTerms(subtitle, { time, source: sourceInfo }));
  }
  candidates.push(...detectNamedEntities(subtitle).map((entity) => completeLearningItem({
    ...entity,
    meaning_zh: '专有名词',
    structure: 'proper noun',
    difficulty: 'B2',
    why_useful: '剧情、人物或组织识别；默认不导出。',
    example: subtitle,
    example_zh: '',
    time,
    source: sourceInfo,
    exportable: false,
  })));

  return candidates;
}

export function analyzeSubtitleLearningItems({
  text,
  time = '',
  source = {},
  userLevel = 'B2',
  includeProperNouns = false,
  technicalMode = false,
  includeUiTerms = false,
  preferPatternsOverWords = true,
  minUsefulnessScore,
  maxItemsPerSubtitle = extractionConfig.maxItemsPerSubtitleLine,
  intensity = extractionConfig.intensity,
} = {}) {
  const intensityConfig = getExtractionConfigFromIntensity(intensity);
  const config = {
    ...extractionConfig,
    ...intensityConfig,
    userLevel,
    includeProperNouns,
    technicalMode,
    includeUiTerms,
    preferPatternsOverWords,
    minUsefulnessScore: Number.isFinite(Number(minUsefulnessScore))
      ? Number(minUsefulnessScore)
      : Math.min(intensityConfig.minStructureScore, intensityConfig.minAdvancedWordScore),
    maxItemsPerSubtitle,
    maxItemsPerSubtitleLine: maxItemsPerSubtitle,
  };
  const candidates = extractCandidateLearningItems({ text, time, source, config });
  const kept = candidates
    .map((item) => withUsefulnessScore(item, config))
    .filter((item) => shouldKeepItem(item, userLevel, config))
    .map((item) => (
      includeProperNouns && item.type === 'named_entity'
        ? { ...item, exportable: true }
        : item
    ));
  const selected = selectItemsByIntensity(kept, config);
  return {
    ...selected,
    items: selected.realtimeItems,
  };
}

function findRuleMatch(rule, subtitle) {
  const pattern = rule.surfacePattern ?? rule.pattern;
  const match = subtitle.match(pattern);
  if (!match?.[0]) return null;
  return {
    surface: match[0].trim(),
    start: match.index,
    end: match.index + match[0].length,
  };
}

function extractAdvancedWords(subtitle, { time, source }) {
  const seen = new Set();
  const items = [];
  const words = subtitle.matchAll(/\b[A-Za-z][A-Za-z'-]*\b/g);
  for (const match of words) {
    const surface = match[0];
    const key = normalizeTokenText(surface);
    const entry = ADVANCED_WORDS[key];
    if (!entry || seen.has(entry.expression)) continue;
    seen.add(entry.expression);
    items.push(completeLearningItem({
      ...entry,
      type: 'advanced_word',
      surface,
      example: subtitle,
      example_zh: '',
      time,
      source,
      start: match.index,
      end: match.index + surface.length,
    }));
  }
  return items;
}

function extractTechnicalTerms(subtitle, { time, source }) {
  const normalizedSubtitle = normalizeTokenText(subtitle);
  const items = [];
  for (const term of TECHNICAL_TERMS) {
    const index = normalizedSubtitle.indexOf(term);
    if (index < 0) continue;
    items.push(completeLearningItem({
      type: 'technical_term',
      expression: term,
      surface: findOriginalSurface(subtitle, term),
      meaning_zh: '技术术语；仅在技术模式下导出',
      structure: 'technical term',
      difficulty: 'B2',
      why_useful: '适合学习软件或技术主题字幕时识别专门术语。',
      example: subtitle,
      example_zh: '',
      time,
      source,
      start: index,
      end: index + term.length,
    }));
  }
  return items;
}

function findOriginalSurface(subtitle, normalizedTerm) {
  const escaped = normalizedTerm
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  const match = subtitle.match(new RegExp(`\\b${escaped}\\b`, 'i'));
  return match?.[0] ?? normalizedTerm;
}
