// Headless network-policy tests (RQ09) and the U2 observation. Needs internet access for the CDN and external checks.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { BrowserHost } from "../src/browser.js";
import { WidgetPage } from "../src/page.js";
import type { NetworkPolicy } from "../src/policy.js";
import { FIXTURES, type LocalServer, localServer, processTree, sleep, until, waitGone } from "./helpers.js";

const host = new BrowserHost({ dpr: 2 });
const seenPids = new Set<number>();
const EXTERNAL = "https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/package.json";
let server: LocalServer;

before(async () => {
	server = await localServer();
});
after(async () => {
	await host.close();
	await server.close();
});

async function networkWidget(policy: NetworkPolicy): Promise<WidgetPage> {
	const w = await WidgetPage.open(host, { source: { path: join(FIXTURES, "network.html") }, cssWidth: 720, cssHeight: 306, policy });
	if (host.pid) for (const p of processTree(host.pid)) seenPids.add(p);
	return w;
}

const probe = (w: WidgetPage, url: string): Promise<string> => w.page.evaluate(`window.__probe(${JSON.stringify(url)})`) as Promise<string>;
const blockedFor = (w: WidgetPage, part: string): string[] => w.blocked.filter((b) => b.url.includes(part)).map((b) => b.reason);

describe("default policy", () => {
	it("loads an allowlisted CDN script and blocks a non-allowlisted script and an external fetch", async () => {
		const w = await networkWidget({ open: false, allowHosts: [] });
		const state = (await w.page.evaluate("window.__state()")) as Record<string, string>;
		assert.equal(state.confetti, "function", "allowlisted CDN script loaded");
		assert.ok(await until(() => blockedFor(w, "example.com/not-allowlisted.js").length > 0), "non-allowlisted script reported");
		assert.match(blockedFor(w, "example.com/not-allowlisted.js")[0] ?? "", /CSP script-src/);
		assert.equal(await probe(w, EXTERNAL), "error TypeError");
		assert.ok(await until(() => blockedFor(w, "cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/package.json").length > 0), "external fetch reported");
		await w.close();
	});

	it("makes WebRTC unavailable and blocks navigation away, popups, and form submissions", async () => {
		const w = await networkWidget({ open: false, allowHosts: [] });
		const state = (await w.page.evaluate("window.__state()")) as Record<string, string>;
		assert.equal(state.rtc, "undefined");
		assert.equal(state.webkitRtc, "undefined");
		assert.equal(await w.page.evaluate("Object.getOwnPropertyNames(globalThis).filter((n) => /^(webkit)?RTC/.test(n)).length"), 0);
		await w.page.evaluate("window.__marker = 1; location.href = 'https://example.com/away'");
		assert.ok(await until(() => blockedFor(w, "example.com/away").length > 0), "navigation reported");
		await sleep(200);
		assert.deepEqual(await w.page.evaluate("[location.origin, window.__marker]"), [w.origin, 1], "document stays in place");
		assert.equal(await w.page.evaluate("String(window.open('https://example.com/popup'))"), "null");
		assert.equal((await w.page.browserContext().pages()).length, 1, "no popup target");
		await w.page.evaluate("document.getElementById('f').submit()");
		await sleep(200);
		assert.deepEqual(await w.page.evaluate("[location.origin, window.__marker]"), [w.origin, 1]);
		assert.ok(await until(() => w.blocked.some((b) => /form-action/.test(b.reason))), "form submission reported");
		await w.close();
	});
});

describe("open policy", () => {
	it("allows an external fetch and keeps localhost, private, and Tailscale addresses blocked", async () => {
		const w = await networkWidget({ open: true, allowHosts: [] });
		assert.equal(await probe(w, EXTERNAL), "ok 200");
		const local = [
			`http://127.0.0.1:${server.port}/loopback`,
			`http://localhost:${server.port}/localhost`,
			"https://192.168.1.1/private",
			"https://10.0.0.1/private10",
			"https://100.100.100.100/tailscale",
			"https://host.tail0000.ts.net/tsnet",
			"https://nas.local/mdns",
		];
		for (const url of local) {
			assert.equal(await probe(w, url), "error TypeError", url);
			assert.deepEqual(blockedFor(w, new URL(url).pathname), ["local address blocked"], url);
		}
		assert.equal(server.hits.length, 0, "the loopback server saw no request");
		await w.close();
	});

	it("U2: Chrome's Local Network Access blocks a public name that resolves to loopback (second layer)", async (t) => {
		// lvh.me is public DNS pointing at 127.0.0.1, so the extension's hostname check lets it through.
		const w = await networkWidget({ open: true, allowHosts: [] });
		const result = await probe(w, `http://lvh.me:${server.port}/u2-resolved`);
		t.diagnostic(`U2 open-mode fetch to lvh.me (resolves to 127.0.0.1): ${result}; extension blocks: ${JSON.stringify(blockedFor(w, "/u2-resolved"))}`);
		assert.deepEqual(blockedFor(w, "/u2-resolved"), [], "extension layer passes the public name");
		assert.equal(result, "error TypeError");
		assert.equal(server.hits.filter((h) => h.url === "/u2-resolved").length, 0, "Chrome refused before any request reached the server");
		await w.close();
	});

	it("listed local hosts are reachable in open and default mode", async () => {
		for (const open of [true, false]) {
			const w = await networkWidget({ open, allowHosts: [`127.0.0.1:${server.port}`] });
			const path = `/listed-${open ? "open" : "default"}`;
			assert.equal(await probe(w, `http://127.0.0.1:${server.port}${path}`), "ok 200", path);
			assert.deepEqual(blockedFor(w, path), []);
			assert.equal(await probe(w, `http://localhost:${server.port}${path}-unlisted`), "error TypeError", "other local names stay blocked");
			await until(() => blockedFor(w, `${path}-unlisted`).length > 0);
			assert.deepEqual(blockedFor(w, `${path}-unlisted`), open ? ["local address blocked"] : ["blocked by CSP connect-src"]);
			await w.close();
		}
		assert.deepEqual(
			server.hits.map((h) => h.url),
			["/listed-open", "/listed-default"],
		);
	});

	it("open mode with a listed local host blocks a WebSocket to an unlisted local address (RQ09 correction)", async () => {
		const w = await networkWidget({ open: true, allowHosts: [`127.0.0.1:${server.port}`] });
		const ws = (url: string): Promise<string> => w.page.evaluate(`window.__ws(${JSON.stringify(url)})`) as Promise<string>;
		assert.equal(await ws(`ws://127.0.0.1:${server.port}/ws-listed`), "open", "listed host takes WebSockets");
		assert.equal(await ws(`ws://localhost:${server.port}/ws-unlisted`), "error");
		assert.ok(await until(() => blockedFor(w, "/ws-unlisted").length > 0), "unlisted WebSocket reported");
		assert.deepEqual(blockedFor(w, "/ws-unlisted"), ["blocked by CSP connect-src"]);
		assert.deepEqual(
			server.hits.filter((h) => h.method === "ws").map((h) => h.url),
			["ws /ws-listed"],
		);
		await w.close();
	});

	it("leaves no process started by the tests", async () => {
		assert.equal(host.pid, undefined);
		assert.deepEqual(await waitGone([...seenPids]), []);
	});
});
