# Outcome: Interactive HTML widgets for Pi

Work item: `261028-1700-interactive-html-widgets-for-pi`
Disposition: completed
Date: 2026-10-29

## Delivered scope

- Pi extension `pi-interactive-widgets` (`src/`, `pi.extensions: ["./src/index.ts"]`): `show_widget` with `html` or `path`, rendered by one lazily launched chrome-headless-shell per session and streamed as kitty graphics with Unicode placeholders, interactive in place in Pi fullscreen.
- Run-time policy: one live widget; click-to-wake under tmux and hover-to-wake where the terminal reports motion (PD09); release freezes; 10 s idle from creation or last hover move; focused freeze after 5 min without input; freezing by window minimize.
- Lifecycle: at most 5 pages (LRU frozen page closes first), 30 min frozen close, browser exit at 0 pages, revive on click with fresh JS state (inline from tool args, path from the current file, `source file missing: <path>`), placeholder line for rows from an earlier process.
- Bridge (`pi.send`, `pi.submit`), synthetic-origin serving with path confinement, CSP and network policy, regular-mode still, environment detection and notices, config, dev entry and dev-only timers.
- Scaled display and mouse mapping in narrow panes; re-sends after resize, plain-Ghostty full redraws, clicks, and `/widgets-refresh`; cleanup on shutdown, reload, and `kill -9`.
- `README.md`, unit, browser, e2e, and perf suites, manual-check launcher.

## Deviations from plan

- None to the contract. Implementation details recorded in the plan Decision Log (PD08) and `implementation/index.md` Discoveries: no loopback fallback (U1 passed); LNA grant for listed local hosts; the grid never uses the last terminal column (tmux drops placeholder diacritics there); 02.01 frozen and replaced by 02.03 (R001, PD09).
- AC02: judged on the widget's marginal cost (absolute total minus a same-run no-widget tmux and Ghostty baseline), per the 01.02 Gamemaster decision; absolute totals are recorded in verification.md.
- AC04: Chromium's temporary profile receives two delayed housekeeping writes after launch (49 B at +60 s, 152 B at +120 s); the user accepted this as satisfying AC04 under the plan Assumption on profile writes.

## Verification summary

See [verification.md](./verification.md): typecheck clean; unit 116/116; browser 24/24; e2e 20/20; perf pass (AC01 0% frozen, AC02 median marginal 28.45%, AC04 no image files); manual AC12, AC13, AC14 user-confirmed; focused T02 review PASS and final contract-quality review PASS (non-blocking findings only).

## Retained, reverted, or transferred work

- Retained: all source, tests, scripts, and README. Slice 02.02 is uncommitted on `580ee78`, awaiting a user-controlled Git checkpoint.
- Frozen 02.01 attempt retained as history; its work continued in 02.03.

## Residual risks

- Images sent while the widget's tmux window is hidden are dropped by tmux; no window-switch detection (by decision); a click on an unfocused widget or `/widgets-refresh` restores them.
- `kill -9` of Pi leaves the puppeteer temp profile folder in `$TMPDIR`.
- A focused widget's 30 min close timer restarts at release; overlapping create or revive calls can briefly exceed 5 pages.
- Pi internals (TUI factory probe, tool-row `y - 1`, mouse tracking under multiplexers) may change with Pi upgrades; Chromium behavior verified on chrome-headless-shell 156 only.
- In-Pi `/resume` and kitty as tmux client are not separately tested.

## Follow-up work items

- Optional: reserve a page slot before async opens; keep the frozen-close deadline across focus; clear load-time blocked requests queued by a revived page.
- Wiki updates proposed in the plan (architecture, terminal-graphics and Chromium findings, PoC handoff ingest).

## Source references

- [plan.md](./plan.md), [verification.md](./verification.md), [implementation/index.md](./implementation/index.md), [refinements/R001.md](./refinements/R001.md), [discovery.md](./discovery.md).

## Wiki updates

- None in this run (Dream and wiki ingest are user-controlled follow-ups).
