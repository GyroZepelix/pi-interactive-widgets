# Verification: Show image tool

Work item: `261029-2034-show-image-tool`
Date: 2026-10-29

Mode: direct (single task T01). Assurance: low (inherited from the plan): a new, separate tool that reuses the kitty transport and placeholder grid; the only new surface is URL fetching behind the local-address block; local and reversible. Starting boundary: `HEAD` 039200d; planning-owned changes were `spec/index.md` and this item folder. Protected `wiki/raw/2026-10-27-poc-handoff.md` (blob 43aefcf) and `wiki/raw/2026-10-29-widget-followups-handoff.md` are unchanged.

## Environment

- macOS arm64, Node 26.8.2, Ghostty 1.4.0 (tmux client `xterm-ghostty`), tmux 3.6b, Pi 1.4.0 fullscreen, cached chrome-headless-shell.
- E2E, perf, and AC06 ran in a dedicated tmux window (session 0, window 7 `piw-img-check`, `@109`) that this run created; the attached client's current window was verified as `@109` right before every harness run. The window was closed afterwards; no other window or pane was touched.
- E2E and AC06 used `PI_WIDGETS_DEV=1`, `pi -e ./src/index.ts`, an isolated `PI_CODING_AGENT_DIR`, and the stand-in model from `tests/e2e/probe-extension.ts`.

## Changed paths

- New: `src/image.ts` (source parsing, local reads, guarded URL fetch, magic-byte detection, fit, PNG path, browser decode), `tests/image.test.ts`, `tests/image.browser.test.ts`, `tests/e2e/image.e2e.ts`, `tests/fixtures/image.{png,jpg,gif,webp,svg}`, `spec/active/261029-2034-show-image-tool/evidence/perf-disk.json`.
- Modified: `src/index.ts` (tool registration, renderer, result text), `src/component.ts` (`ImageComponent`), `src/manager.ts` (image registry, retained-still limit, re-sends, reload, optional terminal writer for tests), `src/prompts.ts` (description and one guideline), `scripts/perf/run.ts` (disk phase with three `show_image` calls), `README.md`, `guide/widgets.md`.
- Fixtures were generated once (PNG by `encodePng`, JPEG and WebP by Chromium screenshots, GIF hand-encoded with two frames, SVG by hand); no dependency was added.

## Commands and checks

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | Pass | No output from `tsc --noEmit` after the last change |
| `npm test` | Pass, 190/190 | Includes 20 new tests in `tests/image.test.ts` |
| `npm run test:browser` | Pass, 37/37 | Includes 7 new tests in `tests/image.browser.test.ts`; no `chrome-headless-shell` left (`pgrep`) |
| `npm run test:e2e` (`TMUX_PANE=%727`) | Pass, 31/31 in 87 s | Includes 4 new tests in `tests/e2e/image.e2e.ts`; existing `show_widget` suites unchanged and passing; every suite asserts no process it started remains |
| `npm run perf -- disk` (`TMUX_PANE=%727`) | Pass | [evidence/perf-disk.json](evidence/perf-disk.json): 3 images shown (PNG without browser, JPEG and WebP URL decoded by Chromium), 1 URL request, `imageFiles: []`, 60 s live window, browser CPU 12.6%, `browserPidsLeft: []` |
| Manual AC06 (user) | Pass | User verdicts relayed by the orchestrator, below |

First perf attempt failed in the harness, not the product: the three image rows pushed the AC04 widget out of the visible pane, so `waitLocate` timed out. The disk phase now opens a second widget after the image calls and focuses that one (the first, already in the same browser, freezes when the second becomes live); the profile inspected is still the browser that decoded the images.

## Requirement coverage

| Requirement | Evidence | Status |
| --- | --- | --- |
| RQ01 tool | Registration test: parameters `source` (required), `title`, `rows` 1-256; one guideline; `show_widget` keeps `GUIDELINES` (`tests/image.test.ts`); existing guidance tests unchanged | Pass |
| RQ02 local files | AC01 tests: magic bytes for PNG, JPEG, GIF, WebP, SVG, unknown; JPEG renamed `.png` detected as JPEG; 20 MB sparse file refused, exactly 20 MB accepted; missing, directory, and `chmod 000` files fail clearly | Pass |
| RQ03 URLs | AC02 tests with injected fetch and resolver: public IPv4 and IPv6 names load; `localhost`, `192.168.1.10`, `[::1]`, `169.254.169.254`, names resolving to `10.0.0.5` or `fd00::1`, and a redirect to `127.0.0.1` are refused before any request; 5 redirects followed, 6 refused; streamed and declared bodies over 20 MB, a hanging fetch, a hanging DNS lookup (timeout), HTTP 404, and `ftp:`/`file:` fail clearly. Real `fetch` against a loopback server: listed `127.0.0.1:<port>` loads through a redirect; unlisted or another port is refused | Pass |
| RQ04 decoding | AC01: a 2000x1000 PNG is downscaled in Node to 1216x608 with a decoder that throws if called. AC03: JPEG, WebP, GIF, SVG decoded to PNGs of the expected size with checked pixel colors; GIF shows the first frame; SVG corner alpha 0; an SVG with `<image href>`, `xlink:href`, CSS `@import`, `url()` paint, and a `<script>` made 0 server hits and 0 attempted requests; the page count returns to 0 and the browser exits; an undecodable JPEG fails clearly; a missing browser gives the install hint for JPEG while PNG still works. E2E: PNG `browser: false`, JPEG `browser: true` | Pass |
| RQ05 display | Fit tests (aspect, width and `rows` caps, no enlargement past natural size at the dpr, vectors at the shown size). E2E: grid of the computed `cols` x `rows` (counted placeholders per row) with the title line directly above. AC06: user saw complete, sharp, correctly proportioned images | Pass (regular mode by code path only, see Unverified) |
| RQ06 lifecycle | AC04 tests: the 21st image drops the oldest still (terminal delete sent, row becomes `◇ <title> · click to load`), a click reloads it from the path and drops the next oldest; `resendAll` (behind `/widgets-refresh`) re-sends images; a click on a shown image re-sends it with `{handled, render: false}` and no focus; an earlier-process row loads on click, a failed load shows `click to retry` plus the error. E2E: `/widgets-refresh` re-sent both images. AC08a/b below | Pass |
| RQ07 result | AC08a test: persisted details hold only `cols, format, height, id, imageId, kind, natural, rows, source, sourceKind, title, width`, under 1000 chars, no base64 run, no PNG signature, no binary; result text matches `Image <id> is shown inline: CxR cells, WxH px sent (FMT, natural size ...). Source: ...`. E2E: result has no `[image]` part and is under 600 chars. Unsupported and non-interactive notices follow the `show_widget` pattern | Pass |
| RQ08 docs | README section "Showing images (`show_image`)" (parameters, formats, decoding, URL rules, display, memory and disk, result) and `allowHosts` row note; `guide/widgets.md` one line under "Calling show_widget"; guide tests (ASCII, fences, length) pass | Pass |

| Acceptance | Status |
| --- | --- |
| AC01 | Pass (`tests/image.test.ts` detection, files, PNG without browser) |
| AC02 | Pass (`tests/image.test.ts` URL fetching) |
| AC03 | Pass (`tests/image.browser.test.ts`) |
| AC04 | Pass (`tests/image.test.ts` fit and shown images) |
| AC05 | Pass (`tests/e2e/image.e2e.ts`; `show_widget` e2e still passes) |
| AC06 | Pass (user, below) |
| AC07 | Pass (typecheck, unit, browser, e2e; no `chrome-headless-shell` remained after any run) |
| AC08 | Pass: (a) unit test above; (b) [evidence/perf-disk.json](evidence/perf-disk.json): no image file under the Chromium profile, the isolated agent dir, the repository, or `$TMPDIR`; profile writes after launch: only `Default/Local Storage/leveldb/000003.log` 49 B, the same housekeeping write accepted as the AC04 baseline of item 261028-1700; nothing beyond it |

## Manual AC06 (user, tmux + Ghostty, window 7)

Shown with the stand-in model in a full-window Pi (319x83):

- (a) local photo `/System/Library/Wallpapers/.default/DefaultAerial.jpg` (3840x2160) shown 90x24 cells, 1440x810 px: PASS.
- (b) public URL `https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg` (172x178, shown at natural size, 21x11 cells) and (b2) `https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Fronalpstock_big.jpg/1280px-Fronalpstock_big.jpg` (75x16 cells): PASS.
- (c) `tests/fixtures/image.svg` 25x6 cells, 400x200 px: PASS, transparent, no white box.
- (d) `http://localhost:8080/image.png`: refusal line shown and clear: PASS.
- Optional click on a shown image: only redraws; the editor keeps focus: PASS. No remarks.

## Implementation details within the plan

- RQ05 "natural size at the configured dpr": an image's natural size counts as CSS pixels (like a browser), so its largest display is natural size x `dpr` device pixels. Rasters are sent at most at their natural pixel size (the terminal scales them into the grid); SVG is rasterized at the shown size. The grid width rounds down so the terminal's aspect fit fills it without stretching past that size; one cell is the minimum.
- PNG variants the Node decoder does not read (palette, 16-bit, interlaced) are forwarded unchanged when downscaling would be needed; the terminal then scales them. PNGs above 50 megapixels are refused to bound RAM and terminal image memory.
- GIF: the bytes up to the end of the first image plus the trailer are given to the browser, so the first frame is shown whatever the frame delays.
- Paths are resolved like Pi's `read` (`~` and a leading `@` accepted, relative to the working directory). The decode page uses puppeteer request interception: only its synthetic document and image are answered; every other request is aborted.

## Review findings

Low assurance: the plan and the orchestrator assignment specify focused checks plus the existing suites and no separate final review, so no independent review gate ran (0 retries). Self-check of the diff found no blocker.

## Failures and skipped checks

- First `npm run perf -- disk` attempt: harness failure (widget scrolled out of view), fixed in `scripts/perf/run.ts` and re-run to pass. No other failure.
- Not run: `npm run perf` input, idle, and active phases (unchanged code paths; the plan requires the disk phase only).

## Unverified areas

- Regular TUI mode was not exercised for `show_image` (the image row has no mode-specific rendering; widgets' regular-mode e2e still passes).
- Plain Ghostty without tmux, kitty as the tmux client, and a tmux window switch while an image is drawn hidden were not tested; the click re-send and `/widgets-refresh` paths are covered by unit and e2e tests.
- DNS rebinding between the address check and the connection remains possible, as accepted in the plan's Risks.
- Very large non-PNG images rely on Chromium's own decode limits; a 3840x2160 JPEG (5.6 MB) decoded in about 0.4 s including browser launch.
