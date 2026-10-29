# Verification: Interactive HTML widgets for Pi

Work item: `261028-1700-interactive-html-widgets-for-pi`
Date: 2026-10-29

## Environment

- macOS arm64, Ghostty 1.4.0, tmux 3.6b (`allow-passthrough on`), Pi 1.4.0 (`tuiMode: fullscreen`), chrome-headless-shell 156 under `~/.cache/puppeteer/`, Node via `tsx`.
- Assurance: medium (personal single-user setup, reversible local extension, KISS preference; D4).
- Mode: sliced. Slices 01.01 (`22eed8a`), 01.02 (`8f8396c`), 02.03 (`580ee78`, replacing frozen 02.01 under R001/PD09), 02.02 (uncommitted on `580ee78`). Slice evidence: `implementation/*.md` Completion evidence sections.
- E2E and perf ran real Pi with `PI_WIDGETS_DEV=1`, `-e ./src/index.ts`, an isolated `PI_CODING_AGENT_DIR`, and the offline faux model (`tests/e2e/probe-extension.ts`) in temporary visible tmux splits (or a temporary own window for manual checks), always closed afterwards. No package install into the user's Pi settings.

## Commands and checks

Final tree (02.02 working tree on `580ee78`):

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | exit 0 | also re-run by both reviewers |
| `npm test` | 116/116 pass | unit: kitty, env, keys, policy, bridge, config, component (scaling, last column, revive rows), manager (fake clock: idle, focused 5 min, close 30 min, LRU, re-sends, shutdown, dev timers) |
| `npm run test:browser` | 24/24 pass | incl. two pages with distinct window ids, unreadable entry counts as missing |
| `npm run test:e2e` | 20/20 pass | `tests/e2e/widgets.e2e.ts` (02.03 scope) and `tests/e2e/lifecycle.e2e.ts` (02.02 scope) |
| `npm run perf` | pass | input 18/18 and 60/60; AC01 frozen browser CPU 0%, unchanged live page 0 frames, thaw frame; AC02 median marginal 28.45% of one core (total 36.72%), 8.6 fps; AC04 disk phase |
| No leftover chrome-headless-shell | pass | `pgrep` 0 after every run; `browserPidsLeft: []` |
| Frozen history byte-identical | pass | shasum of 01.01, 01.02, 02.01, 02.03 packets, `refinements/R001.md`, `discovery.md`, `research/`, and `wiki/raw/2026-10-27-poc-handoff.md` (blob `43aefcf`) |

## Requirement coverage

| Requirement | Evidence | Status |
| --- | --- | --- |
| AC01 Idle | perf: frozen animating page 0-0.1% browser CPU over 10 s, 0 frames; unchanged live page 0 frames in 5 s | Pass |
| AC02 Active | perf: median marginal 28.45% (runs 30.04, 28.45, 27.55) across browser tree, harness, tmux, Ghostty (marginal per the 01.02 Gamemaster decision) | Pass |
| AC03 Lifecycle | e2e: never more than 5 pages, LRU frozen page closes; dev-shortened frozen close; browser exits at 0 pages; `kill -9` of Pi leaves no Chromium it started; unit LRU and 30 min fake clock | Pass |
| AC04 Disk | perf disk phase: 60 s Pi session with a live animating widget; no image file (name or magic bytes) in the Chromium profile, agent dir, repo, or `$TMPDIR`; profile writes after launch: `Default/Local Storage/leveldb/000003.log` 49 B at about +60 s and (150 s watch) `Default/shared_proto_db/000003.log` 152 B at +120 s, Chrome leveldb housekeeping, not page data. The user explicitly accepted these as satisfying AC04 under the plan Assumption that the profile "may receive small writes; only frame and still files are forbidden" | Pass (user-accepted write pattern) |
| AC05 Input | e2e 18/18 and 60-click burst, typed keys, Escape, ctrl+u/ctrl+d while focused | Pass |
| AC06 Freeze and thaw | e2e: click wake 4 ms to first frame and press reaches the page; release freezes in 1 ms; idle freeze 1.5 s after creation (dev 1.5 s); focused freeze 2.4 s after last input (dev 2.5 s) keeping focus, a key wakes; B live freezes A; unit fake clock for 10 s and 5 min; manual plain-Ghostty hover wake | Pass |
| AC07 Revive | e2e: warm revive 42 ms, cold 120-146 ms; inline from tool args; path from the current file; deleted file shows `source file missing: <path>` with the still; restart with `-c` shows the placeholder line then revives; `/reload` likewise | Pass |
| AC08 Bridge | e2e (02.03 scope, rerun) | Pass |
| AC09 Network | browser tests (01.01, rerun) | Pass |
| AC10 Path scope | browser tests (rerun) | Pass |
| AC11 Modes | e2e (rerun) plus 02.03 user visual | Pass |
| AC12 Narrow terminal | e2e 60x9 shown as 40x6 at 41 columns, 18/18 scaled hits, full size after widening; manual (user-confirmed) at 45 columns incl. closed and revived widgets, right edge complete, page-log hits 0/9/17, widening restores | Pass |
| AC13 Recovery | e2e: resize re-sends every retained still; `/widgets-refresh` re-sends all; manual (user-confirmed): reattach from a new Ghostty window (extension resize re-sends fired: 99x34, 319x79), then `/widgets-refresh` correct | Pass |
| AC14 Environments | tmux + Ghostty throughout; e2e unsupported notice; manual plain Ghostty (user-confirmed, via `tests/e2e/plain-ghostty.sh`): render, "hover or click" hint, hover wakes without click, clicks 0/17/9, narrow and wide resize (dev log: resize re-sends, scaled display down to 11 columns and back to 90x18) | Pass |
| AC15 Failures | e2e invalid config and missing Chromium notices | Pass |
| AC16 Quality | all checks above; tool description and `README.md` cover usage, config, limits, click-to-interact under tmux, advice against hover-dependent UI, IPv6 allowHosts limit | Pass |

## Review findings

- T01 segment review: passed (see `implementation/index.md` Discoveries).
- Focused final-segment review over T02 (02.03 with frozen 02.01, plus 02.02): PASS. The first dispatch ended without an output block and was resumed to completion; no correction cycle, no re-review counted.
- Final contract-quality review over the whole change: PASS.
- Non-blocking (not fixed, recorded): a focused widget's 30 min close timer restarts at release; overlapping create or revive calls can briefly exceed 5 pages; a press on an already focused live widget does not re-send its still (README wording narrowed accordingly). A reviewer note that load-time blocked requests are also queued for the next `pi.send` does not apply to `create()` (the widget does not exist yet during load, so nothing is queued); it applies only to requests blocked while a revived page loads, which are not reported elsewhere.

## Failures and skipped checks

- Fixed during 02.02: AC12 manual check found the right-most image column blank under tmux (placeholder diacritics lost in the last terminal column); fixed with `maxGridCols` and a unit test, then user-confirmed.
- Fixed in test tooling: `capture-pane` row indexes were off by one when the pane's top line was blank (`tmux()` trimmed it); captures now use `tmuxLines()`.
- Not a defect: the first AC12 visual attempt opened `visual.html` at a size smaller than its fixed design; the first AC14 attempt reported "not loaded" (Pi lists the extension as `src`); neither reproduced.
- Skipped: none.

## Unverified areas

- In-Pi `/resume` and `/fork` share the `session_shutdown`/`session_start` path covered by the restart (`-c`) and `/reload` e2e; no dedicated e2e.
- kitty as the tmux client terminal (allowed, untested by plan).
- `kill -9` of Pi leaves the puppeteer temp profile folder (`$TMPDIR/puppeteer_dev_chrome_profile-*`, about 2 MB); documented in the README.
- Images sent while the widget's tmux window is hidden are dropped by tmux; the extension does not detect window switches (by decision); a click on an unfocused widget or `/widgets-refresh` restores them (README).
