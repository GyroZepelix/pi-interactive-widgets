// Run-time policy unit tests (RQ06 as revised by PD09): fake pages and a fake clock, no browser or terminal.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { Component } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "../src/config.js";
import { KittyImage } from "../src/kitty.js";
import { IDLE_MS, type SessionState, Widget, type WidgetDetails, WidgetManager } from "../src/manager.js";
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
	const widget = (): Widget => {
		const id = `w${++n}`;
		const details: WidgetDetails = { id, imageId: n, title: id, cols: 10, rows: 2, cssWidth: 80, cssHeight: 34, cssCell: { width: 8, height: 17 }, source: "html" };
		return new Widget(details, fakePage(id, log) as unknown as WidgetPage, new KittyImage(n, { tmux: true }, () => {}));
	};
	return { manager, widget, log, state };
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
		assert.equal(a.page.frozen, false);
		mock.timers.tick(1);
		await settle();
		assert.equal(a.page.frozen, true);
		assert.deepEqual(log, ["w1:freeze"]);
	});

	it("a hover-woken widget freezes 10 s after the last hover move", async () => {
		const { manager, widget } = setup();
		const a = widget();
		await manager.start(a);
		mock.timers.tick(IDLE_MS);
		await settle();
		assert.equal(a.page.frozen, true);
		manager.pointer(a, "hover");
		await settle();
		assert.equal(a.page.frozen, false, "hover wakes");
		mock.timers.tick(IDLE_MS - 1000);
		manager.pointer(a, "hover");
		mock.timers.tick(IDLE_MS - 1);
		await settle();
		assert.equal(a.page.frozen, false, "the timer restarts at the last hover move");
		mock.timers.tick(1);
		await settle();
		assert.equal(a.page.frozen, true);
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
		assert.equal(a.page.frozen, false, "focused widgets do not idle-freeze at 10 s");
		manager.pointer(a, "press");
		mock.timers.tick(IDLE_MS * 3);
		await settle();
		assert.equal(a.page.frozen, false, "a press on the focused widget arms no idle timer");
		manager.blurred(a);
		await settle();
		assert.equal(a.page.frozen, true);
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
		assert.equal(a.page.frozen, false);
	});

	it("making B live freezes A immediately", async () => {
		const { manager, widget } = setup();
		const a = widget();
		const b = widget();
		await manager.start(a);
		await manager.start(b);
		assert.equal(a.page.frozen, true, "creating B made it live and froze A");
		assert.equal(b.page.frozen, false);
		manager.pointer(a, "press");
		await settle();
		assert.equal(a.page.frozen, false);
		assert.equal(b.page.frozen, true);
	});

	it("in regular mode a new widget starts frozen", async () => {
		const { manager, widget, state } = setup();
		(state.tui as { mode: string }).mode = "regular";
		const a = widget();
		await manager.start(a);
		assert.equal(a.page.frozen, true);
	});
});
