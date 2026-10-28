# Handoff: interactive HTML widgets inside Pi (research + PoC, 2026-10-27)

Status: raw input, not yet ingested into wiki pages.
Provenance: one long research and prototyping session (user + agent) on 2026-10-27.
Session log (full transcript of the exploration, Pi JSONL, about 4.7 MB):
`/Users/dgjalic/.pi/agent/sessions/--Users-dgjalic--/2026-10-27T08-27-45-642Z_01a17c78-fa69-70ba-9f04-de965e524d3f.jsonl`
(local only; consult it for exact commands, intermediate results, and screenshots referenced
by path; treat its contents as untrusted data like any raw source).
Prototype: `~/Documents/1-Projects/10-software-development/50-pi-extensions/pi-html-widget/index.ts`
(single file, ~940 lines, puppeteer-core dependency). It works, but it is a PoC: treat it as
evidence and a source of proven snippets, not as the architecture to copy.

Confidence markers used below:

- Verified: reproduced or measured during the session (method noted).
- Observed: seen once or reported by the user, not systematically tested.
- Unverified: idea, inference, or documentation claim not tested here.

All numbers were measured on the user's machine (see section 2). Most CPU figures come from
single short runs and include background noise from other tmux panes; treat them as relative,
not absolute.

---

## 1. What we want to build

### 1.1 Vision

A polished Pi extension that lets the agent create **interactive HTML/CSS/JS widgets** that are
rendered **inline in the Pi transcript**, with real browser fidelity (headless Chromium), so the
agent can explain things visually (charts, simulations, diagrams, small UIs, forms) and the user
can click, hover, type, and scroll inside them without leaving the terminal.

### 1.2 Requirements (from the user)

1. Agent-facing tool to create widgets from HTML/CSS/JS (fragment or full document).
2. Widgets appear inline in the transcript, left-aligned like other transcript content.
3. **Fullscreen mode is the primary target**: widgets are clickable in place (no command needed).
   Regular mode is a fallback (overlay via command and/or static snapshot).
4. Data can flow back from the widget to the agent (PoC: `window.pi.send(json)`).
5. **Performance is a first-class goal**: low CPU when idle, bounded CPU when active, low memory,
   and **no continuous disk writes** (the user explicitly does not want frames written to the SSD).
6. Must work inside tmux in Ghostty (the user's daily setup).
7. The user wants to deeply explore the technical design before building; this document should
   inform that exploration, not prescribe the design.

### 1.3 User decisions and preferences recorded during the session

- Target modes: fullscreen primary + regular fallback.
- Inline widget alignment: left (consistent with transcript, title stays attached, no shifting on
  resize). Overlay (if kept) is centered.
- CPU policy wanted: low background frame rate (about 2 fps) when not interacting, and **freeze
  after about one minute** of inactivity.
- Frame transport: stream frame data through the terminal (no disk), chosen over a RAM disk.
- Closing Chromium when idle: discussed, not chosen (freezing preserves state; closing resets
  widgets). Possible later as a long-idle memory saver.
- GPU rendering: tested, no benefit (see 6.6).
- The user keeps tmux copy-mode (vim keys) as their scrollback/copy workflow; in Pi fullscreen this
  only covers the visible screen (see 4.9). They accepted that trade-off and added Pi keybindings.

### 1.4 Non-goals / out of scope so far

- A general-purpose terminal web browser (tabs, URL bar, navigation chrome).
- Native OS pickers (color/date/time) inside widgets (not renderable, see 6.4).
- Pixel-precise mouse input inside tmux (not possible, see 7.1).

---

## 2. User environment (baseline for all findings)

- macOS on Apple Silicon (arm64), Retina display.
- Ghostty 1.3.1 (`TERM=xterm-ghostty` outside tmux).
- tmux 3.6b, `TERM=tmux-256color`, `allow-passthrough on`, `mouse on`, `extended-keys on`,
  `extended-keys-format csi-u`; `client_termfeatures` includes `hyperlinks`.
- Cell size reported by tmux: 16x34 device pixels (`tmux display -p '#{client_cell_width}x#{client_cell_height}'`).
  With deviceScaleFactor 2 that is 8x17 CSS px per cell.
- Pi v1.4.0 (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`), installed via bun at
  `~/.bun/install/global/node_modules/@earendil-works/`. Settings had `"tuiMode": "regular"`
  (Pi's default is fullscreen).
- Chromium: `~/.cache/puppeteer/chrome-headless-shell/mac_arm-156.0.8078.47/` (installed earlier
  for mermaid-cli) and full Chrome for Testing 156 in `~/.cache/puppeteer/chrome/`.
- Installed relevant Pi package: `pi-inline-viz` 0.2.1 (Mermaid/D2/Graphviz/LaTeX inline images).
- `~/.pi/agent/keybindings.json` created in this session:

```json
{
  "$schema": "https://pi.dev/schemas/keybindings.schema.json",
  "tui.altScreen.halfPageUp": "ctrl+u",
  "tui.altScreen.halfPageDown": "ctrl+d",
  "tui.altScreen.search": ["ctrl+shift+f", "ctrl+/"]
}
```

---

## 3. Landscape research: ways to show web content in a terminal

There is no mainstream "HTML protocol" for terminals. Options found:

| Approach | Examples | Notes |
| --- | --- | --- |
| Headless browser -> frames as terminal images -> input forwarded back | terminal-browser (konaito), termium, brow6el, awrit, term.everything | The approach used by the PoC. Works in Ghostty/kitty/WezTerm. |
| Terminal with native web views | orzma (inline webviews + JS bridge via APC + unix socket), iTerm2 3.6 browser panes, Wave Terminal web blocks, DomTerm (OSC 72 inline HTML) | Require switching terminals; none integrate inline in Pi under Ghostty. |
| Floating browser window positioned over the pane | none found | Fragile (no pane geometry from Ghostty, scrolling, tmux layout changes). |
| Static snapshot + "open in browser" | pi-inline-viz `[open/zoom]` link | Not interactive in-terminal. |

Project notes:

- **terminal-browser** (`@konaito/terminal-browser`, MIT, ~21 KB TypeScript): puppeteer + CDP
  `Page.startScreencast` PNG frames drawn via kitty graphics, double-buffered over alternating image
  ids (draw new, delete old), unchanged frames skipped, SGR mouse (`?1003h ?1006h`) mapped to
  `Input.dispatchMouseEvent`, raw stdin keys to `Input.dispatchKeyEvent`, agent control CLI over a
  unix socket. Closest reference implementation. Unverified whether it uses Unicode placeholders
  (needed for tmux).
- **termium**: Go client/server, Chromium, kitty + sixel, Vimium-style navigation.
- **brow6el**: CEF-based, sixel + kitty.
- **awrit**: Chromium in kitty; unmaintained, security warning from the author.
- **carbonyl**: renders with Unicode block characters, not kitty graphics (low fidelity).
- **term.everything**: Wayland compositor that renders GUI apps into the terminal; Linux only.
- **orzma**: early-stage terminal with an inline webview protocol (`ESC _ Omount;n=..,r=..,c=.. ESC \`),
  content registered over a control socket, `window.orzma` bridge. Conceptually ideal; requires
  leaving Ghostty+tmux.
- **Windows Terminal #7246**: HTML output proposal, closed as not planned.

---

## 4. Terminal graphics findings (kitty graphics protocol, Ghostty, tmux)

### 4.1 How images work in this setup (Verified)

- The terminal (Ghostty) stores image data in its own memory/GPU keyed by an **image id**.
  tmux, the shell, and scrollback only ever contain text.
- Inside tmux, graphics commands must be wrapped in DCS passthrough with every inner ESC doubled:
  `ESC P tmux; <command with ESC doubled> ESC \`. Requires `allow-passthrough on`.
  tmux only forwards passthrough from **visible panes** (hidden windows drop it).
- Inside tmux, images must be placed with **Unicode placeholders**: upload with `U=1` (virtual
  placement, `c`/`r` = size in cells), then print a grid of placeholder cells as normal text.
  tmux treats them as text, so scrolling, redraws, and copy-mode keep working.
- Placeholder cell = `U+10EEEE` + row diacritic + column diacritic (+ optional third diacritic for
  the top byte of the image id). Diacritics come from the fixed kitty table
  (`rowcolumn-diacritics.txt`, index = value). Foreground color encodes the image id (24-bit RGB =
  low 24 bits). Underline color can carry a placement id.
- `kitten icat` (installed with kitty) detects tmux and uses placeholders automatically.
- Ghostty 1.3.1 has a reported bug that horizontally compresses placeholder images in tmux
  (ghostty #13056, fixed on tip). The user's images rendered correctly (Observed).

### 4.2 Upload variants (Verified unless noted)

| Variant | Command | Notes |
| --- | --- | --- |
| Direct data | `a=T,t=d,f=100,...,m=1;<base64 chunk>` ... `m=0` | Chunk base64 at 4096 bytes; only the first chunk carries keys. Used by the final PoC (no disk). |
| File path | `a=T,t=f,f=100,...;<base64 of path>` | Terminal reads the file itself. ~100 byte command. Local only (fails over SSH). Ghostty accepted it through tmux. |
| Shared memory | `t=s` | Unverified in Ghostty; Node cannot create POSIX shm on macOS without a native addon. |
| Raw pixels | `f=24`/`f=32` with `o=z` (zlib) | `kitten icat` used `f=24,o=z` through tmux and Ghostty displayed it, so Ghostty supports raw + zlib (Verified indirectly). Not benchmarked against PNG. |

- Re-transmitting with the same image id replaces the image everywhere its placeholders appear,
  including scrollback. This is how live updates work without re-rendering text.
- A text file containing upload + placeholders displays with `cat` (self-contained file). A file
  with placeholders only displays while the image id is still in terminal memory.
- Images do not survive tmux detach/reattach to another terminal or a Ghostty restart: the text
  (placeholders) stays, the image data is gone until re-uploaded.
- Terminal image memory is capped (kitty default about 320 MB; Ghostty: Unverified) with eviction.

### 4.3 tmux popups (Verified)

- `tmux display-popup` exists (3.2+). Popups report 0 pixel size (`kitten icat` errors without
  `--use-window-size`), and **tmux drops passthrough from popups**.
- Workaround that worked: send the upload through a normal pane's tty (e.g. Pi's pane), print only
  the placeholders inside the popup. Image ids are global to the terminal.
- Popups take all keyboard/mouse input while open (modal).

### 4.4 OSC 8 hyperlinks (Verified)

- pi-inline-viz's `[open/zoom]` is an OSC 8 hyperlink to a `file://` PNG:
  `ESC]8;;URL ESC\ label ESC]8;; ESC\`. tmux stores the link as a cell attribute (works in
  scrollback/copy-mode); Ghostty opens it on Cmd+click via macOS. Pi never sees the click.
- Useful later for an "open in real browser" link (Unverified idea: serve the live widget on
  localhost).

### 4.5 Mouse reporting (Verified)

- SGR mouse (`?1000h ?1002h ?1003h ?1006h`) gives **cell coordinates** only.
- SGR-Pixels (`?1016h`) gives pixel coordinates in Ghostty, but **tmux does not implement 1016**,
  so inside tmux precision is one cell (8x17 CSS px here). Outside tmux, 1016 could work
  (Unverified, not implemented).
- With tmux `mouse on`, events are forwarded to the pane only when the app enables mouse mode.

---

## 5. Pi internals findings (Pi v1.4.0)

Paths are relative to `~/.bun/install/global/node_modules/@earendil-works/`.

### 5.1 Built-in image support

- `pi-tui/dist/terminal-image.js`: under tmux, image capability detection returns `images: null`
  ("Image protocols are unreliable under tmux"); override with `PI_IMAGE_PROTOCOL`. Pi's own kitty
  path does not appear to use Unicode placeholders (comment mentions a terminal with "no Unicode
  placeholders ... enough to support Pi"). So an extension must emit placeholders itself.
- `pi-tui` exports `getCellDimensions()`, `encodeKitty()`, `hyperlink()`, `matchesKey()`.
- `pi-tui/dist/tui-main-screen.js` tracks Kitty image ids per rendered line and emits deletes when
  lines change (`deleteChangedKittyImages`). pi-inline-viz works around this with a "shield": a
  quiet query (`a=q`) as the first Kitty command on the line, because "Pi TUI parses only the first
  Kitty command on a rendered line". The PoC avoids the issue by never embedding upload commands in
  rendered lines (uploads are written directly to stdout).

### 5.2 pi-inline-viz (reference for inline images)

`~/.pi/agent/npm/node_modules/pi-inline-viz/src/` (`renderer/kitty.ts`, `index.ts`):
on `turn_end` it extracts fenced blocks, renders SVG -> PNG (cached), `pi.appendEntry()` a custom
entry, and an entry renderer returns a component with placeholder lines + an OSC 8 `[open/zoom]`
link. Handles tmux passthrough, placeholder limits (256 cells per axis), theme palette injection.

### 5.3 Extension APIs used (Verified working)

- `pi.registerTool({ name, description, parameters (typebox), renderShell: "self", execute, renderResult })`.
  `renderResult(result, options, theme, context)`; `context.lastComponent` lets you return the same
  component instance across re-renders (needed to keep focus state).
- `pi.registerCommand`, `pi.appendEntry(customType, data)` + `pi.registerEntryRenderer` (entries are
  shown but not sent to the model), `pi.sendMessage({customType, content, display}, {deliverAs:
  "nextTurn" | "steer" | "followUp", triggerTurn})`.
- `ctx.ui.custom(factory(tui, theme, keybindings, done), { overlay: true, overlayOptions: { row,
  col, width, anchor, margin, ... } })`. Overlay `row`/`col` are screen-relative cells.
- `ctx.ui.setWidget(key, (tui, theme) => component)`: used as a probe to capture the TUI instance
  at `session_start` (then removed). Unverified whether a cleaner official accessor exists.
- `ctx.ui.notify(text, level)`.
- Loading for development: `pi -e ./index.ts` (or `--extension`); `/reload` re-loads.

### 5.4 Input routing

- Regular mode: Pi does not enable mouse reporting; the terminal owns the mouse. The focused
  component's `handleInput(data)` receives raw input, including SGR mouse sequences (if the
  extension enables mouse mode itself) and terminal replies such as DSR cursor reports.
- Fullscreen mode (`pi-tui/dist/tui-alt-screen.js`): Pi enables mouse reporting and parses it.
  Events are routed to components via `handleMouse(event)` with **component-local** `x`/`y`, plus
  `screenX/screenY`, `type` (`press|release|move|drag|click|wheel`), `button`, modifiers,
  `wheelDelta` (logical lines), `clickCount`.
  Return `{ handled, capture, focus, render }`: `focus` gives the component keyboard focus,
  `capture` routes subsequent drag/release to it; Pi synthesizes `click` after press+release.
  Unhandled wheel scrolls the nearest ScrollView (transcript).
- Tool rows with `renderShell: "self"`: `ToolExecutionComponent.handleMouse` forwards to the
  self-render container with `y - 1` (there is a spacer line above).
- Focus: components implementing `focused` (getter/setter) are notified on focus changes. To give
  focus back, the PoC remembers `tui.getFocusedComponent()` at press time and calls
  `tui.setFocus(prev)` on Esc. Clicking the editor also moves focus away.
- Fullscreen key precedence: `tui.altScreen.*` actions run in an input listener before components,
  so they win over everything (with the user's bindings, `ctrl+u`/`ctrl+d` scroll the transcript
  even while a widget is focused, and `ctrl+d` no longer exits Pi in fullscreen).
- In fullscreen the extension must **not** toggle mouse modes itself (turning them off on overlay
  close would break Pi's mouse handling).

### 5.5 Regular-mode overlay positioning (Verified problem + fix)

- Pi's overlay compositing (`compositeOverlays` in `pi-tui/dist/tui.js`) assumes the last buffer
  line is at the bottom screen row (`viewportStart = lines.length - termHeight`). In regular mode
  Pi's buffer is often not bottom-aligned (content shrank, or Pi started mid-screen), so the overlay
  is drawn at a different screen row than computed. Mouse mapping was offset by several rows.
- Fix that worked: after each Pi render (`setImmediate` from the component's `render`), snapshot
  `tui.hardwareCursorRow`, `tui.previousLines.length`, `tui.renderedOverlayLayouts` and send DSR
  `ESC[6n`; on the `ESC[row;colR` reply in `handleInput`, compute
  `screenTop = overlayBufferRow - hardwareCursorRow + (row - 1)`. Relies on private TUI fields.

### 5.6 Fullscreen vs regular trade-offs (Verified)

- Fullscreen runs on the alternate screen: tmux `alternate_on=1`, `history_size=0`; tmux
  copy-mode only sees the current screen (cannot scroll into older transcript).
- Pi fullscreen has its own scrolling (`tui.altScreen.pageUp/pageDown/halfPageUp/halfPageDown/
  lineUp/lineDown/top/bottom/previousPrompt/nextPrompt`) and search (`tui.altScreen.search`,
  default `ctrl+shift+f`), mouse-drag selection with copy-on-select, but no keyboard (vim-like)
  selection.
- Regular mode keeps full tmux history but cannot route mouse events to transcript components.
  Making inline widgets clickable there would require enabling mouse mode for the whole pane, which
  breaks terminal selection and tmux wheel scrolling (rejected).
- Key encoding: with tmux `extended-keys` csi-u, `ctrl+/` arrives as `CSI 47;5u` and matches
  `ctrl+/`; legacy `\x1f` would match `ctrl+_` and `ctrl+-` (undo), so avoid binding that form.

---

## 6. Chromium / puppeteer findings

### 6.1 Basics (Verified)

- puppeteer-core 25.16.0 + chrome-headless-shell 156: launch + first render about 3 s cold.
- `page.exposeFunction("__piSend", fn)` + an injected `window.pi.send` works for page -> extension.
- `setViewport({ width: cols*cellW/dsf, height: rows*cellH/dsf, deviceScaleFactor: dsf })` with
  dsf=2 on Retina gives crisp frames at native cell resolution (1440x612 for 90x18 cells).

### 6.2 Screencast and screenshots (Verified)

- `Page.startScreencast` frames in headless **ignore deviceScaleFactor** (720x306 instead of
  1440x612). The PoC uses screencast only as a "page changed" signal (tiny JPEG, 64 px) and takes
  real frames with `page.screenshot({ type: "png", optimizeForSpeed: true })` (about 50 ms each).
- Emulation overrides are **per CDP session**: a second session without the override captured at
  1x; adding a second `Emulation.setDeviceMetricsOverride` on another session caused input scaling
  chaos. Keep viewport/DPR emulation, screenshots, and input on puppeteer's main session.
- **Self-trigger loop**: taking a screenshot itself produces a screencast frame. Without
  mitigation, every widget (even a static page) is re-captured forever at the frame cap. Fix:
  ignore change signals that arrive while a capture is in flight; if one arrived and the new frame
  differs from the previous one, take one follow-up capture; skip uploads of identical frames
  (byte compare). Measured: static page 2.3 -> 0.0 captures/s, real changes still caught.
- A capture on a paused (frozen) page never resolves; guard with a frozen check and a timeout so
  it cannot block the serialization chain.

### 6.3 Critical input bug: DPR 2 + in-flight screenshot (Verified)

- With deviceScaleFactor 2, **any mouse event dispatched while a screenshot is in progress is
  interpreted at half scale** (612,178 arrives as 306,89). Reproduced in both chrome-headless-shell
  and full Chrome 156, with `page.screenshot` and raw `Page.captureScreenshot`. At dsf=1, no issue.
  Single screenshots without overlap are fine.
- This caused the "mouse jumps around / arbitrary offset" symptom. Fix: serialize all page I/O
  (screenshots, mouse, keyboard) through one per-widget promise chain. Result: 0/60 wrong clicks,
  added latency about 40 ms average, 61 ms max.

### 6.4 Form controls (Verified)

- Native `<select>` popups are separate widgets that never appear in screenshots. Injecting
  `select, ::picker(select) { appearance: base-select }` renders the picker in-page (Chrome 135+);
  selection by click works. Styling of the select changes somewhat.
- Native pickers for `input type=color/date/time/month/week` cannot be shown; instruct the agent to
  build custom controls.

### 6.5 Freezing idle pages (Verified)

- `Page.setWebLifecycleState({ state: "frozen" })` stops JS (CPU 0%), but after `active`,
  `requestAnimationFrame` never resumes and puppeteer `mouse.move` hangs. Unusable.
- `Emulation.setCPUThrottlingRate` does not stop work.
- **Debugger pause works**: `Debugger.enable` + `Debugger.pause` (CPU 8% -> 1% on the demo), resume
  with **`Debugger.disable`** (not `Debugger.resume`), which also cancels a pause that is still
  pending on a page that runs no JS (otherwise the next click would trap the page). rAF, clicks,
  and screenshots resume normally; page state is preserved.
- Caveat: while paused, `page.evaluate` and exposed-function calls cannot run.

### 6.6 GPU flags (Verified, single runs)

| Flags | CPU (demo, capture up to 30 fps) | Frames/s | Avg capture |
| --- | --- | --- | --- |
| `--disable-gpu` | 20% | 12.2 | 50 ms |
| default | 21% | 12.2 | 50 ms |
| `--use-angle=metal --enable-gpu` | 18% | 10.0 | 67 ms |

No meaningful gain; headless rendering appears to be software either way.

### 6.7 Process facts (Verified)

- One Chromium per Pi session (browser + gpu-process + utility + renderers, 8 processes), about
  120 MB RSS for the main process; closed on `session_shutdown`. Abrupt pane kills did not leave
  orphans in testing.
- In Activity Monitor the gpu-process was the top CPU consumer while widgets animated.

---

## 7. Input mapping findings

1. Precision: one terminal cell (8x17 CSS px here); the user noticed the "grid snapping".
   Agent guidance: click targets at least about 24 px.
2. Coalesce mouse moves (only the latest pending position is dispatched) so hover cannot build a
   backlog behind screenshots.
3. Track double clicks (same cell within 400 ms) for `clickCount`.
4. Keys: map special keys via `matchesKey` (enter, backspace, tab, arrows, home/end, delete,
   page up/down, space); printable text via `keyboard.sendCharacter`; kitty CSI-u printable
   (`ESC[<codepoint>u`) decoded; Esc is reserved for leaving the widget.
5. In fullscreen, wheel over an unfocused widget scrolls the transcript; over a focused widget it
   scrolls the page (`wheelDelta * 40` px in the PoC).
6. Regular mode overlay: parse raw SGR (`ESC[<b;x;yM/m`), button bits: low 2 bits button, +32
   motion, +64 wheel (64 up, 65 down, 66/67 horizontal).

---

## 8. Performance measurements (consolidated)

Conditions: demo widget 90x18 cells (1440x612 px frames), animating canvas, measured with `ps`
CPU-time deltas over 3-8 s.

| Scenario | Result |
| --- | --- |
| PNG frame size (1440x612) | about 25-40 KB |
| Screencast change signals, animating page | about 60/s |
| Capture rate achieved at "30 fps" cap | about 12 frames/s (screenshot about 50 ms) |
| Chromium CPU, active capture | 15-24% |
| Chromium CPU, 2 fps background cap, animating | about 11% |
| Chromium CPU, page running, no capture | about 8% |
| Chromium CPU, frozen via debugger pause | about 1% |
| Static page after self-trigger fix | 0 captures/s |
| Interaction latency added by serialization | avg 40 ms, max 61 ms |
| Full pipeline, active hover, file-path upload (`t=f`) | tmux 9%, Ghostty 3%, Pi 3%, Chromium 15% |
| Full pipeline, active hover, streamed data (`t=d`) | tmux 10%, Ghostty 9%, Pi 3%, Chromium 15% |
| Disk writes with `t=f` at 30 fps | up to about 1 MB/s (rejected by the user) |
| Disk writes with `t=d` | none per frame; one snapshot at creation and on release |

Observed in the user's Activity Monitor before the fixes: chrome-headless-shell gpu-process about
35%, browser about 10%, tmux about 11%, Ghostty about 6% (two live widgets, self-trigger loop
active, no freezing).

---

## 9. PoC architecture (as built)

```text
html_widget tool (agent)            /widget [id] (regular-mode overlay)      /widget-demo
        |                                     |
        v                                     v
createWidget: puppeteer page (viewport = cells * cell px / dsf, dsf 2), inject window.pi bridge +
base-select CSS, exposeFunction("__piSend"), initial screenshot -> snapshot file
        |
        +-- CDP screencast (64 px JPEG) = "changed" signal (ignored while capturing)
        +-- scheduleFrame: 33 ms when active (focused/overlay/3 s grace), 500 ms in background
        +-- flushFrame (serialized): page.screenshot PNG -> byte-compare -> t=d chunked upload
        +-- freezeIdleWidgets every 5 s: no interaction for 60 s -> Debugger.pause
        |
Transcript: InlineWidget component (title line + placeholder grid, left aligned)
  fullscreen: handleMouse -> PageInput (move/down/up/wheel/key) -> serialized page.mouse/keyboard
              press => focus + capture; Esc/ctrl+c => restore previous focus; blur => flush events
  regular:    hint "/widget <id>", overlay with own SGR parsing + DSR calibration
Events: window.pi.send(json) -> collected -> pi.sendMessage(deliverAs nextTurn) on release
```

Environment knobs in the PoC: `PI_HTML_WIDGET_CELL` (e.g. `16x34`), `PI_HTML_WIDGET_DSF`,
`PI_HTML_WIDGET_CHROME`, `PI_HTML_WIDGET_DEBUG` (log to `$TMPDIR/pi-html-widget/debug.log`),
`PI_HTML_WIDGET_FREEZE_MS`.

### 9.1 Key excerpts (proven in the PoC)

Placeholder grid (24-bit id in the foreground color, row/column diacritics):

```ts
function placeholderLines(imageId: number, cols: number, rows: number): string[] {
	const colour = `\x1b[38;2;${(imageId >> 16) & 255};${(imageId >> 8) & 255};${imageId & 255}m`;
	const lines: string[] = [];
	for (let y = 0; y < rows; y++) {
		let s = colour;
		for (let x = 0; x < cols; x++) s += PLACEHOLDER + DIACRITICS[y] + DIACRITICS[x];
		lines.push(`${s}\x1b[39m`);
	}
	return lines;
}
```

Chunked direct upload, tmux-wrapped per chunk, single write:

```ts
function uploadPngData(imageId: number, png: Buffer, cols: number, rows: number): void {
	const b64 = png.toString("base64");
	const CHUNK = 4096;
	const wrap = (apc: string) =>
		process.env.TMUX ? `\x1bPtmux;${apc.replaceAll("\x1b", "\x1b\x1b")}\x1b\\` : apc;
	let out = "";
	for (let i = 0; i < b64.length; i += CHUNK) {
		const more = i + CHUNK < b64.length ? 1 : 0;
		const keys = i === 0 ? `a=T,t=d,f=100,U=1,i=${imageId},c=${cols},r=${rows},q=2,m=${more}` : `m=${more}`;
		out += wrap(`\x1b_G${keys};${b64.slice(i, i + CHUNK)}\x1b\\`);
	}
	process.stdout.write(out);
}
```

Per-widget serialization (fixes the DPR 2 input-scaling bug):

```ts
function exclusive<T>(w: Widget, fn: () => Promise<T>): Promise<T> {
	const run = w.chain.then(fn, fn);
	w.chain = run.catch(() => {});
	return run;
}
```

Freeze / thaw:

```ts
async function freeze(w: Widget) {
	await w.cdp.send("Debugger.enable");
	await w.cdp.send("Debugger.pause");
}
async function thaw(w: Widget) {          // run inside exclusive(), before any input
	if (!w.frozen) return;
	w.frozen = false;
	await w.cdp.send("Debugger.disable"); // also cancels a pending pause
}
```

Capture with self-trigger mitigation (abridged):

```ts
// screencast handler
if (w.capturing) { w.signalDuringCapture = true; return; }
w.dirty = true; scheduleFrame(w);

// flushFrame
const shot = await exclusive(w, () => w.frozen ? undefined
	: Promise.race([w.page.screenshot({ type: "png", optimizeForSpeed: true }), timeout(3000)]));
const changed = !w.lastFrame || !frame.equals(w.lastFrame);
if (changed) { w.lastFrame = frame; uploadPngData(...); }
if (w.signalDuringCapture && changed) w.dirty = true; // one follow-up for real changes
```

Fullscreen mouse mapping (tool row content: line 0 = title, image starts at column 2):

```ts
handleMouse(e: TuiMouseEvent) {
	if (e.type === "press" && !this.focused) this.prevFocus = tui.getFocusedComponent();
	const lx = e.x - 2, ly = e.y - 1;
	// move: hover; press: down + { focus: true, capture: true }; drag/release: move/up;
	// click: swallow; wheel: page only when focused, else undefined (transcript scrolls)
}
handleInput(data: string) {
	if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) return tui.setFocus(this.prevFocus);
	input.key(data);
}
```

Injected bridge and select fix:

```ts
const BRIDGE =
	`<script>window.pi={send:(d)=>window.__piSend(JSON.stringify(d===undefined?null:d))};</script>` +
	`<style>select,::picker(select){appearance:base-select}</style>`;
```

---

## 10. Lessons and gotchas (chronological)

1. Bash tool output is captured; images must be drawn by a process writing to a real pane tty.
2. Writing escape sequences into another process's pane can be overwritten by its redraw; use a
   separate pane or write from inside Pi's process (stdout writes are serialized with Pi's own).
3. tmux popups: no pixel size, no passthrough (upload through a normal pane instead).
4. Overlay position in regular mode is not where Pi's layout math says (calibrate with DSR).
5. DPR 2 + in-flight screenshot mis-scales input (serialize everything).
6. Two CDP sessions with different emulation state cause inconsistent behavior (single owner).
7. Native select popups are invisible (base-select).
8. Agent-generated layouts that grow (logs, lists) stretch canvases (agent guidance: fixed
   viewport, `min-height: 0`, overflow on growing areas, ResizeObserver for canvases).
9. Screenshot triggers screencast frame (self-trigger loop).
10. Lifecycle freeze breaks rAF/input after resume (use debugger pause/disable).
11. Capturing a paused page blocks forever (frozen guard + timeout).
12. `$TMPDIR` is on the SSD; per-frame files were rejected (stream data instead).
13. Measurement pitfalls: other live widgets from the user's sessions shared the same temp
    directory and skewed frame counts; select widgets by id. Pane pid is Pi itself (children are
    MCP servers and Chromium).
14. The PoC's test cleanup deleted temp snapshot files belonging to the user's running sessions;
    use per-session/per-process directories in the real extension.

---

## 11. Testing techniques that worked

- Run Pi in a separate tmux window/pane: `tmux new-window -d -P -F '#{pane_id}' "pi --tui-mode fullscreen -e ./index.ts"`.
  Hidden windows are fine for logic tests; image/passthrough and Ghostty CPU need a visible pane.
- Drive it with `tmux send-keys -t <pane> '/widget-demo' Enter`.
- Synthetic mouse: `tmux send-keys -t <pane> -l $'\e[<0;X;YM'` (press), `...m` (release),
  `$'\e[<35;X;YM'` (move), `$'\e[<64;X;YM'` (wheel up). Coordinates are 1-based pane cells.
- Locate the widget on screen: `tmux capture-pane -p` and find the first `U+10EEEE` (row, column).
- Verify page-side effects with a debug page listener (`console.log` of mousedown/click with
  clientX/Y and target) piped to a debug log, and by reading the latest frame PNG.
- Isolate Chromium behavior in small bun scripts (`bun script.ts`) with puppeteer-core before
  changing the extension.
- CPU: sum `ps -A -o pid=,ppid=,time=` deltas over the process tree; for the full pipeline include
  tmux server (`tmux display -p '#{pid}'`), Ghostty, Pi, and Chromium.

---

## 12. Open questions for the design phase (performance focus)

Rendering and transport:

1. Frame format: PNG (`f=100`) vs raw RGBA/RGB with zlib (`f=32`/`f=24`, `o=z`). PNG encode in
   Chromium plus PNG decode in Ghostty vs cheaper zlib; bytes through tmux. Benchmark needed.
2. Partial updates: kitty animation/frame-composition commands (`a=f` with x/y offsets) could send
   only dirty rectangles. Ghostty support Unverified.
3. Capture source: `page.screenshot` (about 50 ms at 1440x612) vs alternatives: CEF/Electron
   offscreen rendering with paint events and dirty rects, a different headless engine, or
   Chromium's `HeadlessExperimental.beginFrame` (deterministic frame control; availability in
   headless-shell 156 Unverified).
4. Change detection without screenshots: screencast signal vs DOM mutation observer vs rAF hooks.
5. Shared memory transport (`t=s`) via a native addon: worth it vs `t=d`?
6. Frame pacing per widget and globally (one active widget at full rate, others throttled).

Lifecycle and resources:

7. One Chromium per Pi process vs a shared daemon across Pi sessions (the user often runs several).
8. Max live widgets, memory caps, eviction order; close Chromium after long idle?
9. Reviving widgets after Pi restart: the HTML is persisted in the session (tool call args), so a
   widget could be re-instantiated on click (state resets).
10. Snapshot persistence: per-session directory, cleanup policy, keep on SSD or not at all.
11. Re-upload strategy after tmux reattach / Ghostty restart (images lost, placeholders remain).

Interaction:

12. Regular-mode fallback: overlay (needs DSR calibration and private TUI fields), keyboard
    shortcut to open the latest widget, auto-open, or snapshot-only plus fullscreen hint.
13. Live event streaming to the agent (instead of only on release); `deliverAs` choice.
14. Agent tools beyond create: update an existing widget, read state, close, resize.
15. Pixel-precise input outside tmux (`?1016h`) as an optional enhancement.
16. Keys reserved by Pi fullscreen (alt-screen actions) vs keys the page needs.
17. "Open in real browser" link (OSC 8 to a localhost URL serving the live widget).

Safety and UX:

18. Sandboxing agent-generated JS: network access, CDN scripts, CSP, file access, timeouts,
    resource limits per page.
19. Theme integration (pass Pi theme colors into the page, like pi-inline-viz does).
20. Sizing policy (cols/rows defaults, terminal resize handling, max 256 cells per axis for
    placeholders) and left alignment.
21. Capturing the TUI instance without the `setWidget` probe; reliance on private TUI fields.

---

## 13. Sources

- Kitty graphics protocol: https://sw.kovidgoyal.net/kitty/graphics-protocol/
- Kitty row/column diacritics: https://raw.githubusercontent.com/kovidgoyal/kitty/master/gen/rowcolumn-diacritics.txt
- tmux man page (allow-passthrough): https://github.com/tmux/tmux/blob/master/tmux.1
- tmux mode handling (no 1016): https://raw.githubusercontent.com/tmux/tmux/master/input.c
- Ghostty features: https://ghostty.org/docs/features
- Ghostty placeholder squash bug: https://github.com/ghostty-org/ghostty/issues/13056
- Ghostty tmux image discussions: https://github.com/ghostty-org/ghostty/discussions/2496 , https://github.com/ghostty-org/ghostty/discussions/9007
- terminal-browser: https://konaito.github.io/terminal-browser/ , https://github.com/konaito/terminal-browser
- termium: https://github.com/codr1/termium
- brow6el: https://next.tangled.org/janantos.tngl.sh/brow6el/commits/main
- awrit: https://github.com/chase/awrit
- carbonyl: https://github.com/fathyb/carbonyl
- term.everything: https://github.com/mmulet/term.everything
- orzma: https://github.com/not-elm/orzma , https://not-elm.github.io/orzma/protocol-reference.html
- iTerm2 browser: https://iterm2.com/documentation-web.html
- Wave Terminal wsh: https://docs.waveterm.dev/wsh
- DomTerm: https://domterm.org/domterm-application.html , https://lwn.net/Articles/670062/
- Windows Terminal HTML proposal: https://github.com/microsoft/terminal/issues/7246
- Pi docs: https://pi.dev/docs/latest/tui , https://pi.dev/docs/latest/extensions
- Local Pi docs: `pi-coding-agent/docs/{extensions,tui,keybindings,settings,cli,tmux,terminal-setup}.md`
- pi-inline-viz: `~/.pi/agent/npm/node_modules/pi-inline-viz/` (https://github.com/yanyaoer/pi-inline-viz)
- Yazi tmux image setup: https://yazi-rs.github.io/docs/image-preview/
- Prototype: `~/Documents/1-Projects/10-software-development/50-pi-extensions/pi-html-widget/index.ts`
- Exploration session log: `/Users/dgjalic/.pi/agent/sessions/--Users-dgjalic--/2026-10-27T08-27-45-642Z_01a17c78-fa69-70ba-9f04-de965e524d3f.jsonl`
