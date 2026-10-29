---
schema_version: 1
episode_id: "2026-10-29-1954-gamemaster-checkpoint-261029-1840-widget-input-fixes-and-rendering-polish-direct"
timestamp: "2026-10-29T19:54:44+01:00"
summary: "Fixed widget trackpad focus grabbing, click-outside release, and single-click activation, double-buffered frames against Ghostty flashing, made widget pages transparent, and archived the item."
kind: "gamemaster-checkpoint"
status: "shipped"
work_item: "261029-1840-widget-input-fixes-and-rendering-polish"
current: "direct"
topics: ["raw input hook","double buffering","transparent widgets"]
---

# Gamemaster checkpoint: 261029-1840-widget-input-fixes-and-rendering-polish/direct

Date: 2026-10-29
Work item: 261029-1840-widget-input-fixes-and-rendering-polish
Status: shipped
In one line: Fixed widget trackpad focus grabbing, click-outside release, and single-click activation, double-buffered frames against Ghostty flashing, made widget pages transparent, and archived the item.

## Goal

Implement the follow-ups N1-N6 from the widget handoff: horizontal wheel must not focus widgets (N2), a click outside a focused widget releases it (N3), one click hits a control in any state (N6), no flashing while animating (N1), widgets blend into the terminal (N5), and guide wording for clickable visuals (N4).

## How we approached it

- T01 started with the plan's stop-point probe: a throwaway extension in a dedicated tmux window showed `ctx.ui.onTerminalInput` receives typed keys but none of six SGR mouse sequences, while a listener forced to the front of pi-tui's `inputListeners` Set saw all of them. The user authorized a direct plan amendment for a front-of-Set raw input hook with a feature check and a widget-only fallback.
- Outside-press detection queues a microtask per press while a widget is focused; the widget row marks the probe when Pi dispatches the press to its lines, so the component's own layout position decides "outside" without reading more Pi internals. Sideways wheel over a focused widget uses a row anchor from the last dispatched mouse event, corrected by `viewportTop`.
- Clarified with the user that one-line rows from an earlier process have no control to hit; second direct amendment: replay a reviving click only when it landed on a shown still.
- T02 confirmed the flashing cause from Ghostty 1.4.0 source (an upload to an existing id deletes the image when the transmission begins) plus frame-size measurements, then added two ids per widget with delayed delete of the retired id; re-sends keep the shown id to keep regular-mode scrollback valid. The perf harness got the same transport.
- T03 spike: `Emulation.setDefaultBackgroundColorOverride` with alpha 0 yields RGBA screencast frames; pages are transparent unless Pi's theme is light, and `check_widget` composites onto `#1e1e2e`.

## Key decisions

- **Front-of-Set raw input hook** - chose it (user-selected) because Pi's fullscreen viewport listener consumes mouse input first; rejected patching Pi functions or toggling mouse modes.
- **Re-sends reuse the shown id** - chose this over switching ids on recovery because rows already written into regular-mode scrollback cannot be re-rendered.
- **Opaque page under light themes** - widget text defaults to light, so transparency is limited to dark appearance.

## What did not work

- **AC07b round 1 with a rotating square** - neither build visibly flashed (frames about 27 KB); a node-ring fixture with about 1.1 MB frames showed the old build flashing badly and the new one not.
- **Final e2e and perf runs** - started while the attached client had moved back to the user's window 4, so harness splits landed next to the user's pane for about 15 minutes; results passed and the user accepted them, and Gamemaster required a window re-check before every harness run.

## Current state and where we left off

- Shipped/verified: item archived at `spec/archive/261029-1840-widget-input-fixes-and-rendering-polish/` (completed); source changes are uncommitted in the working tree.
- Pending: user-controlled Git checkpoint; optional follow-ups (refresh the sideways-wheel row anchor after layout changes, upstream report to Pi, re-run widget-usage eval prompts).

## Source of truth

- `spec/archive/261029-1840-widget-input-fixes-and-rendering-polish/plan.md`: amended contract and Decision log (probe evidence).
- `spec/archive/261029-1840-widget-input-fixes-and-rendering-polish/verification.md`: checks, perf numbers, AC07 results, deviation.
- `spec/archive/261029-1840-widget-input-fixes-and-rendering-polish/outcome.md`: delivered scope, residual risks, follow-ups.
- `src/rawinput.ts`, `src/kitty.ts`, `src/manager.ts`, `src/component.ts`, `src/page.ts`: implementation.

## Verification

- Done: typecheck; unit 170/170; browser 30/30; e2e 27/27; perf pass (AC02 median marginal 31.05% final, 37.4% at T02 vs 34.41% same-session HEAD); user AC07a-c; final contract-quality review PASS with one non-blocking note.
- Not verified yet: light-theme opaque fallback and plain Ghostty visually; behavior after a Pi update removes the private field.

## Open questions, blockers, next safe action

- Open/blocked: none.
- Next safe action: review `git status` and create the user-controlled commit for the uncommitted source changes.

## Dynamic knowledge trail

- `wiki/terminal-graphics-tmux.md`: topic-specific dynamic knowledge (four edits: double buffering, two Pi mouse input bullets, locate and window re-check refinements).
