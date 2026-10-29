// show_image sources and decoding (RQ02-RQ05 of the show-image item): source parsing, local reads, guarded URL
// fetching, magic-byte detection, the cell fit, PNG downscaling in Node, and decoding of other formats in a headless
// browser page without network access. Image bytes stay in RAM; nothing is written to disk.
import { lookup } from "node:dns/promises";
import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { basename } from "node:path";
import type { BrowserHost } from "./browser.js";
import type { CellSize } from "./env.js";
import { resolveReadPath } from "./guide.js";
import { decodePng, downscale, encodePng, pngSize, type Size } from "./png.js";
import { hostListed, isLocalHost } from "./policy.js";

export type ImageFormat = "png" | "jpeg" | "gif" | "webp" | "svg";
export type ImageSource = { kind: "file"; path: string } | { kind: "url"; url: string };

/** Largest file or download accepted. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** Largest PNG (in pixels) decoded or forwarded; protects RAM and the terminal's image memory. */
export const MAX_IMAGE_PIXELS = 50_000_000;
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_REDIRECTS = 5;
export const DEFAULT_IMAGE_ROWS = 24;

export const IMAGE_MIME: Readonly<Record<ImageFormat, string>> = {
	png: "image/png",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
};

/** A source problem reported to the agent as the tool error. */
export class ImageSourceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ImageSourceError";
	}
}

const tooLarge = (what: string): ImageSourceError => new ImageSourceError(`image larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB: ${what}`);

const SVG_START = /^(?:\s+|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!doctype[^>[]*(?:\[[\s\S]*?\])?\s*>)*<svg[\s>/]/i;

/** Format from the leading bytes (never the file extension); undefined when unknown. */
export function sniffImage(buf: Buffer): ImageFormat | undefined {
	if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return "png";
	if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
	const head = buf.toString("latin1", 0, 12);
	if (head.startsWith("GIF87a") || head.startsWith("GIF89a")) return "gif";
	if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "webp";
	const text = buf.toString("utf8", 0, 4096).replace(/^\uFEFF/, "");
	if (SVG_START.test(text)) return "svg";
	return undefined;
}

/** A path (relative to `cwd`, `~` expanded) or an http/https URL; other URL schemes are refused. */
export function parseImageSource(raw: string, cwd: string): ImageSource {
	const s = raw.trim();
	if (!s) throw new ImageSourceError("source is empty: pass a file path or an http or https URL");
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s)?.[1];
	if (scheme && scheme.length > 1) {
		if (!/^https?$/i.test(scheme)) throw new ImageSourceError(`unsupported URL scheme "${scheme}:": pass a file path or an http or https URL`);
		let url: URL;
		try {
			url = new URL(s);
		} catch {
			throw new ImageSourceError(`invalid URL: ${s}`);
		}
		return { kind: "url", url: url.href };
	}
	return { kind: "file", path: resolveReadPath(s, cwd) };
}

/** Display name of a source: the file name or the URL. */
export function sourceName(source: ImageSource): string {
	return source.kind === "file" ? basename(source.path) : source.url;
}

export function sourceText(source: ImageSource): string {
	return source.kind === "file" ? source.path : source.url;
}

/** Reads a local image file of at most `maxBytes`. */
export async function readImageFile(path: string, maxBytes = MAX_IMAGE_BYTES): Promise<Buffer> {
	const fail = (err: unknown): ImageSourceError => {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return new ImageSourceError(`file not found: ${path}`);
		if (code === "EACCES" || code === "EPERM") return new ImageSourceError(`cannot read ${path}: permission denied`);
		return new ImageSourceError(`cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
	};
	let size: number;
	try {
		const st = await stat(path);
		if (!st.isFile()) throw new ImageSourceError(`not a file: ${path}`);
		size = st.size;
	} catch (err) {
		throw err instanceof ImageSourceError ? err : fail(err);
	}
	if (size > maxBytes) throw tooLarge(path);
	let buf: Buffer;
	try {
		buf = await readFile(path);
	} catch (err) {
		throw fail(err);
	}
	if (buf.length > maxBytes) throw tooLarge(path);
	return buf;
}

/** Resolves a hostname to all of its addresses. */
export type Resolver = (hostname: string) => Promise<string[]>;

export const systemResolver: Resolver = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

export interface FetchOptions {
	/** `network.allowHosts` from the config: listed hosts are fetched even when local. */
	allowHosts: readonly string[];
	fetch?: typeof globalThis.fetch | undefined;
	resolve?: Resolver | undefined;
	timeoutMs?: number | undefined;
	maxBytes?: number | undefined;
	maxRedirects?: number | undefined;
}

const refused = (url: URL, why: string): ImageSourceError =>
	new ImageSourceError(`refused ${url.href}: ${why}; local and private addresses are only fetched when listed in network.allowHosts of the extension config`);

/** Refuses non-http(s) URLs and unlisted local hosts, including public names that resolve to a local address. */
export async function checkImageUrl(url: URL, allowHosts: readonly string[], resolve: Resolver = systemResolver): Promise<void> {
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new ImageSourceError(`unsupported URL scheme "${url.protocol}" in ${url.href}: only http and https are fetched`);
	if (hostListed(allowHosts, url)) return;
	const host = url.hostname;
	if (isLocalHost(host)) throw refused(url, `${host} is a local address`);
	const bare = host.replace(/^\[|\]$/g, "");
	if (isIP(bare)) return;
	let addresses: string[];
	try {
		addresses = await resolve(bare);
	} catch (err) {
		throw new ImageSourceError(`cannot resolve ${host}: ${err instanceof Error ? err.message : String(err)}`);
	}
	const local = addresses.find((a) => isLocalHost(a));
	if (local) throw refused(url, `${host} resolves to the local address ${local}`);
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * Fetches an image URL in Node: every request and redirect hop is checked (RQ03), at most `maxRedirects` redirects,
 * `maxBytes` streamed (aborted when exceeded), and one total timeout.
 */
export async function fetchImage(raw: string, opts: FetchOptions): Promise<Buffer> {
	const doFetch = opts.fetch ?? globalThis.fetch;
	const resolve = opts.resolve ?? systemResolver;
	const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
	const maxBytes = opts.maxBytes ?? MAX_IMAGE_BYTES;
	const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
	const controller = new AbortController();
	const timedOut = new ImageSourceError(`timed out after ${Math.round(timeoutMs / 100) / 10} s fetching ${raw}`);
	const timer = setTimeout(() => controller.abort(timedOut), timeoutMs);
	const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }));
	aborted.catch(() => {});
	const guard = <T>(p: Promise<T>): Promise<T> => Promise.race([p, aborted]);
	try {
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			throw new ImageSourceError(`invalid URL: ${raw}`);
		}
		for (let redirects = 0; ; ) {
			await guard(checkImageUrl(url, opts.allowHosts, resolve));
			let res: Response;
			try {
				res = await guard(doFetch(url.href, { redirect: "manual", signal: controller.signal, headers: { "User-Agent": "pi-interactive-widgets (show_image)", Accept: "image/*,*/*;q=0.5" } }));
			} catch (err) {
				if (err instanceof ImageSourceError) throw err;
				if (controller.signal.aborted) throw controller.signal.reason;
				const cause = (err as { cause?: { message?: string } }).cause?.message;
				throw new ImageSourceError(`cannot fetch ${url.href}: ${cause ?? (err instanceof Error ? err.message : String(err))}`);
			}
			if (REDIRECTS.has(res.status)) {
				await res.body?.cancel().catch(() => {});
				const location = res.headers.get("location");
				if (!location) throw new ImageSourceError(`HTTP ${res.status} without a Location header from ${url.href}`);
				if (redirects >= maxRedirects) throw new ImageSourceError(`too many redirects (more than ${maxRedirects}) fetching ${raw}`);
				redirects++;
				url = new URL(location, url);
				continue;
			}
			if (!res.ok) {
				await res.body?.cancel().catch(() => {});
				throw new ImageSourceError(`HTTP ${res.status} fetching ${url.href}`);
			}
			const declared = Number(res.headers.get("content-length"));
			if (Number.isFinite(declared) && declared > maxBytes) {
				await res.body?.cancel().catch(() => {});
				throw tooLarge(url.href);
			}
			return await guard(readBody(res, maxBytes, url.href, controller));
		}
	} finally {
		clearTimeout(timer);
	}
}

async function readBody(res: Response, maxBytes: number, what: string, controller: AbortController): Promise<Buffer> {
	if (!res.body) return Buffer.alloc(0);
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			controller.abort(tooLarge(what));
			await reader.cancel().catch(() => {});
			throw tooLarge(what);
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks);
}

/** Cells and PNG pixel size for an image shown inline. */
export interface ImageFit {
	cols: number;
	rows: number;
	/** Pixel size of the PNG to send. */
	width: number;
	height: number;
}

/**
 * Fits an image of `natural` size (CSS px: image pixels for rasters) into at most `maxCols` x `maxRows` cells (RQ05):
 * aspect kept, never larger than its natural size at `dpr`. The grid width is rounded down so the terminal's
 * aspect-preserving fit fills it exactly (never stretching past the natural size); rows round up, leaving at most one
 * cell spare split above and below. Rasters are sent at most at their natural pixel size; vectors at the shown size.
 */
export function imageFit(natural: Size, cell: CellSize, dpr: number, maxCols: number, maxRows: number, vector: boolean): ImageFit {
	const nw = Math.max(1, natural.width) * dpr;
	const nh = Math.max(1, natural.height) * dpr;
	const k = Math.min(1, (maxCols * cell.width) / nw, (maxRows * cell.height) / nh);
	const w = nw * k;
	const cols = Math.max(1, Math.min(maxCols, Math.floor(w / cell.width + 1e-6)));
	const shownW = Math.min(w, cols * cell.width);
	const shownH = (shownW * nh) / nw;
	const rows = Math.max(1, Math.min(maxRows, Math.ceil(shownH / cell.height - 1e-6)));
	const px = { width: Math.max(1, Math.round(shownW)), height: Math.max(1, Math.round(shownH)) };
	const keep = !vector && natural.width <= px.width && natural.height <= px.height;
	return { cols, rows, ...(keep ? { width: natural.width, height: natural.height } : px) };
}

/**
 * Bytes up to the end of the first image of a GIF, then the trailer: the browser shows exactly the first frame
 * whatever the frame delays. Returns the input when the block structure is not understood.
 */
export function firstGifFrame(gif: Buffer): Buffer {
	try {
		let at = 13;
		const lsd = gif[10] ?? 0;
		if (lsd & 0x80) at += 3 * 2 ** ((lsd & 7) + 1);
		const skipBlocks = (from: number): number => {
			let p = from;
			for (;;) {
				const n = gif[p];
				if (n === undefined) throw new Error("truncated");
				p += 1 + n;
				if (n === 0) return p;
			}
		};
		while (at < gif.length) {
			const b = gif[at];
			if (b === 0x21) at = skipBlocks(at + 2);
			else if (b === 0x2c) {
				const packed = gif[at + 9] ?? 0;
				at += 10;
				if (packed & 0x80) at += 3 * 2 ** ((packed & 7) + 1);
				at = skipBlocks(at + 1);
				return Buffer.concat([gif.subarray(0, at), Buffer.from([0x3b])]);
			} else return gif;
		}
	} catch {}
	return gif;
}

/** Browser decode result: a base64 PNG of the requested size and the image's natural CSS size. */
export interface Decoded {
	data: string;
	natural: Size;
	width: number;
	height: number;
}

/** Decodes `bytes` and renders them at the pixel size `target` picks from the natural size. */
export type ImageDecoder = (bytes: Buffer, format: ImageFormat, target: (natural: Size) => Size) => Promise<Decoded>;

const DECODE_ORIGIN = "https://image.pi-widget.invalid";
const DECODE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'";
const DECODE_DOC = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}img{display:block}</style><img decoding="sync" alt="" src="/image">`;

export interface BrowserDecodeOptions {
	timeoutMs?: number | undefined;
	/** Called for every request the page tried besides the synthetic document and image (all are blocked). */
	onBlocked?: ((url: string) => void) | undefined;
}

/**
 * Decodes an image in a fresh page of the session's headless browser (RQ04): JavaScript disabled, every request other
 * than the synthetic document and the image itself blocked, the image shown through `<img>` (SVG then runs no scripts
 * and loads nothing), transparency kept, and the page closed right after the capture. The page is not a widget page.
 */
export async function decodeInBrowser(host: BrowserHost, bytes: Buffer, format: ImageFormat, target: (natural: Size) => Size, opts: BrowserDecodeOptions = {}): Promise<Decoded> {
	const hosted = await host.newPage();
	try {
		const { page } = hosted;
		const body = format === "gif" ? firstGifFrame(bytes) : bytes;
		await page.setJavaScriptEnabled(false);
		await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
		await page.setRequestInterception(true);
		page.on("request", (req) => {
			const url = req.url();
			const headers = { "Content-Security-Policy": DECODE_CSP, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
			if (url === `${DECODE_ORIGIN}/`) void req.respond({ status: 200, contentType: "text/html; charset=utf-8", headers, body: DECODE_DOC }).catch(() => {});
			else if (url === `${DECODE_ORIGIN}/image`) void req.respond({ status: 200, contentType: IMAGE_MIME[format], headers, body }).catch(() => {});
			else {
				opts.onBlocked?.(url);
				void req.abort("blockedbyclient").catch(() => {});
			}
		});
		await page.goto(`${DECODE_ORIGIN}/`, { waitUntil: "load", timeout: opts.timeoutMs ?? 15_000 });
		const [nw, nh] = (await page.evaluate("(() => { const i = document.images[0]; return [i.naturalWidth, i.naturalHeight]; })()")) as [number, number];
		if (!nw || !nh) throw new ImageSourceError(`the ${format.toUpperCase()} image could not be decoded`);
		const natural = { width: nw, height: nh };
		const size = target(natural);
		await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });
		await page.evaluate(`(() => { const s = document.images[0].style; s.width = "${size.width}px"; s.height = "${size.height}px"; })()`);
		const data = (await page.screenshot({ type: "png", encoding: "base64", omitBackground: true, clip: { x: 0, y: 0, width: size.width, height: size.height } })) as string;
		return { data, natural, width: size.width, height: size.height };
	} finally {
		await hosted.release();
	}
}

/** A PNG ready to send, with how it was produced. */
export interface PreparedImage {
	format: ImageFormat;
	/** Base64 PNG. */
	data: string;
	natural: Size;
	fit: ImageFit;
	/** Started the browser to decode (not PNG). */
	browser: boolean;
}

/**
 * Detects the format and produces the PNG to send. PNG stays in Node: downscaled to the display size when larger (or
 * forwarded unchanged when its variant is not decodable here, the terminal then scales it). Other formats go through
 * `decode` (the headless browser). `fitFor` gives the cells and pixel size for a natural size.
 */
export async function prepareImage(bytes: Buffer, fitFor: (natural: Size, vector: boolean) => ImageFit, decode: ImageDecoder): Promise<PreparedImage> {
	const format = sniffImage(bytes);
	if (!format) throw new ImageSourceError("unsupported image format (detected from the content): PNG, JPEG, GIF, WebP, and SVG are supported");
	if (format === "png") {
		const natural = pngSize(bytes);
		if (!natural.width || !natural.height) throw new ImageSourceError("the PNG image has no pixels");
		if (natural.width * natural.height > MAX_IMAGE_PIXELS) throw new ImageSourceError(`image too large: ${natural.width}x${natural.height} px (at most ${MAX_IMAGE_PIXELS / 1e6} megapixels)`);
		const fit = fitFor(natural, false);
		let data = bytes.toString("base64");
		let sent = { width: natural.width, height: natural.height };
		if (fit.width < natural.width || fit.height < natural.height) {
			try {
				data = encodePng(downscale(decodePng(bytes), fit.width, fit.height)).toString("base64");
				sent = { width: fit.width, height: fit.height };
			} catch {
				// A PNG variant the Node decoder does not read (palette, 16-bit, interlaced): the terminal scales it.
			}
		}
		return { format, data, natural, fit: { ...fit, ...sent }, browser: false };
	}
	let fit: ImageFit | undefined;
	const decoded = await decode(bytes, format, (natural) => {
		fit = fitFor(natural, format === "svg");
		return { width: fit.width, height: fit.height };
	});
	if (!fit) throw new ImageSourceError(`the ${format.toUpperCase()} image could not be decoded`);
	return { format, data: decoded.data, natural: decoded.natural, fit: { ...fit, width: decoded.width, height: decoded.height }, browser: true };
}
