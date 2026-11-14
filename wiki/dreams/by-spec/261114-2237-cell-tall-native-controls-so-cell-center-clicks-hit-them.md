# Dream learnings: 261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them

Work item: `261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them`

> Historical snapshot: this ledger records what Dream retained at each Gamemaster checkpoint. Current source, plans, verification, outcomes, and current dynamic destinations remain authoritative.

<!-- dream-checkpoints:start -->

## Gamemaster checkpoint: 261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them/direct

Date: 2026-11-14
Dream log: [2026-11-14-2251-gamemaster-checkpoint-261114-2237-cell-tall-native-controls-so-cell-center-click.md](../2026-11-14-2251-gamemaster-checkpoint-261114-2237-cell-tall-native-controls-so-cell-center-click.md)
Outcome: retained learning

### Shipped one-cell height floor for native controls

- **Exact written text:**

````markdown
- **Native controls get a one-cell height floor, custom targets do not** - with `cssCell` set, `baseCss` (`src/page.ts`) gives `input`, `button`, and `select` a layered `min-height` of one cell, rounded up; author `min-height` wins. Canvas, div, and link targets need their own. ([verification](../../spec/archive/261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them/verification.md))
````

- **Destination and classification:** `wiki/research/cell-center-click-targets.md` - `Topic-specific dynamic knowledge` - `ADD`
- **Closest existing guidance:** `wiki/research/cell-center-click-targets.md:10` "In a probe, a `min-height` set in `@layer pi-base` applied to range, checkbox, and text inputs" - the probe showed the fix direction; the new bullet records the shipped contract: its `cssCell` condition, covered elements, author override, and that custom targets get no floor
- **Admission basis:** observed stable contract
- **Session evidence or selection reason:** Implemented in `src/page.ts` and `src/manager.ts` and proven by browser tests in this session: without `cssCell` a 16 px slider at y=13 to 29 missed every cell center; with it the slider was 20 px tall, covered y=30, and a cell-center drag moved it; an author `min-height: 40px` won over the base rule.
- **Expected future benefit:** Agents changing input mapping, base CSS, or widget guidance know native controls are already covered and that custom targets and pages opened without `cssCell` are not, so they neither duplicate the fix nor assume it covers canvas regions.
- **Why this tier:** Stable source contract limited to widget input and base CSS; the research page is the indexed home for this topic, and `wiki/terminal-graphics-tmux.md` is over its word limit.
- **Review status:** review pending
