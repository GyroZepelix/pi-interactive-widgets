# Slice 02.02: Lifecycle, recovery, and whole-plan acceptance

Plan: `../plan.md`
Implementation index: `./index.md`
Segment: `T02 - Pi extension`
Assurance: medium - personal single-user setup, reversible local extension, KISS preference
Review required now: focused final-segment review plus one final contract-quality review over the whole plan

## Outcome

The extension enforces the full run-time and lifecycle policy, revives closed and resumed widgets, scales widgets in narrow panes, recovers images after resizes and reattaches, cleans up completely, and passes whole-plan acceptance AC01-AC16 with a README documenting usage, config, and limits.

## Why this slice exists now

The policy, revive, scaling, and recovery behaviors act on the integrated component from 02.01, and the whole-plan e2e, perf, and disk runs need the complete extension.

## Relevant context

- RQ06 and PD06: at most one live widget per session; hover or click makes a widget live; making another widget live freezes the previous one immediately; unfocused live widgets freeze 10 s after the last pointer activity; focused widgets freeze after 5 min without input.
- RQ07: at most 5 retained pages per session (least recently used frozen page closes first); 30 min frozen closes; browser closes when no pages remain; revive on click from persisted tool arguments (inline) or the current file (path); missing or unreadable file shows `source file missing: <path>` with the still when available; after a restart or resume each widget row shows a placeholder line until clicked (`session_start` reasons include `resume` and `startup`).
- RQ12: on width changes, send scaled frames and scale mouse mapping; widening restores full size.
- RQ13: after Pi's redraw on a resize, re-send retained RAM stills; register `/widgets-refresh`; in plain Ghostty also re-send after Pi's full redraws (first render and size changes).
- RQ17: session shutdown and reload release pages, timers, listeners, and the browser; `kill -9` of Pi leaves no Chromium.
- Dev mode (RQ16) shortens timers for e2e; fake-clock unit tests cover exact durations.
- Parent-plan sections to load on conflict or uncertainty: Requirements, Acceptance criteria, Verification plan, Assumptions, Risks and blockers.

## Constraints and non-goals

- No JS state persistence across close, resume, or revive; no disk-persisted stills.
- No off-screen detection through Pi's private layout.
- Visual and manual checks (AC13 reattach, AC14 plain Ghostty, scaled rendering) need the user; ask for confirmation and record it.
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

## Completion and handoff

On success, record changed paths, acceptance, check results, both review verdicts, residual uncertainty, and that the plan is complete. Update checkboxes in `implementation/index.md`, set `Current: complete` only after final whole-plan evidence passes, and mark plan task T02 and Progress accordingly. Stop for a user-controlled Git checkpoint and suggest Dream without invoking either.
