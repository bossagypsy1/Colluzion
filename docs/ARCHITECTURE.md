# Architecture (Phase 1)

## Repository structure

```
src/
  core/                     Platform-agnostic, pure TypeScript. No DOM/WebGL/Web Audio.
    project/model.ts        Versioned project data model + defaults
    analysis/               Biquad filters, band RMS analysis, conditioning, binary format
    effects/definitions.ts  Effect parameter specs + GLSL source
    routing/routing.ts      Signal → parameter mapping (combination rules documented in file)
    render/frameState.ts    music time → FrameState: the single deterministic render function
    project/migrate.ts      Project format migrations (v1 → v2)
    testMedia.ts            Synthetic test beat / marker timing for sync tests
  platform/web/             Browser adapters (replaceable by native Kotlin equivalents)
    media.ts                File decode/probe, analysis worker launcher
    analysisWorker.ts       Runs core analysis off the main thread
    player.ts               LivePlayer: music-clock transport, video sync, rAF render loop
    renderer.ts             WebGL2 renderer (one effect pass in Phase 1)
    frameSources.ts         Exact-timestamp frame providers for export
    exporter.ts             VideoExporter interface + WebCodecs/mediabunny MP4 exporter
    verify.ts               Re-opens the exported MP4 and measures it
    capabilities.ts         Encoder/decoder capability probe
    testPattern.ts          Procedural test video
  app/                      UI (plain DOM): main, effect controls, envelope view, export panel
tests/                      Unit tests for core/ (node:test, no browser)
docs/                       Architecture + acceptance tests
.github/workflows/ci.yml    Typecheck, test, build, deploy to GitHub Pages
```

Dependency rule: `app → platform/web → core`. `core` imports nothing outside `core`.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict, `erasableSyntaxOnly`) | Types; tests run directly in Node without a compiler step |
| Bundler / dev server | Vite | Minimal config, workers and TS out of the box |
| Rendering | WebGL2 + GLSL ES 3.00 | Widely supported on Android Chrome; shaders port to GLES |
| Audio decode | Web Audio `decodeAudioData` | Handles MP3/AAC/WAV/FLAC/OGG on Chrome |
| Audio analysis | Own TS biquads + RMS in a Worker | Deterministic across platforms, portable to Kotlin |
| Video decode / encode / MP4 mux | [mediabunny](https://mediabunny.dev) (MPL-2.0) over WebCodecs | One dependency for demux, frame-exact decode, H.264/AAC encode and MP4 muxing; actively maintained successor to mp4-muxer |
| Tests | `node:test` | No extra dependency |
| UI | Plain DOM | Phase 1 needs no framework |

## Highest-risk elements

1. **AAC encoding in WebCodecs on the S21.** Chrome only offers AAC encoding where the OS provides an encoder (Android: MediaCodec). Desktop Linux Chromium has none. Check with the in-app *Device check*. If it's missing, export stops with an error unless the user opts into Opus-in-MP4, which many players don't support. If neither works, the fallback is native Kotlin export (Phase 7).
2. **H.264 encode resolution/level limits** and hardware encoder quirks (odd sizes, keyframe handling). Exports use even sizes and are probed per resolution.
3. **Decoding the user's footage.** Phone video may be HEVC, or variable frame rate with a rotation flag. mediabunny handles rotation. If WebCodecs can't decode a file, export falls back to seeking a `<video>` element, which is slower and less exact.
4. **A/V sync in the container.** This means timestamps, AAC priming/edit lists, and the length of each track. Every export is re-opened and measured. With the built-in test media, beat onsets in the audio are compared against marker frames in the video.
5. **Memory.** The music is decoded fully to PCM (~2.3 MB per stereo minute at 48 kHz), and the MP4 is muxed in memory (`BufferTarget`). This is fine for 10 s to a few minutes. Full-length 1080p will need a streaming target (Phase 6).
6. **Preview ≠ export.** Preview uses the `<video>` element and the audio clock in real time. Export uses frame-exact decode offline. Both call the same `computeFrameState`, so the visuals match by construction, but only export output counts as proof.

## Rendering & export pipeline

```
music file ─decodeAudioData─► AudioBuffer ──worker──► band RMS @100 Hz (stored, reusable)
                                   │                         │ conditioning (attack/release, normalise,
                                   │                         ▼ threshold, gain) – cheap, re-run on slider change
                                   │                   ControlSignal[]
                                   │                         │
for frame i (t = range.start + i / fps):         │                         ▼
   FrameState = computeFrameState(project, signals, t)   ← pure, deterministic
   video frame @ FrameState.videoTime ─ mediabunny CanvasSink (WebCodecs decode, rotate, cover-fit)
   ─► WebGL2 texture ─► effect shader (u_time = music time, p_* = routed params) ─► OffscreenCanvas
   ─► CanvasSource.add(t, 1/fps) ─► VideoEncoder (H.264)
   audio slice [range.start + …] fed ~1 s ahead ─► AudioBufferSource ─► AudioEncoder (AAC)
                                     └────────────► Mp4OutputFormat (fastStart) ─► Blob ─► verify ─► download/share
```

## Live preview (primary workflow)

```
requestAnimationFrame (≤ 60 fps)
  t = music time from AudioContext.getOutputTimestamp()  (what is being heard now)  − user A/V offset
  FrameState = computeFrameState(project, signals, t)       ← the same call export makes
  <video> follows t: |drift| > 250 ms → seek; otherwise playbackRate = 1 − drift (0.85–1.15)
  new decoded frame? (requestVideoFrameCallback) → texImage2D → effect shader → canvas (preview resolution)
```

Nothing accumulates between frames. Seeking, pausing, dropped frames and control changes all take effect on the next frame. Control edits change project data directly, and band conditioning (attack/release/gain/threshold) is recomputed in about a millisecond without re-analysing the audio.
