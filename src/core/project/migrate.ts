// Upgrades stored projects to the current PROJECT_FORMAT_VERSION.

import { PROJECT_FORMAT_VERSION, type Project } from './model.ts';

interface ProjectV1 {
  formatVersion: 1;
  segment: { musicStart: number; videoStart: number; duration: number };
  [key: string]: unknown;
}

export function migrateProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object' || typeof (raw as { formatVersion?: unknown }).formatVersion !== 'number') {
    throw new Error('Not a Colluzion project.');
  }
  let p = structuredClone(raw) as { formatVersion: number; [key: string]: unknown };
  if (p.formatVersion > PROJECT_FORMAT_VERSION) {
    throw new Error(`Project format v${p.formatVersion} is newer than this app supports (v${PROJECT_FORMAT_VERSION}).`);
  }
  if (p.formatVersion === 1) p = v1ToV2(p as ProjectV1);
  return p as unknown as Project;
}

/** v1 had one segment mapping music time to video time; v2 splits clip placement from export range. */
function v1ToV2(p: ProjectV1): { formatVersion: number; [key: string]: unknown } {
  const { segment, ...rest } = p;
  return {
    ...rest,
    formatVersion: 2,
    clip: { inPoint: segment.videoStart, syncMusicTime: segment.musicStart },
    exportRange: { start: segment.musicStart, duration: segment.duration },
  };
}
