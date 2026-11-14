---
schema_version: 1
episode_id: "2026-11-14-2251-gamemaster-checkpoint-261114-2237-cell-tall-native-controls-so-cell-center-click"
timestamp: "2026-11-14T22:51:14+01:00"
summary: "Native widget controls now get a one-cell min-height from the base CSS layer so cell-center clicks reach them; guide and learn-radio learner note updated; item archived."
kind: "gamemaster-checkpoint"
status: "shipped"
work_item: "261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them"
current: "direct"
topics: ["widget input","cell-center clicks","base css"]
---

# Gamemaster checkpoint: 261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them/direct

Date: 2026-11-14
Work item: 261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them
Status: shipped
In one line: Native widget controls now get a one-cell min-height from the base CSS layer so cell-center clicks reach them; guide and learn-radio learner note updated; item archived.

## Goal

Make every native form control in a widget clickable and draggable from the terminal, wherever the layout puts it. The trigger was the learn-radio `correlation` widget, whose 16 px range sliders sat between two cell centers and never received a click.

## How we approached it

Implemented the confirmed low-assurance plan in direct mode. `baseCss` in `src/page.ts` takes an optional CSS cell size and, when given, adds a `min-height` of the cell height rounded up for non-hidden `input`, `button`, and `select` inside `@layer pi-base`. `WidgetPageOptions.cssCell` carries it, and `WidgetManager.openPage` passes the computed cell on create and `details.cssCell` on revive. Added one unit test and four browser tests: the failing geometry without the cell (slider at y=13 to 29, cell-center drags miss), the same slider with the cell (13 to 33, covers y=30, drag moves it), a checkbox toggle at an arbitrary offset, and author `min-height` precedence. Added a cell-center bullet to the Input section of `guide/widgets.md`, and corrected the first Preferences bullet in the learn-radio learner note (left uncommitted there). One independent completion review passed; the parent approved archiving.

## Key decisions

- **Reproduce the failing geometry with an absolutely positioned slider** - chose `top: 13px` with a default 16 px range because it does not depend on font metrics; rejected embedding the full correlation controls row, whose line height varies with fonts.
- **No backlog entry for the scaled-display limitation** - the parent ruled it is already recorded as accepted out of scope in the plan.

## Current state and where we left off

- Shipped/verified: source, tests, and guide changes in the working tree; item archived at `spec/archive/261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them/` with status completed.
- Pending: user-controlled Git checkpoint; nothing staged or committed. The learn-radio learner note stays uncommitted in its own repository.

## Source of truth

- `spec/archive/261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them/verification.md`: commands, requirement coverage, and review verdict.
- `spec/archive/261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them/outcome.md`: delivered scope, deviations, residual risks.
- `src/page.ts`, `src/manager.ts`, `tests/page.browser.test.ts`: the rule, its wiring, and the regression tests.

## Verification

- Done: `npm run typecheck` clean, `npm test` 196/196, `npm run test:browser` 42/42; completion review PASS with 0 retries; archive check, item validation, and the stale-status sweep (0 hits) passed.
- Not verified yet: the optional manual drag in Pi with the original correlation widget; scaled display (terminal narrower than the widget) remains a documented limitation.

## Open questions, blockers, next safe action

- Open/blocked: none.
- Next safe action: review the working-tree diff and make the Git checkpoint.

## Dynamic knowledge trail

- `wiki/research/cell-center-click-targets.md`: topic-specific dynamic knowledge (current behavior), review pending.
