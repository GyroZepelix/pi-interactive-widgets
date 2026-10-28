---
schema_version: 1
episode_id: "2026-10-28-2147-gamemaster-checkpoint-261028-1700-interactive-html-widgets-for-pi-02-03"
timestamp: "2026-10-28T21:47:20+01:00"
summary: "Slice 02.03 finished the Pi integration core with click-to-wake under tmux, replacing frozen 02.01 under revision R001; checks and e2e passed and the user confirmed click-to-wake and the AC11 regular-to-fullscreen behavior."
kind: "gamemaster-checkpoint"
status: "shipped"
work_item: "261028-1700-interactive-html-widgets-for-pi"
current: "02.03"
topics: ["pi integration","click-to-wake"]
---

# Gamemaster checkpoint: 261028-1700-interactive-html-widgets-for-pi/02.03

Date: 2026-10-28
Work item: 261028-1700-interactive-html-widgets-for-pi
Status: shipped
In one line: Slice 02.03 finished the Pi integration core with click-to-wake under tmux, replacing frozen 02.01 under revision R001; checks and e2e passed and the user confirmed click-to-wake and the AC11 regular-to-fullscreen behavior.

## Goal

Implement sliced Current 02.03 (segment T02, assurance medium, no review gate for this slice): finish the Pi extension core on top of the preserved 02.01 Attempt 1 work under the revised contract PD09 (a press wakes a frozen widget and reaches the page, hover wakes only where the terminal reports motion, release freezes immediately, multiplexer-aware hint text and tool guidance), without ever toggling mouse modes.

## How we approached it

- Started from HEAD 8f8396c with the uncommitted 02.01 Attempt 1 work and the R001 spec edits; recorded shasums of the frozen packets, R001, discovery, research, and the raw PoC handoff before touching anything and rechecked them at the end.
- Read the Pi 1.4.0 renderer code that picks button-motion tracking under multiplexers and mirrored that exact condition in a small helper in `src/env.ts`, carried through the session state into the hint, the tool result wording, and the dev log.
- Reworked the manager wake rules: the idle timer is armed only for an unfocused widget (creation, hover, or a press that will focus), the creation path was split into a testable `start()`, and a dev-only log event records thaw-to-first-frame latency.
- Wrote fake-clock unit tests with fake pages for the policy. One of them exposed a real race: a press arriving right after a release could be delivered to a page whose freeze was still queued, so the widget stayed frozen. Fixed by always queuing the idempotent wake for presses.
- Replaced the synthetic SGR 35 hover in the e2e suite with a real press-and-release on a frozen widget, added a click-to-wake e2e test with timing diagnostics, and removed the hover helper.
- Ran the visual checks in temporary splits driven by a throwaway script outside the repository, asking the user through Gamemaster which pane to watch, then closed each split after the answer.

## Key decisions

- **Hint condition copied from Pi itself** - chose Pi's own multiplexer test (TMUX, ZELLIJ, or STY defined, or TERM starting with tmux or screen) over the extension's tmux-only environment detection, so the hint matches whether hover can actually arrive.
- **Press always queues the wake** - chose an unconditional idempotent wake for presses over the old check of the live flag, because the old check read stale state while a release freeze was still queued.
- **Dev-only frame latency event** - logged only with the dev flag and dev log path, so normal sessions write nothing and no frame data is ever logged.
- **Reused 02.01 visual items a, b, c, e** - as the packet allowed; every check and the click-to-wake and AC11 visual checks were rerun fresh.

## What did not work

- **Top-level await in a .ts driver under /tmp** - tsx compiled it as CommonJS outside the ESM package; renaming the throwaway driver to .mts fixed it.

## Current state and where we left off

- Shipped/verified: 02.03 checked off in the implementation index, Current is 02.02, completion evidence appended to the 02.03 packet; nothing staged or committed.
- Pending: user-controlled Git checkpoint; slice 02.02 (focused 5 min timer, dev-shortened timers, LRU, revive, scaling, recovery, cleanup, README, perf, plain-Ghostty manual check including hover wake), then the T02 segment review and the final contract-quality review.

## Source of truth

- `src/env.ts`, `src/manager.ts`, `src/component.ts`, `src/index.ts`: multiplexer condition, wake and freeze rules, hint, tool guidance.
- `tests/manager.test.ts`, `tests/component.test.ts`, `tests/env.test.ts`, `tests/e2e/widgets.e2e.ts`: policy, hint, and click-to-wake evidence.
- The item's `implementation/02-03-pi-integration-click-wake.md` completion evidence and `implementation/index.md` Discoveries; `plan.md` PD09 and `refinements/R001.md` for the contract.

## Verification

- Done: typecheck exit 0; unit tests 104 pass; browser tests 23 pass; e2e 9 pass in four consecutive runs (release to frozen about 1 ms, thaw to first frame 2 to 4 ms); user confirmed click-to-wake under tmux and the regular-mode still plus hint, then fullscreen after switching (real-click thaw to first frame 11 and 16 ms); no browser process, started process, or split left; frozen spec history and the raw handoff byte-identical; spec helper validate passed.
- Not verified yet: hover wake and the hover hint in plain Ghostty (source-inferred, manual check in 02.02).

## Open questions, blockers, next safe action

- Open/blocked: none.
- Next safe action: after the user's Git checkpoint, start slice 02.02 from the item's `implementation/02-02-lifecycle-acceptance.md` packet.
