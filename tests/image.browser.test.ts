// show_image browser decoding (AC03): JPEG, WebP, GIF (first frame), and SVG decoded by headless Chromium to PNGs of
// the requested size, SVG transparency kept, no network request from the decoding page, and the page (and the browser,
// when it was the only page) closed afterwards. A missing browser only affects non-PNG sources.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { BrowserHost, BrowserMissingError } from "../src/browser.js";
import { decodeInBrowser, type ImageFormat, imageFit, prepareImage } from "../src/image.js";
import { decodePng } from "../src/png.js";
import { FIXTURES, localServer, pngSize, processTree, waitGone } from "./helpers.js";

const host = new BrowserHost({ dpr: 2 });
const cell = { width: 16, height: 34 };
const fitFor = (n: { width: number; height: number }, vector: boolean) => imageFit(n, cell, 2, 76, 24, vector);
const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, name));

after(async () => {
	await host.close();
});

/** RGBA of one pixel of a base64 PNG. */
function pixel(base64: string, x: number, y: number): number[] {
	const img = decodePng(Buffer.from(base64, "base64"));
	const i = (y * img.width + x) * 4;
	return [...img.data.subarray(i, i + 4)];
}

const near = (a: number[], b: number[], tol = 40): boolean => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= tol);

describe("browser decoding (AC03)", () => {
	const cases: [string, ImageFormat, { width: number; height: number }, { width: number; height: number }][] = [
		["image.jpg", "jpeg", { width: 120, height: 80 }, { width: 120, height: 80 }],
		["image.webp", "webp", { width: 120, height: 80 }, { width: 120, height: 80 }],
		["image.gif", "gif", { width: 64, height: 48 }, { width: 64, height: 48 }],
		["image.svg", "svg", { width: 200, height: 100 }, { width: 400, height: 200 }],
	];
	for (const [file, format, natural, sent] of cases) {
		it(`decodes ${file} to a PNG of the expected size`, async () => {
			const p = await prepareImage(fixture(file), fitFor, (b, f, target) => decodeInBrowser(host, b, f, target));
			assert.equal(p.format, format);
			assert.equal(p.browser, true);
			assert.deepEqual(p.natural, natural);
			assert.deepEqual(pngSize(p.data), sent);
			assert.deepEqual({ width: p.fit.width, height: p.fit.height }, sent);
			assert.deepEqual(p.fit, { ...fitFor(natural, format === "svg") });
			if (format === "jpeg" || format === "webp") {
				assert.ok(near(pixel(p.data, 10, 10), [220, 50, 50, 255]), `top left red: ${pixel(p.data, 10, 10)}`);
				assert.ok(near(pixel(p.data, 110, 70), [230, 200, 40, 255]), `bottom right yellow: ${pixel(p.data, 110, 70)}`);
			}
			if (format === "gif") assert.ok(near(pixel(p.data, 32, 24), [220, 50, 50, 255], 2), `first frame (red): ${pixel(p.data, 32, 24)}`);
			if (format === "svg") {
				assert.deepEqual(pixel(p.data, 2, 2), [0, 0, 0, 0], "transparent corner keeps alpha");
				assert.ok(near(pixel(p.data, 100, 100), [0xe0, 0xa0, 0x30, 255], 2), `opaque circle: ${pixel(p.data, 100, 100)}`);
			}
			assert.equal(host.pageCount, 0, "the decoding page is closed");
		});
	}

	it("the decoding page makes no network request (SVG references, a script, and CSS imports) and closes with its browser", async () => {
		const server = await localServer();
		const base = `http://127.0.0.1:${server.port}`;
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40" height="20">
<style>@import url("${base}/import.css"); rect { fill: url(${base}/paint.svg#p); }</style>
<image href="${base}/href.png" width="10" height="10"/><image xlink:href="${base}/xlink.png" width="10" height="10"/>
<rect x="20" width="20" height="20"/><script>fetch("${base}/script")</script></svg>`;
		const blocked: string[] = [];
		let pids: number[] = [];
		try {
			const decoded = await decodeInBrowser(host, Buffer.from(svg), "svg", (n) => {
				if (host.pid) pids = processTree(host.pid);
				return { width: n.width * 2, height: n.height * 2 };
			}, { onBlocked: (u) => blocked.push(u) });
			assert.deepEqual(pngSize(decoded.data), { width: 80, height: 40 });
			assert.deepEqual(decoded.natural, { width: 40, height: 20 });
		} finally {
			await server.close();
		}
		assert.deepEqual(server.hits, [], "no request reached the server");
		assert.deepEqual(blocked, [], "no request was even attempted");
		assert.equal(host.pageCount, 0);
		assert.equal(host.pid, undefined, "the browser closed after its only page");
		assert.ok(pids.length > 0);
		assert.deepEqual(await waitGone(pids), [], "no chrome-headless-shell process remains");
	});

	it("an undecodable image fails clearly", async () => {
		const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("not really a jpeg")]);
		await assert.rejects(
			prepareImage(broken, fitFor, (b, f, t) => decodeInBrowser(host, b, f, t)),
			/the JPEG image could not be decoded/,
		);
		assert.equal(host.pageCount, 0);
	});

	it("a missing browser gives the install hint for non-PNG sources only", async () => {
		const missing = new BrowserHost({ chromePath: "/nonexistent/chrome-headless-shell" });
		const decode = (b: Buffer, f: ImageFormat, t: (n: { width: number; height: number }) => { width: number; height: number }) => decodeInBrowser(missing, b, f, t);
		await assert.rejects(prepareImage(fixture("image.jpg"), fitFor, decode), (err: unknown) => err instanceof BrowserMissingError && /npx @puppeteer\/browsers install/.test(err.message));
		const png = await prepareImage(fixture("image.png"), fitFor, decode);
		assert.equal(png.browser, false);
		assert.equal(missing.pageCount, 0);
	});
});
