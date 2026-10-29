// show_image unit tests (AC01, AC02, AC04, AC08a): detection, file limits, guarded URL fetching with an injected fetch
// and resolver plus a loopback server, the cell fit, PNG downscaling without a browser, the retained-still limit,
// re-sends, and the persisted row details. No browser, no terminal: kitty writes go to an array.
import assert from "node:assert/strict";
import { chmodSync, closeSync, copyFileSync, ftruncateSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { getCellDimensions, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { ImageComponent } from "../src/component.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import {
	type FetchOptions,
	fetchImage,
	firstGifFrame,
	type ImageDecoder,
	imageFit,
	MAX_IMAGE_BYTES,
	parseImageSource,
	prepareImage,
	readImageFile,
	sniffImage,
} from "../src/image.js";
import interactiveWidgets, { imageSummary } from "../src/index.js";
import { PLACEHOLDER } from "../src/kitty.js";
import { MAX_IMAGE_STILLS, type SessionState, WidgetManager } from "../src/manager.js";
import { decodePng, encodePng, pngSize } from "../src/png.js";
import { GUIDELINES, IMAGE_GUIDELINES } from "../src/prompts.js";
import { FIXTURES } from "./helpers.js";

const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, name));
const tmp = mkdtempSync(join(tmpdir(), "piw-image-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const noBrowser: ImageDecoder = () => {
	throw new Error("the browser decoder must not run for PNG");
};

describe("tool registration (RQ01)", () => {
	it("registers show_image({source, title?, rows?}) with one guideline; show_widget keeps its own", () => {
		type Tool = { name: string; description: string; parameters: { properties: Record<string, { minimum?: number; maximum?: number }>; required?: string[] }; promptGuidelines?: string[]; promptSnippet?: string };
		const tools: Tool[] = [];
		const fake = { registerTool: (t: Tool) => tools.push(t), registerCommand() {}, registerEntryRenderer() {}, on() {} };
		interactiveWidgets(fake as unknown as Parameters<typeof interactiveWidgets>[0]);
		assert.deepEqual(
			tools.map((t) => t.name),
			["show_widget", "check_widget", "show_image"],
		);
		const image = tools.find((t) => t.name === "show_image");
		assert.deepEqual(Object.keys(image?.parameters.properties ?? {}), ["source", "title", "rows"]);
		assert.deepEqual(image?.parameters.required, ["source"]);
		assert.deepEqual([image?.parameters.properties.rows?.minimum, image?.parameters.properties.rows?.maximum], [1, 256]);
		assert.deepEqual(image?.promptGuidelines, IMAGE_GUIDELINES);
		assert.equal(IMAGE_GUIDELINES.length, 1);
		assert.match(IMAGE_GUIDELINES[0] ?? "", /show_image to show an existing image file or URL; do not build an `<img>` widget/);
		assert.equal(image?.promptSnippet?.split("\n").length, 1);
		assert.ok((image?.description.length ?? 0) < 800);
		assert.deepEqual(tools.find((t) => t.name === "show_widget")?.promptGuidelines, GUIDELINES);
	});
});

describe("detection and local files (AC01)", () => {
	it("detects PNG, JPEG, GIF, WebP, and SVG by content and rejects unknown content", () => {
		assert.equal(sniffImage(fixture("image.png")), "png");
		assert.equal(sniffImage(fixture("image.jpg")), "jpeg");
		assert.equal(sniffImage(fixture("image.gif")), "gif");
		assert.equal(sniffImage(fixture("image.webp")), "webp");
		assert.equal(sniffImage(fixture("image.svg")), "svg");
		assert.equal(sniffImage(Buffer.from('\uFEFF<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<!-- c --><svg viewBox="0 0 1 1"/>')), "svg");
		assert.equal(sniffImage(Buffer.from("<html><body><svg></svg></body></html>")), undefined);
		assert.equal(sniffImage(Buffer.from("plain text")), undefined);
		assert.equal(sniffImage(Buffer.alloc(0)), undefined);
		assert.equal(sniffImage(Buffer.from("RIFF\0\0\0\0WAVEfmt ")), undefined);
	});

	it("uses the content, not the extension", async () => {
		const disguised = join(tmp, "photo.png");
		copyFileSync(join(FIXTURES, "image.jpg"), disguised);
		assert.equal(sniffImage(await readImageFile(disguised)), "jpeg");
		const notImage = join(tmp, "notes.png");
		writeFileSync(notImage, "just text");
		await assert.rejects(prepareImage(await readImageFile(notImage), () => ({ cols: 1, rows: 1, width: 1, height: 1 }), noBrowser), /unsupported image format/);
	});

	it("refuses missing, unreadable, directory, and oversized files with clear errors", async () => {
		await assert.rejects(readImageFile(join(tmp, "missing.png")), /^ImageSourceError: file not found: .*missing\.png$/);
		await assert.rejects(readImageFile(tmp), /not a file/);
		const big = join(tmp, "big.png");
		const fd = openSync(big, "w");
		ftruncateSync(fd, MAX_IMAGE_BYTES + 1);
		closeSync(fd);
		await assert.rejects(readImageFile(big), /image larger than 20 MB/);
		const exact = join(tmp, "exact.bin");
		const fd2 = openSync(exact, "w");
		ftruncateSync(fd2, MAX_IMAGE_BYTES);
		closeSync(fd2);
		assert.equal((await readImageFile(exact)).length, MAX_IMAGE_BYTES);
		if (process.getuid?.() !== 0) {
			const locked = join(tmp, "locked.png");
			copyFileSync(join(FIXTURES, "image.png"), locked);
			chmodSync(locked, 0o000);
			await assert.rejects(readImageFile(locked), /cannot read .*locked\.png: permission denied/);
		}
	});

	it("resolves paths against the working directory and refuses non-http URL schemes", () => {
		assert.deepEqual(parseImageSource("tests/fixtures/image.png", "/repo"), { kind: "file", path: "/repo/tests/fixtures/image.png" });
		assert.deepEqual(parseImageSource("~/x.png", "/repo"), { kind: "file", path: join(homedir(), "x.png") });
		assert.deepEqual(parseImageSource("https://example.com/a b.png", "/repo"), { kind: "url", url: "https://example.com/a%20b.png" });
		for (const s of ["ftp://example.com/x.png", "file:///etc/x.png", "data:image/png;base64,AAAA", "javascript:alert(1)"]) assert.throws(() => parseImageSource(s, "/repo"), /unsupported URL scheme/, s);
		assert.throws(() => parseImageSource("  ", "/repo"), /source is empty/);
	});
});

describe("PNG without a browser (AC01)", () => {
	const cell = { width: 16, height: 34 };
	it("downscales a large PNG to the display pixel size in Node", async () => {
		const width = 2000;
		const height = 1000;
		const data = new Uint8Array(width * height * 4).fill(200);
		const big = encodePng({ width, height, data });
		const fitFor = (n: { width: number; height: number }, v: boolean) => imageFit(n, cell, 2, 76, 24, v);
		const p = await prepareImage(big, fitFor, noBrowser);
		assert.equal(p.browser, false);
		assert.deepEqual({ cols: p.fit.cols, rows: p.fit.rows }, { cols: 76, rows: 18 });
		assert.deepEqual(pngSize(Buffer.from(p.data, "base64")), { width: 1216, height: 608 });
		assert.deepEqual({ width: p.fit.width, height: p.fit.height }, { width: 1216, height: 608 });
		assert.equal(decodePng(Buffer.from(p.data, "base64")).data[0], 200);
	});

	it("sends a PNG within the display size unchanged", async () => {
		const png = fixture("image.png");
		const p = await prepareImage(png, (n, v) => imageFit(n, cell, 2, 76, 24, v), noBrowser);
		assert.equal(p.data, png.toString("base64"));
		assert.deepEqual(p.natural, { width: 160, height: 100 });
		assert.deepEqual(p.fit, { cols: 20, rows: 6, width: 160, height: 100 });
	});
});

describe("fit (AC04)", () => {
	const cell = { width: 16, height: 34 };
	it("keeps the aspect ratio and caps width and rows", () => {
		// Width-limited: 76 cols fill exactly, rows round up.
		assert.deepEqual(imageFit({ width: 4000, height: 2000 }, cell, 2, 76, 24, false), { cols: 76, rows: 18, width: 1216, height: 608 });
		// Height-limited by rows: 24 rows at most, width follows the aspect ratio.
		const tall = imageFit({ width: 1000, height: 2000 }, cell, 2, 76, 24, false);
		assert.ok(tall.rows <= 24 && tall.cols < 76, JSON.stringify(tall));
		assert.equal(Math.round((tall.width / tall.height) * 100), 50);
		assert.ok(tall.height <= 24 * 34);
		const short = imageFit({ width: 1000, height: 2000 }, cell, 2, 76, 5, false);
		assert.ok(short.rows <= 5 && short.height <= 5 * 34, JSON.stringify(short));
	});

	it("never enlarges past the natural size at the dpr; vectors render at the shown size", () => {
		const small = imageFit({ width: 64, height: 48 }, cell, 2, 76, 24, false);
		assert.ok(small.cols * cell.width <= 64 * 2 && small.cols === 8, JSON.stringify(small));
		assert.deepEqual({ width: small.width, height: small.height }, { width: 64, height: 48 });
		const svg = imageFit({ width: 200, height: 100 }, cell, 2, 76, 24, true);
		assert.deepEqual(svg, { cols: 25, rows: 6, width: 400, height: 200 });
		const dpr1 = imageFit({ width: 200, height: 100 }, cell, 1, 76, 24, true);
		assert.deepEqual(dpr1, { cols: 12, rows: 3, width: 192, height: 96 });
	});

	it("keeps only the first GIF frame", () => {
		const gif = fixture("image.gif");
		const first = firstGifFrame(gif);
		assert.ok(first.length < gif.length);
		assert.equal(first.at(-1), 0x3b);
		assert.equal(first.toString("latin1").split("\x2c\0\0\0\0").length - 1, 1, "one image descriptor");
		assert.equal(firstGifFrame(Buffer.from("GIF89a")).toString(), "GIF89a");
	});
});

// ---- URL fetching (AC02) ----

const PNG = fixture("image.png");
const body = (): ArrayBuffer => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength) as ArrayBuffer;
const publicResolver = async (host: string): Promise<string[]> => {
	const table: Record<string, string[]> = { "img.example.com": ["93.184.216.34"], "cdn.example.com": ["2606:2800:220:1::1"], "evil.example.com": ["93.184.216.35", "10.0.0.5"], "v6local.example.com": ["fd00::1"] };
	const found = table[host];
	if (!found) throw new Error(`ENOTFOUND ${host}`);
	return found;
};

/** A fake fetch: `routes` maps a URL to a response factory; every call is recorded. */
function fakeFetch(routes: Record<string, () => Response>, seen: string[] = []): typeof fetch {
	return (async (input: string | URL | Request) => {
		const url = String(input);
		seen.push(url);
		const r = routes[url];
		if (!r) return new Response("missing", { status: 404 });
		return r();
	}) as typeof fetch;
}

const opts = (extra: Partial<FetchOptions> = {}): FetchOptions => ({ allowHosts: [], resolve: publicResolver, ...extra });
const redirect = (to: string, status = 302) => () => new Response(null, { status, headers: { Location: to } });

describe("URL fetching (AC02)", () => {
	it("loads a public URL", async () => {
		const seen: string[] = [];
		const buf = await fetchImage("https://img.example.com/a.png", opts({ fetch: fakeFetch({ "https://img.example.com/a.png": () => new Response(body()) }, seen) }));
		assert.ok(buf.equals(PNG));
		assert.deepEqual(seen, ["https://img.example.com/a.png"]);
		const v6 = await fetchImage("https://cdn.example.com/a.png", opts({ fetch: fakeFetch({ "https://cdn.example.com/a.png": () => new Response(body()) }) }));
		assert.ok(v6.equals(PNG));
	});

	it("refuses localhost, private IP literals, and names resolving to local addresses before any request", async () => {
		const seen: string[] = [];
		const f = fakeFetch({}, seen);
		await assert.rejects(fetchImage("http://localhost:8080/x.png", opts({ fetch: f })), /refused http:\/\/localhost:8080\/x\.png: localhost is a local address; .*network\.allowHosts/);
		await assert.rejects(fetchImage("http://192.168.1.10/x.png", opts({ fetch: f })), /192\.168\.1\.10 is a local address/);
		await assert.rejects(fetchImage("http://[::1]:9000/x.png", opts({ fetch: f })), /\[::1\] is a local address/);
		await assert.rejects(fetchImage("http://169.254.169.254/latest", opts({ fetch: f })), /local address/);
		await assert.rejects(fetchImage("https://evil.example.com/x.png", opts({ fetch: f })), /evil\.example\.com resolves to the local address 10\.0\.0\.5/);
		await assert.rejects(fetchImage("https://v6local.example.com/x.png", opts({ fetch: f })), /resolves to the local address fd00::1/);
		await assert.rejects(fetchImage("https://nowhere.example.com/x.png", opts({ fetch: f })), /cannot resolve nowhere\.example\.com/);
		assert.deepEqual(seen, []);
	});

	it("refuses a redirect to a local host and follows at most 5 redirects", async () => {
		const seen: string[] = [];
		await assert.rejects(
			fetchImage("https://img.example.com/r", opts({ fetch: fakeFetch({ "https://img.example.com/r": redirect("http://127.0.0.1/secret.png") }, seen) })),
			/refused http:\/\/127\.0\.0\.1\/secret\.png: 127\.0\.0\.1 is a local address/,
		);
		assert.deepEqual(seen, ["https://img.example.com/r"]);
		const chain = (n: number): Record<string, () => Response> => {
			const routes: Record<string, () => Response> = { [`https://img.example.com/${n}`]: () => new Response(body()) };
			for (let i = 0; i < n; i++) routes[`https://img.example.com/${i}`] = redirect(`/${i + 1}`, [301, 302, 303, 307, 308][i % 5]);
			return routes;
		};
		assert.ok((await fetchImage("https://img.example.com/0", opts({ fetch: fakeFetch(chain(5)) }))).equals(PNG), "5 redirects are followed");
		await assert.rejects(fetchImage("https://img.example.com/0", opts({ fetch: fakeFetch(chain(6)) })), /too many redirects \(more than 5\)/);
		await assert.rejects(fetchImage("https://img.example.com/f", opts({ fetch: fakeFetch({ "https://img.example.com/f": redirect("file:///etc/passwd") }) })), /unsupported URL scheme "file:"/);
	});

	it("fails on a body over 20 MB (declared or streamed), a timeout, HTTP errors, and non-http schemes", async () => {
		const chunk = new Uint8Array(1024 * 1024);
		let pulled = 0;
		const endless = () =>
			new Response(
				new ReadableStream({
					pull(c) {
						pulled++;
						c.enqueue(chunk);
					},
				}),
			);
		await assert.rejects(fetchImage("https://img.example.com/big", opts({ fetch: fakeFetch({ "https://img.example.com/big": endless }) })), /image larger than 20 MB/);
		assert.ok(pulled <= 25, `stream aborted after ${pulled} MB`);
		await assert.rejects(
			fetchImage("https://img.example.com/declared", opts({ fetch: fakeFetch({ "https://img.example.com/declared": () => new Response("x", { headers: { "Content-Length": String(MAX_IMAGE_BYTES + 1) } }) }) })),
			/image larger than 20 MB/,
		);
		const hanging = ((_u: string, init?: RequestInit) =>
			new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
		const t0 = Date.now();
		await assert.rejects(fetchImage("https://img.example.com/slow", opts({ fetch: hanging, timeoutMs: 200 })), /timed out after 0\.2 s fetching https:\/\/img\.example\.com\/slow/);
		assert.ok(Date.now() - t0 < 2_000);
		const slowDns = (() => new Promise<string[]>(() => {})) as (h: string) => Promise<string[]>;
		await assert.rejects(fetchImage("https://img.example.com/x", opts({ resolve: slowDns, timeoutMs: 200 })), /timed out/);
		await assert.rejects(fetchImage("https://img.example.com/404", opts({ fetch: fakeFetch({}) })), /HTTP 404 fetching https:\/\/img\.example\.com\/404/);
		await assert.rejects(fetchImage("ftp://img.example.com/x.png", opts({ fetch: fakeFetch({}) })), /unsupported URL scheme "ftp:"/);
	});

	it("fetches a listed local host from a loopback server with the real fetch; unlisted it is refused", async () => {
		const hits: string[] = [];
		const server = createServer((req, res) => {
			hits.push(req.url ?? "");
			if (req.url === "/r") {
				res.writeHead(302, { Location: "/image.png" });
				res.end();
				return;
			}
			res.setHeader("Content-Type", "image/png");
			res.end(PNG);
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		const port = (server.address() as AddressInfo).port;
		try {
			const buf = await fetchImage(`http://127.0.0.1:${port}/r`, { allowHosts: [`127.0.0.1:${port}`] });
			assert.ok(buf.equals(PNG));
			assert.deepEqual(hits, ["/r", "/image.png"]);
			await assert.rejects(fetchImage(`http://127.0.0.1:${port}/image.png`, { allowHosts: [] }), /127\.0\.0\.1 is a local address/);
			await assert.rejects(fetchImage(`http://127.0.0.1:${port}/image.png`, { allowHosts: ["127.0.0.1:1"] }), /local address/, "another port is not listed");
			assert.equal(hits.length, 2);
		} finally {
			await new Promise<void>((r) => server.close(() => r()));
		}
	});
});

// ---- manager: retained stills, re-sends, persisted details (AC04, AC08a) ----

function setup() {
	const writes: string[] = [];
	let renders = 0;
	const state: SessionState = {
		pi: { sendMessage: () => {} } as unknown as SessionState["pi"],
		env: { kind: "ghostty", supported: true, tmux: false },
		config: DEFAULT_CONFIG,
		motion: false,
		tui: { mode: "fullscreen", terminal: { columns: 80, rows: 24 }, setFocus() {}, requestRender: () => renders++ } as unknown as SessionState["tui"],
		write: (d) => writes.push(d),
	};
	return { manager: new WidgetManager(state), writes, renders: () => renders };
}

const uploads = (writes: string[]): string[] => writes.filter((w) => w.includes("a=T,"));
const theme = { fg: (_c: string, t: string) => t } as unknown as Theme;

describe("shown images (AC04, AC08a)", () => {
	const pngSource = { kind: "file" as const, path: join(FIXTURES, "image.png") };

	it("fits a PNG to the cell size without a browser and draws a title line plus the grid", async () => {
		const { manager, writes } = setup();
		const img = await manager.showImage({ source: pngSource, title: "png", rows: 24 });
		const cell = getCellDimensions();
		const fit = imageFit({ width: 160, height: 100 }, { width: cell.widthPx, height: cell.heightPx }, 2, 76, 24, false);
		assert.deepEqual({ cols: img.details.cols, rows: img.details.rows }, { cols: fit.cols, rows: fit.rows });
		assert.equal(uploads(writes).length, 1);
		assert.match(writes[0] ?? "", new RegExp(`i=${img.details.imageId},c=${fit.cols},r=${fit.rows}`));
		const c = new ImageComponent(img.details, theme, manager);
		const lines = c.render(80);
		assert.equal(lines.length, 1 + fit.rows);
		assert.equal(lines[0], "◆ png");
		assert.ok(lines.slice(1).every((l) => l.includes(PLACEHOLDER)));
		await manager.shutdown();
	});

	it("keeps at most 20 stills: the 21st image turns the oldest into a one-line row; a click loads it again", async () => {
		const { manager, writes } = setup();
		const shown = [];
		for (let i = 0; i < MAX_IMAGE_STILLS + 1; i++) shown.push(await manager.showImage({ source: pngSource, title: `img ${i}`, rows: 24 }));
		const [oldest, second] = shown;
		assert.ok(oldest && second);
		assert.equal(oldest.image.retained, false);
		assert.ok(shown.slice(1).every((s) => s.image.retained));
		assert.ok(writes.some((w) => w.includes(`a=d,d=I,i=${oldest.details.imageId}`)), "the dropped still is deleted from the terminal");
		const row = new ImageComponent(oldest.details, theme, manager);
		assert.deepEqual(row.render(80), ["◇ img 0 · click to load"]);
		const press: TuiMouseEvent = { type: "press", button: "left", x: 3, y: 0, screenX: 3, screenY: 5, width: 80, height: 1, shift: false, alt: false, ctrl: false } as TuiMouseEvent;
		assert.deepEqual(row.handleMouse(press), { handled: true, render: true });
		await manager.getImage(oldest.id)?.loading;
		assert.equal(oldest.image.retained, true, "reloaded from the original path");
		assert.equal(second.image.retained, false, "the next oldest is dropped instead");
		assert.equal(row.render(80).length, 1 + oldest.rows);
		await manager.shutdown();
	});

	it("re-sends every retained image on /widgets-refresh, and a click on a shown image re-sends it without focus", async () => {
		const { manager, writes } = setup();
		const a = await manager.showImage({ source: pngSource, title: "a", rows: 24 });
		const b = await manager.showImage({ source: pngSource, title: "b", rows: 3 });
		const before = uploads(writes).length;
		assert.deepEqual(manager.resendAll("command").sort(), [a.id, b.id].sort());
		assert.equal(uploads(writes).length, before + 2);
		const row = new ImageComponent(a.details, theme, manager);
		row.render(80);
		const press = { type: "press", button: "left", x: 2, y: 1, screenX: 2, screenY: 1, width: 80, height: 7, shift: false, alt: false, ctrl: false } as TuiMouseEvent;
		assert.deepEqual(row.handleMouse(press), { handled: true, render: false });
		assert.equal(uploads(writes).length, before + 3);
		await manager.shutdown();
	});

	it("an earlier-process row loads on click; a failed load shows the problem and retries", async () => {
		const { manager } = setup();
		const missing = join(tmp, "gone.png");
		copyFileSync(join(FIXTURES, "image.png"), missing);
		const img = await manager.showImage({ source: { kind: "file", path: missing }, title: "gone", rows: 24 });
		const details = { ...img.details };
		await manager.shutdown();
		rmSync(missing);
		const row = new ImageComponent(details, theme, manager);
		assert.deepEqual(row.render(80), ["◇ gone · click to load"]);
		await manager.reloadImage(details);
		assert.match(row.render(300).join("\n"), /gone · click to retry\nload failed: file not found: .*gone\.png/);
		copyFileSync(join(FIXTURES, "image.png"), missing);
		await manager.reloadImage(details);
		assert.equal(row.render(80).length, 1 + details.rows);
		await manager.shutdown();
	});

	it("persisted row details and the tool result hold no image data (AC08a)", async () => {
		const { manager } = setup();
		const width = 1200;
		const height = 900;
		const data = new Uint8Array(width * height * 4);
		for (let i = 0; i < data.length; i++) data[i] = (i * 7919) & 255;
		const path = join(tmp, "noise.png");
		writeFileSync(path, encodePng({ width, height, data }));
		const img = await manager.showImage({ source: { kind: "file", path }, title: "noise", rows: 24 });
		const persisted = JSON.stringify(img.details);
		const text = imageSummary(img.details);
		for (const s of [persisted, text]) {
			assert.ok(s.length < 1_000, `bounded size: ${s.length}`);
			assert.doesNotMatch(s, /[A-Za-z0-9+/]{120,}/, "no base64 payload");
			assert.doesNotMatch(s, /iVBOR|\x89PNG/, "no PNG data");
			assert.doesNotMatch(s, /[\x00-\x08\x0e-\x1f]/, "no binary");
		}
		assert.deepEqual(Object.keys(img.details).sort(), ["cols", "format", "height", "id", "imageId", "kind", "natural", "rows", "source", "sourceKind", "title", "width"]);
		assert.match(text, new RegExp(`^Image ${img.id} is shown inline: ${img.details.cols}x${img.details.rows} cells, ${img.details.width}x${img.details.height} px sent \\(PNG, natural size 1200x900 px\\)\\.\\nSource: ${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
		await manager.shutdown();
	});
});
