# Celebration sounds

Presentation only: no sale, bonus, spin, team or database behaviour depends on them.

| Notification | Sound | Where it comes from |
| --- | --- | --- |
| Validated sale (Daily / Weekly / Monthly sale card) | the original "sale" sound | synthesized by the audio engine (`frontend/audio/synth.ts` `GENERATORS.sale`), exactly as before the four-sound package (63f3fbf) |
| Team Sigma sale on Teams Arena | the original Sigma stinger ("royal") | `frontend/audio/team-stingers.ts` / `TEAM_STINGERS.royal`, exactly as at 63f3fbf |
| Team Panthers sale on Teams Arena | the original Panthers stinger ("electric") | `TEAM_STINGERS.electric`, exactly as at 63f3fbf |
| Any other team's sale on Teams Arena | the original neutral stinger | `TEAM_STINGERS.neutral` |
| Cash bonus (Daily / Weekly / Monthly) | **the Owner's trumpet recording** with a subtle celebratory background | `public/audio/celebrations/cash-bonus-trumpet.wav` |
| Prize (non-cash) bonus | its program's existing sound | unchanged |
| Spin & Win | its existing sounds | unchanged |

`tests/unit/celebration-sounds.test.ts` pins the sample-for-sample fingerprints of the original sale and team sounds
taken from 63f3fbf, so any change to them fails the tests.

## Cash bonus trumpet

* **Source**: `assets/audio/originals/mind_out_of_office-trumpet-blasts-sound-music-244011.mp3`, supplied by the
  Owner (6.0 s, stereo, 44.1 kHz). The file carries no licence metadata; its name matches Pixabay's download naming
  (author "mind_out_of_office", item 244011). Pixabay's Content License allows use inside an application, commercial
  included, without attribution (not resale of the sound on its own). The Owner confirms the source and permission.
* **Result**: `cash-bonus-trumpet.wav`, 3.0 s (Owner choice), 44.1 kHz 16-bit stereo, 517 KB. Rebuild with
  `node scripts/render-cash-bonus-sound.mjs` (decodes and mixes in Playwright's Chromium; no other tool).
* **Mix**: the trumpet recording is the dominant, unchanged sound (42 ms of leading silence trimmed, its first 3 s kept, with a
  smooth 0.66 s fade at the end). Underneath, original layers synthesized by the script: a soft cinematic impact on the first blast,
  short very high golden sparkles across the stereo field, and an airy uplifting texture. They are unpitched, so they
  never clash with the trumpet's key. Measured: the background is 18.5 dB under the mix overall, 9 dB under at the impact,
  24–26 dB under afterwards. A gentle compressor, a 38 Hz low cut (no excess bass) and a −1.5 dBFS peak limit (no
  clipping) finish it.
* **Timing**: it starts with the popup entrance and lasts 3 s, well inside every bonus popup (6 / 7 / 8 s), so it never
  holds the queue. If a popup closes first (closed by hand, or the arena goes offline), the rest fades out over 0.45 s.

## Rules (unchanged)

* **Controls**: Admin → Settings → Sound: *Sound effects* (master), *Master volume* and the categories. *Sale approved*
  gates the sale sound and the team sounds (team sounds also follow Admin → Celebrations → *Team celebration sounds*).
  A bonus follows its program's sound category, as before.
* **Autoplay**: nothing plays before someone has clicked or pressed a key on the display, and a sound that could not
  play is never played later.
* **Once per notification**: the popups play once per event (dedupe by sale case / award ids), and the trumpet is also
  keyed by its popup.
* **Trumpet playback**: decoded once and kept in memory; scheduled on the audio clock in the existing audio context;
  stopped for good, never replayed late, if the browser or OS suspends audio. Details in
  [CELEBRATION-RELIABILITY.md](CELEBRATION-RELIABILITY.md).
* **Previews**: Admin → Settings → Sound → *Celebration sounds* plays exactly these four sounds on the Admin's own
  screen (no request, no sale, bonus or spin).
