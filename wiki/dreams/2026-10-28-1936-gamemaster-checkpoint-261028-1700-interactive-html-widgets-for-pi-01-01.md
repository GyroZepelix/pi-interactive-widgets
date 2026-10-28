---
schema_version: 1
episode_id: "2026-10-28-1936-gamemaster-checkpoint-261028-1700-interactive-html-widgets-for-pi-01-01"
timestamp: "2026-10-28T19:36:24+01:00"
summary: "Slice 01.01 scaffolded the pi-interactive-widgets package and shipped the headless browser and page layer; U1 passed and U2 found Chrome Local Network Access blocking loopback from the widget origin."
kind: "gamemaster-checkpoint"
status: "shipped"
work_item: "261028-1700-interactive-html-widgets-for-pi"
current: "01.01"
topics: ["page layer","chromium cdp"]
---

# Gamemaster checkpoint: 261028-1700-interactive-html-widgets-for-pi/01.01

Date: 2026-10-28
Work item: 261028-1700-interactive-html-widgets-for-pi
Status: shipped
In one line: Slice 01.01 scaffolded the pi-interactive-widgets package and shipped the headless browser and page layer; U1 passed and U2 found Chrome Local Network Access blocking loopback from the widget origin.

## Goal

Implement sliced Current 01.01 of the interactive HTML widgets plan: a typed ESM package plus a page layer that opens widgets in a lazily launched chrome-headless-shell, serves them from a synthetic origin under the network policy, injects the bridge and base CSS, streams paced PNG frames, freezes by window minimize, dispatches input, and settles the U1 and U2 spikes before later slices depend on the serving design.

## How we approached it

- Started from HEAD a419a0d after a staging mismatch was clarified by Gamemaster (the user's own commit was in progress).
- Scaffolded `package.json`, `tsconfig.json` (copied from the sibling pi-ez-session-name extension), `.gitignore`, and a stub `src/index.ts`; installed exactly the PD01 dependency set with pinned versions.
- Ran a throwaway U1 spike first: page-level CDP Fetch on `https://w-<id>.pi-widget.invalid` served a document, module imports, classic and module workers, and fetch; minimize and popup blocking also worked in a per-widget browser context.
- Wrote `src/policy.ts` (CSP builder, allowlist, local-address classifier), `src/browser.ts` (binary detection, lazy launch with pipe and without the three anti-throttling flags, close on last page), and `src/page.ts` (Fetch serving, injection, bridge, screencast pacing, freeze and thaw, input, records).
- Added unit tests and two browser test files with fixtures, then ran diagnostics on Chrome Local Network Access until listed local hosts became reachable.

## Key decisions

- **Per-widget in-memory browser context** - chose `createBrowserContext()` per page so storage stays per widget and in RAM; minimize and Fetch behaved normally there.
- **Activation check in an isolated world** - `pi.submit` is checked in the page and again from a CDP isolated world, because the page could otherwise forge binding calls; the raw binding is also deleted from page globals.
- **Navigation away answered with HTTP 204** - keeps the widget document in place instead of failing the request.
- **Listed local hosts get a per-origin LNA permission grant (PD08)** - Chrome's Local Network Access otherwise blocks hosts the config lists; unlisted local hosts stay blocked by both the extension layer and Chrome.
- **Ack-delay pacing of 100 ms after each frame** - gives about 8.5 fps on an animating page, which satisfies the at-most-10-fps cap; tuning closer to 10 fps was not needed.
- **`npm test` excludes browser tests with `find`** - because `tests/*.test.ts` would also match `*.browser.test.ts`.

## What did not work

- **`Browser.grantPermissions` with camelCase permission names, and `Browser.setPermission` without a browser context id** - both returned success but loopback fetches stayed denied; only `Browser.setPermission` with dashed names plus the page's `browserContextId` lifted the block.
- **First unchanged-page test clicked empty space to force a frame** - a click that changes no pixels produces no screencast frame; the test now changes page text instead.
- **Default-mode CSP violation assertion right after the fetch promise settled** - violation reports arrive asynchronously through the binding; the test now waits for the record.

## Current state and where we left off

- Shipped/verified: 01.01 checked off in the item's implementation index, Current is `01.02`, plan Decision Log has PD08 (accepted by Gamemaster), U1, U2, and the WebSocket residual are in the index Discoveries.
- Pending: segment T01 focused review after 01.02; source changes are uncommitted and untracked (user-controlled checkpoint).

## Source of truth

- `src/browser.ts`, `src/page.ts`, `src/policy.ts`: the page layer as built.
- `tests/page.browser.test.ts`, `tests/network.browser.test.ts`: U1, U2, serving, policy, bridge, screencast, freeze, input, and lifecycle evidence.
- The item's `implementation/01-01-browser-page-layer.md` completion evidence and `implementation/index.md` Discoveries; plan Decision Log PD08.

## Verification

- Done: `npm install` exit 0; `npm run typecheck` exit 0; `npm test` 46 pass; `npm run test:browser` 22 pass on three runs; no chrome-headless-shell process left after any run; spec helper validate passed.
- Not verified yet: frozen-page and animating CPU budgets (01.02 perf scripts); open-mode WebSocket blocks to local addresses are enforced only by Chrome and are not reported; browser tests need internet access.

## Open questions, blockers, next safe action

- Open/blocked: none.
- Next safe action: start slice 01.02 (kitty transport, environment detection, standalone harness) from the item's `implementation/01-02-kitty-transport-harness.md` packet after the user's Git checkpoint.
