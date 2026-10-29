// Raw input hook (RQ01, RQ02, AC02a): SGR classification, the feature check, front-of-Set ordering, re-apply after a
// TUI change, removal on shutdown, horizontal wheel routing, outside-press release, and the fallback without the hook.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Component } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "../src/config.js";
import { WHEEL_PX } from "../src/component.js";
import { KittyImage } from "../src/kitty.js";
import { type SessionState, Widget, type WidgetDetails, WidgetManager } from "../src/manager.js";
import type { WidgetPage } from "../src/page.js";
import { cdpModifiers, horizontalWheel, installFirst, isPress, listenerSet, parseSgr, RawInputHook, type RawInputListener } from "../src/rawinput.js";

const sgr = (code: number, x: number, y: number, release = false): string => `\x1b[<${code};${x + 1};${y + 1}${release ? "m" : "M"}`;
/** Every subset of the SGR modifier bits (shift 4, alt 8, ctrl 16). */
const MODS = [0, 4, 8, 12, 16, 20, 24, 28];

describe("SGR classification", () => {
	it("parses complete SGR mouse sequences only, with 0-based cells", () => {
		assert.deepEqual(parseSgr("\x1b[<0;10;5M"), { code: 0, x: 9, y: 4, release: false });
		assert.deepEqual(parseSgr("\x1b[<66;1;1m"), { code: 66, x: 0, y: 0, release: true });
		for (const bad of ["a", "\x1b[<0;10;5", "\x1b[<0;10M", "\x1b[M !!", "\x1b[<0;10;5M\x1b[<0;10;5m", "x\x1b[<0;10;5M"]) assert.equal(parseSgr(bad), undefined, JSON.stringify(bad));
	});
	it("classifies horizontal wheel codes 66 and 67 with every modifier combination", () => {
		for (const m of MODS) {
			assert.equal(horizontalWheel(66 + m), -1, `66+${m}`);
			assert.equal(horizontalWheel(67 + m), 1, `67+${m}`);
			for (const other of [0, 1, 2, 3, 32, 35, 64, 65, 96, 98, 99, 128, 130]) assert.equal(horizontalWheel(other + m), 0, `${other}+${m}`);
		}
	});
	it("a press has neither motion nor wheel bits and the final M", () => {
		assert.equal(isPress({ code: 0, x: 0, y: 0, release: false }), true);
		assert.equal(isPress({ code: 2 + 16, x: 0, y: 0, release: false }), true);
		assert.equal(isPress({ code: 0, x: 0, y: 0, release: true }), false);
		assert.equal(isPress({ code: 32, x: 0, y: 0, release: false }), false);
		assert.equal(isPress({ code: 64, x: 0, y: 0, release: false }), false);
	});
	it("maps SGR modifier bits to CDP modifiers", () => {
		assert.equal(cdpModifiers(66), 0);
		assert.equal(cdpModifiers(66 + 4), 8, "shift");
		assert.equal(cdpModifiers(66 + 8), 1, "alt");
		assert.equal(cdpModifiers(66 + 16), 2, "ctrl");
		assert.equal(cdpModifiers(67 + 28), 11);
	});
});

describe("raw input hook installation", () => {
	const a: RawInputListener = () => undefined;
	const b: RawInputListener = () => undefined;

	it("feature check: the TUI must expose inputListeners as a Set", () => {
		assert.equal(listenerSet(undefined), undefined);
		assert.equal(listenerSet({}), undefined);
		assert.equal(listenerSet({ inputListeners: [a] }), undefined);
		assert.equal(listenerSet({ inputListeners: new Map() }), undefined);
		const set = new Set([a]);
		assert.equal(listenerSet({ inputListeners: set }), set);
		const throwing = {
			get inputListeners(): never {
				throw new Error("private");
			},
		};
		assert.equal(listenerSet(throwing), undefined);
	});
	it("installs first and keeps the others in their original order, in place", () => {
		const set = new Set<RawInputListener>([a, b]);
		const ours: RawInputListener = () => undefined;
		installFirst(set, ours);
		assert.deepEqual([...set], [ours, a, b]);
		installFirst(set, ours);
		assert.deepEqual([...set], [ours, a, b], "idempotent");
		set.add(ours); // no-op for Sets; move it to the end explicitly
		set.delete(ours);
		set.add(ours);
		installFirst(set, ours);
		assert.deepEqual([...set], [ours, a, b], "moved back to the front");
	});
	it("runs ahead of an earlier listener that consumes mouse input, like Pi's viewport listener", () => {
		const seen: string[] = [];
		const viewport: RawInputListener = (d) => (d.startsWith("\x1b[<") ? { consume: true } : undefined);
		const set = new Set<RawInputListener>([viewport]);
		const tui = { inputListeners: set };
		const hook = new RawInputHook((d) => {
			seen.push(d);
			return undefined;
		});
		assert.equal(hook.apply(tui), true);
		// Pi's loop: listeners in insertion order, stop at the first consume.
		for (const l of set) if (l(sgr(0, 1, 1))?.consume) break;
		assert.deepEqual(seen, [sgr(0, 1, 1)]);
	});
	it("re-applies after a TUI change and leaves the old Set; removal on shutdown", () => {
		const one = new Set<RawInputListener>([a]);
		const two = new Set<RawInputListener>([b]);
		let current = one;
		const proxy = {
			get inputListeners() {
				return current;
			},
		};
		const hook = new RawInputHook(() => undefined);
		assert.equal(hook.apply(proxy), true);
		assert.equal(one.size, 2);
		current = two;
		assert.equal(hook.apply(proxy), true);
		assert.deepEqual([...one], [a], "left the old renderer's Set");
		assert.equal(two.size, 2);
		assert.equal([...two][1], b);
		hook.remove();
		assert.deepEqual([...two], [b]);
		assert.equal(hook.installed, false);
	});
	it("a failing feature check installs nothing and removes an earlier install", () => {
		const set = new Set<RawInputListener>([a]);
		const hook = new RawInputHook(() => undefined);
		hook.apply({ inputListeners: set });
		assert.equal(hook.apply({}), false);
		assert.deepEqual([...set], [a]);
		assert.equal(hook.installed, false);
	});
	it("swallows handler errors so Pi's input loop keeps running", () => {
		const set = new Set<RawInputListener>();
		new RawInputHook(() => {
			throw new Error("boom");
		}).apply({ inputListeners: set });
		assert.equal([...set][0]?.("x"), undefined);
	});
});

// ---- manager routing ----

function setup(opts: { listeners?: boolean } = {}) {
	const log: string[] = [];
	const editor = { render: () => [], invalidate() {} } as Component;
	let focused: Component | null = editor;
	const viewport: RawInputListener = () => ({ consume: true });
	const tui = {
		mode: "fullscreen",
		viewportTop: 0,
		...(opts.listeners === false ? {} : { inputListeners: new Set<RawInputListener>([viewport]) }),
		setFocus(c: Component | null) {
			focused = c;
		},
		getFocusedComponent: () => focused,
		requestRender() {},
		terminal: { columns: 80, rows: 24 },
	};
	const state: SessionState = {
		pi: { sendMessage: () => {} } as unknown as SessionState["pi"],
		env: { kind: "tmux-ghostty", supported: true, tmux: true },
		config: DEFAULT_CONFIG,
		motion: false,
	};
	const manager = new WidgetManager(state);
	manager.attach(tui as unknown as NonNullable<SessionState["tui"]>);
	let n = 0;
	const widget = (): Widget => {
		const id = `w${++n}`;
		const details: WidgetDetails = { id, imageId: n, title: id, cols: 10, rows: 2, cssWidth: 80, cssHeight: 34, cssCell: { width: 8, height: 17 }, source: "html" };
		const page = {
			frozen: false,
			closed: false,
			async thaw() {},
			async freeze() {},
			async mouse(ev: { type: string }) {
				log.push(`${id}:${ev.type}`);
			},
			async wheel(ev: { deltaX: number; deltaY: number; x: number; y: number; modifiers: number }) {
				log.push(`${id}:wheel ${ev.deltaX},${ev.deltaY} at ${ev.x},${ev.y} mod ${ev.modifiers}`);
			},
			drainQueue: () => [],
		};
		const w = new Widget(details, page as unknown as WidgetPage, new KittyImage(n, { tmux: true }, () => {}), { html: "x" });
		manager.widgets.set(id, w);
		return w;
	};
	/** Gives `w` Pi's focus through a row that maps every screen cell to (x * 10, y * 10). */
	const focus = (w: Widget, prev: Component | null = editor): Component & { cssAtScreen: (x: number, y: number) => { x: number; y: number } | undefined } => {
		const row = { render: () => [], invalidate() {}, cssAtScreen: (x: number, y: number) => (y >= 5 && y < 7 ? { x: x * 10, y: y * 10 } : undefined) };
		w.prevFocus = prev;
		focused = row;
		manager.focused(w, row);
		return row;
	};
	const settle = (): Promise<void> => new Promise((r) => setImmediate(r));
	return { manager, widget, focus, log, tui, editor, settle, focusedNow: () => focused };
}

describe("raw input routing (RQ01, RQ02)", () => {
	it("installs ahead of Pi's viewport listener on attach and logs nothing without widgets", () => {
		const { manager, tui } = setup();
		assert.equal(manager.rawInputHooked, true);
		assert.equal(tui.inputListeners?.size, 2);
		assert.equal(manager.rawInput("a"), undefined, "keys pass through");
	});
	it("RQ01: horizontal wheel is consumed and dropped when no widget is focused", async () => {
		const { manager, widget, log, settle } = setup();
		widget();
		for (const m of MODS) {
			assert.deepEqual(manager.rawInput(sgr(66 + m, 3, 5)), { consume: true });
			assert.deepEqual(manager.rawInput(sgr(67 + m, 3, 5)), { consume: true });
		}
		await settle();
		assert.deepEqual(log, [], "no wake, press, or wheel");
	});
	it("RQ01: a focused widget under the pointer scrolls its page sideways; elsewhere it is dropped", async () => {
		const { manager, widget, focus, log, settle } = setup();
		const w = widget();
		focus(w);
		assert.deepEqual(manager.rawInput(sgr(66, 3, 5)), { consume: true });
		assert.deepEqual(manager.rawInput(sgr(67 + 8, 4, 6)), { consume: true });
		assert.deepEqual(manager.rawInput(sgr(67, 4, 12)), { consume: true }, "outside the grid");
		await settle();
		assert.deepEqual(log, [`w1:wheel ${-WHEEL_PX},0 at 30,50 mod 0`, `w1:wheel ${WHEEL_PX},0 at 40,60 mod 1`]);
	});
	it("vertical wheel, motion, and releases pass through untouched", () => {
		const { manager, widget, focus } = setup();
		focus(widget());
		for (const seq of [sgr(64, 3, 5), sgr(65, 3, 5), sgr(32, 3, 5), sgr(0, 3, 5, true)]) assert.equal(manager.rawInput(seq), undefined);
	});
	it("RQ02: a press outside the focused widget's rows releases it like Escape and still reaches Pi", async () => {
		const { manager, widget, focus, editor, focusedNow } = setup();
		const w = widget();
		focus(w);
		assert.equal(manager.rawInput(sgr(0, 3, 1)), undefined, "not consumed");
		await Promise.resolve();
		assert.equal(focusedNow(), editor, "previous focus restored");
	});
	it("RQ02: a press that Pi dispatches to the focused widget's rows keeps it focused", async () => {
		const { manager, widget, focus, focusedNow } = setup();
		const w = widget();
		const row = focus(w);
		manager.rawInput(sgr(0, 3, 5));
		manager.pressSeen(w, true); // Pi's dispatch reaches the row synchronously
		await Promise.resolve();
		assert.equal(focusedNow(), row);
		manager.rawInput(sgr(0, 3, 30));
		manager.pressSeen(w, false); // a captured press routed to the row but outside its lines
		await Promise.resolve();
		assert.notEqual(focusedNow(), row, "released");
	});
	it("RQ02: a press that moved focus to another widget does not steal it back; its release target skips widget rows", async () => {
		const { manager, widget, focus, editor, focusedNow } = setup();
		const a = widget();
		const b = widget();
		focus(a);
		manager.rawInput(sgr(0, 3, 20));
		assert.equal(manager.focusTarget(), editor, "B would restore the editor, not A's row");
		const rowB = focus(b, manager.focusTarget());
		await Promise.resolve();
		assert.equal(focusedNow(), rowB);
		assert.equal(b.prevFocus, editor);
	});
	it("does nothing outside fullscreen", () => {
		const { manager, tui } = setup();
		tui.mode = "regular";
		assert.equal(manager.rawInput(sgr(66, 1, 1)), undefined);
	});
	it("fallback: without the private Set no hook is installed (AC02a)", () => {
		const { manager } = setup({ listeners: false });
		assert.equal(manager.rawInputHooked, false);
	});
	it("re-applies on render after a renderer change and removes the hook on shutdown", async () => {
		const { manager, tui } = setup();
		const old = tui.inputListeners as Set<RawInputListener>;
		const next = new Set<RawInputListener>([() => undefined]);
		(tui as { inputListeners?: Set<RawInputListener> }).inputListeners = next;
		manager.observeRender();
		assert.equal(old.size, 1, "left the old Set");
		assert.equal(next.size, 2);
		await manager.shutdown();
		assert.equal(next.size, 1);
		assert.equal(manager.rawInputHooked, false);
	});
});
