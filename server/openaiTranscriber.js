const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

export function normalizeOpenAITranscription(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('OpenAI returned an invalid transcription response.');
  }

  const text = String(payload.text ?? '').trim();
  if (!text) {
    throw new Error('OpenAI transcription response did not include text.');
  }

  return {
    text,
    translatedText: '',
    language: String(payload.language ?? ''),
    isFinal: true,
  };
}

export function createOpenAITranscriber({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
  prompt = process.env.OPENAI_TRANSCRIBE_PROMPT || '',
  translateTo = process.env.OPENAI_TRANSLATE_TO || '',
  translationModel = process.env.OPENAI_TRANSLATE_MODEL || 'gpt-4.1-mini',
  fetchImpl = fetch,
} = {}) {
  return {
    async transcribe({
      audio,
      filename = 'chunk.webm',
      prompt: requestPrompt = '',
      apiKey: requestApiKey = '',
    }) {
      const effectiveApiKey = String(requestApiKey || apiKey || '').trim();
      if (!effectiveApiKey) {
        throw new Error('OPENAI_API_KEY is required to transcribe audio.');
      }

      const body = new FormData();
      body.set('file', audio, filename);
      body.set('model', model);
      body.set('response_format', 'json');

      const effectivePrompt = String(requestPrompt || prompt).trim();
      if (effectivePrompt) {
        body.set('prompt', effectivePrompt);
      }

      const response = await fetchImpl(OPENAI_TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${effectiveApiKey}`,
        },
        body,
      });

      if (!response.ok) {
        const detail = await readErrorDetail(response);
        if (isUnreadableAudioFileError(response.status, detail)) {
          return {
            text: '',
            translatedText: '',
            language: '',
            isFinal: true,
            isEmpty: true,
          };
        }
        throw new Error(`OpenAI transcription failed with HTTP ${response.status}${detail}`);
      }

      const result = normalizeOpenAITranscription(await response.json());
      const targetLanguage = String(translateTo ?? '').trim();

      if (!targetLanguage) {
        return result;
      }

      try {
        return {
          ...result,
          translatedText: await translateTranscript({
            apiKey: effectiveApiKey,
            fetchImpl,
            model: translationModel,
            targetLanguage,
            text: result.text,
          }),
        };
      } catch (error) {
        return {
          ...result,
          translatedText: '',
          warning: `Translation failed: ${error.message}`,
        };
      }
    },
    async analyze({
      text,
      context = [],
      level = 'B2',
      includeProperNouns = false,
      technicalMode = false,
      includeUiTerms = false,
      minUsefulnessScore = 7,
      apiKey: requestApiKey = '',
    }) {
      const effectiveApiKey = String(requestApiKey || apiKey || '').trim();
      if (!effectiveApiKey) {
        throw new Error('OPENAI_API_KEY is required to analyze subtitle lines.');
      }

      return analyzeLearningHighlights({
        apiKey: effectiveApiKey,
        fetchImpl,
        model: translationModel,
        text,
        context,
        level,
        includeProperNouns,
        technicalMode,
        includeUiTerms,
        minUsefulnessScore,
      });
    },
  };
}

async function analyzeLearningHighlights({
  apiKey,
  fetchImpl,
  model,
  text,
  context,
  level,
  includeProperNouns,
  technicalMode,
  includeUiTerms,
  minUsefulnessScore,
}) {
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                'You help Chinese-speaking learners study English from movie subtitles.',
                'Return strict JSON with an items array. Each item must use type pattern, phrasal_verb, collocation, idiom, advanced_word, technical_term, or named_entity.',
                'Prefer reusable English structures over vocabulary lists. Do not return ordinary A1-B1 words or low-value software words such as feature, shape, web, download, library, function, object, item, tool, or image.',
                'For each item include expression, surface, meaning_zh, structure, difficulty, why_useful, example, example_zh. The expression must be normalized into a reusable template when possible, such as "let sb do sth", "protect sb from sth", "look forward to sth / doing sth", or "choose A over B".',
                'The surface field should be the exact subtitle wording that triggered the item. If you include start and end, they must be zero-based character offsets in the exact subtitle string, with end exclusive.',
                'Do not include people, character names, places, or fictional organizations unless they are marked named_entity; named_entity items are usually not exportable.',
                includeProperNouns
                  ? 'The user enabled includeProperNouns, so useful named_entity items may be exportable.'
                  : 'The user has not enabled includeProperNouns, so avoid named_entity items unless they are essential context.',
                technicalMode
                  ? 'The user enabled technicalMode. Technical terms may be included only when they are useful for the video topic.'
                  : 'The user has not enabled technicalMode. Do not return software names, product names, UI labels, or technical terms such as Excalidraw, Obsidian, Command Palette, Plugin Settings, OCR, Add to library, or Open Library.',
                includeUiTerms
                  ? 'The user enabled includeUiTerms, so useful UI labels may be included as technical_term items.'
                  : 'The user has not enabled includeUiTerms. Do not return button labels, menu labels, settings panel names, or UI commands.',
                'Do not return fragments such as "couldn\'t let", "don\'t let", "he\'s ready", "can save", or "from our village".',
                'Do not return near-duplicates or substrings when a higher-value structure is present. If "let sb do sth" is present, do not also return "don\'t let", "let Sokka do this", or "have all the glory".',
                `Each item must have usefulness score >= ${minUsefulnessScore} in spirit: keep reusable patterns, phrasal verbs, collocations, and idioms; reject surface-level terms.`,
                'Repair obvious glued subtitle tokens before analysis, such as shouldn\'thave -> shouldn\'t have, bestif -> best if, youhave -> you have, and flyingand -> flying and.',
                `Only include items useful for a learner at ${level} or above.`,
              ].join(' '),
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({
                subtitle: text,
                context,
                level,
                includeProperNouns: includeProperNouns === true,
                technicalMode: technicalMode === true,
                includeUiTerms: includeUiTerms === true,
                minUsefulnessScore,
              }),
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(`OpenAI learning analysis failed with HTTP ${response.status}${detail}`);
  }

  return normalizeOpenAIAnalysis(await response.json());
}

function normalizeOpenAIAnalysis(payload) {
  const text = String(payload?.output_text ?? '').trim() || payload?.output
    ?.flatMap((item) => item.content ?? [])
    ?.map((content) => content.text ?? '')
    ?.join(' ')
    ?.trim();
  if (!text) throw new Error('OpenAI learning analysis response did not include output text.');

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('OpenAI learning analysis response was not valid JSON.');
  }
}

async function translateTranscript({ apiKey, fetchImpl, model, targetLanguage, text }) {
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                `Translate the user's transcript into ${targetLanguage}.`,
                'Return only the translation.',
                'Preserve names, numbers, punctuation, and technical terms when appropriate.',
              ].join(' '),
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(`OpenAI translation failed with HTTP ${response.status}${detail}`);
  }

  return normalizeOpenAITranslation(await response.json());
}

function normalizeOpenAITranslation(payload) {
  const outputText = String(payload?.output_text ?? '').trim();
  if (outputText) return outputText;

  const nestedText = payload?.output
    ?.flatMap((item) => item.content ?? [])
    ?.map((content) => content.text ?? '')
    ?.join(' ')
    ?.trim();

  if (nestedText) return nestedText;
  throw new Error('OpenAI translation response did not include output text.');
}

async function readErrorDetail(response) {
  try {
    const text = await response.text();
    return text ? `: ${text.slice(0, 500)}` : '';
  } catch {
    return '';
  }
}

function isUnreadableAudioFileError(status, detail) {
  if (Number(status) !== 400) return false;
  const message = String(detail ?? '');
  return (
    /"param"\s*:\s*"file"/.test(message) &&
    /"code"\s*:\s*"invalid_value"/.test(message) &&
    /corrupted|unsupported/i.test(message)
  );
}
