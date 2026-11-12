# Handoff: RPC mode requirements from A.Y.A.

Date: 2026-11-09
From: A.Y.A. voice assistant project (`~/Documents/1-Projects/10-software-development/pi-voice-assistant`, roadmap item `261109-1834-a-y-a-roadmap`, backlog B11b)
Status: requirements input for a later grill-with-docs in this repository. Not a design and not a plan. Everything here is open to refinement.

## Why

A.Y.A. is the user's Android assistant. Holding the power button opens an overlay; the user speaks or types; the request goes to Pi running in Termux on the phone. The user wants Pi in A.Y.A. to show the same interactive HTML widgets this extension shows in the terminal, rendered natively in the phone overlay, and to send widget interactions back to Pi.

Architecture today:

```text
A.Y.A. app (Kotlin/Compose overlay)
   <-> WebSocket on 127.0.0.1 (Durable-shaped protocol: snapshot + changes per conversation)
aya-bridge (Node, in Termux)
   <-> JSONL over stdin/stdout
pi --mode rpc (cwd ~/aya, global extensions + ~/aya/.pi project layer)
```

The app can render HTML in an Android WebView (a full Chromium-based browser view) inside the overlay. The missing piece is on the Pi side.

## Current behaviour (fact, checked 2026-11-09)

- `src/index.ts`: `interactive(ctx) = ctx.mode === "tui" && ctx.hasUI`. In any other mode, `show_widget` returns "show_widget needs Pi's interactive terminal UI; nothing was rendered." So under `pi --mode rpc` the model is told the widget failed, even when the client could render it.
- Pi's RPC extension UI supports `setWidget` with string lines only; `custom()` is unavailable in RPC (Pi docs `rpc-extension-ui.md`). There is no standard RPC channel for HTML widgets.
- RPC clients do see tool calls: `tool_execution_start` carries `args` (so inline `html` is visible) and `tool_execution_end` carries `result.content` and `result.details` (Pi docs `json.md`).
- Widget data reaches the agent through `pi.send` (delivered with the next user message, `deliverAs: "nextTurn"`) and `pi.submit` (starts or follows up a turn) (`src/bridge.ts`).

## What A.Y.A. needs (requirements)

- R1 Client capability opt-in. The extension must know that the RPC client renders widgets, so it does not claim success to a client that cannot show anything. Candidate signals: an environment variable set by the host (for example `PI_WIDGETS_CLIENT=aya`), a config key, or a Pi flag. A.Y.A.'s bridge can set any of these.
- R2 Success semantics in RPC. With the capability present, `show_widget` succeeds and its tool result tells the model the widget is shown in the client, with a summary that makes sense outside a terminal (no "fullscreen TUI mode" hints, no kitty notes).
- R3 Complete widget payload for the client. The client must receive everything needed to render without access to Pi's process:
  - widget id, title, and size hints (the client needs a sizing contract; terminal cells are meaningless on a phone, so define CSS pixel or aspect hints, or let the client choose);
  - inline `html` as given;
  - for `path` widgets, the entry file and the folder and subfolders it may load, as a bundle the client can serve (for example a file map in `details`, or a documented way for the host to fetch files), with size limits.
  Preferred channel: the tool result `details`, so the payload is also stored in the session and survives reloads.
- R4 Interaction back to Pi. The client implements `window.pi.send(json)` and `window.pi.submit(json)` in the WebView. The extension must offer an RPC-reachable entry point so the host can deliver these events and the agent sees exactly the same message format as in the TUI (`widgetMessage` and delivery options). Candidates: an extension command (`/widget-event <json>`), a documented `follow_up`/`prompt` envelope the extension intercepts with an `input` hook, or another Pi mechanism.
- R5 Replay. When the overlay reopens or the session is reloaded, the client re-renders widgets from session history (tool call args plus result details). The payload must be self-contained enough for that, or say clearly when a widget cannot be revived.
- R6 `check_widget` in RPC. Either a clear "not available in this client; ask the user what they see" result, or a defined way for the client to return a screenshot and layout report. A first version can skip screenshots.
- R7 Security parity. The same CSP and network rules as the TUI version: scripts, styles and fonts only from major CDNs; no arbitrary network. The client enforces them in its WebView; the extension should expose the policy (allowed origins) so both sides agree.
- R8 Guide parity. The widget guide given to the model should mention the RPC client's viewport (phone overlay, touch, no hover) when the capability is present.
- R9 No regression in the TUI.

## Concrete A.Y.A. examples

- "What's the weather this week?" -> a small forecast card widget in the overlay.
- "Show me the house lights" -> a panel of toggles; tapping a toggle calls `pi.submit({light: "outside", on: false})`, the agent runs the action and replies by voice.
- "Pick a restaurant for tonight" -> three cards; tapping one calls `pi.send({choice: 2})`, which arrives with the user's next spoken message.
- "Plot my battery drain today" -> a chart widget.
- Reopening the overlay later shows the same widgets in the conversation history.

## Non-goals for this extension

- Rendering anything inside Pi's process for RPC (the client renders).
- A.Y.A.-specific UI or theming (A.Y.A. styles the container).
- Changes to Pi core (unless the grill finds a small upstream gap worth proposing).

## Open questions for the grill here

- Capability signal shape (R1) and whether other RPC clients should be able to use it.
- Payload format and limits for `path` widgets (R3); inline-only first version?
- Event entry point for `send` and `submit` (R4).
- Sizing contract (R3).
- Versioning of the payload so A.Y.A. and the extension can evolve independently.

## Acceptance ideas

- Under `pi --mode rpc` with the capability set: `show_widget` succeeds, `tool_execution_end.result.details` contains a renderable payload for inline and path widgets, and a scripted RPC client can deliver `send` and `submit` events that reach the agent in the same format as in the TUI.
- Without the capability: current behaviour is unchanged.
- TUI behaviour and tests unchanged.

## A.Y.A. side (for context, built later in A.Y.A.)

A.Y.A. will add a WebView widget renderer, the `window.pi` shim, protocol messages between bridge and app, and replay from snapshots, in a separate A.Y.A. item after this extension supports RPC mode.
