# Dream learnings: 261029-1116-widget-usage-guidance-and-check-widget

Work item: `261029-1116-widget-usage-guidance-and-check-widget`

> Historical snapshot: this ledger records what Dream retained at each Gamemaster checkpoint. Current source, plans, verification, outcomes, and current dynamic destinations remain authoritative.

<!-- dream-checkpoints:start -->

## Gamemaster checkpoint: 261029-1116-widget-usage-guidance-and-check-widget/direct

Date: 2026-10-29
Dream log: [2026-10-29-1434-gamemaster-checkpoint-261029-1116-widget-usage-guidance-and-check-widget-direct.md](../2026-10-29-1434-gamemaster-checkpoint-261029-1116-widget-usage-guidance-and-check-widget-direct.md)
Outcome: retained learning

### Dedicated tmux window for full e2e and user visual checks

- **Exact written text:**
  > - **Run the full e2e suite and user visual checks in a dedicated tmux window you create** - the harness (`openSplit` in `scripts/perf/lib.ts`) splits the pane named by `TMUX_PANE` only when it is in the attached client's current window, the pre-existing suites need an 80x24 split, and the user's pane layout may be too narrow or change between question and answer; do not lower the harness size requirements or resize the user's panes. Create a window with only a long-lived placeholder pane (`tmux new-window -d -n <name> 'sleep 7200'`; short `sleep N` panes expire), ask the user to switch to it, confirm `#{window_active}` and the client's `#{window_id}` (and for visual checks the pane width, pinned with `tmux resize-pane -x`, and visibility from the dev log) before running `TMUX_PANE=<new pane> npm run test:e2e` or relying on an answer, then kill only that window. ([02.02 evidence](../spec/archive/261028-1700-interactive-html-widgets-for-pi/implementation/02-02-lifecycle-acceptance.md), [verification](../spec/archive/261029-1116-widget-usage-guidance-and-check-widget/verification.md))
- **Destination and classification:** `wiki/terminal-graphics-tmux.md` - `Topic-specific dynamic knowledge`
- **Session evidence or selection reason:** Promoted from the observation "Give user visual checks a dedicated tmux window and pin the pane size" (02.02). In this session the full `npm run test:e2e` failed to split from the agent's own 62x54 pane; the user chose a dedicated window, which passed 22/22 when run with `TMUX_PANE` set to its pane. Knowing the observation would have avoided the failed attempt and a question round-trip. The observation was removed from `wiki/observations.md`.
- **Expected future benefit:** Future e2e, perf, and visual-check runs go straight to a dedicated visible window without touching the user's panes or weakening the harness size requirements.
- **Why this tier:** Explicit user decision in two sessions plus a stable harness contract; scoped to tmux-driven test tooling, so it belongs on the existing tmux topic page rather than a broad convention, and it no longer needs the observation queue.
