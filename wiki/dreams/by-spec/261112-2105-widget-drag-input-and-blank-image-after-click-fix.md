# Dream learnings: 261112-2105-widget-drag-input-and-blank-image-after-click-fix

Work item: `261112-2105-widget-drag-input-and-blank-image-after-click-fix`

> Historical snapshot: this ledger records what Dream retained at each Gamemaster checkpoint. Current source, plans, verification, outcomes, and current dynamic destinations remain authoritative.

<!-- dream-checkpoints:start -->

## Gamemaster checkpoint: 261112-2105-widget-drag-input-and-blank-image-after-click-fix/direct

Date: 2026-11-12
Dream log: [2026-11-12-2319-gamemaster-checkpoint-261112-2105-widget-drag-input-and-blank-image-after-click-.md](../2026-11-12-2319-gamemaster-checkpoint-261112-2105-widget-drag-input-and-blank-image-after-click-.md)
Outcome: retained learning

### Derive e2e size expectations from the logged cell size

- **Exact written text:**

````markdown
- **Derive e2e size expectations from the logged cell size** - May matter for e2e PNG or viewport size asserts: a Ghostty font change broke three tests that hard-coded 16x34 px; use the dev log's `cssCell`. Provenance: [verification](../spec/archive/261112-2105-widget-drag-input-and-blank-image-after-click-fix/verification.md).
````

- **Destination and classification:** `wiki/observations.md` - `Observation` - `ADD`
- **Closest existing guidance:** `wiki/terminal-graphics-tmux.md:26` "Capture panes without trimming leading lines" - covers row indexing of captures, not pixel or viewport size expectations that depend on the cell size
- **Admission basis:** observed failure prevention
- **Session evidence or selection reason:** Three e2e tests (guidance AC03, AC04, widgets RQ01) failed because they hard-coded a 16x34 px cell while the Ghostty client reported 17x37; the same failures reproduced on an unmodified HEAD export, and deriving expectations from the logged cell fixed them.
- **Expected future benefit:** Future e2e authors avoid size assertions that break whenever the user's terminal font changes.
- **Why this tier:** Observed once and scoped to test authoring; the destination topic page is over its word limit, so it waits in the observation queue.

### Confirm user-assisted checks in the dev log

- **Exact written text:**

````markdown
- **Confirm user-assisted checks in the dev log** - May matter when a user reports clicks or commands: 50+ reported clicks matched 7 presses on the target, and a reported `/widgets-refresh` logged no `resend`. Provenance: [verification](../spec/archive/261112-2105-widget-drag-input-and-blank-image-after-click-fix/verification.md).
````

- **Destination and classification:** `wiki/observations.md` - `Observation` - `ADD`
- **Closest existing guidance:** `wiki/terminal-graphics-tmux.md:27` "and visibility from the dev log) before running `TMUX_PANE=<new pane> npm run test:e2e` or relying on an answer" - covers window and visibility checks, not whether the reported actions reached the intended widget
- **Admission basis:** observed failure prevention
- **Session evidence or selection reason:** A round-2 user report of 50+ clicks on the animated widget and a /widgets-refresh run matched only 7 presses on that widget and no resend event; the repeated check matched the log (75 presses, one resend).
- **Expected future benefit:** Prevents recording manual acceptance evidence that never happened.
- **Why this tier:** Single occurrence with plausible recurrence in user-assisted checks; the destination page is over its word limit.

### Classify e2e failures on a HEAD export

- **Exact written text:**

````markdown
- **Classify e2e failures on a HEAD export** - May matter when e2e fails after a change: the failing tests run from a `git archive HEAD` export (with `node_modules` symlinked) show if they predate it. Provenance: [verification](../spec/archive/261112-2105-widget-drag-input-and-blank-image-after-click-fix/verification.md).
````

- **Destination and classification:** `wiki/observations.md` - `Observation` - `ADD`
- **Closest existing guidance:** none found - searched the test tooling bullets and observations for ways to tell pre-existing failures from regressions; none cover it
- **Admission basis:** observed failure prevention
- **Session evidence or selection reason:** Four e2e failures after the change were shown to predate it by running the same tests from a git archive export of the starting commit with node_modules symlinked, without git worktree or stash.
- **Expected future benefit:** Lets future agents classify e2e failures quickly and safely before deciding whether a fix is in scope.
- **Why this tier:** Useful procedure seen once; recurrence and generality are unproven, so it stays tentative.

### Diagnose blank widget images with the dev log's kitty events

- **Exact written text:**

````markdown
- **Diagnose blank widget images with the dev log's kitty events** - May matter when an image goes blank: a delete of a shown id or a switch missing from `rows-written` points at the extension; a clean log points at tmux or the terminal. Provenance: [verification](../spec/archive/261112-2105-widget-drag-input-and-blank-image-after-click-fix/verification.md).
````

- **Destination and classification:** `wiki/observations.md` - `Observation` - `ADD`
- **Closest existing guidance:** `wiki/terminal-graphics-tmux.md:9` "The dev log showed correct `KittyImage` bookkeeping" - records the cause found, not which dev-log events separate extension faults from transport loss
- **Admission basis:** observed stable contract
- **Session evidence or selection reason:** src/kitty.ts and src/manager.ts now emit kitty, rows, rows-written, and retire events with the ids on Pi's last written screen; in the repro a clean log plus a blank image correctly pointed at tmux.
- **Expected future benefit:** Shortens the next blank-image diagnosis by checking the log for extension faults before investigating tmux or Ghostty.
- **Why this tier:** The event contract is stable in source, but the diagnostic value has been shown once, so it stays an observation rather than growing the over-limit topic page.
