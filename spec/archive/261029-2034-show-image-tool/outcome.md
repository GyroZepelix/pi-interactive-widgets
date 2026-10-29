# Outcome: Show image tool

Work item: `261029-2034-show-image-tool`
Disposition: completed
Date: 2026-10-29

## Delivered scope

- RQ01: `show_image({ source, title?, rows? })` with a short description and one guideline ("use show_image to show an existing image file or URL; do not build an `<img>` widget"). `show_widget`, `check_widget`, and their prompts are unchanged.
- RQ02: local files (relative to Pi's working directory) up to 20 MB; format from magic bytes (PNG, JPEG, GIF, WebP, SVG); clear errors for missing, unreadable, oversized, and unknown-format sources.
- RQ03: `http`/`https` URLs fetched in Node; every request and redirect hop (at most 5) checked: listed `network.allowHosts` hosts allowed, other local hosts refused, including public names that resolve to local addresses; 20 MB streamed limit; 15 s total timeout.
- RQ04: PNG stays in Node (downscaled with `src/png.ts`, no Chromium). JPEG, WebP, GIF (first frame), and SVG are decoded in a short-lived page of the session browser with JavaScript disabled, every other request aborted, transparency kept, closed right after capture, and not counted toward `MAX_PAGES`. A missing browser gives the install hint for non-PNG sources only.
- RQ05: aspect kept; width at most the widget default width (never the last column), height at most `rows` (default 24); never enlarged beyond natural size at `dpr`; title line above the placeholder grid.
- RQ06: images join resize rescaling, `/widgets-refresh`, and click re-send (no focus). At most 20 stills in RAM; dropped and earlier-process rows show "click to load" and reload with the same checks. No image bytes on disk; persisted details hold only source, title, sizes, and id.
- RQ07: text-only result (id, cells, pixel size, format, natural size, source); unsupported and non-interactive notices follow `show_widget`.
- RQ08: README section "Showing images (`show_image`)" and one line in `guide/widgets.md`.
- Code: new `src/image.ts`; `ImageComponent` in `src/component.ts`; image registry in `src/manager.ts`; registration in `src/index.ts`; prompts in `src/prompts.ts`; tests `tests/image.test.ts`, `tests/image.browser.test.ts`, `tests/e2e/image.e2e.ts`; fixtures `tests/fixtures/image.{png,jpg,gif,webp,svg}`; perf disk phase extended in `scripts/perf/run.ts`.

## Deviations from plan

None to requirements, acceptance, or scope. In-plan implementation choices (plan Decision log):

- Natural size counts as CSS px, so the largest display is natural size x `dpr` device px; rasters are sent at most at natural pixel size, SVG is rasterized at the shown size.
- PNG variants the Node decoder cannot read (palette, 16-bit, interlaced) are forwarded unchanged; PNGs above 50 megapixels are refused.
- GIF bytes are cut after the first image so the browser shows exactly the first frame.
- Paths resolve like Pi's `read` (`~`, leading `@`).
- `SessionState` gained an optional terminal writer used only by tests.

## Verification summary

See [verification.md](verification.md). `npm run typecheck` pass; `npm test` 190/190; `npm run test:browser` 37/37; `npm run test:e2e` 31/31 (including the existing `show_widget` suites); `npm run perf -- disk` pass ([evidence/perf-disk.json](evidence/perf-disk.json): no image file anywhere checked; only the accepted 49 B Local Storage housekeeping write after launch). Manual AC06 with the user: local photo, public URLs, SVG transparency, and the localhost refusal all PASS. No `chrome-headless-shell` process remained after any run. Low assurance: no separate final review, per the plan. One harness failure (the perf widget scrolled off screen) was fixed in `scripts/perf/run.ts` and re-run to pass.

## Retained, reverted, or transferred work

All work retained. Nothing reverted or transferred.

## Residual risks

- Regular TUI mode was not exercised for `show_image`; the image row has no mode-specific rendering.
- Plain Ghostty without tmux and kitty as the tmux client are untested.
- A draw while the tmux window is hidden was not tested live; recovery relies on a click re-send or `/widgets-refresh`, both covered by tests.
- DNS rebinding between the address check and the connection remains possible (accepted in the plan's Risks).
- Very large non-PNG images rely on Chromium's own decode limits.

## Follow-up work items

- Optional: connect to the checked address to close the DNS rebinding gap, if desired later.
- Optional: an e2e for `show_image` in regular TUI mode.

## Source references

- [plan.md](plan.md), [verification.md](verification.md), [evidence/perf-disk.json](evidence/perf-disk.json).
- [kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/); Ghostty `graphics_image.zig` and `graphics_command.zig` (as cited in the plan).

## Wiki updates

None made. Candidates for Dream: `show_image` exists as a separate static image path (PNG in Node, other formats decoded in a no-network, script-disabled browser page that does not count toward `MAX_PAGES`); images share `resendAll` and the click re-send with widgets and keep at most 20 stills in RAM; URL fetching reuses `isLocalHost` and `hostListed` and also checks resolved addresses; the perf disk phase now includes three `show_image` calls and focuses a second widget because the image rows push the first off screen.
