import {
  DEFAULT_EXTRACTION_INTENSITY,
  normalizeExtractionIntensity,
} from './extractionIntensity.js';

export const DEFAULT_SETTINGS = {
  enabled: true,
  analysisEndpoint: 'http://localhost:8787/analyze',
  obsidianExportEndpoint: 'http://localhost:8787/obsidian/export',
  englishLevel: 'B2',
  includeProperNouns: false,
  technicalMode: false,
  includeUiTerms: false,
  extractionIntensity: DEFAULT_EXTRACTION_INTENSITY,
  openAiApiKey: '',
  obsidianVaultPath: '',
  obsidianSubdir: '英语观看记录',
};

export function getMissingDefaultSettings(settings = {}) {
  const missing = {};

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (settings[key] === undefined || settings[key] === null) {
      missing[key] = value;
    }
  }

  return missing;
}

export function normalizeSettings(settings = {}) {
  return {
    enabled: settings.enabled !== false,
    analysisEndpoint: String(settings.analysisEndpoint ?? DEFAULT_SETTINGS.analysisEndpoint).trim(),
    obsidianExportEndpoint: String(settings.obsidianExportEndpoint ?? DEFAULT_SETTINGS.obsidianExportEndpoint).trim(),
    englishLevel: String(settings.englishLevel ?? DEFAULT_SETTINGS.englishLevel).trim() || DEFAULT_SETTINGS.englishLevel,
    includeProperNouns: settings.includeProperNouns === true,
    technicalMode: settings.technicalMode === true,
    includeUiTerms: settings.includeUiTerms === true,
    extractionIntensity: normalizeExtractionIntensity(settings.extractionIntensity),
    openAiApiKey: String(settings.openAiApiKey ?? DEFAULT_SETTINGS.openAiApiKey).trim(),
    obsidianVaultPath: String(settings.obsidianVaultPath ?? DEFAULT_SETTINGS.obsidianVaultPath).trim(),
    obsidianSubdir: String(settings.obsidianSubdir ?? DEFAULT_SETTINGS.obsidianSubdir).trim() || DEFAULT_SETTINGS.obsidianSubdir,
  };
}
