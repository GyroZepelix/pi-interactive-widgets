<!-- Provenance: final reply of subagent `pi-seams` (scout profile, gemini-3.8-flash), 2026-10-28, read-only inspection of installed Pi 1.4.0.
     Saved verbatim by the orchestrating agent because the scout profile cannot write files. See the verification note at the end. -->

# Pi 1.4.0 Integration Seams Reconnaissance Report

Target environment:
- `@earendil-works/pi-coding-agent` v1.4.0 (`~/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/`)
- `@earendil-works/pi-tui` v1.4.0 (`~/.bun/install/global/node_modules/@earendil-works/pi-tui/`)

---

### 1. Fullscreen (Alt-Screen) Rendering and Viewport Visibility

- **Render scope across transcript:**
  `render()` calls are made for **all** transcript components, not just those within the visible viewport.
  - In [`pi-tui/dist/components/scroll-view.js`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/components/scroll-view.js#L186-L190):
    ```javascript
    render(width) {
        const contentWidth = this.getContentWidth(width);
        const lines = this.child.render(contentWidth);
        return contentWidth === width ? lines : lines.map((line) => `${line} `);
    }
    ```
  - In [`pi-tui/dist/layout.js`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/layout.js#L72-L75):
    ```javascript
    const childBox = layoutComponent(context, node.component, x, y - previousScrollTop, contentWidth, undefined, clip);
    const contentHeight = childBox.rect.height;
    ```
    `layoutComponent` invokes `renderCached(context, node.component, contentWidth)` on the child container (`documentContainer`), which in turn calls `render(width)` on every component in `children` ([`pi-tui/dist/tui.js:141-147`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui.js#L141-L147)).

- **Component viewport visibility detection:**
  A component **cannot** learn whether it is visible through standard component APIs or callbacks.
  - `Component.render(width: number): string[]` ([`pi-tui/dist/tui.d.ts:68-74`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui.d.ts#L68-L74)) receives only `width`. No viewport height, scroll offset, or clip rect is passed.
  - `ScrollView` exposes getters `scrollTop` and `viewportHeight` ([`pi-tui/dist/components/scroll-view.js:37-45`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/components/scroll-view.js#L37-L45)), but it maintains no event listeners or visibility callbacks.
  - `transcriptScrollView` is not exposed on `ExtensionContext` or `renderResult` context.

- **Detecting when a widget scrolls out of view:**
  - *Unverified:* To detect being scrolled out of view, an extension holding the `TUI` instance can query `tui.viewportTop` ([`pi-tui/dist/tui-alt-screen.js:107-109`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js#L107-L109)) and inspect `tui.currentLayout` box bounds, or calculate cumulative line heights of preceding siblings in `documentContainer`.
  - Alternatively, mouse events are only routed when the pointer intersects the component's visible clipped box (`clip = intersect(parentClip, box.rect)` in [`pi-tui/dist/layout.js:44`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/layout.js#L44)).

---

### 2. TUI Instance Access, Re-renders, and Focus Management

- **Official ways for an extension to obtain the TUI instance:**
  There is no direct `ctx.ui.tui` property. The `TUI` instance is only passed into factory callbacks on `ExtensionUIContext` ([`pi-coding-agent/dist/core/extensions/types.d.ts`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts)):
  1. `ctx.ui.setWidget(key, (tui: TUI, theme: Theme) => Component)` ([line 102](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts#L102))
  2. `ctx.ui.custom((tui: TUI, theme: Theme, keybindings, done) => Component)` ([line 121](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts#L121))
  3. `ctx.ui.setFooter((tui: TUI, theme: Theme, footerData) => Component)` ([line 111](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts#L111))
  4. `ctx.ui.setHeader((tui: TUI, theme: Theme) => Component)` ([line 115](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts#L115))
  5. `ctx.ui.setEditorComponent((tui: TUI, theme, keybindings) => Component)` ([line 175](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts#L175))

- **Requesting a re-render:**
  - With `TUI`: call `tui.requestRender()` or `tui.renderNow()` ([`pi-tui/dist/tui.d.ts:237-238`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui.d.ts#L237-L238)).
  - Inside `renderCall` / `renderResult`: invoke `context.invalidate()` ([`pi-coding-agent/dist/modes/interactive/components/tool-execution.js:78-81`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js#L78-L81)):
    ```javascript
    invalidate: () => {
        this.invalidate();
        this.ui.requestRender();
    }
    ```

- **Public focus API:**
  - `tui.getFocusedComponent(): Component | null` ([`pi-tui/dist/tui.js:276-278`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui.js#L276-L278)).
  - `tui.setFocus(component: Component | null): void` ([`pi-tui/dist/tui.js:279-281`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui.js#L279-L281)). If the component implements `Focusable` ([`pi-tui/dist/tui.d.ts:101-104`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui.d.ts#L101-L104)), `focused` is updated to `true` or `false`.
  - **Returning focus to the editor:** The default editor component instance is private to `InteractiveMode`. To return focus programmatically, an extension must capture `const prev = tui.getFocusedComponent()` before stealing focus and call `tui.setFocus(prev)`. Clicking the editor also restores focus via Pi's mouse hit dispatch.

---

### 3. Fullscreen vs Regular TUI Mode Detection and Runtime Switching

- **Detection at runtime:**
  - Public TUI API: `tui.mode` returns `"regular" | "fullscreen"` ([`pi-tui/dist/tui.d.ts:219`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui.d.ts#L219); `TuiAltScreen.mode = "fullscreen"` in [`pi-tui/dist/tui-alt-screen.js:38`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js#L38); `TuiMainScreen.mode = "regular"` in [`pi-tui/dist/tui-main-screen.js:101`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui-main-screen.js#L101)).
  - Settings: `settingsManager.getTuiMode()` reflects configured mode.

- **Runtime change during a session:**
  - **Yes**, mode can change dynamically mid-session.
  - When changed in `/settings`, `onTuiModeChange` calls `switchTuiMode(mode)` ([`pi-coding-agent/dist/modes/interactive/interactive-mode.js:4202-4212`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js#L4202-L4212)).
  - `switchTuiMode` stops the existing renderer with `{ preserveScreen: true }`, instantiates the new TUI class, remounts all children, restores focus, and starts the new renderer ([`interactive-mode.js:605-650`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js#L605-L650)).
  - Extensions holding the `tui` reference proxy created by `createInteractiveTuiReference` automatically route calls to the active renderer ([`pi-coding-agent/dist/modes/interactive/tui-renderer.js:37-66`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/tui-renderer.js#L37-L66)).

---

### 4. Session Resume, Startup, and Tool Result Re-rendering

- **Tool results re-rendering with stored details:**
  **Yes.** On resume/load, `renderSessionEntries` calls `renderSessionItems` ([`interactive-mode.js:3191-3272`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js#L3191-L3272)). When iterating `toolResult` messages, it matches `toolCallId` and invokes `component.updateResult(message)` ([line 3259](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js#L3259)), calling `updateDisplay()` ([`tool-execution.js:242-246`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js#L242-L246)):
  ```javascript
  const component = resultRenderer(
      { content: this.result.content, details: this.result.details },
      { expanded: this.expanded, isPartial: this.isPartial },
      theme,
      this.getRenderContext(this.resultRendererComponent)
  );
  ```

- **`session_start` event payload:**
  [`pi-coding-agent/dist/core/extensions/types.d.ts:575-581`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts#L575-L581):
  ```typescript
  export interface SessionStartEvent {
      type: "session_start";
      reason: "startup" | "reload" | "new" | "resume" | "fork";
      previousSessionFile?: string;
  }
  ```

- **`context.lastComponent` semantics:**
  In [`tool-execution.js:74-93`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js#L74-L93), `getRenderContext(lastComponent)` sets `lastComponent: this.resultRendererComponent`. On initial call, `lastComponent` is `undefined`. On subsequent updates (e.g., results arriving, expansion toggling, invalidation), `lastComponent` receives the exact Component instance returned in the prior render.

- **Eager vs lazy execution:**
  `renderResult` is invoked **eagerly** for all rows during session resume/startup in the synchronous loop of `renderSessionItems` ([`interactive-mode.js:3203-3267`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js#L3203-L3267)).

---

### 5. Kitty Image Tracking and Deletion Mechanics

- **How Kitty image IDs are tracked and deleted:**
  - In `TuiMainScreen` ([`pi-tui/dist/tui-main-screen.js:66-95, 200-210`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui-main-screen.js#L66-L95)): `parseKittyImageHeader(line)` looks strictly for `line.indexOf("\x1b_G")` and extracts `i=<id>` parameters. `deleteChangedKittyImages(firstChanged, lastChanged)` compares current lines with `previousLines` and emits `deleteKittyImage(id)` (`\x1b_Ga=d,d=I,i=<id>\x1b\\`).
  - In `TuiAltScreen` ([`pi-tui/dist/tui-alt-screen.js:247-292`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js#L247-L292)): `prepareKittyScreen` extracts image IDs via `getKittyImagePlacement(line)` ([`pi-tui/dist/terminal-image.js:310-348`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/terminal-image.js#L310-L348)), which searches for `\x1b_G` commands matching Pi's registered images. Offscreen images exceeding memory caps are evicted with `deleteKittyImage(imageId)`.

- **Deletion of images with IDs appearing only as placeholder foreground colors:**
  **No.** Pi never inspects Unicode placeholder characters or SGR `38;2;...m` foreground color codes for image IDs. It only looks for `\x1b_G` escape codes.

- **Risk to images uploaded directly to stdout by an extension:**
  - For differential line updates: **No risk**. Because the upload escape sequence is not placed in Pi's rendered line buffer, Pi does not detect the image ID and will not issue differential deletes.
  - For full redraws and exits in alt-screen mode: **Critical risk**.
    In [`pi-tui/dist/tui-alt-screen.js:1501-1504`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js#L1501-L1504):
    ```javascript
    const clearImages = this.imageProtocol === "kitty" && hadUploadedKittyImages
        ? deleteAllKittyPlacements()
        : this.deleteKittyImages();
    ```
    If `this.imageProtocol === "kitty"` and Pi has no uploaded images (`hadUploadedKittyImages === false`), `this.deleteKittyImages()` emits `deleteAllKittyImages()` (`\x1b_Ga=d,d=A,q=2\x1b\\` in [`terminal-image.js:213-215`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/terminal-image.js#L213-L215)), which deletes **all** images terminal-wide and frees their memory. The same sequence is emitted on stop ([`tui-alt-screen.js:206, 245`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js#L206)).
    *(Note: Under tmux, `imageProtocol` is `null` by default unless `PI_IMAGE_PROTOCOL=kitty` is set).*

---

### 6. Terminal Output Serialization and Tmux Passthrough

- **Sanctioned raw escape sequence serialization:**
  - Extensions can call `tui.terminal.write(data)` if `tui` was captured. However, `ProcessTerminal.write()` directly calls `process.stdout.write(data)` ([`pi-tui/dist/terminal.js:430-432`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/terminal.js#L430-L432)). There is no queuing or serialization mutex for raw writes.
  - Pi wraps its own screen draws in synchronized output brackets `BEGIN_SYNCHRONIZED_OUTPUT` (`\x1b[?2026h`) and `END_SYNCHRONIZED_OUTPUT` (`\x1b[?2026l`) ([`pi-tui/dist/tui-alt-screen.js:21-22, 1498`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js#L21-L22)).

- **Tmux passthrough handling:**
  - Pi does **not** handle or wrap DCS tmux passthrough (`\x1bPtmux;\x1b...`). Neither `pi-tui` nor `pi-coding-agent` emits `Ptmux`. The extension must manage its own DCS escape wrapping when sending passthrough escapes under tmux.

---

### 7. Mouse Handling and Routing

- **`handleMouse` event shape and return contract:**
  - Event shape: `TuiMouseEvent` ([`pi-tui/dist/tui.d.ts:13-32`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui.d.ts#L13-L32)):
    `type`: `"press" | "release" | "move" | "drag" | "click" | "wheel"`
    `button`: `"left" | "middle" | "right" | "none"`
    `x`, `y`: component-local coordinates
    `screenX`, `screenY`: absolute terminal cell coordinates
    `width`, `height`: component bounding box
    `shift`, `alt`, `ctrl`: boolean modifiers
    `wheelDelta?`: number (logical lines)
    `clickCount?`: number (for click events)
  - Return contract: `TuiMouseEventResult` ([`pi-tui/dist/tui.d.ts:33-45`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui.d.ts#L33-L45)):
    `handled?`: boolean
    `capture?`: boolean (subsequent drag/release events routed here)
    `focus?`: boolean (grants component keyboard focus)
    `render?`: boolean (request/suppress re-render)

- **Capture and focus semantics:**
  In [`tui-alt-screen.js:667-680`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js#L667-L680), `result.focus` triggers `this.setFocus(focusTarget)`. `result.capture` sets `this.mouseCapture = result.target`, directing all subsequent move/drag/release events to that target until release ([lines 717-737](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js#L717-L737)). On release without movement, Pi synthesizes a `"click"` event ([lines 728-735](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js#L728-L735)).

- **y-offset for tool rows with `renderShell: "self"`:**
  [`pi-coding-agent/dist/modes/interactive/components/tool-execution.js:188-198`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js#L188-L198):
  ```javascript
  handleMouse(event) {
      if (!this.hasRendererDefinition() || this.getRenderShell() !== "self")
          return super.handleMouse(event);
      if (event.y <= 0 || event.y > this.selfRenderHeight)
          return undefined;
      return this.selfRenderContainer.handleMouse({
          ...event,
          y: event.y - 1,
          height: this.selfRenderHeight,
      });
  }
  ```
  `renderShell: "self"` inserts a leading blank line (`lines.push("")` in line 171), so `y <= 0` is ignored and mouse events are forwarded with `y - 1`.

- **Mouse events in `registerEntryRenderer` components:**
  **Yes.** Custom entries are wrapped in `CustomEntryComponent` ([`pi-coding-agent/dist/modes/interactive/components/custom-entry.js:7-56`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/custom-entry.js#L7-L56)). `CustomEntryComponent` extends `Container` and adds `[Spacer(1), component]`. It uses `Container.prototype.handleMouse` ([`pi-tui/dist/tui.js:116-137`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui.js#L116-L137)), which forwards events to `component` with `y: event.y - 1` (accounting for the `Spacer(1)`).

- **Wheel precedence:**
  In [`tui-alt-screen.js:512-527`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js#L512-L527):
  1. Overlays get first chance (`dispatchMouseToOverlay`).
  2. Component layout under cursor is checked (`dispatchMouseToLayout`). If a component handles the wheel event (`handled: true`), it consumes it.
  3. If unhandled, `routeWheel` scrolls nested ScrollViews at pointer coordinates, falling back to scrolling the transcript `ScrollView` ([lines 806-820](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js#L806-L820)).

---

### 8. Key Handling Precedence and Interception

- **Keys intercepted before a focused component in fullscreen:**
  In [`tui-alt-screen.js:535-613`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js#L535-L613) (`handleViewportInput`):
  - `tui.altScreen.search`
  - Search overlay navigation when active (`tui.altScreen.searchNext`, `searchPrevious`, `searchClose`)
  - **Transcript scrolling keys** (intercepted **unless an overlay is focused**, per `shouldDeferViewportInputToOverlay()` lines 476-478, 559-560; for an inline transcript component, these are intercepted before the component):
    - `tui.altScreen.pageUp`
    - `tui.altScreen.pageDown`
    - `tui.altScreen.halfPageUp`
    - `tui.altScreen.halfPageDown`
    - `tui.altScreen.lineUp`
    - `tui.altScreen.lineDown`
    - `tui.altScreen.previousPrompt`
    - `tui.altScreen.nextPrompt`
    - `tui.altScreen.top`
    - `tui.altScreen.bottom`
  - Global debug shortcut `shift+ctrl+d` ([`pi-tui/dist/tui.js:740`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui.js#L740)).

- **How Ctrl+C and Escape reach a focused component:**
  In [`pi-tui/dist/tui.js:773-780`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui.js#L773-L780):
  ```javascript
  // Pass input to focused component (including Ctrl+C)
  // The focused component can decide how to handle Ctrl+C
  if (this.focusedComponent?.handleInput) {
      if (isKeyRelease(data) && !this.focusedComponent.wantsKeyRelease) {
          return;
      }
      this.focusedComponent.handleInput(data);
  }
  ```
  Neither Ctrl+C (`\x03`) nor Escape (`\x1b`) is intercepted by `tui.altScreen.*`. They pass directly to `this.focusedComponent.handleInput(data)`.

---

### 9. Semantics of `pi.sendMessage` Options

Source: [`pi-coding-agent/dist/core/agent-session.js:1844-1882`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L1844-L1882):

1. `deliverAs: "nextTurn"`:
   Appends message to `this._pendingNextTurnMessages`. It does not trigger a turn or steer now. It will be sent as part of the context when the next turn begins ([lines 1854-1856](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L1854-L1856)).
2. `deliverAs: "followUp"` (while streaming):
   Invokes `this.agent.followUp(appMessage)`. The message is queued to trigger a new turn after the current streaming turn completes ([lines 1858-1860](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L1858-L1860)).
3. `deliverAs: "steer"` (or default when streaming):
   Invokes `this.agent.steer(appMessage)`. The message is injected into the currently streaming turn ([lines 1861-1863](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L1861-L1863)).
4. `triggerTurn: true` (while idle):
   Invokes `this._startRun({ messageType: "custom", message: appMessage })`. Starts a new LLM turn immediately with the custom message as the trigger ([lines 1865-1871](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L1865-L1871)).
5. `triggerTurn: false` (while streaming):
   Appends message to `this._pendingCustomMessages` to be recorded once turn completes ([lines 1872-1878](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L1872-L1878)).
6. Idle and `triggerTurn: false` (and not `nextTurn`):
   Calls `this._appendCustomMessage(appMessage)` directly into session history ([lines 1880-1881](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L1880-L1881)), emitting `message_start` and `message_end` without prompting the LLM.

---

### 10. Context Manipulation and Size Limits

- **Removing/replacing large tool call arguments from model context:**
  - **`context` event handler (`pi.on("context", ...)`):**
    In [`pi-coding-agent/dist/core/extensions/runner.js:1006-1034`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js#L1006-L1034), `emitContext(messages)` passes `visibleMessages` to handlers. An extension can mutate `event.messages` in place or return modified messages. Large tool-call arguments on assistant messages or large tool-result outputs can be pruned or replaced before they reach the provider API.
  - **`context_edit` entries:**
    [`pi-coding-agent/docs/session-format.md:139-148`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/docs/session-format.md#L139-L148) and [`pi-coding-agent/dist/core/session-manager.js:962-998`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js#L962-L998) allow append-only context edits to earlier entries (`replacement: null` or `{ content: ... }`).
  - **`tool_call` hook caveat:**
    Mutating `event.input` in `tool_call` ([`agent-session.js:337`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js#L337)) affects what arguments the tool's `execute` receives, but does **not** rewrite the assistant message already persisted to the session file.

- **Size limits on persisted tool args or details:**
  There is **no framework-enforced size limit** on tool args or details in `SessionManager`. They are serialized directly with `JSON.stringify(entry)` to the JSONL file ([`pi-coding-agent/dist/core/session-manager.js:812`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js#L812)).

---

### 11. Image Protocol Detection, `getCellDimensions()`, and `PI_IMAGE_PROTOCOL` Under Tmux

- **Protocol detection under tmux:**
  In [`pi-tui/dist/terminal-image.js:44-47`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/terminal-image.js#L44-L47):
  ```javascript
  if (process.env.TMUX || term.startsWith("tmux")) {
      return { images: null, trueColor: hasTrueColorHint, hyperlinks: tmuxForwardsHyperlink() };
  }
  ```
  Returns `images: null` under tmux because "Image protocols are unreliable under tmux".

- **`PI_IMAGE_PROTOCOL` override:**
  In [`terminal-image.js:105-110`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/terminal-image.js#L105-L110):
  Setting `PI_IMAGE_PROTOCOL=kitty` overrides detection to `images: "kitty"`; `iterm2` overrides to `"iterm2"`; `none` or `0` forces `null`.

- **`getCellDimensions()` behavior under tmux:**
  - Default dimensions: `{ widthPx: 9, heightPx: 18 }` ([`terminal-image.js:8`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/terminal-image.js#L8)).
  - In [`pi-tui/dist/tui.js:629-637`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui.js#L629-L637), `queryCellSize()` queries cell dimensions with `\x1b[16t` **only if** `getCapabilities().images` is truthy.
  - Under tmux without `PI_IMAGE_PROTOCOL`, `images` is `null`, so Pi never queries cell size.
  - Even with `PI_IMAGE_PROTOCOL=kitty`, tmux does not respond to or forward `CSI 16 t` unless explicitly configured; `consumeCellSizeResponse` ([`tui.js:840-856`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui.js#L840-L856)) never fires, and `getCellDimensions()` permanently returns the default `{ widthPx: 9, heightPx: 18 }`.

---

## Best Starting Point for Parent

The best starting point for implementation is the **tool result renderer seam** with `renderShell: "self"`:
- Register tool via `pi.registerTool({ name: "show_widget", renderShell: "self", execute, renderResult })` ([`types.d.ts:468`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts#L468)).
- Capture `TUI` at startup via a transient probe widget (`ctx.ui.setWidget`) to access `setFocus` / `getFocusedComponent` / `requestRender` ([`types.d.ts:102`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts#L102)).
- Return a Component from `renderResult` that emits Unicode placeholder rows in `render()`, handles mouse events in `handleMouse()` with `y - 1` offset correction ([`tool-execution.js:188-198`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js#L188-L198)), and returns `{ focus: true }` to receive keyboard input in `handleInput()` ([`tui.d.ts:39`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-tui/dist/tui.d.ts#L39)).
- Strip heavy HTML payloads from LLM context via `pi.on("context", ...)` ([`runner.js:1006`](file:///Users/dgjalic/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js#L1006)).

---

## Summary (at most 250 words)

Pi 1.4.0 alt-screen renders all transcript components every frame via `ScrollView.render(width)`. Components receive only viewport width and have no visibility or scroll callbacks. `TUI` is accessible solely via factory callbacks (`setWidget`, `custom`, `setFooter`, `setHeader`, `setEditorComponent`). `tui.mode` exposes `"fullscreen" | "regular"`; it can change mid-session through `/settings` via `switchTuiMode`.

On session resume, `renderResult` is executed eagerly for all transcript tool rows with stored details, passing the previous instance in `context.lastComponent`. `session_start` delivers `reason: "startup" | "reload" | "new" | "resume" | "fork"`.

Pi tracks Kitty image IDs by scanning for `\x1b_G` commands, not Unicode placeholders or SGR 38;2 foreground color codes. Direct stdout uploads avoid line-differential deletion, but alt-screen full redraws and exits emit global `deleteAllKittyImages()` (`\x1b_Ga=d,d=A,q=2\x1b\\`) when `imageProtocol === "kitty"`. Under tmux, Pi disables image protocols (`images: null`), skips `\x1b[16t` cell queries, and defaults `getCellDimensions()` to 9x18px unless overridden with `PI_IMAGE_PROTOCOL`. Pi performs no tmux DCS passthrough wrapping.

Mouse routing provides local cell coordinates, click synthesis, and capture semantics. Tool rows with `renderShell: "self"` and custom entries require a `y - 1` offset adjustment. In fullscreen, unhandled wheel events scroll the transcript, while `tui.altScreen.*` navigation keys intercept input before inline components receive it; Escape and Ctrl+C pass through unhindered to `focusedComponent.handleInput`.

Large tool arguments can be pruned from model context via `pi.on("context", ...)`. SessionManager imposes no persistence size caps.

---

## Orchestrator verification note (2026-10-28)

- Verified (`pi-tui/dist/tui-alt-screen.js` L244-L245, L1494-L1504): `deleteKittyImages()` returns an empty string unless `imageProtocol === "kitty"`. Under tmux without `PI_IMAGE_PROTOCOL` (not set in the user's environment), Pi emits no Kitty deletes, so extension-uploaded images are safe in the target setup. Outside tmux, full redraws emit `a=d,d=A` (delete all images) when Pi has no uploaded images of its own, or `a=d,d=a` (delete all placements) otherwise; a degrade path outside tmux must re-upload after full redraws or treat this as unsupported. Pi's delete sequences are not tmux-wrapped.
- Verified (`pi-tui/dist/layout.js` L14-L80): layout renders every child through `renderCached` and computes per-box `clip` rectangles; visibility is derivable only from the private `currentLayout` box tree (`tui-alt-screen.js` L45, L1557), not from a public API.
