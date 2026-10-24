// Frame sources for offline (export) rendering: given exact video timestamps,
// yield the matching source image. Implementations are interchangeable.

import { ALL_FORMATS, BlobSource, CanvasSink, Input, type InputVideoTrack } from 'mediabunny';
import type { SourceImage } from './renderer.ts';
import { drawTestPattern } from './testPattern.ts';

export interface FrameSource {
  readonly kind: string;
  /** Yields one image per requested timestamp, in order. */
  frames(times: number[]): AsyncGenerator<SourceImage | null>;
  dispose(): void;
}

/** Primary path: demux + WebCodecs decode via mediabunny. Frame-exact. */
export class WebCodecsFrameSource implements FrameSource {
  readonly kind = 'webcodecs';
  private input: Input;
  private track: InputVideoTrack;
  private width: number;
  private height: number;

  private constructor(input: Input, track: InputVideoTrack, width: number, height: number) {
    this.input = input;
    this.track = track;
    this.width = width;
    this.height = height;
  }

  /** Returns a reason string instead if this device cannot decode the file via WebCodecs. */
  static async open(file: Blob, width: number, height: number): Promise<WebCodecsFrameSource | string> {
    if (typeof VideoDecoder === 'undefined') return 'WebCodecs VideoDecoder is not available.';
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) return 'No video track found in the file.';
      if (!(await track.canDecode())) return `This device cannot decode ${track.codec ?? 'this'} video via WebCodecs.`;
      return new WebCodecsFrameSource(input, track, width, height);
    } catch (e) {
      input.dispose();
      return `Could not read video: ${errorMessage(e)}`;
    }
  }

  async *frames(times: number[]): AsyncGenerator<SourceImage | null> {
    // Rotation and cover-fit are applied by the sink, at export resolution.
    const sink = new CanvasSink(this.track, { width: this.width, height: this.height, fit: 'cover', poolSize: 2 });
    const first = await this.track.getFirstTimestamp();
    const clamped = times.map((t) => Math.max(t, first));
    for await (const wrapped of sink.canvasesAtTimestamps(clamped)) {
      yield wrapped ? { image: wrapped.canvas, width: wrapped.canvas.width, height: wrapped.canvas.height } : null;
    }
  }

  dispose(): void {
    this.input.dispose();
  }
}

/** Fallback: seek an HTMLVideoElement to each timestamp. Slower; accuracy depends on the browser. */
export class VideoElementFrameSource implements FrameSource {
  readonly kind = 'video-element';
  private video: HTMLVideoElement;
  private url: string;

  constructor(file: Blob) {
    this.url = URL.createObjectURL(file);
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.src = this.url;
  }

  async *frames(times: number[]): AsyncGenerator<SourceImage | null> {
    const v = this.video;
    if (v.readyState < 1) await once(v, 'loadedmetadata');
    for (const t of times) {
      if (Math.abs(v.currentTime - t) > 1e-4 || v.readyState < 2) {
        const seeked = once(v, 'seeked');
        v.currentTime = t;
        await seeked;
      }
      yield { image: v, width: v.videoWidth, height: v.videoHeight };
    }
  }

  dispose(): void {
    this.video.removeAttribute('src');
    this.video.load();
    URL.revokeObjectURL(this.url);
  }
}

/** Built-in procedural test pattern; see core/testMedia.ts. */
export class TestPatternFrameSource implements FrameSource {
  readonly kind = 'test-pattern';
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;

  constructor(width: number, height: number) {
    this.canvas = new OffscreenCanvas(width, height);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable.');
    this.ctx = ctx;
  }

  async *frames(times: number[]): AsyncGenerator<SourceImage | null> {
    for (const t of times) {
      drawTestPattern(this.ctx, this.canvas.width, this.canvas.height, t);
      yield { image: this.canvas, width: this.canvas.width, height: this.canvas.height };
    }
  }

  dispose(): void {}
}

function once(target: EventTarget, type: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error(`Video element error while waiting for ${type}`)); };
    const cleanup = () => {
      target.removeEventListener(type, ok);
      target.removeEventListener('error', fail);
    };
    target.addEventListener(type, ok);
    target.addEventListener('error', fail);
  });
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
