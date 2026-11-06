# Celebration reliability and low-end displays

How sale cards, cash bonus popups and Teams Arena celebrations (and their sounds) are scheduled, and what happens on
slow PCs, hidden tabs and audio interruptions. Presentation only: nothing here changes sales, bonuses, spins,
standings, the stream or the sync.

## One queue order, explicit completion

The existing queues are kept (sale cards: `celebration-store`, bonus popups: `bonus-flow-store`, Teams Arena:
`team-celebration-store`); they now hand over on **completion**, not on a fixed delay.

* **Teams Arena celebration**: an explicit state machine
  `idle → preparing → playing → finishing → idle`.
  * *preparing*: the emblem / crest images are decoded and the sound buffer is ready (at most 0.8 s, then it starts
    anyway: a slow image never blocks a sale);
  * *playing*: the celebration and its sound start together; it ends on its own clock (timestamp based);
  * *finishing*: the exit animation runs; its completion callback (AnimatePresence) returns the queue to *idle*.
* **Bonus popup**: after it closes it is `exiting` until its exit animation reports back.
* The next celebration, bonus popup or sale card starts only when the others are fully idle, so two full-screen
  celebrations are never on screen together. Order is unchanged: a bonus that is queued or open goes before a
  waiting team celebration; a team celebration already on screen finishes first.
* **Stall recovery**: if an exit never reports back, the queue is released: at 1.5 s when the tab is hidden (no
  frames can run), after six more drawn frames when the page is visible but slow (a slow exit is never cut short,
  so no overlap), and at 12 s at the latest if the page draws nothing at all. Counted as `recovered`. A playing
  celebration always ends on its clock. Nothing waits forever.
* **Once per event**: the existing dedupe (case id, award id) plus each layer's own memory. Duplicates are counted
  (`window.__teamCelebration.duplicates`), never shown.

Diagnostics on any display: `window.__teamCelebration` (queued / started / completed / recovered / handed back /
duplicates / phase), `window.__celebrationAudio`, `window.__celebrationFrames`, `window.__arenaLatency`.

## Hidden tab, refresh, reconnect, screen changes

| Situation | Policy |
| --- | --- |
| Tab hidden | No new Teams celebration starts while hidden; waiting ones stay queued (none dropped) and play in order when the tab is shown. A celebration whose time ran out while hidden ends at once when shown. |
| Background timer throttling | End times are timestamps, re-checked when the tab becomes visible, so a throttled timer never extends a celebration. |
| Refresh | Nothing from before the page load is replayed (unchanged rules). |
| Stream reconnect / background sync | Redelivered or recovered events are deduplicated; never replayed. |
| Leaving Teams Arena | The celebration on screen ends; anything not yet shown goes to the standard sale card (not lost); the team sound fades out (120 ms). |
| Standings / leaderboard refresh | Never restarts a celebration or touches its sound (keyed by sale id). |

## Audio

* **One audio context**: the existing engine's (Howler's) Web Audio context and master gain (Admin sound switch,
  master volume, mute). No context per sale.
* **Preload and cache**: the four files are fetched in the background after the page loads and decoded once audio
  is allowed (first click); decoded buffers stay in memory. Playing never fetches or decodes again.
* **Audio-clock scheduling**: `AudioBufferSourceNode.start(when)`; a busy main thread or a re-render cannot delay,
  restart or cut a sound once scheduled.
* **Overlap**: a new sound never hard-cuts the previous one. If the previous one is in its main part, the new one
  starts right after it (≤ 0.6 s later); the previous tail fades out over 0.25 s.
* **Interruptions**: if the browser / OS suspends audio during a sound, that sound is stopped and not resumed or
  replayed later. A sound requested while audio is locked (no click yet) or suspended is skipped, never queued.
  Mute applies at once through the master gain. Autoplay rules and OS audio controls are respected.
* A slow PC never mutes anything automatically.

## Slow PCs and Lite mode

* **Lite display** = Performance mode (Admin → Global Display Performance), or Auto on a weak device (existing
  device check) or on a display **measured** to struggle: frame pacing is recorded while each celebration plays,
  and two of the last three below ~40 fps switch later celebrations to Lite for that session.
* **Lite keeps** the lion / panther emblem, the headline, the closer, the team total and the sound. It drops the 3D
  entrance, parallax and light pass, uses fewer confetti particles, and the bonus popup skips its full-screen
  backdrop blur.
* **Reduced motion** (viewer preference) is honoured on its own: the still composition, opacity only.
* **Always**: celebration animations use transform / opacity (the light pass and the glowing edge no longer animate
  `background-position` / `filter`; the exit no longer animates a blur); confetti moves by real time, not per frame
  (no slow motion on weak PCs); the arena floor scrolls by transform (no repaint every frame); while a Teams
  celebration plays, the decorations underneath it pause.

## Tests

* `tests/unit/celebration-queue.test.ts`, `tests/unit/celebration-sounds.test.ts`: state machine, completion
  signal, Lite rule, audio rules and files.
* `tests/e2e/celebration-reliability.ui.spec.ts`: CPU-throttled scenarios (rapid sales, sale + bonus, hidden tab,
  audio suspension, slow images, standings updates, screen switching, measured Lite) with frame / long-task /
  audio-latency / queue metrics in `playwright-report/reliability/metrics.json`.
  * development server: part of `npx playwright test -c playwright.ui.config.ts`;
  * production build: `npm run build && npx playwright test -c playwright.perf.config.ts`.
* Simulated: CPU throttling on a desktop browser, simulated tab visibility and stream events. Real office PCs,
  GPUs, speakers and genuine live sales were not part of these tests.
