# Dream learnings: 261029-2034-show-image-tool

Work item: `261029-2034-show-image-tool`

> Historical snapshot: this ledger records what Dream retained at each Gamemaster checkpoint. Current source, plans, verification, outcomes, and current dynamic destinations remain authoritative.

<!-- dream-checkpoints:start -->

## Gamemaster checkpoint: 261029-2034-show-image-tool/direct

Date: 2026-10-29
Dream log: [2026-10-29-2146-gamemaster-checkpoint-261029-2034-show-image-tool-direct.md](../2026-10-29-2146-gamemaster-checkpoint-261029-2034-show-image-tool-direct.md)
Outcome: retained learning

### Image payloads and Pi's tmux image gap

- **Exact written text:**
  > Load this page when changing widget or `show_image` rendering (placeholder grid, kitty uploads, scaling, recovery), widget mouse input, or the tmux-driven e2e, perf, and manual-check tooling.
  > ## Image payloads
  > - **Send every image as a PNG with `t=d`; the terminal cannot take URLs or JPEG** - the kitty graphics protocol has no URL transmission medium, and Ghostty 1.4.0 accepts only PNG (`f=100`) or raw RGB/RGBA payloads, not JPEG, WebP, GIF, or SVG. Pi 1.4.0 also disables its own image output whenever `TMUX` is set (`pi-tui/dist/terminal-image.js` returns `images: null`). `show_image` therefore fetches in Node and sends PNG like widget frames: PNG stays in Node (`src/png.ts`), other formats are rasterized by the session's headless browser in a short-lived page that has no network access and does not count toward `MAX_PAGES` (`src/image.ts`). ([show-image plan](../spec/archive/261029-2034-show-image-tool/plan.md))
- **Destination and classification:** `wiki/terminal-graphics-tmux.md` - `Topic-specific dynamic knowledge`
- **Session evidence or selection reason:** Plan research (kitty graphics protocol and Ghostty `graphics_image.zig`/`graphics_command.zig` sources) plus pi-tui 1.4.0 source (`terminal-image.js` returns `images: null` under `TMUX`), and the implementation that follows from it: `src/image.ts` decodes non-PNG formats in a no-network browser page outside `MAX_PAGES`, verified by AC03 browser tests and the user's AC06 check.
- **Expected future benefit:** Future image or rendering work does not try to pass URLs or JPEG bytes to the terminal or rely on Pi's own image output under tmux, and knows where decoding lives and why it does not count as a widget page.
- **Why this tier:** Stable external contracts with high rediscovery cost, scoped to kitty transport, so a short section on the existing terminal-graphics page (scope line extended to `show_image`) rather than a new page or a convention.

### locate sees only the visible pane

- **Exact written text:**
  > - **Capture panes without trimming leading lines** - trimming `tmux capture-pane -p` output drops blank top rows and shifts every row index by one; use `tmuxLines()` from `scripts/perf/lib.ts` when computing click coordinates. Coarse grid-hit tests still pass with a one-row shift, so check the component-relative `y` when adding precise click tests. With `-e`, tmux emits a color only where it changes, so placeholder rows after the first may carry no color code (`locate` in `tests/e2e/lib.ts` handles this). A widget's grid alternates between two image ids; `locate` matches either through the dev log's `spareId`, so pass the persisted `imageId`. `locate` sees only the visible pane: content added after a widget (for example `show_image` rows or tool output) can scroll its grid out of view, so draw or open the widget a test must click last (the perf disk phase opens a second widget after its `show_image` calls). ([02.02 evidence](../spec/archive/261028-1700-interactive-html-widgets-for-pi/implementation/02-02-lifecycle-acceptance.md), [show-image verification](../spec/archive/261029-2034-show-image-tool/verification.md))
- **Destination and classification:** `wiki/terminal-graphics-tmux.md` - `Topic-specific dynamic knowledge`
- **Session evidence or selection reason:** The first `npm run perf -- disk` run failed because three `show_image` rows scrolled the AC04 widget out of view and `waitLocate` timed out; opening a second widget after the image calls fixed it and the rerun passed.
- **Expected future benefit:** Authors of e2e and perf phases that add transcript content after a widget avoid a timed-out run by drawing the clicked widget last.
- **Why this tier:** A stable limit of the `capture-pane` based tooling, merged as a condition into the existing `locate` bullet instead of a separate observation or new bullet.
