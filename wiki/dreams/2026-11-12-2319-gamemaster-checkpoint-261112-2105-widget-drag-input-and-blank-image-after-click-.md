---
schema_version: 1
episode_id: "2026-11-12-2319-gamemaster-checkpoint-261112-2105-widget-drag-input-and-blank-image-after-click-"
timestamp: "2026-11-12T23:19:07+01:00"
summary: "Widget slider drags fixed via the CDP move button; blank images after clicks traced to tmux allow-passthrough on, addressed with docs plus a read-only notice; item archived."
kind: "gamemaster-checkpoint"
status: "shipped"
work_item: "261112-2105-widget-drag-input-and-blank-image-after-click-fix"
current: "direct"
topics: ["widget drag input","tmux passthrough","kitty graphics"]
---

# Gamemaster checkpoint: 261112-2105-widget-drag-input-and-blank-image-after-click-fix/direct

Date: 2026-11-12
Work item: 261112-2105-widget-drag-input-and-blank-image-after-click-fix
Status: shipped
In one line: Widget slider drags fixed via the CDP move button; blank images after clicks traced to tmux allow-passthrough on, addressed with docs plus a read-only notice; item archived.

## Goal

Make press-hold-move drags work in widgets and stop focused widgets from randomly losing their image after a click, under tmux 3.8 and Ghostty with Pi 1.5.2.

## How we approached it

Fixed the drag first: `WidgetPage.mouse` now derives the CDP button of a held-button move from the `buttons` mask (`buttonFromMask`), with a browser test that fails on the old default and an e2e SGR drag test. Bumped the Pi devDependencies to 1.5.2 (approved). For the blank image, added dev-only kitty diagnostics (writes, row switches, retire decisions, ids on Pi's last written screen). A hidden-window stress showed clean bookkeeping. A user-assisted repro in a dedicated window blanked on 2 of 3 clicks with the rows on a fully uploaded, never-deleted id. Reading tmux 3.8 source showed passthrough is dropped while a pane or window redraw is pending under `allow-passthrough on`. A pane-scoped `all` stopped the blanks (60+ clicks). Asked how to proceed; the user chose documentation plus a one-time read-only notice. Then ran the full verification, fixed four pre-existing e2e failures in test code, answered a lag question with measurements, passed the review, and archived.

## Key decisions

- **Fix the move button in `WidgetPage.mouse`** - one choke point for all move callers; rejected a component-level change.
- **Option B for the blank image** - the user chose docs plus a notice; rejected setting `allow-passthrough all` from the extension (writes user tmux state) and frame-size or pacing mitigations (reduce, not remove).
- **Fix pre-existing e2e failures in tests only** - approved as Pi 1.5.2 and environment fallout after they reproduced on an unmodified HEAD export.

## What did not work

- **Hidden-window stress for the blank image** - it cannot reproduce the bug: tmux drops passthrough for hidden panes anyway, and the loss happens only on the real client output path, so a visible pane and a user are needed.
- **First round-2 user report** - the dev log showed only 7 presses on the intended widget and no `/widgets-refresh`; the checks were repeated and then matched the log.

## Current state and where we left off

- Shipped/verified: drag fix, Pi 1.5.2 devDependencies, dev diagnostics, passthrough notice, README and wiki docs, e2e fallout fixes; item archived as completed.
- Pending: user-controlled Git checkpoint (nothing staged or committed).

## Source of truth

- `spec/archive/261112-2105-widget-drag-input-and-blank-image-after-click-fix/plan.md`: requirements and Decision Log PD01-PD06.
- `spec/archive/261112-2105-widget-drag-input-and-blank-image-after-click-fix/verification.md`: checks, user observations with passthrough values, tmux cause, lag numbers.
- `spec/archive/261112-2105-widget-drag-input-and-blank-image-after-click-fix/outcome.md`: delivered scope and residual risks.
- tmux 3.8 `screen-write.c`, `tty.c`, `server-client.c`, `input.c`: the passthrough drop conditions.

## Verification

- Done: typecheck; 195 unit, 38 browser, 32/32 e2e tests; perf AC01 and AC02; user checks under `all`; contract-quality review passed after one re-review.
- Not verified yet: which tmux write sets the pane redraw flag; the hidden-window benefit of `all`.

## Open questions, blockers, next safe action

- Open/blocked: none.
- Next safe action: the user reviews and commits the uncommitted changes.

## Dynamic knowledge trail

- `wiki/observations.md`: four observations (e2e and user-assisted checks, widget image diagnostics).
