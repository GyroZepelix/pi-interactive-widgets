# Discovery: Interactive HTML widgets for Pi

Work item: `261028-1700-interactive-html-widgets-for-pi`
Status: Ready for To Spec
Created: 2026-10-28
Updated: 2026-10-28

Assurance: medium - user override of the agent's `high` recommendation (D4). Reasons: personal-first single-user environment (D2); reversible local extension with no production, migration, or data blast radius; explicit KISS preference. Performance is still verified by measurement (D12).

## Objective

Build a Pi extension that lets the agent create interactive HTML/CSS/JS widgets rendered inline in the Pi transcript with real browser fidelity, so the agent can explain things visually (charts, simulations, diagrams, small UIs, forms) and the user can click, hover, type, and scroll inside them without leaving the terminal. Data can flow from a widget back to the agent.

## Desired outcome

- Agent-facing tool(s) create widgets. Widgets appear inline, left aligned, and are clickable in place in Pi fullscreen mode.
- Regular TUI mode shows a static still plus a hint to switch to fullscreen.
- Resumed sessions show a placeholder; a click revives the widget from its persisted source (JS state resets).
- Lean KISS architecture: near-zero idle CPU, bounded active CPU, low memory across 3-5 parallel Pi sessions, no continuous disk writes.

## Repository and domain context

- This repo holds only `/spec` and `/wiki` scaffolding (commit `bc096ee`). No extension source exists yet.
- Raw input: `wiki/raw/2026-10-27-poc-handoff.md` (untrusted raw source; research and PoC session of 2026-10-27).
- PoC: `../pi-html-widget/index.ts` (939 lines, `puppeteer-core` ^25.16.0). Reference and feasibility evidence only (D3).
- Fact (checked 2026-10-28): macOS arm64 (18 cores), Ghostty 1.4.0 (app bundle and tmux client env; tmux's global env still says 1.3.1, which is stale), tmux 3.6b (`TERM=tmux-256color`, `allow-passthrough on`, cell 16x34 device px), Pi 1.4.0 (`@earendil-works/pi-coding-agent`, `pi-tui`) running on Node, `~/.pi/agent/settings.json` has `"tuiMode": "fullscreen"`, `PI_IMAGE_PROTOCOL` unset, `pi-inline-viz` installed. Chromium: chrome-headless-shell 156 and Chrome for Testing 156 under `~/.cache/puppeteer/`.
- User decision: typical load is 3-5 Pi sessions in parallel, each possibly with live widgets (D9).

## Scope

- v1 extension in this repo: agent tool interface (O4), rendering, capture, and terminal transport (O1), inline transcript component, fullscreen input forwarding (mouse, keys, wheel, focus and release), widget-to-agent data bridge, run-time and freeze policy (O3), process model (O2), regular-mode still plus hint, revive on click after resume, graceful degrade outside the verified environment.

## Out of scope

- General-purpose terminal browser (tabs, URL bar, navigation chrome).
- Native OS pickers (color, date, time) inside widgets.
- Pixel-precise mouse input inside tmux.
- Interactive regular-mode overlay (D6).
- Verified support for environments other than Ghostty + tmux on macOS (D2).
- Persisting widget JS state across resume in v1 (D7; possible later).
- Writing frames or stills to disk (D8, D11).
- GPU rendering flags (handoff 6.6 measured no benefit).
- A browser shared across Pi sessions (D15); background animation of unused widgets (D16).
- Deferred optimizations: shared-memory transport (`t=s`), kitty partial updates (`a=f`), raw+zlib frames, single-APC payloads (D14).
- File watching or live reload, separate CSS/JS tool fields, and context trimming of inline HTML in v1 (D19).
- Agent-requested network access with approval dialogs (D21).
- Preserving JS state when a widget is closed by the page cap or idle timeout (D18).

## Confirmed facts and evidence

Labels: `Fact` = checked during this discovery (source, docs, or measurement). `Observed` = measured on few samples with noise from other agents; CPU is percent of one core and relative. `Handoff` = reported in the raw handoff, not re-checked. Research files are indexed in [research/index.md](./research/index.md).

### Pi 1.4.0 integration ([pi-integration-seams.md](./research/pi-integration-seams.md))

- Fact: `tui.mode` is public (`"fullscreen" | "regular"`) and can change mid-session through `/settings`. The TUI instance is available only through `ctx.ui` factory callbacks (`setWidget`, `custom`, `setFooter`, `setHeader`, `setEditorComponent`); `setFocus`, `getFocusedComponent`, and `requestRender` are public on it.
- Fact: every transcript component renders on each layout pass. There is no public visibility signal; only the private `currentLayout` box tree knows what is on screen (re-verified, `pi-tui/dist/layout.js`).
- Fact: Pi emits Kitty deletes only when its image protocol is `kitty`, which is off under tmux by default (re-verified, `tui-alt-screen.js` L244-L245, L1494-L1504). Outside tmux, Pi's full redraws delete all images or placements. Pi does no tmux passthrough wrapping; `tui.terminal.write` is an unsynchronized `process.stdout.write`.
- Fact: under tmux Pi never queries the cell size and `getCellDimensions()` returns a 9x18 default, so the extension must measure cells itself.
- Fact: `handleMouse` receives component-local cells with `press|release|move|drag|click|wheel`, returns `{handled, capture, focus, render}`; `renderShell: "self"` rows forward with `y - 1`. Escape and Ctrl+C reach a focused component; `tui.altScreen.*` scroll and search keys are intercepted first.
- Fact: on resume `renderResult` runs eagerly for every tool row with stored `details`; `session_start.reason` is `startup | reload | new | resume | fork`.
- Fact: `pi.sendMessage` `nextTurn` queues for the next user turn; `followUp` runs after the current turn; `steer` injects into the running turn; `triggerTurn` starts a turn when idle.
- Fact: `pi.on("context")` can rewrite what the model sees without changing stored history; no size limit applies to persisted tool args or `details`.

### Rendering and capture ([capture-and-lifecycle-benchmarks.md](./research/capture-and-lifecycle-benchmarks.md))

- Fact: `HeadlessExperimental.beginFrame` / begin-frame control is unsupported on macOS in chrome-headless-shell 156 (measured; also stated in CDP docs and the independent review).
- Fact: DPR emulation (`setViewport` with scale 2) causes both PoC problems: half-size screencast frames and mis-scaled input during screenshots (5/60 correct). The launch flag `--force-device-scale-factor=2` with per-page `setDeviceMetricsOverride(deviceScaleFactor: 0)` gives full-resolution frames and correct input (60/60 under concurrent screenshots).
- Fact: screencast emits no frames for an unchanged page, about 12 ms input-to-frame latency, and no self-trigger loop; pacing works by delaying acks; `everyNthFrame` does not reduce CPU.
- Observed: one continuously animating widget at 10 fps costs Chromium 21-26% (the page alone about 13%), Ghostty about 8%, tmux about 1-2 points, Pi-side writer about 1%. Timed screenshots are about 4-5 points cheaper than screencast only for continuous animation. Static widgets cost about 0%.
- Observed: raw+zlib frames are 23% smaller for animation but cost about 16% CPU in Pi's process, and larger for static UI.
- Fact: minimizing a widget's window, in a browser launched without puppeteer's three anti-throttling flags, drops the page to 0-0.5% CPU (rAF stops, timers about 1 Hz); thaw takes about 13 ms; input, evaluate, and screenshots keep working; freezing is per window. `Debugger.pause` leaves 2-4% (CSS animations) and blocks evaluate.
- Fact: warm launch about 60 ms (about 120 ms to first frame; cold start unverified); browser baseline footprint about 48-62 MB; each page adds about 28-42 MB; warm revive about 45-75 ms.
- Fact: with `pipe: true` the browser exits when its owner is killed; over WebSocket it survives as an orphan. A shared browser leaks pages unless each client uses a `disposeOnDetach` context.

### Terminal ([capture-and-lifecycle-benchmarks.md](./research/capture-and-lifecycle-benchmarks.md), [independent-architecture-review.md](./research/independent-architecture-review.md))

- Fact: Ghostty 1.4.0 accepts PNG, RGB, RGBA, zlib, `t=d`, `t=s` (POSIX shm), and kitty animation frames including in-place edits (`a=f,r=1`); untested with placeholders through tmux. Images are stored as RGBA (about 3.5 MB per 1440x612 widget) under a 320 MB limit with oldest-first eviction.
- Fact: tmux 3.6b forwards passthrough only from visible panes and caps one DCS sequence at its 1 MB input buffer.
- Fact (independent review): CEF and Electron off-screen rendering expose dirty rectangles but need native helpers; WKWebView, Ultralight, Servo, Blitz, Ladybird, Qt WebEngine, and WPE fail on fidelity, input, maturity, or macOS support.

### Interface precedents ([interface-precedents.md](./research/interface-precedents.md))

- Fact: MCP Apps, OpenAI Apps SDK, Claude artifacts, and Claude inline visuals all ship one self-contained HTML document per widget; each call renders a new instance; state survives reopen only through explicit state APIs; return channels separate a passive "next turn" path from an active "start a turn" path; networks default to allowlists.
- Fact: `file://` breaks ES modules, `fetch`, and workers; CDP Fetch interception on a synthetic origin can serve inline and path widgets with one central CSP (needs a spike).
- Fact: macOS clears `$TMPDIR` at boot and after about 3 days unused, so temp paths cannot be a revive source.

### Handoff claims still relied on

- Handoff: kitty Unicode placeholders plus tmux DCS passthrough work in this setup; image data is lost on Ghostty restart or reattach; image ids are terminal-global.
- Handoff: native `<select>` needs `appearance: base-select`; native date and color pickers cannot render.

### Superseded handoff claims

- "Ghostty 1.3.1": the running terminal is 1.4.0.
- "Screencast ignores deviceScaleFactor" and "serialize all page I/O to avoid mis-scaled input": both caused by DPR emulation; fixed by the launch flag.
- "Debugger pause is the working freeze": window minimize is cheaper and keeps evaluate working.
- "Launch about 3 s cold": warm launch measured at about 60 ms; cold start unverified.

## Constraints and invariants

- No continuous disk writes: frames and stills stay in RAM or the terminal stream (D8, D11). Writing widget source files once per agent edit is acceptable (D19).
- Performance and KISS govern design choices (D12).
- Must not break Pi's own mouse handling, focus, keybindings, or rendering.
- Image ids must not collide with images from other Pi sessions in the same terminal.
- Release all resources on session shutdown; no orphan browser processes; temp state is per session or per process (handoff lesson 14).
- Keep reliance on private Pi internals minimal and fail safe when they change.
- Medium assurance: verify credible risks by measurement and tests, not exhaustive hardening.

## Domain language

- Widget: one agent-created interactive page shown inline in the transcript.
- Live, frozen, closed: page running and streaming frames; page kept in memory with its window minimized (no rendering); page released so only a placeholder or RAM still remains.
- Still: the last rendered frame of a widget, kept in RAM only.
- Revive: re-create a closed widget's page from its persisted source on user click; state resets.
- Inline mode, path mode: widget source passed in the tool call (`html`) versus read from an entry file on disk (`path`) (D19).
- Active widget: the single widget per session that is hovered or focused and streams frames (D16, D17).
- Open network mode: the config switch that lifts the default allowlist; local network stays blocked (D21, D27).

## Decision tree

```text
Settled roots: D2 envelope, D4 assurance, D12 performance + KISS
|-- O1 capture + transport        D14
|-- O2 process model              D15
|-- O3 run-time policy            D16, D17, D18
|-- O4 agent interface            D19, D20, D22
|   |-- O5 revive source          D23
|   `-- O6b path file scope       D24
|-- O6a network policy            D21, with O6c local network D27
|-- O7 Pi integration seams       facts; planning detail
`-- O8 narrow terminal D25, O9 image recovery D26
```

## Confirmed decisions

| ID | Decision | Rationale | Evidence | Revisit when |
| --- | --- | --- | --- | --- |
| D1 | One feature work-item, "Interactive HTML widgets for Pi", built in this repo. | User choice. | Round 1 Q1, 2026-10-28 | Scope splits into separately shippable parts. |
| D2 | Personal-first: Ghostty + tmux on macOS is the only verified target; elsewhere best-effort with graceful degrade or a clear unsupported notice. | Keeps the test matrix small. | Round 1 Q2 | Publishing for other users is requested. |
| D3 | Fresh modular build here. The PoC is reference and feasibility evidence only; its code is not treated as proven, and any reused technique is re-validated. | User is unsure of PoC code quality. | Round 1 Q3 + user note | - |
| D4 | Assurance medium (user override of `high` recommendation). | Personal, reversible, KISS. | Round 1 Q4 | Publishing, or a credible security issue appears. |
| D5 | Settle capture, interface, run-time, and process-model unknowns during discovery through desk research and scratch benchmarks outside the repo, with results under `research/`. Multiple subagents allowed, including a GPT-5.6 Sol Pi agent as an extra source. | Choose the design from data. | Round 1 Q5 + user note | - |
| D6 | Regular TUI mode shows a static still plus a hint to switch to fullscreen; no interactive overlay in v1. | The overlay needs DSR calibration and private TUI fields (handoff 5.5). | Round 1 Q6 | - |
| D7 | Resumed sessions show a placeholder; a click revives the widget from its persisted source; JS state resets (state saving deferred). | Interactive history without persisting state. | Round 1 Q7 | State persistence is requested. |
| D8 | Stills live in RAM only. No image files; after a Pi restart, widgets show a text placeholder until revived. | SSD wear, KISS. | Round 1 Q8 | Revive latency proves unacceptable. |
| D9 | Envelope: 3-5 Pi sessions in parallel, each possibly with live widgets. | Shapes process-model research (O2). | Round 1 Q9 | - |
| D10 | Pi fullscreen is the primary target; widgets are clickable in place; inline widgets are left aligned. | Recorded in handoff 1.2-1.3 and reaffirmed. | Handoff 1.2-1.3, user 2026-10-28 | - |
| D11 | Frame data travels through RAM and the terminal stream, never per-frame files; no RAM disk. | SSD wear. | Handoff 1.3, user 2026-10-28 | - |
| D12 | Performance is first-class and KISS governs design choices. | User direction. | User 2026-10-28 | - |
| D13 | Data can flow from a widget back to the agent; mechanism in D20. | Requirement 4. | Handoff 1.2 | - |
| D14 | Capture and transport: launch Chromium with `--force-device-scale-factor=<dpr>` and never emulate DPR; size pages with `setDeviceMetricsOverride(deviceScaleFactor: 0)`. One full-resolution PNG screencast per live widget is both change signal and frame source, paced by delaying acks. Frames go out as PNG `t=d` in 4096-byte chunks inside tmux DCS passthrough, one write per frame, identical frames skipped. Deferred: `t=s`, partial updates (`a=f`), raw+zlib, single-APC payloads. | Simplest event-driven path; 0 cost when static; terminal side about 9-10% at 10 fps. | Round 2 Q10; benchmarks | A measured bottleneck justifies a deferred optimization. |
| D15 | One chrome-headless-shell per Pi session, launched lazily with the first widget, `pipe: true`, without puppeteer's three anti-throttling flags; it exits when no pages remain or on `session_shutdown`. No shared browser across sessions. | No orphans, no cross-session crash domain; sharing saves only about 200 MB at 5 sessions. | Round 2 Q11; benchmarks | Memory across sessions proves a problem. |
| D16 | Only the widget being used is live, capped at 10 fps; there is no background animation; every other widget shows its last frame. | An animating page costs about 13% even uncaptured, so only freezing saves CPU. | Round 2 Q12; benchmarks | - |
| D17 | Freezing minimizes the page's window (about 0-0.5% CPU, state kept, about 13 ms thaw on hover or click). An unfocused widget freezes 10 s after the last pointer activity over it (Pi sends no leave event); a focused widget freezes after 5 min without input. No off-screen detection, so no reliance on Pi's private layout. | User choice (more forgiving than the recommended 3 s / 60 s). | Round 2 Q13 | Idle CPU measurements disappoint. |
| D18 | At most 5 retained pages per session (least recently used frozen pages close first) and any page frozen for 30 min closes; closed widgets keep their RAM still and revive on click with fresh JS state. | Bounds memory at about 200 MB of pages per session. | Round 2 Q14 | - |
| D19 | One agent tool takes exactly one of `html` (fragment or full document) or `path` (an `.html` entry file). The agent edits files with its normal tools and re-calls the tool; each call renders a new widget instance. No file watcher, no separate CSS/JS fields, no context trimming in v1. | Matches precedents; cheap edits through diffs; throwaway widgets stay one call. | Round 2 Q15; interface research | Token cost of inline HTML proves high. |
| D20 | Page bridge: `pi.send(data)` queues data (size and count capped) and delivers it as one custom message with `deliverAs: "nextTurn"` when the user leaves the widget; `pi.submit(data)` delivers immediately (`triggerTurn` when Pi is idle, `followUp` when busy). Widget data reaches the model labeled as untrusted widget data. | Passive plus active channels, like MCP Apps and OpenAI. | Round 2 Q16 | - |
| D21 | Network policy: by default scripts, styles, and fonts load only from an allowlist (cdnjs, jsdelivr, unpkg, esm.sh, Google Fonts) and fetch, XHR, and WebSocket reach only the widget's own origin; WebRTC is disabled, DNS prefetch is off, and navigation away from the widget origin is blocked. User config can add hosts or switch on open network for all widgets. No agent-requested access and no approval dialogs. When a widget hits a blocked request, the agent is told why. | The agent's own tools already reach the network, so this guards only against compromised third-party code and silent leaks of widget input; cheap enough to keep as the default. | Round 2 Q17, round 3 Q17 (asked twice) + user notes | A real workflow needs per-widget network grants. |
| D22 | `pi.submit` works only with transient user activation (a real click or keypress inside the widget); automatic reports use `pi.send`. | Page or remote content cannot start agent turns by itself. | Round 3 Q19 | - |
| D23 | Revive source: inline widgets revive from the persisted tool arguments; path widgets revive from the current file on disk, so older transcript rows show the newest version. A missing or unreadable file shows an explicit "source file missing: <path>" state instead of a blank or broken widget (the RAM still stays visible when available). | User choice; no copy stored in `details`. | Round 3 Q20 + user note | - |
| D24 | A path widget can load only files inside its entry file's folder and subfolders, resolved by realpath so symlinks cannot escape. | Least access. | Round 3 Q21 | - |
| D25 | When the terminal is narrower than a widget, the page layout stays fixed and the image is re-sent scaled down to fit, with mouse mapping scaled to match; widening restores full size. | Keeps the whole widget visible after tmux splits. | Round 3 Q22 | - |
| D26 | After tmux reattach or a Ghostty restart, the session re-sends its RAM stills on terminal resize, and a `/widgets-refresh` command re-sends them manually; hover (thaw) and click (revive) also restore images. | Stills are already in RAM; cheap. | Round 3 Q23 | - |
| D27 | In open network mode, requests to localhost, private IP ranges, `*.local`, and Tailscale addresses are still refused unless the host is listed in config. Best-effort: hostnames that resolve to local addresses may pass; Chrome's own local-network protection is a second layer (to verify). | Compromised widget code cannot reach local services. | Round 3 Q18 | Bypass found in testing, or a local dev-server workflow needs a simpler opt-in. |

## Rejected alternatives

- Per-frame file uploads (`t=f`) and a RAM disk: SSD writes, user preference (handoff 1.3, 8).
- `Page.setWebLifecycleState` freezing: breaks rAF and input after resume (handoff 6.5).
- Enabling mouse mode for the whole pane in regular mode: breaks terminal selection and tmux wheel scrolling (handoff 5.6).
- `HeadlessExperimental.beginFrame`: unsupported on macOS (Fact).
- DPR emulation through `setViewport`: half-resolution screencast and mis-scaled input (Fact).
- WKWebView, Ultralight, Servo, Blitz, Ladybird, Qt WebEngine, WPE as engines: fidelity, input, maturity, or platform gaps (independent review).
- `Debugger.pause` as the freeze mechanism: leaves CSS animations and frame production running (2-4%) and blocks evaluate; window minimize replaces it (D17).
- A 2 fps background rate for unused widgets: the running page costs about 13% regardless of capture rate (D16).
- Change signal plus screenshots (PoC style): measured no cheaper than screencast-only, with more moving parts (D14).
- Storing a source copy in tool result `details` for revive: user prefers the current file (D23).

## Open questions and prerequisites

All consequential branches are resolved (O1-O9 map to D14-D27). Planning defaults, not user decisions: inject Pi theme colors as CSS variables with a dark color scheme; default size min(100, terminal width - 4) x 20 cells, agent-adjustable, at most 256 cells per axis; capture the TUI through a `ctx.ui` factory callback; measure the cell size in the extension (Pi reports a 9x18 default under tmux).

Remaining non-blocking unknowns (owner: planning or implementation spike):

- U1 CDP Fetch interception on a synthetic `https` origin: secure context, localStorage, ES modules, worker scripts. Spike first; fallback is a loopback HTTP server.
- U2 Chrome's local-network protection behavior in headless mode for that origin (affects D27's second layer).
- U3 Cold-start browser launch time (warm is about 60 ms).
- U4 Ghostty 1.4.0 rendering of placeholders through tmux, including the 1.3.1 squash bug (handoff 4.1) and scaled re-sends (D25).
- U5 How to detect a tmux reattach without a resize; `/widgets-refresh` covers it (D26).
- U6 Method for proving no frame or still disk writes.
- U7 Behavior outside tmux, where Pi's full redraws delete Kitty images (degrade path under D2).
- U8 Long-run behavior of minimized pages (Chrome may throttle further, which only lowers CPU).

## Current frontier

Empty. All rounds answered 2026-10-28 (round 3 Q17 and Q18 confirmed as D21 and D27). The user confirmed the shared-understanding synthesis on 2026-10-28.

## Research index

See [research/index.md](./research/index.md). All four research tracks are complete.

## Proposed test seams and acceptance evidence

Thresholds derive from the benchmarks; CPU is percent of one core measured with `ps` CPU-time deltas over the browser tree, tmux server, Ghostty, and Pi.

- A1 Idle: a frozen widget costs at most about 0.5% browser CPU; a static live widget about 0%; no frames are produced for unchanged pages.
- A2 Active: one animating widget at the 10 fps cap stays within about 40% of one core in total (measured 31-37%).
- A3 Lifecycle: at most 5 retained pages per session; pages frozen for 30 min close; the browser exits when no pages remain; killing Pi leaves no Chromium processes.
- A4 Disk: no frame or still files are written during widget use.
- A5 Input: burst clicks sent as SGR mouse through `tmux send-keys` all land on the expected targets of a logging grid page; keys reach a focused widget; Escape releases focus; Pi's scroll and search keys keep working.
- A6 Freeze and thaw: an unfocused widget freezes 10 s after the last pointer activity; a focused one after 5 min without input; hover thaws it to a new frame within about 50 ms.
- A7 Revive: a closed or resumed widget revives on click (warm target under about 200 ms excluding cold launch); inline from tool arguments, path from the current file; a missing file shows the "source file missing" state.
- A8 Bridge: `pi.send` data arrives with the next user turn after release; `pi.submit` delivers immediately only within a click or keypress.
- A9 Network: by default a fetch to another host and a non-allowlisted script are blocked and the agent is told; the config switch opens them; localhost stays blocked in open mode.
- A10 Path scope: files outside the widget folder, including through symlinks, are refused.
- A11 Narrow terminal: a widget scales down to fit and clicks still hit the right targets; widening restores full size.
- A12 Recovery: terminal resize and `/widgets-refresh` re-send RAM stills.
- A13 Modes: regular mode shows the still plus hint; switching modes mid-session keeps widgets consistent.
- A14 Degrade: outside Ghostty + tmux, a clear notice and no crash.

Verification seams: pure unit tests (placeholder and upload encoding, tmux wrapping, mouse and scale mapping, freeze and close timers with a fake clock); headless page tests without a terminal (screencast pacing, minimize and restore, Fetch-interception serving, CSP and local-network blocking, bridge gesture rule); tmux-driven end-to-end tests in a visible pane (`send-keys` SGR input, `capture-pane` to locate `U+10EEEE`); CPU and process scripts adapted from `/tmp/pi-widgets-research/bench/`.

## Proposed wiki updates after implementation

- Architecture and module pages; verified terminal-graphics, Chromium capture, and Pi-integration findings distilled from the raw handoff and research.

## Resume state

- Round 1 answered 2026-10-28 (Q1-Q9 mapped to D1-D9; D10-D13 carried from the handoff and reaffirmed).
- Research completed 2026-10-28 by subagents `bench`, `interface-research`, `pi-seams`, and `sol-review` (`sol-architect` aborted on a provider error). Researcher and scout outputs were saved verbatim by the orchestrator.
- Round 2 answered 2026-10-28; the user asked for the security implications of open network access before settling the escape hatch.
- Round 3 answered 2026-10-28; Q17 was re-asked twice and confirmed with Q18 (D21, D27).
- Shared-understanding synthesis confirmed by the user 2026-10-28 (Q24); item transitioned to `ready_for_spec`.
- Exact next action: run `/skill:to-spec 261028-1700-interactive-html-widgets-for-pi` to write `plan.md`; resolve U1-U8 as early spikes in the plan.

## Readiness for To Spec

- [x] Every consequential branch is resolved or explicitly out of scope.
- [x] Facts are distinguished from user decisions and hypotheses.
- [x] Requirements, constraints, and non-goals are clear.
- [x] Acceptance evidence and proposed test seams are defined.
- [x] The user confirmed shared understanding.
