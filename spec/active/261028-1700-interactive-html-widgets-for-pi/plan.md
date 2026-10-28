# Plan: Interactive HTML widgets for Pi

Work item: `261028-1700-interactive-html-widgets-for-pi`
Status: Planned
Created: 2026-10-28
Updated: 2026-10-28

## Goal

Ship a Pi extension, `pi-interactive-widgets`, in this repository. The agent calls `show_widget` with `html` or `path`, and an interactive widget appears inline in the Pi transcript, rendered by headless Chromium and streamed to the terminal as kitty graphics with Unicode placeholders. In Pi fullscreen the user clicks, types, and scrolls inside the widget in place (hover also wakes widgets where the terminal reports pointer motion); widget data returns to the agent through `pi.send` and `pi.submit`. Widgets that are not in use cost about 0% CPU, and no frame or still is ever written to disk.

Assurance: medium - inherited from discovery (D4, user override of a `high` recommendation): personal single-user environment, reversible local extension with no production or data blast radius, explicit KISS preference. Performance is verified by measurement.

Execution mode: sliced, 2 segments; T01 complete; 2 implementation sessions remain after revision R001 (PD09); see [implementation/index.md](./implementation/index.md). Review tier (medium): scoped checks per slice, one focused review at each segment end, one final contract-quality review over the whole change.

## Context

- Discovery and evidence: [discovery.md](./discovery.md) (decisions D1-D27) and [research/index.md](./research/index.md). Discovery owns rationale; this plan owns the contract.
- Environment (verified 2026-10-28): macOS arm64, Ghostty 1.4.0, tmux 3.6b (`allow-passthrough on`, cell 16x34 device px, which is 8x17 CSS px at DPR 2), Pi 1.4.0 on Node, `tuiMode: fullscreen`, chrome-headless-shell 156 under `~/.cache/puppeteer/`, `PI_IMAGE_PROTOCOL` unset.
- Repository: only `/spec` and `/wiki` scaffolding. Follow the conventions of the user's own extensions (`../pi-ez-session-name`, `../pi-typesafe-bash`): ESM `package.json` with `"pi": {"extensions": ["./src/index.ts"]}`, `engines.node >=22.19.0`, Pi packages and `typebox` as `"*"` peer dependencies, npm, `tsc --noEmit` with the strict tsconfig used there, `node --import tsx --test`, and extension config under `getAgentDir()/extensions/<name>/config.json`.
- PoC `../pi-html-widget/index.ts` is reference only; re-validate anything reused (D3).
- Measured facts that shape the design ([capture-and-lifecycle-benchmarks.md](./research/capture-and-lifecycle-benchmarks.md)):
  - `--force-device-scale-factor` instead of DPR emulation gives full-resolution screencast frames and correct input during captures; DPR emulation mis-scales input.
  - Screencast emits no frames for unchanged pages and delivers a frame about 12 ms after input; `everyNthFrame` does not reduce CPU; pacing works by delaying acks.
  - Minimizing a page's window, in a browser launched without puppeteer's `--disable-renderer-backgrounding`, `--disable-background-timer-throttling`, and `--disable-backgrounding-occluded-windows`, drops the page to 0-0.5% CPU, thaws in about 13 ms, and keeps input, evaluate, and screenshots working.
  - PNG `t=d` costs Ghostty about 8% and Pi about 1% at 10 fps; tmux about 1-2 points.
  - `pipe: true` prevents orphaned browsers; warm launch takes about 60 ms; each page adds about 28-42 MB.
- Pi seams ([pi-integration-seams.md](./research/pi-integration-seams.md)): `tui.mode` is public and can change mid-session; the TUI instance is only available through `ctx.ui` factory callbacks; there is no public visibility signal; Pi emits no Kitty deletes under tmux but deletes images on full redraws outside tmux (`pi-tui/dist/tui-alt-screen.js` L1474-L1512: first render and terminal size changes); `renderShell: "self"` rows forward mouse events with `y - 1`; Escape and Ctrl+C reach a focused component; `pi.sendMessage` supports `nextTurn`, `followUp`, and `triggerTurn`; under tmux `getCellDimensions()` returns a 9x18 default.
- Pi mouse tracking (verified in slice 02.01, [refinements/R001.md](./refinements/R001.md)): under multiplexers (`TMUX`, `ZELLIJ`, or `STY` set, or `TERM` starting with `tmux` or `screen`) Pi 1.4.0 enables only button-motion tracking (`?1002h`, `pi-tui/dist/tui-alt-screen.js` L184-L193) with no override, so hover moves never reach the extension; elsewhere it enables all-motion tracking (`?1003h`).

## Requirements

- RQ01 Tool: register `show_widget` with exactly one of `html` (fragment or full document) or `path` (an `.html` entry file), plus optional `title`, `cols`, and `rows`. Each call renders a new widget instance and returns after the first frame with the widget id, cell size, CSS viewport, and any blocked requests and JS errors seen during initial load. The tool description carries the layout guidance: fixed viewport without page scrolling, `min-height: 0` and overflow on growing areas, click targets of at least about 24 px, click-triggered UI instead of hover effects (`:hover` styles and hover tooltips do not track the pointer under tmux), in-page `<select>` only, no native date or color pickers, the bridge API, the network policy, and a suggested scratch folder for editable widgets.
- RQ02 Placement: a widget renders inline and left aligned as a title line plus a Unicode-placeholder grid. The title line carries an interaction hint chosen with Pi's own multiplexer condition: "click to interact" under a multiplexer, "hover or click to interact" elsewhere, and the focused hint while focused. Default size is min(100, terminal width - 4) x 20 cells, agent-adjustable, at most 256 cells per axis.
- RQ03 Browser: one chrome-headless-shell per Pi session, found as the newest `chrome-headless-shell` under `~/.cache/puppeteer/` unless config `chromePath` is set. It launches lazily with the first widget through `puppeteer-core` with `pipe: true`, `--force-device-scale-factor=<dpr>` (default 2), without puppeteer's three anti-throttling flags, and with the Chromium sandbox on. It closes when no pages remain and on session shutdown or reload. A missing binary yields a notice with the install command; the extension never downloads a browser.
- RQ04 Frames: each live widget uses one full-resolution PNG `Page.startScreencast` as both change signal and frame source, paced by delayed acks to at most 10 fps. Frames are sent as PNG `t=d` in base64 chunks of at most 4096 bytes, one stdout write per frame, wrapped in tmux DCS passthrough under tmux; byte-identical frames are skipped. Image ids are random per process and never reused across widgets in the process. Frames and stills stay in RAM; nothing is written to disk.
- RQ05 Input (Pi fullscreen): mouse move, press, release, drag, and wheel are mapped from component cells to CSS pixels and dispatched to the page; moves arrive only where the terminal reports them (under tmux only during drags). A press focuses the widget and captures the pointer; while focused, keys are forwarded (special keys, printable text, kitty CSI-u). Escape and Ctrl+C restore the previously focused component. Wheel over an unfocused widget scrolls the transcript and over a focused widget scrolls the page. Pi's `tui.altScreen.*` keys keep working, and the extension never toggles mouse modes in fullscreen.
- RQ06 Run-time policy (revised by R001, PD09): at most one live widget per session. A press on a frozen widget makes it live (restoring its minimized window) and the same press is then delivered to the page; where the terminal reports pointer motion, hover also makes a widget live. Making another widget live freezes the previous one immediately. Releasing a focused widget (Escape, Ctrl+C, or a click elsewhere) freezes it immediately, together with `pi.send` delivery. A newly created widget that is not interacted with freezes 10 s after creation; a hover-woken unfocused widget freezes 10 s after the last pointer move over it; a focused widget freezes after 5 min without input. Freezing stops the screencast and minimizes the page's window; the widget keeps showing its last frame.
- RQ07 Close and revive: at most 5 retained pages per session (the least recently used frozen page closes first); a page frozen for 30 min closes; the browser closes when no pages remain. A closed widget keeps its RAM still and revives on click with fresh JS state: inline widgets from their persisted tool arguments, path widgets from the current file. A missing or unreadable file shows `source file missing: <path>`, with the still when available. After a Pi restart or resume, each widget row shows a placeholder line until clicked.
- RQ08 Bridge: `window.pi.send(data)` queues JSON-serializable data (capped size and count) and delivers it as one custom message with `deliverAs: "nextTurn"` when the user releases the widget. `window.pi.submit(data)` delivers immediately (`triggerTurn` when Pi is idle, `followUp` while busy) and only with transient user activation. Delivered content is labeled as untrusted widget data.
- RQ09 Network: the default CSP allows scripts, styles, and fonts only from `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com`, `esm.sh`, `fonts.googleapis.com`, and `fonts.gstatic.com`; `connect-src` (fetch, XHR, WebSocket) only to the widget's own origin; images from self, `data:`, and `blob:`. WebRTC is unavailable, DNS prefetch is off, and navigation away from the widget origin, popups, and form submissions are blocked. Config `network.allowHosts` adds hosts; config `network.open: true` lifts the allowlist, but localhost, private and link-local IP ranges, `*.local`, and Tailscale addresses (100.64.0.0/10, `*.ts.net`) stay blocked unless listed. Blocked requests are reported to the agent: in the tool result during initial load and queued with widget data afterwards.
- RQ10 Serving: each widget loads from a synthetic per-widget `https` origin served by CDP Fetch interception: inline documents from memory, path widgets from the entry file's folder and subfolders only (realpath-confined, no directory listing). The bridge, theme CSS variables from the Pi theme, a dark color scheme, and `appearance: base-select` are injected at document start; fragments are wrapped in an extension shell. If the U1 spike shows that the synthetic origin cannot provide a secure context, ES modules, and workers, use a loopback HTTP server with the same rules instead and record the change in the Decision Log.
- RQ11 Regular TUI mode: widgets show their still plus a hint to switch to fullscreen, without interaction; switching modes mid-session keeps widgets consistent.
- RQ12 Narrow terminal: when the terminal is narrower than a widget, the page layout stays fixed and frames are sent scaled to fit (fewer cells), with mouse mapping scaled to match; widening restores full size.
- RQ13 Recovery: after a terminal resize (after Pi's redraw), the session re-sends its RAM stills; `/widgets-refresh` re-sends them manually; a click (and hover where reported) also restores images.
- RQ14 Environments: enabled under tmux when the client terminal is Ghostty, or kitty (untested); enabled best-effort in plain Ghostty without tmux (no DCS wrapping, Pi's cell-size query, re-send after full redraws). Elsewhere the widget row shows `[widgets need tmux + Ghostty]` with the title, and the tool result tells the agent.
- RQ15 Config: optional `~/.pi/agent/extensions/pi-interactive-widgets/config.json` with `chromePath`, `dpr`, `network.open`, and `network.allowHosts`. Defaults apply when it is absent; an invalid config produces a notice and the defaults.
- RQ16 Dev entry: `/widget-dev <file.html>` is registered only when `PI_WIDGETS_DEV=1` and renders through the same pipeline; in dev mode only, timer durations can be shortened for tests.
- RQ17 Cleanup: session shutdown and reload release pages, timers, listeners, and the browser; killing Pi leaves no Chromium processes.

## Out of scope

- General-purpose browser features (tabs, URL bar, navigation), native OS pickers, and pixel-precise mouse input inside tmux.
- An interactive regular-mode overlay; verified support beyond Ghostty + tmux on macOS.
- A browser shared across Pi sessions; background animation of unused widgets; off-screen detection through Pi's private layout.
- Shared-memory transport (`t=s`), kitty partial updates (`a=f`), raw+zlib frames, single-APC payloads, and GPU flags.
- File watching or live reload, separate CSS/JS tool fields, context trimming of inline HTML, and agent-requested network access or approval dialogs.
- Persisting widget JS state across close, resume, or revive; disk-persisted stills or frames.
- Automatic browser downloads, Playwright, and a user-facing `/widget` command.
- Forcing all-motion mouse tracking (`?1003h`) or any other mouse-mode change under multiplexers; hover-dependent widget UI under tmux.
- Installing the package into the user's Pi settings or publishing it (user-controlled).

## Assumptions

- Chromium behaviors measured on chrome-headless-shell 156 (flag-based DPR, screencast pacing, minimize freeze) hold for the detected version. Revisit if the detected version differs and slice checks fail.
- Chromium's temporary profile directory created at launch may receive small writes; only frame and still files are forbidden. AC04 records the actual write pattern.
- The TUI instance (needed for `setFocus` and `getFocusedComponent`) is captured through a `ctx.ui.setWidget` factory probe at session start and kept in one module. Revisit if Pi adds an official accessor or the probe stops working.
- `show_widget` does not clash because `pi-generative-ui` is not installed. Revisit if it is installed.
- Outside tmux, Pi's full redraws happen only on first render and terminal size changes (verified in Pi 1.4.0 source). Pi-owned images moving on screen may also delete placements (unverified); recovery is best-effort through click (and hover where reported) and `/widgets-refresh`.
- In plain Ghostty Pi enables all-motion tracking, so hover reaches the extension (source only; verified in the AC14 manual run).

## Design

Proposed module layout (paths are guidance; keep it KISS):

```text
package.json, tsconfig.json, README.md
src/
  index.ts       Pi entry: show_widget tool and renderer, /widgets-refresh, /widget-dev, session events, config load
  config.ts      config file parsing and defaults
  env.ts         environment detection (tmux client terminal, plain Ghostty), cell size, DPR
  kitty.ts       placeholder grid, chunked t=d upload, tmux wrapping, delete, image ids, scaled sends
  browser.ts     binary detection, lazy launch with pipe, flags, close when empty
  page.ts        widget page: Fetch-interception origin, injection, CSP, screencast pacing,
                 minimize and restore, input dispatch, error and violation capture
  policy.ts      CSP builder, allowlist, local-address classification
  keys.ts        terminal key data to CDP key events
  bridge.ts      pi.send queue, pi.submit with activation check, delivery to Pi
  manager.ts     widget registry, live/frozen/closed state machine, timers, LRU, revive, stills, refresh
  component.ts   inline transcript component: render, hints, notices, mouse and keys, focus, scaling map
tests/           unit (*.test.ts), browser (*.browser.test.ts), e2e (tmux), fixtures/*.html
scripts/         harness (standalone pipeline in a tmux pane), perf (CPU, disk)
```

Widget lifecycle:

```text
create or revive -> live (screencast on, input enabled)
live   -> frozen  another widget becomes live | release (Escape, Ctrl+C, click elsewhere) |
                  10 s after creation or last hover move (unfocused) | 5 min without input (focused)
frozen -> live    press (then delivered to the page), or hover where reported: restore window, restart screencast
frozen -> closed  LRU beyond 5 pages | 30 min frozen
closed -> live    click: revive with fresh JS state
```

Implementation notes that prevent known mistakes:

- Never emulate DPR. Size pages with `Emulation.setDeviceMetricsOverride({deviceScaleFactor: 0, ...})` or window bounds, and keep viewport emulation, screencast, and input on puppeteer's main page session.
- Screencast frames arrive base64-encoded; pass the base64 string straight into kitty chunks and compare strings for identical-frame skipping (no decode or re-encode).
- Write each frame's kitty upload with one `process.stdout.write`; never embed upload commands in rendered lines (Pi parses `\x1b_G` in lines).
- Use `q=2` on every kitty command so terminals send no replies into Pi's input.
- Freeze with `Browser.setWindowBounds({windowState: "minimized"})` and stop the screencast; thaw by restoring `normal` bounds and restarting the screencast. Do not use `Debugger.pause` or `Page.setWebLifecycleState`.
- Under tmux, read the cell size from `tmux display -p '#{client_cell_width} #{client_cell_height}'`; outside tmux use Pi's `getCellDimensions()`.

## Decision Log

| ID | Scope | Decision | Rationale | Evidence | Revisit when |
| --- | --- | --- | --- | --- | --- |
| PD01 | Dependencies | Runtime dependency `puppeteer-core`; dev dependencies `typescript`, `tsx`, `@types/node`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox` (1.4.0-compatible, type checks only; Pi supplies them at runtime as peers). Approved during planning; any other dependency needs approval. | Thin CDP layer used by every benchmark; matches the user's tooling convention. | To Spec Q25 (after a Playwright comparison) | A required capability is missing. |
| PD02 | Browser binary | Auto-detect the newest cached chrome-headless-shell; `chromePath` override; notice when missing; no downloads. | No network or disk side effects; benchmarks used headless-shell. | To Spec Q26 | The detected version misbehaves. |
| PD03 | Tool name | `show_widget`. | User choice. The name is persisted in sessions, so do not rename it later. | To Spec Q27 | Only with a migration plan. |
| PD04 | Test entry | `/widget-dev <file.html>` only with `PI_WIDGETS_DEV=1`, plus dev-only shortened timers. | Deterministic e2e without user-facing scope. | To Spec Q28 | - |
| PD05 | Environments | tmux + Ghostty (kitty client allowed, untested) and plain Ghostty best-effort; notice elsewhere. | Plain Ghostty costs little given resize re-sends. | To Spec Q29 | Plain Ghostty blanks frequently. |
| PD06 | Liveness | At most one live widget per session; making another widget live freezes the previous one immediately; other freeze timers follow RQ06 as revised by PD09. | Reconciles D16 with D17 and bounds CPU when the mouse sweeps across widgets. | To Spec Q30 | - |
| PD07 | Architecture | Discovery decisions are binding: D14 capture and transport, D15 process model, D16-D18 run-time policy, D19-D20 and D22-D23 interface, bridge, and revive, D21 and D27 network, D24 path scope, D25 scaling, D26 recovery. | Confirmed in discovery. | [discovery.md](./discovery.md) | A slice check shows a measured failure. |
| PD08 | Serving and network (implementation detail, no contract change) | U1 passed, so the synthetic Fetch-interception origin stays and no loopback fallback exists. U2: Chrome's Local Network Access denies loopback and private targets from the widget origin in headless mode, which would also block hosts listed in `network.allowHosts`; when config lists a local host, the page grants `local-network-access`, `loopback-network`, and `local-network` to that widget origin only (`Browser.setPermission`), and otherwise Chrome's check stays on as the D27 second layer. Navigation away is answered with HTTP 204 so the widget document stays in place. | Keeps RQ09 "blocked unless listed" true for listed local hosts without weakening unlisted ones. | Slice 01.01 evidence in [implementation/01-01-browser-page-layer.md](./implementation/01-01-browser-page-layer.md) | Chrome changes LNA permission names or behavior. |
| PD09 | Waking and freezing (revision R001, applied) | Applied [refinements/R001.md](./refinements/R001.md). Old contract: hover or click makes a widget live; an unfocused widget freezes 10 s after the last pointer activity (D17). New contract: a press wakes a frozen widget and is delivered to the page; hover wakes only where the terminal reports motion; release freezes immediately; the 10 s timer applies from creation and from the last hover move; hint text and tool guidance follow (RQ01, RQ02, RQ05, RQ06, RQ13, AC06, AC14, AC16). RQ05 (no mouse-mode toggling) is unchanged. Slice 02.01 is frozen as history and replaced by 02.03, which starts from the preserved 02.01 Attempt 1 work. | Under multiplexers Pi 1.4.0 enables only button-motion tracking with no override, so hover-to-wake conflicted with RQ05; user decisions RD1-RD3 in R001. | [02-01-pi-integration.md](./implementation/02-01-pi-integration.md) Attempt 1 and Interruption 1; R001 | Pi offers all-motion tracking or a hover API under multiplexers. |

## Work breakdown

- [x] T01: Rendering pipeline proven outside Pi
  - Depends on: none
  - Scope: package scaffold; browser and page layer (RQ03, RQ04 capture side, RQ08 page side, RQ09, RQ10); kitty transport and environment detection (RQ02 grid, RQ04 transport, RQ12 scaled sends, RQ14 detection); standalone harness and perf scripts.
  - Expected areas: `package.json`, `tsconfig.json`, `src/browser.ts`, `src/page.ts`, `src/policy.ts`, `src/kitty.ts`, `src/env.ts`, `tests/`, `scripts/harness.ts`, `scripts/perf/`.
  - Acceptance: headless tests prove serving, policy, injection, pacing, freezing, and input; the harness renders a live widget in a visible tmux pane in Ghostty 1.4.0 with every burst click landing and CPU within AC01 and AC02.
  - Verification: `npm run typecheck`, `npm test`, `npm run test:browser`, harness and perf runs.
- [ ] T02: Pi extension
  - Depends on: T01
  - Scope: tool, component, input and focus, click-to-wake and hint text (PD09), bridge delivery, regular mode, environment notices and the plain Ghostty path, config, dev command (RQ01-RQ02, RQ05, RQ08, RQ11, RQ14-RQ16); lifecycle, revive, scaling hookup, recovery, cleanup, README (RQ06-RQ07, RQ12-RQ13, RQ17).
  - Expected areas: `src/index.ts`, `src/component.ts`, `src/manager.ts`, `src/bridge.ts`, `src/keys.ts`, `src/config.ts`, `tests/`, `tests/e2e/`, `README.md`.
  - Acceptance: AC01-AC16.
  - Verification: the full verification plan.

## Acceptance criteria

- AC01 Idle: a frozen widget costs at most 0.5% browser-tree CPU over 10 s; an unchanged live page produces no screencast frames. (RQ04, RQ06)
- AC02 Active: one animating widget at the 10 fps cap costs at most about 40% of one core in total across the browser tree, Ghostty, the tmux server, and Pi (median of 3 runs). (RQ04)
- AC03 Lifecycle: at most 5 retained pages per session; a page frozen for 30 min closes; the browser exits when no pages remain; after `kill -9` of Pi no Chromium process it started remains. (RQ03, RQ07, RQ17)
- AC04 Disk: during a 60 s session with an animating widget, no frame or still file is created; any Chromium profile writes are listed and limited to launch. (RQ04)
- AC05 Input: on a logging grid page, 18 target clicks and a 60-click burst sent as SGR mouse through `tmux send-keys` all hit the expected targets; typed keys reach a focused input; Escape releases focus; `ctrl+u` and `ctrl+d` still scroll the transcript while a widget is focused. (RQ05)
- AC06 Freeze and thaw: under tmux a press on a frozen widget yields a new frame within about 50 ms and the same press reaches the page (page-side log); releasing a focused widget freezes it immediately; a new widget that is not interacted with freezes 10 s after creation; a focused widget freezes after 5 min without input (fake-clock unit tests, dev-shortened e2e); making widget B live freezes widget A immediately; in plain Ghostty hover makes a frozen widget live (manual, in the AC14 run). (RQ06)
- AC07 Revive: a closed or resumed widget revives on click within about 200 ms with a running browser (excluding cold launch); inline widgets from tool arguments, path widgets from the current file; a deleted file shows `source file missing: <path>`. (RQ07)
- AC08 Bridge: `pi.send` data arrives as one custom message with the next user turn after release; `pi.submit` without user activation is rejected and after a click delivers immediately; content is labeled untrusted widget data. (RQ08)
- AC09 Network: in default mode a fetch to another host and a non-allowlisted script are blocked and reported, an allowlisted CDN script loads, WebRTC is unavailable, and navigation away is blocked; with `network.open` an external fetch succeeds while `localhost`, a private IP, and a Tailscale address stay blocked unless listed. (RQ09)
- AC10 Path scope: requests for files outside the entry folder, including through a symlink, fail. (RQ10)
- AC11 Modes: in regular mode widgets show the still plus hint; switching modes mid-session keeps widgets rendered and interactive in fullscreen. (RQ11)
- AC12 Narrow terminal: after the pane shrinks below the widget width, the widget shows scaled to fit and clicks still hit the expected targets; widening restores full size. (RQ12)
- AC13 Recovery: a terminal resize and `/widgets-refresh` re-send every retained still; after reattaching tmux from a new Ghostty window, `/widgets-refresh` restores the images (manual). (RQ13)
- AC14 Environments: tmux + Ghostty renders; a tmux client that is neither Ghostty nor kitty yields the notice and the agent is told; one manual plain-Ghostty check renders a widget, wakes it by hover, accepts a click, and survives a resize. (RQ14)
- AC15 Failures: a missing Chromium binary and an invalid config each produce a clear notice without crashing Pi. (RQ03, RQ15)
- AC16 Quality: `npm run typecheck`, `npm test`, `npm run test:browser`, and `npm run test:e2e` pass; the tool description and README document usage, config, and limits, including click-to-interact under tmux and the advice against hover-dependent UI. (RQ01, RQ15, RQ16)

## Testing decisions and seams

- Unit (`tests/*.test.ts`, no browser or terminal): placeholder grid and diacritics, chunking and tmux wrapping, image id allocation, mouse and scale mapping, key mapping, CSP builder and local-address classification, config parsing, state machine and timers with a fake clock, LRU, bridge caps.
- Browser (`tests/*.browser.test.ts`, headless Chromium, no terminal): Fetch-interception serving and path confinement, CSP and network modes, WebRTC and navigation blocking, injection and the bridge activation rule, screencast pacing and unchanged-page behavior, minimize and restore, page-level input accuracy, error and violation capture.
- E2E (`tests/e2e/`, real Pi in a visible tmux pane of the attached client, `PI_WIDGETS_DEV=1`): create widgets with `/widget-dev tests/fixtures/*.html`, send SGR mouse with `tmux send-keys -l`, locate placeholders with `tmux capture-pane -p` (first `U+10EEEE`), and observe page effects through bridge messages or a dev log. Hidden tmux windows drop passthrough, so e2e panes must be visible.
- Perf (`scripts/perf/`): `ps` CPU-time deltas over the browser tree, tmux server, Ghostty, and Pi; process-tree footprint; a disk-write check before and after.
- Manual: a plain Ghostty run and a tmux reattach from a new Ghostty window. Visual rendering checks need the user, because the agent cannot capture the screen.

## Verification plan

- `npm install` (PD01 dependency set only).
- `npm run typecheck`
- `npm test`
- `npm run test:browser`
- `npm run test:e2e` (requires a visible tmux pane: run it in a temporary split of the attached client's current window and close the split afterwards)
- `npm run perf` (AC01, AC02, AC04)
- Manual: the AC13 reattach check and the AC14 plain-Ghostty check, recorded in verification evidence.
- After each browser or e2e run: confirm that no chrome-headless-shell process started by the run remains.

## Risks and blockers

- U1 synthetic-origin serving may lack a secure context, ES modules, or workers: spike first in slice 01.01; fallback is a loopback server (RQ10).
- U2 Chrome's local-network protection in headless mode is unknown: the extension's own host checks are the primary control (RQ09).
- U4 Ghostty 1.4.0 placeholder rendering through tmux and scaled sends: proven by the slice 01.02 harness before Pi work; if scaling fails, cropping needs user approval.
- Pi internals: the TUI factory probe and `renderShell: "self"` offsets may change with Pi upgrades; keep them isolated in `src/component.ts` and `src/index.ts`.
- Chromium updates are manual (no auto-download); the README documents the update command.
- Ghostty's 320 MB image limit can evict old images; recovery is through click (and hover where reported) and `/widgets-refresh`.
- Benchmark scripts in `/tmp/pi-widgets-research/` may be deleted by macOS; recreate the perf scripts in `scripts/perf/`.
- Plain-Ghostty hover delivery is source-inferred only; the AC14 manual run verifies it, and click-to-wake still works if it fails.

## Progress

- [x] Planning complete and confirmed.
- [x] T01 complete (checkpoints `22eed8a`, `8f8396c`).
- [x] Revision R001 applied (PD09); slice 02.01 frozen as history, replaced by 02.03.
- [ ] T02 in progress (Current `02.03`, then `02.02`).
- [ ] Whole-plan verification not run.

## Execution handoff

Use PI Agent in a fresh session with this prompt:

```text
Read spec/active/261028-1700-interactive-html-widgets-for-pi/implementation/index.md, its Current packet, plan.md, and item.yaml completely.
Implement only the Current slice while preserving Requirements, Out of scope, Decision Log, and Verification plan.
Run the slice checks and any review gate the packet requires, then update the packet and index as the packet describes.
Update the Decision Log when confirmed implementation discoveries change the approach.
Stop and ask before dependencies beyond PD01, migrations, destructive operations, external writes, commits, pushes, or scope expansion.
```

## Proposed durable knowledge updates

After implementation and verification:

- Wiki architecture and module pages for the extension.
- Verified terminal-graphics findings: kitty placeholders through tmux, Ghostty 1.4.0 behavior, Pi image deletion outside tmux.
- Verified Chromium capture and freeze findings: flag-based DPR, screencast pacing, window-minimize freeze.
- Ingest `wiki/raw/2026-10-27-poc-handoff.md` with the corrections recorded in discovery (superseded handoff claims).
