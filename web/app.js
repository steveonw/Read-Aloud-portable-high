'use strict';

const draft = document.getElementById('draft');
const readButton = document.getElementById('readButton');
const stopButton = document.getElementById('stopButton');
const clearButton = document.getElementById('clearButton');
const speed = document.getElementById('speed');
const speedValue = document.getElementById('speedValue');
const selectionInfo = document.getElementById('selectionInfo');
const statusDot = document.getElementById('statusDot');
const statusTitle = document.getElementById('statusTitle');
const statusDetail = document.getElementById('statusDetail');

let ready = false;
let generating = false;
let audioContext = null;
let currentSource = null;
let worker = null;
const openedDirectly = window.location.protocol === 'file:';

if (!openedDirectly) {
  worker = new Worker('sherpa-onnx-tts.worker.js', {type: 'module'});
}

function setStatus(kind, title, detail) {
  statusDot.className = `dot ${kind}`;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
}

function updateButtons() {
  readButton.disabled = !ready || generating;
  stopButton.disabled = !currentSource;
}

function describeSelection() {
  const start = draft.selectionStart;
  const end = draft.selectionEnd;
  if (start !== end) {
    const count = draft.value.slice(start, end).trim().length;
    selectionInfo.textContent = count > 0
      ? `${count} characters selected. Press F8 to read them.`
      : 'The selection contains no readable text.';
  } else {
    selectionInfo.textContent = 'Nothing selected. F8 will read the sentence at the cursor.';
  }
}

function textToRead() {
  const value = draft.value;
  let start = draft.selectionStart;
  let end = draft.selectionEnd;

  if (start !== end) {
    return value.slice(start, end).trim();
  }

  if (!value.trim()) return '';

  const left = value.slice(0, start);
  const right = value.slice(start);
  const leftMatch = Math.max(
    left.lastIndexOf('.'),
    left.lastIndexOf('!'),
    left.lastIndexOf('?'),
    left.lastIndexOf('\n')
  );

  const rightCandidates = ['.', '!', '?', '\n']
    .map((mark) => right.indexOf(mark))
    .filter((index) => index >= 0);
  const rightMatch = rightCandidates.length ? Math.min(...rightCandidates) + 1 : right.length;

  start = leftMatch >= 0 ? leftMatch + 1 : 0;
  end = draft.selectionStart + rightMatch;

  let sentence = value.slice(start, end).trim();
  if (!sentence) sentence = value.trim();
  return sentence;
}

async function play(samples, sampleRate) {
  stopPlayback();
  audioContext ??= new AudioContext();
  await audioContext.resume();

  const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
  buffer.getChannelData(0).set(samples);

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.onended = () => {
    if (currentSource === source) {
      currentSource = null;
      setStatus('ready', 'Lessac High is ready', 'Highlight another sentence and press F8.');
      updateButtons();
    }
  };

  currentSource = source;
  setStatus('speaking', 'Speaking…', 'Press Esc or Stop to interrupt playback.');
  updateButtons();
  source.start();
}

function stopPlayback() {
  if (!currentSource) return;
  const source = currentSource;
  currentSource = null;
  source.onended = null;
  try {
    source.stop();
  } catch (_) {
    // The source may already have stopped.
  }
  setStatus('ready', 'Lessac High is ready', 'Highlight a sentence and press F8.');
  updateButtons();
}

function requestSpeech() {
  if (!ready || generating) return;
  const text = textToRead();
  if (!text) {
    setStatus('error', 'Nothing to read', 'Paste text or select a sentence first.');
    return;
  }
  if (text.length > 1800) {
    setStatus('error', 'Selection is too long', 'Choose a shorter passage, ideally one sentence.');
    return;
  }

  generating = true;
  updateButtons();
  setStatus('loading', 'Generating speech…', text.length > 180 ? 'Long selections take a little longer.' : 'Lessac High is preparing the sentence.');
  if (!worker) {
    setStatus('error', 'Start with the launcher', 'Do not open shared/index.html directly. Open START - WINDOWS.exe, START - MACOS.app, or START - LINUX.sh.');
    return;
  }
  worker.postMessage({
    type: 'generate',
    text,
    sid: 0,
    speed: Number(speed.value),
  });
}

if (worker) worker.onmessage = async (event) => {
  const message = event.data || {};
  switch (message.type) {
    case 'sherpa-onnx-tts-progress': {
      const raw = String(message.status || 'Loading voice…');
      const match = raw.match(/Downloading data\.\.\. \((\d+)\/(\d+)\)/);
      if (match) {
        const received = Number(match[1]);
        const total = Number(match[2]);
        const percent = total > 0 ? Math.round((received / total) * 100) : 0;
        setStatus('loading', `Loading Lessac High… ${percent}%`, 'Reading the offline model from this drive.');
      } else {
        setStatus('loading', 'Loading Lessac High…', raw.replace('Running...', 'Initializing the voice model…'));
      }
      break;
    }
    case 'sherpa-onnx-tts-ready':
      ready = true;
      generating = false;
      setStatus('ready', 'Lessac High is ready', 'Highlight a sentence and press F8.');
      updateButtons();
      break;
    case 'sherpa-onnx-tts-result':
      generating = false;
      updateButtons();
      await play(message.samples, message.sampleRate);
      break;
    case 'error':
      generating = false;
      setStatus('error', 'Voice error', String(message.message || 'The speech engine failed.'));
      updateButtons();
      break;
    default:
      break;
  }
};

if (worker) worker.onerror = (event) => {
  ready = false;
  generating = false;
  setStatus('error', 'Could not load the voice', event.message || 'Check that the generated WASM files are present.');
  updateButtons();
};

readButton.addEventListener('click', requestSpeech);
stopButton.addEventListener('click', stopPlayback);
clearButton.addEventListener('click', () => {
  draft.value = '';
  draft.focus();
  describeSelection();
});

speed.addEventListener('input', () => {
  speedValue.value = `${Number(speed.value).toFixed(2)}×`;
});

for (const eventName of ['select', 'keyup', 'click', 'input']) {
  draft.addEventListener(eventName, describeSelection);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'F8') {
    event.preventDefault();
    requestSpeech();
  } else if (event.key === 'Escape') {
    stopPlayback();
  }
});

window.addEventListener('beforeunload', () => {
  stopPlayback();
  if (worker) worker.terminate();
  if (audioContext) void audioContext.close();
});

describeSelection();
updateButtons();

if (openedDirectly) {
  setStatus('error', 'Start with the launcher', 'This page cannot load the voice from file://. Open the matching START launcher in the parent folder.');
}
