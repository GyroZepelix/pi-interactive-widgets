# pi-interactive-widgets

A Pi extension that shows interactive HTML widgets inline in the Pi transcript. The agent calls `show_widget`; the page renders in headless Chromium and streams into the terminal as kitty graphics with Unicode placeholders. In Pi fullscreen mode you click, type, and scroll inside the widget in place, and the page can hand data back to the agent.

Widgets you are not using cost about 0% CPU, and no frame or still image is ever written to disk.

## Requirements

- Pi 1.4 in **fullscreen** TUI mode for interaction (`/settings`, TUI mode). In regular mode widgets show a still image.
- A supported terminal:
  - tmux with Ghostty as the client terminal (tested: Ghostty 1.4.0, tmux 3.6b with `set -g allow-passthrough on`), or kitty as the client (untested);
  - plain Ghostty without tmux (best effort).
  Anywhere else the widget row shows `[widgets need tmux + Ghostty]` and the agent is told.
- chrome-headless-shell in the puppeteer cache. The extension never downloads a browser; install or update it with:

  ```sh
  npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/puppeteer
  ```

  The newest build under `~/.cache/puppeteer/chrome-headless-shell/` is used unless `chromePath` is set. A missing binary shows a notice with this command.

## Usage

```sh
pi -e ./src/index.ts                       # try it once from this checkout
pi install /path/to/pi-interactive-widgets # or install the local package
```

The agent calls `show_widget` with exactly one of:

- `html`: a body fragment or a full document (inline `<style>` and `<script>` work);
- `path`: an `.html` entry file; files in its folder and subfolders are served, nothing outside (symlinks included).

Optional `title`, `cols`, and `rows` set the title and the size in terminal cells (default `min(100, terminal width - 4)` x 20, at most 256 each). Each call renders a new widget instance and returns its id, cell size, CSS viewport, and any requests blocked or JS errors seen while loading. For widgets it edits and re-shows, the agent should write them to a scratch folder such as `./.pi-widgets/<name>/index.html` and pass `path`.

### Agent guidance

The model sees only what it needs at all times; the detailed authoring guide is a plain file it reads on demand.

- **Tool description:** `show_widget`'s description is short (about 150 tokens): the parameters, the fixed `cols` x `rows` viewport without page scrolling, click instead of hover, the bridge and network in one line each, and the absolute path of the guide with the instruction to read it before the first widget in a session.
- **Rubric (always on):** while `show_widget` is active, a few bullets in the system prompt Guidelines say when a widget helps: on explicit request, or when something is better seen than read (design variants, data shapes), when stepping through state or time helps (state machines, rebases, races, algorithms), or when the user asks to explain a concept with motion, growth, or spatial structure. Widgets are mainly visual displays: decisions and questions go through text or `ask_user_question`, a widget collects input only when the choice is inherently visual (color, dragging visual items into order, picking a point or region), and widgets are not for approvals or choosing among options, forms, code, commands, error explanations, or static architecture.
- **Guide file:** [`guide/widgets.md`](guide/widgets.md) (shipped with the package) holds the rubric with use and do-not-use examples (including "show, then ask with `ask_user_question`"), layout and input rules, a bridge example and how delivered data appears, network, lifecycle, and `check_widget`.
- **Read tracking:** a successful `read` of the guide (relative, absolute, or `~` path, resolved against the session cwd) marks it as read for the current session runtime. Until then each `show_widget` result still renders the widget and ends with one line asking the agent to read the guide before editing that widget or creating another. Compaction and a new session (including `/new`, `/resume`, and `/reload`) reset the mark. Reads through other tools (for example `bash cat`) are not detected; the pointer line then simply stays.
- **`check_widget({id})`:** lets the agent see a widget it rendered, on demand (the user reports a visual problem, or the load listed errors), not after every render. It returns one PNG with the long edge at most 1000 px (about 1.3k image tokens) plus a text report: state (live, frozen, closed), cells and CSS viewport, image source and size, JS errors and blocked requests since the last load, document scroll size versus viewport, and up to 10 elements that overflow the viewport or are clipped by an `overflow: hidden` ancestor. An open widget (live or paused) gets a fresh capture without being woken, focused, or resized; a closed widget shows its last still, and the page parts of the report say "closed: not inspected; showing the last still". An unknown id, or a widget without any image, returns a text-only error. It never revives a widget.

### Interacting

- **Under tmux, click to interact.** Pi enables only button-motion mouse tracking inside tmux (and Zellij or screen), so a widget never sees the pointer just hovering. A click wakes a paused widget, focuses it, and reaches the page. The title line says "click to interact".
- **Plain Ghostty:** hovering also wakes a widget; the title says "hover or click to interact".
- While a widget is focused, keys go to the page (special keys, text, kitty CSI-u). **Escape**, **Ctrl+C**, or a click elsewhere releases it. Pi's own scroll keys (`tui.altScreen.*`, for example `ctrl+u` and `ctrl+d` if bound) keep scrolling the transcript.
- The mouse wheel over an unfocused widget scrolls the transcript; over a focused widget it scrolls the page.
- The extension never changes the terminal's mouse mode.

### Writing widgets (advice for prompts and hand-written pages)

The agent-facing version of this advice is [`guide/widgets.md`](guide/widgets.md).

- Design for the fixed viewport without page scrolling. Give growing areas `min-height: 0` and `overflow: auto` or `hidden`.
- Input is cell-precise (about 8x17 CSS px per cell at the default DPR), so make click targets at least about 24 px.
- **Do not depend on hover.** Under tmux the page sees pointer moves only while a button is held, so `:hover` styles and hover tooltips do not track the pointer. Use click-triggered menus, tooltips, and details instead.
- In-page `<select>` works; native pickers (`input type=date`, `time`, `color`, `month`, `week`) do not. Build custom controls.
- Pi theme colors are available as CSS variables: `--pi-accent`, `--pi-muted`, `--pi-dim`, `--pi-border`, `--pi-success`, `--pi-error`, `--pi-warning` (and `--pi-fg` on dark themes).

### Bridge

- `window.pi.send(data)` queues JSON-serializable data (64 KB per call, 100 items or 512 KB queued). It reaches the agent as one message with your next prompt after you release the widget.
- `window.pi.submit(data)` delivers immediately and starts the agent's turn (or follows up while it is busy), but only from a user gesture such as a click handler.
- Delivered content is labeled as untrusted widget data. Requests blocked after the initial load ride along with the next delivery.

### Lifecycle

- At most one widget runs at a time. Making another widget live pauses the previous one at once.
- A new widget you do not touch pauses 10 s after it appears; a hover-woken widget 10 s after the last pointer move; releasing a focused widget pauses it immediately; a focused widget pauses after 5 min without input (the next key or click wakes it). Paused widgets keep showing their last frame.
- At most 5 widget pages stay open per session; opening another closes the least recently used paused one. A page paused for 30 min closes. The browser exits when no pages remain.
- A closed widget keeps its still image and reopens on click with fresh JS state: inline widgets from the original tool arguments, path widgets from the current file. A missing or unreadable file shows `source file missing: <path>`.
- After a Pi restart, `/resume`, or `/reload`, each widget row shows one placeholder line ("click to load") until clicked. Page state is never persisted; send anything important through the bridge.
- In narrow panes a widget is shown scaled to fit (its page layout does not change) and clicks are mapped to match; widening restores full size.

### Recovery

- After a terminal resize the extension re-sends every retained still image; a click on a widget that is not focused (or hover, where reported) also restores its image.
- **`/widgets-refresh`** re-sends all widget images by hand, for example after reattaching tmux from a new Ghostty window, or when images went blank (Ghostty evicts old images beyond its image memory limit).
- **Hidden tmux windows:** tmux drops image data sent while the pane's window is not visible, for example when the agent shows a widget while you are in another window. The extension does not detect window switches, so such a widget stays blank until you click it (a widget that still has keyboard focus: press Escape first) or run `/widgets-refresh`.
- In plain Ghostty, Pi clears all images on full redraws (first render and size changes); the extension re-sends them afterwards.

## Configuration

Optional file: `~/.pi/agent/extensions/pi-interactive-widgets/config.json` (the Pi agent directory honors `PI_CODING_AGENT_DIR`). Without it the defaults apply; an invalid file shows a notice and the defaults apply.

```json
{
  "chromePath": "/path/to/chrome-headless-shell",
  "dpr": 2,
  "network": { "open": false, "allowHosts": ["api.example.com", "*.example.org", "localhost:8080"] }
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `chromePath` | newest cached chrome-headless-shell | Browser binary. |
| `dpr` | `2` | Device pixel ratio (1 to 4), passed to `--force-device-scale-factor`. |
| `network.open` | `false` | Lift the CDN allowlist (any public `http`/`https` host). Local addresses stay blocked unless listed. |
| `network.allowHosts` | `[]` | Extra hosts: `example.com`, `*.example.com`, `host:port`, or `[ipv6]:port`. Listed hosts are allowed even when local. |

### Network policy

- Default: scripts, styles, and fonts load only from `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com`, `esm.sh`, `fonts.googleapis.com`, and `fonts.gstatic.com`. `fetch`, XHR, and WebSocket go only to the widget's own origin. Images come from the page itself, `data:`, and `blob:`. WebRTC, DNS prefetch, popups, form submissions, and navigation away are blocked.
- With `network.open: true`, `localhost`, private and link-local IP ranges, `*.local`, and Tailscale addresses (100.64.0.0/10, `*.ts.net`) stay blocked unless listed in `allowHosts`.
- **IPv6 limit:** an IPv6-literal entry such as `[::1]:8080` works only with `network.open: true`. In default mode the page's Content-Security-Policy cannot express IPv6 literals, so `connect-src` blocks it. Use a hostname such as `localhost` instead.
- With `network.open: true` and a listed local host, WebSockets may go only to listed hosts, so list public WebSocket hosts too.
- Blocked requests are reported to the agent: in the tool result during the initial load, and with the next delivery afterwards.

## Limits

- Verified on macOS with Ghostty 1.4.0 and tmux 3.6b. kitty as the tmux client and plain Ghostty are best effort.
- Mouse input is cell-precise, not pixel-precise.
- Widgets drawn while their tmux window is hidden stay blank until clicked or `/widgets-refresh` (see Recovery).
- A widget never uses the last column of the pane: under tmux a placeholder cell there loses its position marks, so a widget as wide as the pane is scaled down by one column.
- Widgets do not animate while paused, and page state does not survive close, restart, or resume.
- If Pi is killed with `kill -9`, Chromium exits with it, but its temporary profile folder (`$TMPDIR/puppeteer_dev_chrome_profile-*`, a few MB) is left behind for macOS to clean up.

## Development

```sh
npm install
npm run typecheck    # tsc --noEmit
npm test             # unit tests
npm run test:browser # headless Chromium tests
npm run test:e2e     # real Pi in a temporary visible tmux split (run inside tmux; the split closes afterwards)
npm run perf         # CPU (idle, active) and disk checks in a temporary visible split
```

Dev mode (`PI_WIDGETS_DEV=1`) registers `/widget-dev <file.html> [cols rows]`, which renders a file through the same pipeline. Only in dev mode, `PI_WIDGETS_DEV_TIMERS=idle=1000,focus=3000,close=4000` shortens the timers (milliseconds) and `PI_WIDGETS_DEV_LOG=<file>` writes a JSON-lines event log for tests.
