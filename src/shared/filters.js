import {
  AUXILIARY_OR_NEGATION,
  ADVANCED_WORDS,
  COMMON_NAMED_ENTITIES,
  extractionConfig,
  FRAGMENT_PATTERNS,
  LEVEL_ORDER,
  LOW_VALUE_SURFACE_WORDS,
  PRODUCT_TERMS,
  SIMPLE_WORDS,
  STRUCTURE_VALUE_ALLOWLIST,
  TECHNICAL_TERMS,
  UI_TERMS,
} from './learningRules.js';
import { normalizeTokenText } from './subtitleCleaner.js';
import {
  isProductTerm,
  isTechnicalTerm,
  isUiTerm,
  scoreUsefulness,
} from './scorer.js';

export function shouldKeepItem(item, userLevel = 'B2', {
  includeProperNouns = false,
  technicalMode = false,
  includeUiTerms = false,
  minUsefulnessScore = extractionConfig.minUsefulnessScore,
  simpleWords = SIMPLE_WORDS,
  namedEntities = COMMON_NAMED_ENTITIES,
} = {}) {
  const config = {
    ...extractionConfig,
    userLevel,
    includeProperNouns,
    technicalMode,
    includeUiTerms,
    minUsefulnessScore,
  };
  const type = String(item?.type ?? '').trim();
  const expression = String(item?.expression ?? item?.text ?? '').trim();
  const surface = String(item?.surface ?? expression).trim();
  const difficulty = normalizeLevel(item?.difficulty);
  const user = normalizeLevel(userLevel);
  const key = normalizeTokenText(expression);
  const surfaceKey = normalizeTokenText(surface);

  if (!type || !expression) return false;
  if (shouldRejectCandidate(item, config)) return false;
  if (type === 'named_entity') return Boolean(includeProperNouns);
  if (namedEntities.has(key) || namedEntities.has(surfaceKey)) return Boolean(includeProperNouns);
  if (isGluedToken(surface) || isGluedToken(expression)) return false;
  if (isFragment(expression) || isFragment(surface)) return false;
  if (isOnlyAuxiliaryOrNegation(key)) return false;

  if (type === 'advanced_word') {
    return isAdvancedWord(expression, item?.source?.subtitle || item?.example || surface, config) &&
      scoreUsefulness(item, config) >= minUsefulnessScore;
  }

  if (STRUCTURE_VALUE_ALLOWLIST.has(expression)) return scoreUsefulness(item, config) >= minUsefulnessScore;

  if (['pattern', 'phrasal_verb', 'collocation', 'idiom', 'technical_term'].includes(type)) {
    if (type === 'technical_term' && !technicalMode) return false;
    return (
      LEVEL_ORDER[difficulty] >= Math.max(LEVEL_ORDER.B2, LEVEL_ORDER[user] || LEVEL_ORDER.B2) &&
      scoreUsefulness(item, config) >= minUsefulnessScore
    );
  }

  if (type === 'word') {
    if (simpleWords.has(key)) return false;
    return LEVEL_ORDER[difficulty] >= LEVEL_ORDER.C1;
  }

  return false;
}

export function shouldRejectCandidate(candidate, config = extractionConfig) {
  const type = String(candidate?.type ?? '').trim();
  const expression = String(candidate?.expression ?? candidate?.text ?? '').trim();
  const surface = String(candidate?.surface ?? expression).trim();
  const key = normalizeTokenText(expression);
  const surfaceKey = normalizeTokenText(surface);

  if (!expression) return true;
  if ((isUiTerm(key) || isUiTerm(surfaceKey) || UI_TERMS.has(key) || UI_TERMS.has(surfaceKey)) && config.includeUiTerms !== true) return true;
  if (isProductTerm(key) || isProductTerm(surfaceKey) || PRODUCT_TERMS.has(key) || PRODUCT_TERMS.has(surfaceKey)) return true;
  if (type === 'technical_term' && config.technicalMode !== true) return true;
  if ((isTechnicalTerm(key) || isTechnicalTerm(surfaceKey) || TECHNICAL_TERMS.has(key) || TECHNICAL_TERMS.has(surfaceKey)) && config.technicalMode !== true) return true;
  if (
    key === 'add to sth' &&
    (containsAnyTerm(surfaceKey, UI_TERMS) || containsAnyTerm(surfaceKey, PRODUCT_TERMS) || /\bbutton\b/.test(surfaceKey))
  ) {
    return true;
  }
  if (LOW_VALUE_SURFACE_WORDS.has(key) || LOW_VALUE_SURFACE_WORDS.has(surfaceKey)) return type !== 'pattern' && type !== 'phrasal_verb';
  if (/^(?:enabled|placed)$/i.test(expression)) return true;
  if (/^(?:convert|activate|modify)$/i.test(expression) && type !== 'advanced_word') return true;
  return false;
}

export function isAdvancedWord(word, context = '', config = extractionConfig) {
  const key = normalizeTokenText(word);
  const contextKey = normalizeTokenText(context);
  if (!key) return false;
  if (SIMPLE_WORDS.has(key) || LOW_VALUE_SURFACE_WORDS.has(key)) return false;
  if (AUXILIARY_OR_NEGATION.has(key)) return false;
  if (COMMON_NAMED_ENTITIES.has(key)) return Boolean(config.includeProperNouns);
  if ((isProductTerm(key) || PRODUCT_TERMS.has(key) || contextKey.includes(`${key}.md`)) && config.technicalMode !== true) return false;
  if ((isUiTerm(key) || UI_TERMS.has(key)) && config.includeUiTerms !== true) return false;
  if ((isTechnicalTerm(key) || TECHNICAL_TERMS.has(key)) && config.technicalMode !== true) return false;
  const entry = ADVANCED_WORDS[key];
  if (!entry) return false;
  const difficulty = normalizeLevel(entry.difficulty);
  return LEVEL_ORDER[difficulty] >= LEVEL_ORDER.B2;
}

export function isFragment(text) {
  const value = String(text ?? '').trim();
  if (!value) return true;
  return FRAGMENT_PATTERNS.some((pattern) => pattern.test(value));
}

export function isSimpleWord(text) {
  return SIMPLE_WORDS.has(normalizeTokenText(text));
}

function normalizeLevel(level) {
  const value = String(level ?? 'B2').trim().toUpperCase();
  return LEVEL_ORDER[value] ? value : 'B2';
}

function isOnlyAuxiliaryOrNegation(key) {
  const tokens = String(key ?? '').split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => AUXILIARY_OR_NEGATION.has(token));
}

function isGluedToken(text) {
  const tokens = normalizeTokenText(text).split(/\s+/).filter(Boolean);
  return tokens.some((token) => (
    /(?:shouldn'thave|couldn'thave|bestif|youhave|flyingand)$/i.test(token) ||
    (token.length > 14 && /(?:and|have|if)$/.test(token) && !/^[a-z]+ing$/.test(token))
  ));
}

function containsAnyTerm(text, terms) {
  const value = normalizeTokenText(text);
  return Array.from(terms ?? []).some((term) => value.includes(term));
}
