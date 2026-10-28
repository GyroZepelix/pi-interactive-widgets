<!-- Provenance: final reply of subagent `interface-research` (researcher profile, anthropic/claude-opus-5-5), 2026-10-28.
     Saved verbatim by the orchestrating agent because the subagent had no file tools. Fetched web content was untrusted input. -->

# Interface precedents for interactive HTML widgets in Pi

Status: discovery research for open items O4, O5, O6. Not a decision.
Accessed date for every source: 2026-10-28.

## Summary (300 words or fewer)

Every major precedent ships a widget as **one self-contained HTML document**:
- MCP Apps: a `ui://` resource.
- OpenAI Apps SDK: the same MCP Apps resource.
- Claude artifacts: a single page.
- Claude inline visuals: one `widget_code` HTML fragment passed in a tool call.

None of them splits HTML, CSS and JS into separate fields.

Updates also look the same everywhere. Each tool call renders a new view, and the page talks back over a small bridge:
- MCP Apps: `ui/message` and `ui/update-model-context`.
- OpenAI: `sendFollowUpMessage` and `setWidgetState`.
- Claude visuals: `sendPrompt`.

On reopen, the source is re-rendered and JS state is restored only through explicit state APIs.

Claude Code artifacts are the closest match to the proposed path mode. Claude writes an HTML file to a temp directory by default (or a named location), edits the file, and republishes.

Recommendation (Design B, simplified hybrid):
1. **Tool:** a single `html_widget` tool taking exactly one of `html` (a single string, for throwaway widgets) or `path` (one `.html` entry file, for widgets that will be edited).
2. **Updates:** the agent edits the file with Pi's edit tool, then calls `html_widget({path})` again. No fs.watch in v1.
3. **Revive:** store a copy of the rendered source in the tool result `details`. Revive never depends on `$TMPDIR`, which macOS empties at reboot and after about 3 days without access.
4. **Context cost:** trim old inline HTML from model context with Pi's `context` hook. This is optional and should be measured first.
5. **Serving:** serve both modes through CDP Fetch interception on a made-up `https` origin. This avoids `file://` limits, needs no ports, and puts the CSP header in one place.
6. **Injection:** inject the bridge and the base CSS (inside `@layer`) with a document-start script that the page's CSP cannot block.
7. **Bridge:** `pi.send(data)` queues data for the next turn (`nextTurn`). `pi.submit(data)` delivers it now (start a turn if idle, `followUp` if busy).
8. **Sandbox:** scripts, styles and fonts only from a CDN allowlist. Fetch, XHR and WebSocket only to the widget's own origin. File access only inside the widget's root directory. Incognito context so storage stays in RAM.

## Evidence labels

- **V1 Verified (read):** I fetched and read the page myself in this session.
- **V2 Verified (primary, extracted):** a primary source found through search. Specific claims were extracted, but I did not read the whole page.
- **U Unverified / inference:** my reasoning, community reverse engineering, or claims I could not confirm from a primary source.

Local Pi facts (Pi 1.4.0 source, `extensions.md`, `session-format.md`) are being checked separately by pi-seams. Pi API claims here come from the pi.dev "latest" docs [S22][S23], which may not match the installed version.

## 1. Precedents

### 1.1 MCP Apps (SEP-1865, stable spec 2026-01-26)

- **How content is supplied:** a tool points to a `ui://` resource through `_meta.ui.resourceUri`. The host reads that resource with MIME type `text/html;profile=mcp-app`, and the HTML text sits inline in the resource contents. The host may prefetch it. [S1][S2] (V2)
- **Rendering and handshake:** the view runs in a sandboxed iframe. Web hosts must use a double iframe (a sandbox proxy on a different origin). Messages are JSON-RPC over `postMessage`: `ui/initialize`, then the host pushes `tool-input` and `tool-result`. An optional `tool-input-partial` carries streamed partial arguments, for preview only. [S1] (V2)
- **Updates:** the HTML resource is a template. Data arrives as tool input and results, and the view can call tools itself through the host (subject to approval). There is no HTML patch protocol. [S1][S2] (V2)
- **State on reopen:** the spec has no state API. The official Patterns guide suggests a server-issued `viewUUID` in `_meta` used as a `localStorage` key, and calls this best-effort. Issue #417 discusses its limits. [S4][S5] (V2)
- **Data back to the model:** two methods [S1][S3] (V2):
  - `ui/update-model-context` replaces a snapshot of context for later turns and does not start a turn.
  - `ui/message` adds a user-role message that is intended to start a follow-up turn.
  - The documented pattern is to put the large payload in context first, then send a short message.
- **Sandbox and CSP default:** if `ui.csp` is omitted, the host MUST apply [S1] (V2):
  - `default-src 'none'`
  - `script-src 'self' 'unsafe-inline'`
  - `style-src 'self' 'unsafe-inline'`
  - `img-src 'self' data:`
  - `media-src 'self' data:`
  - `connect-src 'none'`

  Origins can be opened up only by declaring them in `connectDomains`, `resourceDomains`, `frameDomains` and `baseUriDomains`. Camera, microphone, geolocation and clipboard-write are requested through `ui.permissions`. One worked example in the spec conflicts with this default (it uses `connect-src 'self'`). (V2)
- **Sizing and display:** the view reports `ui/notifications/size-changed` (the SDK uses ResizeObserver). Display modes `inline`, `fullscreen` and `pip` are negotiated with `ui/request-display-mode`, and the host may refuse. [S1][S3] (V2)
- **Theming:** `hostContext.theme` is light or dark. `hostContext.styles.variables` holds standard CSS custom properties (for example `--color-background-primary`, `--font-sans`), and apps must provide fallbacks. [S1] (V2)

MCP-UI, the earlier community project, offered three content types: `rawHtml` (inline), `externalUrl` (URL) and `remoteDom`. Its actions were `tool`, `intent`, `prompt`, `notify` and `link`, sent with `postMessage`. It now points to MCP Apps. [S6] (V2)

### 1.2 OpenAI Apps SDK (`window.openai`)

- **How content is supplied:** the same as MCP Apps today. The older `text/html+skybridge` and `openai/outputTemplate` names are aliases. A single-file HTML bundle is supported but not required. OpenAI says to version the resource URI because it acts as a cache key. [S7][S8] (V2)
- **Bridge:** [S7][S8] (V2)
  - `toolInput` and `toolOutput` (the tool's `structuredContent`)
  - `widgetState` and `setWidgetState` (synchronous)
  - `callTool`
  - `sendFollowUpMessage({prompt})`
  - `requestDisplayMode`
  - `displayMode`, `maxHeight`, `theme`, `safeArea`
  - Changes arrive through an `openai:set_globals` event.
- **State on reopen:** `widgetState` belongs to one rendered widget instance and survives re-renders. It is not durable storage. A structured form splits it into `modelContent` (the model sees it on the next turn), `privateContent` (widget only) and `imageIds`. Saving state does not start a turn. [S8] (V2)
- **Data back to the model:** `modelContent` in widget state (passive, next turn), `sendFollowUpMessage` (active), and `callTool`. [S7][S8] (V2)
- **Sandbox:** an isolated iframe with a strict CSP. Allowed origins are declared in `_meta.ui.csp` (`connectDomains`, `resourceDomains`, `frameDomains`). `alert`, `prompt`, `confirm` and `navigator.clipboard` are unavailable. [S9] (V2)
- **Display modes:** inline, fullscreen and pip. On mobile, pip may become fullscreen. [S7] (V2)

### 1.3 Claude artifacts and Claude Code artifacts

- **Claude Code artifacts (closest match to path mode):** [S10] (V1)
  - Unless the user names a location, Claude writes the page to an HTML or Markdown file in a temporary directory outside the project, then publishes it.
  - To update, Claude edits the underlying file and republishes to the same URL. Each publish becomes a version.
  - The result is one self-contained page. Relative links do not resolve.
  - CSP:
    - Scripts load only from cdnjs, unpkg, the Tailwind CDN, code.jquery.com and some jsDelivr paths.
    - Fonts load only from Google Fonts.
    - External images, external stylesheets and all other external resources are blocked.
    - fetch, XHR and WebSocket may reach only the page's own origin and the Google Fonts hosts.
  - Data back to the session: the docs suggest a "Copy as prompt" export control for the user to paste. There is no built-in return channel.
- **Claude.ai artifacts:** persistent storage of 20 MB per artifact (text only), split into personal and shared. Newer artifacts do not need to be published to use storage. [S11] (V2)
- **Edit ergonomics:** reproduced historical system prompts show an `artifacts` tool with commands `create`, `update` (`old_str`/`new_str`, the old string must match exactly once) and `rewrite`. [S16] (U, community reproduction)

### 1.4 Claude inline interactive visuals ("custom visuals", March 2026)

- **What it is officially:** HTML-based visuals inline in chat, temporary by default. The user can copy, download as SVG or HTML, or save as an artifact. Clicking inside a visual can send a follow-up prompt in chat, but not in Cowork. They do not render on mobile. [S12][S13] (V2)
- **Mechanism (reverse-engineered, U):** [S14][S15]
  - A `show_widget` tool takes `widget_code`, a raw HTML fragment with no `<html>`, `<head>` or `<body>`.
  - Other parameters are `title`, `loading_messages` and `i_have_seen_read_me`.
  - A `read_me` tool loads design-guideline modules on demand.
  - The guidelines require styles first, then HTML, with scripts last so content can stream in. They mandate CSS variables and dark mode, and use a CDN allowlist (cdnjs, jsdelivr, unpkg, esm.sh).
  - A `sendPrompt(text)` function sends a chat message.
  - Whether rendering uses an iframe or direct DOM injection is disputed between sources.
- **pi-generative-ui (an existing Pi extension, V1):** [S15][S14]
  - Copies the pattern for Pi with tools `visualize_read_me` and `show_widget(widget_code)`, rendered in a native WKWebView window.
  - Streams partial HTML from the `toolcall_delta` events Pi already parses, and applies updates with morphdom DOM diffing.
  - Runs scripts only after the HTML is complete.
  - The tool result returns immediately. An earlier blocking "wait for interaction" design was dropped.
  - Widgets have no return channel to the agent.

### 1.5 Vercel AI SDK generative UI

- **Recommended pattern:** tools return **data**, and the app renders its own pre-built React components from `message.parts` (`tool-<name>`, with states like `input-streaming` and `output-available`). The model never writes markup. [S17] (V2)
- **`streamUI`:** the RSC approach, where the server yields React nodes. It is experimental and not recommended for production. [S18] (V2)
- **Relevance:** low for freeform widgets. It is the "templates plus data" end of the range.

### 1.6 Jupyter widgets (comm protocol)

- **Protocol:** `comm_open` creates a front-end model with its initial state. `display_data` with `application/vnd.jupyter.widget-view+json` creates a view tied to that model. `comm_msg` with `method: "update"` syncs state patches both ways. `request_state` and `custom` are also available. [S19] (V2)
- **Reopen:** state is saved only if explicitly stored in notebook metadata (`application/vnd.jupyter.widget-state+json`). Even then, kernel-side callbacks are gone until the cells are re-run. Missing models lead to "model not found". [S20] (V2)
- **Relevance:** a precedent for "reopen re-renders, live behaviour resets", which matches decision D-level "JS state resets".

### 1.7 terminal-browser (konaito)

- **How it works:** headless Chromium sends frames with CDP `Page.startScreencast`, drawn with kitty graphics using double-buffered image ids and skipping unchanged frames. SGR mouse events become `Input.dispatchMouseEvent`, and raw stdin becomes `Input.dispatchKeyEvent`. [S21] (V1)
- **Content:** a URL, a localhost address or local HTML paths. There is no inline HTML.
- **Agent control:** an `action` CLI over a Unix socket (snapshot, click, fill, eval, read, tab), compatible with agent-browser. This lets an agent drive the page; it does not carry widget-to-agent data.
- **Relevance:** confirms the rendering and input pipeline. Its agent CLI is a possible later "agent inspects widget" feature, not a v1 need.

### 1.8 Comparison table

| Precedent | Content supply | Updates | State on reopen | Data to model | Network default | Sizing / display | Theming |
|---|---|---|---|---|---|---|---|
| MCP Apps [S1] | `ui://` resource holding inline HTML, linked from tool `_meta` | new tool result to the view; view can call tools; no HTML patch | none in spec; `viewUUID` + localStorage pattern, best-effort | `update-model-context` (snapshot, no turn); `ui/message` (turn) | `connect-src 'none'`; only declared origins | `size-changed`; inline/fullscreen/pip on request | host CSS variables + light/dark |
| OpenAI Apps SDK [S7][S8] | same as MCP Apps | each call is a new instance; `set_globals` events | `widgetState` per instance, restored | `modelContent` (passive), `sendFollowUpMessage`, `callTool` | strict CSP; declared domains | `maxHeight`; inline/pip/fullscreen | `theme` value |
| Claude Code artifacts [S10] | **file** (temp dir by default) published to a URL | edit file, republish, new version | page source kept; claude.ai storage API [S11] | user pastes "Copy as prompt" output | CDN scripts allowlist; fetch to own origin only | full page | design skill + project tokens |
| Claude inline visuals [S12][S14] | **inline** HTML fragment in tool arg (U) | new call; streamed DOM diff (U) | temporary; save as artifact | click sends a follow-up prompt (`sendPrompt`, U) | CDN allowlist (U) | inline, transparent background | required CSS variables, dark mode (U) |
| pi-generative-ui [S15] | inline `widget_code` | streaming morphdom | none | none (display only) | full browser | native window | dark by default |
| Vercel AI SDK [S17] | tool returns data; app owns components | re-render from parts | message history | tool results | n/a | app-defined | app-defined |
| Jupyter widgets [S19][S20] | kernel opens comm with model state | `comm_msg update` patches both ways | only if state saved in metadata; kernel callbacks lost | state sync to kernel | n/a | output area | front-end theme |
| terminal-browser [S21] | URL or local path | live page | browser session | agent CLI drives the page | full browser | terminal pane | n/a |

Pattern across all of them: (a) one HTML document is the unit; (b) every render is a new view instance; (c) state is recovered only through an explicit state API; (d) the return channel separates a passive "context for next turn" path from an active "start a turn" path; (e) by default the network is limited to an allowlist.

## 2. Inline vs path vs hybrid for Pi

### 2.1 Context-token cost

- **Inline args stay in context:** tool call arguments persist in the JSONL session file and remain in model context until compaction (orchestrator digest; local check pending).
- **Writing a file costs the same at creation (U, inference):** a path-mode file created with Pi's `write` tool puts the whole document into the `write` call's arguments. Path mode saves tokens only on **edits**, where the edit tool sends diffs instead of the whole document.
- **The `context` hook can trim old HTML:** Pi's `context` event runs before each LLM call. It receives a deep copy of the messages (without system messages) and may return changed messages without altering stored history. [S22] (V2 against pi.dev latest docs) A handler could replace `html` in earlier `html_widget` calls with a short stub such as `[widget w3 "title", 8.1 KB, source kept by extension]`.
  - **Cache note (U):** if the stub is applied from the very first replay after the call, the cached prompt prefix never changes, so there is no extra cache miss. Eliding later (for example "keep the last N") changes earlier messages and causes one cache miss each time.
- **`context_edit` entries:** they omit or replace past message content without rewriting history. They can be created from `turn_end` and `agent_before_settle` draft entries, and the docs mention a `sessionManager.appendContextEdit` method. [S22][S23] (V2; local version U)
  - They target whole entries, and the tool call lives inside the assistant message. Replacing that message risks breaking the pairing between tool calls and tool results (U).
  - The `context` hook is safer for rewriting tool-call arguments. `message_end` can also replace the finalized message, but that changes persisted history and is not recommended.
- **Rough sizes (U):** typical widgets are 3 to 15 KB of HTML, about 1k to 4k tokens at roughly 4 characters per token. Two or three edits by full resend triple that. Diff edits usually cost a few hundred tokens.

### 2.2 Edit ergonomics

- **Inline update means resending everything,** at full output-token cost and latency. JSON escaping applies to the whole document (see section 4).
- **Path mode reuses Pi's built-in edit tool:** small exact-match diffs, which models already use reliably for code. This matches Claude Code artifacts (edit the file, republish) [S10] and the artifacts `update` command (`old_str`/`new_str`) [S16].
- **A `patch` parameter on an inline tool (U, not recommended):** it would duplicate Pi's edit tool, and it needs the model to remember the exact source text, which the context trim in 2.1 removes on purpose.

### 2.3 Multi-file assets

- Inline mode is limited to one document. Assets must be inlined, use data URIs, or come from a CDN.
- Path mode can serve sibling files (`app.js`, `data.json`, images) from the entry file's directory. That needs a real origin, not `file://` (section 3).
- **Recommendation:** support relative assets under the widget root, but tell the agent to prefer one self-contained file. All precedents assume one file, and a single file is enough for the revive copy.

### 2.4 Live reload (fs.watch on macOS)

- **Node behaviour on macOS:** kqueue for files, FSEvents for directories. `recursive: true` is supported. [S39] (V2)
- **Caveats:** [S39][S40] (V2)
  - Events are merged and can be duplicated.
  - `rename` means only "directory entries changed".
  - `filename` can be null.
  - A watcher on a file stays attached to its old inode, so atomic saves (write a temp file, then rename) are missed.
  - FSEvents can drop events, and Apple's answer is a rescan.
- **If watching is needed:** watch the directory, debounce about 100 to 200 ms, then stat and compare. chokidar's `atomic` option exists for this case. [S43] (V2)
- **Pi rule:** do not start watchers in the extension factory; start them on demand and close them in `session_shutdown`. [S22] (V2)
- **Cost:** FSEvents is cheap when idle (U). The real cost is extra complexity and unexpected reloads while the agent is half-way through several edits.
- **Recommendation:** no watcher in v1. The agent re-calls `html_widget({path})` after editing. Each re-render becomes an explicit transcript entry, which is easy to reason about. Watching can come later as an opt-in.

### 2.5 Revive-after-resume durability

- **macOS `$TMPDIR` (`/var/folders/.../T/`):**
  - `dirhelper` removes regular files whose creation **and** access times are both older than 3 days, and the boot-time pass clears the directory regardless of age. [S36][S37] (V2, Apple open-source code plus Chromium notes)
  - APFS does not reliably update access time on reads, so reading a file does not keep it alive. [S37] (V2)
  - `/tmp` is cleaned daily after 3 days. Newer macOS uses `tmp_cleaner` instead of `periodic` (one first-hand report, U). [S38]
- **Conclusion:** a temp-dir path cannot be the revive source.
- **Project paths** are durable but belong to the user, and they may change or be deleted.
- **Recommended approach (U):** on every render, store a copy of the rendered entry HTML in the tool result `details`. It is persisted in the JSONL but not sent to the model (digest). Revive always uses this copy, which also gives faithful history (the widget as it was then).
  - Cost: one extra JSONL write per render, which Pi performs anyway. It does not grow model context.
  - Inline mode needs no copy, because the arguments are already persisted.
  - Relative assets in path mode are not copied in v1; on revive they load if still present and fail cleanly if not.

### 2.6 Disk-write implications

| Mode | Disk writes per widget |
|---|---|
| Inline | none beyond the session JSONL |
| Path | one write per agent edit (allowed by the constraints) + one JSONL entry with the copy |

Frames and stills stay in RAM in both modes. Chromium's own writes: an incognito context (`browser.createBrowserContext()`) keeps cookies, localStorage and HTTP cache in memory. That does not mean the whole browser does zero disk I/O. [S34][S35] (V2)

## 3. Chromium path-mode specifics

- **Limits of `file://`:** local files get opaque or `null` origins. ES module scripts load in CORS mode and fail. `fetch` of `file://` fails. Workers from file URLs can throw `SecurityError`. [S24][S25] (V2)
  - `--allow-file-access-from-files` still exists in current Chromium as a testing override [S26] (V2). It is browser-wide and weakens isolation for every page in the profile, so it is not recommended.
  - Chrome 156 specifics: I found nothing newer than this general behaviour (U).
- **`page.setContent`:** uses `document.open/write/close` on `about:blank` with no URL navigation and no `baseURL` option [S29] (V2).
  - `<base href>` fixes relative URL resolution but not the origin or `location` [S30] (V2).
  - An opaque origin probably breaks `localStorage` and module workers (U).
  - The CSP can only come from a `<meta>` tag the author could leave out or override.
- **CDP Fetch interception (recommended):**
  1. `Fetch.enable` with `urlPattern` scoped to a made-up origin.
  2. On `Fetch.requestPaused`, read the file (or use the inline string held in memory) and answer with `Fetch.fulfillRequest`. The body must be base64, and you set the headers, including `Content-Type` and `Content-Security-Policy`.
  3. Every paused request must be fulfilled, continued or failed. [S27][S28] (V2)
  4. Only the made-up origin is paused, so CDN requests go straight out.
  5. Base64 overhead (+33%) and one CDP round trip per local asset do not matter at widget sizes (U).
  6. Main-frame navigations away from the widget origin can be blocked in the same handler (U).
- **Origin choice (U):** for example `https://w-<id>.pi-widget.invalid/`.
  - `.invalid` never resolves in DNS, so a missed intercept fails safely.
  - An `https` scheme should give a secure context with real origin semantics (localStorage, module workers). This is my assumption and needs a quick spike.
  - One origin per widget keeps storage separate between widgets.
  - Spike items: whether dedicated-worker script requests are intercepted by the page-level Fetch domain (fallback: Blob workers [S25]); blocking service workers.
- **Localhost HTTP server (alternative):**
  - Pros: standard behaviour, and workers and service workers just work.
  - Cons: a server and a port per Pi process (3 to 5 sessions), port lifecycle and collisions, other local processes can read it unless a token is added, and CSP is a second place to configure.
  - Chrome 142+ Local Network Access prompts apply to *public* pages calling localhost. A loopback page loading public CDNs is not affected. [S31] (V2)
- **Bridge injection:** use `Page.addScriptToEvaluateOnNewDocument` together with `Runtime.addBinding` (Puppeteer `exposeFunction`). Both run through the inspector and are not blocked by the page's CSP; they also do not disable it. `Runtime.addBinding` takes one string argument. [S32][S33] (V2)
- **KISS recommendation:** one Fetch-interception handler serves both inline documents (from memory) and path directories (from disk, restricted to the root). It sets CSP centrally, and injection uses document-start scripts. Avoid `file://` and the flag. Keep `setContent` only as a fallback if interception fails a spike.

## 4. One `html` string vs separate `html`/`css`/`js` fields

- **Precedents:** all use one document or fragment: MCP Apps and OpenAI resource text [S1][S8], Claude artifacts "one self-contained page" [S10], Claude visuals `widget_code` [S14], pi-generative-ui [S15]. (V1/V2) I found no major precedent with split fields.
- **Reliability:**
  - Aider's 2024 benchmark found that every tested model wrote worse code inside JSON tool arguments than in markdown. Strict JSON did not help, and quality dropped even without escaping errors. [S41] (V2; 2024 models, may not apply to newer ones)
  - Split fields keep the code inside JSON and add more fields to escape and order. They also lose control over ordering: multiple `<script>` tags, CDN tags before inline code, module scripts, and the streaming-friendly style, then markup, then script order [S14].
  - Path mode avoids JSON for the document body after creation, because edits are small diffs.
- **Streaming:** Pi already parses partial tool-call JSON on every delta [S14][S15] (V1 per that author). Anthropic notes that eagerly streamed tool input can be incomplete or invalid JSON [S42] (V2). A single field streams naturally if progressive preview is ever wanted. That is out of scope for v1 (U).
- **Fragment vs full document:** accept both, as the PoC did. A fragment is wrapped in an extension-owned shell, as with Claude visuals. A full document is served as written.
- **Where to inject (U, recommended):**
  - **Bridge:** a document-start init script defines `window.pi` before any page script, for both fragments and full documents, and the page's CSP cannot block it.
  - **Base CSS** (reset, theme variables, layout rules from the PoC): insert at document start, wrapped in `@layer pi-base { ... }`, so any unlayered author CSS wins. Theme variables go on `:root` (for example `--pi-bg`, `--pi-fg`, `--pi-accent`, `--pi-font-mono`) plus `color-scheme`. `prefers-color-scheme` can be emulated with CDP `Emulation.setEmulatedMedia` (U).

## 5. Minimal v1 tool surface

**Tools:**
- **`html_widget` only.** Each call renders a new widget instance (a new view per call, as in MCP Apps and OpenAI).
- **No `update`:** re-call with the same `path`.
- **No `close`:** the UI owns the lifecycle.
- **No `get_state`:** data is pushed from the page.
- **Return immediately** with a short text result. Do not block waiting for user interaction (pi-generative-ui's lesson [S15]).

**Page bridge (minimal, U):**
- `pi.send(data)` adds a JSON item to a pending queue (capped in size and count). When the user releases the widget, the queue is delivered as one `pi.sendMessage({customType, content, display}, {deliverAs: "nextTurn"})`. This keeps the PoC behaviour and is the equivalent of passive `update-model-context` / `modelContent`.
- `pi.submit(data)` is optional but cheap. It sends the pending queue plus `data` now: `triggerTurn: true` with `followUp` if Pi is idle (starts a turn), and `followUp` without trigger if busy (does not derail current work). This is the equivalent of `ui/message`, `sendFollowUpMessage` and `sendPrompt`.
  - pi.dev semantics [S22] (V2): `steer` is delivered after the current tool calls, before the next LLM call. `followUp` waits until the agent has no more tool calls. `nextTurn` waits for the next user prompt and ignores `triggerTurn`.
  - Avoid `steer` for widget events: it could inject UI noise into an unrelated running task (U).
- **Defer:** `pi.setState` / revive state (JS state resets per the constraints; note the precedents `widgetState` and `viewUUID`+localStorage), live streaming of events, agent-side inspection (terminal-browser-style `snapshot`/`eval`), and display modes.

**When data reaches the agent:**
- By default, on release (batched, `nextTurn`). Live delivery only through explicit `submit`.
- Matches the precedents' split between passive context and an active turn, and avoids token spend on every click.

## 6. Sandbox scope (medium assurance, personal setup)

**Precedent defaults:**
- MCP Apps: no network unless declared [S1].
- OpenAI: strict CSP with declared domains [S9].
- Claude Code artifacts: CDN script allowlist, fetch only to the page's own origin [S10].
- Claude visuals: CDN allowlist (U) [S14].

**Proposed default CSP header** (U, sent by the Fetch handler):

```text
default-src 'self' data: blob:;
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://esm.sh;
style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com;
font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net;
img-src 'self' data: blob:;
connect-src 'self';
frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'
```

- `'unsafe-eval'` is allowed because some charting and templating libraries need it. It is a medium-assurance trade-off.
- A user config can extend the allowlists. A per-call "allow network" parameter is not recommended for v1 (the agent should not widen its own sandbox).

**File access:**
- Path mode serves only files whose `realpath` is inside the widget root directory (the entry file's directory). Everything else returns 404.
- No `file://`, no `--allow-file-access-from-files`, no directory listing.
- Inline mode serves only the in-memory document.

**Other measures:**
- Incognito browser context per widget origin (or a shared one) so storage stays in RAM [S34].
- Block popups and top-level navigation away.
- The only privileged channel is the `pi` binding: validate JSON and cap its size.
- Page JS has no Node access. The page is untrusted generated content: its events reach the model labeled as widget data, never as instructions.

## 7. Candidate designs

### Design A: inline only (PoC+)

`html_widget({ html, title?, cols?, rows? })`. An update is a full resend. The context hook trims older copies.

- **Pros:** smallest implementation, no files, revive is free from persisted arguments, same shape as Claude visuals and pi-generative-ui.
- **Cons:** every edit costs a full resend in output tokens and time, with JSON escaping over the whole document. No multi-file assets. Editing gets worse for longer-lived widgets.

### Design B: hybrid, one tool, explicit re-render (RECOMMENDED)

`html_widget({ html?: string, path?: string, title?, cols?, rows? })`, with exactly one of `html` or `path`.

- **Throwaway widgets:** `html`, which may be a fragment or a full document.
- **Editable widgets:** the agent writes `<dir>/index.html` with Pi's `write` tool, either in the project or in an extension-suggested scratch dir such as `$TMPDIR/pi-widgets/<session-id>/`. It then calls `html_widget({path})`. After `edit` calls, it calls `html_widget({path})` again.
- **Details:** `{ id, mode, path?, sourceSnapshot (path mode), title, cols, rows }`. Revive uses the copy.
- **Serving and bridge:** Fetch-interception origin per widget; central CSP; injected bridge (`pi.send`, `pi.submit`) and `@layer` base CSS.
- **Optional:** the `context` hook replaces `html` arguments with a stub from first replay.
- **Pros:**
  - Edits are cheap diffs.
  - Matches the Claude Code artifacts workflow [S10].
  - Throwaway widgets stay single-call.
  - Revive does not depend on `$TMPDIR`.
  - One serving path for both modes.
- **Cons:**
  - Two parameter modes to explain in the tool description.
  - Creating a file still costs full tokens.
  - Relative assets are not copied for revive.

### Design C: files only, extension-managed workspace

`html_widget({ path })` only. The agent always writes files first.

- **Pros:** one mode, no inline JSON, always editable.
- **Cons:** every widget takes at least two tool calls. Disk writes even for throwaway widgets, against the spirit of the constraints. Creation costs the same tokens anyway. Throwaway widgets in `$TMPDIR` still need the revive copy.

### Recommendation

**Design B**, with three cuts for KISS:
1. **No file watching.** The agent re-calls the tool after editing.
2. **No state API.** `pi.send` + `pi.submit` only.
3. **The context-trim hook is optional,** behind a setting. Turn it on after measuring real widget sizes.

Spike before committing:
- (a) The Fetch-interception `https` made-up origin: secure context, localStorage, module scripts, dedicated workers.
- (b) That pi-seams confirms the `context` hook and `sendMessage` semantics in local Pi 1.4.0.
- (c) The size of the copy stored in `details`, given typical widgets.

## Sources

All accessed 2026-10-28.

- [S1] [MCP Apps spec 2026-01-26 (ext-apps)](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
- [S2] [SEP-1865 MCP Apps](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp.md)
- [S3] [MCP Apps SDK, App class](https://apps.extensions.modelcontextprotocol.io/api/classes/app.App.html)
- [S4] [MCP Apps Patterns](https://apps.extensions.modelcontextprotocol.io/api/documents/patterns.html)
- [S5] [ext-apps issue 417, view state persistence](https://github.com/modelcontextprotocol/ext-apps/issues/417)
- [S6] [MCP-UI README](https://github.com/MCP-UI-Org/mcp-ui/blob/main/README.md)
- [S7] [OpenAI Apps SDK reference](https://developers.openai.com/apps-sdk/reference)
- [S8] [OpenAI, Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)
- [S9] [OpenAI, Security and privacy](https://developers.openai.com/plugins/guides/security-privacy)
- [S10] [Claude Code Docs, Share session output as artifacts](https://code.claude.com/docs/en/artifacts)
- [S11] [Claude Help, What are artifacts](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them)
- [S12] [Claude Help, Custom visuals in chat and Cowork](https://support.claude.com/en/articles/13979539-custom-visuals-in-chat-and-cowork)
- [S13] [Claude builds interactive visuals in your conversation](https://claude.com/resources/articles/claude-builds-visuals)
- [S14] [Michael Livs, Reverse-engineering Claude's generative UI](https://michaellivs.com/blog/reverse-engineering-claude-generative-ui)
- [S15] [Michaelliv/pi-generative-ui](https://github.com/Michaelliv/pi-generative-ui)
- [S16] [r/ClaudeAI, artifacts update command](https://www.reddit.com/r/ClaudeAI/comments/1gxvdlw/claude_can_now_surgically_edit_artifacts_instead/)
- [S17] [AI SDK, Generative User Interfaces](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces)
- [S18] [AI SDK RSC overview](https://ai-sdk.dev/docs/ai-sdk-rsc/overview)
- [S19] [ipywidgets message protocol](https://github.com/jupyter-widgets/ipywidgets/blob/main/packages/schema/messages.md)
- [S20] [ipywidgets embedding](https://ipywidgets.readthedocs.io/en/stable/embedding.html)
- [S21] [konaito/terminal-browser](https://github.com/konaito/terminal-browser)
- [S22] [Pi docs, Extensions](https://pi.dev/docs/latest/extensions)
- [S23] [Pi docs, Session File Format](https://pi.dev/docs/latest/session-format)
- [S24] [MDN, JavaScript modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
- [S25] [MDN, CORS request not HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors/CORSRequestNotHttp)
- [S26] [Chromium content_switches.cc](https://chromium.googlesource.com/chromium/src/+/HEAD/content/public/common/content_switches.cc)
- [S27] [CDP Fetch domain](https://chromedevtools.github.io/devtools-protocol/tot/Fetch/)
- [S28] [Puppeteer, Request interception](https://pptr.dev/guides/request-interception)
- [S29] [Puppeteer Frame.ts (setContent)](https://raw.githubusercontent.com/puppeteer/puppeteer/main/packages/puppeteer-core/src/api/Frame.ts)
- [S30] [MDN, base element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/base)
- [S31] [Chrome, Local Network Access permission prompt](https://developer.chrome.com/blog/local-network-access)
- [S32] [CDP Page domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/)
- [S33] [Puppeteer, page.exposeFunction](https://pptr.dev/api/puppeteer.page.exposefunction)
- [S34] [Puppeteer, BrowserContext](https://pptr.dev/api/puppeteer.browsercontext)
- [S35] [Chromium Security FAQ](https://chromium.googlesource.com/chromium/src/+/master/docs/security/faq.md)
- [S36] [Apple dirhelper.c (system_cmds-597.90.1)](https://github.com/apple-oss-distributions/system_cmds/raw/refs/tags/system_cmds-597.90.1/dirhelper.tproj/dirhelper.c)
- [S37] [Chromium code_sign_clone_manager.mm (macOS temp cleanup notes)](https://chromium.googlesource.com/chromium/src/+/lkgr/chrome/browser/mac/code_sign_clone_manager.mm)
- [S38] [picklog, macOS /tmp cleanup tmp_cleaner](https://www.picklog.cc/blog/macos-tmp-cleanup)
- [S39] [Node.js fs.watch docs](https://nodejs.org/api/fs.html)
- [S40] [Apple, Using the File System Events API](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/UsingtheFSEventsFramework/UsingtheFSEventsFramework.html)
- [S41] [Aider, LLMs are bad at returning code in JSON](https://aider.chat/2024/08/14/code-in-json.html)
- [S42] [Anthropic, Fine-grained tool streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming)
- [S43] [chokidar README](https://github.com/paulmillr/chokidar/blob/main/README.md)
