// One widget page: synthetic-origin serving through CDP Fetch, injection, CSP, paced PNG screencast,
// minimize freeze, input dispatch, and error and violation capture (RQ04 capture side, RQ06 mechanics, RQ08-RQ10).
import { randomBytes } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import type { CDPSession, Page, Protocol } from "puppeteer-core";
import type { BrowserHost, HostedPage } from "./browser.js";
import { buildCsp, checkRequest, DEFAULT_POLICY, isLocalHost, type NetworkPolicy, normalizeAllowHosts } from "./policy.js";

export type WidgetSource = { html: string } | { path: string };

export interface Frame {
	/** Base64 PNG exactly as delivered by the screencast (never decoded or written to disk). */
	data: string;
	at: number;
}

export interface BlockedRequest {
	url: string;
	reason: string;
}

export interface WidgetHandlers {
	onFrame?(frame: Frame): void;
	onSend?(data: unknown): void;
	onSubmit?(data: unknown): void;
	onBlocked?(blocked: BlockedRequest): void;
	onError?(message: string): void;
}

export interface WidgetPageOptions extends WidgetHandlers {
	source: WidgetSource;
	/** CSS viewport size: cells x CSS cell size. */
	cssWidth: number;
	cssHeight: number;
	title?: string | undefined;
	policy?: NetworkPolicy | undefined;
	/** CSS custom properties injected on `:root`, for example `{"--pi-bg": "#1e1e2e"}`. */
	theme?: Readonly<Record<string, string>> | undefined;
	/** Frame rate cap enforced by delaying screencast acks. */
	maxFps?: number | undefined;
	/** How long `open` waits for the first frame. */
	firstFrameTimeoutMs?: number | undefined;
	loadTimeoutMs?: number | undefined;
}

export interface MouseInput {
	type: "mouseMoved" | "mousePressed" | "mouseReleased";
	x: number;
	y: number;
	button?: "none" | "left" | "middle" | "right" | undefined;
	/** Bitmask of pressed buttons (1 left, 2 right, 4 middle). */
	buttons?: number | undefined;
	clickCount?: number | undefined;
	modifiers?: number | undefined;
}

export interface WheelInput {
	x: number;
	y: number;
	deltaX: number;
	deltaY: number;
	modifiers?: number | undefined;
}

export type KeyInput = Protocol.Input.DispatchKeyEventRequest;

export class SourceMissingError extends Error {
	constructor(path: string) {
		super(`source file missing: ${path}`);
		this.name = "SourceMissingError";
	}
}

export const BRIDGE_LIMITS = { maxItemBytes: 64 * 1024, maxQueueItems: 100, maxQueueBytes: 512 * 1024 } as const;
const MAX_RECORDS = 100;
const BINDING = "__piWidgetBridge";
const LOCAL_NETWORK_PERMISSIONS = ["local-network-access", "loopback-network", "local-network"];

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".csv": "text/csv; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".wasm": "application/wasm",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".mp4": "video/mp4",
	".webm": "video/webm",
};

const FULL_DOCUMENT = /^\s*(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\b|<html\b)/i;

function escapeHtml(s: string): string {
	return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Wraps a fragment in the extension shell; full documents are served as written. */
export function wrapDocument(html: string, title = "widget"): string {
	if (FULL_DOCUMENT.test(html)) return html;
	return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${html}</body></html>`;
}

const THEME_NAME = /^--[a-zA-Z0-9_-]+$/;
const THEME_VALUE = /^[^;{}<>\\]*$/;

/** Base CSS injected at document start; layered so any unlayered author CSS wins. */
export function baseCss(theme: Readonly<Record<string, string>> = {}): string {
	const vars = Object.entries(theme)
		.filter(([k, v]) => THEME_NAME.test(k) && THEME_VALUE.test(v))
		.map(([k, v]) => `${k}: ${v};`)
		.join(" ");
	return [
		"@layer pi-base {",
		`:root { color-scheme: dark; ${vars} }`,
		"*, *::before, *::after { box-sizing: border-box; }",
		"html, body { margin: 0; height: 100%; overflow: hidden; }",
		"body { background: var(--pi-bg, #1e1e2e); color: var(--pi-fg, #cdd6f4); font: 14px/1.4 system-ui, sans-serif; }",
		"select { appearance: base-select; }",
		"::picker(select) { appearance: base-select; }",
		"}",
	].join("\n");
}

/** Document-start script: bridge, WebRTC removal, violation capture, base CSS. Runs in every frame. */
function injectionScript(css: string): string {
	const cfg = JSON.stringify({ binding: BINDING, css, maxItemBytes: BRIDGE_LIMITS.maxItemBytes });
	return `(() => {
const cfg = ${cfg};
const call = globalThis[cfg.binding];
if (typeof call !== "function") return;
try { delete globalThis[cfg.binding]; } catch {}
const post = (kind, data) => {
	let json;
	try { json = JSON.stringify(data); } catch { throw new TypeError("pi." + kind + ": data must be JSON-serializable"); }
	if (json === undefined) throw new TypeError("pi." + kind + ": data must be JSON-serializable");
	if (new TextEncoder().encode(json).length > cfg.maxItemBytes) throw new RangeError("pi." + kind + ": data exceeds " + cfg.maxItemBytes + " bytes");
	call(JSON.stringify({ kind, json }));
	return true;
};
const pi = Object.freeze({
	send: (data) => post("send", data),
	submit: (data) => (navigator.userActivation && navigator.userActivation.isActive ? post("submit", data) : false),
});
Object.defineProperty(globalThis, "pi", { value: pi, writable: false, configurable: false, enumerable: false });
for (const name of Object.getOwnPropertyNames(globalThis)) {
	if (/^(webkit)?RTC/.test(name)) { try { delete globalThis[name]; } catch {} }
}
addEventListener("securitypolicyviolation", (e) => {
	try { call(JSON.stringify({ kind: "violation", json: JSON.stringify({ directive: e.effectiveDirective, url: e.blockedURI }) })); } catch {}
}, true);
try {
	const sheet = new CSSStyleSheet();
	sheet.replaceSync(cfg.css);
	document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
} catch {}
})();`;
}

/** Main page session: emulation, screencast, and input must stay on it (plan Design notes). */
function mainSession(page: Page): CDPSession {
	const client = (page as unknown as { _client?: () => CDPSession })._client;
	if (typeof client !== "function") throw new Error("puppeteer-core main CDP session unavailable");
	return client.call(page);
}

type Served = { status: number; type?: string | undefined; body: Buffer };

interface PathRoot {
	root: string;
	entry: string;
}

async function resolvePathRoot(path: string): Promise<PathRoot> {
	let entry: string;
	try {
		entry = await realpath(path);
		if (!(await stat(entry)).isFile()) throw new Error("not a file");
	} catch {
		throw new SourceMissingError(path);
	}
	return { root: dirname(entry), entry };
}

async function servePath(root: PathRoot, pathname: string): Promise<Served> {
	const notFound: Served = { status: 404, body: Buffer.from("not found") };
	let rel: string;
	try {
		rel = pathname.split("/").map(decodeURIComponent).join(sep);
	} catch {
		return { status: 400, body: Buffer.from("bad request") };
	}
	if (rel.includes("\0")) return notFound;
	const candidate = pathname === "/" ? root.entry : join(root.root, rel);
	let real: string;
	try {
		real = await realpath(candidate);
	} catch {
		return notFound;
	}
	const inside = relative(root.root, real);
	if (inside.startsWith("..") || isAbsolute(inside)) return notFound;
	try {
		if (!(await stat(real)).isFile()) return notFound;
		return { status: 200, type: MIME[extname(real).toLowerCase()] ?? "application/octet-stream", body: await readFile(real) };
	} catch {
		return notFound;
	}
}

export class WidgetPage {
	readonly id: string;
	readonly origin: string;
	readonly url: string;
	readonly blocked: BlockedRequest[] = [];
	readonly errors: string[] = [];
	lastFrame: Frame | undefined;

	private readonly hosted: HostedPage;
	private readonly cdp: CDPSession;
	private readonly opts: WidgetPageOptions;
	private readonly csp: string;
	private readonly policy: NetworkPolicy;
	private readonly minInterval: number;
	private readonly inline: string | undefined;
	private readonly pathRoot: PathRoot | undefined;
	private queue: unknown[] = [];
	private queueBytes = 0;
	private bridgeChain: Promise<void> = Promise.resolve();
	private ackTimer: NodeJS.Timeout | undefined;
	private frameWaiters: ((f: Frame) => void)[] = [];
	private casting = false;
	private windowId: number | undefined;
	private state: "live" | "frozen" | "closed" = "live";

	private constructor(hosted: HostedPage, opts: WidgetPageOptions, pathRoot: PathRoot | undefined) {
		this.hosted = hosted;
		this.cdp = mainSession(hosted.page);
		this.opts = opts;
		this.id = randomBytes(6).toString("hex");
		this.origin = `https://w-${this.id}.pi-widget.invalid`;
		this.policy = opts.policy ?? DEFAULT_POLICY;
		this.csp = buildCsp(this.policy);
		this.minInterval = 1000 / (opts.maxFps ?? 10);
		this.pathRoot = pathRoot;
		this.inline = "html" in opts.source ? wrapDocument(opts.source.html, opts.title) : undefined;
		this.url = pathRoot ? `${this.origin}/${encodeURIComponent(basename(pathRoot.entry))}` : `${this.origin}/`;
	}

	/** Opens a widget page and resolves after load and the first frame. */
	static async open(host: BrowserHost, opts: WidgetPageOptions): Promise<WidgetPage> {
		const pathRoot = "path" in opts.source ? await resolvePathRoot(opts.source.path) : undefined;
		const hosted = await host.newPage();
		const widget = new WidgetPage(hosted, opts, pathRoot);
		try {
			await widget.setup();
			return widget;
		} catch (err) {
			await widget.close();
			throw err;
		}
	}

	get frozen(): boolean {
		return this.state === "frozen";
	}

	get closed(): boolean {
		return this.state === "closed";
	}

	get page(): Page {
		return this.hosted.page;
	}

	private async setup(): Promise<void> {
		const { cdp } = this;
		const page = this.hosted.page;
		page.on("pageerror", (err) => this.recordError(err instanceof Error ? err.message : String(err)));
		cdp.on("Fetch.requestPaused", (e) => void this.onRequest(e));
		cdp.on("Runtime.bindingCalled", (e) => {
			if (e.name !== BINDING) return;
			this.bridgeChain = this.bridgeChain.then(() => this.onBridge(e.payload)).catch(() => {});
		});
		cdp.on("Page.screencastFrame", (e) => this.onScreencastFrame(e));
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: this.opts.cssWidth,
			height: this.opts.cssHeight,
			deviceScaleFactor: 0,
			mobile: false,
		});
		await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
		await cdp.send("Runtime.addBinding", { name: BINDING });
		await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: injectionScript(baseCss(this.opts.theme)) });
		await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
		const { windowId } = await cdp.send("Browser.getWindowForTarget");
		this.windowId = windowId;
		await this.grantListedLocalAccess();
		const loadTimeout = this.opts.loadTimeoutMs ?? 15_000;
		const response = await page.goto(this.url, { waitUntil: "load", timeout: loadTimeout });
		if (response && !response.ok()) throw new Error(`widget entry failed to load: HTTP ${response.status()}`);
		const first = this.nextFrame(this.opts.firstFrameTimeoutMs ?? 5_000);
		await this.startCast();
		await first;
	}

	// ---- serving and network policy ----

	/**
	 * Chrome's Local Network Access denies loopback and private targets from the widget origin in headless mode (U2).
	 * When config lists a local host, grant the permission to this widget's origin only; the extension layer still
	 * blocks every unlisted local address. Without such an entry Chrome's check stays in place as a second layer.
	 */
	private async grantListedLocalAccess(): Promise<void> {
		const listsLocal = normalizeAllowHosts(this.policy.allowHosts).some((e) => isLocalHost(e.replace(/:\d+$/, "").replace(/^\*\./, "x.")));
		if (!listsLocal) return;
		const browserContextId = this.hosted.page.browserContext().id;
		for (const name of LOCAL_NETWORK_PERMISSIONS) {
			await this.cdp
				.send("Browser.setPermission", { permission: { name }, setting: "granted", origin: this.origin, ...(browserContextId ? { browserContextId } : {}) })
				.catch(() => {});
		}
	}

	private async onRequest(e: Protocol.Fetch.RequestPausedEvent): Promise<void> {
		const { cdp } = this;
		const id = e.requestId;
		try {
			let url: URL | undefined;
			try {
				url = new URL(e.request.url);
			} catch {}
			if (url && url.origin === this.origin) {
				const res = await this.serve(e.request.method, url.pathname);
				await cdp.send("Fetch.fulfillRequest", {
					requestId: id,
					responseCode: res.status,
					responseHeaders: [
						{ name: "Content-Type", value: res.type ?? "text/plain; charset=utf-8" },
						{ name: "Content-Security-Policy", value: this.csp },
						{ name: "Cache-Control", value: "no-store" },
						{ name: "X-DNS-Prefetch-Control", value: "off" },
						{ name: "X-Content-Type-Options", value: "nosniff" },
						{ name: "Referrer-Policy", value: "no-referrer" },
					],
					body: res.body.toString("base64"),
				});
				return;
			}
			if (e.resourceType === "Document") {
				// 204 aborts the navigation and keeps the current document (failing it would commit an error page).
				this.recordBlocked({ url: e.request.url, reason: "navigation away from the widget origin blocked" });
				await cdp.send("Fetch.fulfillRequest", { requestId: id, responseCode: 204, body: "" });
				return;
			}
			const verdict = checkRequest(e.request.url, this.policy);
			if (verdict.allow) {
				await cdp.send("Fetch.continueRequest", { requestId: id });
			} else {
				this.recordBlocked({ url: e.request.url, reason: verdict.reason });
				await cdp.send("Fetch.failRequest", { requestId: id, errorReason: "BlockedByClient" });
			}
		} catch {
			await cdp.send("Fetch.failRequest", { requestId: id, errorReason: "Failed" }).catch(() => {});
		}
	}

	private async serve(method: string, pathname: string): Promise<Served> {
		if (method !== "GET" && method !== "HEAD") return { status: 405, body: Buffer.from("method not allowed") };
		if (this.pathRoot) return servePath(this.pathRoot, pathname);
		if (pathname === "/" && this.inline !== undefined) return { status: 200, type: MIME[".html"], body: Buffer.from(this.inline) };
		return { status: 404, body: Buffer.from("not found") };
	}

	// ---- bridge ----

	private async onBridge(payload: string): Promise<void> {
		if (this.state === "closed") return;
		let msg: { kind?: unknown; json?: unknown };
		let data: unknown;
		try {
			msg = JSON.parse(payload) as { kind?: unknown; json?: unknown };
			if (typeof msg.json !== "string") return;
			if (Buffer.byteLength(msg.json) > BRIDGE_LIMITS.maxItemBytes) {
				this.recordError(`bridge: ${String(msg.kind)} data exceeds ${BRIDGE_LIMITS.maxItemBytes} bytes`);
				return;
			}
			data = JSON.parse(msg.json);
		} catch {
			return;
		}
		if (msg.kind === "violation") {
			const v = data as { directive?: unknown; url?: unknown };
			this.recordBlocked({ url: String(v.url ?? ""), reason: `blocked by CSP ${String(v.directive ?? "")}` });
		} else if (msg.kind === "send") {
			this.enqueue(data, Buffer.byteLength(msg.json));
		} else if (msg.kind === "submit") {
			if (await this.hasUserActivation()) this.opts.onSubmit?.(data);
			else this.recordError("bridge: pi.submit rejected without user activation");
		}
	}

	private enqueue(data: unknown, bytes: number): void {
		if (this.queue.length >= BRIDGE_LIMITS.maxQueueItems || this.queueBytes + bytes > BRIDGE_LIMITS.maxQueueBytes) {
			this.recordError("bridge: pi.send dropped, queue full");
			return;
		}
		this.queue.push(data);
		this.queueBytes += bytes;
		this.opts.onSend?.(data);
	}

	/** Returns and clears the `pi.send` queue. */
	drainQueue(): unknown[] {
		const q = this.queue;
		this.queue = [];
		this.queueBytes = 0;
		return q;
	}

	get queued(): readonly unknown[] {
		return this.queue;
	}

	/** Checks transient activation from an isolated world the page cannot tamper with. */
	private async hasUserActivation(): Promise<boolean> {
		try {
			const { frameTree } = await this.cdp.send("Page.getFrameTree");
			const { executionContextId } = await this.cdp.send("Page.createIsolatedWorld", {
				frameId: frameTree.frame.id,
				worldName: "pi-widget-activation",
			});
			const r = await this.cdp.send("Runtime.evaluate", {
				expression: "navigator.userActivation.isActive",
				contextId: executionContextId,
				returnByValue: true,
			});
			return r.result.value === true;
		} catch {
			return false;
		}
	}

	// ---- screencast ----

	private onScreencastFrame(e: Protocol.Page.ScreencastFrameEvent): void {
		if (this.state !== "live" || !this.casting) {
			void this.cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
			return;
		}
		const frame: Frame = { data: e.data, at: performance.now() };
		this.lastFrame = frame;
		for (const w of this.frameWaiters.splice(0)) w(frame);
		this.opts.onFrame?.(frame);
		clearTimeout(this.ackTimer);
		this.ackTimer = setTimeout(() => {
			this.ackTimer = undefined;
			void this.cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
		}, this.minInterval);
	}

	private async startCast(): Promise<void> {
		this.casting = true;
		await this.cdp.send("Page.startScreencast", { format: "png" });
	}

	private async stopCast(): Promise<void> {
		this.casting = false;
		clearTimeout(this.ackTimer);
		this.ackTimer = undefined;
		await this.cdp.send("Page.stopScreencast").catch(() => {});
	}

	/** Resolves with the next frame, or rejects after the timeout. */
	nextFrame(timeoutMs = 2_000): Promise<Frame> {
		return new Promise((resolve, reject) => {
			const done = (f: Frame): void => {
				clearTimeout(timer);
				resolve(f);
			};
			const timer = setTimeout(() => {
				this.frameWaiters = this.frameWaiters.filter((w) => w !== done);
				reject(new Error(`no frame within ${timeoutMs} ms`));
			}, timeoutMs);
			this.frameWaiters.push(done);
		});
	}

	// ---- freeze and thaw ----

	/** Stops the screencast and minimizes the page's window; the last frame stays available. */
	async freeze(): Promise<void> {
		if (this.state !== "live") return;
		this.state = "frozen";
		await this.stopCast();
		await this.setWindowState("minimized");
	}

	/** Restores the window and restarts the screencast. */
	async thaw(): Promise<void> {
		if (this.state !== "frozen") return;
		this.state = "live";
		await this.setWindowState("normal");
		await this.startCast();
	}

	private async setWindowState(windowState: "normal" | "minimized"): Promise<void> {
		if (this.windowId === undefined) return;
		await this.cdp.send("Browser.setWindowBounds", { windowId: this.windowId, bounds: { windowState } });
	}

	// ---- input (CSS pixels) ----

	async mouse(ev: MouseInput): Promise<void> {
		await this.cdp.send("Input.dispatchMouseEvent", {
			type: ev.type,
			x: ev.x,
			y: ev.y,
			button: ev.button ?? (ev.type === "mouseMoved" ? "none" : "left"),
			buttons: ev.buttons ?? (ev.type === "mousePressed" ? 1 : 0),
			clickCount: ev.clickCount ?? (ev.type === "mouseMoved" ? 0 : 1),
			modifiers: ev.modifiers ?? 0,
		});
	}

	async click(x: number, y: number): Promise<void> {
		await this.mouse({ type: "mousePressed", x, y });
		await this.mouse({ type: "mouseReleased", x, y });
	}

	async wheel(ev: WheelInput): Promise<void> {
		await this.cdp.send("Input.dispatchMouseEvent", {
			type: "mouseWheel",
			x: ev.x,
			y: ev.y,
			deltaX: ev.deltaX,
			deltaY: ev.deltaY,
			modifiers: ev.modifiers ?? 0,
		});
	}

	async key(ev: KeyInput): Promise<void> {
		await this.cdp.send("Input.dispatchKeyEvent", ev);
	}

	async insertText(text: string): Promise<void> {
		await this.cdp.send("Input.insertText", { text });
	}

	// ---- records and close ----

	private recordBlocked(b: BlockedRequest): void {
		this.blocked.push(b);
		if (this.blocked.length > MAX_RECORDS) this.blocked.shift();
		this.opts.onBlocked?.(b);
	}

	private recordError(message: string): void {
		this.errors.push(message);
		if (this.errors.length > MAX_RECORDS) this.errors.shift();
		this.opts.onError?.(message);
	}

	/** Closes the page; the browser closes when it was the last one. Idempotent. */
	async close(): Promise<void> {
		if (this.state === "closed") return;
		this.state = "closed";
		this.casting = false;
		clearTimeout(this.ackTimer);
		this.frameWaiters = [];
		await this.hosted.release();
	}
}
