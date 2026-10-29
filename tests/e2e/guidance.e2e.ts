// Widget guidance e2e (AC03, AC04): the guide pointer on show_widget results before and after a guide read, and
// check_widget on live, frozen, and closed widgets plus an unknown id. Real Pi in a temporary visible tmux split with
// the scripted faux model; run with `npm run test:e2e` from a pane in the attached tmux client's current window.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { GUIDE_PATH } from "../../src/guide.js";
import { type DevEvent, PiSession, sleep, type Turn } from "./lib.js";

const POINTER = `Before editing this widget or creating another, read the widget guide: ${GUIDE_PATH}`;

describe("guide pointer and check_widget (dev timers: idle 4 s, close 3 s)", () => {
	let s: PiSession;
	let id = "";
	const toolResult = (turn: Turn | undefined, name: string): string => turn?.messages.findLast((m) => m.role === "toolResult" && m.toolName === name)?.text ?? "";

	/** Sends a prompt and returns the first new turn whose last message is a result of `tool`. */
	async function call(prompt: string, tool: string): Promise<string> {
		const n = s.turns().length;
		await s.command(prompt);
		const turn = await s.waitFor(() => s.turns().slice(n).find((t) => t.messages.at(-1)?.role === "toolResult" && t.messages.at(-1)?.toolName === tool), 15_000, `${tool} result`);
		await sleep(300);
		return toolResult(turn, tool);
	}
	const checkEvent = (n: number): Promise<DevEvent> => s.waitFor(() => s.events().filter((e) => e.ev === "check" && e.id === id)[n], 5_000, `check event ${n}`);

	before(async () => {
		// 60 columns: the test reads results and dev events only, so it fits narrow panes.
		s = await PiSession.start({ cols: 60, rows: 24, env: { PI_WIDGETS_DEV_TIMERS: "idle=4000,close=3000" } });
	});
	after(async () => {
		const left = await s.close();
		assert.deepEqual(left, [], `processes started by the run remain: ${left.join(", ")}`);
	});

	it("AC03: show_widget results carry the guide pointer until the guide was read", async () => {
		const result = await call(`e2e-tool ${JSON.stringify({ html: "<div style='height:100%;background:#89b4fa'>a</div>", title: "pointer probe", cols: 100, rows: 20 })}`, "show_widget");
		s.track();
		const w = await s.waitEvent((e) => e.ev === "widget" && e.title === "pointer probe", 5_000, "widget");
		id = String(w.id);
		assert.match(result, new RegExp(`Widget ${id} is shown inline`));
		assert.equal(result.split("\n").at(-1), POINTER, "the pointer is the last line");

		// AC04 live: a fresh capture while the widget is still live.
		const live = await call(`e2e-call check_widget ${JSON.stringify({ id })}`, "check_widget");
		assert.match(live, new RegExp(`^Widget ${id} \\(pointer probe\\): live`));
		assert.match(live, /Image: fresh capture, 1000x425 px PNG\./);
		assert.match(live, /JS errors since the last load: none\./);
		assert.match(live, /Overflowing or clipped elements: none\./);
		assert.match(live, /\[image\]/);
		const e0 = await checkEvent(0);
		assert.deepEqual([e0.state, e0.source, e0.width, e0.height], ["live", "fresh capture", 1000, 425]);

		await call(`e2e-call read ${JSON.stringify({ path: "guide/widgets.md" })}`, "read");
		await s.waitEvent((e) => e.ev === "guide-read", 5_000, "guide-read");
		const after = await call(`e2e-tool ${JSON.stringify({ html: "<p>b</p>", title: "after read", cols: 30, rows: 3 })}`, "show_widget");
		assert.match(after, /is shown inline/);
		assert.ok(!after.includes("read the widget guide"), "no pointer after the guide was read");
	});

	it("AC04: a frozen widget is captured without waking or focusing it; a closed one shows its still without revive", async () => {
		await s.waitEvent((e) => e.ev === "frozen" && e.id === id, 10_000, "first widget frozen");
		const frozen = await call(`e2e-call check_widget ${JSON.stringify({ id })}`, "check_widget");
		assert.match(frozen, /: frozen \(paused on its last frame/);
		assert.match(frozen, /Image: fresh capture, 1000x425 px PNG\./);
		const e1 = await checkEvent(1);
		assert.deepEqual([e1.state, e1.source, e1.width, e1.height], ["frozen", "fresh capture", 1000, 425]);
		await sleep(300);
		const mine = (ev: string): DevEvent[] => s.events().filter((e) => e.ev === ev && e.id === id);
		assert.deepEqual([mine("live").length, mine("focus").length], [0, 0], "never woken or focused");

		await s.waitEvent((e) => e.ev === "closed" && e.id === id, 10_000, "first widget closed");
		const closed = await call(`e2e-call check_widget ${JSON.stringify({ id })}`, "check_widget");
		assert.match(closed, /: closed \(no open page/);
		assert.match(closed, /Image: last still, 1000x425 px PNG\./);
		assert.match(closed, /closed: not inspected; showing the last still/);
		assert.match(closed, /\[image\]/);
		const e2 = await checkEvent(2);
		assert.deepEqual([e2.state, e2.source, e2.width, e2.height], ["closed", "last still", 1000, 425]);
		await sleep(300);
		assert.deepEqual([mine("revive").length, mine("revived").length, mine("live").length], [0, 0, 0], "no revive");

		const unknown = await call(`e2e-call check_widget ${JSON.stringify({ id: "000000000000" })}`, "check_widget");
		assert.match(unknown, /^Unknown widget id "000000000000"/);
		assert.doesNotMatch(unknown, /\[image\]/);
	});
});
