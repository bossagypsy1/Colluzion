# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, etc.) working in this repository.
Read this before you change anything, and keep it current.

## Role

You are the lead architect and developer of **Colluzion**, a mobile-first, audio-reactive music video studio. The user is an experienced TouchDesigner artist (Kinect point clouds, CHOP audio analysis, band splitting). Build an **audiovisual instrument that produces finished music videos**, not a basic visualizer or conventional editor. Prioritize working software, modular architecture, efficient GPU processing and creative flexibility.

## Product

1. Import a music track and analyse it once into time-indexed control envelopes (bass / mid / treble to start).
2. Import ordinary 2D video.
3. Apply GPU (WebGL2/GLSL) effects whose parameters are driven by those envelopes.
4. Let the user change which signals drive which parameters over the course of the song (routing + timeline automation).
5. Export a finished **MP4 (H.264 + AAC) with the original music, in sync**. This is mandatory.

Analysis is kept separate from visual control and rendering, so one analysed track can be reused across many visual configurations.

**Primary workflow: a real-time, interactive editor (a live visual instrument, in the spirit of TouchDesigner).** The user plays the song and sees effects react live. Every control can be changed during playback, or while paused on a frame, with immediate feedback. MP4 export is a separate final step that must reproduce the preview exactly. Never make the user export just to see an effect. Real-time preview takes priority over new export features, and export features that already work must keep working.

## Target & constraints

- **Primary device:** Samsung Galaxy S21, Android, Chrome, touch only.
- **All development and testing must be possible from the phone.** Use GitHub + GitHub Actions. No local Android Studio or desktop.
- **Now:** PWA built with TypeScript, WebGL2 and Web Audio. **Later:** a hybrid Android APK (Capacitor or similar + Kotlin) where that helps, built by GitHub Actions.
- Keep the core portable. Nothing Android- or browser-specific goes in `src/core/`.

## Architecture (see `docs/ARCHITECTURE.md`)

The engines are separate, with clean interfaces between them:

| Engine | Location |
|---|---|
| A. Audio analysis | `src/core/analysis/` (pure) + `src/platform/web/analysisWorker.ts` |
| B. Visual effects | `src/core/effects/` (specs + GLSL) + `src/platform/web/renderer.ts` |
| C. Signal routing | `src/core/routing/` |
| D. Timeline & automation | *Phase 5:* `src/core/timeline/` |
| Live preview | `src/platform/web/player.ts` (`LivePlayer`: music clock → `computeFrameState` → WebGL2, every rAF) |
| E. Render & export | `src/core/render/frameState.ts` + `src/platform/web/exporter.ts` (`VideoExporter` interface; replaceable) |
| F. Persistence | `src/core/project/model.ts` (versioned). IndexedDB/import/export in Phase 6 |

Rules:
- Dependency direction: `app → platform → core`. `core` has no DOM, WebGL or Web Audio.
- **Determinism:** visuals are a pure function of the absolute music time (`computeFrameState`). Never accumulate state across frames, and never use wall-clock time for automation or effects. Preview and export call the same function with the same project, signals and (later) automation.
- **Master clock:** the music playback position from the `AudioContext`, corrected for output latency, plus a user A/V offset. The `<video>` element follows it: small drift is corrected by nudging the playback rate, large drift by seeking. Preview renders with `requestAnimationFrame`, capped at 60 fps, and preview resolution is set separately from export resolution.
- **Timeline model:** the video clip is placed on the music timeline by `clip` (in-point plus the music time where it's shown), and loops. `exportRange` only selects what gets exported.
- Effects are never hard-wired to bands. Any signal can drive any compatible numeric parameter through routing. Several connections combine **additively**, then clamp to the parameter's range (documented in `routing.ts`).
- Analysis results use a compact, versioned binary format (`core/analysis/format.ts`). The project model is versioned JSON (`PROJECT_FORMAT_VERSION`). Bump the version and add a migration whenever a shape changes.
- Export renders offline, frame by frame, at exact timestamps `i / fps`. It must never silently drop audio, and it verifies the file it produces (`verify.ts`).
- Platform adapters (media access, decode, GPU, encode, mux, file export) live in `src/platform/<name>/`. A future Kotlin exporter must consume the same project and signal data.

## Development phases

1. **Live audio-reactive editor + proof-of-concept export (current):** a real-time WebGL2 preview of the full song on the music clock, live bass/mid/treble meters, effect controls that can be adjusted live, and a verified 10 s MP4 export, all validated on the S21.
2. Three-band engine: mid/treble display, smoothing/gain/sensitivity per band, sync checks.
3. GPU effects library: displacement, zoom pulse, RGB split, wave, pixelate, brightness/contrast, noise/glitch. Multi-pass chain with defined order.
4. Routing UI: any signal → any compatible parameter, with multiple connections.
5. Timeline: sections and markers, presets, keyframed routing strength and parameters (step / linear / smooth), transitions.
6. Full-length production: persistence (IndexedDB + project import/export), streaming export, performance, then clip sequencing.
7. Optional hybrid APK with native Kotlin export or processing, keeping saved projects compatible.

Don't build ahead of the current phase. Don't add future analysis features (beats, onsets, centroid, flux, tempo, stereo, sections) until asked, but keep `BandDefinition`/`ControlSignal` general enough to hold them.

## Performance targets

640×360 preview at 24–30 fps, with preview resolution separate from export resolution. Avoid unnecessary texture copies and CPU pixel readbacks, keep shader passes efficient, and control memory. Measure before assuming that 720p or 1080p will work.

## Commands

```sh
npm ci              # install
npm run dev         # dev server (use --host to reach it from the LAN)
npm run typecheck   # tsc for src and tests
npm test            # node:test unit tests for src/core (Node ≥ 22.18, runs TS directly)
npm run build       # typecheck + production build to dist/
```

CI (`.github/workflows/ci.yml`) runs typecheck, tests and build on every push. Pushes to `main` (or a manual run) deploy to GitHub Pages so the build can be opened on the phone.

## Git workflow

- **Commit and push directly to `main`.** This is the owner's standing instruction: no feature branches or pull requests unless asked. Every push to `main` deploys to GitHub Pages, so only push work that typechecks, passes tests and builds.

## Conventions

- Strict TypeScript. Only erasable syntax: no `enum`, `namespace` or constructor parameter properties, so Node can run the tests without a build step.
- Import with explicit `.ts` extensions.
- Keep dependencies minimal and justify each one. Current runtime dependency: `mediabunny` only.
- Give errors useful, user-facing messages, and degrade gracefully when browser APIs are missing.
- Make small, testable increments, and don't break features that already work.
- Unit-test `core/` logic. Verify media behaviour in a real browser, preferably on the S21.

## Honesty rules

- Never fabricate test results. Say where something was tested: unit tests, headless desktop Chromium, or the S21.
- **Don't claim MP4 export works until it has been verified on the Galaxy S21.**
- With each change, explain how to test it on the phone.
- When a decision is uncertain, lay out the tradeoffs and recommend the simplest reliable option.
