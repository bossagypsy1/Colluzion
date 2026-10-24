import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeMono, computeRms, mixToMono } from '../src/core/analysis/analyze.ts';
import { conditionSignal, sampleSignal } from '../src/core/analysis/envelope.ts';
import { decodeAnalysis, encodeAnalysis } from '../src/core/analysis/format.ts';
import { DEFAULT_BANDS, DEFAULT_CONDITIONING } from '../src/core/project/model.ts';
import { synthTestBeat, TEST_BEAT_INTERVAL } from '../src/core/testMedia.ts';

const SR = 48000;

function sine(freq: number, seconds: number, amp = 0.5): Float32Array {
  const x = new Float32Array(SR * seconds);
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return x;
}

function bandRms(result: ReturnType<typeof analyzeMono>, id: string): number {
  const b = result.bands.find((x) => x.band.id === id)!;
  // Skip the filter start-up transient.
  const steady = b.rms.subarray(20, b.rms.length - 2);
  return steady.reduce((s, v) => s + v, 0) / steady.length;
}

test('bands separate low, mid and high tones', () => {
  const cases: [number, string][] = [[60, 'bass'], [600, 'mid'], [6000, 'treble']];
  for (const [freq, expected] of cases) {
    const r = analyzeMono(sine(freq, 1), SR, DEFAULT_BANDS, 100, 'test');
    const levels = Object.fromEntries(DEFAULT_BANDS.map((b) => [b.id, bandRms(r, b.id)]));
    for (const b of DEFAULT_BANDS) {
      if (b.id !== expected) assert.ok(levels[expected]! > levels[b.id]! * 4, `${freq} Hz: ${JSON.stringify(levels)}`);
    }
  }
});

test('RMS of a full-scale-0.5 sine is ~0.354', () => {
  const rms = computeRms(sine(1000, 1), SR, 100);
  assert.equal(rms.length, 101);
  assert.ok(Math.abs(rms[50]! - 0.5 / Math.SQRT2) < 0.01);
});

test('mixToMono averages channels', () => {
  const m = mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]);
  assert.deepEqual([...m], [0.5, 0.5]);
});

test('analysis is deterministic', () => {
  const x = synthTestBeat(SR, 3);
  const a = analyzeMono(x, SR, DEFAULT_BANDS, 100, 'x');
  const b = analyzeMono(x, SR, DEFAULT_BANDS, 100, 'x');
  for (let i = 0; i < a.bands.length; i++) assert.deepEqual(a.bands[i]!.rms, b.bands[i]!.rms);
});

test('bass envelope rises within 30 ms of each test beat', () => {
  const x = synthTestBeat(SR, 5);
  const r = analyzeMono(x, SR, DEFAULT_BANDS, 100, 'x');
  const sig = conditionSignal('bass', r.bands[0]!.rms, 100, DEFAULT_CONDITIONING);
  for (let beat = 1; beat * TEST_BEAT_INTERVAL < 4.5; beat++) {
    const t0 = beat * TEST_BEAT_INTERVAL;
    assert.ok(sampleSignal(sig, t0 - 0.05) < 0.2, `quiet before beat ${beat}`);
    assert.ok(sampleSignal(sig, t0 + 0.03) > 0.5, `loud after beat ${beat}`);
  }
});

test('conditioning output stays within 0..1 and respects threshold', () => {
  const rms = new Float32Array([0, 0.05, 0.1, 0.5, 1, 2]);
  const sig = conditionSignal('x', rms, 100, { attackMs: 0, releaseMs: 0, gain: 3, threshold: 0.2 });
  assert.equal(sig.values[1], 0); // 0.025 normalized, below threshold
  for (const v of sig.values) assert.ok(v >= 0 && v <= 1);
});

test('sampleSignal interpolates and clamps', () => {
  const sig = { id: 'x', frameRate: 100, values: new Float32Array([0, 1, 0]) };
  assert.equal(sampleSignal(sig, -1), 0);
  assert.equal(sampleSignal(sig, 0.005), 0.5);
  assert.equal(sampleSignal(sig, 0.01), 1);
  assert.equal(sampleSignal(sig, 99), 0);
});

test('binary analysis format round-trips', () => {
  const r = analyzeMono(synthTestBeat(SR, 1), SR, DEFAULT_BANDS, 100, 'fp-123');
  const back = decodeAnalysis(encodeAnalysis(r));
  assert.equal(back.sourceFingerprint, 'fp-123');
  assert.equal(back.bands.length, 3);
  for (let i = 0; i < 3; i++) assert.deepEqual(back.bands[i]!.rms, r.bands[i]!.rms);
});
