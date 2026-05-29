import {
  ADVANCED_WORDS,
  NORMALIZATION_RULES,
} from './learningRules.js';
import {
  cleanSubtitleText,
  normalizeTokenText,
} from './subtitleCleaner.js';

export function normalizeExpression(surface, {
  subtitle = surface,
  time = '',
  source = {},
  rules = NORMALIZATION_RULES,
} = {}) {
  const cleanedSurface = cleanSubtitleText(surface);
  const subtitleText = cleanSubtitleText(subtitle || cleanedSurface);
  if (!cleanedSurface) return null;

  const rule = rules.find((candidate) => matchesRule(candidate, cleanedSurface));
  if (!rule) return normalizeAdvancedWord(cleanedSurface, { subtitle: subtitleText, time, source });

  const matchedSurface = extractRuleSurface(rule, cleanedSurface) || cleanedSurface;
  return completeLearningItem({
    type: rule.type,
    expression: rule.expression,
    surface: matchedSurface,
    meaning_zh: rule.meaning_zh,
    structure: rule.structure,
    difficulty: rule.difficulty,
    why_useful: rule.why_useful,
    example: subtitleText || matchedSurface,
    example_zh: rule.example_zh || '',
    time,
    source,
  });
}

export function normalizeToPattern(surface, subtitle = surface, options = {}) {
  const item = normalizeExpression(surface, {
    ...options,
    subtitle,
  });
  return item?.type === 'pattern' ? item : null;
}

export function completeLearningItem(item) {
  const type = String(item?.type ?? '').trim();
  const expression = String(item?.expression ?? '').trim();
  const surface = String(item?.surface ?? expression).trim();
  const meaning = String(item?.meaning_zh ?? item?.translation ?? item?.meaning ?? '').trim();
  const example = String(item?.example ?? item?.subtitle ?? surface).trim();
  const source = normalizeSource(item?.source, example);
  const completed = {
    id: String(item?.id ?? stableLearningItemId(expression, type)),
    time: String(item?.time ?? ''),
    type,
    expression,
    surface,
    meaning_zh: meaning,
    structure: String(item?.structure ?? '').trim(),
    difficulty: String(item?.difficulty ?? 'B2').trim() || 'B2',
    why_useful: String(item?.why_useful ?? '').trim(),
    example,
    example_zh: String(item?.example_zh ?? '').trim(),
    source,
    exportable: item?.exportable !== false,
    examples: Array.isArray(item?.examples) ? Array.from(item.examples) : undefined,
    usefulnessScore: Number.isFinite(Number(item?.usefulnessScore)) ? Number(item.usefulnessScore) : undefined,
    start: Number.isFinite(Number(item?.start)) ? Number(item.start) : undefined,
    end: Number.isFinite(Number(item?.end)) ? Number(item.end) : undefined,
    text: expression,
    translation: meaning,
  };

  return completed;
}

export function stableLearningItemId(expression, type) {
  const key = `${String(type ?? '').trim().toLowerCase()}:${normalizeTokenText(expression)}`;
  let hash = 5381;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) + hash) ^ key.charCodeAt(index);
  }
  return `li_${(hash >>> 0).toString(36)}`;
}

function matchesRule(rule, surface) {
  const target = cleanSubtitleText(surface);
  if (rule.surfacePattern) return rule.surfacePattern.test(target);
  return rule.pattern.test(target);
}

function extractRuleSurface(rule, surface) {
  const target = cleanSubtitleText(surface);
  const pattern = rule.surfacePattern ?? rule.pattern;
  const match = target.match(pattern);
  return match?.[0]?.trim() ?? '';
}

function normalizeAdvancedWord(surface, { subtitle, time, source }) {
  const key = normalizeTokenText(surface);
  const entry = ADVANCED_WORDS[key];
  if (!entry) return null;

  return completeLearningItem({
    ...entry,
    type: 'advanced_word',
    surface,
    example: subtitle || surface,
    example_zh: '',
    time,
    source,
  });
}

function normalizeSource(source, subtitle) {
  const value = source && typeof source === 'object' ? source : {};
  return {
    site: String(value.site ?? '').trim(),
    url: String(value.url ?? '').trim(),
    subtitle: String(value.subtitle ?? subtitle ?? '').trim(),
  };
}
