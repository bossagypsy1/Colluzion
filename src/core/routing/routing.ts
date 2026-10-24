// Signal routing: control signals -> effect parameters.
//
// Combination method: for each parameter,
//   value = base + sum(contribution of every enabled connection targeting it)
// then clamped to the parameter's [min, max]. A contribution is
//   ((curve(threshold(signal)) inverted?) * gain + offset) * strength.

import type { EffectDefinition } from '../effects/definitions.ts';
import type { EffectInstance, ResponseCurve, RoutingConnection, SignalId } from '../project/model.ts';

export function applyCurve(x: number, curve: ResponseCurve): number {
  switch (curve) {
    case 'linear':
      return x;
    case 'square':
      return x * x;
    case 'sqrt':
      return Math.sqrt(x);
    case 'smoothstep':
      return x * x * (3 - 2 * x);
  }
}

export function connectionContribution(conn: RoutingConnection, signal: number): number {
  let v = Math.min(1, Math.max(0, signal));
  const thr = Math.min(Math.max(conn.threshold, 0), 0.999);
  v = v <= thr ? 0 : (v - thr) / (1 - thr);
  v = applyCurve(v, conn.curve);
  if (conn.invert) v = 1 - v;
  return (v * conn.gain + conn.offset) * conn.strength;
}

export type ResolvedParams = Record<string, Record<string, number>>;

export function evaluateRouting(
  effects: EffectInstance[],
  definitions: Record<string, EffectDefinition>,
  connections: RoutingConnection[],
  signalAt: (id: SignalId) => number,
): ResolvedParams {
  const out: ResolvedParams = {};
  for (const fx of effects) {
    const def = definitions[fx.type];
    if (!def) continue;
    const values: Record<string, number> = {};
    for (const [name, spec] of Object.entries(def.params)) values[name] = fx.params[name] ?? spec.default;
    for (const conn of connections) {
      if (!conn.enabled || conn.effectId !== fx.id || !(conn.param in values)) continue;
      values[conn.param]! += connectionContribution(conn, signalAt(conn.source));
    }
    for (const [name, spec] of Object.entries(def.params)) {
      values[name] = Math.min(spec.max, Math.max(spec.min, values[name]!));
    }
    out[fx.id] = values;
  }
  return out;
}
