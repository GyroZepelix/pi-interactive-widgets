# Independent architecture review

Date: 2026-10-28

Scope: desk research only. No benchmarks were run. The local PoC handoff was treated as untrusted evidence and was used only where explicitly identified.

## Evidence labels

- **Verified**: directly supported by current source code, official documentation, or a clearly identified local PoC observation.
- **Unverified**: an inference, expected performance characteristic, or design recommendation that still requires a local benchmark on Ghostty 1.3.1, tmux 3.6b, macOS arm64, and the Pi workload.

## Executive conclusion

The best KISS primary architecture is:

1. One lazily started `chrome-headless-shell` process per Pi session, shared by that session's widgets.
2. One isolated page or browser context per live widget.
3. A low-resolution `Page.startScreencast` only as an invalidation signal.
4. A full-resolution PNG from `Page.captureScreenshot` or Puppeteer's equivalent only when dirty, with all capture and input operations serialized per widget.
5. Kitty Unicode placeholders with stable, session-namespaced image ids.
6. Full-image replacement, not partial-image commands, because Ghostty 1.3.1 does not execute Kitty animation frame or composition actions.
7. PNG direct-data transport (`t=d,f=100`) as the initial no-native-code path. Keep transport behind an interface and benchmark PNG shared memory (`t=s,f=100`) as the first optimization.
8. At most one actively repainting widget per Pi session. Freeze off-screen and inactive pages quickly, then close them by LRU policy so 3-5 sessions do not retain many Chromium renderers.

This is not the theoretically fastest renderer. CEF or Electron off-screen rendering can expose paint callbacks and dirty rectangles without explicit screenshots. However, Ghostty 1.3.1 cannot consume partial Kitty frame updates, so those dirty rectangles only improve capture scheduling, not terminal bandwidth. The native packaging, lifecycle, and input complexity is not justified until a local A/B test proves screenshot capture is the dominant bottleneck.

The fallback architecture is an Electron off-screen helper using its `paint` event and `dirtyRect`, while retaining the same Pi component, input router, runtime policy, and Kitty transport layer. Electron is a simpler fallback than a custom CEF application, although it is likely heavier in memory.

## 1. Rendering engine evaluation

### 1.1 Capability matrix

| Engine or API | JS/CSS fidelity | Frame and damage API | Input injection | macOS packaging and maturity in 2026 | CPU and memory assessment | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Chromium `Page.captureScreenshot` / `page.screenshot` | **Verified:** current Chromium fidelity, including canvas and modern JS/CSS. | **Verified:** full encoded PNG/JPEG/WebP image; optional clip, but no compositor dirty rectangles. [S1] | **Verified:** CDP `Input` or Puppeteer mouse/keyboard APIs. | **Verified:** already available in the target environment through `chrome-headless-shell`; Puppeteer is a mature control layer. | **Verified locally:** the handoff reports about 50 ms per 1440x612 PNG, 15-24% Chromium CPU while actively capturing, and about 1% while debugger-paused. Full process-tree memory was not measured. | **Primary.** It has the best evidence-to-complexity ratio. |
| Chromium `HeadlessExperimental.beginFrame` | **Verified:** same Chromium fidelity. | **Verified:** deterministic begin-frame request and optional screenshot, but only a boolean `hasDamage`, not dirty rectangles. [S2] | **Verified:** normal CDP input. | **Verified:** target creation requires `enableBeginFrameControl`; CDP documents this as headless-shell only and not supported on macOS. [S3] | **Unverified:** could avoid unnecessary captures where supported, but it cannot be the macOS primary. | **Reject for this target.** |
| Chromium `Page.startScreencast` | **Verified:** Chromium-rendered full PNG/JPEG frames, acknowledged by the client; no damage rectangle in the protocol. [S1] | **Verified:** frame stream plus metadata, not dirty rectangles. | **Verified:** normal CDP input. | **Verified:** available and already exercised by the PoC. | **Verified locally:** full-resolution frames ignored device scale factor in the tested Chromium 156 setup. A tiny screencast worked as a change signal but produced a screenshot self-trigger loop that required suppression. | **Use only as invalidation signal.** |
| CEF off-screen rendering | **Verified:** Chromium/Blink/V8 fidelity, subject to the bundled CEF branch. | **Verified:** `OnPaint` receives a complete BGRA buffer plus dirty rectangles; popups have separate callbacks. Accelerated paint can expose IOSurface on macOS. [S4] [S5] | **Verified:** explicit mouse, wheel, focus, key, and IME APIs. [S5] | **Verified:** mature, but requires a native C++/Objective-C++ helper, CEF resources and helper processes, signing, and careful event-loop ownership. | **Unverified:** likely lower capture overhead than CDP screenshots, but total Chromium process memory remains substantial. | **Performance candidate, not KISS v1.** |
| Electron off-screen rendering | **Verified:** Chromium fidelity. | **Verified:** `paint` emits a full `NativeImage` and a dirty rectangle. Shared-texture mode exists but is experimental. [S6] | **Verified:** `webContents.sendInputEvent` handles mouse, wheel, and keyboard events. [S7] | **Verified:** mature application framework and easiest JS implementation of OSR, but it bundles Electron/Chromium and requires a helper application. | **Unverified:** likely avoids screenshot round trips, but probably has higher baseline memory than a bare headless shell. | **Fallback architecture.** |
| macOS `WKWebView.takeSnapshot` helper | **Verified:** Safari/WebKit fidelity, not Chromium fidelity. | **Verified:** asynchronous snapshot API, intended for snapshots rather than continuous frame delivery; no public dirty-rect callback. [S8] | **Verified:** no public WKWebView API for trusted targeted mouse/keyboard injection; synthetic DOM events or AppKit events are incomplete substitutes. | **Verified:** small native integration and system-provided engine, but hidden/off-screen rendering and snapshot behavior are not a robust streaming contract. | **Unverified:** potentially low memory due to system WebKit processes, but high-rate snapshot cost and hidden throttling are risks. | **Reject.** Input and streaming semantics are insufficient. |
| Ultralight 2.x | **Verified:** broad HTML/CSS/JS support, but not full current-browser compatibility; missing features include WebGL/WebGPU and some browser APIs. [S9] | **Verified:** CPU surfaces expose dirty bounds and dirty rectangles; native input APIs are provided. [S10] | **Verified:** explicit mouse, scroll, key, and IME integration. | **Verified:** macOS arm64 support, commercial licensing, and a 2.0 line still described as beta in 2026. [S9] [S10] | **Unverified:** designed to be lighter than Chromium, but the free tier and lack of JIT/media features can change performance and fidelity. | **Reject for v1.** Attractive later for controlled widgets if fidelity requirements are narrowed. |
| Servo | **Verified:** modern SpiderMonkey and substantial HTML/CSS support, but incomplete web compatibility. | **Verified:** embedding and off-screen rendering APIs exist; APIs are still evolving. [S11] | **Verified:** embedder-facing event and JavaScript interfaces exist, but integration is Rust-centric. | **Verified:** active macOS development in 2026, but not a production-hardened drop-in webview. | **Unverified:** may eventually be lighter, but software headless rendering and integration cost are material risks. | **Reject for v1.** |
| Blitz | **Verified:** HTML/CSS renderer with no general-purpose page JavaScript engine. [S12] | **Verified:** image/off-screen-oriented rendering is supported. | **Verified:** native/Rust interaction, not arbitrary browser JS behavior. | **Verified:** evolving beta renderer. | **Unverified:** potentially light, but irrelevant because agent-generated JS is a core requirement. | **Disqualified.** |
| Ladybird | **Verified:** real independent HTML/CSS/JS engine, but still pre-alpha and without a supported stable embedding SDK. [S13] | **Verified:** developer headless screenshots exist; no stable OSR contract for this product. | **Unverified:** internal APIs could be adapted, but not as a maintained public interface. | **Verified:** active macOS development, high build and maintenance burden. | **Unverified:** no credible basis for lower total cost in this use case. | **Reject for 2026 v1.** |
| Qt WebEngine | **Verified:** Chromium fidelity. | **Verified:** QWidget grabs and Qt Quick redirection exist, but public WebEngine APIs do not expose Chromium compositor dirty rectangles cleanly. [S14] | **Verified:** Qt event injection is possible. | **Verified:** large Qt/Chromium bundle, helper resources, signing, and WebEngine-specific deployment work. | **Unverified:** no clear performance advantage over Electron or CEF for this project. | **Reject.** More framework than needed. |
| WPE WebKit | **Verified:** WebKit engine with buffer and damage APIs on supported platforms. | **Verified:** WPEPlatform can expose buffers and damage. | **Verified:** native input event APIs. | **Verified:** official support remains Linux-oriented, not macOS. [S15] | Not applicable to the target. | **Reject.** |

### 1.2 Why CEF is not the default despite better damage information

CEF's `OnPaint` contract is technically ideal: browser-grade rendering, a full BGRA backing buffer, dirty rectangles, explicit popup painting, and direct input injection. [S4] [S5] Brow6el demonstrates that this model works for a graphical terminal browser. [S24]

The decisive constraint is downstream. Ghostty 1.3.1 parses Kitty animation and composition commands, but executing `a=f`, `a=a`, and `a=c` returns `ERROR: unimplemented action`. [S18] Therefore a CEF dirty rectangle cannot be sent as a native partial update to the existing single Kitty image. The implementation would still need to encode and replace a full image, or introduce a tiled multi-image scheme.

A tiled scheme is possible in principle: divide the widget into fixed cell-aligned images, map dirty rectangles to tiles, and replace only dirty tile ids. **Unverified:** this could reduce bytes for sparse updates. It also multiplies image ids, placements, bookkeeping, and failure modes, so it is not KISS for v1.

### 1.3 Why Electron is the fallback

Electron provides the most direct experiment if screenshot capture is too costly:

- JavaScript control code fits the project skill set.
- The `paint` event is naturally damage-driven.
- `webContents.sendInputEvent` avoids CDP screenshot/input overlap.
- The Pi-side component and Kitty renderer can remain unchanged.

The fallback should initially use the CPU bitmap path and full-frame PNG or raw-pixel experiments. Electron shared textures require native IOSurface handling and are not justified when the final terminal protocol still consumes CPU-visible image data. [S6]

## 2. Terminal transport

### 2.1 What Ghostty 1.3.1 actually supports

The following is source-verified for tag `v1.3.1`:

| Feature | Ghostty 1.3.1 status | Evidence |
| --- | --- | --- |
| PNG `f=100` | **Verified supported.** PNG is decoded to RGBA. | [S16] [S17] |
| Raw RGB `f=24` and RGBA `f=32` | **Verified supported.** Dimensions and exact byte length are validated. | [S16] [S17] |
| Zlib `o=z` | **Verified supported.** Ghostty decompresses an RFC-style zlib stream before validation. | [S16] [S17] |
| Direct data `t=d` | **Verified supported.** Payload is base64-decoded by the parser and accumulated for chunked transmission. | [S16] |
| POSIX shared memory `t=s` on macOS | **Verified supported.** Ghostty calls `shm_open`, maps the object, copies the selected bytes into owned memory, then unlinks it. | [S17] |
| Kitty frame transmission and composition | **Verified not implemented.** Animation frame, animation control, and composition actions return an error. | [S18] |
| True zero-copy shared memory | **Verified not provided.** The mapped bytes are copied into Ghostty-owned storage before decode/use. | [S17] |

Consequences:

1. `t=s` can remove bulk image bytes and base64 from the terminal stream, but it does not eliminate Ghostty's copy or PNG decode.
2. Raw shared memory avoids PNG decode but moves the full 3 or 4 bytes per pixel and still copies it inside Ghostty.
3. Native Kitty partial-frame updates are unavailable on the pinned Ghostty version.
4. Replacing a complete image under the same id remains the practical live-update mechanism.

### 2.2 Transport options

| Transport | Pipeline | Advantages | Costs and risks | Recommendation |
| --- | --- | --- | --- | --- |
| PNG direct data | Chromium PNG -> base64 -> tmux DCS passthrough -> Ghostty PNG decode | **Verified:** simplest, no native code, no disk, already works in the PoC. Chrome's encoded PNG passes through without image transcoding. | **Verified:** base64 expands bytes by about one third; tmux and Ghostty parse/copy the stream. Local handoff measured roughly 10% tmux and 9% Ghostty CPU during active hover, but the measurement was short and workload-specific. | **Primary v1 path.** |
| Raw RGB/RGBA plus zlib, direct data | Decode or obtain pixels -> zlib -> base64 -> terminal | Can avoid PNG codec behavior and may encode faster for some UI frames. Kitty and Ghostty support it. [S19] | With screenshot-based Chromium, PNG must first be decoded to pixels, adding work. Compression ratio and CPU are content-dependent. | **Do not use with screenshot primary without a benchmark win.** More promising with CEF/Electron raw buffers. |
| PNG shared memory | Chromium PNG -> POSIX shm -> tiny `t=s` command through tmux -> Ghostty copies and decodes | Removes base64 encoding and almost all bulk tmux traffic while preserving compact PNG bytes. Ghostty 1.3.1 supports it. | Node has no built-in POSIX shm API. Requires a native addon or persistent helper, unique names, cleanup, and capability probing. | **First optimization to benchmark.** Prefer a small standalone helper over an ABI-sensitive Node addon. |
| Raw or zlib raw shared memory | Renderer pixels -> optional zlib -> POSIX shm -> Ghostty | Avoids base64 and can pair naturally with CEF/Electron paint buffers. | Uncompressed 1440x612 RGBA is about 3.36 MiB per frame. Zlib adds encode/decode CPU. Ghostty still copies the mapped data. | **Fallback-renderer experiment only.** |

**Unverified recommendation:** a persistent, tiny macOS helper is the least fragile way to test `t=s`. It should accept length-prefixed frame bytes over a pipe or Unix socket, create a unique POSIX shm object, return its name, and leave APC emission to the Pi process so terminal writes remain ordered. It should be added only if the end-to-end benchmark beats `t=d` materially.

### 2.3 tmux 3.6b cost

In tmux 3.6b, a `tmux;` DCS is recognized and the inner sequence is forwarded as a raw string to eligible clients. With `allow-passthrough on`, the pane must be visible in the client's current window; `all` also permits invisible panes. The raw payload is copied into each eligible client's output buffer; tmux does not decode and re-encode the inner Kitty data. [S20] [S21] [S22]

Therefore:

- **Verified:** enabling passthrough is not a continuous idle cost.
- **Verified:** active cost scales with payload bytes and eligible attached clients.
- **Verified:** the DCS wrapper overhead is small relative to PNG base64; the dominant tmux cost is copying and buffering the bulk stream.
- **Unverified:** `t=s` should reduce tmux CPU substantially because only a short shared-memory name crosses the DCS path. The total system gain must be measured because the helper and Ghostty still copy data.

Use `allow-passthrough on`, not `all`, for the primary design. Hidden panes should not stream frames at all.

### 2.4 Existing terminal browser precedents

| Project | Relevant architecture | Lesson for this project |
| --- | --- | --- |
| konaito `terminal-browser` | Puppeteer/CDP `Page.startScreencast`, PNG direct-data Kitty frames, duplicate suppression, and terminal input forwarded to CDP. [S23] | Validates the stock-Chromium plus Kitty approach, but it is a full-screen browser and does not solve Pi transcript placement or Ghostty 1.3 partial updates. |
| Termium | Per-client Chromium/Puppeteer server, client-paced `CaptureScreenshot`, PNG passthrough for Kitty, bounded latest-frame queues, and separate input ordering. [S25] | Strong precedent for screenshot pacing, latest-wins backpressure, and keeping terminal output owned by one event loop. |
| Brow6el | CEF OSR `OnPaint` with dirty rectangles, Sixel/Kitty renderers, and native input. [S24] | Demonstrates the lower-level performance path. Its dirty-region benefits map better to Sixel tiles than to Ghostty 1.3 Kitty images. |
| Awrit | Electron off-screen rendering plus a Rust native terminal/graphics layer; repository archived with a security warning in 2026. [S26] | Demonstrates Electron OSR feasibility but also the maintenance cost of a mixed Electron/native stack. |
| Carbonyl | Deep Chromium fork that extracts paint/text data and renders terminal-native output through Chromium internals and shared memory. [S27] | High performance potential, but far outside KISS and expensive to track across Chromium releases. |

## 3. Process model for 3-5 Pi sessions

### 3.1 Options

| Model | Memory and CPU | Failure isolation | Complexity | Assessment |
| --- | --- | --- | --- | --- |
| One browser per widget | Repeats browser base processes and is clearly the highest-memory option. | Excellent. | Simple local ownership, but wasteful. | Reject. |
| One browser per Pi session, one page/context per widget | Shares browser infrastructure within a session. Lazy startup and full shutdown are straightforward. | A browser crash affects one Pi session only. | Lowest coordination complexity; no daemon protocol or cross-session ownership. | **Primary.** |
| One shared daemon for all Pi sessions | **Unverified:** should save some browser-process memory and may reduce aggregate idle overhead. Renderer processes and page memory still scale with widgets. | A daemon failure affects all sessions. Version mismatch and stale-client cleanup become system-wide concerns. | Requires discovery, authentication/ownership, socket protocol, reconnects, output routing, upgrade coordination, and orphan recovery. | Reject for v1; reconsider only if measured memory is unacceptable. |

### 3.2 Recommended ownership

Each Pi process should own:

- one lazy browser controller;
- one browser process at most;
- one isolated page or browser context per retained widget;
- the terminal image-id namespace;
- all terminal writes;
- its RAM stills and source metadata;
- browser shutdown during `session_shutdown`.

Do not run one browser per widget. Do not begin with a cross-session daemon.

**Unverified memory policy:** start with a maximum of one active page and two additional frozen pages per session. Close older pages by LRU and retain only the RAM still plus persisted source. Shut the browser down when no pages remain. This turns worst-case memory into a policy choice instead of allowing every transcript widget to retain a renderer.

## 4. Runtime policy

### 4.1 State machine

```text
closed
  source persisted, optional RAM still, no browser page
    |
    | click / focus
    v
thawing
  lazy browser or page creation, initial capture
    |
    v
active
  focused or pointer-active, damage-driven capture, input enabled
    |
    | short inactivity or pointer leaves
    v
warm
  brief grace period, reduced frame cap
    |
    | off-screen or idle deadline
    v
frozen
  Debugger.pause, no screencast, no capture, last frame retained
    |
    | LRU, long idle, or browser shutdown
    v
closed
```

### 4.2 Capture and pacing rules

1. **Verified:** use a latest-wins queue. Never allow more than one capture or frame preparation in flight per widget.
2. **Verified locally:** serialize screenshot, mouse, keyboard, resize, freeze, and thaw operations per widget. This avoids the observed device-scale-factor input bug during screenshots.
3. **Verified locally:** ignore screencast invalidations generated while a screenshot is in flight, compare the resulting PNG with the last frame, and allow at most one follow-up capture when a real change remains.
4. **Unverified starting cap:** 8-12 fps for the one active widget. The measured screenshot ceiling was about 12 fps, and cell-precision input does not justify a 30-60 fps target.
5. **Unverified starting cap:** 2 fps during a 1-2 second warm grace period.
6. Zero captures while frozen or off-screen.
7. Coalesce mouse movement so only the latest pending cell coordinate is dispatched.
8. Give input priority over capture. If input arrives while a capture is pending but not started, dispatch input first, then capture the resulting frame.
9. Use one session-wide capture semaphore even when several pages exist. Multiple simultaneous screenshots would increase CPU and input latency without improving the visible transcript.

### 4.3 Freeze, close, and off-screen behavior

- **Verified locally:** `Page.setWebLifecycleState({state:"frozen"})` did not recover requestAnimationFrame and mouse behavior reliably in Chromium 156. Do not use it.
- **Verified locally:** `Debugger.enable` plus `Debugger.pause`, thawed with `Debugger.disable`, preserved page state and reduced the tested animated page from about 8% to about 1% Chromium CPU.
- Stop the screencast before or as part of freezing. Do not attempt a screenshot while paused.
- Freeze an off-screen widget promptly. **Unverified starting value:** 250-500 ms after it leaves the viewport, to avoid churn during a scroll.
- Freeze a visible but unfocused animated widget after a short grace period. Static widgets naturally stop after duplicate suppression.
- Close frozen pages by LRU. **Unverified starting values:** close off-screen pages after 60-120 seconds, visible frozen pages after 5 minutes, or earlier when the per-session retained-page cap is exceeded.
- Exit Chromium when the last page closes. Reviving recreates the page from persisted source and resets JS state.

These values are intentionally aggressive. The requirement is near-zero idle CPU across 3-5 sessions, which cannot be met by leaving many animated renderers alive even if capture is stopped.

## 5. Recommended architecture

### 5.1 Primary

```text
Pi extension process
  |
  +-- InlineWidget component
  |     placeholders, focus, mouse/key routing, visibility signal
  |
  +-- SessionWidgetManager
  |     state machine, LRU, one active widget, image-id namespace
  |
  +-- ChromiumRenderer (lazy, one browser per Pi session)
  |     one context/page per retained widget
  |     tiny startScreencast invalidation signal
  |     serialized Input + captureScreenshot PNG
  |     Debugger.pause / Debugger.disable freeze-thaw
  |
  +-- FrameScheduler
  |     latest-wins, one capture in flight, global session semaphore
  |     byte-identical suppression, 8-12 fps active cap
  |
  `-- KittyTransport
        v1: t=d,f=100 PNG, same image id, Unicode placeholders
        experiment: t=s,f=100 through a persistent POSIX-shm helper
        tmux DCS passthrough on visible panes only
```

Why this is primary:

- It reuses the installed browser and Node control stack.
- It is the only architecture with local feasibility and performance evidence.
- It keeps native code optional.
- Its idle behavior can be bounded by policy rather than by hoping browser throttling is sufficient.
- It preserves a clean upgrade path to shared-memory transport or Electron OSR without rewriting Pi integration.

### 5.2 Fallback

```text
Pi extension process
  |
  +-- same InlineWidget, SessionWidgetManager, FrameScheduler, KittyTransport
  |
  `-- Electron OSR helper per Pi session
        BrowserWindow(show:false, offscreen:true) per retained widget
        paint(dirtyRect, NativeImage) as invalidation and frame source
        webContents.sendInputEvent for input
        full-frame PNG or raw/zlib transport experiments
```

Use the fallback only if a controlled A/B test shows that Chromium screenshot capture, not Kitty/tmux transport, is the main active CPU or latency bottleneck.

CEF should be considered only after Electron OSR fails a defined target. CEF offers the strongest low-level API but introduces the largest engineering and packaging burden.

## 6. Main risks

1. **Per-session Chromium memory.** Verified architecture, unverified 3-5 session process-tree RSS. The handoff measured only about 120 MB for the main browser process, not the complete tree.
2. **Direct-data terminal CPU.** Verified local short-run cost, but not separated cleanly among base64, tmux buffering, Ghostty decode, and GPU upload.
3. **Shared-memory helper value.** Source support is verified; end-to-end benefit and cleanup reliability are unverified.
4. **Debugger pause as lifecycle control.** Verified in the PoC browser version, but it is a debugging mechanism rather than a purpose-built lifecycle API. Revalidate after Chromium upgrades.
5. **Native browser UI.** Chromium popups such as native select/date/color controls may not appear in screenshots. Controlled in-page replacements or documented widget restrictions remain necessary.
6. **Image loss after terminal restart or reattach.** Placeholders survive while Ghostty image memory does not. Re-upload from the RAM still when a redraw/reconnect signal is available, otherwise show a revive placeholder.
7. **Cell-precision input.** tmux blocks pixel mouse reporting, so controls need large targets and should not depend on fine drag precision.
8. **Agent-generated code safety.** Browser process isolation helps but does not replace network, file, navigation, and resource policy.

## 7. Claims requiring local benchmarks

No benchmark-dependent choice below should be treated as settled by desk research:

1. `t=d` PNG versus `t=s` PNG at 1440x612 for sparse UI, canvas animation, and full-frame animation.
2. PNG screenshot versus Electron OSR `paint` plus `NativeImage.toPNG`.
3. Electron OSR raw BGRA plus zlib versus PNG, for both `t=d` and `t=s`.
4. Total CPU for Chromium tree, Pi, tmux, Ghostty, and any helper at 4, 8, and 12 fps.
5. Full process-tree RSS for 1, 3, and 5 Pi sessions with zero, one, and three retained pages per session.
6. Freeze and thaw latency, close and revive latency, and debugger-pause reliability across repeated cycles.
7. Whether one session-wide capture semaphore improves responsiveness under multiple visible widgets.
8. Shared-memory object cleanup after pane kill, terminal disconnect, malformed frame, and helper crash.
9. Whether tile-based multi-image updates ever outperform full-image replacement enough to justify their complexity.
10. Subjective usability at 8-12 fps given 8x17 CSS-pixel mouse cells.

## Sources

All web sources accessed 2026-10-28. Web content was treated as untrusted data and summarized independently.

- **S1:** Chrome DevTools Protocol, Page domain: https://chromedevtools.github.io/devtools-protocol/tot/Page/
- **S2:** Chrome DevTools Protocol, HeadlessExperimental domain: https://chromedevtools.github.io/devtools-protocol/tot/HeadlessExperimental/
- **S3:** Chrome DevTools Protocol, Target domain: https://chromedevtools.github.io/devtools-protocol/tot/Target/
- **S4:** CEF general usage, off-screen rendering: https://github.com/chromiumembedded/cef/blob/master/docs/general_usage.md
- **S5:** CEF render and browser host APIs: https://github.com/chromiumembedded/cef/blob/master/include/cef_render_handler.h and https://github.com/chromiumembedded/cef/blob/master/include/cef_browser.h
- **S6:** Electron off-screen rendering: https://github.com/electron/electron/blob/main/docs/tutorial/offscreen-rendering.md
- **S7:** Electron `webContents` input and paint APIs: https://www.electronjs.org/docs/latest/api/web-contents
- **S8:** Apple `WKWebView.takeSnapshot`: https://developer.apple.com/documentation/webkit/wkwebview/takesnapshot(with:completionhandler:)
- **S9:** Ultralight supported web features and 2.0 status: https://ultralig.ht/docs/2.0/supported-web-features and https://ultralig.ht/blog/ultralight-2-0-out-now
- **S10:** Ultralight custom surfaces and input: https://ultralig.ht/docs/2.0/using-a-custom-surface and https://ultralig.ht/docs/2.0/mouse-and-scroll-input
- **S11:** Servo embedding and rendering APIs: https://docs.rs/crate/servo/latest and https://docs.rs/servo-paint-api/latest/paint_api/rendering_context/struct.OffscreenRenderingContext.html
- **S12:** Blitz project and limitations: https://github.com/DioxusLabs/blitz
- **S13:** Ladybird project and architecture: https://github.com/LadybirdBrowser/ladybird and https://github.com/LadybirdBrowser/ladybird/blob/master/Documentation/ProcessArchitecture.md
- **S14:** Qt WebEngine deployment and WebEngineView: https://doc.qt.io/QT-6/qtwebengine-deploying.html and https://doc.qt.io/QT-6/qml-qtwebengine-webengineview.html
- **S15:** WPE WebKit platform support FAQ: https://wpewebkit.org/about/faq.html
- **S16:** Ghostty 1.3.1 Kitty graphics command parser: https://raw.githubusercontent.com/ghostty-org/ghostty/v1.3.1/src/terminal/kitty/graphics_command.zig
- **S17:** Ghostty 1.3.1 image loading, shared memory, zlib, and PNG decode: https://raw.githubusercontent.com/ghostty-org/ghostty/v1.3.1/src/terminal/kitty/graphics_image.zig
- **S18:** Ghostty 1.3.1 Kitty graphics execution: https://raw.githubusercontent.com/ghostty-org/ghostty/v1.3.1/src/terminal/kitty/graphics_exec.zig
- **S19:** Kitty graphics protocol: https://sw.kovidgoyal.net/kitty/graphics-protocol/
- **S20:** tmux 3.6b DCS parsing: https://raw.githubusercontent.com/tmux/tmux/3.6b/input.c
- **S21:** tmux 3.6b raw-string client selection: https://raw.githubusercontent.com/tmux/tmux/3.6b/screen-write.c
- **S22:** tmux 3.6b terminal output buffering: https://raw.githubusercontent.com/tmux/tmux/3.6b/tty.c
- **S23:** konaito terminal-browser source: https://github.com/konaito/terminal-browser and https://raw.githubusercontent.com/konaito/terminal-browser/main/src/browser.ts
- **S24:** Brow6el source: https://next.tangled.org/janantos.tngl.sh/brow6el/tree/main and https://github.com/codingismy11to7/brow6el
- **S25:** Termium architecture: https://raw.githubusercontent.com/codr1/termium/main/docs/architecture.md
- **S26:** Awrit repository: https://github.com/chase/awrit
- **S27:** Carbonyl architecture: https://fathy.fr/carbonyl

## Local evidence consulted

- `spec/active/261028-1700-interactive-html-widgets-for-pi/discovery.md`
- `wiki/raw/2026-10-27-poc-handoff.md`, sections 3, 4, 6, 8, and 12
- `../pi-html-widget/index.ts` as PoC reference only
