# Slice 02.03: Pi integration core with click-to-wake

Plan: `../plan.md`
Implementation index: `./index.md`
Segment: `T02 - Pi extension`
Assurance: medium - personal single-user setup, reversible local extension, KISS preference
Review required now: none (scoped checks only)
Replaces: frozen slice 02.01 (`./02-01-pi-integration.md`), under revision R001 (plan PD09)

## Outcome

Loading the extension with `pi -e ./src/index.ts` registers `show_widget` (and `/widget-dev` when `PI_WIDGETS_DEV=1`). Widgets render inline in Pi fullscreen as a title line plus placeholders. Under tmux a click wakes a frozen widget and reaches the page; where the terminal reports motion, hover also wakes it. Widgets are typeable in place with focus and release, release freezes the widget and delivers `pi.send` data, `pi.submit` delivers immediately, regular mode shows the still plus a hint, unsupported environments show the notice, config is loaded, and plain Ghostty works best-effort. The full timer, close, revive, scaling, and recovery policy comes in 02.02.

## Why this slice exists now

Slice 02.01 hit the hover blocker (RQ05 versus hover-to-wake under tmux) and is frozen. Revision R001 replaced hover-to-wake under tmux with click-to-wake. This slice finishes the Pi integration against the revised contract, starting from the preserved 02.01 Attempt 1 work.

## Starting state

- Git: HEAD `8f8396c` plus the uncommitted 02.01 Attempt 1 work listed in `./02-01-pi-integration.md` "Interruption 1" (source, tests, e2e harness, fixtures, `package.json` `test:e2e`). Continue from it; do not revert it. The 02.01 packet itself is frozen history: do not edit it.
- Already done in that work: `show_widget`, component, keys, bridge, config, notices, `/widget-dev`, TUI probe, RQ09 corrections (IPv6 regression test; open-mode WebSocket fix), release freezes immediately, new widgets run with the 10 s idle timer from creation.
- Reusable evidence: user visual items (a) image visible and left aligned, (b) shapes not squashed, (c) border and corner labels visible, (e) click focus hint and Escape release (02.01 Attempt 1). Invalidated: the e2e hover step (synthetic SGR 35, which a real tmux client never sends) and Attempt 1 check results as final proof (rerun after the corrective edits).

## Relevant context

- RQ01: the tool description adds click-triggered UI guidance (no reliance on `:hover` or hover tooltips under tmux).
- RQ02 hint: use Pi's own condition (`TMUX`, `ZELLIJ`, or `STY` set, or `TERM` starting with `tmux` or `screen`) for "click to interact"; otherwise "hover or click to interact"; the focused hint stays.
- RQ05: never toggle mouse modes; moves arrive only where the terminal reports them.
- RQ06 (PD09) parts owned here: press wakes a frozen widget and is then delivered to the page; hover wakes where reported; one live widget (making B live freezes A); release freezes immediately with `pi.send` delivery; the 10 s idle timer from creation and from the last hover move. The focused 5 min timer, LRU, 30 min close, and revive are 02.02.
- RQ08, RQ11, RQ14, RQ15, RQ16 as in the plan; the TUI probe assumption.
- Parent-plan sections to load on conflict or uncertainty: Requirements, Assumptions, Design, Decision Log (PD03-PD09).

## Constraints and non-goals

- Do not rename the tool (PD03).
- Never toggle mouse modes to obtain hover (plan Out of scope).
- Never embed kitty uploads in rendered lines.
- No LRU, revive, scaling hookup, refresh command, or focused 5 min timer yet (02.02).
- Dependencies limited to PD01.

## Expected source and test areas

- `src/component.ts` (hint text), `src/index.ts` (tool description), `src/manager.ts` (wake and freeze rules if needed), `src/env.ts` (multiplexer condition helper if useful)
- `tests/component.test.ts`, `tests/manager.test.ts` or equivalent unit tests, `tests/e2e/widgets.e2e.ts`

These paths are navigation hints. Inspect other source or tests only when Current or a credible regression path requires it.

## Acceptance and checks

- Acceptance: AC05 in e2e (18 target clicks and a 60-click burst hit; typed keys reach a focused input; Escape releases; `ctrl+u` and `ctrl+d` still scroll the transcript while focused).
- Acceptance: click-to-wake in e2e under tmux: after a widget is frozen, a real SGR press and release sent with `tmux send-keys -l` produces the `live` dev-log event, a new frame, and the page-side press log; releasing it produces the `frozen` event; the hint reads "click to interact". The e2e suite no longer injects synthetic hover moves under tmux.
- Acceptance: unit tests prove the hint selection for each multiplexer condition, release freezing immediately, the 10 s idle timer from creation and from the last hover move (fake clock), and that making B live freezes A.
- Acceptance: AC08 in e2e (`pi.send` with the next user turn after release; `pi.submit` rejected without activation and immediate after a click; untrusted label).
- Acceptance: AC11 in e2e plus a user visual check of regular mode (still plus hint) and of fullscreen after switching.
- Acceptance: AC14 partial (classification unit tests; unsupported notice and agent message; plain-Ghostty path implemented, manual check in 02.02) and AC15 (missing Chromium and invalid config notices).
- Acceptance: user visual check of click-to-wake under tmux: a frozen widget shows a stale counter; one click resumes it and the click reaches the page.
- Check: `npm run typecheck`
- Check: `npm test`
- Check: `npm run test:browser`
- Check: `npm run test:e2e` (visible tmux split; close it afterwards)

## Attempt log

No attempts recorded.

For each interrupted or failed attempt, append without rewriting earlier entries:

```text
### Attempt <number> - <timestamp>
Starting HEAD: <git commit at invocation start>
Changes: <paths and behavior changed>
Checks: <commands and results>
Failures: <failures or none>
Blockers: <credible blockers or none>
Exact next action: <single resumable action>
```

Keep this log concise. Do not duplicate unchanged plan or check output.

## Completion evidence - 2026-10-28

Starting HEAD: `8f8396c` (nothing staged). Assurance medium; review required now: none (scoped checks only). Frozen history (02.01, 01.01, 01.02 packets, `../refinements/R001.md`, `../discovery.md`, `../research/`) and `wiki/raw/2026-10-27-poc-handoff.md` (blob `43aefcf`) verified byte-identical before and after (shasum).

Changed paths:

- Carried over from 02.01 Attempt 1 (unchanged scope, see `./02-01-pi-integration.md` Interruption 1): `package.json` (`test:e2e`), `src/page.ts`, `src/policy.ts`, `src/bridge.ts`, `src/config.ts`, `src/keys.ts`, `tests/fixtures/network.html`, `tests/helpers.ts`, `tests/network.browser.test.ts`, `tests/policy.test.ts`, `tests/bridge.test.ts`, `tests/config.test.ts`, `tests/keys.test.ts`, `tests/e2e/probe-extension.ts`, `tests/fixtures/e2e-bridge.html`, `tests/fixtures/e2e-grid.html`, `tests/fixtures/e2e-input.html`.
- Carried over and corrected in 02.03:
  - `src/env.ts`: `pointerMotionReported()` mirrors Pi's multiplexer condition (`TMUX`, `ZELLIJ`, `STY` defined, or `TERM` starting with `tmux`/`screen`).
  - `src/component.ts`: `interactHint()` gives "click to interact" under a multiplexer, "hover or click to interact" elsewhere; the focused hint is unchanged; `pointer()` calls carry the event kind.
  - `src/manager.ts`: `SessionState.motion` and `hoverReported`; `IDLE_MS` (was `HOVER_IDLE_MS`); `start()` split out of `create()` (10 s idle timer from creation); `pointer(w, kind)` arms the idle timer only for an unfocused widget on hover or press, and a press always queues the idempotent wake, so a press right after a release freeze wakes the widget again (this race left the press on a frozen page before); dev-log `thaw-frame` event with the first-frame latency.
  - `src/index.ts`: RQ01 description adds click-triggered UI guidance (no `:hover` or hover tooltips under tmux) and the click-to-wake wording; tool result names "click" or "hover or click" by environment; `motion` set at load and `session_start` and logged.
  - `tests/component.test.ts` (hint per condition, press wakes before it is queued), `tests/env.test.ts` (multiplexer condition), new `tests/manager.test.ts` (fake clock and fake pages: creation idle 10 s, hover idle 10 s from the last move, press thaw before delivery, focused has no idle timer, release freezes immediately, press after release wakes, B live freezes A, regular mode starts frozen).
  - `tests/e2e/widgets.e2e.ts`: new click-to-wake test; the regular-mode test now wakes by click and expects "click to interact"; `tests/e2e/lib.ts`: the synthetic SGR 35 `hover()` helper removed, so no hover moves are injected under tmux.

Checks (repository root, final tree):

- `npm run typecheck`: exit 0.
- `npm test`: 104 pass, 0 fail (94 before plus 10 new).
- `npm run test:browser`: 23 pass, 0 fail (rerun; unchanged browser code since).
- `npm run test:e2e`: 9 pass, 0 fail in four consecutive runs (Pi 1.4.0, `PI_WIDGETS_DEV=1`, `-e ./src/index.ts -e ./tests/e2e/probe-extension.ts --model e2e-faux/echo`, isolated `PI_CODING_AGENT_DIR`, temporary visible split of the attached client's window 0:4, closed afterwards). Click-to-wake diagnostics: release to frozen 1 ms; thaw start to first frame 2-4 ms; live to page press 0-1 ms.
- After every browser, e2e, and visual run: no chrome-headless-shell process left, every started process gone, every split closed.

Acceptance:

- AC05 (e2e, rerun): 18/18 and 60/60 burst hits; typed text and Backspace reach the focused input; ctrl+u and ctrl+d scroll while focused; Escape releases.
- Click-to-wake (e2e under tmux, real SGR press and release through `tmux send-keys -l`): after release the `frozen` event follows within 1 ms; one press yields `live`, `thaw-frame`, and the page-side hit (in that order), focus, and a second `frozen` on Escape; the hint reads "click to interact" and no "hover" text appears; `session_start` logs `motion: false`.
- Unit: hint selection per condition, release freezes immediately, 10 s idle from creation and from the last hover move, B live freezes A (`tests/manager.test.ts`, `tests/component.test.ts`, `tests/env.test.ts`).
- User visual check, click-to-wake (Ghostty 1.4.0 + tmux 3.6b, user answer "All yes"): title "click to interact" without hover; counter stuck while frozen and hover changes nothing; one click resumes it at once and shows the focused hint; Escape restores the hint and stops the counter. Dev log of that run: idle freeze 10.0 s after creation, then `live` and the first frame 11 ms after the click, `frozen` 1 ms after release.
- AC08 (e2e, rerun): `pi.send` arrives as one untrusted-labeled message with the next user turn and starts no turn; `pi.submit` without activation rejected, after a click delivered with `triggerTurn`.
- AC11 (e2e, rerun, plus user visual, "All yes" twice): regular mode shows the still with "still image ... fullscreen mode needed to interact" and a stuck counter; after switching to fullscreen through `/settings` the widget stays rendered with "click to interact", one click resumes it with the focused hint, and Escape freezes it again (`live` and first frame 16 ms after the click).
- AC14 partial (rerun): env classification unit tests pass; without `TMUX` the notice row `[widgets need tmux + Ghostty] probe widget` shows, the agent is told, and no browser starts. Plain-Ghostty path implemented (no DCS wrap, Pi cell size, re-send after full redraws, hover wake and hint through `motion`); manual check remains in 02.02.
- AC15 (e2e, rerun): invalid config notice with defaults; missing `chromePath` notice with the install command, tool error, and Pi still answering.

Reused evidence: 02.01 user visual items (a) image visible and left aligned, (b) shapes not squashed, (c) border and corner labels, (e) click focus hint and Escape release, as the packet allows. Rerun: every check above (02.01 Attempt 1 results are not used as final proof).

Residual uncertainty: plain-Ghostty hover wake and the hover hint are source-inferred until the 02.02 AC14 manual run; the dev-only `thaw-frame` log is written only with `PI_WIDGETS_DEV=1` and `PI_WIDGETS_DEV_LOG`. Not in scope here (02.02): focused 5 min timer, dev-shortened timers, LRU, revive, scaling, recovery, README.

Next slice: `02.02`.

## Completion and handoff

On success, record changed paths (including the carried-over 02.01 Attempt 1 work), acceptance, check results, reused and rerun evidence, residual uncertainty, and the exact next slice (`02.02`). Update checkboxes and Current only in `implementation/index.md`. Stop for a user-controlled Git checkpoint and suggest Dream without invoking either.
