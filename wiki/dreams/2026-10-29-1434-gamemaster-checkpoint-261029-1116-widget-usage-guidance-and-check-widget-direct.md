---
schema_version: 1
episode_id: "2026-10-29-1434-gamemaster-checkpoint-261029-1116-widget-usage-guidance-and-check-widget-direct"
timestamp: "2026-10-29T14:34:50+01:00"
summary: "Direct T01 split widget guidance into a minimal show_widget description, an always-on rubric, and a read-tracked guide file, and added the read-only check_widget tool; all checks, the completion review, and the 14/14 manual eval passed, and the item was archived as completed."
kind: "gamemaster-checkpoint"
status: "shipped"
work_item: "261029-1116-widget-usage-guidance-and-check-widget"
current: "direct"
topics: ["widget guidance","check_widget"]
---

# Gamemaster checkpoint: 261029-1116-widget-usage-guidance-and-check-widget/direct

Date: 2026-10-29
Work item: 261029-1116-widget-usage-guidance-and-check-widget
Status: shipped
In one line: Direct T01 split widget guidance into a minimal show_widget description, an always-on rubric, and a read-tracked guide file, and added the read-only check_widget tool; all checks, the completion review, and the 14/14 manual eval passed, and the item was archived as completed.

## Goal

Make the agent use `show_widget` well and only when it helps: shrink the tool description, keep a short when-to-use rubric always in context, move the authoring guide into `guide/widgets.md` with read tracking and a one-line pointer, and add `check_widget({id})` so the agent can see and inspect a widget it rendered (low assurance, direct mode).

## How we approached it

- Moved the model-facing text into `src/prompts.ts`: a 112-word description with the guide's absolute path, 4 `promptGuidelines` bullets, and the check_widget description.
- Added `src/guide.ts` (guide path from the module URL, Pi-like read path resolution with `@`, `~`, cwd, and realpath; tracker with pointer and reset) wired to `tool_result` for `read`, `session_compact`, and `session_start` in `src/index.ts`.
- Added `check_widget`: `WidgetPage.capture` (CDP `Page.captureScreenshot` with `clip.scale`, works on minimized frozen pages) and `inspect` (probe in an isolated world), `WidgetManager.check`, report formatting in `src/check.ts`, and a dependency-free PNG decode, box downscale, and encode in `src/png.ts` for closed-widget stills.
- Wrote the guide, README "Agent guidance" section, unit, browser, and e2e tests, extended the faux model with `e2e-call <tool> <json>`, and wrote the manual eval script `tests/eval/widget-usage.md`.

## Key decisions

- **Downscaling without dependencies** - chose Chromium `clip.scale` for open pages plus a small Node `zlib` PNG scaler for RAM stills; rejected relaunching the browser for closed widgets because it would be a side effect of a read-only tool.
- **Layout probe scope** - report only the outermost offending element, check against the nearest clipping ancestor, and treat `overflow: auto` or `scroll` content as intended so scrolling logs are not flagged.
- **Unknown versus imageless ids** - both are text-only errors; widgets from a resumed session are unknown until clicked, and the message says so.

## What did not work

- **Full e2e from the agent's own pane** - the user's window had three 62x54 panes, so the 80x24 suites could not split; the user chose a dedicated tmux window, which the agent created, the user viewed, and the agent closed after a 22/22 run.

## Current state and where we left off

- Shipped/verified: item archived at `spec/archive/261029-1116-widget-usage-guidance-and-check-widget/` with status completed; source changes uncommitted and unstaged.
- Pending: user Git checkpoint; five user follow-ups recorded in the outcome (animation flashing and double-buffered frames, wheel over an unfocused widget focusing it as a possible regression, click outside a focused widget releasing it, more in-widget interactivity in the guide, transparent or Pi-theme background).

## Source of truth

- `spec/archive/261029-1116-widget-usage-guidance-and-check-widget/plan.md`: contract RQ01-RQ06, AC01-AC07, QD01-QD04.
- `spec/archive/261029-1116-widget-usage-guidance-and-check-widget/verification.md` and `evidence/`: checks, coverage, review, and user observations.
- `spec/archive/261029-1116-widget-usage-guidance-and-check-widget/outcome.md`: delivered scope, residual risks, and follow-ups.
- `src/prompts.ts`, `src/guide.ts`, `src/check.ts`, `src/png.ts`, `guide/widgets.md`: implementation.

## Verification

- Done: typecheck pass; unit 138/138; browser 29/29; e2e 22/22; no leftover Chromium; independent completion review PASS with no findings; user-run AC07 eval 14/14; archive preflight, archive, and operational validate valid.
- Not verified yet: guide read timing during the eval (not reported); reads through tools other than `read`; Pi drawing the check image inline outside tmux.

## Open questions, blockers, next safe action

- Open/blocked: none.
- Next safe action: after the user's Git checkpoint, reproduce the wheel-over-unfocused-widget and click-outside-release reports with the e2e harness before planning fixes.

## Dynamic knowledge trail

- `wiki/terminal-graphics-tmux.md`: topic-specific dynamic knowledge (promoted observation).
- `wiki/observations.md`: promoted observation removed.
