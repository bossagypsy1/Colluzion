// MP4 export: a separate, final step. Uses the same project, signals and
// computeFrameState as the live preview.

import { WebCodecsMp4Exporter } from '../platform/web/exporter.ts';
import {
  errorMessage,
  TestPatternFrameSource,
  VideoElementFrameSource,
  WebCodecsFrameSource,
  type FrameSource,
} from '../platform/web/frameSources.ts';
import type { LivePlayer } from '../platform/web/player.ts';
import { verifyMp4 } from '../platform/web/verify.ts';
import { TEST_BEAT_INTERVAL } from '../core/testMedia.ts';
import { $, hasVideo, isTestVideo, log, state } from './state.ts';

const ui = {
  rangeStart: $<HTMLInputElement>('range-start'),
  rangeLength: $<HTMLInputElement>('range-length'),
  rangeHere: $<HTMLButtonElement>('range-here'),
  resolution: $<HTMLSelectElement>('resolution'),
  fps: $<HTMLSelectElement>('fps'),
  opus: $<HTMLInputElement>('opus-fallback'),
  exportBtn: $<HTMLButtonElement>('export'),
  cancel: $<HTMLButtonElement>('cancel'),
  progress: $<HTMLProgressElement>('progress'),
  status: $('export-status'),
  report: $('report'),
  result: $('result'),
  resultVideo: $<HTMLVideoElement>('result-video'),
  download: $<HTMLAnchorElement>('download'),
  share: $<HTMLButtonElement>('share'),
};

let exporting: AbortController | null = null;
let resultUrl = '';

export function initExportPanel(player: LivePlayer, onRangeChange: () => void): { refresh(): void } {
  const readRange = () => {
    state.project.exportRange = {
      start: Math.max(0, Number(ui.rangeStart.value) || 0),
      duration: Math.min(600, Math.max(1, Number(ui.rangeLength.value) || 10)),
    };
    onRangeChange();
  };
  ui.rangeStart.addEventListener('change', readRange);
  ui.rangeLength.addEventListener('change', readRange);
  ui.rangeHere.addEventListener('click', () => {
    ui.rangeStart.value = player.time.toFixed(2);
    readRange();
  });
  ui.exportBtn.addEventListener('click', () => void runExport(player));
  ui.cancel.addEventListener('click', () => exporting?.abort());

  const refresh = () => {
    const ready = !!state.audio && hasVideo() && state.signals.length > 0;
    ui.exportBtn.disabled = !ready || exporting !== null;
    ui.rangeHere.disabled = !state.audio;
    ui.rangeStart.value = String(state.project.exportRange.start);
    ui.rangeLength.value = String(state.project.exportRange.duration);
  };
  return { refresh };
}

async function runExport(player: LivePlayer): Promise<void> {
  const { audio, project } = state;
  if (!audio || !hasVideo()) return;
  player.pause();
  const [w, h] = ui.resolution.value.split('x').map(Number) as [number, number];
  project.export = { width: w, height: h, fps: Number(ui.fps.value), allowOpusFallback: ui.opus.checked };
  exporting = new AbortController();
  ui.exportBtn.disabled = true;
  ui.cancel.hidden = false;
  ui.progress.hidden = false;
  ui.progress.value = 0;
  ui.report.hidden = true;
  ui.result.hidden = true;
  ui.status.textContent = 'Preparing…';
  const range = project.exportRange;
  log(`Export started: ${w}×${h} @ ${project.export.fps} fps, ${range.duration} s from ${range.start} s`);

  let source: FrameSource | null = null;
  try {
    source = await openFrameSource(w, h);
    log(`Frame source: ${source.kind}`);
    const result = await new WebCodecsMp4Exporter().export({
      project: structuredClone(project),
      signals: state.signals,
      audio,
      videoDuration: state.videoDuration,
      frameSource: source,
      signal: exporting.signal,
      onProgress: (f, msg) => {
        ui.progress.value = f;
        ui.status.textContent = msg;
      },
    });
    for (const wmsg of result.warnings) log(`Warning: ${wmsg}`);
    const speed = (result.durationSec * 1000) / result.elapsedMs;
    log(`Encoded ${result.frames} frames (${result.videoCodec} + ${result.audioCodec}) in ${(result.elapsedMs / 1000).toFixed(1)} s (${speed.toFixed(2)}× real time)`);

    ui.status.textContent = 'Verifying the exported file…';
    const beatAligned = (t: number) => Math.abs(t / TEST_BEAT_INTERVAL - Math.round(t / TEST_BEAT_INTERVAL)) < 1e-9;
    const report = await verifyMp4(result.blob, {
      durationSec: range.duration,
      fps: project.export.fps,
      testMediaSync: isTestVideo() && project.media.audio?.generator === 'test-beat' &&
        project.clip.inPoint === 0 && beatAligned(project.clip.syncMusicTime) && beatAligned(range.start),
    });
    const header = [
      `Export ${report.ok ? 'VERIFIED' : 'HAS PROBLEMS'}`,
      `${w}×${h} @ ${project.export.fps} fps, ${result.durationSec} s, ${(result.blob.size / 1024 / 1024).toFixed(2)} MB`,
      `Codecs: ${result.videoCodec} / ${result.audioCodec}`,
      `Render time: ${(result.elapsedMs / 1000).toFixed(1)} s`,
      `Audio encoder delay compensated: ${(result.audioDelayCompensation * 1000).toFixed(1)} ms`,
      ...result.warnings.map((x) => `WARN: ${x}`),
    ];
    ui.report.textContent = [...header, '', ...report.lines, '', navigator.userAgent].join('\n');
    ui.report.className = report.ok ? 'pass' : 'fail';
    ui.report.hidden = false;
    for (const l of report.lines) log(l);
    showResult(result.blob);
    ui.status.textContent = report.ok ? 'Done. Verified MP4 ready.' : 'Done, but verification found problems (see report).';
  } catch (e) {
    const msg = e instanceof DOMException && e.name === 'AbortError' ? 'Export cancelled.' : errorMessage(e);
    ui.status.textContent = msg;
    log(msg);
  } finally {
    source?.dispose();
    exporting = null;
    ui.cancel.hidden = true;
    ui.progress.hidden = true;
    ui.exportBtn.disabled = false;
  }
}

async function openFrameSource(w: number, h: number): Promise<FrameSource> {
  if (isTestVideo()) return new TestPatternFrameSource(w, h);
  if (!state.videoFile) throw new Error('No video loaded.');
  const wc = await WebCodecsFrameSource.open(state.videoFile, w, h);
  if (typeof wc !== 'string') return wc;
  log(`WebCodecs decode unavailable (${wc}); falling back to video-element seeking.`);
  return new VideoElementFrameSource(state.videoFile);
}

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
