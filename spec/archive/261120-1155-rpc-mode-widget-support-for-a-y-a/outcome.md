# Outcome: RPC mode widget support for A.Y.A.

Work item: `261120-1155-rpc-mode-widget-support-for-a-y-a`
Disposition: dropped
Date: 2026-11-20

## Delivered scope

None. Discovery only, with no source, test, or guide changes.

The user decided (D3 in `discovery.md`) that RPC and client-rendered widget support does not belong in this extension, which stays terminal-only. An RPC mode would reuse about 5% of the code (the widget-data message builder, the CSP builder, config loading) and would add a second mode to every tool, prompt, guide, and test. A.Y.A. owns client-rendered widgets in its own Pi layer, designed together with its pinboard (H7). If a second RPC client ever needs them, they are extracted into a separate generic package, not into this extension. D2 also applies: this extension contains no A.Y.A.-specific behavior, names, or wording.

## Deviations from plan

No plan was written. Discovery closed at its root decision.

## Verification summary

Not applicable, because nothing was implemented. Item and operational spec validation passed before the drop.

## Retained, reverted, or transferred work

- Retained: `discovery.md` (decisions D1-D4, home analysis) and `handoff.md` (the original 2026-11-09 A.Y.A. RPC requirements).
- Transferred: requirements and design candidates went to A.Y.A. in `pi-voice-assistant/spec/handoffs/2026-11-20-from-pi-interactive-widgets-client-widgets-belong-in-aya.md` (its backlog B30).

## Residual risks

None in this repository. On the A.Y.A. side, backlog B27 and the archived roadmap pointer still describe a widgets RPC mode in this extension.

## Follow-up work items

None in this repository. A.Y.A. backlog B30 carries the remaining work.

## Source references

- `discovery.md`, `handoff.md` in this item.
- `src/index.ts`, `src/bridge.ts`, `src/policy.ts`, `src/page.ts` at commit `d27043c`.

## Wiki updates

None.
