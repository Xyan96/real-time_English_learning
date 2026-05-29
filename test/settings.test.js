import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  DEFAULT_SETTINGS,
  getMissingDefaultSettings,
  normalizeSettings,
} from '../src/shared/settings.js';

test('default settings match the bundled local analysis and export services', () => {
  assert.equal(DEFAULT_SETTINGS.enabled, true);
  assert.equal(DEFAULT_SETTINGS.analysisEndpoint, 'http://localhost:8787/analyze');
  assert.equal(DEFAULT_SETTINGS.obsidianExportEndpoint, 'http://localhost:8787/obsidian/export');
  assert.equal(DEFAULT_SETTINGS.englishLevel, 'B2');
  assert.equal(DEFAULT_SETTINGS.includeProperNouns, false);
  assert.equal(DEFAULT_SETTINGS.technicalMode, false);
  assert.equal(DEFAULT_SETTINGS.includeUiTerms, false);
  assert.equal(DEFAULT_SETTINGS.extractionIntensity, 50);
  assert.equal(DEFAULT_SETTINGS.openAiApiKey, '');
  assert.equal(DEFAULT_SETTINGS.obsidianSubdir, '英语观看记录');

  const popupHtml = fs.readFileSync(new URL('../src/popup/popup.html', import.meta.url), 'utf8');
  assert.doesNotMatch(popupHtml, /启动音频兜底|音频分段长度|http:\/\/localhost:8787\/transcribe/);
  assert.match(popupHtml, /id="enabled"/);
  assert.match(popupHtml, /placeholder="http:\/\/localhost:8787\/analyze"/);
  assert.match(popupHtml, /placeholder="http:\/\/localhost:8787\/obsidian\/export"/);
  assert.match(popupHtml, /id="includeProperNouns"/);
  assert.match(popupHtml, /id="technicalMode"/);
  assert.match(popupHtml, /id="includeUiTerms"/);
  assert.match(popupHtml, /id="extractionIntensity"/);
  assert.match(popupHtml, /id="extractionModeSummary"/);
  assert.match(popupHtml, /id="openAiApiKey"/);
});

test('getMissingDefaultSettings fills missing settings only', () => {
  assert.deepEqual(
    getMissingDefaultSettings({
      enabled: true,
      analysisEndpoint: 'http://localhost:8787/analyze',
      obsidianExportEndpoint: 'http://localhost:8787/obsidian/export',
      englishLevel: 'B2',
      includeProperNouns: false,
      technicalMode: false,
      includeUiTerms: false,
      extractionIntensity: DEFAULT_SETTINGS.extractionIntensity,
      openAiApiKey: '',
      obsidianVaultPath: '',
      obsidianSubdir: DEFAULT_SETTINGS.obsidianSubdir,
    }),
    {},
  );
  assert.deepEqual(
    getMissingDefaultSettings({ analysisEndpoint: 'http://localhost:8787/analyze' }),
    {
      enabled: DEFAULT_SETTINGS.enabled,
      englishLevel: DEFAULT_SETTINGS.englishLevel,
      includeProperNouns: DEFAULT_SETTINGS.includeProperNouns,
      technicalMode: DEFAULT_SETTINGS.technicalMode,
      includeUiTerms: DEFAULT_SETTINGS.includeUiTerms,
      extractionIntensity: DEFAULT_SETTINGS.extractionIntensity,
      openAiApiKey: DEFAULT_SETTINGS.openAiApiKey,
      obsidianExportEndpoint: DEFAULT_SETTINGS.obsidianExportEndpoint,
      obsidianSubdir: DEFAULT_SETTINGS.obsidianSubdir,
      obsidianVaultPath: DEFAULT_SETTINGS.obsidianVaultPath,
    },
  );
});

test('normalizeSettings preserves user-selected learning settings', () => {
  assert.deepEqual(
    normalizeSettings({
      enabled: false,
      analysisEndpoint: 'http://localhost:8787/custom-analyze',
      obsidianExportEndpoint: 'http://localhost:8787/custom-export',
      englishLevel: 'C1',
      includeProperNouns: true,
      technicalMode: true,
      includeUiTerms: true,
      extractionIntensity: 80,
      openAiApiKey: 'sk-test',
      obsidianVaultPath: '/Users/me/Notes',
      obsidianSubdir: 'Shows',
    }),
    {
      enabled: false,
      analysisEndpoint: 'http://localhost:8787/custom-analyze',
      obsidianExportEndpoint: 'http://localhost:8787/custom-export',
      englishLevel: 'C1',
      includeProperNouns: true,
      technicalMode: true,
      includeUiTerms: true,
      extractionIntensity: 80,
      openAiApiKey: 'sk-test',
      obsidianVaultPath: '/Users/me/Notes',
      obsidianSubdir: 'Shows',
    },
  );
});

test('normalizeSettings falls back for missing learning settings', () => {
  assert.deepEqual(
    normalizeSettings({}),
    {
      enabled: DEFAULT_SETTINGS.enabled,
      analysisEndpoint: DEFAULT_SETTINGS.analysisEndpoint,
      obsidianExportEndpoint: DEFAULT_SETTINGS.obsidianExportEndpoint,
      englishLevel: DEFAULT_SETTINGS.englishLevel,
      includeProperNouns: DEFAULT_SETTINGS.includeProperNouns,
      technicalMode: DEFAULT_SETTINGS.technicalMode,
      includeUiTerms: DEFAULT_SETTINGS.includeUiTerms,
      extractionIntensity: DEFAULT_SETTINGS.extractionIntensity,
      openAiApiKey: DEFAULT_SETTINGS.openAiApiKey,
      obsidianVaultPath: '',
      obsidianSubdir: DEFAULT_SETTINGS.obsidianSubdir,
    },
  );
});

test('normalizeSettings clamps extraction intensity to the slider range', () => {
  assert.equal(normalizeSettings({ extractionIntensity: 'bad' }).extractionIntensity, 50);
  assert.equal(normalizeSettings({ extractionIntensity: -10 }).extractionIntensity, 0);
  assert.equal(normalizeSettings({ extractionIntensity: 150 }).extractionIntensity, 100);
  assert.equal(normalizeSettings({ extractionIntensity: 61.8 }).extractionIntensity, 62);
});
