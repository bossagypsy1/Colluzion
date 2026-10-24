// Built-in synthetic test media with known timing, used for objective sync tests.
// A bass thump starts at every multiple of TEST_BEAT_INTERVAL; the test pattern
// shows a white centre marker for TEST_MARKER_DURATION from each beat.

export const TEST_BEAT_INTERVAL = 0.5;
export const TEST_MARKER_DURATION = 0.1;
export const TEST_MEDIA_DURATION = 30;

/** Mono test beat: 55 Hz decaying sine bursts plus a short 3 kHz tick at each beat. */
export function synthTestBeat(sampleRate: number, duration = TEST_MEDIA_DURATION): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.round(sampleRate * duration));
  const beatLen = Math.round(sampleRate * 0.25);
  const tickLen = Math.round(sampleRate * 0.005);
  for (let b = 0; b * TEST_BEAT_INTERVAL < duration; b++) {
    const start = Math.round(b * TEST_BEAT_INTERVAL * sampleRate);
    for (let i = 0; i < beatLen && start + i < out.length; i++) {
      const t = i / sampleRate;
      let v = 0.8 * Math.sin(2 * Math.PI * 55 * t) * Math.exp(-t * 18);
      if (i < tickLen) v += 0.25 * Math.sin(2 * Math.PI * 3000 * t);
      out[start + i] = v;
    }
  }
  return out;
}

export function isBeatMarkerOn(videoTime: number): boolean {
  const phase = videoTime % TEST_BEAT_INTERVAL;
  // Small epsilon so frames exactly on a beat (i / fps) count as "on".
  return phase < TEST_MARKER_DURATION - 1e-6 || TEST_BEAT_INTERVAL - phase < 1e-6;
}
