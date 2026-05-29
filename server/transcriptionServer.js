import http from 'node:http';
import fs from 'node:fs/promises';

import { createOpenAITranscriber } from './openaiTranscriber.js';
import {
  analyzeSubtitleLearningItems,
  dedupeLearningItems,
  extractionConfig,
  getExtractionConfigFromIntensity,
  normalizeLearningAnalysis,
  normalizeExtractionIntensity,
} from '../src/shared/learningAnalysis.js';
import {
  appendObsidianMarkdown,
  buildObsidianMarkdown,
} from '../src/shared/obsidianExport.js';

const DEFAULT_PORT = 8787;

export function createTranscriptionServer({
  transcriber = createOpenAITranscriber(),
} = {}) {
  return http.createServer(async (req, res) => {
    try {
      await routeRequest(req, res, transcriber);
    } catch (error) {
      sendJson(res, 500, {
        error: error.message,
      });
    }
  });
}

async function routeRequest(req, res, transcriber) {
  applyCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/analyze') {
    await handleAnalyze(req, res, transcriber);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/obsidian/export') {
    await handleObsidianExport(req, res, transcriber);
    return;
  }

  if (req.method !== 'POST' || url.pathname !== '/transcribe') {
    sendJson(res, 404, { error: '请使用 POST /transcribe、/analyze 或 /obsidian/export。' });
    return;
  }

  const form = await parseMultipartForm(req);
  const audio = form.get('audio');

  if (!audio || typeof audio.arrayBuffer !== 'function') {
    sendJson(res, 400, { error: '缺少 multipart audio 文件字段。' });
    return;
  }

  const sequence = String(form.get('sequence') ?? '0');
  const sourceUrl = String(form.get('sourceUrl') ?? '');
  const apiKey = String(form.get('apiKey') ?? '').trim();
  const prompt = buildPrompt(sourceUrl);

  const result = await transcriber.transcribe({
    audio,
    filename: audio.name || `chunk-${sequence}.webm`,
    prompt,
    apiKey,
  });

  sendJson(res, 200, result);
}

async function handleAnalyze(req, res, transcriber) {
  const body = await parseJsonBody(req);
  const text = String(body.text ?? '').trim();
  if (!text) {
    sendJson(res, 400, { error: '缺少 text 字段。' });
    return;
  }

  const level = String(body.level ?? 'B2').trim() || 'B2';
  const includeProperNouns = body.includeProperNouns === true;
  const technicalMode = body.technicalMode === true;
  const includeUiTerms = body.includeUiTerms === true;
  const intensity = normalizeExtractionIntensity(body.intensity ?? extractionConfig.intensity);
  const intensityConfig = getExtractionConfigFromIntensity(intensity);
  const minUsefulnessScore = Number.isFinite(Number(body.minUsefulnessScore))
    ? Number(body.minUsefulnessScore)
    : undefined;
  const analysisConfig = {
    ...extractionConfig,
    ...intensityConfig,
    userLevel: level,
    includeProperNouns,
    technicalMode,
    includeUiTerms,
    minUsefulnessScore: minUsefulnessScore ?? Math.min(intensityConfig.minStructureScore, intensityConfig.minAdvancedWordScore),
  };
  const localAnalysis = analyzeSubtitleLearningItems({
    text,
    userLevel: level,
    includeProperNouns,
    technicalMode,
    includeUiTerms,
    minUsefulnessScore,
    intensity,
    source: {
      site: safeHost(body.sourceUrl),
      url: String(body.sourceUrl ?? '').trim(),
    },
  });

  if (typeof transcriber.analyze !== 'function') {
    sendJson(res, 200, localAnalysis);
    return;
  }

  const result = await transcriber.analyze({
    text,
    context: Array.from(body.context ?? []).map((item) => String(item)),
    level,
    includeProperNouns,
    technicalMode,
    includeUiTerms,
    minUsefulnessScore,
    intensity,
    apiKey: String(body.apiKey ?? '').trim(),
  });
  const remoteAnalysis = normalizeLearningAnalysis({
    ...result,
    level,
    includeProperNouns,
    technicalMode,
    includeUiTerms,
    minUsefulnessScore,
    intensity,
  }, text);
  if (localAnalysis.items.length === 0) {
    sendJson(res, 200, remoteAnalysis);
    return;
  }

  const realtimeItems = dedupeLearningItems([
    ...Array.from(localAnalysis.realtimeItems ?? localAnalysis.items ?? []),
    ...Array.from(remoteAnalysis.realtimeItems ?? remoteAnalysis.items ?? []),
  ], {
    maxItems: intensityConfig.realtimeMaxItemsPerLine,
    config: analysisConfig,
  });
  const exportItems = dedupeLearningItems([
    ...Array.from(localAnalysis.exportItems ?? localAnalysis.items ?? []),
    ...Array.from(remoteAnalysis.exportItems ?? remoteAnalysis.items ?? []),
  ], {
    maxItems: intensityConfig.exportMaxItemsPerLine,
    config: analysisConfig,
  });
  sendJson(res, 200, {
    realtimeItems,
    exportItems,
    items: realtimeItems,
  });
}

async function handleObsidianExport(req, res, transcriber) {
  const body = await parseJsonBody(req);
  if (!String(body.vaultPath ?? '').trim()) {
    sendJson(res, 400, { error: '缺少 obsidianVaultPath/vaultPath。' });
    return;
  }

  if (typeof transcriber.exportObsidian === 'function') {
    sendJson(res, 200, await transcriber.exportObsidian(body));
    return;
  }

  const markdown = buildObsidianMarkdown(body);
  const result = await appendObsidianMarkdown({
    fs,
    vaultPath: body.vaultPath,
    subdir: body.subdir,
    markdown,
  });
  sendJson(res, 200, result);
}

async function parseMultipartForm(req) {
  const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req,
    duplex: 'half',
  });

  return request.formData();
}

async function parseJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

function buildPrompt(sourceUrl) {
  const host = safeHost(sourceUrl);
  return [
    'Transcribe streaming video dialogue accurately.',
    'Preserve proper nouns and technical terms.',
    host ? `The source site is ${host}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function safeHost(sourceUrl) {
  try {
    return new URL(sourceUrl).host;
  } catch {
    return '';
  }
}

function sendJson(res, status, body) {
  applyCorsHeaders(res);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(body));
}

function applyCorsHeaders(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,authorization');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const server = createTranscriptionServer();

  server.listen(port, () => {
    console.log(`Transcription server listening on http://localhost:${port}`);
  });
}
