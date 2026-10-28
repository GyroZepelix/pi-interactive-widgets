# Slice 01.01: Scaffold plus browser and page layer with the U1 and U2 spikes

Plan: `../plan.md`
Implementation index: `./index.md`
Segment: `T01 - Rendering pipeline proven outside Pi`
Assurance: medium - personal single-user setup, reversible local extension, KISS preference
Review required now: none (scoped checks only)

## Outcome

The repository is a typed, tested ESM package. Its page layer opens a widget in a lazily launched chrome-headless-shell from inline HTML or an entry-file path, serves it from a synthetic origin under the network policy, injects the bridge and base CSS, streams paced full-resolution PNG frames only when the page changes, freezes and thaws by window minimize, dispatches mouse and key input accurately, and reports JS errors and blocked requests. No terminal or Pi code exists yet.

## Why this slice exists now

Every later slice consumes this page API. The U1 (synthetic-origin serving) and U2 (Chrome's local-network protection) spikes can change the serving design, so they are settled before anything depends on it.

## Relevant context

- Scaffold per plan Context: ESM `package.json` with `"pi": {"extensions": ["./src/index.ts"]}` (entry file may be a stub until 02.01), `engines.node >=22.19.0`, Pi packages and `typebox` as `"*"` peers, PD01 dev dependencies, scripts `typecheck`, `test`, `test:browser`; strict tsconfig copied from `../pi-ez-session-name/tsconfig.json`; `.gitignore` with `node_modules/`.
- RQ03: detect the newest `chrome-headless-shell` under `~/.cache/puppeteer/` or use a `chromePath` parameter; launch with `pipe: true`, `--force-device-scale-factor=<dpr>`, `ignoreDefaultArgs` removing `--disable-renderer-backgrounding`, `--disable-background-timer-throttling`, and `--disable-backgrounding-occluded-windows`; sandbox on; close when the last page closes.
- RQ04 capture side: `Page.startScreencast` with `format: "png"` at full resolution as both change signal and frame source; delay acks to pace at most 10 fps; expose frames as base64 strings.
- RQ06 mechanics only: freeze = stop screencast + `Browser.setWindowBounds({windowState: "minimized"})`; thaw = restore `normal` + restart screencast. Timers and policy come in 02.02.
- RQ08 page side: `window.pi.send(data)` queues to the extension; `window.pi.submit(data)` is accepted only when `navigator.userActivation.isActive`; JSON-serializable data with size and count caps.
- RQ09 and RQ10: synthetic per-widget `https` origin through CDP Fetch interception; inline from memory, path confined to the entry folder by realpath; CSP allowlist and open mode with local-address blocking; WebRTC unavailable, DNS prefetch off, navigation away, popups, and form submissions blocked; injection at document start of the bridge, theme CSS variables (passed in as parameters), dark color scheme, and `appearance: base-select`; fragments wrapped in a shell.
- Page sizing: CSS viewport = cells x CSS cell size; `Emulation.setDeviceMetricsOverride({deviceScaleFactor: 0, ...})`, never DPR emulation.
- Parent-plan sections to load on conflict or uncertainty: Requirements, Design (implementation notes), Decision Log, Risks and blockers.

## Constraints and non-goals

- No terminal output, kitty encoding, or Pi integration in this slice.
- No frame or still files, including debug dumps.
- Dependencies limited to PD01.
- If U1 fails (no secure context, ES modules, or workers on the synthetic origin), implement the loopback-server fallback with the same rules and record it in the plan's Decision Log; do not invent another serving approach without asking.

## Expected source and test areas

- `package.json`, `tsconfig.json`, `.gitignore`
- `src/browser.ts`, `src/page.ts`, `src/policy.ts`
- `tests/policy.test.ts`, `tests/*.browser.test.ts`, `tests/fixtures/*.html`

These paths are navigation hints. Inspect other source or tests only when Current or a credible regression path requires it.

## Acceptance and checks

- Acceptance: the U1 result is recorded with evidence (secure context, `localStorage`, an ES module import, and a dedicated worker on the synthetic origin), or the fallback is in place and recorded in the Decision Log.
- Acceptance: the U2 observation is recorded in `./index.md` Discoveries (whether Chrome blocks local addresses from the widget origin in headless mode).
- Acceptance: browser tests show inline and path widgets load; path requests outside the entry folder, including through a symlink, fail; the default policy blocks an external fetch and a non-allowlisted script while an allowlisted CDN script loads; WebRTC is unavailable; navigation away is blocked; open mode allows an external fetch while localhost, a private IP, and a Tailscale address stay blocked unless listed; JS errors and violations are captured.
- Acceptance: `pi.submit` is rejected without user activation and accepted after a dispatched click; `pi.send` queues within caps.
- Acceptance: screencast frames are 1440x612 for a 90x18-cell widget at DPR 2; an unchanged page produces no frames; an animating page streams at most 10 fps; minimizing stops frames and restoring yields a new frame within about 50 ms; a 60-click burst during streaming hits every expected target.
- Acceptance: closing the last page closes the browser and leaves no process started by the tests.
- Check: `npm install`
- Check: `npm run typecheck`
- Check: `npm test`
- Check: `npm run test:browser`

## Attempt log

No attempts recorded.

For each interrupted or failed attempt, append without rewriting earlier entries:

```text
### Attempt <number> - <timestamp>
Starting HEAD: <git commit at invocation start>
Changes: <paths and behavior changed>
Checks: <commands and results>
Failures: <failures or none>
Blockers: <credible blockers or none>
Exact next action: <single resumable action>
```

Keep this log concise. Do not duplicate unchanged plan or check output.

## Completion and handoff

On success, record changed paths, acceptance, check results, residual uncertainty, and the exact next slice (`01.02`). Update checkboxes and Current only in `implementation/index.md`. Stop for a user-controlled Git checkpoint and suggest Dream without invoking either.
