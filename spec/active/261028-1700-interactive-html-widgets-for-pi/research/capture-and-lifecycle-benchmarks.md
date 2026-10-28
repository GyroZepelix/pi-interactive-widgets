<!-- Provenance: subagent `bench`, 2026-10-28. Scratch benchmarks run outside the repo in /tmp/pi-widgets-research/bench/.
     Inputs: discovery.md (D1-D13, O1-O3), wiki/raw/2026-10-27-poc-handoff.md (untrusted raw evidence), PoC ../pi-html-widget/index.ts (reference only).
     External sources (Ghostty, tmux, kitty diacritics, CDP protocol JSON) were read as data. -->

# Capture and lifecycle benchmarks (O1, O2, O3)

Date: 2026-10-28
Work item: `261028-1700-interactive-html-widgets-for-pi`
Scope: discovery only. No extension source was written; no repo file other than this one was changed.

## Key results

1. `HeadlessExperimental.beginFrame` cannot be used on macOS. Chromium 156 rejects it with "BeginFrameControl is not supported on MacOS yet" (Verified).
2. Use the launch flag `--force-device-scale-factor=2` instead of DPR emulation through `setViewport`. With the flag:
   - full-resolution (1440x612) screencast frames arrive;
   - concurrent screenshots no longer mis-scale input (60/60 correct, versus 5/60 with emulation);
   - screenshots are faster (50 ms instead of 67 ms).
   Per-page size still works through `Emulation.setDeviceMetricsOverride` with `deviceScaleFactor: 0`. (Verified)
3. Freezing a widget by minimizing its window is better than `Debugger.pause`. This assumes a browser launched without puppeteer's anti-throttling flags. The page uses 0 to 0.5% CPU for rAF, CSS, and setInterval pages, and thaws in about 13 ms. Input, screenshots, and evaluate still work. `Debugger.pause` leaves 2 to 4% CPU because compositor CSS animations keep running and frames keep coming, and it blocks evaluate (Verified).
4. Terminal cost of streaming 10 fps PNG (`t=d`, 56 KB per frame on the wire):
   - Ghostty: about 8% CPU (median);
   - tmux: about 1 to 2 points above a noisy baseline;
   - writer: about 1%.
   Raw+zlib frames are 23% smaller but cost about 16% CPU in the writer (Observed).
5. Ghostty is 1.4.0, not 1.3.1. The tmux client's `TERM_PROGRAM_VERSION` and the app bundle both report 1.4.0; only tmux's stale global environment still says 1.3.1. Ghostty 1.4.0 implements kitty animation (`a=f`, `a=a`, `a=c`, including in-place frame edits with `r=1`), so partial updates are feasible in principle. 1.3.1 rejected them as unimplemented (Verified by source and env; not exercised).
6. A Browser started by puppeteer over the default WebSocket transport survives a SIGKILL of its owner. Over `pipe: true` it exits with the owner (Verified).

## Environment

| Item | Value |
| --- | --- |
| Host | macOS arm64, 18 cores, other agents active (CPU numbers are relative) |
| Ghostty | 1.4.0 running (pid 9798, started 2026-10-27 21:48; tmux client env `TERM_PROGRAM_VERSION=1.4.0`; bundle `CFBundleShortVersionString` 1.4.0). tmux global env still reports 1.3.1, which is stale |
| tmux | 3.6b, server pid 16396, `allow-passthrough on`, `input-buffer-size 1048576`, cell 16x34 device px |
| Chromium | chrome-headless-shell 156.0.8078.47 (`headless: "shell"`), Chrome for Testing 156 for one launch comparison |
| Driver | puppeteer-core 25.16.0 (symlinked from ../pi-html-widget/node_modules), Node 26.8.2 |
| Widget size | 90x18 cells = CSS 720x306 at DSF 2 = 1440x612 device px |

## Method

- Every script ran under Node with `--hide-scrollbars --force-color-profile=srgb --disable-gpu` plus the variant flags.
- Frames stayed in RAM: no per-frame or per-snapshot files. The only files written are small JSON result files in the scratch dir.
- CPU: deltas of `ps -A -o pid,ppid,time` summed over the browser process tree (root = `browser.process().pid`), in percent of one core. Windows were 4 to 5 s after a 300 to 800 ms warm-up.
- Repetitions: 2 to 4 per variant, with order alternated between reps. Medians are reported; ranges are given where noise matters.
- Memory: RSS sum over the tree and `footprint` (phys_footprint) sum. RSS double-counts shared pages, so footprint is the better number.
- Input accuracy:
  - The page is a grid of colored targets that logs `mousedown` target id and client coordinates.
  - The expected target is read from the actual displayed frame: a PNG decoded in Node at the click's frame position.
  - Each test sends 18 grid clicks plus a burst of 60 clicks with random 0 to 30 ms gaps.
- Terminal cost:
  - Setup: a temporary 22-row split of my own visible pane (%397) in the attached client's current window.
  - The writer streamed at 10 fps for 5 s per variant, in the order idle, variants, reversed, idle. There were two runs.
  - The writer measured `ps` CPU deltas of the tmux server and Ghostty, and `process.cpuUsage()` for itself.
  - Image ids were random in 0xA00000 to 0xAFFFFF, deleted with `a=d,d=I` at the end.
  - The 1440x612 payload was shown scaled into 60x12 cells because the pane is 62 columns wide.
- Ghostty acceptance checks:
  - Screen capture is not permitted for this process, and tmux does not forward kitty replies.
  - Acceptance was therefore proven by a CPU signature: Ghostty CPU for 10 upload+delete pairs of a 3000x3000 image per variant, against a garbage-PNG control.

## Results

### Q1 Baseline `page.screenshot` PNG (`optimizeForSpeed`), DPR emulated via `setViewport` (3 reps)

| Page | Rate | Achieved fps | ms/frame median (max) | KB/frame | Browser-tree CPU % median (runs) |
| --- | --- | --- | --- | --- | --- |
| animating canvas | max | 15.1 | 66.9 (79) | 41.6 | 25.8 (25.8, 24.9, 27.2) |
| animating canvas | 10 fps | 10.1 | 53.9 (56) | 41.2 | 24.9 (24.9, 24.6, 26.4) |
| static | max | 20.1 | 50.1 (66) | 27.8 | 23.5 (22.9, 23.5, 26.1) |
| static | 10 fps | 10.0 | 23.9 (42) | 27.8 | 18.5 (18.5, 20.1, 17.9) |
| animating, no capture | - | - | - | - | 15.5 (15.1, 17.3, 15.5) |
| static, no capture / no pages | - | - | - | - | 0.0 |

The same capture with the flag-based DPR (`--force-device-scale-factor=2`) is in the table below. Its 2 reps are noisy; the Q9b row with 4 alternating reps is more reliable.

| Variant | fps | ms/frame median | CPU % |
| --- | --- | --- | --- |
| screenshot max | 20.0 | 50.0 to 50.3 | 17.9, 23.4 |
| screenshot 10 fps | 10 | 52.5 to 56.4 | 11.7, 19.9 |
| screenshot 10 fps (Q9b, 4 reps) | 10.7 | - | 20.7 (17.9 to 22.8), page alone 13.3 |

Notes:

- Screenshot latency is quantized to compositor frames (50 ms = 3 vsyncs, 67 ms = 4).
- Polling a static page costs about 2% CPU per captured frame/s because every screenshot forces a full redraw and PNG encode. A change signal is mandatory.

### Q2 `HeadlessExperimental.beginFrame` in chrome-headless-shell 156

| Probe | Result |
| --- | --- |
| `Target.createTarget({enableBeginFrameControl: true})` with `--enable-begin-frame-control` (alone, plus `--run-all-compositor-stages-before-draw`, `--deterministic-mode`, full flag set) | Error: "BeginFrameControl is not supported on MacOS yet" (all 4 flag sets) |
| `beginFrame` on a normal page, no flags | "Command is only supported if BeginFrameControl is enabled" |
| `beginFrame` on a normal page, `--enable-begin-frame-control` | "Command is only supported with --run-all-compositor-stages-before-draw" |
| `--deterministic-mode` on a normal page | Page target crashed ("Target closed") |
| CDP protocol JSON (devtools-protocol bundled with puppeteer 25.16) | `enableBeginFrameControl`: "headless shell only, not supported on MacOS yet" |

The rest of Q2 cannot run on this platform: hasDamage, screenshot DSF, latency, CPU at 2/10/30 Hz, rAF/CSS/timers/input, and the DPR bug under beginFrame. Q9(d) is also not applicable. The DPR-2 input bug itself was re-checked under Q3.

### Q3 Full-resolution screencast (animating page, 2 reps, every frame acked immediately)

| Variant | Format | fps | Frame size | KB/frame | CPU % | Page sees |
| --- | --- | --- | --- | --- | --- | --- |
| (a) DSF 2 emulation (`setViewport`) | png | 60 | 720x306 | 16.8 | 28.3, 29.6 | dpr 2, 720x306 |
| (a) same | jpeg q80 | 60 | 720x306 | 8.2 | 29.0, 29.0 | |
| (a) plus `maxWidth 1440, maxHeight 612` | png | 60 | 720x306 (no upscale) | 16.8 | 29.1, 29.1 | |
| (b) `--force-device-scale-factor=2 --window-size=720,306` | png | 60 | **1440x612** | 41.4 | 36.8, 38.1 | dpr 2, 720x306 |
| (b) same | jpeg q80 | 60 | 1440x612 | 19.0 | 34.3, 33.6 | |
| (c1) DSF 1, 1440x612, `Emulation.setPageScaleFactor(2)` | png | 60 | 1440x612 | 59.0 | 43.8, 43.8 | dpr 1, innerWidth 1440, visual viewport 720x306 scale 2 (layout is 1440 wide, only the top-left quarter is shown) |
| (c2) DSF 1, 1440x612, `html { zoom: 2 }` | png | 60 | 1440x612 | 59.0 | 43.3, 43.8 | dpr 1, innerWidth 1440 |

Input mapping (screencast running, PNG frame decoded to find the expected target):

| Variant | Mapping that works | Grid (18) | Burst (60) | Concurrent `page.screenshot` loop + 60 clicks |
| --- | --- | --- | --- | --- |
| (a) DSF emulation | CSS = device px / 2 | 18/18 | 60/60 | **5/60 correct** (13 screenshots overlapped; e.g. target 0 hit at clientX 90 instead of 180) |
| (b) flag, size via `setDeviceMetricsOverride(dsf 0)` 720x306 | CSS = device px / 2 | - | - | **60/60** (19 overlapping screenshots) |
| (b) flag, 480x170 page | same | - | - | 60/60 (21 shots), frames 960x340 |
| (b) flag, size via `Browser.setWindowBounds` 720x306 and 480x170 | same | - | - | 60/60 and 60/60 (19, 22 shots) |
| (b) flag, window-size only | CSS = device px / 2 | 18/18 | 60/60 | - |
| (c1) page scale | device px / 2 | 18/18 | 60/60 | - |
| (c2) CSS zoom | device px (1:1) | 18/18 | 60/60 | - |

Screencast pacing with (b) on the animating page:

| Mode | fps | CPU % |
| --- | --- | --- |
| nth=1 | 60 | 33.1, 33.4 (Q9b: 36.4, 4 reps) |
| `everyNthFrame` 6 | 10 | 18.2, 17.4 (Q9b: 25.1; Q9: 26.3) |
| `everyNthFrame` 30 | 2 | 16.2, 14.4 (Q9: 25.0) |
| ack delayed 100 ms | 25.9 (more than one frame in flight) | 23.6, 25.1 |
| ack-gated to 100 ms spacing (Q9b) | 11.4 | 24.9 |
| static page, nth=1 | 0 frames/s | 0.0, 0.5 |
| hover on static page (10 moves) | 9 frames, input-to-frame median 12.3 ms | - |

Findings:

- Only (b) gives full-resolution frames with a correct `devicePixelRatio` and layout.
- (c1) lays the page out at 1440 CSS px and (c2) reports dpr 1, so canvas and `vw` code written by the agent would be wrong.
- Screencast itself never mis-scaled input (all burst runs 60/60).

### Q4 Frame format for kitty (frames in RAM, Node 26, 3 reps, identical medians)

| Corpus | PNG KB | inflate ms | inflate + JS unfilter ms | RGB raw KB | zlib L1 ms / KB | zlib L6 ms / KB | base64 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| animating (60 screencast frames) | 40.3 | 0.35 | 5.5 | 2582 | 1.0 / 30.9 | 3.8 / 20.4 | below 0.05 |
| static (20 screenshots) | 27.8 | 0.30 | 5.5 | 2582 | 1.0 / 38.1 | 4.8 / 24.0 | below 0.05 |

Format support:

- Chromium's `optimizeForSpeed` PNG is 8-bit RGB with filter "Up" on every row. Raw-pixel transport therefore always needs an inflate plus an unfilter in Pi's process.
- Kitty / Ghostty accept `f=24` (RGB), `f=32` (RGBA), and `f=100` (PNG), with optional `o=z`. JPEG and WebP are not accepted (Ghostty `graphics_command.zig` Format enum). Screencast JPEG would need a decoder, so it is not an option.
- Ghostty decodes PNG with wuffs and stores RGBA: 3.5 MB per 1440x612 image.

### Q5 Terminal-side cost, 10 fps, 1440x612 animating frames (2 runs, 4 samples per variant except per-chunk with 2)

All values are CPU % of one core. Median with samples in parentheses.

| Variant | Wire KB/frame | Ghostty | tmux server | Writer (Pi stand-in) |
| --- | --- | --- | --- | --- |
| idle (placeholders on screen, no uploads) | 0 | 0.4 (0.6, 0.8, 0.2, 0.2) | 7.7 (9.6, 8.2, 7.2, 5.6) | 0.2 |
| PNG, 4096-byte chunks, one write per frame | 55.9 | 8.5 (7.4, 9.0, 8.0, 12.0) | 9.5 (11.8, 10.0, 8.6, 9.0) | 0.9 |
| PNG, 4096-byte chunks, one write per chunk | 55.9 | 8.0 (8.0, 8.0) | 10.6 (11.7, 9.4) | 1.1 |
| RGB + zlib L1 (`f=24,o=z`), chunks, one write per frame | 42.9 | 5.5 (4.6, 5.7, 5.2, 11.4) | 7.7 (8.4, 7.8, 7.4, 7.6) | 16.7 (18.7, 17.2, 16.1, 15.8) |
| PNG, whole payload in one APC (non-standard, above 4096) | 55.7 | 4.8 (4.6, 5.0, 4.6, 10.8) | 9.4 (9.0, 9.6, 9.2, 9.8) | 0.8 |

- The tmux baseline is 6 to 10% from other panes, so its marginal cost of about 1 to 2 points is within noise.
- In the second half of run 2, Ghostty rose for all variants (10.8 to 12.0), likely from user or other-pane activity.
- Acceptance check by Ghostty CPU, 10 upload+delete pairs of a 3000x3000 image (ms, two reps):

| Variant | Ghostty CPU ms |
| --- | --- |
| PNG chunked | 260, 240 |
| PNG one APC | 240, 220 |
| RGB+zlib chunked | 180, 160 |
| RGB+zlib one APC | 170, 150 |
| garbage PNG control | 20, 20 |
| nothing | 10, 0 |

All four real variants were decoded, so Ghostty accepts single payloads above 4096 bytes. The decode cost is about 24 ms per 9 MP PNG and about 17 ms per 9 MP RGB+zlib, which is about 2.4 ms and about 1.7 ms at 1440x612.

### Q6 Ghostty source desk-check (tags v1.3.1 and v1.4.0, `src/terminal/kitty/`)

| Topic | v1.3.1 | v1.4.0 (installed and running) |
| --- | --- | --- |
| `a=f` / `a=a` / `a=c` | Parsed, then answered "ERROR: unimplemented action" (`graphics_exec.zig` L71-74) | Implemented: `transmitAnimationFrame`, `controlAnimation`, `composeAnimation`, new `graphics_animation.zig`. `a=f` with `r=1` edits the root frame in place via `composeRect` at `x,y`; offsets clip; edits need no extra storage; the displayed frame's gap timer restarts on edit. Frames are stored as full RGBA (eager composition). |
| Partial update path | None | Upload base image once, then `a=f,i=<id>,r=1,x=..,y=..,s=..,v=..,f=24/100,o=z` with only the dirty rectangle. Unverified with Unicode placeholders through tmux; needs a dirty-rect source (screencast gives none). |
| `t=s` shared memory | Supported on POSIX with libc: `shm_open` read-only, `fstat`, `mmap`, then `shm_unlink` after reading (Ghostty owns cleanup) | Same, with extra name validation |
| Chunk size | Parser uses a growable ArrayList ("Kitty itself supports larger payloads"). Max image data 400 MB, max dimension 10000, storage limit 320 MB (`image-storage-limit`), oldest-first eviction | Same constants |
| tmux limit | `input-buffer-size` 1 MB per DCS sequence (3.6b), which caps a single-APC frame | - |

`t=s` feasibility:

- It works in principle on macOS, but Node cannot call `shm_open` without a native addon or helper process.
- Limit: POSIX shm names on macOS are limited to 31 characters.
- Expected benefit: it removes base64 (+33%) and about 56 KB/frame of tmux passthrough. It does not remove Ghostty's PNG decode.
- Measured tmux marginal cost is about 1 to 2 points and the writer about 1%, so the expected saving is a few percent of one core at 10 fps. That is not worth a native dependency for v1 (Unverified estimate).

### Q7 Launch time and memory (flag-based DPR 2)

| Measure | Value |
| --- | --- |
| chrome-headless-shell `puppeteer.launch` (warm, 5 runs) | 59 ms median (56 to 63) |
| Launch plus first PNG of a static widget | 118.5 ms median |
| Browser tree, 1 blank page | 4 processes, RSS sum 274 MB, footprint 62 MB |
| Browser tree, 0 pages | RSS 247 MB, footprint 48 MB |
| Chrome for Testing (new headless), first run / warm | 621 ms / 240 ms, RSS 545 MB, 6 processes |
| Cold launch after file-cache purge | Not measured (no sudo). The handoff's "about 3 s cold" is unverified. |

| Pages | Static widget: RSS / footprint MB, CPU % | Animating widget: RSS / footprint MB, CPU % |
| --- | --- | --- |
| 0 | 247 / 48, 0 | 247 / 48, 0 |
| 1 | 342 / 75, 0 | 351 / 84, 12.4 |
| 3 | 530 / 131, 0 | 562 / 165, 31.3 |
| 5 | 718 / 189, 0.5 | 786 / 256, 44.7 |
| 10 | 1187 / 329, 1.0 | 1331 / 465, 61.4 |

- Each page adds one renderer process.
- Incremental cost: about 28 MB footprint (94 MB RSS) per static widget and about 36 to 42 MB per animating widget.
- CPU of uncaptured animating pages grows sublinearly (shared GPU/viz process).

### Q8 Shared browser via `puppeteer.connect`

Client lifecycle (one client process per row, animating page; leaked = page targets left in the browser 1.5 s after the client ended):

| Context mode | Graceful `disconnect()` | `process.exit` | SIGKILL |
| --- | --- | --- | --- |
| `browser.newPage()` (default context) | 1 leaked | 1 leaked | 1 leaked |
| `browser.createBrowserContext()` | 1 leaked | 1 leaked | 1 leaked |
| raw `Target.createBrowserContext({disposeOnDetach: true})` + `Target.createTarget({browserContextId})` | 0 | 0 | 0 |

| Measure | Value |
| --- | --- |
| `puppeteer.connect` latency | 6.7 ms median (5.1 to 8.3, 14 samples) |
| Connect, new page, `setContent`, first screenshot | 73 ms |
| 5 live clients, then SIGKILL of all 5 (dispose contexts) | 5 pages, then 0 pages |
| Client process RSS (standalone Node + puppeteer) | 84 MB (irrelevant inside Pi, where puppeteer is in-process) |
| Owner SIGKILL, default WebSocket transport | Browser survives (orphan with 4 children) |
| Owner SIGKILL, `pipe: true` | Browser exits |

Leaked pages keep running, including their animation CPU. `disposeOnDetach` is a simple and complete cleanup: it is browser-enforced on any detach, including SIGKILL. Puppeteer does not expose it, so raw CDP is needed.

### Q9 Run-time states on the animating page (flag DPR 2, 3 reps alternating, 4 s windows)

| State | Browser CPU % median (runs) | rAF during 4.3 s | Timer ticks (10 Hz) during 4.3 s | Notes |
| --- | --- | --- | --- | --- |
| (a1) screencast 10 fps (nth 6) | 26.3 (25.6, 27.1, 26.3) | 261 | 43 | |
| (a2) `page.screenshot` 10 fps | 21.1 (21.1, 21.3, 20.9) | 264 | 44 | |
| (a3) screencast 2 fps (nth 30) | 25.0 (24.3, 25.0, 25.1) | 261 | 43 | nth does not save CPU |
| (b) running, no capture | 12.9 (12.9, 12.7, 12.9) | 262 | 43 | |
| (c) `Debugger.enable` + `Debugger.pause` | 2.2 (2.2, 2.2, 2.5) | 1 | 0 | Compositor CSS animation continues; screencast still delivered 36 frames in 600 ms |
| (d) begin-frame control, no frames | n/a | | | Unsupported on macOS (Q2) |
| (e) page closed | 0.0 | | | |
| (f) `Emulation.setVirtualTimePolicy pause` | 11.9 | 261 | 83 to 94 | No effect; timers ran faster |
| (g) window minimized (puppeteer default args) | 0.0 | 1 to 2 | 43 | Timers unthrottled |
| (h) window minimized, browser without anti-throttling flags | 0.0 | 0 to 1 | 5 | Timers throttled to about 1 Hz |
| (i) running, browser without anti-throttling flags | 12.6 | 261 | 43 | Visible pages unaffected |

Q9b capture strategies for 10 fps on the animating page (flag DPR 2, 4 reps alternating):

| Strategy | CPU % median (range) | fps |
| --- | --- | --- |
| page running, no capture | 13.3 (11.2 to 14.1) | 0 |
| `page.screenshot` at 10 fps | 20.7 (17.9 to 22.8) | 10.7 |
| screencast PNG, `everyNthFrame` 6 | 25.1 (22.6 to 26.6) | 10.6 |
| screencast PNG, ack-gated to 100 ms | 24.9 (22.6 to 26.6) | 11.4 |
| PoC: 64 px JPEG screencast signal + screenshot when dirty (max 10 fps) | 24.1 (23.4 to 28.1) | 10.5 |
| screencast PNG, every frame | 36.4 (35.6 to 38.1) | 64 |

Thaw and revive latency (8 or 10 samples):

| Transition | Median ms (range) |
| --- | --- |
| Minimized (throttling allowed): restore window + mouse move, until first screencast frame | 13.5 (6.5 to 16) |
| Minimized (default args): same | 13.8 (5.8 to 15.7) |
| `Debugger.disable` + mouse move, until next frame | 6.4 (2.4 to 17.3), not meaningful because frames kept flowing while paused |
| Revive: `newPage` + `setContent` + `page.screenshot` (warm browser) | 73.3 (72.2 to 90.4) |
| Revive: `newPage` + start screencast + `setContent`, until first frame | 44.4 (43.8 to 58.1) |

### Q10 Cheaper idle stopping (3 reps)

| Page | Browser | Running | Minimized | Debugger pause |
| --- | --- | --- | --- | --- |
| setInterval(16 ms) canvas drawing | puppeteer default args | 17.1% (59 ticks/s) | 6.2% (59 ticks/s) | 0.0% (0.2 ticks/s) |
| same | without `--disable-renderer-backgrounding`, `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows` | 17.1% | **0.5% (1.3 ticks/s)** | 0.0% |
| CSS animation only | default args | 4.0% | 0.0% | 4.2% |
| same | throttling allowed | 4.0% | 0.2% | 4.0% |

Minimized-window properties:

- The page reports `visibilityState hidden` and `document.hidden true`, and rAF stops.
- Freezing is per window: a second page in the same browser kept 61 rAF/s.
- `Input.dispatchMouseEvent` still reaches a minimized page.
- `page.screenshot` while minimized returns a full frame (41.6 KB), so a still can be taken without a thaw.
- After a restore with `windowState: normal`, the page reports visible, 720x306, dpr 2.

Other mechanisms:

- `Page.setWebLifecycleState` frozen was rejected by the handoff (rAF never resumes) and was not retested.
- `Emulation.setCPUThrottlingRate` was rejected by the handoff.
- Virtual time pause has no effect (Q9 f).
- `Animation.setPaused` affects CSS/Web Animations only, not rAF or timers; not tested.
- `Target.createTarget({background: true})` is documented as not supported by headless shell; not tested.

## Conclusions

Verified (measured or reproduced here):

- V1. `HeadlessExperimental.beginFrame` / begin-frame control is unavailable on macOS in chrome-headless-shell 156, and `--deterministic-mode` crashes page targets.
- V2. DPR emulation through `setViewport` / `setDeviceMetricsOverride(deviceScaleFactor 2)` causes both problems seen in the PoC:
  - half-size screencast frames;
  - mis-scaled input during in-flight screenshots (5/60 correct).
  `--force-device-scale-factor=2`, with per-page size via `setDeviceMetricsOverride(deviceScaleFactor 0)` or `Browser.setWindowBounds`, gives full-resolution screencast and screenshots with correct input (60/60 in 4 runs under concurrent screenshots) and faster screenshots (50 ms, 20 fps max).
- V3. Screencast emits 0 frames for an unchanged page and about 12 ms input-to-frame latency on change. There is no self-trigger loop when screencast is the only capture path.
- V4. Chromium PNGs are RGB with the Up filter. Ghostty accepts `f=100`, `f=24/32` with `o=z`, and single APC payloads above 4096 bytes (CPU signature), and decodes them all.
- V5. Ghostty 1.4.0 is running and its source implements kitty animation frames and in-place frame edits. 1.3.1 did not.
- V6. Minimizing a widget's window stops rAF, compositor animations, and capture, cutting a page to 0 to 0.5% CPU. Setting: the browser launches without puppeteer's three anti-throttling flags.
  - Timers drop to about 1 Hz.
  - Thaw takes about 13 ms.
  - Input, evaluate, and screenshots keep working.
  - `Debugger.pause` leaves compositor animations and frame production running (2 to 4%) and blocks evaluate.
- V7. `disposeOnDetach` browser contexts are cleaned up on disconnect, exit, and SIGKILL of a `connect()`ed client. Other contexts leak running pages.
- V8. A puppeteer-launched browser over WebSocket outlives a SIGKILLed owner; with `pipe: true` it exits.
- V9. Warm chrome-headless-shell launch is about 60 ms (about 120 ms to first frame). The per-page footprint is about 28 to 42 MB, and the browser baseline footprint is about 48 to 62 MB.

Observed (single machine, noisy, few samples):

- O-a. At 10 fps on a continuously animating page, `page.screenshot` costs about 4 to 5 points less than full-resolution screencast (21 vs 25 to 26%, 7 reps over Q9/Q9b). Q3b's 2 reps showed the reverse, so the gap is real but small. The uncaptured page itself costs about 13%.
- O-b. Screencast `everyNthFrame` barely reduces CPU (2 fps costs about the same as 10 fps). Chromium seems to pay per compositor frame.
- O-c. Ghostty CPU at 10 fps is about 8% for standard chunked PNG and about 5% for single-APC PNG or RGB+zlib. tmux adds about 1 to 2 points over its baseline. The Pi-side writer costs about 1% for PNG and about 16% for decoding to raw plus zlib.
- O-d. Raw+zlib L1 is 23% smaller than PNG for animating frames but 37% larger for static UI frames.

Unverified:

- U-a. Partial updates via `a=f,r=1` dirty rectangles with Unicode placeholders through tmux on Ghostty 1.4.0, and their benefit.
- U-b. `t=s` benefit (estimated a few percent at 10 fps) and its native-addon cost.
- U-c. Cold-start launch time.
- U-d. Long-run behavior of minimized pages, such as Chrome's intensive timer throttling after 5 minutes hidden. That throttling would only reduce CPU further.
- U-e. Visual correctness of single-APC and RGB+zlib frames: acceptance was shown by decode CPU, not by pixels.

## Implications and recommendation (KISS + performance)

### O1 capture and transport

Recommendation:

- Launch chrome-headless-shell with `--force-device-scale-factor=<device px per CSS px>` (2 here). Size each widget page with `Emulation.setDeviceMetricsOverride({width, height, deviceScaleFactor: 0, mobile: false})`. Never emulate DPR.
- Use one full-resolution PNG `Page.startScreencast` per live widget as both change signal and frame source. Pace it by delaying the ack (ack-gated, for example 100 ms at 10 fps, shorter while the user is interacting).
  - It costs nothing on static pages.
  - The first frame after an input arrives in about 12 ms.
  - There is no self-trigger loop, no frozen-capture hang, and no input-race serialization requirement (V2, V3).
- Optional optimization, only if measurements later matter: on a continuously animating page, a screenshot at the target rate saves about 4 to 5 points of one core (O-a). The PoC's tiny-signal-plus-screenshot scheme did not beat plain screencast (24.1 vs 24.9%).
- Transport: PNG `f=100` with `t=d`, base64, standard 4096-byte chunks, tmux DCS-wrapped, one stdout write per frame. Skip uploads of byte-identical frames.
  - Pi-side cost is about 1% and Ghostty's about 8% at 10 fps.
  - Do not decode to raw+zlib: it adds about 16% CPU in Pi's process to save 23% of bytes, and grows static frames.
  - Single-APC payloads lowered Ghostty CPU in this run but violate the spec's 4096 guidance. Treat them as a later Ghostty-specific knob after visual verification.
- Defer partial updates (`a=f,r=1`, Ghostty 1.4.0) and `t=s`. Both need extra machinery (dirty-rect detection, native addon) for a gain of a few percent (U-a, U-b).
- Expected active budget for one animating widget at 10 fps: Chromium 21 to 26%, Ghostty about 8%, tmux about 1 to 2%, Pi about 1%, so about 31 to 37% of one core. Static or idle widgets cost about 0%. At most one widget should be active at a time.
- Correction for discovery.md: the environment fact "Ghostty 1.3.1" is stale. Ghostty 1.4.0 is running, and the placeholder-squash bug (handoff 4.1) may be fixed; worth a re-check.

### O2 process model

Recommendation: one chrome-headless-shell per Pi session.

- Launch it lazily on the first widget, about 60 ms warm, with `pipe: true` so a SIGKILLed Pi cannot orphan it (V8).
- Do not pass the three anti-throttling flags (V6).
- Close it when the session has no live or frozen pages left, or on `session_shutdown`.

Rationale:

- A shared browser would save only the baseline footprint, about 48 to 62 MB per extra session (about 200 MB at 5 sessions). Pages dominate memory anyway (28 to 42 MB each).
- A shared browser needs an owner process, endpoint discovery, idle shutdown, a single crash domain, and a single DPR flag for all sessions.

If sharing is ever needed, use raw `Target.createBrowserContext({disposeOnDetach: true})` per client, which makes leak cleanup automatic (V7).

### O3 run-time policy

Recommendation: live, then minimized (frozen), then closed.

- Active (focused, or within a short grace after the last input): screencast ack-gated at 10 to 15 fps.
- Not interacting or off-screen: stop the screencast and minimize the widget's window. The page drops to 0 to 0.5% CPU, timers to about 1 Hz, and memory is kept.
  - The still already exists in RAM as the last frame, or comes from `page.screenshot` while minimized.
  - Thaw on hover, click, or scroll-into-view by restoring the window: about 13 ms to the first new frame.
  - This replaces `Debugger.pause` (V6). Evaluate and `pi.send` bridges keep working while frozen.
- A background 2 fps rate for visible but unfocused animating widgets costs about 13% (page running) plus 2 to 12% capture per widget. If the user wants background motion, cap it to one widget. The cheap default is to minimize after the grace period.
- Closed: after long idle or under a per-session page cap, close the page. This frees 28 to 42 MB and costs 0 CPU. Revive costs about 45 to 75 ms plus state reset (D7).

The grace period, per-session cap, and close timeout remain user decisions for round 2. The data supports short timeouts because thaw is cheap (13 ms) and revive is cheap (under 100 ms warm).

## Scratch scripts (outside the repo)

All under `/tmp/pi-widgets-research/bench/`. Output logs are `q*.out` and `q5-*.json`.

| Script | Purpose |
| --- | --- |
| `common.mjs` | Launch helper, process-tree CPU/RSS, test pages, minimal PNG decoder |
| `q1-screenshot.mjs` | Q1 screenshot baseline |
| `q2-beginframe-probe.mjs`, `q2-beginframe-probe2.mjs` | Q2 begin-frame probes |
| `q3-screencast.mjs` | Q3 screencast variants (a, b, c1, c2), input mapping, concurrent-screenshot control |
| `q3b-forcedsf.mjs` | Q3 flag-DPR sizing, input under concurrent screenshots, pacing, hover latency |
| `q4-format.mjs` | Q4 PNG vs raw+zlib |
| `q5-writer.mjs` | Q5 terminal-cost writer, run in a temporary visible pane |
| `q5-verify.mjs`, `q5-verify-mem.mjs` | Q5 reply probe (no replies via tmux), Ghostty acceptance by CPU signature |
| `q7-launch-pages.mjs`, `q7b-cft-launch.mjs` | Q7 launch time and per-page memory/CPU |
| `q8-shared.mjs`, `q8b-orphan.mjs` | Q8 shared-browser lifecycle, orphan check |
| `q9-freeze.mjs`, `q9b-capture-cost.mjs` | Q9 states, thaw, revive, capture strategies, minimize isolation |
| `q10-idle.mjs` | Q10 idle mechanisms on setInterval and CSS pages |

Ghostty and tmux sources fetched for the desk-check are in `/tmp/pi-widgets-research/ghostty/`.

## Cleanup

- No chrome-headless-shell or Chrome for Testing processes ran before the benchmarks (`pids-before.txt` empty), and none remained after.
- All temporary tmux panes (%402 and later) exited and were checked with `tmux list-panes`.
- Every uploaded image id (0xA00000 to 0xAFFFFF range) was deleted with `a=d,d=I`.
- `$TMPDIR/pi-html-widget` was not touched.
