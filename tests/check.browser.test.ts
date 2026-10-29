// check_widget page layer (AC04, AC05): scaled fresh captures of live and frozen pages and the read-only layout probe.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { BrowserHost } from "../src/browser.js";
import { CHECK_MAX_EDGE, type LayoutProbe, PROBE_SCRIPT } from "../src/check.js";
import { type Frame, WidgetPage } from "../src/page.js";
import { decodePng, limitPng, pngSize } from "../src/png.js";
import { FIXTURES, sleep } from "./helpers.js";

// 90x18 cells at 8x17 CSS px per cell: 1440x612 device px at DPR 2.
const CSS_W = 720;
const CSS_H = 306;
const host = new BrowserHost({ dpr: 2 });
const open: WidgetPage[] = [];

async function widget(file: string, frames?: Frame[]): Promise<WidgetPage> {
	const w = await WidgetPage.open(host, { source: { path: join(FIXTURES, file) }, cssWidth: CSS_W, cssHeight: CSS_H, onFrame: (f) => frames?.push(f) });
	open.push(w);
	return w;
}

async function windowState(w: WidgetPage): Promise<string | undefined> {
	const s = await w.page.createCDPSession();
	try {
		return (await s.send("Browser.getWindowForTarget")).bounds.windowState;
	} finally {
		await s.detach().catch(() => {});
	}
}

after(async () => {
	for (const w of open.splice(0)) await w.close();
	await host.close();
});

describe("check_widget capture (AC04)", () => {
	it("a live page gives a fresh PNG whose long edge is at most 1000 px", async (t) => {
		const w = await widget("check-clean.html");
		const raw = await w.capture(CHECK_MAX_EDGE);
		const size = pngSize(Buffer.from(raw, "base64"));
		t.diagnostic(`live capture ${size.width}x${size.height}`);
		assert.ok(Math.max(size.width, size.height) <= CHECK_MAX_EDGE + 1, "scaled in Chromium");
		const out = limitPng(raw, CHECK_MAX_EDGE);
		assert.ok(Math.max(out.width, out.height) <= CHECK_MAX_EDGE);
		assert.ok(Math.abs(out.width / out.height - CSS_W / CSS_H) < 0.02, "aspect ratio kept");
		assert.equal(w.frozen, false);
	});

	it("a frozen page is captured without thawing: it stays frozen and minimized and casts no frames", async (t) => {
		const frames: Frame[] = [];
		const w = await widget("check-overflow.html", frames);
		await w.freeze();
		await sleep(300);
		assert.equal(await windowState(w), "minimized");
		const before = frames.length;
		const raw = await w.capture(CHECK_MAX_EDGE);
		const probe = await w.inspect<LayoutProbe>(PROBE_SCRIPT);
		const size = pngSize(Buffer.from(raw, "base64"));
		t.diagnostic(`frozen capture ${size.width}x${size.height}`);
		assert.ok(Math.max(size.width, size.height) <= CHECK_MAX_EDGE + 1);
		assert.ok(probe.issues.length > 0);
		// The clipped pink bar (#f38ba8) at the top left is in the frozen capture: the image is not blank.
		const px = decodePng(Buffer.from(raw, "base64"));
		const at = (5 * px.width + 10) * 4;
		assert.deepEqual([...px.data.slice(at, at + 3)], [0xf3, 0x8b, 0xa8]);
		await sleep(300);
		assert.equal(w.frozen, true);
		assert.equal(await windowState(w), "minimized");
		assert.equal(frames.length, before, "no screencast frames while frozen");
		assert.equal(await w.page.evaluate("document.hasFocus()"), false, "page not focused");
	});
});

describe("check_widget layout probe (AC05)", () => {
	it("lists the overflowing and clipped elements and a scroll size larger than the viewport", async (t) => {
		const w = await widget("check-overflow.html");
		const p = await w.inspect<LayoutProbe>(PROBE_SCRIPT);
		t.diagnostic(JSON.stringify(p));
		assert.deepEqual(p.viewport, { width: CSS_W, height: CSS_H });
		assert.ok(p.scroll.height > CSS_H, "scroll height larger than the viewport");
		const tall = p.issues.find((i) => i.el === "div#tall");
		assert.match(tall?.why ?? "", /beyond the viewport \(bottom by \d+ px\)/);
		const wide = p.issues.find((i) => i.el === "span#wide");
		assert.equal(wide?.why, "clipped by div.box (overflow: hidden)");
		assert.equal(p.issues.some((i) => i.el === "p"), false, "only the outermost overflowing element");
		assert.equal(p.issues.some((i) => i.el === "div" && i.why.includes("viewport")), false, "overflow: auto content is intended");
		assert.equal(p.total, p.issues.length);
	});

	it("reports none on a clean page with a scrolling log", async () => {
		const w = await widget("check-clean.html");
		const p = await w.inspect<LayoutProbe>(PROBE_SCRIPT);
		assert.deepEqual(p.issues, []);
		assert.deepEqual(p.scroll, { width: CSS_W, height: CSS_H });
	});

	it("the probe runs in an isolated world the page cannot see", async () => {
		const w = await widget("check-clean.html");
		await w.inspect(PROBE_SCRIPT);
		assert.equal(await w.page.evaluate("typeof window.max"), "undefined");
	});
});
