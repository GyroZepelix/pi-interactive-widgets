# Outcome: Cell-tall native controls so cell-center clicks hit them

Work item: `261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them`
Disposition: completed
Date: 2026-11-14

## Delivered scope

- `src/page.ts`: `WidgetPageOptions.cssCell?` and `baseCss(theme, transparent, cssCell?)`. With a CSS cell, the `@layer pi-base` stylesheet gives `input:not([type=hidden])`, `button`, and `select` a `min-height` of `ceil(cell height)` px, so every native control covers at least one cell center. Without it, no rule is emitted.
- `src/manager.ts`: `openPage` takes the CSS cell size; `create` passes the computed `css`, `revive` passes `details.cssCell`.
- Tests: AC01 unit test in `tests/page.test.ts`; AC02 to AC04 browser tests in `tests/page.browser.test.ts` (failing geometry reproduced without `cssCell`, fixed with it; checkbox toggle; author `min-height` wins).
- `guide/widgets.md` Input section: cell-center rule, automatic one-cell minimum, one-cell advice for custom targets, scaled-display caveat; 24 px advice kept.
- learn-radio `wiki/teachings/hackrf-portapack-radio/learner.md`: first Preferences bullet corrected (cause is slider height vs cell-center clicks, fixed in the extension). Left uncommitted in that repository.

## Deviations from plan

- None. AC02 reproduces the failing geometry with an absolutely positioned slider at `top: 13px` (16 px tall, y=13 to 29) rather than the full correlation `.ctl` row, so the geometry does not depend on font metrics.

## Verification summary

- `npm run typecheck` clean; `npm test` 196/196; `npm run test:browser` 42/42. Independent completion review: PASS, 0 retries. Details in [verification.md](./verification.md).

## Retained, reverted, or transferred work

- All changes retained, uncommitted. The learn-radio edit stays uncommitted in its own repository.

## Residual risks

- Scaled display (`box.scale < 1`): centers are farther apart than one cell, so a one-cell control can still miss. Accepted as out of scope and noted in the guide.
- Custom targets (canvas regions, styled divs, links) are covered by guidance only.

## Follow-up work items

- None created. The plan's proposed durable knowledge update (a short Input note in `wiki/terminal-graphics-tmux.md` or a link to the research page) is left for Dream.

## Source references

- [plan.md](./plan.md), [verification.md](./verification.md)
- [Research: cell-center click targets](../../../wiki/research/cell-center-click-targets.md)

## Wiki updates

- None. The stale-status sweep (`measure-wiki-quality.py --stale-status`) reported 0 hits.
