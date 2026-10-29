---
schema_version: 1
episode_id: "2026-10-29-1031-gamemaster-checkpoint-261028-1700-interactive-html-widgets-for-pi-02-02"
timestamp: "2026-10-29T10:31:06+01:00"
summary: "Final slice 02.02 added the lifecycle, revive, scaling, recovery, and cleanup policy plus README and whole-plan acceptance; AC01-AC16 passed with user-confirmed AC12-AC14, both review gates passed, and the item was archived as completed."
kind: "gamemaster-checkpoint"
status: "shipped"
work_item: "261028-1700-interactive-html-widgets-for-pi"
current: "02.02"
topics: ["lifecycle and revive","tmux graphics"]
---

# Gamemaster checkpoint: 261028-1700-interactive-html-widgets-for-pi/02.02

Date: 2026-10-29
Work item: 261028-1700-interactive-html-widgets-for-pi
Status: shipped
In one line: Final slice 02.02 added the lifecycle, revive, scaling, recovery, and cleanup policy plus README and whole-plan acceptance; AC01-AC16 passed with user-confirmed AC12-AC14, both review gates passed, and the item was archived as completed.

## Goal

Implement the last sliced Current 02.02 (segment T02, assurance medium): focused 5 min freeze, at most 5 pages with LRU close, 30 min frozen close, browser exit when empty, click revive with fresh JS state (inline from tool args, path from the current file, missing-file notice), placeholder rows after restart or reload, scaled display and mouse mapping in narrow panes, re-sends after resize and through `/widgets-refresh`, cleanup, README, and whole-plan acceptance AC01-AC16, then the focused T02 and final contract-quality reviews and the archive.

## How we approached it

- Recorded shasums of the frozen packets, R001, discovery, research, and the raw PoC handoff at HEAD 580ee78 and rechecked them at the end (unchanged, also after the archive move).
- Answered the open discovery first with a browser test: two pages in one chrome-headless-shell get distinct window ids, so one page can stay minimized while another streams.
- Rewrote the manager around a mutable page per widget: timers object with dev-only shortening, LRU eviction before every open, frozen-timeout close that keeps the RAM still, `revive()` for closed widgets and for rows from an earlier process (new image id), widget ids owned by the manager so a revived page keeps the widget id, per-widget display boxes, and a coalesced re-send on resize or full redraw.
- Component renders scaled grids, closed rows with their still, problem lines, and a one-line "click to load" row; tool rows pass their persisted `html` argument as the revive source.
- Wrote a lifecycle e2e file (dev timers, LRU, close timer, browser exit, warm and cold revive, path revive from the current file, missing file, inline revive, restart with `-c`, `/reload`, narrow pane with 18 scaled hits, resize re-send, `/widgets-refresh`, kill -9) and a perf `disk` phase running Pi for 60 s with a live animating widget.
- Ran the user-confirmed checks through Gamemaster: AC12 scaled rendering, AC13 reattach from a new Ghostty window, AC14 plain Ghostty via a small launcher script.

## Key decisions

- **AC04 profile writes** - recorded the actual pattern (two delayed Chrome leveldb writes, 49 B at about +60 s and 152 B at +120 s, no image files) and the user accepted it as satisfying AC04 under the plan Assumption; rejected adding Chromium flags to suppress them.
- **Focused freeze keeps focus** - a focused widget frozen after 5 min keeps keyboard focus and the next key or click wakes it; rejected auto-release because it would move focus and deliver data without user action.
- **No window-switch detection** - Gamemaster ruled it scope expansion; README documents click or `/widgets-refresh` as the workaround for images sent while the tmux window was hidden.
- **First press re-sends the still** - small RQ13 addition so a click also restores an image on a still-live widget; presses on a focused widget do not re-send (README wording narrowed).

## What did not work

- **Off-by-one clicks in e2e** - a test helper trimmed leading blank lines of `capture-pane`, shifting row indexes by one; coarse grid targets hid it. Fixed with an untrimmed capture; see the topic page in the trail.
- **First AC12 visual attempt** - opened a fixed 720x306 CSS px fixture at a smaller cell size, so the page itself was cropped; also a temporary `sleep 600` pane expired before the user looked. Redone at the fixture's real size.
- **Blank closed widgets in the second AC12 attempt** - the widgets were drawn while the user's tmux client showed another window, so tmux dropped the uploads; redone in a dedicated window with an automatic refresh in the test driver.
- **Third AC12 attempt** - the user's window had grown, so the pane was full size; then a real defect: the right-most column of every image row except the first was blank because tmux drops placeholder diacritics in the last column. Fixed by never using the last column (unit test), then confirmed.
- **First AC14 attempt reported "not loaded"** - not reproducible; Pi lists the extension as `src` in its header. A launcher script replaced the long pasted command and the check passed; a later dev-log cross-check showed the first resize had not reached Pi, so the resize step was repeated and confirmed.
- **First focused review dispatch** ended without an output block; it was resumed to completion (PASS).

## Current state and where we left off

- Shipped/verified: typecheck clean, unit 116/116, browser 24/24, e2e 20/20, perf pass (AC01 0% frozen, AC02 median marginal 28.45%, AC04 no image files), manual AC12-AC14 user-confirmed, focused T02 review PASS, final contract-quality review PASS (non-blocking only). Item archived at `spec/archive/261028-1700-interactive-html-widgets-for-pi` with status completed.
- Pending: the 02.02 source, tests, README, and spec archive move are uncommitted and unstaged, awaiting a user-controlled Git checkpoint.

## Source of truth

- `spec/archive/261028-1700-interactive-html-widgets-for-pi/verification.md`: AC01-AC16 table, review findings, unverified areas.
- `spec/archive/261028-1700-interactive-html-widgets-for-pi/outcome.md`: delivered scope, deviations (AC02 marginal judgment, AC04 write pattern), residual risks.
- `spec/archive/261028-1700-interactive-html-widgets-for-pi/implementation/02-02-lifecycle-acceptance.md`: changed paths and completion evidence.
- `src/manager.ts`, `src/component.ts`, `src/index.ts`, `README.md`, `tests/e2e/lifecycle.e2e.ts`, `scripts/perf/run.ts`.

## Verification

- Done: all repository checks on the final tree; no chrome-headless-shell or own tmux panes left; frozen files and the raw PoC handoff byte-identical.
- Not verified yet: in-Pi `/resume` (shares the shutdown and start path covered by restart and `/reload`), kitty as tmux client, concurrent opens beyond 5 pages, focused-frozen close timer behavior beyond the documented restart at release.

## Open questions, blockers, next safe action

- Open/blocked: none.
- Next safe action: the user reviews `git status` and makes a Git checkpoint for 02.02 and the archive move.

## Dynamic knowledge trail

- `wiki/terminal-graphics-tmux.md`: Topic-specific dynamic knowledge (new page).
- `wiki/observations.md`: Observation (new queue).
