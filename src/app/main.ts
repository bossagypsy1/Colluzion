// Live editor wiring. The LivePlayer drives everything from the music clock;
// UI controls only edit project data, which the next frame picks up.

import './style.css';
import { conditionSignal } from '../core/analysis/envelope.ts';
import type { MediaRef } from '../core/project/model.ts';
import { computeFrameState } from '../core/render/frameState.ts';
import { synthTestBeat, TEST_MEDIA_DURATION } from '../core/testMedia.ts';
import { probeCapabilities } from '../platform/web/capabilities.ts';
import { errorMessage } from '../platform/web/frameSources.ts';
import { analyzeInWorker, audioContext, decodeAudioFile, fingerprint, probeVideo } from '../platform/web/media.ts';
import { LivePlayer, type VideoMode } from '../platform/web/player.ts';
import { GlRenderer } from '../platform/web/renderer.ts';
import { buildEffectControls, updateEffectReadouts } from './effectControls.ts';
import { EnvelopeView } from './envelopeView.ts';
import { initExportPanel } from './exportPanel.ts';
import { $, formatTime, hasVideo, log, state } from './state.ts';

const ui = {
  build: $('build'),
  preview: $<HTMLCanvasElement>('preview'),
  sourceVideo: $<HTMLVideoElement>('source-video'),
  emptyHint: $('empty-hint'),
  seek: $<HTMLInputElement>('seek'),
  play: $<HTMLButtonElement>('play'),
  back5: $<HTMLButtonElement>('back5'),
  fwd5: $<HTMLButtonElement>('fwd5'),
  frameBack: $<HTMLButtonElement>('frame-back'),
  frameFwd: $<HTMLButtonElement>('frame-fwd'),
  time: $('time'),
  loop: $<HTMLInputElement>('loop'),
  stats: $('stats'),
  params: $('params'),
  fxName: $('fx-name'),
  envelope: $<HTMLCanvasElement>('envelope'),
  bandTabs: $('band-tabs'),
  attack: $<HTMLInputElement>('attack'),
  release: $<HTMLInputElement>('release'),
  gain: $<HTMLInputElement>('gain'),
  threshold: $<HTMLInputElement>('threshold'),
  analysisInfo: $('analysis-info'),
  audioFile: $<HTMLInputElement>('audio-file'),
  videoFile: $<HTMLInputElement>('video-file'),
  testMedia: $<HTMLButtonElement>('test-media'),
  audioInfo: $('audio-info'),
  videoInfo: $('video-info'),
  inPoint: $<HTMLInputElement>('in-point'),
  syncTime: $<HTMLInputElement>('sync-time'),
  syncHere: $<HTMLButtonElement>('sync-here'),
  previewRes: $<HTMLSelectElement>('preview-res'),
  avOffset: $<HTMLInputElement>('av-offset'),
  offsetVal: $('offset-val'),
  probe: $<HTMLButtonElement>('probe'),
  caps: $('caps'),
};

ui.build.textContent = import.meta.env.VITE_BUILD ? `build ${String(import.meta.env.VITE_BUILD).slice(0, 7)}` : 'dev build';
window.addEventListener('error', (e) => log(`Error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => log(`Error: ${errorMessage(e.reason)}`));

// ---------- Engine ----------

const meters = ['bass', 'mid', 'treble'].map((id) => ({ id, bar: $(`m-${id}`), val: $(`v-${id}`), last: NaN }));
const envelopeView = new EnvelopeView(ui.envelope);
let lastSeekUpdate = 0;
const statsAcc = { cpu: 0, drift: 0, n: 0, since: 0 };
let seekDragging = false;
let resumeAfterSeek = false;

const player = new LivePlayer(new GlRenderer(ui.preview), ui.sourceVideo, {
  frameAt: (t) => computeFrameState(state.project, state.signals, t, state.videoDuration),
  onFrame: (frame, playing, stats) => {
    const now = performance.now();
    ui.time.textContent = `${formatTime(frame.musicTime)} / ${formatTime(player.duration)}`;
    if (playing && !seekDragging && now - lastSeekUpdate > 100) {
      ui.seek.value = String(player.time);
      lastSeekUpdate = now;
    }
    for (const m of meters) {
      const v = frame.signals[m.id] ?? 0;
      if (Math.abs(v - m.last) < 0.003) continue;
      m.last = v;
      m.bar.style.transform = `scaleX(${v})`;
      m.val.textContent = v.toFixed(2);
    }
    updateEffectReadouts(frame);
    envelopeView.draw(frame.musicTime);
    // Average over half a second and refresh the text twice a second so it is readable.
    statsAcc.cpu += stats.cpuMs;
    statsAcc.drift += stats.driftMs;
    statsAcc.n++;
    if (now - statsAcc.since >= 500) {
      const cpu = statsAcc.cpu / statsAcc.n;
      const drift = playing && state.videoFile ? ` · video drift ${Math.round(statsAcc.drift / statsAcc.n)} ms` : '';
      ui.stats.textContent = `${ui.preview.width}×${ui.preview.height} · ${Math.round(stats.fps)} fps · ${cpu.toFixed(1)} ms/frame${drift}`;
      statsAcc.cpu = statsAcc.drift = statsAcc.n = 0;
      statsAcc.since = now;
    }
  },
  onStateChange: (playing) => {
    ui.play.textContent = playing ? 'Pause' : 'Play';
  },
});

// ---------- Transport ----------

const frameStep = () => 1 / state.project.export.fps;

ui.play.addEventListener('click', () => player.toggle());
ui.preview.addEventListener('click', () => { if (!ui.play.disabled) player.toggle(); });
ui.back5.addEventListener('click', () => player.seek(player.time - 5));
ui.fwd5.addEventListener('click', () => player.seek(player.time + 5));
ui.frameBack.addEventListener('click', () => { player.pause(); player.seek(snapToFrame(player.time) - frameStep()); });
ui.frameFwd.addEventListener('click', () => { player.pause(); player.seek(snapToFrame(player.time) + frameStep()); });
ui.seek.addEventListener('pointerdown', () => {
  seekDragging = true;
  resumeAfterSeek = player.isPlaying;
  player.pause();
});
ui.seek.addEventListener('input', () => player.seek(Number(ui.seek.value)));
ui.seek.addEventListener('change', () => {
  seekDragging = false;
  if (resumeAfterSeek) player.play();
  resumeAfterSeek = false;
});
ui.loop.addEventListener('change', () => syncLoop());

function snapToFrame(t: number): number {
  return Math.round(t / frameStep()) * frameStep();
}

function syncLoop(): void {
  const r = state.project.exportRange;
  player.loop = { enabled: ui.loop.checked, start: r.start, end: r.start + r.duration };
}

// ---------- Bands ----------

let selectedBand = 'bass';
const cond = () => state.project.analysis.conditioning[selectedBand]!;
const condSliders: [HTMLInputElement, 'attackMs' | 'releaseMs' | 'gain' | 'threshold', (v: number) => string][] = [
  [ui.attack, 'attackMs', (v) => `${v} ms`],
  [ui.release, 'releaseMs', (v) => `${v} ms`],
  [ui.gain, 'gain', (v) => `×${v.toFixed(2)}`],
  [ui.threshold, 'threshold', (v) => v.toFixed(2)],
];

for (const band of state.project.analysis.bands) {
  const b = document.createElement('button');
  b.textContent = band.label;
  b.dataset.band = band.id;
  b.addEventListener('click', () => selectBand(band.id));
  ui.bandTabs.append(b);
}

for (const [input, key, fmt] of condSliders) {
  input.addEventListener('input', () => {
    cond()[key] = Number(input.value);
    $(`${input.id}-val`).textContent = fmt(cond()[key]);
    recondition(selectedBand);
  });
}

function selectBand(id: string): void {
  selectedBand = id;
  envelopeView.selected = id;
  for (const b of ui.bandTabs.querySelectorAll('button')) b.classList.toggle('active', b.dataset.band === id);
  for (const [input, key, fmt] of condSliders) {
    input.value = String(cond()[key]);
    $(`${input.id}-val`).textContent = fmt(cond()[key]);
  }
}

/** Re-runs the cheap conditioning stage; the visuals pick it up on the next frame. */
function recondition(only?: string): void {
  const a = state.analysis;
  if (!a) return;
  const next = a.bands
    .filter((b) => !only || b.band.id === only)
    .map((b) => conditionSignal(b.band.id, b.rms, a.frameRate, state.project.analysis.conditioning[b.band.id]!));
  state.signals = only ? state.signals.map((s) => next.find((n) => n.id === s.id) ?? s) : next;
}

// ---------- Media ----------

ui.audioFile.addEventListener('change', async () => {
  const file = ui.audioFile.files?.[0];
  if (!file) return;
  try {
    ui.audioInfo.textContent = `Decoding ${file.name}…`;
    const buffer = await decodeAudioFile(file);
    state.project.media.audio = fileRef(file);
    ui.audioInfo.textContent = `${file.name}: ${formatTime(buffer.duration)}, ${buffer.sampleRate} Hz, ${buffer.numberOfChannels} ch`;
    log(`Music loaded: ${ui.audioInfo.textContent}`);
    await setAudio(buffer, fingerprint(file));
  } catch (e) {
    ui.audioInfo.textContent = errorMessage(e);
    log(errorMessage(e));
  }
});

ui.videoFile.addEventListener('change', async () => {
  const file = ui.videoFile.files?.[0];
  if (!file) return;
  try {
    ui.videoInfo.textContent = `Reading ${file.name}…`;
    const info = await probeVideo(file);
    state.videoFile = file;
    state.videoDuration = info.duration;
    state.project.media.video = fileRef(file);
    if (ui.sourceVideo.src) URL.revokeObjectURL(ui.sourceVideo.src);
    ui.sourceVideo.src = URL.createObjectURL(file);
    setVideoMode('file');
    ui.videoInfo.textContent =
      `${file.name}: ${formatTime(info.duration)}, ${info.width}×${info.height}, ${info.codec}` +
      (info.canDecode ? '' : ' — WebCodecs cannot decode this; export will use the slower fallback');
    log(`Video loaded: ${ui.videoInfo.textContent}`);
  } catch (e) {
    ui.videoInfo.textContent = errorMessage(e);
    log(errorMessage(e));
  }
  refresh();
});

ui.testMedia.addEventListener('click', async () => {
  const ctx = audioContext();
  const mono = synthTestBeat(ctx.sampleRate);
  const buffer = new AudioBuffer({ numberOfChannels: 2, length: mono.length, sampleRate: ctx.sampleRate });
  buffer.copyToChannel(mono, 0);
  buffer.copyToChannel(mono, 1);
  state.videoFile = null;
  state.videoDuration = TEST_MEDIA_DURATION;
  state.project.media.audio = { kind: 'generated', name: 'Test beat (2 per second)', generator: 'test-beat' };
  state.project.media.video = { kind: 'generated', name: 'Test pattern', generator: 'test-pattern' };
  state.project.clip = { inPoint: 0, syncMusicTime: 0 };
  state.project.exportRange = { start: 0, duration: 10 };
  ui.sourceVideo.removeAttribute('src');
  setVideoMode('pattern');
  ui.audioInfo.textContent = `Test beat: bass thump every 0.5 s, ${ctx.sampleRate} Hz, ${TEST_MEDIA_DURATION} s`;
  ui.videoInfo.textContent = 'Test pattern: white centre square on each beat (used for the export sync check)';
  log('Loaded built-in test media');
  await setAudio(buffer, 'generated:test-beat');
});

async function setAudio(buffer: AudioBuffer, sourceFingerprint: string): Promise<void> {
  state.audio = buffer;
  player.setAudio(buffer);
  ui.seek.max = String(buffer.duration);
  ui.seek.value = '0';
  ui.analysisInfo.textContent = 'Analysing…';
  const t0 = performance.now();
  state.analysis = await analyzeInWorker(buffer, state.project.analysis.bands, state.project.analysis.frameRate, sourceFingerprint);
  const a = state.analysis;
  ui.analysisInfo.textContent =
    `${a.bands.length} bands × ${a.bands[0]?.rms.length ?? 0} frames at ${a.frameRate}/s, analysed in ${(performance.now() - t0).toFixed(0)} ms`;
  log(`Analysis: ${ui.analysisInfo.textContent}`);
  recondition();
  refresh();
}

function setVideoMode(mode: VideoMode): void {
  player.setVideoMode(mode);
  ui.emptyHint.hidden = mode !== 'none';
}

function fileRef(file: File): MediaRef {
  return { kind: 'file', name: file.name, size: file.size, lastModified: file.lastModified, mimeType: file.type };
}

const readClip = () => {
  state.project.clip = {
    inPoint: Math.max(0, Number(ui.inPoint.value) || 0),
    syncMusicTime: Math.max(0, Number(ui.syncTime.value) || 0),
  };
  player.refresh();
};
ui.inPoint.addEventListener('change', readClip);
ui.syncTime.addEventListener('change', readClip);
ui.syncHere.addEventListener('click', () => {
  ui.syncTime.value = player.time.toFixed(2);
  readClip();
});

// ---------- Preview settings ----------

function applyPreviewRes(): void {
  const [w, h] = ui.previewRes.value.split('x').map(Number) as [number, number];
  player.setPreviewSize(w, h);
}
ui.previewRes.addEventListener('change', applyPreviewRes);

ui.avOffset.addEventListener('input', () => {
  player.avOffset = Number(ui.avOffset.value) / 1000;
  ui.offsetVal.textContent = `${ui.avOffset.value} ms`;
});
ui.offsetVal.textContent = '0 ms';

// ---------- Export + refresh ----------

const exportPanel = initExportPanel(player, () => syncLoop());

function refresh(): void {
  const ready = !!state.audio && state.signals.length > 0;
  for (const b of [ui.play, ui.seek, ui.back5, ui.fwd5, ui.frameBack, ui.frameFwd]) b.disabled = !ready;
  ui.syncHere.disabled = !ready;
  ui.inPoint.value = String(state.project.clip.inPoint);
  ui.syncTime.value = String(state.project.clip.syncMusicTime);
  ui.emptyHint.hidden = hasVideo();
  if (ready && !hasVideo()) ui.emptyHint.textContent = 'Music loaded. Add a video to see effects.';
  syncLoop();
  exportPanel.refresh();
  player.refresh();
}

// ---------- Device check ----------

ui.probe.addEventListener('click', async () => {
  ui.caps.hidden = false;
  ui.caps.textContent = 'Checking…';
  try {
    const caps = await probeCapabilities();
    ui.caps.textContent = JSON.stringify(caps, null, 2);
    log(`Device check: H.264 ${JSON.stringify(caps.h264)}, AAC48k ${caps.aac48k}, AAC44k ${caps.aac44k}, Opus ${caps.opus48k}`);
  } catch (e) {
    ui.caps.textContent = errorMessage(e);
  }
});

buildEffectControls(ui.params, ui.fxName);
selectBand('bass');
applyPreviewRes();
refresh();
log('Ready. Load music + video, or tap “Test media”.');
