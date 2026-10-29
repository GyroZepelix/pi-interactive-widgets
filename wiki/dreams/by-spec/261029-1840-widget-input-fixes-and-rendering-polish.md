# Dream learnings: 261029-1840-widget-input-fixes-and-rendering-polish

Work item: `261029-1840-widget-input-fixes-and-rendering-polish`

> Historical snapshot: this ledger records what Dream retained at each Gamemaster checkpoint. Current source, plans, verification, outcomes, and current dynamic destinations remain authoritative.

<!-- dream-checkpoints:start -->

## Gamemaster checkpoint: 261029-1840-widget-input-fixes-and-rendering-polish/direct

Date: 2026-10-29
Dream log: [2026-10-29-1954-gamemaster-checkpoint-261029-1840-widget-input-fixes-and-rendering-polish-direct.md](../2026-10-29-1954-gamemaster-checkpoint-261029-1840-widget-input-fixes-and-rendering-polish-direct.md)
Outcome: retained learning

### Double-buffered kitty frames and how to check flashing

- **Exact written text:**
  > - **Never upload a new frame to the image id the placeholder rows show** - Ghostty 1.4.0 deletes an image and its placements as soon as a new transmission to the same id begins (`loadAndAddImage` in its `src/terminal/kitty/graphics_exec.zig`), so the rows stay blank until the last chunk arrives; large frames (about 1 MB, hundreds of 4 KB chunks) flash badly, small ones (about 27 KB) rarely visibly. `KittyImage` in `src/kitty.ts` uploads each new frame to the spare of two ids and the rows switch to it; only scaled and recovery re-sends reuse the shown id, so rows already written (regular-mode scrollback) stay valid. Check flashing with a large, detailed fixture: a small rotating square did not reproduce it. ([verification](../spec/archive/261029-1840-widget-input-fixes-and-rendering-polish/verification.md))
- **Destination and classification:** `wiki/terminal-graphics-tmux.md` - `Topic-specific dynamic knowledge`
- **Session evidence or selection reason:** N1 flashing: Ghostty v1.4.0 `graphics_exec.zig` deletes an image when a same-id transmission begins; measured anim frames about 27 KB (7 chunks) vs node-ring frames about 1.1 MB (about 292 chunks); blind user A/B: old build did not visibly flash on the rotating square but "terribly flashes" on the node ring, new build never flashed.
- **Expected future benefit:** Future rendering changes keep uploads off the shown id and keep re-sends on it, and future visual checks use a large fixture instead of a small one that hides the defect.
- **Why this tier:** Stable external contract plus a costly failure (visible defect and an inconclusive check round); scoped to kitty transport, so it belongs on the existing terminal-graphics page, not a convention or observation.

### Pi fullscreen consumes mouse input before onTerminalInput

- **Exact written text:**
  > Load this page when changing widget rendering (placeholder grid, kitty uploads, scaling, recovery), widget mouse input, or the tmux-driven e2e, perf, and manual-check tooling.
  > ## Pi mouse input
  > - **In fullscreen, Pi consumes every mouse sequence before extension input handlers run** - pi-tui's `TuiAltScreen` registers its viewport listener first and returns `consume` for every wheel and SGR mouse sequence, so `ctx.ui.onTerminalInput` never sees mouse input (a probe saw 0 of 6 sequences). Raw mouse handling goes through `RawInputHook` in `src/rawinput.ts`, which keeps one listener at the front of pi-tui's private `inputListeners` Set behind a feature check and re-applies it after renderer changes; without the field the hook is skipped and click-outside release is unavailable. ([plan Decision log](../spec/archive/261029-1840-widget-input-fixes-and-rendering-polish/plan.md))
- **Destination and classification:** `wiki/terminal-graphics-tmux.md` - `Topic-specific dynamic knowledge`
- **Session evidence or selection reason:** Plan stop point (1): pi-tui source (TuiAltScreen registers its listener first; the TUI input loop stops at the first consume) and a runtime probe (0 of 6 SGR sequences reached `onTerminalInput`; a front-of-Set listener saw all 6). The user authorized the front-of-Set hook with fallback. The page scope line now names widget mouse input.
- **Expected future benefit:** Future mouse work goes straight to `RawInputHook` instead of re-discovering that the public API cannot see mouse sequences, and knows the fallback limitation.
- **Why this tier:** Stable runtime contract of Pi 1.4.0 with high rediscovery cost; topic-specific to widget input under Pi, which is adjacent to the page's existing mouse-tracking guidance, so a new section on the same page rather than a new page for two facts.

### Trackpad sideways scroll arrives as presses

- **Exact written text:**
  > - **pi-tui reports trackpad sideways scrolling as presses** - its `parseWheelEvent` accepts only vertical wheel directions, so SGR codes 66 and 67 (macOS trackpads send them during ordinary scrolling) reach components as a `press` with button `right` or `none`. Never treat those presses as clicks: the raw input hook consumes them, and without the hook `WidgetComponent` ignores them on unfocused widgets. ([plan](../spec/archive/261029-1840-widget-input-fixes-and-rendering-polish/plan.md))
- **Destination and classification:** `wiki/terminal-graphics-tmux.md` - `Topic-specific dynamic knowledge`
- **Session evidence or selection reason:** N2 root cause from pi-tui source (`parseWheelEvent` accepts only directions 0 and 1; `handleMouseEvent` classifies 66 and 67 as presses with button right or none) and the user's AC07a trackpad check passing after the fix.
- **Expected future benefit:** Prevents treating right or none presses as clicks in future component or input code, which caused widgets to grab focus while scrolling.
- **Why this tier:** Stable library behavior behind a user-visible defect; narrow to widget input, so topic page.

### e2e locate matches either buffer id

- **Exact written text:**
  > - **Capture panes without trimming leading lines** - trimming `tmux capture-pane -p` output drops blank top rows and shifts every row index by one; use `tmuxLines()` from `scripts/perf/lib.ts` when computing click coordinates. Coarse grid-hit tests still pass with a one-row shift, so check the component-relative `y` when adding precise click tests. With `-e`, tmux emits a color only where it changes, so placeholder rows after the first may carry no color code (`locate` in `tests/e2e/lib.ts` handles this). A widget's grid alternates between two image ids; `locate` matches either through the dev log's `spareId`, so pass the persisted `imageId`. ([02.02 evidence](../spec/archive/261028-1700-interactive-html-widgets-for-pi/implementation/02-02-lifecycle-acceptance.md))
- **Destination and classification:** `wiki/terminal-graphics-tmux.md` - `Topic-specific dynamic knowledge`
- **Session evidence or selection reason:** Double buffering made grids alternate colors between two ids; `tests/e2e/lib.ts` `locate` now resolves the partner id from the dev log's `spareId`, and e2e passed 27/27 with existing callers passing the persisted `imageId`.
- **Expected future benefit:** Authors of new e2e tests locate grids correctly without assuming one color per widget.
- **Why this tier:** Merged into the existing capture bullet as a condition of the same tool; too small for its own bullet and not tentative.

### Re-check the client's window before every harness run

- **Exact written text:**
  > - **Run the full e2e suite and user visual checks in a dedicated tmux window you create** - the harness (`openSplit` in `scripts/perf/lib.ts`) splits the pane named by `TMUX_PANE` only when it is in the attached client's current window, the pre-existing suites need an 80x24 split, and the user's pane layout may be too narrow or change between question and answer; do not lower the harness size requirements or resize the user's panes. Create a window with only a long-lived placeholder pane (`tmux new-window -d -n <name> 'sleep 7200'`; short `sleep N` panes expire), ask the user to switch to it, confirm `#{window_active}` and the client's `#{window_id}` (and for visual checks the pane width, pinned with `tmux resize-pane -x`, and visibility from the dev log) before running `TMUX_PANE=<new pane> npm run test:e2e` or relying on an answer, then kill only that window. Re-check the client's current window immediately before every harness run, because the user may leave it during long sessions; if it is not the dedicated window, stop and ask, since `openSplit` otherwise silently splits the user's current pane. ([02.02 evidence](../spec/archive/261028-1700-interactive-html-widgets-for-pi/implementation/02-02-lifecycle-acceptance.md), [verification](../spec/archive/261029-1116-widget-usage-guidance-and-check-widget/verification.md), [1840 verification](../spec/archive/261029-1840-widget-input-fixes-and-rendering-polish/verification.md))
- **Destination and classification:** `wiki/terminal-graphics-tmux.md` - `Topic-specific dynamic knowledge`
- **Session evidence or selection reason:** In this session the final e2e and perf runs started while the client had moved back to the user's window 4 (my pre-run check showed it, and I ran anyway); harness splits landed beside the user's pane for about 15 minutes. Gamemaster then required verifying the client's current window before any harness run and stopping to ask otherwise.
- **Expected future benefit:** Prevents harness runs from splitting and resizing the user's own panes when they leave the dedicated window during long sessions.
- **Why this tier:** Explicit rule from the orchestrator plus prevention of a user-impacting failure; refines the existing dedicated-window bullet instead of adding a paraphrase.
