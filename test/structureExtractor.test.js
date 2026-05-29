import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeSubtitleLearningItems,
  dedupeLearningItems,
  getExtractionConfigFromIntensity,
  normalizeExportableLearningItems,
  normalizeExpression,
  selectItemsByIntensity,
  selectTopItemsForSubtitleLine,
  shouldKeepItem,
} from '../src/shared/learningAnalysis.js';

const source = {
  site: 'Netflix',
  url: 'https://www.netflix.com/watch/example',
};

test('analyzeSubtitleLearningItems extracts reusable structures from subtitle examples', () => {
  const subtitles = [
    "Well, I couldn't let you have all the glory.",
    "Grandmother, please, don't let Sokka do this.",
    "I'm protecting you from threats like him.",
    'Not looking forward to that.',
    'Would you really choose him over your tribe?',
    "I think it's best if the airbender leaves.",
  ];

  const items = subtitles.flatMap((subtitle, index) => analyzeSubtitleLearningItems({
    text: subtitle,
    time: `00:0${index}:00`,
    source,
    userLevel: 'B2',
  }).items);

  const expressions = items.map((item) => item.expression);
  assert.ok(expressions.includes('let sb do sth'));
  assert.ok(expressions.includes('protect sb from sth'));
  assert.ok(expressions.includes('look forward to sth / doing sth'));
  assert.ok(expressions.includes('choose A over B'));
  assert.ok(expressions.includes("it's best if ..."));

  const expressionText = items.map((item) => item.expression).join('\n');
  assert.doesNotMatch(expressionText, /\bKatara\b/);
  assert.doesNotMatch(expressionText, /\bSokka\b/);
  assert.doesNotMatch(expressionText, /\bWater\b/);
  assert.doesNotMatch(expressionText, /\bFire\b/);
  assert.doesNotMatch(expressionText, /couldn't let/i);
  assert.doesNotMatch(expressionText, /don't let/i);
  assert.doesNotMatch(expressionText, /bestif/i);
  assert.doesNotMatch(expressionText, /shouldn'thave/i);
});

test('normalizeExpression maps concrete subtitle wording to reusable templates', () => {
  assert.deepEqual(
    pickNormalizedFields(normalizeExpression("don't let Sokka do this", { subtitle: "Grandmother, please, don't let Sokka do this." })),
    {
      expression: 'let sb do sth',
      surface: "don't let Sokka do this",
      type: 'pattern',
      meaning_zh: "让某人做某事；否定形式为 don't let sb do sth，表示不要让某人做某事",
      structure: 'let + object + bare infinitive',
      example: "Grandmother, please, don't let Sokka do this.",
      example_zh: '奶奶，拜托，不要让索卡做这件事。',
    },
  );

  assert.equal(normalizeExpression('protecting you from threats')?.expression, 'protect sb from sth');
  assert.equal(normalizeExpression('looking forward to that')?.expression, 'look forward to sth / doing sth');
  assert.equal(normalizeExpression('choose him over your tribe')?.expression, 'choose A over B');
});

test('dedupeLearningItems keeps higher value reusable structures over contained fragments', () => {
  const items = [
    { type: 'pattern', expression: 'let sb do sth', surface: 'let you have all the glory', example: "Well, I couldn't let you have all the glory." },
    { type: 'phrasal_verb', expression: "couldn't let", surface: "couldn't let", example: "Well, I couldn't let you have all the glory." },
    { type: 'collocation', expression: 'have all the glory', surface: 'have all the glory', example: "Well, I couldn't let you have all the glory." },
  ];

  assert.deepEqual(
    dedupeLearningItems(items).map((item) => item.expression),
    ['let sb do sth'],
  );
});

test('dedupeLearningItems merges repeated expressions by appending examples', () => {
  const items = [
    normalizeExpression('looking forward to that', { subtitle: 'Not looking forward to that.' }),
    normalizeExpression('look forward to seeing you', { subtitle: 'I look forward to seeing you.' }),
  ];

  const deduped = dedupeLearningItems(items);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].expression, 'look forward to sth / doing sth');
  assert.deepEqual(deduped[0].examples.map((example) => example.text), [
    'Not looking forward to that.',
    'I look forward to seeing you.',
  ]);
});

test('shouldKeepItem filters simple words, named entities, fragments, and keeps structure-value B1 patterns', () => {
  assert.equal(shouldKeepItem({ type: 'advanced_word', expression: 'water', difficulty: 'B2' }, 'B2'), false);
  assert.equal(shouldKeepItem({ type: 'named_entity', expression: 'Sokka', difficulty: 'B2' }, 'B2'), false);
  assert.equal(shouldKeepItem({ type: 'phrasal_verb', expression: "couldn't let", surface: "couldn't let", difficulty: 'B2' }, 'B2'), false);
  assert.equal(shouldKeepItem({ type: 'pattern', expression: 'let sb do sth', difficulty: 'B1' }, 'B2'), true);
});

test('includeProperNouns controls whether named entities are exportable', () => {
  const hidden = analyzeSubtitleLearningItems({
    text: 'Sokka and Katara found Aang.',
    source,
  }).items;
  assert.deepEqual(hidden, []);

  const included = analyzeSubtitleLearningItems({
    text: 'Sokka and Katara found Aang.',
    source,
    includeProperNouns: true,
  }).items;

  assert.deepEqual(included.map((item) => item.expression), ['Katara', 'Sokka']);
  assert.equal(included.every((item) => item.type === 'named_entity' && item.exportable === true), true);
  assert.deepEqual(normalizeExportableLearningItems(included).map((item) => item.expression), ['Katara', 'Sokka']);
});

test('structure extractor rejects UI labels and keeps run/from plus placed/on patterns', () => {
  const result = analyzeSubtitleLearningItems({
    text: 'You can run it from the Command Palette and the result will be placed on the clipboard.',
    source,
  });

  assert.deepEqual(result.items.map((item) => item.expression), [
    'run sth from somewhere',
    'be placed on sth',
  ]);
  assertNoExpressions(result.items, [
    'Command Palette',
    'run it from',
    'clipboard',
    'palette',
    'placed',
    'result',
  ]);
  assert.equal(result.items.every((item) => item.usefulnessScore >= 7), true);
});

test('structure extractor normalizes let and relative-position patterns without surface fragments', () => {
  const result = analyzeSubtitleLearningItems({
    text: 'Snap to objects is another powerful way to align and size objects. It intelligently lets you position elements relative to the others.',
    source,
  });

  assert.deepEqual(result.items.map((item) => item.expression), [
    'let sb do sth',
    'align',
  ]);
  assertNoExpressions(result.items, [
    'lets you',
    'lets you position',
    'position elements',
    'objects',
    'powerful',
  ]);
  assert.equal(result.items.length <= 2, true);
});

test('technicalMode controls technical collocations and keeps reusable patterns first', () => {
  const subtitle = 'The stencil library lets you store simple illustrations that you can add to and modify in your scene.';
  const defaultResult = analyzeSubtitleLearningItems({ text: subtitle, source });

  assert.deepEqual(defaultResult.items.map((item) => item.expression), [
    'let sb do sth',
    'modify',
  ]);
  assertNoExpressions(defaultResult.items, [
    'stencil library',
    'simple illustrations',
    'store simple illustrations',
    'illustrations',
    'library',
  ]);

  const technicalResult = analyzeSubtitleLearningItems({
    text: subtitle,
    source,
    technicalMode: true,
  });

  assert.equal(technicalResult.items.length <= 2, true);
});

test('structure extractor rejects product names and UI labels around compatibility patterns', () => {
  const result = analyzeSubtitleLearningItems({
    text: 'Note the Add to Excalidraw button does not work with Obsidian.',
    source,
  });

  assert.deepEqual(result.items.map((item) => item.expression), ['not work with sth']);
  assertNoExpressions(result.items, [
    'Excalidraw',
    'Obsidian',
    'Add to Excalidraw',
    'button',
    'download',
  ]);
});

test('extractor keeps advanced words in a separate vocabulary channel', () => {
  const result = analyzeSubtitleLearningItems({
    text: 'Excalidraw may look like a simple vector illustration tool, but under the disguise',
    source,
  });

  assert.deepEqual(result.items.map((item) => item.expression), [
    'under the disguise',
  ]);
  assertNoExpressions(result.items, [
    'Excalidraw',
    'vector illustration tool',
    'simple',
    'tool',
  ]);
});

test('extractor combines structure and advanced word quotas without pattern-only output', () => {
  const result = analyzeSubtitleLearningItems({
    text: 'it is a revolutionary visual thinking powerhouse that will convert the Obsidian.md caterpillar into a beautiful butterfly',
    source,
  });

  const expressions = result.items.map((item) => item.expression);
  assert.ok(expressions.includes('convert A into B'));
  assert.ok(expressions.includes('revolutionary'));
  assert.equal(result.items.filter((item) => item.type === 'advanced_word').length, 1);
  assert.equal(result.items.length <= 2, true);
  assertNoExpressions(result.items, [
    'Obsidian.md',
    'caterpillar',
    'butterfly',
    'beautiful',
  ]);
});

test('extractor keeps idioms and high value vocabulary without duplicate keyword words', () => {
  const result = analyzeSubtitleLearningItems({
    text: "This will be a super fast paced demonstration. But we're only scratching the surface.",
    source,
  });

  assert.deepEqual(result.items.map((item) => item.expression), [
    'scratch the surface',
    'fast-paced',
  ]);
  assert.equal(result.items.length <= 2, true);
  assertNoExpressions(result.items, [
    'surface',
    'super',
    'only',
  ]);
});

test('getExtractionConfigFromIntensity maps intensity ranges to playback and export quotas', () => {
  assert.deepEqual(pickIntensityFields(getExtractionConfigFromIntensity(0)), {
    intensity: 0,
    realtimeMaxItemsPerLine: 1,
    exportMaxItemsPerLine: 2,
    minStructureScore: 8,
    minAdvancedWordScore: 8,
    allowCollocations: false,
    allowAdvancedWords: true,
    allowTechnicalTerms: false,
    allowB2Words: false,
    allowProperNouns: false,
    compactDuringPlayback: true,
  });
  assert.equal(getExtractionConfigFromIntensity(20).realtimeMaxItemsPerLine, 1);
  assert.deepEqual(pickIntensityFields(getExtractionConfigFromIntensity(21)), {
    intensity: 21,
    realtimeMaxItemsPerLine: 1,
    exportMaxItemsPerLine: 3,
    minStructureScore: 7,
    minAdvancedWordScore: 7,
    allowCollocations: true,
    allowAdvancedWords: true,
    allowTechnicalTerms: false,
    allowB2Words: true,
    allowProperNouns: false,
    compactDuringPlayback: true,
  });
  assert.equal(getExtractionConfigFromIntensity(50).realtimeMaxItemsPerLine, 2);
  assert.equal(getExtractionConfigFromIntensity(50).exportMaxItemsPerLine, 4);
  assert.equal(getExtractionConfigFromIntensity(80).exportMaxItemsPerLine, 6);
  assert.equal(getExtractionConfigFromIntensity(100).realtimeMaxItemsPerLine, 3);
  assert.equal(getExtractionConfigFromIntensity(100).compactDuringPlayback, false);
});

test('slider-driven extraction separates realtime and export items for idiom subtitle', () => {
  const subtitle = "This will be a super fast paced demonstration. But we're only scratching the surface.";

  const minimal = analyzeSubtitleLearningItems({ text: subtitle, source, intensity: 20 });
  assert.deepEqual(minimal.realtimeItems.map((item) => item.expression), ['scratch the surface']);
  assert.deepEqual(minimal.exportItems.map((item) => item.expression), [
    'scratch the surface',
    'fast-paced',
  ]);

  const balanced = analyzeSubtitleLearningItems({ text: subtitle, source, intensity: 50 });
  assert.deepEqual(balanced.realtimeItems.map((item) => item.expression), [
    'scratch the surface',
    'fast-paced',
  ]);
  assert.deepEqual(balanced.exportItems.map((item) => item.expression), [
    'scratch the surface',
    'fast-paced',
    'demonstration',
  ]);

  const detailed = analyzeSubtitleLearningItems({ text: subtitle, source, intensity: 80 });
  assert.deepEqual(detailed.realtimeItems.map((item) => item.expression), [
    'scratch the surface',
    'fast-paced',
  ]);
  assert.deepEqual(detailed.exportItems.map((item) => item.expression), [
    'scratch the surface',
    'fast-paced',
    'demonstration',
  ]);

  assertNoExpressions(detailed.exportItems, ['surface', 'super', 'only']);
});

test('slider-driven extraction keeps realtime clean and export richer for conversion subtitle', () => {
  const result = analyzeSubtitleLearningItems({
    text: 'it is a revolutionary visual thinking powerhouse that will convert the Obsidian.md caterpillar into a beautiful butterfly',
    source,
    intensity: 50,
  });

  assert.deepEqual(result.realtimeItems.map((item) => item.expression), [
    'convert A into B',
    'revolutionary',
  ]);
  assert.deepEqual(result.exportItems.map((item) => item.expression), [
    'convert A into B',
    'revolutionary',
    'powerhouse',
    'visual thinking',
  ]);
  assertNoExpressions(result.exportItems, [
    'Obsidian.md',
    'caterpillar',
    'butterfly',
    'beautiful',
  ]);
});

test('slider-driven extraction rejects UI labels while preserving reusable structures', () => {
  const result = analyzeSubtitleLearningItems({
    text: 'You can run it from the Command Palette and the result will be placed on the clipboard.',
    source,
    intensity: 50,
  });

  assert.deepEqual(result.realtimeItems.map((item) => item.expression), [
    'run sth from somewhere',
    'be placed on sth',
  ]);
  assert.deepEqual(result.exportItems.map((item) => item.expression), [
    'run sth from somewhere',
    'be placed on sth',
  ]);
  assertNoExpressions(result.exportItems, [
    'Command Palette',
    'clipboard',
    'placed',
    'result',
  ]);
});

test('selectItemsByIntensity rejects low-value B2 words at low intensity and garbage at high intensity', () => {
  const low = selectItemsByIntensity([
    { type: 'advanced_word', expression: 'demonstration', surface: 'demonstration', difficulty: 'B2', usefulnessScore: 7, start: 0, end: 13, example: 'demonstration' },
    { type: 'idiom', expression: 'scratch the surface', surface: 'scratch the surface', difficulty: 'B2', usefulnessScore: 9, start: 20, end: 39, example: 'scratch the surface' },
  ], getExtractionConfigFromIntensity(20));
  assert.deepEqual(low.realtimeItems.map((item) => item.expression), ['scratch the surface']);
  assert.deepEqual(low.exportItems.map((item) => item.expression), ['scratch the surface']);

  const high = selectItemsByIntensity([
    { type: 'advanced_word', expression: 'water', surface: 'water', difficulty: 'B2', usefulnessScore: 10, start: 0, end: 5, example: 'water' },
    { type: 'named_entity', expression: 'Sokka', surface: 'Sokka', difficulty: 'B2', usefulnessScore: 10, start: 6, end: 11, example: 'Sokka' },
    { type: 'advanced_word', expression: 'revolutionary', surface: 'revolutionary', difficulty: 'C1', usefulnessScore: 8, start: 12, end: 25, example: 'revolutionary' },
  ], getExtractionConfigFromIntensity(100));
  assert.deepEqual(high.exportItems.map((item) => item.expression), ['revolutionary']);
});

test('structure-only subtitles do not suppress vocabulary in other subtitles', () => {
  const items = [
    analyzeSubtitleLearningItems({ text: 'Let me show you how.', source }).items,
    analyzeSubtitleLearningItems({ text: 'This will be a fast paced demonstration.', source }).items,
  ].flat();

  const expressions = items.map((item) => item.expression);
  assert.ok(expressions.includes('let sb do sth'));
  assert.ok(expressions.includes('fast-paced'));
  assert.equal(items.every((item) => item.expression), true);
});

test('selectTopItemsForSubtitleLine keeps at most one structure and one vocabulary item by default', () => {
  const selected = selectTopItemsForSubtitleLine([
    { type: 'pattern', expression: 'let sb do sth', surface: 'let me show you', difficulty: 'B1', usefulnessScore: 8, start: 0, end: 15, example: 'Let me show you a revolutionary tool.' },
    { type: 'idiom', expression: 'scratch the surface', surface: 'scratch the surface', difficulty: 'B2', usefulnessScore: 9, start: 20, end: 39, example: 'Let me show you a revolutionary tool.' },
    { type: 'advanced_word', expression: 'revolutionary', surface: 'revolutionary', difficulty: 'C1', usefulnessScore: 7, start: 40, end: 53, example: 'Let me show you a revolutionary tool.' },
    { type: 'advanced_word', expression: 'powerhouse', surface: 'powerhouse', difficulty: 'C1', usefulnessScore: 7, start: 54, end: 64, example: 'Let me show you a revolutionary tool.' },
  ]);

  assert.deepEqual(selected.map((item) => item.expression), [
    'scratch the surface',
    'revolutionary',
  ]);
});

function pickNormalizedFields(item) {
  return {
    expression: item.expression,
    surface: item.surface,
    type: item.type,
    meaning_zh: item.meaning_zh,
    structure: item.structure,
    example: item.example,
    example_zh: item.example_zh,
  };
}

function assertNoExpressions(items, forbidden) {
  const expressions = new Set(items.map((item) => item.expression.toLowerCase()));
  for (const expression of forbidden) {
    assert.equal(expressions.has(String(expression).toLowerCase()), false);
  }
}

function pickIntensityFields(config) {
  return {
    intensity: config.intensity,
    realtimeMaxItemsPerLine: config.realtimeMaxItemsPerLine,
    exportMaxItemsPerLine: config.exportMaxItemsPerLine,
    minStructureScore: config.minStructureScore,
    minAdvancedWordScore: config.minAdvancedWordScore,
    allowCollocations: config.allowCollocations,
    allowAdvancedWords: config.allowAdvancedWords,
    allowTechnicalTerms: config.allowTechnicalTerms,
    allowB2Words: config.allowB2Words,
    allowProperNouns: config.allowProperNouns,
    compactDuringPlayback: config.compactDuringPlayback,
  };
}
