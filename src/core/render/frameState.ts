// The single deterministic function from music time to "what to draw". The live
// preview and the MP4 exporter both call it, so the same timestamp always yields
// the same visuals. Timeline automation (Phase 5) will be evaluated here too.

import { sampleSignal, type ControlSignal } from '../analysis/envelope.ts';
import { EFFECT_DEFINITIONS } from '../effects/definitions.ts';
import type { ClipPlacement, Project, SignalId } from '../project/model.ts';
import { evaluateRouting } from '../routing/routing.ts';

export interface FrameEffect {
  id: string;
  type: string;
  params: Record<string, number>;
}

export interface FrameState {
  /** Absolute music time, seconds: the master timeline clock. */
  musicTime: number;
  /** Time in the source video to display, seconds. */
  videoTime: number;
  signals: Record<SignalId, number>;
  effects: FrameEffect[];
}

/** Maps music time to source video time; the clip loops from its in-point to its end. */
export function mapVideoTime(clip: ClipPlacement, videoDuration: number, musicTime: number): number {
  const start = Math.min(Math.max(clip.inPoint, 0), Math.max(videoDuration, 0));
  const available = videoDuration - start;
  if (!(available > 0)) return start;
  const t = (musicTime - clip.syncMusicTime) % available;
  return start + (t < 0 ? t + available : t);
}

export function computeFrameState(
  project: Project,
  signals: ControlSignal[],
  musicTime: number,
  videoDuration: number,
): FrameState {
  const values: Record<SignalId, number> = {};
  for (const s of signals) values[s.id] = sampleSignal(s, musicTime);
  const resolved = evaluateRouting(project.effects, EFFECT_DEFINITIONS, project.routing, (id) => values[id] ?? 0);
  return {
    musicTime,
    videoTime: mapVideoTime(project.clip, videoDuration, musicTime),
    signals: values,
    effects: project.effects
      .filter((fx) => fx.enabled && resolved[fx.id])
      .map((fx) => ({ id: fx.id, type: fx.type, params: resolved[fx.id]! })),
  };
}

/** Exact presentation timestamps for an export: frame i is shown at i / fps. */
export function frameTimestamps(duration: number, fps: number): number[] {
  const count = Math.round(duration * fps);
  return Array.from({ length: count }, (_, i) => i / fps);
}
