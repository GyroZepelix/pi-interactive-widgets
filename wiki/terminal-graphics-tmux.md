# Terminal graphics under tmux

Load this page when changing widget rendering (placeholder grid, kitty uploads, scaling, recovery) or the tmux-driven e2e, perf, and manual-check tooling.

## Placeholders and passthrough

- **Never put a placeholder cell in the pane's last column** - under tmux 3.6b a Unicode placeholder written into the last column loses its row and column diacritics (tmux attaches them to the previous cell), so Ghostty cannot place it and every image row except the first shows a blank right edge. `maxGridCols(width)` in `src/component.ts` keeps the grid at `width - 1`; e2e grid-hit tests did not detect this, only a user visual check did. ([02.02 evidence](../spec/archive/261028-1700-interactive-html-widgets-for-pi/implementation/02-02-lifecycle-acceptance.md))
- **Image data sent while the pane's window is hidden is dropped** - tmux forwards kitty passthrough only for visible panes, so a widget drawn while the user is in another window stays blank until a re-send (a click on an unfocused widget, a resize, or `/widgets-refresh`); the extension does not detect window switches. Run e2e, perf, and visual checks in a visible pane of the attached client's current window. ([verification](../spec/archive/261028-1700-interactive-html-widgets-for-pi/verification.md))
- **Pi 1.4.0 enables only button-motion mouse tracking under tmux, Zellij, or screen** - hover never reaches the extension there, so do not build or test hover-dependent behavior under tmux and never toggle mouse modes to obtain it (RQ05, PD09). ([R001](../spec/archive/261028-1700-interactive-html-widgets-for-pi/refinements/R001.md))

## Test tooling

- **Capture panes without trimming leading lines** - trimming `tmux capture-pane -p` output drops blank top rows and shifts every row index by one; use `tmuxLines()` from `scripts/perf/lib.ts` when computing click coordinates. Coarse grid-hit tests still pass with a one-row shift, so check the component-relative `y` when adding precise click tests. With `-e`, tmux emits a color only where it changes, so placeholder rows after the first may carry no color code (`locate` in `tests/e2e/lib.ts` handles this). ([02.02 evidence](../spec/archive/261028-1700-interactive-html-widgets-for-pi/implementation/02-02-lifecycle-acceptance.md))
