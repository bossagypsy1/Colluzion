// Live preview engine. The music playback clock is the master: every animation
// frame reads the current music time from the AudioContext and renders the state
// computed for that timestamp. Nothing accumulates across frames, so seeking,
// pausing, slow frames or parameter changes can never make the visuals drift.

import type { FrameState } from '../../core/render/frameState.ts';
import { audioContext } from './media.ts';
import type { GlRenderer } from './renderer.ts';
import { drawTestPattern } from './testPattern.ts';

export type VideoMode = 'none' | 'file' | 'pattern';

export interface PreviewStats {
  fps: number;
  /** Main-thread time spent per rendered frame (upload + draw submission), ms. */
  cpuMs: number;
  /** Displayed video position minus target position, ms (file mode, playing). */
  driftMs: number;
}

export interface PlayerHooks {
  /** Evaluate the visual state for a music time (computeFrameState). */
  frameAt(musicTime: number): FrameState;
  onFrame(state: FrameState, playing: boolean, stats: PreviewStats): void;
  onStateChange(playing: boolean): void;
}

/** Above this the video is re-seeked; below it playbackRate is nudged instead. */
const HARD_RESYNC_SEC = 0.25;
const MAX_RENDER_FPS = 60;

export class LivePlayer {
  /** Loop between start and end while playing (music time, seconds). */
  loop = { enabled: false, start: 0, end: 10 };
  /** User A/V offset, seconds; positive delays the visuals (for Bluetooth audio etc.). */
  avOffset = 0;

  private renderer: GlRenderer;
  private video: HTMLVideoElement;
  private hooks: PlayerHooks;
  private audio: AudioBuffer | null = null;
  private mode: VideoMode = 'none';
  private pattern = document.createElement('canvas');
  private patternCtx = this.pattern.getContext('2d')!;

  private playing = false;
  private node: AudioBufferSourceNode | null = null;
  private anchorCtxTime = 0;
  private anchorMusicTime = 0;
  private pausedTime = 0;

  private newVideoFrame = true;
  /** With requestVideoFrameCallback we only upload when the decoder presents a new frame. */
  private hasFrameCallbacks = false;
  private videoSeeking = false;
  private lastRender = 0;
  private fpsCount = 0;
  private fpsWindowStart = 0;
  private stats: PreviewStats = { fps: 0, cpuMs: 0, driftMs: 0 };

  constructor(renderer: GlRenderer, video: HTMLVideoElement, hooks: PlayerHooks) {
    this.renderer = renderer;
    this.video = video;
    this.hooks = hooks;
    this.pattern.width = renderer.canvas.width;
    this.pattern.height = renderer.canvas.height;
    video.addEventListener('seeked', () => {
      this.videoSeeking = false;
      this.newVideoFrame = true;
    });
    video.addEventListener('loadeddata', () => (this.newVideoFrame = true));
    this.watchVideoFrames();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    requestAnimationFrame(this.tick);
  }

  get duration(): number {
    return this.audio?.duration ?? 0;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Current music time: the master clock. */
  get time(): number {
    if (!this.playing) return this.pausedTime;
    const ctx = audioContext();
    // Time of the sample currently reaching the speaker, extrapolated to now.
    let heard = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      heard = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    }
    const t = this.anchorMusicTime + Math.max(0, heard - this.anchorCtxTime);
    return Math.min(t, this.duration);
  }

  setAudio(buffer: AudioBuffer | null): void {
    this.pause();
    this.audio = buffer;
    this.pausedTime = 0;
  }

  setVideoMode(mode: VideoMode): void {
    this.mode = mode;
    this.newVideoFrame = true;
    if (mode !== 'file') this.video.pause();
  }

  setPreviewSize(width: number, height: number): void {
    this.renderer.resize(width, height);
    this.pattern.width = width;
    this.pattern.height = height;
    this.newVideoFrame = true;
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  play(): void {
    if (!this.audio || this.playing) return;
    const ctx = audioContext();
    void ctx.resume();
    let from = this.pausedTime;
    if (from >= this.duration - 0.01) from = this.loop.enabled ? this.loop.start : 0;
    if (this.loop.enabled && (from < this.loop.start || from >= this.loop.end)) from = this.loop.start;
    this.startAudioAt(from);
    this.playing = true;
    if (this.mode === 'file') {
      this.syncVideo(true);
      void this.video.play().catch(() => {});
    }
    this.hooks.onStateChange(true);
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedTime = this.time;
    this.stopAudio();
    this.playing = false;
    this.video.pause();
    this.video.playbackRate = 1;
    this.syncVideo(true);
    this.hooks.onStateChange(false);
  }

  seek(musicTime: number): void {
    const t = Math.min(Math.max(musicTime, 0), this.duration);
    if (this.playing) {
      this.stopAudio();
      this.startAudioAt(t);
    } else {
      this.pausedTime = t;
    }
    this.syncVideo(true);
  }

  /** Re-aligns the video after the clip placement changed. */
  refresh(): void {
    this.syncVideo(true);
    this.newVideoFrame = true;
  }

  private startAudioAt(musicTime: number): void {
    const ctx = audioContext();
    const node = ctx.createBufferSource();
    node.buffer = this.audio;
    node.connect(ctx.destination);
    const when = ctx.currentTime + 0.03;
    node.start(when, musicTime);
    node.onended = () => {
      if (this.node !== node) return;
      this.pausedTime = this.duration;
      this.stopAudio();
      this.playing = false;
      this.video.pause();
      this.hooks.onStateChange(false);
    };
    this.node = node;
    this.anchorCtxTime = when;
    this.anchorMusicTime = musicTime;
  }

  private stopAudio(): void {
    const node = this.node;
    this.node = null;
    if (node) {
      node.onended = null;
      try { node.stop(); } catch { /* already stopped */ }
      node.disconnect();
    }
  }

  /** Visual time = music time minus the user's A/V offset. */
  private visualTime(): number {
    return Math.max(0, this.time - this.avOffset);
  }

  /** Keeps the <video> element on the timeline: seek on big drift, nudge rate on small drift. */
  private syncVideo(force: boolean): void {
    if (this.mode !== 'file' || this.video.readyState < 1) return;
    const target = this.hooks.frameAt(this.visualTime()).videoTime;
    const v = this.video;
    const drift = v.currentTime - target;
    this.stats.driftMs = this.playing ? drift * 1000 : 0;
    if (this.videoSeeking) return;
    if (force || Math.abs(drift) > HARD_RESYNC_SEC) {
      if (Math.abs(drift) > 1 / 120) {
        this.videoSeeking = true;
        v.currentTime = target;
      }
      if (v.playbackRate !== 1) v.playbackRate = 1;
      return;
    }
    if (this.playing) {
      const rate = Math.min(1.15, Math.max(0.85, 1 - drift));
      if (Math.abs(v.playbackRate - rate) > 0.01) v.playbackRate = rate;
    }
  }

  private watchVideoFrames(): void {
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    if (typeof v.requestVideoFrameCallback !== 'function') return;
    const onFrame = () => {
      this.newVideoFrame = true;
      v.requestVideoFrameCallback!(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
    this.hasFrameCallbacks = true;
  }

  private tick = (now: number): void => {
    requestAnimationFrame(this.tick);
    // Cap at 60 fps: 120 Hz displays would otherwise double GPU work for no visible gain.
    if (now - this.lastRender < 1000 / MAX_RENDER_FPS - 2) return;
    this.lastRender = now;
    const t0 = performance.now();

    if (this.playing && this.loop.enabled && this.loop.end > this.loop.start && this.time >= this.loop.end) {
      this.seek(this.loop.start);
    }
    const state = this.hooks.frameAt(this.visualTime());

    if (this.mode === 'pattern') {
      drawTestPattern(this.patternCtx, this.pattern.width, this.pattern.height, state.videoTime);
      this.renderer.setSource({ image: this.pattern, width: this.pattern.width, height: this.pattern.height });
    } else if (this.mode === 'file' && this.video.readyState >= 2) {
      if (this.playing) this.syncVideo(false);
      if (this.newVideoFrame || !this.hasFrameCallbacks) {
        this.renderer.setSource({ image: this.video, width: this.video.videoWidth, height: this.video.videoHeight });
        this.newVideoFrame = false;
      }
    }
    this.renderer.render(state);

    const cpu = performance.now() - t0;
    this.stats.cpuMs = this.stats.cpuMs * 0.9 + cpu * 0.1;
    this.fpsCount++;
    if (this.fpsWindowStart === 0) this.fpsWindowStart = now;
    if (now - this.fpsWindowStart >= 1000) {
      this.stats.fps = (this.fpsCount * 1000) / (now - this.fpsWindowStart);
      this.fpsCount = 0;
      this.fpsWindowStart = now;
    }
    this.hooks.onFrame(state, this.playing, this.stats);
  };
}
