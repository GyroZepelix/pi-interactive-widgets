// Run-time policy unit tests (RQ06 as revised by PD09): fake pages and a fake clock, no browser or terminal.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { Component } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "../src/config.js";
import { KittyImage } from "../src/kitty.js";
import { DEFAULT_TIMERS, IDLE_MS, MAX_PAGES, type SessionState, timersFromEnv, Widget, type WidgetDetails, WidgetManager } from "../src/manager.js";
import type { WidgetPage } from "../src/page.js";

type Log = string[];

function fakePage(id: string, log: Log) {
	let state: "live" | "frozen" | "closed" = "live";
	return {
		id,
		get frozen() {
			return state === "frozen";
		},
		get closed() {
			return state === "closed";
		},
		async freeze() {
			if (state !== "live") return;
			state = "frozen";
			log.push(`${id}:freeze`);
		},
		async thaw() {
			if (state !== "frozen") return;
			state = "live";
			log.push(`${id}:thaw`);
		},
		async mouse(ev: { type: string }) {
			log.push(`${id}:${ev.type}`);
		},
		drainQueue: () => [] as unknown[],
		async close() {
			if (state !== "closed") log.push(`${id}:close`);
			state = "closed";
		},
	};
}

function setup() {
	const log: Log = [];
	const state: SessionState = {
		pi: { sendMessage: () => {} } as unknown as SessionState["pi"],
		env: { kind: "tmux-ghostty", supported: true, tmux: true },
		config: DEFAULT_CONFIG,
		motion: false,
		tui: { mode: "fullscreen", setFocus() {}, requestRender() {} } as unknown as SessionState["tui"],
	};
	const manager = new WidgetManager(state);
	let n = 0;
	const writes: string[] = [];
	const widget = (): Widget => {
		const id = `w${++n}`;
		const details: WidgetDetails = { id, imageId: n, title: id, cols: 10, rows: 2, cssWidth: 80, cssHeight: 34, cssCell: { width: 8, height: 17 }, source: "html" };
		return new Widget(details, fakePage(id, log) as unknown as WidgetPage, new KittyImage(n, { tmux: true }, (d) => writes.push(d)), { html: "<p>x</p>" });
	};
	return { manager, widget, log, state, writes };
}

/** Lets queued widget work (promise chains) run. */
const settle = async (): Promise<void> => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};
const component = {} as Component;

describe("run-time policy (RQ06, PD09)", () => {
	beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
	afterEach(() => mock.timers.reset());

	it("a new widget that is not interacted with freezes 10 s after creation", async () => {
		const { manager, widget, log } = setup();
		const a = widget();
		await manager.start(a);
		mock.timers.tick(IDLE_MS - 1);
		await settle();
		assert.equal(a.frozen, false);
		mock.timers.tick(1);
		await settle();
		assert.equal(a.frozen, true);
		assert.deepEqual(log, ["w1:freeze"]);
	});

	it("a hover-woken widget freezes 10 s after the last hover move", async () => {
		const { manager, widget } = setup();
		const a = widget();
		await manager.start(a);
		mock.timers.tick(IDLE_MS);
		await settle();
		assert.equal(a.frozen, true);
		manager.pointer(a, "hover");
		await settle();
		assert.equal(a.frozen, false, "hover wakes");
		mock.timers.tick(IDLE_MS - 1000);
		manager.pointer(a, "hover");
		mock.timers.tick(IDLE_MS - 1);
		await settle();
		assert.equal(a.frozen, false, "the timer restarts at the last hover move");
		mock.timers.tick(1);
		await settle();
		assert.equal(a.frozen, true);
	});

	it("a press wakes a frozen widget before the press reaches the page", async () => {
		const { manager, widget, log } = setup();
		const a = widget();
		await manager.start(a);
		mock.timers.tick(IDLE_MS);
		await settle();
		log.length = 0;
		manager.pointer(a, "press");
		a.mouse({ type: "mousePressed", x: 1, y: 1 });
		await settle();
		assert.deepEqual(log, ["w1:thaw", "w1:mousePressed"]);
	});

	it("a focused widget has no idle timer, and release freezes it immediately", async () => {
		const { manager, widget } = setup();
		const a = widget();
		await manager.start(a);
		manager.pointer(a, "press");
		manager.focused(a, component);
		mock.timers.tick(IDLE_MS * 3);
		await settle();
		assert.equal(a.frozen, false, "focused widgets do not idle-freeze at 10 s");
		manager.pointer(a, "press");
		mock.timers.tick(IDLE_MS * 3);
		await settle();
		assert.equal(a.frozen, false, "a press on the focused widget arms no idle timer");
		manager.blurred(a);
		await settle();
		assert.equal(a.frozen, true);
	});

	it("a press right after a release wakes the widget again", async () => {
		const { manager, widget, log } = setup();
		const a = widget();
		await manager.start(a);
		manager.focused(a, component);
		manager.blurred(a);
		manager.pointer(a, "press");
		a.mouse({ type: "mousePressed", x: 1, y: 1 });
		await settle();
		assert.deepEqual(log, ["w1:freeze", "w1:thaw", "w1:mousePressed"]);
		assert.equal(a.frozen, false);
	});

	it("making B live freezes A immediately", async () => {
		const { manager, widget } = setup();
		const a = widget();
		const b = widget();
		await manager.start(a);
		await manager.start(b);
		assert.equal(a.frozen, true, "creating B made it live and froze A");
		assert.equal(b.frozen, false);
		manager.pointer(a, "press");
		await settle();
		assert.equal(a.frozen, false);
		assert.equal(b.frozen, true);
	});

	it("in regular mode a new widget starts frozen", async () => {
		const { manager, widget, state } = setup();
		(state.tui as { mode: string }).mode = "regular";
		const a = widget();
		await manager.start(a);
		assert.equal(a.frozen, true);
	});
});

describe("focused timer, close, and LRU (RQ06, RQ07)", () => {
	beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
	afterEach(() => mock.timers.reset());

	it("a focused widget freezes after 5 min without input; input restarts the timer and wakes it again", async () => {
		const { manager, widget } = setup();
		const a = widget();
		await manager.start(a);
		manager.pointer(a, "press");
		manager.focused(a, component);
		mock.timers.tick(DEFAULT_TIMERS.focusMs - 1_000);
		manager.input(a);
		mock.timers.tick(DEFAULT_TIMERS.focusMs - 1);
		await settle();
		assert.equal(a.frozen, false, "a key restarts the 5 min timer");
		mock.timers.tick(1);
		await settle();
		assert.equal(a.frozen, true, "frozen after 5 min without input");
		assert.equal(a.focused, true, "focus is kept");
		manager.input(a);
		await settle();
		assert.equal(a.frozen, false, "the next key wakes it");
		mock.timers.tick(DEFAULT_TIMERS.focusMs - 1);
		manager.pointer(a, "wheel");
		mock.timers.tick(DEFAULT_TIMERS.focusMs - 1);
		await settle();
		assert.equal(a.frozen, false, "mouse input also restarts the timer");
	});

	it("a page frozen for 30 min closes and keeps its still; waking cancels the close", async () => {
		const { manager, widget, log } = setup();
		const a = widget();
		await manager.start(a);
		a.image.send("iVBORfake", 10, 2);
		await manager.freeze(a);
		mock.timers.tick(DEFAULT_TIMERS.closeMs - 1);
		manager.pointer(a, "press");
		await settle();
		assert.equal(a.closed, false);
		mock.timers.tick(DEFAULT_TIMERS.closeMs * 2);
		await settle();
		assert.equal(a.closed, false, "a live widget does not close");
		await manager.freeze(a);
		mock.timers.tick(DEFAULT_TIMERS.closeMs);
		await settle();
		assert.equal(a.closed, true);
		assert.ok(log.includes("w1:close"));
		assert.equal(a.image.retained, true, "the RAM still stays for the row");
	});

	it("keeps at most 5 pages: the least recently used frozen page closes first", async () => {
		const { manager, widget } = setup();
		const ws: Widget[] = [];
		for (let i = 0; i < MAX_PAGES; i++) {
			const w = widget();
			ws.push(w);
			await manager.start(w);
			mock.timers.tick(10);
		}
		manager.pointer(ws[0] as Widget, "press");
		await settle();
		manager.focused(ws[0] as Widget, component);
		manager.blurred(ws[0] as Widget);
		await settle();
		manager.pointer(ws[1] as Widget, "hover");
		await settle();
		assert.equal(manager.openPages, MAX_PAGES);
		await manager.evict();
		assert.equal(manager.openPages, MAX_PAGES - 1, "room for one more page");
		assert.deepEqual(
			ws.map((w) => w.closed),
			[false, false, true, false, false],
			"w3 is the least recently used frozen page (w1 and w2 were used later, w2 is live)",
		);
	});

	it("re-sends retained stills at their display size; setDisplay re-sends scaled", async () => {
		const { manager, widget, writes } = setup();
		const a = widget();
		const b = widget();
		await manager.start(a);
		await manager.start(b);
		a.image.send("iVBORaaa", 10, 2);
		writes.length = 0;
		assert.deepEqual(manager.resendAll(), ["w1"], "only widgets with a still");
		assert.match(writes[0] ?? "", /i=1,c=10,r=2/);
		manager.setDisplay(a, { cols: 5, rows: 1, scale: 0.5 });
		await new Promise((r) => setImmediate(r));
		assert.match(writes.at(-1) ?? "", /i=1,c=5,r=1/);
	});

	it("RQ13: a press restores the image of a live or frozen widget; presses while focused do not re-send", async () => {
		const { manager, widget, writes } = setup();
		const a = widget();
		await manager.start(a);
		a.image.send("iVBORaaa", 10, 2);
		writes.length = 0;
		manager.pointer(a, "press");
		await settle();
		assert.equal(writes.length, 1, "live widget: still re-sent on the first press");
		manager.focused(a, component);
		manager.pointer(a, "press");
		await settle();
		assert.equal(writes.length, 1, "no re-send while focused");
		manager.blurred(a);
		await settle();
		manager.pointer(a, "press");
		await settle();
		assert.equal(writes.length, 2, "frozen widget: the wake re-sends the still");
	});

	it("shutdown clears every timer and closes every page", async () => {
		const { manager, widget, log } = setup();
		const a = widget();
		const b = widget();
		await manager.start(a);
		await manager.start(b);
		await manager.shutdown();
		assert.equal(manager.widgets.size, 0);
		assert.ok(log.includes("w1:close") && log.includes("w2:close"));
		for (const w of [a, b]) assert.deepEqual([w.idleTimer, w.focusTimer, w.closeTimer], [undefined, undefined, undefined]);
	});
});

describe("dev timers (RQ16)", () => {
	it("are shortened only in dev mode", () => {
		assert.deepEqual(timersFromEnv({ PI_WIDGETS_DEV_TIMERS: "idle=1" }), DEFAULT_TIMERS);
		assert.deepEqual(timersFromEnv({ PI_WIDGETS_DEV: "1", PI_WIDGETS_DEV_TIMERS: "idle=1000, focus=3000,close=4000,bogus=5,idle2=x" }), { idleMs: 1000, focusMs: 3000, closeMs: 4000 });
		assert.deepEqual(timersFromEnv({ PI_WIDGETS_DEV: "1", PI_WIDGETS_DEV_TIMERS: "idle=-5,focus=abc" }), DEFAULT_TIMERS);
		assert.equal(IDLE_MS, 10_000);
		assert.equal(DEFAULT_TIMERS.focusMs, 300_000);
		assert.equal(DEFAULT_TIMERS.closeMs, 1_800_000);
	});
});
