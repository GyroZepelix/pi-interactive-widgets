# Outcome: Widget usage guidance and check_widget

Work item: `261029-1116-widget-usage-guidance-and-check-widget`
Disposition: completed
Date: 2026-10-29

## Delivered scope

- Minimal `show_widget` description (112 words, about 146 tokens) with parameters, the fixed `cols` x `rows` viewport without page scrolling, click instead of hover, one line each on the bridge and network, and the guide's absolute path with the instruction to read it before the first widget (`src/prompts.ts`). Tool name and parameters unchanged.
- Always-on rubric: 4 `promptGuidelines` bullets (explicit request or seen-not-read, stepping through state or time, concepts with motion or spatial structure; visual displays first, keyboard questions through text or `ask_user_question`; not for approvals or choosing among options; read the guide, `check_widget` on demand).
- `guide/widgets.md` (105 lines, plain ASCII, in `package.json` `files`): rubric with use and do-not-use examples including "show, then ask", calling, layout, input, bridge with example and delivered-data format, network, lifecycle, and `check_widget`.
- Read tracking (`src/guide.ts`): a successful `read` of the guide (relative, absolute, `~`, `@`, symlink) marks it for the session runtime; `session_compact` and `session_start` reset it. Until read, `show_widget` results end with a one-line pointer.
- `check_widget({id})`: one PNG with the long edge at most 1000 px plus a text report (state, cells and viewport, image source and size, JS errors and blocked requests since the last load, scroll size vs viewport, up to 10 overflowing or clipped elements). Fresh capture for live or frozen pages without waking, focusing, or resizing; RAM still with "closed: not inspected; showing the last still" for closed widgets; text-only error for an unknown id or no image. Dependency-free scaling (`src/png.ts`, Chromium `clip.scale`).
- README "Agent guidance" section; manual eval script `tests/eval/widget-usage.md`.

## Deviations from plan

- None from the contract. The new guidance e2e requests a 60x24 split because it reads only results and dev events; harness size requirements are unchanged. The full e2e ran from a dedicated visible tmux window per user decision.

## Verification summary

- typecheck pass; unit 138/138; browser 29/29; e2e 22/22; no leftover Chromium; completion review PASS (0 retries); AC07 manual eval 14/14 (guide read timing not reported). Details in `verification.md` and `evidence/`.

## Retained, reverted, or transferred work

- All changes retained, uncommitted; Git checkpoint left to the user.

## Residual risks

- Guide reads through tools other than `read` are not detected; the pointer line then stays (harmless).
- Pi may draw the `check_widget` image inline where its own terminal image support is active (outside tmux); not exercised.

## Follow-up work items

1. Animating widgets (for example the consistent-hashing ring) visibly flash while animating. Request: double-buffered frames, for example two alternating image ids per widget so the old image stays visible while the new one uploads.
2. Wheel scrolling over an unfocused widget focuses it and blocks transcript scrolling. Expected per the archived item's RQ05: wheel over an unfocused widget scrolls the transcript; only a focused widget receives wheel events. Possible regression.
3. A click outside a focused widget should release it (archived PD09/RD2). The user observed otherwise or wants it ensured. Possible defect; verify.
4. Design suggestion: generated widgets mostly change state through a single button; more of a widget could be interactive (for example clicking a spacing option). User unsure; guide wording to consider later.
5. Design suggestion: transparent or Pi-theme widget background instead of the default dark box so cards blend into the terminal.

## Source references

- `plan.md` (RQ01-RQ06, AC01-AC07, QD01-QD04), `verification.md`, `evidence/`.
- Research sources listed in `plan.md` Context.

## Wiki updates

- None in this item; Dream not run.
