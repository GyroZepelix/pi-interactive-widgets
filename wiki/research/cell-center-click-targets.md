# Research: cell-center clicks miss controls shorter than one cell

Verified 2026-11-14 while diagnosing a learn-radio teaching session and planning `261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them`. Load when changing widget input mapping, base CSS, or widget authoring guidance.

## Finding

- `cellToCss` in `src/component.ts` maps a terminal cell to its center: `y = (gy + 0.5) * cssCell.height` at scale 1. With 20 px tall CSS cells, clicks land only at y = 10, 30, 50, ...
- A control whose box is shorter than one cell can sit entirely between two centers, and then no click or drag reaches it. Chromium defaults: range input 16 px tall, checkbox and radio about 13 px.
- Evidence (at commit `d24679a`): a throwaway probe used `WidgetPage` at 900x640 CSS px (100x32 cells of 9x20) on the original learn-radio `correlation` widget. Its range inputs spanned y=13 to 29. A cell-center press at y=10 hit the controls row `DIV`, and one at y=30 hit the `LABEL`, so the value never changed. The `antenna-resonance` widget's slider spanned y=17 to 33. A press at y=30 hit `INPUT#L` and a drag moved it.
- The difference came from layout only. Controls-row padding (5 vs 6 px) and wrapped buttons made the slider's line shorter in the failing widget. The cause was not the redraw strategy (requestAnimationFrame vs input events), which an earlier session guessed.
- A box at least one cell tall always covers exactly one center, because its half-open vertical interval spans one full cell. In a probe, a `min-height` set in `@layer pi-base` applied to range, checkbox, and text inputs even when unlayered author CSS set a smaller `height`, because `min-height` overrides `height`.
- Scaled display (`box.scale < 1`) widens the spacing between centers to `cssCell.height / scale` CSS px, so one cell of height is not enough there.

## Current behavior

- **Native controls get a one-cell height floor, custom targets do not** - with `cssCell` set, `baseCss` (`src/page.ts`) gives `input`, `button`, and `select` a layered `min-height` of one cell, rounded up; author `min-height` wins. Canvas, div, and link targets need their own. ([verification](../../spec/archive/261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them/verification.md))
