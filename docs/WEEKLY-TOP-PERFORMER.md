# Weekly Top Performer Celebration

Admin → Celebrations → **Weekly Top Performer Celebration**. A manual, Admin-triggered recognition ceremony.
Presentation only: it creates no bonus, prize, award or spin credit and changes no sales data.

## Admin

* Shows this business week (Admin → Arena → business timezone / week start) and its **#1 agent**: exactly the first
  row of the Weekly leaderboard (Safe Quote's per-closer figures for the week, the same mapping and campaign filter
  the Weekly screen uses), with approved and submitted sales. A tie on approved sales is pointed out; the leaderboard's
  own order decides who is first. No approved sale yet → nothing to celebrate.
* **Celebrate Top Performer** (with a confirmation): the server re-reads the figures (never trusts the browser),
  records the celebration and broadcasts it. **Once per business week**: the check runs under a database row lock, so
  a double click or two Admins can never broadcast twice; later attempts are refused and the Admin sees when and by
  whom it was done. Audited (`recognition.weekly_top.celebrated`). Stored in `admin_settings`
  (`recognition.weekly_top_performer`); no migration.
* API: `GET / POST /api/admin/celebrations/weekly-top-performer` (signed-in Admins; POST is CSRF-checked).

## Live Arena

* Delivered on the existing live stream (`arena.recognition.weekly_top`, no polling) to every display, on every
  screen (Daily, Weekly, Monthly, Teams Arena). Each display plays it once (deduped by its id; a reconnect or a
  redelivered event never replays it). Displays that were offline at that moment do not catch up later.
* Played by the **existing celebration queue** as its highest-priority item: it waits for a sale card, a Teams
  celebration or a spin already on screen, and for any bonus popup that is queued, open or fading out (the bonus goes
  first). Once on screen, it finishes before the next bonus popup or sale card. Nothing is dropped and nothing overlaps.
* Shows **CONGRATULATIONS!**, **THIS WEEK'S TOP PERFORMER**, the agent's name, their approved sales and the week's
  date range, with the golden crown medallion, golden confetti, stage light rays and beams, and the cash-bonus
  **trumpet celebration** sound (follows Sound effects, Master volume and the *Winning celebration* category).
* Ends on its own: about 9.5 s (Lite: 8.5 s, reduced motion: 7.5 s), fading out over its last 0.7 s.
* Lite: no rays, beams or light sweep, fewer confetti particles. Reduced motion: the still composition, no confetti.

Tests: `tests/e2e/weekly-top-performer.ui.spec.ts` (ceremony on all four screens, once, ordering with bonus popups
and sale cards, reduced motion, fit), `tests/integration/weekly-top.test.ts` (server-side #1, once per week incl.
simultaneous clicks, audit, no financial records, Admin-only API), `tests/unit/celebration-queue.test.ts`.
