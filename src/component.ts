// Inline transcript component: title line plus placeholder grid, mouse and key forwarding, focus and release, scaled
// display in narrow terminals, and click-to-revive rows (RQ02, RQ05, RQ07, RQ11, RQ12, RQ14). Pi internals this relies
// on (tool-row `y - 1`, focus restore) stay isolated here and in index.ts.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type Focusable, type TuiMouseEvent, type TuiMouseEventResult, truncateToWidth } from "@earendil-works/pi-tui";
import type { CellSize } from "./env.js";
import { UNSUPPORTED_NOTICE } from "./env.js";
import { type CellBox, fitCells } from "./kitty.js";
import { mapKey } from "./keys.js";
import type { ImageDetails, WidgetDetails, WidgetManager } from "./manager.js";
import type { WidgetSource } from "./page.js";

/** CSS pixels per wheel line. */
export const WHEEL_PX = 40;

/**
 * Center of a shown grid cell in CSS pixels, clamped to the page. A scaled display (RQ12) fills the width exactly and
 * is centered vertically in its rows, so the mapping divides by the scale after removing that vertical offset.
 */
export function cellToCss(gx: number, gy: number, css: CellSize, cols: number, rows: number, box: CellBox = { cols, rows, scale: 1 }): { x: number; y: number } {
	const clamp = (v: number, max: number): number => Math.min(max - 0.5, Math.max(0, v));
	const offY = (box.rows - rows * box.scale) / 2;
	return { x: clamp(((gx + 0.5) / box.scale) * css.width, cols * css.width), y: clamp(((gy + 0.5 - offY) / box.scale) * css.height, rows * css.height) };
}

export const BUTTON_BITS = { left: 1, right: 2, middle: 4, none: 0 } as const;

/**
 * Widest grid a row of `width` cells shows: one column less than the width. A placeholder written into the last
 * terminal column loses its diacritics under tmux (they attach to the cell before it in the pending-wrap state), so
 * Ghostty cannot place that cell and the right edge of every image row but the first stays blank.
 */
export function maxGridCols(width: number): number {
	return Math.max(1, width - 1);
}

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
	/** Revive source for rows from an earlier process: inline HTML from the tool arguments, or the entry file. */
	private readonly source: WidgetSource | undefined;
	private hasFocus = false;
	/** Cells shown at the last render (scaled to fit narrow terminals). */
	private box: CellBox | undefined;
	/** Lines returned by the last render. */
	private lines = 0;
	/**
	 * Where Pi last placed this row, from the last mouse event it dispatched here: column 0 and the title line in
	 * transcript coordinates (screen row plus the viewport top), so later transcript scrolling is accounted for.
	 */
	private anchor: { x: number; docY: number } | undefined;

	constructor(details: RowDetails, theme: Theme, manager: WidgetManager, source?: WidgetSource) {
		this.details = details;
		this.theme = theme;
		this.manager = manager;
		this.source = source;
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
		const lines = this.renderLines(width);
		this.lines = lines.length;
		return lines;
	}

	private renderLines(width: number): string[] {
		const t = this.theme;
		const d = this.details;
		if ("notice" in d) return [truncateToWidth(t.fg("warning", d.notice), width)];
		this.manager.observeRender();
		const w = this.manager.get(d.id);
		const fit = (s: string): string => truncateToWidth(s, width);
		const fs = this.manager.fullscreen;
		// A row from an earlier process (restart, resume, reload): one placeholder line until clicked (RQ07).
		if (!w) return [fit(`${t.fg("muted", `◇ ${d.title}`)}${t.fg("dim", fs ? " · click to load" : " · not loaded · fullscreen mode needed to interact")}`)];
		const hint = w.problem
			? " · not running · click to retry"
			: w.reviving
				? " · reopening..."
				: !fs
					? " · still image · fullscreen mode needed to interact"
					: w.closed
						? " · closed · click to reopen"
						: this.hasFocus
							? " · keys go to the widget · Esc releases"
							: interactHint(this.manager.hoverReported);
		const head = [fit(`${t.fg(w.closed ? "muted" : "accent", `${w.closed ? "◇" : "◆"} ${d.title}`)}${t.fg(this.hasFocus ? "accent" : "dim", hint)}`)];
		// The problem gets its own line so a long title cannot hide it, for example `source file missing: <path>`.
		if (w.problem) head.push(fit(t.fg("warning", w.problem)));
		if (w.closed && !w.image.retained) {
			this.box = undefined;
			return head;
		}
		const box = fitCells(d.cols, d.rows, maxGridCols(width));
		this.box = box;
		this.manager.setDisplay(w, box);
		// The rows carry the id of the newest upload; switching ids is the double-buffer swap (RQ04).
		return [...head, ...w.image.lines(box.cols, box.rows)];
	}

	/**
	 * CSS point of a screen cell on this row's grid (RQ01 horizontal wheel from the raw input hook), or undefined when the
	 * cell is outside the grid or Pi has not dispatched a mouse event to this row yet.
	 */
	cssAtScreen(screenX: number, screenY: number): { x: number; y: number } | undefined {
		const d = this.details;
		const box = this.box;
		const a = this.anchor;
		if ("notice" in d || !box || !a) return undefined;
		const gx = screenX - a.x;
		const gy = screenY - (a.docY - this.manager.viewportTop()) - 1;
		if (gx < 0 || gy < 0 || gx >= box.cols || gy >= box.rows) return undefined;
		return cellToCss(gx, gy, d.cssCell, d.cols, d.rows, box);
	}

	handleMouse(e: TuiMouseEvent): TuiMouseEventResult | undefined {
		const d = this.details;
		if ("notice" in d || !this.manager.fullscreen) return undefined;
		this.anchor = { x: e.screenX - e.x, docY: e.screenY - e.y + this.manager.viewportTop() };
		const w = this.manager.get(d.id);
		const box = this.box;
		const gx = e.x;
		const gy = e.y - 1; // line 0 is the title
		const inRows = e.y >= 0 && e.y < Math.max(1, this.lines);
		// RQ02: a press on this row's lines is not a click outside the focused widget.
		if (e.type === "press" && w) this.manager.pressSeen(w, inRows);
		// Fallback without the raw input hook (RQ01): Pi reports trackpad scrolling (horizontal wheel codes 66 and 67) as
		// presses with button `right` or `none`; they never focus, press, or revive an unfocused widget.
		if (e.type === "press" && !this.hasFocus && !this.manager.rawInputHooked && (e.button === "right" || e.button === "none")) return undefined;
		const inside = box !== undefined && gx >= 0 && gy >= 0 && gx < box.cols && gy < box.rows;
		const p = box ? cellToCss(gx, gy, d.cssCell, d.cols, d.rows, box) : { x: 0, y: 0 };
		const modifiers = (e.alt ? 1 : 0) | (e.ctrl ? 2 : 0) | (e.shift ? 8 : 0);
		if (!w || w.closed || !box) {
			// Not running (closed, or from an earlier process): a click on the row revives it with fresh JS state. A click on
			// a shown grid (a closed widget's still) is replayed on the revived page after it loaded (RQ03).
			if (e.type !== "press" || !inRows) return undefined;
			const button = e.button === "none" ? "left" : e.button;
			void this.manager.revive(d, this.source, w && box && inside ? { x: p.x, y: p.y, button, modifiers } : undefined);
			return { handled: true, render: true };
		}
		switch (e.type) {
			case "move":
				if (!inside) return undefined;
				this.manager.pointer(w, "hover");
				w.mouse({ type: "mouseMoved", x: p.x, y: p.y, buttons: w.buttons, modifiers });
				return { handled: true, render: false };
			case "press": {
				if (!inside) return undefined;
				if (!this.hasFocus) w.prevFocus = this.manager.focusTarget();
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
		this.manager.input(w);
		if (action.kind === "keys") w.keys(action.events);
		else w.text(action.text);
	}
}

export type ImageRowDetails = ImageDetails | { notice: string; title: string };

/**
 * show_image row: title line plus the placeholder grid of a static still, scaled to fit narrow panes like widgets. A
 * dropped still or a row from an earlier process shows one "click to load" line; a click loads it again with the same
 * checks, and a click on a shown image only re-sends it (no focus).
 */
export class ImageComponent implements Component {
	readonly details: ImageRowDetails;
	private readonly theme: Theme;
	private readonly manager: WidgetManager;
	private lines = 0;

	constructor(details: ImageRowDetails, theme: Theme, manager: WidgetManager) {
		this.details = details;
		this.theme = theme;
		this.manager = manager;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const lines = this.renderLines(width);
		this.lines = lines.length;
		return lines;
	}

	private renderLines(width: number): string[] {
		const t = this.theme;
		const d = this.details;
		if ("notice" in d) return [truncateToWidth(t.fg("warning", d.notice), width)];
		this.manager.observeRender();
		const fit = (s: string): string => truncateToWidth(s, width);
		const img = this.manager.getImage(d.id);
		if (!img || !img.image.retained) {
			const hint = img?.loading ? " · loading..." : img?.problem ? " · click to retry" : this.manager.fullscreen ? " · click to load" : " · not loaded · fullscreen mode needed to load";
			const out = [fit(`${t.fg("muted", `◇ ${d.title}`)}${t.fg("dim", hint)}`)];
			if (img?.problem && !img.loading) out.push(fit(t.fg("warning", img.problem)));
			return out;
		}
		const box = fitCells(img.cols, img.rows, maxGridCols(width));
		this.manager.setImageDisplay(img, box);
		return [fit(t.fg("accent", `◆ ${d.title}`)), ...img.image.lines(box.cols, box.rows)];
	}

	handleMouse(e: TuiMouseEvent): TuiMouseEventResult | undefined {
		const d = this.details;
		if ("notice" in d || !this.manager.fullscreen) return undefined;
		const inRows = e.y >= 0 && e.y < Math.max(1, this.lines);
		if (!inRows) return undefined;
		if (e.type === "click") return { handled: true, render: false };
		if (e.type !== "press") return undefined;
		// Without the raw input hook, trackpad sideways scrolling arrives as presses with button right or none.
		if (!this.manager.rawInputHooked && (e.button === "right" || e.button === "none")) return undefined;
		const img = this.manager.getImage(d.id);
		if (img?.image.retained) {
			this.manager.resendImage(img);
			return { handled: true, render: false };
		}
		void this.manager.reloadImage(d);
		return { handled: true, render: true };
	}
}
