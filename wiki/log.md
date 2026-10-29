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
