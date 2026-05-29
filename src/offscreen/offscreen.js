import {
  createAudioTranscriptSegment,
  createCaptureChunkTimer,
} from './captureTiming.js';
import { createTranscriptionClient } from './transcriptionClient.js';

let mediaStream = null;
let mediaRecorder = null;
let audioContext = null;
let sequence = 0;
let sourceUrl = '';
let chunkTimer = createCaptureChunkTimer();
let client = createTranscriptionClient();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;

  if (message.type === 'START_CAPTURE') {
    startCapture(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        postStatus('error', error.message);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'STOP_CAPTURE') {
    stopCapture();
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

async function startCapture({ streamId, endpoint, apiKey = '', chunkMs = 4000, sourceUrl: nextSourceUrl = '' }) {
  stopCapture();

  sourceUrl = nextSourceUrl;
  sequence = 0;
  chunkTimer = createCaptureChunkTimer();
  client = createTranscriptionClient({ endpoint, apiKey });

  if (!client.hasEndpoint()) {
    throw new Error('尚未配置转写接口。请打开插件弹窗设置。');
  }

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  keepCapturedAudioAudible(mediaStream);

  const mimeType = chooseMimeType();
  mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);

  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data?.size > 0) {
      transcribeBlob(event.data).catch((error) => postStatus('error', error.message));
    }
  });

  mediaRecorder.addEventListener('stop', () => {
    postStatus('stopped', 'Capture stopped.');
  });

  mediaRecorder.start(Number(chunkMs) || 4000);
  postStatus('active', 'Listening to this tab...');
}

function stopCapture() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
  mediaRecorder = null;

  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
  }
  audioContext = null;
}

function keepCapturedAudioAudible(stream) {
  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(audioContext.destination);
}

async function transcribeBlob(blob) {
  const { startedAt, endedAt } = chunkTimer.nextChunkTiming();
  const currentSequence = sequence;
  sequence += 1;

  const result = await client.transcribeChunk({
    blob,
    sequence: currentSequence,
    startedAt,
    endedAt,
    sourceUrl,
  });

  if (result.warning) {
    postStatus('warning', result.warning);
  }

  if (result.isEmpty) {
    return;
  }

  chrome.runtime.sendMessage({
    target: 'background',
    type: 'TRANSCRIPT_SEGMENT',
    segment: createAudioTranscriptSegment({
      sequence: currentSequence,
      result,
      startedAt,
      endedAt,
    }),
  });
}

function chooseMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function postStatus(status, detail = '') {
  chrome.runtime.sendMessage({
    target: 'background',
    type: 'CAPTURE_STATUS',
    status,
    detail,
  });
}
