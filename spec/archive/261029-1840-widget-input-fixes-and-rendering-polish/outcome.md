# Outcome: Widget input fixes and rendering polish

Work item: `261029-1840-widget-input-fixes-and-rendering-polish`
Disposition: completed
Date: 2026-10-29

## Delivered scope

- N2 (RQ01): horizontal wheel codes 66/67 (any modifiers) never focus, press, or wake a widget; over a focused widget they scroll the page sideways. Vertical wheel unchanged.
- N3 (RQ02): a press outside a focused widget's rows releases it like Escape (restore focus, freeze, deliver `pi.send` data); a press on another widget focuses that one, and releasing it restores the editor.
- Both via a raw input listener at the front of pi-tui's private `inputListeners` Set (feature check, in-place rebuild, re-apply after renderer changes, removal on shutdown), with a documented fallback.
- N6 (RQ03): one click reaches the control on frozen widgets and on closed widgets with a shown still (replay after revive). One-line rows from an earlier process load on the first click.
- N1 (RQ04): double-buffered frames (two image ids per widget, rows switch, previous image deleted after 250 ms unless reused).
- N5 (RQ05): transparent widget pages (alpha frames) blend into the terminal; light Pi themes keep the opaque dark page; `check_widget` images are composited onto `#1e1e2e`.
- N4/N5 guide (RQ06): guide and README updated.

## Deviations from plan

- Two user-authorized direct amendments (plan Decision log): RQ01/RQ02 use the private-field raw input hook because `onTerminalInput` never sees mouse sequences in fullscreen; RQ03/AC03(c) replay only on a shown grid.
- The final e2e and perf runs used the attached client's current window 4 instead of the dedicated window 6; accepted by the user.

## Verification summary

typecheck pass; unit 170/170; browser 30/30; e2e 27/27; perf pass (AC01 frozen 0.1% CPU, 0 frames unchanged; AC02 median marginal 31.05% final, 37.4% at T02 vs HEAD 34.41%); AC07a-c passed by the user (AC07b blind A/B on a node-ring fixture: old build flashes, new does not). Final contract-quality review PASS, 0 retries. Details in `verification.md`.

## Retained, reverted, or transferred work

All work retained in the working tree (uncommitted; Git checkpoint is user-controlled). Nothing reverted or transferred.

## Residual risks

- The hook depends on a private pi-tui field; a Pi update selects the fallback (N3 open again, documented).
- Scaled and recovery re-sends still re-upload to the shown id and may blank once.
- Sideways scroll after a resize or reflow may miss until the next mouse event on the row (review, non-blocking).
- Light-theme opaque fallback and plain Ghostty were not checked visually.

## Follow-up work items

- Optional: refresh the row origin for horizontal wheel after layout changes.
- Optional: report the pi-tui horizontal-wheel classification and the listener order to Pi upstream (external write; out of scope here).
- Optional: re-run the related prompts in `tests/eval/widget-usage.md` with the new guide sentences.

## Source references

- [plan.md](plan.md), [verification.md](verification.md), [evidence/](evidence/)
- [Follow-ups handoff](../../../wiki/raw/2026-10-29-widget-followups-handoff.md)
- Ghostty v1.4.0 `src/terminal/kitty/graphics_exec.zig` (`loadAndAddImage`)

## Wiki updates

None made. Candidates for Dream: in fullscreen, Pi consumes mouse input before `onTerminalInput`, so the extension uses a front-of-Set hook; Ghostty deletes an image when a re-upload to its id begins, so frames are double-buffered; widget pages are transparent; e2e `locate` matches either buffer id.
