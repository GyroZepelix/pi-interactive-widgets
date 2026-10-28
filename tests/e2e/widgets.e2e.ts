// Slice 02.03 e2e (AC05, click-to-wake, AC08, AC11, AC14 partial, AC15): real Pi in a temporary visible tmux split.
// Run with `npm run test:e2e` from a pane in the attached tmux client's current window. Under tmux a real client never
// sends hover moves (Pi enables button-motion tracking only), so these tests send only presses, releases, and keys.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
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
