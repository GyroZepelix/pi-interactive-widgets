# Verification: Widget usage guidance and check_widget

Work item: `261029-1116-widget-usage-guidance-and-check-widget`
Date: 2026-10-29

## Environment

- Mode: direct (T01). Assurance: low (inherited from plan.md: prompts, one read-only tool, and docs; reversible; rendering pipeline untouched).
- Starting boundary: HEAD `c9f47ba`, nothing staged; workflow-owned planning artifacts `spec/index.md` and this item folder. `wiki/raw/2026-10-27-poc-handoff.md` unchanged (blob `43aefcf`).
- macOS, Node 22, Pi 1.4.0 dev dependency, chrome-headless-shell 156.0.8078.47, tmux with Ghostty client.
- No new dependencies. Image downscaling is dependency-free: Chromium `Page.captureScreenshot` with `clip.scale` for open pages, and a small Node `zlib` PNG decode, box downscale, and encode (`src/png.ts`) for closed-widget stills.

## Changed paths

- New: `guide/widgets.md`, `src/check.ts`, `src/guide.ts`, `src/png.ts`, `src/prompts.ts`, `tests/guidance.test.ts`, `tests/check.browser.test.ts`, `tests/e2e/guidance.e2e.ts`, `tests/fixtures/check-clean.html`, `tests/fixtures/check-overflow.html`, `tests/eval/widget-usage.md`.
- Modified: `src/index.ts` (minimal description, `promptGuidelines`, `check_widget`, read tracking, pointer line), `src/manager.ts` (`check`), `src/page.ts` (`capture`, `inspect`), `src/kitty.ts` (`still` getter), `package.json` (`files` adds `guide`), `README.md`, `tests/e2e/lib.ts` (Turn type gains `toolName`, `customType`), `tests/e2e/probe-extension.ts` (`e2e-call <tool> <json>`).

## Commands and checks

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | pass | `evidence/typecheck.log` |
| `npm test` | pass, 138/138 (22 new in `tests/guidance.test.ts`) | `evidence/unit.log` |
| `npm run test:browser` | pass, 29/29 (5 new in `tests/check.browser.test.ts`) | `evidence/browser.log` |
| `npm run test:e2e` | pass, 22/22 (2 new in `tests/e2e/guidance.e2e.ts`), run from a dedicated visible tmux window 6 "piw-e2e" created and closed by this run | `evidence/e2e.log` |
| Leftover Chromium | none (`pgrep -f chrome-headless-shell` empty after every run) | command output |
| ASCII and fences | `guide/widgets.md`, `tests/eval/widget-usage.md`, new sources: no non-ASCII bytes; fences balanced (unit test) | `perl` scan, `tests/guidance.test.ts` |
| Description size | 112 words (about 146 tokens by words x 1.3; about 204 by chars / 4), includes the guide path | `tests/guidance.test.ts` |
| Manual AC07 eval | pass, 14/14 (user-run, real model) | user report via Gamemaster, 2026-10-29 |

## Requirement coverage

| Requirement | Evidence | Status |
| --- | --- | --- |
| AC01 (RQ01, RQ02) | unit: description at most about 250 tokens, contains `GUIDE_PATH` and the required essentials; 4 `promptGuidelines` bullets incl. "not for approvals or choosing among options"; `show_widget` name and parameters unchanged (fake `ExtensionAPI` registration) | pass |
| AC02 (RQ03) | unit: `guide/widgets.md` exists, in `package.json` `files`, plain ASCII, 105 lines, covers every topic removed from the old description plus use/do-not-use examples, "show, then ask", and a check_widget section | pass |
| AC03 (RQ04) | unit: relative, relative-from-other-cwd, absolute, `~`, `@`, and symlink reads mark; other paths, failed reads, and malformed input do not; reset clears. e2e: pointer is the last line of a `show_widget` result before the guide read and absent after `read guide/widgets.md` | pass |
| AC04 (RQ05) | browser: live and frozen captures 1000x425 from 720x306 CSS at DPR 2; frozen page stays frozen and minimized, casts no frames, not focused; capture content non-blank. unit: manager check on frozen (no thaw, LRU unchanged), closed (RAM still, no revive, no page parts), unknown id, no image. e2e: live, frozen, closed checks at 1000x425 with no `live`, `focus`, `revive`, or `revived` events; unknown id text-only error | pass |
| AC05 (RQ05) | browser: overflow fixture lists `span#wide` clipped by `div.box (overflow: hidden)` and `div#tall` beyond the viewport, scroll 720x624 vs 720x306; clean fixture with an `overflow: auto` log reports none and scroll equal to viewport. unit: report formatting | pass |
| AC06 (RQ06) | README "Agent guidance" section covers the guide file, rubric, read tracking, and `check_widget` | pass |
| AC07 (RQ01-RQ05) | user ran `tests/eval/widget-usage.md` once: "All 14 ok". Guide read timing: not reported | pass (14/14) |

## Review findings

- Completion review (low assurance, one gate, independent read-only reviewer): PASS, no blocking and no non-blocking findings. Retries: 0.

## User observations from the AC07 session (out of scope, not fixed here)

1. An animating widget (the consistent-hashing ring) visibly flashes while it animates. Request: double-buffered frames, for example alternating two image ids per widget so the old image stays visible while the new one uploads.
2. Wheel scrolling over an unfocused widget focuses it and blocks transcript scrolling. Expected per the archived item's RQ05: a wheel over an unfocused widget scrolls the transcript; only a focused widget receives wheel events. Possible regression against the archived item.
3. Clicking outside a focused widget should release it. The archived PD09/RD2 says a click elsewhere releases; the user observed otherwise or wants it ensured. Possible defect; verify in a follow-up.
4. Design suggestion: generated widgets mostly change state through a single button; more of a widget could be interactive (for example clicking a spacing option in the tight/normal/airy comparison). User unsure; guide wording to consider later.
5. Design suggestion: widgets default to a dark black or blue box background; consider a transparent or Pi-theme background so cards blend into the terminal.

## Failures and skipped checks

- First e2e attempt from the agent's own 62x54 pane: the pre-existing 80x24 suites could not split (`pane too small`). Resolved per user decision by a dedicated visible tmux window; the harness size requirements were not changed. The new guidance e2e requests a 60x24 split because it reads only results and dev events.

## Unverified areas

- Reads through tools other than `read` (for example `bash cat`, nested codemode reads without `tool_result`) are not detected; accepted plan assumption.
- AC07 guide-read timing was not reported by the user.
- Pi may draw the `check_widget` image inline in terminals where its own image support is active (outside tmux); not exercised.
