# Discovery: RPC mode widget support for A.Y.A.

Work item: `261120-1155-rpc-mode-widget-support-for-a-y-a`
Status: Discovering - concluded: the feature does not belong in this extension (D3); this item awaits a drop
Created: 2026-11-20
Updated: 2026-11-20
Assurance: medium (user confirmed 2026-11-20) - (1) defines a versioned payload and event contract consumed by another repository (A.Y.A.), so mistakes cost coordinated rework; (2) touches the shared `show_widget` execute path, so TUI regression (R9) is the main risk; (3) single user, local, reversible, no secrets or migrations, so not high.

## Objective

Let `show_widget` work under `pi --mode rpc` when the RPC client declares it can render widgets: the extension renders nothing itself, returns a self-contained widget payload the client renders in its own WebView, and accepts the client's `pi.send` / `pi.submit` events so the agent sees the same widget-data messages as in the TUI.

## Desired outcome

- A.Y.A. (and any other opted-in RPC client) can render widgets from `tool_execution_end.result.details` and from session history on replay.
- Widget interactions from the client reach the agent in the exact TUI message format and delivery semantics.
- Without the opt-in, and in the TUI, behavior is unchanged.

## Repository and domain context

- Input: [A.Y.A. RPC requirements handoff](./handoff.md) (R1-R9), moved here from `spec/handoffs/` when this item took it; backlog B1 deleted.
- Client side (A.Y.A. app WebView renderer, `window.pi` shim, bridge protocol, replay) is built later in the A.Y.A. repository (its backlog B27). A.Y.A.'s Pi layer currently filters `pi-interactive-widgets` out (`pi-voice-assistant/wiki/research/termux-pi-integration.md`).
- Related but separate: A.Y.A. handoff H7 "Pinboard" (2026-11-12) wants agent-filled HTML pins in the overlay; it may later reuse this payload, but it is an A.Y.A. design, not part of this item.
- Pi version in devDependencies: 1.5.2.

## Scope

- Capability opt-in (R1), RPC success semantics and summary text (R2), self-contained payload in `details` (R3), RPC-reachable event entry point (R4), replay-ready payload (R5), `check_widget` RPC behavior (R6), policy exposure (R7), guide and prompt parity (R8), no TUI regression (R9).

## Out of scope

- Rendering anything in Pi's process for RPC (the client renders).
- A.Y.A.-specific UI, theming, bridge, or app code.
- Pi core changes.
- A.Y.A. pinboard (H7).

## Confirmed facts and evidence

- Fact: `src/index.ts` gates all rendering on `ctx.mode === "tui" && ctx.hasUI`; otherwise `show_widget` returns "needs Pi's interactive terminal UI; nothing was rendered" with notice details. `show_image` has the same gate.
- Fact: persisted `WidgetDetails` (`src/manager.ts`) holds id, imageId, title, cols, rows, cssWidth/cssHeight, cssCell, source kind, and path; inline HTML is not in details. TUI revive reads HTML from tool args or re-reads the path file (`reviveSource`).
- Fact: delivery format lives in `src/bridge.ts`: `widgetMessage(widget, kind, items, blocked)` builds the `widget-data` custom message; `deliveryOptions(kind, idle)` gives `nextTurn` for send, `triggerTurn` when idle or `followUp` when busy for submit. `manager.deliver` calls `pi.sendMessage(msg, options)`.
- Fact: page bridge limits (`src/page.ts` `BRIDGE_LIMITS`): 64 KB per item, 100 items and 512 KB per queue; `pi.submit` requires `navigator.userActivation.isActive`.
- Fact: network policy (`src/policy.ts`): `buildCsp(policy)` builds the CSP from a CDN allowlist plus user `network.allowHosts`/`network.open` from `<agentDir>/extensions/pi-interactive-widgets/config.json`; a CDP request layer additionally blocks local addresses.
- Fact: path widgets serve the entry file's folder and subfolders lazily on request (`servePath`), not as a pre-built bundle.
- Fact (Pi 1.5.2 docs `rpc-commands.md`): an RPC `prompt` whose message is an extension command (`/cmd ...`) executes immediately, even during streaming, with `disposition: "handled"`; `steer` and `follow_up` reject extension commands.
- Fact (Pi docs `json.md`, `rpc-commands.md`): `tool_execution_end` carries `result.details`; `get_messages` and `get_entries` return session history for replay.
- Fact (Pi docs `extensions.md`): `ctx.mode` is `"tui" | "rpc" | "json" | "print"`; `pi.registerFlag` values are readable only after load (`session_start`), while `process.env` is readable at extension factory time, when tool descriptions are registered.
- Fact: tool result `details` are stored in the session but not sent to the model, so duplicating HTML in details costs disk only.

## Constraints and invariants

- TUI code paths and tests stay unchanged in behavior (R9).
- The agent-visible widget-data message must be byte-identical in format to the TUI path (reuse `widgetMessage` and `deliveryOptions`).
- Widget data stays labeled untrusted.

## Confirmed decisions

| ID | Decision | Rationale | Evidence | Revisit when |
| --- | --- | --- | --- | --- |
| D1 | Assurance is medium. | Cross-repo contract and TUI regression risk; local and reversible. | User answer, round 1. | The home decision (D2) moves the work out of this repository. |
| D2 | No A.Y.A.-specific behavior, wording, or names in this extension. A client may configure a generic mechanism, but nothing here may depend on A.Y.A. | User wants the two projects decoupled. | User answer, round 1 (Q2 comment). | Never. |
| D3 | RPC and client-rendered widget support does not belong in this extension, which stays terminal-only. A.Y.A. owns client-rendered widgets in its own Pi layer and designs them with its pinboard (H7). If a second RPC client ever needs them, they get extracted into a separate generic package, not into this extension. | An RPC path would reuse about 5% of the code and would put a second mode into every tool, prompt, guide, and test (see Home analysis). | User answer, round 2 (O3). | A future need for shared tooling between this extension and a client renderer. |
| D4 | Send the conclusion back to A.Y.A. as a handoff. | User asked for it. | User answer, round 2. | - |

## Open questions and prerequisites

None. D3 closed the root branch, so the round 1 branches (capability signal, path widgets, sizing, event entry point, `check_widget`, `show_image`) no longer apply to this repository. They went to A.Y.A. as design candidates.

## Current frontier

Empty. No plan will be written for this item. Next action: drop it with `/skill:supersede 261120-1155-rpc-mode-widget-support-for-a-y-a drop`, which needs explicit approval.

## Handoffs

- Handoff: pi-voice-assistant spec/handoffs/2026-11-20-from-pi-interactive-widgets-client-widgets-belong-in-aya.md - sent (its backlog B30)

## Home analysis (round 2 input)

- Fact: about 4,200 source lines. Nearly all of them implement terminal rendering, which an RPC client never uses: headless Chromium and CDP (`browser.ts`, `page.ts`), kitty graphics and PNG handling (`kitty.ts`, `png.ts`), terminal input mapping (`rawinput.ts`, `keys.ts`, `component.ts`), tmux/Ghostty detection (`env.ts`), live/frozen lifecycle (`manager.ts`), and screenshots (`check.ts`).
- Fact: an RPC path could reuse only `bridge.ts` (`widgetMessage`, `deliveryOptions`, about 60 lines), the CSP builder in `policy.ts`, config loading, and parts of the prompts and guide. The prompts and guide are written around cells, terminals, and fullscreen mode.
- Fact: A.Y.A. already ships its own project-layer extension (`pi-voice-assistant/termux/aya-pi/extensions/aya.ts`, `/aya-tree-navigate` reached through RPC `prompt`), and it already filters `pi-interactive-widgets` out of its Pi layer.
- Fact: A.Y.A. handoff H7 (pinboard) plans agent tools that put HTML into the same overlay WebView surface.

## Path widgets (explanation recorded for the user)

`show_widget` accepts either `html` (the whole page inline in the tool call) or `path` (an `.html` entry file on disk). In TUI mode the extension serves the entry file's folder and subfolders to Chromium as the widget's origin, so relative `app.js`, `data.json`, or image files load. This is meant for bigger multi-file widgets and for ones the agent edits and shows again. An RPC client renders outside Pi's process, so it can use path widgets only if the files are copied into the payload or the host can read the same disk. A laptop backend (A.Y.A. H6) would break the second option.

## Superseded round 1 recommendations

The round 1 recommendations (env var capability, inline-only RPC, client-owned width, `/widget-event` command, `check_widget` not-available text, `show_image` out of scope) assumed the feature lives here. They remain candidate designs for whichever home is chosen.

- Clarification: "client wording" in the env var recommendation meant choosing between two generic built-in texts (terminal and "client app"). The env var value would be an opaque label that is never compared with "aya". A client could supply its own wording only through an added mechanism, for example an env var that points at a guide addendum file.

## Proposed test seams and acceptance evidence

- Unit: `show_widget` execute with a fake `ctx.mode === "rpc"` with and without the capability; payload shape; event command handler producing the same `widgetMessage` and delivery options as `manager.deliver`.
- Existing unit, browser, and e2e suites pass unchanged (R9).
- Optional smoke: a scripted `pi --mode rpc` client receiving `tool_execution_end.result.details` and delivering an event.

## Resume state

Round 1 was answered in part on 2026-11-20 (assurance confirmed). The user then reopened the root question. In round 2 (2026-11-20) the user chose O3 (A.Y.A. owns client-rendered widgets) and asked for a handoff back to A.Y.A. The handoff was written. Discovery is concluded without a plan, and the item waits for a drop.

## Readiness for To Spec

- [ ] Every consequential branch is resolved or explicitly out of scope.
- [ ] Facts are distinguished from user decisions and hypotheses.
- [ ] Requirements, constraints, and non-goals are clear.
- [ ] Acceptance evidence and proposed test seams are defined.
- [ ] The user confirmed shared understanding.
