# Slice 02.02: Lifecycle, recovery, and whole-plan acceptance

Plan: `../plan.md`
Implementation index: `./index.md`
Segment: `T02 - Pi extension`
Assurance: medium - personal single-user setup, reversible local extension, KISS preference
Review required now: focused final-segment review plus one final contract-quality review over the whole plan

## Outcome

The extension enforces the full run-time and lifecycle policy, revives closed and resumed widgets, scales widgets in narrow panes, recovers images after resizes and reattaches, cleans up completely, and passes whole-plan acceptance AC01-AC16 with a README documenting usage, config, and limits.

## Why this slice exists now

The policy, revive, scaling, and recovery behaviors act on the integrated component from 02.03 (which replaced frozen 02.01 under revision R001), and the whole-plan e2e, perf, and disk runs need the complete extension.

## Relevant context

- RQ06, PD06, and PD09 (revision R001): at most one live widget per session; a press wakes a frozen widget and is delivered to the page; hover wakes only where the terminal reports motion; making another widget live freezes the previous one immediately; release freezes immediately; the 10 s idle timer runs from creation and from the last hover move; focused widgets freeze after 5 min without input. 02.03 delivers click-to-wake, release freezing, and the 10 s timer; this slice adds the focused 5 min timer and proves the full AC06 set.
- Open discovery from T01: freeze and thaw are proven for one page; check whether two pages in one chrome-headless-shell share a window id (`Browser.getWindowForTarget`) before relying on one page staying minimized while another is live.
- RQ07: at most 5 retained pages per session (least recently used frozen page closes first); 30 min frozen closes; browser closes when no pages remain; revive on click from persisted tool arguments (inline) or the current file (path); missing or unreadable file shows `source file missing: <path>` with the still when available; after a restart or resume each widget row shows a placeholder line until clicked (`session_start` reasons include `resume` and `startup`).
- RQ12: on width changes, send scaled frames and scale mouse mapping; widening restores full size.
- RQ13: after Pi's redraw on a resize, re-send retained RAM stills; register `/widgets-refresh`; in plain Ghostty also re-send after Pi's full redraws (first render and size changes).
- RQ17: session shutdown and reload release pages, timers, listeners, and the browser; `kill -9` of Pi leaves no Chromium.
- Dev mode (RQ16) shortens timers for e2e; fake-clock unit tests cover exact durations.
- Parent-plan sections to load on conflict or uncertainty: Requirements, Acceptance criteria, Verification plan, Assumptions, Risks and blockers.

## Constraints and non-goals

- No JS state persistence across close, resume, or revive; no disk-persisted stills.
- No off-screen detection through Pi's private layout.
- Visual and manual checks (AC13 reattach, AC14 plain Ghostty including hover-to-wake, scaled rendering) need the user; ask for confirmation and record it.
- Never toggle mouse modes to obtain hover (plan Out of scope).
- The README must cover click-to-interact under tmux, the advice against hover-dependent UI, and the IPv6 limit recorded in `./index.md` Discoveries (IPv6-literal `allowHosts` entries work only with `network.open: true`; use a hostname such as `localhost` in default mode).
- Dependencies limited to PD01.

## Expected source and test areas

- `src/manager.ts`, `src/component.ts`, `src/index.ts`, `src/kitty.ts` (scaled sends already exist from 01.02)
- `tests/manager.test.ts` (fake clock, LRU, one-live rule), `tests/e2e/`, `scripts/perf/`
- `README.md`
- Verification evidence: `../verification.md` (created after the evidence gates pass, per `spec/AGENTS.md`)

These paths are navigation hints. Inspect other source or tests only when Current or a credible regression path requires it.

## Acceptance and checks

- Acceptance: AC01-AC16 in `../plan.md` pass, with manual results for AC13 and AC14 confirmed by the user.
- Check: `npm run typecheck`
- Check: `npm test`
- Check: `npm run test:browser`
- Check: `npm run test:e2e` (visible tmux split; close it afterwards)
- Check: `npm run perf`
- Check: no chrome-headless-shell process started by the runs remains.

## Review gate

Medium plan-final slice: run one focused final-segment review over T02 (02.01 and 02.02), then one final contract-quality review over the whole change that includes whole-plan acceptance. Reviewers apply the credible-harm blocker standard and do not expand the plan. Implement may rerun an affected gate at most twice after targeted corrections.

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

## Completion evidence - 2026-10-29

Starting HEAD: `580ee78` (clean, nothing staged). Assurance medium. Frozen history (01.01, 01.02, 02.01, 02.03 packets, `../refinements/R001.md`, `../discovery.md`, `../research/`) and `wiki/raw/2026-10-27-poc-handoff.md` (blob `43aefcf`) verified byte-identical (shasum) at the end. No dependency change (PD01).

Changed paths:

- `src/manager.ts`: timers (`DEFAULT_TIMERS` 10 s idle, 5 min focused, 30 min frozen close; `timersFromEnv` honors `PI_WIDGETS_DEV_TIMERS` only with `PI_WIDGETS_DEV=1`); focused freeze keeps focus and the next key or click wakes; `MAX_PAGES` 5 with LRU eviction of the least recently used frozen page; frozen-timeout close; closed widgets keep the RAM still and `revive()` reopens them (inline from tool args, path from the current file; a missing or unreadable file sets `source file missing: <path>`); rows from an earlier process revive with a new image id; widget id generated by the manager; per-widget display box (`setDisplay`) re-sends scaled; resize, full-redraw, and `/widgets-refresh` re-sends (`resendAll`); a first press re-sends the still; shutdown clears every timer.
- `src/component.ts`: scaled display (`fitCells` against `maxGridCols(width) = width - 1`, because tmux drops placeholder diacritics in the last column) and scaled mouse mapping (`cellToCss` with the box); closed and placeholder rows ("click to load", "closed · click to reopen", problem line); key input wakes and restarts the focus timer.
- `src/index.ts`: `/widgets-refresh`, revive source from persisted tool args, lifecycle text in the tool description, timers and session reasons in the dev log.
- `src/page.ts` (unreadable entry counts as missing), `src/kitty.ts` (`retained`).
- `README.md` (new): usage, config, network policy, IPv6 limit, click-to-interact under tmux, no hover-dependent UI, lifecycle, recovery incl. hidden tmux windows, limits, development.
- Tests: `tests/manager.test.ts`, `tests/component.test.ts`, `tests/page.browser.test.ts` (two pages have distinct windows), new `tests/e2e/lifecycle.e2e.ts`, `tests/fixtures/e2e-revive.html`, `tests/e2e/plain-ghostty.sh` (manual AC14 launcher), `tests/e2e/lib.ts` (persist/continue/agentDir, `window`, `narrow`, `piPid`, grid locate across uncolored rows), `scripts/perf/lib.ts` (`tmuxLines`: `capture-pane` without trimming leading blank lines, which had shifted row indexes by one), `scripts/perf/run.ts` (AC04 `disk` phase).

Discovery resolved: two pages in one chrome-headless-shell have distinct window ids; freezing one leaves the other streaming (browser test).

Checks (final tree): `npm run typecheck` exit 0; `npm test` 116/116; `npm run test:browser` 24/24; `npm run test:e2e` 20/20 (temporary visible split of the attached client's window, isolated agent dirs, faux model, closed afterwards); `npm run perf` pass (input 18/18 and 60/60; AC01 frozen 0% browser CPU, unchanged page 0 frames; AC02 median marginal 28.45%; AC04 no image file). No chrome-headless-shell left after any run; only own panes, windows, and processes were touched.

Manual (user-confirmed through Gamemaster): AC12 scaled rendering at 45 columns incl. closed and revived widgets (after the last-column fix), hits 0/9/17 in the page log, widening restores; AC13 reattach from a new Ghostty window (the extension's resize re-sends fired) and `/widgets-refresh`; AC14 plain Ghostty render, "hover or click" hint, hover wake without click, clicks 0/17/9, narrow and wide resize (dev log re-sends and scaled display). AC04 profile writes (49 B at +60 s, 152 B at +120 s, Chrome leveldb) accepted by the user as satisfying AC04.

Reviews: focused T02 review PASS (first dispatch ended without output and was resumed to completion; no correction cycle); final contract-quality review PASS. Both non-blocking only (see `../verification.md`).

Residual: kill -9 leaves the puppeteer temp profile folder; images sent while the tmux window is hidden need a click or `/widgets-refresh`; focused-frozen close timer restarts at release; concurrent opens may briefly exceed 5 pages.

Plan complete: Current set to `complete`.

## Completion and handoff

On success, record changed paths, acceptance, check results, both review verdicts, residual uncertainty, and that the plan is complete. Update checkboxes in `implementation/index.md`, set `Current: complete` only after final whole-plan evidence passes, and mark plan task T02 and Progress accordingly. Stop for a user-controlled Git checkpoint and suggest Dream without invoking either.
