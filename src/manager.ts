// Widget registry and run-time policy (RQ06 as revised by PD09, RQ07, RQ12, RQ13, RQ17): one live widget per session
// (PD06); a press wakes a frozen widget and is then delivered to the page; hover wakes only where the terminal reports
// motion; release freezes immediately with pi.send delivery; an unfocused widget freezes 10 s after creation or the last
// hover move; a focused widget freezes after 5 min without input. At most 5 pages stay open (least recently used frozen
// page closes first) and a page frozen for 30 min closes; closed and resumed widgets revive on click with fresh JS state.
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, colorToHex, getCellDimensions, type TUI } from "@earendil-works/pi-tui";
import { deliveryOptions, widgetMessage } from "./bridge.js";
import { BrowserHost } from "./browser.js";
import { CHECK_MAX_EDGE, type CheckReport, type LayoutProbe, PROBE_SCRIPT } from "./check.js";
import { BUTTON_BITS, WHEEL_PX } from "./component.js";
import type { WidgetConfig } from "./config.js";
import { type CellSize, cssCellSize, type Environment, tmuxCellSize, tmuxDisplay } from "./env.js";
import { type CellBox, imageIds, KittyImage, MAX_CELLS } from "./kitty.js";
import { flattenPng, limitPng } from "./png.js";
import { type BlockedRequest, DEFAULT_PAGE_BG, type KeyInput, type MouseInput, SourceMissingError, type WheelInput, WidgetPage, type WidgetSource } from "./page.js";
import { cdpModifiers, horizontalWheel, isPress, parseSgr, RawInputHook, type RawInputResult, type SgrMouse } from "./rawinput.js";

/** A click replayed on a revived page at the CSS point it hit on the closed widget's still (RQ03). */
export interface Replay {
	x: number;
	y: number;
	button: "left" | "middle" | "right";
	modifiers: number;
}

/** A row component that maps screen cells to CSS points (WidgetComponent). */
interface ScreenMapped {
	cssAtScreen(screenX: number, screenY: number): { x: number; y: number } | undefined;
}

/** Persisted with the tool result (and dev entries); enough to render the row after a reload. */
export interface WidgetDetails {
	id: string;
	imageId: number;
	title: string;
	cols: number;
	rows: number;
	cssWidth: number;
	cssHeight: number;
	/** CSS pixels per cell. */
	cssCell: CellSize;
	source: "html" | "path";
	path?: string | undefined;
}

export const DEFAULT_ROWS = 20;
/** At most this many widget pages stay open per session (RQ07). */
export const MAX_PAGES = 5;

/** Run-time policy durations (RQ06, RQ07). */
export interface Timers {
	/** Unfocused live widgets freeze this long after creation or the last hover move (PD09). */
	idleMs: number;
	/** Focused widgets freeze after this long without input. */
	focusMs: number;
	/** Frozen pages close after this long. */
	closeMs: number;
}

export const DEFAULT_TIMERS: Readonly<Timers> = { idleMs: 10_000, focusMs: 5 * 60_000, closeMs: 30 * 60_000 };
export const IDLE_MS = DEFAULT_TIMERS.idleMs;

/**
 * Timer durations; in dev mode only (`PI_WIDGETS_DEV=1`) `PI_WIDGETS_DEV_TIMERS` can shorten them for e2e tests, for
 * example `idle=1000,focus=3000,close=4000` (milliseconds). Invalid entries are ignored.
 */
export function timersFromEnv(env: NodeJS.ProcessEnv = process.env): Timers {
	const t: Timers = { ...DEFAULT_TIMERS };
	if (env.PI_WIDGETS_DEV !== "1" || !env.PI_WIDGETS_DEV_TIMERS) return t;
	const keys: Record<string, keyof Timers> = { idle: "idleMs", focus: "focusMs", close: "closeMs" };
	for (const part of env.PI_WIDGETS_DEV_TIMERS.split(",")) {
		const [k, v] = part.split("=").map((x) => x.trim());
		const key = k ? keys[k] : undefined;
		const ms = Number(v);
		if (key && Number.isInteger(ms) && ms > 0) t[key] = ms;
	}
	return t;
}

export interface SessionState {
	pi: ExtensionAPI;
	env: Environment;
	config: WidgetConfig;
	/** The terminal reports pointer motion to Pi (no multiplexer), so hover can wake widgets (PD09). */
	motion: boolean;
	timers?: Timers | undefined;
	tui?: TUI | undefined;
	ctx?: ExtensionContext | undefined;
}

/** Dev-only JSON-lines log for e2e tests (`PI_WIDGETS_DEV=1` and `PI_WIDGETS_DEV_LOG=<file>`); never frames. */
export function devLog(event: Record<string, unknown>): void {
	const file = devLogging();
	if (!file) return;
	try {
		appendFileSync(file, `${JSON.stringify({ t: Date.now(), ...event })}\n`);
	} catch {}
}

function devLogging(): string | undefined {
	return process.env.PI_WIDGETS_DEV === "1" ? process.env.PI_WIDGETS_DEV_LOG || undefined : undefined;
}

/** Default and clamped widget size in cells (RQ02). */
export function widgetSize(cols: number | undefined, rows: number | undefined, terminalCols: number): { cols: number; rows: number } {
	const clamp = (n: number): number => Math.max(1, Math.min(MAX_CELLS, Math.round(n)));
	return { cols: clamp(cols ?? Math.min(100, terminalCols - 4)), rows: clamp(rows ?? DEFAULT_ROWS) };
}

/** Pi theme colors as CSS custom properties; the page keeps a dark color scheme (RQ10). */
export function themeVars(theme: Theme | undefined): Record<string, string> {
	if (!theme) return {};
	const out: Record<string, string> = {};
	const tokens: ("accent" | "muted" | "dim" | "border" | "success" | "error" | "warning" | "text")[] = ["accent", "muted", "dim", "border", "success", "error", "warning"];
	if (theme.appearance === "dark") tokens.push("text");
	for (const token of tokens) {
		try {
			out[`--pi-${token === "text" ? "fg" : token}`] = colorToHex(theme.colors[token]);
		} catch {}
	}
	return out;
}

/** Monotonic use counter for the least-recently-used order. */
let useSeq = 0;

const sameBox = (a: CellBox, b: CellBox): boolean => a.cols === b.cols && a.rows === b.rows;

export class Widget {
	readonly details: WidgetDetails;
	readonly image: KittyImage;
	/** Revive source: inline HTML from the tool arguments or the entry file (read again on revive). */
	readonly source: WidgetSource;
	/** The open page; undefined or closed once the widget is closed (the RAM still stays in `image`). */
	page: WidgetPage | undefined;
	/** Cells the image is currently shown at (scaled to fit in narrow terminals, RQ12). */
	display: CellBox;
	/** Last use (creation, wake, input; a monotonic counter) for the least-recently-used close (RQ07). */
	lastUsed = 0;
	/** Shown instead of the hint when a revive failed, for example `source file missing: <path>`. */
	problem: string | undefined;
	reviving: Promise<void> | undefined;
	/** Blocked requests seen after the initial load and not yet delivered (capped). */
	pendingBlocked: BlockedRequest[] = [];
	/** Pressed mouse buttons (CDP bitmask) for drags. */
	buttons = 0;
	/** The component that holds keyboard focus, and the one to restore on release. */
	focusedBy: Component | undefined;
	prevFocus: Component | null = null;
	idleTimer: NodeJS.Timeout | undefined;
	focusTimer: NodeJS.Timeout | undefined;
	closeTimer: NodeJS.Timeout | undefined;
	private chain: Promise<unknown> = Promise.resolve();

	constructor(details: WidgetDetails, page: WidgetPage | undefined, image: KittyImage, source: WidgetSource) {
		this.details = details;
		this.page = page;
		this.image = image;
		this.source = source;
		this.display = { cols: details.cols, rows: details.rows, scale: 1 };
	}

	get id(): string {
		return this.details.id;
	}

	get focused(): boolean {
		return this.focusedBy !== undefined;
	}

	/** No open page: the widget shows its RAM still (if any) and revives on click. */
	get closed(): boolean {
		return !this.page || this.page.closed;
	}

	get frozen(): boolean {
		return this.page?.frozen ?? false;
	}

	/** Runs page work in order; failures are logged, never thrown into Pi's input loop. */
	run(what: string, fn: () => Promise<unknown>): void {
		this.chain = this.chain.then(fn).catch((err: unknown) => devLog({ ev: "error", id: this.id, what, message: err instanceof Error ? err.message : String(err) }));
	}

	private onPage(what: string, fn: (p: WidgetPage) => Promise<unknown>): void {
		this.run(what, async () => {
			const p = this.page;
			if (p && !p.closed) await fn(p);
		});
	}

	mouse(ev: MouseInput): void {
		this.onPage("mouse", (p) => p.mouse(ev));
	}

	wheel(ev: WheelInput): void {
		this.onPage("wheel", (p) => p.wheel(ev));
	}

	keys(events: KeyInput[]): void {
		this.onPage("key", async (p) => {
			for (const e of events) await p.key(e);
		});
	}

	text(text: string): void {
		this.onPage("text", (p) => p.insertText(text));
	}

	blocked(b: BlockedRequest): void {
		if (this.pendingBlocked.length < 100) this.pendingBlocked.push(b);
	}

	takeBlocked(): BlockedRequest[] {
		const out = this.pendingBlocked;
		this.pendingBlocked = [];
		return out;
	}

	clearTimers(): void {
		for (const t of [this.idleTimer, this.focusTimer, this.closeTimer]) clearTimeout(t);
		this.idleTimer = this.focusTimer = this.closeTimer = undefined;
	}
}

export interface CreateOptions {
	source: WidgetSource;
	title: string;
	cols?: number | undefined;
	rows?: number | undefined;
}

export class WidgetManager {
	readonly widgets = new Map<string, Widget>();
	private host: BrowserHost | undefined;
	private live: Widget | undefined;
	private lastMode: string | undefined;
	private lastFullRedraws: number | undefined;
	private lastSize: string | undefined;
	private resendQueued = false;
	private readonly s: SessionState;
	/** Raw input hook ahead of Pi's viewport listener (RQ01, RQ02); not installed when the feature check fails. */
	private readonly hook = new RawInputHook((data) => this.rawInput(data));
	private hookLogged: boolean | undefined;
	/** The press being dispatched while a widget is focused; a row of that widget marks it inside (RQ02). */
	private pressProbe: { widget: Widget; inside: boolean } | undefined;

	constructor(state: SessionState) {
		this.s = state;
	}

	get state(): SessionState {
		return this.s;
	}

	get timers(): Timers {
		return this.s.timers ?? DEFAULT_TIMERS;
	}

	get(id: string): Widget | undefined {
		return this.widgets.get(id);
	}

	get fullscreen(): boolean {
		return this.s.tui?.mode === "fullscreen";
	}

	/** Hover moves reach widgets (plain terminal); under multiplexers only presses, drags, and wheel do. */
	get hoverReported(): boolean {
		return this.s.motion;
	}

	/** The raw input hook is installed; without it trackpad presses are filtered in the component instead (fallback). */
	get rawInputHooked(): boolean {
		return this.hook.installed;
	}

	/** Captures the TUI and installs the raw input hook. */
	attach(tui: TUI): void {
		this.s.tui = tui;
		this.applyHook();
	}

	/** Installs or re-applies the hook at the front of the current TUI's listeners (after a renderer change, too). */
	private applyHook(): void {
		const tui = this.s.tui;
		if (!tui) return;
		const ok = this.hook.apply(tui);
		if (ok !== this.hookLogged) {
			this.hookLogged = ok;
			devLog({ ev: "raw-input", hooked: ok });
		}
	}

	/** Pi's fullscreen transcript scroll offset (`TuiAltScreen.viewportTop`), 0 when unavailable. */
	viewportTop(): number {
		const v = (this.s.tui as { viewportTop?: unknown } | undefined)?.viewportTop;
		return typeof v === "number" ? v : 0;
	}

	/**
	 * Raw terminal input ahead of Pi (fullscreen only). Horizontal wheel (codes 66 and 67 with any modifier bits) is
	 * consumed: a focused widget under the pointer scrolls its page sideways, otherwise it is dropped (RQ01). A press
	 * passes through; when it does not land on the focused widget's rows, the widget is released like Escape (RQ02).
	 */
	rawInput(data: string): RawInputResult {
		if (!this.fullscreen) return undefined;
		const m = parseSgr(data);
		if (!m) return undefined;
		const dir = horizontalWheel(m.code);
		if (dir !== 0) {
			if (!m.release) this.horizontalWheel(m, dir);
			return { consume: true };
		}
		if (isPress(m)) this.watchPress();
		return undefined;
	}

	private horizontalWheel(m: SgrMouse, dir: -1 | 1): void {
		const w = this.focusedWidget();
		if (!w || w.closed) return;
		const at = (w.focusedBy as Partial<ScreenMapped> | undefined)?.cssAtScreen?.(m.x, m.y);
		if (!at) return;
		this.pointer(w, "wheel");
		w.wheel({ x: at.x, y: at.y, deltaX: dir * WHEEL_PX, deltaY: 0, modifiers: cdpModifiers(m.code) });
	}

	/** Checks after Pi dispatched the press whether it reached the focused widget's rows; releases it otherwise. */
	private watchPress(): void {
		const w = this.focusedWidget();
		if (!w) return;
		const probe = { widget: w, inside: false };
		this.pressProbe = probe;
		queueMicrotask(() => {
			if (this.pressProbe === probe) this.pressProbe = undefined;
			// A press on another widget or a focusable component already moved focus; Pi's blur then releases this one.
			if (probe.inside || !w.focusedBy || this.focusedComponent() !== w.focusedBy) return;
			devLog({ ev: "outside-press", id: w.id });
			this.releaseFocus(w);
		});
	}

	/** Called by a widget row for every press Pi dispatches to it; `inRows` when the press is on the row's lines. */
	pressSeen(w: Widget, inRows: boolean): void {
		if (inRows && this.pressProbe?.widget === w) this.pressProbe.inside = true;
	}

	/** The widget whose row holds Pi's keyboard focus. */
	focusedWidget(): Widget | undefined {
		const c = this.focusedComponent();
		if (!c) return undefined;
		for (const w of this.widgets.values()) if (w.focusedBy === c) return w;
		return undefined;
	}

	/** The component to restore when a widget about to take focus is released: never another widget's row. */
	focusTarget(): Component | null {
		const owner = this.focusedWidget();
		return owner ? owner.prevFocus : this.focusedComponent();
	}

	/** Widgets with an open page. */
	get openPages(): number {
		let n = 0;
		for (const w of this.widgets.values()) if (!w.closed) n++;
		return n;
	}

	private cellSize(): CellSize {
		const fromTmux = this.s.env.tmux ? tmuxCellSize(tmuxDisplay()) : undefined;
		if (fromTmux) return fromTmux;
		const pi = getCellDimensions();
		return { width: pi.widthPx, height: pi.heightPx };
	}

	/** Two fresh image ids (double buffering, RQ04); a new frame re-renders the rows to switch to its id. */
	private newImage(): KittyImage {
		return new KittyImage([imageIds.next(), imageIds.next()], { tmux: this.s.env.tmux }, undefined, { onSwitch: () => this.s.tui?.requestRender() });
	}

	/** Opens a page for a widget; frames go to its image at its current display size. `id` labels dev-log events. */
	private async openPage(id: string, source: WidgetSource, title: string, cssWidth: number, cssHeight: number, target: () => Widget | undefined): Promise<WidgetPage> {
		this.host ??= new BrowserHost({ chromePath: this.s.config.chromePath, dpr: this.s.config.dpr });
		await this.evict();
		return WidgetPage.open(this.host, {
			source,
			title,
			cssWidth,
			cssHeight,
			policy: this.s.config.network,
			theme: themeVars(this.s.ctx?.ui.theme),
			// Blend into the terminal (RQ05) unless Pi's theme is light: the page keeps a dark scheme with light text.
			transparent: this.s.ctx?.ui.theme?.appearance !== "light",
			onFrame: (f) => {
				const w = target();
				if (w) w.image.send(f.data, w.display.cols, w.display.rows);
			},
			onSend: (data) => devLog({ ev: "send", id, data }),
			onSubmit: (data) => {
				const w = target();
				devLog({ ev: "submit", id, data });
				if (w) this.deliver(w, "submit", [data]);
			},
			onBlocked: (b) => {
				target()?.blocked(b);
				devLog({ ev: "blocked", id, ...b });
			},
			onError: (message) => devLog({ ev: "jserror", id, message }),
		});
	}

	/** Opens a new widget and resolves after its first frame was uploaded. */
	async create(opts: CreateOptions): Promise<Widget> {
		const dpr = this.s.config.dpr;
		const css = cssCellSize(this.cellSize(), dpr);
		const { cols, rows } = widgetSize(opts.cols, opts.rows, this.s.tui?.terminal.columns ?? process.stdout.columns ?? 104);
		const image = this.newImage();
		const cssWidth = Math.round(cols * css.width);
		const cssHeight = Math.round(rows * css.height);
		let widget: Widget | undefined;
		const id = randomBytes(6).toString("hex");
		const page = await this.openPage(id, opts.source, opts.title, cssWidth, cssHeight, () => widget);
		const details: WidgetDetails = {
			id,
			imageId: image.ids[0],
			title: opts.title,
			cols,
			rows,
			cssWidth,
			cssHeight,
			cssCell: css,
			source: "html" in opts.source ? "html" : "path",
			path: "path" in opts.source ? opts.source.path : undefined,
		};
		widget = new Widget(details, page, image, opts.source);
		// The first frame arrived before the widget existed; send it now at full size (the first render rescales it).
		const first = page.lastFrame;
		if (first) image.send(first.data, cols, rows);
		await this.start(widget);
		return widget;
	}

	/** Registers a new widget: live with the idle timer from creation in fullscreen, frozen otherwise. */
	async start(w: Widget): Promise<void> {
		this.widgets.set(w.id, w);
		w.lastUsed = ++useSeq;
		devLog({ ev: "widget", ...w.details, spareId: w.image.ids[1] });
		if (this.fullscreen) {
			await this.makeLive(w);
			this.armIdle(w);
		} else {
			await this.freeze(w);
		}
	}

	/**
	 * Revives a closed widget, or a row from an earlier process (resume, restart, reload), with fresh JS state:
	 * inline widgets from their tool arguments, path widgets from the current file (RQ07).
	 */
	revive(details: WidgetDetails, source: WidgetSource | undefined, replay?: Replay): Promise<void> {
		let w = this.widgets.get(details.id);
		if (!w) {
			// A row from an earlier process: new image id (ids are never reused within a process), no still yet.
			const src = source ?? (details.path ? { path: details.path } : undefined);
			devLog({ ev: "revive", id: details.id, resumed: true, source: src ? Object.keys(src)[0] : null });
			if (!src) return Promise.resolve();
			w = new Widget(details, undefined, this.newImage(), src);
			this.widgets.set(w.id, w);
		}
		const widget = w;
		if (!widget.closed) return Promise.resolve();
		widget.reviving ??= this.reviveNow(widget, replay).finally(() => {
			widget.reviving = undefined;
			this.s.tui?.requestRender();
		});
		return widget.reviving;
	}

	private async reviveNow(w: Widget, replay: Replay | undefined): Promise<void> {
		const t0 = performance.now();
		const warm = this.host?.pageCount ? true : false;
		w.problem = undefined;
		w.image.resend(w.display.cols, w.display.rows);
		let page: WidgetPage;
		try {
			page = await this.openPage(w.id, w.source, w.details.title, w.details.cssWidth, w.details.cssHeight, () => w);
		} catch (err) {
			const missing = err instanceof SourceMissingError;
			w.problem = missing ? err.message : `revive failed: ${err instanceof Error ? err.message : String(err)}`;
			devLog({ ev: "revive-failed", id: w.id, message: w.problem });
			return;
		}
		w.page = page;
		w.pendingBlocked = [];
		const first = page.lastFrame;
		if (first) w.image.send(first.data, w.display.cols, w.display.rows);
		devLog({ ev: "revived", id: w.id, ms: Math.round(performance.now() - t0), warm, imageId: w.image.ids[0], spareId: w.image.ids[1], pages: this.host?.pageCount ?? 0 });
		w.lastUsed = ++useSeq;
		if (this.fullscreen) {
			await this.makeLive(w);
			if (!w.focused) this.armIdle(w);
			// The page loaded and sent its first frame (WidgetPage.open), so the click that revived it can land (RQ03).
			if (replay && !w.closed) {
				devLog({ ev: "replay", id: w.id, x: replay.x, y: replay.y, button: replay.button });
				const base = { x: replay.x, y: replay.y, button: replay.button, clickCount: 1, modifiers: replay.modifiers };
				w.mouse({ ...base, type: "mousePressed", buttons: BUTTON_BITS[replay.button] });
				w.mouse({ ...base, type: "mouseReleased", buttons: 0 });
			}
		} else await this.freeze(w);
	}

	/** Freezes the previous live widget and thaws this one (PD06: at most one live widget). */
	async makeLive(w: Widget): Promise<void> {
		const prev = this.live;
		if (w.closed) return;
		this.live = w;
		w.lastUsed = ++useSeq;
		clearTimeout(w.closeTimer);
		w.closeTimer = undefined;
		if (prev && prev !== w) await this.freeze(prev);
		const page = w.page;
		if (page?.frozen) {
			// A wake also restores the image if the terminal dropped it (RQ13); identical frames are not sent again.
			w.image.resend(w.display.cols, w.display.rows);
			if (devLogging()) {
				const t0 = performance.now();
				page
					.nextFrame(2_000)
					.then(() => devLog({ ev: "thaw-frame", id: w.id, ms: Math.round(performance.now() - t0) }))
					.catch(() => {});
			}
			await page.thaw();
			devLog({ ev: "live", id: w.id });
		}
	}

	async freeze(w: Widget): Promise<void> {
		clearTimeout(w.idleTimer);
		clearTimeout(w.focusTimer);
		w.idleTimer = w.focusTimer = undefined;
		if (this.live === w) this.live = undefined;
		const page = w.page;
		if (!page || page.closed) return;
		if (!w.closeTimer) {
			w.closeTimer = setTimeout(() => {
				w.closeTimer = undefined;
				if (w.frozen && !w.focused) w.run("close-timer", () => this.closePage(w, "frozen-timeout"));
			}, this.timers.closeMs);
			w.closeTimer.unref?.();
		}
		if (page.frozen) return;
		await page.freeze();
		devLog({ ev: "frozen", id: w.id });
	}

	/** Closes a widget's page; the RAM still stays and a click revives it. The browser exits after its last page. */
	async closePage(w: Widget, reason: string): Promise<void> {
		const page = w.page;
		if (!page || page.closed) return;
		if (w.focused) this.releaseFocus(w);
		w.clearTimers();
		if (this.live === w) this.live = undefined;
		await page.close();
		devLog({ ev: "closed", id: w.id, reason, pages: this.host?.pageCount ?? 0, browserPid: this.host?.pid ?? null });
		this.s.tui?.requestRender();
	}

	/** Keeps at most MAX_PAGES - 1 open pages before another opens: the least recently used frozen page closes first. */
	async evict(): Promise<void> {
		for (;;) {
			if (this.openPages < MAX_PAGES) return;
			const open = [...this.widgets.values()].filter((w) => !w.closed && !w.focused && w !== this.live).sort((a, b) => a.lastUsed - b.lastUsed);
			const victim = open.find((w) => w.frozen) ?? open[0];
			if (!victim) return;
			await this.closePage(victim, "lru");
		}
	}

	private armIdle(w: Widget): void {
		clearTimeout(w.idleTimer);
		w.idleTimer = setTimeout(() => {
			w.idleTimer = undefined;
			if (!w.focused) w.run("idle-freeze", () => this.freeze(w));
		}, this.timers.idleMs);
		w.idleTimer.unref?.();
	}

	private armFocus(w: Widget): void {
		clearTimeout(w.focusTimer);
		w.focusTimer = setTimeout(() => {
			w.focusTimer = undefined;
			// Keeps focus: the next key or click wakes the widget again.
			if (w.focused) w.run("focus-freeze", () => this.freeze(w));
		}, this.timers.focusMs);
		w.focusTimer.unref?.();
	}

	/**
	 * Pointer activity over a widget makes it live; the caller then queues the event itself, so a waking press reaches
	 * the page after the thaw. A press always queues the (idempotent) wake so it also follows a pending release freeze.
	 * An unfocused widget gets the idle timer on hover or press; a focused one restarts its 5 min input timer.
	 */
	pointer(w: Widget, kind: "hover" | "press" | "drag" | "wheel"): void {
		if (w.closed) return;
		w.lastUsed = ++useSeq;
		// A first press also restores an image the terminal dropped (RQ13), even on a widget that is still live.
		if (kind === "press" && !w.focused && !w.frozen) w.image.resend(w.display.cols, w.display.rows);
		if (kind === "press" || this.live !== w || w.frozen) w.run("live", () => this.makeLive(w));
		if (w.focused) this.armFocus(w);
		else if (kind === "hover" || kind === "press") this.armIdle(w);
	}

	/** Key input to a focused widget: wakes it after a focused-idle freeze and restarts the input timer. */
	input(w: Widget): void {
		if (w.closed) return;
		w.lastUsed = ++useSeq;
		if (this.live !== w || w.frozen) w.run("live", () => this.makeLive(w));
		if (w.focused) this.armFocus(w);
	}

	/** Called when Pi gives a widget component keyboard focus. */
	focused(w: Widget, component: Component): void {
		if (w.focusedBy === component) return;
		w.focusedBy = component;
		clearTimeout(w.idleTimer);
		w.idleTimer = undefined;
		this.armFocus(w);
		devLog({ ev: "focus", id: w.id });
	}

	/** Called when the widget loses focus (Escape, Ctrl+C, or a click elsewhere): deliver queued data and freeze. */
	blurred(w: Widget): void {
		if (!w.focusedBy) return;
		w.focusedBy = undefined;
		w.buttons = 0;
		clearTimeout(w.focusTimer);
		w.focusTimer = undefined;
		devLog({ ev: "release", id: w.id });
		this.deliver(w, "send", w.page?.drainQueue() ?? []);
		w.run("release-freeze", () => this.freeze(w));
	}

	/** Pi's focused component; `getFocusedComponent` exists on Pi 1.4 renderers but not on the `TUI` interface. */
	focusedComponent(): Component | null {
		const tui = this.s.tui as (TUI & { getFocusedComponent?: () => Component | null }) | undefined;
		return tui?.getFocusedComponent?.() ?? null;
	}

	/** Restores the component that was focused before the widget took focus. */
	releaseFocus(w: Widget): void {
		const prev = w.prevFocus;
		w.prevFocus = null;
		this.s.tui?.setFocus(prev);
		this.s.tui?.requestRender();
	}

	deliver(w: Widget, kind: "send" | "submit", items: unknown[]): void {
		const msg = widgetMessage({ id: w.id, title: w.details.title }, kind, items, kind === "send" ? w.takeBlocked() : []);
		if (!msg) return;
		const options = deliveryOptions(kind, this.s.ctx?.isIdle() ?? true);
		devLog({ ev: "deliver", id: w.id, kind, options, items: items.length, content: msg.content });
		try {
			this.s.pi.sendMessage(msg, options);
		} catch (err) {
			devLog({ ev: "error", id: w.id, what: "deliver", message: err instanceof Error ? err.message : String(err) });
		}
	}

	/**
	 * Called from a widget row's render with the cells it shows (RQ12): a changed size re-sends the still scaled to fit,
	 * and later frames follow at that size.
	 */
	setDisplay(w: Widget, box: CellBox): void {
		if (sameBox(w.display, box)) return;
		w.display = box;
		devLog({ ev: "display", id: w.id, cols: box.cols, rows: box.rows, scale: box.scale });
		setImmediate(() => w.image.resend(box.cols, box.rows));
	}

	/**
	 * Called from component renders: reacts to TUI mode switches (regular mode freezes and releases widgets), re-sends
	 * stills after terminal resizes (RQ13) and, in plain Ghostty, after Pi's full redraws (which delete all kitty images
	 * outside tmux). Re-sends run after the current render was written.
	 */
	observeRender(): void {
		const tui = this.s.tui;
		if (!tui) return;
		this.applyHook();
		const mode = tui.mode;
		if (mode !== this.lastMode) {
			const was = this.lastMode;
			this.lastMode = mode;
			if (was !== undefined && mode !== "fullscreen") {
				setImmediate(() => {
					for (const w of this.widgets.values()) {
						if (w.focused) this.releaseFocus(w);
						w.run("mode-freeze", () => this.freeze(w));
					}
				});
			}
			devLog({ ev: "mode", mode });
		}
		const size = `${tui.terminal.columns}x${tui.terminal.rows}`;
		if (this.lastSize !== undefined && size !== this.lastSize) this.queueResend(`resize ${size}`);
		this.lastSize = size;
		if (!this.s.env.tmux) {
			const redraws = tui.fullRedraws;
			if (this.lastFullRedraws !== undefined && redraws !== this.lastFullRedraws) this.queueResend("full-redraw");
			this.lastFullRedraws = redraws;
		}
	}

	private queueResend(reason: string): void {
		if (this.resendQueued) return;
		this.resendQueued = true;
		setImmediate(() => {
			this.resendQueued = false;
			this.resendAll(reason);
		});
	}

	/**
	 * `check_widget` (RQ05): a fresh capture plus layout probe for an open (live or frozen) page, the RAM still for a
	 * closed widget. Read-only: never revives, thaws, focuses, resizes, or touches the LRU order. Undefined for an
	 * unknown id; `image` is undefined when no image exists.
	 */
	async check(id: string): Promise<{ report: CheckReport; image?: string | undefined } | undefined> {
		const w = this.widgets.get(id);
		if (!w) return undefined;
		const d = w.details;
		const report: CheckReport = { id, title: d.title, state: w.closed ? "closed" : w.frozen ? "frozen" : "live", cols: d.cols, rows: d.rows, cssWidth: d.cssWidth, cssHeight: d.cssHeight };
		let image: string | undefined;
		const page = w.page;
		if (page && !page.closed) {
			try {
				const shot = limitPng(flattenPng(await page.capture(CHECK_MAX_EDGE), DEFAULT_PAGE_BG), CHECK_MAX_EDGE);
				image = shot.data;
				report.image = { source: "fresh capture", width: shot.width, height: shot.height };
			} catch (err) {
				devLog({ ev: "error", id, what: "check-capture", message: err instanceof Error ? err.message : String(err) });
			}
			let probe: LayoutProbe | undefined;
			let probeError: string | undefined;
			try {
				probe = await page.inspect<LayoutProbe>(PROBE_SCRIPT);
			} catch (err) {
				probeError = err instanceof Error ? err.message : String(err);
			}
			report.page = { errors: [...page.errors], blocked: [...page.blocked], probe, probeError };
			// The page may have closed meanwhile; the state then says so and the still below stands in.
			if (page.closed) report.state = "closed";
		}
		if (!image && w.image.still) {
			try {
				const still = limitPng(flattenPng(w.image.still, DEFAULT_PAGE_BG), CHECK_MAX_EDGE);
				image = still.data;
				report.image = { source: "last still", width: still.width, height: still.height };
			} catch (err) {
				devLog({ ev: "error", id, what: "check-still", message: err instanceof Error ? err.message : String(err) });
			}
		}
		if (report.state === "closed") report.page = undefined;
		devLog({ ev: "check", id, state: report.state, source: report.image?.source ?? null, width: report.image?.width ?? null, height: report.image?.height ?? null, issues: report.page?.probe?.total ?? null });
		return { report, image };
	}

	/** Re-sends every retained RAM still at its display size; returns the ids sent. */
	resendAll(reason = "refresh"): string[] {
		const sent: string[] = [];
		for (const w of this.widgets.values()) if (w.image.resend(w.display.cols, w.display.rows)) sent.push(w.id);
		devLog({ ev: "resend", reason, ids: sent });
		return sent;
	}

	async shutdown(): Promise<void> {
		this.hook.remove();
		this.hookLogged = undefined;
		const all = [...this.widgets.values()];
		this.widgets.clear();
		this.live = undefined;
		for (const w of all) {
			w.clearTimers();
			w.focusedBy = undefined;
		}
		await Promise.allSettled(all.map((w) => w.page?.close()));
		await this.host?.close();
		this.host = undefined;
		devLog({ ev: "shutdown", widgets: all.length });
	}
}
