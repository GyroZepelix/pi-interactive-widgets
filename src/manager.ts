// Widget registry and run-time policy (RQ06 as revised by PD09): one live widget per session (PD06); a press wakes a
// frozen widget and is then delivered to the page; hover wakes only where the terminal reports motion; release freezes
// immediately with pi.send delivery; an unfocused widget freezes 10 s after creation or after the last hover move.
// The focused 5 min timer, LRU, revive, scaling, recovery, and refresh come in 02.02.
import { appendFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, colorToHex, getCellDimensions, type TUI } from "@earendil-works/pi-tui";
import { deliveryOptions, widgetMessage } from "./bridge.js";
import { BrowserHost } from "./browser.js";
import type { WidgetConfig } from "./config.js";
import { type CellSize, cssCellSize, type Environment, tmuxCellSize, tmuxDisplay } from "./env.js";
import { imageIds, KittyImage, MAX_CELLS } from "./kitty.js";
import { type BlockedRequest, type KeyInput, type MouseInput, type WheelInput, WidgetPage, type WidgetSource } from "./page.js";

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

/** Unfocused live widgets freeze this long after creation or the last hover move over them (RQ06, PD09). */
export const IDLE_MS = 10_000;
export const DEFAULT_ROWS = 20;

export interface SessionState {
	pi: ExtensionAPI;
	env: Environment;
	config: WidgetConfig;
	/** The terminal reports pointer motion to Pi (no multiplexer), so hover can wake widgets (PD09). */
	motion: boolean;
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

export class Widget {
	readonly details: WidgetDetails;
	readonly page: WidgetPage;
	readonly image: KittyImage;
	/** Blocked requests seen after the initial load and not yet delivered (capped). */
	pendingBlocked: BlockedRequest[] = [];
	/** Pressed mouse buttons (CDP bitmask) for drags. */
	buttons = 0;
	/** The component that holds keyboard focus, and the one to restore on release. */
	focusedBy: Component | undefined;
	prevFocus: Component | null = null;
	idleTimer: NodeJS.Timeout | undefined;
	private chain: Promise<unknown> = Promise.resolve();

	constructor(details: WidgetDetails, page: WidgetPage, image: KittyImage) {
		this.details = details;
		this.page = page;
		this.image = image;
	}

	get id(): string {
		return this.details.id;
	}

	get focused(): boolean {
		return this.focusedBy !== undefined;
	}

	/** Runs page work in order; failures are logged, never thrown into Pi's input loop. */
	run(what: string, fn: () => Promise<unknown>): void {
		this.chain = this.chain.then(fn).catch((err: unknown) => devLog({ ev: "error", id: this.id, what, message: err instanceof Error ? err.message : String(err) }));
	}

	mouse(ev: MouseInput): void {
		this.run("mouse", () => this.page.mouse(ev));
	}

	wheel(ev: WheelInput): void {
		this.run("wheel", () => this.page.wheel(ev));
	}

	keys(events: KeyInput[]): void {
		this.run("key", async () => {
			for (const e of events) await this.page.key(e);
		});
	}

	text(text: string): void {
		this.run("text", () => this.page.insertText(text));
	}

	blocked(b: BlockedRequest): void {
		if (this.pendingBlocked.length < 100) this.pendingBlocked.push(b);
	}

	takeBlocked(): BlockedRequest[] {
		const out = this.pendingBlocked;
		this.pendingBlocked = [];
		return out;
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
	private readonly s: SessionState;

	constructor(state: SessionState) {
		this.s = state;
	}

	get state(): SessionState {
		return this.s;
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

	private cellSize(): CellSize {
		const fromTmux = this.s.env.tmux ? tmuxCellSize(tmuxDisplay()) : undefined;
		if (fromTmux) return fromTmux;
		const pi = getCellDimensions();
		return { width: pi.widthPx, height: pi.heightPx };
	}

	/** Opens a new widget and resolves after its first frame was uploaded. */
	async create(opts: CreateOptions): Promise<Widget> {
		const dpr = this.s.config.dpr;
		this.host ??= new BrowserHost({ chromePath: this.s.config.chromePath, dpr });
		const css = cssCellSize(this.cellSize(), dpr);
		const { cols, rows } = widgetSize(opts.cols, opts.rows, this.s.tui?.terminal.columns ?? process.stdout.columns ?? 104);
		const image = new KittyImage(imageIds.next(), { tmux: this.s.env.tmux });
		let widget: Widget | undefined;
		const page = await WidgetPage.open(this.host, {
			source: opts.source,
			title: opts.title,
			cssWidth: Math.round(cols * css.width),
			cssHeight: Math.round(rows * css.height),
			policy: this.s.config.network,
			theme: themeVars(this.s.ctx?.ui.theme),
			onFrame: (f) => {
				image.send(f.data, cols, rows);
			},
			onSend: (data) => devLog({ ev: "send", id: widget?.id, data }),
			onSubmit: (data) => {
				devLog({ ev: "submit", id: widget?.id, data });
				if (widget) this.deliver(widget, "submit", [data]);
			},
			onBlocked: (b) => {
				widget?.blocked(b);
				devLog({ ev: "blocked", id: widget?.id, ...b });
			},
			onError: (message) => devLog({ ev: "jserror", id: widget?.id, message }),
		});
		const details: WidgetDetails = {
			id: page.id,
			imageId: image.id,
			title: opts.title,
			cols,
			rows,
			cssWidth: Math.round(cols * css.width),
			cssHeight: Math.round(rows * css.height),
			cssCell: css,
			source: "html" in opts.source ? "html" : "path",
			path: "path" in opts.source ? opts.source.path : undefined,
		};
		widget = new Widget(details, page, image);
		await this.start(widget);
		return widget;
	}

	/** Registers a new widget: live with the 10 s idle timer from creation in fullscreen, frozen otherwise. */
	async start(w: Widget): Promise<void> {
		this.widgets.set(w.id, w);
		devLog({ ev: "widget", ...w.details });
		if (this.fullscreen) {
			await this.makeLive(w);
			this.armIdle(w);
		} else {
			await this.freeze(w);
		}
	}

	/** Freezes the previous live widget and thaws this one (PD06: at most one live widget). */
	async makeLive(w: Widget): Promise<void> {
		const prev = this.live;
		this.live = w;
		if (prev && prev !== w) await this.freeze(prev);
		if (w.page.frozen) {
			if (devLogging()) {
				const t0 = performance.now();
				w.page
					.nextFrame(2_000)
					.then(() => devLog({ ev: "thaw-frame", id: w.id, ms: Math.round(performance.now() - t0) }))
					.catch(() => {});
			}
			await w.page.thaw();
			devLog({ ev: "live", id: w.id });
		}
	}

	async freeze(w: Widget): Promise<void> {
		clearTimeout(w.idleTimer);
		w.idleTimer = undefined;
		if (this.live === w) this.live = undefined;
		if (w.page.closed || w.page.frozen) return;
		await w.page.freeze();
		devLog({ ev: "frozen", id: w.id });
	}

	private armIdle(w: Widget): void {
		clearTimeout(w.idleTimer);
		w.idleTimer = setTimeout(() => {
			w.idleTimer = undefined;
			if (!w.focused) w.run("idle-freeze", () => this.freeze(w));
		}, IDLE_MS);
		w.idleTimer.unref?.();
	}

	/**
	 * Pointer activity over a widget makes it live; the caller then queues the event itself, so a waking press reaches
	 * the page after the thaw. A press always queues the (idempotent) wake so it also follows a pending release freeze.
	 * Only an unfocused widget gets the 10 s idle timer; a press focuses it, which clears the timer again.
	 */
	pointer(w: Widget, kind: "hover" | "press" | "drag" | "wheel"): void {
		if (kind === "press" || this.live !== w || w.page.frozen) w.run("live", () => this.makeLive(w));
		if (!w.focused && (kind === "hover" || kind === "press")) this.armIdle(w);
	}

	/** Called when Pi gives a widget component keyboard focus. */
	focused(w: Widget, component: Component): void {
		if (w.focusedBy === component) return;
		w.focusedBy = component;
		clearTimeout(w.idleTimer);
		w.idleTimer = undefined;
		devLog({ ev: "focus", id: w.id });
	}

	/** Called when the widget loses focus (Escape, Ctrl+C, or a click elsewhere): deliver queued data and freeze. */
	blurred(w: Widget): void {
		if (!w.focusedBy) return;
		w.focusedBy = undefined;
		w.buttons = 0;
		devLog({ ev: "release", id: w.id });
		this.deliver(w, "send", w.page.drainQueue());
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
	 * Called from component renders: reacts to TUI mode switches (regular mode freezes and releases widgets) and, in
	 * plain Ghostty, re-sends stills after Pi's full redraws (which delete all kitty images outside tmux).
	 */
	observeRender(): void {
		const tui = this.s.tui;
		if (!tui) return;
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
		if (!this.s.env.tmux) {
			const redraws = tui.fullRedraws;
			if (this.lastFullRedraws !== undefined && redraws !== this.lastFullRedraws) setImmediate(() => this.resendAll());
			this.lastFullRedraws = redraws;
		}
	}

	resendAll(): void {
		for (const w of this.widgets.values()) w.image.resend(w.details.cols, w.details.rows);
	}

	async shutdown(): Promise<void> {
		const all = [...this.widgets.values()];
		this.widgets.clear();
		this.live = undefined;
		for (const w of all) clearTimeout(w.idleTimer);
		await Promise.allSettled(all.map((w) => w.page.close()));
		await this.host?.close();
		this.host = undefined;
	}
}
