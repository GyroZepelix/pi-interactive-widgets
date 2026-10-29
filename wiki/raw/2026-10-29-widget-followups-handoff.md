# Handoff: interactive widget follow-ups N1-N6

Date: 2026-10-29
Repository: pi-interactive-widgets, HEAD `a396431`
Status: observations only; no spec item exists yet. Next step: `/skill:quick-plan` (or `/skill:grill-with-docs` if N1 or N5 need design discovery) using this file as input.

## Origin

- N1-N5: user observations during the AC07 manual eval of item `261029-1116-widget-usage-guidance-and-check-widget` (real model, tmux + Ghostty, Pi fullscreen). Recorded in [its outcome](../../spec/archive/261029-1116-widget-usage-guidance-and-check-widget/outcome.md) and [verification](../../spec/archive/261029-1116-widget-usage-guidance-and-check-widget/verification.md).
- N6: user report after that item was archived (not in its outcome).
- Governing contract for existing behavior: [archived plan of 261028-1700](../../spec/archive/261028-1700-interactive-html-widgets-for-pi/plan.md) (RQ05, RQ06, RQ07, PD09) and its [revision R001](../../spec/archive/261028-1700-interactive-html-widgets-for-pi/refinements/R001.md) (RD1, RD2).

## Summary

| ID | Kind | One line |
| --- | --- | --- |
| N1 | Enhancement | Animating widgets flash between frames; wants double-buffered frames. |
| N2 | Probable defect | Wheel over an unfocused widget focuses it and blocks transcript scrolling. |
| N3 | Probable defect | Clicking outside a focused widget does not release it. |
| N4 | Guide wording (optional) | Generated widgets are interactive only through a single button; whole widgets could be more interactive. User unsure. |
| N5 | Enhancement | Widget background is an opaque dark box; wants it to blend into the terminal (transparent or Pi theme background). |
| N6 | Probable defect | Clicking an unfocused widget needs two clicks: the first only focuses or wakes, it does not reach the page. |

N2, N3, and N6 contradict the archived contract and should be treated as bugs. N1 and N5 are new behavior. N4 is wording in `guide/widgets.md` and the rubric.

## Details

### N1 Flashing during animation

- Observed: an animating widget (a "node ring" example) visibly flashes while it animates.
- User request: double buffering, so the old image stays visible while the next one is uploaded.
- Current behavior (source): every frame re-uploads to the same image id with `a=T` (`src/kitty.ts` `uploadCommand`, L86-L97). Replacing the image under live placeholders can briefly show nothing.
- Candidate fix (inference, unverified): two image ids per widget; upload frame N+1 to the spare id, then re-render the placeholder rows with the spare id's foreground color (`placeholderLines`, L53-L56), then delete or reuse the old id. Costs: ids are never reused within a process today (`ImageIdAllocator`), placeholder rows must re-render on each swap, Ghostty memory doubles per live widget. Alternative to evaluate: kitty animation frames (`a=f`), previously deferred in the archived plan Out of scope.
- Verify: visual check by the user on an animating fixture; the AC02 CPU budget (marginal at most about 40% of one core) must still hold.

### N2 Wheel over an unfocused widget focuses it

- Observed: while scrolling the transcript with the widget unfocused, when the pointer passes over a widget it becomes focused and the transcript stops scrolling.
- Expected (archived RQ05): wheel over an unfocused widget scrolls the transcript; only a focused widget receives wheel events.
- Current behavior (source): `src/component.ts` `handleMouse` returns `undefined` for `wheel` when not focused (L171-L176), and pi-tui then routes the wheel to the transcript (`pi-tui/dist/tui-alt-screen.js` L512-L526). So the wheel path itself looks correct.
- Hypotheses to check: (a) a trackpad tap-to-click or a touch generating a press while scrolling, which focuses by design; (b) a stale `mouseCapture` from an earlier press whose release was missed, routing later events to the widget; (c) the press branch treating some event as a left press (`e.button === "none"` maps to left, L154). Reproduce with a mouse wheel and with the trackpad, and log raw SGR sequences.
- Verify: e2e sending SGR wheel codes (64/65) over an unfocused widget asserts no focus change and that the transcript scrolled; same over a focused widget scrolls the page.

### N3 Click outside does not release

- Observed: with a widget focused, clicking elsewhere in the transcript does not release it.
- Expected (R001 RD2, PD09): Escape, Ctrl+C, or a click elsewhere releases focus and freezes the widget immediately.
- Current behavior (source): a press outside the box returns `undefined` (L151); release relies on Pi blurring the component ("only a lasting blur releases", L82). Pi only dispatches mouse events to the component under the pointer and likely does not change focus when the click lands on non-focusable transcript text, so the widget never learns about the outside click.
- Candidate fix (inference): observe outside presses some other way (for example an input listener for raw SGR presses outside the widget rows while a widget is focused, or a TUI-level hook if Pi provides one), then call `releaseFocus`. Must not toggle mouse modes (RQ05).
- Verify: e2e press outside the widget while focused asserts a `frozen` event, focus restored to the previous component, and the hint back to "click to interact".

### N4 More interactive widgets (optional)

- Observed: generated widgets mostly change state through one button; for example in a tight/normal/airy spacing comparison, clicking a variant itself does nothing.
- User position: unsure whether to change. Keep keyboard-first decisions (rubric QD03 of the guidance item).
- Candidate change: one or two sentences in `guide/widgets.md` encouraging direct manipulation of the visual elements themselves (click a variant to enlarge or highlight it, step through states by clicking the diagram), without moving decisions into the widget.
- Verify: re-run the related prompts of `tests/eval/widget-usage.md`.

### N5 Background that blends into the terminal

- Observed: every widget is a dark black or blue box.
- Current behavior (source): injected base CSS sets `body { background: var(--pi-bg, #1e1e2e) }` (`src/page.ts` L137); frames are opaque PNGs.
- Candidate fix (inference, unverified): render with a transparent default background (`Emulation.setDefaultBackgroundColorOverride` with alpha 0 and a transparent body) so screencast PNGs carry alpha and Ghostty shows the terminal background; the guide then tells widgets to leave the page background unset and use theme variables only for cards. Unknowns: whether screencast frames keep alpha, text antialiasing on transparent backgrounds, and the regular-mode still.
- Verify: user visual check in tmux + Ghostty; `check_widget` output still readable.

### N6 First click does not reach the page

- Observed: on an unfocused widget, the first click only focuses or wakes it; a second click is needed to press the intended control.
- Expected (R001 RD1): a press on a frozen widget wakes it and the same press reaches the page (proven in 02.03 e2e with a page-side press log).
- Confirmed gap for closed widgets (source): when a widget is closed (LRU beyond 5 pages or 30 min frozen) or comes from an earlier process, `handleMouse` calls `manager.revive` and returns without delivering the press (`src/component.ts` L135-L139). RQ07 only promised revive on click, so this is the likely cause when many widgets exist.
- Still to check: live or frozen but unfocused widgets (the wake path in `manager.pointer`, `src/manager.ts` L483-L490, queues the press after the thaw; verify the page actually receives it in a real session, not just the fixture).
- Candidate fix: after revive finishes loading, replay the original press and release at the same CSS point (or document that a revived page starts fresh and needs a second click, if replay is unsafe for some pages).
- Verify: e2e with more than 5 widgets so one is closed; a single click on the closed widget's control must show in the page-side log after revive.

## Constraints to carry forward

- Never toggle mouse modes or force `?1003h` (archived Out of scope).
- Keep the 10 fps cap, one live widget, and the AC01 and AC02 CPU budgets.
- Run e2e and user visual checks in a dedicated visible tmux window (see [terminal-graphics-tmux](../terminal-graphics-tmux.md)).
- No new dependencies without approval.
