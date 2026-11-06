# Celebration sounds

Four original sound effects for genuine validated sales, Teams Arena team sales and cash bonuses. Presentation
only: no sale, bonus, spin, team or database behaviour depends on them. Spin & Win sounds are separate and
unchanged.

| Sound | File (`public/audio/celebrations/`) | Length | Size | Design |
| --- | --- | --- | --- | --- |
| Validated sale: "Ta-ta-TING!" | `sale-validated-chime.wav` | 1.25 s | 108 KB | soft E5 pluck → B5 pluck → bright E6 metallic chime (0.18 s) → short shimmer |
| Team Sigma: lion roar victory | `sigma-lion-roar-victory.wav` | 2.25 s | 194 KB | rising whoosh (0.0 s) → stylized lion roar (0.2 s) → cinematic impact (0.55 s) → golden bell shimmer (1.0 s) → fade 1.6–2.2 s |
| Team Panthers: big-cat growl victory | `panthers-big-cat-growl-victory.wav` | 2.05 s | 177 KB | electric sweep (0.0 s) → stylized big-cat growl (0.2 s) → sharp whoosh (0.55 s) → electric power hit (0.85 s) → energy tail 1.35–2.05 s |
| Cash bonus: "Pa-pa-pa-CHING!" | `cash-bonus-golden-ching.wav` | 1.75 s | 151 KB | three coins (0.01 / 0.12 / 0.23 s) → ascending flourish (0.4 s) → golden "CHING" (0.75 s) → sparkle (1.1 s) |

All are 44.1 kHz 16-bit mono WAV, peak ≤ −2 dBFS (no clipping), loudness-matched, with fades in and out; the
creature sounds keep their energy above ~90 Hz (clear on office speakers, no boomy sub peaks).

## How they were made (licensing)

Every sound is **original and fully synthesized** by `scripts/render-celebration-sounds.mjs` (plain Node, no
samples, no recordings, no third-party audio); run `node scripts/render-celebration-sounds.mjs` to rebuild the
same files. The lion roar and the big-cat growl are **stylized cinematic designs, not animal recordings**: a
pitch-contoured pulse source with breath and rasp texture, shaped by vocal-tract-like formant filters, layered
with impacts and shimmer. Licensed real roar / growl recordings were not available here; if the Owner supplies
licensed recordings, replace the two WAVs at the same paths (no code change).

## When each plays

| Event (genuine, persisted) | Screen on this display | Sound | With |
| --- | --- | --- | --- |
| Validated sale | Daily / Weekly / Monthly (and any screen showing the sale card) | sale chime | the sale card's entrance |
| Validated sale of Team Sigma | Teams Arena | Sigma lion | the lion emblem entrance; the shimmer lands with the headline |
| Validated sale of Team Panthers | Teams Arena | Panthers | the panther emblem entrance; the hit lands just before the headline |
| Validated sale of another team | Teams Arena | the existing neutral team stinger | the crest celebration |
| Cash bonus award (Daily / Weekly / Monthly) | any | cash bonus | coins with the popup entrance, the "CHING" as the card lands on the amount (~0.75 s) |
| Prize (non-cash) award | any | its existing sound (unchanged) | |
| Spin & Win | Spin & Win | its existing sounds (unchanged) | |

Submitted or unvalidated leads never play anything (only committed `sale.validated` / `rewards.award.created`
events reach the popups).

## Rules

* **Existing controls**: Admin → Settings → Sound: *Sound effects* (master), *Master volume*, and the categories:
  *Sale approved* gates the sale chime and the team sounds (team sounds also follow Admin → Celebrations →
  *Team celebration sounds*); a bonus follows its program's sound category, as before.
* **Autoplay**: nothing plays before someone has clicked or pressed a key on the display; a sound that could not
  play is never replayed later.
* **Once per event**: each sound is keyed by its event (sale case / popup / award ids); stream redelivery,
  background-sync recovery, reconnects, re-renders and data refreshes never replay it. A page refresh never plays
  history (the popups themselves never replay history).
* **No stacking**: one celebration sound at a time; a new one fades the previous one out in 120 ms. Sounds follow
  the popup queue (a bonus popup first, then the team celebration). Leaving Teams Arena stops the team sound.
* **Previews**: Admin → Settings → Sound → *Celebration sounds* plays the exact production files on the Admin's own
  screen (no request, no sale, bonus or spin). Admin → Celebrations keeps its Sigma / Panthers / other-team visual
  previews, now with these sounds.
