# Outcome: Widget drag input and blank-image-after-click fix

Work item: `261112-2105-widget-drag-input-and-blank-image-after-click-fix`
Disposition: completed
Date: 2026-11-12

## Delivered scope

- RQ01 and RQ02 (T01): `WidgetPage.mouse` (`src/page.ts`) derives the CDP button of a `mouseMoved` without an explicit button from the held-buttons mask through `buttonFromMask` (left, then middle, then right; hovers stay `none`). Press, drag, and release now move range inputs, including past the grid while Pi holds the capture.
- RQ05 (T02): Pi devDependencies `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` bumped to 1.5.2 (PD03).
- RQ03 (T03): dev-log diagnostics (only with `PI_WIDGETS_DEV=1` and `PI_WIDGETS_DEV_LOG`, metadata only). `KittyImage` reports writes (`writeMs` included), row switches, and retire decisions through a hook. The manager adds the ids on Pi's last written screen, a `rows-written` check, and `press` events, and the `display` event now carries the render width. A user-assisted repro confirmed the cause (PD04): tmux 3.8 with `allow-passthrough on` drops passthrough while a pane or window redraw is pending, and large uploads keep that redraw pending.
- RQ04 (T04), per the user's decision B (PD05): the extension does not change tmux state. `passthroughNotice` (`src/env.ts`) reads the effective `allow-passthrough` of Pi's pane, and `src/index.ts` shows a one-time, non-blocking warning when it is `on`. README and `wiki/terminal-graphics-tmux.md` document `set -g allow-passthrough all`, the cause, and the side effect (`all` also forwards passthrough from hidden panes).
- RQ06: unit tests (`buttonFromMask`, `passthroughNotice`, `KittyImage` diagnostics), a browser range-drag test, an e2e drag test (`tests/fixtures/e2e-range.html`), and a repro fixture (`tests/fixtures/blank-repro.html`).

## Deviations from plan

- RQ04 is not fixed in code. The confirmed cause is in tmux, so the user chose documentation plus a read-only notice (PD05). AC02 is verified under `allow-passthrough all`, and the default `on` remains a documented user-config requirement.
- PD06: four e2e tests failed identically on an unmodified export of 757ef52. Causes: a hard-coded 16x34 px cell while the Ghostty client is now 17x37, and AC03a's widget scrolled out of view by Pi 1.5.2's delivered message. They were fixed in test code only, with assertions unchanged in strength.

## Verification summary

See `verification.md`. Typecheck pass; `npm test` 195 pass; `npm run test:browser` 38 pass; `npm run test:e2e` 32/32 pass under `all`. `npm run perf` passes (AC01 0.1% frozen CPU; AC02 34.65% against a 40% limit). `git diff --check` is clean. The browser drag test fails with the old default. User checks under `all`: the slider follows the pointer, there was no blank after 50+ rapid focused clicks on a static and an animated widget (confirmed in the dev log), no flashing on `visual.html`, and the frozen-widget click and `/widgets-refresh` restore images. The final contract-quality review passed after 1 re-review (one blocker fixed: wiki links to the active spec path).

## Retained, reverted, or transferred work

- Retained: all source, test, fixture, README, and wiki changes listed above, and the dev-log diagnostics, kept for future rendering work.
- Reverted: every pane-scoped `allow-passthrough` value used in testing; all test windows were killed. The user's own tmux configuration (`set -g allow-passthrough all`) was set by the user and was not changed by this item.

## Residual risks

- Users who keep `allow-passthrough on` can still see blank widget images after clicks. They get a one-time startup warning and the README fix.
- Which tmux write sets `PANE_REDRAW` in the repro was not isolated. A stale smaller second client was attached during T03, and it is unknown how often a single client triggers it.
- That `all` also delivers images drawn while the window is hidden comes from tmux source and was not tested by hand.
- No automated regression test for the blank image: it needs a real tmux client draining output to Ghostty.
- Perceived lag (user question): small widgets run at about 8.5 fps under the 10 fps cap, and 1.2-1.7 MB frames at about 6-7 fps, the same under `on` and `all`. Press to first new upload is about 70-110 ms median. This is the frame cap plus the cost of large frames, not a regression from this item.

## Follow-up work items

None recorded. No backlog entries were added.

## Source references

- tmux 3.8 `input.c`, `screen-write.c`, `tty.c`, `server-client.c`: https://raw.githubusercontent.com/tmux/tmux/3.8/
- Plan Decision Log PD01-PD06 and `verification.md` in this item.

## Wiki updates

- `wiki/terminal-graphics-tmux.md`: passthrough drop under `allow-passthrough on`, the `all` requirement and the no-write decision, and the CDP drag button rule. Links point to `spec/archive/261112-2105-widget-drag-input-and-blank-image-after-click-fix/`.
- `wiki/research/drag-input-and-tmux-output-discards.md`: follow-up note that `client_discarded` discards were not the blank-image cause.
- `wiki/index.md`, `wiki/log.md`: entries for the above.
- Stale-status sweep (`measure-wiki-quality.py --stale-status`): 0 hits.
