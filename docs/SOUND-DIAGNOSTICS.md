# Live Arena sound: root cause, fix and Admin diagnostics

## Root cause (silent Live Arena, working Admin previews)

Howler (the audio library) **suspends the browser's AudioContext after 30 s without a Howler sound** (`Howler.autoSuspend`,
on by default). A Live Arena TV sits idle between sales, so by the time a sale arrived the context was `suspended`.
The Teams Arena stingers, the cash bonus / Weekly Top trumpet (and the Arena Cub) refuse to play unless the context is
`running`, so they stayed silent. Admin previews worked because every preview click runs `audioEngine.unlock()`, which
resumes the context first.

Second cause: the audio engine was created only on the first click, so a display whose browser allows autoplay
(kiosk flag / site sound permission) still stayed silent after every reload until someone clicked.

## Fix (`frontend/audio/engine.ts`, `team-stingers.ts`, `celebration-sounds.ts`, `AppProviders.tsx`)

* `Howler.autoSuspend = false`: the Arena keeps its audio context running.
* `audioEngine.readiness()`: `running` / `resumable` (the page already had a click, so the browser allows resume) /
  `locked` (no click yet: browser rule, never bypassed) / `unavailable`.
* Team stingers and the trumpet: if the context was suspended by the device, it is resumed first and the sound plays
  only if that takes < 0.6 s (never late). Locked: skipped, never queued (no burst at the first click).
* The engine starts on page load (autoplay-permitted displays need no click); every click / key re-wakes audio;
  returning to the tab resumes it.
* Live Arena header: an **Enable audio** button appears only while the browser blocks sound.
* Sounds, volumes, routing, popups and business logic are unchanged.

## Admin → Settings → Sound → Run Sound Diagnostics

Settings checks apply to every display (master switch, volume, Sale approved, team sounds, cash bonus categories per
program, Weekly Top category). Browser checks (asset HTTP + decode, AudioContext state, autoplay unlock, schedulability,
engine errors / cancellations) describe **this Admin browser only**.

## Test Live Arena Sounds

Admin-only, CSRF-checked `POST /api/admin/sound-test` (audited `sound.test.sent`) broadcasts `arena.sound.test` on the
existing live stream to all displays or chosen paired displays (filtered server-side by device cookie). Each display
plays the validated-sale sound once through the real engine (respects mute, volume, category; skipped while a sale,
bonus, team celebration or spin is on screen; skipped if the browser has not allowed audio) and posts an
acknowledgement to `POST /api/arena/sound-test` (accepted only for a live, unexpired test id; device identified from its
cookie). Results are **playback confirmation, not proof the speakers are audible**. In memory, 5-minute expiry, no
database writes besides the audit row. With several Node processes, acknowledgements land on whichever process
received them (single `sales-arena` process in production: fine).
