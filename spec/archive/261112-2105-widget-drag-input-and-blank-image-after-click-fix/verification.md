# Verification: Widget drag input and blank-image-after-click fix

Work item: `261112-2105-widget-drag-input-and-blank-image-after-click-fix`
Date: 2026-11-12

Status: complete (direct mode, medium assurance); all checks, user checks, and the final contract-quality review pass.

## Environment

- Pi 1.5.2 (global install, used by e2e and the manual sessions), devDependencies bumped to 1.5.2 (T02). Starting `HEAD` 757ef52.
- tmux 3.8 and Ghostty client `/dev/ttys000` (`xterm-ghostty`, 177x51, cell 17x37 device px, `client_discarded` 0). During T03 a stale second client `/dev/ttys021` (`xterm-256color`, 88x46, `client_discarded` 71919) was attached to the same window. It was gone by the later runs; it was never detached by this run.
- `allow-passthrough`: the running server was `on` during T03 and the first drag e2e. The user then added `set -g allow-passthrough all` to `~/.config/tmux/tmux.conf` and reloaded it themselves. All later checks ran under `all` unless a row below says otherwise. Pane-scoped values were set only on panes of this run's own test windows (`piw-blank` @146, `piw-check` @148), and those windows were killed afterwards (`piw-e2e` @150 too).

## Commands and checks

| Check | passthrough | Result | Evidence |
| --- | --- | --- | --- |
| `node --import tsx --test --test-name-pattern=RQ01 tests/page.browser.test.ts tests/page.test.ts` | n/a | pass (2) | Range-drag browser test, `buttonFromMask` unit test. |
| Same browser test with the old `"none"` default restored temporarily | n/a | fail as expected (`got 0`) | The test detects the drag bug. |
| `npm install --save-dev --save-exact @earendil-works/pi-coding-agent@1.5.2 @earendil-works/pi-tui@1.5.2` | n/a | done | `package.json`, `package-lock.json` (PD03). |
| `npm run typecheck` | n/a | pass | Final tree. |
| `npm test` | n/a | pass (195) | Final tree, incl. `passthroughNotice` and `KittyImage` diagnostics tests. |
| `npm run test:browser` | n/a | pass (38) | Final tree. |
| `TMUX_PANE=%667 ... --test-name-pattern=RQ02 tests/e2e/widgets.e2e.ts` | on | pass (1) | E2E slider drag under tmux, Pi 1.5.2, window @146. |
| `TMUX_PANE=%675 npm run test:e2e` (first full run) | all | 28 pass, 4 fail | AC03, AC04 (guidance), RQ01 tool widget, AC03a. |
| Same four tests on an unmodified `git archive` export of 757ef52 | all | the same 4 fail with the same assertions | Pre-existing: hard-coded 16x34 px cell (client is 17x37), and AC03a's widget scrolled out of the 24-row split by the delivered widget-data message (PD06). |
| Affected e2e after the test-only fixes (`--test-name-pattern="AC03\|AC04\|RQ01\|input fixes"`) | all | pass (8) | Window @150. |
| `TMUX_PANE=%703 npm run test:e2e` (final) | all | pass (32) | Window @150, client window checked before each run. |
| `TMUX_PANE=%675 npm run perf` | all | pass | AC01 frozen 0.1% browser CPU, unchanged page 0 frames; AC02 median marginal 34.65% (limit 40%), 8.6 fps; input 18/18 and 60/60 hits; disk phase pass. |
| `git diff --check` | n/a | pass | Final tree. |
| Hidden-window stress (120 scripted clicks, `blank-repro.html` 80x14) | on | no log anomaly | Pi's rendering path does not lose the row switch. |

## User and dev-log checks

| Check | passthrough | User observation | Dev-log evidence |
| --- | --- | --- | --- |
| T03 repro, `blank-repro.html` 120x20 (~1.7 MB frames) | on | blank after click 1 and click 3 of 3 | Rows show 15727495 (`tmux capture-pane -e`); its last op is a complete `send`, with no delete or overwrite of it. |
| Same pane, pane-scoped `all` | all | no blank after 60+ clicks | 97 uploads (median 1.73 MB, min gap 30 ms), 0 anomalies. |
| AC01 slider drag (`e2e-range.html` 100x4), past the right edge too | all | knob follows | - |
| AC02 rapid focused clicks, static state-changing (`blank-repro.html` 120x20) | all | no blank after 50+ | 57 presses, 0 anomalies. |
| AC02 rapid focused clicks, animated (`anim.html` 120x16) | all | no blank after 50+ (first attempt landed only 7 clicks on it, so it was repeated) | 75 presses on the widget, 460 row switches, 0 anomalies (no delete or overwrite of a shown id). |
| AC03 no flashing, `visual.html` 120x16 focused for ~10 s | all | no flash | - |
| AC03 recovery: click on a frozen widget, `/widgets-refresh` | all | images visible; user saw "re-sent" | `live` with a re-send to the shown id; `resend reason=command ids=[both]` to the shown ids. |
| Notice decision live | on (pane-scoped) and all | - | `passthrough notice=true` under `on`, `notice=false` under `all`. |

## Lag observation (user: "everything feels pretty laggy now")

- Small frames run at the 10 fps cap minus encode time: `anim.html` 120x20 (53 KB) at 117 ms median gaps (8.5 fps) under both `all` and pane-scoped `on`, with a 1 ms terminal write. `npm run perf` shows 8.6 fps.
- Large frames are slower because of their size: a 1.2 MB animated fixture ran at 149 ms median gaps (6.7 fps) under both `all` and `on`, with a 20 ms terminal write. The `blank-repro.html` session (1.7 MB) ran at 167 ms (6 fps). Press to first new upload: median 69-107 ms, p90 250-410 ms.
- So `all` adds no measurable cost, and this item changed no frame, pacing, or transport code. The changes are the move button, dev-only metadata (`PI_WIDGETS_DEV=1`, which the manual sessions used and which adds per-event file appends), and the startup notice. The 5-10 fps feel is the documented 10 fps cap, lower for large widgets. It is not a regression.

## T03 confirmed cause

tmux 3.8 drops passthrough output while a redraw of the pane or window is pending, and the extension's large uploads keep that redraw pending:

- With `allow-passthrough on`, passthrough (`screen_write_rawstring`) goes through the normal client checks. `tty_client_ready` skips a client with `CLIENT_REDRAWWINDOW` or `TTY_FREEZE`, and `screen_write_set_client_cb` returns -1 (no client gets the write) while the pane has `PANE_REDRAW` or `PANE_DROP`. Only `allow-passthrough all` (`TTY_CTX_INVISIBLE_PANES`) bypasses both checks. Text is restored by the redraw from tmux's grid, but passthrough is not, and `client_discarded` does not count it.
- `server_client_check_redraw` defers a needed redraw while the client's output buffer is not empty and then sets `CLIENT_REDRAWWINDOW`. A 1.7 MB upload keeps the buffer non-empty, so the next frame upload is dropped. Ghostty has already deleted that image at the start of the transmission, so the rows stay blank until a recovery re-send.
- Which write sets `PANE_REDRAW` was not isolated. Candidates are the `tty.c` `redraw_cb` paths (for example `TTY_CTX_WINDOW_BIGGER` for the smaller stale client) and the scrollbar or obscured-pane paths in `screen-write.c`.
- Source: tmux 3.8 `input.c`, `screen-write.c`, `tty.c`, `server-client.c` from `https://raw.githubusercontent.com/tmux/tmux/3.8/`. Log copies (metadata only, outside the repository): `/tmp/piw/repro-dev.log`, `/tmp/piw/all-run.log`.
- Fix per PD05 (user decision): documentation plus a read-only one-time notice. The extension never writes tmux options.

## Requirement coverage

| Requirement | Evidence | Status |
| --- | --- | --- |
| RQ01 | `buttonFromMask` in `src/page.ts`; unit and browser tests | pass |
| RQ02 | E2E drag test (`tests/fixtures/e2e-range.html`, past the grid while captured); user slider check | pass |
| RQ03 | Dev-log events `kitty` (op, bytes, cells, `writeMs`), `rows`, `rows-written`, `retire`, `press`, `display` with `width`, each with the ids on Pi's last written screen; `KittyImage` diagnostics unit test | pass |
| RQ04 | PD05: README and wiki document `allow-passthrough all`; `passthroughNotice` warns when the value is `on`; double buffering, scaled and recovery re-sends, `check_widget`, and one live widget unchanged (full suites, perf, user checks) | pass under `all`; `on` is a documented user-config requirement |
| RQ05 | Pi 1.5.2 devDependencies; typecheck, unit, browser, and e2e pass; e2e test fallout fixed (PD06) | pass |
| RQ06 | Unit, browser, and e2e drag tests; `passthroughNotice` unit test (the blank needs a human and a real tmux client, so no automated blank test) | pass |

## Review findings

- Final contract-quality review (independent read-only reviewer, medium assurance): initial verdict BLOCK, 1 blocker. `wiki/terminal-graphics-tmux.md` linked `../spec/active/<id>/...`, which would block the archive preflight (`spec/AGENTS.md` archive boundary). Fixed by linking `../spec/archive/<id>/...`. `archive --check` then returned `valid: true`.
- Re-review 1 of 2: PASS, no blockers.
- Non-blocking: plan task and progress checkboxes (updated at assignment success).
- Reviewer uncertainty: static review only; which tmux write sets `PANE_REDRAW` is not isolated; the hidden-window benefit of `all` comes from source.

## Failures and skipped checks

- The four e2e failures of the first full run were pre-existing (reproduced on 757ef52) and were fixed in test code (PD06).
- No automated regression test for the blank image itself: it needs a real tmux client draining output to Ghostty.

## Unverified areas

- Whether a single client (without the smaller stale client) triggers `PANE_REDRAW` often enough to blank images under `on`. The stale-client detach test was optional and skipped.
- The README claim that `all` also delivers images drawn while the window is hidden comes from tmux source (`screen_write_set_client_cb` with `TTY_CTX_INVISIBLE_PANES`). It was not tested by hand.
