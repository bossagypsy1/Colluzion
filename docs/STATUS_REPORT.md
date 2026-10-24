# Colluzion — Development Status Report

*Prepared by Claude (Claude Code) for review by ChatGPT and the project owner. Date: 2026-10-24. Latest build: `92780e9`.*

- Repository: https://github.com/bossagypsy1/Colluzion (public, branch `main`)
- Live app (GitHub Pages): https://bossagypsy1.github.io/Colluzion/
- Agent guidance: `AGENTS.md` · Architecture: `docs/ARCHITECTURE.md` · Acceptance tests and results: `docs/PHASE1.md`

---

## 1. Summary

Colluzion is a mobile-first, audio-reactive music video editor in the spirit of TouchDesigner. It runs as a PWA in Chrome on a Samsung Galaxy S21.

Current state: **the Phase 1 milestone has been reached and verified on the Galaxy S21.**

- A **real-time live preview** renders the full song with WebGL2 on the phone's GPU at **60 fps, using about 0.5 ms of main-thread time per frame**. Bass, mid and treble meters and the effects respond live to the music. All controls can be adjusted during playback or while paused.
- **MP4 export** is a separate final step. It produced a **verified H.264 + AAC MP4 on the S21 with 0.0 ms measured A/V sync**, and the owner confirmed it plays with sound, in sync, in Samsung Gallery.

Everything was developed and tested without a desktop. Code is pushed to GitHub, GitHub Actions builds and deploys to GitHub Pages, and the owner tests on the phone.

---

## 2. Owner instructions that shape the project

1. **Initial brief** (written by ChatGPT): a modular TypeScript/WebGL2/Web Audio PWA with six separate engines: audio analysis, visual effects, signal routing, timeline/automation, render/export, and persistence. Deliver in seven phases. The first milestone: a real MP4 with the imported music and a visibly bass-reactive effect, produced entirely on the S21. Rules: no fabricated test results, and don't claim export works until it's verified on the device.
2. **Change of priority:** the app must be a **real-time interactive editor first**. The owner should never have to export just to see an effect, and export is a separate final step that must match the preview. The music playback clock is the master. Rendering uses `requestAnimationFrame` and evaluates the visual state from the current media timestamp, not from accumulated frame updates. Keep GitHub Pages; Vercel isn't needed.
3. **Git workflow:** commit and push directly to `main` at all times. This is recorded in `AGENTS.md`.

---

## 3. Technology stack and why

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript, strict, erasable syntax only | Type safety. Unit tests run directly in Node 22 without a compile step. |
| Build | Vite 8 | Minimal configuration. Handles TypeScript and Web Workers. |
| Rendering | WebGL2 + GLSL ES 3.00 | Widely supported on Android Chrome. The shaders can be ported to OpenGL ES or Android later. |
| Audio decode | Web Audio `decodeAudioData` | Handles MP3, AAC, WAV, FLAC and OGG in Chrome. |
| Audio analysis | Own biquad filters and RMS in TypeScript, run in a Web Worker | Deterministic across platforms and portable to Kotlin. |
| Video decode, encode and MP4 muxing | **mediabunny 1.61.3** (MPL-2.0), the only runtime dependency | Wraps WebCodecs. Provides frame-exact decoding, H.264/AAC encoding, MP4 muxing with edit lists, and file reading for verification. |
| Tests | `node:test` | No extra dependency. |
| UI | Plain DOM, no framework | Keeps things simple at this stage. |
| CI/CD | GitHub Actions: typecheck → tests → build → deploy to GitHub Pages | Lets all testing happen from the phone. |

---

## 4. Architecture

```
src/
  core/        Platform-independent pure TypeScript (no DOM, WebGL or Web Audio). Intended to be reusable by a future Kotlin/native build.
    project/model.ts       Versioned project data model (PROJECT_FORMAT_VERSION = 2)
    project/migrate.ts     v1 → v2 migration
    analysis/biquad.ts     RBJ-cookbook biquad filters
    analysis/analyze.ts    Band filtering (2× HPF + 2× LPF per band) and RMS at 100 frames/s
    analysis/envelope.ts   Attack/release smoothing, normalisation, threshold, gain; lookup at any time
    analysis/format.ts     Compact versioned binary format for analysis results ("CLZA")
    effects/definitions.ts Effect parameter specs and GLSL shader source
    routing/routing.ts     Signal → parameter routing; connections add together, then are clamped to the parameter's range
    render/frameState.ts   computeFrameState(project, signals, musicTime): the single deterministic "what to draw" function
    testMedia.ts           Synthetic test beat and marker timing for objective sync tests
  platform/web/  Browser adapters (replaceable by native ones later)
    player.ts           LivePlayer: music-clock transport, video sync, rAF render loop
    renderer.ts         WebGL2 renderer
    media.ts, analysisWorker.ts   Decoding, probing, background analysis
    frameSources.ts     Frame-exact video frames for export (WebCodecs; fallback by seeking a <video> element; test pattern)
    exporter.ts         VideoExporter interface + WebCodecs/mediabunny MP4 exporter
    audioCalibration.ts Measures the audio encoder's priming delay on the device
    verify.ts           Re-opens the exported MP4 and measures it
    capabilities.ts     Probe for encoders and decoders
  app/         UI: main, effect controls, envelope view, export panel, shared state
tests/         17 unit tests for core/
```

About 2,700 lines of TypeScript. Dependencies only point inward: `app → platform → core`.

### Key design principles (implemented)

- **Determinism:** the visuals are a pure function of the absolute music time. The live preview and the exporter both call `computeFrameState`, with the same project data, signals and effect definitions. Timeline automation, when it's added in Phase 5, will be evaluated in the same place.
- **Master clock:** the `AudioContext` output timestamp, meaning the sample currently reaching the speaker, extrapolated to the current moment. A user-adjustable A/V offset is added for Bluetooth audio delay. The `<video>` element follows it: drift under 250 ms is corrected by nudging `playbackRate` between 0.85 and 1.15, and larger drift triggers a seek. Textures are uploaded only when a new decoded frame arrives (`requestVideoFrameCallback`). Rendering is capped at 60 fps.
- **Analyse once, reuse:** the expensive band filtering runs once per track in a worker. The cheap conditioning step (attack, release, gain, threshold) re-runs in about 1 ms whenever a slider changes.
- **Effects are never hard-wired to bands:** any band can drive any numeric parameter through routing connections, each with gain, offset, invert, threshold, curve and strength.
- **Timeline model:** the video clip is placed on the music timeline by an in-point plus the music time where that in-point is shown, and it loops. A separate `exportRange` selects only what gets exported.
- **Export is offline and verified:** frame *i* is rendered at exactly `range.start + i/fps`, independent of real-time performance. After encoding, the file is re-opened and measured. The export refuses to produce a video without audio.

---

## 5. Features currently in the app

**Live editor (primary workflow)**
- Live WebGL2 preview of the full song, with the music clock as master. Tap the picture to play or pause.
- Transport controls: play/pause, seek bar, ±5 s, frame step (±1/30 s), and an option to loop the export range.
- Live bass/mid/treble meters, and a scrolling three-band envelope view centred on the playhead with the export range shaded.
- Per-band attack, release, gain and threshold, adjustable during playback.
- Effect controls generated from the effect definition. Each parameter has a base value plus a band × amount connection, chosen from none, bass, mid or treble, with a live readout of the resulting value.
- Current effect, "Zoom pulse + displacement" (one shader pass): zoom, horizontal displacement, vertical displacement, and the number of displacement bands. Glitch-style row and column displacement steps in time with the music clock.
- Preview resolution setting: 426×240, 640×360 (default), 960×540 or 1280×720. On-screen stats show fps, ms per frame and video drift, averaged and refreshed twice a second.
- Visual delay (A/V offset) slider, −300 to +300 ms.
- Built-in test media: a synthetic bass thump every 0.5 s, and a test pattern that shows a white centre square on each beat.

**Export (separate final step)**
- Start and length settings (or "Start export at playhead"), resolution of 640×360, 1280×720 or 1920×1080, and 24 or 30 fps.
- H.264 video and AAC audio, with an opt-in Opus fallback. Otherwise the export is refused with a clear message.
- A progress bar and a Cancel button.
- **Automatic verification report:** both tracks are present, codecs and frame count are checked, video and audio durations are checked, the track start offset is checked, and, when using test media, the A/V sync of every beat is measured.
- An in-page player, plus Download and Android Share (save to Gallery).
- A device capability check.

---

## 6. Development timeline (commits on `main`)

| Commit | What |
|---|---|
| `8e5fa36` | AGENTS.md skeleton |
| `f70567b` | Phase 1 proof of concept: core analysis and routing, WebGL2 renderer, mediabunny MP4 exporter, verification, test media, CI and Pages deploy, docs |
| `b88f5d3` | Policy: work directly on `main` |
| `f224eaa` | **Live preview made the primary workflow:** LivePlayer on the music clock, full-song transport, three-band meters and envelope view, live routing controls, preview resolution, project format v2 with migration |
| `77e70da` | Readable stats readout (averaged, refreshed at 2 Hz), from S21 feedback |
| `b5b9e6b` | Recorded first S21 results |
| `1dfa3ff` | **Fix:** measure and compensate the audio encoder priming delay, from S21 feedback |
| `4c1e040`, `92780e9` | Recorded S21 export verification and Gallery playback |

---

## 7. Test results

### 7.1 Unit tests (Node, CI): 17/17 passing
- Band separation: 60 Hz goes to bass, 600 Hz to mid and 6 kHz to treble, each at least 4× above the other bands.
- RMS accuracy, mono mixdown, deterministic analysis, and the bass envelope rising within 30 ms of each test beat.
- Conditioning stays within 0–1 and the threshold behaves correctly. Interpolation and clamping are correct.
- The binary analysis format survives a save/load round trip.
- Routing: threshold, curve, invert, gain, offset, strength, additive combination and clamping; disabled connections are ignored.
- `computeFrameState` depends only on music time, not on the order in which frames are evaluated.
- Video loop mapping, v1 → v2 migration, exact frame timestamps, and beat markers landing on frames.

### 7.2 Headless desktop Chromium (Linux, no AAC encoder available, so Opus was used)
- Live preview: 56–60 fps at 1.3–1.5 ms per frame. The meters track the beat.
- A zoom change made during playback showed up within about 100 ms. Measured as the centre square's share of frame width: 16.7% rising to as much as 30.9%.
- Paused editing works on the held frame: base zoom 0 → 0.5 took the square from 16.7% to 25.2%. Frame step lands exactly on 1/30 s steps.
- With a real WAV and MP4, video drift settles to within ±8 ms after about 2 s.
- Export: VERIFIED. Sync worst-case 0.8 ms over 20 beats. A 1280×720 export from a real file, with a looping video, also verified.
- Refusal path confirmed: with no AAC and no fallback, the export is refused rather than producing a video-only file.

### 7.3 Samsung Galaxy S21, Chrome 155 (target device)
- **Device check:** WebGL2, WebCodecs VideoEncoder/AudioEncoder/VideoDecoder and OffscreenCanvas are all available. H.264 encoding works at 640×360, 1280×720 and 1920×1080. AAC at 48 kHz and 44.1 kHz: available. Opus: available. File sharing: available. 8 GB of device memory.
- **Live preview (test media):** **60 fps at 640×360, 0.5–0.6 ms per frame.** The meters track the beat. Analysing 30 s of audio took 224–396 ms.
- **Export, first attempt:** H.264 + AAC, 300 frames, 10.000 s, 1.48 MB, rendered in 6.8 s. **Failed the sync check: the audio was a constant 42.7 ms late.** See section 8.
- **Export after the fix:** **VERIFIED. A/V sync mean 0.0 ms, worst 0.0 ms over 20 beats.** The measured encoder delay of 42.7 ms was compensated. Rendered in 6.3 s, 1.6× faster than real time.
- **Samsung Gallery playback:** confirmed by the owner, with sound and in sync.

---

## 8. Issues found and fixed

1. **AAC priming delay on Android (found on the S21).** Android's AAC encoder, which Chrome's WebCodecs uses on the phone, adds 2048 samples of priming (42.7 ms at 48 kHz) to the start of the audio without reflecting it in its output timestamps, so the music played 42.7 ms late. The app's built-in test media and beat-by-beat sync check caught it; desktop didn't, because Opus records its own delay. **Fix:** before each export, encode a short click, decode it back and measure the delay on that device. The audio track then starts at −delay, and mediabunny writes an MP4 edit list that tells players to skip the priming. Measuring per device means no hard-coded value. A headless test confirmed the correction shifts sync by exactly the intended amount, and the S21 then measured 0.0 ms.
2. **The sticky preview covered all the controls on wide screens.** The picture height is now capped.
3. **Hidden buttons were still visible.** CSS was overriding the `hidden` attribute. Fixed.
4. **The stats readout flickered too fast to read on the phone.** It now averages over half a second and refreshes twice a second.
5. **The verifier rejected an intentional negative audio start time** (the trimmed priming). The check now accepts audio that starts slightly before the video and still fails audio that starts late.

---

## 9. Known limitations and open items

**Not yet tested on the S21:**
- The owner's **own music and camera footage**. This is the next step. Risks: portrait or rotated video, HEVC recordings, variable frame rate, large files.
- Live interaction tests L2–L8: adjusting controls while playing, paused editing, seeking, resolution changes, loop, Bluetooth offset.
- Export at 24 fps and 720p/1080p, cancel during export, and a video shorter than the export range.

**Known technical limitations:**
- Only one effect type exists so far, rendered in a single shader pass. The multi-effect chain is Phase 3.
- No timeline automation yet (Phase 5). Routing is static across the song.
- No persistence yet (Phase 6). Reloading the page loses the project, and media must be re-imported.
- The export builds the whole MP4 in memory and decodes the music fully to PCM. That's fine for short clips but needs a streaming output for full-length 1080p videos.
- Preview uses the `<video>` element, while export uses frame-exact WebCodecs decoding. Both evaluate the same `computeFrameState`, so the effects match. The exact video frame shown during live playback can differ from the export by about one frame while drift is being corrected.
- No service worker or offline caching. This is deliberate for now, to avoid stale builds during development.
- The JavaScript bundle is about 550 KB, mostly mediabunny. Code splitting can come later.
- Analysis is fixed at 100 frames/s with three fixed bands. The band edges are stored in the project but can't be edited in the UI yet.

---

## 10. Phase status

| Phase | Status |
|---|---|
| 1. Live audio-reactive editor + proof-of-concept export | **Done; milestone verified on the S21.** Own footage still to be tested. |
| 2. Three-band engine | Mostly done early: bass/mid/treble analysis, meters, envelope view and per-band conditioning. Remaining: per-band sync checks and editable band edges. |
| 3. GPU effects library (displacement, zoom, RGB split, wave, pixelate, brightness/contrast, noise/glitch), multi-pass chain | **Next** |
| 4. Routing UI | Partly in place: one band connection per parameter. Multiple connections per parameter and curve/threshold/invert controls are still to come. |
| 5. Timeline and automation | Not started. The data model and `computeFrameState` are ready for it. |
| 6. Full-length production (persistence, streaming export, performance, clip sequencing) | Not started |
| 7. Optional hybrid Android APK | Probably not needed for export, since browser export works on the S21. It may still help with file access and performance later. |

---

## 11. Proposed next steps

1. **The owner tests their own music and footage** live (watch the drift readout) and exports a 10 s range. Fix any decoding, rotation or drift problems before building further.
2. **Phase 3:** a multi-pass effect chain with ping-pong framebuffers, the full initial effects library, user-reorderable effect order and per-effect enable/bypass. Every parameter becomes routable, and preview and export share the same chain.
3. Then the Phase 4 routing UI: multiple connections per parameter, with curve, threshold and invert exposed.
4. Early Phase 6 item worth pulling forward: saving and loading projects (IndexedDB plus JSON export/import), so work isn't lost on reload.

---

## 12. Working method

- Every change: typecheck, run the unit tests, build, and test in headless Chromium (driven by Playwright) where the media pipeline is involved, then push to `main`. CI deploys to Pages in about a minute, and the owner tests on the S21.
- The test log in `docs/PHASE1.md` records which environment each result came from: unit tests, headless desktop, or S21. No results have been assumed or invented.
