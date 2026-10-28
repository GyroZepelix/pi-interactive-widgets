# Implementation: Interactive HTML widgets for Pi

Plan: `../plan.md`
Mode: sliced
Assurance: medium - personal single-user setup, reversible local extension, KISS preference (user override, D4)
Review tier: medium - scoped checks per slice; one focused review at each segment end; one final contract-quality review over the whole change
Current: `01.01`
Expected implementation sessions: 4
Implementation starting checkpoint: unrecorded

## Shared objective

Ship `pi-interactive-widgets`: the agent calls `show_widget` with `html` or `path`, and an interactive widget appears inline in the Pi transcript, rendered by headless Chromium and streamed as kitty graphics with Unicode placeholders. The user interacts in place in Pi fullscreen, data returns through `pi.send` and `pi.submit`, idle widgets cost about 0% CPU, and no frame or still is written to disk.

## Shared constraints and non-goals

- Frames and stills stay in RAM and the terminal stream; never write them to disk (RQ04).
- Never emulate DPR; launch with `--force-device-scale-factor` and size pages with `deviceScaleFactor: 0` (RQ03, plan Design).
- Never freeze with `Debugger.pause` or `Page.setWebLifecycleState`; use window minimize (RQ06).
- Never toggle mouse modes in Pi fullscreen and never embed kitty uploads in rendered lines (RQ05, plan Design).
- Use `q=2` on every kitty command; under tmux wrap commands in DCS passthrough.
- Performance first and KISS; the plan's Out of scope list applies to every slice.

## Shared decisions and invariants

- PD01: the dependency set (`puppeteer-core`; dev `typescript`, `tsx`, `@types/node`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`) is approved; anything else needs approval.
- PD03: the tool is `show_widget`; it is persisted in sessions, so do not rename it.
- PD06: at most one live widget per session.
- D14 and D15: one full-resolution PNG screencast per live widget, ack-paced to at most 10 fps; one lazily launched chrome-headless-shell per Pi session with `pipe: true` and without puppeteer's three anti-throttling flags.
- RQ10: widgets load from a synthetic per-widget `https` origin through CDP Fetch interception; the loopback-server fallback is pre-approved only if the U1 spike fails, and must be recorded in the plan's Decision Log.
- Tests that touch the terminal need a visible tmux pane; hidden windows drop passthrough.

## Common approval gates

- Stop and ask before dependencies beyond PD01, migrations, destructive operations, external writes, commits, pushes, production actions, or scope expansion.
- Do not install the package into `~/.pi/agent/settings.json` or publish it.
- Do not kill processes the slice did not start; the user's own Pi sessions may run their own Chromium.

## Common checks

- `npm run typecheck`
- `npm test`
- After any browser, harness, or e2e run: no chrome-headless-shell process started by the run remains.

## Segment and slice order

### T01: Rendering pipeline proven outside Pi

Depends on: none
Segment starting checkpoint: unrecorded
Segment acceptance: headless browser tests pass for serving, network policy, injection, the bridge activation rule, screencast pacing, freezing, and input; the standalone harness renders a live widget in a visible tmux pane in Ghostty 1.4.0 (visual check confirmed by the user), all 18 grid clicks and the 60-click burst land, a frozen widget costs at most 0.5% browser CPU, and one animating widget at 10 fps stays within about 40% of one core in total.
Segment gate: segment acceptance plus one focused segment review over 01.01 and 01.02.

- [ ] 01.01: Scaffold plus browser and page layer with the U1 and U2 spikes (packet: `./01-01-browser-page-layer.md`)

Boundary 01.01 -> 01.02: the U1 and U2 spike results can force a serving redesign (loopback-server fallback), and the transport harness must consume a verified page API (frames, input, freeze).

- [ ] 01.02: Kitty transport, environment detection, and standalone harness (packet: `./01-02-kitty-transport-harness.md`)

Boundary T01 -> T02: Pi integration must not start until the pipeline passes outside Pi; a failure here changes the architecture (Electron off-screen fallback in `../research/independent-architecture-review.md`).

### T02: Pi extension

Depends on: T01
Segment starting checkpoint: unrecorded
Segment acceptance: AC01-AC16 in `../plan.md`.
Segment gate: whole-plan acceptance plus one focused final-segment review and one final contract-quality review.

- [ ] 02.01: Pi integration core (packet: `./02-01-pi-integration.md`)

Boundary 02.01 -> 02.02: lifecycle policy, revive, scaling, and recovery act on the integrated component, and their e2e and CPU/disk acceptance runs are slow and need a working integration to debug against. Comparable PoC work needed one very long session (raw handoff provenance), so a single session would leave no headroom for defects those runs reveal.

- [ ] 02.02: Lifecycle, recovery, and whole-plan acceptance (packet: `./02-02-lifecycle-acceptance.md`)

## Discoveries and blockers

None recorded.
