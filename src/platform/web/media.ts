// Media import adapters for the browser. A native build would replace this file.

import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { AnalysisResult } from '../../core/analysis/analyze.ts';
import type { BandDefinition } from '../../core/project/model.ts';

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  codec: string;
  canDecode: boolean;
}

let sharedContext: AudioContext | null = null;

/** One AudioContext for decoding and preview; create it from a user gesture. */
export function audioContext(): AudioContext {
  sharedContext ??= new AudioContext({ latencyHint: 'playback' });
  return sharedContext;
}

export async function decodeAudioFile(file: Blob): Promise<AudioBuffer> {
  const data = await file.arrayBuffer();
  try {
    return await audioContext().decodeAudioData(data);
  } catch (e) {
    throw new Error(`Could not decode the audio file (${e instanceof Error ? e.message : String(e)}).`);
  }
}

export async function probeVideo(file: Blob): Promise<VideoInfo> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track found in this file.');
    return {
      duration: await track.computeDuration(),
      width: track.displayWidth,
      height: track.displayHeight,
      codec: track.codec ?? 'unknown',
      canDecode: await track.canDecode(),
    };
  } finally {
    input.dispose();
  }
}

export function fingerprint(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

/** Runs band analysis in a worker so the UI stays responsive on long tracks. */
export function analyzeInWorker(
  buffer: AudioBuffer,
  bands: BandDefinition[],
  frameRate: number,
  sourceFingerprint: string,
): Promise<AnalysisResult> {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice());
  const worker = new Worker(new URL('./analysisWorker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<{ ok: true; result: AnalysisResult } | { ok: false; error: string }>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(`Analysis worker failed: ${e.message}`));
    };
    worker.postMessage(
      { channels, sampleRate: buffer.sampleRate, bands, frameRate, sourceFingerprint },
      channels.map((c) => c.buffer),
    );
  });
}
