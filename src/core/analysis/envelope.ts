// Conditioning (smoothing, normalization, threshold, gain) and timestamp lookup.

import type { ConditioningSettings, SignalId } from '../project/model.ts';

/** A 0..1 control signal sampled at a fixed rate. */
export interface ControlSignal {
  id: SignalId;
  frameRate: number;
  values: Float32Array;
}

/** One-pole attack/release follower over frames at `frameRate`. */
export function attackRelease(x: Float32Array, frameRate: number, attackMs: number, releaseMs: number): Float32Array {
  const coef = (ms: number) => (ms <= 0 ? 0 : Math.exp(-1000 / (ms * frameRate)));
  const a = coef(attackMs);
  const r = coef(releaseMs);
  const out = new Float32Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    const c = v > y ? a : r;
    y = c * y + (1 - c) * v;
    out[i] = y;
  }
  return out;
}

export function conditionSignal(
  id: SignalId,
  rms: Float32Array,
  frameRate: number,
  s: ConditioningSettings,
): ControlSignal {
  const smoothed = attackRelease(rms, frameRate, s.attackMs, s.releaseMs);
  let peak = 0;
  for (const v of smoothed) if (v > peak) peak = v;
  const norm = peak > 0 ? 1 / peak : 0;
  const thr = Math.min(Math.max(s.threshold, 0), 0.999);
  for (let i = 0; i < smoothed.length; i++) {
    let v = smoothed[i]! * norm;
    v = v <= thr ? 0 : (v - thr) / (1 - thr);
    smoothed[i] = Math.min(1, Math.max(0, v * s.gain));
  }
  return { id, frameRate, values: smoothed };
}

/** Linear interpolation at an absolute media time in seconds; clamps at the ends. */
export function sampleSignal(sig: ControlSignal, timeSec: number): number {
  const n = sig.values.length;
  if (n === 0) return 0;
  const pos = timeSec * sig.frameRate;
  if (pos <= 0) return sig.values[0]!;
  if (pos >= n - 1) return sig.values[n - 1]!;
  const i = Math.floor(pos);
  const f = pos - i;
  return sig.values[i]! * (1 - f) + sig.values[i + 1]! * f;
}
