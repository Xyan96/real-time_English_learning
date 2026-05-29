import {
  COMMON_NAMED_ENTITIES,
  GLUED_TOKEN_REPAIRS,
} from './learningRules.js';

export function cleanSubtitleText(text, {
  gluedTokenRepairs = GLUED_TOKEN_REPAIRS,
} = {}) {
  let value = String(text ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  for (const repair of gluedTokenRepairs) {
    value = value.replace(repair.pattern, repair.replacement);
  }

  return value
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([,.!?;:])(?=[^\s,.!?;:])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTokenText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9'\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectNamedEntities(text, {
  knownEntities = COMMON_NAMED_ENTITIES,
} = {}) {
  const source = cleanSubtitleText(text);
  const found = [];
  const seen = new Set();

  for (const entity of knownEntities) {
    const escaped = escapeRegExp(entity);
    const pattern = new RegExp(`\\b${escaped.replace(/\s+/g, '\\s+')}\\b`, 'gi');
    for (const match of source.matchAll(pattern)) {
      const surface = match[0];
      const key = normalizeTokenText(surface);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        type: 'named_entity',
        expression: surface,
        surface,
        start: match.index,
        end: match.index + surface.length,
      });
    }
  }

  const capitalizedPhrasePattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
  for (const match of source.matchAll(capitalizedPhrasePattern)) {
    const surface = match[0];
    const key = normalizeTokenText(surface);
    if (seen.has(key) || isLikelySentenceInitialCommonWord(surface, match.index)) continue;
    seen.add(key);
    found.push({
      type: 'named_entity',
      expression: surface,
      surface,
      start: match.index,
      end: match.index + surface.length,
    });
  }

  return found.sort((left, right) => left.start - right.start || left.end - right.end);
}

export function containsGluedTokenError(text) {
  const normalized = normalizeTokenText(text);
  return GLUED_TOKEN_REPAIRS.some((repair) => {
    const probe = String(repair.pattern).replace(/^\/\\b|\\b\/gi$/g, '');
    return probe && normalized.includes(probe.replace(/\\/g, ''));
  });
}

function isLikelySentenceInitialCommonWord(surface, index) {
  if (index !== 0) return false;
  return /^(?:I|Well|Grandmother|Would|Not|The|A|An|It|I'm)$/i.test(surface);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
