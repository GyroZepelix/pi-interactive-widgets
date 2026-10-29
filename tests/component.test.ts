import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { cellToCss, interactHint, maxGridCols, noticeLine, WHEEL_PX, WidgetComponent } from "../src/component.js";
import { PLACEHOLDER, placeholderLines } from "../src/kitty.js";
import type { WidgetDetails, WidgetManager } from "../src/manager.js";
import { widgetSize } from "../src/manager.js";

const details: WidgetDetails = { id: "w1", imageId: 0x123456, title: "grid", cols: 60, rows: 10, cssWidth: 480, cssHeight: 170, cssCell: { width: 8, height: 17 }, source: "html" };
const theme = { fg: (_c: string, t: string) => t } as unknown as Theme;

function setup(fullscreen = true, hoverReported = false, rawInputHooked = true) {
	const calls: { what: string; arg?: unknown }[] = [];
	const viewportTop = { value: 0 };
	const editor = { render: () => [], invalidate() {} };
	const widget = {
		buttons: 0,
		prevFocus: null as unknown,
		closed: false,
		reviving: undefined as unknown,
		problem: undefined as string | undefined,
		image: { id: 0x123456, retained: true, lines: (cols: number, rows: number) => placeholderLines(0x123456, cols, rows) },
		mouse: (ev: unknown) => calls.push({ what: "mouse", arg: ev }),
		wheel: (ev: unknown) => calls.push({ what: "wheel", arg: ev }),
		keys: (ev: unknown) => calls.push({ what: "keys", arg: ev }),
		text: (t: unknown) => calls.push({ what: "text", arg: t }),
	};
	const manager = {
		fullscreen,
		hoverReported,
		rawInputHooked,
		viewportTop: () => viewportTop.value,
		pressSeen: (_w: unknown, inRows: boolean) => calls.push({ what: "pressSeen", arg: inRows }),
		focusTarget: () => editor,
		state: {},
		get: (id: string) => (id === "w1" ? widget : undefined),
		pointer: (_w: unknown, kind: string) => calls.push({ what: "pointer", arg: kind }),
		input: () => calls.push({ what: "input" }),
		setDisplay: (_w: unknown, box: unknown) => calls.push({ what: "display", arg: box }),
		revive: (d: { id: string }, source: unknown, replay: unknown) => calls.push({ what: "revive", arg: { id: d.id, source, ...(replay ? { replay } : {}) } }),
		focusedComponent: () => editor,
		focused: () => calls.push({ what: "focused" }),
		blurred: () => calls.push({ what: "blurred" }),
		releaseFocus: () => calls.push({ what: "releaseFocus" }),
		observeRender: () => {},
	} as unknown as WidgetManager;
	return { c: new WidgetComponent(details, theme, manager), calls, widget, editor, viewportTop };
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
	it("RQ12: maps scaled cells back to page pixels (width exact, centered vertically)", () => {
		const css = { width: 8, height: 17 };
		const box = { cols: 30, rows: 5, scale: 0.5 };
		assert.deepEqual(cellToCss(0, 0, css, 60, 10, box), { x: 8, y: 17 });
		assert.deepEqual(cellToCss(29, 4, css, 60, 10, box), { x: 472, y: 153 });
		const odd = { cols: 40, rows: 7, scale: 40 / 60 }; // 10 rows shown in 6.67 cells, centered in 7
		const p = cellToCss(20, 3, css, 60, 10, odd);
		assert.ok(Math.abs(p.x - 246) < 1e-9);
		assert.ok(Math.abs(p.y - 85) < 1e-9, "the middle shown row maps to the page middle");
	});
	it("press focuses and captures; the title line is row 0", () => {
		const { c, calls, widget, editor } = setup();
		c.render(80);
		assert.equal(c.handleMouse(ev("press", 5, 0)), undefined, "title line is not the grid");
		assert.deepEqual(c.handleMouse(ev("press", 5, 3)), { focus: true, capture: true, render: true });
		assert.equal(widget.prevFocus, editor);
		assert.deepEqual(calls.find((x) => x.what === "mouse")?.arg, { type: "mousePressed", x: 44, y: 42.5, button: "left", buttons: 1, clickCount: 1, modifiers: 0 });
		assert.deepEqual(
			calls.filter((x) => x.what !== "display" && x.what !== "pressSeen").slice(0, 2).map((x) => [x.what, x.arg && typeof x.arg === "object" ? "event" : x.arg]),
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
	it("RQ02: reports every press on the row's lines to the manager, inside or outside the grid", () => {
		const { c, calls } = setup();
		c.render(80);
		c.handleMouse(ev("press", 70, 0));
		c.handleMouse(ev("press", 5, 3));
		c.handleMouse(ev("press", 5, 30));
		assert.deepEqual(
			calls.filter((x) => x.what === "pressSeen").map((x) => x.arg),
			[true, true, false],
		);
	});
	it("RQ01: maps screen cells to CSS points from the last dispatched event, following transcript scrolling", () => {
		const { c, viewportTop } = setup();
		c.render(80);
		assert.equal(c.cssAtScreen(5, 3), undefined, "no position before Pi dispatched an event here");
		c.handleMouse(ev("release", 5, 3, { screenX: 7, screenY: 13 })); // row origin at screen (2, 10)
		assert.deepEqual(c.cssAtScreen(7, 13), { x: 44, y: 42.5 });
		assert.equal(c.cssAtScreen(7, 10), undefined, "title line");
		assert.equal(c.cssAtScreen(63, 13), undefined, "right of the grid");
		viewportTop.value = 4; // the transcript scrolled down by 4 lines: the row moved up
		assert.deepEqual(c.cssAtScreen(7, 9), { x: 44, y: 42.5 });
	});
	it("fallback without the raw input hook: trackpad presses (right, none) never focus, press, or revive an unfocused widget", () => {
		const { c, calls, widget } = setup(true, false, false);
		c.render(80);
		assert.equal(c.handleMouse(ev("press", 5, 3, { button: "right" })), undefined);
		assert.equal(c.handleMouse(ev("press", 5, 3, { button: "none" })), undefined);
		assert.equal(calls.some((x) => x.what === "pointer" || x.what === "mouse"), false);
		widget.closed = true;
		c.render(80);
		assert.equal(c.handleMouse(ev("press", 5, 3, { button: "none" })), undefined);
		assert.equal(calls.some((x) => x.what === "revive"), false);
		widget.closed = false;
		assert.deepEqual(c.handleMouse(ev("press", 5, 3)), { focus: true, capture: true, render: true }, "a left click still works");
		c.focused = true;
		assert.deepEqual(c.handleMouse(ev("press", 5, 3, { button: "right" })), { focus: true, capture: true, render: true }, "a focused widget gets right presses");
	});
	it("with the hook installed a right press still focuses (codes 66 and 67 never get here)", () => {
		const { c } = setup();
		c.render(80);
		assert.deepEqual(c.handleMouse(ev("press", 5, 3, { button: "right" })), { focus: true, capture: true, render: true });
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
			["input", "keys", "releaseFocus"],
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
	it("renders a title line and the full placeholder grid when it fits", () => {
		const { c, calls } = setup();
		const lines = c.render(80);
		assert.equal(lines.length, 11);
		assert.match(lines[0] ?? "", /grid · click to interact/);
		assert.doesNotMatch(lines[0] ?? "", /hover/);
		assert.equal([...(lines[1] ?? "")].filter((ch) => ch === PLACEHOLDER).length, 60);
		assert.deepEqual(calls.find((x) => x.what === "display")?.arg, { cols: 60, rows: 10, scale: 1 });
	});
	it("RQ12: a narrow terminal shows the widget scaled to fit and widening restores full size", () => {
		const { c, calls } = setup();
		const narrow = c.render(41);
		assert.equal(narrow.length, 1 + 7, "60x10 at 41 columns shows 40x7 cells");
		assert.equal([...(narrow[1] ?? "")].filter((ch) => ch === PLACEHOLDER).length, 40);
		assert.deepEqual(calls.at(-1)?.arg, { cols: 40, rows: 7, scale: 40 / 60 });
		const wide = c.render(100);
		assert.equal(wide.length, 11);
		assert.deepEqual(calls.at(-1)?.arg, { cols: 60, rows: 10, scale: 1 });
	});
	it("RQ12: the grid never uses the last terminal column (tmux drops diacritics there)", () => {
		assert.equal(maxGridCols(45), 44);
		assert.equal(maxGridCols(1), 1);
		const { c, calls } = setup();
		for (const width of [45, 60, 61]) {
			const lines = c.render(width);
			const cells = [...(lines[1] ?? "")].filter((ch) => ch === PLACEHOLDER).length;
			assert.ok(cells <= width - 1, `${cells} grid cells in a ${width}-column row`);
		}
		assert.deepEqual(calls.filter((x) => x.what === "display").at(-1)?.arg, { cols: 60, rows: 10, scale: 1 }, "61 columns fit the 60-column widget at full size");
		assert.equal((calls.filter((x) => x.what === "display").at(-2)?.arg as { cols: number }).cols, 59, "60 columns scale it to 59");
	});
	it("RQ07: a closed widget shows its still with a reopen hint and revives on a click instead of focusing", () => {
		const { c, calls, widget } = setup();
		widget.closed = true;
		const lines = c.render(80);
		assert.match(lines[0] ?? "", /◇ grid · closed · click to reopen/);
		assert.equal(lines.length, 11, "the RAM still stays shown");
		assert.deepEqual(c.handleMouse(ev("press", 5, 3)), { handled: true, render: true });
		assert.deepEqual(
			calls.filter((x) => x.what === "revive").map((x) => x.arg),
			[{ id: "w1", source: undefined, replay: { x: 44, y: 42.5, button: "left", modifiers: 0 } }],
			"RQ03: a click on the shown still is replayed at the same CSS point after the revive",
		);
		calls.length = 0;
		assert.deepEqual(c.handleMouse(ev("press", 5, 0)), { handled: true, render: true });
		assert.deepEqual(calls.filter((x) => x.what === "revive").map((x) => x.arg), [{ id: "w1", source: undefined }], "a click on the title line revives without a replay");
		assert.equal(calls.some((x) => x.what === "mouse" || x.what === "pointer"), false, "nothing reaches a closed page");
		widget.problem = "source file missing: /tmp/x.html";
		const failed = c.render(80);
		assert.match(failed[0] ?? "", /grid · not running · click to retry/);
		assert.equal(failed[1], "source file missing: /tmp/x.html");
		assert.equal(failed.length, 12, "with the still");
	});
	it("RQ07: a row from an earlier process shows one placeholder line until clicked", () => {
		const { calls } = setup();
		const manager = {
			fullscreen: true,
			get: () => undefined,
			observeRender() {},
			rawInputHooked: true,
			viewportTop: () => 0,
			revive: (d: { id: string }, source: unknown, replay: unknown) => calls.push({ what: "revive", arg: { id: d.id, source, ...(replay ? { replay } : {}) } }),
		} as unknown as WidgetManager;
		const c = new WidgetComponent(details, theme, manager, { html: "<p>x</p>" });
		assert.deepEqual(c.render(80), ["◇ grid · click to load"]);
		assert.equal(c.handleMouse(ev("press", 3, 1)), undefined, "only the row's line");
		assert.deepEqual(c.handleMouse(ev("press", 3, 0)), { handled: true, render: true });
		assert.deepEqual(calls.at(-1)?.arg, { id: "w1", source: { html: "<p>x</p>" } }, "RQ03 as amended: no replay without a shown grid");
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
