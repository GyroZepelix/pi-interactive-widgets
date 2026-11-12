# Observations

Tentative repository-local findings retained for later comparison. This page is used by Dream and memory maintenance, not normal task context.

## E2E and user-assisted checks

- **Derive e2e size expectations from the logged cell size** - May matter for e2e PNG or viewport size asserts: a Ghostty font change broke three tests that hard-coded 16x34 px; use the dev log's `cssCell`. Provenance: [verification](../spec/archive/261112-2105-widget-drag-input-and-blank-image-after-click-fix/verification.md).
- **Confirm user-assisted checks in the dev log** - May matter when a user reports clicks or commands: 50+ reported clicks matched 7 presses on the target, and a reported `/widgets-refresh` logged no `resend`. Provenance: [verification](../spec/archive/261112-2105-widget-drag-input-and-blank-image-after-click-fix/verification.md).
- **Classify e2e failures on a HEAD export** - May matter when e2e fails after a change: the failing tests run from a `git archive HEAD` export (with `node_modules` symlinked) show if they predate it. Provenance: [verification](../spec/archive/261112-2105-widget-drag-input-and-blank-image-after-click-fix/verification.md).

## Widget image diagnostics

- **Diagnose blank widget images with the dev log's kitty events** - May matter when an image goes blank: a delete of a shown id or a switch missing from `rows-written` points at the extension; a clean log points at tmux or the terminal. Provenance: [verification](../spec/archive/261112-2105-widget-drag-input-and-blank-image-after-click-fix/verification.md).
