import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  buildObsidianMarkdown,
  resolveObsidianExportPath,
} from '../src/shared/obsidianExport.js';

test('buildObsidianMarkdown formats current subtitle highlights for review', () => {
  const markdown = buildObsidianMarkdown({
    pageTitle: 'Netflix - Avatar',
    sourceUrl: 'https://www.netflix.com/watch/70116062',
    segment: {
      startedAt: 1_099_000,
      text: 'All right, ready our defenses! The Fire Nation could come any moment now.',
    },
    analysis: {
      items: [
        { type: 'phrase', text: 'ready our defenses', translation: '准备好防御', difficulty: 'B2' },
        { type: 'collocation', text: 'come any moment', translation: '随时可能到来', difficulty: 'B2' },
      ],
    },
  });

  assert.match(markdown, /## 18:19 Netflix - Avatar/);
  assert.match(markdown, /> All right, ready our defenses!/);
  assert.match(markdown, /\| phrase \| ready our defenses \| 准备好防御 \| B2 \|/);
  assert.match(markdown, /\[Source\]\(https:\/\/www\.netflix\.com\/watch\/70116062\)/);
});

test('buildObsidianMarkdown formats full highlight history for export', () => {
  const markdown = buildObsidianMarkdown({
    pageTitle: 'Netflix - Avatar',
    sourceUrl: 'https://www.netflix.com/watch/70116062',
    highlights: [
      {
        startedAt: 1_000,
        type: 'phrase',
        text: 'ready our defenses',
        translation: '准备好防御',
        difficulty: 'B2',
        segmentText: 'All right, ready our defenses!',
      },
      {
        startedAt: 2_000,
        type: 'word',
        text: 'warriors',
        translation: '战士',
        difficulty: 'B1',
        segmentText: 'We need warriors.',
      },
    ],
  });

  assert.match(markdown, /## Highlight History Netflix - Avatar/);
  assert.match(markdown, /\| 00:01 \| phrase \| ready our defenses \| 准备好防御 \| B2 \| All right, ready our defenses! \|/);
  assert.match(markdown, /\| 00:02 \| word \| warriors \| 战士 \| B1 \| We need warriors\. \|/);
});

test('resolveObsidianExportPath writes into dated note under configured vault subdir', () => {
  assert.equal(
    resolveObsidianExportPath({
      vaultPath: '/Users/me/Notes',
      subdir: 'English Watching',
      now: new Date('2026-05-29T10:30:00Z'),
    }),
    path.join('/Users/me/Notes', 'English Watching', '2026-05-29.md'),
  );
});

test('resolveObsidianExportPath accepts shell-escaped macOS vault paths', () => {
  assert.equal(
    resolveObsidianExportPath({
      vaultPath: '/Users/me/Library/Mobile\\ Documents/iCloud\\~md\\~obsidian/Documents/mindport',
      subdir: 'English_Watching',
      now: new Date('2026-05-29T10:30:00Z'),
    }),
    path.join('/Users/me/Library/Mobile Documents/iCloud~md~obsidian/Documents/mindport', 'English_Watching', '2026-05-29.md'),
  );
});
