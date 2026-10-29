# Plan: Widget usage guidance and check_widget

Work item: `261029-1116-widget-usage-guidance-and-check-widget`
Status: Planned
Created: 2026-10-29
Updated: 2026-10-29

Assurance: low - changes stay inside this personal extension's prompts, one new read-only tool, and docs; fully reversible; the rendering pipeline is not touched.

## Goal

Make the agent use `show_widget` well and only when it helps. Shrink the tool description to what the tool needs to function, keep a short when-to-use rubric always in context, move the detailed authoring guide into a plain file the agent reads before its first widget (tracked by the extension), and add a `check_widget` tool so the agent can see and inspect a widget it rendered, for example when the user says something looks wrong.

## Context

- Extension at HEAD `c9f47ba`; previous item archived at [spec/archive/261028-1700-interactive-html-widgets-for-pi](../../archive/261028-1700-interactive-html-widgets-for-pi/plan.md). The full guide currently lives in `DESCRIPTION` in `src/index.ts` (about 400 words, sent on every turn).
- Pi 1.4.0 facts (verified in `@earendil-works/pi-coding-agent` types and docs): tool definitions support `promptSnippet` and `promptGuidelines` (bullets appended to the system prompt Guidelines while the tool is active); `pi.on("tool_call")` exposes `read` calls (`ReadToolCallEvent`) and `pi.on("tool_result")` their results; `session_compact` fires after compaction; tool results may contain image content.
- Page layer: open pages keep `lastFrame`; closed widgets keep a RAM still (`src/manager.ts`); screenshots and evaluate work on minimized (frozen) pages (01.01 evidence).
- Research (sourced summary in the user conversation of 2026-10-29): guides the model must choose to read are skipped in a large share of runs (Vercel, LangChain evals), so an always-on rubric plus enforcement beats a pointer alone; comparable products follow "smallest format that fits" and treat widgets as earning their place; screenshot self-checks are standard practice but on demand, downscaled (about 1.3k tokens for 1000x1000 on Claude). Sources: [Vercel skills eval](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals), [LangChain skills eval](https://www.langchain.com/blog/evaluating-skills), [OpenAI UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines.md), [ChatGPT Visualizations](https://developers.openai.com/codex/visualizations.md), [Claude custom visuals](https://support.claude.com/en/articles/13979539-custom-visuals-in-chat-and-cowork), [Claude vision costs](https://platform.claude.com/docs/en/build-with-claude/vision), [pi-generative-ui](https://github.com/Michaelliv/pi-generative-ui).

## Requirements

- RQ01 Minimal description: `show_widget`'s `description` shrinks to about 150-250 tokens and keeps only what the tool needs to function: parameters and exactly one of `html` or `path`; fixed viewport of `cols` x `rows` cells (about 8x17 CSS px per cell, no page scrolling); click-triggered UI instead of hover; one line on the bridge (`pi.send`, `pi.submit`); one line on the network policy; and the absolute path of the guide file with the instruction to read it before the first widget in a session. The tool name and parameters do not change.
- RQ02 Always-on rubric: `promptGuidelines` carries 4-5 short bullets. Use a widget only on explicit request or when (1) something is better seen than read (design: palettes, spacing, layout variants; data shapes: curves, distributions, breakdowns), (2) stepping through state or time helps (state machines, rebases, races, algorithms), or (3) the user asks for an explanation of a concept with motion, growth, or spatial structure. Widgets are mainly visual displays: decisions and questions go through normal text or `ask_user_question` (keyboard), and a widget collects input only when the choice is inherently visual (color picker, dragging visual items into order, picking a point or region). Never for approvals, choosing among options, forms, code, commands, error explanations, or static architecture (use text, `ask_user_question`, or Mermaid/D2). `promptSnippet` stays one line.
- RQ03 Guide file: `guide/widgets.md` in the package root holds everything removed from the description, plus: the rubric with concrete use and do-not-use examples for a daily coding agent (including a "show, then ask with `ask_user_question`" example), layout and input rules, a minimal bridge example and how delivered data appears (untrusted custom message), network, lifecycle, and when and how to use `check_widget`. It is added to `package.json` `files`. Plain ASCII markdown; target under about 250 lines.
- RQ04 Read tracking: a successful `read` of the guide path (resolved against the session cwd, so relative, absolute, and `~` forms match) marks the guide as read for the current session runtime; `session_compact` and a new session reset the mark. When `show_widget` runs before the guide was read, the widget still renders and its result ends with one line telling the agent to read the guide (absolute path) before editing this widget or creating another. After the guide is read, results carry no pointer.
- RQ05 check_widget: new tool `check_widget({id})` for a widget id returned by `show_widget`. It returns one image plus a text report:
  - Image: a fresh capture when the page is open (live or frozen, without waking a frozen widget or changing focus); the RAM still when the widget is closed; the still or last frame scaled so the long edge is at most 1000 px, PNG.
  - Text report: widget state (live, frozen, closed), cells and CSS viewport, image source (fresh capture or last still) and its size, JS errors and blocked requests seen since the last load, document scroll size versus viewport, and up to about 10 elements that overflow the viewport or are clipped by an `overflow: hidden` ancestor (tag, id or class, box). For a closed widget the page-derived parts say "closed: not inspected; showing the last still".
  - Unknown id or a widget without any image yields a clear text-only error. The tool never revives, focuses, or resizes a widget. Its description says to use it on demand (the user reports a problem, or after load errors), not after every render.
- RQ06 Docs: README covers the guide file, the rubric, read tracking, and `check_widget`.

## Out of scope

- A Pi skill, a separate guide or `read_me` tool, or `resources_discover` registration (user decision: plain file plus description pointer).
- Rejecting or blocking `show_widget` before the guide is read.
- Automatic screenshots after rendering; changes to rendering, freezing, lifecycle, transport, or the network policy.
- Integration with the user's teach skill (done separately by the user).
- An automated real-model eval harness; new dependencies.

## Assumptions

- Reads through tools other than `read` (for example `bash cat` or a codemode wrapper that does not emit `tool_call` for nested reads) are not detected; the result then still carries the one-line pointer, which is harmless. Revisit if the eval shows repeated pointers after the guide was read.
- Image downscaling can be done without a new dependency (for example a Chromium-side `Page.captureScreenshot` with a `clip.scale`, or drawing the still into a canvas in the existing browser). If no dependency-free method works for closed-widget stills, stop and ask.

## Design

- `src/index.ts`: replace `DESCRIPTION` with the minimal text; add `promptGuidelines`; compute the guide path from the module location (`new URL("../guide/widgets.md", import.meta.url)`); register `check_widget`; append the pointer line in `summary` when the guide is unread.
- Read tracking: a small module or a few lines in `src/index.ts` listening to `tool_call`/`tool_result` for `read`, resolving `input.path` against `ctx.cwd` and `~`, comparing with the realpath of the guide; reset on `session_compact` and session start.
- `check_widget`: a manager method that returns `{state, cells, css, errors, blocked, image}`; a page-layer method that captures a scaled screenshot and evaluates a small overflow and scroll probe in the page (read-only, no input events, no focus change).
- `guide/widgets.md`: sections Rubric, Examples (use / do not use), Layout, Input, Bridge, Network, Lifecycle, check_widget.

## Decision Log

| ID | Scope | Decision | Rationale | Evidence | Revisit when |
| --- | --- | --- | --- | --- | --- |
| QD01 | Guide delivery | Plain file in the package plus an absolute-path pointer in the description; no skill, no guide tool. | User choice; simplest; tracked reads give enforcement visibility. | User answer 2026-10-29 | Eval shows the guide is rarely read. |
| QD02 | Unread guide | Render anyway and append a one-line pointer. | No wasted HTML generation; the minimal description covers essentials. | User answer 2026-10-29 | First widgets are frequently broken. |
| QD03 | Usage bias | Conservative rubric; widgets are mainly visual displays; keyboard-first questions; widget input only for inherently visual choices; never for approvals. | User preference for keyboard flow; research "smallest format that fits". | User answers 2026-10-29 | User asks for more proactive widgets. |
| QD04 | Self-check | `check_widget` returns a downscaled image plus a text report, on demand only. | Image catches layout issues; text report is cheap and precise. | User answer 2026-10-29; research | Image tokens prove too costly. |

## Work breakdown

- [x] T01: Guidance split, read tracking, and check_widget
  - Depends on: none
  - Scope: RQ01-RQ06.
  - Expected areas: `src/index.ts`, `src/manager.ts`, `src/page.ts`, `guide/widgets.md`, `package.json` (`files`), `README.md`, `tests/` (unit, browser, e2e), `tests/eval/widget-usage.md`.
  - Acceptance: AC01-AC07.
  - Verification: the Verification plan.

## Acceptance criteria

- AC01: the `show_widget` description is at most about 250 tokens (measured as words x 1.3 or a tokenizer) and contains the guide's absolute path; `promptGuidelines` holds the rubric bullets including "not for approvals or choosing among options"; tool name and parameters are unchanged. (RQ01, RQ02)
- AC02: `guide/widgets.md` exists, is listed in `package.json` `files`, contains every topic removed from the old description plus the use and do-not-use examples and a check_widget section, and is plain ASCII. (RQ03)
- AC03: unit tests prove the read mark is set by relative, absolute, and `~` paths to the guide, is not set by other paths or failed reads, and resets on `session_compact`; e2e shows the pointer line on a `show_widget` result before the guide is read and its absence after a `read` of the guide. (RQ04)
- AC04: browser or e2e tests prove `check_widget` returns a PNG whose long edge is at most 1000 px plus the text report for a live and a frozen widget (the frozen widget stays frozen and unfocused), the RAM still with the "closed" note for a closed widget (no revive), and a text-only error for an unknown id. (RQ05)
- AC05: on an overflow fixture, the report lists the overflowing element and a scroll size larger than the viewport; on a clean fixture it reports none. (RQ05)
- AC06: README documents the guide, rubric, read tracking, and `check_widget`. (RQ06)
- AC07: manual eval: the user runs `tests/eval/widget-usage.md` (about 14 prompts) once in a real Pi session; record per prompt whether the agent chose correctly. Expected: should-not-render prompts (including an approval and a pick-one-of-three decision) get text or `ask_user_question`; should-render prompts get a widget, with the guide read before or right after the first widget; one "show, then ask" prompt renders and then asks via `ask_user_question`; two `check_widget` prompts (user reports a visual problem) call `check_widget` and act on its findings. At least 12 of 14 correct, misses recorded. (RQ01-RQ05)

## Testing decisions and seams

- Unit: read-path matching and reset (fake events), pointer line in the summary, description length, overflow-report formatting.
- Browser: scaled capture size, overflow probe, frozen page stays minimized after capture.
- E2E (existing tmux harness, stand-in model, `PI_WIDGETS_DEV=1`): pointer before and after a guide read; `check_widget` on live, frozen, and closed widgets.
- Manual: AC07 eval with a real model (the only real-model check).

## Verification plan

- `npm run typecheck`
- `npm test`
- `npm run test:browser`
- `npm run test:e2e` (visible tmux split; close it afterwards)
- Manual AC07 eval, results recorded in verification evidence.
- No chrome-headless-shell process started by the runs remains.

## Risks and blockers

- Models may still skip the guide; mitigated by the always-on rubric and the pointer line; measured by AC07.
- `promptGuidelines` and description wording are model-sensitive; adjust wording within the rubric if AC07 misses cluster, without changing the rubric's meaning.
- Image tokens per `check_widget` call (about 1.3k); on-demand use only.

## Progress

- [x] Planning complete and confirmed.
- [x] Implementation complete (T01).
- [x] Verification passed, including the AC07 manual eval (14/14); see verification.md.

## Execution handoff

Use PI Agent in a fresh session with this prompt:

```text
Read spec/active/261029-1116-widget-usage-guidance-and-check-widget/plan.md and item.yaml completely, plus AGENTS.md and spec/AGENTS.md.
Implement T01 as the smallest coherent change that satisfies RQ01-RQ06 and AC01-AC06, preserving Out of scope and the Decision Log. Assurance is low.
Run the Verification plan, then ask the user to run the AC07 manual eval and record the results.
Record only verified evidence, failures, skipped checks, and residual uncertainty.
Stop and ask before dependencies, migrations, destructive operations, external writes, commits, pushes, or scope expansion.
```
