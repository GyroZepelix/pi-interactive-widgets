# Dream learnings: 261028-1700-interactive-html-widgets-for-pi

Work item: `261028-1700-interactive-html-widgets-for-pi`

> Historical snapshot: this ledger records what Dream retained at each Gamemaster checkpoint. Current source, plans, verification, outcomes, and current dynamic destinations remain authoritative.

<!-- dream-checkpoints:start -->

## Gamemaster checkpoint: 261028-1700-interactive-html-widgets-for-pi/01.01

Date: 2026-10-28
Dream log: [2026-10-28-1936-gamemaster-checkpoint-261028-1700-interactive-html-widgets-for-pi-01-01.md](../2026-10-28-1936-gamemaster-checkpoint-261028-1700-interactive-html-widgets-for-pi-01-01.md)
Outcome: episodic recall only

## Gamemaster checkpoint: 261028-1700-interactive-html-widgets-for-pi/01.02

Date: 2026-10-28
Dream log: [2026-10-28-2017-gamemaster-checkpoint-261028-1700-interactive-html-widgets-for-pi-01-02.md](../2026-10-28-2017-gamemaster-checkpoint-261028-1700-interactive-html-widgets-for-pi-01-02.md)
Outcome: episodic recall only

## Gamemaster checkpoint: 261028-1700-interactive-html-widgets-for-pi/02.03

Date: 2026-10-28
Dream log: [2026-10-28-2147-gamemaster-checkpoint-261028-1700-interactive-html-widgets-for-pi-02-03.md](../2026-10-28-2147-gamemaster-checkpoint-261028-1700-interactive-html-widgets-for-pi-02-03.md)
Outcome: episodic recall only

## Gamemaster checkpoint: 261028-1700-interactive-html-widgets-for-pi/02.02

Date: 2026-10-29
Dream log: [2026-10-29-1031-gamemaster-checkpoint-261028-1700-interactive-html-widgets-for-pi-02-02.md](../2026-10-29-1031-gamemaster-checkpoint-261028-1700-interactive-html-widgets-for-pi-02-02.md)
Outcome: retained learning

### Terminal graphics under tmux (new topic page)

- **Exact written text:**
  > # Terminal graphics under tmux
  >
  > Load this page when changing widget rendering (placeholder grid, kitty uploads, scaling, recovery) or the tmux-driven e2e, perf, and manual-check tooling.
  >
  > ## Placeholders and passthrough
  >
  > - **Never put a placeholder cell in the pane's last column** - under tmux 3.6b a Unicode placeholder written into the last column loses its row and column diacritics (tmux attaches them to the previous cell), so Ghostty cannot place it and every image row except the first shows a blank right edge. `maxGridCols(width)` in `src/component.ts` keeps the grid at `width - 1`; e2e grid-hit tests did not detect this, only a user visual check did. ([02.02 evidence](../spec/archive/261028-1700-interactive-html-widgets-for-pi/implementation/02-02-lifecycle-acceptance.md))
  > - **Image data sent while the pane's window is hidden is dropped** - tmux forwards kitty passthrough only for visible panes, so a widget drawn while the user is in another window stays blank until a re-send (a click on an unfocused widget, a resize, or `/widgets-refresh`); the extension does not detect window switches. Run e2e, perf, and visual checks in a visible pane of the attached client's current window. ([verification](../spec/archive/261028-1700-interactive-html-widgets-for-pi/verification.md))
  > - **Pi 1.4.0 enables only button-motion mouse tracking under tmux, Zellij, or screen** - hover never reaches the extension there, so do not build or test hover-dependent behavior under tmux and never toggle mouse modes to obtain it (RQ05, PD09). ([R001](../spec/archive/261028-1700-interactive-html-widgets-for-pi/refinements/R001.md))
  >
  > ## Test tooling
  >
  > - **Capture panes without trimming leading lines** - trimming `tmux capture-pane -p` output drops blank top rows and shifts every row index by one; use `tmuxLines()` from `scripts/perf/lib.ts` when computing click coordinates. Coarse grid-hit tests still pass with a one-row shift, so check the component-relative `y` when adding precise click tests. With `-e`, tmux emits a color only where it changes, so placeholder rows after the first may carry no color code (`locate` in `tests/e2e/lib.ts` handles this). ([02.02 evidence](../spec/archive/261028-1700-interactive-html-widgets-for-pi/implementation/02-02-lifecycle-acceptance.md))
- **Destination and classification:** `wiki/terminal-graphics-tmux.md` - `Topic-specific dynamic knowledge`
- **Session evidence or selection reason:** the AC12 user visual check found a blank right edge that the e2e grid-hit tests missed, traced to tmux dropping placeholder diacritics in the last column and fixed with `maxGridCols`; two AC12 retries failed because uploads sent while the window was hidden were dropped; a trimmed `capture-pane` shifted e2e click rows by one and cost a long misdiagnosis; the button-motion-only mouse tracking under multiplexers drove revision R001.
- **Expected future benefit:** prevents reintroducing the last-column defect when changing grid sizing, explains blank widgets after window switches, and keeps tmux-driven click tests and manual checks accurate.
- **Why this tier:** stable, repository-specific constraints that each changed an action in this item and recur whenever rendering or tmux tooling changes; together they form a coherent cluster narrower than a broad convention, so a focused topic page loaded only for that work fits better than episodic recall.

### Manual visual check setup (observation)

- **Exact written text:**
  > - **Give user visual checks a dedicated tmux window and pin the pane size** - May matter when asking the user to confirm widget rendering because their window size and pane layout change between question and answer, and temporary `sleep N` panes expire; create a new window with only test panes, set the width with `tmux resize-pane -x`, and confirm width and visibility from the dev log before relying on the answer. Provenance: [02.02 evidence](../spec/archive/261028-1700-interactive-html-widgets-for-pi/implementation/02-02-lifecycle-acceptance.md).
- **Destination and classification:** `wiki/observations.md` - `Observation`
- **Session evidence or selection reason:** several AC12 attempts were invalidated by the user's changing window size, an expired `sleep 600` pane, and a hidden window; a dedicated window with a pinned pane width produced a valid confirmation.
- **Expected future benefit:** fewer wasted user round trips when a later item needs visual confirmation.
- **Why this tier:** useful but procedural and observed in one session; recurrence and transfer to other items are not yet shown, so it stays in the reflection queue rather than dynamic guidance.
