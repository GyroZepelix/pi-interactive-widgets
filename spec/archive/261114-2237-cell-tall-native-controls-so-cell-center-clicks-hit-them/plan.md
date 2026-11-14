# Plan: Cell-tall native controls so cell-center clicks hit them

Work item: `261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them`
Status: Planned
Created: 2026-11-14
Updated: 2026-11-14

Assurance: low - one additive rule in the injected base stylesheet, local to the extension and easy to revert. A browser test reproduces the exact failing geometry deterministically. It touches every widget's base CSS, but only raises the height of native controls that are shorter than one cell.

## Goal

Every native form control in a widget can be clicked and dragged from the terminal, wherever the author's layout puts it. A control shorter than one cell row can sit entirely between two cell centers, and then no click reaches it. Concretely, the learn-radio `correlation` widget's range sliders must respond.

## Context

- Root cause (verified 2026-11-14, see [research page](../../../wiki/research/cell-center-click-targets.md)): `cellToCss` in `src/component.ts` maps each terminal cell to its center in CSS px. With 20 px tall CSS cells, clicks land only at y = 10, 30, 50, ... A Chromium range input is 16 px tall by default. In the failing widget, the sliders spanned y=13 to 29, so no cell center hit them. In the working `antenna-resonance` widget, the slider spanned y=17 to 33 and covered y=30.
- If a control's box is at least one cell tall, its half-open vertical interval always contains exactly one cell center, wherever it sits.
- `baseCss` in `src/page.ts` builds the stylesheet the page injects at document start, inside `@layer pi-base`. It takes no cell size today. `WidgetManager.openPage` in `src/manager.ts` opens pages for both `create` and `revive`. Its callers know the CSS cell size (`cssCellSize`, also stored as `WidgetDetails.cssCell`).
- Planning probe (throwaway, outside the repo): adding `@layer pi-base { input:not([type=hidden]), button, select { min-height: 20px } }` to the original correlation widget moved its sliders to y=13 to 33. A cell-center drag at y=30 then changed the value from 2 to 4.95. A checkbox became 13x20 and toggled on a cell-center click. A text input with an author `height:14px` became 20 px tall, because `min-height` overrides `height` even from a lower cascade layer.
- Existing guidance: `guide/widgets.md` (Input section) says click targets should be about 24 px, but it does not explain cell-center mapping, and default controls break this silently.

## Requirements

- RQ01: When the page knows its CSS cell height, `baseCss` emits a rule inside `@layer pi-base` that gives `input:not([type=hidden])`, `button`, and `select` a `min-height` of `ceil(cell height)` CSS px. `box-sizing: border-box` is already in the base layer.
- RQ02: `WidgetPageOptions` gets an optional CSS cell size (for example `cssCell?: CellSize`), which `setup` passes to `baseCss`. Without it, no min-height rule is emitted, so the harness, perf scripts, and existing tests keep working unchanged.
- RQ03: `WidgetManager.openPage` passes the widget's CSS cell size for both `create` (the computed `css`) and `revive` (`w.details.cssCell`).
- RQ04: Authors keep control. Their own `min-height`, unlayered as usual, overrides the base rule. All other base-layer behavior (theme variables, transparency, `select` appearance) stays unchanged.
- RQ05: `guide/widgets.md` Input section states that clicks land on cell centers. It says the extension keeps native controls at least one cell tall, and that custom click targets (canvas regions, styled divs, links) need at least one cell of height too. Keep the existing 24 px advice.
- RQ06: Correct the wrong Preferences note in `/Users/dgjalic/Documents/1-Projects/15-analysis/learn-radio/wiki/teachings/hackrf-portapack-radio/learner.md`. It currently blames redraw frequency and recommends the requestAnimationFrame pattern. The real cause is slider height versus cell-center click mapping, which the extension fix handles. Keep the learner's stated fact that sliders are fine in inline widgets. Leave that repository uncommitted.

## Out of scope

- Hit-target snapping or any change to input mapping in `src/component.ts` (rejected in planning, see PD01).
- Links, inline text, canvas regions, and custom elements. These are covered by guidance only.
- Horizontal size: default controls are wider than one CSS cell (about 8 to 9 px), so `min-width` is not added.
- Scaled display in narrow terminals (`box.scale < 1`). There the effective cell height in CSS px is `cell height / scale`, so a one-cell control can still miss. This is accepted as a known limitation and noted in the guide.
- Restoring sliders in the learn-radio `correlation` widget. Commits, pushes, and external writes.

## Design

- `src/page.ts`: change the signature to `baseCss(theme = {}, transparent = false, cssCell?: CellSize)`. When `cssCell` is given, add inside the layer: `input:not([type=hidden]), button, select { min-height: <Math.ceil(cssCell.height)>px; }`. In `setup`, call `baseCss(this.opts.theme, this.opts.transparent, this.opts.cssCell)`. Import `CellSize` from `./env.js` as a type only.
- `src/manager.ts`: give `openPage` the cell size (a new parameter, or derive it from `cssWidth / cols`, whichever is clearer). Pass `css` from `create` and `w.details.cssCell` from `revive`.
- No change to `component.ts`, `cellToCss`, or `check_widget`.

## Decision Log

| ID | Scope | Decision | Rationale | Evidence | Revisit when |
| --- | --- | --- | --- | --- | --- |
| PD01 | Fix approach | Use a base-layer CSS `min-height` of one cell for native controls. No hit-target snapping. | Deterministic, no extra CDP round trip per press, and a small diff. Snapping would also cover author-sized custom targets, but at higher complexity. | User choice in planning (2026-11-14). Probe results in Context. | Reports of unclickable custom or non-native targets. |
| PD02 | Coverage | Cover `input` (except hidden), `button`, and `select`. | Range (16 px), checkbox and radio (about 13 px) fail today. Buttons, selects, and text inputs can fail when the author shrinks them. | User choice in planning. | A control type shows layout breakage from the rule. |
| PD03 | Height value | Use `ceil(cssCell.height)`, taken from the widget's actual cell, not a constant. | Cell height varies by font and DPR (17 to 20 CSS px seen). Rounding up keeps the one-center guarantee for fractional heights. | `cssCellSize` in `src/env.ts`; session viewport 9x20, guide value 8x17. | Scaled display gets fixed. |

## Work breakdown

- [x] T01: Base CSS keeps native controls one cell tall
  - Depends on: none
  - Scope: RQ01 to RQ04, Design.
  - Expected areas: `src/page.ts`, `src/manager.ts`, `tests/page.test.ts`, `tests/page.browser.test.ts`.
  - Acceptance: AC01 to AC04.
  - Verification: `npm run typecheck`, `npm test`, `npm run test:browser`.
- [x] T02: Guide explains cell-center clicks
  - Depends on: T01
  - Scope: RQ05.
  - Expected areas: `guide/widgets.md`.
  - Acceptance: AC05.
  - Verification: re-read; existing guide tests in `npm test` still pass (check `tests/` for guide content assertions).
- [x] T03: Correct the learn-radio learner note
  - Depends on: none
  - Scope: RQ06. Replace only the first Preferences bullet.
  - Expected areas: `/Users/dgjalic/Documents/1-Projects/15-analysis/learn-radio/wiki/teachings/hackrf-portapack-radio/learner.md`.
  - Acceptance: AC06.
  - Verification: re-read the file; `git -C <learn-radio> diff --stat` shows only that file changed by this task.

## Acceptance criteria

- AC01: Unit test: `baseCss({}, false, { width: 9, height: 20 })` contains the min-height rule with `20px` inside `@layer pi-base`. A fractional height such as 18.5 gives `19px`. `baseCss({})` contains no min-height rule.
- AC02: Browser regression test: open a page with `cssCell` 9x20 and markup that reproduces the failing geometry (controls row whose range input would otherwise sit at y=13 to 29, for example the original correlation `.ctl` row). A press at the cell center that overlaps the slider, cell-center moves with the button held, and a release change the slider value. The test asserts that the slider's box covers at least one `(gy + 0.5) * 20` center. The same markup opened without `cssCell` keeps the 16 px slider, which documents the original failure.
- AC03: Browser test: a checkbox at an arbitrary vertical offset toggles on a cell-center click when `cssCell` is set.
- AC04: An author `min-height` on a control wins over the base rule (asserted in a browser test or via computed style).
- AC05: `guide/widgets.md` Input section contains the cell-center rule, the automatic one-cell minimum for native controls, the one-cell advice for custom targets, and the scaled-display caveat.
- AC06: learner.md no longer attributes the failure to redraw frequency. It states that the cause was slider height versus cell-center clicks, fixed in the extension, and that sliders remain fine.

## Verification plan

- `npm run typecheck`
- `npm test`
- `npm run test:browser`
- Optional manual check (not required at low assurance): show `/tmp/sa/corr/index.html` (original correlation widget), or a copy of it, through `show_widget` in Pi at 100x32 and drag a slider.

## Execution handoff

Use PI Agent in a fresh session with this prompt:

```text
Read spec/active/261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them/plan.md and its item.yaml completely.
Implement T01 to T03 while preserving Requirements, Out of scope, Decision Log, and Verification plan. Assurance is low.
Update Progress and the Decision Log when confirmed implementation discoveries change the approach.
Run the specified verification before reporting completion.
Stop and ask before dependencies, migrations, destructive operations, external writes, commits, pushes, or scope expansion.
```

## Progress

- [x] Planning complete and confirmed.
- [x] Implementation complete (T01 to T03), 2026-11-14.
- [x] Verification passed: typecheck, 196 unit, 42 browser tests; completion review PASS. See [verification.md](./verification.md).

## Proposed durable knowledge updates

- After implementation, add a short Input bullet to `wiki/terminal-graphics-tmux.md`, or link the research page from it: native controls get a one-cell `min-height` from the base layer, and custom targets do not.
