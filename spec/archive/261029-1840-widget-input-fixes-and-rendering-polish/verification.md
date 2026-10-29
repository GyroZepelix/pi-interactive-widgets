# Verification: Widget input fixes and rendering polish

Work item: `261029-1840-widget-input-fixes-and-rendering-polish`
Date: 2026-10-29

## Environment

- Mode: direct (T01, T02, T03 in order). Assurance: medium (inherited from plan.md: shared input path and frame transport under the AC01/AC02 CPU budgets, user visual checks, local and reversible).
- Starting boundary: HEAD `a396431`, nothing staged; planning artifacts `spec/index.md`, this item folder, and `wiki/raw/2026-10-29-widget-followups-handoff.md` (not edited). `wiki/raw/2026-10-27-poc-handoff.md` unchanged (blob `43aefcf`).
- macOS arm64, Ghostty 1.4.0, tmux 3.6b, Pi 1.4.0 (dev dependency), chrome-headless-shell from the puppeteer cache. No new dependencies.
- Plan amendments during implementation (both user-authorized direct amendments, recorded in the plan Decision log): RQ01/RQ02 raw input hook (stop point 1: `onTerminalInput` never sees mouse sequences in fullscreen), and RQ03/AC03(c) replay only on a shown grid.

## Changed paths

- New: `src/rawinput.ts` (SGR parsing, feature check, front-of-Set install, `RawInputHook`), `tests/rawinput.test.ts`, `tests/fixtures/e2e-click.html`.
- Modified: `src/manager.ts` (hook attach and re-apply, horizontal wheel, outside-press release, `focusTarget`, revive replay, two image ids per widget with render on switch, transparent pages, `check_widget` flattening), `src/component.ts` (row anchor and `cssAtScreen`, press reporting, fallback filter for codes 66/67, replay point, rows from `image.lines`), `src/index.ts` (`manager.attach`), `src/kitty.ts` (double-buffered `KittyImage`, `RETIRE_DELAY_MS`), `src/page.ts` (`transparent` option, `DEFAULT_PAGE_BG`, default background override), `src/png.ts` (`flattenPng`), `scripts/harness.ts` (double-buffered, transparent), `scripts/perf/run.ts` (deletes both ids), `guide/widgets.md`, `README.md`, `tests/component.test.ts`, `tests/kitty.test.ts`, `tests/guidance.test.ts`, `tests/page.test.ts`, `tests/page.browser.test.ts`, `tests/e2e/lib.ts` (locates either buffer id), `tests/e2e/widgets.e2e.ts`, `tests/e2e/lifecycle.e2e.ts`.

## Commands and checks

| Check | Result | Evidence |
| --- | --- | --- |
| RQ02 stop-point probe | `onTerminalInput` saw 0 of 6 SGR sequences; a listener at the front of `inputListeners` saw all 6 | plan Decision log |
| `npm run typecheck` | pass | `evidence/final-typecheck.log` |
| `npm test` | pass, 170/170 | `evidence/final-unit.log` (T01: `t01-unit.log` 162/162) |
| `npm run test:browser` | pass, 30/30 | `evidence/final-browser.log` (T01: `t01-browser.log` 29/29) |
| `npm run test:e2e` | pass, 27/27 (T01 and T02 runs in dedicated window 6 `piw-impl`; final run see Failures) | `evidence/t01-e2e.log`, `evidence/t02-e2e.log`, `evidence/final-e2e.log` |
| `npm run perf` (T02) | pass; AC02 median marginal 37.4% (runs 37.4, 37.4, 37.57), total 39.89%, 8.6 fps; HEAD baseline in the same session 34.41% | `evidence/t02-perf.json`, `evidence/t02-perf-head-baseline.json` |
| `npm run perf` (final, after T03) | pass; AC01 frozen browser 0.1% CPU, unchanged page 0 frames, thaw frame; AC02 median marginal 31.05% (runs 23.34, 31.05, 31.69), total 42.41%; input 18/18 and 60/60; disk phase pass; no browser pid left | `evidence/final-perf.json` |
| RQ04 diagnostic | Ghostty v1.4.0 `graphics_exec.zig` `loadAndAddImage`: reusing an image id deletes the old image and its placements when the new transmission begins; anim fixture frames about 27 KB base64 in 7 chunks, node-ring fixture about 1.1 MB in about 292 chunks | `evidence/t02-diagnostic-frames.json`, `evidence/t02-diagnostic-frames.mts.txt` |
| Pi CPU, focused animating widget (informational) | Pi process 1.7% (new) vs 1.5% (HEAD) over 10 s | `evidence/t02-pi-cpu-new.json`, `evidence/t02-pi-cpu-head.json` |
| RQ05 spike | default frame RGB; with `setDefaultBackgroundColorOverride` alpha 0 frames and screenshots are RGBA with transparent pixels | `evidence/t03-alpha-spike.txt` |
| Leftover Chromium | none after every run (`pgrep -fl chrome-headless-shell` empty) | command output |
| ASCII and fences | `guide/widgets.md` plain ASCII, 106 lines, fences balanced (unit test); plan ASCII | `tests/guidance.test.ts` |

## Requirement coverage

| Requirement | Evidence | Status |
| --- | --- | --- |
| AC01 (RQ01) | unit: codes 66/67 with all 8 modifier combinations classified; consumed and dropped when unfocused; focused widget under the pointer gets `deltaX` with CDP modifiers. e2e: 66, 67, 70, 75, 82, 95 over a frozen unfocused widget give no `live`, `focus`, page press, or wheel, hint unchanged, keys reach the editor; vertical wheel scrolls the transcript (top line changes) without focus; focused widget: page receives `[1,0]`, `[-1,0]`, `[0,1]` and the transcript does not scroll | pass |
| AC02 (RQ02) | e2e: press on the transcript outside the focused widget logs `outside-press`, `release`, `frozen` within 1 s, `deliver` nextTurn, hint returns to "click to interact", queued `{"down":1}` arrives with the next prompt; press on a second widget focuses it (page click once), releases and freezes the first through Pi's focus change, and Escape restores the editor, not the first widget | pass |
| AC02a | unit: feature check (missing, non-Set, throwing getter), front-of-Set order with others kept, ahead of a consuming viewport listener, re-apply after a renderer change (old Set left), removal on shutdown, handler errors swallowed, forced check failure installs nothing; component fallback: right/none presses do not focus, press, or revive an unfocused widget. README documents the private field and the fallback limitation | pass |
| AC03 (RQ03, as amended) | e2e (a) single click on a frozen widget's button: page click count +1 exactly; (b) 6 widgets, LRU-closed widget: single click revives it warm, `replay` logged, new page saw exactly `[{down:1},{click:1}]`; (c) restart with continued session: reviving click on the one-line row records nothing, no `replay`; the next single click on the shown grid records exactly one press and one click. unit: replay point on a still, none on the title line or one-line row | pass |
| AC04 (RQ04) | unit (`tests/kitty.test.ts`): id alternation, never uploading to the shown id while a switch is pending, delayed delete of the previous image after the switch and not when reused, scaled and recovery re-sends to the shown id without a switch, delete removes both. perf AC01 and AC02 hold (above, numbers recorded) | pass |
| AC05 (RQ05) | spike recorded; browser: transparent page frame is RGBA with alpha 0 where unpainted and opaque painted elements, default page opaque `#1e1e2e`, flattened capture opaque; unit: `flattenPng` compositing, `check_widget` live capture and still flattened onto `#1e1e2e`, `baseCss` transparent vs opaque. Light Pi themes keep the opaque page (light text). Regular-mode still readable (AC07c) | pass |
| AC06 (RQ06) | unit: guide contains the interaction sentences (click a variant to highlight or enlarge it; decisions stay in text or `ask_user_question`) and the background advice; plain ASCII. README updated (single click, replay, sideways scroll, raw input hook, background, double buffering, limits) | pass |
| AC07a | user, window 6, macOS trackpad: scrolling over unfocused widgets never focused or woke one; click outside released (dev log `outside-press`); one click hit a frozen widget's button and a closed widget's button (dev log `replay`) | pass (`evidence/t01-ac07a-devlog.txt`) |
| AC07b | user, blind side-by-side, window 6: LEFT = old build (HEAD via `git archive`), RIGHT = new build. Round 1, rotating square (`tests/fixtures/anim.html`): no flashing in either pane, inconclusive; unprompted note "the left one seems to sometimes blink in and out" (old build). Round 2, node ring (24 nodes, lines, gradients, text; about 1.1 MB frames): old "terribly flashes", new no flashing | pass (`evidence/t02-ac07b.md`, `evidence/ac07b-node-ring-fixture.html`) |
| AC07c | user, window 6, new build: fullscreen widgets and regular-mode stills blend into the terminal background with no visible box; text crisp; click still works and releases | pass (`evidence/t03-ac07c-devlog.txt`, `evidence/ac07c-blend-fixture.html`) |
| AC08 | typecheck, unit, browser, e2e, perf all pass; no chrome-headless-shell left | pass |

## Review findings

- Final contract-quality review (medium assurance, one independent read-only reviewer): PASS, no blocking findings, 0 retries. It re-ran typecheck and unit tests.
- Non-blocking: the horizontal wheel over a focused widget uses the row origin from the last mouse event Pi dispatched to that row (corrected by `viewportTop` for transcript scrolling). After a resize or reflow, a sideways scroll may be dropped or land on a stale point until the next mouse event on that row. Not fixed (missed horizontal scroll only); possible follow-up.

## Failures and skipped checks

- Deviation: the final `npm run test:e2e` and `npm run perf` (after T03) ran while the attached client was on the user's window 4, not the dedicated window 6. The harness splits followed the client's current pane, so the user's pane there was split and resized temporarily for about 15 minutes. All runs passed, nothing was left behind (checked by Gamemaster), and the user accepted the results without a rerun.
- AC07b round 1 was inconclusive (fixture too small to show the old flashing); round 2 with a richer fixture is the evidence.

## Unverified areas

- The raw input hook depends on pi-tui's private `inputListeners` field (Pi 1.4.0); a Pi update may remove it, which selects the documented fallback.
- Scaled and recovery re-sends still re-upload to the shown id and can show one brief blank (by design, so rows already written in regular-mode scrollback stay valid).
- Transparency is disabled when Pi's theme appearance is light; not checked visually with a light theme.
- Plain Ghostty without tmux and kitty as a client were not exercised.
