# Phase 1 acceptance tests

The milestone is a real MP4 produced **on the Galaxy S21 in Chrome**, with the imported music and a visibly bass-reactive effect. Results from desktop or headless browsers don't count toward sign-off.

## Opening the app on the phone

1. Merge to `main` (or run the **CI** workflow manually) after enabling *Settings → Pages → Source: GitHub Actions* once.
2. Open `https://<user>.github.io/<repo>/` in Chrome on the S21. The header shows the build commit.
3. Optional: Chrome menu → *Add to Home screen*.

## Tests

| # | Test | Pass criteria |
|---|---|---|
| A1 | **Device check** button | Report shows `h264.640x360: true` and `aac48k` or `aac44k: true`. Record the full output. |
| A2 | **Built-in test media** → Play | Preview zooms in on each audible thump (2 per second). The playhead moves over the bass envelope. |
| A3 | Test media → Export 640×360 @ 30 fps | Report says **Export VERIFIED** and every line is PASS, including *A/V sync … worst ≤ 38 ms*. Codecs are `avc1.* / aac`. |
| A4 | Repeat A3 at 24 fps | As A3 (limit 47 ms). |
| A5 | Play the exported file in the in-page player, then **Download** / **Share** and open it in Samsung Gallery / Google Photos | Plays with sound, 10 s, zoom pulses visibly on the beats. |
| A6 | Your own music + phone video, 10 s segment, music start > 0 | Report: PASS for both tracks, 300 frames, durations 10.000 s. The effect visibly follows the bass when played back. |
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

**MP4 export on the Galaxy S21 is untested.**
