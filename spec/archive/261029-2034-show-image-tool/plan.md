# Plan: Show image tool

Work item: `261029-2034-show-image-tool`
Status: Planned
Created: 2026-10-29
Updated: 2026-10-29

Assurance: low - a new, separate tool that reuses the proven kitty transport and placeholder grid without changing `show_widget` behavior; the only new surface is fetching user-or-agent-supplied URLs, covered by the existing local-address block; all local and reversible.

## Goal

Let the agent show an existing image to the user inline in the transcript: `show_image({ source })`, where `source` is a local file path or an `http(s)` URL. The image appears under tmux + Ghostty (and plain Ghostty) the same way widgets do, fitted to the pane, and stays static (no focus, wake, or bridge).

## Context

- Pi cannot do this itself in the user's setup: `pi-tui/dist/terminal-image.js` sets `images: null` whenever `TMUX` is set ("Image protocols are unreliable under tmux").
- The kitty graphics protocol has no URL transmission medium; only `t=d` (direct bytes), `t=f`/`t=t` (a file path the terminal reads), and `t=s` (shared memory). Ghostty implements all four but accepts only PNG (`f=100`) or raw RGB/RGBA (`f=24`/`f=32`) payloads, not JPEG. So the extension fetches and decodes, then sends PNG with `t=d` like widget frames (sources below).
- Node has a PNG codec here (`src/png.ts`: `pngSize`, `decodePng`, `downscale`, `encodePng`) but no JPEG, WebP, or GIF decoder; the existing chrome-headless-shell decodes them without a new dependency.
- Reusable pieces: `KittyImage` and `placeholderLines` (`src/kitty.ts`), the image id allocator, `fitCells`, `resendAll` behind `/widgets-refresh` and the tmux window-switch recovery (`src/manager.ts` L717-L774), `isLocalHost` and `hostListed` (`src/policy.ts` L112-L135), environment detection (`src/env.ts`), and the one-line "click to load" pattern for rows from an earlier process (archived RQ07).
- Why not `show_widget` with `<img>`: the synthetic origin cannot reach arbitrary local files, the CSP blocks most image hosts, the agent cannot know the image's aspect ratio, and each widget holds a live Chromium page counted against `MAX_PAGES = 5` (user-confirmed decision 2026-10-29).

## Requirements

- RQ01 Tool: register `show_image` with parameters `source` (required string: a path, relative to Pi's working directory, or an `http`/`https` URL), optional `title`, and optional `rows` (maximum height in cells, 1-256, default 24). A short description and one `promptGuidelines` bullet ("use show_image to show an existing image file or URL; do not build an `<img>` widget"); `show_widget`, `check_widget`, their descriptions, and the guide's rubric stay otherwise unchanged.
- RQ02 Local files: any readable file; at most 20 MB; format detected from magic bytes, not the extension. Missing, unreadable, oversized, or unknown-format sources fail with a clear tool error.
- RQ03 URLs: `http` and `https` only, fetched by the extension in Node. Each request and each redirect hop (at most 5) is checked: a host listed in `network.allowHosts` is allowed; otherwise `isLocalHost` hosts are refused, and the resolved addresses of the hostname are also checked so a public name resolving to a local address is refused. Limits: 20 MB (streamed, aborted when exceeded) and 15 s total timeout. The CDN allowlist and `network.open` do not apply (any public host is allowed).
- RQ04 Decoding: PNG is used directly without starting Chromium (large images are downscaled with `src/png.ts` to the display pixel size). JPEG, WebP, GIF (first frame), and SVG are decoded by the existing headless browser into a PNG at the display pixel size with transparency kept; the page used for decoding has no network access, runs no image scripts, closes immediately, and never counts toward `MAX_PAGES`. A missing browser produces the existing install hint for non-PNG sources only.
- RQ05 Display: keep the image's aspect ratio; width at most the widget default width (pane width minus margin, never the pane's last column), height at most `rows`; never upscale beyond the image's natural size at the configured `dpr`. A title line (`title` or the file name or URL) above the placeholder grid, as for widgets. Works in fullscreen and regular mode.
- RQ06 Lifecycle: images take part in resize rescaling, `/widgets-refresh`, and the tmux window-switch re-send. At most 20 image stills are retained in RAM; older ones and rows from an earlier process show the one-line "click to load" row, and a click re-reads the original path or URL with the same checks. No image bytes are written to disk: fetched, decoded, and retained images live only in RAM, uploads use kitty `t=d`, and the persisted row details and tool result (stored in Pi's session file) hold only the source, title, pixel and cell sizes, and id, never image data. Clicking a shown image only re-sends it (no focus).
- RQ07 Result: text only for the agent (source, pixel size, cells used, id), no image content. Unsupported terminal or non-interactive mode returns the same style of notice as `show_widget`.
- RQ08 Docs: README gains a `show_image` section (sources, formats, URL rules, limits); `guide/widgets.md` gets one line pointing to `show_image` for existing images.

## Out of scope

- Animated GIF playback, video, PDF, or multi-page images.
- `check_widget` support for images; image content in the tool result.
- Kitty `t=f`, `t=t`, or `t=s` transmission; a disk cache of fetched images.
- Changes to `show_widget` behavior, its network policy, or the CDN allowlist.
- New dependencies.

## Work breakdown

- [x] T01: show_image tool
  - Depends on: none
  - Scope: RQ01-RQ08.
  - Expected areas: new `src/image.ts` (source loading, sniffing, URL fetch, decode), `src/index.ts` (tool registration, renderer), `src/component.ts` or a small image row component, `src/manager.ts` (image registry for re-sends and the retained-still limit), `src/prompts.ts`, `README.md`, `guide/widgets.md`, `tests/image.test.ts`, `tests/image.browser.test.ts`, `tests/e2e/`, `tests/fixtures/` (small PNG, JPEG, WebP, SVG).
  - Acceptance: AC01-AC08.
  - Verification: `npm run typecheck`, `npm test`, `npm run test:browser`, `npm run test:e2e`, the perf disk phase, manual AC06.

## Acceptance criteria

- AC01 (RQ02, RQ04): unit tests for magic-byte detection (PNG, JPEG, WebP, GIF, SVG, unknown), the 20 MB limit, missing and unreadable files, and PNG downscaling to the display size without starting a browser.
- AC02 (RQ03): unit tests with a local test server or injected fetch and resolver: a public URL loads; `localhost`, a private IP literal, a hostname resolving to a private address, and a redirect to a local host are refused; a listed `allowHosts` local host is allowed; more than 5 redirects, a body over 20 MB, a timeout, and a non-http scheme fail with clear errors.
- AC03 (RQ04): browser test decodes the JPEG, WebP, GIF, and SVG fixtures to PNGs of the expected size; the SVG fixture's transparent area keeps alpha; the decoding page made no network request and is closed afterwards.
- AC04 (RQ05, RQ06): unit tests for the fit (aspect kept, width and `rows` caps, no upscale), the retained-still limit (the 21st image turns the oldest into a one-line row), and a re-send after `/widgets-refresh`.
- AC05 (RQ01, RQ05-RQ07): e2e in a dedicated visible tmux window: `show_image` with the PNG fixture and with the JPEG fixture each draws a title line plus a placeholder grid of the expected size; the tool result text names the size and contains no image; `show_widget` e2e still passes.
- AC06 (manual, user): in tmux + Ghostty, the agent shows (a) a local photo, (b) a public image URL, and (c) an SVG; each looks correct and sharp, and (d) a URL to `localhost` is refused with a clear message.
- AC07: `npm run typecheck`, `npm test`, `npm run test:browser`, and `npm run test:e2e` pass; no chrome-headless-shell process started by the runs remains.
- AC08 (RQ06, no disk): (a) a unit test asserts the row details and tool result of a `show_image` call contain no image data (no base64 or binary payload, bounded size); (b) the disk phase of `npm run perf` is extended with three `show_image` calls (a PNG file, a JPEG file decoded by Chromium, and a URL from a local test server listed in `allowHosts`) and finds no new image or still file under the Chromium profile, the isolated agent dir, the repository, or the temp dir; profile housekeeping writes beyond the accepted AC04 baseline of item 1 are reported.

## Verification plan

- `npm run typecheck`
- `npm test`
- `npm run test:browser`
- `npm run test:e2e` (dedicated visible tmux window; confirm the attached client's current window is that window right before each run; close it afterwards)
- `npm run perf -- disk` or the full `npm run perf` (same window rule) for AC08b
- Manual AC06, recorded with the user's answers.
- Low assurance: focused checks plus the existing suites; no separate final review.

## Risks and blockers

- DNS checks cannot stop every rebinding trick between the check and the connection; acceptable for low assurance because the fetch is read-only and the result is only displayed. Connecting to the checked address would close the gap if review finds it necessary.
- Very large photos make decoding slow; the 20 MB cap and downscaling to display size bound it.

## Progress

- [x] Planning complete and confirmed.
- [x] Implementation complete (direct mode, T01).
- [x] Verification passed: see [verification.md](verification.md).

## Decision log

- 2026-10-29 (Implement, in-plan implementation details; no requirement, acceptance, or scope change): natural size counts as CSS px, so the largest display is natural size x `dpr` device px (rasters sent at most at natural pixel size, SVG rasterized at the shown size); PNG variants the Node decoder cannot read are forwarded unchanged and PNGs above 50 megapixels are refused; GIF bytes are cut after the first image so the browser shows exactly the first frame; paths resolve like Pi's `read` (`~`, leading `@`). Details in [verification.md](verification.md).

## Sources

- [kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/): transmission media `d`, `f`, `t`, `s`; formats 24, 32, 100.
- [Ghostty graphics_image.zig](https://raw.githubusercontent.com/ghostty-org/ghostty/main/src/terminal/kitty/graphics_image.zig) and [graphics_command.zig](https://raw.githubusercontent.com/ghostty-org/ghostty/main/src/terminal/kitty/graphics_command.zig): all four media implemented; only PNG, RGB, and RGBA payloads.
- [kitten icat](https://sw.kovidgoyal.net/kitty/kittens/icat/): URL support is application-level (download, then transmit).

## Execution handoff

Use PI Agent in a fresh session with this prompt:

```text
Read spec/active/261029-2034-show-image-tool/plan.md and item.yaml completely, plus AGENTS.md, spec/AGENTS.md, and wiki/terminal-graphics-tmux.md.
Implement T01 as the smallest coherent change satisfying RQ01-RQ08 and AC01-AC08, preserving Out of scope. Assurance is low: focused checks plus the existing suites, no separate final review.
Run e2e in a dedicated visible tmux window and confirm the attached client is on it right before each run; ask the user for AC06.
Record only verified evidence, failures, skipped checks, and residual uncertainty.
Stop and ask before dependencies, migrations, destructive operations, external writes, commits, pushes, or scope expansion.
```
