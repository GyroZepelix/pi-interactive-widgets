# Plan: Widget input fixes and rendering polish

Work item: `261029-1840-widget-input-fixes-and-rendering-polish`
Status: Planned
Created: 2026-10-29
Updated: 2026-10-29

Assurance: medium - changes the shared input path (focus, wheel, press routing) and the frame transport under the AC01/AC02 CPU budgets, and several outcomes need user visual confirmation; all local and reversible.

## Goal

Fix the three input defects the user hit in real use and polish rendering: a trackpad scroll over a widget must not grab focus (N2), a click outside a focused widget must release it (N3), and one click must hit a control in any widget state (N6); animating widgets must not flash (N1); widgets should blend into the terminal background (N5); and the guide should encourage clickable visual elements (N4).

## Context

- Input handoff: [2026-10-29-widget-followups-handoff.md](../../../wiki/raw/2026-10-29-widget-followups-handoff.md) (N1-N6 with source pointers). Governing archived contracts: [261028-1700 plan](../../archive/261028-1700-interactive-html-widgets-for-pi/plan.md) (RQ05, RQ06, RQ07, PD06, PD09) with [R001](../../archive/261028-1700-interactive-html-widgets-for-pi/refinements/R001.md), and [261029-1116 plan](../../archive/261029-1116-widget-usage-guidance-and-check-widget/plan.md) (guide, rubric QD03).
- N2 cause (verified in Pi 1.4.0 source): macOS trackpad scrolling emits horizontal wheel SGR codes 66 and 67. pi-tui `parseWheelEvent` accepts only vertical directions (`pi-tui/dist/tui-alt-screen.js` L774-L788), so these fall through to `handleMouseEvent`, which classifies them as a `press` (L707-L716; 66 decodes as a right button, 67 as `none`). The widget's press branch (`src/component.ts` L150-L158) then focuses and captures.
- N3: a press outside the widget box returns `undefined` (`src/component.ts` L151) and Pi only dispatches mouse events to the component under the pointer, so the widget never sees outside clicks. Pi exposes raw terminal input to extensions through `ctx.ui.onTerminalInput(handler)` (`pi-coding-agent` `extensions/types.d.ts` L82), but in fullscreen it never sees mouse sequences: `TuiAltScreen` registers its own viewport listener first (`pi-tui/dist/tui-alt-screen.js` L105) and consumes every wheel and SGR mouse sequence, `TUI.handleTerminalInput` stops at the first consume (`pi-tui/dist/tui.js` L719-L729), and extension listeners are appended after it (`interactive-mode.js` L2015, re-appended after a renderer change at L639-L648). See the Decision log.
- N6: a click on a closed or earlier-process widget calls `manager.revive` and returns without delivering the press (`src/component.ts` L135-L139). Live or frozen widgets queue the press after the thaw (`src/manager.ts` L479-L490); unverified in a real session.
- N1: every frame is re-uploaded to the same image id with `a=T` (`src/kitty.ts` L86-L97); placeholder rows encode the image id in their foreground color (L53-L56).
- N5: injected base CSS paints `body { background: var(--pi-bg, #1e1e2e) }` (`src/page.ts` L137); frames are opaque PNGs.
- Test tooling: run e2e, perf, and user visual checks in a dedicated visible tmux window ([terminal-graphics-tmux](../../../wiki/terminal-graphics-tmux.md)).

## Requirements

- RQ01 (N2) Horizontal wheel: SGR wheel codes with horizontal direction (button bits 64 plus direction 2 or 3, with any modifier bits) never focus, press, or wake a widget. Over a focused widget they scroll the page horizontally (`deltaX`); otherwise they are dropped. Vertical wheel keeps RQ05 behavior: unfocused scrolls the transcript, focused scrolls the page. Implemented through the raw input hook below, without toggling mouse modes.
  - Raw input hook (shared by RQ01 and RQ02; a workaround that relies on Pi internals, not a supported Pi API): the extension installs one raw input listener at the front of the TUI's internal `inputListeners` Set (a TypeScript-private field accessed at run time). Feature check: the field exists and is a Set. Install by rebuilding the Set in place (copy, clear, add ours, re-add the rest in their original order); never replace or patch any Pi function or file. Re-apply after a TUI or renderer change (for example a fullscreen mode switch) and remove it on shutdown. The listener matches only complete SGR mouse sequences: a horizontal wheel (bit 64 with direction 2 or 3, any modifier bits) is consumed, and a focused widget under the pointer gets `deltaX`, otherwise it is dropped; a press (neither bit 32 nor bit 64, final `M`) outside the focused widget's rows releases it (RQ02) and passes through unconsumed. Everything else passes through untouched.
  - Fallback when the feature check fails: no hook is installed; the widget component does not let a press with button `none` (code 67) or `right` (code 66) focus or press an unfocused widget, so N2 is mostly fixed; N3 stays open and the README documents that limitation. The fallback is testable (a unit test forces the check to fail).
- RQ02 (N3) Click outside: while a widget is focused, any mouse press outside that widget's rows releases it exactly like Escape (restore previous focus, freeze immediately, deliver queued `pi.send` data). The press itself still reaches Pi normally. A press on another widget makes that widget live and focused (PD06). Implemented through the raw input hook (RQ01), which observes the press without consuming it; mapping the press to widget rows uses the component's own rendered position. Without the hook (fallback) this requirement is not met and the README says so.
- RQ03 (N6) Single click: one click on a control of an unfocused widget activates that control in every state. Live and frozen: the waking press reaches the page (verify with a real SGR press in e2e on a fixture whose button acts on press and on click). Closed with a shown grid (a retained still): after the revived page finishes loading, replay the original press and release at the same CSS point. A row from an earlier process, or a closed widget without a retained still, keeps the archived RQ07 one-line placeholder: one click revives it without a replay (no control was clicked), and once the grid is shown a single click on a control reaches the page (the live path above).
- RQ04 (N1) No flashing: animating widgets show no visible blank between frames. First confirm the cause with a short diagnostic (for example frame upload timing versus Ghostty redraw, or swapping to a second id). Then implement double buffering: two image ids per widget, upload the next frame to the spare id, switch the placeholder rows to it, and delete the previous image after the switch. Scaled sends, recovery re-sends, `check_widget`, and the one-live-widget rule keep working. The AC01 and AC02 budgets must hold; if double buffering cannot meet AC02, stop and ask.
- RQ05 (N5) Background: first verify whether screencast PNG frames keep alpha with a transparent default background (`Emulation.setDefaultBackgroundColorOverride` alpha 0 and a transparent body). If yes, widgets render with a transparent page background so the terminal background shows through. If not, paint the page with the terminal's actual background color (from Pi's theme or a terminal background query). Regular-mode stills and `check_widget` images stay readable (for `check_widget`, composite onto the theme background if needed).
- RQ06 (N4 and N5 guide) `guide/widgets.md`: one or two sentences encouraging direct manipulation of visual elements (click a variant to highlight it, step a diagram by clicking it) while decisions stay keyboard-first (QD03); and background advice matching RQ05 (leave the page background unset; use theme variables for cards). README updated where behavior changes.

## Out of scope

- Toggling mouse modes or forcing `?1003h`; reporting the pi-tui horizontal-wheel issue upstream (external write).
- Kitty animation frames (`a=f`), shared memory, raw or zlib frames, or raising the 10 fps cap.
- Changes to the rubric, read tracking, lifecycle timers, network policy, or `show_widget` and `check_widget` parameters.
- New dependencies.

## Work breakdown

- [x] T01: Input fixes (N2, N3, N6)
  - Depends on: none
  - Scope: RQ01-RQ03.
  - Expected areas: `src/index.ts` (raw input hook install), a small hook module under `src/`, `src/component.ts`, `src/manager.ts`, `src/page.ts` (replay after load), `README.md`, `tests/component.test.ts`, `tests/manager.test.ts`, a hook unit test, `tests/e2e/`, `tests/fixtures/`.
  - Acceptance: AC01-AC03, AC02a.
  - Verification: `npm run typecheck`, `npm test`, `npm run test:browser`, `npm run test:e2e`, user trackpad check (AC07a).
- [x] T02: Double-buffered frames (N1)
  - Depends on: T01
  - Scope: RQ04.
  - Expected areas: `src/kitty.ts`, `src/manager.ts`, `src/component.ts`, `tests/kitty.test.ts`, `scripts/perf/`.
  - Acceptance: AC04.
  - Verification: unit, e2e, `npm run perf`, user visual check (AC07b).
- [x] T03: Background and guide (N5, N4)
  - Depends on: T02
  - Scope: RQ05, RQ06.
  - Expected areas: `src/page.ts`, `src/check.ts`, `guide/widgets.md`, `README.md`, tests.
  - Acceptance: AC05, AC06.
  - Verification: unit, browser, e2e, user visual check (AC07c).

## Acceptance criteria

- AC01 (RQ01): e2e sends SGR `64+2` and `64+3` sequences (with and without modifier bits) over an unfocused widget: no `live` or focus event, no page press, Pi focus unchanged; over a focused widget the page receives a horizontal wheel event. Vertical wheel e2e: unfocused scrolls the transcript (top line changes), focused scrolls the page.
- AC02 (RQ02): e2e focuses a widget, sends an SGR press on the transcript outside its rows: the widget emits `frozen`, the previous focus is restored, the hint returns to the unfocused text, and queued `pi.send` data is delivered with the next prompt. A press on a second widget makes it live and focused and freezes the first.
- AC02a (raw input hook): unit tests prove the feature check (missing or non-Set field fails), front-of-Set ordering with the other listeners kept in their original order, re-apply after a TUI change, removal on shutdown, and the fallback (forced check failure: no hook, codes 66 and 67 do not focus or press an unfocused widget); README notes that the hook relies on Pi internals and the fallback limitation.
- AC03 (RQ03): e2e with a single real SGR press and release: (a) on a frozen widget's button, the page-side log records the click once; (b) with more than 5 widgets so one is closed, a single click on the closed widget's button revives it and the page-side log of the new page records the click once; (c) for a widget from an earlier process after restart, the single click on its one-line row revives it and the new page records no press, and the next single click on its button once the grid is shown records the click exactly once.
- AC04 (RQ04): unit tests prove id alternation, deletion of the previous image after the switch, and correct ids in scaled and recovery re-sends; `npm run perf` keeps AC01 (frozen at most 0.5% browser CPU, unchanged page sends no frames) and AC02 (one animating widget at most about 40% of one core, marginal, median of 3) with both numbers recorded.
- AC05 (RQ05): the transparency spike result is recorded; a browser test proves the chosen background (alpha present in frames, or the configured terminal color); regular-mode still and `check_widget` image remain readable.
- AC06 (RQ06): the guide contains the interaction and background sentences; README updated; guide stays plain ASCII.
- AC07 (user visual, dedicated tmux window): (a) scrolling the transcript with the macOS trackpad across an unfocused widget never focuses it; clicking outside a focused widget releases it; one click hits a control on a frozen and on a closed widget; (b) an animating widget shows no flashing; (c) widgets blend into the terminal background.
- AC08: `npm run typecheck`, `npm test`, `npm run test:browser`, `npm run test:e2e`, and `npm run perf` pass; no chrome-headless-shell process started by the runs remains.

## Testing decisions and seams

- Unit: horizontal-wheel sequence classification (all modifier combinations), raw input hook feature check, ordering, re-apply, removal, and fallback, outside-press row mapping, replay queueing after revive, image id alternation and deletion.
- Browser: alpha in screencast frames, replay at a CSS point after load.
- E2E (stand-in model, `PI_WIDGETS_DEV=1`, dedicated tmux window): AC01-AC03; extend existing suites rather than adding a new harness.
- Perf: existing `npm run perf` active and idle phases.
- Manual: AC07 needs the user's real trackpad and eyes.

## Verification plan

- `npm run typecheck`
- `npm test`
- `npm run test:browser`
- `npm run test:e2e` (dedicated visible tmux window; close it afterwards)
- `npm run perf`
- Manual AC07a-c, recorded with the user's answers.
- After each run: no chrome-headless-shell process started by the run remains.
- Review: scoped checks per task and one final focused review over the whole change (medium assurance).

## Risks and blockers

- Confirmed in T01: `onTerminalInput` does not see mouse sequences in fullscreen (Decision log). The replacement raw input hook relies on a TypeScript-private pi-tui field and may break on a Pi update; the feature check then selects the fallback (N2 mostly fixed, N3 open, documented in the README).
- Double buffering re-renders all placeholder rows per frame (new id color), which may raise tmux and Ghostty CPU; measured by AC04, stop and ask if over budget.
- Screencast frames may drop alpha; fallback is the terminal background color (RQ05).
- Replaying a click into a freshly loaded page can race the page's own setup; replay after the load event plus the first frame.

## Decision log

- 2026-10-29, T01 stop point (1), direct amendment of RQ01 and RQ02 authorized by the user ("Hook Pi's internal listener, fall back to widget-only", relayed by Gamemaster).
  - Old contract: RQ01 and RQ02 implemented in the extension through the public `ctx.ui.onTerminalInput` (consume horizontal wheel; observe outside presses); stop and ask if mouse sequences do not reach it.
  - Evidence: `pi-tui/dist/tui-alt-screen.js` L105 registers the viewport listener in the `TuiAltScreen` constructor; `pi-tui/dist/tui.js` L719-L729 iterates `inputListeners` in insertion order and stops at the first `consume`; `handleViewportInput` consumes every wheel and SGR mouse sequence (L512-L531); `interactive-mode.js` L2015 appends extension listeners and L639-L648 re-appends them after a renderer change. Runtime probe (Pi 1.4.0 fullscreen, tmux 3.6b, dedicated window, stand-in model): an `onTerminalInput` handler received only typed keys and zero of six SGR sequences (`<0` press and release, `<64`, `<66`, `<67`, `<70`); a diagnostic listener forced to the front of the Set received all six.
  - New contract: a raw input listener installed at the front of the TUI's internal `inputListeners` Set with a feature check, in-place Set rebuild, re-apply after TUI changes, removal on shutdown, and no patched Pi functions or files; fallback without the hook keeps codes 66 and 67 from focusing or pressing an unfocused widget, leaves N3 open, and is documented (RQ01, RQ02, AC02a, Risks).
  - Affected work and evidence: none; no source change or check had run. RQ03-RQ06, the other stop points, assurance, and T01-T03 order are unchanged.
- 2026-10-29, T01, direct amendment of RQ03 and AC03(c) authorized by the user (option "Replay only on a shown grid", relayed by Gamemaster).
  - Old contract: RQ03 replayed the original press and release after revive for closed widgets and rows from an earlier process; AC03(c) expected a single click on an earlier-process widget's button to revive it and reach the new page once.
  - Evidence: a row from an earlier process renders only one line, the title with the `click to load` hint (`src/component.ts` `renderLines`, `if (!w) return [...]`, archived RQ07), and a closed widget without a retained still renders only its title lines (`w.closed && !w.image.retained`), so no grid, control, or CSS point exists for such a click.
  - New contract: replay only when the click lands on a shown grid (a closed widget with a retained still, AC03b); one-line rows revive on one click without a replay, and the next single click on the shown grid reaches the page; AC03(c) checks no press after the reviving click and exactly one click after the next click.
  - Affected work and evidence: none; T01 source work had not started. RQ01, RQ02, RQ04-RQ06, the stop points, assurance, and T01-T03 order are unchanged.

## Progress

- [x] Planning complete and confirmed.
- [x] Implementation complete (T01-T03).
- [x] Verification passed; see verification.md.

## Execution handoff

Use PI Agent in a fresh session with this prompt:

```text
Read spec/active/261029-1840-widget-input-fixes-and-rendering-polish/plan.md and item.yaml completely, plus AGENTS.md, spec/AGENTS.md, and wiki/terminal-graphics-tmux.md.
Implement T01, then T02, then T03 as the smallest coherent changes satisfying RQ01-RQ06 and AC01-AC08, preserving Out of scope. Assurance is medium: run task checks after each task and one final focused review.
Run e2e, perf, and user visual checks in a dedicated visible tmux window; ask the user for AC07 checks.
Record only verified evidence, failures, skipped checks, and residual uncertainty.
Stop and ask before dependencies, migrations, destructive operations, external writes, commits, pushes, or scope expansion, and at the stop points named in RQ04 and Risks.
```
