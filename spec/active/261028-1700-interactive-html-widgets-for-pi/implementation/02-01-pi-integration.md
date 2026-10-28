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

## Completion and handoff

On success, record changed paths, acceptance, check results, residual uncertainty, and the exact next slice (`02.02`). Update checkboxes and Current only in `implementation/index.md`. Stop for a user-controlled Git checkpoint and suggest Dream without invoking either.
