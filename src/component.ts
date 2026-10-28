// Inline transcript component: title line plus placeholder grid, mouse and key forwarding, focus and release (RQ02,
// RQ05, RQ11, RQ14). Pi internals this relies on (tool-row `y - 1`, focus restore) stay isolated here and in index.ts.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type Focusable, type TuiMouseEvent, type TuiMouseEventResult, truncateToWidth } from "@earendil-works/pi-tui";
import type { CellSize } from "./env.js";
import { UNSUPPORTED_NOTICE } from "./env.js";
import { placeholderLines } from "./kitty.js";
import { mapKey } from "./keys.js";
import type { WidgetDetails, WidgetManager } from "./manager.js";

/** CSS pixels per wheel line. */
export const WHEEL_PX = 40;

/** Center of a grid cell in CSS pixels, clamped to the page. */
export function cellToCss(gx: number, gy: number, css: CellSize, cols: number, rows: number): { x: number; y: number } {
	const clamp = (v: number, max: number): number => Math.min(max - 0.5, Math.max(0, v));
	return { x: clamp((gx + 0.5) * css.width, cols * css.width), y: clamp((gy + 0.5) * css.height, rows * css.height) };
}

const BUTTON_BITS = { left: 1, right: 2, middle: 4, none: 0 } as const;

/** Row content when the widget cannot render in this terminal (RQ14). */
export function noticeLine(title: string): string {
	return `${UNSUPPORTED_NOTICE} ${title}`;
}

/** Unfocused fullscreen hint: hover wakes widgets only where Pi receives pointer motion (RQ02, PD09). */
export function interactHint(hoverReported: boolean): string {
	return hoverReported ? " · hover or click to interact" : " · click to interact";
}

export type RowDetails = WidgetDetails | { notice: string; title: string };

export class WidgetComponent implements Component, Focusable {
	readonly details: RowDetails;
	private readonly theme: Theme;
	private readonly manager: WidgetManager;
	private hasFocus = false;
	/** Grid columns shown at the last render (narrow terminals crop until 02.02 adds scaling). */
	private shownCols = 0;

	constructor(details: RowDetails, theme: Theme, manager: WidgetManager) {
		this.details = details;
		this.theme = theme;
		this.manager = manager;
	}

	get id(): string | undefined {
		return "id" in this.details ? this.details.id : undefined;
	}

	get focused(): boolean {
		return this.hasFocus;
	}

	set focused(v: boolean) {
		if (v === this.hasFocus) return;
		this.hasFocus = v;
		const w = this.id ? this.manager.get(this.id) : undefined;
		if (!w) return;
		if (v) this.manager.focused(w, this);
		// Pi's setFocus on the already focused component sets false then true synchronously; only a lasting blur releases.
		else queueMicrotask(() => !this.hasFocus && this.manager.blurred(w));
	}

	invalidate(): void {}

	render(width: number): string[] {
		const t = this.theme;
		const d = this.details;
		if ("notice" in d) return [truncateToWidth(t.fg("warning", d.notice), width)];
		this.manager.observeRender();
		const w = this.manager.get(d.id);
		const fit = (s: string): string => truncateToWidth(s, width);
		if (!w) return [fit(`${t.fg("muted", `◇ ${d.title}`)}${t.fg("dim", " · widget not running")}`)];
		const hint = !this.manager.fullscreen
			? " · still image · fullscreen mode needed to interact"
			: this.hasFocus
				? " · keys go to the widget · Esc releases"
				: interactHint(this.manager.hoverReported);
		this.shownCols = Math.max(1, Math.min(d.cols, width));
		return [fit(`${t.fg("accent", `◆ ${d.title}`)}${t.fg(this.hasFocus ? "accent" : "dim", hint)}`), ...placeholderLines(d.imageId, this.shownCols, d.rows)];
	}

	handleMouse(e: TuiMouseEvent): TuiMouseEventResult | undefined {
		const d = this.details;
		if ("notice" in d || !this.manager.fullscreen) return undefined;
		const w = this.manager.get(d.id);
		if (!w) return undefined;
		const gx = e.x;
		const gy = e.y - 1; // line 0 is the title
		const inside = gx >= 0 && gy >= 0 && gx < (this.shownCols || d.cols) && gy < d.rows;
		const p = cellToCss(gx, gy, d.cssCell, d.cols, d.rows);
		const modifiers = (e.alt ? 1 : 0) | (e.ctrl ? 2 : 0) | (e.shift ? 8 : 0);
		switch (e.type) {
			case "move":
				if (!inside) return undefined;
				this.manager.pointer(w, "hover");
				w.mouse({ type: "mouseMoved", x: p.x, y: p.y, buttons: w.buttons, modifiers });
				return { handled: true, render: false };
			case "press": {
				if (!inside) return undefined;
				if (!this.hasFocus) w.prevFocus = this.manager.focusedComponent();
				this.manager.pointer(w, "press");
				const button = e.button === "none" ? "left" : e.button;
				w.buttons |= BUTTON_BITS[button];
				w.mouse({ type: "mousePressed", x: p.x, y: p.y, button, buttons: w.buttons, clickCount: 1, modifiers });
				return { focus: true, capture: true, render: true };
			}
			case "drag":
				this.manager.pointer(w, "drag");
				w.mouse({ type: "mouseMoved", x: p.x, y: p.y, buttons: w.buttons, modifiers });
				return { handled: true, render: false };
			case "release": {
				const button = e.button === "none" ? "left" : e.button;
				w.buttons &= ~BUTTON_BITS[button];
				w.mouse({ type: "mouseReleased", x: p.x, y: p.y, button, buttons: w.buttons, clickCount: 1, modifiers });
				return { handled: true, render: false };
			}
			case "click":
				return inside ? { handled: true, render: false } : undefined;
			case "wheel":
				// Unfocused: let Pi scroll the transcript. Focused: scroll the page.
				if (!inside || !this.hasFocus) return undefined;
				this.manager.pointer(w, "wheel");
				w.wheel({ x: p.x, y: p.y, deltaX: 0, deltaY: (e.wheelDelta ?? 0) * WHEEL_PX, modifiers });
				return { handled: true, render: false };
		}
		return undefined;
	}

	handleInput(data: string): void {
		const w = this.id ? this.manager.get(this.id) : undefined;
		const action = mapKey(data);
		if (!w || action?.kind === "release") {
			if (w) this.manager.releaseFocus(w);
			else this.manager.state.tui?.setFocus(null);
			return;
		}
		if (!action) return;
		if (action.kind === "keys") w.keys(action.events);
		else w.text(action.text);
	}
}
