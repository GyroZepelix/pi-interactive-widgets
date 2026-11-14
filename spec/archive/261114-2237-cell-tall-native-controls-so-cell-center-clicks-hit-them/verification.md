# Verification: Cell-tall native controls so cell-center clicks hit them

Work item: `261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them`
Date: 2026-11-14

## Environment

- macOS, Node v26.13.0, headless Chromium via `BrowserHost` (repo test setup).
- Mode: direct. Assurance: low (inherited from plan.md).
- Starting HEAD `d24679a`; planning artifacts were the only dirty paths before work.

## Commands and checks

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | Pass (exit 0) | tsc --noEmit clean |
| `npm test` | Pass, 196/196 | includes new AC01 `baseCss` test and guide tests in `tests/guidance.test.ts` |
| `npm run test:browser` | Pass, 42/42 | includes 4 new tests "cell-center clicks reach native controls (AC02-AC04)" in `tests/page.browser.test.ts` |
| learner.md re-read | Pass | only line 21 (first Preferences bullet) changed; line count unchanged (42) |

## Requirement coverage

| Requirement | Evidence | Status |
| --- | --- | --- |
| RQ01 | `src/page.ts` `baseCss(theme, transparent, cssCell?)` emits `input:not([type=hidden]), button, select { min-height: ceil(h)px; }` inside `@layer pi-base`; AC01 unit test (20 -> 20px, 18.5 -> 19px) | Met |
| RQ02 | `WidgetPageOptions.cssCell?: CellSize`; `setup` passes it; without it no rule (AC01 unit test, AC02 no-cell browser test) | Met |
| RQ03 | `src/manager.ts` `openPage(..., cssCell, target)`; `create` passes `css`, `revive` passes `w.details.cssCell` | Met |
| RQ04 | AC04 browser test: author `min-height: 40px` -> 40, author `min-height: 4px; height: 12px` -> 12; other base rules unchanged (existing tests pass) | Met |
| RQ05 | `guide/widgets.md` Input bullet: cell-center rule, automatic one-cell minimum for native controls, one-cell advice for custom targets, scaled-display caveat; 24 px advice kept | Met |
| RQ06 | learn-radio `learner.md` first Preferences bullet rewritten: cause is slider height vs cell-center clicks, fixed in extension, sliders fine; left uncommitted | Met |
| AC02 | Slider at top 13px, 900x640 page, 9x20 cells: without `cssCell` box 13..29 (16 px), covers no center, cell-center drags at y=10/30 leave value 0; with `cssCell` box 13..33, covers y=30, cell-center drag changes value | Met |
| AC03 | Checkbox at top 57px with `cssCell`: at least 20 px tall, covers a center, cell-center click checks it | Met |

## Review findings

- Completion review (independent flash-reviewer, read-only): PASS, no blocking or non-blocking findings. Retries: 0.

## Failures and skipped checks

- None failed. Optional manual Pi check with `/tmp/sa/corr/index.html` not run (not required at low assurance).

## Unverified areas

- learn-radio `wiki/teachings/` is untracked in its repo, so `git diff --stat` cannot show the change; verified by re-reading the file (only the target bullet differs from the starting text).
- Scaled display (`box.scale < 1`) remains a documented limitation (out of scope).
