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

### Completion evidence - 2026-10-28T19:35+01:00

Starting HEAD: `a419a0d` (nothing staged). Review: none required for 01.01 (segment review runs after 01.02).

Changed paths (all new, untracked): `package.json`, `package-lock.json`, `tsconfig.json` (copy of `../pi-ez-session-name/tsconfig.json`), `.gitignore`, `src/index.ts` (stub), `src/browser.ts`, `src/page.ts`, `src/policy.ts`, `tests/helpers.ts`, `tests/policy.test.ts`, `tests/page.test.ts`, `tests/page.browser.test.ts`, `tests/network.browser.test.ts`, `tests/fixtures/*.html`, `tests/fixtures/path-widget/`. Spec: this packet, `./index.md` (checkbox, Current, checkpoints, Discoveries), `../plan.md` Decision Log PD08.

Dependencies: exactly PD01, pinned: `puppeteer-core` 25.16.0; dev `typescript` 5.9.3, `tsx` 4.23.15, `@types/node` 22.20.5, `@earendil-works/pi-coding-agent` 1.4.0, `@earendil-works/pi-tui` 1.4.0, `typebox` 1.3.27 (the version Pi 1.4.0 depends on). npm reported install scripts not run for transitive `esbuild`, `protobufjs`, `@google/genai`; `tsx` works without them.

Checks (all from the repository root):

- `npm install`: exit 0.
- `npm run typecheck`: exit 0.
- `npm test`: 46 pass, 0 fail (policy, CSP, local-address classification, fragment wrap, base CSS, binary detection, missing-binary error).
- `npm run test:browser`: 22 pass, 0 fail, run 3 times. Needs internet for the CDN, external-fetch, and `lvh.me` checks.
- After every browser run: `pgrep -fl chrome-headless-shell` empty; the lifecycle tests also assert that every PID of the browser tree they started is gone.

Acceptance:

- U1: passed (secure context, `localStorage`, ES module import, classic and module dedicated workers, same-origin fetch on the synthetic origin). No fallback. Recorded in `./index.md` Discoveries.
- U2: Chrome LNA blocks loopback from the widget origin in headless mode; recorded in `./index.md` Discoveries; listed local hosts get a per-origin permission grant (PD08).
- Inline and path widgets load; path requests outside the entry folder fail with 404, including a file symlink, a directory symlink, `../`, `%2e%2e`, and `..%2f`; no directory listing; a missing entry raises `source file missing: <path>`.
- Default policy: an external fetch and a non-allowlisted script are blocked and reported (CSP violations), an allowlisted jsdelivr script loads, WebRTC globals are gone, navigation away is blocked with the document kept, `window.open` returns null with no new target, and a form submission is blocked (`form-action`).
- Open mode: an external fetch succeeds; `127.0.0.1`, `localhost`, `192.168.1.1`, `10.0.0.1`, `100.100.100.100`, `*.ts.net`, and `*.local` are blocked and reported, and the loopback server sees no request; a listed `127.0.0.1:<port>` is reachable in open and default mode while unlisted local names stay blocked.
- JS errors and CSP violations are captured (`errors`, `blocked`, handler callbacks).
- Bridge: `pi.submit` returns false without activation, the raw binding is hidden from page script, and a forged call would also fail the isolated-world activation check; after a dispatched click the submit is delivered. `pi.send` queues JSON data, throws on oversized (64 KiB) or non-serializable data, and caps the queue at 100 items (512 KiB) with a reported drop.
- Screencast: frames are 1440x612 PNG for 720x306 CSS (90x18 cells) at DPR 2; an unchanged page produced no frames over 1.5 s; an animating page streamed 17 frames in 2 s (8.5 fps, minimum gap about 111 ms); minimize stopped frames (`visibilityState` hidden) and restore yielded a new frame in 6-30 ms (median about 10 ms).
- Input: all 18 grid clicks and a 60-click burst with moves during streaming hit every expected target; wheel, inserted text, and a Backspace key event reach the page.
- Closing the last page closes the browser; no process started by the tests remains.
- No frame or still is written to disk (`src/` has no file writes; frames stay base64 strings in RAM).

Residual uncertainty: open-mode WebSocket blocks to local addresses are enforced only by Chrome and are not reported (see `./index.md` Discoveries). Pacing acks 100 ms after each frame, so animating pages run at about 8.5 fps rather than exactly 10. Frozen-page CPU and AC02 CPU are measured by the 01.02 perf scripts, not here. `_client()` (puppeteer internal main session) is used deliberately per the plan Design notes and may change with puppeteer upgrades.

Next slice: `01.02` (kitty transport, environment detection, and standalone harness).
