# Slice 02.01: Pi integration core

Plan: `../plan.md`
Implementation index: `./index.md`
Segment: `T02 - Pi extension`
Assurance: medium - personal single-user setup, reversible local extension, KISS preference
Review required now: none (scoped checks only)

## Outcome

Loading the extension with `pi -e ./src/index.ts` registers `show_widget` (and `/widget-dev` when `PI_WIDGETS_DEV=1`). Widgets render inline in Pi fullscreen as a title line plus placeholders, are hoverable, clickable, and typeable in place with focus and release, deliver `pi.send` data on release and `pi.submit` data immediately, show the still plus a hint in regular mode, and show the environment notice where unsupported. Config is loaded, and plain Ghostty works best-effort. Liveness may be minimal here (live while hovered or focused, frozen on release); the full policy comes in 02.02.

## Why this slice exists now

It turns the proven T01 pipeline into a usable extension, the coherent state that the lifecycle policy, revive, scaling, and recovery work in 02.02 builds and tests against.

## Relevant context

- RQ01 tool: `show_widget` with exactly one of `html` or `path`, optional `title`, `cols`, `rows`; returns after the first frame with id, cell size, CSS viewport, blocked requests, and JS errors; description carries the layout guidance listed in RQ01.
- RQ02, RQ05: `renderShell: "self"`; tool-row mouse events arrive with `y - 1` already applied by Pi; reuse the previous component through `context.lastComponent` so focus survives re-renders; press returns `{focus: true, capture: true}`; keep the previous focused component and restore it with `tui.setFocus` on Escape or Ctrl+C; wheel handled only while focused; never toggle mouse modes.
- Keys: map terminal data to CDP key events in `src/keys.ts` using pi-tui `matchesKey` for special keys, printable text, and kitty CSI-u printable sequences; Escape is reserved for release.
- RQ08 delivery: `pi.sendMessage({customType, content, display}, {deliverAs: "nextTurn"})` on release; `pi.submit` uses `triggerTurn` when idle and `followUp` while busy; label content as untrusted widget data.
- RQ11: `tui.mode` decides fullscreen versus regular; regular shows the still plus a hint; handle mode switches mid-session.
- RQ14: unsupported environments show `[widgets need tmux + Ghostty]` with the title and tell the agent in the tool result; plain Ghostty skips DCS wrapping and uses Pi's `getCellDimensions()`.
- RQ15 config at `getAgentDir()/extensions/pi-interactive-widgets/config.json`, following `../pi-ez-session-name/src/index.ts`; invalid config notifies and uses defaults.
- RQ16 dev command and dev-only timer overrides.
- Assumption: capture the TUI through a `ctx.ui.setWidget` factory probe at `session_start`, isolated in one place.
- Parent-plan sections to load on conflict or uncertainty: Requirements, Assumptions, Design, Decision Log (PD03-PD06).

## Constraints and non-goals

- Do not rename the tool (PD03).
- Never embed kitty uploads in rendered lines; uploads go out through the transport with one write per frame.
- No timers beyond the minimal liveness rule, no LRU, no revive, no scaling hookup, no refresh command yet (02.02).
- Dependencies limited to PD01.

## Expected source and test areas

- `src/index.ts`, `src/component.ts`, `src/bridge.ts`, `src/keys.ts`, `src/config.ts`, `src/manager.ts` (minimal registry)
- `tests/*.test.ts` (keys, config, bridge caps, mouse mapping), `tests/e2e/` (Pi in a visible tmux pane with `PI_WIDGETS_DEV=1`), `tests/fixtures/*.html`
- `package.json` script `test:e2e`

These paths are navigation hints. Inspect other source or tests only when Current or a credible regression path requires it.

## Acceptance and checks

- Acceptance: AC05 in e2e: on a logging grid page, 18 target clicks and a 60-click burst all hit; typed keys reach a focused input; Escape releases focus; `ctrl+u` and `ctrl+d` still scroll the transcript while a widget is focused.
- Acceptance: AC08: `pi.send` data arrives as one custom message with the next user turn after release; `pi.submit` without activation is rejected and after a click delivers immediately; content is labeled untrusted.
- Acceptance: AC11: regular mode shows the still plus hint; switching to fullscreen mid-session makes widgets interactive.
- Acceptance: AC14 partially: environment classification is unit-tested, the unsupported path shows the notice and tells the agent; the plain-Ghostty path is implemented (manual check happens in 02.02).
- Acceptance: AC15: a missing Chromium binary and an invalid config each produce a clear notice without crashing Pi.
- Check: `npm run typecheck`
- Check: `npm test`
- Check: `npm run test:browser`
- Check: `npm run test:e2e` (visible tmux split; close it afterwards)

## Attempt log

No attempts recorded.

For each interrupted or failed attempt, append without rewriting earlier entries:

```text
### Attempt <number> - <timestamp>
Starting HEAD: <git commit at invocation start>
Changes: <paths and behavior changed>
Checks: <commands and results>
Failures: <failures or none>
Blockers: <credible blockers or none>
Exact next action: <single resumable action>
```

Keep this log concise. Do not duplicate unchanged plan or check output.

### Attempt 1 - 2026-10-28T21:20+01:00

Starting HEAD: `8f8396c` (clean tree, nothing staged). `wiki/raw/2026-10-27-poc-handoff.md` unchanged (blob `43aefcf`).

Changes (uncommitted, preserved):

- New `src/config.ts` (RQ15 parse and validate, defaults on missing or invalid file), `src/keys.ts` (pi-tui `parseKey`/`decodeKittyPrintable` to CDP key events; Escape and Ctrl+C release; bracketed paste as text), `src/bridge.ts` (untrusted-labeled `widget-data` message, `<` escaped, blocked list capped at 20, content capped; `nextTurn` for send, `triggerTurn` idle or `followUp` busy for submit), `src/manager.ts` (registry, one live widget, live on pointer activity, frozen on release or 10 s after the last pointer activity while unfocused, delivery, regular-mode freeze and focus release on mode switch, plain-Ghostty re-send after Pi full redraws, theme CSS variables, dev JSON-lines log), `src/component.ts` (title line plus placeholder grid, cropped to the render width until 02.02 scaling; mouse mapping with `y - 1` and the title row; press focus and capture; wheel to the page only while focused; refocus false-then-true guard).
- `src/index.ts`: `show_widget` (exactly one of `html`/`path`, `.html` entry, `renderShell: "self"`, RQ01 description, result with id, cells, CSS viewport, blocked requests, JS errors), `lastComponent` reuse, unsupported and non-interactive notices, `/widget-dev <file.html> [cols rows]` plus entry renderer only with `PI_WIDGETS_DEV=1`, config load with notice at `session_start`, TUI capture through a transient `setWidget` probe, cleanup at `session_shutdown`.
- RQ09 correction: `src/policy.ts` `listsLocalHost` (moved from `src/page.ts`) and open-mode `connect-src` limited to `ws://`/`wss://` of listed hosts once a local host is listed; `src/page.ts` uses `listsLocalHost`.
- Tests: `tests/keys.test.ts`, `tests/config.test.ts`, `tests/bridge.test.ts`, `tests/component.test.ts`, `tests/policy.test.ts` (IPv6 bracket regression, `listsLocalHost`, CSP cases), `tests/network.browser.test.ts` plus `tests/helpers.ts` WebSocket handshake and `tests/fixtures/network.html` `__ws`; e2e `tests/e2e/lib.ts`, `tests/e2e/probe-extension.ts` (faux model, no network, records every context), `tests/e2e/widgets.e2e.ts`, fixtures `tests/fixtures/e2e-grid.html`, `e2e-input.html`, `e2e-bridge.html`; `package.json` script `test:e2e`. No dependency change (PD01 only).

Checks (repository root, final tree):

- `npm run typecheck`: exit 0.
- `npm test`: 94 pass, 0 fail.
- `npm run test:browser`: 23 pass, 0 fail; the new WebSocket test fails on the pre-fix CSP (`actual: 'open'`) and passes after it.
- `npm run test:e2e`: 8 pass, 0 fail (three consecutive full passes). Pi 1.4.0 with `PI_WIDGETS_DEV=1 pi -ne -ns -np -nc --no-session -e ./src/index.ts -e ./tests/e2e/probe-extension.ts --model e2e-faux/echo` in a temporary visible split of the attached client's current window, isolated `PI_CODING_AGENT_DIR` (temp dir with the user's ctrl+u/ctrl+d halfPage bindings), `PI_OFFLINE=1`; every split closed and every process it started gone; no chrome-headless-shell left.

Acceptance:

- AC05 (e2e): 18/18 target clicks and 60/60 burst clicks hit; typed text and Backspace reach a focused input; ctrl+u and ctrl+d scroll the transcript while the widget stays focused and keeps receiving keys; Escape releases and later keys go to the editor. Visual (user, Ghostty 1.4.0 + tmux 3.6b): image visible and left-aligned under the title, circle round, square square, border and corner labels visible, click shows the focused hint and Escape restores it ("all yes").
- AC08 (e2e): `pi.send` arrives as exactly one untrusted-labeled custom message in the next user turn and starts no turn; `pi.submit` at load and in a timer (no activation) is rejected; after a click it delivers with `triggerTurn` and starts a turn immediately.
- AC11 (e2e): regular mode shows the still placeholders plus "still image ... fullscreen mode needed to interact"; switching to fullscreen through `/settings` mid-session shows the fullscreen hint and a click hits a target. The e2e hover step injects SGR 35, which a real tmux client never sends (see blocker). Regular-mode visual check not yet asked.
- AC14 partial: env classification unit tests (01.02) pass; e2e without `TMUX` shows `[widgets need tmux + Ghostty] probe widget`, the tool result tells the agent, and no browser starts. Plain-Ghostty path implemented (no DCS wrap, Pi `getCellDimensions()`, re-send after full redraws); manual check is 02.02.
- AC15 (e2e): invalid config shows "invalid config ...: dpr must be a number from 1 to 4; using defaults" and widgets still render; `chromePath` to a missing binary shows "chrome-headless-shell not found ... Install it with: npx @puppeteer/browsers install ..." for `/widget-dev` and as the tool error, and Pi keeps answering.
- RQ01 (e2e through the faux model): the tool returns "Widget <id> is shown inline: 40x3 cells, CSS viewport 320x51 px", blocked and JS-error lines.

RQ09 correction:

- (1) IPv6 brackets: not reproducible as described. WHATWG `URL.hostname` keeps brackets (`[::1]`), so `hostListed(["[::1]"])` already matches; a probe showed `[::1]:PORT` listed works in open mode (200) and is blocked in default mode by CSP, because CSP host-source grammar cannot express IPv6 literals. Approved resolution (Gamemaster): no matching change; unit regression test added; limitation recorded for the 02.02 README (IPv6-literal allowHosts entries work only with `network.open: true`; default mode should use a hostname such as `localhost`).
- (2) WebSocket: reproduced (open mode, listed `127.0.0.1:<port>`, unlisted `ws://127.0.0.1:<other>` and `ws://localhost:<port>` opened). Fixed in `buildCsp`; now blocked and reported as `blocked by CSP connect-src`, listed host still opens. Trade-off: in that configuration public `ws:`/`wss:` hosts must also be listed.

Failures: user visual check (d) failed: hovering a frozen widget did not wake it; only a click did. The counter jump (20 to 60 across 48 s frozen) is the expected throttled JS of a minimized page (T01 freeze, AC01 0.1% CPU), not a missed freeze.

Blockers: RQ06 ("Hover or click makes a widget live") and AC06 ("hover thaws") cannot be met under tmux without toggling mouse modes, which RQ05 forbids. Evidence: `pi-tui/dist/tui-alt-screen.js` L184-L193 enables `ENABLE_BUTTON_MOTION_MOUSE` (`?1000h ?1002h ?1004h ?1006h`, no `?1003h`) whenever `TMUX`, `ZELLIJ`, or `STY` is set or `TERM` starts with `tmux` or `screen`; tmux reports the Pi pane `mouse_all_flag=0 mouse_button_flag=1 mouse_sgr_flag=1`; the user's real hover produced no move event in the dev log. Outside multiplexers (plain Ghostty) the same code enables `ENABLE_ALL_MOTION_MOUSE` (`?1003h`), so hover should arrive there (source only, not run). Progress unchanged; no workaround applied.

Exact next action: Gamemaster obtains the user's decision on hover-to-wake under tmux (RQ05 versus RQ06/AC06), then rerun visual check 1 item (d) and ask the regular-mode visual check (AC11) before recording 02.01 completion.

### Interruption 1 - formal refinement selected - 2026-10-28T21:55+01:00

Starting HEAD: `8f8396c` (unchanged; nothing staged or committed).

Conflict: RQ05 ("the extension never toggles mouse modes in fullscreen") versus RQ06 ("Hover or click makes a widget live") and AC06 ("hover thaws to a new frame within about 50 ms"). Under tmux, hover events never reach Pi, so hover-to-live is impossible without toggling mouse modes.

Source evidence:

- `@earendil-works/pi-tui/dist/tui-alt-screen.js` L184-L193 (Pi 1.4.0): when `TMUX`, `ZELLIJ`, or `STY` is set, or `TERM` starts with `tmux` or `screen`, the renderer writes `ENABLE_BUTTON_MOTION_MOUSE` (`?1000h ?1002h ?1004h ?1006h`) instead of `ENABLE_ALL_MOTION_MOUSE` (with `?1003h`). There is no setting or environment override in that code path.
- tmux pane flags for the Pi pane: `mouse_all_flag=0 mouse_button_flag=1 mouse_sgr_flag=1`.
- The user's real hover in visual check 1 produced no move event in the dev log; only a click woke the widget.
- Outside multiplexers (plain Ghostty) the same code enables `?1003h`, so hover should arrive there (source only, not run).

Affected contract: RQ05, RQ06, AC06, and the PD06 interplay (at most one live widget; another widget becoming live on hover freezes the previous one, and the D17 unfocused 10 s timer counts from pointer activity over the widget, which under tmux exists only as press, drag, release, and wheel). Completed work 01.01 and 01.02 is unaffected (page freeze/thaw, transport, and harness do not depend on hover delivery).

Preserved uncommitted changes (not reverted, stashed, staged, or deleted): `package.json`, `src/index.ts`, `src/page.ts`, `src/policy.ts`, `tests/fixtures/network.html`, `tests/helpers.ts`, `tests/network.browser.test.ts`, `tests/policy.test.ts`, new `src/bridge.ts`, `src/component.ts`, `src/config.ts`, `src/keys.ts`, `src/manager.ts`, `tests/bridge.test.ts`, `tests/component.test.ts`, `tests/config.test.ts`, `tests/keys.test.ts`, `tests/e2e/` (`lib.ts`, `probe-extension.ts`, `widgets.e2e.ts`), `tests/fixtures/e2e-bridge.html`, `tests/fixtures/e2e-grid.html`, `tests/fixtures/e2e-input.html`; spec: this packet and `./index.md` (Discoveries).

Check results (Attempt 1, final tree): `npm run typecheck` exit 0; `npm test` 94/94; `npm run test:browser` 23/23; `npm run test:e2e` 8/8 in three consecutive runs; no chrome-headless-shell or split left.

User visual check 1 (Ghostty 1.4.0 + tmux 3.6b): (a) image visible, left-aligned, no stray characters: yes; (b) circle round, square square: yes; (c) border and four corner labels visible: yes; (d) hover wakes a frozen widget: failed; (e) click shows the focused hint and Escape restores it: yes.

User selection (verbatim, relayed by Gamemaster): "lets move to grill with docs to refine and find a solution for this, or a compromise".

Attempt state: frozen pending same-item reconciliation. Packet file, index `Current: 02.01`, the 02.01 checkbox, plan task T02, and every segment gate are unchanged.

Exact next action: `/skill:grill-with-docs 261028-1700-interactive-html-widgets-for-pi`

State proof (revision entry):

- `uv run spec/scripts/manage-spec-item.py transition --help`: `--to {discovering,planned,ready_for_spec,revision_required}` (target accepted).
- `uv run spec/scripts/manage-spec-item.py --root . transition --item 261028-1700-interactive-html-widgets-for-pi --to revision_required`: exit 0, `{"action": "transition", "from": "planned", "id": "261028-1700-interactive-html-widgets-for-pi", "to": "revision_required"}`.
- `item.yaml`: `status: revision_required`.
- `resolve --item 261028-1700-interactive-html-widgets-for-pi`: exit 0, `"status": "revision_required"`, `"route": "grill-to-spec"`.
- `resolve --item 261028-1700-interactive-html-widgets-for-pi --status planned`: exit 5, `ERROR: item ... has status 'revision_required'; expected one of ['planned']`.
- `resolve --status planned`: exit 3, `ERROR: no eligible active work item found`.

## Completion and handoff

On success, record changed paths, acceptance, check results, residual uncertainty, and the exact next slice (`02.02`). Update checkboxes and Current only in `implementation/index.md`. Stop for a user-controlled Git checkpoint and suggest Dream without invoking either.
