import {
  ADVANCED_WORDS,
  LEVEL_ORDER,
  FRAGMENT_PATTERNS,
  LOW_VALUE_SURFACE_WORDS,
  PRODUCT_TERMS,
  SIMPLE_WORDS,
  STRUCTURE_VALUE_ALLOWLIST,
  TECHNICAL_TERMS,
  UI_TERMS,
} from './learningRules.js';
import { normalizeTokenText } from './subtitleCleaner.js';

const PREPOSITION_PATTERN = /\b(?:relative to|from|with|on|into|to|in|over|under)\b/i;
const EASILY_MISUNDERSTOOD = new Set([
  'be enabled in sth',
  'be placed on sth',
  'choose A over B',
  "it's best if ...",
  'let sb do sth',
  'look forward to sth / doing sth',
  'not work with sth',
  'position A relative to B',
  'protect sb from sth',
  'relative to sth',
  'run sth from somewhere',
  'add to sth',
  'convert A into B',
  'scratch the surface',
  'under the disguise',
  'visual thinking',
]);

export function scoreUsefulness(item, config = {}) {
  let score = 0;
  const type = String(item?.type ?? '');
  const expression = String(item?.expression ?? '').trim();
  const surface = String(item?.surface ?? expression).trim();
  const key = normalizeTokenText(expression);
  const surfaceKey = normalizeTokenText(surface);

  if (type === 'pattern') score += 4;
  if (type === 'phrasal_verb') score += 3;
  if (type === 'collocation') score += 3;
  if (type === 'idiom') score += 5;
  if (type === 'advanced_word') {
    const levelScore = LEVEL_ORDER[String(item?.difficulty ?? '').toUpperCase()] || 0;
    if (levelScore >= LEVEL_ORDER.C1) score += 5;
    else if (levelScore >= LEVEL_ORDER.B2) score += 5;
    if (ADVANCED_WORDS[key]) score += 1;
    if (/[-\s]/.test(expression)) score += 1;
  }
  if (type === 'technical_term' && config.technicalMode === true) score += 7;
  if (STRUCTURE_VALUE_ALLOWLIST.has(expression)) score += 1;
  if (EASILY_MISUNDERSTOOD.has(expression)) score += 2;
  if (PREPOSITION_PATTERN.test(`${expression} ${surface}`)) score += 2;
  if (String(item?.example ?? '').trim()) score += 1;

  if (isUiTerm(key) || isUiTerm(surfaceKey)) score -= 5;
  if (isProductTerm(key) || isProductTerm(surfaceKey)) score -= 5;
  if (isSimpleWord(expression) || LOW_VALUE_SURFACE_WORDS.has(key)) score -= 4;
  if (/^[a-z]+(?:ed|ing)?$/i.test(expression) && type !== 'advanced_word') score -= 4;
  if (isFragment(expression) || isFragment(surface)) score -= 3;
  if (type === 'technical_term' && config.technicalMode !== true) score -= 5;
  if ((type === 'technical_term' || isTechnicalTerm(key) || isTechnicalTerm(surfaceKey)) && config.technicalMode !== true) score -= 2;

  return Math.max(0, Math.min(10, score));
}

export function withUsefulnessScore(item, config = {}) {
  return {
    ...item,
    usefulnessScore: scoreUsefulness(item, config),
  };
}

export function isUiTerm(text) {
  return UI_TERMS.has(normalizeTokenText(text));
}

export function isProductTerm(text) {
  return PRODUCT_TERMS.has(normalizeTokenText(text));
}

export function isTechnicalTerm(text) {
  return TECHNICAL_TERMS.has(normalizeTokenText(text));
}

function isSimpleWord(text) {
  return SIMPLE_WORDS.has(normalizeTokenText(text));
}

function isFragment(text) {
  const value = String(text ?? '').trim();
  if (!value) return true;
  return FRAGMENT_PATTERNS.some((pattern) => pattern.test(value));
}
