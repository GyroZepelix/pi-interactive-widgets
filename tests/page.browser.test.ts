// Headless page-layer tests: serving, U1, injection, bridge, errors, screencast pacing, freeze, input, lifecycle.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { BrowserHost } from "../src/browser.js";
import { type Frame, SourceMissingError, WidgetPage, type WidgetPageOptions } from "../src/page.js";
import { FIXTURES, pngSize, processTree, sleep, until, waitGone } from "./helpers.js";

// 90x18 cells at 8x17 CSS px per cell (16x34 device px at DPR 2).
const CSS_W = 720;
const CSS_H = 306;

const host = new BrowserHost({ dpr: 2 });
const seenPids = new Set<number>();
const open: WidgetPage[] = [];

async function widget(opts: Partial<WidgetPageOptions> & Pick<WidgetPageOptions, "source">): Promise<WidgetPage> {
	const w = await WidgetPage.open(host, { cssWidth: CSS_W, cssHeight: CSS_H, ...opts });
	open.push(w);
	if (host.pid) for (const p of processTree(host.pid)) seenPids.add(p);
	return w;
}

async function closeAll(): Promise<void> {
	for (const w of open.splice(0)) await w.close();
}

const evaluate = <T>(w: WidgetPage, fn: string): Promise<T> => w.page.evaluate(fn) as Promise<T>;

after(async () => {
	await closeAll();
	await host.close();
});

describe("serving (U1) and injection", () => {
	it("U1: synthetic https origin gives a secure context, localStorage, ES modules, and workers", async (t) => {
		const w = await widget({ source: { path: join(FIXTURES, "path-widget", "index.html") } });
		assert.ok(await until(() => evaluate<boolean>(w, "!!window.__u1"), 5_000), "path widget finished its probe");
		const u1 = await evaluate<Record<string, unknown>>(w, "window.__u1");
		t.diagnostic(`U1 ${JSON.stringify(u1)}`);
		assert.equal(u1.secure, true);
		assert.equal(u1.origin, w.origin);
		assert.match(w.origin, /^https:\/\/w-[0-9a-f]{12}\.pi-widget\.invalid$/);
		assert.equal(u1.localStorage, "v");
		assert.equal(u1.module, 42);
		assert.equal(u1.worker, "classic true dep");
		assert.equal(u1.moduleWorker, "module true 42");
		assert.deepEqual(u1.data, { ok: true });
		assert.equal(u1.css, "dashed", "relative stylesheet from a subfolder loads");
		await closeAll();
	});

	it("inline fragments load in the shell with base CSS, theme variables, and dark scheme", async () => {
		const w = await widget({ source: { html: "<p id=p>hello</p><select id=s><option>a</option></select>" }, title: "Inline", theme: { "--pi-accent": "#ff0000" } });
		const r = await evaluate<Record<string, unknown>>(
			w,
			`({ text: document.getElementById("p").textContent, title: document.title, doctype: !!document.doctype,
			   scheme: getComputedStyle(document.documentElement).colorScheme,
			   accent: getComputedStyle(document.documentElement).getPropertyValue("--pi-accent").trim(),
			   appearance: getComputedStyle(document.getElementById("s")).appearance,
			   dark: matchMedia("(prefers-color-scheme: dark)").matches, margin: getComputedStyle(document.body).margin,
			   pi: typeof pi.send + typeof pi.submit, binding: typeof globalThis.__piWidgetBridge })`,
		);
		assert.deepEqual(r, { text: "hello", title: "Inline", doctype: true, scheme: "dark", accent: "#ff0000", appearance: "base-select", dark: true, margin: "0px", pi: "functionfunction", binding: "undefined" });
		await closeAll();
	});

	it("serves full documents as written and lets author CSS win over the base layer", async () => {
		const w = await widget({ source: { html: "<!doctype html><html><head><title>Full</title><style>body{margin:7px}</style></head><body>x</body></html>" } });
		assert.deepEqual(await evaluate(w, `[document.title, getComputedStyle(document.body).margin]`), ["Full", "7px"]);
		await closeAll();
	});

	it("confines path widgets to the entry folder, including through symlinks", async () => {
		const dir = mkdtempSync(join(tmpdir(), "piw-path-"));
		try {
			const root = join(dir, "root");
			cpSync(join(FIXTURES, "path-widget"), root, { recursive: true });
			writeFileSync(join(dir, "secret.txt"), "secret");
			symlinkSync(join(dir, "secret.txt"), join(root, "link.txt"));
			symlinkSync(dir, join(root, "linkdir"));
			const w = await widget({ source: { path: join(root, "index.html") } });
			const probe = (p: string): Promise<string> =>
				evaluate<string>(w, `fetch(${JSON.stringify(p)}).then(async (r) => r.status + " " + (await r.text()).slice(0, 12), (e) => "error " + e.name)`);
			assert.equal(await probe("./data.json"), "200 { \"ok\": true");
			assert.equal(await probe("./link.txt"), "404 not found");
			assert.equal(await probe("./linkdir/secret.txt"), "404 not found");
			assert.equal(await probe("../secret.txt"), "404 not found");
			assert.equal(await probe("./%2e%2e/secret.txt"), "404 not found");
			assert.equal(await probe("./..%2fsecret.txt"), "404 not found");
			assert.equal(await probe("./sub/"), "404 not found", "no directory listing");
			assert.equal(await probe("./missing.js"), "404 not found");
			await closeAll();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects a missing entry file before opening a page", async () => {
		await assert.rejects(WidgetPage.open(host, { source: { path: "/nonexistent/widget.html" }, cssWidth: CSS_W, cssHeight: CSS_H }), (e: unknown) => e instanceof SourceMissingError && e.message === "source file missing: /nonexistent/widget.html");
		const dir = mkdtempSync(join(tmpdir(), "piw-unreadable-"));
		const file = join(dir, "index.html");
		writeFileSync(file, "<p>x</p>", { mode: 0o000 });
		try {
			await assert.rejects(WidgetPage.open(host, { source: { path: file }, cssWidth: CSS_W, cssHeight: CSS_H }), (e: unknown) => e instanceof SourceMissingError, "an unreadable entry counts as missing");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
		assert.equal(host.pageCount, 0);
	});

	it("captures JS errors", async () => {
		const errors: string[] = [];
		const w = await widget({ source: { path: join(FIXTURES, "errors.html") }, onError: (m) => errors.push(m) });
		assert.ok(await until(() => w.errors.some((e) => e.includes("widget boom"))));
		assert.ok(errors.some((e) => e.includes("widget boom")));
		await closeAll();
	});
});

describe("bridge", () => {
	it("rejects pi.submit without user activation and accepts it after a dispatched click", async () => {
		const submits: unknown[] = [];
		const w = await widget({ source: { path: join(FIXTURES, "bridge.html") }, onSubmit: (d) => submits.push(d) });
		assert.equal(await evaluate(w, "window.__early"), false);
		assert.equal(await evaluate(w, "window.__forged"), "undefined", "raw binding is hidden from page script");
		await sleep(100);
		assert.deepEqual(submits, []);
		await w.click(120, 50);
		assert.ok(await until(() => submits.length === 1));
		assert.equal(await evaluate(w, "window.__clicked"), true);
		assert.deepEqual(submits, [{ clicked: true }]);
		await closeAll();
	});

	it("queues pi.send within size and count caps", async () => {
		const w = await widget({ source: { html: "<p>send</p>" } });
		const r = await evaluate<string[]>(
			w,
			`(() => {
				const out = [];
				out.push(String(pi.send({ a: 1 })), String(pi.send("two")), String(pi.send([3])));
				try { pi.send({ big: "x".repeat(70000) }); out.push("no throw"); } catch (e) { out.push(e.name); }
				try { pi.send({ n: 1n }); out.push("no throw"); } catch (e) { out.push(e.name); }
				try { pi.send(undefined); out.push("no throw"); } catch (e) { out.push(e.name); }
				return out;
			})()`,
		);
		assert.deepEqual(r, ["true", "true", "true", "RangeError", "TypeError", "TypeError"]);
		assert.ok(await until(() => w.queued.length === 3));
		assert.deepEqual(w.drainQueue(), [{ a: 1 }, "two", [3]]);
		assert.equal(w.queued.length, 0);
		await evaluate(w, "for (let i = 0; i < 105; i++) pi.send({ i })");
		assert.ok(await until(() => w.errors.some((e) => e.includes("queue full"))));
		assert.equal(w.queued.length, 100);
		await closeAll();
	});
});

describe("screencast, freeze, and input", () => {
	it("streams full-resolution 1440x612 PNG frames for a 90x18-cell widget at DPR 2", async () => {
		const w = await widget({ source: { path: join(FIXTURES, "static.html") } });
		assert.ok(w.lastFrame, "open resolves after the first frame");
		assert.deepEqual(pngSize(w.lastFrame.data), { width: 1440, height: 612 });
		assert.equal(w.lastFrame.data.slice(0, 8), "iVBORw0K", "PNG signature in base64");
		await closeAll();
	});

	it("produces no frames for an unchanged page", async () => {
		const frames: Frame[] = [];
		const w = await widget({ source: { path: join(FIXTURES, "static.html") }, onFrame: (f) => frames.push(f) });
		await sleep(300);
		const settled = frames.length;
		await sleep(1_500);
		assert.equal(frames.length, settled, "no frames while unchanged");
		const next = w.nextFrame(1_000);
		await evaluate(w, `document.getElementById("typed").textContent = "changed"`);
		await next;
		await closeAll();
	});

	it("paces an animating page to at most 10 fps", async (t) => {
		const frames: Frame[] = [];
		await widget({ source: { path: join(FIXTURES, "anim.html") }, onFrame: (f) => frames.push(f) });
		await sleep(200);
		const start = frames.length;
		await sleep(2_000);
		const got = frames.slice(start);
		const gaps = got.slice(1).map((f, i) => f.at - (got[i] as Frame).at);
		const fps = got.length / 2;
		t.diagnostic(`frames in 2 s: ${got.length} (${fps} fps), min gap ${Math.min(...gaps).toFixed(1)} ms`);
		assert.ok(got.length >= 12, `animating page streams (${got.length})`);
		assert.ok(got.length <= 21, `at most 10 fps (${got.length} in 2 s)`);
		assert.ok(Math.min(...gaps) >= 95, `frame gaps respect the cap (${Math.min(...gaps)})`);
		await closeAll();
	});

	it("freezes by minimizing (no frames) and thaws to a new frame within about 50 ms", async (t) => {
		const frames: Frame[] = [];
		const w = await widget({ source: { path: join(FIXTURES, "anim.html") }, onFrame: (f) => frames.push(f) });
		const thawMs: number[] = [];
		for (let i = 0; i < 5; i++) {
			await sleep(300);
			await w.freeze();
			assert.equal(w.frozen, true);
			const n = frames.length;
			await sleep(700);
			assert.equal(frames.length, n, "no frames while frozen");
			assert.equal(await evaluate(w, "document.visibilityState"), "hidden");
			const t0 = performance.now();
			const next = w.nextFrame(1_000);
			await w.thaw();
			thawMs.push((await next).at - t0);
		}
		const sorted = [...thawMs].sort((a, b) => a - b);
		t.diagnostic(`thaw to first frame ms: ${thawMs.map((x) => x.toFixed(1)).join(", ")}`);
		assert.ok((sorted[2] as number) <= 50, `median thaw ${sorted[2]} ms`);
		assert.ok((sorted[4] as number) <= 150, `worst thaw ${sorted[4]} ms`);
		assert.ok(w.lastFrame, "last frame kept");
		await closeAll();
	});

	it("two pages have their own windows: freezing one leaves the other streaming (02.02 discovery)", async () => {
		const framesA: Frame[] = [];
		const framesB: Frame[] = [];
		const a = await widget({ source: { path: join(FIXTURES, "anim.html") }, onFrame: (f) => framesA.push(f) });
		const b = await widget({ source: { path: join(FIXTURES, "anim.html") }, onFrame: (f) => framesB.push(f) });
		const windowOf = async (w: WidgetPage): Promise<number> => {
			const s = await w.page.createCDPSession();
			try {
				return (await s.send("Browser.getWindowForTarget")).windowId;
			} finally {
				await s.detach().catch(() => {});
			}
		};
		assert.notEqual(await windowOf(a), await windowOf(b), "distinct window ids");
		await a.freeze();
		await sleep(300);
		const na = framesA.length;
		const nb = framesB.length;
		await sleep(1_000);
		assert.equal(framesA.length, na, "frozen page sends no frames");
		assert.ok(framesB.length - nb >= 5, `live page keeps streaming (${framesB.length - nb} frames in 1 s)`);
		assert.equal(await evaluate(a, "document.visibilityState"), "hidden");
		assert.equal(await evaluate(b, "document.visibilityState"), "visible");
		await closeAll();
	});

	it("thaws a static page to a new frame", async () => {
		const w = await widget({ source: { path: join(FIXTURES, "static.html") } });
		await w.freeze();
		const next = w.nextFrame(500);
		await w.thaw();
		await next;
		await closeAll();
	});

	it("lands all 18 grid clicks and a 60-click burst during streaming", async () => {
		const frames: Frame[] = [];
		const w = await widget({ source: { path: join(FIXTURES, "grid.html") }, onFrame: (f) => frames.push(f) });
		const center = (i: number): [number, number] => [((i % 6) + 0.5) * (CSS_W / 6), (Math.floor(i / 6) + 0.5) * (CSS_H / 3)];
		const grid = Array.from({ length: 18 }, (_, i) => i);
		for (const i of grid) await w.click(...center(i));
		assert.deepEqual(await evaluate(w, "window.__hits"), grid);
		await evaluate(w, "window.__hits = []");
		const n = frames.length;
		const burst = Array.from({ length: 60 }, (_, k) => (k * 7) % 18);
		for (const i of burst) {
			const [x, y] = center(i);
			await w.mouse({ type: "mouseMoved", x, y });
			await w.click(x, y);
		}
		assert.deepEqual(await evaluate(w, "window.__hits"), burst);
		assert.ok(frames.length > n, "frames streamed during the burst");
		await closeAll();
	});

	it("delivers wheel, typed text, and special keys", async () => {
		const w = await widget({ source: { path: join(FIXTURES, "static.html") } });
		await evaluate(w, `document.body.insertAdjacentHTML("beforeend", "<div id=wheel style='position:absolute;left:0;top:0;width:300px;height:100px;overflow:auto'><div style='height:1000px'></div></div>")`);
		await w.wheel({ x: 50, y: 50, deltaX: 0, deltaY: 120 });
		assert.ok(await until(async () => (await evaluate<number>(w, "document.getElementById('wheel').scrollTop")) > 0));
		const box = await evaluate<{ x: number; y: number }>(w, `(() => { const r = document.getElementById("field").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
		await w.click(box.x, box.y);
		await w.insertText("héllo");
		await w.key({ type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
		await w.key({ type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
		assert.equal(await evaluate(w, "document.getElementById('field').value"), "héll");
		assert.ok((await evaluate<string[]>(w, "window.__keys")).includes("Backspace"));
		await closeAll();
	});
});

describe("lifecycle", () => {
	it("closing the last page closes the browser and leaves no process started by the tests", async () => {
		await widget({ source: { html: "<p>a</p>" } });
		const pid = host.pid;
		assert.ok(pid);
		const second = await widget({ source: { html: "<p>b</p>" } });
		assert.equal(host.pid, pid, "one browser for all pages");
		assert.equal(host.pageCount, 2);
		const [first] = open;
		await first?.close();
		assert.equal(host.pid, pid, "browser stays while a page remains");
		await second.close();
		open.length = 0;
		assert.equal(host.pid, undefined);
		assert.deepEqual(await waitGone([...seenPids]), [], "no browser process remains");
	});
});
