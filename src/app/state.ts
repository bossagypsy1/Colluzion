// Shared, mutable app state for the UI modules. Engines receive data from here;
// they never reach into the UI.

import type { AnalysisResult } from '../core/analysis/analyze.ts';
import type { ControlSignal } from '../core/analysis/envelope.ts';
import { createDefaultProject } from '../core/project/model.ts';

export const state = {
  project: createDefaultProject(),
  audio: null as AudioBuffer | null,
  videoFile: null as File | null,
  videoDuration: 0,
  analysis: null as AnalysisResult | null,
  signals: [] as ControlSignal[],
};

export const isTestVideo = () => state.project.media.video?.generator === 'test-pattern';
export const hasVideo = () => isTestVideo() || state.videoFile !== null;

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const logEl = () => document.getElementById('log');

export function log(msg: string): void {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  const el = logEl();
  if (el) el.textContent = line + (el.textContent ?? '');
  console.log(msg);
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
