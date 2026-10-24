// The single deterministic function from "time" to "what to draw". Preview and
// export both call it, so the same timestamp always yields the same visuals.

import { sampleSignal, type ControlSignal } from '../analysis/envelope.ts';
import { EFFECT_DEFINITIONS } from '../effects/definitions.ts';
import type { Project, Segment, SignalId } from '../project/model.ts';
import { evaluateRouting } from '../routing/routing.ts';

export interface FrameEffect {
  id: string;
  type: string;
  params: Record<string, number>;
}

export interface FrameState {
  /** Time within the segment (0 = first exported frame), seconds. */
  localTime: number;
  /** Absolute music time, seconds. Used for analysis lookup and shader time. */
  musicTime: number;
  /** Time in the source video to display, seconds. */
  videoTime: number;
  signals: Record<SignalId, number>;
  effects: FrameEffect[];
}

/** Maps segment-local time to source video time, looping if the clip is shorter. */
export function mapVideoTime(segment: Segment, videoDuration: number, localTime: number): number {
  const start = Math.min(Math.max(segment.videoStart, 0), Math.max(videoDuration, 0));
  const available = videoDuration - start;
  if (!(available > 0)) return start;
  const t = localTime % available;
  return start + (t < 0 ? t + available : t);
}

export function computeFrameState(
  project: Project,
  signals: ControlSignal[],
  localTime: number,
  videoDuration: number,
): FrameState {
  const musicTime = project.segment.musicStart + localTime;
  const values: Record<SignalId, number> = {};
  for (const s of signals) values[s.id] = sampleSignal(s, musicTime);
  const resolved = evaluateRouting(project.effects, EFFECT_DEFINITIONS, project.routing, (id) => values[id] ?? 0);
  return {
    localTime,
    musicTime,
    videoTime: mapVideoTime(project.segment, videoDuration, localTime),
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
