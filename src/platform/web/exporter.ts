// Offline MP4 export. Every frame is rendered at its exact presentation
// timestamp (i / fps); nothing depends on real-time playback speed.
//
// VideoExporter is the replaceable seam: a native Kotlin exporter can implement
// the same contract from the same Project + signals.

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
  Quality,
  type AudioCodec,
} from 'mediabunny';
import type { ControlSignal } from '../../core/analysis/envelope.ts';
import type { Project } from '../../core/project/model.ts';
import { computeFrameState, frameTimestamps } from '../../core/render/frameState.ts';
import { measureAudioEncoderDelay } from './audioCalibration.ts';
import { errorMessage, type FrameSource } from './frameSources.ts';
import { GlRenderer } from './renderer.ts';

export interface ExportJob {
  project: Project;
  signals: ControlSignal[];
  audio: AudioBuffer;
  videoDuration: number;
  frameSource: FrameSource;
  onProgress: (fraction: number, message: string) => void;
  signal: AbortSignal;
}

export interface ExportResult {
  blob: Blob;
  videoCodec: string;
  audioCodec: AudioCodec;
  frames: number;
  durationSec: number;
  elapsedMs: number;
  /** Measured audio encoder priming delay that was trimmed via the MP4 edit list, seconds. */
  audioDelayCompensation: number;
  warnings: string[];
}

export interface VideoExporter {
  readonly id: string;
  export(job: ExportJob): Promise<ExportResult>;
}

const AUDIO_CHUNK_SEC = 0.5;

export class WebCodecsMp4Exporter implements VideoExporter {
  readonly id = 'webcodecs-mp4';

  async export(job: ExportJob): Promise<ExportResult> {
    const started = performance.now();
    const { project, audio } = job;
    const { width, height, fps } = project.export;
    const { start: musicStart, duration } = project.exportRange;
    const warnings: string[] = [];

    if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') {
      throw new Error('WebCodecs encoders are not available in this browser, so MP4 export is not possible here.');
    }
    if (width % 2 || height % 2) throw new Error('Export width and height must be even numbers for H.264.');
    if (!(await canEncodeVideo('avc', { width, height, frameRate: fps }))) {
      throw new Error(`This device cannot encode H.264 at ${width}x${height}. Try a lower resolution.`);
    }
    const audioCodec = await pickAudioCodec(audio, project.export.allowOpusFallback);
    if (audioCodec === 'opus') warnings.push('AAC encoding unavailable: audio was encoded as Opus in MP4. Some players may not support it.');
    if (musicStart + duration > audio.duration + 1e-3) {
      warnings.push('Export range extends past the end of the music; the remainder is silent.');
    }
    job.onProgress(0, 'Calibrating audio encoder…');
    let audioDelay = 0;
    try {
      audioDelay = await measureAudioEncoderDelay(audioCodec, audio.sampleRate, audio.numberOfChannels);
    } catch (e) {
      warnings.push(`Audio encoder calibration failed (${errorMessage(e)}); audio may be offset.`);
    }

    const canvas = new OffscreenCanvas(width, height);
    const renderer = new GlRenderer(canvas, { preserveDrawingBuffer: true });
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    });
    let videoCodecString = 'avc';
    const videoSource = new CanvasSource(canvas, {
      codec: 'avc',
      quality: new Quality('high'),
      keyFrameInterval: 1,
      onEncoderConfig: (c) => { videoCodecString = c.codec; },
    });
    // Starting at -delay makes the muxer write an edit list that trims the encoder's priming.
    const audioSource = new AudioBufferSource(
      { codec: audioCodec, quality: new Quality('high') },
      { startTimestamp: -audioDelay },
    );
    output.addVideoTrack(videoSource, { frameRate: fps });
    output.addAudioTrack(audioSource);

    const times = frameTimestamps(duration, fps);
    const startSample = Math.round(musicStart * audio.sampleRate);
    const totalSamples = Math.round(duration * audio.sampleRate);
    let audioWritten = 0;

    // Feed audio slightly ahead of video so the muxer can interleave.
    const feedAudioUntil = async (localTime: number) => {
      const target = Math.min(totalSamples, Math.round(localTime * audio.sampleRate));
      while (audioWritten < target) {
        const len = Math.min(Math.round(AUDIO_CHUNK_SEC * audio.sampleRate), totalSamples - audioWritten);
        await audioSource.add(sliceAudio(audio, startSample + audioWritten, len));
        audioWritten += len;
      }
    };

    try {
      await output.start();
      // Same evaluation as the live preview, at music time = range start + i / fps.
      const states = times.map((t) => computeFrameState(project, job.signals, musicStart + t, job.videoDuration));
      const videoTimes = states.map((s) => s.videoTime);
      let i = 0;
      for await (const src of job.frameSource.frames(videoTimes)) {
        if (job.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
        const t = times[i]!;
        await feedAudioUntil(t + 1);
        if (src) renderer.setSource(src);
        renderer.render(states[i]!);
        await videoSource.add(t, 1 / fps);
        i++;
        job.onProgress(i / times.length, `Frame ${i} / ${times.length}`);
      }
      if (i !== times.length) throw new Error(`Frame source ended early (${i} of ${times.length} frames).`);
      await feedAudioUntil(duration);
      job.onProgress(1, 'Finalizing MP4…');
      await output.finalize();
    } catch (e) {
      if (output.state !== 'finalized') await output.cancel().catch(() => {});
      throw e instanceof DOMException && e.name === 'AbortError' ? e : new Error(`Export failed: ${errorMessage(e)}`);
    } finally {
      renderer.dispose();
    }

    const buffer = output.target.buffer;
    if (!buffer) throw new Error('Export produced no data.');
    return {
      blob: new Blob([buffer], { type: 'video/mp4' }),
      videoCodec: videoCodecString,
      audioCodec,
      frames: times.length,
      durationSec: duration,
      elapsedMs: performance.now() - started,
      audioDelayCompensation: audioDelay,
      warnings,
    };
  }
}

async function pickAudioCodec(audio: AudioBuffer, allowOpus: boolean): Promise<AudioCodec> {
  const opts = { numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate };
  if (await canEncodeAudio('aac', opts)) return 'aac';
  if (allowOpus && (await canEncodeAudio('opus', opts))) return 'opus';
  throw new Error(
    `This device cannot encode AAC audio (${opts.numberOfChannels} ch, ${opts.sampleRate} Hz). ` +
      (allowOpus ? 'Opus is also unavailable.' : 'Enable the Opus fallback to try Opus-in-MP4.') +
      ' Refusing to produce a video without audio.',
  );
}

/** Copies [start, start+length) into a new AudioBuffer, zero-padding past the end. */
function sliceAudio(src: AudioBuffer, start: number, length: number): AudioBuffer {
  const out = new AudioBuffer({ numberOfChannels: src.numberOfChannels, length, sampleRate: src.sampleRate });
  const from = Math.max(0, start);
  const to = Math.min(src.length, start + length);
  for (let c = 0; c < src.numberOfChannels; c++) {
    if (to > from) out.copyToChannel(src.getChannelData(c).subarray(from, to), c, from - start);
  }
  return out;
}
