// show_image e2e (AC05): real Pi in a temporary visible tmux split with the scripted faux model. The PNG and JPEG
// fixtures each draw a title line plus a placeholder grid of the expected size, the tool result is text only, and a
// localhost URL is refused. Run with `npm run test:e2e` from a pane in the attached tmux client's current window.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { imageFit } from "../../src/image.js";
import { PLACEHOLDER } from "../../src/kitty.js";
import { type DevEvent, PiSession, sleep } from "./lib.js";

describe("show_image in a fullscreen session", () => {
	let s: PiSession;
	before(async () => {
		s = await PiSession.start();
	});
	after(async () => {
		const left = await s.close();
		assert.deepEqual(left, [], `processes started by the run remain: ${left.join(", ")}`);
	});

	/** Asks the faux model to call show_image; returns the tool result text and the new image event, if any. */
	async function call(args: Record<string, unknown>, expectImage: boolean): Promise<{ text: string; event: DevEvent | undefined }> {
		const turns = s.turns().length;
		const images = s.events().filter((e) => e.ev === "image").length;
		await s.command(`e2e-call show_image ${JSON.stringify(args)}`);
		const turn = await s.waitFor(
			() => s.turns().slice(turns).find((t) => t.messages.at(-1)?.role === "toolResult" && t.messages.at(-1)?.toolName === "show_image"),
			20_000,
			"show_image result",
		);
		s.track();
		const text = turn.messages.at(-1)?.text ?? "";
		const event = expectImage ? await s.waitFor(() => s.events().filter((e) => e.ev === "image")[images], 5_000, "image event") : undefined;
		await sleep(300);
		return { text, event };
	}

	const fixtures: [string, string, { width: number; height: number }, boolean][] = [
		["tests/fixtures/image.png", "PNG", { width: 160, height: 100 }, false],
		["tests/fixtures/image.jpg", "JPEG", { width: 120, height: 80 }, true],
	];
	for (const [source, format, natural, browser] of fixtures) {
		it(`AC05: ${format} draws a title line plus a placeholder grid of the expected size; the result is text only`, async () => {
			const title = `${format.toLowerCase()} probe`;
			const { text, event } = await call({ source, title }, true);
			assert.ok(event);
			assert.equal(event.browser, browser, "only non-PNG sources use the browser");
			const fit = imageFit(natural, event.cell as { width: number; height: number }, Number(event.dpr), Number(event.maxCols), 24, false);
			assert.deepEqual({ cols: event.cols, rows: event.rows, width: event.width, height: event.height }, fit);
			const grid = await s.waitLocate(Number(event.imageId), fit.rows);
			const lines = s.capture().split("\n");
			assert.match(lines[grid.row - 1] ?? "", new RegExp(`◆ ${title}`), "title line directly above the grid");
			for (let r = 0; r < fit.rows; r++) assert.equal((lines[grid.row + r] ?? "").split(PLACEHOLDER).length - 1, fit.cols, `row ${r} has ${fit.cols} placeholder cells`);
			assert.match(text, new RegExp(`^Image ${String(event.id)} is shown inline: ${fit.cols}x${fit.rows} cells, ${fit.width}x${fit.height} px sent \\(${format}, natural size ${natural.width}x${natural.height} px\\)\\.`));
			assert.match(text, new RegExp(`\nSource: /.*/${source.replaceAll(".", "\\.")}$`));
			assert.doesNotMatch(text, /\[image\]|[A-Za-z0-9+/]{120,}/, "no image content in the result");
			assert.ok(text.length < 600, `short result (${text.length} chars)`);
		});
	}

	it("AC06d (automated part): a localhost URL is refused with a clear message", async () => {
		const { text } = await call({ source: "http://localhost:8080/image.png" }, false);
		assert.match(text, /refused http:\/\/localhost:8080\/image\.png: localhost is a local address/);
		await s.waitFor(() => (/image failed: .*refused/.test(s.capture()) ? true : undefined), 5_000, "failure row");
		assert.equal(s.events().filter((e) => e.ev === "image").length, 2);
	});

	it("/widgets-refresh re-sends the shown images", async () => {
		const ids = s.events().filter((e) => e.ev === "image").map((e) => String(e.id));
		await s.command("/widgets-refresh");
		const resend = await s.waitEvent((e) => e.ev === "resend" && e.reason === "command", 5_000, "resend");
		assert.deepEqual([...(resend.ids as string[])].sort(), [...ids].sort());
	});
});
