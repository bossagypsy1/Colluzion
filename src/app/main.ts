// Phase 1 UI wiring. Keeps no audio/render logic of its own: it calls core/
// (pure, deterministic) and platform/web/ (browser adapters).

import './style.css';
import type { AnalysisResult } from '../core/analysis/analyze.ts';
import { conditionSignal, sampleSignal, type ControlSignal } from '../core/analysis/envelope.ts';
import { createDefaultProject, type MediaRef } from '../core/project/model.ts';
import { computeFrameState } from '../core/render/frameState.ts';
import { synthTestBeat, TEST_MEDIA_DURATION } from '../core/testMedia.ts';
import { probeCapabilities } from '../platform/web/capabilities.ts';
import { WebCodecsMp4Exporter } from '../platform/web/exporter.ts';
import {
  errorMessage,
  TestPatternFrameSource,
  VideoElementFrameSource,
  WebCodecsFrameSource,
  type FrameSource,
} from '../platform/web/frameSources.ts';
import { analyzeInWorker, audioContext, decodeAudioFile, fingerprint, probeVideo } from '../platform/web/media.ts';
import { GlRenderer } from '../platform/web/renderer.ts';
import { drawTestPattern } from '../platform/web/testPattern.ts';
import { verifyMp4 } from '../platform/web/verify.ts';

// ---------- DOM ----------

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const ui = {
  build: $('build'),
  preview: $<HTMLCanvasElement>('preview'),
  play: $<HTMLButtonElement>('play'),
  time: $('time'),
  seek: $<HTMLInputElement>('seek'),
  audioFile: $<HTMLInputElement>('audio-file'),
  videoFile: $<HTMLInputElement>('video-file'),
  testMedia: $<HTMLButtonElement>('test-media'),
  audioInfo: $('audio-info'),
  videoInfo: $('video-info'),
  musicStart: $<HTMLInputElement>('music-start'),
  videoStart: $<HTMLInputElement>('video-start'),
  duration: $<HTMLInputElement>('duration'),
  analysisInfo: $('analysis-info'),
  envelope: $<HTMLCanvasElement>('envelope'),
  attack: $<HTMLInputElement>('attack'),
  release: $<HTMLInputElement>('release'),
  gain: $<HTMLInputElement>('gain'),
  threshold: $<HTMLInputElement>('threshold'),
  zoomAmt: $<HTMLInputElement>('zoom-amt'),
  dispAmt: $<HTMLInputElement>('disp-amt'),
  resolution: $<HTMLSelectElement>('resolution'),
  fps: $<HTMLSelectElement>('fps'),
  opus: $<HTMLInputElement>('opus-fallback'),
  exportBtn: $<HTMLButtonElement>('export'),
  cancel: $<HTMLButtonElement>('cancel'),
  progress: $<HTMLProgressElement>('progress'),
  exportStatus: $('export-status'),
  report: $('report'),
  result: $('result'),
  resultVideo: $<HTMLVideoElement>('result-video'),
  download: $<HTMLAnchorElement>('download'),
  share: $<HTMLButtonElement>('share'),
  probe: $<HTMLButtonElement>('probe'),
  caps: $('caps'),
  log: $('log'),
};

ui.build.textContent = import.meta.env.VITE_BUILD ? `build ${String(import.meta.env.VITE_BUILD).slice(0, 7)}` : 'dev build';

function log(msg: string): void {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  ui.log.textContent = line + (ui.log.textContent ?? '');
  console.log(msg);
}
window.addEventListener('error', (e) => log(`Error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => log(`Error: ${errorMessage(e.reason)}`));

// ---------- State ----------

const project = createDefaultProject();
let audio: AudioBuffer | null = null;
let videoFile: File | null = null;
let videoDuration = 0;
let analysis: AnalysisResult | null = null;
let signals: ControlSignal[] = [];
let exporting: AbortController | null = null;

const renderer = new GlRenderer(ui.preview);
const previewVideo = document.createElement('video');
previewVideo.muted = true;
previewVideo.playsInline = true;
previewVideo.preload = 'auto';
previewVideo.loop = false;
const patternCanvas = document.createElement('canvas');
patternCanvas.width = 640;
patternCanvas.height = 360;
const patternCtx = patternCanvas.getContext('2d')!;

const playback = {
  playing: false,
  localTime: 0,
  ctxStart: 0,
  localStart: 0,
  node: null as AudioBufferSourceNode | null,
};

const isTestVideo = () => project.media.video?.generator === 'test-pattern';
const hasVideo = () => isTestVideo() || videoFile !== null;

// ---------- Media import ----------

ui.audioFile.addEventListener('change', async () => {
  const file = ui.audioFile.files?.[0];
  if (!file) return;
  stopPlayback();
  try {
    ui.audioInfo.textContent = `Decoding ${file.name}…`;
    audio = await decodeAudioFile(file);
    project.media.audio = fileRef(file);
    ui.audioInfo.textContent = `${file.name}: ${audio.duration.toFixed(2)} s, ${audio.sampleRate} Hz, ${audio.numberOfChannels} ch`;
    log(`Music loaded: ${ui.audioInfo.textContent}`);
    await runAnalysis(fingerprint(file));
  } catch (e) {
    ui.audioInfo.textContent = errorMessage(e);
    log(errorMessage(e));
  }
  refresh();
});

ui.videoFile.addEventListener('change', async () => {
  const file = ui.videoFile.files?.[0];
  if (!file) return;
  stopPlayback();
  try {
    ui.videoInfo.textContent = `Reading ${file.name}…`;
    const info = await probeVideo(file);
    videoFile = file;
    videoDuration = info.duration;
    project.media.video = fileRef(file);
    URL.revokeObjectURL(previewVideo.src);
    previewVideo.src = URL.createObjectURL(file);
    ui.videoInfo.textContent =
      `${file.name}: ${info.duration.toFixed(2)} s, ${info.width}×${info.height}, ${info.codec}` +
      (info.canDecode ? '' : ' — WebCodecs cannot decode this; export will use the slower fallback');
    log(`Video loaded: ${ui.videoInfo.textContent}`);
  } catch (e) {
    ui.videoInfo.textContent = errorMessage(e);
    log(errorMessage(e));
  }
  refresh();
});

ui.testMedia.addEventListener('click', async () => {
  stopPlayback();
  const ctx = audioContext();
  const mono = synthTestBeat(ctx.sampleRate);
  audio = new AudioBuffer({ numberOfChannels: 2, length: mono.length, sampleRate: ctx.sampleRate });
  audio.copyToChannel(mono, 0);
  audio.copyToChannel(mono, 1);
  videoFile = null;
  videoDuration = TEST_MEDIA_DURATION;
  project.media.audio = { kind: 'generated', name: 'Test beat (2 per second)', generator: 'test-beat' };
  project.media.video = { kind: 'generated', name: 'Test pattern', generator: 'test-pattern' };
  project.segment = { musicStart: 0, videoStart: 0, duration: 10 };
  ui.audioInfo.textContent = `Test beat: bass thump every 0.5 s, ${ctx.sampleRate} Hz`;
  ui.videoInfo.textContent = 'Test pattern: white centre square on each beat (used for the sync check)';
  log('Loaded built-in test media');
  await runAnalysis('generated:test-beat');
  refresh();
});

function fileRef(file: File): MediaRef {
  return { kind: 'file', name: file.name, size: file.size, lastModified: file.lastModified, mimeType: file.type };
}

async function runAnalysis(sourceFingerprint: string): Promise<void> {
  if (!audio) return;
  ui.analysisInfo.textContent = 'Analysing…';
  const t0 = performance.now();
  analysis = await analyzeInWorker(audio, project.analysis.bands, project.analysis.frameRate, sourceFingerprint);
  const ms = performance.now() - t0;
  ui.analysisInfo.textContent =
    `${analysis.bands.length} bands × ${analysis.bands[0]?.rms.length ?? 0} frames at ${analysis.frameRate}/s in ${ms.toFixed(0)} ms`;
  log(`Analysis: ${ui.analysisInfo.textContent}`);
  recondition();
}

function recondition(): void {
  if (!analysis) return;
  signals = analysis.bands.map((b) =>
    conditionSignal(b.band.id, b.rms, analysis!.frameRate, project.analysis.conditioning[b.band.id]!),
  );
  drawEnvelope();
}

// ---------- Controls ----------

const bassCond = () => project.analysis.conditioning['bass']!;
const zoomConn = () => project.routing.find((r) => r.id === 'r1')!;
const dispConn = () => project.routing.find((r) => r.id === 'r2')!;

function bindRange(input: HTMLInputElement, get: () => number, set: (v: number) => void, fmt: (v: number) => string, onChange: () => void) {
  const label = $(input.id.replace(/-amt$/, '') + '-val');
  input.value = String(get());
  label.textContent = fmt(get());
  input.addEventListener('input', () => {
    set(Number(input.value));
    label.textContent = fmt(get());
    onChange();
  });
}

bindRange(ui.attack, () => bassCond().attackMs, (v) => (bassCond().attackMs = v), (v) => `${v} ms`, recondition);
bindRange(ui.release, () => bassCond().releaseMs, (v) => (bassCond().releaseMs = v), (v) => `${v} ms`, recondition);
bindRange(ui.gain, () => bassCond().gain, (v) => (bassCond().gain = v), (v) => `×${v.toFixed(2)}`, recondition);
bindRange(ui.threshold, () => bassCond().threshold, (v) => (bassCond().threshold = v), (v) => v.toFixed(2), recondition);
bindRange(ui.zoomAmt, () => zoomConn().gain, (v) => (zoomConn().gain = v), (v) => v.toFixed(2), () => {});
bindRange(ui.dispAmt, () => dispConn().gain, (v) => (dispConn().gain = v), (v) => v.toFixed(3), () => {});

for (const input of [ui.musicStart, ui.videoStart, ui.duration]) {
  input.addEventListener('change', () => {
    stopPlayback();
    project.segment = {
      musicStart: Math.max(0, Number(ui.musicStart.value) || 0),
      videoStart: Math.max(0, Number(ui.videoStart.value) || 0),
      duration: Math.min(60, Math.max(1, Number(ui.duration.value) || 10)),
    };
    playback.localTime = 0;
    refresh();
  });
}

ui.seek.addEventListener('input', () => {
  const wasPlaying = playback.playing;
  stopPlayback();
  playback.localTime = Number(ui.seek.value);
  syncPreviewVideo(true);
  if (wasPlaying) startPlayback();
});

ui.play.addEventListener('click', () => (playback.playing ? stopPlayback() : startPlayback()));

function refresh(): void {
  const s = project.segment;
  ui.musicStart.value = String(s.musicStart);
  ui.videoStart.value = String(s.videoStart);
  ui.duration.value = String(s.duration);
  ui.seek.max = String(s.duration);
  const ready = !!audio && hasVideo() && signals.length > 0;
  ui.play.disabled = !ready;
  ui.seek.disabled = !ready;
  ui.exportBtn.disabled = !ready || exporting !== null;
  if (audio && s.musicStart + s.duration > audio.duration) {
    ui.analysisInfo.textContent = `Warning: segment ends after the music (${audio.duration.toFixed(2)} s).`;
  }
  drawEnvelope();
  syncPreviewVideo(true);
}

// ---------- Preview playback (audio clock is the master) ----------

function startPlayback(): void {
  if (!audio) return;
  const ctx = audioContext();
  void ctx.resume();
  if (playback.localTime >= project.segment.duration - 0.01) playback.localTime = 0;
  const node = ctx.createBufferSource();
  node.buffer = audio;
  node.connect(ctx.destination);
  const remaining = project.segment.duration - playback.localTime;
  const when = ctx.currentTime + 0.05;
  node.start(when, project.segment.musicStart + playback.localTime, remaining);
  node.onended = () => {
    if (playback.node === node) {
      stopPlayback();
      playback.localTime = 0;
    }
  };
  playback.node = node;
  playback.ctxStart = when;
  playback.localStart = playback.localTime;
  playback.playing = true;
  ui.play.textContent = 'Pause';
  syncPreviewVideo(true);
  if (!isTestVideo()) void previewVideo.play().catch(() => {});
}

function stopPlayback(): void {
  if (playback.node) {
    const node = playback.node;
    playback.node = null;
    try { node.stop(); } catch { /* already stopped */ }
  }
  playback.playing = false;
  ui.play.textContent = 'Play';
  previewVideo.pause();
}

function currentLocalTime(): number {
  if (!playback.playing) return playback.localTime;
  const ctx = audioContext();
  // Compensate for output latency so visuals line up with what is heard.
  const t = playback.localStart + (ctx.currentTime - playback.ctxStart) - (ctx.outputLatency || 0);
  return Math.min(Math.max(t, playback.localStart), project.segment.duration);
}

function syncPreviewVideo(force: boolean): void {
  if (isTestVideo() || !videoFile || previewVideo.readyState < 1) return;
  const target = computeFrameState(project, signals, playback.localTime, videoDuration).videoTime;
  if (force || Math.abs(previewVideo.currentTime - target) > 0.15) previewVideo.currentTime = target;
}

function frameLoop(): void {
  playback.localTime = currentLocalTime();
  const frame = computeFrameState(project, signals, playback.localTime, videoDuration);
  if (isTestVideo()) {
    drawTestPattern(patternCtx, patternCanvas.width, patternCanvas.height, frame.videoTime);
    renderer.setSource({ image: patternCanvas, width: patternCanvas.width, height: patternCanvas.height });
  } else if (videoFile && previewVideo.readyState >= 2) {
    if (playback.playing) syncPreviewVideo(false);
    renderer.setSource({ image: previewVideo, width: previewVideo.videoWidth, height: previewVideo.videoHeight });
  }
  renderer.render(frame);
  ui.time.textContent = `${playback.localTime.toFixed(2)} / ${project.segment.duration.toFixed(2)}  bass ${(frame.signals['bass'] ?? 0).toFixed(2)}`;
  if (playback.playing) ui.seek.value = String(playback.localTime);
  drawPlayhead();
  requestAnimationFrame(frameLoop);
}
requestAnimationFrame(frameLoop);

// ---------- Envelope graph ----------

let envelopeImage: ImageData | null = null;

function drawEnvelope(): void {
  const c = ui.envelope;
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(c.clientWidth * dpr);
  c.height = Math.round(120 * dpr);
  const g = c.getContext('2d')!;
  g.fillStyle = '#0c0f13';
  g.fillRect(0, 0, c.width, c.height);
  const bass = signals.find((s) => s.id === 'bass');
  if (!bass) { envelopeImage = null; return; }
  const { musicStart, duration } = project.segment;
  g.strokeStyle = '#e0602a';
  g.lineWidth = 2 * dpr;
  g.beginPath();
  for (let x = 0; x < c.width; x++) {
    const v = sampleSignal(bass, musicStart + (x / c.width) * duration);
    const y = c.height - v * (c.height - 4 * dpr) - 2 * dpr;
    if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
  envelopeImage = g.getImageData(0, 0, c.width, c.height);
}

function drawPlayhead(): void {
  if (!envelopeImage) return;
  const c = ui.envelope;
  const g = c.getContext('2d')!;
  g.putImageData(envelopeImage, 0, 0);
  const x = (playback.localTime / project.segment.duration) * c.width;
  g.fillStyle = '#ffffff';
  g.fillRect(x, 0, Math.max(1, window.devicePixelRatio || 1), c.height);
}

window.addEventListener('resize', drawEnvelope);

// ---------- Export ----------

ui.exportBtn.addEventListener('click', () => void runExport());
ui.cancel.addEventListener('click', () => exporting?.abort());

async function runExport(): Promise<void> {
  if (!audio || !hasVideo()) return;
  stopPlayback();
  const [w, h] = ui.resolution.value.split('x').map(Number) as [number, number];
  project.export = { width: w, height: h, fps: Number(ui.fps.value), allowOpusFallback: ui.opus.checked };
  exporting = new AbortController();
  ui.exportBtn.disabled = true;
  ui.cancel.hidden = false;
  ui.progress.hidden = false;
  ui.progress.value = 0;
  ui.report.hidden = true;
  ui.result.hidden = true;
  ui.exportStatus.textContent = 'Preparing…';
  log(`Export started: ${w}×${h} @ ${project.export.fps} fps, ${project.segment.duration} s`);

  let source: FrameSource | null = null;
  try {
    source = await openFrameSource(w, h);
    log(`Frame source: ${source.kind}`);
    const result = await new WebCodecsMp4Exporter().export({
      project: structuredClone(project),
      signals,
      audio,
      videoDuration,
      frameSource: source,
      signal: exporting.signal,
      onProgress: (f, msg) => {
        ui.progress.value = f;
        ui.exportStatus.textContent = msg;
      },
    });
    for (const wmsg of result.warnings) log(`Warning: ${wmsg}`);
    const speed = (result.durationSec * 1000) / result.elapsedMs;
    log(`Encoded ${result.frames} frames (${result.videoCodec} + ${result.audioCodec}) in ${(result.elapsedMs / 1000).toFixed(1)} s (${speed.toFixed(2)}× real time)`);

    ui.exportStatus.textContent = 'Verifying the exported file…';
    const report = await verifyMp4(result.blob, {
      durationSec: project.segment.duration,
      fps: project.export.fps,
      testMediaSync: isTestVideo() && project.media.audio?.generator === 'test-beat' &&
        project.segment.musicStart === 0 && project.segment.videoStart === 0,
    });
    const header = [
      `Export ${report.ok ? 'VERIFIED' : 'HAS PROBLEMS'}`,
      `${w}×${h} @ ${project.export.fps} fps, ${result.durationSec} s, ${(result.blob.size / 1024 / 1024).toFixed(2)} MB`,
      `Codecs: ${result.videoCodec} / ${result.audioCodec}`,
      `Render time: ${(result.elapsedMs / 1000).toFixed(1)} s`,
      ...result.warnings.map((x) => `WARN: ${x}`),
    ];
    ui.report.textContent = [...header, '', ...report.lines, '', navigator.userAgent].join('\n');
    ui.report.className = report.ok ? 'pass' : 'fail';
    ui.report.hidden = false;
    for (const l of report.lines) log(l);
    showResult(result.blob);
    ui.exportStatus.textContent = report.ok ? 'Done. Verified MP4 ready.' : 'Done, but verification found problems (see report).';
  } catch (e) {
    const msg = e instanceof DOMException && e.name === 'AbortError' ? 'Export cancelled.' : errorMessage(e);
    ui.exportStatus.textContent = msg;
    log(msg);
  } finally {
    source?.dispose();
    exporting = null;
    ui.cancel.hidden = true;
    ui.progress.hidden = true;
    refresh();
  }
}

async function openFrameSource(w: number, h: number): Promise<FrameSource> {
  if (isTestVideo()) return new TestPatternFrameSource(w, h);
  if (!videoFile) throw new Error('No video loaded.');
  const wc = await WebCodecsFrameSource.open(videoFile, w, h);
  if (typeof wc !== 'string') return wc;
  log(`WebCodecs decode unavailable (${wc}); falling back to video-element seeking.`);
  return new VideoElementFrameSource(videoFile);
}

let resultUrl = '';

function showResult(blob: Blob): void {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = URL.createObjectURL(blob);
  const name = `colluzion-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.mp4`;
  ui.resultVideo.src = resultUrl;
  ui.download.href = resultUrl;
  ui.download.download = name;
  const file = new File([blob], name, { type: 'video/mp4' });
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  ui.share.hidden = !canShare;
  ui.share.onclick = () => {
    navigator.share({ files: [file], title: name }).catch((e: unknown) => log(`Share: ${errorMessage(e)}`));
  };
  ui.result.hidden = false;
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

refresh();
log('Ready. Load music + video, or use the built-in test media.');
