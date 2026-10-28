import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { cellToCss, interactHint, noticeLine, WHEEL_PX, WidgetComponent } from "../src/component.js";
import { PLACEHOLDER } from "../src/kitty.js";
import type { WidgetDetails, WidgetManager } from "../src/manager.js";
import { widgetSize } from "../src/manager.js";

const details: WidgetDetails = { id: "w1", imageId: 0x123456, title: "grid", cols: 60, rows: 10, cssWidth: 480, cssHeight: 170, cssCell: { width: 8, height: 17 }, source: "html" };
const theme = { fg: (_c: string, t: string) => t } as unknown as Theme;

function setup(fullscreen = true, hoverReported = false) {
	const calls: { what: string; arg?: unknown }[] = [];
	const editor = { render: () => [], invalidate() {} };
	const widget = {
		buttons: 0,
		prevFocus: null as unknown,
		mouse: (ev: unknown) => calls.push({ what: "mouse", arg: ev }),
		wheel: (ev: unknown) => calls.push({ what: "wheel", arg: ev }),
		keys: (ev: unknown) => calls.push({ what: "keys", arg: ev }),
		text: (t: unknown) => calls.push({ what: "text", arg: t }),
	};
	const manager = {
		fullscreen,
		hoverReported,
		state: {},
		get: (id: string) => (id === "w1" ? widget : undefined),
		pointer: (_w: unknown, kind: string) => calls.push({ what: "pointer", arg: kind }),
		focusedComponent: () => editor,
		focused: () => calls.push({ what: "focused" }),
		blurred: () => calls.push({ what: "blurred" }),
		releaseFocus: () => calls.push({ what: "releaseFocus" }),
		observeRender: () => {},
	} as unknown as WidgetManager;
	return { c: new WidgetComponent(details, theme, manager), calls, widget, editor };
}

const ev = (type: TuiMouseEvent["type"], x: number, y: number, extra: Partial<TuiMouseEvent> = {}): TuiMouseEvent => ({
	type,
	button: "left",
	x,
	y,
	screenX: x,
	screenY: y,
	width: 80,
	height: 11,
	shift: false,
	alt: false,
	ctrl: false,
	...extra,
});

describe("mouse mapping", () => {
	it("maps a cell to its center in CSS pixels and clamps to the page", () => {
		assert.deepEqual(cellToCss(0, 0, { width: 8, height: 17 }, 60, 10), { x: 4, y: 8.5 });
		assert.deepEqual(cellToCss(59, 9, { width: 8, height: 17 }, 60, 10), { x: 476, y: 161.5 });
		assert.deepEqual(cellToCss(70, -3, { width: 8, height: 17 }, 60, 10), { x: 479.5, y: 0 });
	});
	it("press focuses and captures; the title line is row 0", () => {
		const { c, calls, widget, editor } = setup();
		c.render(80);
		assert.equal(c.handleMouse(ev("press", 5, 0)), undefined, "title line is not the grid");
		assert.deepEqual(c.handleMouse(ev("press", 5, 3)), { focus: true, capture: true, render: true });
		assert.equal(widget.prevFocus, editor);
		assert.deepEqual(calls.find((x) => x.what === "mouse")?.arg, { type: "mousePressed", x: 44, y: 42.5, button: "left", buttons: 1, clickCount: 1, modifiers: 0 });
		assert.deepEqual(
			calls.slice(0, 2).map((x) => [x.what, x.arg && typeof x.arg === "object" ? "event" : x.arg]),
			[
				["pointer", "press"],
				["mouse", "event"],
			],
			"the press wakes the widget before it is queued for the page",
		);
		assert.deepEqual(c.handleMouse(ev("release", 5, 3)), { handled: true, render: false });
		assert.equal(widget.buttons, 0);
	});
	it("hover makes the widget live where moves are reported; moves outside the grid are ignored", () => {
		const { c, calls } = setup(true, true);
		c.render(80);
		assert.deepEqual(c.handleMouse(ev("move", 1, 1, { button: "none" })), { handled: true, render: false });
		assert.ok(calls.some((x) => x.what === "pointer" && x.arg === "hover"));
		assert.equal(c.handleMouse(ev("move", 61, 1)), undefined);
		assert.equal(c.handleMouse(ev("move", 1, 11)), undefined);
	});
	it("wheel scrolls the transcript when unfocused and the page when focused", () => {
		const { c, calls } = setup();
		c.render(80);
		assert.equal(c.handleMouse(ev("wheel", 3, 3, { wheelDelta: 2 })), undefined);
		c.focused = true;
		assert.deepEqual(c.handleMouse(ev("wheel", 3, 3, { wheelDelta: -2 })), { handled: true, render: false });
		assert.equal((calls.find((x) => x.what === "wheel")?.arg as { deltaY: number }).deltaY, -2 * WHEEL_PX);
	});
	it("does not take mouse input in regular mode", () => {
		const { c } = setup(false);
		c.render(80);
		assert.equal(c.handleMouse(ev("press", 5, 3)), undefined);
	});
	it("forwards keys while focused and releases on Escape", () => {
		const { c, calls } = setup();
		c.handleInput("a");
		c.handleInput("\x1b");
		assert.deepEqual(
			calls.map((x) => x.what),
			["keys", "releaseFocus"],
		);
	});
	it("a refocus of the same component (false then true) does not release", async () => {
		const { c, calls } = setup();
		c.focused = true;
		c.focused = false;
		c.focused = true;
		await Promise.resolve();
		assert.deepEqual(
			calls.map((x) => x.what),
			["focused", "focused"],
		);
		c.focused = false;
		await Promise.resolve();
		assert.equal(calls.at(-1)?.what, "blurred");
	});
});

describe("rendering", () => {
	it("renders a title line and the placeholder grid, cropped to the width", () => {
		const { c } = setup();
		const lines = c.render(40);
		assert.equal(lines.length, 11);
		assert.match(lines[0] ?? "", /grid · click to interact/);
		assert.doesNotMatch(lines[0] ?? "", /hover/);
		assert.equal([...(lines[1] ?? "")].filter((ch) => ch === PLACEHOLDER).length, 40);
	});
	it("chooses the hint with Pi's multiplexer condition", () => {
		assert.equal(interactHint(false), " · click to interact");
		assert.equal(interactHint(true), " · hover or click to interact");
		assert.match(setup(true, true).c.render(120)[0] ?? "", /grid · hover or click to interact/);
		const { c } = setup(true, false);
		c.focused = true;
		assert.match(c.render(120)[0] ?? "", /keys go to the widget · Esc releases/);
	});
	it("shows the regular-mode hint", () => {
		const { c } = setup(false);
		assert.match(c.render(120)[0] ?? "", /still image · fullscreen mode needed to interact/);
	});
	it("shows the unsupported notice with the title", () => {
		assert.equal(noticeLine("chart"), "[widgets need tmux + Ghostty] chart");
		const { calls } = setup();
		const c = new WidgetComponent({ notice: noticeLine("chart"), title: "chart" }, theme, { observeRender() {} } as unknown as WidgetManager);
		assert.deepEqual(c.render(80), ["[widgets need tmux + Ghostty] chart"]);
		assert.equal(calls.length, 0);
	});
});

describe("widget size", () => {
	it("defaults to min(100, width - 4) x 20 and clamps to 1..256", () => {
		assert.deepEqual(widgetSize(undefined, undefined, 200), { cols: 100, rows: 20 });
		assert.deepEqual(widgetSize(undefined, undefined, 80), { cols: 76, rows: 20 });
		assert.deepEqual(widgetSize(300, 0, 80), { cols: 256, rows: 1 });
	});
});
