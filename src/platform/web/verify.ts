// Post-export verification: re-open the produced MP4 and measure it, so success
// is reported from the actual file rather than assumed.

import { ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input } from 'mediabunny';
import { TEST_BEAT_INTERVAL } from '../../core/testMedia.ts';

export interface VerifyReport {
  ok: boolean;
  lines: string[];
  sync?: { beats: number; meanMs: number; maxAbsMs: number };
}

export interface VerifyExpectations {
  durationSec: number;
  fps: number;
  /** Run the beat-marker A/V sync measurement (only valid with built-in test media, beat-aligned range and clip). */
  testMediaSync: boolean;
}

export async function verifyMp4(blob: Blob, expect: VerifyExpectations): Promise<VerifyReport> {
  const lines: string[] = [];
  let ok = true;
  const fail = (msg: string) => { ok = false; lines.push(`FAIL: ${msg}`); };
  const pass = (msg: string) => lines.push(`PASS: ${msg}`);
  const frameDur = 1 / expect.fps;

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const mime = await input.getMimeType();
    pass(`Container readable (${mime}), ${(blob.size / 1024).toFixed(0)} KiB`);
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video) fail('No video track');
    if (!audio) fail('No audio track');
    if (!video || !audio) return { ok, lines };

    pass(`Video: ${video.codec}, ${video.displayWidth}x${video.displayHeight}`);
    pass(`Audio: ${audio.codec}, ${audio.numberOfChannels} ch, ${audio.sampleRate} Hz`);

    const vDur = await video.computeDuration();
    const aDur = await audio.computeDuration();
    const stats = await video.computePacketStats();
    const expectedFrames = Math.round(expect.durationSec * expect.fps);
    (stats.packetCount === expectedFrames ? pass : fail)(`Frame count ${stats.packetCount} (expected ${expectedFrames})`);
    (Math.abs(vDur - expect.durationSec) <= frameDur + 1e-3 ? pass : fail)(
      `Video duration ${vDur.toFixed(3)} s (expected ${expect.durationSec.toFixed(3)} s)`,
    );
    (Math.abs(aDur - expect.durationSec) <= 0.05 ? pass : fail)(
      `Audio duration ${aDur.toFixed(3)} s (expected ${expect.durationSec.toFixed(3)} s ± 50 ms)`,
    );
    const aFirst = await audio.getFirstTimestamp();
    const vFirst = await video.getFirstTimestamp();
    (Math.abs(aFirst - vFirst) <= 0.03 ? pass : fail)(
      `Track start offset ${((aFirst - vFirst) * 1000).toFixed(1)} ms (video ${vFirst.toFixed(3)} s, audio ${aFirst.toFixed(3)} s)`,
    );

    if (expect.testMediaSync) {
      const sync = await measureBeatSync(video, audio, expect);
      if (sync.beats === 0) {
        fail('Sync test found no matching beats');
      } else {
        (sync.maxAbsMs <= frameDur * 1000 + 5 ? pass : fail)(
          `A/V sync over ${sync.beats} beats: mean ${sync.meanMs.toFixed(1)} ms, worst ${sync.maxAbsMs.toFixed(1)} ms ` +
            `(limit ${(frameDur * 1000 + 5).toFixed(0)} ms)`,
        );
      }
      return { ok, lines, sync };
    }
    return { ok, lines };
  } catch (e) {
    fail(`Could not read the exported file: ${e instanceof Error ? e.message : String(e)}`);
    return { ok, lines };
  } finally {
    input.dispose();
  }
}

type VideoTrack = NonNullable<Awaited<ReturnType<Input['getPrimaryVideoTrack']>>>;
type AudioTrack = NonNullable<Awaited<ReturnType<Input['getPrimaryAudioTrack']>>>;

/** Compares audio beat onsets with the test pattern's white centre marker onsets. */
async function measureBeatSync(video: VideoTrack, audio: AudioTrack, expect: VerifyExpectations) {
  // Audio onsets: first sample after each expected beat window start exceeding a threshold.
  const audioOnsets: number[] = [];
  let nextBeat = 0;
  for await (const { buffer, timestamp } of new AudioBufferSink(audio).buffers()) {
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      const t = timestamp + i / buffer.sampleRate;
      if (t < nextBeat * TEST_BEAT_INTERVAL - TEST_BEAT_INTERVAL / 2) continue;
      if (Math.abs(ch[i]!) > 0.1) {
        audioOnsets.push(t);
        nextBeat++;
      }
    }
  }

  // Video onsets: frames where the centre patch turns bright.
  const times = Array.from({ length: Math.round(expect.durationSec * expect.fps) }, (_, i) => i / expect.fps);
  const sink = new CanvasSink(video, { width: 32, height: 18, fit: 'fill', poolSize: 1 });
  const videoOnsets: number[] = [];
  let wasBright = false;
  let i = 0;
  for await (const wrapped of sink.canvasesAtTimestamps(times)) {
    const t = times[i++]!;
    if (!wrapped) continue;
    const ctx = wrapped.canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) continue;
    const px = ctx.getImageData(14, 7, 4, 4).data;
    let lum = 0;
    for (let p = 0; p < px.length; p += 4) lum += (px[p]! + px[p + 1]! + px[p + 2]!) / 3;
    const bright = lum / (px.length / 4) > 160;
    if (bright && !wasBright) videoOnsets.push(t);
    wasBright = bright;
  }

  const offsets: number[] = [];
  for (const v of videoOnsets) {
    const a = audioOnsets.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), Infinity);
    if (Math.abs(a - v) < TEST_BEAT_INTERVAL / 2) offsets.push((v - a) * 1000);
  }
  const mean = offsets.reduce((s, x) => s + x, 0) / Math.max(1, offsets.length);
  const maxAbs = offsets.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  return { beats: offsets.length, meanMs: mean, maxAbsMs: maxAbs };
}
