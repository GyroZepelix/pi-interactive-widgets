---
schema_version: 1
episode_id: "2026-10-29-2146-gamemaster-checkpoint-261029-2034-show-image-tool-direct"
timestamp: "2026-10-29T21:46:28+01:00"
summary: "Implemented and archived the show_image tool (local files and guarded URLs, PNG in Node, other formats via a no-network browser page) with unit, browser, e2e, perf disk, and user AC06 checks passing."
kind: "gamemaster-checkpoint"
status: "shipped"
work_item: "261029-2034-show-image-tool"
current: "direct"
topics: ["show_image","kitty-graphics","e2e-tooling"]
---

# Gamemaster checkpoint: 261029-2034-show-image-tool/direct

Date: 2026-10-29
Work item: 261029-2034-show-image-tool
Status: shipped
In one line: Implemented and archived the show_image tool (local files and guarded URLs, PNG in Node, other formats via a no-network browser page) with unit, browser, e2e, perf disk, and user AC06 checks passing.

## Goal

Let the agent show an existing image file or http(s) URL inline in the Pi transcript under tmux + Ghostty, reusing the widget kitty transport, as planned in the low-assurance direct item 261029-2034-show-image-tool (RQ01-RQ08, AC01-AC08).

## How we approached it

- Read the plan, wiki terminal-graphics page, and the widget pipeline (manager, component, kitty, png, browser, policy, page) to find reusable parts.
- Probed two unknowns before coding: Node fetch with `redirect: "manual"` exposes the status and Location header; puppeteer `page.evaluate` still works after `setJavaScriptEnabled(false)`, so natural sizes can be read in the decode page.
- Generated fixtures once without dependencies: PNG via `encodePng`, JPEG and WebP via Chromium screenshots, a two-frame GIF hand-encoded (short first-frame delay), and an SVG with a transparent canvas and an inert script.
- Wrote `src/image.ts` (source parsing, file reads, guarded fetch with injectable fetch and resolver, magic-byte sniffing, `imageFit`, GIF first-frame cut, browser decode, `prepareImage`), then an image registry in `src/manager.ts`, `ImageComponent` in `src/component.ts`, the tool in `src/index.ts`, prompts, README, and one guide line.
- Tested in layers: unit (fit, detection, file limits, fetch rules, retained-still limit, re-send, reload, persisted details), browser (decode sizes, colors, alpha, no network, page and browser closed), then e2e, perf disk, and the user AC06 check in a dedicated tmux window.
- After Gamemaster approval, wrote outcome.md and archived the item.

## Key decisions

- **Decode page outside the widget limit** - chose a fresh page from the shared `BrowserHost` with request interception that answers only a synthetic document and the image; rejected rendering through `show_widget` with `<img>` (CSP, no local files, page counted against `MAX_PAGES`, as the plan decided).
- **Natural size as CSS px** - the largest display is natural size x dpr device px; rasters are sent at most at natural pixel size, SVG at the shown size; grid width rounds down so the terminal's aspect fit never stretches past that size.
- **PNG fallbacks** - PNG variants the Node decoder cannot read are forwarded unchanged; PNGs above 50 megapixels are refused.
- **GIF first frame** - cut the bytes after the first image instead of relying on capture timing.
- **Single image id per still** - images never get new frames, so double buffering is unnecessary.
- **Test seam** - added an optional terminal writer to `SessionState` so manager tests capture kitty output instead of writing to stdout.

## What did not work

- **First perf disk run** - the three image rows pushed the AC04 widget out of the visible pane, so `waitLocate` timed out; fixed by opening a second widget after the `show_image` calls and focusing it, keeping decode in the same browser profile.
- **Size-limit test at first** - the stream abort reused the timeout error; the abort promise now rejects with the signal's own reason.

## Current state and where we left off

- Shipped/verified: item archived as completed at `spec/archive/261029-2034-show-image-tool/`; changes are uncommitted and unstaged for a user-controlled checkpoint.
- Pending: Git checkpoint by the user; optional follow-ups (connect to the checked address to close the DNS rebinding gap, a regular-mode e2e).

## Source of truth

- `spec/archive/261029-2034-show-image-tool/plan.md`: contract and Decision log of in-plan implementation details.
- `spec/archive/261029-2034-show-image-tool/verification.md`: checks, requirement coverage, AC06 user verdicts, unverified areas.
- `spec/archive/261029-2034-show-image-tool/evidence/perf-disk.json`: AC08b disk evidence.
- `spec/archive/261029-2034-show-image-tool/outcome.md`: delivered scope and residual risks.
- `src/image.ts`, `src/manager.ts`, `src/component.ts`, `src/index.ts`: implementation.

## Verification

- Done: typecheck; `npm test` 190/190; `npm run test:browser` 37/37; `npm run test:e2e` 31/31; `npm run perf -- disk` pass with no image files and only the accepted 49 B Local Storage housekeeping write; user AC06 pass for local photo, public URLs, SVG transparency, localhost refusal, and click re-send; no leftover chrome-headless-shell; archive check and archive succeeded.
- Not verified yet: regular TUI mode for images, plain Ghostty, kitty as tmux client, a live hidden-window draw; DNS rebinding gap accepted by the plan.

## Open questions, blockers, next safe action

- Open/blocked: none. This run created and killed only tmux window 7 `piw-img-check`; the user's window 6 was still listed right after that kill and was absent later for reasons this run does not know.
- Next safe action: review the uncommitted diff and create a user-controlled Git checkpoint.

## Dynamic knowledge trail

- `wiki/terminal-graphics-tmux.md`: Topic-specific dynamic knowledge (image payloads section, visible-pane limit of `locate`, scope line).
