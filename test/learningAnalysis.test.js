import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHighlightedTextParts,
  normalizeLearningExpressionKey,
  normalizeLearningAnalysis,
} from '../src/shared/learningAnalysis.js';

test('normalizeLearningAnalysis keeps structured phrase, collocation, and word highlights', () => {
  const result = normalizeLearningAnalysis({
    items: [
      { type: 'phrase', text: 'ready our defenses', translation: '准备好防御', difficulty: 'B2', start: 11, end: 29 },
      { type: 'collocation', text: 'come any moment', translation: '随时可能到来', difficulty: 'B2' },
      { type: 'other', text: 'ignored', translation: '忽略' },
    ],
  }, 'All right, ready our defenses! The Fire Nation could come any moment now.');

  assert.deepEqual(result.items, [
    { type: 'phrase', text: 'ready our defenses', translation: '准备好防御', difficulty: 'B2', start: 11, end: 29 },
    { type: 'collocation', text: 'come any moment', translation: '随时可能到来', difficulty: 'B2', start: 53, end: 68 },
  ]);
});

test('normalizeLearningAnalysis falls back to text search when offsets do not match item text', () => {
  const result = normalizeLearningAnalysis({
    items: [
      { type: 'phrase', text: 'All right', translation: '好的，行了', difficulty: 'B2', start: 0, end: 1 },
      { type: 'collocation', text: 'ready our defenses', translation: '准备我们的防御', difficulty: 'B2', start: 1, end: 3 },
      { type: 'phrase', text: 'any moment now', translation: '马上，很快', difficulty: 'B2', start: 6, end: 8 },
    ],
  }, 'All right, ready our defenses! The Fire Nation could come any moment now.');

  assert.deepEqual(result.items, [
    { type: 'phrase', text: 'All right', translation: '好的，行了', difficulty: 'B2', start: 0, end: 9 },
    { type: 'collocation', text: 'ready our defenses', translation: '准备我们的防御', difficulty: 'B2', start: 11, end: 29 },
    { type: 'phrase', text: 'any moment now', translation: '马上，很快', difficulty: 'B2', start: 58, end: 72 },
  ]);
});

test('normalizeLearningAnalysis does not require Array.prototype.toSorted', () => {
  const originalToSorted = Array.prototype.toSorted;
  try {
    // Chrome extension pages can lag behind the Node runtime used by tests.
    delete Array.prototype.toSorted;
    const result = normalizeLearningAnalysis({
      items: [
        { type: 'word', text: 'warship', translation: '战舰', difficulty: 'B2' },
      ],
    }, "There's no way we're gonna catch a warship with a canoe.");

    assert.deepEqual(result.items, [
      { type: 'word', text: 'warship', translation: '战舰', difficulty: 'B2', start: 35, end: 42 },
    ]);
  } finally {
    if (originalToSorted) {
      Array.prototype.toSorted = originalToSorted;
    }
  }
});

test('normalizeLearningAnalysis prefers focused phrases over longer repeated translations', () => {
  const result = normalizeLearningAnalysis({
    items: [
      { type: 'phrase', text: 'being raised by monks', translation: '被僧侣抚养', difficulty: 'B2' },
      { type: 'phrase', text: 'being raised', translation: '被养育', difficulty: 'B2' },
    ],
  }, 'And I never knew about being raised by monks.');

  assert.deepEqual(result.items, [
    { type: 'phrase', text: 'being raised', translation: '被养育', difficulty: 'B2', start: 23, end: 35 },
  ]);
});

test('normalizeLearningAnalysis prefers phrases over single words inside the same expression', () => {
  const result = normalizeLearningAnalysis({
    items: [
      { type: 'word', text: 'raised', translation: '养育', difficulty: 'B1' },
      { type: 'phrase', text: 'being raised', translation: '被养育', difficulty: 'B2' },
    ],
  }, 'And I never knew about being raised by monks.');

  assert.deepEqual(result.items, [
    { type: 'phrase', text: 'being raised', translation: '被养育', difficulty: 'B2', start: 23, end: 35 },
  ]);
});

test('normalizeLearningAnalysis drops simple attention-wasting words', () => {
  const result = normalizeLearningAnalysis({
    items: [
      { type: 'word', text: 'save', translation: '拯救', difficulty: 'B2' },
      { type: 'word', text: 'escaped', translation: '逃脱', difficulty: 'B2' },
      { type: 'word', text: 'warship', translation: '战舰', difficulty: 'B2' },
    ],
  }, 'Aang escaped to save the warship.');

  assert.deepEqual(result.items, [
    { type: 'word', text: 'warship', translation: '战舰', difficulty: 'B2', start: 25, end: 32 },
  ]);
});

test('normalizeLearningExpressionKey groups subject and inflection variants', () => {
  assert.equal(normalizeLearningExpressionKey('we need your help'), 'need your help');
  assert.equal(normalizeLearningExpressionKey('needs your help'), 'need your help');
  assert.equal(normalizeLearningExpressionKey('Riding them!'), 'riding them');
});

test('buildHighlightedTextParts maps analysis items back to subtitle text', () => {
  const parts = buildHighlightedTextParts(
    'All right, ready our defenses! The Fire Nation could come any moment now.',
    [
      { type: 'phrase', text: 'ready our defenses', translation: '准备好防御', start: 11, end: 29 },
      { type: 'collocation', text: 'come any moment', translation: '随时可能到来', start: 53, end: 68 },
    ],
  );

  assert.deepEqual(parts, [
    { text: 'All right, ', highlight: null },
    { text: 'ready our defenses', highlight: { type: 'phrase', translation: '准备好防御' } },
    { text: '! The Fire Nation could ', highlight: null },
    { text: 'come any moment', highlight: { type: 'collocation', translation: '随时可能到来' } },
    { text: ' now.', highlight: null },
  ]);
});
