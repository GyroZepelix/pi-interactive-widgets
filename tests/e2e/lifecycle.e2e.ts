// Slice 02.02 e2e (AC03, AC06, AC07, AC12, AC13 automated part, RQ17): real Pi in a temporary visible tmux split with
// dev-shortened timers (`PI_WIDGETS_DEV_TIMERS`). Run with `npm run test:e2e` from a pane in the attached tmux
// client's current window. Only panes and processes this run starts are resized, killed, or checked.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { closeSplit } from "../../scripts/perf/lib.js";
import { chromePids, type DevEvent, PiSession, ROOT, sleep } from "./lib.js";

const FIXTURE = join(ROOT, "tests", "fixtures");
const idOf = (e: DevEvent): string => String(e.id);
const imageOf = (e: DevEvent): number => Number(e.imageId);
const sends = (s: PiSession, id: string): DevEvent[] => s.events().filter((e) => e.ev === "send" && e.id === id);
const loads = (s: PiSession, id: string): string[] => sends(s, id).flatMap((e) => ((e.data as { loaded?: string }).loaded ? [(e.data as { loaded: string }).loaded] : []));
const count = (s: PiSession, ev: string, id: string): number => s.events().filter((e) => e.ev === ev && e.id === id).length;

async function newWidget(s: PiSession, line: string, title: RegExp): Promise<DevEvent> {
	const known = new Set(s.events().filter((e) => e.ev === "widget").map(idOf));
	await s.command(line);
	const w = await s.waitEvent((e) => e.ev === "widget" && title.test(String(e.title)) && !known.has(idOf(e)), 20_000, `widget ${title}`);
	s.track();
	return w;
}

async function closeAndCheck(s: PiSession | undefined): Promise<void> {
	if (!s) return;
	const left = await s.close();
	assert.deepEqual(left, [], `processes started by the run remain: ${left.join(", ")}`);
}

/** Pane cell of grid target `i` (6x3 fixture) for a widget shown at `box` cells from a `cols` x `rows` page. */
function scaledTarget(i: number, grid: { row: number; col: number }, box: { cols: number; rows: number; scale: number }, rows: number): { x: number; y: number } {
	const offY = (box.rows - rows * box.scale) / 2;
	return { x: grid.col + Math.floor(((i % 6) + 0.5) * (box.cols / 6)), y: grid.row + Math.floor(offY + (Math.floor(i / 6) + 0.5) * ((rows * box.scale) / 3)) };
}

describe("run-time policy, LRU, scaling, and recovery (dev timers: idle 1.5 s, focus 2.5 s)", () => {
	let s: PiSession;
	before(async () => {
		s = await PiSession.start({ env: { PI_WIDGETS_DEV_TIMERS: "idle=1500,focus=2500" } });
	});
	after(async () => closeAndCheck(s));

	it("AC06: a new widget freezes after the idle time from creation; a focused one after the focus time without input", async (t) => {
		const w = await newWidget(s, "/widget-dev tests/fixtures/e2e-input.html 60 3", /e2e-input/);
		const id = idOf(w);
		const frozen = await s.waitEvent((e) => e.ev === "frozen" && e.id === id, 5_000, "idle freeze from creation");
		const idleMs = frozen.t - w.t;
		assert.ok(idleMs >= 1_400 && idleMs < 3_000, `froze ${idleMs} ms after creation (dev idle 1500 ms)`);

		const grid = await s.waitLocate(imageOf(w), 3);
		s.type(s.press(grid.col + 30, grid.row + 1));
		await s.waitEvent((e) => e.ev === "focus" && e.id === id, 5_000, "focus");
		s.type("ab");
		const value = (): string | undefined => (sends(s, id).at(-1)?.data as { value?: string } | undefined)?.value;
		await s.waitFor(() => (value() === "ab" ? true : undefined), 5_000, "typed text");
		const lastInput = Date.now();
		await s.waitFor(() => (count(s, "frozen", id) === 2 ? true : undefined), 6_000, "focused freeze without input");
		const focusFrozen = s.events().filter((e) => e.ev === "frozen" && e.id === id)[1] as DevEvent;
		const focusMs = focusFrozen.t - lastInput;
		assert.ok(focusMs >= 2_300 && focusMs < 4_500, `focused widget froze ${focusMs} ms after the last input (dev focus 2500 ms)`);
		assert.equal(count(s, "release", id), 0, "focus is kept while frozen");

		s.type("c");
		await s.waitFor(() => (count(s, "live", id) === 2 ? true : undefined), 5_000, "a key wakes the focused widget");
		await s.waitFor(() => (value() === "abc" ? true : undefined), 5_000, "the waking key reaches the page");
		s.key("Escape");
		await s.waitEvent((e) => e.ev === "release" && e.id === id, 5_000, "release");
		await s.waitFor(() => (count(s, "frozen", id) === 3 ? true : undefined), 5_000, "release freezes");
		s.key("BSpace", "BSpace", "BSpace");
		t.diagnostic(`idle freeze ${idleMs} ms after creation; focused freeze ${focusMs} ms after the last input`);
	});

	it("AC06: making widget B live freezes widget A immediately", async (t) => {
		const a = await newWidget(s, "/widget-dev tests/fixtures/e2e-grid.html 40 2", /e2e-grid/);
		const ga = await s.waitLocate(imageOf(a), 2);
		await s.waitEvent((e) => e.ev === "frozen" && e.id === idOf(a), 5_000, "A idles");
		const b = await newWidget(s, "/widget-dev tests/fixtures/e2e-grid.html 40 2", /e2e-grid/);
		await s.waitLocate(imageOf(b), 2);
		assert.equal(count(s, "frozen", idOf(b)), 0, "B is live after creation");
		await sleep(200);
		const ga2 = s.locate(imageOf(a)) ?? ga;
		s.type(s.press(ga2.col + 3, ga2.row));
		const liveA = await s.waitEvent((e) => e.ev === "live" && e.id === idOf(a), 5_000, "A live");
		const frozenB = await s.waitEvent((e) => e.ev === "frozen" && e.id === idOf(b), 5_000, "B frozen");
		assert.ok(frozenB.t - b.t < 1_500, "B froze because A became live, not by its idle timer");
		assert.ok(frozenB.t <= liveA.t, "B is frozen before A goes live");
		t.diagnostic(`B frozen ${liveA.t - frozenB.t} ms before A live`);
		s.key("Escape");
		await s.waitEvent((e) => e.ev === "release" && e.id === idOf(a), 5_000, "release");
	});

	it("AC03 and AC07: at most 5 pages; the least recently used frozen page closes; a click revives it warm with fresh JS state", async (t) => {
		const before = new Set(s.events().filter((e) => e.ev === "closed").map(idOf));
		const ws: DevEvent[] = [];
		for (let i = 0; i < 6; i++) {
			const w = await newWidget(s, "/widget-dev tests/fixtures/e2e-revive.html 40 1", /e2e-revive/);
			await s.waitFor(() => (loads(s, idOf(w)).length === 1 ? true : undefined), 5_000, "loaded");
			ws.push(w);
		}
		const closedNow = s.events().filter((e) => e.ev === "closed" && !before.has(idOf(e)));
		assert.ok(closedNow.every((e) => e.reason === "lru"));
		assert.ok(
			closedNow.every((e) => Number(e.pages) <= 4),
			"never more than 5 pages",
		);
		const first = ws[0] as DevEvent;
		assert.ok(closedNow.some((e) => e.id === idOf(first)), "the first revive widget (least recently used) closed");
		const grid = await s.waitLocate(imageOf(first), 1);
		await s.waitFor(() => (/e2e-revive\.html · closed · click to reopen/.test(s.capture()) ? true : undefined), 5_000, "closed hint");
		const press = Date.now();
		s.type(s.press(grid.col + 5, grid.row));
		const revived = await s.waitEvent((e) => e.ev === "revived" && e.id === idOf(first), 5_000, "revived");
		await s.waitFor(() => (loads(s, idOf(first)).length === 2 ? true : undefined), 5_000, "fresh JS state after revive");
		assert.equal(revived.warm, true, "browser was running");
		assert.ok(Number(revived.ms) <= 400, `revive took ${String(revived.ms)} ms (about 200 ms expected)`);
		assert.ok(Number(revived.pages) <= 5, `${String(revived.pages)} pages open after the revive`);
		t.diagnostic(`revive ${String(revived.ms)} ms (warm), press to revived ${revived.t - press} ms`);
	});

	it("AC12 and AC13: a narrow pane scales the widget to fit with clicks still hitting; widening restores full size; resizes re-send stills", async (t) => {
		const w = await newWidget(s, "/widget-dev tests/fixtures/e2e-grid.html 60 9", /e2e-grid/);
		const id = idOf(w);
		await s.waitLocate(imageOf(w), 9);
		const resendsBefore = s.events().filter((e) => e.ev === "resend").length;
		const dummy = s.narrow(41);
		try {
			const display = await s.waitEvent((e) => e.ev === "display" && e.id === id && Number(e.scale) < 1, 5_000, "scaled display");
			const box = { cols: Number(display.cols), rows: Number(display.rows), scale: Number(display.scale) };
			const grid = await s.waitLocate(imageOf(w), box.rows);
			assert.ok(box.cols <= 41 && box.cols >= 30, `shown ${box.cols}x${box.rows} cells`);
			const resize = await s.waitFor(() => s.events().filter((e) => e.ev === "resend").slice(resendsBefore).find((e) => String(e.reason).startsWith("resize")), 5_000, "resize re-send");
			const retained = new Set(s.events().filter((e) => e.ev === "widget").map(idOf));
			assert.deepEqual(new Set(resize.ids as string[]), retained, "every retained still re-sent after the resize");
			s.type(s.press(grid.col + 1, grid.row + 1));
			await s.waitEvent((e) => e.ev === "focus" && e.id === id, 5_000, "focus");
			const start = sends(s, id).length;
			const expected: number[] = [];
			for (let i = 0; i < 18; i++) {
				const p = scaledTarget(i, grid, box, 9);
				s.type(s.press(p.x, p.y));
				expected.push(i);
				await sleep(80);
			}
			await s.waitFor(() => (sends(s, id).length >= start + 18 ? true : undefined), 10_000, "18 scaled hits");
			assert.deepEqual(
				sends(s, id)
					.slice(start)
					.map((e) => (e.data as { hit: number }).hit),
				expected,
			);
			s.key("Escape");
			await s.waitEvent((e) => e.ev === "release" && e.id === id, 5_000, "release");
			t.diagnostic(`narrow: 60x9 shown as ${box.cols}x${box.rows} (scale ${box.scale.toFixed(3)}); 18/18 hits`);
		} finally {
			closeSplit(dummy);
		}
		await s.waitEvent((e) => e.ev === "display" && e.id === id && Number(e.scale) === 1, 5_000, "full size after widening");
		await s.waitLocate(imageOf(w), 9);
	});

	it("AC13: /widgets-refresh re-sends every retained still", async () => {
		const n = s.events().filter((e) => e.ev === "resend" && e.reason === "command").length;
		await s.command("/widgets-refresh");
		const refresh = await s.waitFor(() => s.events().filter((e) => e.ev === "resend" && e.reason === "command")[n], 5_000, "refresh");
		const retained = new Set(s.events().filter((e) => e.ev === "widget").map(idOf));
		assert.deepEqual(new Set(refresh.ids as string[]), retained);
		await s.waitFor(() => (/re-sent \d+ widget images?/.test(s.capture()) ? true : undefined), 5_000, "refresh notice");
	});
});

describe("close timer, browser exit, and revive from the current file (dev timers: idle 1 s, close 2.5 s)", () => {
	let s: PiSession;
	let dir: string;
	before(async () => {
		dir = mkdtempSync(join(tmpdir(), "piw-e2e-path-"));
		cpSync(join(FIXTURE, "e2e-revive.html"), join(dir, "index.html"));
		s = await PiSession.start({ env: { PI_WIDGETS_DEV_TIMERS: "idle=1000,close=2500" } });
	});
	after(async () => {
		await closeAndCheck(s);
		rmSync(dir, { recursive: true, force: true });
	});

	it("AC03: a page frozen for the close time closes and the browser exits when no pages remain", async () => {
		const w = await newWidget(s, `/widget-dev ${join(dir, "index.html")} 40 2`, /index\.html/);
		const id = idOf(w);
		await s.waitFor(() => (loads(s, id)[0] === "MARK-1" ? true : undefined), 5_000, "loaded MARK-1");
		const browser = chromePids(s.seen);
		assert.ok(browser.length > 0, "browser running");
		const frozen = await s.waitEvent((e) => e.ev === "frozen" && e.id === id, 5_000, "idle freeze");
		const closed = await s.waitEvent((e) => e.ev === "closed" && e.id === id, 6_000, "close timer");
		assert.equal(closed.reason, "frozen-timeout");
		assert.ok(closed.t - frozen.t >= 2_400, `closed ${closed.t - frozen.t} ms after freezing (dev close 2500 ms)`);
		assert.equal(closed.pages, 0);
		await s.waitFor(() => (chromePids(browser).length === 0 ? true : undefined), 5_000, "browser exit");
	});

	it("AC07: a path widget revives from the current file; a deleted file shows source file missing with the still", async (t) => {
		const w = s.events().find((e) => e.ev === "widget") as DevEvent;
		const id = idOf(w);
		const file = join(dir, "index.html");
		writeFileSync(file, readFileSync(file, "utf8").replace("MARK-1", "MARK-2"));
		const grid = await s.waitLocate(imageOf(w), 2);
		s.type(s.press(grid.col + 5, grid.row + 1));
		const revived = await s.waitEvent((e) => e.ev === "revived" && e.id === id, 10_000, "cold revive");
		assert.equal(revived.warm, false, "cold launch");
		await s.waitFor(() => (loads(s, id).at(-1) === "MARK-2" ? true : undefined), 5_000, "revived from the current file");
		s.track();
		await s.waitFor(() => (count(s, "closed", id) === 2 ? true : undefined), 8_000, "closed again");
		rmSync(file);
		s.type(s.press(grid.col + 5, grid.row + 1));
		const failed = await s.waitEvent((e) => e.ev === "revive-failed" && e.id === id, 5_000, "revive failure");
		assert.equal(failed.message, `source file missing: ${file}`);
		await s.waitFor(() => (s.capture().split("\n").some((l) => l.startsWith(`source file missing: ${file}`.slice(0, 60))) ? true : undefined), 5_000, "visible missing notice");
		assert.ok(s.locate(imageOf(w)), "the still stays shown");
		t.diagnostic(`cold revive ${String(revived.ms)} ms`);
	});

	it("AC07: an inline tool widget revives from its tool arguments", async () => {
		const html = `<p id=m>INLINE</p><script>pi.send({ loaded: "INLINE" })</script>`;
		await s.command(`e2e-tool ${JSON.stringify({ html, title: "inline revive", cols: 40, rows: 2 })}`);
		const w = await s.waitEvent((e) => e.ev === "widget" && e.title === "inline revive", 20_000, "tool widget");
		s.track();
		const id = idOf(w);
		await s.waitFor(() => (loads(s, id).length === 1 ? true : undefined), 5_000, "loaded");
		await s.waitEvent((e) => e.ev === "closed" && e.id === id, 8_000, "closed by the timer");
		await sleep(1_000);
		const grid = await s.waitLocate(imageOf(w), 2);
		s.type(s.press(grid.col + 5, grid.row + 1));
		await s.waitEvent((e) => e.ev === "revived" && e.id === id, 10_000, "revived");
		await s.waitFor(() => (loads(s, id).length === 2 ? true : undefined), 5_000, "fresh JS state from the tool arguments");
	});
});

describe("resume and restart (AC07) and kill -9 (AC03)", () => {
	let agentDir: string | undefined;
	after(() => {
		if (agentDir) rmSync(agentDir, { recursive: true, force: true });
	});

	it("after a restart with the session continued, the widget row shows a placeholder line until clicked, then revives", async (t) => {
		agentDir = mkdtempSync(join(tmpdir(), "piw-e2e-resume-"));
		let s = await PiSession.start({ persist: true, agentDir });
		const html = `<p>RESUMED</p><script>pi.send({ loaded: "RESUMED" })</script>`;
		let id = "";
		try {
			await s.command(`e2e-tool ${JSON.stringify({ html, title: "resume probe", cols: 40, rows: 2 })}`);
			const w = await s.waitEvent((e) => e.ev === "widget" && e.title === "resume probe", 20_000, "tool widget");
			id = idOf(w);
			s.track();
			await s.waitFor(() => (loads(s, id).length === 1 ? true : undefined), 5_000, "loaded");
			await s.waitFor(() => (s.turns().length >= 2 ? true : undefined), 10_000, "turn finished");
			await sleep(1_000);
		} finally {
			await closeAndCheck(s);
		}
		s = await PiSession.start({ persist: true, continue: true, agentDir });
		try {
			const start = s.events().find((e) => e.ev === "session_start");
			t.diagnostic(`session_start reason ${String(start?.reason)}`);
			const find = (): { y: number; x: number } | undefined => {
				const lines = s.capture().split("\n");
				const i = lines.findIndex((l) => /◇ resume probe · click to load/.test(l));
				return i >= 0 ? { y: i, x: (lines[i] as string).indexOf("◇") } : undefined;
			};
			// Pi lays out the restored transcript in steps; wait until the row stays put.
			let last = "";
			const row = await s.waitFor(() => {
				const r = find();
				const key = JSON.stringify(r);
				const stable = r && key === last;
				last = key;
				return stable ? r : undefined;
			}, 10_000, "placeholder line");
			await sleep(500);
			assert.equal(chromePids(s.seen).length, 0, "nothing loads before the click");
			s.type(s.press(row.x + 3, row.y));
			const revived = await s.waitEvent((e) => e.ev === "revived" && e.id === id, 15_000, "revived after the click");
			s.track();
			// The dev log is shared with the first run, which logged the first load.
			await s.waitFor(() => (loads(s, id).length === 2 ? true : undefined), 5_000, "loaded from the persisted tool arguments");
			t.diagnostic(`cold revive after restart ${String(revived.ms)} ms`);
		} finally {
			await closeAndCheck(s);
		}
	});

	it("RQ17: /reload releases the pages and the browser; the row then shows the placeholder line and revives on click", async () => {
		const s = await PiSession.start();
		try {
			await s.command("/widget-dev tests/fixtures/e2e-revive.html 40 2");
			const w = await s.waitEvent((e) => e.ev === "widget", 20_000, "widget");
			s.track();
			const browser = chromePids(s.seen);
			assert.ok(browser.length > 0, "browser running");
			await s.command("/reload");
			await s.waitEvent((e) => e.ev === "session_shutdown" && e.reason === "reload", 10_000, "reload shutdown");
			await s.waitEvent((e) => e.ev === "session_start" && e.reason === "reload", 10_000, "reload start");
			await s.waitFor(() => (chromePids(browser).length === 0 ? true : undefined), 5_000, "browser exit on reload");
			const row = await s.waitFor(() => {
				const lines = s.capture().split("\n");
				const i = lines.findIndex((l) => /◇ tests\/fixtures\/e2e-revive\.html · click to load/.test(l));
				return i >= 0 ? i : undefined;
			}, 10_000, "placeholder line after reload");
			await sleep(500);
			s.type(s.press(3, row));
			await s.waitEvent((e) => e.ev === "revived" && e.id === idOf(w), 10_000, "revived after reload");
			s.track();
			await s.waitFor(() => (loads(s, idOf(w)).length === 2 ? true : undefined), 5_000, "fresh load");
		} finally {
			await closeAndCheck(s);
		}
	});

	it("kill -9 of Pi leaves no Chromium process it started", async (t) => {
		const s = await PiSession.start();
		try {
			await s.command("/widget-dev tests/fixtures/e2e-grid.html 40 2");
			await s.waitEvent((e) => e.ev === "widget", 20_000, "widget");
			s.track();
			const browser = chromePids(s.seen);
			assert.ok(browser.length > 0, "browser running");
			const pi = s.piPid();
			assert.ok(pi, "Pi process found");
			process.kill(pi, "SIGKILL");
			const end = Date.now() + 10_000;
			while (chromePids(browser).length && Date.now() < end) await sleep(100);
			assert.deepEqual(chromePids(browser), [], "no Chromium process left after kill -9");
			t.diagnostic(`killed Pi ${pi}; ${browser.length} browser processes exited`);
		} finally {
			await closeAndCheck(s);
		}
	});
});
