# Plan: Widget drag input and blank-image-after-click fix

Work item: `261112-2105-widget-drag-input-and-blank-image-after-click-fix`
Status: Planned
Created: 2026-11-12
Updated: 2026-11-12

Assurance: medium - mouse input and the kitty image pipeline are shared by every widget, so a regression is visible in every widget and the tmux rendering path can only be checked by hand. The changes are local to the extension and easy to revert, and no data, secrets, or external systems are involved.

## Goal

1. Drag gestures work in widgets: press, hold, and move drags a range slider (and canvas drawing or drag-and-drop) instead of only setting the value where the press lands.
2. A focused widget no longer randomly loses its image (grid area turns blank while the title line stays) after a click, which today persists until Escape and another click.

## Context

- Runtime environment of the report: Pi 1.5.2 (global install), tmux 3.8, Ghostty 1.4.0, fullscreen TUI. The repository builds and type-checks against Pi 1.4.0 devDependencies, while `npm run test:e2e` launches the global `pi` (1.5.2).
- Drag root cause (verified in planning): Pi 1.5.2 dispatches `drag` events to the captured widget row, and `WidgetComponent.handleMouse` (`src/component.ts`) forwards them as CDP `mouseMoved` with `buttons: 1` but no `button`. `WidgetPage.mouse` (`src/page.ts`) then defaults `button` to `"none"` for `mouseMoved`. A throwaway probe against `WidgetPage` showed that a range input dragged with `button: "none"` stays at 0, while `button: "left"` moves it to 50.
- Blank image report (user, 2026-11-12): only the image goes blank, the title line stays. It happens on clicks while the widget is focused, more often when the click changes widget state or starts an animation, and also after many clicks on static widgets. Escape (release and freeze) followed by a click (wake, recovery re-send to the shown id) restores it.
- Ruled out or unlikely (planning evidence): tmux output discards (`#{client_discarded}` is 0 for the user's Ghostty client; tmux `tty_block_maybe` in `tty.c` drops all output, including passthrough, while a client is blocked). Pi image handling (Pi 1.5.2 `terminal-image.js` still returns `images: null` under `TMUX`, so its kitty deletes are not emitted). Pi 1.4.0 -> 1.5.2 `tui-alt-screen.js` and `tui.js` diffs do not touch mouse dispatch or this render path.
- Remaining hypotheses for the blank (unconfirmed): (H1) `KittyImage` bookkeeping (`shown`, `current`, `retire`) deletes or overwrites the id the terminal still shows, for example when `lines()` runs in a render whose rows are not written, or when Pi renders the row at more than one width so `setDisplay` triggers re-sends to the shown id. (H2) A chunked upload is left incomplete in Ghostty. (H3) Ghostty evicts images under its storage limit. (H4) Something else the dev log reveals.
- Relevant wiki: [Terminal graphics under tmux](../../../wiki/terminal-graphics-tmux.md) (double buffering, passthrough visibility, mouse modes, dedicated-window test procedure).

## Requirements

- RQ01 Drag: `WidgetPage.mouse` derives the CDP `button` of a `mouseMoved` without an explicit button from the held-buttons mask (`1` left, `4` middle, `2` right, in that priority). Hover moves with no held buttons keep `"none"`. Callers that pass an explicit `button` keep it.
- RQ02 Drag works end to end under tmux in Pi 1.5.2: press, drag, and release on a range input moves the value continuously, including when the pointer leaves the grid while the button is held (Pi pointer capture, clamped coordinates).
- RQ03 Diagnose before fixing the blank image: add dev-log events only (metadata, never frame data, active only with `PI_WIDGETS_DEV=1`). Events cover each kitty write (image id, `send` or `resend` or `delete`, byte length, cols and rows), each change of the id in the placeholder rows, each delayed retire decision (delete or skip and why), display box changes with the render width, and focus and press events. Reproduce with the user in a dedicated tmux window (wiki procedure): rapid focused clicks on an animated fixture and a state-changing static fixture, and correlate the moment the image goes blank with the log.
- RQ04 Fix the confirmed cause of the blank image inside the extension with the smallest coherent change, keeping double buffering (no flashing between frames), scaled re-sends, recovery re-sends, `check_widget`, and the one-live-widget rule working.
- RQ05 Bump the devDependencies `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` to `1.5.2` (`package.json` and `package-lock.json`, user-approved) and fix any typecheck or test fallout without changing runtime behavior beyond RQ01-RQ04.
- RQ06 Add regression tests where the cause has a deterministic seam: a browser test for the slider drag, a unit test for the drag button mapping, an e2e drag test, and a unit or e2e test for the blank-image cause when it is reproducible without a human.

## Out of scope

- Hover-driven behavior under tmux (Pi enables only button-motion tracking there).
- Blanking that occurs only in plain Ghostty without tmux (best-effort environment).
- The stale second tmux client (`/dev/ttys021`, `xterm-256color`) attached to the user's session.
- Changes to Pi, tmux, or Ghostty; periodic "heal" re-sends or other broad redesigns of the image transport (stop and ask instead, see Risks).
- Commits, pushes, and any external writes.

## Design

- Drag: change only the default in `WidgetPage.mouse` (`src/page.ts`): `button: ev.button ?? (ev.type === "mouseMoved" ? buttonFromMask(ev.buttons) : "left")`, where `buttonFromMask` returns `left`, `middle`, `right`, or `none`. `WidgetComponent` already sends `buttons` on drags, so no component change is needed. The revive replay and `check_widget` paths are unaffected.
- Blank image: decide after diagnosis. Expected seams are `KittyImage` in `src/kitty.ts` (send, resend, lines, retire), `setDisplay` and `pointer` in `src/manager.ts`, and `WidgetComponent.renderLines` in `src/component.ts`. Record the confirmed cause and chosen fix in the Decision Log before implementing it.

## Decision Log

| ID | Scope | Decision | Rationale | Evidence | Revisit when |
| --- | --- | --- | --- | --- | --- |
| PD01 | Drag | Fix the move button in `WidgetPage.mouse`, not in the component. | One choke point covers drags, hover, and any other move caller; the component already supplies `buttons`. | Planning probe: `button: "none"` leaves a range at 0, `button: "left"` moves it to 50. | A caller needs a different move button than the mask implies. |
| PD02 | Blank image | Diagnose with dev-log metadata and a user-assisted tmux repro before changing transport logic. | The cause is not confirmed and the double-buffer logic is shared by every widget. | tmux discards ruled out (`client_discarded` 0); Pi kitty output disabled under tmux. | The repro fails after a reasonable attempt; then ask the user how to proceed. |
| PD03 | Dependencies | Bump Pi devDependencies to 1.5.2. | Type-check and unit tests should match the Pi the user runs and e2e already uses. | User approval in planning. | 1.5.2 typings force runtime changes beyond this scope; then ask. |
| PD04 | Blank image | Confirmed cause (T03): tmux 3.8 with `allow-passthrough on` drops passthrough while a pane or window redraw is pending (`PANE_REDRAW`, `CLIENT_REDRAWWINDOW`), and redraws stay pending while the client's output buffer still holds an earlier upload. A dropped or partial upload leaves the rows on an id Ghostty already deleted. The extension's bookkeeping is correct. | The cause is in tmux, not in `KittyImage`, so the fix choice goes to the user (Risks). | User repro: blanks on 2 of 3 clicks with `on`, none in 60+ clicks with `allow-passthrough all` on the test pane; dev log shows no delete or overwrite of the shown id; tmux 3.8 source (see `verification.md`). | A tmux release changes passthrough handling. |
| PD05 | Blank image fix | User chose option B on 2026-11-12: the extension does not change tmux state. It reads the effective `allow-passthrough` for its pane and shows a one-time, non-blocking startup warning when it is `on` (`passthroughNotice` in `src/env.ts`, unit-tested). README and `wiki/terminal-graphics-tmux.md` document `set -g allow-passthrough all`, the cause, and the side effect (`all` also forwards passthrough from hidden panes). AC02 is verified under `allow-passthrough all`; the default `on` remains a documented user-config requirement, not fixed in code. Rejected: (A) the extension sets `all` on its pane at runtime, which writes user tmux state; (C) smaller frames, pacing, or heal re-sends, which only reduce the blanks. | The cause is outside the extension (PD04), and the user does not want tmux options written. | Orchestrator answer relaying the user decision, 2026-11-12. | A future tmux forwards passthrough during redraws, or the user wants an in-code mitigation. |
| PD06 | E2E test fallout (RQ05, AC04) | Fix four e2e failures in test code only. Guidance AC03 and AC04 compute the expected `check_widget` PNG size from the widget's logged CSS viewport, and widgets RQ01 computes the expected CSS viewport from the logged `cssCell`, instead of hard-coding a 16x34 px cell. AC03a opens a fresh `e2e-click` widget instead of reusing one the delivered widget-data message scrolled out of view. Assertions keep the same checks, and no `src/` behavior changes. | All four failed identically on an unmodified export of 757ef52, so they predate this item's changes. Causes: the Ghostty cell is now 17x37 px (font size), and Pi 1.5.2 renders the delivered message taller. | Orchestrator approval (option a), 2026-11-12; failing and passing e2e logs in `verification.md`. | The e2e harness pins a cell size. |

## Work breakdown

- [x] T01: Drag reaches the page as a real drag
  - Depends on: none
  - Scope: RQ01, RQ02, RQ06 (drag parts).
  - Expected areas: `src/page.ts`, `tests/page.browser.test.ts` or `tests/page.test.ts`, a new or extended e2e fixture under `tests/fixtures/` with a range input, `tests/e2e/widgets.e2e.ts`.
  - Acceptance: browser test drags a range input from 0 to a mid value through `WidgetPage.mouse` press, moves (with `buttons: 1` and no explicit button), and release. An e2e test drags across the grid with SGR drag sequences under tmux and the page reports the changed value through `pi.send` or the dev log.
  - Verification: `npm run test:browser`, `npm test`, targeted e2e in the dedicated tmux window.
- [x] T02: Pi 1.5.2 devDependencies
  - Depends on: none
  - Scope: RQ05.
  - Expected areas: `package.json`, `package-lock.json`, any typecheck fallout in `src/` or `tests/`.
  - Acceptance: `npm run typecheck` and `npm test` pass against 1.5.2.
  - Verification: `npm install`, `npm run typecheck`, `npm test`.
- [x] T03: Diagnose the blank image after focused clicks (cause confirmed: PD04)
  - Depends on: T01 (the drag fix changes input traffic, so diagnose with it in place)
  - Scope: RQ03. Add the dev-log events; build or reuse an animated fixture (`tests/fixtures/anim.html` or `visual.html`) and a static fixture whose click changes visible state; run Pi from this checkout with `PI_WIDGETS_DEV=1` in a dedicated tmux window and ask the user to click rapidly and report when the image goes blank.
  - Expected areas: `src/kitty.ts`, `src/manager.ts`, `src/component.ts` (logging only), test fixtures.
  - Acceptance: a confirmed cause with log evidence, written to this plan's Decision Log and to `verification.md`; or a documented failure to reproduce, followed by a stop to ask the user.
  - Verification: dev-log excerpt around the blank event; user observation.
- [x] T04: Fix the confirmed blank-image cause (per PD05: documentation plus a read-only notice; AC02 verified under `all`)
  - Depends on: T03
  - Scope: RQ04, RQ06 (blank-image regression test where a deterministic seam exists).
  - Expected areas: decided by T03; likely `src/kitty.ts`, `src/manager.ts`, `src/component.ts`, `tests/kitty.test.ts`, `tests/manager.test.ts`.
  - Acceptance: the user repeats the T03 repro (50 or more rapid focused clicks on the animated and the static fixture) with no blank image; the dev log shows no delete or overwrite of the id the rows show; there is no visible flashing between frames on the large visual fixture.
  - Verification: new unit test, full suites, user visual check.

## Acceptance criteria

- AC01 (RQ01, RQ02): The user drags a range slider in a widget under tmux in Pi 1.5.2 and the value follows the pointer; automated browser and e2e drag tests pass.
- AC02 (RQ03, RQ04): The user performs 50 or more rapid focused clicks on an animated widget and on a state-changing static widget with no blank image, and the dev log shows no delete or overwrite of the id the rows show.
- AC03 (RQ04): Animating widgets still show no flashing between frames, and recovery re-sends (click on a frozen widget, resize, `/widgets-refresh`) still restore the image.
- AC04 (RQ05): `npm run typecheck`, `npm test`, `npm run test:browser`, and `npm run test:e2e` pass with Pi 1.5.2 devDependencies.

## Verification plan

- `npm run typecheck`
- `npm test`
- `npm run test:browser`
- `npm run test:e2e`, run in a dedicated tmux window created as described in the wiki page (`tmux new-window -d -n <name> 'sleep 7200'`, user switches to it, confirm the client's current window before every run, kill only that window afterwards).
- Manual (user): slider drag, rapid focused clicks on an animated and a static widget, and a check for flashing on `tests/fixtures/visual.html`, all under tmux with Pi 1.5.2.
- `git diff --check`

## Risks and blockers

- The blank image may not reproduce on demand, because it is random (roughly 1 in 10 clicks). Mitigation: rapid scripted and manual clicks with the dev log on. If it still does not reproduce, stop and ask instead of shipping speculative transport changes.
- The confirmed cause may sit in Ghostty, tmux, or Pi (H2, H3). Then stop and ask before choosing a workaround such as health-check re-sends or smaller frames.
- Pi 1.5.2 typings may differ (for example `TuiMouseEvent` or `getFocusedComponent`). Fix them locally, and ask if fixing them would change runtime behavior.
- The tmux e2e harness splits the pane named by `TMUX_PANE` only in the attached client's current window. Follow the dedicated-window procedure so the user's panes are never split or resized.

## Progress

- [x] Planning complete and confirmed.
- [x] Implementation complete (T01-T04; PD05 and PD06 recorded).
- [x] Verification run and final contract-quality review passed (`verification.md`).

## Execution handoff

Use PI Agent in a fresh session with this prompt:

```text
Read spec/active/261112-2105-widget-drag-input-and-blank-image-after-click-fix/plan.md and item.yaml completely, plus AGENTS.md, spec/AGENTS.md, and wiki/terminal-graphics-tmux.md.
Apply medium assurance. Implement T01 and T02, then T03 (diagnosis with the user in a dedicated tmux window), then T04 only for the cause T03 confirms.
Preserve Requirements, Out of scope, the Decision Log, and the Verification plan; record confirmed discoveries in the Decision Log and Progress.
Run the Verification plan and record only verified evidence, failures, skipped checks, and residual uncertainty in verification.md.
Stop and ask if the blank image does not reproduce, if its cause lies outside the extension, or if the fix needs a broader transport redesign; also before any further dependency change, destructive operation, external write, commit, or push.
```

## Proposed durable knowledge updates

- After T01: add to `wiki/terminal-graphics-tmux.md` that CDP `Input.dispatchMouseEvent` `mouseMoved` needs `button` set to the held button for drags (`buttons` alone does not drag form controls).
- After T04: record the confirmed blank-image cause and its constraint on the same page.
