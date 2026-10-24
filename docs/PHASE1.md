# Phase 1 acceptance tests

Live preview tests come first (L1–L8), because real-time preview is the primary workflow. Export tests (A1–A10) cover the separate final step.

The milestone is a real MP4 produced **on the Galaxy S21 in Chrome**, with the imported music and a visibly bass-reactive effect. Results from desktop or headless browsers don't count toward sign-off.

## Opening the app on the phone

1. Merge to `main` (or run the **CI** workflow manually) after enabling *Settings → Pages → Source: GitHub Actions* once.
2. Open `https://<user>.github.io/<repo>/` in Chrome on the S21. The header shows the build commit.
3. Optional: Chrome menu → *Add to Home screen*.

## Tests

| # | Test | Pass criteria |
|---|---|---|
| L1 | **Test media** → Play | The picture zooms on every audible thump (2 per second). Meters B/M/T move with the music. Stats show ~60 fps at 640×360. |
| L2 | Drag **Zoom** amount / base while playing | The change is visible within a fraction of a second. Playback doesn't stutter. |
| L3 | Pause, then step ◀/▶ and adjust controls | The frame holds still, steps by 1/30 s, and control changes show on the paused frame. |
| L4 | Own music + phone video → Play for 1 min | Drift in stats stays within ±40 ms after the first second, and the video loops cleanly if shorter than the song. |
| L5 | Seek bar / ±5 s while playing | Audio and picture jump together. |
| L6 | Preview resolution 426×240 ↔ 960×540 | Stats show the new size, and fps stays ≥ 30 at 640×360. |
| L7 | **Loop export range** | Playback loops the export range. |
| L8 | Bluetooth headphones | Raising *Visual delay* brings the visuals back in line with the sound. |
| A1 | **Device check** button | Report shows `h264.640x360: true` and `aac48k` or `aac44k: true`. Record the full output. |
| A2 | **Built-in test media** → Play | Preview zooms in on each audible thump (2 per second). The playhead moves over the bass envelope. |
| A3 | Test media → Export 640×360 @ 30 fps (export start 0) | Report says **Export VERIFIED** and every line is PASS, including *A/V sync … worst ≤ 38 ms*. Codecs are `avc1.* / aac`. |
| A4 | Repeat A3 at 24 fps | As A3 (limit 47 ms). |
| A5 | Play the exported file in the in-page player, then **Download** / **Share** and open it in Samsung Gallery / Google Photos | Plays with sound, 10 s, zoom pulses visibly on the beats. |
| A6 | Own music + phone video, export start > 0 (e.g. *Start export at playhead*) | Report: PASS for both tracks, 300 frames, durations 10.000 s. The effect visibly follows the bass when played back. |
| A7 | Video shorter than 10 s | The video loops, the export still has 300 frames, and the report is VERIFIED. |
| A8 | Export at 1280×720 | Either VERIFIED, or a clear error naming the resolution. Note the render time. |
| A9 | Cancel during export | Status shows "Export cancelled." The app stays usable and a fresh export works. |
| A10 | If AAC is unavailable | Export fails with "Refusing to produce a video without audio" and no file is offered. |

Record for each run: the pass/fail lines, render time, file size and the user-agent line from the report.

## Verified so far (not on target device)

Headless Chromium 153 on Linux (desktop, no AAC encoder):
- A3 equivalent with the Opus fallback: VERIFIED. 300 frames, 10.000 s / 10.000 s, sync worst 0.8 ms over 20 beats, 2.8 s render.
- A6/A7 equivalent (WAV + MP4 file, music start 3 s, video start 2 s, 1280×720): VERIFIED via WebCodecs decode, 12.8 s render.
- A10: confirmed. With no AAC and no fallback, export is refused.
- Zoom measured on the preview: the centre square is 17.0% of frame width at bass 0.00 and 22.3% at bass 0.95, matching the routing gain of 0.35.

Live preview (headless Chromium, 412×915 viewport):
- Test media: playback advances on the music clock, meters track the beat (bass 0.85 on beats, 0.00 between), 56–60 fps at 1.3–1.5 ms main-thread time per frame.
- Changing zoom amount 0 → 1 during playback took effect within ~100 ms (centre square 16.7% → up to 30.9% of width).
- Paused: time holds. Base zoom 0 → 0.5 changes the held frame (16.7% → 25.2%). Frame step goes exactly to the next 1/30 s.
- Real WAV + MP4: video drift settles to within ±8 ms within 2 s.
- Export after the redesign: still VERIFIED, with sync worst 0.8 ms.

**Nothing has been tested on the Galaxy S21 yet, live preview or MP4 export.**
