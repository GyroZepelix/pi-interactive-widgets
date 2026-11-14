# Wiki Log

Curated append-only timeline of durable wiki maintenance events. This is not a codebase changelog, commit log, or session transcript.

Use this shape for new entries:

- Heading: `## [YYYY-MM-DD] <kind> | <short title>`.
- Trigger: why the wiki was updated.
- Inputs: source paths, commit ranges, specs, verification, outcomes, URLs, or raw files used as evidence.
- Wiki pages changed: wiki files changed.
- Verification: checks or source verification.
- Notes: gaps, conflicts, stale areas, or exceptions.

## [2026-10-27] install | repo wiki template

- Trigger: user requested installation from `https://git.dgjalic.com/dgjalic/repo-wiki-template`.
- Inputs: protocol version 2.2.1/schema-2 payload from `https://git.dgjalic.com/dgjalic/repo-wiki-template/install/template/`.
- Wiki pages changed: `wiki/AGENTS.md`, `wiki/index.md`, `wiki/log.md`, `wiki/state.md`, `wiki/raw/README.md`.
- Verification: required files and managed regions exist; existing files were preserved or merged; protocol validation result was recorded. `uv run spec/scripts/manage-spec-item.py --root . validate --operational` passed (`valid: true`, warnings: []). Exhaustive `validate --all` passed (`valid: true`, warnings: []).
- Notes: installed payload may also create or merge root and spec files; initial codebase ingest is still needed.

## [2026-10-29] dream | Gamemaster checkpoint 261028-1700-interactive-html-widgets-for-pi/02.02

- Trigger: Dream run for "Gamemaster checkpoint: 261028-1700-interactive-html-widgets-for-pi/02.02".
- Inputs: current implementation session; `spec/archive/261028-1700-interactive-html-widgets-for-pi/` (implementation/02-02-lifecycle-acceptance.md, verification.md, refinements/R001.md); `src/component.ts`, `scripts/perf/lib.ts`, `tests/e2e/lib.ts`, `README.md`.
- Wiki pages changed: `wiki/terminal-graphics-tmux.md` (new), `wiki/observations.md` (new), `wiki/index.md`.
- Verification: re-read changed files, checked relative links, ran the memory safety scan, `git diff --check`.
- Notes: episode and per-spec ledger section recorded through their stable generic routes; architecture, module, and workflow pages remain TBD pending an initial codebase ingest.

## [2026-10-29] dream | Gamemaster checkpoint 261029-1116-widget-usage-guidance-and-check-widget/direct

- Trigger: Dream run for "Gamemaster checkpoint: 261029-1116-widget-usage-guidance-and-check-widget/direct".
- Inputs: current implementation session; `spec/archive/261029-1116-widget-usage-guidance-and-check-widget/` (plan.md, verification.md, outcome.md); `scripts/perf/lib.ts`, `tests/e2e/lib.ts`; `wiki/observations.md`.
- Wiki pages changed: `wiki/terminal-graphics-tmux.md` (promoted the dedicated tmux window observation into Test tooling), `wiki/observations.md` (promoted observation removed).
- Verification: re-read changed files, checked relative links, ran the memory safety scan, `git diff --check`.
- Notes: episode and per-spec ledger section recorded through their stable generic routes; no index or MEMORY.md change.

## [2026-10-29] dream | Gamemaster checkpoint 261029-1840-widget-input-fixes-and-rendering-polish/direct

- Trigger: Dream run for "Gamemaster checkpoint: 261029-1840-widget-input-fixes-and-rendering-polish/direct".
- Inputs: current implementation session; `spec/archive/261029-1840-widget-input-fixes-and-rendering-polish/` (plan.md Decision log, verification.md, outcome.md); `src/rawinput.ts`, `src/kitty.ts`, `tests/e2e/lib.ts`; Ghostty v1.4.0 `src/terminal/kitty/graphics_exec.zig`; pi-tui 1.4.0 `tui.js` and `tui-alt-screen.js`.
- Wiki pages changed: `wiki/terminal-graphics-tmux.md` (double-buffered frames, new "Pi mouse input" section, `locate` buffer ids, window re-check before harness runs, scope line).
- Verification: re-read changed files, checked relative links, ran the memory safety scan, `git diff --check`.
- Notes: episode and per-spec ledger section recorded through their stable generic routes; no index or MEMORY.md change; no observation added.

## [2026-10-29] dream | Gamemaster checkpoint 261029-2034-show-image-tool/direct

- Trigger: Dream run for "Gamemaster checkpoint: 261029-2034-show-image-tool/direct".
- Inputs: current implementation session; `spec/archive/261029-2034-show-image-tool/` (plan.md, verification.md, outcome.md, evidence/perf-disk.json); `src/image.ts`, `scripts/perf/run.ts`, `tests/e2e/lib.ts`; pi-tui 1.4.0 `terminal-image.js`.
- Wiki pages changed: `wiki/terminal-graphics-tmux.md` (new "Image payloads" section, scope line covers `show_image`, `locate` visible-pane limit).
- Verification: re-read changed files, checked relative links, ran the memory safety scan, `git diff --check`.
- Notes: episode and per-spec ledger section recorded through their stable generic routes; no index or MEMORY.md change; no observation added.

## [2026-11-12] research | CDP drag input and tmux output discards

- Trigger: Quick Plan for `261112-2105-widget-drag-input-and-blank-image-after-click-fix` produced reusable verified findings.
- Inputs: `src/page.ts`, `src/component.ts` at `757ef52`; throwaway `WidgetPage` drag probe; https://raw.githubusercontent.com/tmux/tmux/master/tty.c; `tmux list-clients` output; global pi-tui 1.5.2 `terminal-image.js`, `tui-alt-screen.js`, `tui.js` diffed against the 1.4.0 devDependency.
- Wiki pages changed: `wiki/research/drag-input-and-tmux-output-discards.md` (new), `wiki/index.md`.
- Verification: re-read changed files, checked relative links, `git diff --check`.
- Notes: tmux behavior read from master, not the installed 3.8 tag; the blank-image cause remains unconfirmed and is not recorded as current state.

## [2026-11-12] update | Blank widget images under tmux passthrough, CDP drag button

- Trigger: Implement T01 and T03 of `261112-2105-widget-drag-input-and-blank-image-after-click-fix` confirmed durable constraints.
- Inputs: tmux 3.8 `input.c`, `screen-write.c`, `tty.c`, `server-client.c` (https://raw.githubusercontent.com/tmux/tmux/3.8/); dev-log repro and user observations recorded in the item's `verification.md`; `src/page.ts`, `src/env.ts`.
- Wiki pages changed: `wiki/terminal-graphics-tmux.md` (passthrough drop under `allow-passthrough on`, CDP drag button), `wiki/research/drag-input-and-tmux-output-discards.md` (follow-up note), `wiki/index.md`.
- Verification: re-read changed files, checked relative links, `git diff --check`.
- Notes: the write that sets `PANE_REDRAW` in the repro was not isolated (a stale smaller second client was attached).

## [2026-11-12] dream | Gamemaster checkpoint 261112-2105-widget-drag-input-and-blank-image-after-click-fix/direct

- Trigger: `/dream` run after "Gamemaster checkpoint: 261112-2105-widget-drag-input-and-blank-image-after-click-fix/direct".
- Inputs: current implementation session; `spec/archive/261112-2105-widget-drag-input-and-blank-image-after-click-fix/` (plan.md, verification.md, outcome.md); `src/kitty.ts`, `src/manager.ts`, `tests/e2e/*.e2e.ts`; `wiki/terminal-graphics-tmux.md`.
- Wiki pages changed: `wiki/observations.md` (four new observations under "E2E and user-assisted checks" and "Widget image diagnostics"). The run's episode is discoverable through `wiki/dreams/episodes.jsonl`.
- Verification: re-read changed files, ran the metrics gate against the pre-write snapshot, ran memory safety scan, `git diff --check`.
- Notes: `wiki/terminal-graphics-tmux.md` is over the page word limit, so new findings went to observations; the AC03a scroll-out is already covered by the `locate` bullet and was not stored again.

## [2026-11-12] lint | Terminal graphics page corrections and splits

- Trigger: `/skill:wiki-lint` run with user-approved proposals L2, L3, L4, L5, L6.
- Inputs: wiki-lint report of this run, metrics summary before applying, `README.md` (passthrough section), `spec/archive/261112-2105-widget-drag-input-and-blank-image-after-click-fix/verification.md`, installed pi-tui 1.5.2 `dist/tui-alt-screen.js` and `dist/terminal-image.js`, `package.json`.
- Wiki pages changed: `wiki/terminal-graphics-tmux.md`.
- Disposition: SUPERSEDE `wiki/terminal-graphics-tmux.md` "Image data sent while the pane's window is hidden is dropped" - L2: qualified with `allow-passthrough on` and the untested `all` behavior, matching README and archived verification.
- Disposition: SUPERSEDE `wiki/terminal-graphics-tmux.md` "Pi 1.4.0 also disables its own image output" - L3: the behavior is unchanged in Pi 1.5.2, now the repository's devDependency.
- Disposition: MOVE `wiki/terminal-graphics-tmux.md` "Pi 1.4.0 enables only button-motion mouse tracking" - L3 and L4: moved to the renamed Mouse tracking and widget input section and labeled Pi 1.4.0 and 1.5.2.
- Disposition: SUPERSEDE `wiki/terminal-graphics-tmux.md` "`all` (`TTY_CTX_INVISIBLE_PANES`) bypasses both checks" - L5: verbatim split of the passthrough bullet into mechanism and configuration rule.
- Disposition: SUPERSEDE `wiki/terminal-graphics-tmux.md` "With `-e`, tmux emits a color only where it changes" - L6: verbatim split of the capture bullet; `locate` sentences got their own bullet.
- Disposition: SUPERSEDE `wiki/terminal-graphics-tmux.md` "Re-check the client's current window immediately before every harness run" - L6: verbatim split of the dedicated-window bullet; the re-check rule got its own bullet.
- Verification: metrics gate against the pre-apply snapshot, re-read of changed files, relative-link resolution, and `git diff --check`; results and before and after metrics are in the run report.
- Notes: L1 (visible-pane rule merge) not approved. Rejected: C1 title rewording, C2 and C3 rewordings (dropped conditions), C4 (made a Ghostty path look repo-local). M1 stays over 1200 words; moving Test tooling to its own page is a candidate for a later run.

## [2026-11-14] research | Cell-center clicks miss controls shorter than one cell

- Trigger: diagnosis of unclickable sliders in a learn-radio widget, then Quick Plan for `261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them`.
- Inputs: `src/component.ts` (`cellToCss`), `src/page.ts` (`baseCss`), learn-radio session log 2026-11-12 (widget HTML for `correlation` and `antenna-resonance`), throwaway `WidgetPage` probes at commit `d24679a`.
- Wiki pages changed: `wiki/research/cell-center-click-targets.md`, `wiki/index.md`.
- Verification: probe results reproduced the failing and working geometry. A layered `min-height` probe confirmed the planned fix direction.
- Notes: the fix is planned, not implemented. Current-state pages are unchanged until it lands.

## [2026-11-14] dream | Gamemaster checkpoint: cell-tall native controls (direct)

- Trigger: `/dream` run after Gamemaster checkpoint: 261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them/direct.
- Inputs: current conversation, `src/page.ts`, `src/manager.ts`, `tests/page.browser.test.ts`, `guide/widgets.md`, archived plan, verification, and outcome for `261114-2237-cell-tall-native-controls-so-cell-center-clicks-hit-them`.
- Wiki pages changed: `wiki/research/cell-center-click-targets.md` (new Current behavior bullet: the shipped one-cell floor for native controls). The run's episode is discoverable through `wiki/dreams/episodes.jsonl`.
- Verification: re-read changed files, ran the metrics gate against the pre-write snapshot, ran memory safety scan.
- Notes: the fix planned in the previous entry has landed. `wiki/terminal-graphics-tmux.md` is over 1200 words, so no input bullet or pointer was added there; the research page is already indexed. Admission is a one-session exception (observed stable contract), review pending.
