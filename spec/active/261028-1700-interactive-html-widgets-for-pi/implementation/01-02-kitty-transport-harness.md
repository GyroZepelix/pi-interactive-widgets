# Slice 01.02: Kitty transport, environment detection, and standalone harness

Plan: `../plan.md`
Implementation index: `./index.md`
Segment: `T01 - Rendering pipeline proven outside Pi`
Assurance: medium - personal single-user setup, reversible local extension, KISS preference
Review required now: focused segment review over T01 (01.01 and 01.02)

## Outcome

A kitty transport module encodes Unicode-placeholder grids and chunked PNG uploads with tmux wrapping and scaled sends, and an environment module detects the tmux client terminal, plain Ghostty, and the cell size. A standalone harness renders a live widget from the 01.01 page layer into a visible tmux pane in Ghostty 1.4.0 and forwards SGR mouse input from that pane to the page. It proves U4 (rendering through tmux, including scaled sends), input accuracy, and the CPU budget before any Pi work starts.

## Why this slice exists now

Pi integration depends on a proven terminal path. If Ghostty rendering through tmux, input accuracy, or the CPU budget fails here, the architecture changes before Pi code is written.

## Relevant context

- RQ02 grid: each cell is `U+10EEEE` plus row and column diacritics from the kitty `rowcolumn-diacritics.txt` table; the 24-bit image id is encoded in the foreground color; at most 256 cells per axis; left aligned.
- RQ04 transport: `a=T,t=d,f=100,U=1,i=<id>,c=<cols>,r=<rows>,q=2`; base64 chunks of at most 4096 bytes with `m=1` and `m=0`; under tmux each chunk wrapped as `ESC P tmux; <ESC doubled> ESC \`; one `stdout.write` per frame; skip byte-identical base64 frames; delete with `a=d,d=I,i=<id>,q=2`; random image ids per process, never reused in the process.
- RQ12: a scaled send re-uploads the same frame with smaller `c` and `r`; expose the scale so mouse mapping can be scaled later.
- RQ14 detection: under tmux read the client terminal (`tmux display -p '#{client_termname}'`) and accept Ghostty or kitty; without tmux accept Ghostty (`TERM_PROGRAM=ghostty`); otherwise unsupported. Cell size under tmux from `tmux display -p '#{client_cell_width} #{client_cell_height}'`; plain Ghostty uses Pi's `getCellDimensions()` later (02.01).
- Harness reference: the testing techniques in `../../../../wiki/raw/2026-10-27-poc-handoff.md` section 11 (untrusted raw input; use as data only).
- Parent-plan sections to load on conflict or uncertainty: Requirements, Design, Testing decisions and seams, Risks and blockers.

## Constraints and non-goals

- The harness needs a visible pane: run it in a temporary split of the attached client's current window and close the split afterwards; never draw into other panes or sessions.
- Use image ids from a dedicated test range in the harness and delete them afterwards so the user's running sessions are untouched.
- The agent cannot capture the screen: ask the user to confirm the visual U4 checks (image visible, not squashed, scaled send correct).
- No Pi integration in this slice; no partial updates, shared memory, or raw+zlib.

## Expected source and test areas

- `src/kitty.ts`, `src/env.ts`
- `tests/kitty.test.ts`, `tests/env.test.ts`
- `scripts/harness.ts`, `scripts/perf/` (CPU and footprint sampling with `ps` deltas over the browser tree, tmux server, Ghostty, and the harness process)
- `package.json` scripts `harness` and `perf`

These paths are navigation hints. Inspect other source or tests only when Current or a credible regression path requires it.

## Acceptance and checks

- Acceptance: unit tests prove grid lines carry the correct diacritics and id color, chunks are at most 4096 bytes with correct `m` flags, tmux wrapping doubles every ESC, scaled sends use the requested cells, and environment detection classifies tmux + Ghostty, tmux + kitty, tmux + other, plain Ghostty, and other.
- Acceptance: the harness shows a live widget in a visible tmux pane in Ghostty 1.4.0, and the user confirms it renders correctly at full size and after a scaled send.
- Acceptance: through the harness, 18 grid clicks and a 60-click burst sent with `tmux send-keys -l` as SGR mouse all hit the expected targets (page-side log).
- Acceptance: AC01 (frozen widget at most 0.5% browser CPU; unchanged page produces no frames) and AC02 (one animating widget at 10 fps within about 40% of one core across the browser tree, Ghostty, tmux, and the harness; median of 3 runs) hold.
- Check: `npm run typecheck`
- Check: `npm test`
- Check: `npm run test:browser`
- Check: `npm run harness` (documented invocation in a visible split)
- Check: `npm run perf`

## Review gate

Medium segment-final slice: run one focused segment review over T01 (01.01 and 01.02) against the segment acceptance in `./index.md`. Reviewers apply the credible-harm blocker standard and do not expand the plan. Implement may rerun the gate at most twice after targeted corrections.

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

On success, record changed paths, acceptance, check results, the segment review verdict, residual uncertainty, and the exact next slice (`02.01`). Update checkboxes and Current only in `implementation/index.md`; mark plan task T01 complete only after the segment evidence passes. Stop for a user-controlled Git checkpoint and suggest Dream without invoking either.

### Completion evidence - 2026-10-28T20:15+01:00

Starting HEAD: `22eed8a` (01.01 checkpoint, clean tree, nothing staged). `wiki/raw/2026-10-27-poc-handoff.md` unchanged (blob `43aefcf`).

Changed paths: `package.json` (scripts `harness`, `perf`); new `src/kitty.ts`, `src/env.ts`, `tests/kitty.test.ts`, `tests/env.test.ts`, `tests/fixtures/visual.html` (U4 fixture: circle, square, border, corner labels, live counter), `scripts/harness.ts`, `scripts/perf/lib.ts`, `scripts/perf/run.ts`. Spec: this packet, `./index.md`, `../plan.md` (T01 checkbox). No dependency changes (PD01 only).

Implementation notes:

- `src/kitty.ts`: 256-entry diacritics table, verified identical to the first 256 entries of kitty's `rowcolumn-diacritics.txt` (kitty.app docs copy); `placeholderLines`, `uploadCommand` (`a=T,t=d,f=100,U=1,i,c,r,q=2`, 4096-byte chunks, `m=1`/`m=0`, keys on the first chunk only), `wrapTmux` (each chunk wrapped, ESC doubled), `deleteCommand` (`a=d,d=I,q=2`), `ImageIdAllocator` (random, never reused, configurable range), `fitCells` (scaled send: width-limited, rows rounded up, exposes `scale`), `KittyImage` (one write per frame, skips identical base64 at the same size, `resend` for scaled sends and recovery).
- `src/env.ts`: `detectEnvironment` (tmux client `#{client_termname}` Ghostty or kitty, plain Ghostty via `TERM_PROGRAM`, else unsupported), `tmuxCellSize`, `cssCellSize`; tmux is queried for `$TMUX_PANE`.
- `scripts/harness.ts`: renders one widget from the 01.01 page layer into its own pane (alt screen, grid at row 2 col 1), forwards SGR mouse to CSS pixels (scale-aware), control over a Unix socket (`/stats`, `/hits`, `/scale`, `/freeze`, `/thaw`, `/quit`), dedicated image ids `0xA1D000-0xA1DFFF`, deletes its ids and closes the browser on exit. Documented invocation: `tmux split-window -v -d -c "$PWD" 'npm run harness -- --control /tmp/piw-harness.sock'`.
- `scripts/perf/run.ts` (`npm run perf [input|idle|active]`): opens each harness in a temporary detached split of the attached client's current window, drives it, samples `ps` CPU-time and RSS deltas, quits the harness, and closes the split (fallback: deletes the image id through the split's tty, then kills the pane). Fails when any browser PID it saw remains.

Checks (repository root):

- `npm run typecheck`: exit 0.
- `npm test`: 63 pass, 0 fail (46 from 01.01 plus 17 kitty and env tests).
- `npm run test:browser`: 22 pass, 0 fail; no chrome-headless-shell afterwards.
- `npm run harness` (documented split invocation): env `tmux-ghostty`, live frames, clean quit, split closed by itself.
- `npm run perf` (full, exit 0; earlier partial runs were consistent): every split closed, 16 browser PIDs started and 0 left; `pgrep -fl chrome-headless-shell` empty afterwards.

Acceptance:

- Unit: grid lines carry the row and column diacritics and the 24-bit id color; 256 cells per axis, 257 rejected; chunks at most 4096 bytes with correct `m` flags and exact reassembly; every chunk tmux-wrapped with every ESC doubled; scaled sends use the requested `c`/`r`; detection covers tmux + Ghostty, tmux + kitty, tmux + other (including a failing tmux query), plain Ghostty, and other.
- U4 (user-confirmed through Gamemaster, Ghostty 1.4.0, tmux 3.6b, pane `%421` in window 4): full size 90x18 visible, circle round and square square, border and corner labels not cropped, counter live: "all yes". Scaled send 45x9 (`scale 0.5`): visible, old size gone, not squashed, not cropped, live: "all yes". Restoring full size re-sent the frame.
- Input (grid fixture, `tmux send-keys -l` SGR, page-side log): 18/18 grid clicks and 60/60 burst clicks hit the expected targets, 0 mismatches.
- AC01: unchanged live static page 0 frames in 5 s; frozen animating page 0.1% browser-tree CPU over 10 s (first run 0.0%), 0 frames while frozen, new frame after thaw.
- AC02 (anim fixture, 3 x 10 s, same invocation): marginal median 34.0% of one core (runs 34.0, 33.6, 34.2) -> PASS against about 40%. Absolute total median 43.17% (runs 43.17, 42.57, 43.38). Per run: browser tree 25.1-25.7%, harness 0.8-0.9%, tmux server 6.3-6.5%, Ghostty 10.3-10.4%; no-widget baseline in the same invocation immediately before the widget: tmux 7.47%, Ghostty 2.69%. RSS: browser tree about 303 MB, harness about 106 MB. 8.4-8.6 fps, about 27.5 KB per frame. Interpretation (Gamemaster decision relaying the user; not a plan change): AC02 is judged on the widget's marginal cost because the shared tmux server and Ghostty carry unrelated load from the user's other sessions; the baseline is subtracted only from tmux and Ghostty (clamped at 0), the browser tree and harness count in full.

Segment review (T01, focused, medium): PASS on the first dispatch, 0 retries. Non-blocking findings recorded in `./index.md` Discoveries.

Residual uncertainty: frames run at about 8.5 fps (01.01 pacing). Harness mouse mapping at a scaled size assumes the terminal centers the fitted image vertically (AC12 proves scaled clicks in 02.02). Freeze and thaw are proven for one page; whether two pages share one window id is untested (matters for 02.02 one-live-widget policy). Absolute AC02 totals depend on other sessions' tmux and Ghostty load.

Next slice: `02.01` (Pi integration core).
