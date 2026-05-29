export function normalizeTranscriptionResponse(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Transcription backend returned an invalid response.');
  }

  const text = String(payload.text ?? payload.transcript ?? '').trim();
  if (!text) {
    const normalized = {
      text: '',
      translatedText: '',
      language: String(payload.language ?? ''),
      isFinal: payload.isFinal !== false,
      isEmpty: true,
    };
    const warning = String(payload.warning ?? '').trim();
    if (warning) {
      normalized.warning = warning;
    }
    return normalized;
  }

  const normalized = {
    text,
    translatedText: String(payload.translatedText ?? payload.translated_text ?? '').trim(),
    language: String(payload.language ?? ''),
    isFinal: payload.isFinal !== false,
  };

  const warning = String(payload.warning ?? '').trim();
  if (warning) {
    normalized.warning = warning;
  }

  return normalized;
}

export function createTranscriptionClient({ endpoint, apiKey = '', fetchImpl = fetch } = {}) {
  const normalizedEndpoint = String(endpoint ?? '').trim();
  const normalizedApiKey = String(apiKey ?? '').trim();

  return {
    hasEndpoint() {
      return normalizedEndpoint.length > 0;
    },

    async transcribeChunk({ blob, sequence, startedAt, endedAt, sourceUrl }) {
      if (!normalizedEndpoint) {
        throw new Error('Set a transcription endpoint before starting capture.');
      }

      const body = new FormData();
      body.set('audio', blob, getAudioChunkFilename(sequence, blob?.type));
      body.set('sequence', String(sequence));
      body.set('startedAt', String(startedAt));
      body.set('endedAt', String(endedAt));
      body.set('sourceUrl', sourceUrl ?? '');
      if (normalizedApiKey) body.set('apiKey', normalizedApiKey);

      const response = await fetchImpl(normalizedEndpoint, {
        method: 'POST',
        body,
      });

      if (!response.ok) {
        const detail = await readBackendErrorDetail(response);
        throw new Error(`Transcription backend failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}.`);
      }

      return normalizeTranscriptionResponse(await response.json());
    },
  };
}

async function readBackendErrorDetail(response) {
  const jsonDetail = await readJsonErrorDetail(response);
  if (jsonDetail) return jsonDetail;

  try {
    return trimErrorDetail(await response.text?.());
  } catch {
    return '';
  }
}

async function readJsonErrorDetail(response) {
  try {
    const payload = await response.json?.();
    return trimErrorDetail(payload?.error ?? payload?.message ?? payload?.detail);
  } catch {
    return '';
  }
}

function trimErrorDetail(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

export function getAudioChunkFilename(sequence, mimeType) {
  const normalizedType = String(mimeType ?? '').toLowerCase().split(';')[0].trim();
  const extensionByType = {
    'audio/webm': 'webm',
    'audio/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
  };
  const extension = extensionByType[normalizedType] ?? 'webm';
  return `chunk-${sequence}.${extension}`;
}
