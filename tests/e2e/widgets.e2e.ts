// Slice 02.03 e2e (AC05, click-to-wake, AC08, AC11, AC14 partial, AC15): real Pi in a temporary visible tmux split.
// Run with `npm run test:e2e` from a pane in the attached tmux client's current window. Under tmux a real client never
// sends hover moves (Pi enables button-motion tracking only), so these tests send only presses, releases, and keys.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { sgr } from "../../scripts/perf/lib.js";
import { chromePids, type DevEvent, gridTarget, PiSession, sleep } from "./lib.js";

const sends = (s: PiSession, id: string): DevEvent[] => s.events().filter((e) => e.ev === "send" && e.id === id);
const widgetEvent = (s: PiSession, title: RegExp): Promise<DevEvent> => s.waitEvent((e) => e.ev === "widget" && title.test(String(e.title)), 20_000, `widget ${title}`);
const idOf = (e: DevEvent): string => String(e.id);
const imageOf = (e: DevEvent): number => Number(e.imageId);

async function closeAndCheck(s: PiSession | undefined): Promise<void> {
	if (!s) return;
	const left = await s.close();
	assert.deepEqual(left, [], `processes started by the run remain: ${left.join(", ")}`);
}

describe("fullscreen session: input, focus, scrolling, bridge, tool", () => {
	let s: PiSession;
	before(async () => {
		s = await PiSession.start();
	});
	after(async () => closeAndCheck(s));

	it("AC05: 18 target clicks and a 60-click burst all hit", async () => {
		await s.command("/widget-dev tests/fixtures/e2e-grid.html 60 10");
		const w = await widgetEvent(s, /e2e-grid/);
		s.track();
		const grid = await s.waitLocate(imageOf(w), 10);
		const id = idOf(w);
		const expected: number[] = [];
		for (let i = 0; i < 18; i++) {
			const p = gridTarget(i, grid, 60, 10);
			s.type(s.press(p.x, p.y));
			expected.push(i);
			await sleep(80);
		}
		await s.waitFor(() => sends(s, id).length >= 18 || undefined, 10_000, "18 hits");
		assert.deepEqual(
			sends(s, id).map((e) => (e.data as { hit: number }).hit),
			expected,
		);
		let seed = 7;
		const burst: number[] = [];
		let seq = "";
		for (let i = 0; i < 60; i++) {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			const t = seed % 18;
			burst.push(t);
			const p = gridTarget(t, grid, 60, 10);
			seq += s.press(p.x, p.y);
		}
		s.type(seq);
		await s.waitFor(() => sends(s, id).length >= 78 || undefined, 15_000, "60 burst hits");
		await sleep(300);
		const hits = sends(s, id).map((e) => (e.data as { hit: number }).hit);
		assert.equal(hits.length, 78);
		assert.deepEqual(hits.slice(18), burst);
		assert.ok(s.events().some((e) => e.ev === "focus" && e.id === id), "press focused the widget");
		s.key("Escape");
		const deliver = await s.waitEvent((e) => e.ev === "deliver" && e.id === id, 5_000, "release delivery");
		assert.deepEqual(deliver.options, { deliverAs: "nextTurn" });
		assert.equal(deliver.items, 78);
		assert.equal(s.events().filter((e) => e.ev === "release" && e.id === id).length, 1, "one release");
	});

	it("PD09: under tmux a click wakes a frozen widget and reaches the page; release freezes it immediately", async (t) => {
		const known = new Set(s.events().filter((e) => e.ev === "widget").map(idOf));
		await s.command("/widget-dev tests/fixtures/e2e-grid.html 60 6");
		const w = await s.waitEvent((e) => e.ev === "widget" && /e2e-grid/.test(String(e.title)) && !known.has(idOf(e)), 20_000, "click-to-wake grid widget");
		const id = idOf(w);
		s.track();
		const grid = await s.waitLocate(imageOf(w), 6);
		await s.waitFor(() => (/e2e-grid\.html · click to interact/.test(s.capture()) ? true : undefined), 5_000, "tmux hint");
		assert.doesNotMatch(s.capture(), /hover or click/);
		const start = (s.events().find((e) => e.ev === "session_start")?.motion as boolean | undefined) ?? true;
		assert.equal(start, false, "Pi's multiplexer condition holds under tmux");

		// Focus with a click, then release: the widget freezes immediately.
		const a = gridTarget(0, grid, 60, 6);
		s.type(s.press(a.x, a.y));
		await s.waitEvent((e) => e.ev === "focus" && e.id === id, 5_000, "focus");
		await s.waitFor(() => sends(s, id).find((e) => (e.data as { hit?: number }).hit === 0), 5_000, "first hit");
		s.key("Escape");
		const release = await s.waitEvent((e) => e.ev === "release" && e.id === id, 5_000, "release");
		const frozen = await s.waitEvent((e) => e.ev === "frozen" && e.id === id, 5_000, "frozen on release");
		assert.ok(frozen.t - release.t < 1_000, `froze ${frozen.t - release.t} ms after release`);
		assert.equal(s.events().filter((e) => e.ev === "live" && e.id === id).length, 0);
		await sleep(500);

		// One real SGR press and release on the frozen widget: live, a new frame, and the press reaches the page.
		const b = gridTarget(9, grid, 60, 6);
		s.type(s.press(b.x, b.y));
		const live = await s.waitEvent((e) => e.ev === "live" && e.id === id, 5_000, "live after click");
		const frame = await s.waitEvent((e) => e.ev === "thaw-frame" && e.id === id, 5_000, "new frame after the waking click");
		const hit = await s.waitFor(() => sends(s, id).find((e) => (e.data as { hit?: number }).hit === 9), 5_000, "waking click reaches the page");
		assert.ok(live.t <= hit.t, "thawed before the press was delivered");
		assert.ok(Number(frame.ms) < 1_000, `first frame ${String(frame.ms)} ms after thaw start`);
		t.diagnostic(`release to frozen ${frozen.t - release.t} ms; thaw start to first frame ${String(frame.ms)} ms; live to page press ${hit.t - live.t} ms`);
		await s.waitFor(() => (s.events().filter((e) => e.ev === "focus" && e.id === id).length === 2 ? true : undefined), 5_000, "the waking click focuses");
		s.key("Escape");
		await s.waitFor(() => (s.events().filter((e) => e.ev === "frozen" && e.id === id).length === 2 ? true : undefined), 5_000, "frozen again on release");
		assert.equal(s.events().filter((e) => e.ev === "live" && e.id === id).length, 1);
	});

	it("AC05: typed keys reach a focused input; ctrl+u and ctrl+d scroll while focused; Escape releases", async () => {
		await s.command("/widget-dev tests/fixtures/e2e-input.html 60 4");
		const w = await widgetEvent(s, /e2e-input/);
		const id = idOf(w);
		const grid = await s.waitLocate(imageOf(w), 4);
		s.type(s.press(grid.col + 30, grid.row + 2));
		await s.waitEvent((e) => e.ev === "focus" && e.id === id, 5_000, "input focus");
		await sleep(150);
		s.type("hello world");
		const value = (): string | undefined => (sends(s, id).at(-1)?.data as { value?: string } | undefined)?.value;
		await s.waitFor(() => (value() === "hello world" ? true : undefined), 5_000, "typed text");
		s.key("BSpace");
		await s.waitFor(() => (value() === "hello worl" ? true : undefined), 5_000, "backspace");

		const bottom = s.capture();
		s.key("C-u");
		const scrolled = await s.waitFor(() => {
			const c = s.capture();
			return c !== bottom ? c : undefined;
		}, 3_000, "ctrl+u scroll");
		assert.notEqual(scrolled, bottom);
		s.key("C-d");
		await s.waitFor(() => (s.capture() === bottom ? true : undefined), 3_000, "ctrl+d back to the bottom");
		assert.equal(s.events().filter((e) => e.ev === "release" && e.id === id).length, 0, "still focused after scrolling");
		s.type("!");
		await s.waitFor(() => (value() === "hello worl!" ? true : undefined), 5_000, "keys after scrolling");

		s.key("Escape");
		await s.waitEvent((e) => e.ev === "release" && e.id === id, 5_000, "release");
		const before = sends(s, id).length;
		s.type("zz");
		await sleep(400);
		assert.equal(sends(s, id).length, before, "keys go to the editor after release");
		assert.match(s.capture(), /zz/);
		s.key("BSpace", "BSpace");
	});

	it("AC08: pi.send arrives with the next user turn; pi.submit needs activation and delivers immediately", async () => {
		await s.command("/widget-dev tests/fixtures/e2e-bridge.html 60 4");
		const w = await widgetEvent(s, /e2e-bridge/);
		const id = idOf(w);
		const grid = await s.waitLocate(imageOf(w), 4);
		await sleep(800);
		assert.equal(s.events().filter((e) => (e.ev === "submit" || e.ev === "deliver") && e.id === id).length, 0, "submit without activation rejected");

		s.type(s.press(grid.col + 15, grid.row + 2));
		await s.waitFor(() => sends(s, id).find((e) => (e.data as { clicked?: string }).clicked === "send"), 5_000, "pi.send");
		s.key("Escape");
		const deliver = await s.waitEvent((e) => e.ev === "deliver" && e.id === id, 5_000, "send delivery");
		assert.deepEqual(deliver.options, { deliverAs: "nextTurn" });
		assert.match(String(deliver.content), /^\[untrusted widget data\]/);
		const turnsBefore = s.turns().length;
		await sleep(800);
		assert.equal(s.turns().length, turnsBefore, "pi.send does not start a turn");

		await s.command("hello from e2e");
		const turn = await s.waitFor(() => s.turns().find((t) => t.messages.some((m) => m.role === "user" && m.text === "hello from e2e")), 10_000, "next user turn");
		const carrying = turn.messages.filter((m) => m.text.includes('{"clicked":"send"}'));
		assert.equal(carrying.length, 1, "one custom message with the widget data");
		assert.match(carrying[0]?.text ?? "", /^\[untrusted widget data\]/);
		await sleep(800);

		// The turn output scrolled the first widget out of view; a second instance carries the submit check.
		await s.command("/widget-dev tests/fixtures/e2e-bridge.html 60 4");
		const w2 = await s.waitEvent((e) => e.ev === "widget" && /e2e-bridge/.test(String(e.title)) && e.id !== id, 20_000, "second bridge widget");
		const id2 = idOf(w2);
		const grid2 = await s.waitLocate(imageOf(w2), 4);
		await sleep(800);
		assert.equal(s.events().filter((e) => (e.ev === "submit" || e.ev === "deliver") && e.id === id2).length, 0, "submit without activation rejected");
		const turnsBeforeSubmit = s.turns().length;
		s.type(s.press(grid2.col + 45, grid2.row + 2));
		const submitted = await s.waitEvent((e) => e.ev === "deliver" && e.id === id2 && e.kind === "submit", 5_000, "submit delivery");
		assert.deepEqual(submitted.options, { triggerTurn: true });
		const submitTurn = await s.waitFor(() => s.turns().slice(turnsBeforeSubmit).find((t) => t.messages.at(-1)?.text.includes('{"clicked":"submit"}')), 10_000, "submit turn");
		assert.match(submitTurn.messages.at(-1)?.text ?? "", /^\[untrusted widget data\]/);
		await sleep(500);
		s.key("Escape");
		await s.waitEvent((e) => e.ev === "release" && e.id === id2, 5_000, "release");
	});

	it("RQ01: the agent's show_widget call renders and returns id, size, viewport, blocked requests, and errors", async () => {
		await sleep(500);
		await s.command(`e2e-tool ${JSON.stringify({ html: "<p>tool widget</p>", title: "tool probe", cols: 40, rows: 3 })}`);
		const w = await widgetEvent(s, /^tool probe$/);
		s.track();
		const turn = await s.waitFor(() => s.turns().find((t) => t.messages.some((m) => m.role === "toolResult" && m.text.includes(`Widget ${idOf(w)} is shown inline`))), 15_000, "tool result turn");
		const result = turn.messages.find((m) => m.role === "toolResult")?.text ?? "";
		assert.match(result, /40x3 cells, CSS viewport 320x51 px/);
		assert.match(result, /Blocked during load: none\./);
		assert.match(result, /JS errors during load: none\./);
		await s.waitLocate(imageOf(w), 3);
	});
});

describe("input fixes: horizontal wheel, click outside, single click (RQ01-RQ03; dev timers: idle 1.5 s)", () => {
	let s: PiSession;
	before(async () => {
		s = await PiSession.start({ env: { PI_WIDGETS_DEV_TIMERS: "idle=1500" } });
	});
	after(async () => closeAndCheck(s));

	const data = (id: string): Record<string, unknown>[] => sends(s, id).map((e) => e.data as Record<string, unknown>);
	const pageWheels = (id: string): number[][] => data(id).flatMap((d) => (Array.isArray(d.wheel) ? [d.wheel as number[]] : []));
	const pageDowns = (id: string): number => data(id).filter((d) => d.down !== undefined).length;
	const pageClicks = (id: string): number => data(id).filter((d) => d.click !== undefined).length;
	const count = (ev: string, id: string): number => s.events().filter((e) => e.ev === ev && e.id === id).length;
	const wheelAt = (code: number, x: number, y: number): void => s.type(sgr(code, x + 1, y + 1));
	let a: DevEvent;
	let b: DevEvent;

	it("AC01: horizontal wheel over an unfocused widget never wakes, focuses, or presses it; vertical wheel scrolls the transcript", async () => {
		assert.equal(s.events().find((e) => e.ev === "raw-input")?.hooked, true, "raw input hook installed");
		for (let i = 1; i <= 4; i++) {
			await s.command(`fill ${i}`);
			await s.waitFor(() => (s.turns().length >= i ? true : undefined), 10_000, `turn ${i}`);
			await sleep(300);
		}
		await s.command("/widget-dev tests/fixtures/e2e-click.html 60 4");
		a = await widgetEvent(s, /e2e-click/);
		const id = idOf(a);
		s.track();
		await s.waitEvent((e) => e.ev === "frozen" && e.id === id, 5_000, "idle freeze");
		const grid = await s.waitLocate(imageOf(a), 4);
		const x = grid.col + 30;
		const y = grid.row + 2;
		for (const code of [66, 67, 66 + 4, 67 + 8, 66 + 16, 67 + 28]) {
			wheelAt(code, x, y);
			await sleep(60);
		}
		await sleep(800);
		assert.equal(count("live", id), 0, "no wake");
		assert.equal(count("focus", id), 0, "no focus");
		assert.equal(pageDowns(id) + pageWheels(id).length, 0, "no page press or wheel");
		assert.match(s.capture(), /e2e-click\.html · click to interact/);
		s.type("zz");
		await s.waitFor(() => (/zz/.test(s.capture()) ? true : undefined), 3_000, "keys still go to the editor");
		s.key("BSpace", "BSpace");
		await sleep(200);

		const top = s.capture().split("\n")[0];
		wheelAt(64, x, y);
		wheelAt(64, x, y);
		const scrolled = await s.waitFor(() => {
			const first = s.capture().split("\n")[0];
			return first !== top ? first : undefined;
		}, 3_000, "vertical wheel scrolls the transcript");
		assert.notEqual(scrolled, top);
		assert.equal(count("focus", id), 0, "vertical wheel does not focus");
		for (let i = 0; i < 6; i++) {
			wheelAt(65, x, Math.min(y + 2, 20));
			await sleep(40);
		}
		await s.waitFor(() => (s.capture().split("\n")[0] === top ? true : undefined), 3_000, "back at the bottom");
	});

	it("AC01: over a focused widget horizontal and vertical wheel scroll the page, not the transcript", async () => {
		const id = idOf(a);
		const grid = await s.waitLocate(imageOf(a), 4);
		const x = grid.col + 30;
		const y = grid.row + 2;
		s.type(s.press(x, y));
		await s.waitEvent((e) => e.ev === "focus" && e.id === id, 5_000, "focus");
		await s.waitFor(() => (pageClicks(id) === 1 ? true : undefined), 5_000, "click");
		const screen = s.capture();
		wheelAt(67, x, y);
		await sleep(80);
		wheelAt(66 + 4, x, y);
		await sleep(80);
		wheelAt(65, x, y);
		await s.waitFor(() => (pageWheels(id).length >= 3 ? true : undefined), 5_000, "page wheel events");
		assert.deepEqual(pageWheels(id), [
			[1, 0],
			[-1, 0],
			[0, 1],
		]);
		assert.equal(s.capture().split("\n")[0], screen.split("\n")[0], "the transcript did not scroll");
	});

	it("AC02: a press on the transcript outside the focused widget releases it like Escape; data arrives with the next prompt", async () => {
		const id = idOf(a);
		const grid = await s.waitLocate(imageOf(a), 4);
		assert.ok(grid.row >= 3, `room above the widget (grid at row ${grid.row})`);
		const turns = s.turns().length;
		s.type(s.press(2, grid.row - 3));
		const outside = await s.waitEvent((e) => e.ev === "outside-press" && e.id === id, 3_000, "outside press");
		const release = await s.waitEvent((e) => e.ev === "release" && e.id === id, 3_000, "release");
		const frozen = await s.waitFor(() => s.events().find((e) => e.ev === "frozen" && e.id === id && e.t >= outside.t), 3_000, "frozen");
		assert.ok(frozen.t - release.t < 1_000);
		const deliver = await s.waitEvent((e) => e.ev === "deliver" && e.id === id, 3_000, "delivery");
		assert.deepEqual(deliver.options, { deliverAs: "nextTurn" });
		await s.waitFor(() => (/e2e-click\.html · click to interact/.test(s.capture()) ? true : undefined), 3_000, "unfocused hint");
		await s.command("after outside");
		const turn = await s.waitFor(() => s.turns().slice(turns).find((t) => t.messages.some((m) => m.role === "user" && m.text === "after outside")), 10_000, "next turn");
		assert.ok(
			turn.messages.some((m) => m.text.includes('{"down":1}')),
			"queued pi.send data delivered with the next prompt (the editor had focus again)",
		);
		await sleep(500);
	});

	it("AC03a: a single click on a frozen widget's button reaches the page once", async () => {
		const id = idOf(a);
		await s.waitFor(() => (s.events().filter((e) => e.ev === "frozen" && e.id === id).length >= 2 ? true : undefined), 3_000, "frozen");
		const grid = await s.waitLocate(imageOf(a), 4);
		const clicks = pageClicks(id);
		s.type(s.press(grid.col + 30, grid.row + 2));
		await s.waitFor(() => (pageClicks(id) === clicks + 1 ? true : undefined), 5_000, "one click");
		await sleep(500);
		assert.equal(pageClicks(id), clicks + 1, "exactly once");
		s.key("Escape");
		await s.waitFor(() => (s.events().filter((e) => e.ev === "release" && e.id === id).length === 2 ? true : undefined), 3_000, "release");
	});

	it("AC02: a press on a second widget makes it live and focused and freezes the first; releasing it restores the editor", async () => {
		// Two fresh widgets (the delivery above scrolled widget A out of view).
		const known = new Set([idOf(a)]);
		const next = async (): Promise<DevEvent> => {
			await s.command("/widget-dev tests/fixtures/e2e-click.html 60 2");
			const w = await s.waitEvent((e) => e.ev === "widget" && !known.has(idOf(e)), 20_000, "new widget");
			known.add(idOf(w));
			s.track();
			return w;
		};
		const first = await next();
		b = await next();
		const g1 = await s.waitLocate(imageOf(first), 2);
		const gb = await s.waitLocate(imageOf(b), 2);
		s.type(s.press(g1.col + 30, g1.row + 1));
		const focus1 = await s.waitEvent((e) => e.ev === "focus" && e.id === idOf(first), 5_000, "first focused");
		s.type(s.press(gb.col + 30, gb.row + 1));
		await s.waitEvent((e) => e.ev === "focus" && e.id === idOf(b), 5_000, "second focused");
		await s.waitEvent((e) => e.ev === "release" && e.id === idOf(first), 5_000, "first released");
		const frozen = await s.waitFor(() => s.events().find((e) => e.ev === "frozen" && e.id === idOf(first) && e.t >= focus1.t), 5_000, "first frozen");
		const lastB = s.events().filter((e) => (e.ev === "live" || e.ev === "frozen") && e.id === idOf(b)).at(-1);
		assert.ok(!lastB || lastB.ev === "live", "second widget live");
		assert.equal(count("outside-press", idOf(first)), 0, "released through Pi's focus change, not as an outside press");
		await s.waitFor(() => (pageClicks(idOf(b)) === 1 ? true : undefined), 5_000, "the press reached the second page");
		assert.ok(frozen.t >= focus1.t);
		s.key("Escape");
		await s.waitEvent((e) => e.ev === "release" && e.id === idOf(b), 3_000, "second released");
		const before = sends(s, idOf(b)).length + sends(s, idOf(first)).length;
		s.type("qq");
		await s.waitFor(() => (/qq/.test(s.capture()) ? true : undefined), 3_000, "the editor has focus, not the first widget");
		await sleep(300);
		assert.equal(sends(s, idOf(b)).length + sends(s, idOf(first)).length, before);
		assert.equal(count("focus", idOf(first)), 1, "focus did not return to the first widget");
		s.key("BSpace", "BSpace");
	});
});

describe("regular mode session (AC11)", () => {
	let s: PiSession;
	before(async () => {
		s = await PiSession.start({ tuiMode: "regular" });
	});
	after(async () => closeAndCheck(s));

	it("shows the still plus hint in regular mode and becomes interactive after switching to fullscreen", async () => {
		await s.command("/widget-dev tests/fixtures/e2e-grid.html 60 6");
		const w = await widgetEvent(s, /e2e-grid/);
		const id = idOf(w);
		s.track();
		await s.waitEvent((e) => e.ev === "frozen" && e.id === id, 5_000, "frozen in regular mode");
		await s.waitFor(() => (/still image · fullscreen mode needed to interact/.test(s.capture()) ? true : undefined), 5_000, "regular-mode hint");
		assert.ok(s.locate(imageOf(w)), "still placeholders rendered");

		await s.command("/settings");
		await sleep(500);
		s.type("TUI mode");
		await sleep(300);
		s.key("Enter");
		await s.waitEvent((e) => e.ev === "mode" && e.mode === "fullscreen", 5_000, "fullscreen mode");
		await sleep(300);
		s.key("Escape");
		await s.waitFor(() => (/e2e-grid\.html · click to interact/.test(s.capture()) ? true : undefined), 5_000, "fullscreen hint");
		const grid = await s.waitLocate(imageOf(w), 6);
		const p = gridTarget(0, grid, 60, 6);
		s.type(s.press(p.x, p.y));
		await s.waitEvent((e) => e.ev === "live" && e.id === id, 5_000, "click thaws");
		await s.waitFor(() => sends(s, id).find((e) => (e.data as { hit?: number }).hit === 0), 5_000, "click hit after switching");
		s.key("Escape");
		await s.waitEvent((e) => e.ev === "release" && e.id === id, 5_000, "release");
	});
});

describe("unsupported terminal (AC14 partial)", () => {
	let s: PiSession;
	before(async () => {
		s = await PiSession.start({ unsetEnv: ["TMUX", "TMUX_PANE"], env: { TERM_PROGRAM: "e2e-term" } });
	});
	after(async () => closeAndCheck(s));

	it("shows the notice with the title and tells the agent, without starting a browser", async () => {
		const start = s.events().find((e) => e.ev === "session_start");
		assert.equal((start?.env as { kind?: string }).kind, "unsupported");
		await sleep(1_000);
		await s.command(`e2e-tool ${JSON.stringify({ html: "<p>x</p>", title: "probe widget" })}`);
		const turn = await s.waitFor(() => s.turns().find((t) => t.messages.some((m) => m.role === "toolResult")), 15_000, "tool result turn");
		assert.match(turn.messages.find((m) => m.role === "toolResult")?.text ?? "", /Widgets are unavailable in this terminal \(unsupported\).*need tmux with Ghostty/s);
		await s.waitFor(() => (/\[widgets need tmux \+ Ghostty\] probe widget/.test(s.capture()) ? true : undefined), 5_000, "notice row");
		s.track();
		assert.deepEqual(
			s.events().filter((e) => e.ev === "widget"),
			[],
		);
		assert.deepEqual(chromePids(s.seen), [], "no browser started");
	});
});

describe("failures without crashing Pi (AC15)", () => {
	it("an invalid config produces a notice and the defaults apply", async () => {
		const s = await PiSession.start({ config: '{ "dpr": "two" }' });
		try {
			const bad = await s.waitEvent((e) => e.ev === "config-invalid", 5_000, "config notice");
			assert.match(String(bad.reason), /dpr must be a number/);
			await s.waitFor(() => (/dpr must be a number/.test(s.capture().replace(/\s+/g, " ")) ? true : undefined), 5_000, "visible config notice");
			await s.command("/widget-dev tests/fixtures/e2e-grid.html 30 3");
			const w = await widgetEvent(s, /e2e-grid/);
			s.track();
			assert.equal((w.cssCell as { width: number }).width > 0, true, "defaults applied");
		} finally {
			await closeAndCheck(s);
		}
	});

	it("a missing Chromium binary produces a notice with the install command; Pi keeps running", async () => {
		const s = await PiSession.start({ config: JSON.stringify({ chromePath: "/nonexistent/chrome-headless-shell" }) });
		try {
			await s.command("/widget-dev tests/fixtures/e2e-grid.html 30 3");
			const failed = await s.waitEvent((e) => e.ev === "create-failed", 10_000, "create failure");
			assert.match(String(failed.message), /chrome-headless-shell not found .*Install it with: npx @puppeteer\/browsers install chrome-headless-shell/);
			await s.waitFor(() => (/chrome-headless-shell not found/.test(s.capture()) ? true : undefined), 5_000, "visible notice");
			await sleep(500);
			await s.command(`e2e-tool ${JSON.stringify({ html: "<p>x</p>", title: "no browser" })}`);
			const turn = await s.waitFor(() => s.turns().find((t) => t.messages.some((m) => m.role === "toolResult")), 15_000, "tool error turn");
			assert.match(turn.messages.find((m) => m.role === "toolResult")?.text ?? "", /chrome-headless-shell not found/);
			await sleep(500);
			const turns = s.turns().length;
			await s.command("still alive?");
			await s.waitFor(() => (s.turns().length > turns ? true : undefined), 10_000, "Pi still answers");
		} finally {
			await closeAndCheck(s);
		}
	});
});
