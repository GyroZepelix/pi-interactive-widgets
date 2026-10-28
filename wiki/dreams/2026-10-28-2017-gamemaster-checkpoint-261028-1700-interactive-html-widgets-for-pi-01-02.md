---
schema_version: 1
episode_id: "2026-10-28-2017-gamemaster-checkpoint-261028-1700-interactive-html-widgets-for-pi-01-02"
timestamp: "2026-10-28T20:17:30+01:00"
summary: "Slice 01.02 shipped the kitty transport, environment detection, a standalone tmux harness, and perf scripts; U4 passed visually in Ghostty 1.4.0, input and AC01 passed, AC02 passed on marginal cost, and the T01 segment review passed."
kind: "gamemaster-checkpoint"
status: "shipped"
work_item: "261028-1700-interactive-html-widgets-for-pi"
current: "01.02"
topics: ["kitty transport","tmux harness"]
---

# Gamemaster checkpoint: 261028-1700-interactive-html-widgets-for-pi/01.02

Date: 2026-10-28
Work item: 261028-1700-interactive-html-widgets-for-pi
Status: shipped
In one line: Slice 01.02 shipped the kitty transport, environment detection, a standalone tmux harness, and perf scripts; U4 passed visually in Ghostty 1.4.0, input and AC01 passed, AC02 passed on marginal cost, and the T01 segment review passed.

## Goal

Implement sliced Current 01.02 (segment-final for T01): kitty Unicode-placeholder transport with tmux wrapping and scaled sends, terminal environment detection, and a standalone harness that proves rendering through tmux in Ghostty (U4), input accuracy, and the CPU budgets (AC01, AC02) before any Pi integration starts.

## How we approached it

- Started from HEAD 22eed8a (01.01 checkpoint, clean tree). Inspected the 01.01 page layer API and the PoC handoff testing section as data only.
- Verified the PoC's 256-entry diacritics table byte-for-byte against kitty's `rowcolumn-diacritics.txt` shipped in the local kitty.app docs before embedding it in `src/kitty.ts`.
- Wrote `src/kitty.ts` (grid lines, chunked `t=d` upload, per-chunk tmux wrapping, delete, random non-reused ids, width-limited `fitCells`, `KittyImage` with identical-frame skipping and `resend`) and `src/env.ts` (client terminal via `tmux display -p -t $TMUX_PANE`, plain Ghostty, cell size), plus unit tests.
- Built `scripts/harness.ts`: renders one widget into its own pane, forwards SGR mouse to CSS pixels, exposes a Unix-socket HTTP control (`/stats`, `/hits`, `/scale`, `/freeze`, `/thaw`, `/quit`), uses image ids 0xA1D000-0xA1DFFF, and deletes them on exit.
- Built `scripts/perf/run.ts` and `scripts/perf/lib.ts`: each phase opens a detached split of the attached client's current window (vertical split of the agent pane so 90 columns fit), drives the harness with `tmux send-keys -l`, samples `ps` CPU-time deltas, quits the harness, and closes the split.
- Ran U4 manually in a split with a new `tests/fixtures/visual.html` (circle, square, border, corner labels, live counter) and asked the user through Gamemaster to confirm the full-size and the half-size render.
- Asked Gamemaster how to judge AC02 after the absolute total exceeded 40 percent because of unrelated tmux and Ghostty load; then changed the perf runner accordingly.
- Dispatched one focused T01 segment review over 01.01 and 01.02.

## Key decisions

- **AC02 judged on marginal cost** - Gamemaster (relaying the user) decided the criterion means the widget's own cost: a no-widget baseline of the shared tmux server and Ghostty, same 10 s window, measured in the same invocation immediately before the widget starts, is subtracted only from those two processes (clamped at zero); the browser tree and harness count in full; median of 3 runs against about 40 percent. Interpretation only, plan acceptance text unchanged; pacing and the 10 fps cap were not tuned to chase the number.
- **Harness control over a Unix socket** - chose a small HTTP-over-socket control channel over parsing `tmux capture-pane` output, so hit logs, counters, scaling, and freeze are driven deterministically.
- **Scaled sends round rows up** - `fitCells` keeps width as the limiting dimension so the terminal's aspect-preserving fit fills the width and mouse scale is exactly `cols'/cols`.
- **Non-blocking review findings deferred** - the bracketed IPv6 `allowHosts` mismatch and the open-mode WebSocket gap under an LNA grant were recorded in the index Discoveries instead of being fixed in this slice.

## What did not work

- **Absolute AC02 total** - 43.2 to 43.6 percent median across invocations because the tmux server already used about 7 percent and Ghostty about 2.7 percent with no widget; a future perf session should always take the in-run baseline before judging widget CPU.
- **One unit-test expectation for diacritic index 100** - the test value was wrong, not the table; corrected after checking the kitty file.

## Current state and where we left off

- Shipped/verified: 01.02 checked off, Current is `02.01`, plan task T01 checked; T01 segment review PASS on the first dispatch with zero retries; U4, input, AC01, and AC02 evidence recorded in the 01.02 packet.
- Pending: user-controlled Git checkpoint of the uncommitted 01.02 changes; slice 02.01 (Pi integration core).

## Source of truth

- `src/kitty.ts`, `src/env.ts`, `scripts/harness.ts`, `scripts/perf/run.ts`, `scripts/perf/lib.ts`: transport, detection, harness, and perf runner as built.
- `tests/kitty.test.ts`, `tests/env.test.ts`, `tests/fixtures/visual.html`: unit evidence and the U4 visual fixture.
- The item's `implementation/01-02-kitty-transport-harness.md` completion evidence and `implementation/index.md` Discoveries (U4 result, AC02 interpretation, review findings, untested two-page window id).

## Verification

- Done: `npm run typecheck` exit 0; `npm test` 63 pass; `npm run test:browser` 22 pass; documented `npm run harness` split run clean; `npm run perf` exit 0 with input 18/18 and 60/60, unchanged page 0 frames in 5 s, frozen animating page 0.1 percent browser CPU over 10 s, AC02 marginal median 34.0 percent (absolute 43.17 percent); all started browser PIDs gone and every split closed; user confirmed U4 at 90x18 and 45x9; spec helper validate passed.
- Not verified yet: harness mouse mapping at non-integer scales relies on vertical centering (AC12 in 02.02); whether two pages share one minimized window id; frames run at about 8.5 fps.

## Open questions, blockers, next safe action

- Open/blocked: none.
- Next safe action: after the user's Git checkpoint, start slice 02.01 from the item's `implementation/02-01-pi-integration.md` packet.
