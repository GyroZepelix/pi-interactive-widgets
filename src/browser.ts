// One lazily launched chrome-headless-shell per Pi session; closes when its last page closes (RQ03).
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import puppeteer, { type Browser, type BrowserContext, type Page } from "puppeteer-core";

/** Puppeteer defaults that keep minimized or occluded pages running; removing them lets a minimized page idle (RQ06). */
export const ANTI_THROTTLING_FLAGS: readonly string[] = [
	"--disable-renderer-backgrounding",
	"--disable-background-timer-throttling",
	"--disable-backgrounding-occluded-windows",
];

function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return d;
	}
	return 0;
}

/** Finds the newest cached chrome-headless-shell binary under `<cacheDir>/chrome-headless-shell/`. */
export function findChromeHeadlessShell(cacheDir = join(homedir(), ".cache", "puppeteer")): string | undefined {
	const base = join(cacheDir, "chrome-headless-shell");
	let entries: string[];
	try {
		entries = readdirSync(base);
	} catch {
		return undefined;
	}
	const found: { version: string; exe: string }[] = [];
	for (const dir of entries) {
		const m = /^([a-z0-9_]+)-(\d+(?:\.\d+)*)$/.exec(dir);
		if (!m?.[1] || !m[2]) continue;
		const file = m[1].startsWith("win") ? "chrome-headless-shell.exe" : "chrome-headless-shell";
		let inner: string[];
		try {
			inner = readdirSync(join(base, dir)).filter((d) => d.startsWith("chrome-headless-shell-"));
		} catch {
			continue;
		}
		const exe = inner.map((d) => join(base, dir, d, file)).find((p) => existsSync(p));
		if (exe) found.push({ version: m[2], exe });
	}
	found.sort((x, y) => compareVersions(y.version, x.version));
	return found[0]?.exe;
}

export const INSTALL_HINT = "npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/puppeteer";

export class BrowserMissingError extends Error {
	constructor(detail: string) {
		super(`chrome-headless-shell not found (${detail}). Install it with: ${INSTALL_HINT}`);
		this.name = "BrowserMissingError";
	}
}

export interface BrowserHostOptions {
	/** Explicit binary path; defaults to the newest cached chrome-headless-shell. */
	chromePath?: string | undefined;
	/** Device pixel ratio applied with `--force-device-scale-factor` (never emulated). */
	dpr?: number | undefined;
	/** Puppeteer cache directory used for auto-detection. */
	cacheDir?: string | undefined;
}

export interface HostedPage {
	page: Page;
	/** Closes the page and its context; closes the browser when it was the last page. Idempotent. */
	release(): Promise<void>;
}

/** Owns the session's browser process. Launches on the first page and closes after the last one. */
export class BrowserHost {
	readonly dpr: number;
	private readonly opts: BrowserHostOptions;
	private browser: Browser | undefined;
	private launching: Promise<Browser> | undefined;
	private closing: Promise<void> | undefined;
	private pages = 0;

	constructor(opts: BrowserHostOptions = {}) {
		this.opts = opts;
		this.dpr = opts.dpr ?? 2;
	}

	/** PID of the running browser, if any. */
	get pid(): number | undefined {
		return this.browser?.process()?.pid;
	}

	get pageCount(): number {
		return this.pages;
	}

	resolveExecutable(): string {
		const explicit = this.opts.chromePath;
		if (explicit) {
			if (!existsSync(explicit)) throw new BrowserMissingError(`chromePath ${explicit} does not exist`);
			return explicit;
		}
		const found = findChromeHeadlessShell(this.opts.cacheDir);
		if (!found) throw new BrowserMissingError("no cached build under ~/.cache/puppeteer/chrome-headless-shell");
		return found;
	}

	private async launch(): Promise<Browser> {
		const executablePath = this.resolveExecutable();
		const browser = await puppeteer.launch({
			executablePath,
			headless: "shell",
			pipe: true,
			defaultViewport: null,
			ignoreDefaultArgs: [...ANTI_THROTTLING_FLAGS],
			args: [
				`--force-device-scale-factor=${this.dpr}`,
				"--block-new-web-contents",
				"--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
			],
			handleSIGINT: false,
			handleSIGTERM: false,
			handleSIGHUP: false,
		});
		for (const p of await browser.pages()) await p.close().catch(() => {});
		browser.once("disconnected", () => {
			if (this.browser === browser) this.browser = undefined;
		});
		return browser;
	}

	private async getBrowser(): Promise<Browser> {
		if (this.closing) await this.closing;
		if (this.browser?.connected) return this.browser;
		this.launching ??= this.launch().finally(() => {
			this.launching = undefined;
		});
		this.browser = await this.launching;
		return this.browser;
	}

	/** Opens a page in its own in-memory browser context. */
	async newPage(): Promise<HostedPage> {
		this.pages++;
		let context: BrowserContext | undefined;
		try {
			const browser = await this.getBrowser();
			context = await browser.createBrowserContext();
			const page = await context.newPage();
			let released = false;
			const ctx = context;
			return {
				page,
				release: async () => {
					if (released) return;
					released = true;
					await ctx.close().catch(() => {});
					await this.pageClosed();
				},
			};
		} catch (err) {
			await context?.close().catch(() => {});
			await this.pageClosed();
			throw err;
		}
	}

	private async pageClosed(): Promise<void> {
		this.pages = Math.max(0, this.pages - 1);
		if (this.pages === 0) await this.close();
	}

	/** Closes the browser now (session shutdown or last page closed). */
	async close(): Promise<void> {
		const launching = this.launching;
		const browser = this.browser ?? (launching ? await launching.catch(() => undefined) : undefined);
		this.browser = undefined;
		if (!browser) return;
		this.closing = browser
			.close()
			.catch(() => {
				browser.process()?.kill("SIGKILL");
			})
			.finally(() => {
				this.closing = undefined;
			});
		await this.closing;
	}
}
